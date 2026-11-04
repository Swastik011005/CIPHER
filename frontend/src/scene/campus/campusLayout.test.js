import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { LINK_LAYOUT, NODE_LAYOUT, PLATES, SLAB_TOP, ZONE_LAYOUT } from '../layout.js'
import { loadBackendTopology } from '../testSupport.js'
import {
  BALUSTRADE, CAMPUS_ZONES, CORE_PAVILION, GATE_COURT, ISLAND, PLATFORM_TOP, SIGNS, STRUCTURES, STRUCTURE_HEIGHT,
  allPlatforms, campusGeometry, deviceRect, inflate, signSubtitle,
} from './campusLayout.js'

const topology = loadBackendTopology()
const campus = campusGeometry(topology)
const devices = topology.nodes.map((n) => ({ id: n.id, ...deviceRect(n) }))
const device = (id) => devices.find((d) => d.id === id)

const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0))
const inside = (inner, outer, m = 0) => inner.x0 >= outer.x0 + m - 1e-6 && inner.x1 <= outer.x1 - m + 1e-6 && inner.z0 >= outer.z0 + m - 1e-6 && inner.z1 <= outer.z1 - m + 1e-6
const gap = (a, b) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.z0 - b.z1, b.z0 - a.z1))
function distToSeg(p, a, b) {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}
const nearestCable = (p) => Math.min(...campus.segments.map((s) => distToSeg(p, s.a, s.b)))

describe('the logical layout is untouched by the campus', () => {
  it('has the fingerprint recorded before the campus layer existed: no device, cable route, zone rectangle or plate moved', () => {
    const fingerprint = createHash('sha256').update(JSON.stringify({ nodes: NODE_LAYOUT, links: LINK_LAYOUT, zones: ZONE_LAYOUT, plates: PLATES })).digest('hex')
    expect(fingerprint).toBe('f51b9dc991902a11163acd9236ce94a01c3e91c972d5f93dc3eb478f931647f3')
  })

  it('keeps all 17 nodes and 18 links', () => {
    expect(topology.nodes).toHaveLength(17)
    expect(topology.links).toHaveLength(18)
  })

  it('raises platforms to the height the zone slabs always had, so every device base and cable height is unchanged', () => {
    expect(PLATFORM_TOP).toBe(SLAB_TOP)
    expect(PLATFORM_TOP).toBe(0.3)
  })
})

describe('campus zones map to the existing devices', () => {
  const holds = (id) => CAMPUS_ZONES.find((z) => z.id === id).devices.slice().sort()

  it('holds exactly the devices in the approved mapping', () => {
    expect(holds('staff')).toEqual(['ACC-SW2', 'LAPTOP-1', 'PC-1', 'PC-2'])
    expect(holds('admin')).toEqual(['ADMIN-PC'])
    expect(holds('datacentre')).toEqual(['APP-SRV', 'DB-SRV', 'SRV-SW3'])
    expect(holds('soc')).toEqual(['IDS-1', 'IPS-1', 'SEC-LOG'])
  })

  it('puts every one of the 17 topology nodes in exactly one zone and invents no device', () => {
    const placed = CAMPUS_ZONES.flatMap((z) => z.devices)
    expect(placed).toHaveLength(17)
    expect(new Set(placed).size).toBe(17)
    expect([...placed].sort()).toEqual(topology.nodes.map((n) => n.id).sort())
  })

  it('presents each of the seven logical zones once', () => {
    expect(CAMPUS_ZONES.map((z) => z.topologyZone).sort()).toEqual(Object.keys(ZONE_LAYOUT).sort())
    for (const z of CAMPUS_ZONES) expect(topology.zones.some((t) => t.id === z.topologyZone)).toBe(true)
  })

  it('has a structure for every device it says is inside (the structure and the zone agree)', () => {
    for (const s of STRUCTURES) for (const id of s.holds) expect(CAMPUS_ZONES.find((z) => z.id === s.zone).devices).toContain(id)
    expect([...STRUCTURES.flatMap((s) => s.holds), ...CORE_PAVILION.holds, ...GATE_COURT.holds, ...ISLAND.holds].sort()).toEqual(topology.nodes.map((n) => n.id).sort())
  })
})

