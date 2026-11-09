# Stage 6 progress: Rules & Scenarios and polish (honest status)

## What was built

### Rules editor (backend first)
- `netsec/security/ruleset.py`: a `RuleSet` (detector settings, IPS policy, firewall/ACL policy files) and a `RuleStore` that holds the current set for
  the running server. Every run takes one rule set, and the set is part of `config_hash` (so of `run.meta`): a trace names the rules it ran with, the
  same rules always give the same trace, changing a rule changes the hash and changing it back restores it (a test checks all three).
  The shipped JSON files are never modified; restarting the server or `POST /api/rules/reset` returns to them.
- `GET /api/rules`, `PUT /api/rules/detectors`, `PUT /api/rules/restricted-ips`, `POST /api/rules/reset`, `GET /api/rules/export/cisco`,
  `POST /api/sim/validate` (see `API_CONTRACTS.md`). CORS now allows PUT.
- **What can be edited:** every detector's switch (D1 to D6); D1, D2 and D3 window, MEDIUM/HIGH thresholds and alert suppression; D2's ports; D6's
  signatures; D4 and D5 suppression; the restricted outside addresses. Limits are enforced on the server (for example D1 `suspicious` 2 to 50, `window_s`
  1 to 60; MEDIUM must stay below HIGH). **What is shown, not edited:** the IPS action table, the allowlist, and the firewall and ACL rules with their ids and
  the implicit deny: they are the design, and IDS-1 stays passive whatever is edited.
- **Validation:** unknown detector or field, wrong type, out of range, thresholds out of order, empty or duplicate lists, malformed, loopback, multicast, inside-the-
  campus (10/8) or repeated restricted addresses, more than 20 of them. An edit is applied whole or not at all; a refusal is HTTP 422 with one message per
  problem, each naming its field. 70 tests cover the store, the API and the effects.

### Rules & Scenarios page
Four sections, all reading and writing the backend (nothing is held only in the browser):
1. **Firewall & ACL**: the three policies with rule ids, actions, networks, ports, per-rule hit counts for the run loaded in the 3D page, the locked implicit
   deny; the restricted-address manager (add and remove go straight to the server; a bad address shows the server's reason); the Cisco IOS export (live,
   with a copy button).
2. **Detection (IDS)**: one card per detector with its switch, thresholds (shipped value and allowed range shown beside each), pending-change bar
   (Discard / Apply), inline errors, "changed from shipped" marker.
3. **Prevention (IPS)**: the order IPS-1 works in, the detector-to-action table in words, the allowlist, and the note that IDS-1 has no such table.
4. **Scenarios & checks**: a library of S1 to S7 (description, flows, duration, pinned mode, expected behaviour per IPS mode, Play in 3D, Run check) and the
  validation workflow: **Run all checks** runs every scenario in every IPS mode it supports with the rules in force and lists each expectation as
  expected / actual / PASS or FAIL (failures first). With the shipped rules: 12 runs, 93 checks, all pass. After an edit the failing rows show what the edit changed.
The page header says whether the shipped or custom rules are in force, with the rules digest; the Simulation page marks runs that used custom rules.
(The Rev 3 fallback, a pytest report instead of a Run-all button, was not needed.)

### Polish
- All 16 devices were reviewed in close-up at High quality (`docs/screenshots/devices/`): every one has its modelled detail (desks, monitors and towers; laptops;
  router with antennae; firewall gate with barrier field; core switch on its plinth with rings; access-switch cabinet; IPS arch with scan rings; IDS radome and
  radar sweep; SOC console with three screens; rack with APP-SRV, DB-SRV and the rack switch; the cloud). New: live device activity from the trace at the
  playhead (floor ring swells and a small LED lights while a device handles packets; fades in 0.7 s; frozen when paused; exact after a seek) and an IDS-1 radar
  sweep that turns faster while SPAN copies arrive. Palette, lighting, shadows, ambient occlusion and bloom are unchanged.
