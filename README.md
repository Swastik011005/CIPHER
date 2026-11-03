# NetSec 3D: IDS/IPS simulation

Intelligent Network Security Using Intrusion Detection and Automated Threat Prevention.

An interactive 3D simulation of a small campus network with a firewall, a **passive** IDS (fed by a SPAN port) and an
**inline** IPS. A Python engine decides what happens to every packet and writes a time-stamped trace; the React front end
replays that trace in 3D.

**Everything is synthetic.** No real traffic is captured, sent, scanned or blocked. "Blocking" only changes the state of the
simulation. The app runs entirely on `127.0.0.1` and needs the internet only once, to install its dependencies. The
Cisco Packet Tracer lab in the original plan was **not built** (see `docs/LIMITATIONS.md`).

Release status: **v1.0 code freeze.** What was and was not measured is in `docs/STAGE7_PROGRESS.md` and `docs/LIMITATIONS.md`.

## Quick start (Windows 10/11)

Prerequisites (install once):

| Tool | Version | Check |
|---|---|---|
| Python | 3.12 or newer (developed on 3.13) | `py -3 --version` |
| Node.js | 20.19 or newer (developed on 24) | `node --version` |
| A Chromium-based browser | Chrome or Edge, current | needed for the 3D scene (WebGL 2) |

Then, from the repository folder:

```
scripts\setup.cmd           first time only, needs the internet: virtual environment, dependencies, production build
scripts\verify.cmd          optional: runs every test and the 93 scenario checks (about 2 minutes)
scripts\start-demo.cmd      starts everything in one window and opens http://127.0.0.1:8000/simulation
```

After `setup.cmd` nothing needs the internet. To stop the demo, close its console window or press Ctrl+C.

### Other ways to run it

| Command | What it does |
|---|---|
| `scripts\start-demo.cmd` | **Demo mode.** One process serves the API and the built front end at http://127.0.0.1:8000. Use this for the presentation. |
| `scripts\start-dev.cmd` | **Development mode.** Two windows: backend on :8000 and the Vite dev server on http://127.0.0.1:5173 (hot reload, proxies `/api`). |
| `scripts\verify.cmd` | Backend pytest, the 93 scenario checks, frontend Vitest, production build. Prints `ALL CHECKS PASSED` only if all four succeed. |
| `backend\.venv\Scripts\python scripts\run_scenario_checks.py` | The scenario checks alone (12 runs: every scenario in every supported IPS mode). |
| `node scripts\rehearse_demo.mjs` | Drives the whole demo in a real Chrome window against a running demo mode (34 checks, writes `docs\demo\*.png`). |
| `node scripts\check_offline_recovery.mjs` | Starts its own backend, kills it while the page is open, and checks the page reports it and recovers (8 checks). |

By hand (what the scripts do):

```
cd backend  && py -3 -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt
cd frontend && npm ci && npm run build
cd backend  && .venv\Scripts\python app.py        http://127.0.0.1:8000  (API docs at /docs)
```

### Configuration

