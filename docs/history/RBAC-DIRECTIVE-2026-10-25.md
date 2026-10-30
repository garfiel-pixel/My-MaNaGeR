# RBAC DIRECTIVE 2026-10-25 (terminal AI: execute, write all code yourself)

Read `CLAUDE.md`, `AGENTS.md`, `CONTINUATION-DIRECTIVE.md` first. Follow their rules (CSP hash regeneration, staging-copy deploys, offline-first). Do not open `docs/history/`.

**Goal.** Role-based access that works for every signed-in person (Google or password), costs nothing to run, and needs no paid email service. The owner names a role, picks a scope, types an email. The invited person sees the invitation inside the app, in a notification bar, and accepts it there. Email is an optional extra, never a dependency.

**Operating rules.**
1. Before coding, ask the owner ONE batch of questions (section 6). If unanswered, use the stated defaults and continue.
2. Adjust this plan to the live code. If a file or line below differs from what you see, trust the live code and note the difference in the commit message.
3. Three sprints. Commit and deploy to staging after each. A sprint is not done until every gate test in its section passes. Do not start the next sprint on a red gate.
4. Extend `tools/qa-team-rbac.cjs` (existing T1-T15, W7, W8 tests must keep passing unless a test encodes a behaviour this directive replaces; in that case rewrite the test and say so in the commit).

---

## 1. Audit findings (verified against the uploaded code)

| ID | Severity | Finding | Where |
|----|----------|---------|-------|
| F1 | Critical | **Google users cannot be team members.** Membership is keyed `user_sub = 'email:<addr>'`. Password sessions carry `sub = 'email:<addr>'`, but a Google session carries the bare Google `sub` (`payload.sub`). So accept fails with "different account", and `cloudAuthWithRole` never matches. | `team.js` invite/accept; `auth/google.js:143`; `http.js cloudAuthWithRole` |
| F2 | Critical | **Invite requires an existing `auth_users` row.** Google-only people have none, so they get `user_not_found` and cannot be invited at all. | `team.js handleTeamInvite` |
| F3 | High | **Invitee has no in-app way to see or accept an invitation.** No notification bar, no "Invitations" list, no accept page. `worker.js` itself says `/team/accept/<token>` "awaits its UI". Acceptance works only if the person clicks an emailed link, and email only sends if mail is configured. | `worker.js:219`; no consumer in `js/` |
| F4 | High | **Front end never uses the member role.** Nothing in `js/` reads `teamRole`/`source:'team'`. A member who is accepted still has no "Shared with me" list and no scope-aware UI. | `js/` (grep) |
| F5 | High | **Accept does not check email verification.** Password signups get a session before verifying (`session.js:195`). Someone can register a password account on a victim's address and accept the victim's invitation. | `handleTeamAccept` |
| F6 | High | **Supervisor, contractor, client are read-only on save**; only `manager` can write. The role matrix says supervisor owns field panels and contractor owns tasks, but they cannot save changes there. | `projects.js` ~374 |
| F7 | Medium | **Account enumeration.** `user_not_found` (404) vs `already_member` (409) tells a paying owner which emails have accounts. | `handleTeamInvite` |
| F8 | Medium | **Invite tokens stored in plaintext, never expire.** A DB read yields working tokens; stale pending rows live forever and count toward the contractor cap (`status != 'revoked'`). | `team.js`, `0024_rbac_team.sql` |
| F9 | Medium | **No decline, no leave.** Invitee cannot decline; an accepted member cannot leave a project. | `team.js` |
| F10 | Medium | **Weak audit trail.** Every manager write is labelled "Team manager"; no record of who invited, changed or revoked whom, or when. | `projects.js` actor label |
| F11 | Low | **Invite spam path.** Only the generic rate limit applies to invites. | `router.js` 4b |
| F12 | Low | `PUT /team/:mid` does not stop role changes on a revoked row. Harmless today, wrong in principle. | `handleTeamUpdate` |

What already works and must be preserved: tier caps (free 0, contractor 1, company/enterprise unlimited), soft revoke, scope validation via `CLOUD_SECTIONS`, single-use token on accept, owner-first auth order, owner-side invite form in `admin.html` (`#team-section`), role-to-section matrix in `teamScopeForRole`.

---

## 2. Target design

**Identity rule (replaces F1, F2, F5).** A membership belongs to a **verified email address**, lower-cased and trimmed. At every check the server resolves the caller as: session email, and that email is verified (Google: `email_verified` already enforced at sign-in; password: `auth_users.email_verified = 1`). Match membership on that email, never on `sub`. Store `user_sub` only as a cache filled at acceptance, for display; never authorise on it.

**Invite rule (replaces F2, F7).** The owner can invite any email, registered or not. The response is identical whether or not an account exists. If the person later signs up or signs in with that verified email, the invitation is waiting for them.

**Delivery rule (answers the cost concern).** The invitation lives in the database and shows in the app. `sendAuthEmail` is called only when `authEmailConfigured(env)` is true, wrapped so a failure never fails the invite. No new paid service. No new dependency.

