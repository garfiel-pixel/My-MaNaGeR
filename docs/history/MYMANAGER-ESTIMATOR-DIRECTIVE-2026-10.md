# MY MANAGER — HOMEOWNER / CLIENT ESTIMATOR DIRECTIVE
**Date:** 2026-10-06
**Depends on:** MYMANAGER-MASTER-DIRECTIVE-2026-10.md (must be fully shipped and deployed first)
**Status:** OWNER-APPROVED — execute without re-litigating any locked decision
**Repo:** github.com/garfiel-pixel/My-MaNaGeR

---

## GROUND RULES FOR THE EXECUTING AGENT

1. The Master Directive (multi-tier billing + RBAC) must be fully deployed before
   this directive starts. Do not begin Wave 1 until `npx wrangler deployments list`
   confirms the Master Directive changes are live.
2. Every wave is atomic. Push, poll CI, confirm green, then move to the next wave.
3. Locked decisions are final. Do not propose alternatives or ask for clarification on them.
4. `npm run verify` must exit 0 before every commit.
5. No inline scripts on any HTML file.
6. No emoji on any served page.
7. Service worker cache version in `sw.js` must be bumped whenever any served asset changes.
8. The offline-first contract is inviolable. The calculator works without network.
   The AI chat requires network and must degrade gracefully when offline.
9. Conventional Commits format. Subject ≤ 72 chars. No AI attribution footer.

---

## SECTION 1 — LOCKED DECISIONS

| # | Decision | Value |
|---|---|---|
| D1 | Product name | Homeowner / Client subscription |
| D2 | Billing cycle | Every 6 months (semi-annual) |
| D3 | Price | $49.99 USD per 6-month period |
| D4 | Tier name in code | `estimator` |
| D5 | AI interface | Text chat window — no Whisper, no voice |
| D6 | AI fills calculator via | `calcBoqAdd` action dispatch (existing delegation pattern) |
| D7 | Managed AI key model | `claude-haiku-4-5-20251001` (speed + cost); upgrade to `claude-sonnet-5-5` if accuracy complaints arise |
| D8 | Entry point | New `estimate.html` — public, SEO-indexable, no app navigation |
| D9 | calculator.html | Unchanged — internal tool, stays noindex |
| D10 | CTA destination | `estimate.html` → My MaNaGeR (pricing.html) for full PM upgrade |
| D11 | estimatorAccess gate | All paid tiers (estimator, contractor, company, enterprise). Free = no AI chat |
| D12 | AI conversation history | Client-side JS array only. No DB storage. Resets on page refresh |
| D13 | Estimate persistence | Uses existing localStorage history (already built). No new cloud save for this tier |
| D14 | X8 (estimate → project handoff) | OUT OF SCOPE for this directive. Planned for a future directive |

---

## SECTION 2 — OWNER ACTIONS (ALREADY COMPLETED)

- `PADDLE_ESTIMATOR_PRICE_ID` (`pri_...`, 6-month semi-annual cycle) — set as wrangler secret ✅

**One remaining owner action before Wave 1 begins:**

Set the managed Anthropic API key used by the server-side estimator endpoint.
This is a separate key from any user-provided key. The operator (you) pays for
these API calls — they are covered by the $49.99 subscription fee.

1. Go to console.anthropic.com → API Keys → Create key
   Name it: "my-manager-estimator"
2. Run:
```
npx wrangler secret put ANTHROPIC_ESTIMATOR_KEY
```
Paste the key when prompted.

**Cost estimate:** At `claude-haiku-4-5-20251001` pricing, a typical estimate
conversation (3 turns, ~1500 tokens in + ~800 tokens out) costs approximately
$0.0008 USD. A subscriber doing 50 conversations over 6 months = ~$0.04 in AI costs
against $49.99 revenue. The margin is safe.

---

## SECTION 3 — TIER ARCHITECTURE UPDATE

Add `estimator` to the tier ladder. The full ladder after this directive ships:

