# MCP contract note — project and app-wide servers

Date: 2026-11-11. Source of truth: `MCP-DIRECTIVE-2026-11-11.md` section 3.

## Endpoints

| Server | Route | Identity | Discovery |
|---|---|---|---|
| Project MCP | `POST /api/mcp/:projectId` | project API key (`Authorization: Bearer sk-mmgr-...` or `X-API-Key`) or owner code | none; the project is pinned by the URL |
| App-wide MCP | `POST /api/mcp` | OAuth 2.1 access token (PKCE S256, public client) | RFC 8414 authorization-server metadata + RFC 9728 protected-resource metadata |

The project surface keeps the PATH-A rule: the handshake and `tools/list` answer
unauthenticated, and every `tools/call` refuses inside the protocol with an MCP
`isError` result.

The app-wide surface is different on purpose (T-26, 2026-11-12): an external
connector only starts OAuth when the endpoint answers `401` with

```
WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource"
```

so `/api/mcp` answers every request without a valid bearer with that 401 (and
`error="invalid_token"` when a bearer was supplied but failed). The handshake and
`tools/list` therefore require a token too.

## Connecting an external client (Claude, Cursor, ChatGPT)

- **Connection URL:** `https://mymanagerworkspace.com/api/mcp`. The admin page's
  MCP server card shows it with a Copy button and the Claude steps.
- **Registration is open** (RFC 7591). The client registers from its own servers,
  where no browser session exists, so `POST /api/oauth/register` no longer
  requires one. It must send 1 to 5 `redirect_uris`; each must be HTTPS (plain
  HTTP only for `localhost` / `127.0.0.1`), with no fragment.
- **The redirect list is the security boundary.** `GET/POST /api/oauth/authorize`
  refuses any `redirect_uri` that is not an exact member of the registered list,
  and requires PKCE S256. The account is bound on the first approval, which is
  what puts the client in the admin panel's Connected clients list.
- **Claude setup:** Customize > Connectors > + Add > Add custom connector, paste
  the URL, Authentication **Sign in now**, OAuth client **Register
  automatically**, then Connect and press Allow on the My MaNaGeR page.

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
| `tools/qa-appwide-mcp.cjs` | OAuth AS + PKCE S256, open DCR with redirect-URI enforcement, the 401 metadata challenge, token rotation, metadata, CSP-safe consent, every account/project gate, and the write path |
| `tools/qa-mcp-admin.cjs` | account config, client revoke and project opt-out admin API |
| `tools/qa-mcp-admin-panel.cjs` | the admin.html MCP panel: signed-out 403 hint, signed-in render, policy-driven tool picker, and the exact save / project toggle / revoke requests |
| `tools/qa-mcp-budget.cjs` | project budget read/propose switches, proposal-only writes and the decision feed |

## Connector compatibility research: ChatGPT and Gemini (2026-11-20)

Status: planning note only. This section records what was verified against the
current vendor documentation and this codebase. No code was changed for it.

### What the server already satisfies

`authorizationServerMetadata` (`src/mcp/oauth.js`) advertises `issuer`,
`authorization_endpoint`, `token_endpoint`, `registration_endpoint`,
`scopes_supported: ['account']`, `response_types_supported: ['code']`,
`grant_types_supported: ['authorization_code', 'refresh_token']`,
`code_challenge_methods_supported: ['S256']` and
`token_endpoint_auth_methods_supported: ['none']`. `/.well-known/oauth-authorization-server`
answers 200, which is the first path both vendors probe. `/api/mcp` answers an
unauthenticated request with 401 and a `resource_metadata` challenge, and every
tool already carries `readOnlyHint` / `destructiveHint` / `idempotentHint`
annotations via `tool-meta.js` (Google asks for exactly this).

| Vendor requirement | This server |
|---|---|
| Public OAuth client, no secret, PKCE S256 | Yes (`registerClient` returns `token_endpoint_auth_method: 'none'`; S256 is required at `/authorize`) |
| Dynamic Client Registration advertised | Yes (`registration_endpoint`) |
| Open registration usable from a vendor server | Yes (T-26; the account binds at consent) |
| Redirect URI exact-match enforcement | Yes (`handleOauthAuthorize`, `exchangeCode`) |
| Google redirect hosts (`oauth-redirect.googleusercontent.com/r/*` and `/a/*`, plus sandbox/test) | Accepted: any HTTPS URI is a valid registration (`isAllowedRedirectUri`) |
| Refresh token issued | Yes (30-day refresh) |
| Client secret | Not issued, and not required by either vendor for a public PKCE client |

### Correction to the 2026-11-20 working note

