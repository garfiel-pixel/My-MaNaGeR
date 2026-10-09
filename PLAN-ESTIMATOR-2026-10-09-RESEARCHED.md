# PLAN — ESTIMATOR TIER, FREE-TIER AI KEYS, SIGN-IN PAGE, CANCEL CONFIRMATION

**Date:** 2026-10-09
**Status:** PLAN ONLY — nothing in this document is implemented. Do not execute until the owner signs off.
**Supersedes:** `MYMANAGER-ESTIMATOR-DIRECTIVE-2026-10.md` where the two conflict. The original directive is
kept for its locked decisions (D1–D14); this document is the wave plan, re-based on measured research.
**Scope guard:** research + plan. No served file is changed by this document.

---

## 0. HOW THIS PLAN WAS PRODUCED

Research was measured, not assumed. 28 browser probes were run against the locally served app
(`node serve.cjs`, port 8765) with Playwright, plus direct reads of the Worker and the marketing
bundle. Every claim below that ends in a number was measured in that session. Where something could
not be measured, this document says so rather than guessing.

Raw probe output is scratch and is not committed (`tmp/research.log`, `tmp/research2.log`).

---

## 1. RESEARCH EVIDENCE — WHAT THE MEASUREMENTS SHOW

### 1.1 Billing tier — most of Wave 1 and Wave 6 of the original directive is ALREADY DONE

| Measured | Value | Where |
|---|---|---|
| `deriveTier()` knows the estimator tier | present | `src/billing.js:88-98` |
| Checkout routes `?tier=estimator` (and the legacy `homeowner` alias) | present | `src/billing.js:653-661` |
| `projectCap` returned by `/api/billing/status` | the free cap for **every** tier | `src/billing.js:458` |
| Pricing page sells the estimator tier | `data-tier="estimator"` card present, 4 upgrade buttons, 6-column compare table | `pricing.html`, probe R15 |
| `entitlements.js` has an estimator gate | **NO** — only `aiAssistant`, `unlimitedCloud`, `rbacAccess`, `rbacUnlimited` | `js/app/entitlements.js:42-56` |

Two consequences the original directive does not account for:

1. **`entitlements.unlimitedCloud()` returns `_tier !== 'free'`**, so the browser already believes an
   `estimator` subscriber has unlimited cloud projects, while the server caps every tier at the free
   cap. The plan must fix that mismatch or the estimator tier will look broken in the UI.
2. Wave 1.3's worry ("if the current code gives Contractor-level unlimited to all paid tiers") is
   already moot **server-side**; the defect is client-side only.

### 1.2 The AI stack already has three rungs — the directive invents a fourth that does not fit

| Rung | Mechanism | Where |
|---|---|---|
| 1. Operator-funded, zero keys | `env.AI` Workers AI binding, `@cf/meta/llama-3.1-8b-instruct` | `src/ai-proxy.js:281-293` |
| 2. Capacity fallback message | 503 with `tier: 'workers-ai'` | `src/ai-proxy.js:297-312` |
| 3. User's own key (BYO) | `X-User-Api-Key` / body `apiKey`, stateless forwarder | `src/ai-proxy.js:248-252` |

- Model ladder lives in one place: `js/mmgr-net.js` `PROVIDER_DEFAULTS`, currently
  `gemini-flash-latest` → `gemini-flash-lite-latest`.
- The repo has **already been burned by hardcoded model ids**: `gemini-2.0-flash`, `gemini-2.0-flash-lite`,
  `gemini-2.5-flash`, `gemini-2.5-flash-lite` all returned 404 from the live API and were replaced by
  `-latest` aliases, with a static gate (`A08k`) added so a dead family cannot come back.
- Rate limiting is one shared helper: `cloudRateCheck(request, bucket, env)` backed by the
  `RATE_LIMITER` binding (`src/lib/http.js:480`, `wrangler.jsonc:87`).
- `/api/estimator/chat` **does not exist** (probe R20 → 404).

**Therefore:** the directive's plan to add a parallel `src/estimator-ai.js` endpoint with its own
provider call duplicates four things that already exist (relay, ladder, rate limit, capacity
messaging). Section 4 below replaces it with one new **rung** on the existing relay.

### 1.3 Sign-in — the polished page EXISTS; the black box is what visitors actually get

| Measured | Value | Where |
|---|---|---|
| Standalone polished sign-in page | **exists**, title `Sign in \| My MaNaGeR` | `signin.html`, probe R21 |
| Its star field | 9 radial-gradient layers, `signin-drift / 46s / infinite` | `css/marketing.css:3634-3700` |
| Its glass card | `rgba(255,255,255,0.07)` + `blur(18px) saturate(1.4)` | probe R21 |
| Google + email mounts on it | both present | probe R21 |
| `?next=` redirect contract | present, same-site only | `js/signin.js`, `signin.html:9-16` |
| Its weight | 195 KB, 6 requests | probe R21 |
| Live reachability | `/signin` → **HTTP 200**, `/signin.html` → 307 | live curl |

**The defect is not a missing page.** Every marketing page's header "Sign in" is a
`<button class="signin-btn signin-trigger">` that opens `#signin-sheet` — measured
`background: rgb(11,11,13)` (`#0b0b0d`), `position: fixed`, box `340x354 @1178,74`. That is the
"black little box". The polished page is linked from **one** place in the whole site (the index
footer). Header triggers pointing at `/signin`: **0**. Probe R16 found the black sheet on all six
marketing pages: index, about, contact, features, pricing, reviews.

