/* ============================================================
   CLOUD TEAM MEMBERS - named-role RBAC
   ------------------------------------------------------------
   RBAC sprint 1 (directive 2026-10-25, section 3). Rewritten from the
   user_sub-keyed model shipped on 2026-10-06.

   IDENTITY: a membership belongs to a VERIFIED EMAIL ADDRESS. Nothing in
   this module authorises on user_sub. The column survives only as a cache
   filled when an invitation is accepted, for display. A Google account and
   a password account with the same verified address are the same person, so
   either can accept an invitation addressed to that address.

   INVITATIONS: the owner may invite any address, registered or not. The
   response is identical in both cases (no account-existence probe), the row
   is visible in the app, and email is an optional extra - sendAuthEmail runs
   only when RESEND_API_KEY is configured and a failure never fails the
   invite.

   TOKENS: 32 random bytes, stored as SHA-256 only. The raw token exists in
   the email link and nowhere else.

   TIER CAPS (unchanged): free = none, contractor = one, company/enterprise
   unlimited. Pending (unexpired) and active rows both count.

   AUDIT: every membership event goes to cloud_team_audit, not to
   cloud_changelog (that table is the content-revert history and every row in
   it is rendered with a Revert control).
   ============================================================ */
import {
  json,
  cloudForbidden,
  cloudRateCheck,
  cloudRateLimited,
  readSession,
  cloudAuthOwnerEither,
  resolveVerifiedIdentity,
  resolveVerifiedEmail,
  authEmailConfigured,
  sendAuthEmail,
  CLOUD_SECTIONS,
  readJsonBody,
  teamScopeForRole
} from '../lib/http.js';
import { billingStatusActive } from '../billing.js';

export const TEAM_ROLES = ['manager', 'supervisor', 'contractor', 'client'];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BODY_CAP = 8192; // T-5: team payloads are an email, a role or a token

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function emailValid(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function randomInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex; // 64-char hex; only its SHA-256 is stored
}

async function hashInviteToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// Owner tier from the entitlement row. No active row (or no row) is 'free'.
async function ownerTier(env, ownerSub) {
  const sub = await env.DB.prepare(
    'SELECT status, tier, plan FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(ownerSub)
    .first();
  if (!sub || !billingStatusActive(sub.status)) {
    return 'free';
  }
  return sub.tier || sub.plan || 'contractor';
}

// Tier-cap count: active rows plus pending rows that have not expired.
// An expired row waiting for the cron sweep must not hold a seat (G5).
async function countedMemberCount(env, projectId, excludeId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM cloud_team_members WHERE project_id = ? AND id != ? AND (status = 'active' OR (status = 'pending' AND (expires_at IS NULL OR expires_at > ?)))"
  )
    .bind(projectId, excludeId || 0, nowIso())
    .first();
  return (row && row.c) || 0;
}

function cleanScope(role, scope) {
  if (role !== 'client') {
    return null;
  }
  if (!Array.isArray(scope)) {
    return null;
  }
  const out = scope.filter(function (s) {
    return typeof s === 'string' && !!CLOUD_SECTIONS[s];
  });
  return out.length ? JSON.stringify(out) : null;
}

function parseScope(raw) {
  if (!raw) {
    return null;
  }
  try {
    const s = JSON.parse(raw);
    return Array.isArray(s) ? s : null;
  } catch (e) {
    return null;
  }
}

function serializeMember(row) {
  return {
    id: row.id,
    // DISPLAY SHIM: admin.html renders m.userSub today and sprint 2 replaces
    // that UI. The value is derived from the email for display only - no
    // authorisation path reads it.
    userSub: 'email:' + row.invitee_email,
    inviteeEmail: row.invitee_email,
    role: row.role,
    status: row.status,
    scope: parseScope(row.scope),
    invitedByName: row.invited_by_name || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at || null,
    revokedAt: row.revoked_at || null
  };
}

