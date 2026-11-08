# Demo script (9 minutes 40 seconds)

Everything below was rehearsed with `node scripts/rehearse_demo.mjs` in a real Chrome window against demo mode (the single
process started by `scripts\start-demo.cmd`): **34 of 34 checks passed**, no request left 127.0.0.1 and there was no console
error. The rehearsal checks the *expected on-screen results* in this script; the narration times are a plan, not something the
script can measure. Screenshots of each step are in `docs/demo/`.

**Say once, at the start and again at the end:** *everything you see is a simulation with synthetic traffic. "Blocking" changes
the state of the simulation. Nothing is captured, scanned, sent or blocked on a real network.*

## Before you start (5 minutes, not part of the 9:40)
| Do | Check |
|---|---|
| Close other apps. Plug the laptop in. Windows power mode: best performance. | |
| Run `scripts\start-demo.cmd` (builds the frontend first if needed). A console window stays open. | The browser opens `http://127.0.0.1:8000/simulation`; the top-right says **Engine online**. |
| Press **F11** (full screen). Browser zoom 100%. Keep the window in front: a covered or minimised window is throttled by the browser and the 3D scene stops drawing. | The 3D campus is visible. |
| Press **Run** with S1 once and **Restart** (warms up shaders, so the first real run is smooth). | Counters show `0 alerts`. |
| Quality: leave it on **High** on a machine with a working discrete GPU. On the Intel-only laptop choose **View → Low** before you begin (the app also switches itself after 5 s under 25 fps and says so). | |
| Open this script on a second screen or on paper. | |

Controls used: **speed buttons** (0.25x to 2x) next to the play button; the **timeline** (drag or click); **Step** (skip to the next
event); the **Recent packets** list (click a packet); camera buttons at the top of the scene (or keys 1 to 6).

---

## 1. The problem and the three layers (0:00 to 0:50): Overview page
**Do:** open **Overview**. Point at the three cards.
**Say:** "A firewall decides by address and port, so it cannot see behaviour such as a port scan on an allowed service. An IDS watches
copies of traffic and raises alerts but cannot stop anything because it is not in the path. An IPS sits in the path, so it can drop,
reject, rate-limit or block. This project simulates all three on a small campus, and shows who is responsible for what."
**Expect:** hero text "See how traffic is inspected, detected and stopped", three cards Firewall / IDS / IPS, topology numbers 30 devices (16 original plus the 14-device campus extension), 32 links, 4 VLANs, 7 subnets.
**If it fails:** the page needs the engine for the topology numbers; check **Engine online** (see Recovery).

## 2. The 3D network (0:50 to 2:00): Simulation page
**Do:** open **Simulation**. Click the camera buttons in turn: **Perimeter** (firewall gate FW1), **Core** (CORE-SW1 and the dashed violet SPAN cable), **Server Room** (IPS-1 arch), **Security Ops** (IDS-1 radome, SEC-LOG). Click **IDS-1**, read the right panel, then click **IPS-1**.
**Say:** "Outside, an edge router and FW1. The core switch routes between four VLANs: Staff 10, Admin 20, Servers 30, Security 99. Every packet entering the core is copied over a SPAN port to IDS-1 (VLAN 99 excluded). IPS-1 is a transparent bridge in front of the servers, so server traffic physically passes through it. IDS-1 is passive: it only alerts. IPS-1 is the only device that can enforce on a detection. FW1 and the core ACL enforce static policy regardless."
**Expect:** IDS-1 panel: "Passive sensor ... never forwards, drops or blocks traffic"; IPS-1 panel: "Inline prevention point". Press **Esc** to deselect.
**If the scene is blank:** move the mouse over it or press a camera button (the browser draws only while it receives frames). Still blank: Recovery, "3D scene blank".

