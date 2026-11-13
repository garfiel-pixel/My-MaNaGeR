# Project API Key / External-AI-Connection — Audit & Directive
**Date:** 2026-09-16
**Scope:** the "let someone use an API key to connect an AI to this one project" feature
**Role:** audit only. This document is a directive for the coding AI to implement — nothing in this repo was edited.
**Source verified against:** `mymanager-fixed` zip, commit `766428e` (working tree), specifically commit `f377f76 feat(keys,dash): project API keys end to end + dashboard dot mechanism`

---

## Headline finding

**Two separate, disconnected implementations already exist for "an AI connects to a project."** They were built at different times and were never unified:

| | REST scoped key (`sk-mmgr-…`) | MCP server |
|---|---|---|
| Built | 2026-09-15 (commit `f377f76`) | earlier |
| Files | `src/cloud/api-keys.js`, `cloudAuthApiKey` in `src/lib/http.js`, migration `0020_cloud_api_keys.sql`, UI in `js/cloud/share.js` | `src/mcp/server.js`, routed at `/api/mcp/:projectId` |
| Auth credential | Per-key `sk-mmgr-XXXXXX-XXXXXX-XXXXXX`, minted inside a project, revocable independently | The project's **full owner code**, via `Authorization: Bearer <owner-code>` |
| Section scope (`CLOUD_SECTIONS`) enforced? | **Yes** — reads projected through `cloudScopeState`, writes merged through `cloudScopeMerge` | **No** — every `get_*` tool returns the complete raw section, unconditionally |
| Writes | Always queued to `cloud_reviews` (`proposal_type: 'api'`) — owner must Accept | Calls `/changelog/import` directly (see Finding 3 — this path does not actually write new state) |
| Rate limited | Yes (`rl(request,'general',env)` in `src/router.js`) | **No** — the one route in the whole file with no `rl()` call |
| Revocable independent of everything else | Yes | No — revoking means rotating the owner code, which breaks every other owner-authenticated tool too |

This matters because **MCP is the pathway a real external AI client (Claude Desktop, Cursor, Windsurf) actually uses** — it's the literal "connect an AI to my project from somewhere else" feature you're asking about — and it is the one still running on the *old*, unscoped, full-authority credential, not the new key system built specifically to solve this. The new `sk-mmgr-` system currently only guards the plain REST `/load` and `/save` endpoints.

**Recommended direction (detailed as a directive below):** don't build a third system. Make MCP a second transport on top of the `cloud_api_keys` system that already exists — same mint/list/revoke UI, same scope enforcement, same review queue. One key, usable either as a `curl`-style bearer header or pasted into an MCP client config, revoked from one place.

---

## Findings, in priority order

### 1. `HIGH` — MCP endpoint has no rate limiting
`src/router.js`, route match for `/api/mcp/:projectId` (search `mcpMatch`): every other route in this file calls `const r = await rl(request, '...', env); if (r) return r;` before dispatching. The MCP route is the **only one that skips this**. Since MCP auth currently checks the full owner code (a 20-ish-char high-entropy string, but still the single credential that unlocks everything), an unthrottled endpoint is the wrong place to be checking it — every sibling code/credential check in this codebase (editor codes, view codes, client codes, the new API keys, `/save`, `/load`) is rate-limited; this one credential check, arguably the most powerful one, currently isn't.

**Fix:** add the same `rl(request, 'general', env)` guard used everywhere else, before `handleMcpServer` is called.

