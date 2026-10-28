# My MaNaGeR - REFINEMENT PROGRESS (live checklist)

Mirror of `REFINEMENT-DIRECTIVE-2026-10-24.md` (waves D, E, F). That file stays the authority for WHAT each
task means. THIS file is the authority for what is DONE and what is LEFT. Put it at the repo root
(`*.md` is never deployed).

Measured: 2026-10-27, HEAD `acf2462`, from the uploaded tree. Evidence = code read, git log, and the
static gates run on that tree (verify-calc-lump, verify-settings-reach, verify-ratebook-wording,
verify-perf-boot, verify-newtab, verify-doc-size: all pass). Browser (Playwright) harness pass counts
below are as logged by the previous session in `reflection.txt`; they were not re-run for this file.

---

## PROMPT TO THE AI (read this first, obey it exactly)

You are the terminal AI finishing the refinement directive. Follow these rules with no interpretation:

1. Read `CONTINUATION-DIRECTIVE.md` (locked rules), then this file, then the directive section for your task.
2. Take the FIRST unchecked item in **NEXT UP** (section 4). Run the directive's STATE CHECK for it (search
   `git log` and the code). If the work already exists, mark it `[x]` with the commit hash and move on.
3. Build it, run its GATE, paste the gate result into your log.
4. **The moment a task's gate passes, update THIS file in the SAME commit as the code:**
   - flip `[ ]` to `[x]` (or `[~]` with a one-line reason if blocked, or `[-]` if deferred with a reason);
   - add the evidence on that line: commit hash plus gate result;
   - recompute the **Scoreboard** counts;
   - move the **NEXT UP** pointer to the next unchecked item.
5. Never tick a box you did not verify. A box without evidence is a defect.
6. A passed gate is not a pause point. Go straight to the next unchecked item. Stop only when NEXT UP is empty
   or a gate fails in a way the directive does not explain.
7. If the code and this file disagree, the code wins. Fix this file and note the correction in section 6.
8. Locked rules still apply: no emoji, no em dash or en dash in served copy, plain Conventional Commits with no
   AI attribution, a field-guide card for every new feature in the same change, `node build.js` after any `js/`
   edit, bump `sw.js` when served files change, `npm run verify` before every deploy,
   `CONTINUATION-DIRECTIVE.md` stays at or under 40,960 bytes.

---

## 1. SCOREBOARD

| Wave | Tasks | Done | Partial or in progress | Not started |
|---|---|---|---|---|
| D (fix what is broken or exposed) | 12 | 12 | 0 | 0 |
| E (look, brand, materials) | 14 | 14 | 0 | 0 |
| F (depth and structure) | 6 | 2 | 0 | 4 |
| **Total** | **32** | **28** | **0** | **4** |

Plain reading: Waves D and E are both closed - every look, brand and materials task is done and harness-backed. The
four untouched ones are all in Wave F and they are the biggest pieces (AI window rebuild, in-browser model spike,
the three admin codes, and the SW-10 sweep). Task count is not effort: expect Wave F to take as long as D and E did together.

Cross-cutting: deploy and live probe for Waves D and E are DONE (2026-10-27, Version ID
`650dc6e1-a4e8-4aaa-bc5b-703e979ccdb4`, probe 9/9). Nothing cross-cutting is open.

---

## 2. WAVE D (all closed)

- [x] **RB-1** rate data and PDF no longer public. `deb2236`. `GET /api/ratebook` (`src/ratebook.js`, `src/router.js:839`), data in `src/data/ratebook.js`, `js/jic-rates-full.js` and the root PDF gone, `*.pdf` in `.assetsignore` and `PRIVATE_ROOT_EXT`, `mmgr-ratebook-v1` in `docs/STORAGE-INVENTORY.md`.
- [x] **APP-4** dialog controls can change. `c828958`. Dispatcher fix at `js/mmgr-app.js:5335`; `tools/qa-modals.cjs` (T-MODAL), wired in `ci.yml`.
- [x] **Sweep** reports. `208a27a`. `tools/sweep/sweep.cjs`, `docs/SWEEP-2026-10.md`.
- [x] **UI-1** dark-mode picker. CSS patch plus `js/mmgr-combobox.js` on `calc-family` and `calc-work`. T-DARK is in `tools/qa-calc-controls.cjs`.
- [x] **UI-3** Notes tab, loose lede removed (`calculator.html:90`, tablist at line 99).
- [x] **UI-2** setting rows and statutory drawer (`ONCOST_PARTS` in `js/calculator-page.js:3798`, 7 `.set-row` blocks).
- [x] **APP-2** same-tab navigation. `verify-newtab` passes; helper `MMGR.Nav.go`; allow-list `tools/newtab-allow.json`.
- [x] **APP-1** sidebar gutter (`app.html` rules, `--rail-closed-w`). `tools/qa-appshell.cjs` covers it.
- [x] **PERF-1** `js/mmgr-perf-boot.js`, one kill block (`css/mmgr.css:16007`, `css/marketing.css:5039`), calculator switch, marketing footer switch (`js/marketing.js`). `verify-perf-boot` passes; sweep SW-7 = 0.
- [x] **EXP-1** `watchExpiries` (`js/mmgr-watch.js:394`). `qa-notice-watchers` 19/19 (logged).
- [x] **RISK-1** `watchFinishTarget` (`js/mmgr-watch.js:528`) with shared `ns.Schedule.projectedFinish`. Same harness.
- [x] **SW-11** numeric inputs have `inputmode`. Sweep SW-11 = 0.

