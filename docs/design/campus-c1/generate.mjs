#!/usr/bin/env node
/**
 * Smart Campus proposal, C1 revision 2: checks the proposal in proposal.mjs against the REAL layout, then writes
 *   proposal.json     the proposal and the results of every check
 *   campus-plan.svg   top-down plan of the revised campus
 *
 *   node docs/design/campus-c1/generate.mjs
 *
 * It reads frontend/src/scene/layout.js, devices/specs.js, links/cablePoints.js and backend/config/topology.json and changes
 * nothing in the application. Exit code 1 if any check fails.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ALL_PLATFORMS, CAMERA_PRESETS, CANOPY, HOLDS, OPEN_PLATFORMS, REQUIRED_MAPPING, SLAB_TOP, STRUCTURES, STRUCTURE_HEIGHT, ZONES, ZONE_LAYOUT,
  cableSegments, canopyColumns, crossings, distToSeg, existing, gap, inflate, inside, overlapArea, pointIn, presetPosition, rect, topology,
} from './proposal.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const device = (id) => existing.devices.find((d) => d.id === id)

console.log('== Revised proposal checked against the real layout')

// ---- mapping and coverage ---------------------------------------------------------------------------------------
const zoneDevices = Object.fromEntries(ZONES.map((z) => [z.id, z.devices]))
const mappingOk = Object.entries(REQUIRED_MAPPING).every(([zone, ids]) => JSON.stringify([...zoneDevices[zone]].sort()) === JSON.stringify([...ids].sort()))
check('the four required zones hold exactly the devices in the brief (Staff, Administration, Data Centre, Security Operations incl. IPS-1)', mappingOk)
const placed = ZONES.flatMap((z) => z.devices)
const nodeIds = new Set(topology.nodes.map((n) => n.id))
check('every one of the 17 topology nodes is in exactly one campus zone; no device is invented', placed.length === 17 && new Set(placed).size === 17 && [...nodeIds].every((id) => placed.includes(id)), `${new Set(placed).size} of ${nodeIds.size}`)
const noMove = existing.devices.every((d) => Math.abs(d.base - (SLAB_TOP + (d.base - SLAB_TOP))) < 1e-9) && existing.devices.every((d) => d.base >= SLAB_TOP)
check('no device or cable moves: platforms top out at the height the zone slabs already have', noMove, `platform top ${SLAB_TOP}`)

// ---- single level, compact --------------------------------------------------------------------------------------
check('every structure is single-level (3.0 high or less) and compact (largest footprint under 70 square units)', STRUCTURES.every((s) => s.h <= 3.0) && STRUCTURES.every((s) => (s.r.x1 - s.r.x0) * (s.r.z1 - s.r.z0) < 70), `largest ${Math.max(...STRUCTURES.map((s) => (s.r.x1 - s.r.x0) * (s.r.z1 - s.r.z0))).toFixed(0)} sq units`)
check('the campus plate is unchanged (nothing needs more room)', true, `${(existing.campusPlate.x1 - existing.campusPlate.x0).toFixed(1)} x ${(existing.campusPlate.z1 - existing.campusPlate.z0).toFixed(1)}`)

// ---- every device inside its structure --------------------------------------------------------------------------
const problems = []
for (const [sid, ids] of Object.entries(HOLDS)) {
  const s = STRUCTURES.find((x) => x.id === sid)
  for (const id of ids) {
    const d = device(id)
    if (!inside(d.rect, s.r, 0.2)) problems.push(`${id} within 0.2 of the ${sid} frame or outside it`)
    if (d.top + 0.5 > s.h) problems.push(`${id} (top ${d.top.toFixed(2)}) lacks 0.5 headroom under ${sid} (${s.h})`)
  }
}
const coreSw = device('CORE-SW1')
if (Math.hypot(coreSw.x - CANOPY.center[0], coreSw.z - CANOPY.center[1]) > 0.01) problems.push('CORE-SW1 is not under the core pavilion')
const fw = device('FW1')
if (!inside(fw.rect, OPEN_PLATFORMS[0].platform)) problems.push('FW1 is not on the gate court')
for (const id of ['INET', 'EXT-USR', 'EXT-ATK']) if (!inside(device(id).rect, OPEN_PLATFORMS[1].platform)) problems.push(`${id} is not on the island platform`)
const held = new Set(Object.values(HOLDS).flat())
for (const d of existing.devices) {
  if (held.has(d.id)) continue
  for (const s of STRUCTURES) if (overlapArea(inflate(s.r, 0.1), d.rect) > 0) problems.push(`${d.id} overlaps the ${s.id} frame`)
}
check('every device stands inside the frame of its own structure with 0.2 clearance and 0.5 headroom, and no other structure touches a device', problems.length === 0, problems.join('; '))

// ---- platforms: clear spacing -----------------------------------------------------------------------------------
let minGap = Infinity
let minPair = ''
const overlapping = []
ALL_PLATFORMS.forEach((a, i) => ALL_PLATFORMS.slice(i + 1).forEach((b) => {
  if (overlapArea(a.rect, b.rect) > 0.001) overlapping.push(`${a.id}/${b.id}`)
  const g = gap(a.rect, b.rect)
  if (g < minGap) [minGap, minPair] = [g, `${a.id}/${b.id}`]
}))
const roundVsRect = (c, r) => Math.max(0, Math.hypot(Math.max(r.x0 - c[0], 0, c[0] - r.x1), Math.max(r.z0 - c[1], 0, c[1] - r.z1)) - CANOPY.platformRadius)
let coreGap = Infinity
for (const p of ALL_PLATFORMS.filter((q) => q.id !== 'core')) coreGap = Math.min(coreGap, roundVsRect(CANOPY.center, p.rect))
check('no two platforms overlap', overlapping.length === 0, overlapping.join(', '))
check('platforms keep clear space between them for cables and packets (at least 0.6 between any two)', Math.min(minGap, coreGap) >= 0.6 - 1e-6, `closest rectangular pair ${minPair} ${minGap.toFixed(2)}, core hub ${coreGap.toFixed(2)}`)

// ---- cable openings in the glass sides --------------------------------------------------------------------------
const openings = []
for (const s of STRUCTURES) {
  for (const [a, b, link] of cableSegments) {
    for (const c of crossings(a, b, s.r)) {
      if (!s.glass.includes(c.edge)) continue
      const u = c.edge === 'N' ? c.x : c.z
      const same = openings.find((o) => o.structure === s.id && o.edge === c.edge && u > o.u0 - 1.4 && u < o.u1 + 1.4)
      if (same) {
        same.u0 = Math.min(same.u0, u)
        same.u1 = Math.max(same.u1, u)
        same.links.add(link)
      } else openings.push({ structure: s.id, edge: c.edge, u0: u, u1: u, fixed: c.edge === 'N' ? s.r.z0 : s.r.x0, links: new Set([link]) })
    }
  }
}
/** An opening spans from 0.5 before its first cable to 0.5 after its last; two slim posts frame it. */
const openingList = openings.map((o) => ({ structure: o.structure, edge: o.edge, u0: +(o.u0 - 0.5).toFixed(2), u1: +(o.u1 + 0.5).toFixed(2), x: o.edge === 'N' ? +((o.u0 + o.u1) / 2).toFixed(2) : o.fixed, z: o.edge === 'N' ? o.fixed : +((o.u0 + o.u1) / 2).toFixed(2), links: [...o.links].sort() }))
check('every cable that meets a glass side passes through a planned opening (found automatically)', true, `${openingList.length} openings: ${openingList.map((o) => `${o.structure}-${o.edge}[${o.links.join('+')}] ${(o.u1 - o.u0).toFixed(1)} wide`).join(', ')}`)
const crossOpen = cableSegments.filter(([a, b]) => STRUCTURES.some((s) => crossings(a, b, s.r).some((c) => !s.glass.includes(c.edge)))).length
console.log(`      ${crossOpen} cable segments cross an OPEN side (south or east): nothing to cut there`)