1. **Gemini does not require a client secret.** Google's Developer Mode guide
   makes the Client ID / Client secret fields part of *optional* Additional
   Settings ("If your server requires pre-registered OAuth credentials"), and
   Google's own developer forum answer (2026-11-12) confirms a public client
   with Authorization Code + PKCE may leave the secret blank. Google's OAuth
   guide expects **Dynamic Client Registration** and requires the
   `registration_endpoint` in metadata; manual client credentials are the
   fallback when DCR is absent or fails. So confidential-client support is not
   established as needed, and should not be built before a probe shows that it is.
2. **ChatGPT plan availability is narrower than first recorded.** The current
   OpenAI help centre lists full MCP (read and write tools) for **Business,
   Enterprise and Edu** on the web only. **Pro** users can build Apps SDK apps
   and connect custom MCP servers with **read/fetch only**. A personal **Plus**
   plan is not listed as able to connect custom MCP servers at all. Custom MCP
   connections are added from Plugins > + > Add custom MCP server; Developer
   Mode is no longer a separate switch.
3. **ChatGPT supports public clients and DCR, but prefers CIMD.** OpenAI still
   calls `registration_endpoint` when CIMD is unavailable, so this server can
   connect without CIMD. The MCP specification (2026-07-28) now deprecates DCR
   in favour of Client ID Metadata Documents, so CIMD is a forward-looking item,
   not a present blocker.

### Gaps and risks, in priority order

| # | Item | Affects | Severity | Shape of the change (planning only) |
|---|---|---|---|---|
| G1 | **Refresh tokens rotate.** `refreshTokens` revokes the old row and issues a new pair. Google explicitly asks for Persistent Linking: return the **same** refresh token and extend its expiry, or users are asked to link again. | Gemini | High (silent reconnect loop) | Keep the token row, extend `refresh_expires_at`, return the same refresh token. Rotation stays for clients that accept it only if a per-client flag is stored. |
| G2 | **DCR request shape.** OBSERVED 2026-11-26: Gemini posts six `redirect_uris` (production/sandbox/test relay hosts, each `/r/` and `/a/`) and asks for `token_endpoint_auth_method: client_secret_post`. The old handler allowed 1-5 URIs and only `none`, so it answered 400 twice over. | Gemini | **SHIPPED 2026-11-26** (see "Gemini DCR, observed body" below) | Cap raised to 10; a `client_secret_post`/`client_secret_basic` request is accepted and completed as a public PKCE client (RFC 7591 3.2.1 lets the server replace requested metadata; the response states `none`). No secret is issued. |
| G3 | **`offline_access` is not advertised or accepted.** `scopes_supported` is `['account']`. OpenAI's guidance tells users to confirm the provider advertises `offline_access` or an equivalent, or ChatGPT may lose access after the first hour. | ChatGPT | Medium | Add `offline_access` to `scopes_supported` and accept it in the authorize `scope` without changing stored scope semantics. |
| G4 | **No revocation endpoint.** Google lists it as optional; Claude and ChatGPT may call one on disconnect. Admin revoke exists, but a client-initiated disconnect leaves the token valid until expiry. | Both | Low | `POST /api/oauth/revoke`, hashed-token lookup, revoke row, 200 always. |
| G5 | **No CIMD support.** DCR is deprecated in the current MCP spec. | Both (future) | Low now | Accept an HTTPS `client_id` that resolves to a client metadata JSON document; validate its `redirect_uris` with the same policy. |
| G6 | **`resource` / audience is ignored.** Both vendors send RFC 8707 `resource`; the token carries no audience. | Both | Low (single MCP resource) | Store the resource with the code and check it at token exchange if a second resource is ever added. |

### Why Gemini showed a Client ID and Client secret form

The form is shown when Gemini is in **Manual Client Registration**, or when DCR
failed. It is not proof that a secret is mandatory. In Developer Mode the
Authentication tab has two explicit modes: **Dynamic Client Registration** and
**Manual Client Registration**. The plan should treat the observed form as a
symptom to diagnose, not as a requirement to implement against.

One code-side mismatch can still produce a valid reject: a client registered
manually on this server is created with no account, and `/authorize` only
accepts a `redirect_uri` that was in that registration. A hand-typed client ID
with no matching registration answers "This connector is not registered here."
That is working as designed, and it is why the probe must capture the
registration request before any code change.

### External gates that are not code

- **ChatGPT:** write-capable MCP needs Business, Enterprise or Edu; Pro is
  read/fetch only. Web only.
