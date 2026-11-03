import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client.js'
import { activeEffects, buildEffects } from '../../playback/effects.js'
import { packetInspector } from '../../playback/inspectors.js'
import { stateAt } from '../../playback/player.js'
import { session } from '../../playback/session.js'
import { CUSTOM_TRACE_NAME, loadTrace } from '../../playback/testTraces.js'
import { useStore } from '../../state/store.js'
import { loadBackendTopology } from '../../scene/testSupport.js'
import {
  DEFAULT_FORM,
  MAX_CUSTOM_FLOWS,
  buildCustomFlow,
  describeCustomFlow,
  firstPacketOfFlow,
  nextFlowId,
  startTimeFor,
  trafficHosts,
  validateForm,
} from './sendTraffic.js'

const hosts = trafficHosts(loadBackendTopology())

describe('the hosts offered by the form', () => {
  it('are the devices that can send and receive traffic, with their addresses', () => {
    expect(hosts.map((h) => h.id).sort()).toEqual(['ADMIN-PC', 'APP-SRV', 'DB-SRV', 'EXT-ATK', 'EXT-USR', 'LAPTOP-1', 'PC-1', 'PC-2', 'SEC-LOG'])
    expect(hosts.find((h) => h.id === 'PC-1').address).toBe('10.0.10.11')
    expect(hosts.find((h) => h.id === 'DB-SRV').address).toBe('10.0.30.20')
    expect(trafficHosts(null)).toEqual([])
  })
})

describe('validation', () => {
  it('accepts the Rev 3 case as it ships: PC-1 to DB-SRV on 3306', () => {
    expect(DEFAULT_FORM).toMatchObject({ source: 'PC-1', destination: 'DB-SRV', port: 3306, kind: 'tcp' })
    expect(validateForm(DEFAULT_FORM, hosts)).toEqual([])
  })

  it.each([
    [{ source: 'NOPE' }, /source/i],
    [{ destination: 'IPS-1' }, /destination/i],
    [{ destination: 'PC-1' }, /different/i],
    [{ port: 0 }, /port/i],
    [{ port: 70000 }, /port/i],
    [{ port: 22.5 }, /port/i],
    [{ port: '' }, /port/i],
    [{ kind: 'flags', count: 0 }, /count/i],
    [{ kind: 'flags', count: 11 }, /count/i],
    [{ kind: 'flags', flags: ['SYN', 'BOGUS'] }, /flag/i],
    [{ kind: 'sctp' }, /kind/i],
  ])('refuses %j', (patch, message) => {
    const problems = validateForm({ ...DEFAULT_FORM, ...patch }, hosts)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toMatch(message)
  })

  it('does not ask for a port when pinging and does not ask for a count for a TCP connection', () => {
    expect(validateForm({ ...DEFAULT_FORM, kind: 'ping', port: '' }, hosts)).toEqual([])
    expect(validateForm({ ...DEFAULT_FORM, kind: 'tcp', count: 99 }, hosts)).toEqual([])
  })

  it('stops at the per-run limit', () => {
    expect(validateForm(DEFAULT_FORM, hosts, MAX_CUSTOM_FLOWS - 1)).toEqual([])
    expect(validateForm(DEFAULT_FORM, hosts, MAX_CUSTOM_FLOWS).join(' ')).toMatch(/At most 5/)
  })
})

