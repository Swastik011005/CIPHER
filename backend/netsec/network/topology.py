"""Topology loading and indexed read access.

``config/topology.json`` is the single authoritative definition of the network.
Everything else (routing tables, L2 paths, the API, the 3D scene) derives from it.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from netsec.config import DEFAULT_TOPOLOGY_PATH
from netsec.network.models import Interface, Link, Node, Subnet, Topology


class TopologyError(Exception):
    """Raised when the topology file is unreadable, malformed or fails validation."""


class TopologyGraph:
    """A validated :class:`Topology` plus the indexes the engine needs."""

    def __init__(self, topology: Topology) -> None:
        self.topology = topology
        self.nodes: dict[str, Node] = {n.id: n for n in topology.nodes}
        self.links: dict[str, Link] = {lk.id: lk for lk in topology.links}
        self.subnets: list[Subnet] = list(topology.subnets)

        self._links_by_node: dict[str, list[Link]] = {n: [] for n in self.nodes}
        self._link_by_iface: dict[tuple[str, str], Link] = {}
        for link in sorted(topology.links, key=lambda lk: lk.id):
            for endpoint in (link.a, link.b):
                self._links_by_node[endpoint.node].append(link)
                self._link_by_iface[(endpoint.node, endpoint.iface)] = link

        self._ip_owner: dict[str, tuple[str, str]] = {}
        for node in topology.nodes:
            for iface in node.interfaces:
                if iface.ip is not None:
                    self._ip_owner[iface.ip] = (node.id, iface.name)

    def node(self, node_id: str) -> Node:
        try:
            return self.nodes[node_id]
        except KeyError as exc:
            raise KeyError(f"unknown node {node_id!r}") from exc

    def link(self, link_id: str) -> Link:
        try:
            return self.links[link_id]
        except KeyError as exc:
            raise KeyError(f"unknown link {link_id!r}") from exc

    def links_at(self, node_id: str) -> list[Link]:
        """Links touching ``node_id``, ordered by link id (deterministic)."""
        return self._links_by_node[node_id]

    def link_of_interface(self, node_id: str, iface: str) -> Optional[Link]:
        return self._link_by_iface.get((node_id, iface))

    def owner_of_ip(self, ip: str) -> Optional[tuple[str, str]]:
        """Return ``(node_id, interface_name)`` owning ``ip`` or ``None``."""
        return self._ip_owner.get(ip)

    def interface(self, node_id: str, iface: str) -> Interface:
        return self.node(node_id).interface(iface)

    def hosts(self) -> list[Node]:
        return [n for n in self.topology.nodes if n.type in ("host", "syslog")]

    def summary(self) -> dict[str, int]:
        nodes = self.topology.nodes
        return {
            "nodes": len(nodes),
            "devices": sum(1 for n in nodes if n.is_device),
            "segments": sum(1 for n in nodes if not n.is_device),
            "links": len(self.topology.links),
            "vlans": len(self.topology.vlans),
            "subnets": len(self.topology.subnets),
            "zones": len(self.topology.zones),
        }


def parse_topology(raw: str) -> Topology:
    """Parse topology JSON text into a model, with a readable error on failure."""
    try:
        return Topology.model_validate(json.loads(raw))
    except json.JSONDecodeError as exc:
        raise TopologyError(f"topology is not valid JSON: {exc}") from exc
    except ValueError as exc:  # pydantic.ValidationError subclasses ValueError
        raise TopologyError(f"topology does not match the schema:\n{exc}") from exc


def build_graph(topology: Topology) -> TopologyGraph:
    """Validate ``topology`` and index it. Raises :class:`TopologyError` on any failed check."""
    from netsec.network.validator import validate_topology

    report = validate_topology(topology)
    if not report.passed:
        failed = "; ".join(f"{c.id}: {c.detail}" for c in report.failures)
        raise TopologyError(f"topology validation failed: {failed}")
    return TopologyGraph(topology)


@lru_cache(maxsize=4)
def _load_cached(path: str) -> TopologyGraph:
    file = Path(path)
    try:
        raw = file.read_text(encoding="utf-8")
    except OSError as exc:
        raise TopologyError(f"cannot read topology file {file}: {exc}") from exc
    return build_graph(parse_topology(raw))


def load_topology(path: Path | str | None = None) -> TopologyGraph:
    """Load, validate and cache the topology (default: ``backend/config/topology.json``)."""
    return _load_cached(str(path or DEFAULT_TOPOLOGY_PATH))
