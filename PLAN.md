# Rokne Thau (रोक्ने ठाउँ): build plan

**Constraints:** no filming or field data collection. We build only with Blender, HTML, CSS and JS. Evidence comes from public data (OpenStreetMap, published studies, standard traffic engineering formulas), from online surveys, and from expert review of a live demo.

## 1. The product in one sentence

A free web tool that **finds bus stops placed too close to Kathmandu junctions and shows, in 3D, how many vehicles per green are lost and how many are recovered by moving the stop**. It's built for KMC's traffic section, the traffic police and BuildCities judges.

**Why this problem:** police name roadside pick-up and drop-off as a cause of peak jams (long-distance buses were pushed into bus parks in Dec 2025). A quick check of OpenStreetMap already shows 198 mapped stops in the Valley core, with 13 within 100 m of a mapped traffic signal. One example is Koteshwar Bus Stop, about 16 m from the signal. OSM is incomplete, which is why part 1 also measures distance to major road intersections, not just signals.

## 2. What we're making: three parts plus a landing page

### Part 1: Stop Audit map (`/audit`, HTML, CSS, JS and SVG)
- A Node script pulls bus stops, platforms, signals and primary/trunk/secondary roads for the Valley from the OSM Overpass API, then saves `data/stops.json` and `data/junctions.json`. Junctions are signals plus nodes where two major roads meet.
- For every stop: distance to the nearest junction, which side it's on (before or after the stop line), and road class.
- The page draws the road network itself as SVG, with no map tiles needed. Stops are coloured by risk: red under 50 m, amber 50–100 m, grey otherwise. A sortable "worst 20" list and filters are included.
- Every stop has a "Report a correction" link to edit OSM. Credit: "© OpenStreetMap contributors, ODbL".
- **Output proof point:** "X stops within 50 m of a major junction across the Valley", which anyone can reproduce with one command.

### Part 2: Junction Lab (`/lab`, Blender, Three.js and JS)
- **Hero junction: Koteshwor**, where Ring Road meets Araniko Highway and the OSM data shows a stop about 16 m from the signal. Second junction: New Baneshwor, the busiest one in published studies. Add more only if time allows.
- A deterministic **mixed-traffic micro-simulation** in pure JS, testable in Node:
  - Lanes are cells, about 1 m per cell, updated every 0.5 s.
  - Vehicle types: motorcycle, car, microbus, Sajha bus and safa tempo. Each has its own length, acceleration and the ability to filter between lanes. Motorcycles can squeeze past, which matters in Kathmandu.
  - Signal plan with fixed timings taken from published studies where available. A "police manual control" mode uses longer, variable phases.
  - Buses and microbuses stop at the curb, and their dwell time comes from boarding passengers. A stopped vehicle blocks its lane, and others merge around it.
- **The interaction:** drag the stop marker along the curb (from 0 m to 80 m past the junction) or toggle "no stopping within 30 m". Two synchronized 3D views show current vs proposed.
- Metrics shown:
  - vehicles per green
  - queue length
  - mean delay per vehicle
  - bus passenger delay
  - **extra walking distance for passengers** (the honest trade-off)
- A **cross-check panel** compares the simulation's capacity loss with the Highway Capacity Manual bus-blockage factor, `f_bb = (N − 14.4·N_B/3600) / N`, where N is lanes and N_B is buses stopping per hour. If the two disagree by more than 15%, the panel says so.
- A **sensitivity panel** shows the result across low, medium and high arrival volumes, bus counts and dwell times, so nobody reads one lucky run as the answer.

### Part 3: Commuter pulse (`/pulse`, HTML, CSS and JS)
- A short page shared in BuildCities chat and on social media. Its questions: "Where do you board? Does your bus stop before or right at the junction? How far would you walk to a proper stop?"
- Answers are collected through a Google Form linked from the page, so no backend is needed. Results are summarised as charts on the page.
- **Output proof point:** n responses, and the walking distance people accept. That number feeds the Lab's trade-off slider.

### Landing page (`/`)
Problem → audit headline number → Lab demo → results table → method and sources → pilot ask to KMC.

## 3. Blender deliverables

