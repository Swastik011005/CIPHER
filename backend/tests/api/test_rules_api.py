"""The Rules API against the real app: read, edit, validate, reset, and the effect on later runs and on /sim/validate."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from netsec.api.app_factory import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(frontend_dist=None))  # a fresh app, so a fresh rule store, for every test


def put_detectors(client, **changes):
    return client.put("/api/rules/detectors", json={"changes": changes})


def alerts(body, rule=None):
    return [e for e in body["events"] if e["type"] == "alert.raised" and (rule is None or e["rule"] == rule)]


# -- reading ----------------------------------------------------------------------------------------------


def test_the_rules_view_describes_every_detector_policy_and_the_ips_table(client) -> None:
    view = client.get("/api/rules").json()
    assert view["customised"] is False and view["revision"] == 0 and view["rules_hash"] == view["defaults_hash"]
    assert list(view["detectors"]) == ["D1", "D2", "D3", "D4", "D5", "D6"]
    d1 = view["detectors"]["D1"]
    assert d1["name"] == "Port scan" and d1["settings"]["suspicious"] == 6 and d1["defaults"]["violation"] == 12
    assert d1["limits"]["suspicious"] == {"min": 2, "max": 50} and "enabled" in d1["editable"] and d1["changed"] == []
    assert {p["name"] for p in view["policies"]} == {"OUTSIDE-IN", "INSIDE-OUT", "STAFF-IN"}
    staff = next(p for p in view["policies"] if p["name"] == "STAFF-IN")
    assert [r["id"] for r in staff["rules"]] == ["10", "20", "100"] and staff["implicit_deny"]["action"] == "deny"
    assert view["restricted_ips"]["addresses"] == ["203.0.113.99"] and view["restricted_ips"]["max"] == 20
    assert {(r["detector"], r["severity"]): r["action"] for r in view["ips_policy"]["rules"]}[("D3", "medium")] == "rate_limit"
    assert "10.0.99.0/24" in view["ips_policy"]["allowlist"]


# -- editing ----------------------------------------------------------------------------------------------


def test_editing_a_detector_is_stored_on_the_server_and_reported(client) -> None:
    response = put_detectors(client, D1={"enabled": False, "suspicious": 8})
    assert response.status_code == 200
    body = response.json()
    assert {(c["detector"], c["field"], c["to"]) for c in body["changed"]} == {("D1", "enabled", False), ("D1", "suspicious", 8)}
    assert body["customised"] and body["revision"] == 1 and body["rules_hash"] != body["defaults_hash"]
    assert body["detectors"]["D1"]["changed"] == ["enabled", "suspicious"]
    again = client.get("/api/rules").json()  # a separate request sees the same state: it lives on the server
    assert again["detectors"]["D1"]["settings"]["enabled"] is False and again["rules_hash"] == body["rules_hash"]


def test_invalid_edits_answer_422_with_every_problem_and_change_nothing(client) -> None:
    response = put_detectors(client, D1={"suspicious": 1, "violation": 500}, D9={"enabled": True})
    assert response.status_code == 422
    problems = response.json()["detail"]
    assert len(problems) == 3 and any("D1.suspicious" in p for p in problems) and any("no such detector" in p for p in problems)
    assert client.get("/api/rules").json()["customised"] is False


@pytest.mark.parametrize(
    "payload",
    [{}, {"changes": {}}, {"changes": {"D1": {"enabled": "maybe"}}}, {"changes": {"D1": {"suspicious": 30}}}, {"changes": {"D1": {"nope": 1}}}, {"extra": 1, "changes": {"D1": {"enabled": False}}}, {"changes": []}],
)
def test_malformed_or_unsafe_requests_are_422(client, payload) -> None:
    assert client.put("/api/rules/detectors", json=payload).status_code == 422
    assert client.get("/api/rules").json()["customised"] is False


def test_restricted_addresses_are_managed_through_the_api(client) -> None:
    ok = client.put("/api/rules/restricted-ips", json={"addresses": ["203.0.113.66", "198.51.100.7"]})
    assert ok.status_code == 200 and ok.json()["restricted_ips"]["addresses"] == ["198.51.100.7", "203.0.113.66"]
    bad = client.put("/api/rules/restricted-ips", json={"addresses": ["10.0.10.11", "nope"]})
    assert bad.status_code == 422 and len(bad.json()["detail"]) == 2
    assert client.get("/api/rules").json()["restricted_ips"]["addresses"] == ["198.51.100.7", "203.0.113.66"]  # the bad edit changed nothing
    assert client.put("/api/rules/restricted-ips", json={"addresses": "x"}).status_code == 422
    assert client.put("/api/rules/restricted-ips", json={}).status_code == 422


def test_reset_restores_the_shipped_rules(client) -> None:
    put_detectors(client, D3={"enabled": False})
    client.put("/api/rules/restricted-ips", json={"addresses": []})
    reset = client.post("/api/rules/reset").json()
    assert reset["customised"] is False and reset["rules_hash"] == reset["defaults_hash"] and reset["changed"] == [{"reset": True}]
    assert reset["restricted_ips"]["addresses"] == ["203.0.113.99"] and reset["detectors"]["D3"]["settings"]["enabled"] is True
    assert client.post("/api/rules/reset").json()["changed"] == []


# -- the effect on runs ---------------------------------------------------------------------------------------


def test_a_disabled_detector_stops_its_alerts_in_the_next_run_and_reset_brings_them_back(client) -> None:
    before = client.post("/api/sim/run", json={"scenario_id": "S2", "ips_mode": "enforce"}).json()
    assert len(alerts(before, "D1")) == 4 and before["rules_customised"] is False
    put_detectors(client, D1={"enabled": False})
    after = client.post("/api/sim/run", json={"scenario_id": "S2", "ips_mode": "enforce"}).json()
    assert alerts(after, "D1") == [] and after["summary"]["alerts"] == 0 and after["summary"]["blocked"] == 0
    assert after["rules_customised"] is True and after["config_hash"] != before["config_hash"] and after["rules_hash"] != before["rules_hash"]
    assert after["events"][0]["config_hash"] == after["config_hash"]  # run.meta names the rules it ran with
    client.post("/api/rules/reset")
    back = client.post("/api/sim/run", json={"scenario_id": "S2", "ips_mode": "enforce"}).json()
    assert back["trace_hash"] == before["trace_hash"] and back["config_hash"] == before["config_hash"]


def test_a_restricted_address_makes_fw1_deny_it_in_the_next_run(client) -> None:
    flow = {"type": "tcp_session", "id": "X1", "src": "EXT-USR", "dst": "APP-SRV", "dport": 443, "start": 2.0, "request_bytes": 100}
    run = lambda: client.post("/api/sim/run", json={"scenario_id": "S1", "custom_flows": [flow]}).json()  # noqa: E731
    assert not [e for e in run()["events"] if e["type"] == "policy.decision" and e["action"] == "deny"]
    client.put("/api/rules/restricted-ips", json={"addresses": ["203.0.113.25"]})
    denied = [e for e in run()["events"] if e["type"] == "policy.decision" and e["action"] == "deny"]
    assert [(d["node"], d["rule_id"]) for d in denied] == [("FW1", "OUTSIDE-IN:10")]


def test_runs_with_the_same_edited_rules_are_identical(client) -> None:
    put_detectors(client, D1={"suspicious": 5, "violation": 9})
    a = client.post("/api/sim/run", json={"scenario_id": "S2", "seed": 3}).json()
    b = client.post("/api/sim/run", json={"scenario_id": "S2", "seed": 3}).json()
    assert a["trace_hash"] == b["trace_hash"] and [x["evidence"]["count"] for x in alerts(a, "D1") if x["sensor"] == "IDS-1"] == [5, 9]


def test_pinned_scenarios_and_prefix_stability_survive_edited_rules(client) -> None:
    put_detectors(client, D1={"suspicious": 5, "violation": 9})
    assert client.post("/api/sim/run", json={"scenario_id": "S6", "ips_mode": "monitor"}).json()["ips_mode"] == "enforce"
    assert client.post("/api/sim/run", json={"scenario_id": "S5", "controls": [{"type": "ips_mode", "t": 2, "mode": "enforce"}]}).status_code == 422
    base = client.post("/api/sim/run", json={"scenario_id": "S2"}).json()
    live = client.post("/api/sim/run", json={"scenario_id": "S2", "controls": [{"type": "ips_mode", "t": 6.0, "mode": "enforce"}]}).json()
    assert [e for e in live["events"] if e["t"] < 6.0] == [e for e in base["events"] if e["t"] < 6.0]


# -- scenario library and validation -----------------------------------------------------------------------------


def test_the_scenario_library_lists_expected_behaviour_per_mode(client) -> None:
    library = {s["id"]: s for s in client.get("/api/scenarios").json()}
    assert list(library) == ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]
    assert set(library["S2"]["expected"]) == {"monitor", "enforce"} and set(library["S5"]["expected"]) == {"monitor"} and set(library["S6"]["expected"]) == {"enforce"}
    assert any("6th distinct port" in line for line in library["S2"]["expected"]["monitor"])
    assert any("IDS-1 never drops" in line for line in library["S4"]["expected"]["enforce"])
    assert all(len(lines) >= 5 for s in library.values() for lines in s["expected"].values())


def test_the_shipped_rules_pass_every_check_of_every_scenario_in_every_mode(client) -> None:
    result = client.post("/api/sim/validate", json={}).json()
    assert result["summary"]["runs"] == 12 and result["summary"]["runs_passed"] == 12  # 5 scenarios x 2 modes + S5 + S6
    assert result["summary"]["checks"] == result["summary"]["checks_passed"] and result["summary"]["checks"] > 80
    assert [(r["scenario_id"], r["ips_mode"]) for r in result["results"]] == [
        ("S1", "monitor"), ("S1", "enforce"), ("S2", "monitor"), ("S2", "enforce"), ("S3", "monitor"), ("S3", "enforce"),
        ("S4", "monitor"), ("S4", "enforce"), ("S5", "monitor"), ("S6", "enforce"), ("S7", "monitor"), ("S7", "enforce"),
    ]
    assert result["rules_customised"] is False and all(len(r["trace_hash"]) == 64 for r in result["results"])


def test_validating_one_scenario(client) -> None:
    result = client.post("/api/sim/validate", json={"scenario_ids": ["S3"]}).json()
    assert [(r["scenario_id"], r["ips_mode"]) for r in result["results"]] == [("S3", "monitor"), ("S3", "enforce")]
    assert client.post("/api/sim/validate", json={"scenario_ids": ["S99"]}).status_code == 404
    assert client.post("/api/sim/validate", json={"scenario_ids": ["S3"], "x": 1}).status_code == 422


def test_after_disabling_d1_the_checks_show_what_the_edit_broke(client) -> None:
    put_detectors(client, D1={"enabled": False})
    result = client.post("/api/sim/validate", json={"scenario_ids": ["S2", "S1"]}).json()
    assert result["rules_customised"] is True and result["summary"]["runs_passed"] == 2  # S1 never used D1; S2 modes fail
    s2 = {r["ips_mode"]: r for r in result["results"] if r["scenario_id"] == "S2"}
    assert s2["monitor"]["passed"] is False and s2["enforce"]["passed"] is False
    failing = {c["id"]: c for r in s2.values() for c in r["checks"] if not c["passed"]}
    assert failing["d1-ids"]["expected"] == "6, 12" and failing["d1-ids"]["actual"] == "none"
    assert failing["block"]["actual"] == "none"
    assert all(c["passed"] for r in s2.values() for c in r["checks"] if c["id"] in ("ids-passive", "one-outcome"))  # the guarantees hold regardless