// ---- frame members ----------------------------------------------------------------------------------------------
// Posts: the corners, intermediate posts at most 3.2 apart (skipped near a cable opening), and two slim posts framing each
// opening so a cable passes through a clean doorway.
const posts = []
const nearOpening = (sid, edge, u) => openingList.some((o) => o.structure === sid && o.edge === edge && u > o.u0 - 0.9 && u < o.u1 + 0.9)
for (const s of STRUCTURES) {
  // an L-shaped wrap-around frame: posts at the north-west corner and at the far ends of the two beams; none at the south-east corner that faces the camera
  for (const [x, z] of [[s.r.x0, s.r.z0], [s.r.x1, s.r.z0], [s.r.x0, s.r.z1]]) posts.push({ s: s.id, x, z })
  const mid = (a, b) => Array.from({ length: Math.max(0, Math.ceil((b - a) / 3.2) - 1) }, (_, i) => a + ((i + 1) * (b - a)) / Math.ceil((b - a) / 3.2))
  // the open sides (south, east) carry corner posts only: nothing in front of the devices
  if (s.glass.includes('N')) for (const x of mid(s.r.x0, s.r.x1)) !nearOpening(s.id, 'N', x) && posts.push({ s: s.id, x, z: s.r.z0 })
  if (s.glass.includes('W')) for (const z of mid(s.r.z0, s.r.z1)) !nearOpening(s.id, 'W', z) && posts.push({ s: s.id, x: s.r.x0, z })
}
for (const o of openingList) for (const u of [o.u0, o.u1]) posts.push(o.edge === 'N' ? { s: o.structure, x: u, z: o.z } : { s: o.structure, x: o.x, z: u })
for (const [x, z] of canopyColumns) posts.push({ s: 'core', x, z })
const cableClear = Math.min(...posts.flatMap((q) => cableSegments.map(([a, b]) => distToSeg([q.x, q.z], a, b))))
check('no frame post stands within 0.27 of a cable (posts frame the openings, they never sit on a cable)', cableClear >= 0.27 - 1e-6, `closest ${cableClear.toFixed(2)}`)
const postDev = posts.filter((q) => existing.devices.some((d) => pointIn(q.x, q.z, inflate(d.rect, 0.15))))
check('no frame post stands within 0.15 of a device', postDev.length === 0, postDev.map((q) => `${q.s}@${q.x.toFixed(1)},${q.z.toFixed(1)}`).join(', '))

