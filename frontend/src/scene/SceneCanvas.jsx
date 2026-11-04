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
 * The persistent 3D canvas. It renders only while the Simulation page is showing it and keeps
 * its WebGL context across page changes.
 */
export default function SceneCanvas() {
  const quality = useStore((s) => s.settings.quality)
  const topology = useStore((s) => s.topology.data)
  const [dpr, setDpr] = useState(1.5)
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
      {/* Lower the pixel ratio if the frame rate sags; raise it again when there is headroom. */}
      <Selection>
        <PerformanceMonitor onChange={({ factor }) => setDpr(Math.round(Math.min(1.75, Math.max(1, 0.9 + 0.85 * factor)) * 100) / 100)} />
        <FrameloopController />
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