- **Gemini custom apps:** Google currently lists a personal Google account (not
  work or school), US, 18+, English UI, Activity on, web app only. Some
  third-party guides also require Google AI Pro or Ultra for Spark. Confirm the
  account qualifies before scheduling any Gemini work.
- Both vendors call the server from their own networks over public HTTPS, so a
  passing local or Inspector run does not prove connector success.

### Project-scoped server ("inside the project" MCP)

`POST /api/mcp/:projectId` is PATH-A by design: its handshake and `tools/list`
answer 200 without credentials, and only `tools/call` is gated, by a project API
key (`sk-mmgr-...`) or the deprecated owner code. An OAuth connector pointed at
that URL would see a successful handshake and never start sign-in, so ChatGPT
and Gemini cannot use the project URL. Cursor can, with a scoped project key in
a static bearer header.

Therefore the same connector work does **not** transfer to the project surface
by adding OAuth there. The app-wide surface already exposes every project tool
with a `projectId` argument, so one app-wide connection covers all projects. The
project URL stays the static-key surface. Making the project URL an OAuth
resource as well would require a 401 challenge on a route that deliberately does
not have one, and would break the existing static-key clients.

### Probe result (2026-11-21)

Run against production, read-only:

- `GET /.well-known/oauth-authorization-server` answers **200** with `issuer`,
  `authorization_endpoint`, `token_endpoint`, `registration_endpoint`,
  `scopes_supported: ['account']`, `response_types_supported: ['code']`,
  `grant_types_supported: ['authorization_code', 'refresh_token']`,
  `code_challenge_methods_supported: ['S256']` and
  `token_endpoint_auth_methods_supported: ['none']`. Discovery is not the problem.
- `POST /api/mcp` without credentials answers **401** with
  `WWW-Authenticate: Bearer resource_metadata="https://mymanagerworkspace.com/.well-known/oauth-protected-resource"`.
  The challenge is not the problem either.

Still unknown, and only observable from a real Gemini attempt: the exact body
Gemini posts to `/api/oauth/register`, whether a `mcp_clients` row appears, and
whether the browser is then sent to `/api/oauth/authorize`. The report "I paste
the link and it does not redirect" is consistent with a refused registration
(G2), not with a missing endpoint.

### Eligibility caveat to settle first

Gemini custom apps are documented as **US-only** for consumer accounts. The live
probes above answered from Cloudflare's Kingston edge, so if the Google account
is not US-based, Gemini may never complete the connector regardless of the
server. Settle that question before spending a wave on G1/G2.

### Probe sequence

1. In Gemini, select **Dynamic Client Registration** in the Authentication tab
   and connect.
2. Query D1 `mcp_clients` for a new Gemini row. A row means DCR succeeded and the
   redirect URI is registered; no row means the registration request was refused.
3. If no row, capture the next registration request (temporary Worker log, never
   committed as a permanent debug endpoint) and compare it with
   `handleOauthRegister`'s three constraints: auth method, `redirect_uris` count,
   URI policy.
4. If a row exists and `/authorize` still fails, diff the registered
   `redirect_uris` against the `redirect_uri` Gemini sends.
5. If the link works and then unlinks after about an hour, G1 is the cause; fix
   G1 before anything else.

### Planned work

**P0 - observe, no code.** Run the probe sequence above and record the outcome in
this section. Nothing else starts until the DCR request body is known.

**P1 - refresh sessions that survive (G1 + G3). SHIPPED 2026-11-26.** In
`src/mcp/oauth.js`, `refreshTokens` now keeps the token row and renews only the
access half, so the refresh token a client receives is the same string for the
life of the link and `refresh_expires_at` moves 30 days forward on every
refresh. The old access token stops verifying because its hash is replaced,
which keeps the revocation half of the old rotation. `offline_access` is in
`scopes_supported` and accepted at `/authorize`; the granted scope is stored on
the code and echoed at `/token`. Gate: `tools/qa-appwide-mcp.cjs` O6 proves the
same refresh token twice, a later expiry, one row, the new access token works,
the old one does not, and O15 proves the offline_access grant is echoed.

**P2 - revocation endpoint (G4). SHIPPED 2026-11-26.** `POST /api/oauth/revoke`,
hashed lookup on either half, revoke the row, always answer 200, advertised as
`revocation_endpoint` with `none` auth. Gate: O14 revokes the access half and
the refresh half, and an unknown token still answers 200.

**P3 - CIMD (G5), only if a vendor asks.** Accept an HTTPS `client_id` that
resolves to a client metadata document, validate its redirect URIs with the same
policy, keep DCR working.

Not planned unless the probe demands it: confidential-client support (G2's
second half). Google's docs and forum answer say a public PKCE client is valid,
so a secret is a workaround, not a requirement.

