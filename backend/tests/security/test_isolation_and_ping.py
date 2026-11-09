"""EDR isolation is one backend state that stops traffic at its source, and the endpoint ping is four sequential journeys.

Part 1 is the regression suite for the isolation bug (packets of an isolated endpoint kept being created, dropped and inspected after
the isolation). Part 2 covers the sequential ping and the security policy matrix the 3D simulation uses.
"""

from __future__ import annotations

import pytest

from netsec.cli.endpoint import EndpointCli
from netsec.security.ruleset import RuleStore
from netsec.security.state import EMPTY_SNAPSHOT, SecuritySnapshot
from netsec.sim.controls import EndpointControl
from netsec.sim.engine import Engine, run_scenario
from netsec.traffic.scenarios import load_scenario

PC2 = "10.0.10.12"
PC1 = "10.0.10.11"


def kind(result, name):
    return [e for e in result.events if e["type"] == name]


def p7(graph, controls=(), mode="enforce"):
    return run_scenario(graph, load_scenario("P7"), ips_mode=mode, controls=list(controls))


def iso(t, action="isolate", node="PC-2"):
    return EndpointControl(type="endpoint", t=t, node=node, action=action)


def cli(graph, snapshot=EMPTY_SNAPSHOT, mode="enforce"):
    return EndpointCli(graph, RuleStore().current, snapshot, mode)


# -- 1. isolation ------------------------------------------------------------------------------------


@pytest.mark.parametrize("t_iso", [4.0, 5.0, 9.0])
def test_after_isolation_no_new_packet_originates_from_the_endpoint(graph, t_iso) -> None:
    r = p7(graph, [iso(t_iso)])
    created = {e["pid"]: e for e in kind(r, "packet.created")}
    # not an original, not a SPAN copy of one: nothing sourced from PC-2 exists from the isolation on
    assert not [e for e in created.values() if e["src"] == PC2 and e["t"] >= t_iso]
    # and no packet leaves PC-2 or enters a switch after the isolation
    after = [e for e in kind(r, "packet.hop") if e["t"] >= t_iso and created[e["pid"]]["src"] == PC2 and created[e["pid"]]["mirror_of"] is None]
    assert not [e for e in after if e["from"] == "PC-2"]
    inspected = [e for e in kind(r, "inspect.result") if e["t"] >= t_iso and created[e["pid"]]["src"] == PC2]
    assert all(created[e["pid"]]["t"] < t_iso for e in inspected)
    # the scenario's own later flow from PC-2 is stopped at the agent, once, and recorded
    blocked = kind(r, "edr.send_blocked")
    assert [(e["node"], e["flow"]) for e in blocked if e["flow"] == "P7-pc2-after"] == [("PC-2", "P7-pc2-after")] and all(e["t"] >= t_iso for e in blocked)


def test_packets_in_flight_at_the_isolation_are_quarantined_not_inspected(graph) -> None:
    r = p7(graph, [iso(5.0)])
    created = {e["pid"]: e for e in kind(r, "packet.created")}
    late_drops = [e for e in kind(r, "packet.dropped") if e["t"] >= 5.0 and created[e["pid"]]["src"] == PC2 and created[e["pid"]]["mirror_of"] is None]
    assert late_drops and all(e["reason"] == "edr_isolated" for e in late_drops)
    assert not [e for e in kind(r, "ips.action") if e["t"] >= 5.0 and created[e["pid"]]["src"] == PC2]
    assert not [e for e in kind(r, "alert.raised") if e["t"] >= 5.0]


def test_no_alert_is_raised_from_traffic_that_never_existed(graph) -> None:
    early = p7(graph, [iso(2.5)])  # PC-2 is isolated before its scan starts (3.0 s): nothing to detect
    assert not kind(early, "alert.raised") and not kind(early, "ips.action") and not kind(early, "block.added")
    assert not [e for e in kind(early, "packet.created") if e["src"] == PC2]
    assert [e["sensor"] for e in kind(p7(graph), "alert.raised")]  # without isolation the scan is detected


def test_pc2_traffic_before_the_isolation_behaves_normally_and_history_is_unchanged(graph) -> None:
    base = p7(graph)
    acted = p7(graph, [iso(9.0)])
    strip = lambda ev, t: [e for e in ev if e["t"] < t and e["type"] != "run.end"]  # noqa: E731
    assert strip(base.events, 9.0) == strip(acted.events, 9.0)  # every event before the playhead identical, same timestamps and outcomes
    assert [e for e in kind(acted, "packet.created") if e["src"] == PC2 and e["t"] < 9.0]
    assert [e for e in kind(acted, "alert.raised")] == [e for e in kind(base, "alert.raised") if e["t"] < 9.0] or kind(acted, "alert.raised")
    assert [e["t"] for e in kind(acted, "siem.event") if e["t"] < 9.0] == [e["t"] for e in kind(base, "siem.event") if e["t"] < 9.0]


