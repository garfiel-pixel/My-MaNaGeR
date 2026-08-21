/* ============================================================
   CLOUD SYNC — prefs, offline copies, broadcast
   ------------------------------------------------------------
   Extracted from worker.js. Theme preferences (R2), offline
   copy management, and broadcast to connected copies.
   ============================================================ */
import { json, cloudForbidden, cloudProjectDeleted,
  cloudAuthOwnerEither, cloudAuthAnyAccess, readCloudBody, readSession } from '../lib/http.js';

const CLOUD_PREFS_PREFIX = 'prefs/';
function cloudPrefsKey(sub) { return CLOUD_PREFS_PREFIX + sub + '.json'; }
function cloudSanitizePalette(v) { return v === 'cyan' || v === 'default' ? v : null; }
function cloudSanitizeSidebar(v) { return v === 'on' || v === 'off' ? v : null; }

export async function handleCloudPrefsGet(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const obj = await env.R2.get(cloudPrefsKey(session.sub));
  if (!obj) return json({ ok: true, theme: { palette: 'default', dark: false, sidebar: null } });
  let parsed = null;
  try { parsed = JSON.parse(await obj.text()); } catch (e) { parsed = null; }
  const palette = cloudSanitizePalette(parsed && parsed.palette) || 'default';
  const sidebar = cloudSanitizeSidebar(parsed && parsed.sidebar);
  return json({ ok: true, theme: { palette: palette, dark: !!(parsed && parsed.dark), sidebar: sidebar } });
}

export async function handleCloudPrefsPut(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const cl = Number(request.headers.get('content-length') || 0);
  if (cl > 2048) return json({ ok: false, error: 'payload too large' }, 413);
  let body = null;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'invalid JSON body' }, 400); }
  const palette = cloudSanitizePalette(body && body.palette);
  const dark = body && typeof body.dark === 'boolean' ? body.dark : null;
  const sidebar = cloudSanitizeSidebar(body && body.sidebar);
  if (palette === null && dark === null && sidebar === null) return json({ ok: false, error: 'nothing to save (palette must be "default"|"cyan", dark a boolean, sidebar "on"|"off")' }, 400);
  const key = cloudPrefsKey(session.sub);
  let cur = { palette: 'default', dark: false, sidebar: null };
  const existing = await env.R2.get(key);
  if (existing) { try { const p = JSON.parse(await existing.text()); if (p) cur = p; } catch (e) { /* keep defaults */ } }
  const next = {
    palette: palette === null ? (cloudSanitizePalette(cur.palette) || 'default') : palette,
    dark: dark === null ? !!cur.dark : dark,
    sidebar: sidebar === null ? (cloudSanitizeSidebar(cur.sidebar) || null) : sidebar,
    updatedAt: new Date().toISOString()
  };
  await env.R2.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  return json({ ok: true, theme: { palette: next.palette, dark: next.dark, sidebar: next.sidebar } });
}

export { cloudPrefsKey, cloudSanitizePalette };

export async function handleOfflineCopyRegister(request, env, projectId) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const deviceId = String(read.body.deviceId || '').trim();
  if (!deviceId || deviceId.length > 64 || !/^[A-Za-z0-9._:-]{1,64}$/.test(deviceId)) {
    return json({ ok: false, error: 'deviceId is required (letters, numbers, . _ : -)' }, 400);
  }
  const auth = await cloudAuthAnyAccess(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT deleted_at, updated_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  const now = new Date().toISOString();
  const copyId = crypto.randomUUID();
  const res = await env.DB.prepare(
    'INSERT INTO offline_copies (id, project_id, device_id, created_at) VALUES (?,?,?,?) ' +
    'ON CONFLICT(project_id, device_id) DO NOTHING'
  ).bind(copyId, projectId, deviceId, now).run();
  const finalId = (res.meta && res.meta.changes > 0)
    ? copyId
    : (await env.DB.prepare('SELECT id FROM offline_copies WHERE project_id = ? AND device_id = ?').bind(projectId, deviceId).first() || {}).id;
  return json({ ok: true, copyId: finalId || copyId, deviceId: deviceId, registeredAt: now, revision: row.updated_at || null });
}

export async function handleOfflineCopyList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT deleted_at, updated_at, auto_broadcast FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  const rows = await env.DB.prepare(
    'SELECT id, device_id, created_at, last_pulled_at, last_cloud_rev FROM offline_copies WHERE project_id = ? ORDER BY created_at ASC'
  ).bind(projectId).all();
  const copies = (rows.results || []).map(function(r) {
    return {
      id: r.id, deviceId: r.device_id, createdAt: r.created_at,
      lastPulledAt: r.last_pulled_at, lastCloudRev: r.last_cloud_rev
    };
  });
  return json({ ok: true, copies: copies, revision: row.updated_at || null, autoBroadcast: !!row.auto_broadcast });
}

export async function handleOfflineCopyDelete(request, env, projectId, copyId) {
  const owner = await cloudAuthOwnerEither(request, env, projectId);
  let deviceId = '';
  if (!owner) {
    const read = await readCloudBody(request);
    if (!read.bad && read.body && typeof read.body === 'object') deviceId = String(read.body.deviceId || '').trim();
    if (!deviceId) return cloudForbidden();
  }
  const where = owner
    ? await env.DB.prepare('SELECT id FROM offline_copies WHERE id = ? AND project_id = ?').bind(copyId, projectId).first()
    : await env.DB.prepare('SELECT id FROM offline_copies WHERE id = ? AND project_id = ? AND device_id = ?').bind(copyId, projectId, deviceId).first();
  if (!where) return json({ ok: false, error: 'offline copy not found' }, 404);
  await env.DB.prepare('DELETE FROM offline_copies WHERE id = ? AND project_id = ?').bind(copyId, projectId).run();
  return json({ ok: true, removed: copyId });
}

// presencePushRevChanged is still in worker.js — passed as parameter
export async function handleCloudBroadcast(request, env, projectId, presencePushRevChanged) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT deleted_at, updated_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  const now = new Date().toISOString();
  const revision = row.updated_at || now;
  if (presencePushRevChanged) await presencePushRevChanged(env, projectId, revision);
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM offline_copies WHERE project_id = ?').bind(projectId).first();
  const copies = cnt ? Number(cnt.n || 0) : 0;
  await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'broadcast', 'owner', auth.label || 'Owner', null, null, null, now).run();
  return json({ ok: true, broadcastAt: now, revision: revision, copies: copies });
}

export async function handleCloudAutoBroadcast(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const enabled = read.body.enabled === true || read.body.enabled === 1;
  const row = await env.DB.prepare('SELECT deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  await env.DB.prepare('UPDATE cloud_projects SET auto_broadcast = ? WHERE project_id = ?').bind(enabled ? 1 : 0, projectId).run();
  return json({ ok: true, enabled: enabled });
}
