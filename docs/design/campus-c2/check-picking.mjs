#!/usr/bin/env node
/**
 * Clicks on devices in the real renderer and checks that the right one is selected: glass, frames, platforms and signs must
 * not take or block a click. Usage: node docs/design/campus-c2/check-picking.mjs <base-url>
 */
import { openBrowser, sleep, waitFor } from '../../../scripts/lib/cdp.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:8000'
const browser = await openBrowser({ width: 1680, height: 960, port: 9898 })
const ev = (c) => browser.evaluate(c)
let failed = 0
try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecStore.getState().topology.status === "ready" && window.__netsecScene && window.__netsecScene.meshes > 100'), 'the scene', 40000)
  await sleep(1500)
  // The label of each device sits near it, so scan the area around the label with the pointer: some point must hover the
  // device, and a click there must select it. Anything in the campus layer that took or blocked picking would break this.
  for (const id of ['PC-1', 'PC-2', 'ADMIN-PC', 'APP-SRV', 'DB-SRV', 'IPS-1', 'IDS-1', 'SEC-LOG', 'CORE-SW1', 'FW1', 'R1-EDGE', 'EXT-ATK']) {
    await ev('window.__netsecStore.getState().select(null)')
    const box = await ev(`(() => { const l = [...document.querySelectorAll('.dev-label')].find((e) => e.querySelector('.dev-label__name').textContent.trim().startsWith(${JSON.stringify(id)})); const b = l.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width } })()`)
    let hit = null
    for (let dy = -70; dy <= 90 && !hit; dy += 6) {
      for (let dx = -Math.round(box.w / 2) - 120; dx <= Math.round(box.w / 2) + 60 && !hit; dx += 8) {
        const x = box.x + dx
        const y = box.y + dy
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        await sleep(25)
        if ((await ev('window.__netsecStore.getState().selection.hoveredId')) === id) hit = { x, y }
      }
    }
    let got = null
    if (hit) {
      await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 })
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 })
      await sleep(250)
      got = await ev('window.__netsecStore.getState().selection.selectedId')
    }
    const ok = got === id
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}: ${hit ? 'hovered, click selects ' + got : 'no point near its label hovers it'}`)
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
