"""The rate limiter, client addresses behind a proxy, and request classification (no HTTP server involved)."""

from __future__ import annotations

import pytest

from netsec.api.protection import TokenBucketLimiter, classify, client_address


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


# -- token bucket -----------------------------------------------------------------------------------------


def test_a_client_may_use_a_full_minutes_allowance_at_once_and_then_waits() -> None:
    clock = Clock()
    limiter = TokenBucketLimiter(clock=clock)
    assert [limiter.allow("run", "a", 3)[0] for _ in range(3)] == [True, True, True]
    allowed, retry = limiter.allow("run", "a", 3)
    assert allowed is False and retry == pytest.approx(20.0)  # 3 a minute: one token every 20 s


def test_tokens_come_back_with_time_and_never_beyond_the_allowance() -> None:
    clock = Clock()
    limiter = TokenBucketLimiter(clock=clock)
    for _ in range(3):
        limiter.allow("run", "a", 3)
    clock.now += 20
    assert limiter.allow("run", "a", 3)[0] is True and limiter.allow("run", "a", 3)[0] is False
    clock.now += 10_000  # a long absence earns no more than a full bucket
    assert [limiter.allow("run", "a", 3)[0] for _ in range(4)] == [True, True, True, False]


def test_clients_and_classes_are_counted_separately() -> None:
    limiter = TokenBucketLimiter(clock=Clock())
    assert limiter.allow("run", "a", 1)[0] and not limiter.allow("run", "a", 1)[0]
    assert limiter.allow("run", "b", 1)[0]  # another client
    assert limiter.allow("validate", "a", 1)[0]  # another class for the same client


def test_memory_is_bounded_and_the_least_recent_client_is_forgotten() -> None:
    limiter = TokenBucketLimiter(max_keys=3, clock=Clock())
    for client in "abcd":
        limiter.allow("run", client, 1)
    assert len(limiter) == 3
    assert limiter.allow("run", "a", 1)[0] is True  # 'a' was evicted, so it starts again with a full bucket
    assert limiter.allow("run", "d", 1)[0] is False  # 'd' is still remembered


# -- which address is rate-limited -------------------------------------------------------------------------


def scope(peer: str | None = "10.0.0.9", *forwarded: str) -> dict:
    return {"client": (peer, 5555) if peer else None, "headers": [(b"x-forwarded-for", f.encode()) for f in forwarded]}


def test_without_trust_forwarded_headers_are_ignored() -> None:
    assert client_address(scope("10.0.0.9", "203.0.113.5"), trust_proxy=False, hops=1) == "10.0.0.9"


def test_with_trust_the_entry_added_by_the_last_proxy_is_used() -> None:
    assert client_address(scope("10.0.0.9", "203.0.113.5"), True, 1) == "203.0.113.5"


def test_entries_written_by_the_caller_are_never_believed() -> None:
    # The caller sent "1.1.1.1, 2.2.2.2"; the one trusted proxy appended the real address, 203.0.113.5.
    assert client_address(scope("10.0.0.9", "1.1.1.1, 2.2.2.2, 203.0.113.5"), True, 1) == "203.0.113.5"
    # Two trusted proxies: the real client is the second from the right.
    assert client_address(scope("10.0.0.9", "1.1.1.1, 203.0.113.5, 198.51.100.7"), True, 2) == "203.0.113.5"


def test_several_forwarded_headers_count_as_one_list_in_order() -> None:
    assert client_address(scope("10.0.0.9", "1.1.1.1", "203.0.113.5"), True, 1) == "203.0.113.5"
    assert client_address(scope("10.0.0.9", "1.1.1.1", "203.0.113.5"), True, 2) == "1.1.1.1"


@pytest.mark.parametrize("header", [(), ("",), ("not-an-address",), ("203.0.113.5:4444",), ("unknown",)])
def test_a_missing_or_malformed_header_falls_back_to_the_socket_peer(header) -> None:
    assert client_address(scope("10.0.0.9", *header), True, 1) == "10.0.0.9"


def test_a_header_shorter_than_the_trusted_chain_falls_back_to_the_socket_peer() -> None:
    assert client_address(scope("10.0.0.9", "203.0.113.5"), True, 2) == "10.0.0.9"


def test_ipv6_is_normalised_and_a_missing_peer_is_unknown() -> None:
    assert client_address(scope("10.0.0.9", "2001:DB8:0:0:0:0:0:1"), True, 1) == "2001:db8::1"
    assert client_address(scope(None), False, 1) == "unknown"


# -- classification ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("POST", "/api/sim/run", "run"),
        ("POST", "/api/sim/run/", "run"),
        ("POST", "/api/sim/validate", "validate"),
        ("GET", "/api/topology", "api"),
        ("PUT", "/api/rules/detectors", "api"),
        ("GET", "/api/health", None),  # the platform's health check is never limited
        ("OPTIONS", "/api/sim/run", None),  # nor are CORS preflights
        ("GET", "/simulation", None),  # nor the front end's own files
        ("GET", "/assets/index.js", None),
    ],
)
def test_classification(method: str, path: str, expected: str | None) -> None:
    assert classify(method, path) == expected


# -- a single trusted header (a proxy that overwrites it, such as cf-connecting-ip) ---------------------------


def header_scope(peer: str, *pairs: tuple[str, str]) -> dict:
    return {"client": (peer, 5555), "headers": [(name.encode(), value.encode()) for name, value in pairs]}


def test_a_named_header_is_used_only_when_the_proxy_is_trusted() -> None:
    s = header_scope("10.0.0.9", ("cf-connecting-ip", "203.0.113.5"))
    assert client_address(s, False, 1, "cf-connecting-ip") == "10.0.0.9"
    assert client_address(s, True, 1, "cf-connecting-ip") == "203.0.113.5"
    assert client_address(s, True, 1, "CF-Connecting-IP") == "203.0.113.5"  # the configured name is case-insensitive


def test_the_named_header_replaces_forwarded_for_counting() -> None:
    s = header_scope("10.0.0.9", ("x-forwarded-for", "1.1.1.1, 198.51.100.7"), ("cf-connecting-ip", "203.0.113.5"))
    assert client_address(s, True, 1, "cf-connecting-ip") == "203.0.113.5"


@pytest.mark.parametrize(
    "pairs",
    [
        [],  # absent
        [("cf-connecting-ip", "")],
        [("cf-connecting-ip", "garbage")],
        [("cf-connecting-ip", "203.0.113.5, 1.1.1.1")],  # a list is not a single address
        [("cf-connecting-ip", "203.0.113.5"), ("cf-connecting-ip", "1.1.1.1")],  # sent twice: a proxy that overwrites sends it once
    ],
)
def test_an_absent_repeated_or_malformed_named_header_falls_back_to_the_peer(pairs) -> None:
    assert client_address(header_scope("10.0.0.9", *pairs), True, 1, "cf-connecting-ip") == "10.0.0.9"
