/**
 * Pure maths for cable routes: where a cable attaches to a device, and the polyline between
 * the two ends. No three.js here, so it is cheap to unit-test.
 */

import { DEVICE_SPECS, modelKeyFor } from '../devices/specs.js'
import { CHANNEL_Y, LINK_LAYOUT, NODE_LAYOUT, SLAB_TOP } from '../layout.js'

const NORMALS = Object.freeze({
  '+x': [1, 0],
  '-x': [-1, 0],
  '+z': [0, 1],
  '-z': [0, -1],
})

/** Unit direction [dx, dz] pointing out of a device face. */
export function sideNormal(side) {
  const n = NORMALS[side]
  if (!n) throw new Error(`unknown device side ${side}`)
  return n
}

/**
 * World position of a cable port on a device face.
 * @param {{form_factor: string, id: string}} node
 * @param {string} side
 * @param {number} [lateral]  Shift along the face (along z for x faces, along x for z faces).
 * @returns {[number, number, number]}
 */
export function portPosition(node, side, lateral = 0) {
  const layout = NODE_LAYOUT[node.id]
  const spec = DEVICE_SPECS[modelKeyFor(node, layout)]
  const [px, pz] = layout.position
  const [hx, hz] = spec.half
  const y = SLAB_TOP + (layout.y ?? 0) + spec.portY
  switch (side) {
    case '+x':
      return [px + hx, y, pz + lateral]
    case '-x':
      return [px - hx, y, pz + lateral]
    case '+z':
      return [px + lateral, y, pz + hz]
    case '-z':
      return [px + lateral, y, pz - hz]
    default:
      throw new Error(`unknown device side ${side}`)
  }
}

const EPS = 1e-4

/** Drop consecutive points that coincide. */
export function dedupe(points) {
  const out = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > EPS) out.push(p)
  }
  return out
}

/**
 * The 3D polyline of a link, from port A to port B.
 *
 * Shape: port, straight out of the face by `outA`, drop to the slab, run through the `via`
 * waypoints, rise at `outB`, port. `internal` routes skip the drop and stay at port height.
 * @param {{id: string, a: {node: string}, b: {node: string}}} link
 * @param {Map<string, any>} nodesById
 * @returns {[number, number, number][]}
 */
export function buildCablePoints(link, nodesById) {
  const route = LINK_LAYOUT[link.id]
  if (!route) throw new Error(`no cable route for link ${link.id}`)
  const nodeA = nodesById.get(link.a.node)
  const nodeB = nodesById.get(link.b.node)
  if (!nodeA || !nodeB) throw new Error(`link ${link.id} references an unknown node`)

  const portA = portPosition(nodeA, route.a.side, route.a.lateral ?? 0)
  const portB = portPosition(nodeB, route.b.side, route.b.lateral ?? 0)
  const [nax, naz] = sideNormal(route.a.side)
  const [nbx, nbz] = sideNormal(route.b.side)
  const outA = route.outA ?? 0
  const outB = route.outB ?? 0

  const points = [portA]
  const pushOut = (port, nx, nz, out, dropFirst) => {
    if (out <= 0) return
    const beyond = [port[0] + nx * out, port[1], port[2] + nz * out]
    const dropped = [beyond[0], CHANNEL_Y, beyond[2]]
    if (dropFirst) points.push(beyond, dropped)
    else points.push(dropped, beyond)
  }

  if (route.internal) {
    points.push([portA[0] + nax * outA, portA[1], portA[2] + naz * outA])
    points.push([portB[0] + nbx * outB, portB[1], portB[2] + nbz * outB])
  } else {
    pushOut(portA, nax, naz, outA, true)
    for (const v of route.via ?? []) points.push([v[0], v[2] ?? CHANNEL_Y, v[1]])
    pushOut(portB, nbx, nbz, outB, false)
  }
  points.push(portB)

  let result = dedupe(points)
  if (route.lift) {
    const first = result[0]
    const last = result[result.length - 1]
    const mid = [(first[0] + last[0]) / 2, Math.max(first[1], last[1]) + route.lift, (first[2] + last[2]) / 2]
    result = [first, mid, last]
  }
  return result
}

/** Total length of a polyline. */
export function polylineLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2])
  }
  return total
}
