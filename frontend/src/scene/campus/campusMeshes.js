import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { BALUSTRADE, CAMPUS_ZONES, GATE_COURT, ISLAND, PLATFORM_TOP, PLINTH_TOP, SIGNS, campusGeometry, signSubtitle } from './campusLayout.js'
import { campusMaterials } from './campusMaterials.js'

/**
 * Turns the campus layout into three.js meshes, merged to one mesh per material: every platform top, every plinth, all the
 * steel, all the glass, and all the edge lights (each carries its zone's accent as a vertex colour). The seven signs share
 * one texture atlas and one mesh. The whole layer is about six draw calls and a few thousand triangles, and nothing in it is
 * created or changed while the simulation runs.
 */

const accentOf = (zone) => CAMPUS_ZONES.find((z) => z.id === zone).accent
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const plane = (w, h, x, y, z, rotY = 0) => {
  const g = new THREE.PlaneGeometry(w, h)
  if (rotY) g.rotateY(rotY)
  return g.translate(x, y, z)
}

const SIGN_TILT = 0.55
const SIGN_YAW = Math.PI / 4 // towards the default camera, which looks from the south-east
const ATLAS_W = 1024
const ROW_H = 256
const ATLAS_ROWS = 8 // seven signs, rounded up to a power of two

/** One sign on its row of the atlas: the zone name and, below it, the VLAN and subnet. */
function drawSign(g, row, title, subtitle, accent) {
  const y0 = row * ROW_H
  g.clearRect(0, y0, ATLAS_W, ROW_H)
  g.fillStyle = '#13306e'
  g.fillRect(0, y0, ATLAS_W, ROW_H)
  g.fillStyle = accent
  g.fillRect(0, y0, ATLAS_W, 14)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  g.font = '700 84px Inter, "Segoe UI", Arial, sans-serif'
  g.fillText(title.toUpperCase(), ATLAS_W / 2, y0 + (subtitle ? 104 : 140), ATLAS_W - 60)
  if (subtitle) {
    g.fillStyle = '#cfe0ff'
    g.font = '500 46px "JetBrains Mono", Consolas, monospace'
    g.fillText(subtitle, ATLAS_W / 2, y0 + 192, ATLAS_W - 60)
  }
}

/** Draws all signs onto one canvas texture; redraws them once the bundled fonts are ready. */
function signAtlas(rows) {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_W
  canvas.height = ROW_H * ATLAS_ROWS
  const g = canvas.getContext('2d')
  const draw = () => rows.forEach((r, i) => drawSign(g, i, r.title, r.subtitle, r.accent))
  draw()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (document.fonts?.load) {
    Promise.all([document.fonts.load('700 84px Inter'), document.fonts.load('500 46px "JetBrains Mono"')])
      .then(() => {
        draw()
        texture.needsUpdate = true
      })
      .catch(() => {})
  }
  return texture
}

/** Gives every vertex of a geometry one colour, so differently coloured pieces can share a mesh. */
function paint(geometry, color) {
  const n = geometry.attributes.position.count
  const data = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) color.toArray(data, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3))
  return geometry
}

/**
 * @param {{nodes: any[], links: any[], zones: any[], subnets: any[]}} topology
 * @returns {{parts: {key: string, geometry: THREE.BufferGeometry, material: THREE.Material, cast: boolean, receive: boolean, order: number}[],
 *            signs: {geometry: THREE.BufferGeometry, material: THREE.Material, texture: THREE.Texture}, dispose: () => void}}
 */
