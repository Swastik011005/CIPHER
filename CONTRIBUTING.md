# Contributing to NetSec 3D

Thanks for helping. This project is a security simulation with a **frozen network design and frozen security behaviour**, so
the rules below are stricter than usual about what may change and how a change reaches `main`.

## Branches

| Branch | Purpose | Who may change it |
|---|---|---|
| `main` | Stable, tested, release-ready. Tagged releases (`v1.0`, ...) live here. | Only approved, tested merges from `develop`, made by the maintainer. Never pushed to directly. |
| `develop` | Integration branch for approved work. | Merged feature branches that passed every check. |
| `feature/<short-name>` | One feature or fix, branched from `develop`. | Its author. |

- **Never force-push** `main` or `develop`, and never rewrite published history.
- `main` and `develop` should be protected on GitHub (pull request required, status checks required, no force pushes).
  Branch protection is a repository setting the owner must switch on; it is **not** configured by files in this repository.

## Workflow

1. Branch from `develop`: `git switch -c feature/<short-name> develop`.
2. Make small commits with messages that say what changed and why.
3. Run the full check locally and read the summary: `python scripts/tasks.py verify`.
4. Open a pull request **into `develop`** and fill in the checklist in the template.
5. When the checks pass and a maintainer approves, the branch is merged into `develop`.
6. Promoting `develop` to `main` is a separate, explicit maintainer decision after the full check, a real-browser check and
   a review of what changed. It is tagged as a release.

## What a change must satisfy

- **Tests pass, and you ran them.** Backend tests, the scenario checks, frontend tests and the production build, as run by
  `python scripts/tasks.py verify`. Do not describe a check as passing unless you ran it.
- **Simulation results do not change** unless the change is explicitly about them. Scenario trace hashes printed by
  `python scripts/run_scenario_checks.py` must stay identical for visual, tooling and deployment work.
- **Frozen contracts need prior approval.** Do not change these in a feature branch without agreeing it first:
  - the topology (17 nodes, 18 links, 4 VLANs, addressing) in `backend/config/topology.json` and the validator;
  - the roles of IDS-1 (passive, alerts only) and IPS-1 (inline, the only enforcing sensor);
  - the packet simulation, detection and prevention logic, the playback engine and the trace event schema in `contracts/`.
- **New behaviour comes with tests**, in the existing style (pytest under `backend/tests`, Vitest next to the code).
- **Security and privacy:** no secrets, tokens, `.env` files or personal data in commits. The backend must stay loopback-only
  by default; making it reachable from outside needs an explicit production setting and a review.
- **Be honest in docs:** state what was measured and what was not (see `docs/LIMITATIONS.md`).

## Setting up

Python 3.12 or newer, Node.js 20.19 or newer. Then `python scripts/tasks.py setup`. See `docs/DEVELOPMENT.md` for the commands,
dependency files and continuous integration.

## AI-assisted work

Much of this repository was written with an AI coding assistant. That is fine, but the same rules apply: the person opening
the pull request is responsible for understanding the change, running the checks and describing the results accurately.
