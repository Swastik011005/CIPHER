import { useEffect } from 'react'

import { useStore } from '../state/store.js'
import { session } from './session.js'

const MAX_FRAME_S = 0.1 // a stalled tab must not make the simulation jump
const TIME_PUBLISH_MS = 100 // routine counters and the clock update at 10 Hz

/**
 * One animation-frame loop that advances the trace player by real elapsed time and mirrors it to
 * the store. Events that change what the UI shows (alerts, blocks, counters) are published in the
 * same frame they are applied; the clock readout is throttled to 10 Hz. Mount once, in AppShell.
 */
export function usePlaybackDriver() {
  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let lastPublish = 0
    let lastState = null
    let lastPlaying = false

    const loop = (now) => {
      frame = requestAnimationFrame(loop)
      const dt = Math.min((now - last) / 1000, MAX_FRAME_S)
      last = now

      const player = session.player
      if (!player) return
      player.advance(dt)

      const stateChanged = player.state !== lastState
      const playingChanged = player.playing !== lastPlaying
      if (stateChanged || playingChanged || now - lastPublish >= TIME_PUBLISH_MS) {
        lastState = player.state
        lastPlaying = player.playing
        lastPublish = now
        useStore.getState().syncPlayback()
      }
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])
}
