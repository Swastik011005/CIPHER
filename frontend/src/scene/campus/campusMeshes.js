import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { BALUSTRADE, CAMPUS_ZONES, GATE_COURT, ISLAND, PLATFORM_TOP, PLINTH_TOP, SIGNS, campusGeometry, devicePads, roadRects, signSubtitle, zoneVolumes } from './campusLayout.js'
import { campusMaterials } from './campusMaterials.js'
import { buildArchitecture } from './campusBuildings.js'
import { DC_LABELS, buildDataCentre } from './campusDataCentre.js'
import { CABINETS, ENTRANCE, RECEPTION_DESK, SERVER_CABINETS, SOC_STATIONS, SOC_WALL, WALL_CABINETS } from './campusDecor.js'

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

/** Equipment labels of the data centre: one texture, a row per label, one draw call. */
const LABEL_ROWS = 16
function labelTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 64 * LABEL_ROWS
  const ctx = canvas.getContext('2d')
  DC_LABELS.forEach((text, i) => {
    ctx.fillStyle = '#0d1d3a'
    ctx.fillRect(0, i * 64, 512, 64)
    ctx.strokeStyle = '#4d78b8'
    ctx.lineWidth = 4
    ctx.strokeRect(3, i * 64 + 3, 506, 58)
    ctx.fillStyle = '#cfe0f8'
    ctx.font = 'bold 34px Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, i * 64 + 33)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const SIGN_TILT = 0.2
const SIGN_YAW = Math.PI / 4 // towards the default camera, which looks from the south-east
const SIGN_SCALE = 1
const ATLAS_W = 1024
const ROW_H = 256
const ATLAS_ROWS = 8 // seven signs, rounded up to a power of two

/** One sign on its row of the atlas: the zone name and, below it, the VLAN and subnet. */
function drawSign(g, row, title, subtitle, accent) {
  const y0 = row * ROW_H
  g.clearRect(0, y0, ATLAS_W, ROW_H)
  g.fillStyle = '#0a1c44'
  g.fillRect(0, y0, ATLAS_W, ROW_H)
  g.fillStyle = accent
  g.fillRect(0, y0, ATLAS_W, 18)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  g.font = '800 96px Inter, "Segoe UI", Arial, sans-serif'
  g.fillText(title.toUpperCase(), ATLAS_W / 2, y0 + (subtitle ? 108 : 140), ATLAS_W - 40)
  if (subtitle) {
    g.fillStyle = '#eaf2ff'
    g.font = '600 52px "JetBrains Mono", Consolas, monospace'
    g.fillText(subtitle, ATLAS_W / 2, y0 + 196, ATLAS_W - 40)
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
    Promise.all([document.fonts.load('800 96px Inter'), document.fonts.load('600 52px "JetBrains Mono"')])
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
 *            signs: {geometry: THREE.BufferGeometry, material: THREE.Material, texture: THREE.Texture},
 *            zoneGeometry: Record<string, {floor: THREE.BufferGeometry, outline: THREE.BufferGeometry}>, dispose: () => void}}
 */
export function buildCampus(topology) {
  const campus = campusGeometry(topology)
  const buckets = new Map()
  const put = (zone, kind, geometry) => {
    if (kind === 'lights') paint(geometry, new THREE.Color(accentOf(zone)).multiplyScalar(0.5))
    if (!buckets.has(kind)) buckets.set(kind, [])
    buckets.get(kind).push(geometry)
  }

  /** Monitoring-wall and station screens, merged per picture so the wall costs one draw call per kind. */
  const screenBuckets = new Map()
  const screen = (kind, geometry) => {
    if (!screenBuckets.has(kind)) screenBuckets.set(kind, [])
    screenBuckets.get(kind).push(geometry)
  }
  const WALL_KINDS = ['live-alerts', 'live-stats', 'live-endpoints', 'live-traffic']

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
      put(s.zone, 'frame', b.side === 'N' ? box(b.x1 - b.x0, 0.4, 0.16, (b.x0 + b.x1) / 2, top - 0.2, b.z0) : box(0.16, 0.4, b.z1 - b.z0, b.x0, top - 0.2, (b.z0 + b.z1) / 2))
    }
    for (const p of s.posts) put(s.zone, 'frame', box(0.16, s.h, 0.16, p.x, PLATFORM_TOP + s.h / 2, p.z))
    const paneH = s.h - 0.1
    for (const p of s.panes) {
      const len = p.u1 - p.u0
      const mid = (p.u0 + p.u1) / 2
      put(s.zone, 'glass', p.edge === 'N' ? plane(len, paneH, mid, PLATFORM_TOP + paneH / 2, s.r.z0) : plane(len, paneH, s.r.x0, PLATFORM_TOP + paneH / 2, mid, Math.PI / 2))
    }
  }

  // the finish of the glass buildings (cyan rail lights, the administration canopy)
  buildArchitecture(put, box, campus.structures, campus.core, topology)

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

  // Grey roads between the zones: flat, on the ground, below the cables (one draw call).
  for (const r of roadRects()) put('gate', 'road', box(r.x1 - r.x0, 0.04, r.z1 - r.z0, (r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2))

  // Campus infrastructure (decoration only): entrance, cabinets, server cabinets, monitoring wall and stations.
  const T = PLATFORM_TOP
  {
    const b = ENTRANCE.booth
    const [bx, bz, bw, bd] = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.z1 - b.z0]
    put('gate', 'glass', box(bw, 2.5, bd, bx, 1.3, bz))
    put('gate', 'frame', box(bw + 0.3, 0.12, bd + 0.3, bx, 2.6, bz))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put('gate', 'frame', box(0.12, 2.5, 0.12, bx + (sx * bw) / 2, 1.3, bz + (sz * bd) / 2))
  }
  for (const [x, z, w, d] of CABINETS) {
    put('staff', 'cabinet', box(w, 2.1, d, x, 1.05, z))
    put('staff', 'lights', box(w > d ? 0.5 : 0.04, 1.2, w > d ? 0.04 : 0.5, x + (w > d ? 0 : (w / 2 + 0.01) * (x > 30 ? -1 : 1)), 1.2, z + (w > d ? d / 2 + 0.01 : 0)))
  }
  {
    const d = RECEPTION_DESK
    put('gate', 'cabinet', box(d.w, 1.1, d.d, d.x, T + 0.55, d.z))
    put('gate', 'frame', box(d.w + 0.1, 0.06, d.d + 0.1, d.x, T + 1.13, d.z))
    put('gate', 'lights', box(d.w - 0.3, 0.03, 0.03, d.x, T + 0.9, d.z + d.d / 2 + 0.02))
    for (const dx of [-1.0, 1.0]) {
      put('gate', 'cabinet', box(0.7, 0.05, 0.1, d.x + dx, T + 1.15, d.z - 0.15))
      screen('live-stats', new THREE.PlaneGeometry(0.62, 0.4).translate(d.x + dx, T + 1.45, d.z - 0.08))
    }
  }
  for (const [zone, x, z] of WALL_CABINETS) {
    put(zone, 'cabinet', box(1.6, 2.2, 0.5, x, T + 1.1, z))
    for (const dx of [-0.4, 0.4]) put(zone, 'frame', box(0.7, 0.04, 0.02, x + dx, T + 1.5, z + 0.26))
    for (const dy of [0.7, 1.9]) put(zone, 'lights', box(0.1, 0.04, 0.02, x + 0.55, T + dy, z + 0.26))
  }
  const labelFaces = []
  const label = (index, geometry) => {
    const uv = geometry.attributes.uv
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (index + 1 - uv.getY(k)) / LABEL_ROWS)
    labelFaces.push(geometry)
  }
  buildDataCentre(put, screen, label)
  for (const [x, z] of SERVER_CABINETS) {
    label(9, new THREE.PlaneGeometry(1.2, 0.3).translate(x, T + 3.05, z + 0.7))
    put('datacentre', 'cabinet', box(1.5, 3.3, 1.35, x, T + 1.65, z))
    for (const dx of [-0.4, 0, 0.4]) put('datacentre', 'lights', box(0.12, 2.4, 0.04, x + dx, T + 1.65, z + 0.69))
  }
  {
    const w = SOC_WALL
    const span = w.z1 - w.z0
    put('soc', 'cabinet', box(0.22, 1.9, span, w.x, T + 2.4, (w.z0 + w.z1) / 2))
    for (let k = 0; k < w.screens; k++) screen(WALL_KINDS[k % WALL_KINDS.length], new THREE.PlaneGeometry(span / w.screens - 0.25, 1.45).rotateY(Math.PI / 2).translate(w.x + 0.12, T + 2.4, w.z0 + (span * (k + 0.5)) / w.screens))
    put('soc', 'cabinet', box(1.0, 0.95, span - 0.6, w.x + 1.7, T + 0.48, (w.z0 + w.z1) / 2))
    for (const [x, z] of SOC_STATIONS) {
      put('soc', 'frame', box(3.2, 0.12, 1.5, x, T + 1.0, z))
      for (const dx of [-1.4, 1.4]) put('soc', 'frame', box(0.1, 1.0, 1.3, x + dx, T + 0.5, z))
      for (const dx of [-0.85, 0.85]) {
        put('soc', 'cabinet', box(1.4, 0.95, 0.1, x + dx, T + 1.65, z - 0.45))
        screen(dx < 0 ? 'live-alerts' : 'live-stats', new THREE.PlaneGeometry(1.25, 0.8).translate(x + dx, T + 1.65, z - 0.34))
      }
    }
  }
  // Darker mounting pads under the devices, and a soft contact shadow on them: the clay devices read against a darker ground,
  // in Low as well as High. Both are flat and merged: one draw call each.
  for (const pad of devicePads(topology)) {
    put('staff', 'pad', box(pad.w, 0.012, pad.d, pad.x, PLATFORM_TOP + 0.006, pad.z))
    put('staff', 'blob', new THREE.PlaneGeometry(pad.w + 0.7, pad.d + 0.7).rotateX(-Math.PI / 2).translate(pad.x, PLATFORM_TOP + 0.013, pad.z))
  }

  // Per-zone highlight geometry for hover, selection and dimming: a floor outline of each pavilion and its volume's edges.
  const zones = {}
  const FLOOR_Y = PLATFORM_TOP + 0.02
  for (const v of zoneVolumes()) {
    const z = (zones[v.zone] ??= { floors: [], edges: [] })
    if (v.shape === 'box') {
      const w = v.x1 - v.x0
      const d = v.z1 - v.z0
      z.floors.push(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate((v.x0 + v.x1) / 2, FLOOR_Y, (v.z0 + v.z1) / 2))
      z.edges.push(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, v.h, d)).translate((v.x0 + v.x1) / 2, v.h / 2, (v.z0 + v.z1) / 2))
    } else {
      z.floors.push(new THREE.CircleGeometry(v.radius, 64).rotateX(-Math.PI / 2).translate(v.cx, FLOOR_Y, v.cz))
      z.edges.push(new THREE.EdgesGeometry(new THREE.CylinderGeometry(v.radius, v.radius, v.h, 64), 30).translate(v.cx, v.h / 2, v.cz))
    }
  }
  const zoneGeometry = {}
  for (const [id, z] of Object.entries(zones)) {
    zoneGeometry[id] = { floor: mergeGeometries(z.floors, false), outline: mergeGeometries(z.edges, false) }
    for (const g of [...z.floors, ...z.edges]) g.dispose()
  }

  // raised signs: a tilted plaque on two small legs, facing the default camera; its text is a quad sampling one atlas row
  const rows = SIGNS.map((sign) => {
    const zone = CAMPUS_ZONES.find((z) => z.id === sign.zone)
    return { title: zone.name, subtitle: signSubtitle(topology, zone), accent: zone.accent }
  })
  const faces = []
  SIGNS.forEach((raw, i) => {
    const sign = { ...raw, w: raw.w * SIGN_SCALE } // a little larger than first drawn: readable from the default camera
    const hb = sign.w / 4
    const place = (g) => g.rotateY(SIGN_YAW).translate(sign.x, 0, sign.z)
    const lift = raw.y + Math.cos(SIGN_TILT) * (hb / 2)
    // the board is unlit, in the zone's accent colour: a lit back that faces away from the sky and the key light looks black
    put(sign.zone, 'lights', place(new THREE.BoxGeometry(sign.w + 0.08, hb + 0.06, 0.04).rotateX(-SIGN_TILT).translate(0, lift, 0)))
    for (const lx of [-sign.w / 3, sign.w / 3]) put(sign.zone, 'frame', place(new THREE.BoxGeometry(0.1, raw.y - raw.base + hb * 0.3, 0.1).translate(lx, (raw.y - raw.base + hb * 0.3) / 2 + raw.base, -0.1)))
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

  const screens = [...screenBuckets].map(([kind, list]) => {
    const geometry = mergeGeometries(list, false)
    for (const g of list) g.dispose()
    return { kind, geometry }
  })

  const labelAtlas = labelTexture()
  const labels = {
    geometry: mergeGeometries(labelFaces, false),
    texture: labelAtlas,
    material: new THREE.MeshBasicMaterial({ map: labelAtlas, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  }
  for (const g of labelFaces) g.dispose()

  const parts = []
  for (const [kind, geometries] of buckets) {
    const geometry = mergeGeometries(geometries, false)
    for (const g of geometries) g.dispose()
    const solid = kind === 'top' || kind === 'plinth'
    const order = kind === 'glass' ? 2 : kind === 'blob' ? 1 : 0
    parts.push({ key: kind, geometry, material: campusMaterials[kind], cast: solid, receive: solid || kind === 'pad' || kind === 'road', order })
  }

  return {
    parts,
    screens,
    labels,
    signs,
    zoneGeometry,
    dispose() {
      for (const p of parts) p.geometry.dispose()
      for (const sc of screens) sc.geometry.dispose()
      for (const g of Object.values(zoneGeometry)) {
        g.floor.dispose()
        g.outline.dispose()
      }
      labels.geometry.dispose()
      labels.texture.dispose()
      labels.material.dispose()
      signs.geometry.dispose()
      signs.texture.dispose()
      signs.material.dispose()
    },
  }
}
