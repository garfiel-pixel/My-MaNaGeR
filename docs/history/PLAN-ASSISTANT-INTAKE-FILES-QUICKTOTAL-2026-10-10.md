# PLAN - Assistant intake, honest files, "Quick total", loading dots, Load button, and the full web review (2026-10-10)

**Status:** PLAN ONLY. Nothing in this document is implemented. Do not edit a served file until the owner signs off
the wave being started. This plan EXTENDS Item 4 of `PLAN-WAVE-2026-10-09-MERGED.md`; it does not replace or contradict
any locked decision (L1-L11). Where an idea the owner pasted would collide with a locked decision or the codebase, the
collision is named in section 3 and the idea is delivered a different way, so everything works in unison.

**Baseline read:** repo `mymanager-fixed` at HEAD `e86f2ba` ("owner review wave, assistant window, honest cloud cap").
Everything below marked MEASURED was observed in a real Chromium browser (Playwright) against the repo's own files.
Everything marked CODE-READ was read from source and still needs its probe. Nothing here was run against production.

**Reading order:** 1 (what the owner asked) -> 2 (what the browser showed) -> 3 (the pasted suggestions, reconciled) ->
4 (design) -> 5 (tasks) -> 6 (waves) -> 7 (review register, every category) -> 8 (owner decisions) -> 9 (not measured) ->
10 (rules the terminal agent must follow) -> 11 (self-review).

**OWNER DIRECTIVE (2026-10-10) - the identity is GOLD, not orange.** "Gold, not orange. Gold, not orange."
The first draft of this plan (A-1 table, D2) proposed fixing the button contrast by **replacing the brand hue with
`#b04f18`**, a dark orange-brown. That converts the gold identity into orange and is **rejected by the owner**.
The gold surface is the identity and stays gold; the label on it moves to the dark ink token instead (T10-A / D2
below). Gold is the theme word throughout this document: the brand, the focus ring, the dot rail, the tint, the
hover - all gold. Anything in the codebase commented "brand orange" is a naming bug to correct, not a design to keep.

---

## 1. WHAT THE OWNER ASKED (every statement, numbered so it cannot be dropped)

| ID | Owner statement (this session) | Becomes |
|---|---|---|
| R1 | The assistant should take exactly four attachment types: **PDF, CSV, TXT, MD.** Nothing else. | T7 allow-list; T8 PDF |
| R2 | File creation "doesn't work" / downloads happen silently. | T2 truthful outputs + download chip |
| R3 | "Populate for calculator" fails: the calculator has **structured boxes**. A whole measurement must be broken down into the boxes. | T5 proposal v2 + check, T6 intake |
| R4 | Or add **a section where you put one big measurement and get a calculation from a specific rate.** | T4 "Quick total" |
| R5 | **Index** files and rate data so tokens are not wasted. | T7 retrieval index |
| R6 | This is a **planning phase**; do not go against the codebase; everything works in unison; enhance the AI and how it works. | Whole plan; section 3 |
| R7 | Pasted advice: a **4-step pre-calculation interview** (units, openings, dimension breakdown, rate source). | T6 |
| R8 | Pasted advice: fix **payload mapping and validation**; heights requested before pricing. | T5 |
| R9 | Pasted advice: **pulsing three-dot loading indicator** in the chat stream. | T3 |
| R10 | Pasted advice: **interactive CSV download chips** with a Blob URL and a `download` attribute. | T2 |
| R11 | Pasted advice: keep the **Load** button visible, soften the saturated green, show green **only on hover**. | T9 |
| R12 | Use Playwright, index the pages, **web-review every category**, find gaps, errors, UI fixes. | Section 2 and 7 |
| R13 | Document all of it in the plan; the owner will give it to the terminal agent to build to completion, **under the repo's directive rules.** | Section 10 |
| R14 | The owner is not using Claude Code today; this chat is used to debug and plan. | Plan is agent-agnostic and uses only repo conventions (`AGENTS.md`, `.agents/skills`), so Claude Code can pick it up later unchanged. |

---

## 2. WHAT THE BROWSER SHOWED (the pages, indexed)

### 2.1 Site-wide crawl: 18 pages x 3 variants (desktop 1534x697, phone 390x844, dark theme)

- **Page JavaScript errors: 0** on every page. **Emoji: 0** (hard gate AGENTS.md rule 7: PASS). **Horizontal overflow: 0** in all 54 variants.
- Every public page has a title, a meta description and exactly one h1 EXCEPT: signin has 2 h1, verify 4, reset 4, admin 4.
- Network noise seen in the sandbox (blocked external fonts/CDN, no WebSocket server, `/api/*` 404 on a static server) is NOT counted as a defect.

### 2.2 The calculator page (`calculator.html`), indexed

- 10 cards, 67 form fields, **43 work items**, a Metric/Imperial toggle (`calcUnits`), a basis chooser
  (Measured / All-in rate / Days on site), a "Labour only" switch, an **openings editor** (doors and windows deducted from walls,
  `calcOpenAdd`), and **element rows** (`calcInstAdd`, e.g. "Wall 1": label, length, height, count) for **27 work items**
  (6 wall, 7 area, 6 pour, 8 run kinds; `INSTANCE_KINDS`).
