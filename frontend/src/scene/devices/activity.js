/**
 * How busy a device looks right now, from the trace at the playhead.
 *
 * Every counter event on a device (a packet sent or received, a decision, an alert) stamps its `lastT`. The
 * indicator is full at that instant and fades linearly to nothing over `ACTIVITY_DECAY_S`. It depends only on
 * the reducer state and the playhead, so pausing freezes it, seeking shows exactly that moment's, and it can
 * never be left lit by an earlier pass.
 */
export const ACTIVITY_DECAY_S = 0.7

/**
 * @param {{lastT?: number}|undefined} stats  `state.nodes[id]`
 * @param {number} time  Playhead time (s).
 * @returns {number} 0 (idle) to 1 (just now).
 */
export function activityAt(stats, time) {
  if (!stats || stats.lastT === undefined) return 0
  const age = time - stats.lastT
  if (age < 0) return 0
  return Math.max(0, 1 - age / ACTIVITY_DECAY_S)
}

/** Spin speed of the IDS-1 radar ring (radians per second): a slow sweep, faster while SPAN copies arrive. */
export function radarSpeed(activity) {
  return 0.8 + 5.2 * activity
}