| Tier | Price | Cycle | AI Chat (Managed) | Cloud Projects | RBAC |
|---|---|---|---|---|---|
| **free** | $0 | — | ❌ (CTA to upgrade) | 1 | ❌ |
| **estimator** | $49.99 | 6 months | ✅ | 1 (calculator workspace only) | ❌ |
| **contractor** | $18.99 | Monthly | ✅ | Unlimited | 1 member |
| **company** | $50.00 | Monthly | ✅ | Unlimited | Unlimited |
| **enterprise** | $200.00 | Monthly | ✅ | Unlimited | Unlimited |

The `estimator` tier does NOT unlock full My MaNaGeR project management.
It unlocks the AI construction estimator only. The calculator workspace save
(`/api/calc/workspace`) already works for signed-in users — this covers the
estimator's cloud save need with no new endpoints.

`estimatorAccess()` in entitlements returns `true` for all paid tiers.
The AI chat gate uses `estimatorAccess()`, not a tier string comparison.

---

## SECTION 4 — OUT OF SCOPE

Do not implement these in this directive.

- X8 estimate-to-project handoff (future directive)
- Whisper WASM voice input
- Sub-domain DNS configuration (estimate.mymanagerworkspace.com) — owner does
  DNS; the Worker route is all that's needed in code
- Custom rate sheet management in the estimator (uses existing tool)
- Estimator-specific project management features
- Multi-user estimate sharing
- Estimate versioning in the cloud

---

## SECTION 5 — WAVES

### PRE-FLIGHT CHECK

Confirm Master Directive is deployed:
```
npx wrangler deployments list
npm run verify   # must exit 0
```
Confirm `ANTHROPIC_ESTIMATOR_KEY` secret exists:
```
npx wrangler secret list | grep ANTHROPIC_ESTIMATOR_KEY
```
If either check fails, stop and resolve before proceeding.

---

### WAVE 1 — BILLING CORE UPDATE
**File:** `src/billing.js`
**Goal:** Recognise the estimator price ID and map it to the `estimator` tier.
All other billing logic (checkout routing, webhook handling) already supports
the pattern from the Master Directive — this wave adds the estimator case only.

#### 1.1 — Add estimator to deriveTier()

The `deriveTier()` function was added in the Master Directive. Extend it:

```js
export function deriveTier(priceId, env) {
  if (!priceId || !env) return 'contractor';
  if (env.PADDLE_ENTERPRISE_PRICE_ID  && priceId === String(env.PADDLE_ENTERPRISE_PRICE_ID))  return 'enterprise';
  if (env.PADDLE_COMPANY_PRICE_ID     && priceId === String(env.PADDLE_COMPANY_PRICE_ID))      return 'company';
  if (env.PADDLE_ESTIMATOR_PRICE_ID   && priceId === String(env.PADDLE_ESTIMATOR_PRICE_ID))    return 'estimator';
  return 'contractor';
}
```

Order matters: enterprise and company are checked first, then estimator,
then the default (contractor). Do not change the order.

#### 1.2 — Add estimator to checkout routing

In `handleBillingCheckout`, the `?tier=` param already routes to the correct
price ID. Add the estimator case:

```js
if (tierParam === 'estimator' && env.PADDLE_ESTIMATOR_PRICE_ID) {
  priceId = String(env.PADDLE_ESTIMATOR_PRICE_ID);
}
```

Insert this block after the `enterprise` check and before the `company` check,
so the priority chain is: enterprise → estimator → company → contractor (default).

#### 1.3 — Billing status response for estimator

The estimator tier should NOT report unlimited cloud projects. The billing status
response already returns `projectCap`. Confirm the cap logic: `estimator` tier
users are not Contractor-level — they have a cap of 1 (same as free). No code
change is needed if `billingFreeCap` already applies to non-contractor tiers.

Verify: a user on the `estimator` tier calling `/api/billing/status` should
receive `projectCap: 1` (the free default cap). If the current code gives
Contractor-level unlimited to all paid tiers, add an explicit check:

```js
// After deriving tier from sub.plan:
const projectCap = (sub && ['contractor','company','enterprise'].includes(sub.plan))
  ? null          // null = unlimited
  : billingFreeCap(env);  // 1 for free and estimator
```

**Exit gate:** `npm run verify` green.
Commit: `feat(billing): estimator tier in deriveTier and checkout routing`

