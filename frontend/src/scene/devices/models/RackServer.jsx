import { Block, Decal, DriveBays, Slab } from '../parts/parts.jsx'

/** How each server looks: bays across the front, the glyph and the colour of its status lights. */
function look(node) {
  const id = node.id
  if (node.services.some((s) => s.name === 'MySQL')) return { cols: 3, rows: 2, glyph: 'database', led: 'cyanGlow' }
  if (id === 'FILE-SRV') return { cols: 5, rows: 2, glyph: 'server', led: 'accentGlow' }
  if (id === 'EDR-MGMT-1' || id === 'ZT-POLICY-1') return { cols: 3, rows: 1, glyph: 'server', led: 'sensorGlow' }
  return { cols: 4, rows: 2, glyph: 'server', led: 'accentGlow' }
}

/** 2U rack server: bezel with handles, vents, a drive-bay grid, status lights and a glyph. */
export function RackServer({ node }) {
  const { cols, rows, glyph, led } = look(node)
  return (
    <group>
      <Block size={[0.9, 0.4, 0.8]} position={[0, 0.2, 0]} material="clay" radius={0.02} />
      <Block size={[0.86, 0.36, 0.02]} position={[0, 0.2, 0.405]} material="trim" radius={0.01} />
      {[-0.4, 0.4].map((x) => (
        <Block key={x} size={[0.03, 0.3, 0.04]} position={[x, 0.2, 0.43]} material="dark" radius={0.01} />
      ))}
      {[0.12, 0.16, 0.2, 0.24, 0.28].map((y) => (
        <Slab key={y} size={[0.16, 0.008, 0.012]} position={[-0.3, y, 0.418]} material="dark" />
      ))}
      <DriveBays cols={cols} rows={rows} cell={0.085} position={[0.0, 0.2, 0.418]} />
      {[0, 1, 2].map((i) => (
        <Slab key={i} size={[0.02, 0.02, 0.012]} position={[0.32 + i * 0.035, 0.31, 0.418]} material={i === 0 ? led : 'ledOff'} />
      ))}
      <Decal kind={glyph} position={[0.32, 0.17, 0.42]} size={0.16} face="front" />
    </group>
  )
}
