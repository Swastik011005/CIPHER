import * as THREE from 'three'

import { shared } from '../../geometries.js'
import { materials } from '../../materials/materials.js'
import { Block, Decal, Slab } from '../parts/parts.jsx'

const shieldEmblem = () =>
  shared('shield-emblem', () => {
    const s = new THREE.Shape()
    s.moveTo(0, 0.5)
    s.lineTo(0.38, 0.38)
    s.lineTo(0.38, 0.0)
    s.quadraticCurveTo(0.38, -0.38, 0, -0.55)
    s.quadraticCurveTo(-0.38, -0.38, -0.38, 0)
    s.lineTo(-0.38, 0.38)
    s.closePath()
    const geometry = new THREE.ExtrudeGeometry(s, {
      depth: 0.05,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      bevelSegments: 2,
      curveSegments: 12,
    })
    geometry.center()
    return geometry
  })

/**
 * Perimeter firewall: a gate in the perimeter wall with a shield emblem on the lintel and a
 * translucent barrier field across the opening. Traffic passes through along x.
 */
export function Firewall() {
  return (
    <group>
      <Block size={[0.3, 2.0, 0.4]} position={[0, 1.0, -1.4]} material="clayMid" radius={0.04} />
      <Block size={[0.3, 2.0, 0.4]} position={[0, 1.0, 1.4]} material="clayMid" radius={0.04} />
      <Block size={[0.5, 0.6, 3.4]} position={[0, 2.0, 0]} material="clay" radius={0.05} />
      <Slab size={[0.5, 0.04, 2.8]} position={[0, 0.02, 0]} material="trim" />

      {[1, -1].map((side) => (
        <mesh
          key={side}
          geometry={shieldEmblem()}
          material={materials.accentGlow}
          position={[side * 0.285, 2.0, 0]}
          rotation={[0, (side * Math.PI) / 2, 0]}
          scale={0.42}
        />
      ))}
      <Decal kind="shield" position={[0, 2.302, 0]} size={0.46} />

      <mesh material={materials.barrier} position={[0, 0.98, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.5, 1.55]} />
      </mesh>
    </group>
  )
}
