#!/usr/bin/env python3
"""Cross-platform project tasks for CIPHER (Windows, macOS, Linux).

    python scripts/tasks.py setup [--runtime-only] [--skip-build]
    python scripts/tasks.py verify [--only backend|scenarios|frontend|build ...]
    python scripts/tasks.py demo [--no-browser]
    python scripts/tasks.py dev
    python scripts/tasks.py split-check [--skip-rehearsal]
    python scripts/tasks.py check-deployed --api <url>/api [--site <url>] [--spoof-test]

Standard library only, so it runs before any dependency is installed. The Windows `scripts\\*.cmd` files call it.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Optional, Sequence

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MIN_PYTHON = (3, 12)
MIN_NODE = (20, 19)

PIP_FLAGS = ["--disable-pip-version-check", "--retries", "8", "--timeout", "60"]
NPM_FLAGS = ["--no-audit", "--no-fund", "--fetch-retries=5", "--fetch-retry-maxtimeout=60000"]


def venv_python(is_windows: Optional[bool] = None) -> Path:
    """The backend virtual environment's interpreter for this platform."""
    windows = os.name == "nt" if is_windows is None else is_windows
    return BACKEND / ".venv" / ("Scripts/python.exe" if windows else "bin/python")


def parse_node_version(text: str) -> Optional[tuple[int, int]]:
    """'v24.15.0' -> (24, 15). None when the text is not a Node version."""
    match = re.match(r"v?(\d+)\.(\d+)", text.strip())
    return (int(match.group(1)), int(match.group(2))) if match else None


def say(message: str = "") -> None:
    print(message, flush=True)


def fail(message: str) -> int:
    print(f"\n{message}", file=sys.stderr, flush=True)
    return 1


def run(cmd: Sequence[object], cwd: Path = ROOT, env: Optional[dict[str, str]] = None) -> int:
    """Run a command in `cwd`, streaming its output. Returns its exit code."""
    say(f"$ {' '.join(str(c) for c in cmd)}")
    merged = {**os.environ, **env} if env else None
    return subprocess.call([str(c) for c in cmd], cwd=cwd, env=merged)


def tool(name: str) -> Optional[str]:
    """Absolute path of an executable on PATH (resolves npm.cmd on Windows)."""
    return shutil.which(name)


def check_prerequisites() -> Optional[str]:
    """None when Python and Node are new enough, otherwise what to do about it."""
    if sys.version_info < MIN_PYTHON:
        return f"Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} or newer is required (this is {sys.version.split()[0]}). Install it from python.org."
    node = tool("node")
    if not node:
        return f"Node.js was not found. Install Node.js {MIN_NODE[0]}.{MIN_NODE[1]} or newer from nodejs.org, then run this again."
    found = parse_node_version(subprocess.check_output([node, "--version"], text=True))
    if found is None or found < MIN_NODE:
        return f"Node.js {MIN_NODE[0]}.{MIN_NODE[1]} or newer is required (found {found[0]}.{found[1] if found else '?'})."
    if not tool("npm"):
        return "npm was not found. It normally comes with Node.js; reinstall Node.js and open a new terminal."
    return None


