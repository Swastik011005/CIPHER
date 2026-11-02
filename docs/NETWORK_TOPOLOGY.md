# Network topology (frozen)

Source of truth: `backend/config/topology.json`, served by `GET /api/topology`.

17 nodes = 16 devices + the abstract Internet segment `INET`; 18 links; 4 VLANs; 7 IP subnets; 7 zones.

| VLAN | Name | Subnet |
|---|---|---|
| 10 | Staff | 10.0.10.0/24 |
| 20 | Admin | 10.0.20.0/24 |
| 30 | Servers | 10.0.30.0/24 |
| 99 | Security | 10.0.99.0/24 |

Routed subnets outside any VLAN: 203.0.113.0/24 (outside), 10.255.0.0/30 (R1-EDGE to FW1), 10.255.1.0/30 (FW1 to CORE-SW1).

| Node | Address | Notes |
|---|---|---|
| EXT-USR / EXT-ATK | 203.0.113.25 / .66 | outside hosts |
| R1-EDGE | 203.0.113.1, 10.255.0.1 | static 10.0.0.0/8 via FW1 |
| FW1 | 10.255.0.2, 10.255.1.1 | routing firewall |
| CORE-SW1 | 10.255.1.2, SVIs .1 of VLAN 10/20/30/99 | L3 switch, ingress SPAN to IDS-1 |
| ACC-SW2, SRV-SW3 | none | Layer 2 only |
| PC-1, PC-2, LAPTOP-1 | 10.0.10.11 / .12 / .13 | VLAN 10 |
| ADMIN-PC | 10.0.20.10 | VLAN 20 |
| IDS-1 | mgmt 10.0.99.10 (SPAN port has no IP) | passive |
| SEC-LOG | 10.0.99.20 | syslog UDP 514 |
| IPS-1 | mgmt 10.0.99.11 (data ports have no IP) | inline VLAN 30 bridge |
| APP-SRV | 10.0.30.10 | tcp 22, 80, 443, 8080 |
| DB-SRV | 10.0.30.20 | tcp 22, 3306 |

The CORE-SW1 to ACC-SW2 trunk (link L06) carries VLAN 10 and 20 only. (The Stage 1 brief wrote "ACC-SW1"; the frozen
topology and this implementation use ACC-SW2.)

Blind spots that follow from the design: traffic that stays inside one VLAN on one switch (PC-1 to PC-2, APP-SRV to
DB-SRV) never enters CORE-SW1, so IDS-1 cannot see it, and only traffic through IPS-1 can be prevented.

`python -m netsec.network.validator` prints the 16 validation checks.