**Notification bar (the owner's request).** In the signed-in app header, beside the existing update/notification area, add a person-icon button with a gold count badge. Click opens a glass panel with two tabs:
- **Invitations**: one card per pending invitation: project name, who invited, role, the sections they will see (client role) or the role's plain-language summary, expiry date, buttons **Accept** and **Decline**.
- **Collaborators** (for any project the user owns or belongs to): who is on it, their role, and what they are doing now, reusing the existing presence data (`src/cloud/presence.js`, `js/mmgr-presence.js`). Owners and managers see Change role / Revoke here.
Badge shows pending invitation count, polled on app load, on tab focus, and every 60 seconds while visible. Offline: show last cached list, disable Accept/Decline with a one-line "needs a connection" note. Never block the app on this.

**Role capability matrix (replaces F6).** Enforced on the server, per section, on every read and write route. Defaults (owner may change in section 6):

| Role | Read | Write | Manage team |
|------|------|-------|-------------|
| owner | everything | everything | yes |
| manager | everything | everything except billing, owner-only routes, MCP and API keys | invite/change/revoke non-managers; invite managers only if owner allows |
| supervisor | wbs, res, risk, meet | the same sections, via `cloudScopeMerge` | no |
| contractor | wbs | wbs only, via `cloudScopeMerge` | no |
| client | owner-chosen sections | nothing | no |

Writers other than owner/manager must go through the same scoped-merge path the editor codes use, so a submitted payload can only change keys inside their sections; anything else is reported as blocked and not applied.

---

## 3. Sprint 1: identity and security (server only)

1. **Migration `0028_team_invitations.sql`** (next free number; confirm). Create the new shape and backfill:
   - Add/replace table so each row has: `id`, `project_id`, `invitee_email` (lower-case, NOT NULL), `user_sub` (nullable cache), `role` (CHECK as today), `scope`, `invited_by`, `invited_by_name`, `status` (`pending|active|declined|revoked|expired`), `token_hash` (nullable), `expires_at`, `created_at`, `accepted_at`, `revoked_at`, `revoked_by`. `UNIQUE(project_id, invitee_email)`.
   - SQLite cannot alter a UNIQUE constraint in place: create a new table, copy rows, drop the old, recreate indexes (`project_id`, `invitee_email`, `token_hash`). Backfill `invitee_email` from `user_sub` where it starts with `email:`. Existing `active` rows stay `active`. Existing `pending` rows get `expires_at = now + 7 days`.
2. **Identity helper** in `src/lib/http.js`: `resolveVerifiedEmail(request, env)` returns the lower-cased verified email or null. Password sessions: look up `auth_users.email_verified`. Google sessions: session email. Use it in `cloudAuthWithRole`, in accept/decline/leave, and in the invitations list. No authorisation by `sub` anywhere in team code.
3. **Rewrite `handleTeamInvite`**: no `auth_users` lookup; generic success response (`{ok:true}` plus member id) regardless of account existence; `already_member` stays only for the OWNER's own email and for an email already active on this project (owner is authenticated, so this leaks nothing new). Tier cap counts `pending` (unexpired) plus `active`. Token: 32 random bytes, store only SHA-256 hash. Expiry 7 days. Per-project invite rate limit 20/hour using the existing `rl` mechanism with its own bucket.
4. **New endpoints** (all session-authenticated, verified email required, rate limited, body cap kept):
   - `GET  /api/team/invitations` list my pending, unexpired invitations (project display name, inviter name, role, scope, expiry). Never return tokens or other people's emails.
   - `POST /api/team/invitations/:id/accept` and `/decline` (id belongs to caller's verified email, else 404).
   - `POST /api/team/accept {token}` kept for email links: hash the token, same checks, same result.
   - `GET  /api/team/memberships` list projects I belong to as a member (for "Shared with me").
   - `POST /api/cloud/projects/:id/team/leave` member leaves.
5. **Write enforcement (F6).** In `projects.js` save: manager keeps whole-project write. Supervisor and contractor write through `cloudScopeMerge` with `teamScopeForRole`. Client is refused 403. Return a clear `blocked` list for the UI.
6. **Fixes:** `handleTeamUpdate` refuses revoked/declined/expired rows (F12); a cron sweep (existing `scheduled` handler) marks expired pending rows `expired`.
7. **Audit trail (F10).** Record invite, accept, decline, role change, scope change, revoke, leave into the existing changelog/audit mechanism with actor name and email. Manager writes use the member's name as the actor label, not "Team manager".

**Sprint 1 gate (all must pass in `tools/qa-team-rbac.cjs`):**
- G1 Google-only email invited (no `auth_users` row) returns the same body as a registered email.
- G2 Google session with matching verified email lists and accepts the invitation; then reads the project (200) and a non-scoped section is 403.
- G3 Password session with `email_verified = 0` accepting returns 403.
- G4 Token is not stored in plaintext (query the table, assert no 32-hex raw token).
- G5 Expired invitation cannot be accepted; cron marks it `expired`; it no longer counts toward the contractor cap.
- G6 Decline works once; member leave works; both leave an audit row.
- G7 Supervisor writes inside `wbs/res/risk/meet`, blocked outside; contractor writes `wbs` only; client write is 403; manager writes everything.
- G8 Another user's invitation id returns 404 on accept/decline.
- G9 Tier caps unchanged (free 402, contractor second member 402 `upgradeRequired:company`, company unlimited).
- G10 21st invite in an hour is rate limited.
- G11 Migration runs on a copy of current local data with zero lost rows.

---

## 4. Sprint 2: the in-app experience

1. **Notification bar** exactly as in section 2. Keyboard accessible, focus trapped in the panel, Escape closes, ARIA labels, badge announced to screen readers. Uses the existing glass components and the gold accent (not orange). Respect Performance Mode and dark/light themes.
2. **Accept flow.** Accept in the panel, show a toast, then offer **Open project** (loads it with the member's role). Decline asks for one confirmation click, no typing.
3. **`/team/accept/<token>` page** (the route `worker.js` already exempts): if signed out, send to `/signin` and return; if signed in with the matching verified email, show the same invitation card with Accept/Decline; wrong account shows "This invitation is for another email. Sign out and use that email." Keep `/team/` exempt from the 404 list.
4. **Shared with me.** In My Cloud Projects add a section listing member projects with a role badge. Opening one loads via `/load` using the member path and records `teamRole`.
5. **Role-aware UI.** Read `teamRole`/`scope` from the load/meta response. Hide or disable panels outside scope; show a one-line banner ("You are a Supervisor on this project. You can edit Tasks, Resources, Risks and Meetings."). Client role is fully read-only with a "View only" chip. Never rely on the UI for security; the server already enforces.
6. **Owner side (`admin.html` `#team-section`).** Keep the form; add: scope checkboxes for the client role, a pending list with expiry and **Resend** / **Cancel invite**, member rows with Change role / Revoke, and clear upsell text from the tier error. Add the same controls inside the Collaborators tab of the bar.
7. **Copy.** Plain, no corporate filler. Example: "Invitation from Damion to join *Kitchen Fit-Out* as Supervisor."

**Sprint 2 gate:** extend the browser QA (existing `qa-*.cjs` pattern) with: owner invites a Google-only address; second browser profile signs in with it; bar badge shows 1; accept; project appears under Shared with me; opens read-write on in-scope sections and read-only elsewhere; owner revokes; the member's open session is refused on the next request and the UI shows "Access removed" within one poll. Screenshot light, dark, mobile width. CSP hashes regenerated. No console errors. No layout shift in the header at 360px width.

---

## 5. Sprint 3: enterprise tier (the "best on the market" layer)

Researched direction (Procore, Autodesk Construction Cloud, Linear, Notion permission models): the market standard is per-section view/edit permissions, reusable role templates, time-boxed external access, bulk onboarding and an exportable audit log. Build these for **company and enterprise** tiers only; free and contractor keep the four fixed roles.

1. **Per-section permission matrix per member**: `none / view / edit` for each `CLOUD_SECTIONS` key, stored on the member row; the four roles become templates that pre-fill the matrix. Server resolves read and write sets from the matrix (single function, replacing `teamScopeForRole` internals, same signature so callers do not change).
2. **Custom role templates** (name, matrix) saved per owner account; reuse across projects.
3. **Time-boxed access**: optional `access_expires_at` per member (subcontractor for a defined phase). Enforced server-side at every auth check; owner gets an in-app notice 7 days before expiry with a one-click extend.
4. **Bulk invite**: paste emails or upload CSV (cap 100 per batch), choose a template, preview, send. Same generic-response rule; per-row result list.
5. **Audit log view and export** (CSV): invites, accepts, role changes, revokes, expiries, with actor and timestamp. Owner and managers only.
6. **Optional hardening**: owner toggle "Members must have a verified email" (always true; display it as a stated guarantee), and "Members can only open this project from a signed-in session" (already true; state it in the Security page copy only if tests prove it).
7. **Pricing and copy sync**: update `pricing.html`, `features.html`, `privacy.html` and the plan/entitlement flags so what is promised equals what is built. Remove any claim not covered by a passing test.

**Sprint 3 gate:** matrix tests for every `none/view/edit` combination on three representative sections (read and write, each role template); time-box expiry test with a mocked clock; bulk invite of 100 returns 100 result rows with no account-existence leakage; audit export contains every event type from Sprint 1; full existing suite green; lint green.

---

## 6. Ask the owner once, then continue (defaults in brackets)

1. May managers invite other managers? [No: only the owner can create managers.]
2. Should supervisors and contractors be able to write inside their sections, as in the table in section 2? [Yes.]
3. Invitation lifetime? [7 days, resendable.]
4. Should a member see the owner's name and email on the invitation card? [Name only.]

---

## 7. Definition of done (self-checking)

Run these before reporting complete, and paste the output:
- `grep -rn "user_sub" src/cloud src/lib | grep -i "auth\|match\|where"` shows no authorisation decision made on `user_sub`.
- `grep -rn "user_not_found" src` returns nothing.
- Query proves no raw invite tokens in the table.
- Full QA suite and lint green; staging walk-through recorded with two real browser profiles, one Google-only.
- A short `RBAC-NOTES.md` listing the final role matrix, endpoints, and any place you deviated from this directive and why.
