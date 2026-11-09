import { describe, expect, it } from 'vitest'

import { applyEvent, initialState } from './reducers.js'
import { describeOutcome, endpointHealth, recentConnections, siemEmptyState, siemIncidents } from './securityView.js'

const meta = { type: 'run.meta', seq: 0, t: 0, run_id: 'r', scenario_id: 'P7', seed: 1, ips_mode: 'enforce', duration: 10, config_hash: 'h' }
const created = (seq, pid, src, dst, flow, extra = {}) => ({ type: 'packet.created', seq, t: seq, pid, flow, proto: 'icmp', src, sport: null, dst, dport: null, flags: [], ttl: 64, len: 60, icmp: null, app: null, mirror_of: null, ...extra })
const fold = (events) => events.reduce(applyEvent, initialState())

describe('the reducer folds the campus security events', () => {
  const trace = [
    meta,
    { type: 'edr.alert', seq: 1, t: 1, alert_id: 'EDR-0001', node: 'PC-2', state: 'compromised', severity: 'high', reason: 'beacon', manager: 'EDR-MGMT-1' },
    { type: 'edr.state', seq: 2, t: 1, node: 'PC-2', state: 'compromised', cause: 'scenario', reason: 'beacon' },
    created(3, 7, '10.0.10.12', '10.0.30.10', 'f1'),
    { type: 'packet.dropped', seq: 4, t: 3, pid: 7, node: 'PC-2', reason: 'edr_isolated' },
    { type: 'edr.state', seq: 5, t: 3, node: 'PC-2', state: 'isolated', cause: 'operator', reason: 'isolated' },
    { type: 'siem.event', seq: 6, t: 3, event_id: 'E1', source: 'EDR', kind: 'state', severity: 'high', node: 'PC-2', src: null, dst: null, proto: null, dport: null, reason: 'isolated', action: 'PC-2 isolated', incident_id: 'I1', origin_type: 'edr.state', origin_ref: 'PC-2' },
    { type: 'zt.decision', seq: 7, t: 4, pid: 7, node: 'CORE-SW1', pdp: 'ZT-POLICY-1', user: 'dana', role: 'admin', device: 'ADMIN-PC', trust: 'trusted', resource: 'SIEM-1', proto: 'tcp', port: 443, decision: 'allow', reason: 'ok', factors: ['x'] },
  ]
  const state = fold(trace)

  it('keeps EDR state, alerts, Zero Trust decisions and SIEM events, and counts the new drop reasons as blocked', () => {
    expect(state.edr['PC-2']).toMatchObject({ state: 'isolated', cause: 'operator' })
    expect(state.edrAlerts).toHaveLength(1)
    expect(state.zt).toHaveLength(1)
    expect(state.siem).toHaveLength(1)
    expect(state.counts.blocked).toBe(1)
    expect(state.counts.other_drop).toBe(0)
  })

  it('words the outcome from the trace only', () => {
    const text = describeOutcome(state).map((l) => l.text).join(' | ')
    expect(text).toContain('1 packet dropped because the endpoint is isolated (EDR) at PC-2')
    expect(text).toContain('Zero Trust: 1 allow')
    expect(text).toContain('EDR: PC-2 is isolated')
    expect(text).toContain('SIEM received 1 event in 1 incident')
    expect(describeOutcome(null)).toEqual([])
  })

  it('lists the recent connections of an address and how they ended', () => {
    const c = recentConnections(state, '10.0.10.12')
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ peer: '10.0.30.10', dropped: 1, reason: 'edr_isolated', droppedAt: 'PC-2' })
    expect(recentConnections(state, '10.0.10.99')).toEqual([])
  })

  it('groups SIEM events into incidents and reports an endpoint health word', () => {
    const events = [
      { incident_id: 'A', node: 'PC-2', severity: 'low', t: 1, source: 'EDR' },
      { incident_id: 'A', node: 'PC-2', severity: 'high', t: 2, source: 'IDS-1' },
      { incident_id: 'B', node: 'PC-3', severity: 'medium', t: 3, source: 'IPS-1' },
    ]
    const groups = siemIncidents(events)
    expect(groups.map((g) => g.id)).toEqual(['B', 'A'])
    expect(groups[1]).toMatchObject({ severity: 'high', sources: ['EDR', 'IDS-1'] })
    expect(endpointHealth('PC-2', state, false)).toBe('isolated')
    expect(endpointHealth('PC-1', state, false)).toBe('healthy')
    expect(endpointHealth('PC-1', null, true)).toBe('isolated')
  })
})

describe('the SIEM console empty states', () => {
  it('tells "no run", "not part of this scenario" and "nothing yet" apart', () => {
    expect(siemEmptyState({ view: 'run', loaded: false, siemEnabled: undefined }).title).toBe('No run loaded')
    const baseline = siemEmptyState({ view: 'run', loaded: true, siemEnabled: false })
    expect(baseline.title).toBe('SIEM-1 is not part of this scenario')
    expect(baseline.body).toMatch(/S1 to S7/)
    expect(siemEmptyState({ view: 'run', loaded: true, siemEnabled: true }).title).toBe('No SIEM event yet')
    expect(siemEmptyState({ view: 'run', loaded: true, siemEnabled: undefined }).title).toBe('No SIEM event yet') // an older server that does not say
  })

  it('names the presentation scenarios P7 and P9, never the ambiguous "scenario 7 or 9"', () => {
    for (const state of [{ loaded: false }, { loaded: true, siemEnabled: false }, { loaded: true, siemEnabled: true }]) {
      expect(siemEmptyState({ view: 'run', ...state }).body).not.toMatch(/scenario 7 or 9/)
    }
    expect(siemEmptyState({ view: 'run', loaded: false }).body).toMatch(/P7/)
    expect(siemEmptyState({ view: 'history', loaded: true }).title).toBe('The SIEM history is empty')
  })
})
