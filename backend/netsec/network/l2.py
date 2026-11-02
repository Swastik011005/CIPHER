"""Layer 2 path finding inside a broadcast domain.

A broadcast domain is either one VLAN or an untagged segment. Switches (and the
Layer 3 switch acting as a switch) relay frames for the VLANs they carry, the inline
IPS relays frames between its two bridged data ports, and the abstract INET segment
relays untagged Ethernet. Everything else is an endpoint.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional

from netsec.network.models import Link, Node
from netsec.network.topology import TopologyGraph


@dataclass(frozen=True)
class Domain:
    """A Layer 2 broadcast domain: a VLAN id, or ``None`` for an untagged segment."""

    vlan: Optional[int] = None

    @property
    def untagged(self) -> bool:
        return self.vlan is None


@dataclass(frozen=True)
class L2Hop:
    """One frame transmission across one link."""

    link_id: str
    src: str
    dst: str
    vlan: Optional[int]


def link_carries(link: Link, domain: Domain) -> bool:
    """Whether ``link`` forwards frames belonging to ``domain``."""
    if link.kind == "span":
        return False
    if domain.untagged:
        return link.kind == "ethernet"
    if link.kind in ("access", "mgmt"):
        return link.vlan == domain.vlan
    if link.kind == "trunk":
        return domain.vlan in (link.trunk_vlans or [])
    return False


def _can_relay(node: Node, domain: Domain, in_iface: str, out_iface: str) -> bool:
    if node.type in ("l2switch", "l3switch"):
        return not domain.untagged
    if node.type == "segment":
        return domain.untagged
    if node.type == "ips" and node.bridge is not None:
        return (
            domain.vlan == node.bridge.vlan
            and in_iface in node.bridge.ports
            and out_iface in node.bridge.ports
            and in_iface != out_iface
        )
    return False


def domain_of_interface(graph: TopologyGraph, node_id: str, iface_name: str) -> Domain:
    """The broadcast domain a node's interface is attached to."""
    iface = graph.interface(node_id, iface_name)
    if iface.kind == "svi":
        return Domain(iface.vlan)
    link = graph.link_of_interface(node_id, iface_name)
    if link is None:
        raise ValueError(f"{node_id}:{iface_name} is not attached to a link")
    if link.kind in ("access", "mgmt"):
        return Domain(link.vlan)
    if link.kind == "ethernet":
        return Domain(None)
    raise ValueError(f"{node_id}:{iface_name} sits on a {link.kind} link and has no single domain")


def find_l2_path(
    graph: TopologyGraph,
    src: str,
    dst: str,
    domain: Domain,
    first_link: Optional[str] = None,
    dst_iface: Optional[str] = None,
) -> Optional[list[L2Hop]]:
    """Shortest Layer 2 path from ``src`` to ``dst`` inside ``domain``.

    ``first_link`` forces the first hop onto a specific link (the egress interface of the
    sender). ``dst_iface`` requires arrival on a specific physical interface of ``dst``.
    Ties are broken by link id, so the result is deterministic. Returns ``None`` when the
    two nodes cannot reach each other in this domain.
    """
    if src == dst:
        return []

    # BFS over nodes; state records the link used to arrive so bridges can check ports.
    arrived_by: dict[str, Optional[Link]] = {src: None}
    parent: dict[str, tuple[str, Link]] = {}
    queue: deque[str] = deque([src])

    while queue:
        current = queue.popleft()
        in_link = arrived_by[current]
        node = graph.node(current)
        for link in graph.links_at(current):
            if current == src and first_link is not None and link.id != first_link:
                continue
            if not link_carries(link, domain):
                continue
            if current != src:
                in_iface = in_link.local(current).iface  # type: ignore[union-attr]
                out_iface = link.local(current).iface
                if not _can_relay(node, domain, in_iface, out_iface):
                    continue
            neighbour = link.other(current)
            if neighbour.node in arrived_by:
                continue
            if neighbour.node == dst and dst_iface is not None:
                dst_iface_obj = graph.interface(dst, dst_iface)
                if dst_iface_obj.kind == "physical" and neighbour.iface != dst_iface:
                    continue
            arrived_by[neighbour.node] = link
            parent[neighbour.node] = (current, link)
            if neighbour.node == dst:
                return _unwind(parent, src, dst, domain)
            queue.append(neighbour.node)
    return None


def _unwind(
    parent: dict[str, tuple[str, Link]], src: str, dst: str, domain: Domain
) -> list[L2Hop]:
    hops: list[L2Hop] = []
    node = dst
    while node != src:
        previous, link = parent[node]
        hops.append(L2Hop(link.id, previous, node, domain.vlan))
        node = previous
    hops.reverse()
    return hops
