"""Stage 4 must not change what S1 and S2 do.

Adding D4 to D6 changes the detector configuration, so ``config_hash`` and ``run_id`` in ``run.meta``
(and with them the whole-trace hash) changed on purpose. Everything else in each trace must be
byte-for-byte what Stage 3 produced: the body hashes below were taken from the Stage 3 golden fixtures.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from netsec.sim.engine import run_scenario
from netsec.sim.trace import canonical_json
from netsec.traffic.scenarios import load_scenario

GOLDEN = json.loads((Path(__file__).parent.parent / "fixtures" / "stage3_bodies.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_s1_and_s2_traces_are_unchanged_apart_from_run_meta(graph, name) -> None:
    g = GOLDEN[name]
    result = run_scenario(graph, load_scenario(g["scenario"]), ips_mode=g["mode"])
    body = [e for e in result.events if e["type"] != "run.meta"]
    assert len(result.events) == g["events"]
    assert hashlib.sha256(canonical_json(body).encode()).hexdigest() == g["body_sha256"]
    assert result.trace_hash != g["stage3_trace_hash"]  # only run.meta (config hash) differs, by design


def test_the_new_detectors_stay_silent_on_the_stage_3_scenarios(graph) -> None:
    for sid in ("S1", "S2"):
        result = run_scenario(graph, load_scenario(sid), ips_mode="enforce")
        assert {e["rule"] for e in result.events if e["type"] == "alert.raised"} <= {"D1"}
