/**
 * What a device's label and status ring should say at the current playhead, derived from the
 * reducer state. Pure, so the indicators are tested against the trace and cannot go stale: they are
 * recomputed from the same state the counters and the 3D effects come from.
 *
 * IDS-1 is passive: its tags only ever report alerts. Only IPS-1 reports drops and blocks.
 */

/** @typedef {{text: string, tone: 'ok'|'warn'|'danger'|'sensor'|'info'}} DeviceTag */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'S'}`

/**
 * @param {{id: string, type: string}} node  Topology node.
 * @param {string|null} address  Its primary IP (no prefix), used for the block table.
 * @param {ReturnType<import('./reducers.js').initialState>|null} state
 * @returns {DeviceTag[]}
 */
export function deviceTags(node, address, state) {
  if (!state || !state.meta) return []
  const tags = []
  const stats = state.nodes[node.id]

  if (address && state.blocks[address]) tags.push({ text: 'BLOCKED', tone: 'danger' })

  if (node.id === 'IDS-1') {
    if (stats?.alerts) tags.push({ text: plural(stats.alerts, 'ALERT'), tone: 'sensor' })
  } else if (node.id === 'IPS-1') {
    tags.push(state.meta.ips_mode === 'enforce' ? { text: 'ENFORCE', tone: 'ok' } : { text: 'MONITOR', tone: 'warn' })
    if (stats?.dropped) tags.push({ text: `${stats.dropped} DROPPED`, tone: 'danger' })
    else if (stats?.actions) tags.push({ text: plural(stats.actions, 'WOULD-BLOCK'), tone: 'warn' })
  } else if (stats?.denies) {
    tags.push({ text: `${stats.denies} DENIED`, tone: 'danger' })
  }
  return tags
}

/** Stable string form of the tags, so a Zustand selector can return it and re-render only on change. */
export function tagsKey(tags) {
  return tags.map((t) => `${t.tone}:${t.text}`).join('|')
}

/** @param {string} key @returns {DeviceTag[]} */
export function parseTagsKey(key) {
  return key === '' ? [] : key.split('|').map((part) => {
    const i = part.indexOf(':')
    return { tone: /** @type {DeviceTag['tone']} */ (part.slice(0, i)), text: part.slice(i + 1) }
  })
}

/** Ring state for the floor ring under a device. */
export function ringStateFor(tags, selected, hovered) {
  if (tags.some((t) => t.text === 'BLOCKED')) return 'blocked'
  if (selected) return 'selected'
  if (hovered) return 'hover'
  if (tags.some((t) => t.tone === 'sensor' || t.tone === 'danger')) return 'alert'
  return 'idle'
}
