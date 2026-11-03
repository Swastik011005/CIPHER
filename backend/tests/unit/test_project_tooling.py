"""Guards for the cross-platform task runner and the runtime/development dependency split."""

from __future__ import annotations

import ast
import importlib.util
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "backend"
DEV_ONLY_PACKAGES = {"pytest", "httpx", "scapy"}


def _load_tasks():
    spec = importlib.util.spec_from_file_location("netsec_tasks", REPO / "scripts" / "tasks.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pins(path: Path) -> dict[str, str]:
    """name -> version for every `name==version` line (comments and -r lines ignored)."""
    pins: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        match = re.fullmatch(r"([A-Za-z0-9_.\-]+)==(\S+)", line)
        if match:
            pins[match.group(1).lower().replace("_", "-")] = match.group(2)
    return pins


def test_task_runner_finds_the_virtual_environment_python_on_each_platform() -> None:
    tasks = _load_tasks()
    assert tasks.venv_python(True).parts[-3:] == (".venv", "Scripts", "python.exe")
    assert tasks.venv_python(False).parts[-3:] == (".venv", "bin", "python")


@pytest.mark.parametrize(
    ("text", "expected"),
    [("v24.15.0\n", (24, 15)), ("20.19.0", (20, 19)), ("v22.1.7", (22, 1)), ("not node", None), ("", None)],
)
def test_task_runner_reads_node_versions(text: str, expected: tuple[int, int] | None) -> None:
    assert _load_tasks().parse_node_version(text) == expected


def test_verify_runs_the_four_release_gates_and_pytest_ignores_the_quiet_flag() -> None:
    tasks = _load_tasks()
    steps = tasks.verify_steps(Path("python"), "npm", "npx")
    assert [s[0] for s in steps] == ["backend", "scenarios", "frontend", "build"]
    pytest_cmd = [str(c) for c in steps[0][2]]
    assert "pytest" in pytest_cmd and "addopts=" in pytest_cmd  # prints the "N passed" total


def test_runtime_requirements_hold_only_what_the_server_needs() -> None:
    runtime = _pins(BACKEND / "requirements.txt")
    assert set(runtime) == {"fastapi", "uvicorn", "pydantic"}
    assert not DEV_ONLY_PACKAGES & set(runtime)


def test_dev_requirements_extend_the_runtime_set_with_the_test_tools() -> None:
    text = (BACKEND / "requirements-dev.txt").read_text(encoding="utf-8")
    assert re.search(r"^-r requirements\.txt\s*$", text, re.MULTILINE)
    assert DEV_ONLY_PACKAGES <= set(_pins(BACKEND / "requirements-dev.txt"))


def test_lock_files_agree_with_the_direct_pins_and_the_runtime_lock_has_no_test_tools() -> None:
    runtime, dev = _pins(BACKEND / "requirements.txt"), _pins(BACKEND / "requirements-dev.txt")
    runtime_lock, dev_lock = _pins(BACKEND / "requirements.lock.txt"), _pins(BACKEND / "requirements-dev.lock.txt")
    for name, version in {**runtime, **dev}.items():
        assert (dev_lock.get(name) == version), f"{name} is not locked at {version} in requirements-dev.lock.txt"
    for name, version in runtime.items():
        assert runtime_lock.get(name) == version, f"{name} is not locked at {version} in requirements.lock.txt"
    assert not DEV_ONLY_PACKAGES & set(runtime_lock)
    assert runtime_lock.items() <= dev_lock.items()


def test_server_code_never_imports_development_only_packages() -> None:
    offenders = []
    for path in [BACKEND / "app.py", *sorted((BACKEND / "netsec").rglob("*.py"))]:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
            offenders += [f"{path.relative_to(REPO)} imports {n}" for n in names if n.split(".")[0] in DEV_ONLY_PACKAGES]
    assert not offenders, offenders
