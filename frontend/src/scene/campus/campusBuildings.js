/**
 * Architectural finish of the campus buildings. The back walls (north, west) and their slim posts come from the layout
 * (campusLayout.js); this adds the front walls (south, east) as continuous panes of the same tinted glass with a slim top rail,
 * a low base rail and corner posts, so each building is a complete glass enclosure with its interior visible from outside. It also
 * adds a glass cylinder round the core switch and an entrance canopy at the administration building.
 *
 * There is no roof, fascia or cladding, so every device stays visible from the presentation camera. Mullions stand clear of cables
 * (never within 0.8 of one). Pure geometry calls into the shared merge buckets (the existing glass, frame and light materials): no new
 * mesh, no state, nothing per frame, and no node, link or cable.
 */
import * as THREE from 'three'

import { PLATFORM_TOP, cableSegments } from './campusLayout.js'

/** The footprints of the pieces that stand outside a building (the canopy columns), for the clearance tests: {id, rect}. */
export const ARCHITECTURE_FOOTPRINTS = Object.freeze([
  { id: 'admin-canopy-column-w', rect: { x0: 30.3, x1: 30.6, z0: -5.9, z1: -5.6 } },
  { id: 'admin-canopy-column-e', rect: { x0: 37.4, x1: 37.7, z0: -5.9, z1: -5.6 } },
])

function distanceToSegment(p, a, b) {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

/**
 * The posts of the front walls: the south-east corner and, along each front wall, a mullion about every 7 units, skipping any
 * place within 0.8 of a cable.
 * @param {any} structure
 * @param {{a: number[], b: number[]}[]} cables
 * @returns {{x: number, z: number}[]}
 */
export function frontPosts(structure, cables) {
  const { x0, z0, x1, z1 } = structure.r
  const posts = [{ x: x1, z: z1 }]
  const clear = (x, z) => !cables.some((s) => distanceToSegment([x, z], s.a, s.b) < 0.8)
  const nS = Math.max(1, Math.round((x1 - x0) / 7))
  for (let i = 1; i < nS; i++) if (clear(x0 + ((x1 - x0) * i) / nS, z1)) posts.push({ x: x0 + ((x1 - x0) * i) / nS, z: z1 })
  const nE = Math.max(1, Math.round((z1 - z0) / 7))
  for (let i = 1; i < nE; i++) if (clear(x1, z0 + ((z1 - z0) * i) / nE)) posts.push({ x: x1, z: z0 + ((z1 - z0) * i) / nE })
  if (!clear(x1, z1)) posts.shift()
  return posts
}

/**
 * @param {(zone: string, kind: string, geometry: THREE.BufferGeometry) => void} put  Adds a geometry to the merge bucket of a kind.
 * @param {(w: number, h: number, d: number, x: number, y: number, z: number) => THREE.BufferGeometry} box
 * @param {any[]} structures  The campus structures (rectangular pavilions) from the layout.
 * @param {any} core  The round core pavilion.
 * @param {{nodes: any[], links: any[]}} topology
 */
export function buildArchitecture(put, box, structures, core, topology) {
  const cables = cableSegments(topology)
  const T = PLATFORM_TOP
  for (const s of structures) {
    const { x0, z0, x1, z1 } = s.r
    const top = T + s.h
    const paneH = s.h - 0.1
    // the two front walls: one continuous pane each, a slim top rail and a low base rail
    put(s.zone, 'glass', new THREE.PlaneGeometry(x1 - x0, paneH).translate((x0 + x1) / 2, T + paneH / 2, z1))
    put(s.zone, 'glass', new THREE.PlaneGeometry(z1 - z0, paneH).rotateY(Math.PI / 2).translate(x1, T + paneH / 2, (z0 + z1) / 2))
    put(s.zone, 'frame', box(x1 - x0, 0.4, 0.16, (x0 + x1) / 2, top - 0.2, z1))
    put(s.zone, 'frame', box(0.16, 0.4, z1 - z0, x1, top - 0.2, (z0 + z1) / 2))
    for (const [w, d, x, z] of [[x1 - x0, 0.14, (x0 + x1) / 2, z1], [x1 - x0, 0.14, (x0 + x1) / 2, z0], [0.14, z1 - z0, x1, (z0 + z1) / 2], [0.14, z1 - z0, x0, (z0 + z1) / 2]]) {
      put(s.zone, 'frame', box(w, 0.16, d, x, T + 0.08, z))
    }
    for (const p of frontPosts(s, cables)) put(s.zone, 'frame', box(0.16, s.h, 0.16, p.x, T + s.h / 2, p.z))
    // a defined entrance in the south wall: a framed bay of two slim columns and a header, with a lit sill
    if (x1 - x0 >= 8) {
      const ex = (x0 + x1) / 2
      if (!cables.some((c) => distanceToSegment([ex - 1.6, z1], c.a, c.b) < 0.6 || distanceToSegment([ex + 1.6, z1], c.a, c.b) < 0.6)) {
        for (const dx of [-1.6, 1.6]) put(s.zone, 'frame', box(0.2, 2.8, 0.2, ex + dx, T + 1.4, z1 + 0.02))
        put(s.zone, 'frame', box(3.4, 0.3, 0.22, ex, T + 2.95, z1 + 0.02))
        put(s.zone, 'lights', box(3.0, 0.03, 0.04, ex, T + 0.04, z1 + 0.06))
      }
    }
    // a thin cyan light on top of the two back-wall rails
    put(s.zone, 'lights', box(x1 - x0, 0.03, 0.04, (x0 + x1) / 2, top + 0.035, z0))
    put(s.zone, 'lights', box(0.04, 0.03, z1 - z0, x0, top + 0.035, (z0 + z1) / 2))
    if (s.id === 'admin') {
      // an entrance canopy: one glass panel in a slim frame on two columns over the front
      put(s.zone, 'glass', new THREE.PlaneGeometry(7.4, 2.6).rotateX(-Math.PI / 2).translate(34, 3.6, z1 + 1.4))
      put(s.zone, 'frame', box(7.4, 0.1, 0.1, 34, 3.6, z1 + 2.7))
      put(s.zone, 'frame', box(0.1, 0.1, 2.6, 30.3, 3.6, z1 + 1.4))
      put(s.zone, 'frame', box(0.1, 0.1, 2.6, 37.7, 3.6, z1 + 1.4))
      for (const f of ARCHITECTURE_FOOTPRINTS) put(s.zone, 'frame', box(0.2, 3.6, 0.2, (f.rect.x0 + f.rect.x1) / 2, 1.8, (f.rect.z0 + f.rect.z1) / 2))
    }
  }

  // the core network hub: a glass cylinder round the switch, standing on the platform inside the ring of columns
  const [cx, cz] = core.center
  put(core.zone, 'glass', new THREE.CylinderGeometry(core.columnRadius, core.columnRadius, core.h - 0.1, 64, 1, true).translate(cx, T + (core.h - 0.1) / 2, cz))
  put(core.zone, 'frame', new THREE.TorusGeometry(core.columnRadius, 0.06, 6, 64).rotateX(Math.PI / 2).translate(cx, T + 0.08, cz))
}
