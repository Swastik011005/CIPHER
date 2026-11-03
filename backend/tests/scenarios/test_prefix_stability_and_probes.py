"""Mid-run controls leave the past untouched (prefix stability); D6 flag probes through the engine."""

from __future__ import annotations

import pytest

from netsec.sim.controls import DetectorControl, IpsModeControl
from netsec.sim.engine import EngineError, run_scenario
from netsec.traffic.scenarios import ScenarioSpec, load_scenario

SEEDS = [1, 2, 3, 4, 5]


def of(result, kind):
    return [e for e in result.events if e["type"] == kind]


def before(result, t):
    return [e for e in result.events if e["t"] < t]


# -- prefix stability ----------------------------------------------------------------------------------


@pytest.mark.parametrize("seed", SEEDS)
@pytest.mark.parametrize(("sid", "start_mode", "to_mode"), [("S2", "monitor", "enforce"), ("S2", "enforce", "monitor"), ("S3", "monitor", "enforce")])
@pytest.mark.parametrize("t", [1.0, 4.9, 10.0, 19.5])
def test_switching_the_ips_mode_never_changes_anything_before_the_switch(graph, sid, start_mode, to_mode, t, seed) -> None:
    base = run_scenario(graph, load_scenario(sid), seed=seed, ips_mode=start_mode)
    switched = run_scenario(graph, load_scenario(sid), seed=seed, ips_mode=start_mode, controls=[IpsModeControl(type="ips_mode", t=t, mode=to_mode)])
    assert before(switched, t) == before(base, t)  # includes run.meta: the run's identity is not rewritten
    assert switched.events[-1]["t"] == base.events[-1]["t"]


def test_switching_to_enforce_at_one_second_makes_the_block_appear_from_then_on(graph) -> None:
    base = run_scenario(graph, load_scenario("S2"), ips_mode="monitor")
    live = run_scenario(graph, load_scenario("S2"), ips_mode="monitor", controls=[IpsModeControl(type="ips_mode", t=1.0, mode="enforce")])
    assert before(live, 1.0) == before(base, 1.0)
    assert not of(base, "block.added") and len(of(live, "block.added")) == 1
    assert [e["mode"] for e in of(live, "ips.action")] == ["enforce"] * len(of(live, "ips.action"))
    assert live.stats.blocked == 24 and live.trace_hash != base.trace_hash
    # Starting in Monitor and switching early gives the same enforcement as running in Enforce from the start.
    enforce = run_scenario(graph, load_scenario("S2"), ips_mode="enforce")
    assert [e for e in live.events if e["type"] != "run.meta"] == [e for e in enforce.events if e["type"] != "run.meta"]


def test_switching_to_monitor_lifts_the_block_and_nothing_is_dropped_afterwards(graph) -> None:
    live = run_scenario(graph, load_scenario("S2"), ips_mode="enforce", controls=[IpsModeControl(type="ips_mode", t=10.0, mode="monitor")])
    (expired,) = of(live, "block.expired")
    assert expired["t"] == 10.0 and expired["src"] == "10.0.10.12"  # lifted at the switch, once (the timer at 24.9 s finds nothing)
    late_drops = [e for e in of(live, "packet.dropped") if e["t"] > 10.0]
    assert late_drops == []
    assert [a["mode"] for a in of(live, "ips.action") if a["t"] > 10.0] == [a["mode"] for a in of(live, "ips.action") if a["t"] > 10.0]  # recorded, not applied
    assert all(a["applied"] is False for a in of(live, "ips.action") if a["t"] > 10.0)


@pytest.mark.parametrize("seed", SEEDS)
def test_disabling_a_detector_mid_run_stops_new_alerts_but_keeps_history(graph, seed) -> None:
    base = run_scenario(graph, load_scenario("S2"), seed=seed, ips_mode="monitor")
    off = run_scenario(graph, load_scenario("S2"), seed=seed, ips_mode="monitor", controls=[DetectorControl(type="detector", t=4.0, detector="D1", enabled=False)])
    assert before(off, 4.0) == before(base, 4.0)
    assert [a["severity"] for a in of(off, "alert.raised")] == ["medium", "medium"]  # the MEDIUMs before 4.0 s; no HIGH ever
    assert not of(off, "ips.action")
    reenabled = run_scenario(
        graph, load_scenario("S2"), seed=seed, ips_mode="monitor",
        controls=[DetectorControl(type="detector", t=4.0, detector="D1", enabled=False), DetectorControl(type="detector", t=4.5, detector="D1", enabled=True)],
    )
    assert before(reenabled, 4.0) == before(base, 4.0)
    assert any(a["severity"] == "high" for a in of(reenabled, "alert.raised"))  # history was kept, so it escalates again


