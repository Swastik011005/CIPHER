"""Scenario S4: a SYN flood that ramps 15 -> 40 -> 70 packets per second; D3, rate limiting and a block."""

from __future__ import annotations

import pytest

from netsec.sim.controls import DetectorControl, IpsModeControl
from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import load_scenario

ATK, USER, APP = "203.0.113.66", "203.0.113.25", "10.0.30.10"
SEEDS = [1, 2, 3, 4, 5]


@pytest.fixture(scope="module")
def monitor(graph):
    return run_scenario(graph, load_scenario("S4"), ips_mode="monitor")


@pytest.fixture(scope="module")
def enforce(graph):
    return run_scenario(graph, load_scenario("S4"), ips_mode="enforce")


def of(result, kind, **match):
    return [e for e in result.events if e["type"] == kind and all(e.get(k) == v for k, v in match.items())]


def created(result):
    return {e["pid"]: e for e in of(result, "packet.created")}


def ends(result):
    return {e["pid"]: e for e in result.events if e["type"] in ("packet.delivered", "packet.dropped")}


def alerts(result, sensor=None, severity=None):
    return [a for a in of(result, "alert.raised") if (sensor is None or a["sensor"] == sensor) and (severity is None or a["severity"] == severity)]


# -- the traffic ----------------------------------------------------------------------------------------


def test_the_flood_ramps_from_15_to_40_to_70_packets_per_second(graph) -> None:
    scenario = load_scenario("S4")
    flood = next(f for f in scenario.flows if f.type == "syn_flood")
    assert [(p.rate, p.duration) for p in flood.phases] == [(15, 3), (40, 4), (70, 4)]
    assert (flood.src, flood.dst, flood.dport) == ("EXT-ATK", "APP-SRV", 443)  # a published port: FW1 permits it
    result = run_scenario(graph, scenario, ips_mode="monitor")
    sent = [e for e in created(result).values() if e["flow"] == "F2-flood" and e["mirror_of"] is None and e["src"] == "203.0.113.66"]
    syns = sorted(e["t"] for e in sent)
    assert len(syns) == 45 + 160 + 280
    rate = lambda a, b: sum(1 for t in syns if a <= t < b) / (b - a)  # noqa: E731
    assert rate(3, 6) == pytest.approx(15, abs=0.5) and rate(6, 10) == pytest.approx(40, abs=0.5) and rate(10, 14) == pytest.approx(70, abs=0.5)
    assert all(e["flags"] == ["SYN"] for e in sent)
    ports = [e["sport"] for e in sent]
    assert len(set(ports)) == len(ports)  # every probe has its own source port


def test_the_firewall_permits_the_flood_because_it_is_aimed_at_a_published_port(enforce) -> None:
    decisions = [d for d in of(enforce, "policy.decision") if d["node"] == "FW1"]
    assert decisions and {d["rule_id"] for d in decisions if d["action"] == "deny"} == set()
    assert {d["rule_id"] for d in decisions} <= {"OUTSIDE-IN:20", "OUTSIDE-IN:conntrack", "INSIDE-OUT:conntrack"}


# -- detection --------------------------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_both_sensors_detect_the_flood_medium_then_high_as_one_incident(request, mode) -> None:
    result = request.getfixturevalue(mode)
    for sensor in ("IDS-1", "IPS-1"):
        got = alerts(result, sensor)
        assert [(a["rule"], a["severity"], a["src"], a["dst"]) for a in got] == [("D3", "medium", ATK, APP), ("D3", "high", ATK, APP)]
        assert [(a["evidence"]["window"], a["evidence"]["threshold"]) for a in got] == [(5.0, 125), (5.0, 250)]
        assert got[0]["evidence"]["count"] > 125 and got[1]["evidence"]["count"] > 250
    assert {a["incident_id"] for a in alerts(result)} == {"INC-0001"}
    assert result.stats.alerts == 4 and result.stats.incidents == 1
    assert not [a for a in alerts(result) if a["src"] == USER]  # the ordinary user never raises anything


