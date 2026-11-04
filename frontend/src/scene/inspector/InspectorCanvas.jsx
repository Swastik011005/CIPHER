import { CameraControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Selection } from '@react-three/postprocessing'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { campusMaterials } from '../campus/campusMaterials.js'
import { MODELS } from '../devices/models/index.js'
import { SLAB_TOP } from '../layout.js'
import { Lighting } from '../Lighting.jsx'
import { PostFX } from '../PostFX.jsx'
import { modelKeyOfNode, viewerFraming } from './modelInfo.js'

const AZIMUTH = (40 * Math.PI) / 180
const ELEVATION = (24 * Math.PI) / 180

function homePosition(framing) {
  const [cx, cy, cz] = framing.center
  const y = SLAB_TOP + cy
  return {
    position: [cx + framing.distance * Math.sin(AZIMUTH) * Math.cos(ELEVATION), y + framing.distance * Math.sin(ELEVATION), cz + framing.distance * Math.cos(AZIMUTH) * Math.cos(ELEVATION)],
    target: [cx, y, cz],
  }
}

/** The device on a round pedestal of the same pale material as the campus platforms, framed by its own camera. */
const Scene = forwardRef(function Scene({ node, quality }, ref) {
  const controls = useRef(null)
  const key = modelKeyOfNode(node)
  const Model = MODELS[key]
  const framing = useMemo(() => viewerFraming(key), [key])
  const home = useMemo(() => homePosition(framing), [framing])
  const floor = useMemo(() => new THREE.CylinderGeometry(framing.floorRadius, framing.floorRadius, SLAB_TOP, 64).translate(0, SLAB_TOP / 2, 0), [framing])
  useEffect(() => () => floor.dispose(), [floor])

  // Debug aid (?debug=1): the viewer camera and its renderer's resource counts, for automated checks.
  const camera = useThree((st) => st.camera)
  const gl = useThree((st) => st.gl)
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return undefined
    window.__netsecInspector = { cameraPosition: () => camera.position.toArray(), info: () => ({ geometries: gl.info.memory.geometries, textures: gl.info.memory.textures }), model: key }
    return () => {
      delete window.__netsecInspector
    }
  }, [camera, gl, key])

  const reset = (animate) => controls.current?.setLookAt(...home.position, ...home.target, animate)
  useImperativeHandle(ref, () => ({ reset: () => reset(true) }))
  // frame the model before the first paint, and again whenever another device is shown
  useEffect(() => {
    reset(false) // (no return value: setLookAt returns a promise, which React would take for a cleanup function)
  }, [home]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Lighting shadows={quality === 'high'} />
      <mesh geometry={floor} material={campusMaterials.top} receiveShadow />
      <group position={[0, SLAB_TOP, 0]}>
        <Model node={node} />
      </group>
      <CameraControls ref={controls} makeDefault smoothTime={0.25} draggingSmoothTime={0.1} minDistance={framing.minDistance} maxDistance={framing.maxDistance} minPolarAngle={(8 * Math.PI) / 180} maxPolarAngle={(88 * Math.PI) / 180} />
      <PostFX quality={quality} />
    </>
  )
})

/**
 * The 3D viewer's own Canvas (a second WebGL context). It exists only while the viewer is open: closing the viewer unmounts it
 * and R3F disposes its renderer and releases the context. Geometry and materials of the device models are shared with the
 * campus scene; each renderer uploads its own GPU copy, so neither affects the other.
 */
export const InspectorCanvas = forwardRef(function InspectorCanvas({ node, quality }, ref) {
  return (
    <Canvas
      className="inspector__canvas"
      dpr={quality === 'high' ? [1, 1.5] : 1}
      shadows={quality === 'high' ? 'percentage' : false}
      camera={{ fov: 30, near: 0.2, far: 200, position: [8, 6, 8] }}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
    >
      <Selection>
        <Scene ref={ref} node={node} quality={quality} />
      </Selection>
    </Canvas>
  )
})
