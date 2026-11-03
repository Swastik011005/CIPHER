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

## Closures after the Stage 4 report (the two open items)

### 1. Custom traffic (Rev 3 Day 4): done and verified live
`POST /api/sim/run` accepts `custom_flows` (up to 5; any flow type: TCP session, ping, raw-flag probe, port scan, flood). They
are added to the scenario's own flows and simulated with it. Rules that keep the past intact:
- they are left out of `config_hash` and `run.meta` (like controls), and each draws its ports and sequence numbers from its own
  random stream (`random.Random("<seed>:<flow id>")`), so nothing before its start moves; tested for S1, S2 and S3, five seeds;
- a run with custom traffic may outlast the scenario: `run.end` falls when the last packet has settled, while `run.meta.duration`
  stays the declared one;
- bad requests (not a host, same source and destination, id clash, invalid port, more than 5) are HTTP 422.
UI: the "Send traffic" card (Scenario panel column) has From, To, Kind (TCP connection, TCP with chosen flags with NULL/XMAS/
SYN+FIN presets, Ping), Port, Count, "Send at T+x s" (the playhead rounded up to a tenth) and a "Staff → DB:3306" preset. It
re-simulates and plays on from the playhead; the injected flows are listed with "open packet #n", and can be cleared.
Live check (real backend, S1 loaded, PC-1 to DB-SRV:3306 at T+4.6 s): packet #8 "Dropped at CORE-SW1 (acl_deny)", rule
`STAFF-IN:10`, hops PC-1 → ACC-SW2 → CORE-SW1 (VLAN 10, TTL 64), SPAN copy #14, IDS-1 alert D4 HIGH, counters 1 blocked / 1 alert /
1 incident, and the `STAFF-IN:10` effect label over CORE-SW1 with its "1 DENIED" tag. Tests: 25 backend (prefix stability over five
seeds, rule id, path, extension, refusals), 2 API, 25 frontend (validation, flow building, store, a real engine trace).

### 2. The 55 fps target on the RTX 4050: NOT verified (external blocker); integrated-GPU numbers measured
**Blocker.** The NVIDIA GeForce RTX 4050 Laptop GPU is registered with Windows but **not present**: `Get-PnpDevice -Class Display`
reports it with `Present = False`, status Unknown; `Win32_VideoController` lists only Intel UHD Graphics; `nvidia-smi` refuses
(insufficient permissions). So no browser can render on it right now. Both browsers open with `powerPreference: high-performance`
(the app asks for the fast GPU) and still report the Intel adapter. Re-enabling the dGPU (device manager, BIOS or the vendor's
hybrid-graphics switch) and Windows Graphics settings are system settings; nothing was changed. An earlier session recorded an
RTX 4050 renderer and 59 to 60 fps in the in-app pane; that cannot be reproduced now and is not relied on.
**Left unverified:** ">= 55 fps at High on the RTX 4050" (Stage 3 criterion 8 and the Day 5 S4-peak criterion).

**What was measured instead** with `scripts/measure_fps.mjs` (a visible Chrome 156.0.8078.74 / Edge 156 window, throw-away
profile, the app's own store drives the scenario, frames counted for the stated time; run it again on a machine whose dGPU
is active with `node scripts/measure_fps.mjs --scenario S4 --mode monitor --start 11 --seconds 6 --quality high`):
| Scene | Quality | Window (CSS px, DPR 1) | GPU as reported by WebGL | fps | worst 1% frame | draw calls | triangles |
|---|---|---|---|---|---|---|---|
| S2 Enforce, T+3 to 13 s | High | 1904 x 985 | Intel UHD Graphics (D3D11) | 14.1 | 166 ms | 233 | 80,788 |
| S2 Enforce | Low | 1904 x 985 | Intel UHD Graphics | 55.3 | 33.5 ms | 233 | 80,788 |
| S2 Enforce | Low | 1350 x 673 | Intel UHD Graphics | 58.1 | 33.4 ms | n/a | n/a |
| S2 Enforce (Edge) | High | 1896 x 988 | Intel UHD Graphics | 17.8 | 183 ms | n/a | n/a |
| S4 Monitor peak, T+11 to 17 s (about 400 packets on screen) | High | 1904 x 985 | Intel UHD Graphics | 16.1 | 133 ms | 250 | 101,500 |
| S4 Monitor peak | Low | 1904 x 985 | Intel UHD Graphics | 35.2 | 33.8 ms | 249 | 101,044 |
| S4 Enforce peak (about 260 packets) | High | 1904 x 985 | Intel UHD Graphics | 15.7 | 167 ms | 235 | 81,160 |
| S4 Enforce peak | Low | 1904 x 985 | Intel UHD Graphics | 37.9 | 33.7 ms | 236 | 81,256 |
Pixel ratio was 1.07 in High (the adaptive pixel ratio) and 1 in Low. Playback kept real time in every run (simulation seconds
advanced equal to wall seconds within 5%). Reading: **Low meets the Rev 3 Day 6 target of >= 30 fps on an integrated GPU** (35 to 58 fps
on this Intel UHD, including the S4 flood peak); **High does not run well on it** (14 to 18 fps). Draw calls stay at the 250
budget at the S4 peak. Because of that, the app now switches itself to Low after five seconds below 25 fps (and says so, with a
"Back to High" button); throttled pages (about 1 fps, hidden window) are not mistaken for a slow GPU.
The in-app browser pane was unreliable for timing (throttled to about 1 fps whenever its window was covered), so no number
in this document comes from it after the first Stage 3 session.

## Open items
- 55 fps at High on the RTX 4050 (blocked: the GPU is not present in Windows; see above).
- Mid-run changes cover IPS mode, detector on or off and added traffic; editing rules and thresholds is the Rules page (not built).
- D5 has no scenario where IPS-1 acts on it (traffic to the Security network never reaches IPS-1); its drop action is covered by unit
  tests. D6 has no product scenario; it is covered by `flag_probe` tests and by custom traffic.
- No screenshots are saved in the repository.