// Append-only membership audit. A write failure never fails the action that
// produced it; it is logged so an operator can see the gap.
export async function teamAudit(env, projectId, event, fields) {
  const f = fields || {};
  try {
    await env.DB.prepare(
      'INSERT INTO cloud_team_audit (project_id, member_id, event, actor_email, actor_name, target_email, role, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
      .bind(
        projectId,
        f.memberId == null ? null : f.memberId,
        event,
        f.actorEmail || null,
        f.actorName || null,
        f.targetEmail || null,
        f.role || null,
        f.detail ? JSON.stringify(f.detail) : null,
        nowIso()
      )
      .run();
  } catch (e) {
    console.error('team audit write failed: ' + (e && e.message));
  }
}

// Cron sweep (worker.js scheduled): pending rows past expiry become 'expired'.
// The token is cleared so a link that arrives late cannot be replayed.
export async function sweepExpiredInvitations(env) {
  const now = nowIso();
  const rows = await env.DB.prepare(
    "SELECT id, project_id, invitee_email FROM cloud_team_members WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?"
  )
    .bind(now)
    .all();
  const list = rows.results || [];
  if (!list.length) {
    return { expired: 0 };
  }
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'expired', token_hash = NULL WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?"
  )
    .bind(now)
    .run();
  for (const r of list) {
    await teamAudit(env, r.project_id, 'expire', {
      memberId: r.id,
      targetEmail: r.invitee_email
    });
  }
  return { expired: list.length };
}

// The owner-code path has no email; the session path does. This resolves the
// actor fields for the audit trail without making them a requirement.
async function actorFromRequest(request, env, auth) {
  const sess = await readSession(request, env);
  return {
    sub: (auth && auth.row && auth.row.google_sub) || (sess && sess.sub) || 'owner',
    name: (auth && auth.row && auth.row.google_name) || (sess && sess.name) || 'Owner',
    email: normalizeEmail(sess && sess.email) || null
  };
}

// Kept for the existing call sites that resolve a membership before this
// module runs. Do not read it as an identity: the email is the identity.
export { ownerTier };
// POST /api/cloud/projects/:id/team { email, role, scope? }
export async function handleTeamInvite(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  // Per-project invite budget, counted only for an authenticated owner (a
  // stranger who guesses the project id cannot burn it). 20 per hour.
  const rl = await cloudRateCheck(request, 'teamInvite', env, 'project:' + projectId);
  if (rl.limited) {
    return cloudRateLimited(rl.retryAfter);
  }
  const read = await readJsonBody(request, BODY_CAP);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const body = read.body || {};
  const email = normalizeEmail(body.email);
  if (!emailValid(email)) {
    return json({ ok: false, error: 'a valid email is required' }, 400);
  }
  const role = String(body.role || 'contractor');
  if (TEAM_ROLES.indexOf(role) === -1) {
    return json({ ok: false, error: 'unknown role' }, 400);
  }

  // The owner's own address is the one case where "already a member" is both
  // true and safe to say: the caller is authenticated as that project's owner.
  const sess = await readSession(request, env);
  if (sess && normalizeEmail(sess.email) === email) {
    return json({ ok: false, error: 'already_member' }, 409);
  }

  const ownerSub = (auth.row && auth.row.google_sub) || (sess && sess.sub) || '';
  const tier = await ownerTier(env, ownerSub);
  if (tier === 'free') {
    return json({ ok: false, error: 'member_limit', upgradeRequired: 'contractor' }, 402);
  }

  const existing = await env.DB.prepare(
    'SELECT id, status, accepted_at FROM cloud_team_members WHERE project_id = ? AND invitee_email = ?'
  )
    .bind(projectId, email)
    .first();
  if (existing && existing.status === 'active') {
    return json({ ok: false, error: 'already_member' }, 409);
  }

  if (
    tier === 'contractor' &&
    (await countedMemberCount(env, projectId, existing ? existing.id : 0)) >= 1
  ) {
    return json({ ok: false, error: 'member_limit', upgradeRequired: 'company' }, 402);
  }

  const actor = await actorFromRequest(request, env, auth);
  const token = randomInviteToken();
  const tokenHash = await hashInviteToken(token);
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const scope = cleanScope(role, body.scope);
  let memberId;
  if (existing) {
    // Re-invite keeps the row (and its history) and issues a fresh token.
    await env.DB.prepare(
      "UPDATE cloud_team_members SET role = ?, invited_by = ?, invited_by_name = ?, status = 'pending', scope = ?, token_hash = ?, expires_at = ?, created_at = ?, accepted_at = NULL, revoked_at = NULL, revoked_by = NULL WHERE id = ? AND project_id = ?"
    )
      .bind(role, actor.sub, actor.name, scope, tokenHash, expiresAt, ts, existing.id, projectId)
      .run();
    memberId = existing.id;
  } else {
    const res = await env.DB.prepare(
      "INSERT INTO cloud_team_members (project_id, invitee_email, role, invited_by, invited_by_name, status, scope, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,'pending',?,?,?,?)"
    )
      .bind(projectId, email, role, actor.sub, actor.name, scope, tokenHash, expiresAt, ts)
      .run();
    memberId = res.meta.last_row_id;
  }

  await teamAudit(env, projectId, existing ? 'resend' : 'invite', {
    memberId: memberId,
    actorEmail: actor.email,
    actorName: actor.name,
    targetEmail: email,
    role: role,
    detail: { expiresAt: expiresAt }
  });

  await sendInviteEmail(request, env, email, role, token);

  return json({ ok: true, memberId: memberId, role: role, status: 'pending' });
}

