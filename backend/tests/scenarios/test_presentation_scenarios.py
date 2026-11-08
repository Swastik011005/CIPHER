"""The nine presentation scenarios (P1 to P9): outcome, events, SIEM sources and repeatability."""

from __future__ import annotations

from collections import Counter

import pytest

from netsec.security.state import EMPTY_SNAPSHOT, SecuritySnapshot
from netsec.sim.engine import EngineError, run_scenario
from netsec.sim.controls import EndpointControl
from netsec.traffic.scenarios import list_presentation_scenarios, load_scenario


def run(graph, pid, mode="monitor", **kw):
    return run_scenario(graph, load_scenario(pid), ips_mode=mode, **kw)


def events(result, kind):
    return [e for e in result.events if e["type"] == kind]


def drops(result):
    return Counter((e["node"], e["reason"]) for e in events(result, "packet.dropped"))


def test_there_are_nine_presentation_scenarios_with_full_launcher_metadata() -> None:
    scenarios = list_presentation_scenarios()
    assert [s.id for s in scenarios] == [f"P{i}" for i in range(1, 10)]
    for s in scenarios:
        p = s.presentation
        assert p is not None and p.number == int(s.id[1:])
        assert p.objective and p.source and p.destination and p.protocol and p.security_rule and p.explanation and p.expected
        assert s.features.siem and s.features.edr and s.features.zero_trust


@pytest.mark.parametrize("pid", [f"P{i}" for i in range(1, 10)])
@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_every_scenario_is_repeatable(graph, pid, mode) -> None:
    a = run(graph, pid, mode, scripted_operator=True)
    b = run(graph, pid, mode, scripted_operator=True)
    assert a.trace_hash == b.trace_hash and a.events == b.events


def test_p1_normal_traffic_is_delivered_and_raises_nothing(graph) -> None:
    for mode in ("monitor", "enforce"):
        r = run(graph, "P1", mode)
        assert r.stats.blocked == 0 and r.stats.alerts == 0 and r.stats.delivered_clean == r.stats.data_packets
        assert not events(r, "siem.event") and not events(r, "ips.action")
        assert any(e["type"] == "packet.delivered" and e["node"] == "APP-SRV" for e in r.events)


def test_p2_staff_to_security_is_denied_by_the_core_acl_and_reported_to_the_siem(graph) -> None:
    r = run(graph, "P2")
    assert drops(r) == {("CORE-SW1", "acl_deny"): 4}
    assert {e["rule_id"] for e in events(r, "policy.decision") if e["action"] == "deny"} == {"STAFF-IN:20"}
    assert not any(e["type"] == "packet.delivered" and e["node"] == "SIEM-1" for e in r.events)
    siem = events(r, "siem.event")
    assert any(e["source"] == "CORE-SW1" and e["kind"] == "policy_deny" and e["node"] == "PC-1" for e in siem)
    # the repeated denials of one flow are one SIEM event, not four
    assert sum(1 for e in siem if e["source"] == "CORE-SW1") == 1


def test_p3_database_access_is_denied_by_staff_in_rule_10(graph) -> None:
    r = run(graph, "P3")
    assert drops(r) == {("CORE-SW1", "acl_deny"): 1}
    assert {e["rule_id"] for e in events(r, "policy.decision") if e["action"] == "deny"} == {"STAFF-IN:10"}
    assert not events(r, "ips.action") and not any(e["node"] == "DB-SRV" for e in events(r, "packet.delivered"))


def test_p4_the_administrator_is_allowed_explicitly_and_staff_is_not(graph) -> None:
    r = run(graph, "P4")
    zt = events(r, "zt.decision")
    assert [(e["device"], e["resource"], e["decision"]) for e in zt] == [("ADMIN-PC", "SIEM-1", "allow"), ("ADMIN-PC", "EDR-MGMT-1", "allow")]
    for e in zt:
        assert e["pdp"] == "ZT-POLICY-1" and e["node"] == "CORE-SW1" and e["role"] == "admin" and e["reason"] and e["factors"]
    delivered_to = {e["node"] for e in events(r, "packet.delivered")}
    assert {"SIEM-1", "EDR-MGMT-1"} <= delivered_to
    # PC-1 is stopped by the static ACL before Zero Trust is consulted
    assert drops(r) == {("CORE-SW1", "acl_deny"): 1}
    assert all(e["device"] != "PC-1" for e in zt)


