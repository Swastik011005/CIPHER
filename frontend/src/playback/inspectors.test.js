import { describe, expect, it } from 'vitest'

import { packetColorAt, VERDICT_FADE_S } from '../scene/packets/packetColor.js'
import { deviceTags, parseTagsKey, ringStateFor, tagsKey } from './deviceStatus.js'
import { deviceInspector, packetInspector, recentPackets } from './inspectors.js'
import { Player, stateAt } from './player.js'
import { loadTrace } from './testTraces.js'

const s2e = loadTrace('s2-enforce')
const s2m = loadTrace('s2-monitor')
const END = Infinity
const ofType = (events, type) => events.filter((e) => e.type === type)
const node = (id, type) => ({ id, type })

describe('the slice path as the player reconstructs it (PC-2 to APP-SRV)', () => {
  const state = stateAt(s2m.events, END)
  const probes = Object.values(state.packets).filter(
    (p) => p.mirrorOf == null && p.src === '10.0.10.12' && p.dst === '10.0.30.10' && p.end?.type === 'delivered',
  )

  it('every delivered probe crosses the six designed devices with the right TTL and VLAN tags', () => {
    expect(probes.length).toBeGreaterThan(20)
    for (const p of probes) {
      expect([...p.hops.map((h) => h.from), p.hops.at(-1).to]).toEqual(['PC-2', 'ACC-SW2', 'CORE-SW1', 'IPS-1', 'SRV-SW3', 'APP-SRV'])
      expect(p.hops.map((h) => h.ttl)).toEqual([64, 64, 63, 63, 63])
      expect(p.hops.map((h) => h.vlan)).toEqual([10, 10, 30, 30, 30])
      expect(p.hops[1].link).toBe('L06')
    }
  })

  it('each packet that entered CORE-SW1 has exactly one SPAN copy that ends at IDS-1', () => {
    const packets = Object.values(state.packets)
    const entering = packets.filter((p) => p.mirrorOf == null && p.hops.some((h) => h.to === 'CORE-SW1'))
    for (const p of entering) {
      const copies = packets.filter((c) => c.mirrorOf === p.pid)
      expect(copies, `packet ${p.pid}`).toHaveLength(1)
      expect(copies[0].hops.map((h) => h.to)).toEqual(['IDS-1'])
      expect(copies[0].end?.node).toBe('IDS-1')
    }
    expect(packets.filter((c) => c.mirrorOf != null)).toHaveLength(entering.length)
  })

  it('the packet inspector reports those same hops, the decisions made and the copy', () => {
    const probe = probes[0]
    const info = packetInspector(state, probe.pid, 100)
    expect(info.hops.map((h) => [h.from, h.to, h.vlan, h.ttl])).toEqual(probe.hops.map((h) => [h.from, h.to, h.vlan, h.ttl]))
    expect(info.copies).toHaveLength(1)
    expect(info.src).toBe('10.0.10.12')
    expect(info.dport).toBe(probe.dport)
    expect(info.status.text).toMatch(/^Delivered at APP-SRV/)
    // CORE-SW1 permitted it (STAFF-IN catch-all) and IPS-1 inspected it, in that order.
    expect(info.trail.map((d) => d.node)).toEqual(['CORE-SW1', 'IPS-1'])
    expect(info.trail[0].text).toContain('STAFF-IN:100')
    expect(info.trail.map((d) => d.t)).toEqual([...info.trail.map((d) => d.t)].sort((a, b) => a - b))
  })

  it('a mirror copy points back at its original and never has an IPS decision', () => {
    const copy = Object.values(state.packets).find((p) => p.mirrorOf != null)
    const info = packetInspector(state, copy.pid, 100)
    expect(info.isCopy).toBe(true)
    expect(info.copyOf).toBe(copy.mirrorOf)
    expect(info.trail.every((d) => d.node === 'IDS-1')).toBe(true)
    expect(info.verdict).toBeNull() // a sensor's verdict never colours a packet
  })

  it('reports nothing for a packet that does not exist yet at the playhead', () => {
    const early = stateAt(s2m.events, 0.5)
    expect(packetInspector(early, 40, 0.5)).toBeNull()
  })
})

