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

/** One face of an appliance (the +x or -x side): a dark faceplate with port rows, vents and status lights. `side` is 1 or -1. */
function Faceplate({ side, y, h, depth, ports = 2, led = 'accentGlow' }) {
  const x = side * 0.356
  return (
    <group>
      <Slab size={[0.012, h, depth]} position={[x, y, 0]} material="dark" />
      {Array.from({ length: ports }, (_, r) => (
        <Slab key={r} size={[0.014, 0.05, depth * 0.78]} position={[side * 0.358, y + h * 0.18 - r * 0.1, 0]} material="ledOff" />
      ))}
      {[-0.3, -0.18, -0.06].map((dz, i) => (
        <Slab key={dz} size={[0.014, 0.035, 0.035]} position={[side * 0.358, y - h * 0.32, dz * depth * 1.2]} material={i === 0 ? led : 'ledOff'} />
      ))}
      {[0.28, 0.2, 0.12].map((dz) => (
        <Slab key={dz} size={[0.014, 0.012, depth * 0.32]} position={[side * 0.358, y - h * 0.32, depth * dz]} material="trim" />
      ))}
    </group>
  )
}

/**
 * Perimeter firewall FW1: a security gateway made of three appliances. Two tower appliances stand either side of the opening and a
 * header appliance spans it, each with a faceplate of interface rows, vents and status lights on both faces (traffic crosses along x);
 * a shield emblem sits on the header, and a translucent barrier field fills the opening.
 */
export function Firewall() {
  return (
    <group>
      <Slab size={[0.8, 0.06, 3.4]} position={[0, 0.03, 0]} material="rack" />
      {[-1, 1].map((sz) => (
        <group key={sz} position={[0, 0, sz * 1.4]}>
          <Block size={[0.7, 1.9, 0.62]} position={[0, 0.98, 0]} material="clayMid" radius={0.04} />
          <Block size={[0.74, 0.08, 0.66]} position={[0, 1.96, 0]} material="trim" radius={0.02} />
          {[1, -1].map((side) => (
            <Faceplate key={side} side={side} y={1.0} h={1.5} depth={0.52} ports={3} />
          ))}
        </group>
      ))}
      <Block size={[0.7, 0.5, 3.5]} position={[0, 2.18, 0]} material="clay" radius={0.05} />
      {[1, -1].map((side) => (
        <group key={side} position={[0, 2.18 - 0.5 + 0.5, 0]}>
          <Faceplate side={side} y={0} h={0.38} depth={3.2} ports={1} />
        </group>
      ))}
      {[1, -1].map((side) => (
        <mesh
          key={side}
          geometry={shieldEmblem()}
          material={materials.accentGlow}
          position={[side * 0.37, 2.18, 0]}
          rotation={[0, (side * Math.PI) / 2, 0]}
          scale={0.34}
        />
      ))}
      <Decal kind="shield" position={[0, 2.436, 0]} size={0.46} />

      <mesh material={materials.barrier} position={[0, 0.98, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.5, 1.55]} />
      </mesh>
    </group>
  )
}
