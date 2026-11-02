import { describe, expect, it } from 'vitest'

import { describeInterfaces, labelAddress, linkVlanLabel, neighboursOf, primaryAddress, securityRole } from './deviceInfo.js'
import { loadBackendTopology } from './testSupport.js'

const topology = loadBackendTopology()
const node = (id) => topology.nodes.find((n) => n.id === id)

describe('device information', () => {
  it('shows an address for routed devices and "no IP" for layer 2 ones', () => {
    expect(primaryAddress(node('PC-1'))).toBe('10.0.10.11/24')
    expect(labelAddress(node('CORE-SW1'))).toBe('10.255.1.2/30')
    expect(labelAddress(node('ACC-SW2'))).toBe('L2 · no IP')
    expect(labelAddress(node('INET'))).toBe('L2 segment · no IP')
  })

  it('labels the Layer 2 attachment of each kind of link', () => {
    const byId = (id) => topology.links.find((l) => l.id === id)
    expect(linkVlanLabel(byId('L06'))).toBe('Trunk VLAN 10, 20')
    expect(linkVlanLabel(byId('L07'))).toBe('Access VLAN 10')
    expect(linkVlanLabel(byId('L11'))).toBe('SPAN destination')
    expect(linkVlanLabel(byId('L12'))).toBe('Management VLAN 99')
    expect(linkVlanLabel(byId('L05'))).toBe('Untagged')
  })

  it('describes IPS-1: bridged data ports without an IP and a management address', () => {
    const rows = describeInterfaces(node('IPS-1'), topology)
    const row = (name) => rows.find((r) => r.name === name)
    expect(row('in')).toMatchObject({ address: null, attachment: 'Bridged VLAN 30' })
    expect(row('out')).toMatchObject({ address: null, attachment: 'Bridged VLAN 30' })
    expect(row('mgmt')).toMatchObject({ address: '10.0.99.11/24', attachment: 'Management VLAN 99' })
  })

  it('describes the core switch SVIs and trunk', () => {
    const rows = describeInterfaces(node('CORE-SW1'), topology)
    expect(rows.find((r) => r.name === 'Vlan30')).toMatchObject({ address: '10.0.30.1/24', attachment: 'SVI VLAN 30' })
    expect(rows.find((r) => r.name === 'Gi0/2').attachment).toBe('Trunk VLAN 10, 20')
  })

  it('lists direct neighbours with the interface on each end', () => {
    const near = neighboursOf(node('IDS-1'), topology)
    expect(near.map((n) => n.linkId).sort()).toEqual(['L11', 'L12'])
    expect(near.every((n) => n.peer.id === 'CORE-SW1')).toBe(true)
    expect(neighboursOf(node('APP-SRV'), topology).map((n) => n.peer.id)).toEqual(['SRV-SW3'])
  })

  it('states the security roles honestly: the IDS is passive, nothing is enforced yet', () => {
    const ids = securityRole(node('IDS-1'))
    expect(ids.title).toMatch(/passive/i)
    expect(ids.text).toMatch(/never forwards, drops or blocks/i)
    expect(ids.text).toMatch(/not implemented yet/i)
    expect(securityRole(node('IPS-1')).text).toMatch(/only sensor that can block/i)
    expect(securityRole(node('FW1')).text).toMatch(/without applying a policy/i)
    expect(securityRole(node('PC-1'))).toBeNull()
  })
})
