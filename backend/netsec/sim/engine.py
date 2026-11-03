"""Deterministic simulation engine (Stage 1: forwarding, SPAN mirroring, host responses).

The engine decides what happens to every packet and writes the result into a trace. The
frontend only replays that trace. Stage 1 has no firewall policy, IDS detection or IPS
enforcement: IPS-1 forwards transparently and the mirror copies simply arrive at IDS-1.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, replace
from typing import Optional, Sequence

from netsec.analysis.stats import compute_stats
from netsec.network.forwarding import DEFAULT_TTL, Hop, RoutePlan, compute_route
from netsec.network.routing import RouteTable, build_route_tables
from netsec.network.topology import TopologyGraph
from netsec.sim.events import IpsMode, RunStats, TraceEvent
from netsec.sim.scheduler import Priority, Scheduler, to_seconds, to_us
from netsec.sim.timing import link_transit_us, node_delay_us
from netsec.security.config import (
    DetectorsConfig,
    IpsPolicyConfig,
    load_detectors,
    load_ips_policy,
)
from netsec.security.correlation import Correlator
from netsec.security.detection.base import ObservedPacket
from netsec.security.detection.engine import AlertRecord, DetectionEngine
from netsec.security.policy.engine import FlowKey, PolicyEvaluator
from netsec.security.policy.models import PolicyFile, load_policies
from netsec.security.prevention.block_table import Block
from netsec.security.prevention.ips import IpsEngine
from netsec.sim.trace import TraceRecorder, canonical_json, trace_digest
from netsec.sim.controls import ControlSpec, DetectorControl, IpsModeControl
from netsec.traffic.flows import FlagProbeFlow, IcmpEchoFlow, PortScanFlow, SynFloodFlow, TcpSessionFlow
from netsec.traffic.host_stack import HostStack
from netsec.traffic.packet import IP_TCP_HEADER_BYTES, Packet, PacketSpec, tcp_flags
from netsec.traffic.scenarios import (
    FlagProbeSpec,
    FlowSpec,
    IcmpEchoSpec,
    PortScanSpec,
    ScenarioSpec,
    SynFloodSpec,
    TcpSessionSpec,
)


class EngineError(Exception):
    """The scenario cannot be simulated (bad host reference, overruns its duration, ...)."""


@dataclass(frozen=True)
class RunResult:
    """Everything a client needs to replay a run."""

    run_id: str
    scenario_id: str
    seed: int
    ips_mode: IpsMode
    duration: float
    config_hash: str
    trace_hash: str
    events: list[TraceEvent]
    stats: RunStats


class Engine:
    """Runs one scenario on one topology. Create a new Engine per run."""

    def __init__(
        self,
        graph: TopologyGraph,
        seed: int,
        ips_mode: IpsMode = "monitor",
        *,
        detectors: Optional[DetectorsConfig] = None,
        ips_policy: Optional[IpsPolicyConfig] = None,
        policies: Optional[list[PolicyFile]] = None,
    ) -> None:
        self.graph = graph
        self.seed = seed
        self.ips_mode = ips_mode
        self.detectors_config = detectors or load_detectors()
        self.ips_policy_config = ips_policy or load_ips_policy()
        self.policy_files = policies if policies is not None else load_policies()
        # Security components. IDS-1 only observes; only IPS-1 can enforce on a detection.
        self.correlator = Correlator()
        self.policies = PolicyEvaluator(self.policy_files)
        self.ids = DetectionEngine("IDS-1", self.detectors_config, self.correlator)
        self.ips = IpsEngine(ips_mode, self.detectors_config, self.ips_policy_config, self.correlator)
        self._duration_us = 0
        self.tables: dict[str, RouteTable] = build_route_tables(graph)
        self.rng = random.Random(seed)
        self.scheduler = Scheduler()
        self.trace = TraceRecorder()
        self._next_pid = 1
        self._stacks: dict[str, HostStack] = {}
        for node in graph.hosts():
            ip = next((i.ip for i in node.interfaces if i.ip is not None), None)
            if ip is not None:
                self._stacks[node.id] = HostStack(node, ip, self.rng)

    # -- running -------------------------------------------------------------------------

    def run(
        self,
        scenario: ScenarioSpec,
        controls: Sequence[ControlSpec] = (),
        custom_flows: Sequence[FlowSpec] = (),
    ) -> RunResult:
        """Simulate ``scenario`` to completion and return the finished trace.

        ``controls`` change configuration at a given time. They are deliberately left out of
        ``config_hash`` and ``run.meta`` so that everything before a control is identical to the run without it.

        ``custom_flows`` are extra traffic injected by the user (the Send traffic form). They are left out of
        ``config_hash`` for the same reason, and each draws its ports and sequence numbers from a random stream of
        its own, so adding one never shifts anything that happens before it starts. A run with custom traffic may
        last longer than the scenario declares: ``run.end`` then falls when the last packet has settled.
        """
        config_json = canonical_json(
            {
                "topology": self.graph.topology.model_dump(mode="json"),
                "scenario": scenario.model_dump(mode="json"),
                "seed": self.seed,
                "ips_mode": self.ips_mode,
                "detectors": self.detectors_config.model_dump(mode="json"),
                "ips_policy": self.ips_policy_config.model_dump(mode="json"),
                "policies": [f.model_dump(mode="json") for f in self.policy_files],
            }
        )
        config_hash = hashlib.sha256(config_json.encode("utf-8")).hexdigest()[:16]
        run_id = f"run-{config_hash[:12]}"

        self.trace.emit(
            "run.meta",
            0,
            run_id=run_id,
            scenario_id=scenario.id,
            seed=self.seed,
            ips_mode=self.ips_mode,
            duration=scenario.duration,
            config_hash=config_hash,
        )
        self._duration_us = to_us(scenario.duration)
        for flow_spec in scenario.flows:
            self._start_flow(flow_spec)
        scenario_ids = {f.id for f in scenario.flows}
        for flow_spec in custom_flows:
            if flow_spec.id in scenario_ids:
                raise EngineError(f"custom flow id {flow_spec.id!r} is already used by scenario {scenario.id}")
            scenario_ids.add(flow_spec.id)
            if flow_spec.src == flow_spec.dst:
                raise EngineError(f"custom flow {flow_spec.id!r} has the same source and destination")
            self._start_flow(flow_spec, rng=random.Random(f"{self.seed}:{flow_spec.id}"))
        for control in controls:
            if scenario.pinned_ips_mode is not None and isinstance(control, IpsModeControl):
                raise EngineError(f"scenario {scenario.id} pins the IPS mode, so it cannot be switched")
            self.scheduler.schedule(to_us(control.t), Priority.CONTROL, lambda now, c=control: self._apply_control(now, c))
        self.scheduler.run()

        end_us = to_us(scenario.duration)
        if custom_flows:
            end_us = max(end_us, self.scheduler.now_us)
        if self.scheduler.now_us > end_us:
            raise EngineError(
                f"scenario {scenario.id} needs {to_seconds(self.scheduler.now_us)}s "
                f"but declares duration {scenario.duration}s"
            )
        stats = compute_stats(self.trace.events)
        self.trace.emit("run.end", end_us, stats=stats)
        return RunResult(
            run_id=run_id,
            scenario_id=scenario.id,
            seed=self.seed,
            ips_mode=self.ips_mode,
            duration=to_seconds(end_us),
            config_hash=config_hash,
            trace_hash=trace_digest(self.trace.events),
            events=self.trace.events,
            stats=stats,
        )

    # -- flows ---------------------------------------------------------------------------

    def _host_ip(self, node_id: str) -> str:
        stack = self._stacks.get(node_id)
        if stack is None:
            raise EngineError(f"{node_id!r} is not a host that can send or receive traffic")
        return stack.ip

    def _start_flow(self, spec: FlowSpec, rng: Optional[random.Random] = None) -> None:
        rng = rng or self.rng
        src_ip = self._host_ip(spec.src)
        dst_ip = self._host_ip(spec.dst)
        if isinstance(spec, TcpSessionSpec):
            service = next(
                (s for s in self.graph.node(spec.dst).services
                 if s.proto == "tcp" and s.port == spec.dport),
                None,
            )
            flow: TcpSessionFlow | IcmpEchoFlow | PortScanFlow | FlagProbeFlow | SynFloodFlow = TcpSessionFlow(
                flow_id=spec.id,
                src_ip=src_ip,
                dst_ip=dst_ip,
                dport=spec.dport,
                service=service,
                request_bytes=spec.request_bytes,
                sport=49152 + rng.randrange(16384),
                isn=rng.getrandbits(31),
            )
        elif isinstance(spec, SynFloodSpec):
            try:
                flow = SynFloodFlow(
                    flow_id=spec.id,
                    src_ip=src_ip,
                    dst_ip=dst_ip,
                    dport=spec.dport,
                    phases=[(p.rate, p.duration) for p in spec.phases],
                    sport_base=10000 + rng.randrange(20000),
                    isn=rng.getrandbits(31),
                )
            except ValueError as exc:
                raise EngineError(str(exc)) from exc
        elif isinstance(spec, FlagProbeSpec):
            flow = FlagProbeFlow(
                flow_id=spec.id,
                src_ip=src_ip,
                dst_ip=dst_ip,
                dport=spec.dport,
                flags=tcp_flags(*spec.flags),
                count=spec.count,
                interval=spec.interval,
                sport=49152 + rng.randrange(16384),
                isn=rng.getrandbits(31),
            )
        elif isinstance(spec, PortScanSpec):
            flow = PortScanFlow(
                flow_id=spec.id,
                src_ip=src_ip,
                dst_ip=dst_ip,
                ports=spec.ports,
                rate=spec.rate,
                sport=49152 + rng.randrange(16384),
                isn=rng.getrandbits(31),
            )
        else:
            flow = IcmpEchoFlow(
                flow_id=spec.id,
                src_ip=src_ip,
                dst_ip=dst_ip,
                count=spec.count,
                interval=spec.interval,
                payload_bytes=spec.payload_bytes,
                icmp_id=rng.getrandbits(16),
            )
        self._stacks[spec.src].add_flow(flow)
        for offset, packet_spec in flow.initial():
            self._schedule_send(to_us(spec.start + offset), packet_spec)

    def _schedule_send(self, t_us: int, spec: PacketSpec) -> None:
        self.scheduler.schedule(t_us, Priority.SEND, lambda now, s=spec: self._originate(now, s))

    # -- packet lifecycle ----------------------------------------------------------------

    def _new_pid(self) -> int:
        pid = self._next_pid
        self._next_pid += 1
        return pid

    def _emit_created(self, t_us: int, pkt: Packet) -> None:
        self.trace.emit(
            "packet.created",
            t_us,
            pid=pkt.pid,
            flow=pkt.flow,
            proto=pkt.proto,
            src=pkt.src,
            sport=pkt.sport,
            dst=pkt.dst,
            dport=pkt.dport,
            flags=list(pkt.flags),
            ttl=pkt.ttl,
            len=pkt.length,
            icmp=pkt.icmp,
            app=pkt.app,
            mirror_of=pkt.mirror_of,
        )

    def _originate(self, t_us: int, spec: PacketSpec) -> None:
        pkt = Packet(
            pid=self._new_pid(),
            flow=spec.flow,
            proto=spec.proto,
            src=spec.src,
            dst=spec.dst,
            sport=spec.sport,
            dport=spec.dport,
            flags=spec.flags,
            ttl=DEFAULT_TTL,
            length=spec.length,
            seq=spec.seq,
            ack=spec.ack,
            icmp=spec.icmp,
            app=spec.app,
        )
        plan = compute_route(self.graph, self.tables, spec.src, spec.dst, DEFAULT_TTL)
        self._emit_created(t_us, pkt)
        if not plan.hops:
            self.trace.emit(
                "packet.dropped", t_us, pid=pkt.pid, node=plan.terminal_node, reason=plan.outcome
            )
            return
        self._depart(pkt, plan, 0, t_us)

    def _depart(self, pkt: Packet, plan: RoutePlan, index: int, t_us: int) -> None:
        hop = plan.hops[index]
        arrive_us = t_us + link_transit_us(self.graph.link(hop.link_id))
        self.trace.emit(
            "packet.hop",
            t_us,
            pid=pkt.pid,
            link=hop.link_id,
            from_=hop.src,
            to=hop.dst,
            t_arrive=to_seconds(arrive_us),
            vlan=hop.vlan,
            ttl=hop.ttl,
        )
        self.scheduler.schedule(
            arrive_us,
            Priority.ARRIVE,
            lambda now: self._arrive(pkt, plan, index, now),
        )

    def _arrive(self, pkt: Packet, plan: RoutePlan, index: int, t_us: int) -> None:
        hop = plan.hops[index]
        node = self.graph.node(hop.dst)
        self._maybe_mirror(pkt, hop, t_us)

        if pkt.mirror_of is None:
            if self._apply_policy(pkt, hop, node, t_us):
                return
            if node.type == "ips" and self._apply_ips(pkt, node, t_us):
                return
        elif node.type == "ids":
            self._ids_observe(pkt, node, t_us)

        if index + 1 < len(plan.hops):
            self.scheduler.schedule(
                t_us + node_delay_us(node.type),
                Priority.DEPART,
                lambda now: self._depart(pkt, plan, index + 1, now),
            )
            return

        if plan.outcome != "delivered":
            self.trace.emit(
                "packet.dropped", t_us, pid=pkt.pid, node=plan.terminal_node, reason=plan.outcome
            )
            return

        self.trace.emit("packet.delivered", t_us, pid=pkt.pid, node=node.id)
        stack: Optional[HostStack] = self._stacks.get(node.id)
        if stack is not None and pkt.mirror_of is None:
            for reply in stack.handle(pkt):
                self._schedule_send(t_us + to_us(reply.delay_s), reply)

    # -- security ------------------------------------------------------------------------

    @staticmethod
    def _observed(pkt: Packet) -> ObservedPacket:
        """What a sensor can see: headers only, no flow label and no packet id."""
        return ObservedPacket(pkt.proto, pkt.src, pkt.dst, pkt.sport, pkt.dport, pkt.flags, pkt.length)

    def _drop(self, t_us: int, pkt: Packet, node_id: str, reason: str) -> None:
        self.trace.emit("packet.dropped", t_us, pid=pkt.pid, node=node_id, reason=reason)

    def _apply_policy(self, pkt: Packet, hop: Hop, node, t_us: int) -> bool:
        """Firewall / ACL. Returns True if the packet was dropped here. Independent of the IPS mode."""
        policy = self.policies.policy_for(node.id, hop.link_id, hop.vlan)
        if policy is None:
            return False
        flow = FlowKey(pkt.proto, pkt.src, pkt.dst, pkt.sport, pkt.dport, pkt.icmp.id if pkt.icmp else None)
        decision = self.policies.evaluate(policy, flow)
        self.trace.emit(
            "policy.decision",
            t_us,
            pid=pkt.pid,
            node=node.id,
            policy=decision.policy,
            rule_id=f"{decision.policy}:{decision.rule_id}",
            action=decision.action,
            via_conntrack=decision.via_conntrack,
        )
        if decision.action == "permit":
            return False
        self._drop(t_us, pkt, node.id, "fw_deny" if node.type == "firewall" else "acl_deny")
        return True

    def _emit_alert(self, t_us: int, alert: AlertRecord) -> None:
        f = alert.finding
        self.trace.emit(
            "alert.raised",
            t_us,
            alert_id=alert.alert_id,
            incident_id=alert.incident_id,
            sensor=alert.sensor,
            rule=f.rule,
            severity=f.severity,
            src=f.src,
            dst=f.dst,
            proto=f.proto,
            dport=f.dport,
            reason=f.reason,
            evidence={"count": f.count, "window": f.window, "threshold": f.threshold},
        )

    def _ids_observe(self, copy: Packet, node, t_us: int) -> None:
        """IDS-1 inspects a SPAN copy. It records and alerts; it never acts on any packet."""
        observation = self.ids.observe(self._observed(copy), to_seconds(t_us))
        self.trace.emit(
            "inspect.result",
            t_us,
            pid=copy.pid,
            node=node.id,
            classification=observation.classification,
            rules=observation.rules,
        )
        for alert in observation.alerts:
            self._emit_alert(t_us, alert)

    def _apply_ips(self, pkt: Packet, node, t_us: int) -> bool:
        """IPS-1 inline. Returns True if the packet was dropped here."""
        outcome = self.ips.process(self._observed(pkt), to_seconds(t_us))
        if not outcome.from_block_table:
            self.trace.emit(
                "inspect.result",
                t_us,
                pid=pkt.pid,
                node=node.id,
                classification=outcome.observation.classification,
                rules=outcome.observation.rules,
            )
            for alert in outcome.observation.alerts:
                self._emit_alert(t_us, alert)
        if outcome.action is not None:
            self.trace.emit(
                "ips.action",
                t_us,
                pid=pkt.pid,
                action=outcome.action,
                mode=self.ips.mode,
                applied=outcome.applied,
                rule=outcome.rule,
            )
        if outcome.new_block is not None:
            self._announce_block(outcome.new_block, t_us)
        if outcome.drop_reason is not None:
            self._drop(t_us, pkt, node.id, outcome.drop_reason)
            if outcome.drop_reason == "ips_reject":
                self._inject_reset(pkt, node, t_us)
            return True
        return False

    def _announce_block(self, block: Block, t_us: int) -> None:
        self.trace.emit(
            "block.added", t_us, src=block.src, until=block.until, rule=block.rule, incident_id=block.incident_id
        )
        until_us = to_us(block.until)
        if until_us <= self._duration_us:  # a block outlasting the run simply never expires in the trace
            self.scheduler.schedule(until_us, Priority.EXPIRY, lambda now, b=block: self._expire_block(b, now))

    def _expire_block(self, block: Block, t_us: int) -> None:
        if self.ips.expire(block.src, block.until):  # a block lifted earlier by a control already expired
            self.trace.emit("block.expired", t_us, src=block.src)

    def _apply_control(self, t_us: int, control: ControlSpec) -> None:
        if isinstance(control, IpsModeControl):
            for block in self.ips.set_mode(control.mode):
                self.trace.emit("block.expired", t_us, src=block.src)
        elif isinstance(control, DetectorControl):
            self.ids.set_enabled(control.detector, control.enabled)
            self.ips.detection.set_enabled(control.detector, control.enabled)

    def _inject_reset(self, pkt: Packet, node, t_us: int) -> None:
        """IPS-1 rejects a TCP connection attempt: it sends the client a RST that looks like it came from the server.

        The RST is a synthetic packet that starts at the IPS and travels the reverse path to the client.
        Nothing real is sent. The rejected packet itself was already dropped by the caller.
        """
        if pkt.proto != "tcp" or "RST" in pkt.flags:
            return
        full = compute_route(self.graph, self.tables, pkt.dst, pkt.src, DEFAULT_TTL)
        start = next((i for i, h in enumerate(full.hops) if h.src == node.id), None)
        if start is None or full.outcome != "delivered":
            return
        plan = RoutePlan(
            origin=node.id,
            hops=full.hops[start:],
            outcome=full.outcome,
            terminal_node=full.terminal_node,
            l3_nodes=full.l3_nodes,
        )
        rst = Packet(
            pid=self._new_pid(),
            flow=f"{pkt.flow}:rst",
            proto="tcp",
            src=pkt.dst,
            dst=pkt.src,
            sport=pkt.dport,
            dport=pkt.sport,
            flags=tcp_flags("RST", "ACK"),
            ttl=DEFAULT_TTL,
            length=IP_TCP_HEADER_BYTES,
            seq=0,
            ack=pkt.seq + max(pkt.payload_bytes, 1),
            icmp=None,
            app=None,
        )
        self._emit_created(t_us, rst)
        self._depart(rst, plan, 0, t_us)

    def _maybe_mirror(self, pkt: Packet, hop: Hop, t_us: int) -> None:
        """Ingress SPAN: copy every packet entering the SPAN node (except excluded VLANs).

        The copy goes to the sensor over the SPAN link and is delivered there. It never
        continues anywhere, so the sensor cannot influence the original packet.
        """
        span = self.graph.topology.span
        if hop.dst != span.node or pkt.mirror_of is not None:
            return
        if hop.vlan is not None and hop.vlan in span.exclude_vlans:
            return
        copy = replace(pkt, pid=self._new_pid(), mirror_of=pkt.pid, ttl=hop.ttl)
        self.trace.emit(
            "packet.mirrored", t_us, pid=pkt.pid, copy_pid=copy.pid, at=span.node, to=span.sensor
        )
        self._emit_created(t_us, copy)
        plan = RoutePlan(
            origin=span.node,
            hops=(Hop(span.destination_link, span.node, span.sensor, None, hop.ttl),),
            outcome="delivered",
            terminal_node=span.sensor,
        )
        self._depart(copy, plan, 0, t_us)


def run_scenario(
    graph: TopologyGraph,
    scenario: ScenarioSpec,
    seed: Optional[int] = None,
    ips_mode: IpsMode = "monitor",
    controls: Sequence[ControlSpec] = (),
    custom_flows: Sequence[FlowSpec] = (),
) -> RunResult:
    """Convenience wrapper: run ``scenario`` with ``seed`` (default: the scenario's own).

    A scenario that pins its IPS mode (S5 Monitor, S6 Enforce) overrides ``ips_mode``.
    """
    mode = scenario.pinned_ips_mode or ips_mode
    return Engine(graph, scenario.default_seed if seed is None else seed, mode).run(scenario, controls, custom_flows)
