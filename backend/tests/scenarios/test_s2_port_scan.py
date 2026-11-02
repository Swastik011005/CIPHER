"""Scenario S2: port scan with IDS detection, in IPS Monitor and Enforce modes."""

from __future__ import annotations

from collections import Counter

import pytest

from netsec.analysis.stats import compute_stats
from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import load_scenario

SCANNER = "10.0.10.12"  # PC-2
LEGIT = "10.0.10.11"  # PC-1


@pytest.fixture(scope="module")
def s2():
    return load_scenario("S2")


@pytest.fixture(scope="module")
def monitor(graph, s2):
    return run_scenario(graph, s2, ips_mode="monitor")


@pytest.fixture(scope="module")
def enforce(graph, s2):
    return run_scenario(graph, s2, ips_mode="enforce")


def of(result, kind):
    return [e for e in result.events if e["type"] == kind]


def alerts(result, sensor):
    return [e for e in of(result, "alert.raised") if e["sensor"] == sensor]


def created(result):
    return {e["pid"]: e for e in of(result, "packet.created")}


# -- detection ------------------------------------------------------------------------------


@pytest.mark.parametrize("sensor", ["IDS-1", "IPS-1"])
def test_each_sensor_alerts_at_exactly_six_and_twelve_ports(monitor, sensor) -> None:
    got = alerts(monitor, sensor)
    assert [(a["severity"], a["evidence"]["count"], a["evidence"]["threshold"]) for a in got] == [
        ("medium", 6, 6),
        ("high", 12, 12),
    ]
    assert all(a["rule"] == "D1" and a["src"] == SCANNER and a["dst"] == "10.0.30.10" for a in got)


def test_the_two_sensors_raise_separate_alerts_for_one_incident(monitor) -> None:
    every = of(monitor, "alert.raised")
    assert len(every) == 4 and len({a["alert_id"] for a in every}) == 4
    assert {a["incident_id"] for a in every} == {"INC-0001"}
    assert monitor.stats.alerts == 4 and monitor.stats.incidents == 1


def test_the_ids_sees_the_scan_before_the_ips_does(monitor) -> None:
    ids_first = alerts(monitor, "IDS-1")[0]["t"]
    ips_first = alerts(monitor, "IPS-1")[0]["t"]
    assert ids_first < ips_first  # the SPAN copy is short; the original still has to cross the IPS arch


def test_normal_traffic_is_not_flagged(monitor) -> None:
    legit = {pid for pid, e in created(monitor).items() if e["src"] == LEGIT or e["dst"] == LEGIT}
    flagged = {e["pid"] for e in of(monitor, "inspect.result") if e["classification"] != "normal"}
    assert legit and not (legit & flagged)


# -- IDS is passive -------------------------------------------------------------------------


@pytest.mark.parametrize("fixture", ["monitor", "enforce"])
def test_ids_never_acts_on_traffic(request, fixture) -> None:
    result = request.getfixturevalue(fixture)
    for e in result.events:
        if e["type"] == "packet.dropped":
            assert e["node"] != "IDS-1"
        assert e["type"] not in ("ips.action", "block.added") or e.get("node") != "IDS-1"
    # Everything IDS-1 emits is an inspection, an alert (sensor IDS-1) or the arrival of a copy.
    at_ids = [e for e in result.events if e.get("node") == "IDS-1"]
    assert {e["type"] for e in at_ids} == {"inspect.result", "packet.delivered"}
    # ...and only mirror copies ever reach it.
    copies = {pid for pid, e in created(result).items() if e["mirror_of"] is not None}
    assert {e["pid"] for e in at_ids} <= copies


def test_the_ids_view_is_the_same_in_both_modes(monitor, enforce) -> None:
    """The IDS observes mirror copies taken before the IPS, so the IPS mode cannot change what it sees."""
    def ids_alerts(r):
        return [(a["t"], a["severity"], a["evidence"]["count"]) for a in alerts(r, "IDS-1")]

    assert ids_alerts(monitor) == ids_alerts(enforce)


def test_the_original_packet_is_never_flagged_by_the_ids(monitor) -> None:
    by_pid = created(monitor)
    for e in of(monitor, "inspect.result"):
        if e["node"] == "IDS-1":
            assert by_pid[e["pid"]]["mirror_of"] is not None  # IDS verdicts attach to copies only


# -- IPS Monitor ----------------------------------------------------------------------------


def test_monitor_mode_drops_nothing_and_blocks_nothing(monitor) -> None:
    assert not of(monitor, "packet.dropped")
    assert not of(monitor, "block.added") and not of(monitor, "block.expired")
    assert monitor.stats.blocked == 0 and monitor.stats.other_drop == 0


def test_monitor_mode_records_would_block_decisions(monitor) -> None:
    actions = of(monitor, "ips.action")
    assert actions and all(a["mode"] == "monitor" and a["applied"] is False for a in actions)
    assert {a["action"] for a in actions} == {"block_source"}


def test_monitor_mode_delivers_every_probe_and_flags_the_late_ones(monitor) -> None:
    probes = {pid for pid, e in created(monitor).items() if e["flow"] == "F2-scan" and e["flags"] == ["SYN"] and e["mirror_of"] is None}
    assert len(probes) == 30
    delivered = {e["pid"] for e in of(monitor, "packet.delivered")}
    assert probes <= delivered
    assert monitor.stats.delivered_flagged > 0
    assert monitor.stats.data_packets == monitor.stats.delivered_clean + monitor.stats.delivered_flagged


# -- IPS Enforce ----------------------------------------------------------------------------


