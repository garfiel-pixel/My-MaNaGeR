# MCP FIX DIRECTIVE — project server + app-wide server

**Date:** 2026-11-11 (live evidence 2026-11-12 UTC)
**Owner:** Garfield Fairclough
**Scope:** (1) repair the project-scoped MCP server, (2) integrate it with the
app-wide MCP server under one shared contract, (3) add the MCP feature to the
landing page, (4) ship hard gates for all three.
**Not in scope:** applying the project correction to the live project. The owner
will review and approve that proposal after the write path is healthy.

**Implementation state (2026-11-11, verified):** sections 3–6 and 8–11 are
committed (`2279930`, `4de0faf`, `5fcde08`) and green locally -
`tools/qa-mcp-write-path.cjs` 20/20, `tools/qa-mcp-parity.cjs` 13/13. They are
not yet proven in production. The correction payload file does not exist on disk
and must be re-derived from live state. Section 7 (the landing card) is now
**T-06** of `UI-IA-AND-MCP-DIRECTIVE-2026-11-11.md`, which is the ordered task
list of record; the live deploy is its T-01 and the correction is its T-02.

---

## 0. Read this first — non-negotiable rules

These override convenience. A change that violates one of them is not shippable.

1. **Offline-first stays sacred.** No MCP change may make the app require a
   network, an account, or a cloud project.
2. **Cloud sync stays opt-in.** Never enable it implicitly.
3. **Writes never auto-apply.** Every external change is a proposal in
   *Review incoming changes* until the owner accepts it.
4. **MCP auth errors are tool results, never HTTP 401/403.** Handshake and
   `tools/list` answer unauthenticated; the tool layer refuses.
5. **One contract, two endpoints.** The project server and the app-wide server
   must share the tool registry, scope projector, and write pipeline. No forks.
6. **No unbounded loop.** Every loop gets a hard iteration ceiling.
7. **No per-diff network I/O.** Load once, index once, apply in memory, queue once.
8. **Never weaken a test to make a change pass.** Re-baseline it explicitly and
   record why in the same commit.
9. **No emoji on served pages.** Icons are SVG sprite symbols only.
10. **CSP hashes:** if any inline `<script>` changes, regenerate the hashes in
    `worker.js` and `serve.cjs`, then restart `serve.cjs` before browser tests.
11. **Build before test:** `node build.js` after any `js/` edit — a stale
    `dist/bundle.js` silently runs old code.
12. **Registry:** every new harness goes into `docs/CI-TEST-COVERAGE.md` and
    either `ci.yml` or `extended-qa.yml`.
13. **Commits:** Conventional Commits, no AI attribution footer.
14. **Do not apply the live correction payload.** It is evidence, not a fix step.

---

## 1. Live evidence — what actually failed

Endpoint: `https://mymanagerworkspace.com/api/mcp/bank-renovation`
Two independent project keys were tested. Keys are redacted here.

### 1.1 Transport and read path

| Probe | Result |
|---|---|
| `initialize` unauthenticated | 200, `my-manager-mcp 1.0.0` |
| `tools/list` unauthenticated | 200, 12 tools |
| `tools/call` with no credential | 200 + MCP `isError` refusal (correct) |
| `tools/call` with a fake `sk-mmgr-…` key | 200 + same refusal (correct) |
| `resources/list`, `prompts/list` | JSON-RPC `-32601` (expected) |
| `get_project_summary` | 200 |
| `get_tasks` | 200, 122 tasks, ~106 KB raw |
| `get_risks` | 200, 11 risks |
| `get_meetings` | 200, 16 meetings |
| `get_proposal_status` | 200, 0 proposals (D1 only) |
| `get_budget` | **503 / Cloudflare 1102** |
| `get_weekly_summary` | **503 / 1102** |
| `get_table` (risks, logEntries, changes, tasks) | **503 / 1102** |
| `get_table` weather tables | correct `isError` refusal |
| `get_table` unknown table | correct `isError` refusal |
| `get_deliveries` bad `lineId` | correct `isError` refusal |

