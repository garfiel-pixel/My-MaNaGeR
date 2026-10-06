/* ============================================================
   CLOUD TEAM MEMBERS - named-role RBAC (owner directive 2026-10-06)
   ------------------------------------------------------------
   Named team members are a SEPARATE grant from code sharing (D4,
   hybrid): a project may carry both editor/client codes and named
   members at once, and code sharing is never gated by tier (D11).

   Tier rules (Section 3 of the directive):
     - free       : no named members
     - contractor : exactly ONE named member per project
     - company /  : unlimited
       enterprise

   Role permission matrix is enforced by callers through
   cloudAuthWithRole() + their own per-route checks; this module owns
   the membership CRUD and the tier cap.

   Identity note: auth_users is keyed by email and (since migration
   0022) carries a provider column, but holds only password/linked
   accounts - a Google-only account has no row here. An invite
   therefore resolves to the 'email:<addr>' sub namespace; a
   Google-only address cannot be resolved to a sub and is reported as
   user_not_found rather than fabricating an identity.
   ============================================================ */
import { json, cloudForbidden, readSession,
  cloudAuthOwnerEither, authEmailConfigured, sendAuthEmail, CLOUD_SECTIONS } from '../lib/http.js';
import { billingStatusActive } from '../billing.js';

const TEAM_ROLES = ['manager', 'supervisor', 'contractor', 'client'];

function nowIso() { return new Date().toISOString(); }

function randomInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex; // 32-char hex
}

// Owner tier from the entitlement row. No active row (or no row) is 'free'.
async function ownerTier(env, ownerSub) {
  const sub = await env.DB.prepare('SELECT status, tier, plan FROM cloud_subscriptions WHERE owner_sub = ?').bind(ownerSub).first();
  if (!sub || !billingStatusActive(sub.status)) return 'free';
  return sub.tier || sub.plan || 'contractor';
}

// A member count that respects the tier cap. Revoked rows never count.
async function activeMemberCount(env, projectId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM cloud_team_members WHERE project_id = ? AND status != 'revoked'"
  ).bind(projectId).first();
  return (row && row.c) || 0;
}

function cleanScope(role, scope) {
  if (role !== 'client') return null;
  if (!Array.isArray(scope)) return null;
  const out = scope.filter(function(s) { return typeof s === 'string' && !!CLOUD_SECTIONS[s]; });
  return out.length ? JSON.stringify(out) : null;
}

function serializeMember(row) {
  let scope = null;
  if (row.scope) { try { scope = JSON.parse(row.scope); } catch (e) { scope = null; } }
  return {
    id: row.id,
    userSub: row.user_sub,
    role: row.role,
    status: row.status,
    scope: scope,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at
  };
}

// POST /api/cloud/projects/:id/team { email, role, scope? }
export async function handleTeamInvite(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = String((body && body.email) || '').trim().toLowerCase();
  const role = String((body && body.role) || 'contractor');
  if (!email || email.indexOf('@') < 0) return json({ ok: false, error: 'a valid email is required' }, 400);
  if (TEAM_ROLES.indexOf(role) === -1) return json({ ok: false, error: 'unknown role' }, 400);

  // Resolve the owner identity that carries the entitlement.
  let ownerSub = (auth.row && auth.row.google_sub) || '';
  if (!ownerSub) {
    const sess = await readSession(request, env);
    ownerSub = (sess && sess.sub) || '';
  }
  const tier = await ownerTier(env, ownerSub);

  // D5/D6/D7 - the tier cap. Free has no named members; contractor has one.
  if (tier === 'free') {
    return json({ ok: false, error: 'member_limit', upgradeRequired: 'contractor' }, 402);
  }
  if (tier === 'contractor' && (await activeMemberCount(env, projectId)) >= 1) {
    return json({ ok: false, error: 'member_limit', upgradeRequired: 'company' }, 402);
  }

  // The invited address must already own an account; we never create one.
  const userRow = await env.DB.prepare('SELECT email, provider FROM auth_users WHERE email = ?').bind(email).first();
  if (!userRow) return json({ ok: false, error: 'user_not_found' }, 404);
  const userSub = 'email:' + email;

  const existing = await env.DB.prepare(
    'SELECT id, status FROM cloud_team_members WHERE project_id = ? AND user_sub = ?'
  ).bind(projectId, userSub).first();
  if (existing && existing.status !== 'revoked') {
    return json({ ok: false, error: 'already_member' }, 409);
  }

  const token = randomInviteToken();
  const scope = cleanScope(role, body && body.scope);
  const ts = nowIso();
  const actor = (auth.row && auth.row.google_sub) || ownerSub || 'owner';
  if (existing) {
    // Re-inviting a revoked member revives the same row (UNIQUE project_id,user_sub).
    await env.DB.prepare(
      "UPDATE cloud_team_members SET role = ?, invited_by = ?, status = 'pending', scope = ?, invite_token = ?, created_at = ?, accepted_at = NULL WHERE id = ?"
    ).bind(role, actor, scope, token, ts, existing.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO cloud_team_members (project_id, user_sub, role, invited_by, status, scope, invite_token, created_at) VALUES (?,?,?,?,'pending',?,?,?)"
    ).bind(projectId, userSub, role, actor, scope, token, ts).run();
  }

  if (authEmailConfigured(env)) {
    const origin = new URL(request.url).origin;
    const link = origin + '/team/accept/' + token;
    try {
      await sendAuthEmail(env, email,
        'You have been invited to a My MaNaGeR project',
        'You have been invited to collaborate on a My MaNaGeR project as a ' + role + '.\n\n' +
        'Open this link while signed in to accept the invitation:\n' + link + '\n\n' +
        'If you were not expecting this invitation, you can ignore this email.');
    } catch (e) { /* a mail failure must not fail the invite */ }
  }

  const row = await env.DB.prepare(
    'SELECT id, user_sub, role, status, scope, created_at, accepted_at FROM cloud_team_members WHERE project_id = ? AND user_sub = ?'
  ).bind(projectId, userSub).first();
  const m = serializeMember(row);
  return json({ ok: true, memberId: m.id, role: m.role, status: m.status });
}

