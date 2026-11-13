/* ============================================================
   REVIEWS , public reviews window + cloud review queue
   ------------------------------------------------------------
   Extracted from worker.js. Public reviews (anyone can post,
   anyone can read) plus the cloud review queue (editor proposals
   accepted/rejected by the owner).
   ============================================================ */
import {
  json,
  cloudForbidden,
  cloudProjectDeleted,
  cloudTimingSink,
  cloudReadStateEtag,
  cloudHealStaleClaims,
  cloudPutState,
  cloudScopeMerge,
  cloudLogSave,
  cloudEncryptState,
  cloudAuthOwnerEither,
  cloudAuthBudgetApprover,
  cloudAuthEditor,
  cloudAuthAdoption,
  readJsonBody,
  readCloudBody
} from './lib/http.js';
import { structuredLog } from './lib/observe.js';
import { clientIp, verifyTurnstileToken } from './lib/turnstile.js';
import { buildBudgetProposal } from './lib/budget.js';
import { applyLeafDiffs, normalizeProposalDiffs } from './cloud/proposal-diffs.js';
import { applyOps } from './cloud/apply-ops.js';
import { dependsOnIds } from './mcp/deps.js';
import { storeApplyReport } from './mcp/report-store.js';
import { fieldSpec, getList, getSection, isDeletable } from './mcp/model.js';

// MCP-AGENT-FIRST 2026-11-12 3.1: ops_json stores v2 ops ({v:2, ops:[...]}).
// A bare array (no `v`) is a legacy v1 leaf list. This returns the v2 ops
// array, or null when the row is not v2.
function parseV2Ops(opsJson) {
  if (!opsJson) {
    return null;
  }
  try {
    const o = JSON.parse(opsJson);
    if (o && o.v === 2 && Array.isArray(o.ops)) {
      return o.ops;
    }
  } catch (e) {
    /* not JSON */
  }
  return null;
}

// The public config endpoint now lives in the shared Turnstile module; this
// re-export keeps the router's existing import path valid.
export { handleTurnstileConfig } from './lib/turnstile.js';

const REVIEW_TEXT_MAX = 2000;
const REVIEW_NAME_MAX = 60;
const REVIEW_BODY_LIMIT_BYTES = 8192;

// The capped reader itself lives in lib/http.js (T-5): one implementation of
// the Content-Length check + stream-with-byte-budget pattern, shared by every
// endpoint instead of one copy per module.

function reviewPlainTextProblem(s) {
  if (/[<>]/.test(s)) {
    return 'plain text only , no HTML or markup in reviews';
  }
  if (/https?:\/\/|www\./i.test(s)) {
    return 'plain text only , no links in reviews';
  }
  return null;
}

// TURNSTILE (owner 2026-10-02): the gate itself lives in src/lib/turnstile.js
// now that the contact form and registration share it. The reviews call below
// passes its own wording for the missing-token case.

export async function handleReviewsCreate(request, env) {
  const read = await readJsonBody(request, REVIEW_BODY_LIMIT_BYTES);
  if (read.tooLarge) {
    return json({ ok: false, error: 'review too large' }, 413);
  }
  if (read.bad || !read.body || typeof read.body !== 'object') {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  // TURNSTILE FIRST: the bot gate runs before any validation, storage, or
  // D1/R2 write, so a bot never reaches the insert path at all. The client's
  // IP goes to CF as remoteip so the check is bound to the caller.
  const turnstile = await verifyTurnstileToken(
    read.body.turnstileToken,
    clientIp(request),
    env,
    'please finish the check above before sending your review'
  );
  if (!turnstile.ok) {
    structuredLog(env, 'warn', 'review-turnstile-refused');
    return json({ ok: false, error: turnstile.error }, 403);
  }
  const rawName =
    typeof read.body.name === 'string' ? read.body.name.trim().slice(0, REVIEW_NAME_MAX) : '';
  const rawText = typeof read.body.review === 'string' ? read.body.review.trim() : '';
  if (!rawText) {
    return json({ ok: false, error: 'review text is required' }, 400);
  }
  if (rawText.length > REVIEW_TEXT_MAX) {
    return json(
      { ok: false, error: 'review too long (max ' + REVIEW_TEXT_MAX + ' characters)' },
      400
    );
  }
  const prob = reviewPlainTextProblem(rawText) || reviewPlainTextProblem(rawName);
  if (prob) {
    return json({ ok: false, error: prob }, 400);
  }
  let stars = null;
  if (read.body.stars !== undefined && read.body.stars !== null && read.body.stars !== 0) {
    const n = Number(read.body.stars);
    if (Number.isInteger(n) && n >= 1 && n <= 5) {
      stars = n;
    } else {
      return json({ ok: false, error: 'stars must be a whole number from 1 to 5' }, 400);
    }
  }
  const name = rawName ? rawName : null;
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO reviews (name, review_text, stars, votes, created_at) VALUES (?,?,?,0,?)'
  )
    .bind(name, rawText, stars, now)
    .run();
  const id = Number(res.meta.last_row_id);
  const review = { id: id, name: name, review: rawText, stars: stars, votes: 0, createdAt: now };
  try {
    await env.R2.put('reviews/' + id + '.json', JSON.stringify(review), {
      httpMetadata: { contentType: 'application/json' }
    });
  } catch (e) {
    /* best-effort */
  }
  return json({ ok: true, review: review });
}