### 1.2 Write path — the blocker

| `apply_changes` payload | Result |
|---|---|
| 30 diffs (11 tasks + 19 risk fields) | **503 / 1102** |
| 1 diff | **503 / 1102** |
| empty `{}` | **503 / 1102** |
| after a 5-minute cool-down, immediately after a successful `get_project_summary` | **503 / 1102** |

**Conclusion:** the write path is deterministically over the platform resource
limit. It fails before it can reject an empty payload. This is not the key, not
rate limiting, and not payload size.

### 1.3 Other reproduced defects

| ID | Defect | Evidence |
|---|---|---|
| P1 | `run_monte_carlo {targetDate:"not-a-date"}` returns 503/1102 | Cloudflare 1102 at 2026-11-12T03:12:37Z |
| P1 | `get_weekly_summary {week:"2026-13-45"}` silently answers the default week | 200, `week: "2027-01-11"` |
| P2 | `envelope: 0` yields `envelopeRemaining: -1747788` | `get_budget` |
| P2 | weekly default lands in the future | 2026-11-11 request → `2027-01-11` |
| P2 | `get_weather` advertised to API keys but always refuses | `get_weather` |
| P3 | `get_project_summary` promises a health score it does not return | description vs payload |
| P3 | `openRisks: 11` counts a `Mitigated` risk | `get_risks` |
| P3 | 122-task / 50 KB response, no pagination | `get_tasks` |
| P3 | 429 body is transport JSON, not JSON-RPC | burst probe |
| P3 | no MCP write path for `budgetEnvelope` / `projectDeadline` | tool schema |
| P3 | record status casing mixed (`Open`, `ontrack`, `todo`) | `get_risks` / budget |

---

## 2. Root-cause hypotheses (rank in this order)

1. **State load/serialization is already at the CPU ceiling.** Budget tools and
   `get_table` fail while `get_proposal_status` (D1 only) succeeds. Measure the
   size and cost of the R2 blob read + JSON parse + scope projection before
   changing logic.
2. **The write pipeline clones or re-walks the whole state per diff.** A single
   diff failing identically to thirty points at fixed overhead, not payload
   size. Look for `JSON.parse(JSON.stringify(...))` inside a per-diff loop, or a
   merge that materialises every table for every field.
3. **The proposal insert does network I/O inside a CPU-heavy path** (R2 read or
   D1 subrequest per change), or retries in a loop.
4. **Invalid dates produce `NaN` and an unbounded loop** in the Monte Carlo
   target-probability scoring.
5. **Key verification does expensive work per candidate** (KDF loop or an
   unbounded timing sink). Treat as a regression risk even though the new key
   read path recovered.

---

## 3. Two servers, one contract

### 3.1 Endpoints

| Server | Route | Identity | Discovery |
|---|---|---|---|
| Project MCP | `/api/mcp/:projectId` | project API key or owner code | none; project is pinned by URL |
| App-wide MCP | `/api/mcp` | OAuth access token (PKCE), owner session, or key | OAuth AS metadata, RFC 8414 + RFC 9728 |

The app-wide server adds `list_projects` and `create_project`; every
project-scoped tool it exposes **requires `projectId`** in the arguments.

### 3.2 Shared modules (required)

Extract, do not duplicate:

- `mcpToolRegistry` — names, descriptions, input schemas, output schemas,
  required section, write/budget switches, pagination defaults.
- `resolvePrincipal` — credential → `{ role, projectId, sections, switches, label }`,
  with a single constant-time compare and no KDF loop.
- `projectState` — one loader, one cache per request, one scope projector.
- `applyProposal` — validate → materialise diffs in one pass → queue one
  `cloud_reviews` row → return a receipt.
- `refusal(code, message)` — byte-identical refusal text across endpoints.

