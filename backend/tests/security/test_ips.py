"""IPS processing order, Monitor vs Enforce, block table behaviour."""

from __future__ import annotations

import pytest

from netsec.security.config import IpsPolicyConfig, IpsRule, load_detectors, load_ips_policy
from netsec.security.correlation import Correlator
from netsec.security.detection.base import ObservedPacket
from netsec.security.prevention.block_table import Block, BlockTable
from netsec.security.prevention.ips import ALLOWLIST_RULE, IpsEngine

SRC, DST = "10.0.10.12", "10.0.30.10"


def syn(port, src=SRC) -> ObservedPacket:
    return ObservedPacket("tcp", src, DST, 50000, port, ("SYN",), 44)


def ips(mode, policy=None) -> IpsEngine:
    return IpsEngine(mode, load_detectors(), policy or load_ips_policy(), Correlator())


def drive(engine, ports, start=0.0, step=0.25, src=SRC):
    return [engine.process(syn(p, src), start + i * step) for i, p in enumerate(ports)]


def test_monitor_mode_never_drops_and_records_would_block() -> None:
    outcomes = drive(ips("monitor"), range(1, 31))
    assert all(o.drop_reason is None and o.new_block is None for o in outcomes)
    recorded = [o for o in outcomes if o.action is not None]
    assert recorded and all(o.action == "block_source" and o.applied is False for o in recorded)
    assert [i + 1 for i, o in enumerate(outcomes) if o.action] == list(range(12, 31))  # from the 12th port on


def test_enforce_mode_blocks_the_source_at_the_twelfth_port() -> None:
    outcomes = drive(ips("enforce"), range(1, 31))
    assert all(o.drop_reason is None for o in outcomes[:11])  # ports 1..11 pass (even the MEDIUM ones)
    twelfth = outcomes[11]
    assert (twelfth.action, twelfth.applied, twelfth.drop_reason) == ("block_source", True, "ips_drop")
    assert twelfth.new_block is not None and twelfth.new_block.until == pytest.approx(2.75 + 20.0)
    assert all(o.drop_reason == "blocked_source" and o.from_block_table for o in outcomes[12:])


def test_medium_findings_are_only_alerts_even_in_enforce() -> None:
    outcomes = drive(ips("enforce"), range(1, 12))
    assert all(o.drop_reason is None and o.action is None for o in outcomes)
    assert [a.finding.severity for o in outcomes for a in o.observation.alerts] == ["medium"]


def test_block_table_is_checked_before_the_detectors() -> None:
    engine = ips("enforce")
    drive(engine, range(1, 13))  # blocks the source
    original = engine.detection.observe
    calls = []
    engine.detection.observe = lambda pkt, now: calls.append(pkt) or original(pkt, now)
    outcome = engine.process(syn(99), 3.0)
    assert outcome.from_block_table and calls == []  # dropped before detection, as the order demands
    assert outcome.observation.alerts == [] and outcome.observation.classification == "normal"


def test_other_sources_are_unaffected_by_a_block() -> None:
    engine = ips("enforce")
    drive(engine, range(1, 13))
    assert engine.process(syn(443, src="10.0.10.11"), 3.0).drop_reason is None


def test_block_ends_exactly_at_its_expiry_time() -> None:
    engine = ips("enforce")
    until = drive(engine, range(1, 13))[11].new_block.until
    assert engine.process(syn(80), until - 0.001).drop_reason == "blocked_source"
    assert engine.process(syn(80), until).drop_reason is None  # passes again at ``until``


def test_after_a_block_expires_a_new_scan_is_detected_and_blocked_again() -> None:
    engine = ips("enforce")
    first = drive(engine, range(1, 13))[11].new_block
    again = drive(engine, range(100, 113), start=first.until + 1.0)
    assert again[11].new_block is not None and again[11].new_block.until > first.until


def test_allowlisted_sources_are_never_blocked() -> None:
    outcomes = drive(ips("enforce"), range(1, 31), src="10.0.99.20")  # SEC-LOG is in the allowlist
    assert all(o.drop_reason is None and o.new_block is None for o in outcomes)
    assert any(o.action == "allow" and o.rule == ALLOWLIST_RULE for o in outcomes)


def test_an_older_expiry_does_not_remove_a_newer_block() -> None:
    table = BlockTable()
    table.add(Block("a", 10.0, "D1", "INC-1"))
    table.add(Block("a", 50.0, "D1", "INC-1"))
    table.remove("a", 10.0)
    assert table.active("a", 20.0) is not None
    table.remove("a", 50.0)
    assert table.active("a", 20.0) is None


def test_every_action_in_the_contract_is_implemented() -> None:
    from netsec.security.prevention.ips import SUPPORTED_ACTIONS

    assert SUPPORTED_ACTIONS == {"allow", "drop", "reject", "block_source", "rate_limit"}


def test_rate_limit_rules_need_a_rate_and_a_burst() -> None:
    with pytest.raises(ValueError, match="rate_pps and burst"):
        IpsRule(detector="D3", severity="medium", action="rate_limit")
    assert IpsRule(detector="D3", severity="medium", action="rate_limit", rate_pps=10, burst=20).burst == 20


def test_block_rules_need_a_duration() -> None:
    with pytest.raises(ValueError, match="duration_s"):
        IpsRule(detector="D1", severity="high", action="block_source")


def test_ips_alerts_name_the_ips_as_sensor() -> None:
    outcomes = drive(ips("monitor"), range(1, 13))
    assert {a.sensor for o in outcomes for a in o.observation.alerts} == {"IPS-1"}
