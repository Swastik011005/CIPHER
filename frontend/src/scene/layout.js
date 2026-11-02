/**
 * Scene layout: where things stand in the 3D world.
 *
 * The network itself (nodes, links, zones, VLANs, addresses) comes from the backend topology.
 * This file only adds presentation: positions, zone slab sizes, cable routes and camera presets,
 * all keyed by topology ids. `validateLayout` checks the two stay in step, so a topology change
 * that is not reflected here is reported instead of silently drawn wrong.
 *
 * Units are about one metre. x runs east, z runs south, y is up. Camera looks from +x,+z.
 */

import { DEVICE_SPECS, modelKeyFor } from './devices/specs.js'

export const SLAB_THICKNESS = 0.3
/** Height of the top surface of a zone slab: where devices stand. */
export const SLAB_TOP = SLAB_THICKNESS
/** Height at which cables run along the slab between devices. */
export const CHANNEL_Y = SLAB_TOP + 0.06

/**
 * Raised platforms. `center` and `size` are [x, z] in plan view.
 * `labelAt` is where the zone caption lies on the slab.
 */
export const ZONE_LAYOUT = Object.freeze({
  OUTSIDE: { center: [-18.1, 0], size: [6.2, 14], labelAt: [-20.2, 6.0], caption: 'OUTSIDE' },
  PERIMETER: { center: [-9.5, 0], size: [5.5, 18], labelAt: [-11.3, 8.2], caption: 'PERIMETER' },
  CORE: { center: [0, 0], size: [6, 6], labelAt: [-2.2, 2.4], caption: 'CORE' },
  STAFF: { center: [10.5, -8.5], size: [9, 9], labelAt: [7.0, -5.0], caption: 'STAFF LAN' },
  ADMIN: { center: [18.2, -8.5], size: [4.6, 9], labelAt: [16.7, -5.0], caption: 'ADMIN' },
  SECOPS: { center: [0, 9.5], size: [10, 7], labelAt: [-4.2, 12.2], caption: 'SECURITY OPS' },
  SERVERS: { center: [14, 7], size: [12, 10], labelAt: [9.2, 11.4], caption: 'SERVER ROOM' },
})

/** Base plates the slabs stand on. The Outside island is separated from the campus by an air gap. */
export const PLATES = Object.freeze([
  { id: 'campus', center: [4.4, 0], size: [35.2, 30], color: 'plate' },
  { id: 'island', center: [-18.25, 0], size: [7.5, 18], color: 'plate' },
])

/**
 * Device placement. `y` raises a model above the slab (rack-mounted units), `model` overrides the
 * model chosen from the topology form factor, `labelOffset` moves the floating label.
 */
export const NODE_LAYOUT = Object.freeze({
  INET: { position: [-16.2, 0], labelOffset: [-1.9, 0, 0] },
  'EXT-USR': { position: [-19.0, -3.0] },
  'EXT-ATK': { position: [-19.0, 3.0] },
  'R1-EDGE': { position: [-10.5, 0] },
  FW1: { position: [-7.2, 0] },
  'CORE-SW1': { position: [0, 0] },
  'ACC-SW2': { position: [7.5, -8.0] },
  'PC-1': { position: [11.0, -11.0] },
  'PC-2': { position: [14.5, -11.0] },
  'LAPTOP-1': { position: [11.0, -6.5] },
  'ADMIN-PC': { position: [18.2, -8.0] },
  'IDS-1': { position: [-2.0, 9.5] },
  'SEC-LOG': { position: [2.5, 9.5] },
  'IPS-1': { position: [9.2, 6.0] },
  'SRV-SW3': { position: [14.5, 7.0], y: 1.75, model: 'switch-rack', labelOffset: [0, 0.95, 0] },
  'APP-SRV': { position: [14.5, 7.0], y: 1.15, labelOffset: [1.9, 0.55, 0.4] },
  'DB-SRV': { position: [14.5, 7.0], y: 0.65, labelOffset: [0.5, -0.1, 1.9] },
})

/** The server rack the three rack-mounted nodes share (decor, not a topology node). */
export const RACK = Object.freeze({ position: [14.5, 7.0], size: [1.0, 2.2, 0.9] })

