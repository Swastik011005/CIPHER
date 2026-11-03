import { create } from 'zustand'

import { api } from '../api/client.js'
import { session } from '../playback/session.js'
import { initialConnection, onHealthFailure, onHealthSuccess } from './connection.js'

/**
 * Global application state (Zustand).
 *
 * Slices: connection (backend health), topology (authoritative network from the API),
 * selection (hover/selection in the 3D scene), camera (preset/focus requests),
 * settings (view options). Scene components read slices through narrow selectors.
 */

/** @typedef {'idle' | 'loading' | 'ready' | 'error'} LoadStatus */

let cameraNonce = 0

export const useStore = create((set, get) => ({
  // -- connection ---------------------------------------------------------------------
  connection: initialConnection,
  recordHealthSuccess: (health) =>
    set((s) => ({ connection: onHealthSuccess(s.connection, health, Date.now()) })),
  recordHealthFailure: (message) =>
    set((s) => ({ connection: onHealthFailure(s.connection, message, Date.now()) })),

  // -- topology -----------------------------------------------------------------------
  topology: { status: 'idle', data: null, error: null },
  /** Fetch the topology from the backend. Safe to call repeatedly; ignores concurrent calls. */
  loadTopology: async () => {
    if (get().topology.status === 'loading') return
    set((s) => ({ topology: { ...s.topology, status: 'loading', error: null } }))
    try {
      const data = await api.topology()
      set({ topology: { status: 'ready', data, error: null } })
    } catch (error) {
      set((s) => ({
        topology: { status: 'error', data: s.topology.data, error: error?.message ?? String(error) },
      }))
    }
  },

  // -- scenario run and playback ------------------------------------------------------
  /** The loaded run's identity and the engine's own summary; the trace itself lives in `session`. */
  run: { status: 'idle', meta: null, error: null, request: null },
  /** Mirror of the trace player for the UI. `state` is the reducer state at `time`. */
  playback: { loaded: false, playing: false, speed: 1, time: 0, duration: 0, finished: false, state: null },

  /** Ask the engine to simulate a scenario and load its trace into the player (paused at T+0). */
  runScenario: async (scenarioId, ipsMode, controls = [], resume = null) => {
    set({ run: { status: 'loading', meta: null, error: null, request: null } })
    try {
      const body = await api.runScenario({ scenario_id: scenarioId, ips_mode: ipsMode, controls })
      const { events, ...meta } = body
      const player = session.load(body)
      set({ run: { status: 'ready', meta, error: null, request: { scenarioId, ipsMode, controls } } })
      get().syncPlayback()
      if (resume) player.seek(resume.time) // a re-run from the playhead: everything before it is identical
      if (!resume || resume.playing) player.play()
      get().syncPlayback()
    } catch (error) {
      session.clear()
      set({
        run: { status: 'error', meta: null, error: error?.message ?? String(error), request: null },
        playback: { loaded: false, playing: false, speed: 1, time: 0, duration: 0, finished: false, state: null },
      })
    }
  },

  /**
   * Switch IPS-1's mode from the playhead onwards. The engine re-simulates the same run with a control at
   * this time; every event before it stays identical, so the scene does not change behind the playhead.
   */
  switchIpsModeFromNow: async (mode) => {
    const { run, playback } = get()
    const request = run.request
    if (!request || !playback.loaded) return
    const t = Math.round(playback.time * 100) / 100
    const controls = [...request.controls.filter((c) => !(c.type === 'ips_mode' && c.t >= t)), { type: 'ips_mode', t, mode }]
    await get().runScenario(request.scenarioId, request.ipsMode, controls, { time: t, playing: playback.playing })
  },

  /** Copy the player's state into the store. Called by the driver and after every control. */
  syncPlayback: () => {
    const player = session.player
    if (!player) return
    set((s) => ({
      playback: {
        loaded: true,
        playing: player.playing,
        speed: player.speed,
        time: player.time,
        duration: player.duration,
        finished: player.finished,
        state: player.state === s.playback.state ? s.playback.state : player.state,
      },
    }))
  },

  togglePlay: () => {
    const player = session.player
    if (!player) return
    if (player.playing) player.pause()
    else player.play()
    get().syncPlayback()
  },
  setSpeed: (speed) => {
    session.player?.setSpeed(speed)
    get().syncPlayback()
  },
  seekTo: (t) => {
    session.player?.seek(t)
    get().syncPlayback()
  },
  stepEvent: () => {
    session.player?.step()
    get().syncPlayback()
  },
  restartPlayback: () => {
    const player = session.player
    if (!player) return
    player.reset()
    player.play()
    get().syncPlayback()
  },

  // -- selection ----------------------------------------------------------------------
  selection: { selectedId: null, hoveredId: null, packetId: null },
  /** Select a device (or clear with null). Selecting a device clears any selected packet. */
  select: (id) => set((s) => ({ selection: { ...s.selection, selectedId: id, packetId: id === null ? s.selection.packetId : null } })),
  /** Select a packet by id (or clear with null). Selecting a packet clears any selected device. */
  selectPacket: (pid) => set((s) => ({ selection: { ...s.selection, packetId: pid, selectedId: pid === null ? s.selection.selectedId : null } })),
  /** Clear both selections. */
  clearSelection: () => set((s) => ({ selection: { ...s.selection, selectedId: null, packetId: null } })),
  hover: (id) =>
    set((s) => (s.selection.hoveredId === id ? s : { selection: { ...s.selection, hoveredId: id } })),

  // -- camera -------------------------------------------------------------------------
  /** A pending request for the camera rig: `{kind: 'preset' | 'focus', id, nonce}`. */
  cameraRequest: null,
  activePreset: 'overview',
  requestPreset: (id) =>
    set({ cameraRequest: { kind: 'preset', id, nonce: ++cameraNonce }, activePreset: id }),
  requestFocus: (id) =>
    set({ cameraRequest: { kind: 'focus', id, nonce: ++cameraNonce }, activePreset: null }),
  /** Called by the rig when the user moves the camera by hand. */
  clearActivePreset: () => set((s) => (s.activePreset === null ? s : { activePreset: null })),

  /** Label level of detail, driven by how much of the world the camera can see. */
  labelDetail: 'compact',
  setLabelDetail: (detail) => set((s) => (s.labelDetail === detail ? s : { labelDetail: detail })),

  // -- settings -----------------------------------------------------------------------
  settings: { quality: 'high', labels: 'all', showManagementLinks: true },
  setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),

  // -- scene visibility -----------------------------------------------------------------
  /** The persistent Canvas only renders while the Simulation page is showing it. */
  sceneVisible: false,
  /** True once the Simulation page has been shown; the 3D bundle is only loaded after that. */
  sceneEverVisible: false,
  setSceneVisible: (visible) =>
    set((s) => ({ sceneVisible: visible, sceneEverVisible: s.sceneEverVisible || visible })),
}))
