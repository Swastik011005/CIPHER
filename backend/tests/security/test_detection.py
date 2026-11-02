"""D1 thresholds, alert suppression and incident correlation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from netsec.security.config import D1Config, DetectorsConfig, load_detectors
from netsec.security.correlation import Correlator
from netsec.security.detection.base import ObservedPacket
from netsec.security.detection.d1_port_scan import PortScanDetector
from netsec.security.detection.engine import DetectionEngine

SRC, DST = "10.0.10.12", "10.0.30.10"


def syn(port: int, src: str = SRC, dst: str = DST, flags=("SYN",), proto="tcp") -> ObservedPacket:
    return ObservedPacket(proto, src, dst, 50000, port, flags, 44)


def config(**overrides) -> D1Config:
    values = dict(enabled=True, window_s=10.0, suspicious=6, violation=12, suppression_s=30.0)
    values.update(overrides)
    return D1Config(**values)


def scan(detector, ports, start=0.0, step=0.25, **kw):
    """Feed one SYN per port; return the finding after each probe."""
    return [detector.observe(syn(p, **kw), start + i * step) for i, p in enumerate(ports)]


def test_default_thresholds_are_the_frozen_ones() -> None:
    d1 = load_detectors().D1
    assert (d1.window_s, d1.suspicious, d1.violation, d1.suppression_s) == (10.0, 6, 12, 30.0)


def test_d1_fires_exactly_at_six_and_twelve_distinct_ports() -> None:
    findings = scan(PortScanDetector(config()), range(1, 21))
    severities = [f.severity if f else None for f in findings]
    assert severities[:5] == [None] * 5  # 1..5 ports: nothing
    assert severities[5] == "medium"  # the 6th port
    assert severities[6:11] == ["medium"] * 5  # 7..11 stay medium
    assert severities[11] == "high"  # the 12th port
    assert set(severities[11:]) == {"high"}
    assert (findings[5].count, findings[5].threshold, findings[5].classification) == (6, 6, "suspicious")
    assert (findings[11].count, findings[11].threshold, findings[11].classification) == (12, 12, "malicious")


def test_repeated_ports_do_not_count_as_distinct() -> None:
    findings = scan(PortScanDetector(config()), [80] * 30)
    assert all(f is None for f in findings)


def test_only_bare_syn_counts() -> None:
    detector = PortScanDetector(config())
    for flags in (("SYN", "ACK"), ("ACK",), ("RST", "ACK"), ("PSH", "ACK"), ("FIN", "ACK")):
        assert all(detector.observe(syn(p, flags=flags), 0.1 * p) is None for p in range(1, 30)), flags
    assert detector.observe(syn(1, proto="udp"), 0.0) is None


def test_slow_scan_never_reaches_the_threshold() -> None:
    """A limitation we teach: spread the probes beyond the window and detection never triggers."""
    findings = scan(PortScanDetector(config()), range(1, 40), step=2.5)  # at most 4 ports per 10 s
    assert all(f is None for f in findings)


def test_old_probes_leave_the_window() -> None:
    detector = PortScanDetector(config())
    scan(detector, range(1, 6))  # 5 ports around t=0
    assert detector.observe(syn(100), 5.0) is not None  # 6th distinct inside the window
    detector = PortScanDetector(config())
    scan(detector, range(1, 6))
    assert detector.observe(syn(100), 11.0) is None  # the first five have expired


def test_sources_and_targets_are_tracked_independently() -> None:
    detector = PortScanDetector(config())
    a = scan(detector, range(1, 6), src="10.0.10.12")
    b = scan(detector, range(1, 6), src="10.0.10.13")
    c = scan(detector, range(1, 6), dst="10.0.30.20")
    assert all(f is None for f in a + b + c)  # five ports each, never six for one pair


def test_disabled_detector_is_silent() -> None:
    assert all(f is None for f in scan(PortScanDetector(config(enabled=False)), range(1, 30)))


def test_config_rejects_unordered_thresholds() -> None:
    with pytest.raises(ValidationError, match="lower than"):
        config(suspicious=12, violation=6)
    with pytest.raises(ValidationError):
        config(window_s=0)


def make_engine(sensor="IDS-1", correlator=None) -> DetectionEngine:
    return DetectionEngine(sensor, DetectorsConfig(D1=config()), correlator or Correlator())


def test_engine_alerts_once_per_level_then_suppresses() -> None:
    engine = make_engine()
    alerts = []
    for i, port in enumerate(range(1, 31)):
        alerts += engine.observe(syn(port), i * 0.25).alerts
    assert [(a.finding.severity, a.finding.count) for a in alerts] == [("medium", 6), ("high", 12)]


def test_engine_alerts_again_after_the_suppression_window() -> None:
    engine = make_engine()
    first = [a for i, p in enumerate(range(1, 31)) for a in engine.observe(syn(p), i * 0.25).alerts]
    assert len(first) == 2
    later = [a for i, p in enumerate(range(100, 130)) for a in engine.observe(syn(p), 40 + i * 0.25).alerts]
    assert len(later) >= 1 and later[-1].finding.severity == "high"


def test_engine_classification_per_packet() -> None:
    engine = make_engine()
    labels = [engine.observe(syn(p), p * 0.25).classification for p in range(1, 15)]
    assert labels[:5] == ["normal"] * 5
    assert labels[5:11] == ["suspicious"] * 6
    assert set(labels[11:]) == {"malicious"}
    assert engine.observe(syn(80, src="10.0.10.99"), 5.0).classification == "normal"


def test_two_sensors_keep_separate_alerts_but_share_one_incident() -> None:
    correlator = Correlator()
    ids, ips = make_engine("IDS-1", correlator), make_engine("IPS-1", correlator)
    ids_alerts, ips_alerts = [], []
    for i, port in enumerate(range(1, 13)):
        ids_alerts += ids.observe(syn(port), i * 0.25).alerts
        ips_alerts += ips.observe(syn(port), i * 0.25 + 0.2).alerts
    everything = ids_alerts + ips_alerts
    assert len({a.alert_id for a in everything}) == len(everything) == 4  # separate records
    assert {a.sensor for a in ids_alerts} == {"IDS-1"} and {a.sensor for a in ips_alerts} == {"IPS-1"}
    assert len({a.incident_id for a in everything}) == 1  # one threat


def test_a_different_source_is_a_different_incident() -> None:
    correlator = Correlator()
    a = correlator.incident_for("D1", "10.0.10.12", DST)
    b = correlator.incident_for("D1", "10.0.10.13", DST)
    assert a != b and correlator.incident_for("D1", "10.0.10.12", DST) == a
