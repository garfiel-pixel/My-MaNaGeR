# Date Wiring + Baseline Safety + AI Import + Parallel Tags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Wire the WBS days cell so start+end back-computes duration (and duration+start computes end — already works); (2) auto-capture the first schedule baseline with a visible signal, plus a red-dot nudge when a schedulable project has no baseline; (3) add an AI-assisted read of pasted text/notes into the existing Import Dates flow with mismatch flagging before commit; (4) tag parallel tasks in the WBS with a hover tooltip naming what they run alongside, plus a plain-language Definitions entry; (5) position voice capture honestly — a simple single-voice capture, not a speaker-labeled meeting recorder — steer it toward field reporting, and make action items fall out of it; (6) add a background assistant that watches budget/resources/WBS/lead-times and drops notices into a header mailbox (local, user-deletable, premium-later); (7) add the 8-project local cap with honest field-guide guidance on why signing in is the safer home for data; (8) fix the field-guide mobile blank-section bug; (9) bind the AI assistant to account sign-in behind a future-proof entitlement seam and add weather-aware schedule suggestions; (10) polish the sign-in UI (researched, moderate) and list Privacy Policy + Terms links on sign-in and in the guide.

**Architecture:** All ten features are additive on the existing global-`MMGR` IIFE pattern. Date wiring extends `updTaskField`'s existing date-commit branch (which already patches cells in place to avoid the "dates are fighting me" bug). Baseline safety is a new `js/app/baseline-guard.js` sub-module wired into `renderDash` (the hub render). AI import reuses the Import Dates modal's strict grammar + `idCommit`'s idempotent-by-name commit, adding an AI normalize step and a mismatch validator in front of it. Parallel tags are computed at render time in `mmgr-schedule.js` (pure, reusing `audit()`'s overlap predicate) and rendered as an SVG-sprite badge — no new state, no schema bump. The background assistant is deterministic Tier-A watchers (lead-time deadlines, budget overrun, resource slack — every line traceable to a real state field) writing into a new `aiInbox` state area; AI only polishes phrasing when a tier is connected, never invents findings. The local project cap is a launcher-side count of stored projects.

**Tech Stack:** Vanilla JS IIFEs on `window.MMGR`, `node build.js` esbuild bundles, existing relay (`/api/ai/chat`) for Tier-B AI, existing CDP qa-harness culture (`tools/qa-*.cjs`).

## Global Constraints

- **Rebuild after every task:** `node build.js` (stale bundles = edits silently invisible).
- **NO EMOJI on any served page** (hard gate): the parallel badge is an SVG `<use>` sprite symbol (`i-parallel`, added to `css/mmgr-icons.svg`).
- **No inline-script edits** → zero CSP hash churn; do not touch `<script>` blocks in HTML.
- **Offline-first:** every feature must fully work with no network. The AI path is opt-in enhancement; strict-grammar parsing is the offline fallback.
- **Plain-language copy** on all new user-facing strings (no jargon: "baseline" gets a one-line explanation on first use).
- **Conventional Commits, ≤72-char subject, no AI attribution footer** (hard gate).
- **Never `taskkill //F //IM node.exe`** — kill by exact PID only (lesson 1).
- **Browser QA:** RAF-wrapped renders require the `FLUSH_RAF` flush between trigger and DOM assert; Chrome needs `--disk-cache-size=0` (lessons 3, 5).
- **No schemaVersion bump:** `baselineAutoAt` and `aiInbox` are additive optional fields; `validate()` untouched.
- **Premium later, normal feature first:** build the assistant ungated now; the future paywall rides `s.flags` (state.flags exists) — do NOT implement any gating in this plan.
- **Zero new secrets** for all ten tasks (assistant is deterministic local; AI import rides the existing relay; nothing new for wrangler secrets). If a future wave needs one: record it in reflection.txt + the tracker as "missing — request it", never hardcode.
- **Execution protocol (owner directive, every task):** implement → `node build.js` → `npm run verify` + targeted harness GREEN locally → commit → push → poll the Actions API until that run completes green → deploy via the clean-staging tar recipe in `wrangler.jsonc` (stage under `$HOME`, verify staged content, never deploy from repo root) → record the outcome in `reflection.txt` + the PLANNING tracker. The session closes only when the tracker matches reality.
- **AI is bound to account sign-in (owner directive):** any AI-powered feature (background assistant, AI import normalize) checks the entitlement seam; strict-grammar/import/validation features stay available signed-out. The seam is the single future door for premium/feature-flag changes.

---

### Task 1: Duration back-compute — editing End (or dragging it) fills the Days cell

**Files:**
- Modify: `js/mmgr-tasks.js:85-159` (`updTaskField`)
- Modify: `js/mmgr-render.js:1990-2060` (Gantt drag commit)
- Create: `tools/verify-date-wiring.cjs`
- Create: `tools/qa-date-wiring.cjs`

**Interfaces:**
- Consumes: `U.workingDaysBetween(a, b, workWeek)` (exists, `mmgr-utils.js:135` — strictly-between count, so inclusive duration = `+1`), `U.fmtDate`, `U.addWorkingDays` (existing direction).
- Produces: invariant **start+end ⇒ duration** for field edits and Gantt drag commits; `MMGR.Tasks.durationFromDates(start, end)` exported helper (later tasks reuse it for import validation).

- [ ] **Step 1: Read the exact drag-commit code before touching it**

Run: `sed -n '1985,2060p' js/mmgr-render.js`
Note where the drag writes `task.startDate`/`task.endDate` on commit (the block that reads `const dur = parseInt(task.duration) || 1;` twice, lines ~1997 and ~2036).

- [ ] **Step 2: Write the static gate (fails first)**

Create `tools/verify-date-wiring.cjs`:

```js
/* verify-date-wiring.cjs — T1 static gate: endDate edits back-compute duration.
   Fails unless both wiring points exist in source. Run: node tools/verify-date-wiring.cjs */
const fs = require('fs');
let fail = 0;
function need(name, path, re) {
  const ok = re.test(fs.readFileSync(path, 'utf8'));
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) fail++;
}
need('updTaskField endDate branch back-computes duration', 'js/mmgr-tasks.js',
  /field === 'endDate'[\s\S]{0,400}workingDaysBetween/);
need('durationFromDates helper exported', 'js/mmgr-tasks.js', /durationFromDates/);
need('Gantt drag commit syncs duration', 'js/mmgr-render.js',
  /durationFromDates|workingDaysBetween[\s\S]{0,200}\.duration\s*=/);
need('endDate commit patches duration cell in place (no WBS rebuild)', 'js/mmgr-tasks.js',
  /data-field="duration"\s*\)\);|input\[data-field="duration"\]/);
process.exit(fail ? 1 : 0);
```

Run: `node tools/verify-date-wiring.cjs` — Expected: FAIL (nothing implemented yet).

- [ ] **Step 3: Implement the helper + endDate branch in `updTaskField`**

In `js/mmgr-tasks.js`, inside the module (near the top, after the `S`/`U` consts), add:

```js
// Inclusive working-day duration between two ISO dates (duration counts
// working days per the work-week control — same unit as the Days column).  function durationFromDates(start, end) {
    if (!start || !end) return null;
    const between = U.workingDaysBetween(start, end);
    if (between < 0) return null;
    // Exact inverse of endDate = addWorkingDays(start, dur-1): strictly-
    // between + endpoint bonuses, floored (weekend endpoint -> workday).
    // CORRECTED during execution (2026-09-19): the original `d + 1` was off
    // by one - Mon-Fri must be 5, and the app's forward convention is
    // INCLUSIVE of the end working day.
    const raw = between + (U.isWorkDay(start) ? 1 : 0) + (U.isWorkDay(end) ? 1 : 0);
    return Math.floor(raw + 0.5);
  }
```

In `updTaskField`'s `updateState` callback, change the recompute branch so an `endDate` edit derives duration INSTEAD of deriving endDate (prevents the redundant feedback write):

```js
        if (field === 'duration' || field === 'startDate') {
          if (task.startDate && task.duration) {
            const dur = parseInt(task.duration);
            if (!isNaN(dur)) {
              // Duration counts WORKING days (respects the work-week control).
              task.endDate = U.fmtDate(U.addWorkingDays(task.startDate, dur - 1));
            }
          }
        } else if (field === 'endDate') {
          // Dates drive days: start+end back-computes duration. No endDate
          // rewrite here — the user just set it deliberately.
          const dur = durationFromDates(task.startDate, task.endDate);
          if (dur !== null) task.duration = String(dur);
        }
```

