"""``GET /api/health``."""

from __future__ import annotations

import time

from fastapi import APIRouter, Request

from netsec import __version__
from netsec.traffic.scenarios import list_scenarios

router = APIRouter(tags=["health"])

SERVICE_NAME = "netsec-ids-engine"
STAGE = 2


@router.get("/health")
def health(request: Request) -> dict[str, object]:
    """Report that the engine is running and what it has loaded."""
    state = request.app.state
    summary = state.graph.summary()
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": __version__,
        "stage": STAGE,
        "uptime_s": round(time.monotonic() - state.started_at, 1),
        "mode": "simulation",
        "real_traffic": False,
        "topology": {
            "loaded": True,
            "valid": state.validation.passed,
            "nodes": summary["nodes"],
            "links": summary["links"],
        },
        "scenarios_available": [s.id for s in list_scenarios(state.scenarios_dir)],
    }