- Dimension boxes per work item (MEASURED): 17 items take Length x Height/Width (blockwall, brickwall, framing, render, paint,
  drywall, tile, siteprep, roof, shingle-roof, ceiling, fencing ...); 5 items need a **third** box (excav, slab, footings,
  concrete-drive, floor-screed); the rest take one number (area, volume, count or run).
- **A typed-total box already exists:** checkbox "I know the total - let me type it" (`#calc-measured-manual`) plus
  `#calc-measured-qty`. It has no label and no unit (placeholder "Total quantity").
- **All-in rate already exists:** `#calc-basis = allin` + `#calc-allin`. MEASURED: blockwall, 69 m2, all-in 120 ->
  **J$8,280 subtotal, J$9,522 total with 15% tax.** The owner's "one big measurement x a specific rate" already prices correctly.
  It is hidden and unlabeled, not missing.

### 2.3 Why "those figures do not price" happens (MEASURED, all 43 work items)

The assistant's proposal can only carry `work`, `d1`, `d2`, `d3`. The page-side `calcPopulate` writes those into the
boxes and calls `render()`.

| Payload sent to `MMGR_CALC_POPULATE` | Result over all 43 work items |
|---|---|
| `{work, d1: 69}` (a lump total in the first box, what the model does) | **17 FAIL** with "those figures do not price - check the quantities" (the 17 two-box items), 26 pass |
| `{work, d1: 69, d2: 2.4}` | 5 FAIL (the five needing a third box), 38 pass |
| `{work, measuredQty: 69}` (the existing typed-total path) | **0 FAIL - all 43 price** |

CODE-READ, to be proven by probe (F-4): `calcPopulate` only writes fields it was given, so values from a previous line stay in
the other boxes and rows.

### 2.4 The assistant panel (`js/calc-ai.js`, `calc-ai-2`), driven with a mocked relay

- **Attachments (MEASURED):** `accept=".json,.csv,.txt,.md,text/plain,application/json"`. PDF is not offered; JSON, which is not
  wanted, is. There is no type check and no size check. Every file goes through `readAsText`: a PDF was attached as raw
  `%PDF-1.4 ... <binary>` text and sent to the model. Up to 24,000 characters of the attachment are **re-sent on every message.**
- **Loading (MEASURED):** while the relay is busy the only feedback is the small status line "Thinking...". Nothing animates in the chat stream.
- **Request size (MEASURED):** system prompt 4,961 characters with a 2,892-character rate book and no attachment. The page-side rate
  book text takes only the first 12 work families x 3 variants, so the relevant rate may be missing; the panel then caps it at 6,000.
- **Proposal line (CODE-READ + MEASURED):** the system prompt tells the model to end with `PROPOSAL: {"work","d1","note"}` and to
  "include d2/d3 only if needed". No interview, no units, no openings, no rows, no total, no rate.
- **File path (MEASURED):** pressing "Generate a file to download" with nothing priced produced **no download**, yet the chat said
  **"Your estimate has been downloaded as a CSV file."** and it sat directly under the red populate error. `downloadCsv()` returns
  silently when there is no result and `onMakeFile()` announces success regardless. With a priced line the CSV does download
  (1,475 bytes, `estimate-blockwork-wall-...csv`), so the export machinery itself is sound.
- **Layout (MEASURED):** the panel fits at 1534 and 390 px with no overflow. The first-time "tour" popup (fixed, y 806-864 of 900)
  covers the identity row at the bottom of the panel on a laptop screen.

### 2.5 A bug in the calculator itself, found on the way

MEASURED: in typed-total mode the result heading reads **"ESTIMATE undefined 69 m2"** (`#calc-sum-label`). `r.qtyLabel` is never
set on that path (`calculator-page.js` ~6055 writes it unescaped). It sits exactly on the path R4 builds on.

### 2.6 The cloud project cards (`app.html`), mocked three projects

MEASURED: the Load button is `btn btn-g btn-s` (markup `js/mmgr-cloud-dash.js` ~389), `background rgb(46,125,50)`, white text,
59x38 px, one per card. `.btn-g` is also used elsewhere, so the fix must be scoped to `[data-cd-load]` on the card, not to `.btn-g`.

---

## 3. THE PASTED SUGGESTIONS, RECONCILED (nothing deflected; each delivered in a way that fits this codebase)

