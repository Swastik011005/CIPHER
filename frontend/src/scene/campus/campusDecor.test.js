import { describe, expect, it } from 'vitest'

import { NODE_LAYOUT, PLATES } from '../layout.js'
import { loadBackendTopology } from '../testSupport.js'
import {
  CABINETS, ENTRANCE, PARKING, SERVER_CABINETS, SOC_STATIONS, SOC_WALL, WALKWAYS, decorFootprints, overlapsRect, parkingBays, roadRects, walkwayPosts,
} from './campusDecor.js'
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
  const footprints = decorFootprints()
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

  it('puts the arch posts on the avenue, off any cable', () => {
    const a = ENTRANCE.arch
    for (const z of [a.z0, a.z1]) expect(Math.min(...cables.map((s) => distToSeg([a.x, z], s.a, s.b)))).toBeGreaterThan(0.6)
  })

  it('has walkway posts that stand on no platform and within 0.8 of no cable', () => {
    const posts = walkwayPosts(topology)
    expect(posts.length).toBeGreaterThan(10)
    for (const p of posts) {
      for (const pl of platforms) expect(overlapsRect({ x0: p.x - 0.1, x1: p.x + 0.1, z0: p.z - 0.1, z1: p.z + 0.1 }, pl.rect, 0.1), `${p.walkway} post at ${p.x},${p.z} on ${pl.id}`).toBe(false)
      expect(Math.min(...cables.map((s) => distToSeg([p.x, p.z], s.a, s.b)))).toBeGreaterThanOrEqual(0.8)
    }
    for (const w of WALKWAYS) expect(onPlate(w.rect, 0.1), w.id).toBe(true)
  })

  it('lays out marked bays in every car park, inside its lot, with no vehicles drawn', () => {
    for (const lot of PARKING) {
      const bays = parkingBays(lot)
      expect(bays.length).toBeGreaterThanOrEqual(6)
      for (const b of bays) expect(b.x - b.w / 2 >= lot.rect.x0 - 0.01 || b.rotated, `${lot.id} bay`).toBe(true)
    }
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
})
