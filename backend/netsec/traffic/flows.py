"""Scripted client flows: a TCP session and an ICMP echo series."""

from __future__ import annotations

from typing import Optional

from netsec.network.models import Service
from netsec.sim.events import IcmpInfo
from netsec.sim.timing import CLIENT_CLOSE_S, CLIENT_THINK_S, HOST_PROCESSING_S
from netsec.traffic.host_stack import ICMP_ECHO_REPLY, ICMP_ECHO_REQUEST, app_label
from netsec.traffic.packet import (
    IP_ICMP_HEADER_BYTES,
    IP_TCP_HEADER_BYTES,
    IP_TCP_SYN_BYTES,
    Packet,
    PacketSpec,
    tcp_flags,
)


class TcpSessionFlow:
    """SYN, SYN-ACK, ACK, one request, one response, FIN, FIN-ACK, ACK.

    The server side is the destination's :class:`HostStack`; this class is the client.
    If the destination port is closed the server answers RST-ACK and the flow ends.
    """

    def __init__(
        self,
        flow_id: str,
        src_ip: str,
        dst_ip: str,
        dport: int,
        service: Optional[Service],
        request_bytes: int,
        sport: int,
        isn: int,
    ) -> None:
        self.flow_id = flow_id
        self.src_ip = src_ip
        self.dst_ip = dst_ip
        self.dport = dport
        self.service = service
        self.request_bytes = request_bytes
        self.sport = sport
        self._isn = isn
        self._snd_nxt = isn
        self._rcv_nxt = 0
        self.state = "new"  # new -> syn_sent -> established -> fin_wait -> closed

    def initial(self) -> list[tuple[float, PacketSpec]]:
        """Packets to send at flow start, as ``(offset_seconds, spec)``."""
        self.state = "syn_sent"
        syn = self._spec(tcp_flags("SYN"), IP_TCP_SYN_BYTES, seq=self._isn, ack=0)
        self._snd_nxt = self._isn + 1
        return [(0.0, syn)]

    def matches(self, pkt: Packet) -> bool:
        return (
            pkt.proto == "tcp"
            and pkt.src == self.dst_ip
            and pkt.sport == self.dport
            and pkt.dport == self.sport
        )

    def on_packet(self, pkt: Packet) -> list[PacketSpec]:
        flags = set(pkt.flags)
        if "RST" in flags:
            self.state = "closed"
            return []

        if self.state == "syn_sent" and flags == {"SYN", "ACK"}:
            self._rcv_nxt = pkt.seq + 1
            self.state = "established"
            ack = self._spec(
                tcp_flags("ACK"), IP_TCP_HEADER_BYTES, self._snd_nxt, self._rcv_nxt,
                delay_s=HOST_PROCESSING_S,
            )
            request = self._spec(
                tcp_flags("PSH", "ACK"),
                IP_TCP_HEADER_BYTES + self.request_bytes,
                self._snd_nxt,
                self._rcv_nxt,
                delay_s=HOST_PROCESSING_S + CLIENT_THINK_S,
                app=app_label(self.service, "request") if self.service else None,
            )
            self._snd_nxt += self.request_bytes
            return [ack, request]

        if self.state == "established" and "PSH" in flags:
            self._rcv_nxt = pkt.seq + pkt.payload_bytes
            self.state = "fin_wait"
            fin = self._spec(
                tcp_flags("FIN", "ACK"), IP_TCP_HEADER_BYTES, self._snd_nxt, self._rcv_nxt,
                delay_s=CLIENT_CLOSE_S,
            )
            self._snd_nxt += 1
            return [fin]

        if self.state == "fin_wait" and "FIN" in flags:
            self._rcv_nxt = pkt.seq + 1
            self.state = "closed"
            return [
                self._spec(
                    tcp_flags("ACK"), IP_TCP_HEADER_BYTES, self._snd_nxt, self._rcv_nxt,
                    delay_s=HOST_PROCESSING_S,
                )
            ]
        return []

    def _spec(
        self,
        flags: tuple[str, ...],
        length: int,
        seq: int,
        ack: int,
        delay_s: float = 0.0,
        app=None,
    ) -> PacketSpec:
        return PacketSpec(
            flow=self.flow_id,
            proto="tcp",
            src=self.src_ip,
            dst=self.dst_ip,
            sport=self.sport,
            dport=self.dport,
            flags=flags,
            length=length,
            seq=seq,
            ack=ack,
            app=app,
            delay_s=delay_s,
        )


class IcmpEchoFlow:
    """``count`` echo requests, ``interval`` seconds apart. Replies come from the server stack."""

    def __init__(
        self,
        flow_id: str,
        src_ip: str,
        dst_ip: str,
        count: int,
        interval: float,
        payload_bytes: int,
        icmp_id: int,
    ) -> None:
        self.flow_id = flow_id
        self.src_ip = src_ip
        self.dst_ip = dst_ip
        self.count = count
        self.interval = interval
        self.payload_bytes = payload_bytes
        self.icmp_id = icmp_id
        self.replies = 0

    def initial(self) -> list[tuple[float, PacketSpec]]:
        return [
            (
                i * self.interval,
                PacketSpec(
                    flow=self.flow_id,
                    proto="icmp",
                    src=self.src_ip,
                    dst=self.dst_ip,
                    sport=None,
                    dport=None,
                    length=IP_ICMP_HEADER_BYTES + self.payload_bytes,
                    icmp=IcmpInfo(type=ICMP_ECHO_REQUEST, code=0, id=self.icmp_id, seq=i + 1),
                ),
            )
            for i in range(self.count)
        ]

    def matches(self, pkt: Packet) -> bool:
        return (
            pkt.proto == "icmp"
            and pkt.src == self.dst_ip
            and pkt.icmp is not None
            and pkt.icmp.type == ICMP_ECHO_REPLY
            and pkt.icmp.id == self.icmp_id
        )

    def on_packet(self, pkt: Packet) -> list[PacketSpec]:
        self.replies += 1
        return []


