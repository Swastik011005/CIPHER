"""The read-only router, core switch and firewall command line."""

from __future__ import annotations

import pytest

from netsec.cli.device import COMMANDS, DeviceCli
from netsec.cli.endpoint import CliError
from netsec.security.ruleset import RuleStore

NL = chr(10)


def cli(graph, hits=None) -> DeviceCli:
    return DeviceCli(graph, RuleStore().current, hits or {})


def out(graph, node, command, hits=None) -> str:
    return NL.join(cli(graph, hits).execute(node, command).lines)


def test_only_the_router_core_switch_and_firewall_have_it(graph) -> None:
    for node in ("R1-EDGE", "CORE-SW1", "FW1"):
        assert cli(graph).execute(node, "help").lines
    for node in ("PC-1", "ACC-SW2", "IPS-1", "INET"):
        with pytest.raises(CliError):
            cli(graph).execute(node, "show ip route")


@pytest.mark.parametrize("command", ["configure terminal", "write erase", "reload", "enable", "show running-config; reload", "show $(id)", "conf t", "no ip route 0.0.0.0 0.0.0.0"])
def test_nothing_that_changes_or_runs_anything_is_accepted(graph, command) -> None:
    try:
        r = cli(graph).execute("CORE-SW1", command)
    except CliError:
        return
    assert not r.ok and "Invalid or unsupported" in r.lines[0]


def test_access_lists_show_the_rules_in_force_with_their_hit_counters(graph) -> None:
    text = out(graph, "CORE-SW1", "show access-lists", {"CORE-SW1:STAFF-IN:20:deny": 4, "CORE-SW1:STAFF-IN:100:permit": 9})
    assert "Extended IP access list STAFF-IN" in text
    assert "20 deny ip 10.0.10.0 0.0.0.255 10.0.99.0 0.0.0.255 (4 matches)" in text
    assert "10 deny tcp 10.0.10.0 0.0.0.255 host 10.0.30.20 eq 3306 (0 matches)" in text
    assert "100 permit ip any any (9 matches)" in text
    fw = out(graph, "FW1", "show access-list", {"FW1:OUTSIDE-IN:implicit-deny:deny": 2})
    assert "OUTSIDE-IN" in fw and "INSIDE-OUT" in fw and "implicit deny ip any any (2 matches)" in fw
    assert "No access list" in cli(graph).execute("R1-EDGE", "show access-lists").lines[0]


def test_interfaces_routes_and_config_come_from_the_topology(graph) -> None:
    brief = out(graph, "CORE-SW1", "show ip interface brief")
    assert "Vlan10" in brief and "10.0.10.1" in brief and "Vlan99" in brief and "Gi0/10" in brief
    route = out(graph, "R1-EDGE", "show ip route")
    assert "203.0.113.0/24 is directly connected" in route and "via 10.255.0.2" in route
    assert "link L06 (trunk, carries VLAN 10, 20) to ACC-SW2 Gi0/1" in out(graph, "CORE-SW1", "show interfaces")
    config = out(graph, "FW1", "show running-config")
    assert "hostname FW1" in config and "ip address 10.255.1.1 255.255.255.252" in config and "ip access-list extended OUTSIDE-IN" in config
    assert set(COMMANDS) >= {"show ip interface brief", "show interfaces", "show ip route", "show access-lists", "show running-config"}


def test_api_routes_device_nodes_to_the_device_cli_and_counts_hits_from_runs() -> None:
    from fastapi.testclient import TestClient

    from netsec.api.app_factory import create_app

    c = TestClient(create_app(frontend_dist=None))
    c.post("/api/sim/run", json={"scenario_id": "P2"})
    body = c.post("/api/cli/exec", json={"node": "CORE-SW1", "command": "show access-lists"}).json()
    assert any("20 deny ip 10.0.10.0 0.0.0.255 10.0.99.0 0.0.0.255 (4 matches)" in line for line in body["lines"])
    assert body["run"] is None
