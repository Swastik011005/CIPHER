"""Firewall and ACL policy models, loaded from ``config/policies/*.json``."""

from __future__ import annotations

import json
from ipaddress import IPv4Address, IPv4Network
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator

from netsec.config import CONFIG_DIR

POLICY_DIR = CONFIG_DIR / "policies"


class PolicyError(Exception):
    """A policy file is unreadable or invalid."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _check_address(value: str) -> str:
    if value in ("any", "restricted"):
        return value
    IPv4Network(value, strict=False)
    return value


class Rule(_Strict):
    """One ACL line. ``src``/``dst`` are ``any``, ``restricted`` (source only), an address or a CIDR."""

    id: str
    action: Literal["permit", "deny"]
    proto: Literal["ip", "tcp", "udp", "icmp"] = "ip"
    src: str = "any"
    dst: str = "any"
    sport: Optional[int] = None
    dport: Optional[int] = None
    enabled: bool = True
    description: str = ""

    @field_validator("src", "dst")
    @classmethod
    def _valid_address(cls, value: str) -> str:
        return _check_address(value)

    @field_validator("dst")
    @classmethod
    def _no_restricted_destination(cls, value: str) -> str:
        if value == "restricted":
            raise ValueError("'restricted' is only valid as a source")
        return value


class Policy(_Strict):
    """An ordered rule list applied to packets arriving on one link of one node.

    There is always an implicit deny after the last rule. ``stateful`` policies track permitted
    flows and permit their return traffic without evaluating the rules.
    """

    name: str
    node: str
    ingress_link: str
    vlan: Optional[int] = None
    stateful: bool = False
    rules: list[Rule]


class PolicyFile(_Strict):
    restricted_ips: list[str] = []
    policies: list[Policy]

    @field_validator("restricted_ips")
    @classmethod
    def _valid_ips(cls, values: list[str]) -> list[str]:
        for v in values:
            IPv4Address(v)
        return values


def load_policy_file(path: Path) -> PolicyFile:
    try:
        return PolicyFile.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except OSError as exc:
        raise PolicyError(f"cannot read policy file {path}: {exc}") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise PolicyError(f"policy file {path.name} is invalid: {exc}") from exc


def load_policies(directory: Optional[Path] = None) -> list[PolicyFile]:
    """Every ``*.json`` file in the policy directory, in name order."""
    folder = directory or POLICY_DIR
    return [load_policy_file(p) for p in sorted(folder.glob("*.json"))]