// One mail path for invite and resend. Email is an OPTIONAL extra: the caller
// wraps this and a failure must never fail the invitation itself, because the
// invitation already lives in the database and shows in the app.
async function sendInviteEmail(request, env, email, role, token) {
  if (!authEmailConfigured(env)) {
    return false;
  }
  const origin = new URL(request.url).origin;
  const link = origin + '/team/accept/' + token;
  try {
    await sendAuthEmail(
      env,
      email,
      'You have been invited to a My MaNaGeR project',
      'You have been invited to collaborate on a My MaNaGeR project as a ' +
        role +
        '.\n\n' +
        'Open this link while signed in to accept the invitation:\n' +
        link +
        '\n\n' +
        'This invitation expires in 7 days. If you were not expecting it, you can ignore this email.'
    );
    return true;
  } catch (e) {
    return false; // a mail failure must not fail the invite
  }
}

// GET /api/cloud/projects/:id/team
export async function handleTeamList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  const rows = await env.DB.prepare(
    "SELECT id, invitee_email, role, status, scope, invited_by_name, expires_at, created_at, accepted_at, revoked_at FROM cloud_team_members WHERE project_id = ? AND status != 'revoked' ORDER BY created_at ASC"
  )
    .bind(projectId)
    .all();
  const members = (rows.results || []).map(serializeMember);
  return json({ ok: true, members: members });
}

// PUT /api/cloud/projects/:id/team/:mid { role?, scope? }
export async function handleTeamUpdate(request, env, projectId, memberId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  const read = await readJsonBody(request, BODY_CAP);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const body = read.body || {};
  const row = await env.DB.prepare(
    'SELECT id, invitee_email, role, scope, status FROM cloud_team_members WHERE id = ? AND project_id = ?'
  )
    .bind(memberId, projectId)
    .first();
  if (!row) {
    return json({ ok: false, error: 'member_not_found' }, 404);
  }
  // F12: a revoked, declined or expired row is history, not a live grant.
  if (row.status === 'revoked' || row.status === 'declined' || row.status === 'expired') {
    return json({ ok: false, error: 'member_not_editable', status: row.status }, 409);
  }
  const role = body.role !== undefined ? String(body.role) : row.role;
  if (TEAM_ROLES.indexOf(role) === -1) {
    return json({ ok: false, error: 'unknown role' }, 400);
  }
  const scope = body.scope !== undefined ? cleanScope(role, body.scope) : row.scope;
  await env.DB.prepare(
    'UPDATE cloud_team_members SET role = ?, scope = ? WHERE id = ? AND project_id = ?'
  )
    .bind(role, scope, memberId, projectId)
    .run();
  const actor = await actorFromRequest(request, env, auth);
  await teamAudit(env, projectId, role !== row.role ? 'update_role' : 'update_scope', {
    memberId: Number(memberId),
    actorEmail: actor.email,
    actorName: actor.name,
    targetEmail: row.invitee_email,
    role: role,
    detail: { fromRole: row.role, toRole: role, scope: parseScope(scope) }
  });
  return json({ ok: true, memberId: Number(memberId), role: role });
}

