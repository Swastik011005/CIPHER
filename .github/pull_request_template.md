## What and why

<!-- What does this change, and why? Link the issue or plan item if there is one. -->

## Target branch

- [ ] This pull request targets `develop` (only the maintainer promotes `develop` to `main`).

## Checks I ran (paste the real results, do not tick a box you did not run)

- [ ] `python scripts/tasks.py verify` passed. Backend: ___ passed. Frontend: ___ passed. Scenario checks: ___ of ___. Build: ok / failed.
- [ ] Scenario trace hashes from `python scripts/run_scenario_checks.py` are identical to `develop` (required for visual, tooling and deployment changes).
- [ ] For 3D or UI changes: I looked at the scene in a real browser and the console shows no errors. Frame rate notes: ___
- [ ] I did not run something I am claiming; anything not run is listed below as **not verified**.

## Frozen contracts

- [ ] This change does not touch the topology, the IDS/IPS roles or logic, the packet simulation, the playback engine or the trace schema.
  <!-- If it does, link the maintainer's approval. -->

## Security and privacy

- [ ] No secrets, tokens, `.env` files or personal data are included.
- [ ] The backend still binds to loopback by default.

## Not verified / known issues

<!-- Be specific. -->
