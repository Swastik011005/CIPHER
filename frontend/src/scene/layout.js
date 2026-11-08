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

import { DEVICE_SCALE, DEVICE_SPECS, modelKeyFor } from './devices/specs.js'

const S = DEVICE_SCALE // devices are drawn larger (see devices/specs.js): heights inside a rack scale with them
export const SLAB_THICKNESS = 0.3
/** Height of the top surface of a zone slab: where devices stand. */
export const SLAB_TOP = SLAB_THICKNESS
/** Height at which cables run along the slab between devices. */
export const CHANNEL_Y = SLAB_TOP + 0.06

/**
 * Raised platforms. `center` and `size` are [x, z] in plan view.
 * `labelAt` is where the zone caption lies on the slab.
 *
 * The campus is laid out for 31 nodes: the zones stand well apart, joined by the cables (and, in the campus layer, by roads).
 */
export const ZONE_LAYOUT = Object.freeze({
  OUTSIDE: { center: [-50, 0], size: [18, 22], labelAt: [-58, 9], caption: 'OUTSIDE' },
  PERIMETER: { center: [-25.5, 0], size: [17, 10], labelAt: [-33, 4], caption: 'PERIMETER' },
  CORE: { center: [0, 0], size: [8, 8], labelAt: [-3.5, 3], caption: 'CORE' },
  STAFF: { center: [22, -22], size: [26, 18], labelAt: [10, -14], caption: 'STAFF LAN' },
  ADMIN: { center: [48, -22], size: [14, 18], labelAt: [42, -14], caption: 'ADMIN' },
  SECOPS: { center: [-2, 24], size: [34, 18], labelAt: [-18, 32], caption: 'SECURITY OPS' },
  SERVERS: { center: [34, 24], size: [32, 20], labelAt: [19, 33], caption: 'SERVER ROOM' },
})

/** Base plates the slabs stand on. The Outside island is separated from the campus by an air gap. */
export const PLATES = Object.freeze([
  { id: 'campus', center: [14, 2], size: [98, 84], color: 'plate' },
  { id: 'island', center: [-50, 0], size: [24, 28], color: 'plate' },
])

/**
 * Device placement. `y` raises a model above the slab (rack-mounted units), `model` overrides the
 * model chosen from the topology form factor, `labelOffset` moves the floating label.
 */
export const NODE_LAYOUT = Object.freeze({
  INET: { position: [-48, 0], labelOffset: [-1.9 * S, 0 * S, 0 * S] },
  'EXT-USR': { position: [-55, -6] },
  'EXT-ATK': { position: [-55, 6] },
  'R1-EDGE': { position: [-31, 0] },
  FW1: { position: [-20, 0] },
  'CORE-SW1': { position: [0, 0] },
  'ACC-SW2': { position: [11.5, -22] },
  'PC-1': { position: [17, -27] },
  'PC-2': { position: [22, -27] },
  'PC-3': { position: [27, -27] },
  'PC-4': { position: [32, -27] },
  'LAPTOP-1': { position: [17, -17] },
  'PC-5': { position: [22, -17] },
  'PC-6': { position: [27, -17] },
  'PC-7': { position: [32, -17] },
  'ADMIN-PC': { position: [45, -27] },
  'ADMIN-PC-2': { position: [51, -27] },
  'ADMIN-PC-3': { position: [45, -17] },
  'ADMIN-PC-4': { position: [51, -17] },
  'IDS-1': { position: [-14, 22] },
  'SEC-LOG': { position: [-8, 22] },
  'SIEM-1': { position: [-1, 22] },
  'EDR-MGMT-1': { position: [8, 22], y: 1.15 * S, labelOffset: [1.9 * S, 0.55 * S, 0.4 * S] },
  'ZT-POLICY-1': { position: [8, 22], y: 0.65 * S, labelOffset: [0.5 * S, -0.1 * S, 1.9 * S] },
  'IPS-1': { position: [20, 20] },
  'SRV-SW3': { position: [28, 24], y: 1.75 * S, model: 'switch-rack', labelOffset: [0 * S, 0.95 * S, 0 * S] },
  'APP-SRV': { position: [28, 24], y: 1.15 * S, labelOffset: [1.9 * S, 0.55 * S, 0.4 * S] },
  'DB-SRV': { position: [28, 24], y: 0.65 * S, labelOffset: [0.5 * S, -0.1 * S, 1.9 * S] },
  'WEB-SRV': { position: [36, 24], y: 1.15 * S, labelOffset: [1.9 * S, 0.55 * S, 0.4 * S] },
  'DNS-SRV': { position: [36, 24], y: 0.65 * S, labelOffset: [0.5 * S, -0.1 * S, 1.9 * S] },
  'FILE-SRV': { position: [44, 24], y: 1.15 * S, labelOffset: [1.9 * S, 0.55 * S, 0.4 * S] },
})

