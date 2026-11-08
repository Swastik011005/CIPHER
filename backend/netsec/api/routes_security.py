"""Security state, Zero Trust explanations, the SIEM history, endpoint overviews and the endpoint CLI.

Everything here is a view of the same deterministic simulation: the CLI runs the same engine as the scenarios, with the same
rules and the same security state, and the state changes below are the operator actions (isolate, restore, trust, role,
permission) that the engine applies to its next decisions. All data is synthetic. In production mode the state is read-only
for the same reason the rules are: it is shared by every visitor.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from netsec.cli.endpoint import CliError, EndpointCli
from netsec.security.state import ROLES, TRUST_LEVELS, SecuritySnapshot, SecurityState, StateError
from netsec.security.zerotrust import ZeroTrustEngine, load_zerotrust, port_key
from netsec.traffic.scenarios import list_presentation_scenarios

router = APIRouter(tags=["security"])

READ_ONLY_MESSAGE = "The security state is read-only on this server because every visitor shares it. Run it locally to change it."


def build_state(graph) -> SecurityState:
    hosts = frozenset(n.id for n in graph.topology.nodes if n.type == "host")
    users = frozenset(u.id for u in load_zerotrust().users)
    return SecurityState(hosts=hosts, users=users)


def _store(request: Request) -> SecurityState:
    return request.app.state.security


def _writable(request: Request) -> None:
    if request.app.state.rules_read_only:
        raise HTTPException(status_code=403, detail=READ_ONLY_MESSAGE)


def _view(request: Request) -> dict[str, Any]:
    return {**_store(request).to_dict(), "read_only": bool(request.app.state.rules_read_only), "trust_levels": list(TRUST_LEVELS), "roles": list(ROLES)}


@router.get("/state")
def get_state(request: Request) -> dict[str, Any]:
    """Isolated endpoints, device trust, roles, revoked permissions and the cumulative rule counters."""
    return _view(request)


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["isolate", "restore", "trust", "role", "revoke", "grant", "reset"]
    node: Optional[str] = Field(default=None, max_length=32)
    user: Optional[str] = Field(default=None, max_length=32)
    level: Optional[str] = Field(default=None, max_length=16)
    role: Optional[str] = Field(default=None, max_length=16)
    resource: Optional[str] = Field(default=None, max_length=32)


@router.post("/state/action")
def action(body: ActionRequest, request: Request) -> dict[str, Any]:
    """An operator action. It changes what the engine decides from the next run or CLI command on."""
    _writable(request)
    store = _store(request)
    try:
        if body.action == "reset":
            store.reset()
        elif body.action in ("isolate", "restore"):
            (store.isolate if body.action == "isolate" else store.restore)(body.node or "")
        elif body.action == "trust":
            store.set_trust(body.node or "", body.level or "")
        elif body.action == "role":
            store.set_role(body.user or "", body.role or "")
        else:
            if not body.role or not body.resource:
                raise StateError("a role and a resource are needed")
            (store.revoke if body.action == "revoke" else store.grant)(body.role, body.resource)
    except StateError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _view(request)


@router.get("/presentation")
def presentation(request: Request) -> list[dict[str, Any]]:
    """The nine presentation scenarios (P1 to P9) with what the launcher shows for each."""
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "duration": s.duration,
            "default_seed": s.default_seed,
            "features": s.features.model_dump(),
            "initial_isolated": s.initial_isolated,
            "operator_actions": [a.model_dump() for a in s.operator_actions],
            "endpoint_events": [e.model_dump() for e in s.endpoint_events],
            **(s.presentation.model_dump() if s.presentation else {}),
        }
        for s in list_presentation_scenarios(request.app.state.scenarios_dir)
    ]


@router.get("/zerotrust")
def zerotrust(request: Request) -> dict[str, Any]:
    """The Zero Trust policy as configured, and the operator's changes to it."""
    cfg = load_zerotrust()
    snap = _store(request).snapshot()
    roles = dict(snap.roles)
    trust = dict(snap.trust)
    return {
        "pdp": cfg.pdp,
        "pep": cfg.pep,
        "description": cfg.description,
        "users": [{**u.model_dump(), "role": roles.get(u.id, u.role), "trust": trust.get(u.device, cfg.default_trust), "isolated": u.device in snap.isolated} for u in cfg.users],
        "resources": [r.model_dump() for r in cfg.resources],
        "permissions": [{**p.model_dump(), "revoked": f"{p.role}:{p.resource}" in snap.revoked} for p in cfg.permissions],
        "notes": cfg.notes,
    }


class ExplainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device: str = Field(max_length=32)
    resource: str = Field(max_length=32)
    proto: Literal["tcp", "udp", "icmp"] = "tcp"
    port: Optional[int] = Field(default=None, ge=1, le=65535)


