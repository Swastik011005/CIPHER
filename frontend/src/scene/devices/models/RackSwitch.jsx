import { Block, Decal, PortStrip } from '../parts/parts.jsx'

/** 1U top-of-rack switch. Faces +z. */
export function RackSwitch() {
  return (
    <group>
      <Block size={[0.9, 0.2, 0.8]} position={[0, 0.1, 0]} material="clay" radius={0.015} />
      <PortStrip width={0.56} count={8} position={[0.1, 0.1, 0.406]} />
      <Decal kind="switch" position={[-0.33, 0.1, 0.408]} size={0.15} face="front" />
    </group>
  )
}