---

### WAVE 2 — ENTITLEMENTS UPDATE
**File:** `js/app/entitlements.js`
**Goal:** Add `estimatorAccess()` gate. This is the single gate used by both
the `estimate.html` AI panel and any future gating inside `calculator.html`.

Add to the entitlements module (alongside the existing gate functions):

```js
// True for all paid tiers — estimator, contractor, company, enterprise.
// Free users see a CTA to upgrade. Gate every AI chat call with this.
function estimatorAccess() {
  return _tier === 'estimator' || _tier === 'contractor'
      || _tier === 'company'   || _tier === 'enterprise';
}
```

Export it:
```js
ns.Entitlements = {
  setBillingTier  : setBillingTier,
  tier            : tier,
  aiAssistant     : aiAssistant,
  unlimitedCloud  : unlimitedCloud,
  rbacAccess      : rbacAccess,
  rbacUnlimited   : rbacUnlimited,
  estimatorAccess : estimatorAccess   // ← new
};
```

**Exit gate:** `npm run verify` green.
Commit: `feat(entitlements): estimatorAccess gate for AI chat`

---

### WAVE 3 — SERVER-SIDE ESTIMATOR AI ENDPOINT
**Files:** `src/estimator-ai.js` (new), `src/router.js`
**Goal:** A managed-key AI endpoint that accepts a conversation turn,
enforces the estimator tier gate, and returns an AI response with an
optional structured estimate payload. The operator's Anthropic key is used —
the user provides no key.

#### New file: `src/estimator-ai.js`

```js
/* ============================================================
   Estimator AI relay — operator-managed Anthropic key.
   POST /api/estimator/chat
   Auth: valid session + estimatorAccess tier.
   Rate: 30 requests per session per hour (cloudRateCheck).
   Model: claude-haiku-4-5-20251001 (upgrade to claude-sonnet-5-5
          in ANTHROPIC_ESTIMATOR_MODEL env var if accuracy requires it).
   The AI is given the full JIC trade catalog as system context and
   returns conversational text. When it has enough information to
   generate an estimate, it includes a JSON block delimited by
   <ESTIMATE> and </ESTIMATE> tags inside its response text.
   The client parses this block and calls applyAIEstimate(lines).
   ============================================================ */
import { json, cloudRateCheck, readSession } from './lib/http.js';

const UPSTREAM = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const BODY_LIMIT = 32768;   // 32 KB — conversation history only, no uploads
const TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// JIC TRADE CATALOG — serialised summary for the system prompt.
// Keys must match the WORK object in js/calculator-page.js exactly.
// When trades are added to the calculator, add them here too.
// ---------------------------------------------------------------------------
const TRADE_CATALOG = `
GROUNDWORKS
  siteprep      — Site clearing and preparation (area: length × width in m)
  excav         — Excavation (volume: length × width × depth in m)
  slab          — Concrete floor slab (area: length × width in m)
  footings      — Strip or pad footings (volume: length × width × depth in m)
  septic-tank   — Septic tank installation (qty: number of tanks)
  formwork      — Formwork for beams, columns, ring beams (area: length × width in m)
  concrete-labour — Concrete pouring labour (volume in m3)
  post-holes    — Post hole boring (qty: number of holes)

STRUCTURE
  blockwall     — Concrete block wall (area: length × height in m)
  brickwall     — Brick wall (area: length × height in m)
  framing       — Timber or steel stud framing (area: length × height in m)
  rebar         — Reinforcement steel bars (weight in kg or length in m)
  stirrups      — Column/beam stirrups (qty: number of stirrups)
  fabric-mesh   — Fabric mesh for slabs (area in m2)

ENVELOPE (exterior shell)
  roof          — Roofing — zinc/metal sheet (area: length × width in m)
  shingle-roof  — Shingle roofing (area in m2)
  render        — External render / plastering (area in m2)
  paint         — External or internal painting (area in m2)
  drywall       — Drywall / partition board (area in m2)
  window        — Windows (qty: number of windows)
  gutter        — Guttering (length in m)
  soffit-fascia — Soffit and fascia (length in m)

