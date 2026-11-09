import { Block, Cyl, Decal, Screen, Slab } from '../parts/parts.jsx'
import { liveScreenMaterial } from '../parts/liveScreens.js'

/** Security operations workstation: a desk with three monitors showing dashboards, a keyboard, a mouse and an operator chair. Faces +z. */
export function SocConsole({ node }) {
  const centre = node?.id === 'SEC-LOG' ? 'live-alerts' : 'live-stats'
  return (
    <group>
      <Block size={[1.8, 0.06, 0.9]} position={[0, 0.72, 0]} material="clayMid" radius={0.02} />
      <Block size={[0.06, 0.69, 0.8]} position={[-0.8, 0.345, 0]} material="trim" radius={0.015} />
      <Block size={[0.06, 0.69, 0.8]} position={[0.8, 0.345, 0]} material="trim" radius={0.015} />
      <Block size={[0.25, 0.5, 0.5]} position={[0.55, 0.45, 0]} material="clay" radius={0.03} />
      <Slab size={[0.02, 0.02, 0.012]} position={[0.62, 0.62, 0.255]} material="accentGlow" />

      <Block size={[0.7, 0.44, 0.04]} position={[0, 1.13, -0.22]} material="trim" radius={0.015} />
      <Screen width={0.62} height={0.36} position={[0, 1.13, -0.198]} material={liveScreenMaterial(centre)} />
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.72, 1.1, -0.1]} rotation={[0, side * -0.5, 0]}>
          <Block size={[0.6, 0.4, 0.04]} material="trim" radius={0.015} />
          <Screen width={0.52} height={0.32} position={[0, 0, 0.022]} material={liveScreenMaterial(side < 0 ? 'live-endpoints' : 'live-traffic')} />
        </group>
      ))}
      <Block size={[0.07, 0.3, 0.06]} position={[0, 0.9, -0.22]} material="trim" radius={0.015} />
      <Block size={[0.4, 0.03, 0.22]} position={[0, 0.765, -0.22]} material="trim" radius={0.012} />
      <Block size={[0.5, 0.02, 0.17]} position={[-0.05, 0.77, 0.2]} material="trim" radius={0.008} />
      {[0.15, 0.2, 0.25].map((z) => (
        <Slab key={z} size={[0.45, 0.005, 0.03]} position={[-0.05, 0.782, z]} material="dark" />
      ))}
      <Block size={[0.065, 0.026, 0.1]} position={[0.32, 0.772, 0.2]} material="trim" radius={0.012} />
      <Decal kind="log" position={[-0.65, 0.754, 0.26]} size={0.24} />

      <group position={[0, 0, 0.66]}>
        <Block size={[0.46, 0.07, 0.46]} position={[0, 0.46, 0]} material="trim" radius={0.03} />
        <Block size={[0.42, 0.46, 0.06]} position={[0, 0.76, 0.22]} material="trim" radius={0.03} />
        <Cyl radius={0.035} height={0.3} position={[0, 0.28, 0]} material="dark" segments={10} shadow={false} />
        <Cyl radius={0.22} height={0.03} position={[0, 0.05, 0]} material="dark" segments={5} shadow={false} />
      </group>
    </group>
  )
}
