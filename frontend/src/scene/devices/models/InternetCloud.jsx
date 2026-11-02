import * as THREE from 'three'

import { shared } from '../../geometries.js'
import { materials } from '../../materials/materials.js'
import { Block, Decal } from '../parts/parts.jsx'

export const CLOUD_ORIGIN = [-1.9, 5.0, 0]
const PUFFS = [
  [0, 0, 0, 1.25],
  [1.3, -0.15, 0.3, 0.95],
  [-1.3, -0.1, -0.2, 1.0],
  [0.5, 0.55, -0.5, 0.95],
  [-0.55, 0.5, 0.45, 0.85],
  [0.2, -0.3, 0.9, 0.8],
  [-0.1, -0.35, -0.95, 0.75],
]

/** Thin cylinder from `from` to `to`, used for the uplink beam. */
function Beam({ from, to, radius = 0.025 }) {
  const { position, quaternion, length } = shared('uplink-beam', () => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    return {
      length: dir.length(),
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
    }
  })
  return (
    <mesh position={position} quaternion={quaternion} material={materials.beam}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
    </mesh>
  )
}

/**
 * The abstract Internet segment: a low-poly cloud floating over a small ISP demarcation box.
 * It is a Layer 2 stand-in with no IP address.
 */
export function InternetCloud() {
  return (
    <group>
      <Block size={[0.8, 0.5, 0.8]} position={[0, 0.25, 0]} material="clayMid" radius={0.04} />
      <Decal kind="cloud" position={[0, 0.502, 0]} size={0.56} />
      <Beam from={[CLOUD_ORIGIN[0], 3.7, 0]} to={[0, 0.56, 0]} />
      <group position={CLOUD_ORIGIN}>
        {PUFFS.map(([x, y, z, r]) => (
          <mesh key={`${x}:${y}:${z}`} position={[x, y, z]} material={materials.cloud} castShadow>
            <icosahedronGeometry args={[r, 1]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
