"""Export deterministic engine traces as fixtures for the frontend tests.

Run from the repository root with the backend virtual environment:

    backend\\.venv\\Scripts\\python scripts\\export_golden_traces.py

The frontend tests replay these files, so they check the player against real engine output
instead of hand-written events. Re-run after any change that alters a trace.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from netsec.network.topology import load_topology  # noqa: E402
from netsec.sim.engine import run_scenario  # noqa: E402
from pydantic import TypeAdapter  # noqa: E402

from netsec.traffic.scenarios import FlowSpec, ScenarioSpec, load_scenario  # noqa: E402

OUT = ROOT / "frontend" / "src" / "playback" / "fixtures"

RUNS = [
    ("s1-monitor", "S1", "monitor"),
    ("s2-monitor", "S2", "monitor"),
    ("s2-enforce", "S2", "enforce"),
    ("s3-monitor", "S3", "monitor"),
    ("s3-enforce", "S3", "enforce"),
    ("s4-monitor", "S4", "monitor"),
    ("s4-enforce", "S4", "enforce"),
    ("s7-enforce", "S7", "enforce"),
]


def one_session(scenario_id: str, src: str, dst: str, dport: int) -> ScenarioSpec:
    """A single TCP attempt, used only as a test fixture for the firewall and ACL effects.
    These are not product scenarios; the frozen scenario files are untouched."""
    return ScenarioSpec.model_validate(
        {
            "id": scenario_id,
            "name": "effect fixture",
            "description": "single TCP session",
            "duration": 8.0,
            "default_seed": 1,
            "flows": [{"type": "tcp_session", "id": "F", "src": src, "dst": dst, "dport": dport, "start": 0.5, "request_bytes": 100}],
        }
    )


# Traces that exercise the firewall ripple and the ACL flash, which S1 and S2 never trigger.
FIXTURE_RUNS = [
    ("fw-deny", one_session("X1", "EXT-ATK", "DB-SRV", 3306), "monitor"),
    ("acl-deny", one_session("X2", "PC-1", "DB-SRV", 3306), "monitor"),
]  # S3 covers both of these in the product; the single-attempt fixtures stay for the effect tests


# The Send traffic case from Rev 3: PC-1 to the database on 3306, injected into S1 at T+5 s.
CUSTOM_RUNS = [
    (
        "custom-staff-db",
        "S1",
        "monitor",
        [{"type": "tcp_session", "id": "X1", "src": "PC-1", "dst": "DB-SRV", "dport": 3306, "start": 5.0, "request_bytes": 100}],
    ),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    graph = load_topology()
    flows = TypeAdapter(FlowSpec)
    runs = [(name, load_scenario(scenario_id), mode, []) for name, scenario_id, mode in RUNS]
    runs += [(name, spec, mode, []) for name, spec, mode in FIXTURE_RUNS]
    runs += [(name, load_scenario(sid), mode, [flows.validate_python(f) for f in custom]) for name, sid, mode, custom in CUSTOM_RUNS]
    for name, spec, mode, custom in runs:
        result = run_scenario(graph, spec, ips_mode=mode, custom_flows=custom)
        body = {
            "run_id": result.run_id,
            "scenario_id": result.scenario_id,
            "seed": result.seed,
            "ips_mode": result.ips_mode,
            "duration": result.duration,
            "trace_hash": result.trace_hash,
            "summary": result.stats.model_dump(),
            "events": result.events,
        }
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
        print(f"{path.name}: {len(result.events)} events, {path.stat().st_size // 1024} KB, hash {result.trace_hash[:12]}")


if __name__ == "__main__":
    main()
