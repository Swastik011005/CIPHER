"""Layer 2 path finding and end-to-end forwarding (the routing golden table)."""

from __future__ import annotations

import pytest

from netsec.network.forwarding import compute_route
from netsec.network.l2 import Domain, find_l2_path
from tests.conftest import ip_of

# (source, destination, expected node path, expected VLAN tag per hop)
GOLDEN_PATHS = [
    ("PC-1", "APP-SRV", ["PC-1", "ACC-SW2", "CORE-SW1", "IPS-1", "SRV-SW3", "APP-SRV"], [10, 10, 30, 30, 30]),
    ("APP-SRV", "PC-1", ["APP-SRV", "SRV-SW3", "IPS-1", "CORE-SW1", "ACC-SW2", "PC-1"], [30, 30, 30, 10, 10]),
    ("PC-2", "APP-SRV", ["PC-2", "ACC-SW2", "CORE-SW1", "IPS-1", "SRV-SW3", "APP-SRV"], [10, 10, 30, 30, 30]),
    ("ADMIN-PC", "DB-SRV", ["ADMIN-PC", "ACC-SW2", "CORE-SW1", "IPS-1", "SRV-SW3", "DB-SRV"], [20, 20, 30, 30, 30]),
    ("PC-1", "PC-2", ["PC-1", "ACC-SW2", "PC-2"], [10, 10]),
    ("APP-SRV", "DB-SRV", ["APP-SRV", "SRV-SW3", "DB-SRV"], [30, 30]),
    ("PC-1", "SEC-LOG", ["PC-1", "ACC-SW2", "CORE-SW1", "SEC-LOG"], [10, 10, 99]),
    (
        "EXT-USR",
        "APP-SRV",
        ["EXT-USR", "INET", "R1-EDGE", "FW1", "CORE-SW1", "IPS-1", "SRV-SW3", "APP-SRV"],
        [None, None, None, None, 30, 30, 30],
    ),
    (
        "EXT-ATK",
        "DB-SRV",
        ["EXT-ATK", "INET", "R1-EDGE", "FW1", "CORE-SW1", "IPS-1", "SRV-SW3", "DB-SRV"],
        [None, None, None, None, 30, 30, 30],
    ),
    (
        "APP-SRV",
        "EXT-USR",
        ["APP-SRV", "SRV-SW3", "IPS-1", "CORE-SW1", "FW1", "R1-EDGE", "INET", "EXT-USR"],
        [30, 30, 30, None, None, None, None],
    ),
]


@pytest.mark.parametrize("src,dst,path,vlans", GOLDEN_PATHS)
def test_golden_paths(graph, tables, src, dst, path, vlans) -> None:
    plan = compute_route(graph, tables, ip_of(graph, src), ip_of(graph, dst))
    assert plan.outcome == "delivered"
    assert plan.node_path == path
    assert [h.vlan for h in plan.hops] == vlans
    assert plan.terminal_node == dst


def test_ttl_is_decremented_once_per_routed_hop(graph, tables) -> None:
    plan = compute_route(graph, tables, ip_of(graph, "PC-1"), ip_of(graph, "APP-SRV"))
    assert plan.l3_nodes == ("CORE-SW1",)
    assert [h.ttl for h in plan.hops] == [64, 64, 63, 63, 63]  # 64 -> 63 after CORE-SW1

    outside = compute_route(graph, tables, ip_of(graph, "EXT-USR"), ip_of(graph, "APP-SRV"))
    assert outside.l3_nodes == ("R1-EDGE", "FW1", "CORE-SW1")
    assert outside.hops[-1].ttl == 61

    same_vlan = compute_route(graph, tables, ip_of(graph, "PC-1"), ip_of(graph, "PC-2"))
    assert same_vlan.l3_nodes == () and {h.ttl for h in same_vlan.hops} == {64}


def test_ttl_expiry_drops_at_the_router_that_decremented_to_zero(graph, tables) -> None:
    plan = compute_route(graph, tables, ip_of(graph, "PC-1"), ip_of(graph, "APP-SRV"), ttl=1)
    assert plan.outcome == "ttl_expired"
    assert plan.terminal_node == "CORE-SW1"
    assert plan.node_path[-1] == "CORE-SW1"


def test_inline_ips_is_on_the_server_path_but_not_the_management_path(graph, tables) -> None:
    to_server = compute_route(graph, tables, ip_of(graph, "PC-1"), ip_of(graph, "APP-SRV"))
    assert "IPS-1" in to_server.node_path
    # IPS-1's own management address is reached over VLAN 99 and the IPS is the endpoint.
    to_mgmt = compute_route(graph, tables, ip_of(graph, "SEC-LOG"), ip_of(graph, "IPS-1", "mgmt"))
    assert to_mgmt.node_path == ["SEC-LOG", "CORE-SW1", "IPS-1"]
    assert [h.link_id for h in to_mgmt.hops][-1] == "L16"


def test_same_vlan_traffic_never_enters_the_core(graph, tables) -> None:
    for src, dst in (("PC-1", "PC-2"), ("APP-SRV", "DB-SRV")):
        plan = compute_route(graph, tables, ip_of(graph, src), ip_of(graph, dst))
        assert "CORE-SW1" not in plan.node_path


def test_l2_path_is_confined_to_its_vlan(graph) -> None:
    # PC-1 (VLAN 10) cannot reach APP-SRV (VLAN 30) at Layer 2: that needs routing.
    assert find_l2_path(graph, "PC-1", "APP-SRV", Domain(10)) is None
    # The trunk carries VLAN 10 but not VLAN 30.
    assert find_l2_path(graph, "CORE-SW1", "ACC-SW2", Domain(30)) is None
    assert find_l2_path(graph, "CORE-SW1", "ACC-SW2", Domain(10)) is not None


def test_span_link_carries_no_layer2_domain(graph) -> None:
    for vlan in (10, 20, 30, 99, None):
        path = find_l2_path(graph, "CORE-SW1", "IDS-1", Domain(vlan))
        # IDS-1 is only reachable through its management link (VLAN 99), never via SPAN.
        if vlan == 99:
            assert [h.link_id for h in path] == ["L12"]
        else:
            assert path is None


def test_unassigned_addresses_are_rejected_up_front(graph, tables) -> None:
    with pytest.raises(ValueError, match="not assigned"):
        compute_route(graph, tables, ip_of(graph, "PC-1"), "10.9.9.9")
    with pytest.raises(ValueError, match="not assigned"):
        compute_route(graph, tables, "10.9.9.9", ip_of(graph, "PC-1"))


def test_path_finding_is_deterministic(graph, tables) -> None:
    src, dst = ip_of(graph, "EXT-ATK"), ip_of(graph, "DB-SRV")
    first = compute_route(graph, tables, src, dst)
    assert all(compute_route(graph, tables, src, dst) == first for _ in range(5))


def test_missing_route_reports_no_route_at_the_sender(graph, tables) -> None:
    from netsec.network.routing import RouteTable

    connected_only = RouteTable(
        "PC-1", [e for e in tables["PC-1"].entries if e.source == "connected"]
    )
    limited = {**tables, "PC-1": connected_only}
    plan = compute_route(graph, limited, ip_of(graph, "PC-1"), ip_of(graph, "APP-SRV"))
    assert plan.outcome == "no_route"
    assert plan.hops == () and plan.terminal_node == "PC-1"
