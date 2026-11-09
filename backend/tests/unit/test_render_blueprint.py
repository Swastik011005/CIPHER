"""render.yaml: the two Render services fit together, and the API's environment is one the server accepts."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlsplit

import pytest
import yaml

from netsec.config import load_settings

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def blueprint() -> dict:
    return yaml.safe_load((REPO / "render.yaml").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def api(blueprint) -> dict:
    return next(s for s in blueprint["services"] if s["runtime"] == "python")


@pytest.fixture(scope="module")
def site(blueprint) -> dict:
    return next(s for s in blueprint["services"] if s["runtime"] == "static")


def env(service: dict) -> dict[str, str]:
    return {item["key"]: item["value"] for item in service["envVars"]}


def test_there_are_exactly_two_services_a_python_api_and_a_static_site(blueprint, api, site) -> None:
    assert len(blueprint["services"]) == 2
    assert (api["name"], site["name"]) == ("cipher-api", "cipher")  # the preferred names; the other tests follow whatever they are
    assert (api["type"], api["runtime"], site["type"], site["runtime"]) == ("web", "python", "web", "static")


def test_the_api_service_builds_runs_and_is_health_checked_as_documented(api) -> None:
    assert api["plan"] == "free" and api["rootDir"] == "backend" and api["branch"] == "main"
    assert api["buildCommand"] == "pip install -r requirements.lock.txt" and (REPO / "backend" / "requirements.lock.txt").is_file()
    assert api["startCommand"] == "python app.py" and (REPO / "backend" / "app.py").is_file()
    assert api["healthCheckPath"] == "/api/health"


def test_python_is_pinned_to_the_version_the_project_is_tested_on(api) -> None:
    version = env(api)["PYTHON_VERSION"]
    assert re.fullmatch(r"\d+\.\d+\.\d+", version), "Render requires a fully qualified version in PYTHON_VERSION"
    ci = yaml.safe_load((REPO / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8"))
    ci_python = {s["with"]["python-version"] for job in ci["jobs"].values() for s in job["steps"] if str(s.get("uses", "")).startswith("actions/setup-python")}
    assert ci_python == {version.rsplit(".", 1)[0]}


def test_the_api_environment_is_accepted_by_the_server_and_is_the_locked_down_production_setup(api, tmp_path) -> None:
    settings = load_settings(env=env(api), dotenv_path=tmp_path / "no.env")
    assert settings.production and settings.public_bind and settings.host == "0.0.0.0"
    assert (settings.rules_read_only, settings.enable_docs, settings.rate_limit_enabled) == (True, False, True)
    assert settings.serve_frontend is False  # the API service never serves a front end
    assert settings.trust_proxy is False  # the safe starting point until Render's proxy headers are verified
    assert settings.max_body_bytes == 65536 and (settings.rate_run_per_min, settings.rate_validate_per_min, settings.rate_api_per_min) == (20, 3, 240)


def test_the_port_is_left_to_the_platform(api) -> None:
    assert "PORT" not in env(api) and "NETSEC_PORT" not in env(api)  # Render supplies PORT, which production reads


def test_the_api_allows_exactly_the_origin_of_the_static_site(api, site, tmp_path) -> None:
    origin = f"https://{site['name']}.onrender.com"
    assert load_settings(env=env(api), dotenv_path=tmp_path / "no.env").cors_origins == (origin,)


def test_the_front_end_is_built_against_the_api_service_address(api, site) -> None:
    assert env(site)["VITE_API_BASE"] == f"https://{api['name']}.onrender.com/api"


def test_the_content_security_policy_lets_the_page_talk_to_the_api_and_nothing_else_remote(api, site) -> None:
    csp = next(h["value"] for h in site["headers"] if h["name"] == "Content-Security-Policy")
    directives = {d.split()[0]: d.split()[1:] for d in (part.strip() for part in csp.split(";")) if d}
    api_origin = f"https://{api['name']}.onrender.com"
    assert directives["connect-src"] == ["'self'", api_origin]
    assert directives["default-src"] == ["'self'"]
    # blob: is the 3D captions' font worker (found by scripts/check_split_origin.py: without it the 3D world never renders).
    assert directives["script-src"] == ["'self'", "blob:"] and directives["worker-src"] == ["'self'", "blob:"]
    assert directives["frame-ancestors"] == ["'none'"] and directives["object-src"] == ["'none'"]
    assert all("*" not in source and source != "'unsafe-eval'" for sources in directives.values() for source in sources)
    assert "'unsafe-inline'" not in directives["script-src"]


def test_the_static_site_serves_the_app_for_client_side_routes_and_caches_hashed_files(site) -> None:
    assert site["staticPublishPath"] == "dist" and site["rootDir"] == "frontend"
    assert site["buildCommand"] == "npm ci && npm run build"
    assert site["routes"] == [{"type": "rewrite", "source": "/*", "destination": "/index.html"}]
    headers = {(h["path"], h["name"]): h["value"] for h in site["headers"]}
    assert "immutable" in headers[("/assets/*", "Cache-Control")]
    for name in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security"):
        assert ("/*", name) in headers


def test_nothing_in_the_blueprint_is_a_secret_or_needs_one(blueprint) -> None:
    text = (REPO / "render.yaml").read_text(encoding="utf-8")
    assert "sync: false" not in text and "generateValue" not in text  # no value to be typed in later, none to leak
    for service in blueprint["services"]:
        assert all(not re.search(r"(secret|token|password|key)$", item["key"], re.I) for item in service["envVars"])
    assert urlsplit(env(blueprint["services"][1])["VITE_API_BASE"]).scheme == "https"