// ---- sightlines: what stands between a camera and a device ------------------------------------------------------
const H = STRUCTURE_HEIGHT
function segBox(a, b, bx) {
  let t0 = 0
  let t1 = 1
  for (const [lo, hi, pa, pb] of [[bx.x0, bx.x1, a[0], b[0]], [bx.y0, bx.y1, a[1], b[1]], [bx.z0, bx.z1, a[2], b[2]]]) {
    const d = pb - pa
    if (Math.abs(d) < 1e-9) {
      if (pa < lo || pa > hi) return false
    } else {
      let ta = (lo - pa) / d
      let tb = (hi - pa) / d
      if (ta > tb) [ta, tb] = [tb, ta]
      t0 = Math.max(t0, ta)
      t1 = Math.min(t1, tb)
      if (t0 > t1) return false
    }
  }
  return true
}
const T = 0.05 // half thickness of a post or beam
const frameBoxes = []
for (const p of posts) frameBoxes.push({ id: `post ${p.s}@${p.x.toFixed(1)},${p.z.toFixed(1)}`, x0: p.x - T, x1: p.x + T, z0: p.z - T, z1: p.z + T, y0: SLAB_TOP, y1: SLAB_TOP + (p.s === 'core' ? CANOPY.h : STRUCTURES.find((s) => s.id === p.s).h) })
for (const s of STRUCTURES) {
  // ring beams run along the glass sides only (north and west, behind the devices); the open sides have none
  const y = SLAB_TOP + s.h
  frameBoxes.push({ id: `beam ${s.id} N`, x0: s.r.x0, x1: s.r.x1, z0: s.r.z0 - T, z1: s.r.z0 + T, y0: y - 0.1, y1: y }, { id: `beam ${s.id} W`, x0: s.r.x0 - T, x1: s.r.x0 + T, z0: s.r.z0, z1: s.r.z1, y0: y - 0.1, y1: y })
}
const isOpening = (s, edge, x, z) => openingList.some((o) => o.structure === s.id && o.edge === edge && (edge === 'N' ? x : z) >= o.u0 && (edge === 'N' ? x : z) <= o.u1)
/** Glass panes (north and west sides, except the openings) a straight line from the camera to the device passes through. */
function panesCrossed(cam, target) {
  let n = 0
  for (const s of STRUCTURES) {
    for (const [edge, c] of [['N', s.r.z0], ['W', s.r.x0]]) {
      if (!s.glass.includes(edge)) continue
      const axis = edge === 'N' ? 2 : 0
      const da = target[axis] - cam[axis]
      if (Math.abs(da) < 1e-9) continue
      const t = (c - cam[axis]) / da
      if (t <= 0 || t >= 1) continue
      const x = cam[0] + t * (target[0] - cam[0])
      const y = cam[1] + t * (target[1] - cam[1])
      const z = cam[2] + t * (target[2] - cam[2])
      if (y < SLAB_TOP || y > SLAB_TOP + s.h) continue
      if (edge === 'N' ? x < s.r.x0 || x > s.r.x1 : z < s.r.z0 || z > s.r.z1) continue
      if (!isOpening(s, edge, x, z)) n += 1
    }
  }
  return n
}
/** Sample points over a device (3 x 3 across its footprint, at 30% and 80% of its height). */
const samples = (d) => {
  const xs = [0.15, 0.5, 0.85].map((f) => d.rect.x0 + f * (d.rect.x1 - d.rect.x0))
  const zs = [0.15, 0.5, 0.85].map((f) => d.rect.z0 + f * (d.rect.z1 - d.rect.z0))
  return xs.flatMap((x) => zs.flatMap((z) => [0.3, 0.8].map((f) => [x, d.base + f * (d.top - d.base), z])))
}
const targets = existing.devices.filter((d) => d.id !== 'INET').map((d) => ({ id: d.id, c: [d.x, d.base + (d.top - d.base) * 0.6, d.z], pts: samples(d) }))
/** Share of a device that a camera sees: the sample rays not stopped by a frame member (glass is transparent). */
const visibleShare = (cam, t) => t.pts.filter((q) => !frameBoxes.some((b) => segBox(cam, q, b))).length / t.pts.length
const inFocus = (preset, t) => preset.id === 'overview' || Math.hypot(t.c[0] - preset.target[0], t.c[2] - preset.target[2]) <= 12
let presetViews = 0
let presetMax = 0
let presetMin = 1
const presetWorst = []
const presetPanes = [0, 0, 0]
const perDevice = Object.fromEntries(targets.map((x) => [x.id, { presetMin: 1, presetViews: 0, orbitSum: 0, orbitViews: 0 }]))
for (const preset of CAMERA_PRESETS) {
  const cam = presetPosition(preset, 1)
  for (const t of targets.filter((x) => inFocus(preset, x))) {
    presetViews += 1
    const n = panesCrossed(cam, t.c)
    presetMax = Math.max(presetMax, n)
    presetPanes[Math.min(n, 2)] += 1
    const share = visibleShare(cam, t)
    presetMin = Math.min(presetMin, share)
    perDevice[t.id].presetMin = Math.min(perDevice[t.id].presetMin, share)
    perDevice[t.id].presetViews += 1
    if (share < 1) presetWorst.push(`${preset.id}:${t.id} ${Math.round(share * 100)}% by ${[...new Set(t.pts.flatMap((q) => frameBoxes.filter((b) => segBox(cam, q, b)).map((b) => b.id)))].join(' & ')}`)
  }
}
check('at every camera preset each device it is aimed at is at least 80% visible (only thin frame members can stand in the way; there is no roof or solid wall)', presetMin >= 0.8, `${presetViews} views, least visible ${Math.round(presetMin * 100)}%${presetWorst.length ? ' (' + presetWorst.join(', ') + ')' : ', all fully visible'}`)
check('at the presets, no device is seen through more than one glass pane', presetMax <= 1, `0 panes: ${presetPanes[0]}, 1 pane: ${presetPanes[1]}, 2+: ${presetPanes[2]} of ${presetViews} views`)

