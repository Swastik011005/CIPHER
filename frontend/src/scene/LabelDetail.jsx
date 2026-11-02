import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'

import { useStore } from '../state/store.js'

const FULL_BELOW = 26 // world units of visible width: closer than this shows addresses
const COMPACT_ABOVE = 31 // hysteresis so the labels do not flicker at the boundary
const scratch = new Vector3()
const TAN_HALF_FOV = Math.tan((30 * Math.PI) / 360)

/**
 * Switches label detail by how much of the world the camera sees: names only when zoomed out,
 * names and addresses when close. Writes to the store only when the mode actually changes.
 */
export function LabelDetail() {
  useFrame(({ camera, controls, size }) => {
    if (!controls) return
    const target = controls.getTarget(scratch)
    const distance = camera.position.distanceTo(target)
    const visibleWidth = 2 * distance * TAN_HALF_FOV * (size.width / size.height)
    const store = useStore.getState()
    if (store.labelDetail === 'compact' && visibleWidth < FULL_BELOW) store.setLabelDetail('full')
    else if (store.labelDetail === 'full' && visibleWidth > COMPACT_ABOVE) store.setLabelDetail('compact')
  })
  return null
}