describe('building the engine flow', () => {
  it('turns the Rev 3 case into a tcp_session flow', () => {
    expect(buildCustomFlow(DEFAULT_FORM, { id: 'X1', start: 5.2 })).toEqual({
      type: 'tcp_session', id: 'X1', src: 'PC-1', dst: 'DB-SRV', start: 5.2, dport: 3306, request_bytes: 100,
    })
  })

  it('numbers the port, keeps flags in canonical order and drops flags that were not chosen', () => {
    const flow = buildCustomFlow({ ...DEFAULT_FORM, kind: 'flags', port: '443', flags: ['URG', 'FIN', 'PSH'], count: '2' }, { id: 'X2', start: 1 })
    expect(flow).toEqual({ type: 'flag_probe', id: 'X2', src: 'PC-1', dst: 'DB-SRV', start: 1, dport: 443, flags: ['FIN', 'PSH', 'URG'], count: 2, interval: 0.5 })
    expect(buildCustomFlow({ ...DEFAULT_FORM, kind: 'flags', flags: [], count: 1 }, { id: 'X3', start: 1 }).flags).toEqual([]) // NULL
  })

  it('builds a ping with no port', () => {
    const flow = buildCustomFlow({ ...DEFAULT_FORM, kind: 'ping', destination: 'APP-SRV', count: 3 }, { id: 'X1', start: 2 })
    expect(flow).toEqual({ type: 'icmp_echo', id: 'X1', src: 'PC-1', dst: 'APP-SRV', start: 2, count: 3, interval: 1, payload_bytes: 32 })
    expect('dport' in flow).toBe(false)
  })

  it('starts at the playhead rounded up to a tenth, never before it', () => {
    expect([0, 4.01, 4.0, 4.99, 12.3].map(startTimeFor)).toEqual([0, 4.1, 4, 5, 12.3])
    for (const t of [0.07, 3.33, 19.999]) expect(startTimeFor(t)).toBeGreaterThanOrEqual(t)
  })

  it('picks the next free X id and describes each flow', () => {
    expect(nextFlowId([])).toBe('X1')
    expect(nextFlowId([{ id: 'X1' }, { id: 'X3' }])).toBe('X2')
    expect(describeCustomFlow(buildCustomFlow(DEFAULT_FORM, { id: 'X1', start: 1 }))).toBe('PC-1 → DB-SRV:3306 TCP connection')
    expect(describeCustomFlow(buildCustomFlow({ ...DEFAULT_FORM, kind: 'flags', flags: [], count: 2 }, { id: 'X1', start: 1 }))).toContain('NULL')
  })
})

describe('what the injected PC-1 to DB:3306 flow shows (a real engine trace)', () => {
  const trace = loadTrace(CUSTOM_TRACE_NAME)
  const events = trace.events
  const pid = firstPacketOfFlow(events, 'X1')
  const state = stateAt(events, Infinity)

  it('exists only from T+5, so nothing before it was disturbed', () => {
    expect(events.find((e) => e.pid === pid && e.type === 'packet.created').t).toBe(5)
    const base = stateAt(loadTrace('s1-monitor').events, 4.99)
    const live = stateAt(events, 4.99)
    expect(live.counts).toEqual(base.counts)
    expect(Object.keys(live.packets)).toEqual(Object.keys(base.packets))
    expect(firstPacketOfFlow(events, 'nope')).toBeNull()
  })

  it('the packet inspector shows the path, the ACL denial with its rule id and the drop', () => {
    const info = packetInspector(state, pid, 99)
    expect([...info.hops.map((h) => h.from), info.hops.at(-1).to]).toEqual(['PC-1', 'ACC-SW2', 'CORE-SW1'])
    expect(info.hops.map((h) => [h.vlan, h.ttl])).toEqual([[10, 64], [10, 64]])
    expect(info.status.text).toMatch(/^Dropped at CORE-SW1 \(acl_deny\)/)
    expect(info.verdict.kind).toBe('blocked')
    expect(info.trail).toHaveLength(1)
    expect(info.trail[0]).toMatchObject({ node: 'CORE-SW1', tone: 'danger' })
    expect(info.trail[0].text).toContain('STAFF-IN:10')
    expect(info.copies).toHaveLength(1) // the SPAN copy IDS-1 saw
  })

  it('the 3D effects are an ACL flash with the rule id, a shatter at the core and the IDS-1 radar pulse', () => {
    const list = buildEffects(events)
    const flash = list.find((e) => e.kind === 'acl-flash' && e.t0 >= 5)
    expect(flash).toMatchObject({ node: 'CORE-SW1', label: 'STAFF-IN:10', tone: 'danger' })
    expect(list.find((e) => e.kind === 'shatter' && e.t0 >= 5)).toMatchObject({ node: 'CORE-SW1', label: 'acl_deny' })
    const radar = list.find((e) => e.kind === 'radar')
    expect(radar).toMatchObject({ node: 'IDS-1', label: 'D4 HIGH' })
    expect(radar.t0).toBeGreaterThan(flash.t0)
    expect(activeEffects(list, flash.t0).some((a) => a.effect.id === flash.id)).toBe(true)
  })

  it('the alert, counters and incident match the engine', () => {
    expect(state.alerts.map((a) => [a.sensor, a.rule, a.severity, a.src, a.dst, a.dport])).toEqual([['IDS-1', 'D4', 'high', '10.0.10.11', '10.0.30.20', 3306]])
    expect(state.counts).toEqual(trace.summary)
    expect(state.counts).toMatchObject({ blocked: 1, alerts: 1, incidents: 1 })
    expect(state.nodes['CORE-SW1']).toMatchObject({ denies: 1 })
    expect(state.ruleHits['STAFF-IN:10']).toMatchObject({ node: 'CORE-SW1', action: 'deny', count: 1 })
    expect(state.nodes['IDS-1'].dropped ?? 0).toBe(0)
  })
})

