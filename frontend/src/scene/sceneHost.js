/**
 * The persistent 3D canvas lives in one detached DOM element, created on first use.
 * AppShell portals the Canvas into it once; the Simulation page's SceneSlot moves the element
 * into its viewport when shown and removes it when left. The WebGL context, loaded geometry and
 * camera state therefore survive navigation between pages.
 */

/** @type {HTMLDivElement | null} */
let host = null

export function getSceneHost() {
  if (!host) {
    host = document.createElement('div')
    host.className = 'scene-host'
  }
  return host
}