All optional, set as environment variables before starting the backend (or as `KEY=VALUE` lines in `backend\.env`; see `backend\.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `NETSEC_HOST` | `127.0.0.1` | Bind address. Only loopback addresses are accepted: the backend refuses to start on anything else, on purpose. |
| `NETSEC_PORT` | `8000` | Port. In dev mode also set `VITE_BACKEND_ORIGIN` (for example `http://127.0.0.1:8010`) so the Vite proxy follows. |
| `NETSEC_LOG_LEVEL` | `info` | Uvicorn log level. |

Detection thresholds, the firewall/ACL tables and the IPS policy are shipped in `backend/config/` and can be changed for a
session on the **Rules** page (edits live in the server's memory and reset when the backend restarts).

## Using the app

Pages (left sidebar): **Overview**, **Simulation** (the 3D scene and run controls), **Monitoring**, **Threats**, **Rules**.

1. Open **Simulation**, choose a scenario (S1 to S7) and an IPS mode (**Monitor** records what it would do; **Enforce** acts), press **Run**.
2. Play, pause, change speed (0.25x to 2x), drag the timeline or press **Step**. Click a device or a packet for details.
3. **Send traffic** adds your own packet or burst at the playhead; the engine re-simulates and everything before the playhead stays unchanged.
4. **Rules** edits detectors and policy, and **Run all checks** re-runs every scenario against its expectations.

The presentation walkthrough, with expected on-screen numbers and fallbacks, is `docs/DEMO_SCRIPT.md`.

## Layout

| Path | Purpose |
|---|---|
| `backend/` | FastAPI engine: topology, routing, simulation, security (`netsec/`), shipped configuration (`config/`), tests |
| `frontend/` | React + Vite + Three.js app (`src/scene` 3D, `src/playback` replay, `src/pages`, `src/features`, `src/state`) |
| `contracts/` | Frozen trace event schema shared by both sides |
| `scripts/` | Setup, start and verify scripts; browser tools that drive a real Chrome window (`lib/cdp.mjs`, rehearsal, offline recovery, fps and memory measurement, screenshot capture) |
| `docs/` | Architecture, topology, API, security engine, demo script, viva Q&A, limitations, backup plan, team, progress reports, screenshots |
| `docs/presentation/` | The nine-slide deck |
| `packet-tracer/` | Feature-check notes only; the lab itself was not built |

## Documentation

| Document | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | How the engine, trace, player, rules store and pages fit together |
| `docs/NETWORK_TOPOLOGY.md` | Devices, VLANs, subnets, links, routes, SPAN |
| `docs/SECURITY_ENGINE.md` | Firewall, ACL, IDS, IPS, detectors D1 to D6, actions, scenarios |
| `docs/API_CONTRACTS.md` | HTTP endpoints and the trace event schema |
| `docs/DEMO_SCRIPT.md` | Timed 9:40 demo with expected results and fallbacks |
| `docs/VIVA_QA.md` | Likely viva questions with answers that match what is implemented |
| `docs/BACKUP_AND_RECOVERY.md` | Offline checklist, backup plan, screenshots, recovery steps |
| `docs/LIMITATIONS.md` | What is not implemented, what was and was not measured |
| `docs/TEAM.md` | Roles and how the work is split |
| `docs/STAGE1_PROGRESS.md` to `docs/STAGE7_PROGRESS.md` | What each stage delivered and how it was verified |

## Tests

```
cd backend  && .venv\Scripts\python -m pytest
cd frontend && npx vitest run
```

Open `/simulation?debug=1` to see frame rate and mesh counts.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `setup.cmd`: "No matching distribution found" or a timeout | The package index was unreachable for a moment. Check the connection and run `scripts\setup.cmd` again; it continues where it stopped. |
| `setup.cmd`: "Python was not found" / "Node.js was not found" | Install them (see the table above) and open a **new** terminal so the PATH is refreshed. |
| Top right says **Engine offline** | The backend is not running or crashed. Start it (`scripts\start-demo.cmd`); the page notices within seconds and re-enables **Run** without a reload. A loaded run can still be scrubbed while offline. |
| Port 8000 already in use | Another copy is running. Close it, or set `NETSEC_PORT` (for example `set NETSEC_PORT=8010`) before starting. |
| Blank page at http://127.0.0.1:8000 in demo mode | The front end was not built: run `scripts\setup.cmd` (or `npm run build` in `frontend`). |
| The 3D scene is blank or frozen | Browsers stop drawing hidden, covered or minimised windows. Bring the window to the front and move the mouse over the scene. Check that hardware acceleration is on. |
| Low frame rate | Choose **View: Low** (the app also switches itself after 5 s under 25 fps). On a laptop, plug in and use the discrete GPU for the browser. Counters and results are identical on every quality setting. |
| A rule edit is refused | The message names the field and its allowed range; that is the validation working. **Reset to shipped** restores the defaults. |
| Counters differ from `docs/DEMO_SCRIPT.md` | You are looking at a custom rule set or a run with injected traffic. Press **Reset to shipped** on the Rules page and **Run** again; runs are deterministic. |
| Windows SmartScreen or antivirus complains about `.cmd` files | They are plain text; read them in an editor. Run them from a terminal if double-click is blocked. |

More recovery steps for the day of the presentation: `docs/BACKUP_AND_RECOVERY.md`.
