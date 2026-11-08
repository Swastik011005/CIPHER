"""Run statistics derived from a trace.

One definition, used by the backend (``run.end``) and re-implemented by the frontend
reducers; tests assert the two agree.

* Only data-plane packets are counted. SPAN mirror copies are counted separately as
  ``mirrored`` and syslog packets as ``management``.
* Every data-plane packet ends in exactly one bucket:
    - ``delivered_clean``   delivered and never flagged by a sensor
    - ``delivered_flagged`` delivered after being flagged (for example in Monitor mode)
    - ``blocked``           dropped by policy: fw_deny, acl_deny, ips_drop, ips_reject,
                            blocked_source, rate_limited, and (campus extension) edr_isolated, zt_deny
    - ``other_drop``        dropped for network reasons: ttl_expired, no_route
* ``alerts`` counts raw ``alert.raised`` events; ``incidents`` counts distinct incident ids
  (the unit presented to users as a threat).
"""

from __future__ import annotations

from netsec.sim.events import RunStats, TraceEvent

BLOCKED_REASONS = frozenset(
    {"fw_deny", "acl_deny", "ips_drop", "ips_reject", "blocked_source", "rate_limited", "edr_isolated", "zt_deny"}
)
OTHER_DROP_REASONS = frozenset({"ttl_expired", "no_route"})


class StatsError(Exception):
    """The trace violates a counting invariant (for example a packet with no outcome)."""


def compute_stats(events: list[TraceEvent]) -> RunStats:
    created: set[int] = set()
    mirror_copies: set[int] = set()
    management: set[int] = set()
    delivered: set[int] = set()
    dropped: dict[int, str] = {}
    flagged: set[int] = set()
    alerts = 0
    incidents: set[str] = set()

    for event in events:
        kind = event["type"]
        if kind == "packet.created":
            if event["mirror_of"] is not None:
                mirror_copies.add(event["pid"])
            else:
                created.add(event["pid"])
        elif kind == "syslog.sent":
            management.add(event["pid"])
        elif kind == "packet.delivered":
            delivered.add(event["pid"])
        elif kind == "packet.dropped":
            dropped[event["pid"]] = event["reason"]
        elif kind == "inspect.result" and event["classification"] != "normal":
            flagged.add(event["pid"])
        elif kind == "ips.action" and event["action"] != "allow" and not event["applied"]:
            flagged.add(event["pid"])
        elif kind == "alert.raised":
            alerts += 1
            incidents.add(event["incident_id"])

    data = created - management
    delivered_data = delivered & data
    dropped_data = {pid: reason for pid, reason in dropped.items() if pid in data}

    unresolved = data - delivered_data - dropped_data.keys()
    if unresolved:
        raise StatsError(f"packets with no delivered/dropped outcome: {sorted(unresolved)}")
    both = delivered_data & dropped_data.keys()
    if both:
        raise StatsError(f"packets both delivered and dropped: {sorted(both)}")

    return RunStats(
        data_packets=len(data),
        delivered_clean=len(delivered_data - flagged),
        delivered_flagged=len(delivered_data & flagged),
        blocked=sum(1 for r in dropped_data.values() if r in BLOCKED_REASONS),
        other_drop=sum(1 for r in dropped_data.values() if r in OTHER_DROP_REASONS),
        mirrored=len(mirror_copies),
        management=len(management),
        alerts=alerts,
        incidents=len(incidents),
    )
