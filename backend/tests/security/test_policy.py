"""Firewall and ACL evaluation: rule order, implicit deny, restricted sources, connection tracking."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from netsec.security.policy.engine import CONNTRACK, IMPLICIT_DENY, FlowKey, PolicyEvaluator
from netsec.security.policy.models import Policy, PolicyFile, Rule, load_policies


def rule(id, action, **kw) -> Rule:
    return Rule(id=id, action=action, **kw)


def evaluator(*policies: Policy, restricted=()) -> PolicyEvaluator:
    return PolicyEvaluator([PolicyFile(restricted_ips=list(restricted), policies=list(policies))])


def policy(rules, name="P", node="FW1", link="L04", stateful=False, vlan=None) -> Policy:
    return Policy(name=name, node=node, ingress_link=link, vlan=vlan, stateful=stateful, rules=rules)


def tcp(src, dst, dport, sport=50000) -> FlowKey:
    return FlowKey("tcp", src, dst, sport, dport)


def test_first_matching_rule_wins() -> None:
    p = policy([rule("10", "deny", proto="tcp", dst="10.0.30.20", dport=3306), rule("20", "permit")])
    ev = evaluator(p)
    assert ev.evaluate(p, tcp("10.0.10.11", "10.0.30.20", 3306)).rule_id == "10"
    assert ev.evaluate(p, tcp("10.0.10.11", "10.0.30.20", 3306)).action == "deny"
    assert ev.evaluate(p, tcp("10.0.10.11", "10.0.30.10", 443)).rule_id == "20"


def test_rule_order_matters() -> None:
    allow_first = policy([rule("1", "permit"), rule("2", "deny", dst="10.0.30.20")])
    deny_first = policy([rule("2", "deny", dst="10.0.30.20"), rule("1", "permit")])
    flow = tcp("10.0.10.11", "10.0.30.20", 3306)
    assert evaluator(allow_first).evaluate(allow_first, flow).action == "permit"
    assert evaluator(deny_first).evaluate(deny_first, flow).action == "deny"


def test_implicit_deny_when_nothing_matches() -> None:
    p = policy([rule("20", "permit", proto="tcp", dst="10.0.30.10", dport=443)])
    decision = evaluator(p).evaluate(p, tcp("203.0.113.66", "10.0.30.20", 3306))
    assert (decision.rule_id, decision.action) == (IMPLICIT_DENY, "deny")


def test_protocol_and_port_must_match() -> None:
    p = policy([rule("20", "permit", proto="tcp", dst="10.0.30.10", dport=443)])
    ev = evaluator(p)
    assert ev.evaluate(p, tcp("1.1.1.1", "10.0.30.10", 443)).action == "permit"
    assert ev.evaluate(p, tcp("1.1.1.1", "10.0.30.10", 444)).action == "deny"
    assert ev.evaluate(p, FlowKey("udp", "1.1.1.1", "10.0.30.10", 5, 443)).action == "deny"


def test_cidr_matching_for_source_and_destination() -> None:
    p = policy([rule("1", "deny", src="10.0.10.0/24", dst="10.0.99.0/24"), rule("2", "permit")])
    ev = evaluator(p)
    assert ev.evaluate(p, tcp("10.0.10.12", "10.0.99.20", 22)).rule_id == "1"
    assert ev.evaluate(p, tcp("10.0.20.10", "10.0.99.20", 22)).rule_id == "2"


def test_disabled_rules_are_skipped() -> None:
    p = policy([rule("1", "deny", enabled=False), rule("2", "permit")])
    assert evaluator(p).evaluate(p, tcp("1.1.1.1", "2.2.2.2", 1)).rule_id == "2"


def test_restricted_sources() -> None:
    p = policy([rule("10", "deny", src="restricted"), rule("20", "permit")])
    ev = evaluator(p, restricted=["203.0.113.99"])
    assert ev.evaluate(p, tcp("203.0.113.99", "10.0.30.10", 443)).rule_id == "10"
    assert ev.evaluate(p, tcp("203.0.113.25", "10.0.30.10", 443)).rule_id == "20"


def test_stateful_policy_permits_return_traffic_via_conntrack() -> None:
    out = policy([rule("20", "permit", proto="tcp", dst="10.0.30.10", dport=443)], name="OUT-IN", link="L04", stateful=True)
    back = policy([], name="IN-OUT", link="L05", stateful=True)  # no rule would permit the reply
    ev = evaluator(out, back)
    request = tcp("203.0.113.25", "10.0.30.10", 443, sport=51000)
    reply = tcp("10.0.30.10", "203.0.113.25", 51000, sport=443)
    assert ev.evaluate(back, reply).action == "deny"  # before the request: nothing to match
    assert ev.evaluate(out, request).action == "permit"
    decision = ev.evaluate(back, reply)
    assert (decision.action, decision.rule_id, decision.via_conntrack) == ("permit", CONNTRACK, True)


def test_conntrack_does_not_permit_a_different_flow() -> None:
    out = policy([rule("20", "permit", proto="tcp", dst="10.0.30.10", dport=443)], name="OUT-IN", stateful=True)
    back = policy([], name="IN-OUT", link="L05", stateful=True)
    ev = evaluator(out, back)
    ev.evaluate(out, tcp("203.0.113.25", "10.0.30.10", 443, sport=51000))
    assert ev.evaluate(back, tcp("10.0.30.10", "203.0.113.25", 51001, sport=443)).action == "deny"
    assert ev.evaluate(back, tcp("10.0.30.20", "203.0.113.25", 51000, sport=443)).action == "deny"


def test_denied_flows_are_never_tracked() -> None:
    out = policy([rule("1", "deny")], name="OUT-IN", stateful=True)
    back = policy([], name="IN-OUT", link="L05", stateful=True)
    ev = evaluator(out, back)
    ev.evaluate(out, tcp("1.1.1.1", "10.0.30.10", 443, sport=5))
    assert ev.evaluate(back, tcp("10.0.30.10", "1.1.1.1", 5, sport=443)).action == "deny"


def test_icmp_replies_match_by_identifier() -> None:
    out = policy([rule("1", "permit", proto="icmp")], name="IN-OUT", link="L05", stateful=True)
    back = policy([], name="OUT-IN", link="L04", stateful=True)
    ev = evaluator(out, back)
    assert ev.evaluate(out, FlowKey("icmp", "10.0.10.11", "203.0.113.25", icmp_id=7)).action == "permit"
    assert ev.evaluate(back, FlowKey("icmp", "203.0.113.25", "10.0.10.11", icmp_id=7)).via_conntrack is True
    assert ev.evaluate(back, FlowKey("icmp", "203.0.113.25", "10.0.10.11", icmp_id=8)).action == "deny"


def test_stateless_acl_has_no_connection_tracking() -> None:
    acl = policy([rule("20", "permit", proto="tcp", dport=443)], stateful=False)
    ev = evaluator(acl)
    ev.evaluate(acl, tcp("10.0.10.11", "10.0.30.10", 443, sport=5))
    reply = ev.evaluate(acl, tcp("10.0.30.10", "10.0.10.11", 5, sport=443))
    assert reply.via_conntrack is False and reply.action == "deny"


def test_policy_lookup_by_node_link_and_vlan() -> None:
    staff = policy([rule("1", "permit")], name="STAFF-IN", node="CORE-SW1", link="L06", vlan=10)
    ev = evaluator(staff)
    assert ev.policy_for("CORE-SW1", "L06", 10) is staff
    assert ev.policy_for("CORE-SW1", "L06", 20) is None  # VLAN 20 traffic is not subject to STAFF-IN
    assert ev.policy_for("CORE-SW1", "L05", None) is None
    assert ev.policy_for("FW1", "L06", 10) is None


def test_shipped_policies_load_and_match_the_design() -> None:
    ev = PolicyEvaluator(load_policies())
    assert {p.name for p in ev.policies} == {"OUTSIDE-IN", "INSIDE-OUT", "STAFF-IN"}
    staff = ev.policy_for("CORE-SW1", "L06", 10)
    assert ev.evaluate(staff, tcp("10.0.10.11", "10.0.30.20", 3306)).rule_id == "10"
    assert ev.evaluate(staff, tcp("10.0.10.11", "10.0.99.20", 22)).rule_id == "20"
    assert ev.evaluate(staff, tcp("10.0.10.11", "10.0.30.10", 443)).rule_id == "100"
    outside = ev.policy_for("FW1", "L04", None)
    assert ev.evaluate(outside, tcp("203.0.113.25", "10.0.30.10", 443)).rule_id == "20"
    assert ev.evaluate(outside, tcp("203.0.113.66", "10.0.30.20", 3306)).rule_id == IMPLICIT_DENY
    assert ev.evaluate(outside, tcp("203.0.113.99", "10.0.30.10", 443)).rule_id == "10"


def test_invalid_rules_are_rejected() -> None:
    for bad in ({"src": "not-an-ip"}, {"dst": "restricted"}, {"proto": "gre"}, {"action": "maybe"}, {"extra": 1}):
        with pytest.raises(ValidationError):
            Rule(id="1", **{"action": "permit", **bad})
