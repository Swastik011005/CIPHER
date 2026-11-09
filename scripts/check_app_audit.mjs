#!/usr/bin/env node
/**
 * General application audit in a real browser (Chrome by default, Edge with --browser edge), driven with real events:
 *
 *   node scripts/check_app_audit.mjs --base http://127.0.0.1:8000 [--browser chrome|edge] [--port 9911]
 *
 * For every page: it loads, has the CIPHER title and no old product name, logs no console error and makes no failed or
 * error-status request. Unknown addresses fall back to the default page. At 1920, 1440, 1366 and 1024 px wide no page
 * scrolls sideways; 768 and 390 px are measured and reported (the app is desktop first, see docs/LIMITATIONS.md) but do not fail
 * the check. The scene keyboard shortcuts (1-6, R, F, Esc) and the sidebar navigation are exercised with real key and click
 * events. It changes nothing in the repository.
 */
import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const browser = await openBrowser({ browser: args.browser ?? 'chrome', width: 1600, height: 950, port: Number(args.port ?? 9911) })
const ev = (c) => browser.evaluate(c)
let failed = 0
let total = 0
const check = (name, ok, detail = '') => {
  total += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failed += 1
}
const info = (text) => console.log(`INFO  ${text}`)
const key = async (k) => {
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined })
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k })
}

const PAGES = [
  ['/overview', 'Overview'],
  ['/simulation', '3D Network Simulation'],
  ['/monitoring', 'Network Monitoring'],
  ['/threats', 'Threat Centre'],
  ['/rules', 'Security Rules & Scenarios'],
]
const WIDTHS = [1920, 1440, 1366, 1024]
const SOFT_WIDTHS = [768, 390]

const overflow = () => ev(`(() => { const d = document.documentElement; return { scroll: d.scrollWidth, inner: window.innerWidth } })()`)
const seenErrors = () => browser.errors().concat(browser.failedRequests())

