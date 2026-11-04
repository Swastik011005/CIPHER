#!/usr/bin/env node
/**
 * Captures the real application from every camera preset, an orbit view, packets at the S4 flood's peak and the Low preset,
 * so a visual change can be compared before and after with the same tool.
 *
 *   node docs/design/campus-c2/capture.mjs --base http://127.0.0.1:8000 --tag before [--out docs/design/campus-c2/screens]
 *
 * Needs the app in demo mode (python scripts/tasks.py demo) and Chrome. Writes <tag>-<view>.png and <tag>-stats.json.
 * It never changes the repository; it only clicks and drags in a throwaway browser session.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openBrowser, sleep, waitFor } from '../../../scripts/lib/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const tag = args.tag ?? 'capture'
const out = resolve(args.out ?? join(here, 'screens'))
mkdirSync(out, { recursive: true })

const browser = await openBrowser({ width: 1680, height: 960, port: 9894 })
const ev = (c) => browser.evaluate(c)
const stats = {}
try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the 3D scene', 40000)
  await waitFor(() => ev('window.__netsecStore.getState().topology.status === "ready" && window.__netsecScene && window.__netsecScene.meshes > 100'), 'the scene to draw', 40000)
  await ev('window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().setSetting("quality", "high"); window.__netsecStore.getState().setSetting("labels", "all")')
  await ev(`(() => { const s = document.createElement('style'); s.textContent = '.viewport__overlay,.viewport__playback,.viewport__hint,.viewport__bottom-banner{display:none!important}'; document.head.appendChild(s) })()`)

  const canvasRect = () => ev('(() => { const b = document.querySelector("canvas").getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } })()')
  const shot = async (name) => {
    await sleep(500)
    const r = await canvasRect()
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } })
    writeFileSync(join(out, `${tag}-${name}.png`), Buffer.from(data, 'base64'))
    stats[name] = await ev('window.__netsecScene')
    console.log(`${tag}-${name}.png  meshes ${stats[name].meshes}, ${Math.round(stats[name].triangles / 1000)}k triangles`)
  }
  const preset = async (id) => {
    await ev(`window.__netsecStore.getState().requestPreset('${id}')`)
    await sleep(2800)
  }
  for (const id of ['overview', 'perimeter', 'staff', 'core', 'servers', 'secops']) {
    await preset(id)
    await shot(id)
  }

  // orbit: from the default view, drag with the left mouse button to swing the camera round to the north-west
  await preset('overview')
  const r = await canvasRect()
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const mouse = (type, x, y, extra = {}) => browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
  await mouse('mousePressed', cx - 160, cy)
  for (let i = 1; i <= 24; i += 1) {
    await mouse('mouseMoved', cx - 160 + (i * 330) / 24, cy + (i * -40) / 24)
    await sleep(16)
  }
  await mouse('mouseReleased', cx + 170, cy - 40)
  await sleep(1800)
  await shot('orbit')

  // packets: the S4 flood at its peak, paused at 14.3 s
  await ev('window.__netsecStore.getState().runScenario("S4", "enforce")')
  await waitFor(() => ev('window.__netsecStore.getState().run.status === "ready"'), 'S4', 30000)
  await ev('(() => { const s = window.__netsecStore.getState(); if (s.playback.playing) s.togglePlay(); s.seekTo(14.3) })()')
  await preset('servers')
  await shot('packets-servers')
  await preset('overview')
  await shot('packets-overview')

  // the Low preset
  await ev('window.__netsecStore.getState().setSetting("quality", "low")')
  await sleep(1500)
  await shot('low-overview')
  writeFileSync(join(out, `${tag}-stats.json`), JSON.stringify(stats, null, 1))
  const errors = browser.errors()
  console.log(errors.length ? `console errors: ${errors.slice(0, 3).join(' | ')}` : 'no console errors')
} finally {
  await browser.close()
}
