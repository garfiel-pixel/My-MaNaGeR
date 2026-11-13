# My MaNaGeR - REFINEMENT DIRECTIVE (WAVES D, E, F) - 2026-10-24

**Audience:** the terminal AI that builds My MaNaGeR. **Author:** a read-only review session.
**This file changes no code.** It is a work order. Copy it to the repo root as
`REFINEMENT-DIRECTIVE-2026-10-24.md` (`*.md` is never deployed). It sits BESIDE
`AUDIT-DIRECTIVE-2026-10-18.md` and `IMPROVEMENT-DIRECTIVE-2026-10-22.md`; it replaces neither.
Read order: `CONTINUATION-DIRECTIVE.md`, then this file. Waves are named **D, E, F** so they do not
collide with the earlier sprints (1 to 3) and waves (A to C).

Reviewed against the uploaded working tree (HEAD `efbbcc5`). The owner says the live code may differ
slightly from it. That is why section 0 starts with a STATE CHECK and a QUESTIONS GATE.

---

## 0. HOW TO RUN THIS FILE

1. **STATE CHECK FIRST (no exceptions).** Before each task, search `git log` and the code for the
   symbol or string the task names. If the work already exists, mark the task ANSWERED with the
   commit hash and move on. Never rebuild finished work. Every task ends DONE, ANSWERED (with
   evidence) or DEFERRED (with a reason that cites this file).
2. **QUESTIONS GATE (owner request).** At the very start, ask the owner ONE batch of questions
   (section 2), numbered, each as multiple choice with an "Other" option and a stated default.
   Then continue. A question blocks ONLY the tasks that name it; everything else proceeds on the
   stated defaults. When an answer arrives it overrides the default and is logged. Do not ask
   anything else mid-wave unless a task says "decision not answered" or a gate fails in a way this
   file does not explain.
3. Run **Wave D, then E, then F** (section 12). Inside a wave work the tasks in listed order. Every
   task ends with a **GATE**: a command or test with a yes/no answer. Paste gate output into the log.
4. A passed gate is not a pause point. Go straight to the next task.
5. Commit, deploy and live-probe at the end of each wave by the exact procedure in
   `AUDIT-DIRECTIVE-2026-10-18.md` section 9.0. Rollback first uses a kill switch (section 13).
6. Evidence tags: **CONFIRMED-STATIC** (read in code), **CONFIRMED-ARTIFACT** (from the owner's
   screenshots or files), **[VERIFY]** (strong suspicion; reproduce first, recipe given),
   **[OWNER]** (the owner decides), **[COUNSEL]** (a lawyer should confirm the wording).
7. Nothing in this file is legal advice.

### 0.1 Locked rules (all still in force)

No emoji. No em dash or en dash in served copy. Plain language. Consistency by reference (find the
sibling element already in the app and copy its pattern). Glass for the functional layer only;
content stays solid. Respect `prefers-reduced-motion` and `prefers-reduced-transparency`.
Plain Conventional Commits, no AI attribution. A field-guide card for every new feature in the SAME
change. Never re-pin Calculate or Add to bill. Offline-first is sacred. Paddle and other secrets
are assumed set. Bump `sw.js` and run `verify:csp` when served files change. No new storage key
without a line in `docs/STORAGE-INVENTORY.md` (the consent gate fails otherwise).
`CONTINUATION-DIRECTIVE.md` stays at or under 40,960 bytes. Every new `data-action` modal must pass
the click test in task APP-4.

### 0.2 Owner colour rule for the gold work (verbatim intent)

Only elements that are ALREADY the brand "gold" colour change to the new gold. A colour that is
already a different colour (the green status UI in the admin panel, danger red, info blue) is NOT
changed to gold. A neutral, clear or plain surface does not get a gold tint unless there is an
alignment or contrast problem. On plain light pages the gold must not look like a "sore thumb":
keep the tint minimal and let the button carry the gold.

---

## 1. FINDINGS REGISTER (what this review found)

| ID | Area | Finding | Severity | Evidence |
|---|---|---|---|---|
| MAT-1 | Calculator | Materials are ONE lumped rate with a text note (drywall: "Boards, studs, tape, screws" priced as one number). No itemised consumables, no editable accessory prices. 52 trades, only concrete has accessories. | High | CONFIRMED-STATIC |
| MAT-2 | Calculator | Companion suggestions cover only WORK items (line out, cart away, debrush), never materials. | Medium | CONFIRMED-STATIC |
| UI-1 | Calculator | Work-item list: sub-items can render white-on-white in dark mode. `optgroup` has no style rule; the native popup is not testable. | High | CONFIRMED-ARTIFACT + STATIC |
| UI-2 | Calculator | Statutory costs, labour-only and other settings are bare checkboxes in a sentence, not setting rows. | Medium | CONFIRMED-STATIC |
| UI-3 | Calculator | The "Pick a work item, enter the dimensions..." fine print sits loose under the title bar. A "How to use" card already exists. | Low | CONFIRMED-STATIC |
| UI-4 | Calculator | Top bar `.bcp-top` is one flat full-width strip on `--tile-bg`; it does not mirror the app bar. | Medium | CONFIRMED-STATIC |
| GOLD-1 | Brand | The token named `--gold` is `#d96b27`, a burnt ORANGE. In dark mode `--gold` is `#ffffff` (white). There is no gold anywhere. 331 uses of `var(--gold)`. Marketing has its own `--gold` copy. The gold button class is `.btn-o` (app) and `.btn-gold` (marketing); `.btn-g` is green and stays green. | High | CONFIRMED-STATIC |
| PERF-1 | Performance Mode | `mmgr-perf.js` is loaded only by `app.html` and `admin.html`. `calculator.html` loads the starry shader (`mmgr-glass.js`) but not the Perf module, so it never stands down there. Only 6 `[data-perf]` CSS rules exist against about 90 `backdrop-filter` rules. Marketing globe and the sign-in page ignore Performance Mode. | High | CONFIRMED-STATIC |
| APP-1 | App shell | The closed-sidebar icon strip is `position: fixed; left: 8px` and overlays page content (no gutter reserved). | Medium | CONFIRMED-STATIC |
| APP-2 | App shell | Admin "Dashboard" link has `target="_blank"` and "open project" uses `window.open(..., '_blank')`: every trip from admin spawns a tab. | Medium | CONFIRMED-STATIC |
| APP-3 | Accounts | Three different "codes" share the words "admin code"; the panel copy does not say which is which. Backup to the account already exists and is not plan-gated. | Medium | CONFIRMED-STATIC |
| APP-4 | Dialogs | **Export Schedule radios and checkboxes cannot be changed.** The global click handler resolves the dialog's backdrop (`data-action="closeGanttExportBg"`) and calls `preventDefault()`, which cancels the native toggle. Five more dialogs share the pattern. | **High** | CONFIRMED-STATIC |
| GANTT-1 | Gantt | Dialog is a tall single column. No "organise automatically" action; phases are not collapsed by default in exports; links to phase gates not offered. | Medium | CONFIRMED-ARTIFACT |
| RISK-1 | Notices | "At Risk, 1d over target" is shown with no reason and no advice, and no watcher raises it as a notice. | Medium | CONFIRMED-STATIC |
| EXP-1 | Notices | COI and licence expiry fields and an Expiry card exist, but NO watcher feeds them into the notice mailbox, so nothing warns before they lapse. | Medium | CONFIRMED-STATIC |
| AI-1 | AI window | The AI window is a fixed 420 px right panel that overlays the page; layout is dated next to current chat tools. | Medium | CONFIRMED-STATIC |
| AI-2 | AI window | No in-browser larger model. The module header records why it was refused earlier (size, CSP, offline-first). | Info | CONFIRMED-STATIC |
| LAND-1 | Landing | Dot rail (`.dot-rail-navigation`, 7 big dots plus generated small dots) is always visible. | Low | CONFIRMED-STATIC |
| LAND-2 | Landing | The globe is not broken. It deliberately stops spinning while a card is showing (`state.t >= CARD_OUT`), and never starts under reduced-motion or data-saver. | Low | CONFIRMED-STATIC |
| RB-1 | Rate book | **The 811 rates ship in a public static file** (`js/jic-rates-full.js`, 104 KB) that is precached by the service worker for every visitor, so the sign-in gate is a screen, not a lock. A PDF of the book sits at the repo root (`tru_jic_rate_book_2025-2027_imperial_metric.pdf`) and nothing in `.assetsignore` or `PRIVATE_ROOT_EXT` blocks `.pdf`. | **High** | CONFIRMED-STATIC; **[VERIFY]** with `curl -I` |
| RB-2 | Rate book | "JIC" appears 238 times in `calculator-page.js`, 29 in `calculator.html`, 4 in `calc-ai.js`, plus pricing, field guide and file names. | Info | CONFIRMED-STATIC |
| MAT-3 | Calculator | A line priced earlier keeps its old price when rates change, with no stamp and no prompt to update. | Medium | owner report + STATIC |

---

## 2. THE QUESTIONS GATE (ask once, as one numbered batch; defaults in bold)

1. **Gold scope.** Which buttons go gold? (a) **every button currently filled with the brand colour**,
   (b) only primary calls to action, (c) let me pick from the audit list.
2. **Dark mode.** The accent in dark is white today. (a) **gold buttons in dark, everything else stays
   as is**, (b) full gold accent in dark, (c) keep dark exactly as it is.
3. **Light surfaces.** (a) **same gold with a darker bronze border (`#855811`) for contrast**,
   (b) gold only on dark surfaces and keep orange on light, (c) the same gold everywhere.
4. **Landing dot rail.** (a) **ghost dots that brighten on hover, with a small label on hover**,
   (b) ghost dots with no label (the current "no labels" rule), (c) leave as is.
5. **Rate book source status** (see section 3): (a) **unresolved** (default, today), (b) permission
   obtained from the publisher, (c) rates rebuilt from the owner's own costs.
