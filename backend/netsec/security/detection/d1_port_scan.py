"""D1: vertical port scan.

Input: TCP segments with SYN set and ACK clear (connection attempts), grouped by (source, target).
Condition: the number of *distinct* destination ports probed inside the sliding window.
Thresholds (configurable): ``suspicious`` -> MEDIUM, ``violation`` -> HIGH.

False positives: legitimate service discovery, monitoring tools and clients that open many ports at
once (an allowlist is the mitigation). Limits: a slow scan spread over more than the window, or a
scan spread across many sources, never reaches the threshold.
"""

from __future__ import annotations

from collections import deque
from typing import Optional

from netsec.security.config import D1Config
from netsec.security.detection.base import Finding, ObservedPacket


class PortScanDetector:
    rule = "D1"

    def __init__(self, config: D1Config) -> None:
        self.config = config
        self.enabled = config.enabled
        self.suppression_s = config.suppression_s
        self._seen: dict[tuple[str, str], deque[tuple[float, int]]] = {}

    @staticmethod
    def _is_connection_attempt(packet: ObservedPacket) -> bool:
        return packet.proto == "tcp" and "SYN" in packet.flags and "ACK" not in packet.flags

    def observe(self, packet: ObservedPacket, now: float) -> Optional[Finding]:
        if not self.enabled or not self._is_connection_attempt(packet) or packet.dport is None:
            return None

        key = (packet.src, packet.dst)
        window = self._seen.setdefault(key, deque())
        window.append((now, packet.dport))
        while window and window[0][0] < now - self.config.window_s:
            window.popleft()

        distinct = len({port for _, port in window})
        if distinct >= self.config.violation:
            severity, classification, threshold = "high", "malicious", self.config.violation
        elif distinct >= self.config.suspicious:
            severity, classification, threshold = "medium", "suspicious", self.config.suspicious
        else:
            return None

        return Finding(
            rule=self.rule,
            severity=severity,
            classification=classification,
            src=packet.src,
            dst=packet.dst,
            proto="tcp",
            dport=None,
            reason=f"{distinct} distinct TCP ports probed with SYN in {self.config.window_s:g} s",
            count=distinct,
            window=self.config.window_s,
            threshold=threshold,
        )
