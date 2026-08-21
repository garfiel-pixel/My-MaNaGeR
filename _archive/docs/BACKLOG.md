# My MaNaGeR — Backlog & Open Items

Tracking file for small backlog items and open investigations that came out of
spec executions. Nothing here is pre-approved to execute — each item needs the
project owner's explicit go-ahead before any file is touched.

---

## B-N — RESTORE-3 AI-upgrade path: richer email templates via the preset system

- **Source:** MONOLITH-FEATURE-PARITY-DIRECTIVES.json RESTORE-3 execution
  (project-owner design decision, 2026-08-08).
- **Context:** RESTORE-3 restored the monolith's ORIGINAL static, zero-AI
  email templates (`App.emailTpl(kind)` — Status Update / Change Request /
  Risk Escalation / Closure Sign-Off, copied from live state). The owner
  explicitly chose: static baseline FIRST as the guaranteed fallback, with
  the AI-upgrade path kept OPEN as a separate, explicitly-tracked item — NOT
  folded into the restoration.
- **Proposed (future, needs go-ahead):** add an `email`-family preset to
  js/mmgr-prompts.js (and the mmgr-ai.js preset list) that generates richer
  versions of the same templates through the AI window — as a genuine
  upgrade layered ON TOP of `emailTpl`, never a replacement. The static copy
  must keep working with no model configured.
- **Status:** IMPLEMENTED (owner go-ahead, 2026-08-12). New `email`
  preset ('Stakeholder Email') in js/mmgr-prompts.js (grounded, zero-fabrication
  prompt) + js/mmgr-ai.js (`PRESET_LABELS` + `LOCAL_BUILDERS.email`), with
  js/mmgr-app.js `emailTplText(kind)` extracted as a pure getter so the LOCAL
  tier returns the static template verbatim — the static `emailTpl` buttons
  are unchanged and keep working with no model configured. Cloud tier drafts
  the richer AI-polished version on top. Verified: node --check clean, qa-ai
  gates green (incl. A17 chip count), npm run verify green.

---

## B-1 — Admin gate box (.gbox) missing the reduced-transparency / no-backdrop-filter fallback

- **Source:** LIQUID-GLASS-UI-FIX-DIRECTIVES FIX-3 execution review.
- **Context:** FIX-3 gave `.gbox` (admin.html setup/login gate screens) the modal
  glass material. The `@supports not (backdrop-filter:blur(1px))` and
  `@media (prefers-reduced-transparency:reduce)` fallback blocks in css/mmgr.css
  flatten `.mb` / `.glass-surface` / `.pcard` / etc. to solid `var(--card)`, but
  `.gbox` is not in those selector lists. On a browser without backdrop-filter,
  or with reduced transparency enabled, dark mode leaves `.gbox` as a translucent
  white haze (`rgba(255,255,255,.12)`) instead of a solid surface.
- **Proposed fix (one line each):** add `.gbox` to both existing selector lists
  in css/mmgr.css — reuse the existing fallback, don't write a new rule.
  Deliberately NOT folded into FIX-3 (that spec was scoped to background/color
  fixes; this is a transparency/a11y item).
- **Status:** APPLIED (owner go-ahead, 2026-08-08). `.gbox` added to both existing fallback selector lists in css/mmgr.css, PLUS a scoped `@supports`/`prefers-reduced-transparency` override in admin.html (the page's inline `.gbox` rule would otherwise beat the shared block at equal specificity). Verified via headless Chrome with reduced-transparency emulation.

---

## B-2 — project.html CSP: inline deploy-guard / SW script silently blocked (hash missing from meta)

- **Source:** LIQUID-GLASS-UI-FIX execution follow-up investigation (owner asked
  for specifics before deciding).
- **Context:** project.html's Content-Security-Policy meta allows external scripts
  only; the single inline script (line 1100 — icon-sprite deploy guard +
  service-worker registration) is blocked. Investigation results:
  - The blocked script is exactly the line-1100 inline block, verified via a
    `securitypolicyviolation` probe (`sourceFile: project.html, line 1100, col 0`).
  - The hash Chrome suggested in the violation message
    (`sha256-o+0No2XpbES4E5QJh31mY9JsJFqSmE+B4x+z1fNPjVc=`) **exactly matches**
    the raw bytes of that script — the hash is correct, it's just **absent from
    the meta tag's script-src**. A headless-Chrome test confirmed that exact hash
    value allows the script to execute.
  - Impact: NOT load-bearing for core app function (qa-full.cjs 167/167 passes
    with it blocked), but it **silently disables the PWA service-worker
    registration on project.html** — the manifest `start_url` — regressing
    Rank 4 offline-first shell caching on the app's entry page.
- **Proposed fix (one line):** add `'sha256-o+0No2XpbES4E5QJh31mY9JsJFqSmE+B4x+z1fNPjVc='`
  to `script-src` in project.html's CSP meta. Keeps the policy strict (no
  `unsafe-inline`) and restores SW registration + the deploy guard.
- **Status:** APPLIED (owner go-ahead, 2026-08-08). Hash added to `script-src` in project.html's CSP meta; verified no further CSP violations.

---

## Resolved / closed

- **favicon.ico 404** — closed by the icon work (rel=icon links now on app.html,
  project.html, admin.html; browsers stop requesting `/favicon.ico` when a link
  icon is present).
