# API and event contracts

Base: `http://127.0.0.1:8000/api` (the Vite dev server proxies `/api`). Interactive docs at `/docs`.

| Method and path | Purpose |
|---|---|
| `GET /health` | `status`, `service`, `version`, `stage`, `uptime_s`, `mode: "simulation"`, `real_traffic: false`, topology summary, `scenarios_available` |
| `GET /topology` | The frozen topology plus `summary` and the validator `validation` report |
| `GET /scenarios` | Scenarios present in this build |
| `POST /sim/run` | Body `{scenario_id, seed?, ips_mode?, controls?}` where `ips_mode` is `monitor` (default) or `enforce` (ignored by S5 and S6, which pin it); `controls` is a list of mid-run changes `{type:"ips_mode",t,mode}` or `{type:"detector",t,detector,enabled}` that never change events before `t`; returns `{run_id, scenario_id, seed, ips_mode, duration, config_hash, trace_hash, summary, events}` |

Errors are JSON `{detail}`: 404 unknown scenario (ids must match `S<number>`), 422 invalid request (including an IPS-mode control on a pinned scenario). `GET /scenarios` also reports `pinned_ips_mode`.

A reject injects a packet whose `flow` is `<original flow>:rst`; no new event type is used.

## Trace events
Frozen in `contracts/events.json` and `backend/netsec/sim/events.py`; mirrored in `frontend/src/protocol/events.js`.
Both are tested against the JSON. Every event has `seq`, `t`, `type`. Events are ordered by (`t`, `seq`).

Statistics definitions (`run.end.stats`) are in `backend/netsec/analysis/stats.py`: only data-plane packets count; mirror
copies are `mirrored`, syslog is `management`; every data packet lands in exactly one of `delivered_clean`,
`delivered_flagged`, `blocked`, `other_drop`.
