import { Block, Cyl, Screen, Slab } from '../parts/parts.jsx'
import { screenMaterial } from '../parts/screenTextures.js'

/** A tucked-in office chair behind the desk (seat, backrest, gas post and five-spoke base). */
function Chair({ z = 0.62 }) {
  return (
    <group position={[0, 0, z]}>
      <Block size={[0.44, 0.07, 0.44]} position={[0, 0.46, 0]} material="trim" radius={0.03} />
      <Block size={[0.4, 0.4, 0.06]} position={[0, 0.72, 0.22]} material="trim" radius={0.03} />
      {[-1, 1].map((sx) => (
        <Block key={sx} size={[0.04, 0.03, 0.3]} position={[sx * 0.23, 0.62, 0.05]} material="dark" radius={0.01} />
      ))}
      <Block size={[0.04, 0.2, 0.04]} position={[0, 0.56, 0.2]} material="dark" radius={0.01} />
      <Cyl radius={0.035} height={0.3} position={[0, 0.28, 0]} material="dark" segments={10} shadow={false} />
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} rotation={[0, (i * Math.PI * 2) / 5, 0]}>
          <Slab size={[0.04, 0.035, 0.24]} position={[0, 0.08, 0.12]} material="dark" />
          <Cyl radius={0.025} height={0.04} position={[0, 0.03, 0.24]} material="dark" segments={8} shadow={false} />
        </group>
      ))}
    </group>
  )
}

/** Workstation: desk with a drawer unit, monitor on a stand showing a desktop, tower, keyboard, mouse and chair. Faces +z. */
export function Desktop() {
  return (
    <group>
      {/* desk: top, side panel, a drawer unit with handles */}
      <Block size={[1.8, 0.06, 1.1]} position={[0, 0.72, 0]} material="clayMid" radius={0.02} />
      <Block size={[0.06, 0.69, 0.95]} position={[0.8, 0.345, 0]} material="trim" radius={0.015} />
      <Block size={[0.4, 0.62, 0.9]} position={[-0.62, 0.38, 0]} material="trim" radius={0.015} />
      {[0.5, 0.3].map((y) => (
        <Slab key={y} size={[0.18, 0.02, 0.012]} position={[-0.62, y, 0.46]} material="dark" />
      ))}

      {/* monitor: bezel, picture, neck and base */}
      <Block size={[0.95, 0.58, 0.05]} position={[0, 1.2, -0.25]} material="trim" radius={0.02} />
      <Screen width={0.85} height={0.48} position={[0, 1.2, -0.222]} material={screenMaterial('desktop')} />
      <Block size={[0.07, 0.3, 0.06]} position={[0, 0.9, -0.25]} material="trim" radius={0.015} />
      <Block size={[0.42, 0.03, 0.24]} position={[0, 0.765, -0.25]} material="trim" radius={0.012} />
      <Slab size={[0.04, 0.012, 0.012]} position={[0.4, 0.925, -0.222]} material="ledOff" />

      {/* tower with a front panel, vents and a power light */}
      <Block size={[0.24, 0.52, 0.5]} position={[0.68, 1.01, -0.12]} material="clay" radius={0.03} />
      <Block size={[0.18, 0.05, 0.012]} position={[0.68, 1.2, 0.135]} material="dark" radius={0.005} />
      {[0.95, 0.9, 0.85].map((y) => (
        <Slab key={y} size={[0.14, 0.012, 0.012]} position={[0.68, y, 0.135]} material="dark" />
      ))}
      <Slab size={[0.025, 0.025, 0.012]} position={[0.74, 1.08, 0.135]} material="accentGlow" />

      {/* keyboard with three rows of keys, and a mouse */}
      <Block size={[0.55, 0.02, 0.18]} position={[-0.1, 0.77, 0.2]} material="trim" radius={0.008} />
      {[0.15, 0.2, 0.25].map((z) => (
        <Slab key={z} size={[0.5, 0.005, 0.03]} position={[-0.1, 0.782, z]} material="dark" />
      ))}
      <Block size={[0.065, 0.026, 0.1]} position={[0.36, 0.772, 0.2]} material="trim" radius={0.012} />
      {/* desk lamp, mug and a notepad */}
      <Cyl radius={0.07} height={0.02} position={[-0.72, 0.76, -0.3]} material="dark" segments={14} shadow={false} />
      <Slab size={[0.025, 0.4, 0.025]} position={[-0.72, 0.96, -0.3]} material="trim" />
      <Block size={[0.2, 0.03, 0.07]} position={[-0.64, 1.16, -0.3]} material="trim" radius={0.012} />
      <Cyl radius={0.04} height={0.09} position={[0.52, 0.8, 0.25]} material="clay" segments={12} shadow={false} />
      <Block size={[0.16, 0.012, 0.22]} position={[0.3, 0.757, 0.3]} material="clay" radius={0.004} />
      <Slab size={[0.1, 0.004, 0.012]} position={[0.3, 0.765, 0.26]} material="dark" />
      <Chair />
    </group>
  )
}
