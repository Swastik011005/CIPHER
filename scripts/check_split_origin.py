#!/usr/bin/env python3
"""Local simulation of the Render architecture: the front end and the API on two different origins.

    python scripts/tasks.py split-check [--skip-rehearsal] [--api-port 8300] [--site-port 8301] [--out folder]

What it does, all on 127.0.0.1 and nothing on the internet:

1. builds the front end for a separate API (VITE_API_BASE points at the API origin);
2. serves it from a small static server that applies render.yaml's own routes (client-side routes fall back to
   index.html, real files win) and response headers, including the Content-Security-Policy;
3. runs the API with the environment render.yaml gives it (production, read-only rules, docs off, rate limits on, API
   only), moved to 127.0.0.1, with CORS for the front end's origin only;
4. checks CORS, docs, read-only rules, request size, compression, security headers, the static host's rules and the
   rate limit over plain HTTP, and the whole page in real Chrome (scripts/check_split_origin.mjs);
5. restarts the API with editing and high limits allowed and runs the full 34-step demo rehearsal across the two origins.

This is a LOCAL SIMULATION. It proves the configuration works across two origins with Render's headers; it does not prove
anything about Render itself (its proxy, its address handling, its build or its cold starts). Needs the backend virtual
environment (PyYAML), Node.js and Chrome or Edge.
"""

from __future__ import annotations

import argparse
import fnmatch
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlsplit

import yaml

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".map": "application/json",
    ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
}

results: list[bool] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}", flush=True)


# -- the static host, as render.yaml describes it -----------------------------------------------------------------


class StaticHost(http.server.ThreadingHTTPServer):
    """Serves a build folder the way a Render static site does: real files first, then the rewrite to /index.html."""

    def __init__(self, port: int, dist: Path, routes: list[dict], headers: list[dict]) -> None:
        self.dist, self.routes, self.header_rules = dist.resolve(), routes, headers
        super().__init__(("127.0.0.1", port), _Handler)

    def handle_error(self, request, client_address) -> None:  # a browser closing a connection is not an error worth printing
        if not isinstance(sys.exc_info()[1], (ConnectionError, BrokenPipeError)):
            super().handle_error(request, client_address)


