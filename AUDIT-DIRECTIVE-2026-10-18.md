# My MaNaGeR - AUDIT DIRECTIVE (3 SPRINTS) - 2026-10-18

**Audience:** the terminal AI that builds My MaNaGeR. **Author:** a read-only audit session.
**This file changes no code.** It is the work order. Copy it to the repo root as
`AUDIT-DIRECTIVE-2026-10-18.md` (`*.md` is already in `.assetsignore`, so it is never deployed).

**Supersedes for ordering purposes:** nothing is deleted. `CONTINUATION-DIRECTIVE.md` stays the
history. Where this file and an older directive disagree on ORDER, this file wins. Where they
disagree on a locked owner RULE (section 1), the older locked rule wins and you note it in the log.

---

## 0. HOW TO RUN THIS FILE (read once, then obey)

1. Run the three sprints in order: **S1, then S2, then S3** (section 9). Never start a sprint
   before the previous sprint is committed, deployed and live-probed green.
2. Inside a sprint, work the tasks in the listed order. Each task has an ID (C1, G2, S-1 ...).
   Every task ends with a **GATE**. A gate is a command or a test whose pass/fail needs no
   judgement. A task is DONE only when its gate passes. Gate output is pasted into the log.
3. A passed gate is not a pause point. Go straight to the next task. Stop and report ONLY for:
   (a) a security-relevant failure, (b) a new test failure not already listed here,
   (c) a decision this file does not answer. Everything else you decide yourself using the
   rules in section 1.
4. Do not re-derive anything marked **CONFIRMED**. Do not trust anything marked **[VERIFY]**:
   reproduce it first (the repro recipe is given), then fix it.
5. Write the directive-style log entry and `reflection.txt` at the end of each sprint
   (rules 1.9 and 1.10 below).
6. If a task's premise turns out false (the file moved, the line differs), search for the
   symbol named in the task, fix it there, and log the corrected location. Never skip a task
   silently. Every task ends DONE, DEFERRED (with a reason that cites this file), or ANSWERED
   (already correct, with evidence).

### 0.1 Evidence tags used below

| Tag | Meaning |
|---|---|
| **CONFIRMED-ARTIFACT** | Proven from the owner's own files: the two quote CSVs and the Gantt PNG exported on 2026-10-18. |
| **CONFIRMED-STATIC** | Proven by reading the code, running eslint, parsing the DOM, or doing the arithmetic. |
| **[VERIFY]** | Strong suspicion that could not be proven without a browser. Reproduce first. |

### 0.2 What the audit actually ran (so you know its limits)

- `node --check` on every file in `js/`, `src/`, `worker.js`, `sw.js`: all pass.
- `node --test test/*.test.mjs`: 117 of 117 pass.
- `eslint js src worker.js`: 0 errors, 156 warnings. The real defects among them are in section 6.
- An HTML parse of `calculator.html` to find the true parent of `.bcp-result` (task C5).
- A line-by-line read of the calculator engine, the AI panel, the CSV/print code, the Gantt PNG
  code, the schedule roll-up, the procurement module header, `worker.js` headers and cookies.
- **Not run:** any browser test, `npm run verify` (esbuild's native binary in `node_modules` is
  the Windows one), the live site. That is why some items are **[VERIFY]**.

---

## 1. LOCKED RULES (inherited, non-negotiable) AND NEW NEVER-BREAK RULES

### 1.1 Inherited owner rules (all still in force)

