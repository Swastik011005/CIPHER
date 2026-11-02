"""Scenario definitions loaded from ``backend/config/scenarios/<ID>.json``."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from netsec.config import SCENARIOS_DIR

_SCENARIO_ID = re.compile(r"^S[0-9]{1,2}$")


class ScenarioError(Exception):
    """Base class for scenario loading problems."""


class ScenarioNotFound(ScenarioError):
    """No scenario with that id exists in this build."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class TcpSessionSpec(_Strict):
    type: Literal["tcp_session"]
    id: str
    src: str
    dst: str
    dport: int = Field(ge=1, le=65535)
    start: float = Field(ge=0)
    request_bytes: int = Field(ge=0)


class IcmpEchoSpec(_Strict):
    type: Literal["icmp_echo"]
    id: str
    src: str
    dst: str
    start: float = Field(ge=0)
    count: int = Field(ge=1, le=100)
    interval: float = Field(gt=0)
    payload_bytes: int = Field(default=32, ge=0)


class PortScanSpec(_Strict):
    """A SYN scan: one bare SYN to each listed port, ``rate`` probes per second."""

    type: Literal["port_scan"]
    id: str
    src: str
    dst: str
    ports: list[int] = Field(min_length=1, max_length=200)
    start: float = Field(ge=0)
    rate: float = Field(gt=0, le=50)


FlowSpec = Annotated[Union[TcpSessionSpec, IcmpEchoSpec, PortScanSpec], Field(discriminator="type")]


class ScenarioSpec(_Strict):
    id: str
    name: str
    description: str
    duration: float = Field(gt=0)
    default_seed: int
    flows: list[FlowSpec] = Field(min_length=1)


def scenario_path(scenario_id: str, directory: Optional[Path] = None) -> Path:
    """Resolve a scenario id to its file, refusing anything that is not ``S<number>``."""
    if not _SCENARIO_ID.match(scenario_id):
        raise ScenarioNotFound(f"unknown scenario {scenario_id!r}")
    return (directory or SCENARIOS_DIR) / f"{scenario_id}.json"


def load_scenario(scenario_id: str, directory: Optional[Path] = None) -> ScenarioSpec:
    path = scenario_path(scenario_id, directory)
    if not path.is_file():
        raise ScenarioNotFound(f"unknown scenario {scenario_id!r}")
    try:
        spec = ScenarioSpec.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, ValueError) as exc:
        raise ScenarioError(f"scenario file {path.name} is invalid: {exc}") from exc
    if spec.id != scenario_id:
        raise ScenarioError(f"scenario file {path.name} declares id {spec.id!r}")
    return spec


def list_scenarios(directory: Optional[Path] = None) -> list[ScenarioSpec]:
    """All scenarios present in this build, ordered by id."""
    folder = directory or SCENARIOS_DIR
    ids = sorted(
        (p.stem for p in folder.glob("S*.json") if _SCENARIO_ID.match(p.stem)),
        key=lambda s: int(s[1:]),
    )
    return [load_scenario(i, folder) for i in ids]
