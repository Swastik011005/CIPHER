"""Run every scenario check with the shipped rules and print the result.

    python scripts/run_scenario_checks.py   (with the backend virtual environment's Python)

Each scenario runs in every IPS mode it supports (S5 and S6 are pinned to one) and its expected behaviour is
checked: the same checks the Rules & Scenarios page shows under "Run all checks". Exit code 0 only if all pass.
No server is needed; this runs the engine directly.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from netsec.analysis.expectations import run_checks  # noqa: E402
from netsec.network.topology import load_topology  # noqa: E402
from netsec.security.ruleset import RuleSet  # noqa: E402
from netsec.sim.engine import run_scenario  # noqa: E402
from netsec.traffic.scenarios import list_scenarios  # noqa: E402


def main() -> int:
    graph = load_topology()
    rules = RuleSet.shipped()
    runs = passed_runs = checks = passed_checks = 0
    for scenario in list_scenarios():
        for mode in [scenario.pinned_ips_mode] if scenario.pinned_ips_mode else ["monitor", "enforce"]:
            result = run_scenario(graph, scenario, ips_mode=mode, rules=rules)
            results = run_checks(scenario.id, mode, result)
            ok = all(c["passed"] for c in results)
            runs += 1
            passed_runs += ok
            checks += len(results)
            passed_checks += sum(c["passed"] for c in results)
            print(f"{'PASS' if ok else 'FAIL'}  {scenario.id} {mode:<8} {sum(c['passed'] for c in results)}/{len(results)} checks  trace {result.trace_hash[:12]}")
            for c in results:
                if not c["passed"]:
                    print(f"        FAILED: {c['description']} (expected {c['expected']}, actual {c['actual']})")
    print(f"\n{passed_runs}/{runs} runs pass, {passed_checks}/{checks} checks pass (rules {rules.digest()})")
    return 0 if passed_runs == runs else 1


if __name__ == "__main__":
    raise SystemExit(main())
