import { ring } from '../../geometries.js'
import { materials } from '../../materials/materials.js'
import { Block, Cyl, Decal, PortStrip, Slab } from '../parts/parts.jsx'

/** Layer 3 core switch on a stepped round plinth with two coverage rings: two rows of ports, status lights and uplink modules. Faces +z. */
export function CoreSwitch() {
  return (
    <group>
      <Cyl radius={1.6} height={0.1} position={[0, 0.05, 0]} material="rack" segments={64} />
      <Cyl radius={1.4} height={0.18} position={[0, 0.19, 0]} material="trim" segments={64} />
      <Block size={[1.8, 0.26, 0.9]} position={[0, 0.41, 0]} material="clay" radius={0.04} />
      <Block size={[1.74, 0.2, 0.02]} position={[0, 0.41, 0.455]} material="trim" radius={0.01} />
      <PortStrip width={1.5} count={12} position={[0, 0.465, 0.47]} />
      <PortStrip width={1.5} count={12} position={[0, 0.375, 0.47]} />
      {[0, 1, 2, 3].map((i) => (
        <Slab key={i} size={[0.05, 0.03, 0.012]} position={[0.62 + i * 0.07, 0.52, 0.47]} material={i === 0 ? 'accentGlow' : 'ledOff'} />
      ))}
      {[-1, 1].map((x) => (
        <Block key={x} size={[0.16, 0.2, 0.04]} position={[x * 0.84, 0.41, 0.47]} material="dark" radius={0.01} />
      ))}
      <Decal kind="switch-l3" position={[0, 0.542, 0]} size={0.62} />

      {[1.88, 2.24].map((r) => (
        <mesh
          key={r}
          geometry={ring(r, r + 0.05, 96)}
          material={materials.coverageRing}
          position={[0, 0.015, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ))}
    </group>
  )
}
