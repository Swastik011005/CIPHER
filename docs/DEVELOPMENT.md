# Development guide

How to set up, run and check NetSec 3D, how the dependencies are organised, and what continuous integration does.
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

On Windows, `scripts\setup.cmd`, `verify.cmd`, `start-demo.cmd` and `start-dev.cmd` call the same commands.
The interpreter inside the virtual environment is `backend/.venv/Scripts/python.exe` on Windows and
`backend/.venv/bin/python` elsewhere.

**Platform status:** run on Windows only. The code paths for macOS and Linux exist (the guard tests in
`backend/tests/unit/test_project_tooling.py` check the path selection) but have not been run on those systems.

## Dependencies

| File | Contents |
|---|---|
| `backend/requirements.txt` | Runtime pins: `fastapi`, `uvicorn`, `pydantic` |
| `backend/requirements-dev.txt` | `-r requirements.txt` plus the test tools: `pytest`, `httpx` (Starlette's test client), `scapy` (one test) |
| `backend/requirements.lock.txt` | Fully resolved runtime set (14 packages) |
| `backend/requirements-dev.lock.txt` | Fully resolved development set (24 packages) |
| `frontend/package.json`, `package-lock.json` | Frontend, exact versions |

The lock files were produced with `pip freeze` in clean Python 3.13 environments on Windows. A test checks that they agree with
the direct pins, and another that no server code imports a development-only package.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, `develop` and `feature/**`, and on pull requests into `main` and `develop`:

| Job | Runs on | Checks |
|---|---|---|
| Backend tests and scenario checks | Ubuntu and Windows, Python 3.13 | `pytest`, then `scripts/run_scenario_checks.py` |
| Server starts with the runtime dependencies only | Ubuntu, Python 3.13 | Installs `requirements.txt` only, builds the application, confirms no test tool is installed |
| Frontend tests and production build | Ubuntu, Node 24 | `npm ci`, `vitest run`, `npm run build` |

**The workflow has not yet run on GitHub** (the repository is not published). It was validated locally: the YAML parses, and
every command in it was run on this Windows machine. The action versions (`checkout@v4`, `setup-python@v5`, `setup-node@v4`)
are referenced by version tag and were not looked up online.

Not in CI: the real-browser tools (`scripts/rehearse_demo.mjs`, `check_offline_recovery.mjs`, `measure_fps.mjs`). They drive a
visible Chrome or Edge window; set `NETSEC_BROWSER_PATH` if the browser is installed somewhere unusual.

## What "unchanged behaviour" means here

`python scripts/run_scenario_checks.py` prints one trace hash per scenario run. For visual, tooling or deployment work these
must not change. The values on the starting point of this project (`develop` at the repository preparation commit) are:

```
S1 monitor 2e87676465e7   S1 enforce 261f62311e3a   S2 monitor 720f81078ac3   S2 enforce ea78e8d23fc9
S3 monitor fcfa8b6a1610   S3 enforce 896daec4ffc6   S4 monitor 87836d910fe4   S4 enforce d832a0637407
S5 monitor c9c52eea62fa   S6 enforce e138d470f62a   S7 monitor d1d9fb806b20   S7 enforce 8c652bdb331e
```
