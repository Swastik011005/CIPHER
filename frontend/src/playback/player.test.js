import { describe, expect, it } from 'vitest'

import { Player, SPEEDS, stateAt } from './player.js'
import { applyEvent, describeEvent, initialState } from './reducers.js'
import { TRACE_NAMES, loadTrace } from './testTraces.js'

const traces = Object.fromEntries(TRACE_NAMES.map((n) => [n, loadTrace(n)]))
const COUNT_KEYS = ['data_packets', 'delivered_clean', 'delivered_flagged', 'blocked', 'other_drop', 'mirrored', 'alerts', 'incidents']

/** Reference implementation: fold events one by one from scratch. */
function foldUpTo(events, t) {
  let state = initialState()
  for (const e of events) {
    if (e.t > t) break
    state = applyEvent(state, e)
  }
  return state
}

const pick = (counts) => Object.fromEntries(COUNT_KEYS.map((k) => [k, counts[k]]))

describe('golden traces', () => {
  it.each(TRACE_NAMES)('%s is ordered by time with a gap-free sequence', (name) => {
    const { events } = traces[name]
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i))
    for (let i = 1; i < events.length; i++) expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t)
    expect(events[0].type).toBe('run.meta')
    expect(events.at(-1).type).toBe('run.end')
  })
})

describe('reducers agree with the engine', () => {
  it.each(TRACE_NAMES)('%s: replaying every event reproduces run.end stats exactly', (name) => {
    const { events, summary } = traces[name]
    const state = stateAt(events, Infinity)
    expect(pick(state.counts)).toEqual(pick(summary))
    expect(pick(state.counts)).toEqual(pick(state.finalStats))
    const c = state.counts
    expect(c.data_packets).toBe(c.delivered_clean + c.delivered_flagged + c.blocked + c.other_drop)
  })

  it('does not mutate the state it is given', () => {
    const { events } = traces['s2-enforce']
    let state = initialState()
    for (const e of events.slice(0, 400)) {
      const before = JSON.stringify(state)
      const next = applyEvent(state, e)
      expect(JSON.stringify(state)).toBe(before)
      state = next
    }
  })

  it('describes every event type used in the traces', () => {
    const types = new Set(Object.values(traces).flatMap((t) => t.events.map((e) => e.type)))
    for (const e of Object.values(traces).flatMap((t) => t.events)) {
      expect(describeEvent(e)).toBeTypeOf('string')
      expect(describeEvent(e).length).toBeGreaterThan(0)
    }
    expect(types.has('alert.raised') && types.has('block.added') && types.has('packet.dropped')).toBe(true)
  })
})

describe('seeking', () => {
  const { events, duration } = traces['s2-enforce']
  const times = [0, 0.4, 0.5, 1, 3.249, 3.25, 3.43, 4.75, 4.93, 5, 12, 24.92, 24.93, 25, 33.3, 46, duration]

  it.each(times)('seek(%s) equals folding the events up to that time', (t) => {
    expect(stateAt(events, t)).toEqual(foldUpTo(events, t))
  })

  it('lands on the same state whatever order the seeks arrive in (forward and backward)', () => {
    const player = new Player(events)
    for (const t of [20, 5, 33, 0, 12, 46, 4.93, 4.92, 25, 3]) {
      player.seek(t)
      expect(player.time).toBe(t)
      expect(player.state).toEqual(foldUpTo(events, t))
    }
  })

  it('applies events at exactly the seek time (inclusive)', () => {
    const alert = events.find((e) => e.type === 'alert.raised')
    expect(stateAt(events, alert.t).counts.alerts).toBe(1)
    expect(stateAt(events, alert.t - 0.001).counts.alerts).toBe(0)
  })

  it('clamps to the run', () => {
    const player = new Player(events)
    player.seek(-5)
    expect(player.time).toBe(0)
    player.seek(1e9)
    expect(player.time).toBe(duration)
    expect(player.state.cursor).toBe(events.length)
    expect(player.finished).toBe(true)
  })
})

