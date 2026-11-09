import { memo, useEffect, useMemo } from 'react'

import { useStore } from '../../state/store.js'
import { liveScreenMaterial, updateLiveScreens } from '../devices/parts/liveScreens.js'

import { CampusInteraction } from './CampusInteraction.jsx'
import { screenMaterial } from '../devices/parts/screenTextures.js'
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
  useEffect(() => {
    // the monitoring screens show the loaded run up to the playhead: redrawn about twice a second, and only when it changed
    let last = ''
    const tick = () => {
      const { playback } = useStore.getState()
      const sig = `${playback.loaded}|${playback.state?.cursor ?? ''}|${Math.floor(playback.time * 2)}`
      if (sig === last) return
      last = sig
      updateLiveScreens(playback.state, playback.time)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [])

  return (
    <group name="campus">
      {campus.parts.map((p) => (
        <mesh key={p.key} geometry={p.geometry} material={p.material} castShadow={p.cast} receiveShadow={p.receive} renderOrder={p.order} raycast={NO_RAYCAST} />
      ))}
      {campus.screens.map((sc) => (
        <mesh key={sc.kind} geometry={sc.geometry} material={sc.kind.startsWith('live-') ? liveScreenMaterial(sc.kind) : screenMaterial(sc.kind)} raycast={NO_RAYCAST} />
      ))}
      <mesh geometry={campus.labels.geometry} material={campus.labels.material} raycast={NO_RAYCAST} />
      <mesh geometry={campus.signs.geometry} material={campus.signs.material} raycast={NO_RAYCAST} />
      <CampusInteraction zoneGeometry={campus.zoneGeometry} />
    </group>
  )
})
