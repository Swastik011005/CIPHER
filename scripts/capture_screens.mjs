/**
 * Screenshots and layout checks at the three target resolutions, in a normal Chrome window.
 *
 *   node scripts/capture_screens.mjs [--out docs/screenshots] [--only simulation,rules] [--sizes 1366x768,1440x900,1920x1080]
 *
 * For each size it opens every page, takes a screenshot, and checks that the page does not scroll sideways
 * and that nothing is wider than the viewport. For the Simulation page it also runs a scenario (S4 by default)
 * and shoots the scene at a few camera presets. Needs the backend and the Vite dev server. Prints a JSON report.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const out = args.out ?? 'docs/screenshots'
const sizes = (args.sizes ?? '1366x768,1440x900,1920x1080').split(',').map((s) => s.split('x').map(Number))
const only = args.only ? args.only.split(',') : null
const base = args.base ?? 'http://localhost:5173'
mkdirSync(out, { recursive: true })

const PAGES = [
  ['overview', '/overview'],
  ['simulation', '/simulation?debug=1'],
  ['monitoring', '/monitoring'],
  ['threats', '/threats'],
  ['rules', '/rules'],
]

const OVERFLOW = `(() => {
  const w = document.documentElement.clientWidth
  const wide = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.right > w + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.table-scroll, canvas, .scene-canvas, [data-allow-overflow]')
  }).slice(0, 5).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + ' right=' + Math.round(e.getBoundingClientRect().right))
  // The page may scroll inside its own main region instead of the window: check every scroll container too.
  const inner = [...document.querySelectorAll('main, .app__main, [class*="main"], .page, .sim')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + ' scroll=' + e.scrollWidth + ' client=' + e.clientWidth)
  return { clientWidth: w, scrollWidth: document.documentElement.scrollWidth, scrollsSideways: document.documentElement.scrollWidth > w + 1 || inner.length > 0, wide, inner }
})()`

const browser = await openBrowser({ width: 1920, height: 1080 })
const report = []
try {
  for (const [w, h] of sizes) {
    await browser.setViewport(w, h)
    for (const [name, path] of PAGES) {
      if (only && !only.includes(name)) continue
      await browser.navigate(base + path)
      await sleep(name === 'simulation' ? 4000 : 1500)
      if (name === 'simulation') {
        await waitFor(() => browser.evaluate('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the 3D scene', 30000)
        await browser.evaluate(`(async () => { window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().setSetting('quality', 'high'); const s = window.__netsecStore.getState(); await s.runScenario('${args.scenario ?? 'S4'}', 'enforce'); s.togglePlay(); s.seekTo(${args.at ?? 12.5}); })()`)
        await sleep(2500)
        for (const preset of ['overview', 'perimeter', 'staff', 'core', 'servers', 'secops']) {
          await browser.evaluate(`window.__netsecStore.getState().requestPreset('${preset}')`)
          await sleep(2200)
          await browser.screenshot(join(out, `${w}x${h}-simulation-${preset}.png`))
        }
      } else {
        await browser.screenshot(join(out, `${w}x${h}-${name}.png`))
      }
      const o = await browser.evaluate(OVERFLOW)
      report.push({ size: `${w}x${h}`, page: name, ...o })
    }
  }
  console.log(JSON.stringify({ report, consoleErrors: browser.errors() }, null, 2))
} finally {
  await browser.close()
}
