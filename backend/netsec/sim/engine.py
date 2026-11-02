"""Deterministic simulation engine (Stage 1: forwarding, SPAN mirroring, host responses).

The engine decides what happens to every packet and writes the result into a trace. The
frontend only replays that trace. Stage 1 has no firewall policy, IDS detection or IPS
enforcement: IPS-1 forwards transparently and the mirror copies simply arrive at IDS-1.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, replace
from typing import Optional

from netsec.analysis.stats import compute_stats
from netsec.network.forwarding import DEFAULT_TTL, Hop, RoutePlan, compute_route
from netsec.network.routing import RouteTable, build_route_tables
from netsec.network.topology import TopologyGraph
from netsec.sim.events import IpsMode, RunStats, TraceEvent
from netsec.sim.scheduler import Priority, Scheduler, to_seconds, to_us
from netsec.sim.timing import link_transit_us, node_delay_us
from netsec.sim.trace import TraceRecorder, canonical_json, trace_digest
from netsec.traffic.flows import IcmpEchoFlow, TcpSessionFlow
from netsec.traffic.host_stack import HostStack
from netsec.traffic.packet import Packet, PacketSpec
from netsec.traffic.scenarios import IcmpEchoSpec, ScenarioSpec, TcpSessionSpec


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

    def __init__(self, graph: TopologyGraph, seed: int, ips_mode: IpsMode = "monitor") -> None:
        self.graph = graph
        self.seed = seed
        self.ips_mode = ips_mode
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

    def run(self, scenario: ScenarioSpec) -> RunResult:
        """Simulate ``scenario`` to completion and return the finished trace."""
        config_json = canonical_json(
            {
                "topology": self.graph.topology.model_dump(mode="json"),
                "scenario": scenario.model_dump(mode="json"),
                "seed": self.seed,
                "ips_mode": self.ips_mode,
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
        for flow_spec in scenario.flows:
            self._start_flow(flow_spec)
        self.scheduler.run()

        end_us = to_us(scenario.duration)
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
            duration=scenario.duration,
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

    def _start_flow(self, spec: TcpSessionSpec | IcmpEchoSpec) -> None:
        src_ip = self._host_ip(spec.src)
        dst_ip = self._host_ip(spec.dst)
        if isinstance(spec, TcpSessionSpec):
            service = next(
                (s for s in self.graph.node(spec.dst).services
                 if s.proto == "tcp" and s.port == spec.dport),
                None,
            )
            flow: TcpSessionFlow | IcmpEchoFlow = TcpSessionFlow(
                flow_id=spec.id,
                src_ip=src_ip,
                dst_ip=dst_ip,
                dport=spec.dport,
                service=service,
                request_bytes=spec.request_bytes,
                sport=49152 + self.rng.randrange(16384),
                isn=self.rng.getrandbits(31),
            )
        else:
            flow = IcmpEchoFlow(
                flow_id=spec.id,
                src_ip=src_ip,
                dst_ip=dst_ip,
                count=spec.count,
                interval=spec.interval,
                payload_bytes=spec.payload_bytes,
                icmp_id=self.rng.getrandbits(16),
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
) -> RunResult:
    """Convenience wrapper: run ``scenario`` with ``seed`` (default: the scenario's own)."""
    return Engine(graph, scenario.default_seed if seed is None else seed, ips_mode).run(scenario)
