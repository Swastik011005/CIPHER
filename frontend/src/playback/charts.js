/**
 * Plain-data series for the Monitoring page's charts, folded from the same reducer state as every other number on the page (the
 * packets of the loaded trace up to the playhead). Nothing here is sampled or invented: each point counts real packets of the trace.
 * SPAN copies and management traffic are not data-plane packets and are left out.
 */

const BLOCKING_REASONS = new Set(['fw_deny', 'acl_deny', 'ips_drop', 'ips_reject', 'blocked_source', 'rate_limited', 'edr_isolated', 'zt_deny'])

/** The outcome of a packet at the playhead: 'blocked', 'flagged' or 'allowed' (anything not stopped and not flagged by a sensor). */
export function outcomeOf(packet) {
  if (packet.end?.type === 'dropped' && BLOCKING_REASONS.has(packet.end.reason)) return 'blocked'
  if (packet.verdict?.kind === 'blocked') return 'blocked'
  if (packet.verdict?.kind === 'flagged') return 'flagged'
  return 'allowed'
}

const dataPackets = (state) => Object.values(state?.packets ?? {}).filter((p) => p.mirrorOf == null)

/**
 * Packets per interval of the run, split by outcome, up to the playhead.
 * @param {any} state  Reducer state.
 * @param {number} duration  Length of the run in seconds.
 * @param {number} [bucket]  Interval in seconds.
 * @returns {{labels: string[], allowed: number[], flagged: number[], blocked: number[], bucket: number}}
 */
export function trafficSeries(state, duration, bucket = 1) {
  const n = Math.max(1, Math.ceil(Math.max(duration, 1) / bucket))
  const allowed = new Array(n).fill(0)
  const flagged = new Array(n).fill(0)
  const blocked = new Array(n).fill(0)
  for (const p of dataPackets(state)) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(p.createdAt / bucket)))
    const kind = outcomeOf(p)
    if (kind === 'blocked') blocked[i] += 1
    else if (kind === 'flagged') flagged[i] += 1
    else allowed[i] += 1
  }
  return { labels: Array.from({ length: n }, (_, i) => String(i * bucket)), allowed, flagged, blocked, bucket }
}

/** Data-plane packets by protocol. */
export function protocolMix(state) {
  const counts = { tcp: 0, udp: 0, icmp: 0 }
  for (const p of dataPackets(state)) counts[p.proto] = (counts[p.proto] ?? 0) + 1
  return counts
}

/**
 * The busiest sources, by packets sent, named after the device that owns the address.
 * @param {any} state
 * @param {{nodes: any[]}} topology
 * @param {number} [limit]
 */
export function topTalkers(state, topology, limit = 6) {
  const owner = new Map()
  for (const node of topology?.nodes ?? []) for (const iface of node.interfaces ?? []) if (iface.ip) owner.set(iface.ip, node.label ?? node.id)
  const counts = new Map()
  for (const p of dataPackets(state)) counts.set(p.src, (counts.get(p.src) ?? 0) + 1)
  return [...counts]
    .map(([ip, packets]) => ({ ip, name: owner.get(ip) ?? ip, packets }))
    .sort((a, b) => b.packets - a.packets || a.name.localeCompare(b.name))
    .slice(0, limit)
}
