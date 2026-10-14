# DIRECTIVE: Calculator assistant reads the full 811-rate JIC book, and takes a custom rate when the book has none

You are the terminal AI. You write all code yourself. This directive contains no code and no patches. Execute every step in order without pausing between verified steps. A step is verified only when its stated check passes.

Revision note: this version adds the custom-rate mechanism (Part B). Part A (rate access) is unchanged in intent. Do both parts in one pass.

## 0. Findings you must confirm first (read, do not assume)

Read `AGENTS.md` and load the skills it names for this task (`skeptical-code-audit`, `gemini-api-dev`, `security-audit`). Confirm each finding by function name. If any is false, stop and report which.

F1. `js/jic-rates-full.js` holds 811 rates in 11 trades and is intact. Only 100 rows carry the in-app flag (`app`), meaning the calculator engine can price them through a work item.
F2. The assistant's only window onto rates is the hook `MMGR_CALC_RATEBOOK`, implemented by `calcRateBookText` in `js/calculator-page.js`. It reads `activeBook()`, a book the user imported or activated in localStorage. On a normal visit there is none, so it sends "Active rate book: none - the built-in planning-grade model rates are in use." The assistant then correctly says it has no rates.
F3. `calcRateBookText` never reads `window.MMGR_JIC_FULL` or `rrRows()`. `MMGR_JIC_FULL` is lazy-loaded by `rrLoadFull` only when the rate-book card opens, so on a fresh visit it does not exist.
F4. Even with the shipped Jamaica book active, only its 100 rows reach the assistant; 711 never do.
F5. Limits: at most 30 rows per question (36 with none), 6 variants per family, a 6000-character cut in `rateBookText` in `js/calc-ai.js`, and "any one word matches" with no ranking.
F6. `SYSTEM_PROMPT` in `js/calc-ai.js` makes the RATE BOOK block the only truth. The model behaves correctly on the data it is handed; the defect is the data.
F7. `WORK` in `js/calculator-page.js` has 29 work items and no generic or custom one. A bill line is `{ st: readState(), name }` where the name comes from `workName`, which reads the selected work option and variant. There is no way today to name a line freely.
F8. `MMGR_CALC_POPULATE` (`calcPopulate`) accepts only `work`, `d1`, `d2`, `d3` and `measuredQty`. It cannot set a rate, a unit or a name. `MMGR_CALC_CHECK` (`calcCheck`) only reports missing dimension boxes or a missing total quantity.
F9. The engine already prices "one quantity at one all-in rate" (the Quick total path: `calc-measured-manual` plus `calc-basis` set to all-in plus `calc-allin`), then applies the page's normal on-costs and tax. The custom-rate mechanism must reuse that path and must not add new pricing maths.

## 1. Scope and rules

Allowed to change: `js/calculator-page.js`, `js/calc-ai.js`, `calculator.html` (only the custom-item fields and cache-buster query strings), `css/mmgr.css` (only styling for those new fields, using existing tokens, gold accent, no blue, no emoji, no lock icon), `sw.js` (cache version), `tools/qa-calc-assistant.cjs` and the test registry.

Not allowed to change, and a diff touching any of these is a failure: `js/jic-rates-full.js` and its generator; the 29 existing work items and their rates, variants, formulas or labels; tax logic; on-costs; the rate-book import and the rate-book card; history, estimates, rate sheets; `src/ai-proxy.js` and every Worker file; sign-in, billing, pricing, admin, the app, MCP. If a needed change would touch any of these, stop and report instead of doing it.

Further rules:
- Create no new JS file. No inline script, no inline handlers, no emoji. Every panel toggled by `hidden` keeps its CSS `[hidden]` guard. Any text from the model or the user is written with `textContent`, never `innerHTML`.
- Keep `MMGR_CALC_RATEBOOK(query)` synchronous. Keep `MMGR_CALC_FILE` untouched.
- Metric first. Currency is the estimate's current currency (JMD by default). Never convert or round beyond what the book holds.
- The free daily message cap is real. Do not call the live model in tests; mock `/api/ai/chat`.
- Saved-state compatibility: any new stored field is optional and additive. A state saved before this change must load and price identically. A state with the new fields must not break an older client (unknown fields ignored). Prove both.

## 2. PART A - Rate access (required behaviour)

A1. The full book is ready before the first question. Start loading it when the assistant panel mounts, reusing `rrLoadFull` (one script tag only, never two). The send path waits for that load for at most 2 seconds, then proceeds either way.

A2. `calcRateBookText` always begins its rate section with one scope line built from the loaded data: book name and years, total rate count, and per-trade counts. If the book failed to load, the line says exactly: `The full JIC book could not load on this device; only the rates already on this page are available.` and the assistant repeats that plainly.

