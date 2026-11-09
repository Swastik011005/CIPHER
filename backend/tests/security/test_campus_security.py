"""Zero Trust decisions, the security state store, the topology extension and the endpoint CLI."""

from __future__ import annotations

import pytest

from netsec.cli.endpoint import COMMANDS, CliError, EndpointCli
from netsec.security.ruleset import RuleStore
from netsec.security.state import EMPTY_SNAPSHOT, SecuritySnapshot, SecurityState, StateError
from netsec.security.zerotrust import ZeroTrustEngine, load_zerotrust

CFG = load_zerotrust()
SIEM = next(r for r in CFG.resources if r.id == "SIEM-1")
EDR = next(r for r in CFG.resources if r.id == "EDR-MGMT-1")


def zt(snapshot=EMPTY_SNAPSHOT) -> ZeroTrustEngine:
    return ZeroTrustEngine(CFG, snapshot)


# -- Zero Trust ---------------------------------------------------------------------------------


def test_an_admin_on_a_trusted_device_gets_only_the_listed_permissions() -> None:
    e = zt()
    assert e.evaluate("ADMIN-PC", SIEM, "tcp", 443).decision == "allow"
    assert e.evaluate("ADMIN-PC", SIEM, "icmp", None).decision == "allow"
    assert e.evaluate("ADMIN-PC", EDR, "tcp", 8443).decision == "allow"
    wrong_port = e.evaluate("ADMIN-PC", SIEM, "tcp", 22)  # no wildcard: the admin role lists tcp/443 and icmp on SIEM-1
    assert wrong_port.decision == "deny" and "tcp/22" in wrong_port.reason
    assert e.evaluate("ADMIN-PC", SIEM, "udp", 514).decision == "deny"


def test_staff_external_and_unknown_devices_are_denied_with_a_reason() -> None:
    e = zt()
    for device in ("PC-1", "LAPTOP-1", "PC-5", "EXT-USR", "EXT-ATK"):
        r = e.evaluate(device, SIEM, "tcp", 443)
        assert r.decision == "deny" and r.reason and r.factors, device
    unknown = e.evaluate("APP-SRV", SIEM, "tcp", 443)
    assert unknown.decision == "deny" and "no identity" in unknown.reason


def test_every_decision_lists_identity_role_device_trust_and_resource_factors() -> None:
    r = zt().evaluate("ADMIN-PC", SIEM, "tcp", 443)
    text = " ".join(r.factors)
    assert "dana" in text and "role: admin" in text and "ADMIN-PC" in text and "trust trusted" in text and "SIEM-1" in text
    assert (r.user, r.role, r.device, r.trust, r.resource) == ("dana", "admin", "ADMIN-PC", "trusted", "SIEM-1")


def test_device_trust_changes_the_decision() -> None:
    untrusted = zt(SecuritySnapshot(trust=(("ADMIN-PC", "untrusted"),)))
    assert untrusted.evaluate("ADMIN-PC", SIEM, "tcp", 443).decision == "deny"
    restricted = zt(SecuritySnapshot(trust=(("ADMIN-PC", "restricted"),)))
    assert restricted.evaluate("ADMIN-PC", SIEM, "tcp", 443).decision == "restricted"  # the console is allowed in restricted mode
    assert restricted.evaluate("ADMIN-PC", EDR, "tcp", 8443).decision == "deny"  # the EDR API is not
    assert restricted.evaluate("ADMIN-PC-2", EDR, "tcp", 8443).decision == "allow"  # other admins are unaffected


def test_role_change_and_revoked_permission_change_the_decision() -> None:
    demoted = zt(SecuritySnapshot(roles=(("dana", "staff"),)))
    assert demoted.evaluate("ADMIN-PC", SIEM, "tcp", 443).decision == "deny"
    promoted = zt(SecuritySnapshot(roles=(("alice", "admin"),)))
    assert promoted.evaluate("PC-1", SIEM, "tcp", 443).decision == "allow"  # explicit permission follows the role, nothing else
    revoked = zt(SecuritySnapshot(revoked=("admin:SIEM-1",)))
    r = revoked.evaluate("ADMIN-PC", SIEM, "tcp", 443)
    assert r.decision == "deny" and "revoked" in r.reason
    assert revoked.evaluate("ADMIN-PC", EDR, "tcp", 8443).decision == "allow"