In the date-commit DOM-patch branch (`if (field === 'startDate' || ...) `), add an `endDate` case that patches the Days cell in place (mirror of the existing startDate→endDate patch):

```js
      if (field === 'endDate') {
        const st = ns.State.getState();
        const task = (st.tasks || []).find(t => t.id === id);
        if (task && task.duration) {
          const row = document.querySelector('#wbs-body tr.wbs-row[data-id="' + id + '"]');
          const durInp = row && row.querySelector('input[data-field="duration"]');
          if (durInp) durInp.value = task.duration;
        }
      }
```

- [ ] **Step 4: Sync duration on Gantt drag commit**

In the drag-commit block found in Step 1 (both handle-drag sites that write dates), after the final `task.endDate` write, add:

```js
            // Drag resizes the bar: dates drive duration, same invariant as
            // the WBS Days cell (Task 1).
            const d = durationFromDates(task.startDate, task.endDate);
            if (d !== null) task.duration = String(d);
```

(`durationFromDates` is on `MMGR.Tasks`; if `mmgr-render.js` loads before `mmgr-tasks.js` in `build.js` — check `APP_MODULES` order — call `ns.Tasks.durationFromDates` lazily inside the handler instead of at module top.)

- [ ] **Step 5: Export + verify**

Add `durationFromDates` to the module's `ns.Tasks` export object (find `ns.Tasks = {` and add the key). Run `node tools/verify-date-wiring.cjs` — Expected: PASS (4/4).

- [ ] **Step 6: Browser QA harness**

Create `tools/qa-date-wiring.cjs` modeled on `tools/qa-typing.cjs` (CDP, `--disk-cache-size=0`, unique `QA_PORT`, own wrangler via `wrangler-ci-helpers.cjs`): load `/project.html`, seed one task via `MMGR.State.updateState`, then:
1. `MMGR.Tasks.updTaskField(id,'startDate','2026-08-17','change')` + `updTaskField(id,'endDate','2026-08-21','change')` → assert task.duration === '5' (Mon–Fri, 5-day week).
2. Set duration '3' + start '2026-08-17' → assert endDate === '2026-08-19' (existing direction still intact).
3. `await ev('MMGR.Render.renderDash();')` then `await ev(FLUSH_RAF)` before any dashboard-side assert (lesson 3).
Exit 1 on any failed gate; print `PASS n/n`.

- [x] **Step 7: Rebuild, full verify, commit — DONE (2026-09-19)**

Executed: gates 4/4 + browser harness 10/10; commit `b3a1a63`; CI GREEN
(polled via Actions API); deployed from verified `$HOME/mmgr-deploy`
staging; live-served `js/mmgr-tasks.js` contains `durationFromDates`
(Worker version `ffad6c51`). Harness lessons recorded in reflection.txt:
seed localStorage on the real origin (about:blank is opaque), project.html
needs a locally-owned id or it gate-bounces, compute expectations in-page
with the app's own helpers.

---

### Task 2: Baseline safety — auto-capture the first baseline + red-dot nudge

**Files:**
- Create: `js/app/baseline-guard.js`
- Modify: `build.js` (`APP_MODULES`, after `js/app/backup.js`)
- Modify: `js/mmgr-render.js:289` + `:321` (dashboard empty-baseline copy)
- Modify: `css/mmgr.css` (`.nudge-dot`)
- Modify: the Controls drawer Save Baseline button markup (locate: `grep -rn 'data-action="saveBaseline"' project.html js/` — patch that one button to carry `<span class="nudge-dot" data-baseline-dot hidden></span>`)
- Modify: `js/mmgr-state.js` `getDefaultState` (add `baselineAutoAt: null` next to `baseline: null`, line ~253)

**Interfaces:**
- Consumes: `MMGR.State.saveBaseline()` (exists, `mmgr-state.js:1127`), `MMGR.Render.renderDash` call site.
- Produces: `MMGR.BaselineGuard.ensure()` — idempotent, call-often; sets `s.baselineAutoAt` on auto-capture; toggles every `[data-baseline-dot]` per state.

- [ ] **Step 1: Write the guard module**

`js/app/baseline-guard.js`:

```js
/* ============================================================
   My MaNaGeR - Baseline Guard (auto-capture + nudge)
   ------------------------------------------------------------
   Owner directive (2026-09-19): a project with scheduled tasks
   must never sit there with nothing to calculate variance
   against. Two behaviors, both visible:
   1. AUTO-CAPTURE (once): when the project first reaches
      "schedulable" (>=1 non-phase task with duration + start +
      end) and no baseline exists, snapshot one automatically and
      SAY SO (toast + dashboard line). Never silent.
   2. NUDGE (persistent): while no baseline exists and the
      project IS schedulable, every [data-baseline-dot] shows a
      red dot next to Save Baseline. Plain-language tooltip.
   Recapture stays a deliberate human act - an auto-recapture
   would silently move the reference point. Zero-throw: any
   error leaves state untouched.
   ============================================================ */
var MMGR = window.MMGR || {};
(function(ns) {
  'use strict';
  const U = ns.Utils;

  function isSchedulable(s) {
    return (s.tasks || []).some(t => !t.isPhase && t.duration && t.startDate && t.endDate);
  }

  function ensure() {
    try {
      const s = ns.State.getState();
      if (!s || !s.tasks) return;
      const sched = isSchedulable(s);
      // Nudge dots (cheap, every call)
      document.querySelectorAll('[data-baseline-dot]').forEach(el => {
        el.hidden = !!(s.baseline || !sched);
      });
      // Auto-capture: only when truly missing and the project is real
      if (!s.baseline && sched && !s.baselineAutoAt) {
        ns.State.saveBaseline();
        ns.State.updateState(function(st) { st.baselineAutoAt = new Date().toISOString(); });
        ns.App.showToast('Baseline auto-captured - your schedule now has a reference point. You can recapture it anytime in Controls.', 'ok');
      }
    } catch (e) { /* zero-throw */ }
  }

  ns.BaselineGuard = { ensure: ensure, isSchedulable: isSchedulable };
})(MMGR);
window.MMGR = MMGR;
```

- [ ] **Step 2: Wire it in (build order + hub render + defaults)**

- `build.js` `APP_MODULES`: insert `'js/app/baseline-guard.js',` directly after `'js/app/backup.js',` (it needs `Utils` + `State` + `App` toast at call time, not load time — position after the app sub-modules is correct).
- `js/mmgr-render.js` `renderDash`: after the Baseline Variance block (~line 290), add `if (ns.BaselineGuard) ns.BaselineGuard.ensure();` — runs on every dashboard render, idempotent.
- `js/mmgr-state.js` `getDefaultState`: add `baselineAutoAt: null,` beside `baseline: null,` (both schema copies, lines ~253 and ~408).

- [ ] **Step 3: Nudge dot CSS + dashboard copy (plain language)**

`css/mmgr.css` append:

```css
/* Baseline nudge dot (owner 2026-09-19): visible signal that a schedulable
   project still has no baseline. Hidden by default; BaselineGuard reveals. */
.nudge-dot{display:inline-block;width:8px;height:8px;border-radius:50%;
  background:var(--danger);margin-left:6px;vertical-align:middle}
.nudge-dot[hidden]{display:none}
```

Dashboard copy (`mmgr-render.js:289` and `:321`) becomes:
`'No baseline yet - one is captured automatically once a task has dates and days, or use Save Baseline in Controls.'`
Save-Baseline button gets `title="Saves today's schedule as the reference point for tracking delays and cost."`

- [ ] **Step 4: Locate + patch the Save Baseline button**

Run: `grep -rn 'saveBaseline' project.html js/ | grep -i 'data-action\|button'`
Add `<span class="nudge-dot" data-baseline-dot hidden></span>` inside that button (markup-accurate edit, no restructure).

- [ ] **Step 5: Verify + commit**

```bash
node build.js && npm run verify
# Manual: fresh project -> add task (3d, Mon-Fri dates) -> renderDash -> toast fired,
# s.baselineAutoAt set, dot hidden; clear baseline via devtools -> dot visible.
git add -A && git commit -m "feat(baseline): auto-capture first baseline with visible signal and nudge dot"
```

---

### Task 3: AI-assisted import — read messy text, flag mismatches before commit

