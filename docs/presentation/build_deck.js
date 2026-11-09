/**
 * Builds the nine-slide final presentation: docs/presentation/CIPHER-final-presentation.pptx
 *
 *   mkdir %TEMP%\deck && cd %TEMP%\deck && npm init -y && npm install pptxgenjs
 *   node <repo>\docs\presentation\build_deck.js          (run with NODE_PATH pointing at that node_modules)
 *
 * pptxgenjs is only needed to rebuild the deck; the application does not depend on it. The screenshots are the
 * real ones in docs/demo and docs/screenshots. The numbers are the ones in docs/STAGE7_PROGRESS.md.
 */
const path = require('path')
const pptxgen = require('pptxgenjs')

const REPO = path.resolve(__dirname, '..', '..')
const shot = (p) => path.join(REPO, p)
const OUT = path.join(__dirname, 'CIPHER-final-presentation.pptx')

// Executed results (see docs/STAGE7_PROGRESS.md). Update these only from a real run of scripts\verify.cmd.
const RESULTS = { backendTests: '937', frontendTests: '277', checks: '93/93', rehearsal: '34/34', offline: '8/8' }

const C = {
  bg: '060D1F', panel: '0C1A36', panel2: '11234A', line: '27406E',
  text: 'EAF1FF', muted: 'A9B8D9', accent: '4DA3FF', cyan: '38D6E6',
  ok: '34D399', warn: 'FBBF24', danger: 'FF5A6A', violet: 'A78BFA',
}
const FONT = 'Calibri'

const pres = new pptxgen()
pres.layout = 'LAYOUT_16x9' // 10 x 5.625 in
pres.title = 'Intelligent Network Security Using Intrusion Detection and Automated Threat Prevention'
pres.subject = 'Computer Networks project: final presentation'
pres.theme = { headFontFace: FONT, bodyFontFace: FONT }

pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: C.bg },
  slideNumber: { x: 9.2, y: 5.25, w: 0.5, h: 0.25, fontFace: FONT, fontSize: 10, color: C.muted, align: 'right' },
  objects: [
    {
      text: {
        text: 'CIPHER  |  a simulation: synthetic traffic only',
        options: { x: 0.5, y: 5.25, w: 6, h: 0.25, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0 },
      },
    },
  ],
})

const text = (slide, t, o) => slide.addText(t, { isTextBox: true, fontFace: FONT, margin: 0, color: C.text, valign: 'top', ...o })
const title = (slide, t, eyebrow) => {
  text(slide, eyebrow.toUpperCase(), { x: 0.5, y: 0.3, w: 9, h: 0.25, fontSize: 11, bold: true, color: C.accent, charSpacing: 3 })
  text(slide, t, { x: 0.5, y: 0.58, w: 9, h: 0.62, fontSize: 30, bold: true })
}
const card = (slide, x, y, w, h, name, fill = C.panel) =>
  slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: C.line, width: 0.75 }, objectName: name })
const badge = (slide, n, x, y, color = C.accent) => {
  slide.addShape(pres.ShapeType.ellipse, { x, y, w: 0.36, h: 0.36, fill: { color }, line: { color, width: 0.5 }, objectName: `badge ${n}` })
  text(slide, String(n), { x, y, w: 0.36, h: 0.36, fontSize: 14, bold: true, color: C.bg, align: 'center', valign: 'middle' })
}
const arrow = (slide, x, y, w) =>
  slide.addShape(pres.ShapeType.rightArrow, { x, y, w, h: 0.28, fill: { color: C.accent }, line: { color: C.accent, width: 0.5 }, objectName: 'arrow' })
const bullets = (items, o = {}) =>
  items.map((t, i) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: i < items.length - 1, paraSpaceAfter: 6, ...o } }))
const picture = (slide, p, x, y, w, h, alt) => {
  slide.addImage({ path: shot(p), x, y, w, h, altText: alt, objectName: alt })
  slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.05, fill: { color: C.bg, transparency: 100 }, line: { color: C.line, width: 1 }, objectName: 'frame' })
}

