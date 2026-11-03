import { describe, expect, it } from 'vitest'

import { RING_STYLE, SHARD_POOL, SHARDS, hash01, labelOpacity, ringOpacity, shardOffset } from '../scene/effects/effectMath.js'
import { MAX_EFFECT_DURATION, activeEffects, buildEffects } from './effects.js'
import { Player } from './player.js'
import { EFFECT_TRACE_NAMES, loadTrace } from './testTraces.js'

const RING_POOL = 32 // keep in step with EffectsLayer
const SHATTER_POOL = SHARD_POOL / SHARDS

const kinds = (list, kind) => list.filter((e) => e.kind === kind)
const ofType = (events, type) => events.filter((e) => e.type === type)
const dataPids = (events) => new Set(ofType(events, 'packet.created').filter((e) => e.mirror_of == null).map((e) => e.pid))

describe('effects follow the trace', () => {
  const s2e = loadTrace('s2-enforce')
  const s2m = loadTrace('s2-monitor')
  const s1 = loadTrace('s1-monitor')
  const enforce = buildEffects(s2e.events)
  const monitor = buildEffects(s2m.events)

  it('draws one delivery pulse per delivered data packet and one mirror ghost per SPAN copy', () => {
    for (const trace of [s1, s2e, s2m]) {
      const list = buildEffects(trace.events)
      const data = dataPids(trace.events)
      const delivered = ofType(trace.events, 'packet.delivered').filter((e) => data.has(e.pid))
      expect(kinds(list, 'deliver').map((e) => e.pid).sort()).toEqual(delivered.map((e) => e.pid).sort())
      expect(kinds(list, 'mirror')).toHaveLength(ofType(trace.events, 'packet.mirrored').length)
      expect(kinds(list, 'mirror').every((e) => e.node === 'CORE-SW1' && e.tone === 'sensor')).toBe(true)
    }
  })

  it('S1 has no alerts, blocks or shatter, only normal delivery effects', () => {
    const list = buildEffects(s1.events)
    for (const kind of ['radar', 'sensor-alert', 'ips-block', 'ips-flag', 'unblock', 'shatter', 'fw-ripple', 'acl-flash']) {
      expect(kinds(list, kind), kind).toHaveLength(0)
    }
    expect(kinds(list, 'ips-allow').length).toBeGreaterThan(0)
  })

  it('draws the IDS radar pulse exactly at each IDS-1 alert, in the severity colour', () => {
    const alerts = ofType(s2e.events, 'alert.raised').filter((a) => a.sensor === 'IDS-1')
    const radar = kinds(enforce, 'radar')
    expect(radar.map((e) => [e.t0, e.node])).toEqual(alerts.map((a) => [a.t, 'IDS-1']))
    expect(radar.map((e) => e.tone)).toEqual(['warn', 'danger']) // MEDIUM then HIGH
    // IPS-1's own alerts are drawn at IPS-1, never as an IDS radar.
    expect(kinds(enforce, 'sensor-alert').every((e) => e.node === 'IPS-1')).toBe(true)
  })

  it('shows blocking only at IPS-1: one block ring, one unblock, a shatter per dropped packet', () => {
    const blocked = ofType(s2e.events, 'packet.dropped')
    expect(kinds(enforce, 'ips-block')).toHaveLength(1)
    expect(kinds(enforce, 'ips-block')[0].t0).toBe(ofType(s2e.events, 'block.added')[0].t)
    expect(kinds(enforce, 'unblock')).toHaveLength(1)
    expect(kinds(enforce, 'unblock')[0].t0).toBe(ofType(s2e.events, 'block.expired')[0].t)
    // Every drop shatters, except that bulk drops (block table, rate limiter) are sampled to one burst per 0.08 s.
    let last = -Infinity
    const expected = blocked.filter((e) => {
      if (e.reason !== 'blocked_source' && e.reason !== 'rate_limited') return true
      if (e.t - last < 0.08) return false
      last = e.t
      return true
    })
    expect(kinds(enforce, 'shatter').map((e) => e.pid).sort()).toEqual(expected.map((e) => e.pid).sort())
    expect(expected.length).toBeGreaterThanOrEqual(blocked.length - 5) // S2 loses a few shatters to sampling: its retries land on top of scan probes
    expect(kinds(enforce, 'shatter').every((e) => e.node === 'IPS-1')).toBe(true)
  })

  it('never anchors an enforcement effect to IDS-1', () => {
    for (const list of [enforce, monitor]) {
      const forbidden = list.filter((e) => ['ips-block', 'ips-allow', 'ips-flag', 'unblock', 'shatter', 'fw-ripple', 'acl-flash'].includes(e.kind))
      expect(forbidden.length).toBeGreaterThan(0)
      expect(forbidden.some((e) => e.node === 'IDS-1')).toBe(false)
    }
  })

  it('Monitor mode: no block, no shatter, and the amber flash is labelled "would block"', () => {
    expect(kinds(monitor, 'ips-block')).toHaveLength(0)
    expect(kinds(monitor, 'shatter')).toHaveLength(0)
    expect(kinds(monitor, 'unblock')).toHaveLength(0)
    const wouldBlock = kinds(monitor, 'ips-flag').filter((e) => e.label === 'would block')
    expect(wouldBlock.length).toBe(ofType(s2m.events, 'ips.action').length)
    expect(wouldBlock.every((e) => e.tone === 'warn')).toBe(true)
  })

  it('draws the firewall ripple and the ACL flash from policy denials, with the rule id', () => {
    const fw = buildEffects(loadTrace('fw-deny').events)
    expect(kinds(fw, 'fw-ripple').map((e) => [e.node, e.label])).toEqual([['FW1', 'OUTSIDE-IN:implicit-deny']])
    const acl = buildEffects(loadTrace('acl-deny').events)
    expect(kinds(acl, 'acl-flash').map((e) => [e.node, e.label])).toEqual([['CORE-SW1', 'STAFF-IN:10']])
    expect(kinds(acl, 'shatter')).toHaveLength(1)
    expect(EFFECT_TRACE_NAMES).toEqual(['fw-deny', 'acl-deny'])
  })

  it('gives every effect a unique, stable id and a known style', () => {
    for (const list of [enforce, monitor, buildEffects(s1.events)]) {
      expect(new Set(list.map((e) => e.id)).size).toBe(list.length)
      for (const e of list) if (e.kind !== 'shatter') expect(RING_STYLE[e.kind], e.kind).toBeDefined()
    }
    expect(buildEffects(s2e.events)).toEqual(enforce) // deterministic
  })
})

