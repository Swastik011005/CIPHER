import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { session } from '../../playback/session.js'
import { useStore } from '../../state/store.js'
import { clearLinkActivity, noteLinkSeverity, notePulse, noteRouteGlow, severityOf } from '../links/linkActivity.js'
import { rgbOf } from '../links/cableShader.js'
import { routesOf } from '../links/routes.js'
import { buildLinkPaths, currentHop, packetPosition } from '../links/linkPaths.js'
import { PALETTE } from '../palette.js'
import { PACKET_CAPACITY as CAPACITY } from './capacity.js'
import { buildEnvelopeGeometry } from './envelopeGeometry.js'
import { isPingPacket, packetColorAt, pingColour } from './packetColor.js'
/** A dropped packet stays visible, red, where it died for this long, then its shatter effect takes over. */
export const DROP_MARKER_S = 0.18
/** A ping's envelope stays where it ended: after a block (under its red cross) and after a delivery (under its green tick). */
export const PING_DROP_HOLD_S = 2.4
export const PING_DELIVER_HOLD_S = 1.3

/** Verdict colours (HDR so they glow). Neutral until an enforcement point has decided. */
const COLORS = {
  neutral: new THREE.Color('#e4f2ff').multiplyScalar(1.7),
  allowed: new THREE.Color(PALETTE.ok).multiplyScalar(1.8),
  flagged: new THREE.Color(PALETTE.warn).multiplyScalar(2.0),
  dropped: new THREE.Color(PALETTE.danger).multiplyScalar(2.4),
  mirror: new THREE.Color(PALETTE.sensor).multiplyScalar(1.8),
}

/** Packets are drawn larger than the cables they travel on (a cable is 0.04 thick), so they read as the thing that moves. */
const SHAPES = {
  tcp: new THREE.CapsuleGeometry(0.105, 0.28, 4, 10),
  udp: new THREE.SphereGeometry(0.15, 14, 10),
  icmp: new THREE.OctahedronGeometry(0.19),
}
const SHAPES_ENV = buildEnvelopeGeometry()
const MATERIAL = new THREE.MeshBasicMaterial({ toneMapped: false })
const MATERIAL_ENV = new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true })
const ENVELOPE_SCALE = 3.4
const ENVELOPE_LIFT = 0.5
const X_AXIS = new THREE.Vector3(1, 0, 0)
const PING_RGB = new Map()
/** CSS colour of a packet's route glow by verdict key (non-ping packets). */
const KEY_RGB = { neutral: rgbOf('#8ad0ff'), allowed: rgbOf('#34d399'), flagged: rgbOf('#f59e0b'), dropped: rgbOf('#ef4444'), mirror: rgbOf('#a78bfa') }
const pingRgb = (seq) => {
  const hex = pingColour(seq)
  if (!PING_RGB.has(hex)) PING_RGB.set(hex, rgbOf(hex))
  return PING_RGB.get(hex)
}
const PING_HDR = new Map()
function pingColor(seq, out) {
  const hex = pingColour(seq)
  if (!PING_HDR.has(hex)) PING_HDR.set(hex, new THREE.Color(hex).multiplyScalar(1.15))
  return out.copy(PING_HDR.get(hex))
}
const UP = new THREE.Vector3(0, 1, 0)
const PICK_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 80) // covers the whole plate; instances move every frame

const SELECT_RING = new THREE.Mesh(
  new THREE.TorusGeometry(0.3, 0.025, 8, 28),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent).multiplyScalar(2.6), toneMapped: false, depthWrite: false }),
)

const blend = new THREE.Color()
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')

function colorFor(packet, t, out) {
  const { key, from, u } = packetColorAt(packet, t)
  return u >= 1 ? out.copy(COLORS[key]) : out.copy(COLORS[from]).lerp(COLORS[key], u)
}

/**
 * Draws every packet of the loaded trace at its position for the player's current time.
 * One instanced mesh per protocol shape (TCP capsule, UDP sphere, ICMP octahedron). Positions
 * are computed from the trace in the frame loop and never go through React state. Clicking a
 * packet selects it for the packet inspector.
 * @param {{topology: any}} props
 */
