/* ============================================================
   BILLING TIER , LemonSqueezy integration
   ------------------------------------------------------------
   Extracted from worker.js. The tier is DORMANT until configured:
   with none of LEMONSQUEEZY_WEBHOOK_SECRET / LEMONSQUEEZY_API_KEY /
   LEMONSQUEEZY_VARIANT_ID / LEMONSQUEEZY_STORE_ID set, the
   status endpoint reports "not configured", checkout returns 503,
   and the cloud-create gate is OFF.
   ============================================================ */
import { json, readSession, cloudForbidden, codesEqual, authEmailConfigured, sendAuthEmail } from './lib/http.js';

const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';

export function billingConfigured(env) {
  return !!(env && env.LEMONSQUEEZY_WEBHOOK_SECRET && env.LEMONSQUEEZY_API_KEY && env.LEMONSQUEEZY_VARIANT_ID && env.LEMONSQUEEZY_STORE_ID);
}

export function billingFreeCap(env) {
  const v = Number(env && env.FREE_PROJECT_CAP);
  return Number.isFinite(v) && v > 0 ? v : 8;
}

function billingStatusActive(status) {
  return status === 'active' || status === 'on_trial';
}

async function billingVerifySignature(env, rawBody, sigHeader) {
  if (!env || !env.LEMONSQUEEZY_WEBHOOK_SECRET) return false;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LEMONSQUEEZY_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    let hex = '';
    const arr = new Uint8Array(sigBytes);
    for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
    return codesEqual(hex, String(sigHeader || '').toLowerCase());
  } catch (e) { return false; }
}

export async function handleBillingWebhook(request, env) {
  if (!env || !env.LEMONSQUEEZY_WEBHOOK_SECRET) return json({ ok: false, error: 'webhook not configured' }, 503);
  const rawBody = await request.text();
  const sig = request.headers.get('X-Signature') || '';
  if (!(await billingVerifySignature(env, rawBody, sig))) return json({ ok: false, error: 'invalid signature' }, 401);
  let payload;
  try { payload = JSON.parse(rawBody); } catch (e) { return json({ ok: false, error: 'bad payload' }, 400); }
  const meta = (payload && payload.meta) || {};
  const event = String(meta.event_name || '');
  const custom = (meta.custom_data && typeof meta.custom_data === 'object') ? meta.custom_data : {};
  const ownerSub = String(custom.sub || '');
  const lsId = String((payload && payload.data && payload.data.id) || '');
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  const lifecycle = ['subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_expired', 'subscription_paused', 'subscription_resumed'];
  if (lifecycle.indexOf(event) === -1) return json({ ok: true, ignored: event });
  if (!ownerSub || !lsId) return json({ ok: false, error: 'missing owner identity in custom_data' }, 400);
  const status = String(attrs.status || '');
  const periodEndRaw = attrs.renews_at || attrs.ends_at;
  const periodEnd = periodEndRaw ? Math.floor(new Date(periodEndRaw).getTime() / 1000) : null;
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO cloud_subscriptions (owner_sub, ls_subscription_id, status, plan, current_period_end, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ' +
    'ON CONFLICT(owner_sub) DO UPDATE SET ls_subscription_id = excluded.ls_subscription_id, status = excluded.status, ' +
    'current_period_end = excluded.current_period_end, updated_at = excluded.updated_at'
  ).bind(ownerSub, lsId, status, 'pro', periodEnd, now, now).run();
  if (authEmailConfigured(env) && (event === 'subscription_created' || event === 'subscription_cancelled')) {
    const recipient = String(attrs.user_email || '').trim() || (ownerSub.indexOf('email:') === 0 ? ownerSub.slice('email:'.length) : '');
    if (recipient) {
      const confirmed = event === 'subscription_created';
      await sendAuthEmail(env, recipient,
        confirmed ? 'Your My MaNaGeR subscription is confirmed' : 'Your My MaNaGeR subscription was cancelled',
        confirmed
          ? 'Your My MaNaGeR subscription is confirmed and your plan is locked in. Thank you for supporting the project.\n\nIf you have any questions, reply to this email.'
          : 'Your My MaNaGeR subscription has been cancelled. You can resubscribe at any time from your account.');
    }
  }
  return json({ ok: true, event: event, status: status });
}

export async function handleBillingStatus(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const configured = billingConfigured(env);
  const cap = billingFreeCap(env);
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM cloud_projects WHERE google_sub = ?').bind(session.sub).first();
  const projectCount = (cnt && cnt.c) || 0;
  if (!configured) return json({ ok: true, configured: false, plan: 'free', active: false, projectCap: null, projectCount: projectCount });
  const sub = await env.DB.prepare('SELECT status, plan, current_period_end FROM cloud_subscriptions WHERE owner_sub = ?').bind(session.sub).first();
  const active = !!(sub && billingStatusActive(sub.status));
  return json({
    ok: true, configured: true, plan: active ? (sub.plan || 'pro') : 'free', active: active,
    currentPeriodEnd: (sub && sub.current_period_end) || null, projectCap: cap, projectCount: projectCount
  });
}

export async function handleBillingCheckout(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  if (!billingConfigured(env)) return json({ ok: false, error: 'billing not configured' }, 503);
  try {
    const variantId = Number(env.LEMONSQUEEZY_VARIANT_ID);
    const res = await fetch(LS_API_BASE + '/checkouts', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': 'Bearer ' + env.LEMONSQUEEZY_API_KEY
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: { email: session.email || '', custom: { sub: session.sub } },
            product_options: { enabled_variants: [variantId] }
          },
          relationships: {
            store: { data: { type: 'stores', id: String(env.LEMONSQUEEZY_STORE_ID) } },
            variant: { data: { type: 'variants', id: String(env.LEMONSQUEEZY_VARIANT_ID) } }
          }
        }
      })
    });
    const data = await res.json().catch(function() { return {}; });
    const url = data && data.data && data.data.attributes && data.data.attributes.url;
    if (!res.ok || !url) {
      let detail = '';
      try {
        const err = (data && data.errors && data.errors[0]) || {};
        detail = String(err.detail || err.title || '').slice(0, 300);
      } catch (e) { /* keep detail empty */ }
      return json({ ok: false, error: 'checkout creation failed (LemonSqueezy HTTP ' + res.status + ')' + (detail ? ' , ' + detail : '') }, 502);
    }
    return json({ ok: true, checkoutUrl: url });
  } catch (e) {
    return json({ ok: false, error: 'checkout creation failed (upstream unreachable)' }, 502);
  }
}
