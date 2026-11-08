#!/usr/bin/env node
/**
 * Interaction checks for the campus, in a real Chrome window with real mouse events (no store shortcuts for picking):
 *
 *   node scripts/check_interactions.mjs --base http://127.0.0.1:8000 [--out docs/design/campus-c3/screens] [--port 9871]
 *
 * Checks: all 17 devices selectable (also inside the glass pavilions), all 7 campus zones hoverable and selectable, the
 * zone to device highlighting, device and zone selections not conflicting, the layered ground-click deselect, double-click
 * zone focus and the return to the overview, all cables selectable with the right source and destination, and the
 * separate 3D device viewer for all 12 model keys (rotate, zoom, reset, close, campus camera and playback undisturbed,
 * no leaked WebGL contexts). Everything is also repeated in Low quality. Screenshots go to --out. Needs the app in demo mode
 * (python scripts/tasks.py demo). It changes nothing in the repository except the screenshots.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CAMPUS_ZONES, PLATFORM_TOP, ZONE_OF_DEVICE, campusZone, zoneVolumes } from '../frontend/src/scene/campus/campusLayout.js'
import { DEVICE_SPECS, modelKeyFor } from '../frontend/src/scene/devices/specs.js'
import { NODE_LAYOUT } from '../frontend/src/scene/layout.js'
import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const out = resolve(args.out ?? join(here, '..', 'docs', 'design', 'campus-c3', 'screens'))
mkdirSync(out, { recursive: true })

const browser = await openBrowser({ width: 1680, height: 960, port: Number(args.port ?? 9871) })
const ev = (c) => browser.evaluate(c)
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}
const st = (path) => ev(`window.__netsecStore.getState().${path}`)
const shot = async (name) => {
  await sleep(450)
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'))
}
const toPage = (x, y, z) => ev(`window.__netsecProbe.toPage(${x}, ${y}, ${z})`)
const move = (x, y) => browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
async function click(x, y, count = 1) {
  await move(x, y)
  await sleep(60)
  for (let i = 1; i <= count; i++) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: i })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: i })
  }
  await sleep(250)
}
const cameraAt = () => ev('window.__netsecProbe.cameraPosition()')
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const labels = () => ev(`[...document.querySelectorAll('.dev-label')].map((e) => ({ name: [...e.querySelector('.dev-label__name').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim().split(/\\s/)[0], zone: e.dataset.zone ?? null }))`)

/**
 * Where to put the pointer to hover a device: its own pick box is projected to the page (centre, then a few heights and offsets,
 * since the three rack units overlap), and the first point that really hovers the device is returned.
 */
async function findDevice(id) {
  const layout = NODE_LAYOUT[id]
  const node = (await st('topology.data')).nodes.find((n) => n.id === id)
  const spec = DEVICE_SPECS[keyOf(node)]
  const [x, z] = layout.position
  const baseY = PLATFORM_TOP + (layout.y ?? 0)
  const candidates = id === 'INET' ? [[x, baseY + 0.3, z]] : [0.5, 0.3, 0.7, 0.15, 0.85].map((f) => [x, baseY + spec.height * f, z])
  for (const [wx, wy, wz] of candidates) {
    const p = await toPage(wx, wy, wz)
    if (!p) continue
    for (const [dx, dy] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) {
      await move(p.x + dx, p.y + dy)
      // hover is resolved on a rendered frame: on a slow software GPU that can take a few hundred ms, so poll for it
      for (let tries = 0; tries < 6; tries++) {
        await sleep(90)
        if ((await st('selection.hoveredId')) === id) return { x: p.x + dx, y: p.y + dy }
      }
    }
  }
  return null
}

/** A floor point of a zone's platform, away from its devices: tries the four corners of each volume. */
async function findZoneFloor(zone) {
  for (const v of zoneVolumes().filter((vol) => vol.zone === zone)) {
    const pts = v.shape === 'box'
      ? [[v.x1 - 0.4, v.z1 - 0.4], [v.x0 + 0.4, v.z1 - 0.4], [v.x1 - 0.4, v.z0 + 0.4], [v.x0 + 0.4, v.z0 + 0.4]]
      : [[v.cx + v.radius * 0.8, v.cz + v.radius * 0.4], [v.cx - v.radius * 0.8, v.cz + v.radius * 0.4]]
    for (const [x, z] of pts) {
      const p = await toPage(x, PLATFORM_TOP, z)
      if (!p) continue
      await move(p.x, p.y)
      await sleep(80)
      if ((await st('zone.hoveredId')) === zone) return p
    }
  }
  return null
}

