"""Scenario listing and run endpoints."""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import list_scenarios, load_scenario

router = APIRouter(tags=["simulation"])


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: str = Field(min_length=1, max_length=32)
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)
    ips_mode: Literal["monitor", "enforce"] = "monitor"


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
        }
        for s in list_scenarios(request.app.state.scenarios_dir)
    ]


@router.post("/sim/run")
def run(body: RunRequest, request: Request) -> dict[str, Any]:
    """Run a scenario and return its complete, deterministic trace."""
    if body.ips_mode == "enforce":
        raise HTTPException(
            status_code=501,
            detail="IPS enforcement is not implemented in Stage 1; only 'monitor' is accepted.",
        )
    state = request.app.state
    scenario = load_scenario(body.scenario_id, state.scenarios_dir)
    result = run_scenario(state.graph, scenario, body.seed, body.ips_mode)
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
