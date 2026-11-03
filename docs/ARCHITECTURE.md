# Architecture

## Core idea
A deterministic discrete-event engine (Python) simulates a scenario and returns a time-stamped **trace**. The React
**player** replays that trace. The backend decides every packet's fate; the frontend never does. Everything the UI shows
(3D effects, counters, tables) derives from the same trace, so they cannot disagree. No WebSocket is used.

## Backend (`backend/netsec`)
| Module | Role |
|---|---|
| `network/` | `models` (topology schema), `topology` (loader/indexes), `validator` (16 checks), `routing` (longest prefix match), `l2` (broadcast-domain path finding), `forwarding` (end-to-end route and TTL) |
| `sim/` | `scheduler` (deterministic queue), `trace` (recorder), `events` (frozen contract models), `timing` (visual time dilation), `controls` (mid-run controls: IPS mode, detector on/off), `engine` |
| `traffic/` | `packet`, `host_stack` (server/client responses), `flows`, `scenarios` (S1 to S7 generators and the declared expectations) |
| `security/` | `policy/` (FW1 and core ACL, stateful connection tracking), `detection/` (D1 to D6, sliding windows), `prevention/` (IPS-1: block table, token bucket, actions, Monitor/Enforce), `correlation` (incidents), `ruleset` (the validated, editable rule set, see below), `config` (shipped JSON loader) |
| `analysis/` | `stats` (run statistics, one definition shared with the frontend), `expectations` (the 93 scenario checks), `ios_export` (firewall/ACL as Cisco IOS text) |
| `api/` | FastAPI app factory (also serves `frontend/dist` in demo mode) and routes: `health`, `topology`, `sim` (scenarios, run, validate), `rules` |
| `config/` (backend root) | Shipped defaults: `topology.json`, `detectors.json`, `ips_policy.json`, `policies/fw1.json`, `policies/core_acl.json`, `scenarios/S1..S7.json` |

### Deterministic ordering
Time is integer microseconds. Events at the same instant run by priority class (CONTROL, EXPIRY, ARRIVE, DEPART, SEND),
then insertion order. The trace `seq` is gap-free; ordering is (`t`, `seq`). The same seed gives the same trace hash.

### Roles (frozen)
- **IDS-1 is passive.** It receives SPAN copies of traffic entering CORE-SW1 (VLAN 99 excluded). It produces alerts only
  (no syslog packets are simulated); it never forwards, drops, rejects, blocks or rate-limits.
- **IPS-1 is inline** (transparent bridge, VLAN 30) and is the only sensor that can enforce on detections.
- FW1 and the CORE-SW1 ACL enforce static policy regardless of IPS mode.
- IDS and IPS keep separate alert records (`alert.raised.sensor`); alerts about the same activity share an `incident_id`.

### Rules, controls and custom traffic
- **Rule set** (`security/ruleset.py`): detector switches and numeric settings plus the restricted outside addresses. It is
  held in the server's memory, validated before use (an edit is applied whole or refused with one message per field) and
  reset by `POST /api/rules/reset` or a restart. The shipped JSON files are never rewritten. The rule set is part of each
  run's `config_hash`, so a trace says which rules it ran with.
- **Controls and custom traffic**: changing the IPS mode or switching a detector on or off mid-run, and injecting a
  packet or burst, are *control events* at the playhead. The engine re-simulates the whole run; everything before the
  playhead is identical (prefix-stable, tested). They are not part of `config_hash`.
- **Scenario checks**: `analysis/expectations.py` holds what each scenario must show; `POST /api/sim/validate` and
  `scripts/run_scenario_checks.py` run them (12 runs, 93 checks).

## Frontend (`frontend/src`)
`app/` shell, `pages/` five pages, `features/` page parts, `scene/` the 3D world (layout, devices, links, effects),
`playback/` the pure trace player, `state/` Zustand store, `api/` the only code that calls `fetch`, `protocol/` event
constants, `ui/` reusable components.

The 3D canvas is persistent: one `<Canvas>` lives in a detached element that the Simulation page attaches. Rendering
pauses and resumes explicitly (`FrameloopController`). Topology comes from the API; `scene/layout.js` only adds positions
keyed by topology ids, and `validateLayout` reports any mismatch.

## Run modes
- **Demo mode** (`scripts\start-demo.cmd`): one process, `backend/app.py`, serves the API under `/api` and the built
  `frontend/dist` at `/`. Works offline; this is what is presented.
- **Development mode** (`scripts\start-dev.cmd`): the backend on :8000 plus the Vite dev server on :5173, which proxies `/api`.

## Scripts (`scripts/`)
| Script | Purpose |
|---|---|
| `setup.cmd`, `start-demo.cmd`, `start-dev.cmd`, `verify.cmd` | Install, run, and verify everything with one command each |
| `run_scenario_checks.py` | The 93 scenario checks from the command line |
| `lib/cdp.mjs` | Tiny Chrome DevTools driver (no extra dependency): navigate, evaluate, screenshot, record requests and console errors |
| `rehearse_demo.mjs`, `check_offline_recovery.mjs` | Real-browser rehearsal of the demo (34 checks) and of engine loss and recovery (8 checks) |
| `measure_fps.mjs`, `measure_memory.mjs` | Frame-rate and memory measurements |
| `capture_screens.mjs`, `capture_devices.mjs` | Screenshots of every page and device |
| `export_golden_traces.py` | Saves traces used as fixtures by the frontend tests |

## Local only
The backend binds to loopback addresses only and refuses anything else (`NETSEC_HOST`). The app makes no request to any
other host (checked by the rehearsal).
