"""Stage 3 vertical slice: PC-2 -> ACC-SW2 -> CORE-SW1 (+SPAN copy to IDS-1) -> IPS-1 -> SRV-SW3 -> APP-SRV.

The S2 scan packets are the slice's traffic. These tests pin the exact hops, VLAN tags, TTL and the
one-mirror-per-packet rule against the engine's own trace, in both IPS modes.
"""

from __future__ import annotations

from collections import Counter, defaultdict

import pytest

from netsec.sim.engine import run_scenario
from netsec.traffic.scenarios import load_scenario

PC2 = "10.0.10.12"
APP_SRV = "10.0.30.10"
SLICE_PATH = ["PC-2", "ACC-SW2", "CORE-SW1", "IPS-1", "SRV-SW3", "APP-SRV"]


@pytest.fixture(scope="module", params=["monitor", "enforce"])
def result(request, graph):
    return run_scenario(graph, load_scenario("S2"), ips_mode=request.param)


def of(result, kind):
    return [e for e in result.events if e["type"] == kind]


def hops_by_pid(result):
    out = defaultdict(list)
    for e in of(result, "packet.hop"):
        out[e["pid"]].append(e)
    return out


def delivered(result):
    return {e["pid"] for e in of(result, "packet.delivered")}


def test_every_scan_probe_that_reaches_the_server_takes_the_slice_path(result) -> None:
    probes = {
        e["pid"]
        for e in of(result, "packet.created")
        if e["src"] == PC2 and e["dst"] == APP_SRV and e["mirror_of"] is None
    }
    reached = probes & delivered(result)
    assert reached, "some probes must reach APP-SRV"
    hops = hops_by_pid(result)
    for pid in reached:
        path = [h["from"] for h in hops[pid]] + [hops[pid][-1]["to"]]
        assert path == SLICE_PATH
        assert [h["ttl"] for h in hops[pid]] == [64, 64, 63, 63, 63]
        assert [h["vlan"] for h in hops[pid]] == [10, 10, 30, 30, 30]
        assert hops[pid][1]["link"] == "L06"  # tagged VLAN 10 on the ACC-SW2 <-> CORE-SW1 trunk


def test_blocked_probes_stop_at_the_ips_after_the_same_prefix_of_the_path(result) -> None:
    drops = [e for e in of(result, "packet.dropped") if e["reason"] in ("ips_drop", "blocked_source")]
    hops = hops_by_pid(result)
    if result.ips_mode == "monitor":
        assert drops == []
        return
    assert drops
    for d in drops:
        assert d["node"] == "IPS-1"
        path = [h["from"] for h in hops[d["pid"]]] + [hops[d["pid"]][-1]["to"]]
        assert path == SLICE_PATH[:4]  # never beyond IPS-1


def test_each_packet_entering_the_core_has_exactly_one_mirror_copy(result) -> None:
    entering = Counter(e["pid"] for e in of(result, "packet.hop") if e["to"] == "CORE-SW1")
    mirrored = Counter(e["pid"] for e in of(result, "packet.mirrored"))
    assert mirrored == entering
    assert set(mirrored.values()) == {1}
    created = {e["pid"]: e for e in of(result, "packet.created")}
    copies = [e for e in created.values() if e["mirror_of"] is not None]
    assert len(copies) == len(of(result, "packet.mirrored"))
    assert all(created[c["mirror_of"]]["mirror_of"] is None for c in copies)


def test_mirror_copies_end_at_ids_1_and_are_never_dropped_or_acted_on(result) -> None:
    created = {e["pid"]: e for e in of(result, "packet.created")}
    copy_pids = {pid for pid, e in created.items() if e["mirror_of"] is not None}
    hops = hops_by_pid(result)
    for pid in copy_pids:
        assert [h["to"] for h in hops[pid]] == ["IDS-1"]
    assert {e["pid"] for e in of(result, "packet.delivered") if e["pid"] in copy_pids} == copy_pids
    assert not [e for e in of(result, "packet.dropped") if e["pid"] in copy_pids]