/** The device model of every node (the topology's form factor, or the layout override). Checked against the topology by the tests. */
export const NODE_FORM = Object.freeze({
  INET: 'internet-cloud', 'EXT-USR': 'laptop', 'EXT-ATK': 'laptop', 'R1-EDGE': 'router', FW1: 'firewall', 'CORE-SW1': 'switch-l3',
  'ACC-SW2': 'switch-l2', 'PC-1': 'desktop', 'PC-2': 'desktop', 'PC-3': 'desktop', 'PC-4': 'desktop', 'LAPTOP-1': 'laptop',
  'PC-5': 'desktop', 'PC-6': 'desktop', 'PC-7': 'desktop', 'ADMIN-PC': 'desktop', 'ADMIN-PC-2': 'desktop', 'ADMIN-PC-3': 'desktop',
  'ADMIN-PC-4': 'desktop', 'IDS-1': 'ids-sensor', 'SEC-LOG': 'soc-console', 'SIEM-1': 'soc-console', 'EDR-MGMT-1': 'rack-server',
  'ZT-POLICY-1': 'rack-server', 'IPS-1': 'ips-appliance', 'SRV-SW3': 'switch-rack', 'APP-SRV': 'rack-server', 'DB-SRV': 'rack-server',
  'WEB-SRV': 'rack-server', 'DNS-SRV': 'rack-server', 'FILE-SRV': 'rack-server',
})

/**
 * The server racks that hold the rack-mounted nodes (decor, not topology nodes). The first is the one that holds SRV-SW3.
 * `holds` names the nodes that stand in each rack.
 */
export const RACKS = Object.freeze([
  { id: 'A', position: [28, 24], size: [1.0 * S, 2.2 * S, 0.9 * S], holds: ['SRV-SW3', 'APP-SRV', 'DB-SRV'] },
  { id: 'B', position: [36, 24], size: [1.0 * S, 2.2 * S, 0.9 * S], holds: ['WEB-SRV', 'DNS-SRV'] },
  { id: 'C', position: [44, 24], size: [1.0 * S, 2.2 * S, 0.9 * S], holds: ['FILE-SRV'] },
  { id: 'D', position: [8, 22], size: [1.0 * S, 2.2 * S, 0.9 * S], holds: ['EDR-MGMT-1', 'ZT-POLICY-1'] },
])
/** The rack of SRV-SW3, APP-SRV and DB-SRV (kept for code that knew a single rack). */
export const RACK = RACKS[0]

/** The perimeter wall that FW1's gate is set into (decor). */
export const PERIMETER_WALL = Object.freeze({ x: -20.2, zFrom: -14, zTo: 14, gateHalf: 1.75 })

/** Roads between the zones (decor, flat on the ground, below the cables): [x0, z0, x1, z1]. They keep clear of every platform. */
export const ROADS = Object.freeze([
  { id: 'avenue', rect: [-16, -9.5, 58, -6.5] }, // the main east-west avenue between the core and the Staff and Admin zones
  { id: 'spine', rect: [13.4, -6.5, 16.2, 13.4] }, // north-south road between the Security Operations and the Server zones
  { id: 'west', rect: [-17, -9.5, -14, 13.4] }, // connects the avenue to the Security Operations building
])