describe('activeEffects', () => {
  const trace = loadTrace('s2-enforce')
  const list = buildEffects(trace.events)

  it('is alive exactly between start and start + duration, with progress rising 0 to 1', () => {
    for (const e of list.slice(0, 80)) {
      const live = (t) => activeEffects(list, t).find((a) => a.effect.id === e.id)
      expect(live(e.t0)?.progress).toBe(0)
      expect(live(e.t0 + e.dur / 2)?.progress).toBeCloseTo(0.5, 6)
      expect(live(e.t0 + e.dur)).toBeUndefined()
      if (e.t0 > 0.01) expect(live(e.t0 - 0.01)).toBeUndefined()
    }
  })

  it('agrees with a brute-force scan at every sampled time', () => {
    for (let t = 0; t <= trace.duration; t += 0.07) {
      const fast = activeEffects(list, t).map((a) => a.effect.id).sort()
      const slow = list.filter((e) => e.t0 <= t && t < e.t0 + e.dur).map((e) => e.id).sort()
      expect(fast).toEqual(slow)
    }
  })

  it('never needs more effect slots than the renderer pools have', () => {
    for (const name of ['s1-monitor', 's2-monitor', 's2-enforce', 'fw-deny', 'acl-deny']) {
      const events = loadTrace(name).events
      const effects = buildEffects(events)
      let peakRings = 0
      let peakShatter = 0
      const end = events[events.length - 1].t
      for (let t = 0; t <= end; t += 0.05) {
        const live = activeEffects(effects, t)
        peakRings = Math.max(peakRings, live.filter((a) => a.effect.kind !== 'shatter').length)
        peakShatter = Math.max(peakShatter, live.filter((a) => a.effect.kind === 'shatter').length)
      }
      expect(peakRings, `${name} rings`).toBeLessThanOrEqual(RING_POOL)
      expect(peakShatter, `${name} shatters`).toBeLessThanOrEqual(SHATTER_POOL)
    }
  })

  it('looks back no further than the longest effect', () => {
    expect(MAX_EFFECT_DURATION).toBeGreaterThanOrEqual(Math.max(...list.map((e) => e.dur)))
    expect(activeEffects(list, 1000)).toEqual([])
    expect(activeEffects([], 3)).toEqual([])
  })
})