export async function handleReviewsList(env) {
  const rows = await env.DB.prepare(
    'SELECT id, name, review_text, stars, votes, created_at FROM reviews ORDER BY created_at DESC, id DESC LIMIT 200'
  ).all();
  const reviews = (rows.results || []).map(function (r) {
    return {
      id: r.id,
      name: r.name,
      review: r.review_text,
      stars: r.stars,
      votes: r.votes,
      createdAt: r.created_at
    };
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
  let editorId = null;
  let editorLabel = null;
  if (!owner) {
    const ecode = String(request.headers.get('X-Editor-Code') || '').trim();
    if (ecode) {
      const a = await cloudAuthEditor(request, env, projectId, ecode);
      if (a) {
        editorId = a.editorId;
        editorLabel = a.label;
      }
    } else {
      const ad = await cloudAuthAdoption(request, env, projectId);
      if (ad && ad.role === 'editor') {
        editorId = ad.editorId;
        editorLabel = ad.label;
      }
    }
    if (!editorId) {
      await cloudTimingSink();
      return cloudForbidden();
    }
  }
  const row = await env.DB.prepare('SELECT deleted_at FROM cloud_projects WHERE project_id = ?')
    .bind(projectId)
    .first();
  if (!row) {
    return cloudForbidden();
  }
  if (row.deleted_at) {
    return cloudProjectDeleted();
  }
  if (owner && !mine) {
    // MCP-AGENT-FIRST 2026-11-12 1.6(a): a row claimed by an in-flight accept
    // is still undecided, so it sorts with pending and reports as pending.
    await cloudHealStaleClaims(env, projectId);
    const rows = await env.DB.prepare(
      "SELECT id, proposal_type, source_type, source_label, status, diffs_json, proposal_json, proposed_at, decided_at, decided_by, accepted_entry_id, decision_note, decision_edited, change_set_id, key_id FROM cloud_reviews WHERE project_id = ? ORDER BY CASE WHEN status IN ('pending','accepting') THEN 0 ELSE 1 END, id DESC LIMIT 100"
    )
      .bind(projectId)
      .all();
    const proposals = (rows.results || []).map(function (r) {
      let diffs = null;
      try {
        if (r.diffs_json) {
          diffs = JSON.parse(r.diffs_json);
        }
      } catch (e) {
        diffs = null;
      }
      // Every row leaves this route in one shape, including rows written
      // before producers stamped record names and affected surfaces.
      const normalized = normalizeProposalDiffs(diffs);
      let proposal = null;
      try {
        proposal = r.proposal_json ? JSON.parse(r.proposal_json) : null;
      } catch (e) {
        proposal = null;
      }
      return {
        id: r.id,
        proposalType: r.proposal_type,
        sourceType: r.source_type,
        sourceLabel: r.source_label,
        status: r.status === 'accepting' ? 'pending' : r.status,
        diffs: normalized.diffs,
        diffTotal: normalized.total,
        diffTruncated: normalized.truncated,
        proposal: proposal,
        proposedAt: r.proposed_at,
        decidedAt: r.decided_at,
        decidedBy: r.decided_by,
        decisionNote: r.decision_note || '',
        decisionEdited: r.decision_edited === 1,
        acceptedEntryId: r.accepted_entry_id,
        changeSetId: r.change_set_id || '',
        keyId: r.key_id || ''
      };
    });
    return json({ ok: true, proposals: proposals });
  }
  const mineRows = await env.DB.prepare(
    'SELECT id, proposal_type, source_type, source_label, status, diffs_json, proposed_at, decided_at FROM cloud_reviews WHERE project_id = ? AND editor_code_id = ? ORDER BY id DESC LIMIT 20'
  )
    .bind(projectId, editorId)
    .all();
  const mineList = (mineRows.results || []).map(function (r) {
    let diffs = null;
    try {
      if (r.diffs_json) {
        diffs = JSON.parse(r.diffs_json);
      }
    } catch (e) {
      diffs = null;
    }
    const normalized = normalizeProposalDiffs(diffs);
    return {
      id: r.id,
      proposalType: r.proposal_type,
      sourceType: r.source_type,
      sourceLabel: r.source_label || editorLabel,
      status: r.status,
      diffs: normalized.diffs,
      diffTotal: normalized.total,
      diffTruncated: normalized.truncated,
      proposedAt: r.proposed_at,
      decidedAt: r.decided_at
    };
  });
  return json({ ok: true, proposals: mineList });
}

// cloudPushRevChangedIfCopies is still in worker.js , accept calls it
// via a parameter to avoid circular dependency
// H-5 (BUDGET-BOQ directive 2026-11-05): the owner's decision note and the
// "edited before approving" flag. Both are OPTIONAL and best-effort: an accept
// with no body (every existing caller) still works, and a malformed body must
// never block a decision the owner already made.
async function readDecisionBody(request) {
  try {
    const r = await readCloudBody(request);
    if (!r || r.bad || r.tooLarge || !r.body || typeof r.body !== 'object') {
      return { note: '', edited: 0, changes: null, diffs: null };
    }
    return {
      note: r.body.note == null ? '' : String(r.body.note).trim().slice(0, 500),
      edited: r.body.edited === true || r.body.edited === 1 ? 1 : 0,
      changes: Array.isArray(r.body.changes) ? r.body.changes : null,
      diffs: Array.isArray(r.body.diffs) ? r.body.diffs : null
    };
  } catch (e) {
    return { note: '', edited: 0, changes: null, diffs: null };
  }
}

// H-6: apply only the field diffs the owner ticked, to the CURRENT state.
// A diff whose "before" no longer matches the live record is stale - the
// caller refuses the whole accept and names both values. The applier itself
// lives in proposal-diffs.js so producers, the read route and this route all
// agree on what a diff means.
function storedDiffs(row) {
  // MCP-AGENT-FIRST 2026-11-12 1.3: ops_json is the uncapped list; diffs_json
  // is the display copy capped at 500. Prefer the full list when present.
  try {
    const list = row.ops_json ? JSON.parse(row.ops_json) : null;
    if (Array.isArray(list)) {
      return list;
    }
  } catch (e) {
    /* fall through to the capped copy */
  }
  try {
    const list = row.diffs_json ? JSON.parse(row.diffs_json) : null;
    return Array.isArray(list) ? list : null;
  } catch (e) {
    return null;
  }
}

// MCP-AGENT-FIRST 2026-11-12 1.6(a): the claim and its 60-second heal live in
// lib/http.js so the MCP status tool heals the same way.
async function releaseClaim(env, reviewId) {
  try {
    await env.DB.prepare(
      "UPDATE cloud_reviews SET status = 'pending' WHERE id = ? AND status = 'accepting'"
    )
      .bind(reviewId)
      .run();
  } catch (e) {
    /* the 60-second heal is the backstop */
  }
}

function refusalFor(applied) {
  const problems = applied.stale.concat(applied.unaddressable);
  return json(
    {
      ok: false,
      error: 'stale',
      message:
        'This proposal no longer matches the project. Refresh the project and review it again.',
      stale: applied.stale,
      unaddressable: applied.unaddressable,
      problems: problems.length
    },
    409
  );
}

export async function handleReviewAccept(request, env, projectId, reviewId, pushRevChanged) {
  const decision = await readDecisionBody(request);
  // MCP-AGENT-FIRST 2026-11-12 1.6(a): an abandoned claim reverts to pending
  // the next time the queue is touched.
  await cloudHealStaleClaims(env, projectId);
  const row = await env.DB.prepare('SELECT * FROM cloud_reviews WHERE id = ? AND project_id = ?')
    .bind(reviewId, projectId)
    .first();
  if (!row) {
    return json({ ok: false, error: 'proposal not found' }, 404);
  }
  if (row.status !== 'pending') {
    return json({ ok: false, error: 'proposal is not pending' }, 409);
  }
  // H-7: a budget-only proposal may be decided by the owner OR the one named
  // budget approver. A mixed proposal (budget plus tasks, risks, documents)
  // stays owner-only: the approver's authority is the money, not the rest.
  let scopeForAuth = [];
  try {
    const p = JSON.parse(row.scope);
    if (Array.isArray(p)) {
      scopeForAuth = p;
    }
  } catch (e) {
    scopeForAuth = [];
  }
  // The proposal's granted sections - the scope the agent was allowed to
  // write. Both the v2 engine and the legacy path apply under this scope.
  const scope = scopeForAuth.slice();
  const budgetOnly =
    scopeForAuth.length > 0 &&
    scopeForAuth.every(function (s) {
      return s === 'bud';
    });
  let auth = await cloudAuthOwnerEither(request, env, projectId);
  let actorLabel = 'Owner';
  let actorType = 'owner';
  if (!auth && budgetOnly) {
    const approver = await cloudAuthBudgetApprover(request, env, projectId);
    if (approver) {
      auth = approver;
      actorLabel = approver.label;
      actorType = approver.actorType;
    }
  } else if (auth) {
    actorLabel = auth.label || 'Owner';
  }
  if (!auth) {
    return cloudForbidden();
  }
  const now = new Date().toISOString();
  const resp = { ok: true, reviewId: reviewId, status: 'accepted', decidedAt: now };
  // MCP-AGENT-FIRST 2026-11-12 1.6(a): claim the decision before touching any
  // state. Two concurrent accepts now race on one conditional UPDATE, and only
  // one of them wins.
  const claim = await env.DB.prepare(
    "UPDATE cloud_reviews SET status = 'accepting', decided_at = ? WHERE id = ? AND project_id = ? AND status = 'pending'"
  )
    .bind(now, reviewId, projectId)
    .run();
  if (!claim.meta || !claim.meta.changes) {
    return json(
      {
        ok: false,
        error: 'already being decided',
        message: 'This proposal is already being decided. Refresh the list and try again.'
      },
      409
    );
  }
  if (row.proposal_type === 'save') {
    const key = 'projects/' + projectId + '/latest.json';
    const projRow = await env.DB.prepare(
      'SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
    )
      .bind(projectId)
      .first();
    let scope = [];
    try {
      const p = JSON.parse(row.scope);
      if (Array.isArray(p)) {
        scope = p;
      }
    } catch (e) {
      scope = [];
    }
    const baseSubmitted = (function () {
      try {
        return JSON.parse(row.submitted_json);
      } catch (e) {
        return {};
      }
    })();
    // MCP-AGENT-FIRST 2026-11-12 1.6(b): read the state WITH its etag, apply
    // the decision to that exact version, and write only if it still matches.
    // A conflict re-reads and re-applies, up to 3 attempts.
    let prevUsed = null;
    let nextUsed = null;
    let wrote = false;
    for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
      const read = await cloudReadStateEtag(
        env,
        key,
        projRow && projRow.owner_code_hash,
        projRow && projRow.owner_code_salt
      );
      const prev = read.state;
      let submitted = baseSubmitted;
      // Partial approval: the owner ticked a subset of the listed fields. Apply
      // those leaves to the CURRENT state instead of replacing whole sections,
      // so an unrelated field that moved since the save is not rolled back.
      if (Array.isArray(decision.diffs) && decision.diffs.length) {
        const applied = applyLeafDiffs(prev, decision.diffs, submitted);
        if (applied.stale.length || applied.unaddressable.length) {
          await releaseClaim(env, reviewId);
          return refusalFor(applied);
        }
        submitted = applied.submitted;
        decision.edited = 1;
        if (!applied.changed) {
          resp.noop = true;
        }
      }
      const merged = cloudScopeMerge(prev, submitted, scope);
      resp.applied = merged.applied;
      resp.blocked = merged.blocked;
      if (!merged.applied.length) {
        wrote = true;
        break;
      }
      merged.next.updatedAt = now;
      // Encrypt state blob on accept (same envelope as handleCloudSave)
      let r2Payload = JSON.stringify(merged.next);
      if (projRow && projRow.owner_code_hash && projRow.owner_code_salt) {
        try {
          r2Payload = await cloudEncryptState(
            merged.next,
            projRow.owner_code_hash,
            projRow.owner_code_salt
          );
        } catch (e) {
          /* fall back to plaintext */
        }
      }
      const put = await cloudPutState(env, key, r2Payload, read.etag);
      if (put.ok) {
        wrote = true;
        prevUsed = prev;
        nextUsed = merged.next;
      }
    }
    if (!wrote) {
      await releaseClaim(env, reviewId);
      return json(
        {
          ok: false,
          error: 'busy',
          message: 'The project is being saved by someone else right now. Try again in a moment.'
        },
        409
      );
    }
    if (nextUsed) {
      await env.DB.prepare(
        'UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?'
      )
        .bind(key, now, projectId)
        .run();
      const entry = await cloudLogSave(
        env,
        projectId,
        prevUsed,
        nextUsed,
        { type: actorType, label: actorLabel },
        'accepted',
        // ADDENDUM 4.1: attribute the writer, not just the approver.
        reviewSource(row, actorLabel)
      );
      if (entry) {
        resp.changelog = entry;
      }
      if (pushRevChanged) {
        await pushRevChanged(env, projectId, now, { type: actorType, label: actorLabel });
      }
      resp.savedAt = now;
    }
  } else if (row.proposal_type === 'mcp') {
    // MCP-AGENT-FIRST 2026-11-12 3.1/3.4: a v2 row (ops_json is {v:2, ops})
    // is accepted by the pure applyOps engine; everything else keeps the
    // legacy leaf-diff path (backward compatible with rows queued before this
    // migration).
    const v2ops = parseV2Ops(row.ops_json);
    if (v2ops && v2ops.length) {
      return await acceptMcpV2(
        env,
        projectId,
        reviewId,
        row,
        decision,
        actorType,
        actorLabel,
        scope,
        now,
        pushRevChanged
      );
    }
    return await acceptMcpLegacy(
      env,
      projectId,
      reviewId,
      row,
      decision,
      actorType,
      actorLabel,
      scope,
      now,
      pushRevChanged
    );
  } else {
    return json({ ok: false, error: 'unsupported proposal type' }, 400);
  }
  const acceptedEntryId = resp.entryId || (resp.changelog && resp.changelog.id) || null;
  await env.DB.prepare(
    'UPDATE cloud_reviews SET status = ?, decided_at = ?, decided_by = ?, accepted_entry_id = ?, decision_note = ?, decision_edited = ? WHERE id = ?'
  )
    .bind(
      'accepted',
      now,
      actorLabel,
      acceptedEntryId,
      decision.note || null,
      decision.edited,
      reviewId
    )
    .run();
  resp.acceptedEntryId = acceptedEntryId;
  if (decision.note) {
    resp.note = decision.note;
  }
  if (decision.edited) {
    resp.edited = true;
  }
  return json(resp);
}

// MCP-AGENT-FIRST 2026-11-12 4.1: one mapping from a review row to the
// changelog's source fields, so every accepted proposal is attributed the
// same way. An MCP proposal or a direct API-key save is 'agent' (the key
// wrote it); an editor or team save is 'editor'. The human who clicked
// Accept stays in actor_type / actor_label - this is about who WROTE it.
function reviewSource(row, fallbackLabel) {
  const isAgent = row.proposal_type === 'mcp' || row.source_type === 'api';
  return {
    proposalId: row.id != null ? row.id : null,
    sourceType: isAgent ? 'agent' : 'editor',
    sourceLabel: row.source_label || fallbackLabel || '',
    keyId: row.key_id != null ? String(row.key_id) : null,
    changeSetId: row.change_set_id || null
  };
}

export async function handleReviewReject(request, env, projectId, reviewId) {
  const decision = await readDecisionBody(request);
  await cloudHealStaleClaims(env, projectId);
  const row = await env.DB.prepare('SELECT * FROM cloud_reviews WHERE id = ? AND project_id = ?')
    .bind(reviewId, projectId)
    .first();
  if (!row) {
    return json({ ok: false, error: 'proposal not found' }, 404);
  }
  if (row.status !== 'pending') {
    return json({ ok: false, error: 'proposal is not pending' }, 409);
  }
  let scopeForAuth = [];
  try {
    const p = JSON.parse(row.scope);
    if (Array.isArray(p)) {
      scopeForAuth = p;
    }
  } catch (e) {
    scopeForAuth = [];
  }
  const budgetOnly =
    scopeForAuth.length > 0 &&
    scopeForAuth.every(function (s) {
      return s === 'bud';
    });
  let auth = await cloudAuthOwnerEither(request, env, projectId);
  let actorLabel = 'Owner';
  let actorType = 'owner';
  if (!auth && budgetOnly) {
    const approver = await cloudAuthBudgetApprover(request, env, projectId);
    if (approver) {
      auth = approver;
      actorLabel = approver.label;
      actorType = approver.actorType;
    }
  } else if (auth) {
    actorLabel = auth.label || 'Owner';
  }
  if (!auth) {
    return cloudForbidden();
  }
  const now = new Date().toISOString();
  // MCP-AGENT-FIRST 2026-11-12 1.6(a): the reject is conditional too, so it
  // cannot race an accept. The audit row is written only after the claim wins.
  const rejected = await env.DB.prepare(
    "UPDATE cloud_reviews SET status = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND status = 'pending'"
  )
    .bind('rejected', now, actorLabel, decision.note || null, reviewId)
    .run();
  if (!rejected.meta || !rejected.meta.changes) {
    return json(
      {
        ok: false,
        error: 'already being decided',
        message: 'This proposal is already being decided. Refresh the list and try again.'
      },
      409
    );
  }
  await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  )
    .bind(
      projectId,
      'rejected',
      actorType,
      actorLabel,
      row.section || null,
      row.diffs_json || null,
      null,
      now
    )
    .run();
  return json({
    ok: true,
    reviewId: reviewId,
    status: 'rejected',
    decidedAt: now,
    note: decision.note || ''
  });
}