1. **No emoji on any served page or JS string.** SVG sprite icons only (`css/mmgr-icons.svg`).
2. **No em dash (U+2014) and no en dash (U+2013) in any served copy.** Use commas, periods, "to".
3. **Plain language.** No jargon on user faces. Fields are labels, not paragraphs.
4. **Consistency by reference.** Before adding any element, find its sibling already in the app
   and match it (this is why the calculator switches in C7 reuse the project page's `.tgl`).
5. **Gold is the brand accent, not orange.** Call it gold in copy and tokens.
6. **Liquid Glass hierarchy:** glass for the functional layer only, solid for content. Never
   glass on glass. Respect `prefers-reduced-motion` and `prefers-reduced-transparency`.
7. **Commits are plain Conventional Commits. No AI attribution, no "Generated with", no
   Co-Authored-By trailer, no emoji.**
8. **Every new feature ships its `mymanager-field-guide.html` entry in the SAME change.**
9. **`reflection.txt` is rewritten at the end of every session.** Specific: files, functions,
   errors, line numbers, verification results.
10. **`CONTINUATION-DIRECTIVE.md` gets a STATUS LOG entry after every completed project.**
11. **Never create a review zip without the owner saying so.**
12. **Paddle keys and secrets are assumed already set.** Work on the wiring only. Never touch
    secrets.
13. Deploy only from a clean staging copy under `$HOME/mmgr-deploy` (never `/tmp`, never the
    repo root). Live probes use `https://mymanagerworkspace.com` only.
14. The owner removed pinned Calculate / Add to bill buttons on 2026-10-13 (`css/mmgr.css`,
    `.bcp-run { position: static }`). **Do not re-pin those buttons.** C6 below is a read-only
    estimate panel and a read-only mobile total bar. They carry no action buttons.
15. Part H decisions stand: the Procurement tab ships behind `data-pack="procurement"`; `proc`
    is a grantable editor scope; namespace is `ns.Proc`; state key is `supplierBook`.
    Supplier prices are entered by hand from each supplier's own rates, never from the JIC book.

### 1.2 NEW never-break rules (this audit adds them; each has a countermeasure)

| # | Rule | Countermeasure (enforced by a script, not by good intentions) |
|---|---|---|
| N1 | **One physical quantity has one canonical unit inside the engine, and every entry point declares what unit it is writing.** No bare number crosses a boundary. | `tools/verify-units.cjs` (section 10, T1) runs the golden table and fails the build on any drift. |
| N2 | **A money figure on any document must reconcile to ESTIMATED TOTAL through visible rows.** | Reconciliation gate in T2: sum of printed rows equals the printed total to the cent, for CSV, XLSX, PDF and screen. |
| N3 | **A model rate is never shown or charged in a currency it was not written in.** | Engine returns an error, never a fallback (task C2). Gate: T3. |
| N4 | **A CSS selector that depends on DOM nesting is tested against the real DOM.** | `tools/verify-print-dom.cjs` (T4) fails when a print selector matches nothing. This is the exact bug class that blanked the PDF. |
| N5 | **No `Math.random()` for anything a person could guess to gain access.** | `tools/verify-no-weak-random.cjs` (T5). |
| N6 | **Every export function is covered by a golden-file test that opens the produced bytes.** | CSV, XLSX, PDF, PNG and SVG tests in T2 and T6. |
| N7 | **Any interaction must paint feedback within 100 ms and finish within 200 ms (INP target) on a 4x CPU-throttled profile.** | `tools/qa-inp.cjs` (T7). Fails the sprint on a regression. |
| N8 | **Every change that touches `js/`, `css/` or an HTML page bumps the `sw.js` shell version and re-runs `npm run verify:csp`.** | Already in `npm run verify`; the sprint gate runs it. |
| N9 | **No file the agent must read is larger than 40 KB.** `CONTINUATION-DIRECTIVE.md` is 812,455 bytes. See task H-1. | `tools/verify-doc-size.cjs` (T8). |
| N10 | **Feature flags guard every risky change.** A kill switch exists before the change ships (section 11). | Flag table in `js/mmgr-state.js` flags block; the gate checks the flag exists. |

---

## 2. EXECUTIVE SUMMARY OF FINDINGS

| ID | Area | Finding | Severity | Evidence |
|---|---|---|---|---|
| C1 | Calculator | "Quick total" ignores the unit system. Typing or sending 10,000 means 10,000 m2 even in imperial mode. | **Critical** (money 10.8x wrong) | CONFIRMED-ARTIFACT + STATIC |
| C2 | Calculator | The two rates the owner saw: `blockwall` variant labelled "JIC Masonry #1" carries the **USD model** 22/28, and an empty rate field falls back to that USD model and is charged as JMD. | **Critical** | CONFIRMED-ARTIFACT + STATIC |
| C3 | Calculator | Roll-up line ignores Overhead & margin, so it is lower than ESTIMATED TOTAL. Subtotal row sits after the Overhead row. | High | CONFIRMED-ARTIFACT |
| C4 | Calculator | CSV is unusable in a spreadsheet: mixed column counts, spacer rows, unformatted numbers. | High | CONFIRMED-ARTIFACT |
| C5 | Calculator | Print/PDF prints a **blank page**: the print allow-list selector never matches the real DOM. | **Critical** | CONFIRMED-STATIC (DOM parse) |
| C6 | Calculator | Estimate panel scrolls away; there is no sticky rule at all. | Medium | CONFIRMED-STATIC |
| C7 | Calculator | Five options are bare native checkboxes. The app already has a switch component. | Medium | CONFIRMED-STATIC |
| C8 | AI panel | Prompt says "Use metric units", the PROPOSAL line has no unit field, and the page context never says which unit system is on. The model guesses. | **Critical** | CONFIRMED-STATIC |
| C9 | AI panel | Populate and Download "do nothing": design makes Download impossible before Populate; chip shows blank quantity; root cause of Populate failure needs a browser repro. | High | STATIC + **[VERIFY]** |
| C10 | AI panel | Proposal chip prints `blockwork -  x  ` (blank qty/unit) for every `work` proposal. | Low | CONFIRMED-STATIC |
| C11 | AI panel | The assistant cannot create a file on request. | Medium | CONFIRMED-STATIC |
| G1 | Gantt export | Phase bars use stale stored dates, not a roll-up of their children. P3 to P9 bars are wrong. | **High** | CONFIRMED-ARTIFACT |
| G2 | Gantt export | Row order is array order. 14 orphan rows print above P0. | High | CONFIRMED-ARTIFACT |
| G3 | Gantt export | Milestones print as thin slivers, not diamonds. | Medium | CONFIRMED-ARTIFACT |
| G4 | Gantt export | Header: first partial month unlabelled, day numbers collide. | Medium | CONFIRMED-ARTIFACT |
| G5 | Gantt export | Dependency lines share one channel and cross the whole chart. | Medium | CONFIRMED-ARTIFACT |
| G6 | Gantt export | No WBS number, duration, dates, % complete columns. Dark-only. PNG-only. | Medium | CONFIRMED-STATIC |
| G7 | Gantt export | Long schedules exceed the browser canvas limit and export a blank or failed PNG. | High | CONFIRMED-STATIC (math) |
| P1 | Procurement | Part H is mid-build and uncommitted. Steps H5.5 to H5.12 are pending. | High | CONFIRMED-STATIC |
| S-1 | Security | Client access codes use `Math.random()`. | **High** | CONFIRMED-STATIC |
| S-2 | Privacy | No cookie / storage consent mechanism on any page. Third-party scripts are allowed by CSP. | High | CONFIRMED-STATIC |
| S-3 | Security | Full-sampling persisted logs and traces on every request. | Medium | CONFIRMED-STATIC |
| D-1 | Defect | `showToast` is called where it is not defined (3 places) and `toast` once. Throws after the action ran. | **High** | CONFIRMED-STATIC (eslint) |
| X-1 | Performance | Each keystroke runs a synchronous, full re-render pipeline. 90 `backdrop-filter` rules, 18 `transition: all`, a full-viewport WebGL shader. | **High** | CONFIRMED-STATIC |
| H-1 | Process | `CONTINUATION-DIRECTIVE.md` is 812 KB (about 200k tokens). No agent can read it. | High | CONFIRMED-STATIC |

---

## 3. DEPENDENCY AND SEQUENCING MAP ("if I change this, what moves?")

```
C1 unit boundary  ------------>  C8 AI units  ------------>  C9 populate/download
        |                              |
        +--> P-units (procurement      +--> golden tests T1
        |    quantities reuse C1)
C2 currency/variant honesty --->  C3 reconciliation ---->  C4 XLSX/CSV ----> C5b true PDF
        |
        +--> C-rate-sanity banner (reads C2 data)

C5 print selector fix ----------> C5b true PDF download -> T6 export golden tests
C6 sticky panel  --(needs)-->   no ancestor with overflow hidden (task C6 step 1)
C7 switches      --(needs)-->   .tgl styles exist in css/mmgr.css (reference: project.html)

G1 phase roll-up --> G2 ordering --> G3 milestones --> G4 header --> G5 links --> G6 columns/themes
G7 canvas-limit guard goes BEFORE any change that makes the export bigger (G6 adds columns).

X-3 measure (INP probe) --> X-1 render scheduler --> X-2 paint cost --> X-4 click feedback
S-2 consent  --must precede-->  enabling any analytics script on any page
D-1 toast fix --> required before any test that clicks Save template
P1 finish H5 --> P2.. procurement upgrades (they all sit on ns.Proc and supplierBook v20)
H-1 doc split --> must happen FIRST in S1 so later sessions can read the plan
```

Order rules that follow from the map:

- C1 before C8: the AI must send a unit; the page must know what to do with it first.
- C2 before C3, C4: exports must print corrected numbers.
- C5 before C5b: fix the broken selector, then build the download.
- G7 before G6: guard the canvas size before adding columns that widen the chart.
- X-3 before X-1 and X-2: measure first so the fix is provable.
- S-2 before any analytics: no tracking script loads before consent exists.
- H-1 first: split the 812 KB directive so every later session can read the plan.

---

## 4. CALCULATOR AND AI PANEL (files: `calculator.html`, `js/calculator-page.js`, `js/calc-ai.js`, `css/mmgr.css`)

### C1. Quick total ignores the unit system (CONFIRMED)

**Symptom (owner):** "100 feet by 100 feet, that is 10,000 square feet" came out as square metres.

**Proof, from the exported CSV:** `Quantity: 107,639 sq ft (about 10,000 m2)`, `Units entered: imperial`.
The engine held **10,000 m2**. The correct engine quantity for 100 ft x 100 ft is
`(100 x 0.3048) x (100 x 0.3048) = 929.0304 m2`. The error factor is 10.7639.

**Root cause (js/calculator-page.js `computeFor`, around lines 1930 and 2000 to 2030):**

```js
const mqRaw = parseFloat(st.measuredQty != null && st.measuredQty !== '' ? st.measuredQty : st.measuredAuto);
...
const d1 = imp ? raw1 * (IMP_D1_FACTOR[key] || FT) : raw1;   // dimension boxes DO convert
...
hasMq ? { qty: mqRaw, unit: mqUnit, ... }                    // Quick total does NOT convert
```

The dimension boxes convert feet to metres when `st.units === 'imperial'`. The Quick-total path
(`measuredQty`) never converts. The box is relabelled `Total m2` (`renderQuickLine`), so a person
or the AI typing "10,000" in imperial mode gets 10,000 m2.

**Trap you must not fall into:** `measuredQty` is also WRITTEN BY CODE with values that are
already in engine units (instance rows at about lines 8746 to 8752, 8819, 8870, 8960). If you
convert at read time for everything, those programmatic writes get converted twice. So the fix
is an explicit entry flag, not a blanket conversion.

**Fix (self-enforcing design):** add one new state field, `measuredEntry`, with exactly two values:
`'eng'` (the number is already in the engine unit, the legacy and programmatic meaning) and
`'imp'` (the number is in the imperial entry unit shown on the box). A missing field means `'eng'`,
so every saved estimate recalls exactly as before.

```js
// 1) One table. Engine unit -> imperial entry unit name -> factor TO the engine unit.
const IMP_ENTRY = {            // names match UNIT_CONV.imp so labels stay consistent
  m2: { name: 'sq ft', toEngine: 0.09290304 },
  m3: { name: 'cu yd', toEngine: 0.764554858 },
  m:  { name: 'ft',    toEngine: 0.3048 },
  L:  { name: 'US gal', toEngine: 3.785411784 }
};                             // 't', 'each', 'point', 'square' have no imperial entry: factor 1

function toEngineQty(value, entryFlag, engineUnit) {
  const row = IMP_ENTRY[engineUnit];
  return entryFlag === 'imp' && row ? value * row.toEngine : value;
}
function fromEngineQty(value, entryFlag, engineUnit) {
  const row = IMP_ENTRY[engineUnit];
  return entryFlag === 'imp' && row ? value / row.toEngine : value;
}

// 2) readState(): add   measuredEntry: ($('calc-measured-qty') || {}).dataset.entry || 'eng',
//    applyState(): restore it:  $('calc-measured-qty').dataset.entry = st.measuredEntry || 'eng';

// 3) computeFor(): right after `canon` is built, convert ONCE, then use mqQty everywhere
//    that used mqRaw below this point (qr, modelMr, the fencing height rate).
const mqEngineUnit = st.measuredUnit || canon.unit || '';
const mqQty = hasMq ? toEngineQty(mqRaw, st.measuredEntry, mqEngineUnit) : 0;

// 4) The box's own input handler stamps the flag from the CURRENT unit system:
$('calc-measured-qty').addEventListener('input', function (e) {
  e.target.dataset.entry = _units === 'imperial' ? 'imp' : 'eng';
  render();
});

// 5) Every programmatic writer sets the flag explicitly to 'eng' next to its .value write.
//    Inventory (grep -n "calc-measured-qty\|measuredQty" js/calculator-page.js) and tag each.

// 6) Unit toggle: when the box holds a typed number, keep the PHYSICAL quantity, not the digits.
//    old = fromEngineQty(toEngineQty(v, oldFlag, u), newFlag, u)   (round to 4 dp)

// 7) Label: in imperial mode the box placeholder and aria-label say "Total sq ft" (use
//    qtyShown(1, unit) naming), and the read-out under it prints both units:
//    "10,000 sq ft (about 929.03 m2) x J$1,747 = J$1,623,016 before overhead and tax".
```

**GATE C1:** `node tools/verify-units.cjs` (T1) passes. Golden cases:

| Input | Engine m2 | Displayed |
|---|---|---|
| imperial, dims 100 ft x 100 ft | 929.0304 | 10,000 sq ft (about 929.03 m2) |
| imperial, Quick total 10,000 (flag imp) | 929.0304 | 10,000 sq ft (about 929.03 m2) |
| metric, Quick total 10,000 (flag eng) | 10,000 | 10,000 m2 (about 107,639 sq ft) |
| legacy saved state, no `measuredEntry`, value 10,000 | 10,000 | unchanged from today |
| imperial slab 30 ft x 20 ft x 150 mm | 55.7418 m2 x 0.15 = 8.3613 m3 | unchanged from today |

---

### C2. The "two stupid rates" (CONFIRMED)

**What the owner saw (the two CSVs, same job, same 10,000 m2 by mistake):**

| | "Measured - by the unit" | "All-in rate" (JIC book) |
|---|---|---|
| Rate | material 22 + labour 28 per m2 | 1,747 per m2 |
| ESTIMATED TOTAL (JMD) | 588,500 | 19,217,000 |

Same job, a **32.7x** gap. Two separate defects cause it. Fix both.

**Defect 2a, the USD model is charged as JMD.** `WORK.blockwall.rate = { mat: 22, lab: 28 }`
(js/calculator-page.js line 164) is a **US-dollar planning model**. With currency JMD and no
exchange rate the prefill correctly leaves the rate fields EMPTY (E1 "currency honesty"). But the
engine then silently falls back to the raw model:

```js
const mr = matPresent ? matRaw : modelMr;            // line ~2162: empty field -> USD 22
const lr = labPresent ? labRaw : av ? av.rate.lab : w.rate.lab;   // USD 28
```

so USD 22 and 28 are charged as `J$22` and `J$28`. The CSV even says
`Exchange rate: not set - model rates are US dollars` right beside the J$ total.
(The comment at line 2121 admits "callers flag that case"; the flag does not stop the charge.)

**Defect 2b, the label lies.** The first `blockwall` variant is labelled
`8 in blocks fill all pockets GF to FF (JIC Masonry #1)` but its rate is the USD model, not the
JIC book number (which is 1,747 per m2 all-in). The CSV prints that label as the variant.

**Fix:**

```js
// A) compute(): flag the situation the engine cannot know (it reads localStorage, computeFor is pure)
st._fxMissing = st.currency !== BASE_CURRENCY && fxFactor(st.currency) == null;

// B) computeFor(): after matPresent/labPresent are known. Never fall back across currencies.
if (!isCustom && !isJic && !allIn && !dayBasis &&
    !(matPresent && labPresent) && st._fxMissing) {
  return { error: 'No exchange rate is set for ' + st.currency +
    ', so the planning model (US dollars) cannot price this line. Choose "All-in rate" to use the ' +
    'JIC book, type your own material and labour rates, or add a rate in Exchange rates.' };
}

// C) variants: relabel honestly. The pre-conversion model keeps its id ('standard') so old
//    saves recall, but the label must say what it is.
//    label: 'Planning model, US dollars (block, mortar, ties)'
//    and add the JIC masonry rows as real variants carrying THE BOOK'S NUMBERS ONLY (allIn),
//    OR leave them to the JIC picker. Never label a USD figure "JIC".
```

**Defect 2c, the chooser words hide the difference.** Rename the three `calc-basis` options in
plain language and put the numbers on screen so the owner sees both before choosing:

| Value | Old text | New text |
|---|---|---|
| `measured` | Measured - by the unit | Your own split - material rate plus labour rate |
| `allin` | All-in rate - one combined rate | Book rate - one combined rate (JIC 2025 to 2027) |
| `days` | Days on site - a crew rate per day | Crew days - a rate per day |

Add a **rate comparison strip** under the chooser (read-only, no buttons):

```
Per m2:  Book (JIC) J$1,747   |   Your split J$ -- (add a rate)   |   Model needs an exchange rate
```

and a **sanity banner** when two priced rates for the same line differ by more than 3x:
`These two rates differ by 32.7 times. Check the currency and the unit before you send this.`
Implementation: a pure `rateSanity(ratesByBasis)` returning `{ ok, ratio }`, covered by T3.

**GATE C2:** T3 passes: (a) JMD, no FX, empty rate fields, basis `measured` returns the error
above and never a total; (b) USD currency still prices the model exactly as today (golden:
10 m2 x (22+28) = 500 before on-costs); (c) the CSV never contains a variant label containing
"JIC" next to a non-book rate; (d) JMD with FX 157.0 converts and flags nothing.

---

### C3. Documents do not reconcile (CONFIRMED-ARTIFACT)

From the CSVs: `Subtotal 535,000`, `Overhead & margin 53,500`, `ESTIMATED TOTAL 588,500`, but
`Roll-up (bill + site costs, less discount) 508,250 = 535,000 x 0.95`. The roll-up ignores
overhead and margin, so it is **80,250 below** the estimate total on the same page. In CSV B:
`16,596,500` against `19,217,000`. Also the `Subtotal` row prints AFTER `Overhead & margin`
although it is the amount BEFORE it.

**Fix (N2):**
1. Row order in every export: line items, `Subtotal (before overhead and margin)`,
   `Overhead & margin`, `Subtotal after overhead`, `Tax`, `ESTIMATED TOTAL`.
2. The roll-up either includes overhead and margin or is labelled
   `before overhead and margin`. **Decide by reading `rollup()`: if the planning waterfall is
   deliberately works-only, keep the maths and fix the label; do not change the maths.** Log
   which one it was.
3. Money display: `fmtMoney` rounds to whole units (`Math.round(v)`). Rates below 10 (a USD
   rate of 5.50) print wrong, and per-line rounding can break the sum. Print money with two
   decimals in documents (`Intl.NumberFormat(locale, {style:'currency', currency, maximumFractionDigits: 2})`)
   and keep whole units only on the dense screen cards.

**GATE C3 (T2):** for every export format, `sum(printed rows) == printed total` to the cent for
five golden estimates (blockwork all-in; blockwork split in USD; labour only; day basis; JIC
picker line).

---

### C4. CSV and the missing spreadsheet (CONFIRMED-ARTIFACT)

The CSV mixes 2-column and 3-column rows, has blank spacer rows, embeds units in text
(`107,639 sq ft (about 10,000 m2)`), and prints amounts as raw digits. Excel treats it as one
messy sheet. Ship **two** exports and keep the current button name:

1. **Spreadsheet (.xlsx)**, the default "Export" action. Four sheets, real number formats, frozen
   header rows, column widths, a printable layout:
   `Summary`, `Cost breakdown`, `Assumptions`, `Bill of quantities`.
   CSP is `script-src 'self'`, so do **not** load SheetJS from a CDN. Vendor a zero-dependency
   writer. An .xlsx is a ZIP of XML files; a "stored" (no compression) ZIP needs only CRC-32:

```js
// js/xlsx-lite.js  (about 150 lines; no emoji, no inline script, add to the calculator bundle)
// API:  XlsxLite.build([{ name:'Summary', rows:[[...],[...]], widths:[28,40,16], numFmt:{C:'#,##0.00'} }])
//       -> Uint8Array
// Steps: [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels,
//        xl/styles.xml (cellXfs: 0 general, 1 bold header, 2 money #,##0.00, 3 percent 0.0%),
//        xl/worksheets/sheetN.xml (inlineStr cells, <cols>, <sheetViews><pane ySplit="1" state="frozen"/>),
//        then a stored-ZIP container with local headers, central directory, CRC-32 table.
function crc32(buf){ let c, crc=-1; for (let n=0;n<buf.length;n++){ c=(crc^buf[n])&255;
  for (let k=0;k<8;k++) c = c&1 ? (c>>>1)^0xEDB88320 : c>>>1; crc=(crc>>>8)^c; } return (crc^-1)>>>0; }
```

2. **Flat CSV (.csv)**, for machines. One schema, fixed columns, RFC 4180, UTF-8 BOM, CRLF,
   numbers as plain numerics (no thousands separators, no units in the number cell):
   `section,item,detail,quantity,unit,rate,amount,currency`. Every row has all 8 fields.
   Dates ISO-8601.

**GATE C4 (T2):** open the produced .xlsx with `python3 -c "import zipfile;zipfile.ZipFile(path).testzip()"`
(returns `None`), unzip it, parse `sheet1.xml` as XML, assert the Summary total cell equals
ESTIMATED TOTAL. Parse the CSV with Python's `csv` module and assert every row has exactly 8 fields.

---

### C5. Print / PDF prints a blank page (CONFIRMED-STATIC)

**Proof (DOM parse of `calculator.html`):** the Estimate card sits at
`html > body > main.bcp-main > div.bcp-grid > section.bcp-result`. The print CSS
(`css/mmgr.css` lines 10530 to 10565) does:

```css
body.print-estimate .bcp-main > * { display: none !important; }          /* hides .bcp-grid and everything in it */
body.print-estimate .bcp-main > .bcp-result { display: block !important; } /* matches NOTHING: .bcp-result is not a direct child */
```

The wrapper `.bcp-grid` is hidden, the allow-list selector matches nothing, so the printed
page is empty. (Owner: "the PDF was easy to read, now it is broken.")

**Fix:**

```css
@media print {
  @page { size: A4; margin: 14mm 12mm 16mm; }
  body.print-estimate { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* allow-list that survives wrapper changes: hide siblings, keep the path to .bcp-result */
  body.print-estimate .bcp-main > *:not(.bcp-grid) { display: none !important; }
  body.print-estimate .bcp-grid { display: block !important; }
  body.print-estimate .bcp-grid > *:not(.bcp-result) { display: none !important; }
  body.print-estimate .bcp-grid > .bcp-result { display: block !important; position: static !important;
    max-height: none !important; overflow: visible !important; box-shadow: none !important; }
  .calc-line, .bcp-qh-top, .bcp-qh-sig { break-inside: avoid; }
}
```

Also review the **seven** separate `@media print` blocks in `css/mmgr.css` (lines 6856, 6948,
10530, 12814, 14091, 14144, 15065). Keep one calculator print block and leave the app ones alone;
seven blocks editing the same page is how a selector like this goes stale unnoticed.

**C5b, a real PDF (Sprint 2):** the browser print dialog is not a "PDF export". Add a
**Download PDF** action that builds the PDF in the page. Vendor a small PDF writer (jsPDF is MIT;
vendor the minified file into `js/vendor/`, add its hash to the CSP verification, add to
`.assetsignore` exclusions only if it is not a runtime asset: it IS a runtime asset, keep it
served). Keep **Print** as a second action. If vendoring is rejected by `verify:csp`, keep the
print route and add `document.title = <document name>` before `window.print()` so the saved PDF
is named correctly.

**GATE C5 (T4 and T6):** `tools/verify-print-dom.cjs` parses `calculator.html`, extracts every
`body.print-estimate ...` selector from `css/mmgr.css`, and fails if any "show" selector matches
zero elements. Playwright `page.pdf()` on a priced estimate must produce a PDF whose text
contains `ESTIMATED TOTAL` and whose page count is at least 1 and at most 3.

---

### C6. The estimate panel scrolls away (CONFIRMED-STATIC)

There is no `position: sticky` anywhere on `.bcp-result` (the only "sticky" text in the CSS is
the comment that removes pinned buttons). The grid is `minmax(0,5fr) minmax(0,4fr)`.

**Desktop fix:**

```css
@media (min-width: 901px) {
  .bcp-grid { align-items: start; }           /* required: stretch defeats sticky */
  .bcp-result {
    position: sticky;
    top: calc(var(--bcp-topbar-h, 64px) + 12px);
    max-height: calc(100dvh - var(--bcp-topbar-h, 64px) - 24px);
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
}
```

Step 1 of the task: walk every ancestor of `.bcp-result` up to `<html>` and assert none has
`overflow` other than `visible` (an `overflow: hidden` ancestor silently disables sticky). Write
that check as a Playwright assertion.

**Mobile (max-width 900px):** add a read-only **total bar** fixed to the bottom:
`Estimate  J$1,785,318  [Show]`. Tapping Show scrolls the estimate card into view. It holds
**no Calculate or Add to bill button** (rule 1.14). It respects
`env(safe-area-inset-bottom)` and hides when the estimate card is already on screen
(IntersectionObserver). `aria-live="polite"` is already on the card; the bar is `aria-hidden`
to avoid double announcement. No glass on the bar (solid surface, content layer).

**GATE C6:** Playwright: scroll the page 1,500 px; the Estimate card's bounding box top stays
between `topbar + 12` and `topbar + 40`; on a 390 px viewport the bar exists and contains no
`<button data-action="calcBoqAdd">`.

---

### C7. Real switches instead of bare checkboxes (CONFIRMED-STATIC)

Native `<input type="checkbox">` at `calculator.html` lines 289, 361, 367, 484, 583 (and
`calc-sig-show`). The project page already has the app's switch:
`<label class="tgl"><input type="checkbox" ...><span class="tsl"></span></label>`
(`project.html` line 1603 and many more). Reference it, do not invent a second one (rule 1.4).

Build each option as a **setting row** (a structure, not a lone box): label on the left,
one-line plain explanation under it, the switch on the right, whole row clickable.

```html
<div class="bcp-opt">
  <div class="bcp-opt-txt">
    <label for="calc-labour-only" class="bcp-opt-name">Labour only</label>
    <span class="bcp-opt-hint" id="calc-labour-only-hint">Skip material prices. List materials separately.</span>
  </div>
  <label class="tgl"><input type="checkbox" id="calc-labour-only" role="switch"
         aria-describedby="calc-labour-only-hint"><span class="tsl"></span></label>
</div>
```

Hard requirements: touch target at least 44 x 44 CSS px for the whole row; visible `:focus-visible`
ring; knob moves with `transform` only (no layout animation); `prefers-reduced-motion` removes the
transition; dark and light parity; IDs and `data-action` attributes unchanged so no JS moves.

**GATE C7:** `npm run verify:a11y`, the axe harness in both palettes, and a Playwright check
that clicking the row text toggles the input.

---

### C8. The AI converts units by guessing (CONFIRMED-STATIC)

**Root cause, three parts:**
1. `SYSTEM_PROMPT` in `js/calc-ai.js` says `Use metric units.` The owner speaks feet.
2. The PROPOSAL schema is `{"work":"<key>","d1":<number>,"note":"..."}` with **no unit field**.
   `calcPopulate` writes `d1` straight into `#calc-d1`, which means "whatever unit the page is
   currently in".
3. `MMGR_CALC_AI_CONTEXT` (js/calculator-page.js line ~11614) sends work key, quantity, totals,
   but **never the unit system** and never the unit of each dimension box.

**Fix principle (N1): the model never converts. The page converts, in JavaScript, and shows its
working.**

```js
// 1) PROPOSAL gains a required "units" field: "metric" | "imperial".
//    PROPOSAL: {"work":"blockwall","units":"imperial","d1":100,"d2":100,"note":"100 ft by 100 ft wall"}
//    PROPOSAL: {"work":"blockwall","units":"imperial","measuredQty":10000,"note":"10,000 sq ft"}
//    Mixed units from the user -> the model asks ONE short question and sends no PROPOSAL.

// 2) SYSTEM_PROMPT replaces "Use metric units." with:
//    'Never convert units. Copy the numbers the user gave you and set "units" to the system the user
//     spoke in (feet and square feet are imperial, metres and square metres are metric). If the user
//     mixes systems, ask which one to use before proposing. The page does all conversions.'

// 3) calcPopulate(v): BEFORE writing any box
if (v.units === 'imperial' || v.units === 'metric') {
  setUnits(v.units, false);                 // labels become (ft)/(sq ft) so the box names its unit
}
// measuredQty proposals stamp the entry flag so C1 converts them:
// $('calc-measured-qty').dataset.entry = v.units === 'imperial' ? 'imp' : 'eng';

// 4) MMGR_CALC_AI_CONTEXT adds:
//    'Unit system on screen: ' + _units
//    'This work item measures in: ' + unit + ' (boxes: ' + labels + ')'
//    and MMGR_CALC_RATEBOOK lists, per work key, "d1 = Length (m), d2 = Height (m)" verbatim.

// 5) Echo before add (the chip becomes a confirmation, not a decoration):
//    "Blockwork wall: 100 ft x 100 ft = 10,000 sq ft (about 929.03 m2). Add to the bill?"
//    The numbers come from calcCheck().preview via qtyShown(), never from the model's text.

// 6) Fail-closed assertion in calcPopulate after render():
const expected = expectedEngineQty(v);       // independent pure function from declared units
if (Math.abs(r.qty_engine - expected) > 1e-6 * Math.max(1, expected)) {
  return { ok: false, error: 'The quantity did not match what you said, so nothing was added.' };
}
```

**GATE C8 (T1 + AI harness):** the exact owner sentence "100 feet by 100 feet" through a mocked
relay (copy `mockRelay`, `sendQ`, `sysOf` from `tools/qa-calc-assistant.cjs` verbatim) yields
engine quantity 929.0304 m2 and a chip that reads `10,000 sq ft (about 929.03 m2)`. A second case,
"30 metres by 10 metres", yields 300 m2. A third, mixed ("30 m by 10 ft"), yields **no proposal**
and one question.

---

### C9. Populate and Download "do not work" ([VERIFY] plus a design fault)

**Static facts (CONFIRMED-STATIC):**
- `Generate a file` calls `MMGR_CALC_FILE = buildCsv`, which returns `{ok:false}` when
  `lastResult` is empty. So pressing Download **before** Populate can never work. The owner pressed
  Download on a fresh proposal. That is a design fault, not just a bug.
- `Populate` runs a long chain: `MMGR_CALC_CHECK` then the guards then `calcPopulate` then
  `render()` then `ACTIONS.calcBoqAdd()`. Any miss returns a notice; a silent no-op was not found
  statically.
- **Repro recipe for the runtime failure (do this first):** Playwright, mocked relay returns the
  C8 proposal, click Populate, capture `console` errors and the `notice` text, then click Download.
  Log exactly which step stops.

**Fix:** make Download independent of Populate by pricing the proposal in a sandbox, using the
pure engine that already exists:

```js
// js/calculator-page.js
function previewProposal(v) {                 // PURE: never touches the form, bill or storage
  const st = stateFromProposal(v);            // readState() shape built from v + defaults
  const r = computeFor(st);
  return r && !r.error ? Object.assign(r, { name: workNameFor(v) }) : null;
}
window.MMGR_CALC_FILE = function (proposal) {
  const r = proposal ? previewProposal(proposal) : lastResult;
  return r ? buildExportFrom(r) : { ok: false, reason: 'nothing priced' };
};
// calc-ai.js onMakeFile(): call fn(proposal) so a pending proposal downloads without Populate.
```

Offer ONE combined action next to the two existing ones: **Add to calculator and download**
(Populate then file). Keep the existing two buttons.

**C10 (chip text):** `renderProposalChip` builds `label + ' - ' + qty + ' ' + unit + ' x ' + rate`
from fields a `work` proposal does not have. For `work` proposals read the preview from
`MMGR_CALC_CHECK(proposal).preview` and print `name - qty unit`. **GATE:** chip text never contains
the substrings ` -  x ` or `undefined`.

**GATE C9:** Playwright: (a) proposal, Download only, a chip with a real file appears, opening
the bytes shows the right total; (b) proposal, Populate, bill gains one line; (c) combined action
does both.

---

### C11. The assistant must be able to create a file when asked

Today the chat can only hand out the calculator CSV. Add a **file block** the page renders as a
download chip, entirely client-side:

````
```file name="quote-notes.md" type="md"
...content...
```
````

Allowed `type`: `csv`, `txt`, `md` only (the attachment allow-list is already PDF, CSV, TXT, MD).
Rules: filename sanitised to `[a-z0-9._-]`, max 1 MB, never `html`, `js`, `svg` or any executable
type, content shown as plain text, `Blob` URL revoked on unmount (the module already tracks
`chipUrls`). Also offer **Copy** on every assistant message and a **Download as .md** on any
table. Prompt line: `If the user asks for a file, put the content in one file block.`

**GATE C11:** a mocked reply containing a file block with `name="../../x.html"` yields a chip named
`x.html.txt` (type coerced to txt, path stripped) or is rejected; a valid `.md` block downloads
byte-identical content.

---

## 5. GANTT CHART EXPORT (file: `js/mmgr-app.js`, function `exportGanttPNG`, lines 1393 to 1760; roll-up in `js/mmgr-schedule.js` `computePlan`, line 458)

The owner's PNG (`bank-renovation-gantt-2026-10-18.png`, 122 rows, 26 Oct 2026 to 8 Apr 2027) shows
every defect below. Read the PNG beside this list.

### G1. Phase bars are stale (CONFIRMED-ARTIFACT)

The export draws each phase row from `t.startDate` and `t.endDate` as stored. The roll-up
(phase span = min child start, max child finish) only runs inside `applyPlan` (Cascade Dates).
Anything that edits a child afterwards leaves the phase stale. In the PNG: the P3, P4, P6, P7, P8
and P9 summary bars end weeks before their own children (P8 summary ends about 10 Feb while its
children run 22 Mar to 6 Apr).

**Fix, two layers:**
1. **Export layer (immediate, safe):** compute the displayed span from the children at export time:

```js
function phaseSpan(phase, all) {
  const kids = all.filter(c => !c.isPhase && c.startDate && c.endDate &&
    (c.parentId === phase.id || c.parentName === phase.name));
  if (!kids.length) return { start: phase.startDate, end: phase.endDate };
  return {
    start: kids.reduce((m, c) => (c.startDate < m ? c.startDate : m), kids[0].startDate),
    end:   kids.reduce((m, c) => (c.endDate   > m ? c.endDate   : m), kids[0].endDate)
  };
}
```
   Use it for the bar, the `minDate/maxDate` window and the connectors.
2. **State layer:** run the same roll-up from the schedule module after ANY date edit
   (`ns.Schedule.rollupPhases()` called from the task update path in `js/mmgr-tasks.js` near
   line 216 and 234, and after drag in the Gantt). One function, three callers, so the live
   chart and the export can never disagree.

**GATE G1:** a test builds a project where a child ends later than its phase; the export's phase
bar end equals the child's end; the live Gantt phase bar equals the export's.

### G2. Row order and orphans (CONFIRMED-ARTIFACT)

Rows print in array order. The PNG starts with **14 unlabelled rows** (Site survey + measured
drawings ... Fire extinguishers & first-aid stations mount) above the first phase, P0. They carry
an orange phase tab and baseline bars: leftover tasks with no parent.

**Fix:** build `rows` as: for each phase in order, the phase row then its children sorted by
`startDate` then WBS; then a final group **"Unassigned tasks"** for tasks with no resolvable
parent. Never drop a task. Also write the count to the legend line:
`122 rows, 14 unassigned`. Add a one-time notice in the app (not the PNG): `14 tasks have no
phase. Move them into a phase or delete them.` Do not delete user data automatically.

**GATE G2:** no task id from state is missing from the export rows (assert set equality).

### G3. Milestones print as slivers (CONFIRMED-ARTIFACT)

"Phase gate: pre-construction complete", "Utility locator ...", "Certificate of occupancy
amendment" print as thin bars. The export only draws a diamond when `t.milestone` is true.

**Fix:** `const isMs = t.milestone || t.duration === 0 || t.startDate === t.endDate && /gate|sign-off|complete|milestone|certificate/i.test(t.name)`.
Also find where the project generator creates zero-duration rows and set `milestone: true` there
(`grep -n "Phase gate" js/*.js`). Milestones get a label to the right of the diamond.

### G4. Header (CONFIRMED-ARTIFACT)

Month name is drawn only on day 1 (`d.getDate() === 1`), so the first partial month (October in
this file) has no label. Day numbers are 10 px text in 14 px columns and collide on two-digit days.

**Fix:** three bands. Band 1 months (label at the first visible day of each month), band 2 week
numbers or week-start dates, band 3 day numbers **only when `dayWidth >= 18`**, otherwise ticks.

### G5. Dependency lines (CONFIRMED-ARTIFACT)

Every link is drawn with the vertical leg at `x1 + 5`, so links from different predecessors
stack on one channel and cut across 100 rows. The overlap branch (`x2 <= x1 + 2`) draws no
arrowhead. Lines are drawn above the bars.

**Fix:** draw links **before** bars (so bars cover them); default to **critical-chain links plus
links spanning at most 8 rows**; add a dialog toggle `All links`; route the vertical leg through a
per-source lane `x1 + 6 + 3 * (laneIndex % 4)`; arrowhead on every link; lag links dashed;
cap total drawn links at 1,500 with a visible `+N hidden links` note.

### G6. Table columns, themes, formats (CONFIRMED-STATIC)

The export has labels and bars only. Compare MS Project, Primavera P6, Procore Schedule,
SmartSheet.

**Add:**
- A left table with **WBS number, Task, Duration (d), Start, Finish, % complete, Assignee**, with
  the column set chosen in the export dialog (G8).
- **Light (print) theme** next to the current dark one. White background, dark text, same
  critical gold darkened to `#a8870f`. Dark-only exports waste ink and fail on projectors.
- **Phase summary style:** a black bracket bar with end ticks and the rolled-up dates, visibly
  different from tasks (today they are the same blue as a task).
- **Progress fill** inside each bar from `% complete`.
- **Today line, weekend shading and week-start lines** kept.
- **Formats:** PNG (kept), **SVG** (vector, string-built from the same draw list) and **PDF**
  (vector, paginated landscape, repeated header row, A4 or A3, fit-to-width). Draw once into a
  neutral list of primitives `{type:'rect'|'text'|'line'|'poly', ...}` and render that list to
  canvas, SVG and PDF, so the three outputs can never differ.

### G7. Canvas size limit (CONFIRMED-STATIC, arithmetic)

`canvas.width = W * 2`, `W = padL + totalDays * 14 + padR`. A 3-year schedule is
`1,095 x 14 = 15,330` px, times 2 is 30,660 px, above the common 16,384 px canvas side limit
and the roughly 268 million pixel area limit. `toBlob` then returns null or a blank image and the
owner sees `Export failed.` or a black PNG.

**Fix (do this FIRST in S2, before G6 widens the chart):**

```js
const MAX_SIDE = 16000, MAX_AREA = 2.6e8;
let scale = 2;
scale = Math.min(scale, MAX_SIDE / W, MAX_SIDE / H, Math.sqrt(MAX_AREA / (W * H)));
if (scale < 0.75) { /* too big for one image: auto-switch to dayWidth by weeks, or paginate */ }
```

Also pick `dayWidth` from the window so the logical width is at most 3,200 px: 14 px per day up to
about 230 days, then 7, 3, 1.5 px per day with a week or month header (G4).

### G8. Export dialog (design)

One modal (solid surface, no glass on content) opened by **Export Chart**: format (PNG, PDF, SVG),
theme (Dark, Light), page size (Fit, A4, A3), columns (checkboxes using the C7 switches), links
(Critical only, Near, All), baseline on or off, date range (Whole project or from/to), phase
filter. Remember the last choice per project in `ui` state, not in project data. Default
selection must produce a good export with zero clicks.

**GATE G (T6):** Playwright exports PNG, SVG and PDF for the bank-renovation fixture
(add `test/fixtures/bank-renovation.json` from the owner's data): PNG decodes, width and height
under the limits; SVG parses as XML and contains 122 `<text>` row labels plus the 14 unassigned;
PDF text contains `Management reserve` and the last phase name; all three list the same task
count; phase bars equal the rolled-up spans.

---

## 6. DEFECTS FOUND BY LINT AND READING (all CONFIRMED-STATIC)

| ID | Where | Defect | Fix |
|---|---|---|---|
| D-1 | `js/mmgr-app.js` lines 2876, 2883, 2898 | `showToast` is not defined in that scope (it is defined in a different closure; lines 601 and 1036 are in the right scope). `saveAsTemplate` and `deleteTemplate` do the work and then THROW a ReferenceError, so the user sees no confirmation and the console shows an error. | Use `window.MMGR.App.showToast(...)` (the pattern at `mmgr-app.js:203`). Add an ESLint `no-undef` error gate (it is currently a warning). |
| D-2 | `js/mmgr-google-auth.js:80` | `toast` is not defined. | Same fix. |
| D-3 | `js/calculator-page.js` 8419 to 8424, 11660 | `MMGRTheme` and `MMGR` read bare after a `window.X &&` guard. Probably safe, but the unguarded second use (`MMGRTheme.isDark()` inside the branch) is fine only because the guard passed. | Leave; add `/* global MMGR, MMGRTheme */` to silence and document. |
| D-4 | `js/mmgr-cloud-dash.js` lines 34, 522 to 525, 1005 | Bare `MMGR`. | Same `global` comment. |
| D-5 | `js/mmgr-calculator.js` 20 `no-redeclare` hits | Copy-paste `var` redeclaration in the in-app calculator. Passes `node --check` only because of `var`. | Rename or merge. Then check parity (D-7). |
| D-6 | `.nvmrc`, `.assetsignore` | Working tree has CRLF line endings (`.nvmrc` is `22\r\n`; `.assetsignore` shows 66 changed lines, all line endings). `nvm use` and some tooling choke on `22\r`. | Add to `.gitattributes`: `.nvmrc text eol=lf`, `.assetsignore text eol=lf`, `*.sh text eol=lf`; run `git add --renormalize .`. |
| D-7 | two calculators | `js/mmgr-calculator.js` (in-app, 2,132 lines) and `js/calculator-page.js` (standalone, 11,663 lines) both price work. Any fix to C1 or C2 must be checked in both. | Task: grep the in-app file for `measuredQty`, `units`, `rate` fallbacks. Either apply the same fix or declare the in-app one frozen and link it to the standalone page. Log the decision. |
| D-8 | `js/calc-ai.js:551` | `currency` assigned and never used in `renderProposalChip`; the chip drops the currency. | Resolved by C10. |
| D-9 | `js/calculator-page.js` `render()` | `out.innerHTML = '<div class="calc-empty">' + r.error + '</div>'` injects an engine string without escaping. Today the strings are fixed, but C2 adds an error that includes `st.currency`. | Use `esc(r.error)`. |
| D-10 | working tree | `.git/objects/87/tmp_obj_gQmkMC` is leftover garbage (`git count-objects` warns). `tmp/` holds 4,466 files and 354 MB; `.git` pack is 57 MB. | `git prune`; keep `tmp/` ignored (it already is); delete session scratch older than 14 days with a script, not by hand. |

**GATE D:** ESLint reports 0 `no-undef` and 0 `no-redeclare`; `git count-objects -v` shows no
`garbage`; a Playwright click on Save template and Delete template shows a toast and no console error.

---

## 7. PROCUREMENT (files: `js/mmgr-procurement.js` (new, 692 lines, uncommitted), `js/mmgr-prompts.js`, `js/mmgr-ai.js`, `project.html`, `css/mmgr.css`, `js/mmgr-bids.js` (existing bid leveling), `tools/qa-procurement.cjs` (new))

### P1. Finish Part H first (CONFIRMED-STATIC: the working tree holds 20 modified files and 2 new, uncommitted)

Execute `CONTINUATION-DIRECTIVE.md` **H5.5 to H5.12 and H8.3 to H8.5 exactly as written there**.
Do not re-derive. Key facts you must not break: namespace `ns.Proc`; state key `supplierBook`;
tab behind `data-pack="procurement"`; `proc` grantable editor scope; quote text may contain only
numbers that exist in the supplier book (H7.2); the XSS case H7.3; field guide entry required.
H7.4 (CSV) and H7.5 (compare view) were deferred to "v1.1": **they are in scope now (P3, P4).**

### P2 to P10. Upgrades, ranked by value to a Jamaican contractor

These come from the market scan the owner asked for. References are named so the agent can read
`web-research/` (it already holds Procore and Buildertrend bid-leveling notes) before building.

| ID | Feature | What it is | Reference | Sprint |
|---|---|---|---|---|
| P2 | **Price history** | Every price edit keeps `{price, quotedAt, quotedBy, qtyBreak}` (append-only, last 12). Sparkline per item. Stale badge keeps the 30-day rule. | Procurify and Coupa price history | S2 |
| P3 | **Supplier price-list import** | CSV and XLSX upload (reuse C4 reader) with a column-mapping step, a dry-run preview, a duplicate-merge rule. Allow-list unchanged: PDF, CSV, TXT, MD for the AI; CSV and XLSX for the import. | Procore Procurement import | S2 |
| P4 | **Compare view** | Matrix: items down, suppliers across, cheapest highlighted, per-item minimum order and lead time, landed total. | `mmgr-bids.js` leveled grid (reuse its layout, do not copy its code) | S2 |
| P5 | **Quantity break pricing** | Tiers per item (`1 to 49: 120`, `50+: 112`). Quote picks the tier from the quantity. | Procurify | S3 |
| P6 | **Landed cost** | Freight, handling, duty, FX and a per-supplier delivery lead time added to the unit price so "cheapest" means cheapest delivered. Uses the C2 currency honesty (never a silent conversion). | Coupa landed cost | S3 |
| P7 | **Calculator to RFQ** | A button on the Bill of quantities: "Request prices for this bill". Creates RFQ lines with quantities in the **C1 canonical units**, sends them to the quote writer for chosen suppliers. | Procore takeoff to RFQ | S3 |
| P8 | **RFQ email pack** | One message per supplier, tone variants, quote validity date, delivery site, payment terms, with a copy button and a `mailto:` open. Numbers only from the book. | Buildertrend bid request | S3 |
| P9 | **Purchase order PDF** | From an awarded quote: PO number from the existing `docNoSuggest`, supplier, lines, delivery date, signature block. Uses the C5b PDF writer. | Procore commitments | S3 |
| P10 | **Lead time to schedule link** | The schedule already has a lead-time lane (`leadtime lane` flag). A supplier lead time on a procured item sets the task's `leadTime` and warns when order date plus lead time passes the task start. | Primavera procurement activities | S3 |

Rules for all of P2 to P10: stay inside `supplierBook` (bump the state version once, with a
migration that seeds old projects), reuse `esc()` for every attribute, no emoji, no em dash,
solid surfaces, both palettes, axe clean, `READONLY_SAFE_ACTIONS` updated, a field-guide card per
feature, a harness case per feature registered in `docs/CI-TEST-COVERAGE.md` **and** `ci.yml`.

**GATE P (S2 end):** `node tools/qa-procurement.cjs` passes all H5.10 cases plus P2, P3, P4;
the quote integrity test proves every money token in the output exists byte for byte in
`MMGR.Prompts.context({vendorId})`.

---

## 8. SECURITY, PRIVACY, PERFORMANCE, PROCESS

### 8.1 Security

**S-1. Client access codes are guessable (CONFIRMED-STATIC, High).**
`src/cloud/client-codes.js` line 233 builds an 8-character access code from a 32-letter alphabet
with `Math.random()`. That is a predictable generator and only 40 bits even if it were secure.
These codes open project sections to outside clients.

```js
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 chars, so 256 % 32 === 0: no modulo bias
function genCode(len = 10) {                            // 10 chars = 50 bits
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] & 31];
  return out;
}
```
Also: (a) keep accepting existing 8-character codes (no forced reset); (b) confirm the code
lookup route is rate limited per IP and per project (`[VERIFY]`: read `src/cloud/client-codes.js`
lookup and `src/router.js`; if absent, add a D1-backed counter with a 5-try, 15-minute lockout and
a constant-time comparison); (c) `src/lib/http.js` line 1135 uses `Math.random()` in an R2 key
suffix. Not a secret, but replace with `crypto.randomUUID()` so rule N5 has zero exceptions.

**GATE S-1 (T5):** `tools/verify-no-weak-random.cjs` greps `src/` and `worker.js` for
`Math.random` and fails on any hit. Unit test: 10,000 generated codes are unique, all characters
come from the alphabet, length is 10.

**S-2. Cookie and storage consent (CONFIRMED-STATIC, High, see 8.2).**

**S-3. Observability cost and privacy (CONFIRMED-STATIC, Medium).** `wrangler.jsonc` sets
`head_sampling_rate: 1`, `persist: true` for logs, traces and invocation logs on every request.
That stores a record of every request, including AI relay and auth routes. Set production
sampling to `0.1` for traces and invocation logs, keep errors at `1`, and add a redaction test:
no log line may contain `Authorization`, `Cookie`, `idToken`, a session token or an API key.
`[VERIFY]` by grepping `src/lib/observe.js` for what is logged.

**S-4. Content security policy (CONFIRMED-STATIC, review).** `style-src 'unsafe-inline'` is
accepted today. The second policy at `worker.js` line 94 allows `'unsafe-eval'`: `[VERIFY]`
that it applies only to the offline transcription route and to no HTML page. Add a test that
fetches every HTML page and asserts the page policy has no `unsafe-eval`.

**S-5. Output escaping surface.** `innerHTML` appears 37 times in `calculator-page.js`, 57 in
`mmgr-render.js`, 35 in `mmgr-cloud.js`. Task: add a lint rule (`no-unsanitized` or a local rule)
requiring every interpolated value in an `innerHTML` template to pass through `esc()` or
`U.escapeHtml()`. Fix what it finds in the same sprint. D-9 is the first known case.

**S-6. AI relay abuse `[VERIFY]`.** There is a free daily cap. Confirm it keys on the signed-in
account and that an unauthenticated caller gets the sign-in response, not a model call. Add a
per-account burst limit (for example 20 requests per minute).

### 8.2 Cookie and storage consent (task S-2, Sprint 3)

**Facts:** no page has a consent mechanism. The session cookie (`mmgr_session`, HttpOnly, Secure,
SameSite=Lax) is strictly necessary for sign-in. The CSP allows third-party scripts from Google
(sign-in), Cloudflare Web Analytics and Turnstile, and Paddle (checkout). The app also stores
many `localStorage` keys on the device (`mmgr_calc_*`, `mmgr_perf_mode`, project data).
Jamaica's Data Protection Act applies to personal data, and visitors from the EU may be covered
by GDPR rules. The owner should confirm the final wording with a lawyer; this file specifies
the mechanism, not legal advice.

**Design (self-enforcing):**
1. **Inventory first.** Create `docs/STORAGE-INVENTORY.md` listing every cookie and every
   `localStorage` or IndexedDB key with purpose and category: `necessary` or `optional`.
   A test fails when code writes a key that is not in the inventory.
2. **Default is necessary only.** No analytics script, no optional storage before the visitor
   chooses. Cloudflare Web Analytics loads only after the `analytics` choice.
3. **Banner:** solid card at the bottom of marketing pages and the sign-in page, three equal
   buttons: Accept all, Necessary only, Choose. Equal visual weight (no dark pattern). Plain
   words, no emoji, no em dash. A **Cookie settings** link in every footer reopens it.
4. **Storage of the choice:** one first-party key `mmgr_consent` = `{v:1, analytics:bool, ts}`,
   listed as necessary. Re-ask every 12 months or when the inventory version changes.
5. **Loader:** a small `js/consent.js` loaded on every page (no inline script, hash gate
   unchanged) that exposes `MMGR.Consent.allows('analytics')` and injects the analytics tag only
   when true. CSP is unchanged because the host is already allowed.
6. **Privacy page** (`privacy.html`) gains the inventory table and a "Change your choice" button.
7. App pages: no banner inside the signed-in app; the choice is in Settings under Privacy.

**GATE S-2:** Playwright: fresh context, load `index.html`, assert zero requests to
`static.cloudflareinsights.com` before the choice; click Necessary only, reload, still zero;
click Accept all, reload, one request; the footer link reopens the banner; axe clean in both palettes.

### 8.3 Performance and responsiveness (tasks X-1 to X-4)

**CONFIRMED-STATIC causes of "buttons do not respond fast":**
- `render()` in `calculator-page.js` (line 7583) runs, synchronously on every `input` event:
  `compute`, `renderQuickLine`, `renderQuoteDoc`, `renderPrelims`, `renderRollup`, `renderCash`,
  `renderAccessories`, `renderCompanions`, then rebuilds the result card with `innerHTML`.
  More than ten input listeners call it (lines 9335 to 10432). The file mentions debounce twice.
- `css/mmgr.css`: 90 `backdrop-filter` rules, 18 `transition: all`, 3 `touch-action`, 3
  `will-change`, all in a 16,688-line file.
- `js/mmgr-glass.js` runs a full-viewport WebGL shader (`requestAnimationFrame(_frame)`) on the
  calculator, app and admin pages, with no frame cap and no device-pixel-ratio cap.
  (It does pause when the tab is hidden, and Performance Mode exists. Keep both.)

**X-3 (do first). Measure.** Add `tools/qa-inp.cjs`: Playwright with `cpuThrottlingRate = 4`,
a `PerformanceObserver({type:'event', durationThreshold:16, buffered:true})`, and a
`long-animation-frame` observer when available. Scenario list: type 6 digits in a calculator
box; click Calculate; toggle a switch; open the AI panel; switch a unit; open the project Gantt;
click a project tab. Record the p75 and worst interaction duration per scenario to
`tmp/inp-baseline.json` BEFORE any change. **Budget:** every scenario under 200 ms, typing
under 100 ms. Fail the sprint if a scenario is above budget after the fix, or worse than baseline.

**X-1. Render scheduler.** Split `render()` into a **light pass** (compute, result line, quick
line) that runs immediately, and a **heavy pass** (rollup, cash plan, prelims, accessories,
companions, quote document) that runs once per frame after input stops:

```js
let heavyQueued = false;
function scheduleHeavy(r) {
  if (heavyQueued) return;
  heavyQueued = true;
  (window.requestIdleCallback || (cb => setTimeout(cb, 60)))(() => {
    heavyQueued = false;
    renderPrelims(r && !r.error ? r.sub : 0); renderRollup(); renderCash();
    renderAccessories(); renderCompanions(lastResult); renderQuoteDoc(lastResult);
  }, { timeout: 250 });
}
```
Rules: the heavy pass must read `lastResult` at run time, never a stale closure; `calcPopulate`,
export and print call `flushHeavy()` first so no export ever reads half-updated cards; replace
`out.innerHTML = ...` with an update that skips the write when the string is unchanged.

**X-2. Paint cost.**
- Cap the shader: `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`, render at most 30
  frames per second, and stop it entirely while a modal or the AI panel is typing.
- Remove `backdrop-filter` from every surface that is not in the functional layer (rule 1.6:
  content is solid). Keep it on header, modals, sheets. Target: under 25 rules.
- Replace all 18 `transition: all` with explicit properties
  (`transform .08s, background-color .12s, border-color .12s, opacity .12s`).
- Add `contain: layout paint` to cards and `content-visibility: auto; contain-intrinsic-size: 0 600px`
  to below-the-fold calculator cards (BOQ, preliminaries, history, saved estimates).
- Never animate `width`, `height`, `top`, `left`, `margin`; animate `transform` and `opacity` only.

**X-4. Click feedback.** Every button gets an `:active` state that paints in the same frame
(`transform: translateY(1px) scale(.98)`), `touch-action: manipulation` on all interactive
elements (removes the tap delay), and long actions show a busy state within 100 ms
(`aria-busy="true"` plus a spinner icon from the sprite) instead of freezing silently.
Honour `prefers-reduced-motion` on all of it.

**GATE X:** `node tools/qa-inp.cjs` meets the budget on the throttled profile; the baseline and
final numbers are pasted into the log.

### 8.4 Process defect (H-1) and housekeeping

**H-1. The plan file cannot be read (CONFIRMED-STATIC).** `CONTINUATION-DIRECTIVE.md` is
812,455 bytes and 4,611 lines (roughly 200,000 tokens). Its own first instruction says "read the
STATUS LOG at the bottom", which starts at line 2307 and is appended to forever. A session
that obeys it burns its context before it starts.

Do this **first thing in Sprint 1**:
1. `git mv CONTINUATION-DIRECTIVE.md docs/history/CONTINUATION-DIRECTIVE-ARCHIVE-2026-10-18.md`
   (the `docs` folder is already in `.assetsignore`).
2. Create a new `CONTINUATION-DIRECTIVE.md` of **40 KB or less** containing, in this order:
   the locked rules (section 1 here plus the owner standing rules), the OPEN work registry, a
   `NEXT SESSION STARTING POINT` of at most 15 lines, and a pointer to this audit file. History
   stays in the archive. New log entries go to `docs/history/log-YYYY-MM.md`, and the active file
   keeps only the last 10 entries.
3. Same treatment for `reflection.txt` (178,887 bytes): keep the last session only; archive the rest.
4. Update `AGENTS.md` and `CLAUDE.md` so the first lines say: "Read CONTINUATION-DIRECTIVE.md, then the
   newest AUDIT-DIRECTIVE. Do not open `docs/history/` unless a task cites it."

**GATE H-1 (T8):** a script fails when `CONTINUATION-DIRECTIVE.md`, `AUDIT-DIRECTIVE-*.md`,
`AGENTS.md` or `CLAUDE.md` exceeds 40,960 bytes. The audit file itself will exceed it; give it a
single documented exception in the script.

### 8.5 Missing or weak features worth adding (kept small, not a revamp)

| ID | Item | Why | Sprint |
|---|---|---|---|
| M-1 | Cookie consent (8.2) | None exists. | S3 |
| M-2 | Data export and account delete in Settings | Basic privacy right; delete cascade tests already exist (`test/delete-cascade.test.mjs`), so the back end is mostly there. | S3 |
| M-3 | Autosave indicator and "last saved" time on the calculator | Offline-first apps need visible state. | S2 |
| M-4 | Undo for the last bill-line delete (toast with Undo for 8 s) | Cheap, prevents data loss. | S2 |
| M-5 | Keyboard shortcuts (Enter calculates, `/` focuses the AI box) with a help sheet | Speed for repeat users. | S3 |
| M-6 | Error boundary for the calculator: a failed render shows one plain line and keeps the form | Today a thrown error leaves a stale card. | S2 |
| M-7 | Money formatting with `Intl.NumberFormat` per currency, two decimals on documents (see C3) | Correctness. | S1 |
| M-8 | A read-only share link or PDF for the estimate | Contractors send quotes; PDF covers it (C5b). | S2 |

---

## 9. THE THREE SPRINTS

Each sprint has the same shape. **Entry gate, ordered tasks, exit gates, commit, deploy, live
probe, rollback, log.** Do not start a sprint until the previous sprint's live probe is green.

### 9.0 Commit and deploy procedure (identical for all three sprints)

1. Work on `main` in small commits as tasks close (Conventional Commits, no AI attribution).
2. Exit gates, in this order, every one must pass:
   `npm run verify` (all sub-checks), the harnesses named in the sprint, the new tripwires
   (section 10), `node build.js`, then `grep -c <new symbol> dist/bundle.js` for one symbol per
   new module (proves the bundle is not stale).
3. Bump the `sw.js` shell version (rule N8). Re-run `npm run verify:csp` and `verify:sw`.
4. Push. **Watch CI to completion.** A red run means fix and re-run, not deploy.
5. Stage: `STAGE="$HOME/mmgr-deploy"; rm -rf "$STAGE"; mkdir -p "$STAGE"` then copy the repo
   excluding `.git .wrangler node_modules .agents _archive tmp` (the exact `tar --exclude` recipe
   is in the comment block of `wrangler.jsonc`). Grep the staged files for the sprint's new
   symbols. Then `cd "$STAGE" && npx wrangler deploy`.
6. Live probe `https://mymanagerworkspace.com` (never `mymanager.app`): the sprint's probe list
   below, with a screenshot saved to `tmp/`.
7. Update `CONTINUATION-DIRECTIVE.md` (new, small version), write `reflection.txt`, add the
   field-guide cards, commit `docs: ...`, push.
8. **Rollback (written before the deploy, used if any probe fails):** `npx wrangler rollback` to
   the previous version, then `git revert` the sprint's merge range, then log what failed.
   Kill switches (section 11) are flipped first when the fault is in one feature.

### SPRINT 1: Correct numbers, safe codes, readable plan  (target: 1 to 2 sessions)

**Goal:** the calculator never prices a wrong number silently; the AI cannot mix units; the PDF is
not blank; known crashes and the weak code generator are gone; the plan is readable.

**Order:**
1. **H-1** split the directive and reflection (do this first).
2. **D-6, D-1, D-2** line endings, toast fixes, ESLint `no-undef` made an error.
3. **T1, T3, T4, T5, T8** tripwires written and failing where the bugs live (red first).
4. **C1** unit boundary (flag, conversion, writers inventory, toggle behaviour).
5. **C2** currency honesty, variant label, chooser words, rate comparison strip, sanity banner.
6. **C3** reconciliation and row order, money format (M-7).
7. **C5** print selector fix, `@page`, review of the seven print blocks.
8. **C8** AI units: prompt, `units` field, context, echo chip, fail-closed assertion.
9. **C9, C10** sandbox pricing for Download, combined action, chip text.
10. **D-7** parity check of the in-app calculator; **D-9** escape; **D-10** prune.
11. **S-1** secure codes, lookup throttle.
12. Run `/code-review` (section 12) over the sprint diff, fix findings.

**Exit gates:** T1, T3, T4, T5, T8 green; the C8 mocked-relay cases; `npm run verify`; the
existing `qa-ai`, `qa-full`, `qa-stress` harnesses; the owner's two CSVs re-created by test and
now reconcile.
**Commit messages (examples):** `fix(calc): convert quick total by unit system`,
`fix(calc): never charge usd model rates as local currency`, `fix(print): match the real dom`,
`fix(ai): send units and convert in the page`, `fix(cloud): crypto random access codes`.
**Live probe:** on the live calculator: imperial, blockwork, type 100 and 100: shows
`10,000 sq ft (about 929.03 m2)`; AI chat "100 feet by 100 feet" adds a line of 929.03 m2; JMD
with no exchange rate and the split basis shows the plain error, not a total; Print preview shows
the estimate (not a blank page); Save template shows a toast.
**Rollback flags:** `flags.calcUnitFlag`, `flags.calcAiUnits` (section 11).

### SPRINT 2: Experience, exports, speed, procurement core  (target: 2 to 3 sessions)

**Goal:** the calculator feels fast and clear, exports are real files, the Gantt export is
correct, and Procurement ships.

**Order:**
1. **X-3** baseline INP numbers (before touching anything).
2. **G7** canvas guard, then **G1, G2, G3, G4** Gantt correctness (state roll-up included).
3. **C4** XLSX and flat CSV; **C5b** real PDF download (or the documented print fallback).
4. **C6** sticky estimate panel and mobile total bar; **C7** switch rows.
5. **C11** file blocks in the AI chat; **M-3, M-4, M-6, M-8**.
6. **X-1** render scheduler, **X-2** paint cost, **X-4** click feedback; re-measure.
7. **P1** finish Part H (H5.5 to H5.12), then **P2, P3, P4**.
8. `/code-review`, fix, `/retro` (section 12).

**Exit gates:** `tools/qa-inp.cjs` within budget; export golden tests (T2, T6); C6 and C7 Playwright
checks; `node tools/qa-procurement.cjs`; axe clean in both palettes on calculator and project pages;
`npm run verify`; full `qa-*` battery.
**Commit messages:** `feat(calc): xlsx and tidy csv export`, `feat(calc): sticky estimate panel`,
`fix(gantt): roll up phases and order rows`, `perf(calc): schedule heavy renders`,
`feat(proc): supplier price book and quote writer`.
**Live probe:** estimate stays visible after scrolling 1,500 px; XLSX opens in Excel with 4
sheets; Gantt PNG for the bank-renovation project has correct phase bars, no unassigned block
above P0, diamonds for gates; typing in a calculator box feels instant; enable the Procurement
pack, add a vendor and items, write a quote.
**Rollback flags:** `flags.calcStickyPanel`, `flags.calcSwitches`, `flags.ganttExportV2`,
`flags.calcRenderScheduler`.

### SPRINT 3: Market-grade finish, privacy, hardening  (target: 2 to 3 sessions)

**Goal:** the Gantt export and procurement reach best-in-class, consent and privacy are in place,
security is hardened, and the code is surveyed for deeper structural problems.

**Order:**
1. **G5, G6, G8** links, columns, themes, SVG and PDF output, export dialog.
2. **P5 to P10** price breaks, landed cost, calculator to RFQ, RFQ email pack, PO PDF, lead-time link.
3. **S-2** consent (inventory first), **M-1, M-2, M-5**.
4. **S-3, S-4, S-5, S-6** observability sampling, CSP check, escaping lint, relay burst limit.
5. Performance polish: confirm every INP scenario is under budget on the throttled profile.
6. `/improve-codebase-architecture` survey (section 12) on `calculator-page.js` (11,663 lines),
   `mmgr-app.js` (4,634), `mmgr-cloud.js` (4,583), `mmgr-render.js` (3,866). Output goes to
   `docs/ARCHITECTURE-CANDIDATES-2026-10.html`. **Do not refactor in this sprint**; list the
   candidates ranked, each with a safe first slice.
7. Full re-audit: re-run every gate in sections 4 to 8 and record pass/fail per task ID in the log.

**Exit gates:** consent test, Gantt and PO export golden tests, security tripwires, full `npm run
verify`, full `qa-*` battery, `qa-inp`, the re-audit table with zero open Critical or High items.
**Commit messages:** `feat(gantt): paginated pdf, svg and light theme`, `feat(proc): rfq pack and
purchase orders`, `feat(privacy): cookie consent and storage inventory`, `chore(obs): sample logs`.
**Live probe:** banner appears on a clean browser and blocks analytics until chosen; Gantt export
dialog produces PNG, SVG and PDF that agree; a purchase order PDF is generated from an awarded quote.
**Rollback flags:** `flags.consentBanner`, `flags.ganttExportV2`, `flags.procPo`.

---

## 10. TRIPWIRES (the countermeasures that make the rules self-enforcing)

Build these as `tools/*.cjs`, register each in `docs/CI-TEST-COVERAGE.md` and add a `ci.yml` step
(a harness that is not registered never runs). Each one starts RED against the current code.

**T1 `tools/verify-units.cjs`.** Uses Playwright against `calculator.html` and the page's
`window.__calcEngine` hook. For each row of the golden table in C1, call `applyState(...)`, then
`computeFor`, and compare `qty` to the expected value with a relative tolerance of 1e-9. Also
asserts: toggling units on a typed Quick total preserves the physical quantity; a legacy state
without `measuredEntry` prices as before; every writer of `calc-measured-qty` sets
`dataset.entry` (static grep: each `.value =` on that element is followed within 3 lines by a
`dataset.entry` assignment).

**T2 `tools/verify-exports.cjs`.** For five golden estimates: build CSV, XLSX and the print DOM;
parse each; assert the printed rows sum to the printed total to the cent (rule N2), the CSV has 8
fields on every row, the XLSX zip is valid and its Summary total equals ESTIMATED TOTAL.

**T3 `tools/verify-currency.cjs`.** The four cases in the C2 gate, plus: no exported file may print
a variant label containing "JIC" beside a rate that is not the book's `metRate` or `impRate`.

**T4 `tools/verify-print-dom.cjs`.** Parse `calculator.html` (a real HTML parser, not a regex),
read `css/mmgr.css`, take every selector that begins `body.print-estimate` and sets
`display:block`, `display:flex` or `visibility:visible`, translate it to a DOM query and assert it
matches at least one element. Also asserts no `> *{display:none}` rule exists whose kept child
has a wrapper between it and the parent. This is the exact check that would have caught C5.

**T5 `tools/verify-no-weak-random.cjs`.** Fails on `Math.random` anywhere under `src/` or
`worker.js`; allows it in `js/` only on a listed line with a `// ok: non-secret` comment.

**T6 `tools/verify-gantt-export.cjs`.** Loads the bank-renovation fixture, exports PNG, SVG and PDF,
checks size limits, task count equality, phase span equality, milestone diamonds present, no
orphan block above the first phase.

**T7 `tools/qa-inp.cjs`.** The X-3 profile and budget.

**T8 `tools/verify-doc-size.cjs`.** The H-1 size gate.

**Pre-commit hook (`.githooks/pre-commit`):** runs T4, T5, T8 and `eslint` with `--max-warnings`
set to the current count, so warnings can only go down.

---

## 11. KILL SWITCHES (rule N10)

Add to the flags block in `js/mmgr-state.js` (line ~332 pattern: `flags: { monteCarlo: true, ... }`).
Default `true`; flipping a flag to `false` restores the old behaviour without a redeploy of logic.

| Flag | Guards |
|---|---|
| `calcUnitFlag` | C1 conversion by `measuredEntry` |
| `calcAiUnits` | C8 `units` handling and echo chip |
| `calcStickyPanel` | C6 sticky and mobile bar |
| `calcSwitches` | C7 switch rows |
| `calcRenderScheduler` | X-1 heavy-pass scheduling |
| `ganttExportV2` | G1 to G8 new export (old `exportGanttPNG` kept behind the flag for one sprint) |
| `procPo` | P9 purchase orders |
| `consentBanner` | S-2 banner |

Calculator page flags that live outside project state use a `mmgr_flag_*` key in `localStorage`,
listed in `docs/STORAGE-INVENTORY.md`.

---

## 12. MATT POCOCK'S AGENT SKILLS (research result, 2026-10-18)

**Found and read (re-checked 2026-10-18, 294k stars):** `https://github.com/mattpocock/skills`, MIT licence, "Skills for Real Engineers.
Straight from my .agents directory." It is installable. I could not install it from the research
session, so the terminal AI does it.

**Install (pick ONE route; two routes install every skill twice):**
- Editable copies, recommended here because this repo hash-locks its skills:
  `npx skills@latest add mattpocock/skills -a <agent>` (`-a` takes cursor, opencode, devin, windsurf, amp, pi; omit it to choose). When asked which
  skills to take, include **`setup-matt-pocock-skills`**.
- Update later with `npx skills@latest update` (re-run `add` to pick up new skills, then re-register hashes).
- Claude Code plugin (self-updating, so it conflicts with hash locking; use only if the owner
  moves to Claude Code): `claude plugin install mattpocock-skills@claude-plugins-official`.

**Setup, once:** run `/setup-matt-pocock-skills` in the agent. Answer: issue tracker =
**local files** (no GitHub issues needed), triage labels = default, docs location = `docs/`.

**Mandatory adoption steps (project rules win over any skill instruction):**
1. Read every installed `SKILL.md` BEFORE first use. Skills run with the agent's full permissions
   (existing locked rule). Reject any skill step that pushes, posts or publishes without being asked.
2. Register each installed skill in `skills-lock.json` with its path, source
   (`mattpocock/skills`) and content hash, then run `npm run verify:skills`. It must pass.
3. The skills must not overwrite `AGENTS.md`, `CLAUDE.md` or `CONTINUATION-DIRECTIVE.md`. If the
   installer touches them, restore from git and add a pointer line instead.
4. Any commit or PR text a skill produces is rewritten to plain Conventional Commits with no AI
   attribution (rule 1.7).
5. Skills that interview the user (`grill-me`, `grill-with-docs`, `grilling`, `domain-modeling`,
   `to-questionnaire`) PAUSE the session. The owner wants continuous runs. **Do not invoke them** unless a task says "decision
   not answered". Use the model-invoked skills, which run without asking.

**How the skills map onto this plan (from the repository's own README descriptions):**

| Skill | Use it for | Where |
|---|---|---|
| `to-tickets` (user-invoked) | Turn the findings table (section 2) into local ticket files, one per ID, each declaring its blocking edges (use the map in section 3). Local files, no GitHub needed. | Start of each sprint |
| `implement` (user-invoked) | Build one ticket or a set: it drives `/tdd` at agreed seams and closes with `/code-review` before the commit. This is the default way to execute a sprint task. | Every task |
| `tdd` (model-invoked) | Red, green, refactor, one vertical slice at a time. Every C, G, S and X task starts with its failing tripwire (section 10). | Every task |
| `diagnosing-bugs` (model-invoked) | C9 (Populate and Download), the X-series lag, any red CI run: build a feedback loop that goes red on the bug, minimise, hypothesise, instrument, fix, add a regression test. | C9, X-1 to X-4 |
| `code-review` (model-invoked) | Two-axis review of the diff (Standards and Spec) run as parallel sub-agents. Run it over the sprint diff before the exit gates. | End of each sprint |
| `codebase-design` (model-invoked) | Deep modules behind small interfaces: the unit boundary in C1 and the export primitives list in G6 are the first two. | C1, G6 |
| `research` (model-invoked) | Procurement market notes, written to `web-research/` as cited Markdown (it runs as a background agent). | P2 to P10 |
| `prototype` (model-invoked) | Throwaway HTML prototype of the Gantt export dialog and the mobile total bar before building them. | G8, C6 |
| `pr` (model-invoked) | Shape of the change summary: smallest clear visual, before and after evidence, merge-danger call (one-way or two-way door, blast radius). Use it for the sprint summary in the log. | End of each sprint |
| `writing-for-agents` (model-invoked) | Write the new small `CONTINUATION-DIRECTIVE.md`, `AGENTS.md` and `CLAUDE.md` so an agent reaches the right doc by pointer. | H-1 |
| `improve-codebase-architecture` (user-invoked) | Survey for deepening opportunities in the four giant files. It presents a visual HTML report and then offers to grill through one candidate: **save the report to `docs/ARCHITECTURE-CANDIDATES-2026-10.html` and stop before the grill step.** | Sprint 3 step 6 |
| `retro` (user-invoked) | Suggest improvements to the agent's own environment (navigation, automated checks, steering files, tooling) after a session, most severe first. Apply the accepted ones to `AGENTS.md` and `tools/`. | End of S2 and S3 |
| `handoff` (user-invoked) | Compact the session into a handoff document if a session ends mid-sprint. The handoff feeds the "next session starting point" of the new small `CONTINUATION-DIRECTIVE.md`. | Any mid-sprint stop |
| `wizard` (model-invoked) | Only for steps the owner alone can do (for example a Cloudflare dashboard setting for S-3). Generates a bash walk-through. | Rare |
| `wayfinder`, `to-spec`, `implement-spec`, `triage` | Not needed: this file is the map and the ticket set is local. They need an issue tracker. | Skip |
| `grill-me`, `grill-with-docs`, `grilling`, `domain-modeling`, `to-questionnaire`, `wait-what`, `teach`, `ask-matt` | Interview or teaching skills that pause for the owner. Skip unless a task says "decision not answered". Note: if `grill-with-docs` is ever used, its glossary file is `GLOSSARY.md` (not `CONTEXT.md`). | Skip |

If the repository cannot be reached from the terminal (network, proxy), skip this section, note
it in the log in one line, and carry on. Nothing else in this file depends on the skills.

---

## 13. CLOSE-OUT CHECKLIST (every sprint, paste the filled table into the log)

| Item | Done | Evidence |
|---|---|---|
| All task gates in the sprint passed | | command output |
| `npm run verify` green | | |
| Tripwires T1 to T8 green (those in scope) | | |
| CI green | | run link |
| `sw.js` shell version bumped | | |
| Field-guide cards added and sheet counts updated | | |
| Deployed from `$HOME/mmgr-deploy`, staged bytes grepped | | |
| Live probe list passed, screenshot saved | | |
| `CONTINUATION-DIRECTIVE.md` updated (under 40 KB) | | |
| `reflection.txt` rewritten | | |
| Open Critical or High items remaining | 0 required at end of Sprint 3 | |

**End of directive.**
