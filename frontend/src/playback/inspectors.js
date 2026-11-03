/**
 * Data for the device and packet inspectors, derived from the reducer state (which is itself the
 * fold of the engine's trace up to the playhead). Pure functions: the panels only format what they
 * return, and the tests check them against the raw trace.
 */

/** Counters shown for each kind of device; keys of `state.nodes[id]`. */
const COUNTERS = {
  host: [['sent', 'Sent'], ['received', 'Received'], ['delivered', 'Delivered to it'], ['dropped', 'Dropped here']],
  router: [['received', 'Received'], ['sent', 'Forwarded'], ['dropped', 'Dropped here']],
  l3switch: [['received', 'Received'], ['sent', 'Forwarded'], ['mirrorsOut', 'SPAN copies sent'], ['permits', 'ACL permits'], ['denies', 'ACL denies']],
  l2switch: [['received', 'Received'], ['sent', 'Forwarded']],
  firewall: [['received', 'Received'], ['sent', 'Forwarded'], ['permits', 'Permitted'], ['denies', 'Denied']],
  ids: [['mirrorsIn', 'SPAN copies received'], ['inspected', 'Copies inspected'], ['flagged', 'Flagged'], ['alerts', 'Alerts raised']],
  ips: [['received', 'Received'], ['inspected', 'Inspected'], ['flagged', 'Flagged'], ['actions', 'IPS actions'], ['limited', 'Rate-limited'], ['dropped', 'Dropped (all reasons)']],
  syslog: [['received', 'Received']],
  segment: [['received', 'Received'], ['sent', 'Forwarded']],
}

/**
 * @param {{id: string, type: string}} node  Topology node.
 * @param {string|null} address  Primary IP without prefix.
 * @param {ReturnType<import('./reducers.js').initialState>} state
 * @param {number} time  Playhead time (s).
 */
export function deviceInspector(node, address, state, time) {
  const stats = state.nodes[node.id] ?? {}
  const counters = (COUNTERS[node.type] ?? COUNTERS.host).map(([key, label]) => ({ key, label, value: stats[key] ?? 0 }))

  /** @type {{tone: string, text: string}} */
  let status = { tone: 'neutral', text: state.meta ? 'Idle' : 'Idle · no simulation running' }
  const block = address ? state.blocks[address] : null
  if (block) status = { tone: 'danger', text: `Blocked by IPS-1 until T+${block.until.toFixed(1)} s (${Math.max(0, block.until - time).toFixed(1)} s left)` }
  else if (node.type === 'ids' && state.meta) status = { tone: 'sensor', text: `Passive · watching SPAN copies · ${stats.alerts ?? 0} alerts` }
  else if (node.type === 'ips' && state.meta) status = { tone: state.meta.ips_mode === 'enforce' ? 'ok' : 'warn', text: state.meta.ips_mode === 'enforce' ? 'Inline · Enforce mode' : 'Inline · Monitor mode (records, does not block)' }
  else if (stats.lastT !== undefined && state.meta) status = { tone: 'ok', text: `Last activity T+${stats.lastT.toFixed(1)} s` }

  return {
    status,
    counters,
    lastActivity: stats.lastT ?? null,
    rules: Object.values(state.ruleHits).filter((r) => r.node === node.id).sort((a, b) => b.count - a.count),
    alerts: node.type === 'ids' || node.type === 'ips' ? state.alerts.filter((a) => a.sensor === node.id).slice(-6).reverse() : [],
    blocks: node.type === 'ips' ? Object.values(state.blocks).map((b) => ({ ...b, remaining: Math.max(0, b.until - time) })) : [],
  }
}

/** Where a packet is and what has happened to it at time `t`. */
function packetStatus(packet, time) {
  if (packet.end) {
    const word = packet.end.type === 'delivered' ? 'Delivered' : 'Dropped'
    return {
      tone: packet.end.type === 'delivered' ? (packet.flagged ? 'warn' : 'ok') : 'danger',
      text: `${word} at ${packet.end.node}${packet.end.reason ? ` (${packet.end.reason})` : ''} · T+${packet.end.t.toFixed(2)} s`,
    }
  }
  const last = packet.hops[packet.hops.length - 1]
  if (!last) return { tone: 'neutral', text: `Created at T+${packet.createdAt.toFixed(2)} s` }
  return time < last.tArrive
    ? { tone: 'info', text: `In flight: ${last.from} → ${last.to}` }
    : { tone: 'info', text: `Inside ${last.to}` }
}

/**
 * Everything the packet inspector shows. Returns null when the packet has not been created yet at
 * the playhead (for example after seeking backwards past its creation).
 * @param {ReturnType<import('./reducers.js').initialState>} state
 * @param {number} pid
 * @param {number} time
 */
export function packetInspector(state, pid, time) {
  const packet = state.packets[pid]
  if (!packet) return null
  const copies = Object.values(state.packets)
    .filter((p) => p.mirrorOf === pid)
    .map((p) => p.pid)
  return {
    pid,
    isCopy: packet.mirrorOf != null,
    copyOf: packet.mirrorOf,
    copies,
    flow: packet.flow,
    injectedBy: packet.injectedBy,
    proto: packet.proto,
    src: packet.src,
    sport: packet.sport,
    dst: packet.dst,
    dport: packet.dport,
    flags: packet.flags,
    ttlAtSource: packet.ttl,
    length: packet.len,
    app: packet.app,
    createdAt: packet.createdAt,
    status: packetStatus(packet, time),
    verdict: packet.verdict,
    hops: packet.hops.map((h, i) => ({ n: i + 1, ...h })),
    trail: packet.trail,
  }
}

/**
 * Recent data-plane packets for the packet list, newest first.
 * @param {ReturnType<import('./reducers.js').initialState>} state
 * @param {number} time
 * @param {number} [limit]
 */
export function recentPackets(state, time, limit = 14) {
  return Object.values(state.packets)
    .filter((p) => p.mirrorOf == null)
    .sort((a, b) => b.createdAt - a.createdAt || b.pid - a.pid)
    .slice(0, limit)
    .map((p) => ({
      pid: p.pid,
      label: `${p.src} → ${p.dst}${p.dport != null ? `:${p.dport}` : ''}`,
      proto: p.proto,
      flags: p.flags,
      status: packetStatus(p, time),
      verdict: p.verdict?.kind ?? null,
    }))
}