// POST /api/cloud/projects/:id/team/:mid/resend
// Issues a fresh 7-day token for a pending, expired or declined invitation and
// mails the new link. The row keeps its history (same id, same audit trail).
export async function handleTeamResend(request, env, projectId, memberId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  const rl = await cloudRateCheck(request, 'teamInvite', env, 'project:' + projectId);
  if (rl.limited) {
    return cloudRateLimited(rl.retryAfter);
  }
  const row = await env.DB.prepare(
    'SELECT id, invitee_email, role, scope, status FROM cloud_team_members WHERE id = ? AND project_id = ?'
  )
    .bind(memberId, projectId)
    .first();
  if (!row) {
    return json({ ok: false, error: 'member_not_found' }, 404);
  }
  if (row.status === 'active') {
    return json({ ok: false, error: 'already_member' }, 409);
  }
  if (row.status === 'revoked') {
    return json({ ok: false, error: 'member_not_editable', status: row.status }, 409);
  }
  const sess = await readSession(request, env);
  const ownerSub = (auth.row && auth.row.google_sub) || (sess && sess.sub) || '';
  const tier = await ownerTier(env, ownerSub);
  if (tier === 'free') {
    return json({ ok: false, error: 'member_limit', upgradeRequired: 'contractor' }, 402);
  }
  // A live pending row already holds its seat; reviving an expired or
  // declined one has to take a seat like a fresh invitation would.
  if (
    row.status !== 'pending' &&
    tier === 'contractor' &&
    (await countedMemberCount(env, projectId, row.id)) >= 1
  ) {
    return json({ ok: false, error: 'member_limit', upgradeRequired: 'company' }, 402);
  }
  const actor = await actorFromRequest(request, env, auth);
  const token = randomInviteToken();
  const tokenHash = await hashInviteToken(token);
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'pending', token_hash = ?, expires_at = ?, created_at = ?, accepted_at = NULL, revoked_at = NULL, revoked_by = NULL WHERE id = ? AND project_id = ?"
  )
    .bind(tokenHash, expiresAt, ts, row.id, projectId)
    .run();
  await teamAudit(env, projectId, 'resend', {
    memberId: row.id,
    actorEmail: actor.email,
    actorName: actor.name,
    targetEmail: row.invitee_email,
    role: row.role,
    detail: { expiresAt: expiresAt }
  });
  await sendInviteEmail(request, env, row.invitee_email, row.role, token);
  return json({ ok: true, memberId: row.id, status: 'pending', expiresAt: expiresAt });
}

// DELETE /api/cloud/projects/:id/team/:mid  (soft revoke, never hard-delete)
export async function handleTeamRevoke(request, env, projectId, memberId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  const row = await env.DB.prepare(
    'SELECT id, invitee_email, role, status FROM cloud_team_members WHERE id = ? AND project_id = ?'
  )
    .bind(memberId, projectId)
    .first();
  if (!row) {
    return json({ ok: false, error: 'member_not_found' }, 404);
  }
  if (row.status === 'revoked') {
    return json({ ok: true, memberId: Number(memberId), status: 'revoked' });
  }
  const actor = await actorFromRequest(request, env, auth);
  const ts = nowIso();
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'revoked', token_hash = NULL, revoked_at = ?, revoked_by = ? WHERE id = ? AND project_id = ?"
  )
    .bind(ts, actor.email || actor.sub, memberId, projectId)
    .run();
  await teamAudit(env, projectId, 'revoke', {
    memberId: Number(memberId),
    actorEmail: actor.email,
    actorName: actor.name,
    targetEmail: row.invitee_email,
    role: row.role,
    detail: { previousStatus: row.status }
  });
  return json({ ok: true, memberId: Number(memberId), status: 'revoked' });
}