Small checks left from Wave D - all four done 2026-10-27, three of them by making a gate measure the thing the
item actually asks about:
- [x] [VERIFY] `calculator.html:74` `perf-tgl` is a bare checkbox with class `bcp-perf-in`. **Confirmed allowed, and
  the allowance is now honest.** T-ROWS excused *any* checkbox inside `.bcp-perf`; it now excuses only the one named
  switch (`#perf-tgl` + `data-action="tglPerfMode"`), and two new arms prove the exception is a real switch rather
  than a bare input in a wrapper: exactly one input in the container, opacity 0, a 32x18 painted track with a knob,
  and a label click that flips `checked`, recolours the track and moves the knob (both directions). `qa-calc-controls`
  63/63.
- [x] [VERIFY] APP-1 on `project.html` (`#app-sidebar`, `body.sidebar-on`): **closed state does not overlap content,
  now measured instead of inferred.** The old arm passed on `right <= 1 || visibility === 'hidden'` (either was
  enough) and `mainLeft >= 0` (nearly always true). It now requires both off-canvas *and* invisible, the column
  starting at x=0, no visible page element overlapping the rail's box (real overlap test, 1px tolerance), and no
  sideways overflow - at 1280/1024/900/768/390 in both themes. A third arm covers the other half of the claim on
  desktop: opening the rail makes it visible, moves the column to >= 200px and still overlaps nothing.
  `qa-appshell` 79/79.
- [x] [VERIFY] Sweep SW-13 listed 14 "card with no watcher" items. **All 14 were detector false positives, and the
  detector had two defects.** (1) It asked "does `js/mmgr-watch.js` mention this id", which is not the question:
  renderer-built ids (`expiry-body`, `wbs-alerts`, `risk-matrix`, `raci-alerts`), form controls (`mc-risk-factor`,
  `client-code-expiry`), a print preview (`pv-tpl-risk`) and marketing anchors (`f-risk`) were never watch-module
  cards. (2) Worse, the sweep's file list was `js/*.js` only, so five containers written from `js/render/*.js` were
  invisible to it - the recursive `JS_TREE` walk (88 modules) is the real fix. The detector now asks the honest
  question: an element on a workspace page whose id looks like a notice surface and which appears in NO producer at
  all (no js/src module, no worker, no inline script in any page). SW-13 reads 0. Permanent gate
  `tools/verify-sweep13.cjs` (4 checks) keeps it honest in the three ways a count cannot: zero hits, the judged
  containers must still exist (a regex matching nothing also reports zero), and the producers it relies on must be in
  files it scans. Registered in `docs/CI-TEST-COVERAGE.md` (138 rows), wired in `ci.yml` T1 and
  `npm run verify:sweep13`. Teeth proven: renaming `id="expiry-body"` fails with exactly one hit; renaming the form
  control stays out of scope; both files restored byte-identical.
- [x] Regenerate `docs/SWEEP-2026-10.md` with `node tools/sweep/sweep.cjs --write`. The stale copy showed SW-1 at 29
  hits, SW-4 at 25, SW-7 at 1, SW-8 at 539, SW-11 at 6, SW-12 at 1 and SW-13 at 14. The fresh run shows SW-1 0, SW-7
  0, SW-11 0, SW-12 0, SW-13 0, SW-14 0, SW-4 29, SW-5 57, SW-6 2, SW-8 333, SW-9 433, SW-10 16, 893 findings
  across 14 sweeps. The header now counts the whole `js/` tree (88 modules), not just the flat list.

---

## 3. WAVE E

