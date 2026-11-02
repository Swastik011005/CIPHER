import * as THREE from 'three'

const CORNER_RADIUS = 0.5

/**
 * Smooth a polyline into a curve: straight segments joined by rounded corners.
 * A corner's radius never exceeds half of either neighbouring segment, so adjacent corners
 * cannot overlap.
 * @param {[number, number, number][]} points
 * @param {number} [radius]
 * @returns {THREE.CurvePath<THREE.Vector3>}
 */
export function roundedPath(points, radius = CORNER_RADIUS) {
  const path = new THREE.CurvePath()
  const v = points.map((p) => new THREE.Vector3(...p))
  if (v.length < 2) return path
  if (v.length === 2) {
    path.add(new THREE.LineCurve3(v[0], v[1]))
    return path
  }

  let cursor = v[0].clone()
  for (let i = 1; i < v.length - 1; i++) {
    const prev = v[i - 1]
    const corner = v[i]
    const next = v[i + 1]
    const toPrev = prev.clone().sub(corner)
    const toNext = next.clone().sub(corner)
    const r = Math.min(radius, toPrev.length() / 2, toNext.length() / 2)
    const entry = corner.clone().addScaledVector(toPrev.normalize(), r)
    const exit = corner.clone().addScaledVector(toNext.normalize(), r)
    if (cursor.distanceTo(entry) > 1e-6) path.add(new THREE.LineCurve3(cursor, entry))
    path.add(new THREE.QuadraticBezierCurve3(entry, corner.clone(), exit))
    cursor = exit
  }
  const last = v[v.length - 1]
  if (cursor.distanceTo(last) > 1e-6) path.add(new THREE.LineCurve3(cursor, last))
  return path
}

/**
 * Tube geometry along a polyline.
 * @param {[number, number, number][]} points
 * @param {{radius: number, cornerRadius?: number, offset?: [number, number]}} options
 *   `offset` shifts the whole route in plan view [dx, dz], used to draw the two tubes of a trunk.
 */
export function buildCableGeometry(points, { radius, cornerRadius, offset = [0, 0] }) {
  const shifted = points.map((p) => /** @type {[number, number, number]} */ ([p[0] + offset[0], p[1], p[2] + offset[1]]))
  const curve = roundedPath(shifted, cornerRadius)
  const segments = Math.max(12, Math.ceil(curve.getLength() * 8))
  return { geometry: new THREE.TubeGeometry(curve, segments, radius, 8, false), length: curve.getLength() }
}
