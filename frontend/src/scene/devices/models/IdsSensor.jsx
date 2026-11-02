import { Arc, Block, Cyl, Decal, Dome } from '../parts/parts.jsx'

/** Passive IDS sensor: pedestal, body and a violet radome with a radar ring. */
export function IdsSensor() {
  return (
    <group>
      <Cyl radius={0.32} height={0.75} position={[0, 0.375, 0]} material="trim" />
      <Cyl radius={0.42} height={0.3} position={[0, 0.9, 0]} material="sensorClay" />
      <Dome radius={0.36} position={[0, 1.05, 0]} />
      <Arc radius={0.52} tube={0.025} position={[0, 1.36, 0]} rotation={[Math.PI / 2, 0, 0]} material="sensorGlow" />
      <Block size={[0.5, 0.05, 0.012]} position={[0, 0.9, 0.42]} material="dark" radius={0.005} />
      <Decal kind="radar" position={[0, 0.006, 0.72]} size={0.4} />
    </group>
  )
}
