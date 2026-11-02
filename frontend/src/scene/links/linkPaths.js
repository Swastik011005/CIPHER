import { roundedPath } from './cableGeometry.js'
import { buildCablePoints } from './cablePoints.js'
import { LINK_LAYOUT } from '../layout.js'

/** Height above the cable at which packets travel. */
const PACKET_LIFT = 0.1

/**
 * Smooth curves along every cable, so packets travel exactly on the cables that are drawn.
 * @param {{nodes: any[], links: any[]}} topology
 * @returns {Map<string, {curve: import('three').CurvePath<import('three').Vector3>, aNode: string, length: number}>}
 */
export function buildLinkPaths(topology) {
  const nodesById = new Map(topology.nodes.map((n) => [n.id, n]))
  const paths = new Map()
  for (const link of topology.links) {
    if (!LINK_LAYOUT[link.id]) continue
    const points = buildCablePoints(link, nodesById)
    const curve = roundedPath(points, LINK_LAYOUT[link.id].radius)
    paths.set(link.id, { curve, aNode: link.a.node, length: curve.getLength() })
  }
  return paths
}

/**
 * Where a packet is at time `t`, given its hops so far.
 * Between hops (waiting inside a device) it sits at the end of the last cable it crossed.
 * @param {Map<string, any>} paths
 * @param {{link: string, from: string, t: number, tArrive: number}[]} hops
 * @param {number} t
 * @param {import('three').Vector3} out  Receives the position.
 * @param {import('three').Vector3} tangent  Receives the direction of travel.
 * @returns {boolean} false when the packet has no position yet.
 */
export function packetPosition(paths, hops, t, out, tangent) {
  if (hops.length === 0) return false
  let hop = hops[hops.length - 1]
  for (const h of hops) {
    if (t < h.tArrive) {
      hop = h
      break
    }
  }
  const path = paths.get(hop.link)
  if (!path) return false
  const forward = hop.from === path.aNode
  const progress = Math.min(Math.max((t - hop.t) / (hop.tArrive - hop.t), 0), 1)
  const u = forward ? progress : 1 - progress
  path.curve.getPointAt(u, out)
  path.curve.getTangentAt(u, tangent)
  if (!forward) tangent.negate()
  out.y += PACKET_LIFT
  return true
}
