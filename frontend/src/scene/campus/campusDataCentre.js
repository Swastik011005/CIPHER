/**
 * The data centre's interior equipment (decoration only): a row of network, storage and backup cabinets with patch panels,
 * rack switches and cable management, compact cooling units, perforated floor tiles, overhead cable trays with drops to the racks,
 * a monitoring workstation and small equipment labels. None of it is a topology device: it has no id, no address and no cable of
 * the network, and the five real servers (APP-SRV, DB-SRV, WEB-SRV, DNS-SRV, FILE-SRV) and SRV-SW3 stay in their own racks.
 *
 * Pure data and geometry calls into the shared merge buckets of the campus layer (no new draw call except one for the label atlas).
 */
import * as THREE from 'three'

import { PLATFORM_TOP } from './campusLayout.js'

const T = PLATFORM_TOP

/** The cabinet row along the north wall: [kind, x]. Cabinets are 1.6 wide, 1.1 deep and 3.3 high, fronts facing south. */
export const DC_ROW_Z = 12.2
export const DC_ROW = Object.freeze(['net', 'net', 'net', 'nas', 'backup', 'backup'].map((kind, i) => ({ kind, x: 26.5 + i * 1.7, z: DC_ROW_Z })))

/** Cooling units against the east wall (0.9 deep along x, 1.8 along z, 2.4 high), fronts facing west. */
export const DC_COOLING = Object.freeze([[45.8, 11.6], [45.8, 14.6]])

/** The monitoring workstation: the desk centre, and the chair in front (south) of it. */
export const DC_WORKSTATION = Object.freeze({ x: 43.2, z: 24.4 })

/** Perforated floor tiles in the aisle between the cabinet row and the servers. */
export const DC_TILES = Object.freeze(Array.from({ length: 9 }, (_, i) => [26.2 + i * 1.3, 15]))

/** Overhead cable tray: along x at height y, between z0 and z1 plan position, with branch trays over the racks and cabinets. */
export const DC_TRAY = Object.freeze({ x0: 24.8, x1: 39, z: 15.6, y: 4.6 })
export const DC_TRAY_BRANCHES = Object.freeze([26.5, 29.9, 33.3, 26, 32, 38])

/** Equipment labels: text and where it goes. */
export const DC_LABELS = Object.freeze([
  'NET RACK 1', 'NET RACK 2', 'NET RACK 3', 'NAS STORAGE', 'BACKUP 1', 'BACKUP 2', 'COOLING 1', 'COOLING 2', 'MONITORING', 'SPARE',
])

