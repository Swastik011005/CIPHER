import { describe, expect, it } from 'vitest'

import { NODE_LAYOUT, PLATES } from '../layout.js'
import { loadBackendTopology } from '../testSupport.js'
import {
  CABINETS, SERVER_CABINETS, WALL_CABINETS, SOC_STATIONS, SOC_WALL, decorFootprints, overlapsRect, roadRects,
} from './campusDecor.js'
import * as decor from './campusDecor.js'
import { ARCHITECTURE_FOOTPRINTS, frontPosts } from './campusBuildings.js'
import { dataCentreFootprints } from './campusDataCentre.js'
import { STRUCTURES, allPlatforms, cableSegments, deviceRect } from './campusLayout.js'

const topology = loadBackendTopology()
const cables = cableSegments(topology)
const plate = PLATES.find((p) => p.id === 'campus')
const onPlate = (r, m = 0.3) => r.x0 >= plate.center[0] - plate.size[0] / 2 + m && r.x1 <= plate.center[0] + plate.size[0] / 2 - m && r.z0 >= plate.center[1] - plate.size[1] / 2 + m && r.z1 <= plate.center[1] + plate.size[1] / 2 - m

function distToSeg(p, a, b) {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}
/** Distance in plan from a cable to a rectangle (0 when the cable touches or crosses it). */
function cableDistance(r) {
  let best = Infinity
  for (const s of cables) {
    for (let i = 0; i <= 20; i++) {
      const p = [s.a[0] + ((s.b[0] - s.a[0]) * i) / 20, s.a[1] + ((s.b[1] - s.a[1]) * i) / 20]
      const dx = Math.max(r.x0 - p[0], 0, p[0] - r.x1)
      const dz = Math.max(r.z0 - p[1], 0, p[1] - r.z1)
      best = Math.min(best, Math.hypot(dx, dz))
    }
  }
  return best
}

