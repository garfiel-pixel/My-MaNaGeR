# MCP working baseline — 2026-11-12

Status: **VERIFIED WORKING WITH CLAUDE**. This file records the exact contract
that connected a real Claude client end to end. Everything in the
MCP-AGENT-FIRST-DIRECTIVE builds on top of it; none of it may regress.

Deployed from `origin/main` `b68c6a3` as Worker version
`6724be49-0c05-4aaa-b4f5-0b85ef503ea8`, shell `mmgr-shell-v650`, D1 migration
`0039`. Host: `https://mymanagerworkspace.com`.

## 1. What "working" means

The owner added the connector in Claude, pressed Allow on the consent page, and
the client then called tools and queued proposals that the owner could accept
inside the app. That is the baseline:

1. Discovery answers without auth:
   - `GET /.well-known/oauth-protected-resource`
   - `GET /.well-known/oauth-protected-resource/api/mcp` (the path-suffixed probe)
   - `GET /.well-known/oauth-authorization-server`
2. `POST /api/mcp` with no token answers **401** and a
   `WWW-Authenticate: Bearer resource_metadata="…"` challenge. The challenge is
   the only thing that makes a client start OAuth.
3. Dynamic client registration (`POST /api/oauth/register`, RFC 7591) accepts an
   unregistered client and returns a client id.
4. `GET /api/oauth/authorize` renders the branded consent page. It names the
   client, the signed-in Google account, and the tool policy. It refuses when no
   human is signed in (the account is bound at consent time).
5. `POST /api/oauth/authorize` issues a single-use code.
6. `POST /api/oauth/token` exchanges code + `code_verifier`. The challenge is
   **base64url SHA-256** (RFC 7636). The pre-2026-11-12 plain-hex challenge made
   Claude and Cursor fail with `PKCE verification failed`; the base64url fix is
   the reason this baseline exists.
7. `POST /api/mcp` with the bearer token answers `initialize` and `tools/list`,
   then `tools/call`.
8. `apply_changes` queues a **pending** `cloud_reviews` row. Nothing is written
   to `projects/<id>/latest.json` until the owner accepts it in the app.
9. The owner sees the proposal in the project's review queue, accepts it, and the
   project state, changelog and revision change.

## 2. Endpoints (source of truth)

| Surface | Route | Auth |
|---|---|---|
| App-wide MCP | `POST /api/mcp` | OAuth bearer (`mcp_tokens`, account-scoped) |
| Per-project MCP | `POST /api/mcp/:projectId` | `X-API-Key: sk-mmgr-…` or owner code |
| PRM metadata | `/.well-known/oauth-protected-resource[/api/mcp]` | public |
| AS metadata | `/.well-known/oauth-authorization-server` | public |
| DCR | `POST /api/oauth/register` | public (rate-limited) |
| Consent | `GET/POST /api/oauth/authorize` | Google session |
| Token | `POST /api/oauth/token` | code + PKCE verifier |
| Admin config | `GET/PUT /api/mcp/config` | Google session |
| Admin clients | `GET /api/mcp/clients`, `POST /api/mcp/clients/revoke` | Google session |
| Per-project switch | `PUT /api/mcp/projects/:id/enabled` | Google session |

Implementation: `src/mcp/oauth.js`, `src/mcp/appwide.js`, `src/mcp/server.js`,
routes in `src/router.js` (section 8c and the `/api/mcp` block).

## 3. Tool catalog at baseline

App-wide (`APPWIDE_TOOLS`, every project tool takes `projectId`):

- `list_projects`
- `create_project` (Premium only)
- `get_project_summary`
- `get_tasks`
- `get_budget`
- `get_deliveries`
- `get_weekly_summary`
- `get_risks`
- `get_weather`
- `get_meetings`
- `get_table`
- `run_monte_carlo`
- `apply_changes` (diffs, creates, sets, budget; queues only)

