"""Core scenarios S1, S2, S3, S5 and S6 across five seeds: determinism, ordering, dispositions,
statistics, alert correlation and the IDS/IPS separation, plus S5/S6 equivalence with S2."""

from __future__ import annotations

from collections import Counter

import pytest

from netsec.analysis.stats import compute_stats
from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import list_scenarios, load_scenario

SEEDS = [1, 2, 3, 4, 5]
CORE = ["S1", "S2", "S3", "S5", "S6"]

# scenario -> mode -> (alerts, incidents, blocked, data packets blocked by IPS-1)
EXPECTED = {
    ("S1", "monitor"): (0, 0, 0),
    ("S1", "enforce"): (0, 0, 0),
    ("S2", "monitor"): (4, 1, 0),
    ("S2", "enforce"): (4, 1, 24),
    ("S3", "monitor"): (4, 3, 3),
    ("S3", "enforce"): (4, 3, 4),
    ("S5", "monitor"): (4, 1, 0),
    ("S5", "enforce"): (4, 1, 0),  # pinned: the requested mode is ignored
    ("S6", "monitor"): (4, 1, 24),  # pinned to Enforce
    ("S6", "enforce"): (4, 1, 24),
}
CASES = [(sid, mode, seed) for (sid, mode) in EXPECTED for seed in SEEDS]


@pytest.fixture(scope="module")
def runs(graph):
    cache: dict = {}

    def get(sid, mode, seed):
        key = (sid, mode, seed)
        if key not in cache:
            cache[key] = run_scenario(graph, load_scenario(sid), seed=seed, ips_mode=mode)
        return cache[key]

    return get


def of(result, kind):
    return [e for e in result.events if e["type"] == kind]


@pytest.mark.parametrize(("sid", "mode", "seed"), CASES)
def test_run_is_deterministic_ordered_and_consistent(runs, graph, sid, mode, seed) -> None:
    result = runs(sid, mode, seed)
    again = run_scenario(graph, load_scenario(sid), seed=seed, ips_mode=mode)
    assert again.trace_hash == result.trace_hash and again.events == result.events  # same seed, same trace

    events = result.events
    assert [e["seq"] for e in events] == list(range(len(events)))  # contiguous, in emission order
    assert all(a["t"] <= b["t"] for a, b in zip(events, events[1:]))  # ordered by (t, seq)
    assert events[0]["type"] == "run.meta" and events[-1]["type"] == "run.end"
    assert events[-1]["t"] == result.duration and max(e["t"] for e in events) == result.duration

    stats = compute_stats(events[:-1])
    assert stats == result.stats and events[-1]["stats"] == stats.model_dump()  # run.end carries the same counters


@pytest.mark.parametrize(("sid", "mode", "seed"), CASES)
def test_every_data_packet_has_exactly_one_disposition_and_every_copy_ends_at_ids_1(runs, sid, mode, seed) -> None:
    result = runs(sid, mode, seed)
    created = {e["pid"]: e for e in of(result, "packet.created")}
    ends = Counter(e["pid"] for e in result.events if e["type"] in ("packet.delivered", "packet.dropped"))
    assert set(ends) == set(created) and set(ends.values()) == {1}
    s = result.stats
    assert s.data_packets == s.delivered_clean + s.delivered_flagged + s.blocked + s.other_drop
    assert s.data_packets == sum(1 for e in created.values() if e["mirror_of"] is None)
    assert s.mirrored == sum(1 for e in created.values() if e["mirror_of"] is not None)
    for e in of(result, "packet.delivered"):
        if created[e["pid"]]["mirror_of"] is not None:
            assert e["node"] == "IDS-1"


@pytest.mark.parametrize(("sid", "mode", "seed"), CASES)
def test_expected_alerts_incidents_and_blocked_counts_hold_for_every_seed(runs, sid, mode, seed) -> None:
    alerts, incidents, blocked = EXPECTED[(sid, mode)]
    s = runs(sid, mode, seed).stats
    assert (s.alerts, s.incidents, s.blocked) == (alerts, incidents, blocked)


@pytest.mark.parametrize(("sid", "mode", "seed"), CASES)
def test_alerts_correlate_by_rule_source_and_target(runs, sid, mode, seed) -> None:
    result = runs(sid, mode, seed)
    alerts = of(result, "alert.raised")
    assert len({a["alert_id"] for a in alerts}) == len(alerts)
    incident_of: dict = {}
    for a in alerts:
        incident_of.setdefault((a["rule"], a["src"], a["dst"]), set()).add(a["incident_id"])
    assert all(len(v) == 1 for v in incident_of.values())  # one incident per (rule, src, dst), across both sensors
    assert len({next(iter(v)) for v in incident_of.values()}) == len(incident_of)  # and distinct keys differ
    assert {a["sensor"] for a in alerts} <= {"IDS-1", "IPS-1"}
    for key, ids in incident_of.items():
        sensors = {a["sensor"] for a in alerts if (a["rule"], a["src"], a["dst"]) == key}
        assert "IDS-1" in sensors  # the passive sensor sees everything that reaches IPS-1 too (SPAN is ahead of it)


