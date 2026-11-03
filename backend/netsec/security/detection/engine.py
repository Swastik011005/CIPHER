"""A sensor's detection engine: runs the detectors, classifies packets and decides when to alert.

One instance per sensor. IDS-1 and IPS-1 each own one, with independent state, so each keeps its
own view of the traffic and its own alert records.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from netsec.security.config import DetectorsConfig
from netsec.security.correlation import Correlator
from netsec.security.detection.base import SEVERITY_RANK, Detector, Finding, ObservedPacket
from netsec.security.detection.d1_port_scan import PortScanDetector
from netsec.security.detection.d4_restricted_service import RestrictedServiceDetector
from netsec.security.detection.d5_forbidden_zone_pair import ForbiddenZonePairDetector
from netsec.security.detection.d6_invalid_tcp_flags import InvalidFlagsDetector


@dataclass(frozen=True)
class AlertRecord:
    """Everything an ``alert.raised`` event needs."""

    alert_id: str
    incident_id: str
    sensor: str
    finding: Finding


@dataclass
class Observation:
    classification: Literal["normal", "suspicious", "malicious"] = "normal"
    rules: list[str] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    alerts: list[AlertRecord] = field(default_factory=list)

    @property
    def top(self) -> Finding | None:
        """The most severe standing finding."""
        return max(self.findings, key=lambda f: SEVERITY_RANK[f.severity], default=None)


class DetectionEngine:
    def __init__(self, sensor: str, config: DetectorsConfig, correlator: Correlator) -> None:
        self.sensor = sensor
        self.correlator = correlator
        # Order matters only for ties: the first of equally severe findings is the one the IPS acts on.
        self.detectors: list[Detector] = [
            PortScanDetector(config.D1),
            RestrictedServiceDetector(config.D4),
            ForbiddenZonePairDetector(config.D5),
            InvalidFlagsDetector(config.D6),
        ]
        self._suppression = {d.rule: d.suppression_s for d in self.detectors}
        # (rule, src, dst) -> (time of last alert, severity rank of last alert)
        self._last_alert: dict[tuple[str, str, str], tuple[float, int]] = {}

    def set_enabled(self, rule: str, enabled: bool) -> None:
        """Switch one detector on or off (a mid-run control). Its history is kept."""
        for detector in self.detectors:
            if detector.rule == rule:
                detector.enabled = enabled

    def observe(self, packet: ObservedPacket, now: float) -> Observation:
        observation = Observation()
        for detector in self.detectors:
            finding = detector.observe(packet, now)
            if finding is None:
                continue
            observation.findings.append(finding)
            observation.rules.append(finding.rule)
            if finding.classification == "malicious":
                observation.classification = "malicious"
            elif observation.classification == "normal":
                observation.classification = "suspicious"
            if self._should_alert(finding, now):
                observation.alerts.append(
                    AlertRecord(
                        alert_id=self.correlator.new_alert_id(),
                        incident_id=self.correlator.incident_for(finding.rule, finding.src, finding.dst),
                        sensor=self.sensor,
                        finding=finding,
                    )
                )
        return observation

    def _should_alert(self, finding: Finding, now: float) -> bool:
        """One alert per (rule, source, destination) per suppression window; escalation always alerts."""
        key = (finding.rule, finding.src, finding.dst)
        rank = SEVERITY_RANK[finding.severity]
        last = self._last_alert.get(key)
        if last is not None and rank <= last[1] and now - last[0] < self._suppression[finding.rule]:
            return False
        self._last_alert[key] = (now, rank)
        return True