const keyOf = (node) => modelKeyFor(node, NODE_LAYOUT[node.id])

/** Point the campus camera at a spot (the expanded campus does not fit one screen, so every target is brought into view first). */
const view = async (x, z, d = 26) => {
  await ev('window.__netsecStore.getState().dismissQualityNotice && window.__netsecStore.getState().dismissQualityNotice()') // a slow test GPU may raise the auto-quality banner over the scene
  await ev(`window.__netsecProbe.lookAt(${x}, 0.5, ${z}, ${d})`)
  await sleep(700)
}
const zoneCentre = (zone) => {
  const v = zoneVolumes().filter((vol) => vol.zone === zone)
  const xs = v.flatMap((b) => (b.shape === 'box' ? [b.x0, b.x1] : [b.cx - b.radius, b.cx + b.radius]))
  const zs = v.flatMap((b) => (b.shape === 'box' ? [b.z0, b.z1] : [b.cz - b.radius, b.cz + b.radius]))
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.5 + 8]
}
const nodeView = (id) => view(NODE_LAYOUT[id].position[0], NODE_LAYOUT[id].position[1], 22)
async function pointFor(id) {
  await nodeView(id)
  const found = await findDevice(id)
  if (!found) console.log(`  (diagnostic: ${id} not hoverable; zone=${JSON.stringify(await st('zone'))}, hovered=${await st('selection.hoveredId')}, camera=${JSON.stringify(await cameraAt())})`)
  return found
}

