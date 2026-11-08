import { Block, Slab } from '../devices/parts/parts.jsx'
import { PLATES, RACKS, SLAB_THICKNESS } from '../layout.js'
import { materials } from '../materials/materials.js'

/**
 * The continuous steel-blue ground the campus stands on, and the separate off-campus island. The raised platforms,
 * pavilions, signs and balustrade that used to be slabs, captions, wall and partition live in ./campus/.
 */
export function BasePlates() {
  return (
    <group>
      {PLATES.map(({ id, center, size }) => (
        <group key={id} position={[center[0], 0, center[1]]}>
          <Block size={[size[0], 0.6, size[1]]} position={[0, -0.3, 0]} material={id === 'island' ? materials.island : materials.plate} radius={0.25} />
          <Block size={[size[0] - 1.2, 0.9, size[1] - 1.2]} position={[0, -1.05, 0]} material={materials.plateUnder} radius={0.3} />
        </group>
      ))}
    </group>
  )
}

/** An open four-post rack frame that the rack-mounted switch and servers stand in. */
function RackFrame({ rack }) {
  const [px, pz] = rack.position
  const [w, h, d] = rack.size
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

/** Every server rack of the campus. */
export function RackFrames() {
  return (
    <group>
      {RACKS.map((rack) => (
        <RackFrame key={rack.id} rack={rack} />
      ))}
    </group>
  )
}
