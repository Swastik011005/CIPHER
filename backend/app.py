"""Backend entry point: ``python app.py``.

Serves the API on a loopback address only by default (http://127.0.0.1:8000, docs at /docs). A public deployment must
opt in with NETSEC_ENV=production (and NETSEC_ALLOW_PUBLIC_BIND=true for a non-loopback host); see netsec/config.py.
If ``frontend/dist`` exists the built frontend is served too (demo mode, one process).
"""

from __future__ import annotations

import logging
import sys

import uvicorn

from netsec.api.app_factory import create_app
from netsec.config import ConfigError, load_settings
from netsec.network.topology import TopologyError


def main() -> int:
    try:
        settings = load_settings()
        logging.basicConfig(level=settings.log_level.upper())
        app = create_app(settings=settings)
    except (ConfigError, TopologyError) as exc:
        print(f"Cannot start: {exc}", file=sys.stderr)
        return 1
    # proxy_headers=False: client addresses are decided by netsec.api.protection (NETSEC_TRUST_PROXY), not by uvicorn.
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        proxy_headers=False,
        server_header=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
