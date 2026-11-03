/**
 * Memory growth over a long simulation, in a normal Chrome window.
 *
 *   node scripts/measure_memory.mjs --minutes 10 --scenario S4 --mode enforce --quality high
 *
 * Plays the scenario at 2x, restarts it whenever it ends, and re-runs it from the backend once a minute (so the
 * trace loading path is exercised too). Every 30 s it forces a garbage collection through the DevTools protocol
 * and records the JS heap in use, DOM node count, event listeners, and the number of geometries and textures
 * three.js holds on the GPU. Growth is measured from a baseline taken after a warm-up (first 90 s) to the end,
 * using the median of three samples at each end so one odd sample cannot decide the result.
 *
 * Needs the backend and the Vite dev server. Prints a JSON report; the exit code is 1 when heap growth exceeds
 * --limit percent (default 15).
 */
import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const minutes = Number(args.minutes ?? 10)
const scenario = args.scenario ?? 'S4'
const mode = args.mode ?? 'enforce'
const quality = args.quality ?? 'high'
const limit = Number(args.limit ?? 15)
const sampleEveryS = Number(args.every ?? 30)
const warmupS = Number(args.warmup ?? 90)

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const mb = (bytes) => +(bytes / 1048576).toFixed(2)

const browser = await openBrowser({ width: 1440, height: 900, port: 9777, extraFlags: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] })
try {
  await browser.setViewport(1440, 900)
  await browser.navigate('http://localhost:5173/simulation?debug=1')
  await waitFor(() => browser.evaluate('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the 3D scene', 30000)
  await browser.evaluate(`(async () => {
    const store = window.__netsecStore
    store.setState({ autoLowered: true }) // measure the preset asked for
    store.getState().setSetting('quality', '${quality}')
    await store.getState().runScenario('${scenario}', '${mode}')
    store.getState().setSpeed(2)
    // keep it going: restart when it ends, re-run from the backend once a minute
    window.__loop = setInterval(() => { const p = store.getState().playback; if (p.finished || !p.playing) { store.getState().restartPlayback(); store.getState().setSpeed(2) } }, 500)
    window.__rerun = setInterval(() => { store.getState().runScenario('${scenario}', '${mode}').then(() => store.getState().setSpeed(2)) }, 60000)
  })()`)

  await browser.send('Performance.enable')
  const samples = []
  const started = Date.now()
  while (Date.now() - started < minutes * 60000) {
    await sleep(sampleEveryS * 1000)
    await browser.send('HeapProfiler.collectGarbage')
    await browser.send('HeapProfiler.collectGarbage')
    const { metrics } = await browser.send('Performance.getMetrics')
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
    const page = await browser.evaluate(`(() => { const s = window.__netsecScene || {}; const p = window.__netsecStore.getState().playback; return { geometries: s.geometries, textures: s.textures, fps: s.fps, simTime: +p.time.toFixed(1), packets: Object.keys(p.state ? p.state.packets : {}).length } })()`)
    samples.push({
      t: Math.round((Date.now() - started) / 1000),
      heapMB: mb(m.JSHeapUsedSize),
      domNodes: m.Nodes,
      listeners: m.JSEventListeners,
      documents: m.Documents,
      ...page,
    })
    console.error(JSON.stringify(samples.at(-1)))
  }

  const after = samples.filter((s) => s.t >= warmupS)
  const base = median(after.slice(0, 3).map((s) => s.heapMB))
  const end = median(after.slice(-3).map((s) => s.heapMB))
  const growthPct = +(((end - base) / base) * 100).toFixed(1)
  const trend = (key) => ({ first: after[0][key], last: after.at(-1)[key] })
  const report = {
    minutes,
    scenario,
    mode,
    quality,
    samples: samples.length,
    baselineHeapMB: base,
    finalHeapMB: end,
    heapGrowthPercent: growthPct,
    limitPercent: limit,
    withinLimit: growthPct < limit,
    peakHeapMB: Math.max(...samples.map((s) => s.heapMB)),
    domNodes: trend('domNodes'),
    listeners: trend('listeners'),
    geometries: trend('geometries'),
    textures: trend('textures'),
    consoleErrors: browser.errors().length,
    series: samples,
  }
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.withinLimit ? 0 : 1
} finally {
  await browser.evaluate('clearInterval(window.__loop); clearInterval(window.__rerun)').catch(() => {})
  await browser.close()
}
