"""Endpoint detection and response (EDR), simulated.

Each PC, laptop and server has a simulated EDR agent with a state: healthy, suspicious, compromised or isolated. A scenario can
mark an endpoint suspicious or compromised (the simulation of an attacker succeeding); the agent then reports to EDR-MGMT-1.
The operator can isolate an endpoint and restore it. While an endpoint is isolated the engine drops its traffic, except
traffic to and from EDR-MGMT-1, so containment changes the network decisions immediately. No malware and no operating-system
process is involved: it is a state machine plus the rules above.
"""

from __future__ import annotations

from typing import Iterable

MANAGER = "EDR-MGMT-1"


class EdrEngine:
    def __init__(self, endpoints: Iterable[str], isolated: Iterable[str] = ()) -> None:
        self._state: dict[str, str] = {e: "healthy" for e in endpoints}
        for node in isolated:
            if node in self._state:
                self._state[node] = "isolated"
        self._alerts = 0

    def state_of(self, node: str) -> str:
        return self._state.get(node, "healthy")

    def is_isolated(self, node: str) -> bool:
        return self._state.get(node) == "isolated"

    def known(self, node: str) -> bool:
        return node in self._state

    def new_alert_id(self) -> str:
        self._alerts += 1
        return f"EDR-{self._alerts:04d}"

    def mark(self, node: str, state: str) -> None:
        """Set suspicious or compromised (an isolated endpoint stays isolated)."""
        if not self.is_isolated(node):
            self._state[node] = state

    def isolate(self, node: str) -> bool:
        """Isolate an endpoint. Returns False if it already was."""
        if self.is_isolated(node):
            return False
        self._state[node] = "isolated"
        return True

    def restore(self, node: str) -> bool:
        """Lift the isolation; the endpoint is healthy again. Returns False if it was not isolated."""
        if not self.is_isolated(node):
            return False
        self._state[node] = "healthy"
        return True

    def allows(self, src_node: str | None, dst_node: str | None) -> bool:
        """May traffic pass between these two endpoints? An isolated endpoint may talk only to the EDR manager."""
        for end, other in ((src_node, dst_node), (dst_node, src_node)):
            if end is not None and self.is_isolated(end) and other != MANAGER:
                return False
        return True
