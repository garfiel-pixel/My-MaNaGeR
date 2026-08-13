# Claude Bug Audit — 2026-08-11

Source: Systematic pass by Claude on the full Cloudflare Workers / GitHub build of My MaNaGeR (garfiel-pixel/My-MaNaGeR).  
Local working copy at the time of this note: `mymanager-fixed - Copy` (partial snapshot). Authoritative source of truth remains the GitHub repo.

---

## Summary

| # | Severity | Bug | Status |
|---|----------|-----|--------|
| 1 | Functional | `syncClientId` text field never saves | Confirmed – needs fix |
| 2 | UX / Cosmetic | Wrong-access-code modal never shakes (`.shake` missing) | Confirmed – needs fix |
| 3 | Cosmetic | `#i-plus` icon missing from sprite | Confirmed – needs fix |
| 4 | Cosmetic | `#i-shield` icon missing from sprite | Confirmed – needs fix |

All other categories Claude checked (script load order, data-action → handler wiring, CSP hashes, SW cache, class-toggle consistency, DOM id completeness, textContent vs innerHTML) came back clean.

---

## Bug 1 — Google OAuth Client ID field silently never saves (Functional)

**Location**
- Input: Sync/Controls drawer (`js/mmgr-sync.js`)
- Field: `<input type="text" id="sync-client-id" … data-action="syncClientId">`
- Intended handler: `MMGR.Sync.setClientId()` → `localStorage.setItem('mmgr_sync_clientid', …)`

**Root cause**
- Document-level click handler deliberately skips text inputs.
- `change` listener only fires `ACTION_MAP` handlers for a hard-coded whitelist of ~24 action names — `syncClientId` is **not** in it.
- `input` listener has its own ~18-name whitelist — `syncClientId` is also absent.
- No direct (non-delegated) listener is bound to `#sync-client-id`.

**Effect**
User can type a Client ID; the value sits in the box (native browser behaviour) but is never persisted. Reload → field is empty. Silent failure — no console error, no visual feedback.

**Recommended fix**
Add `'syncClientId'` to the **change** whitelist in `js/mmgr-app.js` (around the existing whitelist near line ~2198 in the audited build).  
`change` is the correct event for a one-time paste/type-then-blur field.

---

## Bug 2 — Wrong-access-code modal never shakes (UX)

**Location**
- Trigger in `app.html` (and possibly related unlock flows):
  ```js
  mb.classList.remove('shake'); void mb.offsetWidth; mb.classList.add('shake');
  ```
- The reflow trick is correct; the CSS class is missing.

**Root cause**
No `.shake` rule (or `@keyframes shake`) exists in:
- `css/mmgr.css`
- `css/marketing.css`
- any inline `<style>`
- the old monolith reference file

**Effect**
User sees the “Incorrect code” text change, but the modal never animates. The intended visceral feedback is silently absent.

**Recommended fix**
Add a short keyframe animation + `.shake` class to `css/mmgr.css`, following the existing animation conventions already used for `.mb` / `#ai-win.open .mb`.

Example pattern (to be refined during implementation):
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}
.shake {
  animation: shake 0.4s ease-in-out;
}
```

---

## Bug 3 — `#i-plus` icon missing from sprite (Cosmetic)

**Location**
- `js/mmgr-cloud.js` — “Create Editor Code” button uses `<use href="#i-plus">` (or equivalent).

**Root cause**
The sprite (`css/mmgr-icons.svg`) defines 62 symbols. `#i-plus` is not among them.

**Effect**
Button still works and shows its text label; the icon glyph is an empty invisible box.  
Note: `admin.html` already has a deploy-time guard that warns if the **entire** sprite file 404s, but it does not catch missing symbols inside a present file.

**Recommended fix**
Add a simple plus symbol to `css/mmgr-icons.svg` (standard 24×24 stroke icon matching the existing set).

---

## Bug 4 — `#i-shield` icon missing from sprite (Cosmetic)

**Location**
- `project.html` — “Claim Pack Prompt” button uses `#i-shield`.

**Root cause**
Same as Bug 3 — symbol does not exist in the sprite.

**Recommended fix**
Add a shield symbol to `css/mmgr-icons.svg`.

---

## What Claude verified as clean

- Script load order on all 5 core pages (project.html, admin.html, app.html, dashboard.html, index.html) — zero reference errors.
- 202 keys in `ACTION_MAP` + 231 distinct `data-action` values across pages — every one resolves to a real handler (orphans were false positives from page-local dispatchers).
- Existing offline tooling: `verify-csp-hashes.cjs`, `verify-sw-cache.cjs`, `verify-skills-lock.cjs` — all pass.
- admin.html `ADMIN_ACTION_MAP` (30 actions) and app.html `DASH_ACTION_MAP` (4 actions) — fully wired.
- CSS class-toggle consistency (only `.shake` was real).
- DOM id completeness across the three main page bundles — defensive coding, not missing elements.
- textContent vs innerHTML — no real mismatches found.

---

## Recommended execution order

1. Fix Bug 1 (`syncClientId` whitelist) — functional, highest priority.
2. Fix Bug 2 (`.shake` keyframes + class).
3. Fix Bugs 3 & 4 (add `#i-plus` and `#i-shield` to the SVG sprite).
4. Re-run relevant QA harnesses (`qa-sync.cjs`, visual smoke, etc.) after the changes.

These four fixes are independent of the larger UI redesign plan and can be applied first.

---

*Document created 2026-08-11 from Claude’s audit transcript. Owner confirmation required before any code is changed.*
