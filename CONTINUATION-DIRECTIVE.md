# My MaNaGeR - Continuation Directive (active, small)

**Read order for every session:** this file first, then the newest `AUDIT-DIRECTIVE-*.md`
(now `AUDIT-DIRECTIVE-2026-10-18.md`) for the full work order. Do NOT open `docs/history/`
unless a task cites it: the full history lives in
`docs/history/CONTINUATION-DIRECTIVE-ARCHIVE-2026-10-18.md`, old status-log entries in
`docs/history/log-YYYY-MM.md`, old reflections in `docs/history/reflection-ARCHIVE-2026-10-18.txt`.

**Size law (gate T8, `tools/verify-doc-size.cjs`):** this file, `AGENTS.md` and `CLAUDE.md`
must stay at or under 40,960 bytes. New status entries go to `docs/history/log-YYYY-MM.md`;
this file keeps only the newest entries and a one-line rollup of the rest. If the "newest
entries" and the byte cap ever conflict, the byte cap wins (recorded in the log 2026-10-18).

---

## LOCKED RULES (owner standing rules, non-negotiable; full set incl. N1-N10 in the audit file)

1. No emoji on any served page or JS string. SVG sprite icons only (`css/mmgr-icons.svg`).
2. No em dash (U+2014) and no en dash (U+2013) in any served copy. Commas, periods, "to".
3. Plain language on user faces. Labels, not paragraphs.
4. Consistency by reference: find the sibling already in the app and match it.
5. Gold is the brand accent (call it gold, not orange).
6. Liquid Glass hierarchy: glass for the functional layer only, never glass on glass; respect
   `prefers-reduced-motion` and `prefers-reduced-transparency`.
7. Commits are plain Conventional Commits. No AI attribution ever (enforced by the
   `.githooks/commit-msg` hook). Subject <= 72 chars, imperative, no emoji.
8. Every new feature ships its `mymanager-field-guide.html` entry in the SAME change.
9. `reflection.txt` is rewritten at the end of every session (specific: files, line numbers,
   verification results).
10. This file gets a STATUS LOG entry after every completed project; full entries go to
    `docs/history/log-YYYY-MM.md`.
11. Never create a review zip unless the owner asks.
12. Paddle keys and secrets are assumed set; never touch secrets.
13. Deploy only from a clean staging copy under `$HOME/mmgr-deploy` (never `/tmp`, never the
    repo root). Live probes use `https://mymanagerworkspace.com` only.
14. The owner removed pinned Calculate / Add to bill buttons (2026-10-13). Never re-pin them.
15. Part H decisions stand: Procurement ships behind `data-pack="procurement"`; `proc` is a
    grantable editor scope; namespace `ns.Proc`; state key `supplierBook`; supplier prices are
    hand-entered from each supplier's own rates, never from the JIC book.
16. OST offline-first is sacred: the app works with no network; cloud sync stays opt-in per
    project.
