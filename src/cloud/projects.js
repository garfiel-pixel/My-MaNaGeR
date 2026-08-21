/* ============================================================
   CLOUD PROJECTS — CRUD, save, load, recover, meta, unlink
   ------------------------------------------------------------
   Extracted from worker.js. The core cloud project management
   handlers including scoped editor saves and review proposals.
   ============================================================ */
import { json, cloudForbidden, cloudProjectDeleted, cloudTimingSink, cloudDummyHash,
  cloudReadState, cloudDeepEqual, cloudScopeMerge, cloudDiffState, cloudLogSave,
  cloudPathDelete, cloudTouchOwner, randomOwnerCode, randomSaltHex,
  hashOwnerCode, fingerprintOf, sanitizeProjectId, codesEqual,
  cloudAuthOwnerByCode, cloudAuthOwnerSession, cloudAuthOwnerEither,
  cloudAuthEditor, cloudAuthViewer, cloudAdopt, cloudAuthAdoption,
  readCloudBody, readSession, billingConfigured, billingFreeCap,
  CLOUD_SECTIONS, authEmailConfigured } from '../lib/http.js';

const CLOUD_STATE_SECRET_PATHS = [
  'config.ai.apiKey',
  'config.ai.azureKey',
  'config.api.keys'
];

function stripStateSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (let i = 0; i < CLOUD_STATE_SECRET_PATHS.length; i++) {
    cloudPathDelete(obj, CLOUD_STATE_SECRET_PATHS[i]);
  }
  return obj;
}

// billingStatusActive is needed for the create gate
function billingStatusActive(status) {
  return status === 'active' || status === 'on_trial';
}

