# Calculator Client Documents + Workspace Follow - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan wave-by-wave. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Professional client documents (invoice/quote/estimate PDF via the
print sheet with logo, bill-to, signature area), roll-up discount,
punch-list-aware companion suggestions, a subscription-ready entitlement
seam, and full workspace follow for signed-in users - offline-first intact.

**Architecture:** Everything client-side is pure functions beside
`computeFor()` in `js/calculator-page.js` exposed via `window.__calcEngine`
+ the `data-action` dispatch; state in new localStorage keys
(`mmgr_calc_brand`, `mmgr_calc_doccounter`, `mmgr_calc_wstamps`); cloud is
one new R2-blob route (`/api/calc/workspace`, `src/cloud/calc-workspace.js`)
mirroring the prefs pattern - restore + backup only, every failure silent.

**Tech Stack:** Vanilla JS (global namespace, build.js bundles),
`dist/mmgr.min.css`, Playwright harnesses, wrangler dev T2 harness,
Cloudflare Workers + R2 (no D1 change).

**Spec:** `docs/superpowers/specs/2026-10-01-calc-docs-workspace-follow-design.md`

## Global Constraints (verbatim, apply to every wave)

- OFFLINE-FIRST: zero REQUIRED network calls; cloud follow is silent,
  optional, and signed-out behavior is byte-identical to today.
- No emoji on any served page or JS-rendered string (AGENTS.md gate 7).
- No AI-assistant credit in commits (AGENTS.md gate 8); Conventional Commits
  (`feat(calculator): ...` / `feat(worker): ...`), subject <= 72 chars.
- Plain-language copy: labels say what things do ("Give a discount", not
  "apply percentage adjustment").
- calculator.html has NO inline scripts (CSP hashes unchanged).
- After ANY js/css change: `node build.js`; bump `?v=` in calculator.html
  (v15 -> v16 on first asset-shipping wave, +1 per shipping wave); bump sw
  shell (`mmgr-shell-v340` -> v341) when shared mmgr.min.css changes.
- Every wave: `node tools/qa-calculator-page.cjs` + `node
  tools/qa-calc-playwright-audit.cjs` + `npm run verify` green before commit.
- Fresh gate prefixes in tools/qa-calculator-page.cjs (taken: B,G,N,doc,TUT,
  W1,X1,E1,T1,C1-C7,D1-D7,E1,E2,W1-W3,P0-P5,RS,PL,V,T,S,Q,U,X,R,I,M,BQ,IN,SX,
  PM,RG,CF,FA,LP): use DC (W1), CP (W2), BD/SG (W3), ET (W4), WS (W5).