/* ============================================================
   MCP ACCEPT — legacy (pre-v2) leaf-diff path.
   ------------------------------------------------------------
   Used by rows queued before this migration (ops_json is a bare leaf
   list, not {v:2, ops}). Mirrors the owner "save" branch: merge the
   stored submission under the proposal scope, write to R2 with a
   conditional etag, flip latest_r2_key, log the changelog. This is the
   exact code that lived inline in handleReviewAccept before the v2 engine
   landed (MCP-AGENT-FIRST 2026-11-12 3.4).
   ============================================================ */
async function acceptMcpLegacy(
  env,
  projectId,
  reviewId,
  row,
  decision,
  actorType,
  actorLabel,
  scope,
  now,
  pushRevChanged
) {
  const resp = { ok: true, reviewId: reviewId, status: 'accepted', decidedAt: now };
  const key = 'projects/' + projectId + '/latest.json';
  const projRowM = await env.DB.prepare(
    'SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
  )
    .bind(projectId)
    .first();
  let scopeLocal = Array.isArray(scope) ? scope : [];
  const baseSubmitted = (function () {
    try {
      return JSON.parse(row.submitted_json);
    } catch (e) {
      return {};
    }
  })();
  let prevUsed = null;
  let nextUsed = null;
  let wrote = false;
  for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
    const read = await cloudReadStateEtag(
      env,
      key,
      projRowM && projRowM.owner_code_hash,
      projRowM && projRowM.owner_code_salt
    );
    const prev = read.state;
    let submitted = baseSubmitted;
    if (Array.isArray(decision.changes)) {
      const built = buildBudgetProposal(prev, decision.changes, prev && prev.currency);
      if (!built.changes.length) {
        await releaseClaim(env, reviewId);
        return json(
          {
            ok: false,
            error:
              'Nothing to apply. ' +
              (built.refused.length ? built.refused.join('; ') : 'No changes were approved.')
          },
          400
        );
      }
      const stale = [];
      built.changes.forEach(function (c) {
        if (c.kind !== 'changeLine' || c.before === undefined || c.before === null) {
          return;
        }
        const live = (prev && prev.budgetLines ? prev.budgetLines : []).find(function (l) {
          return String(l.id) === String(c.lineId);
        });
        const liveVal = live ? live[c.field] : undefined;
        if (String(liveVal == null ? '' : liveVal) !== String(c.before)) {
          stale.push({
            lineId: c.lineId,
            field: c.field,
            expected: c.before,
            actual: liveVal == null ? null : liveVal
          });
        }
      });
      if (stale.length) {
        await releaseClaim(env, reviewId);
        return json(
          {
            ok: false,
            error: 'stale',
            message: 'This proposal changed since it was made. Refresh it before approving.',
            stale: stale
          },
          409
        );
      }
      submitted = built.submitted;
      scopeLocal = ['bud'];
      decision.edited = 1;
      resp.proposalSummary = built.summary;
    } else {
      const leafDiffs = Array.isArray(decision.diffs) ? decision.diffs : storedDiffs(row);
      if (
        !Array.isArray(decision.diffs) &&
        !row.ops_json &&
        Array.isArray(leafDiffs) &&
        leafDiffs.length === 500
      ) {
        await releaseClaim(env, reviewId);
        return json(
          {
            ok: false,
            error: 'truncated',
            message:
              'This older proposal was truncated when it was queued. Reject it and ask the agent to resubmit.'
          },
          409
        );
      }
      if (Array.isArray(leafDiffs) && leafDiffs.length) {
        const applied = applyLeafDiffs(prev, leafDiffs, submitted);
        if (applied.stale.length || applied.unaddressable.length) {
          await releaseClaim(env, reviewId);
          return refusalFor(applied);
        }
        submitted = applied.submitted;
        if (Array.isArray(decision.diffs)) {
          decision.edited = 1;
        }
        if (!applied.changed) {
          resp.noop = true;
        }
      } else {
        await releaseClaim(env, reviewId);
        return json(
          {
            ok: false,
            error: 'no-diffs',
            message:
              'This proposal carries no stored field changes, so it cannot be applied safely. Reject it and ask the agent to resubmit.'
          },
          409
        );
      }
    }
    const merged = cloudScopeMerge(prev, submitted, scopeLocal);
    resp.applied = merged.applied;
    resp.blocked = merged.blocked;
    if (!merged.applied.length) {
      wrote = true;
      break;
    }
    merged.next.updatedAt = now;
    let r2Payload = JSON.stringify(merged.next);
    if (projRowM && projRowM.owner_code_hash && projRowM.owner_code_salt) {
      try {
        r2Payload = await cloudEncryptState(
          merged.next,
          projRowM.owner_code_hash,
          projRowM.owner_code_salt
        );
      } catch (e) {
        /* fall back to plaintext */
      }
    }
    const put = await cloudPutState(env, key, r2Payload, read.etag);
    if (put.ok) {
      wrote = true;
      prevUsed = prev;
      nextUsed = merged.next;
    }
  }
  if (!wrote) {
    await releaseClaim(env, reviewId);
    return json(
      {
        ok: false,
        error: 'busy',
        message: 'The project is being saved by someone else right now. Try again in a moment.'
      },
      409
    );
  }
  if (nextUsed) {
    await env.DB.prepare(
      'UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?'
    )
      .bind(key, now, projectId)
      .run();
    const entry = await cloudLogSave(
      env,
      projectId,
      prevUsed,
      nextUsed,
      { type: actorType, label: actorLabel },
      'accepted',
      // ADDENDUM 4.1: same attribution on the budget/legacy branch.
      reviewSource(row, actorLabel)
    );
    if (entry) {
      resp.changelog = entry;
    }
    if (pushRevChanged) {
      await pushRevChanged(env, projectId, now, { type: actorType, label: actorLabel });
    }
    resp.savedAt = now;
  }
  const acceptedEntryId = resp.entryId || (resp.changelog && resp.changelog.id) || null;
  await env.DB.prepare(
    'UPDATE cloud_reviews SET status = ?, decided_at = ?, decided_by = ?, accepted_entry_id = ?, decision_note = ?, decision_edited = ? WHERE id = ?'
  )
    .bind(
      'accepted',
      now,
      actorLabel,
      acceptedEntryId,
      decision.note || null,
      decision.edited,
      reviewId
    )
    .run();
  if (decision.note) {
    resp.note = decision.note;
  }
  if (decision.edited) {
    resp.edited = true;
  }
  return json(resp);
}

