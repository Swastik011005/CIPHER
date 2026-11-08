#!/usr/bin/env node
/**
 * Frame-rate matrix of the 3D scene in real Chrome: High and Low quality, each idle (no run), with a scenario playing (traffic
 * animation) and at the S4 flood peak, from the overview and from a close preset.
 *
 *   node scripts/measure_matrix.mjs --base http://127.0.0.1:8000 [--out result.json] [--seconds 6]
 *
 * It reports what the browser actually got (the WebGL renderer string, window size, draw calls, triangles) and never changes a
 * system or graphics setting. Do not read a number as a result for a particular GPU unless `gpu` says it is that GPU.
 */
import { writeFileSync } from 'node:fs'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const seconds = Number(args.seconds ?? 6)
const browser = await openBrowser({ width: 1904, height: 985, port: Number(args.port ?? 9899) })
const ev = (c) => browser.evaluate(c)
const rows = []

async function measure() {
  return ev(`new Promise((resolve) => {
    const deltas = []
    let last = performance.now()
    const start = last
    function tick(now) {
      deltas.push(now - last)
      last = now
      if (now - start >= ${seconds * 1000}) {
        deltas.sort((a, b) => a - b)
        const total = deltas.reduce((s, d) => s + d, 0)
        resolve({ fps: Math.round((deltas.length * 1000 / total) * 10) / 10, worst1PercentFrameMs: Math.round(deltas[Math.floor(deltas.length * 0.99)] * 10) / 10 })
      } else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })`)
}

try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('window.__netsecScene && window.__netsecProbe && window.__netsecScene.meshes > 50 && window.__netsecStore.getState().topology.status === "ready"'), 'the scene', 60000)
  const gpu = await ev(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown' })()`)
  console.log(`GPU the browser used: ${gpu}`)
  await ev('window.__netsecStore.setState({ autoLowered: true })')

  const qualities = (args.q ?? 'high,low').split(',')
  const only = args.c ? args.c.split(',').map(Number) : null
  for (const quality of qualities) {
    await ev(`window.__netsecStore.getState().setSetting('quality', ${JSON.stringify(quality)})`)
    const cases = [
      { name: 'idle campus, overview', run: null, preset: 'overview' },
      { name: 'idle campus, staff close-up', run: null, preset: 'staff' },
      { name: 'scenario 7 playing (traffic, scan, EDR), overview', run: 'P7', preset: 'overview', at: 3 },
      { name: 'S4 flood peak (heaviest traffic), overview', run: 'S4', preset: 'overview', at: 13 },
    ]
    for (const [index, c] of cases.entries()) {
      if (only && !only.includes(index)) continue
      if (c.run) {
        await ev(`window.__netsecStore.getState().runScenario(${JSON.stringify(c.run)}, 'enforce')`)
        await waitFor(() => ev('window.__netsecStore.getState().playback.loaded'), 'the run', 30000)
        await ev(`window.__netsecStore.getState().seekTo(${c.at}); window.__netsecStore.getState().setSpeed(1)`)
      } else {
        await ev('(() => { const s = window.__netsecStore.getState(); s.resetSecurity && s.resetSecurity() })()')
      }
      await ev(`window.__netsecStore.getState().requestPreset(${JSON.stringify(c.preset)})`)
      await sleep(3500)
      const m = await measure()
      const scene = await ev('window.__netsecScene')
      rows.push({ quality, case: c.name, ...m, drawCalls: scene.meshes, triangles: scene.triangles, geometries: scene.geometries, textures: scene.textures, pixelRatio: scene.pixelRatio })
      console.log(`${quality.padEnd(4)} | ${c.name.padEnd(52)} | ${String(m.fps).padStart(5)} fps | worst 1% ${String(m.worst1PercentFrameMs).padStart(6)} ms | ${scene.meshes} draw calls, ${Math.round(scene.triangles / 1000)}k triangles, dpr ${scene.pixelRatio}`)
    }
  }
  const memory = await ev('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null')
  const errors = browser.errors()
  const result = { gpu, window: '1904x985', seconds, jsHeapMB: memory, consoleErrors: errors.length, rows }
  if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2))
  console.log(errors.length ? `console errors: ${errors[0]}` : 'no console errors')
} finally {
  await browser.close()
}
