import { Block, Decal, DriveBays } from '../parts/parts.jsx'

/** 2U rack server with a drive-bay grid. The glyph is a database cylinder when the node serves MySQL. */
export function RackServer({ node }) {
  const isDatabase = node.services.some((s) => s.name === 'MySQL')
  return (
    <group>
      <Block size={[0.9, 0.4, 0.8]} position={[0, 0.2, 0]} material="clay" radius={0.02} />
      <DriveBays cols={4} rows={2} cell={0.1} position={[-0.17, 0.2, 0.406]} />
      <Decal kind={isDatabase ? 'database' : 'server'} position={[0.3, 0.2, 0.408]} size={0.26} face="front" />
    </group>
  )
}
