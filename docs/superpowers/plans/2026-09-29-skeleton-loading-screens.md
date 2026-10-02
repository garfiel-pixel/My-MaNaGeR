# Skeleton Loading Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Load `no-slacking` + `verification-before-completion` first; load `universal-ui-architect` + `ui-modernization` before touching UI.

**Goal:** Replace the circular boot spinner with a layout-mirroring skeleton screen (project.html), and give the app launcher's cloud-projects section a skeleton loading state instead of invisible-then-pop — token-driven, both themes, reduced-motion safe.

**Architecture:** Two surfaces. (1) project.html `#boot-splash`: swap the spinner inner for static skeleton HTML mirroring the real workspace layout — no JS changes (the existing `App.init` rAF `.off` fade keeps hiding it). (2) app.html `#cloud-dash` + `#rail-cloud-list`: `loadList()` renders skeleton boxes at fetch start and replaces them on response/error via the existing render paths. One shared shimmer primitive (`.skel-*` classes + `skel-shimmer` keyframes) in `css/mmgr.css`, themed by two custom properties.

**Tech Stack:** Vanilla CSS (token custom properties + one keyframe animation), static HTML, the existing IIFE modules. No new dependencies, no inline scripts, offline-first unchanged.

## Global Constraints (every task inherits)

- **Token-only colors.** The pasted idea's `#e0e0e0`/`#f0f0f0` are banned. Two custom properties (`--skel-base`, `--skel-sheen`) defined in `:root` (light) and re-mapped under `body.dark-mode` — dark re-maps BOTH, no dark-on-dark (owner doctrine).
- **Reduced motion:** `@media (prefers-reduced-motion:reduce)` kills the shimmer (repo pattern: `.bs-spin{animation:none}`) — static boxes remain as placeholders.
- **No inline scripts** — skeleton markup is static HTML; CSP hashes unchanged. All JS goes through the existing bundles (`node build.js` after any `js/` edit).
- **No emoji** on served pages; icons stay sprite symbols.
- **No `style.display` toggling** (pasted idea §3) — class/`hidden`-attribute mechanisms the app already uses; `verify-hidden-attr` gate must stay green (any `hidden` element with an author display rule needs a `[hidden]{display:none}` guard).
- **CSP hash rule:** project.html/app.html inline `<script>` blocks are NOT touched, so hashes are untouched. Verify at the end.
- Shell bump in `sw.js` (served assets changed) with a version-narrative comment, repo style.
- Harness contracts: `qa-full`/`qa-dashboard-spec` may assert boot/cloud-dash states — Task 0 inventories them; re-baseline in the same task that changes behavior.
- Conventional Commits, ≤72 chars, no AI attribution footers.

## Review-gap notes

- The pasted idea's fetch/swap JS pattern does not apply to the workspace: project data loads from localStorage (offline-first), not a network fetch. The real "loading" moments are (a) bundle parse + first paint (boot splash) and (b) the cloud API fetches. The plan targets exactly those.
- admin.html "Loading codes…" stays text — it is a status line, not a spinner; swapping it is churn without a defect.

## File Structure

| File | Responsibility |
|---|---|
| `css/mmgr.css` | `--skel-base/--skel-sheen` tokens (light+dark), `.skel-box` + size modifiers, `skel-shimmer` keyframes, reduced-motion off, boot-skeleton layout rules |
| `project.html` | Replace `#boot-splash` spinner inner with layout-mirroring skeleton markup |
| `js/mmgr-cloud-dash.js` | `loadList()`: render skeleton boxes at fetch start; existing success/error/offline paths replace them |
| `app.html` | (no markup change needed — `#cloud-dash-list`/`#rail-cloud-list` are JS-rendered; verify) |
| `sw.js` | Shell bump + narrative |
| `tools/qa-dashboard-spec.cjs` | New gates: skeleton markup + reduced-motion + cloud-dash skeleton lifecycle |
| `PLANNING-TODO-2026-09-03.txt` | Session record |

---

### Task 0: Baseline + harness inventory

- [ ] **Step 1: Green baseline**

```bash
node tools/qa-dashboard-spec.cjs && node tools/qa-health-sweep.cjs
```
(Health sweep needs serve.cjs running on :8765 — start it first.) Both must exit 0; if red, fix baseline before starting.

