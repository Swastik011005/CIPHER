import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client.js'
import { useStore } from '../state/store.js'
import { deviceTags } from './deviceStatus.js'
import { activeEffects, buildEffects } from './effects.js'
import { packetInspector } from './inspectors.js'
import { ipsModeAt, markersFor } from './markers.js'
import { Player, stateAt } from './player.js'
import { session } from './session.js'
import { TRACE_NAMES, loadTrace } from './testTraces.js'

const s3e = loadTrace('s3-enforce')
const s3m = loadTrace('s3-monitor')
const END = Infinity
const kinds = (list, kind) => list.filter((e) => e.kind === kind)
const ofType = (events, type) => events.filter((e) => e.type === type)

describe('every core trace reconstructs to the engine statistics', () => {
  it.each(TRACE_NAMES)('%s: the reducer counters equal run.end at the end of the run', (name) => {
    const trace = loadTrace(name)
    const state = stateAt(trace.events, END)
    expect(state.counts).toEqual(state.finalStats)
    expect(state.counts).toEqual(trace.summary)
  })

  it.each(TRACE_NAMES)('%s: the drops by reason add up to the dropped data packets', (name) => {
    const state = stateAt(loadTrace(name).events, END)
    const dropped = Object.values(state.packets).filter((p) => p.mirrorOf == null && p.end?.type === 'dropped').length
    expect(Object.values(state.drops).reduce((a, b) => a + b, 0)).toBe(dropped)
    expect(state.counts.blocked + state.counts.other_drop).toBe(dropped)
  })
})

describe('S3 effects', () => {
  const enforce = buildEffects(s3e.events)
  const monitor = buildEffects(s3m.events)

  it('draws an ACL flash for each ACL denial and a firewall ripple for the firewall denial, with the rule ids', () => {
    expect(kinds(enforce, 'acl-flash').map((e) => [e.node, e.label])).toEqual([['CORE-SW1', 'STAFF-IN:10'], ['CORE-SW1', 'STAFF-IN:20']])
    expect(kinds(enforce, 'fw-ripple').map((e) => [e.node, e.label])).toEqual([['FW1', 'OUTSIDE-IN:implicit-deny']])
    expect(kinds(monitor, 'acl-flash')).toHaveLength(2) // static policy does not depend on the IPS mode
    expect(kinds(monitor, 'fw-ripple')).toHaveLength(1)
  })

  it('draws one IDS-1 radar pulse per IDS-1 alert (three) and one IPS-1 alert ring (the reject)', () => {
    expect(kinds(enforce, 'radar')).toHaveLength(3)
    expect(kinds(enforce, 'radar').every((e) => e.node === 'IDS-1' && e.tone === 'danger')).toBe(true)
    expect(kinds(enforce, 'radar').map((e) => e.label)).toEqual(['D4 HIGH', 'D5 HIGH', 'D4 HIGH'])
    expect(kinds(enforce, 'sensor-alert').map((e) => [e.node, e.label])).toEqual([['IPS-1', 'D4 HIGH']])
  })

  it('Enforce: IPS-1 rejects once, the rejected packet shatters at IPS-1 and every drop has its shatter', () => {
    const reject = kinds(enforce, 'ips-reject')
    expect(reject).toHaveLength(1)
    expect(reject[0]).toMatchObject({ node: 'IPS-1', tone: 'danger' })
    expect(reject[0].label).toContain('reject D4')
    const dropped = ofType(s3e.events, 'packet.dropped')
    expect(kinds(enforce, 'shatter').map((e) => [e.node, e.label]).sort()).toEqual(dropped.map((e) => [e.node, e.reason]).sort())
    expect(kinds(enforce, 'shatter').filter((e) => e.node === 'IPS-1').map((e) => e.label)).toEqual(['ips_reject'])
  })

  it('Monitor: nothing is rejected, nothing at IPS-1 shatters, and the flash says it would reject', () => {
    expect(kinds(monitor, 'ips-reject')).toHaveLength(0)
    expect(kinds(monitor, 'shatter').every((e) => e.node !== 'IPS-1')).toBe(true)
    const flags = kinds(monitor, 'ips-flag')
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every((e) => e.label === 'would reject')).toBe(true)
  })

  it('no sensing effect ever belongs to enforcement: nothing blocks, rejects or shatters at IDS-1', () => {
    for (const list of [enforce, monitor]) {
      const bad = list.filter((e) => ['ips-block', 'ips-reject', 'ips-allow', 'shatter', 'unblock'].includes(e.kind) && e.node === 'IDS-1')
      expect(bad).toEqual([])
    }
  })

  it('effects show up exactly when their events are applied, however the playhead moved', () => {
    const player = new Player(s3e.events)
    const reject = kinds(enforce, 'ips-reject')[0]
    const syn = s3e.events.find((e) => e.type === 'packet.dropped' && e.reason === 'ips_reject')
    player.seek(syn.t - 0.001)
    expect(activeEffects(enforce, player.time).some((a) => a.effect.kind === 'ips-reject')).toBe(false)
    player.seek(syn.t)
    expect(activeEffects(enforce, player.time).find((a) => a.effect.kind === 'ips-reject')?.progress).toBe(0)
    expect(player.state.packets[syn.pid].end.reason).toBe('ips_reject') // the counter and the effect appear together
    player.seek(0) // back to the start: no stale effect, no stale block
    expect(activeEffects(enforce, player.time)).toEqual([])
    player.seek(reject.t0 + 0.4)
    expect(activeEffects(enforce, player.time).some((a) => a.effect.kind === 'ips-reject')).toBe(true)
  })
})

