"""D4: restricted service.

Input: any TCP packet addressed to a restricted service (for example MySQL on DB-SRV).
Condition: the packet's source is not one of the sources allowed to use that service.
Severity: HIGH (malicious). The decision needs no history, so it fires on the first packet.

False positives: a legitimate client missing from the allowed list (fix the list). Limits: it only
knows the services it is told about, and it cannot see traffic that never reaches the sensor.
"""

from __future__ import annotations

from ipaddress import IPv4Address, IPv4Network
from typing import Optional

from netsec.security.config import D4Config
from netsec.security.detection.base import Finding, ObservedPacket


class RestrictedServiceDetector:
    rule = "D4"

    def __init__(self, config: D4Config) -> None:
        self.config = config
        self.enabled = config.enabled
        self.suppression_s = config.suppression_s

    def observe(self, packet: ObservedPacket, now: float) -> Optional[Finding]:
        if not self.enabled or packet.proto != "tcp" or packet.dport is None:
            return None
        source = IPv4Address(packet.src)
        for service in self.config.services:
            if packet.dst != service.dst or packet.dport != service.dport:
                continue
            if any(source in IPv4Network(allowed, strict=False) for allowed in service.allowed_sources):
                return None
            return Finding(
                rule=self.rule,
                severity="high",
                classification="malicious",
                src=packet.src,
                dst=packet.dst,
                proto="tcp",
                dport=packet.dport,
                reason=f"{service.name} ({service.dst}:{service.dport}) used by {packet.src}, which is not allowed to",
                count=1,
                window=0.0,
                threshold=1,
            )
        return None
