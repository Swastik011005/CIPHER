# CIPHER

> **CIPHER** (formerly NetSec 3D) is the project's official name. Technical identifiers keep their original names so that nothing breaks: the Python package `netsec`, the `NETSEC_*` environment variables, the health-check service name `netsec-ids-engine`, the `window.__netsec*` debug handles and the repository folder.

**An interactive 3D simulation of network security: a firewall, a passive IDS and an inline IPS defending a small campus network.**

A Python engine decides what happens to every packet and writes a time-stamped trace. A React and Three.js front end replays that
trace as packets travelling along cables through a 3D campus, so you can watch a port scan get detected, mirrored, flagged
and blocked, and see exactly which device made each decision.

![Simulation, Enforce mode: a port scan is blocked by IPS-1](docs/demo/04-s2-enforce-blocked.png)

> **Everything is synthetic.** No real traffic is captured, sent, scanned or blocked. "Blocking" only changes the state of the
> simulation. The firewall, ACL, IDS and IPS are models of the concepts, not Cisco IOS, Snort or Suricata, and detection is
> rule and threshold based (no machine learning).

## What it shows

- **A validated campus topology:** 30 devices plus an abstract Internet segment, 32 links, 4 VLANs, 7 IP subnets and 7 zones
  (`docs/NETWORK_TOPOLOGY.md`). The original 17 nodes and 18 links are frozen and checked; a validator checks the whole topology with 17 rules.
- **Defence in depth with honest roles:**
  - **FW1** and the **CORE-SW1 ACL** enforce static policy, whatever the IPS mode.
  - **IDS-1 is passive.** It only receives SPAN copies of traffic and raises alerts. It never forwards, drops or blocks.
  - **IPS-1 is inline** (a transparent bridge on the server VLAN) and is the only sensor that can enforce. In **Monitor** mode it
    records what it would do; in **Enforce** mode it drops, rejects, rate-limits or blocks a source.
- **Sixteen scenarios.** Seven original scenarios (normal traffic, port scan, unauthorised access, flood, SSH brute force, and the
  same scan with the IPS in Monitor and Enforce mode) with 93 automated checks, and nine presentation scenarios P1 to P9 (normal
  traffic, Staff to Security VLAN, Staff to database, authorised administrator access, external HTTP, external database, a
  compromised endpoint and EDR isolation, recovery, SIEM monitoring), each launched from the Simulation page.
- **Six detectors** (D1 to D6) with sliding windows, correlated into incidents across IDS-1 and IPS-1, plus **Zero Trust**
  decisions with their reasons, a simulated **SIEM** and **EDR** with operator isolate and restore. An isolated endpoint creates
  no packet at all.
- **Endpoint terminals.** Open a PC, laptop or server and type `ping`, `tracert`, `telnet`, `curl` or `ipconfig`. A ping is four
  sequential journeys of coloured envelope packets along the real cables, and each `Reply from` line is printed only when its
  reply reaches the source. Routers, the core switch and the firewall have a read-only `show` command line.
- **Deterministic by design.** The same seed gives the same trace. Mid-run changes (IPS mode, detector switches, your own
  injected packets) re-simulate from the playhead and leave everything before it identical.
- **Five pages:** Overview, 3D Simulation, Monitoring (counters, charts, per-device table, event log), Threat Centre (incidents and the
  SIEM console), and a Rules and Scenarios editor with Cisco IOS export of the firewall and ACL policy.

| Threat Centre | Rules and scenario checks |
|---|---|
| ![Threat Centre](docs/demo/08-threat-centre.png) | ![All scenario checks pass](docs/demo/13-rules-all-checks-pass.png) |

## How it works

```
backend (FastAPI)                         frontend (React + Three.js)
  topology.json  ──►  discrete-event  ──►  trace (events)  ──►  player  ──►  3D scene, tables, counters
  policies, rules     engine                (time-stamped)       (replay)       (everything derives from the trace)
```

The backend decides every packet's fate and the frontend never does, so the 3D effects, counters and tables cannot disagree.
More detail: `docs/ARCHITECTURE.md` and `docs/SECURITY_ENGINE.md`.

## Run it locally

Requirements: Python 3.12 or newer (developed on 3.13), Node.js 20.19 or newer (developed on 24), and a current Chromium-based
browser with WebGL 2.

One task runner (Python standard library only) does the work the same way on Windows, macOS and Linux:

