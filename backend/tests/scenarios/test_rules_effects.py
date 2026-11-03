"""Edited rules change later simulations, deterministically, and nothing else: disabled rules stop their alerts,
thresholds move the alert, restricted addresses are denied by FW1, hashes follow the rules, and the guarantees
(IDS passive, detectors before enforcement, prefix stability, pinned scenarios) still hold under edited rules."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter

from netsec.security.ruleset import RuleStore
from netsec.sim.controls import IpsModeControl
from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import FlowSpec, load_scenario

SEEDS = [1, 2, 3, 4, 5]
FLOW = TypeAdapter(FlowSpec)


def rules_with(**detectors):
    store = RuleStore()
    if detectors:
        store.update_detectors(detectors)
    return store.current


def of(result, kind, **match):
    return [e for e in result.events if e["type"] == kind and all(e.get(k) == v for k, v in match.items())]


def alerts(result, rule=None, sensor=None):
    return [a for a in of(result, "alert.raised") if (rule is None or a["rule"] == rule) and (sensor is None or a["sensor"] == sensor)]


@pytest.fixture(scope="module")
def default_runs(graph):
    cache = {}

    def get(sid, mode):
        if (sid, mode) not in cache:
            cache[(sid, mode)] = run_scenario(graph, load_scenario(sid), ips_mode=mode)
        return cache[(sid, mode)]

    return get


# -- each detector switched off stops exactly its alerts ---------------------------------------------------------


@pytest.mark.parametrize(
    ("detector", "scenario", "rules_left"),
    [
        ("D1", "S2", set()),
        ("D1", "S6", set()),
        ("D2", "S7", set()),
        ("D3", "S4", set()),
        ("D4", "S3", {"D5"}),
        ("D5", "S3", {"D4"}),
    ],
)
@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_a_disabled_detector_raises_no_alert_and_the_ips_never_acts_on_it(graph, default_runs, detector, scenario, rules_left, mode) -> None:
    assert alerts(default_runs(scenario, mode), detector), "the scenario does exercise this detector"
    off = run_scenario(graph, load_scenario(scenario), ips_mode=mode, rules=rules_with(**{detector: {"enabled": False}}))
    assert alerts(off, detector) == []  # no alert from either sensor
    assert {a["rule"] for a in alerts(off)} == rules_left  # and the other detectors are untouched
    if detector != "D4" and detector != "D5":
        assert off.stats.blocked == 0 and not of(off, "ips.action") and not of(off, "block.added")  # nothing for IPS-1 to act on


def test_disabling_d1_removes_every_d1_alert_from_s2_and_the_scan_goes_through(graph) -> None:
    off = run_scenario(graph, load_scenario("S2"), ips_mode="enforce", rules=rules_with(D1={"enabled": False}))
    assert alerts(off) == [] and off.stats.alerts == 0 and off.stats.incidents == 0
    assert off.stats.blocked == 0 and off.stats.delivered_clean == off.stats.data_packets  # all 62 packets are served
    assert not of(off, "packet.dropped")


def test_d4_off_means_ips_1_no_longer_rejects_the_admin_connection_but_the_acl_and_firewall_still_deny(graph) -> None:
    off = run_scenario(graph, load_scenario("S3"), ips_mode="enforce", rules=rules_with(D4={"enabled": False}))
    assert {d["reason"] for d in of(off, "packet.dropped")} == {"acl_deny", "fw_deny"}  # static policy is independent of detection
    assert off.stats.blocked == 3 and not any(p["flow"].endswith(":rst") for p in of(off, "packet.created"))
    assert off.stats.delivered_clean > 0  # the admin's session completes


def test_d6_off_lets_invalid_flags_through_and_a_narrower_signature_list_catches_only_those(graph) -> None:
    def probe(flags):
        return FLOW.validate_python({"type": "flag_probe", "id": "X1", "src": "PC-1", "dst": "APP-SRV", "dport": 443, "flags": flags, "start": 2.0, "count": 2, "interval": 1.0})

    def run(rules, flags):
        return run_scenario(graph, load_scenario("S1"), ips_mode="enforce", custom_flows=[probe(flags)], rules=rules)

    assert alerts(run(None, [])) and alerts(run(rules_with(), ["SYN", "FIN"]))  # on by default
    assert alerts(run(rules_with(D6={"enabled": False}), [])) == []
    only_null = rules_with(D6={"signatures": ["null"]})
    assert alerts(run(only_null, []), "D6") and alerts(run(only_null, ["SYN", "FIN"]), "D6") == []
    no_drop = run(rules_with(D6={"enabled": False}), [])
    assert not [d for d in of(no_drop, "packet.dropped") if d["reason"] == "ips_drop"]


def test_d2_ports_can_be_narrowed_so_ssh_is_no_longer_watched(graph) -> None:
    assert alerts(run_scenario(graph, load_scenario("S7"), rules=rules_with(D2={"ports": [22, 2222]})), "D2")
    assert alerts(run_scenario(graph, load_scenario("S7"), rules=rules_with(D2={"ports": [3389]}))) == []


# -- thresholds move the alert ----------------------------------------------------------------------------------


def test_lower_d1_thresholds_alert_at_the_new_ports_and_block_sooner(graph, default_runs) -> None:
    base = default_runs("S2", "enforce")
    tight = run_scenario(graph, load_scenario("S2"), ips_mode="enforce", rules=rules_with(D1={"suspicious": 4, "violation": 8}))
    assert [a["evidence"]["count"] for a in alerts(tight, "D1", "IDS-1")] == [4, 8]
    assert [a["evidence"]["threshold"] for a in alerts(tight, "D1", "IDS-1")] == [4, 8]
    assert of(tight, "block.added")[0]["t"] < of(base, "block.added")[0]["t"]
    assert tight.stats.blocked > base.stats.blocked  # more of the scan is stopped


def test_higher_d1_thresholds_can_let_the_whole_scan_pass_unnoticed(graph) -> None:
    lax = run_scenario(graph, load_scenario("S2"), ips_mode="enforce", rules=rules_with(D1={"suspicious": 40, "violation": 50}))
    assert alerts(lax) == [] and lax.stats.blocked == 0  # 30 ports never reach 40


def test_d3_thresholds_decide_whether_a_flood_is_limited_blocked_or_ignored(graph, default_runs) -> None:
    base = default_runs("S4", "enforce")
    medium_only = run_scenario(graph, load_scenario("S4"), ips_mode="enforce", rules=rules_with(D3={"suspicious_pps": 25, "violation_pps": 200}))
    assert [a["severity"] for a in alerts(medium_only, "D3", "IPS-1")] == ["medium"]
    assert of(medium_only, "block.added") == [] and any(d["reason"] == "rate_limited" for d in of(medium_only, "packet.dropped"))
    ignored = run_scenario(graph, load_scenario("S4"), ips_mode="enforce", rules=rules_with(D3={"suspicious_pps": 150, "violation_pps": 300}))
    assert alerts(ignored) == [] and ignored.stats.blocked == 0
    assert [a["severity"] for a in alerts(base, "D3", "IPS-1")] == ["medium", "high"]


def test_a_longer_d1_suppression_window_does_not_change_the_first_alerts(graph) -> None:
    quiet = run_scenario(graph, load_scenario("S2"), rules=rules_with(D1={"suppression_s": 120}))
    assert [a["severity"] for a in alerts(quiet, "D1", "IDS-1")] == ["medium", "high"]


# -- restricted addresses -----------------------------------------------------------------------------------------


def custom(src, dst="APP-SRV", dport=443, start=2.0):
    return FLOW.validate_python({"type": "tcp_session", "id": "X1", "src": src, "dst": dst, "dport": dport, "start": start, "request_bytes": 100})


def test_a_restricted_address_is_denied_by_fw1_with_rule_10_and_no_sensor_sees_it(graph) -> None:
    store = RuleStore()
    free = run_scenario(graph, load_scenario("S1"), custom_flows=[custom("EXT-USR")], rules=store.current)
    assert free.stats.blocked == 0 and not of(free, "policy.decision", node="FW1", action="deny")  # allowed by default
    store.set_restricted_ips(["203.0.113.25"])
    denied = run_scenario(graph, load_scenario("S1"), custom_flows=[custom("EXT-USR")], rules=store.current)
    (decision,) = [d for d in of(denied, "policy.decision", node="FW1") if d["action"] == "deny"]
    assert (decision["policy"], decision["rule_id"]) == ("OUTSIDE-IN", "OUTSIDE-IN:10")
    (drop,) = of(denied, "packet.dropped")
    assert (drop["node"], drop["reason"]) == ("FW1", "fw_deny") and denied.stats.blocked == 1
    assert not of(denied, "packet.mirrored", pid=drop["pid"]) and not alerts(denied)  # it never reached a sensor


def test_restricting_the_attacker_stops_the_s4_flood_at_the_firewall_before_any_detector(graph) -> None:
    store = RuleStore()
    store.set_restricted_ips(["203.0.113.66", "203.0.113.99"])
    result = run_scenario(graph, load_scenario("S4"), ips_mode="enforce", rules=store.current)
    assert alerts(result) == [] and not of(result, "ips.action") and not of(result, "block.added")
    assert {d["node"] for d in of(result, "packet.dropped")} == {"FW1"}
    created = {e["pid"]: e for e in of(result, "packet.created")}
    ends = {e["pid"]: e for e in result.events if e["type"] in ("packet.delivered", "packet.dropped")}
    user = [pid for pid, p in created.items() if p["mirror_of"] is None and "203.0.113.25" in (p["src"], p["dst"])]
    assert user and all(ends[pid]["type"] == "packet.delivered" for pid in user)  # the ordinary user is untouched


def test_removing_the_default_restricted_address_changes_nothing_for_hosts_that_never_used_it(graph, default_runs) -> None:
    store = RuleStore()
    store.set_restricted_ips([])
    result = run_scenario(graph, load_scenario("S2"), ips_mode="enforce", rules=store.current)
    base = default_runs("S2", "enforce")
    assert [e for e in result.events if e["type"] != "run.meta"] == [e for e in base.events if e["type"] != "run.meta"]
    assert result.config_hash != base.config_hash  # but the rules are different, so the trace says so


# -- hashes and metadata ----------------------------------------------------------------------------------------


def test_the_shipped_rules_are_byte_identical_to_running_without_a_rule_set(graph, default_runs) -> None:
    explicit = run_scenario(graph, load_scenario("S2"), ips_mode="enforce", rules=RuleStore().current)
    assert explicit.trace_hash == default_runs("S2", "enforce").trace_hash


def test_a_rule_change_changes_config_hash_and_run_meta_and_changing_it_back_restores_them(graph, default_runs) -> None:
    base = default_runs("S2", "monitor")
    store = RuleStore()
    store.update_detectors({"D1": {"suspicious": 7}})
    edited = run_scenario(graph, load_scenario("S2"), rules=store.current)
    assert edited.config_hash != base.config_hash and edited.run_id != base.run_id
    meta = of(edited, "run.meta")[0]
    assert meta["config_hash"] == edited.config_hash and meta["run_id"] == edited.run_id  # the trace names the rules it ran with
    store.update_detectors({"D1": {"suspicious": 6}})
    back = run_scenario(graph, load_scenario("S2"), rules=store.current)
    assert back.config_hash == base.config_hash and back.trace_hash == base.trace_hash


@pytest.mark.parametrize("seed", SEEDS)
def test_the_same_edited_rules_give_the_same_trace_every_time(graph, seed) -> None:
    rules = rules_with(D1={"suspicious": 5, "violation": 9}, D3={"suspicious_pps": 30})
    a = run_scenario(graph, load_scenario("S2"), seed=seed, ips_mode="enforce", rules=rules)
    b = run_scenario(graph, load_scenario("S2"), seed=seed, ips_mode="enforce", rules=rules)
    assert a.trace_hash == b.trace_hash and a.events == b.events


# -- the guarantees still hold under edited rules ---------------------------------------------------------------


EDITED = {"D1": {"suspicious": 4, "violation": 8}, "D3": {"suspicious_pps": 20, "violation_pps": 40}, "D2": {"suspicious": 4, "violation": 8}}


@pytest.mark.parametrize("sid", ["S2", "S3", "S4", "S7"])
@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_ids_1_stays_passive_and_every_packet_has_one_outcome_under_edited_rules(graph, sid, mode) -> None:
    result = run_scenario(graph, load_scenario(sid), ips_mode=mode, rules=rules_with(**EDITED))
    copies = {e["pid"] for e in of(result, "packet.created") if e["mirror_of"] is not None}
    for e in result.events:
        if e["type"] in ("packet.dropped", "ips.action", "block.added", "block.expired", "policy.decision"):
            assert e.get("node") != "IDS-1" and e.get("pid") not in copies
    s = result.stats
    assert s.data_packets == s.delivered_clean + s.delivered_flagged + s.blocked + s.other_drop


def test_detectors_still_run_before_enforcement_so_the_limiter_cannot_hide_a_flood_under_edited_thresholds(graph) -> None:
    result = run_scenario(graph, load_scenario("S4"), ips_mode="enforce", rules=rules_with(D3={"suspicious_pps": 20, "violation_pps": 60}))
    first_limit = min(a["t"] for a in of(result, "ips.action") if a["action"] == "rate_limit")
    high = [a for a in alerts(result, "D3", "IPS-1") if a["severity"] == "high"]
    assert high and high[0]["t"] > first_limit


@pytest.mark.parametrize("seed", [1, 3])
@pytest.mark.parametrize("t", [5.0, 10.0])
def test_controls_stay_prefix_stable_under_edited_rules(graph, seed, t) -> None:
    rules = rules_with(**EDITED)
    base = run_scenario(graph, load_scenario("S2"), seed=seed, ips_mode="monitor", rules=rules)
    live = run_scenario(graph, load_scenario("S2"), seed=seed, ips_mode="monitor", rules=rules, controls=[IpsModeControl(type="ips_mode", t=t, mode="enforce")])
    assert [e for e in live.events if e["t"] < t] == [e for e in base.events if e["t"] < t]
    assert live.config_hash == base.config_hash


def test_custom_traffic_stays_prefix_stable_under_edited_rules(graph) -> None:
    rules = rules_with(**EDITED)
    base = run_scenario(graph, load_scenario("S1"), rules=rules)
    live = run_scenario(graph, load_scenario("S1"), rules=rules, custom_flows=[custom("PC-1", "DB-SRV", 3306, 6.0)])
    assert [e for e in live.events if e["t"] < 6.0] == [e for e in base.events if e["t"] < 6.0]


def test_pinned_scenarios_stay_pinned_whatever_the_rules_say(graph) -> None:
    rules = rules_with(D1={"suspicious": 4, "violation": 8})
    assert run_scenario(graph, load_scenario("S5"), ips_mode="enforce", rules=rules).ips_mode == "monitor"
    s6 = run_scenario(graph, load_scenario("S6"), ips_mode="monitor", rules=rules)
    assert s6.ips_mode == "enforce" and of(s6, "block.added")


def test_the_token_bucket_still_limits_to_about_ten_packets_a_second_under_edited_thresholds(graph) -> None:
    result = run_scenario(graph, load_scenario("S4"), ips_mode="enforce", rules=rules_with(D3={"suspicious_pps": 20, "violation_pps": 900}))
    limited = of(result, "ips.action")
    assert limited and all(a["action"] == "rate_limit" for a in limited)  # never escalates to a block at 900 pps
    created = {e["pid"]: e for e in of(result, "packet.created")}
    first = min(a["t"] for a in limited)
    passed = [i for i in of(result, "inspect.result") if i["node"] == "IPS-1" and i["t"] >= first and created[i["pid"]]["src"] == "203.0.113.66" and created[i["pid"]]["mirror_of"] is None]
    drops = {d["pid"] for d in of(result, "packet.dropped")}
    through = [i for i in passed if i["pid"] not in drops]
    assert len(through) <= 20 + 10 * (max(i["t"] for i in passed) - first) + 2
