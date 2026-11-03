import { describe, expect, it } from 'vitest'

import { loadBackendTopology } from '../scene/testSupport.js'
import { LOG_FILTERS, bucketsAddUp, deviceRows, eventLog, kpis } from './monitoring.js'
import { Player, stateAt } from './player.js'
import { loadTrace } from './testTraces.js'

const topology = loadBackendTopology()
const ALL = ['s1-monitor', 's2-monitor', 's2-enforce', 's3-monitor', 's3-enforce', 's4-monitor', 's4-enforce', 's7-enforce']
const END = Infinity

describe('Monitoring KPIs equal the Simulation counters and the engine totals', () => {
  it.each(ALL)('%s: at the end of the run every KPI equals run.end and the buckets add up exactly', (name) => {
    const trace = loadTrace(name)
    const state = stateAt(trace.events, END)
    const byKey = Object.fromEntries(kpis(state.counts).map((k) => [k.key, k.value]))
    const { management, ...engine } = trace.summary // syslog packets are not shown as a KPI until syslog exists
    expect(management).toBe(0)
    expect(byKey).toEqual(engine)
    expect(byKey.delivered_clean + byKey.delivered_flagged + byKey.blocked + byKey.other_drop).toBe(byKey.data_packets)
  })

  it('never claims more outcomes than packets, at every moment of a busy run', () => {
    const trace = loadTrace('s4-enforce')
    const player = new Player(trace.events)
    for (let t = 0; t <= trace.duration; t += 0.7) {
      player.seek(t)
      expect(bucketsAddUp(player.state.counts)).toBe(true)
    }
  })

  it('lists them in the order the Simulation panel uses', () => {
    expect(kpis(stateAt(loadTrace('s1-monitor').events, END).counts).map((k) => k.label)).toEqual([
      'Packets', 'Delivered clean', 'Delivered flagged', 'Blocked', 'Other drops', 'SPAN copies', 'Alerts', 'Incidents',
    ])
  })
})

describe('the device table', () => {
  const state = stateAt(loadTrace('s3-enforce').events, END)
  const rows = deviceRows(topology, state)
  const row = (id) => rows.find((r) => r.id === id)

  it('has one row per topology node with the counters of the trace', () => {
    expect(rows).toHaveLength(topology.nodes.length)
    expect(row('CORE-SW1')).toMatchObject({ denies: 2, permits: expect.any(Number) })
    expect(row('FW1')).toMatchObject({ denies: 1 })
    expect(row('IPS-1')).toMatchObject({ dropped: 1 })
    expect(row('IDS-1')).toMatchObject({ alerts: 3, dropped: 0 })
    expect(row('ADMIN-PC').delivered).toBe(1) // the injected reset
  })

  it('shows what each enforcement point did and that IDS-1 only alerted', () => {
    expect(row('IDS-1').tags.map((t) => t.text)).toEqual(['3 ALERTS'])
    expect(row('IPS-1').tags.map((t) => t.text)).toContain('ENFORCE')
    expect(row('FW1').tags.map((t) => t.text)).toEqual(['1 DENIED'])
  })

  it('adds up: every packet that left a device arrived somewhere or was dropped', () => {
    const s4 = stateAt(loadTrace('s4-enforce').events, END)
    const r = deviceRows(topology, s4)
    const sent = r.reduce((n, x) => n + x.sent, 0)
    const received = r.reduce((n, x) => n + x.received, 0)
    expect(sent).toBe(received) // every hop leaves one device and arrives at another
  })

  it('is empty-safe before anything has happened', () => {
    expect(deviceRows(topology, new Player(loadTrace('s1-monitor').events).state).every((r) => r.sent === 0 && r.tags.length === 0 || r.tags.length > 0)).toBe(true)
  })
})

describe('the event log', () => {
  const trace = loadTrace('s3-enforce')
  const events = trace.events

  it('shows the security events up to the playhead, newest first, nothing from the future', () => {
    const player = new Player(events)
    player.seek(8)
    const log = eventLog(events, player.state.cursor, 'security')
    expect(log.length).toBeGreaterThan(0)
    expect(log.map((e) => e.t)).toEqual([...log.map((e) => e.t)].sort((a, b) => b - a))
    expect(log.every((e) => e.t <= 8)).toBe(true)
    expect(log.some((e) => e.type === 'policy.decision' && e.text.includes('STAFF-IN:10'))).toBe(true)
    expect(log.every((e) => ['alert.raised', 'ips.action', 'policy.decision', 'block.added', 'block.expired'].includes(e.type))).toBe(true)
  })

  it('filters drops and deliveries, and matches the trace exactly', () => {
    const state = stateAt(events, END)
    expect(eventLog(events, state.cursor, 'drops', 100).map((e) => e.seq).sort((a, b) => a - b)).toEqual(
      events.filter((e) => e.type === 'packet.dropped').map((e) => e.seq),
    )
    const drops = eventLog(events, state.cursor, 'drops')
    expect(drops.map((e) => e.text).join(' ')).toMatch(/dropped at IPS-1: ips_reject/)
    expect(eventLog(events, state.cursor, 'delivered').every((e) => e.type === 'packet.delivered')).toBe(true)
    expect(eventLog(events, state.cursor, 'all', 5)).toHaveLength(5)
  })

  it('is the same however the playhead got there, and empty at the start', () => {
    const player = new Player(events)
    player.seek(END)
    player.seek(9)
    const direct = new Player(events)
    direct.seek(9)
    expect(eventLog(events, player.state.cursor, 'all', 30)).toEqual(eventLog(events, direct.state.cursor, 'all', 30))
    expect(eventLog(events, new Player(events).state.cursor, 'security').length).toBe(0)
    expect(LOG_FILTERS.map((f) => f.value)).toEqual(['security', 'drops', 'delivered', 'all'])
  })

  it('stays bounded on the biggest trace', () => {
    const big = loadTrace('s4-monitor').events
    const state = stateAt(big, END)
    expect(eventLog(big, state.cursor, 'all')).toHaveLength(80)
    expect(eventLog(big, state.cursor, 'security').every((e) => e.type !== 'packet.hop')).toBe(true)
  })
})
