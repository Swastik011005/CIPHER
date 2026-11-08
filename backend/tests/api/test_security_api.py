"""The security state, CLI, Zero Trust, SIEM and presentation API."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from netsec.api.app_factory import create_app
from netsec.config import load_settings


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(frontend_dist=None))  # a fresh server state for every test


def post(client, path, body):
    return client.post(f"/api{path}", json=body)


def test_presentation_lists_the_nine_scenarios(client) -> None:
    body = client.get("/api/presentation").json()
    assert [s["id"] for s in body] == [f"P{i}" for i in range(1, 10)]
    p7 = body[6]
    assert p7["source"] == "PC-2" and p7["objective"] and p7["expected"] and p7["operator_actions"][0]["action"] == "isolate"
    assert body[0]["number"] == 1 and body[8]["number"] == 9


def test_the_baseline_scenario_list_and_health_are_unchanged(client) -> None:
    ids = [s["id"] for s in client.get("/api/scenarios").json()]
    assert ids == ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]
    assert client.get("/api/health").json()["scenarios_available"] == ids


def test_isolate_then_restore_through_the_state_api_changes_runs_and_the_cli(client) -> None:
    assert post(client, "/state/action", {"action": "isolate", "node": "PC-2"}).json()["isolated"] == ["PC-2"]
    ping = post(client, "/cli/exec", {"node": "PC-2", "command": "ping APP-SRV", "animate": False}).json()
    assert not ping["ok"] and ping["decision"]["drop_reason"] == "edr_isolated"
    run = post(client, "/sim/run", {"scenario_id": "P1"}).json()
    assert run["summary"]["blocked"] == 0  # PC-1's scenario does not involve PC-2
    assert client.get("/api/endpoints/PC-2").json()["health"] == "isolated"
    post(client, "/state/action", {"action": "restore", "node": "PC-2"})
    assert post(client, "/cli/exec", {"node": "PC-2", "command": "ping APP-SRV", "animate": False}).json()["ok"]
    assert client.get("/api/endpoints/PC-2").json()["isolated"] is False


def test_an_operator_isolation_run_can_commit_its_end_state(client) -> None:
    control = {"type": "endpoint", "t": 9.0, "node": "PC-2", "action": "isolate"}
    run = post(client, "/sim/run", {"scenario_id": "P7", "controls": [control], "commit_state": True}).json()
    assert run["final_isolated"] == ["PC-2"]
    assert client.get("/api/state").json()["isolated"] == ["PC-2"]
    uncommitted = TestClient(create_app(frontend_dist=None))
    post(uncommitted, "/sim/run", {"scenario_id": "P7", "controls": [control]})
    assert uncommitted.get("/api/state").json()["isolated"] == []


def test_state_actions_are_validated(client) -> None:
    assert post(client, "/state/action", {"action": "isolate", "node": "R1-EDGE"}).status_code == 422
    assert post(client, "/state/action", {"action": "trust", "node": "PC-1", "level": "godmode"}).status_code == 422
    assert post(client, "/state/action", {"action": "role", "user": "nobody", "role": "admin"}).status_code == 422
    assert post(client, "/state/action", {"action": "revoke", "role": "admin"}).status_code == 422
    assert post(client, "/state/action", {"action": "explode"}).status_code == 422
    assert post(client, "/state/action", {"action": "isolate", "node": "PC-2", "extra": 1}).status_code == 422


def test_zero_trust_trust_role_and_revocation_are_explained(client) -> None:
    ask = {"device": "ADMIN-PC", "resource": "SIEM-1", "proto": "tcp", "port": 443}
    assert post(client, "/zerotrust/explain", ask).json()["decision"] == "allow"
    post(client, "/state/action", {"action": "trust", "node": "ADMIN-PC", "level": "untrusted"})
    denied = post(client, "/zerotrust/explain", ask).json()
    assert denied["decision"] == "deny" and "not a trusted device" in denied["reason"] and denied["factors"]
    post(client, "/state/action", {"action": "trust", "node": "ADMIN-PC", "level": "trusted"})
    post(client, "/state/action", {"action": "revoke", "role": "admin", "resource": "SIEM-1"})
    assert "revoked" in post(client, "/zerotrust/explain", ask).json()["reason"]
    post(client, "/state/action", {"action": "grant", "role": "admin", "resource": "SIEM-1"})
    assert post(client, "/zerotrust/explain", ask).json()["decision"] == "allow"
    assert post(client, "/zerotrust/explain", {**ask, "resource": "DB-SRV"}).status_code == 422
    zt = client.get("/api/zerotrust").json()
    assert zt["pdp"] == "ZT-POLICY-1" and any(u["device"] == "ADMIN-PC" for u in zt["users"])


def test_the_siem_history_keeps_events_and_groups_incidents(client) -> None:
    post(client, "/sim/run", {"scenario_id": "P9", "ips_mode": "enforce"})
    post(client, "/sim/run", {"scenario_id": "P7", "scripted_operator": True})
    body = client.get("/api/siem/events").json()
    assert body["simulated"] is True and body["collector"] == "SIEM-1" and body["events"]
    p7 = [i for i in body["incidents"] if i["node"] == "PC-2"]
    assert p7 and {"EDR", "IDS-1", "IPS-1"} <= set(p7[0]["sources"]) and p7[0]["severity"] == "high"
    assert all(e["incident_id"] for e in body["events"])


def test_rule_hit_counters_accumulate_across_runs_and_cli_commands(client) -> None:
    post(client, "/sim/run", {"scenario_id": "P2"})
    post(client, "/cli/exec", {"node": "PC-1", "command": "ping SIEM-1", "animate": False})
    hits = client.get("/api/state").json()["rule_hits"]
    assert hits["CORE-SW1:STAFF-IN:20:deny"] == 8


def test_cli_returns_the_replayable_run_and_refuses_unknown_commands_without_running_anything(client) -> None:
    r = post(client, "/cli/exec", {"node": "PC-1", "command": "ping 10.0.30.10"}).json()
    assert r["ok"] and r["run"]["events"] and r["run"]["scenario_id"] == "CLI" and r["decision"]["delivered"]
    bad = post(client, "/cli/exec", {"node": "PC-1", "command": "ping 10.0.30.10; dir"}).json()
    assert not bad["ok"] and bad["run"] is None
    assert post(client, "/cli/exec", {"node": "PC-1", "command": "x" * 500}).status_code == 422
    assert client.get("/api/endpoints/CORE-SW1").status_code == 404
    assert not post(client, "/cli/exec", {"node": "CORE-SW1", "command": "ping APP-SRV"}).json()["ok"]


def test_production_makes_the_security_state_read_only(monkeypatch) -> None:
    monkeypatch.setenv("NETSEC_ENV", "production")
    monkeypatch.setenv("NETSEC_CORS_ORIGINS", "https://example.test")
    c = TestClient(create_app(settings=load_settings(), frontend_dist=None))
    assert c.get("/api/state").json()["read_only"] is True
    assert post(c, "/state/action", {"action": "isolate", "node": "PC-2"}).status_code == 403
    assert post(c, "/cli/exec", {"node": "PC-1", "command": "ping APP-SRV", "animate": False}).json()["ok"]  # reading is fine
    assert c.get("/api/state").json()["runs"] == 0  # and a shared state is never written
