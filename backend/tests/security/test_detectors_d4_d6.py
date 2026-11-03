"""D4 restricted service, D5 forbidden zone pair and D6 invalid TCP flags, plus per-rule alerting."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from netsec.security.config import (
    D4Config,
    D5Config,
    D6Config,
    DetectorsConfig,
    ForbiddenPair,
    RestrictedService,
    load_detectors,
)
from netsec.security.correlation import Correlator
from netsec.security.detection.base import ObservedPacket
from netsec.security.detection.d4_restricted_service import RestrictedServiceDetector
from netsec.security.detection.d5_forbidden_zone_pair import ForbiddenZonePairDetector
from netsec.security.detection.d6_invalid_tcp_flags import InvalidFlagsDetector
from netsec.security.detection.engine import DetectionEngine

APP, DB, STAFF, ADMIN, SEC, EXT = "10.0.30.10", "10.0.30.20", "10.0.10.11", "10.0.20.10", "10.0.99.20", "203.0.113.66"


def pkt(src, dst, dport=3306, flags=("SYN",), proto="tcp", sport=50000):
    return ObservedPacket(proto, src, dst, sport, dport, flags, 44)


# -- D4 ---------------------------------------------------------------------------------------------


def test_shipped_detector_config_has_all_four_detectors_enabled() -> None:
    cfg = load_detectors()
    assert all(getattr(cfg, rule).enabled for rule in ("D1", "D4", "D5", "D6"))
    assert [(s.dst, s.dport, s.allowed_sources) for s in cfg.D4.services] == [(DB, 3306, ["10.0.30.10/32"])]


@pytest.mark.parametrize("src", [STAFF, ADMIN, EXT])
def test_d4_flags_any_unauthorised_source_on_the_first_packet(src) -> None:
    finding = RestrictedServiceDetector(D4Config()).observe(pkt(src, DB), 0.0)
    assert finding is not None
    assert (finding.rule, finding.severity, finding.classification) == ("D4", "high", "malicious")
    assert (finding.src, finding.dst, finding.dport) == (src, DB, 3306)
    assert (finding.count, finding.threshold) == (1, 1)
    assert "MySQL" in finding.reason


def test_d4_allows_the_application_server_and_ignores_other_ports_hosts_and_protocols() -> None:
    d4 = RestrictedServiceDetector(D4Config())
    assert d4.observe(pkt(APP, DB), 0.0) is None  # the one allowed client
    assert d4.observe(pkt(STAFF, DB, dport=22), 0.0) is None  # another service on the same host
    assert d4.observe(pkt(STAFF, APP, dport=3306), 0.0) is None  # same port on another host
    assert d4.observe(pkt(STAFF, DB, proto="udp"), 0.0) is None
    assert d4.observe(pkt(STAFF, DB, proto="icmp", dport=None), 0.0) is None
    assert d4.observe(pkt(DB, STAFF, dport=50000, sport=3306, flags=("SYN", "ACK")), 0.0) is None  # the reply direction


def test_d4_can_be_disabled_and_reconfigured() -> None:
    off = RestrictedServiceDetector(D4Config(enabled=False))
    assert off.observe(pkt(STAFF, DB), 0.0) is None
    custom = D4Config(services=[RestrictedService(name="Admin SSH", dst=APP, dport=22, allowed_sources=["10.0.20.0/24"])])
    d4 = RestrictedServiceDetector(custom)
    assert d4.observe(pkt(STAFF, APP, dport=22), 0.0) is not None
    assert d4.observe(pkt(ADMIN, APP, dport=22), 0.0) is None


# -- D5 ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("src", "dst"),
    [(STAFF, SEC), ("10.0.10.13", "10.0.99.10"), (EXT, SEC)],
)
def test_d5_flags_the_forbidden_zone_pairs_for_any_protocol(src, dst) -> None:
    d5 = ForbiddenZonePairDetector(D5Config())
    for proto, dport, flags in (("tcp", 22, ("SYN",)), ("icmp", None, ()), ("udp", 514, ())):
        finding = d5.observe(pkt(src, dst, dport, flags, proto), 1.0)
        assert finding is not None, proto
        assert (finding.rule, finding.severity, finding.proto, finding.dst) == ("D5", "high", proto, dst)


def test_d5_ignores_allowed_pairs_and_the_reverse_direction() -> None:
    d5 = ForbiddenZonePairDetector(D5Config())
    assert d5.observe(pkt(ADMIN, SEC), 0.0) is None  # Admin may reach the security network
    assert d5.observe(pkt(SEC, STAFF, dport=50000), 0.0) is None  # replies flow the other way
    assert d5.observe(pkt(STAFF, APP, dport=443), 0.0) is None
    assert ForbiddenZonePairDetector(D5Config(enabled=False)).observe(pkt(STAFF, SEC), 0.0) is None


# -- D6 ---------------------------------------------------------------------------------------------

INVALID = {
    "null": (),
    "xmas": ("FIN", "PSH", "URG"),
    "syn_fin": ("SYN", "FIN"),
    "syn_rst": ("SYN", "RST"),
    "fin_rst": ("FIN", "RST"),
}
VALID = [("SYN",), ("SYN", "ACK"), ("ACK",), ("PSH", "ACK"), ("FIN", "ACK"), ("RST",), ("RST", "ACK"), ("FIN", "PSH", "ACK")]


@pytest.mark.parametrize("name", INVALID)
def test_d6_recognises_each_invalid_flag_signature(name) -> None:
    finding = InvalidFlagsDetector(D6Config()).observe(pkt(STAFF, APP, 443, INVALID[name]), 0.0)
    assert finding is not None
    assert (finding.rule, finding.severity, finding.classification) == ("D6", "high", "malicious")
    assert finding.reason.startswith("Invalid TCP flags")


@pytest.mark.parametrize("flags", VALID)
def test_d6_never_fires_for_legitimate_flag_combinations(flags) -> None:
    assert InvalidFlagsDetector(D6Config()).observe(pkt(STAFF, APP, 443, flags), 0.0) is None


def test_d6_only_looks_at_tcp_and_only_at_enabled_signatures() -> None:
    assert InvalidFlagsDetector(D6Config()).observe(pkt(STAFF, APP, None, (), "icmp"), 0.0) is None
    only_null = InvalidFlagsDetector(D6Config(signatures=["null"]))
    assert only_null.observe(pkt(STAFF, APP, 443, ()), 0.0) is not None
    assert only_null.observe(pkt(STAFF, APP, 443, ("SYN", "FIN")), 0.0) is None
    assert InvalidFlagsDetector(D6Config(enabled=False)).observe(pkt(STAFF, APP, 443, ()), 0.0) is None


def test_config_validation_rejects_bad_addresses_and_signatures() -> None:
    with pytest.raises(ValidationError):
        ForbiddenPair(name="x", src="not-an-ip", dst="10.0.0.0/24")
    with pytest.raises(ValidationError):
        RestrictedService(name="x", dst="10.0.30.20", dport=70000, allowed_sources=[])
    with pytest.raises(ValidationError):
        D6Config(signatures=["bogus"])


# -- engine: alerting, suppression, correlation -------------------------------------------------------


def engine(sensor="IDS-1") -> DetectionEngine:
    return DetectionEngine(sensor, load_detectors(), Correlator())


def test_each_rule_alerts_once_per_source_and_target_per_suppression_window() -> None:
    ids = engine()
    first = ids.observe(pkt(STAFF, DB), 0.0)
    assert [a.finding.rule for a in first.alerts] == ["D4"] and first.classification == "malicious"
    assert ids.observe(pkt(STAFF, DB), 5.0).alerts == []  # suppressed, but still classified
    assert ids.observe(pkt(STAFF, DB), 5.0).classification == "malicious"
    assert len(ids.observe(pkt(STAFF, DB), 30.0).alerts) == 1  # window over
    assert len(ids.observe(pkt("10.0.10.12", DB), 6.0).alerts) == 1  # another source is its own incident


def test_a_packet_can_trigger_several_detectors_and_each_alerts() -> None:
    ids = engine()
    obs = ids.observe(pkt(STAFF, DB, flags=()), 0.0)  # NULL-flag packet to the restricted service
    assert sorted(a.finding.rule for a in obs.alerts) == ["D4", "D6"]
    assert obs.rules == ["D4", "D6"]
    assert len({a.incident_id for a in obs.alerts}) == 2  # different rules are different incidents


def test_two_sensors_keep_separate_alerts_but_share_the_incident() -> None:
    correlator = Correlator()
    ids = DetectionEngine("IDS-1", load_detectors(), correlator)
    ips = DetectionEngine("IPS-1", load_detectors(), correlator)
    a = ids.observe(pkt(ADMIN, DB), 1.0).alerts[0]
    b = ips.observe(pkt(ADMIN, DB), 1.2).alerts[0]
    assert (a.sensor, b.sensor) == ("IDS-1", "IPS-1")
    assert a.alert_id != b.alert_id and a.incident_id == b.incident_id


def test_set_enabled_switches_a_detector_without_touching_the_others() -> None:
    ids = engine()
    ids.set_enabled("D4", False)
    assert ids.observe(pkt(STAFF, DB), 0.0).alerts == []
    assert ids.observe(pkt(STAFF, SEC, 22), 0.0).alerts[0].finding.rule == "D5"
    ids.set_enabled("D4", True)
    assert ids.observe(pkt("10.0.10.12", DB), 0.0).alerts[0].finding.rule == "D4"


def test_detectors_config_still_builds_with_only_d1() -> None:
    from netsec.security.config import D1Config

    cfg = DetectorsConfig(D1=D1Config(window_s=10, suspicious=6, violation=12, suppression_s=30))
    assert cfg.D4.enabled and cfg.D5.enabled and cfg.D6.enabled
    assert DetectionEngine("IDS-1", cfg, Correlator()).observe(pkt(STAFF, DB), 0.0).alerts
