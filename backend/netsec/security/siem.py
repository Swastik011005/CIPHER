"""The simulated SIEM: what SIEM-1 receives, and how it groups the events into incidents.

The collector watches the trace as the engine writes it. It forwards an event only when a component that took part in the run
really produced it, and only for the kinds that ``config/siem.json`` lists for that component, so it never invents an event.
Events about the same actor (the endpoint the activity is about) within the incident window share one incident, so the SOC sees
a story (compromise, EDR alert, IDS alert, IPS action, isolation) instead of a flat list. The timestamps and the data are
synthetic.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Optional

from pydantic import BaseModel, ConfigDict, Field

from netsec.config import CONFIG_DIR

SIEM_CONFIG_PATH = CONFIG_DIR / "siem.json"


class SiemConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    version: str
    description: str
    collector: str
    incident_window_s: float = Field(gt=0)
    dedupe_s: float = Field(default=10.0, ge=0)
    forward: dict[str, list[str]]
    severity: dict[str, str]


def load_siem(path: Optional[Path] = None) -> SiemConfig:
    return SiemConfig.model_validate(json.loads((path or SIEM_CONFIG_PATH).read_text(encoding="utf-8")))


class SiemCollector:
    def __init__(self, config: SiemConfig, node_of_ip: Callable[[str], Optional[str]], rule_text: Callable[[str], str], scope: str = "") -> None:
        self.config = config
        self._node_of_ip = node_of_ip
        self._rule_text = rule_text
        self._scope = scope  # makes ids unique across the runs kept in the history
        self._packets: dict[int, tuple[str, str, str, Optional[int]]] = {}
        self._incidents: dict[str, tuple[str, float]] = {}  # actor -> (incident id, time of last event)
        self._incident_count = 0
        self._events = 0
        self._last_seen: dict[tuple, float] = {}

    # -- helpers -------------------------------------------------------------------------

    def _forwards(self, source: str, kind: str) -> bool:
        return kind in self.config.forward.get(source, [])

    def _incident(self, actor: str, t: float) -> str:
        known = self._incidents.get(actor)
        if known is None or t - known[1] > self.config.incident_window_s:
            self._incident_count += 1
            incident = f"SIEM-{self._scope}-INC-{self._incident_count:02d}"
        else:
            incident = known[0]
        self._incidents[actor] = (incident, t)
        return incident

    def _make(self, t: float, source: str, kind: str, severity: str, node: str, packet: Optional[tuple[str, str, str, Optional[int]]],
              reason: str, action: str, origin_type: str, origin_ref: Optional[str]) -> dict[str, Any]:
        self._events += 1
        src, dst, proto, dport = packet if packet else (None, None, None, None)
        return {
            "event_id": f"SIEM-{self._scope}-E{self._events:03d}",
            "source": source,
            "kind": kind,
            "severity": severity,
            "node": node,
            "src": src,
            "dst": dst,
            "proto": proto,
            "dport": dport,
            "reason": reason,
            "action": action,
            "incident_id": self._incident(node, t),
            "origin_type": origin_type,
            "origin_ref": origin_ref,
        }

    # -- the trace -----------------------------------------------------------------------

    def observe(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        """Called for every event the engine writes. Returns the SIEM events to write after it (usually none)."""
        kind = event["type"]
        t = event["t"]
        if kind == "packet.created":
            if event["mirror_of"] is None:
                self._packets[event["pid"]] = (event["src"], event["dst"], event["proto"], event["dport"])
            return []

        sev = self.config.severity
        if kind == "policy.decision" and event["action"] == "deny":
            source = event["node"]
            if not self._forwards(source, "policy_deny"):
                return []
            packet = self._packets.get(event["pid"])
            key = (source, event["rule_id"], packet)
            if key in self._last_seen and t - self._last_seen[key] < self.config.dedupe_s:
                return []  # the same denial of the same flow, repeated: one SIEM event is enough
            self._last_seen[key] = t
            affected = (self._node_of_ip(packet[0]) if packet else None) or event["node"]
            reason = f"{event['rule_id']}: {self._rule_text(event['rule_id'])}"
            return [self._make(t, source, "policy_deny", sev["policy_deny"], affected, packet, reason, f"Packet denied and dropped by {source}", kind, str(event["pid"]))]

        if kind == "alert.raised":
            source = event["sensor"]
            if not self._forwards(source, "alert"):
                return []
            packet = (event["src"], event["dst"], event["proto"], event["dport"])
            affected = self._node_of_ip(event["src"]) or event["src"]
            action = "Detected; IDS-1 is passive, no packet is blocked" if source == "IDS-1" else "Detected inline by IPS-1"
            return [self._make(t, source, "alert", event["severity"], affected, packet, f"{event['rule']}: {event['reason']}", action, kind, event["alert_id"])]

        if kind == "ips.action" and event["action"] != "allow":
            if not self._forwards("IPS-1", "action"):
                return []
            packet = self._packets.get(event["pid"])
            affected = (self._node_of_ip(packet[0]) if packet else None) or "IPS-1"
            if event["applied"]:
                severity, action = sev["ips_action_applied"], f"IPS-1 applied {event['action']} (Enforce mode)"
            else:
                severity, action = sev["ips_action_monitor"], f"IPS-1 would {event['action']} (Monitor mode: recorded, not applied)"
            return [self._make(t, "IPS-1", "action", severity, affected, packet, f"{event['rule']}", action, kind, str(event["pid"]))]

        if kind == "edr.alert" and self._forwards("EDR", "alert"):
            return [self._make(t, "EDR", "alert", event["severity"], event["node"], None, event["reason"], f"EDR agent on {event['node']} reported {event['state']} to {event['manager']}", kind, event["alert_id"])]

        if kind == "edr.state" and event["state"] in ("isolated", "healthy") and self._forwards("EDR", "state"):
            isolated = event["state"] == "isolated"
            severity = sev["edr_isolated"] if isolated else sev["edr_restored"]
            action = f"{event['node']} isolated ({event['cause']})" if isolated else f"{event['node']} restored to healthy ({event['cause']})"
            return [self._make(t, "EDR", "state", severity, event["node"], None, event["reason"], action, kind, event["node"])]

        if kind == "zt.decision" and event["decision"] != "allow" and self._forwards("ZERO-TRUST", event["decision"]):
            packet = self._packets.get(event["pid"])
            severity = sev["zt_deny"] if event["decision"] == "deny" else sev["zt_restricted"]
            return [self._make(t, "ZERO-TRUST", event["decision"], severity, event["device"], packet, event["reason"], f"{event['pdp']} decided {event['decision']} for {event['user']}", kind, str(event["pid"]))]
        return []
