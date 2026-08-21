# My MaNaGeR — Audit Fix Implementation Guide
**Companion to `MYMANAGER-FULL-AUDIT.md`** — concrete, current best-practice code and procedures for every finding, in priority order.

Each section: **what's wrong → the fix, with real code → how to verify it worked.** Code is written to match the stack the audit describes (Cloudflare Workers + D1, vanilla JS frontend, no build step) rather than generic advice.

---

## Priority 0 — Do today (§2.1, Critical)

### Fix: deploy is shipping ~5.8MB of internal docs/tooling publicly

Two layers of defense, not one. A comment is not a control — you need something that **fails the deploy** if it drifts.

**Layer 1 — close the current hole immediately.** Add every leaking path to `.assetsignore`:

```
# .assetsignore — anything NOT listed here gets uploaded as a public static asset
.git
.wrangler
node_modules
.dev.vars
serve.cjs
qa-*.cjs
tools
migrations
.agents/
_archive/
mcp/
.githooks/
skills-lock.json
CLOUD-BACKEND-ARCHITECTURE-PLAN.md
universal-ui-architect.md
"monolith html to reference from all features.html"
*.md
!README.md
*.json
!package.json
!wrangler.jsonc
!manifest.webmanifest
```

The `*.md` / `!README.md` pair is the important part — instead of chasing every new planning doc you create, blocklist the whole extension and allowlist only what should genuinely be public. Same pattern for stray root `.json` files.

**Layer 2 — make drift impossible to ship silently.** Add a `predeploy` gate that inspects Wrangler's own asset manifest before upload:

```js
// scripts/verify-assets.mjs
// Fails the build if any disallowed path would be uploaded as a public asset.
import { execSync } from 'node:child_process';

const DISALLOWED = [
  /^\.agents\//, /^_archive\//, /^mcp\//, /^\.githooks\//,
  /\.md$/i, /^skills-lock\.json$/,
  /^(?!package\.json$|wrangler\.jsonc$|manifest\.webmanifest$).*\.json$/i,
];

// `wrangler deploy --dry-run --outdir` prints the exact file list that would ship.
const out = execSync('npx wrangler deploy --dry-run -o .deploy-manifest', { encoding: 'utf8' });
const fs = await import('node:fs');
const files = fs.readdirSync('.deploy-manifest', { recursive: true }).map(String);

const offenders = files.filter(f => DISALLOWED.some(rx => rx.test(f)));
if (offenders.length) {
  console.error('❌ Deploy blocked — disallowed files would be published:');
  offenders.forEach(f => console.error('  -', f));
  process.exit(1);
}
console.log(`✅ Asset manifest clean (${files.length} files).`);
```

```json
// package.json
{
  "scripts": {
    "verify:assets": "node scripts/verify-assets.mjs",
    "predeploy": "npm run verify && npm run verify:assets",
    "deploy": "npm run predeploy && npx wrangler deploy"
  }
}
```

Now `npm run deploy` — the exact command the audit flagged — physically cannot ship those paths again, regardless of whether `.assetsignore` drifts later.

**Verify:** run `npm run verify:assets` right now against the current repo state; it should fail loudly, listing every currently-leaking file. Fix `.assetsignore` until it passes clean, then re-run once more to confirm.

---

## Priority 1 — This week (§3.1, §3.2, High)

### Fix: zero CI/CD — 20 QA scripts exist but nothing forces them to run

Cheapest real fix: a GitHub Actions workflow gating `main`. No new tooling needed — it just runs what you already built.

```yaml
# .github/workflows/verify.yml
name: Verify
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run verify
      - run: npm run verify:assets
      - run: node qa-full.cjs   # or whichever subset is fast enough for CI
```

If some `qa-*.cjs` scripts are slow (browser-driven), split into a `verify` job (every push, fast) and a `qa-full` job (PR only, or nightly cron) so you get quick feedback without a 10-minute gate on every commit.

Pair this with a local pre-push hook so failures are caught before they even reach GitHub:

```bash
# .githooks/pre-push
#!/bin/sh
npm run verify && npm run verify:assets
```

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

**Verify:** open a throwaway PR that reintroduces one of the §2.1 leaked paths — confirm the Actions check goes red and blocks merge.

### Fix: unhandled `/api/*` exceptions collapse to a silent, unlogged 404

Give the API its own boundary, separate from the asset-serving fallback:

