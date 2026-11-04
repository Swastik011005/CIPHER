/**
 * Plain-data helpers for the separate 3D device viewer: what each model is called and how the viewer's camera frames it.
 * The viewer reuses the campus's own model components (devices/models) and specs; nothing about a device is described twice.
 */
import { NODE_LAYOUT } from '../layout.js'
import { DEVICE_SPECS, hitBoxesFor, modelKeyFor } from '../devices/specs.js'

/** Name shown for each of the 12 model keys. */
export const MODEL_NAMES = Object.freeze({
  desktop: 'Desktop workstation',
  laptop: 'Laptop',
  router: 'Edge router',
  'switch-l3': 'Layer 3 core switch',
  'switch-l2': 'Layer 2 access switch',
  'switch-rack': 'Rack-mounted Layer 2 switch',
  firewall: 'Firewall gate',
  'ids-sensor': 'IDS sensor',
  'ips-appliance': 'Inline IPS gate',
  'rack-server': 'Rack server',
  'soc-console': 'SOC console',
  'internet-cloud': 'Internet segment (cloud)',
})

/** The model key that draws a topology node, exactly as the campus scene chooses it. */
export const modelKeyOfNode = (node) => modelKeyFor(node, NODE_LAYOUT[node.id])

/**
 * Where the viewer's camera looks and from how far, so the whole model fits. Uses the same boxes that make a device pickable
 * in the campus (they enclose the model, the Internet cloud included).
 * @param {string} key  One of the DEVICE_SPECS keys.
 * @returns {{center: [number, number, number], radius: number, distance: number, minDistance: number, maxDistance: number, floorRadius: number}}
 */
export function viewerFraming(key) {
  const spec = DEVICE_SPECS[key]
  const boxes = hitBoxesFor(key)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const { size, center } of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], center[i] - size[i] / 2)
      max[i] = Math.max(max[i], center[i] + size[i] / 2)
    }
  }
  const center = /** @type {[number, number, number]} */ (min.map((v, i) => (v + max[i]) / 2))
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2
  const distance = (radius / Math.sin((15 * Math.PI) / 180)) * 1.05 // field of view 30: the bounding sphere just fits
  return {
    center,
    radius,
    distance,
    minDistance: Math.max(radius * 0.8, 1.2),
    maxDistance: distance * 2.6,
    floorRadius: Math.max(spec.half[0], spec.half[1], key === 'internet-cloud' ? 3 : 0) + 0.9,
  }
}
