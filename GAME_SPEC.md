# Rokne Thau: Koteshwor Chowk (game spec)

A browser traffic-management **game** set at the real Koteshwor junction in Kathmandu. The player is a junction planner working with Kathmandu Metropolitan City (KMC). They make changes to the junction, watch a real-time 3D simulation react, and get feedback on every change. Everything ships as a static site built with HTML, CSS and JS (Vite plus Three.js). 3D assets are made in Blender by Python scripts and exported to GLB. High-quality still images are rendered in Blender.

## Hard rules
- No backend, login or API keys. The game runs from `npm run dev`, or as a static build from `dist/`.
- Do the real work. No placeholder features, and no "TODO" left in user-facing paths.
- Every number shown to the player comes from the simulation. Parameters live in one file, `src/sim/params.js`, and each one has a comment saying "source: …" or "assumed".
- The simulation is deterministic for a given seed and lives in pure JS modules that Node can run without the DOM. `npm test` covers it.
- Keep performance at 60 fps on a laptop with about 300 vehicles. Use InstancedMesh per vehicle type, and do no per-frame allocation in hot loops.
- Credit "© OpenStreetMap contributors (ODbL)" in the UI wherever map-derived geometry is used.

## Real-world basis
- Geometry: `data/raw/koteshwor.json`, an Overpass export with roads, bus stops, signals and building footprints around 27.6787 N, 85.3494 E. Convert lat/lon to local metres with an equirectangular projection centred on the junction. +X is east, −Z is north in Three.js, and +Y is north in Blender.
- Koteshwor is where Ring Road (north arm toward the airport and Tinkune; south arm toward Balkumari and Satdobato) meets the Araniko Highway (east arm toward Bhaktapur). Check the arm names against the OSM `name` and `ref` tags and use what OSM says.
- Known issue to model: "Koteshwar Bus Stop" sits about 16 m from the signal in OSM. Buses and microbuses stop at the curb near the stop line and block the lane.
- Regional data in `data/stops-valley.json` (if present): bus stops and signals in the Valley, used for the "Valley audit" screen.

## Realism targets for the 3D (very important)
The scene should read as a real Kathmandu chowk, not a toy.
- **Roads:** real OSM alignment and widths. If OSM has no `lanes` tag, use trunk = 2–3 lanes per direction. Include the median with a railing and dusty planter, worn lane paint, zebra crossings, curb stones, uneven shoulders with dust and sand, manholes, and potholes or patching.
- **Buildings:** OSM footprints extruded at 3–7 storeys (deterministic from the id). Kathmandu style:
  - concrete frames with brick or plastered infill in pastel, cream or terracotta
  - ground-floor shop shutters and colourful signboard panels
  - small balconies, rooftop black water tanks, rebar stubs on top floors
  - some unfinished floors
- **Street clutter:** electric poles with tangled overhead wires (catenary curves), streetlights, a footbridge over Ring Road if OSM shows one (else place one north of the junction), a traffic police booth with an umbrella, a bus-stop shelter, tea stalls, and parked motorcycles.
- **Vehicles**, low-to-mid poly with clear silhouettes. Number plates use an assumed format, with red for private vehicles and black for public vehicles and taxis.
  - motorcycle with rider and helmet, the dominant mode
  - small hatchback car (white, silver or red)
  - taxi (small car, black plate)
  - white Hiace-style microbus
  - blue Sajha electric bus
  - older long-route bus (painted, colourful)
  - safa tempo (white with a green stripe)
  - pickup or truck
- **People:** simple low-poly pedestrians (instanced) who wait at the curb and cross.
- **Atmosphere:** warm low sun, soft shadows, light haze or dust (fog), hills silhouette on the horizon (the Valley rim), sky gradient.
  - Three.js: PBR materials, `ACESFilmicToneMapping`, sRGB output, shadow-mapped directional light, a `RoomEnvironment` or PMREM environment, subtle fog.
  - Blender stills: Cycles or EEVEE with the same mood.