- [ ] **Step 2: Inventory harness assertions on the targets**

```bash
grep -rn "boot-splash\|bs-spin\|cloud-dash\|rail-cloud" tools/*.cjs qa-*.cjs qa-full.cjs | grep -v Binary
```
Record every hit. Any assertion on the splash's spinner inner or on `#cloud-dash` initial states gets re-baselined in the task that changes it.

- [ ] **Step 3: Confirm which bundle carries mmgr-cloud-dash.js** (`grep -n "mmgr-cloud-dash" build.js`) — the edit lands in that bundle; rebuild covers it.

---

### Task 1: Shimmer primitives + tokens (css/mmgr.css)

**Files:** Modify `css/mmgr.css` (append to the boot-skeleton block at ~line 1204)

- [ ] **Step 1: Tokens.** Inside the existing light token block and `body.dark-mode` block, add:

```css
/* Skeleton screens (2026-09-29): placeholder primitives for boot + fetch
   loading states. --skel-base is the box fill, --skel-sheen the moving
   highlight; both re-map in dark mode so the shimmer never dark-on-darks. */
:root{ --skel-base:var(--track-bg); --skel-sheen:var(--tile-bg); }
body.dark-mode{ --skel-base:rgba(255,255,255,.06); --skel-sheen:rgba(255,255,255,.13); }
```
(If `:root`/`body.dark-mode` blocks are far apart in the file, define all four lines together in the skeleton block instead — one place to read.)

- [ ] **Step 2: Primitive + keyframes.**

```css
.skel-box{background:var(--skel-base);border-radius:8px;position:relative;overflow:hidden;min-height:10px;}
.skel-box::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent 20%,var(--skel-sheen) 50%,transparent 80%);transform:translateX(-100%);animation:skel-sheen 1.4s infinite ease-in-out;}
@keyframes skel-sheen{to{transform:translateX(100%);}}
@media (prefers-reduced-motion:reduce){.skel-box::after{animation:none;display:none;}}
```
(The pasted idea animates `background-position` on the box itself; a `::after` sheen layer keeps the base fill token-pure and works identically in both themes.)
Size modifiers, matching the app's real shapes:

```css
.skel-line{height:12px;}
.skel-line.t-lg{height:18px;}
.skel-pill{height:30px;border-radius:100px;}
.skel-card{height:120px;border-radius:var(--radius-lg,16px);border:1px solid var(--border);background:var(--skel-base);}
.skel-card::after{border-radius:var(--radius-lg,16px);}
.skel-row{display:flex;align-items:center;gap:8px;}
.skel-avatar{width:28px;height:28px;border-radius:50%;flex-shrink:0;background:var(--skel-base);}
.skel-boot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;width:min(760px,88vw);}
.skel-boot-col{display:flex;flex-direction:column;gap:10px;}
```

- [ ] **Step 3: Run** `node tools/qa-health-sweep.cjs` (server on :8765) — all source rules must survive into dist (CSS-integrity ARM 2). Also `node tools/verify-css-integrity.cjs`.

- [ ] **Step 4: Commit** `feat(ui): skeleton shimmer primitives with theme tokens`

---

### Task 2: project.html boot skeleton (replace the spinner)

**Files:** Modify `project.html` (~line 85), `css/mmgr.css`

- [ ] **Step 1: Swap the splash inner.** Keep `#boot-splash`, `.off` mechanics, and the App.init hide path untouched. Replace:

```html
<div id="boot-splash"><div class="bs-inner"><div class="bs-spin"></div><div>Loading project...</div></div></div>
```
with a static layout mirror (header row → metric-card row → two wide cards), the app's real above-fold shapes:

```html
<!-- Boot loading skeleton (hidden by App.init after first paint): mirrors
     the workspace's above-the-fold layout instead of a spinner. Static
     markup, token-driven shimmer, reduced-motion static fallback. -->
<div id="boot-splash" role="status" aria-live="polite" aria-busy="true" aria-label="Loading project">
  <div class="bs-skel">
    <div class="skel-row bs-skel-header">
      <div class="skel-box skel-avatar"></div>
      <div class="skel-box skel-line t-lg" style-less-width="40%"></div>
    </div>
    <div class="skel-boot-grid">
      <div class="skel-boot-col"><div class="skel-box skel-card"></div></div>
      <div class="skel-boot-col"><div class="skel-box skel-card"></div></div>
      <div class="skel-boot-col"><div class="skel-box skel-card"></div></div>
    </div>
    <div class="skel-boot-col bs-skel-wide"><div class="skel-box skel-card"></div></div>
  </div>
</div>
```
(No inline `style=` attributes — widths come from CSS classes; drop the stray `style-less-width` marker, use a `.w-40{width:40%}` modifier or a fixed-width class instead.)

