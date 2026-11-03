"""Custom traffic (the Send traffic form): extra flows injected into a run, prefix-stable and policy-checked."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter

from netsec.sim.engine import EngineError, run_scenario
from netsec.traffic.scenarios import FlowSpec, load_scenario

SEEDS = [1, 2, 3, 4, 5]
FLOW = TypeAdapter(FlowSpec)


def flow(**kw) -> FlowSpec:
    base = {"type": "tcp_session", "id": "X1", "src": "PC-1", "dst": "DB-SRV", "dport": 3306, "start": 5.0, "request_bytes": 100}
    base.update(kw)
    return FLOW.validate_python(base)


def of(result, kind, **match):
    return [e for e in result.events if e["type"] == kind and all(e.get(k) == v for k, v in match.items())]


def before(result, t):
    return [e for e in result.events if e["t"] < t]


# -- the headline case: PC-1 to DB:3306 ---------------------------------------------------------------


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_staff_to_database_shows_the_acl_denial_the_ids_alert_the_path_and_the_rule_id(graph, mode) -> None:
    result = run_scenario(graph, load_scenario("S1"), ips_mode=mode, custom_flows=[flow()])
    syn = next(e for e in of(result, "packet.created") if e["flow"] == "X1" and e["mirror_of"] is None)
    assert (syn["src"], syn["dst"], syn["dport"], syn["flags"]) == ("10.0.10.11", "10.0.30.20", 3306, ["SYN"])
    hops = of(result, "packet.hop", pid=syn["pid"])
    assert [h["from"] for h in hops] + [hops[-1]["to"]] == ["PC-1", "ACC-SW2", "CORE-SW1"]  # stops at the core
    assert [(h["vlan"], h["ttl"]) for h in hops] == [(10, 64), (10, 64)]
    (decision,) = of(result, "policy.decision", pid=syn["pid"])
    assert (decision["node"], decision["policy"], decision["rule_id"], decision["action"]) == ("CORE-SW1", "STAFF-IN", "STAFF-IN:10", "deny")
    (dropped,) = of(result, "packet.dropped", pid=syn["pid"])
    assert (dropped["node"], dropped["reason"]) == ("CORE-SW1", "acl_deny")
    (mirror,) = of(result, "packet.mirrored", pid=syn["pid"])
    assert mirror["to"] == "IDS-1"
    (alert,) = [a for a in of(result, "alert.raised") if a["src"] == "10.0.10.11"]
    assert (alert["sensor"], alert["rule"], alert["severity"], alert["dst"], alert["dport"]) == ("IDS-1", "D4", "high", "10.0.30.20", 3306)
    assert alert["t"] > mirror["t"]  # the copy still has to cross the SPAN link to IDS-1
    assert not [e for e in of(result, "alert.raised") if e["sensor"] == "IPS-1"]  # the packet never reached IPS-1
    assert result.stats.blocked == 1 and result.stats.incidents == 1


# -- prefix stability ----------------------------------------------------------------------------------


@pytest.mark.parametrize("seed", SEEDS)
@pytest.mark.parametrize("sid", ["S1", "S2", "S3"])
def test_injecting_traffic_never_changes_anything_before_its_start(graph, sid, seed) -> None:
    base = run_scenario(graph, load_scenario(sid), seed=seed, ips_mode="enforce")
    for start in (1.0, 7.3, 12.0):
        live = run_scenario(graph, load_scenario(sid), seed=seed, ips_mode="enforce", custom_flows=[flow(start=start)])
        assert before(live, start) == before(base, start), (sid, seed, start)  # includes run.meta: identity is not rewritten
        assert live.config_hash == base.config_hash and live.trace_hash != base.trace_hash


def test_custom_flows_draw_from_their_own_random_stream(graph) -> None:
    a = run_scenario(graph, load_scenario("S1"), custom_flows=[flow(id="X1")])
    b = run_scenario(graph, load_scenario("S1"), custom_flows=[flow(id="X2")])
    ports = lambda r: next(e["sport"] for e in of(r, "packet.created") if e["flow"].startswith("X") and e["mirror_of"] is None)  # noqa: E731
    assert ports(a) != ports(b)  # different id, different ports...
    again = run_scenario(graph, load_scenario("S1"), custom_flows=[flow(id="X1")])
    assert again.trace_hash == a.trace_hash  # ...and the same request always gives the same trace


def test_the_scenarios_own_traffic_after_the_injection_is_still_delivered(graph) -> None:
    base = run_scenario(graph, load_scenario("S1"))
    live = run_scenario(graph, load_scenario("S1"), custom_flows=[flow(start=2.0)])
    assert live.stats.delivered_clean >= base.stats.delivered_clean
    assert live.stats.blocked == 1 and live.stats.data_packets == base.stats.data_packets + 1


# -- other kinds of custom traffic ---------------------------------------------------------------------


def test_a_custom_ping_is_answered_and_raises_nothing(graph) -> None:
    ping = FLOW.validate_python({"type": "icmp_echo", "id": "X1", "src": "PC-1", "dst": "APP-SRV", "start": 2.0, "count": 3, "interval": 1.0})
    result = run_scenario(graph, load_scenario("S1"), custom_flows=[ping])
    sent = [e for e in of(result, "packet.created") if e["flow"] == "X1" and e["mirror_of"] is None]
    assert len(sent) == 6  # three requests and three replies
    assert result.stats.alerts == 0 and result.stats.blocked == 0


def test_a_custom_null_flag_probe_is_caught_by_d6_and_dropped_by_ips_1_in_enforce(graph) -> None:
    probe = FLOW.validate_python({"type": "flag_probe", "id": "X1", "src": "PC-1", "dst": "APP-SRV", "dport": 443, "flags": [], "start": 2.0, "count": 2, "interval": 1.0})
    enforce = run_scenario(graph, load_scenario("S1"), ips_mode="enforce", custom_flows=[probe])
    assert {(a["sensor"], a["rule"]) for a in of(enforce, "alert.raised")} == {("IDS-1", "D6"), ("IPS-1", "D6")}
    assert [(d["node"], d["reason"]) for d in of(enforce, "packet.dropped")] == [("IPS-1", "ips_drop")] * 2
    monitor = run_scenario(graph, load_scenario("S1"), ips_mode="monitor", custom_flows=[probe])
    assert not [d for d in of(monitor, "packet.dropped") if d["node"] == "IPS-1"]


def test_traffic_from_the_outside_to_the_database_is_stopped_by_the_firewall_not_the_acl(graph) -> None:
    result = run_scenario(graph, load_scenario("S1"), custom_flows=[flow(src="EXT-ATK")])
    (decision,) = of(result, "policy.decision", node="FW1")
    assert decision["rule_id"] == "OUTSIDE-IN:implicit-deny"
    assert not [a for a in of(result, "alert.raised")]  # FW1 is ahead of the SPAN point: no sensor sees it


# -- the run may outlast the scenario ------------------------------------------------------------------


def test_a_session_started_near_the_end_extends_the_run_instead_of_failing(graph) -> None:
    base = run_scenario(graph, load_scenario("S1"))
    live = run_scenario(graph, load_scenario("S1"), custom_flows=[flow(src="ADMIN-PC", dst="APP-SRV", dport=22, start=base.duration - 1.0)])
    assert live.duration > base.duration
    assert live.events[-1]["type"] == "run.end" and live.events[-1]["t"] == live.duration
    assert max(e["t"] for e in live.events) == live.duration
    assert of(live, "run.meta")[0]["duration"] == base.duration  # the declared duration is not rewritten (prefix stable)
    assert live.stats.delivered_clean > base.stats.delivered_clean


def test_without_custom_traffic_an_overrunning_scenario_is_still_an_error(graph) -> None:
    scenario = load_scenario("S1").model_copy(update={"duration": 5.0})
    with pytest.raises(EngineError, match="declares duration"):
        run_scenario(graph, scenario)


# -- refusals ------------------------------------------------------------------------------------------


def test_bad_custom_flows_are_refused(graph) -> None:
    with pytest.raises(EngineError, match="already used"):
        run_scenario(graph, load_scenario("S1"), custom_flows=[flow(id="F1-https")])
    with pytest.raises(EngineError, match="same source and destination"):
        run_scenario(graph, load_scenario("S1"), custom_flows=[flow(src="PC-1", dst="PC-1")])
    with pytest.raises(EngineError, match="not a host"):
        run_scenario(graph, load_scenario("S1"), custom_flows=[flow(src="IPS-1")])
    with pytest.raises(EngineError, match="already used"):
        run_scenario(graph, load_scenario("S1"), custom_flows=[flow(id="X1"), flow(id="X1", start=6.0)])
