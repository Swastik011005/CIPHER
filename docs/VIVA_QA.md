# Viva question bank

Answers describe **what is implemented**. Where the textbook answer is bigger than our project, the answer says so. Numbers
come from the shipped configuration (`backend/config/`) and from `docs/SECURITY_ENGINE.md` and `docs/NETWORK_TOPOLOGY.md`.

---

## A. The project in one minute
**Q. What is this project?**
A simulation of a small campus network with a firewall, a passive IDS and an inline IPS. A Python engine decides what happens to
every packet and records a time-stamped trace; a browser app replays the trace in 3D. It shows who can detect, who can prevent,
and why those are different jobs. Everything is synthetic; nothing touches a real network.

**Q. Why simulate instead of using real tools?**
Repeatability and safety. A simulation gives the same result every time (same seed, same trace), lets us show every packet's
decision, and cannot harm a network. The cost: it is our model of the concepts, not Snort or Cisco IOS, and we do not claim real-product behaviour.

**Q. What is the difference between IDS and IPS?**
An IDS watches a *copy* of traffic and raises alerts; it is not in the path, so it cannot stop anything. An IPS sits *in the path*, so it can drop, reject, rate-limit or block, but a fault or false positive in it affects live traffic. In our network IDS-1 only ever alerts; IPS-1 is the only sensor that enforces on a detection.

**Q. Where does the firewall fit?**
FW1 is a stateful firewall between R1-EDGE and the core. It decides by address, protocol and port and tracks connections. It cannot see behaviour, for example a port scan against a service it permits. That gap is why the sensors exist.

---

## B. Network topology, VLANs, subnets, routing
**Q. Describe the topology.**
17 nodes: 16 devices plus an abstract Internet segment (`INET`), joined by 18 links (L01 to L18), in 7 zones (outside, perimeter, core, Staff, Admin, Security Ops, Server room). Path inward: EXT hosts, INET, R1-EDGE, FW1, CORE-SW1; CORE-SW1 connects the access switch ACC-SW2 (Staff and Admin PCs), the security network (IDS-1, SEC-LOG) and, through IPS-1, the server switch SRV-SW3 with APP-SRV and DB-SRV.

**Q. Which VLANs and subnets are there?**
VLAN 10 Staff 10.0.10.0/24, VLAN 20 Admin 10.0.20.0/24, VLAN 30 Servers 10.0.30.0/24, VLAN 99 Security 10.0.99.0/24. Three more routed subnets are outside any VLAN: 203.0.113.0/24 (outside; a documentation range, RFC 5737), 10.255.0.0/30 (R1-EDGE to FW1) and 10.255.1.0/30 (FW1 to CORE-SW1). That is 4 VLAN subnets plus 3 routed = **7 subnets**.

**Q. What does the trunk carry?**
Link L06 between CORE-SW1 and ACC-SW2 is an 802.1Q trunk carrying VLANs 10 and 20 only. Packets on it carry the VLAN tag; the packet inspector shows VLAN 10 on the first hops and VLAN 30 on the server side.

**Q. How is inter-VLAN traffic routed?**
CORE-SW1 is a layer-3 switch with an address on every VLAN (the `.1` of each subnet, a switched virtual interface). Hosts use it as default gateway. It routes between VLANs and sends everything else towards FW1.

**Q. What routes exist?**
Static only, longest-prefix match. R1-EDGE: `10.0.0.0/8` via 10.255.0.2 (FW1). FW1: default via 10.255.0.1 (R1-EDGE) and `10.0.0.0/16` via 10.255.1.2 (CORE-SW1). CORE-SW1: default via 10.255.1.1 (FW1). No routing protocol is simulated.

**Q. What is TTL and where does it change in the simulation?**
Time to live, a hop limit that stops loops. Packets start at 64 and are decremented once per *routed* hop; in the S1 path PC-1 to APP-SRV the only routed hop is CORE-SW1, so TTL goes 64 to 63 there (layer-2 switches and the transparent IPS do not change it). A packet reaching 0 is dropped as `ttl_expired`.

**Q. What is a SPAN port, and what does yours copy?**
Switched Port Analyzer: the switch duplicates traffic to a monitoring port. Here CORE-SW1 copies every packet *entering* the switch (ingress) to IDS-1 over link L11, excluding VLAN 99. The copy is taken **before** the ACL, so IDS-1 sees attempts that the ACL then denies. Blind spots: traffic that never enters CORE-SW1 (for example PC-1 to PC-2 inside one VLAN, or anything FW1 drops before the core) is invisible to the IDS.

**Q. Why is IPS-1 a "transparent bridge"?**
It sits between CORE-SW1 and SRV-SW3 in VLAN 30 without being a routed hop: it has no IP on its data ports (management address 10.0.99.11), so no addressing or routes change and the TTL is untouched, yet all server traffic physically passes through it.

---