// ---- caller-side invitation endpoints -------------------------------------

async function expireIfNeeded(env, row, now) {
  if (!row.expires_at || row.expires_at > now) {
    return false;
  }
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'expired', token_hash = NULL WHERE id = ? AND status = 'pending'"
  )
    .bind(row.id)
    .run();
  await teamAudit(env, row.project_id, 'expire', {
    memberId: row.id,
    targetEmail: row.invitee_email
  });
  return true;
}

async function activationResponse(env, row, event, identity) {
  const ts = nowIso();
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'active', accepted_at = ?, token_hash = NULL, user_sub = ?, revoked_at = NULL, revoked_by = NULL WHERE id = ?"
  )
    .bind(ts, identity.session.sub, row.id)
    .run();
  await teamAudit(env, row.project_id, event, {
    memberId: row.id,
    actorEmail: identity.email,
    actorName: identity.session.name || null,
    targetEmail: row.invitee_email,
    role: row.role
  });
  return json({
    ok: true,
    projectId: row.project_id,
    role: row.role,
    scope: parseScope(row.scope),
    memberId: row.id
  });
}

// POST /api/team/accept { token } - email links. The signed-in caller must
// hold the invited address; the token alone is never enough.
export async function handleTeamAccept(request, env) {
  const identity = await resolveVerifiedIdentity(request, env);
  if (!identity) {
    return cloudForbidden();
  }
  const read = await readJsonBody(request, BODY_CAP);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const token = String((read.body && read.body.token) || '').trim();
  if (!token) {
    return json({ ok: false, error: 'missing token' }, 400);
  }
  const row = await env.DB.prepare(
    "SELECT id, project_id, invitee_email, role, scope, status, expires_at FROM cloud_team_members WHERE token_hash = ? AND status = 'pending'"
  )
    .bind(await hashInviteToken(token))
    .first();
  if (!row) {
    return json({ ok: false, error: 'invalid or expired invitation' }, 404);
  }
  if (await expireIfNeeded(env, row, nowIso())) {
    return json({ ok: false, error: 'invitation_expired' }, 410);
  }
  if (row.invitee_email !== identity.email) {
    // The caller Holds the link, so telling them it belongs to another address
    // is more useful than a false "invalid" and leaks nothing they lack.
    return json({ ok: false, error: 'wrong_account' }, 403);
  }
  return activationResponse(env, row, 'accept', identity);
}

// GET /api/team/invitations - my pending, unexpired invitations.
export async function handleTeamInvitations(request, env) {
  const email = await resolveVerifiedEmail(request, env);
  if (!email) {
    return cloudForbidden();
  }
  const now = nowIso();
  const rows = await env.DB.prepare(
    "SELECT m.id, m.project_id, m.role, m.scope, m.expires_at, m.created_at, m.invited_by_name, p.owner_label AS project_name, p.google_name AS owner_name FROM cloud_team_members m JOIN cloud_projects p ON p.project_id = m.project_id WHERE m.invitee_email = ? AND m.status = 'pending' AND (m.expires_at IS NULL OR m.expires_at > ?) AND p.deleted_at IS NULL ORDER BY m.created_at ASC"
  )
    .bind(email, now)
    .all();
  const invitations = (rows.results || []).map(function (r) {
    return {
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name || 'Cloud project',
      inviterName: r.invited_by_name || r.owner_name || 'Owner',
      role: r.role,
      scope: parseScope(r.scope),
      expiresAt: r.expires_at || null,
      createdAt: r.created_at
    };
  });
  return json({ ok: true, invitations: invitations });
}

