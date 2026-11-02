"""End-to-end IPv4 forwarding: combine routing (L3) and path finding (L2).

``compute_route`` answers: starting at the owner of ``src_ip``, which links does a packet
for ``dst_ip`` cross, what TTL does it carry on each hop, and how does it end?
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from netsec.network.l2 import Domain, domain_of_interface, find_l2_path
from netsec.network.routing import RouteTable
from netsec.network.topology import TopologyGraph

DEFAULT_TTL = 64
Outcome = Literal["delivered", "ttl_expired", "no_route"]


@dataclass(frozen=True)
class Hop:
    """A link traversal. ``ttl`` is the IP TTL carried on the wire during this hop."""

    link_id: str
    src: str
    dst: str
    vlan: Optional[int]
    ttl: int


@dataclass(frozen=True)
class RoutePlan:
    """The planned journey of one packet.

    ``terminal_node`` is where the journey ends: the destination host when ``delivered``,
    otherwise the node that dropped the packet. ``l3_nodes`` lists devices that routed it
    (each one decremented the TTL).
    """

    origin: str
    hops: tuple[Hop, ...]
    outcome: Outcome
    terminal_node: str
    l3_nodes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def node_path(self) -> list[str]:
        """Ordered nodes visited, from origin to terminal node."""
        return [self.origin] + [h.dst for h in self.hops]


def compute_route(
    graph: TopologyGraph,
    tables: dict[str, RouteTable],
    src_ip: str,
    dst_ip: str,
    ttl: int = DEFAULT_TTL,
) -> RoutePlan:
    """Plan the path of a packet from ``src_ip`` to ``dst_ip``."""
    origin = graph.owner_of_ip(src_ip)
    if origin is None:
        raise ValueError(f"source address {src_ip} is not assigned to any node")
    if graph.owner_of_ip(dst_ip) is None:
        raise ValueError(f"destination address {dst_ip} is not assigned to any node")

    origin_node = origin[0]
    current = origin_node
    wire_ttl = ttl
    hops: list[Hop] = []
    routed_by: list[str] = []
    guard = len(graph.nodes) + 1  # a loop in static routes must not hang the engine

    while guard > 0:
        guard -= 1
        table = tables.get(current)
        entry = table.lookup(dst_ip) if table else None
        if entry is None:
            return RoutePlan(origin_node, tuple(hops), "no_route", current, tuple(routed_by))

        next_hop_ip = entry.next_hop or dst_ip
        owner = graph.owner_of_ip(next_hop_ip)
        if owner is None:
            return RoutePlan(origin_node, tuple(hops), "no_route", current, tuple(routed_by))
        next_node, next_iface = owner

        egress = graph.interface(current, entry.iface)
        domain: Domain = domain_of_interface(graph, current, entry.iface)
        first_link = None
        if egress.kind == "physical":
            link = graph.link_of_interface(current, entry.iface)
            first_link = link.id if link else None
        l2 = find_l2_path(graph, current, next_node, domain, first_link, next_iface)
        if l2 is None:
            return RoutePlan(origin_node, tuple(hops), "no_route", current, tuple(routed_by))

        hops.extend(Hop(h.link_id, h.src, h.dst, h.vlan, wire_ttl) for h in l2)

        if graph.owner_of_ip(dst_ip) == owner and next_hop_ip == dst_ip:
            return RoutePlan(origin_node, tuple(hops), "delivered", next_node, tuple(routed_by))

        # next_node is an intermediate router: it decrements TTL before forwarding.
        wire_ttl -= 1
        routed_by.append(next_node)
        if wire_ttl <= 0:
            return RoutePlan(origin_node, tuple(hops), "ttl_expired", next_node, tuple(routed_by))
        current = next_node

    return RoutePlan(origin_node, tuple(hops), "no_route", current, tuple(routed_by))
