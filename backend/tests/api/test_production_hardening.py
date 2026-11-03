"""The API as a public deployment runs it: docs off, read-only rules, size and rate limits, CORS, gzip, headers.

Every app here is built from environment-style settings through ``load_settings``, so the tests cover the same path
``python app.py`` takes. The front end is never mounted (a non-existent dist folder), so unknown paths answer 404.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from netsec.api.app_factory import create_app
from netsec.config import Settings, load_settings
from netsec.network.topology import load_topology
from netsec.security.ruleset import RuleSet
from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import load_scenario

ORIGIN = "https://netsec-3d.onrender.com"
BASE = {"NETSEC_ENV": "production", "NETSEC_CORS_ORIGINS": ORIGIN}
RUN = {"scenario_id": "S1"}


def make_client(tmp_path: Path, **env: str) -> TestClient:
    settings = load_settings(env={**BASE, **env}, dotenv_path=tmp_path / "no.env")
    return TestClient(create_app(settings=settings, frontend_dist=tmp_path / "no-dist"))


def development_client(tmp_path: Path, **env: str) -> TestClient:
    settings = load_settings(env=env, dotenv_path=tmp_path / "no.env")
    return TestClient(create_app(settings=settings, frontend_dist=tmp_path / "no-dist"))


# -- API documentation ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_documentation_is_off_in_production_and_on_in_development(tmp_path, path: str) -> None:
    assert make_client(tmp_path).get(path).status_code == 404
    assert development_client(tmp_path).get(path).status_code == 200


def test_documentation_can_be_switched_on_explicitly_in_production(tmp_path) -> None:
    assert make_client(tmp_path, NETSEC_ENABLE_DOCS="true").get("/docs").status_code == 200


# -- read-only rules ----------------------------------------------------------------------------------------------


def test_production_rules_are_read_only_and_say_so(tmp_path) -> None:
    client = make_client(tmp_path)
    view = client.get("/api/rules").json()
    assert view["read_only"] is True and "read-only" in view["read_only_reason"]
    assert view["customised"] is False and view["revision"] == 0


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PUT", "/api/rules/detectors", {"changes": {"D1": {"enabled": False}}}),
        ("PUT", "/api/rules/restricted-ips", {"addresses": ["198.51.100.7"]}),
        ("POST", "/api/rules/reset", None),
    ],
)
def test_every_rule_edit_is_refused_with_403_and_changes_nothing(tmp_path, method: str, path: str, body) -> None:
    client = make_client(tmp_path)
    response = client.request(method, path, json=body)
    assert response.status_code == 403 and "read-only" in response.json()["detail"]
    after = client.get("/api/rules").json()
    assert after["revision"] == 0 and after["customised"] is False and after["restricted_ips"]["addresses"] == ["203.0.113.99"]


def test_a_read_only_server_refuses_before_it_validates_the_body(tmp_path) -> None:
    client = make_client(tmp_path)
    assert client.put("/api/rules/detectors", json={}).status_code == 403  # not 422: nothing about the edit is examined


def test_rules_can_still_be_read_and_exported_when_read_only(tmp_path) -> None:
    client = make_client(tmp_path)
    assert client.get("/api/rules/export/cisco").status_code == 200
    assert client.post("/api/sim/validate", json={"scenario_ids": ["S1"]}).status_code == 200


def test_editing_still_works_in_development_exactly_as_before(tmp_path) -> None:
    client = development_client(tmp_path)
    assert client.get("/api/rules").json()["read_only"] is False
    response = client.put("/api/rules/detectors", json={"changes": {"D1": {"enabled": False}}})
    assert response.status_code == 200 and response.json()["customised"] is True and response.json()["read_only"] is False
    assert client.post("/api/rules/reset").status_code == 200


def test_read_only_can_be_switched_off_explicitly_in_production(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RULES_READ_ONLY="false")
    assert client.put("/api/rules/restricted-ips", json={"addresses": ["198.51.100.7"]}).status_code == 200


# -- request size ---------------------------------------------------------------------------------------------------


def test_a_body_over_the_limit_is_refused_by_its_declared_length(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_MAX_BODY_BYTES="1024")
    response = client.post("/api/sim/run", content=b"x" * 2000, headers={"Content-Type": "application/json"})
    assert response.status_code == 413 and "1024" in response.json()["detail"]


def test_a_streamed_body_with_no_declared_length_is_cut_off_too(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_MAX_BODY_BYTES="1024")

    def chunks():
        for _ in range(4):
            yield b" " * 600

    response = client.post("/api/sim/run", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_a_normal_request_is_unaffected_and_gets_are_not_checked(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_MAX_BODY_BYTES="1024")
    assert client.post("/api/sim/run", json=RUN).status_code == 200
    assert client.get("/api/topology").status_code == 200


def test_the_default_limit_leaves_room_for_the_largest_legitimate_request(tmp_path) -> None:
    client = make_client(tmp_path)
    controls = [{"type": "ips_mode", "t": float(i), "mode": "enforce" if i % 2 else "monitor"} for i in range(20)]  # the API accepts at most 20
    response = client.post("/api/sim/run", json={"scenario_id": "S2", "ips_mode": "enforce", "controls": controls})
    assert response.status_code == 200
    assert len(response.request.content) < Settings().max_body_bytes / 10  # the default limit is ample


# -- rate limiting --------------------------------------------------------------------------------------------------


def test_running_scenarios_is_limited_per_client_with_retry_after(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RATE_LIMIT_RUN_PER_MIN="3")
    assert [client.post("/api/sim/run", json=RUN).status_code for _ in range(3)] == [200, 200, 200]
    refused = client.post("/api/sim/run", json=RUN)
    assert refused.status_code == 429 and 1 <= int(refused.headers["retry-after"]) <= 20
    assert "Too many requests" in refused.json()["detail"]


def test_validation_has_its_own_stricter_allowance(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RATE_LIMIT_VALIDATE_PER_MIN="1")
    body = {"scenario_ids": ["S1"]}
    assert client.post("/api/sim/validate", json=body).status_code == 200
    assert client.post("/api/sim/validate", json=body).status_code == 429
    assert client.post("/api/sim/run", json=RUN).status_code == 200  # runs are counted separately


def test_other_api_calls_share_a_generous_allowance_and_health_is_never_limited(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RATE_LIMIT_API_PER_MIN="2")
    assert [client.get("/api/health").status_code for _ in range(10)] == [200] * 10
    assert [client.get("/api/topology").status_code for _ in range(3)] == [200, 200, 429]


def test_rate_limiting_is_off_in_development_and_can_be_off_in_production(tmp_path) -> None:
    for client in (development_client(tmp_path, NETSEC_RATE_LIMIT_RUN_PER_MIN="1"), make_client(tmp_path, NETSEC_RATE_LIMIT="false", NETSEC_RATE_LIMIT_RUN_PER_MIN="1")):
        assert [client.post("/api/sim/run", json=RUN).status_code for _ in range(3)] == [200, 200, 200]


def test_forwarded_headers_are_ignored_unless_the_proxy_is_trusted(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RATE_LIMIT_RUN_PER_MIN="2")
    statuses = [client.post("/api/sim/run", json=RUN, headers={"X-Forwarded-For": f"198.51.100.{i}"}).status_code for i in range(1, 4)]
    assert statuses == [200, 200, 429]  # a caller cannot pick a fresh bucket by inventing an address


def test_behind_a_trusted_proxy_clients_are_told_apart_by_the_address_the_proxy_recorded(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RATE_LIMIT_RUN_PER_MIN="1", NETSEC_TRUST_PROXY="true")
    post = lambda xff: client.post("/api/sim/run", json=RUN, headers={"X-Forwarded-For": xff}).status_code  # noqa: E731
    assert post("203.0.113.1") == 200
    assert post("203.0.113.1") == 429
    assert post("203.0.113.2") == 200  # a different client
    # Same real client (the last entry, written by the proxy), different values invented on the left: still the same bucket.
    assert post("9.9.9.9, 203.0.113.1") == 429
    assert post("8.8.8.8, 203.0.113.1") == 429


def test_an_untrusted_or_missing_header_behind_a_trusting_server_shares_the_peers_bucket(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RATE_LIMIT_RUN_PER_MIN="1", NETSEC_TRUST_PROXY="true")
    assert client.post("/api/sim/run", json=RUN).status_code == 200
    assert client.post("/api/sim/run", json=RUN, headers={"X-Forwarded-For": "not-an-address"}).status_code == 429


# -- CORS -----------------------------------------------------------------------------------------------------------


def test_only_the_configured_origin_may_call_the_api_from_a_browser(tmp_path) -> None:
    client = make_client(tmp_path)
    allowed = client.get("/api/health", headers={"Origin": ORIGIN})
    assert allowed.headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-credentials" not in allowed.headers
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"Origin": "https://evil.example.com"}).headers
    assert client.get("/api/health", headers={"Origin": ORIGIN}).headers["access-control-allow-origin"] != "*"


def test_preflight_for_a_json_post_is_accepted_for_the_allowed_origin_only(tmp_path) -> None:
    client = make_client(tmp_path)
    ask = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
    good = client.options("/api/sim/run", headers={"Origin": ORIGIN, **ask})
    assert good.status_code == 200 and good.headers["access-control-allow-origin"] == ORIGIN
    assert "POST" in good.headers["access-control-allow-methods"] and "DELETE" not in good.headers["access-control-allow-methods"]
    bad = client.options("/api/sim/run", headers={"Origin": "https://evil.example.com", **ask})
    assert bad.status_code == 400 and "access-control-allow-origin" not in bad.headers


def test_a_production_server_with_no_origins_sends_no_cors_headers_at_all(tmp_path) -> None:
    settings = load_settings(env={"NETSEC_ENV": "production"}, dotenv_path=tmp_path / "no.env")
    client = TestClient(create_app(settings=settings, frontend_dist=tmp_path / "no-dist"))
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"Origin": ORIGIN}).headers


def test_development_still_allows_the_vite_dev_server(tmp_path) -> None:
    client = development_client(tmp_path)
    for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
        assert client.get("/api/health", headers={"Origin": origin}).headers["access-control-allow-origin"] == origin
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"Origin": "http://localhost:3000"}).headers


def test_refusals_still_carry_cors_headers_so_the_page_can_read_them(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RATE_LIMIT_RUN_PER_MIN="1", NETSEC_MAX_BODY_BYTES="1024")
    headers = {"Origin": ORIGIN}
    assert client.post("/api/sim/run", json=RUN, headers=headers).status_code == 200
    limited = client.post("/api/sim/run", json=RUN, headers=headers)
    assert limited.status_code == 429 and limited.headers["access-control-allow-origin"] == ORIGIN
    assert "retry-after" in limited.headers["access-control-expose-headers"].lower()
    too_big = client.post("/api/rules/reset", content=b"x" * 2000, headers={**headers, "Content-Type": "application/json"})
    assert too_big.status_code == 413 and too_big.headers["access-control-allow-origin"] == ORIGIN


# -- compression and headers ----------------------------------------------------------------------------------------


def test_large_responses_are_compressed_when_the_client_accepts_it(tmp_path) -> None:
    client = make_client(tmp_path)
    body = {"scenario_id": "S4", "ips_mode": "enforce"}
    packed = client.post("/api/sim/run", json=body, headers={"Accept-Encoding": "gzip"})
    plain = client.post("/api/sim/run", json=body, headers={"Accept-Encoding": "identity"})
    assert packed.headers["content-encoding"] == "gzip" and "content-encoding" not in plain.headers
    assert int(packed.headers["content-length"]) < int(plain.headers["content-length"]) / 4
    assert packed.json()["trace_hash"] == plain.json()["trace_hash"]  # compression changes the bytes, not the trace


def test_small_responses_are_not_compressed(tmp_path) -> None:
    assert "content-encoding" not in make_client(tmp_path).get("/api/health", headers={"Accept-Encoding": "gzip"}).headers


def test_every_response_carries_conservative_security_headers(tmp_path) -> None:
    response = make_client(tmp_path).get("/api/topology")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer" and response.headers["x-frame-options"] == "DENY"
    assert response.headers["cache-control"] == "no-store"


# -- nothing about the simulation changes ---------------------------------------------------------------------------


@pytest.mark.parametrize(("scenario", "mode"), [("S1", "monitor"), ("S2", "enforce"), ("S3", "enforce"), ("S4", "enforce"), ("S7", "monitor")])
def test_a_production_server_returns_exactly_the_trace_the_engine_produces(tmp_path, scenario: str, mode: str) -> None:
    served = make_client(tmp_path).post("/api/sim/run", json={"scenario_id": scenario, "ips_mode": mode}).json()
    direct = run_scenario(load_topology(), load_scenario(scenario), None, mode, [], [], RuleSet.shipped())
    assert served["trace_hash"] == direct.trace_hash and len(served["events"]) == len(direct.events)


def test_with_a_named_client_header_the_bucket_follows_that_header_only(tmp_path) -> None:
    client = make_client(tmp_path, NETSEC_RATE_LIMIT_RUN_PER_MIN="1", NETSEC_TRUST_PROXY="true", NETSEC_CLIENT_IP_HEADER="cf-connecting-ip")
    post = lambda **headers: client.post("/api/sim/run", json=RUN, headers=headers).status_code  # noqa: E731
    assert post(**{"CF-Connecting-IP": "203.0.113.1"}) == 200
    assert post(**{"CF-Connecting-IP": "203.0.113.1", "X-Forwarded-For": "7.7.7.7"}) == 429  # forwarded-for is not consulted
    assert post(**{"CF-Connecting-IP": "203.0.113.2"}) == 200


def test_an_api_only_server_never_serves_a_front_end_even_when_a_build_is_present(tmp_path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")

    def client_for(**env: str) -> TestClient:
        settings = load_settings(env={**BASE, **env}, dotenv_path=tmp_path / "no.env")
        return TestClient(create_app(settings=settings, frontend_dist=dist))

    serving = client_for()
    assert serving.get("/simulation").text == "<html>app</html>"  # demo mode: the app answers client-side routes
    api_only = client_for(NETSEC_SERVE_FRONTEND="false")
    assert api_only.get("/simulation").status_code == 404 and api_only.get("/docs").status_code == 404
    assert api_only.get("/api/health").status_code == 200