/* ============================================================
   MCP ACCEPT — v2 engine path (MCP-AGENT-FIRST 2026-11-12 3.4).
   ============================================================ */
async function acceptMcpV2(
  env,
  projectId,
  reviewId,
  row,
  decision,
  actorType,
  actorLabel,
  scope,
  now,
  pushRevChanged
) {
  const key = 'projects/' + projectId + '/latest.json';
  const projRow = await env.DB.prepare(
    'SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
  )
    .bind(projectId)
    .first();
  let v2ops = parseV2Ops(row.ops_json);
  if (!Array.isArray(v2ops) || !v2ops.length) {
    await releaseClaim(env, reviewId);
    return json(
      { ok: false, error: 'no-ops', message: 'This proposal carries no stored v2 ops.' },
      409
    );
  }
  // ADDENDUM A3: refuse a SINGLE accept while a proposal this one depends on
  // is still pending. Accept-all applies a change set in id order, so the
  // dependency lands first and never reaches this gate.
  const depIds = dependsOnIds(row.ops_json);
  if (depIds.length) {
    for (let di = 0; di < depIds.length; di++) {
      const drow = await env.DB.prepare(
        'SELECT id, status FROM cloud_reviews WHERE project_id = ? AND id = ?'
      )
        .bind(projectId, depIds[di])
        .first();
      if (drow && (drow.status === 'pending' || drow.status === 'accepting')) {
        await releaseClaim(env, reviewId);
        return json(
          {
            ok: false,
            error: 'DEPENDS_ON_PENDING',
            message:
              'This proposal depends on proposal #' +
              depIds[di] +
              ', which is still pending. Accept the whole change set (Accept all) so dependencies apply in order.'
          },
          409
        );
      }
    }
  }
  let budgetChanges = [];
  try {
    const p = row.proposal_json ? JSON.parse(row.proposal_json) : null;
    if (p && Array.isArray(p.changes)) {
      budgetChanges = p.changes;
    }
  } catch (e) {
    budgetChanges = [];
  }
  const proposals = [{ id: reviewId, scope: Array.isArray(scope) ? scope : [], ops: v2ops }];
  const model = {
    fieldSpec: fieldSpec,
    getList: getList,
    getSection: getSection,
    isDeletable: isDeletable
  };
  let prevUsed = null;
  let nextUsed = null;
  let wrote = false;
  let appliedUsed = null;
  let reportUsed = null;
  let derivedUsed = null;
  for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
    const read = await cloudReadStateEtag(
      env,
      key,
      projRow && projRow.owner_code_hash,
      projRow && projRow.owner_code_salt
    );
    const prev = read.state;
    const applied = applyOps(prev, proposals, { model: model });
    if (applied.hardFailure) {
      await releaseClaim(env, reviewId);
      return json(
        {
          ok: false,
          error: 'accept-failed',
          message: 'The proposal could not be applied: ' + JSON.stringify(applied.hardFailure),
          report: applied.report
        },
        422
      );
    }
    let next = applied.next;
    if (!next) {
      await releaseClaim(env, reviewId);
      return json(
        {
          ok: false,
          error: 'conflict',
          message:
            'No changes could be applied - the proposal conflicts with the current project. Refresh and re-propose.',
          conflicts: applied.conflicts,
          report: applied.report
        },
        409
      );
    }
    const effBudget = Array.isArray(decision.changes) ? decision.changes : budgetChanges;
    if (effBudget && effBudget.length) {
      const built = buildBudgetProposal(next, effBudget, next && next.currency);
      if (!built.changes.length) {
        await releaseClaim(env, reviewId);
        return json(
          {
            ok: false,
            error: 'nothing-to-apply',
            message:
              'No budget changes to apply.' + (built.refused.length ? built.refused.join('; ') : '')
          },
          400
        );
      }
      const stale = [];
      built.changes.forEach(function (c) {
        if (c.kind !== 'changeLine' || c.before === undefined || c.before === null) {
          return;
        }
        const live = (next.budgetLines || []).find(function (l) {
          return String(l.id) === String(c.lineId);
        });
        const liveVal = live ? live[c.field] : undefined;
        if (String(liveVal == null ? '' : liveVal) !== String(c.before)) {
          stale.push({
            lineId: c.lineId,
            field: c.field,
            expected: c.before,
            actual: liveVal == null ? null : liveVal
          });
        }
      });
      if (stale.length) {
        await releaseClaim(env, reviewId);
        return json(
          {
            ok: false,
            error: 'stale',
            message: 'This proposal changed since it was made. Refresh it before approving.',
            stale: stale
          },
          409
        );
      }
      const merged = cloudScopeMerge(next, built.submitted, ['bud']);
      next = merged.next;
    }
    const appliedCount = (applied.report || []).filter(function (r) {
      return r.result === 'applied';
    }).length;
    if (appliedCount === 0 && applied.conflicts.length) {
      await releaseClaim(env, reviewId);
      return json(
        {
          ok: false,
          error: 'conflict',
          message:
            'No changes could be applied - every op conflicts with the current project. Refresh and re-propose.',
          conflicts: applied.conflicts,
          report: applied.report
        },
        409
      );
    }
    next.updatedAt = now;
    let r2Payload = JSON.stringify(next);
    if (projRow && projRow.owner_code_hash && projRow.owner_code_salt) {
      try {
        r2Payload = await cloudEncryptState(next, projRow.owner_code_hash, projRow.owner_code_salt);
      } catch (e) {
        /* fall back to plaintext */
      }
    }
    const put = await cloudPutState(env, key, r2Payload, read.etag);
    if (put.ok) {
      wrote = true;
      prevUsed = prev;
      nextUsed = next;
      appliedUsed = applied;
      reportUsed = applied.report;
      derivedUsed = applied.derivedChanges;
    }
  }
  if (!wrote) {
    await releaseClaim(env, reviewId);
    return json(
      {
        ok: false,
        error: 'busy',
        message: 'The project is being saved by someone else right now. Try again in a moment.'
      },
      409
    );
  }
  await env.DB.prepare(
    'UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?'
  )
    .bind(key, now, projectId)
    .run();
  const entry = await cloudLogSave(
    env,
    projectId,
    prevUsed,
    nextUsed,
    { type: actorType, label: actorLabel },
    'accepted',
    {
      proposalId: reviewId,
      sourceType: 'agent',
      sourceLabel: row.source_label || 'MCP AI',
      keyId: row.key_id,
      changeSetId: row.change_set_id
    }
  );
  // ADDENDUM A6: at most 500 entries plus a summary counted over all of
  // them, so a bulk proposal cannot write an unbounded row.
  const reportPayload = storeApplyReport(
    reportUsed,
    derivedUsed,
    (reportUsed || []).filter(function (r) {
      return r.result === 'conflict';
    })
  );
  await env.DB.prepare(
    'UPDATE cloud_reviews SET apply_report_json = ?, status = ?, decided_at = ?, decided_by = ?, accepted_entry_id = ?, decision_note = ?, decision_edited = ? WHERE id = ?'
  )
    .bind(
      reportPayload,
      'accepted',
      now,
      actorLabel,
      (entry && entry.id) || null,
      decision.note || null,
      decision.edited,
      reviewId
    )
    .run();
  if (pushRevChanged) {
    await pushRevChanged(env, projectId, now, { type: actorType, label: actorLabel });
  }
  const resp = {
    ok: true,
    reviewId: reviewId,
    status: 'accepted',
    decidedAt: now,
    savedAt: now,
    applied: (reportUsed || []).filter(function (r) {
      return r.result === 'applied';
    }).length,
    skipped: (reportUsed || []).filter(function (r) {
      return r.result === 'skipped_already' || r.result === 'superseded';
    }).length,
    conflicts: appliedUsed ? appliedUsed.conflicts : [],
    derivedChanges: derivedUsed || [],
    changelog: entry
  };
  if (decision.note) {
    resp.note = decision.note;
  }
  if (decision.edited) {
    resp.edited = true;
  }
  return json(resp);
}

