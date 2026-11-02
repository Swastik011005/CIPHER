# Stage 1 progress (honest status)

## Completed and tested
- Backend (FastAPI): `/api/health`, `/api/topology`, `/api/scenarios`, `POST /api/sim/run` (S1 only). 120 pytest tests passed.
- Topology: 17 nodes (16 devices + INET), 18 links, 4 VLANs, 7 subnets; 16-check validator passes.
- Routing (LPM), L2 path finding, forwarding, deterministic scheduler, trace recorder, host TCP/ICMP/UDP responses,
  SPAN mirroring, S1 trace (30 data packets, 22 mirrored, deterministic).
- Frontend: five routes, sidebar, header, live engine/topology status, UI kit. 61 Vitest tests passed.
- Backend offline/online verified in the browser (offline indicator, banner, automatic recovery).
- Measured in the in-app browser on the RTX 4050: 59-60 fps (vsync cap) in High quality while cycling camera presets.
- Selection of a device in 3D verified; panel shows real topology data. Canvas persists across page changes.
- No external network requests observed (fonts bundled).

## Not done / not verified
- Fresh-load blank canvas bug: see STAGE1_ISSUES.md (open).
- `npm run build` was last run before the final edits; not re-run. Vitest/pytest were run before the last few scene edits.
- Screenshots were viewed but not saved to disk. 1366x768 and 1920x1080 were not checked (only 1440x900 and 800x500).
- README, ARCHITECTURE.md, NETWORK_TOPOLOGY.md, API_CONTRACTS.md not written. `scripts/start-dev.cmd` not written.
- Nothing merged to `main` after the engine merge; nothing pushed anywhere. Packet Tracer not started.

## Commands
Backend: `cd backend && .venv\Scripts\python app.py` (tests: `.venv\Scripts\python -m pytest`)
Frontend: `cd frontend && npm run dev` (tests: `npx vitest run`, build: `npm run build`)