FINISHES (interior)
  tile          — Floor or wall tiling (area in m2)
  concrete-drive — Concrete driveway or path (area in m2)
  fencing       — Perimeter fencing (length in m)
  skirt         — Skirting board (length in m)
  door          — Doors (qty: number of doors)
  ceiling       — Suspended or fixed ceiling (area in m2)
  floor-screed  — Floor screed / levelling (area in m2)
  cabinet       — Kitchen or bathroom cabinets (qty: number of cabinets)

PLUMBING
  pipe-supply   — Supply pipework (length in m)
  pipe-drain    — Drainage pipework (length in m)
  fixture       — Plumbing fixtures (qty: sinks, toilets, showers)
  bath-rough    — Bathroom rough-in (qty: number of bathrooms)
  water-heater  — Water heater installation (qty: number of units)
  plumbing-pipe — General plumbing pipe run (length in m)

ELECTRICAL
  wire-point    — Electrical wiring points (qty: number of points)
  conduit       — Conduit runs (length in m)
  panel         — Distribution panel / consumer unit (qty: number of panels)
  electrical-conduit — Electrical conduit (length in m)

TEMPORARY & METAL
  scaffold      — Scaffolding (area: length × height in m, or just floor area)
  welding       — Welding / metal fabrication works (length or qty)

JOINERY
  joinery       — Timber joinery — doors, frames, built-ins (qty or area)
`;

// ---------------------------------------------------------------------------
// SYSTEM PROMPT
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a Jamaica construction estimator assistant built into My MaNaGeR.
You help homeowners and contractors get a preliminary JIC-rated cost estimate for their build.

WHAT YOU KNOW
- You use Jamaica's JIC (Joint Industrial Council) 2025-2027 rate book for all pricing context.
- All rates are in JMD unless the user specifies a different currency. The calculator supports JMD, USD, CAD, GBP.
- Jamaica construction: typical house build is concrete block walls, zinc or shingle roof, ceramic tile floors. Confirm if different.
- Common project types: house build, extension, renovation, boundary wall, garage, commercial fitout.

YOUR BEHAVIOUR
1. Ask the minimum clarifying questions needed to build a credible estimate. Typically: project type, approximate floor area, number of bedrooms/bathrooms, wall material, roof type, finish quality (basic / standard / high-end), parish/location.
2. Do not ask all questions at once. Gather one or two at a time naturally.
3. Once you have enough to estimate, produce the estimate AND explain the key assumptions.
4. Be honest about uncertainty. This is a planning-grade estimate, not a final bill.
5. If the user asks about something outside construction estimating, politely redirect.

GENERATING AN ESTIMATE
When you have enough information, include a JSON estimate block at the END of your message.
Format it exactly like this — no deviation:

<ESTIMATE>
{
  "project": "brief description",
  "lines": [
    { "work": "siteprep", "d1": 120, "d2": 15, "d3": null, "variant": null },
    { "work": "blockwall", "variant": "8in-gf", "d1": 60, "d2": 3, "d3": null },
    { "work": "roof", "d1": 14, "d2": 12, "d3": null, "variant": null }
  ],
  "note": "This is a planning-grade estimate. Actual costs will vary by contractor and market conditions."
}
</ESTIMATE>

FIELD RULES FOR THE JSON
- "work" must be one of the exact trade keys from the catalog provided.
- "d1", "d2", "d3": numeric dimensions in METRES (convert imperial input before placing here).
- "d3": only include when the trade requires a third dimension (e.g. excavation depth).
- "variant": only include when a JIC variant applies (e.g. "8in-gf" for 8-inch ground floor block). Use null otherwise.
- Do not include lines for trades you have no basis to estimate. Fewer accurate lines beat many guesses.
- Include the <ESTIMATE> block only once per message, only when the estimate is ready.

TRADE CATALOG
${TRADE_CATALOG}

TONE
Friendly, plain English. No jargon unless the user uses it first. Brief.`;

