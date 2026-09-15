/* ============================================================
   PROJECT API KEYS - create/list/revoke (owner directive 2026-09-15)
   ------------------------------------------------------------
   Extracted pattern from cloud/editors.js. Owner-only management
   of scoped, expiring API keys for cloud projects. A key can only
   be created INSIDE a project (every handler takes projectId) and
   authorizes an external agent on that one project with the same
   CLOUD_SECTIONS scope enforcement as editor codes. The plaintext
   key is returned exactly once at create; the Worker stores only
   PBKDF2(salt, key) plus a sha256 fingerprint for O(1) lookup.
   ============================================================ */
import { json, cloudForbidden, readCloudBody,
  cloudAuthOwnerEither, randomSaltHex, randomOwnerCode,
  hashOwnerCode, fingerprintOf, CLOUD_SECTIONS } from '../lib/http.js';

const CLOUD_MAX_API_KEYS = 10;
const API_KEY_PREFIX_LEN = 8;

export async function handleCloudApiKeyCreate(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const activeRows = await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_api_keys WHERE project_id = ? AND active = 1').bind(projectId).first();
  if (activeRows && Number(activeRows.n) >= CLOUD_MAX_API_KEYS) {
    return json({ ok: false, error: 'too many active API keys (max ' + CLOUD_MAX_API_KEYS + ') - revoke unused keys first' }, 400);
  }
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const label = typeof read.body.label === 'string' ? read.body.label.trim().slice(0, 60) : '';
  // Section scope: same allowlist as editor codes. At least one section -
  // a key that can touch nothing is never issued.
  const scope = Array.isArray(read.body.scope)
    ? read.body.scope.filter(function(s) { return typeof s === 'string' && !!CLOUD_SECTIONS[s]; })
    : [];
  const seen = {}; const unique = scope.filter(function(s) { if (seen[s]) return false; seen[s] = 1; return true; });
  if (unique.length === 0) return json({ ok: false, error: 'at least one section is required' }, 400);
  // Expiry: owner-chosen. Accept an ISO string or days-from-now number;
  // must be in the future when provided. Empty/null = no expiry.
  // expiresInDays is accepted as an alias (the client-code/editor-code
  // convention) so all three sharing endpoints speak the same language.
  let expiresAt = null;
  const rawExp = read.body.expiresAt !== undefined ? read.body.expiresAt : read.body.expiresInDays;
  if (typeof rawExp === 'number' && isFinite(rawExp) && rawExp > 0) {
    expiresAt = new Date(Date.now() + rawExp * 86400000).toISOString();
  } else if (typeof rawExp === 'string' && rawExp.trim()) {
    const t = Date.parse(rawExp.trim());
    if (isNaN(t) || t <= Date.now()) return json({ ok: false, error: 'expiry must be a future date' }, 400);
    expiresAt = new Date(t).toISOString();
  }
  const salt = randomSaltHex();
  const apiKey = randomOwnerCode() + '-' + randomOwnerCode(); // 36 chars, longer than owner codes
  const hash = await hashOwnerCode(apiKey, salt);
  const fp = await fingerprintOf(apiKey);
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_api_keys (project_id, label, scope, key_salt, key_hash, key_fingerprint, key_prefix, expires_at, active, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)'
  ).bind(projectId, label, JSON.stringify(unique), salt, hash, fp, apiKey.slice(0, API_KEY_PREFIX_LEN), expiresAt, now).run();
  return json({ ok: true, apiKey: apiKey, keyId: res.meta.last_row_id, label: label, scope: unique, expiresAt: expiresAt, createdAt: now });
}

export async function handleCloudApiKeyList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare('SELECT id, label, scope, key_prefix, expires_at, active, created_at, last_used_at FROM cloud_api_keys WHERE project_id = ? ORDER BY id DESC').bind(projectId).all();
  const keys = (rows.results || []).map(function(r) {
    let scope = [];
    try { const p = JSON.parse(r.scope); if (Array.isArray(p)) scope = p; } catch (e) { scope = []; }
    let expired = false;
    if (r.expires_at) { const t = Date.parse(r.expires_at); expired = !isNaN(t) && t <= Date.now(); }
    return { id: r.id, label: r.label, scope: scope, prefix: r.key_prefix, expiresAt: r.expires_at,
      active: r.active === 1 && !expired, created_at: r.created_at, last_used_at: r.last_used_at };
  });
  return json({ ok: true, keys: keys });
}

export async function handleCloudApiKeyRevoke(request, env, projectId, keyId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const res = await env.DB.prepare('UPDATE cloud_api_keys SET active = 0 WHERE id = ? AND project_id = ? AND active = 1').bind(keyId, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'API key not found' }, 404);
  return json({ ok: true, revokedKeyId: Number(keyId) });
}
