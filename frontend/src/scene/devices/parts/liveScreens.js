import * as THREE from 'three'

/**
 * Live monitoring screens for the security operations centre: four canvases (SIEM events, network counters, endpoint status, run
 * status) drawn from the reducer state of the loaded run, which is folded from the backend's trace. Nothing here decides anything: it
 * only prints what the engine, the SIEM and the EDR agents already reported up to the playhead. With no run loaded the screens say so.
 *
 * One shared material per screen. The canvases are redrawn by `updateLiveScreens` (about twice a second, and only when the state
 * changed), so the cost is a few small 2D draws, not a render pass.
 */
const W = 512
const H = 320
const KINDS = ['live-alerts', 'live-stats', 'live-endpoints', 'live-traffic']

const BG = '#0a1a35'
const BAR = '#12305c'
const TEXT = '#8fb4e6'
const DIM = '#4f6f9f'
const OK = '#58d6a8'
const WARN = '#e0a84a'
const BAD = '#e05c6a'
const INFO = '#4aa8e8'
const ISOLATED = '#b48cff'

const ENDPOINTS = ['PC-1', 'PC-2', 'PC-3', 'PC-4', 'PC-5', 'PC-6', 'PC-7', 'LAPTOP-1', 'ADMIN-PC', 'ADMIN-PC-2', 'ADMIN-PC-3', 'ADMIN-PC-4']
const SEVERITY_COLOUR = { high: BAD, medium: WARN, low: INFO }

const entries = new Map()

function entry(kind) {
  if (!entries.has(kind)) {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const material = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(0.85, 0.85, 0.85), toneMapped: false })
    entries.set(kind, { canvas, ctx: canvas.getContext('2d'), texture, material })
    draw(kind, null, 0)
  }
  return entries.get(kind)
}

/** Shared unlit material of a live screen (one of the four kinds). */
export function liveScreenMaterial(kind) {
  if (!KINDS.includes(kind)) throw new Error(`unknown live screen ${kind}`)
  return entry(kind).material
}

export const LIVE_SCREEN_KINDS = Object.freeze([...KINDS])

function header(ctx, title, right = '') {
  ctx.fillStyle = BAR
  ctx.fillRect(0, 0, W, 38)
  ctx.fillStyle = TEXT
  ctx.font = 'bold 22px Consolas, monospace'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, 14, 20)
  if (right) {
    ctx.textAlign = 'right'
    ctx.fillStyle = DIM
    ctx.fillText(right, W - 14, 20)
    ctx.textAlign = 'left'
  }
}

const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

function waiting(ctx, title) {
  header(ctx, title)
  ctx.fillStyle = DIM
  ctx.font = '20px Consolas, monospace'
  ctx.fillText('No run loaded.', 14, 90)
  ctx.fillText('Start a scenario to see live data.', 14, 120)
}

