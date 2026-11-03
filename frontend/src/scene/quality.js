/**
 * Automatic fall-back from High to Low quality on a slow GPU.
 *
 * Rev 3 asks for >= 30 fps on the Low preset of an integrated GPU, and a measured Intel UHD runs the High
 * preset at about 14 fps, so the app should not leave a slow machine there. The decision is plain data:
 * `shouldLowerQuality` looks at the last few one-second frame-rate samples.
 *
 * A page that is hidden or covered by another window is throttled by the browser to about one frame a
 * second. That says nothing about the GPU, so samples below `THROTTLED_BELOW` never count as "slow".
 */

/** Consecutive slow one-second samples before switching. */
export const SLOW_SAMPLES = 5
/** Below this a frame rate is "too slow for the High preset". */
export const SLOW_BELOW_FPS = 25
/** At or below this the page is being throttled, not rendering slowly. */
export const THROTTLED_BELOW = 4

/**
 * @param {number[]} samples  Most recent frame-rate samples, oldest first (one per second).
 * @param {'high'|'low'} quality  The preset in use.
 * @param {boolean} alreadyLowered  True once the app has lowered quality by itself in this session.
 */
export function shouldLowerQuality(samples, quality, alreadyLowered) {
  if (quality !== 'high' || alreadyLowered || samples.length < SLOW_SAMPLES) return false
  return samples.slice(-SLOW_SAMPLES).every((fps) => fps > THROTTLED_BELOW && fps < SLOW_BELOW_FPS)
}
