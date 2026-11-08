import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'

import { useStore } from '../state/store.js'

const FULL_BELOW = 26 // world units of visible width: closer than this shows addresses
const COMPACT_ABOVE = 31 // hysteresis so the labels do not flicker at the boundary
const FAR_ABOVE = 72 // zoomed out this far, the labels of endpoints (PCs, laptops, rack servers) are hidden so the campus stays readable
const FAR_BELOW = 64
const scratch = new Vector3()
const TAN_HALF_FOV = Math.tan((30 * Math.PI) / 360)

/**
 * Switches label detail by how much of the world the camera sees: no endpoint labels when far out, names only
 * when zoomed out, names and addresses when close. Writes to the store only when the mode actually changes.
 */
export function LabelDetail() {
  useFrame(({ camera, controls, size }) => {
    if (!controls) return
    const target = controls.getTarget(scratch)
    const distance = camera.position.distanceTo(target)
    const visibleWidth = 2 * distance * TAN_HALF_FOV * (size.width / size.height)
    const store = useStore.getState()
    let next = store.labelDetail
    if (next === 'full' && visibleWidth > COMPACT_ABOVE) next = 'compact'
    else if (next === 'compact') next = visibleWidth < FULL_BELOW ? 'full' : visibleWidth > FAR_ABOVE ? 'far' : 'compact'
    else if (next === 'far' && visibleWidth < FAR_BELOW) next = 'compact'
    if (next !== store.labelDetail) store.setLabelDetail(next)
  })
  return null
}
