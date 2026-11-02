/**
 * Plain-data helpers that describe a topology node: addresses, interfaces, neighbours.
 * Used by the scene labels and the device panel. No React or three.js here.
 */

/** @typedef {{id: string, label: string, type: string, zone: string, interfaces: any[], services: any[], bridge: any}} TopologyNode */

/**
 * First IP address of a node as "ip/prefix", or null when it has none (L2 switches, INET).
 * @param {TopologyNode} node
 */
export function primaryAddress(node) {
  const iface = node.interfaces.find((i) => i.ip)
  return iface ? `${iface.ip}/${iface.prefix}` : null
}

/** Text shown on the label's second line. */
export function labelAddress(node) {
  const address = primaryAddress(node)
  if (address) return address
  return node.type === 'segment' ? 'L2 segment · no IP' : 'L2 · no IP'
}

/**
 * Human-readable L2 attachment of a link as seen from either end.
 * @param {{kind: string, vlan: number | null, trunk_vlans: number[] | null}} link
 */
export function linkVlanLabel(link) {
  switch (link.kind) {
    case 'access':
      return `Access VLAN ${link.vlan}`
    case 'mgmt':
      return `Management VLAN ${link.vlan}`
    case 'trunk':
      return `Trunk VLAN ${link.trunk_vlans.join(', ')}`
    case 'span':
      return 'SPAN destination'
    default:
      return 'Untagged'
  }
}

/**
 * Interfaces of a node with their addresses and L2 attachment.
 * @param {TopologyNode} node
 * @param {{links: any[]}} topology
 */
export function describeInterfaces(node, topology) {
  return node.interfaces.map((iface) => {
    const link = iface.kind === 'physical'
      ? topology.links.find(
          (l) => (l.a.node === node.id && l.a.iface === iface.name) || (l.b.node === node.id && l.b.iface === iface.name),
        )
      : null
    let attachment
    if (iface.kind === 'svi') attachment = `SVI VLAN ${iface.vlan}`
    else if (node.bridge?.ports.includes(iface.name)) attachment = `Bridged VLAN ${node.bridge.vlan}`
    else attachment = link ? linkVlanLabel(link) : 'Not connected'
    return {
      name: iface.name,
      address: iface.ip ? `${iface.ip}/${iface.prefix}` : null,
      gateway: iface.gateway ?? null,
      attachment,
      linkId: link?.id ?? null,
    }
  })
}

/**
 * Directly connected devices.
 * @param {TopologyNode} node
 * @param {{links: any[], nodes: TopologyNode[]}} topology
 */
export function neighboursOf(node, topology) {
  const byId = new Map(topology.nodes.map((n) => [n.id, n]))
  return topology.links
    .filter((l) => l.a.node === node.id || l.b.node === node.id)
    .map((l) => {
      const local = l.a.node === node.id ? l.a : l.b
      const peer = l.a.node === node.id ? l.b : l.a
      return {
        linkId: l.id,
        peer: byId.get(peer.node),
        localIface: local.iface,
        peerIface: peer.iface,
        label: linkVlanLabel(l),
        kind: l.kind,
      }
    })
}

/**
 * What the device does in the security design, stated plainly. Stage 1 draws the devices and
 * routes traffic, but the firewall policy, IDS detection and IPS prevention are not built yet.
 * @param {TopologyNode} node
 * @returns {{tone: 'sensor' | 'accent' | 'neutral', title: string, text: string} | null}
 */
export function securityRole(node) {
  switch (node.type) {
    case 'ids':
      return {
        tone: 'sensor',
        title: 'Passive sensor',
        text: 'Receives SPAN copies of traffic entering CORE-SW1 and will raise alerts. It never forwards, drops or blocks traffic. Detection is not implemented yet.',
      }
    case 'ips':
      return {
        tone: 'accent',
        title: 'Inline prevention point',
        text: 'Sits in the path of server traffic, so it is the only sensor that can block. For now it forwards transparently; detection and prevention are not implemented yet.',
      }
    case 'firewall':
      return {
        tone: 'accent',
        title: 'Static policy enforcement',
        text: 'Will permit or deny by address and port. For now it routes traffic without applying a policy.',
      }
    default:
      return null
  }
}
