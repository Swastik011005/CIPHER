"""Scenario definitions loaded from ``backend/config/scenarios/<ID>.json``."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from netsec.config import SCENARIOS_DIR

_SCENARIO_ID = re.compile(r"^[SP][0-9]{1,2}$")
_BASELINE_ID = re.compile(r"^S[0-9]{1,2}$")
_PRESENTATION_ID = re.compile(r"^P[0-9]{1,2}$")


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


class FlagProbeSpec(_Strict):
    """Raw TCP segments with chosen flags (``count`` of them, ``interval`` apart): for example a NULL or XMAS probe."""

    type: Literal["flag_probe"]
    id: str
    src: str
    dst: str
    dport: int = Field(ge=1, le=65535)
    flags: list[Literal["SYN", "ACK", "FIN", "RST", "PSH", "URG"]]
    start: float = Field(ge=0)
    count: int = Field(default=1, ge=1, le=50)
    interval: float = Field(default=0.5, gt=0)


class FloodPhase(_Strict):
    """``rate`` packets per second for ``duration`` seconds."""

    rate: float = Field(gt=0, le=200)
    duration: float = Field(gt=0, le=60)


class SynFloodSpec(_Strict):
    """A SYN flood: bare SYNs to one port at a changing rate (each phase runs after the one before)."""

    type: Literal["syn_flood"]
    id: str
    src: str
    dst: str
    dport: int = Field(ge=1, le=65535)
    start: float = Field(ge=0)
    phases: list[FloodPhase] = Field(min_length=1, max_length=10)


FlowSpec = Annotated[
    Union[TcpSessionSpec, IcmpEchoSpec, PortScanSpec, FlagProbeSpec, SynFloodSpec], Field(discriminator="type")
]


class Features(_Strict):
    """Campus security features a scenario turns on. The baseline scenarios S1 to S7 turn none on, so they emit no new events."""

    zero_trust: bool = False
    edr: bool = False
    siem: bool = False


class EndpointEventSpec(_Strict):
    """The scenario's story: at time ``t`` the EDR agent on ``node`` sees the endpoint become suspicious or compromised."""

    t: float = Field(ge=0)
    node: str
    state: Literal["suspicious", "compromised"]
    reason: str


class OperatorActionSpec(_Strict):
    """A scripted SOC operator action (isolate or restore), applied when the scenario is run with ``scripted_operator``."""

    t: float = Field(ge=0)
    node: str
    action: Literal["isolate", "restore"]


class Presentation(_Strict):
    """What the scenario launcher shows for a presentation scenario (P1 to P9)."""

    number: int = Field(ge=1, le=9)
    objective: str
    source: str
    destination: str
    protocol: str
    port: Optional[int] = None
    security_rule: str
    explanation: str
    expected: list[str] = Field(min_length=1)


class ScenarioSpec(_Strict):
    id: str
    name: str
    description: str
    duration: float = Field(gt=0)
    default_seed: int
    #: When set, the scenario always runs with the IPS in this mode (S5 and S6), whatever the caller asks for.
    pinned_ips_mode: Optional[Literal["monitor", "enforce"]] = None
    flows: list[FlowSpec] = Field(min_length=1)
    #: Campus security extension (all default to off, so S1 to S7 are unchanged).
    features: Features = Field(default_factory=Features)
    initial_isolated: list[str] = Field(default_factory=list)
    endpoint_events: list[EndpointEventSpec] = Field(default_factory=list)
    operator_actions: list[OperatorActionSpec] = Field(default_factory=list)
    presentation: Optional[Presentation] = None


def scenario_path(scenario_id: str, directory: Optional[Path] = None) -> Path:
    """Resolve a scenario id to its file, refusing anything that is not ``S<number>`` or ``P<number>``."""
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
    """The baseline scenarios S1 to S7 present in this build, ordered by id."""
    folder = directory or SCENARIOS_DIR
    ids = sorted(
        (p.stem for p in folder.glob("S*.json") if _BASELINE_ID.match(p.stem)),
        key=lambda s: int(s[1:]),
    )
    return [load_scenario(i, folder) for i in ids]


def list_presentation_scenarios(directory: Optional[Path] = None) -> list[ScenarioSpec]:
    """The nine presentation scenarios P1 to P9, in order. They are separate from the baseline S1 to S7 and their 93 checks."""
    folder = directory or SCENARIOS_DIR
    ids = sorted((p.stem for p in folder.glob("P*.json") if _PRESENTATION_ID.match(p.stem)), key=lambda s: int(s[1:]))
    return [load_scenario(i, folder) for i in ids]