def test_other_endpoints_are_unaffected(graph) -> None:
    r = p7(graph, [iso(5.0)])
    created = {e["pid"]: e for e in kind(r, "packet.created")}
    dropped = {e["pid"] for e in kind(r, "packet.dropped")}
    delivered = {e["pid"] for e in kind(r, "packet.delivered")}
    pc1 = [p for p, e in created.items() if e["flow"].startswith("P7-pc1")]
    assert pc1 and not set(pc1) & dropped and set(pc1) & delivered
    assert not kind(r, "edr.send_blocked") or all(e["node"] == "PC-2" for e in kind(r, "edr.send_blocked"))


def test_recovery_restores_pc2_communication(graph) -> None:
    r = p7(graph, [iso(5.0), iso(8.0, "restore")])
    created = {e["pid"]: e for e in kind(r, "packet.created")}
    delivered = {e["pid"] for e in kind(r, "packet.delivered")}
    after = [p for p, e in created.items() if e["flow"] == "P7-pc2-after" and e["src"] == PC2]
    assert after and any(p in delivered for p in after)  # the three pings of 12 s go out and are answered
    assert r.final_isolated == ()
    assert [(e["state"], e["cause"]) for e in kind(r, "edr.state")][-2:] == [("isolated", "operator"), ("healthy", "operator")]


@pytest.mark.parametrize("command", ["ping APP-SRV", "tracert APP-SRV", "telnet APP-SRV 443", "curl http://APP-SRV"])
def test_cli_commands_of_an_isolated_endpoint_fail_with_a_clear_message_and_send_nothing(graph, command) -> None:
    snap = SecuritySnapshot(isolated=("PC-2",))
    result = cli(graph, snap).execute("PC-2", command)
    text = "\n".join(result.lines)
    assert not result.ok and result.run is None  # no run: no packet exists to animate
    assert "ISOLATED by EDR" in text and "No packet was sent" in text and result.decision["drop_reason"] == "edr_isolated"
    assert cli(graph, snap).execute("PC-1", command).run is not None  # the others still work


def test_the_cli_and_the_engine_read_the_same_state(graph) -> None:
    snap = SecuritySnapshot(isolated=("PC-2",))
    assert "ISOLATED" in "\n".join(cli(graph, snap).execute("PC-2", "ipconfig").lines)
    assert cli(graph, snap).execute("PC-1", "ping PC-2").ok is False  # traffic to it is dropped at its agent
    r = run_scenario(graph, load_scenario("P1"), security_state=snap)
    assert [e for e in kind(r, "edr.state") if e["node"] == "PC-2" and e["state"] == "isolated"]


# -- 2. the sequential ping --------------------------------------------------------------------------


def ping(graph, node, target, snapshot=EMPTY_SNAPSHOT, mode="enforce"):
    return cli(graph, snapshot, mode).execute(node, f"ping {target}")


def journeys(result, me_ip):
    """Per ICMP sequence number: request pid, request created, reply pid, reply delivered time, drop times."""
    created = {e["pid"]: e for e in kind(result, "packet.created") if e["mirror_of"] is None and e["proto"] == "icmp"}
    out: dict[int, dict] = {}
    for pid, e in created.items():
        seq = e["icmp"]["seq"]
        j = out.setdefault(seq, {})
        if e["src"] == me_ip and e["icmp"]["type"] == 8:
            j["request"], j["sent"] = pid, e["t"]
        elif e["dst"] == me_ip and e["icmp"]["type"] == 0:
            j["reply"] = pid
    for e in kind(result, "packet.delivered"):
        for j in out.values():
            if j.get("reply") == e["pid"]:
                j["replied"] = e["t"]
    for e in kind(result, "packet.dropped"):
        for j in out.values():
            if e["pid"] in (j.get("request"), j.get("reply")):
                j["dropped"], j["dropped_at"] = e["t"], e["node"]
    return out


