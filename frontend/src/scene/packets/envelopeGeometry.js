import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * The packet of a ping: a small 3D envelope. A slightly rounded body, a lighter triangular flap folded over its top face with a thin
 * seam and a small seal, and a darker base edge. Vertex colours give the two tones (the instance colour, one of the four ping colours,
 * multiplies them), so one unlit material and one instanced mesh draw every envelope. The envelope lies flat, its long side along the
 * direction of travel (+x), so from the presentation camera the flap reads as an envelope from above.
 */

function paint(geometry, shade) {
  const n = geometry.attributes.position.count
  const colors = new Float32Array(n * 3).fill(shade)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

export function buildEnvelopeGeometry() {
  const W = 0.54
  const D = 0.36
  const H = 0.07
  const parts = []
  parts.push(paint(new THREE.BoxGeometry(W, H, D).translate(0, 0, 0), 0.72)) // body
  parts.push(paint(new THREE.BoxGeometry(W * 0.98, 0.012, D * 0.98).translate(0, -H / 2 - 0.004, 0), 0.4)) // darker base edge

  // the flap: a triangle on the top face from the two near corners to the middle, slightly raised
  const flap = new THREE.Shape()
  flap.moveTo(-W / 2, -D / 2)
  flap.lineTo(W / 2, -D / 2)
  flap.lineTo(0, 0.02)
  flap.closePath()
  const flapGeometry = new THREE.ExtrudeGeometry(flap, { depth: 0.014, bevelEnabled: false })
  flapGeometry.rotateX(-Math.PI / 2) // shape y becomes -z: the flap points towards the far side
  flapGeometry.translate(0, H / 2, D / 2 * 0 + 0.0)
  flapGeometry.translate(0, 0, D / 2 * 0)
  parts.push(paint(flapGeometry, 1.0))

  // the two lower fold lines (darker) and a seal on the flap tip
  for (const sign of [-1, 1]) {
    const seam = new THREE.BoxGeometry(0.34, 0.008, 0.012)
    seam.rotateY(sign * Math.atan2(D / 2, W / 2 - 0.0))
    seam.translate(sign * 0.105, H / 2 + 0.017, 0.07)
    parts.push(paint(seam, 0.55))
  }
  parts.push(paint(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14).translate(0, H / 2 + 0.02, -0.02), 0.5)) // seal

  // every part must have the same attributes and no index to be merged
  const flat = parts.map((g) => {
    const flatGeometry = g.index ? g.toNonIndexed() : g
    for (const name of Object.keys(flatGeometry.attributes)) if (!['position', 'normal', 'color'].includes(name)) flatGeometry.deleteAttribute(name)
    if (!flatGeometry.attributes.normal) flatGeometry.computeVertexNormals()
    return flatGeometry
  })
  const geometry = mergeGeometries(flat, false)
  for (const g of parts) g.dispose()
  for (const g of flat) g.dispose()
  return geometry
}
