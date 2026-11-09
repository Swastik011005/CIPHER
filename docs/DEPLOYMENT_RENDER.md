# Deploying CIPHER on Render

> **Status: prepared, not deployed.** Nothing has been created on Render, nothing is published, and no domain or paid service
> is involved. Everything below was checked **locally**, including a simulation of the two-origin layout. That simulation
> proves the configuration works with Render's headers; it says nothing about Render itself (its proxy, builds or cold
> starts). Section 9 lists exactly what was and was not verified.

## 1. The architecture

```
 visitor's browser
   │  https://netsec-3d.onrender.com                    https://netsec-3d-api.onrender.com
   ▼                                                      ▲
 Render Static Site  "netsec-3d"                          │ fetch(VITE_API_BASE + "/scenarios", ...)
   serves frontend/dist (HTML, JS, fonts)                 │ cross-origin, JSON, CORS allow-list = the site's origin
   rewrites client-side routes to /index.html             │
   adds security headers + Content-Security-Policy        │
                                                  Render Web Service "netsec-3d-api"  (Python 3.13, free plan)
                                                    python app.py  -> FastAPI engine, read-only rules,
                                                    rate limits, size limit, gzip, no API docs
```

| Piece | Render type | Defined in |
|---|---|---|
| Front end (React, Three.js) | Static Site, free | `render.yaml`, service `netsec-3d` |
| API (FastAPI simulation engine) | Web Service, Python, free | `render.yaml`, service `netsec-3d-api` |
| Database, disk, secrets | **None needed** | The engine is stateless apart from the in-memory rule store, which is read-only in production |

**Addresses.** Render builds `https://<service name>.onrender.com` if the name is free. The preferred front end address is
`netsec-3d.onrender.com`; the API is `netsec-3d-api.onrender.com`. If either is taken, Render adds a suffix; then change
the three values marked `ADDRESS` in `render.yaml` (the API's `NETSEC_CORS_ORIGINS`, the front end's `VITE_API_BASE`, and the
`connect-src` of the Content-Security-Policy) and redeploy both. `backend/tests/unit/test_render_blueprint.py` fails if those
values stop agreeing with each other.

## 2. What is in the repository for this

| File | Purpose |
|---|---|
| `render.yaml` | The Blueprint: both services, build and start commands, health check, environment, headers, rewrite rule |
| `backend/.env.production.example`, `frontend/.env.production.example` | The same settings as environment-file templates, with explanations |
| `backend/netsec/config.py` | Reads and validates every setting; refuses unsafe combinations |
| `backend/netsec/api/protection.py` | Request size limit, rate limiter, security headers |
| `scripts/tasks.py split-check` | The local two-origin simulation (needs no Render account) |
| `scripts/tasks.py check-deployed` | The same HTTP checks against a deployed API, run after you deploy |

## 3. Configuration

### API service (`netsec-3d-api`)

| Variable | Value in `render.yaml` | Meaning |
|---|---|---|
| `PYTHON_VERSION` | `3.13.7` | New Render services default to a newer Python than this project was tested on, so it is pinned (fully qualified, as Render requires) |
| `NETSEC_ENV` | `production` | Switches every default to the safe side (below). Required for a public deployment |
| `NETSEC_HOST` | `0.0.0.0` | Bind on all interfaces so Render's proxy can reach it |
| `NETSEC_ALLOW_PUBLIC_BIND` | `true` | The server **refuses** a non-loopback host without this *and* `NETSEC_ENV=production` |
| `PORT` | set by Render (10000) | Read in production when `NETSEC_PORT` is not set. Ignored in development, so a stray `PORT` cannot move a local server |
| `NETSEC_CORS_ORIGINS` | `https://netsec-3d.onrender.com` | The exact origin(s) allowed to call the API from a browser. No wildcard is accepted; production requires https |
| `NETSEC_SERVE_FRONTEND` | `false` | The API never serves a front end (the static site does that) |
| `NETSEC_RULES_READ_ONLY` | `true` | Nobody can change the rules the other visitors run with (default in production) |
| `NETSEC_ENABLE_DOCS` | `false` | No `/docs`, `/redoc`, `/openapi.json` (default in production) |
| `NETSEC_RATE_LIMIT` and `..._RUN_PER_MIN` / `..._VALIDATE_PER_MIN` / `..._API_PER_MIN` | on, `20` / `3` / `240` | Per client per minute: scenario runs, "run all checks", everything else except `/api/health` |
| `NETSEC_MAX_BODY_BYTES` | `65536` | Larger request bodies get 413. The largest legitimate request is well under 2 kB |
| `NETSEC_TRUST_PROXY` | `false` | See section 6: do not believe forwarded headers until they are verified |
| `NETSEC_LOG_LEVEL` | `info` | |

### Front end service (`netsec-3d`)

