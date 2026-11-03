/**
 * Timeline markers: the moments on the scrubber worth jumping to, derived from the trace.
 * Pure, so what the scrubber shows is tested against the same events the counters come from.
 */

/** @param {any} e A trace event. */
export function markerTitle(e) {
  if (e.type === 'policy.decision') return `${e.node} denied a packet (${e.rule_id})`
  if (e.type === 'ips.action') return `IPS-1 ${e.action} (${e.rule})`
  if (e.type === 'alert.raised') return `${e.sensor} alert ${e.rule} ${e.severity}`
  return e.type.replace('.', ' ')
}

/** The marker kind of an event, or null when it has none. */
export function markerKind(e) {
  switch (e.type) {
    case 'alert.raised':
      return e.severity === 'high' ? 'alert-high' : 'alert-medium'
    case 'block.added':
      return 'block'
    case 'block.expired':
      return 'unblock'
    case 'policy.decision':
      return e.action === 'deny' ? 'deny' : null
    case 'ips.action':
      return e.applied && (e.action === 'reject' || e.action === 'drop') ? 'reject' : null
    default:
      return null
  }
}

/**
 * @param {any[]} events
 * @param {number} duration
 * @returns {{key: number, kind: string, left: number, title: string, t: number}[]}
 */
export function markersFor(events, duration) {
  const marks = []
  for (const e of events) {
    const kind = markerKind(e)
    if (kind) marks.push({ key: e.seq, kind, t: e.t, left: (e.t / duration) * 100, title: `T+${e.t.toFixed(2)} s · ${markerTitle(e)}` })
  }
  return marks
}

/**
 * The IPS mode in force at `time` for a run: the scenario's pin, else the latest switch at or before
 * `time`, else the mode the run started in.
 * @param {{ipsMode: string, controls: {type: string, t: number, mode?: string}[]}|null} request
 * @param {string|null} pinned
 * @param {number} time
 */
export function ipsModeAt(request, pinned, time) {
  if (!request) return null
  if (pinned) return pinned
  const latest = request.controls
    .filter((c) => c.type === 'ips_mode' && c.t <= time)
    .sort((a, b) => a.t - b.t)
    .at(-1)
  return latest?.mode ?? request.ipsMode
}