def test_an_isolated_endpoint_gets_no_access_even_as_an_admin() -> None:
    r = zt().evaluate("ADMIN-PC", SIEM, "tcp", 443, isolated=True)
    assert r.decision == "deny" and "isolated" in r.reason


# -- state store --------------------------------------------------------------------------------


def make_state() -> SecurityState:
    return SecurityState(hosts=frozenset({"PC-1", "PC-2"}), users=frozenset({"alice"}))


def test_isolate_restore_trust_and_role_round_trip_through_a_snapshot() -> None:
    s = make_state()
    s.isolate("PC-2")
    s.set_trust("PC-1", "restricted")
    s.set_role("alice", "admin")
    s.revoke("admin", "SIEM-1")
    snap = s.snapshot()
    assert snap.isolated == ("PC-2",) and dict(snap.trust) == {"PC-1": "restricted"} and dict(snap.roles) == {"alice": "admin"} and snap.revoked == ("admin:SIEM-1",)
    s.restore("PC-2")
    s.set_trust("PC-1", "trusted")
    s.grant("admin", "SIEM-1")
    assert s.snapshot().isolated == () and s.snapshot().trust == () and s.snapshot().revoked == ()
    s.apply(snap)
    assert s.snapshot() == snap
    s.reset()
    assert s.snapshot() == EMPTY_SNAPSHOT


def test_state_rejects_invalid_operator_actions() -> None:
    s = make_state()
    for call in (lambda: s.isolate("R1-EDGE"), lambda: s.set_trust("PC-1", "super"), lambda: s.set_role("mallory", "admin"), lambda: s.set_role("alice", "root")):
        with pytest.raises(StateError):
            call()


def test_record_run_accumulates_rule_hits_and_history(graph) -> None:
    from netsec.sim.engine import run_scenario
    from netsec.traffic.scenarios import load_scenario

    s = make_state()
    s.record_run(run_scenario(graph, load_scenario("P2")).events)
    s.record_run(run_scenario(graph, load_scenario("P2")).events)
    assert s.rule_hits["CORE-SW1:STAFF-IN:20:deny"] == 8 and s.runs == 2 and s.siem_history



def test_the_event_history_holds_each_run_once_and_a_replay_replaces_it(graph) -> None:
    """Regression: re-running a scenario, or re-simulating it after a mid-run change, used to append a second copy of its SIEM events."""
    from netsec.sim.engine import run_scenario
    from netsec.traffic.scenarios import load_scenario

    s = make_state()
    first = run_scenario(graph, load_scenario("P7"), scripted_operator=True)
    s.record_run(first.events)
    count = len(s.siem_history)
    assert count > 0 and len({e["event_id"] for e in s.siem_history}) == count
    s.record_run(run_scenario(graph, load_scenario("P7"), scripted_operator=True).events)  # the same run again
    assert len(s.siem_history) == count and len({e["event_id"] for e in s.siem_history}) == count
    edr_count = len(s.edr_history)
    s.record_run(first.events)
    assert len(s.edr_history) == edr_count and s.runs == 3  # the rule-hit and run counters stay cumulative
    s.record_run(run_scenario(graph, load_scenario("P9")).events)  # a different run adds to the history
    assert len(s.siem_history) > count and len({e["event_id"] for e in s.siem_history}) == len(s.siem_history)
    s.reset()
    assert s.siem_history == [] and s.edr_history == []


# -- topology extension -------------------------------------------------------------------------