| Variable | Value | Meaning |
|---|---|---|
| `NODE_VERSION` | `24.15.0` | The version it was built and tested with (Vite 8 needs 20.19 or newer) |
| `VITE_API_BASE` | `https://netsec-3d-api.onrender.com/api` | Where the browser sends API calls. **Vite writes it into the bundle when it builds**, so it is public, and changing it needs a rebuild |

Build: `npm ci && npm run build` in `frontend/`, publishing `dist`. Start command: none (static).

### Local behaviour is unchanged

Without `NETSEC_ENV=production` the server is exactly what it was: loopback only, port 8000, `/docs` on, rules editable, no
rate limit, only the Vite dev server origins allowed, and `NETSEC_HOST=0.0.0.0` is refused with an explanation.
`python scripts/tasks.py demo` and `dev` work as before.

## 4. Security decisions

| Decision | Why |
|---|---|
| Local-only stays the default; public binding needs `NETSEC_ENV=production` **and** `NETSEC_ALLOW_PUBLIC_BIND=true` | One forgotten variable must not expose the backend. Either alone is refused at start-up |
| Rules are read-only in production | The rule store is one object shared by every visitor and every request: one visitor's edit would change every other visitor's runs (and, with several processes, apply to only some of them). The Rules page shows a lock and a banner; the server answers 403 to any edit, before looking at the body |
| CORS is an exact allow-list | No `*`, no credentials, https only in production (except loopback, for local tests). With no origins configured, no browser on another origin can call the API |
| Request body limit (64 kB) | The engine accepts small JSON; anything large is hostile or a mistake. Checked by declared length and again as the body streams in |
| Per-client rate limits | `/api/sim/run` and especially `/api/sim/validate` (runs every scenario) cost CPU; a free instance is small |
| `/docs` off | It describes every endpoint to anyone. Not needed by the app |
| Gzip | A scenario trace is up to about 1.6 MB of JSON; compressed it is a fraction of that. Compression changes the bytes, not the trace (a test compares trace hashes) |
| Security headers on the API (`nosniff`, no referrer, frame deny, `no-store`) and on the static site (plus HSTS, Permissions-Policy and a Content-Security-Policy) | Cheap, conventional hardening. The policy allows only the site's own files and the API origin |
| No authentication, no database | Not needed for a read-only public demo, and not approved |
| Auto-deploy only after CI checks pass (`autoDeployTrigger: checksPass`) | A failing build must not reach the public site. Use `off` for fully manual deploys |

## 5. Creating the services (when you approve it)

This is the order to follow. **None of it has been done.**

1. Push the repository to GitHub (needs your separate approval) and let CI run on `main`.
2. In the Render dashboard choose **New > Blueprint**, connect the repository and branch `main`. Render reads `render.yaml` and
   shows two services, both on the free plan. Check the plan for each before applying.
3. Note the addresses Render assigns. If they are not the two above, edit the `ADDRESS` values (section 1), commit, and let
   Render redeploy.
4. Wait for both builds. Open the API's address `/api/health`: it should answer `{"status":"ok", ...}`.
5. Run the checks in section 7.

## 6. Rate limits: how they work, and their limits

* The limiter is **in memory and per process**. A restart forgets everyone; several instances would each count separately.
  The deployment is one instance (the free plan allows nothing else).
* **Which address is limited.** By default the socket peer, which behind Render's proxy is the proxy: all visitors then share
  one allowance (20 runs a minute in total). That is strict, but nobody can choose their own bucket. It is the shipped setting
  because the proxy's behaviour has not been verified here.
* Render's own guidance says its web services sit behind Cloudflare and Render's load balancer; that the proxy **appends** to
  `X-Forwarded-For` without removing what the caller sent (so the left-hand entries can be forged); and that Cloudflare sets
  `CF-Connecting-IP`, overwriting whatever the caller sent. This comes from Render's articles and community answers, **not from
  a test of this deployment**.
* To count each visitor separately, enable one of these on the API service, **then verify (below)**:
  * `NETSEC_TRUST_PROXY=true` and `NETSEC_CLIENT_IP_HEADER=cf-connecting-ip` — one header the proxy overwrites; used only if it
    appears exactly once and holds an IP address; or
  * `NETSEC_TRUST_PROXY=true` and `NETSEC_TRUSTED_PROXY_HOPS=N` — the `X-Forwarded-For` entry written by the last N proxies,
    counted from the right (the left-hand entries are never believed).
  A missing, repeated or malformed value falls back to the socket peer. Trusting a header is only sound if the server can be
  reached **only** through that proxy.
* **How to verify** after enabling it: `python scripts/tasks.py check-deployed --api <api url> --site <site url> --spoof-test`
  sends 30 runs, each with a different invented `X-Forwarded-For` and `CF-Connecting-IP`. If a 429 still appears within about 21
  requests, invented values buy nothing. If it never appears, the header is spoofable: switch trust off again. Then, from two
  different networks, confirm that one exhausting its allowance does not block the other.
