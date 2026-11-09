import { useLayoutEffect, useRef } from 'react'

import { bakeStatic } from '../devices/bakeStatic.js'
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

/** A server cabinet frame that the rack-mounted switch and servers stand in: dark steel posts, side and back panels, rails and a cap. Open at the front. */
function RackFrame({ rack }) {
  const [px, pz] = rack.position
  const [w, h, d] = rack.size
  const top = SLAB_THICKNESS + h
  return (
    <group position={[px, 0, pz]}>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx, sz])).map(([sx, sz]) => (
        <Slab key={`${sx}${sz}`} size={[0.07, h, 0.07]} position={[(sx * w) / 2, SLAB_THICKNESS + h / 2, (sz * d) / 2]} material="trim" />
      ))}
      {[-1, 1].map((sx) => (
        <Slab key={`side${sx}`} size={[0.03, h - 0.1, d - 0.08]} position={[(sx * w) / 2, SLAB_THICKNESS + h / 2, 0]} material="trim" />
      ))}
      <Slab size={[w - 0.08, h - 0.1, 0.03]} position={[0, SLAB_THICKNESS + h / 2, -d / 2]} material="trim" />
      {[0.3, 0.55, 0.8].map((f) => (
        <Slab key={f} size={[w, 0.025, 0.03]} position={[0, SLAB_THICKNESS + h * f, d / 2]} material="rack" />
      ))}
      <Block size={[w + 0.1, 0.06, d + 0.1]} position={[0, SLAB_THICKNESS + 0.03, 0]} material="rack" radius={0.015} />
      <Block size={[w + 0.1, 0.07, d + 0.1]} position={[0, top, 0]} material="trim" radius={0.015} />
      <Slab size={[w * 0.5, 0.012, 0.025]} position={[0, top - 0.02, d / 2 + 0.03]} material="accentGlow" />
    </group>
  )
}

/** Every server rack of the campus. Static, so the frames are merged into a few draw calls once mounted. */
export function RackFrames() {
  const ref = useRef(null)
  useLayoutEffect(() => (ref.current ? bakeStatic(ref.current) : undefined), [])
  return (
    <group ref={ref}>
      {RACKS.map((rack) => (
        <RackFrame key={rack.id} rack={rack} />
      ))}
    </group>
  )
}