// 1. Problem statement ----------------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  text(s, 'COMPUTER NETWORKS PROJECT  |  FINAL PRESENTATION', { x: 0.5, y: 0.3, w: 9, h: 0.25, fontSize: 11, bold: true, color: C.accent, charSpacing: 3 })
  text(s, 'Intelligent Network Security Using Intrusion Detection and Automated Threat Prevention', { x: 0.5, y: 0.65, w: 4.6, h: 1.7, fontSize: 24, bold: true })
  text(s, 'The problem', { x: 0.5, y: 2.45, w: 4.6, h: 0.3, fontSize: 18, bold: true, color: C.cyan })
  text(
    s,
    bullets([
      'A firewall decides by address and port. It cannot see a port scan on a service it allows.',
      'An IDS watches copies of traffic and alerts, but it is not in the path, so it cannot stop anything.',
      'An IPS is in the path and can stop traffic, but a wrong rule blocks real users.',
    ]),
    { x: 0.5, y: 2.8, w: 4.6, h: 2.35, fontSize: 14 },
  )
  picture(s, 'docs/demo/01-overview.png', 5.35, 0.65, 4.15, 2.6, 'Overview page of the app')
  card(s, 5.35, 3.45, 4.15, 1.45, 'scope card')
  text(s, 'Our answer', { x: 5.55, y: 3.55, w: 3.8, h: 0.3, fontSize: 16, bold: true, color: C.cyan })
  text(s, 'A 3D simulation of one campus network that shows who detects, who prevents, and why. Synthetic traffic only: nothing real is captured or blocked.', {
    x: 5.55, y: 3.88, w: 3.8, h: 0.95, fontSize: 13, color: C.muted,
  })
  s.addNotes(
    'Say: Firewalls, IDS and IPS are often confused. A firewall filters by address and port. An IDS watches a copy of the traffic and raises alerts, but it is not in the path, so it cannot stop anything. An IPS sits in the path, so it can drop or block, at the risk of blocking real users. Our project simulates all three on one small campus so the difference can be seen packet by packet. Say clearly: everything is a simulation with synthetic traffic.',
  )
}

// 2. Objectives -----------------------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  title(s, 'Five objectives, one clear boundary', 'Objectives')
  const items = [
    ['Model a campus network', '4 VLANs, 7 subnets, static routing, a stateful firewall and an access list.'],
    ['Detect with a passive IDS', 'IDS-1 reads SPAN copies and raises alerts. Six detectors, D1 to D6.'],
    ['Prevent with an inline IPS', 'IPS-1 can drop, reject, rate-limit or block, in Monitor or Enforce mode.'],
    ['Make it visible and repeatable', 'A deterministic trace replayed in 3D. Same seed, same result.'],
    ['Prove it works', '93 scenario checks and automated tests, not just a good-looking demo.'],
  ]
  const xs = [0.5, 3.55, 6.6]
  items.forEach(([h, b], i) => {
    const x = xs[i % 3]
    const y = i < 3 ? 1.5 : 3.3
    card(s, x, y, 2.9, 1.6, `objective ${i + 1}`)
    badge(s, i + 1, x + 0.2, y + 0.18)
    text(s, h, { x: x + 0.68, y: y + 0.1, w: 2.1, h: 0.55, fontSize: 15, bold: true, valign: 'middle' })
    text(s, b, { x: x + 0.2, y: y + 0.8, w: 2.5, h: 0.75, fontSize: 13, color: C.muted })
  })
  card(s, 6.6, 3.3, 2.9, 1.6, 'boundary card', C.panel2)
  text(s, 'Boundary', { x: 6.8, y: 3.45, w: 2.5, h: 0.3, fontSize: 15, bold: true, color: C.warn })
  text(s, 'Not real traffic, not a real product. Our own model of the concepts.', { x: 6.8, y: 3.8, w: 2.5, h: 1.0, fontSize: 13, color: C.muted })
  s.addNotes(
    'The first five cards are what we set out to do. The last card is what we did not: this is not Snort, Suricata or Cisco IOS and it never touches a real network. It is our own model of the concepts, built so the behaviour can be shown and tested.',
  )
}

