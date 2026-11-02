import { lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { Outlet } from 'react-router-dom'

import { Header } from './Header.jsx'
import { Sidebar } from './Sidebar.jsx'
import './app.css'
import { getSceneHost } from '../scene/sceneHost.js'
import { useStore } from '../state/store.js'
import { useBackendSync } from '../state/useBackendSync.js'

// The 3D bundle is only fetched the first time the Simulation page is shown.
const SceneCanvas = lazy(() => import('../scene/SceneCanvas.jsx'))

/**
 * Application layout: sidebar, header and page content. Also owns the single persistent
 * 3D canvas, which is portalled into a detached element that the Simulation page attaches
 * into its viewport slot (see scene/sceneHost.js).
 */
export function AppShell() {
  useBackendSync()
  const sceneEverVisible = useStore((s) => s.sceneEverVisible)

  return (
    <div className="shell">
      <Sidebar />
      <div className="shell__main">
        <Header />
        <main className="shell__content">
          <Outlet />
        </main>
      </div>
      {sceneEverVisible &&
        createPortal(
          <Suspense fallback={null}>
            <SceneCanvas />
          </Suspense>,
          getSceneHost(),
        )}
    </div>
  )
}
