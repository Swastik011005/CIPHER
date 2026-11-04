#!/usr/bin/env node
/**
 * WebGL resources, memory and download size of the running app at the S4 peak, on High and Low:
 * meshes and triangles in the main pass, geometries, textures, JS heap, and bytes transferred.
 *
 *   node docs/design/campus-c2/resources.mjs http://127.0.0.1:8000
 */
import { openBrowser, sleep, waitFor } from '../../../scripts/lib/cdp.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:8000'
const browser = await openBrowser({ width: 1904, height: 985, port: 9895 })
const ev = (c) => browser.evaluate(c)
const result = {}
try {
  await browser.navigate(`${url}/simulation?debug=1`)
  await waitFor(() => ev('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the scene', 30000)
  await waitFor(() => ev('window.__netsecStore.getState().topology.status === "ready"'), 'the topology', 30000)
  for (const quality of ['high', 'low']) {
    await ev(`window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().setSetting('quality', '${quality}')`)
    await ev('window.__netsecStore.getState().runScenario("S4", "enforce")')
    await waitFor(() => ev('window.__netsecStore.getState().run.status === "ready"'), 'S4', 30000)
    await ev('window.__netsecStore.getState().seekTo(12)')
    await sleep(6000)
    const scene = await ev('window.__netsecScene')
    const memory = await ev('performance.memory ? { usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) } : null')
    result[quality] = { ...scene, ...memory }
  }
  result.transferKB = await ev('Math.round(performance.getEntriesByType("resource").reduce((a, r) => a + (r.transferSize || 0), 0) / 1024)')
  result.resources = await ev('performance.getEntriesByType("resource").length')
  console.log(JSON.stringify(result, null, 1))
} finally {
  await browser.close()
}