try {
  console.log(`== ${args.browser ?? 'chrome'} against ${base}`)
  await browser.setViewport(1440, 900)

  // -- every page loads clean
  for (const [path, heading] of PAGES) {
    const before = seenErrors().length
    await browser.navigate(`${base}${path}`)
    await waitFor(() => ev(`document.body.innerText.includes(${JSON.stringify(heading)})`), `${path} to show "${heading}"`, 40000)
    await sleep(path === '/simulation' ? 4000 : 1500)
    const text = await ev('document.body.innerText')
    const title = await ev('document.title')
    const fresh = seenErrors().slice(before)
    check(`${path}: loads and shows "${heading}"`, true)
    check(`${path}: the tab title says CIPHER`, /CIPHER/.test(title), JSON.stringify(title))
    check(`${path}: no old product name on the page`, !/NetSec|SentinelNet/i.test(text))
    check(`${path}: no console error and no failed or error-status request`, fresh.length === 0, fresh.slice(0, 2).join(' | '))
  }

  // -- unknown addresses fall back to the default page
  await browser.navigate(`${base}/no-such-page`)
  await waitFor(() => ev('document.body.innerText.length > 100'), 'the fallback page', 20000)
  check('an unknown address falls back to a real page', /(Overview|Simulation)/.test(await ev('document.body.innerText')) && !/Cannot GET|404/i.test(await ev('document.body.innerText')))

  // -- sidebar navigation with real clicks
  await browser.navigate(`${base}/overview`)
  await waitFor(() => ev('document.body.innerText.includes("Overview")'), 'overview', 20000)
  for (const [path, heading] of PAGES.slice(1)) {
    const label = { '/simulation': 'Simulation', '/monitoring': 'Monitoring', '/threats': 'Threats', '/rules': 'Rules' }[path]
    await ev(`(() => { const a = [...document.querySelectorAll('nav a')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); a?.click(); return !!a })()`)
    await waitFor(() => ev(`location.pathname === ${JSON.stringify(path)} && document.body.innerText.includes(${JSON.stringify(heading)})`), `navigation to ${path}`, 20000).then(
      () => check(`sidebar: ${label} opens ${path}`, true),
      () => check(`sidebar: ${label} opens ${path}`, false),
    )
  }
  check('navigating between pages produced no error', seenErrors().length === 0, seenErrors().slice(0, 2).join(' | '))

  // -- scene keyboard shortcuts (real key events)
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecScene && window.__netsecScene.meshes > 100'), 'the scene', 60000)
  const cam = () => ev('window.__netsecProbe.cameraPosition()')
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  await ev(`document.activeElement?.blur?.(); document.body.focus?.()`)
  await sleep(2500)
  const start = await cam()
  await key('3')
  await sleep(2200)
  const afterPreset = await cam()
  check('key 3 moves the camera to the third preset', dist(start, afterPreset) > 2, `${dist(start, afterPreset).toFixed(1)} units`)
  await key('r')
  await sleep(2200)
  const afterReset = await cam()
  check('key R returns to the overview', dist(start, afterReset) < 0.5, `${dist(start, afterReset).toFixed(2)} units off`)
  await ev(`window.__netsecStore.getState().select('PC-1')`)
  check('a device can be selected', (await ev('window.__netsecStore.getState().selection.selectedId')) === 'PC-1')
  await key('Escape')
  await sleep(300)
  check('Esc clears the selection', (await ev('window.__netsecStore.getState().selection.selectedId')) === null)
  await ev(`window.__netsecStore.getState().select('APP-SRV')`)
  const beforeFocus = await cam()
  await key('f')
  await sleep(2200)
  check('key F focuses the selected device', dist(beforeFocus, await cam()) > 1)
  await ev(`window.__netsecStore.getState().clearEverything()`)

  // -- one finished run, three pages: every page shows the numbers the backend itself reported for that run
  await ev(`window.__netsecStore.getState().runScenario('S2', 'enforce')`)
  await waitFor(() => ev('window.__netsecStore.getState().run.status === "ready"'), 'the S2 run', 30000)
  await ev('window.__netsecStore.getState().seekTo(1000)')
  await sleep(1200)
  const summary = await ev('window.__netsecStore.getState().run.meta.summary')
  const flat = (t) => t.replace(/\s+/g, ' ')
  // The KPI tiles are read from the DOM (label and value), not from loose page text.
  const kpis = () => ev(`Object.fromEntries([...document.querySelectorAll('.kpi')].map((k) => [k.querySelector('.eyebrow').textContent.trim().toUpperCase(), Number(k.querySelector('.kpi__value').textContent.replace(/[^0-9.]/g, ''))]))`)
  const sim = flat(await ev('document.body.innerText'))
  const bar = sim.match(/(\d+) PACKETS (\d+) CLEAN (\d+) FLAGGED (\d+) BLOCKED (\d+) ALERTS (\d+) INCIDENTS?/i)?.slice(1).map(Number)
  const wanted = [summary.data_packets, summary.delivered_clean, summary.delivered_flagged, summary.blocked, summary.alerts, summary.incidents]
  check('Simulation counters equal the backend summary at the end of the run', !!bar && wanted.every((v, i) => v === bar[i]), JSON.stringify({ shown: bar, backend: wanted }))
  const goTo = async (label, heading) => {
    await ev(`[...document.querySelectorAll('nav a')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}).click()`)
    await waitFor(() => ev(`location.pathname !== '/simulation' && document.body.innerText.includes(${JSON.stringify(heading)}) && document.querySelectorAll('.kpi, canvas').length > 0`), heading, 20000)
    await sleep(1800)
  }
  await goTo('Monitoring', 'Network Monitoring')
  const mon = await kpis()
  const monWant = { PACKETS: summary.data_packets, 'DELIVERED CLEAN': summary.delivered_clean, 'DELIVERED FLAGGED': summary.delivered_flagged, BLOCKED: summary.blocked, 'OTHER DROPS': summary.other_drop, 'SPAN COPIES': summary.mirrored, ALERTS: summary.alerts, INCIDENTS: summary.incidents }
  check('Monitoring KPIs equal the backend summary', Object.entries(monWant).every(([k, v]) => mon[k] === v), JSON.stringify({ shown: mon, backend: monWant }))
  await goTo('Threats', 'Threat Centre')
  const thr = await kpis()
  check('Threat Centre tiles equal the backend summary', thr.INCIDENTS === summary.incidents && thr.ALERTS === summary.alerts && thr['PACKETS BLOCKED'] === summary.blocked, JSON.stringify({ shown: thr }))
  await goTo('Monitoring', 'Network Monitoring')
  const drawn = await ev(`[...document.querySelectorAll('canvas')].filter((c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true } catch {} return false }).length`)
  check('the Monitoring charts are drawn (not blank canvases)', drawn >= 3, `${drawn} canvases with pixels`)
  check('no console error across the data pages', seenErrors().length === 0, seenErrors().slice(0, 2).join(' | '))

  // -- the app never talks to anything but its own server
  const outside = browser.requests().filter((u) => !/^(data:|blob:|http:\/\/127\.0\.0\.1|http:\/\/localhost)/.test(u))
  check('no request leaves the local machine', outside.length === 0, outside.slice(0, 2).join(' | '))
  check('no console error during the keyboard and navigation tests', browser.errors().length === 0, browser.errors().slice(0, 2).join(' | '))

  // -- responsive: no sideways scrolling
  for (const [path, heading] of PAGES) {
    await browser.navigate(`${base}${path}`)
    await waitFor(() => ev(`document.body.innerText.includes(${JSON.stringify(heading)})`), `${path}`, 40000)
    for (const w of [...WIDTHS, ...SOFT_WIDTHS]) {
      await browser.setViewport(w, 900)
      await sleep(path === '/simulation' ? 900 : 400)
      const o = await overflow()
      const fits = o.scroll <= o.inner + 1
      if (WIDTHS.includes(w)) check(`${path} at ${w}px wide: no sideways scroll`, fits, fits ? '' : `content ${o.scroll}px in a ${o.inner}px window`)
      else info(`${path} at ${w}px wide: ${fits ? 'fits' : `scrolls sideways (content ${o.scroll}px in ${o.inner}px)`}`)
    }
    await browser.setViewport(1440, 900)
  }
  check('no console error while resizing', seenErrors().length === 0, seenErrors().slice(0, 2).join(' | '))

  // -- last, because it deliberately makes a failing request: an unknown API address is a clean JSON 404
  const notFound = await ev(`fetch('/api/no-such-endpoint').then(async (r) => ({ status: r.status, type: r.headers.get('content-type') }))`)
  check('an unknown API address answers 404 JSON, not an HTML page', notFound.status === 404 && /json/.test(notFound.type ?? ''), JSON.stringify(notFound))
} finally {
  await browser.close()
}
console.log(`\n${total - failed} of ${total} audit checks passed${failed ? `, ${failed} FAILED` : ''}.`)
process.exit(failed === 0 ? 0 : 1)