// 3. Architecture ---------------------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  title(s, 'The engine decides, the browser replays', 'System architecture')
  const boxes = [
    ['Configuration', 'topology, rules, scenarios (JSON)', C.panel],
    ['Python engine', 'discrete-event; decides every packet', C.panel2],
    ['Trace', 'time-stamped events plus a hash', C.panel],
    ['React player', 'play, pause, seek, step', C.panel2],
    ['3D scene and pages', 'counters, tables, inspectors', C.panel],
  ]
  const w = 1.6
  const gap = 0.25
  boxes.forEach(([h, b, fill], i) => {
    const x = 0.5 + i * (w + gap)
    card(s, x, 1.5, w, 1.45, `stage ${h}`, fill)
    text(s, h, { x: x + 0.1, y: 1.6, w: w - 0.2, h: 0.5, fontSize: 15, bold: true, color: C.cyan, align: 'center', valign: 'middle' })
    text(s, b, { x: x + 0.1, y: 2.15, w: w - 0.2, h: 0.7, fontSize: 12, color: C.muted, align: 'center' })
    if (i < boxes.length - 1) arrow(s, x + w + 0.02, 2.1, gap - 0.04)
  })
  const notes = [
    ['One source of truth', 'The 3D scene, counters and tables all read the same trace, so they cannot disagree.'],
    ['Deterministic', 'Integer-microsecond clock. Same seed and rules give the same trace hash.'],
    ['Changes at the playhead', 'Switching IPS mode or sending traffic re-simulates; everything before the playhead stays identical.'],
    ['Local only', 'Binds to 127.0.0.1, REST only. After install it needs no internet.'],
  ]
  notes.forEach(([h, b], i) => {
    const x = 0.5 + (i % 2) * 4.6
    const y = 3.2 + Math.floor(i / 2) * 0.95
    text(s, h, { x, y, w: 4.3, h: 0.28, fontSize: 14, bold: true, color: C.accent })
    text(s, b, { x, y: y + 0.3, w: 4.3, h: 0.55, fontSize: 12, color: C.muted })
  })
  s.addNotes(
    'The Python engine runs a discrete-event simulation and returns a trace: a list of time-stamped events. The browser never decides what happens to a packet; it only replays the trace. Because everything comes from one trace, the 3D scene and the numbers cannot disagree. Same seed and same rules give the same trace hash, which is why our expected demo numbers are exact.',
  )
}

// 4. Network topology -----------------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  title(s, 'Four VLANs, seven subnets, one campus', 'Network topology')
  picture(s, 'docs/screenshots/1920x1080-simulation-overview.png', 0.5, 1.35, 5.3, 2.98, 'The 3D campus in the Simulation page')
  const head = (t) => ({ text: t, options: { bold: true, color: C.cyan, fill: { color: C.panel2 }, fontSize: 12, fontFace: FONT } })
  const cell = (t, o = {}) => ({ text: t, options: { color: C.text, fontSize: 12, fontFace: FONT, fill: { color: C.panel }, ...o } })
  s.addTable(
    [
      [head('VLAN'), head('Name'), head('Subnet')],
      [cell('10'), cell('Staff'), cell('10.0.10.0/24')],
      [cell('20'), cell('Admin'), cell('10.0.20.0/24')],
      [cell('30'), cell('Servers'), cell('10.0.30.0/24')],
      [cell('99'), cell('Security'), cell('10.0.99.0/24')],
      [cell('-'), cell('Routed'), cell('203.0.113.0/24, two /30 links', { fontSize: 11 })],
    ],
    { x: 6.05, y: 1.35, w: 3.45, colW: [0.6, 0.95, 1.9], rowH: 0.3, border: { type: 'solid', pt: 0.5, color: C.line }, margin: [0.03, 0.08, 0.03, 0.08], objectName: 'vlan table' },
  )
  text(
    s,
    bullets([
      '17 nodes (16 devices + Internet), 18 links, 7 zones',
      'Static routes; TTL 64 becomes 63 at CORE-SW1',
    ]),
    { x: 6.05, y: 3.4, w: 3.45, h: 0.95, fontSize: 12, color: C.muted },
  )
  text(
    s,
    bullets([
      'SPAN: CORE-SW1 ingress is copied to IDS-1, before the ACL.',
      'IPS-1: transparent bridge in front of the servers (VLAN 30).',
    ], {}),
    { x: 0.5, y: 4.45, w: 9, h: 0.7, fontSize: 13 },
  )
  s.addNotes(
    'Path inward: outside hosts, the Internet segment, R1-EDGE, FW1, then CORE-SW1, a layer-3 switch that routes between VLAN 10 Staff, 20 Admin, 30 Servers and 99 Security. The trunk to the access switch carries VLANs 10 and 20. Three more routed subnets sit outside any VLAN, making seven subnets. CORE-SW1 copies every packet entering it to IDS-1 over a SPAN port, before the ACL. IPS-1 is a transparent bridge in VLAN 30: no IP on its data ports, so routing and TTL are unchanged but all server traffic passes through it. The picture is a real screenshot of our app.',
  )
}

