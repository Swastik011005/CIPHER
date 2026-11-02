import { DeviceNode } from './devices/DeviceNode.jsx'
import { BasePlates, PerimeterWall, RackFrame, ServerPartition, ZoneSlabs } from './environment/Environment.jsx'
import { NODE_LAYOUT } from './layout.js'
import { NetworkLinks } from './links/NetworkLinks.jsx'
import { PacketLayer } from './packets/PacketLayer.jsx'

/**
 * The whole campus, built from the backend topology: platforms, devices and cables.
 * @param {{topology: any}} props  The /api/topology response.
 */
export function NetworkWorld({ topology }) {
  return (
    <group>
      <BasePlates />
      <ZoneSlabs zones={topology.zones} subnets={topology.subnets} />
      <PerimeterWall />
      <ServerPartition />
      <RackFrame />
      {topology.nodes
        .filter((node) => NODE_LAYOUT[node.id])
        .map((node) => (
          <DeviceNode key={node.id} node={node} />
        ))}
      <NetworkLinks topology={topology} />
      <PacketLayer topology={topology} />
    </group>
  )
}
