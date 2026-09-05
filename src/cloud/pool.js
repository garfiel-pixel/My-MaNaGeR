/* ============================================================
   CLOUD SHARED RESOURCE POOL (C23, Phase 6 2026-09-04)
   ------------------------------------------------------------
   An ACCOUNT-scoped library of reusable resources (people,
   equipment, material) that any of the account's cloud projects
   can link into its own Resources panel. Pool rows live in their
   OWN D1 tables (migration 0019) and never travel in the project
   state blob, so they never count against the 8MB /save body cap.

   AUTH is project-anchored: every route takes a project id and is
   gated by cloudAuthOwnerEither (signed-in session sub OR the
   project's owner code). SCOPE = the project row's google_sub when
   linked (account-wide pool), else a per-project namespace so a
   code-only project still gets a working pool (see accountOf).

   SYNC SEMANTICS (honest v1): projects keep a denormalized copy of
   each linked row stamped with poolItemId + poolUpdatedAt; the
   client PULL-MERGES via GET pool/items (which returns items +
   which are linked to THIS project) and PUSHES shared-field edits
   through item PUT. Links are the project <-> pool pin; deleting a
   pool item cascades its links (FOREIGN KEY in migration 0019) —
   the project keeps its detached local copy per the spec.
   ============================================================ */
import { json, readCloudBody, cloudForbidden,
  cloudAuthOwnerEither } from '../lib/http.js';

// Valid pool kinds. People = Labor + Subcontractor via type;
// stakeholders are deliberately NOT pool rows (DECIDED 09-03).
const POOL_KINDS = ['person', 'equipment', 'material'];
// Shared fields a pool row owns (what links may PULL-MERGE into a
// project and what an item PUT may change).
const SHARED_FIELDS = ['name', 'type', 'role', 'availability', 'rate', 'notes'];

function cleanShared(body, current) {
  const out = {};
  SHARED_FIELDS.forEach(function(f) {
    if (body[f] !== undefined && body[f] !== null) out[f] = body[f];
    else if (current && current[f] !== undefined && current[f] !== null) out[f] = current[f];
    else if (f === 'availability') out[f] = 100;
    else if (f === 'rate') out[f] = 0;
    else out[f] = '';
  });
  if (typeof out.name !== 'string' || !out.name.trim()) return null;
  out.name = out.name.trim().slice(0, 120);
  if (typeof out.role === 'string') out.role = out.role.trim().slice(0, 60);
  if (typeof out.notes === 'string') out.notes = out.notes.trim().slice(0, 500);
  out.availability = Math.max(0, Math.min(100, Number(out.availability) || 0));
  out.rate = Math.max(0, Number(out.rate) || 0);
  return out;
}

function rowToItem(r) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    type: r.type || '',
    role: r.role || '',
    availability: Number(r.availability) || 0,
    rate: Number(r.rate) || 0,
    hoursAllocated: Number(r.hoursAllocated) || 0,
    notes: r.notes || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// Resolve the ACCOUNT key that owns the pool for this project route.
// auth is the cloudAuthOwnerEither result; its row carries google_sub
// (code path) or the session sub matched it (session path).
//
// SCOPE RULE (honest v1): a linked project (google_sub present) uses the
// ACCOUNT key = google_sub — the pool is account-wide and any project the
// account owns reaches the same rows. A CODE-ONLY project (no linked sub)
// uses a PER-PROJECT namespace key = 'project:' + project_id, so its owner
// code still gets a working pool without inventing an account identity.
// The two namespaces never collide (no google_sub ever starts with
// 'project:'), and a later link of the project keeps the rows separate
// (the account pool starts empty — honest, no phantom data).
async function accountOf(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return null;
  const row = auth.row || {};
  const sub = row.google_sub || auth.sub;
  if (sub) return { auth: auth, key: sub, accountScoped: true };
  // code-only: per-project namespace keyed by the project id
  return { auth: auth, key: 'project:' + projectId, accountScoped: false };
}

function forbidden() { return cloudForbidden(); }

/* ---- Item CRUD -------------------------------------------------- */

// GET /api/cloud/projects/:id/pool/items
// Returns the whole account pool plus the link pins for THIS project,
// so one round trip powers both the admin manager and the in-project
// Library picker (items = all, linked = items pinned to this project).
export async function handlePoolItemsList(request, env, projectId) {
  const acct = await accountOf(request, env, projectId);
  if (!acct) return forbidden();
  const [itemsRes, linksRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM cloud_pool_items WHERE owner_sub = ? ORDER BY kind, name').bind(acct.key).all(),
    env.DB.prepare('SELECT pool_item_id, linked_at FROM cloud_pool_links WHERE project_id = ?').bind(projectId).all()
  ]);
  const items = ((itemsRes.results) || []).map(rowToItem);
  const linked = {};
  ((linksRes.results) || []).forEach(function(l) { linked[l.pool_item_id] = l.linked_at; });
  return json({ ok: true, items: items, linked: linked });
}

