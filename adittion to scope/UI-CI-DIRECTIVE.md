# My MaNaGeR - Directive v2: calculator dropdowns, voice echo, AI window, CI

**Version:** v2, re-verified line by line against the uploaded codebase (`mymanager-fixed__3_.zip`, git `HEAD` = `9d703e0`, 2026-10-29). Replaces `UI-CI-DIRECTIVE.md` v1.
**Audience:** the terminal AI. Everything below is an instruction. Do not ask for permission between steps that have a stated gate; run the gate and continue when it is green.
**Line numbers** are exact at `9d703e0`. If `git log -1 --format=%h` is not `9d703e0`, re-derive every anchor by selector or function name and note the drift in the log. The intent is the contract, not the line number.

| ID | Item | Cause | State of the evidence |
|---|---|---|---|
| **D-3** | Calculator dropdowns detach from their field and scroll with the page | `.card` has `contain: layout paint`, popup is `position: fixed` inside it | Re-confirmed in code (section 3.1) |
| **D-2** | Voice dictation echoes and starts with `null` | Two bugs in `rec.onresult` | Re-confirmed in code (section 4.1) |
| **D-1** | AI window cramped when narrow, header and composer overloaded | Layout keyed to viewport, one-row composer, 8-item header | Re-confirmed; **v1 had three factual errors and one conflict with an existing gate, fixed here** |
| **D-4** | CI 24.6 min to about 6-8 min | Test execution, not setup | **v1 had four factual errors, fixed here; timings must be re-measured first (D4.0)** |

---

## 0. First action of the session: ask once, then never again

Send **one** message to the owner containing the five questions in section 8, each with its stated default. Then continue immediately with D-3 and D-2 (they depend on no answer). If an answer has not arrived by the time a task needs it, apply the stated default, write the assumption in `docs/history/log-2026-10.md`, and keep going. Do not ask a second round of questions.

---

## 1. Verified ground truth at `9d703e0`

| Fact | Value | Where checked |
|---|---|---|
| Branches | `main` only. `ci.yml` triggers: `push: [main]`, `pull_request -> main` | `.github/workflows/ci.yml` lines 3-7 |
| CI | one job `verify`, 871 lines, 111 named steps (116 in the GitHub UI), 84 `id:` fields, concurrency group `ci-${{ github.ref }}` | `ci.yml` |
| Service worker shell | `mmgr-shell-v504` (v1 and EXECUTION-PLAN quote older values) | `sw.js:408` |
| Client schema | `SCHEMA_VERSION = 24` | `js/mmgr-state.js:185` |
| D1 migrations | through `0029_team_enterprise.sql` | `migrations/` |
| AI dock default width | **520 px** (`AI_SIZE_DEFAULT_W = 520`, `:root { --ai-w: 520px }`), min 480 (`AI_SIZE_MIN_W`) | `js/mmgr-ai.js:2952, 2924`, `css/mmgr.css:12580` |
| AI regimes (by viewport) | docked >= 1280, overlay 1024-1279, full-screen sheet < 1024; Maximise and Float are separate | `css/mmgr.css` comment above `:root { --ai-w }` |
| Combobox scope | only `calculator.html`, only the two long lists `#calc-work` and `#calc-family`; loaded as a plain script `js/mmgr-combobox.js?v=1` (not in the bundle) | `calculator.html:963` |
| Parked by owner | `UI-FIXES-SPEC.md`, `plan-ui.md`, `qa-landing-ui.cjs` (all in the untracked folder `the last update towrads maintainance mode/`). **Nothing from them executes.** | `EXECUTION-PLAN.md` section 2 |
| Dirty tree you must not touch | `M .githooks/pre-commit`, `?? AUTHORS-FIX-ISSUE.md`, `?? the last update towrads maintainance mode/` | `git status --short` |

### 1.1 What v1 got wrong (all corrected below)

| # | v1 said | Code says | Consequence |
|---|---|---|---|
| 1 | AI dock default 420 px | 520 px. 420 is only `FLOAT_W_MIN` | Raising `AI_HIST_INLINE_MIN` to 720 would move the history column to slide-over at the **default** width and break gate `qa-ai-win` "1440: the conversation column is visible at the default width". Handled in D-1 step 1 |
| 2 | "Keep every existing id so the wiring stays untouched; only markup order and CSS change" | Pills are asserted by id and by container in `qa-ai.cjs:792` (**CI**), `qa-ai-visual.cjs:144,192` and `tools/qa-ai-polish.cjs:139-149` (both TRIAGE). Float button is created by JS and injected into `.ai-head` (`setupFloatSurface`, `mmgr-ai.js:3131`) | Needs a keep-the-ids design and a JS change for Float. Handled in D-1 step 2 |
| 3 | Do U-05 gold tokens first, follow U-04 no pills | `UI-FIXES-SPEC` is **parked**. The folder is untracked | D-1 uses existing tokens only (`--gold`, `--gold-text`, `--gold-ink`, `--radius-control` = 8px) |
| 4 | "The failure mode AGENTS.md section 14 is about" (silent skip) | Section 14 is about **unwired harnesses**. Silent skips are covered by section 8 item 1 | Cite correctly; the proof script in D4.3 is still required |
| 5 | About 45 `wrangler-start` gates | **24** `if:` gates, 1 `id: wrangler-start`, 1 reference in CI Summary | Smaller rewrite than v1 feared; the proof script still decides |
| 6 | T2 after restart = 4 steps, T3 = 2 steps | After the restart only `Controls admin` runs on :8787. After `Stop wrangler dev` three self-contained suites run (Client codes 8808, API keys 8809, Sync bond 8810). `T3: Team UI` (8813/9246) sits **inside** the gated block, before the stop | Split by the classification in D4.2, not by v1's table |
| 7 | New harness `qa-landing-ui` joins the browser job | It is parked and not in `tools/` | Removed |
| 8 | Acceptance: "existing qa-calc-controls / qa-calc-playwright-audit stay green" after the portal | They select the popup as a child of the wrapper (`.mmcb[data-for="calc-work"] .mmcb-pop`) and **will fail** | Selector updates are mandatory work in D-3 |
| 9 | CSS ranges "about 11865-12185" | AI CSS is at `css/mmgr.css` 9607-9750 and 12566-12950 | Anchors updated |
| 10 | Composer textarea "auto-grow rows 1 to 6" as new work | Auto-grow already exists (`mmgr-ai.js:2842`, capped at 120 px) | Only the cap changes |

