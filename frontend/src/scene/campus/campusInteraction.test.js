import { describe, expect, it } from 'vitest'

import { loadBackendTopology } from '../testSupport.js'
import { cableEnds, cableRole } from '../cableInfo.js'
import {
  CAMPUS_ZONES, ZONE_OF_DEVICE, ZONE_PURPOSE, allPlatforms, campusZone, deviceRect, devicePads, zoneFocus, zoneVolumes,
} from './campusLayout.js'

const topology = loadBackendTopology()
const inside = (inner, outer) => inner.x0 >= outer.x0 - 1e-6 && inner.x1 <= outer.x1 + 1e-6 && inner.z0 >= outer.z0 - 1e-6 && inner.z1 <= outer.z1 + 1e-6

describe('campus zone to device mapping (approved)', () => {
  it('uses exactly the approved mapping for the four campus zones', () => {
    expect(campusZone('staff').devices).toEqual(['PC-1', 'PC-2', 'LAPTOP-1', 'ACC-SW2'])
    expect(campusZone('admin').devices).toEqual(['ADMIN-PC'])
    expect(campusZone('datacentre').devices).toEqual(['APP-SRV', 'DB-SRV', 'SRV-SW3'])
    expect(campusZone('soc').devices).toEqual(['IDS-1', 'IPS-1', 'SEC-LOG'])
  })

  it('puts each of the 17 nodes in exactly one zone, and nothing else', () => {
    const all = CAMPUS_ZONES.flatMap((z) => z.devices)
    expect(all).toHaveLength(17)
    expect(new Set(all).size).toBe(17)
    expect([...all].sort()).toEqual(topology.nodes.map((n) => n.id).sort())
    for (const node of topology.nodes) expect(ZONE_OF_DEVICE[node.id], node.id).toBeTypeOf('string')
  })

  it('every zone has a purpose text', () => {
    for (const z of CAMPUS_ZONES) expect(ZONE_PURPOSE[z.id]?.length, z.id).toBeGreaterThan(40)
  })
})

describe('zone pick volumes', () => {
  const volumes = zoneVolumes()

  it('cover every campus zone, and Security Operations has both of its pavilions', () => {
    expect([...new Set(volumes.map((v) => v.zone))].sort()).toEqual(CAMPUS_ZONES.map((z) => z.id).sort())
    expect(volumes.filter((v) => v.zone === 'soc')).toHaveLength(2)
  })

  it('every device stands inside a pick volume of its own zone', () => {
    for (const node of topology.nodes) {
      const r = deviceRect(node)
      const [x, z] = [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]
      const own = volumes.filter((v) => v.zone === ZONE_OF_DEVICE[node.id])
      const holds = own.some((v) => (v.shape === 'box' ? x >= v.x0 && x <= v.x1 && z >= v.z0 && z <= v.z1 : Math.hypot(x - v.cx, z - v.cz) <= v.radius))
      expect(holds, node.id).toBe(true)
      expect(Math.max(...own.map((v) => v.h)), node.id).toBeGreaterThanOrEqual(0.3) // volumes reach up from the ground
    }
  })

  it('a zone is framed at a distance the camera allows', () => {
    for (const z of CAMPUS_ZONES) {
      const f = zoneFocus(z.id)
      expect(f, z.id).not.toBeNull()
      expect(f.distance).toBeGreaterThanOrEqual(17)
      expect(f.distance).toBeLessThanOrEqual(36)
      expect(f.target.every(Number.isFinite)).toBe(true)
    }
    expect(zoneFocus('nope')).toBeNull()
  })
})

describe('device mounting pads', () => {
  const pads = devicePads(topology)

  it('one pad per free-standing device plus one for the rack that holds the three rack units', () => {
    expect(pads).toHaveLength(17 - 3 + 1)
    expect(pads.map((p) => p.id)).toContain('RACK')
    for (const id of ['APP-SRV', 'DB-SRV', 'SRV-SW3']) expect(pads.map((p) => p.id)).not.toContain(id)
  })

  it('every pad lies on a platform', () => {
    const platforms = allPlatforms().map((p) => p.rect)
    for (const pad of pads) {
      const r = { x0: pad.x - pad.w / 2, x1: pad.x + pad.w / 2, z0: pad.z - pad.d / 2, z1: pad.z + pad.d / 2 }
      expect(platforms.some((p) => inside(r, p)), pad.id).toBe(true)
    }
  })
})

describe('cable information', () => {
  it('describes both ends of all 18 links from the topology, with their real interfaces', () => {
    expect(topology.links).toHaveLength(18)
    for (const link of topology.links) {
      const ends = cableEnds(link.id, topology)
      expect(ends, link.id).not.toBeNull()
      expect(ends.a.node.id).toBe(link.a.node)
      expect(ends.a.iface).toBe(link.a.iface)
      expect(ends.b.node.id).toBe(link.b.node)
      expect(ends.b.iface).toBe(link.b.iface)
      expect(cableRole(link).length).toBeGreaterThan(20)
    }
  })

  it('L14 is the access link from the core to IPS-1 in VLAN 30, and the trunk carries VLANs 10 and 20', () => {
    const l14 = cableEnds('L14', topology)
    expect([l14.a.node.id, l14.b.node.id]).toEqual(['CORE-SW1', 'IPS-1'])
    expect(l14.kindLabel).toBe('Access VLAN 30')
    expect(cableEnds('L06', topology).kindLabel).toBe('Trunk VLAN 10, 20')
    expect(cableEnds('L99', topology)).toBeNull()
  })
})
