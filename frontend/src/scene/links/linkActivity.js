/**
 * What the cables show right now, filled by PacketLayer once per frame while it positions the packets, and read by each cable in
 * its own frame callback. Plain mutable data, never React state: no re-render happens per frame.
 *
 *  - `linkSeverity`: which cables carry flagged or blocked traffic (amber, red tint).
 *  - `linkFlow`: which cables lie on the route of a packet in flight (the whole route glows in the packet's colour) and where the
 *    packets' pulses are on each cable (a bright head and a fading tail, travelling in the direction of the packet).
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

/** The most pulses drawn on one cable at a time. */
export const MAX_PULSES = 4

/** @type {Map<string, {glow: number, color: [number, number, number], pulses: {u: number, dir: number, color: [number, number, number]}[]}>} */
export const linkFlow = new Map()

function entry(link) {
  let e = linkFlow.get(link)
  if (!e) {
    e = { glow: 0, color: [0, 0, 0], pulses: [] }
    linkFlow.set(link, e)
  }
  return e
}

/**
 * A cable lies on the route of a packet in flight: its whole length glows in the packet's colour (rgb 0..1).
 * @param {string} link
 * @param {[number, number, number]} rgb
 * @param {number} strength  0..1
 */
export function noteRouteGlow(link, rgb, strength) {
  const e = entry(link)
  if (strength >= e.glow) {
    e.glow = strength
    e.color = rgb
  }
}

/**
 * A packet is on this cable: a pulse at `u` (0 at the cable's A end, 1 at its B end) travelling in `dir` (+1 towards B, -1 towards A).
 * @param {string} link
 * @param {number} u
 * @param {number} dir
 * @param {[number, number, number]} rgb
 */
export function notePulse(link, u, dir, rgb) {
  const e = entry(link)
  if (e.pulses.length < MAX_PULSES) e.pulses.push({ u, dir, color: rgb })
}

/** Forget everything noted: called at the start of every frame before packets are positioned. */
export function clearLinkActivity() {
  linkSeverity.clear()
  for (const e of linkFlow.values()) {
    e.glow = 0
    e.pulses.length = 0
  }
}