```js
// worker.js
async function fetch(request, env) {
  const url = new URL(request.url);
  const normalized = url.pathname;

  if (normalized.indexOf('/api/') === 0) {
    try {
      return await handleApi(request, env, url);
    } catch (e) {
      // Real visibility: Workers Logs / `wrangler tail` will show this.
      console.error('API error', {
        path: normalized,
        method: request.method,
        message: e?.message,
        stack: e?.stack,
      });
      return new Response(
        JSON.stringify({ error: 'internal_error', requestId: crypto.randomUUID() }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...HEADERS } }
      );
    }
  }

  try {
    return await env.ASSETS.fetch(request);
  } catch (e) {
    // This outer guard now ONLY covers genuine asset-serving failures.
    return new Response('Not Found', { status: 404 });
  }
}
```

This is a one-line-of-reasoning change with a real payoff: a 500 now tells the client "retry / show an error state," where a 404 used to tell it "this doesn't exist" — those should drive different UI behavior. And `console.error` inside a Worker is captured by [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/) automatically if enabled — turn that on (`wrangler.jsonc` → `"observability": { "logs": { "enabled": true } }`) so this isn't logging into the void.

**Verify:** temporarily throw inside a handler (`throw new Error('test')`), hit the route, confirm you get a 500 with a body (not a bare 404) and that the error shows up in `wrangler tail`.

---

## Priority 2 — Small, high-impact UI fixes (§6.1, §6.2)

### Fix: "See the features" loops back to homepage

```diff
- <a class="btn btn-gold" href="index.html#features">See the features</a>
+ <a class="btn btn-gold" href="app.html">Open the app</a>
```

Better still, sweep every CTA `href` across all 14 HTML entry points in one pass rather than fixing this one instance in isolation — the audit is right that this is a copy-paste class of bug, so grep for it:

```bash
grep -rn 'href="index.html#' *.html
```

