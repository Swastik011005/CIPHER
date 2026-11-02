# Stage 1 issues

## RESOLVED (not an app bug): "blank 3D canvas on fresh load"

- Symptom seen earlier: on some fresh loads of `/simulation` the viewport stayed blank, the `<canvas>` kept the browser
  default size 300x150 and `window.__netsecScene` was never published.
- Investigation: in every blank case a frame counter on the same page read `requestAnimationFrame` = 0 over 12 s while
  `document.visibilityState` was "visible" (the in-app browser tab was being throttled). A trivial page in another tab
  got 60 frames/s at the same time. In a tab that did receive frames the canvas was sized and started immediately
  (about eight clean loads, including after the DPR and frameloop fixes).
- R3F sizes and starts its root from measurement callbacks that depend on animation frames, so without frames it cannot
  start, which is the same as any WebGL page in a throttled tab. It resumes when the tab receives frames again.
- No code change was made for this. Not proven to be impossible in a real browser, but no failing case with working
  `requestAnimationFrame` was ever observed.
- Real bugs found while investigating (fixed):
  - Leaving the Simulation page and returning left the canvas dead: `frameloop` never to always does not restart R3F's
    loop. Fixed with an explicit `setFrameloop` + `invalidate` (`FrameloopController` in `SceneCanvas.jsx`). Verified over
    two full five-page round trips (same canvas element, frames resumed).
  - N8AO half-resolution mode crashed with three r187 (`texture.mipmaps.length` on n8ao's multi-target polyfill).
    Workaround: `halfRes={false}` in `PostFX.jsx`.
  - "PCFSoftShadowMap removed" warning: now `shadows="percentage"`.
  - A dev-proxy 502 for a stopped backend now reads as "cannot reach the backend".

## Known, not fixed
- Console noise that is not an error: `THREE.Clock deprecated` warning (from a dependency) and `unsupported GSUB table`
  logs (troika font parser reading the bundled Inter woff).
- The bundle contains URLs for drei's HDRI preset table; they are never fetched (the scene uses a procedural environment).
- Starlette's TestClient prefers `httpx2`; the warning is filtered in `backend/pytest.ini`. httpx is kept (frozen stack).
- The brief says "CORE-SW1 to ACC-SW1 trunk"; the frozen topology names the switch ACC-SW2, which is implemented.
- Product name "NetSec 3D" in the sidebar is a placeholder (decision still open).
- Packet Tracer: not started; see `packet-tracer/feature-check.md`.
- Performance was measured only on the dev machine's in-app browser (RTX 4050). Integrated-GPU behaviour is untested.