Per-project (`TOOLS`): the same read tools plus `get_proposal_status` and
`apply_changes`, without `projectId`.

Both servers share `executeTool` and `queueMcpProposal`. A read answer must never
differ between them for the same project and grant.

## 4. Proposal pipeline at baseline

- `apply_changes` validates the envelope (`validateProposalEnvelope`), applies
  the ops to a **copy** of the live state, diffs copy vs live
  (`cloudDiffState`), enriches each leaf with record id/name and affected
  surfaces (`enrichDiffs`), and inserts a `cloud_reviews` row:
  `proposal_type='mcp'`, `source_type='api'`, `status='pending'`,
  `submitted_json`, `diffs_json` (capped 500), `proposal_json` for budget.
- Accept (`handleReviewAccept`) reads the live state, applies the stored leaves
  field by field against the current values (`applyLeafDiffs`), refuses the
  whole accept with 409 `stale` when a `before` moved, merges under the
  proposal's scope (`cloudScopeMerge`), writes R2, updates
  `cloud_projects.latest_r2_key`, and writes one `cloud_changelog` entry.
- Reject marks the row `rejected` and writes a `rejected` changelog entry.
- Budget proposals go through `buildBudgetProposal` (server-side money
  validation, large-change flags, 10 large changes per day per key).

## 5. Admin surface at baseline

`admin.html` carries the MCP card (`#mcp-admin-card`, a `DETAILS` disclosure)
with the brand mark, a truthful state chip, the connection URL, copy, policy,
per-project switches and connected clients. The rail has the MCP Server submenu
under **Go**. `js/app/mcp-admin.js` drives it against `/api/mcp/config` and
`/api/mcp/clients`.

Known limitation at baseline, fixed by the next wave: the card lives at the
bottom of a long admin page and proposals are accepted only inside the project
UI, so MCP has no management area of its own.

## 6. Verified gates at baseline

- `tools/qa-mcp-live-e2e.cjs` — 33/33 (real headless Chrome, real accept click,
  stale refusal, PKCE exchange).
- `tools/qa-mcp-admin-panel.cjs` — 20/20.
- `tools/qa-mcp-parity.cjs` — 13/13.
- `tools/qa-mcp-write-path.cjs` — 20/20.
- `tools/qa-mcp-budget.cjs` — 46/46.
- `tools/qa-appwide-mcp.cjs` — 55/55.
- `npm run verify` — green (static gates, unit suite, sizes, registry).
- Live probes: `/api/health` 200; `/api/mcp` POST without a token 401 with the
  metadata challenge; favicon and apple-touch icons 200.

## 7. Do not regress

These are baseline contracts. Every later phase must keep them:

1. Discovery and the 401 challenge stay unauthenticated and unchanged in shape.
2. PKCE challenges stay base64url; codes stay single-use and short-lived.
3. `tools/list` names and schemas stay identical between the two servers apart
   from `projectId`.
4. `apply_changes` never writes live state. Only an owner decision does.
5. Scope enforcement at queue time and merge time (`cloudScopeMerge`).
6. `PROTO_KEYS` guard, budget-line undeletability, `buildBudgetProposal` money
   checks, budget stale refusal.
7. The first sentence of the queue response stays
   `Queued N field change(s) for owner review (proposal #ID).`
8. `get_tasks` keeps the output name `dependencies` (parity harness asserts it).

## 8. How to re-verify this baseline

```bash
node build.js
npm run verify
node tools/qa-mcp-live-e2e.cjs
node tools/qa-mcp-write-path.cjs
node tools/qa-mcp-budget.cjs
node tools/qa-mcp-parity.cjs
node tools/qa-appwide-mcp.cjs
```

Then add the connector in a fresh client at `https://mymanagerworkspace.com/api/mcp`,
approve consent, run `list_projects`, then one `apply_changes` and accept it in
the app. The 2026-11-12 Claude run is the reference pass.