6. **The "admin code".** My reading is that there are three codes: the SITE admin code (set when the
   site was deployed), the user's ADMIN PANEL code (local per device, backed up to the signed-in
   account), and PROJECT or CLIENT codes. Is that right? (a) **yes**, (b) no, tell me which.
7. **Accessory prices.** (a) **the AI proposes planning placeholders flagged "starting value, edit it"**,
   (b) the owner supplies a price list first, (c) all accessory prices start blank.
8. **Statutory rates.** The code default for employer on-costs is 12.5 percent. Please confirm the
   four components and current rates (NIS, NHT, Education Tax, HEART/NSTA Trust) before they are
   typed into the UI. (a) **use the 12.5 percent total split 3.0, 3.0, 3.5, 3.0 and mark "confirm"**,
   (b) owner types the four numbers now.
9. **Tab policy.** (a) **core app pages (dashboard, admin, project, calculator) always open in the same
   tab; only external sites, checkout and the field guide open a new tab**, (b) leave as is.
10. **In-browser model.** (a) **run a two-day spike and pick a runtime by measured results**,
    (b) skip it for now. Size budget: **under 400 MB, opt-in download**.
11. **"Limited ... combat purchase"** (from the owner's note). I could not tell what was meant. Please
    say it in one sentence (for example "limit the free plan so people buy"). Until answered, no
    task depends on it.

---

## 3. THE RATE BOOK: REBRAND, AND ONE THING THAT MUST BE FIXED FIRST

### 3.1 What the owner asked

Rename the rate book **My MaNaGeR Rate Book**, put the My MaNaGeR logo (SVG) in every heading
inside it, change the paid-tier line on the pricing page, and stop referring to the "red book".
Position the figures as the product's own planning rates, with a disclaimer and a clear way to
override any rate.

### 3.2 What can be done now (do all of it)

- **The name and the brand mark.** Everywhere the user can read it: "My MaNaGeR Rate Book". Use the
  existing brand sprite symbol (`css/mmgr-icons.svg#i-mpw`, source `css/mpw-mark.svg`) at 18 px in the
  dialog header and in every trade and group heading, the same way the calculator page header uses
  it. Do NOT draw a new logo.
- **The pricing page.** `pricing.html` lines 121 and 122 become "Full Build Cost Calculator with the
  My MaNaGeR Rate Book" and "My MaNaGeR Rate Book: 811 planning rates (sign in to open it)". The
  count must come from the data (`rates.length`), not be typed.
- **Override stays.** Every rate remains editable, and the dialog says so in one line.
- **The notice.** One function `rateBookNotice(status)` produces the disclaimer text from the status
  chosen in question 5. Default text (status **unresolved**, used until the owner answers):
  "Starting rates for planning. Prices vary by site, supplier and date. Replace any rate with your
  own." Use the same sentence under every estimate total and on every export footer (the
  `ESTIMATE_NOTICE` constant from the earlier directive).

### 3.3 What must NOT be done by this file, and why