```
python scripts/tasks.py setup     # first time only, needs the internet: virtual environment, dependencies, production build
python scripts/tasks.py verify    # backend tests, the scenario checks, frontend tests and the production build
python scripts/tasks.py demo      # one process serves the API and the built front end at http://127.0.0.1:8000/simulation
python scripts/tasks.py dev       # backend on :8000 plus the Vite dev server on http://127.0.0.1:5173 (hot reload)
```

On Windows the same tasks are also available as `scripts\setup.cmd`, `scripts\verify.cmd`, `scripts\start-demo.cmd` and
`scripts\start-dev.cmd`. `setup --runtime-only` installs only what the server needs, without the test tools.

> The task runner has been run on **Windows only**. It is written for macOS and Linux as well, and the continuous
> integration workflow runs the backend and frontend checks on Linux, but nothing here has been run on those systems yet.

By hand (Windows paths shown; on macOS and Linux use `.venv/bin/python`):

```
cd backend  && python -m venv .venv && .venv\Scripts\python -m pip install -r requirements-dev.txt
cd frontend && npm ci && npm run build
cd backend  && .venv\Scripts\python app.py        # http://127.0.0.1:8000, API docs at /docs
```

By default the backend binds to a loopback address only and refuses anything else, on purpose (a public deployment must opt in
explicitly, see Hosting). After setup the app makes no request to any other host.

## Tests

```
python scripts/tasks.py verify                       # everything below, with a pass/fail summary
python scripts/tasks.py verify --only backend        # or just one step: backend, scenarios, frontend, build
```

Continuous integration (`.github/workflows/ci.yml`) runs the same steps on every push and pull request.

The latest verified results (1210 backend tests, 93 of 93 scenario checks, the frontend tests, production build, demonstration,
interaction, offline and split-origin browser checks) are in `docs/CIPHER_FINAL_TECHNICAL_REPORT.md` (section 18); the v1.0 release record is
in `docs/STAGE7_PROGRESS.md`, together with what was **not** verified. Notably, the 55 fps target on a discrete
GPU was never measured, and a second laptop was never tested. See `docs/LIMITATIONS.md` for the full, unsoftened list.

## Hosting

The repository is prepared for a free [Render](https://render.com) deployment: a static site for the front end and a Python web
service for the API (`render.yaml`). **Nothing is deployed yet**, and the configuration has been tested only locally, including a
simulation of the two-origin layout. A public deployment is locked down by default: the backend stays loopback-only unless
`NETSEC_ENV=production` and an explicit public-bind flag are both set, the rules are read-only (they are shared by every
visitor), API docs are off, requests are size-limited and rate-limited, and only the front end's origin may call the API.
See [docs/DEPLOYMENT_RENDER.md](docs/DEPLOYMENT_RENDER.md) for the architecture, every setting, and what was and was not verified.

## Repository layout

| Path | Purpose |
|---|---|
| `backend/` | FastAPI engine: topology, routing, simulation, security, shipped configuration, tests |
| `frontend/` | React, Vite and Three.js app (`src/scene` 3D, `src/playback` replay, `src/pages`, `src/features`, `src/state`) |
| `contracts/` | The frozen trace event schema shared by both sides |
| `scripts/` | Setup, start and verify scripts; real-browser rehearsal and measurement tools |
| `docs/` | Architecture, topology, API, security engine, limitations, screenshots and the stage records |

## Status and roadmap

`v1.0` is the first complete release of the simulation. Further work happens on the `develop` branch:

1. Cross-platform setup and continuous integration (done on `develop`).
2. Deployment readiness (explicit production configuration, secure CORS, read-only shared rules, Render Blueprint): prepared and
   tested locally, not deployed.
3. 3D interactivity: stronger selection feedback, double-click focus, cable inspection.
4. A pop-out viewer for inspecting a single device model.
5. An optional, decorative campus-expansion preview.

The network topology and the security behaviour are frozen: visual work must not change simulation results.

## Branches and contributions

`main` is stable and release-ready, `develop` integrates approved work, and each feature lives on a `feature/*` branch.
Only tested, approved changes reach `main`. The process is described in [CONTRIBUTING.md](CONTRIBUTING.md), and the commands,
dependency files and CI in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Development note

The project began as a five-student Computer Networks course project. The code, tests and documentation were written with an AI
coding assistant (Claude Code) working on the team's instructions. `docs/TEAM.md` says plainly what the repository can and
cannot show about individual contributions.

## Licence

No licence has been chosen yet. Until one is added to this repository, all rights are reserved by the authors.
