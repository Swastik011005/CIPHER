/**
 * Browser half of scripts/check_split_origin.py: the front end is served from one origin and the API from another
 * (as on Render), in a real Chrome window. Run it through the Python script, which starts both servers.
 *
 *   node scripts/check_split_origin.mjs --site http://127.0.0.1:8301 --api http://127.0.0.1:8300/api [--out folder]
 *
 * It expects the API to be in production mode with read-only rules. It checks that the page loads and refreshes on a
 * deep link, that every API call crosses origins with CORS, that a scenario runs and the 3D scene draws under the
 * Content-Security-Policy, that the Rules page is visibly read-only and cannot send an edit, and that the console is clean.
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const site = args.site
const api = (args.api ?? '').replace(/\/+$/, '')
if (!site || !api) {
  console.error('Usage: node scripts/check_split_origin.mjs --site <front end origin> --api <API url with /api> [--out folder]')
  process.exit(2)
}
const out = resolve(args.out ?? 'split-origin-screens')
mkdirSync(out, { recursive: true })
const siteOrigin = new URL(site).origin
const apiOrigin = new URL(api).origin

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

const browser = await openBrowser({ width: 1440, height: 900, port: 9889 })
const ev = (code) => browser.evaluate(code)
const text = () => ev('document.body.innerText')
const waitText = (needle, ms = 20000) => waitFor(async () => (await text()).includes(needle), `text "${needle}"`, ms)
const click = (selector, label) =>
  ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})); if (!el) return false; el.click(); return true })()`)

try {
  // 1. A direct visit to a client-side route: the static host must answer with the app, and the app must reach the API.
  await browser.navigate(`${site}/simulation?debug=1`)
  await waitFor(() => ev('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the 3D scene', 30000)
  await waitFor(() => ev('window.__netsecStore.getState().topology.status === "ready"'), 'the topology from the API origin', 30000)
  check('direct visit to /simulation loads the app and the topology from the other origin', true, `${siteOrigin} -> ${apiOrigin}`)
  check('the page reports the engine online across origins', await ev('window.__netsecStore.getState().connection.status === "online"'))

  // 2. Everything the page requested went to the front end or the API, nowhere else.
  const requested = [...new Set(browser.requests().map((u) => new URL(u).origin))].filter((o) => o !== 'null' && o !== 'about:')
  check('every request went to the front end origin or the API origin', requested.every((o) => o === siteOrigin || o === apiOrigin), requested.join(', '))
  check('the API was called on the other origin', browser.requests().some((u) => u.startsWith(`${api}/topology`)) && browser.requests().some((u) => u.startsWith(`${api}/health`)))

  // 3. A scenario runs through the cross-origin API (POST with a JSON body, so a preflight happens first).
  await ev('window.__netsecStore.getState().runScenario("S2", "enforce")')
  await waitFor(() => ev('window.__netsecStore.getState().run.status === "ready" && window.__netsecStore.getState().playback.loaded'), 'S2 to load', 30000)
  check('S2 (Enforce) ran through the cross-origin API and is loaded for playback', await ev('window.__netsecStore.getState().run.meta.scenario_id === "S2"'))
  await ev('window.__netsecStore.getState().seekTo(9)')
  await sleep(1500)
  const stats = await waitFor(() => ev('window.__netsecScene && window.__netsecScene.meshes > 0 ? window.__netsecScene : null'), '3D scene statistics', 20000).catch(async (error) => {
    // Say why the scene is not drawing: a blocked script or font usually shows up as a console error.
    console.log(`      scene statistics: ${JSON.stringify(await ev('window.__netsecScene ?? null'))}; console errors: ${JSON.stringify(browser.errors().slice(0, 3))}`)
    throw error
  })
  check('the 3D scene draws under the Content-Security-Policy', stats.meshes > 100 && stats.triangles > 10000, `${stats.meshes} meshes, ${Math.round(stats.triangles / 1000)}k triangles`)
  check('the playback at T+9 shows alerts raised and packets blocked (S2, Enforce)', await ev('(() => { const s = window.__netsecStore.getState().playback.state; return Boolean(s) && s.counts.blocked > 0 && s.counts.alerts > 0 })()'))
  await browser.screenshot(join(out, '1-simulation-split-origin.png'))

  // 4. A refresh on a deep link, and the read-only Rules page.
  await browser.navigate(`${site}/rules?debug=1`)
  await waitText('Rules are read-only on this server')
  check('refreshing /rules returns the app (the static host rewrites to index.html)', (await text()).includes('Detection'))
  check('the Rules page says the rules are read-only', (await text()).includes('Read-only'))
  check('no reset button is offered', !(await text()).includes('Reset to shipped'))
  const detection = await ev(`(() => { const f = document.querySelector('fieldset.rules-lock'); const inputs = [...document.querySelectorAll('fieldset.rules-lock input')]; const apply = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Apply'); return { locked: Boolean(f && f.disabled), inputs: inputs.length, enabledInputs: inputs.filter((i) => !i.disabled && !i.matches('fieldset:disabled input')).length, applyDisabled: Boolean(apply && apply.disabled) } })()`)
  check('every detector switch and field is disabled', detection.locked && detection.inputs > 10 && detection.enabledInputs === 0, JSON.stringify(detection))
  check('Apply is disabled and the page explains why', detection.applyDisabled && (await text()).includes('cannot be changed on this server'))
  await browser.screenshot(join(out, '2-rules-read-only-detection.png'))

  await click('button', 'Firewall')
  await waitText('Restricted source addresses')
  const firewall = await ev(`(() => { const add = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add'); const input = document.querySelector('input[aria-label="Address to restrict"]'); const removes = [...document.querySelectorAll('button[aria-label^="Remove"]')]; return { addDisabled: Boolean(add && add.disabled), inputDisabled: Boolean(input && input.disabled), removes: removes.length, removesDisabled: removes.every((b) => b.disabled) } })()`)
  check('restricted addresses cannot be added or removed', firewall.addDisabled && firewall.inputDisabled && firewall.removes > 0 && firewall.removesDisabled, JSON.stringify(firewall))
  await browser.screenshot(join(out, '3-rules-read-only-firewall.png'))

  // 5. Even if the page is bypassed, the server refuses, and the browser may read the refusal (CORS).
  const refused = await ev(`fetch('${api}/rules/detectors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: { D1: { enabled: false } } }) }).then(async (r) => ({ status: r.status, body: await r.json() }))`)
  check('a rule edit sent straight from the page is refused with 403 and a readable message', refused.status === 403 && /read-only/.test(refused.body.detail), `${refused.status}`)
  const view = await ev(`fetch('${api}/rules').then((r) => r.json())`)
  check('the rules are unchanged on the server', view.revision === 0 && view.customised === false && view.read_only === true)

  // 6. A clean console: no script error, no blocked resource, no Content-Security-Policy violation.
  // Chrome logs every refused fetch as a console error: the one 403 above is this check's own deliberate probe.
  const errors = browser.errors().filter((e) => !/status of 403/.test(e))
  check('no console error and no Content-Security-Policy violation (apart from the deliberate 403 above)', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  failures += 1
  console.log(`FAIL  the check stopped: ${error.message}`)
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nALL BROWSER CHECKS PASSED' : `\n${failures} BROWSER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
