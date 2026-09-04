# AGENTS.md — Instructions for AI agents working in this repository

> Read this file before making ANY change. It tells you which skills to load first.

## Project at a glance

**My MaNaGeR** — an offline-first construction project-management workspace
(front-end HTML/CSS/JS monolith in `index.html`-style pages + `js/*.js` modules),
deployed as **Cloudflare Workers static assets** with:

- `worker.js` — thin Worker: security headers (CSP incl. per-script SHA-256
  hashes), Google sign-in session (HttpOnly HMAC cookie), BYO-AI-key relay
  (`/api/ai/chat`), and the D1+R2 cloud sync API (`/api/cloud/*`).
- **D1** database (`DB` binding, raw SQL migrations in `migrations/`).
- **R2** bucket (`R2` binding, project-state JSON blobs).
- **PWA**: `sw.js` service worker + `manifest.webmanifest`, offline-first.
- QA battery: `qa-*.cjs` harnesses at repo root, `tools/qa-*.cjs`, plus
  `verify-*.cjs` checks. Run `npm run verify` before deploy.

## MANDATORY: load skills before editing

This repo carries a locked skill set in **`.agents/skills/`** (registered in
`skills-lock.json`). **Before you edit any code, read the SKILL.md of every
skill relevant to your task and follow it.** Skills are self-contained
instructions; ignoring them risks violating this project's hard gates.

How to load: use your skill-loading mechanism on the skill **name** below
(e.g. `skill` tool → the `name` field from `SKILL.md`), or read
`.agents/skills/<dir>/SKILL.md` directly.

### Skill map (directory → when to load it here)

