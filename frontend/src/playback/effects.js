/**
 * Visual effects derived from the trace.
 *
 * Every effect is a pure function of the event list: `buildEffects(events)` turns the trace into a
 * list of timed effects once, and `activeEffects(list, t)` returns the ones alive at playhead time
 * `t`. Nothing is spawned or remembered while playing, so seeking, pausing, restarting and replaying
 * always show exactly the effects of time `t`, once each, and a stalled tab cannot lose or duplicate
 * one. The renderer only draws what this module says is active.
 *
 * Responsibilities stay as in the security design: only IPS-1 produces block effects; IDS-1 only
 * produces sensing effects (a radar pulse for its alerts, a quiet ping for each SPAN copy it receives).
 */

/**
 * @typedef {Object} Effect
 * @property {string} id        Stable: `<event seq>:<kind>`.
 * @property {string} kind      'deliver' | 'mirror' | 'radar' | 'sensor-ping' | 'sensor-alert' | 'ips-allow' | 'ips-flag'
 *                              | 'ips-block' | 'ips-reject' | 'ips-limit' | 'unblock' | 'fw-ripple' | 'acl-flash' | 'shatter'
 * @property {number} t0        Start time (s).
 * @property {number} dur       Duration (s).
 * @property {string} node      Device the effect is anchored to.
 * @property {'ok'|'warn'|'danger'|'sensor'|'info'} tone
 * @property {number|null} pid  Packet it belongs to (shatter uses the packet's last position).
 * @property {string|null} label  Short text shown with the effect, where it helps.
 */

export const EFFECT_DURATION = Object.freeze({
  deliver: 0.9,
  mirror: 0.55,
  radar: 1.6,
  'sensor-ping': 0.5,
  'sensor-alert': 0.9,
  'ips-allow': 0.5,
  'ips-flag': 0.8,
  'ips-block': 0.9,
  'ips-reject': 1.0,
  'ips-limit': 0.7,
  unblock: 1.0,
  'fw-ripple': 1.1,
  'acl-flash': 0.7,
  shatter: 0.8,
})

/** The longest an effect lives; bounds the lookback in `activeEffects`. */
export const MAX_EFFECT_DURATION = Math.max(...Object.values(EFFECT_DURATION))

const SEVERITY_TONE = { low: 'info', medium: 'warn', high: 'danger' }

/**
 * Visual sampling. In a flood, hundreds of packets a second would each want a ring or a burst of shards, more
 * than the fixed pools hold and more than anyone can read. For the busy kinds, at most this many effects of a
 * kind may be alive at once (later ones are skipped), and a drop by a rate limiter or a block table gets a
 * burst of shards at most this often. Quiet traces (S1 to S3, S7) never reach these limits, and every
 * packet is still counted, listed and inspectable: only the extra decoration is thinned.
 */
const ALIVE_CAP = Object.freeze({ deliver: 12, mirror: 12, 'ips-allow': 10, 'ips-flag': 10, 'ips-limit': 6, 'sensor-ping': 4 })
const BULK_SHATTER_SPACING = 0.08
const BULK_DROP_REASONS = new Set(['rate_limited', 'blocked_source'])

/** Quiet per-copy pings at IDS-1 are limited to one per this many seconds so a scan does not strobe. */
const PING_SPACING = 0.5

/**
 * @param {any[]} events  A complete trace.
 * @returns {Effect[]} Sorted by start time.
 */