/* ============================================================
   CHANGE-SET ACCEPT / REJECT (MCP-AGENT-FIRST 2026-11-12 3.6).
   The owner (or, for a budget-only set, the named budget approver)
   decides a whole set in one click. The engine runs proposal by
   proposal on a single starting snapshot and logs each intermediate
   state change as its own cloud_changelog entry, but the resulting
   union is written to R2 in ONE conditional write (Step 1.6). Every
   proposal row gets its own apply_report_json.
   ============================================================ */

export async function handleChangeSetAccept(request, env, projectId, changeSetId, pushRevChanged) {
  const decision = await readDecisionBody(request);
  // MCP-AGENT-FIRST 2026-11-12 1.6(a): an abandoned claim reverts to pending.
  await cloudHealStaleClaims(env, projectId);
  const rows =
    (
      await env.DB.prepare(
        'SELECT * FROM cloud_reviews WHERE project_id = ? AND change_set_id = ? AND status = ? ORDER BY id ASC'
      )
        .bind(projectId, changeSetId, 'pending')
        .all()
    ).results || [];
  if (!rows.length) {
    return json(
      { ok: false, error: 'no-pending', message: 'This change set has no pending proposals.' },
      409
    );
  }
  // Auth: owner, or the budget approver only when every proposal is budget-only.
  let allBudgetOnly = rows.every(function (r) {
    let s = [];
    try {
      s = JSON.parse(r.scope);
    } catch (e) {
      s = [];
    }
    return (
      Array.isArray(s) &&
      s.length &&
      s.every(function (x) {
        return x === 'bud';
      })
    );
  });
  let auth = await cloudAuthOwnerEither(request, env, projectId);
  let actorLabel = 'Owner';
  let actorType = 'owner';
  if (!auth && allBudgetOnly) {
    const approver = await cloudAuthBudgetApprover(request, env, projectId);
    if (approver) {
      auth = approver;
      actorLabel = approver.label;
      actorType = approver.actorType;
    }
  } else if (auth) {
    actorLabel = auth.label || 'Owner';
  }
  if (!auth) {
    return cloudForbidden();
  }
  const now = new Date().toISOString();
  // Claim every row; the first one that cannot be claimed (already deciding)
  // aborts the whole set and heals the rest back to pending.
  const claimed = [];
  let claimBroken = false;
  for (let i = 0; i < rows.length; i++) {
    const c = await env.DB.prepare(
      "UPDATE cloud_reviews SET status = 'accepting', decided_at = ? WHERE id = ? AND project_id = ? AND status = 'pending'"
    )
      .bind(now, rows[i].id, projectId)
      .run();
    if (!c.meta || !c.meta.changes) {
      claimBroken = true;
      break;
    }
    claimed.push(rows[i].id);
  }
  if (claimBroken) {
    for (let i = 0; i < claimed.length; i++) {
      await releaseClaim(env, claimed[i]);
    }
    return json(
      {
        ok: false,
        error: 'already-being-decided',
        message: 'One of the proposals in this set is already being decided. Try again.'
      },
      409
    );
  }
  const key = 'projects/' + projectId + '/latest.json';
  const projRow = await env.DB.prepare(
    'SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
  )
    .bind(projectId)
    .first();
  const model = {
    fieldSpec: fieldSpec,
    getList: getList,
    getSection: getSection,
    isDeletable: isDeletable
  };
  const plans = rows.map(function (r) {
    let ops = parseV2Ops(r.ops_json) || [];
    let budgetChanges = [];
    try {
      const p = r.proposal_json ? JSON.parse(r.proposal_json) : null;
      if (p && Array.isArray(p.changes)) {
        budgetChanges = p.changes;
      }
    } catch (e) {
      budgetChanges = [];
    }
    let scope = [];
    try {
      scope = JSON.parse(r.scope);
    } catch (e) {
      scope = [];
    }
    return {
      id: r.id,
      scope: Array.isArray(scope) ? scope : [],
      ops: ops,
      budgetChanges: budgetChanges,
      row: r
    };
  });
  const currency = (function () {
    const last = rows[rows.length - 1];
    try {
      const p = last.proposal_json ? JSON.parse(last.proposal_json) : null;
      return p && p.currency ? p.currency : null;
    } catch (e) {
      return null;
    }
  })();
  let prevUsed = null;
  let nextUsed = null;
  let wrote = false;
  const perProposal = [];
  let hardFail = null;
  for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
    const read = await cloudReadStateEtag(
      env,
      key,
      projRow && projRow.owner_code_hash,
      projRow && projRow.owner_code_salt
    );
    const prev = read.state;
    let running = prev;
    const localPer = [];
    let failed = false;
    for (let i = 0; i < plans.length && !failed; i++) {
      const plan = plans[i];
      const applied = applyOps(running, [{ id: plan.id, scope: plan.scope, ops: plan.ops }], {
        model: model
      });
      if (applied.hardFailure) {
        failed = true;
        hardFail = applied.hardFailure;
        break;
      }
      if (!applied.next) {
        localPer.push({ plan: plan, report: applied.report, derivedChanges: [], next: running });
        continue;
      }
      localPer.push({
        plan: plan,
        report: applied.report,
        derivedChanges: applied.derivedChanges || [],
        next: applied.next
      });
      running = applied.next;
    }
    if (failed) {
      for (let i = 0; i < claimed.length; i++) {
        await releaseClaim(env, claimed[i]);
      }
      return json(
        {
          ok: false,
          error: 'accept-failed',
          message: 'A proposal in this set could not be applied: ' + JSON.stringify(hardFail),
          hardFailure: hardFail
        },
        422
      );
    }
    let next = running;
    let combinedBudget = [];
    plans.forEach(function (p) {
      combinedBudget = combinedBudget.concat(p.budgetChanges);
    });
    if (combinedBudget.length) {
      const built = buildBudgetProposal(next, combinedBudget, currency);
      if (!built.changes.length) {
        for (let i = 0; i < claimed.length; i++) {
          await releaseClaim(env, claimed[i]);
        }
        return json(
          { ok: false, error: 'nothing-to-apply', message: 'No budget changes to apply.' },
          400
        );
      }
      const stale = [];
      built.changes.forEach(function (c) {
        if (c.kind !== 'changeLine' || c.before === undefined || c.before === null) {
          return;
        }
        const live = (next.budgetLines || []).find(function (l) {
          return String(l.id) === String(c.lineId);
        });
        const liveVal = live ? live[c.field] : undefined;
        if (String(liveVal == null ? '' : liveVal) !== String(c.before)) {
          stale.push({ lineId: c.lineId, field: c.field, expected: c.before, actual: liveVal });
        }
      });
      if (stale.length) {
        for (let i = 0; i < claimed.length; i++) {
          await releaseClaim(env, claimed[i]);
        }
        return json(
          {
            ok: false,
            error: 'stale',
            message:
              'A budget line changed since the proposal was made. Refresh the set before approving.',
            stale: stale
          },
          409
        );
      }
      const merged = cloudScopeMerge(next, built.submitted, ['bud']);
      next = merged.next;
    }
    const totalApplied = localPer.reduce(function (acc, lp) {
      return (
        acc +
        (lp.report || []).filter(function (r) {
          return r.result === 'applied';
        }).length
      );
    }, 0);
    const totalConflicts = localPer.reduce(function (acc, lp) {
      return (
        acc +
        (lp.report || []).filter(function (r) {
          return r.result === 'conflict';
        }).length
      );
    }, 0);
    if (totalApplied === 0 && totalConflicts > 0) {
      for (let i = 0; i < claimed.length; i++) {
        await releaseClaim(env, claimed[i]);
      }
      return json(
        {
          ok: false,
          error: 'conflict',
          message: 'No changes could be applied - every op conflicts. Refresh and re-propose.',
          conflicts: (localPer[0] && localPer[0].report ? localPer[0].report : []).filter(
            function (r) {
              return r.result === 'conflict';
            }
          )
        },
        409
      );
    }
    next.updatedAt = now;
    let r2Payload = JSON.stringify(next);
    if (projRow && projRow.owner_code_hash && projRow.owner_code_salt) {
      try {
        r2Payload = await cloudEncryptState(next, projRow.owner_code_hash, projRow.owner_code_salt);
      } catch (e) {
        /* fall back to plaintext */
      }
    }
    const put = await cloudPutState(env, key, r2Payload, read.etag);
    if (put.ok) {
      wrote = true;
      prevUsed = prev;
      nextUsed = next;
      perProposal.splice(0, perProposal.length);
      localPer.forEach(function (lp) {
        perProposal.push(lp);
      });
    }
  }
  if (!wrote) {
    for (let i = 0; i < claimed.length; i++) {
      await releaseClaim(env, claimed[i]);
    }
    return json(
      {
        ok: false,
        error: 'busy',
        message: 'The project is being saved by someone else right now. Try again in a moment.'
      },
      409
    );
  }
  await env.DB.prepare(
    'UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?'
  )
    .bind(key, now, projectId)
    .run();
  const entryIds = [];
  for (let i = 0; i < perProposal.length; i++) {
    const lp = perProposal[i];
    // ADDENDUM A6: same cap and summary as the single accept path.
    const reportPayload = storeApplyReport(
      lp.report,
      lp.derivedChanges,
      (lp.report || []).filter(function (r) {
        return r.result === 'conflict';
      })
    );
    let entry = null;
    try {
      entry = await cloudLogSave(
        env,
        projectId,
        prevUsed,
        lp.next || nextUsed,
        { type: actorType, label: actorLabel },
        'accepted',
        {
          proposalId: lp.plan.id,
          sourceType: 'agent',
          sourceLabel: lp.plan.row.source_label || 'MCP AI',
          keyId: lp.plan.row.key_id,
          changeSetId: changeSetId
        }
      );
    } catch (e) {
      entry = null;
    }
    entryIds.push((entry && entry.id) || null);
    await env.DB.prepare(
      'UPDATE cloud_reviews SET apply_report_json = ?, status = ?, decided_at = ?, decided_by = ?, accepted_entry_id = ?, decision_note = ?, decision_edited = ? WHERE id = ?'
    )
      .bind(
        reportPayload,
        'accepted',
        now,
        actorLabel,
        (entry && entry.id) || null,
        decision.note || null,
        decision.edited,
        lp.plan.id
      )
      .run();
  }
  if (pushRevChanged) {
    await pushRevChanged(env, projectId, now, { type: actorType, label: actorLabel });
  }
  // MCP-AGENT-FIRST 2026-11-12 3.7: surface the conflict detail and the
  // derived-field resets so the owner UI can render them after Accept all.
  // `nextUsed` is the final accepted state; a conflicted op was NOT applied, so
  // its live value is whatever `nextUsed` holds (the pre-accept live value).
  const conflictList = [];
  const derivedChanges = [];
  perProposal.forEach(function (lp) {
    const plan = plans.find(function (p) {
      return p.id === lp.plan.id;
    });
    (lp.report || []).forEach(function (r) {
      if (r.result === 'conflict') {
        const op = (plan && plan.ops ? plan.ops : [])[r.opIndex];
        let expected = op ? (op.afterAbsent ? null : op.after) : null;
        let live = null;
        let recName = '';
        if (r.path && Array.isArray(nextUsed[r.path]) && r.recordId != null) {
          const rec = (nextUsed[r.path] || []).find(function (x) {
            return String(x.id) === String(r.recordId);
          });
          if (rec) {
            recName = rec.name || rec.title || rec.description || rec.id || '';
            live = r.field ? (rec[r.field] === undefined ? null : rec[r.field]) : rec;
          }
        } else if (r.path) {
          const sec = nextUsed[r.path];
          if (r.field) {
            live = sec && sec[r.field] !== undefined ? sec[r.field] : null;
          } else {
            live = sec === undefined ? null : sec;
          }
        }
        conflictList.push({
          path: r.path,
          recordId: r.recordId,
          recordName: recName,
          field: r.field,
          expected: expected,
          live: live,
          reason: r.reason || ''
        });
      }
    });
    (lp.derivedChanges || []).forEach(function (dc) {
      derivedChanges.push(dc);
    });
  });
  const resp = {
    ok: true,
    changeSetId: changeSetId,
    status: 'accepted',
    decidedAt: now,
    savedAt: now,
    proposals: perProposal.length,
    applied: perProposal.reduce(function (acc, lp) {
      return (
        acc +
        (lp.report || []).filter(function (r) {
          return r.result === 'applied';
        }).length
      );
    }, 0),
    skipped: perProposal.reduce(function (acc, lp) {
      return (
        acc +
        (lp.report || []).filter(function (r) {
          return r.result === 'skipped_already' || r.result === 'superseded';
        }).length
      );
    }, 0),
    conflicts: perProposal.reduce(function (acc, lp) {
      return (
        acc +
        (lp.report || []).filter(function (r) {
          return r.result === 'conflict';
        }).length
      );
    }, 0),
    conflictList: conflictList,
    derivedChanges: derivedChanges,
    changelog: entryIds
  };
  return json(resp);
}

