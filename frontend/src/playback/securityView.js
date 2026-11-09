/**
 * Plain-data views of the security side of a run, for the scenario launcher, the endpoint panel and the SIEM console.
 *
 * Everything here reads the reducer state, which is folded from the backend's trace. Nothing decides an outcome: a function only
 * counts and words what the engine already wrote.
 */

/** How each drop reason is worded for people. */
export const DROP_REASON_TEXT = Object.freeze({
  fw_deny: 'denied by the firewall (FW1)',
  acl_deny: 'denied by the ACL (CORE-SW1)',
  ips_drop: 'dropped by IPS-1',
  ips_reject: 'rejected by IPS-1',
  blocked_source: 'dropped: IPS-1 is blocking the source',
  rate_limited: 'rate-limited by IPS-1',
  edr_isolated: 'dropped because the endpoint is isolated (EDR)',
  zt_deny: 'denied by Zero Trust',
  ttl_expired: 'TTL expired',
  no_route: 'no route',
})

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * What happened in the run so far, in plain sentences, from the trace state.
 * @param {ReturnType<import('./reducers.js').initialState>|null} state
 * @returns {{text: string, tone: 'ok'|'danger'|'warn'|'info'}[]}
 */
export function describeOutcome(state) {
  if (!state || !state.meta) return []
  const lines = []
  const c = state.counts
  const delivered = c.delivered_clean + c.delivered_flagged
  if (delivered > 0) lines.push({ text: `${plural(delivered, 'packet')} delivered`, tone: 'ok' })

  const drops = new Map()
  for (const p of Object.values(state.packets)) {
    if (p.mirrorOf != null || p.end?.type !== 'dropped') continue
    const key = `${p.end.node}|${p.end.reason}`
    drops.set(key, (drops.get(key) ?? 0) + 1)
  }
  for (const [key, n] of [...drops].sort()) {
    const [node, reason] = key.split('|')
    lines.push({ text: `${plural(n, 'packet')} ${DROP_REASON_TEXT[reason] ?? reason} at ${node}`, tone: 'danger' })
  }
  if (c.alerts > 0) {
    const sensors = [...new Set(state.alerts.map((a) => a.sensor))].join(' and ')
    lines.push({ text: `${plural(c.alerts, 'alert')} raised by ${sensors}`, tone: 'warn' })
  }
  if (state.zt.length > 0) {
    const verdicts = state.zt.reduce((acc, z) => ({ ...acc, [z.decision]: (acc[z.decision] ?? 0) + 1 }), {})
    lines.push({ text: `Zero Trust: ${Object.entries(verdicts).map(([d, n]) => `${n} ${d}`).join(', ')}`, tone: verdicts.deny ? 'danger' : 'info' })
  }
  for (const [node, e] of Object.entries(state.edr)) lines.push({ text: `EDR: ${node} is ${e.state}`, tone: e.state === 'healthy' ? 'ok' : e.state === 'isolated' ? 'info' : 'danger' })
  if (state.siem.length > 0) {
    const incidents = new Set(state.siem.map((s) => s.incident_id)).size
    lines.push({ text: `SIEM received ${plural(state.siem.length, 'event')} in ${plural(incidents, 'incident')}`, tone: 'info' })
  }
  if (lines.length === 0) lines.push({ text: 'Nothing has happened yet', tone: 'info' })
  return lines
}

/**
 * The latest flows that touched an address, with how each ended.
 * @param {ReturnType<import('./reducers.js').initialState>|null} state
 * @param {string} ip
 * @param {number} [limit]
 */
export function recentConnections(state, ip, limit = 8) {
  if (!state || !state.meta || !ip) return []
  const flows = new Map()
  for (const p of Object.values(state.packets)) {
    if (p.mirrorOf != null || (p.src !== ip && p.dst !== ip) || p.flow.endsWith(':rst')) continue
    const peer = p.src === ip ? p.dst : p.src
    const key = p.flow
    const entry = flows.get(key) ?? { flow: p.flow, peer, proto: p.proto, port: p.dport, firstAt: p.createdAt, packets: 0, delivered: 0, dropped: 0, reason: null, droppedAt: null }
    entry.packets += 1
    if (p.end?.type === 'delivered') entry.delivered += 1
    if (p.end?.type === 'dropped') {
      entry.dropped += 1
      entry.reason = p.end.reason
      entry.droppedAt = p.end.node
    }
    if (p.src === ip && p.dport != null) entry.port = p.dport
    flows.set(key, entry)
  }
  return [...flows.values()].sort((a, b) => b.firstAt - a.firstAt).slice(0, limit)
}

/**
 * What the SIEM console says when it has no event to list, so that "nothing yet", "not part of this scenario" and "no run" are never
 * confused. ``siemEnabled`` is whether the loaded scenario sends events to the SIEM (the baseline scenarios S1 to S7 do not).
 * @param {{view: 'run' | 'history', loaded: boolean, siemEnabled: boolean | undefined}} input
 * @returns {{title: string, body: string}}
 */
export function siemEmptyState({ view, loaded, siemEnabled }) {
  if (view === 'history') return { title: 'The SIEM history is empty', body: 'Events are kept here after each run on this server. Run P7 or P9 and they will appear.' }
  if (!loaded) return { title: 'No run loaded', body: 'Run one of the presentation scenarios P1 to P9, for example P7 (a compromised endpoint) or P9 (an XMAS scan), and the events appear here as they happen.' }
  if (siemEnabled === false) {
    return { title: 'SIEM-1 is not part of this scenario', body: 'The baseline scenarios S1 to S7 do not send events to the SIEM, even when IDS-1 or IPS-1 raise alerts. Run one of P1 to P9, for example P7, to see SIEM events.' }
  }
  return { title: 'No SIEM event yet', body: 'Nothing has reached SIEM-1 up to the playhead. Press play or move the playhead forward. In P1 and P5 (normal traffic, nothing forbidden) nothing ever does.' }
}

/**
 * The SIEM events grouped into incidents, newest first.
 * @param {{incident_id: string, node: string, severity: string, t: number, source: string}[]} events
 */
export function siemIncidents(events) {
  const rank = { low: 1, medium: 2, high: 3 }
  const groups = new Map()
  for (const e of events) {
    const g = groups.get(e.incident_id) ?? { id: e.incident_id, node: e.node, severity: 'low', firstT: e.t, lastT: e.t, sources: [], events: [] }
    g.events.push(e)
    g.lastT = e.t
    if (rank[e.severity] > rank[g.severity]) g.severity = e.severity
    if (!g.sources.includes(e.source)) g.sources.push(e.source)
    groups.set(e.incident_id, g)
  }
  return [...groups.values()].sort((a, b) => b.lastT - a.lastT)
}

/** The Security tab's headline: the endpoint's EDR state from the run or the server, in one word. */
export function endpointHealth(nodeId, state, serverIsolated) {
  const fromRun = state?.edr?.[nodeId]?.state
  if (fromRun) return fromRun
  return serverIsolated ? 'isolated' : 'healthy'
}

/** The network address in CIDR form for an address and prefix length, e.g. 10.0.10.12 and 24 give 10.0.10.0/24. */
export function networkOf(ip, prefix) {
  const parts = ip.split('.').map(Number)
  const value = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const net = (value & mask) >>> 0
  return `${net >>> 24}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`
}