* A visitor who is rate limited sees the server's message (the app shows it); `Retry-After` says how long to wait.

## 7. After deploying: what to check

```
python scripts/tasks.py check-deployed --api https://netsec-3d-api.onrender.com/api --site https://netsec-3d.onrender.com
```

It checks, over HTTPS: health; CORS for the site's origin and none for another; no wildcard or credentials; the preflight for a
JSON POST; `/docs`, `/redoc`, `/openapi.json` not served; a run working across origins and compressed; security headers; a rule
edit refused with 403; a 200 kB body refused with 413; the static site answering a deep link with the app and sending the
Content-Security-Policy; hashed assets cached; and (with `--spoof-test`) the rate limit. Then open the site in a real browser and
check, by eye: the 3D scene appears, a scenario plays, **the Rules page shows the lock and every control is disabled**, and the
browser console has no errors (a Content-Security-Policy mistake would show up there).

## 8. Free-plan behaviour you will notice

From Render's documentation (checked while preparing this):

* A free web service **spins down after 15 minutes without traffic** and takes about a minute to start again. The first visit
  after a quiet period therefore shows "Engine offline" for up to a minute while the page keeps retrying every 3 seconds; the
  app says so ("the engine may be waking up") when its API is on another origin.
* 750 free instance hours a month per workspace; when they run out, free web services are suspended until the next month.
* One instance, no disk (local files vanish on restart), outbound bandwidth and build minutes are metered.
* Free static sites do not sleep.
* A health check passes on any 2xx or 3xx within 5 seconds; `/api/health` is never rate limited. After 15 s of failures Render
  stops routing to the instance, after 60 s it restarts it.

## 9. What was verified, and what was not

**Verified locally (Windows, this repository):**
* Settings, host binding rules, `PORT`, CORS parsing and defaults: unit tests.
* Read-only rules, docs off, size limits (declared and streamed), rate limits (per class, per client, proxy trust rules),
  CORS (allowed, refused, preflight, refusals still readable), gzip, headers: API tests against the real application, including that a
  production server returns exactly the trace the engine produces.
* `render.yaml`: parsed by tests; its API environment is loaded through the real settings code; names, origins and the
  Content-Security-Policy agree.
* The two-origin layout in real Chrome with Render's headers and Content-Security-Policy, and the full demo rehearsal across
  origins: `python scripts/tasks.py split-check` (results are recorded in `docs/STAGE_B_PROGRESS.md`).

**Not verified (cannot be, without deploying):**
* That Render accepts the Blueprint exactly as written (field names were taken from Render's documentation, not tested).
* The build on Render's Linux images (the lock file was produced on Windows; no Linux run exists), the pinned Python and Node versions being
  available, and `checksPass` auto-deploy behaviour.
* What Render's proxy sends in `X-Forwarded-For` and `CF-Connecting-IP`, and therefore per-visitor rate limiting.
* Cold-start time, real latency, and memory use on the free instance.
* HTTPS, HSTS and the CDN headers as Render serves them; that the CSP works there exactly as it did locally.

## 10. Future: per-session rules (not implemented)

Letting each visitor edit rules would need rules held per session, not per server: the browser keeps its edited rule set and sends it
with each run (the engine already takes a rule set per run, and the digest is part of each trace). It would need a size and
validation limit on that payload, and it avoids shared state and any login. It needs your approval and is out of scope here.

## 11. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Page loads but "Engine offline" stays | The API address in `VITE_API_BASE` is wrong or the build used an old value (Vite bakes it in: change it, then redeploy the front end). Or the service is waking up (wait a minute) |
| Browser console: CORS error | `NETSEC_CORS_ORIGINS` is not the front end's exact origin (scheme and host, no path, no trailing slash) |
| Browser console: Content-Security-Policy violation | `connect-src` in the front end's headers does not list the API origin |
| Refreshing `/rules` shows "Not Found" | The front end was not created from the Blueprint, so the rewrite rule is missing: add `/*` to `/index.html` as a **Rewrite** in the dashboard |
| 429 after a few runs | Rate limit (visitors share one allowance by default, section 6); the message says how long to wait |
| 403 on a rule edit | Working as designed: rules are read-only in production |
| API fails to start: "not a loopback address" | `NETSEC_ENV=production` and `NETSEC_ALLOW_PUBLIC_BIND=true` must both be set |
| API fails to start: `NETSEC_CORS_ORIGINS` | A wildcard, a path, or an `http://` origin in production |
| Build fails installing Python packages | Use `pip install -r requirements.txt` as the build command instead of the lock file |
| Wrong Python or Node in the build log | `PYTHON_VERSION` must be fully qualified; check `NODE_VERSION` on the front end |

## 12. Rollback and removal

Render keeps previous deploys: use **Rollback** on a service. To take the site offline, suspend or delete the services in the
dashboard; nothing else (no database, disk or domain) needs removing. Setting `autoDeployTrigger: off` in `render.yaml` makes
deploys manual.