export async function handleChangeSetReject(request, env, projectId, changeSetId) {
  const decision = await readDecisionBody(request);
  await cloudHealStaleClaims(env, projectId);
  const rows =
    (
      await env.DB.prepare(
        'SELECT * FROM cloud_reviews WHERE project_id = ? AND change_set_id = ? AND status = ?'
      )
        .bind(projectId, changeSetId, 'pending')
        .all()
    ).results || [];
  if (!rows.length) {
    return json(
      { ok: false, error: 'no-pending', message: 'This change set has no pending proposals.' },
      409
    );
  }
  let allBudgetOnly = rows.every(function (r) {
    let s = [];
    try {
      s = JSON.parse(r.scope);
    } catch (e) {
      s = [];
    }
    return (
      Array.isArray(s) &&
      s.length &&
      s.every(function (x) {
        return x === 'bud';
      })
    );
  });
  let auth = await cloudAuthOwnerEither(request, env, projectId);
  let actorLabel = 'Owner';
  if (!auth && allBudgetOnly) {
    const approver = await cloudAuthBudgetApprover(request, env, projectId);
    if (approver) {
      auth = approver;
      actorLabel = approver.label;
    }
  } else if (auth) {
    actorLabel = auth.label || 'Owner';
  }
  if (!auth) {
    return cloudForbidden();
  }
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i++) {
    await env.DB.prepare(
      "UPDATE cloud_reviews SET status = 'rejected', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND project_id = ? AND status = 'pending'"
    )
      .bind(now, actorLabel, decision.note || null, rows[i].id, projectId)
      .run();
  }
  return json({
    ok: true,
    changeSetId: changeSetId,
    status: 'rejected',
    decidedAt: now,
    rejected: rows.length
  });
}
