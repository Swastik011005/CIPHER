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
import { LINK_LAYOUT, NODE_LAYOUT, PERIMETER_WALL, SLAB_TOP, ZONE_LAYOUT } from '../layout.js'
import { buildCablePoints } from '../links/cablePoints.js'

/** Top of every platform: the height the zone slabs always had, so devices and cables stay exactly where they were. */
export const PLATFORM_TOP = SLAB_TOP
/** Top of the lower plinth step under each platform. */
export const PLINTH_TOP = 0.12
/** Height of a pavilion's frame above its platform. Every structure is single-level. */
export const STRUCTURE_HEIGHT = 3.0
/** Half the width of a frame post or beam. */
export const FRAME_HALF = 0.05

const rect = ([x0, z0, x1, z1]) => ({ x0, z0, x1, z1 })
export const inflate = (r, m) => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m })

/**
 * What a visitor can select, and which existing devices each zone holds. Every one of the 17 topology nodes is in exactly one
 * zone; no device is invented or duplicated. `topologyZone` is the zone of the logical layout the campus zone presents.
 */
export const CAMPUS_ZONES = Object.freeze([
  { id: 'staff', name: 'Staff and Academic', topologyZone: 'STAFF', devices: ['PC-1', 'PC-2', 'LAPTOP-1', 'ACC-SW2'], accent: '#4da3ff' },
  { id: 'admin', name: 'Administration', topologyZone: 'ADMIN', devices: ['ADMIN-PC'], accent: '#7aa2ff' },
  { id: 'datacentre', name: 'Data Centre', topologyZone: 'SERVERS', devices: ['APP-SRV', 'DB-SRV', 'SRV-SW3'], accent: '#38d6e6' },
  { id: 'soc', name: 'Security Operations', topologyZone: 'SECOPS', devices: ['IDS-1', 'IPS-1', 'SEC-LOG'], accent: '#a78bfa' },
  { id: 'core', name: 'Core Network Hub', topologyZone: 'CORE', devices: ['CORE-SW1'], accent: '#2fb6a8' },
  { id: 'gate', name: 'Main Gate and Edge', topologyZone: 'PERIMETER', devices: ['R1-EDGE', 'FW1'], accent: '#2fb6a8' },
  { id: 'offcampus', name: 'Public Internet', topologyZone: 'OUTSIDE', devices: ['INET', 'EXT-USR', 'EXT-ATK'], accent: '#8aa0c8' },
])

/**
 * Pavilions. `r` is the frame footprint, `glass` the sides that carry glass, `margin` how far the platform extends beyond
 * the frame. `holds` lists the devices that stand inside (checked by the tests).
 */
export const STRUCTURES = Object.freeze([
  { id: 'staff', zone: 'staff', r: rect([6.4, -12.2, 15.8, -5.3]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25, holds: ['PC-1', 'PC-2', 'LAPTOP-1', 'ACC-SW2'] },
  { id: 'admin', zone: 'admin', r: rect([17.0, -10.6, 20.0, -5.4]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25, holds: ['ADMIN-PC'] },
  { id: 'datacentre', zone: 'datacentre', r: rect([12.3, 4.9, 16.7, 9.0]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25, holds: ['APP-SRV', 'DB-SRV', 'SRV-SW3'] },
  { id: 'soc', zone: 'soc', r: rect([-3.2, 7.6, 3.68, 11.0]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.12, holds: ['IDS-1', 'SEC-LOG'] },
  { id: 'ips-gate', zone: 'soc', r: rect([8.3, 4.4, 10.1, 7.6]), h: STRUCTURE_HEIGHT, glass: ['N', 'W'], margin: 0.25, holds: ['IPS-1'] },
  { id: 'edge', zone: 'gate', r: rect([-11.6, -1.3, -9.4, 1.3]), h: 2.2, glass: ['N', 'W'], margin: 0.2, holds: ['R1-EDGE'], onCourt: true },
])

/** The round open pavilion over the core switch: a platform, eight columns and a thin ring beam. No roof. */
export const CORE_PAVILION = Object.freeze({ id: 'core', zone: 'core', center: [0, 0], platformRadius: 3.6, columnRadius: 2.9, columns: 8, phase: 22.5, h: STRUCTURE_HEIGHT, holds: ['CORE-SW1'] })

/** Platforms with no frame of their own: the gate court (FW1 is its own gate model) and the off-campus island. */
export const GATE_COURT = Object.freeze({ id: 'gate-court', zone: 'gate', platform: rect([-12.0, -2.4, -6.4, 2.4]), holds: ['FW1'] })
const slab = (id) => {
  const z = ZONE_LAYOUT[id]
  return rect([z.center[0] - z.size[0] / 2, z.center[1] - z.size[1] / 2, z.center[0] + z.size[0] / 2, z.center[1] + z.size[1] / 2])
}
export const ISLAND = Object.freeze({ id: 'island', zone: 'offcampus', platform: slab('OUTSIDE'), holds: ['INET', 'EXT-USR', 'EXT-ATK'] })

/** Raised signs: a small tilted plaque on the ground in front of a platform, facing the default camera. */
export const SIGNS = Object.freeze([
  { zone: 'staff', x: 9.0, z: -4.2, w: 3.6 },
  { zone: 'admin', x: 18.5, z: -4.3, w: 2.8 },
  { zone: 'datacentre', x: 14.5, z: 10.1, w: 3.0 },
  { zone: 'soc', x: 0.2, z: 11.9, w: 4.2 },
  { zone: 'core', x: -5.2, z: 2.3, w: 2.4 },
  { zone: 'gate', x: -9.2, z: 3.3, w: 3.4 },
  { zone: 'offcampus', x: -18.1, z: 7.7, w: 3.4 },
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
