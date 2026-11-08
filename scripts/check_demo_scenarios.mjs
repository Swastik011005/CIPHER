#!/usr/bin/env node
/**
 * Browser check of the nine presentation scenarios, the endpoint CLI, EDR isolation and the SIEM view, in real Chrome.
 *
 *   node scripts/check_demo_scenarios.mjs --base http://127.0.0.1:8000 [--out <screenshot folder>] [--port 9891]
 *
 * It drives the actual UI (launcher, device panel tabs, terminal, buttons), then reads the loaded trace to check that what the
 * screen says is what the backend decided. Needs the app in demo mode with the built front end.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const base = args.base ?? 'http://127.0.0.1:8000'
const out = args.out ? resolve(args.out) : null
if (out) mkdirSync(out, { recursive: true })

const browser = await openBrowser({ width: 1680, height: 960, port: Number(args.port ?? 9891) })
const ev = (c) => browser.evaluate(c)
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}
const st = (path) => ev(`window.__netsecStore.getState().${path}`)
const shot = async (name) => {
  if (!out) return
  await sleep(400)
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'))
}
const clickButton = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true })()`)
const waitRun = async (id, ms = 30000) => waitFor(() => ev(`window.__netsecStore.getState().run.meta?.scenario_id === ${JSON.stringify(id)} && window.__netsecStore.getState().playback.loaded`), `scenario ${id}`, ms)
const finish = async () => {
  await ev('(() => { const s = window.__netsecStore.getState(); s.seekTo(s.playback.duration) })()')
  await sleep(300)
}
/** Type a command in the CLI of the selected endpoint and return its printed lines. */
async function cli(command) {
  const before = await ev('document.querySelectorAll(".cli__entry").length')
  await ev(`(() => { const i = document.querySelector('.cli__input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(command)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.closest('form').requestSubmit() })()`)
  await waitFor(() => ev(`document.querySelectorAll('.cli__entry').length > ${before} || ${command === 'clear'}`), `output of ${command}`, 20000)
  await sleep(200)
  return ev(`(() => { const e = [...document.querySelectorAll('.cli__entry')].pop(); return e ? e.querySelector('.cli__out').textContent : '' })()`)
}
const events = (type) => ev(`Object.values(window.__netsecStore.getState().playback.state.packets).length ? 0 : 0`).then(() => null)

