"""Token-bucket rate limiter used by IPS-1's ``rate_limit`` action.

Each source has a bucket that holds up to ``burst`` tokens and refills at ``rate_pps`` tokens per second of
simulation time. A packet needs one token; with none left it is over the limit. Packets that are refused
do not take tokens, so Monitor mode (which only records) and Enforce mode (which drops) see the same bucket.
"""

from __future__ import annotations


class TokenBucket:
    def __init__(self, rate_pps: float, burst: int, now: float = 0.0) -> None:
        self.rate_pps = rate_pps
        self.burst = burst
        self._tokens = float(burst)
        self._last = now

    def allow(self, now: float) -> bool:
        """Take one token if there is one. ``now`` must not go backwards."""
        self._tokens = min(float(self.burst), self._tokens + max(0.0, now - self._last) * self.rate_pps)
        self._last = now
        if self._tokens >= 1.0 - 1e-9:  # a hair of tolerance: refills of 0.1 do not add up to exactly 1.0 in floating point
            self._tokens = max(0.0, self._tokens - 1.0)
            return True
        return False

    @property
    def tokens(self) -> float:
        return self._tokens
