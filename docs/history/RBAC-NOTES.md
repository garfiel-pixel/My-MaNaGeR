# RBAC notes (directive 2026-10-25)

Working notes for the three named-member sprints. They exist so the next
session does not have to re-derive the rules from the diff.

## Identity

- A membership belongs to a **verified email address**. No authorisation path
  reads `user_sub`; the column is a display cache filled at acceptance.
- A Google account and a password account with the same verified address are
  the same person.
- The invite response is identical for a registered and an unregistered
  address, so the form cannot be used to discover who has an account. The only
  exception is the owner's own address, which the owner can already see.
- Invitation tokens: 32 random bytes, stored as SHA-256 only. Migration 0028
  dropped the plaintext `invite_token` column, so a pending invitation whose
  email never arrived is resent, not recovered.

## Roles and sections

`src/lib/http.js` is the single source of truth.

| Role | Template read set | Template write set |
|---|---|---|
| manager | every section | every section |
| supervisor | wbs, res, risk, meet | same |
| contractor | wbs | same |
| client | the owner's chosen scope | never writes |

Sprint 3 makes the roles templates: a member row may carry its own matrix in
`perm`, one level per section.

- **Read set** = sections at `view` or `edit`.
- **Write set** = sections at `edit` only.
- `teamScopeForRole(role, memberScope, matrix?)` keeps its signature; the third
  argument is optional, so every pre-sprint-3 caller behaves exactly as before.
- `teamWriteScopeForRole` answers the write set. A client always answers `[]`,
  whatever the matrix says: a read-only share must not become writable by
  editing a grid.
- A client matrix is downgraded `edit` to `view` server-side when it is stored.

## Save paths

| Caller | Path |
|---|---|
| owner | direct write |
| manager | direct write, clamped by `cloudClampToWriteScope` |
| supervisor, contractor | proposal in `cloud_reviews`, merged under the write set |
| client | 403 |

The clamp exists because `cloudScopeMerge` deletes `updatedAt` and rebuilds
`fieldTs`; the clamp instead starts from the submitted state, keeps non-section
keys such as `config` flowing, and restores every content key the member may
not write from the previous snapshot.

## Time-boxed access

- `access_expires_at` is an **absolute** date the owner chooses (the end of the
  phase), not a countdown from acceptance.
- Enforcement is at auth: `cloudAuthWithRole` refuses a row past its date and
  marks it `expired` in the same request. The scheduled sweep is bookkeeping,
  not the lock.
- Acceptance of an invitation whose window already closed answers 410
  `access_expired` instead of handing out access that fails on first use.
- The 7-day notice is computed by the server (`accessExpiringSoon`), so the page
  cannot disagree with the Worker. Extend pushes the date out from now, or from
  the current end date when that is later, so an early extend never shortens.

## Tiers

| Feature | Tier |
|---|---|
| any named member at all | contractor and above |
| more than one member | company and above |
| custom matrix, time box, bulk invite, templates, audit export | company and above |

Refusals are explicit: `member_limit` with `upgradeRequired`, or
`enterprise_feature` with `upgradeRequired: 'company'`. A silently dropped
matrix would hand the person the role default, so it is refused instead.

## Endpoints

| Method and path | Purpose |
|---|---|
| `POST /api/cloud/projects/:id/team` | invite one (`perm`, `templateId`, `accessExpiresAt`) |
| `POST /api/cloud/projects/:id/team/bulk` | invite up to 100 |
| `GET /api/cloud/projects/:id/team` | list with `perm`, `writeScope`, `accessExpiringSoon`, `accessExpired` |
| `PUT /api/cloud/projects/:id/team/:mid` | role, scope, matrix, access end date |
| `POST /api/cloud/projects/:id/team/:mid/extend` | add days behind the notice |
| `POST /api/cloud/projects/:id/team/:mid/resend` | fresh token |
| `DELETE /api/cloud/projects/:id/team/:mid` | revoke |
| `GET /api/cloud/projects/:id/team/audit.csv` | audit export |
| `GET/POST /api/team/templates`, `PUT/DELETE /api/team/templates/:id` | account-level templates |
| `GET /api/team/invitations`, `/memberships` | caller-side inbox and shared list |
| `POST /api/team/invitations/:id/(accept\|decline)` | in-app accept and decline |

Membership events are written to `cloud_team_audit`, never to
`cloud_changelog`: the changelog is project content and a member must not be
able to infer it from a membership change.

## Rate limits

`teamInvite` is 20 per hour per project, keyed on `project:<pid>`, counted once
per bulk batch and only after the owner is authenticated. Harnesses that fire
many invitations carry a rotating `CF-Connecting-IP` (RFC 5737 TEST-NET-3)
instead of raising the limit.

## Harnesses

| Harness | Covers |
|---|---|
| `tools/qa-team-rbac.cjs` | sprint 1 API: identity, tokens, caps, roles, proposals, audit |
| `tools/qa-team-ui.cjs` | sprint 2 browser: bell, invitation link, member scope, revoke |
| `tools/qa-team-enterprise.cjs` | sprint 3 API: matrix, clamp, expiry, extend, templates, bulk, CSV |

All three spawn their own wrangler and apply the migrations to a persist
directory outside the repo.

## UI surface

The owner manages people from the launcher's Collaborators tab
(`js/cloud/team-ui.js`, shared by `app.html` and `project.html`). Sprint 3 adds
the access grid, the template picker, the date field with Add 30 days, the bulk
form and the audit download there, rendered only when
`MMGR.Entitlements.rbacEnterprise()` is true. `admin.html` keeps its older team
list for the project drawer; it is not the sprint-3 surface.

## Open items

- The sprints cover project data. Owner-account settings that reference a team
  (billing seats) are unchanged.
- Templates are per account, capped at 25. Sharing a template between accounts
  is not built.