Check every hit manually: is this CTA on the homepage itself (correct — it's an anchor jump), or on a page that was copy-pasted from the homepage template (bug)?

### Fix: duplicate demo-project card with conflicting "Locked" / "active" labels

The real fix is informational, not cosmetic — the UI is showing two true-but-differently-scoped facts (device-local unlock state vs. cloud project status) as if they were one status. Collapse to a single card with a single, unambiguous state machine:

```js
// mmgr-launcher.js
function getProjectCardState(project, deviceUnlocked) {
  // One card, one state, in priority order.
  if (project.cloudStatus === 'archived') return 'archived';
  if (!deviceUnlocked) return 'locked';       // needs a code on THIS device
  return 'active';                             // unlocked + live
}

const STATE_COPY = {
  locked:   { badge: 'Locked',   cta: 'Enter code',   help: 'You need an access code to open this project on this device.' },
  active:   { badge: 'Active',   cta: 'Open project', help: null },
  archived: { badge: 'Archived', cta: 'View (read-only)', help: null },
};

function renderProjectCard(project, deviceUnlocked) {
  const state = getProjectCardState(project, deviceUnlocked);
  const copy = STATE_COPY[state];
  return `
    <div class="project-card" data-state="${state}">
      <h3>${escapeHtml(project.name)}</h3>
      <span class="badge badge-${state}">${copy.badge}</span>
      ${copy.help ? `<p class="help-text">${escapeHtml(copy.help)}</p>` : ''}
      <button data-action="project-cta" data-project="${project.id}">${copy.cta}</button>
    </div>`;
}
```

One card per project, one badge, one CTA — the "Locked" vs "active" distinction the audit flagged becomes a single `help-text` line instead of two competing widgets.

**Verify:** render the launcher with a project in each of the three states and confirm exactly one card each, screenshot at both 1440×900 and 390×844.

---

## Priority 3 — Medium security hardening (§4.1–§4.4)

### 4.1 — Add HSTS

```js
// worker.js — HEADERS object
const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};
```

If Cloudflare's zone-level "Always Use HTTPS" / HSTS dashboard setting is already on, this is a harmless duplicate — but code beats dashboard config for auditability, since anyone reading `worker.js` sees the full security posture in one place instead of half in code, half in a UI they may not have access to.

### 4.2 — Rate limiting is per-isolate, not global

Cloudflare's native [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) is the direct fix and needs no Durable Object plumbing:

```jsonc
// wrangler.jsonc
{
  "ratelimits": [
    { "name": "LOGIN_LIMITER", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }
  ]
}
```

```js
// worker.js — login route
async function handleLogin(request, env) {
  const key = getClientIp(request); // or email, whichever you want bucketed
  const { success } = await env.LOGIN_LIMITER.limit({ key });
  if (!success) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }
  // ...existing login logic
}
```

This is genuinely global across every edge isolate — no more per-node reset. Apply the same pattern to `/api/register` and the AI relay endpoint; keep the existing in-memory `Map` for low-stakes routes to avoid paying for a binding you don't need there.

### 4.3 — Move project codes out of the URL query string

```diff
- GET /api/cloud/presence?project=<id>&code=<owner-or-editor-code>
+ GET /api/cloud/presence?project=<id>
+ Header: X-Project-Code: <owner-or-editor-code>
```

```js
// client
fetch(`/api/cloud/presence?project=${projectId}`, {
  headers: { 'X-Project-Code': code },
});

// worker.js
const code = request.headers.get('X-Project-Code');
```

Headers don't land in server access logs, browser history, or `Referer` the way query strings do. Same treatment for any other endpoint still passing `code=` in the URL — grep for it:

```bash
grep -rn 'code=' worker.js js/*.js | grep -i 'fetch\|href\|location'
```

### 4.4 — Rate-limit `/api/health`

```js
if (normalized === '/api/health') {
  const { success } = await checkBucket(env, getClientIp(request), 'health', 60, 60_000);
  if (!success) return new Response('', { status: 429 });
  return new Response('ok');
}
```

Cheapest tier is fine — this is defense-in-depth, not a real threat today.

---

## Priority 4 — Low/hardening batch (§5.1–§5.9)

Bundle these into one PR; none is individually urgent.

| # | Fix |
|---|---|
| 5.1 | Add to `HEADERS`: `'Cross-Origin-Opener-Policy': 'same-origin'`, `'Cross-Origin-Resource-Policy': 'same-origin'` |
| 5.2 | Add CSP reporting: `Content-Security-Policy-Report-Only` header (or `report-to` directive) pointed at a `/api/csp-report` endpoint that just logs; start in report-only mode before enforcing |
| 5.3 | Raise `AUTH_MIN_PASSWORD` to 10–12, check against the [Have I Been Pwned Pwned Passwords API](https://haveibeenpwned.com/API/v3#PwnedPasswords) (k-anonymity model, no plaintext leaves your server) before accepting a new password; MFA (TOTP) is a bigger lift — track as its own backlog item, not part of this hardening pass |
| 5.4 | Add an explicit CSRF token as defense-in-depth alongside the existing Origin check: generate a per-session random token, embed in forms/API calls, verify server-side. Origin-only is *reasonable* for modern browsers but a second layer is cheap insurance |
| 5.5 | Move CSP hash regeneration into the `predeploy` chain you just built for §2.1/§3.1, so it can never be forgotten again |
| 5.6 | Add a `devDependencies` pin for `wrangler`: `"wrangler": "^3.90.0"` (exact version you're currently running) so `npx wrangler deploy` stops silently pulling latest |
| 5.7 | `rm hero-crane-sky.png site-overview-clean.png finished-interior-living.png completed-kitchen.png office-project-desk.png` — confirmed unreferenced, `.webp` versions already in use |
| 5.8 | Generate proper 192×192 and 512×512 icons (including a `"purpose": "maskable"` variant — use [maskable.app](https://maskable.app/) to preview safe-zone padding) and update `manifest.webmanifest` |
| 5.9 | Rename `primary icon.png` → `primary-icon.png`, `high contrast icon.png` → `high-contrast-icon.png`; update all references |

---

## Priority 5 — Code quality / maintainability (§7.1–§7.7)

### 7.1 — Four different `escapeHtml` implementations

Pick the DOM `textContent`-trick version (fastest, no regex edge cases) as canonical, put it in one place, and delete the other three:

```js
// js/mmgr-utils.js — the ONE canonical implementation
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
```

```js
// js/mmgr-cloud-dash.js, mmgr-cloud.js, mmgr-portfolio.js
import { escapeHtml } from './mmgr-utils.js';
// delete the local esc()/escapeHtml() definitions, replace call sites
```

Since this project has no bundler, use native ES module imports (already `<script type="module">`-compatible) rather than adding a build step just for this.

### 7.2 — 77 hardcoded hex colors bypassing design tokens

```bash
# find every raw hex that isn't already a var() reference
grep -noE '#[0-9a-fA-F]{3,6}' mmgr.css | sort | uniq -c | sort -rn
```

Work through the list highest-frequency-first; for each unique hex, check whether it matches (or is close to) an existing `--token` and replace:

```diff
- .status-badge.warn { background: #fbbf24; }
+ .status-badge.warn { background: var(--warn); }
```

For colors that *don't* map cleanly to an existing token, that's a signal the token system is missing a real semantic color (not every hardcoded hex is a bug — some are legitimately one-off). Add the token rather than forcing a bad fit.

### 7.3 — Files exceeding comfortable review size

Don't do a big-bang rewrite. Split along natural seams the next time you touch each file, e.g. `mmgr-cloud.js` (2,042 lines) → `mmgr-cloud-api.js` (fetch wrappers) + `mmgr-cloud-sync.js` (conflict resolution) + `mmgr-cloud-presence.js`. Track as an incremental "split on next touch" rule in `CONTRIBUTING.md` rather than a standalone refactor sprint.

### 7.4 — 30+ top-level planning docs, no canonical index

```md
<!-- DOCS-INDEX.md -->
# Documentation Index
**Current / authoritative:**
- MASTER-ACTION-PLAN-v3-STRICT.md — the live roadmap, supersedes all prior action plans
- GLASS-UI-DESIGN-SPEC.md — current UI design system

**Historical (kept for reference, not current):**
- FULL-GAP-AUDIT.md, BACKLOG.md, OWNER-REVIEW.md, ... (dated)

Move anything genuinely obsolete into `_archive/` (already `.assetsignore`'d after the §2.1 fix) rather than leaving it in the root.
```

This also directly shrinks the §2.1 blast radius — fewer root-level files, less that can ever leak.

### 7.5 — 83 `!important` declarations

Not fixable in one pass safely. Add an ESLint-equivalent CSS lint rule (`stylelint` with `declaration-no-important`) set to **warn**, not error, so new `!important`s get flagged in review without blocking work on the 83 existing ones:

```json
// .stylelintrc.json
{ "rules": { "declaration-no-important": true } }
```

### 7.6/7.7 — No bundling; theme-flash script blocks in `<head>` as an external fetch

For 7.7 specifically (the theme-flash script defeating its own purpose), the fix is small and standalone — inline it directly:

```diff
- <script src="js/mmgr-theme.js" data-sync="1"></script>
+ <script>
+   // Inlined intentionally: this MUST run before first paint with zero
+   // network round-trip, or the whole point (no flash of wrong theme) is lost.
+   (function () {
+     const saved = localStorage.getItem('mmgr-theme');
+     if (saved === 'dark') document.documentElement.classList.add('theme-dark');
+   })();
+ </script>
```

For 7.6 (39 unbundled scripts), a real bundler is a bigger call given the "no build step" architecture is deliberate (per your own local-first/zero-server doctrine). A lighter middle ground: `esbuild` as a single optional dev dependency that concatenates the 39 scripts into one file at deploy time, with the unbundled versions still usable for local dev:

```bash
npx esbuild js/mmgr-*.js --bundle --minify --outfile=dist/mmgr-bundle.js
```

Treat this as an explicit backlog item, not part of this hardening pass — it's a real architecture decision, not a bug fix.

---

## Priority 6 — Accessibility (§8.1)

Two color pairs need a usage audit before you know if they're a real AA failure:

```bash
grep -rn 'color:\s*var(--slate)\|color:\s*var(--purple)\|color:\s*var(--danger)' mmgr.css
```

For each hit, check the computed `font-size`: WCAG AA large-text threshold is **18pt (24px) regular, or 14pt (18.66px) bold**. Anything below that using `--slate`, `--purple`, or `--danger` needs a fix:

```diff
- .helper-text { color: var(--slate); font-size: 13px; }
+ .helper-text { color: var(--slate-dark); font-size: 13px; } /* new, higher-contrast token */
```

Add a `--slate-dark` / `--purple-dark` token computed to hit 4.5:1 rather than darkening ad hoc per instance, so future body-text usages inherit the fix automatically.

---

## Suggested execution order (matches audit §12, with code now attached)

1. `.assetsignore` fix + `verify-assets.mjs` gate — **today** (Priority 0)
2. GitHub Actions workflow + API error boundary — **this week** (Priority 1)
3. `features.html` CTA fix + launcher card consolidation — **this week** (Priority 2)
4. HSTS header + rate-limit binding migration for login/register — **next sprint** (Priority 3)
5. Batch the remaining Low items into one hardening PR (Priority 4)
6. Code-quality items opportunistically, "fix on next touch" rather than a dedicated sprint (Priority 5)
7. Accessibility contrast audit — quick, do alongside Priority 2/3 UI work (Priority 6)