// 5. Technologies ---------------------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  title(s, 'Plain, testable technologies', 'Technologies')
  const cols = [
    ['Backend: the engine', C.cyan, ['Python 3.13', 'FastAPI 0.162 + Uvicorn 0.54', 'Pydantic 2.14 (validation)', 'Scapy 2.8 (packet codec in tests)', 'pytest 9.2 + httpx']],
    ['Frontend: the replay', C.accent, ['React 19 + Vite 8', 'Three.js 0.187 with react-three-fiber', 'Zustand (one shared store)', 'Vitest 5 (277 tests)', 'Fonts bundled: works offline']],
    ['Tooling', C.violet, ['Windows .cmd scripts: setup, run, verify', 'Chrome DevTools scripts for the rehearsal', 'Git: tracks per area, tagged milestones', 'Not used: WebSocket, database, machine learning']],
  ]
  cols.forEach(([h, col, list], i) => {
    const x = 0.5 + i * 3.05
    card(s, x, 1.45, 2.9, 3.5, `tech ${h}`)
    text(s, h, { x: x + 0.2, y: 1.6, w: 2.5, h: 0.35, fontSize: 16, bold: true, color: col })
    text(s, bullets(list, {}), { x: x + 0.2, y: 2.1, w: 2.55, h: 2.7, fontSize: 13 })
  })
  s.addNotes(
    'Python and FastAPI for the engine because it is easy to read and test. React, Vite and Three.js for the browser. One Zustand store feeds both the 3D scene and the pages. Fonts and libraries are bundled, so after installation the app needs no internet. We deliberately did not use a database, WebSocket or machine learning.',
  )
}

