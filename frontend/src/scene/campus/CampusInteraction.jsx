import { useThree } from '@react-three/fiber'
import { memo, useEffect } from 'react'
import * as THREE from 'three'

import { useStore } from '../../state/store.js'
import { isTopPick } from '../picking.js'
import { CAMPUS_ZONES, zoneVolumes } from './campusLayout.js'

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false }) // pickable, never drawn: no draw call
const VOLUMES = zoneVolumes()
const GROUND_SIZE = [200, 200]
const NO_RAYCAST = () => null

const veilMaterial = new THREE.MeshBasicMaterial({ color: '#06122e', transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false })

/** Highlight materials per zone accent: a flat floor tint and an outline of the pavilion's volume. Shared, created once. */
const highlight = new Map()
function highlightFor(accent) {
  if (!highlight.has(accent)) {
    const color = new THREE.Color(accent)
    highlight.set(accent, {
      hoverFloor: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }),
      selectFloor: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }),
      hoverLine: new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.9), transparent: true, opacity: 0.7, toneMapped: false }),
      selectLine: new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(1.5), toneMapped: false }),
    })
  }
  return highlight.get(accent)
}

/**
 * The invisible pick volume of every pavilion. Hover shows the zone's name and a subtle highlight; a click selects the zone;
 * a double-click selects it and flies the camera to it. A device, cable or packet on the same ray always wins (see picking.js),
 * so devices inside the glass stay selectable.
 */
const ZoneVolumes = memo(function ZoneVolumes() {
  const gl = useThree((s) => s.gl)
  const handlers = (zone) => ({
    onPointerMove: (event) => {
      const store = useStore.getState()
      if (isTopPick(event, 'zone')) {
        event.stopPropagation()
        store.hoverZone(zone)
        gl.domElement.style.cursor = 'pointer'
      } else if (store.zone.hoveredId === zone) store.hoverZone(null)
    },
    onPointerOut: () => {
      const store = useStore.getState()
      if (store.zone.hoveredId === zone) store.hoverZone(null)
    },
    onClick: (event) => {
      if (!isTopPick(event, 'zone')) return
      event.stopPropagation()
      useStore.getState().selectZone(zone)
    },
    onDoubleClick: (event) => {
      if (!isTopPick(event, 'zone')) return
      event.stopPropagation()
      const store = useStore.getState()
      store.selectZone(zone)
      store.requestZoneFocus(zone)
    },
  })
  return (
    <group name="zone-volumes">
      {VOLUMES.map((v, i) =>
        v.shape === 'box' ? (
          <mesh key={i} material={HIDDEN} position={[(v.x0 + v.x1) / 2, v.h / 2, (v.z0 + v.z1) / 2]} userData={{ pick: 'zone', zone: v.zone }} {...handlers(v.zone)}>
            <boxGeometry args={[v.x1 - v.x0, v.h, v.z1 - v.z0]} />
          </mesh>
        ) : (
          <mesh key={i} material={HIDDEN} position={[v.cx, v.h / 2, v.cz]} userData={{ pick: 'zone', zone: v.zone }} {...handlers(v.zone)}>
            <cylinderGeometry args={[v.radius, v.radius, v.h, 48]} />
          </mesh>
        ),
      )}
    </group>
  )
})

/**
 * The ground. Clicking it clears the selected zone and its highlights; if no zone is selected it clears the selected device,
 * cable or packet, as an empty click always did. A device that is selected on its own is therefore never cleared by the click
 * that deselects a zone.
 */
function Ground() {
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[0, 0.002, 0]}
      material={HIDDEN}
      userData={{ pick: 'ground' }}
      onClick={(event) => {
        if (!isTopPick(event, 'ground')) return
        const store = useStore.getState()
        if (store.zone.selectedId !== null) store.selectZone(null)
        else store.clearSelection()
      }}
    >
      <planeGeometry args={GROUND_SIZE} />
    </mesh>
  )
}

/** Highlight of the hovered and the selected zone, and a slight veil over the platforms of every other zone while one is selected. */
const ZoneHighlights = memo(function ZoneHighlights({ zoneGeometry }) {
  const selected = useStore((s) => s.zone.selectedId)
  const hovered = useStore((s) => s.zone.hoveredId)

  return (
    <group name="zone-highlights">
      {CAMPUS_ZONES.map((zone) => {
        const geometry = zoneGeometry[zone.id]
        if (!geometry) return null
        const mats = highlightFor(zone.accent)
        const isSelected = selected === zone.id
        const isHovered = hovered === zone.id && !isSelected
        return (
          <group key={zone.id}>
            {selected && !isSelected && <mesh geometry={geometry.floor} material={veilMaterial} renderOrder={3} raycast={NO_RAYCAST} />}
            {(isSelected || isHovered) && (
              <>
                <mesh geometry={geometry.floor} material={isSelected ? mats.selectFloor : mats.hoverFloor} renderOrder={3} raycast={NO_RAYCAST} />
                <lineSegments geometry={geometry.outline} material={isSelected ? mats.selectLine : mats.hoverLine} renderOrder={3} raycast={NO_RAYCAST} />
              </>
            )}
          </group>
        )
      })}
    </group>
  )
})

/** The hovered zone's name as the canvas's title (the browser's own tooltip), and the cursor back to normal when nothing is hovered. */
function ZoneHoverFeedback() {
  const hovered = useStore((s) => s.zone.hoveredId)
  const deviceHover = useStore((s) => s.selection.hoveredId)
  const cableHover = useStore((s) => s.cable.hoveredId)
  const gl = useThree((s) => s.gl)
  const zone = CAMPUS_ZONES.find((z) => z.id === hovered)
  useEffect(() => {
    const canvas = gl.domElement
    canvas.title = zone ? `${zone.name}: click to select, double-click to focus` : ''
    if (hovered === null && deviceHover === null && cableHover === null) canvas.style.cursor = ''
    return () => {
      canvas.title = ''
    }
  }, [zone, hovered, deviceHover, cableHover, gl])
  return null
}

/** Everything interactive about the campus buildings. */
export function CampusInteraction({ zoneGeometry }) {
  return (
    <>
      <ZoneVolumes />
      <Ground />
      <ZoneHighlights zoneGeometry={zoneGeometry} />
      <ZoneHoverFeedback />
    </>
  )
}