class _Handler(http.server.BaseHTTPRequestHandler):
    server: StaticHost

    def log_message(self, *_args) -> None:  # silence the access log
        pass

    def _serve(self, send_body: bool) -> None:
        path = unquote(urlsplit(self.path).path)
        candidate = (self.server.dist / path.lstrip("/")).resolve()
        if candidate.is_file() and self.server.dist in candidate.parents:
            target = candidate
        else:
            rewrite = next((r for r in self.server.routes if r["type"] == "rewrite" and fnmatch.fnmatch(path, r["source"])), None)
            if rewrite is None:
                self.send_error(404)
                return
            target = self.server.dist / rewrite["destination"].lstrip("/")
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        for rule in self.server.header_rules:
            if fnmatch.fnmatch(path, rule["path"]):
                self.send_header(rule["name"], rule["value"])
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        self._serve(True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._serve(False)


# -- helpers ------------------------------------------------------------------------------------------------------


def request(method: str, url: str, headers: Optional[dict] = None, body: Optional[bytes] = None) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        try:
            data = error.read()
        except OSError:  # a server that refuses an upload early may close the connection before the answer's body is read
            data = b""
        return error.code, {k.lower(): v for k, v in error.headers.items()}, data


def wait_for(url: str, seconds: float = 40.0) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            if request("GET", url)[0] == 200:
                return True
        except OSError:
            time.sleep(0.4)
    return False


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def start_api(port: int, site_origin: str, base_env: dict[str, str], extra: dict[str, str]) -> subprocess.Popen:
    """Run the API with the environment render.yaml gives it, moved to 127.0.0.1 and a local port (plus `extra`)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("NETSEC_") and k != "PORT"}
    env.update(base_env)
    env.update(NETSEC_HOST="127.0.0.1", NETSEC_PORT=str(port), NETSEC_CORS_ORIGINS=site_origin, NETSEC_LOG_LEVEL="warning", **extra)
    process = subprocess.Popen([sys.executable, "app.py"], cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_for(f"http://127.0.0.1:{port}/api/health"):
        stop(process)
        raise SystemExit("the API did not start")
    return process


def stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        if os.name == "nt":
            subprocess.call(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def run_node(*args: str) -> int:
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js was not found")
    print(f"$ node {' '.join(args)}", flush=True)
    return subprocess.call([node, *args], cwd=ROOT)


# -- the HTTP-level checks ----------------------------------------------------------------------------------------


def api_checks(api: str, site_origin: str, evil: str) -> None:
    """HTTP-level checks of the API. Also used against a deployed API (scripts/check_deployed.py)."""
    status, headers, body = request("GET", f"{api}/health", {"Origin": site_origin})
    check("API: /api/health answers 200 to the front end's origin with its CORS header", status == 200 and headers.get("access-control-allow-origin") == site_origin)
    check("API: no wildcard and no credentials in CORS", headers.get("access-control-allow-origin") != "*" and "access-control-allow-credentials" not in headers)
    check("API: another origin gets no CORS header", "access-control-allow-origin" not in request("GET", f"{api}/health", {"Origin": evil})[1])

    ask = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
    status, headers, _ = request("OPTIONS", f"{api}/sim/run", {"Origin": site_origin, **ask})
    check("API: the preflight for a JSON POST from the front end is accepted", status == 200 and headers.get("access-control-allow-origin") == site_origin)
    check("API: the preflight from another origin is refused", request("OPTIONS", f"{api}/sim/run", {"Origin": evil, **ask})[0] == 400)

    api_root = f"{urlsplit(api).scheme}://{urlsplit(api).netloc}"
    check("API: /docs, /redoc and /openapi.json are not served", all(request("GET", f"{api_root}/{p}")[0] == 404 for p in ("docs", "redoc", "openapi.json")))
    status, headers, body = request("POST", f"{api}/sim/run", {"Content-Type": "application/json", "Accept-Encoding": "gzip", "Origin": site_origin}, json.dumps({"scenario_id": "S1"}).encode())
    check("API: a scenario run works across origins and its large answer is compressed", status == 200 and headers.get("content-encoding") in ("gzip", "br") and len(body) > 1000)
    check("API: answers carry nosniff, no-store and frame protection", headers.get("x-content-type-options") == "nosniff" and headers.get("cache-control") == "no-store" and headers.get("x-frame-options") == "DENY")

    view = json.loads(request("GET", f"{api}/rules")[2])
    check("API: the rules report themselves read-only", view.get("read_only") is True)
    if view.get("read_only") is True:  # never send an edit to a server that would accept it
        status, headers, body = request("PUT", f"{api}/rules/detectors", {"Content-Type": "application/json", "Origin": site_origin}, json.dumps({"changes": {"D1": {"enabled": False}}}).encode())
        check("API: a rule edit is refused with 403 and a readable message", status == 403 and b"read-only" in body and headers.get("access-control-allow-origin") == site_origin)
    status, _, _ = request("POST", f"{api}/sim/run", {"Content-Type": "application/json", "Origin": site_origin}, b" " * 200_000)
    check("API: a 200 kB request body is refused with 413", status == 413)



def static_checks(site: str, csp_expected: str, asset_url: str) -> None:
    """Checks of the static host: the rewrite rule, the headers from render.yaml, the cache header on hashed files."""
    status, headers, body = request("GET", f"{site}/rules")
    check("Static: a deep link (/rules) is answered with the app by the rewrite rule", status == 200 and b'<div id="root">' in body and headers["content-type"].startswith("text/html"))
    check("Static: the Content-Security-Policy and security headers from render.yaml are sent", headers.get("content-security-policy") == csp_expected and headers.get("x-frame-options") == "DENY" and headers.get("x-content-type-options") == "nosniff" and headers.get("referrer-policy") == "no-referrer")
    status, headers, _ = request("GET", asset_url)
    check("Static: hashed assets are served with a one-year immutable cache header", status == 200 and "immutable" in headers.get("cache-control", "") and headers["content-type"].startswith("text/javascript"))


def rate_limit_checks(api: str, site_origin: str) -> None:
    """Last, because it uses up the run allowance of 127.0.0.1."""
    body = json.dumps({"scenario_id": "S1"}).encode()
    statuses, retry = [], None
    for i in range(30):
        # A different invented address each time: with proxy trust off, none of it may matter.
        status, headers, _ = request("POST", f"{api}/sim/run", {"Content-Type": "application/json", "Origin": site_origin, "X-Forwarded-For": f"198.51.100.{i + 1}", "CF-Connecting-IP": f"198.51.100.{i + 1}"}, body)
        statuses.append(status)
        if status == 429 and retry is None:
            retry = headers
    first = statuses.index(429) if 429 in statuses else None
    check("Rate limit: running scenarios is limited per client (at most 20 a minute) and answers 429", first is not None and first <= 20, f"first 429 on request {None if first is None else first + 1} of 30")
    check("Rate limit: invented X-Forwarded-For and CF-Connecting-IP values cannot buy a new allowance", first is not None and all(s == 429 for s in statuses[first:]))
    check("Rate limit: the 429 carries Retry-After and CORS headers the page can read", retry is not None and int(retry["retry-after"]) >= 1 and retry.get("access-control-allow-origin") == site_origin)
    check("Rate limit: the health check is never limited", all(request("GET", f"{api}/health")[0] == 200 for _ in range(15)))


# -- main ---------------------------------------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api-port", type=int, default=8300)
    parser.add_argument("--site-port", type=int, default=8301)
    parser.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "cipher-split-origin"), help="folder for screenshots and the temporary build")
    parser.add_argument("--skip-rehearsal", action="store_true", help="skip the full 34-step rehearsal (the slowest part)")
    args = parser.parse_args()

    for port in (args.api_port, args.site_port):
        if port_in_use(port):
            return print(f"Port {port} is already in use; choose another with --api-port / --site-port.") or 2
    out = Path(args.out)
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)

    blueprint = yaml.safe_load((ROOT / "render.yaml").read_text(encoding="utf-8"))
    api_service = next(s for s in blueprint["services"] if s["runtime"] == "python")
    site_service = next(s for s in blueprint["services"] if s["runtime"] == "static")
    render_api_origin = f"https://{api_service['name']}.onrender.com"
    api_origin, site_origin = f"http://127.0.0.1:{args.api_port}", f"http://127.0.0.1:{args.site_port}"
    api_url, site_url, evil = f"{api_origin}/api", site_origin, "https://evil.example.com"

    # The Blueprint's headers, with the one public address swapped for the local one (and HSTS dropped: it is https-only).
    header_rules = [
        {**h, "value": h["value"].replace(render_api_origin, api_origin)} for h in site_service["headers"] if h["name"] != "Strict-Transport-Security"
    ]
    csp = next(h["value"] for h in header_rules if h["name"] == "Content-Security-Policy")
    blueprint_env = {item["key"]: item["value"] for item in api_service["envVars"] if item["key"] != "PYTHON_VERSION"}

    dist = out / "site"
    print(f"Building the front end for an API at {api_url} ...", flush=True)
    npm = shutil.which("npm")
    build = subprocess.run([npm, "run", "build", "--", "--outDir", str(dist), "--emptyOutDir"], cwd=FRONTEND, env={**os.environ, "VITE_API_BASE": api_url}, capture_output=True, text=True)
    if build.returncode != 0:
        print(build.stdout[-2000:], build.stderr[-2000:])
        return 1

    host = StaticHost(args.site_port, dist, site_service["routes"], header_rules)
    threading.Thread(target=host.serve_forever, daemon=True).start()
    print(f"Front end on {site_origin}, API on {api_origin}: two origins. Content-Security-Policy in force:\n  {csp}\n", flush=True)

    node_code = rehearsal_code = None
    api = None
    try:
        print("== Phase A: production API with its defaults (read-only rules, rate limits on)", flush=True)
        api = start_api(args.api_port, site_origin, blueprint_env, {})
        api_checks(api_url, site_origin, evil)
        static_checks(site_url, csp, f"{site_url}/assets/{next((dist / 'assets').glob('index-*.js')).name}")
        node_code = run_node("scripts/check_split_origin.mjs", "--site", site_url, "--api", api_url, "--out", str(out / "screens"))
        check("Browser: every Chrome check across the two origins passed", node_code == 0)
        rate_limit_checks(api_url, site_origin)
        stop(api)
        api = None

        if not args.skip_rehearsal:
            print("\n== Phase B: the same split, with rule editing and high limits allowed, for the full demo rehearsal", flush=True)
            api = start_api(args.api_port, site_origin, blueprint_env, {"NETSEC_RULES_READ_ONLY": "false", "NETSEC_RATE_LIMIT_RUN_PER_MIN": "1000", "NETSEC_RATE_LIMIT_API_PER_MIN": "10000", "NETSEC_RATE_LIMIT_VALIDATE_PER_MIN": "1000"})
            rehearsal_code = run_node("scripts/rehearse_demo.mjs", "--base", site_url, "--api", api_url, "--out", str(out / "rehearsal"))
            check("Browser: the full 34-step demo rehearsal passes with the API on another origin", rehearsal_code == 0)
    finally:
        if api is not None:
            stop(api)
        host.shutdown()

    print(f"\n{sum(results)} of {len(results)} checks passed. Screenshots: {out}")
    print("LOCAL SIMULATION ONLY: nothing here was run on Render.")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