## C. Firewall and ACLs
**Q. What is the difference between FW1's policy and the core ACL?**
FW1 is stateful (connection tracking lets replies back in) and guards the outside boundary. The ACL `STAFF-IN` on CORE-SW1 is a stateless packet filter on the Staff VLAN's ingress: it denies Staff to DB-SRV:3306 (rule STAFF-IN:10) and Staff to the Security network (STAFF-IN:20). FW1 has an ordered rule list ending in an implicit deny.

**Q. What is the implicit deny?**
The last, unwritten rule: anything not explicitly permitted is dropped. You can see its hits as `OUTSIDE-IN:implicit-deny` on the Rules page (S3 case c).

**Q. What is "stateful"?**
The firewall remembers connections it allowed, so return traffic is permitted without a rule of its own. In the simulation, conntrack has no timeouts (a documented simplification).

**Q. Why does S3 case (d) get past the ACL but still fail?**
The admin PC is not subject to the Staff ACL, so its SYN to the database reaches IPS-1. IPS-1 detects a connection to MySQL from a source other than APP-SRV (D4), drops the SYN and injects a TCP RST made to look like it came from the database. That is defence in depth: a second, independent control.

---

## D. IDS, IPS and the detectors
**Q. List the detectors.**
| ID | Detects | Rule (shipped values) |
|---|---|---|
| D1 | Port scan | TCP SYN (no ACK) to distinct ports of one target within 10 s: 6 = MEDIUM, 12 = HIGH |
| D2 | Brute force | Connection attempts to ports 22, 23, 3389 from one source to one target within 30 s: 6 MEDIUM, 12 HIGH |
| D3 | Flood | Connection-starting packets per second averaged over 5 s: more than 25 = MEDIUM, more than 50 = HIGH |
| D4 | Restricted service | Any TCP packet to MySQL (DB-SRV:3306) from a source other than APP-SRV; HIGH on the first packet |
| D5 | Forbidden zone pair | Staff or Outside to the Security network; HIGH on the first packet |
| D6 | Invalid TCP flags | NULL, XMAS, SYN+FIN, SYN+RST, FIN+RST; HIGH on the first packet |

**Q. What are the IPS actions per detector?**
D1 HIGH: drop the packet and block the source 20 s. D2 HIGH: block 30 s. D3 MEDIUM: rate-limit with a token bucket; D3 HIGH: block 20 s. D4: reject (drop plus synthetic TCP RST). D5 and D6: drop. MEDIUM detections of D1 and D2 are alert-only. In Monitor mode nothing is applied; the IPS records "would block".

**Q. In what order does IPS-1 process a packet?**
1. Source in the block table? Drop. 2. Detectors observe the packet. 3. Look up the action for the worst finding. 4. Enforce (or, in Monitor, only record). 5. Forward unless dropped. Detection comes before enforcement so a rate limiter can never hide a flood from the detector. The infrastructure allowlist (the management network and transit subnets) is never blocked.

**Q. What is Monitor versus Enforce?**
Monitor: IPS-1 detects and records what it *would* do, packets continue (shown amber); useful for tuning without risk. Enforce: it acts. S2 shows both with identical traffic: same trace until the HIGH alert, then in Enforce 24 packets are dropped and the source is blocked for 20 s.

**Q. Explain the token bucket.**
A bucket holds up to 20 tokens (the burst), refilled at 10 tokens per second (the rate). Each packet needs one token; with none left it is dropped. A short burst up to 20 passes, a sustained flood is held to 10 packets per second. It is per source, so one attacker's flood does not take tokens from a legitimate user (all 24 of EXT-USR's packets in S4 are delivered).

**Q. What are false positives and false negatives here?**
A legitimate scanner or monitoring tool could look like D1 (mitigation: an allowlist, which we only have for infrastructure subnets). A slow scan (slower than the 10 s window) or one spread over many sources never reaches the threshold: a false negative, and it is covered by a test. Thresholds are the trade-off between the two.

**Q. Why does an IDS not block?**
It receives copies, so even if it wanted to it could not stop the original packets; blocking needs a device in the path. In the app the IDS verdict appears only on the violet mirror copy and the IDS-1 model, never on the original packet, and the interface never says "IDS blocked".

**Q. Can the IDS and IPS both alert on the same attack?**
Yes. Each sensor has its own state and records. Alerts about the same activity share an `incident_id`, so the Threat Centre merges them into one incident listing both sensors.

---

## E. Deterministic simulation and the trace
**Q. How does the simulation work?**
A discrete-event engine: packets and timers are events in a priority queue ordered by (time, sequence number). Time is integer microseconds. The engine runs the whole scenario and returns a trace, a list of events (`packet.created`, `packet.hop`, `policy.decision`, `alert.raised`, `ips.action`, `packet.dropped` and so on). The browser plays the trace; it never decides a packet's fate.

**Q. What does deterministic mean, and how is it tested?**
Same scenario, same seed, same rules gives the same trace, byte for byte. The trace carries a hash, and tests compare hashes of repeated runs. This is why the demo numbers are the same on every run and why `docs/DEMO_SCRIPT.md` can state exact expected counters.

