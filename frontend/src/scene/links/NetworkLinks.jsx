import { memo, useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { cableMaterials } from '../materials/materials.js'
import { PALETTE } from '../palette.js'
import { LINK_LAYOUT } from '../layout.js'
import { useStore } from '../../state/store.js'
import { buildCableGeometry } from './cableGeometry.js'
import { buildCablePoints } from './cablePoints.js'

const RADIUS = { ethernet: 0.04, access: 0.04, trunk: 0.042, mgmt: 0.026, span: 0.034 }
const TRUNK_LANE = 0.055

/** Alpha map giving the SPAN cable its dashes. Each cable gets its own repeat count. */
function dashTexture(length) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 4
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 64, 4)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 34, 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.repeat.set(Math.max(1, Math.round(length / 0.45)), 1)
  return texture
}

/** One cable (two parallel tubes for a trunk). Geometry is rebuilt only when its route changes. */
const Cable = memo(function Cable({ link, nodesById }) {
  const built = useMemo(() => {
    const points = buildCablePoints(link, nodesById)
    const route = LINK_LAYOUT[link.id]
    const radius = RADIUS[link.kind]
    const cornerRadius = route.radius
    const lanes = link.kind === 'trunk' ? [-TRUNK_LANE, TRUNK_LANE] : [0]
    const tubes = lanes.map((lane) =>
      buildCableGeometry(points, { radius, cornerRadius, offset: [lane, lane] }),
    )
    let material = cableMaterials[link.kind]
    let alphaMap = null
    if (link.kind === 'span') {
      alphaMap = dashTexture(tubes[0].length)
      material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.sensor).multiplyScalar(1.8),
        alphaMap,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
    }
    return { tubes, material, alphaMap }
  }, [link, nodesById])

  useEffect(
    () => () => {
      built.tubes.forEach((t) => t.geometry.dispose())
      built.alphaMap?.dispose()
      if (built.alphaMap) built.material.dispose()
    },
    [built],
  )

  return (
    <group name={`link-${link.id}`}>
      {built.tubes.map((tube, i) => (
        <mesh key={i} geometry={tube.geometry} material={built.material} castShadow={link.kind !== 'span'} />
      ))}
    </group>
  )
})

/**
 * Every link of the topology as a cable. Routes come from scene/layout.js; endpoints are
 * computed from the device layout, so a cable always meets the device it belongs to.
 * @param {{topology: {nodes: any[], links: any[]}}} props
 */
export function NetworkLinks({ topology }) {
  const showManagement = useStore((s) => s.settings.showManagementLinks)
  const nodesById = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n])), [topology.nodes])

  return (
    <group>
      {topology.links
        .filter((link) => LINK_LAYOUT[link.id] && (showManagement || link.kind !== 'mgmt'))
        .map((link) => (
          <Cable key={link.id} link={link} nodesById={nodesById} />
        ))}
    </group>
  )
}

