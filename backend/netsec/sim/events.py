"""Frozen trace event contract (Rev 3, A11).

One Pydantic model per event type. ``contracts/events.json`` is the machine-readable
list of event types and fields; tests assert these models and the frontend constants
both match it. Stage 1 emits only the events listed in ``emitted_in_stage_1``.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

Proto = Literal["tcp", "udp", "icmp"]
IpsMode = Literal["monitor", "enforce"]
Sensor = Literal["IDS-1", "IPS-1"]
Classification = Literal["normal", "suspicious", "malicious"]
Severity = Literal["low", "medium", "high"]
PolicyAction = Literal["permit", "deny"]
IpsAction = Literal["allow", "drop", "reject", "block_source", "rate_limit"]
DropReason = Literal[
    "fw_deny",
    "acl_deny",
    "ips_drop",
    "ips_reject",
    "blocked_source",
    "rate_limited",
    "ttl_expired",
    "no_route",
    # Campus security extension: an isolated endpoint (EDR) and a Zero Trust denial.
    "edr_isolated",
    "zt_deny",
]
ZtVerdict = Literal["allow", "deny", "restricted"]
EndpointStateName = Literal["healthy", "suspicious", "compromised", "isolated"]
SiemSource = Literal["FW1", "CORE-SW1", "IDS-1", "IPS-1", "EDR", "ZERO-TRUST"]


class IcmpInfo(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: int
    code: int
    id: int
    seq: int


class AppInfo(BaseModel):
    """Simulated application-layer label. Never real payload; ``encrypted`` payloads are opaque."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    proto: str
    summary: str
    encrypted: bool


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    count: int
    window: float
    threshold: float


class RunStats(BaseModel):
    """Counters in ``run.end``. See ``analysis/stats.py`` for the exact definitions."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    data_packets: int
    delivered_clean: int
    delivered_flagged: int
    blocked: int
    other_drop: int
    mirrored: int
    management: int
    alerts: int
    incidents: int


class _Event(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    seq: int = Field(ge=0)
    t: float = Field(ge=0)


class RunMeta(_Event):
    type: Literal["run.meta"] = "run.meta"
    run_id: str
    scenario_id: str
    seed: int
    ips_mode: IpsMode
    duration: float
    config_hash: str


class PacketCreated(_Event):
    type: Literal["packet.created"] = "packet.created"
    pid: int
    flow: str
    proto: Proto
    src: str
    sport: Optional[int]
    dst: str
    dport: Optional[int]
    flags: list[str]
    ttl: int
    len: int
    icmp: Optional[IcmpInfo]
    app: Optional[AppInfo]
    mirror_of: Optional[int]


class PacketHop(_Event):
    type: Literal["packet.hop"] = "packet.hop"
    pid: int
    link: str
    from_: str = Field(alias="from")
    to: str
    t_arrive: float
    vlan: Optional[int]
    ttl: int


class PacketMirrored(_Event):
    type: Literal["packet.mirrored"] = "packet.mirrored"
    pid: int
    copy_pid: int
    at: str
    to: str


class PolicyDecision(_Event):
    type: Literal["policy.decision"] = "policy.decision"
    pid: int
    node: str
    policy: str
    rule_id: str
    action: PolicyAction
    via_conntrack: bool


class InspectResult(_Event):
    type: Literal["inspect.result"] = "inspect.result"
    pid: int
    node: str
    classification: Classification
    rules: list[str]


class AlertRaised(_Event):
    type: Literal["alert.raised"] = "alert.raised"
    alert_id: str
    incident_id: str
    sensor: Sensor
    rule: str
    severity: Severity
    src: str
    dst: str
    proto: Proto
    dport: Optional[int]
    reason: str
    evidence: Evidence


class IpsActionEvent(_Event):
    type: Literal["ips.action"] = "ips.action"
    pid: int
    action: IpsAction
    mode: IpsMode
    applied: bool
    rule: str


class BlockAdded(_Event):
    type: Literal["block.added"] = "block.added"
    src: str
    until: float
    rule: str
    incident_id: str


class BlockExpired(_Event):
    type: Literal["block.expired"] = "block.expired"
    src: str


class PacketDelivered(_Event):
    type: Literal["packet.delivered"] = "packet.delivered"
    pid: int
    node: str


class PacketDropped(_Event):
    type: Literal["packet.dropped"] = "packet.dropped"
    pid: int
    node: str
    reason: DropReason


class SyslogSent(_Event):
    type: Literal["syslog.sent"] = "syslog.sent"
    pid: int
    from_: str = Field(alias="from")
    to: str
    alert_id: str


class ZtDecisionEvent(_Event):
    """A Zero Trust decision at the policy enforcement point (CORE-SW1), made by the decision point ZT-POLICY-1."""

    type: Literal["zt.decision"] = "zt.decision"
    pid: int
    node: str
    pdp: str
    user: str
    role: str
    device: str
    trust: str
    resource: str
    proto: Proto
    port: Optional[int]
    decision: ZtVerdict
    reason: str
    factors: list[str]


class EdrAlertEvent(_Event):
    """The simulated EDR agent on an endpoint reports suspicious or compromised behaviour to EDR-MGMT-1."""

    type: Literal["edr.alert"] = "edr.alert"
    alert_id: str
    node: str
    state: Literal["suspicious", "compromised"]
    severity: Severity
    reason: str
    manager: str


class EdrStateEvent(_Event):
    """An endpoint's EDR state changed (for example isolated by the operator, or restored)."""

    type: Literal["edr.state"] = "edr.state"
    node: str
    state: EndpointStateName
    cause: Literal["scenario", "operator"]
    reason: str