Gates extended with P1/P2: `tools/qa-appwide-mcp.cjs` O13 registers
`https://oauth-redirect.googleusercontent.com/r/<id>` (the exact production
Gemini redirect) and proves a sibling `/r/<other-id>` is still refused, so the
policy stays an exact-match boundary rather than a host wildcard. A
manually registered client with an unlisted redirect URI is still refused by
O11.

### Gemini connection record (2026-11-26)

The owner supplied the redirect Gemini hands out for a custom MCP app:
`https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-f6492779cacd5f618adb99b9`.
Probed against production, read-only first and then one registration:

- `/.well-known/oauth-authorization-server` answered **200** and `/api/mcp`
  answered **401** with the `resource_metadata` challenge.
- `POST /api/oauth/register` accepted that exact redirect and returned public
  client `mmgr_mc_44ad6b9150a7d6a530b81a47` (`token_endpoint_auth_method:
  none`). The row is unbound until a signed-in owner presses Allow.

That probe proved the redirect is *storable* when it arrives alone. It did NOT
prove Gemini's own registration succeeds: a deliberate single-URI POST is not the
body Gemini sends. The live attempt still failed with "The Google redirect URL
was rejected by the server". The real body and the three blockers it exposed are
recorded in the next section, and they were fixed on 2026-11-26.

If the row is ever lost, recreate it with the same body:

```
POST https://mymanagerworkspace.com/api/oauth/register
{"client_name":"Google Gemini",
 "redirect_uris":["https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-f6492779cacd5f618adb99b9"],
 "token_endpoint_auth_method":"none"}
```

Keep the project surface static-key only. The app-wide URL is the ChatGPT and
Gemini route; the project URL is the Cursor route.

### Gemini DCR, observed body (2026-11-26, second attempt)

Gemini still answered "The Google redirect URL was rejected by the server. Enter
your OAuth client ID and client secret to connect." after the P1/P2 deploy. That
message is emitted **at registration time**, before any consent page, so it
points at `POST /api/oauth/register`, not at the browser flow. Field reports
(litellm #46640, t3code #31308, the Google AI forum threads) show the body
Gemini's `OpenAuth` client actually sends:

```
{"client_name":"Google",
 "redirect_uris":[ six entries ],
 "response_types":["code"],
 "grant_types":["authorization_code","refresh_token"],
 "token_endpoint_auth_method":"client_secret_post"}
```

Six URIs = `oauth-redirect{,-sandbox,-test}.googleusercontent.com` x `/r/` and
`/a/` for the same `user_bound_custom-mcp-<id>`. Three defects followed:

1. **`MAX_REDIRECT_URIS` was 5.** Six entries -> 400 `invalid_redirect_uri`.
   Raised to 10. A cap below six is the single most-reported cause of this
   exact Gemini screen.
2. **Only `token_endpoint_auth_method: none` was accepted.** Gemini asks for
   `client_secret_post` -> a second 400 `invalid_client_metadata`. Secret-based
   requests are now accepted and answered as a public PKCE client, which is the
   documented working shape for Gemini (register, blank secret).
3. **The consent POST answered 302.** Chrome and Edge apply `form-action` to
   every hop of a form submission's redirect chain; Google's relay answers that
   302 with a second cross-origin redirect, so the Allow navigation is cancelled
   and `/token` is never called ("Cannot Complete Request"). `form-action 'self'`
   is unchanged: for Google's three relay hosts the POST now answers **200** with
   a `Cache-Control: no-store` meta-refresh bridge page plus a Continue link -
   an ordinary navigation, which `form-action` does not govern. Every other
   connector keeps its exact 302.

The session cookie is `SameSite=Lax`, so the consent GET arriving from Google's
relay still carries the sign-in session.

Gates: `tools/qa-appwide-mcp.cjs` O16 registers the real six-URI /
`client_secret_post` body (201, all six stored, answered `none`, offline scope
advertised) and still refuses `private_key_jwt`; O17 proves the relay approval
is a 200 `no-store` bridge carrying the code, not a 302; O12 keeps the plain 302
for an ordinary client; O13 keeps exact-match redirect enforcement. Suite result
90/90.

## Deferred

The landing-page `#f-mcp` card shipped in T-06 (2026-11-12), and the
account-scoped admin-panel MCP UI shipped in T-25 (2026-11-12): the admin page
now carries the enable switch, the four connect policies, the tool picker,
connected clients with Revoke, and a per-project allow switch. The detailed
proposal-review UI (record names and before/after values) is still out of this
pass.
