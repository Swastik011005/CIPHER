/**
 * Midnight Diorama colours for the 3D scene. Mirrors the CSS tokens in styles/tokens.css:
 * clay-white equipment on deep-navy zone slabs, with semantic colours kept for meaning.
 */
export const PALETTE = Object.freeze({
  void: '#1d3a6e',
  /** The continuous steel-blue campus ground, and the slightly darker off-campus island. */
  plate: '#566e9a',
  island: '#4c6389',
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
    // Lighter than on the old navy slabs: the cables must stand out from the steel-blue ground.
    ethernet: '#d9e8ff',
    access: '#d9e8ff',
    trunk: '#f2f7ff',
    mgmt: '#93a9d8',
    span: '#c4b5fd',
  }),
})
