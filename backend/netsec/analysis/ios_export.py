"""Cisco IOS rendering of the firewall and ACL policies.

The simulation's policies are ordered lists with an implicit deny, exactly like IOS named extended access
lists, so each policy becomes one ``ip access-list extended`` block. The output is text for study and for the
Packet Tracer side of the project; nothing is sent anywhere. Each rule keeps its simulation id in a ``remark``,
so a line in a trace (``STAFF-IN:10``) can be found in the configuration.
"""

from __future__ import annotations

from ipaddress import IPv4Network

from netsec.security.policy.models import Policy, Rule
from netsec.security.ruleset import RuleSet


def _address(spec: str) -> list[str]:
    """IOS address operand(s) for a rule's source or destination: ``any``, ``host a.b.c.d`` or ``net wildcard``."""
    if spec == "any":
        return ["any"]
    net = IPv4Network(spec, strict=False)
    if net.prefixlen == 32:
        return [f"host {net.network_address}"]
    return [f"{net.network_address} {net.hostmask}"]


def _port(rule_port: int | None) -> str:
    return f" eq {rule_port}" if rule_port is not None else ""


def rule_lines(rule: Rule, policy: Policy, restricted: list[str]) -> list[str]:
    """The IOS lines for one rule: a remark naming it, then one or more access entries."""
    remark = f"{policy.name}:{rule.id}" + (f" {rule.description}" if rule.description else "")
    lines = [f" remark {remark}"]
    if not rule.enabled:
        return lines + [" remark (this rule is switched off in the simulation and is not exported)"]

    proto = rule.proto
    sources = [f"host {ip}" for ip in restricted] if rule.src == "restricted" else _address(rule.src)
    if rule.src == "restricted" and not sources:
        return lines + [" remark (no restricted address is configured, so this rule matches nothing)"]
    destination = _address(rule.dst)[0]
    for source in sources:
        sport = _port(rule.sport) if proto in ("tcp", "udp") else ""
        dport = _port(rule.dport) if proto in ("tcp", "udp") else ""
        lines.append(f" {rule.action} {proto} {source}{sport} {destination}{dport}")
    return lines


def policy_config(policy: Policy, restricted: list[str]) -> str:
    out = [f"! {policy.name} on {policy.node}, traffic arriving on link {policy.ingress_link}" + (f" in VLAN {policy.vlan}" if policy.vlan else "")]
    if policy.stateful:
        out.append("! Stateful in the simulation: replies to permitted connections are allowed back automatically.")
        out.append("! On IOS use a zone-based firewall or reflexive ACLs for that; this ACL alone is stateless.")
    out.append(f"ip access-list extended {policy.name}")
    for rule in policy.rules:
        out += rule_lines(rule, policy, restricted)
    out.append(" remark implicit deny: IOS ends every access list with this, shown here for completeness")
    out.append(" deny ip any any")
    return "\n".join(out)


def export_cisco(rules: RuleSet) -> dict:
    """Every policy as IOS configuration text, plus the whole thing in one block."""
    restricted = rules.restricted_ips
    policies = [p for f in rules.policies for p in f.policies]
    blocks = [{"name": p.name, "node": p.node, "text": policy_config(p, restricted)} for p in policies]
    header = "! Exported from the NetSec simulation. Synthetic network: addresses are documentation ranges.\n! Rules in force: " + rules.digest()
    return {"rules_hash": rules.digest(), "policies": blocks, "text": header + "\n\n" + "\n!\n".join(b["text"] for b in blocks) + "\n"}
