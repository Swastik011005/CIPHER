import { create } from 'zustand'

import { api } from '../api/client.js'
import { session } from '../playback/session.js'
import { initialConnection, onHealthFailure, onHealthSuccess } from './connection.js'

/**
 * Global application state (Zustand).
 *
 * Slices: connection (backend health), topology (authoritative network from the API),
 * selection (device and packet hover/selection in the 3D scene), zone (campus zone hover/selection),
 * cable (cable hover/selection), inspector (the device viewer), camera (preset/focus requests),
 * settings (view options). Scene components read slices through narrow selectors.
 *
 * Zone, device and cable selection are separate on purpose. A zone is presentation (a campus building) and is
 * independent of the device selection: choosing a zone never clears a selected device and vice versa. A selected
 * cable, a selected device and a selected packet exclude each other, as a device and a packet always did.
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
  runScenario: async (scenarioId, ipsMode, controls = [], resume = null, customFlows = []) => {
    set({ run: { status: 'loading', meta: null, error: null, request: null } })
    try {
      const body = await api.runScenario({ scenario_id: scenarioId, ips_mode: ipsMode, controls, custom_flows: customFlows })
      const { events, ...meta } = body
      const player = session.load(body)
      set({ run: { status: 'ready', meta, error: null, request: { scenarioId, ipsMode, controls, customFlows } } })
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
    await get().runScenario(request.scenarioId, request.ipsMode, controls, { time: t, playing: playback.playing }, request.customFlows)
  },

  /**
   * Inject one more flow at the playhead and play on. The run is re-simulated with the extra traffic;
   * everything before the flow's start is identical, so the scene does not change behind the playhead.
   */
  injectTraffic: async (flow) => {
    const { run, playback } = get()
    const request = run.request
    if (!request || !playback.loaded) return
    const customFlows = [...request.customFlows, flow]
    await get().runScenario(request.scenarioId, request.ipsMode, request.controls, { time: playback.time, playing: true }, customFlows)
  },

  /** Remove all injected traffic from the run, keeping the playhead where it is. */
  clearInjectedTraffic: async () => {
    const { run, playback } = get()
    const request = run.request
    if (!request || !playback.loaded) return
    await get().runScenario(request.scenarioId, request.ipsMode, request.controls, { time: playback.time, playing: playback.playing }, [])
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
  /** Select a device (or clear with null). Selecting a device clears any selected packet and cable. */
  select: (id) =>
    set((s) => ({
      selection: { ...s.selection, selectedId: id, packetId: id === null ? s.selection.packetId : null },
      cable: id === null || s.cable.selectedId === null ? s.cable : { ...s.cable, selectedId: null },
    })),
  /** Select a packet by id (or clear with null). Selecting a packet clears any selected device and cable. */
  selectPacket: (pid) =>
    set((s) => ({
      selection: { ...s.selection, packetId: pid, selectedId: pid === null ? s.selection.selectedId : null },
      cable: pid === null || s.cable.selectedId === null ? s.cable : { ...s.cable, selectedId: null },
    })),
  /** Clear the device, packet and cable selections (not the campus zone). */
  clearSelection: () =>
    set((s) => ({
      selection: { ...s.selection, selectedId: null, packetId: null },
      cable: s.cable.selectedId === null ? s.cable : { ...s.cable, selectedId: null },
    })),
  /** Clear everything that is selected: device, packet, cable and zone. */
  clearEverything: () =>
    set((s) => ({
      selection: { ...s.selection, selectedId: null, packetId: null },
      cable: { selectedId: null, hoveredId: null },
      zone: { ...s.zone, selectedId: null },
    })),
  hover: (id) =>
    set((s) => (s.selection.hoveredId === id ? s : { selection: { ...s.selection, hoveredId: id } })),

  // -- campus zone --------------------------------------------------------------------
  zone: { selectedId: null, hoveredId: null },
  /** Select a campus zone (or clear with null). Independent of the device selection. */
  selectZone: (id) => set((s) => (s.zone.selectedId === id ? s : { zone: { ...s.zone, selectedId: id } })),
  hoverZone: (id) => set((s) => (s.zone.hoveredId === id ? s : { zone: { ...s.zone, hoveredId: id } })),

  // -- cable ----------------------------------------------------------------------------
  cable: { selectedId: null, hoveredId: null },
  /** Select a cable by link id (or clear with null). Selecting a cable clears the device and packet selection. */
  selectCable: (id) =>
    set((s) => ({
      cable: { ...s.cable, selectedId: id },
      selection: id === null ? s.selection : { ...s.selection, selectedId: null, packetId: null },
    })),
  hoverCable: (id) => set((s) => (s.cable.hoveredId === id ? s : { cable: { ...s.cable, hoveredId: id } })),

  // -- device viewer (Stage D) ---------------------------------------------------------
  /** The device shown in the separate 3D viewer, or null while it is closed. Mounted only while open. */
  inspectorId: null,
  openInspector: (id) => {
    get().select(id)
    set({ inspectorId: id })
  },
  closeInspector: () => set((s) => (s.inspectorId === null ? s : { inspectorId: null })),

  // -- camera -------------------------------------------------------------------------
  /** A pending request for the camera rig: `{kind: 'preset' | 'focus' | 'zone', id, nonce}`. */
  cameraRequest: null,
  activePreset: 'overview',
  requestPreset: (id) =>
    set({ cameraRequest: { kind: 'preset', id, nonce: ++cameraNonce }, activePreset: id }),
  requestFocus: (id) =>
    set({ cameraRequest: { kind: 'focus', id, nonce: ++cameraNonce }, activePreset: null }),
  /** Fly the camera to a campus zone (id from CAMPUS_ZONES). */
  requestZoneFocus: (id) =>
    set({ cameraRequest: { kind: 'zone', id, nonce: ++cameraNonce }, activePreset: null }),
  /** Called by the rig when the user moves the camera by hand. */
  clearActivePreset: () => set((s) => (s.activePreset === null ? s : { activePreset: null })),

  /** Label level of detail, driven by how much of the world the camera can see. */
  labelDetail: 'compact',
  setLabelDetail: (detail) => set((s) => (s.labelDetail === detail ? s : { labelDetail: detail })),

  // -- settings -----------------------------------------------------------------------
  settings: { quality: 'high', labels: 'all', showManagementLinks: true },
  setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),

  /** Set when the app lowered the quality by itself because the frame rate stayed low (once per session). */
  qualityNotice: null,
  autoLowered: false,
  lowerQualityAutomatically: (fps) =>
    set((s) =>
      s.autoLowered || s.settings.quality === 'low'
        ? s
        : {
            autoLowered: true,
            settings: { ...s.settings, quality: 'low' },
            qualityNotice: `The frame rate stayed around ${Math.round(fps)} fps, so the scene switched to Low quality (no ambient occlusion, bloom or shadows).`,
          },
    ),
  dismissQualityNotice: () => set({ qualityNotice: null }),

  // -- scene visibility -----------------------------------------------------------------
  /** The persistent Canvas only renders while the Simulation page is showing it. */
  sceneVisible: false,
  /** True once the Simulation page has been shown; the 3D bundle is only loaded after that. */
  sceneEverVisible: false,
  setSceneVisible: (visible) =>
    set((s) => ({ sceneVisible: visible, sceneEverVisible: s.sceneEverVisible || visible })),
}))

// Debug aid, only with ?debug=1: lets a script or the console drive the app's own store (a second import of
// this module would be a different copy, with its own empty playback session).
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) window.__netsecStore = useStore
