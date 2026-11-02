# Stage 1 progress (honest status)

## Completed and tested
- Backend (FastAPI): `/api/health`, `/api/topology`, `/api/scenarios`, `POST /api/sim/run` (S1 only).
- Topology: 17 nodes (16 devices + INET), 18 links, 4 VLANs, 7 subnets, 7 zones; 16-check validator passes.
- Routing (longest prefix match), L2 path finding, forwarding with TTL, deterministic scheduler with defined same-timestamp
  ordering, trace recorder validated against the frozen event contract, host TCP/ICMP/UDP responses, SPAN mirroring,
  S1 trace (30 data packets, 22 mirrored, deterministic).
- Frontend: five routes, sidebar, header with live engine/topology status, UI kit, API client, Zustand store.
- 3D scene: 7 zone slabs, 17 distinct device models, 18 cables (trunk double tube, dashed violet SPAN), labels with level of
  detail, 6 camera presets, hover and selection, device panel, keyboard shortcuts, High/Low quality, persistent canvas.
- Test results (after the last Stage 1 change): pytest 120 passed; Vitest 61 passed; `npm run build` succeeded.
- Verified in the in-app browser on the RTX 4050 (ANGLE/D3D11):
  - 59-60 fps at High quality while cycling camera presets (display vsync cap), 228 meshes, ~80k triangles.
  - Backend stop shows "Engine offline" and a banner; restart recovers automatically.
  - Click selects a device and fills the panel with real topology data.
  - All five routes render; the canvas element and WebGL context survive navigation.
  - 1366x768, 1440x900 and 1920x1080: no page overflow, whole campus framed (aspect-aware camera distance).
  - No requests outside 127.0.0.1; fonts are bundled.

## Not done / limits
- Packet Tracer not started (`packet-tracer/feature-check.md` lists the work).
- Screenshots were inspected but not saved to disk.
- Performance measured only on this machine (no integrated-GPU test). The in-app browser throttles frames when the pane
  is not active, so fps readings are only meaningful when it is.
- "Blank canvas on fresh load": explained as the tab receiving no animation frames; see STAGE1_ISSUES.md.

## Commands
Backend: `cd backend && .venv\Scripts\python app.py` (tests: `.venv\Scripts\python -m pytest`)
Frontend: `cd frontend && npm run dev` (tests: `npx vitest run`, build: `npm run build`)
Both: `scripts\start-dev.cmd`
