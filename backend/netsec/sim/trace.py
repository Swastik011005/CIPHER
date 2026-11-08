"""Trace recorder: validates events against the contract and keeps them ordered."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from netsec.sim.events import EVENT_MODELS, TraceEvent
from netsec.sim.scheduler import to_seconds


class TraceError(Exception):
    """Raised when an event would break the trace contract (unknown type, time going backwards)."""


class TraceRecorder:
    """Collects events as plain dicts with a gap-free ``seq`` starting at 0."""

    def __init__(self) -> None:
        self._events: list[TraceEvent] = []
        self._last_t_us = 0

    @property
    def events(self) -> list[TraceEvent]:
        return self._events

    def emit(self, event_type: str, t_us: int, **fields: Any) -> TraceEvent:
        """Validate and append one event at simulation time ``t_us`` (integer microseconds)."""
        model = EVENT_MODELS.get(event_type)
        if model is None:
            raise TraceError(f"unknown event type {event_type!r}")
        if t_us < self._last_t_us:
            raise TraceError(
                f"{event_type} at {t_us}us would move time backwards from {self._last_t_us}us"
            )
        self._last_t_us = t_us
        event = model(seq=len(self._events), t=to_seconds(t_us), **fields)
        record = event.model_dump(mode="json", by_alias=True)
        self._events.append(record)
        return record

    def digest(self) -> str:
        """SHA-256 of the canonical JSON of the whole trace (identical runs give identical digests)."""
        return trace_digest(self._events)


class SiemTraceRecorder(TraceRecorder):
    """A recorder that lets the simulated SIEM watch every event and write its own ``siem.event`` records right after.

    The SIEM only reacts to events the engine really wrote, so it cannot invent one. Its events share the instant of the event
    that caused them.
    """

    def __init__(self, collector: Any) -> None:
        super().__init__()
        self._collector = collector

    def emit(self, event_type: str, t_us: int, **fields: Any) -> TraceEvent:
        record = super().emit(event_type, t_us, **fields)
        if event_type != "siem.event":
            for payload in self._collector.observe(record):
                super().emit("siem.event", t_us, **payload)
        return record


def canonical_json(value: Any) -> str:
    """Compact, key-sorted JSON used for hashing."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def trace_digest(events: list[TraceEvent]) -> str:
    return hashlib.sha256(canonical_json(events).encode("utf-8")).hexdigest()
