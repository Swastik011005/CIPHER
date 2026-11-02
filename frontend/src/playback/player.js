import { applyEvent, initialState } from './reducers.js'

/** Playback speeds offered in the UI. */
export const SPEEDS = Object.freeze([0.25, 0.5, 1, 2])

/**
 * Deterministic trace player. Pure logic: it owns no timers and touches no DOM. A caller drives
 * it by calling `advance(dt)` with real elapsed seconds (the app does this from one animation-frame
 * loop), which keeps it testable and identical on every machine.
 *
 * State at time `t` is the fold of all events with `event.t <= t`. Seeking backwards rebuilds
 * from the start, so `seek(t)` always equals playing there from zero.
 */
export class Player {
  /**
   * @param {any[]} events  A complete trace, ordered by (t, seq).
   */
  constructor(events) {
    if (!Array.isArray(events) || events.length === 0) throw new Error('A trace needs at least one event')
    this.events = events
    this.duration = events[events.length - 1].t
    this.speed = 1
    this.reset()
  }

  /** Back to T+0 with nothing applied, paused. */
  reset() {
    this.state = initialState()
    this.time = 0
    this.playing = false
    this.applyUntil(0)
  }

  get finished() {
    return this.time >= this.duration && this.state.cursor >= this.events.length
  }

  /** Apply every not-yet-applied event whose time is <= t. */
  applyUntil(t) {
    while (this.state.cursor < this.events.length && this.events[this.state.cursor].t <= t) {
      this.state = applyEvent(this.state, this.events[this.state.cursor])
    }
  }

  play() {
    if (this.finished) this.reset()
    this.playing = true
  }

  pause() {
    this.playing = false
  }

  /** @param {number} speed */
  setSpeed(speed) {
    if (!SPEEDS.includes(speed)) throw new Error(`Unsupported speed ${speed}`)
    this.speed = speed
  }

  /**
   * Jump to time `t` (clamped to the run) without changing play/pause.
   * @param {number} t
   */
  seek(t) {
    const target = Math.min(Math.max(t, 0), this.duration)
    if (target < this.time) {
      this.state = initialState()
    }
    this.applyUntil(target)
    this.time = target
  }

  /**
   * Advance by `dt` real seconds at the current speed. Stops at the end of the run.
   * @param {number} dt
   */
  advance(dt) {
    if (!this.playing || dt <= 0) return
    const target = Math.min(this.time + dt * this.speed, this.duration)
    this.applyUntil(target)
    this.time = target
    if (this.time >= this.duration) this.playing = false
  }

  /** Pause and jump to the next event time. Returns false when there is none. */
  step() {
    const upcoming = this.events[this.state.cursor]
    if (!upcoming) return false
    this.playing = false
    this.seek(Math.max(upcoming.t, this.time))
    return true
  }
}

/**
 * State of a trace at time `t`, built from scratch. Used by tests and by anything that needs a
 * one-off snapshot.
 * @param {any[]} events
 * @param {number} t
 */
export function stateAt(events, t) {
  const player = new Player(events)
  player.seek(t)
  return player.state
}