| Skill dir | Load before… |
|---|---|
| `.agents/skills/skeptical-code-audit` | Auditing the app for broken wiring (CSS classes toggled by JS, `data-action` handlers with no map entry, DOM ids referenced but missing, features that silently no-op). |
| `.agents/skills/universal-ui-architect` | Any UI/UX work: design tokens, WCAG 2.2/APCA contrast gates, Liquid Glass surfaces, responsive/interaction polish. Hard gates block ship. |
| `.agents/skills/ui-modernization` | Modernizing existing UI — typography, cards, buttons, banners, admin panels, marketing pages; token-first, dark-mode parity, SVG icons only, minimal changes, zero feature removal. Complements `universal-ui-architect` (gates) with a concrete step-by-step process. |
| `.agents/skills/accessibility-rules` | WCAG 2.2 accessibility rules reference — note: oriented to documents (Word/Excel/PPT/PDF); for web pages rely on `universal-ui-architect`'s gates instead. |
| `.agents/skills/pwa-development` | PWA work: `sw.js` caching strategy, `manifest.webmanifest`, offline-first behavior, install/update flows. |
| `.agents/skills/security-audit` | Security reviews / vulnerability audits of `worker.js`, the cloud API, CSP, session/owner-code flows. Pair with `skeptical-code-audit`. |
| `.agents/skills/wrangler` | Running wrangler commands (deploy, `d1`, `r2`, secrets, dev). |
| `.agents/skills/workers-best-practices` | Writing or reviewing any Worker code / `wrangler.jsonc` config. |
| `.agents/skills/cloudflare` | Any Cloudflare platform task (Workers, Pages, KV, D1, R2, AI). Comprehensive fallback. |
| `.agents/skills/cloudflare-api` | Direct Cloudflare REST API ops (D1 queries, R2 bulk, cache purge, WAF). |
| `.agents/skills/d1-migration` | D1 schema changes / migration work (Drizzle-based; this repo uses raw SQL migrations — apply the SQL gotchas only). |
| `.agents/skills/web-perf` | Auditing/profiling page load, Core Web Vitals, PWA performance. |
| `.agents/skills/qa-expert` | Establishing QA process, test plans, bug triage (P0–P4), coverage metrics. Complements the `qa-*.cjs` battery. |
| `.agents/skills/google-drive` | Anything touching Google Drive integration. |
| `.agents/skills/gemini-api-dev` | Anything touching the Gemini API: `js/mmgr-ai.js` / `mmgr-ai-key.js`, the model fallback ladder, `/api/ai/chat` relay, prompt/model selection. |
| `.agents/skills/oauth` | OAuth 2.0/2.1 authorization-code/PKCE flow reference (Fastify-oriented — apply the RFC/flow gotchas only; the Worker's Google sign-in uses its own HMAC cookie flow). |
| `.agents/skills/landing-page-generator` | Marketing page work: `index.html`, `features.html`, `about.html`, `contact.html`, CTA/hero/SEO copy structure. |

### When in doubt, load
`cloudflare` (platform), `workers-best-practices` (worker.js), and
`skeptical-code-audit` (verification) cover most edits in this repo.

## Project-critical rules (do not violate)

1. **CSP hash drift breaks pages silently.** `worker.js` embeds SHA-256 hashes
   of every inline `<script>` in the served HTML files. If you edit any inline
   script block, regenerate the hashes with the node command documented in
   `worker.js`'s header comment and update `INLINE_SCRIPT_HASHES`. Stale hashes
   block the page with no visible error. Also keep `serve.cjs`'s mirror in sync.
2. **Deploy from a clean staging copy.** `wrangler.jsonc`'s assets directory is
   `.`, and wrangler does NOT honor gitignore for assets — uploads bloated and
   hit the 25 MiB limit before. Follow the tar staging recipe in
   `wrangler.jsonc` (exclude `.git`, `.wrangler`, `node_modules`, `.agents`).
3. **Offline-first is sacred.** The app must work with no network. Cloud sync
   (`/api/cloud/*`) is OPT-IN per project and must stay that way.
4. **`skills-lock.json` is the source of truth** for installed skills
   (source, path, content hash). Re-run `npx skills add` to update; never hand-edit
   the hashes. Exception: project-authored skills with no registry source
   (`skeptical-code-audit`, `universal-ui-architect`, `ui-modernization`) are registered with hashes
   computed via `tools/hash-skill-folder.cjs` (same algorithm as the verify script).
   Skills run with full agent permissions — review before use.
5. **Run `npm run verify`** (CSP + service-worker checks) before deploying, and
   relevant `qa-*.cjs` harnesses after non-trivial changes.
6. **Commit messages follow Conventional Commits** — `type(scope): short
   professional subject` (types: `feat`, `fix`, `chore`, `test`, `docs`,
   `refactor`, `perf`, `build`, `ci`, `revert`; subject ≤ 72 chars, imperative
   mood, no trailing period, detail goes in the body). Enforced by the
   `.githooks/commit-msg` hook — see `CONTRIBUTING.md` for the full convention
   and the `--no-verify` escape hatch.
7. **NO EMOJI ON ANY SERVED PAGE — HARD GATE (owner, 2026-08-13).** Zero emoji
   glyphs in any served HTML page or any JS string that renders into a page
   (toasts, status lines, AI-window chips, prompts, exports). Icons are SVG
   only: centralized sprite symbols
   (`<svg class="ico"><use href="css/mmgr-icons.svg#i-..."></use></svg>`),
   explicit inline `<svg>` on standalone pages, the monolith's inlined sprite.
   The "higher form of SVG" = one shared symbol sprite — never per-icon
   duplicated paths, never an emoji stand-in. Missing icon → ADD a symbol to
   the sprite; prose describing a button names it ("the run button"), it does
   not draw a glyph. Internal docs (md/json) may keep emojis; served pages may
   not. New/changed pages must pass the emoji scan before merging (regex over
   U+1F000–1FAFF, 2600–27BF, 2B00–2BFF, FE0F, 1F1E6–1F1FF).

## Hard-won knowledge (do not repeat these mistakes)

These lessons come from real production incidents and wasted sessions.
Each one cost hours to diagnose. Read them before touching the build.

### 1. NEVER `taskkill //F //IM node.exe` — it kills the agent itself

The agent process runs as `node.exe`. Running `taskkill //F //IM node.exe`
or equivalent kills the agent's own PID, crashing the session instantly.
Multiple prior sessions died this way. To check for stale processes:

```bash
# SAFE: inspect command lines before touching anything
wmic process where "name='node.exe'" get ProcessId,CommandLine /format:list
# Kill ONLY a specific PID you identified as stale — never by image name
```

### 2. Bundle staleness is the #1 silent killer of edits

`dist/bundle.js` (project.html) and `dist/app-bundle.js` (app.html) are
minified concatenations of the `js/` source files. They load first via
`<script defer src="dist/bundle.js">`. The dev fallback that loads
individual source files only triggers when the bundle 404s (`onerror`).

**If you edit `js/*.js` but forget to rebuild, the bundle's old code runs.
Your changes appear to have no effect.** This is the single most common
cause of "why is my code change not working" in this repo.

After ANY source change, always rebuild:

```bash
node build.js          # builds all bundles: app, launcher, admin, marketing, CSS
node build.js --app    # project.html bundle only (most common)
```

The QA server (`serve.cjs`) serves files directly from disk, so `curl` may
show your changes — but the browser loads the stale bundle. Always verify
by checking the bundle content: `grep -c 'yourNewFunction' dist/bundle.js`.

### 3. `renderDash()` / `renderAll()` wrap sub-renderers in `requestAnimationFrame`

Many sub-renderers (weather log, leadtime tracker, decisions, aging,
baseline narrative, forecast, meetings, etc.) execute inside a
`requestAnimationFrame` callback in `renderDash()`. Calling `renderDash()`
and immediately checking the DOM will see stale results because the RAF
has not fired yet.

**Fix:** split the render call and DOM check into separate steps with a RAF
flush between them:

```javascript
await ev('MMGR.Render.renderDash();');  // trigger render
await ev(FLUSH_RAF);                    // flush the RAF queue
await delay(200);                       // let DOM settle
// now check DOM
```

The `FLUSH_RAF` constant in `qa-full.cjs` fires two nested RAFs to drain
the queue.

### 4. Production strips `.html` extensions — test assertions must handle both

The Cloudflare Worker serves static assets and rewrites `/project.html`
to `/project` (307 redirect). Tests that assert on `location.href` or
`location.pathname` must accept both forms:

```javascript
// CORRECT: handles both local dev and production
location.pathname.indexOf('project.html') > -1 || location.pathname.indexOf('/project') > -1
```

### 5. Chrome HTTP cache breaks QA between runs

The `Cache-Control: immutable` header on static assets causes Chrome to
serve stale files from the OS-level cache, even with a fresh user profile.
Add `--disk-cache-size=0` to the Chrome launch args in `qa-full.cjs` to
prevent this.

### 6. D1 WAL may not be visible immediately after Worker writes

The Worker's D1 binding writes to WAL, but `node:sqlite` reads from the
main database. After a Worker write, a direct `queryD1()` may return stale
or empty results. Use `queryD1Retry()` (up to 3 attempts, 200ms apart)
in `tools/qa-cloud-phase2.cjs`.

### 7. Deploy staging recipe — never deploy from the repo root

`wrangler.jsonc` assets directory is `.` and wrangler uploads EVERYTHING
(not honoring `.gitignore`). Always create a clean staging copy first:

```bash
node build.js  # rebuild bundles first
rm -rf /tmp/mmgr-deploy && mkdir -p /tmp/mmgr-deploy
tar --exclude='.git' --exclude='.wrangler' --exclude='node_modules' \
  --exclude='.agents' --exclude='_archive' -cf - . | tar -xf - -C /tmp/mmgr-deploy
cd /tmp/mmgr-deploy && npx wrangler deploy
```

### 8. CI REPAIR LOOP — keep GitHub Actions green (owner standing rule, 2026-09-04)

GitHub CI (`ci.yml`) is the deploy gate. A red run BLOCKS shipping. The
loop that keeps it green — apply after EVERY wave, and whenever the user
reports a CI failure:

1. **Read the failing step, not the run.** `curl` the Actions API
   (`/repos/{owner}/{repo}/actions/runs?branch=main&per_page=1` then
   `/runs/{id}/jobs` → `steps[].conclusion==='failure'`). The first red
   step is the one to fix; steps after it are SKIPPED, so a run can hide
   MULTIPLE latent failures (fix one, push, re-run, next one surfaces).
2. **Reproduce locally before touching code.** If the suite is
   self-contained (starts its own wrangler/Chrome) run it directly:
   `node tools/<suite>.cjs`. T2 suites need no server — they spawn
   wrangler dev on their own port. T1 suites are pure-static.
3. **Fix the HARNESS when the app changed under it, not the app.** Every
   time a wave changes an app flow, stale harnesses fail first. Known
   stale-check family (Phase 1/2/3 waves): exact `<body class="...">`
   matches (use `/\bclass/` word-boundary regexes), and any harness that
   unlocks the admin gate via `adminSetupPassword` and expects rows
   immediately — Phase 2's show-once recovery modal (#rc-om) parks the
   panel until `#rc-saved-cb` is checked + `confirmRecoverySaved` clicked,
   so poll-dismiss it (see `tools/verify-controls-admin.cjs` S3).
4. **Verify locally green → commit → push → POLL the Actions API**
   (`status/completed`) until the run finishes, and re-enter the loop if
   a NEW step fails. Do NOT assume a green push; the run is the truth.
5. **`npm run verify` + T1 gates locally** catch most static breakage
   before CI burns a cycle (qa-dashboard-spec, qa-changelog-diffs,
   qa-ai-relay, verify-report-issue, verify-dynamic-labels,
   verify-delegate-gate, verify-render-exports, wrangler dry-run).
6. **Record the fix in the tracker** (PLANNING-TODO-2026-09-03.txt) —
   commit message + which harness/app contract changed — so future waves
   don't re-break the same gate.

Latest CI state (2026-09-04): GREEN on 1339a3f after fixing
qa-dashboard-spec (has-dock body class) + verify-cloud-autosave-signin
C3 (recovery-modal poll). Check the API before trusting this line.

## Editing workflow

1. Identify which skills apply (table above) and load them.
2. Follow the loaded skills' rules exactly.
3. Make minimal, convention-respecting changes.
4. Verify: `npm run verify` + targeted `qa-*.cjs` / `tools/qa-*.cjs` harnesses.
