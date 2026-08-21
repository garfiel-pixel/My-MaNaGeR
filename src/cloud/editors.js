/* ============================================================
   CLOUD EDITORS — editor code create/list/revoke
   ------------------------------------------------------------
   Extracted from worker.js. Owner-only management of scoped
   editor/viewer codes for cloud projects.
   ============================================================ */
import { json, cloudForbidden, readCloudBody,
  cloudAuthOwnerEither, randomSaltHex, randomOwnerCode,
  hashOwnerCode, fingerprintOf, CLOUD_SECTIONS } from '../lib/http.js';

const CLOUD_MAX_EDITOR_CODES = 25;

export async function handleCloudEditorCreate(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const activeRows = await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_editor_codes WHERE project_id = ? AND active = 1').bind(projectId).first();
  if (activeRows && Number(activeRows.n) >= CLOUD_MAX_EDITOR_CODES) {
    return json({ ok: false, error: 'too many active editor codes (max ' + CLOUD_MAX_EDITOR_CODES + ') — revoke unused codes first' }, 400);
  }
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const label = typeof read.body.label === 'string' ? read.body.label.trim().slice(0, 60) : '';
  const role = read.body.role === 'view' ? 'view' : 'editor';
  const scope = Array.isArray(read.body.scope)
    ? read.body.scope.filter(function(s) { return typeof s === 'string' && !!CLOUD_SECTIONS[s]; })
    : [];
  const seen = {}; const unique = scope.filter(function(s) { if (seen[s]) return false; seen[s] = 1; return true; });
  if (unique.length === 0) return json({ ok: false, error: 'at least one section is required' }, 400);
  const salt = randomSaltHex();
  const code = randomOwnerCode();
  const hash = await hashOwnerCode(code, salt);
  const fp = await fingerprintOf(code);
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_editor_codes (project_id, label, scope, code_salt, code_hash, code_fingerprint, role, active, created_at) VALUES (?,?,?,?,?,?,?,1,?)'
  ).bind(projectId, label, JSON.stringify(unique), salt, hash, fp, role, now).run();
  return json({ ok: true, editorCode: code, editorId: res.meta.last_row_id, label: label, scope: unique, role: role, createdAt: now });
}

export async function handleCloudEditorList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare('SELECT id, label, scope, role, active, created_at FROM cloud_editor_codes WHERE project_id = ? ORDER BY id DESC').bind(projectId).all();
  const editors = (rows.results || []).map(function(r) {
    let scope = [];
    try { const p = JSON.parse(r.scope); if (Array.isArray(p)) scope = p; } catch (e) { scope = []; }
    return { id: r.id, label: r.label, scope: scope, role: r.role || 'editor', active: r.active === 1, createdAt: r.created_at };
  });
  return json({ ok: true, editors: editors });
}

export async function handleCloudEditorRevoke(request, env, projectId, editorId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const res = await env.DB.prepare('UPDATE cloud_editor_codes SET active = 0 WHERE id = ? AND project_id = ? AND active = 1').bind(editorId, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'editor code not found' }, 404);
  return json({ ok: true, revokedEditorId: editorId });
}
