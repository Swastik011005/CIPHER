# API and event contracts

Base: `http://127.0.0.1:8000/api` (the Vite dev server proxies `/api`). Interactive docs at `/docs`.

| Method and path | Purpose |
|---|---|
| `GET /health` | `status`, `service`, `version`, `stage`, `uptime_s`, `mode: "simulation"`, `real_traffic: false`, topology summary, `scenarios_available` |
| `GET /topology` | The frozen topology plus `summary` and the validator `validation` report |
| `GET /scenarios` | Scenarios present in this build |
| `POST /sim/run` | Body `{scenario_id, seed?, ips_mode?, controls?}` where `ips_mode` is `monitor` (default) or `enforce` (ignored by S5 and S6, which pin it); `custom_flows` adds up to five extra flows (the Send traffic form; outside `config_hash`, own random streams, the run may outlast the scenario); `controls` is a list of mid-run changes `{type:"ips_mode",t,mode}` or `{type:"detector",t,detector,enabled}` that never change events before `t`; returns `{run_id, scenario_id, seed, ips_mode, duration, config_hash, trace_hash, rules_hash, rules_customised, summary, events}` |
| `POST /sim/validate` | Body `{scenario_ids?}` (omit for all). Runs each scenario in every IPS mode it supports with the rules in force and checks its expected behaviour; returns `{rules_hash, rules_customised, results: [{scenario_id, name, ips_mode, passed, checks: [{id, description, expected, actual, passed}], config_hash, trace_hash, summary}], summary: {runs, runs_passed, checks, checks_passed}}` |
| `GET /rules` | The rules in force: `detectors` (D1 to D6: name, MITRE tag, `settings`, shipped `defaults`, `changed`, numeric `limits`, `editable`), `ips_policy` (allowlist and the detector-to-action table), `restricted_ips`, `policies` (FW1 and ACL rules with ids and the implicit deny), `revision`, `customised`, `rules_hash`, `defaults_hash`, `read_only` and `read_only_reason` (true on a production server, where every edit below answers 403) |
| `PUT /rules/detectors` | Body `{changes: {"D1": {"enabled": false, "suspicious": 8}}}`. All of it is applied or none: invalid input answers 422 with `detail` as a list of messages naming each field. Returns the new rules and `changed` |
| `PUT /rules/restricted-ips` | Body `{addresses: [...]}`: the complete list of outside source addresses FW1 denies (rule `OUTSIDE-IN:10`). IPv4 only, at most 20, not loopback, multicast or inside the campus (10/8) |
| `POST /rules/reset` | Back to the shipped rules |
| `GET /rules/export/cisco` | The firewall and ACL policies in force as Cisco IOS named extended access lists |

Rules live in the running server (reset on restart) and feed every later run; the rule set is part of `config_hash`, so a trace names the rules it ran with, and changing a rule back restores the original hash. `GET /scenarios` also lists `expected` behaviour per IPS mode.

Errors are JSON `{detail}`: 404 unknown scenario (ids must match `S<number>`), 422 invalid request (including an IPS-mode control on a pinned scenario). A server started with `NETSEC_ENV=production` adds: 403 for any rules edit (`PUT /rules/*`, `POST /rules/reset`), answered before the body is examined; 413 for a request body over `NETSEC_MAX_BODY_BYTES` (default 65536); 429 with a `Retry-After` header when a client exceeds its rate limit (`POST /sim/run`, `POST /sim/validate`, other `/api` calls except `/api/health`); and no `/docs`, `/redoc` or `/openapi.json`. Responses over 1 kB are gzip-compressed when the client accepts it. See `docs/DEPLOYMENT_RENDER.md`. `GET /scenarios` also reports `pinned_ips_mode`.

A reject injects a packet whose `flow` is `<original flow>:rst`; no new event type is used.

## Trace events
Frozen in `contracts/events.json` and `backend/netsec/sim/events.py`; mirrored in `frontend/src/protocol/events.js`.
Both are tested against the JSON. Every event has `seq`, `t`, `type`. Events are ordered by (`t`, `seq`).

Statistics definitions (`run.end.stats`) are in `backend/netsec/analysis/stats.py`: only data-plane packets count; mirror
copies are `mirrored`, syslog is `management`; every data packet lands in exactly one of `delivered_clean`,
`delivered_flagged`, `blocked`, `other_drop`.