// 6. IDS / IPS workflow ---------------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  title(s, 'IDS watches a copy; IPS stands in the path', 'IDS and IPS workflow')
  const node = (x, y, w, h, label, sub, fill, col) => {
    card(s, x, y, w, h, `node ${label}`, fill)
    text(s, label, { x: x + 0.05, y: y + 0.08, w: w - 0.1, h: 0.3, fontSize: 14, bold: true, color: col, align: 'center' })
    text(s, sub, { x: x + 0.08, y: y + 0.4, w: w - 0.16, h: h - 0.45, fontSize: 11, color: C.muted, align: 'center' })
  }
  node(0.5, 1.5, 1.45, 1.0, 'Sender', 'host on the campus or outside', C.panel, C.text)
  arrow(s, 1.97, 1.95, 0.28)
  node(2.27, 1.5, 1.7, 1.0, 'FW1 / ACL', 'static policy; drops by address and port', C.panel, C.text)
  arrow(s, 3.99, 1.95, 0.28)
  node(4.29, 1.5, 1.7, 1.0, 'CORE-SW1', 'routes; copies each packet to IDS-1', C.panel, C.text)
  arrow(s, 6.01, 1.95, 0.28)
  node(6.31, 1.5, 1.6, 1.0, 'IPS-1', 'inline; the only sensor that enforces', C.panel2, C.ok)
  arrow(s, 7.93, 1.95, 0.28)
  node(8.23, 1.5, 1.27, 1.0, 'Server', 'APP-SRV or DB-SRV', C.panel, C.text)
  s.addShape(pres.ShapeType.downArrow, { x: 4.95, y: 2.55, w: 0.28, h: 0.35, fill: { color: C.violet }, line: { color: C.violet, width: 0.5 }, objectName: 'span arrow' })
  node(4.05, 2.95, 2.1, 0.95, 'IDS-1 (SPAN copy)', 'passive: alerts only, never blocks', C.panel, C.violet)

  card(s, 0.5, 2.95, 3.3, 2.0, 'ips order card', C.panel2)
  text(s, 'IPS-1, for every packet', { x: 0.7, y: 3.05, w: 3, h: 0.3, fontSize: 14, bold: true, color: C.ok })
  text(
    s,
    [
      { text: '1  Source in the block table? Drop.', options: { breakLine: true, paraSpaceAfter: 3 } },
      { text: '2  Detectors look at the packet.', options: { breakLine: true, paraSpaceAfter: 3 } },
      { text: '3  Look up the action for the finding.', options: { breakLine: true, paraSpaceAfter: 3 } },
      { text: '4  Enforce, or in Monitor only record.', options: { breakLine: true, paraSpaceAfter: 3 } },
      { text: '5  Forward unless dropped.' },
    ],
    { x: 0.7, y: 3.4, w: 3.0, h: 1.5, fontSize: 12 },
  )
  card(s, 6.4, 2.95, 3.1, 2.0, 'actions card')
  text(s, 'Actions (Enforce mode)', { x: 6.6, y: 3.05, w: 2.8, h: 0.3, fontSize: 14, bold: true, color: C.warn })
  text(
    s,
    bullets(['Drop: D5, D6', 'Reject with a TCP reset: D4', 'Rate limit, 10 per second: D3', 'Block the source 20 to 30 s: D1, D2, D3'], {}),
    { x: 6.6, y: 3.4, w: 2.8, h: 1.45, fontSize: 12 },
  )
  s.addNotes(
    'Follow one packet. FW1 and the core ACL enforce static policy no matter what. CORE-SW1 copies each packet entering it to IDS-1; IDS-1 can only raise alerts, because it is looking at a copy. The original packet continues to IPS-1, which sits in the path. IPS-1 first checks the block table, then runs the detectors on every packet, then looks up the action, then either enforces it (Enforce mode) or only records what it would have done (Monitor mode). Detection runs before enforcement so a rate limiter can never hide a flood from the detector. D1 port scan, D2 brute force, D3 flood, D4 restricted service, D5 forbidden zone pair, D6 invalid TCP flags.',
  )
}

