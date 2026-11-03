"""Scenario S3: the four unauthorised-access cases, in Monitor and Enforce mode."""

from __future__ import annotations

import pytest

from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import load_scenario

PC1, LAPTOP, EXT_ATK, ADMIN = "10.0.10.11", "10.0.10.13", "203.0.113.66", "10.0.20.10"
DB, SEC = "10.0.30.20", "10.0.99.20"


@pytest.fixture(scope="module")
def monitor(graph):
    return run_scenario(graph, load_scenario("S3"), ips_mode="monitor")


@pytest.fixture(scope="module")
def enforce(graph):
    return run_scenario(graph, load_scenario("S3"), ips_mode="enforce")


def of(result, kind, **match):
    return [e for e in result.events if e["type"] == kind and all(e.get(k) == v for k, v in match.items())]


def first_packet(result, flow):
    return next(e for e in of(result, "packet.created") if e["flow"] == flow and e["mirror_of"] is None)


def fate(result, pid):
    ended = [e for e in result.events if e["type"] in ("packet.delivered", "packet.dropped") and e["pid"] == pid]
    assert len(ended) == 1
    return ended[0]


def alerts(result, sensor=None, rule=None):
    return [a for a in of(result, "alert.raised") if (sensor is None or a["sensor"] == sensor) and (rule is None or a["rule"] == rule)]


# -- (a) Staff to the database: ACL deny, IDS alert ----------------------------------------------------


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_a_staff_to_database_is_denied_by_the_acl_and_seen_by_the_ids(request, mode) -> None:
    result = request.getfixturevalue(mode)
    syn = first_packet(result, "F1-staff-to-db")
    (decision,) = of(result, "policy.decision", pid=syn["pid"])
    assert (decision["node"], decision["policy"], decision["rule_id"], decision["action"]) == ("CORE-SW1", "STAFF-IN", "STAFF-IN:10", "deny")
    dropped = fate(result, syn["pid"])
    assert (dropped["type"], dropped["node"], dropped["reason"]) == ("packet.dropped", "CORE-SW1", "acl_deny")
    (mirror,) = of(result, "packet.mirrored", pid=syn["pid"])  # the SPAN copy is taken before the ACL
    assert mirror["to"] == "IDS-1"
    (ids,) = [a for a in alerts(result, "IDS-1", "D4") if a["src"] == PC1]
    assert (ids["severity"], ids["dst"], ids["dport"]) == ("high", DB, 3306)
    assert not [a for a in alerts(result, "IPS-1") if a["src"] == PC1]  # it never reached IPS-1
    assert not [h for h in of(result, "packet.hop", pid=syn["pid"]) if h["to"] in ("IPS-1", "DB-SRV")]


# -- (b) Staff to the security network: ACL deny, D5 --------------------------------------------------


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_b_staff_to_the_security_network_is_denied_and_raises_d5(request, mode) -> None:
    result = request.getfixturevalue(mode)
    syn = first_packet(result, "F2-staff-to-security")
    (decision,) = of(result, "policy.decision", pid=syn["pid"])
    assert (decision["node"], decision["rule_id"], decision["action"]) == ("CORE-SW1", "STAFF-IN:20", "deny")
    assert fate(result, syn["pid"])["reason"] == "acl_deny"
    (ids,) = [a for a in alerts(result, "IDS-1", "D5") if a["src"] == LAPTOP]
    assert (ids["severity"], ids["dst"]) == ("high", SEC)
    assert not [a for a in alerts(result, "IPS-1") if a["src"] == LAPTOP]


# -- (c) Outside to the database: FW1 deny, the IDS never sees it -------------------------------------


@pytest.mark.parametrize("mode", ["monitor", "enforce"])
def test_c_outside_to_database_is_denied_by_the_firewall_before_the_ids_can_see_it(request, mode) -> None:
    result = request.getfixturevalue(mode)
    syn = first_packet(result, "F3-outside-to-db")
    (decision,) = of(result, "policy.decision", pid=syn["pid"])
    assert (decision["node"], decision["policy"], decision["rule_id"], decision["action"]) == ("FW1", "OUTSIDE-IN", "OUTSIDE-IN:implicit-deny", "deny")
    dropped = fate(result, syn["pid"])
    assert (dropped["node"], dropped["reason"]) == ("FW1", "fw_deny")
    assert not of(result, "packet.mirrored", pid=syn["pid"])  # never entered CORE-SW1
    assert not [a for a in of(result, "alert.raised") if a["src"] == EXT_ATK]  # no sensor saw it
    assert not [i for i in of(result, "inspect.result", pid=syn["pid"])]


# -- (d) Admin to the database: ACL permits, IPS-1 rejects --------------------------------------------


def test_d_admin_to_database_passes_the_acl_then_ips_1_rejects_it_with_a_reset(enforce) -> None:
    syn = first_packet(enforce, "F4-admin-to-db")
    assert not of(enforce, "policy.decision", pid=syn["pid"])  # STAFF-IN applies to VLAN 10 only
    inspect = next(e for e in of(enforce, "inspect.result", pid=syn["pid"]) if e["node"] == "IPS-1")
    assert (inspect["classification"], inspect["rules"]) == ("malicious", ["D4"])
    (action,) = of(enforce, "ips.action", pid=syn["pid"])
    assert (action["action"], action["applied"], action["mode"], action["rule"]) == ("reject", True, "enforce", "D4")
    dropped = fate(enforce, syn["pid"])
    assert (dropped["node"], dropped["reason"]) == ("IPS-1", "ips_reject")
    assert not [h for h in of(enforce, "packet.hop", pid=syn["pid"]) if h["to"] == "DB-SRV"]  # the server never saw it
    assert not of(enforce, "block.added")  # reject does not block the source


