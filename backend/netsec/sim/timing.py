"""Visual time dilation (Rev 3, Demo pacing).

Real propagation takes microseconds, which cannot be watched. The simulation runs on a
dilated clock so a packet crossing one cable takes a fraction of a second. These
constants are visual pacing only, not a latency model, and the UI says so.
"""

from __future__ import annotations

from netsec.network.models import Link
from netsec.sim.scheduler import to_us

LINK_TRANSIT_S = 0.35
SPAN_LINK_TRANSIT_S = 0.25

NODE_DELAY_S: dict[str, float] = {
    "host": 0.0,
    "syslog": 0.0,
    "ids": 0.0,
    "segment": 0.05,
    "l2switch": 0.05,
    "router": 0.08,
    "l3switch": 0.08,
    "firewall": 0.15,
    "ips": 0.30,
}

HOST_PROCESSING_S = 0.02
CLIENT_THINK_S = 0.10
CLIENT_CLOSE_S = 0.20


def link_transit_us(link: Link) -> int:
    """Dilated time for a frame to cross ``link``."""
    return to_us(SPAN_LINK_TRANSIT_S if link.kind == "span" else LINK_TRANSIT_S)


def node_delay_us(node_type: str) -> int:
    """Dilated processing time a node of ``node_type`` adds before forwarding."""
    return to_us(NODE_DELAY_S[node_type])
