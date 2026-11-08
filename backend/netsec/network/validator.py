"""Topology validator.

Checks the loaded topology against the frozen Rev 3 contract: 17 nodes (16 devices
plus the abstract Internet segment), 18 links, 4 VLANs, 7 IP subnets, and the
addressing rules for Layer 2 devices and the inline IPS.

Run directly for a human-readable report::

    python -m netsec.network.validator
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from ipaddress import IPv4Address, IPv4Network
from typing import Callable, Optional

from netsec.network.models import Link, Node, Subnet, Topology

# Frozen contract values (Rev 3, decisions A3).
EXPECTED_ORIGINAL_NODES = 17
EXPECTED_ORIGINAL_DEVICES = 16
EXPECTED_SEGMENTS = 1
EXPECTED_ORIGINAL_LINKS = 18
EXPECTED_ZONES = 7
EXPECTED_VLAN_IDS = frozenset({10, 20, 30, 99})
EXPECTED_VLAN_CIDRS = {
    10: "10.0.10.0/24",
    20: "10.0.20.0/24",
    30: "10.0.30.0/24",
    99: "10.0.99.0/24",
}
EXPECTED_ROUTED_CIDRS = frozenset({"203.0.113.0/24", "10.255.0.0/30", "10.255.1.0/30"})
EXPECTED_TRUNK_VLANS = (10, 20)
EXPECTED_IPS_MGMT_IP = "10.0.99.11"
L3_NODE_TYPES = frozenset({"router", "firewall", "l3switch"})


@dataclass(frozen=True)
class Check:
    id: str
    description: str
    passed: bool
    detail: str

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "description": self.description,
            "passed": self.passed,
            "detail": self.detail,
        }


@dataclass
class ValidationReport:
    checks: list[Check] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    @property
    def failures(self) -> list[Check]:
        return [c for c in self.checks if not c.passed]

    def to_dict(self) -> dict[str, object]:
        return {
            "passed": self.passed,
            "check_count": len(self.checks),
            "failed_count": len(self.failures),
            "checks": [c.to_dict() for c in self.checks],
        }


# A check function returns (problems, ok_detail). No problems means pass.
CheckResult = tuple[list[str], str]


def _node_map(t: Topology) -> dict[str, Node]:
    return {n.id: n for n in t.nodes}


def _subnet_of(ip: str, subnets: list[Subnet]) -> Optional[Subnet]:
    addr = IPv4Address(ip)
    for subnet in subnets:
        if addr in subnet.network:
            return subnet
    return None


def _original_contract() -> dict:
    """The original 17 nodes and 18 links of the frozen Rev 3 contract (``contracts/topology_original.json``)."""
    import json

    from netsec.config import CONTRACTS_DIR

    return json.loads((CONTRACTS_DIR / "topology_original.json").read_text(encoding="utf-8"))


def _check_node_counts(t: Topology) -> CheckResult:
    """The 17 original nodes (16 devices + INET) are all present; the campus extension only adds devices."""
    problems: list[str] = []
    original = _original_contract()["nodes"]
    ids = {n.id for n in t.nodes}
    missing = sorted(set(original) - ids)
    if missing:
        problems.append(f"original nodes missing: {missing}")
    devices = [n for n in t.nodes if n.type != "segment"]
    segments = [n for n in t.nodes if n.type == "segment"]
    if len(segments) != EXPECTED_SEGMENTS:
        problems.append(f"expected {EXPECTED_SEGMENTS} abstract segment, found {len(segments)}")
    elif segments[0].id != "INET":
        problems.append(f"the abstract segment must be 'INET', found {segments[0].id!r}")
    extension = len(t.nodes) - len(original)
    return problems, f"{len(t.nodes)} nodes = {len(original)} original + {extension} extension ({len(devices)} devices + {len(segments)} segment)"


def _check_link_count(t: Topology) -> CheckResult:
    """The 18 original links are all present; the extension only adds links."""
    problems = []
    original = _original_contract()["links"]
    ids = {lk.id for lk in t.links}
    missing = sorted(set(original) - ids)
    if missing:
        problems.append(f"original links missing: {missing}")
    return problems, f"{len(t.links)} links = {len(original)} original + {len(t.links) - len(original)} extension"


def _check_original_unchanged(t: Topology) -> CheckResult:
    """Every original node and link is exactly as the frozen contract has it (the extension may append ports, nothing else)."""
    problems = []
    original = _original_contract()
    nodes = _node_map(t)
    for node_id, spec in original["nodes"].items():
        node = nodes.get(node_id)
        if node is None:
            continue  # reported by T01
        if (node.type, node.form_factor, node.zone) != (spec["type"], spec["form_factor"], spec["zone"]):
            problems.append(f"{node_id}: type, form factor or zone differs from the contract")
        have = {i.name: i for i in node.interfaces}
        for name, want in spec["interfaces"].items():
            iface = have.get(name)
            if iface is None:
                problems.append(f"{node_id}:{name} is missing")
                continue
            got = {"kind": iface.kind, "ip": iface.ip, "prefix": iface.prefix, "gateway": iface.gateway, "vlan": iface.vlan}
            if got != want:
                problems.append(f"{node_id}:{name} differs from the contract: {got} instead of {want}")
    links = {lk.id: lk for lk in t.links}
    for link_id, want in original["links"].items():
        link = links.get(link_id)
        if link is None:
            continue  # reported by T02
        got = link.model_dump(mode="json", exclude_none=True)
        if got != {k: v for k, v in want.items() if v is not None}:
            problems.append(f"{link_id} differs from the contract")
    return problems, "all 17 original nodes and 18 original links are unchanged (identity, zone, addresses, VLANs, endpoints)"


def _check_unique_ids(t: Topology) -> CheckResult:
    problems = []
    for label, ids in (
        ("node", [n.id for n in t.nodes]),
        ("link", [lk.id for lk in t.links]),
        ("zone", [z.id for z in t.zones]),
        ("subnet", [s.id for s in t.subnets]),
    ):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            problems.append(f"duplicate {label} ids: {dupes}")
    for node in t.nodes:
        names = [i.name for i in node.interfaces]
        dupes = sorted({i for i in names if names.count(i) > 1})
        if dupes:
            problems.append(f"{node.id}: duplicate interface names {dupes}")
    return problems, "node, link, zone, subnet and interface identifiers are unique"


def _check_link_references(t: Topology) -> CheckResult:
    problems = []
    nodes = _node_map(t)
    used: dict[tuple[str, str], str] = {}
    for link in t.links:
        if link.a.node == link.b.node:
            problems.append(f"{link.id}: both endpoints are on {link.a.node}")
        for end in (link.a, link.b):
            node = nodes.get(end.node)
            if node is None:
                problems.append(f"{link.id}: unknown node {end.node!r}")
                continue
            iface = next((i for i in node.interfaces if i.name == end.iface), None)
            if iface is None:
                problems.append(f"{link.id}: {end.node} has no interface {end.iface!r}")
                continue
            if iface.kind == "svi":
                problems.append(f"{link.id}: {end.node}:{end.iface} is an SVI and cannot carry a link")
            key = (end.node, end.iface)
            if key in used:
                problems.append(f"{end.node}:{end.iface} is used by both {used[key]} and {link.id}")
            used[key] = link.id
    for node in t.nodes:
        for iface in node.interfaces:
            if iface.kind == "physical" and (node.id, iface.name) not in used:
                problems.append(f"{node.id}:{iface.name} is not connected to any link")
    return problems, "every link endpoint resolves; every physical interface is on exactly one link"


def _check_vlans(t: Topology) -> CheckResult:
    problems = []
    ids = {v.id for v in t.vlans}
    if len(t.vlans) != len(EXPECTED_VLAN_IDS) or ids != EXPECTED_VLAN_IDS:
        problems.append(f"expected exactly VLANs {sorted(EXPECTED_VLAN_IDS)}, found {sorted(ids)}")
    return problems, f"{len(t.vlans)} VLANs: {sorted(ids)}"


def _check_subnets(t: Topology) -> CheckResult:
    problems = []
    vlan_subnets = [s for s in t.subnets if s.kind == "vlan"]
    routed = [s for s in t.subnets if s.kind == "routed"]
    if len(t.subnets) != 7:
        problems.append(f"expected 7 IP subnets, found {len(t.subnets)}")
    if len(vlan_subnets) != 4 or len(routed) != 3:
        problems.append(
            f"expected 4 VLAN subnets + 3 routed subnets, found {len(vlan_subnets)} + {len(routed)}"
        )
    for vlan_id, cidr in EXPECTED_VLAN_CIDRS.items():
        match = [s for s in vlan_subnets if s.vlan == vlan_id]
        if len(match) != 1:
            problems.append(f"VLAN {vlan_id} must have exactly one subnet, found {len(match)}")
        elif match[0].cidr != cidr:
            problems.append(f"VLAN {vlan_id} subnet must be {cidr}, found {match[0].cidr}")
    if {s.cidr for s in routed} != EXPECTED_ROUTED_CIDRS:
        problems.append(
            f"routed subnets must be {sorted(EXPECTED_ROUTED_CIDRS)}, "
            f"found {sorted(s.cidr for s in routed)}"
        )
    networks = [s.network for s in t.subnets]
    for i, a in enumerate(networks):
        for b in networks[i + 1 :]:
            if a.overlaps(b):
                problems.append(f"subnets overlap: {a} and {b}")
    return problems, f"{len(t.subnets)} subnets ({len(vlan_subnets)} VLAN + {len(routed)} routed)"


def _check_ip_assignments(t: Topology) -> CheckResult:
    problems = []
    seen: dict[str, str] = {}
    count = 0
    for node in t.nodes:
        for iface in node.interfaces:
            if iface.ip is None:
                continue
            count += 1
            where = f"{node.id}:{iface.name}"
            if iface.ip in seen:
                problems.append(f"{where}: {iface.ip} is also assigned to {seen[iface.ip]}")
            seen[iface.ip] = where
            subnet = _subnet_of(iface.ip, t.subnets)
            if subnet is None:
                problems.append(f"{where}: {iface.ip} is not inside any declared subnet")
                continue
            if iface.prefix != subnet.network.prefixlen:
                problems.append(
                    f"{where}: prefix /{iface.prefix} does not match subnet {subnet.cidr}"
                )
            addr = IPv4Address(iface.ip)
            if addr in (subnet.network.network_address, subnet.network.broadcast_address):
                problems.append(f"{where}: {iface.ip} is a network or broadcast address")
    return problems, f"{count} IP addresses are valid, unique and inside their declared subnet"


def _check_no_unintended_ips(t: Topology) -> CheckResult:
    problems = []
    for node in t.nodes:
        if node.type in ("l2switch", "segment"):
            for iface in node.interfaces:
                if iface.ip is not None:
                    problems.append(f"{node.id}:{iface.name} has IP {iface.ip}; {node.type} nodes must have none")
        if node.bridge is not None:
            for iface in node.interfaces:
                if iface.name in node.bridge.ports and iface.ip is not None:
                    problems.append(f"{node.id}:{iface.name} is a bridged data port and must have no IP")
        if node.type == "ids":
            span_ifaces = [i for i in node.interfaces if i.name == "span"]
            if len(span_ifaces) != 1 or span_ifaces[0].ip is not None:
                problems.append(f"{node.id}: the SPAN destination port must exist and have no IP")
    return problems, "Layer 2 switches, INET, IPS-1 data ports and the IDS SPAN port carry no IP address"


def _check_ips_management(t: Topology) -> CheckResult:
    problems = []
    ips = [n for n in t.nodes if n.type == "ips"]
    if len(ips) != 1 or ips[0].id != "IPS-1":
        return ["expected exactly one IPS node named IPS-1"], ""
    node = ips[0]
    if node.bridge is None or node.bridge.vlan != 30 or set(node.bridge.ports) != {"in", "out"}:
        problems.append("IPS-1 must bridge ports in/out for VLAN 30")
    mgmt = [i for i in node.interfaces if i.name == "mgmt"]
    if len(mgmt) != 1 or mgmt[0].ip != EXPECTED_IPS_MGMT_IP:
        problems.append(f"IPS-1 management IP must be {EXPECTED_IPS_MGMT_IP}")
    return problems, f"IPS-1 bridges in/out for VLAN 30; management IP {EXPECTED_IPS_MGMT_IP}"


def _check_link_vlans(t: Topology) -> CheckResult:
    problems = []
    declared = {v.id for v in t.vlans}
    for link in t.links:
        if link.kind in ("access", "mgmt"):
            if link.vlan not in declared:
                problems.append(f"{link.id}: {link.kind} link needs a declared VLAN, found {link.vlan}")
            if link.trunk_vlans is not None:
                problems.append(f"{link.id}: {link.kind} link must not list trunk_vlans")
            if link.kind == "mgmt" and link.vlan != 99:
                problems.append(f"{link.id}: management links belong to VLAN 99")
        elif link.kind == "trunk":
            if link.vlan is not None:
                problems.append(f"{link.id}: trunk links must not set a single vlan")
            if not link.trunk_vlans or not set(link.trunk_vlans) <= declared:
                problems.append(f"{link.id}: trunk_vlans must be a non-empty subset of declared VLANs")
        else:
            if link.vlan is not None or link.trunk_vlans is not None:
                problems.append(f"{link.id}: {link.kind} links carry no VLAN information")
    return problems, "every link's VLAN fields are consistent with its kind"


def _check_trunk(t: Topology) -> CheckResult:
    problems = []
    trunks = [lk for lk in t.links if lk.kind == "trunk"]
    if len(trunks) != 1:
        problems.append(f"expected exactly one trunk link, found {len(trunks)}")
    else:
        trunk = trunks[0]
        ends = {trunk.a.node, trunk.b.node}
        if ends != {"CORE-SW1", "ACC-SW2"}:
            problems.append(f"{trunk.id}: the trunk must join CORE-SW1 and ACC-SW2, joins {sorted(ends)}")
        if tuple(sorted(trunk.trunk_vlans or [])) != EXPECTED_TRUNK_VLANS:
            problems.append(
                f"{trunk.id}: trunk must carry exactly VLANs {list(EXPECTED_TRUNK_VLANS)}, "
                f"carries {trunk.trunk_vlans}"
            )
    return problems, "CORE-SW1 to ACC-SW2 trunk carries VLAN 10 and VLAN 20 only"


def _check_vlan_membership(t: Topology) -> CheckResult:
    problems = []
    nodes = _node_map(t)
    segment_subnets: dict[str, set[str]] = {}
    for link in t.links:
        for end, other in ((link.a, link.b), (link.b, link.a)):
            node = nodes.get(end.node)
            iface = next((i for i in node.interfaces if i.name == end.iface), None) if node else None
            if iface is None or iface.ip is None:
                continue
            subnet = _subnet_of(iface.ip, t.subnets)
            if subnet is None:
                continue
            where = f"{end.node}:{end.iface}"
            if link.kind in ("access", "mgmt"):
                if subnet.kind != "vlan" or subnet.vlan != link.vlan:
                    problems.append(
                        f"{where}: IP {iface.ip} is in {subnet.cidr} but {link.id} is VLAN {link.vlan}"
                    )
            elif link.kind == "ethernet":
                if subnet.kind != "routed":
                    problems.append(f"{where}: IP {iface.ip} on untagged link {link.id} must be in a routed subnet")
                other_node = nodes.get(other.node)
                if other_node is not None and other_node.type == "segment":
                    segment_subnets.setdefault(other.node, set()).add(subnet.cidr)
    for seg, cidrs in segment_subnets.items():
        if len(cidrs) != 1:
            problems.append(f"segment {seg}: attached hosts span several subnets {sorted(cidrs)}")
    return problems, "interface IPs match the VLAN of their link; untagged links use routed subnets"


def _check_svis(t: Topology) -> CheckResult:
    problems = []
    declared = {v.id: v for v in t.vlans}
    for node in t.nodes:
        for iface in node.interfaces:
            if iface.kind != "svi":
                continue
            if node.type != "l3switch":
                problems.append(f"{node.id}:{iface.name}: SVIs are only valid on a Layer 3 switch")
            if iface.vlan not in declared:
                problems.append(f"{node.id}:{iface.name}: VLAN {iface.vlan} is not declared")
                continue
            subnet = _subnet_of(iface.ip or "0.0.0.0", t.subnets)
            if subnet is None or subnet.vlan != iface.vlan:
                problems.append(f"{node.id}:{iface.name}: IP is not in the subnet of VLAN {iface.vlan}")
    return problems, "SVIs sit on the Layer 3 switch inside their VLAN subnet"


def _check_gateways_and_routes(t: Topology) -> CheckResult:
    problems = []
    nodes = _node_map(t)
    l3_ips = {
        i.ip
        for n in t.nodes
        if n.type in L3_NODE_TYPES
        for i in n.interfaces
        if i.ip is not None
    }
    for node in t.nodes:
        connected = [i.network for i in node.interfaces if i.network is not None]
        for iface in node.interfaces:
            if iface.gateway is None:
                continue
            where = f"{node.id}:{iface.name}"
            if iface.network is None or IPv4Address(iface.gateway) not in iface.network:
                problems.append(f"{where}: gateway {iface.gateway} is outside the interface subnet")
            if iface.gateway not in l3_ips:
                problems.append(f"{where}: gateway {iface.gateway} is not owned by a router, firewall or L3 switch")
        for route in node.routes:
            hop = IPv4Address(route.next_hop)
            if not any(hop in net for net in connected):
                problems.append(f"{node.id}: route {route.prefix} next hop {route.next_hop} is not on a connected subnet")
            if route.next_hop not in l3_ips:
                problems.append(f"{node.id}: route {route.prefix} next hop {route.next_hop} is not an L3 device")
        if node.routes and node.type not in L3_NODE_TYPES:
            problems.append(f"{node.id}: only L3 devices may carry static routes")
    del nodes
    return problems, "gateways and static-route next hops are reachable and owned by L3 devices"


def _check_zones(t: Topology) -> CheckResult:
    problems = []
    zone_ids = {z.id for z in t.zones}
    declared_vlans = {v.id for v in t.vlans}
    if len(t.zones) != EXPECTED_ZONES:
        problems.append(f"expected {EXPECTED_ZONES} zones, found {len(t.zones)}")
    for zone in t.zones:
        if zone.vlan is not None and zone.vlan not in declared_vlans:
            problems.append(f"zone {zone.id}: undeclared VLAN {zone.vlan}")
    for node in t.nodes:
        if node.zone not in zone_ids:
            problems.append(f"{node.id}: unknown zone {node.zone!r}")
    empty = zone_ids - {n.zone for n in t.nodes}
    if empty:
        problems.append(f"zones with no devices: {sorted(empty)}")
    return problems, f"{len(t.zones)} zones, every node is placed in a declared zone"


def _check_span(t: Topology) -> CheckResult:
    problems = []
    nodes = _node_map(t)
    links = {lk.id: lk for lk in t.links}
    span = t.span
    node = nodes.get(span.node)
    sensor = nodes.get(span.sensor)
    link: Optional[Link] = links.get(span.destination_link)
    if node is None or node.type != "l3switch":
        problems.append(f"SPAN node {span.node!r} must be the Layer 3 switch")
    if sensor is None or sensor.type != "ids":
        problems.append(f"SPAN sensor {span.sensor!r} must be an IDS node")
    if link is None:
        problems.append(f"SPAN destination link {span.destination_link!r} does not exist")
    else:
        if link.kind != "span":
            problems.append(f"{link.id}: SPAN destination link must have kind 'span'")
        if {link.a.node, link.b.node} != {span.node, span.sensor}:
            problems.append(f"{link.id}: must join {span.node} and {span.sensor}")
    declared = {v.id for v in t.vlans}
    if not set(span.exclude_vlans) <= declared:
        problems.append(f"SPAN excludes undeclared VLANs {span.exclude_vlans}")
    return problems, f"ingress SPAN {span.node} -> {span.sensor} over {span.destination_link}, VLAN {span.exclude_vlans} excluded"


_CHECKS: list[tuple[str, str, Callable[[Topology], CheckResult]]] = [
    ("T01", "The 17 original nodes (16 devices + INET segment) are present; the extension only adds devices", _check_node_counts),
    ("T02", "The 18 original links are present; the extension only adds links", _check_link_count),
    ("T03", "Identifiers are unique", _check_unique_ids),
    ("T04", "Link endpoints reference real nodes and interfaces", _check_link_references),
    ("T05", "Exactly four VLANs (10, 20, 30, 99)", _check_vlans),
    ("T06", "Seven IP subnets (4 VLAN + 3 routed) with the frozen CIDRs", _check_subnets),
    ("T07", "IP addresses valid, unique and inside declared subnets", _check_ip_assignments),
    ("T08", "No IP on Layer 2 switches, INET, IPS-1 data ports or the IDS SPAN port", _check_no_unintended_ips),
    ("T09", "IPS-1 is a VLAN 30 transparent bridge with management IP 10.0.99.11", _check_ips_management),
    ("T10", "Link VLAN assignments are valid for each link kind", _check_link_vlans),
    ("T11", "The single trunk carries VLAN 10 and 20 only", _check_trunk),
    ("T12", "Interface IPs agree with the VLAN of the link they sit on", _check_vlan_membership),
    ("T13", "SVIs are valid and inside their VLAN subnet", _check_svis),
    ("T14", "Gateways and static routes are reachable and owned by L3 devices", _check_gateways_and_routes),
    ("T15", "Seven zones, every node in a declared zone", _check_zones),
    ("T16", "SPAN configuration is consistent", _check_span),
    ("T17", "The original contract is unchanged (nodes, links, addresses, VLANs)", _check_original_unchanged),
]


def validate_topology(topology: Topology) -> ValidationReport:
    """Run every check and return the full report (never raises for content problems)."""
    report = ValidationReport()
    for check_id, description, fn in _CHECKS:
        try:
            problems, ok_detail = fn(topology)
        except Exception as exc:  # a malformed topology must yield a failed check, not a crash
            problems, ok_detail = [f"check crashed: {type(exc).__name__}: {exc}"], ""
        report.checks.append(
            Check(
                id=check_id,
                description=description,
                passed=not problems,
                detail=ok_detail if not problems else "; ".join(problems),
            )
        )
    return report


def main(argv: list[str] | None = None) -> int:
    """Command-line entry: validate ``config/topology.json`` (or a given path)."""
    from netsec.config import DEFAULT_TOPOLOGY_PATH
    from netsec.network.topology import TopologyError, parse_topology

    args = sys.argv[1:] if argv is None else argv
    path = args[0] if args else DEFAULT_TOPOLOGY_PATH
    try:
        with open(path, encoding="utf-8") as handle:
            topology = parse_topology(handle.read())
    except (OSError, TopologyError) as exc:
        print(f"ERROR: {exc}")
        return 2
    report = validate_topology(topology)
    print(f"Topology validation: {path}")
    for check in report.checks:
        mark = "PASS" if check.passed else "FAIL"
        print(f"  [{mark}] {check.id} {check.description}")
        print(f"         {check.detail}")
    total = len(report.checks)
    print(f"Result: {total - len(report.failures)}/{total} checks passed")
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
