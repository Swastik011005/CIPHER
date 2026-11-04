import { useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { cableMaterials } from '../materials/materials.js'
import { PALETTE } from '../palette.js'
import { LINK_LAYOUT } from '../layout.js'
import { isTopPick } from '../picking.js'
import { useStore } from '../../state/store.js'
import { buildCableGeometry } from './cableGeometry.js'
import { buildCablePoints } from './cablePoints.js'
import { linkSeverity } from './linkActivity.js'

const RADIUS = { ethernet: 0.04, access: 0.04, trunk: 0.042, mgmt: 0.026, span: 0.034 }
const TRUNK_LANE = 0.055
/** Radius of the invisible tube that makes a cable easy to click (the visible cable is only 0.04 thick). */
const PICK_RADIUS = 0.2
const HALO_RADIUS = 0.1

const AMBER = new THREE.Color('#ffb020')
const RED = new THREE.Color('#ff4d5e')
const SELECTED = new THREE.Color('#d6f7ff')
const WHITE = new THREE.Color('#ffffff')
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false }) // pickable, never drawn: no draw call
const HALO = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.cyan).multiplyScalar(1.2), transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false })
const tint = new THREE.Color()
const blend = new THREE.Color()
const NO_RAYCAST = () => null
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')

/** Alpha map giving the SPAN cable its dashes. Each cable gets its own repeat count. */
function dashTexture(length) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 4
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 64, 4)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 34, 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.repeat.set(Math.max(1, Math.round(length / 0.45)), 1)
  return texture
}

/**
 * One cable (two parallel tubes for a trunk). Geometry is rebuilt only when its route changes.
 *
 * Each cable has its own material so it can show state without touching the others: flagged traffic tints it amber, blocked
 * traffic red (read from linkActivity once per frame, no React state), hover brightens it and selection lights it and adds a soft
 * halo. An invisible tube around the route makes it clickable; devices and packets on the same ray win over it (see picking.js).
 */
const Cable = memo(function Cable({ link, nodesById }) {
  const selected = useStore((s) => s.cable.selectedId === link.id)
  const hovered = useStore((s) => s.cable.hoveredId === link.id)
  const gl = useThree((s) => s.gl)

  const built = useMemo(() => {
    const points = buildCablePoints(link, nodesById)
    const route = LINK_LAYOUT[link.id]
    const radius = RADIUS[link.kind]
    const cornerRadius = route.radius
    const lanes = link.kind === 'trunk' ? [-TRUNK_LANE, TRUNK_LANE] : [0]
    const tubes = lanes.map((lane) => buildCableGeometry(points, { radius, cornerRadius, offset: [lane, lane] }))
    const pick = buildCableGeometry(points, { radius: PICK_RADIUS, cornerRadius })
    let material
    let alphaMap = null
    let base = null
    if (link.kind === 'span') {
      alphaMap = dashTexture(tubes[0].length)
      material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.sensor).multiplyScalar(1.8),
        alphaMap,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
    } else {
      material = cableMaterials[link.kind].clone()
      base = { color: material.color.clone(), emissive: material.emissive.clone() }
    }
    if (DEBUG) {
      // Debug aid (?debug=1): a point on the cable, so an automated check can aim a real mouse click at it.
      const samples = []
      for (let i = 1; i < points.length; i++) for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0.05, 0.95]) samples.push([0, 1, 2].map((k) => points[i - 1][k] + (points[i][k] - points[i - 1][k]) * f))
      ;(window.__netsecCables ??= {})[link.id] = samples
    }
    return { points, cornerRadius, tubes, pick, material, alphaMap, base }
  }, [link, nodesById])

  // The halo of a selected cable is built only while it is selected.
  const halo = useMemo(() => (selected ? buildCableGeometry(built.points, { radius: HALO_RADIUS, cornerRadius: built.cornerRadius }) : null), [selected, built])

  useEffect(
    () => () => {
      built.tubes.forEach((t) => t.geometry.dispose())
      built.pick.geometry.dispose()
      built.alphaMap?.dispose()
      built.material.dispose()
    },
    [built],
  )
  useEffect(() => () => halo?.geometry.dispose(), [halo])

  const look = useRef({ severity: 0 })
  const flags = useRef({ selected, hovered })
  flags.current = { selected, hovered }
  useFrame((_, delta) => {
    const { base, material } = built
    if (!base) return
    const state = look.current
    const target = linkSeverity.get(link.id) ?? 0
    state.severity += (target - state.severity) * Math.min(1, delta * 8)
    const sev = state.severity
    material.color.copy(base.color)
    material.emissive.copy(base.emissive)
    if (sev > 0.01) {
      // controlled: the colour moves part of the way to amber or red and the glow stays low, so it never blooms
      tint.copy(AMBER).lerp(RED, Math.min(Math.max(sev - 1, 0), 1))
      const amount = Math.min(sev, 1) * 0.7
      material.color.lerp(tint, amount)
      material.emissive.copy(blend.copy(tint).multiplyScalar(0.3 * amount)).add(blend.copy(base.emissive).multiplyScalar(1 - amount))
    }
    if (flags.current.selected) {
      material.color.lerp(SELECTED, 0.75)
      material.emissive.copy(SELECTED).multiplyScalar(0.4)
    } else if (flags.current.hovered) {
      material.color.lerp(WHITE, 0.4)
      material.emissive.add(blend.copy(WHITE).multiplyScalar(0.12))
    }
  })

  const onMove = (event) => {
    if (!isTopPick(event, 'cable')) return
    event.stopPropagation()
    const store = useStore.getState()
    store.hoverCable(link.id)
    store.hoverZone(null)
    gl.domElement.style.cursor = 'pointer'
  }
  const onOut = () => {
    const store = useStore.getState()
    if (store.cable.hoveredId === link.id) store.hoverCable(null)
  }
  const onClick = (event) => {
    if (!isTopPick(event, 'cable')) return
    event.stopPropagation()
    const store = useStore.getState()
    store.selectCable(store.cable.selectedId === link.id ? null : link.id)
  }

  return (
    <group name={`link-${link.id}`}>
      {built.tubes.map((tube, i) => (
        <mesh key={i} geometry={tube.geometry} material={built.material} castShadow={link.kind !== 'span'} />
      ))}
      {halo && <mesh geometry={halo.geometry} material={HALO} renderOrder={3} raycast={NO_RAYCAST} />}
      <mesh geometry={built.pick.geometry} material={HIDDEN} userData={{ pick: 'cable', link: link.id }} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} />
    </group>
  )
})

/**
 * Every link of the topology as a cable. Routes come from scene/layout.js; endpoints are
 * computed from the device layout, so a cable always meets the device it belongs to.
 * @param {{topology: {nodes: any[], links: any[]}}} props
 */
export function NetworkLinks({ topology }) {
  const showManagement = useStore((s) => s.settings.showManagementLinks)
  const nodesById = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n])), [topology.nodes])

  return (
    <group>
      {topology.links
        .filter((link) => LINK_LAYOUT[link.id] && (showManagement || link.kind !== 'mgmt'))
        .map((link) => (
          <Cable key={link.id} link={link} nodesById={nodesById} />
        ))}
    </group>
  )
}
