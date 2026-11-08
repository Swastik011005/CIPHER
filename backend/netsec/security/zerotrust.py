"""Zero Trust policy: who may reach a protected resource, and why.

The decision point (ZT-POLICY-1) weighs identity (the user bound to a device and that user's role), device trust, endpoint
isolation, and the explicit permission list for the resource, port and protocol. There is no implicit trust: an administrator
reaches only what the admin role lists. Every decision carries the factors it used, so the UI can explain it. This is a
simulation of the idea, not an identity provider.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from netsec.config import CONFIG_DIR
from netsec.security.state import SecuritySnapshot

ZT_CONFIG_PATH = CONFIG_DIR / "zerotrust.json"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ZtUser(_Strict):
    id: str
    name: str
    role: str
    device: str


class ZtResource(_Strict):
    id: str
    node: str
    description: str


class ZtPermission(_Strict):
    role: str
    resource: str
    allow: list[str]  # "tcp/443", "icmp"
    restricted_ok: list[str] = Field(default_factory=list)


class ZeroTrustConfig(_Strict):
    version: str
    description: str
    pdp: str
    pep: str
    default_trust: str
    users: list[ZtUser]
    resources: list[ZtResource]
    permissions: list[ZtPermission]
    notes: list[str] = Field(default_factory=list)


def load_zerotrust(path: Optional[Path] = None) -> ZeroTrustConfig:
    return ZeroTrustConfig.model_validate(json.loads((path or ZT_CONFIG_PATH).read_text(encoding="utf-8")))


@dataclass(frozen=True)
class ZtResult:
    decision: str  # allow | deny | restricted
    reason: str
    factors: tuple[str, ...]
    user: str
    role: str
    device: str
    trust: str
    resource: str


def port_key(proto: str, port: Optional[int]) -> str:
    return "icmp" if proto == "icmp" else f"{proto}/{port}"


class ZeroTrustEngine:
    def __init__(self, config: ZeroTrustConfig, state: SecuritySnapshot) -> None:
        self.config = config
        self._device_user = {u.device: u for u in config.users}
        self._resource_by_node = {r.node: r for r in config.resources}
        self._trust = dict(state.trust)
        self._roles = dict(state.roles)
        self._revoked = set(state.revoked)
        self._isolated = set(state.isolated)

    def resource_of(self, node_id: str) -> Optional[ZtResource]:
        return self._resource_by_node.get(node_id)

    def evaluate(self, src_node: str, resource: ZtResource, proto: str, port: Optional[int], isolated: bool = False) -> ZtResult:
        user = self._device_user.get(src_node)
        trust = self._trust.get(src_node, self.config.default_trust)
        if user is None:
            return ZtResult("deny", f"{src_node} is not a known device: no identity is bound to it.", ("device: unknown",), "unknown", "none", src_node, trust, resource.id)
        role = self._roles.get(user.id, user.role)
        want = port_key(proto, port)
        factors = [f"user: {user.name} ({user.id})", f"role: {role}", f"device: {src_node}, trust {trust}", f"resource: {resource.id} {want}"]

        def result(decision: str, reason: str) -> ZtResult:
            return ZtResult(decision, reason, tuple(factors), user.id, role, src_node, trust, resource.id)

        if isolated or src_node in self._isolated:
            factors.append("endpoint: isolated by EDR")
            return result("deny", f"{src_node} is isolated by EDR, so no access to {resource.id} is granted.")
        if trust == "untrusted":
            factors.append("device trust: untrusted")
            return result("deny", f"{src_node} is not a trusted device, so {user.name} gets no access to {resource.id}.")
        permission = next((p for p in self.config.permissions if p.role == role and p.resource == resource.id), None)
        if permission is None or f"{role}:{resource.id}" in self._revoked:
            why = "the permission was revoked" if permission is not None else f"the {role} role has no permission on it"
            factors.append("permission: none")
            return result("deny", f"{resource.id} is not available to the {role} role: {why}.")
        if want not in permission.allow:
            factors.append(f"permission: {', '.join(permission.allow)} only")
            return result("deny", f"The {role} role may use {resource.id} only on {', '.join(permission.allow)}, not {want}.")
        if trust == "restricted":
            if want in permission.restricted_ok:
                factors.append("device trust: restricted, port allowed in restricted mode")
                return result("restricted", f"{src_node} has restricted trust: {want} on {resource.id} is allowed in restricted mode.")
            factors.append("device trust: restricted")
            return result("deny", f"{src_node} has restricted trust, which allows only {', '.join(permission.restricted_ok) or 'nothing'} on {resource.id}.")
        factors.append(f"permission: {role} may use {want}")
        return result("allow", f"The {role} role is explicitly permitted to use {want} on {resource.id}, and {src_node} is trusted.")
