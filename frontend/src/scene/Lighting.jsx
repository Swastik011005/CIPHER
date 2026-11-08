import { Environment, Lightformer } from '@react-three/drei'

import { PALETTE } from './palette.js'

/**
 * Product-shot lighting: a soft sky/ground fill, one shadow-casting key light from the upper
 * left (shadows fall to the lower right, as in the reference), and a procedural studio
 * environment. The environment is generated in code, so it works offline.
 * @param {{shadows: boolean}} props
 */
export function Lighting({ shadows }) {
  return (
    <>
      <color attach="background" args={[PALETTE.void]} />
      <fog attach="fog" args={[PALETTE.void, 150, 380]} />

      <hemisphereLight args={['#bfd8ff', '#0b1a3a', 0.75]} />
      <directionalLight
        position={[-30, 60, 20]}
        intensity={2.4}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-78}
        shadow-camera-right={78}
        shadow-camera-top={78}
        shadow-camera-bottom={-78}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />

      <Environment resolution={256} frames={1} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={2} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[24, 24, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#4da3ff" position={[-14, 6, -10]} rotation-y={Math.PI / 3} scale={[18, 4, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#4da3ff" position={[14, 6, 12]} rotation-y={-Math.PI / 1.4} scale={[18, 4, 1]} />
      </Environment>
    </>
  )
}
