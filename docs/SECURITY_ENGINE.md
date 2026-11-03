# Security engine (Stage 2, extended in Stage 4)

All of this changes **simulation state only**. Nothing is captured, scanned or blocked on a real network.

## Who does what (frozen roles)
| Component | Position | Can it block? | What it produces |
|---|---|---|---|
| FW1 | routes between R1-EDGE and the core | yes, by static policy | `policy.decision`, drops `fw_deny` |
| CORE-SW1 ACL (STAFF-IN) | ingress of VLAN 10 on the trunk | yes, by static policy | `policy.decision`, drops `acl_deny` |
| IDS-1 | **passive**, fed by SPAN copies | **no** | `inspect.result` on the copy, `alert.raised` (sensor IDS-1) |
| IPS-1 | **inline**, transparent VLAN 30 bridge | yes, in Enforce mode | `inspect.result`, `alert.raised` (sensor IPS-1), `ips.action`, `block.added/expired`, drops |

FW1 and the ACL enforce regardless of the IPS mode. The SPAN copy is taken when a packet enters CORE-SW1, **before**
the ACL, so IDS-1 also sees attempts the ACL then denies. Traffic that never enters CORE-SW1 (PC-1 to PC-2, APP-SRV to
DB-SRV, or anything the firewall drops) is invisible to IDS-1; only traffic through IPS-1 can be prevented.

## IPS-1 processing order (per packet)
1. Is the source in the block table? Drop (`blocked_source`); detectors are not consulted.
2. Detectors observe the packet.
3. Look up the configured action for the most severe finding (`config/ips_policy.json`).
4. Enforce applies it (D1 HIGH: drop this packet and block the source for 20 s). Monitor only records it
   (`ips.action` with `applied: false`, packet forwarded).
5. Forward unless dropped. The allowlist (`10.0.99.0/24` and the transit subnets) is never blocked.

## D1: vertical port scan
Input: TCP SYN without ACK, per (source, target). Condition: distinct destination ports inside a 10 s sliding window.
6 distinct ports: MEDIUM (suspicious, alert only). 12: HIGH (malicious). Thresholds live in `config/detectors.json`.
One alert per (rule, source, target) per 30 s; escalation always alerts.
False positives: service discovery, monitoring tools (allowlist is the mitigation).
Limits: a scan slower than the window, or spread over many sources, never reaches the threshold (tested).
Each sensor keeps its own state and its own alert records. Alerts about the same activity share one `incident_id`.

## D4, D5, D6 (Stage 4)
D4 restricted service (any TCP packet to MySQL on DB-SRV from a source other than APP-SRV), D5 forbidden zone pair
(Staff or Outside to the Security network) and D6 invalid TCP flags (NULL, XMAS, SYN+FIN, SYN+RST, FIN+RST) are per-packet
checks: HIGH severity, no history, first packet fires. IPS-1 acts on them in Enforce mode: D4 reject, D5 and D6 drop.
Reject drops the packet and injects a synthetic TCP RST (flow `<flow>:rst`) spoofed as the server, back to the client.
IDS-1 sees the same traffic through its SPAN copies (taken before the ACL) and only alerts. Details: `STAGE4_PROGRESS.md`.

## D2, D3 and rate limiting (Stage 5)
D2 counts connection attempts to ports 22, 23 and 3389 per source and target (6 MEDIUM, 12 HIGH in 30 s; HIGH blocks 30 s). D3 counts
connection-starting packets per source and target (more than 25 pps MEDIUM, more than 50 pps HIGH, averaged over 5 s). IPS-1 answers a MEDIUM
flood with a token bucket (10 pps, burst 20) per source: packets within it pass untouched, packets over it are dropped (`rate_limited`); a HIGH flood
is blocked for 20 s. The detectors see every packet before the limiter, so limiting cannot hide a flood. Details: `STAGE5_PROGRESS.md`.

## Policy files
`config/policies/fw1.json` (OUTSIDE-IN, INSIDE-OUT, restricted addresses) and `core_acl.json` (STAFF-IN). Ordered rules,
first match wins, implicit deny at the end. Stateful policies remember permitted flows and permit their return traffic
(`rule_id` ends in `conntrack`). Connection tracking has no timeouts in this simulation.
Rule ids in events look like `STAFF-IN:10`, `OUTSIDE-IN:implicit-deny`.

## Playback (frontend)
`playback/reducers.js` folds events into UI state using the same counter definitions as the backend;
`playback/player.js` is a pure, deterministic player (play, pause, speed 0.25 to 2x, seek, step, restart).
`seek(t)` always equals the fold of every event with `event.t <= t`. One animation-frame loop
(`usePlaybackDriver`) advances it by real time; events are published to the UI in the frame they are applied and the
clock at 10 Hz. Packets are drawn from the player each frame (instanced meshes), never through React state.

## Not implemented yet (do not assume)
Detector D7 (host sweep, postponed by the specification), syslog packets, the Rules editor, PCAP export.
