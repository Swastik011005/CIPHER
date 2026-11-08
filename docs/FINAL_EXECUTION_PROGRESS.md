# NetSec 3D final completion: execution progress

Branch: `feature/campus-c1-design` (continues from commit `3446055`). Nothing is pushed, merged or deployed.
Started: 2026-11-09. This file is updated after every major stage. If it says a stage is unfinished, resume there.

## Stage 1 audit (done)
What existed (verified in the code, not assumed):
- Backend: deterministic engine (`backend/netsec/sim/engine.py`), FW1/CORE ACL policy evaluator, IDS-1 (passive, D1-D6), IPS-1
  (inline, Monitor/Enforce, block table, token bucket), correlator, rule-set editing API, scenarios S1-S7 (12 runs, 93 checks).
- Frontend: persistent R3F canvas, campus layer (C2), campus zone/cable/device interaction (C3/C4), device viewer (Stage D).
- Baseline before this work: 1068 backend tests, 335 frontend tests, 93/93 scenario checks, 12 recorded trace hashes
  (`docs/DEVELOPMENT.md`), split-origin 20/20 + 34/34, offline 8/8, interaction checks 70/70.
- NOT present anywhere before: ZT-POLICY-1, EDR-MGMT-1, SIEM-1, endpoint isolation, a Zero Trust engine, a SIEM console, EDR, an
  endpoint CLI, the nine presentation scenarios. They were built in this work. SEC-LOG existed (syslog host) and is kept.
- The topology was a frozen contract (17 nodes, 18 links, validator checks T01-T16 pinned the counts). It is extended, not bypassed:
  the original 17 nodes and 18 links are identical; new nodes/links are appended; validator T01/T02 now check "original present",
  T17 checks the original is unchanged (`contracts/topology_original.json`).

## Decisions
- Presentation scenarios use ids `P1`..`P9` (shown as Scenario 1..9) so the baseline S1-S7 (hashes, 93 checks) stay valid.
  Old scenario event streams are identical except `run.meta.config_hash` (the topology grew); `test_extension_equivalence.py` proves it.
- New security features (Zero Trust, SIEM, EDR) are opt-in per scenario, so S1-S7 emit no new events.
- Security state (isolated endpoints, device trust, roles, revoked permissions, cumulative rule counters, SIEM history) lives in a
  server-side store (`security/state.py`); the endpoint CLI and the scenarios read the same store and the same engine. In-run
  changes (isolate/restore at the playhead) are control events like the existing IPS-mode switch, and can be committed to the store.
- The EDR agent's channel to EDR-MGMT-1 is out-of-band and not simulated as packets; an isolated endpoint's data-plane traffic is
  dropped in both directions (packets already on the wire when it was isolated are delivered).
- Zero Trust decides once per flow; the static ACL/firewall run first (a packet they drop never reaches Zero Trust).
- CLI is a whitelist parser (`help ipconfig ping tracert telnet curl clear`); no shell, no eval, no subprocess; output is written
  from the engine's trace.
- Production mode makes the state read-only (like the rules): state changes return 403 and runs do not write the shared store.
- All traffic is synthetic. No claim of a real IDS/IPS/SIEM/EDR anywhere.

## Done so far (committed on feature/campus-c1-design)
- Backend: topology extension (14 devices, 14 links), Zero Trust (`security/zerotrust.py`, `config/zerotrust.json`), EDR
  (`security/edr.py`), SIEM (`security/siem.py`, `config/siem.json`), `security/state.py`, engine integration, new events
  (`zt.decision` `edr.alert` `edr.state` `siem.event`, drop reasons `edr_isolated` `zt_deny`; `contracts/events.json` 1.1.0),
  scenarios `backend/config/scenarios/P1..P9.json`, endpoint CLI `backend/netsec/cli/endpoint.py`, API
  `backend/netsec/api/routes_security.py` (/presentation /state /state/action /zerotrust /zerotrust/explain /siem/events
  /endpoints/{id} /cli/exec).
  Tests: `backend/tests/scenarios/test_presentation_scenarios.py`, `test_extension_equivalence.py`, `security/test_campus_security.py`,
  `api/test_security_api.py`.
- Frontend: expanded campus layout (`scene/layout.js`: 31 nodes, 32 links, roads, four racks), scenario launcher
  (`features/simulation/DemoScenarios.jsx`), endpoint panel with Overview/CLI/Security tabs (`EndpointPanel.jsx`, `CliTerminal.jsx`,
  `SecurityTab.jsx`), SIEM console on the Threats page (`features/siem/SiemConsole.jsx`), EDR tags/rings, reducer and events protocol.
  Tests: `playback/securityView.test.js`, updated layout/campus/protocol tests, `scene/devices/bakeStatic.test.js`.
- Browser check `scripts/check_demo_scenarios.mjs`: 32/32 against the running app (nine scenarios, interactive isolate/restore, CLI, SIEM).
- Performance work: cable tube geometry 97k -> 37k triangles, RoundedBox segments reduced, static device models baked
  (`scene/devices/bakeStatic.js`), far-zoom endpoint label hiding. The 31-device scene: 272 draw calls and 73k triangles
  (first expanded build: 355 draw calls, 213k triangles; the 17-device scene before: 202 draw calls, 80k triangles).

## Checklist
- [x] Stage 1 audit
- [x] Stage 2 security engine
- [x] Stage 3 nine scenarios P1-P9 and their tests
- [x] Stage 4 endpoint panel (Overview/CLI/Security) and endpoint CLI API
- [ ] Stage 4b read-only device CLI for R1-EDGE, CORE-SW1, FW1 (priority 3, only if time)
- [x] Stage 5 expanded campus (layout, roads, racks)
- [ ] Stage 5b visual review of every camera preset and fixes
- [ ] Stage 6 performance: measure High/Low x idle/scenario/packets with `scripts/measure_fps.mjs`, record, optimise further if below 30 fps
- [ ] Stage 7 UI polish
- [ ] Stage 8 full validation: backend, frontend, scenarios 93/93 + P1-P9, split-check, offline recovery, interaction checks (70), demo check (32)
- [ ] Stage 9 technical report (Markdown + PDF)
- [ ] Stage 10 final delivery

## Exact next action
Run the full verification (`python scripts/tasks.py verify`), measure performance, review the presets visually, then write the report.

## Exact commands to continue
```
cd C:\dev\NetSec-3D
python scripts/tasks.py verify
set NETSEC_PORT=8071 && backend\.venv\Scripts\python.exe backend\app.py        (serves the built frontend/dist)
node scripts/check_demo_scenarios.mjs --base http://127.0.0.1:8071
node scripts/check_interactions.mjs --base http://127.0.0.1:8071
node scripts/measure_fps.mjs --url "http://127.0.0.1:8071/simulation?debug=1" --scenario S4 --mode enforce --start 12 --seconds 10 --quality high
```
