# Architecture

## Core idea
A deterministic discrete-event engine (Python) simulates a scenario and returns a time-stamped **trace**. The React
**player** replays that trace. The backend decides every packet's fate; the frontend never does. Everything the UI shows
(3D effects, counters, tables) derives from the same trace, so they cannot disagree. No WebSocket is used.

## Backend (`backend/netsec`)
| Module | Role |
|---|---|
| `network/` | `models` (topology schema), `topology` (loader/indexes), `validator` (16 checks), `routing` (longest prefix match), `l2` (broadcast-domain path finding), `forwarding` (end-to-end route and TTL) |
| `sim/` | `scheduler` (deterministic queue), `trace` (recorder), `events` (frozen contract models), `timing` (visual time dilation), `engine` |
| `traffic/` | `packet`, `host_stack` (server/client responses), `flows`, `scenarios` |
| `analysis/stats.py` | Run statistics, one definition shared with the frontend |
| `api/` | FastAPI app factory and routes |

### Deterministic ordering
Time is integer microseconds. Events at the same instant run by priority class (CONTROL, EXPIRY, ARRIVE, DEPART, SEND),
then insertion order. The trace `seq` is gap-free; ordering is (`t`, `seq`). The same seed gives the same trace hash.

### Roles (frozen)
- **IDS-1 is passive.** It receives SPAN copies of traffic entering CORE-SW1 (VLAN 99 excluded). It produces alerts and
  syslog only; it never forwards, drops, rejects, blocks or rate-limits.
- **IPS-1 is inline** (transparent bridge, VLAN 30) and is the only sensor that can enforce on detections.
- FW1 and the CORE-SW1 ACL enforce static policy regardless of IPS mode.
- IDS and IPS keep separate alert records (`alert.raised.sensor`); alerts about the same activity share an `incident_id`.

## Frontend (`frontend/src`)
`app/` shell, `pages/` five pages, `features/` page parts, `scene/` the 3D world (layout, devices, links, effects),
`playback/` the pure trace player, `state/` Zustand store, `api/` the only code that calls `fetch`, `protocol/` event
constants, `ui/` reusable components.

The 3D canvas is persistent: one `<Canvas>` lives in a detached element that the Simulation page attaches. Rendering
pauses and resumes explicitly (`FrameloopController`). Topology comes from the API; `scene/layout.js` only adds positions
keyed by topology ids, and `validateLayout` reports any mismatch.

## Local only
The backend binds to loopback addresses only and refuses anything else.
