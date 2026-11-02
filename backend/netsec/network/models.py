"""Pydantic models for the authoritative network topology (``config/topology.json``)."""

from __future__ import annotations

from ipaddress import AddressValueError, IPv4Address, IPv4Network
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

NodeType = Literal[
    "host", "router", "l3switch", "l2switch", "firewall", "ids", "ips", "syslog", "segment"
]
FormFactor = Literal[
    "desktop",
    "laptop",
    "router",
    "switch-l3",
    "switch-l2",
    "firewall",
    "ids-sensor",
    "ips-appliance",
    "rack-server",
    "soc-console",
    "internet-cloud",
]
LinkKind = Literal["ethernet", "access", "trunk", "mgmt", "span"]


class _Strict(BaseModel):
    """Base model: unknown fields are errors and instances are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True)


def _check_ipv4(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    try:
        IPv4Address(value)
    except AddressValueError as exc:
        raise ValueError(f"invalid IPv4 address: {value!r}") from exc
    return value


class Meta(_Strict):
    name: str
    description: str
    contract: str


class Vlan(_Strict):
    id: int = Field(ge=1, le=4094)
    name: str
    description: str


class Subnet(_Strict):
    id: str
    cidr: str
    kind: Literal["vlan", "routed"]
    vlan: Optional[int] = None
    name: str

    @field_validator("cidr")
    @classmethod
    def _valid_cidr(cls, value: str) -> str:
        IPv4Network(value, strict=True)
        return value

    @model_validator(mode="after")
    def _vlan_matches_kind(self) -> "Subnet":
        if self.kind == "vlan" and self.vlan is None:
            raise ValueError(f"subnet {self.id}: kind 'vlan' requires a vlan id")
        if self.kind == "routed" and self.vlan is not None:
            raise ValueError(f"subnet {self.id}: routed subnets must not carry a vlan id")
        return self

    @property
    def network(self) -> IPv4Network:
        return IPv4Network(self.cidr)


class Zone(_Strict):
    id: str
    name: str
    description: str
    vlan: Optional[int] = None


class Interface(_Strict):
    name: str
    kind: Literal["physical", "svi"] = "physical"
    ip: Optional[str] = None
    prefix: Optional[int] = Field(default=None, ge=1, le=32)
    gateway: Optional[str] = None
    vlan: Optional[int] = None

    @field_validator("ip", "gateway")
    @classmethod
    def _valid_ip(cls, value: Optional[str]) -> Optional[str]:
        return _check_ipv4(value)

    @model_validator(mode="after")
    def _consistent(self) -> "Interface":
        if (self.ip is None) != (self.prefix is None):
            raise ValueError(f"interface {self.name}: ip and prefix must be given together")
        if self.gateway is not None and self.ip is None:
            raise ValueError(f"interface {self.name}: a gateway needs an ip address")
        if self.kind == "svi" and (self.vlan is None or self.ip is None):
            raise ValueError(f"interface {self.name}: an SVI needs a vlan and an ip address")
        if self.kind == "physical" and self.vlan is not None:
            raise ValueError(
                f"interface {self.name}: physical interfaces take their VLAN from the link"
            )
        return self

    @property
    def network(self) -> Optional[IPv4Network]:
        if self.ip is None or self.prefix is None:
            return None
        return IPv4Network(f"{self.ip}/{self.prefix}", strict=False)


class Route(_Strict):
    prefix: str
    next_hop: str
    metric: int = Field(default=1, ge=0)

    @field_validator("prefix")
    @classmethod
    def _valid_prefix(cls, value: str) -> str:
        IPv4Network(value, strict=True)
        return value

    @field_validator("next_hop")
    @classmethod
    def _valid_next_hop(cls, value: str) -> str:
        _check_ipv4(value)
        return value


class Service(_Strict):
    proto: Literal["tcp", "udp"]
    port: int = Field(ge=1, le=65535)
    name: str
    encrypted: bool = False
    response_bytes: int = Field(default=0, ge=0)


class Bridge(_Strict):
    """Transparent Layer 2 bridging between two data ports for one VLAN (the inline IPS)."""

    vlan: int
    ports: list[str] = Field(min_length=2, max_length=2)


class Node(_Strict):
    id: str
    label: str
    type: NodeType
    form_factor: FormFactor
    zone: str
    role: str
    description: str
    interfaces: list[Interface]
    routes: list[Route] = Field(default_factory=list)
    services: list[Service] = Field(default_factory=list)
    bridge: Optional[Bridge] = None

    @property
    def is_device(self) -> bool:
        return self.type != "segment"

    def interface(self, name: str) -> Interface:
        for iface in self.interfaces:
            if iface.name == name:
                return iface
        raise KeyError(f"{self.id} has no interface {name!r}")


class Endpoint(_Strict):
    node: str
    iface: str


class Link(_Strict):
    id: str
    a: Endpoint
    b: Endpoint
    kind: LinkKind
    vlan: Optional[int] = None
    trunk_vlans: Optional[list[int]] = None

    def other(self, node_id: str) -> Endpoint:
        """Return the endpoint that is not on ``node_id``."""
        if self.a.node == node_id:
            return self.b
        if self.b.node == node_id:
            return self.a
        raise KeyError(f"link {self.id} does not touch {node_id}")

    def local(self, node_id: str) -> Endpoint:
        """Return the endpoint that is on ``node_id``."""
        if self.a.node == node_id:
            return self.a
        if self.b.node == node_id:
            return self.b
        raise KeyError(f"link {self.id} does not touch {node_id}")


class SpanConfig(_Strict):
    node: str
    direction: Literal["ingress"]
    destination_link: str
    sensor: str
    exclude_vlans: list[int] = Field(default_factory=list)


class Topology(_Strict):
    version: str
    meta: Meta
    vlans: list[Vlan]
    subnets: list[Subnet]
    zones: list[Zone]
    nodes: list[Node]
    links: list[Link]
    span: SpanConfig
