# Stage C, phase C2: Smart Campus implementation

Status: implemented and verified on `feature/campus-c1-design`. Not merged, not pushed, nothing deployed. C3 and Stage D are not started.

C2 builds the approved C1 revision 2 design with decisions D1 to D6. It is a presentation layer only: the 17 nodes, 18 links, device positions, cable routes, VLANs, addressing and simulation behaviour are unchanged. A layout fingerprint test (SHA-256 of node, link, zone and plate layout) proves that no device or cable moved.

## What changed

| Area | Change |
|---|---|
| `frontend/src/scene/campus/campusLayout.js` | Pure data and geometry rules: platforms, pavilions, frames, glass panes, cable openings, signs, balustrade. 20 tests in `campusLayout.test.js`. |
| `campusMeshes.js`, `CampusWorld.jsx`, `campusMaterials.js` | Builds the layer once from the topology. All geometry is merged per material, so the whole layer is 6 draw calls: platform tops, plinths, steel, glass, accent lights (zone colour as vertex colour) and one sign mesh with a single atlas texture. Nothing in it is picked or animated. |
| `NetworkWorld.jsx`, `environment/Environment.jsx`, `materials.js`, `palette.js` | Old zone slabs, flat captions, opaque perimeter wall and glass partition removed. Steel-blue continuous ground and a separate, slightly darker off-campus island. Cables lightened. `environment/fonts.js` deleted (only the flat captions used it). |
| `devices/DeviceNode.jsx` | Fix for a latent label bug, see below. |
| `docs/design/campus-c2/` | Capture, performance, picking and label-probe tools, the before and after screenshots, performance output. |

## Before and after (real application renderer, 1680 x 960 window)

| View | Before | After |
|---|---|---|
| Default camera | ![](campus-c2/screens/before-overview.png) | ![](campus-c2/screens/after-overview.png) |
| Staff LAN | ![](campus-c2/screens/before-staff.png) | ![](campus-c2/screens/after-staff.png) |
| Server room | ![](campus-c2/screens/before-servers.png) | ![](campus-c2/screens/after-servers.png) |
| Core | ![](campus-c2/screens/before-core.png) | ![](campus-c2/screens/after-core.png) |
| Perimeter | ![](campus-c2/screens/before-perimeter.png) | ![](campus-c2/screens/after-perimeter.png) |
| Security Operations | ![](campus-c2/screens/before-secops.png) | ![](campus-c2/screens/after-secops.png) |
| Orbit (from behind) | ![](campus-c2/screens/before-orbit.png) | ![](campus-c2/screens/after-orbit.png) |
| S4 flood peak, overview | ![](campus-c2/screens/before-packets-overview.png) | ![](campus-c2/screens/after-packets-overview.png) |
| S4 flood peak, server room | ![](campus-c2/screens/before-packets-servers.png) | ![](campus-c2/screens/after-packets-servers.png) |
| Low preset | ![](campus-c2/screens/before-low-overview.png) | ![](campus-c2/screens/after-low-overview.png) |

## Performance

Procedure: S4 in Enforce at its peak, 1904 x 985, two High and two Low runs, then WebGL resource counts (`docs/design/campus-c2/perf.mjs`). Intel laptop, software-limited High around 20 fps as before.

| Metric | Baseline (develop) | C2 | Budget |
|---|---|---|---|
| Draw calls per frame | 241 | 217 to 218 | at most +35 (276) |
| Triangles | 82.1k to 82.4k | 80.3k to 80.6k | at most +8,000 |
| Geometries | 174 | 157 | |
| Textures High / Low | 54 / 28 | 54 / 28 | |
| High fps | 20.4, 21.2 | 20.5, 21.3 (and 21.2, 21.6 on an earlier run) | |
| Low fps | 59.7, 59.5 | 58 and 52 in the last run; see note | |
| Transferred | 999 KB | 963 KB | |

Low note. My first C2 build used 11 more draw calls and Low looked slower (54 to 55 fps in several runs). I merged the campus meshes across zones (about 42 meshes down to 7) rather than accept it. Interleaved A/B runs of the baseline build and C2 on the same machine then gave baseline 58.9 to 60 fps (mean 59.5) and C2 59.2 to 60 fps (mean 59.6). Low runs on this machine occasionally miss a vsync (33 ms frames) in both builds, and the last run above was taken while other tools were running, so single numbers vary by several fps. High is unchanged within noise. The 1% worst frame is dominated by the post-processing in High, as before.

## Verification (final code)

| Check | Result |
|---|---|
| Backend tests | 1068 passed |
| Scenario checks | 12 of 12 runs, 93 of 93 checks; all 12 trace hashes identical to `docs/DEVELOPMENT.md` |
| Frontend tests | 307 passed (287 before plus 20 campus tests) |
| Production build | passes |
| Split-origin check | 20 of 20, and the 34-step demo rehearsal 34 of 34, no console or CSP errors, no request left 127.0.0.1 |
| Offline recovery | 8 of 8 |
| Picking in the real renderer | 12 of 12 devices hover and select by click, including both rack servers inside the pavilion |
| Console errors during all captures | none |

Flaky runs, reported as seen: one split-check run failed its "invented X-Forwarded-For cannot buy a new allowance" probe and passed on the immediate re-run (likely the per-minute rate-limit window sliding while the 30-request loop ran; I did not prove this, and the backend is untouched). One offline-recovery run reported "1 of 2 checks passed" and one picking run printed only 6 passes; both passed 8 of 8 and 12 of 12 on an immediate re-run, cause not found. `perf.mjs` once failed to get output from `measure_fps` and worked on retry; it now prints the reason if that happens again.

## Visibility findings

1. Devices, labels, rings and packet effects are visible in every preset. The glass is a 20% tint with a weak environment reflection and shows no mirror reflections or distortion; devices inside the pavilions are never behind more than one pane, and S/E sides are open.
2. Cables on the ground. Rendered contrast against the steel-blue ground is about 2.5:1 in the default view (measured on the core to staff cable). The old design measured about 5.6:1 on the old navy ground. I raised the cable colour, then darkened the ground (`#6b82ad` to `#566e9a`, island `#4c6389`) to get from 1.9:1 to 2.5:1. Cables are clearly visible but less prominent than before. The ground is a one-line change if you want it darker, which also lifts packets and rings.
3. Cables and devices on the platforms. The pale platform tops (`#dde6f3`) give the clay devices and bright cables little flat-colour contrast (about 1.1:1 for the device body). They stay recognisable through shading, shadows, dark screens and bases, floor rings and the accent edge lights, but this is weaker than on the old navy slabs. A darker platform top is a possible C3 adjustment; I did not make it because C1 approved near-white platforms.
4. Packets travelling on the bright cables are light on light; they remain visible by size, bloom and the colour of rings and badges at the IPS, but they stand out less than on the old navy.
5. Signs are small at the default overview (about 8 px text) and fully readable in every preset view. From behind, sign boards show as plain zone-coloured plaques.
6. Fixed latent bug: the first device label (Internet) could mount empty because drei `Html` rebuilds its DOM root when R3F connects its event target. Removing the flat captions changed load timing and exposed it. `DeviceNode` now keys the label on the event connection.
7. CSP is unchanged. The troika text worker (`blob:`) is no longer used by the scene, so `script-src 'self' blob:` could be tightened later; not done in C2.

## Not done, by instruction

No merge, no push, no deploy, `main` untouched, C3 (interaction) and Stage D (pop-out viewer) not started.
