"""Minimal synthetic host network stack.

Servers answer like a real stack would: SYN to an open port gets SYN-ACK, SYN to a closed
port gets RST-ACK, ICMP echo gets an echo reply, UDP to a closed port gets ICMP
port-unreachable. Clients drive scripted flows (see ``flows.py``). Nothing here touches the
real network.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Protocol

from netsec.network.models import Node, Service
from netsec.sim.events import AppInfo, IcmpInfo
from netsec.sim.timing import HOST_PROCESSING_S
from netsec.traffic.packet import (
    IP_ICMP_HEADER_BYTES,
    IP_TCP_HEADER_BYTES,
    IP_TCP_SYN_BYTES,
    Packet,
    PacketSpec,
    tcp_flags,
)

ICMP_ECHO_REPLY = 0
ICMP_DEST_UNREACHABLE = 3
ICMP_ECHO_REQUEST = 8
ICMP_PORT_UNREACHABLE = 3  # code under type 3


def app_label(service: Service, direction: str) -> AppInfo:
    """Application label for a service. Encrypted services expose no payload detail."""
    summary = "Encrypted application data" if service.encrypted else f"{service.name} {direction}"
    return AppInfo(proto=service.name, summary=summary, encrypted=service.encrypted)


class ClientFlow(Protocol):
    """A scripted client conversation registered with the sending host."""

    flow_id: str

    def matches(self, pkt: Packet) -> bool: ...

    def on_packet(self, pkt: Packet) -> list[PacketSpec]: ...


@dataclass
class _Connection:
    """Server-side TCP state for one client connection."""

    snd_nxt: int
    rcv_nxt: int
    closing: bool = False


class HostStack:
    """The network stack of one host: server behaviour plus registered client flows."""

    def __init__(self, node: Node, ip: str, rng: random.Random) -> None:
        self.node = node
        self.ip = ip
        self._rng = rng
        self._tcp = {s.port: s for s in node.services if s.proto == "tcp"}
        self._udp = {s.port: s for s in node.services if s.proto == "udp"}
        self._connections: dict[tuple[str, int, int], _Connection] = {}
        self._flows: list[ClientFlow] = []

    def add_flow(self, flow: ClientFlow) -> None:
        self._flows.append(flow)

    def handle(self, pkt: Packet) -> list[PacketSpec]:
        """Process a delivered packet and return the packets this host sends in response."""
        for flow in self._flows:
            if flow.matches(pkt):
                return flow.on_packet(pkt)
        if pkt.proto == "tcp":
            return self._serve_tcp(pkt)
        if pkt.proto == "icmp":
            return self._serve_icmp(pkt)
        return self._serve_udp(pkt)

    # -- server side ---------------------------------------------------------------------

    def _reply(self, pkt: Packet, **fields: object) -> PacketSpec:
        """Build a reply with source and destination swapped."""
        return PacketSpec(
            flow=pkt.flow,
            src=self.ip,
            dst=pkt.src,
            delay_s=HOST_PROCESSING_S,
            **fields,  # type: ignore[arg-type]
        )

    def _serve_tcp(self, pkt: Packet) -> list[PacketSpec]:
        flags = set(pkt.flags)
        service = self._tcp.get(pkt.dport or 0)
        key = (pkt.src, pkt.sport or 0, pkt.dport or 0)

        if flags == {"SYN"}:
            if service is None:
                return [self._rst(pkt, ack=pkt.seq + 1)]
            isn = self._rng.getrandbits(31)
            self._connections[key] = _Connection(snd_nxt=isn + 1, rcv_nxt=pkt.seq + 1)
            return [
                self._reply(
                    pkt,
                    proto="tcp",
                    sport=pkt.dport,
                    dport=pkt.sport,
                    flags=tcp_flags("SYN", "ACK"),
                    length=IP_TCP_SYN_BYTES,
                    seq=isn,
                    ack=pkt.seq + 1,
                )
            ]

        if "RST" in flags:
            self._connections.pop(key, None)
            return []
        connection = self._connections.get(key)
        if connection is None or service is None:
            return [self._rst(pkt, ack=pkt.seq + max(pkt.payload_bytes, 1))]

        if "FIN" in flags:
            connection.rcv_nxt = pkt.seq + pkt.payload_bytes + 1
            reply = self._reply(
                pkt,
                proto="tcp",
                sport=pkt.dport,
                dport=pkt.sport,
                flags=tcp_flags("FIN", "ACK"),
                length=IP_TCP_HEADER_BYTES,
                seq=connection.snd_nxt,
                ack=connection.rcv_nxt,
            )
            connection.snd_nxt += 1
            connection.closing = True
            return [reply]

        if pkt.payload_bytes > 0:
            connection.rcv_nxt = pkt.seq + pkt.payload_bytes
            reply = self._reply(
                pkt,
                proto="tcp",
                sport=pkt.dport,
                dport=pkt.sport,
                flags=tcp_flags("PSH", "ACK"),
                length=IP_TCP_HEADER_BYTES + service.response_bytes,
                seq=connection.snd_nxt,
                ack=connection.rcv_nxt,
                app=app_label(service, "response"),
            )
            connection.snd_nxt += service.response_bytes
            return [reply]

        if connection.closing:  # final ACK of the close handshake
            del self._connections[key]
        return []

    def _rst(self, pkt: Packet, ack: int) -> PacketSpec:
        return self._reply(
            pkt,
            proto="tcp",
            sport=pkt.dport,
            dport=pkt.sport,
            flags=tcp_flags("RST", "ACK"),
            length=IP_TCP_HEADER_BYTES,
            seq=0,
            ack=ack,
        )

    def _serve_icmp(self, pkt: Packet) -> list[PacketSpec]:
        if pkt.icmp is None or pkt.icmp.type != ICMP_ECHO_REQUEST:
            return []
        return [
            self._reply(
                pkt,
                proto="icmp",
                sport=None,
                dport=None,
                length=pkt.length,
                icmp=IcmpInfo(type=ICMP_ECHO_REPLY, code=0, id=pkt.icmp.id, seq=pkt.icmp.seq),
            )
        ]

    def _serve_udp(self, pkt: Packet) -> list[PacketSpec]:
        if (pkt.dport or 0) in self._udp:
            return []  # open UDP port: the datagram is consumed, nothing is sent back
        return [
            self._reply(
                pkt,
                proto="icmp",
                sport=None,
                dport=None,
                length=IP_ICMP_HEADER_BYTES + 28,
                icmp=IcmpInfo(type=ICMP_DEST_UNREACHABLE, code=ICMP_PORT_UNREACHABLE, id=0, seq=0),
            )
        ]
