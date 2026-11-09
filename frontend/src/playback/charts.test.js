import { describe, expect, it } from 'vitest'

import { outcomeOf, protocolMix, topTalkers, trafficSeries } from './charts.js'

const packet = (pid, over) => ({ pid, proto: 'tcp', src: '10.0.10.11', dst: '10.0.30.10', createdAt: 0.2, mirrorOf: null, verdict: null, end: null, ...over })
const state = {
  packets: {
    1: packet(1, { end: { type: 'delivered', t: 1 } }),
    2: packet(2, { createdAt: 1.4, proto: 'icmp', verdict: { kind: 'flagged', t: 2 } }),
    3: packet(3, { createdAt: 1.9, src: '10.0.10.12', end: { type: 'dropped', reason: 'acl_deny', t: 2 } }),
    4: packet(4, { createdAt: 2.5, src: '10.0.10.12', proto: 'udp', end: { type: 'dropped', reason: 'ttl_expired', t: 3 } }),
    5: packet(5, { createdAt: 1.0, mirrorOf: 1, proto: 'tcp' }),
  },
}
const topology = { nodes: [{ id: 'PC-1', label: 'PC-1', interfaces: [{ ip: '10.0.10.11' }] }, { id: 'PC-2', label: 'PC-2', interfaces: [{ ip: '10.0.10.12' }] }] }

describe('the Monitoring charts count the packets of the trace', () => {
  it('classifies a packet: stopped by a control is blocked, flagged by a sensor is flagged, a TTL or route failure is neither', () => {
    expect(outcomeOf(state.packets[1])).toBe('allowed')
    expect(outcomeOf(state.packets[2])).toBe('flagged')
    expect(outcomeOf(state.packets[3])).toBe('blocked')
    expect(outcomeOf(state.packets[4])).toBe('allowed')
  })

  it('builds packets per second by outcome, leaves out SPAN copies, and the buckets add up to the packets', () => {
    const s = trafficSeries(state, 4, 1)
    expect(s.labels).toEqual(['0', '1', '2', '3'])
    expect(s.allowed).toEqual([1, 0, 1, 0])
    expect(s.flagged).toEqual([0, 1, 0, 0])
    expect(s.blocked).toEqual([0, 1, 0, 0])
    expect([...s.allowed, ...s.flagged, ...s.blocked].reduce((a, b) => a + b, 0)).toBe(4)
  })

  it('counts the protocol mix and ranks the senders by device name', () => {
    expect(protocolMix(state)).toEqual({ tcp: 2, udp: 1, icmp: 1 })
    expect(topTalkers(state, topology)).toEqual([
      { ip: '10.0.10.12', name: 'PC-2', packets: 2 },
      { ip: '10.0.10.11', name: 'PC-1', packets: 2 },
    ].sort((a, b) => b.packets - a.packets || a.name.localeCompare(b.name)))
  })

  it('handles no run at all', () => {
    expect(trafficSeries(null, 0, 1).allowed).toEqual([0])
    expect(protocolMix(null)).toEqual({ tcp: 0, udp: 0, icmp: 0 })
    expect(topTalkers(null, topology)).toEqual([])
  })
})