describe('structures: single level, devices inside, nothing hidden', () => {
  it('are all single-level (3.0 high at most)', () => {
    for (const s of STRUCTURES) expect(s.h).toBeLessThanOrEqual(STRUCTURE_HEIGHT)
  })

  it('hold their devices inside the frame with 0.2 clearance and 0.5 headroom', () => {
    for (const s of STRUCTURES) {
      for (const id of s.holds) {
        expect(inside(device(id), s.r, 0.2), `${id} inside ${s.id}`).toBe(true)
        expect(device(id).top + 0.5, `${id} headroom under ${s.id}`).toBeLessThanOrEqual(s.h)
      }
    }
  })

  it('put the core switch under the round pavilion, FW1 on the gate court and the outside devices on the island', () => {
    const core = device('CORE-SW1')
    expect(Math.hypot(core.x0 + (core.x1 - core.x0) / 2 - CORE_PAVILION.center[0], core.z0 + (core.z1 - core.z0) / 2 - CORE_PAVILION.center[1])).toBeLessThan(0.01)
    expect(inside(device('FW1'), GATE_COURT.platform)).toBe(true)
    for (const id of ISLAND.holds.filter((i) => i !== 'INET')) expect(inside(device(id), ISLAND.platform)).toBe(true)
  })

  it('leave every device that a pavilion does not hold untouched by its frame', () => {
    for (const s of STRUCTURES) {
      const held = new Set(s.holds)
      for (const d of devices) if (!held.has(d.id)) expect(overlap(inflate(s.r, 0.1), d), `${d.id} vs ${s.id}`).toBe(0)
    }
  })

  it('have no roof: beams run along the two glass sides only, and there is no post at the south-east corner facing the camera', () => {
    for (const s of campus.structures) {
      expect(s.beams.map((b) => b.side).sort()).toEqual(['N', 'W'])
      expect(s.posts.some((p) => Math.abs(p.x - s.r.x1) < 1e-6 && Math.abs(p.z - s.r.z1) < 1e-6), `${s.id} south-east corner`).toBe(false)
      for (const p of s.posts) expect(p.z <= s.r.z0 + 1e-6 || p.x <= s.r.x0 + 1e-6 || (Math.abs(p.x - s.r.x1) < 1e-6 && Math.abs(p.z - s.r.z0) < 1e-6) || (Math.abs(p.x - s.r.x0) < 1e-6 && Math.abs(p.z - s.r.z1) < 1e-6), `${s.id} post on an open side`).toBe(true)
    }
  })
})

