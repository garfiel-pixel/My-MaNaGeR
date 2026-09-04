/* ============================================================
   My MaNaGeR , Cloud Client Codes (C19)
   Admin-generated read-only codes with section toggles.
   Client codes grant read-only access to specific panels only.
   ============================================================ */

import { json, hashOwnerCode, randomSaltHex } from '../lib/http.js';

// All possible section IDs that can be toggled
const CLIENT_SECTIONS = [
  'dash', 'def', 'charter', 'wbs', 'gantt', 'kan', 'res', 'bud',
  'raci', 'comms', 'docs', 'meet', 'stk', 'chg', 'log', 'risk',
  'claim', 'close', 'dmaic'
];

// Section display names for the admin UI
const SECTION_LABELS = {
  dash: 'Dashboard', def: 'Definitions', charter: 'Charter', wbs: 'WBS',
  gantt: 'Gantt', kan: 'Kanban', res: 'Resources', bud: 'Budget',
  raci: 'RACI', comms: 'Comms Log', docs: 'Documents', meet: 'Meetings',
  stk: 'Stakeholders', chg: 'Changes', log: 'Decision Log', risk: 'Risk / Issues',
  claim: 'Claim Pack', close: 'Closure', dmaic: 'DMAIC'
};

/**
 * POST /api/cloud/projects/:id/client-codes
 * Create a new client code with section toggles.
 * Body: { sections: ["dash", "wbs", "bud"], expiresInDays: 30 }
 *   or { sections: [...], expiresAt: "2026-10-01T00:00:00Z" } — an
 *   omitted/zero expiry means the code never expires.
 * Returns: { ok: true, code: "XXXXXX", codeId: 123, sections: [...], expiresAt }
 */
export async function handleCloudClientCodeCreate(request, env, projectId) {
  try {
    const session = await readSession(request, env);
    if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);

    // Verify owner
    const project = await env.DB.prepare(
      'SELECT project_id, google_sub, deleted_at FROM cloud_projects WHERE project_id = ?'
    ).bind(projectId).first();
    if (!project) return json({ ok: false, error: 'project not found' }, 404);
    if (project.google_sub !== session.sub) return json({ ok: false, error: 'not owner' }, 403);
    if (project.deleted_at) return json({ ok: false, error: 'project_deleted' }, 403);

    const body = await request.json();
    const sections = Array.isArray(body.sections) ? body.sections : ['dash'];
    // Validate sections
    const validSections = sections.filter(s => CLIENT_SECTIONS.includes(s));
    if (!validSections.length) return json({ ok: false, error: 'no valid sections' }, 400);

    // Expiry: expiresInDays (positive integer) wins, else expiresAt (ISO).
    // Anything invalid/absent means never expires.
    let expiresAt = null;
    const days = Math.floor(Number(body.expiresInDays));
    if (Number.isFinite(days) && days > 0) {
      expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    } else if (typeof body.expiresAt === 'string' && !isNaN(Date.parse(body.expiresAt))) {
      expiresAt = new Date(body.expiresAt).toISOString();
    }

    // Generate code
    const code = genCode();
    const salt = randomSaltHex();
    const codeHash = await hashOwnerCode(code, salt);

    const result = await env.DB.prepare(
      'INSERT INTO cloud_client_codes (project_id, code_hash, code_salt, sections, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(projectId, codeHash, salt, JSON.stringify(validSections), expiresAt).run();

    return json({
      ok: true,
      code: code,
      codeId: result.meta.last_row_id,
      sections: validSections,
      expiresAt: expiresAt
    });
  } catch (e) {
    return json({ ok: false, error: e.message || 'server error' }, 500);
  }
}

/**
 * GET /api/cloud/projects/:id/client-codes
 * List all client codes for a project.
 * Returns: { ok: true, codes: [{ id, sections, created_at }] }
 */
export async function handleCloudClientCodeList(request, env, projectId) {
  try {
    const session = await readSession(request, env);
    if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);

    const project = await env.DB.prepare(
      'SELECT project_id, google_sub FROM cloud_projects WHERE project_id = ?'
    ).bind(projectId).first();
    if (!project) return json({ ok: false, error: 'project not found' }, 404);
    if (project.google_sub !== session.sub) return json({ ok: false, error: 'not owner' }, 403);

    const rows = await env.DB.prepare(
      'SELECT id, sections, created_at, expires_at FROM cloud_client_codes WHERE project_id = ? ORDER BY created_at DESC'
    ).bind(projectId).all();

    const codes = (rows.results || []).map(r => ({
      id: r.id,
      sections: JSON.parse(r.sections || '["dash"]'),
      created_at: r.created_at,
      expires_at: r.expires_at
    }));

    return json({ ok: true, codes: codes });
  } catch (e) {
    return json({ ok: false, error: e.message || 'server error' }, 500);
  }
}

/**
 * DELETE /api/cloud/projects/:id/client-codes/:codeId
 * Revoke a client code.
 */
export async function handleCloudClientCodeRevoke(request, env, projectId, codeId) {
  try {
    const session = await readSession(request, env);
    if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);

    const project = await env.DB.prepare(
      'SELECT project_id, google_sub FROM cloud_projects WHERE project_id = ?'
    ).bind(projectId).first();
    if (!project) return json({ ok: false, error: 'project not found' }, 404);
    if (project.google_sub !== session.sub) return json({ ok: false, error: 'not owner' }, 403);

    await env.DB.prepare(
      'DELETE FROM cloud_client_codes WHERE id = ? AND project_id = ?'
    ).bind(codeId, projectId).run();

    return json({ ok: true, deleted: true });
  } catch (e) {
    return json({ ok: false, error: e.message || 'server error' }, 500);
  }
}

/**
 * Verify a client code and return its sections.
 * Used by the launcher to authenticate client access.
 * @param {string} code - The raw client code
 * @param {string} projectId - The project ID
 * @param {object} env - Worker env
 * @returns {object|null} { projectId, sections } or null if invalid
 */
export async function verifyClientCode(code, projectId, env) {
  if (!code || !projectId) return null;

  // C19: carry expires_at + the project's deleted_at so callers can map the
  // friendly errors (code_expired / project_deleted) instead of a bare 403.
  const rows = await env.DB.prepare(
    'SELECT c.id, c.code_hash, c.code_salt, c.sections, c.expires_at, p.deleted_at FROM cloud_client_codes c JOIN cloud_projects p ON p.project_id = c.project_id WHERE c.project_id = ?'
  ).bind(projectId).all();

  for (const row of (rows.results || [])) {
    const hash = await hashOwnerCode(code, row.code_salt);
    if (hash === row.code_hash) {
      const expiresAt = row.expires_at || null;
      const expired = !!(expiresAt && new Date(expiresAt).getTime() < Date.now());
      return {
        projectId: projectId,
        sections: JSON.parse(row.sections || '["dash"]'),
        codeId: row.id,
        expiresAt: expiresAt,
        expired: expired,
        deleted: !!row.deleted_at
      };
    }
  }
  return null;
}

// Generate a 8-char uppercase code
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Import readSession from http.js
import { readSession } from '../lib/http.js';

export { CLIENT_SECTIONS, SECTION_LABELS };