// 7. Simulation scenarios -------------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  title(s, 'Seven scenarios, exact expected results', 'Simulation scenarios')
  const head = (t) => ({ text: t, options: { bold: true, color: C.cyan, fill: { color: C.panel2 }, fontSize: 12, fontFace: FONT } })
  const cell = (t, o = {}) => ({ text: t, options: { color: C.text, fontSize: 12, fontFace: FONT, fill: { color: C.panel }, valign: 'middle', ...o } })
  s.addTable(
    [
      [head('Scenario'), head('What happens'), head('Result (shipped rules)')],
      [cell('S1 Normal', { bold: true }), cell('HTTPS, ping, admin SSH, app to database'), cell('30 packets, 0 alerts', { color: C.ok })],
      [cell('S2 Port scan', { bold: true }), cell('PC-2 probes ports; D1 at 6 and 12 ports'), cell('Monitor: 0 blocked. Enforce: 24 blocked', { color: C.warn })],
      [cell('S3 Access control', { bold: true }), cell('Four forbidden attempts: ACL, firewall, IPS reject'), cell('4 blocked, 4 alerts', { color: C.danger })],
      [cell('S4 Flood', { bold: true }), cell('Outside host floods port 443'), cell('Rate limit, then block; real user unaffected', { color: C.warn })],
      [cell('S5, S6', { bold: true }), cell('S2 traffic pinned to Monitor / Enforce'), cell('Same until the HIGH alert')],
      [cell('S7 Brute force', { bold: true }), cell('Repeated SSH attempts (D2)'), cell('Alerts at 6 and 12; block 30 s')],
    ],
    { x: 0.5, y: 1.35, w: 5.75, colW: [1.3, 2.35, 2.1], rowH: 0.5, border: { type: 'solid', pt: 0.5, color: C.line }, margin: [0.04, 0.08, 0.04, 0.08], objectName: 'scenario table' },
  )
  picture(s, 'docs/demo/04-s2-enforce-blocked.png', 6.5, 1.35, 3.0, 1.88, 'S2 in Enforce mode: PC-2 blocked at IPS-1')
  text(s, 'S2, Enforce: PC-2 blocked at IPS-1, 23 dropped so far.', { x: 6.5, y: 3.3, w: 3.0, h: 0.5, fontSize: 11, color: C.muted })
  card(s, 6.5, 3.95, 3.0, 1.0, 'custom traffic card', C.panel2)
  text(s, 'Custom traffic', { x: 6.65, y: 4.02, w: 2.7, h: 0.28, fontSize: 13, bold: true, color: C.accent })
  text(s, 'Inject your own packet at the playhead; the engine re-simulates.', { x: 6.65, y: 4.32, w: 2.7, h: 0.6, fontSize: 11, color: C.muted })
  s.addNotes(
    'These are the exact outcomes with the shipped rules; the demo checks them. S2 shows Monitor against Enforce with identical traffic: the traces are the same until the HIGH alert, then in Enforce 24 packets are dropped and PC-2 is blocked for 20 seconds. S3 shows defence in depth: two ACL denials, one firewall drop that no sensor sees, and an IPS reject for the admin PC. S4 shows the token-bucket rate limit and then a block, while the legitimate outside user keeps getting through. Custom traffic lets the audience try their own packet.',
  )
}

// 8. Results and testing --------------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  title(s, 'Tested by machines and in a real browser', 'Results and testing')
  const stats = [
    [RESULTS.backendTests, 'backend tests'],
    [RESULTS.frontendTests, 'frontend tests'],
    [RESULTS.checks, 'scenario checks'],
    [RESULTS.rehearsal, 'demo rehearsal'],
    [RESULTS.offline, 'offline recovery'],
  ]
  stats.forEach(([n, l], i) => {
    const x = 0.5 + i * 1.84
    card(s, x, 1.35, 1.7, 1.15, `stat ${l}`)
    text(s, n, { x, y: 1.42, w: 1.7, h: 0.6, fontSize: 28, bold: true, color: C.ok, align: 'center', valign: 'middle' })
    text(s, l, { x, y: 2.05, w: 1.7, h: 0.35, fontSize: 12, color: C.muted, align: 'center' })
  })
  s.addChart(
    pres.charts.BAR,
    [
      { name: 'Low quality', labels: ['1350x673', '1424x805', '1904x985'], values: [59.3, 59.2, 31.1] },
      { name: 'High quality', labels: ['1350x673', '1424x805', '1904x985'], values: [31.3, 27.2, 15.2] },
    ],
    {
      x: 0.5, y: 2.7, w: 5.2, h: 2.4, barDir: 'col', barGrouping: 'clustered',
      chartColors: [C.accent, C.warn], showLegend: true, legendPos: 'b', legendColor: C.muted, legendFontSize: 11, legendFontFace: FONT,
      showTitle: true, title: 'Frames per second at the S4 peak (Intel UHD GPU)', titleColor: C.text, titleFontSize: 12, titleFontFace: FONT,
      showValue: true, dataLabelColor: C.text, dataLabelFontSize: 10, dataLabelFontFace: FONT, dataLabelPosition: 'outEnd',
      catAxisLabelColor: C.muted, catAxisLabelFontSize: 10, catAxisLabelFontFace: FONT,
      valAxisLabelColor: C.muted, valAxisLabelFontSize: 10, valAxisLabelFontFace: FONT, valAxisMaxVal: 70, valAxisMinVal: 0,
      valGridLine: { color: C.line, size: 0.5 }, catGridLine: { style: 'none' },
    },
  )
  card(s, 5.95, 2.7, 3.55, 2.4, 'honesty card', C.panel2)
  text(s, 'What we did not measure', { x: 6.15, y: 2.8, w: 3.2, h: 0.3, fontSize: 14, bold: true, color: C.warn })
  text(
    s,
    bullets([
      'The 55 fps target on the RTX 4050 is not verified. Chrome used the Intel GPU.',
      'Clean install: 9.4 min on one laptop. The second laptop was not tested.',
      'No real network, no real IDS/IPS product.',
    ], {}),
    { x: 6.15, y: 3.15, w: 3.2, h: 1.9, fontSize: 12 },
  )
  s.addNotes(
    'Everything here was executed, not assumed. Backend and frontend test suites, the 93 scenario checks across 12 runs, a 34-check rehearsal of the whole demo in a real Chrome window, and an 8-check test that kills the backend while the page is open and checks it recovers. Frame rates were measured on the laptop Intel integrated GPU at the heaviest moment of S4; the Low preset reaches the 30 fps target at all three window sizes. Be explicit about what was not measured: the 55 fps RTX 4050 target is not verified, because Chrome rendered on the Intel GPU; the second laptop was not available; and nothing was tested on a real network.',
  )
}