export async function handleCloudProjectList(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const owned = await env.DB.prepare(
    'SELECT project_id, owner_label, google_name, latest_r2_key, created_at, updated_at, last_owner_seen_at FROM cloud_projects WHERE google_sub = ? AND deleted_at IS NULL'
  ).bind(session.sub).all();
  const adopted = await env.DB.prepare(
    'SELECT p.project_id, p.owner_label, p.google_name, p.latest_r2_key, p.created_at, p.updated_at, p.last_owner_seen_at, p.deleted_at, a.role AS adopted_role, a.created_at AS adopted_at ' +
    'FROM cloud_adoptions a JOIN cloud_projects p ON p.project_id = a.project_id ' +
    'WHERE a.recipient_sub = ?'
  ).bind(session.sub).all();
  const seen = {};
  const projects = [];
  ((owned && owned.results) || []).forEach(function(r) {
    seen[r.project_id] = 1;
    projects.push({
      projectId: r.project_id, label: r.owner_label || null, linkedName: r.google_name || null,
      hasSnapshot: !!r.latest_r2_key, createdAt: r.created_at, updatedAt: r.updated_at,
      lastOwnerSeenAt: r.last_owner_seen_at || null, accessRole: 'owner', adoptedAt: null
    });
  });
  ((adopted && adopted.results) || []).forEach(function(r) {
    if (seen[r.project_id]) return;
    const discontinued = !!r.deleted_at;
    projects.push({
      projectId: r.project_id, label: r.owner_label || null, linkedName: r.google_name || null,
      hasSnapshot: !!r.latest_r2_key, createdAt: r.created_at, updatedAt: r.updated_at,
      lastOwnerSeenAt: r.last_owner_seen_at || null,
      accessRole: r.adopted_role === 'view' ? 'view' : 'editor',
      adoptedAt: r.adopted_at || null, discontinued: discontinued,
      deletedAt: discontinued ? (r.deleted_at || null) : null
    });
  });
  projects.sort(function(a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
  return json({ ok: true, projects: projects });
}

export async function handleCloudUnadopt(request, env, projectId) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const res = await env.DB.prepare('DELETE FROM cloud_adoptions WHERE project_id = ? AND recipient_sub = ?').bind(projectId, session.sub).run();
  if (!res.meta.changes) return json({ ok: false, error: 'not adopted' }, 404);
  return json({ ok: true, removed: projectId });
}

export async function handleCloudCreate(request, env) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const projectId = sanitizeProjectId(read.body.projectId);
  if (!projectId) return json({ ok: false, error: 'bad project id' }, 400);
  const name = typeof read.body.name === 'string' ? read.body.name.slice(0, 120) : '';
  const existing = await env.DB.prepare('SELECT project_id FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (existing) return json({ ok: false, error: 'project already linked' }, 409);
  const session = await readSession(request, env);
  if (session && session.sub && session.sub.indexOf('email:') === 0 && authEmailConfigured(env)) {
    const userRow = await env.DB.prepare('SELECT email_verified FROM auth_users WHERE email = ?').bind(session.sub.slice('email:'.length)).first();
    if (!userRow || !userRow.email_verified) {
      return json({ ok: false, error: 'verify your email to enable cloud projects — check your inbox for the confirmation link', verifyRequired: true }, 403);
    }
  }
  if (session && session.sub && billingConfigured(env)) {
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM cloud_projects WHERE google_sub = ? AND deleted_at IS NULL').bind(session.sub).first();
    const owned = (cnt && cnt.c) || 0;
    if (owned >= billingFreeCap(env)) {
      const sub = await env.DB.prepare('SELECT status FROM cloud_subscriptions WHERE owner_sub = ?').bind(session.sub).first();
      if (!(sub && billingStatusActive(sub.status))) {
        return json({ ok: false, error: 'free plan limit reached — upgrade to create more linked projects', upgrade: true }, 402);
      }
    }
  }
  const salt = randomSaltHex();
  const ownerCode = randomOwnerCode();
  const hash = await hashOwnerCode(ownerCode, salt);
  const ownerFp = await fingerprintOf(ownerCode);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO cloud_projects (project_id, owner_code_salt, owner_code_hash, owner_code_fingerprint, owner_label, google_sub, google_name, latest_r2_key, created_at, updated_at, last_owner_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(projectId, salt, hash, ownerFp, name, session ? session.sub : null, session ? session.name : null, null, now, now, now).run();
  } catch (e) {
    const raced = await env.DB.prepare('SELECT project_id FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
    if (raced) return json({ ok: false, error: 'project already linked' }, 409);
    throw e;
  }
  return json({ ok: true, projectId: projectId, ownerCode: ownerCode, linked: !!session });
}

export async function queueEditorProposal(env, projectId, a, submitted, prev, now) {
  const merged = cloudScopeMerge(prev, submitted, a.scope);
  const scope = Array.isArray(a.scope) ? a.scope : [];
  if (!merged.applied.length) return { status: 'noop', reviewId: null, applied: merged.applied, blocked: merged.blocked };
  let diffs = cloudDiffState(prev, merged.next) || [];
  diffs = diffs.filter(function(d) { return String(d.path).indexOf('fieldTs') !== 0; });
  await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ? AND editor_code_id = ? AND status = ?')
    .bind(projectId, a.editorId, 'pending').run();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_reviews (project_id, proposal_type, source_type, source_label, editor_code_id, scope, submitted_json, diffs_json, status, proposed_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'save', 'editor', a.label || 'Editor', a.editorId, JSON.stringify(scope),
    JSON.stringify(stripStateSecrets(submitted)), JSON.stringify(diffs), 'pending', now).run();
  return { status: 'pending', reviewId: res.meta.last_row_id, applied: merged.applied, blocked: merged.blocked };
}

export async function handleCloudSave(request, env, projectId, cloudPushRevChangedIfCopies) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  if (read.body.state === undefined || read.body.state === null) return json({ ok: false, error: 'missing state' }, 400);
  const ownerCode = String(request.headers.get('X-Owner-Code') || '').trim()
    || (typeof read.body.ownerCode === 'string' ? read.body.ownerCode.trim() : '');
  const editorCode = String(request.headers.get('X-Editor-Code') || '').trim()
    || (typeof read.body.editorCode === 'string' ? read.body.editorCode.trim() : '');
  let adoptAuth = null;
  if (!ownerCode && !editorCode) {
    adoptAuth = await cloudAuthAdoption(request, env, projectId);
    if (adoptAuth && adoptAuth.revoked) return json({ ok: false, error: 'code_revoked' }, 403);
    if (adoptAuth && adoptAuth.deleted) return cloudProjectDeleted();
    if (!adoptAuth) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
    if (adoptAuth.role !== 'editor') { await cloudTimingSink(); return cloudForbidden(); }
  }
  const now = new Date().toISOString();
  const key = 'projects/' + projectId + '/latest.json';
  const prev = await cloudReadState(env, key);
  let next; let actor; let authRow = null;
  if (ownerCode) {
    const a = await cloudAuthOwnerByCode(request, env, projectId, ownerCode);
    if (!a) return cloudForbidden();
    authRow = a.row;
    actor = { type: 'owner', label: a.label };
    next = JSON.parse(JSON.stringify(read.body.state));
    stripStateSecrets(next);
    await cloudTouchOwner(env, projectId);
  } else if (adoptAuth) {
    const a = adoptAuth;
    authRow = a.row;
    actor = { type: 'editor', label: a.label };
    const queued = await queueEditorProposal(env, projectId, a, read.body.state, prev, now);
    return json({ ok: true, review: queued.status, reviewId: queued.reviewId, actor: 'editor', editorLabel: a.label, scope: a.scope, applied: queued.applied, blocked: queued.blocked, previousUpdatedAt: (prev && prev.updatedAt) || null });
  } else {
    const a = await cloudAuthEditor(request, env, projectId, editorCode);
    if (!a) return cloudForbidden();
    authRow = a.row;
    actor = { type: 'editor', label: a.label };
    if (authRow && authRow.deleted_at) return cloudProjectDeleted();
    const queued = await queueEditorProposal(env, projectId, a, read.body.state, prev, now);
    return json({ ok: true, review: queued.status, reviewId: queued.reviewId, actor: 'editor', editorLabel: a.label, scope: a.scope, applied: queued.applied, blocked: queued.blocked, previousUpdatedAt: (prev && prev.updatedAt) || null });
  }
  if (authRow && authRow.deleted_at) return cloudProjectDeleted();
  next.updatedAt = now;
  await env.R2.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?').bind(key, now, projectId).run();
  const entry = await cloudLogSave(env, projectId, prev, next, actor);
  const resp = { ok: true, savedAt: now, key: key, actor: actor.type, previousUpdatedAt: (prev && prev.updatedAt) || null };
  if (entry) resp.changelog = entry;
  if (cloudPushRevChangedIfCopies) await cloudPushRevChangedIfCopies(env, projectId, now, actor);
  return json(resp);
}

export async function handleCloudLoad(request, env, projectId) {
  const ownerCode = String(request.headers.get('X-Owner-Code') || '').trim();
  const editorCode = String(request.headers.get('X-Editor-Code') || '').trim();
  const viewCode = String(request.headers.get('X-View-Code') || '').trim();
  let sessFallback = null;
  let adoptFallback = null;
  if (!ownerCode && !editorCode && !viewCode) {
    sessFallback = await cloudAuthOwnerSession(request, env, projectId);
    if (!sessFallback) {
      adoptFallback = await cloudAuthAdoption(request, env, projectId);
      if (!adoptFallback) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
    }
  }
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, latest_r2_key, updated_at, deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
  let editorAuth = null;
  let viewerAuth = null;
  let ownerAuth = false;
  if (ownerCode) {
    const hash = await hashOwnerCode(ownerCode, row.owner_code_salt);
    if (!codesEqual(hash, row.owner_code_hash)) { await cloudTimingSink(); return cloudForbidden(); }
    ownerAuth = true;
  } else if (editorCode) {
    editorAuth = await cloudAuthEditor(request, env, projectId, editorCode);
    if (!editorAuth) return cloudForbidden();
    const sess = await readSession(request, env);
    if (sess && sess.sub) await cloudAdopt(env, projectId, sess.sub, editorAuth.editorId, 'editor');
  } else if (viewCode) {
    viewerAuth = await cloudAuthViewer(request, env, projectId, viewCode);
    if (!viewerAuth) return cloudForbidden();
    const sess = await readSession(request, env);
    if (sess && sess.sub) await cloudAdopt(env, projectId, sess.sub, viewerAuth.editorId, 'view');
  } else if (sessFallback) {
    ownerAuth = true;
  } else if (adoptFallback) {
    if (adoptFallback.revoked) return json({ ok: false, error: 'code_revoked' }, 403);
    if (adoptFallback.deleted) return cloudProjectDeleted();
    if (adoptFallback.role === 'view') viewerAuth = adoptFallback;
    else editorAuth = adoptFallback;
  }
  if (row.deleted_at) return cloudProjectDeleted();
  if (ownerAuth) await cloudTouchOwner(env, projectId);
  if (!row.latest_r2_key) {
    const base = { ok: true, state: null, savedAt: null };
    if (editorAuth) { base.role = 'editor'; base.editorLabel = editorAuth.label; base.scope = editorAuth.scope; }
    if (viewerAuth) { base.role = 'view'; base.viewerLabel = viewerAuth.label; base.scope = viewerAuth.scope; }
    return json(base);
  }
  const pullDevice = String(request.headers.get('X-Device-Id') || '').trim();
  if (pullDevice) {
    try {
      await env.DB.prepare(
        'UPDATE offline_copies SET last_pulled_at = ?, last_cloud_rev = ? WHERE project_id = ? AND device_id = ?'
      ).bind(new Date().toISOString(), row.updated_at, projectId, pullDevice).run();
    } catch (e) { /* stamping a pull is best-effort */ }
  }
  const state = await cloudReadState(env, row.latest_r2_key);
  const resp = { ok: true, state: state, savedAt: row.updated_at };
  if (editorAuth) { resp.role = 'editor'; resp.editorLabel = editorAuth.label; resp.scope = editorAuth.scope; }
  if (viewerAuth) { resp.role = 'view'; resp.viewerLabel = viewerAuth.label; resp.scope = viewerAuth.scope; }
  return json(resp);
}

export async function handleCloudRecover(request, env, projectId) {
  const session = await readSession(request, env);
  if (!session || !session.sub) { await cloudTimingSink(); return cloudForbidden(); }
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub, google_name FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row || !row.google_sub || row.google_sub !== session.sub) { await cloudTimingSink(); return cloudForbidden(); }
  const salt = randomSaltHex();
  const ownerCode = randomOwnerCode();
  const hash = await hashOwnerCode(ownerCode, salt);
  const ownerFp = await fingerprintOf(ownerCode);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE cloud_projects SET owner_code_salt = ?, owner_code_hash = ?, owner_code_fingerprint = ?, updated_at = ? WHERE project_id = ?')
    .bind(salt, hash, ownerFp, now, projectId).run();
  await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'recovery', 'owner', row.google_name || 'Owner', null, null, null, now).run();
  await cloudTouchOwner(env, projectId);
  return json({ ok: true, ownerCode: ownerCode, recoveredAt: now });
}

