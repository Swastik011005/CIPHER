"""D5: forbidden zone pair.

Input: any packet. Condition: its source address is in one zone and its destination in another zone
that policy says must never be reached from the first (for example Staff to the Security network).
Severity: HIGH (malicious). Needs no history, so it fires on the first packet.

Note the SPAN copy is taken before the core ACL, so IDS-1 sees such attempts even when the ACL then
denies them. IPS-1 only sees traffic bound for the server VLAN.
"""

from __future__ import annotations

from ipaddress import IPv4Address, IPv4Network
from typing import Optional

from netsec.security.config import D5Config
from netsec.security.detection.base import Finding, ObservedPacket


class ForbiddenZonePairDetector:
    rule = "D5"

    def __init__(self, config: D5Config) -> None:
        self.config = config
        self.enabled = config.enabled
        self.suppression_s = config.suppression_s

    def observe(self, packet: ObservedPacket, now: float) -> Optional[Finding]:
        if not self.enabled:
            return None
        src, dst = IPv4Address(packet.src), IPv4Address(packet.dst)
        for pair in self.config.pairs:
            if src in IPv4Network(pair.src, strict=False) and dst in IPv4Network(pair.dst, strict=False):
                return Finding(
                    rule=self.rule,
                    severity="high",
                    classification="malicious",
                    src=packet.src,
                    dst=packet.dst,
                    proto=packet.proto,
                    dport=packet.dport,
                    reason=f"{pair.name}: {pair.src} may not reach {pair.dst}",
                    count=1,
                    window=0.0,
                    threshold=1,
                )
        return None
