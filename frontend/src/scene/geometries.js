import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * Geometry cache. Meshes of the same shape share one BufferGeometry, keyed by its parameters,
 * so repeated parts (ports, bezels, legs) cost no extra GPU memory.
 */
const cache = new Map()

/**
 * @template T
 * @param {string} key
 * @param {() => T} make
 * @returns {T}
 */
export function shared(key, make) {
  if (!cache.has(key)) cache.set(key, make())
  return cache.get(key)
}

/** Rounded box. The radius is clamped so thin parts never invert. */
export function roundedBox(w, h, d, radius = 0.03) {
  const r = Math.max(0.002, Math.min(radius, Math.min(w, h, d) / 2 - 0.001))
  return shared(`rbox:${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r))
}

export const box = (w, h, d) => shared(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d))

export const plane = (w, h) => shared(`plane:${w}:${h}`, () => new THREE.PlaneGeometry(w, h))

export const cylinder = (rTop, rBottom, h, segments = 28) =>
  shared(`cyl:${rTop}:${rBottom}:${h}:${segments}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, segments))

export const sphere = (r, wSeg = 28, hSeg = 18) =>
  shared(`sph:${r}:${wSeg}:${hSeg}`, () => new THREE.SphereGeometry(r, wSeg, hSeg))

export const hemisphere = (r) =>
  shared(`hemi:${r}`, () => new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2))

export const icosphere = (r) => shared(`ico:${r}`, () => new THREE.IcosahedronGeometry(r, 1))

/** Flat ring lying in the xy plane; rotate -90deg about x to lay it on the floor. */
export const ring = (inner, outer, segments = 64) =>
  shared(`ring:${inner}:${outer}:${segments}`, () => new THREE.RingGeometry(inner, outer, segments))

/** Torus arc standing in the xy plane. */
export const torus = (radius, tube, arc = Math.PI * 2, radial = 12, tubular = 48) =>
  shared(`torus:${radius}:${tube}:${arc}:${radial}:${tubular}`, () => new THREE.TorusGeometry(radius, tube, radial, tubular, arc))
