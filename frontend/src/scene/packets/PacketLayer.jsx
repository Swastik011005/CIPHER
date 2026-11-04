import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { session } from '../../playback/session.js'
import { useStore } from '../../state/store.js'
import { linkSeverity, noteLinkSeverity, severityOf } from '../links/linkActivity.js'
import { buildLinkPaths, currentHop, packetPosition } from '../links/linkPaths.js'
import { PALETTE } from '../palette.js'
import { PACKET_CAPACITY as CAPACITY } from './capacity.js'
import { packetColorAt } from './packetColor.js'
/** A dropped packet stays visible, red, where it died for this long, then its shatter effect takes over. */
export const DROP_MARKER_S = 0.18

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
const MATERIAL = new THREE.MeshBasicMaterial({ toneMapped: false })
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
  const pidAt = useRef({ tcp: [], udp: [], icmp: [] })
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
    const used = { tcp: 0, udp: 0, icmp: 0 }
    if (DEBUG) window.__netsecPackets = {}
    const selectedPid = useStore.getState().selection.packetId
    let selectedAt = null
    linkSeverity.clear()

    if (player) {
      const t = player.time
      for (const packet of Object.values(player.state.packets)) {
        const end = packet.end
        const dropped = end?.type === 'dropped'
        if (end && (!dropped || t - end.t > DROP_MARKER_S)) {
          // Delivered packets are gone; dropped ones hand over to their shatter effect. A selected
          // packet keeps its marker where it ended so the inspector still has something to point at.
          if (packet.pid === selectedPid && packetPosition(paths, packet.hops, t, scratch.p, scratch.tangent)) selectedAt = selVec.copy(scratch.p)
          continue
        }
        const mesh = meshes.current[packet.proto]
        if (!mesh || used[packet.proto] >= CAPACITY) continue
        if (!packetPosition(paths, packet.hops, t, scratch.p, scratch.tangent)) continue

        const scale = packet.mirrorOf != null ? 0.7 : packet.pid === selectedPid ? 1.5 : 1
        if (packet.mirrorOf == null) {
          // cables carrying flagged or blocked traffic are tinted amber or red (see links/NetworkLinks.jsx)
          const level = severityOf(packetColorAt(packet, t).key)
          if (level > 0) noteLinkSeverity(currentHop(packet.hops, t).link, level)
        }
        scratch.s.setScalar(scale)
        if (packet.proto === 'tcp') scratch.q.setFromUnitVectors(UP, scratch.tangent)
        else scratch.q.identity()
        scratch.m.compose(scratch.p, scratch.q, scratch.s)
        const index = used[packet.proto]++
        mesh.setMatrixAt(index, scratch.m)
        mesh.setColorAt(index, colorFor(packet, t, blend))
        pidAt.current[packet.proto][index] = packet.pid
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
      {Object.entries(SHAPES).map(([proto, geometry]) => (
        <instancedMesh
          key={proto}
          ref={(mesh) => {
            if (!mesh) return
            mesh.boundingSphere = PICK_SPHERE
            meshes.current[proto] = mesh
          }}
          args={[geometry, MATERIAL, CAPACITY]}
          frustumCulled={false}
          userData={{ pick: 'packet' }}
          {...pickHandlers(proto)}
        />
      ))}
      <primitive object={SELECT_RING} ref={marker} visible={false} />
    </group>
  )
}