---

## 2. Rules for every task (self-enforcing)

**Read first, in this order:** `CLAUDE.md`, `CONTINUATION-DIRECTIVE.md`, `AUDIT-DIRECTIVE-2026-10-18.md`, `AGENTS.md`. Load the skills `AGENTS.md` maps to the files you touch (`.agents/skills/<name>/SKILL.md`).

**Locked rules that bind this work** (from `CONTINUATION-DIRECTIVE.md`):
1. No emoji and no glyph icons in served pages or JS strings. Icons are sprite symbols only (`css/mmgr-icons.svg`). The "more" icon is `#i-more` (exists). Never type the character for an ellipsis as an icon.
2. No em dash and no en dash in served copy. Titles, tooltips, labels, banners: commas, periods, "to".
3. Plain language on user faces. Gold is called gold.
4. Consistency by reference: find the sibling already in the app and match it.
5. Commits are Conventional Commits, subject at most 72 characters, imperative, **no AI attribution** (the `.githooks/commit-msg` hook enforces it). One commit per task.
6. Never create a review zip. Never touch secrets.
7. A user-facing change that alters something `mymanager-field-guide.html` describes gets that text updated in the same commit (D-1 only; D-2 and D-3 are fixes).
8. Deploy only from a clean staging copy under `$HOME/mmgr-deploy`, never from `/tmp` or the repo root. Never write scratch files to `/tmp`; use `tmp/` in the repo (`AGENTS.md` section 9). The environment is Windows with git bash.

**Git hygiene (hard):**
- `git add` explicit paths only. Never `git add -A`, `git add .`, or `git commit -a`.
- Never stage `.githooks/pre-commit`, `AUTHORS-FIX-ISSUE.md`, or the folder `the last update towrads maintainance mode/`.
- No history rewrite, no force push, no `git reset --hard`.
- Everything lands on `main` in small commits **except D-4**, which goes through the branch route chosen in question 1.

**Build ritual after every task** (all must be green before the commit):
1. `node build.js`
2. If any served file changed, bump `const CACHE` in `sw.js:408` (`mmgr-shell-v504` becomes `v505`, and so on, one bump per commit).
3. If any inline `<script>` block changed (including in `project.html` or `calculator.html`), run `node tools/regen-csp-hashes.cjs` and commit the resulting `worker.js` and `serve.cjs` changes. Restart `serve.cjs` after inline-script edits (`AGENTS.md` section 10).
4. `npm run verify`
5. The task's own gate (named in each section).
6. Browser checks only after step 1 (an unbuilt tree has no CSS; `dist/` is gitignored).

**New harness = three edits** (`AGENTS.md` section 14): the harness file in `tools/`, a row in `docs/CI-TEST-COVERAGE.md` with a status token, and a step in `ci.yml`. A registry row alone does not run it.

**CI repair loop** (`AGENTS.md` section 8): after each push, poll the Actions API until the run completes. The remote run is the truth, not the local run. Fix the harness when the app contract changed under it.

---

## 3. D-3 - Calculator dropdowns detach and scroll with the page

### 3.1 Verified cause
- `css/mmgr.css:2075`: `.card { ... contain: layout paint; }`. A `layout` or `paint` containment ancestor becomes the containing block for `position: fixed` descendants, and `paint` also clips them.
- `css/mmgr.css:17970`: `.mmcb-pop { position: fixed; z-index: 1400; ... }`.
- `js/mmgr-combobox.js:128`: `wrap.appendChild(pop);` puts the popup inside the card.
- `js/mmgr-combobox.js:271-290` `place()` writes `getBoundingClientRect()` viewport coordinates into `left/top`, so every popup is offset by the card's own position and moves with it.
- There is **no destroy path** in the module today. Once the popup leaves `wrap`, an orphaned popup can remain on `body` if the select is ever removed. Section 3.2 closes that.

### 3.2 Change (portal plus frame-accurate tracking)

