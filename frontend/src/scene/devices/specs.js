/**
 * Physical footprint of each device model, in scene units (about one metre).
 * Models are built facing +z with their origin at the centre of the base.
 *
 * half     half extents [x, z] of the footprint (used to place cable ports and selection frames)
 * height   overall height, used for the selection frame and default label height
 * portY    height above the model base where cables attach
 * labelY   height of the floating label above the model base
 * ring     radius of the floor status ring, or null for devices that show a status bar instead
 */

/**
 * @typedef {Object} DeviceSpec
 * @property {[number, number]} half
 * @property {number} height
 * @property {number} portY
 * @property {number} labelY
 * @property {number | null} ring
 * @property {string} glyph  Glyph texture kind (see glyphTextures.js).
 */

/** @type {Record<string, DeviceSpec>} */
export const DEVICE_SPECS = Object.freeze({
  desktop: { half: [0.9, 0.55], height: 1.45, portY: 0.35, labelY: 2.0, ring: 1.15, glyph: 'monitor' },
  laptop: { half: [0.75, 0.5], height: 1.15, portY: 0.35, labelY: 1.7, ring: 1.0, glyph: 'laptop' },
  router: { half: [0.65, 0.4], height: 0.95, portY: 0.2, labelY: 1.5, ring: 1.0, glyph: 'router' },
  'switch-l3': { half: [0.95, 0.5], height: 0.5, portY: 0.35, labelY: 1.2, ring: 1.5, glyph: 'switch-l3' },
  'switch-l2': { half: [0.5, 0.4], height: 0.95, portY: 0.5, labelY: 1.5, ring: 0.8, glyph: 'switch' },
  'switch-rack': { half: [0.45, 0.4], height: 0.2, portY: 0.1, labelY: 0.7, ring: null, glyph: 'switch' },
  firewall: { half: [0.4, 1.65], height: 2.25, portY: 0.55, labelY: 2.8, ring: 1.9, glyph: 'shield' },
  'ids-sensor': { half: [0.5, 0.5], height: 1.7, portY: 0.4, labelY: 2.3, ring: 0.95, glyph: 'radar' },
  'ips-appliance': { half: [0.4, 1.2], height: 1.5, portY: 0.45, labelY: 2.2, ring: 1.4, glyph: 'shield-gate' },
  'rack-server': { half: [0.45, 0.4], height: 0.4, portY: 0.2, labelY: 0.9, ring: null, glyph: 'server' },
  'soc-console': { half: [0.95, 0.5], height: 1.35, portY: 0.5, labelY: 1.9, ring: 1.2, glyph: 'log' },
  'internet-cloud': { half: [0.45, 0.45], height: 0.5, portY: 0.3, labelY: 6.3, ring: 0.8, glyph: 'cloud' },
})

/**
 * Which model draws a node. Layout can override (the rack-mounted switch uses its own model);
 * otherwise the topology's `form_factor` decides.
 * @param {{form_factor: string}} node
 * @param {{model?: string}} [layout]
 */
export function modelKeyFor(node, layout) {
  return layout?.model ?? node.form_factor
}

/**
 * Invisible boxes that catch pointer events for a device. Models are made of many small meshes,
 * so picking uses these simple proxies instead. `center` is relative to the model base.
 * @param {string} key  Spec key.
 * @returns {{size: [number, number, number], center: [number, number, number]}[]}
 */
export function hitBoxesFor(key) {
  const spec = DEVICE_SPECS[key]
  if (key === 'internet-cloud') {
    return [
      { size: [1.1, 0.7, 1.1], center: [0, 0.3, 0] },
      { size: [4.4, 2.6, 3.6], center: [-1.9, 5.0, 0] },
    ]
  }
  const pad = key === 'switch-rack' || key === 'rack-server' ? 0.08 : 0.1
  const [hx, hz] = spec.half
  return [{ size: [hx * 2 + 0.1, spec.height + pad * 2, hz * 2 + 0.1], center: [0, spec.height / 2, 0] }]
}
