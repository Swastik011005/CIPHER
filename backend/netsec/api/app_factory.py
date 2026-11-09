"""FastAPI application factory."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from netsec import __version__
from netsec.api import routes_health, routes_rules, routes_sim, routes_topology
from netsec.api.protection import RateLimitMiddleware, RequestSizeLimitMiddleware, SecurityHeadersMiddleware
from netsec.config import FRONTEND_DIST_DIR, Settings, load_settings
from netsec.network.topology import TopologyError, load_topology
from netsec.network.validator import validate_topology
from netsec.api import routes_security
from netsec.security.ruleset import RuleStore
from netsec.sim.engine import EngineError
from netsec.traffic.scenarios import ScenarioError, ScenarioNotFound

log = logging.getLogger("netsec.api")


def _log_settings(settings: Settings) -> None:
    """One line saying how the server is configured, and a warning for each setting that widens its exposure."""
    log.info("settings: %s", settings.summary())
    if settings.public_bind and not settings.rules_read_only:
        log.warning("Rule edits are enabled on a publicly bound server: every visitor shares, and can change, the rules.")
    if settings.public_bind and not settings.rate_limit_enabled:
        log.warning("Rate limiting is off on a publicly bound server.")
    if settings.public_bind and not settings.cors_origins:
        log.info("No NETSEC_CORS_ORIGINS: only same-origin browsers can call the API.")


def create_app(
    topology_path: Optional[Path | str] = None,
    settings: Optional[Settings] = None,
    scenarios_dir: Optional[Path] = None,
    frontend_dist: Optional[Path] = None,
) -> FastAPI:
    """Build the API. Fails fast (``TopologyError``) if the topology is missing or invalid."""
    settings = settings or load_settings()
    graph = load_topology(topology_path)

    docs = {} if settings.enable_docs else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(
        title="CIPHER Simulation Engine",
        version=__version__,
        description="Simulation API. All traffic is synthetic.",
        **docs,
    )
    app.state.graph = graph
    app.state.validation = validate_topology(graph.topology)
    app.state.started_at = time.monotonic()
    app.state.scenarios_dir = scenarios_dir
    app.state.settings = settings
    app.state.rules = RuleStore()  # the rules every run uses; edited through /api/rules, reset on restart
    app.state.security = routes_security.build_state(graph)  # isolation, trust, roles, counters; changed through /api/state
    app.state.rules_read_only = settings.rules_read_only  # production: nobody can change the rules the others run with

    # Each add_middleware wraps the ones added before it, so the first is innermost. CORS is outermost: it answers
    # preflights before any limit applies, and its headers reach even the 413 and 429 answers a browser must be able to read.
    app.add_middleware(RequestSizeLimitMiddleware, max_bytes=settings.max_body_bytes)
    if settings.rate_limit_enabled:
        app.add_middleware(
            RateLimitMiddleware,
            limits={"run": settings.rate_run_per_min, "validate": settings.rate_validate_per_min, "api": settings.rate_api_per_min},
            trust_proxy=settings.trust_proxy,
            hops=settings.trusted_proxy_hops,
            client_ip_header=settings.client_ip_header,
        )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST", "PUT"],
            allow_headers=["Content-Type"],
            expose_headers=["Retry-After"],
        )
    _log_settings(settings)

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
    app.include_router(routes_rules.router, prefix="/api")
    app.include_router(routes_security.router, prefix="/api")

    if settings.serve_frontend:
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
