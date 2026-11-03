"""Scenario S7: SSH brute force (D2), MEDIUM at the 6th attempt, HIGH at the 12th, block for 30 s."""

from __future__ import annotations

import pytest

from netsec.sim.controls import IpsModeControl
from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import load_scenario

PC2, PC1, ADMIN, APP = "10.0.10.12", "10.0.10.11", "10.0.20.10", "10.0.30.10"
SEEDS = [1, 2, 3, 4, 5]


@pytest.fixture(scope="module")
def monitor(graph):
    return run_scenario(graph, load_scenario("S7"), ips_mode="monitor")


@pytest.fixture(scope="module")
def enforce(graph):
    return run_scenario(graph, load_scenario("S7"), ips_mode="enforce")


def of(result, kind, **match):
    return [e for e in result.events if e["type"] == kind and all(e.get(k) == v for k, v in match.items())]


def created(result):
    return {e["pid"]: e for e in of(result, "packet.created")}


def attempt_syns(result):
    """The brute-forcer's connection attempts, in the order they were sent."""
    return sorted(
        (e for e in created(result).values() if e["src"] == PC2 and e["flags"] == ["SYN"] and e["mirror_of"] is None and e["dport"] == 22),
        key=lambda e: (e["t"], e["pid"]),
    )


def test_the_scenario_is_fourteen_guesses_a_second_apart_plus_two_normal_users() -> None:
    scenario = load_scenario("S7")
    guesses = [f for f in scenario.flows if f.id.startswith("F") and "ssh-guess" in f.id]
    assert len(guesses) == 14 and all((f.src, f.dst, f.dport) == ("PC-2", "APP-SRV", 22) for f in guesses)
    assert [g.start for g in guesses] == [round(1.0 + i, 1) for i in range(14)]
    assert {f.src for f in scenario.flows if "ssh-guess" not in f.id} == {"PC-1", "ADMIN-PC"}


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_each_sensor_alerts_at_exactly_the_sixth_and_twelfth_attempt(request, mode) -> None:
    result = request.getfixturevalue(mode)
    syns = attempt_syns(result)
    assert len(syns) == 14  # every attempt is sent, whatever happens to it
    for sensor in ("IDS-1", "IPS-1"):
        got = [a for a in of(result, "alert.raised") if a["sensor"] == sensor]
        assert [(a["rule"], a["severity"], a["evidence"]["count"], a["evidence"]["threshold"], a["evidence"]["window"]) for a in got] == [
            ("D2", "medium", 6, 6, 30.0),
            ("D2", "high", 12, 12, 30.0),
        ]
        assert all(a["src"] == PC2 and a["dst"] == APP and a["dport"] == 22 for a in got)
    # the packet that makes each sensor classify the flow is the 6th and the 12th SYN
    flagged = [i for i in of(result, "inspect.result", node="IDS-1") if i["rules"] == ["D2"]]
    copies = {e["pid"]: e for e in of(result, "packet.created") if e["mirror_of"] is not None}
    order = [e["pid"] for e in syns]
    assert [order.index(copies[i["pid"]]["mirror_of"]) + 1 for i in flagged[:1]] == [6]
    assert result.stats.alerts == 4 and result.stats.incidents == 1


def test_enforce_blocks_pc_2_for_thirty_seconds_after_the_twelfth_attempt(enforce) -> None:
    (added,) = of(enforce, "block.added")
    assert (added["src"], added["rule"]) == (PC2, "D2") and added["until"] == pytest.approx(added["t"] + 30.0)
    (expired,) = of(enforce, "block.expired")
    assert expired["t"] == added["until"] and expired["t"] < enforce.duration
    high = [a for a in of(enforce, "alert.raised") if a["sensor"] == "IPS-1" and a["severity"] == "high"][0]
    assert added["t"] == high["t"]
    drops = of(enforce, "packet.dropped")
    assert {d["reason"] for d in drops} == {"ips_drop", "blocked_source"} and all(d["node"] == "IPS-1" for d in drops)
    c = created(enforce)
    assert all(c[d["pid"]]["src"] == PC2 for d in drops)
    # the 13th and 14th attempts arrive while the block is on
    later = [e for e in attempt_syns(enforce)[12:]]
    ended = {e["pid"]: e for e in enforce.events if e["type"] in ("packet.delivered", "packet.dropped")}
    assert all(ended[e["pid"]]["type"] == "packet.dropped" and ended[e["pid"]]["reason"] == "blocked_source" for e in later)


def test_monitor_never_blocks_and_every_guess_completes(monitor) -> None:
    assert not of(monitor, "block.added") and not of(monitor, "packet.dropped") and monitor.stats.blocked == 0
    assert {(a["action"], a["applied"]) for a in of(monitor, "ips.action")} == {("block_source", False)}
    delivered_to_app = {e["pid"] for e in of(monitor, "packet.delivered", node="APP-SRV")}
    assert all(e["pid"] in delivered_to_app for e in attempt_syns(monitor))


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_other_users_are_never_affected(request, mode) -> None:
    result = request.getfixturevalue(mode)
    c = created(result)
    ended = {e["pid"]: e for e in result.events if e["type"] in ("packet.delivered", "packet.dropped")}
    others = [pid for pid, p in c.items() if p["mirror_of"] is None and PC2 not in (p["src"], p["dst"])]
    assert len(others) == 16 and {ended[pid]["type"] for pid in others} == {"packet.delivered"}  # PC-1 HTTPS and the admin's SSH login
    assert not [a for a in of(result, "alert.raised") if a["src"] in (PC1, ADMIN)]  # one login is not brute force


def test_d1_and_d3_stay_quiet_because_it_is_one_port_at_one_attempt_a_second(monitor, enforce) -> None:
    for result in (monitor, enforce):
        assert {a["rule"] for a in of(result, "alert.raised")} == {"D2"}


def test_ids_1_stays_passive(enforce, monitor) -> None:
    for result in (monitor, enforce):
        copies = {pid for pid, p in created(result).items() if p["mirror_of"] is not None}
        for e in result.events:
            if e["type"] in ("packet.dropped", "ips.action", "block.added", "policy.decision"):
                assert e.get("node") != "IDS-1" and e.get("pid") not in copies


@pytest.mark.parametrize("seed", SEEDS)
def test_same_outcome_for_every_seed_and_prefix_stable_when_switching_mode(graph, seed) -> None:
    base = run_scenario(graph, load_scenario("S7"), seed=seed, ips_mode="monitor")
    assert (base.stats.alerts, base.stats.incidents, base.stats.blocked) == (4, 1, 0)
    enforce = run_scenario(graph, load_scenario("S7"), seed=seed, ips_mode="enforce")
    assert (enforce.stats.alerts, enforce.stats.incidents, enforce.stats.blocked) == (4, 1, 18)
    live = run_scenario(graph, load_scenario("S7"), seed=seed, ips_mode="monitor", controls=[IpsModeControl(type="ips_mode", t=10.0, mode="enforce")])
    assert [e for e in live.events if e["t"] < 10.0] == [e for e in base.events if e["t"] < 10.0]
    assert live.stats.blocked > 0
