#!/usr/bin/env node
/**
 * Click-through crawler in a real browser: on every page it clicks every visible, enabled button, tab, toggle and internal link with
 * real mouse events (several rounds, with a scenario loaded and a device selected so the panels are full), types awkward text into
 * every text field, and fails on any console error, uncaught exception, failed request or error-status request.
 *
 *   node scripts/check_click_through.mjs --base http://127.0.0.1:8000 [--rounds 2] [--port 9931]
 *
 * It skips controls that would write a file or leave the app (Export, Copy, Download, external links). It changes the server's
 * in-memory state (rules, isolation) and puts it back at the end: it resets the rules and the security state. It changes nothing
 * in the repository.
 */
import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const rounds = Number(args.rounds ?? 2)
const browser = await openBrowser({ width: 1500, height: 950, port: Number(args.port ?? 9931) })
const ev = (c) => browser.evaluate(c)
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failed += 1
}
const problems = () => browser.errors().concat(browser.failedRequests())
const SKIP = /export|copy|download|save|^close$/i
const AWKWARD = ['', ' ', 'x'.repeat(400), '<img src=x onerror=alert(1)>', "'; DROP TABLE x;--", '999.999.999.999', '-1', '0', '1e999', '💥 unicode', '../../etc/passwd', '\u0000']

/**
 * The i-th visible, enabled control on the page (in document order). It is scrolled into view first, so controls far down a long
 * page or panel are reached too. Returns { label, x, y, count } (count is how many controls the page has now), or null past the end.
 */
const controlAt = (i) =>
  ev(`(() => {
    const els = []
    for (const el of document.querySelectorAll('button, [role=tab], [role=radio], [role=switch], summary, nav a, main a[href^="/"]')) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4 || el.disabled || el.getAttribute('aria-disabled') === 'true') continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue
      els.push(el)
    }
    const el = els[${i}]
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const r = el.getBoundingClientRect()
    const label = (el.getAttribute('aria-label') || el.textContent || el.title || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
    return { label, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), count: els.length }
  })()`)
const click = async (x, y) => {
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const typeInto = (text) =>
  ev(`(() => {
    let n = 0
    for (const i of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([disabled]), textarea:not([disabled])')) {
      const set = Object.getOwnPropertyDescriptor(i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set
      set.call(i, ${JSON.stringify('PLACEHOLDER')}.replace('PLACEHOLDER', ${JSON.stringify(text)}))
      i.dispatchEvent(new Event('input', { bubbles: true }))
      n += 1
    }
    return n
  })()`)

const PAGES = ['/overview', '/simulation', '/monitoring', '/threats', '/rules']
try {
  for (const path of PAGES) {
    await browser.navigate(`${base}${path}?debug=1`)
    await waitFor(() => ev('document.body.innerText.length > 150 && !!window.__netsecStore'), `${path}`, 40000)
    await sleep(path === '/simulation' ? 4000 : 1500)
    // a loaded run and a selected device so the panels have content
    await ev(`window.__netsecStore.getState().runScenario('P7', 'enforce').then(() => window.__netsecStore.getState().seekTo(12))`)
    await sleep(1500)
    if (path === '/simulation') await ev(`window.__netsecStore.getState().select('PC-2')`)
    const before = problems().length
    let clicked = 0
    const labels = new Set()
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < 400; i++) {
        const c = await controlAt(i)
        if (!c) break
        if (SKIP.test(c.label)) continue
        await sleep(60)
        const again = await controlAt(i) // after the scroll settles
        if (!again || again.label !== c.label) continue
        await click(again.x, again.y)
        clicked += 1
        labels.add(c.label)
        await sleep(140)
        if (!new URL(await ev('location.href')).pathname.startsWith(path)) {
          await browser.navigate(`${base}${path}?debug=1`)
          await waitFor(() => ev('document.body.innerText.length > 150 && !!window.__netsecStore'), `${path} again`, 40000)
          await ev(`window.__netsecStore.getState().runScenario('P7', 'enforce').then(() => window.__netsecStore.getState().seekTo(12))`)
          await sleep(1200)
        }
      }
      // awkward text into every field, then Enter
      for (const text of AWKWARD) {
        if ((await typeInto(text)) > 0) {
          await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
          await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
          await sleep(60)
        }
      }
    }
    const fresh = problems().slice(before)
    const alive = await ev('document.body.innerText.length > 100')
    check(`${path}: ${clicked} clicks on ${labels.size} different controls, text fuzzing: no console error or failed request`, fresh.length === 0, fresh.slice(0, 3).join(' | '))
    check(`${path}: the page is still alive afterwards`, alive)
  }
  // put the shared server state back
  await browser.navigate(`${base}/rules`)
  await ev(`fetch('/api/rules/reset', { method: 'POST' }).then(() => fetch('/api/state/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) }))`)
} finally {
  await browser.close()
}
console.log(`\n${failed === 0 ? 'All' : failed} click-through checks ${failed === 0 ? 'passed' : 'FAILED'}.`)
process.exit(failed === 0 ? 0 : 1)
