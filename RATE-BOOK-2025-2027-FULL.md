# JIC Rate Book 2025–2027 — Full Schedule and Gap Check

**Source:** TRU Construction Estimator rate-book pages as pasted by the owner (imperial). **Currency:** JMD. **Compared against:** `JIC_Rate_Book_2025-2027.md` and `JIC_RATES` in `js/calculator-page.js` from `mymanager-fixed`.

## 1. Headline

- **830 rows pasted, 19 exact duplicates removed, 811 unique rates.**
- **The app ships 100 of 811 (12.3%).** It carries only the first 9 or 10 rows of each of the 11 trades. **711 rates are not in the app.**
- All 100 shipped rates match your paste exactly (imperial rate and unit). The shipped Markdown file and the rates inside `calculator-page.js` also agree with each other (100 rows checked, 0 differences).
- Metric rates for the rows the app does not ship are **calculated** from the imperial rate (method in section 6). The shipped rows keep the source's own metric figures.

## 2. Coverage by trade

| Trade | Unique rates in full book | In the app | Missing | Coverage |
|---|---:|---:|---:|---:|
| Excavation | 95 | 9 | 86 | 9% |
| Carpentry | 99 | 9 | 90 | 9% |
| Steelwork | 21 | 9 | 12 | 43% |
| Masonry | 100 | 9 | 91 | 9% |
| Scaffolding | 16 | 9 | 7 | 56% |
| Tiling | 34 | 9 | 25 | 26% |
| Painting | 74 | 9 | 65 | 12% |
| Joinery | 100 | 10 | 90 | 10% |
| Plumbing | 100 | 9 | 91 | 9% |
| Electrical | 72 | 9 | 63 | 12% |
| Welding | 100 | 9 | 91 | 9% |
| **Total** | **811** | **100** | **711** | **12%** |

## 3. What the app is missing (by priority)

These are the gaps that matter most for a typical building estimate. Reference numbers are the JIC numbers in section 7.

