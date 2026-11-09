"""The simulated endpoint command line.

A visitor types a command in the CLI tab of an endpoint (a PC, laptop or server). The command is checked against a short
whitelist and its arguments are validated; nothing is ever passed to an operating system, a shell or ``eval``. A network
command (ping, tracert, telnet, curl) becomes one synthetic flow that the same deterministic engine used by the nine scenarios
runs, with the same rules, the same Zero Trust policy, the same EDR isolation state and the same counters. The text printed is
written from what that run's trace really says: where the packet was dropped, by which rule, and why. Nothing is hard-coded to a
sample output, and nothing is real: the "time" in a reply is simulation time.
"""

from __future__ import annotations

import hashlib
import ipaddress
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from netsec.network.forwarding import compute_route
from netsec.network.routing import build_route_tables
from netsec.network.topology import TopologyGraph
from netsec.security.ruleset import RuleSet
from netsec.security.state import SecuritySnapshot
from netsec.sim.engine import Engine, RunResult
from netsec.traffic.scenarios import Features, IcmpEchoSpec, ScenarioSpec, TcpSessionSpec

MAX_COMMAND_LENGTH = 160
COMMANDS = ("help", "ipconfig", "ping", "tracert", "telnet", "curl", "clear")
_URL = re.compile(r"^http://([A-Za-z0-9.\-]{1,64})(?::([0-9]{1,5}))?(/[^\s]{0,64})?$")

HELP = [
    "Simulated endpoint commands (nothing here runs on a real computer or network):",
    "",
    "  help                       show this list",
    "  ipconfig                   show this endpoint's address, gateway, VLAN and EDR status",
    "  ping <IP>                  send 4 simulated echo requests",
    "  tracert <IP>               show the simulated Layer 3 path",
    "  telnet <IP> <PORT>         try a simulated TCP connection",
    "  curl http://<IP>[:<PORT>]  fetch a simulated web page",
    "  clear                      clear the screen",
    "",
    "<IP> may also be the name of a device in this campus, for example APP-SRV.",
]


@dataclass
class CliResult:
    lines: list[str]
    ok: bool = True
    clear: bool = False
    #: The simulated run behind a network command, so the 3D scene can replay it. None for local commands.
    run: Optional[RunResult] = None
    decision: dict[str, Any] = field(default_factory=dict)
    #: When each printed line appears, in simulated seconds of the run (same length as ``lines``), so the terminal can print a line only
    #: when the packet it reports has reached the source. None for local commands, whose lines all appear at once.
    timeline: Optional[list[float]] = None


class CliError(Exception):
    """A command that is not valid; the message is shown to the user."""


