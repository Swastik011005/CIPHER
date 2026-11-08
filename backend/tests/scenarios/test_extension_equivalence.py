"""The campus extension must not change what the original scenarios do.

Adding 14 devices and 14 links to the topology changes ``config_hash`` (the topology is part of it) and so every trace hash.
It must not change a single event: the recorded golden traces (made on the original 17-node topology) and today's runs must be
identical apart from the two identifiers inside ``run.meta`` that are derived from that hash.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import load_scenario

FIXTURES = Path(__file__).resolve().parents[3] / "frontend" / "src" / "playback" / "fixtures"

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


def _without_hash_fields(events: list[dict]) -> list[dict]:
    first = {k: v for k, v in events[0].items() if k not in ("run_id", "config_hash")}
    return [first, *events[1:]]


@pytest.mark.parametrize("fixture,scenario_id,mode", RUNS)
def test_original_scenario_events_are_identical_to_the_golden_trace(graph, fixture, scenario_id, mode) -> None:
    golden = json.loads((FIXTURES / f"{fixture}.json").read_text(encoding="utf-8"))
    result = run_scenario(graph, load_scenario(scenario_id), ips_mode=mode)
    assert len(result.events) == len(golden["events"])
    assert _without_hash_fields(result.events) == _without_hash_fields(golden["events"])
    assert result.stats.model_dump() == golden["summary"]["stats"] if "stats" in golden.get("summary", {}) else True
