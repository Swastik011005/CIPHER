"""Scenario S1: normal communication. Stage 1 has no detection or prevention, so the
expectations are about forwarding, mirroring, determinism and the trace contract."""

from __future__ import annotations

from collections import Counter, defaultdict

import pytest

from netsec.analysis.stats import compute_stats
from netsec.sim.engine import run_scenario


@pytest.fixture(scope="module")
def result(graph, s1):
    return run_scenario(graph, s1)


def _by_type(events, kind):
    return [e for e in events if e["type"] == kind]


def test_same_seed_gives_an_identical_trace(graph, s1, result) -> None:
    again = run_scenario(graph, s1)
    assert again.trace_hash == result.trace_hash
    assert again.events == result.events


def test_different_seed_changes_the_trace_but_not_the_routes(graph, s1, result) -> None:
    other = run_scenario(graph, s1, seed=99)
    assert other.trace_hash != result.trace_hash
    def routes(r):
        return sorted({(e["flow"], e["src"], e["dst"]) for e in _by_type(r.events, "packet.created")})
    assert routes(other) == routes(result)
    assert other.stats == result.stats


def test_events_are_ordered_by_time_and_sequence(result) -> None:
    assert [e["seq"] for e in result.events] == list(range(len(result.events)))
    times = [e["t"] for e in result.events]
    assert times == sorted(times)


def test_run_meta_first_and_run_end_last(result) -> None:
    assert result.events[0]["type"] == "run.meta" and result.events[0]["t"] == 0.0
    assert result.events[0]["scenario_id"] == "S1" and result.events[0]["ips_mode"] == "monitor"
    assert result.events[-1]["type"] == "run.end" and result.events[-1]["t"] == result.duration


def test_trace_finishes_inside_the_declared_duration(result) -> None:
    body = result.events[:-1]
    assert max(e["t"] for e in body) <= result.duration


def test_only_stage_1_event_types_are_emitted(result, event_contract) -> None:
    assert {e["type"] for e in result.events} <= set(event_contract["emitted_in_stage_1"])


def test_no_security_decisions_exist_in_stage_1(result) -> None:
    kinds = Counter(e["type"] for e in result.events)
    for later in ("alert.raised", "ips.action", "block.added", "inspect.result", "policy.decision"):
        assert kinds[later] == 0
    assert kinds["packet.dropped"] == 0


def test_every_packet_has_exactly_one_terminal_event(result) -> None:
    created = {e["pid"] for e in _by_type(result.events, "packet.created")}
    terminal = Counter(
        e["pid"] for e in result.events if e["type"] in ("packet.delivered", "packet.dropped")
    )
    assert set(terminal) == created
    assert set(terminal.values()) == {1}


def test_https_session_takes_the_designed_path_with_correct_ttl_and_vlans(result) -> None:
    syn = next(e for e in _by_type(result.events, "packet.created") if e["flow"] == "F1-https")
    hops = [e for e in _by_type(result.events, "packet.hop") if e["pid"] == syn["pid"]]
    assert [h["from"] for h in hops] + [hops[-1]["to"]] == [
        "PC-1", "ACC-SW2", "CORE-SW1", "IPS-1", "SRV-SW3", "APP-SRV",
    ]
    assert [h["ttl"] for h in hops] == [64, 64, 63, 63, 63]  # decremented once, at CORE-SW1
    assert [h["vlan"] for h in hops] == [10, 10, 30, 30, 30]
    assert hops[1]["link"] == "L06"  # ACC-SW2 -> CORE-SW1 trunk, tagged VLAN 10


def test_hops_are_contiguous_and_arrive_after_they_depart(result) -> None:
    hops_by_pid = defaultdict(list)
    for e in _by_type(result.events, "packet.hop"):
        hops_by_pid[e["pid"]].append(e)
    for hops in hops_by_pid.values():
        for a, b in zip(hops, hops[1:]):
            assert a["to"] == b["from"]
            assert b["t"] >= a["t_arrive"]
        assert all(h["t_arrive"] > h["t"] for h in hops)