describe('platforms and frames keep clear of each other and of the cables', () => {
  it('do not overlap, and leave at least 0.6 between any two platforms', () => {
    const ps = allPlatforms()
    ps.forEach((a, i) =>
      ps.slice(i + 1).forEach((b) => {
        expect(overlap(a.rect, b.rect), `${a.id} / ${b.id}`).toBe(0)
        // the round core platform lies inside its bounding square, so this gap is a safe lower bound for it
        expect(gap(a.rect, b.rect), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(0.6 - 1e-6)
      }),
    )
  })

  it('keep the logical zone rectangles inside the campus plates', () => {
    const plate = PLATES.find((p) => p.id === 'campus')
    const r = { x0: plate.center[0] - plate.size[0] / 2, x1: plate.center[0] + plate.size[0] / 2, z0: plate.center[1] - plate.size[1] / 2, z1: plate.center[1] + plate.size[1] / 2 }
    for (const p of allPlatforms().filter((q) => q.id !== 'island')) expect(inside(p.rect, r), p.id).toBe(true)
  })

  it('put no frame post within 0.27 of a cable and none within 0.15 of a device', () => {
    for (const s of campus.structures) {
      for (const p of s.posts) {
        expect(nearestCable([p.x, p.z]), `${s.id} post at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).toBeGreaterThanOrEqual(0.27 - 1e-6)
        for (const d of devices) expect(p.x >= d.x0 - 0.15 && p.x <= d.x1 + 0.15 && p.z >= d.z0 - 0.15 && p.z <= d.z1 + 0.15, `${s.id} post vs ${d.id}`).toBe(false)
      }
    }
  })

  it('put no core column within 0.4 of a cable or on a device', () => {
    for (const c of campus.core.columns) {
      expect(nearestCable([c.x, c.z])).toBeGreaterThanOrEqual(0.4)
      for (const d of devices) expect(c.x >= d.x0 - 0.15 && c.x <= d.x1 + 0.15 && c.z >= d.z0 - 0.15 && c.z <= d.z1 + 0.15).toBe(false)
    }
  })

  it('cut a framed opening in the glass wherever a cable crosses it, and nowhere else', () => {
    const found = campus.structures.flatMap((s) => s.openings.map((o) => `${s.id}-${o.edge}[${o.links.join('+')}]`)).sort()
    expect(found).toEqual(['admin-W[L10]', 'datacentre-W[L15]', 'edge-W[L03]', 'ips-gate-W[L14]', 'soc-N[L11+L12]', 'soc-N[L13]', 'staff-W[L06]'])
    for (const s of campus.structures) {
      for (const pane of s.panes) for (const o of s.openings.filter((q) => q.edge === pane.edge)) expect(pane.u1 <= o.u0 + 1e-6 || pane.u0 >= o.u1 - 1e-6, `${s.id} pane over an opening`).toBe(true)
    }
  })
})

describe('signs, balustrade and subtitles', () => {
  it('place every sign on the plate, clear of platforms, devices and cables', () => {
    const plate = PLATES.find((p) => p.id === 'campus')
    const island = PLATES.find((p) => p.id === 'island')
    const onPlate = (x, z, p) => Math.abs(x - p.center[0]) <= p.size[0] / 2 - 0.3 && Math.abs(z - p.center[1]) <= p.size[1] / 2 - 0.3
    for (const sign of SIGNS) {
      expect(onPlate(sign.x, sign.z, plate) || onPlate(sign.x, sign.z, island), sign.zone).toBe(true)
      const box = { x0: sign.x - sign.w / 2 - 0.3, x1: sign.x + sign.w / 2 + 0.3, z0: sign.z - sign.w / 2 - 0.3, z1: sign.z + sign.w / 2 + 0.3 }
      for (const p of allPlatforms()) if (sign.zone !== 'offcampus' || p.id !== 'island') expect(overlap({ x0: sign.x - 0.4, x1: sign.x + 0.4, z0: sign.z - 0.4, z1: sign.z + 0.4 }, p.rect), `${sign.zone} sign on ${p.id}`).toBe(0)
      expect(nearestCable([sign.x, sign.z]), `${sign.zone} sign near a cable`).toBeGreaterThan(0.8)
      expect(box.x1 > box.x0).toBe(true)
    }
    expect(SIGNS.map((s) => s.zone).sort()).toEqual(CAMPUS_ZONES.map((z) => z.id).sort())
  })

  it('keep the balustrade on the old wall line with the gate gap', () => {
    expect(BALUSTRADE.x).toBe(-7.2)
    expect(BALUSTRADE.spans).toEqual([[-8.4, -1.75], [1.75, 8.4]])
  })

  it('show the VLAN and subnet of the zone as the old captions did', () => {
    const sub = (id) => signSubtitle(topology, CAMPUS_ZONES.find((z) => z.id === id))
    expect(sub('staff')).toBe('VLAN 10 · 10.0.10.0/24')
    expect(sub('admin')).toBe('VLAN 20 · 10.0.20.0/24')
    expect(sub('datacentre')).toBe('VLAN 30 · 10.0.30.0/24')
    expect(sub('soc')).toBe('VLAN 99 · 10.0.99.0/24')
    expect(sub('core')).toBeNull()
  })
})
