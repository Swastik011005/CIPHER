"""Protection for a publicly reachable server: request size limit, per-client rate limiting, security headers.

Pure ASGI middleware with no dependencies beyond Starlette. Nothing here touches the simulation: it only decides
whether a request is let through, and adds headers to the answer.

Limits (documented in docs/DEPLOYMENT_RENDER.md):

* The rate limiter is **in memory and per process**. A restart forgets every client, and several processes or
  instances would each count separately. The server is meant to run as one instance.
* A client is identified by its address. By default that is the socket peer. Behind a proxy it can come from
  ``X-Forwarded-For`` or a named header, but only when ``NETSEC_TRUST_PROXY`` is on. For ``X-Forwarded-For`` only the entry
  that the last ``NETSEC_TRUSTED_PROXY_HOPS`` proxies appended (counted from the right) is used: entries further left are
  written by the caller and are never believed. ``NETSEC_CLIENT_IP_HEADER`` names one header (such as ``cf-connecting-ip``)
  that the proxy overwrites; it is used only if it appears exactly once and holds an IP address.
* Trust the proxy only if the server can be reached solely through it. If a caller can connect directly, every forwarded
  header is the caller's own.
"""

from __future__ import annotations

import ipaddress
import math
import time
from collections import OrderedDict
from typing import Callable, Mapping, Optional

from starlette.datastructures import MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_TRACKED_CLIENTS = 10_000


def client_address(scope: Scope, trust_proxy: bool, hops: int, header: Optional[str] = None) -> str:
    """The address to rate-limit by.

    Without ``trust_proxy`` it is the socket peer, whatever headers say. With it, either the single ``header`` named by
    the operator (for a proxy that overwrites it, such as ``cf-connecting-ip``), or the ``X-Forwarded-For`` entry added
    by the last ``hops`` proxies (the ``hops``-th from the right). A missing, too short or malformed value falls back to
    the socket peer, which is the safe direction (clients then share a bucket instead of choosing their own).
    """
    peer = (scope.get("client") or ("unknown", 0))[0]
    if not trust_proxy:
        return peer
    if header:
        values = [value.decode("latin-1").strip() for name, value in scope.get("headers", []) if name == header.lower().encode("latin-1")]
        if len(values) != 1:  # absent, or sent twice (a proxy that overwrites sends it once): do not guess
            return peer
        try:
            return str(ipaddress.ip_address(values[0]))
        except ValueError:
            return peer
    values = [value.decode("latin-1") for name, value in scope.get("headers", []) if name == b"x-forwarded-for"]
    entries = [item.strip() for item in ",".join(values).split(",") if item.strip()]
    if len(entries) < hops:
        return peer
    try:
        return str(ipaddress.ip_address(entries[-hops]))
    except ValueError:
        return peer


class TokenBucketLimiter:
    """Token buckets per (class, client). A class allowing N requests a minute holds N tokens and refills N/60 a second.

    Not thread-safe by design: it is only used from the event loop. At most ``max_keys`` clients are remembered; beyond
    that the least recently seen one is forgotten (it then starts again with a full bucket).
    """

    def __init__(self, max_keys: int = MAX_TRACKED_CLIENTS, clock: Callable[[], float] = time.monotonic) -> None:
        self._buckets: OrderedDict[tuple[str, str], tuple[float, float]] = OrderedDict()
        self._max_keys = max_keys
        self._clock = clock

    def __len__(self) -> int:
        return len(self._buckets)

    def allow(self, bucket_class: str, client: str, per_minute: int) -> tuple[bool, float]:
        """Take one token. Returns (allowed, seconds until a token is available when refused)."""
        now = self._clock()
        key = (bucket_class, client)
        rate = per_minute / 60.0
        tokens, last = self._buckets.get(key, (float(per_minute), now))
        tokens = min(float(per_minute), tokens + (now - last) * rate)
        allowed = tokens >= 1.0
        if allowed:
            tokens -= 1.0
        self._buckets[key] = (tokens, now)
        self._buckets.move_to_end(key)
        while len(self._buckets) > self._max_keys:
            self._buckets.popitem(last=False)
        return allowed, 0.0 if allowed else (1.0 - tokens) / rate


def classify(method: str, path: str) -> Optional[str]:
    """Which rate limit a request counts against, or None when it is not limited."""
    path = path.rstrip("/") or "/"
    if method == "OPTIONS" or not path.startswith("/api/") or path == "/api/health":
        return None  # preflights, the front end and the platform's health check are never limited
    if path == "/api/sim/run":
        return "run"
    if path == "/api/sim/validate":
        return "validate"
    return "api"


class RateLimitMiddleware:
    """Answers 429 (with Retry-After) when a client uses up its allowance for a class of request."""

    def __init__(
        self,
        app: ASGIApp,
        limits: Mapping[str, int],
        trust_proxy: bool,
        hops: int,
        limiter: Optional[TokenBucketLimiter] = None,
        client_ip_header: Optional[str] = None,
    ) -> None:
        self.app = app
        self.limits = dict(limits)
        self.trust_proxy = trust_proxy
        self.hops = hops
        self.client_ip_header = client_ip_header
        self.limiter = limiter or TokenBucketLimiter()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        bucket_class = classify(scope["method"], scope["path"]) if scope["type"] == "http" else None
        if bucket_class is None:
            await self.app(scope, receive, send)
            return
        client = client_address(scope, self.trust_proxy, self.hops, self.client_ip_header)
        allowed, retry_after = self.limiter.allow(bucket_class, client, self.limits[bucket_class])
        if allowed:
            await self.app(scope, receive, send)
            return
        seconds = max(1, math.ceil(retry_after))
        response = JSONResponse(
            {"detail": f"Too many requests: this server limits how often a client can do this. Try again in {seconds} s."},
            status_code=429,
            headers={"Retry-After": str(seconds)},
        )
        await response(scope, receive, send)


class _TooLarge(Exception):
    pass


class RequestSizeLimitMiddleware:
    """Answers 413 for a request body larger than ``max_bytes``, by its declared length or, failing that, as it streams in."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    def _too_large(self) -> JSONResponse:
        return JSONResponse({"detail": f"The request body is larger than the {self.max_bytes} byte limit."}, status_code=413)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None:
            try:
                size = int(declared)
            except ValueError:
                await JSONResponse({"detail": "Invalid Content-Length header."}, status_code=400)(scope, receive, send)
                return
            if size > self.max_bytes:
                await self._too_large()(scope, receive, send)
                return

        received = 0
        exceeded = False
        started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    exceeded = True
                    raise _TooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if exceeded:
                # FastAPI turns any error while reading the body into its own 400. Whatever the application answers
                # once the limit was crossed is replaced by the 413 (and only the first message starts it).
                if message["type"] == "http.response.start" and not started:
                    started = True
                    await self._too_large()(scope, receive, send)
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _TooLarge:
            if not started:
                await self._too_large()(scope, receive, send)


class SecurityHeadersMiddleware:
    """Adds conservative headers to every response; API answers must never be cached by a browser or proxy."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_api = scope["path"].startswith("/api/")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("Referrer-Policy", "no-referrer")
                headers.setdefault("X-Frame-Options", "DENY")
                if is_api:
                    headers.setdefault("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, receive, send_with_headers)