### 2. `HIGH` — MCP still authenticates with the full owner code, not a scoped key
`src/mcp/server.js`, `handleMcpServer()`: takes `Authorization: Bearer <code>`, routes it into `X-Owner-Code`, and calls `cloudAuthOwnerEither` — the same full-authority check used by project delete, editor management, and review accept/reject. Anyone who holds an MCP-connected AI's config today effectively holds the project's master credential, not a scoped, revocable, single-purpose one. This directly contradicts the stated goal ("the API key is only reflective onto that project... not used for any other project" implies scoped, but it also implies **contained** — right now it isn't contained even within the project, since the owner code also manages editors, deletes the project, and accepts every other pending review).

**Fix:** see the directive section below — add `X-API-Key` support to `handleMcpServer`, authenticating via the existing `cloudAuthApiKey`, exactly like `/load` and `/save` already do.

### 3. `HIGH` — MCP's `apply_changes` tool does not do what its own description says
`src/mcp/server.js`, tool definition for `apply_changes`:
> "Submit field-level changes to the project. Goes through owner review queue - never auto-applied."

What it actually calls, on `pendingApply`, is an internal `fetch` to `/api/cloud/projects/:id/changelog/import` (`src/cloud/changelog.js`, `handleCloudChangelogImport`). That handler:
- requires full owner auth (fine, it's still the owner-code path here)
- does **not** write the new state anywhere (no R2 put, no `cloud_projects.latest_r2_key` update)
- only **verifies** that the current stored state *already* matches each diff's `after` value (`cloudVerifyImportedDiffs`), and if so, records a changelog line for it

In other words this endpoint is an **audit-log importer for changes that already happened by some other means** — it is not a write path and not a review-queue path. There is no code anywhere in the MCP flow that actually mutates project state from an MCP-submitted diff. Given `cloudVerifyImportedDiffs` requires the diff to already be true, a genuinely new change submitted via `apply_changes` will reliably come back `skipped: 'field X diverged from the MCP edit'` — the tool is effectively non-functional for its stated purpose right now.

(Worth noting: `handleReviewAccept` in `src/reviews.js` already has a live `proposal_type === 'mcp'` branch that inserts into `cloud_changelog` from a `cloud_reviews` row. That's the *other* half of a review-queue design that was apparently planned for MCP — but nothing in `src/mcp/server.js` currently creates that `cloud_reviews` row. The plumbing for "MCP proposals go through review" exists on the accept side and is simply never triggered from the MCP side.)

**Fix:** see directive below — have `apply_changes` create a `cloud_reviews` row (`proposal_type: 'mcp'`) instead of calling `/changelog/import`, mirroring what `handleCloudSave`'s `X-API-Key` branch already does for REST.

### 4. `HIGH` — MCP tools ignore section scope entirely
`src/mcp/server.js`, `executeTool()`: `get_tasks`, `get_budget`, `get_risks`, `get_weather`, `get_meetings`, `get_project_summary` all read the full state object and return their section's data unconditionally. There is no `CLOUD_SECTIONS` / scope check anywhere in this file — contrast with `handleCloudLoad`'s API-key branch (`src/cloud/projects.js`), which projects the response through `cloudScopeState(state, ka.scope)` so a key granted only "Budget" cannot see tasks or stakeholders. Today, *if* MCP auth is narrowed to a scoped key (Finding 2's fix), the tools still need their own scope check or the scoping is cosmetic — a "Budget-only" MCP key would still be able to call `get_tasks` and get everything.

**Fix:** in `executeTool`, filter/reject by the caller's granted sections the same way `cloudScopeState` does, before returning a tool result.

### 5. `MEDIUM` — timing side-channel in `cloudAuthApiKey`
`src/lib/http.js`, `cloudAuthApiKey()` (~lines 905–936). The function's own header comment states: *"expiry + revocation + deleted-project all collapse into the SAME generic 403 as unknown/revoked ones (no existence leak)."* That's true of the **JSON response**, but not of **timing**:
- unknown fingerprint → `hashOwnerCode` (dummy) + `cloudTimingSink()` → floored delay
- wrong hash → `cloudTimingSink()` → floored delay
- **correct hash, but `expires_at` in the past** → `return null` immediately, **no `cloudTimingSink()`**
- **correct hash, but `deleted_at` set on the project** → `return null` immediately, **no `cloudTimingSink()`**

A caller who has captured an expired or orphaned key (e.g. from a leaked log, an old integration config) gets a measurably faster rejection than a caller guessing blind — a real, if narrow, deviation from the stated invariant (narrow because the key itself is ~90 bits of entropy, so this isn't a practical brute-force vector by itself — it's a correctness gap against the file's own documented guarantee, and worth closing since the rest of this function is written specifically to avoid exactly this class of leak).

**Fix:** route both branches through `await cloudTimingSink();` before returning `null`, same as the sibling branches in the same function.

### 6. `LOW` — soft race on the 10-key cap
`src/cloud/api-keys.js`, `handleCloudApiKeyCreate`: the active-key count check (`SELECT COUNT(*) ... WHERE active = 1`) and the subsequent `INSERT` are not atomic. Two near-simultaneous create calls from the same owner could both pass the count check and land 11 active keys instead of the intended max 10. Low severity — this is a UX/resource soft-cap on an owner-only, already-authenticated endpoint, not a security boundary — but flagging for completeness since precision was asked for.

**Fix (optional, low priority):** either wrap count+insert in a D1 batch/transaction, or just accept the soft cap as-is; not worth the complexity unless you're seeing it happen in practice.

### 7. `LOW` — naming collision that will confuse you or a support ticket later
`js/mmgr-ai-key.js` ("BYO AI Key session vault") is a **completely unrelated** feature — it's where a project owner pastes *their own* OpenAI/Gemini/Anthropic key so the in-app AI **assistant** chat has something to call. It has nothing to do with `cloud_api_keys` / `sk-mmgr-` keys (external AI **connecting to** the project). Both are reasonably called "the AI key" in casual conversation. Recommend the UI copy for each explicitly distinguishes "key you give the assistant to think with" vs. "key you give an external tool so it can read/propose changes to this project" — not a code fix, just a labeling note so this doesn't get mixed up later (including by your own coding AI, mid-directive).

### 8. `NOTE`, not a bug — what "different tab" can mean here
`sameOriginOnly()` (`src/lib/http.js`) passes any request with **no `Origin` header at all**, and only rejects cross-origin requests that **do** send one. Server-side callers (a Python/Node backend, an MCP client such as Claude Desktop running locally, `curl`, n8n, Zapier) don't send `Origin`, so they pass through fine today with either credential type. A **browser-based** agent making a `fetch()` from a different website's tab, by contrast, *will* send `Origin` and *will* get the generic `403 cross-origin requests are not allowed`. If what you actually picture is "a browser extension / another website's tab talks to my project directly," that's currently blocked by design and would need an explicit allowlisted-origin exception (a materially different, higher-risk change than anything above, since it opens a browser-CSRF-shaped attack surface that today's design deliberately avoids). If what you picture is "a locally-run or server-side AI agent, in its own process, holding a key" — which is how MCP clients, and virtually every third-party AI integration, actually work — nothing here needs to change. Worth confirming which one you mean before anything gets built on top of this.

---

## Directive: unify MCP onto the existing scoped-key system

This is the shape I'd hand to the coding AI, in order:

1. **`src/mcp/server.js` — accept `X-API-Key` alongside the owner-code Bearer.**
   In `handleMcpServer`, before falling back to the owner-code path, check for `X-API-Key` (or a `Bearer sk-mmgr-...` value — same header, just recognize the prefix) and authenticate it via the already-existing `cloudAuthApiKey(request, env, projectId, key)` from `src/lib/http.js`. On success, carry `{ role: 'api', scope, apiKeyId, label }` through exactly like the owner path carries `auth` today. Keep the owner-code Bearer path working too (an owner may legitimately want full-access MCP), but the new scoped key becomes the recommended credential to hand to a third-party AI client.

2. **`src/mcp/server.js`, `executeTool()` — enforce scope on every `get_*` tool.**
   Reuse `cloudScopeState(state, auth.scope)` (already imported/used in `src/cloud/projects.js`) to filter what each tool can see when `auth.role === 'api'`. Owner-code Bearer callers keep full access (parity with today).

3. **`src/mcp/server.js`, `apply_changes` — queue instead of import.**
   Replace the `fetch('http://internal/.../changelog/import', ...)` call with the same `cloud_reviews` insert pattern `handleCloudSave`'s API-key branch already uses in `src/cloud/projects.js` (`proposal_type: 'api'` there — use `'mcp'` here, since `handleReviewAccept` already has a live branch for it). Run the submitted diffs through `cloudScopeMerge(prev, submitted, auth.scope)` first, exactly like the REST path, so a scoped MCP key can only propose changes inside its granted sections. This makes the tool's own description ("Goes through owner review queue - never auto-applied") actually true, and gives it the same safety property REST already has: nothing an external AI sends ever touches live project data until the human owner clicks Accept.

4. **`src/router.js` — add the missing rate limit.**
   One line: `const r = await rl(request, 'general', env); if (r) return r;` before `return handleMcpServer(...)`, matching every other route in the file.

5. **`src/lib/http.js`, `cloudAuthApiKey` — close the timing gap.**
   Add `await cloudTimingSink();` to the `expires_at` and `deleted_at` rejection branches, matching the other two rejection branches in the same function.

6. **UI (`js/cloud/share.js`) — offer both usage modes from one minted key.**
   Once 1–3 are done, the existing "shown once" key banner can show two snippets instead of one: the current `X-API-Key: <key>` REST example, plus an MCP client config block (`Authorization: Bearer <key>`, or `X-API-Key`, pointed at `/api/mcp/:projectId`). Same key, same revoke button, both surfaces die together. This is the natural finish line for "connect through AI from a different tab" — one key, minted inside the project, scoped to sections, expiring or revocable on your terms, that works whether the AI talks REST or MCP.

Steps 4 and 5 are small, mechanical, and safe to do first/independently. Steps 1–3 are the real feature work and should land together, since an MCP endpoint that accepts a scoped key but doesn't yet enforce scope on reads (2) or writes (3) would be worse than today's honest-if-broad owner-code-only version.