/** The perimeter wall that FW1's gate is set into (decor). */
export const PERIMETER_WALL = Object.freeze({ x: -7.2, zFrom: -8.4, zTo: 8.4, gateHalf: 1.75 })

/** Glass partition around the server room (decor). The IPS stands in the doorway. */
export const SERVER_PARTITION = Object.freeze({
  x: 8.0,
  z: 2.0,
  zTo: 12.0,
  xTo: 20.0,
  doorFrom: 4.7,
  doorTo: 7.3,
  height: 1.7,
})

/**
 * Cable routes, keyed by link id. `a`/`b` pick the side of each device the cable leaves from
 * ('+x' '-x' '+z' '-z') and a lateral shift along that face. `outA`/`outB` is how far the cable
 * runs straight out of the port before dropping to the slab. `via` are plan-view waypoints
 * [x, z] (optionally [x, z, y]). `internal` keeps cables at port height (inside the rack).
 * `lift`/`radius` arch a cable over a gap. `lane` offsets the double tube of a trunk.
 */
export const LINK_LAYOUT = Object.freeze({
  L01: { a: { side: '+x' }, b: { side: '-z' }, via: [[-16.2, -3.0]] },
  L02: { a: { side: '+x' }, b: { side: '+z' }, via: [[-16.2, 3.0]] },
  L03: { a: { side: '+x' }, b: { side: '-x' }, lift: 1.1, radius: 2.2 },
  L04: { a: { side: '+x' }, b: { side: '-x' } },
  L05: { a: { side: '+x' }, b: { side: '-x' }, outB: 1.0 },
  L06: { a: { side: '-z' }, b: { side: '-x' }, outA: 1.2, outB: 0.55, via: [[0, -8.0]], lane: 0.055 },
  L07: { a: { side: '+x', lateral: -0.35 }, b: { side: '-x' }, outA: 0.6, outB: 0.4, via: [[8.6, -11.0]] },
  L08: { a: { side: '+x', lateral: -0.15 }, b: { side: '-x' }, outA: 1.4, outB: 0.45, via: [[12.75, -8.15], [12.75, -11.0]] },
  L09: { a: { side: '+x', lateral: 0.3 }, b: { side: '-x' }, outA: 1.3, outB: 0.5, via: [[9.3, -6.5]] },
  L10: { a: { side: '+x', lateral: 0.05 }, b: { side: '-x', lateral: 0.05 } },
  L11: { a: { side: '+z', lateral: -0.65 }, b: { side: '-z', lateral: -0.25 }, outA: 1.2, outB: 0.6, via: [[-0.65, 5.0], [-2.25, 5.0]] },
  L12: { a: { side: '+z', lateral: -0.2 }, b: { side: '-z', lateral: 0.25 }, outA: 1.2, outB: 0.6, via: [[-0.2, 5.6], [-1.75, 5.6]] },
  L13: { a: { side: '+z', lateral: 0.4 }, b: { side: '-z' }, outA: 1.2, outB: 0.6, via: [[0.4, 6.2], [2.5, 6.2]] },
  L14: { a: { side: '+x', lateral: -0.2 }, b: { side: '-x' }, outA: 1.0, outB: 0.6, via: [[4.5, -0.2], [4.5, 6.0]] },
  L15: { a: { side: '+x' }, b: { side: '-x', lateral: -0.3 }, outA: 0.8, outB: 0.6, via: [[13.45, 6.0]] },
  L16: { a: { side: '+x', lateral: 0.2 }, b: { side: '+z' }, outA: 1.0, outB: 1.1, via: [[4.0, 0.2], [4.0, 8.3]] },
  L17: { a: { side: '-x', lateral: 0.25 }, b: { side: '-x', lateral: 0.25 }, outA: 0.3, outB: 0.3, internal: true },
  L18: { a: { side: '-x', lateral: 0.0 }, b: { side: '-x', lateral: 0.0 }, outA: 0.55, outB: 0.55, internal: true },
})