def test_medium_comes_while_the_rate_is_40_and_high_after_it_reaches_70(enforce) -> None:
    medium, high = alerts(enforce, "IDS-1", "medium")[0], alerts(enforce, "IDS-1", "high")[0]
    assert 8.0 < medium["t"] < 11.0 < high["t"] < 15.0  # packets reach the sensors a few seconds after they are sent
    assert alerts(enforce, "IPS-1", "medium")[0]["t"] > medium["t"] and alerts(enforce, "IPS-1", "high")[0]["t"] > high["t"]  # SPAN is ahead of the IPS


# -- Enforce: rate limit, then block ----------------------------------------------------------------------


def test_enforce_rate_limits_first_and_only_then_blocks_the_source(enforce) -> None:
    actions = of(enforce, "ips.action")
    limits = [a for a in actions if a["action"] == "rate_limit"]
    blocks = [a for a in actions if a["action"] == "block_source"]
    assert limits and blocks and all(a["applied"] and a["mode"] == "enforce" and a["rule"] == "D3" for a in actions)
    (added,) = of(enforce, "block.added")
    assert max(a["t"] for a in limits) <= added["t"] <= min(a["t"] for a in blocks)  # limiting ends where the block begins
    assert added["src"] == ATK and added["rule"] == "D3" and added["until"] == pytest.approx(added["t"] + 20.0)
    (expired,) = of(enforce, "block.expired")
    assert expired["t"] == added["until"] and expired["src"] == ATK


def test_the_rate_limit_lets_about_ten_packets_a_second_through(enforce) -> None:
    first = min(a["t"] for a in of(enforce, "ips.action") if a["action"] == "rate_limit")
    (added,) = of(enforce, "block.added")
    c, e = created(enforce), ends(enforce)
    inspected = [i for i in of(enforce, "inspect.result", node="IPS-1") if first <= i["t"] <= added["t"] and c[i["pid"]]["src"] == ATK and c[i["pid"]]["mirror_of"] is None]
    limited = [i for i in inspected if e[i["pid"]]["type"] == "packet.dropped" and e[i["pid"]]["reason"] == "rate_limited"]
    passed = [i for i in inspected if e[i["pid"]]["type"] == "packet.delivered"]
    span = added["t"] - first
    assert len(limited) > 3 * len(passed) > 0  # most of the flood is dropped
    assert len(passed) <= 20 + 10 * span + 2  # a burst of 20, then 10 per second


def test_every_limited_or_blocked_packet_is_dropped_at_ips_1_and_is_the_attackers(enforce) -> None:
    c = created(enforce)
    drops = of(enforce, "packet.dropped")
    assert {d["reason"] for d in drops} == {"rate_limited", "ips_drop", "blocked_source"}
    assert all(d["node"] == "IPS-1" and c[d["pid"]]["src"] == ATK for d in drops)
    assert enforce.stats.blocked == len(drops) and enforce.stats.other_drop == 0


def test_detection_runs_before_enforcement_so_the_limiter_cannot_hide_the_flood(enforce) -> None:
    first_limit = min(a["t"] for a in of(enforce, "ips.action") if a["action"] == "rate_limit")
    high = alerts(enforce, "IPS-1", "high")[0]
    assert high["t"] > first_limit  # HIGH was reached while packets were already being dropped
    assert high["evidence"]["count"] > 250  # on the true arrival rate, not on what the limiter let through


def test_the_attacker_is_blocked_for_twenty_seconds_then_gets_through_again(enforce) -> None:
    c, e = created(enforce), ends(enforce)
    (added,), (expired,) = of(enforce, "block.added"), of(enforce, "block.expired")
    during = next(p for p in c.values() if p["flow"] == "F4-attacker-during-block")
    after = next(p for p in c.values() if p["flow"] == "F6-attacker-after-block")
    assert added["t"] < during["t"] < expired["t"] < after["t"]
    assert (e[during["pid"]]["type"], e[during["pid"]]["reason"]) == ("packet.dropped", "blocked_source")
    flow = [p["pid"] for p in c.values() if p["flow"] == "F6-attacker-after-block" and p["mirror_of"] is None]
    assert any(e[pid]["type"] == "packet.delivered" and e[pid]["node"] == "APP-SRV" for pid in flow)


