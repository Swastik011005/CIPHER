import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Draw-call saving for static device models.
 *
 * A device model is built from many small meshes (a desk, a monitor, a bezel, keys). They never move relative to each other, so
 * once the model has mounted its opaque meshes are merged into one mesh per material (and shadow setting) and the originals are
 * removed. A desktop that cost eleven draw calls then costs four. The look is identical: the same geometry in the same place with
 * the same material. Transparent meshes, instanced meshes and anything marked `userData.keep` stay as they are, so animated
 * or see-through parts keep working.
 *
 * @param {import('three').Object3D} root  The group that holds the mounted model.
 * @returns {() => void}  Cleanup: removes the merged meshes and frees their geometry.
 */
export function bakeStatic(root) {
  root.updateWorldMatrix(true, true)
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const buckets = new Map()
  const originals = []

  root.traverse((object) => {
    if (!object.isMesh || object.isInstancedMesh || object.userData?.keep || !object.visible) return
    const material = object.material
    if (Array.isArray(material) || material.transparent || material.visible === false) return
    const source = object.geometry
    const geometry = source.index ? source.toNonIndexed() : source.clone()
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name)
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2))
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, object.matrixWorld))
    const key = `${material.uuid}|${object.castShadow}|${object.receiveShadow}|${object.renderOrder}`
    const bucket = buckets.get(key) ?? { material, cast: object.castShadow, receive: object.receiveShadow, order: object.renderOrder, geometries: [] }
    bucket.geometries.push(geometry)
    buckets.set(key, bucket)
    originals.push(object)
  })

  const baked = []
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geometries, false)
    for (const g of bucket.geometries) g.dispose()
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, bucket.material)
    mesh.castShadow = bucket.cast
    mesh.receiveShadow = bucket.receive
    mesh.renderOrder = bucket.order
    mesh.name = 'baked'
    root.add(mesh)
    baked.push(mesh)
  }
  for (const object of originals) object.parent?.remove(object)

  return () => {
    for (const mesh of baked) {
      mesh.parent?.remove(mesh)
      mesh.geometry.dispose()
    }
  }
}

/** Models that are static once built. The sensor (a spinning radar) and the Internet cloud are left alone. */
export const BAKED_MODELS = new Set(['desktop', 'laptop', 'router', 'switch-l3', 'switch-l2', 'switch-rack', 'rack-server', 'soc-console', 'firewall', 'ips-appliance'])
