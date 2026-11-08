import { useEffect } from 'react'

import { api } from '../api/client.js'
import { useStore } from './store.js'

const POLL_MS = 3000

/**
 * Polls /api/health and keeps the connection slice honest. Whenever the backend becomes
 * reachable and the topology is not loaded, it loads the topology. Mount once, in AppShell.
 */
export function useBackendSync() {
  useEffect(() => {
    const controller = new AbortController()
    let timer

    const tick = async () => {
      const store = useStore.getState()
      try {
        const health = await api.health({ signal: controller.signal })
        store.recordHealthSuccess(health)
        const { topology, presentation, securityState } = useStore.getState()
        if (topology.status === 'idle' || topology.status === 'error') {
          useStore.getState().loadTopology()
        }
        if (presentation.status === 'idle' || presentation.status === 'error') useStore.getState().loadPresentation()
        if (securityState === null) useStore.getState().loadSecurityState()
      } catch (error) {
        if (controller.signal.aborted) return
        store.recordHealthFailure(error?.message ?? String(error))
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, POLL_MS)
    }

    tick()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [])
}
