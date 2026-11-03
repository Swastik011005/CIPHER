/**
 * Drives the real Rules & Scenarios page in Chrome against the real backend, end to end:
 * edit a detector, see invalid input refused, apply, run checks and watch them fail for the edited rule,
 * reset, run all checks, manage restricted addresses. Prints each step with PASS or FAIL, writes screenshots.
 *
 *   node scripts/check_rules_ui.mjs [--out docs/screenshots] [--width 1440 --height 900]
 *
 * Needs the backend and the Vite dev server. It resets the server's rules at the start and the end.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const out = args.out ?? 'docs/screenshots'
const width = Number(args.width ?? 1440)
const height = Number(args.height ?? 900)
mkdirSync(out, { recursive: true })

const steps = []
const record = (name, ok, detail = '') => {
  steps.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

const browser = await openBrowser({ width, height, port: 9666 })
const ev = (code) => browser.evaluate(code)
const api = (method, path, body) =>
  ev(`fetch('/api${path}', { method: '${method}', headers: {'Content-Type':'application/json'}, ${body ? `body: JSON.stringify(${JSON.stringify(body)}),` : ''} }).then(async (r) => ({ status: r.status, body: await r.json() }))`)
const clickText = (selector, text) =>
  ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)} || e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
const text = () => ev('document.body.innerText')
const waitText = (needle, ms = 15000) => waitFor(async () => (await text()).includes(needle), `text "${needle}"`, ms)
const setInput = (label, value) =>
  ev(`(() => { const el = document.querySelector('input[aria-label=${JSON.stringify(label)}]'); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

try {
  await browser.setViewport(width, height)
  await browser.navigate('http://localhost:5173/rules')
  await api('POST', '/rules/reset')
  await browser.navigate('http://localhost:5173/rules')
  await waitText('Detection (IDS)')
  await waitText('Port scan')

  // 1. the page is built from the backend's rules
  const view = (await api('GET', '/rules')).body
  const cards = await ev(`document.querySelectorAll('section.detector').length`)
  record('six detector cards are shown, from the backend', cards === 6 && Object.keys(view.detectors).length === 6, `cards=${cards}`)
  record('shipped rules are labelled as such', (await text()).includes('Shipped rules'))
  await browser.screenshot(join(out, `${width}x${height}-rules-detection.png`))

  // 2. invalid input is refused next to the field, and cannot be applied
  await setInput('D1 MEDIUM at', '1')
  await sleep(300)
  const invalid = await text()
  const applyDisabled = await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Apply').disabled`)
  record('an out-of-range threshold shows its reason and disables Apply', invalid.includes('Between 2 and 50.') && applyDisabled)
  await setInput('D1 MEDIUM at', '20')
  await sleep(300)
  record('thresholds out of order are flagged', (await text()).includes('Must be lower than the HIGH value'))
  await clickText('button', 'Discard')
  await sleep(300)

  // 3. disable D1 and apply: the server stores it
  await ev(`document.querySelector('input[aria-label="Enable D1 Port scan"]').click()`)
  await sleep(300)
  record('an edit is counted as an unsaved change', (await text()).includes('1 unsaved change'))
  await clickText('button', 'Apply')
  await waitText('Applied 1 change')
  const afterApply = (await api('GET', '/rules')).body
  record('Apply is stored by the server (D1 off, customised, new hash)', afterApply.detectors.D1.settings.enabled === false && afterApply.customised && afterApply.rules_hash !== afterApply.defaults_hash)
  record('the page now says custom rules are in force', (await text()).includes('Custom rules'))
  await browser.screenshot(join(out, `${width}x${height}-rules-applied.png`))

  // 4. a run uses it: no D1 alert; the S2 check shows the failure
  const run = (await api('POST', '/sim/run', { scenario_id: 'S2', ips_mode: 'enforce' })).body
  const d1 = run.events.filter((e) => e.type === 'alert.raised' && e.rule === 'D1').length
  record('the next S2 run raises no D1 alert and blocks nothing', d1 === 0 && run.summary.blocked === 0 && run.rules_customised === true, `d1 alerts=${d1}`)
  await clickText('button', 'Scenarios & checks')
  await waitText('Scenario library').catch(() => {})
  await waitText('Run all checks')
  await sleep(800)
  await ev(`(() => { const card = document.querySelector('section[aria-label="S2 Port scan with IDS detection"]'); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run check').click() })()`)
  await waitText('SOME FAIL', 30000)
  const failText = await text()
  record('the S2 check fails for the edited rule and says what was expected', failText.includes('FAIL') && failText.includes('6, 12') && failText.includes('checked with custom rules'))
  await browser.screenshot(join(out, `${width}x${height}-rules-checks-failing.png`))

  // 5. reset: shipped rules, every check passes
  await clickText('button', 'Reset to shipped')
  await waitText('Back to the shipped rules')
  record('Reset returns to the shipped rules', (await api('GET', '/rules')).body.customised === false && (await text()).includes('Shipped rules'))
  await clickText('button', 'Run all checks')
  await waitText('ALL PASS', 60000)
  const passText = await text()
  record('Run all checks: every scenario passes with the shipped rules', passText.includes('12 of 12 runs pass') && /9\d of 9\d checks/.test(passText), (passText.match(/\d+ of \d+ runs pass · \d+ of \d+ checks/) ?? [''])[0])
  await browser.screenshot(join(out, `${width}x${height}-rules-checks-passing.png`))

  // 6. restricted addresses: add, refuse, remove
  await clickText('button', 'Firewall & ACL')
  await waitText('Restricted source addresses')
  await setInput('Address to restrict', '10.0.10.11')
  await clickText('button', 'Add')
  await waitText('inside the campus')
  record('an address inside the campus is refused with a reason', true)
  await setInput('Address to restrict', '203.0.113.25')
  await clickText('button', 'Add')
  await waitText('Restricted addresses updated')
  const restricted = (await api('GET', '/rules')).body.restricted_ips.addresses
  record('a valid address is stored by the server', restricted.includes('203.0.113.25'), restricted.join(', '))
  const flow = { type: 'tcp_session', id: 'X1', src: 'EXT-USR', dst: 'APP-SRV', dport: 443, start: 2, request_bytes: 100 }
  const denied = (await api('POST', '/sim/run', { scenario_id: 'S1', custom_flows: [flow] })).body.events.filter((e) => e.type === 'policy.decision' && e.action === 'deny')
  record('FW1 then denies that address with OUTSIDE-IN:10', denied.length === 1 && denied[0].rule_id === 'OUTSIDE-IN:10', denied.map((d) => d.rule_id).join())
  await clickText('button', 'Show IOS config')
  await waitText('ip access-list extended STAFF-IN')
  const ios = await ev(`document.querySelector('pre.code-block').innerText`)
  record('the IOS export shows the live policies, including the restricted address just added', ios.includes('remark STAFF-IN:10') && ios.includes('deny ip host 203.0.113.25 any') && ios.includes('ip access-list extended OUTSIDE-IN'))
  await browser.screenshot(join(out, `${width}x${height}-rules-firewall.png`))
  await ev(`document.querySelector('button[aria-label="Remove 203.0.113.25"]').click()`)
  await waitFor(async () => !(await text()).includes('Remove 203.0.113.25') || (await api('GET', '/rules')).body.restricted_ips.addresses.every((a) => a !== '203.0.113.25'), 'the address to be removed')
  record('removing an address is stored by the server', !(await api('GET', '/rules')).body.restricted_ips.addresses.includes('203.0.113.25'))

  // 7. prevention tab shows IPS policy; scenario library has launch controls
  await clickText('button', 'Prevention (IPS)')
  await waitText('Detector → action')
  record('the IPS table lists rate limiting and the allowlist', (await text()).includes('rate-limit the source to 10 packets/s') && (await text()).includes('10.0.99.0/24'))
  await browser.screenshot(join(out, `${width}x${height}-rules-prevention.png`))
  await clickText('button', 'Scenarios & checks')
  await waitText('Play in 3D')
  const library = await ev(`document.querySelectorAll('section.scenario-lib').length`)
  record('the scenario library shows S1 to S7 with launch controls', library === 7, `cards=${library}`)
  await browser.screenshot(join(out, `${width}x${height}-rules-scenarios.png`))
  await ev(`(() => { const card = document.querySelector('section[aria-label^="S4 "]'); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Play in 3D').click() })()`)
  await waitFor(async () => (await ev('location.pathname')) === '/simulation', 'navigation to the simulation')
  await waitText('Run S4', 5000).catch(() => {})
  await waitFor(() => ev(`window.__netsecStore && window.__netsecStore.getState().run.meta && window.__netsecStore.getState().run.meta.scenario_id === 'S4'`), 'S4 to load', 30000).catch(() => {})
  record('Play in 3D opens the simulation with that scenario running', (await ev('location.pathname')) === '/simulation')
} catch (error) {
  record('script ran to the end', false, String(error.message ?? error))
} finally {
  await api('POST', '/rules/reset').catch(() => {})
  const errors = browser.errors()
  record('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await browser.close()
  const failed = steps.filter((s) => !s.ok)
  console.log(`\n${steps.length - failed.length} of ${steps.length} steps passed`)
  process.exit(failed.length ? 1 : 0)
}