def test_the_extension_devices_have_unique_valid_addresses_inside_their_vlan(graph) -> None:
    new = [n for n in graph.topology.nodes[17:]]
    assert len(new) == 14
    prefixes = {"STAFF": "10.0.10.", "ADMIN": "10.0.20.", "SERVERS": "10.0.30.", "SECOPS": "10.0.99."}
    ips = []
    for n in new:
        ip = n.interfaces[0].ip
        assert ip.startswith(prefixes[n.zone]), n.id
        ips.append(ip)
    original_ips = {i.ip for n in graph.topology.nodes[:17] for i in n.interfaces if i.ip}
    assert len(set(ips)) == 14 and not set(ips) & original_ips
    assert {n.id for n in new} >= {"PC-3", "PC-7", "ADMIN-PC-4", "WEB-SRV", "DNS-SRV", "FILE-SRV", "SIEM-1", "EDR-MGMT-1", "ZT-POLICY-1"}
    staff = [n for n in graph.topology.nodes if n.zone == "STAFF" and n.type == "host"]
    admin = [n for n in graph.topology.nodes if n.zone == "ADMIN"]
    assert len(staff) >= 8 and len(admin) >= 4  # 3 original + 5 new staff endpoints; ADMIN-PC + 3 new admin PCs


def test_changing_an_original_address_fails_the_contract_check(graph) -> None:
    from netsec.network.models import Topology
    from netsec.network.validator import validate_topology

    raw = graph.topology.model_dump(mode="json")
    next(n for n in raw["nodes"] if n["id"] == "PC-2")["interfaces"][0]["ip"] = "10.0.10.99"
    report = validate_topology(Topology.model_validate(raw))
    assert "T17" in [c.id for c in report.failures]


# -- endpoint CLI -------------------------------------------------------------------------------


def cli(graph, snapshot=EMPTY_SNAPSHOT, mode="enforce") -> EndpointCli:
    return EndpointCli(graph, RuleStore().current, snapshot, mode)


@pytest.mark.parametrize("command", ["rm -rf /", "dir", "powershell", "cmd /c whoami", "ls", "python -c 1", "format c:"])
def test_commands_outside_the_whitelist_are_refused_and_nothing_runs(graph, command) -> None:
    r = cli(graph).execute("PC-1", command)
    assert not r.ok and "not recognized" in r.lines[0] and r.run is None


@pytest.mark.parametrize("command", ["ping 10.0.30.10; rm -rf /", "ping $(whoami)", "ping `id`", "ping 10.0.30.10 && dir", "ping 10.0.30.10 | more", "curl http://10.0.30.10/../../etc/passwd >x", "ping %PATH%", "ping \"x\""])
def test_shell_metacharacters_are_rejected_before_parsing(graph, command) -> None:
    with pytest.raises(CliError):
        cli(graph).execute("PC-1", command)


@pytest.mark.parametrize("command", ["ping", "ping 1.2.3", "ping 999.1.1.1", "ping 1.2.3.4", "telnet 10.0.30.10", "telnet 10.0.30.10 99999", "telnet 10.0.30.10 http", "curl 10.0.30.10", "curl https://10.0.30.10", "tracert", "ping a b"])
def test_bad_arguments_get_a_helpful_error(graph, command) -> None:
    with pytest.raises(CliError):
        cli(graph).execute("PC-1", command)


def test_only_endpoints_have_a_cli_and_overlong_commands_are_refused(graph) -> None:
    with pytest.raises(CliError):
        cli(graph).execute("CORE-SW1", "ping 10.0.30.10")
    with pytest.raises(CliError):
        cli(graph).execute("PC-1", "ping " + "1" * 400)


def test_help_clear_and_ipconfig_are_local_commands(graph) -> None:
    c = cli(graph)
    assert set(COMMANDS) == {"help", "ipconfig", "ping", "tracert", "telnet", "curl", "clear"}
    assert c.execute("PC-1", "help").run is None and any("ping <IP>" in line for line in c.execute("PC-1", "help").lines)
    assert c.execute("PC-1", "clear").clear
    text = "\n".join(c.execute("PC-2", "ipconfig").lines)
    assert "10.0.10.12" in text and "255.255.255.0" in text and "10.0.10.1" in text and "VLAN" in text and "healthy" in text
    assert "ISOLATED" in "\n".join(cli(graph, SecuritySnapshot(isolated=("PC-2",))).execute("PC-2", "ipconfig").lines)


