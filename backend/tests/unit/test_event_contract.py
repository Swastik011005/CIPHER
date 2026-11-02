"""The backend event models must match the frozen contract in contracts/events.json."""

from __future__ import annotations

from netsec.sim.events import EVENT_MODELS, EVENT_TYPES, DropReason, IpsAction, Severity
from typing import get_args


def _wire_fields(model) -> list[str]:
    """Field names as they appear on the wire (aliases applied), minus base fields."""
    names = [f.alias or name for name, f in model.model_fields.items()]
    return [n for n in names if n not in ("seq", "t", "type")]


def test_event_types_match_the_contract(event_contract) -> None:
    assert set(EVENT_TYPES) == set(event_contract["events"])
    assert len(EVENT_TYPES) == 14


def test_each_event_model_has_exactly_the_contract_fields(event_contract) -> None:
    for event_type, fields in event_contract["events"].items():
        assert _wire_fields(EVENT_MODELS[event_type]) == fields, event_type


def test_base_fields_come_first_on_every_event(event_contract) -> None:
    for event_type, model in EVENT_MODELS.items():
        assert list(model.model_fields)[:3] == event_contract["base_fields"], event_type


def test_enums_match_the_contract(event_contract) -> None:
    enums = event_contract["enums"]
    assert list(get_args(DropReason)) == enums["drop_reason"]
    assert list(get_args(IpsAction)) == enums["ips_action"]
    assert list(get_args(Severity)) == enums["severity"]


def test_stage_1_emitted_events_are_a_subset_of_the_contract(event_contract) -> None:
    assert set(event_contract["emitted_in_stage_1"]) <= set(event_contract["events"])
    # Stage 1 emitted no security events; Stage 2 emits all but syslog.
    for later in ("alert.raised", "ips.action", "block.added", "inspect.result", "policy.decision"):
        assert later not in event_contract["emitted_in_stage_1"]
        assert later in event_contract["emitted_in_stage_2"]
    assert "syslog.sent" not in event_contract["emitted_in_stage_2"]


def test_alerts_carry_a_sensor_so_ids_and_ips_records_stay_separate(event_contract) -> None:
    assert event_contract["enums"]["sensor"] == ["IDS-1", "IPS-1"]
    assert "sensor" in event_contract["events"]["alert.raised"]
    assert "incident_id" in event_contract["events"]["alert.raised"]