## 3. Normal traffic, S1 (2:00 to 2:50)
**Do:** in the **Run a scenario** card choose **S1**, IPS **Monitor**, press **Run**, set speed **2x**. When it has played to about 4 s, click a packet in **Recent packets** that goes PC-1 to 10.0.30.10 (the first TCP SYN).
**Say:** "A normal day: HTTPS from PC-1, a ping, an admin SSH session, an app-to-database query. Packets are white until an enforcement point decides; at IPS-1 they turn green. Every packet is one of delivered clean, delivered flagged, blocked or other drop."
**Expect:** the inspector shows hops PC-1 → ACC-SW2 → CORE-SW1 → IPS-1 → SRV-SW3 → APP-SRV, VLAN 10 on the first two hops then VLAN 30, TTL 64 then 63 after CORE-SW1 (the one routed hop), and "SPAN copy sent to IDS-1: #n". At the end (24 s): **30 packets, 30 clean, 0 flagged, 0 blocked, 0 alerts**.
**If it fails:** if **Run** is greyed out the engine is offline (Recovery). If packets do not move, press play.

## 4. Port scan, S2: Monitor then Enforce (2:50 to 4:40)
**Do (Monitor):** choose **S2**, IPS **Monitor**, **Run**, speed **2x**. Watch the radar pulse at IDS-1 and the label "D1". Use the timeline to stop at **3.3 s**, then **4.85 s**, then **12 s**.
**Say:** "PC-2 sends one SYN per port, four a second. At the sixth distinct port in ten seconds IDS-1 raises a MEDIUM D1 alert; at the twelfth, HIGH. IPS-1 detects it too, but in Monitor mode it only records what it would do: the packets turn amber and keep going."
**Expect:** 3.3 s: **1 alert**; 4.85 s: **3 alerts**; 12 s: 4 alerts, **0 blocked**, flagged climbing. End (46 s): **88 packets, 62 clean, 26 flagged, 0 blocked, 4 alerts, 1 incident**.
**Do (Enforce):** choose **Enforce**, **Run**, speed **2x**; stop at **5.1 s**, then **10 s**. At 10 s click a red packet in **Recent packets** (a "Dropped at IPS-1 (blocked_source)" line).
**Say:** "Same traffic, same seed, same trace until the HIGH alert. Now IPS-1 acts: it drops the triggering packet and blocks PC-2 for 20 seconds. Watch the red shatter at the arch and the BLOCKED label with a countdown. IDS-1 still only alerts; that is the difference between detection and prevention. It also happens in the same frame as the counter changes because both come from the same trace."
**Expect:** 5.1 s: 1 blocked; 10 s: PC-2 **BLOCKED** with seconds left, IPS-1 "ENFORCE · N DROPPED"; packet panel "Dropped at IPS-1 (blocked_source)", verdict Blocked. The block ends at about **24.9 s**. End: **62 packets, 32 clean, 6 flagged, 24 blocked, 4 alerts, 1 incident**.
**Optional (15 s):** drag the timeline back to 2 s and press **Monitor** under "From the playhead on". The run re-simulates from there with everything before the playhead unchanged; at the end **0 blocked**.
**If it fails:** if counters differ, you are not on a fresh run: press **Run** again (runs are deterministic: the same numbers every time).

## 5. Access control, S3 (4:40 to 5:40)
**Do:** choose **S3**, IPS **Enforce**, **Run**, speed **2x**. Stop at about **20.3 s** and click the small red packet that leaves IPS-1.
**Say:** "Four attempts to reach places policy forbids. (a) staff to the database: the core ACL denies it, rule STAFF-IN:10, and IDS-1 still saw it because the SPAN copy is taken before the ACL. (b) staff to the security network: STAFF-IN:20. (c) the outside attacker to the database: FW1 drops it, so no sensor ever sees it. (d) the admin PC is not subject to that ACL, so it reaches IPS-1, which rejects the connection: it drops the SYN and sends a TCP reset made up to look like it came from the database."
**Expect:** reset packet panel "**Injected by IPS-1**", source 10.0.30.20:3306, flags ACK+RST. End: **5 packets, 1 clean (the reset), 4 blocked, 4 alerts, 3 incidents**; rule ids STAFF-IN:10, STAFF-IN:20 and OUTSIDE-IN:implicit-deny visible on the Rules page hit counts.
**If it fails:** the 3D label "reject D4 · TCP reset" appears at IPS-1 for about a second at 20.2 s; if you miss it, press **Step**.

