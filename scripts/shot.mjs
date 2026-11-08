#!/usr/bin/env node
/**
 * Screenshots of the running app (demo mode), one per camera preset, for a quick visual check.
 *
 *   node scripts/shot.mjs --base http://127.0.0.1:8000 --out <folder> [--presets overview,staff] [--page simulation] [--quality high] [--run P7]
 *
 * With --run the scenario is loaded and played to 8 s first. It changes nothing in the repository except the files it writes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const out = resolve(args.out ?? 'shots')
mkdirSync(out, { recursive: true })
const presets = (args.presets ?? 'overview').split(',')

const browser = await openBrowser({ width: Number(args.width ?? 1680), height: Number(args.height ?? 960), port: Number(args.port ?? 9881) })
const ev = (c) => browser.evaluate(c)
try {
  await browser.navigate(`${base}/${args.page ?? 'simulation'}?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecStore.getState().topology.status === "ready"'), 'the topology', 40000)
  if ((args.page ?? 'simulation') === 'simulation') {
    await waitFor(() => ev('window.__netsecScene && window.__netsecScene.meshes > 50'), 'the scene', 40000)
    await ev(`window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().setSetting('quality', ${JSON.stringify(args.quality ?? 'high')})`)
    if (args.run) {
      await ev(`window.__netsecStore.getState().runScenario(${JSON.stringify(args.run)}, 'enforce')`)
      await sleep(Number(args.play ?? 8000))
    }
    for (const preset of presets) {
      await ev(`window.__netsecStore.getState().requestPreset(${JSON.stringify(preset)})`)
      await sleep(2800)
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(out, `${args.tag ?? 'shot'}-${preset}.png`), Buffer.from(data, 'base64'))
      console.log('saved', preset, JSON.stringify(await ev('window.__netsecScene')))
    }
  } else {
    await sleep(2500)
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(out, `${args.tag ?? 'shot'}-${args.page}.png`), Buffer.from(data, 'base64'))
  }
  const errors = browser.errors()
  console.log(errors.length ? `console errors: ${errors.slice(0, 3).join(' | ')}` : 'no console errors')
} finally {
  await browser.close()
}
