import { create } from 'zustand'

import { api } from '../api/client.js'
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

  // -- selection ----------------------------------------------------------------------
  selection: { selectedId: null, hoveredId: null },
  select: (id) => set((s) => ({ selection: { ...s.selection, selectedId: id } })),
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
