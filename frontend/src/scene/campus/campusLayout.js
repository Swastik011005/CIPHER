/**
 * The Smart Campus layer: where the raised platforms, the glass-and-steel pavilions and the signs stand, and which campus
 * zone holds which devices. Pure data and geometry, no three.js, so it is cheap to test.
 *
 * This is PRESENTATION only. It is separate from the logical layout (`scene/layout.js`: zone rectangles, device positions,
 * cable routes), which it reads but never changes: no device and no cable moves. Campus zones are not topology nodes.
 *
 * Design (docs/design/CAMPUS_DESIGN_C1.md): one continuous ground; compact single-level pavilions on platforms 0.3 high;
 * glass on the two sides behind the devices as seen from the default camera (north and west), the other two sides open,
 * no roof; an L-shaped steel frame with no post at the south-east corner. Units are about one metre; x east, z south, y up.
 */
import { DEVICE_SPECS, modelKeyFor } from '../devices/specs.js'
import { LINK_LAYOUT, NODE_LAYOUT, PERIMETER_WALL, RACKS, ROADS, SLAB_TOP, ZONE_LAYOUT } from '../layout.js'
import { buildCablePoints } from '../links/cablePoints.js'

/** Top of every platform: the height the zone slabs always had, so devices and cables stay exactly where they were. */
export const PLATFORM_TOP = SLAB_TOP
/** Top of the lower plinth step under each platform. */
export const PLINTH_TOP = 0.12
/** Height of a pavilion's frame above its platform. Every structure is single-level. */
export const STRUCTURE_HEIGHT = 4.4
/** Half the width of a frame post or beam. */
export const FRAME_HALF = 0.05

const rect = ([x0, z0, x1, z1]) => ({ x0, z0, x1, z1 })
export const inflate = (r, m) => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m })

/**
 * What a visitor can select, and which existing devices each zone holds. Every one of the 17 topology nodes is in exactly one
 * zone; no device is invented or duplicated. `topologyZone` is the zone of the logical layout the campus zone presents.
 */
export const CAMPUS_ZONES = Object.freeze([
  { id: 'staff', name: 'Staff and Academic', topologyZone: 'STAFF', devices: ['PC-1', 'PC-2', 'LAPTOP-1', 'ACC-SW2', 'PC-3', 'PC-4', 'PC-5', 'PC-6', 'PC-7'], accent: '#4da3ff' },
  { id: 'admin', name: 'Administration', topologyZone: 'ADMIN', devices: ['ADMIN-PC', 'ADMIN-PC-2', 'ADMIN-PC-3', 'ADMIN-PC-4'], accent: '#7aa2ff' },
  { id: 'datacentre', name: 'Data Centre', topologyZone: 'SERVERS', devices: ['APP-SRV', 'DB-SRV', 'SRV-SW3', 'WEB-SRV', 'DNS-SRV', 'FILE-SRV'], accent: '#38d6e6' },
  { id: 'soc', name: 'Security Operations', topologyZone: 'SECOPS', devices: ['IDS-1', 'IPS-1', 'SEC-LOG', 'SIEM-1', 'EDR-MGMT-1', 'ZT-POLICY-1'], accent: '#a78bfa' },
  { id: 'core', name: 'Core Network Hub', topologyZone: 'CORE', devices: ['CORE-SW1'], accent: '#2fb6a8' },
  { id: 'gate', name: 'Main Gate and Edge', topologyZone: 'PERIMETER', devices: ['R1-EDGE', 'FW1'], accent: '#2fb6a8' },
  { id: 'offcampus', name: 'Public Internet', topologyZone: 'OUTSIDE', devices: ['INET', 'EXT-USR', 'EXT-ATK'], accent: '#8aa0c8' },
])

/**
 * Pavilions. `r` is the frame footprint, `glass` the sides that carry glass, `margin` how far the platform extends beyond
 * the frame. `holds` lists the devices that stand inside (checked by the tests).
 */