- [ ] **Step 2: Splash layout CSS.** Replace `.bs-inner`/`.bs-spin` rules (keep `#boot-splash` fixed-overlay rule and `.off` transition exactly):

```css
.bs-skel{display:flex;flex-direction:column;gap:16px;width:min(860px,92vw);}
.bs-skel-header{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-lg,16px);}
.bs-skel-wide{width:100%;}
@media (max-width:820px){.skel-boot-grid{grid-template-columns:1fr 1fr;}}
@media (max-width:600px){.skel-boot-grid{grid-template-columns:1fr;}}
```
Delete `.bs-spin`, `@keyframes bs-spin`, and its reduced-motion override (no other file references them — verify with `grep -rn "bs-spin" --include="*.html" --include="*.js" --include="*.css"`).

- [ ] **Step 3: Contrast check (APCA/WCAG floor).** Light: `--skel-base` on `--canvas` and dark: `rgba(255,255,255,.06)` on the dark canvas — boxes are decorative placeholders, but verify visible: screenshot boot splash light+dark (hard-reload with throttling or temporarily delay the `.off` class in a probe) to `tmp/skel-boot-light.png` / `-dark.png`.

- [ ] **Step 4: Re-baseline any Task 0 hits** that asserted the spinner inner (`bs-spin` / "Loading project" text).

- [ ] **Step 5: Verify the hide path in a real browser:** load project.html?id=demo-project on :8765, confirm the splash fades and the real UI paints; `grep -c "boot-splash" dist/bundle.js` unchanged (JS untouched).

- [ ] **Step 6: Commit** `feat(boot): layout-mirroring skeleton replaces the boot spinner`

---

### Task 3: app.html cloud-dash skeleton (fetch loading state)

**Files:** Modify `js/mmgr-cloud-dash.js` (`loadList()`, ~line 174; rail path in the same flow), rebuild app bundle

- [ ] **Step 1: Skeleton renderers (pure functions, escaped/no user data).**

```javascript
function dashSkeleton(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += '<div class="cd-card cd-skel" aria-hidden="true">' +
      '<div class="skel-row"><span class="skel-box skel-avatar"></span>' +
      '<span class="skel-box skel-line" style-width-class="skel-w-60"></span></div>' +
      '<div class="skel-box skel-line skel-w-40"></div>' +
      '<div class="skel-box skel-pill"></div></div>';
  }
  return out;
}
function railSkeleton() {
  return '<div class="skel-row db-skel-row" aria-hidden="true">' +
    '<span class="skel-box skel-avatar"></span><span class="skel-box skel-line skel-w-60"></span></div>';
}
```
(No inline styles: `.skel-w-60{width:60%}` / `.skel-w-40{width:40%}` / `.db-skel-row` classes in css/mmgr.css. Fix the `style-width-class` placeholder to plain `class="skel-box skel-line skel-w-60"`.)

- [ ] **Step 2: Wire into `loadList()`** — immediately BEFORE the fetch (after the null-guards), un-hide the dash and paint skeletons; `dash.setAttribute('aria-busy','true')`:

```javascript
dash.hidden = false;
list.innerHTML = dashSkeleton(3);
const rail = $(RAIL_CLOUD);
if (rail) { rail.hidden = false; rail.innerHTML = railSkeleton(); }
```
All existing exits replace/remove the skeleton (no changes needed to their bodies, only confirm each path writes `list.innerHTML` or hides `dash`): offline catch → `dash.hidden = true` (immediately — offline users must not see a shimmer for a hanging fetch; keep the existing behavior), `!res.ok` → hide, parse-fail → hide, empty list → existing empty-state message replaces the boxes. Remove `aria-busy` on every terminal path.