async function invitationById(request, env, invitationId) {
  const identity = await resolveVerifiedIdentity(request, env);
  if (!identity) {
    return { error: cloudForbidden() };
  }
  const row = await env.DB.prepare(
    "SELECT id, project_id, invitee_email, role, scope, status, expires_at FROM cloud_team_members WHERE id = ? AND invitee_email = ? AND status = 'pending'"
  )
    .bind(invitationId, identity.email)
    .first();
  if (!row) {
    // Another person's id and a non-existent id answer the same way (G8).
    return { error: json({ ok: false, error: 'invitation_not_found' }, 404) };
  }
  if (await expireIfNeeded(env, row, nowIso())) {
    return { error: json({ ok: false, error: 'invitation_expired' }, 410) };
  }
  return { identity: identity, row: row };
}

// POST /api/team/invitations/:id/accept
export async function handleTeamInvitationAccept(request, env, invitationId) {
  const got = await invitationById(request, env, invitationId);
  if (got.error) {
    return got.error;
  }
  return activationResponse(env, got.row, 'accept', got.identity);
}

// POST /api/team/invitations/:id/decline
export async function handleTeamInvitationDecline(request, env, invitationId) {
  const got = await invitationById(request, env, invitationId);
  if (got.error) {
    return got.error;
  }
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'declined', token_hash = NULL WHERE id = ? AND status = 'pending'"
  )
    .bind(got.row.id)
    .run();
  await teamAudit(env, got.row.project_id, 'decline', {
    memberId: got.row.id,
    actorEmail: got.identity.email,
    actorName: got.identity.session.name || null,
    targetEmail: got.row.invitee_email,
    role: got.row.role
  });
  return json({ ok: true, memberId: got.row.id, status: 'declined' });
}

// GET /api/team/memberships - projects I belong to ("Shared with me").
export async function handleTeamMemberships(request, env) {
  const email = await resolveVerifiedEmail(request, env);
  if (!email) {
    return cloudForbidden();
  }
  const rows = await env.DB.prepare(
    "SELECT m.id, m.project_id, m.role, m.scope, m.expires_at, m.accepted_at, p.owner_label AS project_name, p.google_name AS owner_name FROM cloud_team_members m JOIN cloud_projects p ON p.project_id = m.project_id WHERE m.invitee_email = ? AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?) AND p.deleted_at IS NULL ORDER BY m.accepted_at DESC"
  )
    .bind(email, nowIso())
    .all();
  const memberships = (rows.results || []).map(function (r) {
    return {
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name || 'Cloud project',
      ownerName: r.owner_name || 'Owner',
      role: r.role,
      scope: teamScopeForRole(r.role, parseScope(r.scope)),
      expiresAt: r.expires_at || null,
      acceptedAt: r.accepted_at || null
    };
  });
  return json({ ok: true, memberships: memberships });
}

// POST /api/cloud/projects/:id/team/leave
export async function handleTeamLeave(request, env, projectId) {
  const identity = await resolveVerifiedIdentity(request, env);
  if (!identity) {
    return cloudForbidden();
  }
  const row = await env.DB.prepare(
    "SELECT id, invitee_email, role, status FROM cloud_team_members WHERE project_id = ? AND invitee_email = ? AND status = 'active'"
  )
    .bind(projectId, identity.email)
    .first();
  if (!row) {
    return json({ ok: false, error: 'membership_not_found' }, 404);
  }
  const ts = nowIso();
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'revoked', token_hash = NULL, revoked_at = ?, revoked_by = ? WHERE id = ?"
  )
    .bind(ts, identity.email, row.id)
    .run();
  await teamAudit(env, projectId, 'leave', {
    memberId: row.id,
    actorEmail: identity.email,
    actorName: identity.session.name || null,
    targetEmail: identity.email,
    role: row.role
  });
  return json({ ok: true, memberId: row.id, status: 'revoked' });
}