A3. For a question, retrieve from all 811 rows plus the active imported book, ranked: lowercase, strip punctuation, drop stop words, reduce simple plurals; score each row by question terms found in its description and trade label; a trade-name match adds a boost; an exact phrase match adds a larger boost. Return the top 12 by score. Return fewer if fewer score above zero; never pad with unrelated rows. Each row is one line in this fixed form: `<Trade> #<n> | <description> | J$<metric rate> per <metric unit> | source: JIC 2025-2027 | in calculator: yes or no`. Imported-book rows use `source: <book name>` and, when the same item exists in both, list the imported row first.

A4. A question naming only a trade returns the scope line plus that trade's top 12 rows. A question with no rate content returns the scope line only.

A5. Raise the cut in `calc-ai.js` `rateBookText` from 6000 to 9000 characters, and make the hook stop adding rows once its text reaches 8500 characters so no row is cut in half.

## 3. PART B - Custom rate mechanism (required behaviour)

The owner's intent in his words: when the rate book has no rate for something, the assistant says there is no rate for it in the rate book, asks the user to provide their own rate, and fills it in for them. There must be a custom rate field to receive it.

B1. A custom line on the calculator. Add ONE optional work choice, the last option in the work list, labelled `Custom item (your own rate)`, in a new group `Other`. When it is selected, show four fields and hide nothing else: a name, a unit, a quantity, and a rate. The rate field is the existing all-in rate input in all-in mode; the quantity is the existing Quick total quantity; add only the name and unit inputs. Pricing goes through the existing Quick total path (quantity times all-in rate, then the normal on-costs and tax). Write no new pricing maths. The bill line, history entry, CSV and printed or exported document must show the user's name, the quantity with the user's unit, the rate, and the line total, exactly as other lines do. The line name is the user's name, not "Custom item". Existing work items must look and behave identically when the custom option is not selected.

B2. Validation for the custom fields, enforced in the page (not trusted from the model): name 1 to 60 characters after trim; unit 1 to 12 characters; quantity a finite number greater than zero; rate a finite number greater than zero. Failure shows a plain one-line message beside the field and does not add the line. No `undefined`, `NaN` or `[object` text anywhere in any mode.

B3. Extend `MMGR_CALC_CHECK` and `MMGR_CALC_POPULATE` to accept a custom line: `custom` with `label`, `unit`, `qty`, `rate`, and `source`. `MMGR_CALC_CHECK` reports exactly which of the four are missing or invalid, in plain words, one entry per field, so the assistant can ask for only what is missing. `MMGR_CALC_POPULATE` fills the form, validates, and adds the line through the same `calcBoqAdd` dispatch as the Add to bill button. A proposal and a click must remain one code path. Existing calls with `work`, `d1`, `d2`, `d3`, `measuredQty` behave exactly as before.

