"""Scenario listing and run endpoints."""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from netsec.analysis.expectations import expectation_text, run_checks
from netsec.sim.controls import ControlSpec
from netsec.sim.engine import EngineError, run_scenario
from netsec.traffic.scenarios import FlowSpec
from netsec.traffic.scenarios import list_scenarios, load_scenario

router = APIRouter(tags=["simulation"])


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: str = Field(min_length=1, max_length=32)
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)
    ips_mode: Literal["monitor", "enforce"] = "monitor"  # ignored by scenarios that pin their IPS mode (S5, S6)
    controls: list[ControlSpec] = Field(default_factory=list, max_length=20)
    #: Extra traffic from the Send traffic form, added to the scenario's own flows.
    custom_flows: list[FlowSpec] = Field(default_factory=list, max_length=5)


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
            "expected": {mode: expectation_text(s.id, mode) for mode in ([s.pinned_ips_mode] if s.pinned_ips_mode else ["monitor", "enforce"])},
        }
        for s in list_scenarios(request.app.state.scenarios_dir)
    ]


@router.post("/sim/run")
def run(body: RunRequest, request: Request) -> dict[str, Any]:
    """Run a scenario and return its complete, deterministic trace."""
    state = request.app.state
    scenario = load_scenario(body.scenario_id, state.scenarios_dir)
    try:
        result = run_scenario(state.graph, scenario, body.seed, body.ips_mode, body.controls, body.custom_flows, state.rules.current)
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
        "rules_hash": state.rules.current.digest(),
        "rules_customised": state.rules.customised,
        "summary": result.stats.model_dump(),
        "events": result.events,
    }


class ValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: scenarios to check; omit for all of them
    scenario_ids: Optional[list[str]] = Field(default=None, max_length=20)


@router.post("/sim/validate")
def validate(body: ValidateRequest, request: Request) -> dict[str, Any]:
    """Run scenarios (each in the IPS modes it supports) with the current rules and check what they are expected to do."""
    state = request.app.state
    rules = state.rules.current
    wanted = body.scenario_ids or [s.id for s in list_scenarios(state.scenarios_dir)]
    results = []
    for scenario_id in wanted:
        scenario = load_scenario(scenario_id, state.scenarios_dir)
        modes = [scenario.pinned_ips_mode] if scenario.pinned_ips_mode else ["monitor", "enforce"]
        for mode in modes:
            result = run_scenario(state.graph, scenario, None, mode, rules=rules)
            checks = run_checks(scenario.id, mode, result)
            results.append(
                {
                    "scenario_id": scenario.id,
                    "name": scenario.name,
                    "ips_mode": mode,
                    "passed": all(c["passed"] for c in checks),
                    "checks": checks,
                    "config_hash": result.config_hash,
                    "trace_hash": result.trace_hash,
                    "summary": result.stats.model_dump(),
                }
            )
    checks_total = sum(len(r["checks"]) for r in results)
    checks_passed = sum(1 for r in results for c in r["checks"] if c["passed"])
    return {
        "rules_hash": rules.digest(),
        "rules_customised": state.rules.customised,
        "results": results,
        "summary": {
            "runs": len(results),
            "runs_passed": sum(1 for r in results if r["passed"]),
            "checks": checks_total,
            "checks_passed": checks_passed,
        },
    }
