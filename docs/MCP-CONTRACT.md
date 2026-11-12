# MCP contract note — project and app-wide servers

Date: 2026-11-11. Source of truth: `MCP-DIRECTIVE-2026-11-11.md` section 3.

## Endpoints

| Server | Route | Identity | Discovery |
|---|---|---|---|
| Project MCP | `POST /api/mcp/:projectId` | project API key (`Authorization: Bearer sk-mmgr-...` or `X-API-Key`) or owner code | none; the project is pinned by the URL |
| App-wide MCP | `POST /api/mcp` | OAuth 2.1 access token (PKCE S256), Google session or key | RFC 8414 authorization-server metadata + RFC 9728 protected-resource metadata |

Both handshakes and `tools/list` answer unauthenticated. Every `tools/call` refuses
inside the protocol with an MCP `isError` result; there is no HTTP 401/403 on the MCP
surface.

## Shared, not forked

- **Tool registry:** `TOOLS` in `src/mcp/server.js`. The app-wide catalog is derived from
  it, so every shared tool keeps the same name, description and input schema.
- **Executor / scope projector:** `executeTool` in `src/mcp/server.js`.
- **Proposal pipeline:** `queueMcpProposal` plus `validateProposalEnvelope` in
  `src/mcp/server.js`. One `cloud_reviews` row per proposal (`proposal_type: 'mcp'`),
  carrying the caller label, the time and the change summary. Nothing auto-applies.
- **Refusal text:** `MCP_AUTH_REFUSAL`, `MCP_PREMIUM_REFUSAL` and the envelope
  validator messages are shared constants, not copies.

## Intentional differences

1. **`get_proposal_status` is project-only.** The app-wide connector does not expose
   proposal status; it is answered inside the project. Everything else in the project
   catalog is shared, including `get_weekly_summary`.
2. **The app-wide surface adds `list_projects` and `create_project`.** Every other
   project-scoped tool on `/api/mcp` requires `projectId`; `create_project` is the only
   write tool that does not take one, because it names a new project.
3. **`apply_changes` on the app-wide surface appends one sentence** to the project
   description: the changes are queued for the owner to accept inside the project.
4. **Identity and policy differ by design.** The project surface is scoped by the API
   key's section list and budget switches. The app-wide surface additionally applies the
   account policy (`allow_all` / `allow_read` / `allow_subset` / `block_all`), the
   premium gate, the per-project `mcp_enabled` opt-out and the view-role write block.
   An adopted member's sections come from the editor code's real scope.

## Gates

| Harness | Proves |
|---|---|
| `tools/qa-mcp-parity.cjs` | catalog, schema, refusal and projected-output parity; fails if the executor, pipeline or validator is forked |
| `tools/qa-mcp-write-path.cjs` | project write path: empty / 1 / 30 / 200 diffs, the 500 cap, scope refusal, strict dates, envelope and weekly semantics |
| `tools/qa-appwide-mcp.cjs` | OAuth AS + PKCE S256, token rotation, metadata, CSP-safe consent, every account/project gate, and the write path |
| `tools/qa-mcp-admin.cjs` | account config, client revoke and project opt-out admin API |
| `tools/qa-mcp-budget.cjs` | project budget read/propose switches, proposal-only writes and the decision feed |

## Deferred

The landing-page `#f-mcp` card shipped in T-06 (2026-11-12), so it is no longer
deferred. The detailed proposal-review UI (record names and before/after values)
is still out of this pass.