@pytest.mark.parametrize(("sid", "mode", "seed"), CASES)
def test_nothing_ids_1_does_ever_causes_a_drop_or_an_enforcement_event(runs, sid, mode, seed) -> None:
    result = runs(sid, mode, seed)
    copies = {e["pid"] for e in of(result, "packet.created") if e["mirror_of"] is not None}
    for e in result.events:
        if e["type"] in ("packet.dropped", "policy.decision", "ips.action", "block.added", "block.expired"):
            assert e.get("node") != "IDS-1" and e.get("pid") not in copies, e
        if e["type"] == "inspect.result" and e["node"] == "IDS-1":
            assert e["pid"] in copies  # IDS-1 only ever inspects SPAN copies
    # every enforcement event is IPS-1's, FW1's or CORE-SW1's
    assert {e["node"] for e in of(result, "packet.dropped")} <= {"IPS-1", "FW1", "CORE-SW1"}
    assert all(e["node"] in ("IPS-1", "IDS-1") for e in of(result, "inspect.result"))
    assert not [e for e in of(result, "packet.delivered") if e["pid"] in copies and e["node"] != "IDS-1"]


@pytest.mark.parametrize("sid", ["S1", "S2", "S3"])
def test_different_seeds_change_the_trace_but_not_what_happens(runs, sid) -> None:
    hashes = {runs(sid, "enforce", seed).trace_hash for seed in SEEDS}
    assert len(hashes) == len(SEEDS)
    shapes = {
        tuple((e["type"], e.get("rule"), e.get("reason"), e.get("action")) for e in runs(sid, "enforce", seed).events if e["type"] not in ("run.meta", "packet.created"))
        for seed in SEEDS
    }
    assert len(shapes) == 1  # seeds only change ports and sequence numbers


# -- S5 and S6 -----------------------------------------------------------------------------------------


def body(result):
    """Everything in a trace except the run's own identity (id, scenario and config hash live in run.meta)."""
    return [e for e in result.events if e["type"] != "run.meta"]


@pytest.mark.parametrize("seed", SEEDS)
def test_s5_and_s6_are_the_s2_traffic_with_the_ips_mode_pinned(runs, seed) -> None:
    assert body(runs("S5", "enforce", seed)) == body(runs("S2", "monitor", seed))
    assert body(runs("S6", "monitor", seed)) == body(runs("S2", "enforce", seed))
    assert runs("S5", "enforce", seed).ips_mode == "monitor" and runs("S6", "monitor", seed).ips_mode == "enforce"
    assert of(runs("S5", "enforce", seed), "run.meta")[0]["ips_mode"] == "monitor"


def test_s5_and_s6_use_the_same_flows_and_seed_as_s2() -> None:
    s2, s5, s6 = (load_scenario(i) for i in ("S2", "S5", "S6"))
    assert s5.flows == s2.flows and s6.flows == s2.flows
    assert s5.default_seed == s2.default_seed == s6.default_seed and s5.duration == s2.duration == s6.duration
    assert (s2.pinned_ips_mode, s5.pinned_ips_mode, s6.pinned_ips_mode) == (None, "monitor", "enforce")


@pytest.mark.parametrize("seed", SEEDS)
def test_s5_and_s6_are_identical_until_the_high_alert_then_s6_blocks(runs, seed) -> None:
    s5, s6 = runs("S5", "monitor", seed), runs("S6", "enforce", seed)
    high = next(a for a in of(s6, "alert.raised") if a["severity"] == "high")
    before = lambda r: [e for e in body(r) if e["t"] < high["t"]]  # noqa: E731
    assert before(s5) == before(s6)
    assert not of(s5, "block.added") and not of(s5, "block.expired")
    (added,) = of(s6, "block.added")
    high_ips = next(a for a in of(s6, "alert.raised") if a["severity"] == "high" and a["sensor"] == "IPS-1")
    assert added["t"] == high_ips["t"] > high["t"]  # IDS-1 alerts first (the SPAN copy is ahead of the IPS); IPS-1 then blocks
    assert added["src"] == "10.0.10.12" and added["until"] == pytest.approx(added["t"] + 20.0)
    assert not [e for e in of(s5, "packet.dropped")]
    assert {e["reason"] for e in of(s6, "packet.dropped")} == {"ips_drop", "blocked_source"}
    assert all(e["node"] == "IPS-1" for e in of(s6, "packet.dropped"))


def test_all_core_scenarios_are_listed_by_the_engine() -> None:
    assert [s.id for s in list_scenarios()] == CORE
