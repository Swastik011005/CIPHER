# Development guide

How to set up, run and check CIPHER, how the dependencies are organised, and what continuous integration does.
The branch and approval rules are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## The task runner

`scripts/tasks.py` uses only the Python standard library, so it works before anything is installed.

| Command | What it does |
|---|---|
| `python scripts/tasks.py setup` | Creates `backend/.venv`, installs `backend/requirements-dev.txt`, runs `npm ci` and builds the frontend. Needs the internet once. Retries downloads. |
| `python scripts/tasks.py setup --runtime-only` | Same, but installs only `requirements.txt` (what the server needs, no test tools). |
| `python scripts/tasks.py verify` | Backend tests, scenario checks, frontend tests, production build. Runs every step, prints a summary, exits non-zero if any failed. `--only backend scenarios frontend build` picks steps. |
| `python scripts/tasks.py demo` | Demo mode: one process serves the API and `frontend/dist` at http://127.0.0.1:8000/simulation and opens the browser. |
| `python scripts/tasks.py dev` | Backend on :8000 and the Vite dev server on :5173 in one terminal (Ctrl+C stops both). |
| `python scripts/tasks.py split-check` | Local simulation of the Render layout: front end and API on two origins, with Render's headers, in real Chrome. `--skip-rehearsal` skips the 34-step rehearsal. See `docs/DEPLOYMENT_RENDER.md`. |
| `python scripts/tasks.py check-deployed --api <url> --site <url>` | The same HTTP checks against a deployed API and site. `--spoof-test` also probes the rate limit. |

On Windows, `scripts\setup.cmd`, `verify.cmd`, `start-demo.cmd` and `start-dev.cmd` call the same commands.
The interpreter inside the virtual environment is `backend/.venv/Scripts/python.exe` on Windows and
`backend/.venv/bin/python` elsewhere.

**Platform status:** run on Windows only. The code paths for macOS and Linux exist (the guard tests in
`backend/tests/unit/test_project_tooling.py` check the path selection) but have not been run on those systems.

## Dependencies