def _seed(node: str, command: str) -> int:
    return int(hashlib.sha256(f"{node}|{command}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


def _resolve(graph: TopologyGraph, token: str) -> tuple[str, str]:
    """A target given as an IPv4 address or the id of a campus device; returns (ip, node id)."""
    try:
        ip = str(ipaddress.IPv4Address(token))
    except ValueError:
        node = graph.nodes.get(token.upper())
        if node is None:
            raise CliError(f"'{token}' is not an IPv4 address or a device in this campus.")
        ip = next((i.ip for i in node.interfaces if i.ip), None)
        if ip is None:
            raise CliError(f"{node.id} has no IP address to send traffic to.")
        return ip, node.id
    owner = graph.owner_of_ip(ip)
    if owner is None:
        raise CliError(f"{ip} is not an address in this simulated network.")
    return ip, owner[0]


def _port(token: str) -> int:
    if not token.isdigit() or not 1 <= int(token) <= 65535:
        raise CliError("The port must be a number from 1 to 65535.")
    return int(token)


def _iface(graph: TopologyGraph, node_id: str):
    node = graph.node(node_id)
    return node, next(i for i in node.interfaces if i.ip)


def _mask(prefix: int) -> str:
    return str(ipaddress.IPv4Network(f"0.0.0.0/{prefix}").netmask)


# -- evidence from a trace ------------------------------------------------------------------------


@dataclass
class Evidence:
    dropped_at: Optional[str] = None
    reason: Optional[str] = None
    rule_id: Optional[str] = None
    zt: Optional[dict] = None
    ips: Optional[dict] = None
    alert: Optional[dict] = None


def _evidence(events: list[dict], pid: int) -> Evidence:
    ev = Evidence()
    for e in events:
        if e.get("pid") != pid:
            continue
        kind = e["type"]
        if kind == "packet.dropped":
            ev.dropped_at, ev.reason = e["node"], e["reason"]
        elif kind == "policy.decision" and e["action"] == "deny":
            ev.rule_id = e["rule_id"]
        elif kind == "zt.decision" and e["decision"] != "allow":
            ev.zt = e
        elif kind == "ips.action" and e["action"] != "allow":
            ev.ips = e
    return ev


def _end_time(events: list[dict], pid: int) -> float:
    """When a packet's journey ended (delivered or dropped), in simulated seconds."""
    return max((e["t"] for e in events if e.get("pid") == pid and e["type"] in ("packet.delivered", "packet.dropped")), default=0.0)


def _timed(lines: list[str], run: Optional[RunResult], head: int = 2) -> list[float]:
    """Default line times for a command with one outcome: the first lines at once, the rest when the run has ended."""
    end = max((e["t"] for e in run.events if e["type"] in ("packet.delivered", "packet.dropped") and e.get("pid") is not None), default=0.0) if run else 0.0
    return [0.0 if i < head else end for i in range(len(lines))]


def _explain(engine: Engine, ev: Evidence, node_id: str) -> tuple[list[str], str]:
    """The reason lines and the enforcing device for a packet that did not arrive."""
    where = ev.dropped_at or "the network"
    reason = ev.reason
    if reason in ("acl_deny", "fw_deny") and ev.rule_id:
        policy = ev.rule_id.split(":")[0]
        if ev.rule_id.endswith(":implicit-deny"):
            return [f"Reason: {policy} has no rule that permits it, so the implicit deny applies.", f"Enforcing device: {where}."], where
        text = engine.rule_description(ev.rule_id)
        return [f"Reason: {policy} rule {ev.rule_id.split(':')[1]} denies it: {text}.", f"Enforcing device: {where}."], where
    if reason == "zt_deny" and ev.zt:
        return [f"Reason: Zero Trust denies it: {ev.zt['reason']}", f"Enforcing device: {where} (decision by {ev.zt['pdp']})."], where
    if reason == "edr_isolated":
        if where == node_id or where in ("the network",):
            return [f"Reason: {node_id} is isolated by EDR; its network traffic is blocked.", f"Enforcing device: the EDR agent on {node_id}."], where
        return [f"Reason: the sending endpoint is isolated by EDR; a packet it sent just before the isolation was discarded at {where}.", f"Enforcing device: EDR containment (applied at {where})."], where
    if reason in ("ips_drop", "ips_reject", "blocked_source", "rate_limited"):
        rule = f" ({ev.ips['rule']})" if ev.ips else ""
        words = {
            "ips_drop": "IPS-1 dropped the packet",
            "ips_reject": "IPS-1 rejected the connection",
            "blocked_source": "IPS-1 is blocking this source address",
            "rate_limited": "IPS-1 rate-limited the traffic",
        }
        return [f"Reason: {words[reason]}{rule}.", f"Enforcing device: {where}."], where
    if reason in ("ttl_expired", "no_route"):
        return [f"Reason: {reason.replace('_', ' ')} at {where}."], where
    return [f"Reason: dropped at {where} ({reason})."], where


# -- the commands ---------------------------------------------------------------------------------


class EndpointCli:
    def __init__(self, graph: TopologyGraph, rules: RuleSet, snapshot: SecuritySnapshot, ips_mode: str = "enforce") -> None:
        self.graph = graph
        self.rules = rules
        self.snapshot = snapshot
        self.ips_mode = ips_mode
        self.tables = build_route_tables(graph)

    # public entry point ------------------------------------------------------------------------

    def execute(self, node_id: str, command: str) -> CliResult:
        node = self.graph.nodes.get(node_id)
        if node is None or node.type != "host":
            raise CliError("The endpoint CLI is available on PCs, laptops and servers only.")
        text = command.strip()
        if not text:
            return CliResult([])
        if len(text) > MAX_COMMAND_LENGTH:
            raise CliError(f"The command is too long (at most {MAX_COMMAND_LENGTH} characters).")
        if not re.fullmatch(r"[A-Za-z0-9.:/_\- ]+", text):
            raise CliError("The command contains characters that are not accepted. Type 'help'.")
        parts = text.split()
        name, args = parts[0].lower(), parts[1:]
        if name not in COMMANDS:
            return CliResult([f"'{parts[0]}' is not recognized as a command of this simulated endpoint. Type 'help'."], ok=False)
        if name == "help":
            return CliResult(list(HELP))
        if name == "clear":
            return CliResult([], clear=True)
        if name == "ipconfig":
            return self._ipconfig(node_id)
        if name in ("ping", "tracert", "telnet", "curl") and node_id in self.snapshot.isolated:
            return self._isolated(node_id, name, args)
        if name == "ping":
            self._arity(name, args, 1, "ping <IP>")
            return self._ping(node_id, args[0], text)
        if name == "tracert":
            self._arity(name, args, 1, "tracert <IP>")
            return self._tracert(node_id, args[0], text)
        if name == "telnet":
            self._arity(name, args, 2, "telnet <IP> <PORT>")
            return self._connect(node_id, args[0], _port(args[1]), text, kind="telnet")
        self._arity(name, args, 1, "curl http://<IP>[:<PORT>]")
        match = _URL.match(args[0])
        if not match:
            raise CliError("curl accepts a URL like http://10.0.30.10 or http://APP-SRV:8080 only.")
        port = _port(match.group(2)) if match.group(2) else 80
        return self._connect(node_id, match.group(1), port, text, kind="curl")

    def _isolated(self, node_id: str, name: str, args: list[str]) -> CliResult:
        """An isolated endpoint cannot send anything: the command fails at once, no packet exists and nothing is animated."""
        target = args[0] if args else "the destination"
        what = {"ping": f"Pinging {target}", "tracert": f"Tracing route to {target}", "telnet": f"Connecting to {target}", "curl": f"curl {target}"}[name]
        lines = [
            f"{what} (simulated):",
            "",
            "TRANSMIT FAILED: this endpoint is ISOLATED by EDR.",
            f"Reason: {node_id} is isolated by EDR; its network traffic is blocked. No packet was sent.",
            f"Enforcing device: the EDR agent on {node_id}.",
            "A SOC operator can restore the endpoint (Security tab, Restore Endpoint).",
        ]
        if name == "ping":
            lines += ["", "Packets: Sent = 0, Received = 0, Lost = 0 (nothing was sent)"]
        return CliResult(lines, ok=False, decision={"delivered": False, "enforcing_device": node_id, "drop_reason": "edr_isolated", "isolated": True})

    @staticmethod
    def _arity(name: str, args: list[str], n: int, usage: str) -> None:
        if len(args) != n:
            raise CliError(f"Usage: {usage}")

    # simulation ---------------------------------------------------------------------------------

    def _run(self, node_id: str, command: str, flow) -> tuple[RunResult, Engine]:
        scenario = ScenarioSpec(
            id="CLI", name="Endpoint command", description=f"{node_id}> {command}", duration=1.0, default_seed=_seed(node_id, command),
            flows=[flow], features=Features(zero_trust=True, edr=True, siem=True),
        )
        engine = Engine(
            self.graph, scenario.default_seed, self.ips_mode,  # type: ignore[arg-type]
            detectors=self.rules.detectors, ips_policy=self.rules.ips_policy, policies=list(self.rules.policies), security_state=self.snapshot,
        )
        return engine.run(scenario, allow_overrun=True), engine

    def _ipconfig(self, node_id: str) -> CliResult:
        node, iface = _iface(self.graph, node_id)
        link = self.graph.link_of_interface(node_id, iface.name)
        vlan = link.vlan if link else None
        vlan_name = next((v.name for v in self.graph.topology.vlans if v.id == vlan), None) if vlan else None
        state = "ISOLATED by EDR (network traffic blocked)" if node_id in self.snapshot.isolated else "healthy"
        trust = dict(self.snapshot.trust).get(node_id, "trusted")
        return CliResult([
            "Simulated IP configuration",
            "",
            f"Host name . . . . . . . . : {node_id}",
            f"Ethernet adapter {iface.name}:",
            f"   IPv4 Address. . . . . . : {iface.ip}",
            f"   Subnet Mask . . . . . . : {_mask(iface.prefix)}",
            f"   Default Gateway . . . . : {iface.gateway or '-'}",
            f"   VLAN  . . . . . . . . . : {f'{vlan} ({vlan_name})' if vlan else 'none (routed network)'}",
            f"   Device trust  . . . . . : {trust}",
            f"   EDR status  . . . . . . : {state}",
        ])

    def _ping(self, node_id: str, target: str, command: str) -> CliResult:
        ip, target_node = _resolve(self.graph, target)
        _, me = _iface(self.graph, node_id)
        if target_node == node_id:
            return CliResult([f"Pinging {ip} with 32 bytes of data (this endpoint):"] + [f"Reply from {ip}: bytes=32 time<1ms TTL=64"] * 4 + ["", "Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)"])
        flow = IcmpEchoSpec(type="icmp_echo", id="cli-ping", src=node_id, dst=target_node, start=0.0, count=4, interval=1.0, payload_bytes=32, sequential=True, gap=0.6)
        run, engine = self._run(node_id, command, flow)
        ev = run.events
        created = {e["pid"]: e for e in ev if e["type"] == "packet.created" and e["mirror_of"] is None}
        requests = {e["icmp"]["seq"]: p for p, e in created.items() if e["src"] == me.ip and e["proto"] == "icmp" and e["icmp"] and e["icmp"]["type"] == 8}
        replies = {created[e["pid"]]["icmp"]["seq"]: e for e in ev if e["type"] == "packet.delivered" and e["pid"] in created
                   and created[e["pid"]]["dst"] == me.ip and created[e["pid"]]["icmp"] and created[e["pid"]]["icmp"]["type"] == 0}
        reply_pid = {e["icmp"]["seq"]: p for p, e in created.items() if e["dst"] == me.ip and e["proto"] == "icmp" and e["icmp"] and e["icmp"]["type"] == 0}
        ttl_of: dict[int, int] = {}
        for e in ev:
            if e["type"] == "packet.hop":
                ttl_of[e["pid"]] = e["ttl"]
        lines = [f"Pinging {ip} with 32 bytes of data (simulated):", ""]
        times = [0.0, 0.0]
        received = 0
        first_failure: Optional[Evidence] = None
        last_t = 0.0
        for seq in sorted(requests):
            pid = requests[seq]
            if seq in replies:
                rp = replies[seq]
                received += 1
                hops = sum(1 for e in ev if e["type"] == "packet.hop" and e["pid"] in (pid, rp["pid"]))
                ms = max(1, round(0.4 * hops))  # synthetic: 0.4 ms per link crossed, there and back
                lines.append(f"Reply from {ip}: bytes=32 time={ms}ms TTL={ttl_of.get(rp['pid'], 64)}")
                times.append(rp["t"])
                last_t = max(last_t, rp["t"])
                continue
            e = _evidence(ev, pid)
            if e.dropped_at is None and seq in reply_pid:
                e = _evidence(ev, reply_pid[seq])
            first_failure = first_failure or e
            if e.reason in ("fw_deny", "ips_drop", "ips_reject", "blocked_source", "rate_limited"):
                lines.append("Request timed out.")
            elif e.reason == "edr_isolated":
                lines.append("PING: transmit failed. General failure.")
            else:
                lines.append("Destination host unreachable.")
            t_end = max(_end_time(ev, pid), _end_time(ev, reply_pid[seq]) if seq in reply_pid else 0.0)
            times.append(t_end)
            last_t = max(last_t, t_end)
        sent = len(requests)
        lost = sent - received
        lines += ["", f"Packets: Sent = {sent}, Received = {received}, Lost = {lost} ({round(100 * lost / max(1, sent))}% loss)"]
        times += [last_t, last_t]
        decision: dict[str, Any] = {"delivered": received > 0}
        if first_failure is not None:
            reason_lines, device = _explain(engine, first_failure, node_id)
            lines += [""] + reason_lines
            times += [last_t] * (len(reason_lines) + 1)
            decision.update(enforcing_device=device, drop_reason=first_failure.reason, rule_id=first_failure.rule_id)
        return CliResult(lines, ok=received > 0, run=run, decision=decision, timeline=times)

    def _tracert(self, node_id: str, target: str, command: str) -> CliResult:
        ip, target_node = _resolve(self.graph, target)
        _, me = _iface(self.graph, node_id)
        flow = IcmpEchoSpec(type="icmp_echo", id="cli-trace", src=node_id, dst=target_node, start=0.0, count=1, interval=1.0, payload_bytes=32)
        run, engine = self._run(node_id, command, flow)
        plan = compute_route(self.graph, self.tables, me.ip, ip)
        pid = next((e["pid"] for e in run.events if e["type"] == "packet.created" and e["mirror_of"] is None and e["src"] == me.ip), None)
        ev = _evidence(run.events, pid) if pid is not None else Evidence()
        delivered = ev.dropped_at is None
        path = [n for n in plan.node_path[1:] if self.graph.node(n).type in ("router", "firewall", "l3switch")]
        lines = [f"Tracing route to {ip} over a maximum of 30 hops (simulated):", ""]
        hop_no = 0
        reference = me.ip
        stop_after = ev.dropped_at if not delivered else None
        blocked_here = False
        for nid in path:
            hop_no += 1
            node = self.graph.node(nid)
            ref_net = ipaddress.IPv4Interface(f"{reference}/24").network
            shown = next((i.ip for i in node.interfaces if i.ip and ipaddress.IPv4Address(i.ip) in ref_net), None) or next((i.ip for i in node.interfaces if i.ip), nid)
            reference = shown
            if blocked_here:
                lines.append(f"{hop_no:>3}     *        *        *     Request timed out.")
                continue
            lines.append(f"{hop_no:>3}    <1 ms    <1 ms    <1 ms  {shown}  [{nid}]")
            if stop_after == nid:
                blocked_here = True
        if not delivered:
            hop_no += 1
            lines.append(f"{hop_no:>3}     *        *        *     Request timed out.")
        else:
            hop_no += 1
            lines.append(f"{hop_no:>3}    <1 ms    <1 ms    <1 ms  {ip}  [{target_node}]")
            lines += ["", "Trace complete."]
        decision: dict[str, Any] = {"delivered": delivered}
        if not delivered:
            reason_lines, device = _explain(engine, ev, node_id)
            lines += ["", "Trace stopped."] + reason_lines
            decision.update(enforcing_device=device, drop_reason=ev.reason, rule_id=ev.rule_id)
        return CliResult(lines, ok=delivered, run=run, decision=decision, timeline=_timed(lines, run))

    def _connect(self, node_id: str, target: str, port: int, command: str, kind: str) -> CliResult:
        ip, target_node = _resolve(self.graph, target)
        _, me = _iface(self.graph, node_id)
        if target_node == node_id:
            raise CliError("Open a connection to another device.")
        flow = TcpSessionSpec(type="tcp_session", id="cli-tcp", src=node_id, dst=target_node, dport=port, start=0.0, request_bytes=120)
        run, engine = self._run(node_id, command, flow)
        ev = run.events
        created = {e["pid"]: e for e in ev if e["type"] == "packet.created" and e["mirror_of"] is None}
        syn = next((p for p, e in created.items() if e["src"] == me.ip and e["flags"] == ["SYN"]), None)
        answered = [e for e in ev if e["type"] == "packet.delivered" and created.get(e["pid"], {}).get("dst") == me.ip and created[e["pid"]]["src"] == ip]
        opened = any("SYN" in created[e["pid"]]["flags"] and "ACK" in created[e["pid"]]["flags"] for e in answered)
        refused = any("RST" in created[e["pid"]]["flags"] for e in answered)
        service = next((s for s in self.graph.node(target_node).services if s.proto == "tcp" and s.port == port), None)
        decision: dict[str, Any] = {"delivered": opened}
        head = f"Connecting to {ip}:{port}..." if kind == "telnet" else f"curl http://{ip}:{port}/ (simulated)"
        if opened:
            if kind == "telnet":
                lines = [head, "", f"Connected to {ip}:{port}. Service: {service.name if service else 'unknown'} (simulated).", "Connection closed by foreign host."]
            elif service and service.name.upper().startswith("HTTP"):
                lines = [head, "", "HTTP/1.1 200 OK (simulated)", f"Server: {target_node}", f"Content-Length: {service.response_bytes}", "", f"<simulated page served by {target_node}; no real content>"]
            else:
                lines = [head, "", f"Connected, but {target_node}:{port} is {service.name if service else 'a service'}, not a web server (simulated)."]
            return CliResult(lines, run=run, decision=decision, timeline=_timed(lines, run))
        if refused:
            decision["drop_reason"] = "port_closed"
            ips_reject = next((e for e in ev if e["type"] == "ips.action" and e.get("action") == "reject" and e.get("pid") == syn), None)
            if ips_reject is not None:
                decision.update(enforcing_device="IPS-1", drop_reason="ips_reject")
                lines = [head, "", "Connection reset." if kind == "telnet" else f"curl: (56) Recv failure: Connection reset by peer", "", f"Reason: IPS-1 rejected the connection ({ips_reject['rule']}): it sent a reset on behalf of {target_node}.", "Enforcing device: IPS-1."]
            else:
                lines = [head, "", "Connection refused." if kind == "telnet" else f"curl: (7) Failed to connect to {ip} port {port}: Connection refused", "", f"Reason: {target_node} is reachable but nothing listens on tcp/{port}."]
            return CliResult(lines, ok=False, run=run, decision=decision, timeline=_timed(lines, run))
        evidence = _evidence(ev, syn) if syn is not None else Evidence()
        reason_lines, device = _explain(engine, evidence, node_id)
        decision.update(enforcing_device=device, drop_reason=evidence.reason, rule_id=evidence.rule_id)
        timeout = "Connection timed out." if kind == "telnet" else f"curl: (28) Failed to connect to {ip} port {port}: Connection timed out"
        all_lines = [head, "", timeout, ""] + reason_lines
        return CliResult(all_lines, ok=False, run=run, decision=decision, timeline=_timed(all_lines, run))