- **Do not write "independent proprietary estimates of My MaNaGeR" (or any claim that the figures are
  the product's own, independently produced rates) unless status is (c).** Right now the 811 rates are
  generated from `RATE-BOOK-2025-2027-FULL.md` by `tools/gen-ratebook.cjs`. A new name and a new
  logo do not change where the numbers came from. A disclaimer to the customer protects against bad
  estimates; it does not answer whether copying the numbers is allowed. Claiming independence that
  does not exist would add a false statement on top of the permission question.
- **Do not scrub the source from the data or the repository history.** Keep a private provenance
  record (`RATEBOOK_PROVENANCE` in `js/jic-rates-full.js`'s generator, not shown to users) naming the
  source, the year and the status. Removing it later is the owner's decision with advice.
- **Source line on screen:** while status is (a) or (b), keep ONE small line at the foot of the rate
  book dialog: "Source data: JIC Rate Book 2025-2027" (with the permission wording the publisher
  specifies, if (b)). Remove that line ONLY when status is (c) and the rates have been rebuilt.
- **What "own" means (status c):** each rate is rebuilt from the owner's inputs: labour constants times
  local wage, material quotes from suppliers, plus overhead and profit, with the build-up kept in a
  private file. A percentage markup on a copied number does not make it independent.

### 3.4 Fix first: the rate data is publicly downloadable (RB-1)

The sign-in gate on the rate book is only a screen. Do these in Wave D, before the rename ships:
1. **[VERIFY]** run `curl -sI https://mymanagerworkspace.com/js/jic-rates-full.js` and
   `curl -sI https://mymanagerworkspace.com/tru_jic_rate_book_2025-2027_imperial_metric.pdf`. Log the
   status codes.
2. **PDF:** `git rm tru_jic_rate_book_2025-2027_imperial_metric.pdf` from the deployable tree (move it
   to `docs/private/`, which is already ignored), add `*.pdf` to `.assetsignore`, and add `pdf` to
   `PRIVATE_ROOT_EXT` in `worker.js`. Add a test that requests the old path and expects 404.
3. **Rate data:** stop serving the rates as a static file. Build `GET /api/ratebook` that requires a
   signed-in session and returns the JSON, with `Cache-Control: private`. The calculator loads it
   when the dialog opens, stores it in the Cache API (`mmgr-ratebook-v1`) so it works offline after
   the first signed-in load, and clears it on sign-out. Remove `js/jic-rates-full.js` from the
   service-worker shell list in `sw.js` and from the public files. Add `mmgr-ratebook-v1` to
   `docs/STORAGE-INVENTORY.md` as "necessary: the rate book you opened, cached for offline use".
   Keep the generator, but have it emit a Worker module (`src/data/ratebook.js`) instead of a browser file.
4. **Plan check:** who may open it follows the pricing page ("sign in to open it", on the plans that
   list it). Do not invent a new gate; read the current plan table and mirror it.
5. **Free-plan note:** the Free plan lists "Open API / MCP / webhooks" and the calculator; confirm none
   of those expose the rates unauthenticated (search `src/` for `jic` and `rate`).

**GATE (T-RB):** an unauthenticated request for the rate data returns 401; a signed-in request returns
811 rates; the old PDF path returns 404; the service-worker shell list contains no rate file; the
offline calculator still opens the rate book after one signed-in load.

---

## 4. CALCULATOR: MATERIALS, PICKER, SETTINGS, BAR (files: `calculator.html`, `js/calculator-page.js`, `js/calc-ai.js`, `css/mmgr.css`)

### MAT-1. Itemised materials (the drywall question)

**What is there (CONFIRMED-STATIC):** `WORK.drywall` is `rate: { mat: 12, lab: 17 }` with
`matDesc: 'Boards, studs, tape, screws'` (`calculator-page.js` line 292). The materials the owner named
(joint compound "mud" by the bucket, tape, beads, screws, studs and track) are inside ONE number the user
cannot see or edit part by part. The same is true for 50 of the 52 trades. Only concrete has a visible
accessory (formwork and rebar laps, W7 at line 5859), and that is the pattern to copy.

**What to build:** a per-trade accessory list the user can switch on, with every line editable.

```js
// Shape. One table, keyed by WORK key. Every quantity is DERIVED from dimensions the user already typed.
const ACCESSORIES = {
  drywall: {
    primaryShare: 0.68, // share of the lump material rate that is the boards themselves
    items: [
      // rule.per: 'area' (m2 of the priced work), 'perimeter' (m), 'piece' (per board), 'fixed'
      { id: 'studs',    name: 'Metal studs and track', unit: 'm',      rule: { per: 'area',  qty: 1.3  }, waste: 5,  modelUSD: 1.9,  src: 'planning: 0.6 m spacing' },
      { id: 'compound', name: 'Joint compound (mud), litres', unit: 'L', rule: { per: 'area',  qty: 0.4  }, waste: 10, modelUSD: 2.2,  src: 'planning: 3 coats' },
      { id: 'tape',     name: 'Joint tape',            unit: 'm',      rule: { per: 'area',  qty: 0.37 }, waste: 10, modelUSD: 0.06, src: 'planning' },
      { id: 'screws',   name: 'Drywall screws',        unit: 'each',   rule: { per: 'area',  qty: 14   }, waste: 5,  modelUSD: 0.02, src: 'planning' },
      { id: 'bead',     name: 'Corner bead',           unit: 'm',      rule: { per: 'fixed', qty: 0    }, waste: 5,  modelUSD: 1.0,  src: 'user enters corner length' }
    ]
  }
  // ... one entry per trade. See Appendix A for the full coverage list.
};
```
The numbers above are **illustrative starting values, not facts**: the AI must replace each with a figure
it can source (supplier data sheets, a published takeoff guide) and write the source in `src`. Under
question 7 default (a) they ship flagged "starting value, edit it". They must pass the reconciliation gate
below, and `modelUSD` obeys rule N3 (never charge USD as local money; with no exchange rate the price
field starts blank and the line is not priced).

**Two modes, one switch.** The material section gets a setting row (UI-2 pattern): **Itemise materials**.
- Off (default, today's behaviour): the lump material rate is used exactly as now. Nothing changes for
  saved estimates.
- On: the lump rate is replaced by `rate.mat * primaryShare` (the boards or primary material), and each
  accessory line is added: `qty = rule x area x (1 + waste/100)`, `line = qty x price`. Quantity and price
  are both editable per line; each line has its own switch; **Add my own item** adds a free line.
  `Labour only` hides the whole drawer (accessories are materials).
- State: `st.matMode` is `'lump'` or `'items'`; `st.acc[id] = { on, qty, price }`. Missing means `'lump'`.
  Persist in the same place as other form state; add to `readState` and `applyState`.
- Output: `computeFor` returns `r.accessories = [{ id, name, unit, qty, price, total }]`. The result card,
  the printed estimate, the XLSX "Bill of quantities" sheet, the flat CSV and the PDF all list them as
  sub-rows under the trade line. They are part of ESTIMATED TOTAL (rule N2: printed rows sum to the total).

**GATE (T-ACC):** for every trade that has an `items` list: (1) with all accessories on and default
prices, the itemised material cost per unit is within **plus or minus 15 percent** of the lump
`rate.mat` (the table proves the split did not invent or lose money); (2) with the switch off the result
equals the pre-change golden value; (3) turning an accessory off lowers the total by exactly its line;
(4) JMD with no exchange rate shows blank accessory prices and refuses to price (N3); (5) the exports
reconcile to the cent. **GATE (T-LUMP):** a script reads every `WORK` entry; a trade whose `matDesc`
lists more than one component must have an `ACCESSORIES` entry OR an explicit
`accessoriesNone: '<reason>'`; the build fails on a bare lump.

### MAT-2. Related items the user would otherwise forget

`COMPANIONS` (line 1141) suggests only WORK add-ons (line out, cart away, debrush). Extend the same
one-tap mechanism with **related trades and materials**, still never priced silently:

| When the user prices | Offer (one tap, quantity derived from the same dims) |
|---|---|
| drywall | primer and paint for the same area, insulation, ceiling grid if a ceiling is in scope |
| tile | screed or levelling for the same area, waterproofing membrane for wet rooms, skirting |
| paint | surface prep (filler, sanding), masking and drop sheets as one allowance |
| blockwall, brickwall | lintels over openings, damp-proof course, reinforcing steel |
| slab, footings | vapour barrier, curing, expansion joints (formwork already exists) |
| roof, shingle-roof | gutters and downpipes, fascia and soffit, ridge and flashing |
| framing | hurricane straps and anchor bolts, sheathing, insulation |

**GATE:** each offered item exists in `WORK`, derives a quantity or is withheld (null), and the "forgotten
work" linter (X1) lists the same pairs.

### MAT-3. Prices that changed after a line was added

**Owner report:** a line priced earlier keeps its old numbers when rates change, and nothing says so.
Never change a priced line silently (that would rewrite a quote someone may have sent).
- Stamp each bill line with `pricedAt` (ISO date) and `rateSig` (a short hash of the rates, FX rate and
  accessory prices used).
- On open and after any rate edit, compare the line's `rateSig` with the current signature. If different
  show a small badge on that line: **Prices changed since 12 Oct** with a **Re-price this line** button
  (user action only) and a **Keep as quoted** option that hides the badge for that signature.
- Bill and export show the `pricedAt` date, so an old quote is recognisable as old.

**GATE:** change a rate; the line total is unchanged and the badge appears; Re-price updates exactly that
line; Keep as quoted hides the badge until the rate changes again.

### UI-1. The trade list is unreadable in dark mode (CONFIRMED-ARTIFACT)

**Symptom (owner):** "All trades" drops down fine; the next list (the Work item select, whose entries
sit inside `<optgroup>` headings) shows white boxes with white text in dark mode.

**Facts:** `css/mmgr.css` line 5974 styles `select option` only. No rule styles `optgroup`. The earlier
fix (line 15771) set `color-scheme: dark` on `html.dark-mode, body.dark-mode`. The native popup is drawn
by the browser, cannot be screenshot by Playwright, and varies by Chrome, Edge, Firefox and Windows,
so the earlier fix cannot be proven by a test. **[VERIFY]** the exact cause with a real browser; do not
spend time on it, because the robust fix removes the native popup for this control.

**Fix, in two layers:**

1. **Immediate CSS (ships first, small):**
```css
body.dark-mode select,
body.dark-mode select option,
body.dark-mode select optgroup {
  background-color: var(--card);
  color: var(--text);
  color-scheme: dark;
}
body.dark-mode select optgroup { color: var(--text-muted); font-weight: 700; font-style: normal; }
body.dark-mode select option:checked { background-color: rgba(212, 175, 55, 0.25); color: var(--text); }
```
   Repeat the selectors for every `html[data-theme]` palette that sets its own dark tokens (see line
   15241, `rose-gold`), or move them to `:is(body.dark-mode, [data-theme] body.dark-mode)`.
2. **A real listbox (the lasting fix):** replace the two native selects in the calculator (Type of work,
   Work item) with ONE reusable accessible combobox, `js/mmgr-combobox.js`, styled with the app tokens, so
   it can be tested and looks the same everywhere.
   - ARIA: `role="combobox"` on the input, `role="listbox"` on the list, `role="group"` with an
     `aria-label` for each trade family, `role="option"` per trade, `aria-activedescendant` for the
     highlighted row, `aria-expanded`.
   - Behaviour: type to filter across groups, arrow keys, Home/End, Enter selects, Escape closes, group
     headings are not selectable, a visible check on the chosen row, "No match" row when empty.
   - Surface: solid `var(--card)` (rule: content is solid), 1 px border, max height 60 vh, scroll inside,
     sticky group headings, a gold left bar on the active row. On phones it opens as a bottom sheet.
   - Keep the original `<select>` in the DOM (visually hidden) as the source of truth so every existing
     handler (`calc-work`, recalls, saved estimates, the family filter) keeps working unchanged. The
     combobox writes the select's value and dispatches `change`.

**GATE (T-DARK):** Playwright in light, dark and each `data-theme` palette: open the combobox, assert every
option's computed text colour against its computed background has contrast of at least 4.5:1 (read
`getComputedStyle`, compute with the WCAG formula), and the group headings the same. Take a screenshot of
each family list. Also assert the hidden `<select>` value updates and `change` fires.

### UI-2. Setting rows with a switch and a drawer (CONFIRMED-STATIC: still bare checkboxes)

`calculator.html` lines 290, 362, 368, 494 and 594 are still plain `<label><input type="checkbox"> text</label>`.
This repeats the earlier C7 finding; check whether C7 shipped elsewhere and mark ANSWERED if so.

**The pattern (copy the app's own switch, `.tgl` / `.tsl`, from `project.html` line 1603):**
```html
<div class="set-row" id="row-oncost">
  <div class="set-txt">
    <label for="calc-oncost-toggle" class="set-name">Employer statutory costs on labour</label>
    <span class="set-hint" id="row-oncost-hint">NIS, NHT, Education Tax, HEART/NSTA Trust</span>
  </div>
  <label class="tgl"><input type="checkbox" id="calc-oncost-toggle" role="switch"
         aria-describedby="row-oncost-hint" aria-controls="row-oncost-more"><span class="tsl"></span></label>
  <div class="set-more" id="row-oncost-more"><div class="set-more-in"> ...fields... </div></div>
</div>
```
```css
.set-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 12px;
  padding: 12px 0; border-top: 1px solid var(--border); min-height: 44px; }
.set-row:first-child { border-top: 0; }
.set-name { font-weight: 600; }
.set-hint { display: block; color: var(--text-muted); font-size: .8rem; }
.set-more { grid-column: 1 / -1; display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s ease; }
.set-row.is-on .set-more { grid-template-rows: 1fr; }
.set-more-in { overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .set-more { transition: none; } }
```
Behaviour: switch off = drawer closed and its values ignored in the maths (values are remembered, not
deleted). Switch on = drawer opens with the fields. The whole row is clickable. IDs and `data-action`
attributes of existing inputs do not change, so no handler moves. Closed drawers use `inert` so hidden
fields cannot be tabbed into.

**Rows to convert:** statutory costs (drawer: four rates), tax (drawer: country tax, custom percent),
labour only, "I know the total", itemise materials (MAT-1), signature lines, "my size is not in the rate
sheet". **Statutory drawer:**
```js
// Parts sum into the existing #calc-oncost-pct, so no engine change. Rates are [OWNER] confirm items.
const ONCOST_PARTS = [
  { id: 'nis',   name: 'NIS',                 pct: 3.0 },
  { id: 'nht',   name: 'NHT',                 pct: 3.0 },
  { id: 'edtax', name: 'Education Tax',       pct: 3.5 },
  { id: 'heart', name: 'HEART/NSTA Trust',    pct: 3.0 }
]; // total 12.5, the current default. Show "Total 12.5%" live under the four boxes.
```
Each part editable; the total is read-only and feeds `#calc-oncost-pct`. A "Reset to defaults" link.

**GATE (T-ROWS):** no bare `<input type="checkbox">` remains in the calculator outside a `.tgl` inside a
`.set-row` (static scan); clicking the row text toggles the switch; the drawer opens and closes; toggling
off leaves the total equal to the same estimate without the drawer values; axe clean in both palettes.

### UI-3. Fine print into the How-to-use card

`calculator.html` line 78 holds `<p class="bcp-lede">Pick a work item, enter the dimensions, choose your
currency and country...</p>` as loose small text under the title bar, and the planning-grade note sits
elsewhere. A "How to use" card already exists (`#calc-guide-card`, an 11-step slider).

**Do:** add two tabs inside that card: **Steps** (today's slider) and **Notes**. Move into Notes, as
short readable paragraphs: the lede sentence, the planning-grade range note, the "worked out on this
device" note, and the currency and unit notes. Delete the `.bcp-lede` paragraph. Keep ONE short line under
the title ("Price a job in minutes. Everything is worked out on this device.") so the page still reads.
The Hide and Reopen behaviour stays; the card opens on Steps. Notes text uses 0.9 rem and 1.5 line
height (it was fine print, now it is reading).

**GATE:** the lede paragraph is gone; the Notes tab holds each moved sentence verbatim; keyboard users
can switch tabs with the arrow keys; `role="tablist"` pattern passes axe.

### UI-4. Top bar that matches the app

`.bcp-top` (line 9354) is a flat strip on `var(--tile-bg)` with a border. **Rule 1.4 (consistency by
reference):** open the app page's top bar (`body.db-page .top` in `app.html` and `css/mmgr.css`) and
copy its height, radius, background token, shadow and gap exactly. Then: keep the three clusters
(Back, brand and title, Rate book and theme), add a 1 px divider between title and actions, cap the
width to the page's content column so it no longer reads as a long band, and use the same glass rule
the app bar uses (functional layer only). The Rate book button shows the brand mark and the text "My
MaNaGeR Rate Book" at wide widths and the icon only below 640 px. Under Performance Mode the bar loses
blur and shadow (PERF-1).

**GATE:** a screenshot of the app bar and the calculator bar side by side shows the same height, radius
and background in light and dark; computed styles of the two bars match on those four properties.

### AI-3. The assistant must reach every field, and ask

The PROPOSAL `settings` object accepts `country, taxOverride, overhead, onCostPct, designC, constrC`
(`calc-ai.js` line 149). Extend it, validated page-side with the same range checks the inputs use:
```json
{"settings": {"gct": 15, "onCost": {"nis": 3, "nht": 3, "edtax": 3.5, "heart": 3},
              "labourOnly": false, "itemiseMaterials": true,
              "accessories": {"drywall.compound": {"on": true, "price": 3200}},
              "overhead": 10, "designC": 10, "constrC": 5}, "note": "..."}
```
Add an `ASK` line the page renders as buttons, never as free text the user has to answer:
```
ASK: {"q":"Add GCT 15 percent to this estimate?","options":["Yes","No","Custom"],"field":"gct"}
```
The system prompt rule: when a proposal is about to be sent and tax, statutory costs or itemised
materials were not mentioned, ask AT MOST ONE `ASK` (the most important unanswered), then propose.
The model never computes money; the page does (rule N1 from the first audit). Unknown fields are
refused and listed in the chip ("not supported: ...").

**GATE:** mocked-relay tests: an `ASK` renders three buttons and the chosen value lands in the right
field; a proposal setting every field populates every field; an unknown field is refused with a plain
message; the model text never contains a computed total.

---

## 5. GOLD BULLION (GOLD-1)

### 5.1 What is wrong (CONFIRMED-STATIC)

`css/mmgr.css` line 51: `--gold: #d96b27` (burnt orange, comment "alias: gold = brand"). Line 184, dark
mode: `--gold: #ffffff`. `css/marketing.css` line 12 repeats `--gold: #d96b27`. 331 uses of `var(--gold)` in the
app stylesheet and 81 in the marketing stylesheet. The gold-filled button classes are `.btn-o` (app: `background: var(--gold)`, 26 uses in `project.html`,
3 in `admin.html`) and `.btn-gold` (marketing: `index.html` lines 50, 92, 124, 390, plus about, contact and
features). **`.btn-g` is GREEN** (`background: var(--green)`, `css/mmgr.css` line 2622; 58 uses in
`project.html`, 24 in `admin.html`, 4 in `calculator.html`, 3 in `app.html`), and `.bcp-run` is only layout
(width, margin) sitting on top of `.btn-g`. Under the owner's colour rule (section 0.2) **green buttons stay
green**. Twenty-seven other rules set `background: var(--gold)` on non-button elements (tabs, chips, bars);
those are listed in the audit, not restyled as buttons.

### 5.2 The tokens (use these exact values, add no others)

```css
:root {
  --bullion-light: #e6c547;
  --bullion:       #d4af37;
  --bullion-dark:  #aa771c;
  --bullion-deep:  #855811;
  --bullion-edge:  #f3e5ab;
  --bullion-ink:   #1a1a1a;                 /* text on a gold surface */
  --gold-grad:       linear-gradient(135deg, #d4af37 0%, #aa771c 50%, #855811 100%);
  --gold-grad-hover: linear-gradient(135deg, #e6c547 0%, #bd8522 50%, #966416 100%);
  --gold-text-on-light: #7a5a0b;            /* gold used as WORDS on white: 6.37:1 */
}
```
Both stylesheets get the same block (marketing and app must not drift; add a test that compares them).

### 5.3 The shared button definition (one place, not copy-pasted)

```css
.btn-bullion, .btn-o, .btn-gold /* + every other class the audit finds that fills with var(--gold) or var(--brand) */ {
  background: var(--gold-grad);
  color: var(--bullion-ink);
  border: 1px solid var(--bullion-edge);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.4), 0 4px 6px rgba(0,0,0,.2);
  font-weight: 600;
  text-shadow: 0 1px 0 rgba(255,255,255,.35);
}
.btn-bullion:hover, .btn-o:hover, .btn-gold:hover {
  background: var(--gold-grad-hover);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 6px 10px rgba(0,0,0,.3);
}
.btn-bullion:active, .btn-o:active, .btn-gold:active { transform: scale(.98); }
.btn-bullion:focus-visible, .btn-o:focus-visible, .btn-gold:focus-visible {
  outline: 2px solid var(--bullion-deep); outline-offset: 2px;
}
.btn-bullion:disabled, .btn-o:disabled, .btn-gold:disabled {
  background: #c9b26a; color: #4a4a4a; border-color: #d8c98e; box-shadow: none; text-shadow: none; cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) { .btn-bullion:active, .btn-o:active, .btn-gold:active { transform: none; } }
```
`.btn-g` (green) is NOT in this list and is not touched. Sizes, padding, radius and behaviour stay exactly as they are. Small buttons use a smaller shadow
(`0 2px 3px`), large buttons the stated one (question 7 of the owner's own prompt, default yes).

### 5.4 A contrast fact the AI must respect (computed in this review)

The exact gradient gives the dark label these contrast ratios against the gradient's stops: `#d4af37`
8.28:1, `#aa771c` **4.45:1**, `#855811` **2.82:1**. The middle is just under the 4.5 AA line for normal
text and the deep end is below it. So the label must not sit on the deep end: keep labels centred
(they sit near the middle stop), use weight 600 and the light text-shadow above, and on buttons narrower
than 96 px use `linear-gradient(135deg, #d4af37 0%, #aa771c 100%)` instead of the three-stop version. If
a computed check still falls under 4.5:1 for normal text, record it and ask the owner; do not invent new
colours. Gold as WORDS or icons on a light surface uses `--gold-text-on-light` (6.37:1 on white), never
`#d4af37` (2.10:1 on white). On dark surfaces `#d4af37` text is fine (8.67:1 on `#151518`).

### 5.5 Colour rules (the owner's own, enforced)

- Only elements that already use `--gold`, `--brand`, `--brand-hover`, `--brand-subtle`, `--gold-ink`
  or an orange hex become gold or bronze. Green, red, blue, amber status colours do not change.
- **Do not tint neutral surfaces gold.** The `--brand-subtle` and `rgba(var(--gold-rgb), ...)` washes on
  plain light pages stay at today's opacity or lower. Where a gold wash looks like a "sore thumb" on a
  plain page, lower it; do not raise it. Dark pages may keep their present gold glow.
- The `--gold: #ffffff` dark-mode accent: follow question 2. With the default, only BUTTONS get the
  gold gradient in dark mode; borders, rings and text keep today's dark-mode tokens.
- Listing, not changing: leftover orange in badges, links and icons goes into `docs/GOLD-AUDIT.md`
  for the owner to decide later (owner's own request).

### 5.6 Steps

1. **Audit (read-only):** write `docs/GOLD-AUDIT.md`: every filled gold or orange button, with file,
   line, current colour, the surface it sits on, and whether it uses a shared class. Note the number of
   places that use a hex instead of a token.
2. Apply 5.2 and 5.3. Convert hard-coded orange hexes on buttons to the tokens (never copy the gradient).
3. Re-point text uses of the old gold to `--gold-text-on-light` on light surfaces.
4. Marketing: `.btn-gold` in `css/marketing.css` lines 670 to 700 uses the same shared rule.
5. Rebuild, run `verify:csp`, bump `sw.js`.

**GATE (T-GOLD):** a script lists any remaining `#d96b27`, `#c25a1b`, `#a84a15`, `#f97316` or `217, 107, 39`
in `css/` and fails on any hit outside `docs/GOLD-AUDIT.md`; a Playwright run computes the label contrast on
every `.btn-o` and `.btn-gold` in both modes and fails below 4.5:1 for 14 px text (3:1 for 18 px bold),
and reports the list; the same run asserts `.btn-g` still computes to the green token (it must not change);
the two stylesheets carry identical `--bullion*` values.

---

## 6. PERFORMANCE MODE MUST REACH EVERYTHING (PERF-1)

### 6.1 What is wrong (CONFIRMED-STATIC)

- Only `app.html` and `admin.html` load `js/mmgr-perf.js`. `project.html` has the toggle but not the
  script (it is inside the bundle there; verify). `calculator.html` loads `mmgr-glass.js` (the shader)
  and `mmgr-viewport.js` but NOT `mmgr-perf.js`, so `ns.Perf` is undefined and the shader's guard
  (`mmgr-viewport.js` line 96) never fires. No Performance Mode switch exists on the calculator.
- `index.html`, `features.html` and `signin.html` load `three` and the landing globe and never consult it.
- CSS: only six `[data-perf='on']` rules (lines 15334 to 15347) against roughly ninety `backdrop-filter`
  rules and many large shadows.

### 6.2 The contract (self-enforcing)

**One rule:** if `localStorage.mmgr_perf_mode === 'on'`, then on EVERY page: no WebGL or canvas animation
runs, no `backdrop-filter`, no large blurred shadow, no infinite CSS animation, no 3D tilt, no parallax,
and `requestAnimationFrame` loops owned by decoration are stopped. Content, layout and colours stay.

1. **Boot early, everywhere.** Add a tiny `js/mmgr-perf-boot.js` (under 1 KB, no dependencies) that only
   sets `document.documentElement.dataset.perf` from storage, loaded with `data-sync="1"` right after
   `mmgr-theme.js` on EVERY html page (marketing, sign-in, dashboard, app, project, admin, calculator,
   reset). The full module still loads where it is used. Both write the same key; no new storage.
2. **One CSS kill block.** Replace the six ad-hoc rules with one block at the end of `css/mmgr.css` and
   `css/marketing.css`:
```css
[data-perf='on'] *, [data-perf='on'] *::before, [data-perf='on'] *::after {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
}
[data-perf='on'] [class*='glass'], [data-perf='on'] .card, [data-perf='on'] .top, [data-perf='on'] .dock,
[data-perf='on'] .drw-sheet, [data-perf='on'] .db-sheet { box-shadow: 0 1px 2px rgba(0,0,0,.18) !important; }
[data-perf='on'] canvas.bg-stars, [data-perf='on'] #marketing-globe canvas { display: none !important; }
```
   Where a surface used blur for legibility, replace it with a solid `var(--card)` in that block (text
   must stay readable; check contrast).
3. **JS guards.** `mmgr-glass.js`, `mmgr-dock.js` (tilt), `marketing-globe.js`, `signin` three scene, and
   any `requestAnimationFrame` decoration call `isPerf()` before starting and subscribe to a
   `mmgr:perf` event to stop at once when toggled on and to restart when toggled off. The event is
   dispatched by `Perf.set()`.
4. **The control.** Add the Performance Mode switch (same `.tgl` as the app, wired to `tglPerfMode`) to the
   calculator's top bar menu and to the marketing footer ("Lighter pages"), so it is reachable from any
   page. It writes the same key.
5. **Landing globe:** in Performance Mode show the static first frame (a still `<canvas>` frame or an
   inline SVG) so the hero is not empty.

**GATE (T-PERF-WIRE):** Playwright, once per page in the page list, with `mmgr_perf_mode=on` set before
load: assert `document.documentElement.dataset.perf === 'on'`; assert no element has computed
`backdrop-filter` other than `none`; assert no running `requestAnimationFrame` decorative loop (count
frames over 2 seconds on the canvas elements: zero); assert the WebGL context is not created; then toggle
off and assert it returns. A static check fails the build if any html page that includes `mmgr-glass.js`,
`three` or `marketing-globe.js` lacks `mmgr-perf-boot.js`.

---

## 7. APP SHELL AND ACCOUNTS (files: `js/mmgr-app.js`, `admin.html`, `app.html`, `project.html`, `css/mmgr.css`)

### APP-4. Dialog options that cannot be changed (CONFIRMED-STATIC, fix first)

**Symptom (owner screenshot):** in Export Schedule, only the pre-selected radio and checkboxes work.
**Root cause:** `js/mmgr-app.js` line 5322 is the global click dispatcher:
```js
const el = e.target.closest('[data-action]');   // for a radio inside the dialog this is the BACKDROP div
...
if (el.tagName === 'INPUT' && el.type === 'checkbox') { handler(el, e); return; }  // only exempts el itself
e.preventDefault();                               // <- cancels the radio/checkbox the user just clicked
handler(el, e);
```
The dialog root is `<div id="gantt-export-modal" data-action="closeGanttExportBg">`. The radio has no
`data-action`, so `closest` lands on the backdrop, `el` is a DIV, and `preventDefault()` runs. Chrome
reverts the control. The same pattern exists on five more dialogs in `project.html`: `ai-mailbox`
(line 1328), `chartup-modal` (1788), `wbsimport-modal` (1876), `importdates-modal` (1895),
`bidpkg-modal` (1932). Any of them that contain inputs have the same defect.

**Fix (one change, in the dispatcher):**
```js
const el = e.target.closest('[data-action]');
if (!el) { return; }
// A click on a native control (or its label) that sits INSIDE a data-action container keeps its default.
const ctl = e.target.closest('input, select, textarea, label, summary, button, a[href]');
if (ctl && ctl !== el && el.contains(ctl)) {
  const h0 = ACTION_MAP[el.getAttribute('data-action')];
  if (h0) { h0(el, e); }          // backdrop handlers already test e.target === el, so this is safe
  return;                          // no preventDefault: the radio changes, the checkbox toggles
}
```
Also audit the second dispatcher at line 792 and any other `document.addEventListener('click'` that
calls `preventDefault`.

**GATE (T-MODAL):** a Playwright test enumerates every element whose id ends `-modal` or has a
`data-action` ending `Bg`; for each one that contains `input`, opens it through its real trigger,
clicks EACH radio (asserts exactly the clicked one is `checked`) and EACH checkbox (asserts it flips),
then clicks the backdrop (asserts it closes). Export Schedule must also read back the chosen values
(`ganttExportRun` receives `svg`, `a3`, `dark`, `all` when those are chosen).

### APP-1. The collapsed sidebar sits on top of the page (CONFIRMED-STATIC)

`app.html` lines 138 to 176: `.sidebar-icons` is `position: fixed; top: 50%; left: 8px; z-index: 100`
and is shown when `body.side-closed`. Nothing reserves space for it, so it overlays the first column
of content. (`project.html` uses `#app-sidebar` with `body.sidebar-on`; check the closed state there too.)

**Fix:** reserve the gutter instead of floating over the page.
```css
:root { --rail-closed-w: 64px; }              /* 38px icon + 8px left + 18px breathing room */
@media (min-width: 1024px) {
  body.db-page.side-closed .wrap { margin-left: var(--rail-closed-w); }
}
@media (max-width: 1023px) {                   /* no room at the side: move the strip to the bottom edge */
  body.db-page.side-closed .sidebar-icons { top: auto; bottom: calc(10px + env(safe-area-inset-bottom));
    left: 50%; transform: translateX(-50%); flex-direction: row; }
  body.db-page.side-closed .wrap { padding-bottom: 72px; }
}
```
Use the same `margin-left` transition the open state already has (line 135) so open and closed feel
alike. Apply to BOTH colour modes (the current selectors are `:not(.dark-mode)`; add the dark twin).
Under Performance Mode the strip loses its blur.

**GATE:** at 1280, 1024, 768 and 390 px wide, light and dark, closed state: the bounding box of the icon
strip does not intersect the first content card or any form field (Playwright
`boundingBox()` intersection test) on the dashboard and on a project page.

### APP-2. Seven tabs open for one session (CONFIRMED-STATIC)

- `admin.html` line 394: `<a href="app.html" target="_blank">Dashboard</a>`. This is why "go back to
  dashboard" opens another tab.
- `admin.html` line 1917: `adminOpenProject` uses `window.open(url, '_blank')`. It also puts the project
  code in the address (`&code=`), which stays in history.
- `project.html` line 1646 has one more `target="_blank"` (check if external).
- Checkout opens a new tab by design (`marketing.js`, `mmgr-cloud.js`, `mmgr-cloud-dash.js`); that stays.

**Rules (owner question 9, default yes):** core app pages (dashboard `app.html`, `admin.html`,
`project.html`, `calculator.html`) always navigate in the SAME tab. New tab only for: external sites
(always `rel="noopener noreferrer"`), checkout, the field guide, and files. A real link
(`<a href>`) is used so middle-click and Ctrl-click still open a tab on purpose.

**Fix:** Dashboard link: remove `target`. `adminOpenProject`: render the project row as an `<a
href="project.html?id=...">` (same tab) and keep an explicit small "Open in new tab" action. After
`project.html` reads the `code` parameter, call `history.replaceState` to remove it from the address bar.
Add `MMGR.Nav.go(url, { external })` as the one helper and use it in new code. If a new tab is truly
needed more than once, reuse one by NAME (`window.open(url, 'mmgr-checkout')`) so repeats do not stack up.

**GATE (T-NEWTAB):** a static scan fails on `target="_blank"` or `window.open(` in `app.html`, `admin.html`,
`project.html`, `dashboard.html`, `calculator.html` and `js/` unless the target is an `http(s)` URL to
another origin, checkout, or on an explicit allow-list file `tools/newtab-allow.json`. A Playwright
walk (dashboard to admin to dashboard to project to calculator and back) ends with ONE page open.

### APP-3. Which "code" is this? (CONFIRMED-STATIC: the backup already exists)

**What exists:** `src/auth/admin-code.js` backs the admin code up to the signed-in account (sealed,
verified accounts only, not plan-gated). `admin.html` has "Restore access" and "Get my admin code from
my account" (lines 265 to 280). The owner's wish (free for everyone, not premium-only) is already how it
behaves. Keep it free. **The problem is words.** Three different things are called a code:

| Name to use on screen | What it opens | Where it lives |
|---|---|---|
| **Site admin code** | The deployment-owner area (cloud admin, `admin.html` line 421) | Set when the site was deployed; stays in the tab |
| **Admin panel code** | Your own projects admin panel (local per device) | Backed up to your account when signed in |
| **Project code** and **Client code** | One project, with a role | Per project |

**Do:** rename labels and help text to those three names everywhere (the admin page, the sign-in card, the
field guide). Add one "Which code is this?" popover with that table next to every code field. In the admin
header show a small status: **Backed up to your account** or **Not backed up: sign in to back it up**.
After "Restore access" on a new device, list BOTH groups of projects: **On this device** and **In your
cloud** (the account's cloud-linked projects), so the owner sees at once what the code brought back.
**Say plainly:** restoring the code restores access to the panel; projects that exist only on another
device's browser are not copied unless they were linked to the cloud.

**[VERIFY]** that after restore the cloud list is fetched (`GET /api/cloud/projects`) and shown. If not, add it.

**Security improvement (optional, Wave F):** the escrowed value is an UNSALTED SHA-256 of the code and the
browser gate compares that hash. A short code is guessable from a leaked hash. Add a per-account salt and
PBKDF2 for the local gate (derive with the same salt on every device by returning the salt to verified
accounts), and ask the user to re-confirm (password or Google) before the server releases the stored value.
Version the format so old hashes still verify and upgrade on next entry.

**GATE:** a free-plan signed-in test account backs up, signs out, restores on a clean browser profile and
sees both project groups; every code field carries the popover; no screen uses the bare words "admin code"
without one of the three names.

---

## 8. GANTT, EXPORT, AND THE RISK AND EXPIRY NOTICES

### GANTT-1. Wide dialog, tidy chart, same output everywhere

**Verify first:** the earlier G-tasks (phase roll-up, ordering, milestones, canvas guard) appear shipped
(the dialog has format, page size, theme, links and columns). Do not redo them; mark ANSWERED.

**1. Dialog layout (owner: "too vertical, make it go across"):** `css/mmgr.css` lines 16976 to 17010.
```css
#gantt-export-modal .gx-box { max-width: min(980px, 94vw); max-height: 90vh; overflow: auto; }
#gantt-export-modal .gx-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
#gantt-export-modal .gx-set:nth-child(5) { grid-column: 2 / -1; }          /* Columns spans two cells */
#gantt-export-modal .gx-set:nth-child(5) .gx-cols { display: grid; grid-template-columns: repeat(2, 1fr); }
@media (max-width: 760px) { #gantt-export-modal .gx-grid { grid-template-columns: 1fr; } }
```
Wrap the column checkboxes in `.gx-cols`. Sticky footer for Cancel and Export so the buttons never leave
the screen. **GATE:** at 1280 x 720 and 1366 x 768 the whole dialog is visible with no scrolling; at 390 px
it stacks and still shows Export.

**2. Organise automatically (owner request).** Add a **Tidy** control (Gantt toolbar and the export
dialog) that changes only the VIEW, never the data:
- **Collapse** phases that are finished or start after the visible window; keep active phases open.
- **Links policy** gets two more values: `critical` (critical chain only) and `gates` (links between phase
  summaries and phase-gate milestones, plus the critical chain). Default for exports: `gates`.
- **Transitive reduction** of displayed links: if A leads to B and A also leads to C which leads to B,
  do not draw A to B. Parallel tasks with no real constraint between them draw no arrow at all.
```js
function reduceLinks(links) {                      // links: [{ from, to }] over task ids
  const next = new Map();
  links.forEach(l => { (next.get(l.from) || next.set(l.from, []).get(l.from)).push(l.to); });
  const reach = (a, b, skipDirect) => {           // is b reachable from a without the direct edge?
    const seen = new Set(); const stack = (next.get(a) || []).filter(x => !(skipDirect && x === b));
    while (stack.length) { const n = stack.pop(); if (n === b) return true; if (seen.has(n)) continue;
      seen.add(n); (next.get(n) || []).forEach(x => stack.push(x)); }
    return false; };
  return links.filter(l => !reach(l.from, l.to, true));
}
```
- **Group by:** Phase (default) | Trade | Assignee. Swimlanes keep each band's links short.
- **Sort within a group** by start date, then WBS.
- **Time window:** Whole project | Next 90 days | Custom, with the scale chosen automatically (day, week,
  month) so labels never overlap.
- Phase gates and milestones draw as distinct diamonds with a label to the right.

**3. One source for screen and export.** Build `buildGanttView(state, options)` as a pure function that
returns `{ rows, spans, links, scale }`. The live chart and the PNG, SVG and PDF exports all draw from it,
so what the owner sees is what is exported. **GATE (T-GANTT):** for the bank-renovation fixture, the
exported row count, phase spans, link count and milestone count equal `buildGanttView`'s; with `gates`
the drawn link count is under 25 percent of `all`; no link crosses more than 10 rows except critical ones;
the three formats list the same tasks.

### RISK-1. "At risk, 1d over target" must say why and what to do

Today `mmgr-render.js` lines 1095 to 1125 compute `overrunDays` for the dashboard badge only. No watcher
raises a notice (the list in `mmgr-watch.js`: lead time, budget, resource, weather, schedule, parallel).

**Build `watchFinishTarget(s, today)`** (pure, reads state only, zero network; same discipline as the other
watchers). First extract the finish calculation into one shared helper so the badge and the watcher
cannot disagree:
```js
// js/mmgr-schedule.js
ns.Schedule.projectedFinish = function (s) {
  const f = s.charter || s.project || {};
  const dated = (s.tasks || []).filter(t => t.endDate || t.end);
  if (!dated.length) { return null; }
  const target = new Date(f.targetCompletion || f.end);
  const projected = new Date(Math.max.apply(null, dated.map(t => +new Date(t.endDate || t.end))));
  return { target, projected, overrunDays: Math.round((projected - target) / 86400000) };
};
```
**Reasons (all traced to real fields, never invented):** compute, for the tasks on the critical path,
(a) tasks already past their end date and not complete (days late), (b) tasks whose start waits on a lead
time or expected delivery, (c) weather-sensitive critical tasks, (d) over-allocated resources on critical
tasks, (e) the longest critical tasks. Name the top three contributors with their numbers.

**Suggestions (rule based, each states the number it rests on, at most three, ranked by days saved):**
| Rule | Suggestion shown | Basis |
|---|---|---|
| Absorb | "Use the management reserve (3 days) to cover the 1 day slip." | a task named reserve or contingency with duration at or above the overrun (the bank project has one) |
| Overlap | "Start B when A is about 70 percent done." | critical finish-to-start pair, zero lag, A duration 3 days or more |
| Add resource | "Add a second crew to A." | critical task, assigned resources below capacity; savings = duration x 0.5 |
| Re-sequence | "B has 6 days of float: move it after A to free the crew." | non-critical task sharing a resource with a critical one |
| Reschedule | "Agree a 1 day extension with the client." | overrun at or below 3 days and a milestone date exists |
| Cost | "Each day costs about J$X in the claim rate." | only when the claim module has a daily rate |

Never promise an outcome; label each line "Suggestion". Severity: `caution` up to 14 days over,
`attention` above. The notice appears in the notification mailbox (and its count in the top bar), and
the dashboard badge gets a **What can I do?** link that opens that notice. Add an **Ask the assistant**
button that opens the AI window with a prefilled prompt carrying the traced facts (the AI explains and
elaborates; the numbers stay from the watcher).

**GATE (T-RISK):** a fixture one day over target (the bank project) raises exactly one notice naming the
contributor tasks and offering the reserve suggestion; at target it raises none; deleting the notice does
not suppress a persistent condition (existing rule: it resurfaces by design); the badge and the notice
show the same overrun number.

### EXP-1. Expiry notices (COI, licence, and the rest) reach the notice box

**Facts:** `mmgr-stakeholders.js` stores `coiExpiry`, `licenseExpiry` (and an EMR value);
`ns.Compliance.getExpiryRollup(60)` rolls up COI, licences, EMR, warranties and permits for a dashboard
card (`mmgr-render.js` line 1017). **No watcher uses it**, so nothing warns before a certificate lapses.

**Build `watchExpiries(s, today)`:**
- Use `ns.Compliance.getExpiryRollup(120)`; one notice per item per band: **60, 30, 14, 7 days** and
  **overdue**, each band raised once (store the last band in the notice so it does not repeat daily).
- Severity: overdue or 7 days or fewer `attention`; 8 to 30 `caution`; 31 to 60 `info`.
- Text from fields: "Acme Electrical: insurance certificate (COI) expires 14 Nov, 21 days left." Advice
  line: "Ask <contact> for the renewed certificate before <date>."
- **Draft reminder** button builds a short plain email from the stakeholder's own fields (no network;
  opens `mailto:` or copies the text): subject "Renewed insurance certificate needed", body naming the
  document and date. Never invent a contact; if none, ask the user to add one.
- **Block the risk:** when a task is assigned to a stakeholder whose COI or licence is expired or expires
  before the task ends, add a `caution` line on that task and in the notice: "Assigned to X, whose COI
  expires 14 Nov, before this task ends on 2 Dec."

**One registry so new expiring things need one line:**
```js
const EXPIRY_SOURCES = [
  { kind: 'COI',      from: s => (s.stakeholders || []).map(x => ({ label: x.name + ' insurance (COI)', date: x.coiExpiry,     owner: x.name })) },
  { kind: 'License',  from: s => (s.stakeholders || []).map(x => ({ label: x.name + ' licence',         date: x.licenseExpiry, owner: x.name })) },
  { kind: 'Permit',   from: s => (s.permits   || []).map(p => ({ label: p.name, date: p.expires || p.expiry })) },
  { kind: 'Warranty', from: s => (s.warranties|| []).map(w => ({ label: w.item || w.name, date: w.expires })) }
  // add: bonds, inspections, equipment calibration, first-aid certificates, insurance policies
];
```
Mirror the real field names from the code (these are examples); the rollup card and the watcher read the
same registry.

**GATE (T-EXP):** fixtures with a COI at 59, 29, 13, 6, 0 and minus 3 days raise one notice per band at the
right severity; re-running the watcher the same day adds none; clearing the date removes the condition;
the dashboard card and the notices list the same items.

---

## 9. THE AI WINDOW AND AN IN-BROWSER MODEL (files: `js/mmgr-ai.js`, `js/calc-ai.js`, `project.html`, `css/mmgr.css`)

### AI-1. A modern layout that does not get in the way

**What exists (CONFIRMED-STATIC):** `#ai-win` (`css/mmgr.css` line 8469) is a fixed 420 px panel docked to
the right at `z-index: 2000`, sliding in over the page. It already has a float mode (draggable, centred)
and a width handle (`.ai-rz-w`). Keep those; restructure the inside and fix the covering.

**The pattern (the owner's JSON is a style reference only; do NOT copy its colours, labels or product
names):** a left history column, a header, a centred thread, and one composer bar. Map it to the existing
parts: presets stay as chips above the composer; the "context dump" becomes a collapsible "What the
assistant can see" row; the tier choice (Local, Relay, Your key) becomes a small badge in the composer.

```
+-------------------------------------------------------------+
| History | Title (rename)        Tier badge   Max  Float  X    |  header (functional layer, may be glass)
| New chat| ----------------------------------------------    |
| Search  |        thread, centred, max 48rem                  |  thread (solid surface)
| Pinned  |        proposal chips, ASK buttons, file chips     |
| Recent  | ----------------------------------------------    |
|         | [+ attach] [mic]  Message...            [Send]     |  composer (solid surface)
+-------------------------------------------------------------+
```
**Docking modes (this is the answer to "what if it gets in the way"):**
| Width | Default mode | Behaviour |
|---|---|---|
| 1280 px and wider | **Docked, pushes content** | `body.ai-docked #app-main, .bcp-main { margin-right: var(--ai-w) }`. The page reflows; nothing is covered. Width 360 to 640 px (the existing handle). |
| 1024 to 1279 | Overlay | Slides over; a dimmed edge; Esc closes. |
| Under 1024 | Full-screen sheet | Respects `env(safe-area-inset-*)`. |
Plus **Maximise** (workspace mode: history and thread fill the window, the page is hidden behind it) and
**Float** (existing). A **Pin** icon keeps the dock open across pages. `Ctrl+.` opens and closes it
(register in the shortcut list, `mmgr-shortcuts.js`). The window never covers the sticky estimate panel
(UI of C6 in the first audit); when docked the panel moves left with the content.

**History:** keep conversations in the unified project state (so export and delete include them) as
`{ id, title, pinned, updated, messages[] }`, capped (for example 30 chats, 200 messages each), with a
**Delete chat** and **Clear all** action. Titles are the first user line, shortened, editable. Do not add a
new storage key; if a device-level list is wanted, list it in `docs/STORAGE-INVENTORY.md` first.

**Rules:** solid `var(--card)` surfaces for thread and composer (content layer), glass only on the header;
no glass on glass; Performance Mode removes the blur. Keep every existing id and handler (`#ai-win`,
`.ai-rz-w`, `toggleFloat`, the mailbox) so nothing else moves. `role="complementary"` with a label;
focus trap only in overlay and maximised modes; reduced motion removes the slide.

**GATE (T-AIWIN):** at 1440, 1100 and 390 px: open the window, assert in docked mode the page's main
column width shrinks by exactly the dock width and no element of the page is under the window; Esc closes
the overlay; `Ctrl+.` toggles; the composer sends via Enter and keeps Shift+Enter for a new line; history
creates, renames, pins and deletes a chat; axe clean in both palettes.

### AI-2. A bigger in-browser model (spike first)

**Owner idea:** download a model of 100 MB or more once, run it in the browser, so the assistant can hold a
real conversation without a key and without limits.

**Facts that shape it:**
- The module header (`mmgr-ai.js` lines 14 to 21) records why this was refused before: model size, CSP and
  offline-first. The seam to drop it into is `runLocal()` and is already provider-shaped.
- **A working precedent exists in this repo:** `mmgr-voice.js` fetches the offline speech model once from a
  CORS-enabled mirror and caches it with the Cache API (`mmgr-whisper-model-v1`). Copy that pattern.
- CSP already allows `'wasm-unsafe-eval'`. The model host and the runtime host must be added to
  `connect-src` for the pages that need them only (see SEC-1 in the improvements directive).

**Honest expectation to write on the settings card (do not oversell):** a 100 to 400 MB model is good at
plain language: explaining what the project data says, rewriting a note, drafting a message, filling a form
from a sentence. It is weak at long reasoning, careful arithmetic and strict formats. **Therefore the
engine still does all money, quantity and date maths, and the model is never trusted for them (first
audit, rule N1).** Anything the local model cannot do reliably offers "Use the cloud assistant for this".

**Spike (two days, measured, question 10):** build a throwaway page `tools/spike-localllm.html` (not
shipped) that loads each candidate and records: download size, time to first token, tokens per second,
peak memory, behaviour on a mid-range laptop and on a phone. Candidates: a WebGPU runtime (MLC WebLLM) and a
WASM runtime (transformers.js or llama.cpp-wasm) with a small instruct model of about 0.3 to 0.5 billion
parameters, 4-bit. Acceptance to ship: opens in under 20 seconds after the first download on a mid laptop,
at least 8 tokens per second, memory under 1 GB, no main-thread freeze (runs in a worker), and a fallback to
the current deterministic engine when WebGPU or memory is missing.

**If it ships:**
- **Opt-in download.** Settings: "Download the on-device assistant (about 350 MB, once)" with size, a
  Wi-Fi hint, a progress bar, Pause, Cancel and **Delete the download**. Never start automatically.
- Cache API name `mmgr-localllm-v1`; add it to the storage inventory ("optional: the assistant model you
  chose to download"); the consent gate must pass.
- Load lazily when the AI window first needs it, with a clear "warming up" state; never at page load; never
  while the user is typing in the calculator.
- Structured output: for the calculator PROPOSAL and `ASK` lines use constrained or grammar-guided
  decoding, and ALWAYS validate page-side exactly like cloud output.
- A tier badge shows "On this device" so the user knows nothing left the machine.
- Add to the privacy page one line about the optional download.

**GATE (T-LOCALLLM, only if shipped):** a headless load in CI with a tiny test model proves the lazy load,
cache, delete and fallback paths; the spike results are committed as `docs/SPIKE-LOCALLLM-2026-10.md`;
page load JS size is unchanged.

---

## 10. LANDING PAGE (files: `index.html`, `css/marketing.css`, `js/marketing.js`, `js/marketing-globe.js`)

### LAND-1. The dot rail: quiet until needed

`index.html` lines 95 to 120 hold `<nav class="dot-rail-navigation">` with 7 big dots; `marketing.js`
generates the small dots (`MINORS_PER_GAP`); the CSS is `marketing.css` section 5 (line 294) and 16b
(line 3261). The existing comment says "No labels"; the owner's question 4 decides whether labels return.
Read the real class names from the markup first; the sketch below uses placeholders.
```css
.dot-rail-navigation .dot { opacity: .22; transition: opacity .2s ease, transform .2s ease, background-color .2s ease; }
.dot-rail-navigation:hover .dot,
.dot-rail-navigation:focus-within .dot { opacity: .7; }
.dot-rail-navigation .dot:hover, .dot-rail-navigation .dot:focus-visible { opacity: 1; transform: scale(1.25); }
.dot-rail-navigation .dot[aria-current="true"] { opacity: 1; background: var(--bullion); transform: scale(1.35); }
/* optional label (question 4 option a): shown on hover or focus only */
.dot-rail-navigation .dot[data-label]::after { content: attr(data-label); position: absolute; left: 22px;
  padding: 4px 8px; border-radius: 6px; background: var(--card); border: 1px solid var(--border);
  color: var(--text); font-size: .78rem; white-space: nowrap; opacity: 0; pointer-events: none;
  transform: translateX(-4px); transition: opacity .15s ease, transform .15s ease; }
.dot-rail-navigation .dot:hover::after, .dot-rail-navigation .dot:focus-visible::after { opacity: 1; transform: none; }
@media (hover: none) { .dot-rail-navigation .dot { opacity: .5; } }   /* touch: no hover, keep them findable */
@media (prefers-reduced-motion: reduce) { .dot-rail-navigation .dot, .dot-rail-navigation .dot::after { transition: none; } }
```
The visual dot stays small but the HIT area stays at least 24 x 24 CSS px (a transparent `::before`), per
WCAG 2.2 target size. The active dot is the gold bullion colour, not orange. Labels come from the section
headings (read the `h2`), never typed twice. Performance Mode: no transitions. Keep the rail hidden where it
is hidden now (narrow windows).

**GATE:** at rest the inactive dots compute to opacity 0.3 or less; hover raises them; the active dot
keeps full opacity; each dot is at least 24 x 24 px; keyboard focus shows the label; no overlap with the
reading column at 1280, 1100 and 900 px.

### LAND-2. The globe: what is really happening, and a safe way to make it keep turning

**Do NOT adopt the generic "fix" the owner pasted.** `marketing-globe.js` already runs one persistent
`requestAnimationFrame` loop, pauses on a hidden tab and off-screen (`visibilitychange`,
`IntersectionObserver`), and refuses to start under reduced-motion or data-saver (line 862). The reasons it
seems stalled are all deliberate:
1. **Line 521:** `if (state.t >= CARD_OUT) { state.lon += (SPIN * dt) / 1000; }`: it spins ONLY in the gap
   between cards (cards stay up about 7.2 s); while a card shows, the globe is held still so the card's
   tether stays put.
2. The easing line pulls `lon` toward the active node every frame, so spin is cancelled while a card is open.
3. OS reduced-motion or data-saver means it never starts. **[VERIFY]** the owner's OS "reduce motion"
   setting; it is a common cause on Windows.

**Fix (design):** spin continuously and let the card follow the node instead of freezing the globe.
- Remove the `state.t >= CARD_OUT` gate; always add `SPIN` (keep at or under 4 degrees per second).
- While a card is open do NOT ease toward the node; the card's position is recomputed every frame (it
  already calls `positionCard()` each frame) from the node's rotating projection.
- Close the card automatically when its node rotates past 70 degrees from the view centre or to the far
  side, then open the next random node after the existing gap.
- Pointer or keyboard focus on the stage still pauses spin (so the card can be read); leaving resumes.
- **Add a visible Pause and Play control** (WCAG 2.2.2: moving content over 5 seconds needs a pause). Reduced
  motion shows the still globe plus that control so a person can choose to play it.
- Performance Mode (PERF-1): static first frame.

**GATE (T-GLOBE):** with reduced motion off and Performance Mode off, sample `state.lon` over 20 seconds:
it increases at least 1 degree in every 2-second window except while paused; a card opens, follows its node
and closes before the node leaves the near side; the Pause control stops and restarts the loop; with
reduced motion on, the globe is still and the control works.

---

## 11. THE SWEEP: LOOK FOR EVERY SIBLING OF THE BUGS ABOVE

The owner asked for all similar gaps, not only the ones named. Build these as read-only scripts under
`tools/sweep/`, run them once at the start of Wave D, commit the reports in `docs/SWEEP-2026-10.md`
(counts plus `file:line`), then fix the top items in the wave that owns each area. A sweep with zero hits
becomes a permanent test.

| ID | Looks for | Why it matters | Fix lands in |
|---|---|---|---|
| SW-1 | Trades whose `matDesc` lists several parts but have no `ACCESSORIES` entry (T-LUMP) | The drywall problem, 50 more times | Wave E (MAT-1) |
| SW-2 | Dialogs with a `data-action` container that hold inputs (T-MODAL) | The Export Schedule bug, on 5 more dialogs | Wave D (APP-4) |
| SW-3 | Every `select`, `option`, `optgroup`, popup list: contrast per theme (T-DARK) | White-on-white lists | Wave D (UI-1) |
| SW-4 | Bare `type="checkbox"` or `radio` outside `.tgl` or a `.set-row` | Lazy toggles | Wave D (UI-2) |
| SW-5 | `position: fixed` elements and whether the page reserves space | Overlays on content (sidebar strip, banners, dots) | Wave D (APP-1) |
| SW-6 | `target="_blank"` and `window.open` on internal pages | Tab pile-up | Wave D (APP-2) |
| SW-7 | Pages that load a shader, `three`, a globe or `backdrop-filter` without the Perf boot | Performance Mode gaps | Wave D (PERF-1) |
| SW-8 | Hard-coded colours (hex or rgb) inside component rules instead of tokens | Gold and dark-mode drift | Wave E (GOLD-1) |
| SW-9 | Text blocks under 0.78 rem or inside `<small>` longer than 140 characters | Unreadable fine print | Wave D (UI-3) and a pass per page |
| SW-10 | Clickable `div` or `span` with no role, tabindex or key handler | Keyboard and screen-reader gaps | Wave F |
| SW-11 | Numeric inputs with no `inputmode` (app and project pages) | Phone keypads | Wave D |
| SW-12 | Money literals: a typed `$` or `J$` in strings instead of the currency table | Currency honesty | Wave E |
| SW-13 | Notices that exist as a dashboard card but no watcher (expiry was one) | Silent warnings | Wave D (EXP-1) |
| SW-14 | Settings stored in state but with no UI or AI path to set them | "AI can't fill every field" | Wave E (AI-3) |

---

## 12. THE THREE WAVES

Same shape as before: entry check, ordered tasks, exit gates, commit, deploy from `$HOME/mmgr-deploy`, live
probe, rollback, log. Plain Conventional Commits, no AI attribution.

### WAVE D: Fix what is broken, and what is exposed (1 to 2 sessions)
**Order:** state check and questions gate, then **RB-1** (rate data and PDF no longer public, section 3.4),
then **APP-4** (dialog click fix), then the **sweep** reports (section 11), then **UI-1** (picker CSS, then the
listbox), **UI-3** (notes tab), **UI-2** (setting rows and statutory drawer), **APP-2** (same-tab navigation),
**APP-1** (sidebar gutter), **PERF-1** (boot script, kill block, calculator wiring, switch), **EXP-1** and
**RISK-1** (watchers), **SW-11**.
**Exit gates:** T-RB, T-MODAL, T-DARK, T-ROWS, T-NEWTAB, T-PERF-WIRE, T-RISK, T-EXP green; the sweep report
committed; `npm run verify`; the full `qa-*` battery; the earlier gates still green.
**Commits (examples):** `fix(cloud): serve the rate book only to signed-in sessions`, `fix(ui): let dialog
controls change`, `fix(calc): readable work-item list in dark mode`, `feat(calc): setting rows with
drawers`, `fix(nav): keep app pages in one tab`, `fix(perf): performance mode reaches every page`,
`feat(notices): expiry and finish-target watchers with suggestions`.
**Live probe:** `curl` on the old PDF path returns 404 and the rate data URL returns 401 signed out; every
Export Schedule option changes and the chosen format downloads; Work item list readable in dark; the
admin to dashboard trip leaves one tab; Performance Mode on the calculator stops the background.
**Rollback flags:** `ratebookApi`, `dialogClickFix`, `settingRows`, `sameTabNav`, `perfBoot`.

### WAVE E: Look, brand and materials (2 to 3 sessions)
**Order:** **GOLD-1** (audit, tokens, shared button, light and dark rules), **UI-4** (top bar), **rate book
rebrand** (section 3.2), **MAT-1** (itemised materials, drywall first, then the families in Appendix A),
**MAT-2**, **MAT-3**, **AI-3**, **GANTT-1** (wide dialog, Tidy, one view builder), **LAND-1**, **LAND-2**,
**pricing page wording**, **SW-8, SW-12, SW-14**.
**Exit gates:** T-GOLD, T-ACC, T-LUMP, T-GANTT, T-GLOBE, the rate-book wording check (no claim of independence
unless status c), contrast report attached; field-guide cards for each feature; `npm run verify`.
**Commits (examples):** `feat(brand): real gold bullion tokens and shared button`, `feat(calc): itemised
materials with editable accessory lines`, `feat(gantt): tidy view, reduced links, wide export dialog`,
`feat(landing): quiet dot rail and continuous globe`, `feat(ratebook): my manager rate book name and mark`.
**Live probe:** buttons are gold in both modes with readable labels; drywall shows its accessory lines and
the total changes when one is switched off; the export dialog fits one screen and the chart is tidy; the
dot rail is faint until hovered.
**Rollback flags:** `goldBullion`, `itemisedMaterials`, `ganttTidy`, `dotRailGhost`, `globeContinuous`.

### WAVE F: Depth and structure (2 to 3 sessions)
**Order:** **AI-1** (window layout, docking, history), **AI-2** (spike, then ship only if it passes),
**APP-3** (the three codes, backup status, step-up and salt), **SW-10**, the rest of the accessory
families, and a full re-check of every task in this file.
**Exit gates:** T-AIWIN; T-LOCALLLM if shipped; the re-check table below with zero open High items.
**Live probe:** docked AI window pushes the page; the three code names appear everywhere; the restored
admin shows both project groups.
**Rollback flags:** `aiDock`, `localModel`.

---

## 13. KILL SWITCHES

Add to the flags block in `js/mmgr-state.js` (server-side items also as Worker vars). Default `true`; `false`
restores the old behaviour with no logic redeploy.

| Flag | Guards |
|---|---|
| `ratebookApi` | RB-1 (off = old static file path, for emergency only) |
| `dialogClickFix` | APP-4 |
| `comboboxPicker` | UI-1 listbox (off = native select with the CSS patch) |
| `settingRows` | UI-2 |
| `itemisedMaterials` | MAT-1 (off = lump rates only) |
| `goldBullion` | GOLD-1 shared button block |
| `perfBoot` | PERF-1 boot and kill block |
| `sidebarGutter` | APP-1 |
| `sameTabNav` | APP-2 |
| `expiryWatcher`, `finishWatcher` | EXP-1, RISK-1 |
| `ganttTidy` | GANTT-1 Tidy and link policies |
| `aiDock` | AI-1 docking (off = overlay as today) |
| `localModel` | AI-2 |
| `globeContinuous`, `dotRailGhost` | LAND-2, LAND-1 |

**Rollback order if a live probe fails:** flip the flag; if the fault is not flag-guarded, `npx wrangler
rollback`, then `git revert` the wave's range, then log what failed and why.

---

## 14. APPENDIX A: ACCESSORY COVERAGE (what each trade must itemise)

Starting list for MAT-1. The AI sources the quantity rule and price for each; every line is editable and
none is priced silently. A trade with truly nothing to itemise gets `accessoriesNone: '<reason>'`.

| Trade family | Items to itemise (besides the primary material) |
|---|---|
| Drywall and ceilings | studs and track, joint compound, tape, corner bead, screws, access panels, hangers, wall angle, main and cross tees |
| Blockwork and brickwork | mortar (cement and sand), vertical and horizontal reinforcement, wall ties, fill concrete for cores, lintels, damp-proof course, weep holes |
| Slab, footings, drives, screed | vapour barrier, mesh and spacers, chairs, curing compound, expansion joints and sealant, bonding agent, pump hire (formwork and rebar laps already exist) |
| Render and plaster | beads and mesh, primer, sand and cement, scaffold allowance |
| Paint | primer, sealer, filler, sandpaper, masking tape and drop sheets, rollers and brushes, thinners, caulk |
| Tile | adhesive, grout, spacers, edge trim, waterproofing membrane, backer board, sealant, levelling compound |
| Roofing and shingles | underlayment or felt, flashings, ridge caps, fasteners, battens or purlins, sealant, insulation |
| Gutters, soffit and fascia | brackets, end caps, downpipe straps, sealant, vents, J-channel, fixings |
| Framing and carpentry | nails and screws, hurricane straps, anchor bolts, treated plates, sheathing, insulation |
| Doors and windows | frames and shims, hinges and locks, sealant, flashing tape, trim |
| Plumbing | fittings, solvent cement and primer, hangers and clamps, valves, traps, thread tape, pressure test |
| Electrical | boxes, cable and conduit fittings, breakers, earth rod and clamp, connectors, tape, labels, cover plates |
| Fencing | posts, rails, tie wire, concrete, gates and hardware, barbed or razor wire |
| Steelwork and welding | tie wire, spacers, electrodes, grinding discs, anti-rust primer, bolts |
| Groundworks and drainage | gravel, geotextile, pipe, covers, backfill and compaction, shoring, dewatering, disposal |
| Septic and tanks | pipe, gravel bed, distribution lines, covers, excavation allowance |

---

## 15. FINAL RE-CHECK TABLE (paste, filled, into the log at the end of Wave F)

| Group | Done, Answered or Deferred | Evidence |
|---|---|---|
| RB-1, rate book rebrand | | curl output and wording check |
| APP-1 to APP-4 | | tests and screenshots |
| UI-1 to UI-4, AI-3 | | gate output |
| MAT-1 to MAT-3 | | reconciliation table |
| GOLD-1 | | contrast report |
| PERF-1 | | per-page perf test |
| GANTT-1, RISK-1, EXP-1 | | fixtures |
| AI-1, AI-2 | | tests, spike report |
| LAND-1, LAND-2 | | gates |
| SW-1 to SW-14 | | `docs/SWEEP-2026-10.md` |
| Owner answers (questions 1 to 11) | | each answer and where it was applied |

**End of directive.**
