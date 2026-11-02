import { useLayoutEffect, useRef } from 'react'

import { getSceneHost } from '../../scene/sceneHost.js'
import { useStore } from '../../state/store.js'

/**
 * Placeholder in the page layout where the persistent 3D canvas is shown. On mount it moves
 * the canvas host element in; on unmount it takes it out again and pauses rendering.
 */
export function SceneSlot() {
  const slotRef = useRef(null)

  useLayoutEffect(() => {
    const slot = slotRef.current
    const host = getSceneHost()
    slot.appendChild(host)
    useStore.getState().setSceneVisible(true)
    return () => {
      useStore.getState().setSceneVisible(false)
      host.remove()
    }
  }, [])

  return <div ref={slotRef} className="scene-slot" />
}
