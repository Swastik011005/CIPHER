"""Filesystem locations and runtime settings.

The backend is **local-only by default**: it binds to a loopback address, allows only the Vite dev server origins,
and lets the Rules page edit the (in-memory) rules. A public deployment must say so explicitly with
``NETSEC_ENV=production``; binding to a non-loopback address additionally needs ``NETSEC_ALLOW_PUBLIC_BIND=true``.
Production changes the defaults to the safe side: rules are read-only, API documentation is off, rate limiting is on
and no cross-origin caller is allowed until ``NETSEC_CORS_ORIGINS`` lists one.

Configuration comes from environment variables, optionally seeded from ``backend/.env`` (real variables win).
"""

from __future__ import annotations

import ipaddress
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional
from urllib.parse import urlsplit

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
CONFIG_DIR = BACKEND_DIR / "config"
SCENARIOS_DIR = CONFIG_DIR / "scenarios"
DEFAULT_TOPOLOGY_PATH = CONFIG_DIR / "topology.json"
CONTRACTS_DIR = REPO_ROOT / "contracts"
FRONTEND_DIST_DIR = REPO_ROOT / "frontend" / "dist"

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
ENVIRONMENTS = ("development", "production")

#: Origins of the Vite dev server: the only cross-origin callers allowed by default in development.
DEV_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")

DEFAULT_MAX_BODY_BYTES = 64 * 1024
DEFAULT_RATE_RUN_PER_MIN = 20
DEFAULT_RATE_VALIDATE_PER_MIN = 3
DEFAULT_RATE_API_PER_MIN = 240


class ConfigError(ValueError):
    """Raised when runtime settings are invalid."""


@dataclass(frozen=True)
class Settings:
    """Runtime settings for the API server. The defaults are the local-only development settings."""

    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "info"
    frontend_dist: Path = FRONTEND_DIST_DIR
    environment: str = "development"
    allow_public_bind: bool = False
    cors_origins: tuple[str, ...] = DEV_CORS_ORIGINS
    enable_docs: bool = True
    rules_read_only: bool = False
    #: Serve the built front end (demo mode) when frontend/dist exists. An API-only deployment turns this off.
    serve_frontend: bool = True
    max_body_bytes: int = DEFAULT_MAX_BODY_BYTES
    rate_limit_enabled: bool = False
    rate_run_per_min: int = DEFAULT_RATE_RUN_PER_MIN
    rate_validate_per_min: int = DEFAULT_RATE_VALIDATE_PER_MIN
    rate_api_per_min: int = DEFAULT_RATE_API_PER_MIN
    #: Believe the X-Forwarded-For header, but only the entry added by the last `trusted_proxy_hops` proxies.
    trust_proxy: bool = False
    trusted_proxy_hops: int = 1
    #: With trust_proxy: take the client address from this single header (set by a proxy that overwrites it, such as
    #: `cf-connecting-ip` behind Cloudflare) instead of counting X-Forwarded-For entries.
    client_ip_header: Optional[str] = None

    @property
    def production(self) -> bool:
        return self.environment == "production"

    @property
    def public_bind(self) -> bool:
        return self.host not in LOOPBACK_HOSTS

    def summary(self) -> dict[str, object]:
        """The security-relevant settings, safe to log (no secrets exist in this configuration)."""
        return {
            "environment": self.environment,
            "host": self.host,
            "port": self.port,
            "cors_origins": list(self.cors_origins),
            "docs": self.enable_docs,
            "rules_read_only": self.rules_read_only,
            "serve_frontend": self.serve_frontend,
            "max_body_bytes": self.max_body_bytes,
            "rate_limit": (
                {"run": self.rate_run_per_min, "validate": self.rate_validate_per_min, "api": self.rate_api_per_min}
                if self.rate_limit_enabled
                else "off"
            ),
            "trust_proxy": (
                (f"header {self.client_ip_header}" if self.client_ip_header else f"last {self.trusted_proxy_hops} hop(s)")
                if self.trust_proxy
                else False
            ),
        }


