# Stage 2 progress: Security Core + Playback (honest status)

## Implemented and tested
- Firewall / ACL policy foundation: ordered rules, implicit deny, restricted sources, stateful connection tracking, per-link and
  per-VLAN policy lookup; enforced in the engine at FW1 and CORE-SW1 (`policy.decision`, `fw_deny`, `acl_deny`).
- D1 port-scan detector with thresholds exactly at 6 (MEDIUM) and 12 (HIGH) distinct ports, sliding window, alert
  suppression with escalation, separate IDS-1 / IPS-1 alert records correlated into one incident.
- IPS-1 Monitor and Enforce in the frozen order (block table, detectors, policy, enforcement, forward); block table with
  expiry; allowlist; unsupported actions refused up front.
- IDS-1 remains passive: it only inspects SPAN copies and alerts (asserted by tests in both modes).
- Scenario S2 (port scan with a normal HTTPS session and retries during/after the block) and a `port_scan` flow.
- API: `POST /api/sim/run` accepts `monitor` and `enforce`; `/api/scenarios` lists S1 and S2.
- Frontend: deterministic trace reducers and player; play/pause, step, restart, speed 0.25/0.5/1/2x, scrubber with alert and
  block markers; scenario panel (scenario + IPS mode + Run); live counters and event ticker; instanced packets moving along
  the drawn cables; device label/ring shows BLOCKED while IPS-1 blocks a source; Threat Centre lists the run's alerts.
- Tests (final run): backend 195 passed; frontend 110 passed; `npm run build` OK.

## Rev 3 Day 2 acceptance
| Criterion | Result |
|---|---|
| D1 fires at exactly 6 and 12 distinct ports (not 5 / 11) | passed (`tests/security/test_detection.py`, `test_s2_port_scan.py`) |
| ACL and FW rule ids correct | passed (`test_policy.py`, `test_policy_enforcement.py`) |
| IDS-1 never emits a drop, block or `ips.action` | passed, both modes |
| Monitor: IPS drops nothing; Enforce: blocks after the HIGH alert | passed |
| seek(t) equals replaying every event up to t | passed (17 times, plus random forward/backward seeks) |
| Fixture trace plays, packets follow their links, pause/speed/scrub work | logic passed in Vitest; see limits below |

## Verified live (in-app browser, real backend)
Run S2 in Enforce through the UI: trace hash matched the golden fixture. Scrubbing showed no alert at 3.2 s, IDS-1 MEDIUM at
3.3 s, HIGH at 4.8 s, PC-2 labelled BLOCKED from 5.0 s with a countdown, unblocked at 25.1 s, and final counters (62 packets,
32 clean, 6 flagged, 24 blocked, 4 alerts, 1 incident) equal to the engine's `run.end`. Seeking back reproduced earlier state.

## Limits and open items
- Free-running playback could not be watched in this environment: the in-app browser only delivered animation frames for a
  moment after real input, so the clock stopped at ~0.2 s. Playback logic is covered by tests and by scrubbing; a real
  60 fps watch-through is still to be done in a normal browser window.
- Only D1 exists (D2 to D7, reject/RST injection, rate limiting, syslog are Stage 3+). Connection tracking has no timeouts.
- S5/S6 are S2 run with IPS Monitor / Enforce rather than separate files.
- No packet effects beyond colour (verdict colours: neutral, green after IPS, amber flagged, red dropped, violet SPAN copy).
- The Rules and Monitoring pages are still inventory/placeholder pages. Packet Tracer: not started.