In `js/mmgr-combobox.js`:
1. Replace `wrap.appendChild(pop);` with `document.body.appendChild(pop);`.
2. Set `pop.setAttribute('data-for', sel.id || '');` (use the **select's** id, the same value already written to the wrapper at line 83, so one selector works for both: `.mmcb-pop[data-for="calc-work"]`).
3. `onDocDown` (line 353): treat the click as inside when `wrap.contains(e.target) || pop.contains(e.target)`.
4. Add `var raf = 0; function track(){ if (pop.hidden){ raf = 0; return; } place(); raf = requestAnimationFrame(track); }`. In `open()` after `pop.hidden = false` start it; in `close()` call `cancelAnimationFrame(raf)`. Keep the existing scroll and resize listeners as fallback and add `window.visualViewport` `resize` and `scroll` listeners (added in `open()`, removed in `close()`).
5. In `place()`, clamp: `left = Math.max(8, Math.min(left, window.innerWidth - width - 8))`. Keep the flip rule (opens above when less than 240 px below) and keep the <= 640 px bottom-sheet branch exactly as it is.
6. Orphan cleanup: at the top of `open()` and `close()`, `if (!wrap.isConnected) { pop.remove(); return; }`. Also, at module init, remove any `.mmcb-pop` whose `data-for` does not match a live `.mmcb[data-for]`.
7. Keep `aria-controls`, `aria-labelledby` and the `mmcb-list-<uid>` ids unchanged (ids are global, they still resolve).
8. `calculator.html:963`: bump `js/mmgr-combobox.js?v=1` to `?v=2` (the file is not bundled, so the query string is the cache key). Bump `sw.js` `CACHE`.
9. `css/mmgr.css` 18037 mobile block: no change. Theme variables are on `:root` and `body.dark-mode`, and the popup is still a descendant of `body`, so colours resolve as before. **Verify** this in dark mode with the screenshot step below.

**Optional progressive enhancement (do only if the gate in 3.4 is already green):** top-layer rendering via `pop.popover = 'manual'` plus `showPopover()` removes z-index fights with any future modal, and CSS anchor positioning (`position-anchor`, `anchor()`) can replace the JS placement behind `@supports (anchor-name: --a)`. Anchor positioning ships in Chrome 125, Safari 26 and Firefox 147, but sources disagree on whether the whole feature is formally "Baseline", so it must stay an enhancement behind `@supports` with the JS path as the default. Skip it if it adds a single failing check.

**Do not use** `.card:has(.mmcb) { contain: none }` as the fix. It restores the performance cost the X-2 change removed and leaves the same bug for every other fixed element in a card.

### 3.3 Containment audit (one-time, then permanent gate)
Create `tools/qa-fixed-containment.cjs` (new harness, three edits, section 2). It loads `calculator.html`, `project.html` and `app.html` with Playwright (copy the launch pattern from `tools/qa-calc-controls.cjs`, which already uses system Chrome), opens the AI window and the calculator lists where applicable, then walks every element whose computed `position` is `fixed`. For each, walk its ancestors and fail if any ancestor has computed `contain` containing `layout` or `paint`, a non-`none` `transform`, `filter`, `backdrop-filter`, `perspective`, `container-type` other than `normal`, or `will-change` naming one of those. Print element, ancestor and property. Start with an allowlist file `tools/fixed-containment-allow.json` containing only offenders you prove are intentional (each with a one-line reason); the harness fails on any offender not on the list. Status token **CI**, placed in the `browser-app` group.

### 3.4 Gate (extend `tools/qa-calc-controls.cjs`, which is CI step "Calculator listbox, setting rows, Performance Mode")
Mandatory selector updates, same commit:
- `tools/qa-calc-controls.cjs` lines 310, 317, 410, 419: replace `.mmcb[data-for="calc-work"] .mmcb-pop` / `wrap.querySelector('.mmcb-pop')` with `.mmcb-pop[data-for="calc-work"]` queried from `document`.
- `tools/qa-calc-playwright-audit.cjs` line 115: same replacement.
- `tools/qa-shortcuts.cjs` line 139 clicks `.mmcb-input` only; verify it still passes, change nothing unless it fails.
- Keep every line that clicks `.mmcb[data-for="calc-work"] .mmcb-input` (256, 309, 407): the input is still inside the wrapper.

New assertions, for both `#calc-work` and `#calc-family`, at viewports 1920x1000, 1100x800, 800x700 (and 700x900):
1. `pop.parentElement === document.body`.
2. After open: `|pop.left - input.left| <= 1`, and `3 <= pop.top - input.bottom <= 5` (or, when flipped, `pop.bottom ~= input.top - 4` within 1).
3. Sample every `requestAnimationFrame` for 1 s while (a) 8 mouse-wheel steps of 60 px, (b) `scrollBy({ top: 300, behavior: 'smooth' })`, (c) inserting a 120 px element above the field: dx and dy stay constant within 1 px.
4. The popup is fully visible even where it extends past the card's bottom edge (`getBoundingClientRect()` inside the viewport, and `elementFromPoint` at its centre returns a node inside the popup).
5. Orphan test: remove the wrapper from the DOM, call open path or fire the init sweep, then assert `document.querySelectorAll('.mmcb-pop').length` equals the number of live `.mmcb`.
6. Dark mode: with `body.dark-mode` set, the popup background and option text colours come from the theme tokens (reuse the contrast helper `window.__mmcbContrast` already in the file).
Existing 63 checks must stay green. Then `qa-calc-playwright-audit`, `qa-shortcuts`, `qa-fixed-containment` green.

**Done when:** all the above pass locally, `npm run verify` green, committed as `fix(calc): portal the listbox out of the contained card`, CI run green.

---

## 4. D-2 - Voice dictation echoes and starts with `null`

### 4.1 Verified cause (`js/mmgr-voice.js`)
- `toggleAiRecording()` starts at line 1512; it uses the **browser Web Speech API** (`SpeechRecognition`), not Whisper. The Whisper tier belongs to meeting and field capture.
- `rec.onresult` (lines 1550-1572):
  - line 1564: `_aiBase = q.value + ... + finalText.trim();` builds the new base from `q.value`, which still contains the interim text written by the previous event, so interim and final both end up in the box (the echo).
  - line 1567: `q.value = _aiBase + (...)` runs while `_aiBase` is still `null` (set at line 1609 and `let _aiBase = null;` at 1618) until the first final result, so the string `null` is concatenated into the box.
- Mic tooltip `project.html:1614` says "Voice input (whisper transcription)", which is wrong.
- No harness covers dictation today (`grep` for `toggleAiRecording|aiVoiceToggle|ai-voice-btn` in `tools/` and root `qa-*.cjs` returns nothing).

### 4.2 Change
In `js/mmgr-voice.js`:
1. Module-level helper (outside `toggleAiRecording`):
```js
function aiJoin(a, b) {
  b = String(b || '').trim();
  if (!b) { return a; }
  return a + (a && !/\s$/.test(a) ? ' ' : '') + b;
}
```
2. Replace `_aiBase = null;` (line 1609) with `const q0 = document.getElementById('ai-q'); _aiBase = q0 ? q0.value : '';` and attach the typing listener there (see 5).
3. Replace the body of `rec.onresult` with:
```js
const q = document.getElementById('ai-q');
if (!q) { return; }
let fin = '', interim = '';
for (let i = e.resultIndex; i < e.results.length; i++) {
  const t = e.results[i][0].transcript;
  if (e.results[i].isFinal) { fin += t; } else { interim += t; }
}
const now = Date.now();
if (fin) {
  const chunk = fin.trim();
  // Android Chrome sometimes re-emits the same final; skip an identical chunk within 1 s.
  if (!(chunk === _aiLastFinal && now - _aiLastFinalAt < 1000)) {
    _aiBase = aiJoin(_aiBase, chunk);
    _aiLastFinal = chunk; _aiLastFinalAt = now;
  }
}
q.value = aiJoin(_aiBase, interim);   // interim is display only, recomputed each event
q.dispatchEvent(new Event('input', { bubbles: true }));
try { q.focus({ preventScroll: true }); } catch (e2) { /* ignore */ }
```
   Declare `let _aiLastFinal = ''; let _aiLastFinalAt = 0;` next to `let _aiBase`.
4. Typing mid-dictation: define **one** named function `aiOnType(ev){ if (ev.isTrusted && _aiRec) { _aiBase = this.value; } }`. Add it with `q0.addEventListener('input', aiOnType)` at start and remove it in `stopAiDictation()`. Do not add an anonymous listener per start (it would stack). The synthetic `input` event dispatched in `onresult` has `isTrusted === false`, so it does not overwrite the base.
5. `stopAiDictation()` also resets `_aiLastFinal = ''`.
6. `rec.onend` auto-restart stays as is; a restart resets `resultIndex`, which is safe with a committed base.
7. `project.html:1614`: title becomes `Voice input (browser speech recognition)`. No dash characters.

### 4.3 Gate: new `tools/qa-ai-dictation.cjs` (three edits; place it in the `browser-app` CI group)
Boot recipe: copy the signed-in and entitlement seam from `tools/qa-ai-win.cjs` (the AI window refuses to open without it; `qa-ai-visual.cjs` is TRIAGE for exactly that reason). Inject, before page scripts run, a stub `window.webkitSpeechRecognition` class whose instance exposes `start()`, `stop()` and a way for the test to call `onresult` with `{ resultIndex, results }` objects shaped like the real API (`results[i].isFinal`, `results[i][0].transcript`), and `onend`. Click the real `#ai-voice-btn` (not a private helper). Assert on `#ai-q`.value:
1. Sequence interim `it's` then interim `it's echoing` then final `it's echoing` gives exactly `it's echoing` after each step that has a final, and never contains `null` at any point.
2. Then interim `okay` then final `okay that` gives exactly `it's echoing okay that`.
3. Pre-existing typed text `Hello` before start stays as the prefix: result `Hello it's echoing`.
4. Typing `X` by real keyboard events mid-dictation is kept: later results append after it, never overwrite it.
5. `onend` fires, the stub's `start()` is called again, the next final does not duplicate earlier text.
6. A final with no preceding interim works.
7. The same final delivered twice within 1 s is committed once.
8. `#ai-voice-btn` title equals `Voice input (browser speech recognition)`.
9. Clicking the button again stops; no listener remains (count `input` listeners via a wrapped `addEventListener` spy: net zero after stop).

**Done when:** harness green, `qa-ai.cjs` and `qa-ai-win.cjs` still green, committed as `fix(ai): stop dictation echo and the leading null`, CI green.

---

## 5. D-1 - AI window: fits any width, one slim header, one composer card

**Precondition:** D-3 and D-2 are committed and CI is green.
**Read before editing:** `js/mmgr-ai.js` (`updateHistLayout` 4040, `setupFloatSurface` 3131, status sync at 146, 695, 2902, auto-grow 2842), `project.html` 1438-1630, `css/mmgr.css` 9607-9750 and 12566-12950, `tools/qa-ai-win.cjs`.

### 5.1 Must-not-change list
- Every existing `id` and `data-action` in the AI window markup stays (`ai-win`, `ai-q`, `ai-send`, `ai-send-wrap`, `ai-tier`, `ai-voice-btn`, `ai-hist`, `ai-hist-btn`, `ai-max-btn`, `ai-pin-btn`, `ai-engine-pill`, `ai-engine-pill-label`, `ai-api-pill`, `ai-api-pill-label`, `ai-cfg-cloud`, `ai-byo-*`, `ai-welcome`, `ai-quick-presets`, `ai-presets`, `ai-seg-*`, `ai-pane-*`, `ai-ctx`, `ai-out`, `ai-trace`). The tests and the JS sync find them by id.
- Docking regimes (docked, overlay, sheet, max, float), resize strip, `Ctrl+.`, history in project state, Enter sends and Shift+Enter newline.
- No `backdrop-filter` is added to the AI window (Performance Mode has nothing extra to strip).
- Existing gold tokens only. No new colour variables.

### 5.2 Steps (do in this order, one commit per numbered step)

**Step 1 - history threshold (decision Q2).**
`js/mmgr-ai.js:3532` `AI_HIST_INLINE_MIN = 480` becomes `720` (line 4045 reads the constant). At the 520 default the conversation list becomes a slide-over opened by the History button. **Re-baseline in the same commit:** `tools/qa-ai-win.cjs` check "1440: the conversation column is visible at the default width" (around line 283) becomes two checks: at the 520 default the History button is visible and `hist-inline` is false, and after setting the window to 760 px (or Maximise) `hist-inline` is true and `#ai-hist` is visible. If the owner answers Q2 "keep 480", skip this step entirely and delete the re-baseline.

**Step 2 - header: one slim row, icon buttons, one status dot.**
Markup (`project.html` 1458-1496) and CSS:
- `.ai-head` is one row, `height: 56px` maximum, `flex-wrap: nowrap`. Left: sparkle icon, title "AI Assistant", then the status dot. Right: **New**, **History**, **Maximise**, **More**, **Close**, all `32x32`, `border-radius: var(--radius-control)`, icon only (the visible word "New" is removed; keep `title` and `aria-label`). These five fit at 360 px.
- `#ai-api-pill` becomes the status dot itself: a 10 px dot, `data-state` colours as today (green connected, amber checking, red error), still click-to-re-check, still updated by the existing code at `mmgr-ai.js:146/2902`. Keep `#ai-api-pill-label` in the DOM as a visually hidden span; it keeps receiving the text, and the same text is copied to the dot's `title` and `aria-label`.
- `#ai-engine-pill` moves into the More menu as a read-only first row (still updated by `mmgr-ai.js:695`).
- More menu: button `#ai-more-btn` with icon `#i-more`, `aria-haspopup="menu"`, `aria-expanded`, `data-action="aiMoreToggle"` (add to `ACTION_MAP` next to `aiMaxToggle`, `mmgr-app.js:4755`; it only paints, so it is allowed in view-only the same way `aiMaxToggle` is). The menu is `role="menu"`, positioned `absolute` inside the header (never `fixed`: see 5.3 item 1), items `role="menuitemcheckbox"` for **Pin** (`#ai-pin-btn`, keeps `data-action="aiPinToggle"`, `aria-pressed`) and **Float** (the `[data-float-toggle]` button). Esc closes it and returns focus to `#ai-more-btn`; arrow keys move; outside click closes.
- `setupFloatSurface` (`mmgr-ai.js:3131-3160`): for `id === 'ai-win'`, inject the Float button into the menu list instead of `.ai-head`. The header-drag exclusion at line 3178 (`closest('button,select,input,textarea,[data-float-toggle]')`) must still cover it. Verify dragging the header while floating still works.
- Radii: `.ai-pill`, `.ai-clear-btn` and `.ai-tier-badge` change from `100px` to `var(--radius-control)`.
- Update TRIAGE harness assertions that name the old containers in the same commit: `tools/qa-ai-polish.cjs` 139-149 (`rightHasEngine`, `rightHasApi`, `composerHasTier`) to the new containers. Do not promote it out of TRIAGE. `qa-ai.cjs:792` keeps passing because `#ai-api-pill` and its label still exist; run it.

**Step 3 - connection row only when needed.**
`#ai-cfg-cloud` (project.html 1519) is shown only when the tier is Cloud and the key is not connected, as a dismissible one-line banner "Connect your API key to use Cloud" (no dash characters) with the provider select inside the existing `#ai-byo-pop`. Hidden otherwise. The visibility toggle is already driven by `syncSettingsUI` through `is-hide`; extend that condition, do not add a second mechanism. `qa-ai.cjs` and `tools/qa-ai-polish.cjs` read `ai-cfg-cloud`; run both.

**Step 4 - composer becomes one card.**
- Markup: inside `.ai-composer-row` keep the class name, make it `flex-direction: column`; first child `#ai-q`; second child a new `.ai-composer-tools` row holding, in order, `#ai-tier`, `#ai-voice-btn`, then `.ai-send-wrap` with `margin-left: auto`.
- CSS (replace `css/mmgr.css:12841-12872`): card with `border: 1px solid var(--border)`, `border-radius: var(--squircle-sm)` (14 px; `--radius-card` at 24 px is too round for a composer), background `var(--card)`, padding `10px 12px 8px`. Textarea `display:block; width:100%; min-height:44px; border:0; background:transparent; resize:none`. `#ai-tier` height 32 px, radius `var(--radius-control)`.
- Auto-grow: the cap at `mmgr-ai.js:2842` (`Math.min(q.scrollHeight, 120)`) becomes 160 (about 6 lines). Keep the `at-cap` toggle.
- Send is always the right-most item inside the window: `right <= win.right - 8` at every width.

**Step 5 - empty state and quick presets.**
`#ai-welcome` (project.html 1561) is today an assistant bubble with a tip line. Replace its contents with a centred mark, the text "What are we working on?", and four full-width rows (radius `var(--radius-control)`) generated from the same four presets that fill `#ai-quick-presets` (Report Writing, Forecasting, Risk Analysis, Weekly Digest; **read the real list from the code in `open()` and use that, do not retype it**). Clicking a row does exactly what the matching chip does today. Once the first message exists, the welcome block and the chip strip disappear; the Presets tab stays. `.ai-quick-presets` gets `scrollbar-width: none` and an edge fade mask while it still exists. `qa-ai-polish.cjs` and `qa-ai-visual.cjs` (both TRIAGE) reference `ai-welcome`; update their assertions, do not promote them.

**Step 6 - "What the assistant can see".**
The existing `<details class="ai-adv">` stays but is restyled as a single collapsed line under the composer (chevron, no border box). Contents unchanged.

**Step 7 - thread and responsive tiers.**
Add `container: aiwin / inline-size;` to `.ai-main` (`css/mmgr.css:12586`). Tiers are measured on `.ai-main`'s own inline size, nothing else:

| `.ai-main` width | Name | Rules |
|---|---|---|
| under 440 px | compact | bot bubble full width, thread side padding 12 px |
| 440 to 599 px | regular | bubbles `max-width: min(100%, 760px)` |
| 600 px and up | wide | thread column `max-width: 760px`, centred; composer card the same width, centred |

Derived window widths: with the 176 px history column inline, `.ai-main` is window minus 176. Keep the existing `.ai-thread { padding-inline: clamp(14px, 5%, 40px) }`.

### 5.3 Pitfalls the gate must catch
1. `container-type: inline-size` applies **layout containment**, so it makes `.ai-main` the containing block for any `position: fixed` descendant (the D-3 bug class). Nothing inside `.ai-main` may be `position: fixed`. The More menu and the `#ai-byo-pop` popover must be `absolute`. `tools/qa-fixed-containment.cjs` from D-3 is the permanent check; open the More menu and the key popover inside it.
2. Keep gold usage inside the existing rule: only recolour what is already gold; no gold tint on plain light surfaces (`verify:gold` must pass).
3. No em dash or en dash in any new string.

### 5.4 Gate: new `tools/qa-ai-window-layout.cjs` (three edits; `browser-app` CI group) and updated `qa-ai-win.cjs`
Use the boot seam from `qa-ai-win.cjs`. Test matrix (window width is set by the real mechanism, not by CSS overrides):

| Mode | How to reach it | Window widths |
|---|---|---|
| Sheet | viewport width = window width | 360, 420, 480 |
| Docked | viewport 1440, set `localStorage mmgr_ai_size` then reopen | 480, 520, 658, 900 |
| Max | `#ai-max-btn` at viewport 1900 | full |

At **each** width, in light and dark:
1. `#ai-win` has no horizontal overflow (`scrollWidth <= clientWidth`).
2. `.ai-head` height <= 56 px and it is one row (all five buttons share the same `top` within 1 px).
3. `#ai-q` width >= 80 percent of the composer card width; `#ai-send` right edge <= window right edge minus 8.
4. No element inside `#ai-win` has a computed border radius >= 99 px (excluding avatar circles: allowlist `.ai-bot-avatar` and the status dot by class).
5. `hist-inline` is true only when the window is >= 720 px (given Q2 default).
6. Header buttons all have an accessible name; Tab order is header, thread, composer; More menu opens, Esc closes it and focus returns to `#ai-more-btn`.
7. Welcome block present with four rows when the thread is empty, absent after one message.
8. Save six screenshots (360, 420, 480, 520, 900, 1400, light and dark) into `tmp/ai-layout/` and attach the paths to the log entry. Do not commit them.
Existing gates stay green: `qa-ai-win` (22 checks, now with the re-baselined history check), `qa-ai`, `qa-ai-relay`, `qa-ai-badge-e2e`, `qa-a11y-axe` (axe must stay at zero serious or critical in both palettes), `verify:gold`, `tools/audit-action-map.cjs` and the data-action contract gate (CI step "F2"), `verify:a11y`.
Update `docs/CI-TEST-COVERAGE.md` rows for `qa-ai-win` (new history check), the new harnesses, and update `mymanager-field-guide.html` text that describes the removed pills or the old header (grep for `AI Assistant`, `Pin`, `Float`, `engine`).

**Done when:** all steps committed separately (`feat(ai): ...` per step, `fix` where it is a fix), `npm run verify` green, CI green, screenshots listed in the log.

---

## 6. D-4 - CI from about 25 minutes to about 6-8

Run this **after** D-3, D-2 and D-1, because their three new harnesses (`qa-fixed-containment`, `qa-ai-dictation`, `qa-ai-window-layout`) must be placed by the split, not added to it afterwards.

### D4.0 Measure first (no YAML edits yet)
Using the Actions API pattern from `AGENTS.md` section 8, fetch the latest green run on `main`, then `/runs/{id}/jobs` and record every step name with `started_at`, `completed_at`. Write a table to `tmp/ci-baseline.md` (step, seconds, tier). v1's timings came from another reviewer's run on the same commit and were never re-measured. Expect roughly: static and T1 about 1 min, shared-wrangler T2 block about 10 min (Team RBAC about 255 s), T4 about 10 min. **If your measurements differ by more than 25 percent from this, rebuild the plan from your numbers and say so in the log.** The only budget that matters is: the longest job after the split.

### D4.1 What does not matter
Caching, `npm ci` and the Gitleaks step are worth about 10 s in total (`npm install` is about 3 s, checkout 3 s, Chrome is preinstalled). Do not make them a task. If it is trivial, switch `npm install --ignore-scripts --no-audit --no-fund` to `npm ci --ignore-scripts --no-audit --no-fund` inside the new setup block; otherwise leave it.

### D4.2 Split into five parallel jobs
Jobs have separate network namespaces, so ports 8787, 8765 and 9228 cannot clash between jobs. Each job repeats checkout, `setup-node@v4` (node 22), `npm install`, and the build (`npm run build`) it needs (about 10 s).

| Job | Contents |
|---|---|
| `static` | steps 3-48 of today's list: Gitleaks, build, every static and T1 gate, `Chrome available`, units, export reconciliation, currency honesty, print DOM, weak random, doc size, wrangler dry-run |
| `cloud-core` | `T2: Start wrangler dev`, then `Cloud phase 1`, `Cloud phase 2` (**coupled: phase 2 depends on phase 1's project, keep order and keep them together**), `Cloud photos`, `Cloud codes + delete`, `Billing cancel contract`, `Cloud import`, `Page health sweep`, `AI badge E2E`, `Market features`, then `Stop wrangler dev` |
| `cloud-auth` | everything else on the T2 side: `Email auth`, `Team RBAC`, `Team UI`, `Team Enterprise`, `Reviews`, `Calc workspace route`, `Rate book is signed-in data`, `Rank 9 API`, `T9 adoption`, `Presence`, `Prefs roundtrip`, `Offline copies`, `Cloud autosave + signin`, then the **restart step and `Controls admin`**, then the three self-contained suites (`Client codes E2E`, `Project API keys E2E`, `Sync bond E2E`) |
| `browser-calc` | `Install test deps`, `qa-calculator-page`, `qa-calc-playwright-audit`, `qa-calc-trade-coverage`, `qa-calc-golden`, `qa-calc-assistant`, `qa-mat-items`, `qa-related-items`, `qa-relations`, `qa-calc-controls`, `Calc S2 gate`, plus `qa-fixed-containment`; it starts and stops its own `serve.cjs` |
| `browser-app` | `qa-full`, `Drive token state`, `Paddle checkout CSP`, `Auth limits`, `qa-ai`, `qa-ai-win`, `qa-v11`, `qa-p1`, `verify-theme-cdp`, `qa-modals`, `verify-gold`, `qa-appshell`, `qa-notice-watchers`, `qa-dot-rail`, `qa-globe-spin`, `qa-code-names`, `qa-procurement`, `qa-consent`, `qa-shortcuts`, `qa-widescreen`, `qa-a11y-axe`, `qa-hero-globe`, plus the new `qa-ai-dictation` and `qa-ai-window-layout`; it starts and stops its own `serve.cjs` |

Constraints that decide the cut (verify each in code before you move a step):
- **Classify every T2 step mechanically.** For each, grep its harness and its `env:` block for `8787`, `WRANGLER_DEV_URL`, `QA_BASE` and for a `spawn` of wrangler. Steps that need the shared :8787 wrangler stay in the job that starts it (`cloud-core`, and `Controls admin` after its restart). Steps that spawn their own wrangler on a unique port (`Team RBAC` 8812, `Team UI` 8813 and CDP 9246, `Client codes` 8808, `API keys` 8809, `Sync bond` 8810) can sit in any job. Today's `if: success() && steps.wrangler-start.outcome == 'success'` on those is only a proxy for "environment is up"; in a job with no shared wrangler it must be removed or the step silently skips while the job stays green.
- **Restart boundary.** `T2: Wrangler restart for controls admin` wipes `/tmp/mmgr-wrangler-state` and re-applies migrations. `Controls admin` must therefore run in a job whose wrangler it owns (put the restart and `Controls admin` in `cloud-auth` with its own `Start wrangler dev` at the top of that job, or give `Controls admin` its own start step). Do not cut by file list.
- Put `Team RBAC` (about 255 s, the single longest step) in the lightest job and re-balance by your D4.0 numbers.
- The rate limiter keys by client address; commit `ce39be8` already gives each T2 suite its own address. Keep the `X-Forwarded-For` or equivalent env those steps already set when you move them.
- `.dev.vars` is written by the wrangler start step (`ADMIN_CODE=QA-ADMIN-CI`); every job that starts wrangler must write it.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` env stay on the steps that have them today.

### D4.3 The mechanical proof (required, do not skip)
Create `tools/verify-ci-coverage.cjs` (three edits; status **CI**, in the `static` job). It parses `git show <base-commit>:.github/workflows/ci.yml` and the new workflow with a YAML parser available in `node_modules` (add `yaml` as a devDependency only if none is present), and asserts:
1. The **multiset of `run:` command strings** across all steps of all jobs equals the multiset in the old workflow, after removing only the setup lines you added per job. The script prints any difference and exits 1.
2. Every `if:` that references `steps.<id>.outcome` points to an `id` defined **in the same job**.
3. No step has an `if:` referencing a step id that does not exist in its job.
4. The step names `T4: ...` (36 of them) all still exist.
Then on the **live run**: open the Actions UI or API and confirm all 36 `T4:` steps executed, zero skipped, and the sum of executed `run:` steps equals the baseline from D4.0.
The registry gate `verify-test-registry.cjs` does not know which job runs a harness, so it cannot catch a dropped step. This script does.

### D4.4 CI Summary
The current summary (lines 827-871, about 45 rows) lists only some steps, repeats "CSS integrity" and "Page health sweep" twice, and reads `steps.<id>.outcome` across tiers. After the split those references are empty. Replace it with a final job `summary` that has `needs: [static, cloud-core, cloud-auth, browser-calc, browser-app]`, `if: always()`, and writes one row per job from `needs.<job>.result`, plus each job writes its own step table to `$GITHUB_STEP_SUMMARY` (so per-step outcomes are still visible). Mark `summary` as the only required check if branch protection is ever enabled.

### D4.5 Triggers and branch (decision Q1)
`ci.yml` fires only on `main` pushes and PRs to `main`; a new branch alone produces no run. Default route: work on branch `ci-split`; in the **first commit on that branch** widen `on.push.branches` to `[main, ci-split]`; iterate until green; before merging, remove `ci-split` from the trigger in a final commit; then fast-forward `main`. Do not force-push. `concurrency` is per ref, so `main` runs are unaffected. Budget two CI cycles (about 25 minutes, then the trimmed one). A side benefit to record: today one red step hides every later step (`AGENTS.md` section 8 item 1); parallel jobs surface independent failures in one run.

### D4.6 Other workflows
`extended-qa.yml` and `nightly.yml` do not depend on `ci.yml` job names (no `needs:`, no `workflow_run`). Confirm with `grep -n "needs:\|workflow_run" .github/workflows/*.yml` and change nothing there.

### D4.7 Done means
`verify-ci-coverage` passes; the live run shows all steps executed and none skipped; wall-clock of the slowest job is at most 8 minutes (report baseline versus new in `docs/history/log-2026-10.md` as a table; do not promise "8 flat" if your measurement says otherwise); `summary` populated; registry gate green; `AGENTS.md` section 8 and `docs/CI-TEST-COVERAGE.md` "Tiers inside ci.yml" updated to describe five jobs (keep `AGENTS.md` and `CONTINUATION-DIRECTIVE.md` under 40,960 bytes: gate T8).

---

## 7. Order, logging, exit

1. D-3 (one commit) then D-2 (one commit), each with its tests and a green CI run.
2. D-1 steps 1 to 7, one commit each, CI green after step 4 and at the end.
3. D-4 on `ci-split`, then merge.
4. At the end: add a STATUS LOG entry (one line) to `CONTINUATION-DIRECTIVE.md` and the full entry to `docs/history/log-2026-10.md`; rewrite `reflection.txt` (specific: files, lines, gate results); keep `CONTINUATION-DIRECTIVE.md` under 40,960 bytes.
5. Report back with: commit list, gate results per task, the baseline-versus-new CI table, and any place where this directive did not match the code (report, do not guess).

**Continue without pausing** between tasks as long as each task's gate is green. Stop only when a gate is red and the fix would change something on the must-not-change list.

---

## 8. Questions for the owner (ask once, defaults apply if unanswered)

| # | Question | Default |
|---|---|---|
| Q1 | CI: use branch `ci-split` with a temporary trigger, or a draft PR to `main`? May the agent push to `main` for D-3, D-2 and D-1? | Branch `ci-split` with temporary trigger for D-4; direct pushes to `main` allowed for D-3, D-2, D-1 (one branch, one agent, as `EXECUTION-PLAN.md` describes) |
| Q2 | AI window: raise the inline history threshold from 480 to 720 px, so at the 520 px default the chat list is a slide-over? | Yes, and re-baseline the one `qa-ai-win` check |
| Q3 | AI window header: move Pin and Float into a More menu and replace the two status pills with one status dot? | Yes, ids kept, engine text moves into the menu |
| Q4 | Dictation: keep the browser speech engine, or route this mic through the offline Whisper tier? | Keep the browser engine (instant; Chrome needs a connection) |
| Q5 | Optional enhancement for the dropdown: top-layer popover plus CSS anchor positioning behind `@supports`? | No, portal and JS tracking only |

---

## 9. Copy-paste handoff prompt

> Implement `UI-CI-DIRECTIVE.md` (v2) for this repository. Read `CLAUDE.md`, `CONTINUATION-DIRECTIVE.md`, `AUDIT-DIRECTIVE-2026-10-18.md`, `AGENTS.md`, then load the skills they map. First send the owner the five questions in section 8 in one message, then continue at once with D-3 and D-2 using the stated defaults for anything unanswered. Order: D-3, D-2, D-1 (steps 1 to 7), then D-4 on branch `ci-split`. Anchors are exact at `9d703e0`; if `HEAD` differs, re-derive by selector and log the drift. Use `git add` with explicit paths only and never stage `.githooks/pre-commit`, `AUTHORS-FIX-ISSUE.md` or the folder `the last update towrads maintainance mode/`. No AI attribution in commits, no history rewrite, no force push, no `reset --hard`. After every task run the build ritual in section 2 and the task's gate, then poll the Actions run until it completes. For D-4 measure first (D4.0), split into the five jobs, and pass the `run:`-multiset proof in `tools/verify-ci-coverage.cjs`. Every new harness gets three edits: file, registry row, CI step. If anything in this directive does not match the code, report it instead of guessing.
