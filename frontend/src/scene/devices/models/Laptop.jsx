import { Block, Decal, Screen } from '../parts/parts.jsx'

/** Laptop on a small table. Faces +z. */
export function Laptop() {
  return (
    <group>
      <Block size={[1.4, 0.05, 0.9]} position={[0, 0.62, 0]} material="clayMid" radius={0.02} />
      <Block size={[0.1, 0.6, 0.6]} position={[0, 0.3, 0]} material="trim" radius={0.02} />
      <Block size={[0.7, 0.03, 0.55]} position={[0, 0.02, 0]} material="trim" radius={0.012} />

      <Block size={[0.72, 0.03, 0.5]} position={[0, 0.665, 0.05]} material="clay" radius={0.012} />
      <Block size={[0.6, 0.006, 0.2]} position={[0, 0.683, 0.1]} material="dark" radius={0.003} />
      <group position={[0, 0.68, -0.2]} rotation={[-0.26, 0, 0]}>
        <Block size={[0.72, 0.5, 0.025]} position={[0, 0.25, 0]} material="trim" radius={0.012} />
        <Screen width={0.64} height={0.4} position={[0, 0.25, 0.0135]} />
      </group>
      <Decal kind="laptop" position={[0.5, 0.646, 0.3]} size={0.3} />
    </group>
  )
}
