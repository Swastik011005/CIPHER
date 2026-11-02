"""Types shared by detectors.

Detectors only ever see an :class:`ObservedPacket`: header fields and nothing else. The scenario's
flow label, packet ids and any notion of "this is an attack" are not part of it, so a detector
cannot cheat by reading ground truth.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Protocol

Severity = Literal["low", "medium", "high"]
SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3}


@dataclass(frozen=True)
class ObservedPacket:
    proto: str
    src: str
    dst: str
    sport: Optional[int]
    dport: Optional[int]
    flags: tuple[str, ...]
    length: int


@dataclass(frozen=True)
class Finding:
    """The standing verdict of one detector for one flow at one instant.

    ``classification`` is "suspicious" for a soft threshold and "malicious" for a hard one.
    """

    rule: str
    severity: Severity
    classification: Literal["suspicious", "malicious"]
    src: str
    dst: str
    proto: str
    dport: Optional[int]
    reason: str
    count: int
    window: float
    threshold: int


class Detector(Protocol):
    rule: str

    def observe(self, packet: ObservedPacket, now: float) -> Optional[Finding]:
        """Update state with ``packet`` seen at ``now`` seconds; return the standing finding, if any."""
        ...
