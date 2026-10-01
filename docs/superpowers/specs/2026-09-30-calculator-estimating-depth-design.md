# Build Cost Calculator - Estimating Depth (design spec)

> Owner directive 2026-09-30: close the real gaps between the calculator and a
> full construction calculation process. Keep it planning-grade, offline-first,
> on-device. Research-backed; sources listed per section.

## 1. Verdict on the external assessment (2026-09-30)

The assessment ("what the calculator covers / what is missing for a complete
construction calculation") is directionally right but wrong on four specifics.
Recorded here so the waves correct the real gaps and do not rebuild what
exists.

### 1.1 Claims that are WRONG (already in the engine, `js/calculator-page.js`)

| Assessment claim | Reality in the code |
|---|---|
| "Does not automatically compute material waste percentages" | Per-trade EDITABLE waste fields with defaults: slab/footings/driveway 5% concrete waste, roof 10% laps/pitch, tile 10% cuts, shingle roof 10% laps/cuts (`waste:` in the WORK table, `wastePct` in computeFor) |
| "Mortar ratios for blockwork" missing | Baked into the unit norms: 12.5 blocks/m2, 60 bricks/m2, both "with mortar allowance" |
| "Lap/splice allowances for rebar" missing | Rebar norm 85 kg/m3 is a laps-inclusive planning norm (not a separately editable factor - fair refinement, see W6, but not absent) |
| Takeoffs absent (piece counting implied missing) | Full per-piece engine exists: tile/brick/block/sheet/panel/bag counts, size-to-rate conversion, order-count output ("order about 220 tiles at 30 x 60 cm") |

### 1.2 Claims that are RIGHT (real gaps -> this wave)

1. **No BoQ roll-up** - prices one work item at a time; no multi-line bill that
   aggregates a whole job (Designing Buildings: takeoff -> BoQ is the standard
   compilation step; NRM2 sections).
2. **No preliminaries / indirects** - site establishment, permits, insurance,
   supervision, temporary works, welfare, demob. (Plexa/Procore: 5-15% of
   contract value; residential 5-8%.)
3. **No contingency or escalation** - AACE Class 5/4 planning estimates carry
   explicit contingency; 2026 escalation consensus 4-6%/yr.
4. **No labor productivity layer** - flat per-unit rates only; no
   crew/manhours basis (RSMeans: labor cost/unit = crew cost / daily output).
5. **No location data** - static rates; no per-location index (BY DESIGN:
   offline-first is sacred - AGENTS.md rule 3. Data packs, not live APIs.)
6. **No schedule/time-value** - no duration, cash-flow curve, or escalation
   over time.
7. **Formwork takeoff absent** - genuinely missing (W5).

## 2. Research findings (2026-09-30; 12 searches + 4 deep reads)

Numbers below feed defaults and fine-print copy. Every default stays
user-editable.

- **Prelims 5-15% of contract value**; residential 5-8%, commercial 8-12%,
  civil 12-18%. Split FIXED (one-time: permits, insurance/bonds, site
  establishment, demob) vs TIME-RELATED (running: site staff, welfare,
  temporary utilities, scaffold/plant standing). (Plexa, Procore, RIB;
  O'Leary 2025: project overheads+prelims 10-20%.)
- **General conditions (GC-level site overhead) 5-15% of total incl O&P, 10%
  most typical** (RSMeans estimating guide). RSMeans O&P convention: +10%
  profit on material and equipment, OH&P on labor.
- **AACE 18R-97 accuracy bands**: Class 5 (concept/screening) -30%/+50%,
  Class 4 -15%/+30%. The calculator is a Class 5/4 planning tool - say so in
  the fine print instead of pretending more.
- **Contingency**: design contingency 10% and construction contingency 5-10%
  are the common planning defaults (AACE contingency guidance; DPS NY
  guidelines). Ship editable defaults 10% + 5%.
- **Escalation 2026**: consensus baseline 4-6%/yr (Q2-2026 US outlook; AICCIE
  proposed 4.5% CY26; Zarenski nonres bldgs ~4.4-4.7%). Planning default 5%/yr.
- **Cash flow**: straight-line | S-curve | manual distribution; S-curve =
  normal distribution over start..end month with adjustable steepness
  (Adventures in CRE method; RICS cash-flow forecasting 2nd ed.).
- **Labor productivity**: labor cost/unit = crew hourly cost / crew daily
  output; crews itemize trades + equipment (RSMeans crew listings; manhours
  per unit, e.g. Methvin formwork 1.2 mhr/m2 strip footings).
- **Rebar laps/cuts/offcuts total waste 10-18% by project type**
  (rebar-calculator matrix). The engine's 85 kg/m3 stays all-in; expose an
  optional editable add-on % defaulting to empty (= included).
- **Jamaica statutory stack (owner directive 2026-09-30, verified against
  PwC Worldwide Tax Summaries + Dawgen + Skuad + HEART-NSTA):** employer
  contributions on GROSS PAYROLL total about 12.5% - NIS 3% (insurable
  earnings cap J$5,000,000/yr), NHT 3%, HEART/NSTA 3%, Education Tax 3.5%
  (on emoluments after NIS). The EMPLOYEE side (PAYE 25%/30% over J$6M
  after the J$1,902,360/yr threshold, employee NIS/NHT/Education) is the
  worker's affair and NEVER a line in a works estimate. The 2% Contractors
  Levy (Contractors Levy Act) is a WITHHOLDING the client makes from
  contract payments for construction/haulage/tillage services, remitted to
  TAJ within 14 days of month-end - a cash-flow note, not a cost line.
  Estimating consequence: labor billed per hour here is usually a CONTRACTOR
  price (already carrying the employer stack), so the on-cost must be an
  OPTIONAL toggle defaulting OFF, clearly worded, default rate 12.5% for
  Jamaica; GCT 15% on the works is separate and stays as-is.
- **Formwork for the calculator's concrete trades is DERIVABLE from the
  dimensions already entered**: slab/driveway edge formwork = 2(L+W) x
  thickness; footing sides = 2(L+W) x depth. No ratio tables needed for the
  trades we have (ratios only matter for columns/walls we do not price).
- **Jamaica**: GCT standard rate 15% (PwC; lowered from 16.5% in 2020) - the
  app's JM 15% is CORRECT; registered contractors charge GCT on the full
  taxable service value. Residential benchmarks vary wildly by source
  (US$65-121/ft2 standard-spec; J$6,500-7,000/ft2 budgetary contractor figure;
  US$90-130/ft2 older survey) - so NO single baked-in JM benchmark; the
  whole-house sanity check becomes an editable location-pack value.
- **tru-estimator.vercel.app (owner's reference, crawled 2026-09-30 with
  Playwright: homepage, directory, auth wall, route map from JS bundles, and
  8 guest calculators - foundation-lineout, excavation, concrete-slab, roof,
  tile, paint, labour, markup)**: a Jamaican estimator (GCT 15% toggle,
  JIC 2025-2027 wage-scale rate book, hurricane-strap line items) whose
  measurement UX is INSTANCE-BASED: every dimension-driven calculator takes
  repeated named element rows - "+ Add section" with Length x Width and a
  "Number of identical sections" multiplier (digital timesing), "+ Add slab",
  "+ Add roof section" (per-plane pitch with an in-UI pitch reference table),
  "+ Add room / area", "+ Add labour" - plus a total-override field ("Direct
  perimeter (overrides L x W)") for when the user already knows the sum.
  Rates are per-unit and inline-editable; derived materials are listed
  explicitly (profile boards, nails, thinset bags with coverage, tile boxes).

## 3. Design principles (unchanged, hard)

1. **Offline-first is sacred** - no network calls for prices. Location data =
   user-editable packs, JSON export/import (same pattern as rate sheets).
2. **Planning-grade identity** - "not a quote" fine print stays; new copy
   states the honest accuracy band instead of implying bid-level precision.
3. **One pure engine** - every new computation is a pure function beside
   `computeFor()` (D2 pattern), unit-testable without DOM.
4. **Nothing leaves the device** - BoQ/prelims/cash-flow all live in
   localStorage under new keys; existing keys untouched (backward compatible).
5. Repo gates: no emoji on served pages, plain-language copy, data-action
   dispatch, CSP-safe (no inline scripts), `node build.js` + `?v=` bumps,
   harness + registry updates per wave.

## 4. Module decisions

- **W1 BoQ roll-up**: named bill with lines `{key, d1, d2, d3, units, waste,
  piece..., rates}` - each line priced by the EXISTING `computeFor()`; add
  current form state as a line; per-line + totals table; recall re-fills the
  form (exact recall extended). New localStorage key `mmgr_calc_boq`.
- **W2 Element instances (add-a-wall, tru-estimator pattern)**: for
  dimension-driven trades the line can be measured by repeated named element
  rows instead of one generic L x W - walls (blockwall, brickwall, framing,
  render, paint, drywall), pours (slab, footings, concrete-drive), runs
  (fencing, skirt, pipe, conduit), rooms/areas (tile). Each row: label
  ("Wall 1"), its own dims, and a count multiplier for identical repeats;
  "+ Add wall / + Add pour / + Add run / + Add area" buttons; a "type the
  total instead" override (tru-estimator's direct-perimeter field). Rows sum
  to a measured quantity x unit that feeds the EXISTING engine as
  `st.measuredQty` + `st.measuredUnit` - `computeFor()` skips dim validation
  and q() when measuredQty is present; waste, quality, piece pricing and
  rates all still apply unchanged. Pure function
  `instancesQty(rows, kind) -> {qty, rows}`.
- **W3 Statutory labor on-costs (JM-verified) + levy note**: optional
  "Employer statutory costs" toggle + % field, default 12.5% when the country
  is Jamaica (from the research: NIS 3% capped J$5M + NHT 3% + HEART 3% +
  Education Tax 3.5%), empty/0 otherwise; applies to the LABOR subtotal
  inside computeFor (st.onCostPct), shown as its own breakdown line "Labor
  statutory costs (12.5%)" so the owner sees it as labor, not tax. When
  country = Jamaica, a static fine-print note under the output: "Paying a
  registered contractor? They may deduct 2% Contractors Levy from contract
  payments (TAJ, within 14 days of month-end) - it is a withholding from the
  price, not an extra cost."
- **W4 Prelims**: item list with basis `fixed amount | % of works | weekly x
  weeks`; default residential items (establishment/facilities, permits,
  insurance & bonds, supervision, temporary utilities, scaffold access,
  demob) seeded at 0 with a one-click "typical residential set" preset that
  sums to ~6-7% guidance. Own card, feeds grand total.
- **W5 Contingency + escalation + duration**: design contingency (default
  10%), construction contingency (default 5%), escalation %/yr (default 5%)
  over duration months (from W6 or typed) - applied on the roll-up after
  prelims, before tax.
- **W6 Cash flow**: monthly table over duration; straight-line or S-curve
  (normal distribution, adjustable steepness); cumulative column; CSV export.
  Pure function `cashCurve(total, months, mode, steepness)`.
- **W7 Concrete accessories**: derived formwork m2 for slab/driveway/footings
  (from the line's dimensions or its pour instances; editable rate) and rebar laps/cuts % add-on
  (default empty = included in 85 kg/m3, hint: 10-18% if you want it
  explicit). Adds as optional auto-lines in the BoQ.
- **W8 Location packs**: named profile `{name, currency, taxDefault, index,
  benchmark}` where index multiplies material rates (global or per group) and
  benchmark is the whole-house sanity note. JSON export/import like rate
  sheets. Shipped defaults: US (1.00), JM, GB - figures sourced in comments.
  (tru-estimator's JIC wage-scale rate book is the same idea server-side;
  ours stays on-device.)
- **W9 Integration pass**: estimate summary restructure (lines -> prelims ->

## 5. Out of scope (recorded, not promised)

- Live supplier price feeds (violates offline-first; revisit only as explicit
  opt-in cloud feature).
- Crew composer / full RSMeans-style manhour database (productivity is a
  manhours-per-unit field per trade, not a crew library).
- Gantt scheduling, critical path, retention/progress billing.
- Multi-currency line mixing (one currency per bill, set by location pack).
- tru-estimator ideas noted for phase 2, not this wave: per-plane roof pitch
  factors with an in-UI pitch reference table, derived consumables lines
  (thinset/grout bags, hurricane straps), ft+in fractional row entry (ours
  converts whole ft/in per row the same way the unit toggle already does).
