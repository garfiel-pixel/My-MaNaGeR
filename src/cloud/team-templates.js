/* ============================================================
   CLOUD TEAM TEMPLATES - reusable role presets
   ------------------------------------------------------------
   RBAC sprint 3 (directive 2026-10-25, section 5 item 2).

   A template is a NAME plus a permission matrix, owned by one ACCOUNT
   (owner_sub) and reusable on every project that account owns. The four fixed
   roles keep working on every paid tier; templates exist so an owner can build
   "Site supervisor - no budget" once and apply it everywhere.

   Authorization: the signed-in verified account is the only identity that can
   see or change its own templates. There is no cross-account read path and no
   id ever comes from the client without an owner_sub filter.

   Tier: company/enterprise only, checked on every route so a downgrade takes
   the feature away immediately instead of leaving stale rows usable.
   ============================================================ */
import {
  json,
  cloudForbidden,
  readSession,
  readJsonBody,
  normalizeTeamMatrix,
  parseTeamMatrix,
  CLOUD_SECTIONS
} from '../lib/http.js';
import { billingStatusActive } from '../billing.js';

const BODY_CAP = 16384;
export const TEMPLATE_LIMIT = 25;

function nowIso() {
  return new Date().toISOString();
}

async function enterpriseOwner(request, env) {
  const sess = await readSession(request, env);
  if (!sess || !sess.sub) {
    return null;
  }
  const sub = await env.DB.prepare(
    'SELECT status, tier, plan FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(sess.sub)
    .first();
  const tier =
    sub && billingStatusActive(sub.status) ? sub.tier || sub.plan || 'contractor' : 'free';
  if (tier !== 'company' && tier !== 'enterprise') {
    return null;
  }
  return { sub: sess.sub, tier: tier, name: sess.name || 'Owner' };
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    perm: parseTeamMatrix(row.perm) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// GET /api/team/templates
export async function handleTemplatesList(request, env) {
  const owner = await enterpriseOwner(request, env);
  if (!owner) {
    return json({ ok: false, error: 'enterprise_feature', upgradeRequired: 'company' }, 402);
  }
  const rows = await env.DB.prepare(
    'SELECT id, name, perm, created_at, updated_at FROM cloud_team_templates WHERE owner_sub = ? ORDER BY name ASC'
  )
    .bind(owner.sub)
    .all();
  return json({
    ok: true,
    templates: (rows.results || []).map(serialize),
    sections: Object.keys(CLOUD_SECTIONS).map(function (k) {
      return { key: k, label: CLOUD_SECTIONS[k].label };
    })
  });
}

// POST /api/team/templates { name, perm }
export async function handleTemplatesCreate(request, env) {
  const owner = await enterpriseOwner(request, env);
  if (!owner) {
    return json({ ok: false, error: 'enterprise_feature', upgradeRequired: 'company' }, 402);
  }
  const read = await readJsonBody(request, BODY_CAP);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const body = read.body || {};
  const name = String(body.name || '')
    .trim()
    .slice(0, 60);
  if (name.length < 2) {
    return json({ ok: false, error: 'a template needs a name' }, 400);
  }
  const matrix = normalizeTeamMatrix(body.perm);
  if (!matrix) {
    return json({ ok: false, error: 'invalid permission matrix' }, 400);
  }
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM cloud_team_templates WHERE owner_sub = ?'
  )
    .bind(owner.sub)
    .first();
  if (((count && count.c) || 0) >= TEMPLATE_LIMIT) {
    return json({ ok: false, error: 'template_limit', limit: TEMPLATE_LIMIT }, 409);
  }
  const ts = nowIso();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_team_templates (owner_sub, name, perm, created_at, updated_at) VALUES (?,?,?,?,?)'
  )
    .bind(owner.sub, name, JSON.stringify(matrix), ts, ts)
    .run();
  return json({
    ok: true,
    template: { id: res.meta.last_row_id, name: name, perm: matrix, createdAt: ts, updatedAt: ts }
  });
}

// PUT /api/team/templates/:id { name?, perm? }
export async function handleTemplatesUpdate(request, env, templateId) {
  const owner = await enterpriseOwner(request, env);
  if (!owner) {
    return json({ ok: false, error: 'enterprise_feature', upgradeRequired: 'company' }, 402);
  }
  const read = await readJsonBody(request, BODY_CAP);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const body = read.body || {};
  const row = await env.DB.prepare(
    'SELECT id, name, perm FROM cloud_team_templates WHERE id = ? AND owner_sub = ?'
  )
    .bind(templateId, owner.sub)
    .first();
  if (!row) {
    return json({ ok: false, error: 'template_not_found' }, 404);
  }
  const name = body.name === undefined ? row.name : String(body.name).trim().slice(0, 60);
  if (!name || name.length < 2) {
    return json({ ok: false, error: 'a template needs a name' }, 400);
  }
  let matrix = parseTeamMatrix(row.perm);
  if (body.perm !== undefined) {
    matrix = normalizeTeamMatrix(body.perm);
    if (!matrix) {
      return json({ ok: false, error: 'invalid permission matrix' }, 400);
    }
  }
  await env.DB.prepare(
    'UPDATE cloud_team_templates SET name = ?, perm = ?, updated_at = ? WHERE id = ? AND owner_sub = ?'
  )
    .bind(name, JSON.stringify(matrix), nowIso(), templateId, owner.sub)
    .run();
  return json({ ok: true, template: { id: Number(templateId), name: name, perm: matrix } });
}

// DELETE /api/team/templates/:id
export async function handleTemplatesDelete(request, env, templateId) {
  const owner = await enterpriseOwner(request, env);
  if (!owner) {
    return json({ ok: false, error: 'enterprise_feature', upgradeRequired: 'company' }, 402);
  }
  const row = await env.DB.prepare(
    'SELECT id FROM cloud_team_templates WHERE id = ? AND owner_sub = ?'
  )
    .bind(templateId, owner.sub)
    .first();
  if (!row) {
    return json({ ok: false, error: 'template_not_found' }, 404);
  }
  await env.DB.prepare('DELETE FROM cloud_team_templates WHERE id = ? AND owner_sub = ?')
    .bind(templateId, owner.sub)
    .run();
  return json({ ok: true, deleted: Number(templateId) });
}