// POST /api/cloud/projects/:id/pool/items
// Body: { kind, name, type?, role?, availability?, rate?, notes? }
export async function handlePoolItemCreate(request, env, projectId) {
  const acct = await accountOf(request, env, projectId);
  if (!acct) return forbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const kind = POOL_KINDS.indexOf(read.body.kind) > -1 ? read.body.kind : (read.body.kind === 'subcontractor' ? 'person' : null);
  if (!kind) return json({ ok: false, error: 'kind must be person | equipment | material' }, 400);
  const clean = cleanShared(read.body, null);
  if (!clean) return json({ ok: false, error: 'a pool item needs a name' }, 400);
  // Person type defaults so Labor/Subcontractor survive the round trip.
  if (kind === 'person' && !clean.type) clean.type = 'Labor';
  const now = new Date().toISOString();
  const id = 'pool-' + now.replace(/\D/g, '').slice(0, 14) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  const res = await env.DB.prepare(
    'INSERT INTO cloud_pool_items (id, owner_sub, kind, name, type, role, availability, rate, hoursAllocated, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?)'
  ).bind(id, acct.key, kind, clean.name, clean.type, clean.role, clean.availability, clean.rate, clean.notes, now, now).run();
  const row = await env.DB.prepare('SELECT * FROM cloud_pool_items WHERE id = ?').bind(id).first();
  return json({ ok: true, item: rowToItem(row || { id: id, kind: kind, ...clean, created_at: now, updated_at: now, hoursAllocated: 0 }) }, 201);
}

// PUT /api/cloud/projects/:id/pool/items/:itemId
// Update the SHARED fields only (hoursAllocated stays project-local).
export async function handlePoolItemUpdate(request, env, projectId, itemId) {
  const acct = await accountOf(request, env, projectId);
  if (!acct) return forbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const existing = await env.DB.prepare('SELECT * FROM cloud_pool_items WHERE id = ? AND owner_sub = ?').bind(itemId, acct.key).first();
  if (!existing) return json({ ok: false, error: 'pool item not found' }, 404);
  const clean = cleanShared(read.body, existing);
  if (!clean) return json({ ok: false, error: 'a pool item needs a name' }, 400);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE cloud_pool_items SET name = ?, type = ?, role = ?, availability = ?, rate = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_sub = ?'
  ).bind(clean.name, clean.type, clean.role, clean.availability, clean.rate, clean.notes, now, itemId, acct.key).run();
  const row = await env.DB.prepare('SELECT * FROM cloud_pool_items WHERE id = ?').bind(itemId).first();
  return json({ ok: true, item: rowToItem(row) });
}

// DELETE /api/cloud/projects/:id/pool/items/:itemId
// Deletes the item; its links cascade via the FK. The client keeps a
// detached local copy in any project that had it linked.
export async function handlePoolItemDelete(request, env, projectId, itemId) {
  const acct = await accountOf(request, env, projectId);
  if (!acct) return forbidden();
  const res = await env.DB.prepare('DELETE FROM cloud_pool_items WHERE id = ? AND owner_sub = ?').bind(itemId, acct.key).run();
  if (!res.meta.changes) return json({ ok: false, error: 'pool item not found' }, 404);
  return json({ ok: true, deletedItemId: itemId });
}

/* ---- Project <-> pool links -------------------------------------- */

// POST /api/cloud/projects/:id/pool/links
// Body: { poolItemId } — pins an account pool row into this project.
// A project cannot link another account's pool row.
export async function handlePoolLinkCreate(request, env, projectId) {
  const acct = await accountOf(request, env, projectId);
  if (!acct) return forbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const poolItemId = typeof read.body.poolItemId === 'string' ? read.body.poolItemId.trim().slice(0, 64) : '';
  if (!poolItemId) return json({ ok: false, error: 'poolItemId is required' }, 400);
  const item = await env.DB.prepare('SELECT id FROM cloud_pool_items WHERE id = ? AND owner_sub = ?').bind(poolItemId, acct.key).first();
  if (!item) return json({ ok: false, error: 'pool item not found' }, 404);
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO cloud_pool_links (project_id, pool_item_id, linked_at) VALUES (?,?,?)'
  ).bind(projectId, poolItemId, now).run();
  return json({ ok: true, linked: res.meta.changes > 0, linkedAt: now, poolItemId: poolItemId });
}

// DELETE /api/cloud/projects/:id/pool/links/:itemId
export async function handlePoolLinkDelete(request, env, projectId, itemId) {
  const acct = await accountOf(request, env, projectId);
  if (!acct) return forbidden();
  const res = await env.DB.prepare('DELETE FROM cloud_pool_links WHERE project_id = ? AND pool_item_id = ?').bind(projectId, itemId).run();
  return json({ ok: true, unlinked: res.meta.changes > 0, poolItemId: itemId });
}
