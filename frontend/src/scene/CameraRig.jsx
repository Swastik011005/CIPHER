import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Box3, Vector3 } from 'three'

import { useStore } from '../state/store.js'
import {
  CAMERA_BOUNDARY,
  CAMERA_LIMITS,
  CAMERA_PRESETS,
  DEFAULT_PRESET_ID,
  NODE_LAYOUT,
  SLAB_TOP,
  distanceScaleForAspect,
  presetPosition,
} from './layout.js'
import { DEVICE_SPECS, modelKeyFor } from './devices/specs.js'

const FOCUS_DISTANCE = 15
const scratchTarget = new Vector3()
const scratchPosition = new Vector3()

/**
 * Orbit / pan / zoom with damping, limited so the camera stays over the campus.
 * Mouse: left-drag rotates, right-drag pans, wheel zooms toward the cursor. Touch: one finger
 * rotates, two fingers zoom and pan. Presets and "focus on device" are requested through the
 * store and animated here.
 */
export function CameraRig() {
  const controls = useRef(null)
  const request = useStore((s) => s.cameraRequest)
  const topology = useStore((s) => s.topology.data)
  const size = useThree((s) => s.size)
  // Quantised so a pixel of resize does not re-frame the camera.
  const fit = Math.round(distanceScaleForAspect(size.width / size.height) * 20) / 20
  const fitRef = useRef(fit)
  fitRef.current = fit

  // Frame the overview before the first paint.
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const preset = CAMERA_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)
    c.setBoundary(new Box3(new Vector3(...CAMERA_BOUNDARY.min), new Vector3(...CAMERA_BOUNDARY.max)))
    c.setLookAt(...presetPosition(preset, fitRef.current), ...preset.target, false)
  }, [])

  // The canvas changed shape (window resize, sidebar collapse): re-frame the preset in use.
  useEffect(() => {
    const c = controls.current
    const { activePreset } = useStore.getState()
    const preset = CAMERA_PRESETS.find((p) => p.id === activePreset)
    if (c && preset) c.setLookAt(...presetPosition(preset, fit), ...preset.target, true)
  }, [fit])

  useEffect(() => {
    const c = controls.current
    if (!c || !request) return

    if (request.kind === 'preset') {
      const preset = CAMERA_PRESETS.find((p) => p.id === request.id)
      if (preset) c.setLookAt(...presetPosition(preset, fitRef.current), ...preset.target, true)
      return
    }

    const node = topology?.nodes.find((n) => n.id === request.id)
    const layout = node && NODE_LAYOUT[request.id]
    if (!layout) return
    const spec = DEVICE_SPECS[modelKeyFor(node, layout)]
    const [x, z] = layout.position
    const target = [x, SLAB_TOP + (layout.y ?? 0) + spec.height / 2, z]
    // Keep the current viewing direction, just move in on the device.
    c.getTarget(scratchTarget)
    c.getPosition(scratchPosition)
    const direction = scratchPosition.sub(scratchTarget).normalize()
    c.setLookAt(
      target[0] + direction.x * FOCUS_DISTANCE,
      target[1] + direction.y * FOCUS_DISTANCE,
      target[2] + direction.z * FOCUS_DISTANCE,
      ...target,
      true,
    )
  }, [request, topology])

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.3}
      draggingSmoothTime={0.12}
      dollyToCursor
      minDistance={CAMERA_LIMITS.minDistance}
      maxDistance={CAMERA_LIMITS.maxDistance}
      minPolarAngle={CAMERA_LIMITS.minPolarAngle}
      maxPolarAngle={CAMERA_LIMITS.maxPolarAngle}
      onStart={() => useStore.getState().clearActivePreset()}
    />
  )
}