def test_p5_external_http_crosses_the_firewall_and_is_delivered(graph) -> None:
    r = run(graph, "P5")
    assert r.stats.blocked == 0 and not events(r, "siem.event") and not events(r, "alert.raised")
    nodes = {e["to"] for e in events(r, "packet.hop")}
    assert {"R1-EDGE", "FW1", "CORE-SW1", "IPS-1", "APP-SRV"} <= nodes
    assert {e["rule_id"] for e in events(r, "policy.decision") if e["node"] == "FW1" and not e["via_conntrack"]} == {"OUTSIDE-IN:30"}
    assert any(e["via_conntrack"] for e in events(r, "policy.decision"))  # the reply is allowed by connection tracking


def test_p6_the_firewall_denies_the_external_database_access_and_ids_never_sees_it(graph) -> None:
    for mode in ("monitor", "enforce"):
        r = run(graph, "P6", mode)
        assert drops(r) == {("FW1", "fw_deny"): 1}
        assert not events(r, "alert.raised") and not events(r, "ips.action") and not events(r, "inspect.result")
        assert [e["source"] for e in events(r, "siem.event")] == ["FW1"]


def test_p7_compromise_edr_detection_isolation_and_unaffected_peers(graph) -> None:
    r = run(graph, "P7", "enforce", scripted_operator=True)
    edr = events(r, "edr.alert")
    assert len(edr) == 1 and edr[0]["node"] == "PC-2" and edr[0]["state"] == "compromised" and edr[0]["manager"] == "EDR-MGMT-1"
    states = [(e["node"], e["state"], e["cause"]) for e in events(r, "edr.state")]
    assert states == [("PC-2", "compromised", "scenario"), ("PC-2", "isolated", "operator")]
    sensors = {e["sensor"] for e in events(r, "alert.raised")}
    assert sensors == {"IDS-1", "IPS-1"} and all(e["src"] == "10.0.10.12" for e in events(r, "alert.raised"))
    isolated_at = next(e["t"] for e in events(r, "edr.state") if e["state"] == "isolated")
    # after isolation PC-2's own packets are dropped at its agent
    created = {e["pid"]: e for e in events(r, "packet.created")}
    late = [e for e in events(r, "packet.dropped") if e["reason"] == "edr_isolated" and created[e["pid"]]["src"] == "10.0.10.12" and e["t"] >= isolated_at]
    assert late and all(e["node"] == "PC-2" for e in late)
    # PC-1 is unaffected: its sessions (before and after) are delivered
    pc1 = {e["pid"] for e in created.values() if e["flow"].startswith("P7-pc1")}
    assert pc1 and not any(e["pid"] in pc1 for e in events(r, "packet.dropped"))
    # one SIEM incident about PC-2 joins EDR, IDS, IPS and the isolation
    siem = events(r, "siem.event")
    incidents = {e["incident_id"] for e in siem if e["node"] == "PC-2"}
    assert len(incidents) == 1
    assert {"EDR", "IDS-1", "IPS-1"} <= {e["source"] for e in siem}


def test_p7_without_the_scripted_operator_nothing_is_isolated(graph) -> None:
    r = run(graph, "P7", "monitor")
    assert not [e for e in events(r, "edr.state") if e["state"] == "isolated"]
    assert not any(e["reason"] == "edr_isolated" for e in events(r, "packet.dropped"))
    assert r.final_isolated == ()


def test_p7_operator_isolation_from_the_playhead_is_prefix_stable(graph) -> None:
    base = run(graph, "P7", "monitor")
    control = EndpointControl(type="endpoint", t=9.0, node="PC-2", action="isolate")
    acted = run_scenario(graph, load_scenario("P7"), ips_mode="monitor", controls=[control])
    before = [e for e in base.events if e["t"] < 9.0 and e["type"] != "run.end"]
    assert before == [e for e in acted.events if e["t"] < 9.0 and e["type"] != "run.end"]
    assert acted.final_isolated == ("PC-2",)


