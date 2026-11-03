# Stage 4 progress: core complete (honest status)

Scope: Rev 3 core: S1, S2, S3 (a to d), S5, S6; detectors D1, D4, D5, D6; IPS actions drop, reject and block source;
prefix-stable mid-run changes. Not started: D2, D3, D7, rate limiting, S4, S7, the Rules editor, PCAP export.

## Detectors (all configurable in `backend/config/detectors.json`)
| Id | Detects | Fires when | Severity |
|---|---|---|---|
| D1 | Port scan | 6 / 12 distinct ports in 10 s from one source to one target (bare SYNs) | MEDIUM / HIGH |
| D4 | Restricted service | any TCP packet to a restricted service (MySQL on DB-SRV) from a source not on its allowed list (only APP-SRV) | HIGH |
| D5 | Forbidden zone pair | any packet Staff to Security network, or Outside to Security network | HIGH |
| D6 | Invalid TCP flags | NULL, XMAS, SYN+FIN, SYN+RST, FIN+RST | HIGH |

D4 to D6 need no history, so they fire on the first packet. One alert per (rule, source, target) per 30 s per sensor.
IDS-1 and IPS-1 each keep their own alert; alerts for the same (rule, source, target) share one incident.

## IPS actions (`backend/config/ips_policy.json`, applied only in Enforce)
| Detector, severity | Action | Result |
|---|---|---|
| D1 HIGH | block source 20 s | the triggering packet is dropped (`ips_drop`), later ones `blocked_source` |
| D4 HIGH | reject | the packet is dropped (`ips_reject`) and IPS-1 injects a TCP RST |
| D5 HIGH | drop | `ips_drop`, source not blocked |
| D6 HIGH | drop | `ips_drop`, source not blocked |
Monitor mode records the same `ips.action` with `applied: false` and forwards the packet.
Order inside IPS-1 is unchanged: block table, detectors, policy lookup, enforce or record, forward.

**Reject.** A synthetic packet created by IPS-1: flow `<original flow>:rst`, flags ACK+RST, source and port spoofed as the
destination server, travelling the reverse path from IPS-1 to the client (S3 d: IPS-1, CORE-SW1, ACC-SW2, ADMIN-PC; TTL
64, 63, 63). It is a normal `packet.created` event (no schema change), counted as a data packet, mirrored to IDS-1 like any
packet entering CORE-SW1, and ends the client's session. Nothing is sent on a real network.

## Scenarios
- **S3** (40 s): (a) PC-1 to DB:3306, ACL `STAFF-IN:10` denies, IDS-1 alerts D4. (b) LAPTOP-1 to
  SEC-LOG, ACL `STAFF-IN:20` denies, IDS-1 alerts D5. (c) EXT-ATK to DB:3306, FW1 `OUTSIDE-IN:implicit-deny`, no sensor sees it.
  (d) ADMIN-PC to DB:3306, no ACL applies (VLAN 20), IPS-1 rejects it (Enforce) or records it and lets the session run (Monitor).
  Enforce: 5 data packets, 4 blocked, 1 delivered (the RST), 4 alerts, 3 incidents. Monitor: 3 blocked, the rest delivered, 4 alerts, 3 incidents.
- **S5 / S6**: the S2 traffic and seed with `pinned_ips_mode` Monitor / Enforce. A request for another mode is ignored; the
  response reports the pinned mode. Their trace bodies equal S2 Monitor / S2 Enforce exactly (only `run.meta` differs).
- A `flag_probe` flow type (raw TCP segments with chosen flags) exists for D6 tests; no product scenario uses it yet.

## Controls and prefix stability
`POST /api/sim/run` accepts `controls`: `{type: "ips_mode", t, mode}` and `{type: "detector", t, detector, enabled}`. A
control is applied at its time before anything else at that instant; everything before it is identical to the same run
without it, including `run.meta` (controls are deliberately outside `config_hash`). Switching to Monitor lifts active blocks
(`block.expired` at the switch). A pinned scenario refuses an IPS-mode control (HTTP 422). In the UI, the Scenario panel has
"From the playhead on: Monitor | Enforce", which re-runs with a control at the playhead and keeps the playhead where it is.

