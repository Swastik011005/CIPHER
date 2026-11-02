import { Text } from '@react-three/drei'
import { memo } from 'react'

import { Block, Slab } from '../devices/parts/parts.jsx'
import {
  PERIMETER_WALL,
  PLATES,
  RACK,
  SERVER_PARTITION,
  SLAB_THICKNESS,
  ZONE_LAYOUT,
} from '../layout.js'
import { materials, slabMaterial } from '../materials/materials.js'
import { CAPTION_FONT } from './fonts.js'

/** Base plates the campus stands on: a main plate and the floating Outside island. */
export function BasePlates() {
  return (
    <group>
      {PLATES.map(({ id, center, size }) => (
        <group key={id} position={[center[0], 0, center[1]]}>
          <Block size={[size[0], 0.6, size[1]]} position={[0, -0.3, 0]} material={materials.plate} radius={0.25} />
          <Block size={[size[0] - 1.2, 0.9, size[1] - 1.2]} position={[0, -1.05, 0]} material={materials.plateUnder} radius={0.3} />
        </group>
      ))}
    </group>
  )
}

/**
 * Raised zone platforms with their flat captions. Slabs come from the topology's zones, so a
 * zone added to the topology without a layout entry is simply not drawn (validateLayout reports it).
 * @param {{zones: any[], vlans: any[], subnets: any[]}} props
 */
export const ZoneSlabs = memo(function ZoneSlabs({ zones, subnets }) {
  return (
    <group>
      {zones.map((zone) => {
        const layout = ZONE_LAYOUT[zone.id]
        if (!layout) return null
        const subnet = zone.vlan ? subnets.find((s) => s.vlan === zone.vlan) : null
        return (
          <group key={zone.id}>
            <Block
              size={[layout.size[0], SLAB_THICKNESS, layout.size[1]]}
              position={[layout.center[0], SLAB_THICKNESS / 2, layout.center[1]]}
              material={slabMaterial(zone.id)}
              radius={0.1}
            />
            <ZoneCaption
              title={layout.caption}
              subtitle={subnet ? `VLAN ${zone.vlan} · ${subnet.cidr}` : null}
              at={layout.labelAt}
            />
          </group>
        )
      })}
    </group>
  )
})

/** Text lying flat on a slab, baseline running toward the camera's right (45 degrees). */
function ZoneCaption({ title, subtitle, at }) {
  const common = {
    font: CAPTION_FONT,
    anchorX: 'left',
    anchorY: 'middle',
    rotation: [-Math.PI / 2, 0, Math.PI / 4],
    color: '#9fc0ff',
  }
  return (
    <group position={[at[0], 0.32, at[1]]}>
      <Text {...common} fontSize={0.5} letterSpacing={0.1} fillOpacity={0.9}>
        {title}
      </Text>
      {subtitle && (
        <Text {...common} fontSize={0.32} position={[0.2, 0, 0.2]} fillOpacity={0.6}>
          {subtitle}
        </Text>
      )}
    </group>
  )
}

/** Low wall along the perimeter with an opening for the FW1 gate. */
export function PerimeterWall() {
  const { x, zFrom, zTo, gateHalf } = PERIMETER_WALL
  const segments = [
    [zFrom, -gateHalf],
    [gateHalf, zTo],
  ]
  return (
    <group>
      {segments.map(([a, b]) => (
        <Block key={a} size={[0.35, 0.8, b - a]} position={[x, SLAB_THICKNESS + 0.4, (a + b) / 2]} material={materials.wall} radius={0.06} />
      ))}
    </group>
  )
}

function GlassPanel({ from, to, axis }) {
  const length = Math.abs(to - from)
  const mid = (to + from) / 2
  const h = SERVER_PARTITION.height
  const y = SLAB_THICKNESS + h / 2
  const size = axis === 'z' ? [0.05, h, length] : [length, h, 0.05]
  const position = axis === 'z' ? [SERVER_PARTITION.x, y, mid] : [mid, y, SERVER_PARTITION.z]
  return (
    <group>
      <mesh position={position} material={materials.glass}>
        <boxGeometry args={size} />
      </mesh>
      {[from, to].map((end) => (
        <Slab
          key={end}
          size={[0.1, h, 0.1]}
          position={axis === 'z' ? [SERVER_PARTITION.x, y, end] : [end, y, SERVER_PARTITION.z]}
          material="trim"
        />
      ))}
    </group>
  )
}

/** Glass wall around the server room with a doorway where the IPS stands. */
export function ServerPartition() {
  const { z, zTo, xTo, x, doorFrom, doorTo } = SERVER_PARTITION
  return (
    <group>
      <GlassPanel axis="z" from={z} to={doorFrom} />
      <GlassPanel axis="z" from={doorTo} to={zTo} />
      <GlassPanel axis="x" from={x} to={xTo} />
    </group>
  )
}

/** Open four-post rack frame that the rack-mounted switch and servers sit in. */
export function RackFrame() {
  const [px, pz] = RACK.position
  const [w, h, d] = RACK.size
  const top = SLAB_THICKNESS + h
  return (
    <group position={[px, 0, pz]}>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx, sz])).map(([sx, sz]) => (
        <Slab key={`${sx}${sz}`} size={[0.06, h, 0.06]} position={[(sx * w) / 2, SLAB_THICKNESS + h / 2, (sz * d) / 2]} material="rack" />
      ))}
      <Block size={[w + 0.1, 0.06, d + 0.1]} position={[0, SLAB_THICKNESS + 0.03, 0]} material="rack" radius={0.015} />
      <Block size={[w + 0.1, 0.06, d + 0.1]} position={[0, top, 0]} material="rack" radius={0.015} />
    </group>
  )
}
