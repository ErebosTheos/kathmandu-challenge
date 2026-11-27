# Project handover

See `GAME_SPEC.md` for the original product specification and `logs/review-notes.md` for historical technical and visual review notes.

## Verification
- Inspect headless Blender renders and review the running simulator with Playwright screenshots.
- Do not commit unless the user asks.

## Status (update as you go)
| Phase | State |
|---|---|
| Data: Koteshwor OSM (`data/raw/koteshwor-api.json`), Valley stops/roads (`data/raw/valley-*.json`) | Done |
| Geometry: `tools/prepare-geo.mjs` → `data/koteshwor.geo.json` | Done. All 553 eligible OSM footprints retained, with 75 flagged frontage fillers. Both named bus stops matched to lanes. |
| Vehicles/props: `tools/blender/build_assets.py` → `public/models/{vehicles,props}.glb` | v2 done and accepted (polish nits in review-notes) |
| Simulation core `src/sim/` + `tools/test.mjs` | Done. Three signal phases plus Seti give-way access. Verified far-side dwelling and junction spillback, stop provenance, and demand-sensitive delay. |
| Fix round: review-notes 1–7 and delay sanity | Done. Geometry regenerated, map and lanes inspected in plan view, and all 15 simulation tests pass. |
| Koteshwor 3D scene: `tools/blender/build_scene.py` → `public/models/junction.glb`, `koteshwor.blend` | Done, scene v2. The 21.76 MB +Y-up GLB embeds 46 textures and includes the four game markers. All 2,731 sampled simulation path positions are on asphalt. |
| Overview review: `logs/review-scene-v1.png` | Done and visually checked at 1600 × 900. The blend is configured for EEVEE. The headless run used CPU Cycles after Metal initialization failed. |
| Blender stills: `tools/blender/render_stills.py` → `public/renders/*.png` | To do |
| Game UI + Three.js renderer + audio (`src/render`, `src/game`, `src/ui`) | To do |
| Valley audit screen from `data/raw/valley-*.json` | To do |
| Playwright check `tools/browser-check.mjs`, `npm run build`, README | To do |

## Geometry and simulation verification

- Building counts in NW, NE, SW, SE order are 888/146/611/300 in the raw extract and 329/1/178/45 intersecting the 320 m disk. All 553 eligible OSM buildings were kept whole. The one northeast footprint reaches into the edge of the disk. The 75 frontage fillers are tagged `filler: true` with source `procedural, not from OSM`. The Blender scene also labels illustrative background buildings.
- Seti O.P. Marg joins NH39 at OSM node 6275508140. The mapped local-to-north connector is way 1132401297. The give-way rule, restricted turns and 20–38 vehicles/hour are game assumptions. [JICA preparatory survey, appendix 5.3](https://openjicareport.jica.go.jp/pdf/12382388_04.pdf)
- Use `state.rules.arms[arm].stops` for current stop markers. Map provenance is exposed by `osmId` and `assumed`. The move-stop input takes `arm`, optional `stopId`, `side: 'far'`, optional `exitArm`, `laneIndex`, and `distance` in metres downstream from the outgoing lane entrance. Near-side distance is measured upstream of the stop line. A stop on the far side is served by transit whose route already passes through that exit. Show the assumed plate format, control timing, compliance rates and filler provenance in How it works.
- In the original seed-235 Sandbox, 555 vehicles entered, 160 exited and none waited at the spawn boundary at the end. Its demand exceeded the model's discharge capacity. A long four-arm cycle, conflicts between movements and braking at path joins reduced discharge. The updated model uses three phases, a 62 s assumed cycle, clearer lane assignments and continuous speed and following across lane joins. Sandbox demand is calibrated as a distinct light case. The 600 s mean delay for completed trips is 164.9 s in Morning rush, 58.8 s in Sandbox and 21.0 s at 10% of Sandbox demand. Person-delay also counts time accrued by vehicles still on the network. `npm test` prints the exit and admission counts alongside delay, plus the building counts.

## Update 19:55
Product is now a simulator, not a game: Now vs Short-term vs Long-term on identical traffic (src/game/plans.js, createRun in src/game/levels.js).
- Short-term package: adaptive signals, lane discipline (no weaving last 40 m), stops moved 60 m into off-lane bays, guardrails, marked crossings with walk phase.
- Long-term: cut-and-cover tunnel for Tinkune(north)<->Jadibuti(east) through traffic (bypass in src/sim/agents.js, drawn by src/render/tunnel.js, x-ray), pedestrian underpasses, plus adaptive signals and bays.
- data/measure-effects.json = 5-seed averages per condition (node tools/measure-effects.mjs). Rerun after any sim change.
- Fixed: bus-bay deadlock, multi-slot bays, lane-discipline only blocks through weaving, stray OSM roads removed from Blender scene.
- NOT yet verified in a browser (user said no Chrome for now). Next: visual check of HUD, stage box, tunnel build, results screen.

## Update 20:05
- Verified against the OSM tile (logs/osm-koteshwor.png): Koteshwor is a 3-arm Y (Ring Rd N along airport, Ring Rd SW to Balkumari, Araniko SE to Jadibuti). West (Seti) arm demand = 0; NE = airport land (no fillers/fabric); Kot Devi ground open.
- Junction surface: world-aligned UVs on swept turn paths (no criss-cross patchwork); paving kept >45 m from centre. Bird camera north-up at 230 m.
- Stepper UI (1 Now / 2 Short-term / 3 Long-term), how-it-works box, results with 3 columns. Not yet visually re-checked in browser after these edits.
- Remaining polish: dusk still weak; cars slightly wagon-like; screenshot pass of new HUD/results.

## Update 20:08
- Ground matches satellite: airport grass east of Ring Rd/Araniko, Kot Devi green south; no fillers/fabric on airport.
- Ring Road SW paved as one corridor (DONE 20:08). Remaining: browser re-check, dusk still, car shapes.
- 20:10 tunnel walls removed (x-ray walls looked like a wall on the road).

## Update 20:17
- At the user's request, replaced sandy terrain, shoulders, and median infill with grass. Rebuilt `koteshwor.blend`, the junction GLB, and all four stills.
- Visually checked the new overview still. The dev server and `dist` serve identical junction GLBs. The browser view remains pending visual review.

## Update 20:20
- Gave the southwest Ring Road surface priority over the individual road strips and aligned its asphalt texture with the junction. Rebuilt the scene, GLB, and stills. Verified the paved join in the bird render and checked asphalt coverage at 2,505 simulation path samples.

## Southwest branch footprint correction
- The satellite reference shows separate frontage roads. Removed the broad infill between them and shortened the paved junction apron, keeping asphalt on the mapped carriageways and simulated turns.
- Checked the rebuilt bird render, 2,505 path samples, and the GLB served by Vite.

## Continuous simulation and Long-term cutaway
- Interactive runs continue until paused. Results pauses all three plans and shows a snapshot of the elapsed run. Returning from Results preserves the selected plan and camera. Ten minutes remains the benchmark duration.
- Long-term includes a switchable tunnel cutaway with portal labels and stair-access pedestrian skybridges. Tunnel trips contribute to throughput when they exit. The benchmark data and browser checks cover the current flow.

## Short-term and long-term plan guide

- Open **Plan guide** from Home, the simulator or Results. It explains how each implemented measure works, what to watch in the simulation and what would need verification at Koteshwor. It also records earlier intervention experiments.
- The simulator and benchmark generator use the same measure definitions. Regenerating the five-seed benchmarks for all five traffic conditions reproduced the stored results.
