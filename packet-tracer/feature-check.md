# Packet Tracer: remaining work (bounded parallel workstream)

Status: **not started.** Packet Tracer is not installed or checked on this machine, so nothing here is verified.

Cisco Packet Tracer validates the network design (addressing, VLANs, routing, ACLs, a stateful firewall and a limited
signature IPS). It does **not** implement this project's behavioural IDS/IPS (port-scan thresholds, flood detection),
cannot export PCAPs and is **not connected** to the app. The app's simulation and the PT lab are separate things.

To do (members M1 and M5, at most about 1.5 h/day):
1. Check the installed PT version for: SPAN / Sniffer, zone-based firewall, IOS IPS signatures, SSH/VTY ACLs. Record results here.
2. Build the topology from `docs/NETWORK_TOPOLOGY.md` (2 routers, 1 multilayer switch, 3 switches, 6 PCs/laptops, 3 servers).
3. Configure VLANs 10/20/30/99, the VLAN 10/20 trunk, SVIs, static routes, ACLs, firewall, syslog.
4. Run connectivity tests (allowed and denied) and compare verdicts for the same source/destination/port with the app.
5. Where a PT feature is missing, document it and use substitute evidence (Simulation-mode PDUs, ACL counters).