describe('the injected TCP reset', () => {
  const state = stateAt(s3e.events, END)
  const rst = Object.values(state.packets).find((p) => p.injectedBy)

  it('is recognised, red from the moment it exists, and travels from IPS-1 back to ADMIN-PC', () => {
    expect(Object.values(state.packets).filter((p) => p.injectedBy)).toHaveLength(1) // not the SPAN copy of it
    expect(rst.injectedBy).toBe('IPS-1')
    expect(rst.verdict).toEqual({ kind: 'blocked', t: rst.createdAt })
    expect(rst.flags).toEqual(['ACK', 'RST'])
    expect(rst.hops.map((h) => h.from)).toEqual(['IPS-1', 'CORE-SW1', 'ACC-SW2'])
    expect(rst.end).toMatchObject({ type: 'delivered', node: 'ADMIN-PC' })
    const copy = Object.values(state.packets).find((p) => p.mirrorOf === rst.pid)
    expect(copy.injectedBy).toBeNull() // the copy IDS-1 sees is an ordinary SPAN copy
  })

  it('is explained in the packet inspector and in the event ticker', () => {
    const info = packetInspector(state, rst.pid, 99)
    expect(info.injectedBy).toBe('IPS-1')
    expect(info.src).toBe('10.0.30.20')
    expect(info.sport).toBe(3306)
    expect(info.trail[0]).toMatchObject({ node: 'IPS-1', tone: 'danger' })
    expect(info.trail[0].text).toContain('spoofed as 10.0.30.20')
    expect(state.log.some((l) => l.text.includes('IPS-1 injected a TCP reset spoofed as 10.0.30.20:3306 to 10.0.20.10'))).toBe(true)
    expect(state.log.some((l) => l.text.includes('rejected') && l.text.includes('TCP reset'))).toBe(true)
  })

  it('counts as one clean delivery: it is data-plane traffic made by the IPS', () => {
    expect(state.counts).toMatchObject({ data_packets: 5, delivered_clean: 1, blocked: 4, mirrored: 4 })
    expect(state.drops).toEqual({ acl_deny: 2, fw_deny: 1, ips_reject: 1 })
  })

  it('does not exist before IPS-1 rejects, and is gone again after seeking back', () => {
    const drop = s3e.events.find((e) => e.type === 'packet.dropped' && e.reason === 'ips_reject')
    expect(Object.values(stateAt(s3e.events, drop.t - 0.01).packets).some((p) => p.injectedBy)).toBe(false)
    const player = new Player(s3e.events)
    player.seek(END)
    player.seek(drop.t - 0.01)
    expect(Object.values(player.state.packets).some((p) => p.injectedBy)).toBe(false)
    expect(player.state.log.some((l) => l.text.includes('injected'))).toBe(false)
  })
})

describe('device indicators in S3', () => {
  const tags = (trace, id, type) => deviceTags({ id, type }, null, stateAt(trace.events, END)).map((t) => t.text)

  it('shows each enforcement point its own denials and IDS-1 only alerts', () => {
    expect(tags(s3e, 'CORE-SW1', 'l3switch')).toContain('2 DENIED')
    expect(tags(s3e, 'FW1', 'firewall')).toContain('1 DENIED')
    expect(tags(s3e, 'IDS-1', 'ids')).toEqual(['3 ALERTS'])
    expect(tags(s3e, 'IPS-1', 'ips')).toEqual(['ENFORCE', '1 DROPPED'])
  })

  it('in Monitor mode IPS-1 shows "would" decisions and no drop', () => {
    const got = tags(s3m, 'IPS-1', 'ips')
    expect(got[0]).toBe('MONITOR')
    expect(got.join()).toMatch(/WOULD-BLOCK/)
    expect(got.join()).not.toMatch(/DROPPED/)
  })

  it('the IPS-1 node counts the reject as an action and a drop, never IDS-1', () => {
    const state = stateAt(s3e.events, END)
    expect(state.nodes['IPS-1']).toMatchObject({ dropped: 1, actions: 1 })
    expect(state.nodes['IDS-1'].dropped ?? 0).toBe(0)
    expect(state.nodes['IDS-1'].actions ?? 0).toBe(0)
  })
})

