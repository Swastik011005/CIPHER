import { Arc, Block, Decal, Slab } from '../parts/parts.jsx'

/**
 * Inline IPS: an inspection arch standing over the cable run at the server-room door, with an
 * appliance on top. Traffic passes through the arch along x.
 */
export function IpsGate() {
  return (
    <group>
      <Arc radius={1.0} tube={0.1} arc={Math.PI} rotation={[0, Math.PI / 2, 0]} material="clayMid" shadow />
      {[-1, 1].map((z) => (
        <Block key={z} size={[0.36, 0.1, 0.36]} position={[0, 0.05, z * 1.0]} material="trim" radius={0.02} />
      ))}
      {[-0.18, 0, 0.18].map((x) => (
        <Arc
          key={x}
          radius={0.84}
          tube={0.02}
          arc={Math.PI}
          position={[x, 0, 0]}
          rotation={[0, Math.PI / 2, 0]}
          material="cyanGlow"
        />
      ))}
      <Block size={[0.55, 0.24, 0.9]} position={[0, 1.22, 0]} material="clay" radius={0.03} />
      <Slab size={[0.012, 0.05, 0.5]} position={[0.282, 1.22, 0]} material="accentGlow" />
      <Decal kind="shield-gate" position={[0, 1.343, 0]} size={0.44} />
    </group>
  )
}
