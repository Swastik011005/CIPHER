#!/usr/bin/env node
/** Lists every device label in the DOM with its position, to check that none is missing or off screen. */
import { openBrowser, waitFor } from '../../../scripts/lib/cdp.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:8000'
const browser = await openBrowser({ width: 1680, height: 960, port: 9895 })
try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => browser.evaluate('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the scene', 40000)
  await waitFor(() => browser.evaluate('window.__netsecStore.getState().topology.status === "ready" && window.__netsecScene && window.__netsecScene.meshes > 100'), 'the scene to draw', 40000)
  await browser.evaluate('window.__netsecStore.getState().setSetting("labels", "all")')
  await new Promise((r) => setTimeout(r, 1500))
  const rows = await browser.evaluate(`(() => {
    const st = window.__netsecStore.getState()
    const labels = [...document.querySelectorAll('.dev-label')].map((e) => {
      const b = e.getBoundingClientRect()
      return e.querySelector('.dev-label__name').textContent.trim() + ' @' + Math.round(b.x) + ',' + Math.round(b.y)
    })
    return { count: labels.length, labels, internetInDom: document.body.innerText.includes('Internet'), nodes: (st.topology.data?.nodes ?? []).map((n) => n.id), labelsSetting: st.settings.labels, labelDetail: st.labelDetail }
  })()`)
  console.log(JSON.stringify(rows, null, 1))
} finally {
  await browser.close()
}
