# FIELD FINDINGS DIRECTIVE - 2026-10-28 (Wave G)

Source: the owner's live test of the calculator assistant (6 inch block wall, 100 ft x 100 ft, then
100 ft x 50 ft, imperial) plus the exported CSV `estimate-6-inch-block-wall-2026-10-28.csv`.
These findings are NOT covered by `REFINEMENT-DIRECTIVE-2026-10-24.md` (waves D, E, F). They extend it.
Each finding below was traced in the code on 2026-10-28; file and line references are from HEAD `acf2462`
and may have moved, so run each STATE CHECK first.

Rules that apply to every task: `CONTINUATION-DIRECTIVE.md` locked rules, one commit per task, a gate that
passes before the next task, a field-guide card for anything the user can see, `node build.js` after any
`js/` edit, bump `sw.js`, `npm run verify` before any deploy. The model never does money arithmetic; the page
does. After each task passes its gate, update `REFINEMENT-PROGRESS.md` in the same commit (flip the box, add
the commit hash and gate result, recompute the scoreboard). Do not pause between verified tasks.

ORDER: G-1 first (it is a money error). Then G-2, G-3, G-4, G-5, G-6, G-7, G-8, G-9. Do all of Wave G before
resuming the SW-8 and Wave E/F items in the progress file.

---

## G-1  A rate quoted per square metre priced a square-foot quantity (10.76 times too high)

PROOF. The export shows `Work rate (all-in)`, quantity 10000 square feet, rate 1529.00, amount 15,290,000.00.
The rate book row is Masonry #6 "Lay 6" Blocks & Fill All Pockets (Ground Floor to First Floor)": imperial
1278 per Yd.Sq. (`ir`/`iu`), metric 1529 per m2 (`mr`/`mu`). 1529 is a per-m2 rate. Correct subtotal for
10,000 sq ft is 1,111.11 Yd.Sq. x 1278 = J$1,420,000 (metric route: 929.03 m2 x 1529 = J$1,420,487), tax at
15 percent gives J$1,633,000. The app printed J$17,583,500.

CAUSES (all in `js/calc-ai.js` and `js/calculator-page.js`):
1. The assistant prompt has no grammar for a rate book row. `jicTrade`, `jicRef`, `jicRate` do not appear in
   `calc-ai.js`, although `calcCheck` (calculator-page.js, the `key === 'jic'` branch) already prices a picked
   row. So the model said the locked sentence "That figure is in the book but not in my calculator - you set
   the rate" for a row that IS in the calculator, then built a `custom` line with unit "square feet" and the
   metric rate.
2. `b6CustomGuard` only proves the rate equals a metric row rate; it never checks that the custom line's unit
   matches that rate's unit. The C8 quantity guard covers only the `measuredQty` path.
3. The bill, CSV and sheet print the rate with no unit, so nobody can see "1529 per what".

DO:
a. Teach the assistant row proposals: `PROPOSAL: {"work":"jic","jicTrade":"<trade id>","jicRef":"<ref>","d1":<qty in the user's units>,"units":"metric"|"imperial","note":"..."}`.
   Give the model the row `ref`, description, and BOTH published rates with their units in every rate-book
   line it is shown (`calcRateBookText`). The model quotes the figure in the user's unit system; the PAGE
   converts the quantity into the row's unit for that system (ft2 to Yd.Sq. for `ir`, ft2 to m2 for `mr`) and
   prices it. Build one conversion table for every unit string in `src/data/ratebook.js` (`Yd.Sq.`, `Ft.Sq.`,
   `Ft.Run`, `Yd.Cu.`, `100 Sq.Ft.`, `100 F.S.`, `100 Ft.Sq.`, `Lb.`, `Kg.`, `In.`, `100mm`, `Doz.`, `Load`,
   `Each`, `No.`, `Ea.`, `m`, `m2`, `m3`). An unknown unit string fails closed with a plain sentence.
