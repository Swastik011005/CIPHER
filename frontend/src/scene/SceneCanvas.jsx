import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Selection } from '@react-three/postprocessing'
import { useEffect, useState } from 'react'
import * as THREE from 'three'

import { useStore } from '../state/store.js'
import { CameraRig } from './CameraRig.jsx'
import { LabelDetail } from './LabelDetail.jsx'
import { CAMERA_PRESETS, DEFAULT_PRESET_ID, presetPosition } from './layout.js'
import { Lighting } from './Lighting.jsx'
import { NetworkWorld } from './NetworkWorld.jsx'
import { PostFX } from './PostFX.jsx'
import { SceneStats } from './SceneStats.jsx'
import './scene.css'

const OVERVIEW = CAMERA_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)

/**
 * Pauses rendering while the Simulation page is not showing the canvas and resumes it when it
 * returns. R3F does not restart its loop when `frameloop` flips back to "always", so the resume
 * is explicit: set the mode, then invalidate to kick the first frame.
 */
function FrameloopController() {
  const visible = useStore((s) => s.sceneVisible)
  const setFrameloop = useThree((s) => s.setFrameloop)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    setFrameloop(visible ? 'always' : 'never')
    if (visible) invalidate()
  }, [visible, setFrameloop, invalidate])

  return null
}

/**
 * The campus does not move, so its shadow map is drawn only when something that casts a shadow can have changed (the scene built,
 * the quality switched, a device selected or hovered and lifted) instead of every frame. That removes the whole shadow pass from
 * the frame loop: a measurable saving on a slow GPU, and the picture is the same.
 */
function ShadowController() {
  const gl = useThree((s) => s.gl)
  const quality = useStore((s) => s.settings.quality)
  const topology = useStore((s) => s.topology.data)
  const hovered = useStore((s) => s.selection.hoveredId)
  const selected = useStore((s) => s.selection.selectedId)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])
  useEffect(() => {
    const timers = [0, 300, 1000].map((delay) => setTimeout(() => (gl.shadowMap.needsUpdate = true), delay))
    return () => timers.forEach(clearTimeout)
  }, [gl, quality, topology, hovered, selected])
  return null
}

/**
 * The persistent 3D canvas. It renders only while the Simulation page is showing it and keeps
 * its WebGL context across page changes.
 */
export default function SceneCanvas() {
  const quality = useStore((s) => s.settings.quality)
  const topology = useStore((s) => s.topology.data)
  const [dpr, setDpr] = useState(1.1)
  const high = quality === 'high'

  return (
    <Canvas
      className="scene-canvas"
      dpr={high ? dpr : 1}
      shadows="percentage"
      frameloop="always"
      camera={{ fov: 30, near: 0.5, far: 400, position: presetPosition(OVERVIEW) }}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
      onPointerMissed={() => useStore.getState().clearEverything()}
    >
      {/* Lower the pixel ratio if the frame rate sags; raise it again when there is headroom (at most 1.25: the campus is large, and a sharper image is not worth dropping below 30 fps). */}
      <Selection>
        <PerformanceMonitor onChange={({ factor }) => setDpr(Math.round(Math.min(1.25, Math.max(1, 0.9 + 0.85 * factor)) * 100) / 100)} />
        <FrameloopController />
        <ShadowController />
        <Lighting shadows={high} />
        <CameraRig />
        <LabelDetail />
        {topology && <NetworkWorld topology={topology} />}
        <PostFX quality={quality} />
        <SceneStats />
      </Selection>
    </Canvas>
  )
}
