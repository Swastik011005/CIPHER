"""Synthetic host behaviour: how servers answer, and what clients do next."""

from __future__ import annotations

import random

from netsec.sim.events import IcmpInfo
from netsec.traffic.flows import TcpSessionFlow
from netsec.traffic.host_stack import HostStack
from netsec.traffic.packet import Packet, tcp_flags


def _packet(**overrides) -> Packet:
    base = dict(
        pid=1, flow="t", proto="tcp", src="10.0.10.11", dst="10.0.30.10", sport=50000, dport=443,
        flags=tcp_flags("SYN"), ttl=64, length=44, seq=1000, ack=0, icmp=None, app=None,
    )
    base.update(overrides)
    return Packet(**base)


def _server(graph, node_id: str = "APP-SRV") -> HostStack:
    node = graph.node(node_id)
    return HostStack(node, graph.interface(node_id, "eth0").ip, random.Random(7))


def test_syn_to_an_open_port_gets_syn_ack(graph) -> None:
    (reply,) = _server(graph).handle(_packet(dport=443))
    assert reply.flags == ("SYN", "ACK")
    assert (reply.src, reply.dst, reply.sport, reply.dport) == ("10.0.30.10", "10.0.10.11", 443, 50000)
    assert reply.ack == 1001  # client ISN + 1


def test_syn_to_a_closed_port_gets_rst_ack(graph) -> None:
    (reply,) = _server(graph).handle(_packet(dport=9999))
    assert reply.flags == ("ACK", "RST")
    assert reply.ack == 1001


def test_scan_distinguishes_open_and_closed_ports(graph) -> None:
    server = _server(graph)
    answers = {port: server.handle(_packet(dport=port))[0].flags for port in (22, 80, 443, 8080, 21, 25, 3306)}
    assert all(answers[p] == ("SYN", "ACK") for p in (22, 80, 443, 8080))
    assert all(answers[p] == ("ACK", "RST") for p in (21, 25, 3306))  # 3306 is DB-SRV's, closed here


def test_icmp_echo_request_gets_matching_echo_reply(graph) -> None:
    request = _packet(
        proto="icmp", sport=None, dport=None, flags=(), length=60,
        icmp=IcmpInfo(type=8, code=0, id=77, seq=3),
    )
    (reply,) = _server(graph).handle(request)
    assert reply.proto == "icmp" and reply.icmp == IcmpInfo(type=0, code=0, id=77, seq=3)
    assert (reply.src, reply.dst) == ("10.0.30.10", "10.0.10.11")


def test_udp_to_a_closed_port_gets_port_unreachable(graph) -> None:
    (reply,) = _server(graph).handle(_packet(proto="udp", dport=5555, flags=(), length=60))
    assert reply.proto == "icmp" and (reply.icmp.type, reply.icmp.code) == (3, 3)


def test_udp_to_an_open_port_is_consumed_silently(graph) -> None:
    syslog = _server(graph, "SEC-LOG")
    assert syslog.handle(_packet(proto="udp", dst="10.0.99.20", dport=514, flags=(), length=120)) == []


def test_established_connection_answers_data_then_fin(graph) -> None:
    server = _server(graph)
    (syn_ack,) = server.handle(_packet(dport=443, seq=1000))
    isn_s = syn_ack.seq
    assert server.handle(_packet(flags=tcp_flags("ACK"), length=40, seq=1001, ack=isn_s + 1)) == []

    (data,) = server.handle(
        _packet(flags=tcp_flags("PSH", "ACK"), length=40 + 520, seq=1001, ack=isn_s + 1)
    )
    assert data.flags == ("ACK", "PSH") and data.length == 40 + 1400  # HTTPS response size
    assert data.seq == isn_s + 1 and data.ack == 1001 + 520

    (fin,) = server.handle(_packet(flags=tcp_flags("FIN", "ACK"), length=40, seq=1521, ack=data.seq + 1400))
    assert fin.flags == ("ACK", "FIN") and fin.ack == 1522


def test_data_without_a_connection_is_reset(graph) -> None:
    (reply,) = _server(graph).handle(_packet(flags=tcp_flags("PSH", "ACK"), length=100, seq=5))
    assert "RST" in reply.flags


def test_tcp_client_walks_the_whole_session(graph) -> None:
    service = next(s for s in graph.node("APP-SRV").services if s.port == 443)
    flow = TcpSessionFlow("F", "10.0.10.11", "10.0.30.10", 443, service, 520, 50000, 1000)
    client = HostStack(graph.node("PC-1"), "10.0.10.11", random.Random(1))
    client.add_flow(flow)
    server = _server(graph)

    ((_, syn),) = flow.initial()
    assert syn.flags == ("SYN",) and syn.seq == 1000

    def deliver(spec, to: HostStack) -> list:
        pkt = Packet(
            pid=1, flow=spec.flow, proto=spec.proto, src=spec.src, dst=spec.dst, sport=spec.sport,
            dport=spec.dport, flags=spec.flags, ttl=64, length=spec.length, seq=spec.seq,
            ack=spec.ack, icmp=spec.icmp, app=spec.app,
        )
        return to.handle(pkt)

    (syn_ack,) = deliver(syn, server)
    ack, request = deliver(syn_ack, client)
    assert ack.flags == ("ACK",) and request.flags == ("ACK", "PSH") and request.app.encrypted
    assert deliver(ack, server) == []
    (response,) = deliver(request, server)
    (fin,) = deliver(response, client)
    assert fin.flags == ("ACK", "FIN")
    (server_fin,) = deliver(fin, server)
    (last_ack,) = deliver(server_fin, client)
    assert last_ack.flags == ("ACK",) and flow.state == "closed"


def test_tcp_client_stops_on_reset(graph) -> None:
    flow = TcpSessionFlow("F", "10.0.10.11", "10.0.30.10", 9999, None, 100, 50000, 1000)
    flow.initial()
    rst = _packet(
        src="10.0.30.10", dst="10.0.10.11", sport=9999, dport=50000, flags=tcp_flags("RST", "ACK"),
        length=40,
    )
    assert flow.matches(rst) and flow.on_packet(rst) == [] and flow.state == "closed"
