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
   (`skeptical-code-audit`, `universal-ui-architect`) are registered with hashes
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

## Editing workflow

1. Identify which skills apply (table above) and load them.
2. Follow the loaded skills' rules exactly.
3. Make minimal, convention-respecting changes.
4. Verify: `npm run verify` + targeted `qa-*.cjs` / `tools/qa-*.cjs` harnesses.
