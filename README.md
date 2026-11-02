# NetSec 3D: IDS/IPS simulation

Intelligent Network Security Using Intrusion Detection and Automated Threat Prevention.

An interactive 3D simulation of a small campus network with a firewall, a **passive** IDS (fed by a SPAN port) and an
**inline** IPS. A Python engine decides what happens to every packet; the React front end replays the engine's trace in 3D.

**Everything is synthetic.** No real traffic is captured, sent, scanned or blocked. "Blocking" only changes the
simulation's state. Packet Tracer is a separate, parallel lab and is not connected to this app.

## Run it (Windows)

First-time setup:

```
cd backend
py -3.13 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cd ..\frontend
npm install
```

Then either run `scripts\start-dev.cmd` (opens both servers), or by hand:

```
cd backend  && .venv\Scripts\python app.py        http://127.0.0.1:8000  (API docs at /docs)
cd frontend && npm run dev                        http://127.0.0.1:5173
```

Demo mode (one process, works offline): `cd frontend && npm run build`, then run the backend; it serves `frontend/dist`
at http://127.0.0.1:8000.

Tests: `cd backend && .venv\Scripts\python -m pytest` and `cd frontend && npx vitest run`.

Open `/simulation?debug=1` to see frame rate and mesh counts. Browsers pause `requestAnimationFrame` for hidden or
throttled tabs; the 3D scene starts as soon as the tab receives frames.

## Layout

| Path | Purpose |
|---|---|
| `backend/` | FastAPI engine: topology, routing, simulation, security (`netsec/`), config, tests |
| `frontend/` | React + Vite + Three.js app |
| `contracts/` | Frozen trace event schema shared by both sides |
| `docs/` | Architecture, topology, API, progress and issues |
| `packet-tracer/` | Cisco Packet Tracer lab plan (not yet built) |
| `scripts/` | Dev start script |

See `docs/ARCHITECTURE.md`, `docs/NETWORK_TOPOLOGY.md`, `docs/API_CONTRACTS.md`.
