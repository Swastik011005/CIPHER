/**
 * The REVISED Smart Campus proposal (C1, revision 2) as data, plus the geometry helpers the checks and drawings share.
 *
 * Requirements this encodes: no trees or vegetation, no roads, one continuous ground, single-level transparent glass
 * pavilions on slightly raised platforms, every existing device visible inside its structure, no roof that can hide a device.
 *
 * Nothing here is used by the application. It imports the REAL layout (zones, device positions and footprints, cable routes,
 * camera presets) and the real topology, and `generate.mjs` checks the proposal against them. Units are the scene's
 * (about one metre); x runs east, z runs south, y is up. The default camera looks from the south-east.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const load = (p) => import(pathToFileURL(join(root, 'frontend', 'src', p)).href)

export const layout = await load('scene/layout.js')
export const { DEVICE_SPECS, modelKeyFor } = await load('scene/devices/specs.js')
const { buildCablePoints } = await load('scene/links/cablePoints.js')
export const topology = JSON.parse(readFileSync(join(root, 'backend', 'config', 'topology.json'), 'utf8'))
export const { ZONE_LAYOUT, NODE_LAYOUT, LINK_LAYOUT, PLATES, RACK, PERIMETER_WALL, CAMERA_PRESETS, presetPosition, SLAB_TOP } = layout

// ---- geometry helpers. A rect is {x0, z0, x1, z1}. -------------------------------------------------------------
export const rect = ([x0, z0, x1, z1]) => ({ x0, z0, x1, z1 })
export const inflate = (r, m) => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m })
export const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0))
export const inside = (inner, outer, m = 0, eps = 1e-6) => inner.x0 >= outer.x0 + m - eps && inner.x1 <= outer.x1 - m + eps && inner.z0 >= outer.z0 + m - eps && inner.z1 <= outer.z1 - m + eps
export const pointIn = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1
/** Gap between two rects (0 when they touch or overlap). */
export const gap = (a, b) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.z0 - b.z1, b.z0 - a.z1))

export function distToSeg(p, a, b) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

/** Where the segment a-b crosses the outline of a rect: [{edge: 'N'|'S'|'W'|'E', x, z}]. */
export function crossings(a, b, r) {
  const out = []
  for (const [edge, zc] of [['N', r.z0], ['S', r.z1]]) {
    if ((a[1] - zc) * (b[1] - zc) < 0) {
      const x = a[0] + ((zc - a[1]) / (b[1] - a[1])) * (b[0] - a[0])
      if (x >= r.x0 && x <= r.x1) out.push({ edge, x, z: zc })
    }
  }
  for (const [edge, xc] of [['W', r.x0], ['E', r.x1]]) {
    if ((a[0] - xc) * (b[0] - xc) < 0) {
      const z = a[1] + ((xc - a[0]) / (b[0] - a[0])) * (b[1] - a[1])
      if (z >= r.z0 && z <= r.z1) out.push({ edge, x: xc, z })
    }
  }
  return out
}

// ---- what already exists (read from the real code) ---------------------------------------------------------------
const nodesById = new Map(topology.nodes.map((n) => [n.id, n]))
const plateRect = (p) => rect([p.center[0] - p.size[0] / 2, p.center[1] - p.size[1] / 2, p.center[0] + p.size[0] / 2, p.center[1] + p.size[1] / 2])