export function buildCampus(topology) {
  const campus = campusGeometry(topology)
  const buckets = new Map()
  const put = (zone, kind, geometry) => {
    if (kind === 'lights') paint(geometry, new THREE.Color(accentOf(zone)).multiplyScalar(0.8))
    if (!buckets.has(kind)) buckets.set(kind, [])
    buckets.get(kind).push(geometry)
  }

  /** A raised platform: a plinth step, the platform, and a thin edge light in the zone's colour. */
  const platform = (zone, r, inlay) => {
    const w = r.x1 - r.x0
    const d = r.z1 - r.z0
    const cx = (r.x0 + r.x1) / 2
    const cz = (r.z0 + r.z1) / 2
    put(zone, 'plinth', box(w + 0.3, PLINTH_TOP, d + 0.3, cx, PLINTH_TOP / 2, cz))
    put(zone, 'top', box(w, PLATFORM_TOP, d, cx, PLATFORM_TOP / 2, cz))
    const y = PLATFORM_TOP + 0.004
    put(zone, 'lights', box(w - 0.06, 0.012, 0.05, cx, y, r.z0 + 0.04))
    put(zone, 'lights', box(w - 0.06, 0.012, 0.05, cx, y, r.z1 - 0.04))
    put(zone, 'lights', box(0.05, 0.012, d - 0.06, r.x0 + 0.04, y, cz))
    put(zone, 'lights', box(0.05, 0.012, d - 0.06, r.x1 - 0.04, y, cz))
    if (inlay) {
      // a fine light line on the floor, inside the frame
      const m = 0.16
      put(zone, 'lights', box(inlay.x1 - inlay.x0 - 2 * m, 0.012, 0.035, (inlay.x0 + inlay.x1) / 2, y, inlay.z0 + m))
      put(zone, 'lights', box(inlay.x1 - inlay.x0 - 2 * m, 0.012, 0.035, (inlay.x0 + inlay.x1) / 2, y, inlay.z1 - m))
      put(zone, 'lights', box(0.035, 0.012, inlay.z1 - inlay.z0 - 2 * m, inlay.x0 + m, y, (inlay.z0 + inlay.z1) / 2))
      put(zone, 'lights', box(0.035, 0.012, inlay.z1 - inlay.z0 - 2 * m, inlay.x1 - m, y, (inlay.z0 + inlay.z1) / 2))
    }
  }

  for (const s of campus.structures) {
    if (!s.onCourt) platform(s.zone, s.platform, s.r)
    const top = PLATFORM_TOP + s.h
    for (const b of s.beams) {
      put(s.zone, 'frame', b.side === 'N' ? box(b.x1 - b.x0, 0.1, 0.1, (b.x0 + b.x1) / 2, top - 0.05, b.z0) : box(0.1, 0.1, b.z1 - b.z0, b.x0, top - 0.05, (b.z0 + b.z1) / 2))
    }
    for (const p of s.posts) put(s.zone, 'frame', box(0.1, s.h, 0.1, p.x, PLATFORM_TOP + s.h / 2, p.z))
    const paneH = s.h - 0.1
    for (const p of s.panes) {
      const len = p.u1 - p.u0
      const mid = (p.u0 + p.u1) / 2
      put(s.zone, 'glass', p.edge === 'N' ? plane(len, paneH, mid, PLATFORM_TOP + paneH / 2, s.r.z0) : plane(len, paneH, s.r.x0, PLATFORM_TOP + paneH / 2, mid, Math.PI / 2))
    }
  }

  // the round core pavilion
  {
    const c = campus.core
    const [cx, cz] = c.center
    put(c.zone, 'plinth', new THREE.CylinderGeometry(c.platformRadius + 0.3, c.platformRadius + 0.3, PLINTH_TOP, 72).translate(cx, PLINTH_TOP / 2, cz))
    put(c.zone, 'top', new THREE.CylinderGeometry(c.platformRadius, c.platformRadius, PLATFORM_TOP, 72).translate(cx, PLATFORM_TOP / 2, cz))
    put(c.zone, 'lights', new THREE.RingGeometry(c.platformRadius - 0.09, c.platformRadius - 0.04, 72).rotateX(-Math.PI / 2).translate(cx, PLATFORM_TOP + 0.005, cz))
    for (const p of c.columns) put(c.zone, 'frame', box(0.1, c.h, 0.1, p.x, PLATFORM_TOP + c.h / 2, p.z))
    put(c.zone, 'frame', new THREE.TorusGeometry(c.columnRadius, 0.05, 8, 72).rotateX(Math.PI / 2).translate(cx, PLATFORM_TOP + c.h, cz))
  }

  platform(GATE_COURT.zone, GATE_COURT.platform, null)
  platform(ISLAND.zone, ISLAND.platform, null)

  // the low glass balustrade where the opaque perimeter wall stood
  for (const [a, b] of BALUSTRADE.spans) {
    const len = b - a
    const mid = (a + b) / 2
    const h = BALUSTRADE.height
    put('gate', 'glass', plane(len, h, BALUSTRADE.x, h / 2, mid, Math.PI / 2))
    put('gate', 'frame', box(0.06, 0.05, len, BALUSTRADE.x, h + 0.02, mid))
    put('gate', 'plinth', box(0.18, 0.1, len, BALUSTRADE.x, 0.05, mid))
    for (let z = a; z <= b + 0.01; z += 2.8) put('gate', 'frame', box(0.07, h, 0.07, BALUSTRADE.x, h / 2, z))
  }

  // raised signs: a tilted plaque on two small legs, facing the default camera; its text is a quad sampling one atlas row
  const rows = SIGNS.map((sign) => {
    const zone = CAMPUS_ZONES.find((z) => z.id === sign.zone)
    return { title: zone.name, subtitle: signSubtitle(topology, zone), accent: zone.accent }
  })
  const faces = []
  SIGNS.forEach((sign, i) => {
    const hb = sign.w / 4
    const place = (g) => g.rotateY(SIGN_YAW).translate(sign.x, 0, sign.z)
    const lift = Math.cos(SIGN_TILT) * (hb / 2) + 0.2
    // the board is unlit, in the zone's accent colour: a lit back that faces away from the sky and the key light looks black
    put(sign.zone, 'lights', place(new THREE.BoxGeometry(sign.w + 0.08, hb + 0.06, 0.04).rotateX(-SIGN_TILT).translate(0, lift, 0)))
    for (const lx of [-sign.w / 3, sign.w / 3]) put(sign.zone, 'frame', place(new THREE.BoxGeometry(0.06, lift, 0.06).translate(lx, lift / 2 - 0.03, -0.12)))
    const face = new THREE.PlaneGeometry(sign.w, hb)
    const uv = face.attributes.uv
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1 - uv.getY(k)) / ATLAS_ROWS) // this sign's row of the atlas
    faces.push(place(face.translate(0, 0, 0.026).rotateX(-SIGN_TILT).translate(0, lift, 0)))
  })
  const atlas = signAtlas(rows)
  const signs = {
    geometry: mergeGeometries(faces, false),
    texture: atlas,
    material: new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false }),
  }
  for (const g of faces) g.dispose()

  const parts = []
  for (const [kind, geometries] of buckets) {
    const geometry = mergeGeometries(geometries, false)
    for (const g of geometries) g.dispose()
    const solid = kind === 'top' || kind === 'plinth'
    parts.push({ key: kind, geometry, material: campusMaterials[kind], cast: solid, receive: solid, order: kind === 'glass' ? 2 : 0 })
  }

  return {
    parts,
    signs,
    dispose() {
      for (const p of parts) p.geometry.dispose()
      signs.geometry.dispose()
      signs.texture.dispose()
      signs.material.dispose()
    },
  }
}