def test_a_successful_ping_is_four_sequential_request_reply_journeys(graph) -> None:
    result = ping(graph, "PC-1", "APP-SRV")
    assert result.ok and result.lines[-1].startswith("Packets: Sent = 4, Received = 4, Lost = 0")
    j = journeys(result.run, PC1)
    assert sorted(j) == [1, 2, 3, 4] and all("replied" in j[s] and "dropped" not in j[s] for s in j)
    for seq in (1, 2, 3):
        assert j[seq + 1]["sent"] > j[seq]["replied"]  # the next request leaves only after the previous reply has reached the source
    # each reply line is stamped with the moment its reply reached the source, and nothing is printed earlier
    replies = [(t, line) for t, line in zip(result.timeline, result.lines) if line.startswith("Reply from")]
    assert [t for t, _ in replies] == [j[s]["replied"] for s in (1, 2, 3, 4)] and all("TTL=" in line for _, line in replies)
    assert result.timeline == sorted(result.timeline) and len(result.timeline) == len(result.lines)
    stats_t = next(t for t, line in zip(result.timeline, result.lines) if line.startswith("Packets:"))
    assert stats_t >= j[4]["replied"]


def test_request_and_reply_follow_the_topology_path_and_its_reverse(graph) -> None:
    result = ping(graph, "PC-1", "APP-SRV")
    j = journeys(result.run, PC1)[1]
    hops = [(e["from"], e["to"]) for e in kind(result.run, "packet.hop") if e["pid"] == j["request"]]
    assert [h[0] for h in hops] + [hops[-1][1]] == ["PC-1", "ACC-SW2", "CORE-SW1", "IPS-1", "SRV-SW3", "APP-SRV"]
    back = [(e["from"], e["to"]) for e in kind(result.run, "packet.hop") if e["pid"] == j["reply"]]
    assert back == [(b, a) for a, b in reversed(hops)]
    created = next(e for e in kind(result.run, "packet.created") if e["pid"] == j["request"])
    assert created["icmp"]["type"] == 8 and next(e for e in kind(result.run, "packet.created") if e["pid"] == j["reply"])["icmp"]["type"] == 0


def test_complete_loss_every_attempt_is_stopped_at_the_core_switch_one_after_another(graph) -> None:
    result = ping(graph, "PC-1", "SIEM-1")
    assert not result.ok and "Packets: Sent = 4, Received = 0, Lost = 4 (100% loss)" in result.lines
    assert not [line for line in result.lines if line.startswith("Reply from")]
    j = journeys(result.run, PC1)
    assert sorted(j) == [1, 2, 3, 4] and all(j[s]["dropped_at"] == "CORE-SW1" and "replied" not in j[s] for s in j)
    assert not [e for e in kind(result.run, "packet.hop") if e["from"] == "ACC-SW2" and e["to"] == "IPS-1"]  # never went on to the servers
    for seq in (1, 2, 3):
        assert j[seq + 1]["sent"] > j[seq]["dropped"]
    acl = [e for e in kind(result.run, "policy.decision") if e["action"] == "deny"]
    assert len(acl) == 4 and {e["node"] for e in acl} == {"CORE-SW1"} and {e["rule_id"] for e in acl} == {"STAFF-IN:20"}  # not ACC-SW2
    assert result.decision["enforcing_device"] == "CORE-SW1"


def test_partial_loss_some_attempts_are_answered_and_the_rest_stopped(graph) -> None:
    full = ping(graph, "PC-1", "APP-SRV")
    j = journeys(full.run, PC1)
    # the target is isolated between the second and the third attempt: the first two are answered, the last two are lost at its agent
    t_cut = (j[2]["replied"] + j[3]["sent"]) / 2
    scenario = _ping_scenario(graph, "PC-1", "APP-SRV")
    rules = RuleStore().current
    engine = Engine(graph, scenario.default_seed, "enforce", detectors=rules.detectors, ips_policy=rules.ips_policy, policies=list(rules.policies), security_state=EMPTY_SNAPSHOT)
    r = engine.run(scenario, controls=[iso(t_cut, node="APP-SRV")], allow_overrun=True)
    jj = journeys(r, PC1)
    assert [s for s in jj if "replied" in jj[s]] == [1, 2]
    assert [s for s in jj if "dropped" in jj[s]] == [3, 4] and sorted(jj) == [1, 2, 3, 4]


def _ping_scenario(graph, src, dst):
    from netsec.traffic.scenarios import Features, IcmpEchoSpec, ScenarioSpec

    flow = IcmpEchoSpec(type="icmp_echo", id="t-ping", src=src, dst=dst, start=0.0, count=4, interval=1.0, payload_bytes=32, sequential=True, gap=0.6)
    return ScenarioSpec(id="CLI", name="t", description="t", duration=1.0, default_seed=7, flows=[flow], features=Features(zero_trust=True, edr=True, siem=True))


def test_a_sequential_ping_is_deterministic(graph) -> None:
    a, b = ping(graph, "PC-1", "APP-SRV"), ping(graph, "PC-1", "APP-SRV")
    assert a.lines == b.lines and a.timeline == b.timeline and a.run.trace_hash == b.run.trace_hash