| Priority | Gap | Refs | Why it matters |
|---|---|---|---|
| 1 | Ceramic floor and wall tiles (4", 6", 8", 12"+), skirting, treads, risers, mosaic, vinyl | Tiling #11–#34 | The app only has terrazzo and marble. Ceramic tile is the most common finish and has no rate. |
| 1 | Rendering, plaster, rough cast, pebble dash, steel finish, granite finish, fairface, screeds and floor finishes | Masonry #22–#23, #33–#100 | Every wall and floor needs a finish. Only block laying is shipped. |
| 1 | 4" blocks and breather blocks | Masonry #11–#19 | Only 6" and 8" blocks are shipped. Internal partitions are usually 4". |
| 1 | Concrete placing (by hand, Carmix, crane), foundations, columns, beams, slabs | Excavation #34–#42, #59–#77 | Structural concrete labour has no rate. |
| 1 | More digging cases (trenches, kerbs, deeper digs, loose soil), backfill, hauling, loading trucks, topsoil, demolishing block walls, site clearing, trees, culverts | Excavation #10–#33, #43–#58, #78–#99 | Only nine digging rates are shipped. Moving, placing and clearing soil has no rate. |
| 1 | Roofing: sheeting, shingles, tiles, lath, felt, flashing, gutters, fascia, ridges and valleys | Carpentry #39–#71, #86–#89 | The app's "Carpentry (Formwork)" has no roof rates at all. |
| 1 | Plumbing fixtures: basins, sinks, WC, urinal, bath, shower, heater, roof drains | Plumbing #49–#62 | Only pipe runs are shipped. No fixture is priced. |
| 1 | Electrical points and boards: sockets, switches, boxes, panels (100–200 A), breakers, wiring | Electrical #14–#85 | Only conduit is shipped. No outlet, switch, board or cable is priced. |
| 2 | Timber framing, partitions, bearers, battens, rafters, gypsum and plywood lining, plaster tape | Carpentry #20–#38, #72–#85 | Interior carpentry is missing. |
| 2 | Doors, frames, mouldings, handrails, stairs, cupboards, French doors, bathroom fittings | Joinery #13–#60, #81–#100 | The app's "Joinery (Skirtings)" is skirtings only. |
| 2 | Oil paint, varnish, preservative, floor paint, doors, fascia, gutters, tanks, roof seal | Painting #10–#74 | Only emulsion on walls and ceilings is shipped. |
| 2 | Pipe fittings (single to four end), P-traps, Schedule 40 pipe and fittings, push-fit fittings | Plumbing #12–#48, #63–#100 | Needed for drainage and supply take-offs. |
| 2 | Stirrups (1/2"), links, chairs, high-tensile rebar | Steelwork #10–#21 | Reinforcement detail is incomplete. |
| 3 | Scaffolding boards, strengthening, dismantling | Scaffolding #10–#16 | Erect is shipped but dismantle is not. |
| 3 | Welds (fillet, butt), drilling, steel pipe and plate fitting, covers and brackets | Welding #15–#100 | The shipped "Welding" rows are actually torch and CPSAW cutting (see finding 2). |

## 4. Findings that need a decision

Decisions recorded by the owner 2026-10-12 (findings 1, 2, 3, 5 acted on; 4 and 6 are information for the full-book wave).

1. **Steelwork #6 Fabric: the shipped metric rate looks wrong.** It is stored as JMD 276.00 per m². The imperial rate is JMD 125.00 per yd². Converting properly gives about JMD 150 per m². Every other per-yd² row in the shipped book converts at the normal factor. 276 is 125 multiplied by the pounds-to-kilograms factor, so it looks like a unit mix-up on the source page that was copied across. The calculator uses this figure for mesh, so metric mesh pricing is probably about 85% too high. **Check against JIC's printed metric rate before changing it.**
   **DECIDED (owner 2026-10-12: "Fix the wrong Fabric metric rate") - FIXED.** The row and the shipped book now carry **149.00** (125 ÷ 0.83612736). A permanent gate now checks every row against the section 6 conversion rules at a 6% band, and names this row explicitly, so it cannot drift back: measured across all 100 shipped rows the worst divergence is now 4.99% (Painting #5/#6, a rate under JMD 20 where the source's own dollar rounding is worth several percent), while the broken 276 sat at 84.6%.
2. **The shipped Welding rows are mislabelled.** Welding #1–#9 are shown as "1/8" thick metal, using torch" and so on. The source description is "Handle Mark Cut & Sand Smooth … Thick Metal Using Torch". The shipped rows price cutting and smoothing, not welding. The real weld rates (fillet and butt, #63–#67) and drilling rates are not shipped. Restore the full descriptions.
   **DECIDED (owner: "Restore full Welding descriptions") - FIXED.** The rate table, the work-item picker labels and the shipped book all now read "Handle Mark Cut & Sand Smooth: 1/8 in thick metal using torch" and so on. Note the honest consequence: these nine rows price CUTTING AND SMOOTHING, not welding. The name "Welding" overstates them; the real weld rates arrive with the full book (section 3, priority 3).
3. **Trade labels understate scope.** The app calls them "Carpentry (Formwork)", "Joinery (Skirtings)" and "Electrical (Conduit)". In the source book these trades also cover roofing and framing, doors and cupboards, and wiring and fittings. Rename them once the missing rows are added.
   **DECIDED (owner: "Rename the understated trade labels") - DEFERRED to the full-book wave, deliberately.** `JIC_BOOK_MAP` keys on the literal trade label text, so renaming first would break the book payload silently. The rename runs AFTER stable trade keys are in place.
4. **Six trades end at exactly #100.** Excavation, Masonry, Carpentry, Joinery, Plumbing and Welding all stop at #100. That looks like a display limit on the source page. If the source has more rows, they are not in this file. Painting (74), Electrical (85), Steelwork (21), Tiling (34) and Scaffolding (16) end below 100 and look complete.
5. **The shipped file footer is wrong.** It says "90 line items" but the table has 100 rows.
   **DECIDED (owner: "Fix the shipped file footer") - FIXED.** The footer now says 100, and the gate counts the rows out of the file rather than trusting the printed number, so a mismatch fails the build.
6. **Same description, different rate.** 20 groups (section 5b) look like duplicates but carry different rates. They are kept. Most look like a second price basis, such as Joinery #61–#100 against #1–#60, or two conduit types for Electrical #3–#6 against #7–#10. The source page drops the wording that tells them apart, so they should be labelled once you know what separates them.

## 5. Duplicates

### 5a. Exact duplicates removed (same description, unit and rate)

| Removed | Same as | Description | Unit | Rate |
|---|---|---|---|---:|
| Excavation #68 | Excavation #38 | Handle Mat Pour Carmix Concrete and vibrate to Columns and Beam | Yd.Cu. | 4,232 |
| Excavation #70 | Excavation #39 | Handle Mat Pour Carmix Concrete and Vibrate to slab | Yd.Cu. | 3,088 |
| Excavation #85 | Excavation #45 | Grade and ram bottom of trench | Yd.Sq. | 146 |
| Excavation #91 | Excavation #48 | Cut Concrete surfaces (1.25" to 3") Thick | Ft.Sq. | 497 |
| Excavation #100 | Excavation #49 | Cut down trees (up to 12" girth) | Each | 120 |
| Carpentry #88 | Carpentry #42 | Aluminium Sheeting Only to Roof or Wall | 100 F.S. | 9,453 |
| Electrical #73 | Electrical #60 | 2.5 mm2 PVC/xlpe | Ft.Run | 154.35 |
| Electrical #74 | Electrical #61 | 4 mm2 PVC/xlpe | Ft.Run | 160.78 |
| Electrical #75 | Electrical #62 | 6 mm2 PVC/xlpe | Ft.Run | 167.77 |
| Electrical #76 | Electrical #63 | 10 mm2 PVC/xlpe | Ft.Run | 175.40 |
| Electrical #77 | Electrical #64 | 16 mm2 PVC/xlpe | Ft.Run | 183.75 |
| Electrical #78 | Electrical #65 | 25 mm2 PVC/xlpe | Ft.Run | 192.94 |
| Electrical #79 | Electrical #66 | 35 mm2 PVC/xlpe | Ft.Run | 192.94 |
| Electrical #80 | Electrical #67 | 50 mm2 PVC/xlpe | Ft.Run | 203.09 |
| Electrical #81 | Electrical #68 | 70 mm2 PVC/xlpe | Ft.Run | 214.38 |
| Electrical #82 | Electrical #69 | 95 mm2 PVC/xlpe | Ft.Run | 226.99 |
| Electrical #83 | Electrical #70 | 120 mm2 PVC/xlpe | Ft.Run | 257.25 |
| Electrical #84 | Electrical #71 | 150 mm2 PVC/xlpe | Ft.Run | 275.63 |
| Electrical #85 | Electrical #72 | 240 mm2 PVC/xlpe | Ft.Run | 296.83 |

### 5b. Same description and unit, different rate (kept)

| Trade | Refs and rates |
|---|---|
| Excavation | #40: 2,285; #72: 2,231 |
| Excavation | #41: 3,264; #73: 3,360 |
| Excavation | #43: 672; #78: 714 |
| Excavation | #44: 439; #84: 457 |
| Excavation | #47: 254; #90: 248 |
| Carpentry | #41: 6,875; #87: 6,938 |
| Carpentry | #43: 11,344; #89: 11,575 |
| Joinery | #1: 66; #61: 107 |
| Joinery | #2: 73; #62: 107 |
| Joinery | #3: 90; #63: 132 |
| Joinery | #7: 99; #67: 157 |
| Joinery | #8: 110; #68: 157 |
| Joinery | #9: 122; #69: 183 |
| Joinery | #10: 110; #70: 175 |
| Joinery | #11: 122; #71: 175 |
| Joinery | #12: 134; #72: 202 |
| Electrical | #3: 48.23; #7: 83.89 |
| Electrical | #4: 56.75; #8: 96.47 |
| Electrical | #5: 68.91; #9: 107.19 |
| Electrical | #6: 80.39; #10: 120.59 |

## 6. Metric conversion method

| Imperial unit | Metric unit | Rule |
|---|---|---|
| Yd.Sq. | m² | rate ÷ 0.83612736 |
| Yd.Cu. | m³ | rate ÷ 0.764554858 |
| Ft.Run | m | rate ÷ 0.3048 |
| Ft.Sq. | m² | rate ÷ 0.09290304 |
| Lb. | Kg. | rate ÷ 0.45359237 |
| In. | 100mm | rate × 100 ÷ 25.4 (matches the shipped book) |
| 100 F.S. / 100 F S / 100 Sq.Ft. / 100 Ft.Sq. | m² | rate ÷ 9.290304 (per 100 ft² becomes per m²) |
| Doz., No., Each, Ea., Load | unchanged | no conversion |

Calculated rates are rounded to whole dollars, or to cents where the imperial rate has cents. **Accuracy:** across the 99 shipped rows other than Fabric, the source's metric figure always falls inside the rounding band of the imperial rate (the imperial rate is itself rounded to the dollar). The largest difference is about 5%, on rates under JMD 20 per unit. Nominal sizes in descriptions (8" block, 1/2" rebar) are product names and are not converted.

## 7. Full rate tables

**Columns:** *App* = ✔ if the row is already in the app. *Basis* = **S** (metric is the source's own shipped figure) or **C** (calculated). Reference numbers are the JIC numbers as shown on the source page. Rows removed as exact duplicates are listed in 5a and omitted here.

### Excavation

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Excavation #1 | ✔ | Excavation in Compacted Earth to 5' Deep | Yd.Cu. | 1,428 | m³ | 1,868 | S |  |
| Excavation #2 | ✔ | Excavation in Asphaltic Concrete (Barber Green) | Yd.Cu. | 3,264 | m³ | 4,270 | S |  |
| Excavation #3 | ✔ | Excavation in compacted marl up to 5' deep | Yd.Cu. | 1,904 | m³ | 2,491 | S |  |
| Excavation #4 | ✔ | Excavation in compacted sand up to 5' deep | Yd.Cu. | 1,143 | m³ | 1,494 | S |  |
| Excavation #5 | ✔ | Excavation in stiff clay up to 5' deep | Yd.Cu. | 1,632 | m³ | 2,135 | S |  |
| Excavation #6 | ✔ | Excavation in stiff clay between 5' & 10' deep | Yd.Cu. | 1,904 | m³ | 2,491 | S |  |
| Excavation #7 | ✔ | Excavation in Rock or concrete (no compressor) | Yd.Cu. | 11,425 | m³ | 14,944 | S |  |
| Excavation #8 | ✔ | Excavation in Rock or concrete (with compressor) incl. Labourers | Yd.Cu. | 7,141 | m³ | 9,340 | S |  |
| Excavation #9 | ✔ | Excavation in Rock or concrete (with compressor) Labourers only | Yd.Cu. | 2,856 | m³ | 3,736 | S |  |
| Excavation #10 |  | Backfill trenches/foundations Excavations with excavated Sand | Yd.Cu. | 229 | m³ | 300 | C |  |
| Excavation #11 |  | Excavation in concrete slab up to 8" Thick without compressor | Yd.Cu. | 5,713 | m³ | 7,472 | C |  |
| Excavation #12 |  | Excavate for kerb foundations (12" x 12") | Ft.Run | 95 | m | 312 | C |  |
| Excavation #13 |  | Excavate shallow trenches (18" & 12") < 12" deep | Ft.Run | 127 | m | 417 | C |  |
| Excavation #14 |  | Excavate between 5' & 10' deep in compacted earth | Yd.Cu. | 1,814 | m³ | 2,373 | C |  |
| Excavation #15 |  | Excavate between 10' & 15' deep in compacted earth | Yd.Cu. | 2,197 | m³ | 2,874 | C |  |
| Excavation #16 |  | Excavate in uncompacted Sand | Yd.Cu. | 714 | m³ | 934 | C |  |
| Excavation #17 |  | Excavate in uncompacted earth | Yd.Cu. | 816 | m³ | 1,067 | C |  |
| Excavation #18 |  | Excavate in uncompacted marl | Yd.Cu. | 1,143 | m³ | 1,495 | C |  |
| Excavation #19 |  | Demolish 4" Block walls with all cores filled | Yd.Sq. | 571 | m² | 683 | C |  |
| Excavation #20 |  | Demolish 6" Block wall with all cores filled | Yd.Sq. | 816 | m² | 976 | C |  |
| Excavation #21 |  | Demolish 8" Block walls with all cores filled | Yd.Sq. | 1,143 | m² | 1,367 | C |  |
| Excavation #22 |  | Load barford and spread for filling (Earth/Marl) | Yd.Cu. | 476 | m³ | 623 | C |  |
| Excavation #23 |  | Load barford for dump (all types of soil sand debris) | Yd.Cu. | 233 | m³ | 305 | C |  |
| Excavation #24 |  | Load barford and spread for filling (sand) | Yd.Cu. | 381 | m³ | 498 | C |  |
| Excavation #25 |  | Load barford with debris (board ply steel block) | Load | 229 | Load | 229 | C |  |
| Excavation #26 |  | Load wheel barrow and remove to dump (2FC) | Load | 38 | Load | 38 | C |  |
| Excavation #27 |  | Load wheel barrow and remove to dump | Yd.Cu. | 381 | m³ | 498 | C |  |
| Excavation #28 |  | Load wheel barrow and spread for filling (earth or marl) | Yd.Cu. | 601 | m³ | 786 | C |  |
| Excavation #29 |  | Load wheel barrow and spread for filling (sand) | Yd.Cu. | 476 | m³ | 623 | C |  |
| Excavation #30 |  | Backfill trenches/foundations Exctns With exctd Earth/marl | Yd.Cu. | 286 | m³ | 374 | C |  |
| Excavation #31 |  | Dig post holes (1.25' x 2') deep | No. | 357 | No. | 357 | C |  |
| Excavation #32 |  | Plant post including bracing in proper position | No. | 357 | No. | 357 | C |  |
| Excavation #33 |  | Mix and pour concrete in post holes | No. | 254 | No. | 254 | C |  |
| Excavation #34 |  | Mix pour vibrate concrete in foundations man | Yd.Cu. | 4,761 | m³ | 6,227 | C |  |
| Excavation #35 |  | Mix pour vibrate concrete in walls and stiffeners (GF-FF) Man | Yd.Cu. | 5,441 | m³ | 7,117 | C |  |
| Excavation #36 |  | Mix pour vibrate concrete in walls and stiffeners (FF-SF) Man | Yd.Cu. | 6,347 | m³ | 8,302 | C |  |
| Excavation #37 |  | Mix pour vibrate concrete in walls and stiffeners (SF-RF) Man | Yd.Cu. | 7,141 | m³ | 9,340 | C |  |
| Excavation #38 |  | Handle Mat Pour Carmix Concrete and vibrate to Columns and Beam | Yd.Cu. | 4,232 | m³ | 5,535 | C | also listed as #68 |
| Excavation #39 |  | Handle Mat Pour Carmix Concrete and Vibrate to slab | Yd.Cu. | 3,088 | m³ | 4,039 | C | also listed as #70 |
| Excavation #40 |  | Pour only and vibrate Carmix Concrete to Foundations | Yd.Cu. | 2,285 | m³ | 2,989 | C | same item as #72 at a different rate |
| Excavation #41 |  | Pour Only and vibrate Carmix Concrete to Columns | Yd.Cu. | 3,264 | m³ | 4,269 | C | same item as #73 at a different rate |
| Excavation #42 |  | Pour Only and Vibrate Carmix Concrete to beams and slabs | Yd.Cu. | 2,285 | m³ | 2,989 | C |  |
| Excavation #43 |  | Handle Sand Gravel at Mixer for Concrete Manl | Yd.Cu. | 672 | m³ | 879 | C | same item as #78 at a different rate |
| Excavation #44 |  | Ram earth or marl manually including wetting | Yd.Cu. | 439 | m³ | 574 | C | same item as #84 at a different rate |
| Excavation #45 |  | Grade and ram bottom of trench | Yd.Sq. | 146 | m² | 175 | C | also listed as #85 |
| Excavation #46 |  | To sort and dry pack stones to absorption Pit walls (12" x 18") Thick | Yd.Sq. | 1,632 | m² | 1,952 | C |  |
| Excavation #47 |  | Cut Concrete surfaces (ups to 1") Thick | Ft.Sq. | 254 | m² | 2,734 | C | same item as #90 at a different rate |
| Excavation #48 |  | Cut Concrete surfaces (1.25" to 3") Thick | Ft.Sq. | 497 | m² | 5,350 | C | also listed as #91 |
| Excavation #49 |  | Cut down trees (up to 12" girth) | Each | 120 | Each | 120 | C | also listed as #100 |
| Excavation #50 |  | Cut down trees (13" to 24" girth) | Each | 346 | Each | 346 | C |  |
| Excavation #51 |  | Cut down trees (25" to 36" girth) | Each | 672 | Each | 672 | C |  |
| Excavation #52 |  | Cut down trees (37" to 48" girth) | Each | 1,143 | Each | 1,143 | C |  |
| Excavation #53 |  | Spread top soil (6"-12" Thick) | Yd.Cu. | 439 | m³ | 574 | C |  |
| Excavation #54 |  | Spread top soil (less than 6" Thick) | Yd.Sq. | 83 | m² | 99 | C |  |
| Excavation #55 |  | Grade sub-base to receive top soil | 100 Sq.Ft. | 381 | m² | 41 | C |  |
| Excavation #56 |  | Load Trucks (5 Yd.Cu.-10 Yd.Cu.) By hand with marl/earth/sand etc | Load | 2,285 | Load | 2,285 | C |  |
| Excavation #57 |  | Load Trucks (11 Yd.Cu.-16 Yd.Cu.) by Hand with Marl/earth/sand | Load | 4,394 | Load | 4,394 | C |  |
| Excavation #58 |  | Load Trucks (17 Yd.Cu.-22 Yd.Cu.) By hand with Marl/earth sand | Load | 6,347 | Load | 6,347 | C |  |
| Excavation #59 |  | Mix pour vibrate concrete in isolated beams (FF) Man | Yd.Cu. | 5,713 | m³ | 7,472 | C |  |
| Excavation #60 |  | Mix pour vibrate concrete in isolated beams (SF) Man | Yd.Cu. | 6,721 | m³ | 8,791 | C |  |
| Excavation #61 |  | Mix pour vibrate concrete in isloated beams (RF) Man | Yd.Cu. | 7,617 | m³ | 9,963 | C |  |
| Excavation #62 |  | Mix pour vibrate concrete in beams and slabs all Fls Man | Yd.Cu. | 5,713 | m³ | 7,472 | C |  |
| Excavation #63 |  | Mix pour vibrate concrete in Ground Floor slabs (ins Bdgs) Man | Yd.Cu. | 6,721 | m³ | 8,791 | C |  |
| Excavation #64 |  | Mix pour vibrate concrete in Ground Floor slabs (Outs Bdgs) Man | Yd.Cu. | 7,617 | m³ | 9,963 | C |  |
| Excavation #65 |  | Mix pour vibrate concrete in beam column wall with crane | Yd.Cu. | 5,314 | m³ | 6,950 | C |  |
| Excavation #66 |  | Mix pour vibrate concrete in foundations with crane | Yd.Cu. | 4,841 | m³ | 6,332 | C |  |
| Excavation #67 |  | Mix pour vibrate concrete in beams slabs with crane | Yd.Cu. | 4,311 | m³ | 5,639 | C |  |
| Excavation #69 |  | Handle Mat Pour Carmix Concrete and Vibrate to Col and Beam-Crane | Yd.Cu. | 3,264 | m³ | 4,269 | C |  |
| Excavation #71 |  | Handle Mat Pour Carmix Concrete and Vibrate to slab-Crane | Yd.Cu. | 2,218 | m³ | 2,901 | C |  |
| Excavation #72 |  | Pour only and vibrate Carmix Concrete to Foundations | Yd.Cu. | 2,231 | m³ | 2,918 | C | same item as #40 at a different rate |
| Excavation #73 |  | Pour Only and vibrate Carmix Concrete to Columns | Yd.Cu. | 3,360 | m³ | 4,395 | C | same item as #41 at a different rate |
| Excavation #74 |  | Pour Only and Vibrate Carmix Concrete to beams | Yd.Cu. | 3,184 | m³ | 4,165 | C |  |
| Excavation #75 |  | Pour Only and Vibrate Carmix Concrete to Foundations-Crane | Yd.Cu. | 1,544 | m³ | 2,019 | C |  |
| Excavation #76 |  | Pour Only & Vibrate Carmix Concrete to Column & Beams-Crane | Yd.Cu. | 2,682 | m³ | 3,508 | C |  |
| Excavation #77 |  | Pour Only and Vibrate Carmix Concrete to slabs with Crane | Yd.Cu. | 1,771 | m³ | 2,316 | C |  |
| Excavation #78 |  | Handle Sand Gravel at Mixer for Concrete Manl | Yd.Cu. | 714 | m³ | 934 | C | same item as #43 at a different rate |
| Excavation #79 |  | Handle sand gravel at mixer for blockwork manl | Yd.Cu. | 38 | m³ | 50 | C |  |
| Excavation #80 |  | Handle sand gravel at mixer for rendering manl | Yd.Cu. | 16 | m³ | 21 | C |  |
| Excavation #81 |  | Make pre-cast slab (18" x 18" x 2") | Each | 104 | Each | 104 | C |  |
| Excavation #82 |  | Make pre-cast slab (24" x 24" x 2") | Each | 163 | Each | 163 | C |  |
| Excavation #83 |  | Make pre-cast kerbs (3" x 10") | Each | 238 | Each | 238 | C |  |
| Excavation #84 |  | Ram earth or marl manually including wetting | Yd.Cu. | 457 | m³ | 598 | C | same item as #44 at a different rate |
| Excavation #86 |  | Grade and ram fill to receive concrete | Yd.Sq. | 120 | m² | 144 | C |  |
| Excavation #87 |  | Lay and Fit 24" Diameter Culvert pipe using backhoe/Loader | Ft.Run | 150 | m | 492 | C |  |
| Excavation #88 |  | Lay and fit 18" Diameter Culvert pipe using backhoe/Loader | Ft.Run | 117 | m | 384 | C |  |
| Excavation #89 |  | To sort and dryfill stones in soakaway pits and trenches | Yd.Cu. | 1,750 | m³ | 2,289 | C |  |
| Excavation #90 |  | Cut Concrete surfaces (ups to 1") Thick | Ft.Sq. | 248 | m² | 2,669 | C | same item as #47 at a different rate |
| Excavation #92 |  | Cut concrete surfaces (3.25" to 6") Thick | Ft.Sq. | 952 | m² | 10,247 | C |  |
| Excavation #93 |  | Cut off projecting rebar (3/8" & 1/2") using hacksaw | Each | 46 | Each | 46 | C |  |
| Excavation #94 |  | Cut off projecting rebar (5/8" & 3/4") using hacksaw | Each | 54 | Each | 54 | C |  |
| Excavation #95 |  | Cut off projecting rebar (1") using hacksaw | Each | 69 | Each | 69 | C |  |
| Excavation #96 |  | Cut off projecting rebar (3/8" x 1/2") using torch | Each | 35 | Each | 35 | C |  |
| Excavation #97 |  | Cut off projecting rebar (5/8" x 3/4") using torch | Each | 50 | Each | 50 | C |  |
| Excavation #98 |  | Cut off projecting rebar (1") using torch | Each | 60 | Each | 60 | C |  |
| Excavation #99 |  | Bush and clean (Grass weeds shrubs) site | 100 Ft.Sq. | 326 | m² | 35 | C |  |

### Carpentry

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Carpentry #1 | ✔ | Erect and Strip Forms to Belt and Stiffener | Ft.Sq. | 177 | m² | 1,908 | S |  |
| Carpentry #2 | ✔ | Erect and Strip Forms to Columns | Ft.Sq. | 189 | m² | 2,035 | S |  |
| Carpentry #3 | ✔ | Erect and Strip Forms to Beams | Ft.Sq. | 189 | m² | 2,035 | S |  |
| Carpentry #4 | ✔ | Erect and Strip Forms to suspended slabs (stairs) | Ft.Sq. | 158 | m² | 1,696 | S |  |
| Carpentry #5 | ✔ | Erect and Strip Forms to Suspend slabs (floor) | Ft.Sq. | 189 | m² | 2,035 | S |  |
| Carpentry #6 | ✔ | Erect and Strip Forms to Walls | Ft.Sq. | 168 | m² | 1,809 | S |  |
| Carpentry #7 | ✔ | Erect and Strip Circular Forms | Ft.Sq. | 197 | m² | 2,124 | S |  |
| Carpentry #8 | ✔ | Erect and Strip Forms to Sides and Deck of Manholes | Ft.Sq. | 249 | m² | 2,684 | S |  |
| Carpentry #9 | ✔ | Make New Formwork (Columns Beam Belt Stiffener) | Ft.Sq. | 60 | m² | 643 | S |  |
| Carpentry #10 |  | Make New Circular Formwork Columns | Ft.Sq. | 95 | m² | 1,023 | C |  |
| Carpentry #11 |  | Apply Form Oil To Formwork | Ft.Sq. | 10 | m² | 108 | C |  |
| Carpentry #12 |  | Pipe or Timber Screeds | Ft.Run | 89 | m | 292 | C |  |
| Carpentry #13 |  | Pipe or Timber Screeds Based On Area of Concrete Poured | Yd.Sq. | 108 | m² | 129 | C |  |
| Carpentry #14 |  | Fix Insert For Water Drip to Decking Under Rebar | Ft.Run | 89 | m | 292 | C |  |
| Carpentry #15 |  | Fix Chamfer Strip Inside Formwork | Ft.Run | 29 | m | 95 | C |  |
| Carpentry #16 |  | Fit Anchor Bolt (3/4" to 1") For Steel Base Plate | Each | 1,080 | Each | 1,080 | C |  |
| Carpentry #17 |  | Fit Hurricane Straps | Each | 151 | Each | 151 | C |  |
| Carpentry #18 |  | Fit Gutter Brackets to Timber Support | Each | 225 | Each | 225 | C |  |
| Carpentry #19 |  | Fit Gutter Brackets to Concrete Support | Each | 277 | Each | 277 | C |  |
| Carpentry #20 |  | 2" x 4" Rafter or Beam Including Cutting Ends | Ft.Run | 132 | m | 433 | C |  |
| Carpentry #21 |  | 2" x 6" Rafter or Beam Including Cutting Ends | Ft.Run | 159 | m | 522 | C |  |
| Carpentry #22 |  | 2" x 8" Rafter or Beam Including Cutting Ends | Ft.Run | 203 | m | 666 | C |  |
| Carpentry #23 |  | 2" x 10" Rafter or Beam Including Ends | Ft.Run | 220 | m | 722 | C |  |
| Carpentry #24 |  | 2" x 2" Framing to Partition (Gypsum/Plywood) | Ft.Run | 81 | m | 266 | C |  |
| Carpentry #25 |  | 2" x 3" Framing to Partition (Gypsum/Plywood) | Ft.Run | 116 | m | 381 | C |  |
| Carpentry #26 |  | 2" x 4" Framing to Partition (Gypsum/Plywood) | Ft.Run | 129 | m | 423 | C |  |
| Carpentry #27 |  | 2" x 6" Framing to Partition (Gypsum/Plywood) | Ft.Run | 153 | m | 502 | C |  |
| Carpentry #28 |  | 1" x 4" T & G Sarking/Flooring to Top of Rafters/Joists | Ft.Sq. | 129 | m² | 1,389 | C |  |
| Carpentry #29 |  | 1" x 6" T & G Sarking/Flooring to Top of Rafters/Joists | Ft.Sq. | 106 | m² | 1,141 | C |  |
| Carpentry #30 |  | 1" x 8" T & G Sarking/Flooring to Top of Rafters/Joists | Ft.Sq. | 91 | m² | 980 | C |  |
| Carpentry #31 |  | 1" x 4" T & G Ceiling to Bottom of Rafters/Joists | Ft.Sq. | 144 | m² | 1,550 | C |  |
| Carpentry #32 |  | 1" x 6" Tongue & Groove Ceiling to Bottom of Rafters/Joists | Ft.Sq. | 116 | m² | 1,249 | C |  |
| Carpentry #33 |  | 1" x 8" Tongue & Groove Ceiling to Bottom of Rafters/Joists | Ft.Sq. | 103 | m² | 1,109 | C |  |
| Carpentry #34 |  | 1" x 2" & 1" x 3" Bearers | Ft.Run | 89 | m | 292 | C |  |
| Carpentry #35 |  | 2" x 2" Bearer | Ft.Run | 103 | m | 338 | C |  |
| Carpentry #36 |  | 2" x 3" Bearer | Ft.Run | 108 | m | 354 | C |  |
| Carpentry #37 |  | 1" x 2" & 1" x 3" battens | Ft.Run | 60 | m | 197 | C |  |
| Carpentry #38 |  | 2" x 2" Battens | Ft.Run | 63 | m | 207 | C |  |
| Carpentry #39 |  | Shingles Only to Roof or Wall (Fibreglass) | 100 F.S. | 15,125 | m² | 1,628 | C |  |
| Carpentry #40 |  | Shingles Only to Roof or Wall (wooden) | 100 F.S. | 18,906 | m² | 2,035 | C |  |
| Carpentry #41 |  | Zinc Sheeting Only to Roof or Wall | 100 F.S. | 6,875 | m² | 740 | C | same item as #87 at a different rate |
| Carpentry #42 |  | Aluminium Sheeting Only to Roof or Wall | 100 F.S. | 9,453 | m² | 1,018 | C | also listed as #88 |
| Carpentry #43 |  | Clay Tiles Only to Roof/Wall | 100 F.S. | 11,344 | m² | 1,221 | C | same item as #89 at a different rate |
| Carpentry #44 |  | 1" X 2" Lath at 5" On Centered and Shingles to Roof or Wall | 100 F.S. | 21,878 | m² | 2,355 | C |  |
| Carpentry #45 |  | 1" x 3" Lath at 30" On Centered and Zinc to Roof or Wall | 100 F.S. | 9,075 | m² | 977 | C |  |
| Carpentry #46 |  | 1" x 3" Lath at 30" On Centered and Alum to Roof or Wall | 100 F.S. | 11,694 | m² | 1,259 | C |  |
| Carpentry #47 |  | 1" x 3" Lath at 12" On Centered and Clay Tiles to Roof/Wall | 100 F.S. | 15,433 | m² | 1,661 | C |  |
| Carpentry #48 |  | Aluminium Zinc Sheets to Wall/Roof on Metal Purlins | 100 F.S. | 11,344 | m² | 1,221 | C |  |
| Carpentry #49 |  | Aluminium Zinc Lining to Valley/Gutter of Roof | Ft.Run | 273 | m | 896 | C |  |
| Carpentry #50 |  | Aluminium Gutter Fitted in Metal Brakets | Ft.Run | 334 | m | 1,096 | C |  |
| Carpentry #51 |  | Aluminium Flashing into Reglet | Ft.Run | 175 | m | 574 | C |  |
| Carpentry #52 |  | Aluminium Capping to Edges of Roof | Ft.Run | 133 | m | 436 | C |  |
| Carpentry #53 |  | Alunimium Shingles to Roofs and Walls | 100 F.S. | 10,407 | m² | 1,120 | C |  |
| Carpentry #54 |  | 15 Lb Felt Under Tiles or Shingles to Roofs/Walls | 100 F S | 2,890 | m² | 311 | C |  |
| Carpentry #55 |  | Plyboards (1/2"-3/4") Sarking to Roofs | Ft.Sq. | 78 | m² | 840 | C |  |
| Carpentry #56 |  | Capping or Hips to Clay Tile Roofs Including Grout | Ft.Run | 378 | m | 1,240 | C |  |
| Carpentry #57 |  | Install Fascia and Grout for Clay Tiles Roofs | Ft.Run | 197 | m | 646 | C |  |
| Carpentry #58 |  | Capping to Metal Roof | Ft.Run | 241 | m | 791 | C |  |
| Carpentry #59 |  | Shingles to Hips & Ridges Incl Cutting & Fitting (Fibreglass) | Ft.Run | 873 | m | 2,864 | C |  |
| Carpentry #60 |  | Shingles to Hips & Ridges Incl Cutting & Fitting (wooden) | Ft.Run | 1,194 | m | 3,917 | C |  |
| Carpentry #61 |  | Shingles to Valleys Including Cutting & Fitting (Fibreglass) | Ft.Run | 732 | m | 2,402 | C |  |
| Carpentry #62 |  | Shingles to Valleys Including Cutting & Fitting (Wooden) | Ft.Run | 810 | m | 2,657 | C |  |
| Carpentry #63 |  | Composite Cap to Comb | Ft.Run | 324 | m | 1,063 | C |  |
| Carpentry #64 |  | 1" x 6" Fascia | Ft.Run | 108 | m | 354 | C |  |
| Carpentry #65 |  | 1" x 6" Blocking Board | Ft.Run | 156 | m | 512 | C |  |
| Carpentry #66 |  | 1" x 8" Fascia | Ft.Run | 108 | m | 354 | C |  |
| Carpentry #67 |  | 1" x 8" Blocking Board | Ft.Run | 156 | m | 512 | C |  |
| Carpentry #68 |  | 1" x 10" Fascia | Ft.Run | 123 | m | 404 | C |  |
| Carpentry #69 |  | 1" x 10" Blocking Board | Ft.Run | 156 | m | 512 | C |  |
| Carpentry #70 |  | 1" x 12" Fascia | Ft.Run | 130 | m | 427 | C |  |
| Carpentry #71 |  | 1" x 12" Blocking Board | Ft.Run | 162 | m | 531 | C |  |
| Carpentry #72 |  | Erect Metal Stud (Gyp/ Walls) Frame @ 24" On Centered Vertically | Ft.Sq. | 113 | m² | 1,216 | C |  |
| Carpentry #73 |  | Erect Metal Stud (Gyp/ Walls) Frame @ 16" On Centered Vertically | Ft.Sq. | 142 | m² | 1,528 | C |  |
| Carpentry #74 |  | Erect Metal Stud (Gypsum Walls) Frame | Ft.Run | 119 | m | 390 | C |  |
| Carpentry #75 |  | Erect Metal Stud (Gypsum Ceilings) Frame | Ft.Run | 133 | m | 436 | C |  |
| Carpentry #76 |  | Erect Metal Stud (Gypsum Ceilings) Vertical Straps | Ft.Run | 103 | m | 338 | C |  |
| Carpentry #77 |  | Install Corner Beads to Gypsum Walls/Ceilings | Ft.Run | 29 | m | 95 | C |  |
| Carpentry #78 |  | Install Gypsum Sheeting (1/2"-5/8") To Walls | Ft.Sq. | 76 | m² | 818 | C |  |
| Carpentry #79 |  | Install Gypsum Sheeting (1/2"-5/8") To Ceilings | Ft.Sq. | 87 | m² | 936 | C |  |
| Carpentry #80 |  | Install Plywood Sheeting (3/16"-3/8") to Walls | Ft.Sq. | 65 | m² | 700 | C |  |
| Carpentry #81 |  | Install Plywood Sheeting (1/2"-3/4") to Walls | Ft.Sq. | 73 | m² | 786 | C |  |
| Carpentry #82 |  | Install Plywood Sheeting (3/16"-3/8") To Ceilings | Ft.Sq. | 67 | m² | 721 | C |  |
| Carpentry #83 |  | Install Plywood Sheeting (1/2"-3/4") To Ceilings | Ft.Sq. | 84 | m² | 904 | C |  |
| Carpentry #84 |  | Tape and Plaster Walls | Ft.Sq. | 103 | m² | 1,109 | C |  |
| Carpentry #85 |  | Tape and Plaster Ceilings | Ft.Sq. | 112 | m² | 1,206 | C |  |
| Carpentry #86 |  | Shingles Only to Roof or Wall | 100 F.S. | 15,433 | m² | 1,661 | C |  |
| Carpentry #87 |  | Zinc Sheeting Only to Roof or Wall | 100 F.S. | 6,938 | m² | 747 | C | same item as #41 at a different rate |
| Carpentry #89 |  | Clay Tiles Only to Roof/Wall | 100 F.S. | 11,575 | m² | 1,246 | C | same item as #43 at a different rate |
| Carpentry #90 |  | Erect Lath and Zinc/Plywood to Posts for Hoarding | 100 F.S. | 3,781 | m² | 407 | C |  |
| Carpentry #91 |  | Make Shed Panels Incl Making Door & Window Openings | Ft.Sq. | 65 | m² | 700 | C |  |
| Carpentry #92 |  | Erect Shed Panels Including Blocking To Gables | Ft.Sq. | 41 | m² | 441 | C |  |
| Carpentry #93 |  | Erect Shed Roof Including Rafters Laths Zinc | Ft.Sq. | 95 | m² | 1,023 | C |  |
| Carpentry #94 |  | Erect Timber Floor Panels (Sheds) Including Supports | Ft.Sq. | 47 | m² | 506 | C |  |
| Carpentry #95 |  | Make Roof Trusses 12 Ft Long for Sheds | Each | 4,380 | Each | 4,380 | C |  |
| Carpentry #96 |  | Erect Roof Trusses @ 5' On Centered Plus Lath & Zinc | Ft.Sq. | 76 | m² | 818 | C |  |
| Carpentry #97 |  | Dismantle Shed Panels (Walls & Floors) Carefully and Stack | Ft.Sq. | 8 | m² | 86 | C |  |
| Carpentry #98 |  | Dismantle Shed Roofs Carefully and Stack | Ft.Sq. | 23 | m² | 248 | C |  |
| Carpentry #99 |  | Dismantle Hoarding (Lath & Zinc/Ply) Carefully and Stack | 100 F S | 782 | m² | 84 | C |  |
| Carpentry #100 |  | Install 2" x 4" Pegs In Earth for Profile Boards | Each | 48 | Each | 48 | C |  |

### Steelwork

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Steelwork #1 | ✔ | 3/8" Mild Steel Rebar | Lb. | 30 | Kg. | 67 | S |  |
| Steelwork #2 | ✔ | 1/2" Mild Steel Rebar | Lb. | 30 | Kg. | 67 | S |  |
| Steelwork #3 | ✔ | 5/8" Mild Steel Rebar | Lb. | 30 | Kg. | 67 | S |  |
| Steelwork #4 | ✔ | 3/4" Mild Steel Rebar | Lb. | 30 | Kg. | 67 | S |  |
| Steelwork #5 | ✔ | 1" Mild Steel Rebar | Lb. | 30 | Kg. | 67 | S |  |
| Steelwork #6 | ✔ | Fabric | Yd.Sq. | 125 | m² | 149 | S | fixed 2026-10-12: was 276 (a lb-kg factor on a per-yd² rate); 125 ÷ 0.83612736 = 149 |
| Steelwork #7 | ✔ | 1/4" Stirrups | Doz. | 699 | Doz. | 699 | S |  |
| Steelwork #8 | ✔ | 3/8" Stirrups | Doz. | 734 | Doz. | 734 | S |  |
| Steelwork #9 | ✔ | 3/8" Stirrups (Large > 6' Girth) | Doz. | 917 | Doz. | 917 | S |  |
| Steelwork #10 |  | 1/2" Stirrups | Doz. | 1,048 | Doz. | 1,048 | C |  |
| Steelwork #11 |  | 1/2" Stirrups (Large > 7' Girth) | Doz. | 1,223 | Doz. | 1,223 | C |  |
| Steelwork #12 |  | 1/4" Links | Doz. | 564 | Doz. | 564 | C |  |
| Steelwork #13 |  | 3/8" Links | Doz. | 638 | Doz. | 638 | C |  |
| Steelwork #14 |  | 1/2" Links | Doz. | 947 | Doz. | 947 | C |  |
| Steelwork #15 |  | 3/8" Chairs | Doz. | 612 | Doz. | 612 | C |  |
| Steelwork #16 |  | 1/2" Chairs | Doz. | 917 | Doz. | 917 | C |  |
| Steelwork #17 |  | 3/8" High Tensile Steel Rebar | Lb. | 33 | Kg. | 73 | C |  |
| Steelwork #18 |  | 1/2" High Tensile Steel Rebar | Lb. | 33 | Kg. | 73 | C |  |
| Steelwork #19 |  | 5/8" High Tensile Steel Rebar | Lb. | 33 | Kg. | 73 | C |  |
| Steelwork #20 |  | 3/4" High Tensile Steel Rebar | Lb. | 33 | Kg. | 73 | C |  |
| Steelwork #21 |  | 1" High Tensile Steel Rebar | Lb. | 33 | Kg. | 73 | C |  |

### Masonry

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Masonry #1 | ✔ | Lay 8" Blocks & Fill all Pockets (Ground Floor to First Floor) | Yd.Sq. | 1,461 | m² | 1,747 | S |  |
| Masonry #2 | ✔ | Lay 8" Blocks & Fill all Pockets (Ground Floor & Above) | Yd.Sq. | 1,704 | m² | 2,038 | S |  |
| Masonry #3 | ✔ | Lay 8" Blocks & Fill All Pockets (Manholes, Drains) | Yd.Sq. | 1,947 | m² | 2,329 | S |  |
| Masonry #4 | ✔ | Lay 8" Blocks & Fill Alternate Pockets (Ground Floor to First Floor) | Yd.Sq. | 1,239 | m² | 1,482 | S |  |
| Masonry #5 | ✔ | Lay 8" Blocks & Fill Alternate Pockets (First Floor & Above) | Yd.Sq. | 1,410 | m² | 1,687 | S |  |
| Masonry #6 | ✔ | Lay 6" Blocks & Fill All Pockets (Ground Floor to First Floor) | Yd.Sq. | 1,278 | m² | 1,529 | S |  |
| Masonry #7 | ✔ | Lay 6" Blocks & Fill All Pockets (First Floor & Above) | Yd.Sq. | 1,461 | m² | 1,747 | S |  |
| Masonry #8 | ✔ | Lay 6" Blocks & Fill All Pockets (Manholes, Drains, Gully Basins) | Yd.Sq. | 1,704 | m² | 2,038 | S |  |
| Masonry #9 | ✔ | Lay 6" Blocks & Fill Alternative Pockets (Ground Floor to First Floor) | Yd.Sq. | 1,105 | m² | 1,322 | S |  |
| Masonry #10 |  | Lay 6" Blocks & Fill Alternative Pockets (First Floor & Above) | Yd.Sq. | 1,278 | m² | 1,528 | C |  |
| Masonry #11 |  | Lay 4" Blocks & Fill All Pockets (Ground Floor to First Floor) | Yd.Sq. | 1,168 | m² | 1,397 | C |  |
| Masonry #12 |  | Lay 4" Blocks & Fill All Pockets (First Floor & Above) | Yd.Sq. | 1,278 | m² | 1,528 | C |  |
| Masonry #13 |  | Lay 4" Blocks & Fill All Pockets (Manholes, Drains, Gully Basins) | Yd.Sq. | 1,573 | m² | 1,881 | C |  |
| Masonry #14 |  | Lay 4" Blocks & Fill Alternative Pockets (Ground Floor to First Floor) | Yd.Sq. | 1,022 | m² | 1,222 | C |  |
| Masonry #15 |  | Lay 4" Blocks & Fill Alternative Pockets (First Floor & Above) | Yd.Sq. | 1,136 | m² | 1,359 | C |  |
| Masonry #16 |  | Lay 6" x 6" Breather Blocks & Rake Joints (All Floors) | Yd.Sq. | 4,090 | m² | 4,892 | C |  |
| Masonry #17 |  | Lay 9" x 9" Breather Blocks & Rake Joints (All Floors) | Yd.Sq. | 2,726 | m² | 3,260 | C |  |
| Masonry #18 |  | Lay 12" x 12" Breather Blocks & Rake Joints (All Floors) | Yd.Sq. | 2,406 | m² | 2,878 | C |  |
| Masonry #19 |  | Lay 6" High Concrete Louvres and Rake Joints (18" x 36") | Each | 294 | Each | 294 | C |  |
| Masonry #20 |  | Fill Alternate Pockets One Course High U/S Belts 8" W | Ft.Run | 80 | m | 262 | C |  |
| Masonry #21 |  | Fill Alternate Pockets One Course High U/S Belts 6" W | Ft.Run | 60 | m | 197 | C |  |
| Masonry #22 |  | Hack Concrete Surfaces for Rendering | Yd.Sq. | 417 | m² | 499 | C |  |
| Masonry #23 |  | Paint Bondcrete to Concrete Surfaces | Yd.Sq. | 125 | m² | 149 | C |  |
| Masonry #24 |  | Cut Stone Face Lay Point Joints as Extra Over Wall | Yd.Sq. | 12,764 | m² | 15,266 | C |  |
| Masonry #25 |  | Cut Stone Face Lay Point Joints as facing on Wall 4"Thick | Yd.Sq. | 16,652 | m² | 19,916 | C |  |
| Masonry #26 |  | Cut Stone Face Lay Point Joints as facing on Bank 6" Thick | Yd.Sq. | 17,329 | m² | 20,725 | C |  |
| Masonry #27 |  | Cut Stone Face and Build Landings 6" Thick | Ft.Sq. | 1,885 | m² | 20,290 | C |  |
| Masonry #28 |  | Build Stone Retaining Wall in Mortar Bed | Yd.Cu. | 15,851 | m³ | 20,732 | C |  |
| Masonry #29 |  | Form Arrisses to Stone Wall | Ft.Run | 1,704 | m | 5,591 | C |  |
| Masonry #30 |  | Form Arrisses and Build 12" TRD And 6" RSR from stones 6" Thick | Ft.Run | 5,257 | m | 17,247 | C |  |
| Masonry #31 |  | Form Weep Holes In Thick Stonewalls > 12" (No Pipes) | Each | 2,247 | Each | 2,247 | C |  |
| Masonry #32 |  | Form Weep Holes in Thin Stonewalls < 12" (No Pipes) | Each | 1,319 | Each | 1,319 | C |  |
| Masonry #33 |  | Rough Cast only (Up to 1" Thick) for General Walls | Yd.Sq. | 524 | m² | 627 | C |  |
| Masonry #34 |  | Rough Cast only (Up to 1" Thick) For Tyrolean Walls | Yd.Sq. | 639 | m² | 764 | C |  |
| Masonry #35 |  | Rough Cast only (Ditto 1" Thick) For Manholes Drains Gully Basins | Yd.Sq. | 835 | m² | 999 | C |  |
| Masonry #36 |  | Rough Cast only (Ditto 1" Thick) For Ceilings | Yd.Sq. | 568 | m² | 679 | C |  |
| Masonry #37 |  | Rough Cast only (Ditto 1" Thick) for JAMB/Wall Top | Ft.Run | 95 | m | 312 | C |  |
| Masonry #38 |  | Rough Cast only (Ditto 1" Thick) for Curved JAMB/WLT | Ft.Run | 149 | m | 489 | C |  |
| Masonry #39 |  | Rough Cast only (Ditto 1" Thick) For Beam 18" Girth | Ft.Run | 164 | m | 538 | C |  |
| Masonry #40 |  | Rough Cast only (Ditto 1" Thick) For Beams 24" Girth | Ft.Run | 204 | m | 669 | C |  |
| Masonry #41 |  | Rough Cast only (Ditto 1" Thick) For Beams 30" Girth | Ft.Run | 252 | m | 827 | C |  |
| Masonry #42 |  | Rough Cast only (Ditto 1" Thick) for Beams 36" Girth | Ft.Run | 288 | m | 945 | C |  |
| Masonry #43 |  | Rough Cast only (Ditto 1" Thick) for Columns 12" Grith | Ft.Run | 102 | m | 335 | C |  |
| Masonry #44 |  | Rough Cast only (Ditto 1" Thick) for Columns 18" Grith | Ft.Run | 146 | m | 479 | C |  |
| Masonry #45 |  | Rough Cast only (Ditto 1" Thick) for Columns 24" Grith | Ft.Run | 170 | m | 558 | C |  |
| Masonry #46 |  | Rough Cast only (Ditto 1" Thick) for Columns 30" Grith | Ft.Run | 248 | m | 814 | C |  |
| Masonry #47 |  | Rough Cast only (Ditto 1" Thick) for Columns 36" Grith | Ft.Run | 269 | m | 883 | C |  |
| Masonry #48 |  | Pebble Dash Only to Walls | Yd.Sq. | 639 | m² | 764 | C |  |
| Masonry #49 |  | Tyrolean Only to Walls | Yd.Sq. | 802 | m² | 959 | C |  |
| Masonry #50 |  | Steel Finish Only to Walls | Yd.Sq. | 1,076 | m² | 1,287 | C |  |
| Masonry #51 |  | Steel Finish to Manholes Drain and Gully Basins | Yd.Sq. | 1,461 | m² | 1,747 | C |  |
| Masonry #52 |  | Granite Only to Ceilings | Yd.Sq. | 693 | m² | 829 | C |  |
| Masonry #53 |  | Granite Only to 2 Arris Jamb/Wall Top | Ft.Run | 262 | m | 860 | C |  |
| Masonry #54 |  | Granite Only to 1R Jamb | Ft.Run | 120 | m | 394 | C |  |
| Masonry #55 |  | Granite Only to Beams (2R) 18" Girth | Ft.Run | 356 | m | 1,168 | C |  |
| Masonry #56 |  | Granite Only to Beams (2R) 24" Girth | Ft.Run | 397 | m | 1,302 | C |  |
| Masonry #57 |  | Granite Only to Beams (2R) 30" Girth | Ft.Run | 449 | m | 1,473 | C |  |
| Masonry #58 |  | Granite Only to Beams (2R) 36" Girth | Ft.Run | 481 | m | 1,578 | C |  |
| Masonry #59 |  | Rough Cast (Up to 1" Thick) and Granite Walls | Yd.Sq. | 1,168 | m² | 1,397 | C |  |
| Masonry #60 |  | Rough (Cast Up to 1" Thick) and Pebble Walls | Yd.Sq. | 1,168 | m² | 1,397 | C |  |
| Masonry #61 |  | Rough (Cast Up to 1" Thick) and Tyrolean Walls | Yd.Sq. | 1,410 | m² | 1,686 | C |  |
| Masonry #62 |  | Rough (Cast Up to 1" Thick) and Steel Finish Walls | Yd.Sq. | 1,573 | m² | 1,881 | C |  |
| Masonry #63 |  | Rough Cast (Ditto 1" Thick) and Steel Finish M/H Drains & G/Basins | Yd.Sq. | 2,272 | m² | 2,717 | C |  |
| Masonry #64 |  | Rough Cast (Ditto 1" Thick) and Granite Ceilings | Yd.Sq. | 1,258 | m² | 1,505 | C |  |
| Masonry #65 |  | Rough Cast (Ditto 1" Thick) and Granite Beams (2R) 18" Girth | Ft.Run | 531 | m | 1,742 | C |  |
| Masonry #66 |  | Rough Cast (Ditto 1" Thick) and Granite Beams (2R) 24" Girth | Ft.Run | 610 | m | 2,001 | C |  |
| Masonry #67 |  | Rough Cast (Ditto 1" Thick) and Granite Beams (2R) 30" Girth | Ft.Run | 705 | m | 2,313 | C |  |
| Masonry #68 |  | Rough Cast (Ditto 1" Thick) and Granite Beams (2R) 36" Girth | Ft.Run | 772 | m | 2,533 | C |  |
| Masonry #69 |  | Rough Cast (Ditto 1" Thick) and Granite columns (1R 12" Girth) | Ft.Run | 286 | m | 938 | C |  |
| Masonry #70 |  | Rough Cast (Ditto 1" Thick) and Granite columns (1R 18" Girth) | Ft.Run | 372 | m | 1,220 | C |  |
| Masonry #71 |  | Rough Cast (Ditto 1" Thick) and Granite columns (1R 24" Girth) | Ft.Run | 445 | m | 1,460 | C |  |
| Masonry #72 |  | Rough Cast (Ditto 1" Thick) and Granite columns (2R 18" Girth) | Ft.Run | 487 | m | 1,598 | C |  |
| Masonry #73 |  | Rough Cast (Ditto 1" Thick) and Granite columns (2R 24" Girth) | Ft.Run | 576 | m | 1,890 | C |  |
| Masonry #74 |  | Rough Cast (Ditto 1" Thick) and Granite columns (2R 30" Girth) | Ft.Run | 649 | m | 2,129 | C |  |
| Masonry #75 |  | Rough Cast (Ditto 1" Thick) and Granite columns (2R 36" Girth) | Ft.Run | 717 | m | 2,352 | C |  |
| Masonry #76 |  | Arrises | Ft.Run | 122 | m | 400 | C |  |
| Masonry #77 |  | Curved Arrisses | Ft.Run | 190 | m | 623 | C |  |
| Masonry #78 |  | Fairface Walls | Yd.Sq. | 382 | m² | 457 | C |  |
| Masonry #79 |  | Fairface Ceilings | Yd.Sq. | 487 | m² | 582 | C |  |
| Masonry #80 |  | One Coat Render to Walls and Ceilings | Yd.Sq. | 620 | m² | 742 | C |  |
| Masonry #81 |  | Dress Water Drip Formed in Soffit of Slab | Ft.Run | 190 | m | 623 | C |  |
| Masonry #82 |  | Form and Dress Water Drip into Rendering of Slab Soffit | Ft.Run | 227 | m | 745 | C |  |
| Masonry #83 |  | Set screeds to Floors/Roofs using Mortar | Yd.Sq. | 174 | m² | 208 | C |  |
| Masonry #84 |  | Pin Out and Dress Plumbing/Electrical Pipe Through Walls (1/2"-1") | Each | 64 | Each | 64 | C |  |
| Masonry #85 |  | Pin Out Plumbing/Electrics (1/2"-1") Chasings (Rough Walls) | Ft.Run | 64 | m | 210 | C |  |
| Masonry #86 |  | Pin Out Plumbing/Electrics (1 1/4"-2") Chasings (Rough Walls) | Ft.Run | 87 | m | 285 | C |  |
| Masonry #87 |  | Pin Out Plumbing/Electrics (3"-4") Chasings (Rough Walls) | Ft.Run | 114 | m | 374 | C |  |
| Masonry #88 |  | Rod-Off Floor Slabs to Receive Tiles or Screeds | Yd.Sq. | 157 | m² | 188 | C |  |
| Masonry #89 |  | Rod-Off and Broom Finish Floor Slabs | Yd.Sq. | 538 | m² | 643 | C |  |
| Masonry #90 |  | Rod-Off and Wood Finish Floor Slabs | Yd.Sq. | 538 | m² | 643 | C |  |
| Masonry #91 |  | Rod-Off and Steel Float Floor Slabs Manually | Yd.Sq. | 802 | m² | 959 | C |  |
| Masonry #92 |  | Rod-Off and Steel Float Floor Slabs Mechanically | Yd.Sq. | 382 | m² | 457 | C |  |
| Masonry #93 |  | Woodfloat Floor Slabs or Broom Finish Slabs | Yd.Sq. | 379 | m² | 453 | C |  |
| Masonry #94 |  | Screed and Dress Tread (10-12") Wide Wood Float Including Redge | Ft.Run | 330 | m | 1,083 | C |  |
| Masonry #95 |  | Screed and Dress Tread (10-12") Wide Steel Float Including Redge | Ft.Run | 493 | m | 1,617 | C |  |
| Masonry #96 |  | Screed and Dress Riser (6"-8") Wide Wood Float Finish Incl Redge | Ft.Run | 227 | m | 745 | C |  |
| Masonry #97 |  | Screed and Dress Riser (6"-8") Wide Steel Float | Ft.Run | 341 | m | 1,119 | C |  |
| Masonry #98 |  | Mark Floor Slabs with Metal Tool | Ft.Run | 120 | m | 394 | C |  |
| Masonry #99 |  | Mark Floor Slabs with Cotton Cord | Ft.Run | 69 | m | 226 | C |  |
| Masonry #100 |  | Lay Haunch and Point Kerbs | Ft.Run | 282 | m | 925 | C |  |

### Scaffolding

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Scaffolding #1 | ✔ | Erect Scaffolding Up to 10' High Unbraced | Ft.Sq. | 16 | m² | 174 | S |  |
| Scaffolding #2 | ✔ | Erect Scaffolding Up to 10' High Ties to Building | Ft.Sq. | 25 | m² | 269 | S |  |
| Scaffolding #3 | ✔ | Erect Scaffolding between 10' and 20' Tied to Building | Ft.Sq. | 29 | m² | 314 | S |  |
| Scaffolding #4 | ✔ | Erect Scaffolding between 20' and 30' Tied to Building | Ft.Sq. | 39 | m² | 418 | S |  |
| Scaffolding #5 | ✔ | Erect Scaffolding between 30' and 40' Tied to Building | Ft.Sq. | 54 | m² | 579 | S |  |
| Scaffolding #6 | ✔ | Erect Scaffolding between 40' and 50' Tied to Building | Ft.Sq. | 60 | m² | 646 | S |  |
| Scaffolding #7 | ✔ | Erect Scaffolding between 50' and 60' Tied to Building | Ft.Sq. | 64 | m² | 685 | S |  |
| Scaffolding #8 | ✔ | Erect Scaffolding between 60' and 70' Tied to Building | Ft.Sq. | 68 | m² | 729 | S |  |
| Scaffolding #9 | ✔ | Erect Scaffolding between 70' and 80' Tied to Building | Ft.Sq. | 70 | m² | 753 | S |  |
| Scaffolding #10 |  | Erect Movable Trestles Up to 10' High Braced | Ft.Sq. | 29 | m² | 312 | C |  |
| Scaffolding #11 |  | Strengthen Scaffolding to Support Formwork Soffit | Ft.Run | 33 | m | 108 | C |  |
| Scaffolding #12 |  | Erect Scaffolding Board 10' to 20' Lengths | Each | 105 | Each | 105 | C |  |
| Scaffolding #13 |  | Dismantle Scaffolding Up to 20' High | Ft.Sq. | 15 | m² | 161 | C |  |
| Scaffolding #14 |  | Dismantle Scaffolding Between 20' and 40' High | Ft.Sq. | 19 | m² | 205 | C |  |
| Scaffolding #15 |  | Dismantle Scaffolding Above 40' High | Ft.Sq. | 30 | m² | 323 | C |  |
| Scaffolding #16 |  | Dismantle Unbraced Scaffolding Up to 20' High | Ft.Sq. | 8 | m² | 86 | C |  |

### Tiling

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Tiling #1 | ✔ | Terrazzo Tiles Lay and Grout | Yd.Sq. | 1,715 | m² | 2,051 | S |  |
| Tiling #2 | ✔ | Terrazzo Tiles First Cut | Yd.Sq. | 778 | m² | 931 | S |  |
| Tiling #3 | ✔ | Terrazzo Tile Final Cut and Polish | Yd.Sq. | 1,167 | m² | 1,396 | S |  |
| Tiling #4 | ✔ | Extra For Terrazzo Tiling to Upper Floors | Yd.Sq. | 125 | m² | 149 | S |  |
| Tiling #5 | ✔ | Terrazzo Tiles to Treads 10" wide Finished | Ft.Run | 414 | m | 1,357 | S |  |
| Tiling #6 | ✔ | Terrazzo Tiles to Treads 11"-12" Wide Finished | Ft.Run | 522 | m | 1,713 | S |  |
| Tiling #7 | ✔ | Terrazzo Tiles to Riser 6" to 8" High | Ft.Run | 458 | m | 1,502 | S |  |
| Tiling #8 | ✔ | Lay Grout Marble Tiles (12"+) Incl. for Edges (Floors) | Yd.Sq. | 3,098 | m² | 3,705 | S |  |
| Tiling #9 | ✔ | Lay Grout Marble Tiles (12"+) Incl. Cutting for Edges (Walls) | Yd.Sq. | 3,335 | m² | 3,988 | S |  |
| Tiling #10 |  | Lay Grout Cut Polish Thick Marble Tiles (12"+) Floors | Yd.Sq. | 4,085 | m² | 4,886 | C |  |
| Tiling #11 |  | Ceramic Tiles 4" Lay with Thinset/Mortar Grout and Clean | Yd.Sq. | 1,900 | m² | 2,272 | C |  |
| Tiling #12 |  | Ceramic Tiles 6" Lay with Thinset/Mortar Grout and Clean | Yd.Sq. | 1,767 | m² | 2,113 | C |  |
| Tiling #13 |  | Ceramic Tiles 8" Lay with Thinset/Mortar Grout and Clean | Yd.Sq. | 1,651 | m² | 1,975 | C |  |
| Tiling #14 |  | Ceramic Tiles (12"+) Lay with Thinset/Mortar Grout & Clean | Yd.Sq. | 1,571 | m² | 1,879 | C |  |
| Tiling #15 |  | Make Chamfer at Corners (Thin Tiles) | Ft.Run | 144 | m | 472 | C |  |
| Tiling #16 |  | Make Chamfer at Corners (Thick Tiles) | Ft.Run | 214 | m | 702 | C |  |
| Tiling #17 |  | Remove and Replace 4" x 4" Tiles in Small Areas | Ft.Sq. | 419 | m² | 4,510 | C |  |
| Tiling #18 |  | Remove and Replace 6" x 6" Tiles in Small Areas | Ft.Sq. | 390 | m² | 4,198 | C |  |
| Tiling #19 |  | Remove and Replace 8" x 8" Tiles in Small Areas | Ft.Sq. | 363 | m² | 3,907 | C |  |
| Tiling #20 |  | Remove and Replace 12" x 12" Tiles in Small Areas | Ft.Sq. | 349 | m² | 3,757 | C |  |
| Tiling #21 |  | Create Recess and Fix Soap Dish In Wall | No. | 2,182 | No. | 2,182 | C |  |
| Tiling #22 |  | Create Recess and Fix Toilet Paper Holder In Wall | No. | 2,182 | No. | 2,182 | C |  |
| Tiling #23 |  | Create Recesses and Fix Flanged Towel Rail in Wall | No. | 2,424 | No. | 2,424 | C |  |
| Tiling #24 |  | Ceramic Tiles to Treads 10"-12" Wide (Mortar/Thinset) | Ft.Run | 330 | m | 1,083 | C |  |
| Tiling #25 |  | Ceramic Tiles to Risers 6" x 8" High (Mortar/Thinset) | Ft.Run | 288 | m | 945 | C |  |
| Tiling #26 |  | Ceramic Skirting Tiles 4"-6" High Cut Lay Grout & Clean | Ft.Run | 204 | m | 669 | C |  |
| Tiling #27 |  | Ceramic Tiles to Shower Trays/Landings (Mortar/Thinset) | Yd.Sq. | 2,156 | m² | 2,579 | C |  |
| Tiling #28 |  | Ceramic Tiles to Upstand 8"-12" High (Mortar/Thinset) | Ft.Sq. | 362 | m² | 3,897 | C |  |
| Tiling #29 |  | Mosaic Tiles Lay and Grout 2" x 2" (Floors and Walls) | Ft.Sq. | 438 | m² | 4,715 | C |  |
| Tiling #30 |  | Mosaic Tiles Lay and Grout 1" x 1" (Floors and Walls) | Ft.Sq. | 511 | m² | 5,500 | C |  |
| Tiling #31 |  | Mosaic Tiles Lay and Grout 2" x 2" (Columns and Beams) | Ft.Sq. | 531 | m² | 5,716 | C |  |
| Tiling #32 |  | Mosaic Tiles Lay and Grout 1" x 1" (Columns and Beams) | Ft.Sq. | 621 | m² | 6,684 | C |  |
| Tiling #33 |  | Brick Tiles 4" x 8" | Yd.Sq. | 3,355 | m² | 4,013 | C |  |
| Tiling #34 |  | Vinyl Tile with Adhesive | Yd.Sq. | 1,297 | m² | 1,551 | C |  |

### Painting

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Painting #1 | ✔ | Emulsion Paint - Wall One Coat | Yd.Sq. | 107 | m² | 128 | S |  |
| Painting #2 | ✔ | Emulsion Paint - Wall Two Coats | Yd.Sq. | 206 | m² | 246 | S |  |
| Painting #3 | ✔ | Emulsion Paint - Pebble Dash One Coat | Yd.Sq. | 140 | m² | 167 | S |  |
| Painting #4 | ✔ | Emulsion Paint - Pebble Dash Two Coats | Yd.Sq. | 268 | m² | 320 | S |  |
| Painting #5 | ✔ | Emulsion Paint - Cutting to Line | Ft.Run | 9 | m | 31 | S |  |
| Painting #6 | ✔ | Emulsion Paint - Skirting 3"-4" One Coat | Ft.Run | 9 | m | 31 | S |  |
| Painting #7 | ✔ | Emulsion Paint - Skirting 3"-4" Two Coats | Ft.Run | 26 | m | 86 | S |  |
| Painting #8 | ✔ | Emulsion Paint - Ceiling One Coat | Yd.Sq. | 119 | m² | 142 | S |  |
| Painting #9 | ✔ | Emulsion Paint - Ceiling Two Coats | Yd.Sq. | 233 | m² | 278 | S |  |
| Painting #10 |  | Emulsion Paint - Dec Block One Coat | Yd.Sq. | 140 | m² | 167 | C |  |
| Painting #11 |  | Emulsion Paint - Dec Block Two Coats | Yd.Sq. | 268 | m² | 321 | C |  |
| Painting #12 |  | Emulsion Paint - Concrete Louvre One Coat | Yd.Sq. | 161 | m² | 193 | C |  |
| Painting #13 |  | Emulsion Paint - Concrete Louvre Two Coats | Yd.Sq. | 321 | m² | 384 | C |  |
| Painting #14 |  | Oil Paint - Dry Wall One Coat | Yd.Sq. | 122 | m² | 146 | C |  |
| Painting #15 |  | Oil Paint - Dry Wall Two Coats | Yd.Sq. | 243 | m² | 291 | C |  |
| Painting #16 |  | Oil Paint - Wall One Coat | Yd.Sq. | 124 | m² | 148 | C |  |
| Painting #17 |  | Oil Paint - Wall Two Coats | Yd.Sq. | 247 | m² | 295 | C |  |
| Painting #18 |  | Oil Paint - Pebble Dash One Coat | Yd.Sq. | 128 | m² | 153 | C |  |
| Painting #19 |  | Oil Paint - Pebble Dash Two Coats | Yd.Sq. | 259 | m² | 310 | C |  |
| Painting #20 |  | Oil Paint - Cutting to Line | Ft.Run | 8 | m | 26 | C |  |
| Painting #21 |  | Oil Paint - Skirting 3"-4" One Coat | Ft.Run | 10 | m | 33 | C |  |
| Painting #22 |  | Oil Paint - Skirting 3"-4" Two Coats | Ft.Run | 21 | m | 69 | C |  |
| Painting #23 |  | Oil Paint - Narrow Width | Yd.Sq. | 146 | m² | 175 | C |  |
| Painting #24 |  | Oil Paint - Ceiling One Coat | Yd.Sq. | 138 | m² | 165 | C |  |
| Painting #25 |  | Oil Paint - Ceiling Two Coats | Yd.Sq. | 277 | m² | 331 | C |  |
| Painting #26 |  | Oil Paint - Concrete Floor One Coat | Yd.Sq. | 81 | m² | 97 | C |  |
| Painting #27 |  | Oil Paint - Concrete Floor Two Coats | Yd.Sq. | 162 | m² | 194 | C |  |
| Painting #28 |  | Oil Paint - Wood Floor One Coat | Yd.Sq. | 85 | m² | 102 | C |  |
| Painting #29 |  | Oil Paint - Wood Floor Two Coats | Yd.Sq. | 171 | m² | 205 | C |  |
| Painting #30 |  | Oil Paint - Concrete Louvre One Coat | Yd.Sq. | 161 | m² | 193 | C |  |
| Painting #31 |  | Oil Paint - Concrete Louvre Two Coats | Yd.Sq. | 321 | m² | 384 | C |  |
| Painting #32 |  | Oil Paint - Dec Block One Coat | Yd.Sq. | 167 | m² | 200 | C |  |
| Painting #33 |  | Oil Paint - Dec Block Two Coats | Yd.Sq. | 335 | m² | 401 | C |  |
| Painting #34 |  | Oil Paint - Sarking One Coat | Yd.Sq. | 141 | m² | 169 | C |  |
| Painting #35 |  | Oil Paint - Sarking Two Coats | Yd.Sq. | 282 | m² | 337 | C |  |
| Painting #36 |  | Oil Paint - Grill One Coat | Yd.Sq. | 201 | m² | 240 | C |  |
| Painting #37 |  | Oil Paint - Grill Two Coats | Yd.Sq. | 401 | m² | 480 | C |  |
| Painting #38 |  | Oil Paint - Door One Coat | Yd.Sq. | 201 | m² | 240 | C |  |
| Painting #39 |  | Oil Paint - Door Two Coats | Yd.Sq. | 401 | m² | 480 | C |  |
| Painting #40 |  | Oil Paint - Door Frame One Coat | Yd.Sq. | 201 | m² | 240 | C |  |
| Painting #41 |  | Oil Paint - Door Frame Two Coats | Yd.Sq. | 401 | m² | 480 | C |  |
| Painting #42 |  | Oil Paint - Metal Door One Coat | Yd.Sq. | 201 | m² | 240 | C |  |
| Painting #43 |  | Oil Paint - Metal Door Two Coats | Yd.Sq. | 401 | m² | 480 | C |  |
| Painting #44 |  | Oil Paint - Fascia One Coat | Yd.Sq. | 401 | m² | 480 | C |  |
| Painting #45 |  | Oil Paint - Fascia Two Coats | Yd.Sq. | 803 | m² | 960 | C |  |
| Painting #46 |  | Oil Paint - Blocking Piece One Coat | Yd.Sq. | 401 | m² | 480 | C |  |
| Painting #47 |  | Oil Paint - Blocking Piece Two Coats | Yd.Sq. | 803 | m² | 960 | C |  |
| Painting #48 |  | Oil Paint - Rafters One Coats | Yd.Sq. | 401 | m² | 480 | C |  |
| Painting #49 |  | Oil Paint - Rafters Two Coats | Yd.Sq. | 803 | m² | 960 | C |  |
| Painting #50 |  | Oil Paint - Shelves One coat | Yd.Sq. | 446 | m² | 533 | C |  |
| Painting #51 |  | Oil Paint - Shelves Two Coats | Yd.Sq. | 892 | m² | 1,067 | C |  |
| Painting #52 |  | Oil Paint Timber Frame - One Coat | Yd.Sq. | 446 | m² | 533 | C |  |
| Painting #53 |  | Oil Paint Timber Frame - Two Coats | Yd.Sq. | 892 | m² | 1,067 | C |  |
| Painting #54 |  | Oil Paint Timber Frame - Three Coats | Yd.Sq. | 1,338 | m² | 1,600 | C |  |
| Painting #55 |  | Oil Paint - Cupboard - One Coat | Yd.Sq. | 535 | m² | 640 | C |  |
| Painting #56 |  | Oil Paint - Cupboard - Two Coats | Yd.Sq. | 1,071 | m² | 1,281 | C |  |
| Painting #57 |  | Oil Paint Metal Column - One Coat | Yd.Sq. | 446 | m² | 533 | C |  |
| Painting #58 |  | Oil Paint Metal Column - Two Coats | Yd.Sq. | 892 | m² | 1,067 | C |  |
| Painting #59 |  | Oil Paint - Gutter - One Coat | Ft.Run | 49 | m | 161 | C |  |
| Painting #60 |  | Oil Paint - Gutter - Two Coats | Ft.Run | 97 | m | 318 | C |  |
| Painting #61 |  | Oil Paint - Steel Tank | Yd.Sq. | 223 | m² | 267 | C |  |
| Painting #62 |  | Varnish - Rafter - One Coat | Yd.Sq. | 175 | m² | 209 | C |  |
| Painting #63 |  | Varnish - Rafter - Two Coats | Yd.Sq. | 349 | m² | 417 | C |  |
| Painting #64 |  | Varnish - Blocking Piece - One Coat | Yd.Sq. | 175 | m² | 209 | C |  |
| Painting #65 |  | Varnish - Blocking Piece - Two Coats | Yd.Sq. | 349 | m² | 417 | C |  |
| Painting #66 |  | Varnish - Sarking - One Coat | Yd.Sq. | 143 | m² | 171 | C |  |
| Painting #67 |  | Varnish - Sarking - Two Coats | Yd.Sq. | 263 | m² | 315 | C |  |
| Painting #68 |  | Varnish - Ceiling - One Coat | Yd.Sq. | 146 | m² | 175 | C |  |
| Painting #69 |  | Varnish - Ceiling - Two Coats | Yd.Sq. | 292 | m² | 349 | C |  |
| Painting #70 |  | Preservative - One Coat | Yd.Sq. | 287 | m² | 343 | C |  |
| Painting #71 |  | Preservative - Two Coats | Yd.Sq. | 143 | m² | 171 | C |  |
| Painting #72 |  | Tixapoxy - Steel Tank | Yd.Sq. | 554 | m² | 663 | C |  |
| Painting #73 |  | Water Seal Roof - One Coat | Yd.Sq. | 251 | m² | 300 | C |  |
| Painting #74 |  | Water Seal Roof - Two Coats | Yd.Sq. | 502 | m² | 600 | C |  |

### Joinery

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Joinery #1 | ✔ | 1" x 3" Skirtings Bevelled Top WPP | Ft.Run | 66 | m | 217 | S | same item as #61 at a different rate |
| Joinery #2 | ✔ | 1" x 4" Skirtings Bevelled Top WPP | Ft.Run | 73 | m | 241 | S | same item as #62 at a different rate |
| Joinery #3 | ✔ | 1" x 6" Skirtings Bevelled Top WPP | Ft.Run | 90 | m | 295 | S | same item as #63 at a different rate |
| Joinery #4 | ✔ | 1" x 3" Skirtings Bevelled to Mah Etc | Ft.Run | 73 | m | 241 | S |  |
| Joinery #5 | ✔ | 1" x 4" Skirtings Bevelled to Mah Etc | Ft.Run | 84 | m | 276 | S |  |
| Joinery #6 | ✔ | 1" x 6" Skirtings Bevelled to Mah Etc | Ft.Run | 99 | m | 325 | S |  |
| Joinery #7 | ✔ | 1" x 3" Skirtings Molded Top WPP | Ft.Run | 99 | m | 325 | S | same item as #67 at a different rate |
| Joinery #8 | ✔ | 1" x 4" Skirtings Molded Top WPP | Ft.Run | 110 | m | 361 | S | same item as #68 at a different rate |
| Joinery #9 | ✔ | 1" x 6" Skirtings Molded Top WPP | Ft.Run | 122 | m | 401 | S | same item as #69 at a different rate |
| Joinery #10 | ✔ | 1" x 3" Skirtings Molded Top Mah Etc | Ft.Run | 110 | m | 361 | S | same item as #70 at a different rate |
| Joinery #11 |  | 1" x 4" Skirtings Molded Top Mah Etc | Ft.Run | 122 | m | 400 | C | same item as #71 at a different rate |
| Joinery #12 |  | 1" x 6" Skirtings Molded Top Mah Etc | Ft.Run | 134 | m | 440 | C | same item as #72 at a different rate |
| Joinery #13 |  | 1" x 1/2" Molding For Flush Doors WPP | Ft.Run | 84 | m | 276 | C |  |
| Joinery #14 |  | 1" x 1/2" Molding For Flush Doors Cedar/WPP | Ft.Run | 94 | m | 308 | C |  |
| Joinery #15 |  | 1" x 2" Ceiling Molding WPP | Ft.Run | 84 | m | 276 | C |  |
| Joinery #16 |  | 1" x 3" Ceiling Molding WPP | Ft.Run | 94 | m | 308 | C |  |
| Joinery #17 |  | 1" x 4" Ceiling Molding WPP | Ft.Run | 122 | m | 400 | C |  |
| Joinery #18 |  | 1" x 2" Ceiling Molding Cedar/Mah | Ft.Run | 132 | m | 433 | C |  |
| Joinery #19 |  | 1" x 3" Ceiling Molding Cedar/Mah | Ft.Run | 139 | m | 456 | C |  |
| Joinery #20 |  | 1" x 4" Ceiling Molding Cedar/Mah | Ft.Run | 132 | m | 433 | C |  |
| Joinery #21 |  | 1" x 2" Architraves/Dado Rails Molded WPP | Ft.Run | 139 | m | 456 | C |  |
| Joinery #22 |  | 2" x 4" Door/Ditto Frame WPP | Ft.Run | 122 | m | 400 | C |  |
| Joinery #23 |  | 2" x 6" Door Frames WPP | Ft.Run | 139 | m | 456 | C |  |
| Joinery #24 |  | 2" x 8" Door Frames WPP | Ft.Run | 180 | m | 591 | C |  |
| Joinery #25 |  | 2" x 4" Door Frames Mah Etc | Ft.Run | 139 | m | 456 | C |  |
| Joinery #26 |  | 2" x 6" Door Frames Mah Etc | Ft.Run | 165 | m | 541 | C |  |
| Joinery #27 |  | 2" x 8" Door Frames Mah Etc | Ft.Run | 180 | m | 591 | C |  |
| Joinery #28 |  | Form Rebates in Jamb & Fit Timber Louvre (Fixed Louvre) | Each | 341 | Each | 341 | C |  |
| Joinery #29 |  | 1/2" x 1 1/2" Door Stops WPP | Ft.Run | 51 | m | 167 | C |  |
| Joinery #30 |  | 1/2" x 1 1/2" Door Stops Cedar/Mah Etc | Ft.Run | 52 | m | 171 | C |  |
| Joinery #31 |  | 1/2" x (3/8"-3/4") Plywood DR Lipping Make and Fit Cedar | Ft.Run | 68 | m | 223 | C |  |
| Joinery #32 |  | 2" x 4" Handrails WPP | Ft.Run | 124 | m | 407 | C |  |
| Joinery #33 |  | 2" x 6" Handrails WPP | Ft.Run | 132 | m | 433 | C |  |
| Joinery #34 |  | 2" x 4" Handrails Mah Etc | Ft.Run | 132 | m | 433 | C |  |
| Joinery #35 |  | 2" x 6" Handrails Mah Etc | Ft.Run | 134 | m | 440 | C |  |
| Joinery #36 |  | 2" x 12" Treads WPP Etc | Ft.Run | 208 | m | 682 | C |  |
| Joinery #37 |  | 2" x 12" Treads Cedar/Mah Etc | Ft.Run | 230 | m | 755 | C |  |
| Joinery #38 |  | 2" x 12" Stringer With Rebates For Treads/Risers WPP Etc | Ft.Run | 230 | m | 755 | C |  |
| Joinery #39 |  | 4" x 4" Newel Post Including Shaped Head and Rebates WPP | Ft.Run | 190 | m | 623 | C |  |
| Joinery #40 |  | 4" x 4" Newell Post Including Shaped Head and Rebates Mah/Cedar | Ft.Run | 208 | m | 682 | C |  |
| Joinery #41 |  | 2" x 2" Baluster (Unshaped) WPP | Ft.Run | 73 | m | 240 | C |  |
| Joinery #42 |  | 2" x 2" Baluster (Unshaped) Cedar | Ft.Run | 82 | m | 269 | C |  |
| Joinery #43 |  | Make Straight Edge 1" x 3" and 1" x 4" Rough | Ft.Run | 29 | m | 95 | C |  |
| Joinery #44 |  | Complete French Door With Glazing Strips 24"Wx80"H 6"x2"Pane | Each | 10,532 | Each | 10,532 | C |  |
| Joinery #45 |  | Complete French Door With Glazing Strips 30"Wx80"H 6"x3"Pane | Each | 12,375 | Each | 12,375 | C |  |
| Joinery #46 |  | Complete French Door With Glazing Strips 36"Wx80"H 6"x4"Pane | Each | 15,230 | Each | 15,230 | C |  |
| Joinery #47 |  | Make Kitchen Floor Cupboard (3'Hx2'W) From Plywood (No LID) | Ft.Run | 7,333 | m | 24,058 | C |  |
| Joinery #48 |  | Make Kitchen Floor Cupboard (3'Hx2'W) From Plywood & Laminate (No LID) | Ft.Run | 8,354 | m | 27,408 | C |  |
| Joinery #49 |  | Make Kitchen Floor Cupboard (3'Hx2'W) From Pine (Sprayed) | Ft.Run | 7,333 | m | 24,058 | C |  |
| Joinery #50 |  | Make Kitchen Floor Cupboard (3'Hx2'W) From Cedar (Sprayed) | Ft.Run | 8,879 | m | 29,131 | C |  |
| Joinery #51 |  | Make Kitchen Wall Cupboard (2'Hx1'W) From Ply and Laminate | Ft.Run | 6,899 | m | 22,635 | C |  |
| Joinery #52 |  | Make Kitchen Wall Cupboard (2'Hx1'W) From Pine (Sprayed) | Ft.Run | 6,036 | m | 19,803 | C |  |
| Joinery #53 |  | Make Kitchen Wall Cupboard (2'Hx1'W) From Cedar (Sprayed) | Ft.Run | 7,443 | m | 24,419 | C |  |
| Joinery #54 |  | Make Kitchen Wall Cupboard (2'Hx1'W) From Ply Only | Ft.Run | 5,252 | m | 17,231 | C |  |
| Joinery #55 |  | Make Vanitory Cupboard (32"Hx22"W) From Plywood (No LID) | Ft.Run | 5,964 | m | 19,567 | C |  |
| Joinery #56 |  | Make Vanitory Cupboard (32"Hx22"W) From Ply & Laminate (No LID) | Ft.Run | 6,804 | m | 22,323 | C |  |
| Joinery #57 |  | Make Vanitory Cupboard (32"Hx22"W) From Pine (Sprayed) | Ft.Run | 5,964 | m | 19,567 | C |  |
| Joinery #58 |  | Make Vanitory Cupboard (32"Hx22"W) From Cedar (Sprayed) | Ft.Run | 7,226 | m | 23,707 | C |  |
| Joinery #59 |  | Make Serpentine Louvre (Rods Blades Stops etc) 40x16 14 Blades | Ft.Sq. | 1,523 | m² | 16,393 | C |  |
| Joinery #60 |  | Make Fixed Louvre Doors (1 3/8"-1 3/4") Thick | Ft.Sq. | 1,064 | m² | 11,453 | C |  |
| Joinery #61 |  | 1" X 3" Skirtings Bevelled Top WPP | Ft.Run | 107 | m | 351 | C | same item as #1 at a different rate |
| Joinery #62 |  | 1" x 4" Skirtings Bevelled Top WPP | Ft.Run | 107 | m | 351 | C | same item as #2 at a different rate |
| Joinery #63 |  | 1" x 6" Skirtings Bevelled Top WPP | Ft.Run | 132 | m | 433 | C | same item as #3 at a different rate |
| Joinery #64 |  | 1" x 3" Skirtings Bevelled Top Mah ETC | Ft.Run | 121 | m | 397 | C |  |
| Joinery #65 |  | 1" x 4" Skirtings Bevelled Top Mah ETC | Ft.Run | 121 | m | 397 | C |  |
| Joinery #66 |  | 1" x 6" Skirtings Bevelled Top Mah ETC | Ft.Run | 148 | m | 486 | C |  |
| Joinery #67 |  | 1" x 3" Skirtings Molded Top WPP | Ft.Run | 157 | m | 515 | C | same item as #7 at a different rate |
| Joinery #68 |  | 1" x 4" Skirtings Molded Top WPP | Ft.Run | 157 | m | 515 | C | same item as #8 at a different rate |
| Joinery #69 |  | 1" x 6" Skirtings Molded Top WPP | Ft.Run | 183 | m | 600 | C | same item as #9 at a different rate |
| Joinery #70 |  | 1" x 3" Skirtings Molded Top Mah Etc | Ft.Run | 175 | m | 574 | C | same item as #10 at a different rate |
| Joinery #71 |  | 1" x 4" Skirtings Molded Top Mah Etc | Ft.Run | 175 | m | 574 | C | same item as #11 at a different rate |
| Joinery #72 |  | 1" x 6" Skirtings Molded Top Mah Etc | Ft.Run | 202 | m | 663 | C | same item as #12 at a different rate |
| Joinery #73 |  | 1" x 1/2" Moldings for Face of Flush Doors WPP | Ft.Run | 97 | m | 318 | C |  |
| Joinery #74 |  | 1" x 1/2" Moldings for Face of Flush Doors Cedar/Mah | Ft.Run | 107 | m | 351 | C |  |
| Joinery #75 |  | 1" x 2" Ceiling Moldings WPP | Ft.Run | 180 | m | 591 | C |  |
| Joinery #76 |  | 1" x 3" Ceiling Moldings WPP | Ft.Run | 194 | m | 636 | C |  |
| Joinery #77 |  | 1" x 4" Ceiling Moldings WPP | Ft.Run | 194 | m | 636 | C |  |
| Joinery #78 |  | 1" x 2" Ceiling Moldings Cedar/Mah | Ft.Run | 194 | m | 636 | C |  |
| Joinery #79 |  | 1" x 3" Ceiling Moldings Cedar/Mah | Ft.Run | 208 | m | 682 | C |  |
| Joinery #80 |  | 1" x 4" Ceiling Moldings Cedar/Mah | Ft.Run | 208 | m | 682 | C |  |
| Joinery #81 |  | 2" x 4" Door/Window/Lattice Frames WPP | Ft.Run | 183 | m | 600 | C |  |
| Joinery #82 |  | 2" x 6" Door/Window Frames WPP | Ft.Run | 228 | m | 748 | C |  |
| Joinery #83 |  | 2" x 8" Door/Window Frames WPP | Ft.Run | 228 | m | 748 | C |  |
| Joinery #84 |  | 2" x 4" Door/Window Frames Mah Etc | Ft.Run | 183 | m | 600 | C |  |
| Joinery #85 |  | 2" x 6" Door/Window Frames Mah Etc | Ft.Run | 202 | m | 663 | C |  |
| Joinery #86 |  | 2" x 8" Door/Window Frames Mah Etc | Ft.Run | 239 | m | 784 | C |  |
| Joinery #87 |  | Fit Shower Curtain Rails Surface Mtd | Each | 1,678 | Each | 1,678 | C |  |
| Joinery #88 |  | Fit Soap Dish Surface Mtd | Each | 1,678 | Each | 1,678 | C |  |
| Joinery #89 |  | Fit Towel Rails Surface Mounted | Each | 1,678 | Each | 1,678 | C |  |
| Joinery #90 |  | Fit Hand Towel Roll Holder | Each | 1,678 | Each | 1,678 | C |  |
| Joinery #91 |  | Fit Toilet Paper Holder Surface Mtd | Each | 1,399 | Each | 1,399 | C |  |
| Joinery #92 |  | Fit Tooth Brush Holder Surf/Mtd | Each | 811 | Each | 811 | C |  |
| Joinery #93 |  | Fit Soap Dispenser Surf/Mtd | Each | 1,365 | Each | 1,365 | C |  |
| Joinery #94 |  | 1/2"x1 1/2" Door Stops WPP Etc | Ft.Run | 54 | m | 177 | C |  |
| Joinery #95 |  | 1/2"x1 1/2" Door Stops Mah Etc | Ft.Run | 54 | m | 177 | C |  |
| Joinery #96 |  | 3/4"x3/4" Strip All Materials | Ft.Run | 54 | m | 177 | C |  |
| Joinery #97 |  | 2" x 4" Handrails WPP Including Pelleting | Ft.Run | 194 | m | 636 | C |  |
| Joinery #98 |  | 2" x 6" Handrails WPP Including Pelleting | Ft.Run | 213 | m | 699 | C |  |
| Joinery #99 |  | 2" x 4" Handrails Mah Etc Including Pelleting | Ft.Run | 194 | m | 636 | C |  |
| Joinery #100 |  | 2" x 6" Handrails Mah Etc Including pelleting | Ft.Run | 213 | m | 699 | C |  |

### Plumbing

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Plumbing #1 | ✔ | 6" Diameter pipes | Ft.Run | 323 | m | 1,060 | S |  |
| Plumbing #2 | ✔ | 4" Diameter Pipes | Ft.Run | 244 | m | 801 | S |  |
| Plumbing #3 | ✔ | 3" Diameter Pipes | Ft.Run | 229 | m | 753 | S |  |
| Plumbing #4 | ✔ | 2" Diameter Pipes | Ft.Run | 151 | m | 495 | S |  |
| Plumbing #5 | ✔ | 1.5" Diameter Pipes | Ft.Run | 125 | m | 411 | S |  |
| Plumbing #6 | ✔ | 1.25" Diameter Pipes | Ft.Run | 125 | m | 411 | S |  |
| Plumbing #7 | ✔ | 300mm (12') Push Fit Pipes | Ft.Run | 656 | m | 2,151 | S |  |
| Plumbing #8 | ✔ | 250mm (10') Push Fit Pipes | Ft.Run | 534 | m | 1,751 | S |  |
| Plumbing #9 | ✔ | 200mm (8') Push Fit Pipes | Ft.Run | 417 | m | 1,369 | S |  |
| Plumbing #10 |  | 150mm (6') Push Fit Pipes | Ft.Run | 323 | m | 1,060 | C |  |
| Plumbing #11 |  | 100mm (4') Push Fit Pipes | Ft.Run | 244 | m | 801 | C |  |
| Plumbing #12 |  | 6" Single End Fitting | No. | 410 | No. | 410 | C |  |
| Plumbing #13 |  | 4" Single End Fitting | No. | 212 | No. | 212 | C |  |
| Plumbing #14 |  | 3" Single End Fitting | No. | 160 | No. | 160 | C |  |
| Plumbing #15 |  | 2" Single End Fitting | No. | 151 | No. | 151 | C |  |
| Plumbing #16 |  | 1.5" Single End Fitting | No. | 108 | No. | 108 | C |  |
| Plumbing #17 |  | 1.25" Single End Fitting | No. | 108 | No. | 108 | C |  |
| Plumbing #18 |  | 6" Double End Fitting | No. | 765 | No. | 765 | C |  |
| Plumbing #19 |  | 4" Double End Fitting | No. | 433 | No. | 433 | C |  |
| Plumbing #20 |  | 3" Double End Fitting | No. | 328 | No. | 328 | C |  |
| Plumbing #21 |  | 2" Double End Fitting | No. | 298 | No. | 298 | C |  |
| Plumbing #22 |  | 1.5" Double End Fitting | No. | 219 | No. | 219 | C |  |
| Plumbing #23 |  | 1.25" Double End Fitting | No. | 219 | No. | 219 | C |  |
| Plumbing #24 |  | 6" Three End Fitting | No. | 1,275 | No. | 1,275 | C |  |
| Plumbing #25 |  | 4" Three End Fitting | No. | 656 | No. | 656 | C |  |
| Plumbing #26 |  | 3" Three End Fitting | No. | 488 | No. | 488 | C |  |
| Plumbing #27 |  | 2" Three End Fitting | No. | 450 | No. | 450 | C |  |
| Plumbing #28 |  | 1.5" Three End Fitting | No. | 323 | No. | 323 | C |  |
| Plumbing #29 |  | 1.25" Three End Fitting | No. | 323 | No. | 323 | C |  |
| Plumbing #30 |  | 6" Four End Fitting | No. | 1,639 | No. | 1,639 | C |  |
| Plumbing #31 |  | 4" Four End Fitting | No. | 850 | No. | 850 | C |  |
| Plumbing #32 |  | 3" Four End Fitting | No. | 656 | No. | 656 | C |  |
| Plumbing #33 |  | 2" Four End Fitting | No. | 604 | No. | 604 | C |  |
| Plumbing #34 |  | 1.5" Four End Fitting | No. | 433 | No. | 433 | C |  |
| Plumbing #35 |  | 1.25" Four End Fitting | No. | 433 | No. | 433 | C |  |
| Plumbing #36 |  | 4" Diameter P-Trap | No. | 717 | No. | 717 | C |  |
| Plumbing #37 |  | 3" Diameter P-Trap | No. | 604 | No. | 604 | C |  |
| Plumbing #38 |  | 2" Diameter P-Trap | No. | 433 | No. | 433 | C |  |
| Plumbing #39 |  | 1.5" Diameter P-Trap | No. | 403 | No. | 403 | C |  |
| Plumbing #40 |  | 300mm Double End Fitting | No. | 1,530 | No. | 1,530 | C |  |
| Plumbing #41 |  | 250mm Double End Fitting | No. | 1,275 | No. | 1,275 | C |  |
| Plumbing #42 |  | 200mm Double End Fitting | No. | 1,093 | No. | 1,093 | C |  |
| Plumbing #43 |  | 300mm Three End Fitting | No. | 2,294 | No. | 2,294 | C |  |
| Plumbing #44 |  | 250mm Three End Fitting | No. | 1,912 | No. | 1,912 | C |  |
| Plumbing #45 |  | 200mm Three End Fitting | No. | 1,639 | No. | 1,639 | C |  |
| Plumbing #46 |  | 300mm Four End Fitting | No. | 2,868 | No. | 2,868 | C |  |
| Plumbing #47 |  | 250mm Four End Fitting | No. | 2,549 | No. | 2,549 | C |  |
| Plumbing #48 |  | 200mm Four End Fitting | No. | 2,086 | No. | 2,086 | C |  |
| Plumbing #49 |  | Lavatory Basin With Mixer and Waste Connection | No. | 5,736 | No. | 5,736 | C |  |
| Plumbing #50 |  | Vanitory Basin Single Bowl With Mixer And Waste Connection | No. | 5,736 | No. | 5,736 | C |  |
| Plumbing #51 |  | Vanitory Basin Double Bowl With Mixer and Waste Connection | No. | 11,472 | No. | 11,472 | C |  |
| Plumbing #52 |  | Kitchen Sink Single Bowl With Mixer and Waste Connection | No. | 5,736 | No. | 5,736 | C |  |
| Plumbing #53 |  | Kitchen Sink Double Bowl With Mixer and Waste Connection | No. | 7,648 | No. | 7,648 | C |  |
| Plumbing #54 |  | Water Heater (30-40 Gal With B/Off Supply Connection) | No. | 7,648 | No. | 7,648 | C |  |
| Plumbing #55 |  | Water Cooler Including Supply and Waste Connection | No. | 7,648 | No. | 7,648 | C |  |
| Plumbing #56 |  | Shower Waste, Mixer, Rose and Arm Hot & Cold | No. | 7,648 | No. | 7,648 | C |  |
| Plumbing #57 |  | Shower Waste, Mixer, Rose and Arm Cold | No. | 3,824 | No. | 3,824 | C |  |
| Plumbing #58 |  | Bath Tub Complete With Waste, Mixer, Shower Etc | No. | 22,945 | No. | 22,945 | C |  |
| Plumbing #59 |  | Water Closet Complete S-Trap Including Supply | No. | 7,648 | No. | 7,648 | C |  |
| Plumbing #60 |  | Water Closet Complete P-Trap Including Supply | No. | 7,648 | No. | 7,648 | C |  |
| Plumbing #61 |  | Urinal Complete With Tank Including Waste and Supply | No. | 7,648 | No. | 7,648 | C |  |
| Plumbing #62 |  | Install Roof Drains With Adapter To Proper Alignment | No. | 8,498 | No. | 8,498 | C |  |
| Plumbing #63 |  | 1/2" Diameter Schedule 40 Pipe | Ft.Run | 115 | m | 377 | C |  |
| Plumbing #64 |  | 3/4" Diameter Schedule 40 Pipe | Ft.Run | 139 | m | 456 | C |  |
| Plumbing #65 |  | 1" Diameter Schedule 40 Pipe | Ft.Run | 170 | m | 558 | C |  |
| Plumbing #66 |  | 1.25" Diameter Schedule 40 Pipe | Ft.Run | 184 | m | 604 | C |  |
| Plumbing #67 |  | 1.5" Diameter Schedule 40 Pipe | Ft.Run | 191 | m | 627 | C |  |
| Plumbing #68 |  | 2" Diameter Schedule 40 Pipe | Ft.Run | 219 | m | 719 | C |  |
| Plumbing #69 |  | 3" Diameter Schedule 40 Pipe | Ft.Run | 264 | m | 866 | C |  |
| Plumbing #70 |  | 4" Diameter Schedule 40 Pipe | Ft.Run | 306 | m | 1,004 | C |  |
| Plumbing #71 |  | 6" Diameter 160 PSI Pipe | Ft.Run | 403 | m | 1,322 | C |  |
| Plumbing #72 |  | 100mm Pipe | Ft.Run | 306 | m | 1,004 | C |  |
| Plumbing #73 |  | 150mm Pipe | Ft.Run | 396 | m | 1,299 | C |  |
| Plumbing #74 |  | 200mm Pipe | Ft.Run | 534 | m | 1,752 | C |  |
| Plumbing #75 |  | 250mm Pipe | Ft.Run | 637 | m | 2,090 | C |  |
| Plumbing #76 |  | 300mm Pipe | Ft.Run | 765 | m | 2,510 | C |  |
| Plumbing #77 |  | 1/2" Diameter Schedule 40 Single End Fitting | No. | 115 | No. | 115 | C |  |
| Plumbing #78 |  | 3/4" Diameter Schedule 40 End Fitting | No. | 124 | No. | 124 | C |  |
| Plumbing #79 |  | 1" Diameter Schedule 40 Single End Fitting | No. | 135 | No. | 135 | C |  |
| Plumbing #80 |  | 1 1/4" Diameter Schedule 40 Single End Fitting | No. | 143 | No. | 143 | C |  |
| Plumbing #81 |  | 1 1/2" Diameter Schedule 40 Single End Fitting | No. | 153 | No. | 153 | C |  |
| Plumbing #82 |  | 2" Diameter Schedule 40 Single End Fitting | No. | 164 | No. | 164 | C |  |
| Plumbing #83 |  | 3" Diameter Schedule 40 Single End Fitting | No. | 219 | No. | 219 | C |  |
| Plumbing #84 |  | 4" Diameter Schedule 40 Single End Fitting | No. | 302 | No. | 302 | C |  |
| Plumbing #85 |  | 6" Diameter Schedule 40 Single End Fitting | No. | 521 | No. | 521 | C |  |
| Plumbing #86 |  | 1/2" Diameter Schedule 40 Double End Fitting | No. | 234 | No. | 234 | C |  |
| Plumbing #87 |  | 3/4" Diameter Schedule 40 Double End Fitting | No. | 247 | No. | 247 | C |  |
| Plumbing #88 |  | 1" Diameter Schedule 40 Double End Fitting | No. | 261 | No. | 261 | C |  |
| Plumbing #89 |  | 1 1/4" Diameter Schedule 40 Double End Fitting | No. | 276 | No. | 276 | C |  |
| Plumbing #90 |  | 1 1/2" Diameter Schedule 40 Double End Fitting | No. | 294 | No. | 294 | C |  |
| Plumbing #91 |  | 2" Diameter Schedule 40 Double End Fitting | No. | 319 | No. | 319 | C |  |
| Plumbing #92 |  | 3" Diameter Schedule 40 Double End Fitting | No. | 433 | No. | 433 | C |  |
| Plumbing #93 |  | 4" Diameter Schedule 40 Double End Fitting | No. | 604 | No. | 604 | C |  |
| Plumbing #94 |  | 6" Diameter Schedule 40 Double End Fitting | No. | 1,043 | No. | 1,043 | C |  |
| Plumbing #95 |  | 1/2" Diameter Schedule 40 Triple End Fitting | No. | 342 | No. | 342 | C |  |
| Plumbing #96 |  | 3/4" Diameter Schedule 40 Triple End Fitting | No. | 364 | No. | 364 | C |  |
| Plumbing #97 |  | 1" Diameter Schedule 40 Triple End Fitting | No. | 396 | No. | 396 | C |  |
| Plumbing #98 |  | 1 1/4" Diameter Schedule 40 Triple End Fitting | No. | 417 | No. | 417 | C |  |
| Plumbing #99 |  | 1 1/2" Diameter Schedule 40 Triple End Fitting | No. | 450 | No. | 450 | C |  |
| Plumbing #100 |  | 2" Diameter Schedule 40 Triple End Fitting | No. | 478 | No. | 478 | C |  |

### Electrical

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Electrical #1 | ✔ | 1/2" diameter pipe | Ft.Run | 35.73 | m | 117.23 | S |  |
| Electrical #2 | ✔ | 3/4" diameter pipe | Ft.Run | 41.94 | m | 137.62 | S |  |
| Electrical #3 | ✔ | 1" diameter pipe | Ft.Run | 48.23 | m | 158.26 | S | same item as #7 at a different rate |
| Electrical #4 | ✔ | 1-1/4" diameter pipe | Ft.Run | 56.75 | m | 186.19 | S | same item as #8 at a different rate |
| Electrical #5 | ✔ | 1-1/2" diameter pipe | Ft.Run | 68.91 | m | 226.08 | S | same item as #9 at a different rate |
| Electrical #6 | ✔ | 2" diameter pipe | Ft.Run | 80.39 | m | 263.76 | S | same item as #10 at a different rate |
| Electrical #7 | ✔ | 1" diameter pipe | Ft.Run | 83.89 | m | 275.23 | S | same item as #3 at a different rate |
| Electrical #8 | ✔ | 1-1/4" diameter pipe | Ft.Run | 96.47 | m | 316.52 | S | same item as #4 at a different rate |
| Electrical #9 | ✔ | 1-1/2" diameter pipe | Ft.Run | 107.19 | m | 351.68 | S | same item as #5 at a different rate |
| Electrical #10 |  | 2" diameter pipe | Ft.Run | 120.59 | m | 395.64 | C | same item as #6 at a different rate |
| Electrical #11 |  | 2-1/2" diameter pipe | Ft.Run | 160.78 | m | 527.49 | C |  |
| Electrical #12 |  | 3" diameter pipe | Ft.Run | 192.94 | m | 633.01 | C |  |
| Electrical #13 |  | 4" diameter pipe | Ft.Run | 241.17 | m | 791.24 | C |  |
| Electrical #14 |  | 4" Octogan and Squares | Each | 482.35 | Each | 482.35 | C |  |
| Electrical #15 |  | Blank Covers | Each | 150.73 | Each | 150.73 | C |  |
| Electrical #16 |  | Switch & Wall Socket | Each | 357.29 | Each | 357.29 | C |  |
| Electrical #17 |  | 15 amp Duplex recp & blank plate | Each | 1,753.99 | Each | 1,753.99 | C |  |
| Electrical #18 |  | 20 amp Duplex recp & phone plate | Each | 1,929.39 | Each | 1,929.39 | C |  |
| Electrical #19 |  | 6"Hx6"Wx4"D | Each | 1,205.87 | Each | 1,205.87 | C |  |
| Electrical #20 |  | 8"Hx8"Wx4"D | Each | 1,205.87 | Each | 1,205.87 | C |  |
| Electrical #21 |  | 10"Hx12"Wx6"D | Each | 1,753.99 | Each | 1,753.99 | C |  |
| Electrical #22 |  | 16"Hx20"Wx8"D | Each | 2,411.73 | Each | 2,411.73 | C |  |
| Electrical #23 |  | 20"Hx24"Wx8"D | Each | 2,756.27 | Each | 2,756.27 | C |  |
| Electrical #24 |  | 24"Hx36"Wx8"D | Each | 3,215.64 | Each | 3,215.64 | C |  |
| Electrical #25 |  | 100 amp with 10 branch breaker | Each | 8,106.66 | Each | 8,106.66 | C |  |
| Electrical #26 |  | 150 amp with 14 branch breaker | Each | 9,365.95 | Each | 9,365.95 | C |  |
| Electrical #27 |  | 200 amp with 18 branch breaker | Each | 10,718.81 | Each | 10,718.81 | C |  |
| Electrical #28 |  | Lighting Surge Suppresor | Each | 301.47 | Each | 301.47 | C |  |
| Electrical #29 |  | Single pole 15 amp ivory with 1 gang box & C/plate | Each | 567.47 | Each | 567.47 | C |  |
| Electrical #30 |  | Single pole, rotary dimmer | Each | 665.31 | Each | 665.31 | C |  |
| Electrical #31 |  | Single pole switch with pilot Light | Each | 838.86 | Each | 838.86 | C |  |
| Electrical #32 |  | 2-3 way switches | Each | 1,071.88 | Each | 1,071.88 | C |  |
| Electrical #33 |  | Duplex outlet, 15 amp recpt ivory with 1gang c/plate | Each | 665.31 | Each | 665.31 | C |  |
| Electrical #34 |  | 2.5 mm2 PVC Single Wire | Ft.Run | 20.97 | m | 68.80 | C |  |
| Electrical #35 |  | 4 mm2 PVC Single Wire | Ft.Run | 42.88 | m | 140.68 | C |  |
| Electrical #36 |  | 6 mm2 PVC Single Wire | Ft.Run | 59.37 | m | 194.78 | C |  |
| Electrical #37 |  | 10 mm2 PVC Single Wire | Ft.Run | 85.75 | m | 281.33 | C |  |
| Electrical #38 |  | 16 mm2 PVC Single Wire | Ft.Run | 96.47 | m | 316.50 | C |  |
| Electrical #39 |  | 25 mm2 PVC Single Wire | Ft.Run | 101.55 | m | 333.17 | C |  |
| Electrical #40 |  | 35 mm2 PVC Single Wire | Ft.Run | 107.19 | m | 351.67 | C |  |
| Electrical #41 |  | 50 mm2 PVC Single Wire | Ft.Run | 113.49 | m | 372.34 | C |  |
| Electrical #42 |  | 70 mm2 PVC Single Wire | Ft.Run | 120.59 | m | 395.64 | C |  |
| Electrical #43 |  | 95 mm2 PVC Single Wire | Ft.Run | 128.63 | m | 422.01 | C |  |
| Electrical #44 |  | 120 mm2 PVC Single Wire | Ft.Run | 133.06 | m | 436.55 | C |  |
| Electrical #45 |  | 150 mm2 PVC Single Wire | Ft.Run | 137.81 | m | 452.13 | C |  |
| Electrical #46 |  | 240 mm2 PVC Single Wire | Ft.Run | 148.41 | m | 486.91 | C |  |
| Electrical #47 |  | 2.5 mm2 Bare copper wire | Ft.Run | 19.99 | m | 65.58 | C |  |
| Electrical #48 |  | 4 mm2 Bare copper wire | Ft.Run | 38.59 | m | 126.61 | C |  |
| Electrical #49 |  | 6 mm2 Bare copper wire | Ft.Run | 53.59 | m | 175.82 | C |  |
| Electrical #50 |  | 10 mm2 Bare copper wire | Ft.Run | 81.07 | m | 265.98 | C |  |
| Electrical #51 |  | 16 mm2 Bare copper wire | Ft.Run | 96.47 | m | 316.50 | C |  |
| Electrical #52 |  | 25 mm2 Bare copper wire | Ft.Run | 101.55 | m | 333.17 | C |  |
| Electrical #53 |  | 35 mm2 Bare copper wire | Ft.Run | 107.19 | m | 351.67 | C |  |
| Electrical #54 |  | 50 mm2 Bare copper wire | Ft.Run | 113.49 | m | 372.34 | C |  |
| Electrical #55 |  | 70 mm2 Bare copper wire | Ft.Run | 120.59 | m | 395.64 | C |  |
| Electrical #56 |  | 95 mm2 Bare copper wire | Ft.Run | 128.63 | m | 422.01 | C |  |
| Electrical #57 |  | 120 mm2 Bare copper wire | Ft.Run | 133.06 | m | 436.55 | C |  |
| Electrical #58 |  | 150 mm2 Bare copper wire | Ft.Run | 137.81 | m | 452.13 | C |  |
| Electrical #59 |  | 240 mm2 Bare copper wire | Ft.Run | 148.41 | m | 486.91 | C |  |
| Electrical #60 |  | 2.5 mm2 PVC/xlpe | Ft.Run | 154.35 | m | 506.40 | C | also listed as #73 |
| Electrical #61 |  | 4 mm2 PVC/xlpe | Ft.Run | 160.78 | m | 527.49 | C | also listed as #74 |
| Electrical #62 |  | 6 mm2 PVC/xlpe | Ft.Run | 167.77 | m | 550.43 | C | also listed as #75 |
| Electrical #63 |  | 10 mm2 PVC/xlpe | Ft.Run | 175.40 | m | 575.46 | C | also listed as #76 |
| Electrical #64 |  | 16 mm2 PVC/xlpe | Ft.Run | 183.75 | m | 602.85 | C | also listed as #77 |
| Electrical #65 |  | 25 mm2 PVC/xlpe | Ft.Run | 192.94 | m | 633.01 | C | also listed as #78 |
| Electrical #66 |  | 35 mm2 PVC/xlpe | Ft.Run | 192.94 | m | 633.01 | C | also listed as #79 |
| Electrical #67 |  | 50 mm2 PVC/xlpe | Ft.Run | 203.09 | m | 666.31 | C | also listed as #80 |
| Electrical #68 |  | 70 mm2 PVC/xlpe | Ft.Run | 214.38 | m | 703.35 | C | also listed as #81 |
| Electrical #69 |  | 95 mm2 PVC/xlpe | Ft.Run | 226.99 | m | 744.72 | C | also listed as #82 |
| Electrical #70 |  | 120 mm2 PVC/xlpe | Ft.Run | 257.25 | m | 844.00 | C | also listed as #83 |
| Electrical #71 |  | 150 mm2 PVC/xlpe | Ft.Run | 275.63 | m | 904.30 | C | also listed as #84 |
| Electrical #72 |  | 240 mm2 PVC/xlpe | Ft.Run | 296.83 | m | 973.85 | C | also listed as #85 |

### Welding

| Ref | App | Description | Imp. Unit | Imp. Rate | Met. Unit | Met. Rate | Basis | Note |
|---|:-:|---|---|---:|---|---:|:-:|---|
| Welding #1 | ✔ | Handle Mark Cut & Sand Smooth: 1/8" Thick Metal Using Torch | In. | 50 | 100mm | 198 | S | cutting and smoothing, not welding |
| Welding #2 | ✔ | Handle Mark Cut & Sand Smooth: 1/4" Thick Metal Using Torch | In. | 64 | 100mm | 251 | S | cutting and smoothing, not welding |
| Welding #3 | ✔ | Handle Mark Cut & Sand Smooth: 3/8" Thick Metal Using Torch | In. | 70 | 100mm | 276 | S | cutting and smoothing, not welding |
| Welding #4 | ✔ | Handle Mark Cut & Sand Smooth: 1/2" Thick Metal Using Torch | In. | 78 | 100mm | 306 | S | cutting and smoothing, not welding |
| Welding #5 | ✔ | Handle Mark Cut & Sand Smooth: 5/8" Thick Metal Using Torch | In. | 88 | 100mm | 345 | S | cutting and smoothing, not welding |
| Welding #6 | ✔ | Handle Mark Cut & Sand Smooth: 3/4" Thick Metal Using Torch | In. | 97 | 100mm | 383 | S | cutting and smoothing, not welding |
| Welding #7 | ✔ | Handle Mark Cut & Sand Smooth: 1" Thick Metal Using Torch | In. | 117 | 100mm | 460 | S | cutting and smoothing, not welding |
| Welding #8 | ✔ | Handle Mark Cut & Sand Smooth 1/16" Thick Metal Using CPSAW | In. | 25 | 100mm | 99 | S | cutting and smoothing, not welding |
| Welding #9 | ✔ | Handle Mark Cut & Sand Smooth 1/8" Thick Metal Using CPSAW | In. | 39 | 100mm | 153 | S | cutting and smoothing, not welding |
| Welding #10 |  | Handle Mark Cut & Sand Smooth 1/4" Thick Metal Using CPSAW | In. | 50 | 100mm | 197 | C | cutting and smoothing, not welding |
| Welding #11 |  | Handle Mark Cut & Sand Smooth 3/8" Thick Metal Using CPSAW | In. | 60 | 100mm | 236 | C | cutting and smoothing, not welding |
| Welding #12 |  | Handle Mark Cut & Sand Smooth 1/2" Thick Metal Using CPSAW | In. | 70 | 100mm | 276 | C | cutting and smoothing, not welding |
| Welding #13 |  | Handle Mark Cut & Sand Smooth 5/8" Thick Metal Using CPSAW | In. | 80 | 100mm | 315 | C | cutting and smoothing, not welding |
| Welding #14 |  | Handle Mark Cut & Sand Smooth 3/4" Thick Metal Using CPSAW | In. | 88 | 100mm | 346 | C | cutting and smoothing, not welding |
| Welding #15 |  | Drill Holes (1/8"x1/4") Diameter Through (1/8"-1/4") Thick With Press | Ea. | 50 | Ea. | 50 | C |  |
| Welding #16 |  | Drill Holes (3/8"-1/2") Diameter Through (1/8"-1/4") Thick with Press | Ea. | 73 | Ea. | 73 | C |  |
| Welding #17 |  | Drill Holes (5/8"-1/2") Diameter Through (1/8"-1/4") Thick with Press | Ea. | 97 | Ea. | 97 | C |  |
| Welding #18 |  | Drill Holes (7/8"-1") Diameter Through (1/8"-1/4") Thick with Press | Ea. | 121 | Ea. | 121 | C |  |
| Welding #19 |  | Drill Holes (1/8"-1/4") Diameter Through (3/8"-1/2") Thick with Press | Ea. | 73 | Ea. | 73 | C |  |
| Welding #20 |  | Drill Holes (3/8"-1/2") Diameter Through (3/8"-1/2") Thick with Press | Ea. | 97 | Ea. | 97 | C |  |
| Welding #21 |  | Drill Holes (5/8"-3/4") Diameter Through (3/8"-1/2") Thick with Press | Ea. | 121 | Ea. | 121 | C |  |
| Welding #22 |  | Drill Holes (7/8"-1") Diameter Through (3/8"-1/2") Thick with Press | Ea. | 146 | Ea. | 146 | C |  |
| Welding #23 |  | Drill Holes (1/8"-1/4") Diameter Through (5/8"-3/4") Thick with Press | Ea. | 97 | Ea. | 97 | C |  |
| Welding #24 |  | Drill Holes (3/8"-1/2") Diameter Through (5/8"-3/4") Thick with Press | Ea. | 121 | Ea. | 121 | C |  |
| Welding #25 |  | Drill Holes (5/8"-3/4") Diameter Through (5/8"-3/4") Thick with Press | Ea. | 146 | Ea. | 146 | C |  |
| Welding #26 |  | Drill Holes (7/8"-1") Diameter Through (5/8"-3/4") Thick with Press | Ea. | 170 | Ea. | 170 | C |  |
| Welding #27 |  | Drill Holes (1/8"-1/4") Diameter Through (7/8"-1") Thick with Press | Ea. | 121 | Ea. | 121 | C |  |
| Welding #28 |  | Drill Holes (3/8"-1/2") Diameter Through (7/8"-1") Thick with Press | Ea. | 146 | Ea. | 146 | C |  |
| Welding #29 |  | Drill Holes (5/8"-3/4") Diameter Through (7/8"-1") Thick with Press | Ea. | 170 | Ea. | 170 | C |  |
| Welding #30 |  | Drill Holes (7/8"-1") Diameter Through (7/8"-1") Thick with Press | Ea. | 195 | Ea. | 195 | C |  |
| Welding #31 |  | Drill Holes (1/8"-1/4") Dia Through (1/8"-1/4") Thick with Hand Drill | Ea. | 64 | Ea. | 64 | C |  |
| Welding #32 |  | Drill Holes (3/8"-1/2") Dia Through (1/8"-1/4") Thick with Hand Drill | Ea. | 95 | Ea. | 95 | C |  |
| Welding #33 |  | Drill Holes (5/8"-1/2") Dia Through (1/8"-1/4") Thick with Hand Drill | Ea. | 121 | Ea. | 121 | C |  |
| Welding #34 |  | Drill Holes (7/8"-1") Dia Through (1/8"-1/4") Thick with Hand Drill | Ea. | 150 | Ea. | 150 | C |  |
| Welding #35 |  | Drill Holes (1/8"-1/4") Dia Through (3/8"-1/2") Thick with Hand Drill | Ea. | 95 | Ea. | 95 | C |  |
| Welding #36 |  | Drill Holes (3/8"-1/2") Dia Through (3/8"-1/2") Thick with Hand Drill | Ea. | 121 | Ea. | 121 | C |  |
| Welding #37 |  | Drill Holes (5/8"-3/4") Dia Through (3/8"-1/2") Thick with Hand Drill | Ea. | 150 | Ea. | 150 | C |  |
| Welding #38 |  | Drill Holes (7/8"-1") Diameter Through (3/8"-1/2") Thick with Hand Drill | Ea. | 184 | Ea. | 184 | C |  |
| Welding #39 |  | Drill Holes (1/8"-1/4") Dia Through (5/8"-3/4") Thick with Hand Drill | Ea. | 121 | Ea. | 121 | C |  |
| Welding #40 |  | Drill Holes (3/8"-1/2") Dia Through (5/8"-3/4") Thick with Hand Drill | Ea. | 150 | Ea. | 150 | C |  |
| Welding #41 |  | Drill Holes (5/8"-3/4") Dia Through (5/8"-3/4") Thick with Hand Drill | Ea. | 184 | Ea. | 184 | C |  |
| Welding #42 |  | Drill Holes (7/8"-1") Diameter Through (5/8"-3/4") Thick with Hand Drill | Ea. | 211 | Ea. | 211 | C |  |
| Welding #43 |  | Drill Holes (1/8"-1/4") Diameter Through (7/8"-1") Thick with Hand Drill | Ea. | 150 | Ea. | 150 | C |  |
| Welding #44 |  | Drill Holes (3/8"-1/2") Diameter Through (7/8"-1") Thick with Hand Drill | Ea. | 184 | Ea. | 184 | C |  |
| Welding #45 |  | Drill Holes (5/8"-3/4") Diameter Through (7/8"-1") Thick with Hand Drill | Ea. | 211 | Ea. | 211 | C |  |
| Welding #46 |  | Drill Holes (7/8"-1") Diameter Through (7/8"-1") Thick with Hand Drill | Ea. | 243 | Ea. | 243 | C |  |
| Welding #47 |  | Drill Holes (1/8"-1/4") Diameter Through (1/8"-1/4") Thick with Torch | Ea. | 25 | Ea. | 25 | C |  |
| Welding #48 |  | Drill Holes (3/8"-1/2") Diameter Through (1/8"-1/4") Thick with Torch | Ea. | 39 | Ea. | 39 | C |  |
| Welding #49 |  | Drill Holes (5/8"-1/2") Diameter Through (1/8"-1/4") Thick with Torch | Ea. | 50 | Ea. | 50 | C |  |
| Welding #50 |  | Drill Holes (7/8"-1") Diameter Through (1/8"-1/4") Thick with Torch | Ea. | 63 | Ea. | 63 | C |  |
| Welding #51 |  | Drill Holes (1/8"-1/4") Diameter Through (3/8"-1/2") Thick with Torch | Ea. | 39 | Ea. | 39 | C |  |
| Welding #52 |  | Drill Holes (3/8"-1/2") Diameter Through (3/8"-1/2") Thick with Torch | Ea. | 50 | Ea. | 50 | C |  |
| Welding #53 |  | Drill Holes (5/8"-3/4") Diameter Through (3/8"-1/2") Thick with Torch | Ea. | 63 | Ea. | 63 | C |  |
| Welding #54 |  | Drill Holes (7/8"-1") Diameter Through (3/8"-1/2") Thick with Torch | Ea. | 73 | Ea. | 73 | C |  |
| Welding #55 |  | Drill Holes (1/8"-1/4") Diameter Through (5/8"-3/4") Thick with Torch | Ea. | 50 | Ea. | 50 | C |  |
| Welding #56 |  | Drill Holes (3/8"-1/2") Diameter Through (5/8"-3/4") Thick with Torch | Ea. | 63 | Ea. | 63 | C |  |
| Welding #57 |  | Drill Holes (5/8"-3/4") Diameter Through (5/8"-3/4") Thick with Torch | Ea. | 73 | Ea. | 73 | C |  |
| Welding #58 |  | Drill Holes (7/8"-1") Diameter Through (5/8"-3/4") Thick with Torch | Ea. | 88 | Ea. | 88 | C |  |
| Welding #59 |  | Drill Holes (1/8"-1/4") Diameter Through (7/8"-1") Thick with Torch | Ea. | 63 | Ea. | 63 | C |  |
| Welding #60 |  | Drill Holes (3/8"-1/2") Diameter Through (7/8"-1") Thick with Torch | Ea. | 73 | Ea. | 73 | C |  |
| Welding #61 |  | Drill Holes (5/8"-3/4") Diameter Through (7/8"-1") Thick with Torch | Ea. | 88 | Ea. | 88 | C |  |
| Welding #62 |  | Drill Holes (7/8"-1") Diameter Through (7/8"-1") Thick with Torch | Ea. | 97 | Ea. | 97 | C |  |
| Welding #63 |  | 1/4" Fillet Weld | In. | 73 | 100mm | 287 | C |  |
| Welding #64 |  | 3/8" Fillet Weld | In. | 106 | 100mm | 417 | C |  |
| Welding #65 |  | 1/4" Butt Weld | In. | 88 | 100mm | 346 | C |  |
| Welding #66 |  | 3/8" Butt Weld | In. | 125 | 100mm | 492 | C |  |
| Welding #67 |  | 1/2" Butt Weld | In. | 170 | 100mm | 669 | C |  |
| Welding #68 |  | Handle/Fit for Welding Up to 5" Girth Felt Ls RHS Pipes | Ft.Run | 50 | m | 164 | C |  |
| Welding #69 |  | Handle/Fit For Welding Up to 3" Girth Solid Square | Ft.Run | 50 | m | 164 | C |  |
| Welding #70 |  | Handle/Fit Welding (5"-10") Girth Felt Ls RHS Pipes | Ft.Run | 73 | m | 240 | C |  |
| Welding #71 |  | Handle/Fit for Welding (3"-6") Girth Solid Square | Ft.Run | 73 | m | 240 | C |  |
| Welding #72 |  | Handle/Fix For Welding Above 10" Girth: Felt Ls RHS Pipe | Ft.Run | 97 | m | 318 | C |  |
| Welding #73 |  | Handle/Fix for Welding Above 6" Girth Solid Square | Ft.Run | 97 | m | 318 | C |  |
| Welding #74 |  | Handle/Fix For Welding (1/16"-1/8") Thick: Plates | Ft.Sq. | 121 | m² | 1,302 | C |  |
| Welding #75 |  | Handle/Fit For Welding (1/4"-3/8") Thick: Plates | Ft.Sq. | 146 | m² | 1,572 | C |  |
| Welding #76 |  | Handle/Fit For Welding (1/2"-5/8") Thick: Plates | Ft.Sq. | 170 | m² | 1,830 | C |  |
| Welding #77 |  | Handle/Fit For Welding (3/4"-1") Thick: Plates | Ft.Sq. | 195 | m² | 2,099 | C |  |
| Welding #78 |  | Make Hurricane Straps 1/8" x 2" x 8" Folded and Drilled | Each | 365 | Each | 365 | C |  |
| Welding #79 |  | Make Gutter Brackets 1/4" x 1 1/2" x 24" Bent and Drilled | Each | 427 | Each | 427 | C |  |
| Welding #80 |  | Make cover 1/8" Thick Plate With Single Hole: 12"x12" | Each | 1,412 | Each | 1,412 | C |  |
| Welding #81 |  | Make Covers 1/8" Thick Plate With Single Hole 18"x18" | Each | 2,189 | Each | 2,189 | C |  |
| Welding #82 |  | Make Covers 1/8" Thick Plate With Single Hole 24"x24" | Each | 3,019 | Each | 3,019 | C |  |
| Welding #83 |  | Make Covers 3/16" Thick Plate With Single Hole 12"x12" | Each | 1,549 | Each | 1,549 | C |  |
| Welding #84 |  | Make Covers 3/16" Thick Plate With Single Hole 18"x18" | Each | 2,398 | Each | 2,398 | C |  |
| Welding #85 |  | Make Covers 3/16" Thick Plate With Single Hole 24"x24" | Each | 3,303 | Each | 3,303 | C |  |
| Welding #86 |  | Make Covers 1/4" Thick Plate With Single Hole 12"x12" | Each | 1,683 | Each | 1,683 | C |  |
| Welding #87 |  | Make Covers 1/4" Thick Plate With Single Hole 18"x18" | Each | 2,575 | Each | 2,575 | C |  |
| Welding #88 |  | Make Covers 1/4" Thick Plate With Single Hole 24"x24" | Each | 3,502 | Each | 3,502 | C |  |
| Welding #89 |  | Make Covers 3/8" Thick Plate With Single Hole 12"x12" | Each | 1,751 | Each | 1,751 | C |  |
| Welding #90 |  | Make Covers 3/8" Thick Plate With Single Hole 18"x18" | Each | 2,918 | Each | 2,918 | C |  |
| Welding #91 |  | Make Covers 3/8" Thick Plate With Single Hole 24x24" | Each | 4,377 | Each | 4,377 | C |  |
| Welding #92 |  | Make Covers 1/2" Thick Plate With Single Hole 12"x12" | Each | 1,945 | Each | 1,945 | C |  |
| Welding #93 |  | Make Covers 1/2" Thick Plate With Single Hole 18"x18" | Each | 3,502 | Each | 3,502 | C |  |
| Welding #94 |  | Make Covers 1/2" Thick Plate With Single Hole 24"x24" | Each | 4,377 | Each | 4,377 | C |  |
| Welding #95 |  | Make Covers 1/8" Thick Plate With Handle 12"x12" | Each | 1,592 | Each | 1,592 | C |  |
| Welding #96 |  | Make Covers 1/8" Thick Plate With Handle 18"x18" | Each | 2,501 | Each | 2,501 | C |  |
| Welding #97 |  | Make Covers 1/8" Thick Plate With Handle 24"x24" | Each | 3,502 | Each | 3,502 | C |  |
| Welding #98 |  | Make Covers 3/16" Thick Plate With Handle 12"x12" | Each | 1,751 | Each | 1,751 | C |  |
| Welding #99 |  | Make Covers 3/16" Thick Plate With Handle 18"x18" | Each | 2,501 | Each | 2,501 | C |  |
| Welding #100 |  | Make Covers 3/16" Thick Plate With Handle 24"x24" | Each | 3,502 | Each | 3,502 | C |  |

---
*Generated from the owner's pasted pages. Rates were keyed and then checked: reference numbers run without gaps in every trade, and every one of the 100 shipped rows matches the paste on rate and unit.*
