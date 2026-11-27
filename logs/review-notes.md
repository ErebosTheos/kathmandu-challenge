# Technical and visual review notes

## Sim job (partial review, 18:33)
OK
- params.js labels nearly every constant as "assumed" or names a source. Good.
- Real OSM arms: NH39 north/south, NH34 Araniko, west local Seti O.P. Marg. Mapped Koteshwar stop used as official stop.

To fix (send after job finishes)
1. Stops can only be placed upstream of the stop line (near side). The standard remedy is a FAR-SIDE stop (after the junction, on the outgoing lane). Move-stop tool must allow far-side placement on outgoing lanes, where dwelling blocks the exit lane instead (with its own spill-back risk).
2. transit.planStop gives a built-in compliance bonus just for moving the stop (TOOLS.moveStop.compliance). That bakes the benefit into an assumption. Keep it only if exposed and labelled in How it works; the benefit should come mainly from where vehicles physically stop.
3. Plate "source: GAME_SPEC.md" is not a real source; relabel as assumed format.

## Visual review of geometry + sim lanes (18:35, plotted data/koteshwor.geo.json + createNetwork())
4. NE quadrant of the junction has ZERO buildings. Raw OSM has none mapped there (NW 351, SW 213, SE 85, NE 0 within 300 m). In 3D this will look like an empty field. Fill road frontage with procedurally generated buildings, flagged in data as "filler: not from OSM", and say so in How it works.
5. prepare-geo drops many buildings (SE 85 raw -> 34 kept, SW 213 -> 157). Check clipping/filter; keep every footprint within 320 m.
6. The "west" arm (Seti O.P. Marg) runs almost parallel to the Ring Road south arm, a few metres away; its turn paths cross the main south carriageway. Verify it is a real 4th approach; if it is a parallel service road, model Koteshwor as the real 3 main arms (NH39 N, NH39 SW, NH34) plus the local road as a minor give-way approach.
7. Only one of the two mapped Koteshwar Bus Stops (north arm, 11 m from stop line) is used; the second (further north) is ignored. Other arms get an invented stop at 22 m - label as assumed in UI.

## Visual review of first GLB export (18:38, rendered in Blender myself)
Good: Motorcycle+rider (helmet, backpack) reads well. Microbus reads as white Hiace. Sajha bus blue with roof battery pack. Police person, police booth with umbrella, electric pole with transformer, street light, tea stall, railing, planter all recognisable. Real-world sizes are right (bus 9-10 m, car 3.7 m, motorcycle 2 m).
Fix:
8. Taxi is YELLOW - wrong for Kathmandu. Taxis are mostly white/silver small cars (Suzuki/Hyundai hatchbacks) with BLACK plates and a small roof TAXI sign.
9. Car is an old wagon/sedan; spec says small hatchback (Alto/Swift/i10 style) - most common private car in Kathmandu.
10. Safa tempo body is bulbous/odd; real one is a boxy cab-forward three-wheeler with a short rounded nose, single front wheel, white body with green band, rear open step.
11. Materials look matte/plasticky: add visible number plates, glass reflectivity, subtle dust/grime on lower body, darker tyre sidewalls. Old long-route bus should be more colourful/decorated (painted designs, roof carrier).

## Visual review of vehicles v2 (18:47) - ACCEPTED for now
Fixed: taxi now white with roof TAXI sign; 4 car colours; dust gradient on lower bodies visible; old bus colourful with roof luggage; microbus roof rack; motorcycle still good.
Remaining polish: cars still read as wagons (rear too long) rather than hatchbacks; safa tempo cab too tall/car-like at front.

## Visual review of Koteshwor scene v1 (19:01, logs/review-scene-v1.png)
Good: real road layout with divided carriageways, gantry sign (Airport/Tinkune, Araniko Highway, Balkumari), signal heads, zebras, overhead wires on poles, police booth, bus shelter, tea stall, traffic mix, hazy hills. Reads as a city junction.
Scene fixes:
12. Buildings read as huge uniform slab blocks (Soviet-style). Kathmandu = narrow individual 4-6 storey buildings, each a different colour/height/window pattern, dense signboards on lower floors, rooftop tanks/railings/unfinished floors. Split long footprints into narrow plots, vary heights per plot, vary facade textures.
13. East/north-east side is empty sand. Add many more filler buildings along all road frontage beyond the OSM gap (flagged filler).
14. Trees are cartoon blobs; use more natural canopy (clusters, darker greens).
15. Sky flat grey; add gradient sky + warm sun for stills.
19:05 update: fixed 12 (plots 4-8 m with own plaster, party-wall columns, extra storeys/rooftop rooms), 13 (filler in all quadrants: 75 plots, plus illustrative city fabric to 900 m labelled "not from OSM"). junction.glb 21.8 MB. Accepted as scene v2. Remaining polish: trees (14), sky (15), near-east sand patch.
