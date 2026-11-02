"""Drop paths in the engine, and the statistics definitions."""

from __future__ import annotations

import pytest

from netsec.analysis.stats import StatsError, compute_stats
from netsec.network.routing import RouteTable
from netsec.sim.engine import Engine, EngineError
from netsec.sim.scheduler import Priority, to_us
from netsec.traffic.packet import PacketSpec, tcp_flags
from netsec.traffic.scenarios import ScenarioSpec


def _syn(graph, src: str = "PC-1", dst: str = "APP-SRV") -> PacketSpec:
    return PacketSpec(
        flow="probe", proto="tcp", src=graph.interface(src, "eth0").ip, dst=graph.interface(dst, "eth0").ip,
        sport=50000, dport=443, flags=tcp_flags("SYN"), length=44, seq=1,
    )


def _run_probe(engine: Engine) -> list[dict]:
    engine.scheduler.run()
    return engine.trace.events


def test_ttl_expiry_is_dropped_at_the_router(graph, monkeypatch) -> None:
    monkeypatch.setattr("netsec.sim.engine.DEFAULT_TTL", 1)
    engine = Engine(graph, seed=1)
    engine._schedule_send(0, _syn(graph))
    events = _run_probe(engine)
    dropped = [e for e in events if e["type"] == "packet.dropped"]
    assert [(d["node"], d["reason"]) for d in dropped] == [("CORE-SW1", "ttl_expired")]
    # The packet really travelled to CORE-SW1 first, and no further.
    assert [e["to"] for e in events if e["type"] == "packet.hop" and e["pid"] == 1] == ["ACC-SW2", "CORE-SW1"]
    assert not any(e["type"] == "packet.delivered" and e["pid"] == 1 for e in events)


def test_missing_route_is_dropped_at_the_sender(graph) -> None:
    engine = Engine(graph, seed=1)
    engine.tables["PC-1"] = RouteTable(
        "PC-1", [e for e in engine.tables["PC-1"].entries if e.source == "connected"]
    )
    engine._schedule_send(0, _syn(graph))
    events = _run_probe(engine)
    assert [e["type"] for e in events] == ["packet.created", "packet.dropped"]
    assert (events[1]["node"], events[1]["reason"]) == ("PC-1", "no_route")


def test_drops_are_counted_in_the_right_bucket(graph, monkeypatch) -> None:
    monkeypatch.setattr("netsec.sim.engine.DEFAULT_TTL", 1)
    engine = Engine(graph, seed=1)
    engine._schedule_send(0, _syn(graph))
    stats = compute_stats(_run_probe(engine))
    assert (stats.data_packets, stats.other_drop, stats.blocked, stats.delivered_clean) == (1, 1, 0, 0)
    assert stats.mirrored == 1  # the packet was mirrored on entering CORE-SW1 before it was dropped there


def test_scenario_that_overruns_its_duration_is_an_error(graph, s1) -> None:
    short = ScenarioSpec.model_validate({**s1.model_dump(), "duration": 5.0})
    with pytest.raises(EngineError, match="declares duration"):
        Engine(graph, 1).run(short)


def test_scenario_referencing_a_non_host_is_an_error(graph, s1) -> None:
    bad_flow = {**s1.flows[0].model_dump(), "src": "ACC-SW2"}
    bad = ScenarioSpec.model_validate({**s1.model_dump(), "flows": [bad_flow]})
    with pytest.raises(EngineError, match="not a host"):
        Engine(graph, 1).run(bad)


# -- statistics definitions (pure functions of the trace) -------------------------------


def _created(pid: int, mirror_of=None) -> dict:
    return {"type": "packet.created", "pid": pid, "mirror_of": mirror_of}


def test_stats_bucket_every_packet_exactly_once() -> None:
    events = [
        _created(1), {"type": "packet.delivered", "pid": 1},
        _created(2), {"type": "packet.delivered", "pid": 2},
        {"type": "inspect.result", "pid": 2, "classification": "suspicious"},
        _created(3), {"type": "packet.dropped", "pid": 3, "reason": "ips_drop"},
        _created(4), {"type": "packet.dropped", "pid": 4, "reason": "fw_deny"},
        _created(5), {"type": "packet.dropped", "pid": 5, "reason": "ttl_expired"},
        _created(6, mirror_of=1), {"type": "packet.delivered", "pid": 6},
        _created(7), {"type": "syslog.sent", "pid": 7}, {"type": "packet.delivered", "pid": 7},
        {"type": "alert.raised", "incident_id": "INC-1"},
        {"type": "alert.raised", "incident_id": "INC-1"},
        {"type": "alert.raised", "incident_id": "INC-2"},
    ]
    s = compute_stats(events)
    assert s.data_packets == 5
    assert (s.delivered_clean, s.delivered_flagged, s.blocked, s.other_drop) == (1, 1, 2, 1)
    assert (s.mirrored, s.management) == (1, 1)
    assert (s.alerts, s.incidents) == (3, 2)  # two sensors, one incident
    assert s.data_packets == s.delivered_clean + s.delivered_flagged + s.blocked + s.other_drop


def test_monitor_mode_would_block_counts_as_delivered_flagged() -> None:
    events = [
        _created(1), {"type": "ips.action", "pid": 1, "action": "drop", "applied": False},
        {"type": "packet.delivered", "pid": 1},
    ]
    s = compute_stats(events)
    assert (s.delivered_flagged, s.blocked) == (1, 0)


def test_packet_without_an_outcome_is_an_error() -> None:
    with pytest.raises(StatsError, match="no delivered/dropped outcome"):
        compute_stats([_created(1)])


def test_packet_with_two_outcomes_is_an_error() -> None:
    with pytest.raises(StatsError, match="both delivered and dropped"):
        compute_stats(
            [_created(1), {"type": "packet.delivered", "pid": 1}, {"type": "packet.dropped", "pid": 1, "reason": "no_route"}]
        )
