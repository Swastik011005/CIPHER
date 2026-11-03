"""IPS actions beyond block-source: drop and reject, per detector, in both modes."""

from __future__ import annotations

import pytest

from netsec.security.config import load_detectors, load_ips_policy
from netsec.security.correlation import Correlator
from netsec.security.detection.base import ObservedPacket
from netsec.security.prevention.ips import ALLOWLIST_RULE, IpsEngine

STAFF, ADMIN, SEC, DB, APP = "10.0.10.11", "10.0.20.10", "10.0.99.20", "10.0.30.20", "10.0.30.10"


def pkt(src, dst, dport, flags=("SYN",), proto="tcp"):
    return ObservedPacket(proto, src, dst, 50000, dport, flags, 44)


def ips(mode) -> IpsEngine:
    return IpsEngine(mode, load_detectors(), load_ips_policy(), Correlator())


def test_the_shipped_policy_maps_detectors_to_actions() -> None:
    policy = load_ips_policy()
    got = {(r.detector, r.severity): r.action for r in policy.rules}
    assert got == {
        ("D1", "high"): "block_source",
        ("D1", "medium"): "allow",
        ("D4", "high"): "reject",
        ("D5", "high"): "drop",
        ("D6", "high"): "drop",
    }


@pytest.mark.parametrize(
    ("packet", "action", "reason", "rule"),
    [
        (pkt(ADMIN, DB, 3306), "reject", "ips_reject", "D4"),
        (pkt(STAFF, SEC, 22), "drop", "ips_drop", "D5"),
        (pkt(STAFF, APP, 443, flags=("SYN", "FIN")), "drop", "ips_drop", "D6"),
        (pkt(STAFF, APP, 443, flags=()), "drop", "ips_drop", "D6"),
    ],
)
def test_enforce_applies_the_configured_action_to_the_offending_packet_only(packet, action, reason, rule) -> None:
    engine = ips("enforce")
    out = engine.process(packet, 1.0)
    assert (out.action, out.applied, out.drop_reason, out.rule) == (action, True, reason, rule)
    assert out.new_block is None  # drop and reject never block the source
    again = engine.process(pkt(packet.src, APP, 443), 1.5)  # a clean packet from the same source still passes
    assert again.drop_reason is None and again.action is None


@pytest.mark.parametrize("packet", [pkt(ADMIN, DB, 3306), pkt(STAFF, SEC, 22), pkt(STAFF, APP, 443, flags=())])
def test_monitor_records_what_it_would_do_and_forwards(packet) -> None:
    out = ips("monitor").process(packet, 1.0)
    assert out.action in ("reject", "drop") and out.applied is False
    assert out.drop_reason is None and out.new_block is None
    assert out.observation.classification == "malicious"


def test_allowlisted_sources_are_never_acted_on_but_are_still_detected() -> None:
    out = ips("enforce").process(pkt("10.0.99.10", APP, 443, flags=()), 1.0)
    assert (out.action, out.applied, out.rule, out.drop_reason) == ("allow", True, ALLOWLIST_RULE, None)
    assert out.observation.rules == ["D6"]


def test_the_first_matching_detector_decides_when_several_fire() -> None:
    out = ips("enforce").process(pkt(STAFF, DB, 3306, flags=()), 1.0)  # D4 (reject) and D6 (drop) both fire
    assert out.observation.rules == ["D4", "D6"]
    assert (out.action, out.drop_reason) == ("reject", "ips_reject")


def test_a_blocked_source_is_dropped_before_any_detector_runs() -> None:
    engine = ips("enforce")
    for port in range(1, 13):
        engine.process(pkt(STAFF, APP, port), port * 0.25)  # D1 HIGH at the 12th port blocks the source
    out = engine.process(pkt(STAFF, SEC, 22), 4.0)  # would be D5, but the block table comes first
    assert (out.drop_reason, out.from_block_table, out.observation.rules) == ("blocked_source", True, [])


def test_switching_to_monitor_lifts_blocks_and_stops_all_drops() -> None:
    engine = ips("enforce")
    for port in range(1, 13):
        engine.process(pkt(STAFF, APP, port), port * 0.25)
    lifted = engine.set_mode("monitor")
    assert [b.src for b in lifted] == [STAFF]
    assert engine.process(pkt(STAFF, APP, 80), 4.0).drop_reason is None
    assert engine.expire(STAFF, lifted[0].until) is False  # the old expiry timer finds nothing to lift
