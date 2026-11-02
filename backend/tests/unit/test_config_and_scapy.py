"""Runtime settings (loopback only) and the Scapy availability spike."""

from __future__ import annotations

import pytest

from netsec.config import ConfigError, load_settings


def test_defaults_bind_to_loopback_8000(tmp_path) -> None:
    settings = load_settings(env={}, dotenv_path=tmp_path / "missing.env")
    assert (settings.host, settings.port) == ("127.0.0.1", 8000)


def test_non_loopback_host_is_refused(tmp_path) -> None:
    for host in ("0.0.0.0", "192.168.1.5", "example.com"):
        with pytest.raises(ConfigError, match="loopback"):
            load_settings(env={"NETSEC_HOST": host}, dotenv_path=tmp_path / "x")


def test_port_must_be_a_valid_integer(tmp_path) -> None:
    with pytest.raises(ConfigError, match="integer"):
        load_settings(env={"NETSEC_PORT": "eight"}, dotenv_path=tmp_path / "x")
    with pytest.raises(ConfigError, match="between"):
        load_settings(env={"NETSEC_PORT": "70000"}, dotenv_path=tmp_path / "x")


def test_dotenv_is_read_and_real_environment_wins(tmp_path) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text("# comment\nNETSEC_PORT=9001\nNETSEC_LOG_LEVEL=DEBUG\n", encoding="utf-8")
    from_file = load_settings(env={}, dotenv_path=dotenv)
    assert (from_file.port, from_file.log_level) == (9001, "debug")
    overridden = load_settings(env={"NETSEC_PORT": "9002"}, dotenv_path=dotenv)
    assert overridden.port == 9002


def test_scapy_imports_and_round_trips_a_synthetic_packet_without_capture() -> None:
    """Spike: Scapy 2.8 on Python 3.13 can build and dissect packets with no Npcap or admin."""
    scapy_all = pytest.importorskip("scapy.all")
    packet = (
        scapy_all.IP(src="10.0.10.11", dst="10.0.30.10", ttl=63)
        / scapy_all.TCP(sport=50000, dport=443, flags="S", seq=1000)
    )
    parsed = scapy_all.IP(bytes(packet))
    assert (parsed.src, parsed.dst, parsed.ttl) == ("10.0.10.11", "10.0.30.10", 63)
    assert (parsed[scapy_all.TCP].dport, int(parsed[scapy_all.TCP].flags)) == (443, 0x02)
