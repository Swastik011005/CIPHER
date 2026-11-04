#!/usr/bin/env node
/**
 * Visual prototype of the revised Smart Campus, drawn in the REAL application renderer.
 *
 *   node docs/design/campus-c1/prototype.mjs --base http://127.0.0.1:8000 [--out folder] [--ground "#c9d6e8"] [--bg "#1b3566"]
 *
 * Needs the app running in demo mode (python scripts/tasks.py demo) and Chrome. It opens the app with the three.js
 * developer hook installed, captures each camera preset (BEFORE), then adds the proposed platforms, steel frames and glass
 * to the live scene, hides the old slabs, opaque perimeter wall and partial glass partition, and captures the same presets
 * (AFTER). The devices, cables, lights, shadows, ambient occlusion and bloom are the application's own.
 *
 * It changes nothing in the application or the repository: the objects exist only in that browser session.
 * Geometry and positions come from proposal.json (written by generate.mjs).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openBrowser, sleep, waitFor } from '../../../scripts/lib/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const out = resolve(args.out ?? join(here, 'prototype'))
const views = (args.views ?? 'overview,staff,servers,secops').split(',')
const only = args.only ?? 'both'
const proposal = JSON.parse(readFileSync(join(here, 'proposal.json'), 'utf8'))
mkdirSync(out, { recursive: true })

// three.js announces every renderer and scene it creates to this hook, if it exists when the page loads.
const HOOK = `window.__cap = { scenes: [] }; const dev = new EventTarget(); window.__THREE_DEVTOOLS__ = dev; dev.addEventListener('observe', (e) => { if (e.detail && e.detail.isScene) window.__cap.scenes.push(e.detail) })`

/** Runs inside the page. Self-contained: no closures. */
function apply(P) {
  let scene = null
  let best = -1
  for (const s of window.__cap.scenes) {
    let n = 0
    s.traverse((o) => { if (o.isMesh) n += 1 })
    if (n > best) [best, scene] = [n, s]
  }
  if (!scene || best < 50) return { error: `no application scene found (${best} meshes)` }
  const C = {}
  scene.traverse((o) => {
    if (o.text !== undefined && typeof o.fontSize === 'number') return // text meshes use a derived material class: do not borrow it
    if (o.isMesh) {
      C.Mesh ??= o.constructor
      if (o.geometry) C[o.geometry.type] ??= o.geometry.constructor
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      if (m) {
        C[m.type] ??= m.constructor
        if (m.color) C.Color ??= m.color.constructor
        if (m.map) C.Texture ??= m.map.constructor
      }
    }
    if (o.isGroup) C.Group ??= o.constructor
  })
  const need = ['Mesh', 'BoxGeometry', 'CylinderGeometry', 'TorusGeometry', 'RingGeometry', 'PlaneGeometry', 'MeshStandardMaterial', 'MeshBasicMaterial', 'Texture', 'Group']
  const missing = need.filter((k) => !C[k])
  if (missing.length) return { error: `missing three.js classes: ${missing.join(', ')}` }

  // ---- hide what the proposal replaces
  const near = (a, b, e = 0.02) => Math.abs(a - b) <= e
  const hiddenKinds = { slabs: 0, captions: 0, wall: 0, partition: 0 }
  scene.traverse((o) => {
    if (!o.isMesh) return
    o.updateWorldMatrix(true, false)
    const e = o.matrixWorld.elements
    const [x, y, z] = [e[12], e[13], e[14]]
    if (o.text !== undefined && typeof o.fontSize === 'number') { o.visible = false; hiddenKinds.captions += 1; return }
    const g = o.geometry
    const pr = g && g.parameters
    if (!pr || pr.width === undefined) return
    for (const s of Object.values(P.oldSlabs)) {
      if (near(x, s.cx) && near(z, s.cz) && near(y, 0.15) && near(pr.width, s.sx) && near(pr.height, 0.3) && near(pr.depth, s.sz)) { o.visible = false; hiddenKinds.slabs += 1; return }
    }
    if (near(x, P.wall.x) && near(pr.width, 0.35) && near(pr.height, 0.8)) { o.visible = false; hiddenKinds.wall += 1; return }
    const m = o.material
    if (g.type === 'BoxGeometry' && m && m.transparent && near(m.opacity, 0.13, 0.005)) { o.visible = false; hiddenKinds.partition += 1; return }
    if (g.type === 'BoxGeometry' && near(pr.width, 0.1) && near(pr.height, 1.7) && near(pr.depth, 0.1)) { o.visible = false; hiddenKinds.partition += 1; return }
    if (near(pr.width, 35.2) && near(pr.depth, 30) && near(pr.height, 0.6)) o.material = new C.MeshStandardMaterial({ color: P.ground, roughness: 0.92 })
    if (near(pr.width, 7.5) && near(pr.depth, 18) && near(pr.height, 0.6)) o.material = new C.MeshStandardMaterial({ color: P.island, roughness: 0.92 })
  })
  if (scene.background && scene.background.set) scene.background.set(P.bg)
  if (scene.fog && scene.fog.color) scene.fog.color.set(P.bg)

  // ---- build the proposal
  const group = new C.Group()
  group.name = 'campus-prototype'
  const std = (color, extra) => Object.assign(new C.MeshStandardMaterial({ color, roughness: 0.6 }), extra)
  const basic = (color, k) => {
    const m = new C.MeshBasicMaterial({ color })
    m.color.multiplyScalar(k)
    m.toneMapped = false
    return m
  }
  const mats = {
    top: std('#f1f5fb', { roughness: 0.85 }),
    plinth: std('#b9c7dc', { roughness: 0.85 }),
    frame: std('#dde6f2', { roughness: 0.35, metalness: 0.5 }),
    glass: std('#9cc8ff', { roughness: 0.08, transparent: true, opacity: P.glassOpacity, depthWrite: false, side: 2 }),
  }
  const place = (geometry, material, x, y, z, opts) => {
    const m = new C.Mesh(geometry, material)
    m.position.set(x, y, z)
    if (opts && opts.cast) m.castShadow = true
    if (opts && opts.receive) m.receiveShadow = true
    if (opts && opts.rotate) m.rotation.set(...opts.rotate)
    group.add(m)
    return m
  }
  const box = (w, h, d, material, x, y, z, opts) => place(new C.BoxGeometry(w, h, d), material, x, y, z, opts)
  const TOP = 0.3

  const platform = (r, accent) => {
    const w = r.x1 - r.x0
    const d = r.z1 - r.z0
    const cx = (r.x0 + r.x1) / 2
    const cz = (r.z0 + r.z1) / 2
    box(w + 0.3, 0.12, d + 0.3, mats.plinth, cx, 0.06, cz)
    box(w, TOP, d, mats.top, cx, TOP / 2, cz, { cast: true, receive: true })
    const edge = basic(accent, 0.9)
    box(w - 0.06, 0.012, 0.05, edge, cx, TOP + 0.004, r.z0 + 0.04)
    box(w - 0.06, 0.012, 0.05, edge, cx, TOP + 0.004, r.z1 - 0.04)
    box(0.05, 0.012, d - 0.06, edge, r.x0 + 0.04, TOP + 0.004, cz)
    box(0.05, 0.012, d - 0.06, edge, r.x1 - 0.04, TOP + 0.004, cz)
  }
  const accentOf = (zone) => P.accents[zone] ?? '#4da3ff'

  for (const s of P.structures) {
    if (s.id !== 'edge') platform(s.platform, accentOf(s.zone))
    const r = s.rect
    const cx = (r.x0 + r.x1) / 2
    const cz = (r.z0 + r.z1) / 2
    box(r.x1 - r.x0, 0.1, 0.1, mats.frame, cx, TOP + s.height - 0.05, r.z0)
    box(0.1, 0.1, r.z1 - r.z0, mats.frame, r.x0, TOP + s.height - 0.05, cz)
    for (const p of P.posts.filter((q) => q.s === s.id)) box(0.1, s.height, 0.1, mats.frame, p.x, TOP + s.height / 2, p.z)
    // glass: north and west sides, cut at the cable openings
    const paneH = s.height - 0.1
    for (const edge of s.glassSides) {
      const cuts = P.openings.filter((o) => o.structure === s.id && o.edge === edge).sort((a, b) => a.u0 - b.u0)
      const [a0, a1] = edge === 'N' ? [r.x0, r.x1] : [r.z0, r.z1]
      const segs = []
      let cur = a0
      for (const c of cuts) { segs.push([cur, c.u0]); cur = c.u1 }
      segs.push([cur, a1])
      for (const [u, v] of segs.filter(([p, q]) => q - p > 0.05)) {
        const geo = new C.PlaneGeometry(v - u, paneH)
        if (edge === 'N') place(geo, mats.glass, (u + v) / 2, TOP + paneH / 2, r.z0)
        else place(geo, mats.glass, r.x0, TOP + paneH / 2, (u + v) / 2, { rotate: [0, Math.PI / 2, 0] })
      }
    }
    // a thin light line on the floor inside the frame
    const inl = basic(accentOf(s.zone), 0.55)
    const m = 0.16
    box(r.x1 - r.x0 - 2 * m, 0.012, 0.035, inl, cx, TOP + 0.004, r.z0 + m)
    box(r.x1 - r.x0 - 2 * m, 0.012, 0.035, inl, cx, TOP + 0.004, r.z1 - m)
    box(0.035, 0.012, r.z1 - r.z0 - 2 * m, inl, r.x0 + m, TOP + 0.004, cz)
    box(0.035, 0.012, r.z1 - r.z0 - 2 * m, inl, r.x1 - m, TOP + 0.004, cz)
  }
  for (const o of P.openPlatforms) platform(o.rect, accentOf(o.zone))

  // core hub: round platform, eight columns, a thin ring beam, no roof
  {
    const c = P.canopy
    place(new C.CylinderGeometry(c.platformRadius + 0.3, c.platformRadius + 0.3, 0.12, 72), mats.plinth, c.center[0], 0.06, c.center[1])
    place(new C.CylinderGeometry(c.platformRadius, c.platformRadius, TOP, 72), mats.top, c.center[0], TOP / 2, c.center[1], { cast: true, receive: true })
    place(new C.RingGeometry(c.platformRadius - 0.09, c.platformRadius - 0.04, 72), basic(accentOf('core'), 0.9), c.center[0], TOP + 0.005, c.center[1], { rotate: [-Math.PI / 2, 0, 0] })
    for (const p of P.posts.filter((q) => q.s === 'core')) box(0.1, c.h, 0.1, mats.frame, p.x, TOP + c.h / 2, p.z)
    place(new C.TorusGeometry(c.columnRadius, 0.05, 8, 72), mats.frame, c.center[0], TOP + c.h, c.center[1], { rotate: [Math.PI / 2, 0, 0] })
  }

  // low glass balustrade where the opaque perimeter wall stood
  {
    const w = P.wall
    for (const [a, b] of [[w.zFrom, -w.gateHalf], [w.gateHalf, w.zTo]]) {
      const len = b - a
      const mid = (a + b) / 2
      place(new C.PlaneGeometry(len, 0.9), mats.glass, w.x, 0.45, mid, { rotate: [0, Math.PI / 2, 0] })
      box(0.06, 0.05, len, mats.frame, w.x, 0.92, mid)
      box(0.18, 0.1, len, mats.plinth, w.x, 0.05, mid)
      for (let z = a; z <= b + 0.01; z += 2.8) box(0.07, 0.9, 0.07, mats.frame, w.x, 0.45, z)
    }
  }

  // zone names, lying flat on the ground in front of each platform
  const label = (text, x, z, width, y) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 128
    const g = canvas.getContext('2d')
    g.font = '700 74px Inter, Segoe UI, Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = 14
    g.strokeStyle = 'rgba(255,255,255,0.9)'
    g.strokeText(text, 512, 66)
    g.fillStyle = '#13306e'
    g.fillText(text, 512, 66)
    const tex = new C.Texture(canvas)
    tex.colorSpace = 'srgb'
    tex.needsUpdate = true
    const mat = new C.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    mat.toneMapped = false
    const m = new C.Mesh(new C.PlaneGeometry(width, width / 8), mat)
    m.position.set(x, y ?? 0.03, z)
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 4)
    group.add(m)
  }
  for (const l of P.labels) label(l.text, l.x, l.z, l.w, l.y)

  scene.add(group)
  window.__cap.app = scene
  return { meshes: group.children.length, hidden: hiddenKinds }
}

