import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { bakeStatic } from './bakeStatic.js'

const clay = new THREE.MeshStandardMaterial({ color: '#ffffff' })
const dark = new THREE.MeshStandardMaterial({ color: '#222222' })
const glass = new THREE.MeshStandardMaterial({ color: '#99ccff', transparent: true, opacity: 0.3 })

function model() {
  const root = new THREE.Group()
  root.position.set(5, 0, -3)
  const add = (geometry, material, x, y, z, parent = root) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    parent.add(mesh)
    return mesh
  }
  add(new THREE.BoxGeometry(1, 1, 1), clay, 0, 0.5, 0)
  add(new THREE.CylinderGeometry(0.2, 0.2, 1, 8), clay, 1, 0.5, 0)
  const inner = new THREE.Group()
  inner.position.set(0, 2, 0)
  inner.rotation.y = Math.PI / 2
  root.add(inner)
  add(new THREE.BoxGeometry(0.5, 0.5, 2), dark, 0, 0, 0, inner)
  add(new THREE.BoxGeometry(1, 1, 1), glass, 0, 3, 0)
  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), clay, 4)
  root.add(instanced)
  return root
}

const countMeshes = (root) => {
  let n = 0
  root.traverse((o) => o.isMesh && (n += 1))
  return n
}
const bounds = (root, predicate = () => true) => {
  root.updateWorldMatrix(true, true)
  const box = new THREE.Box3()
  root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && predicate(o)) box.union(new THREE.Box3().setFromObject(o))
  })
  return box
}

describe('bakeStatic', () => {
  it('merges the opaque meshes by material, keeps transparent and instanced meshes, and does not move anything', () => {
    const root = model()
    const before = bounds(root, (o) => !o.material.transparent)
    expect(countMeshes(root)).toBe(5)
    const cleanup = bakeStatic(root)
    // two clay meshes -> one, one dark mesh -> one, plus the glass and the instanced mesh left alone
    expect(countMeshes(root)).toBe(4)
    expect(root.children.filter((o) => o.name === 'baked')).toHaveLength(2)
    const after = bounds(root, (o) => !o.material.transparent)
    for (const axis of ['x', 'y', 'z']) {
      expect(after.min[axis]).toBeCloseTo(before.min[axis], 4)
      expect(after.max[axis]).toBeCloseTo(before.max[axis], 4)
    }
    cleanup()
    expect(root.children.filter((o) => o.name === 'baked')).toHaveLength(0)
  })

  it('keeps shadow flags apart and respects userData.keep', () => {
    const root = new THREE.Group()
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), clay)
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), clay)
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), clay)
    a.castShadow = true
    c.userData.keep = true
    root.add(a, b, c)
    bakeStatic(root)
    const baked = root.children.filter((o) => o.name === 'baked')
    expect(baked).toHaveLength(2) // shadow-casting and non-casting stay separate
    expect(root.children).toContain(c) // marked to keep
    expect(baked.some((m) => m.castShadow)).toBe(true)
  })
})