def stop(process: subprocess.Popen) -> None:
    """Stop a child process and everything it started."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.call(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


# -- setup ---------------------------------------------------------------------------------------


def cmd_setup(args: argparse.Namespace) -> int:
    problem = check_prerequisites()
    if problem:
        return fail(problem)
    python = venv_python()

    say("[1/4] Creating the backend virtual environment...")
    if not python.exists() and run([sys.executable, "-m", "venv", BACKEND / ".venv"]) != 0:
        return fail("Could not create the virtual environment.")

    requirements = "requirements.txt" if args.runtime_only else "requirements-dev.txt"
    say(f"[2/4] Installing backend dependencies ({requirements})...")
    if run([python, "-m", "pip", "install", *PIP_FLAGS, "-r", requirements], cwd=BACKEND) != 0:
        return fail(
            "The backend dependencies could not be installed. If the message above mentions \"No matching distribution\" or a\n"
            "timeout, the package index was unreachable for a moment: check the internet connection and run this again,\n"
            "it continues where it stopped."
        )

    say("[3/4] Installing frontend dependencies...")
    npm = tool("npm")
    assert npm
    if run([npm, "ci", *NPM_FLAGS], cwd=FRONTEND) != 0:
        return fail("The frontend dependencies could not be installed. Check the internet connection and run this again.")

    if args.skip_build:
        say("[4/4] Skipping the frontend build (--skip-build).")
    else:
        say("[4/4] Building the frontend for demo mode...")
        if run([npm, "run", "build"], cwd=FRONTEND) != 0:
            return fail("The frontend build failed.")

    say("\nSetup finished. Next: `python scripts/tasks.py demo` (one process, works offline) or `... dev` (hot reload).")
    return 0


# -- verify --------------------------------------------------------------------------------------


def verify_steps(python: Path, npm: str, npx: str) -> list[tuple[str, str, list[object], Path]]:
    return [
        ("backend", "Backend tests (pytest)", [python, "-m", "pytest", "-o", "addopts=", "-q", "-p", "no:cacheprovider"], BACKEND),
        ("scenarios", "Scenario checks (S1 to S7, shipped rules)", [python, ROOT / "scripts" / "run_scenario_checks.py"], ROOT),
        ("frontend", "Frontend tests (Vitest)", [npx, "vitest", "run"], FRONTEND),
        ("build", "Production build", [npm, "run", "build"], FRONTEND),
    ]


def cmd_verify(args: argparse.Namespace) -> int:
    python = venv_python()
    npm, npx = tool("npm"), tool("npx")
    if not python.exists() or not npm or not npx:
        return fail("Run `python scripts/tasks.py setup` first (needs the backend .venv, Node.js and npm).")
    steps = [s for s in verify_steps(python, npm, npx) if not args.only or s[0] in args.only]
    results: list[tuple[str, int, float]] = []
    for _key, title, cmd, cwd in steps:
        say(f"\n=== {title}")
        started = time.monotonic()
        results.append((title, run(cmd, cwd=cwd), time.monotonic() - started))
    say("\n=== Summary")
    for title, code, seconds in results:
        say(f"{'PASS' if code == 0 else 'FAIL'}  {title}  ({seconds:.0f} s)")
    ok = all(code == 0 for _t, code, _s in results)
    say("\nALL CHECKS PASSED" if ok else "\nSOMETHING FAILED: see above")
    return 0 if ok else 1


# -- demo and dev --------------------------------------------------------------------------------


def backend_port() -> int:
    return int(os.environ.get("NETSEC_PORT", "8000"))


def wait_for_health(port: int, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as response:
                if response.status == 200:
                    return True
        except OSError:
            time.sleep(0.4)
    return False


def cmd_demo(args: argparse.Namespace) -> int:
    python = venv_python()
    if not python.exists():
        return fail("Backend virtual environment not found. Run `python scripts/tasks.py setup` first.")
    if not (FRONTEND / "dist" / "index.html").exists():
        npm = tool("npm")
        if not npm or not (FRONTEND / "node_modules").exists():
            return fail("The frontend is not built and its dependencies are missing. Run `python scripts/tasks.py setup` first.")
        say("Building the frontend...")
        if run([npm, "run", "build"], cwd=FRONTEND) != 0:
            return 1
    port = backend_port()
    url = f"http://127.0.0.1:{port}/simulation"
    say(f"Starting CIPHER at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Thread(target=lambda: wait_for_health(port) and webbrowser.open(url), daemon=True).start()
    process = subprocess.Popen([str(python), "app.py"], cwd=BACKEND)
    try:
        return process.wait()
    except KeyboardInterrupt:
        return 0
    finally:
        stop(process)


def cmd_dev(_args: argparse.Namespace) -> int:
    python, npm = venv_python(), tool("npm")
    if not python.exists():
        return fail("Backend virtual environment not found. Run `python scripts/tasks.py setup` first.")
    if not npm or not (FRONTEND / "node_modules").exists():
        return fail("Frontend dependencies not found. Run `python scripts/tasks.py setup` first.")
    port = backend_port()
    say(f"Backend:  http://127.0.0.1:{port}  (API docs at /docs)\nFrontend: http://127.0.0.1:5173  (Ctrl+C stops both)")
    backend = subprocess.Popen([str(python), "app.py"], cwd=BACKEND)
    # The Vite proxy follows the backend port, so NETSEC_PORT alone is enough.
    proxy_env = {**os.environ, "VITE_BACKEND_ORIGIN": os.environ.get("VITE_BACKEND_ORIGIN", f"http://127.0.0.1:{port}")}
    frontend = subprocess.Popen([npm, "run", "dev"], cwd=FRONTEND, env=proxy_env)
    try:
        while backend.poll() is None and frontend.poll() is None:
            time.sleep(0.5)
        return backend.returncode or frontend.returncode or 0
    except KeyboardInterrupt:
        return 0
    finally:
        stop(frontend)
        stop(backend)


def cmd_split_check(args: argparse.Namespace) -> int:
    python = venv_python()
    if not python.exists() or not tool("npm") or not (FRONTEND / "node_modules").exists():
        return fail("Run `python scripts/tasks.py setup` first (needs the backend .venv and the frontend dependencies).")
    return run([python, ROOT / "scripts" / "check_split_origin.py", *args.extra])


def cmd_check_deployed(args: argparse.Namespace) -> int:
    python = venv_python()
    if not python.exists():
        return fail("Run `python scripts/tasks.py setup` first (the checks need the backend .venv for PyYAML).")
    return run([python, ROOT / "scripts" / "check_deployed.py", *args.extra])


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("setup", help="virtual environment, dependencies, production build (needs the internet once)")
    p.add_argument("--runtime-only", action="store_true", help="install only what the server needs, not the test tools")
    p.add_argument("--skip-build", action="store_true", help="do not build the frontend")
    p.set_defaults(func=cmd_setup)

    p = sub.add_parser("verify", help="backend tests, scenario checks, frontend tests, production build")
    p.add_argument("--only", nargs="+", choices=["backend", "scenarios", "frontend", "build"], help="run only these steps")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("demo", help="one process serves the API and the built front end")
    p.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    p.set_defaults(func=cmd_demo)
    sub.add_parser("dev", help="backend plus the Vite dev server with hot reload").set_defaults(func=cmd_dev)

    p = sub.add_parser("split-check", help="local simulation of the Render split: front end and API on two origins, in real Chrome")
    p.add_argument("extra", nargs=argparse.REMAINDER, help="passed to scripts/check_split_origin.py (--skip-rehearsal, --api-port, ...)")
    p.set_defaults(func=cmd_split_check)

    p = sub.add_parser("check-deployed", help="HTTP checks against a deployed API and site (after deploying)")
    p.add_argument("extra", nargs=argparse.REMAINDER, help="passed to scripts/check_deployed.py (--api, --site, --spoof-test)")
    p.set_defaults(func=cmd_check_deployed)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