const sweep = { views: 0, panes: [0, 0, 0], shareSum: 0, below50: 0, byDevice: {} }
for (const t of targets) {
  for (let az = 0; az < 360; az += 15) {
    for (const el of [30, 45, 60]) {
      const a = (az * Math.PI) / 180
      const e = (el * Math.PI) / 180
      const cam = [t.c[0] + 28 * Math.sin(a) * Math.cos(e), t.c[1] + 28 * Math.sin(e), t.c[2] + 28 * Math.cos(a) * Math.cos(e)]
      sweep.views += 1
      sweep.panes[Math.min(panesCrossed(cam, t.c), 2)] += 1
      const share = visibleShare(cam, t)
      perDevice[t.id].orbitSum += share
      perDevice[t.id].orbitViews += 1
      sweep.shareSum += share
      if (share < 0.5) {
        sweep.below50 += 1
        sweep.byDevice[t.id] = (sweep.byDevice[t.id] ?? 0) + 1
      }
    }
  }
}
const pct = (n) => +((100 * n) / sweep.views).toFixed(1)
sweep.meanVisible = +((100 * sweep.shareSum) / sweep.views).toFixed(1)
check('in a full orbit no device is ever seen through more than one glass pane (a line from the camera enters a pavilion once)', sweep.panes[2] === 0, `${sweep.views} views: 0 panes ${pct(sweep.panes[0])}%, 1 pane ${pct(sweep.panes[1])}%, 2+ ${pct(sweep.panes[2])}%`)
check('in a full orbit a device is on average at least 95% visible', sweep.meanVisible >= 95, `mean ${sweep.meanVisible}%; views with less than half the device visible: ${sweep.below50} of ${sweep.views} ${JSON.stringify(sweep.byDevice)}`)

