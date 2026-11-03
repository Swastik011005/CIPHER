/**
 * Data for the Network Monitoring page, derived from the same reducer state as the Simulation page, so the
 * two can never disagree. Pure functions; the page only formats what they return.
 */
import { deviceTags } from './deviceStatus.js'
import { describeEvent } from './reducers.js'

/** The headline counters, in the order the Simulation page shows them, plus where the totals come from. */
export function kpis(counts) {
  return [
    { key: 'data_packets', label: 'Packets', value: counts.data_packets, hint: 'data-plane packets sent' },
    { key: 'delivered_clean', label: 'Delivered clean', value: counts.delivered_clean, hint: 'never flagged', tone: 'ok' },
    { key: 'delivered_flagged', label: 'Delivered flagged', value: counts.delivered_flagged, hint: 'flagged, then let through (Monitor)', tone: 'warn' },
    { key: 'blocked', label: 'Blocked', value: counts.blocked, hint: 'firewall, ACL and IPS-1 decisions', tone: 'danger' },
    { key: 'other_drop', label: 'Other drops', value: counts.other_drop, hint: 'TTL expired or no route' },
    { key: 'mirrored', label: 'SPAN copies', value: counts.mirrored, hint: 'copies to IDS-1, not counted above', tone: 'sensor' },
    { key: 'alerts', label: 'Alerts', value: counts.alerts, hint: 'raw alert records', tone: 'sensor' },
    { key: 'incidents', label: 'Incidents', value: counts.incidents, hint: 'threats, both sensors merged', tone: 'sensor' },
  ]
}

/** True when every data packet seen so far is in exactly one outcome bucket or still travelling. */
export function bucketsAddUp(counts) {
  return counts.delivered_clean + counts.delivered_flagged + counts.blocked + counts.other_drop <= counts.data_packets
}

/**
 * One row per device with its counters at the playhead.
 * @param {{nodes: any[], zones: any[]}} topology
 * @param {ReturnType<import('./reducers.js').initialState>} state
 */
export function deviceRows(topology, state) {
  return topology.nodes.map((node) => {
    const s = state.nodes[node.id] ?? {}
    const address = node.interfaces.find((i) => i.ip)?.ip ?? null
    return {
      id: node.id,
      label: node.label,
      type: node.type,
      zone: topology.zones.find((z) => z.id === node.zone)?.name ?? node.zone,
      sent: s.sent ?? 0,
      received: s.received ?? 0,
      delivered: s.delivered ?? 0,
      dropped: s.dropped ?? 0,
      permits: s.permits ?? 0,
      denies: s.denies ?? 0,
      alerts: s.alerts ?? 0,
      lastT: s.lastT ?? null,
      tags: deviceTags(node, address, state),
    }
  })
}

export const LOG_FILTERS = Object.freeze([
  { value: 'security', label: 'Security', types: ['alert.raised', 'ips.action', 'policy.decision', 'block.added', 'block.expired'] },
  { value: 'drops', label: 'Drops', types: ['packet.dropped'] },
  { value: 'delivered', label: 'Deliveries', types: ['packet.delivered'] },
  { value: 'all', label: 'Everything', types: null },
])

/**
 * The most recent events up to the playhead, newest first.
 * @param {any[]} events  The whole trace.
 * @param {number} applied  How many events the player has applied (`state.cursor`).
 * @param {string} filter  A `LOG_FILTERS` value.
 * @param {number} [limit]
 */
export function eventLog(events, applied, filter, limit = 80) {
  const types = LOG_FILTERS.find((f) => f.value === filter)?.types ?? null
  const set = types ? new Set(types) : null
  const rows = []
  for (let i = Math.min(applied, events.length) - 1; i >= 0 && rows.length < limit; i -= 1) {
    const e = events[i]
    if (set && !set.has(e.type)) continue
    rows.push({ seq: e.seq, t: e.t, type: e.type, pid: e.pid ?? null, node: e.node ?? e.sensor ?? null, text: describeEvent(e) })
  }
  return rows
}
