import { Player } from './player.js'

/**
 * The one active trace player. It lives outside React so the animation loop and the 3D scene can
 * read it every frame without causing re-renders; the store mirrors the parts the UI displays.
 */
let player = null

export const session = {
  /** @returns {Player | null} */
  get player() {
    return player
  },

  /** Start a new run from a `/api/sim/run` response. Replaces any previous run. */
  load(run) {
    player = new Player(run.events)
    return player
  },

  clear() {
    player = null
  },
}