def test_d_the_reset_is_a_synthetic_packet_from_the_ips_spoofed_as_the_database(enforce) -> None:
    syn = first_packet(enforce, "F4-admin-to-db")
    rsts = [e for e in of(enforce, "packet.created") if e["flow"] == "F4-admin-to-db:rst" and e["mirror_of"] is None]
    assert len(rsts) == 1
    rst = rsts[0]
    assert (rst["src"], rst["sport"], rst["dst"], rst["dport"]) == (DB, 3306, ADMIN, syn["sport"])  # looks like the server
    assert rst["flags"] == ["ACK", "RST"] and rst["proto"] == "tcp" and rst["ttl"] == 64
    assert rst["t"] == fate(enforce, syn["pid"])["t"]  # created the instant the SYN is rejected
    hops = [h for h in of(enforce, "packet.hop", pid=rst["pid"])]
    assert [h["from"] for h in hops] + [hops[-1]["to"]] == ["IPS-1", "CORE-SW1", "ACC-SW2", "ADMIN-PC"]  # starts at the IPS
    assert [h["vlan"] for h in hops] == [30, 20, 20]  # re-tagged to VLAN 20 by the core
    assert [h["ttl"] for h in hops] == [64, 63, 63]  # decremented once, at CORE-SW1
    delivered = fate(enforce, rst["pid"])
    assert (delivered["type"], delivered["node"], delivered["t"]) == ("packet.delivered", "ADMIN-PC", hops[-1]["t_arrive"])


def test_d_the_reset_ends_the_clients_session_and_it_is_also_mirrored_to_the_ids(enforce) -> None:
    flow = [e for e in of(enforce, "packet.created") if e["flow"].startswith("F4-admin-to-db") and e["mirror_of"] is None]
    assert [e["flow"] for e in flow] == ["F4-admin-to-db", "F4-admin-to-db:rst"]  # nothing else is ever sent: the client gave up
    rst = flow[1]
    (mirror,) = of(enforce, "packet.mirrored", pid=rst["pid"])
    assert (mirror["at"], mirror["to"]) == ("CORE-SW1", "IDS-1")


def test_d_in_monitor_mode_the_unauthorised_session_goes_through_and_is_recorded(monitor) -> None:
    flow = [e["pid"] for e in of(monitor, "packet.created") if e["flow"] == "F4-admin-to-db" and e["mirror_of"] is None]
    delivered_to_db = [e for e in of(monitor, "packet.delivered") if e["pid"] in flow and e["node"] == "DB-SRV"]
    assert delivered_to_db, "Monitor mode lets the connection through"
    actions = of(monitor, "ips.action")
    assert actions and all(a["action"] == "reject" and a["applied"] is False and a["mode"] == "monitor" for a in actions)
    assert not [e for e in of(monitor, "packet.dropped") if e["node"] == "IPS-1"]
    assert not [e for e in of(monitor, "packet.created") if e["flow"].endswith(":rst")]  # nothing injected


# -- the whole scenario --------------------------------------------------------------------------------


def test_alerts_and_incidents_are_the_same_in_both_modes_and_correlate_across_sensors(monitor, enforce) -> None:
    for result in (monitor, enforce):
        got = sorted((a["sensor"], a["rule"], a["src"], a["dst"]) for a in alerts(result))
        assert got == sorted([
            ("IDS-1", "D4", PC1, DB),
            ("IDS-1", "D5", LAPTOP, SEC),
            ("IDS-1", "D4", ADMIN, DB),
            ("IPS-1", "D4", ADMIN, DB),
        ])
        by_key = {}
        for a in alerts(result):
            by_key.setdefault((a["rule"], a["src"], a["dst"]), set()).add(a["incident_id"])
        assert all(len(ids) == 1 for ids in by_key.values())  # IDS-1 and IPS-1 share the incident for (d)
        assert len({next(iter(i)) for i in by_key.values()}) == 3
        assert result.stats.alerts == 4 and result.stats.incidents == 3


def test_enforce_statistics(enforce) -> None:
    s = enforce.stats
    # three denied SYNs + the rejected SYN are blocked; the injected RST is the only packet delivered.
    assert (s.data_packets, s.blocked, s.delivered_clean, s.delivered_flagged, s.other_drop) == (5, 4, 1, 0, 0)
    assert s.mirrored == 4  # SYN (a), SYN (b), SYN (d) and the injected RST each enter CORE-SW1
    reasons = sorted(e["reason"] for e in of(enforce, "packet.dropped"))
    assert reasons == ["acl_deny", "acl_deny", "fw_deny", "ips_reject"]


def test_monitor_statistics(monitor) -> None:
    s = monitor.stats
    assert s.blocked == 3  # (a), (b), (c) are still stopped by the static policy
    assert s.delivered_flagged > 0 and s.other_drop == 0
    assert s.data_packets == s.delivered_clean + s.delivered_flagged + s.blocked


def test_ids_1_never_drops_acts_or_blocks_anything(monitor, enforce) -> None:
    for result in (monitor, enforce):
        copies = {e["pid"] for e in of(result, "packet.created") if e["mirror_of"] is not None}
        for kind in ("packet.dropped", "inspect.result", "policy.decision"):
            for e in of(result, kind):
                if e["pid"] in copies:
                    assert kind == "inspect.result" and e["node"] == "IDS-1"  # the only thing that ever happens to a copy
        assert not [e for e in of(result, "packet.dropped") if e["node"] == "IDS-1"]
        assert not [e for e in of(result, "ips.action") if e["pid"] in copies]
        assert all(e["pid"] not in copies for e in of(result, "ips.action"))
        assert all(e["rule"] != "allowlist" for e in of(result, "ips.action"))
