"""Deterministic discrete-event scheduler.

Time is kept as integer microseconds so equal timestamps compare exactly. Events that
share a timestamp run in a fixed order: by priority class, then by insertion order.
That total order is what makes a trace reproducible byte-for-byte.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from enum import IntEnum
from itertools import count
from typing import Callable

MICROS = 1_000_000


class Priority(IntEnum):
    """Same-timestamp ordering. Lower runs first.

    CONTROL  user/control changes apply before anything else at that instant.
    EXPIRY   timers (block expiry) fire before packets that arrive at the same instant.
    ARRIVE   packets finish crossing a link and are processed by the node.
    DEPART   packets start crossing the next link.
    SEND     hosts originate new packets.
    """

    CONTROL = 0
    EXPIRY = 10
    ARRIVE = 20
    DEPART = 30
    SEND = 40


def to_us(seconds: float) -> int:
    """Convert seconds to integer microseconds."""
    return round(seconds * MICROS)


def to_seconds(micros: int) -> float:
    """Convert integer microseconds to seconds, rounded to microsecond precision."""
    return round(micros / MICROS, 6)


@dataclass(order=True)
class _Item:
    t_us: int
    priority: int
    order: int
    action: Callable[[int], None] = field(compare=False)


class Scheduler:
    """Min-heap event queue ordered by ``(time, priority, insertion order)``."""

    def __init__(self) -> None:
        self._heap: list[_Item] = []
        self._order = count()
        self.now_us = 0
        self.processed = 0

    def schedule(self, t_us: int, priority: Priority, action: Callable[[int], None]) -> None:
        """Queue ``action(t_us)`` to run at ``t_us``. Scheduling in the past is a bug."""
        if t_us < self.now_us:
            raise ValueError(f"cannot schedule at {t_us}us; clock is already at {self.now_us}us")
        heapq.heappush(self._heap, _Item(t_us, int(priority), next(self._order), action))

    def run(self) -> None:
        """Process queued actions in order until the queue is empty."""
        while self._heap:
            item = heapq.heappop(self._heap)
            self.now_us = item.t_us
            item.action(item.t_us)
            self.processed += 1

    @property
    def pending(self) -> int:
        return len(self._heap)