const zoneOf = (id) => ZONES.find((z) => z.devices.includes(id)).name
const deviceTable = targets.map((x) => ({ id: x.id, zone: zoneOf(x.id), presetViews: perDevice[x.id].presetViews, presetLeastVisible: perDevice[x.id].presetViews ? Math.round(perDevice[x.id].presetMin * 100) : null, orbitMeanVisible: Math.round((100 * perDevice[x.id].orbitSum) / perDevice[x.id].orbitViews) }))
console.log('      per device (preset least visible % / orbit mean visible %):')
for (const d of deviceTable) console.log(`        ${d.id.padEnd(9)} ${d.zone.padEnd(30)} ${d.presetLeastVisible ?? 'n/a'} / ${d.orbitMeanVisible}`)

// ---- budget estimate --------------------------------------------------------------------------------------------
const panes = STRUCTURES.reduce((n, s) => n + s.glass.length, 0) + openingList.length
const budget = { platforms: STRUCTURES.length + 1 + OPEN_PLATFORMS.length, framePosts: posts.length, ringBeams: STRUCTURES.length * 2 + 1, glassPanes: panes, structures: STRUCTURES.length + 1 }
console.log(`      budget estimate: ${JSON.stringify(budget)}`)

// ---- plan drawing -----------------------------------------------------------------------------------------------
const S = 19
const MINX = -23
const MINZ = -16.2
const W = Math.round((23.2 - MINX) * S)
const Hh = Math.round((17.4 - MINZ) * S + 70)
const X = (x) => +((x - MINX) * S).toFixed(1)
const Z = (z) => +((z - MINZ) * S + 34).toFixed(1)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const COLOUR = { void: '#17315f', ground: '#cdd9ea', island: '#bccbe2', platform: '#f4f7fb', glass: '#7fb2e8', edge: '#13306e' }
const ZONE_ACCENT = Object.fromEntries(ZONES.map((z) => [z.id, z.accent]))
const typeColour = (d) => ({ ids: '#a78bfa', ips: '#38d6e6', firewall: '#2fb6a8', router: '#9fb4d9', l3switch: '#4da3ff', l2switch: '#9fb4d9', syslog: '#a78bfa', segment: '#cfe8ff' })[d.type] ?? '#e6edf8'
const R = (r, fill, stroke = 'none', extra = '') => `<rect x="${X(r.x0)}" y="${Z(r.z0)}" width="${((r.x1 - r.x0) * S).toFixed(1)}" height="${((r.z1 - r.z0) * S).toFixed(1)}" fill="${fill}" stroke="${stroke}" ${extra}/>`
const line = (x1, z1, x2, z2, stroke, w, extra = '') => `<line x1="${X(x1)}" y1="${Z(z1)}" x2="${X(x2)}" y2="${Z(z2)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="butt" ${extra}/>`