# -- 3. the security policy matrix ------------------------------------------------------------------


MATRIX = [
    # source, command, delivered, enforcing device (None when it is delivered)
    ("PC-1", "ping APP-SRV", True, None),
    ("PC-1", "ping PC-2", True, None),
    ("PC-1", "ping SIEM-1", False, "CORE-SW1"),
    ("PC-1", "telnet DB-SRV 3306", False, "CORE-SW1"),
    ("ADMIN-PC", "ping SIEM-1", True, None),
    ("ADMIN-PC", "curl http://SIEM-1:443", True, None),
    ("ADMIN-PC", "ping APP-SRV", True, None),
    ("EXT-USR", "curl http://APP-SRV", True, None),
    ("EXT-USR", "telnet APP-SRV 443", True, None),
    ("EXT-USR", "ping APP-SRV", False, "FW1"),  # allowing HTTP and HTTPS does not allow ping
    ("EXT-USR", "telnet DB-SRV 3306", False, "FW1"),
    ("EXT-USR", "ping SIEM-1", False, "FW1"),
]


@pytest.mark.parametrize("source,command,delivered,device", MATRIX)
def test_policy_matrix(graph, source, command, delivered, device) -> None:
    result = cli(graph).execute(source, command)
    assert result.ok is delivered
    if device is not None:
        assert result.decision["enforcing_device"] == device


def test_staff_to_staff_never_touches_the_core_and_admin_to_the_database_passes_the_core_acl(graph) -> None:
    r = ping(graph, "PC-1", "PC-2").run
    assert not {e["to"] for e in kind(r, "packet.hop")} & {"CORE-SW1", "FW1", "IPS-1"}
    admin = cli(graph).execute("ADMIN-PC", "telnet DB-SRV 3306")
    assert not [e for e in kind(admin.run, "policy.decision") if e["action"] == "deny"]  # the core ACL does not stop it
    assert "IPS-1" in {e["to"] for e in kind(admin.run, "packet.hop")}  # it reaches the servers' side (the IPS may still reject it in Enforce mode)


def test_the_external_user_is_stopped_at_fw1_and_never_reaches_the_core(graph) -> None:
    r = cli(graph).execute("EXT-USR", "telnet DB-SRV 3306").run
    assert {e["node"] for e in kind(r, "packet.dropped") if e["reason"] == "fw_deny"} == {"FW1"}
    assert "CORE-SW1" not in {e["to"] for e in kind(r, "packet.hop")}
    web = cli(graph).execute("EXT-USR", "curl http://APP-SRV").run
    path = [e["to"] for e in kind(web, "packet.hop") if e["pid"] == min(x["pid"] for x in kind(web, "packet.hop"))]
    assert path == ["INET", "R1-EDGE", "FW1", "CORE-SW1", "IPS-1", "SRV-SW3", "APP-SRV"]  # INET is the abstract Internet segment


# -- 4. IDS, IPS and SIEM ----------------------------------------------------------------------------


def test_the_ids_detects_without_ever_blocking_and_the_ips_differs_by_mode(graph) -> None:
    for mode in ("monitor", "enforce"):
        r = run_scenario(graph, load_scenario("S2"), ips_mode=mode)
        assert {e["sensor"] for e in kind(r, "alert.raised")} >= {"IDS-1"}
        assert not [e for e in kind(r, "packet.dropped") if e["node"] == "IDS-1"] and not [e for e in kind(r, "ips.action") if e.get("node") == "IDS-1"]
        ips_drops = [e for e in kind(r, "packet.dropped") if e["node"] == "IPS-1"]
        if mode == "monitor":
            assert not ips_drops and all(e["applied"] is False for e in kind(r, "ips.action"))
        else:
            assert ips_drops and any(e["applied"] for e in kind(r, "ips.action"))


def test_the_siem_receives_events_from_the_components_that_produced_them(graph) -> None:
    expectations = {"P2": {"CORE-SW1"}, "P6": {"FW1"}, "P7": {"EDR", "IDS-1", "IPS-1"}, "P9": {"IDS-1", "IPS-1"}}
    for sid, sources in expectations.items():
        r = run_scenario(graph, load_scenario(sid), ips_mode="enforce", scripted_operator=True)
        siem = kind(r, "siem.event")
        assert sources <= {e["source"] for e in siem}, sid
        times = [e["t"] for e in siem]
        assert times == sorted(times) and all(e["event_id"] for e in siem)
        assert {e["source"] for e in siem} <= {"FW1", "CORE-SW1", "IDS-1", "IPS-1", "EDR", "ZERO-TRUST"}  # SIEM-1 itself forwards nothing