@router.post("/zerotrust/explain")
def explain(body: ExplainRequest, request: Request) -> dict[str, Any]:
    """What Zero Trust would decide for this device reaching this resource, and why. Nothing is run."""
    cfg = load_zerotrust()
    engine = ZeroTrustEngine(cfg, _store(request).snapshot())
    resource = next((r for r in cfg.resources if r.id == body.resource), None)
    if resource is None:
        raise HTTPException(status_code=422, detail=f"{body.resource!r} is not a protected resource")
    result = engine.evaluate(body.device, resource, body.proto, body.port, body.device in _store(request).snapshot().isolated)
    return {**result.__dict__, "factors": list(result.factors), "request": port_key(body.proto, body.port), "note": "The static ACL and the firewall are applied before Zero Trust, so a packet they drop never reaches this decision."}


def _incidents(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rank = {"low": 1, "medium": 2, "high": 3}
    grouped: dict[str, dict[str, Any]] = {}
    for e in events:
        inc = grouped.setdefault(e["incident_id"], {"incident_id": e["incident_id"], "node": e["node"], "severity": "low", "first_t": e["t"], "last_t": e["t"], "events": [], "sources": []})
        inc["events"].append(e)
        inc["last_t"] = e["t"]
        if rank[e["severity"]] > rank[inc["severity"]]:
            inc["severity"] = e["severity"]
        if e["source"] not in inc["sources"]:
            inc["sources"].append(e["source"])
    return list(grouped.values())


@router.get("/siem/events")
def siem_events(request: Request, limit: int = 200) -> dict[str, Any]:
    """The SIEM's retained event history (every simulated event it received in runs on this server) and its incidents."""
    store = _store(request)
    events = list(store.siem_history)[-max(1, min(limit, 500)) :]
    return {"collector": "SIEM-1", "simulated": True, "events": events, "incidents": _incidents(events)}


@router.get("/endpoints/{node}")
def endpoint(node: str, request: Request) -> dict[str, Any]:
    """Identity, addressing, trust and health of one endpoint, for its Overview and Security tabs."""
    graph = request.app.state.graph
    n = graph.nodes.get(node)
    if n is None or n.type != "host":
        raise HTTPException(status_code=404, detail="Not an endpoint")
    cfg = load_zerotrust()
    snap = _store(request).snapshot()
    iface = next(i for i in n.interfaces if i.ip)
    link = graph.link_of_interface(node, iface.name)
    vlan = next((v for v in graph.topology.vlans if v.id == (link.vlan if link else None)), None)
    user = next((u for u in cfg.users if u.device == node), None)
    history = [e for e in _store(request).edr_history if e.get("node") == node][-20:]
    state = "isolated" if node in snap.isolated else "healthy"
    for e in reversed(history):
        if e["type"] == "edr.state" and node not in snap.isolated:
            state = e["state"]
            break
    return {
        "id": n.id,
        "label": n.label,
        "role": n.role,
        "zone": n.zone,
        "ip": iface.ip,
        "prefix": iface.prefix,
        "gateway": iface.gateway,
        "vlan": link.vlan if link else None,
        "vlan_name": vlan.name if vlan else None,
        "trust": dict(snap.trust).get(node, cfg.default_trust),
        "user": ({"id": user.id, "name": user.name, "role": dict(snap.roles).get(user.id, user.role)} if user else None),
        "isolated": node in snap.isolated,
        "health": state,
        "edr_history": history,
        "services": [s.model_dump() for s in n.services],
        "cli": True,
    }


class CliRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node: str = Field(min_length=1, max_length=32)
    command: str = Field(max_length=200)
    ips_mode: Literal["monitor", "enforce"] = "enforce"
    #: Return the simulated run so the 3D scene can replay the packets of a network command.
    animate: bool = True


@router.post("/cli/exec")
def cli_exec(body: CliRequest, request: Request) -> dict[str, Any]:
    """Run one whitelisted endpoint command through the simulation engine and print what really happened."""
    state = request.app.state
    cli = EndpointCli(state.graph, state.rules.current, state.security.snapshot(), body.ips_mode)
    try:
        result = cli.execute(body.node, body.command)
    except CliError as exc:
        return {"lines": [str(exc)], "ok": False, "clear": False, "decision": {}, "run": None}
    run = None
    if result.run is not None:
        if not state.rules_read_only:
            state.security.record_run(result.run.events)
        if body.animate:
            r = result.run
            run = {
                "run_id": r.run_id, "scenario_id": r.scenario_id, "seed": r.seed, "ips_mode": r.ips_mode, "duration": r.duration,
                "config_hash": r.config_hash, "trace_hash": r.trace_hash, "summary": r.stats.model_dump(), "events": r.events,
            }
    return {"lines": result.lines, "ok": result.ok, "clear": result.clear, "decision": result.decision, "run": run}