function drawAlerts(ctx, state, time) {
  header(ctx, 'SIEM EVENTS', state ? `T+${time.toFixed(1)}s` : '')
  if (!state?.meta) return waiting(ctx, 'SIEM EVENTS')
  const events = state.siem.slice(-8).reverse()
  if (events.length === 0) {
    ctx.fillStyle = OK
    ctx.beginPath()
    ctx.arc(24, 76, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = TEXT
    ctx.font = '22px Consolas, monospace'
    ctx.fillText('No events: all quiet', 42, 78)
    return undefined
  }
  ctx.font = '19px Consolas, monospace'
  events.forEach((e, i) => {
    const y = 62 + i * 31
    ctx.fillStyle = SEVERITY_COLOUR[e.severity] ?? INFO
    ctx.fillRect(12, y - 8, 10, 16)
    ctx.fillStyle = DIM
    ctx.fillText(`${e.t.toFixed(1).padStart(5)}s`, 30, y)
    ctx.fillStyle = TEXT
    ctx.fillText(clip(`${e.source} ${e.kind}`, 34), 112, y)
    ctx.fillStyle = DIM
    ctx.textAlign = 'right'
    ctx.fillText(clip(e.node ?? '', 10), W - 12, y)
    ctx.textAlign = 'left'
  })
  return undefined
}

function drawStats(ctx, state, time) {
  header(ctx, 'NETWORK MONITOR', state?.meta ? `T+${time.toFixed(1)}s` : '')
  if (!state?.meta) return waiting(ctx, 'NETWORK MONITOR')
  const c = state.counts
  const tiles = [
    ['PACKETS', c.data_packets, INFO],
    ['CLEAN', c.delivered_clean, OK],
    ['FLAGGED', c.delivered_flagged, WARN],
    ['BLOCKED', c.blocked, BAD],
    ['ALERTS', c.alerts, WARN],
    ['INCIDENTS', c.incidents, ISOLATED],
  ]
  tiles.forEach(([label, value, colour], i) => {
    const x = 14 + (i % 3) * 164
    const y = 54 + Math.floor(i / 3) * 96
    ctx.fillStyle = BAR
    ctx.fillRect(x, y, 152, 84)
    ctx.fillStyle = DIM
    ctx.font = '17px Consolas, monospace'
    ctx.fillText(label, x + 10, y + 20)
    ctx.fillStyle = colour
    ctx.font = 'bold 40px Consolas, monospace'
    ctx.fillText(String(value), x + 10, y + 56)
  })
  const total = Math.max(1, c.delivered_clean + c.delivered_flagged + c.blocked + c.other_drop)
  let x = 14
  ctx.fillRect(14, 258, 484, 0)
  for (const [value, colour] of [[c.delivered_clean, OK], [c.delivered_flagged, WARN], [c.blocked, BAD], [c.other_drop, DIM]]) {
    const w = (value / total) * 484
    ctx.fillStyle = colour
    ctx.fillRect(x, 262, w, 22)
    x += w
  }
  ctx.fillStyle = DIM
  ctx.font = '16px Consolas, monospace'
  ctx.fillText('share of data packets: clean / flagged / blocked / other', 14, 304)
  return undefined
}

function drawEndpoints(ctx, state) {
  header(ctx, 'ENDPOINTS (EDR)', state?.meta ? `${Object.keys(state.edr).length} reporting` : '')
  if (!state?.meta) return waiting(ctx, 'ENDPOINTS (EDR)')
  ctx.font = '21px Consolas, monospace'
  ENDPOINTS.forEach((id, i) => {
    const x = 16 + (i % 2) * 248
    const y = 66 + Math.floor(i / 2) * 40
    const s = state.edr[id]?.state ?? 'healthy'
    ctx.fillStyle = s === 'healthy' ? OK : s === 'isolated' ? ISOLATED : BAD
    ctx.beginPath()
    ctx.arc(x + 8, y, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = TEXT
    ctx.fillText(id, x + 26, y + 1)
    ctx.fillStyle = DIM
    ctx.textAlign = 'right'
    ctx.fillText(s === 'healthy' ? 'ok' : s, x + 232, y + 1)
    ctx.textAlign = 'left'
  })
  return undefined
}

function drawTraffic(ctx, state, time) {
  header(ctx, 'RUN STATUS')
  if (!state?.meta) return waiting(ctx, 'RUN STATUS')
  const m = state.meta
  const rows = [
    ['Scenario', m.scenario_id],
    ['IPS mode', m.ips_mode],
    ['Time', `T+${time.toFixed(1)} s of ${Number(m.duration).toFixed(0)} s`],
    ['Active blocks', String(Object.keys(state.blocks ?? {}).length)],
    ['Zero Trust', `${state.zt.length} decision${state.zt.length === 1 ? '' : 's'}`],
    ['Mirrored copies', String(state.counts.mirrored)],
    ['Syslog / mgmt', String(state.counts.management)],
  ]
  ctx.font = '22px Consolas, monospace'
  rows.forEach(([k, v], i) => {
    const y = 66 + i * 34
    ctx.fillStyle = DIM
    ctx.fillText(k, 16, y)
    ctx.fillStyle = TEXT
    ctx.textAlign = 'right'
    ctx.fillText(clip(String(v), 26), W - 16, y)
    ctx.textAlign = 'left'
  })
  const frac = Math.min(1, Math.max(0, m.duration ? time / m.duration : 0))
  ctx.fillStyle = BAR
  ctx.fillRect(16, 296, 480, 12)
  ctx.fillStyle = INFO
  ctx.fillRect(16, 296, 480 * frac, 12)
  return undefined
}

const DRAWERS = { 'live-alerts': drawAlerts, 'live-stats': drawStats, 'live-endpoints': drawEndpoints, 'live-traffic': drawTraffic }

function draw(kind, state, time) {
  const e = entries.get(kind)
  const { ctx } = e
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  DRAWERS[kind](ctx, state, time)
  e.texture.needsUpdate = true
}

/**
 * Redraw the four screens from the playback state.
 * @param {any} state  The reducer state at the playhead (or null).
 * @param {number} time  The playhead, in simulated seconds.
 */
export function updateLiveScreens(state, time) {
  for (const kind of KINDS) {
    entry(kind)
    draw(kind, state, time)
  }
}
