"""Firewall (FW1) and ACL (CORE-SW1 STAFF-IN) enforcement inside the engine."""

from __future__ import annotations

import pytest

from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import ScenarioSpec


def one_session(src: str, dst: str, dport: int, duration: float = 60.0) -> ScenarioSpec:
    return ScenarioSpec.model_validate(
        {
            "id": "S9",
            "name": "test",
            "description": "single TCP session",
            "duration": duration,
            "default_seed": 1,
            "flows": [{"type": "tcp_session", "id": "F", "src": src, "dst": dst, "dport": dport, "start": 0.5, "request_bytes": 100}],
        }
    )


def run(graph, src, dst, dport, mode="monitor", duration=60.0):
    return run_scenario(graph, one_session(src, dst, dport, duration), ips_mode=mode)


def of(result, kind):
    return [e for e in result.events if e["type"] == kind]


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_acl_denies_staff_access_to_the_database_and_the_ids_still_sees_it(graph, mode) -> None:
    result = run(graph, "PC-1", "DB-SRV", 3306, mode)
    (decision,) = of(result, "policy.decision")
    assert (decision["node"], decision["policy"], decision["rule_id"], decision["action"]) == (
        "CORE-SW1", "STAFF-IN", "STAFF-IN:10", "deny",
    )
    (dropped,) = of(result, "packet.dropped")
    assert (dropped["node"], dropped["reason"]) == ("CORE-SW1", "acl_deny")
    # SPAN is taken on ingress, before the ACL, so the sensor sees the denied attempt.
    (mirrored,) = of(result, "packet.mirrored")
    assert mirrored["pid"] == dropped["pid"] and mirrored["to"] == "IDS-1"
    # The packet never got near the IPS or the server, and no reply was generated.
    assert not [e for e in of(result, "packet.hop") if e["to"] in ("IPS-1", "DB-SRV")]
    assert result.stats.blocked == 1 and result.stats.delivered_clean == 0


def test_acl_denies_staff_access_to_the_security_network(graph) -> None:
    result = run(graph, "PC-1", "SEC-LOG", 22)
    (decision,) = of(result, "policy.decision")
    assert decision["rule_id"] == "STAFF-IN:20" and decision["action"] == "deny"


def test_the_acl_only_applies_to_vlan_10(graph) -> None:
    """ADMIN-PC (VLAN 20) is not subject to STAFF-IN: the same DB connection is not denied by the ACL."""
    result = run(graph, "ADMIN-PC", "DB-SRV", 3306)
    assert not of(result, "policy.decision")
    assert not [e for e in of(result, "packet.dropped") if e["reason"] == "acl_deny"]
    assert result.stats.delivered_clean > 0


def test_permitted_staff_traffic_matches_the_catch_all_rule(graph) -> None:
    result = run(graph, "PC-1", "APP-SRV", 443)
    decisions = of(result, "policy.decision")
    assert decisions and {(d["rule_id"], d["action"]) for d in decisions} == {("STAFF-IN:100", "permit")}
    assert not of(result, "packet.dropped")


def test_firewall_denies_unpublished_services_from_outside_and_the_ids_never_sees_it(graph) -> None:
    result = run(graph, "EXT-ATK", "DB-SRV", 3306)
    (decision,) = of(result, "policy.decision")
    assert (decision["node"], decision["rule_id"], decision["action"]) == ("FW1", "OUTSIDE-IN:implicit-deny", "deny")
    (dropped,) = of(result, "packet.dropped")
    assert (dropped["node"], dropped["reason"]) == ("FW1", "fw_deny")
    assert not of(result, "packet.mirrored")  # it never entered CORE-SW1: a blind spot by design
    assert result.stats.mirrored == 0


def test_firewall_permits_published_https_and_tracks_the_return_traffic(graph) -> None:
    result = run(graph, "EXT-USR", "APP-SRV", 443, duration=80.0)
    fw = [e for e in of(result, "policy.decision") if e["node"] == "FW1"]
    forward = [e for e in fw if not e["via_conntrack"]]
    returns = [e for e in fw if e["via_conntrack"]]
    assert forward and {e["rule_id"] for e in forward} == {"OUTSIDE-IN:20"}
    assert returns and {e["rule_id"] for e in returns} == {"INSIDE-OUT:conntrack"}
    assert not of(result, "packet.dropped")
    assert result.stats.delivered_clean == result.stats.data_packets == 8


def test_firewall_denies_restricted_sources_first(graph, s1) -> None:
    from netsec.security.policy.models import PolicyFile, load_policies

    files = load_policies()
    restricted = [PolicyFile(restricted_ips=["203.0.113.25"], policies=f.policies) if f.restricted_ips else f for f in files]
    from netsec.sim.engine import Engine

    result = Engine(graph, 1, policies=restricted).run(one_session("EXT-USR", "APP-SRV", 443))
    (decision,) = of(result, "policy.decision")
    assert decision["rule_id"] == "OUTSIDE-IN:10" and decision["action"] == "deny"


def test_policy_enforcement_is_independent_of_the_ips_mode(graph) -> None:
    def verdicts(mode):
        r = run(graph, "EXT-ATK", "DB-SRV", 3306, mode)
        return [(e["node"], e["rule_id"], e["action"]) for e in of(r, "policy.decision")]

    assert verdicts("monitor") == verdicts("enforce") == [("FW1", "OUTSIDE-IN:implicit-deny", "deny")]
