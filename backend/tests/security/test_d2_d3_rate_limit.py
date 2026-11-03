"""D2 brute force, D3 flood, the token bucket and IPS rate limiting."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from netsec.security.config import D2Config, D3Config, IpsPolicyConfig, IpsRule, load_detectors, load_ips_policy
from netsec.security.correlation import Correlator
from netsec.security.detection.base import ObservedPacket
from netsec.security.detection.d2_brute_force import BruteForceDetector
from netsec.security.detection.d3_flood import FloodDetector
from netsec.security.detection.engine import DetectionEngine
from netsec.security.prevention.ips import IpsEngine
from netsec.security.prevention.rate_limiter import TokenBucket

ATK, USER, APP = "203.0.113.66", "203.0.113.25", "10.0.30.10"


def syn(src=ATK, dst=APP, dport=443, flags=("SYN",), proto="tcp", sport=50000):
    return ObservedPacket(proto, src, dst, sport, dport, flags, 44)


# -- D2 ---------------------------------------------------------------------------------------------


def attempts(detector, n, start=0.0, step=1.0, dport=22, src=ATK):
    return [detector.observe(syn(dport=dport, src=src), start + i * step) for i in range(n)]


def test_d2_default_thresholds_are_six_and_twelve_attempts_in_thirty_seconds() -> None:
    cfg = load_detectors().D2
    assert (cfg.ports, cfg.window_s, cfg.suspicious, cfg.violation, cfg.suppression_s) == ([22, 23, 3389], 30.0, 6, 12, 30.0)


def test_d2_fires_exactly_at_the_sixth_and_twelfth_attempt() -> None:
    d2 = BruteForceDetector(D2Config())
    got = attempts(d2, 14)
    assert [f.severity if f else None for f in got] == [None] * 5 + ["medium"] * 6 + ["high"] * 3
    assert (got[5].count, got[5].threshold, got[5].window) == (6, 6, 30.0)
    assert (got[11].count, got[11].threshold) == (12, 12)
    assert got[11].classification == "malicious" and got[5].classification == "suspicious"
    assert got[5].dport == 22 and "remote-login" in got[5].reason


@pytest.mark.parametrize("dport", [22, 23, 3389])
def test_d2_watches_each_remote_login_port_and_counts_them_together(dport) -> None:
    d2 = BruteForceDetector(D2Config())
    assert any(attempts(d2, 6, dport=dport))
    mixed = BruteForceDetector(D2Config())
    findings = [mixed.observe(syn(dport=p), i) for i, p in enumerate([22, 23, 3389, 22, 23, 3389])]
    assert findings[-1] is not None and findings[-1].severity == "medium"  # six attempts across the three ports


def test_d2_ignores_other_ports_replies_and_slow_guessing() -> None:
    d2 = BruteForceDetector(D2Config())
    assert not any(attempts(d2, 20, dport=443))  # not a login port
    assert d2.observe(syn(flags=("SYN", "ACK")), 0.0) is None and d2.observe(syn(flags=("ACK",)), 0.0) is None
    assert d2.observe(syn(proto="udp", flags=()), 0.0) is None
    slow = BruteForceDetector(D2Config())
    assert not any(attempts(slow, 20, step=10.0))  # one attempt per 10 s never reaches six inside 30 s


def test_d2_keeps_a_separate_count_per_source_and_target_and_can_be_disabled() -> None:
    d2 = BruteForceDetector(D2Config())
    for i in range(5):
        d2.observe(syn(src=ATK, dport=22), i)
        d2.observe(syn(src=USER, dport=22), i)
        d2.observe(syn(src=ATK, dst="10.0.30.20", dport=22), i)
    assert d2.observe(syn(src=USER, dport=22), 5.0) is not None  # USER's sixth attempt at this target
    assert d2.observe(syn(src=ATK, dst="10.0.30.99", dport=22), 5.0) is None  # a new target starts from one
    assert not any(attempts(BruteForceDetector(D2Config(enabled=False)), 20))


def test_d2_validation() -> None:
    with pytest.raises(ValidationError):
        D2Config(suspicious=12, violation=6)
    with pytest.raises(ValidationError):
        D2Config(ports=[])


# -- D3 ---------------------------------------------------------------------------------------------


def flood(detector, pps, seconds, start=0.0, **kw):
    """Feed ``pps`` SYNs per second for ``seconds``; return findings."""
    n = round(pps * seconds)
    return [detector.observe(syn(**kw), start + i / pps) for i in range(n)]


def test_d3_default_thresholds_are_25_and_50_packets_per_second_over_five_seconds() -> None:
    cfg = load_detectors().D3
    assert (cfg.window_s, cfg.suspicious_pps, cfg.violation_pps, cfg.suppression_s) == (5.0, 25.0, 50.0, 30.0)


@pytest.mark.parametrize(("pps", "expected"), [(15, None), (24, None), (30, "medium"), (45, "medium"), (60, "high"), (70, "high")])
def test_d3_severity_follows_the_steady_rate(pps, expected) -> None:
    findings = flood(FloodDetector(D3Config()), pps, 8)
    last = findings[-1]
    assert (last.severity if last else None) == expected


def test_d3_evidence_is_the_packet_count_in_the_window_against_its_threshold() -> None:
    findings = flood(FloodDetector(D3Config()), 40, 8)
    medium = next(f for f in findings if f)
    assert medium.severity == "medium" and medium.count == 126  # the first count above 25 pps x 5 s
    assert (medium.window, medium.threshold) == (5.0, 125)
    high = flood(FloodDetector(D3Config()), 70, 8)[-1]
    assert high.threshold == 250 and high.count > 250 and "packets per second" in high.reason
    assert (high.rule, high.classification, high.dport) == ("D3", "malicious", None)


def test_d3_ramp_reaches_medium_then_high_as_the_rate_climbs() -> None:
    d3 = FloodDetector(D3Config())
    seen = []
    t = 0.0
    for pps, seconds in ((15, 3), (40, 4), (70, 4)):  # the S4 ramp
        for _ in range(round(pps * seconds)):
            f = d3.observe(syn(), t)
            seen.append((round(t, 2), f.severity if f else None))
            t += 1 / pps
    first_medium = next(t for t, s in seen if s == "medium")
    first_high = next(t for t, s in seen if s == "high")
    assert 4.5 < first_medium < 5.6 and 8.0 < first_high < 9.5 and first_medium < first_high  # about 5.0 s and 8.7 s
    assert not any(s for t, s in seen if t < first_medium)  # nothing at 15 pps


def test_d3_only_counts_packets_that_start_something() -> None:
    d3 = FloodDetector(D3Config())
    for i in range(400):
        assert d3.observe(syn(flags=("SYN", "ACK")), i * 0.01) is None  # a server answering is not a flood
        assert d3.observe(syn(flags=("ACK",)), i * 0.01) is None
    assert flood(FloodDetector(D3Config()), 60, 6, proto="udp", flags=())[-1].severity == "high"  # UDP datagrams do count
    assert flood(FloodDetector(D3Config()), 60, 6, proto="icmp", flags=(), dport=None)[-1].severity == "high"


def test_d3_is_per_source_and_target_and_the_window_forgets() -> None:
    d3 = FloodDetector(D3Config())
    flood(d3, 70, 6, src=ATK)
    assert d3.observe(syn(src=USER), 6.0) is None  # an ordinary client at the same moment is untouched
    assert d3.observe(syn(src=ATK, dst="10.0.30.20"), 6.0) is None  # another target has its own count
    assert d3.observe(syn(src=ATK), 20.0) is None  # fifteen quiet seconds later, the window is empty again


def test_d3_validation_and_disable() -> None:
    with pytest.raises(ValidationError):
        D3Config(suspicious_pps=60, violation_pps=50)
    assert not any(flood(FloodDetector(D3Config(enabled=False)), 70, 6))


def test_a_single_packet_can_trigger_d2_and_d3_alerts_independently() -> None:
    engine = DetectionEngine("IDS-1", load_detectors(), Correlator())
    rules = set()
    for i in range(300):
        obs = engine.observe(syn(dport=22), i / 60)  # 60 SSH attempts a second: brute force and flood at once
        rules |= {a.finding.rule for a in obs.alerts}
    assert {"D2", "D3"} <= rules


# -- the token bucket -----------------------------------------------------------------------------------


def test_the_bucket_lets_a_burst_through_then_refills_at_the_rate() -> None:
    bucket = TokenBucket(rate_pps=10, burst=20)
    assert [bucket.allow(0.0) for _ in range(25)] == [True] * 20 + [False] * 5  # burst of 20, then empty
    assert not bucket.allow(0.05)  # half a token is not a token
    assert bucket.allow(0.1)  # one token after 0.1 s
    assert [bucket.allow(1.1) for _ in range(12)] == [True] * 10 + [False] * 2  # a second later: ten more


def test_the_bucket_never_holds_more_than_the_burst_and_ignores_time_going_backwards() -> None:
    bucket = TokenBucket(rate_pps=10, burst=20)
    assert bucket.allow(100.0) and bucket.tokens <= 20
    before = bucket.tokens
    bucket.allow(50.0)  # earlier than the last call
    assert bucket.tokens <= before


def test_a_refused_packet_does_not_use_up_a_token() -> None:
    bucket = TokenBucket(rate_pps=1, burst=1)
    assert bucket.allow(0.0) and not bucket.allow(0.1) and not bucket.allow(0.2) and not bucket.allow(0.9)
    assert bucket.allow(1.0)  # exactly one second after the only token was used


def test_a_sustained_rate_above_the_limit_passes_about_the_limit() -> None:
    bucket = TokenBucket(rate_pps=10, burst=20)
    passed = sum(bucket.allow(i / 40) for i in range(40 * 10))  # 40 pps for 10 s
    assert 20 + 10 * 10 - 3 <= passed <= 20 + 10 * 10 + 3  # burst plus rate x time


# -- IPS rate limiting ------------------------------------------------------------------------------------


def ips(mode) -> IpsEngine:
    return IpsEngine(mode, load_detectors(), load_ips_policy(), Correlator())


def drive(engine, pps, seconds, start=0.0, src=ATK):
    return [engine.process(syn(src=src, sport=10000 + i), start + i / pps) for i in range(round(pps * seconds))]


def test_the_shipped_policy_rate_limits_medium_floods_and_blocks_high_ones() -> None:
    policy = load_ips_policy()
    medium, high = policy.rule_for("D3", "medium"), policy.rule_for("D3", "high")
    assert (medium.action, medium.rate_pps, medium.burst) == ("rate_limit", 10.0, 20)
    assert (high.action, high.duration_s) == ("block_source", 20.0)
    assert policy.rule_for("D2", "high").duration_s == 30.0 and policy.rule_for("D2", "medium").action == "allow"


def test_enforce_passes_the_burst_then_drops_only_the_excess_and_never_blocks_a_medium_flood() -> None:
    outcomes = drive(ips("enforce"), 40, 4)  # a steady 40 pps: MEDIUM, never HIGH
    limited = [o for o in outcomes if o.action == "rate_limit"]
    assert limited and all(o.applied and o.drop_reason == "rate_limited" and o.rule == "D3" for o in limited)
    assert all(o.new_block is None for o in outcomes)
    passed_while_limiting = [o for o in outcomes[outcomes.index(limited[0]):] if o.action is None]
    assert 0 < len(passed_while_limiting) < len(limited)  # about 10 pps get through, the rest are dropped
    assert all(o.drop_reason is None for o in outcomes[: outcomes.index(limited[0])])  # nothing is limited before the detector fires


def test_monitor_records_the_same_packets_as_would_be_limited_and_drops_nothing() -> None:
    enforce, monitor = drive(ips("enforce"), 40, 4), drive(ips("monitor"), 40, 4)
    assert all(o.drop_reason is None for o in monitor)
    would = [i for i, o in enumerate(monitor) if o.action == "rate_limit"]
    dropped = [i for i, o in enumerate(enforce) if o.action == "rate_limit"]
    assert would == dropped and all(monitor[i].applied is False for i in would)  # the same packets, recorded not applied


def test_the_detectors_still_see_every_packet_so_a_rate_limited_flood_still_escalates_to_a_block() -> None:
    engine = ips("enforce")
    outcomes = drive(engine, 40, 5) + drive(engine, 70, 6, start=5.0)
    assert any(o.action == "rate_limit" for o in outcomes)
    blocks = [o for o in outcomes if o.new_block is not None]
    assert len(blocks) == 1 and blocks[0].new_block.until == pytest.approx(blocks[0].new_block.until)
    assert any(a.finding.severity == "high" for o in outcomes for a in o.observation.alerts)  # HIGH was seen although dropping began earlier
    after = outcomes[outcomes.index(blocks[0]) + 1 :]
    assert after and all(o.drop_reason == "blocked_source" and o.from_block_table for o in after)


def test_rate_limiting_applies_to_the_offending_source_only() -> None:
    engine = ips("enforce")
    out = []
    for i in range(400):
        t = i / 40
        out.append(("atk", engine.process(syn(src=ATK, sport=10000 + i), t)))
        if i % 80 == 0:
            out.append(("user", engine.process(syn(src=USER, sport=20000 + i), t)))
    assert any(o.drop_reason == "rate_limited" for who, o in out if who == "atk")
    assert all(o.drop_reason is None and o.action is None for who, o in out if who == "user")


def test_allowlisted_sources_are_not_rate_limited() -> None:
    outcomes = drive(ips("enforce"), 40, 4, src="10.0.99.10")
    assert all(o.drop_reason is None for o in outcomes) and any(o.action == "allow" for o in outcomes)


def test_a_policy_can_choose_another_rate() -> None:
    policy = IpsPolicyConfig(
        allowlist=[], rules=[IpsRule(detector="D3", severity="medium", action="rate_limit", rate_pps=2, burst=2)]
    )
    engine = IpsEngine("enforce", load_detectors(), policy, Correlator())
    outcomes = drive(engine, 40, 4)
    first = next(i for i, o in enumerate(outcomes) if o.action == "rate_limit")
    later_pass = [o for o in outcomes[first:] if o.action is None]
    assert len(later_pass) <= 2 + 2 * 4  # burst 2 plus 2 pps over at most four seconds