describe('play, pause, speed and step', () => {
  const { events, duration } = traces['s2-monitor']

  it('only advances while playing', () => {
    const player = new Player(events)
    player.advance(5)
    expect(player.time).toBe(0)
    player.play()
    player.advance(2)
    expect(player.time).toBe(2)
    player.pause()
    player.advance(10)
    expect(player.time).toBe(2)
  })

  it('scales time by the speed setting', () => {
    const slow = new Player(events)
    const fast = new Player(events)
    slow.play()
    fast.play()
    fast.setSpeed(2)
    slow.advance(4)
    fast.advance(2)
    expect(fast.time).toBe(slow.time)
    expect(fast.state).toEqual(slow.state)
    const quarter = new Player(events)
    quarter.setSpeed(0.25)
    quarter.play()
    quarter.advance(8)
    expect(quarter.time).toBe(2)
  })

  it('rejects speeds that are not offered', () => {
    const player = new Player(events)
    expect(SPEEDS).toEqual([0.25, 0.5, 1, 2])
    for (const bad of [0, -1, 3, NaN, '1']) expect(() => player.setSpeed(bad)).toThrow(/speed/i)
  })

  it('is deterministic: the state depends on the time reached, not on how it was reached', () => {
    const coarse = new Player(events)
    const fine = new Player(events)
    coarse.play()
    fine.play()
    coarse.advance(7.5)
    for (let i = 0; i < 750; i++) fine.advance(0.01)
    expect(fine.time).toBeCloseTo(coarse.time, 9)
    expect(fine.state).toEqual(stateAt(events, fine.time))
    expect(coarse.state).toEqual(stateAt(events, 7.5))
  })

  it('runs to the end, stops there, and restarts from zero on play', () => {
    const player = new Player(events)
    player.play()
    player.advance(1000)
    expect(player.time).toBe(duration)
    expect(player.playing).toBe(false)
    expect(player.finished).toBe(true)
    expect(player.state.finalStats).not.toBeNull()
    player.play()
    expect(player.time).toBe(0)
    expect(player.playing).toBe(true)
    expect(player.state.counts.data_packets).toBe(0)
  })

  it('steps to the next event, pausing on it', () => {
    const player = new Player(events)
    player.play()
    expect(player.step()).toBe(true)
    expect(player.playing).toBe(false)
    const seen = player.state.cursor
    expect(player.step()).toBe(true)
    expect(player.state.cursor).toBeGreaterThan(seen)
    expect(player.state).toEqual(foldUpTo(events, player.time))
    player.seek(duration)
    expect(player.step()).toBe(false)
  })

  it('reset returns to an untouched, paused T+0', () => {
    const player = new Player(events)
    player.play()
    player.advance(9)
    player.reset()
    expect(player.time).toBe(0)
    expect(player.playing).toBe(false)
    expect(player.state).toEqual(foldUpTo(events, 0))
  })

  it('refuses an empty trace', () => {
    expect(() => new Player([])).toThrow()
  })
})

describe('what the player shows', () => {
  const enforce = traces['s2-enforce'].events
  const monitor = traces['s2-monitor'].events
  const first = (events, type) => events.find((e) => e.type === type)

  it('shows no alerts before the scan crosses the threshold and both sensors after', () => {
    const idsAlert = enforce.find((e) => e.type === 'alert.raised' && e.sensor === 'IDS-1')
    expect(stateAt(enforce, idsAlert.t - 0.01).alerts).toHaveLength(0)
    const after = stateAt(enforce, 5)
    expect(after.alerts.map((a) => a.sensor).sort()).toEqual(['IDS-1', 'IDS-1', 'IPS-1', 'IPS-1'])
    expect(after.counts.incidents).toBe(1)
  })

  it('holds the block exactly from block.added until block.expired in Enforce mode', () => {
    const added = first(enforce, 'block.added')
    const expired = first(enforce, 'block.expired')
    expect(Object.keys(stateAt(enforce, added.t - 0.01).blocks)).toEqual([])
    expect(Object.keys(stateAt(enforce, added.t).blocks)).toEqual([added.src])
    expect(Object.keys(stateAt(enforce, expired.t - 0.01).blocks)).toEqual([added.src])
    expect(Object.keys(stateAt(enforce, expired.t).blocks)).toEqual([])
  })

  it('never blocks or drops anything in Monitor mode', () => {
    const end = stateAt(monitor, Infinity)
    expect(end.blocks).toEqual({})
    expect(end.counts.blocked).toBe(0)
    expect(end.counts.delivered_flagged).toBeGreaterThan(0)
  })

  it('counts blocked packets only in Enforce mode and keeps the totals consistent', () => {
    const end = stateAt(enforce, Infinity)
    expect(end.counts.blocked).toBeGreaterThan(20)
    expect(Object.values(end.packets).filter((p) => p.end?.reason === 'ips_drop')).toHaveLength(1)
    expect(Object.values(end.packets).every((p) => p.end !== null)).toBe(true) // every packet has an outcome
  })

  it('keeps IDS-1 out of every drop and records mirror copies separately', () => {
    const end = stateAt(enforce, Infinity)
    const packets = Object.values(end.packets)
    expect(packets.filter((p) => p.end?.type === 'dropped' && p.end.node === 'IDS-1')).toEqual([])
    expect(packets.filter((p) => p.mirrorOf != null).every((p) => p.end?.node === 'IDS-1')).toBe(true)
    expect(end.counts.mirrored).toBe(packets.filter((p) => p.mirrorOf != null).length)
  })

  it('records every hop of a packet in order', () => {
    const end = stateAt(monitor, Infinity)
    const session = Object.values(end.packets).find((p) => p.flow === 'F1-https' && p.mirrorOf == null && p.flags.join() === 'SYN')
    expect(session.hops.map((h) => h.from).concat(session.hops.at(-1).to)).toEqual([
      'PC-1', 'ACC-SW2', 'CORE-SW1', 'IPS-1', 'SRV-SW3', 'APP-SRV',
    ])
    for (let i = 1; i < session.hops.length; i++) expect(session.hops[i].t).toBeGreaterThanOrEqual(session.hops[i - 1].tArrive)
  })

  it('keeps a bounded ticker of notable events and leaves routine permits out', () => {
    const end = stateAt(enforce, Infinity)
    expect(end.log.length).toBeLessThanOrEqual(60)
    expect(end.log.some((l) => l.type === 'alert.raised')).toBe(true)
    expect(end.log.some((l) => /permitted/.test(l.text))).toBe(false)
  })
})