/** Plan footprints of everything that stands on the floor, as {id, rect}, for the clearance tests. */
export function dataCentreFootprints() {
  const list = []
  for (const c of DC_ROW) list.push({ id: `dc-${c.kind}-${c.x}`, rect: { x0: c.x - 0.8, x1: c.x + 0.8, z0: c.z - 0.55, z1: c.z + 0.55 } })
  for (const [x, z] of DC_COOLING) list.push({ id: `dc-cooling-${z}`, rect: { x0: x - 0.45, x1: x + 0.45, z0: z - 0.9, z1: z + 0.9 } })
  const w = DC_WORKSTATION
  list.push({ id: 'dc-workstation', rect: { x0: w.x - 0.95, x1: w.x + 0.95, z0: w.z - 0.5, z1: w.z + 1.4 } })
  return list
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

/**
 * @param {(zone: string, kind: string, geometry: THREE.BufferGeometry) => void} put
 * @param {(kind: string, geometry: THREE.BufferGeometry) => void} screen  Adds a picture plane (a texture kind of the screens).
 * @param {(index: number, geometry: THREE.BufferGeometry) => void} label  Adds a label plate showing DC_LABELS[index].
 */
export function buildDataCentre(put, screen, label) {
  const Z = 'datacentre'
  const front = (c) => c.z + 0.56

  DC_ROW.forEach((c, i) => {
    put(Z, 'cabinet', box(1.6, 3.3, 1.1, c.x, T + 1.65, c.z))
    put(Z, 'dark', box(1.5, 3.2, 0.02, c.x, T + 1.65, front(c)))
    const f = front(c) + 0.02
    for (let s = 0; s < 6; s++) put(Z, 'dark', box(1.0, 0.012, 0.012, c.x - 0.15, T + 3.1 - s * 0.05, front(c) + 0.015)) // top vent
    if (c.kind === 'net') {
      // patch panels (rows of ports), rack switches (ports and lights), cable management bars with rings, blank panels
      for (const y of [3.0, 1.55]) {
        put(Z, 'frame', box(1.38, 0.17, 0.04, c.x, T + y, f))
        for (let p = 0; p < 12; p++) put(Z, 'dark', box(0.07, 0.07, 0.02, c.x - 0.6 + p * 0.109, T + y, f + 0.025))
      }
      for (const y of [2.55, 1.85]) {
        put(Z, 'frame', box(1.38, 0.13, 0.04, c.x, T + y, f))
        for (let p = 0; p < 16; p++) put(Z, 'dark', box(0.05, 0.045, 0.02, c.x - 0.5 + p * 0.066, T + y + 0.015, f + 0.025))
        for (let l = 0; l < 3; l++) put(Z, 'lights', box(0.04, 0.025, 0.02, c.x + 0.52 + l * 0.05 - 0.05, T + y - 0.04, f + 0.025))
      }
      put(Z, 'frame', box(1.38, 0.1, 0.07, c.x, T + 2.25, f))
      for (let r = 0; r < 6; r++) put(Z, 'dark', box(0.1, 0.06, 0.03, c.x - 0.55 + r * 0.22, T + 2.25, f + 0.045))
      for (const y of [1.25, 1.0, 0.75, 0.5]) put(Z, 'dark', box(1.38, 0.17, 0.03, c.x, T + y, f))
    } else if (c.kind === 'nas') {
      // a storage array: head unit and two columns of drive bays
      put(Z, 'frame', box(1.38, 0.26, 0.04, c.x, T + 3.0, f))
      put(Z, 'lights', box(0.05, 0.03, 0.02, c.x + 0.55, T + 3.0, f + 0.025))
      for (let col = 0; col < 2; col++) {
        for (let row = 0; row < 7; row++) {
          put(Z, 'dark', box(0.62, 0.22, 0.03, c.x - 0.34 + col * 0.68, T + 2.55 - row * 0.3, f))
          put(Z, 'lights', box(0.03, 0.03, 0.02, c.x - 0.58 + col * 0.68, T + 2.55 - row * 0.3, f + 0.02))
        }
      }
    } else {
      // backup equipment: a tape-library style unit with two slots, and server units with vents
      put(Z, 'frame', box(1.38, 0.62, 0.04, c.x, T + 2.7, f))
      for (const dx of [-0.35, 0.35]) put(Z, 'dark', box(0.55, 0.12, 0.03, c.x + dx, T + 2.8, f + 0.025))
      put(Z, 'lights', box(0.06, 0.03, 0.02, c.x, T + 2.52, f + 0.025))
      for (const y of [2.0, 1.55, 1.1]) {
        put(Z, 'frame', box(1.38, 0.36, 0.04, c.x, T + y, f))
        for (let v = 0; v < 8; v++) put(Z, 'dark', box(0.5, 0.012, 0.02, c.x - 0.3, T + y + 0.12 - v * 0.03, f + 0.025))
        put(Z, 'lights', box(0.04, 0.03, 0.02, c.x + 0.55, T + y + 0.1, f + 0.025))
      }
    }
    label(i < 6 ? i : 0, new THREE.PlaneGeometry(1.2, 0.3).translate(c.x, T + 3.45, c.z + 0.575))
  })

  // cooling units: a steel body, a grille of slats and a lit display, labelled
  DC_COOLING.forEach(([x, z], k) => {
    put(Z, 'frame', box(0.9, 2.4, 1.8, x, T + 1.2, z))
    put(Z, 'dark', box(0.02, 2.2, 1.6, x - 0.46, T + 1.2, z))
    for (let s = 0; s < 14; s++) put(Z, 'frame', box(0.03, 0.04, 1.4, x - 0.48, T + 0.35 + s * 0.12, z))
    put(Z, 'lights', box(0.02, 0.1, 0.3, x - 0.48, T + 2.1, z + 0.55))
    label(6 + k, new THREE.PlaneGeometry(1.2, 0.3).rotateY(-Math.PI / 2).translate(x - 0.47, T + 2.55, z))
  })

  // monitoring workstation: a desk, a monitor showing the live counters, a keyboard and a chair
  {
    const w = DC_WORKSTATION
    put(Z, 'frame', box(1.8, 0.06, 0.9, w.x, T + 0.75, w.z))
    for (const dx of [-0.8, 0.8]) put(Z, 'cabinet', box(0.06, 0.72, 0.8, w.x + dx, T + 0.36, w.z))
    put(Z, 'dark', box(0.95, 0.58, 0.05, w.x, T + 1.25, w.z - 0.2))
    screen('live-stats', new THREE.PlaneGeometry(0.85, 0.48).translate(w.x, T + 1.25, w.z - 0.172))
    put(Z, 'dark', box(0.07, 0.3, 0.06, w.x, T + 0.93, w.z - 0.2))
    put(Z, 'dark', box(0.5, 0.02, 0.17, w.x - 0.1, T + 0.79, w.z + 0.2))
    put(Z, 'cabinet', box(0.5, 0.07, 0.5, w.x, T + 0.5, w.z + 0.95))
    put(Z, 'cabinet', box(0.46, 0.46, 0.06, w.x, T + 0.82, w.z + 1.2))
    put(Z, 'dark', new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8).translate(w.x, T + 0.3, w.z + 0.95))
    put(Z, 'dark', new THREE.CylinderGeometry(0.24, 0.24, 0.03, 5).translate(w.x, T + 0.03, w.z + 0.95))
    label(8, new THREE.PlaneGeometry(1.2, 0.3).translate(w.x, T + 1.75, w.z - 0.2))
  }

  // perforated floor tiles
  for (const [x, z] of DC_TILES) {
    put(Z, 'dark', box(1.2, 0.025, 1.2, x, T + 0.013, z))
    for (let s = 0; s < 5; s++) put(Z, 'frame', box(1.0, 0.012, 0.03, x, T + 0.03, z - 0.4 + s * 0.2))
  }

  // overhead cable trays: a main tray with side rails, branch trays over the racks and cabinets, and short drops
  const tr = DC_TRAY
  const len = tr.x1 - tr.x0
  put(Z, 'frame', box(len, 0.06, 0.6, (tr.x0 + tr.x1) / 2, tr.y, tr.z))
  for (const dz of [-0.3, 0.3]) put(Z, 'frame', box(len, 0.14, 0.04, (tr.x0 + tr.x1) / 2, tr.y + 0.05, tr.z + dz))
  for (const bx of DC_TRAY_BRANCHES) {
    const north = bx > 26.4 && DC_ROW.some((c) => Math.abs(c.x - bx) < 0.05)
    const z0 = north ? DC_ROW_Z : tr.z
    const z1 = north ? tr.z : 18
    put(Z, 'frame', box(0.45, 0.05, Math.abs(z1 - z0), bx, tr.y, (z0 + z1) / 2))
    put(Z, 'lights', box(0.03, 0.03, Math.abs(z1 - z0) - 0.1, bx, tr.y + 0.05, (z0 + z1) / 2))
    put(Z, 'frame', box(0.05, tr.y - (north ? 3.6 : 4.3), 0.05, bx, (tr.y + (north ? 3.6 : 4.3)) / 2 + (north ? 0 : 0), z0 === tr.z ? z1 : z0))
  }
}