**Files:**
- Modify: `js/mmgr-tasks.js` (modal: add "Read with AI" path + mismatch panel; validator fn)
- Modify: `js/mmgr-ai.js` (prompt builder `aiNormalizeSchedulePrompt(rawText, knownTasks)`)
- Modify: `project.html` Import Dates modal markup (`id-source` area: add buttons + `#id-mismatch` div)
- Modify: `tools/qa-date-wiring.cjs` (extend) or new `tools/qa-ai-import.cjs`

**Interfaces:**
- Consumes: existing grammar regex `^(.+?)\s*\(\s*(\d+)\s*d\s*\)\s*\[\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})\s*\]\s*$` (preview + commit, `mmgr-tasks.js:421/440`); `MMGR.AI` submit seam/relay (relay degrades to Tier-A offline); `idCommit`'s `pushUndo` + name-idempotent matching.
- Produces: `MMGR.Tasks.validateImportLines(lines)` → `{ ok: [...], issues: [{ line, name, reason, severity }] }`; commit stays blocked while `issues` has severity `error`.

- [x] **Step 1: Validator (pure, offline — the mismatch engine)**

In `js/mmgr-tasks.js`:

```js
// Validates candidate import lines against state + date/duration math.
// Severity: 'error' blocks commit; 'warn' shows but allows.
function validateImportLines(lines) {
  const s = S();
  const known = new Set((s.tasks || []).map(t => t.name));
  const ok = [], issues = [];
  for (const line of lines) {
    const m = line.match(/^(.+?)\s*\(\s*(\d+)\s*d\s*\)\s*\[\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})\s*\]\s*$/);
    if (!m) { issues.push({ line, name: line.slice(0, 60), reason: 'Not in the format Name (3d) [2026-08-16 → 2026-08-20]', severity: 'error' }); continue; }
    const name = m[1].trim(), dur = parseInt(m[2]), start = m[3], end = m[4];
    if (start > end) { issues.push({ line, name, reason: 'End date is before start date', severity: 'error' }); continue; }
    const calc = durationFromDates(start, end);
    if (calc !== null && Math.abs(calc - dur) > 0) {
      issues.push({ line, name, reason: 'Days say ' + dur + ' but the dates span ' + calc + ' working days', severity: 'warn' });
    }
    if (!known.has(name)) issues.push({ line, name, reason: 'New task (will be created)', severity: 'warn' });
    ok.push({ name, dur, start, end });
  }
  return { ok, issues };
}
```

- [x] **Step 2: AI normalize (Tier-B relay; offline degrades cleanly)**

`js/mmgr-ai.js` — new prompt builder following `mmgr-prompts.js` conventions:

```js
function aiNormalizeSchedulePrompt(rawText, knownTasks) {
  return [
    'Convert the user\'s text into ONE line per task, exactly this format:',
    'Task Name (3d) [2026-08-16 → 2026-08-20]',
    'Rules: durations in working days; ISO dates; use the task names given when they match:',
    knownTasks.slice(0, 80).join(' | '),
    'If the text lacks dates, compute them from durations and the earliest date given.',
    'Output ONLY the lines. No commentary.',
    '',
    'TEXT:',
    rawText
  ].join('\n');
}
```

Modal wiring: "Read with AI" button calls the existing relay seam (`relayChat` path used by `mmgr-ai.js:701-730`); response text is split to lines, fed through `validateImportLines`, and rendered into `id-preview` + `#id-mismatch`. **Offline / no key:** toast "AI reading needs the AI window (online). Paste the strict format instead - it works offline." and the strict path stays fully functional. Files: `.txt`/`.md` file input fills `id-source` (plain `FileReader.readAsText`); unsupported files (PDF etc.) get "Can't read that file type here - paste the text instead." (owner-approved limitation).

- [x] **Step 3: Mismatch panel + guarded commit**

`idPreview()` additionally calls `validateImportLines(lines)`, renders issues into `#id-mismatch` (red rows: name + reason, error vs warn styling via existing `--danger`/`--amber`), and `idCommit()` refuses when any `severity === 'error'` (toast lists the count). `idCommit` then also reconciles warn-level duration mismatches: dates win (sets `task.duration` from `durationFromDates`) — "dates drive days", consistent with Task 1.

- [x] **Step 4: QA + verify + commit**

Extend the Task 1 harness: paste valid text → preview rows; paste garbage line → error issue + commit blocked; paste disagreeing days → warn row + commit reconciles duration. `node build.js && npm run verify`, run harness, then:

```bash
git add -A && git commit -m "feat(import): AI-assisted schedule reading with mismatch flagging"
```

---

### Task 4: Parallel-task tags — badge, hover detail, glossary entry

**Files:**
- Modify: `js/mmgr-schedule.js` (pure `parallelGroups(tasks)` near `audit()`)
- Modify: `js/mmgr-render.js:1145-1184` (WBS name cell badge)
- Modify: `css/mmgr-icons.svg` (new `i-parallel` symbol)
- Modify: `js/mmgr-defs.js` (`DEFINITIONS` array)
- Modify: `tools/verify-date-wiring.cjs` (add parallel checks) or standalone gate

**Interfaces:**
- Consumes: audit()'s overlap predicate (`schedule.js:572`: `U.daysBetween(b.startDate, a.endDate) >= 0 && U.daysBetween(a.startDate, b.endDate) >= 0` — calendar-day basis, keep identical).
- Produces: `MMGR.Schedule.parallelGroups(tasks)` → `Map<taskId, { peers: [taskId], window: {start, end} }>`; badge markup `<svg class="ico" ...><use href="css/mmgr-icons.svg#i-parallel"></use></svg>` with `title` + `aria-label` listing peers.

- [ ] **Step 1: Pure detection**

```js
// Parallel tasks: non-phase, non-lead-time tasks whose scheduled windows
// overlap by >=1 day. Render-time only - nothing stored, no state bloat.
// O(n^2) pairwise, same predicate as audit() so the two never disagree.
function parallelGroups(tasks) {
  const map = new Map();
  const list = (tasks || []).filter(t => !t.isPhase && !t.leadTime && t.startDate && t.endDate);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (U.daysBetween(b.startDate, a.endDate) >= 0 && U.daysBetween(a.startDate, b.endDate) >= 0) {
        if (!map.has(a.id)) map.set(a.id, { peers: [], window: { start: a.startDate, end: a.endDate } });
        if (!map.has(b.id)) map.set(b.id, { peers: [], window: { start: b.startDate, end: b.endDate } });
        map.get(a.id).peers.push(b.id);
        map.get(b.id).peers.push(a.id);
      }
    }
  }
  return map;
}
```

Export on `ns.Schedule`.

- [ ] **Step 2: Sprite symbol (SVG only — emoji hard gate)**

`css/mmgr-icons.svg`: add `<symbol id="i-parallel" viewBox="0 0 16 16">` with two offset horizontal bars (`<rect x="1" y="4" width="14" height="3" rx="1"/><rect x="1" y="9" width="14" height="3" rx="1"/>`, `fill="currentColor"`), matching sibling symbols' stroke/fill conventions.

- [ ] **Step 3: WBS badge + hover detail**

In the WBS name cell template (`mmgr-render.js`, after the CHAIN badge), compute once per render at function top: `const par = ns.Schedule ? ns.Schedule.parallelGroups(tasks) : null;` then:

```js
${par && par.has(t.id) ? (() => {
  const g = par.get(t.id);
  const names = g.peers.map(pid => (tasks.find(x => String(x.id) === String(pid)) || {}).name || pid).join(', ');
  const when = g.window.start + ' to ' + g.window.end;
  return '<span class="badge bp" tabindex="0" role="img" aria-label="Runs in parallel with ' + U.escapeHtml(names) + '" title="Parallel with: ' + U.escapeHtml(names) + ' (' + when + ')" style="font-size:.6rem;padding:1px 4px;margin-left:4px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-parallel"></use></svg> ' + g.peers.length + '</span>';
})() : ''}
```

`.badge.bp` color: `var(--info)`-family tone consistent with sibling badges.

- [ ] **Step 4: Definitions entry (plain language, per plain-language-copy)**

`js/mmgr-defs.js` `DEFINITIONS` array:

```js
{
  term: 'Parallel tasks',
  meaning: 'Two or more tasks happening at the same time. Neither waits for the other. The schedule moves forward when the longest one finishes, not when each one does.'
},
```

- [ ] **Step 5: Verify + rebuild + commit**

Extend the static gate with: `need('parallel detection exported', 'js/mmgr-schedule.js', /parallelGroups/)` + `need('sprite symbol exists', 'css/mmgr-icons.svg', /id="i-parallel"/)` + `need('glossary entry', 'js/mmgr-defs.js', /Parallel tasks/)`. `node build.js && npm run verify`. Manual: two overlapping tasks → badge with count; hover names peers; non-overlapping → no badge.

