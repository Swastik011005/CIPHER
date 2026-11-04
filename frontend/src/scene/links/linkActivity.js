/**
 * Which cables carry flagged or blocked traffic right now, for the cable tint (amber for flagged, red for blocked).
 *
 * PacketLayer fills this once per frame while it positions the packets, and each cable reads its own entry in its own frame
 * callback. It is plain mutable data, never React state: no re-render happens per frame.
 */

/** Severity per link id: 1 flagged (amber), 2 blocked (red). Absent means nothing noteworthy on that cable. */
export const linkSeverity = new Map()

/** Raise a link's severity for this frame (a link keeps the highest it was given). */
export function noteLinkSeverity(link, level) {
  if (level > (linkSeverity.get(link) ?? 0)) linkSeverity.set(link, level)
}

/** Severity of a packet colour key from packetColor.js: only verdicts that are not plain allowed/neutral count. */
export function severityOf(colorKey) {
  if (colorKey === 'flagged') return 1
  if (colorKey === 'dropped') return 2
  return 0
}
