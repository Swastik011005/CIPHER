"""What each core scenario is expected to do, as checks that can be run against a finished trace.

These are the Rev 3 "core scenario validation": for every scenario and IPS mode, a short list of statements
(an alert at exactly the sixth port, nothing ever dropped by IDS-1, a block that lasts 20 s, ...). They describe
the shipped rules. After a rule is edited the same checks still run, and the ones that no longer hold show
exactly what the edit changed: a failing "D1 raises MEDIUM and HIGH" row after D1 was disabled is the point.

A check is plain data plus one small function over the events, so the list is also what the Scenarios page shows
as the expected behaviour of each scenario.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from netsec.sim.engine import RunResult

Events = list[dict[str, Any]]


@dataclass(frozen=True)
class Check:
    id: str
    description: str
    expected: Any
    actual: Callable[[RunResult], Any]
    #: how to compare: "eq" (default) or "ge" (actual must be at least expected)
    compare: str = "eq"

    def run(self, result: RunResult) -> dict[str, Any]:
        value = self.actual(result)
        ok = value >= self.expected if self.compare == "ge" else value == self.expected
        return {"id": self.id, "description": self.description, "expected": _show(self.expected, self.compare), "actual": _show(value), "passed": bool(ok)}


def _show(value: Any, compare: str = "eq") -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    text = ", ".join(map(str, value)) if isinstance(value, (list, tuple)) else str(value)
    return f"at least {text}" if compare == "ge" else (text if text != "" else "none")


def _of(r: RunResult, kind: str) -> Events:
    return [e for e in r.events if e["type"] == kind]


def _alerts(r: RunResult, sensor: Optional[str] = None, rule: Optional[str] = None, severity: Optional[str] = None) -> Events:
    return [
        a
        for a in _of(r, "alert.raised")
        if (sensor is None or a["sensor"] == sensor) and (rule is None or a["rule"] == rule) and (severity is None or a["severity"] == severity)
    ]


def _drops(r: RunResult, *reasons: str) -> Events:
    return [d for d in _of(r, "packet.dropped") if not reasons or d["reason"] in reasons]


def _packets(r: RunResult) -> dict[int, dict[str, Any]]:
    return {e["pid"]: e for e in _of(r, "packet.created")}


def _evidence(r: RunResult, rule: str, sensor: str) -> list[int]:
    return [a["evidence"]["count"] for a in _alerts(r, sensor, rule)]


def _block_seconds(r: RunResult) -> list[float]:
    return [round(b["until"] - b["t"], 2) for b in _of(r, "block.added")]


def _user_delivery(r: RunResult, address: str) -> str:
    packets = _packets(r)
    ends = {e["pid"]: e["type"] for e in r.events if e["type"] in ("packet.delivered", "packet.dropped")}
    mine = [pid for pid, p in packets.items() if p["mirror_of"] is None and address in (p["src"], p["dst"])]
    delivered = sum(1 for pid in mine if ends.get(pid) == "packet.delivered")
    return f"{delivered} of {len(mine)} delivered"


def _all_user_delivered(r: RunResult, address: str) -> str:
    text = _user_delivery(r, address)
    a, _, b = text.partition(" of ")
    return "all delivered" if a == b.split(" ")[0] and int(a) > 0 else text


def _ids_never_acts(r: RunResult) -> int:
    copies = {pid for pid, p in _packets(r).items() if p["mirror_of"] is not None}
    bad = [
        e for e in r.events
        if (e["type"] in ("packet.dropped", "ips.action", "block.added", "block.expired", "policy.decision") and (e.get("node") == "IDS-1" or e.get("pid") in copies))
    ]
    return len(bad)


def _one_outcome_each(r: RunResult) -> str:
    s = r.stats
    total = s.delivered_clean + s.delivered_flagged + s.blocked + s.other_drop
    return "yes" if total == s.data_packets else f"{total} outcomes for {s.data_packets} packets"


UNIVERSAL = [
    Check("ids-passive", "IDS-1 never drops, blocks or acts on any packet", 0, _ids_never_acts),
    Check("one-outcome", "Every data packet ends in exactly one outcome", "yes", _one_outcome_each),
]


def _port_scan(mode: str) -> list[Check]:
    checks = [
        Check("d1-ids", "IDS-1 raises D1 MEDIUM at the 6th distinct port and HIGH at the 12th", [6, 12], lambda r: _evidence(r, "D1", "IDS-1")),
        Check("d1-ips", "IPS-1 raises D1 MEDIUM at the 6th distinct port and HIGH at the 12th", [6, 12], lambda r: _evidence(r, "D1", "IPS-1")),
        Check("incidents", "Both sensors' alerts are one incident", 1, lambda r: r.stats.incidents),
    ]
    if mode == "monitor":
        return checks + [
            Check("no-drops", "IPS-1 drops nothing in Monitor mode", 0, lambda r: len(_drops(r))),
            Check("would-block", "IPS-1 records that it would block, without applying it", True, lambda r: bool(_of(r, "ips.action")) and not any(a["applied"] for a in _of(r, "ips.action"))),
            Check("no-block", "No source is blocked", 0, lambda r: len(_of(r, "block.added"))),
        ]
    return checks + [
        Check("block", "IPS-1 blocks PC-2 once, for 20 s", [20.0], _block_seconds),
        Check("blocked", "24 of PC-2's packets are dropped at IPS-1 (1 drop, then the block table)", 24, lambda r: len(_drops(r, "ips_drop", "blocked_source"))),
        Check("only-ips", "Every drop happens at IPS-1", ["IPS-1"], lambda r: sorted({d["node"] for d in _drops(r)})),
    ]


def _unauthorized(mode: str) -> list[Check]:
    checks = [
        Check("acl-db", "The core ACL denies staff to the database with rule STAFF-IN:10", True, lambda r: any(d["rule_id"] == "STAFF-IN:10" and d["action"] == "deny" for d in _of(r, "policy.decision"))),
        Check("acl-sec", "The core ACL denies staff to the security network with rule STAFF-IN:20", True, lambda r: any(d["rule_id"] == "STAFF-IN:20" and d["action"] == "deny" for d in _of(r, "policy.decision"))),
        Check("fw", "FW1 denies the outside attacker (OUTSIDE-IN:implicit-deny) before any sensor sees it", True, lambda r: any(d["node"] == "FW1" and d["action"] == "deny" and d["rule_id"] == "OUTSIDE-IN:implicit-deny" for d in _of(r, "policy.decision"))),
        Check("d4-ids", "IDS-1 raises D4 for the denied staff-to-database attempt", True, lambda r: any(a["src"] == "10.0.10.11" for a in _alerts(r, "IDS-1", "D4"))),
        Check("d5-ids", "IDS-1 raises D5 for the staff-to-security attempt", 1, lambda r: len(_alerts(r, "IDS-1", "D5"))),
        Check("incidents", "Three incidents (one per source and target)", 3, lambda r: r.stats.incidents),
        Check("ips-sees-admin", "IPS-1 raises D4 for the admin-to-database connection (it passed the ACL)", 1, lambda r: len(_alerts(r, "IPS-1", "D4"))),
    ]
    if mode == "monitor":
        return checks + [
            Check("no-reject", "IPS-1 rejects nothing in Monitor mode (the connection goes through)", 0, lambda r: len(_drops(r, "ips_reject"))),
            Check("flagged", "The admin's connection is delivered but flagged", 1, lambda r: min(r.stats.delivered_flagged, 1)),
        ]
    return checks + [
        Check("reject", "IPS-1 rejects the admin's connection (ips_reject)", 1, lambda r: len(_drops(r, "ips_reject"))),
        Check("reset", "IPS-1 injects a TCP reset spoofed as the database", 1, lambda r: sum(1 for p in _packets(r).values() if p["flow"].endswith(":rst") and p["mirror_of"] is None)),
        Check("blocked", "Four packets are blocked in total (two ACL, one firewall, one IPS)", 4, lambda r: r.stats.blocked),
    ]


def _flood(mode: str) -> list[Check]:
    checks = [
        Check("d3-ids", "IDS-1 raises D3 MEDIUM then HIGH", ["medium", "high"], lambda r: [a["severity"] for a in _alerts(r, "IDS-1", "D3")]),
        Check("d3-ips", "IPS-1 raises D3 MEDIUM then HIGH", ["medium", "high"], lambda r: [a["severity"] for a in _alerts(r, "IPS-1", "D3")]),
        Check("incident", "The flood is one incident", 1, lambda r: r.stats.incidents),
        Check("user", "The ordinary user's packets are all delivered, whatever the flood does", "all delivered", lambda r: _all_user_delivered(r, "203.0.113.25")),
    ]
    if mode == "monitor":
        return checks + [Check("no-drops", "IPS-1 drops nothing in Monitor mode", 0, lambda r: len(_drops(r)))]
    return checks + [
        Check("limit", "IPS-1 rate-limits the flood before blocking it", True, lambda r: len(_drops(r, "rate_limited")) > 0),
        Check("block", "IPS-1 then blocks the attacker for 20 s", [20.0], _block_seconds),
        Check("only-ips", "Every drop happens at IPS-1", ["IPS-1"], lambda r: sorted({d["node"] for d in _drops(r)})),
    ]


def _brute_force(mode: str) -> list[Check]:
    checks = [
        Check("d2-ids", "IDS-1 raises D2 MEDIUM at the 6th attempt and HIGH at the 12th", [6, 12], lambda r: _evidence(r, "D2", "IDS-1")),
        Check("d2-ips", "IPS-1 raises D2 MEDIUM at the 6th attempt and HIGH at the 12th", [6, 12], lambda r: _evidence(r, "D2", "IPS-1")),
        Check("incident", "One incident", 1, lambda r: r.stats.incidents),
    ]
    if mode == "monitor":
        return checks + [Check("no-drops", "IPS-1 drops nothing in Monitor mode", 0, lambda r: len(_drops(r)))]
    return checks + [Check("block", "IPS-1 blocks PC-2 once, for 30 s", [30.0], _block_seconds)]


def _normal(mode: str) -> list[Check]:
    return [
        Check("no-alerts", "No alert is raised", 0, lambda r: r.stats.alerts),
        Check("no-blocks", "Nothing is blocked", 0, lambda r: r.stats.blocked),
        Check("all-clean", "Every packet is delivered and none is flagged", "yes", lambda r: "yes" if r.stats.delivered_clean == r.stats.data_packets and r.stats.delivered_flagged == 0 else "no"),
    ]


_BUILDERS: dict[str, Callable[[str], list[Check]]] = {
    "S1": _normal,
    "S2": _port_scan,
    "S3": _unauthorized,
    "S4": _flood,
    "S5": lambda _mode: _port_scan("monitor"),
    "S6": lambda _mode: _port_scan("enforce"),
    "S7": _brute_force,
}


def checks_for(scenario_id: str, mode: str) -> list[Check]:
    """The checks for one scenario in one IPS mode (pinned scenarios have only their own mode)."""
    build = _BUILDERS.get(scenario_id)
    return (build(mode) if build else []) + UNIVERSAL


def run_checks(scenario_id: str, mode: str, result: RunResult) -> list[dict[str, Any]]:
    return [c.run(result) for c in checks_for(scenario_id, mode)]


def expectation_text(scenario_id: str, mode: str) -> list[str]:
    """The descriptions only, for the scenario library."""
    return [c.description for c in checks_for(scenario_id, mode)]
