/**
 * Trace event contract (frozen, Rev 3 A11). Mirrors backend/netsec/sim/events.py.
 * `contracts/events.json` is the machine-readable source; events.test.js asserts this file matches it.
 */

/** Event type names, in contract order. */
export const EVENT_TYPES = Object.freeze([
  'run.meta',
  'packet.created',
  'packet.hop',
  'packet.mirrored',
  'policy.decision',
  'inspect.result',
  'alert.raised',
  'ips.action',
  'block.added',
  'block.expired',
  'packet.delivered',
  'packet.dropped',
  'syslog.sent',
  // campus security extension (contracts/events.json 1.1.0): emitted only by scenarios that enable the feature
  'zt.decision',
  'edr.alert',
  'edr.state',
  'siem.event',
  'run.end',
])

/** Fields every event carries besides its own. */
export const BASE_FIELDS = Object.freeze(['seq', 't', 'type'])

/** Fields each event type adds to the base fields. */
export const EVENT_FIELDS = Object.freeze({
  'run.meta': ['run_id', 'scenario_id', 'seed', 'ips_mode', 'duration', 'config_hash'],
  'packet.created': ['pid', 'flow', 'proto', 'src', 'sport', 'dst', 'dport', 'flags', 'ttl', 'len', 'icmp', 'app', 'mirror_of'],
  'packet.hop': ['pid', 'link', 'from', 'to', 't_arrive', 'vlan', 'ttl'],
  'packet.mirrored': ['pid', 'copy_pid', 'at', 'to'],
  'policy.decision': ['pid', 'node', 'policy', 'rule_id', 'action', 'via_conntrack'],
  'inspect.result': ['pid', 'node', 'classification', 'rules'],
  'alert.raised': ['alert_id', 'incident_id', 'sensor', 'rule', 'severity', 'src', 'dst', 'proto', 'dport', 'reason', 'evidence'],
  'ips.action': ['pid', 'action', 'mode', 'applied', 'rule'],
  'block.added': ['src', 'until', 'rule', 'incident_id'],
  'block.expired': ['src'],
  'packet.delivered': ['pid', 'node'],
  'packet.dropped': ['pid', 'node', 'reason'],
  'syslog.sent': ['pid', 'from', 'to', 'alert_id'],
  'zt.decision': ['pid', 'node', 'pdp', 'user', 'role', 'device', 'trust', 'resource', 'proto', 'port', 'decision', 'reason', 'factors'],
  'edr.alert': ['alert_id', 'node', 'state', 'severity', 'reason', 'manager'],
  'edr.state': ['node', 'state', 'cause', 'reason'],
  'siem.event': ['event_id', 'source', 'kind', 'severity', 'node', 'src', 'dst', 'proto', 'dport', 'reason', 'action', 'incident_id', 'origin_type', 'origin_ref'],
  'run.end': ['stats'],
})

/** Counters in `run.end.stats` (definitions: backend/netsec/analysis/stats.py). */
export const STATS_FIELDS = Object.freeze([
  'data_packets',
  'delivered_clean',
  'delivered_flagged',
  'blocked',
  'other_drop',
  'mirrored',
  'management',
  'alerts',
  'incidents',
])

/**
 * @typedef {Object} TraceEvent
 * @property {number} seq  Gap-free counter starting at 0.
 * @property {number} t    Simulation time in seconds.
 * @property {string} type One of EVENT_TYPES.
 */

/**
 * @typedef {Object} RunSummary
 * @property {number} data_packets
 * @property {number} delivered_clean
 * @property {number} delivered_flagged
 * @property {number} blocked
 * @property {number} other_drop
 * @property {number} mirrored
 * @property {number} management
 * @property {number} alerts
 * @property {number} incidents
 */