# -- no collateral damage ---------------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_the_ordinary_user_is_one_hundred_percent_delivered(request, mode) -> None:
    result = request.getfixturevalue(mode)
    c, e = created(result), ends(result)
    user = [pid for pid, p in c.items() if p["mirror_of"] is None and USER in (p["src"], p["dst"])]
    assert len(user) == 24  # three full HTTPS sessions of eight packets, both directions
    assert {e[pid]["type"] for pid in user} == {"packet.delivered"}
    flows = {c[pid]["flow"] for pid in user}
    assert flows == {"F1-user-before", "F3-user-during", "F5-user-during-block"}
    assert not [x for x in of(result, "ips.action") if c[x["pid"]]["src"] == USER]


# -- Monitor ----------------------------------------------------------------------------------------------


def test_monitor_records_what_it_would_do_and_drops_nothing(monitor) -> None:
    assert not of(monitor, "packet.dropped") and not of(monitor, "block.added") and monitor.stats.blocked == 0
    actions = of(monitor, "ips.action")
    assert {(a["action"], a["applied"], a["mode"]) for a in actions} == {("rate_limit", False, "monitor"), ("block_source", False, "monitor")}
    assert monitor.stats.delivered_flagged > 100  # flagged, then delivered anyway


def test_monitor_and_enforce_are_identical_until_ips_1_first_acts(monitor, enforce) -> None:
    first = min(a["t"] for a in of(enforce, "ips.action"))
    body = lambda r: [e for e in r.events if e["type"] != "run.meta" and e["t"] < first]  # noqa: E731
    assert body(monitor) == body(enforce)


# -- the IDS stays passive -------------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_ids_1_never_limits_drops_or_blocks(request, mode) -> None:
    result = request.getfixturevalue(mode)
    copies = {pid for pid, p in created(result).items() if p["mirror_of"] is not None}
    assert len(copies) == result.stats.mirrored
    for e in result.events:
        if e["type"] in ("packet.dropped", "ips.action", "block.added", "block.expired", "policy.decision"):
            assert e.get("node") != "IDS-1" and e.get("pid") not in copies
    assert {e["node"] for e in of(result, "packet.dropped")} <= {"IPS-1"}


# -- seeds and prefix stability --------------------------------------------------------------------------


@pytest.mark.parametrize("seed", SEEDS)
def test_the_outcome_is_the_same_for_every_seed(graph, seed) -> None:
    result = run_scenario(graph, load_scenario("S4"), seed=seed, ips_mode="enforce")
    assert (result.stats.alerts, result.stats.incidents) == (4, 1)
    assert len(of(result, "block.added")) == 1
    assert result.stats.blocked == 305  # the same packets are limited or blocked whatever the ports are


@pytest.mark.parametrize("seed", [1, 3])
@pytest.mark.parametrize("t", [5.0, 9.0, 12.0, 20.0])
def test_switching_the_ips_mode_mid_flood_never_changes_the_past(graph, seed, t) -> None:
    for start, to in (("monitor", "enforce"), ("enforce", "monitor")):
        base = run_scenario(graph, load_scenario("S4"), seed=seed, ips_mode=start)
        live = run_scenario(graph, load_scenario("S4"), seed=seed, ips_mode=start, controls=[IpsModeControl(type="ips_mode", t=t, mode=to)])
        assert [e for e in live.events if e["t"] < t] == [e for e in base.events if e["t"] < t]


def test_switching_to_monitor_mid_block_lifts_it_and_stops_the_drops(graph) -> None:
    live = run_scenario(graph, load_scenario("S4"), ips_mode="enforce", controls=[IpsModeControl(type="ips_mode", t=16.0, mode="monitor")])
    (expired,) = of(live, "block.expired")
    assert expired["t"] == 16.0
    assert not [d for d in of(live, "packet.dropped") if d["t"] > 16.0]


def test_disabling_d3_mid_run_stops_new_flood_alerts_and_the_enforcement_that_followed_them(graph) -> None:
    off = run_scenario(graph, load_scenario("S4"), ips_mode="enforce", controls=[DetectorControl(type="detector", t=0.0, detector="D3", enabled=False)])
    assert not of(off, "alert.raised") and not of(off, "ips.action") and not of(off, "packet.dropped")
    assert off.stats.delivered_clean == off.stats.data_packets  # with no detector the flood is simply served