| Asset | Details |
|---|---|
| `koteshwor.blend` → `koteshwor.glb` | Road surface, lane markings, footbridge, median, curb, nearby building blocks as simple masses. Built to scale by tracing the OSM road geometry. |
| `baneshwor.blend` → `baneshwor.glb` | Same approach. Stretch goal. |
| `vehicles.blend` → `vehicles.glb` | Motorcycle, car, microbus (white Hiace style), Sajha bus (blue electric), safa tempo (white and green). Low poly, origin on the ground, facing +X. |
| `stop-kit.glb` | Stop bay paint, Nepali and English sign, shelter, cones, "no stopping" hatching |
| Named anchors | `lane_{approach}_{n}_{start,stop,end}`, `curb_{approach}`, `signal_{approach}`, `camera_overview` |
| Renders | 4 stills and one 20-second turntable, for BuildCities and the pitch deck |

Use the reference photos in `references/` for colours and vehicle shapes. A Python script in Blender rebuilds the scene from OSM coordinates so geometry isn't hand-placed.

## 4. Tech stack and repo layout
- Plain HTML, CSS and ES modules, with Three.js vendored locally. No framework or login.
- Hosted free on GitHub Pages or Netlify, so judges can open a link.
- `npm test` runs the simulation, cross-check and audit unit tests in Node.

```
index.html  audit/  lab/  pulse/
src/sim/        # pure JS simulation (tested)
src/view/       # Three.js rendering
src/audit/      # distance and risk logic (tested)
tools/fetch-osm.mjs  tools/build_scene.py  tools/test.mjs
data/  models/  references/  docs/
```

## 5. Proof points we can actually produce

1. **OSM audit:** count, list and map of stops close to junctions, reproducible.
2. **Calibration:** the base-case Lab throughput falls within the ranges published for Koteshwor and New Baneshwor. Numbers come from the NepJOL and JICA studies, each cited by page.
3. **Independent cross-check:** the simulation agrees with the HCM bus-blockage factor.
4. **Sensitivity table:** the range of benefits, including cases with no benefit.
5. **Commuter survey:** response count and accepted walking distance.
6. **Expert review:** demo sent to KMC traffic section, Metropolitan Traffic Police Division, and IOE Pulchowk and Thapathali transport faculty. Collect written comments and, ideally, a support letter.
7. **BuildCities activity:** weekly progress posts and community feedback, which the challenge explicitly scores.

## 6. Estimated traffic reduction: how we'll state it
Per junction: modelled **% more vehicles per green** and **reduction in mean delay**, shown as a range from the sensitivity runs and cross-checked against HCM. Valley-wide: those ranges multiplied across the audit's high-risk stops, clearly labelled as a modelled estimate pending a field pilot. Every figure comes from the code, not written by hand. No number is claimed until the model produces it.

## 7. Six-month schedule

| Month | Phase | Deliverable |
|---|---|---|
| 1 | Ideation and research | BuildCities project linked. OSM fetch script and first audit numbers. Signal timings, counts and saturation flows extracted from studies into `docs/sources.md`. Survey live. |
| 2 | Research and design | Audit map v1 public. Koteshwor Blender scene and vehicle set. Simulation core with tests and HCM cross-check. |
| 3 | Development | Lab v1: 3D, drag the stop, side-by-side views, metrics. Calibration pass. |
| 4 | Testing | Sensitivity runs, usability test with 5–10 people online, survey results added to the trade-off. Demo sent to KMC, police and faculty. |
| 5 | Pilot proposal | Results page, New Baneshwor as a second junction (stretch). One-page pilot ask: move one Koteshwor stop and measure it. Expert feedback added. |
| 6 | Deployment and demo | Hosted site, renders, 3-minute judge presentation, handover README. |

## 8. Judge demo (3 minutes)
1. Audit map: "Here are the stops sitting right on junctions, across the whole Valley."
2. Click Koteshwor, and the 3D Lab opens. A bus stops at 16 m and the curb lane dies on green.
3. Drag the stop to 50 m and press play. Both views run the same traffic, and the metrics diverge.
4. Point to the sensitivity range and the walking trade-off from the survey.
5. The ask: "Let KMC move one stop for one month, and we'll compare with this prediction."

## 9. Next 7 days
1. Create the BuildCities project and post the one-sentence pitch above.
2. Write `tools/fetch-osm.mjs` and produce the first full audit table.
3. Pull Koteshwor road geometry from OSM and block it out in Blender.
4. Find signal timing and volume figures for Koteshwor and New Baneshwor in the NepJOL and JICA papers.
5. Publish the survey.

Reference photos and credits: `references/README.md`. Background facts and sources are in our chat notes and should be moved into `docs/sources.md` in week 1.
