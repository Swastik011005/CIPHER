/**
 * Architectural finish of the campus buildings. The walls are the glass panes and slim steel-blue posts the layout already computes
 * (see campusLayout.js); this adds only what finishes them without hiding anything: a thin cyan light along the top rail of each glass
 * wall, and an entrance canopy in glass on two slim columns at the administration building. There is no roof, fascia, rafter or
 * cladding, so every device stays visible from outside. Pure geometry calls into the shared merge buckets (the existing glass, frame and
 * light materials): no new mesh, no state, nothing per frame, and no node, link or cable.
 */
import * as THREE from 'three'

import { PLATFORM_TOP } from './campusLayout.js'

/** The footprints of the pieces that stand outside a building (the canopy columns), for the clearance tests: {id, rect}. */
export const ARCHITECTURE_FOOTPRINTS = Object.freeze([
  { id: 'admin-canopy-column-w', rect: { x0: 44.4, x1: 44.7, z0: -11.9, z1: -11.6 } },
  { id: 'admin-canopy-column-e', rect: { x0: 51.3, x1: 51.6, z0: -11.9, z1: -11.6 } },
])

/**
 * @param {(zone: string, kind: string, geometry: THREE.BufferGeometry) => void} put  Adds a geometry to the merge bucket of a kind.
 * @param {(w: number, h: number, d: number, x: number, y: number, z: number) => THREE.BufferGeometry} box
 * @param {any[]} structures  The campus structures (rectangular pavilions) from the layout.
 */
export function buildArchitecture(put, box, structures) {
  for (const s of structures) {
    const { x0, z0, x1, z1 } = s.r
    const top = PLATFORM_TOP + s.h
    // a thin cyan light on top of the two glass walls' rails
    put(s.zone, 'lights', box(x1 - x0, 0.04, 0.05, (x0 + x1) / 2, top + 0.04, z0))
    put(s.zone, 'lights', box(0.05, 0.04, z1 - z0, x0, top + 0.04, (z0 + z1) / 2))
    if (s.id === 'admin') {
      // an entrance canopy: one glass panel in a slim frame on two columns over the front
      put(s.zone, 'glass', new THREE.PlaneGeometry(7.4, 2.6).rotateX(-Math.PI / 2).translate(48, 3.6, z1 + 1.4))
      put(s.zone, 'frame', box(7.4, 0.1, 0.1, 48, 3.6, z1 + 2.7))
      put(s.zone, 'frame', box(0.1, 0.1, 2.6, 44.3, 3.6, z1 + 1.4))
      put(s.zone, 'frame', box(0.1, 0.1, 2.6, 51.7, 3.6, z1 + 1.4))
      put(s.zone, 'lights', box(7.2, 0.04, 0.05, 48, 3.56, z1 + 2.7))
      for (const f of ARCHITECTURE_FOOTPRINTS) put(s.zone, 'frame', box(0.2, 3.6, 0.2, (f.rect.x0 + f.rect.x1) / 2, 1.8, (f.rect.z0 + f.rect.z1) / 2))
    }
  }
}