def test_a_detector_disabled_from_the_start_of_s3_produces_no_alert_for_that_rule(graph) -> None:
    off = run_scenario(graph, load_scenario("S3"), ips_mode="enforce", controls=[DetectorControl(type="detector", t=0.0, detector="D4", enabled=False)])
    assert {a["rule"] for a in of(off, "alert.raised")} == {"D5"}
    assert not of(off, "ips.action") and off.stats.blocked == 3  # without D4, IPS-1 no longer rejects (d): it goes through
    assert off.stats.delivered_clean > 0


def test_no_controls_changes_nothing(graph) -> None:
    a = run_scenario(graph, load_scenario("S2"), ips_mode="enforce")
    b = run_scenario(graph, load_scenario("S2"), ips_mode="enforce", controls=[])
    assert a.trace_hash == b.trace_hash and a.config_hash == b.config_hash


def test_a_scenario_that_pins_its_ips_mode_refuses_a_mode_switch(graph) -> None:
    with pytest.raises(EngineError, match="pins the IPS mode"):
        run_scenario(graph, load_scenario("S6"), controls=[IpsModeControl(type="ips_mode", t=5.0, mode="monitor")])
    # ...but other controls are fine
    run_scenario(graph, load_scenario("S6"), controls=[DetectorControl(type="detector", t=5.0, detector="D1", enabled=False)])


# -- D6 through the engine -----------------------------------------------------------------------------


def probe(flags, count=2, src="PC-1", dst="APP-SRV", dport=443) -> ScenarioSpec:
    return ScenarioSpec.model_validate(
        {
            "id": "S9", "name": "probe", "description": "flag probe", "duration": 20.0, "default_seed": 1,
            "flows": [{"type": "flag_probe", "id": "P", "src": src, "dst": dst, "dport": dport, "flags": flags, "start": 1.0, "count": count, "interval": 1.0}],
        }
    )


@pytest.mark.parametrize("flags", [[], ["FIN", "PSH", "URG"], ["SYN", "FIN"], ["SYN", "RST"]])
def test_d6_in_enforce_mode_ids_alerts_and_ips_drops_each_invalid_packet(graph, flags) -> None:
    result = run_scenario(graph, probe(flags), ips_mode="enforce")
    assert [(a["sensor"], a["rule"], a["severity"]) for a in of(result, "alert.raised")] == [("IDS-1", "D6", "high"), ("IPS-1", "D6", "high")]
    actions = of(result, "ips.action")
    assert [(a["action"], a["applied"]) for a in actions] == [("drop", True)] * 2
    drops = of(result, "packet.dropped")
    assert [(d["node"], d["reason"]) for d in drops] == [("IPS-1", "ips_drop")] * 2
    assert result.stats.blocked == 2 and result.stats.incidents == 1  # both packets are one incident
    assert not of(result, "block.added")  # drop does not block the source


def test_d6_in_monitor_mode_nothing_is_dropped_and_the_packets_are_flagged(graph) -> None:
    result = run_scenario(graph, probe(["SYN", "FIN"]), ips_mode="monitor")
    assert not of(result, "packet.dropped") or all(d["reason"] not in ("ips_drop", "ips_reject") for d in of(result, "packet.dropped"))
    assert all(a["applied"] is False for a in of(result, "ips.action"))
    assert result.stats.delivered_flagged >= 2 and result.stats.alerts == 2


def test_d6_never_fires_for_a_normal_session_or_a_valid_probe(graph) -> None:
    assert run_scenario(graph, probe(["SYN"], count=3), ips_mode="enforce").stats.alerts == 0
    assert run_scenario(graph, probe(["ACK"], count=3), ips_mode="enforce").stats.alerts == 0


def test_an_invalid_flag_probe_to_a_published_port_passes_the_firewall_and_is_caught_by_the_sensors(graph) -> None:
    """FW1 judges by address and port only, so a NULL probe to published HTTPS gets through it: that is what D6 is for."""
    result = run_scenario(graph, probe([], src="EXT-ATK", dport=443), ips_mode="enforce")
    assert [d["rule_id"] for d in of(result, "policy.decision")] == ["OUTSIDE-IN:20"] * 2
    assert {a["sensor"] for a in of(result, "alert.raised")} == {"IDS-1", "IPS-1"}
    assert {d["node"] for d in of(result, "packet.dropped")} == {"IPS-1"}


def test_a_probe_to_an_unpublished_port_is_stopped_by_the_firewall_before_any_sensor(graph) -> None:
    result = run_scenario(graph, probe([], src="EXT-ATK", dport=3306, dst="DB-SRV"), ips_mode="enforce")
    assert {d["node"] for d in of(result, "packet.dropped")} == {"FW1"}
    assert not of(result, "alert.raised") and not of(result, "packet.mirrored")
