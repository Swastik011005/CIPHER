/**
 * Rehearses the whole demo (docs/DEMO_SCRIPT.md) in a real Chrome window, step by step, and checks the result
 * the presenter is told to expect at each step. It uses the app exactly as the presenter does (real clicks for
 * navigation, forms and buttons; the app's own player controls to move the timeline) and writes a screenshot per step.
 *
 *   node scripts/rehearse_demo.mjs [--base http://127.0.0.1:8000] [--out docs/demo]
 *
 * Default target is demo mode (one process: backend serving frontend/dist). Needs the backend running with the
 * frontend built. It also fails if the page asks for anything outside 127.0.0.1 (the demo must work offline) or logs
 * a console error. It resets the server's rules at the start and the end. Exit code 0 only if every step passes.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const base = args.base ?? 'http://127.0.0.1:8000'
const out = args.out ?? 'docs/demo'
mkdirSync(out, { recursive: true })

const steps = []
const started = Date.now()
const record = (name, ok, detail = '') => {
  steps.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail)

const browser = await openBrowser({ width: 1440, height: 900, port: 9888 })
const ev = (code) => browser.evaluate(code)
const api = (method, path, body) =>
  ev(`fetch('/api${path}', { method: '${method}', headers: {'Content-Type':'application/json'}, ${body ? `body: JSON.stringify(${JSON.stringify(body)}),` : ''} }).then(async (r) => ({ status: r.status, body: await r.json() }))`)
const text = () => ev('document.body.innerText')
const waitText = (needle, ms = 20000) => waitFor(async () => (await text()).includes(needle), `text "${needle}"`, ms)
const clickText = (selector, label) =>
  ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(label)} || e.textContent.trim().startsWith(${JSON.stringify(label)})); if (!el) return false; el.click(); return true })()`)
const nav = (label) => clickText('a', label)
const store = (code) => ev(`(() => { const s = window.__netsecStore.getState(); return ${code} })()`)
const counters = () =>
  ev(`Object.fromEntries([...document.querySelectorAll('.pb-counter')].map((c) => [c.querySelector('.pb-counter__label').textContent, Number(c.querySelector('.pb-counter__value').textContent)]))`)
const seek = async (t) => {
  await ev(`(() => { const s = window.__netsecStore.getState(); if (s.playback.playing) s.togglePlay(); s.seekTo(${t}) })()`)
  await sleep(450)
}
const run = async (scenario, mode) => {
  await ev(`window.__netsecStore.getState().runScenario('${scenario}', '${mode}')`)
  await waitFor(() => ev(`window.__netsecStore.getState().run.status === 'ready' && window.__netsecStore.getState().run.meta.scenario_id === '${scenario}'`), `${scenario} to load`, 30000)
  await sleep(300)
}
const shot = (name) => browser.screenshot(join(out, `${name}.png`))
const timeStep = (label, t0) => console.log(`      (${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s)`)

try {
  await browser.setViewport(1440, 900)
  await browser.navigate(`${base}/overview?debug=1`)
  await api('POST', '/rules/reset')
  await waitText('See how traffic is inspected')
  await shot('01-overview')
  check('1 Overview: the three defence layers are explained', (await text()).includes('Firewall') && (await text()).includes('IDS') && (await text()).includes('IPS'))
  check('1 Overview: says the traffic is synthetic', (await text()).toLowerCase().includes('synthetic'))

  // 2. topology and the 3D environment
  await nav('Simulation')
  await waitFor(() => ev('!!document.querySelector("canvas") && !!window.__netsecStore'), 'the 3D scene', 30000)
  await waitText('Simulated campus')
  const topo = await text()
  check('2 Topology card: 16 devices, 18 links, 4 VLANs, 7 subnets', /16\s+\+ 1 Internet/.test(topo) && topo.includes('18') && topo.includes('7'))
  await ev(`window.__netsecStore.setState({ autoLowered: true }); window.__netsecStore.getState().setSetting('quality', 'high')`)
  for (const preset of ['perimeter', 'core', 'servers', 'secops', 'overview']) {
    await ev(`window.__netsecStore.getState().requestPreset('${preset}')`)
    await sleep(900)
  }
  await ev(`window.__netsecStore.getState().select('IPS-1')`)
  await sleep(600)
  const roles = await text()
  check('2 Selecting IPS-1 shows it is the inline prevention point', roles.includes('Inline prevention point') && roles.includes('IPS-1'))
  await ev(`window.__netsecStore.getState().select('IDS-1')`)
  await sleep(500)
  check('2 Selecting IDS-1 shows it is a passive sensor that never blocks', (await text()).includes('Passive sensor') && (await text()).includes('never forwards, drops or blocks'))
  await ev(`window.__netsecStore.getState().clearSelection()`)

  // 3. S1 normal traffic
  let t0 = Date.now()
  await run('S1', 'monitor')
  await seek(24)
  const s1 = await counters()
  check('3 S1: 0 alerts, 0 blocked, everything delivered clean', s1.Alerts === 0 && s1.Blocked === 0 && s1.Flagged === 0 && s1.Clean === s1.Packets && s1.Packets > 0, JSON.stringify(s1))
  await seek(1.8)
  const firstPacket = await store(`Object.values(s.playback.state.packets).find((p) => p.mirrorOf == null && p.dst === '10.0.30.10').pid`)
  await ev(`window.__netsecStore.getState().selectPacket(${firstPacket})`)
  await seek(4.5)
  await sleep(500)
  const inspector = await text()
  check('3 S1: the packet inspector shows PC-1 to ACC-SW2 to CORE-SW1 to IPS-1 to SRV-SW3 and its SPAN copy', ['PC-1 → ACC-SW2', 'CORE-SW1 → IPS-1', 'IPS-1 → SRV-SW3', 'SPAN copy sent to IDS-1'].every((t) => inspector.includes(t)))
  await shot('02-s1-packet-inspector')
  await ev(`window.__netsecStore.getState().clearSelection()`)
  timeStep('S1', t0)

  // 4. S2 monitor vs enforce
  t0 = Date.now()
  await run('S2', 'monitor')
  await seek(3.0)
  check('4 S2 Monitor: no alert before the 6th port', (await counters()).Alerts === 0)
  await seek(3.3)
  check('4 S2 Monitor: IDS-1 raises MEDIUM at the 6th port (1 alert)', (await counters()).Alerts === 1)
  await seek(4.85)
  check('4 S2 Monitor: HIGH at the 12th port (3 alerts so far)', (await counters()).Alerts === 3)
  await seek(12)
  const monMid = await counters()
  check('4 S2 Monitor: IPS-1 records "would block" but nothing is blocked', monMid.Alerts === 4 && monMid.Blocked === 0 && monMid.Flagged > 0, JSON.stringify(monMid))
  await shot('03-s2-monitor')
  await seek(46)
  const monEnd = await counters()
  check('4 S2 Monitor end: 88 packets, 62 clean, 26 flagged, 0 blocked, 4 alerts, 1 incident', monEnd.Packets === 88 && monEnd.Clean === 62 && monEnd.Flagged === 26 && monEnd.Blocked === 0 && monEnd.Alerts === 4 && monEnd.Incidents === 1, JSON.stringify(monEnd))
  await run('S2', 'enforce')
  await seek(5.1)
  const enfEarly = await counters()
  check('4 S2 Enforce: PC-2 is blocked at about 4.9 s', enfEarly.Blocked >= 1, JSON.stringify(enfEarly))
  await seek(10)
  const blockedOnScreen = await store(`Object.keys(s.playback.state.blocks).join()`)
  check('4 S2 Enforce: the block table holds PC-2 (10.0.10.12) with a countdown', blockedOnScreen === '10.0.10.12' && (await text()).includes('left'))
  await shot('04-s2-enforce-blocked')
  const dropPid = await store(`Object.values(s.playback.state.packets).find((p) => p.end && p.end.type === 'dropped').pid`)
  await ev(`window.__netsecStore.getState().selectPacket(${dropPid})`)
  await sleep(500)
  const dropText = await text()
  check('4 S2 Enforce: a dropped scan packet is inspectable ("Dropped at IPS-1")', dropText.includes('Dropped at IPS-1') && dropText.includes('Blocked'))
  await shot('05-s2-packet-dropped')
  await ev(`window.__netsecStore.getState().clearSelection()`)
  await seek(25.5)
  check('4 S2 Enforce: the block has expired by 25.1 s', (await store(`Object.keys(s.playback.state.blocks).length`)) === 0)
  await seek(46)
  const enfEnd = await counters()
  check('4 S2 Enforce end: 62 packets, 32 clean, 6 flagged, 24 blocked, 4 alerts, 1 incident', enfEnd.Packets === 62 && enfEnd.Clean === 32 && enfEnd.Flagged === 6 && enfEnd.Blocked === 24 && enfEnd.Alerts === 4 && enfEnd.Incidents === 1, JSON.stringify(enfEnd))
  // the live "from the playhead on" switch
  await seek(2)
  await ev(`(() => { const group = document.querySelector('.mode-row--live'); [...group.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Monitor').click() })()`)
  await waitFor(() => ev(`window.__netsecStore.getState().run.request && window.__netsecStore.getState().run.request.controls.length === 1`), 'the mode switch to re-run', 30000)
  await seek(46)
  const switched = await counters()
  check('4 Switching to Monitor from 2.0 s re-simulates: 0 blocked at the end, the playhead stayed', switched.Blocked === 0 && switched.Flagged === 26, JSON.stringify(switched))
  timeStep('S2', t0)

  // 5. S3
  t0 = Date.now()
  await run('S3', 'enforce')
  await seek(40)
  const s3 = await counters()
  check('5 S3 Enforce: 5 packets, 1 delivered (the reset), 4 blocked, 4 alerts, 3 incidents', s3.Packets === 5 && s3.Clean === 1 && s3.Blocked === 4 && s3.Alerts === 4 && s3.Incidents === 3, JSON.stringify(s3))
  const rstPid = await store(`Object.values(s.playback.state.packets).find((p) => p.injectedBy).pid`)
  await ev(`window.__netsecStore.getState().selectPacket(${rstPid})`)
  await sleep(500)
  check('5 S3: the reset packet is labelled "Injected by IPS-1"', (await text()).includes('Injected by IPS-1'))
  await shot('06-s3-reset-inspector')
  await ev(`window.__netsecStore.getState().clearSelection()`)
  const rules = await store(`Object.keys(s.playback.state.ruleHits).sort().join()`)
  check('5 S3: the denials name their rules (STAFF-IN:10, STAFF-IN:20, OUTSIDE-IN:implicit-deny)', ['STAFF-IN:10', 'STAFF-IN:20', 'OUTSIDE-IN:implicit-deny'].every((r) => rules.includes(r)), rules)
  timeStep('S3', t0)

  // 6. S4
  t0 = Date.now()
  await run('S4', 'enforce')
  await seek(8)
  check('6 S4: no alert while the flood is still 15 to 40 packets a second', (await counters()).Alerts === 0)
  await seek(12)
  const s4mid = await counters()
  check('6 S4: MEDIUM alerts from both sensors and IPS-1 is rate-limiting', s4mid.Alerts === 2 && s4mid.Blocked > 0, JSON.stringify(s4mid))
  await shot('07-s4-rate-limit')
  await seek(16.5)
  check('6 S4: HIGH raised and the attacker blocked (4 alerts)', (await counters()).Alerts === 4 && (await store(`Object.keys(s.playback.state.blocks).join()`)) === '203.0.113.66')
  await seek(44)
  const s4 = await counters()
  check('6 S4 end: 693 packets, 332 clean, 56 flagged, 305 blocked, 4 alerts, 1 incident', s4.Packets === 693 && s4.Clean === 332 && s4.Flagged === 56 && s4.Blocked === 305 && s4.Alerts === 4 && s4.Incidents === 1, JSON.stringify(s4))
  timeStep('S4', t0)

  // 7. Threat Centre and Monitoring
  await nav('Threats')
  await waitText('Detections so far')
  const threats = await text()
  check('7 Threat Centre: lists the D3 alerts from IDS-1 and IPS-1 and why packets were stopped', threats.includes('D3') && threats.includes('IDS-1') && threats.includes('IPS-1') && threats.includes('IPS rate limit'))
  await shot('08-threat-centre')
  await nav('Monitoring')
  await waitText('Activity at the playhead')
  const monitoring = await text()
  check('7 Monitoring: counters equal the Simulation page (693 packets, 305 blocked)', monitoring.includes('693') && monitoring.includes('305'))
  await shot('09-monitoring')

  // 8. custom traffic
  await nav('Simulation')
  await run('S1', 'monitor')
  await seek(4.6)
  await clickText('button', 'Staff → DB:3306')
  await sleep(300)
  await clickText('button', 'Send at')
  await waitFor(() => ev(`window.__netsecStore.getState().run.request && window.__netsecStore.getState().run.request.customFlows.length === 1`), 'the custom flow to be sent', 30000)
  await seek(7.5)
  const custom = await counters()
  check('8 Custom traffic PC-1 to DB:3306: 1 blocked and 1 alert (IDS-1 D4)', custom.Blocked === 1 && custom.Alerts === 1, JSON.stringify(custom))
  await clickText('button', 'open packet')
  await sleep(500)
  const customText = await text()
  check('8 Its packet shows the ACL denial with rule STAFF-IN:10 at CORE-SW1', customText.includes('Dropped at CORE-SW1 (acl_deny)') && customText.includes('STAFF-IN:10'))
  await shot('10-custom-traffic-acl-deny')

  // 9. rules and scenarios
  await nav('Rules')
  await waitText('Detection (IDS)')
  await clickText('button', 'Detection (IDS)')
  await waitText('Port scan')
  await ev(`document.querySelector('input[aria-label="Enable D1 Port scan"]').click()`)
  await sleep(300)
  await clickText('button', 'Apply')
  await waitText('Applied 1 change')
  check('9 Rules: disabling D1 is applied by the server', (await api('GET', '/rules')).body.detectors.D1.settings.enabled === false)
  await shot('11-rules-d1-disabled')
  await clickText('button', 'Scenarios & checks')
  await waitText('Run all checks')
  await ev(`(() => { const card = document.querySelector('section[aria-label^="S2 "]'); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run check').click() })()`)
  await waitText('SOME FAIL', 30000)
  check('9 Rules: with D1 off the S2 check fails and shows expected 6, 12 / actual none', (await text()).includes('6, 12') && (await text()).includes('none'))
  await shot('12-rules-s2-check-fails')
  await clickText('button', 'Reset to shipped')
  await waitText('Back to the shipped rules')
  await clickText('button', 'Run all checks')
  await waitText('ALL PASS', 90000)
  const all = await text()
  check('9 Rules: after reset "Run all checks" passes every scenario (12 runs, 93 checks)', all.includes('12 of 12 runs pass') && all.includes('93 of 93 checks'))
  await shot('13-rules-all-checks-pass')

  // 10. offline and clean
  const external = [...new Set(browser.requests().map((u) => new URL(u).hostname))].filter((h) => !['127.0.0.1', 'localhost', ''].includes(h))
  check('10 Offline: the whole demo made no request outside 127.0.0.1', external.length === 0, external.join(', '))
  const errors = browser.errors()
  check('10 No console errors during the demo', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (error) {
  record('rehearsal ran to the end', false, String(error.message ?? error))
  try {
    await shot('failure')
  } catch {
    /* ignore */
  }
} finally {
  await api('POST', '/rules/reset').catch(() => {})
  await browser.close()
  const failed = steps.filter((s) => !s.ok)
  console.log(`\n${steps.length - failed.length} of ${steps.length} checks passed in ${((Date.now() - started) / 1000).toFixed(0)} s (scripted actions only: the narration time is in docs/DEMO_SCRIPT.md)`)
  process.exit(failed.length ? 1 : 0)
}
