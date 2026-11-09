# CIPHER User Manual

CIPHER is a 3D simulation of a small company network (a "campus") and the security tools that protect it. You watch data packets travel along cables, and you see which device lets them through, raises an alarm, or stops them.

> **Everything in CIPHER is a simulation.** No real packet is sent, captured or blocked, and nothing you do can affect a real network. The firewall, IDS, IPS, Zero Trust, EDR and SIEM are simple, rule-based *models* of real ideas. They are **not** Cisco, Snort, Suricata or any real security product. The same scenario with the same settings always gives exactly the same result.

---

## 1. Quick start (five minutes)

1. Open the website and click **Simulation** in the left menu. A 3D campus appears.
2. In the right-hand panel find **The nine scenarios**, pick **7 · Compromised endpoint and EDR isolation**, leave **IPS mode** on **Enforce**, tick **Run the scripted operator action** and press **Run**.
3. Watch the packets move. Use the bar under the scene: play/pause, step, restart, speed (0.25× to 2×) and the timeline.
4. Click **Monitoring** to see counters and charts, and **Threats** to see alerts, incidents and the SIEM console. They show the same run, up to the point you have reached on the timeline.
5. Click **Rules** to see (and, on a local copy, change) the security rules, then run the scenario again to see what changed.

---

## 2. Key ideas in plain words

| Term | Meaning |
|---|---|
| **Packet** | A small piece of data sent over a network. |
| **VLAN** | A "virtual" separate network on shared hardware. CIPHER has 10 Staff, 20 Admin, 30 Servers and 99 Security. |
| **Zone** | A part of the campus drawn as one building (Staff Lab, Administration, Data Centre, Security Operations, Core, Gate, and the outside Internet). |
| **Alert** | A message saying "this looks suspicious". An alert does not stop anything by itself. |
| **Incident** | Alerts about the same attacker grouped into one story. |
| **Scenario** | A ready-made story (a scan, a blocked login, an infected PC...) that the simulation plays. |
| **Trace** | The recorded list of everything that happened in a run. The 3D scene, counters, charts and terminal all read this one list, so they always agree. |

---

## 3. The security tools and how they differ

| Tool | Where | What it does | Can it block? |
|---|---|---|---|
| **Firewall (FW1)** | Between the Internet router and the campus | Allows or denies traffic by address and port. Remembers connections ("stateful"), so replies to allowed requests get back in. | Yes |
| **ACL (CORE-SW1 "STAFF-IN")** | On the core switch, for Staff (VLAN 10) traffic | A short list of allow/deny rules checked in order. Does not remember connections ("stateless"). | Yes |
| **IDS (IDS-1)** | Beside the core switch | Receives *copies* of traffic and raises alerts. It is not in the path. | **No, never** |
| **IPS (IPS-1)** | In the path to the servers | Inspects traffic as it passes and can drop, reject, rate-limit or block it. | Yes, in **Enforce** mode |
| **Zero Trust (ZT-POLICY-1)** | Decides; CORE-SW1 enforces | Grants access to the Security network only if identity, role, device trust and an explicit permission all allow it. | Yes |
| **EDR (EDR-MGMT-1)** | Agents on PCs and servers | Reports a compromised device and lets an operator **isolate** it (cut it off). | Yes (isolation) |
| **SIEM (SIEM-1)** | Security network | Collects security events from the other tools and groups them into incidents. | No, it only collects and shows |

### Firewall vs ACL
Both allow or deny by address and port. The firewall guards the **edge** and keeps track of connections; the ACL guards **inside** the campus (here, between Staff and the sensitive servers) and checks every packet on its own. Example: the firewall refuses an outside attacker reaching the database; the ACL refuses a Staff PC reaching the database.

### IDS vs IPS
Think of a security camera (IDS) and a security guard at the door (IPS). The IDS sees a *copy* of the traffic, so the original packet always continues; it can only raise alerts. The IPS sits *in the path*, so it can stop the packet. In CIPHER the IDS never drops, rejects or blocks anything, and its verdict never changes a packet's colour.

### Monitor vs Enforce (IPS mode)
| Mode | What IPS-1 does |
|---|---|
| **Monitor** | Detects and raises alerts, and records what it *would* do, but **lets every packet through**. Use it to see an attack succeed or to test rules safely. |
| **Enforce** | Does what its rules say: blocks a scanning source, drops bad packets, rejects forbidden connections with a TCP reset, rate-limits a flood. Use it to see prevention work. |

