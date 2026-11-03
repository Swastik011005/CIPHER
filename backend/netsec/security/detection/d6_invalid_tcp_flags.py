"""D6: invalid TCP flags.

Input: TCP segments. Condition: the flag combination matches a signature that no legitimate TCP
stack produces: NULL (no flags), XMAS (FIN+PSH+URG), SYN+FIN, SYN+RST or FIN+RST.
Severity: HIGH (malicious). Needs no history, so it fires on the first packet.

False positives: essentially none for these signatures. Limits: it only knows the listed
signatures; a scan that uses only valid flags (such as the plain SYN scan of D1) is invisible to it.
"""

from __future__ import annotations

from typing import Optional

from netsec.security.config import D6Config
from netsec.security.detection.base import Finding, ObservedPacket

#: signature name -> (human name, predicate over the set of flags)
SIGNATURES = {
    "null": ("NULL scan (no flags set)", lambda f: not f),
    "xmas": ("XMAS scan (FIN, PSH and URG)", lambda f: {"FIN", "PSH", "URG"} <= f),
    "syn_fin": ("SYN and FIN together", lambda f: {"SYN", "FIN"} <= f),
    "syn_rst": ("SYN and RST together", lambda f: {"SYN", "RST"} <= f),
    "fin_rst": ("FIN and RST together", lambda f: {"FIN", "RST"} <= f),
}


class InvalidFlagsDetector:
    rule = "D6"

    def __init__(self, config: D6Config) -> None:
        self.config = config
        self.enabled = config.enabled
        self.suppression_s = config.suppression_s

    def observe(self, packet: ObservedPacket, now: float) -> Optional[Finding]:
        if not self.enabled or packet.proto != "tcp":
            return None
        flags = set(packet.flags)
        for name in self.config.signatures:
            label, matches = SIGNATURES[name]
            if matches(flags):
                return Finding(
                    rule=self.rule,
                    severity="high",
                    classification="malicious",
                    src=packet.src,
                    dst=packet.dst,
                    proto="tcp",
                    dport=packet.dport,
                    reason=f"Invalid TCP flags: {label}",
                    count=1,
                    window=0.0,
                    threshold=1,
                )
        return None