/** Face of a device: the plan position of the point `lat` along the face `side` ('+x' '-x' '+z' '-z'). Used to route cables. */
function facePoint(id, side, lat = 0) {
  const [x, z] = NODE_LAYOUT[id].position
  const [hx, hz] = DEVICE_SPECS[NODE_FORM[id]].half
  if (side === '+x') return [x + hx, z + lat]
  if (side === '-x') return [x - hx, z + lat]
  if (side === '+z') return [x + lat, z + hz]
  return [x + lat, z - hz]
}

/** `n` lateral offsets, `step` apart, centred on zero. */
const spread = (n, step) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step)

const STAFF_PCS = ['PC-1', 'PC-2', 'PC-3', 'PC-4', 'LAPTOP-1', 'PC-5', 'PC-6', 'PC-7']
const STAFF_LINKS = ['L07', 'L08', 'L19', 'L20', 'L09', 'L21', 'L22', 'L23']
const staffLat = spread(8, 0.09)

/** A staff cable: out of ACC-SW2's east face, along its own lane, and into the north or south face of a PC. */
function staffRoute(index) {
  const pc = STAFF_PCS[index]
  const lat = staffLat[index]
  const [ax, az] = facePoint('ACC-SW2', '+x', lat)
  const [bx, bz] = NODE_LAYOUT[pc].position
  return { a: { side: '+x', lateral: lat }, b: { side: az > bz ? '+z' : '-z' }, outA: 0.6, outB: 0.6, via: [[bx, az]] , _ax: ax }
}

/** An administration cable: south out of ACC-SW2, along a lane of the corridor between the PC rows, to a PC's face. */
function adminRoute(index, pc, north) {
  const lat = spread(4, 0.22)[index]
  const lane = -19.3 + index * 0.28
  const [bx] = NODE_LAYOUT[pc].position
  const [ax] = facePoint('ACC-SW2', '+z', lat)
  return { a: { side: '+z', lateral: lat }, b: { side: north ? '-z' : '+z' }, outA: 0.8, outB: 0.7, via: [[ax, lane], [bx, lane]] }
}

/** A Security Operations cable: south out of the core, along a lane of a corridor north of the building, down to a device's north face. */
function socRoute(index, deviceId, bLat = 0) {
  const lat = spread(6, 0.25)[index]
  const lane = 11.2 + index * 0.35
  const [bx] = facePoint(deviceId, '-z', bLat)
  return { a: { side: '+z', lateral: lat }, b: { side: '-z', lateral: bLat }, outA: 1.0, outB: 1.1, via: [[lat, lane], [bx, lane]] }
}

/**
 * Cable routes, keyed by link id. `a`/`b` pick the side of each device the cable leaves from
 * ('+x' '-x' '+z' '-z') and a lateral shift along that face. `outA`/`outB` is how far the cable
 * runs straight out of the port before dropping to the slab. `via` are plan-view waypoints
 * [x, z] (optionally [x, z, y]). `internal` keeps cables at port height (inside the rack).
 * `lift`/`radius` arch a cable over a gap. `lane` offsets the double tube of a trunk.
 */