// 9. Conclusion and future scope ------------------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'CONTENT' })
  title(s, 'What we built, and what comes next', 'Conclusion and future scope')
  card(s, 0.5, 1.4, 4.4, 3.55, 'delivered card')
  text(s, 'Delivered', { x: 0.7, y: 1.52, w: 4, h: 0.32, fontSize: 16, bold: true, color: C.ok })
  text(
    s,
    bullets([
      'A deterministic simulation of firewall, ACL, passive IDS and inline IPS',
      'Six detectors and four IPS actions, Monitor and Enforce',
      'A 3D replay with packet and device inspectors, rules editor and 93 self-checks',
      'Offline demo mode with a tested recovery path',
    ], {}),
    { x: 0.7, y: 1.95, w: 4.0, h: 2.9, fontSize: 14 },
  )
  card(s, 5.1, 1.4, 4.4, 2.1, 'future card')
  text(s, 'Future scope', { x: 5.3, y: 1.52, w: 4, h: 0.32, fontSize: 16, bold: true, color: C.accent })
  text(
    s,
    bullets(['Packet Tracer lab to compare with real Cisco configuration (not built)', 'Anomaly or machine-learning detection beside the rules', 'PCAP export, host-sweep detector, saved run history'], {}),
    { x: 5.3, y: 1.9, w: 4.0, h: 1.55, fontSize: 13 },
  )
  card(s, 5.1, 3.65, 4.4, 1.3, 'simulated card', C.panel2)
  text(s, 'Simulated, not real', { x: 5.3, y: 3.75, w: 4, h: 0.3, fontSize: 14, bold: true, color: C.warn })
  text(s, 'Blocking changes simulation state only. Nothing is captured, sent or blocked on a real network.', { x: 5.3, y: 4.08, w: 4.0, h: 0.8, fontSize: 13, color: C.muted })
  s.addNotes(
    'Summary: a deterministic engine decides every packet and writes a trace; the browser replays it. The IDS detects without being in the path; the IPS enforces because it is. Limits to state plainly: the traffic is synthetic; the Packet Tracer lab in the original plan was not built; detection is rule-based with no machine learning; D3 has no half-open condition; and the high-end GPU target is unverified. Future scope: a Packet Tracer comparison, anomaly detection, PCAP export and persistent run history. Thank the audience and invite questions. The viva question bank is docs/VIVA_QA.md.',
  )
}

pres.writeFile({ fileName: OUT }).then((f) => console.log('wrote', f))