- Fixed: a crash on the first frame that needed a floating effect label (drei's `Html` mounts its content a moment late); caught by the new console-error check.
- Fixed: a horizontal scrollbar on Overview at 1366 and 1440 wide, caused by a long status chip that could not wrap.

## Measured

### Test suites and build (final run)
| Suite | Result |
|---|---|
| Backend pytest | **937 passed** (818 before Stage 6) |
| Frontend Vitest | **277 passed** in 18 files (255 before) |
| `npm run build` | OK |
| `scripts/check_rules_ui.mjs` (real Chrome, real backend, the Rules page end to end) | **20 of 20 steps passed**, no console errors |

### Rules tested against the real backend
Each detector switched off through `PUT /api/rules/detectors`, then its scenario run again (both IPS modes; the other detectors untouched):
D1 off: S2 and S6 raise no D1 alert, block nothing, and all 62 packets are served. D2 off: S7 raises nothing and blocks nothing. D3 off: S4 raises nothing, no limiting, no block.
D4 off: S3 keeps only the D5 alert, IPS-1 no longer rejects the admin connection (the ACL and firewall still deny theirs). D5 off: S3 keeps only the D4 alerts.
D6 off: an injected NULL probe is delivered unremarked; with only the `null` signature, NULL is caught and SYN+FIN is not.
Thresholds: D1 at 4 and 8 alerts at exactly the 4th and 8th port and blocks sooner; D1 at 40 and 50 lets the 30-port scan pass unnoticed; D3 at 25 and 200 limits but never blocks;
D3 at 150 and 300 ignores the flood; D2 ports `[3389]` ignores SSH brute force; a longer suppression window does not change the first alerts.
Restricted addresses: adding `203.0.113.25` makes FW1 deny EXT-USR with rule `OUTSIDE-IN:10` and no sensor sees it; restricting the attacker stops the whole S4 flood at FW1
before any detector (the ordinary user is untouched); clearing the default list changes nothing else. Reset restores the shipped hash and the identical trace.
Guarantees under edited rules: IDS-1 never drops or acts, every packet has one outcome, detectors still run before the limiter (a HIGH alert arrives after limiting began), the token
bucket still passes at most about 10 packets a second, controls and custom traffic stay prefix-stable, pinned scenarios stay pinned, same rules and seed give the same trace (five seeds).

### Scenario results
- **Run all checks** with the shipped rules: S1 to S7, 12 runs (S5 Monitor and S6 Enforce are pinned), **93 of 93 checks pass**. After disabling D1 only the S2 runs fail,
  and the failing rows say what changed (for example "IDS-1 raises D1 MEDIUM at the 6th distinct port and HIGH at the 12th: expected 6, 12, actual none"); the IDS-passive and one-outcome checks still pass.
- Five-seed matrix for S1, S2, S3, S4, S5, S6, S7 in both modes (determinism, event order, one outcome per packet, correlation, IDS-1 passive): all pass.
- S1 and S2 trace bodies are still byte-identical to Stage 3.

### Visual checks (real Chrome, `scripts/capture_screens.mjs`, `docs/screenshots/`)
All five pages at **1366 x 768, 1440 x 900 and 1920 x 1080**, High quality: no sideways scrolling in the window or in any inner scroll container, no wide element, **no console errors**.
The 3D page was shot at all six camera presets (1920 x 1080 kept in the repository). 16 device close-ups are in `docs/screenshots/devices/`.

### Memory (`scripts/measure_memory.mjs`, `docs/perf/memory-s4-high-10min.json`)
10 minutes of S4 Enforce at High quality, played at 2x, restarted whenever it ended and re-run from the backend every minute (so trace loading is exercised too), 20 samples with a forced
garbage collection before each. JS heap after a 90 s warm-up: **53.66 MB at the start of the baseline, 53.00 MB at the end: -1.2 %** (limit 15 %; peak 53.98 MB). DOM nodes (1183 to 1130),
event listeners (3394 to 3394), three.js geometries (174 to 174) and textures (54 to 54) did not grow. The first attempt was discarded: a Vite hot reload during the run reset the page.

### Frame rate on the integrated GPU (`scripts/measure_fps.mjs`; Chrome 156; WebGL renderer **Intel UHD Graphics**, D3D11)
S4 Monitor peak (T+11 to 17 s, the busiest moment: about 400 packets on screen, 250 draw calls, about 95k to 101k triangles):
| Window | Inner size | Low | High |
|---|---|---|---|
| 1366 x 768 | 1350 x 673 | **59.3 fps** | 31.3 fps |
| 1440 x 900 | 1424 x 805 | **59.2 fps** | 27.2 fps |
| 1920 x 1080 | 1904 x 985 | **31.1 fps** | 15.2 fps |
**The Low preset meets the Rev 3 target of at least 30 fps on an integrated GPU at all three sizes** (31.1 fps at 1080p is the thinnest margin; an earlier run measured 35.2). The automatic fall-back to
Low after five seconds under 25 fps is kept and tested. **The High-preset 55 fps target on the RTX 4050 is not verified**: Windows still reports that GPU as not present, so no browser can use it
(`STAGE4_PROGRESS.md`); nothing in this document claims it.


## Advanced features (Rev 3 "advanced"; none is a feature-freeze gate)
| Feature | Status |
|---|---|
| D3 half-open condition ("or more than 40 half-open connections") | Not implemented; documented simplification in `d3_flood.py`: it needs the replies on the sensor's path. The rate condition is implemented and tested. |
| Monitoring charts (traffic over time, protocol mix, top talkers) | Not built. The Monitoring page is the Rev 3 table fallback: KPIs, why packets were stopped, device table, event log, all equal to the Simulation counters. |
| PCAP export and hex view (Scapy) | Not built. Scapy is installed and used as a codec in tests only; no export endpoint or hex view. |
| Cisco IOS ACL export | **Built** (backend generator, endpoint, Firewall tab, tests). |
| Follow-packet camera | Not built. Packets can be selected in the scene or from the list and inspected; the camera does not follow them. |

## Open items
- 55 fps at the High preset on the RTX 4050 (the S4-peak and Stage 3 criteria): **not verified**; Windows does not currently list the GPU as present. See `STAGE4_PROGRESS.md`.
- Rules are held in the server's memory (reset on restart), by design: nothing edits the shipped files.
- The IPS action table, the allowlist and the firewall/ACL rules are not editable (see above); mid-run rule changes are not supported (controls cover IPS mode and detector on/off).
- Monitoring charts, PCAP/hex, follow-packet camera, D3 half-open: not built (table above).