export const STRUCTURES = Object.freeze([
  { id: 'staff', zone: 'staff', r: rect([2, -24, 26, -8]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25, holds: ['PC-1', 'PC-2', 'PC-3', 'PC-4', 'LAPTOP-1', 'PC-5', 'PC-6', 'PC-7', 'ACC-SW2'] },
  { id: 'admin', zone: 'admin', r: rect([30, -24, 42, -8]), h: 6.2, glass: ['N', 'W'], margin: 0.25, holds: ['ADMIN-PC', 'ADMIN-PC-2', 'ADMIN-PC-3', 'ADMIN-PC-4'] },
  { id: 'datacentre', zone: 'datacentre', r: rect([21, 9, 47, 27]), h: 5.2, glass: ['N', 'W'], margin: 0.25, holds: ['APP-SRV', 'DB-SRV', 'SRV-SW3', 'WEB-SRV', 'DNS-SRV', 'FILE-SRV'] },
  { id: 'soc', zone: 'soc', r: rect([-21, 9, 10, 25]), h: 4.8, glass: ['N', 'W'], margin: 0.12, holds: ['IDS-1', 'SEC-LOG', 'SIEM-1', 'EDR-MGMT-1', 'ZT-POLICY-1'] },
  { id: 'ips-gate', zone: 'soc', r: rect([15.4, 10.8, 18.6, 17.2]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25, holds: ['IPS-1'] },
  { id: 'reception', zone: 'gate', r: rect([-25, -17, -16, -10.5]), h: 3.4, glass: ['N', 'W'], margin: 0.25, holds: [] }, // the visitor reception at the gate: a pavilion with no device
  { id: 'edge', zone: 'gate', r: rect([-25, -3, -19, 3]), h: 3.2, glass: ['N', 'W'], margin: 0.2, holds: ['R1-EDGE'], onCourt: true },
])

/** The round open pavilion over the core switch: a platform, eight columns and a thin ring beam. No roof. */
export const CORE_PAVILION = Object.freeze({ id: 'core', zone: 'core', center: [0, 0], platformRadius: 3.6, columnRadius: 2.9, columns: 8, phase: 22.5, h: STRUCTURE_HEIGHT, holds: ['CORE-SW1'] })

/** Platforms with no frame of their own: the gate court (FW1 is its own gate model) and the off-campus island. */
export const GATE_COURT = Object.freeze({ id: 'gate-court', zone: 'gate', platform: rect([-25, -5, -8, 5]), holds: ['FW1'] })
const slab = (id) => {
  const z = ZONE_LAYOUT[id]
  return rect([z.center[0] - z.size[0] / 2, z.center[1] - z.size[1] / 2, z.center[0] + z.size[0] / 2, z.center[1] + z.size[1] / 2])
}
export const ISLAND = Object.freeze({ id: 'island', zone: 'offcampus', platform: slab('OUTSIDE'), holds: ['INET', 'EXT-USR', 'EXT-ATK'] })

/** Raised signs: a small tilted plaque on the ground in front of a platform, facing the default camera. */
export const SIGNS = Object.freeze([
  { zone: 'staff', x: 9.0, z: -5.4, w: 5.0 },
  { zone: 'admin', x: 40.5, z: -5.4, w: 4.4 },
  { zone: 'datacentre', x: 31.0, z: 29.2, w: 5.0 },
  { zone: 'soc', x: -5.0, z: 27.2, w: 6.0 },
  { zone: 'core', x: -5.4, z: 3.8, w: 3.2 },
  { zone: 'gate', x: -20.0, z: -8.0, w: 4.6 },
  { zone: 'offcampus', x: -42.0, z: 13.2, w: 4.6 },
])

/** The low glass balustrade that replaces the opaque perimeter wall (same line, with the gate gap). */
export const BALUSTRADE = Object.freeze({ x: PERIMETER_WALL.x, spans: [[PERIMETER_WALL.zFrom, -PERIMETER_WALL.gateHalf], [PERIMETER_WALL.gateHalf, PERIMETER_WALL.zTo]], height: 0.9 })

export const platformOf = (s) => inflate(s.r, s.margin)

/** The platforms as rectangles (the core's is round: its bounding square), for spacing checks. */
export function allPlatforms() {
  const c = CORE_PAVILION
  return [
    ...STRUCTURES.filter((s) => !s.onCourt).map((s) => ({ id: s.id, zone: s.zone, rect: platformOf(s) })),
    { id: c.id, zone: c.zone, round: true, rect: rect([c.center[0] - c.platformRadius, c.center[1] - c.platformRadius, c.center[0] + c.platformRadius, c.center[1] + c.platformRadius]) },
    { id: GATE_COURT.id, zone: GATE_COURT.zone, rect: GATE_COURT.platform },
    { id: ISLAND.id, zone: ISLAND.zone, rect: ISLAND.platform },
  ]
}

/** Where a segment a-b crosses the outline of a rect: [{edge: 'N'|'S'|'W'|'E', x, z}]. */
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

/** Every cable as plan-view segments: [{link, a: [x, z], b: [x, z]}], from the real cable routes. */
export function cableSegments(topology) {
  const nodesById = new Map(topology.nodes.map((n) => [n.id, n]))
  return topology.links
    .filter((l) => LINK_LAYOUT[l.id])
    .flatMap((l) => {
      const pts = buildCablePoints(l, nodesById)
      return pts.slice(1).map((p, i) => ({ link: l.id, a: [pts[i][0], pts[i][2]], b: [p[0], p[2]] }))
    })
}

const middle = (a, b) => Array.from({ length: Math.max(0, Math.ceil((b - a) / 3.2) - 1) }, (_, i) => a + ((i + 1) * (b - a)) / Math.ceil((b - a) / 3.2))

/**
 * Frame posts, beams, glass panes and cable openings for every pavilion, computed from the real cable routes.
 *
 * A cable that meets a glass side passes through an opening that spans all the cables sharing it (0.5 clear on each side) and
 * is framed by two slim posts. The open sides (south, east) carry no beam and no intermediate post; the south-east corner has no
 * post at all (an L-shaped frame), so nothing stands between the default camera and the devices.
 * @param {{nodes: any[], links: any[]}} topology
 */
export function campusGeometry(topology) {
  const segments = cableSegments(topology)
  const structures = STRUCTURES.map((s) => {
    const raw = []
    for (const { a, b, link } of segments) {
      for (const c of crossings(a, b, s.r)) {
        if (!s.glass.includes(c.edge)) continue
        const u = c.edge === 'N' ? c.x : c.z
        const same = raw.find((o) => o.edge === c.edge && u > o.u0 - 1.4 && u < o.u1 + 1.4)
        if (same) {
          same.u0 = Math.min(same.u0, u)
          same.u1 = Math.max(same.u1, u)
          same.links.add(link)
        } else raw.push({ edge: c.edge, u0: u, u1: u, links: new Set([link]) })
      }
    }
    const openings = raw.map((o) => ({ edge: o.edge, u0: +(o.u0 - 0.5).toFixed(3), u1: +(o.u1 + 0.5).toFixed(3), links: [...o.links].sort() }))
    const near = (edge, u) => openings.some((o) => o.edge === edge && u > o.u0 - 0.9 && u < o.u1 + 0.9)

    const posts = [[s.r.x0, s.r.z0], [s.r.x1, s.r.z0], [s.r.x0, s.r.z1]].map(([x, z]) => ({ x, z }))
    if (s.glass.includes('N')) for (const x of middle(s.r.x0, s.r.x1)) if (!near('N', x)) posts.push({ x, z: s.r.z0 })
    if (s.glass.includes('W')) for (const z of middle(s.r.z0, s.r.z1)) if (!near('W', z)) posts.push({ x: s.r.x0, z })
    for (const o of openings) for (const u of [o.u0, o.u1]) posts.push(o.edge === 'N' ? { x: u, z: s.r.z0 } : { x: s.r.x0, z: u })

    const beams = [{ side: 'N', x0: s.r.x0, x1: s.r.x1, z0: s.r.z0, z1: s.r.z0 }, { side: 'W', x0: s.r.x0, x1: s.r.x0, z0: s.r.z0, z1: s.r.z1 }]

    const panes = []
    for (const edge of s.glass) {
      const [from, to] = edge === 'N' ? [s.r.x0, s.r.x1] : [s.r.z0, s.r.z1]
      let cur = from
      for (const o of openings.filter((q) => q.edge === edge).sort((p, q) => p.u0 - q.u0)) {
        if (o.u0 - cur > 0.05) panes.push({ edge, u0: cur, u1: o.u0 })
        cur = o.u1
      }
      if (to - cur > 0.05) panes.push({ edge, u0: cur, u1: to })
    }
    return { ...s, platform: platformOf(s), posts, beams, panes, openings }
  })

  const c = CORE_PAVILION
  const columns = Array.from({ length: c.columns }, (_, i) => {
    const a = ((c.phase + (360 / c.columns) * i) * Math.PI) / 180
    return { x: c.center[0] + c.columnRadius * Math.cos(a), z: c.center[1] + c.columnRadius * Math.sin(a) }
  })
  return { structures, core: { ...c, columns }, segments }
}

/** Rectangle of a device's footprint, from the logical layout. */
export function deviceRect(node) {
  const lay = NODE_LAYOUT[node.id]
  const spec = DEVICE_SPECS[modelKeyFor(node, lay)]
  const [x, z] = lay.position
  return { x0: x - spec.half[0], z0: z - spec.half[1], x1: x + spec.half[0], z1: z + spec.half[1], top: SLAB_TOP + (lay.y ?? 0) + spec.height, base: SLAB_TOP + (lay.y ?? 0) }
}

/**
 * The line under a sign: the VLAN and subnet of the zone's logical layout, as the old zone captions showed.
 * @returns {string | null}
 */
export function signSubtitle(topology, campusZone) {
  const zone = topology.zones.find((z) => z.id === campusZone.topologyZone)
  const subnet = zone?.vlan ? topology.subnets.find((s) => s.vlan === zone.vlan) : null
  return subnet ? `VLAN ${zone.vlan} · ${subnet.cidr}` : null
}

// -- C3 / C2.1: interaction data and device pads ----------------------------------------------------------------------------

/** What each campus zone is for, in the words of the security design. Shown in the zone panel. */
export const ZONE_PURPOSE = Object.freeze({
  staff: 'The staff computer lab: eight staff computers on VLAN 10 behind the access switch ACC-SW2. They reach the campus servers through the core switch, where the STAFF-IN ACL denies direct access to the database port and to the Security VLAN.',
  admin: 'The administration office: four administrator workstations on VLAN 20. They may use the SIEM and EDR consoles only through explicit Zero Trust permissions, and their traffic to the database port is still inspected and rejected by IPS-1.',
  datacentre: 'The data centre: the application, database, web, DNS and file servers on VLAN 30, in racks behind the top-of-rack switch. Everything entering the server VLAN passes the inline IPS-1.',
  soc: 'The security operations centre: IDS-1 passively watches a SPAN copy of the traffic entering the core; IPS-1 is the inline enforcement point in front of the servers (its gate stands beside the Data Centre); SEC-LOG and SIEM-1 collect events; EDR-MGMT-1 manages endpoint isolation; ZT-POLICY-1 decides Zero Trust access.',
  core: 'The core Layer 3 switch: inter-VLAN routing, the STAFF-IN ACL, the Zero Trust enforcement point and the SPAN source that feeds IDS-1.',
  gate: 'The campus edge: the router to the Internet and the stateful firewall FW1, which enforces its policy whatever the IPS mode.',
  offcampus: 'Outside the campus: the abstract Internet segment, a normal external user and the simulated attacker. All traffic is synthetic.',
})

/** The campus zone of each device. Every one of the 17 nodes is in exactly one zone. */
export const ZONE_OF_DEVICE = Object.freeze(Object.fromEntries(CAMPUS_ZONES.flatMap((z) => z.devices.map((d) => [d, z.id]))))

export const campusZone = (id) => CAMPUS_ZONES.find((z) => z.id === id) ?? null

/**
 * The invisible volumes that make a pavilion pickable: one per platform, as a box (or a cylinder for the round core) from the
 * ground up to the top of the frame. `zone` is the campus zone it belongs to. Several volumes may belong to one zone (Security
 * Operations has the operations pavilion and the IPS-1 gate pavilion).
 * @returns {({zone: string, shape: 'box', x0: number, z0: number, x1: number, z1: number, h: number} | {zone: string, shape: 'cylinder', cx: number, cz: number, radius: number, h: number})[]}
 */
export function zoneVolumes() {
  const boxes = STRUCTURES.filter((s) => !s.onCourt).map((s) => ({ zone: s.zone, shape: 'box', ...platformOf(s), h: PLATFORM_TOP + s.h }))
  const c = CORE_PAVILION
  return [
    ...boxes,
    { zone: c.zone, shape: 'cylinder', cx: c.center[0], cz: c.center[1], radius: c.platformRadius, h: PLATFORM_TOP + c.h },
    { zone: GATE_COURT.zone, shape: 'box', ...GATE_COURT.platform, h: 3.0 },
    { zone: ISLAND.zone, shape: 'box', ...ISLAND.platform, h: 1.2 },
  ]
}

/** Camera target and distance that frame a zone: the middle of its volumes, far enough back to see them all. */
export function zoneFocus(zoneId) {
  const vs = zoneVolumes().filter((v) => v.zone === zoneId)
  if (vs.length === 0) return null
  const bounds = vs.map((v) => (v.shape === 'box' ? v : { x0: v.cx - v.radius, x1: v.cx + v.radius, z0: v.cz - v.radius, z1: v.cz + v.radius }))
  const x0 = Math.min(...bounds.map((b) => b.x0))
  const x1 = Math.max(...bounds.map((b) => b.x1))
  const z0 = Math.min(...bounds.map((b) => b.z0))
  const z1 = Math.max(...bounds.map((b) => b.z1))
  const extent = Math.hypot(x1 - x0, z1 - z0)
  return { target: [(x0 + x1) / 2, 0.9, (z0 + z1) / 2], distance: Math.min(Math.max(extent * 1.35 + 6, 17), 36) }
}

/**
 * Darker mounting pads: one under every device that stands on a platform (the three rack units share the rack's pad), a little
 * larger than the footprint. They give the pale clay devices a darker ground to read against and carry a soft contact shadow.
 * @returns {{x: number, z: number, w: number, d: number}[]}
 */
export function devicePads(topology) {
  const pads = []
  for (const node of topology.nodes) {
    const lay = NODE_LAYOUT[node.id]
    if (!lay || (lay.y ?? 0) > 0) continue // the rack units are covered by the rack's pad
    const spec = DEVICE_SPECS[modelKeyFor(node, lay)]
    pads.push({ id: node.id, x: lay.position[0], z: lay.position[1], w: spec.half[0] * 2 + 0.7, d: spec.half[1] * 2 + 0.7 })
  }
  for (const rack of RACKS) pads.push({ id: `RACK-${rack.id}`, x: rack.position[0], z: rack.position[1], w: rack.size[0] + 0.7, d: rack.size[2] + 0.7 })
  return pads
}

/** The roads, as rectangles (decor): checked by the tests to stay clear of every platform. */
export const roadRects = () => ROADS.map((r) => ({ id: r.id, ...rect(r.rect) }))
