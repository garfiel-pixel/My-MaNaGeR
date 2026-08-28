/* ============================================================
   CLOUD CHANGELOG — list/revert/import changelog entries
   ------------------------------------------------------------
   Extracted from worker.js. Owner-only changelog management
   including MCP import with honesty gate verification.
   ============================================================ */
import { json, cloudForbidden, cloudReadState, cloudDeepEqual,
  cloudPathGet, cloudRevertDiff, cloudEncryptState,
  cloudAuthOwnerEither, readCloudBody } from '../lib/http.js';

const CLOUD_IMPORT_MAX_ENTRIES = 500;
const CLOUD_IMPORT_MAX_DIFFS = 1000;

export async function handleCloudChangelogList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare('SELECT id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, import_key, created_at FROM cloud_changelog WHERE project_id = ? ORDER BY id DESC LIMIT 100').bind(projectId).all();
  const entries = (rows.results || []).map(function(r) {
    let diffs = null;
    try { if (r.diffs_json) diffs = JSON.parse(r.diffs_json); } catch (e) { diffs = null; }
    return { id: r.id, type: r.entry_type, actorType: r.actor_type, actorLabel: r.actor_label, section: r.section, diffs: diffs, hasSnapshot: !!r.snapshot_key, source: r.import_key ? 'mcp' : 'cloud', createdAt: r.created_at };
  });
  return json({ ok: true, entries: entries });
}

export async function handleCloudChangelogRevert(request, env, projectId, entryId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const entry = await env.DB.prepare('SELECT id, entry_type, section, diffs_json, snapshot_key FROM cloud_changelog WHERE id = ? AND project_id = ?').bind(entryId, projectId).first();
  if (!entry) return json({ ok: false, error: 'entry not found' }, 404);
  const key = 'projects/' + projectId + '/latest.json';
  // Fetch encryption credentials for decrypting the current state blob
  const projRow = await env.DB.prepare('SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  const cur = await cloudReadState(env, key, projRow && projRow.owner_code_hash, projRow && projRow.owner_code_salt);
  if (!cur) return json({ ok: false, error: 'no snapshot to revert against' }, 400);
  const now = new Date().toISOString();
  let next; let logDiffs = null; let logSnapKey = null;
  if (entry.entry_type === 'edit' || entry.entry_type === 'accepted' || (entry.entry_type === 'revert' && !entry.snapshot_key)) {
    let diffs = [];
    try { if (entry.diffs_json) diffs = JSON.parse(entry.diffs_json); } catch (e) { diffs = []; }
    const pre = JSON.parse(JSON.stringify(cur));
    const revDiffs = [];
    diffs.forEach(function(d) {
      const curVal = cloudPathGet(pre, d.path);
      const applied = cloudRevertDiff(pre, d);
      if (!applied) return;
      revDiffs.push({
        path: d.path,
        before: curVal === undefined ? null : curVal,
        beforeAbsent: curVal === undefined,
        after: d.before,
        afterAbsent: !!d.beforeAbsent
      });
    });
    next = pre;
    logDiffs = revDiffs;
  } else if (entry.entry_type === 'bulk' || (entry.entry_type === 'revert' && entry.snapshot_key)) {
    if (!entry.snapshot_key) return json({ ok: false, error: 'entry has no snapshot' }, 400);
    const snap = await env.R2.get(entry.snapshot_key);
    if (!snap) return json({ ok: false, error: 'snapshot missing' }, 410);
    let snapState = null;
    try { snapState = JSON.parse(await snap.text()); } catch (e) { snapState = null; }
    if (!snapState) return json({ ok: false, error: 'snapshot corrupt' }, 410);
    logSnapKey = 'projects/' + projectId + '/changelog/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.json';
    await env.R2.put(logSnapKey, JSON.stringify(cur), { httpMetadata: { contentType: 'application/json' } });
    next = snapState;
  } else {
    return json({ ok: false, error: 'unsupported entry type' }, 400);
  }
  next.updatedAt = now;
  // Encrypt state blob on revert (same envelope as handleCloudSave)
  // projRow already fetched above for decryption — reuse for encryption
  let r2Payload = JSON.stringify(next);
  if (projRow && projRow.owner_code_hash && projRow.owner_code_salt) {
    try { r2Payload = await cloudEncryptState(next, projRow.owner_code_hash, projRow.owner_code_salt); } catch (e) { /* fall back to plaintext */ }
  }
  await env.R2.put(key, r2Payload, { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?').bind(key, now, projectId).run();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'revert', 'owner', auth.label, entry.section || null, logDiffs ? JSON.stringify(logDiffs) : null, logSnapKey, now).run();
  return json({ ok: true, revertedEntryId: entry.id, revertEntryId: res.meta.last_row_id, savedAt: now });
}

function sanitizeImportEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'malformed entry' };
  const localId = Number(raw.localId !== undefined ? raw.localId : raw.id);
  if (!Number.isInteger(localId) || localId < 1) return { ok: false, reason: 'localId must be a positive integer' };
  const type = String(raw.entry_type || '');
  if (type !== 'edit' && type !== 'bulk' && type !== 'revert') return { ok: false, reason: 'unsupported entry_type "' + type + '"' };
  const actorType = raw.actor_type === 'editor' ? 'editor' : 'owner';
  const label = typeof raw.actor_label === 'string' && raw.actor_label.trim()
    ? raw.actor_label.trim().slice(0, 60) : 'mcp-ai';
  const createdAt = String(raw.created_at || '');
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return { ok: false, reason: 'created_at must be an ISO date' };
  let diffs = null;
  if (raw.diffs_json !== undefined && raw.diffs_json !== null) {
    if (typeof raw.diffs_json === 'string') {
      try { diffs = JSON.parse(raw.diffs_json); } catch (e) { return { ok: false, reason: 'diffs_json is not valid JSON' }; }
    } else {
      diffs = raw.diffs_json;
    }
    if (!Array.isArray(diffs)) return { ok: false, reason: 'diffs_json must be an array' };
    if (diffs.length > CLOUD_IMPORT_MAX_DIFFS) return { ok: false, reason: 'too many diffs (max ' + CLOUD_IMPORT_MAX_DIFFS + ')' };
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      if (!d || typeof d !== 'object' || typeof d.path !== 'string' || !d.path) return { ok: false, reason: 'diff missing path' };
      if (typeof d.beforeAbsent !== 'boolean' || typeof d.afterAbsent !== 'boolean') return { ok: false, reason: 'diff missing beforeAbsent/afterAbsent' };
    }
  }
  return { ok: true, entry: { localId: localId, type: type, actorType: actorType, label: label, createdAt: createdAt, diffs: diffs } };
}