// ---------------------------------------------------------------------------
// HANDLER
// ---------------------------------------------------------------------------
export async function handleEstimatorChat(request, env) {
  // Rate limit: 30 AI requests per session per hour
  const rl = await cloudRateCheck(request, 'estimator-ai', env);
  if (rl) return rl;

  // Auth: must be signed in
  const session = await readSession(request, env);
  if (!session || !session.sub) return json({ ok: false, error: 'auth_required' }, 401);

  // Tier gate: estimator or any higher paid tier
  const sub = await env.DB.prepare(
    'SELECT status, plan FROM cloud_subscriptions WHERE owner_sub = ? ORDER BY id DESC LIMIT 1'
  ).bind(session.sub).first();
  const tier = (sub && sub.plan) || 'free';
  const allowed = ['estimator', 'contractor', 'company', 'enterprise'];
  if (!sub || !allowed.includes(tier)) {
    return json({ ok: false, error: 'upgrade_required', upgradeUrl: '/pricing.html#estimator' }, 402);
  }

  // Read and validate body
  const raw = await request.text();
  if (!raw || raw.length > BODY_LIMIT) return json({ ok: false, error: 'bad_request' }, 400);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ ok: false, error: 'bad_request' }, 400); }

  // messages: [{role:'user'|'assistant', content: string}]
  // Client sends the full conversation history each turn.
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  // Sanitise: only role and content, trim to last 20 turns to control cost
  const messages = body.messages.slice(-20).map(function(m) {
    return { role: (m.role === 'assistant' ? 'assistant' : 'user'), content: String(m.content || '').slice(0, 4000) };
  });
  // Ensure last message is user
  if (messages[messages.length - 1].role !== 'user') {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // API key check
  const apiKey = env.ANTHROPIC_ESTIMATOR_KEY;
  if (!apiKey) return json({ ok: false, error: 'service_unavailable' }, 503);

  const model = String(env.ANTHROPIC_ESTIMATOR_MODEL || DEFAULT_MODEL);

  // Call Anthropic
  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: messages
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    return json({ ok: false, error: 'upstream_timeout' }, 504);
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    // Pass Anthropic's 429 through so the client can back off
    const status = upstream.status === 429 ? 429 : 502;
    return json({ ok: false, error: 'upstream_error', status: upstream.status }, status);
  }

  const data = await upstream.json();
  const text = (data && Array.isArray(data.content))
    ? data.content.map(function(c) { return (c && c.type === 'text') ? c.text : ''; }).join('')
    : '';

  if (!text) return json({ ok: false, error: 'empty_response' }, 502);

  // Parse the optional <ESTIMATE> block
  let estimate = null;
  const match = text.match(/<ESTIMATE>([\s\S]*?)<\/ESTIMATE>/);
  if (match) {
    try { estimate = JSON.parse(match[1].trim()); } catch (e) { estimate = null; }
  }

  // Return text with the <ESTIMATE> block stripped (client uses the parsed object)
  const displayText = text.replace(/<ESTIMATE>[\s\S]*?<\/ESTIMATE>/g, '').trim();

  return json({ ok: true, text: displayText, estimate: estimate });
}
```

#### src/router.js additions

```js
import { handleEstimatorChat } from './estimator-ai.js';

// Inside the main router switch / if-chain, add:
if (method === 'POST' && path === '/api/estimator/chat') {
  return handleEstimatorChat(request, env);
}
```

Place this route before the generic 404 catch-all, after the billing routes.

**Write a QA harness** `tools/qa-estimator-ai.cjs` that:
- Sends a mock POST to `/api/estimator/chat` without a session → expects 401
- Sends with a free-tier session → expects 402
- Sends with a valid estimator session and a single user message → expects 200
  with a `text` string
- Sends a message that triggers the estimate → confirms `estimate.lines` is
  an array when `<ESTIMATE>` block is present in the response
- Register the harness in `docs/CI-TEST-COVERAGE.md` and `ci.yml`

**Exit gate:** `npm run verify` green, harness registered and passing.
Commit: `feat(estimator): managed AI chat endpoint with tier gate`

---

### WAVE 4 — AI CHAT PANEL ON estimate.html
**Files:** `estimate.html` (new), `js/estimator-chat.js` (new), `build.js`
**Goal:** A public-facing, SEO-indexed page with an AI chat panel above the
full calculator. Free users see the calculator in full; the AI chat is gated
behind the estimator tier with a clear upgrade CTA.

#### estimate.html

New file in the repo root. Public, indexable. Loads the same
`dist/mmgr.min.css` as the rest of the app. Does NOT include the app
navigation sidebar. Structurally:

```
<head>
  <title>Jamaica Construction Cost Estimator | My MaNaGeR</title>
  <meta name="description" content="Get a JIC-rated construction cost
    estimate for your Jamaica build. Free calculator — AI-powered estimates
    for homeowners and contractors.">
  <meta name="robots" content="index, follow">
  <!-- same CSS, theme, viewport as calculator.html -->
