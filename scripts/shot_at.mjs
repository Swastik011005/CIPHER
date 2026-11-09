#!/usr/bin/env node
/**
 * One screenshot of a chosen spot of the campus, for close visual checks (the SOC wall, a rack, a sign).
 *
 *   node scripts/shot_at.mjs --base http://127.0.0.1:8000 --out <file.png> --at x,y,z [--distance 14] [--run P7] [--play 12000]
 *
 * The camera is pointed at the spot from the default viewing direction. With --run the scenario is played first, so the screens show a
 * live run. It changes nothing in the repository except the file it writes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const out = resolve(args.out ?? 'shot-at.png')
mkdirSync(dirname(out), { recursive: true })
const [x, y, z] = (args.at ?? '0,1,0').split(',').map(Number)

const browser = await openBrowser({ width: Number(args.width ?? 1680), height: Number(args.height ?? 960), port: Number(args.port ?? 9883) })
const ev = (c) => browser.evaluate(c)
try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecProbe && window.__netsecScene && window.__netsecScene.meshes > 50'), 'the scene', 40000)
  await ev(`window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().setSetting('quality', ${JSON.stringify(args.quality ?? 'high')})`)
  await ev(`(() => { const e = document.createElement('style'); e.textContent = '.viewport__bottom-banner{display:none !important}'; document.head.appendChild(e) })()`)
  if (args.run) {
    await ev(`window.__netsecStore.getState().runScenario(${JSON.stringify(args.run)}, 'enforce')`)
    await sleep(Number(args.play ?? 12000))
  }
  await ev(`window.__netsecProbe.lookAt(${x}, ${y}, ${z}, ${Number(args.distance ?? 14)})`)
  await sleep(2500)
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(data, 'base64'))
  console.log('saved', out)
  console.log(browser.errors().length ? `console errors: ${browser.errors().slice(0, 3).join(' | ')}` : 'no console errors')
} finally {
  await browser.close()
}
