/**
 * Offline and recovery check for demo mode, in a real Chrome window.
 *
 *   node scripts/check_offline_recovery.mjs [--port 8100]
 *
 * Starts its own backend (it serves the built frontend, one process) on a spare port, opens the app, plays a scenario,
 * then kills the backend while the page is open and checks that the page says so and keeps what it already has;
 * restarts the backend and checks that the page recovers by itself and can run again. It also checks that the page
 * makes no request outside 127.0.0.1 (nothing needs the internet). Needs `npm run build` to have been run.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openBrowser, sleep, waitFor } from './lib/cdp.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const port = Number(args.port ?? 8100)
const root = resolve(fileURLToPath(import.meta.url), '..', '..')
const python = join(root, 'backend', '.venv', 'Scripts', 'python.exe')
if (!existsSync(python) || !existsSync(join(root, 'frontend', 'dist', 'index.html'))) {
  console.error('Needs backend\\.venv and frontend\\dist: run scripts\\setup.cmd first.')
  process.exit(2)
}

const steps = []
const check = (name, ok, detail = '') => {
  steps.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

let backend = null
const startBackend = async () => {
  backend = spawn(python, ['app.py'], { cwd: join(root, 'backend'), env: { ...process.env, NETSEC_PORT: String(port) }, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok, 'the backend to start', 30000)
}
const stopBackend = async () => {
  if (!backend) return
  const pid = backend.pid
  backend = null
  await new Promise((done) => spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' }).on('exit', done))
  await sleep(500)
}

// The port must be free: a backend left over from an earlier run would answer instead of ours and spoil the test.
const alreadyUp = await fetch(`http://127.0.0.1:${port}/api/health`).then(() => true, () => false)
if (alreadyUp) {
  console.error(`Something is already listening on port ${port}. Stop it or pass --port with a free port.`)
  process.exit(2)
}
await startBackend()
const browser = await openBrowser({ width: 1440, height: 900, port: 9999 })
const ev = (code) => browser.evaluate(code)
const text = () => ev('document.body.innerText')
const waitText = (needle, ms = 20000) => waitFor(async () => (await text()).includes(needle), `text "${needle}"`, ms)
try {
  await browser.setViewport(1440, 900)
  await browser.navigate(`http://127.0.0.1:${port}/simulation?debug=1`)
  await waitText('Engine online')
  check('the built frontend is served by the backend alone (demo mode) and shows the engine online', true)

  await ev(`window.__netsecStore.getState().runScenario('S2', 'enforce')`)
  await waitFor(() => ev(`window.__netsecStore.getState().run.status === 'ready'`), 'S2 to load')
  await ev(`(() => { const s = window.__netsecStore.getState(); if (s.playback.playing) s.togglePlay(); s.seekTo(10) })()`)
  const before = await ev(`JSON.stringify(window.__netsecStore.getState().playback.state.counts)`)

  await stopBackend()
  await waitText('Engine offline', 15000)
  check('stopping the backend shows "Engine offline" within 15 s', true)
  const during = await ev(`JSON.stringify(window.__netsecStore.getState().playback.state && window.__netsecStore.getState().playback.state.counts)`)
  check('the page keeps the loaded run and its counters while offline', during === before, `before=${before} during=${during}`)
  await ev(`window.__netsecStore.getState().seekTo(5)`)
  const scrubbed = await ev(`window.__netsecStore.getState().playback.time`)
  check('scrubbing the loaded run still works offline (the trace is already in the browser)', scrubbed === 5, `time=${scrubbed}`)
  const runDisabled = await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run')?.disabled`)
  check('the Run button is disabled while the engine is offline', runDisabled === true, `disabled=${runDisabled}`)
  await browser.screenshot(join(root, 'docs', 'demo', '14-engine-offline.png'))

  await startBackend()
  await waitFor(async () => !(await text()).includes('Engine offline'), 'the page to notice the engine is back', 20000)
  check('restarting the backend is noticed by the page without a reload', true)
  await waitFor(() => ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run')?.disabled === false`), 'Run to be enabled', 10000)
  await ev(`window.__netsecStore.getState().runScenario('S1', 'monitor')`)
  await waitFor(() => ev(`window.__netsecStore.getState().run.status === 'ready' && window.__netsecStore.getState().run.meta.scenario_id === 'S1'`), 'S1 to run after recovery', 20000)
  check('a new run works after recovery', true)
  await browser.screenshot(join(root, 'docs', 'demo', '15-engine-recovered.png'))

  const external = [...new Set(browser.requests().map((u) => new URL(u).hostname))].filter((h) => !['127.0.0.1', 'localhost', ''].includes(h))
  check('no request left 127.0.0.1 (nothing needs the internet)', external.length === 0, external.join(', '))
} catch (error) {
  check('script ran to the end', false, String(error.message ?? error))
} finally {
  await browser.close()
  await stopBackend()
  const failed = steps.filter((s) => !s.ok)
  console.log(`\n${steps.length - failed.length} of ${steps.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}
