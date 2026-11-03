"""Scenario listing and run endpoints."""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from netsec.sim.controls import ControlSpec
from netsec.sim.engine import EngineError, run_scenario
from netsec.traffic.scenarios import list_scenarios, load_scenario

router = APIRouter(tags=["simulation"])


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: str = Field(min_length=1, max_length=32)
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)
    ips_mode: Literal["monitor", "enforce"] = "monitor"  # ignored by scenarios that pin their IPS mode (S5, S6)
    controls: list[ControlSpec] = Field(default_factory=list, max_length=20)


@router.get("/scenarios")
def scenarios(request: Request) -> list[dict[str, Any]]:
    """Scenarios implemented in this build."""
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "duration": s.duration,
            "default_seed": s.default_seed,
            "flow_count": len(s.flows),
            "pinned_ips_mode": s.pinned_ips_mode,
        }
        for s in list_scenarios(request.app.state.scenarios_dir)
    ]


@router.post("/sim/run")
def run(body: RunRequest, request: Request) -> dict[str, Any]:
    """Run a scenario and return its complete, deterministic trace."""
    state = request.app.state
    scenario = load_scenario(body.scenario_id, state.scenarios_dir)
    try:
        result = run_scenario(state.graph, scenario, body.seed, body.ips_mode, body.controls)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "run_id": result.run_id,
        "scenario_id": result.scenario_id,
        "seed": result.seed,
        "ips_mode": result.ips_mode,
        "duration": result.duration,
        "config_hash": result.config_hash,
        "trace_hash": result.trace_hash,
        "summary": result.stats.model_dump(),
        "events": result.events,
    }
