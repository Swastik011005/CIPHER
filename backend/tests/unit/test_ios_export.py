"""Cisco IOS rendering of the firewall and ACL policies."""

from __future__ import annotations

from fastapi.testclient import TestClient

from netsec.analysis.ios_export import export_cisco, rule_lines
from netsec.api.app_factory import create_app
from netsec.security.policy.models import Policy, Rule
from netsec.security.ruleset import RuleSet, RuleStore


def block(text: str, name: str) -> list[str]:
    """The lines of one access list, without its leading comments."""
    lines = text.splitlines()
    start = lines.index(f"ip access-list extended {name}")
    end = next((i for i in range(start + 1, len(lines)) if not lines[i].startswith(" ")), len(lines))
    return lines[start:end]


def test_staff_in_becomes_an_extended_acl_with_wildcard_masks_and_the_rule_ids_in_remarks() -> None:
    text = export_cisco(RuleSet.shipped())["text"]
    assert block(text, "STAFF-IN") == [
        "ip access-list extended STAFF-IN",
        " remark STAFF-IN:10 Staff may not reach the database directly",
        " deny tcp 10.0.10.0 0.0.0.255 host 10.0.30.20 eq 3306",
        " remark STAFF-IN:20 Staff may not reach the security network",
        " deny ip 10.0.10.0 0.0.0.255 10.0.99.0 0.0.0.255",
        " remark STAFF-IN:100 Everything else is permitted internally",
        " permit ip any any",
        " remark implicit deny: IOS ends every access list with this, shown here for completeness",
        " deny ip any any",
    ]


def test_every_policy_is_exported_in_order_with_its_node_and_ends_with_the_implicit_deny() -> None:
    result = export_cisco(RuleSet.shipped())
    assert [b["name"] for b in result["policies"]] == ["STAFF-IN", "OUTSIDE-IN", "INSIDE-OUT"]
    assert [b["node"] for b in result["policies"]] == ["CORE-SW1", "FW1", "FW1"]
    for b in result["policies"]:
        assert b["text"].splitlines()[-1] == " deny ip any any" and f"ip access-list extended {b['name']}" in b["text"]
    assert result["rules_hash"] in result["text"] and result["text"].endswith("\n")


def test_hosts_ports_and_protocols_are_rendered_the_ios_way() -> None:
    text = export_cisco(RuleSet.shipped())["text"]
    out = block(text, "OUTSIDE-IN")
    assert " permit tcp any host 10.0.30.10 eq 443" in out and " permit tcp any host 10.0.30.10 eq 80" in out
    inside = block(text, "INSIDE-OUT")
    assert " permit udp 10.0.0.0 0.0.255.255 any eq 53" in inside
    assert " permit icmp 10.0.0.0 0.0.255.255 any" in inside  # no port for icmp


def test_restricted_addresses_become_one_deny_per_address_in_the_exported_list() -> None:
    store = RuleStore()
    store.set_restricted_ips(["203.0.113.66", "198.51.100.7"])
    out = block(export_cisco(store.current)["text"], "OUTSIDE-IN")
    assert [line for line in out if line.startswith(" deny ip host")] == [" deny ip host 198.51.100.7 any", " deny ip host 203.0.113.66 any"]
    store.set_restricted_ips([])
    out = block(export_cisco(store.current)["text"], "OUTSIDE-IN")
    assert not [line for line in out if line.startswith(" deny ip host")]
    assert any("matches nothing" in line for line in out)  # said, not silently dropped


def test_a_switched_off_rule_is_not_exported_as_an_entry() -> None:
    policy = Policy(name="T", node="N", ingress_link="L01", rules=[Rule(id="5", action="deny", proto="tcp", dst="10.0.30.20", dport=3306, enabled=False)])
    lines = rule_lines(policy.rules[0], policy, [])
    assert lines[0] == " remark T:5" and all(not line.strip().startswith(("deny", "permit")) for line in lines) and "switched off" in lines[1]


def test_the_api_serves_the_export_for_the_rules_in_force() -> None:
    client = TestClient(create_app(frontend_dist=None))
    first = client.get("/api/rules/export/cisco").json()
    assert "deny ip host 203.0.113.99 any" in first["text"]
    client.put("/api/rules/restricted-ips", json={"addresses": ["198.51.100.7"]})
    second = client.get("/api/rules/export/cisco").json()
    assert "deny ip host 198.51.100.7 any" in second["text"] and "203.0.113.99" not in second["text"]
    assert second["rules_hash"] != first["rules_hash"]