describe('timeline markers', () => {
  it('marks the denials, the reject and each alert in S3 Enforce', () => {
    const marks = markersFor(s3e.events, s3e.duration)
    const count = (kind) => marks.filter((m) => m.kind === kind).length
    expect(count('deny')).toBe(3)
    expect(count('reject')).toBe(1)
    expect(count('alert-high')).toBe(4)
    expect(count('block')).toBe(0)
    expect(marks.every((m) => m.left >= 0 && m.left <= 100)).toBe(true)
    expect(marks.find((m) => m.kind === 'reject').title).toContain('IPS-1 reject (D4)')
  })

  it('S3 Monitor has the denials but no applied reject; S2 Enforce has its block and unblock', () => {
    const monitor = markersFor(s3m.events, s3m.duration)
    expect(monitor.filter((m) => m.kind === 'deny')).toHaveLength(3)
    expect(monitor.some((m) => m.kind === 'reject')).toBe(false)
    const s2 = markersFor(loadTrace('s2-enforce').events, 46)
    expect(s2.filter((m) => ['block', 'unblock'].includes(m.kind)).map((m) => m.kind)).toEqual(['block', 'unblock'])
    expect(s2.some((m) => m.kind === 'reject')).toBe(false) // block-source actions are marked by the block, not per packet
  })

  it('every marker sits at the time of an event that exists in the trace', () => {
    const times = new Set(s3e.events.map((e) => e.t))
    for (const m of markersFor(s3e.events, s3e.duration)) expect(times.has(m.t)).toBe(true)
  })
})

describe('IPS mode switching from the playhead', () => {
  afterEach(() => vi.restoreAllMocks())

  it('works out the mode in force at the playhead', () => {
    const request = { ipsMode: 'monitor', controls: [{ type: 'ips_mode', t: 5, mode: 'enforce' }, { type: 'ips_mode', t: 9, mode: 'monitor' }] }
    expect(ipsModeAt(request, null, 1)).toBe('monitor')
    expect(ipsModeAt(request, null, 5)).toBe('enforce')
    expect(ipsModeAt(request, null, 8.9)).toBe('enforce')
    expect(ipsModeAt(request, null, 9)).toBe('monitor')
    expect(ipsModeAt(request, 'enforce', 1)).toBe('enforce') // a pinned scenario ignores controls
    expect(ipsModeAt(null, null, 1)).toBeNull()
  })

  it('re-runs with a control at the playhead, keeps the playhead and the play state, and replaces later switches', async () => {
    const trace = loadTrace('s2-enforce')
    const calls = []
    vi.spyOn(api, 'runScenario').mockImplementation(async (body) => {
      calls.push(body)
      return trace
    })
    await useStore.getState().runScenario('S2', 'monitor')
    useStore.getState().seekTo(3.2)
    useStore.getState().togglePlay() // pause
    expect(useStore.getState().playback.playing).toBe(false)

    await useStore.getState().switchIpsModeFromNow('enforce')
    expect(calls.at(-1)).toEqual({ scenario_id: 'S2', ips_mode: 'monitor', controls: [{ type: 'ips_mode', t: 3.2, mode: 'enforce' }], custom_flows: [] })
    expect(useStore.getState().playback.time).toBe(3.2)
    expect(useStore.getState().playback.playing).toBe(false) // it was paused, so it stays paused
    expect(useStore.getState().run.request.controls).toHaveLength(1)

    useStore.getState().seekTo(2)
    await useStore.getState().switchIpsModeFromNow('monitor') // an earlier switch replaces the later one
    expect(calls.at(-1).controls).toEqual([{ type: 'ips_mode', t: 2, mode: 'monitor' }])
    session.clear()
  })

  it('does nothing without a loaded run', async () => {
    session.clear()
    useStore.setState({ run: { status: 'idle', meta: null, error: null, request: null }, playback: { loaded: false, playing: false, speed: 1, time: 0, duration: 0, finished: false, state: null } })
    const spy = vi.spyOn(api, 'runScenario')
    await useStore.getState().switchIpsModeFromNow('enforce')
    expect(spy).not.toHaveBeenCalled()
  })
})