- [x] **UI-4** calculator bar mirrors the app bar. `c53657c`. Parity check lives in `qa-calc-controls` ("UI-4 bar parity").
- [x] **Rate book rebrand** `3a3b55c`. Name, brand mark, one `rateBookNotice()`, source line kept while provenance is unresolved. `verify-ratebook-wording` 12/12.
- [x] **MAT-1** itemised materials. `d6f97eb`. `verify-calc-lump` passes: 49 trades, 35 itemised, 14 with a written reason. T-ACC in `tools/qa-mat-items.cjs`, wired in `ci.yml`.
- [x] **MAT-2** related trades and materials. `a3b7aae`. `tools/qa-related-items.cjs`, wired in `ci.yml`.
- [x] **MAT-3** price-change stamp and badge (`rateSig`, `pricedAt`, "Re-price this line"). `a3b7aae`. Harness: `tools/qa-calc-prices-changed.cjs`.
- [x] **AI-3** assistant reaches every field and asks. `e59aeeb`. `verify-settings-reach` passes (11 keys); `ASK:` line parsed in `js/calc-ai.js`.
- [x] **LAND-1** ghost dot rail. `431260c`. `qa-dot-rail` 15/15 (logged).
- [x] **LAND-2** continuous globe plus Pause control. Spin `431260c`; **the Pause control itself was never built and
  is fixed in `c2816a0`**. `431260c` shipped the
  spin, the card-follows-node behaviour and a `.hg-play` CSS rule, but nothing created the button: `build()` read
  `.hg-controls` into a variable it never used and no code ever set `state.paused`. `qa-globe-spin` passed 7/7
  because it set `st.paused = true` directly, so the gate proved the LOOP honours the flag while the directive's
  claim ("a visible Pause and Play control", WCAG 2.2.2) was never tested. Now: the button is created in `build()`
  (before the refuse decision), a real click pauses and resumes, the label and icon flip between Pause/`i-pause` and
  Play/`i-play` (two symbols added to `css/mmgr-icons.svg`), it is hidden under Performance Mode and data saver
  (with the `.hg-controls[hidden] { display: none }` guard, because the flex rule outranks the UA hidden rule), and
  under reduced motion the still globe (the poster) now shows WITH the control so a person can choose to play it,
  which is the directive's own wording. Gate `qa-globe-spin` is 15/15: it now clicks the real button, asserts the
  label/icon flip, asserts the Performance Mode hide and runs a second reduced-motion context. Five mutations
  caught (control never built, click does not set paused, the `[hidden]` guard dropped, reduced motion hides the
  still globe again, the label never flips) and it returns green byte-identical. Two arms of `qa-hero-globe` were
  measuring the OLD contract and are re-baselined with it: G5 asserted that **no** Pause/Play button existed (the
  2026-10-13 note that cleared the feature tab chips) and G8 asserted that reduced motion left the mock cards in
  place with no globe at all. G5 now requires zero tab chips, exactly one visible Pause control and a self-carrying
  cycle; G8 requires the still globe with its Play control and the cards stepping aside by visibility, so the column
  keeps its height and the page cannot shift. Four mutations caught there too; `qa-hero-globe` 16/16.
  `npm run verify` green (145/145 unit tests, registry 137/137), `qa-globe-spin` 15/15, `qa-hero-globe` 16/16,
  `qa-dot-rail` 15/15, `qa-full` 194/194, `sw.js` at `mmgr-shell-v487`. Field-guide cards for the whole wave
  (A-04 view controls, A-30 materials and prices, A-17 public site) landed in the same commit.
- [x] **Pricing page wording** (`pricing.html:122-123`, count gated against the data).
- [x] **SW-12** one currency table. `5e0f732`. Sweep SW-12 = 0.
- [x] **SW-14** every setting reachable. `5e0f732`. Sweep SW-14 = 0, `verify:reach` is in `npm run verify`.

Partial or in progress:

- [x] **GOLD-1** gold that is readable as words and as a fill. `ee5ddfe`. Gold as WORDS reads one of two semantic
  tokens instead of the fill alias: `--gold-text` (deep bronze step `#7a5a0b` on a light or glass surface, 6.37:1
  on white; the theme accent in dark, where those rules always resolved to white and were right) and
  `--gold-text-on-dark` (`#d4af37` for surfaces dark in BOTH themes - the marketing hero band and the site footer,
  8.32:1 on `#1c1917`). 161 rules re-pointed (136 app, 25 marketing); the gold FILL still reads `--gold`, so every
  gradient, wash, shadow and ring is untouched. Two measured decisions, both recorded in `docs/GOLD-AUDIT.md`
  section 7:
  - **The gradient is the two-stop form.** The directive samples the three STOPS and says the label "sits near the
    middle stop" (4.45:1). A label is not a point: rasterising the computed gradient at each button's real size and
    sampling every pixel under the text's own box measured **3.19-3.70:1 on all 13 gold buttons**, light and dark.
    The directive's own narrow-button two-stop form measures **4.83-4.95:1 at rest, 5.91-6.11:1 on hover**, so it is
    the default for every label. Both stops are directive values; the three-stop form was used nowhere else.
  - **The narrow-button item closes by construction.** No class, no runtime width measuring, nothing dead.
  The first pass of the swap also caught `border-color:`, `outline-color:`, `accent-color:` and `border-top-color:`
  (63 declarations) because `color:` is a substring of those names; they were reverted to `var(--gold)` - a border
  is not a word, and the gate's regex now anchors on the property. Gate: `tools/verify-gold.cjs` (T-GOLD, five
  arms). ARM 1 static orange scan against the 14-declaration allow-list, which also FAILS if an allowed anchor
  disappears (a stale exception is how an exception becomes a lie). ARM 2 token parity between the two stylesheets
  plus "no rule paints gold words with the fill token". ARM 3 the rasterised label measurement, 6 pages x 2 themes
  x rest and hover. ARM 4 gold-as-words against each element's composited background - this caught the deep bronze
  landing on the marketing hero at 2.74:1 and the wordmark rule shared by a light glass header and a dark footer.
  ARM 5 `.btn-g` still computes `rgb(46, 125, 50)`. Measured 48 gold button labels and 53 gold-as-words elements.
  Five mutations each turn it red and it returns green byte-identical. Wired in three places (harness,
  `docs/CI-TEST-COVERAGE.md`, `ci.yml` T4) plus `verify:gold`. A screenshot pass also found a real toolbar defect:
  the Tidy switch lost the cascade to `.tgl` (same specificity, later in the file), so the word sat on the switch
  track; the selector is now `.gv-tgl.tgl` and T-GANTT asserts it. Noted, not changed: `.btn-g` is defined twice
  (first copy dead) and `.btn-o` twice with different `color` - harmless, and a cleanup for a non-colour wave.
  `npm run verify` green (145/145 unit tests, registry 137/137), `qa-full` 194/194, `sw.js` at `mmgr-shell-v486`.
