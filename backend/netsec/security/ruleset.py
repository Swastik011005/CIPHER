"""The rules the engine runs with, and the one place they are edited.

A :class:`RuleSet` is the detector thresholds, the IPS policy and the firewall/ACL policy files, as one frozen
value. The engine takes a rule set per run, so a run always uses exactly one consistent set and the same set
always gives the same trace. Because the rule set is part of ``config_hash`` (and so of ``run.meta``), a trace
says which rules it was produced with: change a rule and the hash changes; change it back and the hash returns.

:class:`RuleStore` holds the current rule set for the running server. Edits are validated here, applied to the
store (not to the JSON files, which stay the shipped defaults), and picked up by the next run. Restarting the
server, or calling ``reset``, returns to the shipped defaults.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from ipaddress import IPv4Address, IPv4Network
from typing import Any, Optional

from pydantic import ValidationError

from netsec.security.config import (
    DetectorsConfig,
    IpsPolicyConfig,
    INVALID_FLAG_SIGNATURES,
    load_detectors,
    load_ips_policy,
)
from netsec.security.policy.models import Policy, PolicyFile, load_policies
from netsec.sim.trace import canonical_json


class RuleError(ValueError):
    """An edit was refused. ``problems`` lists every reason, each naming the field it is about."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class RuleSet:
    detectors: DetectorsConfig
    ips_policy: IpsPolicyConfig
    policies: tuple[PolicyFile, ...]

    @classmethod
    def shipped(cls) -> "RuleSet":
        """The rules that ship in ``backend/config``."""
        return cls(load_detectors(), load_ips_policy(), tuple(load_policies()))

    def digest(self) -> str:
        """Short hash of every rule, so two rule sets can be compared at a glance."""
        body = canonical_json(
            {
                "detectors": self.detectors.model_dump(mode="json"),
                "ips_policy": self.ips_policy.model_dump(mode="json"),
                "policies": [p.model_dump(mode="json") for p in self.policies],
            }
        )
        return hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]

    @property
    def restricted_ips(self) -> list[str]:
        return sorted({ip for f in self.policies for ip in f.restricted_ips}, key=lambda s: IPv4Address(s))


# -- what may be edited, and within which limits ------------------------------------------------------------

#: detector id -> field -> (minimum, maximum), for the numeric fields a user may change.
LIMITS: dict[str, dict[str, tuple[float, float]]] = {
    "D1": {"window_s": (1, 60), "suspicious": (2, 50), "violation": (3, 100), "suppression_s": (0, 300)},
    "D2": {"window_s": (5, 120), "suspicious": (2, 50), "violation": (3, 100), "suppression_s": (0, 300)},
    "D3": {"window_s": (1, 30), "suspicious_pps": (1, 500), "violation_pps": (2, 1000), "suppression_s": (0, 300)},
    "D4": {"suppression_s": (0, 300)},
    "D5": {"suppression_s": (0, 300)},
    "D6": {"suppression_s": (0, 300)},
}
#: fields that are switches or lists rather than numbers
OTHER_EDITABLE = {"D1": {"enabled"}, "D2": {"enabled", "ports"}, "D3": {"enabled"}, "D4": {"enabled"}, "D5": {"enabled"}, "D6": {"enabled", "signatures"}}
MAX_RESTRICTED_IPS = 20


def _editable(detector: str) -> set[str]:
    return set(LIMITS[detector]) | OTHER_EDITABLE[detector]