</head>

<body>
  <!-- HERO SECTION -->
  <header class="est-hero">
    <a href="index.html" class="est-logo-link" aria-label="My MaNaGeR home">
      <!-- brand wordmark, same as other pages -->
    </a>
    <h1>Build Cost Estimator</h1>
    <p>JIC 2025-2027 rated. Jamaica construction. Free to calculate — AI-assisted for subscribers.</p>
  </header>

  <!-- AI CHAT PANEL — gated -->
  <section class="est-ai-section" id="est-ai-section">

    <!-- STATE A: not signed in -->
    <div class="est-gate" id="est-gate-signin" hidden>
      <p>Sign in to use the AI estimator.</p>
      <button type="button" class="btn btn-g" data-action="estSignIn">Sign in with Google</button>
    </div>

    <!-- STATE B: signed in, free tier — upsell -->
    <div class="est-gate" id="est-gate-upsell" hidden>
      <p>Describe your project in plain English and the AI builds the estimate for you.</p>
      <p class="est-price">Homeowner / Client plan — <strong>$49.99 every 6 months</strong></p>
      <button type="button" class="btn btn-g" data-action="estUpgrade">Get AI access</button>
      <p class="est-fine">Or use the calculator below for free.</p>
    </div>

    <!-- STATE C: estimator or higher — chat window -->
    <div class="est-chat" id="est-chat" hidden>
      <div class="est-chat-messages" id="est-chat-messages" aria-live="polite" aria-label="AI estimator conversation">
        <!-- messages injected by estimator-chat.js -->
      </div>
      <div class="est-chat-input-row">
        <textarea id="est-chat-input" class="est-chat-input" rows="2"
          placeholder="Describe your project — e.g. 3-bedroom concrete block house in St. Catherine, around 1200 sq ft"
          aria-label="Describe your construction project"></textarea>
        <button type="button" class="btn btn-g est-chat-send" data-action="estSend" aria-label="Send message">
          <svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-send"></use></svg>
        </button>
      </div>
      <p class="est-disclaimer">Planning-grade estimates only. Actual costs depend on your contractor and market conditions.</p>
    </div>

  </section>

  <!-- FULL CALCULATOR — always free, embedded via iframe or inline include -->
  <!-- Use an iframe pointing to calculator.html to keep the JS scopes isolated -->
  <section class="est-calc-section">
    <h2 class="est-calc-heading">Manual Calculator</h2>
    <p class="est-calc-sub">Pick a trade, enter dimensions, get quantities and costs. No account needed.</p>
    <iframe src="calculator.html" class="est-calc-frame"
      title="My MaNaGeR Build Cost Calculator"
      loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads">
    </iframe>
  </section>

  <!-- CTA FOOTER -->
  <footer class="est-footer">
    <p>Managing this build yourself? <a href="pricing.html">My MaNaGeR</a> tracks
       your entire project — schedule, budget, team, and risk — from start to handover.</p>
  </footer>
</body>
```

**Important notes:**
- The calculator is embedded as an iframe to keep the `calculator.html` JS
  scope isolated. The AI chat does NOT need to call `applyState()` across the
  iframe boundary for this directive. The AI result is displayed as text;
  the user optionally switches to the manual calculator to apply it.
  (Cross-frame `applyState()` is the X8 feature, out of scope here — see Section 4.)
- The page authenticates via the existing Google OAuth session (same-origin).
  `estimator-chat.js` calls `/api/billing/status` on load to determine which
  state panel to show.

#### js/estimator-chat.js (new)

Responsibilities:
1. On DOMContentLoaded: call `/api/billing/status`
   - If not signed in → show `#est-gate-signin`
   - If signed in + free tier → show `#est-gate-upsell`
   - If signed in + estimator/contractor/company/enterprise → show `#est-chat`