If the two servers cannot import the same module yet, the app-wide server must
call the project executor through a thin adapter, not copy the logic.

### 3.3 Own gates, plus one parity gate

- Project MCP gates: key scope, budget read/propose switches, per-key proposal
  visibility, write-path budget, rate limit.
- App-wide gates: OAuth/PKCE/token rotation, free-tier premium refusal,
  disabled/block_all, allow_read, allow_subset, no-access, `mcp_enabled=0`,
  view-role write block, owner read clears every gate, `projectId` required.
- Parity gate: for every shared tool, the catalog name/schema, refusal text, and
  projected output must match between endpoints.

---

## 4. Fix specification

### P0 — `apply_changes` must survive a normal proposal

**Required pipeline**

1. Validate the envelope shape and caps **before** loading project state:
   - max 500 diffs, max 500 creates, max 200 budget items;
   - reject with a JSON-RPC tool error, not 1102.
2. Load the project state exactly once.
3. Build `Map<path, Map<recordId, record>>` indexes once.
4. Validate every diff against the key's section scope and the record's current
   field. Collect all errors; return one structured refusal listing them.
5. Materialise the new arrays in a single pass. No deep clone per diff, no
   repeated `find`, no per-diff network call.
6. Queue **one** `cloud_reviews` row with `proposal_type: 'mcp'` and the merged
   proposal JSON.
7. Return `{ proposalId, changeCount, summary, splitReceipt }`.
8. Empty `{}` returns `isError: true`, "nothing to propose".

**Budget guard**

- Track elapsed time and operation count. At 60% of the platform CPU budget,
  abort with `MCP_WRITE_BUDGET_EXCEEDED` and a plain message. Never let the
  platform 1102 be the first signal.
- Add a feature flag (`MCP_WRITE_MODE=direct|staged`) if a staged rollout is
  needed, defaulting to `staged` only after tests pass.

**Guard rails**

- A tasks proposal still replaces the whole tasks array on accept. The server
  must warn when a second pending tasks proposal exists for the same project and
  key: "Accepting this will replace the tasks array; fold changes into one
  proposal."
- Do not allow a write proposal to target `budgetEnvelope` or
  `projectDeadline` until those paths are explicitly implemented.

### P1 — strict date and week validation

- One ISO parser used by `get_weekly_summary` and `run_monte_carlo`.
- Reject impossible dates (`2026-13-45`), NaN, and non-strings.
- Bound the Monte Carlo loop by `simulations` **after** clamping to 100–5000.
- Bound the target-probability scoring loop by the simulated completion dates;
  never loop on a parsed target date.
- Acceptance: `targetDate:"not-a-date"` returns `isError` in under 100 ms and the
  next request still succeeds.

### P2 — semantic fixes

- `get_budget`: an unset envelope (`0` or `null`) returns
  `envelope: null, envelopeRemaining: null`. Never a negative plan.
- `get_weekly_summary`: default to the latest week with spend **on or before
  today**; if all spend is future-dated, default to the current week and flag it.
- `get_weather`: hide the tool from a key's catalog when weather is not
  grantable, or add a grantable `weather` section. Do not advertise a tool that
  always refuses.
- Fix the future-dated spend entry in the demo project through the normal
  proposal path (not part of this code fix).

### P3 — contract polish

- `get_project_summary`: return `healthScore` and `healthBand`, or remove the
  promise from the description. `openRisks` counts only `status === 'open'`
  (case-insensitive).
- `get_tasks` / `get_meetings`: add `limit` + `cursor` (default 50), and return
  `total`, `returned`, `nextCursor`.
- Return MCP `structuredContent` alongside the text block; publish
  `outputSchema` for every read tool.
- Normalise status casing to lower-case enums at the boundary; keep display
  labels in the UI.
- 429 responses: JSON-RPC error `-32000` with `data.retryAfterSeconds`, plus a
  real `Retry-After` header.

