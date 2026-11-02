import { ring } from '../../geometries.js'
import { materials } from '../../materials/materials.js'
import { Block, Cyl, Decal, PortStrip, Slab } from '../parts/parts.jsx'

/** Layer 3 core switch on a plinth ringed by two coverage rings. Faces +z. */
export function CoreSwitch() {
  return (
    <group>
      <Cyl radius={1.5} height={0.25} position={[0, 0.125, 0]} material="trim" segments={48} />
      <Block size={[1.8, 0.2, 0.9]} position={[0, 0.35, 0]} material="clay" radius={0.04} />
      <PortStrip width={1.5} count={12} position={[0, 0.35, 0.456]} />
      <Slab size={[0.22, 0.05, 0.012]} position={[0.72, 0.43, 0.456]} material="accentGlow" />
      <Decal kind="switch-l3" position={[0, 0.452, 0]} size={0.62} />

      {[1.88, 2.24].map((r) => (
        <mesh
          key={r}
          geometry={ring(r, r + 0.07, 96)}
          material={materials.coverageRing}
          position={[0, 0.015, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ))}
    </group>
  )
}
