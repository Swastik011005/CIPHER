/**
 * Measure the 3D scene's frame rate in a normal browser window (Chrome or Edge), through the DevTools protocol.
 *
 *   node scripts/measure_fps.mjs --scenario S2 --mode enforce --start 3 --seconds 10 --quality high
 *
 * Needs the backend (127.0.0.1:8000) and the Vite dev server (localhost:5173) to be running. It opens a visible
 * browser window with a throw-away profile, runs the scenario through the app's own store, lets the playback run at
 * 1x from `--start`, counts animation frames for `--seconds`, then reports the GPU the browser actually used
 * (the WebGL renderer string), the window size, draw calls and triangles, and the measured frame rate.
 * It never changes any system or graphics setting: it reports what the browser got.
 *
 * Output is one JSON object on stdout. Do not read a result as a pass unless `gpu` is the GPU you meant to test.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const cfg = {
  scenario: args.scenario ?? 'S2',
  mode: args.mode ?? 'enforce',
  start: Number(args.start ?? 3),
  seconds: Number(args.seconds ?? 10),
  quality: args.quality ?? 'high',
  browser: args.browser ?? 'chrome',
  width: Number(args.width ?? 1920),
  height: Number(args.height ?? 1080),
  url: args.url ?? 'http://localhost:5173/simulation?debug=1',
  port: Number(args.port ?? 9333),
  gpu: args.gpu ?? '', // optional Chrome switch value for --use-angle (for example d3d11); empty = browser default
}

const BROWSERS = {
  chrome: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
  edge: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
}
const exe = BROWSERS[cfg.browser]?.find((p) => existsSync(p))
if (!exe) {
  console.error(JSON.stringify({ error: `no ${cfg.browser} installation found` }))
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'netsec-fps-'))
const flags = [
  `--remote-debugging-port=${cfg.port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${cfg.width},${cfg.height}`,
  '--window-position=0,0',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  ...(cfg.gpu ? [`--use-angle=${cfg.gpu}`] : []),
  'about:blank',
]
const child = spawn(exe, flags, { stdio: 'ignore', detached: false })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, what, ms = 20000) {
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

let ws
let nextId = 1
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}

const MEASURE = `(async (cfg) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const store = window.__netsecStore
  if (!store) throw new Error('open the page with ?debug=1 so the app exposes its store')
  const st = () => store.getState()
  const c = document.createElement('canvas')
  const gl = c.getContext('webgl2')
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  store.setState({ autoLowered: true }) // measure the preset that was asked for: no automatic switch to Low
  st().setSetting('quality', cfg.quality)
  await st().runScenario(cfg.scenario, cfg.mode)
  if (st().playback.playing) st().togglePlay()
  st().seekTo(cfg.start)
  st().setSpeed(1)
  if (!st().playback.playing) st().togglePlay()
  await sleep(2500) // warm up: shaders, first packets, adaptive pixel ratio
  const gaps = []
  let last = performance.now()
  let stop = false
  const tick = (now) => { gaps.push(now - last); last = now; if (!stop) requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const t0 = st().playback.time
  const w0 = performance.now()
  await sleep(cfg.seconds * 1000)
  stop = true
  const wall = (performance.now() - w0) / 1000
  const t1 = st().playback.time
  gaps.shift()
  const sorted = [...gaps].sort((a, b) => a - b)
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const p99 = sorted[Math.floor(sorted.length * 0.99)]
  const scene = window.__netsecScene || null
  return {
    gpu: renderer,
    window: { innerWidth, innerHeight, devicePixelRatio, visibility: document.visibilityState, focused: document.hasFocus() },
    quality: st().settings.quality,
    scenario: cfg.scenario, ipsMode: st().run.meta && st().run.meta.ips_mode, traceHash: st().run.meta && st().run.meta.trace_hash.slice(0, 8),
    simTimeAdvanced: +(t1 - t0).toFixed(2), wallSeconds: +wall.toFixed(2),
    frames: gaps.length, fps: +(1000 / avgGap).toFixed(1), worst1PercentFrameMs: +p99.toFixed(1), maxFrameMs: +sorted.at(-1).toFixed(1),
    drawCalls: scene && scene.meshes, triangles: scene && scene.triangles, pixelRatio: scene && scene.pixelRatio, sceneFpsCounter: scene && scene.fps,
    packetsOnScreen: Object.keys(window.__netsecPackets || {}).length,
    playbackAtEnd: { playing: st().playback.playing, time: st().playback.time, finished: st().playback.finished, speed: st().playback.speed, t0 },
  }
})(${JSON.stringify(cfg)})`

let exitCode = 0
try {
  const targets = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${cfg.port}/json/list`)).json()
    return list.find((t) => t.type === 'page') ? list : null
  }, 'the browser to open')
  const page = targets.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('cannot connect to the browser'))
  })
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    const p = msg.id && pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
    }
  }
  await send('Page.enable')
  await send('Page.bringToFront')
  await send('Page.navigate', { url: cfg.url })
  await waitFor(() => evaluate('document.readyState === "complete" && !!document.querySelector("canvas") ').catch(() => false), 'the 3D canvas', 40000)
  await sleep(1500)
  const result = await evaluate(MEASURE)
  console.log(JSON.stringify({ browser: cfg.browser, ...result }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ error: String(error.message ?? error) }))
  exitCode = 1
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  child.kill()
  await sleep(500)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* the browser may still hold the profile; the OS temp cleaner will remove it */
  }
  process.exit(exitCode)
}