def test_p8_recovery_restores_permitted_connectivity(graph) -> None:
    r = run(graph, "P8", scripted_operator=True)
    created = {e["pid"]: e for e in events(r, "packet.created")}
    dropped = {e["pid"] for e in events(r, "packet.dropped")}
    delivered = {e["pid"] for e in events(r, "packet.delivered")}
    before = [p for p, e in created.items() if e["flow"] == "P8-pc2-isolated" and e["src"] == "10.0.10.12"]
    after = [p for p, e in created.items() if e["flow"] == "P8-pc2-restored" and e["src"] == "10.0.10.12"]
    assert before and all(p in dropped for p in before)
    assert after and any(p in delivered for p in after)
    states = [(e["state"], e["cause"]) for e in events(r, "edr.state")]
    assert states == [("isolated", "scenario"), ("healthy", "operator")]
    assert [e["kind"] for e in events(r, "siem.event")] == ["state", "state"] and r.final_isolated == ()


def test_p9_siem_receives_the_events_from_the_sensors_that_produced_them(graph) -> None:
    monitor = run(graph, "P9", "monitor")
    enforce = run(graph, "P9", "enforce")
    for r in (monitor, enforce):
        assert {e["rule"] for e in events(r, "alert.raised")} == {"D6"}
        siem = events(r, "siem.event")
        assert {e["source"] for e in siem} <= {"IDS-1", "IPS-1"}
        assert {e["source"] for e in siem if e["kind"] == "alert"} == {"IDS-1", "IPS-1"}
        assert len({e["incident_id"] for e in siem}) == 1
        assert all(e["event_id"] and e["severity"] and e["reason"] and e["incident_id"] for e in siem)
    assert drops(monitor) == {} and drops(enforce) == {("IPS-1", "ips_drop"): 3}


def test_the_siem_never_invents_an_event(graph) -> None:
    """Every SIEM event points at an event of the same trace that really came from the same component."""
    for pid in (f"P{i}" for i in range(1, 10)):
        r = run(graph, pid, "enforce", scripted_operator=True)
        by_ref: dict[tuple[str, str], dict] = {}
        for e in r.events:
            ref = e.get("alert_id") or (str(e["pid"]) if "pid" in e else None) or e.get("node")
            if ref is not None:
                by_ref[(e["type"], str(ref))] = e
        for s in events(r, "siem.event"):
            origin = by_ref.get((s["origin_type"], str(s["origin_ref"])))
            assert origin is not None, (pid, s)
            if s["source"] in ("IDS-1", "IPS-1") and s["kind"] == "alert":
                assert origin["sensor"] == s["source"]
            if s["source"] in ("FW1", "CORE-SW1"):
                assert origin["node"] == s["source"] and origin["action"] == "deny"
            if s["source"] == "EDR":
                assert origin["type"] in ("edr.alert", "edr.state")


def test_baseline_scenarios_emit_no_campus_security_events(graph) -> None:
    for sid in ("S1", "S2", "S3", "S4", "S7"):
        r = run_scenario(graph, load_scenario(sid))
        kinds = {e["type"] for e in r.events}
        assert not kinds & {"zt.decision", "edr.alert", "edr.state", "siem.event"}, sid


def test_an_endpoint_control_needs_a_scenario_that_uses_edr(graph) -> None:
    control = EndpointControl(type="endpoint", t=1.0, node="PC-2", action="isolate")
    with pytest.raises(EngineError):
        run_scenario(graph, load_scenario("S1"), controls=[control])


def test_a_committed_isolation_applies_to_the_next_run(graph) -> None:
    snap = SecuritySnapshot(isolated=("PC-1",))
    r = run_scenario(graph, load_scenario("P1"), security_state=snap)
    assert any(e["reason"] == "edr_isolated" and e["node"] == "PC-1" for e in events(r, "packet.dropped"))
    assert r.stats.delivered_clean == 0
    assert r.config_hash != run_scenario(graph, load_scenario("P1"), security_state=EMPTY_SNAPSHOT).config_hash
