import { memo, useEffect, useMemo } from 'react'

import { buildCampus } from './campusMeshes.js'

/** Decoration never takes part in picking: a click or hover passes through glass, frames, platforms and signs. */
const NO_RAYCAST = () => null

/**
 * The Smart Campus layer: raised platforms, glass-and-steel pavilions, the glass balustrade and the zone signs, drawn from
 * the topology and the campus layout. Purely visual: it is not part of the network, adds no state, and does nothing per frame.
 * @param {{topology: any}} props  The /api/topology response.
 */
export const CampusWorld = memo(function CampusWorld({ topology }) {
  const campus = useMemo(() => buildCampus(topology), [topology])
  useEffect(() => () => campus.dispose(), [campus])

  return (
    <group name="campus">
      {campus.parts.map((p) => (
        <mesh key={p.key} geometry={p.geometry} material={p.material} castShadow={p.cast} receiveShadow={p.receive} renderOrder={p.order} raycast={NO_RAYCAST} />
      ))}
      <mesh geometry={campus.signs.geometry} material={campus.signs.material} raycast={NO_RAYCAST} />
    </group>
  )
})
