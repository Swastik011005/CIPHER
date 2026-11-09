/**
 * Campus infrastructure that is only there to make the campus look inhabited: an entrance gate and guard booth, covered
 * walkways along the roads, networking cabinets, empty server cabinets in the data centre and a security monitoring wall and
 * stations in the operations centre. Pure data and rules, no three.js, so the placement is cheap to test.
 *
 * It is decoration, like the rest of the campus layer: it adds no topology node, no link and no cable, and it never stands on a
 * platform, a road, another piece of decoration or a cable (the tests check each of those). Everything repeated is drawn from
 * shared geometry: merged meshes for the static parts and merged meshes.
 */
import { PLATES } from '../layout.js'
import { PLATFORM_TOP, allPlatforms, cableSegments, roadRects } from './campusLayout.js'

const rect = ([x0, z0, x1, z1]) => ({ x0, z0, x1, z1 })
const overlapsRect = (a, b, gap = 0) => a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.z0 < b.z1 + gap && a.z1 > b.z0 - gap

/** The campus entrance: a gate arch over the west end of the main avenue, with a barrier arm and a glass guard booth. */
export const ENTRANCE = Object.freeze({
  arch: { x: -15.2, z0: -10.9, z1: -5.1, height: 5.0 },
  booth: rect([-19.4, -13.4, -16.6, -11.2]),
  barrier: { x: -15.2, z: -10.2, length: 3.4 },
})

/** Networking cabinets beside the buildings: [x, z, width, depth]. */
export const CABINETS = Object.freeze([
  [7.2, -17, 1.6, 1.0], [7.2, -27.5, 1.6, 1.0], // staff lab, west side
  [56.6, -25, 1.0, 1.6], [56.6, -19, 1.0, 1.6], // administration, east side
  [52.6, 17, 1.0, 1.6], [52.6, 30, 1.0, 1.6], // data centre, east side
  [-20.2, 19, 1.0, 1.6], [-20.2, 28, 1.0, 1.6], // security operations, west side
])

/** Empty server cabinets standing in a row along the south wall of the data centre. [x, z]; each is 1.5 wide, 1.35 deep, 3.3 high. */
export const SERVER_CABINETS = Object.freeze([27, 31, 35, 39, 43, 47].map((x) => [x, 30.6]))

/** The security monitoring wall (screens on the west wall of the operations centre) and the monitoring stations in front of it. */
export const SOC_WALL = Object.freeze({ x: -17.2, z0: 25.4, z1: 31, screens: 4 })
export const SOC_STATIONS = Object.freeze([[-8, 27.6], [-2, 27.6], [4, 27.6]])

function distanceToSegment(p, a, b) {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

/** Every footprint decoration stands on, as {id, rect}, for the overlap checks. */
export function decorFootprints() {
  const list = []
  list.push({ id: 'booth', rect: ENTRANCE.booth })
  for (const [x, z, w, d] of CABINETS) list.push({ id: `cabinet-${x}-${z}`, rect: rect([x - w / 2, z - d / 2, x + w / 2, z + d / 2]) })
  return list
}

export { overlapsRect, PLATFORM_TOP, PLATES, allPlatforms, roadRects }
