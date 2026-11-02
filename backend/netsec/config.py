"""Filesystem locations and runtime settings.

Everything is local-only: the backend binds to a loopback address and reads its
configuration from environment variables, optionally seeded from ``backend/.env``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
CONFIG_DIR = BACKEND_DIR / "config"
SCENARIOS_DIR = CONFIG_DIR / "scenarios"
DEFAULT_TOPOLOGY_PATH = CONFIG_DIR / "topology.json"
CONTRACTS_DIR = REPO_ROOT / "contracts"
FRONTEND_DIST_DIR = REPO_ROOT / "frontend" / "dist"

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


class ConfigError(ValueError):
    """Raised when runtime settings are invalid."""


@dataclass(frozen=True)
class Settings:
    """Runtime settings for the API server."""

    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "info"
    frontend_dist: Path = FRONTEND_DIST_DIR


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


def load_settings(
    env: Mapping[str, str] | None = None, dotenv_path: Path | None = None
) -> Settings:
    """Build :class:`Settings` from the environment (real env wins over ``.env``)."""
    merged: dict[str, str] = _read_dotenv(dotenv_path or BACKEND_DIR / ".env")
    merged.update(os.environ if env is None else env)

    host = merged.get("NETSEC_HOST", "127.0.0.1")
    if host not in LOOPBACK_HOSTS:
        raise ConfigError(
            f"NETSEC_HOST={host!r} is not a loopback address. "
            "This simulation is local-only and refuses to bind to external interfaces."
        )
    try:
        port = int(merged.get("NETSEC_PORT", "8000"))
    except ValueError as exc:
        raise ConfigError("NETSEC_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ConfigError("NETSEC_PORT must be between 1 and 65535")

    return Settings(
        host=host,
        port=port,
        log_level=merged.get("NETSEC_LOG_LEVEL", "info").lower(),
    )
