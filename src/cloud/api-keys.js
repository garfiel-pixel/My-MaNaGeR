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
import {
  json,
  cloudForbidden,
  readCloudBody,
  cloudAuthOwnerEither,
  randomSaltHex,
  hashOwnerCode,
  fingerprintOf,
  CLOUD_SECTIONS,
  CLOUD_CODE_ALPHABET as CLOUD_KEY_ALPHABET
} from '../lib/http.js';
import { trackEvent } from '../lib/observe.js';
import { ownerTier } from './team.js';
import { limitsFor, upsellFor, autoAcceptPlanAllowed } from '../mcp/tier-limits.js';

const API_KEY_PREFIX_LEN = 8;
// OWNER 2026-09-15: keys now read as standard API keys, not license codes.
// An external AI that sees 'sk-mmgr-' + 4 groups of 6 base32 chars instantly
// knows it is a bearer key and where to send it (the header is documented in
// the shown-once banner + field guide). Format: sk-mmgr-XXXXXX-XXXXXX-XXXXXX.
const API_KEY_PREFIX_TOKEN = 'sk-mmgr-';
const API_KEY_BODY_GROUPS = 3;
const API_KEY_BODY_GROUP_LEN = 6;

export async function handleCloudApiKeyCreate(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  const activeRows = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM cloud_api_keys WHERE project_id = ? AND active = 1'
  )
    .bind(projectId)
    .first();
  // F2.2: the active-key cap follows the project OWNER's plan, read once here.
  const ownerRow = await env.DB.prepare(
    'SELECT google_sub FROM cloud_projects WHERE project_id = ?'
  )
    .bind(projectId)
    .first();
  const tier = await ownerTier(env, (ownerRow && ownerRow.google_sub) || '');
  const keyLimits = limitsFor(tier);
  if (activeRows && Number(activeRows.n) >= keyLimits.activeApiKeys) {
    return json(
      {
        ok: false,
        error:
          'too many active API keys for the ' +
          keyLimits.tier +
          ' plan (max ' +
          keyLimits.activeApiKeys +
          ') - revoke unused keys first.' +
          upsellFor(keyLimits.tier)
      },
      400
    );
  }
  const read = await readCloudBody(request);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad || !read.body || typeof read.body !== 'object') {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const label = typeof read.body.label === 'string' ? read.body.label.trim().slice(0, 60) : '';
  // Section scope: same allowlist as editor codes. At least one section -
  // a key that can touch nothing is never issued.
  const scope = Array.isArray(read.body.scope)
    ? read.body.scope.filter(function (s) {
        return typeof s === 'string' && !!CLOUD_SECTIONS[s];
      })
    : [];
  const seen = {};
  const unique = scope.filter(function (s) {
    if (seen[s]) {
      return false;
    }
    seen[s] = 1;
    return true;
  });
  if (unique.length === 0) {
    return json({ ok: false, error: 'at least one section is required' }, 400);
  }
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
    if (isNaN(t) || t <= Date.now()) {
      return json({ ok: false, error: 'expiry must be a future date' }, 400);
    }
    expiresAt = new Date(t).toISOString();
  }
  // H-5 (BUDGET-BOQ directive 2026-11-05): two budget switches, both OFF by
  // default and independent of the section scope. A key cannot be granted the
  // write switch without the read switch - a proposal the client cannot
  // preview is a trap for the owner, not a convenience.
  const budgetRead = read.body.budgetRead === true || read.body.budgetRead === 1;
  const budgetWrite = read.body.budgetWrite === true || read.body.budgetWrite === 1;
  if (budgetWrite && !budgetRead) {
    return json(
      {
        ok: false,
        error: 'a key that may propose budget changes must also be allowed to read the budget'
      },
      400
    );
  }
  const salt = randomSaltHex();
  // Build the key body from the same 32-char base32 alphabet (no I, L, O, 0,
  // 1 confusion) as owner codes, then wrap it in the standard sk- prefix.
  const bytes = crypto.getRandomValues(
    new Uint8Array(API_KEY_BODY_GROUPS * API_KEY_BODY_GROUP_LEN)
  );
  const groups = [];
  for (let g = 0; g < API_KEY_BODY_GROUPS; g++) {
    let grp = '';
    for (let i = 0; i < API_KEY_BODY_GROUP_LEN; i++) {
      grp += CLOUD_KEY_ALPHABET[bytes[g * API_KEY_BODY_GROUP_LEN + i] % 32];
    }
    groups.push(grp);
  }
  const apiKey = API_KEY_PREFIX_TOKEN + groups.join('-');
  const hash = await hashOwnerCode(apiKey, salt);
  const fp = await fingerprintOf(apiKey);
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_api_keys (project_id, label, scope, key_salt, key_hash, key_fingerprint, key_prefix, expires_at, active, created_at, budget_read, budget_write) VALUES (?,?,?,?,?,?,?,?,1,?,?,?)'
  )
    .bind(
      projectId,
      label,
      JSON.stringify(unique),
      salt,
      hash,
      fp,
      apiKey.slice(0, API_KEY_PREFIX_LEN),
      expiresAt,
      now,
      budgetRead ? 1 : 0,
      budgetWrite ? 1 : 0
    )
    .run();
  // B (2026-11-09): identifier-free product event. The project id, key id and
  // label stay out of the data point; only the event name is written.
  trackEvent(env, 'mcp_key_created', {}, request);
  return json({
    ok: true,
    apiKey: apiKey,
    keyId: res.meta.last_row_id,
    label: label,
    scope: unique,
    budgetRead: budgetRead,
    budgetWrite: budgetWrite,
    expiresAt: expiresAt,
    createdAt: now
  });
}

