# Stage 7: final demo readiness and delivery (code freeze, v1.0)

Scope: no new features. Verification, reproducibility, documentation and presentation material. Everything below was
executed on 3 November 2026 on one laptop unless it says otherwise.

## Results (executed)
| Check | Result | How |
|---|---|---|
| Backend tests | **937 passed** (171 s) | `scripts\verify.cmd` (pytest) |
| Scenario checks | **12 of 12 runs, 93 of 93 checks** | `scripts\run_scenario_checks.py` via verify |
| Frontend tests | **277 passed** (18 files) | Vitest via verify |
| Production build | succeeds | `npm run build` via verify |
| Whole `verify.cmd` | **ALL CHECKS PASSED**, 181 s | |
| Demo rehearsal in real Chrome (demo mode) | **34 of 34**, no console error, no request outside 127.0.0.1 | `node scripts\rehearse_demo.mjs` |
| Offline and recovery | **8 of 8** (backend killed with the page open, "Engine offline", loaded run kept and scrubbable, Run disabled, restart noticed without reload, new run works, no external request) | `node scripts\check_offline_recovery.mjs` |
| `start-demo.cmd` | launched, `/simulation` returned the app (HTTP 200), health OK, stopped cleanly | run by hand |
| `start-dev.cmd` | both servers answered (backend :8000, Vite :5173, and the Vite proxy to `/api`), then stopped; ports freed | run by hand |

## Fresh-clone test (one machine)
A `git clone` of the repository (commit `83c827a`) into an empty folder, with the pip cache disabled and an empty npm cache,
then `scripts\setup.cmd`:

| Step | Result |
|---|---|
| `setup.cmd` (venv, pip install, `npm ci`, build) | **561 s (9 min 21 s)** on a slow connection, cold caches. Target: 15 min. |
| `verify.cmd` in the clone | all passed, 168 s (277 frontend tests, 93/93 checks; the pytest total was not printed by that version of the script, the dots add up to 937) |
| Demo mode from the clone on port 8200, rehearsal | 34 of 34 (after the script fix below) |
| `check_offline_recovery.mjs` from the clone | 8 of 8 |

The **first** attempt failed during `pip install` ("No matching distribution found for pydantic-core==2.50.2 (from versions: none)").
`pip index versions pydantic-core` and `pip download pydantic-core==2.50.2` showed the version is on PyPI and downloadable, and the
second cold attempt passed, so the cause was a transient network or index problem, not the requirements. `setup.cmd` now passes
`--retries 8 --timeout 60` to pip and `--fetch-retries` to npm and prints what to do on failure.

Machine: Lenovo 83DV, 13th Gen Intel Core i5-13450HX, 25 GB RAM, Windows 11 Home (build 26300), Python 3.13.7, Node 24.15.0,
Chrome. Graphics: Intel UHD (used by Chrome) and NVIDIA GeForce RTX 4050 Laptop GPU (see below).

**Second team laptop: not available, not tested.** Its environment differences are unknown. The README lists the prerequisites
(Python 3.12+, Node 20.19+, Chrome or Edge); a laptop with older versions would be the first thing to check.

## Defects found and fixed in this stage
| Found by | Defect | Fix |
|---|---|---|
| `check_offline_recovery.mjs` | When the engine stopped, the Simulation page replaced the scenario list and Run button with an error, so the loaded run could not be used | `ScenarioPanel.jsx` keeps the existing scenario list when a refresh fails |
| Fresh-clone rehearsal | The rehearsal script clicked the S2 card before it had rendered (30 of 31 twice, in the clone only) | `rehearse_demo.mjs` waits for the card. A test-script race, not an application defect |
| Cold install | Transient pip failure (see above) | Retrying setup script |
| Review | `/api/health` still reported stage 6 and version 0.1.0; `SECURITY_ENGINE.md` said the Rules editor was not implemented | Version 1.0.0, stage 7; docs corrected |
| Review | `verify.cmd` did not print the pytest total (the project's `addopts = -q` plus `-q` hides the summary) | `-o addopts=` so it prints `937 passed` |

No critical or major defect is open. Minor and documented items are in `docs/LIMITATIONS.md`.

## Performance (retained, not re-claimed)
The Intel UHD Low-preset measurements from Stage 6 are unchanged (59.3, 59.2 and 31.1 fps at the S4 peak at 1350 x 673, 1424 x 805 and 1904 x 985;
High 31.3, 27.2 and 15.2; 10-minute memory test -1.2 %). Windows now reports the RTX 4050 as present (`Present = True`), which it
did not during the earlier measurement. A new S4 High measurement with default Chrome settings still rendered on the **Intel UHD**
(WebGL renderer string) at **17.8 fps** at 1904 x 985. Making Chrome use the RTX needs a Windows per-app graphics preference,
a system setting that was not changed. **The 55 fps RTX 4050 target has not been verified and is not claimed.** How to test it is
in `docs/LIMITATIONS.md`.

## Deliverables
| Deliverable | Path |
|---|---|
| README (prerequisites, install, run, configuration, troubleshooting) | `README.md` |
| One-command setup, demo, dev, verify | `scripts\setup.cmd`, `scripts\start-demo.cmd`, `scripts\start-dev.cmd`, `scripts\verify.cmd` |
| Scenario checks from the command line | `scripts\run_scenario_checks.py` |
| Real-browser rehearsal and offline-recovery tools | `scripts\rehearse_demo.mjs`, `scripts\check_offline_recovery.mjs`, `scripts\lib\cdp.mjs` |
| Timed demo script (9 min 40 s) | `docs\DEMO_SCRIPT.md` |
| Nine-slide presentation with speaker notes | `docs\presentation\CIPHER-final-presentation.pptx` (generator: `docs\presentation\build_deck.js`) |
| Viva question bank | `docs\VIVA_QA.md` |
| Offline checklist, backup plan, recovery steps | `docs\BACKUP_AND_RECOVERY.md` |
| Real screenshots (rehearsal, offline recovery, every page and device) | `docs\demo\`, `docs\screenshots\` |
| Limitations and what was not measured | `docs\LIMITATIONS.md` |
| Team and ownership | `docs\TEAM.md` |
| Updated architecture and security engine documents | `docs\ARCHITECTURE.md`, `docs\SECURITY_ENGINE.md` |

## About the presentation
The deck has nine slides: problem statement, objectives, architecture, topology, technologies, IDS/IPS workflow, scenarios,
results and testing, conclusion and future scope. It uses real screenshots and the executed numbers above, says plainly that the
traffic is simulated, and names the RTX target and the second laptop as unverified. It was **not opened in PowerPoint or
LibreOffice** (neither is on this machine) and the bundled schema validator could not run properly on Windows. It was generated by
`pptxgenjs`, checked with `python-pptx` (opens, 9 slides, speaker notes present), measured with Calibri font metrics for text fit and slide
bounds, and drawn from its own shape geometry in Chrome to check for overlaps. Open it once in PowerPoint before presenting and
look at slide 8 (the chart) in particular.

## About the backup recording
No screen recording was made. `docs\BACKUP_AND_RECOVERY.md` describes how to make one; until then the backup is the screenshots.

## Unimplemented and limits
See `docs\LIMITATIONS.md` (Packet Tracer lab, D3 half-open condition, D7, Monitoring charts, PCAP export, follow-packet camera,
syslog packets, mid-run rule edits, rule persistence).
