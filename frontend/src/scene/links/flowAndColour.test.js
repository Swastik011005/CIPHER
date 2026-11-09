import { beforeEach, describe, expect, it } from 'vitest'

import { isPingPacket, PING_COLOURS, pingColour } from '../packets/packetColor.js'
import { clearLinkActivity, linkFlow, MAX_PULSES, notePulse, noteRouteGlow } from './linkActivity.js'
import { routesOf } from './routes.js'

describe('the four colours of a ping', () => {
  it('are cyan blue, purple, amber and green, one per attempt, repeating after four', () => {
    expect(PING_COLOURS).toEqual(['#38BDF8', '#A78BFA', '#F59E0B', '#34D399'])
    expect([1, 2, 3, 4, 5].map(pingColour)).toEqual(['#38BDF8', '#A78BFA', '#F59E0B', '#34D399', '#38BDF8'])
  })

  it('belong to echo requests and replies, not to SPAN copies or other ICMP', () => {
    const base = { mirrorOf: null, proto: 'icmp' }
    expect(isPingPacket({ ...base, icmp: { type: 8, seq: 1 } })).toBe(true)
    expect(isPingPacket({ ...base, icmp: { type: 0, seq: 1 } })).toBe(true)
    expect(isPingPacket({ ...base, mirrorOf: 3, icmp: { type: 8, seq: 1 } })).toBe(false)
    expect(isPingPacket({ ...base, icmp: { type: 3, seq: 0 } })).toBe(false)
    expect(isPingPacket({ ...base, proto: 'tcp', icmp: null })).toBe(false)
  })
})

describe('the whole route of a packet', () => {
  it('is read from every hop of the trace in travel order, including hops the playhead has not reached', () => {
    const events = [
      { type: 'packet.created', pid: 1 },
      { type: 'packet.hop', pid: 1, link: 'L07' },
      { type: 'packet.hop', pid: 2, link: 'L11' },
      { type: 'packet.hop', pid: 1, link: 'L06' },
      { type: 'packet.hop', pid: 1, link: 'L14' },
    ]
    const routes = routesOf(events)
    expect(routes.get(1)).toEqual(['L07', 'L06', 'L14'])
    expect(routes.get(2)).toEqual(['L11'])
    expect(routesOf(events)).toBe(routes) // computed once per trace
  })

  it('stops at the device that blocked the packet, because the trace has no hop beyond it', () => {
    const events = [
      { type: 'packet.hop', pid: 5, link: 'L07' },
      { type: 'packet.hop', pid: 5, link: 'L06' },
      { type: 'packet.dropped', pid: 5, node: 'CORE-SW1', reason: 'acl_deny' },
    ]
    expect(routesOf(events).get(5)).toEqual(['L07', 'L06'])
  })
})

describe('what a cable shows', () => {
  beforeEach(() => clearLinkActivity())

  it('keeps the strongest route glow and its colour, and every pulse up to the limit', () => {
    noteRouteGlow('L06', [0.2, 0.7, 0.9], 0.5)
    noteRouteGlow('L06', [0.9, 0.3, 0.1], 0.8)
    noteRouteGlow('L06', [0, 1, 0], 0.4)
    expect(linkFlow.get('L06')).toMatchObject({ glow: 0.8, color: [0.9, 0.3, 0.1] })
    for (let i = 0; i < MAX_PULSES + 2; i++) notePulse('L06', i / 10, i % 2 ? -1 : 1, [1, 1, 1])
    expect(linkFlow.get('L06').pulses).toHaveLength(MAX_PULSES)
    expect(linkFlow.get('L06').pulses[1]).toMatchObject({ u: 0.1, dir: -1 })
  })

  it('is cleared at the start of every frame', () => {
    noteRouteGlow('L14', [1, 1, 1], 1)
    notePulse('L14', 0.5, 1, [1, 1, 1])
    clearLinkActivity()
    expect(linkFlow.get('L14')).toMatchObject({ glow: 0, pulses: [] })
  })
})
