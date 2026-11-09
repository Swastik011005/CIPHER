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
import { zoneFocus } from './campus/campusLayout.js'
import { DEVICE_SPECS, modelKeyFor } from './devices/specs.js'

const FOCUS_DISTANCE = 15
const scratchTarget = new Vector3()
const scratchPosition = new Vector3()

/**
 * Orbit / pan / zoom with damping, limited so the camera stays over the campus.
 * Mouse: left-drag rotates, right-drag or middle-button drag (wheel click) pans, wheel zooms toward the cursor. Touch: one finger
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

  // A middle-button press on a page that can scroll starts the browser's autoscroll (the round scroll icon) unless it is cancelled:
  // the canvas takes that button for panning, so cancel the default and the follow-up click.
  const dom = useThree((st) => st.gl.domElement)
  useEffect(() => {
    const stop = (event) => {
      if (event.button === 1) event.preventDefault()
    }
    dom.addEventListener('mousedown', stop)
    dom.addEventListener('auxclick', stop)
    return () => {
      dom.removeEventListener('mousedown', stop)
      dom.removeEventListener('auxclick', stop)
    }
  }, [dom])

  // Frame the overview before the first paint.
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const preset = CAMERA_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)
    c.setBoundary(new Box3(new Vector3(...CAMERA_BOUNDARY.min), new Vector3(...CAMERA_BOUNDARY.max)))
    // The middle button (wheel click) pans like the right button: the whole scene follows the drag left/right and up/down, in the screen plane.
    // camera-controls keeps its action constants on the class, so the rig does not need to import the library itself.
    const { ACTION } = c.constructor
    c.mouseButtons.middle = ACTION.TRUCK
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

    if (request.kind === 'zone') {
      // Fly to a campus zone: keep the way round the user is looking from, look down at a pleasant angle, and frame the whole zone.
      const view = zoneFocus(request.id)
      if (!view) return
      c.getTarget(scratchTarget)
      c.getPosition(scratchPosition)
      const azimuth = Math.atan2(scratchPosition.x - scratchTarget.x, scratchPosition.z - scratchTarget.z)
      const elevation = (36 * Math.PI) / 180
      const d = view.distance * fitRef.current
      c.setLookAt(
        view.target[0] + d * Math.sin(azimuth) * Math.cos(elevation),
        view.target[1] + d * Math.sin(elevation),
        view.target[2] + d * Math.cos(azimuth) * Math.cos(elevation),
        ...view.target,
        true,
      )
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
      smoothTime={0.45}
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
