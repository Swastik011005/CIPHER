/**
 * Plain-data description of a cable (a link of the topology) for the cable panel. No React or three.js.
 */
import { linkVlanLabel, primaryAddress } from './deviceInfo.js'

/**
 * Both ends of a link, from the topology only.
 * @param {string} linkId
 * @param {{nodes: any[], links: any[]}} topology
 * @returns {{link: any, kindLabel: string, a: {node: any, iface: string, address: string | null}, b: {node: any, iface: string, address: string | null}} | null}
 */
export function cableEnds(linkId, topology) {
  const link = topology.links.find((l) => l.id === linkId)
  if (!link) return null
  const end = (e) => {
    const node = topology.nodes.find((n) => n.id === e.node)
    if (!node) return null
    const iface = node.interfaces.find((i) => i.name === e.iface)
    const address = iface?.ip ? `${iface.ip}/${iface.prefix}` : null
    return { node, iface: e.iface, address: address ?? (iface ? null : primaryAddress(node)) }
  }
  const a = end(link.a)
  const b = end(link.b)
  return a && b ? { link, kindLabel: linkVlanLabel(link), a, b } : null
}

/** One sentence on what a link kind is in this design. */
export function cableRole(link) {
  switch (link.kind) {
    case 'trunk':
      return `An 802.1Q trunk carrying VLAN ${link.trunk_vlans.join(' and ')} between the two switches. It is drawn as two parallel cables.`
    case 'access':
      return `An access link: untagged frames belonging to VLAN ${link.vlan}.`
    case 'mgmt':
      return `A management link in VLAN ${link.vlan}, the Security VLAN. It carries management traffic to the device, not the monitored data path.`
    case 'span':
      return 'The SPAN (mirror) port: IDS-1 receives copies of the frames entering CORE-SW1. It only listens and never sends traffic back.'
    default:
      return 'A point-to-point Ethernet link with no VLAN tag.'
  }
}