- Session traps (AGENTS.md lessons + this repo's history): ev() template
  literals COOK escapes (double the backslashes); `element.textContent` on a
  container WIPES child controls (write into spans); a `display:flex` class
  needs an explicit `[hidden]{display:none!important}` guard; restart
  serve.cjs after any inline-script edit (none planned here); wrangler dev
  logs go OUTSIDE the repo (`$HOME/wrangler.log`).
- Ship loop per wave: push -> poll Actions API until completed -> next wave
  (deploy once after W6 or on owner go).

## File Structure

- Modify: `js/calculator-page.js` - all client waves (pure functions, ACTIONS,
  render functions, sync, entitlements, test hooks).
- Modify: `calculator.html` - discount fields, companions row, brand card,
  document fields, quote-head print blocks, `?v=` bumps.
- Modify: `css/mmgr.css` - styles for new card/chips/sig area (+[hidden]
  guards); calculator block ~line 2500+; respect the comment-closer trap.
- Modify: `src/router.js` - one route block for `/api/calc/workspace`.
- Create: `src/cloud/calc-workspace.js` - GET/PUT handlers (R2 blob).
- Modify: `tools/qa-calculator-page.cjs` - DC/CP/BD/SG/ET/WS gate sections.
- Modify: `tools/qa-calc-playwright-audit.cjs` - M13 logo upload gate.
- Create: `tools/qa-calc-workspace.cjs` - T2 harness (wrangler dev).
- Modify: `docs/CI-TEST-COVERAGE.md`, `.github/workflows/ci.yml`,
  `.github/workflows/extended-qa.yml` (registry law: harness + registry row +
  workflow step, three places), `CHANGELOG.md`, `sw.js` (v341).

---

### Task 1 (W1): Discount on the roll-up

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calculator-page.cjs`

**Interfaces:**
- Consumes: `rollup(v)` (existing pure), `renderRollup()`, prefs key
  `mmgr_calc_rollup`, `estimateCsv(r)`, `cashCurve(total, ...)`.
- Produces: pure `applyDiscount(works, prelims, discPct, discAmt) ->
  { works, prelims, discount, base }` - `discount = min(works+prelims,
  discAmt > 0 ? discAmt : (works+prelims)*discPct/100)`; fixed wins when
  both set; never negative; `base = works+prelims-discount`.
  `rollup(v)` grows `{discPct, discAmt}`: contingencies + escalation now
  compute on the DISCOUNTED base (discount before risk money). Fields
  `#calc-disc-pct`, `#calc-disc-amt` in `.bcp-rollup-settings`; prefs gain
  the two keys additively (old saved prefs without them = no discount).
  Hook: `window.__calcEngine.applyDiscount`.

- [x] **Step 1: Failing gates (DC family)** - dc1 pure math: works 100000 +
  prelims 6000, pct 5 -> discount 5300, base 100700; amt 8000 with pct 5 ->
  8000 (fixed wins); amt > works+prelims clamps to 106000->106000 discount
  cap (base 0); negatives clamp to 0. dc2 waterfall: renderRollup with
  disc 5%/10%/5%/12mo -> exact discount/design/constr/esc lines (design =
  100700*0.10 = 10070; constr = 5035; esc = base*0.05 = 5035; subtotal
  120840) and discount line ABSENT when blank. dc3 prefs roundtrip
  (discPct/discAmt persist + rehydrate). dc4 legacy prefs (no disc keys)
  -> no discount, no error. dc5 CSV contains the discount row; cash curve
  totals the discounted subtotal (2dp float-safe compares).
- [x] **Step 2: Gates FAIL** -> **Step 3: Implement** (pure fn + rollup
  change + fields + waterfall line "Discount -X" only when > 0)
  -> **Step 4: build + bump** (`?v=16`) -> **Step 5: Gates green** ->
  **Step 6: Commit** `feat(calculator): discount on the estimate roll-up`

### Task 2 (W2): Companion work suggestions

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calculator-page.cjs`

**Interfaces:**
- Consumes: `readState()` snapshot, `lastResult` (qty/unit), BoQ add-line
  internals (W1 pattern), `WORK` trade keys.
- Produces: pure `COMPANIONS` map: workKey -> array of
  `{ id, name, unit, qty(st) }`. Initial entries:
  - Wall-family (blockwall, brickwall, framing, render, paint, drywall):
    `lineout` "Lining out the walls (profiles and string lines)" per m run
    = wall run (d1, or sum of instance row lengths x n); `brush`
    "Clear brush and strip topsoil" per m2 = face area (d1*d2 or measured
    area); `cart` "Cart away debris" per m2 = same area (light).
  - Pours (slab, footings, concrete-drive, rebar): `cart3` "Cart away
    debris and surplus material" per m3 = the pour quantity; slab also
    `mesh` "Steel mesh reinforcement" per m2 = slab area.
  - fencing: `debrush` "Debrush the line of fence" per m run = run;
    `holes` "Dig and backfill post holes" each = ceil(run/2.5) (2.5 m
    post spacing), capped 200.
  - siteprep: `cart2` "Cart away debris" per m2 = area.
- DOM: `#calc-companions` row under the estimate output; chips rendered by
  `renderCompanions()` from `lastResult` + trade; each chip
  `data-action="calcCompAdd" data-cp="<id>"`; BoQ lines from chips carry
  `derivedFrom: <trade>:<id>` (editable/removable like any line).
  Visibility: hidden when no lastResult, no companions for the trade, or
  every companion already in the bill (derivedFrom match).
  ACTIONS: `calcCompAdd`. Hook: `window.__calcEngine.companionsFor(st)`.

- [x] **Step 1: Failing gates (CP family)** - cp1 map coverage: blockwall,
  fencing, siteprep, slab have entries; skirt/pipe-supply have none.
  cp2 derivations exact: blockwall d1=10 d2=2.4 -> lineout qty 10 m run,
  brush 24 m2, cart 24 m2; fencing run 25 -> holes ceil(25/2.5)=10.
  cp3 chips render after a blockwall calculate (3 chips) and stay hidden
  for skirt. cp4 calcCompAdd creates a bill line with the derived qty +
  name + derivedFrom tag; line is editable + removable (existing flows).
  cp5 after adding all three, the companions row hides.
- [x] **Step 2: Gates FAIL** -> **Step 3: Implement** -> **Step 4: build +
  bump** (`?v=17`) -> **Step 5: Gates green** -> **Step 6: Commit**
  `feat(calculator): companion work suggestions per trade`

### Task 3 (W3): Business details card + professional document sheet

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calculator-page.cjs`, `tools/qa-calc-playwright-audit.cjs`

**Interfaces:**
- Produces: brand storage `mmgr_calc_brand` = `{ logo (dataURL|string|null),
  name, phone, email, addr, trn, sigName, sigTitle, sigShow (''|'on'),
  updatedAt }`; pure helpers `brandLoad()/brandSave(patch)`,
  `logoFitsCap(dataUrl)` (decoded bytes <= 1000000),
  `downscaleLogo(img) -> Promise<dataURL>` (canvas max side 600px; PNG when
  source has transparency else JPEG q0.85, quality step-down 0.85->0.5 then
  dimension halving until `logoFitsCap`), `docNoSuggest(type, n)` ->
  `INV-0001` / `EST-0001` / `QUO-0001` form; doc counter
  `mmgr_calc_doccounter` = `{ Estimate: n, Quote: n, Invoice: n }` bumped
  when an estimate is SAVED whose docNo equals the current suggestion.
  Migration: first brandLoad() adopts `mmgr_calc_biz_name` into `name` and
  clears the old key.
  Document fields (export row): `#calc-client-name`, `#calc-client-addr`,
  `#calc-doc-no`, `#calc-doc-date` (type=date, default today),
  `#calc-doc-due`; ride `st` via readState/applyState (recall restores).
  Print sheet blocks: `#calc-quote-logo` (img), `#calc-quote-contact`,
  `#calc-quote-billto`, `#calc-quote-sig` (two columns: contractor
  sigName+sigTitle, client acceptance), each present only when its data
  exists; `#calc-quote-sig` visible when brand.sigShow === 'on' OR
  (sigShow === '' AND docType === 'Invoice').
  ACTIONS: `calcBrandToggle`, `calcLogoPick` (change), `calcLogoRemove`,
  `calcLogoReset` (clears the note text only), `calcDocNoSuggest`.
  Logo message target: `#calc-logo-note` SPAN (never container textContent).
  Hooks: `window.__calcEngine.brandLoad/logoFitsCap/docNoSuggest`.

- [x] **Step 1: Failing gates (BD + SG families)** - bd1 brandSave/Load
  roundtrip + updatedAt stamp; bd2 migration: pre-seed
  `mmgr_calc_biz_name=Fairclough Build` -> brandLoad().name === that and
  old key gone; bd3 logoFitsCap: string of 1,000,000 base64 chars ->
  false, 100,000 -> true (boundary math (len*3/4)); bd4 docNoSuggest
  formats + counter bump on save-with-suggestion + manual override
  respected; bd5 print sheet: with brand filled + client filled, the
  on-screen hidden quote-head nodes exist and render() fills name/contact/
  billto (checked pre-print via DOM); bd6 logo pick with a non-image file
  shows the message in #calc-logo-note and changes nothing (file stubbed).
  sg1 signature visibility: Invoice default visible, Estimate hidden;
  sg2 brand.sigShow='on' forces visible on Estimate; sg3 fields render
  date defaults (today) and due date blank.
- [x] **Step 2: Gates FAIL** -> **Step 3: Implement** (card markup, print
  blocks, CSS letterhead + sig rules with `[hidden]` guards)
- [x] **Step 4: Playwright M13** - real file upload: generate a small PNG,
  `setInputFiles('#calc-logo-file')`, expect `#calc-logo-preview` visible
  and stored dataURL length/1.33 <= 1MB; card usable at 390px.
- [x] **Step 5: build + bump** (`?v=18`, sw shell v341 - shared css
  changed) -> **Step 6: Gates green** -> **Step 7: Commit**
  `feat(calculator): business brand card and document sheet`

### Task 4 (W4): Entitlement seam

**Files:** `js/calculator-page.js`, `tools/qa-calculator-page.cjs`

**Interfaces:**
- Produces: `const CALC_FEATURES = { cloudFollow: true, logoSync: true }`;
  `const Entitlements = { setPlan(p), plan(), can(feature) }` - `can` is
  false for unknown features, true for known features on plan 'free' (and
  any plan, until paid tiers exist); plan source is the workspace probe
  response only. Feature code NEVER reads the plan directly.
  Hook: `window.__calcEntitlements = Entitlements`.

- [x] **Step 1: Failing gates (ET family)** - et1 can('cloudFollow') &&
  can('logoSync') true by default, can('nope') false; et2
  setPlan('pro') keeps known features allowed (forward window) and plan()
  reports 'pro'; et3 setPlan('') resets to 'free'.
- [x] **Step 2: FAIL** -> **Step 3: Implement** -> **Step 4: Gates green**
  (no assets ship: no bump) -> **Step 5: Commit**
  `feat(calculator): entitlement seam for future paid tiers`

### Task 5 (W5): Cloud workspace follow

**Files:** `src/router.js`, `src/cloud/calc-workspace.js` (new),
`js/calculator-page.js`, `tools/qa-calculator-page.cjs`,
`tools/qa-calc-workspace.cjs` (new), `docs/CI-TEST-COVERAGE.md`,
`.github/workflows/ci.yml`

**Interfaces:**
- Worker: `handleCalcWorkspaceGet/Put(request, env)` in
  `src/cloud/calc-workspace.js` (imports `json, cloudForbidden, readSession`
  from `../lib/http.js`); R2 key `calc-ws/' + sub + '.json'`; GET ->
  `{ ok:true, plan:'free', ws:<object|null> }`; PUT: content-length cap
  4_000_000 (413), body must be a JSON object (400), stores
  `{ sections..., savedAt }` -> `{ ok:true, savedAt }`. Router block after
  the prefs block: `path === '/api/calc/workspace'` with the standard
  `rl(request,'general',env)` rate-limit wrapper, GET/PUT only.
- Client: `wsCollect()` -> `{ estimates, boq, history, packs, rollup,
  brand, docCounter }` (reusing existing loaders; each section stamped
  `updatedAt` from `mmgr_calc_wstamps`, 0 when absent); pure
  `wsMerge(localStamp, cloudStamp, localVal, cloudVal)` -> newer wins,
  empty-local adopts cloud, corrupt cloud section skipped;
  `wsProbe()` - only when `navigator.onLine`, after first render
  (setTimeout 1500), GET `'/api/calc/workspace'` credentials same-origin;
  200 -> `Entitlements.setPlan(data.plan)` + merge + render;
  `scheduleWsPut()` debounced 2000ms trailing, called from the existing
  persist paths (estimates, boq, history, packs, brand, rollup, docCounter);
  PUT 413 -> retry once with brand.logo dropped from the payload; every
  failure silent. Signed-out (403) = never calls again this session.
  Hooks: `window.__calcEngine.wsCollect/wsMerge`.

- [x] **Step 1: Failing gates (WS family, page harness, no network)** -
  ws1 wsCollect returns all seven sections with stamps; ws2 wsMerge: cloud
  newer wins, local newer kept, empty local adopts, equal stamps keep
  local, corrupt (non-object) cloud skipped; ws3 Entitlements.plan set
  from a stubbed probe payload via wsApplyProbe(data) pure application;
  ws4 scheduleWsPut coalesces (stub fetch counting calls, 3 changes ->
  1 PUT after debounce).
- [x] **Step 2: FAIL** -> **Step 3: Implement** client + worker
- [x] **Step 4: T2 harness** `tools/qa-calc-workspace.cjs` (wrangler dev
  :8787, `$HOME` log + persist, recipe from qa-engine-parity: register ->
  cookie jar) - g1 signed-out GET 403; g2 register then PUT sample
  workspace -> ok+savedAt; g3 GET round-trips the sections; g4 PUT
  oversize (>4MB) -> 413; g5 PUT non-JSON -> 400; g6 response.plan ===
  'free'. Register in CI-TEST-COVERAGE (CI status) + ci.yml T2 group step
  with the standard env passthrough.
- [x] **Step 5: build + bump** (`?v=19`) -> **Step 6: Full battery green**
  -> **Step 7: Commit** `feat(calculator): workspace follows the account`

### Task 6 (W6): Integration pass

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calculator-page.cjs`, `tools/qa-calc-playwright-audit.cjs`,
`CHANGELOG.md`, `sw.js`, `docs/CI-TEST-COVERAGE.md`

- [x] **Step 1: Guide + tour** - GUIDE_STEPS +2 (business card + invoice
  sheet; discount + companions folded into the roll-up step copy);
  TOUR_STEPS 11 -> 13 with anchors `#calc-brand-card`,
  `#calc-companions`; TUT gates re-baselined (loop bound + counter text
  "1 of 13"); spotlight geometry checked at 1280 + 390.
- [x] **Step 2: Mobile gates** - M14: brand card open + companions visible
  at 390 -> no horizontal scroll; doc/brand inputs 16px (iOS zoom).
- [x] **Step 3: Docs** - CHANGELOG entry; fine print sentence: signed-in
  users' workspace follows the account, everything still works offline;
  "Clearing your browser data" note updated to mention sign-in restore.
- [x] **Step 4: Full battery + build + bump + sw v341** (if css changed
  and not already bumped) -> **Step 5: Commit**
  `feat(calculator): client documents integration pass`

### Task 7: Ship loop

- [ ] `node build.js` && `npm run verify` after every wave.
- [ ] `node tools/qa-calculator-page.cjs` (122 + new) && `node
  tools/qa-calc-playwright-audit.cjs` (37 + new) && T2 harness green.
- [ ] Push -> poll Actions API until completed -> fix harness-vs-app drift
  first if red -> `node tools/deploy.cjs` after W6 -> production smoke
  (tmp/live-tour-smoke.cjs + workspace route probe: signed-out GET 403).

## Self-review

- Spec coverage: verdict-table gaps map to W1 (discount), W2 (companions),
  W3 (logo/bill-to/sig/doc-no), W4 (subscription window), W5 (everything
  follows + 1MB logo cap), W6 (guide/tour/mobile/docs); plain-by-default
  print behavior gated in bd5/sg1.
- Placeholders: none - every gate has its exact assertion and every module
  its signature, key names, and route.
- Type consistency: `applyDiscount(works,prelims,discPct,discAmt)`,
  `companionsFor(st)`, `brandLoad/brandSave/logoFitsCap/docNoSuggest`,
  `Entitlements.can`, `wsCollect/wsMerge/wsProbe/scheduleWsPut`,
  `handleCalcWorkspaceGet/Put` used consistently across gates, hooks, and
  the worker module.

## Execution record (2026-10-01)

All six waves executed run-all (owner directive), each wave: gates green -> verify -> commit -> push -> Actions API polled to completed.

- W1 discount `9d3475f` (127 gates, DC1-5), W2 companions `0f2de07` (132, CP1-5 + the shipped formwork-pricing fix, FA3 re-baselined), W2.5 families `2c40bad` (137, FM1-5) - CI green through `2c40bad` including the Nightly Full Suite.
- W3 brand card + document sheet `365986e` (145 gates: BD1-5, SG1-3; audit 38 with M13 real logo upload). Debug findings: renderQuoteDoc ran after render()'s error early-return (BD5/SG1/SG2); BD2's reload re-triggered the persisted-state wipe (the W1/W2.5 lesson, reset block added); .bcp-doc-row overflowed 390px (M11/M12); .btn[hidden] guard (verify:hidden); shell v342 backfill for W1-W3 CSS.
- W4 entitlement seam `352f851` + shell v343 `b8f92c4` (148 gates: ET1-3; verify:sw requires the bump - calculator-page.js is a SHELL asset).
- W5 workspace follow `f4b1415` (page 152 gates: WS1-4; new T2 tools/qa-calc-workspace.cjs 6/6; registry row + ci.yml step, port 8811; page ?v=20, shell v344; TDZ lesson: WS_KEYS must build lazily - module-eval const over later keys killed the whole page once).
- W6 integration `b67823d` (guide + tour 13 steps, M14 mobile gates, T5 tour final-card centering - dock rule vs translate(-50%,-50%) shoved the card half off-screen since v339; fine print plain-language rewrite; spotlight geometry 26/26 at 1280+390; audit 40; shell v345).
- Ship: `node tools/deploy.cjs` -> version `2f5d78a1`. Production smoke all-pass (signed-out visit zero page errors with the silent 403 probe, wsApplyProbe, brand card + companion chips, full 13-step tour at 1280 + 390); live /api/calc/workspace 403 signed-out GET+PUT; calculator 200 on v=20 assets; sw v345 live.

## Execution record: research round 2 (2026-10-01)

Owner directives after W6: rate freedom (done in the rate-sheets follow-up
`56df7b3`), research more trades ("I don't think we are covering everything
the same way"), ability to turn tax off entirely, and the openings deduction
("user should be able to add a window or a door and that will be taken out of
the final measurements as they wouldn't lay block in the window space...
ensure this is spread across relative trades").

- Trade research: 9 new work items from 2026 rate sources (Doornmore doors,
  Pella windows, Angi drop ceiling + septic, Homewyse gutters + fascia, Fuse
  water heaters, Highland cabinets) + floor screed; drywall re-priced per
  board (1.22 x 2.44 m, 10% cuts). Picker now 33 items; FM5 re-baselined;
  coverage walk added (tools/qa-calc-trade-coverage.cjs, 68 gates across all
  33 trades through the real UI, registered CI + wired into ci.yml T4).
- Tax off: typing 0 in the override prices at zero (engine already treated
  override >= 0 as active); breakdown label reads "Tax (no tax - your rate)";
  CSV carries "Tax rate %","0" (TX1).
- Openings (W2.7): OPENING_TYPES window/door/other; openingsArea() pure
  (imperial ft->m on both edges, bad rows skipped, floored); computeFor
  subtracts the void area BEFORE waste for the 6 wall-area trades
  (block/brick/framing/render/paint/drywall); breakdown gains the "Minus N
  openings (X m2) not built" sum-sub note; CSV gains "Openings deducted";
  editor rows ride readState/applyState so recall + workspace sync keep them.
  Gates OP1-OP7 (deduction math, before-waste ordering, spread across all 6
  trades, imperial conversion, CSV, zero-floor, editor lifecycle).
- REAL BUG the gates caught: both editors (instances + openings) rebuilt
  their rows' innerHTML on every keystroke, replacing the focused input and
  eating the rest of the entry - the openings rows never received their
  second field and live typing lost focus. Fix: keystrokes refresh the sum
  line only; full re-render stays on add / delete / trade change.
- Page ?v=22, shell v347. qa-calculator-page 164/164, trade coverage 68/68,
  playwright audit 40/40, npm run verify green, emoji scan clean.

## Ship record: research round 2 (2026-10-01)

- Commits: `4b4ef11` (openings + researched trades + tax off), `198765e`
  (harness boot hardening), `d67d4f3` (chrome-launcher absolute path).
- CI took two repair iterations on the NEW coverage harness: both runs died
  0s into the T4 step (logs not retrievable without admin). Evidence came
  from the jobs API step timings (0s = boot throw, not gate failures).
  Root cause: chrome-launcher.cjs returned the BARE `google-chrome` name on
  Linux - spawn() resolves it through PATH (why every CDP battery always
  worked) but Playwright's executablePath demands a real file path and
  threw instantly. qa-health-sweep + qa-calc-playwright-audit had their own
  absolutizeChrome() defense (qa-health-sweep's comment names the contract
  explicitly) - the launcher now returns the absolute path `which` printed
  for all ~45 consumers.
- CI green on `d67d4f3`; deployed with `node tools/deploy.cjs` -> version
  `1615bf78-684c-46ea-a6b1-383ca7c9f780`. Production smoke: full 33-trade
  coverage walk 68/68 against live, /calculator serves ?v=22 assets +
  openings editor markup, served calculator-page.js carries openingsArea,
  sw v347 live.
