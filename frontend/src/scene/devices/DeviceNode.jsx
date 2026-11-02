import { Edges, Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { memo, useRef } from 'react'
import { MathUtils } from 'three'

import { labelAddress, primaryAddress } from '../deviceInfo.js'
import { box, ring } from '../geometries.js'
import { NODE_LAYOUT, SLAB_TOP } from '../layout.js'
import { ringMaterials } from '../materials/materials.js'
import { useStore } from '../../state/store.js'
import { MODELS } from './models/index.js'
import { DEVICE_SPECS, hitBoxesFor, modelKeyFor } from './specs.js'

const LIFT = 0.07

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
  const showLabel = useStore((s) => labelShown(s.settings.labels, selected, hovered))
  const detail = useStore((s) => (selected || hovered ? 'full' : s.labelDetail))
  const address = primaryAddress(node)?.split('/')[0] ?? null
  const blocked = useStore((s) => address !== null && Boolean(s.playback.state?.blocks[address]))
  const gl = useThree((s) => s.gl)

  const liftRef = useRef(null)
  useFrame((_, delta) => {
    const group = liftRef.current
    if (!group) return
    const target = selected || hovered ? LIFT : 0
    if (Math.abs(group.position.y - target) > 1e-4) group.position.y = MathUtils.damp(group.position.y, target, 14, delta)
  })

  const state = blocked ? 'blocked' : selected ? 'selected' : hovered ? 'hover' : 'idle'
  const [x, z] = layout.position
  const baseY = SLAB_TOP + (layout.y ?? 0)
  const labelOffset = layout.labelOffset ?? [0, 0, 0]
  const hitBoxes = hitBoxesFor(key)

  const onOver = (event) => {
    event.stopPropagation()
    useStore.getState().hover(node.id)
    gl.domElement.style.cursor = 'pointer'
  }
  const onOut = () => {
    const store = useStore.getState()
    if (store.selection.hoveredId === node.id) store.hover(null)
    gl.domElement.style.cursor = ''
  }
  const onClick = (event) => {
    event.stopPropagation()
    useStore.getState().select(node.id)
  }

  return (
    <group position={[x, baseY, z]} rotation-y={layout.rotationY ?? 0}>
      <group ref={liftRef}>
        <Model node={node} />
      </group>

      {spec.ring ? (
        <mesh
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

      {hitBoxes.map(({ size, center }, i) => (
        <mesh key={i} position={center} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
          <boxGeometry args={size} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          {(hovered || selected) && <Edges color={selected ? '#9fd0ff' : '#4da3ff'} />}
        </mesh>
      ))}

      {showLabel && (
        <Html
          position={[labelOffset[0], spec.labelY + labelOffset[1], labelOffset[2]]}
          center
          zIndexRange={[16, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="dev-label" data-state={state} data-detail={detail}>
            <div className="dev-label__name">
              <span className="dev-label__dot" />
              {node.label}
              {blocked && <span className="dev-label__tag">BLOCKED</span>}
            </div>
            <div className="dev-label__addr">{labelAddress(node)}</div>
          </div>
        </Html>
      )}
    </group>
  )
})
