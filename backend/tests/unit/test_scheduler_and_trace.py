"""Scheduler ordering and the trace recorder."""

from __future__ import annotations

import pytest

from netsec.sim.scheduler import Priority, Scheduler, to_seconds, to_us
from netsec.sim.trace import TraceError, TraceRecorder, trace_digest


def test_events_run_in_time_order() -> None:
    order: list[str] = []
    sched = Scheduler()
    sched.schedule(to_us(2), Priority.SEND, lambda t: order.append("late"))
    sched.schedule(to_us(1), Priority.SEND, lambda t: order.append("early"))
    sched.run()
    assert order == ["early", "late"]


def test_same_timestamp_is_ordered_by_priority_class() -> None:
    order: list[str] = []
    sched = Scheduler()
    t = to_us(1.0)
    # Scheduled in the "wrong" order on purpose.
    sched.schedule(t, Priority.SEND, lambda _: order.append("send"))
    sched.schedule(t, Priority.DEPART, lambda _: order.append("depart"))
    sched.schedule(t, Priority.ARRIVE, lambda _: order.append("arrive"))
    sched.schedule(t, Priority.EXPIRY, lambda _: order.append("expiry"))
    sched.schedule(t, Priority.CONTROL, lambda _: order.append("control"))
    sched.run()
    assert order == ["control", "expiry", "arrive", "depart", "send"]


def test_same_timestamp_same_priority_keeps_insertion_order() -> None:
    order: list[int] = []
    sched = Scheduler()
    for i in range(20):
        sched.schedule(to_us(1), Priority.ARRIVE, lambda _, i=i: order.append(i))
    sched.run()
    assert order == list(range(20))


def test_events_scheduled_during_a_run_at_the_same_instant_still_run() -> None:
    order: list[str] = []
    sched = Scheduler()

    def first(t: int) -> None:
        order.append("first")
        sched.schedule(t, Priority.SEND, lambda _: order.append("spawned"))

    sched.schedule(to_us(1), Priority.ARRIVE, first)
    sched.run()
    assert order == ["first", "spawned"]


def test_scheduling_in_the_past_is_an_error() -> None:
    sched = Scheduler()
    sched.schedule(to_us(5), Priority.SEND, lambda _: None)
    sched.run()
    with pytest.raises(ValueError, match="clock"):
        sched.schedule(to_us(1), Priority.SEND, lambda _: None)


def test_time_conversion_round_trips_at_microsecond_precision() -> None:
    assert to_us(0.35) == 350_000
    assert to_seconds(to_us(1.234567)) == 1.234567
    assert to_us(0.1) + to_us(0.2) == to_us(0.3)  # integers: no float drift


def _delivered(rec: TraceRecorder, t_us: int, pid: int) -> None:
    rec.emit("packet.delivered", t_us, pid=pid, node="APP-SRV")


def test_trace_sequence_numbers_are_gap_free_from_zero() -> None:
    rec = TraceRecorder()
    for i in range(5):
        _delivered(rec, i * 1000, i)
    assert [e["seq"] for e in rec.events] == [0, 1, 2, 3, 4]


def test_trace_rejects_unknown_event_types_and_bad_fields() -> None:
    rec = TraceRecorder()
    with pytest.raises(TraceError, match="unknown event type"):
        rec.emit("packet.teleported", 0)
    with pytest.raises(ValueError):
        rec.emit("packet.dropped", 0, pid=1, node="X", reason="not-a-reason")
    with pytest.raises(ValueError):
        rec.emit("packet.delivered", 0, pid=1, node="X", extra_field=1)
    assert rec.events == []  # nothing invalid was recorded


def test_trace_time_cannot_move_backwards() -> None:
    rec = TraceRecorder()
    _delivered(rec, 2000, 1)
    with pytest.raises(TraceError, match="backwards"):
        _delivered(rec, 1000, 2)
    _delivered(rec, 2000, 3)  # equal time is allowed


def test_trace_digest_is_stable_and_sensitive() -> None:
    def build(pid: int) -> TraceRecorder:
        rec = TraceRecorder()
        _delivered(rec, 1000, pid)
        return rec

    assert build(1).digest() == build(1).digest()
    assert build(1).digest() != build(2).digest()
    assert build(1).digest() == trace_digest(build(1).events)