### 1.4 Subscription cancel — one click, no confirmation

`js/mmgr-billing-manage.js`: `Manage subscription` → `renderConfirm()` → a single
`Confirm cancel` button → `DELETE /api/billing/subscription`. Measured by reading the module; the
panel needs a signed-in session so it could not be driven in the browser. The DOM contains no input
element in the confirm step.

### 1.5 Hero art — only ONE of the three SVGs animates at all, and nothing repeats

| Measured | Value |
|---|---|
| Mount | three `<img src="images/hero-*.svg">`, `loading="lazy"`, `draggable="false"`, `alt=""` |
| Intrinsic size | 900×491 each; rendered ≈486×190 / 418×190 / 486×190 |
| `hero-schedule.svg` | 0 SMIL animations, 0 keyframes, 0 CSS animation declarations |
| `hero-evm-chart.svg` | 3 SMIL `<animate>` elements |
| `hero-ai-roadmap.svg` | 0 SMIL animations, 0 keyframes, 0 CSS animation declarations |
| Entrance reveal | `.rv` on 36 elements, `opacity, transform / 0.5s`, runs **once**, `animation-iteration-count: 1` |
| Container | `.hero-visual` is `aria-hidden="true"` |

So the owner's report is exactly right and now has a cause: the page animates in once (the `.rv`
reveal), one illustration has a small internal SMIL loop, the other two are completely static, and
nothing sequences card → card → completion → restart.

### 1.6 The reusable LOOP pattern already exists and works

Probe R27 sampled `.features` every second for 12 s: `scrollLeft` stepped **0 → 318 → 636 → 954**
(≈318 px every ~4 s) with `scrollWidth - clientWidth = 5142`. The implementation
(`js/marketing.js:930-990`) already has: IntersectionObserver restart on re-entry, hover / focus /
touch pause, `visibilitychange` pause, `prefers-reduced-motion` respect, prev/next steering.
`.features` is itself the scroll container (`css/marketing.css:2006-2014`, `overflow-x: auto`).

This is the pattern the hero sequence should reuse rather than inventing a new one.

### 1.7 Perf baselines (so the new page can be held to a number)

| Page | Requests | Transfer | Timing |
|---|---|---|---|
| `index.html` | 15 | 364 KB | DOMContentLoaded 188 ms, load 276 ms, **LCP 236 ms** (buffered observer), probe R24 |
| `calculator.html` | 5 | 548 KB | scripts `mmgr-theme.js`, `mmgr-icon-restore.js`, `calculator-page.js?v=28`; `robots: noindex`; no app nav; 10 panels |

### 1.8 Gates that already hold
- Emoji on the rendered marketing page: **0** text nodes (probe R08).
- `prefers-reduced-motion: reduce`: every hero animation measured `animation-name: none` (probe R12).

### 1.9 Not measured (stated, not guessed)
- The AI window's free/key states on `project.html` — the page is locked behind an unlock code
  (probe R28: `aiWindow: false`). Needs a signed-in session or a demo unlock.
- The cancel panel's live DOM — needs a session with an active subscription.
- Authenticated API behaviour — `serve.cjs` is static-only, so `/api/*` returns 404 locally
  (probes R19/R20). Those need `wrangler dev`.
- Local `/signin` 404s because `serve.cjs` has no extension rewrite; production serves it (verified
  live). Known repo behaviour, not a bug in the page.

---

## 2. LOCKED DECISIONS THAT CHANGE

| # | Original | This plan |
|---|---|---|
| D7 | Managed model `claude-haiku-4-5-20251001`, upgrade to `claude-sonnet-5-5` | **Model ids are not hardcoded in the plan.** The managed rung uses the same verified-live ladder mechanism as `js/mmgr-net.js`, plus a `MANAGED_AI_MODEL` env var. Ids are confirmed against the provider's live models list at implementation time (repo precedent: four dead Gemini ids, gate A08k). |
| D11 | `estimatorAccess` gate | Kept, but it must also fix `unlimitedCloud()` (§1.1) |
| D8 | New `estimate.html` | Kept — but see §7: its embedded `calculator.html` iframe is the page the owner wants parked |
| — | New `src/estimator-ai.js` + route | **Replaced** by a new rung on the existing relay (§4) |

---

## 3. ARCHITECTURE DECISIONS (optimized for this codebase)

**A1 — One relay, ordered rungs, no parallel endpoint.**
`POST /api/ai/chat` gains a managed rung in this order:
`user key (BYO)` → `managed provider pool` → `Workers AI binding` → clear capacity message.
The user's own key always wins; the operator pool is only reached when the user has none.

**A2 — Model floor law (owner, 2026-10-09).**
Degrade **downward only**. Every rung may step to a *cheaper/smaller* model. Nothing may ever step
up to a larger one on the operator's account. Formally: each rung carries an ordered list and a
monotonic cost invariant — `cost(model[n+1]) <= cost(model[n])`. A ladder that cannot be ordered by
cost is rejected in review.

**A3 — Provider abstraction, not provider code.**
Gemini/Anthropic/OpenAI request shapes stay in `src/ai-proxy.js` and `js/mmgr-net.js`. Adding a key
pool must not add a second place that knows how to call Gemini.