- Use procedural textures (asphalt noise, paint wear, plaster grime) **baked to image textures in Blender** and exported inside the GLB, or generated in-browser with canvas. Either way they must look like real materials, not flat colours.
- Reference photos are in `references/images/` (see `references/README.md`). Match colours and shapes to them.

## Simulation model (`src/sim/`)
- **Network:** NH39 north, NH39 southwest and NH34 Araniko are the three signalised arms. Minor Seti O.P. Marg uses its mapped connection with assumed give-way access and low demand. Each permitted movement has a polyline through the junction. Nepal drives on the left. Some left turns are free.
- **Agents:** vehicles with type, length, max speed, acceleration and deceleration, desired gap, and a "lane discipline" value. Motorcycles can filter between lanes and stack at the stop line. Vehicles follow paths using an IDM-style car-following model. Lane changes use simple gap acceptance.
- **Buses, microbuses and tempos:** they pick a stop (official, or "anywhere" with some probability near the junction). Dwell time = base + passengers × boarding time. A vehicle dwelling in a traffic lane makes others wait or merge. On the far side, a queue behind the dwelling vehicle can spill back into the junction.
- **Signals:** phase plan with editable green splits. Modes are fixed-time and "traffic police manual" (longer and variable phases).
- **Pedestrians:** arrive at crossings, cross on a pedestrian phase or a zebra. Unsafe crossings happen when waits are long and are counted as safety conflicts.
- **Demand:** per-arm, per-movement arrival rates by time-of-day scenario, with vehicle mix about 70% motorcycles, 15% cars and taxis, 8% microbuses and tempos, 4% buses, 3% trucks (assumed; label it in params). Seeded RNG.
- **Clock:** fixed-step simulation (0.25 s), decoupled from rendering, with speeds 1×, 2×, 4× and 8×, and pause.
- **Metrics,** updated live and per 5-minute window:
  - throughput (vehicles/hour and **persons/hour**, using occupancy by type)
  - mean and 95th percentile delay
  - queue length per arm
  - lane-blocked seconds caused by curb dwelling
  - bus passenger delay
  - pedestrian wait and unsafe crossings
  - added walking distance for bus users
  - idle emissions estimate (CO₂ kg from idling seconds, labelled as an estimate)
  - cost spent

## Game design
- **Title screen:** a cinematic slow orbit of the 3D chowk, the game name, and Play, Valley audit, How it works and Credits.
- **Scenarios (levels),** each about 10 minutes of simulated time, with objectives and 1–3 stars:
  1. *Morning rush*: cut person-delay 20% without raising pedestrian conflicts.
  2. *Bus bunching*: Sajha and microbuses all stopping at the stop line.
  3. *Evening peak + rain*: lower speeds, longer dwell.
  4. *Dashain exodus*: heavy eastbound demand toward Bhaktapur.
  5. *Sandbox*: free play, with all tools unlocked.
- **Budget** in NPR for each level. Tools cost money and some take build time.
- **Tools / interventions** (the player places them in 3D with the mouse; each has a hover preview, a cost and an undo):
  1. **Move bus stop**: drag the stop along the curb or onto an outgoing lane beyond the junction. Show its distance in metres from the near-side stop line or the far-side lane entrance.
  2. **No-stopping zone**: paint hatching on a curb segment, from 10 to 60 m.
  3. **Bus bay (lay-by)**: an indented bay, so dwelling vehicles leave the lane. Costs more.
  4. **Signal timing**: sliders for phase splits and cycle length, with a live phase diagram.
  5. **Traffic police officer**: placed at a location. Raises compliance with no-stopping and bus-stop rules there. Has an ongoing cost.
  6. **Zebra crossing / pedestrian signal**: place a crossing, which affects pedestrian safety and vehicle delay.
  7. **Free left-turn lane**: toggle a channelised left turn per arm.
  8. **Public information campaign**: raises driver compliance across the whole junction a little. Cheap.
