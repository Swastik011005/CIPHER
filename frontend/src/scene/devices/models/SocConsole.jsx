import { Block, Decal, Screen } from '../parts/parts.jsx'

/** Security operations console: desk with three monitors. Faces +z. */
export function SocConsole() {
  return (
    <group>
      <Block size={[1.8, 0.06, 0.9]} position={[0, 0.72, 0]} material="clayMid" radius={0.02} />
      <Block size={[0.06, 0.69, 0.8]} position={[-0.8, 0.345, 0]} material="trim" radius={0.015} />
      <Block size={[0.06, 0.69, 0.8]} position={[0.8, 0.345, 0]} material="trim" radius={0.015} />
      <Block size={[0.25, 0.5, 0.5]} position={[0.55, 0.45, 0]} material="clay" radius={0.03} />

      <Block size={[0.7, 0.44, 0.04]} position={[0, 1.13, -0.22]} material="trim" radius={0.015} />
      <Screen width={0.62} height={0.36} position={[0, 1.13, -0.198]} />
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.72, 1.1, -0.1]} rotation={[0, side * -0.5, 0]}>
          <Block size={[0.6, 0.4, 0.04]} material="trim" radius={0.015} />
          <Screen width={0.52} height={0.32} position={[0, 0, 0.022]} material="screenDim" />
        </group>
      ))}
      <Block size={[0.07, 0.3, 0.06]} position={[0, 0.9, -0.22]} material="trim" radius={0.015} />
      <Decal kind="log" position={[-0.6, 0.754, 0.24]} size={0.3} />
    </group>
  )
}
