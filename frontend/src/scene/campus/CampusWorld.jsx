import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { carMaterial } from './campusMaterials.js'
import { parkedCars } from './campusDecor.js'
import { CampusInteraction } from './CampusInteraction.jsx'
import { buildCampus } from './campusMeshes.js'

/** Decoration never takes part in picking: a click or hover passes through glass, frames, platforms and signs. */
const NO_RAYCAST = () => null

/** One car (body and cabin), shared by every parked car. */
const CAR = (() => {
  const body = new THREE.BoxGeometry(1.8, 0.62, 4.2).translate(0, 0.55, 0)
  const cabin = new THREE.BoxGeometry(1.5, 0.55, 2.2).translate(0, 1.12, -0.2)
  const merged = mergeGeometries([body, cabin], false)
  body.dispose()
  cabin.dispose()
  return merged
})()

/** The parked cars: one instanced mesh (one draw call) with a colour per car. */
function ParkedCars() {
  const ref = useRef(null)
  const cars = useMemo(() => parkedCars(), [])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const color = new THREE.Color()
    cars.forEach((car, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.yaw)
      m.compose(new THREE.Vector3(car.x, 0.04, car.z), q, new THREE.Vector3(1, 1, 1))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, color.set(car.colour))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [cars])
  return <instancedMesh ref={ref} args={[CAR, carMaterial, cars.length]} castShadow raycast={NO_RAYCAST} />
}

/**
 * The Smart Campus layer: raised platforms, glass-and-steel pavilions, the glass balustrade and the zone signs, drawn from
 * the topology and the campus layout. Purely visual: it is not part of the network, adds no state, and does nothing per frame.
 * @param {{topology: any}} props  The /api/topology response.
 */
export const CampusWorld = memo(function CampusWorld({ topology }) {
  const campus = useMemo(() => buildCampus(topology), [topology])
  useEffect(() => () => campus.dispose(), [campus])

  return (
    <group name="campus">
      {campus.parts.map((p) => (
        <mesh key={p.key} geometry={p.geometry} material={p.material} castShadow={p.cast} receiveShadow={p.receive} renderOrder={p.order} raycast={NO_RAYCAST} />
      ))}
      <mesh geometry={campus.signs.geometry} material={campus.signs.material} raycast={NO_RAYCAST} />
      <ParkedCars />
      <CampusInteraction zoneGeometry={campus.zoneGeometry} />
    </group>
  )
})