- [ ] **Step 3: Rail section visibility.** `#rail-cloud-list` is `hidden` in markup and toggled by the rail accordion — the skeleton must only paint while its section is open AND a fetch is in flight; respect the existing accordion state (do not force-open it; if hidden, skip the rail skeleton). If the accordion opens later mid-fetch, the next `renderRailCloud` handles it — never force.

- [ ] **Step 4: Offline-first guard.** The `catch` path currently hides the dash instantly. Prove it: with the Worker absent (serve.cjs only), open app.html — the cloud section must NOT appear (no skeleton flash). This is a hard gate.

- [ ] **Step 5: Harness gates (extend `tools/qa-dashboard-spec.cjs`, static + browser):**
  - static: `mmgr-cloud-dash.js` contains `dashSkeleton(` and the offline path hides the dash (grep-able assertions consistent with that harness's style);
  - CSS: `.cd-skel`, `.skel-box`, reduced-motion rule exist in `css/mmgr.css`;
  - browser (if the harness already runs one): fetch-start paints `.cd-skel`, 401/signed-out path hides it.

- [ ] **Step 6: Rebuild** `node build.js`; run `node tools/qa-dashboard-spec.cjs` → PASS.

- [ ] **Step 7: Commit** `feat(cloud-dash): skeleton loading state for the cloud project lists`

---

### Task 4: Release wiring + full verification

**Files:** Modify `sw.js`, `PLANNING-TODO-2026-09-03.txt`

- [ ] **Step 1: Shell bump.** `const CACHE = 'mmgr-shell-v337';` + prepend the v337 narrative (skeleton screens wave: project.html boot skeleton, css/mmgr.css primitives, js/mmgr-cloud-dash.js, bundles rebuilt, no inline scripts, CSP hashes unchanged; shell bump so clients re-fetch).

- [ ] **Step 2: Full battery, in order**

```bash
node build.js
npm run verify
node tools/qa-dashboard-spec.cjs
node tools/qa-full.cjs
node tools/qa-health-sweep.cjs
node tools/qa-calc-playwright-audit.cjs
node tmp/header-probe.cjs   # regressions: header/banners untouched by this wave
```
All exit 0. Emoji scan (python range scan) on project.html, app.html, css/mmgr.css, js/mmgr-cloud-dash.js → CLEAN. `grep -c "skel-" dist/mmgr.min.css` ≥ 1 and `grep -c "dashSkeleton" dist/app-bundle.js` ≥ 1 (bundle actually rebuilt).

- [ ] **Step 3: Both-theme + reduced-motion browser proof.** Devtools emulation `prefers-reduced-motion: reduce` → boxes static, no sheen. Dark mode → sheen visible on dark canvas (no invisible boxes). Screenshots to `tmp/skel-*.png`.

- [ ] **Step 4: Tracker + commit** `feat(ui): skeleton loading screens for boot and cloud lists` (squash-check `git log --oneline` for footers), append the session record to `PLANNING-TODO-2026-09-03.txt`.

## Decision points (default = recommendation)

1. **Scope of surfaces:** project.html boot splash + app.html cloud lists only — admin.html's text status lines stay (recommend: yes; they are not spinners).
2. **Skeleton card count in cloud dash:** 3 cards (matches typical account size; more would imply data we don't have) — recommend: 3.
3. **Keep the boot splash full-screen overlay** (current design) rather than inline-in-layout skeletons — recommend: keep; it already has the fade + z-index choreography and App.init wiring; inline skeletons would need real layout restructuring.

## Self-review

- Spec coverage: pasted idea §1 (skeleton structure) → Task 2 markup mirroring the REAL layout (not the idea's generic sidebar/header guess); §2 (shimmer CSS) → Task 1 primitives, token-driven + reduced-motion (idea's hardcoded grays and `background-position` animation adapted per repo law); §3 (JS swap) → Task 3's fetch lifecycle using class/hidden mechanisms (idea's `style.display` rejected).
- Type consistency: `dashSkeleton(n)`/`railSkeleton()` are defined once and used only inside `loadList()`; class names match Task 1's CSS exactly.
- No placeholders: all code blocks are real shapes; the two `style-width-class`/`style-less-width` markers are explicitly called out as fix-in-place instructions for the implementer.
