import { describe, expect, it } from 'vitest'

import { PACKET_CAPACITY } from '../scene/packets/capacity.js'
import { SHARDS, SHARD_POOL } from '../scene/effects/effectMath.js'
import { SLOW_SAMPLES, shouldLowerQuality } from '../scene/quality.js'
import { useStore } from '../state/store.js'
import { deviceTags } from './deviceStatus.js'
import { activeEffects, buildEffects } from './effects.js'
import { deviceInspector, packetInspector } from './inspectors.js'
import { markersFor } from './markers.js'
import { Player, stateAt } from './player.js'
import { loadTrace } from './testTraces.js'

const RING_POOL = 64 // keep in step with EffectsLayer
const ALL = ['s1-monitor', 's2-monitor', 's2-enforce', 's3-monitor', 's3-enforce', 's4-monitor', 's4-enforce', 's7-enforce']
const s4e = loadTrace('s4-enforce')
const s4m = loadTrace('s4-monitor')
const s7 = loadTrace('s7-enforce')
const END = Infinity
const kinds = (list, kind) => list.filter((e) => e.kind === kind)
const ofType = (events, type) => events.filter((e) => e.type === type)

describe('the new traces reconstruct to the engine statistics', () => {
  it.each(ALL)('%s: reducer counters equal run.end and the engine summary', (name) => {
    const trace = loadTrace(name)
    const state = stateAt(trace.events, END)
    expect(state.counts).toEqual(state.finalStats)
    expect(state.counts).toEqual(trace.summary)
  })

  it('S4 Enforce: drops by reason match the trace and everything blocked is IPS-1 rate limit, drop or block table', () => {
    const state = stateAt(s4e.events, END)
    const count = (r) => ofType(s4e.events, 'packet.dropped').filter((e) => e.reason === r).length
    expect(state.drops).toEqual({ rate_limited: count('rate_limited'), ips_drop: 1, blocked_source: count('blocked_source') })
    expect(state.counts.blocked).toBe(305)
    expect(state.nodes['IPS-1']).toMatchObject({ dropped: 305, limited: count('rate_limited') })
  })
})

describe('S4 effects and visual sampling', () => {
  const enforce = buildEffects(s4e.events)
  const monitor = buildEffects(s4m.events)

  it('draws the radar pulse at each IDS-1 alert (MEDIUM then HIGH) and nothing blocks at IDS-1', () => {
    expect(kinds(enforce, 'radar').map((e) => [e.node, e.tone, e.label])).toEqual([['IDS-1', 'warn', 'D3 MEDIUM'], ['IDS-1', 'danger', 'D3 HIGH']])
    for (const list of [enforce, monitor]) {
      expect(list.filter((e) => ['ips-block', 'ips-reject', 'ips-limit', 'shatter', 'unblock', 'ips-allow'].includes(e.kind) && e.node === 'IDS-1')).toEqual([])
    }
  })

  it('Enforce draws a rate-limit ring (labelled with the rule) and one block ring, then the unblock', () => {
    const limit = kinds(enforce, 'ips-limit')
    expect(limit.length).toBeGreaterThan(2)
    expect(limit.every((e) => e.node === 'IPS-1' && e.tone === 'warn' && e.label === 'rate limit · D3')).toBe(true)
    expect(kinds(enforce, 'ips-block')).toHaveLength(1)
    expect(kinds(enforce, 'unblock')).toHaveLength(1)
    const added = ofType(s4e.events, 'block.added')[0]
    expect(limit.every((e) => e.t0 <= added.t)).toBe(true) // limiting comes before the block
    expect(kinds(enforce, 'ips-block')[0].t0).toBe(added.t)
  })

  it('Monitor draws no rate-limit ring or shatter; the amber flashes say what IPS-1 would do', () => {
    expect(kinds(monitor, 'ips-limit')).toHaveLength(0)
    expect(kinds(monitor, 'shatter')).toHaveLength(0)
    const labels = new Set(kinds(monitor, 'ips-flag').map((e) => e.label))
    expect([...labels].every((l) => ['D3', 'would rate-limit', 'would block'].includes(l))).toBe(true)
    expect(labels.has('would rate-limit') || labels.has('would block')).toBe(true)
  })

  it('never needs more slots than the renderer pools have, even at 70 packets a second', () => {
    for (const trace of [s4e, s4m, s7]) {
      const effects = buildEffects(trace.events)
      let peakRings = 0
      let peakShatter = 0
      for (let t = 0; t <= trace.duration; t += 0.05) {
        const live = activeEffects(effects, t)
        peakRings = Math.max(peakRings, live.filter((a) => a.effect.kind !== 'shatter').length)
        peakShatter = Math.max(peakShatter, live.filter((a) => a.effect.kind === 'shatter').length)
      }
      expect(peakRings).toBeLessThanOrEqual(RING_POOL)
      expect(peakShatter).toBeLessThanOrEqual(SHARD_POOL / SHARDS)
    }
  })

  it('thins only bulk decoration: every alert, block and delivery of a quiet period still has its effect', () => {
    expect(kinds(enforce, 'sensor-alert')).toHaveLength(2) // IPS-1's MEDIUM and HIGH
    // The ordinary user's packets are sparse, so none of them is ever thinned out, even while the flood runs.
    const packets = stateAt(s4e.events, END).packets
    const user = ofType(s4e.events, 'packet.delivered').filter((e) => packets[e.pid].mirrorOf == null && (packets[e.pid].src === '203.0.113.25' || packets[e.pid].dst === '203.0.113.25'))
    expect(user).toHaveLength(24)
    const delivered = new Set(kinds(enforce, 'deliver').map((e) => e.pid))
    const missing = user.filter((e) => !delivered.has(e.pid))
    expect(missing.length).toBeLessThanOrEqual(6) // only user packets that land in the middle of the flood's own deliveries lose their pulse
    expect(user.filter((e) => e.t < 8 || e.t > 38).every((e) => delivered.has(e.pid))).toBe(true)
  })

  it('sampling is deterministic, and seeking anywhere gives the same effects as playing there', () => {
    expect(buildEffects(s4e.events)).toEqual(enforce)
    const player = new Player(s4e.events)
    for (const t of [11.5, 3, 30, 12.2, 12.2]) {
      player.seek(t)
      const fresh = new Player(s4e.events)
      fresh.seek(t)
      expect(player.state).toEqual(fresh.state)
      expect(activeEffects(enforce, player.time).map((a) => a.effect.id)).toEqual(activeEffects(enforce, fresh.time).map((a) => a.effect.id))
    }
  })
})

