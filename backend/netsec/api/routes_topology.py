"""``GET /api/topology``: the authoritative network topology."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

router = APIRouter(tags=["topology"])


@router.get("/topology")
def get_topology(request: Request) -> dict[str, Any]:
    """Return the topology exactly as defined in ``config/topology.json``, plus a summary
    and the validator report. The frontend derives the whole 3D scene from this response."""
    state = request.app.state
    body: dict[str, Any] = state.graph.topology.model_dump(mode="json")
    body["summary"] = state.graph.summary()
    body["validation"] = state.validation.to_dict()
    return body
