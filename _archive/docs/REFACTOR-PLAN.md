# My MaNaGeR — CI + worker.js Split Plan

Two fixes, ordered by leverage: get CI running first (so every change after this point is actually checked), then split the monolith.

---

## Part 1 — CI Workflow

### The problem right now
`predeploy: npm run verify` only runs if you deploy through `npm run deploy`. If you or an agent session runs `npx wrangler deploy` directly, or just forgets, nothing checks anything. The ~30 `qa-*.cjs` scripts you've built are good — but a test that never runs isn't protecting you.

### The fix
Add `.github/workflows/ci.yml`. It runs on every push and PR, before anything reaches production.

```yaml
name: CI

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

      - run: npm install --ignore-scripts --no-audit --no-fund

      # Static checks — no live Cloudflare bindings needed
      - run: npm run verify:csp
      - run: npm run verify:sw
      - run: npm run verify:hidden
      - run: npm run verify:skills

      # Add QA scripts here ONE AT A TIME as you confirm each is
      # safe to run headless / without live D1 or R2 bindings.
      # - run: node qa-focus.cjs
      # - run: node qa-typing.cjs
```

### Why this specific shape
- **Split `verify` into individual steps, not one `npm run verify` call.** If `verify:csp` fails, you still see whether `verify:sw` and `verify:hidden` would have passed too — one failing check doesn't hide the others. With one combined step you only ever see the first failure.
- **`--ignore-scripts` on install** matches what your own `deploy` script already does — consistency between what CI checks and what actually ships.
- **Starts with only the 4 static `verify:*` scripts, not the QA suite.** Several of your `qa-*.cjs` files (`qa-cloud-phase1.cjs`, `qa-oauth.cjs`, `qa-drive-smoke.cjs`, etc.) almost certainly expect a running dev server, live D1, or real Google/AI credentials — they'll just fail or hang in CI as-is. Don't dump all 30 in at once; you'll get a wall of red and stop trusting the pipeline. Add them one at a time, confirming each is either mockable or genuinely CI-safe (e.g. ones using `serve.cjs` + a local wrangler dev instance with test bindings).
- **Branch trigger is `main` only for push, plus all PRs.** Cheap to run, catches regressions before merge instead of after.

### Rollout order
1. Add the workflow above with just the 4 `verify:*` steps. Get it green.
2. Pick 2–3 QA scripts that are pure logic / DOM checks with no external service dependency (candidates from what I saw: `qa-focus.cjs`, `qa-typing.cjs`, `qa-rhythm.cjs` — worth checking each one's setup requirements first).
3. For scripts needing D1/R2 (`qa-cloud-*.cjs`), either add a `wrangler dev` step with local/test bindings in CI, or explicitly mark them "manual only" in a comment so it's a decision, not a gap nobody noticed.
4. Once stable, make the workflow a **required check** in GitHub branch protection settings for `main` — this is what actually stops an unverified change from merging, not just running the workflow.

---

## Part 2 — Splitting worker.js (4,508 lines → router + modules)

### The problem right now
Auth, billing, AI proxying, cloud sync, admin, and reviews all live in one file. Every change risks touching code near an unrelated feature. Diffs are noisy, merge conflicts (even with yourself across sessions) are more likely, and it's hard to hold "what does the auth flow do" in your head without scrolling past 4,000 unrelated lines.

### Target structure

```
worker.js                  # router only — ~200-300 lines
src/
  lib/
    http.js                # json(), cloudForbidden(), cloudTimingSink(), header injection
  auth/
    session.js              # register, login, password change/verify, session response
    email.js                 # Resend integration, verify-email templates
  cloud/
    projects.js              # create/save/load/recover/meta/unlink/list/delete/restore/purge
    editors.js                # editor codes: create/list/revoke, code lookup
    changelog.js              # list/revert/import
    sync.js                    # broadcast, auto-broadcast, offline copies, prefs
  reviews.js                    # reviews create/list/accept/reject
  admin.js                       # admin cloud list, cloud sections
  ai-proxy.js                     # handleAiChat — the BYO-key provider relay
  billing.js                       # LemonSqueezy integration
```

### Example: what worker.js looks like after

```js
// worker.js
import { withSecurityHeaders } from './src/lib/http.js';
import * as auth from './src/auth/session.js';
import * as projects from './src/cloud/projects.js';
import * as editors from './src/cloud/editors.js';
import * as aiProxy from './src/ai-proxy.js';
// ...etc

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/auth/login')            return auth.handleAuthLogin(request, env);
    if (pathname === '/api/auth/register')          return auth.handleAuthRegister(request, env);
    if (pathname === '/api/ai/chat')                  return aiProxy.handleAiChat(request, env);
    if (pathname.match(/^\/api\/cloud\/projects\/[^/]+$/))
      return projects.handleCloudLoad(request, env, extractId(pathname));
    // ... rest of routes

    // fall through to static ASSETS binding
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  }
};
```

### Example: one extracted module

```js
// src/ai-proxy.js
export async function handleAiChat(request, env) {
  const { provider, key, messages } = await request.json();

  const url = providerUrl(provider);
  const headers = provider === 'anthropic'
    ? { 'Content-Type': 'application/json', 'x-api-key': key }
    : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };

  const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ messages }) });
  return new Response(upstream.body, { status: upstream.status });
}

function providerUrl(provider) {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1/chat/completions';
    case 'google-gemini': return 'https://generativelanguage.googleapis.com/v1/models/gemini:generateContent';
    case 'anthropic': return 'https://api.anthropic.com/v1/messages';
    default: throw new Error('unknown provider');
  }
}
```

### Why split it exactly this way (by domain, not by size)
- **Grouped by feature, not evenly by line count.** A "split every 500 lines" approach would cut functions in half across arbitrary boundaries. Grouping by domain (auth, cloud/projects, billing) means each file answers one question — "how does login work" lives entirely in `auth/session.js`.
- **`lib/http.js` pulled out separately** because `json()`, `cloudForbidden()`, and the security-header injection are used by *every* other module. Keeping shared utilities isolated avoids circular imports between domain files.
- **`cloud/` split into 4 files instead of 1** (`projects`, `editors`, `changelog`, `sync`) because this was your single largest cluster of handlers. One `cloud.js` would just recreate the monolith problem inside cloud logic specifically.
- **`billing.js` isolated on its own** — payment code touching money should be the easiest thing in the repo to locate, review, and audit independently. You don't want billing logic buried in the middle of a 4,000-line file where a reviewer might miss it.
- **Router in worker.js does only routing** — no business logic. This means the entry point stays readable as a map of "URL → handler," and you can see your entire API surface in one scroll.

### How to do this safely
1. **Commit current state first.** Clean baseline.
2. **One pure move per commit, no logic changes.** E.g. commit 1: extract `ai-proxy.js`, update the one import in worker.js, nothing else changes. This keeps `git bisect` useful — if something breaks later, you can tell whether it broke from the move or a later logic change.
3. **Run the CI workflow from Part 1 after every extraction commit.** This is exactly why CI needed to come first — the split is much safer with an automated check confirming nothing broke at each step, instead of manually re-testing 15 route groups by hand.
4. **Order of extraction (lowest-risk first):** `billing.js` and `ai-proxy.js` (self-contained, few dependents) → `reviews.js` and `admin.js` → `cloud/*` (most interconnected, do last, and split into the 4 sub-files one at a time rather than all at once).