```bash
git add -A && git commit -m "feat(wbs): parallel-task badges with hover detail and glossary entry"
```

---

### Task 5: Voice honesty + field-report capture + action items

**Files:**
- Modify: `mymanager-field-guide.html:1287` (strengthen the "Review before you trust" guidance)
- Modify: `js/mmgr-voice.js` (transcript destination option: meeting | field report)
- Modify: `js/mmgr-field.js` (voice entry point + quick action item in the Daily Field Report panel)
- Modify: `tools/verify-date-wiring.cjs` (add copy checks)

**Interfaces:**
- Consumes: `MMGR.Voice.startCapture/stopCapture` (exists, `mmgr-voice.js:266`); transcript home convention (meeting record `transcript` field); `MMGR.Closure.addCloseItem` (comms action items, `mmgr-closure.js:~16`); field-guide precedent line 1287.
- Produces: voice capture started from the field report writes its finished transcript into the open report's text (hand-editable, per the module's own convention); a documented position statement on capture accuracy; quick action-item path from a field report.

- [ ] **Step 1: Field-guide copy — honest positioning, no app names**

Replace the paragraph at `mymanager-field-guide.html:1287` with (keep the existing sibling structure/styling — consistency law):

```html
<p><strong>Review before you trust.</strong> Transcripts are a working record, not a court
reporter. This is a simple one-voice capture: it records one microphone in the room. It
cannot tell people apart, so a transcript of a multi-person meeting comes out as one block
of text with no names attached , and in noisy or overlapping audio (a busy site, people
talking over each other) detail can be lost or misheard. For meetings, keep the attendee
list in the meeting header (names, in order of speaking helps), have the chair note who
raised each decision as it happens, and for accurate per-person transcripts use software
dedicated to that job , meeting tools built for speaker labeling will do it better than a
site-capture feature ever should. Then paste or summarize the relevant points back here.
Skim every transcript against your memory before it becomes the record of record.</p>
```

