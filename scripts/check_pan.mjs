#!/usr/bin/env node
/**
 * Browser check of panning with the middle mouse button (wheel click), in real Chrome.
 *
 *   node scripts/check_pan.mjs --base http://127.0.0.1:8000
 *
 * It drags with real mouse events (CDP) on the 3D canvas and checks that the camera moves with the drag in the screen plane (the
 * viewing direction and the distance to the target stay the same, so it is a pan and not an orbit or a zoom), left/right and up/down,
 * that releasing the button stops it at once, that the right button still pans, the left button still orbits, the wheel still zooms and
 * that a middle-button drag selects nothing. It changes nothing in the repository.
 */
import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const browser = await openBrowser({ width: 1600, height: 900, port: Number(args.port ?? 9885) })
const ev = (c) => browser.evaluate(c)
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failed += 1
}
const mouse = (type, x, y, button = 'none', buttons = 0) => browser.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
const sub = (a, b) => a.map((v, i) => v - b[i])
const len = (v) => Math.hypot(...v)
const state = async () => ({ pos: await ev('window.__netsecProbe.cameraPosition()'), target: await ev('window.__netsecProbe.cameraTarget()') })

/** Drag from (x, y) by (dx, dy) with a button held, in steps; returns the camera before and during the drag (before the release). */
async function drag(button, bit, x, y, dx, dy, steps = 12) {
  const before = await state()
  await mouse('mouseMoved', x, y)
  await mouse('mousePressed', x, y, button, bit)
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps, button, bit)
    await sleep(16)
  }
  await sleep(500)
  const during = await state()
  await mouse('mouseReleased', x + dx, y + dy, button, 0)
  return { before, during }
}

try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecProbe && window.__netsecProbe.cameraTarget && window.__netsecScene && window.__netsecScene.meshes > 50'), 'the scene', 40000)
  await ev('window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().requestPreset("overview")')
  await ev(`(() => { const e = document.createElement('style'); e.textContent = '.viewport__bottom-banner{display:none !important}'; document.head.appendChild(e) })()`)
  await sleep(2500)
  const rect = await ev(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h * 0.55 // below the preset bar

  // -- middle button, left/right
  let r = await drag('middle', 4, cx, cy, 260, 0)
  const dTarget = sub(r.during.target, r.before.target)
  const dPos = sub(r.during.pos, r.before.pos)
  const offsetBefore = sub(r.before.pos, r.before.target)
  const offsetAfter = sub(r.during.pos, r.during.target)
  check('middle button: dragging right moves the camera view horizontally', len(dTarget) > 3, `target moved ${len(dTarget).toFixed(1)} units`)
  check('middle button: it is a pan (viewing direction and distance to the target unchanged), not an orbit or a zoom', Math.abs(len(offsetAfter) - len(offsetBefore)) < 0.5 && len(sub(offsetAfter, offsetBefore)) < 0.5, `offset change ${len(sub(offsetAfter, offsetBefore)).toFixed(2)}`)
  check('middle button: the camera and its target move together', len(sub(dPos, dTarget)) < 0.5)
  // The camera looks from +x,+z; its right vector is (+x, -z). Dragging right moves the scene right, so the target moves against it.
  const right = [Math.SQRT1_2, 0, -Math.SQRT1_2]
  const along = dTarget[0] * right[0] + dTarget[2] * right[2]
  check('middle button: the scene follows the cursor (the target moves against a drag to the right)', along < -3 && Math.abs(dTarget[1]) < 0.5, `along the camera right vector ${along.toFixed(1)}, vertical ${dTarget[1].toFixed(2)}`)

  // -- releasing stops it at once
  const afterRelease = await state()
  await mouse('mouseMoved', cx + 300, cy + 40)
  await sleep(600)
  const later = await state()
  check('releasing the middle button stops panning immediately (moving the mouse afterwards changes nothing)', len(sub(later.target, afterRelease.target)) < 0.05, `moved ${len(sub(later.target, afterRelease.target)).toFixed(3)} after the release`)

  // -- middle button, up/down
  r = await drag('middle', 4, cx, cy, 0, -180)
  const dUp = sub(r.during.target, r.before.target)
  check('middle button: dragging up/down moves the view vertically on the screen', len(dUp) > 2, `target moved ${len(dUp).toFixed(1)} units`)
  check('middle button, vertical: still a pure pan', len(sub(sub(r.during.pos, r.during.target), sub(r.before.pos, r.before.target))) < 0.5)

  // -- a long drag keeps panning and stays over the campus (the boundary still applies)
  for (let i = 0; i < 6; i++) await drag('middle', 4, cx + 200, cy, -300, 0, 8)
  const far = await state()
  check('panning can explore the environment and the target stays inside the allowed box', far.target[0] >= -60.5 && far.target[0] <= 60.5 && far.target[2] >= -40.5 && far.target[2] <= 45.5, `target ${far.target.map((v) => v.toFixed(0)).join(', ')}`)

  // -- the other controls still work
  await ev('window.__netsecStore.getState().requestPreset("overview")')
  await sleep(2500)
  r = await drag('right', 2, cx, cy, 200, 0)
  check('right button still pans', len(sub(r.during.target, r.before.target)) > 3)
  await ev('window.__netsecStore.getState().requestPreset("overview")')
  await sleep(2500)
  r = await drag('left', 1, cx - 300, cy - 100, 200, 0)
  check('left button still orbits (the viewing direction changes, the target does not)', len(sub(sub(r.during.pos, r.during.target), sub(r.before.pos, r.before.target))) > 3 && len(sub(r.during.target, r.before.target)) < 0.5)
  await ev('window.__netsecStore.getState().requestPreset("overview")')
  await sleep(2500)
  const z0 = await state()
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -300 })
  await sleep(900)
  const z1 = await state()
  check('the wheel still zooms', len(sub(z1.pos, z1.target)) < len(sub(z0.pos, z0.target)) - 1)
  await ev('window.__netsecStore.getState().clearEverything()')
  await drag('middle', 4, cx, cy, 120, 60)
  check('a middle-button drag selects nothing', (await ev('window.__netsecStore.getState().selection.selectedId')) === null && (await ev('window.__netsecStore.getState().zone.selectedId')) === null)
  check('no console errors', browser.errors().length === 0, browser.errors().slice(0, 2).join(' | '))
} finally {
  await browser.close()
}
console.log(`\n${failed === 0 ? 'All' : failed} pan checks ${failed === 0 ? 'passed' : 'FAILED'}.`)
process.exit(failed === 0 ? 0 : 1)