B4. The assistant conversation, exact behaviour (put these in `SYSTEM_PROMPT`):
- A matching row exists and `in calculator: yes`: quote it and propose it through the existing `PROPOSAL:` form, unchanged.
- A matching row exists and `in calculator: no`: quote the JIC figure and ask in one sentence whether the user wants it added as a custom line at that rate, or at their own rate. Wait for the answer. On yes, ask only for what is missing (the quantity; the unit is the row's metric unit).
- No matching row: say, in these words or a very close plain variant, `There is no rate for <the item, in the user's words> in the rate book. Give me your own rate and the quantity, and I will fill it in for you.` Then ask only for the pieces still missing: the rate, the quantity, the unit. One short message, never a form-like list of questions.
- Never invent a rate. A custom rate must be a number the user typed in this conversation, or the metric rate of a row the assistant quoted. If the user says "I don't know", say that the line cannot be added without a rate, and offer to leave the item out of the estimate or to add it once they have a figure. Do not suggest a rate.
- Confirm in one line before adding: `<label>: <qty> <unit> x <currency> <rate>`, stating the currency.

B5. A second `PROPOSAL:` form, with the existing form kept word for word. The new form is one final line, same rules (no code fences, nothing after it): `PROPOSAL: {"custom":{"label":"...","unit":"...","qty":<number>,"rate":<number>,"source":"user"|"JIC <Trade> #<n>"},"note":"<one short line>"}`. The panel parses both forms and shows the same two choices as today (add to the calculator, or generate a file to download). The proposal chip reads `<label> - <qty> <unit> x <currency> <rate>`.

B6. Self-enforcing guards in the page, because the model can be wrong. A custom proposal is rejected, with a plain notice to the user and no line added, when any of these holds:
- B2 validation fails.
- `source` is `user` and the `rate` number does not appear in any message the user typed in this conversation (compare after removing currency symbols, spaces and thousands separators).
- `source` is a JIC reference and the `rate` does not equal that row's metric rate in the loaded book (compare with the file, to the cent).
- The label or unit contains markup or control characters.
- The line count already equals the bill cap.
The rejection notice reads: `I could not add that line because the rate did not match what you gave me. Tell me the rate again and I will add it.`

B7. Saved state, history, snapshots, estimates, the bill, and workspace sync must carry the custom name and unit so a reload or a recall restores the same line. Reload the page with a custom line on the bill: it is intact. Recall a history entry of a custom line: the fields refill. Do the same for a state saved before this change.

## 4. Cache and service worker

Bump the cache-buster query strings for `calculator-page.js` and `calc-ai.js` in `calculator.html`, and bump the service-worker cache version so installed clients get the change. Confirm `js/jic-rates-full.js` is in the service-worker shell list.

## 5. Verify

1. Run `npm run verify:jic` and `npm run verify`. Both must pass in full. Do not edit a gate to make it pass. Run, and confirm still green and unchanged in output: `tools/qa-calc-golden.cjs`, `tools/qa-calc-trade-coverage.cjs`, `tools/qa-calculator.cjs`, `tools/qa-calculator-page.cjs`, `tools/qa-calc-assistant.cjs` (existing assertions), `tools/qa-calc-workspace.cjs`.
2. Produce a diff summary listing every function changed. Confirm none of the forbidden files or work items in section 1 appear. If one does, revert it and redo.
3. Extend `tools/qa-calc-assistant.cjs` with Playwright checks, new browser profile, intercepting `/api/ai/chat` to capture the system message and to feed scripted model replies. Register them in the test registry. Each is a named assertion.

Part A:
- N1. Fresh profile, "what rates do you have": system text contains the scope line with `811` and all 11 trade names with counts, and not `Active rate book: none`.
- N2. "rate for excavation in stiff clay": first rate line is the stiff clay row, with its metric rate read from the file, not typed in the test.
- N3. For each of the 11 trades, one representative question returns a row of that trade first.
- N4. "block walls", "painting walls", "tiles" each return a relevant row.
- N5. With an imported book active holding the same item, both sources appear and the imported row is first.
- N6. Block the `jic-rates-full.js` request: system text contains the exact failure line from A2, and the page does not hang.
- N7. The rate section never exceeds 9000 characters and no row is cut mid-line.
- N8. Exactly one `jic-rates-full.js` script tag exists after opening both the assistant and the rate-book card.
- N9. The original `PROPOSAL:` instruction text is unchanged, and an original-form proposal still adds a line exactly as before.

Part B:
- C1. Pick `Custom item (your own rate)`: the four fields show; pick any other work item: they are hidden and the form is identical to before.
- C2. Name "Generator hire", unit "day", quantity 3, rate 12000: bill line shows the name, `3 day`, the rate and the total; the total equals quantity times rate plus the page's normal on-costs and tax, checked against an independent calculation in the test.
- C3. Each invalid input in B2 (empty name, 61-character name, empty unit, zero or negative or non-numeric quantity and rate): line not added, plain message shown, no `undefined`, `NaN` or `[object` text anywhere.
- C4. Scripted model conversation: user asks for a rate that exists in no row. The reply sent to the model for that turn carries the no-rate instruction, and when the scripted reply asks for a rate, then the user answers "my rate is 4500 per m2 for 80 m2", the scripted custom proposal is accepted and the line is added through the same dispatch as Add to bill.
- C5. Scripted proposal with a rate the user never typed (for example 9999): rejected with the exact B6 notice, no line added.
- C6. Scripted `JIC` proposal with a rate that differs from the file by one cent: rejected. With the exact file rate: accepted.
- C7. Scripted proposal with markup in the label (for example an angle-bracket tag): rejected, and nothing renders as HTML.
- C8. Row with `in calculator: no`: the system text marks it so, and a scripted accepted proposal adds it as a custom line at the file's metric rate with the row's metric unit.
- C9. Reload with a custom line on the bill: intact. Recall a history entry of a custom line: fields refill. A state saved before this change (use a fixture from an existing test) loads and prices identically to its recorded total.
- C10. CSV and the printed or exported document include the custom line's name, quantity, unit, rate and total.
- C11. Both proposal forms in one conversation work back to back; the bill cap of 60 lines is respected.
4. Screenshots of the custom item form, the proposal chip, and the rejection notice at 390px and 1280px wide, light and dark. Inspect them yourself. Fail the run on overflow, clipped text, blue, orange where gold belongs, a lock icon, or emoji.
5. One manual spot check through the real page, no live model: fresh profile, ask a question, read the captured request, and report the first five rate lines.

## 6. Report back

Reply with only: files changed, the diff summary from step 5.2, the tail of `npm run verify`, N1 to N9 and C1 to C11 as pass/fail, the screenshot paths, and the five lines from 5.5. If anything fails, fix it and re-run before reporting. Do not report partial completion.

## 7. Open item to flag, not fix

Four trades (masonry, joinery, plumbing, welding) hold exactly 100 rows each; carpentry holds 99 and excavation 95. A stop at exactly 100 suggests the source page may have been capped. Do not change data. In your report add one line stating, from `JIC_Rate_Book_2025-2027_FULL.md`, the highest row number present for each of the 11 trades so the owner can compare with the source page.
