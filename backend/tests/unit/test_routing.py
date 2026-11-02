"""Longest-prefix-match routing."""

from __future__ import annotations

from ipaddress import IPv4Network

from netsec.network.routing import RouteEntry, RouteTable


def _entry(cidr: str, next_hop: str | None, iface: str, source="static", metric=1) -> RouteEntry:
    return RouteEntry(IPv4Network(cidr), next_hop, iface, source, metric)  # type: ignore[arg-type]


def test_longest_prefix_wins_regardless_of_declaration_order() -> None:
    table = RouteTable(
        "X",
        [
            _entry("0.0.0.0/0", "10.0.0.1", "a", "default"),
            _entry("10.0.0.0/8", "10.0.0.2", "b"),
            _entry("10.0.30.0/24", "10.0.0.3", "c"),
        ],
    )
    assert table.lookup("10.0.30.5").iface == "c"
    assert table.lookup("10.0.99.5").iface == "b"
    assert table.lookup("8.8.8.8").iface == "a"


def test_lowest_metric_breaks_prefix_tie() -> None:
    table = RouteTable(
        "X", [_entry("10.0.0.0/8", "1.1.1.1", "slow", metric=20), _entry("10.0.0.0/8", "2.2.2.2", "fast", metric=5)]
    )
    assert table.lookup("10.1.1.1").iface == "fast"


def test_no_route_returns_none() -> None:
    table = RouteTable("X", [_entry("10.0.0.0/8", "10.0.0.2", "b")])
    assert table.lookup("203.0.113.5") is None


def test_edge_router_tables_match_the_design(tables) -> None:
    r1 = tables["R1-EDGE"]
    assert r1.lookup("203.0.113.25").source == "connected"
    to_inside = r1.lookup("10.0.30.10")
    assert (to_inside.next_hop, to_inside.iface) == ("10.255.0.2", "Gi0/1")
    assert r1.lookup("10.255.0.2").source == "connected"  # /30 beats the /8 static route


def test_firewall_prefers_the_more_specific_inside_route(tables) -> None:
    fw = tables["FW1"]
    assert fw.lookup("10.0.30.10").next_hop == "10.255.1.2"  # 10.0.0.0/16 via CORE-SW1
    assert fw.lookup("203.0.113.66").next_hop == "10.255.0.1"  # default via R1-EDGE


def test_core_switch_routes_vlans_as_connected_and_defaults_to_firewall(tables) -> None:
    core = tables["CORE-SW1"]
    for dst, svi in (("10.0.10.11", "Vlan10"), ("10.0.20.10", "Vlan20"), ("10.0.30.10", "Vlan30"), ("10.0.99.10", "Vlan99")):
        entry = core.lookup(dst)
        assert (entry.source, entry.iface) == ("connected", svi)
    assert core.lookup("203.0.113.25").next_hop == "10.255.1.1"


def test_hosts_get_a_default_route_to_their_gateway(tables) -> None:
    entry = tables["PC-1"].lookup("203.0.113.25")
    assert (entry.source, entry.next_hop) == ("default", "10.0.10.1")
    assert tables["PC-1"].lookup("10.0.10.12").source == "connected"


def test_layer2_devices_have_no_routing_table(tables) -> None:
    for node_id in ("ACC-SW2", "SRV-SW3", "INET"):
        assert node_id not in tables
