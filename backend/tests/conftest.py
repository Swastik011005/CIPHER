"""Shared pytest fixtures."""

from __future__ import annotations

import copy
import json
from typing import Callable

import pytest

from netsec.config import CONTRACTS_DIR, DEFAULT_TOPOLOGY_PATH
from netsec.network.models import Topology
from netsec.network.routing import RouteTable, build_route_tables
from netsec.network.topology import TopologyGraph, load_topology
from netsec.network.validator import ValidationReport, validate_topology
from netsec.traffic.scenarios import ScenarioSpec, load_scenario


@pytest.fixture(scope="session")
def graph() -> TopologyGraph:
    return load_topology()


@pytest.fixture(scope="session")
def tables(graph: TopologyGraph) -> dict[str, RouteTable]:
    return build_route_tables(graph)


@pytest.fixture(scope="session")
def s1() -> ScenarioSpec:
    return load_scenario("S1")


@pytest.fixture(scope="session")
def raw_topology() -> dict:
    return json.loads(DEFAULT_TOPOLOGY_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def event_contract() -> dict:
    return json.loads((CONTRACTS_DIR / "events.json").read_text(encoding="utf-8"))


@pytest.fixture
def validate_mutated(raw_topology: dict) -> Callable[[Callable[[dict], None]], ValidationReport]:
    """Apply a mutation to a copy of the topology JSON and return the validator report."""

    def run(mutate: Callable[[dict], None]) -> ValidationReport:
        data = copy.deepcopy(raw_topology)
        mutate(data)
        return validate_topology(Topology.model_validate(data))

    return run


def ip_of(graph: TopologyGraph, node_id: str, iface: str = "eth0") -> str:
    ip = graph.interface(node_id, iface).ip
    assert ip is not None
    return ip
