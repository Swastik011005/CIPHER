"""The inline IPS (IPS-1).

Processing order for every packet that reaches it (frozen, Rev 3 A5):

1. Is the source in the block table? Drop it.
2. Run the detectors on the packet, so they always see the true traffic (a rate limiter can never hide a flood).
3. Look up the configured action for the most severe finding.
4. Enforce mode applies the action; Monitor mode only records that it would have. For ``rate_limit`` only the
   packets over the token bucket are acted on; the rest pass without an ``ips.action`` event.
5. The caller forwards the packet unless it was dropped.

The IPS is the only component that can enforce on a detection. IDS-1 has no such object.
This changes simulation state only; nothing is blocked on a real network.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from netsec.security.config import DetectorsConfig, IpsPolicyConfig, SecurityConfigError
from netsec.security.correlation import Correlator
from netsec.security.detection.base import ObservedPacket
from netsec.security.detection.engine import DetectionEngine, Observation
from netsec.security.prevention.block_table import Block, BlockTable
from netsec.security.prevention.rate_limiter import TokenBucket

IpsMode = Literal["monitor", "enforce"]
SUPPORTED_ACTIONS = frozenset({"allow", "drop", "reject", "block_source", "rate_limit"})
ALLOWLIST_RULE = "allowlist"


@dataclass
class IpsOutcome:
    observation: Observation
    action: Optional[str] = None  # value for the ips.action event; None when no action is configured
    applied: bool = False  # False in Monitor mode: the action was only recorded
    rule: str = ""
    drop_reason: Optional[str] = None  # set when this packet must be dropped
    new_block: Optional[Block] = None
    from_block_table: bool = False


class IpsEngine:
    def __init__(
        self,
        mode: IpsMode,
        detectors: DetectorsConfig,
        policy: IpsPolicyConfig,
        correlator: Correlator,
        sensor: str = "IPS-1",
    ) -> None:
        unsupported = {r.action for r in policy.rules} - SUPPORTED_ACTIONS
        if unsupported:
            raise SecurityConfigError(f"IPS actions not implemented yet: {sorted(unsupported)}")
        self.mode = mode
        self.policy = policy
        self.blocks = BlockTable()
        self._buckets: dict[str, TokenBucket] = {}  # one token bucket per rate-limited source
        self.detection = DetectionEngine(sensor, detectors, correlator)
        self.correlator = correlator

    def process(self, packet: ObservedPacket, now: float) -> IpsOutcome:
        # 1. block table
        block = self.blocks.active(packet.src, now)
        if block is not None:
            return IpsOutcome(
                observation=Observation(),
                action="block_source",
                applied=True,
                rule=block.rule,
                drop_reason="blocked_source",
                from_block_table=True,
            )

        # 2. detectors see every packet that is not already blocked
        observation = self.detection.observe(packet, now)
        finding = observation.top
        if finding is None:
            return IpsOutcome(observation=observation)

        # 3. configured action for the most severe finding
        rule = self.policy.rule_for(finding.rule, finding.severity)
        if rule is None or rule.action == "allow":
            return IpsOutcome(observation=observation)
        if self.policy.is_allowlisted(packet.src):
            return IpsOutcome(observation=observation, action="allow", applied=True, rule=ALLOWLIST_RULE)

        # 3b. rate limit: packets within the token bucket pass untouched; only the excess is acted on
        if rule.action == "rate_limit":
            bucket = self._buckets.get(packet.src)
            if bucket is None:
                bucket = self._buckets[packet.src] = TokenBucket(rule.rate_pps or 1.0, rule.burst or 1, now)
            if bucket.allow(now):
                return IpsOutcome(observation=observation)
            if self.mode == "monitor":
                return IpsOutcome(observation=observation, action="rate_limit", applied=False, rule=finding.rule)
            return IpsOutcome(
                observation=observation, action="rate_limit", applied=True, rule=finding.rule, drop_reason="rate_limited"
            )

        # 4. enforce or only record
        if self.mode == "monitor":
            return IpsOutcome(observation=observation, action=rule.action, applied=False, rule=finding.rule)

        outcome = IpsOutcome(observation=observation, action=rule.action, applied=True, rule=finding.rule)
        outcome.drop_reason = "ips_reject" if rule.action == "reject" else "ips_drop"
        if rule.action == "block_source":
            outcome.new_block = Block(
                src=packet.src,
                until=round(now + (rule.duration_s or 0.0), 6),
                rule=finding.rule,
                incident_id=self.correlator.incident_for(finding.rule, finding.src, finding.dst),
            )
            self.blocks.add(outcome.new_block)
        return outcome

    def expire(self, src: str, until: float) -> bool:
        """End the block on ``src`` that runs to ``until``. False when it was already lifted."""
        return self.blocks.remove(src, until)

    def set_mode(self, mode: IpsMode) -> list[Block]:
        """Change mode. Monitor never drops anything, so switching to it lifts all active blocks (returned)."""
        self.mode = mode
        return self.blocks.clear() if mode == "monitor" else []
