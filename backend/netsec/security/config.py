"""Detector thresholds and IPS policy, loaded from ``config/detectors.json`` and ``config/ips_policy.json``."""

from __future__ import annotations

import json
from ipaddress import IPv4Address, IPv4Network
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from netsec.config import CONFIG_DIR


class SecurityConfigError(Exception):
    """A security config file is unreadable or invalid."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class D1Config(_Strict):
    """Vertical port scan: distinct destination ports probed with bare SYNs from one source to one target."""

    enabled: bool = True
    window_s: float = Field(gt=0)
    suspicious: int = Field(ge=2)
    violation: int = Field(ge=3)
    suppression_s: float = Field(ge=0)

    @model_validator(mode="after")
    def _ordered(self) -> "D1Config":
        if self.suspicious >= self.violation:
            raise ValueError("D1: 'suspicious' must be lower than 'violation'")
        return self


class DetectorsConfig(_Strict):
    D1: D1Config


class IpsRule(_Strict):
    """What the IPS does when a detector reaches a severity (only in Enforce mode)."""

    detector: Literal["D1"]
    severity: Literal["low", "medium", "high"]
    action: Literal["allow", "drop", "reject", "block_source", "rate_limit"]
    duration_s: Optional[float] = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _duration_for_blocks(self) -> "IpsRule":
        if self.action == "block_source" and self.duration_s is None:
            raise ValueError("block_source needs duration_s")
        return self


class IpsPolicyConfig(_Strict):
    allowlist: list[str]
    rules: list[IpsRule]

    @field_validator("allowlist")
    @classmethod
    def _valid_cidrs(cls, values: list[str]) -> list[str]:
        for v in values:
            IPv4Network(v, strict=False)
        return values

    def is_allowlisted(self, address: str) -> bool:
        return any(IPv4Address(address) in IPv4Network(c, strict=False) for c in self.allowlist)

    def rule_for(self, detector: str, severity: str) -> Optional[IpsRule]:
        return next((r for r in self.rules if r.detector == detector and r.severity == severity), None)


def _load(path: Path, model):
    try:
        return model.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except OSError as exc:
        raise SecurityConfigError(f"cannot read {path}: {exc}") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise SecurityConfigError(f"{path.name} is invalid: {exc}") from exc


def load_detectors(path: Optional[Path] = None) -> DetectorsConfig:
    return _load(path or CONFIG_DIR / "detectors.json", DetectorsConfig)


def load_ips_policy(path: Optional[Path] = None) -> IpsPolicyConfig:
    return _load(path or CONFIG_DIR / "ips_policy.json", IpsPolicyConfig)
