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
| F (depth and structure) | 6 | 1 | 0 | 5 |
| **Total** | **32** | **27** | **0** | **5** |

Plain reading: Waves D and E are both closed - every look, brand and materials task is done and harness-backed. The
five untouched ones are all in Wave F and they are the biggest pieces (AI window rebuild, in-browser model spike,
the three admin codes). Task count is not effort: expect Wave F to take as long as D and E did together.

Cross-cutting still open: deploy and live probe for Waves D and E (none recorded), field-guide cards for several
Wave E features, stale session log.

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

Small checks left from Wave D (do these inside section 4, step 3):
- [ ] [VERIFY] `calculator.html:74` `perf-tgl` is a bare checkbox with class `bcp-perf-in`. Confirm T-ROWS allows it or wrap it in `.tgl`.
- [ ] [VERIFY] APP-1 on `project.html` (`#app-sidebar`, `body.sidebar-on`): closed state does not overlap content.
- [ ] [VERIFY] Sweep SW-13 still lists 14 "card with no watcher" items (including `project.html` expiry card). `watchExpiries` exists, so most are probably heuristic false positives. Read each, fix the heuristic or the gap.
- [ ] Regenerate `docs/SWEEP-2026-10.md` with `node tools/sweep/sweep.cjs --write`. The committed copy is old (it still shows SW-1 at 29 hits; a fresh run shows 0).

---

## 3. WAVE E

- [x] **UI-4** calculator bar mirrors the app bar. `c53657c`. Parity check lives in `qa-calc-controls` ("UI-4 bar parity").
- [x] **Rate book rebrand** `3a3b55c`. Name, brand mark, one `rateBookNotice()`, source line kept while provenance is unresolved. `verify-ratebook-wording` 12/12.
- [x] **MAT-1** itemised materials. `d6f97eb`. `verify-calc-lump` passes: 49 trades, 35 itemised, 14 with a written reason. T-ACC in `tools/qa-mat-items.cjs`, wired in `ci.yml`.
- [x] **MAT-2** related trades and materials. `a3b7aae`. `tools/qa-related-items.cjs`, wired in `ci.yml`.
- [x] **MAT-3** price-change stamp and badge (`rateSig`, `pricedAt`, "Re-price this line"). `a3b7aae`. Harness: `tools/qa-calc-prices-changed.cjs`.
- [x] **AI-3** assistant reaches every field and asks. `e59aeeb`. `verify-settings-reach` passes (11 keys); `ASK:` line parsed in `js/calc-ai.js`.
- [x] **LAND-1** ghost dot rail. `431260c`. `qa-dot-rail` 15/15 (logged).
- [x] **LAND-2** continuous globe plus Pause control. `431260c`. `qa-globe-spin` 7/7 (logged).
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

Field-guide cards (locked rule 8). Check each exists in `mymanager-field-guide.html`, add what is missing:
- [ ] Itemised materials (1 mention found; confirm it covers accessory lines and the switch)
- [ ] Tidy view and link policies (0 mentions found) - now also the Group and Window controls
- [ ] "Prices changed" badge and Re-price (0 mentions found)
- [ ] Related items suggestions (0 mentions found)
- [ ] Quiet dot rail and globe Pause control (0 mentions found)
- [ ] AI `ASK` buttons and the new settings the assistant can set

Wave E exit: T-GOLD, T-ACC, T-LUMP, T-GANTT, T-GLOBE green, wording check green, contrast report attached, `npm run verify`.
Status: all five gates are green and wired, and the contrast report is `docs/GOLD-AUDIT.md` sections 6 and 7
(the measurements, the three decisions, the 14 remaining oranges with reasons). Wave E is closed on its own
terms; what is left for Wave E is the field-guide cards below and the shared deploy/live probe.

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
4. [ ] Field-guide cards listed above.
5. [ ] Wave D small checks listed in section 2.
6. [ ] End of Waves D and E: `npm run verify`, full `qa-*` battery, CI green, commit, deploy from `$HOME/mmgr-deploy`, live probe. Probe list: old PDF path returns 404; `/api/ratebook` returns 401 signed out; every Export Schedule option changes and downloads; Work item list readable in dark; admin to dashboard leaves one tab; Performance Mode on the calculator stops the background; buttons gold with readable labels in both modes; drywall shows its accessory lines.
7. [ ] **AI-1** AI window layout, docking (docked at 1280 and up, overlay 1024 to 1279, sheet under 1024), Maximise, Float, Pin, `Ctrl+.`, history in project state. Directive section 9. Gate T-AIWIN. Flag `aiDock` already exists in `js/mmgr-state.js` but nothing reads it yet.
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
- [ ] Add a 2026-10-27 entry to `docs/history/log-2026-10.md` and rewrite `reflection.txt` (last session only) at the end of each session.
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

**End of progress file.**
