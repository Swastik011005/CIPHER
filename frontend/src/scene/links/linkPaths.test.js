import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'

import { stateAt } from '../../playback/player.js'
import { TRACE_NAMES, loadTrace } from '../../playback/testTraces.js'
import { DEVICE_SPECS, modelKeyFor } from '../devices/specs.js'
import { NODE_LAYOUT } from '../layout.js'
import { loadBackendTopology } from '../testSupport.js'
import { buildLinkPaths, packetPosition } from './linkPaths.js'

const topology = loadBackendTopology()
const paths = buildLinkPaths(topology)
const nodes = new Map(topology.nodes.map((n) => [n.id, n]))

/** True when `p` is within a device's footprint (plus margin) in plan view. */
function nearDevice(p, id, margin = 0.6) {
  const layout = NODE_LAYOUT[id]
  const [hx, hz] = DEVICE_SPECS[modelKeyFor(nodes.get(id), layout)].half
  return Math.abs(p.x - layout.position[0]) <= hx + margin && Math.abs(p.z - layout.position[1]) <= hz + margin
}

describe('packets follow the drawn cables', () => {
  it('has a path for all 18 links', () => {
    expect(paths.size).toBe(18)
    for (const [, path] of paths) expect(path.length).toBeGreaterThan(0.5)
  })

  it('starts each hop at the sending device and ends it at the receiving one', () => {
    const { packets } = stateAt(loadTrace('s1-monitor').events, Infinity)
    const p = new Vector3()
    const tangent = new Vector3()
    let checked = 0
    for (const packet of Object.values(packets)) {
      for (const hop of packet.hops) {
        expect(packetPosition(paths, [hop], hop.t, p, tangent)).toBe(true)
        expect(nearDevice(p, hop.from), `${hop.link} start near ${hop.from}`).toBe(true)
        packetPosition(paths, [hop], hop.tArrive, p, tangent)
        expect(nearDevice(p, hop.to), `${hop.link} end near ${hop.to}`).toBe(true)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('follows the full PC-1 to APP-SRV journey through every device on the path', () => {
    const { packets } = stateAt(loadTrace('s1-monitor').events, Infinity)
    const syn = Object.values(packets).find((pk) => pk.flow === 'F1-https' && pk.mirrorOf == null && pk.flags.join() === 'SYN')
    expect(syn.hops).toHaveLength(5)
    const visited = []
    const p = new Vector3()
    const tangent = new Vector3()
    const end = syn.hops.at(-1).tArrive
    for (let t = syn.createdAt; t <= end; t += 0.05) {
      expect(packetPosition(paths, syn.hops.filter((h) => h.t <= t), t, p, tangent)).toBe(true)
      expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true)
      for (const hop of syn.hops) if (nearDevice(p, hop.to, 0.9) && !visited.includes(hop.to)) visited.push(hop.to)
    }
    expect(visited).toEqual(['ACC-SW2', 'CORE-SW1', 'IPS-1', 'SRV-SW3', 'APP-SRV'])
  })

  it('moves smoothly: no jump larger than the cable allows between nearby times', () => {
    const { packets } = stateAt(loadTrace('s2-enforce').events, Infinity)
    const a = new Vector3()
    const b = new Vector3()
    const tangent = new Vector3()
    for (const packet of Object.values(packets).slice(0, 40)) {
      for (const hop of packet.hops) {
        const mid = (hop.t + hop.tArrive) / 2
        packetPosition(paths, [hop], mid, a, tangent)
        packetPosition(paths, [hop], mid + 0.01, b, tangent)
        // 0.01 s of a 0.35 s hop over a cable of length L moves at most L * 0.03 (plus slack).
        expect(a.distanceTo(b)).toBeLessThan(paths.get(hop.link).length * 0.04 + 1e-6)
      }
    }
  })

  it('reports no position for a packet that has not left yet', () => {
    expect(packetPosition(paths, [], 0, new Vector3(), new Vector3())).toBe(false)
  })

  it('knows the traces it is tested with', () => {
    expect(TRACE_NAMES).toContain('s2-enforce')
  })
})
