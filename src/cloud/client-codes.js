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
 * Body: { sections: ["dash", "wbs", "bud"] }
 * Returns: { ok: true, code: "XXXXXX", codeId: 123, sections: [...] }
 */
export async function handleCloudClientCodeCreate(request, env, projectId) {
  try {
    const session = await readSession(request, env);
    if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);

    // Verify owner
    const project = await env.DB.prepare(
      'SELECT project_id, google_sub FROM cloud_projects WHERE project_id = ?'
    ).bind(projectId).first();
    if (!project) return json({ ok: false, error: 'project not found' }, 404);
    if (project.google_sub !== session.sub) return json({ ok: false, error: 'not owner' }, 403);

    const body = await request.json();
    const sections = Array.isArray(body.sections) ? body.sections : ['dash'];
    // Validate sections
    const validSections = sections.filter(s => CLIENT_SECTIONS.includes(s));
    if (!validSections.length) return json({ ok: false, error: 'no valid sections' }, 400);

    // Generate code
    const code = genCode();
    const salt = randomSaltHex();
    const codeHash = await hashOwnerCode(code, salt);

    const result = await env.DB.prepare(
      'INSERT INTO cloud_client_codes (project_id, code_hash, code_salt, sections) VALUES (?, ?, ?, ?)'
    ).bind(projectId, codeHash, salt, JSON.stringify(validSections)).run();

    return json({
      ok: true,
      code: code,
      codeId: result.meta.last_row_id,
      sections: validSections
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

  // Find all codes for this project and compare hashes
  const rows = await env.DB.prepare(
    'SELECT id, code_hash, code_salt, sections FROM cloud_client_codes WHERE project_id = ?'
  ).bind(projectId).all();

  for (const row of (rows.results || [])) {
    const hash = await hashOwnerCode(code, row.code_salt);
    if (hash === row.code_hash) {
      return {
        projectId: projectId,
        sections: JSON.parse(row.sections || '["dash"]'),
        codeId: row.id
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
