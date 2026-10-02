/* ============================================================
   REVIEWS , public reviews window + cloud review queue
   ------------------------------------------------------------
   Extracted from worker.js. Public reviews (anyone can post,
   anyone can read) plus the cloud review queue (editor proposals
   accepted/rejected by the owner).
   ============================================================ */
import { json, cloudForbidden, cloudProjectDeleted, cloudTimingSink,
  cloudReadState, cloudScopeMerge, cloudLogSave, cloudEncryptState,
  cloudAuthOwnerEither, cloudAuthEditor, cloudAuthAdoption } from './lib/http.js';
import { structuredLog } from './lib/observe.js';

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
  if (/[<>]/.test(s)) return 'plain text only , no HTML or markup in reviews';
  if (/https?:\/\/|www\./i.test(s)) return 'plain text only , no links in reviews';
  return null;
}

// ============================================================
// CLOUDFLARE TURNSTILE (owner 2026-10-02)
// ------------------------------------------------------------
// The reviews form is the only public WRITE surface on the site,
// so it is the one place a bot can post. Turnstile gates it.
//
// The SECRET is a Wrangler secret (env.TURNSTILE_SECRET) - never
// in source, never in a var, never logged. The sitekey is public
// and is handed to the browser by handleTurnstileConfig below, so
// the two halves can never drift apart in the markup.
//
// Fail CLOSED: once a secret is configured, a post without a valid
// token is refused before anything is written. If NO secret is
// configured the challenge is off entirely (local dev, CI, and the
// window before the owner creates the widget), and the endpoint
// reports required:false so the client renders nothing.
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// The siteverify endpoint is overridable ONLY through the Worker environment
// (never through any request input), so tools/qa-reviews.cjs can point it at a
// local stub and assert the real accept/refuse branches offline. Unset in
// production -> the Cloudflare endpoint above.
function turnstileVerifyUrl(env) {
  const u = env && typeof env.TURNSTILE_VERIFY_URL === 'string' ? env.TURNSTILE_VERIFY_URL.trim() : '';
  return u || TURNSTILE_VERIFY_URL;
}

export function turnstileEnabled(env) {
  return !!(env && typeof env.TURNSTILE_SECRET === 'string' && env.TURNSTILE_SECRET.trim());
}

// GET /api/turnstile-config - the public sitekey + whether a challenge is
// required. Public by design (the sitekey is public); reveals nothing secret.
export function handleTurnstileConfig(env) {
  const required = turnstileEnabled(env);
  const sitekey = (env && typeof env.TURNSTILE_SITEKEY === 'string') ? env.TURNSTILE_SITEKEY.trim() : '';
  // Required but no sitekey to render is a misconfiguration. Report it
  // honestly rather than stranding the visitor with an unfillable form.
  if (required && !sitekey) {
    return json({ ok: false, error: 'turnstile not fully configured' }, 503);
  }
  return json({ ok: true, sitekey: sitekey, required: required });
}

// Cloudflare sets CF-Connecting-IP on every request. Read it defensively:
// it is only ever handed to Turnstile as an optional hint, never trusted
// for authorization, so a missing/garbage value just means no remoteip.
function clientIp(request) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (typeof ip !== 'string') return '';
  return /^[\d.]{3,45}$|^[0-9a-fA-F:]{3,45}$/.test(ip) ? ip : '';
}

// Verify one token with Cloudflare. Returns { ok:false, error } on any
// failure so the caller can refuse without leaking which part failed.
async function verifyTurnstileToken(token, remoteIp, env) {
  if (!turnstileEnabled(env)) return { ok: true, skipped: true };
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, error: 'please finish the check above before sending your review' };
  }
  // Bound the token length - siteverify tokens are ~1-2 KB, so this rejects
  // an obvious attempt to push a huge body through the verify call.
  const tok = token.trim();
  if (tok.length > 4096) return { ok: false, error: 'that check could not be read, please try again' };
  let res;
  try {
    res = await fetch(turnstileVerifyUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: tok,
        ...(remoteIp ? { remoteip: remoteIp } : {})
      })
    });
  } catch (e) {
    // Network trouble reaching CF must NOT become a bypass: refuse.
    return { ok: false, error: 'we could not check that you are human, please try again' };
  }
  if (!res || !res.ok) return { ok: false, error: 'we could not check that you are human, please try again' };
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!data || data.success !== true) return { ok: false, error: 'that check did not pass, please try again' };
  return { ok: true };
}

export async function handleReviewsCreate(request, env) {
  const read = await readReviewBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'review too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  // TURNSTILE FIRST: the bot gate runs before any validation, storage, or
  // D1/R2 write, so a bot never reaches the insert path at all. The client's
  // IP goes to CF as remoteip so the check is bound to the caller.
  const turnstile = await verifyTurnstileToken(read.body.turnstileToken, clientIp(request), env);
  if (!turnstile.ok) {
    structuredLog(env, 'warn', 'review-turnstile-refused');
    return json({ ok: false, error: turnstile.error }, 403);
  }
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
  // OWNER FIX 2026-09-24: the old gate read the X-Owner-Code header FIRST and
  // only consulted the session when a code string was present, so a signed-in
  // owner with no code on the device (session-owner mode, P1-6) got a 403 and
  // never saw proposals queued for their own project. Owner identity is
  // either-auth by design (cloudAuthOwnerEither: code header OR session) -
  // ask it unconditionally; it timing-sinks on total failure.
  const owner = await cloudAuthOwnerEither(request, env, projectId);
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

// cloudPushRevChangedIfCopies is still in worker.js , accept calls it
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
    // API-KEY-AUDIT F3 accept-side (2026-09-16): the old branch only wrote a
    // changelog line - accepting an MCP proposal changed NOTHING. Mirror the
    // 'save' branch: merge the stored submission under the proposal's scope,
    // write the new state to R2, flip latest_r2_key, log the changelog.
    const key = 'projects/' + projectId + '/latest.json';
    const projRowM = await env.DB.prepare('SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
    const prev = await cloudReadState(env, key, projRowM && projRowM.owner_code_hash, projRowM && projRowM.owner_code_salt);
    let scope = [];
    try { const p = JSON.parse(row.scope); if (Array.isArray(p)) scope = p; } catch (e) { scope = []; }
    let submitted = {};
    try { submitted = JSON.parse(row.submitted_json); } catch (e) { submitted = {}; }
    const merged = cloudScopeMerge(prev, submitted, scope);
    resp.applied = merged.applied;
    resp.blocked = merged.blocked;
    if (merged.applied.length > 0) {
      merged.next.updatedAt = now;
      let r2Payload = JSON.stringify(merged.next);
      if (projRowM && projRowM.owner_code_hash && projRowM.owner_code_salt) {
        try { r2Payload = await cloudEncryptState(merged.next, projRowM.owner_code_hash, projRowM.owner_code_salt); } catch (e) { /* fall back to plaintext */ }
      }
      await env.R2.put(key, r2Payload, { httpMetadata: { contentType: 'application/json' } });
      await env.DB.prepare('UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?').bind(key, now, projectId).run();
      const entry = await cloudLogSave(env, projectId, prev, merged.next, { type: 'owner', label: auth.label || 'Owner' }, 'accepted');
      if (entry) resp.changelog = entry;
      if (pushRevChanged) await pushRevChanged(env, projectId, now, { type: 'owner', label: auth.label || 'Owner' });
      resp.savedAt = now;
    }
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