export function buildEffects(events) {
  /** @type {Effect[]} */
  const out = []
  const mirrorPids = new Set()
  const flagged = new Set()
  /** The 'ips-flag' effect of each packet, so a later 'would block' decision can relabel it. */
  const flagEffects = new Map()
  let lastPing = -Infinity

  const alive = {}
  let lastBulkShatter = -Infinity
  /** Add an effect unless the busy-kind cap says it would only add clutter. Returns it, or null when skipped. */
  const add = (e, kind, node, tone, pid = null, label = null) => {
    const cap = ALIVE_CAP[kind]
    if (cap !== undefined) {
      const queue = (alive[kind] ??= [])
      while (queue.length > 0 && queue[0] <= e.t - EFFECT_DURATION[kind]) queue.shift()
      if (queue.length >= cap) return null
      queue.push(e.t)
    }
    const effect = { id: `${e.seq}:${kind}`, kind, t0: e.t, dur: EFFECT_DURATION[kind], node, tone, pid, label }
    out.push(effect)
    return effect
  }

  for (const e of events) {
    switch (e.type) {
      case 'packet.created':
        if (e.mirror_of != null) mirrorPids.add(e.pid)
        break

      case 'packet.mirrored':
        add(e, 'mirror', e.at, 'sensor', e.copy_pid)
        break

      case 'policy.decision':
        if (e.action === 'deny') {
          if (e.node === 'FW1') add(e, 'fw-ripple', e.node, 'danger', e.pid, e.rule_id)
          else add(e, 'acl-flash', e.node, 'danger', e.pid, e.rule_id)
        }
        break

      case 'inspect.result':
        if (e.node === 'IPS-1' && !mirrorPids.has(e.pid)) {
          if (e.classification === 'normal') add(e, 'ips-allow', e.node, 'ok', e.pid)
          else {
            flagged.add(e.pid)
            const effect = add(e, 'ips-flag', e.node, 'warn', e.pid, e.rules.join(', '))
            if (effect) flagEffects.set(e.pid, effect)
          }
        }
        break

      case 'ips.action':
        if (e.action === 'allow') break
        if (!e.applied) {
          // Monitor mode: the same amber flash, relabelled so it reads as "would block".
          const existing = flagEffects.get(e.pid)
          const label = e.action === 'block_source' ? 'would block' : e.action === 'rate_limit' ? 'would rate-limit' : `would ${e.action}`
          if (existing) existing.label = label
          else add(e, 'ips-flag', 'IPS-1', 'warn', e.pid, label)
        } else if (e.action === 'rate_limit') {
          // One ring per burst of limited packets, not one per packet; the drops themselves are counted and listed.
          add(e, 'ips-limit', 'IPS-1', 'warn', e.pid, `rate limit · ${e.rule}`)
        } else if (e.action === 'reject') {
          // The rejected packet shatters (from packet.dropped) and IPS-1 sends the reset back (a packet of its own).
          add(e, 'ips-reject', 'IPS-1', 'danger', e.pid, `reject ${e.rule} · TCP reset`)
        } else if (e.action !== 'block_source') {
          // Blocking a source is drawn once, by `block.added`; each later drop is drawn by its shatter.
          add(e, 'ips-block', 'IPS-1', 'danger', e.pid, e.action)
        }
        break

      case 'alert.raised':
        if (e.sensor === 'IDS-1') add(e, 'radar', 'IDS-1', SEVERITY_TONE[e.severity] ?? 'warn', null, `${e.rule} ${e.severity.toUpperCase()}`)
        else add(e, 'sensor-alert', e.sensor, SEVERITY_TONE[e.severity] ?? 'warn', null, `${e.rule} ${e.severity.toUpperCase()}`)
        break

      case 'block.added':
        add(e, 'ips-block', 'IPS-1', 'danger', null, `blocked ${e.src}`)
        break

      case 'block.expired':
        add(e, 'unblock', 'IPS-1', 'ok', null, `unblocked ${e.src}`)
        break

      case 'packet.delivered':
        if (mirrorPids.has(e.pid)) {
          if (e.t - lastPing >= PING_SPACING) {
            lastPing = e.t
            add(e, 'sensor-ping', e.node, 'sensor', e.pid)
          }
        } else add(e, 'deliver', e.node, flagged.has(e.pid) ? 'warn' : 'ok', e.pid)
        break

      case 'packet.dropped':
        if (mirrorPids.has(e.pid)) break
        if (BULK_DROP_REASONS.has(e.reason)) {
          if (e.t - lastBulkShatter < BULK_SHATTER_SPACING) break
          lastBulkShatter = e.t
        }
        add(e, 'shatter', e.node, 'danger', e.pid, e.reason)
        break

      default:
        break
    }
  }
  return out // events are already ordered by (t, seq), so effects are too
}

/**
 * Effects alive at time `t`, with progress 0..1.
 * @param {Effect[]} effects  From `buildEffects`.
 * @param {number} t
 * @returns {{effect: Effect, progress: number}[]}
 */
export function activeEffects(effects, t) {
  // Binary search the first effect that could still be alive.
  let lo = 0
  let hi = effects.length
  const earliest = t - MAX_EFFECT_DURATION
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (effects[mid].t0 < earliest) lo = mid + 1
    else hi = mid
  }
  const live = []
  for (let i = lo; i < effects.length && effects[i].t0 <= t; i += 1) {
    const effect = effects[i]
    // Compare absolute times, not the progress ratio, which can round up to 1 a hair early.
    if (t < effect.t0 + effect.dur) live.push({ effect, progress: Math.min((t - effect.t0) / effect.dur, 1) })
  }
  return live
}

const cache = new WeakMap()

/**
 * `buildEffects` memoised per event list, so the frame loop never rebuilds it.
 * @param {any[]} events
 */
export function effectsFor(events) {
  let list = cache.get(events)
  if (!list) {
    list = buildEffects(events)
    cache.set(events, list)
  }
  return list
}