def _read_dotenv(path: Path) -> dict[str, str]:
    """Parse a minimal ``KEY=VALUE`` file. Blank lines and ``#`` comments are ignored."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    value = raw.strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    raise ConfigError(f"{name} must be true or false (got {raw!r})")


def _integer(env: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer (got {raw!r})") from exc
    if not low <= value <= high:
        raise ConfigError(f"{name} must be between {low} and {high} (got {value})")
    return value


def parse_origin(text: str, production: bool) -> str:
    """Validate one CORS origin and return it in canonical form (no trailing slash).

    Only an exact scheme://host[:port] is accepted: no wildcard, no path. In production the scheme must be https,
    except for a loopback host, so a production configuration can be tried on one machine.
    """
    origin = text.strip().rstrip("/")
    if "*" in origin:
        raise ConfigError(f"NETSEC_CORS_ORIGINS: wildcard origins are not allowed (got {text!r})")
    parts = urlsplit(origin)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ConfigError(f"NETSEC_CORS_ORIGINS: {text!r} is not an origin such as https://app.example.com")
    if parts.path or parts.query or parts.fragment or parts.username or parts.password:
        raise ConfigError(f"NETSEC_CORS_ORIGINS: {text!r} must be only scheme://host[:port], without a path or credentials")
    try:
        parts.port  # noqa: B018 - raises ValueError for a malformed port
    except ValueError as exc:
        raise ConfigError(f"NETSEC_CORS_ORIGINS: {text!r} has an invalid port") from exc
    if production and parts.scheme != "https" and parts.hostname not in LOOPBACK_HOSTS:
        raise ConfigError(f"NETSEC_CORS_ORIGINS: {text!r} must use https in production")
    return origin


def _cors_origins(env: Mapping[str, str], production: bool) -> tuple[str, ...]:
    raw = env.get("NETSEC_CORS_ORIGINS")
    if raw is None:
        return () if production else DEV_CORS_ORIGINS
    origins: list[str] = []
    for item in raw.split(","):
        if item.strip():
            origin = parse_origin(item, production)
            if origin not in origins:
                origins.append(origin)
    return tuple(origins)


def _check_host(host: str, production: bool, allow_public: bool) -> None:
    if host in LOOPBACK_HOSTS:
        return
    if not (production and allow_public):
        raise ConfigError(
            f"NETSEC_HOST={host!r} is not a loopback address. This simulation is local-only by default and refuses to bind "
            "to external interfaces. A public deployment must set NETSEC_ENV=production and NETSEC_ALLOW_PUBLIC_BIND=true."
        )
    try:
        ipaddress.ip_address(host)
    except ValueError as exc:
        raise ConfigError(f"NETSEC_HOST={host!r} must be an IP address such as 0.0.0.0") from exc


def load_settings(env: Mapping[str, str] | None = None, dotenv_path: Path | None = None) -> Settings:
    """Build :class:`Settings` from the environment (real env wins over ``.env``)."""
    merged: dict[str, str] = _read_dotenv(dotenv_path or BACKEND_DIR / ".env")
    merged.update(os.environ if env is None else env)

    environment = merged.get("NETSEC_ENV", "development").strip().lower() or "development"
    if environment not in ENVIRONMENTS:
        raise ConfigError(f"NETSEC_ENV must be one of {', '.join(ENVIRONMENTS)} (got {environment!r})")
    production = environment == "production"

    allow_public_bind = _flag(merged, "NETSEC_ALLOW_PUBLIC_BIND", False)
    host = merged.get("NETSEC_HOST", "127.0.0.1")
    _check_host(host, production, allow_public_bind)

    trust_proxy = _flag(merged, "NETSEC_TRUST_PROXY", False)
    client_ip_header = merged.get("NETSEC_CLIENT_IP_HEADER", "").strip().lower() or None
    if client_ip_header is not None:
        if not re.fullmatch(r"[a-z0-9-]+", client_ip_header):
            raise ConfigError(f"NETSEC_CLIENT_IP_HEADER must be a header name such as cf-connecting-ip (got {client_ip_header!r})")
        if not trust_proxy:
            raise ConfigError("NETSEC_CLIENT_IP_HEADER only applies with NETSEC_TRUST_PROXY=true: it names a header the server will believe")

    # The platform's PORT is honoured only in production, so a stray PORT in a developer's shell cannot move the server.
    port_name = "NETSEC_PORT" if "NETSEC_PORT" in merged else ("PORT" if production and "PORT" in merged else "NETSEC_PORT")
    port = _integer(merged, port_name, 8000, 1, 65535)

    return Settings(
        host=host,
        port=port,
        log_level=merged.get("NETSEC_LOG_LEVEL", "info").lower(),
        environment=environment,
        allow_public_bind=allow_public_bind,
        cors_origins=_cors_origins(merged, production),
        enable_docs=_flag(merged, "NETSEC_ENABLE_DOCS", not production),
        rules_read_only=_flag(merged, "NETSEC_RULES_READ_ONLY", production),
        serve_frontend=_flag(merged, "NETSEC_SERVE_FRONTEND", True),
        max_body_bytes=_integer(merged, "NETSEC_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES, 1024, 10 * 1024 * 1024),
        rate_limit_enabled=_flag(merged, "NETSEC_RATE_LIMIT", production),
        rate_run_per_min=_integer(merged, "NETSEC_RATE_LIMIT_RUN_PER_MIN", DEFAULT_RATE_RUN_PER_MIN, 1, 100_000),
        rate_validate_per_min=_integer(merged, "NETSEC_RATE_LIMIT_VALIDATE_PER_MIN", DEFAULT_RATE_VALIDATE_PER_MIN, 1, 100_000),
        rate_api_per_min=_integer(merged, "NETSEC_RATE_LIMIT_API_PER_MIN", DEFAULT_RATE_API_PER_MIN, 1, 100_000),
        trust_proxy=trust_proxy,
        trusted_proxy_hops=_integer(merged, "NETSEC_TRUSTED_PROXY_HOPS", 1, 1, 10),
        client_ip_header=client_ip_header,
    )