17. `npm run verify` (CSP + SW + all sub-checks) before every deploy; `node build.js` after any
    `js/` edit (stale `dist/bundle.js` is the #1 silent killer); bump the `sw.js` shell version
    when served files change and restart `serve.cjs` after inline-script edits.
18. `skills-lock.json` is the source of truth for skills; never hand-edit hashes.

## OPEN WORK REGISTRY (state as of 2026-10-18)

| Item | Status | Where |
|---|---|---|
| AUDIT SPRINT 1 (correct numbers, safe codes, readable plan) | IN PROGRESS - this session | `AUDIT-DIRECTIVE-2026-10-18.md` sections 4, 8.1, 10 |
| AUDIT SPRINT 2 (exports, Gantt, UX, performance, Procurement core) | NOT STARTED - blocked on S1 exit gates | audit section 9 |
| AUDIT SPRINT 3 (Gantt formats, Procurement P5-P10, consent, hardening) | NOT STARTED - blocked on S2 | audit sections 8.2, 9 |
| PART H Procurement (H5.5 to H5.12, H8.3-H8.5) | MID-BUILD, UNCOMMITTED (20 modified + 2 new files in working tree at session start; "do not commit until H5.11 gates green") | archive PART H section; becomes audit task P1 in S2 |
| PART I Phase 3 (purpose-built measuring forms) | PARKED by owner decision (D1, 2026-10-17) | archive, D1 block |
| Dashboard F1 budget actual double-system finding | OPEN suggestion, owner go-ahead needed | archive 2026-09-28 feature-gap entry |
| Matt Pocock skills install (audit section 12) | NOT STARTED (optional; skip if no network) | audit section 12 |

## NEXT SESSION STARTING POINT (max 15 lines)

1. Read this file, then `AUDIT-DIRECTIVE-2026-10-18.md`. Execute SPRINT 1 in order.
2. Run `npm run verify` first; baseline 2026-10-18: everything green except `verify:sw`
   (four HTML files newer than sw.js v433; bump at sprint exit, rule N8).
3. Working tree at sprint start: 20 modified + 2 untracked files = Part H mid-build; finish or
   commit them before touching Procurement (audit task P1).
4. Tripwires T1-T8 are the gates: `tools/verify-{units,exports,currency,print-dom,
   no-weak-random,gantt-export,doc-size}.cjs` + `tools/qa-inp.cjs`.
5. Kill-switch flags go in `js/mmgr-state.js` flags block before each risky change (audit 11).
6. Every C, G, S, X task ends with its GATE output pasted into the sprint log entry.
7. Commits: plain Conventional Commits, small, per task. No AI attribution, no emoji.
8. Deploy only from `$HOME/mmgr-deploy` after CI is green; live-probe `mymanagerworkspace.com`.
9. Rewrite `reflection.txt` (last session only) and add `docs/history/log-2026-10.md` at end.

## STATUS LOG (newest entries kept here; full history in `docs/history/log-YYYY-MM.md`)

Newest verbatim entries kept: 2026-10-16 (x2), 2026-10-17 (x3). One-line rollup of the next
older entries (full text in `docs/history/log-2026-10.md` / `log-2026-09.md`):
- 2026-10-13: in-chat hero tweak confirmation, documentation only, no commit/deploy.
- 2026-10-07: marketing dot-rail + full-bleed layout rework (uncommitted at the time).
- 2026-10-04: Controls terminal card + AI-credit commit-msg gate + 643-commit history rewrite
  (shipped v356).
- 2026-09-28 (x3): calculator redesign wave (uncommitted), feature-gap audit (suggestions),
  kanban/gantt/geo defect wave (v328) plus rate-freedom and F4 calculator waves.
- Before that: 210 entries archived under `docs/history/log-2026-08.md` and `log-2026-09.md`.
**2026-10-16 — Session: PROMO SIDE NOTE SHIPPED, TURNSTILE P0 FIXED, DARK-MODE A11Y REPAIR, PROCUREMENT PLAN (PART H).** Four things landed, in the order they were found:
1. **Reviews Turnstile was live and broken for every visitor (P0).** The bot gate was armed with a secret, but `js/reviews.js` guarded on the capital-T global `Turnstile` while Cloudflare only exposes lowercase `turnstile`, so `initTurnstile()` returned early every time and the widget rendered nothing (measured live: `divChildren: 0`, box 0x0, while a manual `turnstile.render()` in the same page succeeded). Fixed to read `window.turnstile`; verified live with a real headed browser issuing a 730-char token. Shell bumped to v423.
2. **Launch-offer side note on pricing.html** (owner copy): `50% off your first 18 billing cycles, code 5JBXWUGZ8L at checkout`. Display only — no billing, pricing, checkout or backend change, and the code is not wired into the Paddle call. `.promo-note` / `.promo-code` in `css/marketing.css`, token-driven, `user-select:all` so one tap copies it on a phone.
3. **CI failed on that note (T4 axe gate) and it was my note.** `.promo-code` put 13px bold `--gold-deep` (#a84a15) on the chip's gold tint, measured **4.09:1** against the 4.5:1 floor. Glyphs are now `--text-primary` (12.68:1 light, 9.69:1 dark measured in a real browser); the gold identity stays in the border and tint. v425.
4. **The darker finding: dark mode was never being measured on marketing pages.** `qa-a11y-axe` labelled a run `[dark]` without checking that dark mode had engaged. No marketing page can become dark at all — none loads `mmgr-theme.js`, none has app/admin's inline FOUC script, `marketing.js` has no theme logic and `marketing.css` has no `prefers-color-scheme` block, so its whole `body.dark-mode` block is dormant. Every marketing `[dark]` row was the light page measured a second time (heading-order was being counted twice: 42 nodes before, 21 after). The gate now reads `body.dark-mode` after load, skips passes where dark cannot engage, fails a page that ignores `mmgr_theme=light`, and pins the light-only set in `LIGHT_ONLY`. It immediately caught a real discrepancy: `seed-test.html` is a redirect stub into `project.html` and inherits its palette, so it is deliberately NOT light-only. Fixing dark properly exposed 24 serious failures — the pricing comparison table's green checkmarks at 3.32:1 — now one token, `--status-success: #2fbd74` in `body.dark-mode` (7.40:1 on the canvas, 6.68:1 on the card). v426.
5. **Procurement plan written as PART H** (planning only, no code): a Procurement tab with a supplier drop-down of items and minimum prices, plus an AI quote panel that indexes that data and writes an email-ready quote on the existing Gemini relay. H1 records the measured wiring with file:line so the next session does not re-derive it.

WHAT THIS SESSION TOUCHED
- `js/reviews.js` — Turnstile guard reads `window.turnstile`.
- `pricing.html` — launch-offer side note.
- `css/marketing.css` — `.promo-note`, `.promo-code`, dark `--status-success`.
- `sw.js` — v423, v424, v425, v426.
- `tools/qa-a11y-axe.cjs` — honest dark-mode measurement + `LIGHT_ONLY` gate.
- `CONTINUATION-DIRECTIVE.md` — PART H (Procurement plan) + this record.

VERIFICATION RUN THIS SESSION
- `npm run verify` green after every change; `tools/qa-a11y-axe.cjs` 7/7 with `colour-contrast` absent from the rule list entirely.
- Live-site probes in a real browser (CDP + Playwright): Turnstile widget 623x72 and issuing tokens; promo chip contrast measured 12.68:1 light and 9.69:1 dark against the actual composited background; zero serious/critical axe violations live.
- `qa-marketing.cjs` 20/20 including `mkt-10 reviews.html zero console errors`.
- An unregistered-harness check on the reviews module: `tools/qa-reviews.cjs` is the cloud review-queue gate, not the public form; `qa-marketing` is the gate that covers `reviews.html`.

NEXT SESSION STARTING POINT
- PART H is the live work item: ordered steps in H5, acceptance criteria in H4, and H6 lists the hard constraints not to violate.
- Standing caution carried forward from this session: a gate that reports a state it did not actually produce is worse than no gate. When a harness labels a condition (`[dark]`, "signed in", "configured"), assert that condition in the browser before trusting the label.

**2026-10-16 — Session (continued): CALCULATOR FAMILY-FILTER FIX SHIPPED (f2ce6be, live-verified), RATE-COVERAGE PLAN (PART I).** Owner asked whether the 811-rate book has a calculator for each rate and why welding was unfindable "under the trades". The audit (all numbers in PART I0) answered the question and exposed one real defect, which was then reproduced in a real browser BEFORE fixing and re-verified after:

1. **The defect:** `#calc-family` ("Type of work") offered only 6 of the 8 families `FAMILY_META`/`WORK_FAMILY` define - `temporary-metal` and `joinery` had no `<option>`. A stored family therefore hid the scaffolding/welding and joinery optgroups with no way to show them short of All trades, and a recall that selected weld/scaffold while a family was stored stranded the select on a blank value (`syncFamily` writes a value no option matches - `fSel.selectedIndex === -1` with the view locked to one group). Root cause confirmed by the design comment itself (W2.5: families were designed as "six trades"; the JIC wave added the metadata but never the options).
2. **Reproduced first, as ordered:** `tmp/repro-family-bug.cjs pre` = 4/4 in headless Chrome against serve.cjs (missing options; any stored family hides the welding group; the stranded blank-select chain; the locked single-group view). One harness lesson en route: the first P2 assertion was over-constrained - boot-time `syncFamily` flips a stored family to the persisted work item's own family, so the honest claim is "one non-JIC group shows", which held.
3. **Fix:** two `<option>` elements in `calculator.html` with verbatim FAMILY_META labels (the FM gates and the new post-gate assert them). `sw.js` -> v427 (shell page). `node build.js` clean.
4. **Verified:** `tmp/repro-family-bug.cjs post` 5/5 (options exist with correct labels; filter behavior unchanged; selecting Temporary-and-metal-works works and shows its label; the recall chain now leaves the select SHOWING its family; All trades restores all 9 groups); `npm run verify` green; `qa-calculator-page` 228/228 (FM1-FM5 intact); `qa-calc-trade-coverage` 88/88 across 43 trades both viewports, zero page errors.
5. **Shipped:** commit `f2ce6be` (Conventional, no AI footer), pushed, CI full-suite SUCCESS (run 38897994087), deployed via `node tools/deploy.cjs` (version 7288e73a). Live proof: `/calculator` byte-identical to local (sha256 49bcd793...), both options present with exact labels, live `sw.js` = v427 and byte-identical. Live-check lesson re-learned: production 307-redirects `.html` URLs (curl needs -L; lesson 4).
6. **PART I added** (planning only, no code): the full rate-coverage plan - measured baseline, Option A ("Use this rate" row action feeding the existing custom-item path - recommended, converts all 711 browse-only rows with zero new money math) vs rejected Option B (711 hand-wired variants) vs phase-2 Option C (generic JIC picker reusing RATE_UNITS), drawbacks (book truthiness: #100 caps, duplicate items at two rates, 'C'-basis conversions, "Welding" rows are cutting), acceptance criteria, ordered steps, and what NOT to do.

WHAT THIS SESSION TOUCHED
- `calculator.html` - two family `<option>` elements + explanatory comment.
- `sw.js` - v426 -> v427.
- `CONTINUATION-DIRECTIVE.md` - PART I (rate-coverage plan) + this record.
- `tmp/repro-family-bug.cjs` - pre/post browser gate (gitignored scratch; promote to tools/ if the family filter is touched again).

NEXT SESSION STARTING POINT
- PART I is the live work item (phases in I2, steps in I5, constraints in I6). PART H (Procurement) remains the other queued plan - both are independent and either can start first.

**2026-10-17 — Session: WELDING UNITS MONEY FIX + AI RATE GROUNDING SHIPPED (e158134 + c6b25a1, CI green, deployed v9ff0ac33, live-verified), PART H REVIEW (H7), DOMAIN RECORDED.** Owner asked that the assistant stop answering calculator/rate questions with "I don't have access", then the full ship order: local QA, CI green, deploy. Two real defects were found by probing the shipped app, fixed, gated, and shipped:

1. **Welding money bug (fixed).** The synthetic JIC book published welding's per-100mm figure against an INCH quantity with no RATE_UNITS adapter (rf fell through to 1) and the imperial ft->m default rewrote the typed inches: 100 in priced J$19,800 metric / J$6,035 imperial instead of the book's own J$50/in. Fix in `js/calculator-page.js`: per-100mm rows now publish the per-inch pair (`{ allIn: r.impRate, unit: 'in' }`) and `IMP_D1_FACTOR.welding = 1`. Both modes now price 100 x J$50 = J$5,000 materials (+ the JIC row's own 0.75 day x J$400 labour where present) - identical either way. Reproduced in a real browser BEFORE the fix, re-verified in a real browser on the live site AFTER (metric and imperial byte-identical, quantity label stays "100 in").
2. **AI grounding fix (fixed).** The assistant already ranks the full 811-rate book via `MMGR_CALC_RATEBOOK`, but "cement" matched ZERO rows - the commonest word on a Jamaican site - so it answered "the rate book is silent". `RATE_QUERY_EXPAND` (query-side only, same stemmer/ranker; popup search stays exact) now widens cement->concrete/mortar/block/mix plus dump/haul/debris, worker, wire, plumbing, toilet, kitchen, fence, scaffold. Verified end-to-end ("cement" -> 12 concrete/mortar/block rows).
3. **CI red -> green loop (one cycle).** First run failed at `qa-calc-assistant` N2: the speculative `excavation -> [excavate, earth, trench]` key fired on "rate for excavation in stiff clay" and let the generic clay-shallow row outrank the exact stiff-clay row. Root cause fixed (key removed - "excavation" already reached the book without it), not re-baselined. Run 38989606512 on c6b25a1 = SUCCESS.
4. **Harness work.** New WU family in `tools/qa-calculator-page.cjs`: WU1 per-inch payload rows (J$50/in #1, J$117/in #7, metric rows keep pairs), WU2/WU3 identical money both unit modes with exact-figure pins, WU4 assistant "cement" grounding e2e (WU-DUMP logs the money composition every run). Fixed two PRE-EXISTING bare-return evals (`window.__MMGR_RR_AUTH = 'in'; return true;` - "Illegal return statement" parse errors meant the RB auth seam NEVER actually set; the RB family passed only because the dev server fails open) and the WU4 eval's uncalled-IIFE bug.
5. **PART H reviewed (planning only).** Owner asked for improvements before any build - written as **H7** (eight items): reuse qa-calc-assistant's proven mockRelay harness + the "every number exists in source" gate for the quote (H7.2), name the new XSS surface + gate it (H7.3), CSV out/in (H7.4), cross-vendor compare on the PM-entered lines (H7.5), validation specifics (H7.6), the two owner decisions (pack toggle, editor scope - H7.7), production domain for live probes (H7.8). **Owner correction, same day:** H7.1's first draft wrongly proposed prefilling supplier items from the JIC rate book - rejected. Supplier lines are entered BY HAND from each supplier's OWN rates (PM types the supplier's quote/rate-sheet figures; the JIC book never touches the supplier tab). H7.1 rewritten, constraint added to H6.
6. **Owner questions answered:** "PART I" is a LETTER (the 9th sequential plan in this file: A... H, I) - not "part one"; there is no Part II. It is the rate-coverage plan, planning-only, Phase 1 ready to build per I5. Domain confirmed: **mymanagerworkspace.com** is production (verified live serving this deploy; canonical/og:url/sitemap already carry it). `mymanager.app` is an unrelated third-party site - never probe it.

FILES MODIFIED (committed + deployed):
- `js/calculator-page.js` - welding per-inch payload + IMP_D1_FACTOR.welding=1 + RATE_QUERY_EXPAND/rateExpandQuery wired into calcRateBookText's token path (excavation key removed after CI).
- `tools/qa-calculator-page.cjs` - WU family + two bare-return eval fixes + WU4 IIFE fix.
- `sw.js` - CACHE mmgr-shell-v427 -> v428 (feature) -> v429 (prettier) -> v430 (CI fix); deployed version carries v430.
- `CONTINUATION-DIRECTIVE.md` - H7 + this record.
- `reflection.txt` - this session's record (carries the uncommitted 2026-10-13 entry from a prior session - left as the owner's call to commit it).

TEST RESULTS:
- Local: `npm run verify` exit 0 (CSP, SW cache, CSS integrity, emoji, a11y, eslint, prettier, registry); `qa-calculator-page` exit 0 incl. WU1-WU4; `qa-calc-trade-coverage` 88/88 (43 trades x 2 viewports); `qa-calc-assistant` exit 0 after the N2 fix.
- CI: run 38989606512 on c6b25a1 = SUCCESS (after one red->fix->push->re-poll cycle per lesson 8).
- Deploy: `node tools/deploy.cjs` exit 0 from the clean staging copy (byte-proved), worker version 9ff0ac33, sw mmgr-shell-v430.
- Live: real headless browser on the deployed calculator -> 100 in JIC Welding #1 = J$5,000 subtotal + 15% tax = J$5,750, identical metric AND imperial; live js/calculator-page.js carries RATE_QUERY_EXPAND (2), welding:1, the 100mm ternary, cement mapping, and NOT the excavation key; live sw.js = v430.

WHAT STILL OPEN:
- PART I Phase 1 (Use this rate) + Phase 2 (generic JIC picker) - BOTH SHIPPED 2026-10-17 (b4f5763 / 822ffb5, live-verified). Only Phase 3 remains: owner-selected variant expansion (Option B selectively, on owner request).
- PART H Procurement - still planned-only; H7 folds into it; the two H7.7 owner decisions (pack toggle vs always-visible, grantable scope vs owner-only) are the only blockers before markup.
- `reflection.txt` carries a prior session's uncommitted 2026-10-13 record (owner's call).

NEXT SESSION STARTING POINT
- **PART I Phase 1 is SHIPPED** (Use this rate, commit b4f5763, live-verified). Queued next, either independent: **PART I Phase 2** (generic JIC picker, I2) or **PART H Procurement** (build per H5 with H7 folded in - NOTE H7.1 was CORRECTED 2026-10-17: supplier lines are hand-entered from each supplier's OWN rates, the rate book never touches the supplier tab; decide H7.7 first). Live probes against https://mymanagerworkspace.com.

**2026-10-17 — Session (continued): H7.1 CORRECTED (owner rejection, 263ab9a), PART I PHASE 1 SHIPPED (b4f5763, CI green, deployed 621e3169, live-verified).** Two things, in order:

1. **H7.1 corrected per owner.** The first draft proposed prefilling supplier items from the JIC rate book - wrong, and the owner said so: the rate book has no supplier data; suppliers price at their OWN rates. H7.1 now states the owner's workflow verbatim (supplier -> dropdown -> Add -> what THEY offer, each line with its lowest-quantity price, entered BY HAND by the PM from the supplier's own quote or rate sheet, staying until updated); H6 gained "the JIC book never prefills, suggests or validates a supplier line"; both session records corrected. Commit `263ab9a`, CI green.
2. **PART I Phase 1 shipped** (owner: "Part I is good... go forward on that"). The "Use this rate" row action (I1 Option A): every one of the 811 rate-book rows carries an SVG action that prefills Custom (ref-first name <=60, the DISPLAYED unit system's unit + rate, quantity cleared), closes the popup and focuses the quantity; pricing reuses the custom path (qty x rate EXACT, normal on-costs + tax) and the ref rides workName() onto the bill/CSV/history. All 711 browse-only rows are priceable with zero new money math. Ordered I5 steps executed exactly (skills loaded, dispatch convention kept, build.js ran + dist/mmgr.min.css verified carrying the new rules, calculator.html cache-busters v38/v30, sw mmgr-shell-v431, verify green, new gates, CI watched to success, deployed from the staging copy, live re-probe).

**Gates:** new UR family (UR0-UR6) in `tools/qa-calculator-page.cjs` - structure (811 Use buttons, Ref/Description/Unit/Rate/Use header), prefill self-computing against the row's own cells, exact money in BOTH book unit systems (5x198=990 metric, 5x50=250 imperial), the ref on the landed bill line, and OFFLINE: jic-rates-full.js blocked at the network layer (calculator.html registers no SW - verified) leaves the inline 100-row fallback fully actionable. Two data-checked gotchas are recorded in the entry: full book vs inline word welding #1 differently (query pinned to full-book wording), and the family's saved trade lives in localStorage because UR6 reloads (a window var died with the reload and left U1 staring at a Custom form - caught, not worked around). Local: `npm run verify` exit 0, qa-calculator-page exit 0, trade-coverage 88/88. CI `38998747412` SUCCESS.

**Live (mymanagerworkspace.com, version 621e3169):** bytes carry ?v=38/?v=30/sw v431/rrUseRate/rr-use-btn; signed-out book gate INTACT (sign-in card, 0 rows); with the QA seam a real browser did the full flow - 811 rates, search -> one hit, Welding #1 (J$198.00 per 100mm shown) -> Use -> exact prefill -> quantity 5 -> Run -> **Subtotal J$990 = 5 x 198** -> zero page errors. PASS (`tmp/live-use-rate.cjs`).

**Files:** `js/calculator-page.js`, `css/mmgr.css`, `calculator.html`, `sw.js`, `tools/qa-calculator-page.cjs`, `dist/mmgr.min.css` (rebuilt, gitignored), `CONTINUATION-DIRECTIVE.md`, `reflection.txt`.

NEXT SESSION STARTING POINT
- **PART I Phase 1 is DONE.** Queued, independent, planning-complete: **PART I Phase 2** (generic JIC picker, I2) or **PART H Procurement** (H5 + H7 with H7.1 corrected; decide H7.7 first). Live probes against https://mymanagerworkspace.com.

**2026-10-17 — Session (continued): PART I PHASE 2 SHIPPED (822ffb5, CI green, deployed af33909c, live-verified).** The generic JIC picker (I1 Option C): one new work item "JIC rate book" under Other prices ANY shipped book row as a first-class estimate line — pick a trade (the 11 book trades, each with its row count), pick a rate (the option text = ref, description, unit, rate, plus the book's own honesty notes such as "cutting and smoothing, not welding" and the "our conversion" marker on the converted side), type the quantity in the ROW'S OWN unit so quantity x rate is exact (the RATE_UNITS adapter resolves to its identity; zero new money math; the normal on-costs, overhead and tax follow). Design/lessons:
- The pick resolves from PURE state (tid+ref over a memoized index per book source), so computeFor prices a recalled snapshot from the pick it was saved with, and a `_jicRecall` hold stops applyState's re-render from re-seeding the rate from the book — a recall re-creates its exact sum even if the book changed underneath.
- The rate field carries the dataset.model book marker (the D4 contract): the CSV says "JIC rate book" while the figure is untouched and "(your rate)" once edited; the published-rate note follows the same marker.
- workName names the line ref-first ("Welding #1 - Handle Mark Cut & Sand Smooth…") so bill/history/CSV carry the JIC ref; the ONE HTML insert of matDesc now escapes it (the book writes with ampersands) while the CSV takes the raw string — escape at the insert, never in the data.
- dimSlips skips jic: the row's unit governs the quantity box, so the metre/length bands would flag honest quantities as unit mistakes.
- The picker carries the book's own sign-in gate (owner 2026-10-13): signed out online the pick reverts and the SAME sign-in card appears; offline or with an unverifiable answer it opens. LIVE-probe subtlety: without a pinned QA seam the rejection is ASYNC (the /api/auth/me probe) — act and read must be split with a settle delay, or a late reject clobbers the flow started after it (it did, first probe run).
- The assistant dry-run MMGR_CALC_CHECK names the missing pick ("a trade and a rate in the JIC picker") instead of failing bare — the B1 walker caught that.
- The full book loads at most once per page life (`_jicTried`); after a failed load the picker's hint says "showing the built-in set" and the inline 100 rows (all 11 trades, 9-10 rows each) keep everything usable offline.

**Gates:** new JP0-JP7 family in `tools/qa-calculator-page.cjs` — structure/open, sign-in-gate revert, seed+note+unit label, the I2 exit gate (11-trade walker: every trade prices 3 x its displayed first rate EXACTLY with zero mat/lab and normal tax, the expected rate parsed from the SHOWN option text so the gate measures what a user reads), bill + CSV ref on welding, imperial-display exactness, typed-rate + snapshot recall, and OFFLINE (network-blocked full book → inline set + honest hint). Re-baselines: FM5 keeps asserting 43 trades with the 45th option (jic) excluded; both trade-coverage walkers and the assistant T4/B1 walkers exclude the non-trade option. HARNESS GOTCHA (cost an hour): regexes inside harness template literals need DOUBLE backslashes in the file — a single backslash is silently eaten by the template-literal unescape (no syntax error, the regex just never matches). Also: a gate assertion had a double negative (`!wrap.hidden` read false when correctly hidden) — instrument the fail message with every clause value before theorizing (that is what pinpointed both).

Local: `npm run verify` 117/117, qa-calculator-page **247/247**, trade-coverage **88/88**, qa-calc-assistant **105/105**, prettier clean, emoji scan clean on served files. CI run `39044280704` SUCCESS.

**Live (mymanagerworkspace.com, version af33909c):** bytes carry the option/wrap/selects, `calculator-page.js?v=39` (13 picker symbols), sw v432; real-browser probe `tmp/live-jic-picker.cjs`: signed-out picker gate INTACT (pick reverts to siteprep + sign-in card); with the QA seam — 11 trades, welding 100 rows (full book), Welding #1 seeded at J$198 with the note and the "Quantity (100mm)" label → quantity 5 → Run → **Subtotal J$990 = 5 x 198 exact** → bill line and CSV both carry "Welding #1 - Handle Mark Cut & Sand Smooth: 1/8\" Thick Metal Using Torch" → snapshot roundtrip re-creates 990 → zero page errors. PASS.

**Files:** `js/calculator-page.js`, `calculator.html` (option + picker wrap + buster v39), `sw.js` (v432), `tools/qa-calculator-page.cjs`, `tools/qa-calc-trade-coverage.cjs`, `tools/qa-calc-assistant.cjs`, `CONTINUATION-DIRECTIVE.md`, `reflection.txt`. No CSS changes were needed (the picker rides the existing `.bcp-field` select/input rules); CSP untouched (zero inline scripts).

NEXT SESSION STARTING POINT
- **PART I Phases 1 AND 2 are DONE.** Only Phase 3 remains (owner-selected variant expansion, Option B selectively — on owner request only). Queued next: **PART H Procurement** (build per H5 with H7 folded in — H7.1 corrected; decide H7.7 first: pack toggle vs always-visible, grantable scope vs owner-only). Live probes against https://mymanagerworkspace.com.

---

## DECISIONS NEEDED FROM THE OWNER (2026-10-17, end of the Phase 2 session)

Written so the next session executes the moment the answers arrive - no
re-derivation. Both blocks are plain-language on purpose (plain-language-copy
law). Until marked DECIDED, treat them as OPEN.

### D1. PART I Phase 3 (the variant expansion) - what it is and what it would take

**In plain words:** Phases 1 and 2 let you price ANY of the 811 book rows, but
you type the quantity yourself in both. Phase 3 is the third way: hand-pick
specific book rates and bake them INTO a calculator as named "versions" - the
way the block-wall calculator already offers block sizes or the pipe calculator
offers diameters - so the quantity is DERIVED from measurements (length x
height, count, etc.) and the rate arrives as a dropdown choice with the book
figure prefilled.

**What it entails once triggered:**
1. The owner names a shortlist (trade + row numbers, e.g. "welding CPSAW #10-13"
   or specific masonry sizes). Nothing else is needed from the owner.
2. Add `variants` entries to the matching WORK items carrying THE BOOK'S
   PUBLISHED NUMBERS ONLY (never invented figures); the prefill stays the
   user's to edit (the book is a default, never a lock - D4).
3. The variant dropdown, prefill wiring and unit handling already exist (the
   E2 engine), so this is mostly data work.
4. Gates: re-baseline the variant-count assertions (V-family), add one exactness
   gate per new variant (measured quantity x book rate, exact), and keep the
   book-vs-variant numbers provably the same source.

**Why it is owner-request-only (the plan's own reasoning):** Option B was
rejected as the GENERAL strategy - ~711 hand-copied entries would drift every
time the book is republished, and variant pickers become 100-row scrollbars.
Phase 1+2 already cover every row, so Phase 3 is only worth it where MEASURING
BEATS TYPING for a row you price constantly. Trigger it by naming rows;
sequencing choice asked in chat (before or after PART H).

### D2. H7.7 - the two decisions that block PART H markup (H7.7 verbatim: "make them before markup")

**(a) Where the Procurement tab lives: pack toggle vs always-visible.**
- Option A (recommended in H7.7): `data-pack="procurement"` - ships HIDDEN
  behind the existing packs toggle; the rail already carries 20 tabs, and packs
  are the existing show/hide mechanism (data-pack is read at
  js/mmgr-app.js:3755). Users turn on the Procurement pack to see the tab.
  One attribute; the tab appears/disappears with the pack.
- Option B: always visible as the 21st tab, for every project and user,
  immediately. No pack step, but a busier rail and no way to hide it.

**(b) Who may edit it: grantable editor scope vs owner-only.**
- Option A: `proc` is a GRANTABLE editor scope - an editor code can be given
  Procurement ALONE, so the officer doing the buying can maintain vendors and
  prices without full owner rights. Matches the owner's own H0 wording
  ("maintained by whoever does the procuring"). Entails: proc joins the
  editor-code section scope list (server + the scope UI).
- Option B: OWNER-ONLY edits - editors and viewers see the tab read-only via
  the existing view-only path. No new scope wiring; simplest.

**On the answer:** record the choices here marked DECIDED with the date, fold
them into H7.7/H5 step 4 wording, and the next session starts PART H markup
immediately (H5 steps 1-12 are already ordered). The Phase 3 sequencing answer
(above, D1) goes in the same record.

**D2 DECIDED (owner, 2026-10-17):**
- (a) **Behind packs** - the Procurement tab ships as `data-pack="procurement"`,
  hidden until the user turns on its pack. Fold into H5 step 4 wording: the tab
  button carries the pack attribute; the pack gate already reads data-pack
  (js/mmgr-app.js:3755), no new gating code.
- (b) **Grantable editor scope** - `proc` joins the editor-code section scope,
  so an officer can be given Procurement alone (owner: "maintained by whoever
  does the procuring"). Fold into H5: the scope list gains proc (server side +
  the scope UI); CLOUD_SECTIONS still gets its `proc` entry for sync (H5 step 3
  unchanged); view-only still reads via READONLY_SAFE.
With both answers in hand, **H7.7 no longer blocks anything: the next session
may start PART H at H5 step 1 directly.** D1 (Phase 3 sequencing) still OPEN -
owner asked for a fuller coverage explanation first (see D1 follow-up in chat).

**D1 DECIDED (owner, 2026-10-17): PARK it, queue it at the back.**
Owner's call, verbatim intent: rates outside a purpose-built calculator are
already covered (the Custom item takes your own figure; the picker takes any
book row), so Phase 3 stays parked. Slight wording note for the record - it is
NOT a custom field: it would be purpose-built MEASURING forms for selected
LISTED rows; access is already solved either way. The owner's instruction for
the next session: **start PART H Procurement and drive it to completion**
("start the other task to completion"). Phase 3 re-triggers any time by the
owner naming rows they measure often (the entails list is in D1 above).

NEXT SESSION STARTING POINT (updated 2026-10-17, **PART H MID-BUILD, READ H8
FIRST**): **continue PART H at H5 step 5 (`js/mmgr-prompts.js`)** - steps
1-4 are DONE and VERIFIED in the UNCOMMITTED working tree (see H8 for the
file-by-file delta, the two namespace collisions `supplierBook` / `ns.Proc`,
and the copy-ready H5.5-H5.6 edit specs with exact anchors - apply them
verbatim, do not re-derive). Then proceed H5.7 -> H5.12 per H8.4 (module
`ns.Proc`, field-guide entry now REQUIRED, sw bump, new harness + registry +
ci.yml, staging deploy under $HOME). H7.7 DECIDED (tab behind packs; proc =
grantable editor scope), H7.1 corrected (supplier prices hand-entered from
each supplier's own rates), H7.2-H7.8 folded in. **Do NOT commit until the
H5.11 gates are green** (owner: "you don't have to commit this"). PART I is
COMPLETE (Phases 1+2 shipped and live-verified; Phase 3 parked by owner
decision). Live probes: https://mymanagerworkspace.com (never mymanager.app).

AUDIT 2026-10-22 - WIRING + SECURITY GAP SWEEP (owner-requested dig for real
bugs, then documented as tasks). Method: mechanical sweeps whose results were
each hand-verified against raw source, because the first pass lies in both
directions (it reported 122 "missing" ids and ~200 "unwired" actions that were
renderer-built ids and unquoted ACTION_MAP keys). Re-runnable probes live in
`tmp/audit-wiring.cjs`, `tmp/audit-actions2.cjs`, `tmp/audit-css-classes.cjs`,
`tmp/audit-links.cjs`, `tmp/audit-aria.cjs` (tmp/ is gitignored - re-create
them from this description if they are gone).

FOUND AND FIXED THIS PASS (shipped with the S-6.3b commit):
- F1 ICONS THAT NEVER RENDERED. `css/mmgr-icons.svg` had no `i-pencil` and no
  `i-image`, yet both are referenced: admin.html's team "Edit" button and the
  photo placeholder in `js/cloud/photos-ui.js`. An unresolved `<use href>`
  renders an empty box and no error anywhere. Both symbols added (rule 7).
- F2 A CANCEL BUTTON THAT DID NOTHING. Project Photos' "Cancel" carried
  `data-action="photos-cancel"`; `git log -S photos-cancel` shows one commit
  and no handler ever existed. The click dispatcher only runs actions present
  in ACTION_MAP and silently ignores the rest, so the button was dead since the
  panel shipped. Wired in `js/cloud/photos-ui.js` (drops the picked file and
  typed caption, returns focus to "Add photo").
- F3 A DEAD ANCHOR. admin.html links "See Company plan" to
  `pricing.html#company`; pricing.html had no `#company` id, so the buyer
  landed at the top of the page. `id="company"` added to the plan card.

TASKS STILL OPEN (in priority order):
- T-1 GATE THE SPRITE. `tools/verify-icons.cjs`: every `mmgr-icons.svg#i-*`
  reference in served HTML and in `js/` must resolve to a `<symbol>`. F1 was
  invisible to every existing gate; this closes the class. Register in
  docs/CI-TEST-COVERAGE.md + ci.yml T1.
- T-2 GATE THE ACTION CONTRACT. `tools/verify-actions.cjs`: per page, every
  `data-action` must appear in that page's own map (project.html ->
  ACTION_MAP in mmgr-app.js, app.html -> DASH_ACTION_MAP in its inline script,
  admin.html -> ADMIN_ACTION_MAP, calculator.html -> its ACTIONS map). F2
  survived three waves of QA because nothing checked the markup against the
  map. Static arm only; the live click paths stay with qa-full.
- T-3 GATE INTERNAL LINKS. `tools/verify-links.cjs`: every relative href must
  exist and every `page.html#anchor` must resolve to an id in that page. F3
  passed every gate we have.
- T-4 REDUNDANT ACTIONS (cleanup, no user impact). `calcDocType`,
  `calcCashMode` (calculator.html) and `photos-upload` (project.html) carry
  data-action but have no map entry; they work because their element ids have
  their own listeners. Remove the attribute or add the entry - pick one and
  make it uniform, so T-2 can be enforced without a suppression list.
- T-5 REQUEST-BODY CAPS. 24 handlers call `await request.json()` directly;
  only the project-data paths use `readCloudBody` (8 MiB streaming cap,
  src/lib/http.js). Public ones (contact, reviews, auth, /api/ai/chat) rely on
  rate limits alone. Route every JSON read through the capped helper (or a
  small-by-payload variant) so a large body cannot be parsed for free.
- T-6 SECURITY RE-VERIFICATION (not a defect, a gap in coverage). Session
  cookie flags (HttpOnly/Secure/SameSite=Lax), parameterised D1 queries (no
  template interpolation found), no SSRF in the AI relay (provider URLs come
  from the fixed AI_PROVIDERS map, never from the request) and photo/auth
  layering (`cloudAuthOwnerSession` -> code -> editor -> viewer) all read
  correctly. Still unverified this pass: team/accept token lifetime,
  api-keys scoping on every read path, client-code lookup timing. Give each a
  browser/API gate in tools/qa-cloud-phase2.cjs style before the next release
  of the cloud surface.


- T-7 CLAIM PACK: ONE OVER-LONG LINE (unresolved, evidence recorded). qa-full
  gate 86 ("counsel-ready print document") fails with maxLine=644 (it requires
  <100); (187/0 earlier the same day, failing twice since).
  Fresh-seed probes give 89; a 500-char decision text plus a 500-char task name
  still give 85, so wrap() does wrap user text - either one section appends a
  list unwrapped, or qa-full's earlier gates leak state into the pack. Fix: run
  the gate hermetically first, then wrap the offending section. Never relax the
  100-char assertion.
- T-8 qa-full IS ORDER-SENSITIVE. Gate 07 (float watch) failed then passed with
  no code change: 187 checks mutate and restore the demo state, so a gate that
  depends on an earlier gate's leftovers is a false signal. Snapshot/restore
  deterministically per check (gate 86's restore is best-effort and runs AFTER
  its assertion).

CORRECTED FALSE POSITIVES (do not re-open): the dashboard pager is FINE -
`.pg-off{display:none}` lives in app.html's inline `<style>`, not
css/mmgr.css (measured: `.pcard.pg-off` -> display:none). `client-scope`,
`bcp-ai`, `pg-nav`, `pool-modal`, `import-modal`, `snap-daily-btn`,
`calc-ratebook-card` are renderer-created or decorative hooks, not missing
markup. All app.html/admin.html actions resolve. Zero broken aria references.