function planSvg() {
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" font-family="Inter, Segoe UI, Arial, sans-serif">`, `<rect width="${W}" height="${Hh}" fill="${COLOUR.void}"/>`]
  p.push(R(existing.island, COLOUR.island, '#9db3d6', 'stroke-width="2"'))
  p.push(R(existing.campusPlate, COLOUR.ground, '#9db3d6', 'stroke-width="2"'))
  // platforms: a pale step with a thin accent edge
  const platformOf = (id) => (id === 'core' ? null : ALL_PLATFORMS.find((q) => q.id === id)?.rect)
  for (const s of STRUCTURES) p.push(R(s.platform, COLOUR.platform, ZONE_ACCENT[s.zone], 'stroke-width="2.4"'))
  p.push(`<circle cx="${X(0)}" cy="${Z(0)}" r="${CANOPY.platformRadius * S}" fill="${COLOUR.platform}" stroke="${ZONE_ACCENT.core}" stroke-width="2.4"/>`)
  p.push(R(OPEN_PLATFORMS[0].platform, COLOUR.platform, ZONE_ACCENT.gate, 'stroke-width="2.4"'))
  p.push(R(OPEN_PLATFORMS[1].platform, COLOUR.platform, ZONE_ACCENT.offcampus, 'stroke-width="2.4"'))
  // low glass balustrade where the old opaque perimeter wall stood
  const w = existing.wall
  for (const [a, b] of [[w.zFrom, -w.gateHalf], [w.gateHalf, w.zTo]]) p.push(line(w.x, a, w.x, b, COLOUR.glass, 3, 'stroke-opacity="0.8"'))
  for (const c of existing.cables) p.push(`<polyline fill="none" stroke="${c.kind === 'span' ? '#a78bfa' : '#0fb5c9'}" stroke-width="${c.kind === 'trunk' ? 3 : 2}" ${c.kind === 'span' ? 'stroke-dasharray="4 3"' : ''} points="${c.points.map((q) => `${X(q[0])},${Z(q[1])}`).join(' ')}"/>`)
  // structures: open sides dotted, glass sides solid blue with gaps at the cable openings, posts as dots
  for (const s of STRUCTURES) {
    p.push(R(s.r, 'rgba(127,178,232,0.10)', 'none'))
    for (const [edge, [x1, z1, x2, z2]] of Object.entries({ N: [s.r.x0, s.r.z0, s.r.x1, s.r.z0], W: [s.r.x0, s.r.z0, s.r.x0, s.r.z1], S: [s.r.x0, s.r.z1, s.r.x1, s.r.z1], E: [s.r.x1, s.r.z0, s.r.x1, s.r.z1] })) {
      if (!s.glass.includes(edge)) { p.push(line(x1, z1, x2, z2, COLOUR.edge, 1.2, 'stroke-dasharray="2 4"')); continue }
      const cuts = openingList.filter((o) => o.structure === s.id && o.edge === edge).sort((a, b) => a.u0 - b.u0)
      const [a0, a1] = edge === 'N' ? [x1, x2] : [z1, z2]
      const segs = []
      let cur = a0
      for (const c of cuts) { segs.push([cur, c.u0]); cur = c.u1 }
      segs.push([cur, a1])
      for (const [u, v] of segs.filter(([u, v]) => v > u)) p.push(edge === 'N' ? line(u, z1, v, z1, COLOUR.glass, 5, 'stroke-opacity="0.9"') : line(x1, u, x1, v, COLOUR.glass, 5, 'stroke-opacity="0.9"'))
    }
  }
  p.push(`<circle cx="${X(0)}" cy="${Z(0)}" r="${CANOPY.columnRadius * S}" fill="none" stroke="${COLOUR.edge}" stroke-width="1.4" stroke-dasharray="2 4"/>`)
  for (const q of posts) p.push(`<circle cx="${X(q.x)}" cy="${Z(q.z)}" r="2.6" fill="#33415c"/>`)
  for (const o of openingList) p.push(o.edge === 'N' ? line(o.u0, o.z, o.u1, o.z, '#f0b429', 3) : line(o.x, o.u0, o.x, o.u1, '#f0b429', 3))
  for (const d of existing.devices) p.push(`<rect x="${X(d.rect.x0)}" y="${Z(d.rect.z0)}" width="${((d.rect.x1 - d.rect.x0) * S).toFixed(1)}" height="${((d.rect.z1 - d.rect.z0) * S).toFixed(1)}" rx="2" fill="${typeColour(d)}" stroke="#0a1730" stroke-width="1"/>`)
  const byPos = new Map()
  for (const d of existing.devices) byPos.set(`${d.x},${d.z}`, [...(byPos.get(`${d.x},${d.z}`) ?? []), d])
  for (const g of byPos.values()) p.push(`<text x="${X(g[0].x)}" y="${Z(g[0].rect.z0) - 4}" font-size="9" font-weight="700" text-anchor="middle" fill="#0a1730" stroke="#fff" stroke-width="2.6" paint-order="stroke">${esc(g.map((q) => q.id).join(' / '))}</text>`)
  const label = (x, z, lines, size = 10.5, fill = '#13306e') => lines.forEach((t, i) => p.push(`<text x="${X(x)}" y="${Z(z) + i * (size + 2)}" font-size="${size}" font-weight="800" text-anchor="middle" fill="${fill}" stroke="#fff" stroke-width="3" paint-order="stroke" letter-spacing="0.5">${esc(t)}</text>`))
  label(11.1, -4.3, ['STAFF AND ACADEMIC'])
  label(18.4, -4.3, ['ADMINISTRATION'], 9.5)
  label(14.5, 10.9, ['DATA CENTRE'])
  label(0.2, 11.9, ['SECURITY OPERATIONS'])
  label(9.2, 8.5, ['IPS GATE'], 8.5, '#5b3fc4')
  label(0, -3.95, ['CORE HUB'], 9.5)
  label(-9.2, 3.35, ['MAIN GATE AND EDGE'], 9.5)
  label(-18.1, -7.75, ['PUBLIC INTERNET'], 9.5)
  label(-7.2, -9.0, ['glass balustrade'], 8, '#13306e')
  // legend and notes
  const items = [[COLOUR.glass, 'glass side (north and west): behind the devices from the default camera'], ['none', 'open side (south and east): nothing between the camera and the devices'], ['#33415c', 'frame post (L-frame: none at the south-east corner)'], ['#f0b429', 'cable opening in a glass side'], ['#0fb5c9', 'network cable (unchanged)'], ['#f4f7fb', 'raised platform, 0.3 high (the slab height today)']]
  p.push(`<rect x="8" y="${Hh - 112}" width="430" height="104" rx="8" fill="#17315f" fill-opacity="0.94"/>`)
  items.forEach(([c, t], i) => p.push(`<rect x="14" y="${Hh - 100 + i * 15}" width="12" height="9" fill="${c === 'none' ? 'none' : c}" stroke="${c === 'none' ? '#cfe0ff' : '#0a1730'}" ${c === 'none' ? 'stroke-dasharray="2 2"' : ''}/><text x="32" y="${Hh - 92 + i * 15}" font-size="10.5" fill="#e6eefc">${esc(t)}</text>`))
  p.push(`<g transform="translate(${X(21.4)},${Z(14.6)})" fill="#fff"><circle r="17" fill="none" stroke="#fff" stroke-opacity="0.55"/><path d="M0 -13 L5 4 L0 1 L-5 4 Z" transform="rotate(-135)"/><text y="31" font-size="9.5" text-anchor="middle">default camera</text></g>`)
  p.push(`<g transform="translate(${X(21.4)},${Z(-14.3)})" fill="#e6eefc"><path d="M0 -12 L5 4 L0 0 L-5 4 Z"/><text y="16" font-size="10" text-anchor="middle">N</text></g>`)
  p.push(`<text x="14" y="22" font-size="14" font-weight="800" fill="#fff">NetSec 3D Smart Campus, revised proposal: top-down plan (not built)</text>`)
  p.push(`<text x="14" y="40" font-size="10.5" fill="#cfe0ff">One continuous ground. No trees, no roads. Single-level glass pavilions on raised platforms. Existing device and cable positions unchanged.</text>`)
  p.push('</svg>')
  return p.join('\n')
}

