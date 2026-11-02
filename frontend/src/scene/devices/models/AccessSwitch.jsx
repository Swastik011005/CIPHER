import { Block, Decal, Slab } from '../parts/parts.jsx'

/** Floor cabinet housing the staff access switch. Faces +z. */
export function AccessSwitch() {
  return (
    <group>
      <Block size={[1.0, 0.9, 0.8]} position={[0, 0.45, 0]} material="clayMid" radius={0.04} />
      <Block size={[0.88, 0.78, 0.02]} position={[0, 0.45, 0.41]} material="trim" radius={0.015} />
      {[0.25, 0.45, 0.65].map((y) => (
        <Slab key={y} size={[0.6, 0.04, 0.012]} position={[0, y, 0.425]} material="dark" />
      ))}
      <Slab size={[0.06, 0.06, 0.012]} position={[0.34, 0.8, 0.425]} material="ledOff" />
      <Decal kind="switch" position={[0, 0.905, 0]} size={0.6} />
    </group>
  )
}