describe('effects stay in step with the player state (synchronisation)', () => {
  const trace = loadTrace('s2-enforce')
  const list = buildEffects(trace.events)

  it('an effect is only ever active when the event that causes it has been applied', () => {
    const player = new Player(trace.events)
    for (let t = 0; t <= trace.duration; t += 0.11) {
      player.seek(t)
      for (const { effect } of activeEffects(list, player.time)) {
        const packet = player.state.packets[effect.pid]
        if (effect.kind === 'shatter') expect(packet?.end?.type).toBe('dropped')
        if (effect.kind === 'deliver') expect(packet?.end?.type).toBe('delivered')
        if (effect.kind === 'radar') expect(player.state.alerts.some((a) => a.sensor === 'IDS-1' && a.t === effect.t0)).toBe(true)
        if (effect.kind === 'ips-block') expect(player.state.blocks['10.0.10.12']).toBeDefined()
        if (effect.kind === 'unblock') expect(player.state.blocks['10.0.10.12']).toBeUndefined()
      }
    }
  })

  it('shows the radar pulse at progress 0 on the same instant the alert counter increments', () => {
    const player = new Player(trace.events)
    const alerts = ofType(trace.events, 'alert.raised').filter((a) => a.sensor === 'IDS-1')
    for (const a of alerts) {
      player.seek(a.t - 0.001)
      const before = player.state.counts.alerts
      expect(activeEffects(list, player.time).some((x) => x.effect.kind === 'radar' && x.effect.t0 === a.t)).toBe(false)
      player.seek(a.t)
      expect(player.state.counts.alerts).toBeGreaterThan(before)
      expect(activeEffects(list, player.time).find((x) => x.effect.kind === 'radar' && x.effect.t0 === a.t)?.progress).toBe(0)
    }
  })

  it('shows the same effects at time t however the playhead got there', () => {
    const t = 5.3
    const direct = activeEffects(list, t).map((a) => a.effect.id)
    const player = new Player(trace.events)
    player.seek(trace.duration)
    player.seek(t) // backwards
    expect(activeEffects(list, player.time).map((a) => a.effect.id)).toEqual(direct)
    player.reset()
    player.play()
    for (let i = 0; i < 53; i += 1) player.advance(0.1) // forwards, in frames
    expect(player.time).toBeCloseTo(t, 6) // frame steps accumulate a rounding error, so compare at the player's own time
    const sameAsDirect = new Player(trace.events)
    sameAsDirect.seek(player.time)
    expect(player.state).toEqual(sameAsDirect.state)
    expect(activeEffects(list, player.time).map((a) => a.effect.id)).toEqual(activeEffects(list, sameAsDirect.time).map((a) => a.effect.id))
  })

  it('replaying after the end shows no leftover effects at T+0', () => {
    const player = new Player(trace.events)
    player.seek(trace.duration)
    player.reset()
    expect(activeEffects(list, player.time).every((a) => a.effect.t0 <= 0)).toBe(true)
    expect(player.state.alerts).toHaveLength(0)
  })
})

describe('effect curves', () => {
  it('ring opacity rises quickly and fades to zero', () => {
    expect(ringOpacity(0)).toBe(0)
    expect(ringOpacity(0.08)).toBeCloseTo((1 - 0.08) ** 1.6, 6)
    expect(ringOpacity(0.999)).toBeLessThan(0.01)
    expect(ringOpacity(0.5, 0.5)).toBeLessThan(ringOpacity(0.5, 1))
  })

  it('labels stay visible then fade out', () => {
    expect(labelOpacity(0)).toBe(1)
    expect(labelOpacity(0.5)).toBe(1)
    expect(labelOpacity(1)).toBe(0)
  })

  it('shard motion is deterministic, spreads out, falls and shrinks to nothing', () => {
    expect(hash01(7, 3)).toBe(hash01(7, 3))
    expect(hash01(7, 3)).not.toBe(hash01(7, 4))
    const a = shardOffset(12, 2, 0.6)
    expect(shardOffset(12, 2, 0.6)).toEqual(a)
    expect(shardOffset(12, 2, 1)[3]).toBe(0)
    const [dx, , dz] = shardOffset(12, 2, 0.5)
    expect(Math.hypot(dx, dz)).toBeGreaterThan(0.2)
    expect(shardOffset(12, 2, 0.95)[1]).toBeLessThan(shardOffset(12, 2, 0.2)[1])
  })
})
