/**
 * Midnight Diorama colours for the 3D scene. Mirrors the CSS tokens in styles/tokens.css:
 * clay-white equipment on deep-navy zone slabs, with semantic colours kept for meaning.
 */
export const PALETTE = Object.freeze({
  void: '#0a1730',
  plate: '#13306e',
  plateEdge: '#2a5bc0',

  /** Zone slab colours, keyed by zone id from the topology. Outside is desaturated (untrusted). */
  zones: Object.freeze({
    OUTSIDE: '#2b3d66',
    PERIMETER: '#1f4a9a',
    CORE: '#18438f',
    STAFF: '#1c4fa8',
    ADMIN: '#2a4ba6',
    SECOPS: '#2e3f94',
    SERVERS: '#173e86',
  }),
  zoneFallback: '#1c3f8a',

  clay: '#e6edf8',
  clayMid: '#c9d5ea',
  trim: '#2a3550',
  ports: '#0f1628',
  rackMetal: '#9aa8c3',

  screen: '#7cc4ff',
  accent: '#4da3ff',
  cyan: '#38d6e6',
  ok: '#34d399',
  warn: '#fbbf24',
  danger: '#ff5a6a',
  sensor: '#a78bfa',

  cable: Object.freeze({
    ethernet: '#6f95e0',
    access: '#6f95e0',
    trunk: '#8fb2ff',
    mgmt: '#4a5f8f',
    span: '#a78bfa',
  }),
})