| File | Contents |
|---|---|
| `backend/requirements.txt` | Runtime pins: `fastapi`, `uvicorn`, `pydantic` |
| `backend/requirements-dev.txt` | `-r requirements.txt` plus the test tools: `pytest`, `httpx` (Starlette's test client), `pyyaml` (reads `render.yaml` and the CI workflow in tests), `scapy` (one test) |
| `backend/requirements.lock.txt` | Fully resolved runtime set (14 packages) |
| `backend/requirements-dev.lock.txt` | Fully resolved development set (25 packages) |
| `frontend/package.json`, `package-lock.json` | Frontend, exact versions |

The lock files were produced with `pip freeze` in clean Python 3.13 environments on Windows. A test checks that they agree with
the direct pins, and another that no server code imports a development-only package.

## Configuration: development and production

Settings are environment variables (or `KEY=VALUE` lines in `backend/.env`; real variables win). With none set the backend is the
local-only development server. `backend/.env.example` is the development template and `backend/.env.production.example` the
production one; `frontend/.env.example` and `frontend/.env.production.example` do the same for the front end. Every setting is
validated at start-up and an unsafe combination stops the server with a message.

| Variable | Development default | Production default (`NETSEC_ENV=production`) |
|---|---|---|
| `NETSEC_HOST` | `127.0.0.1`; any other host is refused | same; a non-loopback IP needs `NETSEC_ALLOW_PUBLIC_BIND=true` as well |
| `NETSEC_PORT` / `PORT` | 8000; `PORT` is ignored | `NETSEC_PORT`, else the platform's `PORT`, else 8000 |
| `NETSEC_CORS_ORIGINS` | the Vite dev server origins | none; exact `https` origins only, no wildcard |
| `NETSEC_RULES_READ_ONLY` | off (rules editable) | **on** |
| `NETSEC_ENABLE_DOCS` | on | **off** |
| `NETSEC_RATE_LIMIT` (`_RUN_PER_MIN`, `_VALIDATE_PER_MIN`, `_API_PER_MIN`) | off | **on**: 20, 3 and 240 a minute per client |
| `NETSEC_MAX_BODY_BYTES` | 65536 | 65536 |
| `NETSEC_SERVE_FRONTEND` | on (serves `frontend/dist` if built) | on; the Render API service sets it off |
| `NETSEC_TRUST_PROXY`, `NETSEC_TRUSTED_PROXY_HOPS`, `NETSEC_CLIENT_IP_HEADER` | off | off (see `docs/DEPLOYMENT_RENDER.md`, section 6) |
| `VITE_API_BASE` (front end, read when it is built) | `/api` | the full API URL, e.g. `https://netsec-3d-api.onrender.com/api` |

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, `develop` and `feature/**`, and on pull requests into `main` and `develop`:

| Job | Runs on | Checks |
|---|---|---|
| Backend tests and scenario checks | Ubuntu and Windows, Python 3.13 | `pytest`, then `scripts/run_scenario_checks.py` |
| Server starts with the runtime dependencies only | Ubuntu, Python 3.13 | Installs `requirements.txt` only, builds the application, confirms no test tool is installed, then starts it in production mode and probes it (health 200, `/docs` 404, a rule edit 403, CORS header) |
| Frontend tests and production build | Ubuntu, Node 24 | `npm ci`, `vitest run`, `npm run build` |

**The workflow has not yet run on GitHub** (the repository is not published). It was validated locally: the YAML parses, and
every command in it was run on this Windows machine. The action versions (`checkout@v4`, `setup-python@v5`, `setup-node@v4`)
are referenced by version tag and were not looked up online.

Not in CI: the real-browser tools (`scripts/rehearse_demo.mjs`, `check_offline_recovery.mjs`, `measure_fps.mjs`). They drive a
visible Chrome or Edge window; set `NETSEC_BROWSER_PATH` if the browser is installed somewhere unusual.

## What "unchanged behaviour" means here

`python scripts/run_scenario_checks.py` prints one trace hash per scenario run. For visual, tooling or deployment work these
must not change. The values at the start of this project (`develop` at the repository preparation commit) were:

```
S1 monitor 2e87676465e7   S1 enforce 261f62311e3a   S2 monitor 720f81078ac3   S2 enforce ea78e8d23fc9
S3 monitor fcfa8b6a1610   S3 enforce 896daec4ffc6   S4 monitor 87836d910fe4   S4 enforce d832a0637407
S5 monitor c9c52eea62fa   S6 enforce e138d470f62a   S7 monitor d1d9fb806b20   S7 enforce 8c652bdb331e
```

**The campus extension changed these hashes on purpose, and nothing else.** A trace hash covers `run.meta.config_hash`, and the
topology is part of that hash. Adding 14 devices and 14 links (and the new optional scenario fields) therefore changes every hash.
It does not change a single event: `backend/tests/scenarios/test_extension_equivalence.py` replays the original scenarios and
compares them event by event with the golden traces recorded on the original 17-node topology; they are identical apart from the
two identifiers inside `run.meta` that are derived from that hash. The values now are:

```
S1 monitor 57cf6670ce8a   S1 enforce 0faa2b791f6e   S2 monitor 307190852d2a   S2 enforce 44dd9e4738d8
S3 monitor bf20f361e402   S3 enforce ac6bc5d49145   S4 monitor 3ad9ecd2b964   S4 enforce 3c3d85f3f55b
S5 monitor 85dc9ea334fa   S6 enforce e1b4b9c05cc5   S7 monitor fabf892d87b9   S7 enforce bc1b9cbdbeb2
```

Use the new values as the reference for later work, and keep the equivalence test.

## Reference measurements (Stage A, Windows laptop)

Recorded on one laptop (Intel Core i5-13450HX, Windows 11, Python 3.13.7, Node 24.15.0). Chrome rendered on the **Intel UHD**
graphics (WebGL renderer string `ANGLE (Intel, Intel(R) UHD Graphics ... Direct3D11)`), not the discrete GPU, so none of this
says anything about the 55 fps target on an RTX 4050, which remains unverified.

| Check | Result |
|---|---|
| Backend tests | 1210 passed (v1.0 release: 948) |
| Frontend tests | 367 passed in 31 files (v1.0 release: 277 in 18 files) |
| Scenario checks | 12 of 12 runs, 93 of 93 checks; trace hashes identical to the values above |
| Production build | succeeds |
| Fresh clone: `tasks.py setup` | 44 s with warm package caches; `tasks.py verify` 48 s |
| Browser rehearsal (`rehearse_demo.mjs`, real Chrome, demo mode) | 34 of 34 checks, no console error, no request outside 127.0.0.1 |
| Offline recovery (`check_offline_recovery.mjs`) | 8 of 8 checks |
| Frame rate, S4 Enforce at its peak, 1904 x 985 | **High 19.4 fps** (worst 1% frame 150 ms), **Low 59.8 fps** (worst 1% frame 17.2 ms); 242 and 241 draw calls, about 82k triangles |

Use these as the "before" numbers when judging rendering changes: the 3D stages must not make the High or Low figures worse.
Run the browser tools with `--out <folder>` (rehearsal, offline recovery) to avoid rewriting the screenshots under `docs/demo`.
