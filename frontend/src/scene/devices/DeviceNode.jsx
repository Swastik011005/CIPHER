import { Edges, Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Select } from '@react-three/postprocessing'
import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, MathUtils, MeshBasicMaterial } from 'three'

import { deviceTags, parseTagsKey, ringStateFor, tagsKey } from '../../playback/deviceStatus.js'
import { session } from '../../playback/session.js'
import { ZONE_OF_DEVICE } from '../campus/campusLayout.js'
import { labelAddress, primaryAddress } from '../deviceInfo.js'
import { box, ring } from '../geometries.js'
import { NODE_LAYOUT, SLAB_TOP } from '../layout.js'
import { ringMaterials } from '../materials/materials.js'
import { isTopPick } from '../picking.js'
import { useStore } from '../../state/store.js'
import { activityAt } from './activity.js'
import { BAKED_MODELS, bakeStatic } from './bakeStatic.js'
import { MODELS } from './models/index.js'
import { DEVICE_SPECS, hitBoxesFor, modelKeyFor } from './specs.js'

const LIFT = 0.07
const HIT_MATERIAL = new MeshBasicMaterial({ visible: false }) // pickable, never drawn: no draw call
const ENDPOINT_MODELS = new Set(['desktop', 'laptop', 'rack-server']) // their labels are hidden when the camera is far out
const LED_COLOR = new Color('#38d6e6').multiplyScalar(2.4)

function labelShown(mode, selected, hovered) {
  if (mode === 'all') return true
  if (mode === 'selected') return selected || hovered
  return false
}

/**
 * One device in the scene: its model, floor status ring, selection frame, floating label and
 * pointer handling. Reads only its own hover/selection state so other devices never re-render.
 * @param {{node: any}} props  A topology node.
 */
