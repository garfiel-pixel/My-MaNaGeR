/* ============================================================
   ADMIN — operator-gated cloud project listing
   ------------------------------------------------------------
   Extracted from worker.js. The admin endpoint lists ALL cloud
   projects with theme preferences surfaced per project.
   ============================================================ */
import { json, codesEqual, cloudDummyHash, cloudTimingSink } from './lib/http.js';

const CLOUD_PREFS_PREFIX = 'prefs/';
function cloudPrefsKey(sub) { return CLOUD_PREFS_PREFIX + sub + '.json'; }
function cloudSanitizePalette(v) { return v === 'cyan' || v === 'default' ? v : null; }

export async function cloudAdminAuth(request, env) {
  const expected = env && typeof env.ADMIN_CODE === 'string' ? env.ADMIN_CODE.trim() : '';
  if (!expected) return { disabled: true };
  const code = String(request.headers.get('X-Admin-Code') || '').trim();
  if (!code || !codesEqual(code, expected)) {
    await Promise.all([cloudDummyHash(), cloudTimingSink()]);
    return null;
  }
  return { ok: true };
}

export async function handleAdminCloudList(request, env) {
  const auth = await cloudAdminAuth(request, env);
  if (auth && auth.disabled) return json({ ok: false, error: 'admin API not configured — set the ADMIN_CODE secret' }, 503);
  if (!auth) return json({ ok: false, error: 'invalid admin code' }, 403);
  const rows = await env.DB.prepare('SELECT project_id, owner_label, google_name, google_sub, latest_r2_key, created_at, updated_at, deleted_at FROM cloud_projects ORDER BY updated_at DESC').all();
  const projects = [];
  for (const r of (rows.results || [])) {
    let themePrefs = null;
    if (r.google_sub) {
      try {
        const obj = await env.R2.get(cloudPrefsKey(r.google_sub));
        if (obj) {
          const p = JSON.parse(await obj.text());
          if (p) themePrefs = {
            palette: cloudSanitizePalette(p.palette) || 'default',
            dark: !!p.dark,
            updatedAt: p.updatedAt || null
          };
        }
      } catch (e) { themePrefs = null; }
    }
    projects.push({ projectId: r.project_id, label: r.owner_label || null, linkedName: r.google_name || null, hasSnapshot: !!r.latest_r2_key, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at || null, themePrefs: themePrefs });
  }
  return json({ ok: true, projects: projects });
}