export const existing = {
  campusPlate: plateRect(PLATES.find((p) => p.id === 'campus')),
  island: plateRect(PLATES.find((p) => p.id === 'island')),
  slabs: Object.fromEntries(Object.entries(ZONE_LAYOUT).map(([id, z]) => [id, rect([z.center[0] - z.size[0] / 2, z.center[1] - z.size[1] / 2, z.center[0] + z.size[0] / 2, z.center[1] + z.size[1] / 2])])),
  devices: topology.nodes
    .filter((n) => NODE_LAYOUT[n.id])
    .map((n) => {
      const lay = NODE_LAYOUT[n.id]
      const spec = DEVICE_SPECS[modelKeyFor(n, lay)]
      const [x, z] = lay.position
      return { id: n.id, topologyZone: n.zone, type: n.type, x, z, rect: rect([x - spec.half[0], z - spec.half[1], x + spec.half[0], z + spec.half[1]]), base: SLAB_TOP + (lay.y ?? 0), top: SLAB_TOP + (lay.y ?? 0) + spec.height }
    }),
  cables: topology.links
    .filter((l) => LINK_LAYOUT[l.id])
    .map((l) => ({ id: l.id, kind: l.kind, points: buildCablePoints(l, nodesById).map(([x, y, z]) => [x, z, y]) })),
  wall: PERIMETER_WALL,
  rack: rect([RACK.position[0] - RACK.size[0] / 2, RACK.position[1] - RACK.size[2] / 2, RACK.position[0] + RACK.size[0] / 2, RACK.position[1] + RACK.size[2] / 2]),
}
export const cableSegments = existing.cables.flatMap((c) => c.points.slice(1).map((p, i) => [[c.points[i][0], c.points[i][1]], [p[0], p[1]], c.id]))

// ---- the proposal -----------------------------------------------------------------------------------------------

/**
 * The campus plate does NOT grow: nothing needs more room once buildings are compact, single-level and roads are gone.
 * Platforms rise 0.3 above the ground plane (the height the zone slabs already have), so no device or cable moves.
 */
export const PLATFORM_TOP = SLAB_TOP
export const STRUCTURE_HEIGHT = 3.0

/** What a visitor can select. Exactly the mapping in the brief; every one of the 17 nodes is in exactly one zone. */
export const ZONES = [
  { id: 'staff', name: 'Staff and Academic', network: 'Staff LAN, VLAN 10 (10.0.10.0/24)', devices: ['PC-1', 'PC-2', 'LAPTOP-1', 'ACC-SW2'], accent: '#4da3ff', purpose: 'Staff offices and labs. Three workstations reach the network through the access switch ACC-SW2.' },
  { id: 'admin', name: 'Administration', network: 'Admin LAN, VLAN 20 (10.0.20.0/24)', devices: ['ADMIN-PC'], accent: '#7aa2ff', purpose: 'University administration. ADMIN-PC is the one host allowed to reach the database.' },
  { id: 'datacentre', name: 'Data Centre', network: 'Servers, VLAN 30 (10.0.30.0/24)', devices: ['APP-SRV', 'DB-SRV', 'SRV-SW3'], accent: '#38d6e6', purpose: 'The application and database servers and their top-of-rack switch.' },
  { id: 'soc', name: 'Security Operations', network: 'Security, VLAN 99 (10.0.99.0/24)', devices: ['IDS-1', 'IPS-1', 'SEC-LOG'], accent: '#a78bfa', purpose: 'The passive IDS, the syslog console, and the inline IPS that guards the data centre door.' },
  { id: 'core', name: 'Core Network Hub', network: 'Layer 3 core: SVIs for VLANs 10, 20, 30, 99', devices: ['CORE-SW1'], accent: '#2fb6a8', purpose: 'The core switch: routes between VLANs, applies the Staff ACL and mirrors traffic to IDS-1.' },
  { id: 'gate', name: 'Main Gate and Edge', network: 'Perimeter, 10.255.0.0/30 and 10.255.1.0/30', devices: ['R1-EDGE', 'FW1'], accent: '#2fb6a8', purpose: 'The edge router and the stateful firewall in the gate: the only way in from the Internet.' },
  { id: 'offcampus', name: 'Public Internet (off campus)', network: 'Outside, 203.0.113.0/24', devices: ['INET', 'EXT-USR', 'EXT-ATK'], accent: '#8aa0c8', purpose: 'Everything beyond the campus: a legitimate user, a simulated attacker and the abstract Internet.' },
]

