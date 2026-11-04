import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { useStore } from '../state/store.js'
import { shouldLowerQuality } from './quality.js'

/**
 * Counts what the main pass draws by walking the scene. The renderer's own counters are not
 * usable here: the post-processing composer resets them for every full-screen pass, so they
 * only ever describe the last one.
 * @param {import('three').Object3D} scene
 */
export function countScene(scene) {
  let meshes = 0
  let triangles = 0
  scene.traverse((object) => {
    if (!object.isMesh || !object.visible || object.material?.visible === false) return // pick volumes are never drawn
    const geometry = object.geometry
    const vertices = geometry.index ? geometry.index.count : geometry.attributes.position.count
    meshes += 1
    triangles += (vertices / 3) * (object.isInstancedMesh ? object.count : 1)
  })
  return { meshes, triangles: Math.round(triangles) }
}

/**
 * Samples frame rate and scene size once per second and publishes them on
 * `window.__netsecScene`, so performance can be read from the console or automated checks
 * without an on-screen overlay. The simulation page shows them when opened with ?debug=1.
 * `meshes` is the number of draw calls in the main pass; the shadow pass roughly doubles it.
 */
export function SceneStats() {
  const state = useRef({ frames: 0, since: performance.now(), samples: [] })
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)

  // Debug aid, only with ?debug=1: where a world position is on the page, so an automated check can
  // aim a real mouse click at a packet. Positions of packets come from PacketLayer.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return undefined
    const v = new Vector3()
    window.__netsecProbe = {
      /** Page coordinates (CSS px) of a world point, or null when it is behind the camera. */
      toPage(x, y, z) {
        v.set(x, y, z).project(camera)
        if (v.z > 1) return null
        const r = canvas.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
      },
      /** Where the campus camera is, so a check can see that it moved, or did not. */
      cameraPosition: () => camera.position.toArray(),
    }
    return () => {
      delete window.__netsecProbe
    }
  }, [camera, canvas])

  useFrame(({ gl, scene }) => {
    const s = state.current
    s.frames += 1
    const now = performance.now()
    if (now - s.since < 1000) return
    window.__netsecScene = {
      fps: Math.round((s.frames * 1000) / (now - s.since)),
      ...countScene(scene),
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      pixelRatio: gl.getPixelRatio(),
      sampledAt: Date.now(),
    }
    // On a slow GPU the High preset runs far below Rev 3's targets: fall back to Low once, and say so.
    s.samples = [...s.samples, window.__netsecScene.fps].slice(-10)
    const store = useStore.getState()
    if (shouldLowerQuality(s.samples, store.settings.quality, store.autoLowered)) store.lowerQualityAutomatically(window.__netsecScene.fps)
    s.frames = 0
    s.since = now
  })
  return null
}
