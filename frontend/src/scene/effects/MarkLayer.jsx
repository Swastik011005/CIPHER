import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { session } from '../../playback/session.js'
import { buildLinkPaths, packetPosition } from '../links/linkPaths.js'
import { PING_DELIVER_HOLD_S, PING_DROP_HOLD_S } from '../packets/PacketLayer.jsx'
import { isPingPacket } from '../packets/packetColor.js'

/**
 * Outcome marks over the packets: a green tick on a ping's envelope when it reaches its destination or comes back to its source, and a
 * prominent red cross on any packet that is stopped, at the device that stopped it. They are drawn from the loaded trace and the
 * playhead only (a packet's end event), so pausing freezes them, seeking shows exactly that moment, and a cancelled run leaves none.
 * Two instanced billboards (one draw call each), drawn over everything so a mark is never hidden by glass or a device.
 */
const POOL = 24
const SIZE = 1.9
const LIFT = 1.6
const POP_S = 0.18

function markTexture(kind) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  const colour = kind === 'tick' ? '#34D399' : '#EF4444'
  ctx.beginPath()
  ctx.arc(64, 64, 58, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(8, 18, 36, 0.78)'
  ctx.fill()
  ctx.lineWidth = 9
  ctx.strokeStyle = colour
  ctx.stroke()
  ctx.lineWidth = 17
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = colour
  ctx.beginPath()
  if (kind === 'tick') {
    ctx.moveTo(36, 66)
    ctx.lineTo(56, 86)
    ctx.lineTo(94, 42)
  } else {
    ctx.moveTo(40, 40)
    ctx.lineTo(88, 88)
    ctx.moveTo(88, 40)
    ctx.lineTo(40, 88)
  }
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const plane = new THREE.PlaneGeometry(1, 1)

/** @param {{topology: any}} props */
export function MarkLayer({ topology }) {
  const paths = useMemo(() => buildLinkPaths(topology), [topology])
  const refs = useRef({})
  const textures = useMemo(() => ({ tick: markTexture('tick'), cross: markTexture('cross') }), [])
  const materials = useMemo(
    () => Object.fromEntries(Object.entries(textures).map(([k, map]) => [k, new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })])),
    [textures],
  )
  useEffect(
    () => () => {
      for (const t of Object.values(textures)) t.dispose()
      for (const m of Object.values(materials)) m.dispose()
    },
    [textures, materials],
  )
  const scratch = useMemo(() => ({ p: new THREE.Vector3(), tangent: new THREE.Vector3(), m: new THREE.Matrix4(), s: new THREE.Vector3() }), [])

  useFrame(({ camera }) => {
    const player = session.player
    const used = { tick: 0, cross: 0 }
    if (player) {
      const t = player.time
      for (const packet of Object.values(player.state.packets)) {
        const end = packet.end
        if (!end || packet.mirrorOf != null) continue
        const dropped = end.type === 'dropped'
        const ping = isPingPacket(packet)
        if (!dropped && !ping) continue // a tick marks the arrival of a ping envelope; every blocked packet gets a cross
        const hold = dropped ? PING_DROP_HOLD_S : PING_DELIVER_HOLD_S
        const age = t - end.t
        if (age < 0 || age > hold) continue
        const kind = dropped ? 'cross' : 'tick'
        if (used[kind] >= POOL || !packetPosition(paths, packet.hops, end.t, scratch.p, scratch.tangent)) continue
        const pop = Math.min(1, age / POP_S)
        const fade = age > hold - 0.4 ? Math.max(0, (hold - age) / 0.4) : 1
        const scale = SIZE * (0.4 + 0.6 * (1 - (1 - pop) ** 3)) * (0.6 + 0.4 * fade)
        scratch.p.y += LIFT
        scratch.s.setScalar(scale)
        scratch.m.compose(scratch.p, camera.quaternion, scratch.s)
        refs.current[kind]?.setMatrixAt(used[kind]++, scratch.m)
      }
    }
    for (const kind of ['tick', 'cross']) {
      const mesh = refs.current[kind]
      if (!mesh) continue
      mesh.count = used[kind]
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group name="marks">
      {['tick', 'cross'].map((kind) => (
        <instancedMesh
          key={kind}
          ref={(mesh) => {
            if (mesh) refs.current[kind] = mesh
          }}
          args={[plane, materials[kind], POOL]}
          frustumCulled={false}
          renderOrder={12}
          raycast={() => null}
        />
      ))}
    </group>
  )
}