def test_ping_output_comes_from_the_engine_for_allowed_and_denied_paths(graph) -> None:
    ok = cli(graph).execute("PC-1", "ping 10.0.30.10")
    assert ok.ok and "Received = 4" in "\n".join(ok.lines) and "Reply from 10.0.30.10" in ok.lines[2]
    denied = cli(graph).execute("PC-1", "ping 10.0.99.21")
    text = "\n".join(denied.lines)
    assert not denied.ok and "Received = 0" in text and "Destination host unreachable." in text
    assert "STAFF-IN rule 20" in text and "Enforcing device: CORE-SW1" in text
    assert denied.decision["enforcing_device"] == "CORE-SW1" and denied.decision["rule_id"] == "STAFF-IN:20"


def test_the_cli_decision_equals_the_scenario_decision(graph) -> None:
    """CLI and scenario use one engine: the same flow is dropped by the same rule at the same device."""
    from netsec.sim.engine import run_scenario
    from netsec.traffic.scenarios import load_scenario

    scenario = run_scenario(graph, load_scenario("P3"))
    scenario_drop = next(e for e in scenario.events if e["type"] == "packet.dropped")
    scenario_rule = next(e["rule_id"] for e in scenario.events if e["type"] == "policy.decision" and e["action"] == "deny")
    result = cli(graph).execute("PC-1", "telnet 10.0.30.20 3306")
    assert result.decision["enforcing_device"] == scenario_drop["node"] and result.decision["rule_id"] == scenario_rule
    assert "timed out" in "\n".join(result.lines) and "database" in "\n".join(result.lines)


def test_telnet_curl_and_tracert_report_success_refusal_and_the_failure_point(graph) -> None:
    c = cli(graph)
    assert c.execute("PC-1", "telnet 10.0.30.10 443").ok
    refused = c.execute("PC-1", "telnet 10.0.30.10 9999")
    assert not refused.ok and "refused" in "\n".join(refused.lines).lower()
    page = c.execute("EXT-USR", "curl http://10.0.30.10")
    assert page.ok and "200 OK" in "\n".join(page.lines)
    blocked = c.execute("EXT-ATK", "telnet 10.0.30.20 3306")
    assert not blocked.ok and blocked.decision["enforcing_device"] == "FW1"
    trace = "\n".join(c.execute("PC-1", "tracert 10.0.99.21").lines)
    assert "CORE-SW1" in trace and "Request timed out" in trace and "Enforcing device: CORE-SW1" in trace
    assert "Trace complete" in "\n".join(c.execute("PC-1", "tracert 10.0.30.10").lines)


def test_isolation_changes_the_cli_result_immediately_and_only_for_that_endpoint(graph) -> None:
    snap = SecuritySnapshot(isolated=("PC-2",))
    isolated = cli(graph, snap).execute("PC-2", "ping 10.0.30.10")
    assert not isolated.ok and isolated.decision["drop_reason"] == "edr_isolated" and "isolated by EDR" in "\n".join(isolated.lines)
    assert cli(graph, snap).execute("PC-1", "ping 10.0.30.10").ok  # others keep working
    assert cli(graph, snap).execute("PC-1", "ping PC-2").ok is False  # nothing reaches an isolated endpoint either
    assert cli(graph, snap).execute("PC-4", "ping 10.0.30.10").ok  # another staff PC is not affected either


def test_zero_trust_decides_the_admin_cli_result(graph) -> None:
    assert cli(graph).execute("ADMIN-PC", "ping SIEM-1").ok
    demoted = cli(graph, SecuritySnapshot(trust=(("ADMIN-PC", "untrusted"),))).execute("ADMIN-PC", "ping SIEM-1")
    text = "\n".join(demoted.lines)
    assert not demoted.ok and demoted.decision["drop_reason"] == "zt_deny" and "Zero Trust" in text and "not a trusted device" in text