describe('device counters equal an independent count of the trace', () => {
  const state = stateAt(s2e.events, END)

  it('counts hops sent and received per device, keeping SPAN copies separate', () => {
    const data = new Set(ofType(s2e.events, 'packet.created').filter((e) => e.mirror_of == null).map((e) => e.pid))
    for (const id of ['PC-2', 'ACC-SW2', 'CORE-SW1', 'IPS-1', 'APP-SRV']) {
      const hops = ofType(s2e.events, 'packet.hop').filter((h) => data.has(h.pid))
      expect(state.nodes[id].sent, `${id} sent`).toBe(hops.filter((h) => h.from === id).length)
      expect(state.nodes[id].received, `${id} received`).toBe(hops.filter((h) => h.to === id).length)
    }
    const copies = ofType(s2e.events, 'packet.mirrored').length
    expect(state.nodes['IDS-1'].mirrorsIn).toBe(copies)
    expect(state.nodes['CORE-SW1'].mirrorsOut).toBe(copies)
    expect(state.nodes['IDS-1'].received ?? 0).toBe(0) // copies are not forwarded traffic
  })

  it('counts IPS drops, alerts per sensor and ACL permits', () => {
    expect(state.nodes['IPS-1'].dropped).toBe(ofType(s2e.events, 'packet.dropped').length)
    expect(state.nodes['IDS-1'].alerts).toBe(ofType(s2e.events, 'alert.raised').filter((a) => a.sensor === 'IDS-1').length)
    expect(state.nodes['IPS-1'].alerts).toBe(ofType(s2e.events, 'alert.raised').filter((a) => a.sensor === 'IPS-1').length)
    expect(state.nodes['CORE-SW1'].permits).toBe(ofType(s2e.events, 'policy.decision').filter((d) => d.node === 'CORE-SW1' && d.action === 'permit').length)
    expect(state.nodes['IDS-1'].dropped ?? 0).toBe(0) // the passive sensor never drops anything
    expect(state.nodes['IDS-1'].actions ?? 0).toBe(0)
  })

  it('rule hits add up to the policy decisions', () => {
    const total = Object.values(state.ruleHits).reduce((n, r) => n + r.count, 0)
    expect(total).toBe(ofType(s2e.events, 'policy.decision').length)
    expect(state.ruleHits['STAFF-IN:100'].node).toBe('CORE-SW1')
  })

  it('the IDS inspector has no blocks and the IPS inspector lists the active block with a countdown', () => {
    const during = stateAt(s2e.events, 10)
    const ips = deviceInspector(node('IPS-1', 'ips'), null, during, 10)
    expect(ips.blocks).toHaveLength(1)
    expect(ips.blocks[0].src).toBe('10.0.10.12')
    expect(ips.blocks[0].remaining).toBeCloseTo(during.blocks['10.0.10.12'].until - 10, 6)
    expect(deviceInspector(node('IDS-1', 'ids'), null, during, 10).blocks).toEqual([])
    const host = deviceInspector(node('PC-2', 'host'), '10.0.10.12', during, 10)
    expect(host.status.tone).toBe('danger')
    expect(host.status.text).toMatch(/Blocked by IPS-1/)
    const after = deviceInspector(node('PC-2', 'host'), '10.0.10.12', stateAt(s2e.events, 30), 30)
    expect(after.status.tone).not.toBe('danger')
  })
})