2. Handle `estSignIn` action → `window.location.href = '/auth/google'`
   (existing OAuth entry point)
3. Handle `estUpgrade` action → trigger billing checkout:
   `window.location.href = '/api/billing/checkout?tier=estimator'`
   (existing checkout route, now routing to `PADDLE_ESTIMATOR_PRICE_ID`)
4. Handle `estSend` action:
   - Read `#est-chat-input` value
   - Append to `conversationHistory` array: `{ role: 'user', content: text }`
   - Render user bubble in `#est-chat-messages`
   - Clear input, disable send button, show loading indicator
   - POST `/api/estimator/chat` with `{ messages: conversationHistory }`
   - On 200: append `{ role: 'assistant', content: response.text }` to history
   - Render assistant bubble in `#est-chat-messages`
   - If `response.estimate` exists: render an "Estimate ready" summary card
     showing project name, number of line items, and a note. The full detail
     is in the manual calculator which the user can use separately.
   - On 402: hide chat, show `#est-gate-upsell`
   - On 429: show "Too many requests — please wait a moment" in the chat
   - On any other error: show "Something went wrong — please try again" in chat
   - Re-enable send button after response or error
5. `conversationHistory` lives in a module-scope array. It is never persisted.
   It resets when the page is refreshed. This is intentional (D12).

**Conversation history management:** Trim to the last 20 messages before
sending to the API (the server also trims to 20 — this is defence in depth).

**Keyboard:** Pressing Enter in the textarea sends the message.
Shift+Enter inserts a newline.

#### build.js

Add `js/estimator-chat.js` to the build so it is included in `dist/bundle.js`
OR serve it as a separate `dist/estimator-chat.js` that `estimate.html` loads
independently. Prefer a separate bundle for this page to avoid loading
estimator code on all other pages.

**Exit gate:** `npm run verify` green (CSP hashes recomputed after any new
inline content). Commit: `feat(estimator): AI chat panel + estimate.html entry point`

---

### WAVE 5 — SEO + WORKER ROUTING
**Files:** `worker.js`, `wrangler.jsonc`
**Goal:** `estimate.html` is served publicly and indexed. A subdomain or
path alias routes to it cleanly. Security headers are correct.

#### worker.js — serve estimate.html

Confirm that `estimate.html` is served by the static asset handler.
If the Worker routes explicitly list files to serve, add `estimate.html`.
If the static handler serves all files in the root, no change needed.

Add `estimate.html` to the sitemap if one exists (`sitemap.xml` in repo root).
If no sitemap exists, create one with `estimate.html` and `pricing.html` as
the primary public URLs.

#### Robots.txt

If `robots.txt` is in the repo, confirm it does NOT block `estimate.html`.
Remove any rule that would block the estimator from indexing.

#### CSP for estimate.html

`estimate.html` embeds `calculator.html` as an iframe. Add `frame-src 'self'`
to the CSP header served for `estimate.html`. The iframe is same-origin so
this is sufficient.

The CSP for `estimate.html` should be the same as the app CSP minus `unpkg.com`
(which is removed in Master Directive Wave 8.4). Do not add new CSP directives
beyond what the app already allows.

#### Subdomain routing (optional — owner does DNS)

If the owner adds a CNAME `estimate.mymanagerworkspace.com → mymanagerworkspace.com`,
the Worker serves `estimate.html` as the root for that subdomain by adding
a route match in `wrangler.jsonc`:

```jsonc
{
  "routes": [
    { "pattern": "estimate.mymanagerworkspace.com/*", "zone_name": "mymanagerworkspace.com" }
  ]
}
```

Add a hostname check in `worker.js`: if the request hostname is
`estimate.mymanagerworkspace.com` and the path is `/`, serve `estimate.html`.
This is optional for the initial launch — the page works at
`mymanagerworkspace.com/estimate.html` without the subdomain.

