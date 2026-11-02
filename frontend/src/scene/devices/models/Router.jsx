import { Block, Cyl, Decal, PortStrip } from '../parts/parts.jsx'

/** Edge router: low chassis on a stand with three antennas. Faces +z. */
export function Router() {
  return (
    <group>
      <Block size={[1.3, 0.08, 0.8]} position={[0, 0.04, 0]} material="trim" radius={0.02} />
      <Block size={[1.2, 0.22, 0.7]} position={[0, 0.19, 0]} material="clay" radius={0.04} />
      <PortStrip width={1.0} count={8} position={[0, 0.19, 0.356]} />
      {[-0.4, 0, 0.4].map((x, i) => (
        <Cyl
          key={x}
          radius={0.025}
          height={0.62}
          position={[x, 0.62, -0.25]}
          rotation={[0, 0, (i - 1) * -0.14]}
          material="trim"
          segments={10}
        />
      ))}
      <Decal kind="router" position={[0, 0.3, 0.05]} size={0.5} />
    </group>
  )
}
