# NetSec 3D final completion: execution progress

Branch: `feature/campus-c1-design` (continues from commit `3446055`). Nothing is pushed, merged or deployed.
Started: 2026-11-09. This file is updated after every major stage. If it says a stage is unfinished, resume there.

## Stage 1 audit (done)
What exists (verified in the code, not assumed):
- Backend: deterministic engine (`backend/netsec/sim/engine.py`), FW1/CORE ACL policy evaluator, IDS-1 (passive, D1-D6), IPS-1
  (inline, Monitor/Enforce, block table, token bucket), correlator, rule-set editing API, scenarios S1-S7 (12 runs, 93 checks).
- Frontend: persistent R3F canvas, campus layer (C2), campus zone/cable/device interaction (C3/C4), device viewer (Stage D).
- Baseline before this work: 1068 backend tests, 335 frontend tests, 93/93 scenario checks, 12 recorded trace hashes
  (`docs/DEVELOPMENT.md`), split-origin 20/20 + 34/34, offline 8/8, interaction checks 70/70.
- NOT present anywhere in the repository: ZT-POLICY-1, EDR-MGMT-1, SIEM-1, endpoint isolation, Zero Trust engine, SIEM
  console, EDR, endpoint CLI, the nine presentation scenarios. They are built in this work. SEC-LOG exists (syslog host).
- Topology is a frozen contract (17 nodes, 18 links, validator checks T01-T16 pin the counts). It is extended, not bypassed:
  the original 17 nodes and 18 links stay identical; new nodes/links are appended; the validator gains explicit
  "original contract unchanged" checks plus checks for the extension.

## Decisions
- Presentation scenarios use ids `P1`..`P9` (shown as Scenario 1..9) so the baseline S1-S7 (hashes, 93 checks) stay valid.
  Old scenario event streams must stay identical except `run.meta.config_hash` (the topology grows); a test proves it.
- New security features (Zero Trust, SIEM, EDR) are opt-in per scenario, so S1-S7 emit no new events.
- Security state (isolated endpoints, device trust, roles, grants, cumulative rule counters) lives in a server-side store; the
  endpoint CLI and the scenarios read the same store and the same engine. In-run changes (isolate/restore at the playhead) are
  control events, like the existing IPS-mode switch.
- CLI is a whitelist parser (`help ipconfig ping tracert telnet curl clear`); no shell, no `eval`, no subprocess.
- All new traffic is synthetic. No claim of a real IDS/IPS/SIEM/EDR appliance anywhere.

## Checklist
- [x] Stage 1 audit
- [ ] Stage 2 security engine (topology extension, EDR, Zero Trust, SIEM, engine integration)
- [ ] Stage 3 nine scenarios P1-P9 and their tests
- [ ] Stage 4 endpoint panel (Overview/CLI/Security) and CLI API; read-only device CLI if time
- [ ] Stage 5 expanded campus (layout, models, labels)
- [ ] Stage 6 performance measurement and optimization
- [ ] Stage 7 UI polish
- [ ] Stage 8 full validation
- [ ] Stage 9 technical report (Markdown + PDF)
- [ ] Stage 10 final delivery

## Exact next action
Extend `backend/config/topology.json` with the new nodes/links (appended), then the validator.
