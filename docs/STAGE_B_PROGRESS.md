# Stage B: deployment readiness for Render (record)

Scope: prepare the project for a Render deployment (static site plus Python web service) and harden the backend for public
use. Nothing was created on Render, nothing was deployed or pushed. Simulation logic, topology, packet outcomes, IDS/IPS
behaviour and scenario definitions were not changed. Measured on one Windows laptop (see `docs/DEVELOPMENT.md`).

## Results (executed)

| Check | Result |
|---|---|
| Backend tests | **1068 passed** (948 from Stage A plus 120 new: settings, protection, hardened API, Blueprint) |
| Frontend tests | **287 passed** in 19 files (277 plus 10 new) |
| Scenario checks | **12 of 12 runs, 93 of 93 checks**; trace hashes identical to the Stage A baseline (see `docs/DEVELOPMENT.md`) |
| Production build | succeeds (gzipped: app shell about 119 kB, lazily loaded 3D scene about 499 kB) |
| `demo` and `dev` smoke test | 8 of 8 (health, 17 nodes and 18 links, deep-link refresh, Vite proxy following `NETSEC_PORT`, ports freed) |
| Local split-origin simulation (`tasks.py split-check`) | **20 of 20** checks; 34 of 34 rehearsal steps with the API on another origin |
| Browser rehearsal, demo mode (same origin) | 34 of 34, no console errors, no request off 127.0.0.1 |
| Offline recovery | 8 of 8 |

The split-origin simulation serves the production build from one origin, the API (with the environment `render.yaml` gives it) from
another, and applies the Blueprint's own response headers including the Content-Security-Policy. In real Chrome it checks: the
deep-link refresh, cross-origin CORS and preflight, a scenario running, the 3D scene drawing (238 meshes, 82k triangles), the
Rules page showing its lock with all 27 detector fields disabled, a direct rule edit refused with 403, and a clean console.

**It is a local simulation.** It proves the configuration works across two origins with Render's headers. It does not test Render.

## Performance impact

No scene code changed. S4 Enforce at its peak, 1904 x 985, Chrome on the Intel UHD (not the RTX 4050, whose 55 fps target is still
unverified): **High 21.4 fps** (Stage A: 19.4), **Low 59.7 fps** (Stage A: 59.8); 241 draw calls and 82,096 triangles in both. The
differences are within the noise of this laptop. Responses are now gzip-compressed (an S4 trace is about 1.6 MB of JSON).

## Defects found by the new checks, and fixed

| Found by | Defect | Fix |
|---|---|---|
| Split-origin simulation | The Content-Security-Policy blocked the `blob:` web worker that lays out the 3D zone captions, so **the 3D world never rendered** (0 meshes) while the page text still looked fine | `script-src 'self' blob:` (and `worker-src`), with the reason written in `render.yaml` and a test |
| Streamed-body test | FastAPI turns any error while reading a body into a 400, so an oversized streamed body was not answered 413 | The size middleware replaces that answer with the 413 |
| Split-origin simulation | The API served the single-page app for `/docs` when a front end build existed | `NETSEC_SERVE_FRONTEND=false` for the API service |
| Review of the `.env` reader | It does not strip inline comments, so a commented value in the production example would have been invalid | Comments on their own lines, and a test that loads both example files |
| Review | The post-deployment checker could have sent a rule edit to a server that accepts it | It checks `read_only` first and sends nothing otherwise (tested) |

## Remaining limitations

* Render itself is untested: the Blueprint field names come from Render's documentation; the Linux build (the lock file was made on
  Windows), the pinned Python and Node versions, `checksPass` auto-deploy, cold-start time and memory on the free instance are unknown.
* Per-visitor rate limiting is **off by default** (trust in proxy headers is off) because what Render's proxy sends was not verified. Visitors
  therefore share one allowance of 20 runs and 3 validations a minute. `docs/DEPLOYMENT_RENDER.md` section 6 says how to verify and enable it.
* The rate limiter and the rule store are in memory in one process: one instance only, and a restart forgets both.
* A free Render API sleeps after 15 minutes idle and needs about a minute to wake; the page says so and keeps retrying.
* The GitHub Actions workflow (including the new production-mode probe) has not run on GitHub; macOS and Linux are untested.
* No licence has been chosen.