**Q. What happens when I change the IPS mode or send traffic mid-run?**
The playhead time and the change are sent to the engine as a control event; it re-simulates the whole run, and everything before the playhead is identical (the "prefix-stable" property, tested). Controls and custom traffic are not part of the run's configuration hash.

**Q. Why no WebSocket?**
Not needed: the engine returns a finished trace; replay is local. This also makes seeking and scrubbing free and offline-capable (a loaded run still scrubs with the backend stopped).

**Q. What is in the configuration hash?**
Scenario, seed and the active rule set, so a trace states which rules it ran with. Rule edits change the hash; controls and injected traffic do not.

**Q. How do the counters stay consistent between pages?**
All pages derive counters from the same trace up to the playhead with one shared definition: every data packet ends in exactly one bucket (delivered clean, delivered flagged, blocked, other drop). Mirror copies and syslog are counted separately. Tests check the frontend's totals against the backend's end-of-run statistics.

---

## F. The scenarios
| Scenario | What it shows | End result (Enforce, shipped rules) |
|---|---|---|
| S1 | Normal day: HTTPS, ping, admin SSH, app to database | 30 packets, 30 clean, 0 alerts |
| S2 | PC-2 SYN scan, 4 ports per second | D1 MEDIUM at 6 ports, HIGH at 12; Monitor: 88 packets, 26 flagged, 0 blocked; Enforce: 62 packets, 24 blocked, block ends about 24.9 s |
| S3 | Four access violations | 5 packets, 4 blocked (2 ACL, 1 firewall, 1 IPS reject), 4 alerts |
| S4 | EXT-ATK flood on port 443, ramping 15, 40, 70 pps | rate limit then block; EXT-USR unaffected; 693 packets, 305 blocked |
| S5/S6 | S2 traffic pinned to Monitor / Enforce | identical until the HIGH alert |
| S7 | SSH brute force (D2) | D2 alerts, block 30 s |

(S2 and S4 figures are checked by the rehearsal; S7 is checked by the scenario checks.)

**Q. What are the "93 checks"?**
`scripts/run_scenario_checks.py` (also on the Rules page, "Run all checks") runs every scenario in every supported IPS mode (12 runs) and asserts the expectations each scenario declares (for example D1 fires at exactly 6 and 12 ports; IDS-1 never emits a drop, block or IPS action; the block lasts 20 s). 12 of 12 runs and 93 of 93 checks pass.

---

## G. Testing
**Q. How did you test it?**
Backend pytest (937 tests: topology, routing, policy, each detector's thresholds, scenarios across seeds, determinism and prefix stability, API contracts, rules validation), frontend Vitest (277 tests: player seeking equals sequential replay, counters equal the backend's statistics, panels, rules editor), the 93 scenario checks, a production build, plus a real-Chrome rehearsal of the demo (34 checks) and an offline-recovery test (8 checks). `scripts\verify.cmd` runs the first four in one command.

**Q. What did the testing find?**
For example, the offline test found that stopping the backend replaced the scenario list with an error and left the page unusable; fixed so the loaded run and the scenario list stay visible while the engine is offline.

**Q. Did you test on real hardware or a real network?**
No. The simulation is not connected to any real network, and the Packet Tracer lab was not built. Performance was measured on one laptop's Intel integrated GPU; the discrete-GPU target is unverified (`docs/LIMITATIONS.md`).

---

## H. Technology choices
**Q. Why this stack?**
Python (FastAPI) for the engine: readable, easy to test, and Scapy is available as a packet codec. React + Vite + Three.js (react-three-fiber) for the browser: a component UI and a 3D scene sharing one state store. REST only. All dependencies are installed once; the app then needs no internet. No machine learning, no database.

**Q. Where does Scapy come in?**
It is installed and used as a packet codec in tests; there is no PCAP export or hex view in the shipped app.

---

## I. Limitations and future scope
**Q. What does it not do?**
No real traffic; not a real IDS/IPS product; rule-based detection only; D3 has no half-open-connection condition; no D7 host-sweep; no Monitoring charts; no PCAP export; no follow-packet camera; no syslog packets; rules held in memory only and not editable mid-run; Packet Tracer lab not built. Full list: `docs/LIMITATIONS.md`.

**Q. How would you extend it?**
Add the Packet Tracer lab to compare against a real Cisco configuration (the app can already export the firewall/ACL tables as Cisco IOS text); add anomaly or ML-based detection beside the rules; add PCAP export; persistent run history; more detectors (host sweep); real packet capture as input.

**Q. Is the 55 fps RTX target met?**
Not claimed. Windows did not detect the RTX 4050 during the last measurement, so it was never measured. On the Intel integrated GPU the Low preset was 59 fps at 1350 x 673 and 31 fps at 1904 x 985 at the S4 peak.

**Q. Could this be used to protect a real network?**
No. It is a teaching and demonstration tool. The ideas (SPAN versus inline, thresholds, token bucket, defence in depth) transfer; the code does not.
