import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

import { activeEffects, effectsFor } from '../../playback/effects.js'
import { session } from '../../playback/session.js'
import { NODE_LAYOUT, SLAB_TOP } from '../layout.js'
import { buildLinkPaths, packetPosition } from '../links/linkPaths.js'
import { PALETTE } from '../palette.js'
import { RING_STYLE, SHARDS, SHARD_POOL, TONE_COLOR, labelOpacity, ringOpacity, shardOffset } from './effectMath.js'

const RING_POOL = 32
const LABEL_POOL = 4
const FLOOR_LIFT = 0.04

const ringGeometry = new THREE.RingGeometry(0.92, 1, 48)
const shardGeometry = new THREE.TetrahedronGeometry(0.11)

const COLORS = Object.fromEntries(Object.entries(TONE_COLOR).map(([tone, [hex, gain]]) => [tone, new THREE.Color(PALETTE[hex]).multiplyScalar(gain)]))

/** Where a device stands in the world (floor level, centre of its footprint). */
function nodeOrigin(id, out) {
  const layout = NODE_LAYOUT[id]
  if (!layout) return false
  out.set(layout.position[0], SLAB_TOP + (layout.y ?? 0) + FLOOR_LIFT, layout.position[1])
  return true
}

/**
 * Draws the trace's visual effects: rings on the floor around devices (delivery, SPAN mirror, IDS-1
 * radar, IPS verdicts, block/unblock), a standing ripple at the firewall, an ACL flash on the core
 * switch, and shards where a packet is dropped. Which effects are alive, and how far along, comes
 * from `activeEffects(effects, player.time)`: a pure function of the trace and the playhead, so
 * pausing freezes them, seeking shows exactly that moment's effects, and nothing can run twice.
 * Meshes come from fixed pools and are never created or destroyed during playback.
 * @param {{topology: any}} props
 */
export function EffectsLayer({ topology }) {
  const paths = useMemo(() => buildLinkPaths(topology), [topology])
  const ringRefs = useRef([])
  const labelGroups = useRef([])
  const labelTexts = useRef([])
  const shards = useRef(null)
  const scratch = useMemo(
    () => ({ origin: new THREE.Vector3(), p: new THREE.Vector3(), tangent: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), e: new THREE.Euler() }),
    [],
  )
  const shardColor = COLORS.danger

  const ringMaterials = useMemo(
    () => Array.from({ length: RING_POOL }, () => new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide })),
    [],
  )
  const shardMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: shardColor, toneMapped: false }), [shardColor])

  useFrame(() => {
    const player = session.player
    const live = player ? activeEffects(effectsFor(player.events), player.time) : []

    let rings = 0
    let labels = 0
    let shardCount = 0
    const { origin, p, tangent, m, q, s, e: euler } = scratch

    for (const { effect, progress } of live) {
      if (effect.kind === 'shatter') {
        const packet = player.state.packets[effect.pid]
        if (!packet || !packetPosition(paths, packet.hops, player.time, p, tangent)) continue
        for (let i = 0; i < SHARDS && shardCount < SHARD_POOL; i += 1) {
          const [dx, dy, dz, scale] = shardOffset(effect.pid, i, progress)
          q.setFromEuler(euler.set(progress * 5 + i, progress * 4, i))
          s.setScalar(scale)
          m.compose(origin.set(p.x + dx, p.y + dy, p.z + dz), q, s)
          shards.current?.setMatrixAt(shardCount, m)
          shardCount += 1
        }
        continue
      }

      const style = RING_STYLE[effect.kind]
      if (!style || rings >= RING_POOL || !nodeOrigin(effect.node, origin)) continue
      const mesh = ringRefs.current[rings]
      const material = ringMaterials[rings]
      rings += 1
      const radius = style.r0 + (style.r1 - style.r0) * (1 - (1 - progress) ** 2)
      mesh.visible = true
      mesh.position.copy(origin)
      mesh.scale.setScalar(radius)
      if (style.vertical) {
        mesh.position.y += radius * 0.55
        mesh.rotation.set(0, NODE_LAYOUT[effect.node].rotationY ?? 0, 0)
      } else mesh.rotation.set(-Math.PI / 2, 0, 0)
      material.color.copy(COLORS[effect.tone])
      material.opacity = ringOpacity(progress, style.strength)

      if (effect.label && style.label && labels < LABEL_POOL) {
        const group = labelGroups.current[labels]
        const text = labelTexts.current[labels]
        group.visible = true
        group.position.set(origin.x, origin.y + style.label, origin.z)
        text.textContent = effect.label
        text.dataset.tone = effect.tone
        text.style.opacity = String(labelOpacity(progress))
        labels += 1
      }
    }

    for (let i = rings; i < RING_POOL; i += 1) if (ringRefs.current[i]) ringRefs.current[i].visible = false
    for (let i = labels; i < LABEL_POOL; i += 1) if (labelGroups.current[i]) labelGroups.current[i].visible = false
    const instanced = shards.current
    if (instanced) {
      instanced.count = shardCount
      instanced.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group name="effects">
      {ringMaterials.map((material, i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            if (mesh) ringRefs.current[i] = mesh
          }}
          geometry={ringGeometry}
          material={material}
          visible={false}
          renderOrder={3}
          frustumCulled={false}
        />
      ))}
      <instancedMesh ref={shards} args={[shardGeometry, shardMaterial, SHARD_POOL]} frustumCulled={false} />
      {Array.from({ length: LABEL_POOL }, (_, i) => (
        <group
          key={i}
          ref={(group) => {
            if (group) labelGroups.current[i] = group
          }}
          visible={false}
        >
          <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div
              className="fx-label"
              ref={(el) => {
                if (el) labelTexts.current[i] = el
              }}
            />
          </Html>
        </group>
      ))}
    </group>
  )
}
