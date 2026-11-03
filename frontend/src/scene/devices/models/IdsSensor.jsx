import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'

import { session } from '../../../playback/session.js'
import { activityAt, radarSpeed } from '../activity.js'
import { Arc, Block, Cyl, Decal, Dome } from '../parts/parts.jsx'

/**
 * Passive IDS sensor: pedestal, body and a violet radome with a radar sweep. The sweep turns slowly all the
 * time and speeds up while SPAN copies are arriving (read from the trace at the playhead). It only ever
 * listens: nothing here acts on traffic.
 */
export function IdsSensor() {
  const sweep = useRef(null)
  useFrame((_, delta) => {
    const player = session.player
    const activity = player ? activityAt(player.state.nodes['IDS-1'], player.time) : 0
    // Paused: hold still, so a frozen frame shows a frozen device.
    if (sweep.current && (!player || player.playing)) sweep.current.rotation.y += Math.min(delta, 0.1) * radarSpeed(activity)
  })
  return (
    <group>
      <Cyl radius={0.32} height={0.75} position={[0, 0.375, 0]} material="trim" />
      <Cyl radius={0.42} height={0.3} position={[0, 0.9, 0]} material="sensorClay" />
      <Dome radius={0.36} position={[0, 1.05, 0]} />
      <group ref={sweep} position={[0, 1.36, 0]}>
        <Arc radius={0.52} tube={0.025} arc={Math.PI * 1.55} rotation={[Math.PI / 2, 0, 0]} material="sensorGlow" />
      </group>
      <Block size={[0.5, 0.05, 0.012]} position={[0, 0.9, 0.42]} material="dark" radius={0.005} />
      <Decal kind="radar" position={[0, 0.006, 0.72]} size={0.4} />
    </group>
  )
}
