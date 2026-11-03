"""D3: excessive traffic (flood).

Input: the packets a source sends to a target that start something: TCP connection attempts (SYN without
ACK), UDP datagrams and ICMP packets. Replies such as SYN-ACK are not counted, so a server answering a flood
is not itself reported as a flood. Condition: the packet rate over a sliding window. Above ``suspicious_pps`` packets per second is MEDIUM; above ``violation_pps`` is HIGH.

The rate is the number of packets seen in the window divided by the window length, so a burst counts at once
and the figure is always "packets per second averaged over the window".

Simplification: the specification also mentions "or more than 40 half-open connections". Counting half-open
connections needs the replies to be seen on the same path as the requests, which neither sensor guarantees,
so only the rate condition is implemented (Rev 3 fallback: keep the simpler detector).

False positives: legitimate bursts of new connections (an allowlist or a higher threshold is the
mitigation). Limits: a flood spread over many sources stays under each per-source threshold, and ICMP echo
replies are counted like requests because the sensors only see headers.
"""

from __future__ import annotations

from collections import deque
from typing import Optional

from netsec.security.config import D3Config
from netsec.security.detection.base import Finding, ObservedPacket


class FloodDetector:
    rule = "D3"

    def __init__(self, config: D3Config) -> None:
        self.config = config
        self.enabled = config.enabled
        self.suppression_s = config.suppression_s
        self._seen: dict[tuple[str, str], deque[float]] = {}

    @staticmethod
    def _initiates(packet: ObservedPacket) -> bool:
        if packet.proto == "tcp":
            return "SYN" in packet.flags and "ACK" not in packet.flags
        return True

    def observe(self, packet: ObservedPacket, now: float) -> Optional[Finding]:
        if not self.enabled or not self._initiates(packet):
            return None

        window = self._seen.setdefault((packet.src, packet.dst), deque())
        window.append(now)
        while window and window[0] < now - self.config.window_s:
            window.popleft()

        count = len(window)
        rate = count / self.config.window_s
        if rate > self.config.violation_pps:
            severity, classification, pps = "high", "malicious", self.config.violation_pps
        elif rate > self.config.suspicious_pps:
            severity, classification, pps = "medium", "suspicious", self.config.suspicious_pps
        else:
            return None

        return Finding(
            rule=self.rule,
            severity=severity,
            classification=classification,
            src=packet.src,
            dst=packet.dst,
            proto=packet.proto,
            dport=None,
            reason=f"{rate:.0f} packets per second from {packet.src} to {packet.dst} (limit {pps:g}) over {self.config.window_s:g} s",
            count=count,
            window=self.config.window_s,
            threshold=int(pps * self.config.window_s),
        )
