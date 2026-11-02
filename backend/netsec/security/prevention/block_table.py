"""Temporary source blocks held by the IPS."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Block:
    src: str
    until: float  # simulation seconds
    rule: str
    incident_id: str


class BlockTable:
    def __init__(self) -> None:
        self._blocks: dict[str, Block] = {}

    def active(self, src: str, now: float) -> Optional[Block]:
        """The block on ``src`` at ``now``, if one is in force (a block ends exactly at ``until``)."""
        block = self._blocks.get(src)
        return block if block is not None and block.until > now else None

    def add(self, block: Block) -> None:
        self._blocks[block.src] = block

    def remove(self, src: str, until: float) -> None:
        """Drop the block on ``src`` only if it is the one ending at ``until`` (a newer block stays)."""
        block = self._blocks.get(src)
        if block is not None and block.until == until:
            del self._blocks[src]