def test_each_packet_entering_the_core_is_mirrored_exactly_once(result) -> None:
    entering_core = Counter(
        e["pid"] for e in _by_type(result.events, "packet.hop") if e["to"] == "CORE-SW1"
    )
    assert entering_core and set(entering_core.values()) == {1}
    originals_created = {
        e["pid"] for e in _by_type(result.events, "packet.created") if e["mirror_of"] is None
    }
    mirrored = _by_type(result.events, "packet.mirrored")
    assert sorted(m["pid"] for m in mirrored) == sorted(entering_core)
    assert all(m["at"] == "CORE-SW1" and m["to"] == "IDS-1" for m in mirrored)
    assert {m["pid"] for m in mirrored} <= originals_created


def test_mirror_copies_travel_only_over_the_span_link_and_stop_at_the_sensor(result) -> None:
    copies = {e["pid"]: e for e in _by_type(result.events, "packet.created") if e["mirror_of"]}
    assert len(copies) == len(_by_type(result.events, "packet.mirrored"))
    for pid, created in copies.items():
        hops = [e for e in _by_type(result.events, "packet.hop") if e["pid"] == pid]
        assert [(h["link"], h["from"], h["to"]) for h in hops] == [("L11", "CORE-SW1", "IDS-1")]
        end = [e for e in result.events if e["type"] in ("packet.delivered", "packet.dropped") and e["pid"] == pid]
        assert [(e["type"], e["node"]) for e in end] == [("packet.delivered", "IDS-1")]
        original = next(
            e for e in _by_type(result.events, "packet.created") if e["pid"] == created["mirror_of"]
        )
        for field in ("flow", "proto", "src", "dst", "sport", "dport", "flags", "len"):
            assert created[field] == original[field]


def test_ids_is_passive_nothing_ever_happens_to_a_packet_at_ids1_except_arrival(result) -> None:
    at_ids = [e for e in result.events if e.get("node") == "IDS-1" or e.get("from") == "IDS-1"]
    assert {e["type"] for e in at_ids} == {"packet.delivered"}
    # And no original packet ever visits IDS-1.
    originals = {e["pid"] for e in _by_type(result.events, "packet.created") if e["mirror_of"] is None}
    assert not [e for e in _by_type(result.events, "packet.hop") if e["pid"] in originals and "IDS-1" in (e["from"], e["to"])]


def test_application_to_database_traffic_is_invisible_to_the_ids(result) -> None:
    db_flow = {e["pid"] for e in _by_type(result.events, "packet.created") if e["flow"] == "F4-mysql"}
    mirrored = {m["pid"] for m in _by_type(result.events, "packet.mirrored")}
    assert db_flow and not (db_flow & mirrored)  # same-VLAN traffic never enters CORE-SW1


def test_all_sessions_complete_and_pings_are_answered(result) -> None:
    for flow in ("F1-https", "F3-ssh", "F4-mysql"):
        created = [
            e for e in _by_type(result.events, "packet.created")
            if e["flow"] == flow and e["mirror_of"] is None
        ]
        assert len(created) == 8  # SYN, SYN-ACK, ACK, request, response, FIN, FIN-ACK, ACK
        assert sorted(tuple(e["flags"]) for e in created)[0] == ("ACK",)
    pings = [
        e for e in _by_type(result.events, "packet.created")
        if e["flow"] == "F2-ping" and e["mirror_of"] is None
    ]
    assert Counter(e["icmp"]["type"] for e in pings) == {8: 3, 0: 3}


def test_tls_and_ssh_payloads_are_labelled_encrypted(result) -> None:
    apps = [e["app"] for e in _by_type(result.events, "packet.created") if e["app"]]
    assert apps and all(a["encrypted"] == (a["proto"] in ("HTTPS", "SSH")) for a in apps)
    assert all(a["summary"] == "Encrypted application data" for a in apps if a["encrypted"])


def test_run_end_statistics_match_the_trace(result) -> None:
    stats = compute_stats(result.events[:-1])
    assert stats == result.stats == type(result.stats)(**result.events[-1]["stats"])
    assert stats.data_packets == 30 and stats.delivered_clean == 30
    assert (stats.delivered_flagged, stats.blocked, stats.other_drop) == (0, 0, 0)
    assert stats.mirrored == 22 and stats.management == 0
    assert (stats.alerts, stats.incidents) == (0, 0)
    assert stats.data_packets == (
        stats.delivered_clean + stats.delivered_flagged + stats.blocked + stats.other_drop
    )