try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecStore.getState().topology.status === "ready" && window.__netsecScene && window.__netsecScene.meshes > 100 && !!window.__netsecProbe'), 'the scene', 60000)
  await ev('window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().setSetting("quality", "high")')
  await sleep(1500)
  const topology = await st('topology.data')
  const nodes = topology.nodes
  const overview = await cameraAt()

  async function interactionSuite(quality) {
    const q = quality === 'high' ? '' : '-low'
    console.log(`\n== ${quality.toUpperCase()} quality`)
    await ev(`window.__netsecStore.getState().setSetting("quality", ${JSON.stringify(quality)}); window.__netsecStore.getState().clearEverything(); window.__netsecStore.getState().requestPreset("overview")`)
    await sleep(2200)

    // -- devices: every one of the 17 is hoverable and selectable with a real click, also inside the glass
    const devicePoints = {}
    let selectable = 0
    let zoneStolen = 0
    for (const node of nodes) {
      await ev('window.__netsecStore.getState().clearEverything()')
      await nodeView(node.id)
      const p = await findDevice(node.id)
      devicePoints[node.id] = p
      if (!p) {
        console.log(`  (no pointer position hovers ${node.id})`)
        continue
      }
      await click(p.x, p.y)
      if ((await st('selection.selectedId')) === node.id) selectable += 1
      if ((await st('zone.selectedId')) !== null) zoneStolen += 1
    }
    check(`all ${nodes.length} devices (17 original + ${nodes.length - 17} extension) can be hovered and selected by a real click`, selectable === nodes.length, `${selectable}/${nodes.length}`)
    check('clicking a device never selects the zone around it', zoneStolen === 0)

    // -- zones: hover and click each of the 7
    let hovered = 0
    let selected = 0
    let highlighted = 0
    let dimmed = 0
    for (const zone of CAMPUS_ZONES) {
      await ev('window.__netsecStore.getState().clearEverything()')
      await view(...zoneCentre(zone.id))
      const p = await findZoneFloor(zone.id)
      if (!p) {
        console.log(`  (no pickable floor point found for ${zone.id})`)
        continue
      }
      hovered += 1
      if (zone.id === 'staff') await shot(`zone-hover${q}`)
      await click(p.x, p.y)
      await sleep(500)
      if ((await st('zone.selectedId')) === zone.id) selected += 1
      const ls = await labels()
      const inZone = ls.filter((l) => l.zone === 'in').map((l) => l.name).sort()
      const expectIn = campusZone(zone.id).devices.map((d) => nodes.find((n) => n.id === d)?.label.split(/\s/)[0]).sort()
      if (JSON.stringify(inZone) === JSON.stringify(expectIn)) highlighted += 1
      else console.log(`  (${zone.id}: highlighted ${inZone.join(',')} expected ${expectIn.join(',')})`)
      if (ls.filter((l) => l.zone === 'out').length === ls.length - expectIn.length) dimmed += 1
      const panel = await ev(`document.querySelector('.sim__panel').innerText`)
      if (!panel.includes(zone.name)) console.log(`  (zone panel for ${zone.id} does not show its name)`)
      if (zone.id === 'staff' || zone.id === 'soc') await shot(`zone-selected-${zone.id}${q}`)
    }
    check('all 7 campus zones show a hover highlight and select on click', hovered === 7 && selected === 7, `hover ${hovered}/7, select ${selected}/7`)
    check('a selected zone highlights exactly its own devices (approved mapping)', highlighted === 7, `${highlighted}/7`)
    check('a selected zone dims the other devices without hiding them', dimmed === 7, `${dimmed}/7`)

    // -- zone and device selections do not conflict
    await ev('window.__netsecStore.getState().clearEverything()')
    await view(...zoneCentre('staff'))
    const staff = await findZoneFloor('staff')
    await click(staff.x, staff.y)
    await sleep(1800) // the zone selection animates the camera; let it finish before moving the view
    const pc1 = await pointFor('PC-1')
    await click(pc1.x, pc1.y)
    check('selecting a device keeps the selected zone', (await st('selection.selectedId')) === 'PC-1' && (await st('zone.selectedId')) === 'staff')
    const adminPc = await pointFor('ADMIN-PC')
    await click(adminPc.x, adminPc.y)
    check('selecting a device in another zone keeps the zone', (await st('selection.selectedId')) === 'ADMIN-PC' && (await st('zone.selectedId')) === 'staff')
    await shot(`zone-and-device${q}`)

    // -- ground clicks: first the zone, then the device
    await view(-3, -10, 30)
    const ground = await toPage(-3, 0.002, -10)
    await click(ground.x, ground.y)
    check('clicking empty ground deselects the zone and keeps an independently selected device', (await st('zone.selectedId')) === null && (await st('selection.selectedId')) === 'ADMIN-PC')
    await click(ground.x, ground.y)
    check('a second ground click clears the device as an empty click always did', (await st('selection.selectedId')) === null)

    // -- double-click on a zone flies the camera there; R returns to the overview
    await ev('window.__netsecStore.getState().clearEverything(); window.__netsecStore.getState().requestPreset("overview")')
    await sleep(2200)
    await view(...zoneCentre('datacentre'))
    const dc = await findZoneFloor('datacentre')
    const before = await cameraAt()
    await click(dc.x, dc.y, 2)
    await sleep(2600)
    const after = await cameraAt()
    check('double-clicking a zone selects it and moves the camera in', (await st('zone.selectedId')) === 'datacentre' && dist(before, after) > 5, `camera moved ${dist(before, after).toFixed(1)} units`)
    await shot(`zone-focus${q}`)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', text: 'r' })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r' })
    await sleep(4200)
    check('R returns the camera to the overview', dist(await cameraAt(), overview) < 3, `${dist(await cameraAt(), overview).toFixed(2)} units from the overview position`)

    // -- cables: every one of the 32, with the right ends
    await ev('window.__netsecStore.getState().clearEverything()')
    const samples = await ev('window.__netsecCables')
    let cableOk = 0
    let endsOk = 0
    const missed = []
    for (const link of topology.links) {
      await ev('window.__netsecStore.getState().clearEverything()')
      let got = false
      const first = (samples[link.id] ?? [])[0]
      if (first) await view(first[0], first[2], 22)
      for (const [x, y, z] of samples[link.id] ?? []) {
        const p = await toPage(x, y, z)
        if (!p) continue
        await click(p.x, p.y)
        if ((await st('cable.selectedId')) === link.id) {
          got = true
          break
        }
      }
      let viaPanel = false
      if (!got) {
        // a cable hidden behind a device model (L04 behind the firewall gate) is selected from the device panel's "Cable" button
        missed.push(link.id)
        await ev(`window.__netsecStore.getState().select(${JSON.stringify(link.a.node)})`)
        await sleep(250)
        await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(`Cable ${link.id}`)})?.click()`)
        await sleep(250)
        got = (await st('cable.selectedId')) === link.id
        viaPanel = got
      }
      if (got) cableOk += 1
      const text = await ev(`document.querySelector('.sim__panel').innerText`)
      const a = nodes.find((n) => n.id === link.a.node).label
      const b = nodes.find((n) => n.id === link.b.node).label
      if (got && text.includes(`Source: ${a}`) && text.includes(`Destination: ${b}`) && text.includes(link.a.iface) && text.includes(link.b.iface)) endsOk += 1
      if (link.id === 'L14' && got) await shot(`cable-selected${q}`)
    }
    check(`all ${topology.links.length} cables can be selected (by a real click, or from the device panel when a model hides them)`, cableOk === topology.links.length, `${cableOk}/${topology.links.length}; ${topology.links.length - missed.length} by a real click${missed.length ? `, ${missed.join(', ')} from the panel` : ''}`)
    check('the cable panel names the right source and destination (device and interface) for every cable', endsOk === topology.links.length, `${endsOk}/${topology.links.length}`)
    const l7 = (samples.L07 ?? []).map(([x, y, z]) => [x, y, z])
    void l7
    await click(devicePoints['PC-1'].x, devicePoints['PC-1'].y)
    check('selecting a device clears the selected cable and is not stolen by a cable', (await st('selection.selectedId')) === 'PC-1' && (await st('cable.selectedId')) === null)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(200)
    check('Esc clears the selection', (await st('selection.selectedId')) === null)
  }

  async function viewerSuite(quality) {
    const q = quality === 'high' ? '' : '-low'
    console.log(`\n== DEVICE VIEWER, ${quality.toUpperCase()} quality`)
    await ev(`window.__netsecStore.getState().setSetting("quality", ${JSON.stringify(quality)}); window.__netsecStore.getState().clearEverything(); window.__netsecStore.getState().requestPreset("overview")`)
    await sleep(2000)
    // a running scenario, so packets keep moving behind the viewer
    await ev(`window.__netsecStore.getState().runScenario('S4', 'enforce')`)
    await sleep(3000)
    const campusBefore = await cameraAt()
    const t0 = await st('playback.time')
    await ev('window.__netsecStore.getState().clearEverything()')
    await sleep(1500)
    const geoBefore = (await ev('window.__netsecScene')).geometries

    // entry points: double-click a device, the Inspect button, the I key
    const p = await pointFor('PC-1')
    await click(p.x, p.y, 2)
    await sleep(1500)
    check('double-clicking a device opens the viewer', (await st('inspectorId')) === 'PC-1' && (await ev('document.querySelectorAll("canvas").length')) === 2)
    await shot(`viewer-pc1${q}`)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(500)
    check('Esc closes the viewer and unmounts its canvas', (await st('inspectorId')) === null && (await ev('document.querySelectorAll("canvas").length')) === 1)
    check('the campus camera did not move while the viewer opened and closed', dist(await cameraAt(), campusBefore) < 0.001)

    await ev(`window.__netsecStore.getState().select('IPS-1')`)
    await sleep(300)
    await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Inspect').click()`)
    await sleep(1200)
    check('the Inspect button in the device panel opens the viewer', (await st('inspectorId')) === 'IPS-1')
    await shot(`viewer-ips1${q}`)
    await ev(`document.querySelector('.inspector__close').click()`)
    await sleep(400)
    await ev(`window.__netsecStore.getState().select('SEC-LOG')`)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'i', text: 'i' })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'i' })
    await sleep(1200)
    check('the I key opens the viewer for the selected device', (await st('inspectorId')) === 'SEC-LOG')
    await ev(`document.querySelector('.inspector__close').click()`)
    await sleep(400)

    // all 12 model keys
    const perKey = new Map()
    for (const node of nodes) if (!perKey.has(keyOf(node))) perKey.set(keyOf(node), node)
    check('the 17 nodes use all 12 model keys', perKey.size === Object.keys(DEVICE_SPECS).length, `${perKey.size} keys`)
    let opened = 0
    let drew = 0
    for (const [key, node] of perKey) {
      await ev(`window.__netsecStore.getState().openInspector(${JSON.stringify(node.id)})`)
      await waitFor(() => ev(`!!window.__netsecInspector && window.__netsecInspector.model === ${JSON.stringify(key)}`), `the viewer for ${key}`, 15000)
      await sleep(900)
      const open = await ev(`!!document.querySelector('.inspector__dialog[aria-label="3D viewer: ${node.label}"]') && document.querySelectorAll('canvas').length === 2`)
      if (open) opened += 1
      const rect = await ev(`(() => { const b = document.querySelector('.inspector__canvas').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } })()`)
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } })
      if (data.length > 20000) drew += 1 // a blank stage compresses to a few KB; a lit model on its pedestal is far larger
      if (['switch-l3', 'firewall', 'internet-cloud', 'rack-server'].includes(key)) writeFileSync(join(out, `viewer-${key}${q}.png`), Buffer.from(data, 'base64'))
      await ev(`document.querySelector('.inspector__close').click()`)
      await sleep(350)
    }
    check('the viewer opens for all 12 model keys', opened === 12, `${opened}/12`)
    check('the viewer draws a model for all 12 model keys', drew === 12, `${drew}/12`)

    // rotate, zoom, reset, close on a device with real mouse input
    for (const id of ['CORE-SW1', 'EXT-USR']) {
      await ev(`window.__netsecStore.getState().openInspector(${JSON.stringify(id)})`)
      await waitFor(() => ev('!!window.__netsecInspector'), 'the viewer', 15000)
      await sleep(1200)
      const rect = await ev(`(() => { const b = document.querySelector('.inspector__canvas').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
      const home = await ev('window.__netsecInspector.cameraPosition()')
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
      await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 10; i++) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + i * 14, y: rect.y - i * 4, button: 'left', buttons: 1 })
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 140, y: rect.y - 40, button: 'left', clickCount: 1 })
      await sleep(900)
      const rotated = await ev('window.__netsecInspector.cameraPosition()')
      check(`${id}: dragging rotates the viewer camera`, dist(rotated, home) > 0.3, `${dist(rotated, home).toFixed(2)} units`)
      const homeDistance = Math.hypot(...home)
      for (let i = 0; i < 4; i++) await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.x, y: rect.y, deltaX: 0, deltaY: -240 })
      await sleep(900)
      const zoomed = await ev('window.__netsecInspector.cameraPosition()')
      check(`${id}: scrolling zooms in`, Math.hypot(...zoomed) < Math.hypot(...rotated) - 0.05, `${Math.hypot(...rotated).toFixed(2)} -> ${Math.hypot(...zoomed).toFixed(2)}`)
      await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reset camera').click()`)
      await sleep(1600)
      const reset = await ev('window.__netsecInspector.cameraPosition()')
      check(`${id}: Reset camera returns to the first view`, dist(reset, home) < 0.05 && homeDistance > 0, `${dist(reset, home).toFixed(3)} units off`)
      await ev(`document.querySelector('.inspector__close').click()`)
      await sleep(500)
    }

    // the campus did not notice
    const t1 = await st('playback.time')
    check('the campus camera is exactly where it was after all viewer use', dist(await cameraAt(), campusBefore) < 0.001)
    check('packet animation kept running while the viewer was open and closed', t1 > t0 + 3, `playhead ${t0.toFixed(1)} s -> ${t1.toFixed(1)} s`)
    await ev('window.__netsecStore.getState().clearEverything()')
    await sleep(1500)
    const geoAfter = (await ev('window.__netsecScene')).geometries
    check('the campus renderer holds no extra geometries after the viewer closed', geoAfter <= geoBefore, `${geoBefore} -> ${geoAfter}`)

    // open and close 20 times: no canvas, context or listener is left behind
    const heap0 = await ev('performance.memory ? performance.memory.usedJSHeapMB ?? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0')
    for (let i = 0; i < 20; i++) {
      await ev(`window.__netsecStore.getState().openInspector(${JSON.stringify(nodes[i % nodes.length].id)})`)
      await sleep(350)
      await ev('window.__netsecStore.getState().closeInspector()')
      await sleep(150)
    }
    await sleep(1500)
    const canvases = await ev('document.querySelectorAll("canvas").length')
    const heap1 = await ev('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0')
    check('after 20 open/close cycles only the campus canvas exists', canvases === 1 && (await ev('!window.__netsecInspector')), `${canvases} canvas`)
    console.log(`  JS heap ${heap0} MB -> ${heap1} MB over 20 cycles (garbage collection decides when it is released)`)
    const contextWarnings = browser.warnings().filter((m) => /too many active webgl contexts|context lost|oldest context/i.test(m))
    check('no "too many WebGL contexts" or context-lost warnings', contextWarnings.length === 0, contextWarnings.slice(0, 2).join(' | '))
  }

  const note = (stage) => console.log(`  [console errors so far after ${stage}: ${browser.errors().length}]`)
  await interactionSuite('high')
  note('high interactions')
  await viewerSuite('high')
  note('high viewer')
  await interactionSuite('low')
  note('low interactions')
  await viewerSuite('low')
  note('low viewer')

  const errors = browser.errors()
  check('no console errors during the whole run', errors.length === 0, errors.slice(0, 3).join(' | '))
  const outside = browser.requests().filter((u) => !/^(data:|blob:|http:\/\/127\.0\.0\.1|http:\/\/localhost)/.test(u))
  check('no request left this computer', outside.length === 0, outside.slice(0, 2).join(' '))
} finally {
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} interaction checks passed. Screenshots: ${out}`)
process.exit(passed === results.length ? 0 : 1)
