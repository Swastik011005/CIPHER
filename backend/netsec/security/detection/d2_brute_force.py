"""D2: brute force against remote-login services.

Input: TCP connection attempts (SYN without ACK) to remote-login ports (SSH 22, Telnet 23, RDP 3389),
grouped by (source, target). Condition: the number of attempts inside the sliding window.
Thresholds (configurable): ``suspicious`` -> MEDIUM, ``violation`` -> HIGH.

False positives: a script or tool that legitimately opens many sessions (an allowlist is the mitigation).
Limits: guessing slower than the window, or spread over many sources, never reaches the threshold; it does not
look inside the (encrypted) session, so it counts attempts, not failed passwords.
"""

from __future__ import annotations

from collections import deque
from typing import Optional

from netsec.security.config import D2Config
from netsec.security.detection.base import Finding, ObservedPacket


class BruteForceDetector:
    rule = "D2"

    def __init__(self, config: D2Config) -> None:
        self.config = config
        self.enabled = config.enabled
        self.suppression_s = config.suppression_s
        self._seen: dict[tuple[str, str], deque[float]] = {}

    def observe(self, packet: ObservedPacket, now: float) -> Optional[Finding]:
        if (
            not self.enabled
            or packet.proto != "tcp"
            or "SYN" not in packet.flags
            or "ACK" in packet.flags
            or packet.dport not in self.config.ports
        ):
            return None

        window = self._seen.setdefault((packet.src, packet.dst), deque())
        window.append(now)
        while window and window[0] < now - self.config.window_s:
            window.popleft()

        attempts = len(window)
        if attempts >= self.config.violation:
            severity, classification, threshold = "high", "malicious", self.config.violation
        elif attempts >= self.config.suspicious:
            severity, classification, threshold = "medium", "suspicious", self.config.suspicious
        else:
            return None

        ports = ", ".join(str(p) for p in self.config.ports)
        return Finding(
            rule=self.rule,
            severity=severity,
            classification=classification,
            src=packet.src,
            dst=packet.dst,
            proto="tcp",
            dport=packet.dport,
            reason=f"{attempts} connection attempts to remote-login ports ({ports}) in {self.config.window_s:g} s",
            count=attempts,
            window=self.config.window_s,
            threshold=threshold,
        )