describe('the 3D layer can hold the busiest trace', () => {
  it('has fewer packets in flight at any moment than one instanced mesh can draw', () => {
    for (const trace of [s4m, s4e]) {
      const player = new Player(trace.events)
      let peak = 0
      for (let t = 0; t <= trace.duration; t += 0.25) {
        player.seek(t)
        const inFlight = Object.values(player.state.packets).filter((p) => p.hops.length > 0 && !p.end && p.proto === 'tcp').length
        peak = Math.max(peak, inFlight)
      }
      expect(peak).toBeGreaterThan(50)
      expect(peak).toBeLessThan(PACKET_CAPACITY)
    }
  })
})

describe('S4 inspectors, indicators and markers', () => {
  const state = stateAt(s4e.events, END)

  it('the IPS-1 label separates rate-limited from dropped packets and shows its mode', () => {
    const tags = deviceTags({ id: 'IPS-1', type: 'ips' }, null, state).map((t) => t.text)
    expect(tags[0]).toBe('ENFORCE')
    expect(tags.find((t) => /LIMITED/.test(t))).toBe(`${state.nodes['IPS-1'].limited} LIMITED`)
    expect(tags.find((t) => /DROPPED/.test(t))).toBe(`${state.nodes['IPS-1'].dropped - state.nodes['IPS-1'].limited} DROPPED`)
    expect(deviceTags({ id: 'IDS-1', type: 'ids' }, null, state).map((t) => t.text)).toEqual(['2 ALERTS'])
  })

  it('the attacker is BLOCKED only while the block is on', () => {
    const added = ofType(s4e.events, 'block.added')[0]
    const expired = ofType(s4e.events, 'block.expired')[0]
    const tagsAt = (t) => deviceTags({ id: 'EXT-ATK', type: 'host' }, '203.0.113.66', stateAt(s4e.events, t)).map((x) => x.text)
    expect(tagsAt(added.t - 0.01)).not.toContain('BLOCKED')
    expect(tagsAt(added.t)).toContain('BLOCKED')
    expect(tagsAt(expired.t)).not.toContain('BLOCKED')
  })

  it('a rate-limited packet explains itself in the packet inspector', () => {
    const drop = ofType(s4e.events, 'packet.dropped').find((e) => e.reason === 'rate_limited')
    const info = packetInspector(state, drop.pid, 99)
    expect(info.status.text).toMatch(/Dropped at IPS-1 \(rate_limited\)/)
    expect(info.verdict.kind).toBe('blocked')
    expect(info.trail.map((d) => d.text).join(' ')).toMatch(/IPS-1 rate-limited it: over the source's token bucket · D3/)
    expect(info.trail.map((d) => d.text).join(' ')).toMatch(/classified it suspicious \(D3\)/)
  })

  it('the device inspector lists the rate-limited count', () => {
    const live = deviceInspector({ id: 'IPS-1', type: 'ips' }, null, state, 99)
    expect(live.counters.find((c) => c.key === 'limited').value).toBe(state.nodes['IPS-1'].limited)
    expect(live.blocks).toEqual([]) // the block has expired by the end of the run
  })

  it('the timeline marks where rate limiting starts, once, then the block and its end', () => {
    const marks = markersFor(s4e.events, s4e.duration)
    expect(marks.filter((m) => m.kind === 'limit')).toHaveLength(1)
    const limit = marks.find((m) => m.kind === 'limit')
    const block = marks.find((m) => m.kind === 'block')
    expect(limit.t).toBeLessThanOrEqual(block.t)
    expect(limit.title).toContain('rate limiting')
    expect(marks.filter((m) => m.kind === 'alert-high')).toHaveLength(2)
    expect(marks.some((m) => m.kind === 'unblock')).toBe(true)
    expect(markersFor(s4m.events, s4m.duration).some((m) => m.kind === 'limit')).toBe(false) // Monitor never applies a limit
  })
})

describe('S7', () => {
  const state = stateAt(s7.events, END)

  it('shows the brute-forcer blocked for 30 s and D2 alerts from both sensors', () => {
    expect(state.alerts.map((a) => [a.sensor, a.rule, a.severity]).sort()).toEqual([
      ['IDS-1', 'D2', 'high'], ['IDS-1', 'D2', 'medium'], ['IPS-1', 'D2', 'high'], ['IPS-1', 'D2', 'medium'],
    ])
    const added = ofType(s7.events, 'block.added')[0]
    expect(added.until - added.t).toBeCloseTo(30, 6)
    expect(deviceTags({ id: 'PC-2', type: 'host' }, '10.0.10.12', stateAt(s7.events, added.t + 5)).map((t) => t.text)).toContain('BLOCKED')
  })

  it('has the quiet S7 effects well inside the pools without any sampling', () => {
    const list = buildEffects(s7.events)
    expect(kinds(list, 'shatter').length).toBe(ofType(s7.events, 'packet.dropped').filter((e) => !(e.reason === 'blocked_source' && false)).length)
  })
})

describe('automatic fall-back to Low quality', () => {
  const slow = (n) => Array(n).fill(14)

  it('switches after five slow samples on the High preset, once', () => {
    expect(shouldLowerQuality(slow(SLOW_SAMPLES - 1), 'high', false)).toBe(false)
    expect(shouldLowerQuality(slow(SLOW_SAMPLES), 'high', false)).toBe(true)
    expect(shouldLowerQuality(slow(SLOW_SAMPLES), 'low', false)).toBe(false)
    expect(shouldLowerQuality(slow(SLOW_SAMPLES), 'high', true)).toBe(false)
  })

  it('does not mistake a hidden or throttled page for a slow GPU, nor a healthy one for slow', () => {
    expect(shouldLowerQuality(Array(8).fill(1), 'high', false)).toBe(false) // about 1 fps: the browser is throttling the page
    expect(shouldLowerQuality(Array(8).fill(58), 'high', false)).toBe(false)
    expect(shouldLowerQuality([14, 14, 14, 14, 40, 14, 14, 14, 14], 'high', false)).toBe(false) // the last five are not all slow
    expect(shouldLowerQuality([60, 60, 60, 14, 14, 14, 14, 14], 'high', false)).toBe(true)
  })

  it('lowers the quality in the store once, with a notice that can be dismissed', () => {
    useStore.setState({ autoLowered: false, qualityNotice: null, settings: { ...useStore.getState().settings, quality: 'high' } })
    useStore.getState().lowerQualityAutomatically(14.4)
    expect(useStore.getState().settings.quality).toBe('low')
    expect(useStore.getState().qualityNotice).toMatch(/14 fps.*Low quality/)
    useStore.getState().setSetting('quality', 'high') // the user switches back
    useStore.getState().lowerQualityAutomatically(14)
    expect(useStore.getState().settings.quality).toBe('high') // and the app does not override them again
    useStore.getState().dismissQualityNotice()
    expect(useStore.getState().qualityNotice).toBeNull()
  })
})