| # | Suggestion | Verdict | How it is delivered here |
|---|---|---|---|
| S1 | "Enforce a 4-step interview in the system prompt; block calculation until done" | **Intent adopted, mechanism changed.** | An LLM-driven interview spends the user's messages. The free allowance is **5 a day** (L3), so four questions would eat four of them before any price, and a small model does not obey a prompt state machine reliably. The same four steps are built as a **client-side intake card (zero tokens, deterministic)**, mapped onto controls that already exist (units toggle, openings rows, element rows or typed total, rate book). The prompt only carries a short guard. See T6. |
| S2 | "Map multi-wall dimensions into structured wall rows; validate heights first" | **Adopted in full.** | Proposal v2 carries `elements[]`, `openings[]`, `total`, `basis`, `allIn`. A page-side dry-run check (`MMGR_CALC_CHECK`) names every missing box in plain words BEFORE anything is entered. See T5. |
| S3 | Loading indicator, Tailwind markup (`animate-bounce`, `bg-neutral-800`, `bg-amber-400`) | **Adopted; the markup is not.** | This repo has no Tailwind (custom CSS in `css/mmgr.css`, token colours, CSP, no build step for utility classes), so that snippet would render as nothing. The same three-dot motion is written as `.bcp-ai-typing` using tokens, with reduced-motion handling. See T3. |
| S4 | CSV chip: Blob URL + `download` attribute | **Adopted in full,** plus the missing half: the chat must never claim a download that did not happen. | See T2. |
| S5 | Load button: visible, soft, green on hover | **Adopted in full.** | Scoped override, both themes, touch devices handled, no JS or class change. See T9. |
| S6 | (owner) "add a section for one big measurement x a rate" | **Adopted, but not as new maths.** | The engine already does it (2.2). The work is to surface it clearly ("Quick total"), label its unit, fix the `undefined`, and let the assistant use it. See T4. |

---

## 4. DESIGN (how the pieces fit together)

### 4.1 Proposal v2 (backward compatible)

The model still ends its reply with ONE line. v1 (`{"work","d1","d2","d3","note"}`) keeps working. v2 adds:

```
PROPOSAL: {"v":2,"work":"<key>","units":"metric|imperial","mode":"elements|total|dims",
  "elements":[{"label":"Wall 1","d1":12,"d2":2.4,"n":1}],
  "openings":[{"label":"Door","w":0.9,"h":2.1,"n":2}],
  "total":{"qty":69,"unit":"m2"},
  "basis":"measured|allin|days","allIn":120,"days":null,"note":"<one short line>"}
```

- `mode:"elements"` -> element rows (only for the 27 `INSTANCE_KINDS` work items); `mode:"total"` -> the typed-total path;
  `mode:"dims"` -> the d1/d2/d3 boxes (the legacy path).
- The page never trusts the line. It runs the check first (4.2). A line that fails the check is not populated.

### 4.2 Page-side hooks (additive; the panel stays swappable, per the Item 4 swap contract)

- `window.MMGR_CALC_CHECK(proposal)` -> `{ ok, missing:[{field,label,unit}], resolved:{...}, preview:{qty,unit,total,currency} }`.
  Pure dry run: it must not touch the form, the bill, or saved state. `missing` uses the work's own labels
  ("Wall height (m)"), straight from the dimension boxes indexed in 2.2.
- `window.MMGR_CALC_POPULATE(proposal)` (existing name) now: clears the boxes and rows it is about to use (fixes F-4), sets units
  through the same `setUnits`, selects the work, adds rows through `calcInstAdd` / `calcOpenAdd`, uses the typed-total path for
  `mode:"total"`, selects the basis and rate, calls `render()`, and adds the bill line through `calcBoqAdd`. One code path per
  action: no second pricing engine.
- `window.MMGR_CALC_FILE()` (existing name) is split: a pure `buildCsv()` returns `{ok, name, mime, text, rows}` or
  `{ok:false, reason:'nothing priced'}`; the page's own "Export CSV" button and the assistant chip both call it. Only one of them
  starts a download. (`downloadCsv` is currently the only caller of `estimateCsv`.)
- Unit guard: `total.unit` must equal the work's quantity unit (shown in the existing rate-book text, e.g. "(m2)"). The assistant
  never silently multiplies area by thickness; a mismatch becomes a `missing` entry asking for the thickness.

### 4.3 The intake card (client side, zero tokens)

Shown in the panel for a new chat (and on a "Start a quote" control). Four steps, one screen, chips not typing:

