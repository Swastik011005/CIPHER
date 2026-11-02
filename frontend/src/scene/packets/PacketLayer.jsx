import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { session } from '../../playback/session.js'
import { buildLinkPaths, packetPosition } from '../links/linkPaths.js'
import { PALETTE } from '../palette.js'

const CAPACITY = 400
const DROP_MARKER_S = 0.8 // a dropped packet stays visible, red, where it died

/** Verdict colours (HDR so they glow). Neutral until the IPS has looked at the packet. */
const COLORS = {
  neutral: new THREE.Color('#cfe8ff').multiplyScalar(1.5),
  allowed: new THREE.Color(PALETTE.ok).multiplyScalar(1.8),
  flagged: new THREE.Color(PALETTE.warn).multiplyScalar(2.0),
  dropped: new THREE.Color(PALETTE.danger).multiplyScalar(2.4),
  mirror: new THREE.Color(PALETTE.sensor).multiplyScalar(1.8),
}

const SHAPES = {
  tcp: new THREE.CapsuleGeometry(0.075, 0.2, 4, 10),
  udp: new THREE.SphereGeometry(0.11, 14, 10),
  icmp: new THREE.OctahedronGeometry(0.14),
}
const MATERIAL = new THREE.MeshBasicMaterial({ toneMapped: false })
const UP = new THREE.Vector3(0, 1, 0)

function colorFor(packet, dropped) {
  if (dropped) return COLORS.dropped
  if (packet.mirrorOf != null) return COLORS.mirror
  if (packet.flagged) return COLORS.flagged
  return packet.hops.some((h) => h.from === 'IPS-1') ? COLORS.allowed : COLORS.neutral
}

/**
 * Draws every packet of the loaded trace at its position for the player's current time.
 * One instanced mesh per protocol shape (TCP capsule, UDP sphere, ICMP octahedron). Positions
 * are computed from the trace in the frame loop and never go through React state.
 * @param {{topology: any}} props
 */
export function PacketLayer({ topology }) {
  const paths = useMemo(() => buildLinkPaths(topology), [topology])
  const meshes = useRef({})
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

    if (player) {
      const t = player.time
      for (const packet of Object.values(player.state.packets)) {
        const end = packet.end
        const dropped = end?.type === 'dropped'
        if (end && (!dropped || t - end.t > DROP_MARKER_S)) continue // delivered packets are gone; old drops fade out
        const mesh = meshes.current[packet.proto]
        if (!mesh || used[packet.proto] >= CAPACITY) continue
        if (!packetPosition(paths, packet.hops, t, scratch.p, scratch.tangent)) continue

        const scale = packet.mirrorOf != null ? 0.7 : 1
        scratch.s.setScalar(scale)
        if (packet.proto === 'tcp') scratch.q.setFromUnitVectors(UP, scratch.tangent)
        else scratch.q.identity()
        scratch.m.compose(scratch.p, scratch.q, scratch.s)
        const index = used[packet.proto]++
        mesh.setMatrixAt(index, scratch.m)
        mesh.setColorAt(index, colorFor(packet, dropped))
      }
    }

    for (const [proto, mesh] of Object.entries(meshes.current)) {
      mesh.count = used[proto]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  return (
    <group name="packets">
      {Object.entries(SHAPES).map(([proto, geometry]) => (
        <instancedMesh
          key={proto}
          ref={(mesh) => {
            if (mesh) meshes.current[proto] = mesh
          }}
          args={[geometry, MATERIAL, CAPACITY]}
          frustumCulled={false}
        />
      ))}
    </group>
  )
}