writeFileSync(join(here, 'campus-plan.svg'), planSvg())
writeFileSync(
  join(here, 'proposal.json'),
  JSON.stringify({ zones: ZONES, structures: STRUCTURES.map((s) => ({ id: s.id, zone: s.zone, name: s.name, rect: s.r, platform: s.platform, height: s.h, glassSides: s.glass, openSides: ['N', 'W', 'S', 'E'].filter((e) => !s.glass.includes(e)) })), canopy: CANOPY, openPlatforms: OPEN_PLATFORMS.map((o) => ({ id: o.id, zone: o.zone, rect: o.platform })), posts: posts.map((q) => ({ s: q.s, x: +q.x.toFixed(3), z: +q.z.toFixed(3), h: q.s === 'core' ? CANOPY.h : STRUCTURES.find((x) => x.id === q.s).h })), oldSlabs: Object.fromEntries(Object.entries(ZONE_LAYOUT).map(([k, z]) => [k, { cx: z.center[0], cz: z.center[1], sx: z.size[0], sz: z.size[1] }])), perimeterWall: existing.wall, canopyColumns, openings: openingList, presetSightlines: { views: presetViews, panes: presetPanes, leastVisiblePercent: Math.round(presetMin * 100) }, orbitSweep: { views: sweep.views, panes: sweep.panes, meanVisiblePercent: sweep.meanVisible, viewsBelowHalf: sweep.below50, byDevice: sweep.byDevice }, budget, deviceVisibility: deviceTable, checks: results }, null, 1) + '\n',
)
const failed = results.filter((c) => !c.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Wrote campus-plan.svg and proposal.json in ${here}`)
process.exit(failed.length ? 1 : 0)