1. **Units:** Metric / Imperial. Default = the calculator's current toggle.
2. **What and openings:** work item (from the page's own work list) and "Any doors or windows to deduct?" (shown for the six wall kinds).
3. **How will you give measurements:** "Separate lengths and heights" (element rows) / "One total" (quantity with the unit label of that work).
4. **Rates:** "The active rate book (name shown)" / "My attached sheet".

The result is a small structured brief sent inside the first message and kept in the system context for that chat. It also pre-sets
the calculator controls that already exist (units, work). The system prompt carries one guard: "If a brief is present, do not
re-ask it. If a box needed for the chosen mode is missing, ask for exactly that one item. Do not write a PROPOSAL until the brief is complete."

**Missing items are asked locally.** If a proposal fails the check, the panel asks in plain words ("How high is the wall, in metres?")
with an inline field, updates the proposal, and re-checks. This costs no message.

### 4.4 File intake and the token index

- **Allow-list (R1):** `.pdf .csv .txt .md` only, by extension AND content (a PDF must start with `%PDF-`). Anything else is refused with:
  "That file type is not supported. Attach a PDF, CSV, TXT or MD file." Raw size cap 5 MB. `.json` leaves the assistant's picker
  (the separate rate-book JSON import on the page is unchanged).
- **Reading:** TXT and MD as text; CSV parsed into rows with header detection; PDF through a vendored, lazy-loaded text extractor (D1).
  A PDF with no text layer (a scan) gets: "This PDF has no readable text. Export it as CSV or TXT and attach that."
- **Index (R5):** at attach time the file becomes in-memory chunks: CSV = one chunk per row (`item | unit | rate`), TXT/MD/PDF =
  paragraphs of about 400 characters tagged with page. Each question retrieves the top chunks by keyword score (using the question
  plus the chosen work label), within a **1,800-character budget**, plus a one-line digest ("rates.csv: 214 rows; item, unit, rate").
  Today the whole attachment (up to 24,000 characters, about 6,000 tokens) rides on every message.
- **Rate book the same way:** keep the compact "key = label (unit)" index, and send only the rate rows that match the question or the
  chosen work, instead of the first 12 families x 3 variants.
- **Rate source (step 4):** a CSV with item/unit/rate columns is used for grounding in that chat. Importing it as a real rate book is
  phase 2 (D4); it would reuse the existing book importer, not a new one.

### 4.5 Loading indicator (T3)

An assistant-role bubble in the log, class `.bcp-ai-typing`, `role="status"`, accessible name "The assistant is writing". Three
dots with a staggered bounce, token colours (`--gold` dots on the existing assistant-bubble surface), removed on reply or error.
`prefers-reduced-motion`: three static dots, no motion. The "Thinking..." status text is removed in favour of it (one source of truth).
A line "Still working..." appears after 25 seconds. A smaller variant shows while a file is being read.

### 4.6 Download chip (T2)

After "Generate a file": call `buildCsv()`. If `ok`, create a Blob, `URL.createObjectURL`, and render a chip in the log:
sprite file icon, file name, size, row count, and a real `<a class="btn" download="<name>" href="blob:...">Download</a>`.
No automatic download. Revoke the URL when the chip is removed or the panel unmounts. If nothing is priced there is no chip and
the chat says: "Nothing is priced yet. Add the line to the calculator first." with a "Populate the calculator" action.
The success sentence may only ever be written when a chip exists.

### 4.7 Load button (T9)

Scope: `body.db-page .cd-actions .btn[data-cd-load]` (the cards only; the rail rows `.db-project` and every other `.btn-g` stay as they are).
- Default: transparent background, 1px border from the existing border token, text in the primary text token. Visible, not green.
- `:hover`, `:focus-visible`, `:active`: `background: var(--green)` (#2e7d32), white text. White on #2e7d32 = **5.13:1** (passes AA 4.5).
- `@media (hover: none)` (phones): the default state stays the neutral outline; green appears on `:active` only.
- Dark mode (`body.dark-mode.db-page`) gets its own border and text tokens. Transition uses the existing `--tr`; reduced motion respected.
- No change to `js/mmgr-cloud-dash.js` markup, so `data-cd-load` handlers and the "Loading..." label swap (line ~573) keep working.

---

## 5. TASKS (each names its files, steps, and the proof that closes it)

Common to every task: load the skills in section 10 first; bump `sw.js` by one (current value `mmgr-shell-v397`); bump the `?v=`
on any changed script/style tag in `calculator.html`; run `npm run verify`; no emoji; plain-language copy.

### T9 - Load button softened (R11)  [independent, smallest, first]
**Files:** `css/mmgr.css` (one scoped block next to `body.db-page .cd-actions`).
**Prove it (browser, mocked 3 cards, light and dark):** default computed `background-color` has alpha 0 and the label is readable at >= 4.5:1; on hover the background is `rgb(46, 125, 50)` and the text white (5.13:1); `:focus-visible` shows a ring; on a `hover:none` context the default is not green; `[data-cd-load]` still loads a project (click handler unchanged); the rail rows are unchanged; no other `.btn-g` changed (spot-check "Start tour" and the assistant Send button).

### T2 - Truthful outputs and the download chip (R2, R10)  [independent]
**Files:** `js/calculator-page.js` (split `downloadCsv` into `buildCsv` + `downloadCsv`; `MMGR_CALC_FILE` returns the build result), `js/calc-ai.js` (`onMakeFile` renders the chip), `css/mmgr.css` (`.bcp-ai-chip`), `calculator.html` (`?v=`).
**Prove it:** nothing priced -> no chip, no download event, the plain "Nothing is priced yet" line, and the string "has been downloaded" never appears. After a populate -> exactly one chip; clicking Download fires one browser download whose bytes equal the page's own "Export CSV" file (same name pattern, same content); the Blob URL is revoked on unmount; the page's own Export button still works unchanged.

### T3 - Loading dots (R9)  [independent]
**Files:** `js/calc-ai.js`, `css/mmgr.css` (`.bcp-ai-typing`, keyframes, reduced-motion block).
**Prove it:** during a delayed relay response the log contains one `.bcp-ai-typing` with `role=status`; it is removed on success, on 402/429/503 and on network failure; with reduced motion emulated, no element has an animation; contrast of the dots against the bubble >= 3:1; "Still working..." appears after 25 s with a faked clock.

### T4 - "Quick total" on the calculator (R4)  [independent of the assistant]
**Files:** `calculator.html` (structure and labels), `js/calculator-page.js` (surface the existing typed-total + all-in state; set `qtyLabel`; no new engine), `css/mmgr.css`.
**What it is:** next to "Measure by element" a clearly named **Quick total** mode: "Quantity (m2)" with the unit taken from the selected work, "Rate" (the rate-book rate shown, or "My rate"), and a live line "69 m2 x J$120 = J$8,280" before tax. It reuses `calc-measured-manual`, `calc-measured-qty`, `calc-basis=allin`, `calc-allin`. Saved state, history snapshots and the bill keep working because no stored field changes.
**Also fixes:** F-3 (the word "undefined" in `#calc-sum-label`) and A-5 (aria-labels on the element-row boxes `bcp-inst-dim`, e.g. "Wall 1 length (m)").
**Prove it:** all 43 work items price in Quick total mode (43/43, the same matrix as 2.3); the unit label matches the work's unit; no text node on the page contains `undefined`, `NaN` or `[object` in any mode; 69 m2 x 120 -> J$8,280 subtotal; saved state round-trips (reload restores the mode, quantity and rate); a snapshot recalls exactly; the existing `tools/qa-calc-golden.cjs` and `tools/qa-calc-trade-coverage.cjs` stay green.

### T5 - Proposal v2, the check, and the review card (R3, R8)  [needs T4]
**Files:** `js/calculator-page.js` (`MMGR_CALC_CHECK`, `MMGR_CALC_POPULATE` rewrite, `MMGR_CALC_RATEBOOK` carries each work's quantity unit and required boxes), `js/calc-ai.js` (`parseProposal` v2, review card, local missing-item questions), system prompt text, `css/mmgr.css`.
**Behaviour:** the proposal is checked before anything is entered. A pass shows a **review card** ("I will enter: Blockwall, 2 walls, 30 m x 2.4 m and 12 m x 2.4 m, 1 door; preview J$X") with Populate / Change. A fail names each missing box in plain words and asks for it inline. A v1 proposal is upgraded by the check (a lump `d1` for a two-box work becomes "Need: wall height" instead of an error).
**Prove it (matrix harness, new `tools/qa-calc-assistant.cjs`):** over 43 works: v2 `mode:total` 43/43 pass; v2 `mode:elements` passes for all 27 kinds; v1 `{work,d1:69}` yields `ok:false` with a non-empty `missing` for exactly the 17 two-box works and never the generic error; v1 with the third box missing yields `missing` for the five three-box works; populate leaves no stale box or row from a previous line (populate A then B, assert B-only values); the check never changes the form or the bill (snapshot equal before and after); openings subtract area (a 30 m2 wall with one 2 m2 door prices 28 m2).

### T6 - Intake card and local clarifying questions (R7)  [needs T5]
**Files:** `js/calc-ai.js`, `css/mmgr.css`, the system prompt, `js/calculator-page.js` (a read-only list of work items and kinds for the card; no internals exposed).
**Prove it:** a new chat shows the card; completing it sends exactly **one** relay request (assert the count) whose context carries the brief and no re-ask; the daily counter drops by 1, not 4; choosing "One total" never asks for heights; choosing walls with "yes openings" asks for them locally; the card pre-sets the units toggle and the work select through the existing controls; no number of remaining messages is shown up front (L3).

### T7 - File intake: allow-list, parsing, retrieval index (R1, R5)  [independent of T4-T6]
**Files:** `js/calc-ai.js` (picker, validation, reader, index, retrieval), `js/calculator-page.js` (`MMGR_CALC_RATEBOOK` returns the compact index plus a `rows(query)` retrieval), `css/mmgr.css`.
**Prove it:** the picker's `accept` is exactly `.pdf,.csv,.txt,.md` plus their MIME types; `.json`, `.png`, `.docx`, `.exe` are refused with the plain message and are not attached; a TXT, an MD and a CSV attach and are indexed; the request for a question about "render" carries <= 1,800 characters of file text, not the whole file; a 20,000-character TXT adds at most that budget to the request (assert request length before and after); the relevant CSV row appears in the request for a matching question and an unrelated row does not; the rate-book text sent for "blockwall" contains the blockwall rate even when it was outside the old first-12-families window.

### T8 - PDF reading (R1)  [after decision D1]
**Files:** `vendor/pdfjs/` (lazy-loaded, same-origin worker; `worker-src 'self'` already allows it), `js/calc-ai.js`, `sw.js` (runtime-cache, not precache), `package.json`/verify scripts if a vendored-file check exists, licence notice.
**Prove it:** a text PDF yields its text and is indexed like a TXT; the extractor loads only when a PDF is attached (assert no request before); works with the network blocked after first load (offline-first); a PDF with no text layer gives the plain scan message; a file renamed to `.pdf` that is not a PDF is refused by the magic-byte check; the page's CSP produces no violation.

### T10 - Review register fixes (R12)  [independent; see section 7]
Grouped into: A (contrast tokens, D2), B (ARIA, focus, headings), C (SEO and hygiene), D (copy). Each with its own commit and probe, listed in section 7.

---

## 6. WAVE ORDER (each wave is atomic and shippable; the owner can stop after any)

| Wave | Scope | Depends on | Exit gate |
|---|---|---|---|
| **W11** | T9 Load button | - | Probe above; `npm run verify` green |
| **W8a** | T2 truthful outputs + chip, T3 loading dots | - | No false "downloaded" claim anywhere; chip + dots probes |
| **W8b** | T4 Quick total, `undefined` fix, row aria-labels | - | 43/43 matrix; no `undefined` text; golden harnesses green |
| **W9a** | T5 proposal v2, check, review card | W8b | Matrix harness green (section 5, T5) |
| **W9b** | T6 intake card | W9a | One request per intake; counter drops by 1 |
| **W10a** | T7 CSV/TXT/MD intake and token index | - | Request-size probe; allow-list probe |
| **W10b** | T8 PDF | D1, W10a | PDF probes |
| **W12a** | T10-A contrast tokens | D2 | Contrast probe, both themes, 0 serious |
| **W12b** | T10-B ARIA, focus, headings | - | axe 0 serious on the listed rules |
| **W12c** | T10-C SEO and hygiene | - | Canonical + noindex probes; live `curl -I` result recorded |
| **W12d** | T10-D plain-language copy | D5 | Banned-word scan clean on non-legal pages |

W11 first because it is one block of CSS and the owner can see it immediately. W8a/W8b/W10a can run in any order. This table is meant
to be appended to section 2 of `PLAN-WAVE-2026-10-09-MERGED.md` as W8-W12; it does not renumber W0-W7. In that plan, W6a/W6b
(5-message cap, bigger window, history, identity, upload) are present in code at HEAD; W6c (both outputs) is present but dishonest
(F-2), which W8a corrects.

---

## 7. REVIEW REGISTER (the web review, every category; severity per the `human-audit` skill: blocking / ugly / polish)

### Functional
| ID | Sev | Finding (what a user sees) | Evidence | Fix | Wave |
|---|---|---|---|---|---|
| F-1 | blocking | Pricing a whole measurement with the assistant fails | 17/43 works fail with a lump; 0/43 with the total path | T5 | W9a |
| F-2 | blocking | "Generate a file" says it downloaded when nothing did; sits under a red error | No download event; chat text captured | T2 | W8a |
| F-3 | ugly | Result heading reads "ESTIMATE undefined 69 m2" in typed-total mode | `#calc-sum-label` text node | T4 | W8b |
| F-4 | ugly | Populating a second line may keep numbers from the first | CODE-READ (`put()` writes only given fields) | T5 clears first; probe proves | W9a |
| F-5 | ugly | PDF "attaches" but the model receives binary junk; JSON is offered, PDF is not | Request body captured | T7, T8 | W10 |
| F-6 | polish | Error voice is lowercase and technical ("those figures do not price") | Panel screenshot | T5 plain-language `missing` text | W9a |

### Accessibility (axe-core 4, WCAG 2.0/2.1/2.2 A and AA, 18 pages x 3 variants)
| ID | Sev | Finding | Evidence | Fix | Wave |
|---|---|---|---|---|---|
| A-1 | blocking | Text contrast fails: **209 nodes across 40 page variants** (serious) | Root causes below | tokens, D2 | W12a |
| A-2 | ugly | `div[aria-label="Projects"]` has an aria-label with no role | app, dashboard, project (9 nodes) | give it a role (region or list) | W12b |
| A-3 | ugly | Focusable items inside `aria-hidden`: `.hero-visual` (index), `#sidebar-icons` (app, dashboard) | axe | `inert` or `tabindex=-1` on the descendants | W12b |
| A-4 | ugly | Scrollable regions a keyboard cannot reach: `.features` track (index), `#kickoff-demo` (field guide), `.cmp-wrap` (pricing compare table) | axe | `tabindex=0` plus a name | W12b |
| A-5 | ugly | Calculator element-row boxes have only a placeholder, no accessible name (these are the boxes the assistant must fill) | 2 unlabeled inputs measured | aria-label per row and field | W8b |
| A-6 | polish | More than one h1: signin 2, verify 4, reset 4, admin 4 | crawl | one h1, rest h2 | W12b |

**Contrast root causes (computed ratios, replacements verified):** a handful of tokens explain nearly every failure.
| Where | Now | Ratio | Replacement (passes 4.5:1) |
|---|---|---|---|
| Footer text, all marketing pages | `#7f7e7e` on `#1c1917` | 4.32 | `#8c8b8a` (5.14) |
| White text on brand gold (the Contact and Reviews form submit buttons and the footer app button were flagged) | `#ffffff` on `#d96b27` | 3.45 | **Keep the gold fill; move the label to dark ink.** `#1c1917` on `#d96b27` = **5.07:1**. Do NOT darken the brand. **Owner decision D2.** |
| Teal links on white (Contact tiles) | `#0097a7` | 3.51 | `#00798a` (5.12) |
| Slate helper text on cream (Reviews) | `#64748b` on `#f5efe6` | 4.16 | `#56637a` (5.31) |
| Gold text on soft-gold (calculator units toggle) | `#d96b27` on `#faeae1` | 2.95 | `--gold-deep` `#a84a15` (**4.90:1**) |
| Gold links on white (the assistant's identity link) | `#d96b27` | 3.45 | `--gold-deep` `#a84a15` (**5.74:1**) |
| Red note on cream (assistant note) | `#d63a3a` on `#f8f5f0` | 4.27 | `#b83030` (5.51) |
| Field guide dim labels on navy (16-25 nodes per variant) | `#5f7891` on `#0a1930` | 3.84 | `#8aa3bb` (6.73) |

### Visual and UX
| ID | Sev | Finding | Fix | Wave |
|---|---|---|---|---|
| U-1 | ugly | The first-time "tour" popup covers the assistant's identity row on a laptop screen (fixed at y 806-864 of 900) | offset it above the panel or dock it to a corner; it must never sit on a control | W8a |
| U-2 | ugly | Error and success messages stacked contradictorily | resolved by F-2 | W8a |
| U-3 | ugly | Saturated green Load blocks on every card | T9 | W11 |
| U-4 | ugly | No loading feedback in the chat | T3 | W8a |
| U-5 | pass | No horizontal overflow at 390 or 1534 on any of 18 pages; the panel reads well on a phone | - | - |

### Performance (STATIC measurements on localhost; real Core Web Vitals NOT measured, see 9)
| ID | Sev | Finding | Fix | Wave |
|---|---|---|---|---|
| P-1 | polish | `calculator.html` loads `calculator-page.js` (305 KB) and `mmgr-calculator.js` (84 KB) as raw files with `?v=` cache-busters, unlike the bundled pages | add a calculator bundle in `build.js` following the existing bundle order and staleness rules (AGENTS.md hard-won #2) | later |
| P-2 | polish | Marketing pages carry 119 KB JS + 62 KB CSS; app pages 232 KB CSS | measure on the live site first, then decide | later |

### SEO
| ID | Sev | Finding | Fix | Wave |
|---|---|---|---|---|
| S-1 | ugly | `canonical` missing on reviews, pricing, privacy, terms, refund (all in the sitemap); present on index, features, about, contact | add `<link rel="canonical">` | W12c |
| S-2 | polish | No `noindex` meta on app, project, dashboard, seed-test (robots.txt disallows crawling but that does not stop indexing of linked URLs) | add `<meta name="robots" content="noindex">` | W12c |

### Security and deploy hygiene
| ID | Sev | Finding | Fix | Wave |
|---|---|---|---|---|
| H-1 | ugly | `monolith html to reference from all features.html` (469 KB) is a tracked root file and is not in `.assetsignore` or the staging recipe, so it may be publicly served | verify live (`curl -I`); if 200, move to `docs/reference/` and exclude | W12c |
| H-2 | polish | `seed-test.html` is a served route (`worker.js` ~172) | confirm it is meant to be public; otherwise exclude | W12c |
| H-3 | polish | `.assetsignore` and `.nvmrc` show as modified but differ only in line endings | normalise, commit once | W12c |

### Copy (plain-language law, `plain-language-copy` skill)
| ID | Sev | Finding | Fix | Wave |
|---|---|---|---|---|
| C-1 | ugly | `features.html` (marketing) says "localStorage" | say "stays on this device" | W12d |
| C-2 | polish | `privacy.html` contains hashed, PBKDF2, localStorage, iteration; `terms.html` contains "provision"; the field guide contains authenticate, credential, iteration, localStorage | legal pages are an owner decision (D5); the field guide is where technical detail belongs, so move or simplify | W12d |

**Categories that passed:** JavaScript errors (0), emoji gate (0), responsive overflow (0), titles and descriptions (present on every public page), both themes render on all 18 pages.

---

## 8. OWNER DECISIONS (none blocks W11, W8a, W8b, W10a)

| ID | Question | Recommendation |
|---|---|---|
| D1 | How to read PDFs. | **Vendor a text extractor (pdf.js), lazy-loaded, same-origin.** Keeps the file on the device (the panel promises "nothing is uploaded"), stays offline-first, costs nothing per file. Rejected: sending the PDF to the model (the relay is text-only, it uploads the file, and it costs far more tokens). |
| D2 | The brand **gold** on buttons fails AA with white text. | **Keep the gold surface (it is the identity) and put the dark ink label on it**: `#ffffff` on `#d96b27` is 3.45:1, but `#1c1917` on that same gold is **5.07:1** (AA). Gold text links/accents on white use `--gold-deep` `#a84a15` (5.74:1). Explicitly rejected: replacing the brand with `#b04f18` "dark orange-brown" - that is the orange the owner does not want. |
| D3 | Where Quick total lives. | A tab beside "Measure by element" inside the "What are you pricing?" card. |
| D4 | Import an attached rate CSV as a real rate book. | Phase 2, reusing the existing book importer. For now it grounds the chat only. |
| D5 | Legal pages (privacy, terms) contain technical words. | Plain wording on public pages; exact technical detail only where legally required. |
| D6 | "Generate a file": this line only, or the whole bill of quantities. | Check whether `estimateCsv` already includes bill lines; if not, a whole-bill CSV is a small addition built from the same row helpers. |

---

## 9. NOT MEASURED (so nobody assumes it was)

Real Core Web Vitals and Lighthouse on the live site; the live Worker's response headers and CSP (the static server has none);
offline/PWA behaviour (no service worker in this run); the real `/api/ai/chat` relay and the free key pool (the relay was mocked);
a physical phone and a screen reader; browsers other than Chromium; signed-in server flows (auth and cloud list were mocked).
Each is a follow-up, not a defect. `web-perf` (Chrome DevTools MCP) is the tool for the first one.

---

## 10. RULES THE TERMINAL AGENT MUST FOLLOW (this is the "directive rules" section; it restates `AGENTS.md`, it does not replace it)

**Before editing, load these skills (`.agents/skills/<name>/SKILL.md`) and follow them:**
`skeptical-code-audit` (every task), `universal-ui-architect` and `ui-modernization` (T2, T3, T4, T9, T10), `plain-language-copy` (every word rendered), `human-audit` (before declaring any UI wave done), `gemini-api-dev` (T5, T6, T7: prompt and relay), `qa-expert` (harness design), `accessibility-rules` is document-oriented, so rely on `universal-ui-architect` gates for web pages, `web-perf` (P-1), `security-audit` (H-1, H-2), `pwa-development` (T8), `workers-best-practices` (only if `src/ai-proxy.js` or `worker.js` is touched, which this plan does NOT require).

**Hard rules**
1. Offline-first is sacred. Every new network path stays on the AI surface only. Reading, indexing and PDF extraction happen in the page.
2. The AI relay stays one endpoint (`/api/ai/chat`), no hardcoded model ids, free cap stays 5, and the number is not advertised up front (L3). Intake and local clarifying questions must cost zero messages.
3. The panel keeps its swap contract: `mount`, `unmount`, `version`. New page hooks are additive (`MMGR_CALC_CHECK`; `MMGR_CALC_POPULATE` and `MMGR_CALC_FILE` keep their names). The panel never reaches into calculator internals. Bump `VERSION` to `calc-ai-3`.
4. No emoji in any served page or rendered string. Icons are sprite symbols (`css/mmgr-icons.svg#i-...`); add a symbol if one is missing.
5. No Tailwind, no new CSS framework. Tokens from `css/mmgr.css`. Never write a CSS comment containing the comment-closer sequence (hard-won #13).
6. Any inline `<script>` edit means regenerating `INLINE_SCRIPT_HASHES` in `worker.js` and `serve.cjs`, then restarting `serve.cjs` before browser checks. This plan edits external scripts, not inline ones; if you find yourself editing an inline script, stop and re-read AGENTS.md rule 1.
7. `node build.js` after any change under `js/` that feeds a bundle; never trust a stale bundle. `calculator.html` loads raw files, so bump its `?v=` instead.
8. Bump `sw.js` `CACHE` by one for every wave that changes a served asset (currently `mmgr-shell-v397`).
9. A new harness is registered in `docs/CI-TEST-COVERAGE.md` and wired in `ci.yml` or the extended workflow in the SAME commit; a harness whose contract changes is re-baselined in the SAME commit.
10. A test must call the real code path. A test that copies the logic into the test body proves nothing and is rejected.
11. Real-browser proof for every UI task (Playwright). Quote the numbers from the task's "Prove it" list. No "should work".
12. Conventional Commits, no AI attribution footer, never `--no-verify`. One commit per task.
13. Scratch files go in the repo's `tmp/`, never `/tmp` (hard-won #9). Never `taskkill //F //IM node.exe` (hard-won #1).
14. Deploy only from the clean staging copy (rule 2). Never from the repo root.
15. Never ask the owner for a cookie, token or key, and never print one.
16. Quote command output as evidence. Two failed attempts at the same approach: stop that approach, report, and wait.
17. Stop and ask the owner only at a decision in section 8 that blocks the wave being built; otherwise continue without pausing between verified steps.

**Gates for every wave:** `npm run verify` exits 0; the task's probes pass; the emoji scan is clean; `human-audit` walk done in light and dark; the review-register rows for that wave are marked closed with the evidence line.

---

## 11. SELF-REVIEW

- **Every owner statement R1-R14 maps to a task or a section.** R6 and R14 are constraints, honoured by section 3 and section 10.
- **No collision with L1-L11:** cap stays 5 and unadvertised (L3); the window, history, identity and both-outputs choice stay (L6); no relay change; no Paddle, webhook, or subscription change; offline-first untouched.
- **The biggest reconciliation is S1:** the interview is kept, but as a zero-token client card, because a prompt-driven interview would spend 4 of the 5 free messages before pricing anything.
- **Highest-value finding:** "one big measurement x a rate" already works (J$8,280 for 69 m2 at 120). The owner's idea needs surfacing, labelling and an `undefined` fix, not new maths, and the assistant must be taught to use it.
- **Known unknowns:** the PDF extractor choice and size (D1), the brand colour (D2), whether `estimateCsv` already covers the whole bill (D6), whether `monolith html ...` is live (H-1). Each has a recommendation and a probe.
- **Risks to watch:** quota of the free pool when intake is added (mitigated: zero tokens); saved-state compatibility when Quick total is added (mitigated: no stored field changes, round-trip probe); `calc-ai.js` growing (865 lines now, so split intake, files and chip into small internal modules inside the same file or a sibling loaded by the same tag, keeping `mount/unmount`).
