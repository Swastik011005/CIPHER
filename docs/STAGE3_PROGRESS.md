# Stage 3 progress: vertical slice with packet effects (honest status)

## What was added
- **Backend verification of the slice** (`backend/tests/scenarios/test_vertical_slice.py`, 8 tests): every S2 probe that reaches
  APP-SRV goes PC-2 -> ACC-SW2 -> CORE-SW1 -> IPS-1 -> SRV-SW3 -> APP-SRV with TTL `[64,64,63,63,63]` and VLAN
  `[10,10,30,30,30]` (L06 trunk tagged 10); blocked probes stop at IPS-1 after the same prefix; each packet entering CORE-SW1 has
  exactly one SPAN copy that ends at IDS-1 and is never dropped. Both IPS modes. No engine, topology, schema or scenario change.
- **Effects derived from the trace** (`playback/effects.js`): a pure `buildEffects(events)` + `activeEffects(list, t)`. Nothing is
  spawned while playing, so seek / pause / restart / replay cannot duplicate or lose an effect.
  - delivery pulse (green; amber if the packet was flagged), SPAN mirror ghost ring at CORE-SW1, IDS-1 radar pulse at each IDS-1
    alert (severity colour), quiet violet ping per SPAN copy received (rate-limited), IPS-1 allow / flag ("would block" in
    Monitor) flashes, IPS-1 block ring (once, from `block.added`) and unblock flash, shards (shatter) for each dropped packet,
    firewall ripple (FW1 deny) and ACL flash (CORE-SW1 deny) labelled with the rule id.
  - Only IPS-1 produces block / allow / shatter effects. IDS-1 produces only sensing effects. A test asserts no enforcement
    effect is ever anchored to IDS-1.
- **Packet colour transitions**: reducers record a timed verdict per packet (IPS-1 inspection, policy deny, IPS action, drop);
  `scene/packets/packetColor.js` fades neutral -> green / amber / red over 0.25 s. SPAN copies stay violet; IDS-1's verdict never
  recolours the original.
- **Device indicators** (`playback/deviceStatus.js`): label tags and floor ring recomputed from the same state as the counters
  (BLOCKED, IPS-1 ENFORCE/MONITOR + DROPPED or WOULD-BLOCK, IDS-1 N ALERTS, N DENIED on FW1 / CORE-SW1).
- **Inspectors from real data**: the device panel shows live counters, rule hits, sensor alerts and active blocks with a
  countdown; the new packet panel shows 5-tuple, flags, TTL, length, every hop (link, VLAN, TTL, time), the security decisions
  made about the packet and its SPAN copy (and from a copy back to its original). Open a packet by clicking it in the scene or in
  the "Recent packets" list.
- Test fixtures `fw-deny` and `acl-deny` (single TCP attempts, exported by `scripts/export_golden_traces.py`) exercise the
  firewall and ACL effects, which S1 and S2 never trigger. They are fixtures, not product scenarios.

## Tests (final run)
See the Stage 3 report in the session; commands: `backend\.venv\Scripts\python -m pytest`, `npx vitest run`, `npm run build`.

## Verified live (in-app browser, real backend, free-running playback)
- A full S2 Enforce run played at 2x with no scrubbing: counters at the end equalled the engine's `run.end` stats; alerts appeared
  at 3.3 s (MEDIUM, 6th port) and 4.8 s (HIGH), the block at about 5 s, and it lifted at about 25 s.
- S1, S2 Monitor and S2 Enforce through the UI: hashes equal the golden fixtures; Monitor shows 0 blocked / 0 IPS drops and
  26 flagged deliveries; Enforce blocks 24 packets, all at IPS-1; IDS-1 has 0 drops and 0 actions in every run.

## Limits and open items (not hidden)
- Frame rate in the in-app browser was 20-40 fps in this session (a non-WebGL page in the same pane gets 60). The Stage 2 build
  measured 33 fps in the same pane and Stage 3 about 40, so the effects added no measurable cost, but the Rev 3 target of
  >= 55 fps on the RTX 4050 was **not re-confirmed** this session. Not tested on an integrated GPU.
- No normal Chrome window was available (Claude in Chrome had no connected browser); the in-app browser is a real Chromium and
  delivered continuous animation frames, but the pane lags a frame or two behind seeks, so screenshots right after a seek can
  show the previous label text for a moment.
- Click-to-select on packets inside the 3D scene is implemented (instanced raycast with a fixed bounding sphere) but was not
  exercised by a real mouse click; selecting from the packet list was.
- Firewall ripple and ACL flash are covered by tests on the fixtures, not seen in the scene.
- No screenshots are saved in the repository.
- Still not built: D2 to D7, reject / RST injection, rate limiting, syslog, S3 to S7, Rules and Monitoring pages, Packet Tracer.
