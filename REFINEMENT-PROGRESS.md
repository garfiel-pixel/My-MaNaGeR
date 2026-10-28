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
| E (look, brand, materials) | 14 | 12 | 2 (GOLD-1, GANTT-1) | 0 |
| F (depth and structure) | 6 | 1 | 0 | 5 |
| **Total** | **32** | **25** | **2** | **5** |

Plain reading: Wave D is closed and Wave E has only its two harness-backed look tasks left. The five untouched
ones are all in Wave F and they are the biggest pieces (AI window rebuild, in-browser model spike, the three
admin codes). Task count is not effort: expect Wave F to take as long as D and E did together.

Cross-cutting still open: deploy and live probe for Waves D and E (none recorded), field-guide cards for
several Wave E features, two missing gate harnesses (T-GANTT, T-GOLD), stale session log.

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

- [~] **GOLD-1** tokens, shared `.btn-o` / `.btn-gold` block and `docs/GOLD-AUDIT.md` are done (`aa403f3` and earlier). STILL OPEN:
  - [ ] T-GOLD gate script. None exists. It must: list remaining orange hexes against an allow-list built from `docs/GOLD-AUDIT.md` (the directive's "zero hits" wording cannot pass because the audit deliberately leaves some); Playwright-check label contrast on every `.btn-o` and `.btn-gold` in light and dark (4.5:1 for 14 px text, 3:1 for 18 px bold); assert `.btn-g` still computes green; assert `--bullion*` values are identical in `css/mmgr.css` and `css/marketing.css`.
  - [ ] Directive 5.6 step 3: re-point text uses of the old gold on light surfaces to `--gold-text-on-light`. Not verified as done.
  - [ ] Narrow-button (under 96 px) two-stop gradient needs a class on the button to work. Implement with a class, or log as DEFERRED with this reason.
- [~] **GANTT-1** built: `ns.GanttView.build` (`js/mmgr-gantt-view.js`), `reduceLinks`, link policies including `gates` (default for exports), wide export dialog CSS, a Tidy checkbox in the export dialog (`project.html:1874`). STILL OPEN (state check each first, names may differ):
  - [ ] Tidy control on the Gantt toolbar (today it exists only inside the export dialog).
  - [ ] Group by Phase | Trade | Assignee, and sort within a group by start then WBS.
  - [ ] Time window: Whole project | Next 90 days | Custom, with automatic scale.
  - [ ] Phase gates and milestones drawn as distinct diamonds with a right-hand label.
  - [ ] Screen, PNG, SVG and PDF all drawn from `GanttView.build` (confirm no second code path).
  - [ ] T-GANTT harness. None exists. Bank-renovation fixture: exported row, span, link and milestone counts equal `build()`; `gates` link count under 25 percent of `all`; no link crosses more than 10 rows except critical ones; three formats list the same tasks.
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
- [ ] Tidy view and link policies (0 mentions found)
- [ ] "Prices changed" badge and Re-price (0 mentions found)
- [ ] Related items suggestions (0 mentions found)
- [ ] Quiet dot rail and globe Pause control (0 mentions found)
- [ ] AI `ASK` buttons and the new settings the assistant can set

Wave E exit: T-GOLD, T-ACC, T-LUMP, T-GANTT, T-GLOBE green, wording check green, contrast report attached, `npm run verify`.

---

## 4. NEXT UP (work strictly in this order)

1. [x] Resolve the uncommitted SW-8 work (see above). Commit. `f258b3e` - token swap proven
   value-neutral, the CSP fallback defect fixed with it, `npm run verify` green (145/145 unit tests,
   registry 135/135), `sw.js` bumped to `mmgr-shell-v484`.
2. [ ] Finish GANTT-1 (open items) and write T-GANTT. Add the harness to `docs/CI-TEST-COVERAGE.md` AND `ci.yml` (all three edits, per the starting-point rule).
3. [ ] Finish GOLD-1 (T-GOLD, text re-point, narrow-button decision).
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

- [ ] `CONTINUATION-DIRECTIVE.md` "NEXT SESSION STARTING POINT" is STALE. It still says "first task is MAT-1" and the status log says MAT-1, MAT-2, MAT-3, AI-3, GANTT-1, SW-8/12/14 were not started. Git shows MAT-1 to MAT-3, AI-3, GANTT-1 (partial), UI-4 and SW-12/14 landed on 2026-10-26 and 2026-10-27 (`d6f97eb` to `acf2462`). Update it and keep the file under 40,960 bytes (it is 37,611 now).
- [ ] Add a 2026-10-27 entry to `docs/history/log-2026-10.md` and rewrite `reflection.txt` (last session only) at the end of each session.
- [x] `npm run verify` baseline was green on 2026-10-26 (registry 127/127, sw shell v477). Re-run on the
  current tree: **GREEN on `f258b3e`** - all 19 static gates pass, 145/145 unit tests, registry 135/135,
  `sw.js` at `mmgr-shell-v484`. Before the Prettier fix the same tree was RED (Prettier flagged
  `serve.cjs` and `worker.js`), which is why the uncommitted SW-8 work had never been verified.
- [ ] A second copy of the directive sits at `tmp/wt-baf/REFINEMENT-DIRECTIVE-2026-10-24.md` (byte-identical). Ignore it; the root copy is the one to edit.
- Corrections to this file go below, one line each, with date and reason:
  - (none yet)

**End of progress file.**