export async function handleCloudMeta(request, env, projectId) {
  const code = String(request.headers.get('X-Owner-Code') || '').trim();
  const ecode = String(request.headers.get('X-Editor-Code') || '').trim();
  const vcode = String(request.headers.get('X-View-Code') || '').trim();
  const session = await readSession(request, env);
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub, google_name, owner_label, latest_r2_key, updated_at, deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
  let authorized = false;
  let isEditor = false; let editorScope = null; let editorLabel = null;
  let viewer = false; let viewerScope = null;
  let ownerProbe = false;
  if (code) {
    const hash = await hashOwnerCode(code, row.owner_code_salt);
    authorized = codesEqual(hash, row.owner_code_hash);
    if (authorized) ownerProbe = true;
  } else if (ecode) {
    const ea = await cloudAuthEditor(request, env, projectId, ecode);
    if (ea) { authorized = true; isEditor = true; editorScope = ea.scope; editorLabel = ea.label; }
  } else if (vcode) {
    const va = await cloudAuthViewer(request, env, projectId, vcode);
    if (va) { authorized = true; isEditor = true; viewerScope = va.scope; editorLabel = va.label; viewer = true; }
  }
  if (!authorized && session && session.sub && row.google_sub && row.google_sub === session.sub) { authorized = true; ownerProbe = true; }
  if (!authorized && !ownerProbe) {
    const ad = await cloudAuthAdoption(request, env, projectId);
    if (ad && ad.revoked) return json({ ok: false, error: 'code_revoked' }, 403);
    if (ad && ad.deleted) return cloudProjectDeleted();
    if (ad) {
      authorized = true; isEditor = true;
      editorScope = ad.scope; editorLabel = ad.label;
      viewer = ad.role === 'view';
      if (viewer) viewerScope = ad.scope;
    }
  }
  if (!authorized) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  if (ownerProbe) await cloudTouchOwner(env, projectId);
  const resp = {
    ok: true, projectId: projectId, linked: !!row.google_sub,
    linkedName: row.google_name || null, label: row.owner_label || null,
    hasSnapshot: !!row.latest_r2_key, updatedAt: row.updated_at
  };
  if (isEditor && !viewer) { resp.role = 'editor'; resp.editorLabel = editorLabel; resp.scope = editorScope; }
  if (viewer) { resp.role = 'view'; resp.editorLabel = editorLabel; resp.scope = viewerScope; }
  return json(resp);
}