/** Camera presets: look at `target` from a given azimuth/elevation (degrees) and distance. */
export const CAMERA_PRESETS = Object.freeze([
  { id: 'overview', label: 'Overview', target: [2, 0, 0.5], azimuth: 45, elevation: 40, distance: 58 },
  { id: 'perimeter', label: 'Perimeter', target: [-11, 0.6, 0], azimuth: 38, elevation: 36, distance: 26 },
  { id: 'staff', label: 'Staff LAN', target: [13.5, 0.6, -8.5], azimuth: 42, elevation: 38, distance: 28 },
  { id: 'core', label: 'Core', target: [1, 0.4, 3.5], azimuth: 40, elevation: 38, distance: 24 },
  { id: 'servers', label: 'Server Room', target: [13, 1.0, 6.5], azimuth: 52, elevation: 33, distance: 24 },
  { id: 'secops', label: 'Security Ops', target: [0, 0.4, 9.5], azimuth: 30, elevation: 40, distance: 22 },
])

export const DEFAULT_PRESET_ID = 'overview'

/** Keep the camera target over the campus. [min, max] corners of the allowed target box. */
export const CAMERA_BOUNDARY = Object.freeze({ min: [-26, -1, -18], max: [26, 8, 18] })

export const CAMERA_LIMITS = Object.freeze({
  minDistance: 9,
  maxDistance: 125,
  minPolarAngle: (20 * Math.PI) / 180,
  maxPolarAngle: (72 * Math.PI) / 180,
})

/** Canvas aspect ratio (width / height) the preset distances are tuned for. */
export const REFERENCE_ASPECT = 1.6

/**
 * How far to pull the camera back so a preset still fits a canvas narrower than the reference
 * aspect. The field of view is vertical, so a narrow canvas sees less width at the same distance.
 * @param {number} aspect  Canvas width / height.
 */
export function distanceScaleForAspect(aspect) {
  return aspect > 0 ? Math.max(1, REFERENCE_ASPECT / aspect) : 1
}

/**
 * Camera position for a preset.
 * @param {{target: number[], azimuth: number, elevation: number, distance: number}} preset
 * @param {number} [distanceScale]  See distanceScaleForAspect.
 * @returns {[number, number, number]}
 */
export function presetPosition({ target, azimuth, elevation, distance: baseDistance }, distanceScale = 1) {
  const distance = Math.min(baseDistance * distanceScale, CAMERA_LIMITS.maxDistance)
  const az = (azimuth * Math.PI) / 180
  const el = (elevation * Math.PI) / 180
  return [
    target[0] + distance * Math.sin(az) * Math.cos(el),
    target[1] + distance * Math.sin(el),
    target[2] + distance * Math.cos(az) * Math.cos(el),
  ]
}

/**
 * Check the layout covers the topology exactly. Returns human-readable problems (empty = fine).
 * @param {{nodes: {id: string, zone: string, form_factor: string}[], links: {id: string}[], zones: {id: string}[]}} topology
 * @returns {string[]}
 */
export function validateLayout(topology) {
  const problems = []
  const nodeIds = new Set(topology.nodes.map((n) => n.id))
  const linkIds = new Set(topology.links.map((l) => l.id))
  const zoneIds = new Set(topology.zones.map((z) => z.id))

  for (const node of topology.nodes) {
    const layout = NODE_LAYOUT[node.id]
    if (!layout) problems.push(`no scene position for node ${node.id}`)
    else if (!DEVICE_SPECS[modelKeyFor(node, layout)]) {
      problems.push(`no device model for ${node.id} (${modelKeyFor(node, layout)})`)
    }
  }
  for (const link of topology.links) {
    if (!LINK_LAYOUT[link.id]) problems.push(`no cable route for link ${link.id}`)
  }
  for (const zone of topology.zones) {
    if (!ZONE_LAYOUT[zone.id]) problems.push(`no slab for zone ${zone.id}`)
  }
  for (const id of Object.keys(NODE_LAYOUT)) {
    if (!nodeIds.has(id)) problems.push(`scene positions unknown node ${id}`)
  }
  for (const id of Object.keys(LINK_LAYOUT)) {
    if (!linkIds.has(id)) problems.push(`scene routes unknown link ${id}`)
  }
  for (const id of Object.keys(ZONE_LAYOUT)) {
    if (!zoneIds.has(id)) problems.push(`scene has a slab for unknown zone ${id}`)
  }
  return problems
}
