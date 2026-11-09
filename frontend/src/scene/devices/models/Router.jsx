import { Block, Cyl, Decal, PortStrip, Slab } from '../parts/parts.jsx'

/** Edge router: a rack-style chassis on a stand with two rows of interfaces, status lights, a vent grille and three antennas. Faces +z. */
export function Router() {
  return (
    <group>
      <Block size={[1.3, 0.08, 0.8]} position={[0, 0.04, 0]} material="trim" radius={0.02} />
      <Block size={[1.2, 0.26, 0.7]} position={[0, 0.21, 0]} material="clay" radius={0.04} />
      <Block size={[1.14, 0.2, 0.02]} position={[0, 0.21, 0.356]} material="trim" radius={0.01} />
      <PortStrip width={1.0} count={8} position={[0, 0.25, 0.372]} />
      <PortStrip width={1.0} count={8} position={[0, 0.17, 0.372]} />
      {[0, 1, 2].map((i) => (
        <Slab key={i} size={[0.03, 0.03, 0.012]} position={[0.5 + i * 0.045, 0.31, 0.372]} material={i === 0 ? 'accentGlow' : 'ledOff'} />
      ))}
      {[0.12, 0.16, 0.2].map((x) => (
        <Slab key={x} size={[0.12, 0.01, 0.4]} position={[-0.5 + x * 0.4, 0.343, -0.05]} material="dark" />
      ))}
      {[-0.4, 0, 0.4].map((x, i) => (
        <Cyl
          key={x}
          radius={0.025}
          height={0.62}
          position={[x, 0.66, -0.25]}
          rotation={[0, 0, (i - 1) * -0.14]}
          material="trim"
          segments={10}
        />
      ))}
      <Decal kind="router" position={[0, 0.345, 0.05]} size={0.5} />
    </group>
  )
}
