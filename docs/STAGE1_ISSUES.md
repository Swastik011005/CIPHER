# Stage 1 issues

## OPEN: 3D canvas sometimes never starts on a fresh page load (blocker for the Stage 1 3D gate)

- Symptom: on some fresh loads of `/simulation` the viewport stays blank. `window.__netsecScene` is never
  published and the `<canvas>` keeps the browser default size 300x150, so React Three Fiber never created its root.
- Observed: several fresh loads rendered correctly and held 59-60 fps; others stayed blank for 30 s+. No console error.
- Suspected cause (NOT confirmed): the persistent canvas lives in a detached host element (`scene/sceneHost.js`) that
  `SceneSlot` attaches later. R3F creates its root only once its container has a non-zero size, and the size
  measurement can be missed when the host is attached/detached around StrictMode's double effect run.
- Not tried yet: attach the host before mounting `<Canvas>`, or give `<Canvas>` an explicit `resize` strategy;
  test with StrictMode off to confirm.
- Impact: 3D scene unreliable on first load; switching quality or re-navigating can wake it.

## FIXED during this stage
- Navigating away from Simulation and back left the canvas dead (`frameloop` never to always does not restart R3F's
  loop). Fixed with an explicit `setFrameloop` + `invalidate` in `SceneCanvas.jsx` (`FrameloopController`).
  Verified over two full five-page round trips (same canvas element, frames resumed).
- N8AO half-resolution mode crashed with three r187 (`texture.mipmaps.length` on n8ao's multi-target polyfill).
  Workaround: `halfRes={false}` in `PostFX.jsx`.
- "PCFSoftShadowMap removed" warning: using `shadows="percentage"`.
- Gateway 502 from the dev proxy now reads as "cannot reach the backend".

## Known, not fixed
- Console noise that is not an error: `THREE.Clock deprecated` warning (from a dependency) and
  `unsupported GSUB table` logs (troika font parser reading the bundled Inter woff).
- Starlette's TestClient prints a deprecation preference for `httpx2`; filtered in `backend/pytest.ini`. httpx is kept (frozen stack).
- The brief says "CORE-SW1 to ACC-SW1 trunk"; the frozen topology names the switch ACC-SW2, which is what is implemented.
- Product name "NetSec 3D" in the sidebar is a placeholder (decision still open).
- Packet Tracer: nothing built, `packet-tracer/feature-check.md` not written.
