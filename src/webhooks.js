/* ============================================================
   WEBHOOKS , subscription CRUD, HMAC delivery, cron evaluation
   ------------------------------------------------------------
   Extracted from worker.js. Owner-gated webhook subscriptions
   with HMAC-SHA256 signed delivery for health_dropped and
   weather_risk_tomorrow events.
   ============================================================ */
import { json, cloudForbidden, cloudAuthOwnerEither, readCloudBody, cloudReadState } from './lib/http.js';
import { apiPortfolio } from './api/shapes.js';

// ---- events + crypto -----------------------------------------------------

export const WEBHOOK_EVENTS = ['health_dropped', 'weather_risk_tomorrow'];

async function webhookCryptoSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- owner-gated CRUD ----------------------------------------------------

export async function handleWebhookCreate(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const event = String(read.body.event || '').trim();
  const targetUrl = String(read.body.targetUrl || '').trim();
  if (WEBHOOK_EVENTS.indexOf(event) === -1) return json({ ok: false, error: 'unknown event , use health_dropped or weather_risk_tomorrow' }, 400);
  let u;
  try { u = new URL(targetUrl); } catch (e) { return json({ ok: false, error: 'targetUrl must be a valid URL' }, 400); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return json({ ok: false, error: 'targetUrl must be http(s)' }, 400);
  const secret = await webhookCryptoSecret();
  const now = new Date().toISOString();
  const res = await env.DB.prepare('INSERT INTO webhook_subscriptions (project_id, event, target_url, secret, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(projectId, event, targetUrl, secret, now).run();
  return json({ ok: true, id: res.meta.last_row_id, event: event, targetUrl: targetUrl, secret: secret, created: true });
}

export async function handleWebhookList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare('SELECT id, project_id, event, target_url, enabled, last_fired_at, created_at FROM webhook_subscriptions WHERE project_id = ? ORDER BY id').bind(projectId).all();
  // The secret is NEVER returned after creation (shown once at create).
  return json({ ok: true, webhooks: (rows.results || []).map(r => ({ id: r.id, event: r.event, targetUrl: r.target_url, enabled: !!r.enabled, lastFiredAt: r.last_fired_at || null, createdAt: r.created_at })) });
}

export async function handleWebhookDelete(request, env, projectId, subId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const res = await env.DB.prepare('DELETE FROM webhook_subscriptions WHERE id = ? AND project_id = ?').bind(Number(subId) || 0, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'webhook not found' }, 404);
  return json({ ok: true, deleted: true });
}

// ---- delivery: HMAC-SHA256 signature + POST -------------------------------

async function webhookDeliver(env, sub, payload) {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(sub.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const sig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  try {
    const res = await fetch(sub.target_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MMGR-Signature': 'sha256=' + sig, 'User-Agent': 'My-MaNaGeR-Rank9/1.0' },
      body: body,
      signal: AbortSignal.timeout(10000)
    });
    return { delivered: true, status: res.status };
  } catch (e) {
    return { delivered: false, error: (e && e.message) || 'delivery failed' };
  }
}

// ---- scheduled evaluator (called from the cron) ---------------------------
// Reads the state snapshot for every project with enabled subscriptions and
// fires the matching event. Failures are logged, never surfaced.

export async function evaluateWebhooks(env) {
  const rows = await env.DB.prepare('SELECT * FROM webhook_subscriptions WHERE enabled = 1').all();
  const subs = rows.results || [];
  if (!subs.length) return { checked: 0, fired: [] };
  const fired = [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const seen = {};
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    try {
      const row = await env.DB.prepare('SELECT latest_r2_key, owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?').bind(sub.project_id).first();
      const state = row && row.latest_r2_key ? await cloudReadState(env, row.latest_r2_key, row.owner_code_hash, row.owner_code_salt) : null;
      if (!state) continue;
      let fire = false; let payload = null;
      if (sub.event === 'health_dropped') {
        const p = apiPortfolio(state);
        if (p.available) {
          const prev = sub.last_value !== null && sub.last_value !== undefined ? +sub.last_value : null;
          if (prev !== null && p.healthScore < prev) {
            fire = true;
            payload = { event: 'health_dropped', projectId: sub.project_id, at: new Date().toISOString(), previousScore: prev, currentScore: p.healthScore };
          }
          await env.DB.prepare('UPDATE webhook_subscriptions SET last_value = ? WHERE id = ?').bind(String(p.healthScore), sub.id).run();
        }
      } else if (sub.event === 'weather_risk_tomorrow') {
        if (sub.last_fired_at !== todayKey) {
          const cache = state.wxCache;
          const days = (cache && Array.isArray(cache.days)) ? cache.days : [];
          const tm = new Date(Date.now() + 86400000);
          const tmKey = tm.toISOString().slice(0, 10);
          const day = days.find(d => String(d.date).slice(0, 10) === tmKey);
          if (day && ((+day.precip || 0) >= 60 || (+day.tMax || 0) >= 32 || (+day.tMin || 0) <= 0)) {
            fire = true;
            payload = { event: 'weather_risk_tomorrow', projectId: sub.project_id, at: new Date().toISOString(), date: tmKey, precip: +day.precip || 0, tMax: +day.tMax || 0, tMin: +day.tMin || 0 };
          }
        }
        if (fire || sub.last_fired_at !== todayKey) {
          await env.DB.prepare('UPDATE webhook_subscriptions SET last_fired_at = ? WHERE id = ?').bind(todayKey, sub.id).run();
        }
      }
      if (fire && payload) {
        const outcome = await webhookDeliver(env, sub, payload);
        fired.push({ id: sub.id, event: sub.event, projectId: sub.project_id, outcome: outcome });
      }
      seen[sub.id] = true;
    } catch (e) {
      console.error('rank9 webhook eval failed for sub ' + sub.id + ':', e && e.message);
    }
  }
  return { checked: Object.keys(seen).length, fired: fired };
}
