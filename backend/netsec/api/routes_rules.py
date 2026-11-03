"""The Rules editor API: read the rules, change detector settings and restricted addresses, reset.

Edits go to the server's :class:`RuleStore` and are used by every later run. They are validated before they are
applied: a request with any invalid part changes nothing and answers 422 with one message per problem.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from netsec.analysis.ios_export import export_cisco
from netsec.security.ruleset import LIMITS, MAX_RESTRICTED_IPS, OTHER_EDITABLE, RuleError, RuleSet, RuleStore, policy_view

router = APIRouter(tags=["rules"])

DETECTOR_INFO: dict[str, dict[str, str]] = {
    "D1": {
        "name": "Port scan",
        "detects": "One source probing many different ports of one target with bare SYNs",
        "mitre": "T1046 Network Service Discovery",
        "where": "IDS-1 (alerts) and IPS-1 (alerts and acts)",
    },
    "D2": {
        "name": "Brute force",
        "detects": "Repeated connection attempts to remote-login ports (SSH, Telnet, RDP)",
        "mitre": "T1110 Brute Force",
        "where": "IDS-1 and IPS-1",
    },
    "D3": {
        "name": "Flood",
        "detects": "A source starting connections faster than a packet rate limit",
        "mitre": "T1498 Network Denial of Service",
        "where": "IDS-1 and IPS-1",
    },
    "D4": {
        "name": "Restricted service",
        "detects": "Any source not on the allowed list using a restricted service (MySQL on DB-SRV)",
        "mitre": "T1021 Remote Services",
        "where": "IDS-1 and IPS-1",
    },
    "D5": {
        "name": "Forbidden zone pair",
        "detects": "Traffic between two zones that policy forbids (Staff or Outside to the Security network)",
        "mitre": "T1570 Lateral Tool Transfer",
        "where": "IDS-1 and IPS-1",
    },
    "D6": {
        "name": "Invalid TCP flags",
        "detects": "TCP flag combinations no real stack sends (NULL, XMAS, SYN+FIN, SYN+RST, FIN+RST)",
        "mitre": "T1595 Active Scanning",
        "where": "IDS-1 and IPS-1",
    },
}


READ_ONLY_MESSAGE = (
    "Rules are read-only on this server. The rules are shared by every visitor, so one visitor's edit would change "
    "every other visitor's runs. Run NetSec 3D locally to edit them."
)


def _store(request: Request) -> RuleStore:
    return request.app.state.rules


def _read_only(request: Request) -> bool:
    return bool(request.app.state.rules_read_only)


def require_writable(request: Request) -> None:
    """Dependency of every endpoint that changes the shared rules: refuses (403) when the server is read-only."""
    if _read_only(request):
        raise HTTPException(status_code=403, detail=READ_ONLY_MESSAGE)


def rules_view(store: RuleStore, read_only: bool = False) -> dict[str, Any]:
    """Everything the Rules page needs, in one response."""
    rules: RuleSet = store.current
    detectors = {}
    for detector_id, info in DETECTOR_INFO.items():
        config = getattr(rules.detectors, detector_id).model_dump()
        default = getattr(store.defaults.detectors, detector_id).model_dump()
        detectors[detector_id] = {
            **info,
            "settings": config,
            "defaults": default,
            "changed": [name for name in config if config[name] != default[name]],
            "limits": {name: {"min": lo, "max": hi} for name, (lo, hi) in LIMITS[detector_id].items()},
            "editable": sorted(set(LIMITS[detector_id]) | OTHER_EDITABLE[detector_id]),
        }
    firewall_files = [f for f in rules.policies if any(p.node == "FW1" for p in f.policies)]
    return {
        "read_only": read_only,
        "read_only_reason": READ_ONLY_MESSAGE if read_only else None,
        "revision": store.revision,
        "customised": store.customised,
        "rules_hash": rules.digest(),
        "defaults_hash": store.defaults.digest(),
        "detectors": detectors,
        "ips_policy": {
            "allowlist": rules.ips_policy.allowlist,
            "rules": [r.model_dump() for r in rules.ips_policy.rules],
            "note": "Applied only in Enforce mode. In Monitor mode the same decisions are recorded, not applied.",
        },
        "restricted_ips": {"addresses": rules.restricted_ips, "max": MAX_RESTRICTED_IPS, "defaults": store.defaults.restricted_ips},
        "policies": [policy_view(p) for f in rules.policies for p in f.policies],
        "firewall_policies": [p.name for f in firewall_files for p in f.policies],
    }


class DetectorEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: detector id -> fields to change, e.g. {"D1": {"enabled": false, "suspicious": 8}}
    changes: dict[str, dict[str, Any]] = Field(min_length=1)


class RestrictedEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    addresses: list[str]


@router.get("/rules")
def get_rules(request: Request) -> dict[str, Any]:
    return rules_view(_store(request), _read_only(request))


@router.put("/rules/detectors", dependencies=[Depends(require_writable)])
def put_detectors(body: DetectorEdit, request: Request) -> dict[str, Any]:
    store = _store(request)
    try:
        changed = store.update_detectors(body.changes)
    except RuleError as exc:
        raise HTTPException(status_code=422, detail=exc.problems) from exc
    return {**rules_view(store, _read_only(request)), "changed": changed}


@router.put("/rules/restricted-ips", dependencies=[Depends(require_writable)])
def put_restricted(body: RestrictedEdit, request: Request) -> dict[str, Any]:
    store = _store(request)
    try:
        now = store.set_restricted_ips(body.addresses)
    except RuleError as exc:
        raise HTTPException(status_code=422, detail=exc.problems) from exc
    return {**rules_view(store, _read_only(request)), "changed": [{"restricted_ips": now}]}


@router.get("/rules/export/cisco")
def export_ios(request: Request) -> dict[str, Any]:
    """The firewall and ACL policies in force, as Cisco IOS access-list configuration."""
    return export_cisco(_store(request).current)


@router.post("/rules/reset", dependencies=[Depends(require_writable)])
def reset_rules(request: Request) -> dict[str, Any]:
    store = _store(request)
    changed = store.reset()
    return {**rules_view(store, _read_only(request)), "changed": [{"reset": True}] if changed else []}