/**
 * Structures. Each is one level, 3.0 high, a slim steel frame (corner and intermediate posts, a ring beam at the top) and NO
 * roof. `glass` lists the sides that carry a glass panel: the two sides AWAY from the default camera (north and west). The
 * other two sides (south and east, towards the camera) are open: nothing stands between the camera and the devices.
 * `margin` is how far the raised platform extends beyond the frame.
 */
const RAW = [
  { id: 'staff', zone: 'staff', name: 'Staff and Academic pavilion', r: rect([6.4, -12.2, 15.8, -5.3]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25 },
  { id: 'admin', zone: 'admin', name: 'Administration pavilion', r: rect([17.0, -10.6, 20.0, -5.4]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25 },
  { id: 'datacentre', zone: 'datacentre', name: 'Data Centre pavilion', r: rect([12.3, 4.9, 16.7, 9.0]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25 },
  { id: 'soc', zone: 'soc', name: 'Operations pavilion', r: rect([-3.2, 7.6, 3.68, 11.0]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.12 },
  { id: 'ips-gate', zone: 'soc', name: 'Inline security gate pavilion (IPS-1)', r: rect([8.3, 4.4, 10.1, 7.6]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25 },
  { id: 'edge', zone: 'gate', name: 'Edge router pavilion (R1-EDGE)', r: rect([-11.6, -1.3, -9.4, 1.3]), h: 2.2, glass: ['N', 'W'], margin: 0.2 },
]
export const STRUCTURES = RAW.map((s) => ({ ...s, platform: inflate(s.r, s.margin) }))

/** Round open pavilion over the core switch: platform, eight columns, a thin ring beam, no roof. */
export const CANOPY = { id: 'core', zone: 'core', name: 'Core hub', center: [0, 0], platformRadius: 3.6, columnRadius: 2.9, columns: 8, phase: 22.5, h: STRUCTURE_HEIGHT }
export const canopyColumns = Array.from({ length: CANOPY.columns }, (_, i) => {
  const a = ((CANOPY.phase + (360 / CANOPY.columns) * i) * Math.PI) / 180
  return [CANOPY.center[0] + CANOPY.columnRadius * Math.cos(a), CANOPY.center[1] + CANOPY.columnRadius * Math.sin(a)]
})

/** Platforms with no structure of their own. The gate court carries the FW1 gate model and the edge pavilion; the island is off campus. */
export const OPEN_PLATFORMS = [
  { id: 'gate-court', zone: 'gate', name: 'Main gate court', platform: rect([-12.0, -2.4, -6.4, 2.4]) },
  { id: 'island', zone: 'offcampus', name: 'Public Internet platform', platform: existing.slabs.OUTSIDE },
]

/** Which platform each device stands on (the device's structure, or for FW1 the gate court). */
export const HOLDS = { staff: ['PC-1', 'PC-2', 'LAPTOP-1', 'ACC-SW2'], admin: ['ADMIN-PC'], datacentre: ['APP-SRV', 'DB-SRV', 'SRV-SW3'], soc: ['IDS-1', 'SEC-LOG'], 'ips-gate': ['IPS-1'], edge: ['R1-EDGE'] }

/** The user-approved mapping of zones to devices: the checks fail if the proposal ever departs from it. */
export const REQUIRED_MAPPING = { staff: ['PC-1', 'PC-2', 'LAPTOP-1', 'ACC-SW2'], admin: ['ADMIN-PC'], datacentre: ['APP-SRV', 'DB-SRV', 'SRV-SW3'], soc: ['IDS-1', 'IPS-1', 'SEC-LOG'] }

/** Every platform of the proposal, for spacing checks. */
export const ALL_PLATFORMS = [
  ...STRUCTURES.filter((s) => s.id !== 'edge').map((s) => ({ id: s.id, rect: s.platform })),
  { id: 'core', rect: rect([-CANOPY.platformRadius, -CANOPY.platformRadius, CANOPY.platformRadius, CANOPY.platformRadius]) },
  ...OPEN_PLATFORMS.filter((p) => p.id !== 'island').map((p) => ({ id: p.id, rect: p.platform })),
]