b. The locked sentence 2 may only be said when `jicRowFor` cannot resolve a row. Keep sentences 1, 2, 4, 5
   word for word; sentence 3 is amended in G-6.
c. Extend `b6CustomGuard` with a unit-family check. If a custom line's unit is a different unit family or
   system from the unit of a published row whose rate equals the custom rate (within 0.5 percent), refuse
   with a plain message that names both: "That rate (1,529) is the book's price per square metre, but your
   quantity is in square feet. I can add it as 929.03 square metres at 1,529, or you can give me your own
   per-square-foot rate." Offer the two outcomes as ASK buttons (AI-3 already renders ASK).
d. Every priced line shows its rate WITH its unit ("1,529.00 per m2") in the bill, the on-screen estimate,
   the print sheet, the CSV (new `rate_unit` column) and the spreadsheet.

GATE T-RATEUNIT (new `tools/qa-rate-unit.cjs`, wired into `ci.yml` and `docs/CI-TEST-COVERAGE.md`):
- Fixture 100 ft x 100 ft, Masonry row 6, imperial: subtotal 1,420,000 (plus or minus 1), total with 15 percent
  tax 1,633,000 (plus or minus 2). Same job in metric (929.03 m2): subtotal within 0.1 percent of the imperial one.
- Loop EVERY rate book row in both unit systems: converted quantity x rate = the same money within 1.5
  percent. Rows outside tolerance are listed in `docs/RATE-UNIT-OUTLIERS.md` with the reason; the gate fails if
  a row is outside tolerance and not listed, and fails if the list holds a row that is now within tolerance.
- A `custom` proposal of 10000 "square feet" at 1529 is refused with the message in (c). It can never reach the bill.

## G-2  `hidden` buttons in the assistant panel always show

PROOF. Screenshots: a plain work proposal shows "Apply these settings" and a custom proposal shows "Use my own
rate". `calc-ai.js` marks them `hidden` (the `data-cai="settings"` button is created `hidden`; `els.myrate` and
`els.settings` set `.hidden`). `.btn { display: inline-flex }` (css/mmgr.css:2687) outranks the UA `[hidden]`
rule and there is no global `.btn[hidden]` guard. `tools/verify-hidden-attr.cjs` states in its own header
that it checks only static HTML, so JS-built markup escaped it.

DO: add `.btn[hidden] { display: none; }` once, directly after the last `.btn` display rule in `css/mmgr.css`.
Extend `tools/verify-hidden-attr.cjs` to scan the HTML strings inside `js/*.js` (any element string carrying a
`hidden` attribute and a class that has a display rule) and fail on an unguarded one.
GATE: the extended `verify:hidden` passes; Playwright (in `qa-calc-controls.cjs` or a new file): custom proposal
-> `[data-cai=myrate]` and `[data-cai=settings]` are not rendered (offsetParent null); work proposal with no
`settings` -> `[data-cai=settings]` not rendered; proposal with `settings` -> rendered.

## G-3  The raw `PROPOSAL: {...}` line shows in the chat

PROOF. Screenshots 1 and 3 show the JSON as the assistant's message. `parseProposal` (calc-ai.js, near line
612) returns `json ? clean || s : s`: when the reply is only the machine line, `clean` is empty and it falls
back to the whole string.
DO: when `json` parsed, never show the machine line. If the prose is empty, show a one-line summary the PAGE
builds from the proposal ("6 inch block wall, 5,000 sq ft, imperial. Choose how to add it below."). Same for
`ASK:` (parseAsk already keeps a malformed line on screen on purpose; leave that).
GATE: unit test in the assistant harness: reply that is only a PROPOSAL line renders a summary and no `PROPOSAL`
text anywhere in the log; reply with prose renders the prose only.

## G-4  "The form did not price that line: check the quantities" when the quantity was fine