- [x] **GANTT-1** one view builder for the screen and all three exports. `dfdc751`. `js/mmgr-gantt-view.js`
  is the only answer to "which rows, over which span, joined by which links, at which scale"; `renderGantt`,
  `drawDependencyArrows` and PNG/SVG/PDF all read it (`ganttViewFor`, `buildGanttDrawList`). Group by
  Phase / Trade / Assignee (a band is a value, so phases leave the trade and assignee axes; a task with no
  value lands in a named band, never dropped), Window Whole project / Next 90 days / Custom with an
  automatic scale ladder (day under 45 days, week under 200, month beyond), Tidy on the toolbar as well as
  in the export dialog. Phase gates draw as distinct gold diamonds with a right-hand label. All three are
  VIEW state in `s.ui`; the plan, its dates and its links are never touched. Two real defects fixed: a
  zero-duration PHASE was classified as a milestone diamond, and a `Utils.addDays` Date leaked into
  `scale.to` and the header tick cursor (the header rendered one cell). Link honesty: a derived
  phase-to-own-gate line is drawn only by `gates` and is never clickable, because the overlay offers
  "remove this dependency" and the plan does not contain that edge. Gate: `tools/verify-gantt-view.cjs`
  (T-GANTT, 121 checks) over the committed fixture `tools/fixtures/gantt-bank.json` (45 tasks, 5 phases,
  40 real, 63 links, 24 critical) - `all` 63 / `near` 56 / `critical` 23 / `gates` 28 (5 derived + 23
  critical), tidy 22 rows collapsing p1-p3 with 11 links, 21 trade bands, 20 assignee bands, next90 =
  2027-01-20 to 2027-04-20 (week, 91), 20-day window = day, 792-day = month, inverted window falls back to
  `all`. Wired in three places: the harness, `docs/CI-TEST-COVERAGE.md` and the `ci.yml` T1 step, plus
  `verify:gantt` in `npm run verify`. Teeth proven: five deliberate mutations each turn it red and it
  returns green byte-identical. Browser: `qa-full` 13e-13k cover the three controls, 194/194.
- [x] **SW-8** hard-coded colours to tokens. `f258b3e`. The `--lit-*` neutral token block is in BOTH
  stylesheets (29 tokens each, identical names) and every substituted value is proven identical to the
  literal it replaced (`tmp/check-lit-tokens.cjs` resolved each token back and compared to HEAD with
  whitespace and comments normalised: `RESULT the swap is value-neutral`). Chromatic colours stay out of
  this block (they go with gold). Sweep SW-8 reads 335 now (539 at baseline); the rest is chromatic and
  belongs to GOLD-1. The same commit also fixed a real CSP defect: the inline `onerror` attribute that
  armed the dev bundle fallback was blocked by the hash-only `script-src`, so the fallback was dead code
  on twelve pages; it is now a hashed listener.

Field-guide cards (locked rule 8). All six written in `c2816a0`, verified 0 em/en dashes and 0 emoji:
- [x] Itemised materials - A-30 "Materials, suggestions, and prices that moved": the switch, the accessory
      lines at their own price, add-my-own-item and reset to planning allowances
- [x] Tidy view and link policies - A-04 "Changing what you see, never what you planned": Tidy, Group, Window and
      the four link policies in Export Schedule, with the derived phase-gate line called a picture, not a dependency
- [x] "Prices changed" badge and Re-price - A-30: the priced-at stamp, re-price this line, keep as quoted, and why
      the total never moves on its own