class FlagProbeFlow:
    """Raw TCP segments with fixed flags. Whatever the server answers is ignored."""

    def __init__(
        self,
        flow_id: str,
        src_ip: str,
        dst_ip: str,
        dport: int,
        flags: tuple[str, ...],
        count: int,
        interval: float,
        sport: int,
        isn: int,
    ) -> None:
        self.flow_id = flow_id
        self.src_ip = src_ip
        self.dst_ip = dst_ip
        self.dport = dport
        self.flags = flags
        self.count = count
        self.interval = interval
        self.sport = sport
        self._isn = isn

    def initial(self) -> list[tuple[float, PacketSpec]]:
        return [
            (
                i * self.interval,
                PacketSpec(
                    flow=self.flow_id,
                    proto="tcp",
                    src=self.src_ip,
                    dst=self.dst_ip,
                    sport=self.sport,
                    dport=self.dport,
                    flags=self.flags,
                    length=IP_TCP_HEADER_BYTES,
                    seq=self._isn + i,
                ),
            )
            for i in range(self.count)
        ]

    def matches(self, pkt: Packet) -> bool:
        return pkt.proto == "tcp" and pkt.src == self.dst_ip and pkt.dport == self.sport

    def on_packet(self, pkt: Packet) -> list[PacketSpec]:
        return []


class SynFloodFlow:
    """A SYN flood. Every probe uses a new source port; the attacker ignores whatever the server answers."""

    MAX_PACKETS = 3000

    def __init__(
        self,
        flow_id: str,
        src_ip: str,
        dst_ip: str,
        dport: int,
        phases: list[tuple[float, float]],
        sport_base: int,
        isn: int,
    ) -> None:
        self.flow_id = flow_id
        self.src_ip = src_ip
        self.dst_ip = dst_ip
        self.dport = dport
        self.phases = phases
        self.sport_base = sport_base
        self._isn = isn
        total = sum(round(rate * duration) for rate, duration in phases)
        if total > self.MAX_PACKETS:
            raise ValueError(f"a flood of {total} packets is too large for the simulation (limit {self.MAX_PACKETS})")

    def initial(self) -> list[tuple[float, PacketSpec]]:
        out: list[tuple[float, PacketSpec]] = []
        offset = 0.0
        index = 0
        for rate, duration in self.phases:
            for k in range(round(rate * duration)):
                out.append(
                    (
                        round(offset + k / rate, 6),
                        PacketSpec(
                            flow=self.flow_id,
                            proto="tcp",
                            src=self.src_ip,
                            dst=self.dst_ip,
                            sport=self.sport_base + index,
                            dport=self.dport,
                            flags=tcp_flags("SYN"),
                            length=IP_TCP_SYN_BYTES,
                            seq=self._isn + index,
                        ),
                    )
                )
                index += 1
            offset += duration
        return out

    def matches(self, pkt: Packet) -> bool:
        return pkt.proto == "tcp" and pkt.src == self.dst_ip and pkt.sport == self.dport and pkt.dport >= self.sport_base

    def on_packet(self, pkt: Packet) -> list[PacketSpec]:
        return []  # the SYN-ACKs are ignored, so the server's half-open connections just sit there


class PortScanFlow:
    """A SYN scan. Open ports answer SYN-ACK and the scanner resets them (half-open scan);
    closed ports answer RST-ACK. The scanner knows nothing the replies do not tell it."""

    def __init__(
        self,
        flow_id: str,
        src_ip: str,
        dst_ip: str,
        ports: list[int],
        rate: float,
        sport: int,
        isn: int,
    ) -> None:
        self.flow_id = flow_id
        self.src_ip = src_ip
        self.dst_ip = dst_ip
        self.ports = ports
        self.rate = rate
        self.sport = sport
        self._isn = isn
        self.open_ports: list[int] = []

    def initial(self) -> list[tuple[float, PacketSpec]]:
        return [
            (
                i / self.rate,
                PacketSpec(
                    flow=self.flow_id,
                    proto="tcp",
                    src=self.src_ip,
                    dst=self.dst_ip,
                    sport=self.sport,
                    dport=port,
                    flags=tcp_flags("SYN"),
                    length=IP_TCP_SYN_BYTES,
                    seq=self._isn + i,
                ),
            )
            for i, port in enumerate(self.ports)
        ]

    def matches(self, pkt: Packet) -> bool:
        return pkt.proto == "tcp" and pkt.src == self.dst_ip and pkt.dport == self.sport and pkt.sport in self.ports

    def on_packet(self, pkt: Packet) -> list[PacketSpec]:
        if set(pkt.flags) != {"SYN", "ACK"}:
            return []  # RST-ACK: the port is closed
        self.open_ports.append(pkt.sport)
        return [
            PacketSpec(
                flow=self.flow_id,
                proto="tcp",
                src=self.src_ip,
                dst=self.dst_ip,
                sport=self.sport,
                dport=pkt.sport,
                flags=tcp_flags("RST"),
                length=IP_TCP_HEADER_BYTES,
                seq=pkt.ack,
                delay_s=HOST_PROCESSING_S,
            )
        ]