export const DeviceNode = memo(function DeviceNode({ node }) {
  const layout = NODE_LAYOUT[node.id]
  const key = modelKeyFor(node, layout)
  const spec = DEVICE_SPECS[key]
  const Model = MODELS[key]

  const selected = useStore((s) => s.selection.selectedId === node.id)
  const hovered = useStore((s) => s.selection.hoveredId === node.id)
  const hideFar = useStore((s) => s.labelDetail === 'far')
  const showLabel = useStore((s) => labelShown(s.settings.labels, selected, hovered))
  const detail = useStore((s) => (selected || hovered ? 'full' : s.labelDetail))
  const high = useStore((s) => s.settings.quality === 'high')
  // A selected campus zone highlights its devices and dims the rest; a selected cable highlights its two ends.
  const zoneState = useStore((s) => (s.zone.selectedId === null ? null : ZONE_OF_DEVICE[node.id] === s.zone.selectedId ? 'in' : 'out'))
  const cableEnd = useStore((s) => {
    const id = s.cable.selectedId
    const link = id === null ? null : s.topology.data?.links.find((l) => l.id === id)
    return Boolean(link && (link.a.node === node.id || link.b.node === node.id))
  })
  const address = primaryAddress(node)?.split('/')[0] ?? null
  const tags = parseTagsKey(useStore((s) => tagsKey(deviceTags(node, address, s.playback.state, Boolean(s.securityState?.isolated?.includes(node.id))))))
  const gl = useThree((s) => s.gl)
  // drei's Html re-creates its DOM root when R3F connects its event target, but does not render into the new root. The
  // first label to mount, before that happens, would stay empty. Keying on the connection remounts it afterwards.
  const eventsConnected = useThree((s) => !!s.events.connected)

  const liftRef = useRef(null)
  const modelRef = useRef(null)
  // Merge the opaque meshes of a static model once it has mounted: fewer draw calls, same picture.
  useLayoutEffect(() => (BAKED_MODELS.has(key) && modelRef.current ? bakeStatic(modelRef.current) : undefined), [key])
  const ringRef = useRef(null)
  const ledRef = useRef(null)
  // A small activity LED: lit while the device is handling packets, from the trace at the playhead.
  const ledMaterial = useMemo(() => new MeshBasicMaterial({ color: LED_COLOR, transparent: true, toneMapped: false, depthWrite: false }), [])
  useFrame((_, delta) => {
    const group = liftRef.current
    if (group) {
      const target = selected || hovered ? LIFT : 0
      if (Math.abs(group.position.y - target) > 1e-4) group.position.y = MathUtils.damp(group.position.y, target, 14, delta)
    }
    const player = session.player
    const activity = player ? activityAt(player.state.nodes[node.id], player.time) : 0
    if (ringRef.current) ringRef.current.scale.setScalar(1 + 0.14 * activity) // the floor ring swells while busy
    if (ledRef.current) {
      ledRef.current.visible = activity > 0.02
      ledMaterial.opacity = activity
    }
  })

  let state = ringStateFor(tags, selected, hovered)
  if (state === 'idle' && (zoneState === 'in' || cableEnd)) state = 'related'
  const [x, z] = layout.position
  const baseY = SLAB_TOP + (layout.y ?? 0)
  const labelOffset = layout.labelOffset ?? [0, 0, 0]
  const hitBoxes = hitBoxesFor(key)

  const onOver = (event) => {
    if (!isTopPick(event, 'device')) return
    event.stopPropagation()
    useStore.getState().hover(node.id)
    useStore.getState().hoverZone(null)
    gl.domElement.style.cursor = 'pointer'
  }
  const onOut = () => {
    const store = useStore.getState()
    if (store.selection.hoveredId === node.id) store.hover(null)
    gl.domElement.style.cursor = ''
  }
  const onClick = (event) => {
    if (!isTopPick(event, 'device')) return
    event.stopPropagation()
    useStore.getState().select(node.id)
  }
  // Double-clicking a device opens the 3D viewer. A double-click on a pavilion's own volume focuses the zone instead,
  // and the two never overlap: a device on the ray always wins (see picking.js).
  const onDoubleClick = (event) => {
    if (!isTopPick(event, 'device')) return
    event.stopPropagation()
    useStore.getState().openInspector(node.id)
  }

  return (
    <group name={`device-${node.id}`} position={[x, baseY, z]} rotation-y={layout.rotationY ?? 0}>
      <group ref={liftRef}>
        {/* While selected (High) the postprocessing outline traces the model's own silhouette; Low keeps the box frame. */}
        <Select enabled={selected && high}>
          <group ref={modelRef}>
            <Model node={node} />
          </group>
        </Select>
      </group>

      {spec.ring ? (
        <mesh
          ref={ringRef}
          geometry={ring(spec.ring, spec.ring + 0.07)}
          material={ringMaterials[state]}
          position={[0, 0.014 - (layout.y ?? 0), 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={1}
        />
      ) : (
        <mesh
          geometry={box(spec.half[0] * 1.9, 0.03, 0.012)}
          material={ringMaterials[state]}
          position={[0, 0.012, spec.half[1] + 0.004]}
        />
      )}

      <mesh ref={ledRef} position={[spec.half[0] * 0.55, spec.height + 0.1, spec.half[1] * 0.4]} material={ledMaterial} visible={false}>
        <sphereGeometry args={[0.07, 12, 8]} />
      </mesh>

      {hitBoxes.map(({ size, center }, i) => (
        <mesh key={i} position={center} material={HIT_MATERIAL} userData={{ pick: 'device', device: node.id }} onPointerMove={onOver} onPointerOut={onOut} onClick={onClick} onDoubleClick={onDoubleClick}>
          <boxGeometry args={size} />
          {(hovered || (selected && !high)) && <Edges color={selected ? '#9fd0ff' : '#4da3ff'} />}
        </mesh>
      ))}

      {showLabel && !(hideFar && ENDPOINT_MODELS.has(key) && !selected && !hovered && tags.length === 0 && zoneState !== 'in') && (
        <Html
          key={eventsConnected ? 'connected' : 'pending'}
          position={[labelOffset[0], spec.labelY + labelOffset[1], labelOffset[2]]}
          center
          zIndexRange={[16, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="dev-label" data-state={state} data-detail={detail} data-zone={zoneState ?? undefined}>
            <div className="dev-label__name">
              <span className="dev-label__dot" />
              {node.label}
              {tags.map((tag) => (
                <span key={tag.text} className="dev-label__tag" data-tone={tag.tone}>
                  {tag.text}
                </span>
              ))}
            </div>
            <div className="dev-label__addr">{labelAddress(node)}</div>
          </div>
        </Html>
      )}
    </group>
  )
})
