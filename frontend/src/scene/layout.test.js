import { describe, expect, it } from 'vitest'

import { DEVICE_SPECS, hitBoxesFor, modelKeyFor } from './devices/specs.js'
import { MODELS } from './devices/models/index.js'
import { GLYPH_KINDS } from './devices/parts/glyphTextures.js'
import {
  CAMERA_BOUNDARY,
  CAMERA_LIMITS,
  CAMERA_PRESETS,
  DEFAULT_PRESET_ID,
  LINK_LAYOUT,
  NODE_LAYOUT,
  PLATES,
  SLAB_TOP,
  ZONE_LAYOUT,
  distanceScaleForAspect,
  presetPosition,
  validateLayout,
} from './layout.js'
import { loadBackendTopology } from './testSupport.js'

const topology = loadBackendTopology()

describe('scene layout covers the backend topology', () => {
  it('has no mismatches with the authoritative topology file', () => {
    expect(validateLayout(topology)).toEqual([])
  })

  it('has a position for every one of the 17 nodes and a route for every one of the 18 links', () => {
    expect(topology.nodes).toHaveLength(17)
    expect(topology.links).toHaveLength(18)
    expect(Object.keys(NODE_LAYOUT).sort()).toEqual(topology.nodes.map((n) => n.id).sort())
    expect(Object.keys(LINK_LAYOUT).sort()).toEqual(topology.links.map((l) => l.id).sort())
  })

  it('has a slab for each of the seven zones', () => {
    expect(topology.zones).toHaveLength(7)
    expect(Object.keys(ZONE_LAYOUT).sort()).toEqual(topology.zones.map((z) => z.id).sort())
  })

  it('reports a node that the layout does not know', () => {
    const extra = { ...topology, nodes: [...topology.nodes, { id: 'NEW-1', zone: 'CORE', form_factor: 'desktop' }] }
    expect(validateLayout(extra)).toContain('no scene position for node NEW-1')
  })

  it('reports a link, zone and stale layout entry', () => {
    const fewer = { ...topology, links: topology.links.slice(1), zones: topology.zones.slice(1), nodes: topology.nodes.slice(1) }
    const problems = validateLayout(fewer)
    expect(problems).toContain(`scene routes unknown link ${topology.links[0].id}`)
    expect(problems).toContain(`scene has a slab for unknown zone ${topology.zones[0].id}`)
    expect(problems).toContain(`scene positions unknown node ${topology.nodes[0].id}`)
  })
})

describe('device models', () => {
  it('every topology node resolves to a spec, a model component and a glyph', () => {
    for (const node of topology.nodes) {
      const key = modelKeyFor(node, NODE_LAYOUT[node.id])
      expect(DEVICE_SPECS[key], `spec for ${node.id}`).toBeDefined()
      expect(MODELS[key], `model for ${node.id}`).toBeTypeOf('function')
      expect(GLYPH_KINDS, `glyph for ${node.id}`).toContain(DEVICE_SPECS[key].glyph)
    }
  })

  it('uses a distinct model per device role (no generic cubes)', () => {
    const keys = topology.nodes.map((n) => modelKeyFor(n, NODE_LAYOUT[n.id]))
    expect(new Set(keys).size).toBeGreaterThanOrEqual(11)
  })

  it('gives every device at least one pick box that covers its footprint', () => {
    for (const node of topology.nodes) {
      const key = modelKeyFor(node, NODE_LAYOUT[node.id])
      const boxes = hitBoxesFor(key)
      expect(boxes.length).toBeGreaterThan(0)
      const [hx, hz] = DEVICE_SPECS[key].half
      expect(boxes[0].size[0]).toBeGreaterThanOrEqual(hx * 2)
      expect(boxes[0].size[2]).toBeGreaterThanOrEqual(hz * 2)
    }
  })
})

