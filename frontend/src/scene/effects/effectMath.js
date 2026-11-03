/**
 * Plain-data description of how each effect looks, plus the small animation curves. No three.js
 * here, so the numbers are unit-tested and the layer only applies them.
 */

/** Tone -> [palette key, HDR gain]. Gains above 1 make the rings glow through the bloom pass. */
export const TONE_COLOR = Object.freeze({
  ok: ['ok', 2.0],
  warn: ['warn', 2.2],
  danger: ['danger', 2.6],
  sensor: ['sensor', 2.0],
  info: ['accent', 2.0],
})

/**
 * Ring effects: floor ring radius grows from r0 to r1; `vertical` stands the ring up (firewall
 * ripple); `label` is the height above the floor for the floating text, when the effect has one (above the device's own label,
 * and staggered so labels of simultaneous effects at one device do not overlap).
 */
export const RING_STYLE = Object.freeze({
  deliver: { r0: 0.35, r1: 1.4, strength: 0.9 },
  mirror: { r0: 0.3, r1: 1.2, strength: 0.9 },
  radar: { r0: 0.5, r1: 3.2, strength: 1.0, label: 3.0 },
  'sensor-ping': { r0: 0.3, r1: 0.9, strength: 0.55 },
  'sensor-alert': { r0: 0.4, r1: 1.9, strength: 0.9, label: 3.0 },
  'ips-allow': { r0: 0.4, r1: 1.0, strength: 0.5 },
  'ips-flag': { r0: 0.4, r1: 1.7, strength: 0.9, label: 3.35 },
  'ips-block': { r0: 0.5, r1: 2.8, strength: 1.0, label: 3.7 },
  'ips-reject': { r0: 0.4, r1: 3.0, strength: 1.0, label: 3.7 },
  unblock: { r0: 0.5, r1: 2.3, strength: 0.9, label: 3.35 },
  'fw-ripple': { r0: 0.3, r1: 2.4, strength: 1.0, vertical: true, label: 3.4 },
  'acl-flash': { r0: 0.5, r1: 1.7, strength: 1.0, label: 3.0 },
})

/** Opacity of a ring at `progress` (0..1): quick rise, long fade. */
export function ringOpacity(progress, strength = 1) {
  const rise = Math.min(progress / 0.08, 1)
  return strength * rise * (1 - progress) ** 1.6
}

/** Opacity of a floating label: appears at once, stays, fades over the last third. */
export function labelOpacity(progress) {
  return progress < 0.66 ? 1 : Math.max(0, (1 - progress) / 0.34)
}

export const SHARDS = 8
export const SHARD_POOL = 12 * SHARDS

/** Deterministic pseudo-random number in [0, 1) from two integers (no Math.random: a replay must look identical). */
export function hash01(a, b) {
  let h = (Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Offset and scale of one shard of a shattering packet. Shards fly outwards, fall under gravity
 * and shrink to nothing at the end.
 * @returns {[number, number, number, number]} dx, dy, dz, scale
 */
export function shardOffset(pid, index, progress) {
  const angle = (index / SHARDS) * Math.PI * 2 + hash01(pid, index) * 0.6
  const speed = 0.7 + hash01(pid, index + 31) * 0.8
  const lift = 0.9 + hash01(pid, index + 63) * 0.7
  const r = speed * progress
  return [Math.cos(angle) * r, lift * progress - 2.2 * progress * progress, Math.sin(angle) * r, Math.max(0, 1 - progress ** 2)]
}
