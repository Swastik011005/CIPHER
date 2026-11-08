"""Security state shared by the scenarios and the endpoint CLI.

One in-memory store per server (like the rule set): which endpoints are isolated, the trust of each device, the role of each user,
revoked permissions, and cumulative counters. A run reads an immutable ``SecuritySnapshot`` of it, so a run is deterministic;
the store changes only when an operator action or the CLI commits a result. It is reset by ``POST /api/state/reset`` or a restart.
Nothing here touches a real network or a real endpoint.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from typing import Any, Iterable

TRUST_LEVELS = ("trusted", "restricted", "untrusted")
ROLES = ("staff", "admin", "external")
HISTORY_LIMIT = 500


@dataclass(frozen=True)
class SecuritySnapshot:
    """What a run starts from. Frozen and hashable: it is part of a run's ``config_hash``."""

    isolated: tuple[str, ...] = ()
    trust: tuple[tuple[str, str], ...] = ()  # (device, level) where it differs from the default
    roles: tuple[tuple[str, str], ...] = ()  # (user, role) where it differs from the configured role
    revoked: tuple[str, ...] = ()  # "role:resource" permissions that were revoked

    def to_dict(self) -> dict[str, Any]:
        return {
            "isolated": list(self.isolated),
            "trust": dict(self.trust),
            "roles": dict(self.roles),
            "revoked": list(self.revoked),
        }

    def digest(self) -> str:
        return hashlib.sha256(json.dumps(self.to_dict(), sort_keys=True).encode("utf-8")).hexdigest()[:12]


EMPTY_SNAPSHOT = SecuritySnapshot()


class StateError(ValueError):
    """An operator action that is not valid (unknown device, unknown trust level, ...)."""


@dataclass
class SecurityState:
    """Mutable store. All methods are safe to call from request threads."""

    hosts: frozenset[str]
    users: frozenset[str]
    _isolated: set[str] = field(default_factory=set)
    _trust: dict[str, str] = field(default_factory=dict)
    _roles: dict[str, str] = field(default_factory=dict)
    _revoked: set[str] = field(default_factory=set)
    rule_hits: dict[str, int] = field(default_factory=dict)
    siem_history: list[dict[str, Any]] = field(default_factory=list)
    edr_history: list[dict[str, Any]] = field(default_factory=list)
    runs: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # -- snapshots -----------------------------------------------------------------------

    def snapshot(self) -> SecuritySnapshot:
        with self._lock:
            return SecuritySnapshot(
                tuple(sorted(self._isolated)),
                tuple(sorted(self._trust.items())),
                tuple(sorted(self._roles.items())),
                tuple(sorted(self._revoked)),
            )

    def reset(self) -> None:
        with self._lock:
            self._isolated.clear()
            self._trust.clear()
            self._roles.clear()
            self._revoked.clear()
            self.rule_hits.clear()
            self.siem_history.clear()
            self.edr_history.clear()
            self.runs = 0

    def apply(self, snapshot: SecuritySnapshot) -> None:
        """Make the store equal to ``snapshot`` (used to commit the end state of an operator action)."""
        with self._lock:
            self._isolated = set(snapshot.isolated)
            self._trust = dict(snapshot.trust)
            self._roles = dict(snapshot.roles)
            self._revoked = set(snapshot.revoked)

    # -- operator actions ----------------------------------------------------------------

    def _need_host(self, node: str) -> None:
        if node not in self.hosts:
            raise StateError(f"{node!r} is not an endpoint or server that can be managed")

    def isolate(self, node: str) -> None:
        self._need_host(node)
        with self._lock:
            self._isolated.add(node)

    def restore(self, node: str) -> None:
        self._need_host(node)
        with self._lock:
            self._isolated.discard(node)

    def set_trust(self, node: str, level: str) -> None:
        self._need_host(node)
        if level not in TRUST_LEVELS:
            raise StateError(f"trust must be one of {list(TRUST_LEVELS)}")
        with self._lock:
            if level == "trusted":
                self._trust.pop(node, None)
            else:
                self._trust[node] = level

    def set_role(self, user: str, role: str) -> None:
        if user not in self.users:
            raise StateError(f"unknown user {user!r}")
        if role not in ROLES:
            raise StateError(f"role must be one of {list(ROLES)}")
        with self._lock:
            self._roles[user] = role

    def revoke(self, role: str, resource: str) -> None:
        with self._lock:
            self._revoked.add(f"{role}:{resource}")

    def grant(self, role: str, resource: str) -> None:
        with self._lock:
            self._revoked.discard(f"{role}:{resource}")

    # -- counters and history ------------------------------------------------------------

    def record_run(self, events: Iterable[dict[str, Any]]) -> None:
        """Add a finished run's rule hits and SIEM/EDR events to the cumulative counters and history."""
        with self._lock:
            self.runs += 1
            for event in events:
                kind = event["type"]
                if kind == "policy.decision" and not event["via_conntrack"]:
                    key = f"{event['node']}:{event['rule_id']}:{event['action']}"
                    self.rule_hits[key] = self.rule_hits.get(key, 0) + 1
                elif kind == "siem.event":
                    self.siem_history.append(event)
                elif kind in ("edr.alert", "edr.state"):
                    self.edr_history.append(event)
            del self.siem_history[:-HISTORY_LIMIT]
            del self.edr_history[:-HISTORY_LIMIT]

    def to_dict(self) -> dict[str, Any]:
        snap = self.snapshot()
        with self._lock:
            return {
                **snap.to_dict(),
                "digest": snap.digest(),
                "rule_hits": dict(sorted(self.rule_hits.items())),
                "runs": self.runs,
                "siem_events": len(self.siem_history),
                "edr_events": len(self.edr_history),
            }