def _check_detector_patch(detector: str, patch: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    if detector not in LIMITS:
        return [f"{detector}: no such detector (D1 to D6)"]
    if not isinstance(patch, dict) or not patch:
        return [f"{detector}: give at least one field to change"]
    for name, value in patch.items():
        if name not in _editable(detector):
            problems.append(f"{detector}.{name}: cannot be edited here (editable: {', '.join(sorted(_editable(detector)))})")
            continue
        if name == "enabled":
            if not isinstance(value, bool):
                problems.append(f"{detector}.enabled: must be true or false")
        elif name == "ports":
            if not (isinstance(value, list) and 1 <= len(value) <= 10 and all(isinstance(p, int) and not isinstance(p, bool) and 1 <= p <= 65535 for p in value) and len(set(value)) == len(value)):
                problems.append(f"{detector}.ports: give 1 to 10 different port numbers from 1 to 65535")
        elif name == "signatures":
            if not (isinstance(value, list) and 1 <= len(value) and all(v in INVALID_FLAG_SIGNATURES for v in value) and len(set(value)) == len(value)):
                problems.append(f"{detector}.signatures: choose one or more of {', '.join(INVALID_FLAG_SIGNATURES)}")
        else:
            lo, hi = LIMITS[detector][name]
            integer_field = name in ("suspicious", "violation")
            ok = isinstance(value, (int, float)) and not isinstance(value, bool) and lo <= value <= hi
            if ok and integer_field and int(value) != value:
                ok = False
            if not ok:
                kind = "a whole number" if integer_field else "a number"
                problems.append(f"{detector}.{name}: must be {kind} from {lo:g} to {hi:g}")
    return problems


def _restricted_problems(addresses: Any, allowlist: IpsPolicyConfig) -> list[str]:
    if not isinstance(addresses, list):
        return ["restricted_ips: must be a list of IPv4 addresses"]
    problems: list[str] = []
    if len(addresses) > MAX_RESTRICTED_IPS:
        problems.append(f"restricted_ips: at most {MAX_RESTRICTED_IPS} addresses")
    seen: set[str] = set()
    for raw in addresses:
        try:
            if not isinstance(raw, str):
                raise ValueError
            ip = IPv4Address(raw.strip())
        except ValueError:
            problems.append(f"restricted_ips: {raw!r} is not an IPv4 address (use a form like 203.0.113.99)")
            continue
        text = str(ip)
        if text in seen:
            problems.append(f"restricted_ips: {text} is listed twice")
        seen.add(text)
        if ip.is_loopback or ip.is_multicast or ip.is_unspecified or ip.is_reserved or text == "255.255.255.255":
            problems.append(f"restricted_ips: {text} is not an address a host can send from")
        elif IPv4Address(text) in IPv4Network("10.0.0.0/8"):
            problems.append(f"restricted_ips: {text} is inside the campus; FW1 only filters traffic that arrives from outside")
        elif allowlist.is_allowlisted(text):
            problems.append(f"restricted_ips: {text} is on the IPS allowlist (infrastructure) and can never be restricted")
    return problems


class RuleStore:
    """The current rules for a running server. Thread-safe; every edit is validated before it is applied."""

    def __init__(self, defaults: Optional[RuleSet] = None) -> None:
        self._lock = threading.Lock()
        self._defaults = defaults or RuleSet.shipped()
        self._current = self._defaults
        self.revision = 0

    @property
    def defaults(self) -> RuleSet:
        return self._defaults

    @property
    def current(self) -> RuleSet:
        with self._lock:
            return self._current

    @property
    def customised(self) -> bool:
        return self.current.digest() != self._defaults.digest()

    def update_detectors(self, patch: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        """Apply a partial edit of the detector settings, e.g. ``{"D1": {"enabled": False, "suspicious": 8}}``.

        Returns what changed. Raises :class:`RuleError` (and changes nothing) if any part of the edit is invalid.
        """
        if not isinstance(patch, dict) or not patch:
            raise RuleError(["detectors: give at least one detector to change"])
        problems: list[str] = []
        for detector, fields in patch.items():
            problems += _check_detector_patch(detector, fields)
        if problems:
            raise RuleError(problems)

        with self._lock:
            before = self._current.detectors
            merged = before.model_dump()
            for detector, fields in patch.items():
                merged[detector].update(fields)
            try:
                after = DetectorsConfig.model_validate(merged)
            except ValidationError as exc:
                raise RuleError([_describe(e) for e in exc.errors()]) from exc
            changes = [
                {"detector": d, "field": f, "from": getattr(getattr(before, d), f), "to": getattr(getattr(after, d), f)}
                for d, fields in patch.items()
                for f in fields
                if getattr(getattr(before, d), f) != getattr(getattr(after, d), f)
            ]
            if changes:
                self._current = RuleSet(after, self._current.ips_policy, self._current.policies)
                self.revision += 1
            return changes

    def set_restricted_ips(self, addresses: list[str]) -> list[str]:
        """Replace the restricted source addresses FW1 denies. Returns the list now in force."""
        with self._lock:
            problems = _restricted_problems(addresses, self._current.ips_policy)
            if problems:
                raise RuleError(problems)
            clean = sorted({str(IPv4Address(a.strip())) for a in addresses}, key=lambda s: IPv4Address(s))
            if clean == self._current_restricted():
                return clean
            files = list(self._current.policies)
            # The restricted list belongs to the firewall policy file (the one with the OUTSIDE-IN policy).
            index = next(i for i, f in enumerate(files) if any(p.name == "OUTSIDE-IN" for p in f.policies))
            files = [f.model_copy(update={"restricted_ips": []}) if i != index else f.model_copy(update={"restricted_ips": clean}) for i, f in enumerate(files)]
            self._current = RuleSet(self._current.detectors, self._current.ips_policy, tuple(files))
            self.revision += 1
            return clean

    def reset(self) -> bool:
        """Back to the shipped defaults. Returns True if anything was different."""
        with self._lock:
            changed = self._current.digest() != self._defaults.digest()
            self._current = self._defaults
            if changed:
                self.revision += 1
            return changed

    def _current_restricted(self) -> list[str]:
        return sorted({ip for f in self._current.policies for ip in f.restricted_ips}, key=lambda s: IPv4Address(s))


def _describe(error: dict[str, Any]) -> str:
    where = ".".join(str(p) for p in error["loc"])
    message = str(error["msg"]).replace("Value error, ", "")
    return f"{where}: {message}"


def policy_view(policy: Policy) -> dict[str, Any]:
    """A policy as the Rules page shows it: ordered rules plus the implicit deny that always ends the list."""
    return {
        "name": policy.name,
        "node": policy.node,
        "ingress_link": policy.ingress_link,
        "vlan": policy.vlan,
        "stateful": policy.stateful,
        "rules": [r.model_dump() for r in policy.rules],
        "implicit_deny": {"id": "implicit-deny", "action": "deny", "description": "Anything no rule above permits is denied"},
    }
