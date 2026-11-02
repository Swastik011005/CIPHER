"""Identifiers for alerts and incidents.

IDS-1 and IPS-1 raise separate alert records (distinct ``alert_id``, own ``sensor``). Alerts that
describe the same activity, keyed by (rule, source, destination), share one ``incident_id``: the
unit counted as a threat.
"""

from __future__ import annotations


class Correlator:
    def __init__(self) -> None:
        self._alerts = 0
        self._incidents: dict[tuple[str, str, str], str] = {}

    def new_alert_id(self) -> str:
        self._alerts += 1
        return f"ALR-{self._alerts:04d}"

    def incident_for(self, rule: str, src: str, dst: str) -> str:
        key = (rule, src, dst)
        if key not in self._incidents:
            self._incidents[key] = f"INC-{len(self._incidents) + 1:04d}"
        return self._incidents[key]