export async function handleCloudUnlink(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const now = new Date().toISOString();
  const res = await env.DB.prepare('DELETE FROM cloud_projects WHERE project_id = ?').bind(projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'project not found' }, 404);
  let cursor = undefined;
  do {
    const listed = await env.R2.list({ prefix: 'projects/' + projectId + '/', cursor: cursor });
    for (let i = 0; i < (listed.objects || []).length; i++) {
      try { await env.R2.delete(listed.objects[i].key); } catch (e) { /* best-effort */ }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await env.DB.prepare('DELETE FROM cloud_editor_codes WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_changelog WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_adoptions WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM offline_copies WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ?').bind(projectId).run();
  return json({ ok: true, unlinked: projectId, unlinkedAt: now });
}

export async function handleCloudCodeLookup(request, env) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const code = String(read.body.code || '').trim();
  if (!code) return json({ ok: false, error: 'code required' }, 400);
  const fp = await fingerprintOf(code);
  const row = await env.DB.prepare(
    'SELECT e.project_id, e.role, e.label, e.scope, e.active, p.deleted_at FROM cloud_editor_codes e JOIN cloud_projects p ON p.project_id = e.project_id WHERE e.code_fingerprint = ?'
  ).bind(fp).first();
  if (!row) {
    const ownerRow = await env.DB.prepare('SELECT project_id, google_name, deleted_at FROM cloud_projects WHERE owner_code_fingerprint = ?').bind(fp).first();
    if (!ownerRow) {
      await Promise.all([cloudDummyHash(), cloudTimingSink()]);
      return cloudForbidden();
    }
    return json({ ok: true, projectId: ownerRow.project_id, role: 'owner', label: ownerRow.google_name || 'Owner', deleted: !!ownerRow.deleted_at });
  }
  if (!row.active) return json({ ok: true, projectId: row.project_id, role: row.role, label: row.label || (row.role === 'view' ? 'Viewer' : 'Editor'), revoked: true, deleted: !!row.deleted_at });
  return json({ ok: true, projectId: row.project_id, role: row.role, label: row.label || (row.role === 'view' ? 'Viewer' : 'Editor'), deleted: !!row.deleted_at });
}

