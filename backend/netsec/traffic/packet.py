"""Synthetic packet model.

Packets here are simulation objects only. They are never sent on a real network.
(Scapy is used later purely as a codec to render them as wire-format bytes.)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from netsec.sim.events import AppInfo, IcmpInfo

TCP_FLAG_ORDER = ("SYN", "ACK", "FIN", "RST", "PSH", "URG")

IP_TCP_HEADER_BYTES = 40
IP_TCP_SYN_BYTES = 44  # SYN segments carry an MSS option
IP_UDP_HEADER_BYTES = 28
IP_ICMP_HEADER_BYTES = 28


def tcp_flags(*flags: str) -> tuple[str, ...]:
    """Return ``flags`` in canonical order, rejecting unknown names."""
    unknown = set(flags) - set(TCP_FLAG_ORDER)
    if unknown:
        raise ValueError(f"unknown TCP flags: {sorted(unknown)}")
    return tuple(f for f in TCP_FLAG_ORDER if f in flags)


@dataclass(frozen=True)
class PacketSpec:
    """A packet a host wants to send. The engine assigns ``pid`` and the initial TTL."""

    flow: str
    proto: str
    src: str
    dst: str
    sport: Optional[int]
    dport: Optional[int]
    flags: tuple[str, ...] = ()
    length: int = IP_TCP_HEADER_BYTES
    seq: int = 0
    ack: int = 0
    icmp: Optional[IcmpInfo] = None
    app: Optional[AppInfo] = None
    delay_s: float = 0.0  # delay between the triggering event and transmission


@dataclass(frozen=True)
class Packet:
    """A packet in flight. ``mirror_of`` is set for SPAN copies delivered to the IDS."""

    pid: int
    flow: str
    proto: str
    src: str
    dst: str
    sport: Optional[int]
    dport: Optional[int]
    flags: tuple[str, ...]
    ttl: int
    length: int
    seq: int
    ack: int
    icmp: Optional[IcmpInfo]
    app: Optional[AppInfo]
    mirror_of: Optional[int] = None

    @property
    def payload_bytes(self) -> int:
        """Bytes beyond the IP + TCP header (zero for control segments)."""
        if self.proto != "tcp":
            return 0
        return max(0, self.length - IP_TCP_HEADER_BYTES)
