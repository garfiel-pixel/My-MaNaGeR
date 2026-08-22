/* ============================================================
   REVIEWS — public reviews window + cloud review queue
   ------------------------------------------------------------
   Extracted from worker.js. Public reviews (anyone can post,
   anyone can read) plus the cloud review queue (editor proposals
   accepted/rejected by the owner).
   ============================================================ */
import { json, cloudForbidden, cloudProjectDeleted, cloudTimingSink,
  cloudReadState, cloudScopeMerge, cloudLogSave, cloudEncryptState,
  cloudAuthOwnerEither, cloudAuthEditor, cloudAuthAdoption } from './lib/http.js';

const REVIEW_TEXT_MAX = 2000;
const REVIEW_NAME_MAX = 60;
const REVIEW_BODY_LIMIT_BYTES = 8192;

async function readReviewBody(request) {
  const cl = Number(request.headers.get('Content-Length') || 0);
  if (cl > REVIEW_BODY_LIMIT_BYTES) return { tooLarge: true };
  if (!request.body) {
    try { return { body: await request.json() }; } catch (e) { return { bad: true }; }
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  let done = false;
  while (!done) {
    const res = await reader.read();
    done = res.done;
    if (res.value) {
      total += res.value.byteLength;
      if (total > REVIEW_BODY_LIMIT_BYTES) return { tooLarge: true };
      chunks.push(res.value);
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return { body: JSON.parse(text) }; } catch (e) { return { bad: true }; }
}

function reviewPlainTextProblem(s) {
  if (/[<>]/.test(s)) return 'plain text only — no HTML or markup in reviews';
  if (/https?:\/\/|www\./i.test(s)) return 'plain text only — no links in reviews';
  return null;
}

export async function handleReviewsCreate(request, env) {
  const read = await readReviewBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'review too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const rawName = typeof read.body.name === 'string' ? read.body.name.trim().slice(0, REVIEW_NAME_MAX) : '';
  const rawText = typeof read.body.review === 'string' ? read.body.review.trim() : '';
  if (!rawText) return json({ ok: false, error: 'review text is required' }, 400);
  if (rawText.length > REVIEW_TEXT_MAX) return json({ ok: false, error: 'review too long (max ' + REVIEW_TEXT_MAX + ' characters)' }, 400);
  const prob = reviewPlainTextProblem(rawText) || reviewPlainTextProblem(rawName);
  if (prob) return json({ ok: false, error: prob }, 400);
  let stars = null;
  if (read.body.stars !== undefined && read.body.stars !== null && read.body.stars !== 0) {
    const n = Number(read.body.stars);
    if (Number.isInteger(n) && n >= 1 && n <= 5) stars = n;
    else return json({ ok: false, error: 'stars must be a whole number from 1 to 5' }, 400);
  }
  const name = rawName ? rawName : null;
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO reviews (name, review_text, stars, votes, created_at) VALUES (?,?,?,0,?)'
  ).bind(name, rawText, stars, now).run();
  const id = Number(res.meta.last_row_id);
  const review = { id: id, name: name, review: rawText, stars: stars, votes: 0, createdAt: now };
  try {
    await env.R2.put('reviews/' + id + '.json', JSON.stringify(review), { httpMetadata: { contentType: 'application/json' } });
  } catch (e) { /* best-effort */ }
  return json({ ok: true, review: review });
}

export async function handleReviewsList(env) {
  const rows = await env.DB.prepare(
    'SELECT id, name, review_text, stars, votes, created_at FROM reviews ORDER BY created_at DESC, id DESC LIMIT 200'
  ).all();
  const reviews = (rows.results || []).map(function(r) {
    return { id: r.id, name: r.name, review: r.review_text, stars: r.stars, votes: r.votes, createdAt: r.created_at };
  });
  return json({ ok: true, reviews: reviews });
}

export async function handleReviewList(request, env, projectId, mine) {
  const code = String(request.headers.get('X-Owner-Code') || '').trim();
  const owner = code ? await cloudAuthOwnerEither(request, env, projectId) : null;
  let editorId = null; let editorLabel = null;
  if (!owner) {
    const ecode = String(request.headers.get('X-Editor-Code') || '').trim();
    if (ecode) {
      const a = await cloudAuthEditor(request, env, projectId, ecode);
      if (a) { editorId = a.editorId; editorLabel = a.label; }
    } else {
      const ad = await cloudAuthAdoption(request, env, projectId);
      if (ad && ad.role === 'editor') { editorId = ad.editorId; editorLabel = ad.label; }
    }
    if (!editorId) { await cloudTimingSink(); return cloudForbidden(); }
  }
  const row = await env.DB.prepare('SELECT deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  if (owner && !mine) {
    const rows = await env.DB.prepare(
      'SELECT id, proposal_type, source_type, source_label, status, diffs_json, proposed_at, decided_at, decided_by, accepted_entry_id FROM cloud_reviews WHERE project_id = ? ORDER BY CASE WHEN status = ? THEN 0 ELSE 1 END, id DESC LIMIT 100'
    ).bind(projectId, 'pending').all();
    const proposals = (rows.results || []).map(function(r) {
      let diffs = null;
      try { if (r.diffs_json) diffs = JSON.parse(r.diffs_json); } catch (e) { diffs = null; }
      return { id: r.id, proposalType: r.proposal_type, sourceType: r.source_type, sourceLabel: r.source_label, status: r.status, diffs: diffs, proposedAt: r.proposed_at, decidedAt: r.decided_at, decidedBy: r.decided_by, acceptedEntryId: r.accepted_entry_id };
    });
    return json({ ok: true, proposals: proposals });
  }
  const mineRows = await env.DB.prepare(
    'SELECT id, proposal_type, source_type, source_label, status, diffs_json, proposed_at, decided_at FROM cloud_reviews WHERE project_id = ? AND editor_code_id = ? ORDER BY id DESC LIMIT 20'
  ).bind(projectId, editorId).all();
  const mineList = (mineRows.results || []).map(function(r) {
    let diffs = null;
    try { if (r.diffs_json) diffs = JSON.parse(r.diffs_json); } catch (e) { diffs = null; }
    return { id: r.id, proposalType: r.proposal_type, sourceType: r.source_type, sourceLabel: r.source_label || editorLabel, status: r.status, diffs: diffs, proposedAt: r.proposed_at, decidedAt: r.decided_at };
  });
  return json({ ok: true, proposals: mineList });
}

// cloudPushRevChangedIfCopies is still in worker.js — accept calls it
// via a parameter to avoid circular dependency
export async function handleReviewAccept(request, env, projectId, reviewId, pushRevChanged) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT * FROM cloud_reviews WHERE id = ? AND project_id = ?').bind(reviewId, projectId).first();
  if (!row) return json({ ok: false, error: 'proposal not found' }, 404);
  if (row.status !== 'pending') return json({ ok: false, error: 'proposal is not pending' }, 409);
  const now = new Date().toISOString();
  const resp = { ok: true, reviewId: reviewId, status: 'accepted', decidedAt: now };
  if (row.proposal_type === 'save') {
    const key = 'projects/' + projectId + '/latest.json';
    const projRow = await env.DB.prepare('SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
    const prev = await cloudReadState(env, key, projRow && projRow.owner_code_hash, projRow && projRow.owner_code_salt);
    let scope = [];
    try { const p = JSON.parse(row.scope); if (Array.isArray(p)) scope = p; } catch (e) { scope = []; }
    let submitted = {};
    try { submitted = JSON.parse(row.submitted_json); } catch (e) { submitted = {}; }
    const merged = cloudScopeMerge(prev, submitted, scope);
    resp.applied = merged.applied;
    resp.blocked = merged.blocked;
    if (merged.applied.length > 0) {
      merged.next.updatedAt = now;
      // Encrypt state blob on accept (same envelope as handleCloudSave)
      const projRow = await env.DB.prepare('SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
      let r2Payload = JSON.stringify(merged.next);
      if (projRow && projRow.owner_code_hash && projRow.owner_code_salt) {
        try { r2Payload = await cloudEncryptState(merged.next, projRow.owner_code_hash, projRow.owner_code_salt); } catch (e) { /* fall back to plaintext */ }
      }
      await env.R2.put(key, r2Payload, { httpMetadata: { contentType: 'application/json' } });
      await env.DB.prepare('UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?').bind(key, now, projectId).run();
      const entry = await cloudLogSave(env, projectId, prev, merged.next, { type: 'owner', label: auth.label || 'Owner' }, 'accepted');
      if (entry) resp.changelog = entry;
      if (pushRevChanged) await pushRevChanged(env, projectId, now, { type: 'owner', label: auth.label || 'Owner' });
      resp.savedAt = now;
    }
  } else if (row.proposal_type === 'mcp') {
    const ins = await env.DB.prepare(
      "INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at, import_key) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(import_key) DO NOTHING"
    ).bind(projectId, 'accepted', row.actor_type || 'mcp', row.source_label || 'MCP AI', row.section || null, row.diffs_json || null, null, now, row.import_key).run();
    resp.entryId = ins.meta.last_row_id;
  } else {
    return json({ ok: false, error: 'unsupported proposal type' }, 400);
  }
  const acceptedEntryId = resp.entryId || (resp.changelog && resp.changelog.id) || null;
  await env.DB.prepare('UPDATE cloud_reviews SET status = ?, decided_at = ?, decided_by = ?, accepted_entry_id = ? WHERE id = ?')
    .bind('accepted', now, auth.label || 'Owner', acceptedEntryId, reviewId).run();
  resp.acceptedEntryId = acceptedEntryId;
  return json(resp);
}

export async function handleReviewReject(request, env, projectId, reviewId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT * FROM cloud_reviews WHERE id = ? AND project_id = ?').bind(reviewId, projectId).first();
  if (!row) return json({ ok: false, error: 'proposal not found' }, 404);
  if (row.status !== 'pending') return json({ ok: false, error: 'proposal is not pending' }, 409);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'rejected', 'owner', auth.label || 'Owner', row.section || null, row.diffs_json || null, null, now).run();
  await env.DB.prepare('UPDATE cloud_reviews SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .bind('rejected', now, auth.label || 'Owner', reviewId).run();
  return json({ ok: true, reviewId: reviewId, status: 'rejected', decidedAt: now });
}
