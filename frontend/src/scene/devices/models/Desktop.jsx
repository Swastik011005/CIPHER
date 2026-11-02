import { Block, Decal, Screen } from '../parts/parts.jsx'

/** Workstation: desk, monitor on a stand, tower and keyboard. Faces +z. */
export function Desktop() {
  return (
    <group>
      <Block size={[1.8, 0.06, 1.1]} position={[0, 0.72, 0]} material="clayMid" radius={0.02} />
      <Block size={[0.06, 0.69, 0.95]} position={[-0.8, 0.345, 0]} material="trim" radius={0.015} />
      <Block size={[0.06, 0.69, 0.95]} position={[0.8, 0.345, 0]} material="trim" radius={0.015} />

      <Block size={[0.95, 0.58, 0.05]} position={[0, 1.2, -0.25]} material="trim" radius={0.02} />
      <Screen width={0.85} height={0.48} position={[0, 1.2, -0.222]} />
      <Block size={[0.07, 0.3, 0.06]} position={[0, 0.9, -0.25]} material="trim" radius={0.015} />
      <Block size={[0.42, 0.03, 0.24]} position={[0, 0.765, -0.25]} material="trim" radius={0.012} />

      <Block size={[0.24, 0.52, 0.5]} position={[0.68, 1.01, -0.12]} material="clay" radius={0.03} />
      <Block size={[0.18, 0.05, 0.012]} position={[0.68, 1.2, 0.135]} material="dark" radius={0.005} />

      <Block size={[0.55, 0.02, 0.18]} position={[-0.1, 0.77, 0.2]} material="trim" radius={0.008} />
      <Decal kind="monitor" position={[-0.64, 0.754, 0.22]} size={0.34} />
    </group>
  )
}
