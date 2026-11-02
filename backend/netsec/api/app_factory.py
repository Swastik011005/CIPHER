"""FastAPI application factory."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from netsec import __version__
from netsec.api import routes_health, routes_sim, routes_topology
from netsec.config import FRONTEND_DIST_DIR, Settings, load_settings
from netsec.network.topology import TopologyError, load_topology
from netsec.network.validator import validate_topology
from netsec.sim.engine import EngineError
from netsec.traffic.scenarios import ScenarioError, ScenarioNotFound

log = logging.getLogger("netsec.api")

DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def create_app(
    topology_path: Optional[Path | str] = None,
    settings: Optional[Settings] = None,
    scenarios_dir: Optional[Path] = None,
    frontend_dist: Optional[Path] = None,
) -> FastAPI:
    """Build the API. Fails fast (``TopologyError``) if the topology is missing or invalid."""
    settings = settings or load_settings()
    graph = load_topology(topology_path)

    app = FastAPI(
        title="NetSec IDS/IPS Simulation Engine",
        version=__version__,
        description="Local-only simulation API. All traffic is synthetic.",
    )
    app.state.graph = graph
    app.state.validation = validate_topology(graph.topology)
    app.state.started_at = time.monotonic()
    app.state.scenarios_dir = scenarios_dir

    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(ScenarioNotFound)
    def _scenario_not_found(_: Request, exc: ScenarioNotFound) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ScenarioError)
    def _scenario_error(_: Request, exc: ScenarioError) -> JSONResponse:
        log.error("scenario error: %s", exc)
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    @app.exception_handler(EngineError)
    def _engine_error(_: Request, exc: EngineError) -> JSONResponse:
        log.error("engine error: %s", exc)
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(TopologyError)
    def _topology_error(_: Request, exc: TopologyError) -> JSONResponse:
        log.error("topology error: %s", exc)
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    app.include_router(routes_health.router, prefix="/api")
    app.include_router(routes_topology.router, prefix="/api")
    app.include_router(routes_sim.router, prefix="/api")

    _mount_frontend(app, frontend_dist if frontend_dist is not None else FRONTEND_DIST_DIR)
    return app


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built frontend (demo mode) when ``frontend/dist`` exists."""
    index = dist / "index.html"
    if not index.is_file():
        return
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False, response_model=None)
    def _spa(path: str) -> FileResponse | JSONResponse:
        if path == "api" or path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)
