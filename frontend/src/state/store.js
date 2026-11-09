import { interruptedLines } from '../features/simulation/cliTimeline.js'
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
  runScenario: async (scenarioId, ipsMode, controls = [], resume = null, customFlows = [], options = {}) => {
    get().freezeCli() // a terminal that was still printing keeps what it had printed: its run is being replaced
    set({ run: { status: 'loading', meta: null, error: null, request: null } })
    try {
      const body = await api.runScenario({ scenario_id: scenarioId, ips_mode: ipsMode, controls, custom_flows: customFlows, ...(options.commitState ? { commit_state: true } : {}), ...(options.scriptedOperator ? { scripted_operator: true } : {}) })
      const { events, ...meta } = body
      const player = session.load(body)
      set({ run: { status: 'ready', meta, error: null, request: { scenarioId, ipsMode, controls, customFlows } } })
      get().syncPlayback()
      if (options.commitState) get().loadSecurityState()
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

  // -- campus security: presentation scenarios, security state, endpoint CLI ---------------
  presentation: { status: 'idle', items: [], error: null },
  loadPresentation: async () => {
    if (get().presentation.status === 'loading') return
    set((s) => ({ presentation: { ...s.presentation, status: 'loading', error: null } }))
    try {
      set({ presentation: { status: 'ready', items: await api.presentation(), error: null } })
    } catch (error) {
      set((s) => ({ presentation: { status: s.presentation.items.length ? 'ready' : 'error', items: s.presentation.items, error: error?.message ?? String(error) } }))
    }
  },
  /** The server's security state: isolated endpoints, trust, roles, revoked permissions and cumulative rule counters. */
  securityState: null,
  loadSecurityState: async () => {
    try {
      set({ securityState: await api.securityState() })
    } catch {
      /* offline: the last known state stays on screen */
    }
  },
  /** An operator action on the server's security state (isolate, restore, trust, role, revoke, grant, reset). */
  securityAction: async (body) => {
    const state = await api.stateAction(body)
    set({ securityState: state })
    return state
  },
  /**
   * Isolate or restore an endpoint. With a run loaded this is a control at the playhead (the engine re-simulates from there and
   * everything before it stays identical) and the result is committed to the server state; with no run it changes the state only.
   */
  setEndpointIsolation: async (node, action) => {
    const { run, playback } = get()
    const request = run.request
    if (request && playback.loaded && request.scenarioId !== 'CLI') {
      const t = Math.round(playback.time * 100) / 100
      const controls = [...request.controls, { type: 'endpoint', t, node, action }]
      await get().runScenario(request.scenarioId, request.ipsMode, controls, { time: t, playing: playback.playing }, request.customFlows, { commitState: true })
      return
    }
    await get().securityAction({ action, node })
  },
  /** Reset the server's security state to the shipped one and clear the loaded run. */
  resetSecurity: async () => {
    session.clear()
    set({
      run: { status: 'idle', meta: null, error: null, request: null },
      playback: { loaded: false, playing: false, speed: 1, time: 0, duration: 0, finished: false, state: null },
    })
    await get().securityAction({ action: 'reset' })
  },
  /** Endpoint CLI sessions: the lines of each endpoint's terminal, so they survive switching devices. */
  cli: {},
  /** Run one command in an endpoint's CLI. The output comes from the backend; with `animate` the packets replay in 3D. */
  /** The terminal command whose packets are being replayed: {node, token}. Its lines print as the playhead reaches them. */
  cliLive: null,
  cliToken: 0,
  /** Stop the printing of the terminal command whose run is loaded: the lines printed so far stay, the rest never appear. */
  freezeCli: () => {
    const { cliLive, cli, playback } = get()
    if (!cliLive) return
    const entries = cli[cliLive.node] ?? []
    const index = entries.findIndex((e) => e.token === cliLive.token)
    if (index < 0) {
      set({ cliLive: null })
      return
    }
    const entry = entries[index]
    if (entry.frozen || playback.finished) {
      set({ cliLive: null })
      return
    }
    const time = playback.time
    const packets = Object.values(playback.state?.packets ?? {})
    const sent = packets.filter((p) => p.mirrorOf == null && p.proto === 'icmp' && p.icmp?.type === 8).length
    const printed = entry.lines.filter((_, i) => entry.timeline[i] <= time + 1e-9)
    const received = printed.filter((line) => line.startsWith('Reply from')).length
    const frozen = interruptedLines(entry, time, { sent, received })
    const next = entries.map((e, i) => (i === index ? { ...e, frozen, ok: false } : e))
    set((st) => ({ cli: { ...st.cli, [cliLive.node]: next }, cliLive: null }))
  },
  /** The operator stops the command (Ctrl+C or the Stop button): its run is unloaded, nothing keeps animating, no counter is left behind. */
  cancelCli: () => {
    get().freezeCli()
    session.clear()
    set({
      run: { status: 'idle', meta: null, error: null, request: null },
      playback: { loaded: false, playing: false, speed: 1, time: 0, duration: 0, finished: false, state: null },
      cliLive: null,
    })
  },
  runCli: async (node, command, animate = true) => {
    const input = command.trim()
    const push = (entry) => set((s) => ({ cli: { ...s.cli, [node]: [...(s.cli[node] ?? []), entry].slice(-80) } }))
    if (input === '') return
    try {
      const result = await api.cliExec({ node, command: input, ips_mode: get().settings.cliIpsMode ?? 'enforce', animate })
      if (result.clear) {
        set((s) => ({ cli: { ...s.cli, [node]: [] } }))
        return
      }
      get().freezeCli()
      const timed = Boolean(result.run && animate && Array.isArray(result.timeline) && result.timeline.length === result.lines.length)
      const token = get().cliToken + 1
      set({ cliToken: token })
      push({ input, lines: result.lines, ok: result.ok, decision: result.decision, timeline: timed ? result.timeline : null, animated: timed, token })
      if (result.run && animate) {
        const { events, ...meta } = result.run
        const player = session.load(result.run)
        set({ run: { status: 'ready', meta, error: null, request: { scenarioId: 'CLI', ipsMode: meta.ips_mode, controls: [], customFlows: [] } }, cliLive: timed ? { node, token } : null })
        get().syncPlayback()
        player.play()
        get().syncPlayback()
      }
      get().loadSecurityState()
    } catch (error) {
      push({ input, lines: [error?.message ?? String(error)], ok: false, decision: {} })
    }
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