describe('placement', () => {
  const halfOf = (id) => {
    const node = topology.nodes.find((n) => n.id === id)
    return DEVICE_SPECS[modelKeyFor(node, NODE_LAYOUT[id])].half
  }

  it('stands every device on the slab of its own zone', () => {
    for (const node of topology.nodes) {
      const [x, z] = NODE_LAYOUT[node.id].position
      const [w, d] = ZONE_LAYOUT[node.zone].size
      const [cx, cz] = ZONE_LAYOUT[node.zone].center
      const [hx, hz] = halfOf(node.id)
      expect(x - hx, `${node.id} west edge`).toBeGreaterThanOrEqual(cx - w / 2 - 0.5)
      expect(x + hx, `${node.id} east edge`).toBeLessThanOrEqual(cx + w / 2 + 0.5)
      expect(z - hz, `${node.id} north edge`).toBeGreaterThanOrEqual(cz - d / 2 - 0.5)
      expect(z + hz, `${node.id} south edge`).toBeLessThanOrEqual(cz + d / 2 + 0.5)
    }
  })

  it('keeps zone slabs from overlapping each other', () => {
    const rects = Object.entries(ZONE_LAYOUT).map(([id, l]) => ({
      id,
      x0: l.center[0] - l.size[0] / 2,
      x1: l.center[0] + l.size[0] / 2,
      z0: l.center[1] - l.size[1] / 2,
      z1: l.center[1] + l.size[1] / 2,
    }))
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlaps = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false)
      }
    }
  })

  it('keeps every slab on a base plate', () => {
    const onPlate = (l) =>
      PLATES.some((p) => {
        const hx = p.size[0] / 2
        const hz = p.size[1] / 2
        return (
          l.center[0] - l.size[0] / 2 >= p.center[0] - hx - 1e-6 &&
          l.center[0] + l.size[0] / 2 <= p.center[0] + hx + 1e-6 &&
          l.center[1] - l.size[1] / 2 >= p.center[1] - hz - 1e-6 &&
          l.center[1] + l.size[1] / 2 <= p.center[1] + hz + 1e-6
        )
      })
    for (const [id, layout] of Object.entries(ZONE_LAYOUT)) expect(onPlate(layout), `${id} is off the plate`).toBe(true)
  })

  it('does not let two devices share a footprint, except the rack-mounted units', () => {
    const racked = new Set(Object.entries(NODE_LAYOUT).filter(([, l]) => l.y).map(([id]) => id))
    const nodes = topology.nodes.filter((n) => !racked.has(n.id))
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const [ax, az] = NODE_LAYOUT[nodes[i].id].position
        const [bx, bz] = NODE_LAYOUT[nodes[j].id].position
        const [ahx, ahz] = halfOf(nodes[i].id)
        const [bhx, bhz] = halfOf(nodes[j].id)
        const overlap = Math.abs(ax - bx) < ahx + bhx && Math.abs(az - bz) < ahz + bhz
        expect(overlap, `${nodes[i].id} overlaps ${nodes[j].id}`).toBe(false)
      }
    }
  })

  it('stacks the three rack units without overlap in height', () => {
    const units = topology.nodes
      .filter((n) => NODE_LAYOUT[n.id].y)
      .map((n) => ({ id: n.id, y0: NODE_LAYOUT[n.id].y, y1: NODE_LAYOUT[n.id].y + DEVICE_SPECS[modelKeyFor(n, NODE_LAYOUT[n.id])].height }))
      .sort((a, b) => a.y0 - b.y0)
    expect(units.map((u) => u.id).sort()).toEqual(['APP-SRV', 'DB-SRV', 'SRV-SW3'])
    for (let i = 1; i < units.length; i++) expect(units[i].y0).toBeGreaterThanOrEqual(units[i - 1].y1)
  })
})

describe('camera', () => {
  it('offers exactly six presets, one of them the default', () => {
    expect(CAMERA_PRESETS).toHaveLength(6)
    expect(new Set(CAMERA_PRESETS.map((p) => p.id)).size).toBe(6)
    expect(CAMERA_PRESETS.map((p) => p.id)).toContain(DEFAULT_PRESET_ID)
  })

  it('keeps every preset target inside the camera boundary and every distance inside the limits', () => {
    for (const p of CAMERA_PRESETS) {
      p.target.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(CAMERA_BOUNDARY.min[i])
        expect(v).toBeLessThanOrEqual(CAMERA_BOUNDARY.max[i])
      })
      expect(p.distance).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance)
      expect(p.distance).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance)
    }
  })

  it('places the camera at the preset distance from its target, above the slab', () => {
    for (const p of CAMERA_PRESETS) {
      const pos = presetPosition(p)
      expect(Math.hypot(pos[0] - p.target[0], pos[1] - p.target[1], pos[2] - p.target[2])).toBeCloseTo(p.distance, 6)
      expect(pos[1]).toBeGreaterThan(SLAB_TOP)
    }
  })

  it('pulls back for a narrow canvas but never beyond the zoom limit', () => {
    expect(distanceScaleForAspect(1.6)).toBe(1)
    expect(distanceScaleForAspect(2.4)).toBe(1) // wider than the reference: no change
    expect(distanceScaleForAspect(0.8)).toBeCloseTo(2)
    expect(distanceScaleForAspect(0)).toBe(1) // not measured yet
    const overview = CAMERA_PRESETS.find((p) => p.id === 'overview')
    const far = presetPosition(overview, 10)
    expect(Math.hypot(far[0] - overview.target[0], far[1] - overview.target[1], far[2] - overview.target[2])).toBeCloseTo(CAMERA_LIMITS.maxDistance, 6)
  })
})