---

## 5. Guarded rules for the implementer (hard gates)

A change is rejected if any of these is false.

1. `apply_changes {}` returns a structured validation error — never 1102.
2. `apply_changes` with 1 / 30 / 200 diffs returns one proposal receipt.
3. The same write succeeds immediately after a heavy read in the same minute.
4. No tool returns 1102 under a 30-call mixed read/write loop.
5. Invalid dates/weeks return tool errors; the endpoint stays healthy.
6. A key's catalog contains only tools its sections can actually use.
7. A budget-only key cannot read tasks; a view token cannot propose writes.
8. A proposal is visible only to the key that queued it.
9. No write reaches live state without owner acceptance.
10. Project and app-wide catalogs agree on every shared tool.
11. `npm run verify` is green.
12. New harnesses are registered with a status and wired into CI.
13. Landing-page card count gates are re-baselined, not deleted.
14. No emoji, no CSP drift, no stale bundle.
15. No AI attribution in the commit.

---

## 6. Test plan and gate matrix

| Gate | File | Proves | CI |
|---|---|---|---|
| Write path | `tools/qa-mcp-write-path.cjs` (new) | empty/1/30/200 diffs, one proposal each, no 1102 | `cloud-core` |
| Arguments | `tools/qa-mcp-args.cjs` (new) | bad date/week, caps, unknown tool, bad table | `cloud-core` |
| Auth | `tools/qa-mcp-auth.cjs` (new) | no credential, fake key, bad key, expiry, revocation; tool-layer refusal only | `cloud-auth` |
| Scope | `qa-api-keys.cjs` P12–P17 | section projection + budget switches | `cloud-core` |
| Catalog | `tools/qa-mcp-catalog.cjs` (new) | weather hidden, pagination fields, schemas | `cloud-core` |
| Budget semantics | `tools/qa-mcp-budget.cjs` (new) | unset envelope, weekly default, future spend flag | `cloud-core` |
| Parity | `tools/qa-mcp-parity.cjs` (new) | project vs app-wide catalog/refusal/output | `cloud-auth` |
| App-wide | `tools/qa-appwide-mcp.cjs` | OAuth/PKCE, free tier, allow_read/subset, mcp_enabled, view role, list/create | `cloud-auth` |
| Landing counts | `qa-marketing.cjs` mkt-03, `tools/qa-bento-gate.cjs`, `tools/qa-landing-ui.cjs` U-12 | 16 cards after the MCP card | `static` / `browser-app` |
| Static | `npm run verify` | CSP, SW, CSS integrity, registry | `static` |

**Performance gate:** 30 mixed calls (10 reads, 10 budget reads, 10 single-diff
writes) with zero 5xx and zero 1102. Record the p95 latency.

---

## 7. Landing page — add the MCP feature

**File:** `index.html`, features section (`#features`).

### 7.1 Placement

Add a new `.fcard` **immediately after** `#f-ai` (the AI card), so the two
AI-related capabilities sit together. Add the same label to the motion-free
`#features-all` list so screen readers and no-JS users can reach it (the bento
slots are `aria-hidden`).

### 7.2 Exact markup

```html
<article class="fcard" role="listitem" id="f-mcp">
  <span class="fc-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V4a3 3 0 0 1 6 0v3"/><rect x="4" y="7" width="16" height="10" rx="2"/><path d="M8 17v3M16 17v3"/></svg></span>
  <div class="fc-icon"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-key"></use></svg></div>
  <h3>Open MCP Server</h3>
  <p>Connect Claude, Cursor or your own scripts to the live project. They read only the sections you grant, and every change they propose waits for your approval — nothing lands on its own.</p>
</article>
```

### 7.3 Copy rules

- Plain language: name the benefit, not the protocol. "Connect Claude, Cursor or
  your own scripts" then "every change waits for your approval".
