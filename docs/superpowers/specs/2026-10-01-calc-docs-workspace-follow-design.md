# Calculator Client Documents + Workspace Follow - Design

**Date:** 2026-10-01
**Owner:** Garfield Fairclough (approved in-session, run-all directive)
**Page:** `calculator.html` + `js/calculator-page.js` (standalone estimating workspace)
**Predecessor:** `2026-09-30-calculator-estimating-depth-design.md` (estimating depth, shipped 2026-10-01 as `b50e57a7`)

## Verdict on the owner's request (what exists vs what's real)

The owner asked for: professional invoice PDF/CSV with signature area, logo
upload with sign-in memory, punch-list awareness, discounts, "and many more".
Research against the codebase:

| Requested | Already exists | Real gap |
|---|---|---|
| Invoice PDF | Print sheet (browser Print > Save as PDF) with Estimate/Quote/Invoice doc types (owner 2026-09-30 naming pass) | No logo, no bill-to, no document number, no signature area |
| CSV | `estimateCsv()` download | Missing brand/client/discount rows |
| Logo memory | Device-local business NAME only (D3, `mmgr_calc_biz_name`) | No logo, no contact details, no account follow |
| Discounts | Old in-app utility calculator has a one-off % tool | No discount in the estimating workspace roll-up |
| Punch list | None | No companion/associated tasks when pricing |

Offline-first stays sacred (AGENTS.md rule 3): the page makes ZERO required
network calls today and that must not change - cloud follow is restore +
backup only, every failure silent, signed-out behavior identical to today.

## Owner decisions (2026-10-01)

1. **Invoice path:** upgrade the existing print sheet (no PDF library, no
   separate invoice screen). All three doc types benefit.
2. **Brand home:** a "Business details" card on the calculator (logo upload,
   name folding in the existing lone business-name input, contact lines,
   TRN/reg no, signature name+title).
3. **Associated work:** one-tap suggested add-on lines (never auto-added),
   mirroring the W7-formwork derived-lines pattern.
4. **Discount:** roll-up level (% or fixed, fixed wins when both set),
   discount before contingencies in the waterfall, rides every export.
5. **Sign-in scope:** EVERYTHING follows the account (brand, saved estimates,
   bill, history, packs, rollup settings, doc counter).
6. **Storage hygiene:** logo downscaled client-side to <= 1MB before store.
7. **Subscription window:** build the entitlement seam now (`plan: 'free'`
   server-side, client checks `Entitlements.can(feature)`), so paid tiers
   are a server-side flip later.
8. **Plain by default:** a bare estimate must print exactly like today -
   logo/contact/bill-to/signature appear only when filled in or toggled.

## Wave map (6 waves, one commit each)

### W1 - Discount on the roll-up (engine first)

- Pure `applyDiscount(works, prelims, discPct, discAmt) -> { works, prelims,
  discount, base }`: fixed wins when both set; discount never negative;
  `base = max(0, works + prelims - discount)`.
- `rollup()` grows discount params; waterfall order becomes Works -> Prelims
  -> Discount -> Design C -> Construction C -> Escalation -> Subtotal -> Tax
  -> TOTAL. Contingencies and escalation compute on the DISCOUNTED base
  (discount before risk money), documented + gated.
- UI: "Discount" field-pair (percent off / fixed amount off) in the roll-up
  settings block; plain-language label "Give a discount"; persists in
  `mmgr_calc_rollup` (additive keys); blank = none.
- Cash curve rides the discounted total; CSV + print sheet gain the line.

### W2 - Companion work suggestions (the punch-list reality)

- Pure `COMPANIONS` map: work-key -> ordered list of `{ key, comp }`
  suggestions, each with a derivation `fn(st)` returning qty+unit+name from
  the SAME typed dimensions. Curated set (initial, extensible):
  - blockwall/brickwall/framing/render/paint/drywall: "Lining out the walls"
    (profiles/strings, per m run from the measured perimeter), "Clear brush
    and strip topsoil" (per m2), "Cart away debris" (per m2 - light).
  - slab/footings/concrete-drive/rebar: "Cart away debris and surplus
    excavated material" (per m3 poured), mesh/vapor-barrier lines for slabs.
  - fencing: "Debrush line of fence" (per m run), "Post holes - clear and
    backfill" (per hole from instance rows or run/spacing).
  - siteprep: "Cart away debris" (per m2), "Burn or haul off brush" note.
  - Every suggestion is editable/removable once in the bill (it is a normal
    BoQ line tagged `derivedFrom` for traceability).
- UI: under a priced result, a "Commonly added with this" chip row
  (one-tap "Add to bill"), hidden when no companions exist or when every
  suggestion is already in the bill. Trade changes re-derive.

### W3 - Business details card + professional document sheet

