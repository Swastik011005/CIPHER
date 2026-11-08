import { DeviceNode } from './devices/DeviceNode.jsx'
import { EffectsLayer } from './effects/EffectsLayer.jsx'
import { CampusWorld } from './campus/CampusWorld.jsx'
import { BasePlates, RackFrames } from './environment/Environment.jsx'
import { NODE_LAYOUT } from './layout.js'
import { NetworkLinks } from './links/NetworkLinks.jsx'
import { PacketLayer } from './packets/PacketLayer.jsx'

/**
 * The whole campus, built from the backend topology: ground, campus layer (platforms, pavilions, signs), devices and cables.
 * @param {{topology: any}} props  The /api/topology response.
 */
export function NetworkWorld({ topology }) {
  return (
    <group>
      <BasePlates />
      <CampusWorld topology={topology} />
      <RackFrames />
      {topology.nodes
        .filter((node) => NODE_LAYOUT[node.id])
        .map((node) => (
          <DeviceNode key={node.id} node={node} />
        ))}
      <NetworkLinks topology={topology} />
      <PacketLayer topology={topology} />
      <EffectsLayer topology={topology} />
    </group>
  )
}