export async function handleCloudProjectDelete(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const now = new Date().toISOString();
  const res = await env.DB.prepare('UPDATE cloud_projects SET deleted_at = ? WHERE project_id = ? AND deleted_at IS NULL').bind(now, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'project not found or already deleted' }, 404);
  await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ? AND status = ?').bind(projectId, 'pending').run();
  return json({ ok: true, deleted: projectId, deletedAt: now });
}

export async function handleCloudProjectRestore(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const res = await env.DB.prepare('UPDATE cloud_projects SET deleted_at = NULL WHERE project_id = ? AND deleted_at IS NOT NULL').bind(projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'project not found or not deleted' }, 404);
  return json({ ok: true, restored: projectId });
}

export async function handleCloudProjectPurge(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const now = new Date().toISOString();
  const res = await env.DB.prepare('DELETE FROM cloud_projects WHERE project_id = ?').bind(projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'project not found' }, 404);
  let cursor = undefined;
  do {
    const listed = await env.R2.list({ prefix: 'projects/' + projectId + '/', cursor: cursor });
    for (let i = 0; i < (listed.objects || []).length; i++) {
      try { await env.R2.delete(listed.objects[i].key); } catch (e) { /* best-effort */ }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await env.DB.prepare('DELETE FROM cloud_editor_codes WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_changelog WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_adoptions WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM offline_copies WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ?').bind(projectId).run();
  return json({ ok: true, purged: projectId, purgedAt: now });
}

export async function cloudPushRevChangedIfCopies(env, projectId, now, actor) {
  try {
    const syncRow = await env.DB.prepare(
      'SELECT auto_broadcast, (SELECT COUNT(*) FROM offline_copies WHERE project_id = ?) AS copies FROM cloud_projects WHERE project_id = ?'
    ).bind(projectId, projectId).first();
    const nCopies = syncRow ? Number(syncRow.copies || 0) : 0;
    if (nCopies > 0) {
      // presencePushRevChanged is called via the DO — imported from worker.js at route time
      if (syncRow && syncRow.auto_broadcast) {
        await env.DB.prepare(
          'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(projectId, 'broadcast', actor.type, actor.label || (actor.type === 'owner' ? 'Owner' : 'Editor'), null, null, null, now).run();
      }
    }
  } catch (e) { /* sync push is additive — never fail a save */ }
}