describe('campus decoration is visual only and stays out of the way', () => {
  const footprints = [...decorFootprints(), ...ARCHITECTURE_FOOTPRINTS]
  const platforms = allPlatforms()

  it('adds nothing to the logical network', () => {
    expect(topology.nodes).toHaveLength(31)
    expect(topology.links).toHaveLength(32)
    expect(Object.keys(NODE_LAYOUT)).toHaveLength(31)
  })

  it('stands on the plate, clear of every platform, road and other piece of decoration', () => {
    for (const f of footprints) {
      expect(onPlate(f.rect), `${f.id} on the plate`).toBe(true)
      for (const p of platforms) expect(overlapsRect(f.rect, p.rect, 0.5), `${f.id} against platform ${p.id}`).toBe(false)
      for (const r of roadRects()) expect(overlapsRect(f.rect, r, 0.3), `${f.id} against road ${r.id}`).toBe(false)
    }
    for (let i = 0; i < footprints.length; i++) for (let j = i + 1; j < footprints.length; j++) expect(overlapsRect(footprints[i].rect, footprints[j].rect, 0.3), `${footprints[i].id} against ${footprints[j].id}`).toBe(false)
  })

  it('keeps every car park, the booth and the cabinets at least 0.6 from every cable', () => {
    for (const f of footprints) expect(cableDistance(f.rect), f.id).toBeGreaterThanOrEqual(0.6)
  })

  it('has no car park, no vehicle and no vegetation in the decoration data', () => {
    const names = Object.keys(decor)
    for (const n of names) expect(/park|car|tree|grass|bush|path/i.test(n), n).toBe(false)
  })

  it('puts the server cabinets, the monitoring wall and the stations inside their buildings, clear of devices and cables', () => {
    const dc = STRUCTURES.find((s) => s.id === 'datacentre').r
    const soc = STRUCTURES.find((s) => s.id === 'soc').r
    const devices = topology.nodes.filter((n) => NODE_LAYOUT[n.id]).map((n) => deviceRect(n))
    const boxes = [
      ...SERVER_CABINETS.map(([x, z]) => ({ id: 'cabinet', r: { x0: x - 0.75, x1: x + 0.75, z0: z - 0.68, z1: z + 0.68 }, inside: dc })),
      { id: 'wall', r: { x0: SOC_WALL.x - 0.3, x1: SOC_WALL.x + 2.4, z0: SOC_WALL.z0, z1: SOC_WALL.z1 }, inside: soc },
      ...SOC_STATIONS.map(([x, z]) => ({ id: 'station', r: { x0: x - 1.7, x1: x + 1.7, z0: z - 0.8, z1: z + 0.8 }, inside: soc })),
    ]
    for (const b of boxes) {
      expect(b.r.x0 >= b.inside.x0 && b.r.x1 <= b.inside.x1 && b.r.z0 >= b.inside.z0 && b.r.z1 <= b.inside.z1, `${b.id} inside its building`).toBe(true)
      for (const d of devices) expect(overlapsRect(b.r, d, 0.2), `${b.id} on a device`).toBe(false)
      expect(cableDistance(b.r), `${b.id} near a cable`).toBeGreaterThanOrEqual(0.3)
    }
  })

  it('keeps a reception pavilion with no device in the gate zone', () => {
    const r = STRUCTURES.find((s) => s.id === 'reception')
    expect(r.zone).toBe('gate')
    expect(r.holds).toEqual([])
    expect(CABINETS.length).toBeGreaterThanOrEqual(8)
  })

  it('puts every front-wall post on no platform edge and within 0.8 of no cable, and has no walkway', () => {
    expect(Object.keys(decor).some((n) => /walkway/i.test(n))).toBe(false)
    for (const st of STRUCTURES) {
      const posts = frontPosts(st, cables)
      expect(posts.length, st.id).toBeGreaterThanOrEqual(0)
      for (const p of posts) expect(Math.min(...cables.map((c) => distToSeg([p.x, p.z], c.a, c.b))), `${st.id} post at ${p.x},${p.z}`).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('puts the wall cabinets inside their building, clear of devices and cables', () => {
    const devices = topology.nodes.filter((n) => NODE_LAYOUT[n.id]).map((n) => deviceRect(n))
    for (const [zone, x, z] of WALL_CABINETS) {
      const r = { x0: x - 0.8, x1: x + 0.8, z0: z - 0.25, z1: z + 0.25 }
      const b = STRUCTURES.find((s) => s.id === zone).r
      expect(r.x0 >= b.x0 && r.x1 <= b.x1 && r.z0 >= b.z0 && r.z1 <= b.z1, `${zone} cabinet at ${x} inside`).toBe(true)
      for (const d of devices) expect(overlapsRect(r, d, 0.2), `cabinet at ${x} on a device`).toBe(false)
      expect(cableDistance(r), `cabinet at ${x} near a cable`).toBeGreaterThanOrEqual(0.3)
    }
  })

  it('keeps the data centre equipment inside the building, clear of the real servers, every device and every cable, with no topology id', () => {
    const dc = STRUCTURES.find((q) => q.id === 'datacentre').r
    const devices = topology.nodes.filter((n) => NODE_LAYOUT[n.id]).map((n) => deviceRect(n))
    const items = dataCentreFootprints()
    expect(items.length).toBeGreaterThanOrEqual(9)
    for (const it of items) {
      const r = it.rect
      expect(r.x0 >= dc.x0 && r.x1 <= dc.x1 && r.z0 >= dc.z0 && r.z1 <= dc.z1, `${it.id} inside the data centre`).toBe(true)
      for (const d of devices) expect(overlapsRect(r, d, 0.2), `${it.id} on a device`).toBe(false)
      expect(cableDistance(r), `${it.id} near a cable`).toBeGreaterThanOrEqual(0.3)
      expect(topology.nodes.some((n) => n.id === it.id), it.id).toBe(false)
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) expect(overlapsRect(items[i].rect, items[j].rect, 0), `${items[i].id} against ${items[j].id}`).toBe(false)
  })
})
