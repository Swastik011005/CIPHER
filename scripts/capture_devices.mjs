/**
 * One close-up screenshot per device (focus camera), in High quality, cropped to the 3D canvas.
 *
 *   node scripts/capture_devices.mjs [--out docs/screenshots/devices] [--scale 0.6] [--only PC-1,FW1]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const out = args.out ?? 'docs/screenshots/devices'
const scale = Number(args.scale ?? 0.6)
const only = args.only ? args.only.split(',') : null
mkdirSync(out, { recursive: true })

const browser = await openBrowser({ width: 1920, height: 1080 })
try {
  await browser.setViewport(1920, 1080)
  await browser.navigate('http://localhost:5173/simulation?debug=1')
  await waitFor(() => browser.evaluate('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the 3D scene', 30000)
  await browser.evaluate(`(async () => { const st = window.__netsecStore; st.setState({ autoLowered: true }); st.getState().setSetting('quality','high'); await st.getState().runScenario('S3','enforce'); st.getState().togglePlay(); st.getState().seekTo(20.4); })()`)
  await sleep(3000)
  const ids = await browser.evaluate(`window.__netsecStore.getState().topology.data.nodes.map((n) => n.id)`)
  const rect = await browser.evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })()`)
  for (const id of ids) {
    if (only && !only.includes(id)) continue
    await browser.evaluate(`window.__netsecStore.getState().requestFocus('${id}')`)
    await sleep(2400)
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale } })
    writeFileSync(join(out, `${id}.png`), Buffer.from(data, 'base64'))
    console.log(id)
  }
  console.log(JSON.stringify({ errors: browser.errors() }))
} finally {
  await browser.close()
}