// GET /api/cloud/projects/:id/team
export async function handleTeamList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare(
    "SELECT id, user_sub, role, status, scope, created_at, accepted_at FROM cloud_team_members WHERE project_id = ? AND status != 'revoked' ORDER BY created_at ASC"
  ).bind(projectId).all();
  const members = (rows.results || []).map(serializeMember);
  return json({ ok: true, members: members });
}

// PUT /api/cloud/projects/:id/team/:mid { role?, scope? }
export async function handleTeamUpdate(request, env, projectId, memberId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const row = await env.DB.prepare(
    'SELECT id, role, scope FROM cloud_team_members WHERE id = ? AND project_id = ?'
  ).bind(memberId, projectId).first();
  if (!row) return json({ ok: false, error: 'member_not_found' }, 404);
  const role = body && body.role !== undefined ? String(body.role) : row.role;
  if (TEAM_ROLES.indexOf(role) === -1) return json({ ok: false, error: 'unknown role' }, 400);
  const scope = (body && body.scope !== undefined) ? cleanScope(role, body.scope) : row.scope;
  await env.DB.prepare(
    'UPDATE cloud_team_members SET role = ?, scope = ? WHERE id = ? AND project_id = ?'
  ).bind(role, scope, memberId, projectId).run();
  return json({ ok: true, memberId: Number(memberId), role: role });
}

// DELETE /api/cloud/projects/:id/team/:mid  (soft revoke, never hard-delete)
export async function handleTeamRevoke(request, env, projectId, memberId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare(
    'SELECT id FROM cloud_team_members WHERE id = ? AND project_id = ?'
  ).bind(memberId, projectId).first();
  if (!row) return json({ ok: false, error: 'member_not_found' }, 404);
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'revoked', invite_token = NULL WHERE id = ? AND project_id = ?"
  ).bind(memberId, projectId).run();
  return json({ ok: true, memberId: Number(memberId), status: 'revoked' });
}

// POST /api/team/accept { token } - the invited user must be signed in.
export async function handleTeamAccept(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const token = String((body && body.token) || '').trim();
  if (!token) return json({ ok: false, error: 'missing token' }, 400);
  const row = await env.DB.prepare(
    "SELECT id, project_id, user_sub, role, status FROM cloud_team_members WHERE invite_token = ? AND status = 'pending'"
  ).bind(token).first();
  if (!row) return json({ ok: false, error: 'invalid or expired invitation' }, 404);
  if (row.user_sub !== session.sub) return json({ ok: false, error: 'this invitation is for a different account' }, 403);
  await env.DB.prepare(
    "UPDATE cloud_team_members SET status = 'active', accepted_at = ?, invite_token = NULL WHERE id = ?"
  ).bind(nowIso(), row.id).run();
  return json({ ok: true, projectId: row.project_id, role: row.role });
}

// Exported for reuse by presence/manifest paths that already resolve a member.
export { ownerTier };