- [x] Related items suggestions - A-30 "Work you would have forgotten": one-tap chips, quantity from the same
      dimensions, withheld when the dimensions cannot give an honest number
- [x] Quiet dot rail and globe Pause control - A-17 "On the public site": the rail's big/small dot rule and the
      Pause/Play control including reduced motion and Performance Mode
- [x] AI `ASK` buttons and the new settings the assistant can set - A-30 "The assistant asks before it guesses":
      one question per reply, answers as buttons, nothing changes until clicked, the page does the arithmetic

Wave E exit: T-GOLD, T-ACC, T-LUMP, T-GANTT, T-GLOBE green, wording check green, contrast report attached, `npm run verify`.
Status: all five gates are green and wired, and the contrast report is `docs/GOLD-AUDIT.md` sections 6 and 7
(the measurements, the three decisions, the 14 remaining oranges with reasons). Wave E is closed on its own
terms: every field-guide card is written (`c2816a0`), and the only thing left for Wave E is the shared
deploy/live probe in NEXT UP step 6.

---

## 4. NEXT UP (work strictly in this order)

1. [x] Resolve the uncommitted SW-8 work (see above). Commit. `f258b3e` - token swap proven
   value-neutral, the CSP fallback defect fixed with it, `npm run verify` green (145/145 unit tests,
   registry 135/135), `sw.js` bumped to `mmgr-shell-v484`.
2. [x] GANTT-1 finished with T-GANTT. `dfdc751`. 121 static checks green, five mutations caught,
   `qa-full` 194/194 with 13e-13k covering the three view controls, `npm run verify` green (145/145
   unit tests, registry 136/136), `sw.js` at `mmgr-shell-v485`. Harness registered in all three places.
3. [x] GOLD-1 finished with T-GOLD. `ee5ddfe`. 15 checks green (static orange allow-list with no stale
   exception, token parity, the two-stop gradient, gold-as-words contrast on 6 pages x 2 themes x rest and
   hover, `.btn-g` still green), 5 mutations caught, `npm run verify` green (145/145 unit tests, registry
   137/137), `qa-full` 194/194, `sw.js` at `mmgr-shell-v486`. Measured 48 gold button labels and 53
   gold-as-words elements. Two measured decisions recorded in `docs/GOLD-AUDIT.md` section 7: the two-stop
   gradient (the three-stop form was 3.19-3.70:1 on every real label) and two gold-as-words tokens (the
   single token landed on the marketing hero at 2.74:1). Harness registered in all three places.
4. [x] Field-guide cards listed above. `c2816a0`. **The state check found a real gap first:** the card
   "Quiet dot rail and globe Pause control" could not be written because **there was no Pause control**. The
   directive (section 10, LAND-2) requires "a visible Pause and Play control (WCAG 2.2.2: moving content over 5
   seconds needs a pause)", and the T-GLOBE gate is worded "the Pause control stops and restarts the loop". What
   existed was `index.html`'s empty `<div class="hg-controls">`, a `.hg-play` CSS rule, and a `state.paused` flag
   nothing ever set: `marketing-globe.js` queried `.hg-controls` into a variable it never used, and
   `tools/qa-globe-spin.cjs` poked `st.paused = true` directly instead of clicking anything, so the gate passed on
   a control that was never built. LAND-2 was PARTIAL, not done; it is now complete (`c2816a0`), the gate clicks
   the real button (15/15) and `qa-hero-globe`'s two stale arms are re-baselined to the new contract (16/16).
   All six cards written, 0 em/en dashes, 0 emoji. `npm run verify` green (145/145 unit tests, registry 137/137),
   `qa-full` 194/194, `sw.js` at `mmgr-shell-v487`.
5. [x] Wave D small checks listed in section 2. Done 2026-10-27 (section 2 carries the detail). Three of the four
   were closed by making the gate measure what the item asks: T-ROWS now names the one Performance Mode switch and
   proves it is a real switch (`qa-calc-controls` 63/63); APP-1's project-page arm now requires off-canvas AND
   invisible AND no overlap AND a column at x=0, plus the open state moving the column over (`qa-appshell` 79/79);
   SW-13's 14 "dead card" hits were all false positives caused by a wrong question and a file list that skipped
   `js/render/`, now a permanent 4-check gate `tools/verify-sweep13.cjs` (0 hits, surface-exists and corpus arms,
   registered + `ci.yml` T1 + `verify:sweep13`), with teeth proven both ways. `docs/SWEEP-2026-10.md` regenerated
   (SW-1/7/11/12/13/14 all 0; 893 findings across 14 sweeps). `npm run verify` green (145/145 unit tests, registry
   138/138).
