"""The frozen topology and the validator that guards it."""

from __future__ import annotations

from netsec.network.topology import TopologyError, parse_topology
from netsec.network.validator import validate_topology

import pytest


def _failed_ids(report) -> set[str]:
    return {c.id for c in report.failures}


def test_frozen_topology_passes_every_check(graph) -> None:
    report = validate_topology(graph.topology)
    assert report.passed, [c.to_dict() for c in report.failures]
    assert len(report.checks) == 17  # T01-T16 of the frozen contract plus T17 (original contract unchanged)


def test_topology_counts_are_the_frozen_contract_plus_the_campus_extension(graph) -> None:
    """17 original nodes + 14 extension nodes, 18 original links + 14 extension links; VLANs, subnets and zones unchanged."""
    assert graph.summary() == {
        "nodes": 31,
        "devices": 30,
        "segments": 1,
        "links": 32,
        "vlans": 4,
        "subnets": 7,
        "zones": 7,
    }
    assert {v.id for v in graph.topology.vlans} == {10, 20, 30, 99}


def test_seven_subnets_are_four_vlan_and_three_routed(graph) -> None:
    kinds = [s.kind for s in graph.topology.subnets]
    assert kinds.count("vlan") == 4 and kinds.count("routed") == 3
    routed = {s.cidr for s in graph.topology.subnets if s.kind == "routed"}
    assert routed == {"203.0.113.0/24", "10.255.0.0/30", "10.255.1.0/30"}


def test_layer2_devices_and_ips_data_ports_have_no_ip(graph) -> None:
    for node_id in ("ACC-SW2", "SRV-SW3", "INET"):
        assert all(i.ip is None for i in graph.node(node_id).interfaces)
    ips = graph.node("IPS-1")
    assert graph.interface("IPS-1", "in").ip is None
    assert graph.interface("IPS-1", "out").ip is None
    assert graph.interface("IPS-1", "mgmt").ip == "10.0.99.11"
    assert ips.bridge is not None and ips.bridge.vlan == 30


def test_trunk_carries_only_vlan_10_and_20(graph) -> None:
    trunks = [lk for lk in graph.topology.links if lk.kind == "trunk"]
    assert len(trunks) == 1
    assert {trunks[0].a.node, trunks[0].b.node} == {"CORE-SW1", "ACC-SW2"}
    assert sorted(trunks[0].trunk_vlans or []) == [10, 20]


def test_extra_vlan_is_rejected(validate_mutated) -> None:
    def add_vlan(d: dict) -> None:
        d["vlans"].append({"id": 40, "name": "Guest", "description": "extra"})

    assert "T05" in _failed_ids(validate_mutated(add_vlan))


def test_missing_link_is_rejected(validate_mutated) -> None:
    def drop_link(d: dict) -> None:
        d["links"] = [lk for lk in d["links"] if lk["id"] != "L18"]

    failed = _failed_ids(validate_mutated(drop_link))
    assert "T02" in failed
    assert "T04" in failed  # DB-SRV eth0 is now unconnected


def test_dangling_link_endpoint_is_rejected(validate_mutated) -> None:
    def break_ref(d: dict) -> None:
        d["links"][0]["b"]["node"] = "NOPE"

    assert "T04" in _failed_ids(validate_mutated(break_ref))


def test_ip_on_a_layer2_switch_is_rejected(validate_mutated) -> None:
    def give_ip(d: dict) -> None:
        acc = next(n for n in d["nodes"] if n["id"] == "ACC-SW2")
        acc["interfaces"].append(
            {"name": "mgmt", "kind": "svi", "ip": "10.0.99.2", "prefix": 24, "vlan": 99}
        )

    assert "T08" in _failed_ids(validate_mutated(give_ip))


def test_ip_on_ips_data_port_is_rejected(validate_mutated) -> None:
    def give_ip(d: dict) -> None:
        ips = next(n for n in d["nodes"] if n["id"] == "IPS-1")
        port = next(i for i in ips["interfaces"] if i["name"] == "in")
        port.update({"ip": "10.0.30.99", "prefix": 24})

    assert "T08" in _failed_ids(validate_mutated(give_ip))


def test_wrong_ips_management_ip_is_rejected(validate_mutated) -> None:
    def change_ip(d: dict) -> None:
        ips = next(n for n in d["nodes"] if n["id"] == "IPS-1")
        next(i for i in ips["interfaces"] if i["name"] == "mgmt")["ip"] = "10.0.99.12"

    assert "T09" in _failed_ids(validate_mutated(change_ip))


def test_wrong_trunk_vlans_are_rejected(validate_mutated) -> None:
    def widen(d: dict) -> None:
        next(lk for lk in d["links"] if lk["kind"] == "trunk")["trunk_vlans"] = [10, 20, 30]

    assert "T11" in _failed_ids(validate_mutated(widen))


def test_duplicate_ip_is_rejected(validate_mutated) -> None:
    def clash(d: dict) -> None:
        pc2 = next(n for n in d["nodes"] if n["id"] == "PC-2")
        pc2["interfaces"][0]["ip"] = "10.0.10.11"

    assert "T07" in _failed_ids(validate_mutated(clash))


def test_host_in_wrong_vlan_subnet_is_rejected(validate_mutated) -> None:
    def move_host(d: dict) -> None:
        admin = next(n for n in d["nodes"] if n["id"] == "ADMIN-PC")
        admin["interfaces"][0].update({"ip": "10.0.10.50", "gateway": "10.0.10.1"})

    assert "T12" in _failed_ids(validate_mutated(move_host))


def test_malformed_topology_json_raises_readable_error() -> None:
    with pytest.raises(TopologyError, match="not valid JSON"):
        parse_topology("{not json")
    with pytest.raises(TopologyError, match="schema"):
        parse_topology('{"version": "1"}')