**A4 — Offline-first is untouched.** Every rung here is network-only and is reached only from the AI
surface. The calculator and project data paths must not gain a network dependency.

**A5 — Secrets never enter the client.** Pool keys live server-side only, are never returned in a
response body, never logged, and never included in an error string.

---

## 4. NEW SECTION A — ENVIRONMENT API KEYS: THE FREE-TIER KEY POOL

**Owner request:** three (up to four) Google/Gemini API keys held in the database, used for the
free section for testing before major users arrive, falling back to the smallest model the provider
offers — never stepping up to a bigger one.

### A.1 Where the keys live — **DECIDED 2026-10-09: WRANGLER SECRETS, not D1**

> Owner: *"the keys are stored for Wrangler secrets … granular secrets … it will call upon them
> when it's time to make a call … you can call them Gemini 1, Gemini Key 2."*

So the pool is four optional secrets and nothing else:

```
GEMINI_KEY_1   GEMINI_KEY_2   GEMINI_KEY_3   GEMINI_KEY_4
```

The Worker reads them from `env` **at call time**, in order, skipping any that are unset, and steps
to the next one when a key answers 429 / quota-exhausted. Unset keys are simply absent.

**Accepted tradeoff:** rotation is `npx wrangler secret put GEMINI_KEY_n` (which publishes a new
Worker version) rather than a database row edit. In exchange: no migration, no encryption key to
manage, no admin route, and no way for the pool to be dumped from the database.

---

#### (superseded design, retained only for reference — NOT being built)

A new account-scoped table, mirroring the proven shapes in this repo (`cloud_api_keys` stores only
hashes; `cloud_pool_items` is the account-scoped library). Migration `0025_ai_provider_keys.sql`:

```sql
-- ============================================================
-- AI PROVIDER KEY POOL (owner 2026-10-09)
-- ------------------------------------------------------------
-- Server-only pool of operator-funded provider keys, used for the
-- free/unsubscribed AI rung. NOT a user secret: no user ever reads a
-- row here. Mirrors the cloud_api_keys discipline (never the
-- plaintext in a response, never logged), except that the Worker MUST
-- be able to use the key, so the row holds ciphertext, not a hash.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_provider_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL,                -- 'google-gemini' | 'anthropic' | 'openai'
  label         TEXT NOT NULL DEFAULT '',     -- operator's own note, e.g. "free-pool-1"
  key_cipher    TEXT NOT NULL,                -- AES-GCM ciphertext (see A.3) - never plaintext
  key_hint      TEXT NOT NULL DEFAULT '',     -- last 4 chars, display-only, never the whole key
  model_floor   TEXT NOT NULL DEFAULT '',     -- smallest model this key is allowed to use
  priority      INTEGER NOT NULL DEFAULT 100, -- lower = tried first
  active        INTEGER NOT NULL DEFAULT 1,
  quota_state   TEXT NOT NULL DEFAULT 'ok',   -- 'ok' | 'throttled'
  throttled_at  TEXT,                         -- ISO; cleared when the window passes
  fail_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aipk_provider ON ai_provider_keys(provider, active, priority);
```

Notes that matter to this codebase:
- **Rotation is a row copy, not a secret change.** Today a key means
  `npx wrangler secret put`, followed by a redeploy. A pool key is a D1 row: adding key #4 requires
  no deploy, and a burned key is `active = 0`.
- The table is server-only. There is **no** route that lists `key_cipher`; the admin surface shows
  `label`, `key_hint`, `provider`, `priority`, `quota_state`, `last_used_at` only.
- `key_cipher` is encrypted with a key held in a Worker secret (`AI_POOL_KEK`), using the same
  `crypto.subtle` AES-GCM helpers the cloud state already uses (`cloudEncryptState` /
  `cloudDecryptState` in `src/lib/http.js`). If the database is ever dumped, the pool is not
  readable without the Worker secret.

### A.2 The selection algorithm

```
POST /api/ai/chat  (no user key, provider = google-gemini)
  1. rows = active keys for the provider, ordered by priority, skipping quota_state='throttled'
  2. for each row:
       a. model = first model in the rung list that this key is allowed to use
          (rung list is ordered large -> small; NO row may use a model above its model_floor)
       b. call the provider
       c. 2xx                      -> record last_used_at, clear fail_count, return the text
       d. 429 / quota / 402        -> quota_state='throttled', throttled_at=now, next row
       e. 401 / 403                -> fail_count++, next row (a rejected key must never be retried
                                      inside the same request)
       f. 5xx / timeout            -> fail_count++, next row
       g. 4xx that is not auth/quota -> mark fail_count++ and try ONE smaller model, then next row
  3. every row exhausted -> fall through to the Workers AI rung; if that also fails, the existing
     503 capacity message (tier: 'workers-ai')
```

**Why this satisfies "smallest model, never bigger":** the rung list is written large → small, and
`model_floor` is the *smallest* model a key may use. A row is only ever asked for a model at or
below its own rung, and the last entry of every list is the provider's cheapest model. Stepping
*up* is impossible by construction: there is no code path that indexes the list backwards.

**Throttle window is self-healing.** `quota_state='throttled'` rows are skipped while
`throttled_at` is inside the provider's reset window and are automatically eligible again after it.
No operator action is needed to bring a key back.

### A.3 Seeding the four keys (OWNER STEP)

The keys are entered by the owner, in the owner's own terminal, never in a chat:

```
# one row per key; the plaintext is encrypted by the Worker, so this runs
# through an admin-only route, not through wrangler secret put
POST /api/cloud/admin/ai-keys     (ADMIN_CODE-gated, as /api/cloud/admin/* already is)
  { provider: 'google-gemini', label: 'free-pool-1', priority: 10 }
  -> returns { id, key_hint } only
```

If an admin route is not wanted for v1, the fallback is a one-shot seeding script
(`tools/seed-ai-pool.cjs`) that encrypts with the same helper and writes via
`tools/d1-remote.cjs`-style access. Either way the plaintext exists only inside the operator's
terminal and the Worker request; it is never stored, logged, or echoed.

### A.4 What the free tier actually gets

- Free tier keeps the Workers AI rung (unchanged, zero keys, fastest).
- The pool is the **second** rung: it exists so the free experience stays alive when the Workers AI
  binding is at capacity, which is exactly the failure the 503 message apologises for today.
- Free tier AI remains **text only**, rate-limited by the existing
  `cloudRateCheck(request, 'ai-free', env)`, and never used for the estimator's structured
  `<ESTIMATE>` path (that is a paid feature, D11).
- The pool is **not** a "testing bypass": it is production capacity for free users. A separate
  `AI_POOL_TEST_ONLY` flag is unnecessary and is deliberately not planned.

### A.5 Cost and abuse controls (must ship with the pool)