function cloudVerifyImportedDiffs(blob, diffs) {
  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    const m = String(d.path).match(/^([a-zA-Z]+)(?:\[(\d+)\])?(?:\.([a-zA-Z]+))?$/);
    if (!m) return { ok: false, reason: 'malformed diff path ' + d.path };
    const listKey = m[1];
    const field = m[3];
    if (listKey === 'charter') {
      const v = cloudPathGet(blob, d.path);
      if (d.afterAbsent ? v !== undefined : !cloudDeepEqual(v, d.after)) {
        return { ok: false, reason: 'blob diverged from the MCP edit at ' + d.path };
      }
      continue;
    }
    const list = blob[listKey];
    if (!Array.isArray(list)) return { ok: false, reason: 'no "' + listKey + '" in the cloud blob (blob diverged from the MCP edit)' };
    if (d.recordId !== undefined) {
      const rec = list.find(function(r) { return r && String(r.id) === String(d.recordId); });
      if (d.afterAbsent) {
        if (rec !== undefined) return { ok: false, reason: 'deleted record ' + d.recordId + ' still exists in the cloud (blob diverged from the MCP edit)' };
      } else if (d.beforeAbsent) {
        if (rec === undefined || !cloudDeepEqual(rec, d.after)) return { ok: false, reason: 'added record ' + d.recordId + ' missing from the cloud (blob diverged from the MCP edit)' };
      } else if (field) {
        if (rec === undefined || !cloudDeepEqual(rec[field], d.after)) return { ok: false, reason: 'field ' + d.path + ' diverged from the MCP edit' };
      } else {
        if (rec === undefined || !cloudDeepEqual(rec, d.after)) return { ok: false, reason: 'record ' + d.recordId + ' diverged from the MCP edit' };
      }
      continue;
    }
    const v = cloudPathGet(blob, d.path);
    if (d.afterAbsent ? v !== undefined : !cloudDeepEqual(v, d.after)) {
      return { ok: false, reason: 'blob diverged from the MCP edit at ' + d.path };
    }
  }
  return { ok: true };
}

export async function handleCloudChangelogImport(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const submitted = Array.isArray(read.body.entries) ? read.body.entries : null;
  if (!submitted || submitted.length === 0) return json({ ok: false, error: 'entries required' }, 400);
  if (submitted.length > CLOUD_IMPORT_MAX_ENTRIES) return json({ ok: false, error: 'too many entries (max ' + CLOUD_IMPORT_MAX_ENTRIES + ')' }, 400);
  const key = 'projects/' + projectId + '/latest.json';
  const projRow = await env.DB.prepare('SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  const cur = await cloudReadState(env, key, projRow && projRow.owner_code_hash, projRow && projRow.owner_code_salt);
  const imported = [];
  const skipped = [];
  for (let i = 0; i < submitted.length; i++) {
    const s = sanitizeImportEntry(submitted[i]);
    if (!s.ok) { skipped.push({ localId: submitted[i] && submitted[i].localId !== undefined ? submitted[i].localId : (submitted[i] && submitted[i].id !== undefined ? submitted[i].id : null), reason: s.reason }); continue; }
    const e = s.entry;
    if (!e.diffs || e.diffs.length === 0) {
      skipped.push({ localId: e.localId, reason: 'entry has no diffs' });
      continue;
    }
    if (!cur) { skipped.push({ localId: e.localId, reason: 'no cloud snapshot yet' }); continue; }
    const verify = cloudVerifyImportedDiffs(cur, e.diffs);
    if (!verify.ok) { skipped.push({ localId: e.localId, reason: verify.reason }); continue; }
    const importKey = 'mcp:' + projectId + ':' + e.localId;
    const now = new Date().toISOString();
    const entryType = e.type === 'bulk' ? 'edit' : e.type;
    try {
      const ins = await env.DB.prepare(
        "INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at, import_key) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(import_key) DO NOTHING"
      ).bind(projectId, entryType, e.actorType, e.label, null, JSON.stringify(e.diffs), null, e.createdAt, importKey).run();
      if (ins && ins.meta && ins.meta.changes > 0) {
        imported.push({ localId: e.localId, entryType: entryType });
      } else {
        skipped.push({ localId: e.localId, reason: 'already imported' });
      }
    } catch (err) {
      skipped.push({ localId: e.localId, reason: 'D1 insert failed: ' + (err.message || 'unknown') });
    }
  }
  return json({ ok: true, imported: imported.length, skipped: skipped.length, importedEntries: imported, skippedEntries: skipped });
}