PROOF. The sentence is `calculator-page.js` `calcPopulate`: `'check the quantities.'` is the fallback when
`render()` returned nothing. `computeFor` returns `null` in one place only (`const w = WORK[key]; if (!w) return null;`),
which means the work key did not resolve at pricing time. The proposal carried `measuredQty: 5000`, so the
message blames the wrong thing. The same failure made "Generate a file" say "Nothing is priced on this page".
CAUSE NOT YET PROVEN (no browser was available to reproduce). Candidates to test in this order: the family
filter / work combobox (`syncLabels` -> `syncFamily` -> `applyFamilyFilter`, UI-1 `mmgr-combobox.js`) dropping
the programmatic `sel.value`; `render()` returning early because `calc-output` is missing on this page; a work
select value left over from a previous `custom` line.
DO: (1) write `tools/repro-populate.cjs` that populates a `custom` line, then the exact proposal
`{"work":"blockwall","units":"imperial","measuredQty":5000}`, and prints which step returns nothing; (2) fix the
cause, not the message; (3) make the message honest: when no result came back, say "I could not select
<work label> on the calculator. Pick it from the list and press Populate again."; when `r.error` exists, show it.
The words "check the quantities" are removed everywhere.
GATE T-POP: for EVERY key in `WORK`, in BOTH unit systems, on the measured-total path AND the dimensions path,
`calcPopulate` returns `ok:true` with a positive total, including when run straight after a `custom` line and
after a different trade. Wire into `ci.yml`.

## G-5  "Those settings are already what you asked for" shown as an error

PROOF. `calculator-page.js` (end of `calcApplySettings`) returns `ok:false` with that text when nothing
changed, so the panel paints a warning triangle for a state that is fine. With G-2 fixed the button no longer
shows without settings; the wording must also change for the case where it does.
DO: return `ok:true, unchanged:true, same:[{label, value}...]`. The panel shows a neutral note (no warning
icon) naming what is already in force: "Already set: Tax 15 percent, Overhead 0 percent." Click once, apply, done.
Refused keys keep their own message.
GATE: applying the same settings twice: first returns `changed` non-empty, second returns `unchanged:true`
with labels, and the panel's second note has no warning class.

## G-6  Say what "quantity" means, in plain words

OWNER (2026-10-28): not everyone knows what quantity means; explain it; do not show a bare error.
DO: amend locked sentence 3 (owner approval 2026-10-28). Replacement, word for word:
"I need one more number before that can price: <name of the missing box>. That is <plain meaning>, for
example <worked example>." The page supplies the box label, meaning and example from `calcCheck().missing[].hint`
(extend each `WORK` entry with a one-line `meaning` and `example` where it lacks them: area is length x height,
for example 100 ft x 50 ft = 5,000 sq ft; a run is the length along the line; a count is how many). The words
"quantity or rate" never appear without a one-line definition. When the user gives length and height, the
model sends `d1`/`d2` (the page multiplies); it only sends `measuredQty` when the user states one total.
GATE: harness assertion that every `WORK` key has `meaning` and `example`; every `missing` reply built by the
page contains both; the string "check the quantities" is absent from `js/` (grep gate in `verify-ratebook-wording`
or a new `verify-assistant-wording.cjs`).

## G-7  Keep the measurement; change only what the user changed

OWNER (2026-10-28): "I gave it 100 ft by 50 ft. It should have kept that and changed the block to eight inch."
PROOF. `calcPopulate`'s `put()` deliberately clears every box a proposal omits (the B1/F-4 fix, so a second
line cannot inherit the first line's height). The proposal grammar has no `variant`, so "8 inch block wall"
became a free-text `note` and the block size was never set.
DO: (1) the panel remembers the last proposal and sends it to the model as a `CURRENT LINE: {json}` block with
the rule "when the user changes one thing, send the complete proposal again with the same d1, d2, d3,
measuredQty and units and change only that field"; (2) add `"variant":"<key>"` to the grammar, and give the
model each work's variant keys and labels in `calcRateBookText`; the page sets `#calc-variant` and refuses an
unknown key; (3) the F-4 clearing rule stays as it is.
GATE: scripted exchange "6 inch block wall, 100 ft x 50 ft" then "make it 8 inch": the second populated line has
the same d1 and d2 and the 8 inch variant, and the first line is untouched.