You can switch the mode while a run is playing (**From the playhead on**). CIPHER re-simulates from that moment; everything before it stays exactly as it was. Scenarios **S5** and **S6** are fixed to Monitor and Enforce so you can compare the same attack side by side.

---

## 4. The website, page by page

The left menu has five pages and a **Collapse** button. The top bar always shows the topology status (31 nodes, 32 links, valid), the **Engine online/offline** light, and the badge **SIMULATION · synthetic traffic**.

### 4.1 Overview
A summary: the headline numbers (devices, links, VLANs, subnets), a one-line description of the Firewall, IDS and IPS layers, a table of zones with their VLANs and subnets, and the backend status. Two buttons open the 3D simulation and the network inventory (the Monitoring page).

### 4.2 Simulation (the main page)
The 3D campus is on the left; panels are on the right.

**Moving around the 3D scene**

| Do this | Result |
|---|---|
| Drag with the **left** button | Rotate |
| Drag with the **right** or **middle** button (wheel click) | Pan (slide the view up, down, left, right) |
| Mouse wheel | Zoom toward the cursor |
| Click a device, cable, packet or building | Select it and show its details on the right |
| Double-click a building | Fly to that zone |
| Double-click a device (or press **I**) | Open it in a separate 3D viewer |
| **1** to **6** | Camera presets: Overview, Perimeter, Staff LAN, Core, Server Room, Security Ops |
| **F** | Move the camera to the selected device |
| **R**, **Home** or **0** | Back to the overview |
| **Esc** | Clear the selection |

**View button** (top right of the scene): *Labels* (All / Selected / None), *Management cables* (Show / Hide), *Render quality* (**High**: shadows, ambient occlusion, bloom; **Low**: faster on weak graphics cards). If the frame rate stays low CIPHER switches to Low by itself and tells you; press **Back to High** to undo.

**Playback bar:** restart, play/pause (or replay), **step to the next event**, speed (0.25×, 0.5×, 1×, 2×), a timeline you can drag (small marks show alerts and blocks), and live counters: Packets, Clean, Flagged, Blocked, Alerts, Incidents.

**Right-hand panels (top to bottom)**

| Panel | What it is for |
|---|---|
| **Simulated campus** | Device, link, VLAN and subnet counts. |
| **Recent packets / Network devices** | Click a packet or a device to inspect it. |
| **Selected device / zone / cable / packet** | Details of whatever you clicked (see 4.2.2). |
| **The nine scenarios** | The nine presentation scenarios (see section 5). |
| **Baseline scenarios** | The seven original scenarios S1 to S7. |
| **Send traffic** | Add your own traffic to the run (see 5.4). |