class EdrSendBlockedEvent(_Event):
    """An isolated endpoint tried to send and the EDR agent stopped it before any packet existed: nothing enters the network."""

    type: Literal["edr.send_blocked"] = "edr.send_blocked"
    node: str
    flow: str
    proto: str
    dst: str


class SiemEventRecord(_Event):
    """An event as the SIEM received it, from the component that really produced it. Simulated, never a real log."""

    type: Literal["siem.event"] = "siem.event"
    event_id: str
    source: SiemSource
    kind: str
    severity: Severity
    node: str
    src: Optional[str]
    dst: Optional[str]
    proto: Optional[Proto]
    dport: Optional[int]
    reason: str
    action: str
    incident_id: str
    origin_type: str
    origin_ref: Optional[str]


class RunEnd(_Event):
    type: Literal["run.end"] = "run.end"
    stats: RunStats


EVENT_MODELS: dict[str, type[_Event]] = {
    model.model_fields["type"].default: model
    for model in (
        RunMeta,
        PacketCreated,
        PacketHop,
        PacketMirrored,
        PolicyDecision,
        InspectResult,
        AlertRaised,
        IpsActionEvent,
        BlockAdded,
        BlockExpired,
        PacketDelivered,
        PacketDropped,
        SyslogSent,
        ZtDecisionEvent,
        EdrAlertEvent,
        EdrStateEvent,
        EdrSendBlockedEvent,
        SiemEventRecord,
        RunEnd,
    )
}
EVENT_TYPES: tuple[str, ...] = tuple(EVENT_MODELS)

TraceEvent = dict[str, Any]
"""A serialised event as stored in a trace (JSON-compatible dict, aliases applied)."""

AnyEvent = Union[
    RunMeta,
    PacketCreated,
    PacketHop,
    PacketMirrored,
    PolicyDecision,
    InspectResult,
    AlertRaised,
    IpsActionEvent,
    BlockAdded,
    BlockExpired,
    PacketDelivered,
    PacketDropped,
    SyslogSent,
    ZtDecisionEvent,
    EdrAlertEvent,
    EdrStateEvent,
    EdrSendBlockedEvent,
    SiemEventRecord,
    RunEnd,
]