## G-8  The exported file formatting

PROOF (CSV in hand): the CSV cannot carry column widths, wrapped cells or number formats; that is the file
format, not a bug. The page already has a real spreadsheet (`Spreadsheet` button, `calcXlsx`, `js/xlsx-lite.js`,
4 sheets, fixed widths, frozen header, money format), but the assistant's "Generate a file to download" only
builds the CSV. The CSV and the sheet also have content defects:
- Roll-up row prints `0.00` under a total of 17,583,500: it sums the saved bill (empty) while the Cost section
  prices the single line. Its detail reads "discount 5% / 0".
- `Assumption` rows full of `-` and `none`, and a currency code repeated on every row including rows with no money.
- Empty `Document no`, `Client`, `Project address` rows.
- The sheet's `Cost breakdown` drops quantity, unit and rate (`moneyRow` keeps only label, detail, amount), so
  "10000 square feet x 1529" is lost in the file where it matters most.
DO:
a. Assistant "Generate a file" builds the spreadsheet by default (the CSV stays as a second link). File name
   from the document title, as today.
b. Extend `js/xlsx-lite.js` (no new dependency): column widths computed from the longest cell in each column
   (characters + 2, clamped 12 to 60) instead of fixed numbers; wrap text on Detail and Assumption value columns
   with row height auto; header row bold with a fill and frozen; money format `#,##0.00`, quantity format
   `#,##0.00`, integers `#,##0`; the currency code in the amount header, not on every row; landscape page setup,
   fit to one page wide, header row repeated; autofilter on the Bill sheet.
c. `Cost breakdown` columns: Line, Detail, Quantity, Unit, Rate, Rate unit, Amount.
d. CSV: keep the machine layout, but drop assumption rows whose value is `-`, empty or `none`, drop empty
   Document rows, fill `currency` only on money rows, and add `rate_unit`.
e. Roll-up: when the bill is empty, the roll-up row uses the priced line; the discount detail reads
   "Discount 5 percent" and the row is omitted when no discount is set.
GATE T-XLSX (extend `verify-render-exports.cjs` or `tools/xlsx-probe.py`): unzip the generated file and assert:
every column width is at least the longest cell length (up to the clamp); long text cells have wrap; header row
frozen; every money cell has a number format; the cost row carries quantity, unit and rate; spreadsheet numbers
equal the CSV numbers; no assumption row with `-`; roll-up equals the estimate subtotal when the bill is empty.

## G-9  Point the user to Print / PDF

OWNER: the assistant should direct the user to the PDF button because it can only give a CSV.
PROOF. The page's buttons are `Print / PDF`, `Spreadsheet` and `CSV` (calculator.html, `#calc-out-actions`).
DO: after a successful Populate or file generation, the assistant says in one line: "For a PDF, press Print /
PDF above the estimate. For Excel, press Spreadsheet." and the panel shows a "Print / PDF" button that runs the
page's `calcPrint` action on the populated line. Use the on-page button labels exactly. Add one line to the
assistant prompt: it can build a spreadsheet or CSV, but a PDF comes only from the Print / PDF button.
GATE: after Populate the chat contains the sentence and the panel button; clicking it opens the print flow for
the populated line (same code path as the page button).

---

## EXIT CHECK FOR WAVE G
`npm run verify` green with the new gates (T-RATEUNIT, T-POP, T-XLSX, extended verify:hidden, wording gate),
all Wave G boxes ticked in `REFINEMENT-PROGRESS.md` with commit hashes, field-guide cards added for: rate book
rows in the assistant, plain-words prompts, Print / PDF pointer, the new spreadsheet layout. Then deploy and
probe live: the 100 ft x 100 ft Masonry row 6 job reads J$1,420,000 subtotal, J$1,633,000 total.
