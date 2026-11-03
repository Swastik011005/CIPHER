# Team, roles and contributions

This page deliberately does **not** attribute individual contributions that the repository cannot prove. Fill in the names
column yourselves before submission; the viva expects every member to explain every module (see "Explain-back" below).

## What the repository shows
- All 43 commits on `main` were made from one Git account (`git shortlog -sne`). The five-person split in the plan was organised as *tracks* (branches), and the branches `track/engine`, `track/3d`, `track/ui`, `track/qa-docs` and `track/network-pt` exist, but the commit history does not record which team member did what. A reviewer cannot learn individual contribution from Git here, so the table below is a **plan of ownership to be confirmed by the team**, not a record.
- The code, tests and documents of Stages 1 to 7 were prepared with an AI coding assistant (Claude Code) working on the team's instructions. The team is responsible for understanding and being able to explain all of it.

## Planned ownership (from the approved implementation plan; confirm and fill in)
| Track | Branch | Area | What a member of this track should be able to explain | Team member |
|---|---|---|---|---|
| Network and contracts | `track/network-pt` | Topology, addressing, VLANs, routes, policies; Packet Tracer lab (not built) | `docs/NETWORK_TOPOLOGY.md`: VLANs, subnets, routing, SPAN, TTL, ACL and firewall rules | ________ |
| Engine | `track/engine` | `backend/netsec`: simulation, routing, firewall/ACL, detectors D1 to D6, IPS, scenarios, API | `docs/SECURITY_ENGINE.md`, `docs/API_CONTRACTS.md`, determinism and the trace | ________ |
| 3D | `track/3d` | `frontend/src/scene`, `frontend/src/playback`: scene, devices, packets, effects, player | How the trace becomes motion; performance and quality presets | ________ |
| UI | `track/ui` | `frontend/src/pages`, `features`, `ui`, `state`, `api`: pages, panels, rules editor | The five pages, run controls, offline behaviour | ________ |
| QA, integration, documents | `track/qa-docs` | Tests, scripts, demo script, slides, viva material | `scripts/verify.cmd`, the 93 checks, the rehearsal, `docs/DEMO_SCRIPT.md`, the deck | ________ |

## Explain-back (do this before the viva)
Each member walks the others through one module in 10 minutes and answers questions on it, using `docs/VIVA_QA.md` as the
question bank. Suggested pairing so that everyone covers the whole path of one packet:

1. Topology and addressing: how PC-1 reaches APP-SRV (`docs/NETWORK_TOPOLOGY.md`).
2. Policy: which device drops what, and why (`docs/SECURITY_ENGINE.md`).
3. Detection and prevention: D1 to D6, thresholds, Monitor versus Enforce, token bucket.
4. Engine and trace: events, determinism, re-simulation from the playhead.
5. Front end: how the player replays the trace; what the counters mean.

## Suggested speaking split for the 9 slides
Slides 1 to 3 (problem, objectives, architecture), 4 to 5 (topology, technologies), 6 to 7 (IDS/IPS workflow, scenarios, with the live demo), 8 to 9 (results and testing, conclusion and future scope). Adjust to your team; this is a suggestion, not a record.
