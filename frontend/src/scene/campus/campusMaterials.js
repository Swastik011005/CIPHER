import * as THREE from 'three'

/**
 * Materials of the campus layer. Shared singletons: every platform, frame and pane of a kind uses one instance, so the whole
 * campus adds only a handful of shader programs.
 *
 * Colours are kept at or below the bloom threshold: the campus must not glow. Only a selected zone's edge light goes above it.
 */
const standard = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })

export const campusMaterials = {
  /** The raised platform: matte pale blue-white, a little darker than the clay devices so they stay distinct from it and packets and rings read on it. */
  top: standard('#dde6f3', 0.85),
  /** The lower step under each platform. */
  plinth: standard('#aebdd6', 0.85),
  /** The darker mounting pad under each device: a blue-grey the pale clay stands out from. */
  pad: standard('#9fb0cc', 0.9),
  /** Grey roads between the zones. */
  road: standard('#7d8aa0', 0.95),
  /** Slim steel posts and beams. */
  frame: standard('#dde6f2', 0.35, 0.5),
  /**
   * Glass: a light blue tint at 20% opacity, matte enough (roughness 0.15, weak environment reflection) not to mirror the
   * studio lights. It never writes depth, so what is behind it is never culled, and it is one layer deep at most.
   */
  glass: standard('#9cc8ff', 0.15, 0, { transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.5 }),
}

/**
 * Edge and floor lights of every zone in one material: each light carries its zone's accent (at 0.8 of full, so below the
 * bloom threshold) as a vertex colour. Unlit.
 */
campusMaterials.lights = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })

/** Soft round contact shadow under a device: black, fading to nothing at the edge. One shared texture. */
function blobTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  const gradient = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(10,22,52,0.55)')
  gradient.addColorStop(0.55, 'rgba(10,22,52,0.28)')
  gradient.addColorStop(1, 'rgba(10,22,52,0)')
  g.fillStyle = gradient
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}
campusMaterials.blob = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, toneMapped: false })
