"""Mid-run controls: configuration changes applied at a chosen simulation time.

A control takes effect at its time and never rewrites the past: every event before that time is
identical to the same run without the control (prefix stability). Controls are applied before
anything else that happens at the same instant (``Priority.CONTROL``).
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class IpsModeControl(_Strict):
    """Switch IPS-1 between Monitor and Enforce. Switching to Monitor lifts any active blocks."""

    type: Literal["ips_mode"]
    t: float = Field(ge=0)
    mode: Literal["monitor", "enforce"]


class DetectorControl(_Strict):
    """Turn one detector (D1, D4, D5, D6) on or off in both sensors."""

    type: Literal["detector"]
    t: float = Field(ge=0)
    detector: Literal["D1", "D4", "D5", "D6"]
    enabled: bool


ControlSpec = Annotated[Union[IpsModeControl, DetectorControl], Field(discriminator="type")]