- Card (collapsible, after the export row): logo file input (accept image/*;
  client-side canvas downscale so the stored dataURL is <= 1MB - target max
  dimension 600px, JPEG q0.85 fallback PNG when transparency present;
  preview + Remove), business name (folds in `mmgr_calc_biz_name`, read the
  old key once and migrate), phone, email, address, TRN/registration no.,
  signature name + title. Storage `mmgr_calc_brand` (one JSON object).
- Per-document fields in the export row: client/bill-to name, project
  address, document number (auto-suggest `INV-0001`/`EST-0001` counter,
  editable, counter bumps only on explicit user edit acceptance), date
  (today default, editable), optional due date. Ride the saved estimate.
- Print/PDF sheet (class-scoped `print-estimate` as today): letterhead block
  (logo left, name + contact right) -> doc title/number/date -> bill-to ->
  line items -> totals -> signature area: two sign/date columns -
  "Contractor" (name + title from brand) and "Client acceptance" - present
  when signature lines are enabled.
- Signature default: ON for Invoice, OFF for Estimate/Quote, with a visible
  "Show signature lines on the printed sheet" checkbox in the business card.
- Plain-by-default: every sheet extra renders only when its data exists
  (logo only when uploaded, bill-to only when typed, signature lines only
  when enabled). Bare estimate prints byte-equivalent to today's sheet.
- CSV gains: brand name, contact, client, doc number/date, discount rows.

### W4 - Entitlement seam (the subscription window)

- `Entitlements` in calculator-page.js: `FEATURES` table
  (`cloudFollow`, `logoSync` - extensible), `plan` from the workspace probe
  (server field, today always `'free'`), `can(feature)` gate. Default allow.
- Feature code NEVER reads the plan directly - only `Entitlements.can()`.
- Server workspace response carries `plan`; flipping a user to a paid tier
  later is a server-side change only.

### W5 - Cloud workspace follow (everything, offline-first preserved)

- Worker: `GET/PUT /api/calc/workspace` in `src/router.js` (+ a
  `src/cloud/calc-workspace.js` handler module mirroring
  `src/cloud/sync.js` prefs pattern): `readSession` auth, R2 object
  `calc-ws/<sub>.json`, PUT body cap 4MB, per-section `updatedAt` stamps,
  response carries `plan: 'free'`. No schema migration (R2 blob like prefs).
- Client behavior on load: if online, silent GET probe. 200 = signed in:
  merge (per section, cloud wins ONLY where its `updatedAt` is newer; empty
  local section adopts cloud wholesale), then debounced autosave PUT on
  every persisted change (2s debounce, trailing). 403/any error = silent
  no-op, device-local exactly as today. Offline/failed probe: proceed
  local-first; the next successful save retries via the debounce.
- Synced sections: brand, estimates (saved estimates), boq (bill),
  history, packs (location packs + rollup settings), docCounter.
- The logo rides the brand section (already <= 1MB; whole payload < 4MB).
- Sign-out intent: signed-out devices keep working 100% locally; nothing is
  deleted locally when cloud is unreachable. "Clear browser data" note in
  the fine print updated to mention sign-in follow.

### W6 - Integration pass

- Guide + tour: steps for discount, companions, business card; tour anchors
  `#calc-brand-card`, `#calc-companions` (11 -> 13-14 steps); TUT gates
  re-baselined.
- Mobile: no horizontal scroll at 390px with brand card open + companions
  visible; inputs 16px (iOS zoom gate).
- Docs: CHANGELOG entry, fine print ("signed in? your workspace follows
  you"), guide A-card for invoices.
- sw shell bump if any shared css changed (verify:sw enforces).
- Full battery + CI + deploy + production smoke (reusable
  tmp/live-tour-smoke.cjs + new workspace probe).

## Architecture

- All client logic stays in `js/calculator-page.js` pure functions beside
  `computeFor()` + the `__calcEngine` test hook (extend, never break).
- UI rides the `data-action` dispatch; no inline scripts (CSP); no emoji
  anywhere; plain-language copy throughout (labels say what things do).
- Worker handler isolated in `src/cloud/calc-workspace.js`; router line
  mirrors the prefs route; no D1 change; R2-only.
- Bundle staleness law: `node build.js` + `?v=` bump after every asset
  change; sw shell bump when shared css changes.

## Error handling

- Logo decode failure / non-image / >8MB source: inline plain-language
  message in the card, no state change.
- localStorage quota: brand save failure shows the same message pattern the
  history card uses (silent degrade, never blocks pricing).
- Cloud PUT failure: silent; next change retries (debounce). GET probe
  failure: local-first, no UI impact.
- Merge never deletes: cloud sections only overwrite when newer; a corrupt
  cloud JSON section is skipped, local kept.

## Testing

- `tools/qa-calculator-page.cjs`: fresh gate families - DC (discount math +
  waterfall + persistence), CP (companions derivation + chip flow + bill
  integration), BD (brand save/load/downscale stub + print sheet classes),
  SG (signature default by doc type + override), WS (probe-mock offline
  behavior, merge rules with fake clocks). State-reset block after each
  wave section (existing harness convention).
- New `tools/qa-calc-workspace.cjs` (T2, wrangler dev): register session ->
  PUT workspace -> GET round-trip -> 403 signed-out -> 413 oversize -> plan
  field present. Registered in `docs/CI-TEST-COVERAGE.md` + ci.yml step.
- Playwright audit: one 390px gate (brand card + companions).
- Every wave: full battery green before commit (AGENTS.md lesson 8 loop).

## Scope guard

Not in this design: real PDF-generation library, separate invoice screen,
per-line discounts, server-side template rendering, payment processing,
multi-company profiles, cloud project storage for the WORKSPACE app (this
is calculator-only R2 blobs keyed by session sub).
