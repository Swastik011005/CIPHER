/**
 * A small helper to drive a normal Chrome or Edge window through the DevTools protocol.
 * Used by the screenshot, layout and memory scripts. It opens a visible window with a throw-away
 * profile and never changes any system setting.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findBrowser } from './browsers.mjs'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* not ready yet */
    }
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * @param {{browser?: string, width?: number, height?: number, port?: number, extraFlags?: string[]}} options
 */
export async function openBrowser({ browser = 'chrome', width = 1920, height = 1080, port = 9555, extraFlags = [] } = {}) {
  const exe = findBrowser(browser)
  if (!exe) throw new Error(`no ${browser} installation found (set NETSEC_BROWSER_PATH to its executable)`)
  const profile = mkdtempSync(join(tmpdir(), 'netsec-cdp-'))
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--window-position=0,0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      ...extraFlags,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const targets = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    return list.find((t) => t.type === 'page') ? list : null
  }, 'the browser to open')
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('cannot connect to the browser'))
  })
  let nextId = 1
  const pending = new Map()
  const events = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
    } else if (msg.method) events.push(msg)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('Page.bringToFront')

  const api = {
    send,
    /** URLs of every network request the page has made so far. */
    requests: () => events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url),
    /** Console errors and uncaught exceptions seen so far. */
    errors: () =>
      events
        .filter((e) => (e.method === 'Runtime.exceptionThrown') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
        .map((e) => e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a) => a.value ?? a.description).join(' ') ?? e.params.entry?.text),
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    },
    async navigate(url) {
      await send('Page.navigate', { url })
      await waitFor(() => api.evaluate('document.readyState === "complete"'), 'the page to load', 40000)
    },
    /** Set the viewport (CSS px) exactly, whatever the window chrome takes. */
    async setViewport(w, h) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    },
    async screenshot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(path, Buffer.from(data, 'base64'))
      return path
    },
    async close() {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      child.kill()
      await sleep(500)
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        /* temp cleaner will remove it */
      }
    },
  }
  return api
}
