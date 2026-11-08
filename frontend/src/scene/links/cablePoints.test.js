import { describe, expect, it } from 'vitest'

import { DEVICE_SPECS, modelKeyFor } from '../devices/specs.js'
import { CHANNEL_Y, NODE_LAYOUT } from '../layout.js'
import { loadBackendTopology } from '../testSupport.js'
import { buildCablePoints, dedupe, polylineLength, portPosition, sideNormal } from './cablePoints.js'
import { roundedPath } from './cableGeometry.js'

const topology = loadBackendTopology()
const nodesById = new Map(topology.nodes.map((n) => [n.id, n]))

describe('cable routes', () => {
  it('builds a finite route for all 32 links (18 original, 14 campus extension)', () => {
    expect(topology.links).toHaveLength(32)
    for (const link of topology.links) {
      const points = buildCablePoints(link, nodesById)
      expect(points.length, link.id).toBeGreaterThanOrEqual(2)
      for (const p of points) expect(p.every(Number.isFinite), `${link.id} has a non-finite point`).toBe(true)
    }
  })

  it('starts at a port of the first device and ends at a port of the second', () => {
    for (const link of topology.links) {
      const points = buildCablePoints(link, nodesById)
      const near = (point, nodeId) => {
        const layout = NODE_LAYOUT[nodeId]
        const spec = DEVICE_SPECS[modelKeyFor(nodesById.get(nodeId), layout)]
        const [x, z] = layout.position
        // Within the device footprint plus a small margin: the port sits on its face.
        return Math.abs(point[0] - x) <= spec.half[0] + 0.01 && Math.abs(point[2] - z) <= spec.half[1] + 0.01
      }
      const points_ = buildCablePoints(link, nodesById)
      expect(near(points_[0], link.a.node), `${link.id} start is not on ${link.a.node}`).toBe(true)
      expect(near(points_[points_.length - 1], link.b.node), `${link.id} end is not on ${link.b.node}`).toBe(true)
      expect(points.length).toBeGreaterThan(0)
    }
  })

  it('keeps cables off the floor and below the cloud', () => {
    for (const link of topology.links) {
      for (const [, y] of buildCablePoints(link, nodesById)) {
        expect(y, link.id).toBeGreaterThan(0.3)
        expect(y, link.id).toBeLessThan(4)
      }
    }
  })

  it('runs ordinary cables along the slab between the port and the far device', () => {
    const l06 = topology.links.find((l) => l.id === 'L06')
    const points = buildCablePoints(l06, nodesById)
    expect(points.some((p) => Math.abs(p[1] - CHANNEL_Y) < 1e-9)).toBe(true)
  })

  it('arches the Internet cable over the air gap', () => {
    const l03 = topology.links.find((l) => l.id === 'L03')
    const points = buildCablePoints(l03, nodesById)
    expect(points).toHaveLength(3)
    expect(points[1][1]).toBeGreaterThan(points[0][1] + 0.9)
  })

  it('keeps the two rack-internal cables at port height', () => {
    for (const id of ['L17', 'L18']) {
      const points = buildCablePoints(topology.links.find((l) => l.id === id), nodesById)
      expect(points.every((p) => p[1] > 1)).toBe(true)
    }
  })

  it('throws a clear error for a link without a route', () => {
    expect(() => buildCablePoints({ id: 'L99', a: { node: 'PC-1' }, b: { node: 'PC-2' } }, nodesById)).toThrow(/no cable route/)
  })
})

describe('port maths', () => {
  it('puts a port on the requested face and shifts it laterally', () => {
    const pc1 = nodesById.get('PC-1')
    const [x, z] = NODE_LAYOUT['PC-1'].position
    const [hx, hz] = DEVICE_SPECS.desktop.half
    expect(portPosition(pc1, '+x')[0]).toBeCloseTo(x + hx)
    expect(portPosition(pc1, '-x')[0]).toBeCloseTo(x - hx)
    expect(portPosition(pc1, '+z')[2]).toBeCloseTo(z + hz)
    expect(portPosition(pc1, '-x', 0.3)[2]).toBeCloseTo(z + 0.3)
    expect(portPosition(pc1, '+z', -0.2)[0]).toBeCloseTo(x - 0.2)
  })

  it('knows the four face normals and rejects others', () => {
    expect(sideNormal('+x')).toEqual([1, 0])
    expect(sideNormal('-z')).toEqual([0, -1])
    expect(() => sideNormal('up')).toThrow()
    expect(() => portPosition(nodesById.get('PC-1'), 'up')).toThrow()
  })

  it('drops repeated points', () => {
    expect(dedupe([[0, 0, 0], [0, 0, 0], [1, 0, 0], [1, 0.00001, 0]])).toEqual([[0, 0, 0], [1, 0, 0]])
    expect(polylineLength([[0, 0, 0], [3, 4, 0]])).toBe(5)
  })
})

describe('rounded path', () => {
  it('keeps the end points and shortens a right-angle corner', () => {
    const points = [[0, 0, 0], [4, 0, 0], [4, 0, 4]]
    const path = roundedPath(points, 0.5)
    const start = path.getPointAt(0)
    const end = path.getPointAt(1)
    expect([start.x, start.y, start.z]).toEqual([0, 0, 0])
    expect(end.x).toBeCloseTo(4)
    expect(end.z).toBeCloseTo(4)
    expect(path.getLength()).toBeLessThan(8)
    expect(path.getLength()).toBeGreaterThan(7.5)
  })

  it('never rounds more than half of a short segment', () => {
    const path = roundedPath([[0, 0, 0], [0.2, 0, 0], [0.2, 0, 3]], 2)
    expect(Number.isFinite(path.getLength())).toBe(true)
    const mid = path.getPointAt(0.5)
    expect(Number.isFinite(mid.x) && Number.isFinite(mid.z)).toBe(true)
  })
})
