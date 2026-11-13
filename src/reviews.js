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
  cloudReadState,
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
    const rows = await env.DB.prepare(
      'SELECT id, proposal_type, source_type, source_label, status, diffs_json, proposal_json, proposed_at, decided_at, decided_by, accepted_entry_id, decision_note, decision_edited FROM cloud_reviews WHERE project_id = ? ORDER BY CASE WHEN status = ? THEN 0 ELSE 1 END, id DESC LIMIT 100'
    )
      .bind(projectId, 'pending')
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
        status: r.status,
        diffs: normalized.diffs,
        diffTotal: normalized.total,
        diffTruncated: normalized.truncated,
        proposal: proposal,
        proposedAt: r.proposed_at,
        decidedAt: r.decided_at,
        decidedBy: r.decided_by,
        decisionNote: r.decision_note || '',
        decisionEdited: r.decision_edited === 1,
        acceptedEntryId: r.accepted_entry_id
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
  try {
    const list = row.diffs_json ? JSON.parse(row.diffs_json) : null;
    return Array.isArray(list) ? list : null;
  } catch (e) {
    return null;
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
  if (row.proposal_type === 'save') {
    const key = 'projects/' + projectId + '/latest.json';
    const projRow = await env.DB.prepare(
      'SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
    )
      .bind(projectId)
      .first();
    const prev = await cloudReadState(
      env,
      key,
      projRow && projRow.owner_code_hash,
      projRow && projRow.owner_code_salt
    );
    let scope = [];
    try {
      const p = JSON.parse(row.scope);
      if (Array.isArray(p)) {
        scope = p;
      }
    } catch (e) {
      scope = [];
    }
    let submitted = {};
    try {
      submitted = JSON.parse(row.submitted_json);
    } catch (e) {
      submitted = {};
    }
    // Partial approval: the owner ticked a subset of the listed fields. Apply
    // those leaves to the CURRENT state instead of replacing whole sections,
    // so an unrelated field that moved since the save is not rolled back.
    if (Array.isArray(decision.diffs) && decision.diffs.length) {
      const applied = applyLeafDiffs(prev, decision.diffs, submitted);
      if (applied.stale.length || applied.unaddressable.length) {
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
    if (merged.applied.length > 0) {
      merged.next.updatedAt = now;
      // Encrypt state blob on accept (same envelope as handleCloudSave)
      const projRow = await env.DB.prepare(
        'SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
      )
        .bind(projectId)
        .first();
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
      await env.R2.put(key, r2Payload, { httpMetadata: { contentType: 'application/json' } });
      await env.DB.prepare(
        'UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?'
      )
        .bind(key, now, projectId)
        .run();
      const entry = await cloudLogSave(
        env,
        projectId,
        prev,
        merged.next,
        { type: actorType, label: actorLabel },
        'accepted'
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
    // API-KEY-AUDIT F3 accept-side (2026-09-16): the old branch only wrote a
    // changelog line - accepting an MCP proposal changed NOTHING. Mirror the
    // 'save' branch: merge the stored submission under the proposal's scope,
    // write the new state to R2, flip latest_r2_key, log the changelog.
    const key = 'projects/' + projectId + '/latest.json';
    const projRowM = await env.DB.prepare(
      'SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
    )
      .bind(projectId)
      .first();
    const prev = await cloudReadState(
      env,
      key,
      projRowM && projRowM.owner_code_hash,
      projRowM && projRowM.owner_code_salt
    );
    let scope = [];
    try {
      const p = JSON.parse(row.scope);
      if (Array.isArray(p)) {
        scope = p;
      }
    } catch (e) {
      scope = [];
    }
    let submitted = {};
    try {
      submitted = JSON.parse(row.submitted_json);
    } catch (e) {
      submitted = {};
    }
    // H-6 (BUDGET-BOQ directive 2026-11-05): the approval preview sends back
    // ONLY the changes the owner ticked, with the values the owner left in
    // the fields. Rebuild the submission from those against the CURRENT state
    // through the same validator the MCP server uses - so a partial approval
    // applies a subset, an edited value wins, and a value the browser made up
    // is refused here. A change whose "before" no longer matches the live
    // line is STALE: refuse the whole accept and name both values, because
    // applying half a stale proposal is worse than asking for a refresh.
    if (Array.isArray(decision.changes)) {
      const built = buildBudgetProposal(prev, decision.changes, prev && prev.currency);
      if (!built.changes.length) {
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
      scope = ['bud'];
      decision.edited = 1;
      resp.proposalSummary = built.summary;
    } else {
      // One-press accept: apply the proposal's OWN stored leaves to the
      // current state. The old path merged submitted_json, which replaces a
      // whole tasks array and silently dropped flat leaves; this path touches
      // only the fields the owner was shown.
      const leafDiffs = Array.isArray(decision.diffs) ? decision.diffs : storedDiffs(row);
      if (Array.isArray(leafDiffs) && leafDiffs.length) {
        const applied = applyLeafDiffs(prev, leafDiffs, submitted);
        if (applied.stale.length || applied.unaddressable.length) {
          return refusalFor(applied);
        }
        submitted = applied.submitted;
        if (Array.isArray(decision.diffs)) {
          decision.edited = 1;
        }
        if (!applied.changed) {
          resp.noop = true;
        }
      }
    }
    const merged = cloudScopeMerge(prev, submitted, scope);
    resp.applied = merged.applied;
    resp.blocked = merged.blocked;
    if (merged.applied.length > 0) {
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
      await env.R2.put(key, r2Payload, { httpMetadata: { contentType: 'application/json' } });
      await env.DB.prepare(
        'UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?'
      )
        .bind(key, now, projectId)
        .run();
      const entry = await cloudLogSave(
        env,
        projectId,
        prev,
        merged.next,
        { type: actorType, label: actorLabel },
        'accepted'
      );
      if (entry) {
        resp.changelog = entry;
      }
      if (pushRevChanged) {
        await pushRevChanged(env, projectId, now, { type: actorType, label: actorLabel });
      }
      resp.savedAt = now;
    }
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

export async function handleReviewReject(request, env, projectId, reviewId) {
  const decision = await readDecisionBody(request);
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
  await env.DB.prepare(
    'UPDATE cloud_reviews SET status = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?'
  )
    .bind('rejected', now, actorLabel, decision.note || null, reviewId)
    .run();
  return json({
    ok: true,
    reviewId: reviewId,
    status: 'rejected',
    decidedAt: now,
    note: decision.note || ''
  });
}