describe('injecting through the store', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    session.clear()
  })

  async function loadS1(spy) {
    vi.spyOn(api, 'runScenario').mockImplementation(async (body) => {
      spy.push(body)
      return loadTrace(CUSTOM_TRACE_NAME)
    })
    await useStore.getState().runScenario('S1', 'monitor')
  }

  it('sends the flow with the run, keeps the playhead, plays on and remembers what was injected', async () => {
    const calls = []
    await loadS1(calls)
    useStore.getState().seekTo(4.6)
    const flow = buildCustomFlow(DEFAULT_FORM, { id: 'X1', start: startTimeFor(4.6) })
    await useStore.getState().injectTraffic(flow)
    expect(calls.at(-1)).toEqual({ scenario_id: 'S1', ips_mode: 'monitor', controls: [], custom_flows: [flow] })
    expect(flow.start).toBe(4.6)
    expect(useStore.getState().playback.time).toBe(4.6)
    expect(useStore.getState().playback.playing).toBe(true)
    expect(useStore.getState().run.request.customFlows).toEqual([flow])
  })

  it('adds to earlier injections, keeps mode switches, and can clear them', async () => {
    const calls = []
    await loadS1(calls)
    const one = buildCustomFlow(DEFAULT_FORM, { id: 'X1', start: 2 })
    const two = buildCustomFlow({ ...DEFAULT_FORM, kind: 'ping', destination: 'APP-SRV' }, { id: 'X2', start: 3 })
    await useStore.getState().injectTraffic(one)
    await useStore.getState().switchIpsModeFromNow('enforce')
    expect(calls.at(-1).custom_flows).toEqual([one]) // a mode switch keeps the injected traffic
    await useStore.getState().injectTraffic(two)
    expect(calls.at(-1).custom_flows).toEqual([one, two])
    expect(calls.at(-1).controls).toHaveLength(1)
    await useStore.getState().clearInjectedTraffic()
    expect(calls.at(-1).custom_flows).toEqual([])
    expect(useStore.getState().run.request.customFlows).toEqual([])
  })

  it('shows the engine refusing a flow and does nothing without a loaded run', async () => {
    const calls = []
    await loadS1(calls)
    vi.spyOn(api, 'runScenario').mockRejectedValue(new Error('custom flow \'X1\' is already used'))
    await useStore.getState().injectTraffic(buildCustomFlow(DEFAULT_FORM, { id: 'X1', start: 1 }))
    expect(useStore.getState().run.status).toBe('error')
    expect(useStore.getState().run.error).toMatch(/already used/)
    session.clear()
    useStore.setState({ run: { status: 'idle', meta: null, error: null, request: null }, playback: { loaded: false, playing: false, speed: 1, time: 0, duration: 0, finished: false, state: null } })
    const spy = vi.spyOn(api, 'runScenario')
    spy.mockClear()
    await useStore.getState().injectTraffic(buildCustomFlow(DEFAULT_FORM, { id: 'X1', start: 1 }))
    expect(spy).not.toHaveBeenCalled()
  })
})