**Exit gate:** `npm run verify` green.
Commit: `feat(estimator): SEO meta, robots, sitemap, worker routing`

---

### WAVE 6 — PRICING PAGE UPDATE
**File:** `pricing.html`
**Goal:** Add the Homeowner / Client card to the existing four-card layout.
The pricing page now has five tiers.

Insert the Homeowner / Client card as the second card (between Free and Contractor):

**HOMEOWNER / CLIENT — $49.99 every 6 months**
- Describe your project in plain English — the AI builds the estimate
- JIC 2025-2027 rated costs for Jamaica construction
- PDF and CSV export
- Save your estimate on this device
- 1 cloud project (calculator workspace sync)
- No project management features

The checkout button calls `/api/billing/checkout?tier=estimator`.

Update the feature comparison table to include the Homeowner / Client column.

**Exit gate:** `npm run verify` green (CSS integrity must pass — rerun
`node tools/regen-csp-hashes.cjs` if hashes drift).
Commit: `feat(pricing): Homeowner/Client estimator tier card`

---

## SECTION 6 — BUILD SEQUENCE

```
PRE-FLIGHT   npm run verify → exit 0
             npx wrangler deployments list → Master Directive confirmed live
             npx wrangler secret list | grep ANTHROPIC_ESTIMATOR_KEY → confirmed

WAVE 1       src/billing.js — estimator in deriveTier + checkout
WAVE 2       js/app/entitlements.js — estimatorAccess gate
WAVE 3       src/estimator-ai.js (new) + router.js — managed AI endpoint
WAVE 4       estimate.html (new) + js/estimator-chat.js (new) + build.js
WAVE 5       worker.js + wrangler.jsonc — routing + SEO
WAVE 6       pricing.html — Homeowner/Client card added

DEPLOY       After all waves are CI-green:
             npx wrangler deploy
```

Waves 5 and 6 can run in parallel with each other but not with Waves 1–4.

---

## SECTION 7 — CONSTRAINTS THAT APPLY TO EVERY WAVE

- `npm run verify` must exit 0 before every commit.
- Service worker cache constant in `sw.js` bumped whenever any served asset changes.
- No inline scripts added to any HTML file.
- CSP hashes recomputed (`node tools/regen-csp-hashes.cjs`) whenever any
  inline script or style changes.
- `docs/CI-TEST-COVERAGE.md` row and `ci.yml` entry updated in the same
  commit as any new harness.
- calculator.html is NOT modified in this directive. It stays noindex and unchanged.
- The AI chat is fully non-functional offline (network required). This is
  acceptable and must be communicated to the user. Offline state: the chat
  input is disabled with the message "AI estimator requires an internet connection."
  The manual calculator below always works offline.
- The `ANTHROPIC_ESTIMATOR_KEY` is never logged, never returned in any
  response body, and never accessible to client-side code. It is server-only.
- The AI system prompt is a constant in `src/estimator-ai.js`. It is not
  user-configurable and is not served to the client.

---

## SECTION 8 — WHAT SUCCESS LOOKS LIKE

When this directive is fully executed:

1. A homeowner finds `estimate.mymanagerworkspace.com` (or `mymanagerworkspace.com/estimate.html`)
   via a Google search for "Jamaica construction cost estimator."
2. They use the manual calculator for free with no account.
3. They sign in with Google and subscribe on the Homeowner / Client plan ($49.99 / 6 months)
   via Paddle.
4. They type "I want to build a 3-bedroom concrete block house in St. Catherine,
   around 1200 sq ft, ceramic tile floors, zinc roof."
5. The AI asks 1–2 clarifying questions (finish quality, number of bathrooms).
6. The AI returns a JIC-rated estimate in plain English, with an `<ESTIMATE>`
   block that the client parses.
7. The user sees the breakdown as a summary card and can manually verify or
   adjust it in the embedded calculator below.
8. They download a PDF.
9. At the bottom of the page they see the CTA: "Managing this build? My MaNaGeR
   tracks the whole project." They click, see the pricing page, and understand
   the Contractor plan is the upgrade for ongoing project management.
10. The entire flow costs less than $0.01 in AI API fees.
11. `npm run verify` exits 0 from a clean checkout.
