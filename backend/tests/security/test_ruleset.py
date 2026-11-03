"""The rule store: what may be edited, the limits, atomic edits, restricted addresses and the digest."""

from __future__ import annotations

import pytest

from netsec.security.ruleset import LIMITS, MAX_RESTRICTED_IPS, RuleError, RuleSet, RuleStore, policy_view


def problems_of(call) -> list[str]:
    with pytest.raises(RuleError) as info:
        call()
    return info.value.problems


@pytest.fixture
def store() -> RuleStore:
    return RuleStore()


def test_a_new_store_holds_the_shipped_rules_and_is_not_customised(store) -> None:
    assert store.current == RuleSet.shipped()
    assert not store.customised and store.revision == 0
    assert [d for d in ("D1", "D2", "D3", "D4", "D5", "D6")] == list(LIMITS)
    assert store.current.restricted_ips == ["203.0.113.99"]


# -- detectors ------------------------------------------------------------------------------------------


def test_enabling_disabling_and_changing_thresholds_is_reported_and_applied(store) -> None:
    changes = store.update_detectors({"D1": {"enabled": False, "suspicious": 4, "violation": 8}, "D3": {"suspicious_pps": 30}})
    assert {(c["detector"], c["field"], c["from"], c["to"]) for c in changes} == {
        ("D1", "enabled", True, False), ("D1", "suspicious", 6, 4), ("D1", "violation", 12, 8), ("D3", "suspicious_pps", 25.0, 30),
    }
    d = store.current.detectors
    assert (d.D1.enabled, d.D1.suspicious, d.D1.violation, d.D3.suspicious_pps) == (False, 4, 8, 30)
    assert d.D2 == RuleSet.shipped().detectors.D2  # untouched detectors stay as shipped
    assert store.customised and store.revision == 1


def test_a_change_to_the_value_it_already_has_is_not_a_change(store) -> None:
    assert store.update_detectors({"D1": {"enabled": True, "suspicious": 6}}) == []
    assert store.revision == 0 and not store.customised


def test_the_shipped_files_are_never_modified_by_an_edit(store) -> None:
    store.update_detectors({"D1": {"enabled": False}})
    assert RuleSet.shipped().detectors.D1.enabled is True
    assert store.defaults.detectors.D1.enabled is True


@pytest.mark.parametrize(
    ("patch", "fragment"),
    [
        ({"D9": {"enabled": False}}, "no such detector"),
        ({"D1": {}}, "at least one field"),
        ({"D1": {"colour": 3}}, "cannot be edited"),
        ({"D1": {"enabled": "yes"}}, "true or false"),
        ({"D1": {"enabled": 1}}, "true or false"),
        ({"D1": {"suspicious": 1}}, "from 2 to 50"),
        ({"D1": {"suspicious": 5.5}}, "whole number"),
        ({"D1": {"violation": 101}}, "from 3 to 100"),
        ({"D1": {"window_s": 0}}, "from 1 to 60"),
        ({"D1": {"window_s": True}}, "a number"),
        ({"D1": {"suppression_s": -1}}, "from 0 to 300"),
        ({"D2": {"ports": []}}, "1 to 10 different"),
        ({"D2": {"ports": [22, 22]}}, "1 to 10 different"),
        ({"D2": {"ports": [0]}}, "1 to 10 different"),
        ({"D2": {"ports": [70000]}}, "1 to 10 different"),
        ({"D2": {"ports": "22"}}, "1 to 10 different"),
        ({"D3": {"violation_pps": 5000}}, "from 2 to 1000"),
        ({"D6": {"signatures": []}}, "choose one or more"),
        ({"D6": {"signatures": ["bogus"]}}, "choose one or more"),
        ({"D4": {"services": []}}, "cannot be edited"),
        ({"D5": {"pairs": []}}, "cannot be edited"),
    ],
)
def test_invalid_detector_edits_are_refused_with_a_message_naming_the_field(store, patch, fragment) -> None:
    problems = problems_of(lambda: store.update_detectors(patch))
    assert any(fragment in p for p in problems), problems
    assert store.revision == 0 and not store.customised  # and nothing was applied


def test_thresholds_must_stay_in_order(store) -> None:
    assert any("suspicious" in p for p in problems_of(lambda: store.update_detectors({"D1": {"suspicious": 20}})))  # 20 >= 12
    assert any("suspicious_pps" in p for p in problems_of(lambda: store.update_detectors({"D3": {"suspicious_pps": 60}})))  # 60 >= 50
    store.update_detectors({"D1": {"suspicious": 20, "violation": 30}})  # together they are fine
    assert (store.current.detectors.D1.suspicious, store.current.detectors.D1.violation) == (20, 30)