export function PacketLayer({ topology }) {
  const paths = useMemo(() => buildLinkPaths(topology), [topology])
  const meshes = useRef({})
  /** Packet id drawn at each instance index, per protocol shape: how a click finds its packet. */
  const pidAt = useRef({ tcp: [], udp: [], icmp: [], env: [] })
  const marker = useRef(null)
  const selVec = useMemo(() => new THREE.Vector3(), [])
  const gl = useThree((s) => s.gl)
  const scratch = useMemo(
    () => ({ p: new THREE.Vector3(), tangent: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), s: new THREE.Vector3(1, 1, 1) }),
    [],
  )

  useEffect(() => {
    for (const mesh of Object.values(meshes.current)) mesh.count = 0
  }, [paths])

  useFrame(() => {
    const player = session.player
    const used = { tcp: 0, udp: 0, icmp: 0, env: 0 }
    if (DEBUG) window.__netsecPackets = {}
    const selectedPid = useStore.getState().selection.packetId
    let selectedAt = null
    clearLinkActivity()

    if (player) {
      const t = player.time
      const routes = routesOf(player.events)
      for (const packet of Object.values(player.state.packets)) {
        const end = packet.end
        const dropped = end?.type === 'dropped'
        const ping = isPingPacket(packet)
        const hold = ping ? (dropped ? PING_DROP_HOLD_S : PING_DELIVER_HOLD_S) : dropped ? DROP_MARKER_S : 0
        if (end && t - end.t > hold) {
          // Delivered packets are gone; dropped ones hand over to their shatter effect. A selected
          // packet keeps its marker where it ended so the inspector still has something to point at.
          if (packet.pid === selectedPid && packetPosition(paths, packet.hops, t, scratch.p, scratch.tangent)) selectedAt = selVec.copy(scratch.p)
          continue
        }
        const shape = ping ? 'env' : packet.proto
        const mesh = meshes.current[shape]
        if (!mesh || used[shape] >= CAPACITY) continue
        if (!packetPosition(paths, packet.hops, t, scratch.p, scratch.tangent)) continue

        const mirror = packet.mirrorOf != null
        const scale = (mirror ? 0.7 : packet.pid === selectedPid ? 1.5 : 1) * (ping ? ENVELOPE_SCALE : 1)
        const colour = packetColorAt(packet, t)
        if (!mirror) {
          // cables carrying flagged or blocked traffic are tinted amber or red (see links/NetworkLinks.jsx)
          const level = severityOf(colour.key)
          if (level > 0) noteLinkSeverity(currentHop(packet.hops, t).link, level)
        }
        // the whole route of a packet in flight glows in its colour, and a pulse travels on the cable it is on
        const rgb = ping ? pingRgb(packet.icmp.seq) : KEY_RGB[colour.key] ?? KEY_RGB.neutral
        const hop = currentHop(packet.hops, t)
        for (const link of routes.get(packet.pid) ?? []) noteRouteGlow(link, rgb, mirror ? 0.8 : 0.62)
        if (hop && !end) {
          const path = paths.get(hop.link)
          if (path) {
            const forward = hop.from === path.aNode
            const progress = Math.min(Math.max((t - hop.t) / (hop.tArrive - hop.t), 0), 1)
            notePulse(hop.link, forward ? progress : 1 - progress, forward ? 1 : -1, rgb)
          }
        }
        scratch.s.setScalar(scale)
        if (ping) {
          scratch.tangent.y = 0
          if (scratch.tangent.lengthSq() < 1e-6) scratch.tangent.set(1, 0, 0)
          scratch.q.setFromUnitVectors(X_AXIS, scratch.tangent.normalize())
          scratch.p.y += ENVELOPE_LIFT
        } else if (packet.proto === 'tcp') scratch.q.setFromUnitVectors(UP, scratch.tangent)
        else scratch.q.identity()
        scratch.m.compose(scratch.p, scratch.q, scratch.s)
        const index = used[shape]++
        mesh.setMatrixAt(index, scratch.m)
        mesh.setColorAt(index, ping ? pingColor(packet.icmp.seq, blend) : colorFor(packet, t, blend))
        pidAt.current[shape][index] = packet.pid
        if (DEBUG) (window.__netsecPackets ??= {})[packet.pid] = [scratch.p.x, scratch.p.y, scratch.p.z]
        if (packet.pid === selectedPid) selectedAt = selVec.copy(scratch.p)
      }
    }

    for (const [proto, mesh] of Object.entries(meshes.current)) {
      mesh.count = used[proto]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }

    const ring = marker.current
    if (ring) {
      ring.visible = selectedAt !== null
      if (selectedAt) {
        ring.position.copy(selectedAt)
        ring.rotation.x = Math.PI / 2
      }
    }
  })

  const pickHandlers = (proto) => ({
    onClick: (event) => {
      const pid = pidAt.current[proto][event.instanceId]
      if (pid === undefined) return
      event.stopPropagation()
      useStore.getState().selectPacket(pid)
    },
    onPointerOver: (event) => {
      event.stopPropagation()
      gl.domElement.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      gl.domElement.style.cursor = ''
    },
  })

  return (
    <group name="packets">
      {Object.entries({ ...SHAPES, env: SHAPES_ENV }).map(([proto, geometry]) => (
        <instancedMesh
          key={proto}
          ref={(mesh) => {
            if (!mesh) return
            mesh.boundingSphere = PICK_SPHERE
            meshes.current[proto] = mesh
          }}
          args={[geometry, proto === 'env' ? MATERIAL_ENV : MATERIAL, CAPACITY]}
          frustumCulled={false}
          userData={{ pick: 'packet' }}
          {...pickHandlers(proto)}
        />
      ))}
      <primitive object={SELECT_RING} ref={marker} visible={false} />
    </group>
  )
}