- No emoji. No overclaim ("full autonomy", "auto-fix", "no review").
- Keep the existing 15-panel claim truthful. Update the intro sentence to:

```html
<p><span data-count="panels">15</span> panels, wired together, plus an open MCP
server any AI client can connect to. Enter a number once and it shows up
everywhere it matters.</p>
```

Do **not** change `PANEL_COUNT = 15`: MCP is a connector, not an app panel.

### 7.4 Gates to re-baseline in the same commit

These currently hard-assert 15 cards and will fail:

| File | Line / check | Change |
|---|---|---|
| `qa-marketing.cjs` | mkt-03 title + `cards.length === 15` | 16 cards (15 panels + MCP) |
| `tools/qa-bento-gate.cjs` | `poolCards === 15` | 16 |
| `tools/qa-bento-gate.cjs` | sr list `=== 15` + name regex | 16, add `MCP` |
| `tools/qa-bento-gate.cjs` | `CARDS = 15`, `seen.size === 15` | 16, title 16 cards |
| `tools/qa-landing-ui.cjs` | U-12 `feat.cards === 15` | 16 |

Also update the stale comment in `js/marketing.js` ("15 real .fcard nodes") to
"16 feature cards (15 panels + the MCP connector)". Rotation still works: with
16 cards, indices 0–15 are all seen within 60 s (initial 0–3, then 4–15).

### 7.5 Landing verification

- Desktop 1440, laptop 1280, tablet 768, phone 390.
- The card rotates in, no layout shift, no overflow, no duplicate id.
- Keyboard/screen-reader path reaches "Open MCP Server" through `#features-all`.
- No emoji scan hits. `node tools/verify-css-integrity.cjs` passes.
- `npm run verify` passes.

---

## 8. Structured prompts (copy-paste)

### Prompt P1 — repair the project MCP write path

```
You are fixing the project-scoped MCP server in this repository.

READ FIRST: MCP-DIRECTIVE-2026-11-11.md (all of it), mcp-correction-payload.json,
and docs/DEVELOPER-GUIDE.md. Do not read or apply the payload to live state.

SYMPTOM: POST /api/mcp/:projectId with a valid key returns Cloudflare 1102
(worker_exceeded_resources) for apply_changes, even with {} or one diff. Read
tools work after a cool-down; budget tools and get_table also fail.

GOAL: make apply_changes work for 0/1/30/200 diffs and keep every other tool
healthy under mixed load.

STEPS
1. Reproduce locally with the QA harness, not the live site: start wrangler dev
   on a unique port with state under $HOME, never tmp/ in the repo.
2. Instrument the write path: state load, scope merge, proposal insert. Log
   elapsed ms and operation counts behind a debug flag.
3. Remove per-diff deep clones and per-diff network I/O. Build record indexes
   once. Materialise arrays in one pass. Queue exactly one cloud_reviews row.
4. Add envelope caps before state load. Empty payload returns a validation error.
5. Add a CPU/time ceiling that aborts with MCP_WRITE_BUDGET_EXCEEDED before the
   platform limit.
6. Fix invalid targetDate/week validation with one strict ISO parser and bounded
   loops.
7. Add tools/qa-mcp-write-path.cjs and tools/qa-mcp-args.cjs. Register both in
   docs/CI-TEST-COVERAGE.md and ci.yml.
8. Run: node build.js, npm run verify, the new harnesses, qa-api-keys P12-P17,
   and a 30-call mixed loop. Record the result.

RULES: no auto-apply, no HTTP 401 on the handshake, no fork of the app-wide
logic, no test weakening, no AI attribution in the commit.

DELIVERABLE: green gates, a short root-cause note, and the exact commit hash.
```

### Prompt P2 — integrate the app-wide MCP server

