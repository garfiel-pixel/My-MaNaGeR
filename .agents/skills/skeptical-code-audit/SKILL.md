---
name: skeptical-code-audit
description: >-
  Systematic, skeptical methodology for auditing a codebase for broken wiring —
  mismatched CSS classes toggled by JS, data-action/event handlers with no matching
  map entry, DOM ids referenced in JS but missing from HTML, dead code paths,
  features that silently no-op instead of crashing, and test harnesses that
  silently drift from an app contract (storage key/type, DOM id, selector,
  action name). Use this whenever the user asks
  to "audit", "check for bugs", "verify everything works", "find what's broken",
  "double check the code", or asks you to confirm a codebase is consistent/complete
  before shipping — even if they don't name a specific bug. Especially useful for
  multi-file HTML/CSS/JS or template-based web apps where JS and markup can drift out
  of sync silently. Push yourself to use this any time you're about to claim
  "everything checks out" based on a single grep or regex pass — don't trust
  first-pass tooling output.
---

# Skeptical Code Audit

A methodology for auditing a codebase for silent breakage: places where JS, CSS, and HTML have drifted out of sync in ways that don't throw errors, just quietly fail to work. The defining trait of this skill is **not trusting your own first answer** — every automated check gets a manual spot-check before being reported as a finding.

## Core principle: distrust your own tooling

The single most important habit here: when a grep/regex/awk pass returns a suspicious result (way too many "missing" items, or zero matches when you expected some), **do not report it as a finding**. Treat a surprising result as a signal your extraction logic is wrong, not that the codebase is that broken. Re-verify by:
1. Viewing the raw source directly (the actual object literal, the actual DOM) instead of trusting the parsed/grepped version
2. Redoing the diff with corrected logic
3. Only then reporting real findings

This happened repeatedly in the reference session: a first regex pass claimed 68 missing action handlers and separately 0 matching admin actions — both wrong, both artifacts of bad parsing. Viewing the raw `ACTION_MAP` object directly and rechecking found the real number: 0 actually missing, 100% wired correctly. If the first pass had been trusted, it would have reported a false bug.

Likewise, don't assume a null match is a false positive OR a real bug — check each one. In the session, some `getElementById`-style hits were dynamic prefix concatenations (`'kc-' + i`) that are correct-but-invisible-to-static-grep; others were genuinely missing DOM elements referenced by wrapped helpers (`setVal()` wrapping `$()`), which regex missed on the first pass until the search was broadened to catch wrapper functions too.

## Project-Specific Architecture (My MaNaGeR)

This codebase has specific patterns that affect auditing:

### Module extraction pattern
Many functions were extracted from monolith files (mmgr-app.js, mmgr-render.js, mmgr-cloud.js) into sub-modules (js/app/*.js, js/render/*.js, js/cloud/*.js). The monolith keeps a **one-line delegation shim** that forwards to the extracted module. The delegation gate (tools/verify-delegate-gate.cjs) catches functions where the monolith still has a full body instead of a shim. When auditing, check both the shim AND the extracted module — the shim must be ≤3 lines and call ns.X.Y(); the extracted module must have the real implementation.

### ACTION_MAP pattern
Event handling uses a global ACTION_MAP object in mmgr-app.js. Every `data-action="X"` in HTML must have `'X': () => ...` in ACTION_MAP. The admin panel (admin.html) has its own ADMIN_ACTION_MAP. Action maps are per-page — project.html actions are in mmgr-app.js, admin.html actions are in the inline <script> block.

### MODULE_UPDATERS pattern
After every save, MODULE_UPDATERS maps state keys to their render functions. If a new feature adds a state key (e.g. `state.procurement`), it needs both a FIELD_KEYS entry AND a MODULE_UPDATERS entry, otherwise the feature's UI won't refresh after save.

### CSP hash synchronization
Inline <script> blocks in project.html, app.html, and admin.html have SHA-256 hashes in worker.js AND serve.cjs. Editing any inline script requires regenerating BOTH the worker.js and serve.cjs hash arrays. Stale hashes silently break pages (content security policy blocks the script).

### State key registration
New features must register their state key in FIELD_KEYS (mmgr-state.js). Without this, the key won't survive save/restore/merge cycles and will be silently lost.

### Render shim pattern
Render functions extracted to js/render/*.js are accessed via mmgr-render.js shims. The shims must be called from renderDash()/renderAll() or the relevant render function, otherwise the feature's UI never initializes.

### Test-harness ↔ app contract drift
Harnesses seed state and assert on app contracts: storage keys AND storage type (localStorage vs sessionStorage), DOM ids/classes, `data-action` names, selectors, API field names. When a contract moves, every harness that seeds or asserts the OLD contract now exercises a DIFFERENT branch than the one you changed — usually the empty/fallback branch — while its own gates can still report green on everything unrelated. The feature assertions silently stop testing the feature.

Reference case (nightly T3, 2026-11-12): the I-1 fix moved the owner code from `sessionStorage` to `localStorage` in `getCode()` (`js/mmgr-cloud.js`), but `tools/qa-mcp-live-e2e.cjs` B2 still seeded `sessionStorage`. `Cloud.render()` read no code, took the no-code create/link branch that never creates `#cloud-review-list`, and B2/B3/B4/B5/C1/C2 failed in a cascade. The API phase (A1–A7) stayed green because it used the server credential directly; `npm run verify` stayed green because it does not run browser harnesses.

Prevention rule: **after changing a contract, grep the harness tree for the OLD contract before calling the change done**, then run the affected harness end-to-end:

```bash
# old storage key/type, old selector, old action name — one grep per contract
grep -rn "sessionStorage.*mmgr_cloud_code\|mmgr_cloud_code" tools/ qa-*.cjs
grep -rn "cloud-review-list" tools/ qa-*.cjs
node tools/qa-mcp-live-e2e.cjs   # the harness itself, not just npm run verify
```

Re-baseline the harness to the NEW contract. Never delete or weaken the assertion to make it pass: the assertion encodes the user-facing contract (here, Accept applies the change; a zero-diff accept warns "nothing left to apply").

## Audit checklist

Run these checks systematically across every relevant file, not just the one currently open. Adapt names/patterns to the actual codebase.

1. **CSS class toggle consistency** — For every class a JS file adds/removes/toggles on an element (`.classList.add/remove/toggle`, `className =`), confirm that class has a real CSS rule that actually governs the relevant behavior (e.g. visibility) in the stylesheet(s) that apply to that page. Watch for cases where two different toggle conventions coexist in the same codebase (e.g. one module uses `.show`, another consistently uses `.open`) — that's not automatically a bug, but any *mismatch within one component* is.

2. **Action/event handler map completeness** — For every `data-action="X"` (or equivalent dispatch attribute) used in markup, confirm a matching entry exists in the JS action map that handles clicks/events for that page. Do this **per page/file** if action maps are page-scoped, not globally — a handler in one page's map doesn't cover another page's markup.

3. **DOM id reference completeness** — For every `getElementById`/`querySelector('#id')`/`$('#id')`-style call (including wrapped helper functions like a local `setVal()` or `$()` shim — grep for the wrapper's own definition first, then treat calls to it the same as direct DOM lookups), confirm that id exists in the DOM of every page that JS file runs on. Exclude:
   - Dynamically constructed ids (`'prefix-' + i`) — these are correct, just invisible to static search
   - `classList` calls that happen to look like id lookups in a naive regex

4. **Icon/asset reference completeness** — For every icon id or asset reference used in markup (e.g. `#i-xxx` sprite refs), confirm it's defined in the sprite/asset file.

5. **Script load order** — Confirm script tags load in the order their inter-dependencies require (e.g. a render module that calls a util function must load after that util).

6. **Silent no-op detection (the highest-value check)** — This is the one that finds real, user-facing bugs the others miss. For any DOM lookup that resolves to `null`/`undefined` and is guarded by a null-check before use (so it doesn't crash), don't just mark it "safe" — trace *why* it's null. If the JS logic around it is fully implemented (computes a value, formats it, decides styling) but the corresponding HTML element was simply never added, that's not a non-issue — it's a **missing feature that fails silently**. Users see nothing where they should see something, and no error ever surfaces. Find the intended location in the markup (usually near a related, already-wired sibling element) and add the missing markup, styled to match the existing surrounding component/theme.

7. **Rendering method mismatches** — For any place a JS string is assigned into the DOM, confirm `textContent` vs `innerHTML` matches intent. A raw HTML string (e.g. `'<span style="color:red">X</span>'`) assigned via `textContent` will literally print the tags on-screen instead of rendering styled content — this is a real, easy-to-miss bug. Prefer fixing via a CSS class toggle over switching to `innerHTML` when the string is otherwise static/hardcoded, to avoid introducing an injection surface unnecessarily; only use `innerHTML` if the content is truly static and a class-based approach isn't feasible.

8. **Run the existing test suite** — If the project has any automated tests (headless test runners, etc.), run them after making fixes to confirm nothing else broke and to catch anything the manual checklist missed. If a test happens to already cover one of the above (e.g. an existing "action coverage" test scenario), note that as extra confirmation rather than redundant.

9. **Non-source-file sanity check** — If auditing a zip/upload, check for accidental inclusion of local tool state that shouldn't ship (FTP client caches, `.git`, credentials, OS metadata like `.DS_Store`). Flag and exclude these from any deliverable; call out explicitly if anything looks like it could contain cached credentials.

10. **Test-harness contract consistency** — After any change to a contract a harness depends on (storage key or storage type, DOM id/class, `data-action` name, API field, selector), grep every `qa-*.cjs` / `verify-*.cjs` / `audit-*.cjs` for the OLD contract and re-baseline each hit. A harness that seeds the old contract silently exercises the fallback branch: its own gates can still pass while the feature assertions no longer run. `npm run verify` does NOT run browser harnesses — run the affected harness itself and keep its assertions intact.

11. **Browser-harness geometry, gate syntax and split names** — Four failure classes that each cost the 2026-11-12 wave a CI cycle:
    - A visibility check must first scroll ITS container into view. Reveal animations only fire at a visibility threshold; a harness parked on a neighbouring section can leave a card at opacity 0 forever and call it a hole.
    - A Playwright click near a viewport edge can be intercepted by a fixed bar, nudge or toast. Dismiss the overlay at load and centre the target before clicking; never `force: true` past a real overlay.
    - Static gates that strip HTML for scanning must not one-pass `replace()` multi-character sequences: CodeQL's "incomplete multi-character sanitization" gate fails the PR. Use a regex-free indexOf helper (`tools/lib/html-strip.cjs`) that also handles spaced end tags such as `</script >`.
    - A split module's private function must not reuse a monolith function name (`init` collided with the app boot); the delegate gate matches by name only.

12. **A seeded fixture has a shelf life** — `demo-data.js` is written into `localStorage` on every launcher visit, so its dates are served copy, not internal test data. Judge it against its own `updatedAt` ("as of" clock), never the wall clock, or the gate itself rots: `node tools/verify-demo-dates.cjs` fails when an open task ends before that clock, a 0% task's start has elapsed, `duration` disagrees with the working-day span, or the process model would silently rewrite a record on load (approved change without a title, resolved issue without a resolution). Re-baseline with an explicit per-task date table, not a blind offset: a uniform shift preserves the original overdue band and can leave 0% work inside an elapsed window.

## Reporting findings

Structure the final report as:
- **Confirmed bugs found and fixed** — one paragraph each: what was wrong, why it mattered (what the user would actually have seen/not seen), what the fix was
- **Checked and confirmed clean** — the categories from the checklist that came back clean, stated plainly (don't pad this with hedging — if it's verified clean via the raw-source re-check, say so with confidence)
- Be explicit when a first-pass tool result was wrong and you caught it — this builds trust that the final numbers are real, not just optimistic

Don't report a "finding" that turned out to be a false positive after the manual re-check — just quietly don't mention it, or mention it only in service of explaining why a category is "confirmed clean" (e.g. "some flagged ids were dynamic-prefix false positives, not real gaps").

## Workflow

1. Inventory files and their cross-references (what scripts/css does each page load, what other files does each JS module get called from)
2. Run each checklist item above per relevant file/page (not globally, unless the map/scope is genuinely global)
3. For any surprising result (many more or fewer matches than expected), stop and re-verify against raw source before treating it as real
4. Fix confirmed bugs, matching existing code style/theme
5. Re-run the affected checks to confirm the fix resolved them and didn't break anything else
6. Run the project's existing automated tests if present
7. If the fix changed an app contract (storage key/type, DOM id, selector, action name), grep the harness tree for the old contract, re-baseline every hit, and run the affected harness end-to-end
8. Report using the structure above

## Quick Audit Commands for This Project

```bash
# Syntax check all JS files
find js/ src/ -name '*.js' | xargs -I{} node --check {}

# Check ACTION_MAP completeness
node -e "const fs=require('fs');const app=fs.readFileSync('js/mmgr-app.js','utf8');const map=app.match(/ACTION_MAP[^{]*\{([^}]+)\}/s)?.[1]||'';const html=fs.readFileSync('project.html','utf8');const actions=[...html.matchAll(/data-action=\"([^\"]+)\"/g)].map(m=>m[1]);const missing=actions.filter(a=>!map.includes(a));console.log('Missing:',missing.length,missing)"

# Check FIELD_KEYS registration
node -e "const fs=require('fs');const state=fs.readFileSync('js/mmgr-state.js','utf8');const keys=state.match(/FIELD_KEYS[^{]*\{([^}]+)\}/s)?.[1]||'';console.log('Keys:',keys.split(',').length)"

# Run verification suite
npm run verify
npm run qa:market-features
npm run qa:dashboard-spec
```