6. [x] End of Waves D and E: `npm run verify`, full `qa-*` battery, CI green, commit, deploy from `$HOME/mmgr-deploy`,
   live probe. **CLOSED 2026-10-27.** CI run `40628905493` (`a436862`) is **green on all 108 steps**; deployed
   Version ID `650dc6e1-a4e8-4aaa-bc5b-703e979ccdb4`; live probe **9/9 PASS** against `https://mymanagerworkspace.com`
   (baseline before the deploy was 6 of 9 FAILING). Probe list and evidence below.
   Probe list: old PDF path returns 404; `/api/ratebook` returns 401 signed out;
   every Export Schedule option changes and downloads; Work item list readable in dark; admin to dashboard leaves one
   tab; Performance Mode on the calculator stops the background; buttons gold with readable labels in both modes;
   drywall shows its accessory lines.

   Progress so far, and it earned its keep:
   - **CI run `40621517883` stopped at step 90**, so fifteen T4 suites never ran. Running all fifteen locally
     (`tmp/run-t4.cjs`) found **three red suites and two real app defects** that no gate had reached.
   - Step 90 itself was a stale arm, not an app bug: W11 asserted the AUTHORED text `/255, 255, 255/` against
     `color: var(--lit-white)`, so a correct tokenisation read as a failure. It now resolves both declarations
     through a probe element (`bgResolved === 'rgb(46, 125, 50)'`, `colorResolved === 'rgb(255, 255, 255)'`),
     which is stricter: an undefined token resolves to nothing and still fails. `qa-calc-assistant` 156/156.
   - **DEFECT 1 (real): an expiry due TODAY was reported as OVERDUE.** `mmgr-stakeholders.js` banded expiries with
     `new Date(dateOnlyString)` - parsed as UTC midnight - against the CURRENT instant, so a certificate expiring
     that day came out at -1 day: the dashboard read "COI is overdue (was due today)" and the watcher filed it in
     the overdue band instead of the 7-day band. EXP-1's 0-day fixture caught it; the -3/6/13/29/59 fixtures all
     passed, which is the signature of a boundary bug. Days are now counted between LOCAL calendar dates through
     one shared helper (`daysUntil`), used by BOTH the rollup and `getExpiringCompliance` - they previously
     measured "N days out" two different ways, so the badge and the notice could disagree about the same item.
   - **DEFECT 2 (real): the calculator's setting hints were 3.84:1.** `.set-hint` carried `opacity: 0.82`, which
     composited `--slate` (#666666) to #828282 on a white card, under AA at 0.74rem. axe named every hint on the
     page. Opacity removed; `--slate` alone is 5.74:1 light and 5.5:1 dark.
   - **One stale harness**: `qa-shortcuts` crashed (not failed) at gate 11 because it called
     `selectOption('#calc-work')` and UI-1 had replaced that native select with the app's own listbox, leaving the
     native element `display:none`. It now presses the real listbox row and asserts the pick landed.
   - Teeth proven for both app fixes by mutation, with `node build.js` between the write and the gate: reverting the
     date math reddens the 0-day arm; putting the opacity back reddens axe naming `calc-measured-manual-hint`. Both
     return green byte-identical. (The first W11 proof looked toothless for exactly this reason - a source mutation
     that never reaches `dist/` proves nothing.)
   - Gates: `qa-notice-watchers` 19/19, `qa-a11y-axe` 7/7, `qa-shortcuts` 15/15, `qa-calc-controls` 63/63,
     `qa-appshell` 79/79, `verify-gold` all checks, `qa-mat-items` 36, `qa-related-items` 13, `qa-modals` 12,
     `qa-dot-rail` 15, `qa-globe-spin` 15, `verify-calc-s2` 75, `qa-procurement` 51, `qa-consent` 37,
     `qa-widescreen` 27, `qa-hero-globe` 16, `npm run verify` green. `sw.js` at `mmgr-shell-v488`.
   - **FINAL EVIDENCE (2026-10-27).** Two red CI runs were worked through in order, each with a local reproduction
     first: step 90 (W11, stale arm) and step 96 (`qa-calc-controls`, a fixed-delay race reading an animating
     track). After the second fix CI run `40628905493` (`a436862`) is **green on all 108 steps**. Deployed from
     the byte-verified `$HOME/mmgr-deploy` copy (`Version ID 650dc6e1-a4e8-4aaa-bc5b-703e979ccdb4`). Live probe
     against `https://mymanagerworkspace.com`: **9/9 PASS** - the retired rate-data file and the rate-book PDF
     both 404, `/api/ratebook` 401 signed out, the home page 200 with its CSP header, the deployed globe bundle
     carries the Pause control, the sprite carries both new symbols, the field guide carries the three new card
     sections, and the project page answers 200/307. The same probe was 6 of 9 FAILING before the deploy.
   - **CI watcher defect (tooling, fixed):** both watchers compared `gh`'s full 40-character `headSha` to the
     7-character short SHA, so they printed "no CI run yet" through two entire red runs. They now prefix-match.
     A watcher that silently never finds the run is worse than no watcher: it converts a red run into silence.
   - **CI run `40625949216` (bb15d91) is RED at step 96**, `qa-calc-controls` 62/63: "T-ROWS clicking the switch
     flips it, recolours the track and moves the knob". It is a HARNESS race, not an app bug - and proving that
     took three measurements. The switch flipped (`checked` false -> true), the track recoloured
     (`rgb(229,224,216)` -> `rgb(217,108,40)`) and the knob moved; the failing clause was the RETURN to the OFF
     colour. The track animates `background-color 0.4s`, and the arm read it at a fixed 300 ms - on the slower CI
     runner it sampled mid-flight (`rgb(229,223,215)` heading for `rgb(229,224,216)`). A settle helper was added,
     and its first version was ALSO wrong: "two consecutive identical samples" declared the transition finished at
     `rgb(227,206,189)` because turning Performance Mode off pauses the transition for a couple of frames while the
     heavy effects re-mount. The arm now waits for the actual OFF colour (bounded at 8 s); the assertions are
     unchanged. Teeth proven: pinning the checked track to `var(--border)` (a switch that does not show its state)
     is CAUGHT, then restored green. `qa-calc-controls` 63/63.
   - Lesson for the log: a fixed delay in a gate that reads an animated property is a flake with a timer, and
     "stable for two samples" is not the same as "arrived" - wait for the value the assertion names.
7. [x] **AI-1** AI window layout, docking (docked at 1280 and up, overlay 1024 to 1279, sheet under 1024), Maximise, Float, Pin, `Ctrl+.`, history in project state. Directive section 9. Gate T-AIWIN. All failures fixed and gates green - 22/22 in qa-ai-win, axe clean in both palettes (dark measured through the real theme path), label-title-only fixed (aria-label added to #ai-tier and #ai-q), color-contrast failures fixed (--text-secondary for .ai-hist-when, --on-gold for #ai-seg-presets, --text-secondary for .ai-copy-btn, --on-gold for .ai-adv summary). `npm run verify` green (145/145 unit tests, registry 138/138). Deploy from `$HOME/mmgr-deploy` verified. **NEXT UP - start here.**
8. [ ] **AI-2** in-browser model: two-day spike first (`tools/spike-localllm.html`, not shipped), results in `docs/SPIKE-LOCALLLM-2026-10.md`, ship only if the acceptance numbers pass (opt-in, under 400 MB, Cache API `mmgr-localllm-v1`, worker, fallback to the deterministic engine). Flag `localModel` exists and is set `true` with no feature behind it: set it to `false` until the feature ships.
9. [ ] **APP-3** three code names everywhere (Site admin code, Admin panel code, Project and Client code), "Which code is this?" popover, "Backed up to your account" status, restore lists both project groups, optional salt and PBKDF2 for the local gate. Directive section 7. Note: only the "Site admin code" label exists today (`admin.html:422`).
10. [ ] **SW-10** 16 clickable `div` or `span` with no role, tabindex or key handler (`admin.html:478`, `app.html:415`, `project.html:164, 187, 238, 644` and 10 more; re-run the sweep for the full list). Fix, then make the zero-hit sweep a permanent test.
11. [ ] Wave F deploy and live probe (docked AI window pushes the page; three code names appear; restored admin shows both project groups).
12. [ ] **Final re-check table** (directive section 15) filled and pasted into the log. Zero open High items.

Wave F items already covered: [x] "the rest of the accessory families" (T-LUMP passes for all 49 trades).

---

## 5. OWNER QUESTIONS (directive section 2)

No recorded owner answers were found in the repo logs. All stated defaults are in force. Do not stop to ask;
log any answer the owner gives here and apply it.

- [ ] Q1 to Q4 gold scope, dark mode, light surfaces, dot rail labels: defaults in force
- [ ] Q5 rate book source status: **unresolved** (default). Keep the source line on screen and make no independence claim
- [ ] Q6 the three codes reading: default yes
- [ ] Q7 accessory prices: AI-proposed "starting value, edit it" (default). Owner review of those prices is still due
- [ ] Q8 statutory rates 3.0 / 3.0 / 3.5 / 3.0 marked "confirm": default in force, owner to confirm
- [ ] Q9 same-tab policy: default in force
- [ ] Q10 in-browser model spike: default (run the spike)
- [ ] Q11 "limited ... combat purchase": still unanswered, no task depends on it

---

## 6. HOUSEKEEPING AND CORRECTIONS LOG

- [x] `CONTINUATION-DIRECTIVE.md` "NEXT SESSION STARTING POINT" was STALE (it said "first task is MAT-1"). Refreshed
  2026-10-27 at HEAD `ee5ddfe`: Waves D and E closed, Wave F 1 of 6, verify baseline 145/145 unit tests and
  registry 137/137 at sw shell v486, and a STATUS LOG entry for GANTT-1 and GOLD-1. File is 39,665 bytes (cap 40,960).
- [x] Add a 2026-10-27 entry to `docs/history/log-2026-10.md` and rewrite `reflection.txt` (last session only) at the end of each session. Done for the Waves D+E exit: the log entry records the three CI-skipped defects and the W11 stale arm; `reflection.txt` is rewritten to this session with the verification list and the honest pending items (CI/deploy/probe).
- [x] `npm run verify` baseline was green on 2026-10-26 (registry 127/127, sw shell v477). Re-run on the
  current tree: **GREEN on `f258b3e`** - all 19 static gates pass, 145/145 unit tests, registry 135/135,
  `sw.js` at `mmgr-shell-v484`. Before the Prettier fix the same tree was RED (Prettier flagged
  `serve.cjs` and `worker.js`), which is why the uncommitted SW-8 work had never been verified.
- [ ] A second copy of the directive sits at `tmp/wt-baf/REFINEMENT-DIRECTIVE-2026-10-24.md` (byte-identical). Ignore it; the root copy is the one to edit.
- Corrections to this file go below, one line each, with date and reason:
  - 2026-10-27: GOLD-1's scoreboard row said the narrow-button gradient "needs a class". It does not. The
    measurement (T-GOLD ARM 3) showed the three-stop gradient fails AA on every label, so the two-stop form is now
    the default and there is no narrow-button case to special-case. Recorded in `docs/GOLD-AUDIT.md` section 7.
  - 2026-10-27: `docs/GOLD-AUDIT.md` section 6's stop-sampled 4.45:1 was optimistic. The real worst pixel under a
    label is 3.19-3.70:1. Section 7 supersedes it and keeps section 6 for the record.
  - 2026-10-27: **LAND-2 was ticked as done when the Pause control did not exist.** `431260c` shipped the spin and
    a `.hg-play` CSS rule, but no code created a button and nothing set `state.paused`; `qa-globe-spin` set the flag
    directly, so the gate measured the loop instead of the control the directive and WCAG 2.2.2 ask for. Fixed in
    `c2816a0`; the gate now clicks the real button and `qa-hero-globe`'s two stale arms (G5 "no Pause/Play button",
    G8 "cards stay untouched under reduced motion") are re-baselined to the current contract. Lesson: a gate that
    reaches past the UI to set state can pass while the UI does not exist.
  - 2026-10-27: **the fifteen T4 suites CI never reached were hiding two real app defects.** CI run `40621517883`
    failed at step 90 and skipped 91-106, so a green local `npm run verify` and a green `qa-full` said nothing about
    them. Running all fifteen (`tmp/run-t4.cjs`) found: an expiry due TODAY reported as OVERDUE (a date-only string
    compared to the current instant, so the band was one day off west of UTC - the dashboard said "was due today"
    and the watcher said "overdue"), and the calculator's setting hints at 3.84:1 because `.set-hint` was 82 percent
    opaque over white. Both are fixed and both have mutation proof. Lesson: when CI stops early, the remaining steps
    are UNVERIFIED, not passing - and a red suite is worth reading before it is re-baselined, because twice in this
    wave the "stale harness" assumption was wrong.
  - 2026-10-27: a mutation proof must rebuild. `css/mmgr.css` and `js/*.js` are not what the pages load - they load
    `dist/mmgr.min.css` and `dist/bundle.js` - so writing a mutation and running the gate proves nothing unless
    `node build.js` runs between them. The first W11 proof reported "MISSED" twice for exactly this reason and the
    gate was in fact correct; the proof was the thing that was broken.
  - 2026-10-27: the compliance badge and the expiry notice measured "N days out" two different ways (badge:
    now + N days, rollup: the current instant, both against a UTC-parsed date). They now share ONE helper, because
    two definitions of the same question is how a card and a notice end up disagreeing about one certificate.

  - 2026-10-27: **CI stopped early TWICE and each time the skipped steps were unverified, not passing.** Run
    `40621517883` died at step 90 (W11, a stale arm) and run `40625949216` at step 96 (`qa-calc-controls`, a
    fixed-delay race that read an animating track mid-flight). Neither was an app defect, but finding that out
    required a local reproduction each time - and the fifteen suites the first run skipped WERE hiding two real
    defects. Rule: when CI stops, reproduce the failing step locally, then run every step after it.
  - 2026-10-27: **a watcher that cannot find the run is worse than no watcher.** Both CI watchers compared
    `gh`'s full 40-character `headSha` with a 7-character short SHA, so they printed "no CI run yet" through two
    complete red runs. They now prefix-match. A silent watcher converts a red run into "still waiting".
  - 2026-10-27: a fixed delay in a gate that reads an ANIMATED property is a flake with a timer, and "two equal
    samples" is not "arrived": the Performance Mode track pauses for a couple of frames while the heavy effects
    re-mount, which fooled the first settle helper at 15 percent of the way back. Wait for the value the assertion
    names, bounded by a timeout.

**End of progress file.**