## Intentional change to existing hashes
Adding D4 to D6 changes the detector configuration, so `config_hash` and `run_id` in `run.meta`, and therefore every
whole-trace hash, changed for all scenarios. Everything else in S1 and S2 is unchanged: `test_stage3_regression.py` holds
the SHA-256 of each Stage 3 trace body (all events except `run.meta`) and checks the engine still reproduces it. Golden
fixtures were re-exported once (`scripts/export_golden_traces.py`), and S3 fixtures were added.

## UI
- 3D: `ips-reject` ring labelled "reject D4 · TCP reset" at IPS-1; the rejected packet shatters; the RST is a red capsule
  that leaves IPS-1; ACL flash and firewall ripple (labelled with the rule id) now occur in S3; the "would block" flash reads
  "would reject" or "would drop" in Monitor mode. Effects remain a pure function of the trace and the playhead.
- Timeline markers: denials (FW1 and ACL), applied reject or drop, alerts, blocks. Ticker: the reject and the injected reset.
- Packet inspector: "Injected by IPS-1" for the reset, with its spoofed 5-tuple and decision trail. Device inspector and
  labels count denials per enforcement point; IDS-1 only shows alerts.
- Threat Centre: rule names and a "why packets were stopped" breakdown (FW1, ACL, IPS drop, IPS reject, blocked source).
- Scenario panel: S3, S5 and S6 listed from the engine; pinned scenarios show a "Pinned to Monitor/Enforce" chip.

## Test results (final run; see the Stage 4 report for the command output)
Backend: unit tests for every detector (thresholds, negatives, config validation, suppression), IPS actions per detector in
both modes, S3 branches a to d in both modes, the injected reset (path, TTL, VLAN, ticks), the five-seed matrix for
S1, S2, S3, S5, S6 in both modes (determinism, event order, one disposition per packet, run.end equals recomputed stats,
alert correlation, IDS-1 never drops or enforces), S5/S6 equivalence with S2, prefix stability for IPS-mode and detector
controls over seeds and times, D6 flag probes, API contract for pinned scenarios and controls.
Frontend: reducer totals equal `run.end` for all five core traces, S3 effects, injected reset, device tags, markers, mode
switch store logic.

## Browser verification
- Real backend, in-app browser: S3 Enforce plays; its trace hash matches the golden fixture; the effects, labels, tags,
  markers and inspector show the reject as described above. A real mouse click on the in-flight reset packet in the 3D
  scene selected it (`?debug=1` exposes `window.__netsecProbe` and `window.__netsecPackets` so a click can be aimed).
- UI: S5 and S6 show the pinned chip and no live switch; S2 shows the mode selector and the live switch. Switching an S2
  Enforce run to Monitor at 2.0 s through the button gave 0 blocked and 26 flagged, with the playhead staying at 2.0 s.

## Performance (not what the target asks for)
- The in-app browser rendered on the **Intel UHD Graphics** integrated GPU in this session (WebGL renderer string), not the
  RTX 4050 an earlier session recorded. On it the scene ran 20 to 40 fps at about 1329 x 846 with 238 draw calls and
  81k triangles, in both High and Low, with the Stage 3 and Stage 4 builds equal within noise (Stage 2 baseline in the same
  pane: 33 fps). **The 55 fps RTX 4050 target was not measured and not met in this environment.**
- Later in the session the window was throttled by the operating system (0.8 to 1 fps for any page, visible and focused), so
  no further timing numbers were taken. Fixing it needs the Claude window in view; routing the app to the discrete GPU needs
  a Windows graphics setting, which was not changed.
- No normal Chrome window was available (Claude in Chrome had no connected browser).

## Open items
- 55 fps on the RTX 4050 in a normal browser window; free-running playback of S3 was not timed in this session.
- Mid-run changes cover IPS mode and detector on or off only; rules and thresholds editing is the Rules page (later).
- D5 has no scenario where IPS-1 acts on it (traffic to the Security network never reaches IPS-1); its drop action is
  covered by unit tests. D6 has no product scenario; it is covered by `flag_probe` tests.
- No screenshots are saved in the repository.
