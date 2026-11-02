"""Static policy evaluation: first matching rule wins, implicit deny at the end.

This is the firewall (FW1) and ACL (CORE-SW1 STAFF-IN) logic. It decides by headers only, with no
notion of behaviour: a port scan on a permitted service is allowed here, which is why the IDS and
IPS exist. It enforces regardless of the IPS mode.
"""

from __future__ import annotations

from dataclasses import dataclass
from ipaddress import IPv4Address, IPv4Network
from typing import Optional

from netsec.security.policy.models import Policy, PolicyFile, Rule

IMPLICIT_DENY = "implicit-deny"
CONNTRACK = "conntrack"


@dataclass(frozen=True)
class FlowKey:
    """Header fields a policy may look at. Carries no ground truth."""

    proto: str
    src: str
    dst: str
    sport: Optional[int] = None
    dport: Optional[int] = None
    icmp_id: Optional[int] = None


@dataclass(frozen=True)
class Decision:
    policy: str
    rule_id: str
    action: str  # "permit" | "deny"
    via_conntrack: bool = False


def _matches_address(spec: str, address: str, restricted: frozenset[str]) -> bool:
    if spec == "any":
        return True
    if spec == "restricted":
        return address in restricted
    return IPv4Address(address) in IPv4Network(spec, strict=False)


def rule_matches(rule: Rule, flow: FlowKey, restricted: frozenset[str]) -> bool:
    if not rule.enabled:
        return False
    if rule.proto != "ip" and rule.proto != flow.proto:
        return False
    if not _matches_address(rule.src, flow.src, restricted):
        return False
    if not _matches_address(rule.dst, flow.dst, restricted):
        return False
    if rule.sport is not None and rule.sport != flow.sport:
        return False
    if rule.dport is not None and rule.dport != flow.dport:
        return False
    return True


def _forward_key(flow: FlowKey) -> tuple:
    if flow.proto == "icmp":
        return ("icmp", flow.src, flow.dst, flow.icmp_id)
    return (flow.proto, flow.src, flow.sport, flow.dst, flow.dport)


def _reverse_key(flow: FlowKey) -> tuple:
    if flow.proto == "icmp":
        return ("icmp", flow.dst, flow.src, flow.icmp_id)
    return (flow.proto, flow.dst, flow.dport, flow.src, flow.sport)


class PolicyEvaluator:
    """All policies of the network, plus the connection tracking of the stateful ones."""

    def __init__(self, files: list[PolicyFile]) -> None:
        self.policies: list[Policy] = [p for f in files for p in f.policies]
        self.restricted: frozenset[str] = frozenset(ip for f in files for ip in f.restricted_ips)
        self._conntrack: dict[str, set[tuple]] = {p.name: set() for p in self.policies if p.stateful}

    def policy_for(self, node_id: str, link_id: str, vlan: Optional[int]) -> Optional[Policy]:
        """The policy that applies to a packet arriving at ``node_id`` over ``link_id``."""
        for policy in self.policies:
            if policy.node != node_id or policy.ingress_link != link_id:
                continue
            if policy.vlan is not None and policy.vlan != vlan:
                continue
            return policy
        return None

    def evaluate(self, policy: Policy, flow: FlowKey) -> Decision:
        """Decide one packet. Permitted flows of a stateful policy are remembered."""
        if policy.stateful and _reverse_key(flow) in self._shared_tracked(policy):
            return Decision(policy.name, CONNTRACK, "permit", via_conntrack=True)

        for rule in policy.rules:
            if rule_matches(rule, flow, self.restricted):
                if rule.action == "permit" and policy.stateful:
                    self._conntrack[policy.name].add(_forward_key(flow))
                return Decision(policy.name, rule.id, rule.action)
        return Decision(policy.name, IMPLICIT_DENY, "deny")

    def _shared_tracked(self, policy: Policy) -> set[tuple]:
        """Flows permitted by any stateful policy on the same node (both directions of one firewall)."""
        tracked: set[tuple] = set()
        for other in self.policies:
            if other.node == policy.node and other.stateful:
                tracked |= self._conntrack[other.name]
        return tracked
