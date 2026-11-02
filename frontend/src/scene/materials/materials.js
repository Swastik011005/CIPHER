import * as THREE from 'three'

import { PALETTE } from '../palette.js'

/**
 * Shared material singletons. Every mesh of a kind reuses one material instance, so the whole
 * scene compiles a handful of shader programs and changes state rarely.
 */

const standard = (color, roughness, metalness = 0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })

/** A flat colour pushed above 1.0 so selective bloom picks it up (tone mapping is applied last). */
const glow = (color, strength, extra = {}) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), toneMapped: false, ...extra })

export const materials = {
  // Matte clay equipment (product-shot look)
  clay: standard(PALETTE.clay, 0.72),
  clayMid: standard(PALETTE.clayMid, 0.75),
  trim: standard(PALETTE.trim, 0.55, 0.2),
  dark: standard(PALETTE.ports, 0.6, 0.1),
  rack: standard(PALETTE.rackMetal, 0.45, 0.6),
  sensorClay: standard('#d4cbf7', 0.7),

  // Emissive surfaces
  screen: glow(PALETTE.screen, 1.5),
  screenDim: glow('#3d6fb3', 1.1),
  accentGlow: glow(PALETTE.accent, 2.2),
  cyanGlow: glow(PALETTE.cyan, 1.6),
  sensorGlow: glow(PALETTE.sensor, 2.0),
  ledOff: glow('#2a3b66', 1.0),

  // Translucent surfaces
  glass: standard('#9cc8ff', 0.1, 0, { transparent: true, opacity: 0.13, depthWrite: false }),
  radome: standard('#bda9ff', 0.25, 0, {
    transparent: true,
    opacity: 0.5,
    emissive: new THREE.Color(PALETTE.sensor).multiplyScalar(0.35),
  }),
  barrier: new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.cyan).multiplyScalar(0.9),
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  }),
  coverageRing: glow(PALETTE.cyan, 1.2, { transparent: true, opacity: 0.55, depthWrite: false }),
  beam: glow(PALETTE.accent, 1.0, { transparent: true, opacity: 0.35, depthWrite: false }),

  cloud: standard('#f1f6ff', 0.9, 0, { flatShading: true }),
  plate: standard(PALETTE.plate, 0.85),
  plateUnder: standard('#0b1f4a', 0.9),
  wall: standard(PALETTE.clayMid, 0.8),
}

const slabCache = new Map()

/** Slab material for a zone. Cached per colour. */
export function slabMaterial(zoneId) {
  const color = PALETTE.zones[zoneId] ?? PALETTE.zoneFallback
  if (!slabCache.has(color)) slabCache.set(color, standard(color, 0.9))
  return slabCache.get(color)
}

/** Floor status ring under each device. Idle until a simulation gives it something to show. */
export const ringMaterials = {
  idle: new THREE.MeshBasicMaterial({ color: '#2a5bc0', transparent: true, opacity: 0.75, toneMapped: false, depthWrite: false }),
  hover: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent).multiplyScalar(1.4), toneMapped: false, depthWrite: false }),
  selected: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent).multiplyScalar(2.4), toneMapped: false, depthWrite: false }),
  /** The IPS is currently blocking this device's address. */
  blocked: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger).multiplyScalar(2.2), toneMapped: false, depthWrite: false }),
}

/** Cable materials by link kind. */
export const cableMaterials = {
  ethernet: standard(PALETTE.cable.ethernet, 0.45, 0.1, { emissive: new THREE.Color(PALETTE.cable.ethernet).multiplyScalar(0.18) }),
  access: standard(PALETTE.cable.access, 0.45, 0.1, { emissive: new THREE.Color(PALETTE.cable.access).multiplyScalar(0.18) }),
  trunk: standard(PALETTE.cable.trunk, 0.4, 0.1, { emissive: new THREE.Color(PALETTE.cable.trunk).multiplyScalar(0.25) }),
  mgmt: standard(PALETTE.cable.mgmt, 0.5, 0.1, { emissive: new THREE.Color(PALETTE.cable.mgmt).multiplyScalar(0.2) }),
}
