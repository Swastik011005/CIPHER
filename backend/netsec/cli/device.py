"""A read-only command line for the router, the core switch and the firewall.

Not an IOS parser: a short whitelist of ``show`` commands whose output is generated from the real simulation configuration (the
topology, the firewall and ACL rules in force, and the rule-hit counters the server has accumulated). Nothing here changes any
configuration or runs anything on the host. All data is synthetic.
"""

from __future__ import annotations

import ipaddress
import re
from typing import Optional

from netsec.cli.endpoint import CliError, CliResult
from netsec.network.topology import TopologyGraph
from netsec.security.ruleset import RuleSet

DEVICE_TYPES = ("router", "l3switch", "firewall")
COMMANDS = (
    "help",
    "clear",
    "show ip interface brief",
    "show interfaces",
    "show ip route",
    "show access-lists",
    "show access-list",
    "show running-config",
)
_ALLOWED = re.compile(r"[A-Za-z0-9 \-./]+")


def _mask(prefix: int) -> str:
    return str(ipaddress.IPv4Network(f"0.0.0.0/{prefix}").netmask)


def _wildcard(prefix: int) -> str:
    return str(ipaddress.IPv4Address(int(ipaddress.IPv4Network(f"0.0.0.0/{prefix}").hostmask)))


def _target(value: str) -> str:
    if value == "any":
        return "any"
    if value == "restricted":
        return "object-group RESTRICTED"
    if "/" in value:
        net = ipaddress.IPv4Network(value, strict=False)
        return f"{net.network_address} {_wildcard(net.prefixlen)}"
    return f"host {value}"


class DeviceCli:
    def __init__(self, graph: TopologyGraph, rules: RuleSet, rule_hits: dict[str, int]) -> None:
        self.graph = graph
        self.rules = rules
        self.hits = rule_hits

    def execute(self, node_id: str, command: str) -> CliResult:
        node = self.graph.nodes.get(node_id)
        if node is None or node.type not in DEVICE_TYPES:
            raise CliError("This command line is available on the router, the core switch and the firewall only.")
        text = " ".join(command.split())
        if not text:
            return CliResult([])
        if len(text) > 100 or not _ALLOWED.fullmatch(text):
            raise CliError("The command is not accepted. Type 'help'.")
        low = text.lower()
        if low == "clear":
            return CliResult([], clear=True)
        if low == "help":
            return CliResult([f"Read-only commands on {node_id} (simulated; nothing can be changed):", ""] + [f"  {c}" for c in COMMANDS if c not in ("help", "clear")] + ["  clear"])
        if low.startswith("show access-list"):
            return CliResult(self._access_lists(node_id, low.removeprefix("show access-lists").removeprefix("show access-list").strip()))
        if low == "show ip interface brief":
            return CliResult(self._brief(node_id))
        if low == "show interfaces":
            return CliResult(self._interfaces(node_id))
        if low == "show ip route":
            return CliResult(self._routes(node_id))
        if low == "show running-config":
            return CliResult(self._config(node_id))
        return CliResult([f"% Invalid or unsupported command: {text}. This simulated device is read-only; type 'help'."], ok=False)

    # -- show commands -------------------------------------------------------------------

    def _brief(self, node_id: str) -> list[str]:
        node = self.graph.node(node_id)
        lines = [f"{'Interface':<14}{'IP-Address':<16}{'OK?':<5}{'Method':<8}{'Status':<8}Protocol"]
        for i in node.interfaces:
            linked = self.graph.link_of_interface(node_id, i.name) is not None or i.kind == "svi"
            status = "up" if linked else "down"
            lines.append(f"{i.name:<14}{i.ip or 'unassigned':<16}{'YES':<5}{'manual' if i.ip else 'unset':<8}{status:<8}{status}")
        return lines

    def _interfaces(self, node_id: str) -> list[str]:
        node = self.graph.node(node_id)
        out: list[str] = []
        for i in node.interfaces:
            link = self.graph.link_of_interface(node_id, i.name)
            out.append(f"{i.name} is {'up' if link or i.kind == 'svi' else 'down'}, line protocol is {'up' if link or i.kind == 'svi' else 'down'}")
            if i.ip:
                out.append(f"  Internet address is {i.ip}/{i.prefix}")
            if link:
                peer = link.other(node_id)
                vlan = f", VLAN {link.vlan}" if link.vlan else (f", carries VLAN {', '.join(map(str, link.trunk_vlans))}" if link.trunk_vlans else "")
                out.append(f"  Description: link {link.id} ({link.kind}{vlan}) to {peer.node} {peer.iface}")
            elif i.kind == "svi":
                out.append(f"  Switch virtual interface for VLAN {i.vlan}")
            out.append("")
        return out[:-1] if out else out

    def _routes(self, node_id: str) -> list[str]:
        node = self.graph.node(node_id)
        lines = ["Codes: C - connected, S - static", ""]
        for i in node.interfaces:
            if i.ip and i.network:
                lines.append(f"C    {i.network} is directly connected, {i.name}")
        for r in node.routes:
            lines.append(f"S    {r.prefix} [1/{r.metric}] via {r.next_hop}")
        return lines

    def _policies(self, node_id: str):
        return [p for pf in self.rules.policies for p in pf.policies if p.node == node_id]

    def _access_lists(self, node_id: str, name: str) -> list[str]:
        policies = [p for p in self._policies(node_id) if not name or p.name.lower() == name]
        if not policies:
            return [f"No access list named {name!r} on {node_id}." if name else f"No access list is configured on {node_id}."]
        lines: list[str] = []
        for p in policies:
            lines.append(f"Extended IP access list {p.name} (applied inbound on {p.ingress_link}{f', VLAN {p.vlan}' if p.vlan else ''}{', stateful' if p.stateful else ''})")
            for r in p.rules:
                if not r.enabled:
                    continue
                matches = sum(n for k, n in self.hits.items() if k.startswith(f"{node_id}:{p.name}:{r.id}:"))
                port = f" eq {r.dport}" if r.dport else ""
                lines.append(f"    {r.id} {r.action} {r.proto} {_target(r.src)} {_target(r.dst)}{port} ({matches} matches)")
            implicit = sum(n for k, n in self.hits.items() if k.startswith(f"{node_id}:{p.name}:implicit-deny:"))
            if p.stateful:
                lines.append(f"    implicit deny ip any any ({implicit} matches)")
            lines.append("")
        return lines[:-1]

    def _config(self, node_id: str) -> list[str]:
        node = self.graph.node(node_id)
        lines = [f"hostname {node_id}", "!"]
        for i in node.interfaces:
            lines.append(f"interface {i.name}")
            link = self.graph.link_of_interface(node_id, i.name)
            if link:
                lines.append(f" description link {link.id} to {link.other(node_id).node}")
            lines.append(f" ip address {i.ip} {_mask(i.prefix)}" if i.ip else " no ip address")
            lines.append("!")
        for r in node.routes:
            net = ipaddress.IPv4Network(r.prefix)
            lines.append(f"ip route {net.network_address} {net.netmask} {r.next_hop}")
        for p in self._policies(node_id):
            lines.append("!")
            lines.append(f"ip access-list extended {p.name}")
            for r in p.rules:
                if r.enabled:
                    lines.append(f" {r.id} {r.action} {r.proto} {_target(r.src)} {_target(r.dst)}{f' eq {r.dport}' if r.dport else ''}")
        lines += ["!", "! Simulated configuration generated from the simulation's rules. Read-only."]
        return lines
