---
name: skeptical-code-audit
description: Systematic, skeptical methodology for auditing a codebase for broken wiring — mismatched CSS classes toggled by JS, data-action/event handlers with no matching map entry, DOM ids referenced in JS but missing from HTML, dead code paths, and features that silently no-op instead of crashing. Use this whenever the user asks to "audit", "check for bugs", "verify everything works", "find what's broken", "double check the code", or asks you to confirm a codebase is consistent/complete before shipping — even if they don't name a specific bug. Especially useful for multi-file HTML/CSS/JS or template-based web apps where JS and markup can drift out of sync silently. Push yourself to use this any time you're about to claim "everything checks out" based on a single grep or regex pass — don't trust first-pass tooling output.
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
7. Report using the structure above