def test_an_edit_with_one_bad_part_applies_none_of_it(store) -> None:
    problems = problems_of(lambda: store.update_detectors({"D1": {"enabled": False}, "D2": {"suspicious": 1}}))
    assert len(problems) == 1 and store.current.detectors.D1.enabled is True and store.revision == 0


def test_every_problem_is_listed_not_just_the_first(store) -> None:
    problems = problems_of(lambda: store.update_detectors({"D1": {"suspicious": 1, "violation": 500}, "D9": {"enabled": True}}))
    assert len(problems) == 3


def test_list_fields_can_be_edited(store) -> None:
    store.update_detectors({"D2": {"ports": [22, 2222]}, "D6": {"signatures": ["null", "xmas"]}})
    assert store.current.detectors.D2.ports == [22, 2222] and store.current.detectors.D6.signatures == ["null", "xmas"]


# -- restricted addresses -----------------------------------------------------------------------------------


def test_restricted_addresses_are_replaced_sorted_and_deduplicated_by_value(store) -> None:
    assert store.set_restricted_ips(["203.0.113.66", " 198.51.100.7 ", "203.0.113.99"]) == ["198.51.100.7", "203.0.113.66", "203.0.113.99"]
    assert store.current.restricted_ips == ["198.51.100.7", "203.0.113.66", "203.0.113.99"]
    assert store.revision == 1
    assert store.set_restricted_ips(["198.51.100.7", "203.0.113.66", "203.0.113.99"]) == ["198.51.100.7", "203.0.113.66", "203.0.113.99"]
    assert store.revision == 1  # no change, no new revision
    assert store.set_restricted_ips([]) == [] and store.current.restricted_ips == []  # clearing the list is allowed


@pytest.mark.parametrize(
    ("addresses", "fragment"),
    [
        (["not an ip"], "not an IPv4 address"),
        (["203.0.113.999"], "not an IPv4 address"),
        (["203.0.113.5/24"], "not an IPv4 address"),
        ([""], "not an IPv4 address"),
        ([5], "not an IPv4 address"),
        (["203.0.113.5", "203.0.113.5"], "listed twice"),
        (["127.0.0.1"], "not an address a host can send from"),
        (["224.0.0.1"], "not an address a host can send from"),
        (["0.0.0.0"], "not an address a host can send from"),
        (["255.255.255.255"], "not an address a host can send from"),
        (["10.0.10.11"], "inside the campus"),
        (["10.0.99.20"], "inside the campus"),
        ([f"198.51.100.{i}" for i in range(1, MAX_RESTRICTED_IPS + 2)], "at most"),
    ],
)
def test_bad_restricted_addresses_are_refused_and_change_nothing(store, addresses, fragment) -> None:
    problems = problems_of(lambda: store.set_restricted_ips(addresses))
    assert any(fragment in p for p in problems), problems
    assert store.current.restricted_ips == ["203.0.113.99"] and store.revision == 0


def test_a_restricted_list_that_is_not_a_list_is_refused(store) -> None:
    assert problems_of(lambda: store.set_restricted_ips("203.0.113.5"))  # type: ignore[arg-type]


# -- reset and digest ---------------------------------------------------------------------------------------


def test_reset_returns_to_the_shipped_rules_and_the_digest_comes_back(store) -> None:
    before = store.current.digest()
    store.update_detectors({"D1": {"enabled": False}})
    store.set_restricted_ips(["198.51.100.7"])
    assert store.current.digest() != before and store.customised
    assert store.reset() is True
    assert store.current.digest() == before and not store.customised
    assert store.reset() is False  # nothing left to reset


def test_the_digest_depends_on_every_kind_of_rule_and_is_stable(store) -> None:
    base = store.current.digest()
    assert RuleSet.shipped().digest() == base and len(base) == 12
    digests = {base}
    for edit in (
        lambda s: s.update_detectors({"D1": {"suspicious": 7}}),
        lambda s: s.update_detectors({"D6": {"enabled": False}}),
        lambda s: s.set_restricted_ips(["198.51.100.7"]),
    ):
        fresh = RuleStore()
        edit(fresh)
        digests.add(fresh.current.digest())
    assert len(digests) == 4


def test_policies_are_shown_with_their_rule_ids_and_the_implicit_deny() -> None:
    views = {p["name"]: p for p in (policy_view(p) for f in RuleSet.shipped().policies for p in f.policies)}
    assert set(views) == {"OUTSIDE-IN", "INSIDE-OUT", "STAFF-IN"}
    assert [r["id"] for r in views["STAFF-IN"]["rules"]] == ["10", "20", "100"]
    assert views["OUTSIDE-IN"]["implicit_deny"]["action"] == "deny" and views["OUTSIDE-IN"]["stateful"] is True
    assert views["STAFF-IN"]["node"] == "CORE-SW1" and views["OUTSIDE-IN"]["node"] == "FW1"