(Names no software — the owner's directive: hint at the category, never the product.)

- [ ] **Step 2: Field-report voice entry + transcript destination**

In `js/mmgr-voice.js`, the capture session already writes its final transcript to the active meeting record. Add a destination tag: a module-level `let _target = { kind: 'meeting' };` set by a new exported `startForFieldReport()` that (a) calls the existing start path, (b) marks `_target = { kind: 'field' }`. Where the finished transcript is committed (the block that assigns the definitive transcript to the meeting record, `mmgr-voice.js:354` area), branch:

```js
      if (_target && _target.kind === 'field' && ns.FieldReport && ns.FieldReport.insertTranscript) {
        ns.FieldReport.insertTranscript(text);   // appends into the open report, hand-editable
        _target = { kind: 'meeting' };           // reset for next capture
        return;                                  // skip the meeting-record write
      }
```

In `js/mmgr-field.js`, add to `ns.FieldReport`:

```js
  function insertTranscript(text) {
    if (!text) return;
    ns.State.updateState(function(s) {
      const rep = currentReport(s);              // the report draft this panel shows
      if (!rep) return;
      rep.notes = (rep.notes ? rep.notes + '\n\n' : '') + '[Voice capture]\n' + text;
    });
    R.renderFieldReport();                       // existing panel renderer
    ns.App.showToast('Transcript added to the field report - review before you trust it.', 'ok');
  }
```

(Resolve `currentReport`/render fn names from the module's existing internals during implementation — read `mmgr-field.js` first; the pattern is the module's own state-update + render pair.) Add a "Capture audio" button in the field-report panel via `data-action="startFieldVoice"` + `ACTION_MAP` entry calling `MMGR.Voice.startForFieldReport()`.

- [ ] **Step 3: Quick action item from a field report**

Below the report, a "Add action item" button (`data-action="addFieldAction"`) opens the existing comms/decision-log item flow pre-filled with the report reference (date + report id), routed through `MMGR.Closure.addCloseItem` so it lands where the Decision Engine already counts open actions. No new storage shape.

- [ ] **Step 4: Static gate + verify + commit**

Extend `tools/verify-date-wiring.cjs`:

```js
need('field guide names no software, one-voice statement', 'mymanager-field-guide.html', /one-voice capture/);
need('voice has field-report destination', 'js/mmgr-voice.js', /startForFieldReport/);
need('field report inserts transcript', 'js/mmgr-field.js', /insertTranscript/);
```

`node build.js && npm run verify`. Manual: field report -> Capture audio -> speak -> stop -> transcript appears in report notes, editable; Add action item -> appears in Comms and the Decision Engine count.

```bash
git add -A && git commit -m "feat(voice): field-report capture with honest meeting guidance"
```

---

### Task 6: Background assistant — mailbox notifier watching budget, resources, WBS, lead-times

**Files:**
- Create: `js/mmgr-watch.js` (watchers + inbox store + mailbox UI)
- Modify: `js/mmgr-state.js` `getDefaultState` (both schema copies, lines ~253/~408: `aiInbox: []`)
- Modify: `project.html` header top bar (line 158–160 area): bell button before the settings button
- Modify: `js/mmgr-app.js` `ACTION_MAP`: `openAiMailbox`, `dismissAiNote`, `clearAiMailbox`
- Modify: `css/mmgr.css` (mailbox panel + unread dot styles, sibling conventions)
- Modify: `css/mmgr-icons.svg` (reuse existing `i-bell` — confirmed present, no new symbol)
- Modify: `js/mmgr-ai.js` (phrasing polish hook, Tier-B only)

**Interfaces:**
- Consumes: `ns.Schedule.computeHealthScore` no — consumes: state directly (tasks, budgetLines, spendLog, resources, leadTime fields), `U.workingDaysBetween`, `U.todayStr`, `ns.State.updateState`, existing `i-bell` sprite symbol, existing toast patterns. Reuses the parallel/lead-time date math already in the codebase.
- Produces: `MMGR.Watch.run()` (idempotent, call-often, returns nothing), `MMGR.Watch.openMailbox()`, notices shaped `{ id, at, kind, severity, text, read }` persisted in `s.aiInbox` (local machine only, user-deletable, survives sessions until dismissed); `severity: 'info'|'attention'`.

**Design decisions (owner inputs honored):**
- Watchers are **deterministic Tier-A**: every notice's text traces to real state fields (lead-time expectedDate vs today, budget actual vs planned, resource over-allocation, WBS end-vs-today drift). The AI tier only rephrases existing notice text when connected — it never originates findings and never sees more than the project already on the machine.
- **Local only:** notices live in `s.aiInbox` in the project blob (localStorage on the device). Nothing is sent anywhere. If cloud sync later carries the blob, notices ride inside it only if the user syncs that project (their choice, existing opt-in).
- **Deletion model (owner's "tricky thing"):** user-dismissed notices are GONE (soft-DELETE pattern: dismissed = removed from array on next save; no tombstones). Notices regenerate naturally if the underlying condition persists — deletion silences the current occurrence, not the condition. No auto-delete per session.
- **Premium later:** feature ships fully normal now; `s.flags.premiumAssistant` gate is a future wave (one boolean check at `run()` — trivial to add then, zero rework now).

- [ ] **Step 1: Watchers (pure functions, one per concern)**

`js/mmgr-watch.js`:

```js
/* ============================================================
   My MaNaGeR - Background Assistant (watchers + mailbox)
   ------------------------------------------------------------
   Deterministic watchers over live state. Every notice text is
   derived from real fields - traceable, never invented. Notices
   persist on the local machine in s.aiInbox until the user
   deletes them. Premium gate comes LATER (s.flags) - ships
   ungated. Zero network. Zero-throw.
   ============================================================ */
var MMGR = window.MMGR || {};
(function(ns) {
  'use strict';
  const U = ns.Utils;

  // Lead-time watchdog: a lead-time task whose Expected date is within N
  // days (or past) and not delivered. Owner's example: "steel fixing lead
  // time - two days left, signal the PM."
  function watchLeadTimes(s, today) {
    const out = [];
    for (const t of (s.tasks || [])) {
      if (!t.leadTime || !t.expectedDate || t.delivered) continue;
      const d = U.daysBetween(today, t.expectedDate); // negative = overdue
      if (d <= 2) {
        out.push({ kind: 'leadtime', severity: d < 0 ? 'attention' : 'info',
          text: t.name + ' lead time: ' + (d < 0 ? Math.abs(d) + ' day(s) past' : d + ' day(s) left') +
                ' (expected ' + t.expectedDate + '). Check on the vendor.' });
      }
    }
    return out;
  }

  // Budget watchdog: any category running >=10% over planned.
  function watchBudget(s) {
    const out = [];
    const byCat = {};
    for (const b of (s.budgetLines || [])) {
      if (!byCat[b.category]) byCat[b.category] = { planned: 0, actual: 0 };
      byCat[b.category].planned += (+b.planned || 0);
      byCat[b.category].actual += (+b.actual || 0) + (+b.committed || 0);
    }
    for (const cat in byCat) {
      const c = byCat[cat];
      if (c.planned > 0 && c.actual > c.planned * 1.10) {
        out.push({ kind: 'budget', severity: 'attention',
          text: cat + ' is running ' + Math.round((c.actual / c.planned - 1) * 100) + '% over plan (' +
                Math.round(c.actual).toLocaleString() + ' of ' + Math.round(c.planned).toLocaleString() + ').' });
      }
    }
    return out;
  }

  // Resource watchdog: any resource allocated above 100% across tasks.
  function watchResources(s) {
    const out = [];
    for (const r of (s.resources || [])) {
      if ((+r.allocation || 0) > 100) {
        out.push({ kind: 'resource', severity: 'info',
          text: r.name + ' is allocated ' + r.allocation + '% - over capacity. Consider rebalancing.' });
      }
    }
    return out;
  }
```

- [ ] **Step 2: Dedup + persist + mailbox UI**

Same module continues:

```js
  // Dedup: a (kind + text) pair already in the inbox (read or unread) is
  // not re-added. Dismissed notices are removed from the array entirely,
  // so a persistent condition resurfaces as a NEW notice later - by design.
  function run() {
    try {
      const s = ns.State.getState();
      if (!s || !s.tasks) return;
      const today = U.todayStr();
      const found = [].concat(watchLeadTimes(s, today), watchBudget(s), watchResources(s));
      if (!found.length) return;
      ns.State.updateState(function(st) {
        if (!Array.isArray(st.aiInbox)) st.aiInbox = [];
        const seen = new Set(st.aiInbox.map(n => n.kind + '|' + n.text));
        for (const f of found) {
          if (seen.has(f.kind + '|' + f.text)) continue;
          st.aiInbox.unshift({ id: U.genId('n'), at: new Date().toISOString(),
            kind: f.kind, severity: f.severity, text: f.text, read: false });
        }
        st.aiInbox = st.aiInbox.slice(0, 50); // hard cap, newest first
      });
      renderBell();
    } catch (e) { /* zero-throw */ }
  }

  function unreadCount() {
    const s = ns.State.getState();
    return (s && Array.isArray(s.aiInbox)) ? s.aiInbox.filter(n => !n.read).length : 0;
  }

  function renderBell() {
    const bell = document.getElementById('ai-bell');
    if (!bell) return;
    const n = unreadCount();
    bell.querySelector('[data-bell-dot]').hidden = n === 0;
    bell.setAttribute('aria-label', 'Assistant notices' + (n ? ', ' + n + ' unread' : ''));
  }

  function openMailbox() {
    // Delegated-render panel: list notices (severity styling), dismiss
    // buttons, clear-all. Wire via ACTION_MAP: dismissAiNote / clearAiMailbox.
    const s = ns.State.getState();
    const box = document.getElementById('ai-mailbox');
    if (!box) return;
    const items = (s.aiInbox || []).map(n =>
      '<div class="ai-note ' + (n.severity === 'attention' ? 'ai-note-hot' : '') + '">' +
      '<div class="ai-note-tx">' + U.escapeHtml(n.text) + '</div>' +
      '<div class="ai-note-meta">' + (n.at || '').slice(0, 10) + '</div>' +
      '<button class="btn btn-s btn-n" data-action="dismissAiNote" data-id="' + U.escapeHtml(n.id) + '">Dismiss</button>' +
      '</div>').join('') || '<div class="ai-note-tx">Nothing right now - the assistant pings you here when it spots something.</div>';
    box.querySelector('[data-mailbox-list]').innerHTML = items;
    ns.State.updateState(function(st) { (st.aiInbox || []).forEach(n => { n.read = true; }); });
    renderBell();
    box.classList.add('on');
  }

  function dismissNote(id) {
    ns.State.updateState(function(st) { st.aiInbox = (st.aiInbox || []).filter(n => n.id !== id); });
    openMailbox(); // re-render open panel
  }

  function clearMailbox() {
    ns.State.updateState(function(st) { st.aiInbox = []; });
    openMailbox();
  }

  ns.Watch = { run: run, openMailbox: openMailbox, dismissNote: dismissNote,
    clearMailbox: clearMailbox, unreadCount: unreadCount, renderBell: renderBell };
})(MMGR);
window.MMGR = MMGR;
```

- [ ] **Step 3: Header bell + panel + ACTION_MAP + state default**

- `project.html` header (before the settings button at line 160):

```html
    <button class="settings-btn" id="ai-bell" data-action="openAiMailbox" aria-label="Assistant notices"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-bell"></use></svg><span class="nudge-dot" data-bell-dot hidden></span></button>
```

- Mailbox panel near the AI window markup (`#ai-mailbox` popover with `[data-mailbox-list]`, same `.on` show convention as other drawers).
- `mmgr-app.js` `ACTION_MAP`: `'openAiMailbox': () => ns.Watch.openMailbox()`, `'dismissAiNote': (el) => ns.Watch.dismissNote(el.dataset.id)`, `'clearAiMailbox': () => ns.Watch.clearMailbox()`.
- `mmgr-state.js` `getDefaultState` (both copies): `aiInbox: [],`.
- `mmgr-app.js` `init()`: `setInterval(() => ns.Watch.run(), 60000)` (60s cadence, zero-cost when idle) + one immediate `ns.Watch.run()`.

- [ ] **Step 4: AI phrasing polish (Tier-B only, never originates)**

In `mmgr-ai.js`: when the assistant window opens and `s.aiInbox` has unread `attention` notices, offer one preset prompt "Rephrase my assistant notices" that sends ONLY the notice texts (already project-local, nothing new leaves) through the relay for clearer phrasing, and writes the result as a NEW notice appended below the original (original stays until dismissed). If offline/no tier: the button simply isn't offered. The AI never creates, edits, or deletes findings.

- [ ] **Step 5: QA + verify + commit**

Static gate additions (same file as Task 4):

```js
need('watch module + leadtime watcher', 'js/mmgr-watch.js', /watchLeadTimes/);
need('inbox persisted in state', 'js/mmgr-state.js', /aiInbox: \[\]/);
need('header bell rides i-bell sprite', 'project.html', /ai-bell[\s\S]{0,200}i-bell/);
need('mailbox actions wired', 'js/mmgr-app.js', /'openAiMailbox'/);
```

Harness: seed a lead-time task with expectedDate = today+1 → `MMGR.Watch.run()` → unreadCount 1 → openMailbox shows the owner's example text shape → dismiss → count 0 → condition still true → run() again → notice returns (documented behavior).

```bash
node build.js && npm run verify
git add -A && git commit -m "feat(assistant): background watchers with header mailbox notifier"
```

---

### Task 7: Local 8-project cap + sign-in guidance in the field guide

**Files:**
- Modify: launcher project-create path (locate the creation flow: `grep -n 'createProject\|New Project' js/mmgr-cloud-dash.js app.html`)
- Modify: `mymanager-field-guide.html` (two additions: local limit + why sign in)
- Modify: `tools/verify-date-wiring.cjs` (gate)

**Interfaces:**
- Consumes: the launcher's project list storage (projects the device already holds), existing cloud-sign-in marketing copy patterns (`mmgr-google-auth.js` marketing mount).
- Produces: `MMGR.CloudDash.localProjectCount()` (or launcher-equivalent), block-with-guidance at the 9th creation attempt.

- [ ] **Step 1: Find the real storage first (do not assume)**

Read how launcher projects persist (`app.html` + `projects-data.js` + any launcher store module). The cap counts projects the DEVICE holds, not cloud ones (cloud already has its own plan limit at `mmgr-cloud.js:312`). Write the count helper against the actual store discovered here.

- [ ] **Step 2: Enforce the cap with guidance, not a dead end**

At the create-project entry (before a new project record is written):

```js
  const LOCAL_PROJECT_CAP = 8;
  if (countLocalProjects() >= LOCAL_PROJECT_CAP) {
    openModal('local-cap'); // small modal, plain language:
    // "This device holds 8 projects - the local limit. You can free a slot by
    //  deleting a project you no longer need, or keep everything by signing in
    //  and saving projects to your cloud - they're available on any device,
    //  anywhere, and a device wipe or loss doesn't touch them."
    return;
  }
```

Note (owner's delete-to-dodge concern): deleting a local project frees a slot by design — the honest counterweight is the guidance below, not a hidden ban-list (which would fight the offline-first promise that local data is the user's).

- [ ] **Step 3: Field guide additions (plain language, no scare tactics)**

In `mymanager-field-guide.html`, in the local/offline section:

```html
<p><strong>Local projects: a device holds up to 8.</strong> Everything works offline with no
account - but a project that lives only on this device lives only on this device. A wiped,
lost, or broken device takes it with it. Signing in and saving projects to the cloud keeps
them reachable from any device, anytime - that is the safer home for anything you would
hate to lose. The local limit counts what the device stores; deleting a project frees a
slot, so delete only what you have backed up or can let go.</p>
```

- [ ] **Step 4: Gate + verify + commit**

```js
need('local project cap enforced', 'app.html', /LOCAL_PROJECT_CAP|local-cap/);
need('field guide documents the 8-project local limit', 'mymanager-field-guide.html', /up to 8/);
need('field guide recommends cloud sign-in for safety', 'mymanager-field-guide.html', /safer home/);
```

```bash
node build.js && npm run verify
git add -A && git commit -m "feat(launcher): local 8-project cap with sign-in guidance"
```

---

### Task 8: Field-guide mobile blank-section fix (reveal bug)

**Files:**
- Modify: `mymanager-field-guide.html` inline `<style>` at lines ~556-557 (CSS only — zero CSP hash churn)
- Modify: `tools/verify-date-wiring.cjs` (gate)

**Diagnosis (verified in this session):** `.reveal{opacity:0;transform:translateY(22px)}` + an inline IntersectionObserver (`threshold:0.08`) reveals sections. On mobile, fast momentum scrolls and tall photo bands can skip intersection callbacks, so mid-document sheets (around A-10…A-15) stay invisible until something late (A-16) finally triggers. The owner saw exactly that: blank span after the "Nothing uploads by default" band until A-16. A JS fix would mean editing the inline `<script>` → CSP hash regen + serve restart (rules 1, 10). The CSS-only fix below avoids all of that and guarantees readability on mobile, which is the actual requirement.

- [ ] **Step 1: Reproduce first (evidence before fix)**

Serve locally (`npm run serve`), open `http://127.0.0.1:8765/mymanager-field-guide.html` in agent-browser at 390×844 (mobile), scroll with rapid flicks to the A-10…A-15 range, screenshot. Expected: blank stretches confirmed. Save screenshots to `tmp/` for the before/after.

- [ ] **Step 2: CSS-only mobile + reduced-motion + print safeguard**

Replace lines 556-557 area with:

```css
.reveal{opacity:0;transform:translateY(22px);transition:opacity .6s var(--ease),transform .6s var(--ease);}
.reveal.in-view{opacity:1;transform:translateY(0);}
/* Mobile readability safeguard (owner 2026-09-19): fast momentum scrolls can
   skip the IntersectionObserver callback, leaving whole sections invisible.
   On small screens we skip the animation entirely - reading beats animation. */
@media (max-width:700px){
  .reveal{opacity:1;transform:none;transition:none;}
}
/* Reduced-motion users get content immediately (a11y). */
@media (prefers-reduced-motion: reduce){
  .reveal{opacity:1;transform:none;transition:none;}
}
/* Printed guide shows everything. */
@media print{
  .reveal{opacity:1;transform:none;}
}
```

(Desktop keeps the scroll-reveal animation. No script edit → no hash regen.)

- [ ] **Step 3: Verify + commit**

Re-run the Step 1 mobile probe: every section readable during/after fast scrolls. Desktop spot-check: animation still plays. Gate: `need('mobile reveal safeguard', 'mymanager-field-guide.html', /max-width:700px/)`.

```bash
npm run verify && node tools/verify-date-wiring.cjs
git add mymanager-field-guide.html tools/verify-date-wiring.cjs
git commit -m "fix(guide): mobile reveal blank sections, readability-first safeguard"
```

---

### Task 9: Entitlement seam — AI bound to sign-in + weather-aware suggestions

**Files:**
- Create: `js/app/entitlements.js`
- Modify: `build.js` (add after `js/app/backup.js`, before `js/app/baseline-guard.js` grouping)
- Modify: `js/mmgr-watch.js` (gate + weather watcher + locked-mailbox card)
- Modify: `js/mmgr-tasks.js` (gate the "Read with AI" button)
- Modify: `tools/verify-date-wiring.cjs` (gate)

**Interfaces:**
- Consumes: `MMGR.GoogleAuth.isSignedIn()` (exists, `mmgr-google-auth.js:1760`); `MMGR.Forecast.getForecast(state)` + the module's risk-day function (locate: `grep -n 'function.*[Rr]isk' js/mmgr-forecast.js`) — cached/TTL, silently absent offline; Task 6's `MMGR.Watch`.
- Produces: `MMGR.Entitlements.aiAssistant()` — the single future door (premium/flags checks land inside it; callers never change). Weather watcher joins the Task 6 watcher list.

- [ ] **Step 1: The seam (small, deliberate, future-proof)**

`js/app/entitlements.js`:

```js
/* ============================================================
   My MaNaGeR - Entitlements (owner 2026-09-19)
   ------------------------------------------------------------
   ONE door for "is this gated capability active?". Today the
   only gated capability is the AI assistant, and the rule is:
   signed-in Google account = active. FUTURE (owner): premium
   flags and per-feature toggles land HERE as extra AND-terms -
   no call site ever changes. Plain rule per owner directive:
   heavy AI features ride the account; offline helpers never do.
   ============================================================ */
var MMGR = window.MMGR || {};
(function(ns) {
  'use strict';
  function aiAssistant() {
    return !!(ns.GoogleAuth && typeof ns.GoogleAuth.isSignedIn === 'function' && ns.GoogleAuth.isSignedIn());
    // FUTURE DOOR (do not wire yet): && ns.Entitlements.premium()
  }
  ns.Entitlements = { aiAssistant: aiAssistant };
})(MMGR);
window.MMGR = MMGR;
```

- [ ] **Step 2: Gate the assistant + locked-mailbox card**

In `MMGR.Watch.run()`, first line inside `try{}`:

```js
      if (!(ns.Entitlements && ns.Entitlements.aiAssistant())) { renderBell(); return; }
```

In `openMailbox()`, when locked, render the plain-language card instead of the list:

```js
    if (!(ns.Entitlements && ns.Entitlements.aiAssistant())) {
      box.querySelector('[data-mailbox-list]').innerHTML =
        '<div class="ai-note"><div class="ai-note-tx">The background assistant is part of the signed-in experience. Sign in with Google and it starts watching lead times, budget and resources on this project - everything stays on this machine either way.</div>' +
        '<button class="btn btn-g btn-s" data-action="openSignIn">Sign in</button></div>';
      box.classList.add('on');
      return;
    }
```

(`openSignIn` routes to the existing sign-in sheet mount on project.html — locate its existing ACTION_MAP entry during implementation; reuse, don't invent.)

- [ ] **Step 3: Weather-aware watcher (deterministic, cached, offline-safe)**

Add to the watcher list in `run()`:

```js
  // Weather-aware scheduling hint: weather-exposed tasks whose window
  // contains a forecast risk day. Uses ONLY the cached forecast (offline ->
  // no cache -> silently nothing). Threshold logic is the forecast module's
  // own - this never invents weather, it just cross-references the calendar.
  function watchWeather(s) {
    if (!ns.Forecast || !ns.Forecast.getForecast) return [];
    const fc = ns.Forecast.getForecast(s);
    if (!fc || !fc.length) return [];
    const risky = new Map(); // date -> probability
    for (const day of fc) {
      if (day && day.date && (day.precipProb || 0) >= 60) risky.set(day.date, day.precipProb);
    }
    if (!risky.size) return [];
    const out = [];
    for (const t of (s.tasks || [])) {
      if (!t.weatherExposed || !t.startDate || !t.endDate) continue;
      for (const d of risky.keys()) {
        if (d >= t.startDate && d <= t.endDate) {
          out.push({ kind: 'weather', severity: 'info',
            text: t.name + ' runs ' + t.startDate + ' to ' + t.endDate + ' - ' + risky.get(d) + '% rain likely on ' + d + '. Check the window.' });
          break; // one notice per task, not per day
        }
      }
    }
    return out;
  }
```

(Align the probability field/threshold with the forecast module's actual risk-day code in Step 0's read — the numbers must come from the same source of truth, per the no-fabrication rule.)

- [ ] **Step 4: Gate the AI import button**

In the Import Dates modal wiring (Task 3's button), render the "Read with AI" button only when `ns.Entitlements.aiAssistant()`; signed-out users see the strict-grammar path plus one quiet line: "AI reading is part of the signed-in experience." Nothing else changes offline.

- [ ] **Step 5: Verify + commit**

```js
need('entitlement seam exists', 'js/app/entitlements.js', /aiAssistant/);
need('watcher gated on sign-in', 'js/mmgr-watch.js', /Entitlements\.aiAssistant/);
need('weather watcher present', 'js/mmgr-watch.js', /watchWeather/);
```

Harness: signed-out → run() no-ops, mailbox shows sign-in card; simulated sign-in → watchers run; seeded weather-exposed task inside a cached risk day → notice appears; offline cache empty → no notice, no error.

```bash
node build.js && npm run verify && git add -A && git commit -m "feat(entitlements): AI bound to sign-in, weather-aware watcher added"
```

---

### Task 10: Sign-in UI polish + Privacy/Terms links (researched, moderate)

**Files:**
- Modify: `js/mmgr-google-auth.js` (email sign-in sheet template + password control markup — JS-rendered, so no CSP churn)
- Modify: `mymanager-field-guide.html` (A-15: one line with Privacy Policy + Terms of Service links)
- Modify: `css/marketing.css` or the sheet's scoped styles (only what polish needs)
- Modify: `tools/verify-date-wiring.cjs` (gate)

**Scope discipline (owner directive):** researched polish, NOT a redesign. "Not too many tweaks — overdoing it could spoil it."

- [ ] **Step 0: Research + before-screenshot**

Web-search current sign-in UX guidance (trust cues, single-column forms, visible labels, error placement, autocomplete attributes, loading states). Screenshot the current sheet (marketing header sign-in + project-page unlock) at desktop + mobile widths into `tmp/` for before/after comparison.

- [ ] **Step 1: Locate the sheet markup (read first)**

`grep -n 'marketing-email-auth\|mountEmailAuth\|mountPasswordControl' js/mmgr-google-auth.js` — the templates live in this module's render strings. Patch THERE (external file, CSP-safe).

- [ ] **Step 2: The polish list (each item small, all optional-looking, none structural)**

1. **Autocomplete + inputmode** on inputs: `autocomplete="email"`, `autocomplete="current-password"` (correct sign-in vs signup variant), `inputmode="email"` — mobile keyboards and password managers both improve.
2. **Visible focus rings** on inputs/buttons (existing `:focus-visible` token styles — reuse, consistency law).
3. **Button loading state**: submit button gets disabled + "Signing you in…" text while the request is in flight (existing toast/timeout conventions; no new spinner library).
4. **Inline error placement**: errors render directly under the offending field with `role="alert"` (existing error styles; no toast-only errors for form fields).
5. **Trust microcopy under the submit button**: "You're signing in to save projects to your own cloud. Nothing is shared."
6. **Privacy Policy + Terms of Service links** directly under the submit area:

```html
<p class="auth-legal"><a href="privacy.html">Privacy Policy</a><span aria-hidden="true"> · </span><a href="terms.html">Terms of Service</a></p>
```

(relative hrefs — same convention as the marketing pages that already link them; verify the existing marketing footer hrefs during Step 1 and mirror exactly.)

7. **Field guide (A-15)**, after the cloud backup prose: `<p class="prose">Read the <a href="privacy.html">Privacy Policy</a> and <a href="terms.html">Terms of Service</a> — they are short, and they are the contract for everything above.</p>` (guide only + sign-in sheet only, per owner: nowhere else new).

- [ ] **Step 3: After-screenshot + verify + commit**

Same agent-browser probe as Step 0 — compare, confirm the sheet reads better without structural change. Gate: `need('legal links on sign-in', 'js/mmgr-google-auth.js', /privacy\.html[\s\S]{0,120}terms\.html/)` + `need('guide links legal docs', 'mymanager-field-guide.html', /Privacy Policy<\/a>[\s\S]{0,120}terms\.html/)`. Emoji scan on any new strings (hard gate).

```bash
node build.js && npm run verify
git add -A && git commit -m "feat(auth): sign-in polish and privacy/terms links on sign-in and guide"
```

---

### Task 11: Field-guide mobile sidebar fix — root cause: CSP-blocked inline script

**Files:**
- Modify: `serve.cjs` `INLINE_SCRIPT_HASHES` (regenerate with the documented node command + restart any running serve instance)
- Modify: `worker.js` `INLINE_SCRIPT_HASHES` (same regeneration)
- Modify: `tools/verify-date-wiring.cjs` (gate)

**Diagnosis (verified this session, stronger than the owner's report):** the toggle wiring EXISTS (`mymanager-field-guide.html:1905-1922`: menuBtn toggle, scrim click, nav-link close). It sits in the page's **inline `<script>` (line 1889+)**. `serve.cjs`'s `INLINE_SCRIPT_HASHES` (line 69+) is a static list whose members hash OTHER pages' blocks — the field guide's block hash is absent — and the Worker serves the same CSP. Consequence: in production the guide's ENTIRE inline script never runs (sidebar toggle dead, scroll-reveal dead — which retroactively explains why the Task 9 blank sections were permanent on the live site, not just scroll-race flakiness), while `npm run verify`'s disk-to-disk comparisons still pass. This is AGENTS.md rule 1's exact failure shape.

- [ ] **Step 1: Evidence before edits**

```bash
# sha256 of each inline block ON DISK (guide here; per AGENTS.md lesson 10 pattern)
node -e "const fs=require('fs'),c=require('crypto');const h=fs.readFileSync('mymanager-field-guide.html','utf8');[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m,i)=>console.log(i+1,c.createHash('sha256').update(m[1]).digest('base64')))"
# hashes the RUNNING server enforces (restart serve.cjs first if edited earlier today):
curl -sI http://127.0.0.1:8765/mymanager-field-guide.html | grep -io "sha256-[^']*"
```

Expected: the guide's hash missing from the second list. Screenshot the mobile guide with agent-browser (390×844): menu button tap → sidebar does NOT open.

- [ ] **Step 2: Regenerate hashes, both files, one command**

Use the command documented in `worker.js`'s header comment (per rule 1) to regenerate `INLINE_SCRIPT_HASHES` for **all** served pages, paste into `worker.js` AND `serve.cjs` (they must match 1:1), then **restart serve.cjs** (lesson 10: a running server keeps serving the STALE CSP — verify the PID's command line before touching anything, never kill by image name).

- [ ] **Step 3: Live re-probe**

`curl -sI http://127.0.0.1:8765/mymanager-field-guide.html | grep -io "sha256-[^']*"` now includes the guide's hash. agent-browser mobile probe: menu tap → sidebar slides in, topic links scroll + close the drawer, scrim tap closes. Scroll-reveal animations now run on the live page (Task 8's desktop path becomes live too).

- [ ] **Step 4: Verify + commit**

`npm run verify` (CSP gate + guide hash parity), plus the disk/live header comparison from Step 1 as a session check. Add gate: `need('guide inline hash present in serve.cjs', 'serve.cjs', new RegExp(hashB64 escaped))` — computed at gate runtime from the file, not hardcoded.

```bash
git add serve.cjs worker.js tools/verify-date-wiring.cjs
git commit -m "fix(csp): register field-guide inline script hash, mobile sidebar works"
```

---

### Task 13: Sync bond — imported/file-copied projects stay linked to their cloud twin

**Owner directive (2026-09-19, session):** when a project is taken offline (exported .json from a cloud-linked project) and opened on another device, there must be a bond to sync it back with the copy it came from — and vice versa: an offline copy that later becomes a cloud copy must auto-link to its origin. If a sync ever fails, the user must be able to re-sync explicitly, and both copies keep carrying information side by side (budget change here = budget change there).

**Current-state findings (verified this session):**
- A project's identity is `mmgr_state_<projectId>` (localStorage, `mmgr-state.js:675`); the cloud-facing id rides `mmgr_cloud_id_<pid>` (`mmgr-cloud.js:72-78`), with code/scope slots namespaced under it.
- `State.exportState()` (`mmgr-state.js:1094`) exports the full state blob but carries NO cloud identity; `importState()` re-id's nothing — the imported blob keeps its old `projectId` field but the device addresses the project by whatever `?id=` it is opened under, so the bond is lost in practice.
- `mmgr-cloud.js` linkage per device: `getCode()` (owner code in localStorage), `_sessOwner` (Google session as owner), `cloudClaim` (link to my account). `loadWithCode()` + `probeLoad()` already know how to fetch a cloud blob by id + code — the machinery exists; what is missing is the BOND surviving the file trip.
- Multi-tab conflict modal (`onExternalChange`, `mmgr-app.js:1055`) shows a merge path already exists for same-key conflicts.

**Design (additive, no schema bump):**
1. **Export carries the bond:** `exportState()` embeds a `cloudBond` object when the project is cloud-linked: `{ cloudProjectId: pid(), linkedAt, lastSyncedAt }`. Never the owner code itself — the bond points, it does not authenticate. Secrets stay stripped as today.
2. **Import detects the bond:** on `importState()`, if the incoming blob has `cloudBond.cloudProjectId` and this device has no cloud link for the current project id, store the bond locally (`mmgr_cloud_bond_<localId>`) and surface a one-time quiet card: "This project came from the cloud — Re-sync with its cloud copy?" with Re-sync / Later.
3. **Bond-aware sync:** `mmgr-cloud.js` `saveToCloud()`/`loadFromCloud()` prefer, in order: existing owner code → Google session owner (existing) → stored bond + sign-in challenge. When a bond resolves via session (`cloudClaim` path), the device adopts the full link (code optional — session fallback already works server-side).
4. **Offline → cloud creation:** `createProject()` (cloud create) checks for a stored bond first; if present, it links to the EXISTING cloud twin (probe with session) instead of creating a duplicate second cloud project.
5. **Force re-sync:** a "Re-sync now" button (bonded projects) re-runs load+merge with lastSyncedAt shown; failures show plain-language reasons and keep the bond for retry.
6. **Conflict path:** bonded sync lands through the same per-field timestamp merge already built for multi-tab (`mergeFromExternal`), so side-by-side fields reconcile newest-wins-per-field, not whole-file.

**Files:**
- Modify: `js/mmgr-state.js` (`exportState` bond embed; import bond detection hook)
- Modify: `js/mmgr-cloud.js` (`resolveBond()`, bond-aware `saveToCloud`/`loadFromCloud`/`createProject`, `resyncNow()`)
- Modify: `project.html` Cloud section markup (bond card + Re-sync button)
- Modify: `js/mmgr-app.js` `ACTION_MAP` (`cloudResync`, `cloudBondLater`)
- Create: `tools/qa-sync-bond.cjs` (export→fresh device→bond detected→re-sync merges a budget change both ways)

- [ ] **Step 1:** Implement bond embed + detection (pure state layer) with static gate.
- [ ] **Step 2:** Bond-aware cloud resolution + create-twin guard; harness D-gates for both directions (cloud→file→new device; file→cloud create→links twin).
- [ ] **Step 3:** Re-sync button + conflict merge via existing per-field path; E2E gate: budget edit on device A syncs to device B and back.
- [ ] **Step 4:** Full protocol (build/verify/commit/push/CI/deploy/reflection).

---

### Task 14: Docs + tracker closeout (no-slacking self-check)

**Files:**
- Modify: `docs/DEVELOPER-GUIDE.md` (module map: add `js/app/baseline-guard.js` row; split-candidates note: `updTaskField` grew, keep an eye)
- Modify: `PLANNING-TODO-2026-09-09.txt` (active tracker: record directive + outcomes per CI-repair-loop step 6)
- Modify: `mymanager-field-guide.html` (already updated in Task 5; final read-through for plain language)
- Modify: `reflection.txt` (session specifics)

- [ ] Run `node build.js && npm run verify` one final time (evidence in output).
- [ ] Update the three docs above with what shipped and where.
- [ ] Commit: `docs(tracker): record date-wiring, baseline guard, AI import, parallel tags`

---

## Execution protocol (owner-defined, applies to every task)

Per-task loop, in this exact order:

1. **Implement** the task per its steps (gate fails first, then passes).
2. **Local QA:** `node build.js` → `npm run verify` → the task's targeted harness. All GREEN before anything moves.
3. **Commit** (Conventional Commit, ≤72 chars, no attribution footer).
4. **Push** and **poll the Actions API** until that run completes (authenticated pattern like `tmp/poll-ci.cjs`). RED → CI-repair loop: read the failing step, reproduce locally, fix harness-or-app, re-push. The run is the gate, not the push.
5. **Deploy** only after a green run: clean-staging tar recipe from `wrangler.jsonc` — stage under `$HOME`, `grep` the staged copy for a known-new string to prove it carries the new code, deploy from the staging copy, never the repo root.
6. **Record** the outcome in `reflection.txt` + the PLANNING tracker (task, commit, CI run id, deploy confirmation) so the session log matches reality.

Suggested execution order (dependency-shaped): 1→2 (date/baseline foundation) → 8→11 (mobile bugs first, they block trustworthy verification of later UI work) → 3→4→5 (WBS features) → 6→9 (assistant + entitlements) → 7 (cap) → 10 (sign-in polish) → 12 (closeout). Owner may re-order at review.

---

## Self-Review (done against the spec)

- **End→days wiring:** Task 1 (field edits + drag commits, both directions of the invariant). ✔
- **"Days tab calculates naturally / countdown":** Task 1 + existing dashboard counters (`daysLeft` render path untouched, now fed consistent durations). ✔
- **Baseline auto-save OR clear signal, "some persons may miss it":** Task 2 does both — auto-capture with toast + persistent red dot + plain-language dashboard line. ✔
- **AI reads text/file, flags mismatch and shows where:** Task 3 validator + mismatch panel; files limited to readable text types with honest refusal otherwise. ✔
- **Parallel tasks: tag, show what they're parallel with on hover, add to Definitions:** Task 4 (badge + `title`/`aria-label` peer list + glossary). Reuses audit()'s exact predicate so detection never disagrees with the schedule audit. ✔
- **Voice honesty ("not the greatest voice capture, just simple capture") + recommend dedicated meeting software without naming apps:** Task 5 Step 1 (field-guide rewrite: one-voice statement, attendee-name guidance, category-level recommendation). ✔
- **Voice steered toward field reporting + action items:** Task 5 Steps 2–3 (capture from the field report, transcript lands hand-editable in the report, quick action item via existing comms flow feeding the Decision Engine). ✔
- **Background assistant watching budget/resources/WBS/lead-times, mailbox notifier beside settings, local-only, user-deletable, premium-later:** Task 6 (deterministic watchers traceable to real fields; `s.aiInbox` persists across sessions until dismissed; header bell beside the settings icon; premium gate deferred to `s.flags` in a future wave). ✔
- **8-project local cap + "local can't back up, sign in is safer" guidance, no scare tactics, no app/behavior trickery around delete-to-dodge:** Task 7 (cap with guidance modal + honest field-guide copy). ✔
- **Secrets:** none needed anywhere in the plan; future-missing-secret convention documented in Global Constraints. ✔
- **Mobile blank sections in the guide ("nothing to read until A-16"):** Task 8 — diagnosed (reveal observer skipped on fast mobile scroll), fixed CSS-only (zero CSP churn), reproduce-first evidence required. ✔
- **AI linked to signing in, heavy feature behind the account, future door for premium/flag changes without rework:** Task 9 — single `Entitlements.aiAssistant()` seam gates assistant + AI import; strict offline paths stay open; premium lands later inside the seam. ✔
- **AI linked to weather (influence tasks/decisions, not too much not too little):** Task 9 Step 3 — deterministic cached-forecast cross-reference, one hint per exposed task, AI never invents weather. ✔
- **Sign-in UI polished (researched, moderate, don't overdo) + Privacy/Terms on sign-in and in the guide only:** Task 10. ✔
- **Mobile sidebar dead on the guide (owner: "refresh again… doesn't work"):** Task 11 — root-caused to the CSP-blocked inline script (hash never registered), which also explains the Task 9 severity on the live site; fix = hash registration in both serve.cjs + worker.js, restart, live-probe. ✔
- **No UI breakage / additive only:** no schema bump, no removed features, CSP untouched, offline-first preserved (AI optional). ✔
- **Type consistency:** `durationFromDates` defined Task 1, reused Tasks 1 (drag) and 3 (import reconciliation); `validateImportLines` defined and consumed within Task 3; `parallelGroups` defined and consumed within Task 4. ✔