## 6. Excessive traffic, S4 (5:40 to 6:40)
**Do:** choose **S4**, **Enforce**, **Run**, speed **2x**. Stop at **8 s**, **12 s**, **16.5 s**, then let it finish (or jump to 44 s).
**Say:** "EXT-ATK floods a published web port, ramping 15, 40, then 70 packets a second; the firewall allows the port, so only the sensors can help. D3 counts connection-starting packets per second over five seconds: above 25 is MEDIUM, above 50 HIGH. On MEDIUM IPS-1 rate-limits the attacker to 10 packets a second with a token bucket; on HIGH it blocks the attacker for 20 seconds. The detector looks at every packet before the limiter, so limiting cannot hide the flood. EXT-USR keeps browsing normally."
**Expect:** 8 s: 0 alerts; 12 s: **2 alerts** and the label "rate limit · D3" with "N LIMITED" on IPS-1; 16.5 s: **4 alerts** and EXT-ATK BLOCKED. End: **693 packets, 332 clean, 56 flagged, 305 blocked, 4 alerts, 1 incident**; all 24 of EXT-USR's packets are delivered.
**If the scene gets slow** (many packets at the peak on an integrated GPU): switch to Low (View → Low); the numbers are unaffected.

## 7. Threat Centre and Monitoring (6:40 to 7:20)
**Do:** open **Threats**, then **Monitoring** (the S4 run is still loaded).
**Say:** "These pages show the same trace as the 3D scene, up to the playhead. The Threat Centre lists the alerts from both sensors, merged into incidents, and why packets were stopped. Monitoring shows the counters, a per-device table and the event log. They always equal the Simulation page."
**Expect:** Threats: D3 alerts from IDS-1 and IPS-1, chips "IPS rate limit", "IPS drop", "Blocked source". Monitoring: 693 packets, 305 blocked.

## 8. Custom traffic (7:20 to 8:10)
**Do:** back on **Simulation**: choose **S1**, **Run**, pause at **4.6 s**. In **Send traffic** press **Staff → DB:3306** then **Send at T+4.6 s**; play on or jump to 7.5 s; click **open packet** in "Injected into this run".
**Say:** "I can add my own traffic at the playhead. A staff PC tries to reach the database directly. The engine re-simulates with it; everything before the playhead is unchanged."
**Expect:** packet panel "**Dropped at CORE-SW1 (acl_deny)**", decision "CORE-SW1 denied it · **STAFF-IN:10**", path PC-1 → ACC-SW2 → CORE-SW1 (VLAN 10, TTL 64), a SPAN copy; counters **1 blocked, 1 alert** (IDS-1, D4 HIGH).

## 9. Rules and scenarios (8:10 to 9:15)
**Do:** open **Rules**. **Detection (IDS)**: switch **D1** off, **Apply** (banner "Applied 1 change"). **Scenarios & checks**: on the **S2** card press **Run check**. Press **Reset to shipped**, then **Run all checks**.
**Say:** "Rules live in the backend, are validated there, and are part of each run's hash, so a trace says which rules it ran with. With D1 off the port scan raises no alert and nothing is blocked, and the S2 check fails and says exactly why: expected 6 and 12, actual none. After reset, every scenario in every mode passes: 12 runs, 93 checks."
**Expect:** "Custom rules" chip; S2 check FAIL with "6, 12 / none"; after reset and Run all checks: **ALL PASS, 12 of 12 runs pass, 93 of 93 checks**.
**If a rule edit is refused:** the message names the field (for example "D1.suspicious: must be a whole number from 2 to 50"); that is the validation working.

## 10. Close (9:15 to 9:40)
**Say:** "To summarise: a deterministic engine decides every packet and writes a trace; the browser only replays it. IDS detects without being in the path; IPS enforces because it is. Limits: the traffic is synthetic; Packet Tracer is a separate, unbuilt lab; detection is rule-based (no machine learning); and I measured performance on an Intel integrated GPU, where the Low preset is smooth; the high-end GPU target was not measurable on this laptop."

---

## Short version (6 minutes)
Do sections 1, 2 (30 s), 4 (Enforce only), 5, 8, 9 (Run all checks only). Skip 3, 6 and 7.

## If time is cut during the live demo
Always keep: S2 Enforce (the block), S3 (the reset), and Run all checks (93 of 93).
