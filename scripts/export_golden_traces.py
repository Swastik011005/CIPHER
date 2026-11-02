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
from netsec.traffic.scenarios import load_scenario  # noqa: E402

OUT = ROOT / "frontend" / "src" / "playback" / "fixtures"

RUNS = [("s1-monitor", "S1", "monitor"), ("s2-monitor", "S2", "monitor"), ("s2-enforce", "S2", "enforce")]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    graph = load_topology()
    for name, scenario_id, mode in RUNS:
        result = run_scenario(graph, load_scenario(scenario_id), ips_mode=mode)
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