export async function handleCloudApiKeyList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  const rows = await env.DB.prepare(
    'SELECT id, label, scope, key_prefix, expires_at, active, created_at, last_used_at, budget_read, budget_write, auto_accept FROM cloud_api_keys WHERE project_id = ? ORDER BY id DESC'
  )
    .bind(projectId)
    .all();
  const keys = (rows.results || []).map(function (r) {
    let scope = [];
    try {
      const p = JSON.parse(r.scope);
      if (Array.isArray(p)) {
        scope = p;
      }
    } catch (e) {
      scope = [];
    }
    let expired = false;
    if (r.expires_at) {
      const t = Date.parse(r.expires_at);
      expired = !isNaN(t) && t <= Date.now();
    }
    return {
      id: r.id,
      label: r.label,
      scope: scope,
      budgetRead: r.budget_read === 1,
      budgetWrite: r.budget_write === 1,
      autoAccept: r.auto_accept === 'low-risk' ? 'low-risk' : 'off',
      prefix: r.key_prefix,
      expiresAt: r.expires_at,
      active: r.active === 1 && !expired,
      created_at: r.created_at,
      last_used_at: r.last_used_at
    };
  });
  return json({ ok: true, keys: keys });
}

export async function handleCloudApiKeyRevoke(request, env, projectId, keyId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  const res = await env.DB.prepare(
    'UPDATE cloud_api_keys SET active = 0 WHERE id = ? AND project_id = ? AND active = 1'
  )
    .bind(keyId, projectId)
    .run();
  if (!res.meta.changes) {
    return json({ ok: false, error: 'API key not found' }, 404);
  }
  return json({ ok: true, revokedKeyId: Number(keyId) });
}

// H-5 (BUDGET-BOQ directive 2026-11-05): turn the two budget switches on or
// off after a key was minted. Owner-only, same either-auth as every other key
// operation. Only the switches move - the label, scope and expiry are set at
// creation and never edited here.
export async function handleCloudApiKeyPatch(request, env, projectId, keyId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    return cloudForbidden();
  }
  const read = await readCloudBody(request);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad || !read.body || typeof read.body !== 'object') {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const row = await env.DB.prepare(
    'SELECT id, scope, budget_read, budget_write, auto_accept FROM cloud_api_keys WHERE id = ? AND project_id = ? AND active = 1'
  )
    .bind(keyId, projectId)
    .first();
  if (!row) {
    return json({ ok: false, error: 'API key not found' }, 404);
  }
  const asBool = function (v, fallback) {
    if (v === true || v === 1) {
      return 1;
    }
    if (v === false || v === 0) {
      return 0;
    }
    return fallback;
  };
  const nextRead = asBool(read.body.budgetRead, row.budget_read === 1 ? 1 : 0);
  const nextWrite = asBool(read.body.budgetWrite, row.budget_write === 1 ? 1 : 0);
  if (nextWrite && !nextRead) {
    return json(
      {
        ok: false,
        error: 'a key that may propose budget changes must also be allowed to read the budget'
      },
      400
    );
  }
  // MCP-AGENT-FIRST 2026-11-12 6.1: the auto-accept policy is a closed set,
  // never a truthy coercion - an unknown string must not silently mean "on".
  // Absent means "leave it as it is".
  let nextAuto = row.auto_accept === 'low-risk' ? 'low-risk' : 'off';
  if (read.body.autoAccept !== undefined) {
    if (read.body.autoAccept !== 'off' && read.body.autoAccept !== 'low-risk') {
      return json({ ok: false, error: "autoAccept must be 'off' or 'low-risk'" }, 400);
    }
    // Close-out 3b: only Company/Enterprise owners may raise the policy.
    // The plan is the project OWNER's, never the caller's (an owner code or a
    // signed-in owner reaches the same route). Turning it OFF stays allowed
    // on every plan, so a downgraded owner can always undo it. Refuse BEFORE
    // the UPDATE: the stored row must not change on a rejected raise.
    if (read.body.autoAccept === 'low-risk') {
      const ownerRow = await env.DB.prepare(
        'SELECT google_sub FROM cloud_projects WHERE project_id = ?'
      )
        .bind(projectId)
        .first();
      const owner = await ownerTier(env, (ownerRow && ownerRow.google_sub) || '');
      if (!autoAcceptPlanAllowed(owner)) {
        const seen = limitsFor(owner).tier;
        return json(
          {
            ok: false,
            error: 'enterprise_feature',
            upgradeRequired: 'company',
            message:
              'Low-risk auto-accept needs the Company or Enterprise plan (owner plan: ' +
              seen +
              ').' +
              upsellFor(seen)
          },
          402
        );
      }
    }
    nextAuto = read.body.autoAccept;
  }
  await env.DB.prepare(
    'UPDATE cloud_api_keys SET budget_read = ?, budget_write = ?, auto_accept = ? WHERE id = ? AND project_id = ?'
  )
    .bind(nextRead, nextWrite, nextAuto, keyId, projectId)
    .run();
  return json({
    ok: true,
    keyId: Number(keyId),
    budgetRead: nextRead === 1,
    budgetWrite: nextWrite === 1,
    autoAccept: nextAuto
  });
}