```
You are working on the app-wide MCP server (/api/mcp). Another agent is fixing
the project-scoped server (/api/mcp/:projectId). Both must share one contract.

READ FIRST: MCP-DIRECTIVE-2026-11-11.md, especially §3 and §5.

RULES
1. Do not copy the project executor. Import it or call it through a thin
   adapter. One tool registry, one scope projector, one proposal pipeline.
2. Keep your own gates: OAuth AS + PKCE, bearer refusal, free-tier premium
   refusal, disabled/block_all, allow_read, allow_subset, no-access,
   mcp_enabled=0, view-role write block, owner read clears every gate.
3. Every project-scoped tool requires projectId. list_projects and
   create_project are the only project-less tools.
4. Keep the review gate: an app-wide write queues a proposal; it never applies.
5. Add tools/qa-mcp-parity.cjs: for each shared tool, compare name, schema,
   refusal text and projected output between the two endpoints. Fail on drift.
6. Extend tools/qa-appwide-mcp.cjs with the write-path cases: empty, one diff,
   30 diffs, view-role refusal, out-of-scope refusal, mcp_enabled=0.
7. Register the parity harness in docs/CI-TEST-COVERAGE.md and ci.yml.

DELIVERABLE: both endpoints green on their own gates plus parity; a one-page
contract note listing any intentional differences.
```

### Prompt P3 — landing page feature

```
Add the MCP feature to the landing page (index.html) exactly as specified in
MCP-DIRECTIVE-2026-11-11.md §7.

1. Insert the #f-mcp card immediately after #f-ai.
2. Add "Open MCP Server" to #features-all.
3. Update the intro sentence to keep "15 panels" truthful.
4. Do not change PANEL_COUNT.
5. Re-baseline the five card-count assertions listed in §7.4 in the same commit.
6. Verify at 1440/1280/768/390, no layout shift, no duplicate id, no emoji.
7. Run node build.js and npm run verify.

DELIVERABLE: screenshot or DOM proof of the card, gate results, commit hash.
```

---

## 9. Rollout checklist

1. Local repro fails as expected (`apply_changes {}` → 1102 or the local
   equivalent).
2. Fix implemented; new harnesses red before, green after.
3. `node build.js`; `npm run verify`; targeted `qa-*.cjs` green.
4. Deploy from a clean staging copy under `$HOME`, verify the staged files carry
   the new code before `wrangler deploy`.
5. Live probe: handshake, `tools/list`, 10 mixed reads, `apply_changes {}`
   (expect validation error), 1-diff proposal, `get_proposal_status`.
6. Submit `mcp-correction-payload.json`; owner approves.
7. Re-read summary, tasks, risks, budget; confirm the acceptance criteria.
8. Rollback plan: previous Worker version + no proposal applied; the queue row
   is rejectable.

---

## 10. Acceptance criteria (all binary)

1. `apply_changes {}` → structured `isError`, never 1102.
2. 1/30/200 diffs → one receipt each, no 1102.
3. 30 mixed calls → zero 5xx, zero 1102.
4. `targetDate:"not-a-date"` → tool error, endpoint healthy afterwards.
5. `week:"2026-13-45"` → tool error.
6. Unset envelope → `null` remaining, not a negative plan.
7. Default weekly view never future-dated.
8. API-key catalog hides `get_weather`.
9. Summary returns a health score or stops promising it; `openRisks` matches
   open statuses.
10. `get_tasks` supports `limit`/`cursor`; default ≤ 50 records.
11. 429 carries a JSON-RPC error and `Retry-After`.
12. Project and app-wide catalogs pass parity.
13. Landing page shows the MCP card and all card-count gates are green at 16.
14. `npm run verify` green; new harnesses registered in CI.
15. `mcp-correction-payload.json` is not applied until the owner approves it.

---

## 11. Artifacts

- `MCP-DIRECTIVE-2026-11-11.md` — this file.
- `mcp-correction-payload.json` — 30 prepared diffs (11 tasks, 11 risks).
  It is **not applied**. It becomes the acceptance test for the write path.