describe('device indicators follow the playhead without going stale', () => {
  const pc2 = node('PC-2', 'host')
  const ids = node('IDS-1', 'ids')
  const ips = node('IPS-1', 'ips')
  const tagsAt = (trace, t, n, address = null) => deviceTags(n, address, stateAt(trace.events, t)).map((x) => x.text)

  it('has no tags before a run is loaded', () => {
    expect(deviceTags(ips, null, null)).toEqual([])
  })

  it('IDS-1 shows alerts only (never a block or drop), counting up at the alert instants', () => {
    const alerts = ofType(s2e.events, 'alert.raised').filter((a) => a.sensor === 'IDS-1')
    expect(tagsAt(s2e, alerts[0].t - 0.01, ids)).toEqual([])
    expect(tagsAt(s2e, alerts[0].t, ids)).toEqual(['1 ALERT'])
    expect(tagsAt(s2e, alerts[1].t, ids)).toEqual(['2 ALERTS'])
    expect(tagsAt(s2e, 40, ids).some((t) => /BLOCK|DROP/.test(t))).toBe(false)
  })

  it('IPS-1 shows its mode, "would-block" in Monitor and drops in Enforce', () => {
    expect(tagsAt(s2m, 10, ips)[0]).toBe('MONITOR')
    expect(tagsAt(s2m, 10, ips).join()).toMatch(/WOULD-BLOCK/)
    expect(tagsAt(s2m, 40, ips).join()).not.toMatch(/DROPPED/)
    expect(tagsAt(s2e, 10, ips)[0]).toBe('ENFORCE')
    expect(tagsAt(s2e, 40, ips).join()).toMatch(/\d+ DROPPED/)
  })

  it('PC-2 is BLOCKED exactly while the block is active, in Enforce only', () => {
    const added = ofType(s2e.events, 'block.added')[0]
    const expired = ofType(s2e.events, 'block.expired')[0]
    const at = (t, trace = s2e) => tagsAt(trace, t, pc2, '10.0.10.12')
    expect(at(added.t - 0.01)).not.toContain('BLOCKED')
    expect(at(added.t)).toContain('BLOCKED')
    expect(at((added.t + expired.t) / 2)).toContain('BLOCKED')
    expect(at(expired.t)).not.toContain('BLOCKED')
    expect(at((added.t + expired.t) / 2, s2m)).not.toContain('BLOCKED')
  })

  it('stays correct across seeks forwards, backwards, pause, restart and replay', () => {
    const player = new Player(s2e.events)
    const tags = () => tagsKey(deviceTags(pc2, '10.0.10.12', player.state))
    const probes = [12, 3, 25.2, 4.9, 5, 40, 0, 15]
    const expected = probes.map((t) => tagsKey(deviceTags(pc2, '10.0.10.12', stateAt(s2e.events, t))))
    const got = probes.map((t) => {
      player.seek(t)
      return tags()
    })
    expect(got).toEqual(expected)
    player.seek(15)
    const mid = tags()
    player.reset()
    expect(tags()).toBe('')
    player.play()
    player.advance(15)
    expect(tags()).toBe(mid) // replay reaches the identical indicator state
    player.pause()
    player.advance(5)
    expect(tags()).toBe(mid) // paused: nothing moves
  })

  it('round-trips through the selector key and picks the ring state', () => {
    const tags = [{ text: 'BLOCKED', tone: 'danger' }, { text: '2 ALERTS', tone: 'sensor' }]
    expect(parseTagsKey(tagsKey(tags))).toEqual(tags)
    expect(parseTagsKey('')).toEqual([])
    expect(ringStateFor(tags, true, false)).toBe('blocked')
    expect(ringStateFor([{ text: '2 ALERTS', tone: 'sensor' }], false, false)).toBe('alert')
    expect(ringStateFor([{ text: 'ENFORCE', tone: 'ok' }], false, false)).toBe('idle')
    expect(ringStateFor([], true, false)).toBe('selected')
  })
})

describe('packet verdicts and colours', () => {
  const state = stateAt(s2e.events, END)
  const first = (pred) => Object.values(state.packets).find(pred)

  it('is neutral before IPS-1 inspects, then fades to green, amber or red', () => {
    const allowed = first((p) => p.mirrorOf == null && p.verdict?.kind === 'allowed')
    expect(packetColorAt({ ...allowed, verdict: null }, 0)).toMatchObject({ key: 'neutral', u: 1 })
    expect(packetColorAt(allowed, allowed.verdict.t)).toMatchObject({ key: 'allowed', from: 'neutral', u: 0 })
    expect(packetColorAt(allowed, allowed.verdict.t + VERDICT_FADE_S / 2).u).toBeCloseTo(0.5, 6)
    expect(packetColorAt(allowed, allowed.verdict.t + 5).u).toBe(1)
    const flagged = first((p) => p.mirrorOf == null && p.verdict?.kind === 'flagged')
    expect(packetColorAt(flagged, flagged.verdict.t + 1).key).toBe('flagged')
    const dropped = first((p) => p.end?.type === 'dropped')
    expect(packetColorAt(dropped, dropped.end.t + 1).key).toBe('dropped')
  })

  it('SPAN copies stay violet whatever IDS-1 concludes about them', () => {
    const copies = Object.values(state.packets).filter((p) => p.mirrorOf != null)
    expect(copies.length).toBeGreaterThan(10)
    for (const c of copies) expect(packetColorAt(c, 99).key).toBe('mirror')
    // The original of a copy IDS-1 flagged is coloured by IPS-1's own verdict, which is the only one that counts.
    expect(copies.every((c) => c.verdict === null)).toBe(true)
  })

  it('a verdict never weakens: blocked stays blocked, and the verdict time is when it was decided', () => {
    for (const p of Object.values(state.packets).filter((x) => x.end?.type === 'dropped' && x.mirrorOf == null)) {
      expect(p.verdict.kind).toBe('blocked')
      expect(p.verdict.t).toBeLessThanOrEqual(p.end.t)
    }
  })

  it('lists recent data packets newest first with their status, excluding copies', () => {
    const rows = recentPackets(stateAt(s2e.events, 10), 10, 8)
    expect(rows).toHaveLength(8)
    expect(rows.every((r) => !r.label.includes('SPAN'))).toBe(true)
    const ids = rows.map((r) => r.pid)
    const created = ids.map((id) => stateAt(s2e.events, 10).packets[id].createdAt)
    expect(created).toEqual([...created].sort((a, b) => b - a))
  })
})
