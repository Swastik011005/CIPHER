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


def _check_cidr(value: str) -> str:
    IPv4Network(value, strict=False)
    return value


class RestrictedService(_Strict):
    """A service only certain sources may use, for example the database, which only the application server may reach."""

    name: str
    dst: str
    dport: int = Field(ge=1, le=65535)
    allowed_sources: list[str]

    @field_validator("dst")
    @classmethod
    def _valid_dst(cls, value: str) -> str:
        IPv4Address(value)
        return value

    @field_validator("allowed_sources")
    @classmethod
    def _valid_sources(cls, values: list[str]) -> list[str]:
        return [_check_cidr(v) for v in values]


class D4Config(_Strict):
    """Restricted service: a TCP packet to a restricted service from a source that is not allowed to use it."""

    enabled: bool = True
    suppression_s: float = Field(default=30.0, ge=0)
    services: list[RestrictedService] = Field(
        default_factory=lambda: [
            RestrictedService(name="MySQL database", dst="10.0.30.20", dport=3306, allowed_sources=["10.0.30.10/32"])
        ]
    )


class ForbiddenPair(_Strict):
    """Traffic that policy says must never flow from one zone to another."""

    name: str
    src: str
    dst: str

    @field_validator("src", "dst")
    @classmethod
    def _valid_cidr(cls, value: str) -> str:
        return _check_cidr(value)


class D5Config(_Strict):
    """Forbidden zone pair: any packet from a source zone to a destination zone that policy forbids."""

    enabled: bool = True
    suppression_s: float = Field(default=30.0, ge=0)
    pairs: list[ForbiddenPair] = Field(
        default_factory=lambda: [
            ForbiddenPair(name="Staff to Security network", src="10.0.10.0/24", dst="10.0.99.0/24"),
            ForbiddenPair(name="Outside to Security network", src="203.0.113.0/24", dst="10.0.99.0/24"),
        ]
    )


INVALID_FLAG_SIGNATURES = ("null", "xmas", "syn_fin", "syn_rst", "fin_rst")


class D6Config(_Strict):
    """Invalid TCP flags: flag combinations no legitimate TCP stack sends (scan and evasion signatures)."""

    enabled: bool = True
    suppression_s: float = Field(default=30.0, ge=0)
    signatures: list[Literal["null", "xmas", "syn_fin", "syn_rst", "fin_rst"]] = Field(
        default_factory=lambda: list(INVALID_FLAG_SIGNATURES)
    )


class D2Config(_Strict):
    """Brute force: connection attempts to remote-login ports from one source to one target."""

    enabled: bool = True
    ports: list[int] = Field(default_factory=lambda: [22, 23, 3389], min_length=1)
    window_s: float = Field(default=30.0, gt=0)
    suspicious: int = Field(default=6, ge=2)
    violation: int = Field(default=12, ge=3)
    suppression_s: float = Field(default=30.0, ge=0)

    @model_validator(mode="after")
    def _ordered(self) -> "D2Config":
        if self.suspicious >= self.violation:
            raise ValueError("D2: 'suspicious' must be lower than 'violation'")
        return self


class D3Config(_Strict):
    """Flood: packets per second from one source to one target, averaged over the window."""

    enabled: bool = True
    window_s: float = Field(default=5.0, gt=0)
    suspicious_pps: float = Field(default=25.0, gt=0)
    violation_pps: float = Field(default=50.0, gt=0)
    suppression_s: float = Field(default=30.0, ge=0)

    @model_validator(mode="after")
    def _ordered(self) -> "D3Config":
        if self.suspicious_pps >= self.violation_pps:
            raise ValueError("D3: 'suspicious_pps' must be lower than 'violation_pps'")
        return self


class DetectorsConfig(_Strict):
    D1: D1Config
    D2: D2Config = Field(default_factory=D2Config)
    D3: D3Config = Field(default_factory=D3Config)
    D4: D4Config = Field(default_factory=D4Config)
    D5: D5Config = Field(default_factory=D5Config)
    D6: D6Config = Field(default_factory=D6Config)


class IpsRule(_Strict):
    """What the IPS does when a detector reaches a severity (only in Enforce mode)."""

    detector: Literal["D1", "D2", "D3", "D4", "D5", "D6"]
    severity: Literal["low", "medium", "high"]
    action: Literal["allow", "drop", "reject", "block_source", "rate_limit"]
    duration_s: Optional[float] = Field(default=None, gt=0)
    #: Token bucket for ``rate_limit``: packets per second let through, and how many may arrive in a burst.
    rate_pps: Optional[float] = Field(default=None, gt=0)
    burst: Optional[int] = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _parameters_for_action(self) -> "IpsRule":
        if self.action == "block_source" and self.duration_s is None:
            raise ValueError("block_source needs duration_s")
        if self.action == "rate_limit" and (self.rate_pps is None or self.burst is None):
            raise ValueError("rate_limit needs rate_pps and burst")
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