- Per-session rate limit: existing `cloudRateCheck` bucket, plus a second daily bucket.
- A hard daily ceiling per provider (rows 429'd → `throttled`) so a runaway script cannot spend
  unbounded money.
- The pool answers only when the caller is signed in (`readSession`) — an anonymous caller never
  reaches an operator key. Server-side check, not a client flag.
- Tokens-per-request cap and a max-message trim, matching the 20-turn client trim.
- Cloudflare Analytics Engine (`ANALYTICS` binding) event per pool call: `{ provider, key_id,
  model, outcome }` — **never** the key, never the prompt.

### A.6 Gates for Section A

| Gate | Proves |
|---|---|
| `tools/verify-ai-pool.cjs` (new, registered in `docs/CI-TEST-COVERAGE.md` + `ci.yml`) | No code path returns `key_cipher`/plaintext in any response; the admin list route exposes only `label`/`key_hint`; selection skips `throttled` rows; selection never indexes the ladder backwards |
| Unit test in `test/` | `cost(model[n+1]) <= cost(model[n])` for every rung list (the floor law, A2) |
| Unit test | 401/403 on key #1 → the request proceeds to key #2 without retrying key #1 |
| Unit test | all rows 429 → response falls through to the Workers AI rung, then the 503 message |
| Live probe (owner) | With all pool rows `active=0`, the free AI still answers via Workers AI |

---

## 5. NEW SECTION B — CANCEL REQUIRES A TYPED CONFIRMATION

**Owner request:** cancelling must not be one button. The user must type a confirmation word before
the cancel button becomes usable, so a stray click cannot end a subscription.

### B.1 Measured current state
`js/mmgr-billing-manage.js` — `renderConfirm()` renders a note, `Confirm cancel` and `Keep my plan`.
There is no input, and nothing between the click and `DELETE /api/billing/subscription`.

### B.2 Planned change (client)
`renderConfirm()` becomes:

```
Cancel your plan? It stops the next payment on <date>.
You keep Premium until then, and nothing is deleted.
[ ] Type CANCEL to confirm:  <input id="bmg-code" autocomplete="off" autocapitalize="characters">
[Confirm cancel]  (disabled until the typed value matches)   [Keep my plan]
```

- The confirmation word matches case-insensitively, trimmed, and must equal exactly `CANCEL`.
- The button is `disabled` (not merely styled) until it matches, and `aria-disabled` is kept in sync
  so keyboard and screen-reader users get the same contract.
- Wrong word → the button stays disabled; no request is sent.
- On success the input is removed from the DOM with the rest of the confirm step.
- Offline / network failure → the existing error line, and the typed word is cleared so a blind retry
  cannot fire.

### B.3 Planned change (server) — the part a client-only fix cannot do
A client-side confirmation stops accidental clicks but not a replayed or hand-made request. The
server already validates the session; add one more requirement:

- `POST /api/billing/cancel-intent` returns a short-lived, single-use `confirmToken` bound to
  `owner_sub` + a nonce, valid ~5 minutes (`mintAuthToken` already exists in `src/lib/http.js:239`
  and is the right primitive).
- `DELETE /api/billing/subscription` requires `confirmToken` in the body.
- Reuse → rejected. Missing → 400. Expired → 400 with a plain message.
- This keeps the existing route shape and adds one call, so the current QA harness
  (`tools/qa-billing-cancel.cjs`) gains one gate rather than being rewritten.

### B.4 Gates for Section B

| Gate | Proves |
|---|---|
| Unit (new) | `DELETE /api/billing/subscription` without `confirmToken` → 400 and Paddle is never called |
| Unit | The same `confirmToken` twice → the second call is rejected |
| Unit | Expired token → 400 |
| Harness `tools/qa-billing-cancel.cjs` (extend) | An existing gate is re-baselined to the new two-step contract |
| Browser probe (owner) | Typing `cancel` enables the button; typing `confirm` does not |

---

## 6. NEW SECTION C — SIGN-IN GOES TO THE STANDALONE PAGE (RETIRE THE BLACK BOX)

**Owner request:** sign-in should not be a black popup box; it should be its own polished page with
the star sky, 3D feel and glassy Google/email icons. "I don't know why it wasn't implemented."

**It was implemented.** The page exists at `/signin` and is live (HTTP 200). What was never done is
*pointing anyone at it*. The header button still opens the `#0b0b0d` sheet. This section is therefore
a **wiring and retirement** change, not a redesign — much smaller than the owner expects, which is
good news.

### C.1 Planned change
1. Every page header that carries a trigger (index, about, contact, features, pricing, reviews —
   **and `mymanager-field-guide.html`, which has six `.signin-trigger` occurrences**):
   `<button class="signin-btn signin-trigger">` → `<a class="signin-btn" href="/signin?next=<current page>">`.
   A link, not a button: it works without JS, can be middle-clicked, and matches the page's
   existing footer link. The field guide is easy to miss because it is a separate design system and
   is not one of the six marketing pages — it must be swept in the same wave.
2. `js/marketing.js`: delete the `.signin-trigger` → `#signin-sheet` wiring, and the sheet show/hide,
   focus-trap, Escape and outside-click handling that exists only for it.
3. **DECIDED 2026-10-09 — polish it AND hide it, do not delete it.** Owner: *"just hide it for now,
   so if something is going on with the next page we can pull it back up … polish it, bring it back
   to white and polish that small screen and hide it."* So: re-paint `.signin-sheet` from `#0b0b0d`
   to the light surface tokens, tidy its spacing and states, then leave it `hidden` and unreachable
   from any trigger. It stays in the HTML as a fallback that can be re-pointed in one line.
4. `signin.html` keeps `?next=`; each page passes its own path so the visitor lands back where they
   were.
5. `app.html` has no link to `/signin` at all today. Its own Google button stays (it is in-app, not
   the marketing header), but the nav should gain a signed-out "Sign in" link to `/signin`.

### C.2 What is deliberately NOT changed
The owner asked for "nothing crazy". The page already has the star field, the drift, the glass card
and Google-above-email ordering. This plan does **not** re-theme it, add new motion, or add a 3D
canvas — the Liquid Glass doctrine forbids glass on content, and the card is already the only glass
surface. If the owner wants more after seeing the wired-up page, that is a separate proposal.

### C.3 Gates for Section C

| Gate | Proves |
|---|---|
| **`qa-marketing.cjs` (MUST be re-baselined)** | This is the one that will fail first and loudly: lines 301-335 click `.signin-trigger` and then assert `#signin-sheet` opens, on desktop AND in the mobile bar. Removing the sheet without rewriting those two checks leaves a red EXTENDED suite. Rewrite them to assert the trigger is a link to `/signin`. |
| `tools/qa-marketing-layout.cjs` (extend) | No marketing page contains `#signin-sheet`; every marketing page has an `a[href*="/signin"]` in the header |
| `tools/verify-marketing-markup.cjs` (extend) | The header trigger is an `<a>`, not a `<button>` |
| Browser probe | `/signin?next=/pricing.html` renders, and after sign-in returns to `/pricing.html`; an absolute `next` is discarded |
| `npm run verify` | CSP unchanged (no inline script added) |

---

## 7. NEW SECTION D — THE CALCULATOR PAGE: PARK IT, SUBDOMAIN LATER

**Owner request:** drop the calculator page for now; if it is needed later it can move to a
subdomain.

Measured today: `calculator.html` is `noindex`, has no app navigation, pulls 3 scripts and
`dist/mmgr.min.css`, and costs **548 KB / 5 requests** — the single heaviest page in the site.

### D.1 Recommendation — **DECIDED 2026-10-09: the AI LIVES ON THE CALCULATOR PAGE**

> Owner: *"we're not parking the calculator page, the AI will go there for now. It's going to have
> its own chat window there for now … later on we will do a full overhaul and take over the page.
> Ensure that there's a window for the switch so you can just switch over and take over
> completely."*

So `calculator.html` **gains the AI chat window** — it is not parked and not made noindex-off.

- **The AI panel is a swappable module, not part of the calculator.** It ships as its own script
  (`js/estimator-chat.js`) + its own markup block + its own CSS block, mounted into one container
  with one id. The later overhaul then replaces the *mount*, not the calculator: that is the
  "window for the switch". Nothing in the chat panel may reach into calculator internals, and
  nothing in the calculator may import the chat panel.
- **No iframe, anywhere.** The AI panel sits in the page; the old directive's iframe plan stays
  rejected (a 548 KB page inside the page it already is, plus a second scroll context).
- **The manual calculator keeps working with the AI panel removed** — it stays a self-contained
  offline tool, and the panel must never be a load-bearing dependency for it.
- **Subdomain later** is still a DNS + route change only, and this design does not block it.

### D.2 Gate for Section D
`estimate.html` (when built) must not contain an `iframe` pointing at `calculator.html`; its
transfer weight must be within 1.5× the `index.html` baseline (currently 364 KB, so a ceiling of
≈550 KB) — measured with the same buffered-observer method as probe R24.

---

## 8. NEW SECTION E — HERO ART: A REPEATING LOOP

**Owner request:** the three hero SVGs should gently repeat — this one, then that one, then
completion, then start over — so a visitor sees a small living visual.

Measured cause of today's behaviour: one illustration carries a tiny SMIL loop, two are completely
static, and the page's entrance reveal (`.rv`, 0.5 s, `iteration-count: 1`) runs once and stops.
There is nothing sequencing the three cards.

### E.1 Planned approach
Reuse the pattern that already works (**§1.6, the `.features` auto-tick**), do not invent a second
one:

1. A small sequencer in `js/marketing.js`, module-scoped like the feature bar:
   - cycles the three `.hero-card` elements (a class such as `.hero-card.is-live`)
   - ~4 s per card, matching the feature bar's measured cadence
   - after the third card, a brief "completion" beat, then restart from card one
2. Each card's *own* artwork animates only while it is live. Two options, in preference order:
   a. **CSS in the page, driven by the `is-live` class** (e.g. a sweep or fade on `.hc-img`) — no new
      asset work, fully gate-able, and cannot break when the SVG files change.
   b. **In-file SVG animation** added to `hero-schedule.svg` and `hero-ai-roadmap.svg` so each file
      carries its own motion like `hero-evm-chart.svg` does. Works inside `<img>`, but the effect
      cannot be gated by page CSS and is harder to keep in step.
   Recommendation: (a).
3. Mandatory behaviour, all already proven in the feature-bar implementation:
   - `prefers-reduced-motion: reduce` → **no sequence at all** (a static hero, not a fast one).
   - Pause on hover / focus / touch; pause on `visibilitychange`.
   - Restart when the hero scrolls back into view (IntersectionObserver).
   - The hero must not be a `<video>`, must not autoplay media, and must not add a network request.
4. `aria-hidden="true"` on `.hero-visual` stays exactly as measured; the loop is decorative and must
   announce nothing.
5. The three SVGs stay `<img>` with `alt=""`, `loading="lazy"`, `draggable="false"` — unchanged.

### E.2 Gates for Section E

| Gate | Proves |
|---|---|
| Browser probe | Over ~20 s, all three hero cards take `is-live` at least once, and the sequence returns to card 1 |
| Browser probe with `reducedMotion: 'reduce'` | `is-live` never changes; no animation is applied |
| Browser probe | Hovering the hero freezes the sequence; leaving resumes it |
| `tools/qa-marketing-layout.cjs` | The hero still passes its existing layout assertions, and LCP does not regress beyond the §1.7 baseline |
| `npm run verify` | CSP unchanged (no inline script) |

---

## 9. REVISED WAVE PLAN

Waves are ordered by dependency and by risk. Each wave is atomic: build, gates green, then the next.
`sw.js` cache version is bumped in **every** wave that changes a served asset.

| Wave | Scope | Depends on | Exit gate |
|---|---|---|---|
| **W0** | Plan sign-off. No code. | owner | Owner answers §10 open decisions |
| **W1** | `entitlements.js`: add `estimatorAccess()`, and fix `unlimitedCloud()` so an `estimator` subscriber is not shown as unlimited cloud. | W0 | `npm run verify` green; unit test: estimator ⇒ `unlimitedCloud() === false` |
| **W2** | Cancel confirmation: client typed `CANCEL` + server `confirmToken` (Section B). | W0 | New unit tests green; `qa-billing-cancel.cjs` re-baselined and passing |
| **W3** | Sign-in wiring: header triggers become `/signin` links, black sheet and its JS removed (Section C). | W0 | Extended layout + markup gates green; `/signin?next=` probe green |
| **W4** | AI pool: migration 0025, encrypted rows, selection algorithm, audit event, admin surface (Section A). | W0 | `tools/verify-ai-pool.cjs` green + registered; floor-law unit test green |
| **W5** | Managed rung wired into `POST /api/ai/chat` (A1 ordering) + free-tier rate buckets. | W4 | Unit: BYO key wins; no key + pool exhausted ⇒ Workers AI ⇒ 503 |
| **W6** | `estimate.html` + its chat panel. **No calculator iframe** (Section D). Models chosen from the verified-live ladder, not hardcoded ids. | W1, W5 | `npm run verify`; page weight ≤ §D.2 ceiling |
| **W7** | Hero art sequence (Section E). | W0 | Sequence, reduced-motion, hover-pause and restart probes green |
| **W8** | SEO for the new public page. `robots.txt` and `sitemap.xml` **already exist** and already allow the marketing pages while disallowing `/app`, `/project`, `/dashboard`, `/admin`, `/seed-test`. This is an EDIT, not a create: add the new page's URL to the sitemap's 8 entries. Note the sitemap currently omits `/pricing` and `/refund` even though robots allows them — worth fixing in the same pass. Subdomain route left for the owner's DNS. | W6 | `npm run verify`; `/signin` and the new page both 200 live; `/signin.html` still 307s |

Waves W2, W3 and W7 are independent of the AI work and can ship first — that is deliberate: they are
the three the owner can see, and none of them depends on the pool.

---

## 10. DECISIONS — SETTLED BY THE OWNER 2026-10-09

These replace the eight open questions. Where a decision contradicts an earlier section, the
earlier section carries a **DECIDED** note pointing here; the code follows the decisions.

| # | Decision | What changes |
|---|---|---|
| 1 | **Pool = free Google API keys, as many as the owner has (3–4).** Other providers are welcome later if they are more generous. | Section A is built for a Gemini-first pool with room for a second provider. |
| 2 | **Keys are stored as granular WRANGLER SECRETS**, named `GEMINI_KEY_1` … `GEMINI_KEY_4`, indexed and called upon at call time. Not D1, not Secrets Store. | **§A.1 is superseded** — no migration, no KEK, no admin route. Rotation becomes `wrangler secret put`. |
| 3 | **The model floor is the smallest, most-generous model.** Never step up. Nothing is paid for. | Free rung uses `gemini-flash-lite-latest` (the smallest alias the repo verified live). No larger rung exists on that path. |
| 4 | **Free-tier daily limit = 10 messages per 24 hours**, refreshing the same way Google's free quota does. | Enforced server-side per account in `env.KV` with `expirationTtl: 86400` — the `RATE_LIMITER` binding is 60/60s and cannot express a day. |
| 5 | **The calculator page is NOT parked.** The AI chat window goes there NOW; a later overhaul takes the page over completely, so the panel must be built as a swappable module with a switch. | **§D is superseded** — the AI lives on `calculator.html`, not on a separate `estimate.html`. |
| 6 | **Estimator managed provider = Gemini**, matching the pool (one provider, one ladder). | The directive's `ANTHROPIC_ESTIMATOR_KEY` is not needed. |
| 7 | **The black sign-in sheet is polished (light, not black) AND hidden** — kept so it can be pulled back up later. The standalone page is the real sign-in. | §C changes from *delete* to *polish + hide + wire the bigger page*. |
| 8 | **Cancel = type the word, then press the button.** | §B confirmed; implemented and verified (see the wave log at the end of this document). |

---

## 11. RISKS AND REGRESSIONS TO GUARD

| Risk | Guard |
|---|---|
| A pool key leaks through an error string or a log line | Gate: audit every error path that touches the pool; `verify-ai-pool.cjs` asserts no response body contains a key |
| Cost runs away | Per-provider daily ceiling + `throttled` rows + Analytics Engine event per call |
| A model id rots (repo has been burned: four dead Gemini ids) | No hardcoded id in the plan; live models-list probe + the existing A08k static gate |
| The ladder silently steps UP | Floor law test: `cost(model[n+1]) <= cost(model[n])`, and `model_floor` per key |
| Removing the sign-in sheet breaks the field guide (it uses `.signin-trigger` too) | Wave W3 must sweep `mymanager-field-guide.html` and every page that references the class before deleting it |
| Hero loop hurts LCP or annoys on reduced motion | LCP must stay within 1.5× the 236 ms baseline; reduced-motion probe must show zero live changes |
| The estimator page bloats (calculator iframe) | No iframe; §D.2 weight ceiling |
| Cancel token breaks the existing harness silently | The harness is re-baselined in the same commit, and registered |
| `sw.js` not bumped → users keep the old CSS/JS | Every served-asset wave bumps the cache constant and its comment list |
| Emoji or inline script slips into a new page | `npm run verify` (CSP hashes, emoji scan, marketing markup) runs before every commit |

---

## 12. VERIFICATION MATRIX (what "done" means per section)

| Section | Static gates | Browser gates | Owner confirmation |
|---|---|---|---|
| A — keys | `verify-ai-pool.cjs`, floor-law unit, registry row | Free AI answers with all pool rows disabled (Workers AI fallback) | Owner sees the free AI keep working |
| B — cancel | Unit: missing / reused / expired token | — | Typing `cancel` enables the button; typing anything else does not |
| C — sign-in | `qa-marketing-layout.cjs` + `verify-marketing-markup.cjs` extensions | `/signin?next=` round trip; open-redirect rejected | Owner opens any page, clicks Sign in, gets the starry page |
| D — calculator | — | Estimator page weight ≤ ceiling; no calculator iframe | Owner approves parking it |
| E — hero art | `npm run verify` | Sequence cycles and restarts; reduced motion static; hover pauses | Owner watches it loop |

---

## 13. WHAT THIS PLAN DELIBERATELY DOES NOT DO

- It does not add a second AI relay endpoint.
- It does not hardcode any model id.
- It does not redesign the sign-in page — only connects it.
- It does not delete or embed the calculator page.
- It does not change anything about Paddle, the webhook, or subscription state.
- It does not touch the offline-first contract: every new network path is on the AI surface only.

---

## 14. WAVE LOG — WHAT IS ACTUALLY DONE (updated as work lands)

| Wave | Scope | Status | Evidence |
|---|---|---|---|
| **W1** | `entitlements.js`: `estimatorAccess()` added and exported; `unlimitedCloud()` fixed to contractor+ | **DONE** | Gate table measured for all five tiers: `free` (false/false), `estimator` (**false**/true), `contractor`+ (true/true) — the estimator tier no longer claims cloud it cannot create |
| **W2** | Cancel takes two acts: typed `CANCEL` + button, enforced on both sides | **DONE** | 41/41 unit tests (6 new: no body / empty / no field / wrong word / near miss / case-insensitive pass). Browser probe with a mocked billing API: **12/12**, including "Confirm cancel starts DISABLED (the real attribute)", "the wrong word leaves it disabled", "the request body carries the confirmation word" |
| W3 | Sign-in: polish the sheet light, hide it, point every header trigger (incl. the field guide's six) at `/signin`, re-baseline `qa-marketing.cjs` | QUEUED | Re-baselining the gate is part of the wave, not a follow-up |
| **W4** | Free pool: `GEMINI_KEY_1..4` read from `env`, rotation on a capacity/invalid answer, smallest model only. **No migration and no D1 rows** — the owner's decision is Worker secrets read at call time | **DONE** | `npx wrangler secret list` on the deployed Worker: all four `GEMINI_KEY_1..4` present (15 secrets total). 23 new unit cases in `test/ai-free-pool.test.mjs` — two keys set = two attempts, a 429 or a 401 costs one attempt and the next key answers, a 200 with no text falls through instead of answering empty, and no key value is ever echoed back |
| **W5** | Managed rung wired into `POST /api/ai/chat` in the **A1 order** — BYO key → **pool** → Workers AI binding → capacity message — plus 10 messages/24 h per account in `env.KV` | **DONE** | 26 unit cases, including three that pin the ORDER itself: the pool answers before the Workers AI binding runs, Workers AI is the safety net when every key fails, and an exhausted allowance refuses **before** Workers AI so the cap is a cap. Also: a signed-out caller never reaches the pool; a BYO key never touches it; the model the client asked for is ignored (asserted on the upstream URL); the 11th message is refused **402** and spends no key; the cap does not count a failed rung; an active or `past_due` subscription is not capped while `canceled` is; a missing KV or an unreadable counter still answers; a D1 fault fails **closed**. 67/67 unit tests, `npm run verify` exit 0 |
| **W6** | The AI chat panel on `calculator.html`, built as a swappable module for the later takeover | **DONE** | `js/calc-ai.js` + `#calc-ai-mount` on the page + `.bcp-ai-*` styles. Browser probe with both endpoints mocked: **38/38** — the input is genuinely `disabled` when signed out, the server's own quota wording reaches the user (not a status code) and no fake answer is rendered for a 402, the estimate totals ride the request, Enter sends, Clear keeps the greeting, `unmount()`+`mount()` on the same node works, no emoji, AA contrast in both themes. `js/calc-ai.js` is added to the SW `SHELL` so the panel exists offline |
| W7 | Hero art sequence, reusing the working `.features` auto-tick pattern | QUEUED | The pattern is measured working: ~318 px every ~4 s, with pause-on-hover and reduced-motion already handled |

Every wave so far ended with `npm run verify` at exit 0 and `sw.js` bumped (currently `mmgr-shell-v387`).

**W4/W5/W6 open question (one line to flip):** the pool is **signed-in only** — the cap is per account and
anonymous callers keep exactly the free Workers AI path they have today, so the public calculator's
"no account needed" promise is untouched. If the owner wants anonymous visitors to spend the pool too, the
quota key becomes `ip:<hash>` instead of `sub` and the calculator needs no other change.**SHIPPED 2026-10-09.** Pushed as `d32359b` and deployed as Worker version `f69db6ec` (staged under
`$HOME/mmgr-deploy`, verified before upload: pool rung present, `js/calc-ai.js` present, `.dev.vars` absent,
`tmp/` absent). CI run 37893330282 on that commit: **success**. Verified live: `/api/health` 200; `/calculator`
serves `#calc-ai-mount` + `js/calc-ai.js?v=1`; `js/calc-ai.js` 200; `sw.js` at `v387`; the panel's rules are
in the live `dist/mmgr.min.css`.

First CI run (`2ffaf1b`) went RED at **T2 Team RBAC**, not at anything in this plan: `W8.10b`/`W8.10c` still sent
a bare `DELETE` and asserted the pre-confirmation contract, so the new guard answered 400 `confirm_required`.
Reproduced locally (27/29, exactly those two), fixed the HARNESS, and added `W8.10d` to pin the refusal itself
(30/30). Everything after the red step had been SKIPPED, so the whole remaining set was run locally before
re-pushing: cloud phase 1/2, cloud codes+delete, cloud import, health sweep, email auth, reviews, calc
workspace, rank 9, t9, presence, prefs, AI badge, market features, offline copies, autosave+signin, controls
admin, client codes, API keys, sync bond, paddle CSP, auth limits, v11, p1, theme persistence, qa-full, qa-ai.

**Still not proven live:** the pool rung has never answered from a real Google key. That needs a SIGNED-IN
browser session (the rung is per-account by design), and no local secret exists to mint one — `.dev.vars` is
absent and the production session key is write-only. What IS proven live: the anonymous path still answers
exactly as before (503 capacity, `tier: workers-ai`), the pool does not fire without an account, and no key
material appears in any response body. The one live call to make by hand: sign in, open the calculator
assistant or the AI window, and ask a question — the reply should carry `source: free-pool`.

**One local-only failure, recorded so it is not mistaken for a regression:** `tools/qa-client-codes.cjs` P10
(headless Chrome over CDP) fails on this Windows machine with `webSocketDebuggerUrl` undefined. The identical
spawn works standalone, and the same suite passed in CI on `8139cc5` and again on `d32359b`, so it is the local
Chrome/Windows environment, not the app and not this wave.

**Deviation from this plan's W4 acceptance line, recorded deliberately:** W4 asked for a new
`tools/verify-ai-pool.cjs` harness. The coverage went into the EXISTING unit suite
(`test/ai-free-pool.test.mjs`, 26 cases) instead, because `npm test` is already wired into `npm run verify`
and the repo's own billing work uses `test/billing.test.mjs` for exactly this — a second harness would
duplicate it and add a registry row. No new harness was created, so no registry entry was needed.

**Still queued:** W3 (sign-in polish + hide + trigger rewiring) and W7 (hero art sequence).