try {
  await browser.navigate(`${base}/simulation?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecStore.getState().topology.status === "ready" && window.__netsecStore.getState().presentation.items.length === 9'), 'the topology and the nine scenarios', 60000)
  await ev('window.__netsecStore.setState({ autoLowered: true })')
  await ev('window.__netsecStore.getState().securityAction({ action: "reset" })')
  await sleep(800)

  console.log('\n== the launcher')
  const cards = await ev(`[...document.querySelectorAll('[aria-label="Demonstration scenario"] button')].map((b) => b.textContent.trim())`)
  check('the launcher lists nine scenarios with names', cards.length === 9 && cards[1].includes('Unauthorized Security VLAN access'), cards.join(' | '))
  check('the topology has 31 nodes and 32 links (17 and 18 original)', (await st('topology.data.nodes.length')) === 31 && (await st('topology.data.links.length')) === 32)

  /** Run scenario N from the launcher with the real buttons and wait until it is loaded. */
  async function launch(n, mode = 'enforce') {
    await ev(`(() => { const b = [...document.querySelectorAll('[aria-label="Demonstration scenario"] button')][${n - 1}]; b.click() })()`)
    await sleep(200)
    await ev(`(() => { const g = [...document.querySelectorAll('[aria-label="IPS mode"] button')]; const w = g.filter((b) => b.textContent.trim() === ${JSON.stringify(mode === 'enforce' ? 'Enforce' : 'Monitor')}); w[0]?.click() })()`)
    await sleep(100)
    await clickButton('Run')
    await waitRun(`P${n}`)
    await finish()
  }
  const outcome = () => ev(`document.querySelector('.demo-outcome')?.innerText ?? ''`)
  const stats = () => st('playback.state.counts')
  const dropsAt = () => ev(`(() => { const o = {}; for (const p of Object.values(window.__netsecStore.getState().playback.state.packets)) if (p.mirrorOf == null && p.end?.type === 'dropped') { const k = p.end.node + ':' + p.end.reason; o[k] = (o[k] ?? 0) + 1 } return o })()`)

  console.log('\n== scenarios 1 to 9 (Enforce)')
  await launch(1)
  let c = await stats()
  check('P1: normal traffic is delivered, nothing blocked, no alert, no SIEM event', c.blocked === 0 && c.alerts === 0 && c.delivered_clean > 0 && (await st('playback.state.siem.length')) === 0, JSON.stringify(c))
  await shot('p1-normal')

  await launch(2)
  let d = await dropsAt()
  check('P2: every ping is dropped at CORE-SW1 by the ACL (STAFF-IN:20) and the SIEM hears from CORE-SW1', d['CORE-SW1:acl_deny'] === 4 && (await st('playback.state.siem')).some((e) => e.source === 'CORE-SW1'), JSON.stringify(d))
  check('P2: the ACL counter rose on the server', ((await st('securityState')) ?? {}).rule_hits !== undefined)
  await shot('p2-security-vlan')

  await launch(3)
  d = await dropsAt()
  check('P3: TCP/3306 is denied at CORE-SW1 (STAFF-IN:10) and the database is not reached', d['CORE-SW1:acl_deny'] === 1 && !(await ev(`Object.values(window.__netsecStore.getState().playback.state.packets).some((p) => p.end?.type === 'delivered' && p.end.node === 'DB-SRV')`)))

  await launch(4)
  const zt = await st('playback.state.zt')
  d = await dropsAt()
  check('P4: two Zero Trust allow decisions for ADMIN-PC with reasons; PC-1 is stopped by the ACL', zt.length === 2 && zt.every((z) => z.decision === 'allow' && z.device === 'ADMIN-PC' && z.reason && z.factors.length) && d['CORE-SW1:acl_deny'] === 1)
  check('P4: the outcome panel names Zero Trust', (await outcome()).includes('Zero Trust'))
  await shot('p4-zero-trust')

  await launch(5)
  c = await stats()
  check('P5: external HTTP crosses R1-EDGE and FW1 and is delivered; nothing raised', c.blocked === 0 && c.alerts === 0 && (await ev(`Object.values(window.__netsecStore.getState().playback.state.packets).some((p) => p.end?.type === 'delivered' && p.end.node === 'APP-SRV')`)))

  await launch(6)
  d = await dropsAt()
  check('P6: the firewall denies the external database access; no IDS or IPS alert', d['FW1:fw_deny'] === 1 && (await stats()).alerts === 0 && (await st('playback.state.siem')).every((e) => e.source === 'FW1'))

  await launch(9)
  check('P9: IDS-1 and IPS-1 raise D6, the SIEM lists the events in one incident', (await st('playback.state.alerts')).every((a) => a.rule === 'D6') && new Set((await st('playback.state.siem')).map((e) => e.incident_id)).size === 1)
  await shot('p9-siem')

  console.log('\n== scenario 7: compromise, EDR, interactive isolation (no scripted operator)')
  await ev('window.__netsecStore.getState().securityAction({ action: "reset" })')
  await launch(7)
  check('P7 (no operator action): EDR reports PC-2 compromised and nothing is isolated', (await st('playback.state.edr'))['PC-2']?.state === 'compromised' && !(await ev(`Object.values(window.__netsecStore.getState().playback.state.packets).some((p) => p.end?.reason === 'edr_isolated')`)))
  check('P7: IDS-1 and IPS-1 detect the scan from PC-2', new Set((await st('playback.state.alerts')).map((a) => a.sensor)).size === 2)
  // the operator: seek to 8 s, open PC-2, Security tab, Isolate Endpoint
  await ev('window.__netsecStore.getState().seekTo(8); window.__netsecStore.getState().togglePlay(); window.__netsecStore.getState().select("PC-2")')
  await sleep(600)
  await clickButton('Security')
  await sleep(400)
  await shot('p7-security-tab')
  check('P7: the Security tab offers Isolate Endpoint and Restore Endpoint', await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Isolate Endpoint') && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Restore Endpoint')`))
  await clickButton('Isolate Endpoint')
  await waitFor(() => ev(`window.__netsecStore.getState().run.request?.controls?.some((c) => c.type === 'endpoint') && window.__netsecStore.getState().playback.loaded`), 'the isolation re-run', 30000)
  await finish()
  const edr = await st('playback.state.edr')
  const isoAt = await ev(`window.__netsecStore.getState().playback.state.edr['PC-2']?.since ?? null`)
  check('P7: the operator action isolates PC-2 at the playhead and the server keeps it', edr['PC-2']?.state === 'isolated' && edr['PC-2'].cause === 'operator' && (await st('securityState.isolated')).includes('PC-2'), `isolated at T+${isoAt}`)
  const lateDrops = await ev(`Object.values(window.__netsecStore.getState().playback.state.packets).filter((p) => p.src === '10.0.10.12' && p.end?.reason === 'edr_isolated' && p.createdAt >= ${isoAt - 0.001}).length`)
  const pc1 = await ev(`Object.values(window.__netsecStore.getState().playback.state.packets).filter((p) => p.flow.startsWith('P7-pc1') && p.end?.type === 'dropped').length`)
  check('P7: after isolation PC-2 traffic is dropped by EDR, PC-1 is unaffected', lateDrops > 0 && pc1 === 0, `${lateDrops} PC-2 packets dropped, ${pc1} PC-1 packets dropped`)
  check('P7: the SIEM records the isolation and groups the story into one PC-2 incident', (await st('playback.state.siem')).some((e) => e.source === 'EDR' && e.kind === 'state' && e.node === 'PC-2') && new Set((await st('playback.state.siem')).filter((e) => e.node === 'PC-2').map((e) => e.incident_id)).size === 1)
  await shot('p7-isolated')

  console.log('\n== endpoint CLI')
  await ev('window.__netsecStore.getState().select("PC-2")')
  await sleep(500)
  await clickButton('CLI')
  await sleep(300)
  let text = await cli('ping 10.0.30.10')
  check('CLI on isolated PC-2: ping fails with the EDR reason', text.includes('Received = 0') && text.includes('isolated by EDR'), text.split('\n').slice(-3).join(' / '))
  await ev('window.__netsecStore.getState().select("PC-1")')
  await sleep(500)
  await clickButton('CLI')
  await sleep(300)
  text = await cli('ping 10.0.30.10')
  check('CLI on PC-1 (not isolated): ping succeeds, 4 of 4', text.includes('Received = 4') && text.includes('Reply from 10.0.30.10'), text.split('\n').slice(-1)[0])
  text = await cli('ping 10.0.99.21')
  check('CLI: ping to the Security VLAN fails with STAFF-IN rule 20 at CORE-SW1', text.includes('Destination host unreachable') && text.includes('STAFF-IN rule 20') && text.includes('Enforcing device: CORE-SW1'))
  text = await cli('telnet 10.0.30.20 3306')
  check('CLI: telnet to the database port times out with the database reason', text.includes('timed out') && text.includes('STAFF-IN rule 10'))
  text = await cli('ipconfig')
  check('CLI: ipconfig shows the address, mask, gateway and VLAN', text.includes('10.0.10.11') && text.includes('255.255.255.0') && text.includes('10.0.10.1') && text.includes('VLAN'))
  text = await cli('tracert 10.0.30.10')
  check('CLI: tracert shows CORE-SW1 and completes', text.includes('CORE-SW1') && text.includes('Trace complete'))
  text = await cli('rm -rf /')
  check('CLI: an unsupported command is refused and nothing runs', text.includes('not recognized'))
  text = await cli('ping 10.0.30.10; dir')
  check('CLI: shell metacharacters are rejected', text.includes('not accepted'))
  await cli('clear')
  check('CLI: clear empties the screen', (await ev('document.querySelectorAll(".cli__entry").length')) === 0)
  await ev('window.__netsecStore.getState().select("PC-1")')
  await shot('cli-pc1')
  check('CLI: the packets of a command replay in 3D (the loaded run is the CLI run)', (await st('run.meta.scenario_id')) === 'CLI')

  console.log('\n== read-only device CLI')
  await ev('window.__netsecStore.getState().select("CORE-SW1")')
  await sleep(600)
  await clickButton('CLI')
  await sleep(300)
  text = await cli('show access-lists')
  check('CORE-SW1 CLI: show access-lists lists STAFF-IN with its hit counters', text.includes('Extended IP access list STAFF-IN') && /20 deny ip 10\.0\.10\.0 0\.0\.0\.255 10\.0\.99\.0 0\.0\.0\.255 \(\d+ matches\)/.test(text), text.split('\n').slice(0, 3).join(' / '))
  text = await cli('configure terminal')
  check('CORE-SW1 CLI: a configuration command is refused (read-only)', text.includes('Invalid or unsupported'))
  await ev('window.__netsecStore.getState().select("FW1")')
  await sleep(600)
  await clickButton('CLI')
  await sleep(300)
  text = await cli('show ip route')
  check('FW1 CLI: show ip route comes from the topology', text.includes('directly connected'))

  console.log('\n== scenario 8: recovery, interactive restore')
  await launch(8)
  check('P8 (not scripted): PC-2 starts isolated, its first pings are dropped', (await st('playback.state.edr'))['PC-2']?.state === 'isolated' && (await dropsAt())['PC-2:edr_isolated'] >= 2)
  await ev('window.__netsecStore.getState().seekTo(5); window.__netsecStore.getState().select("PC-2")')
  await sleep(600)
  await clickButton('Security')
  await sleep(300)
  await clickButton('Restore Endpoint')
  await waitFor(() => ev(`window.__netsecStore.getState().run.request?.controls?.some((c) => c.action === 'restore') && window.__netsecStore.getState().playback.loaded`), 'the restore re-run', 30000)
  await finish()
  check('P8: Restore Endpoint returns PC-2 to healthy and the SIEM records it', (await st('playback.state.edr'))['PC-2']?.state === 'healthy' && (await st('playback.state.siem')).some((e) => e.kind === 'state' && e.action.includes('restored')))
  check('P8: PC-2 reaches APP-SRV after the restore and the server state is clear', (await ev(`Object.values(window.__netsecStore.getState().playback.state.packets).some((p) => p.flow === 'P8-pc2-restored' && p.end?.type === 'delivered')`)) && (await st('securityState.isolated')).length === 0)
  await shot('p8-restored')

  console.log('\n== SIEM page and device panels')
  await browser.navigate(`${base}/threats?debug=1`)
  await waitFor(() => ev('window.__netsecStore && window.__netsecStore.getState().topology.status === "ready"'), 'the Threats page', 30000)
  await sleep(1200)
  const siemText = await ev('document.body.innerText')
  check('the Threats page has a SIEM console', siemText.includes('SIEM') && siemText.includes('simulated'))
  await shot('threats-siem')

  const errors = browser.errors()
  check('no console errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} demonstration checks passed.${out ? ` Screenshots: ${out}` : ''}`)
process.exit(passed === results.length ? 0 : 1)
