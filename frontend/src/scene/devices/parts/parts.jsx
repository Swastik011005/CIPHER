import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

import { box, cylinder, hemisphere, plane, roundedBox, sphere, torus } from '../../geometries.js'
import { materials } from '../../materials/materials.js'
import { glyphMaterial } from './glyphTextures.js'

/**
 * Small building blocks shared by every device model. They reference the shared geometry
 * cache and material singletons, so a model is just a list of positioned parts.
 */

const resolve = (material) => (typeof material === 'string' ? materials[material] : material)

/** Rounded box. `size` is [width, height, depth]. */
export function Block({ size, position, rotation, material = 'clay', radius = 0.03, shadow = true }) {
  return (
    <mesh
      geometry={roundedBox(size[0], size[1], size[2], radius)}
      material={resolve(material)}
      position={position}
      rotation={rotation}
      castShadow={shadow}
      receiveShadow={shadow}
    />
  )
}

export function Slab({ size, position, rotation, material = 'trim' }) {
  return (
    <mesh geometry={box(size[0], size[1], size[2])} material={resolve(material)} position={position} rotation={rotation} />
  )
}

export function Cyl({ radius, radiusBottom = radius, height, position, rotation, material = 'clay', segments = 20, shadow = true }) {
  return (
    <mesh
      geometry={cylinder(radius, radiusBottom, height, segments)}
      material={resolve(material)}
      position={position}
      rotation={rotation}
      castShadow={shadow}
      receiveShadow={shadow}
    />
  )
}

export function Ball({ radius, position, material = 'clay', shadow = true }) {
  return (
    <mesh geometry={sphere(radius)} material={resolve(material)} position={position} castShadow={shadow} receiveShadow={shadow} />
  )
}

export function Dome({ radius, position, material = 'radome' }) {
  return <mesh geometry={hemisphere(radius)} material={resolve(material)} position={position} />
}

export function Arc({ radius, tube, arc = Math.PI * 2, position, rotation, material = 'trim', shadow = false }) {
  return (
    <mesh
      geometry={torus(radius, tube, arc)}
      material={resolve(material)}
      position={position}
      rotation={rotation}
      castShadow={shadow}
    />
  )
}

/** Flat emissive panel (screens). Faces +z unless rotated. */
export function Screen({ width, height, position, rotation, material = 'screen' }) {
  return <mesh geometry={plane(width, height)} material={resolve(material)} position={position} rotation={rotation} />
}

/**
 * Glyph tile identifying a device. `face="top"` lies flat facing up; `face="front"` faces +z.
 */
export function Decal({ kind, position, size = 0.4, face = 'top' }) {
  return (
    <mesh
      geometry={plane(size, size)}
      material={glyphMaterial(kind)}
      position={position}
      rotation={face === 'top' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
      renderOrder={2}
    />
  )
}

/**
 * A row of ports on a front panel: a dark strip plus one instanced block per port.
 * `position` is the centre of the strip; the strip faces +z.
 */
export function PortStrip({ width, position, count = 8 }) {
  const ref = useRef(null)
  const spacing = width / count

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      dummy.position.set(-width / 2 + spacing * (i + 0.5), 0, 0.007)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [count, width, spacing])

  return (
    <group position={position}>
      <mesh geometry={box(width, 0.075, 0.012)} material={materials.dark} />
      <instancedMesh ref={ref} args={[box(spacing * 0.6, 0.042, 0.012), materials.ledOff, count]} />
    </group>
  )
}

/**
 * A grid of drive bays on a server front, instanced. `position` is the centre of the grid.
 */
export function DriveBays({ cols, rows, cell, position }) {
  const ref = useRef(null)
  const count = cols * rows

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    let i = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        dummy.position.set((c - (cols - 1) / 2) * cell * 1.2, (r - (rows - 1) / 2) * cell * 1.3, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i++, dummy.matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [cols, rows, cell])

  return (
    <instancedMesh ref={ref} position={position} args={[box(cell, cell * 0.8, 0.012), materials.dark, count]} />
  )
}
