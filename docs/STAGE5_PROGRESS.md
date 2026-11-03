# Stage 5 progress: advanced scenarios (honest status)

Scope (Rev 3, from Day 5): S4 excessive traffic with D3 and rate limiting; S7 SSH brute force (D2, optional); the data pages
at table level. Not started: the Rules editor, PCAP and hex export, Cisco IOS ACL export, follow-packet camera.

## Detectors
| Id | Detects | Fires when | Severity | IPS-1 action (Enforce) |
|---|---|---|---|---|
| D2 | Brute force on remote login | 6 / 12 connection attempts (SYN, no ACK) to ports 22, 23, 3389 from one source to one target in 30 s | MEDIUM / HIGH | MEDIUM alert only; HIGH block source 30 s |
| D3 | Excessive traffic | more than 25 / 50 connection-starting packets per second from one source to one target, averaged over 5 s (TCP SYN without ACK, UDP, ICMP; replies such as SYN-ACK are not counted) | MEDIUM / HIGH | MEDIUM rate limit 10 pps, burst 20; HIGH block source 20 s |
Simplification (Rev 3 fallback): the specification's "or more than 40 half-open connections" is not implemented; counting them needs
the replies on the sensor's path. D3 evidence is `count` packets in the window against `threshold` (125 for MEDIUM, 250 for HIGH).
D3 first counted every packet, which flagged the server's SYN-ACK replies as a second "flood" (a second incident); restricting it
to connection-starting packets keeps a flood one incident.

## Rate limiting
IPS-1 keeps a token bucket per source (10 tokens a second, 20 in a burst, simulation time). In the processing order
(block table, detectors, policy, enforce, forward) the detectors run first on every arriving packet, so the limiter cannot hide a
flood: a HIGH alert is raised on the true arrival rate even while packets are being dropped. Packets within the bucket pass without
any event; each packet over it is dropped (`rate_limited`, counted as blocked) with an `ips.action` `rate_limit` (`applied: true`).
Monitor records the same packets with `applied: false` (the bucket is modelled identically, refused packets take no tokens) and drops nothing.
Only the offending source is limited. IDS-1 has no limiter and never acts.

## Scenarios
- **S4** (44 s): EXT-USR browses over HTTPS three times; EXT-ATK floods APP-SRV:443 (a port FW1 publishes) with SYNs at 15 pps for 3 s,
  40 pps for 4 s, 70 pps for 4 s, then tries a session during the block (dropped) and after it (delivered). Enforce, seed 1: IDS-1
  MEDIUM at 9.93 s, IPS-1 MEDIUM at 10.11 s (limiting starts), IDS-1 HIGH at 13.60 s, IPS-1 HIGH at 13.78 s (block for 20 s, until 33.78 s).
  693 data packets: 305 blocked (141 `rate_limited`, 1 `ips_drop`, 163 `blocked_source`), 4 alerts, 1 incident. Monitor: 998 packets, none
  dropped, 4 alerts, 1 incident. EXT-USR's 24 packets are 100% delivered in both modes.
- **S7** (46 s): PC-2 opens an SSH session to APP-SRV every second for 14 seconds while PC-1 browses and an administrator logs in.
  D2 MEDIUM at the 6th attempt and HIGH at the 12th from both sensors; Enforce blocks PC-2 for 30 s (until 43.18 s), so the 13th and 14th
  attempts are dropped; Monitor lets every guess complete. Other users are untouched.
- New flow type `syn_flood` (phases of `rate` pps for `duration` s; each probe has its own source port; the attacker ignores replies).

## Frontend
- Effects: `ips-limit` ring (labelled "rate limit · D3"), "would rate-limit" in Monitor, plus **visual sampling** so a 70 pps flood
  cannot overflow the fixed pools: at most 12 delivery, 12 mirror, 10 allow, 10 flag, 6 limit and 4 sensor-ping effects alive at once, and one
  shard burst per 0.08 s for rate-limit and block-table drops. Quiet traces (S1, S3, S7) are not thinned at all; in S2 four shatters are
  sampled away; in S4 the ordinary user's own packets keep their pulses except a handful that land in the middle of the flood. Every
  packet is still counted, listed and inspectable. Pools: 64 rings, 12 shatters; instanced packets: 800 per shape (S4 peaks at about 400).
- Device labels: IPS-1 shows `N LIMITED` and `N DROPPED` separately; the device inspector adds a Rate-limited counter; the timeline marks where rate
  limiting starts (once), the block and its end; Threat Centre names D2 and D3 and lists "IPS rate limit" among why packets were stopped.
- **Monitoring page** (Rev 3 Day 5, table fallback; the charts are not built): the same eight counters as the Simulation panel, why packets were stopped,
  a device table (sent, received, delivered, dropped, permit/deny, alerts, status) and an event log (security, drops, deliveries, everything;
  the latest 80). All derived from the same reducer state, so they equal the Simulation counters at every moment and the engine's totals at the end.
- The scenario list shows S1 to S7 (from the engine); the "scenarios still to build" card is gone.
- Automatic fall-back to Low quality on a slow GPU (see `STAGE4_PROGRESS.md`).

## Tests
Backend: D2 and D3 thresholds, negatives and validation; token bucket; IPS rate limiting in both modes (burst, excess only, escalation to a
block, per-source, allowlist, custom rate); S4 (ramp rates, firewall permits, alerts MEDIUM then HIGH as one incident, limit-then-block order, about
ten packets a second through, detection before enforcement, 20 s block then recovery, ordinary user 100% delivered, Monitor drops nothing, IDS-1 passive,
five seeds, prefix stability when switching mode, D3 disabled); S7 (6th and 12th attempt, 30 s block, others unaffected, five seeds); S4 and S7 in the
five-seed matrix; S1 and S2 trace bodies still byte-identical to Stage 3.
Frontend: reducers equal `run.end` for all eight traces, S4 effects and sampling (pool and packet capacity at the peak, determinism, seek
equivalence), labels, markers, S7, the Low-quality rule and its store action, Monitoring KPIs, device table and log.

## Verified live (real backend)
S4 Enforce through the UI: trace hash `d832a063` equals the golden fixture; at T+9 s no alert and 0 blocked, at 12 s 2 alerts and 38 blocked (rate-limited),
at 16.5 s 4 alerts and 304 blocked, at the end 693 / 332 clean / 56 flagged / 305 blocked / 4 alerts / 1 incident = the engine's `run.end`.
S3 Enforce: the Monitoring page's KPIs equal the Simulation counters; its device rows and log match the trace.

## Performance
Measured in a normal Chrome window on the integrated GPU only; the RTX 4050 is not present in Windows, so the High-preset 55 fps target at the S4 peak is **not verified**.
See the table in `STAGE4_PROGRESS.md`: at the S4 peak Low runs at 35 to 38 fps and High at 16 fps on Intel UHD, with 235 to 250 draw calls and 81k to 101k triangles.
Most of the rendering cost is the High-preset post-processing (about 40 fps lost against Low on the same scene). The S4 Monitor peak, with about 400 packets on screen and 20k more triangles, costs a further 20 fps at Low (S2: 55 fps, S4 peak: 35 fps), which is still above the 30 fps target.
Reducer replay of the largest trace (16,278 events) takes 80 ms for a full seek, so scrubbing stays smooth.

## Open items
- 55 fps at High on the RTX 4050 (blocked: GPU not present).
- D3's half-open condition; Monitoring charts; the Rules editor; PCAP/hex and IOS exports (Rev 3 "advanced", not started).
- Free-running 3D playback of S4 was timed by the measurement script, not watched by a person; no screenshots are saved in the repository.