#### 4.2.1 Reading the picture
- **Packets** are drawn as a capsule (TCP), sphere (UDP) or envelope (ping). TCP/UDP packets are white-blue until a device decides: **green** allowed, **amber** flagged by a sensor, **red** stopped. **Violet** small packets are the *copies* sent to IDS-1.
- **A ping is four coloured envelopes**, one at a time: cyan, purple, amber, green. Each keeps its colour on the way there and back. A **green tick** appears when it arrives, a **red cross** where it is stopped.
- **Cables** glow along the whole route of a packet on its way, with a bright pulse moving in the direction of travel. A cable tints amber or red while it carries flagged or blocked traffic; the dashed violet cable is the copy path to IDS-1.
- **Labels** show a device name and address. Tags appear when something happens: alert counts on IDS-1, **ENFORCE**/**MONITOR** on IPS-1, **COMPROMISED**, **BLOCKED**, **ISOLATED** on endpoints.
- **Monitoring screens** in the Security Operations building and elsewhere show live data from the loaded run (events, counters, endpoint status, run status).
- **Buildings, desks, cabinets, signs** are decoration only. The devices with labels are the real network devices.

#### 4.2.2 The detail panels
- **Device** — *Live at the playhead* (packets sent, received, dropped...), *Policy rules hit*, alerts, active IPS blocks, interfaces, services, and neighbours (click one to see its cable). Buttons: **Focus** (F), **Inspect in 3D** (I).
- **Endpoint (PC, laptop, server)** — three tabs: **Overview** (address, gateway, VLAN, zone, trust, current connections), **CLI** (terminal), **Security** (see 4.2.3).
- **Router, core switch, firewall** — **Overview** and a read-only **CLI** with `show` commands.
- **Zone** — the devices in that building; **Focus** flies the camera there.
- **Cable** — its two ends (device and interface), what kind of link it is and its VLAN.
- **Packet** — where it was created, every hop with its time, and every security decision about it (firewall, ACL, Zero Trust, IDS, IPS). A violet **SPAN copy** links back to the original packet.

#### 4.2.3 The endpoint terminal (CLI)
Select a PC, laptop or server → **CLI** tab. Type a command and press Enter (Up/Down arrows recall earlier commands).

| Command | What it does |
|---|---|
| `help` | Lists the commands. |
| `ipconfig` | Shows the address, mask, gateway, VLAN, device trust and EDR status. |
| `ping <address or name>` | Sends **four** echo requests, one after another. Example: `ping APP-SRV`. |
| `tracert <address or name>` | Shows the Layer 3 devices on the path and where it stopped. |
| `telnet <address> <port>` | Tries a TCP connection, e.g. `telnet DB-SRV 3306`. |
| `curl http://<address>[:port]` | Fetches a simulated web page. |
| `clear` | Clears the screen. |

Routers, the core switch and the firewall accept only read-only commands: `show ip interface brief`, `show interfaces`, `show ip route`, `show access-lists`, `show running-config`.

How a ping works: the first envelope travels along the real cables to the target and back; **only then** is its `Reply from ...` line printed; then the next envelope leaves. If a device stops one, that attempt shows a red cross, a time-out line, and (after the four attempts) the **reason** and the **enforcing device**. Tick **Replay the packets of a command in the 3D campus** to watch it; untick it to get the text at once. While a command is replaying, **Stop (Ctrl+C)** interrupts it and keeps what was already printed. The `time=` figure is synthetic.

An **isolated** endpoint cannot send anything: its commands fail at once with "this endpoint is ISOLATED by EDR. No packet was sent."

Commands always run with IPS-1 in Enforce mode. Commands are checked against a short list and never reach a real computer.

#### 4.2.4 The Security tab (endpoints)
| Control | What it does |
|---|---|
| **Isolate Endpoint** | Cuts the endpoint off from the network from the current moment of the run: it sends nothing, and packets to it are dropped. Other endpoints are not affected. |
| **Restore Endpoint** | Removes the isolation; permitted traffic works again. |
| **Device trust: Trusted / Restricted / Untrusted** | Zero Trust input. *Trusted*: normal. *Restricted*: only a few ports allowed (for an admin: the SIEM web port 443). *Untrusted*: no access to protected systems. |
| **User role: Staff / Admin / External** | The role Zero Trust uses. Only **Admin** has permissions on the Security systems. |
| **Explain access to** + **Explain** | Asks Zero Trust "would this device reach SIEM-1, EDR-MGMT-1, ZT-POLICY-1 or SEC-LOG?" and shows the answer with the factors it used. |
| **EDR alert history**, **SIEM events about this device** | What the EDR and the SIEM recorded for this device in the loaded run. |

On a shared (read-only) server these changes are disabled and a banner says so.

### 4.3 Monitoring
Counters and charts for the run you are playing, up to the timeline position. With no run loaded it shows the network inventory (devices and links).

| Item | Meaning |
|---|---|
| **Packets** | Data packets sent (copies to IDS-1 are not counted here). |
| **Delivered clean / flagged** | Arrived and never flagged / flagged by a sensor but let through (Monitor mode). |
| **Blocked** | Stopped by the firewall, the ACL or IPS-1. |
| **Other drops** | Lost for network reasons (TTL expired, no route). |
| **SPAN copies** | Copies sent to IDS-1. |
| **Alerts / Incidents** | Raw alert records / grouped threats. |

- **Traffic chart:** packets per second, stacked by outcome (green allowed, amber flagged, red blocked). The dashed vertical line is the timeline position. A tall red area means a lot was stopped.
- **Protocol mix:** TCP, UDP and ICMP (ping) share of the packets.
- **Top talkers:** the devices that sent the most packets (a scanner or flooder stands out).
- **Why packets were stopped:** one chip per reason (FW1 deny, ACL deny, IPS drop, IPS rate limit, IPS reject, Blocked source...).
- **Activity table:** per device sent/received/delivered/dropped, permit/deny counts, alerts and status tags. Click a row to open that device in 3D.
- **Event log:** newest first; filter **Security**, **Drops**, **Deliveries** or **Everything**.

### 4.4 Threats (Threat Centre)
- **Four counters:** Incidents, Alerts, Active blocks (sources IPS-1 is blocking now) and Packets blocked.
- **IDS-1 and IPS-1 cards:** reminds you what each can do (IDS: alerts only; IPS: can block) and how each is connected.
- **Detections so far:** a table of alerts: time, sensor (IDS-1 or IPS-1), severity (LOW/MEDIUM/HIGH), rule (D1 to D6), source, target, evidence and incident. Blocks show as chips with a countdown.
- **SIEM-1 event console:** *Incidents* (click one to filter), the *Event timeline*, and a detail view when you click an event (source component, time, device, reason, response, incident and which event of the trace it came from). **This run** shows the current run; **History** shows events from every run on this server.

### 4.5 Rules
Four tabs. Changes apply to the **next** run (not the one playing). A chip **custom rules** marks runs that used your changes; **Reset to shipped** restores everything. On a shared server the page is read-only; run CIPHER on your own computer to edit.

**Firewall & ACL** — shows the FW1 policies (`OUTSIDE-IN`, `INSIDE-OUT`) and the core ACL (`STAFF-IN`) as tables: rule number, **permit/deny**, protocol, source, destination, port, **hits in this run**, and meaning. Rules are checked top to bottom; the first match wins. The last row, **implicit deny**, is locked: anything not allowed is denied. You can edit one list here: **Restricted source addresses** (up to 20). FW1 denies any packet from these outside addresses before it checks anything else (rule `OUTSIDE-IN:10`). The tab can also show the same rules as **Cisco IOS configuration** (**Show IOS config**, **Copy**).

| Shipped rule | Effect |
|---|---|
| `OUTSIDE-IN` 20, 30 | Anyone outside may reach APP-SRV on HTTPS (443) and HTTP (80); nothing else gets in. |
| `INSIDE-OUT` 10–40 | Inside hosts may use HTTP, HTTPS, DNS (UDP 53) and ping to the outside. |
| `STAFF-IN` 10 | Staff may **not** reach the database (DB-SRV port 3306). |
| `STAFF-IN` 20 | Staff may **not** reach the Security network (10.0.99.0/24). |
| `STAFF-IN` 100 | Everything else inside is allowed. |

**Detection (IDS)** — six detector cards. Each has an **On/Off** switch and numbers you can change; **Apply** saves them (all or nothing), **Discard** undoes. Each field shows the shipped value and the allowed range. A detector gives **MEDIUM** (suspicious) and **HIGH** (violation) alerts. Both IDS-1 and IPS-1 use these detectors. **Turn a detector off** and neither sensor will raise that alert (and IPS-1 will not act on it). **Lower a threshold** and it triggers sooner (more alerts, more false alarms); **raise it** and it triggers later (attackers can do more before you notice). Each card also shows a MITRE ATT&CK reference label (the name of the attack technique it relates to).

| Detector | Detects | Settings you can change (shipped) |
|---|---|---|
| **D1 Port scan** | One source probing many different ports of one target | Window 10 s; MEDIUM at 6 distinct ports; HIGH at 12 |
| **D2 Brute force** | Repeated attempts on remote-login ports | Ports watched (22, 23, 3389; up to 10); window 30 s; MEDIUM at 6 attempts; HIGH at 12 |
| **D3 Flood** | A source starting connections too fast | Window 5 s; MEDIUM above 25 packets/s; HIGH above 50 |
| **D4 Restricted service** | Anyone except the allowed source using the database service | On/Off (the database 10.0.30.20:3306 may be used only by APP-SRV) |
| **D5 Forbidden zone pair** | Traffic between zones policy forbids (Staff or Outside to the Security network) | On/Off |
| **D6 Invalid TCP flags** | Flag combinations no real computer sends | Signatures to look for: NULL, XMAS, SYN+FIN, SYN+RST, FIN+RST |

Every detector also has **One alert per source and target every N s** (shipped 30): this stops the same alert repeating over and over. Set it to 0 to alert on every occurrence.

**Prevention (IPS)** — shows (read-only) what IPS-1 does with each packet, in order: (1) *block table*: a blocked source is dropped at once; (2) *detectors* look at every packet; (3) *policy lookup*; (4) *Enforce or record*; (5) *forward*. Then the table **Detector → action**:

| When it finds | IPS-1 will (Enforce) |
|---|---|
| D1 HIGH | **Block the source** for 20 s |
| D1 MEDIUM, D2 MEDIUM | Alert only |
| D2 HIGH | **Block the source** for 30 s |
| D3 MEDIUM | **Rate-limit** (10 packets/s, burst 20) |
| D3 HIGH | **Block the source** for 20 s |
| D4 HIGH | **Reject** (sends a TCP reset, like "connection refused") |
| D5 HIGH, D6 HIGH | **Drop** the packet |

In Monitor mode IPS-1 records the same decision but applies nothing. The **allowlist** (the Security network and the two link networks) is never limited, rejected, dropped or blocked, so IPS-1 cannot cut off the network's own management.

**Scenarios & checks** — a card per scenario with what it should do in each mode. **Play in 3D** runs it; **Run check** or **Run all checks** makes the engine run the scenarios and compare the results with what is expected (PASS/FAIL per check). With the shipped rules everything passes. After you change a rule, a failing check shows exactly what your change altered.

---

## 5. Running simulations

### 5.1 The nine scenarios (panel "The nine scenarios")
Select one, read its objective, source, destination, protocol and rule, choose the **IPS mode**, press **Run**. **Reset** clears isolation/trust changes and reloads the scenario at the start, so you can repeat it. **What this scenario should show** lists the expected result; **Outcome so far / Final outcome** and **SIEM events for this run** update as you play.

| # | Scenario | What you will see |
|---|---|---|
| 1 | Normal communication | PC-1 browses APP-SRV over HTTPS. Allowed everywhere; no alert. |
| 2 | Unauthorized Security VLAN access | PC-1 pings SIEM-1. **CORE-SW1** stops every ping (rule STAFF-IN:20). IDS-1 raises an alert. |
| 3 | Database access restriction | PC-1 tries the database. **CORE-SW1** stops it (STAFF-IN:10). |
| 4 | Authorized administrator access | ADMIN-PC reaches SIEM-1 and EDR-MGMT-1 (Zero Trust allows, with reasons); PC-1 is stopped. |
| 5 | External HTTP access | EXT-USR browses APP-SRV: FW1 permits it and the reply comes back. |
| 6 | External database restriction | EXT-ATK tries the database: **FW1** denies it; IDS-1 cannot even see it. |
| 7 | Compromised endpoint and EDR isolation | PC-2 is marked compromised, scans the server, IDS-1 and IPS-1 detect it, then PC-2 is **isolated** and sends nothing more. PC-1 keeps working. |
| 8 | Endpoint recovery | PC-2 starts isolated and sends nothing; it is **restored** and its traffic works again. |
| 9 | SIEM event monitoring | PC-3 sends invalid TCP flags; both sensors alert (D6) and the SIEM groups them into one incident. |

For scenarios 7 and 8, tick **Run the scripted operator action** to let the demo isolate/restore automatically, or leave it unticked and do it yourself: select PC-2, open **Security**, press **Isolate Endpoint** (or **Restore Endpoint**) at the moment you choose.

### 5.2 Baseline scenarios S1–S7
| ID | Story |
|---|---|
| S1 | Normal traffic only: nothing is flagged or dropped. |
| S2 | PC-2 scans 30 ports of APP-SRV. IDS-1 and IPS-1 alert; in Enforce, PC-2 is blocked for 20 s. |
| S3 | Four forbidden attempts: database from Staff, Security network from a laptop, database from outside, and an admin to the database (which IPS-1 rejects in Enforce). |
| S4 | EXT-ATK floods a *published* web port with growing speed: IPS-1 rate-limits, then blocks; the normal visitor is unaffected. |
| S5 | The S2 scan with IPS-1 fixed on **Monitor**. |
| S6 | The same scan with IPS-1 fixed on **Enforce**: identical until the HIGH alert, then the source is blocked. |
| S7 | PC-2 opens an SSH session every second (password guessing); detected by D2. |

### 5.3 Try these experiments
1. **Monitor vs Enforce.** Run S5, note the counters, then S6. Compare *Blocked* and the red area on the Monitoring chart.
2. **Turn a detector off.** Rules → Detection → switch **D1** off → Apply → run S2 again: no port-scan alert and no block. Switch it on again (or **Reset to shipped**).
3. **Make detection more sensitive.** Set D1 **MEDIUM at** to 3 and run S2: the first alert comes sooner.
4. **Restrict an address.** Rules → Firewall & ACL → add `203.0.113.25` (EXT-USR) → run scenario 5: FW1 now denies the visitor.
5. **Isolate someone.** Run scenario 7 without the scripted operator; at about 5 s select PC-2 → Security → **Isolate Endpoint**. PC-2 sends nothing afterwards; PC-1 still works.
6. **Zero Trust.** Select ADMIN-PC → Security → set **Device trust** to *Untrusted* → *Explain access to* SIEM-1 → **Explain**: access is denied and the reasons are listed.

### 5.4 Send traffic (your own packets)
Load a run first; the panel adds traffic **at the current playhead**. Choose a source and destination host, a kind, and press **Send traffic**.

| Kind | Meaning |
|---|---|
| **TCP connection** | A full connection: handshake, one request and reply, close (needs a port). |
| **TCP with chosen flags** | Raw TCP packets with the flags you tick (SYN, ACK, FIN, RST, PSH, URG); presets **NULL**, **XMAS**, **SYN+FIN**, **SYN**. Good for testing D6. |
| **Ping (ICMP echo)** | Echo requests; the destination answers each. |

*How many*: 1 to 10 packets. At most **5** injected flows per run (**Clear** removes them). **Staff to database** is a one-click example that the ACL denies. Everything before the playhead stays the same; what follows is decided by the real rules.

---

## 6. How the tools work together: one attack, step by step
Scenario 7 (or S2) in Enforce mode:

1. **EDR** reports that PC-2 is behaving like a compromised computer. The **SIEM** opens an incident.
2. PC-2 scans the server. Each packet passes **ACC-SW2**, then **CORE-SW1**, which sends a **copy** to **IDS-1** and (for protected systems) asks **Zero Trust**.
3. The firewall/ACL rules allow the scan (it is to an allowed address and port) — **rules alone cannot see "behaviour"**.
4. **IDS-1** counts distinct ports; at 6 it raises a MEDIUM alert, at 12 a HIGH alert. It cannot stop anything.
5. **IPS-1**, in the path, sees the same behaviour. On HIGH it **blocks PC-2**; later packets are dropped on arrival ("Blocked source").
6. Every alert and action is sent to the **SIEM**, which groups them into one incident for PC-2.
7. A **SOC operator** (you) **isolates** PC-2 with EDR. From that moment PC-2 creates no packets; packets it had already sent are discarded; replies to it are dropped.
8. Later, **Restore Endpoint** lets PC-2 work again.

Defence in depth: a firewall for who may connect, an IDS for what looks suspicious, an IPS for stopping it, EDR for containing a device, Zero Trust for who may reach sensitive systems, and a SIEM for the overall story.

---

## 7. Is it real? (Simulated vs real world)

| In CIPHER | In a real network |
|---|---|
| Traffic is generated by the simulation | Real users, servers and attackers |
| Detection counts packets against thresholds | Products combine signatures, behaviour and often machine learning |
| IPS "blocks" by changing simulation state | A real IPS drops or resets real traffic |
| EDR isolation is a state the simulation obeys | A real agent runs on the device and cuts its network access |
| Zero Trust uses a small table of users, roles and permissions | Real identity providers, multi-factor login, continuous checks |
| SIEM events are created from the simulation's own events | A SIEM collects real logs from many systems |
| Packet times are slowed down so you can watch them; `time=4ms` in ping is a made-up figure | Real packets cross a campus in microseconds |
| No login, no saved data | Accounts, logging and storage |

Not implemented: live packet capture, PCAP export, real IDS/IPS or SIEM products, authentication, saved run history (runs and edited rules are kept only in memory), a follow-packet camera.

---

## 8. Troubleshooting

| Problem | What to do |
|---|---|
| **Engine offline** (top bar) | The backend stopped. Start it again; the page reconnects by itself. A run already loaded can still be scrubbed. |
| Nothing happens when I press Run | Check that the engine is online. |
| Rules, trust or isolation cannot be changed | The server is **read-only** (shared deployment). Run CIPHER on your own computer. |
| The scene is slow | Use **View → Render quality → Low**. |
| Monitoring or Threats look empty | Run a scenario first; those pages show the run you are playing. |
| My rule change had no effect | Rule edits apply to the **next** run; run the scenario again. |
| A check fails after I edited rules | Expected: **Reset to shipped** restores the rules the checks assume. |

---

## 9. Glossary
- **ACL**: a list of allow/deny rules.
- **EDR**: software on a device that reports problems and can cut the device off.
- **Flag (TCP)**: a marker bit in a TCP packet (SYN starts a connection, FIN ends it, RST resets it).
- **ICMP**: the protocol used by `ping`.
- **Inline**: placed in the path of traffic, so it can stop it.
- **Port scan**: trying many ports of a computer to find open services.
- **Rate limit**: letting only a certain number of packets through per second.
- **SPAN (mirror)**: copying traffic to a monitoring device.
- **Stateful**: remembers connections.
- **TCP reset**: a message that ends a connection immediately ("connection refused").
- **Zero Trust**: "never trust, always verify": access depends on identity, device and permission, not on where you are.
