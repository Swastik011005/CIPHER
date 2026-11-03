"""HTTP API: health, topology, scenarios and runs."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from netsec.api.app_factory import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app(frontend_dist=None))


def test_health_returns_200_and_says_it_is_a_local_simulation(client) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok" and body["service"] == "netsec-ids-engine"
    assert body["mode"] == "simulation" and body["real_traffic"] is False
    assert body["topology"] == {"loaded": True, "valid": True, "nodes": 17, "links": 18}
    assert body["scenarios_available"] == ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]
    assert body["stage"] == 6 and body["uptime_s"] >= 0


def test_topology_returns_the_authoritative_topology(client, raw_topology) -> None:
    response = client.get("/api/topology")
    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == {
        "nodes": 17, "devices": 16, "segments": 1, "links": 18, "vlans": 4, "subnets": 7, "zones": 7,
    }
    assert body["validation"]["passed"] is True and body["validation"]["failed_count"] == 0
    assert [n["id"] for n in body["nodes"]] == [n["id"] for n in raw_topology["nodes"]]
    assert [lk["id"] for lk in body["links"]] == [lk["id"] for lk in raw_topology["links"]]
    assert body["span"] == raw_topology["span"]


def test_topology_exposes_what_the_scene_needs(client) -> None:
    body = client.get("/api/topology").json()
    ids = {n["id"] for n in body["nodes"]}
    assert {"INET", "IDS-1", "IPS-1", "FW1", "CORE-SW1"} <= ids
    assert {n["zone"] for n in body["nodes"]} == {z["id"] for z in body["zones"]}
    assert all("form_factor" in n and "role" in n for n in body["nodes"])


def test_scenarios_lists_only_what_exists_in_this_build(client) -> None:
    response = client.get("/api/scenarios")
    assert response.status_code == 200
    assert [s["id"] for s in response.json()] == ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]


def test_run_s1_returns_a_valid_deterministic_trace(client) -> None:
    first = client.post("/api/sim/run", json={"scenario_id": "S1"})
    second = client.post("/api/sim/run", json={"scenario_id": "S1"})
    assert first.status_code == 200
    body = first.json()
    assert body["events"][0]["type"] == "run.meta" and body["events"][-1]["type"] == "run.end"
    assert body["summary"]["data_packets"] == 30 and body["summary"]["blocked"] == 0
    assert body["trace_hash"] == second.json()["trace_hash"]
    assert body["events"] == second.json()["events"]


def test_run_accepts_an_explicit_seed(client) -> None:
    a = client.post("/api/sim/run", json={"scenario_id": "S1", "seed": 5}).json()
    b = client.post("/api/sim/run", json={"scenario_id": "S1", "seed": 6}).json()
    assert a["seed"] == 5 and b["seed"] == 6 and a["trace_hash"] != b["trace_hash"]


@pytest.mark.parametrize("scenario_id", ["S8", "S99", "../etc/passwd", "s1", "S1.json"])
def test_unknown_or_unsafe_scenario_ids_return_404(client, scenario_id) -> None:
    response = client.post("/api/sim/run", json={"scenario_id": scenario_id})
    assert response.status_code == 404
    assert "unknown scenario" in response.json()["detail"]


def test_both_ips_modes_are_accepted_and_recorded(client) -> None:
    for mode in ("monitor", "enforce"):
        response = client.post("/api/sim/run", json={"scenario_id": "S2", "ips_mode": mode})
        assert response.status_code == 200
        body = response.json()
        assert body["ips_mode"] == mode and body["events"][0]["ips_mode"] == mode


@pytest.mark.parametrize(
    "payload",
    [{}, {"scenario_id": ""}, {"scenario_id": "S1", "seed": -1}, {"scenario_id": "S1", "ips_mode": "block-everything"}, {"scenario_id": "S1", "extra": 1}],
)
def test_invalid_run_requests_return_422(client, payload) -> None:
    assert client.post("/api/sim/run", json=payload).status_code == 422


def test_unknown_api_path_is_404_json(client) -> None:
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404


def test_wrong_method_is_405(client) -> None:
    assert client.post("/api/health").status_code == 405


def test_app_refuses_to_start_on_an_invalid_topology(tmp_path, raw_topology) -> None:
    import json
    from netsec.network.topology import TopologyError

    broken = dict(raw_topology, links=raw_topology["links"][:-1])
    path = tmp_path / "topology.json"
    path.write_text(json.dumps(broken), encoding="utf-8")
    with pytest.raises(TopologyError, match="validation failed"):
        create_app(topology_path=path, frontend_dist=None)


def test_built_frontend_is_served_with_spa_fallback(tmp_path) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "index.html").write_text("<html>app</html>", encoding="utf-8")
    client = TestClient(create_app(frontend_dist=tmp_path))
    assert client.get("/").text == "<html>app</html>"
    assert client.get("/simulation").text == "<html>app</html>"  # client-side route
    assert client.get("/assets/app.js").text == "console.log(1)"
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/nope").status_code == 404
    assert client.get("/%2e%2e/%2e%2e/secret").text == "<html>app</html>"  # no traversal outside dist


def test_scenarios_report_which_ones_pin_the_ips_mode(client) -> None:
    pinned = {s["id"]: s["pinned_ips_mode"] for s in client.get("/api/scenarios").json()}
    assert pinned == {"S1": None, "S2": None, "S3": None, "S4": None, "S5": "monitor", "S6": "enforce", "S7": None}


def test_a_pinned_scenario_ignores_the_requested_ips_mode(client) -> None:
    body = client.post("/api/sim/run", json={"scenario_id": "S6", "ips_mode": "monitor"}).json()
    assert body["ips_mode"] == "enforce" and body["summary"]["blocked"] == 24
    assert client.post("/api/sim/run", json={"scenario_id": "S5", "ips_mode": "enforce"}).json()["ips_mode"] == "monitor"


def test_controls_are_applied_and_leave_the_prefix_unchanged(client) -> None:
    base = client.post("/api/sim/run", json={"scenario_id": "S2", "ips_mode": "monitor"}).json()
    live = client.post(
        "/api/sim/run",
        json={"scenario_id": "S2", "ips_mode": "monitor", "controls": [{"type": "ips_mode", "t": 1.0, "mode": "enforce"}]},
    ).json()
    assert [e for e in live["events"] if e["t"] < 1.0] == [e for e in base["events"] if e["t"] < 1.0]
    assert live["summary"]["blocked"] == 24 and base["summary"]["blocked"] == 0


def test_a_mode_switch_on_a_pinned_scenario_is_a_422_and_bad_controls_are_rejected(client) -> None:
    pinned = client.post("/api/sim/run", json={"scenario_id": "S5", "controls": [{"type": "ips_mode", "t": 2.0, "mode": "enforce"}]})
    assert pinned.status_code == 422 and "pins the IPS mode" in pinned.json()["detail"]
    for bad in ({"type": "ips_mode", "t": -1, "mode": "enforce"}, {"type": "detector", "t": 1, "detector": "D9", "enabled": True}, {"type": "nope"}):
        assert client.post("/api/sim/run", json={"scenario_id": "S1", "controls": [bad]}).status_code == 422


def test_the_s3_trace_over_the_api_contains_the_reset_and_all_four_dispositions(client) -> None:
    body = client.post("/api/sim/run", json={"scenario_id": "S3", "ips_mode": "enforce"}).json()
    assert sorted(e["reason"] for e in body["events"] if e["type"] == "packet.dropped") == ["acl_deny", "acl_deny", "fw_deny", "ips_reject"]
    assert any(e["type"] == "packet.created" and e["flow"] == "F4-admin-to-db:rst" for e in body["events"])


def test_custom_flows_over_the_api_show_the_acl_denial_and_keep_the_prefix(client) -> None:
    flow = {"type": "tcp_session", "id": "X1", "src": "PC-1", "dst": "DB-SRV", "dport": 3306, "start": 5.0, "request_bytes": 100}
    base = client.post("/api/sim/run", json={"scenario_id": "S1"}).json()
    live = client.post("/api/sim/run", json={"scenario_id": "S1", "custom_flows": [flow]}).json()
    assert [e for e in live["events"] if e["t"] < 5.0] == [e for e in base["events"] if e["t"] < 5.0]
    deny = [e for e in live["events"] if e["type"] == "policy.decision" and e["action"] == "deny"]
    assert [(d["node"], d["rule_id"]) for d in deny] == [("CORE-SW1", "STAFF-IN:10")]
    assert live["summary"]["blocked"] == 1 and live["config_hash"] == base["config_hash"]


def test_bad_custom_flows_are_422(client) -> None:
    ok = {"type": "tcp_session", "id": "X1", "src": "PC-1", "dst": "DB-SRV", "dport": 3306, "start": 5.0, "request_bytes": 100}
    for bad in (
        {**ok, "src": "IPS-1"},  # not a host
        {**ok, "dst": "PC-1"},  # same source and destination
        {**ok, "id": "F1-https"},  # clashes with the scenario's own flow
        {**ok, "dport": 70000},  # invalid port
        {**ok, "type": "nope"},
    ):
        assert client.post("/api/sim/run", json={"scenario_id": "S1", "custom_flows": [bad]}).status_code == 422
    too_many = [{**ok, "id": f"X{i}"} for i in range(6)]
    assert client.post("/api/sim/run", json={"scenario_id": "S1", "custom_flows": too_many}).status_code == 422
