/**
 * Which thing a pointer event is for, when several pickable things lie on the same ray.
 *
 * The campus has invisible pick volumes (a pavilion's volume, the ground) around objects that are pickable themselves (devices,
 * cables, packets). R3F delivers an event to every interactive object on the ray, nearest first, so a handler asks
 * `isTopPick(event, kind)` and acts only when nothing of higher priority is on the ray. A device inside a glass pavilion is
 * therefore always picked before its pavilion, a cable before the pavilion it crosses, and the ground only when nothing else is hit.
 *
 * Pure data, no three.js: every pickable object sets `userData.pick` to one of these kinds.
 */

/** Priority of each kind: higher wins. */
export const PICK = Object.freeze({ ground: 0, zone: 1, cable: 2, device: 3, packet: 4 })

/** The `pick` kind of an intersection (set on the object that carries the handlers), or null. */
function kindOf(intersection) {
  return intersection?.eventObject?.userData?.pick ?? intersection?.object?.userData?.pick ?? null
}

/**
 * The highest priority among everything the ray hit.
 * @param {{eventObject?: any, object?: any}[]} intersections
 * @returns {number}  -1 when nothing pickable was hit.
 */
export function topPriority(intersections) {
  let top = -1
  for (const hit of intersections ?? []) {
    const kind = kindOf(hit)
    if (kind !== null && PICK[kind] > top) top = PICK[kind]
  }
  return top
}

/**
 * True when `kind` is the highest-priority thing on the event's ray.
 * @param {{intersections?: any[]}} event  An R3F pointer event.
 * @param {keyof typeof PICK} kind
 */
export function isTopPick(event, kind) {
  return PICK[kind] >= topPriority(event.intersections)
}