def test_enforce_blocks_the_source_for_twenty_seconds(enforce) -> None:
    (block,) = of(enforce, "block.added")
    ips_high = [a for a in alerts(enforce, "IPS-1") if a["severity"] == "high"][0]
    assert block["src"] == SCANNER and block["rule"] == "D1" and block["incident_id"] == "INC-0001"
    assert block["until"] == pytest.approx(ips_high["t"] + 20.0)
    (expired,) = of(enforce, "block.expired")
    assert expired["src"] == SCANNER and expired["t"] == pytest.approx(block["until"])


def test_enforce_drops_one_packet_by_detection_then_the_rest_by_block(enforce) -> None:
    reasons = Counter(e["reason"] for e in of(enforce, "packet.dropped"))
    assert reasons["ips_drop"] == 1
    assert reasons["blocked_source"] >= 19
    assert set(reasons) == {"ips_drop", "blocked_source"}
    assert all(e["node"] == "IPS-1" for e in of(enforce, "packet.dropped"))


def test_every_pc2_packet_reaching_the_ips_during_the_block_is_dropped(enforce) -> None:
    block = of(enforce, "block.added")[0]
    by_pid = created(enforce)
    arrivals = [
        e for e in of(enforce, "packet.hop")
        if e["to"] == "IPS-1" and by_pid[e["pid"]]["src"] == SCANNER and by_pid[e["pid"]]["mirror_of"] is None
    ]
    dropped = {e["pid"] for e in of(enforce, "packet.dropped")}
    during = [e for e in arrivals if block["t"] <= e["t_arrive"] < block["until"]]
    assert during and all(e["pid"] in dropped for e in during)  # 100%
    after = [e for e in arrivals if e["t_arrive"] >= block["until"]]
    assert after and not any(e["pid"] in dropped for e in after)


def test_legitimate_traffic_still_passes(enforce) -> None:
    by_pid = created(enforce)
    delivered = {e["pid"] for e in of(enforce, "packet.delivered")}
    pc1 = [pid for pid, e in by_pid.items() if e["flow"] == "F1-https" and e["mirror_of"] is None]
    assert len(pc1) == 8 and all(pid in delivered for pid in pc1)  # PC-1's whole session completes


def test_the_blocked_host_can_connect_again_once_the_block_expires(enforce) -> None:
    by_pid = created(enforce)
    delivered = {e["pid"] for e in of(enforce, "packet.delivered")}
    dropped = {e["pid"]: e["reason"] for e in of(enforce, "packet.dropped")}
    during = [pid for pid, e in by_pid.items() if e["flow"] == "F3-retry-during-block" and e["mirror_of"] is None]
    after = [pid for pid, e in by_pid.items() if e["flow"] == "F4-retry-after-block" and e["mirror_of"] is None]
    assert len(during) == 1 and dropped[during[0]] == "blocked_source"  # the SYN dies at the IPS
    assert len(after) == 8 and all(pid in delivered for pid in after)  # the new session completes


def test_enforce_ips_actions_are_applied(enforce) -> None:
    actions = of(enforce, "ips.action")
    assert actions and all(a["mode"] == "enforce" and a["applied"] is True for a in actions)


def test_firewall_decisions_do_not_depend_on_the_ips_mode(monitor, enforce) -> None:
    def decisions(r):
        return [(e["node"], e["rule_id"], e["action"]) for e in of(r, "policy.decision") if e["rule_id"].startswith("STAFF-IN")]

    assert set(decisions(monitor)) == set(decisions(enforce)) == {("CORE-SW1", "STAFF-IN:100", "permit")}


# -- statistics, determinism ----------------------------------------------------------------


@pytest.mark.parametrize("fixture", ["monitor", "enforce"])
def test_run_end_statistics_match_the_trace_and_buckets_add_up(request, fixture) -> None:
    result = request.getfixturevalue(fixture)
    s = compute_stats(result.events[:-1])
    assert s == result.stats
    assert s.data_packets == s.delivered_clean + s.delivered_flagged + s.blocked + s.other_drop


def test_enforce_blocks_what_monitor_only_flags(monitor, enforce) -> None:
    assert enforce.stats.blocked > 0 and monitor.stats.blocked == 0
    assert enforce.stats.data_packets < monitor.stats.data_packets  # blocked probes never get answered


def test_same_seed_and_mode_give_an_identical_trace(graph, s2, enforce) -> None:
    again = run_scenario(graph, s2, ips_mode="enforce")
    assert again.trace_hash == enforce.trace_hash and again.events == enforce.events


def test_monitor_and_enforce_traces_are_identical_until_the_first_ips_action(monitor, enforce) -> None:
    def prefix(result):
        body = result.events[1:]  # run.meta differs (mode, config hash)
        cut = next(i for i, e in enumerate(body) if e["type"] == "ips.action")
        return body[:cut]

    a, b = prefix(monitor), prefix(enforce)
    assert len(a) > 100 and a == b
    # The very next event is the same decision, recorded in one mode and applied in the other.
    first = lambda r: next(e for e in r.events if e["type"] == "ips.action")
    assert first(monitor)["pid"] == first(enforce)["pid"]
    assert (first(monitor)["applied"], first(enforce)["applied"]) == (False, True)


def test_a_different_seed_changes_ports_but_not_the_verdicts(graph, s2) -> None:
    other = run_scenario(graph, s2, seed=7, ips_mode="enforce")
    assert [(a["severity"], a["evidence"]["count"]) for a in alerts(other, "IDS-1")] == [("medium", 6), ("high", 12)]
    assert len(of(other, "block.added")) == 1