const browser = await openBrowser({ width: 1680, height: 960, port: 9893 })
const ev = (c) => browser.evaluate(c)
const results = {}
try {
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK })
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the 3D scene', 40000)
  await waitFor(() => ev('window.__netsecStore.getState().topology.status === "ready" && window.__netsecScene && window.__netsecScene.meshes > 100'), 'the scene to draw', 40000)
  await ev('window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().setSetting("quality", "high"); window.__netsecStore.getState().setSetting("labels", "all")')
  await ev(`(() => { const s = document.createElement('style'); s.textContent = '.viewport__overlay,.viewport__playback,.viewport__hint,.viewport__bottom-banner{display:none!important}'; document.head.appendChild(s) })()`)

  const shot = async (name, preset) => {
    await ev(`window.__netsecStore.getState().requestPreset('${preset}')`)
    await sleep(2800)
    const r = await ev('(() => { const b = document.querySelector("canvas").getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } })()')
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } })
    writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'))
    const stats = await ev('window.__netsecScene')
    console.log(`${name}.png  ${Math.round(r.width)}x${Math.round(r.height)}  meshes ${stats.meshes}, ${Math.round(stats.triangles / 1000)}k triangles`)
    return stats
  }

  if (only !== 'after') for (const v of views) results[`before-${v}`] = await shot(`before-${v}`, v)

  if (only !== 'before') {
    const payload = {
      oldSlabs: proposal.oldSlabs, wall: proposal.perimeterWall, structures: proposal.structures, posts: proposal.posts, openings: proposal.openings,
      canopy: { ...proposal.canopy, h: 3.0 }, openPlatforms: proposal.openPlatforms, accents: Object.fromEntries(proposal.zones.map((z) => [z.id, z.accent])),
      ground: args.ground ?? '#6b82ad', island: args.island ?? '#5d749f', bg: args.bg ?? '#1d3a6e', glassOpacity: Number(args.glass ?? 0.2),
      // positions clear the platform step: south of each platform, allowing for the label running towards the north-east
      labels: [
        { text: 'STAFF AND ACADEMIC', x: 11.1, z: -2.8, w: 5.0 }, { text: 'ADMINISTRATION', x: 18.5, z: -3.2, w: 4.2 }, { text: 'DATA CENTRE', x: 14.5, z: 11.4, w: 4.2 },
        { text: 'SECURITY OPERATIONS', x: 0.2, z: 13.6, w: 5.6 }, { text: 'IPS GATE', x: 9.2, z: 9.4, w: 2.6 }, { text: 'CORE HUB', x: 2.8, z: -5.7, w: 3.2 },
        { text: 'MAIN GATE AND EDGE', x: -9.2, z: 4.7, w: 5.0 }, { text: 'PUBLIC INTERNET', x: -18.6, z: 5.7, w: 4.0, y: 0.33 },
      ],
    }
    const applied = await ev(`(${apply.toString()})(${JSON.stringify(payload)})`)
    console.log('overlay:', JSON.stringify(applied))
    if (applied.error) throw new Error(applied.error)
    if (args.debug) console.log(JSON.stringify(await ev(`(() => { const g = window.__cap.app.children.find((c) => c.name === 'campus-prototype'); const labels = g.children.filter((m) => m.material && m.material.map); return labels.map((m) => ({ pos: m.position.toArray().map((v) => +v.toFixed(2)), visible: m.visible, parentVisible: m.parent.visible, w: m.material.map.image && m.material.map.image.width, transparent: m.material.transparent, rot: [m.rotation.x, m.rotation.y, m.rotation.z].map((v) => +v.toFixed(2)), renderOrder: m.renderOrder })) })()`)))
    await sleep(800)
    for (const v of views) results[`after-${v}`] = await shot(`after-${v}`, v)
    if (args.packets !== 'no') {
      // packets streaming through the pavilions: the S4 flood at its peak (about 200 packets in flight), paused at 14.3 s
      await ev('window.__netsecStore.getState().runScenario("S4", "enforce")')
      await waitFor(() => ev('window.__netsecStore.getState().run.status === "ready"'), 'S4', 30000)
      await ev('(() => { const s = window.__netsecStore.getState(); if (s.playback.playing) s.togglePlay(); s.seekTo(14.3) })()')
      await shot('after-packets-servers', 'servers')
      await shot('after-packets-overview', 'overview')
      await ev('window.__netsecStore.getState().setSetting("quality", "low")')
      await sleep(1200)
      await shot('after-low-overview', 'overview')
    }
  }
  writeFileSync(join(out, 'stats.json'), JSON.stringify(results, null, 1))
  const errors = browser.errors()
  console.log(errors.length ? `console errors: ${errors.slice(0, 3).join(' | ')}` : 'no console errors')
} finally {
  await browser.close()
}