export const LINK_LAYOUT = Object.freeze({
  L01: { a: { side: '+x' }, b: { side: '-z' }, via: [[-48, -6]] },
  L02: { a: { side: '+x' }, b: { side: '+z' }, via: [[-48, 6]] },
  L03: { a: { side: '+x' }, b: { side: '-x' }, lift: 1.1, radius: 2.2 },
  L04: { a: { side: '+x' }, b: { side: '-x' } },
  L05: { a: { side: '+x' }, b: { side: '-x' }, outB: 1.0 },
  L06: { a: { side: '-z' }, b: { side: '-x' }, outA: 1.2, outB: 0.55, via: [[0, -22]], lane: 0.055 },
  L07: staffRoute(0),
  L08: staffRoute(1),
  L19: staffRoute(2),
  L20: staffRoute(3),
  L09: staffRoute(4),
  L21: staffRoute(5),
  L22: staffRoute(6),
  L23: staffRoute(7),
  L10: adminRoute(0, 'ADMIN-PC', false),
  L24: adminRoute(1, 'ADMIN-PC-2', false),
  L25: adminRoute(2, 'ADMIN-PC-3', true),
  L26: adminRoute(3, 'ADMIN-PC-4', true),
  L11: socRoute(0, 'IDS-1', -0.25),
  L12: socRoute(1, 'IDS-1', 0.25),
  L13: socRoute(2, 'SEC-LOG'),
  L30: socRoute(3, 'SIEM-1'),
  L31: socRoute(4, 'EDR-MGMT-1', 0.05),
  L32: socRoute(5, 'ZT-POLICY-1', -0.05),
  L14: { a: { side: '+x', lateral: -0.2 }, b: { side: '-x', lateral: -0.2 }, outA: 1.0, outB: 0.6, via: [[14, -0.2], [14, 19.8]] },
  L16: { a: { side: '+x', lateral: 0.2 }, b: { side: '-x', lateral: 0.3 }, outA: 1.0, outB: 0.6, via: [[15, 0.2], [15, 20.3]] },
  L15: { a: { side: '+x' }, b: { side: '-x', lateral: -0.3 }, outA: 0.8, outB: 0.6, via: [[22.7, 20], [22.7, 23.7]] },
  L17: { a: { side: '-x', lateral: 0.25 }, b: { side: '-x', lateral: 0.25 }, outA: 0.3, outB: 0.3, internal: true },
  L18: { a: { side: '-x', lateral: 0.0 }, b: { side: '-x', lateral: 0.0 }, outA: 0.55, outB: 0.55, internal: true },
  L27: { a: { side: '+x', lateral: -0.2 }, b: { side: '-x' }, outA: 0.8, outB: 0.6 },
  L28: { a: { side: '+x', lateral: 0.2 }, b: { side: '-x' }, outA: 1.0, outB: 0.6, via: [[31.5, 26.2], [33, 26.2], [33, 24.2]] },
  L29: { a: { side: '+x', lateral: 0.0 }, b: { side: '+z' }, outA: 1.2, outB: 0.9, via: [[31, 27.5], [44, 27.5]] },
})

/** Camera presets: look at `target` from a given azimuth/elevation (degrees) and distance. */
export const CAMERA_PRESETS = Object.freeze([
  { id: 'overview', label: 'Overview', target: [14, 0, 10], azimuth: 45, elevation: 43, distance: 160 },
  { id: 'perimeter', label: 'Perimeter', target: [-26, 0.6, 0], azimuth: 38, elevation: 36, distance: 42 },
  { id: 'staff', label: 'Staff LAN', target: [24, 0.6, -22], azimuth: 42, elevation: 38, distance: 52 },
  { id: 'core', label: 'Core', target: [2, 0.4, 6], azimuth: 40, elevation: 38, distance: 44 },
  { id: 'servers', label: 'Server Room', target: [32, 1.0, 22], azimuth: 52, elevation: 33, distance: 46 },
  { id: 'secops', label: 'Security Ops', target: [-2, 0.4, 24], azimuth: 30, elevation: 40, distance: 48 },
])

export const DEFAULT_PRESET_ID = 'overview'

/** Keep the camera target over the campus. [min, max] corners of the allowed target box. */
export const CAMERA_BOUNDARY = Object.freeze({ min: [-70, -1, -50], max: [75, 8, 56] })

export const CAMERA_LIMITS = Object.freeze({
  minDistance: 9,
  maxDistance: 210,
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
