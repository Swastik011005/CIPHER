#!/usr/bin/env python3
"""HTTP checks against a deployed CIPHER API and static site (run this after deploying, see docs/DEPLOYMENT_RENDER.md).

    python scripts/tasks.py check-deployed --api https://netsec-3d-api.onrender.com/api --site https://netsec-3d.onrender.com [--spoof-test]

These are the same checks the local two-origin simulation runs (scripts/check_split_origin.py), pointed at real addresses:
CORS for the site's origin and none for another, no wildcard, the preflight, docs not served, a run working and compressed,
security headers, rules read-only, a 200 kB body refused, the static host's deep-link rewrite, the Content-Security-Policy
and the cache header on hashed files. It never sends a rule edit to a server whose rules are not read-only.

`--spoof-test` sends 30 scenario runs, each with a different invented X-Forwarded-For and CF-Connecting-IP, to see whether the
rate limit holds. It uses up the run allowance of whatever address Render shows the server for a minute or so.
A free Render API may take about a minute to wake, so the first request waits up to 90 seconds.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_split_origin as checks  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", required=True, help="the API URL including /api, e.g. https://netsec-3d-api.onrender.com/api")
    parser.add_argument("--site", help="the front end's address, e.g. https://netsec-3d.onrender.com (omit to check the API only)")
    parser.add_argument("--spoof-test", action="store_true", help="also probe the rate limit with invented client addresses")
    args = parser.parse_args()

    api = args.api.rstrip("/")
    site = args.site.rstrip("/") if args.site else None
    parts = urlsplit(site) if site else None
    site_origin = f"{parts.scheme}://{parts.netloc}" if parts else "https://netsec-3d.onrender.com"

    print(f"Waiting for the API at {api} (a sleeping free instance takes about a minute) ...", flush=True)
    deadline = time.monotonic() + 90
    while True:
        try:
            if checks.request("GET", f"{api}/health")[0] == 200:
                break
        except OSError:
            pass
        if time.monotonic() > deadline:
            print("The API did not answer within 90 seconds.")
            return 1
        time.sleep(3)

    checks.api_checks(api, site_origin, "https://evil.example.com")

    if site:
        blueprint = yaml.safe_load((ROOT / "render.yaml").read_text(encoding="utf-8"))
        static = next(s for s in blueprint["services"] if s["runtime"] == "static")
        csp = next(h["value"] for h in static["headers"] if h["name"] == "Content-Security-Policy")
        _, _, html = checks.request("GET", f"{site}/")
        asset = re.search(rb"/assets/index-[A-Za-z0-9_-]+\.js", html)
        checks.check("Static: the home page links a hashed script", asset is not None)
        if asset:
            checks.static_checks(site, csp, f"{site}{asset.group(0).decode()}")
            checks.check("Static: HTTPS is enforced with HSTS", parts.scheme == "https" and "strict-transport-security" in checks.request("GET", f"{site}/")[1])

    if args.spoof_test:
        checks.rate_limit_checks(api, site_origin)

    results = checks.results
    print(f"\n{sum(results)} of {len(results)} checks passed.")
    print("Not covered here, check by eye: the 3D scene appears, a scenario plays, the Rules page shows its lock, the console is clean.")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
