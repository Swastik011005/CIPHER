#!/usr/bin/env node
/**
 * One screenshot of a page after a scenario has played, for visual checks.
 *
 *   node scripts/shot_page.mjs --base http://127.0.0.1:8000 --page monitoring --out <file.png> [--run S2] [--mode enforce] [--seek 12]
 *
 * It changes nothing in the repository except the file it writes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const out = resolve(args.out ?? 'page.png')
mkdirSync(dirname(out), { recursive: true })
const browser = await openBrowser({ width: Number(args.width ?? 1440), height: Number(args.height ?? 1000), port: Number(args.port ?? 9884) })
const ev = (c) => browser.evaluate(c)
try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecStore.getState().topology.status === "ready"'), 'the topology', 40000)
  if (args.run) {
    await ev(`window.__netsecStore.getState().runScenario(${JSON.stringify(args.run)}, ${JSON.stringify(args.mode ?? 'enforce')})`)
    await sleep(1500)
    if (args.seek) await ev(`window.__netsecStore.getState().seekTo(${Number(args.seek)})`)
    await ev('window.__netsecStore.getState().playback.playing && window.__netsecStore.getState().togglePlay()')
  }
  await ev(`(() => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/${args.page}'); a && a.click() })()`)
  await sleep(2500)
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(data, 'base64'))
  console.log('saved', out)
  console.log(browser.errors().length ? `console errors: ${browser.errors().slice(0, 3).join(' | ')}` : 'no console errors')
} finally {
  await browser.close()
}