- **Feedback on everything:**
  - **Instant preview:** while placing a tool, show its predicted local effect, for example "This bay removes about 70% of curb blockage on the east arm".
  - **Advisor panel** (the "Traffic Inspector" character): short, specific messages explaining causes, based on simulation events. Examples:
    - "Microbus Ba 2 Kha 1234 dwelled 38 s at 14 m from the stop line. Lane 1 lost 9 vehicles this green."
    - "Your zebra crossing at the south arm cut unsafe crossings from 12 to 2, but the southbound queue grew by 40 m."
  - **Change log:** every change creates a card with the deltas it caused (before/after for the 5 minutes on each side).
  - **A/B ghost:** a "compare with baseline" toggle runs the same seed without changes in a second, smaller viewport (picture-in-picture), with live deltas.
  - **3D overlays:** a heatmap of queue density on the road, red pulsing outlines on blocking vehicles, signal state above each stop line, floating "+12 s" delay popups (throttled), and a pedestrian conflict icon.
  - **Charts panel:** time series for throughput, delay and queues (lightweight canvas charts).
  - **End-of-level report:** a grade, stars, objective checklist and the top 3 causes of delay. It explains what worked and what backfired, and ends with an honest "what this model doesn't capture" note.
- **Camera:** orbit, pan and zoom (OrbitControls with limits), presets (Overview, Street level, Bird's eye, Follow vehicle), and click a vehicle to inspect it (type, plate, delay so far, route).
- **Juice:** smooth tweens on UI, ambient city audio (synthesised with WebAudio: low horn honks probability-scaled with congestion, engine hum; mute toggle), subtle UI sounds, a short tutorial overlay for level 1.
- **Valley audit screen:** an SVG map of the Valley's mapped bus stops coloured by distance to the nearest signal or major junction, with a list of the worst 20. Koteshwor is marked as "Playable".
- **How it works screen:** model assumptions, parameter sources, limitations, OSM credit and photo credits. Label invented stops and plate formats as assumed. Identify procedural frontage buildings and label the officer, campaign and no-stopping compliance effects as assumed.
- **Mobile:** it must work on phones (touch controls and a collapsed HUD), but desktop is primary.

## Look and feel of the UI
- Dark glass HUD panels over the 3D scene, an accent colour of Nepali crimson (#DC143C) with deep blue (#003893) from the flag, and a clean sans-serif typeface (system font stack).
- Readable, purposeful and not cluttered: top bar for time, speed, budget and score; left tool palette; right advisor and metrics; bottom collapsible charts.

## Files

```
index.html
src/main.js               bootstraps screens
src/sim/*.js              pure simulation (geometry, network, agents, signals, metrics, scenarios, params, rng)
src/game/*.js             levels, objectives, tools, scoring, advisor, changelog
src/render/*.js           three.js scene, GLB loading, instancing, overlays, camera
src/ui/*.js + src/ui/style.css
src/audio.js
data/koteshwor.geo.json   processed local-metre geometry (generated by tools/prepare-geo.mjs from data/raw)
public/models/*.glb       exported from Blender
public/renders/*.png      Blender stills
tools/prepare-geo.mjs     OSM → local geometry
tools/blender/build_scene.py     builds koteshwor.blend + GLBs from data/koteshwor.geo.json
tools/blender/render_stills.py   renders 4 stills
tools/test.mjs            node tests for sim + game logic
tools/browser-check.mjs   Playwright smoke test (WebGL, play a level, place tools, no console errors)
README.md
```

## Done means
1. `npm run build` succeeds and `npm test` passes.
2. The Blender scripts run headless (`/Applications/Blender.app/Contents/MacOS/Blender -b --python ...`) and produce `koteshwor.blend`, `public/models/junction.glb`, `public/models/vehicles.glb`, `public/models/props.glb` and 4 PNG renders.
3. The game is playable end to end: title, level, tools, feedback, report, and the next level.
4. The Playwright smoke test passes with no console errors.
