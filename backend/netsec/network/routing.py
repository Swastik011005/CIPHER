"""Per-node IPv4 routing tables with longest-prefix-match lookup."""

from __future__ import annotations

from dataclasses import dataclass
from ipaddress import IPv4Address, IPv4Network
from typing import Literal, Optional

from netsec.network.topology import TopologyGraph

RouteSource = Literal["connected", "static", "default"]


@dataclass(frozen=True)
class RouteEntry:
    """One routing table row.

    ``next_hop`` is ``None`` for connected routes (the destination is on-link).
    ``iface`` is the egress interface name.
    """

    network: IPv4Network
    next_hop: Optional[str]
    iface: str
    source: RouteSource
    metric: int = 1

    @property
    def prefixlen(self) -> int:
        return self.network.prefixlen


class RouteTable:
    """Routing table for a single node. Lookup is longest-prefix-match."""

    def __init__(self, node_id: str, entries: list[RouteEntry]) -> None:
        self.node_id = node_id
        # Sort once: longest prefix first, then lowest metric; the sort is stable so
        # declaration order breaks any remaining tie deterministically.
        self._entries = sorted(entries, key=lambda e: (-e.prefixlen, e.metric))

    @property
    def entries(self) -> list[RouteEntry]:
        return list(self._entries)

    def lookup(self, destination: str) -> Optional[RouteEntry]:
        """Return the most specific route covering ``destination`` or ``None``."""
        address = IPv4Address(destination)
        for entry in self._entries:
            if address in entry.network:
                return entry
        return None


def build_route_table(graph: TopologyGraph, node_id: str) -> RouteTable:
    """Build the table for ``node_id`` from its interfaces, gateways and static routes."""
    node = graph.node(node_id)
    entries: list[RouteEntry] = []

    for iface in node.interfaces:
        if iface.network is not None:
            entries.append(RouteEntry(iface.network, None, iface.name, "connected", 0))

    def egress_for(next_hop: str) -> str:
        hop = IPv4Address(next_hop)
        for entry in entries:
            if entry.source == "connected" and hop in entry.network:
                return entry.iface
        raise ValueError(f"{node_id}: next hop {next_hop} is not on a connected subnet")

    for iface in node.interfaces:
        if iface.gateway is not None:
            entries.append(
                RouteEntry(IPv4Network("0.0.0.0/0"), iface.gateway, iface.name, "default", 1)
            )
    for route in node.routes:
        network = IPv4Network(route.prefix)
        source: RouteSource = "default" if network.prefixlen == 0 else "static"
        entries.append(
            RouteEntry(network, route.next_hop, egress_for(route.next_hop), source, route.metric)
        )
    return RouteTable(node_id, entries)


def build_route_tables(graph: TopologyGraph) -> dict[str, RouteTable]:
    """Routing tables for every node that has at least one IP address."""
    return {
        node.id: build_route_table(graph, node.id)
        for node in graph.topology.nodes
        if any(i.ip is not None for i in node.interfaces)
    }
