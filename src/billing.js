/* ============================================================
   BILLING TIER - dual provider seam (Paddle target, 2026-10-01)
   ------------------------------------------------------------
   Owner directive 2026-10-01: LemonSqueezy does not support
   Jamaica-based sellers; Paddle does (paddle.com supported-
   countries list excludes only sanctioned countries - Jamaica is
   not on it) and charges per transaction with no setup/monthly
   fee. This module now carries BOTH providers behind the SAME
   routes (/api/billing/status|checkout|webhook) and the SAME
   entitlement table (cloud_subscriptions), so the client Upgrade
   flow is untouched and the swap is a secrets change, not a
   code change:

     - PADDLE_WEBHOOK_SECRET + PADDLE_API_KEY + PADDLE_PRICE_ID
       set            -> provider 'paddle' (preferred when both)
     - else the four LEMONSQUEEZY_* secrets set -> 'lemonsqueezy'
     - neither -> DORMANT: status configured:false, checkout 503,
       and the cloud-create cap is OFF (byte-for-byte unchanged).

   Retiring LemonSqueezy later = `wrangler secret delete` the four
   LEMONSQUEEZY_* secrets (or leave them and Paddle simply wins).

   Paddle specifics (verified against developer.paddle.com, do not
   guess): webhook signature is the `Paddle-Signature` header
   `ts=<unix>;h1=<hex>` (more than one h1 can appear during secret
   rotation - accept any match); the signed payload is
   `ts + ':' + rawBody` with the raw body byte-identical; HMAC is
   SHA-256 keyed with the notification destination's secret key;
   SDKs reject a timestamp older than 5 seconds (Paddle retries
   rejected deliveries, so strictness is safe here). Checkout is a
   POST /transactions ({items:[{price_id, quantity}], custom_data})
   whose response carries `checkout.url`; find-or-create the
   customer by email first so the checkout carries the account
   email. transaction.custom_data flows to the subscription, so
   the webhook maps `custom_data.sub` back to the owner identity.
   ============================================================ */
import {
  json,
  readSession,
  provenEmail,
  cloudForbidden,
  codesEqual,
  authEmailConfigured,
  sendAuthEmail
} from './lib/http.js';

const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';
const PADDLE_API_BASE = 'https://api.paddle.com';
const PADDLE_SANDBOX_BASE = 'https://sandbox-api.paddle.com';
// Paddle SDK default tolerance for the webhook timestamp; deliveries that
// fail verification are retried by Paddle, so a tight window is safe.
const PADDLE_TS_TOLERANCE_SEC = 5;

// 5.2 (orphaned-subscription cleanup, owner 2026-11-01): the Paddle API root,
// resolved in ONE place so a cancel path can be proven instead of trusted.
//
// The override is loopback-only BY CONSTRUCTION: only an absolute http(s) URL
// whose host is 127.0.0.1, localhost or [::1] is honoured, and everything else
// falls back to the real base. A request can never set an env var, and even the
// deployer cannot make this send PADDLE_API_KEY to a remote host, so the seam
// that lets a gate stub Paddle can never become a credential leak.
const LOOPBACK_API_BASE = /^(https?:\/\/)(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export function paddleApiBase(env) {
  const raw =
    env && typeof env.PADDLE_API_BASE === 'string'
      ? env.PADDLE_API_BASE.trim().replace(/\/+$/, '')
      : '';
  if (raw && LOOPBACK_API_BASE.test(raw)) {
    return raw;
  }
  const sandbox = env && String(env.PADDLE_ENV || '') === 'sandbox';
  return sandbox ? PADDLE_SANDBOX_BASE : PADDLE_API_BASE;
}

// Which provider (if any) this deployment is configured for. Paddle wins
// when both sets exist - that is the migration direction (LS -> Paddle).
export function billingProvider(env) {
  if (env && env.PADDLE_WEBHOOK_SECRET && env.PADDLE_API_KEY && env.PADDLE_PRICE_ID) {
    return 'paddle';
  }
  if (
    env &&
    env.LEMONSQUEEZY_WEBHOOK_SECRET &&
    env.LEMONSQUEEZY_API_KEY &&
    env.LEMONSQUEEZY_VARIANT_ID &&
    env.LEMONSQUEEZY_STORE_ID
  ) {
    return 'lemonsqueezy';
  }
  return null;
}

export function billingConfigured(env) {
  return !!billingProvider(env);
}

export function billingFreeCap(env) {
  const v = Number(env && env.FREE_PROJECT_CAP);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

// Maps a Paddle price ID to a tier string. Falls back to 'contractor' for
// any unrecognised ID so existing subscribers are never downgraded by mistake.
//
// ESTIMATOR (owner 2026-10-07): the homeowner plan IS the estimator plan - a
// six-month subscription at $49.99, for a homeowner running their own build.
// The tier string is 'estimator'. PADDLE_HOMEOWNER_PRICE_ID is still read as an
// ALIAS so a subscription bought before the rename (or an in-flight checkout
// on an old link) still resolves to the same plan instead of quietly falling
// back to contractor - an alias that changed entitlements would be a silent
// downgrade, which is the one thing this function must never do.
// Plan order for an in-place change. Only a move UP (or a lateral move to a
// different product) is applied immediately; a lower plan is refused with a
// clear message instead of silently stripping paid features mid-period.
export const TIER_RANK = { contractor: 1, estimator: 2, company: 3, enterprise: 4 };

export function deriveTier(priceId, env) {
  if (!priceId || !env) {
    return 'contractor';
  }
  if (env.PADDLE_ENTERPRISE_PRICE_ID && priceId === String(env.PADDLE_ENTERPRISE_PRICE_ID)) {
    return 'enterprise';
  }
  if (env.PADDLE_COMPANY_PRICE_ID && priceId === String(env.PADDLE_COMPANY_PRICE_ID)) {
    return 'company';
  }
  if (env.PADDLE_ESTIMATOR_PRICE_ID && priceId === String(env.PADDLE_ESTIMATOR_PRICE_ID)) {
    return 'estimator';
  }
  if (env.PADDLE_HOMEOWNER_PRICE_ID && priceId === String(env.PADDLE_HOMEOWNER_PRICE_ID)) {
    return 'estimator';
  }
  return 'contractor';
}

// D1 (2026-10-06): a failed payment keeps entitlement while Paddle retries,
// so 'past_due' counts as active. Exported so the cloud layer can gate
// tier-dependent features (RBAC member caps) on the SAME rule.
export function billingStatusActive(status) {
  return status === 'active' || status === 'on_trial' || status === 'past_due';
}

// UI-IA Phase 5 (2026-11-12): "active" is not the whole question. A cancel
// scheduled for the end of a paid period (or a status Paddle already flipped
// to 'canceled' while the period still runs) must keep every paid feature
// until that moment - the owner paid for it. Every entitlement reader uses
// this, not billingStatusActive alone, so the badge, the project cap, photos,
// team templates and the AI relay cannot disagree about who is paid.
// cancel_at and current_period_end are epoch SECONDS; nowSec is optional so a
// caller (and a test) can pin the clock.
export function subscriptionActive(row, nowSec) {
  if (!row) {
    return false;
  }
  if (billingStatusActive(row.status)) {
    return true;
  }
  const status = String(row.status || '');
  if (status !== 'canceled' && status !== 'cancelled') {
    return false;
  }
  const until = Number(row.cancel_at) || Number(row.current_period_end) || 0;
  const now = Number.isFinite(Number(nowSec)) ? Number(nowSec) : Math.floor(Date.now() / 1000);
  return until > now;
}

// D1 stores current_period_end as epoch SECONDS. JavaScript's Date() takes
// MILLISECONDS, so handing the stored number to the browser made it render
// 1794154608 (Nov 8, 2026) as 1794154608 ms = "Jan 21, 1970". Every date that
// leaves the API is an ISO-8601 UTC string instead - one format, no unit to
// get wrong. A missing or non-positive value is null, never 1970.
export function periodEndIso(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return new Date(n * 1000).toISOString();
}

function hmacHex(secret, payload) {
  return crypto.subtle
    .importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign'
    ])
    .then(function (key) {
      return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    })
    .then(function (sigBytes) {
      let hex = '';
      const arr = new Uint8Array(sigBytes);
      for (let i = 0; i < arr.length; i++) {
        hex += arr[i].toString(16).padStart(2, '0');
      }
      return hex;
    });
}

// ---- LemonSqueezy (legacy provider, kept until the owner retires it) ------

async function lsVerifySignature(env, rawBody, sigHeader) {
  if (!env || !env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    return false;
  }
  try {
    const hex = await hmacHex(env.LEMONSQUEEZY_WEBHOOK_SECRET, rawBody);
    return codesEqual(hex, String(sigHeader || '').toLowerCase());
  } catch (e) {
    return false;
  }
}

async function lsApplyWebhook(env, rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return json({ ok: false, error: 'bad payload' }, 400);
  }
  const meta = (payload && payload.meta) || {};
  const event = String(meta.event_name || '');
  const custom = meta.custom_data && typeof meta.custom_data === 'object' ? meta.custom_data : {};
  const ownerSub = String(custom.sub || '');
  const lsId = String((payload && payload.data && payload.data.id) || '');
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  const lifecycle = [
    'subscription_created',
    'subscription_updated',
    'subscription_cancelled',
    'subscription_expired',
    'subscription_paused',
    'subscription_resumed'
  ];
  if (lifecycle.indexOf(event) === -1) {
    return json({ ok: true, ignored: event });
  }
  if (!ownerSub || !lsId) {
    return json({ ok: false, error: 'missing owner identity in custom_data' }, 400);
  }
  const status = String(attrs.status || '');
  const periodEndRaw = attrs.renews_at || attrs.ends_at;
  const periodEnd = periodEndRaw ? Math.floor(new Date(periodEndRaw).getTime() / 1000) : null;
  // Legacy LS subscribers stay on Contractor - the equivalent of the old 'pro'.
  const lsApplied = await applySubscription(env, ownerSub, lsId, status, 'contractor', periodEnd);
  if (
    lsApplied &&
    authEmailConfigured(env) &&
    (event === 'subscription_created' || event === 'subscription_cancelled')
  ) {
    const recipient =
      String(attrs.user_email || '').trim() ||
      (ownerSub.indexOf('email:') === 0 ? ownerSub.slice('email:'.length) : '');
    await subEmailNotice(env, recipient, event === 'subscription_created');
  }
  return json({ ok: true, event: event, status: status });
}

// ---- Paddle (target provider - framework ships first, incorporation is a
// dashboard + secrets task: create the notification destination pointing at
// /api/billing/webhook, set the three PADDLE_* secrets, done) ---------------

async function paddleVerifySignature(env, rawBody, sigHeader) {
  if (!env || !env.PADDLE_WEBHOOK_SECRET) {
    return false;
  }
  try {
    // Paddle-Signature: ts=<unix>;h1=<hex>[;h1=<hex>...] (rotation). Ignore
    // unknown parts; a header without ts or without any h1 never verifies.
    const parts = String(sigHeader || '')
      .split(';')
      .map(function (p) {
        const i = p.indexOf('=');
        return i === -1 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)];
      });
    const tsPart = parts
      .filter(function (p) {
        return p[0] === 'ts';
      })
      .map(function (p) {
        return p[1];
      })[0];
    const h1s = parts
      .filter(function (p) {
        return p[0] === 'h1' && p[1];
      })
      .map(function (p) {
        return p[1].toLowerCase();
      });
    if (!tsPart || !h1s.length) {
      return false;
    }
    const ts = parseInt(tsPart, 10);
    if (!Number.isFinite(ts)) {
      return false;
    }
    if (Math.abs(Date.now() / 1000 - ts) > PADDLE_TS_TOLERANCE_SEC) {
      return false;
    }
    const hex = await hmacHex(env.PADDLE_WEBHOOK_SECRET, ts + ':' + rawBody);
    return h1s.some(function (h) {
      return codesEqual(hex, h);
    });
  } catch (e) {
    return false;
  }
}

// Paddle statuses -> the stored vocabulary billingStatusActive() reads.
// 'trialing' means the same thing LS's 'on_trial' meant: a paying seat in
// its trial window.
function paddleStatus(raw) {
  return String(raw || '') === 'trialing' ? 'on_trial' : String(raw || '');
}

async function paddleApplyWebhook(env, rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return json({ ok: false, error: 'bad payload' }, 400);
  }
  const event = String((payload && payload.event_type) || '');
  const data = (payload && payload.data) || {};
  const custom = data.custom_data && typeof data.custom_data === 'object' ? data.custom_data : {};
  const ownerSub = String(custom.sub || '');
  const pdId = String(data.id || '');
  // Paddle's event names, verified against the notification-destination event
  // list (developer.paddle.com/webhooks/subscriptions/...). This array used to
  // read 'subscription.trialed', which Paddle never emits - the real event is
  // 'subscription.trialing' (its own doc page is .../subscription-trialing).
  // Because the mismatch fell through to the `ignored` branch below and returned
  // 200, a trial signup wrote NO row and Paddle saw success and never retried:
  // a paid trial silently granted nothing, with no error on either side.
  const lifecycle = [
    'subscription.created',
    'subscription.activated',
    'subscription.resumed',
    'subscription.updated',
    'subscription.trialing',
    'subscription.paused',
    'subscription.past_due',
    'subscription.canceled'
  ];
  if (lifecycle.indexOf(event) === -1 && event !== 'transaction.completed') {
    return json({ ok: true, ignored: event });
  }
  // A subscription's own transactions (first charge AND every renewal) must
  // never write the entitlement row: they carry no billing period and a
  // transaction id, so a renewal used to overwrite the real subscription id
  // and wipe current_period_end. The subscription.* events own entitlement;
  // only a ONE-TIME purchase (no subscription_id) is granted from here.
  if (event === 'transaction.completed' && data.subscription_id) {
    return json({ ok: true, ignored: 'subscription transaction' });
  }
  if (!ownerSub || !pdId) {
    // No owner identity means the event did not originate from OUR checkout (a
    // dashboard-made subscription, a test fire). Answering 400 makes Paddle
    // retry it for days; acknowledge it and leave a trace for `wrangler tail`.
    console.warn('paddle webhook acknowledged without owner identity: ' + event + ' ' + pdId);
    return json({ ok: true, ignored: 'no owner identity', event: event });
  }
  // Paddle does not guarantee delivery order. Stamp the row with WHEN the
  // event happened, so applySubscription can refuse an older event arriving late.
  let occurredAt = new Date().toISOString();
  try {
    if (payload && payload.occurred_at) {
      occurredAt = new Date(payload.occurred_at).toISOString();
    }
  } catch (e) {
    /* keep now */
  }
  let status,
    periodEnd = null,
    cancelAt = null;
  if (event === 'transaction.completed') {
    // One-time purchase: grant a tier with no period end (nothing renews).
    status = 'active';
  } else {
    status = paddleStatus(data.status);
    const endRaw = data.current_billing_period && data.current_billing_period.ends_at;
    if (endRaw) {
      periodEnd = Math.floor(new Date(endRaw).getTime() / 1000);
    }
    // A scheduled cancel is part of the subscription's state. Persist WHEN it
    // takes effect; every other event (a resume, a plan change, a fresh
    // subscription) carries no cancel and therefore clears the column.
    const sched = data.scheduled_change;
    if (sched && sched.action === 'cancel' && sched.effective_at) {
      const at = new Date(sched.effective_at).getTime();
      if (Number.isFinite(at)) {
        cancelAt = Math.floor(at / 1000);
      }
    }
  }
  // Paddle events carry items[0].price.id on subscription and transaction
  // events; the price ID is what names the tier, never a hardcoded 'pro'.
  const priceId =
    (data && data.items && data.items[0] && data.items[0].price && data.items[0].price.id) || null;
  const tier = deriveTier(priceId, env);
  const applied = await applySubscription(
    env,
    ownerSub,
    pdId,
    status,
    tier,
    periodEnd,
    cancelAt,
    occurredAt
  );
  if (
    applied &&
    authEmailConfigured(env) &&
    (event === 'subscription.activated' || event === 'subscription.canceled')
  ) {
    const recipient = ownerSub.indexOf('email:') === 0 ? ownerSub.slice('email:'.length) : '';
    await subEmailNotice(env, recipient, event === 'subscription.activated');
  }
  return json({ ok: true, event: event, status: status });
}

// ---- shared entitlement write + notice (the ONLY writers, both webhook-only)

async function applySubscription(
  env,
  ownerSub,
  providerSubId,
  status,
  tier,
  periodEnd,
  cancelAt,
  occurredAt
) {
  const now = occurredAt || new Date().toISOString();
  // D1 refuses `undefined` binds. The LemonSqueezy path (and any caller that
  // predates a scheduled cancel) has no cancelAt, so normalise every optional
  // epoch to null here rather than trusting each caller to remember.
  const periodEndSec =
    Number.isFinite(Number(periodEnd)) && Number(periodEnd) > 0 ? Number(periodEnd) : null;
  const cancelAtSec =
    Number.isFinite(Number(cancelAt)) && Number(cancelAt) > 0 ? Number(cancelAt) : null;
  // ONE ROW PER OWNER, so an event about a DIFFERENT subscription must not
  // strip the one the owner is actually paying for: cancelling an old/duplicate
  // subscription in the Paddle dashboard fires subscription.canceled for the
  // OLD id, and without this check it overwrote the row and revoked Premium
  // on the live one. An inactive event for a non-current id is acknowledged
  // and ignored. (Active-vs-active still lets the latest win, with a warning.)
  const prior = await env.DB.prepare(
    'SELECT ls_subscription_id, status FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(ownerSub)
    .first();
  if (prior && prior.ls_subscription_id && prior.ls_subscription_id !== providerSubId) {
    if (billingStatusActive(prior.status) && !billingStatusActive(status)) {
      console.warn(
        'billing: ignored ' +
          status +
          ' event for ' +
          providerSubId +
          ' - the owner row holds the active subscription ' +
          prior.ls_subscription_id
      );
      return false;
    }
    if (billingStatusActive(prior.status) && billingStatusActive(status)) {
      console.warn(
        'billing: owner now has two active subscriptions: ' +
          prior.ls_subscription_id +
          ' and ' +
          providerSubId +
          ' - the older one is no longer reachable from the app'
      );
    }
  }
  // ls_subscription_id holds the provider's subscription/transaction id for
  // whichever provider wrote the row (one row per owner, latest wins).
  // plan AND tier both carry the tier string: `plan` is the historical column
  // every reader already used, `tier` is the migration-0023 column the cloud
  // layer reads. They are written together so neither can silently drift.
  await env.DB.prepare(
    'INSERT INTO cloud_subscriptions (owner_sub, ls_subscription_id, status, plan, tier, current_period_end, cancel_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(owner_sub) DO UPDATE SET ls_subscription_id = excluded.ls_subscription_id, status = excluded.status, ' +
      'plan = excluded.plan, tier = excluded.tier, ' +
      'current_period_end = excluded.current_period_end, cancel_at = excluded.cancel_at, updated_at = excluded.updated_at ' +
      'WHERE excluded.updated_at >= cloud_subscriptions.updated_at'
  )
    .bind(ownerSub, providerSubId, status, tier, tier, periodEndSec, cancelAtSec, now, now)
    .run();
  return true;
}

async function subEmailNotice(env, recipient, confirmed) {
  if (!recipient) {
    return;
  }
  try {
    await sendAuthEmail(
      env,
      recipient,
      confirmed
        ? 'Your My MaNaGeR subscription is confirmed'
        : 'Your My MaNaGeR subscription was cancelled',
      confirmed
        ? 'Your My MaNaGeR subscription is confirmed and your plan is locked in. Thank you for supporting the project.\n\nIf you have any questions, reply to this email.'
        : 'Your My MaNaGeR subscription has been cancelled. You can resubscribe at any time from your account.'
    );
  } catch (e) {
    /* a notification must never fail the webhook */
  }
}

// ---- webhook route: the signature HEADER names the provider ---------------

export async function handleBillingWebhook(request, env) {
  const rawBody = await request.text();
  const sigPaddle = request.headers.get('Paddle-Signature');
  const sigLS = request.headers.get('X-Signature');
  if (sigPaddle) {
    // Wave 8.13: an unauthenticated webhook is an AUTH failure (401), not a
    // transient server problem (503). A 503 tells the provider to retry for
    // days against a destination that can never succeed.
    if (!env || !env.PADDLE_WEBHOOK_SECRET) {
      return json({ ok: false, error: 'webhook not configured' }, 401);
    }
    if (!(await paddleVerifySignature(env, rawBody, sigPaddle))) {
      return json({ ok: false, error: 'invalid signature' }, 401);
    }
    return paddleApplyWebhook(env, rawBody);
  }
  if (sigLS) {
    // Wave 8.13: same rule for a legacy delivery to a retired destination.
    if (!env || !env.LEMONSQUEEZY_WEBHOOK_SECRET) {
      return json({ ok: false, error: 'webhook not configured' }, 401);
    }
    if (!(await lsVerifySignature(env, rawBody, sigLS))) {
      return json({ ok: false, error: 'invalid signature' }, 401);
    }
    return lsApplyWebhook(env, rawBody);
  }
  return json({ ok: false, error: 'invalid signature' }, 401);
}

// ---- status -----------------------------------------------------------------

export async function handleBillingStatus(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return cloudForbidden();
  }
  const provider = billingProvider(env);
  const cap = billingFreeCap(env);
  // CLOUD IDENTITY (plan 5.1): the reported count must be the number the
  // create route refuses on, or the panel says "2 of 5" while the sixth
  // publish is rejected. Same sub-or-verified-address rule as the list.
  const countEmail = await provenEmail(session, env);
  const cnt = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM cloud_projects WHERE google_sub = ? OR owner_email = ?'
  )
    .bind(session.sub, countEmail || '')
    .first();
  const projectCount = (cnt && cnt.c) || 0;
  if (!provider) {
    return json({
      ok: true,
      configured: false,
      plan: 'free',
      active: false,
      projectCap: null,
      projectCount: projectCount
    });
  }
  const sub = await env.DB.prepare(
    'SELECT status, plan, tier, current_period_end, cancel_at FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(session.sub)
    .first();
  const nowSec = Math.floor(Date.now() / 1000);
  const active = !!(sub && subscriptionActive(sub, nowSec));
  // A cancel that has not taken effect yet: the owner keeps Premium, the panel
  // must not offer a second Cancel, and it should say when access ends.
  const cancelAtSec = Number(sub && sub.cancel_at) || 0;
  const statusNow = String((sub && sub.status) || '');
  const periodEndSec = Number(sub && sub.current_period_end) || 0;
  const canceling = !!(
    active &&
    (cancelAtSec > nowSec ||
      ((statusNow === 'canceled' || statusNow === 'cancelled') && periodEndSec > nowSec))
  );
  const cancelAtIso = periodEndIso(canceling ? cancelAtSec || periodEndSec : cancelAtSec);
  // OWNER 2026-10-09 (L11): free = exactly the free cap (one linked project),
  // and EVERY paid tier - estimator included - is unlimited. This used to
  // report the free cap for every tier including paying ones, which is what
  // forced the client gate to become contractor-only for a while. The create
  // gate in src/cloud/projects.js already allowed any ACTIVE subscription
  // past the cap, so the two now say the same thing: null means unlimited.
  // A paid subscription is not metered by plan name here, deliberately - a
  // tier we do not recognise must still be unlimited rather than silently
  // capped at one project for someone who is paying.
  return json({
    ok: true,
    configured: true,
    provider: provider,
    plan: active ? sub.tier || sub.plan || 'contractor' : 'free',
    active: active,
    canceling: canceling,
    cancelAt: cancelAtIso,
    currentPeriodEnd: periodEndIso(sub && sub.current_period_end),
    projectCap: active ? null : cap,
    projectCount: projectCount
  });
}

// ---- checkout ----------------------------------------------------------------

async function paddleCheckout(env, session, priceId, tierParam) {
  // PADDLE_ENV is an explicit var in wrangler.jsonc, not an accident of
  // absence: 'sandbox' or 'live', defaulting to live when unset or unreadable.
  // The two Paddle catalogs are SEPARATE - a sandbox price ID does not exist
  // against the live API and vice versa - so a mismatch has to be diagnosable
  // rather than surfacing as a bare 502.
  const sandbox = String(env.PADDLE_ENV || '') === 'sandbox';
  const base = paddleApiBase(env);
  const auth = {
    Authorization: 'Bearer ' + env.PADDLE_API_KEY,
    'Content-Type': 'application/json'
  };
  try {
    // Find-or-create the customer by email so the hosted checkout carries the
    // account email; if the lookup path fails the checkout still opens and
    // Paddle collects the email at payment time.
    const email = String(session.email || '').trim();
    let customerId = null;
    if (email) {
      const q = await fetch(base + '/customers?per_page=1&email=' + encodeURIComponent(email), {
        headers: auth
      });
      const qd = await q.json().catch(function () {
        return {};
      });
      const found = qd && qd.data && qd.data[0] && qd.data[0].id;
      if (found) {
        customerId = String(found);
      } else {
        const c = await fetch(base + '/customers', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ email: email })
        });
        const cd = await c.json().catch(function () {
          return {};
        });
        if (c.ok && cd && cd.data && cd.data.id) {
          customerId = String(cd.data.id);
        }
      }
    }
    const body = {
      items: [{ quantity: 1, price_id: priceId }],
      custom_data: { sub: session.sub, tier: tierParam }
    };
    if (customerId) {
      body.customer_id = customerId;
    }
    const res = await fetch(base + '/transactions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(function () {
      return {};
    });
    const url = data && data.data && data.data.checkout && data.data.checkout.url;
    if (!res.ok || !url) {
      let detail = '';
      try {
        const err = (data && data.error) || {};
        const sub = (err.errors && err.errors[0]) || {};
        detail = String(sub.detail || err.detail || err.code || '').slice(0, 300);
      } catch (e) {
        /* keep detail empty */
      }
      // A price the catalog does not hold is almost always the live/sandbox
      // split, and it is the failure the owner will hit first when testing.
      // Say so instead of leaving a bare HTTP code to decode.
      let hint = '';
      if (res.status === 404 || (res.status === 400 && /invalid request/i.test(detail))) {
        hint =
          ' - the price was rejected by the ' +
          (sandbox ? 'SANDBOX' : 'LIVE') +
          ' API. Paddle keeps the two catalogs separate, so PADDLE_PRICE_ID, PADDLE_API_KEY and this ' +
          "deployment's PADDLE_ENV must all come from the same one. A sandbox price is invisible to the live API.";
      } else if (res.status === 401 || res.status === 403) {
        hint =
          ' - Paddle rejected the API key for the ' +
          (sandbox ? 'sandbox' : 'live') +
          ' API. A sandbox key cannot sign live requests and the reverse.';
      }
      return json(
        {
          ok: false,
          error:
            'checkout creation failed (Paddle HTTP ' +
            res.status +
            ')' +
            hint +
            (detail ? ' , ' + detail : '')
        },
        502
      );
    }
    return json({ ok: true, checkoutUrl: url });
  } catch (e) {
    return json({ ok: false, error: 'checkout creation failed (upstream unreachable)' }, 502);
  }
}

async function lsCheckout(env, session) {
  try {
    const variantId = Number(env.LEMONSQUEEZY_VARIANT_ID);
    const res = await fetch(LS_API_BASE + '/checkouts', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: 'Bearer ' + env.LEMONSQUEEZY_API_KEY
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
    const data = await res.json().catch(function () {
      return {};
    });
    const url = data && data.data && data.data.attributes && data.data.attributes.url;
    if (!res.ok || !url) {
      let detail = '';
      try {
        const err = (data && data.errors && data.errors[0]) || {};
        detail = String(err.detail || err.title || '').slice(0, 300);
      } catch (e) {
        /* keep detail empty */
      }
      return json(
        {
          ok: false,
          error:
            'checkout creation failed (LemonSqueezy HTTP ' +
            res.status +
            ')' +
            (detail ? ' , ' + detail : '')
        },
        502
      );
    }
    return json({ ok: true, checkoutUrl: url });
  } catch (e) {
    return json({ ok: false, error: 'checkout creation failed (upstream unreachable)' }, 502);
  }
}

// ---- upgrade an existing subscription (UI-IA Phase 5, owner 2026-11-12) -----
// The owner's rule: a paying subscriber who picks another plan gets THAT plan,
// not a second subscription. Paddle changes a subscription's items in place:
//   PATCH /subscriptions/{id} { items:[{price_id, quantity}],
//                               proration_billing_mode:'prorated_immediately' }
// If a cancel is already scheduled, it is cleared first (PATCH
// { scheduled_change: null }) - otherwise the plan would change and then still
// end at the period boundary the owner had asked to cancel. Two PATCHes, in
// that order, and the second is the one that moves the money.
async function paddleUpgrade(env, session, held, priceId, tierParam, nowSec) {
  const sandbox = String(env.PADDLE_ENV || '') === 'sandbox';
  const base = paddleApiBase(env);
  const auth = {
    Authorization: 'Bearer ' + env.PADDLE_API_KEY,
    'Content-Type': 'application/json'
  };
  const subId = String(held.ls_subscription_id || '');
  try {
    if (Number(held.cancel_at) > nowSec) {
      const clear = await fetch(base + '/subscriptions/' + encodeURIComponent(subId), {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ scheduled_change: null })
      });
      if (!clear.ok) {
        const cd = await clear.json().catch(function () {
          return {};
        });
        let detail = '';
        try {
          const err = (cd && cd.error) || {};
          const first = (err.errors && err.errors[0]) || {};
          detail = String(first.detail || err.detail || err.code || '').slice(0, 300);
        } catch (e) {
          /* keep empty */
        }
        console.warn(
          'billing upgrade: could not clear the scheduled cancel, subId=' +
            subId +
            ' env=' +
            (sandbox ? 'sandbox' : 'live') +
            ' http=' +
            clear.status
        );
        return json(
          {
            ok: false,
            error:
              'upgrade failed: the scheduled cancel could not be cleared (Paddle HTTP ' +
              clear.status +
              ')' +
              (detail ? ' , ' + detail : '')
          },
          502
        );
      }
    }
    const res = await fetch(base + '/subscriptions/' + encodeURIComponent(subId), {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        proration_billing_mode: 'prorated_immediately'
      })
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      let detail = '';
      let code = '';
      try {
        const err = (data && data.error) || {};
        const first = (err.errors && err.errors[0]) || {};
        detail = String(first.detail || err.detail || err.code || '').slice(0, 300);
        code = String(err.code || '');
      } catch (e) {
        /* keep empty */
      }
      console.warn(
        'billing upgrade failed: subId=' +
          subId +
          ' env=' +
          (sandbox ? 'sandbox' : 'live') +
          ' http=' +
          res.status +
          ' code=' +
          code +
          ' detail=' +
          detail
      );
      return json(
        {
          ok: false,
          error:
            'upgrade failed (Paddle HTTP ' +
            res.status +
            (code ? ', code ' + code : '') +
            ')' +
            (detail ? ' , ' + detail : '')
        },
        502
      );
    }
    const next = (data && data.data) || {};
    const nextStatus = String(next.status || 'active');
    // Reflect the change now so the panel and the next page load agree with
    // what Paddle just accepted. The subscription.updated webhook repeats it.
    try {
      await env.DB.prepare(
        'UPDATE cloud_subscriptions SET status = ?, plan = ?, tier = ?, cancel_at = NULL, updated_at = ? WHERE owner_sub = ?'
      )
        .bind(nextStatus, tierParam, tierParam, new Date().toISOString(), session.sub)
        .run();
    } catch (e) {
      /* the webhook will write the same facts */
    }
    return json({
      ok: true,
      upgraded: true,
      plan: tierParam,
      status: nextStatus,
      effective: 'immediately'
    });
  } catch (e) {
    return json({ ok: false, error: 'upgrade failed (upstream unreachable)' }, 502);
  }
}

export async function handleBillingCheckout(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return cloudForbidden();
  }
  const provider = billingProvider(env);
  if (!provider) {
    return json({ ok: false, error: 'billing not configured' }, 503);
  }
  if (provider !== 'paddle') {
    return lsCheckout(env, session);
  }
  const url = new URL(request.url);
  const tierParam = url.searchParams.get('tier') || 'contractor';
  // homeowner is the pre-rename alias for the same plan.
  const wantTier = tierParam === 'homeowner' ? 'estimator' : tierParam;
  let priceId;
  if (tierParam === 'enterprise' && env.PADDLE_ENTERPRISE_PRICE_ID) {
    priceId = String(env.PADDLE_ENTERPRISE_PRICE_ID);
  } else if (tierParam === 'company' && env.PADDLE_COMPANY_PRICE_ID) {
    priceId = String(env.PADDLE_COMPANY_PRICE_ID);
  } else if (
    (tierParam === 'estimator' || tierParam === 'homeowner') &&
    (env.PADDLE_ESTIMATOR_PRICE_ID || env.PADDLE_HOMEOWNER_PRICE_ID)
  ) {
    priceId = String(env.PADDLE_ESTIMATOR_PRICE_ID || env.PADDLE_HOMEOWNER_PRICE_ID);
  } else {
    priceId = String(env.PADDLE_PRICE_ID); // contractor (default)
  }
  // UI-IA Phase 5 (owner 2026-11-12): a paying subscriber who picks another
  // plan changes THE plan. The old rule refused with 409, which left an owner
  // who wanted Company stuck on Contractor until they cancelled first - and a
  // second checkout would have billed separately anyway.
  const held = await env.DB.prepare(
    'SELECT status, ls_subscription_id, current_period_end, cancel_at, plan, tier FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(session.sub)
    .first();
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    held &&
    subscriptionActive(held, nowSec) &&
    String(held.ls_subscription_id || '').indexOf('sub_') === 0
  ) {
    const heldTier = held.tier || held.plan || 'contractor';
    if (heldTier === wantTier) {
      return json({ ok: true, samePlan: true, plan: heldTier, active: true });
    }
    if ((TIER_RANK[wantTier] || 0) < (TIER_RANK[heldTier] || 0)) {
      return json(
        {
          ok: false,
          code: 'downgrade_not_supported',
          error:
            'Your current plan is higher. To move to a lower plan, contact support and we will schedule it for the end of the period you have paid for.'
        },
        409
      );
    }
    if (billingStatusActive(held.status)) {
      return paddleUpgrade(env, session, held, priceId, wantTier, nowSec);
    }
    // canceled, but the paid period is still running: Paddle will not change a
    // canceled subscription, and it will not renew either. A fresh checkout
    // replaces it when the owner pays; the old row is replaced by the new sub.
  }
  return paddleCheckout(env, session, priceId, wantTier);
}
// ---- cancel for ACCOUNT DELETION (W3, owner 2026-10-15) --------------------
// Deleting your account cancels the subscription IMMEDIATELY. Owner decision:
// the remaining paid days are forfeited, and the refund policy says so. This is
// deliberately NOT the same as handleBillingCancel below, which schedules a
// cancel at period end so the subscriber keeps what they already paid for - a
// deleted account has nowhere to keep it.
//
// The rule that matters: this returns { ok: false } on any refusal, and the
// caller then DOES NOT DELETE. The one outcome that must never happen is
// deleting someone's account while Paddle keeps billing them - they lose the
// panel that could cancel it and cannot see the charge stop.
//
// A subscription that is already gone at Paddle (404) counts as cancelled, so
// a subscription cancelled in the Paddle dashboard cannot block deletion.
// Reuses handleBillingCancel's endpoint shape verbatim: POST
// /subscriptions/{id}/cancel with `effective_from` (NOT `effective_at`, which
// is the response field).
export async function billingCancelForDeletion(env, sub) {
  if (!sub) {
    return { ok: true };
  }
  if (billingProvider(env) !== 'paddle') {
    // Not configured, or a retired LemonSqueezy deployment: there is no live
    // billing to cancel, and blocking deletion on an absent provider would
    // strand the user.
    return { ok: true };
  }
  let row;
  try {
    row = await env.DB.prepare(
      'SELECT status, ls_subscription_id, current_period_end FROM cloud_subscriptions WHERE owner_sub = ?'
    )
      .bind(sub)
      .first();
  } catch (e) {
    return { ok: false, error: 'could not read the subscription' };
  }
  // No row, or a row that is not paying (canceled / expired / paused): nothing
  // will be billed again, so deletion is safe.
  if (!row || !billingStatusActive(row.status)) {
    return { ok: true };
  }
  const subId = String(row.ls_subscription_id || '');
  if (!subId) {
    return { ok: false, error: 'subscription reference missing' };
  }
  const r = await paddleCancelSubscription(env, subId);
  if (!r.ok) {
    console.error(
      'billing cancel for deletion failed: subId=' +
        subId +
        ' http=' +
        (r.http || '') +
        ' detail=' +
        (r.detail || '')
    );
    return { ok: false, error: r.error };
  }
  return { ok: true, alreadyGone: !!r.alreadyGone };
}

// POST /subscriptions/{id}/cancel with `effective_from: immediately`, shared by
// account deletion and by the operator's orphan cleanup (5.2). 404 is a
// SUCCESS there - the subscription is already gone at Paddle, so nothing will
// bill again - while any other refusal is a failure the CALLER must report and
// act on, which is exactly the contract the orphan gate pins: a cancel that
// fails leaves the row in place, with the provider's reason attached.
export async function paddleCancelSubscription(env, subId) {
  const base = paddleApiBase(env);
  let res;
  try {
    res = await fetch(base + '/subscriptions/' + encodeURIComponent(subId) + '/cancel', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.PADDLE_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ effective_from: 'immediately' })
    });
  } catch (e) {
    return { ok: false, error: 'could not reach the payment provider' };
  }
  if (res.status === 404) {
    return { ok: true, alreadyGone: true };
  }
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      const err = (data && data.error) || {};
      const first = (err.errors && err.errors[0]) || {};
      detail = String(first.detail || err.detail || err.code || '').slice(0, 200);
    } catch (e) {
      detail = '';
    }
    return {
      ok: false,
      error: 'the payment provider refused to cancel the subscription',
      detail: detail,
      http: res.status
    };
  }
  return { ok: true };
}

// ---- manage / cancel (Wave 8.10, owner 2026-10-06) --------------------------
// Schedule a cancel-at-period-end on Paddle. The subscriber KEEPS Premium until
// the end of the period they already paid for , cancelling stops the NEXT
// payment, it never revokes access early. We do not write 'cancelled' here:
// Paddle's own subscription.canceled webhook is the only thing that flips the
// local status, so the local row cannot disagree with Paddle about when access
// ends. The row is never deleted.
// UI-IA Phase 5: the scheduled cancel is now remembered locally, so the panel
// can stop offering Cancel and can name the end date without asking Paddle on
// every page load. Paddle's webhook remains the authority on STATUS; this only
// records WHEN the paid period ends. A write failure is not fatal - the
// webhook repeats the same fact.
async function rememberCancelAt(env, ownerSub, iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) {
    return;
  }
  try {
    await env.DB.prepare(
      'UPDATE cloud_subscriptions SET cancel_at = ?, updated_at = ? WHERE owner_sub = ?'
    )
      .bind(Math.floor(t / 1000), new Date().toISOString(), ownerSub)
      .run();
  } catch (e) {
    /* the webhook still carries the truth */
  }
}

export async function handleBillingCancel(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return cloudForbidden();
  }
  const provider = billingProvider(env);
  if (!provider) {
    return json({ ok: false, error: 'billing not configured' }, 503);
  }
  if (provider !== 'paddle') {
    // LemonSqueezy is retired (D2): there is no live cancel path for it.
    return json(
      { ok: false, error: 'managing a subscription is only available for Paddle subscriptions' },
      503
    );
  }
  // OWNER 2026-10-09: cancelling must never be one stray click. The panel makes
  // the user TYPE the word CANCEL, and the request itself has to carry it, so a
  // bare DELETE - a stale open tab, a hand-made request, a mis-wired button -
  // is refused here, before the subscription row is even read and long before
  // Paddle is called. The check is deliberately the first thing after the
  // provider gate: a wrong word cannot touch the database.
  let confirmWord = '';
  try {
    const raw = await request.text();
    if (raw) {
      confirmWord = String((JSON.parse(raw) || {}).confirm || '');
    }
  } catch (e) {
    confirmWord = '';
  }
  if (confirmWord.trim().toUpperCase() !== 'CANCEL') {
    return json(
      {
        ok: false,
        code: 'confirm_required',
        error: 'Type CANCEL to confirm cancelling your subscription.'
      },
      400
    );
  }
  const sub = await env.DB.prepare(
    'SELECT status, ls_subscription_id, current_period_end, cancel_at FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(session.sub)
    .first();
  const nowSec = Math.floor(Date.now() / 1000);
  if (!sub || !subscriptionActive(sub, nowSec)) {
    return json({ ok: false, error: 'no active subscription' }, 404);
  }
  // Already scheduled (or Paddle already flipped the status while the paid
  // period runs): this is a success with the real date, not a second cancel.
  // Answering here also keeps a stale tab from sending Paddle a request that
  // can only fail.
  const storedCancelAt = Number(sub.cancel_at) || 0;
  if (storedCancelAt > nowSec || !billingStatusActive(sub.status)) {
    return json({
      ok: true,
      alreadyScheduled: true,
      cancelAt: periodEndIso(storedCancelAt || sub.current_period_end),
      currentPeriodEnd: periodEndIso(sub.current_period_end),
      status: sub.status
    });
  }
  // ls_subscription_id is the generic provider subscription id; Paddle writes
  // its sub_... there via applySubscription().
  const subId = String(sub.ls_subscription_id || '');
  if (!subId) {
    return json({ ok: false, error: 'subscription reference missing' }, 409);
  }
  const sandbox = String(env.PADDLE_ENV || '') === 'sandbox';
  const base = paddleApiBase(env);
  const auth = {
    Authorization: 'Bearer ' + env.PADDLE_API_KEY,
    'Content-Type': 'application/json'
  };
  try {
    // Paddle has a DEDICATED cancel operation. The old call PATCHed the
    // subscription with `scheduled_change: { action: 'cancel', ... }`, which
    // Paddle rejects with 400 "Invalid request." (its own docs: on PATCH,
    // scheduled_change "may only be set to null to remove a scheduled change.
    // Use the pause subscription, cancel subscription, and resume subscription
    // operations to create scheduled changes"). The request field is
    // `effective_from`, not `effective_at` - `effective_at` is the RESPONSE
    // field, which is why the reply is parsed with effective_at below.
    const res = await fetch(base + '/subscriptions/' + encodeURIComponent(subId) + '/cancel', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ effective_from: 'next_billing_period' })
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      let detail = '';
      // Per-rule-5: the error code is derived per-branch from the caught
      // error's payload (err), and BOTH live in function scope so the outer
      // catch can read them whichever branch ran. They must be declared
      // BEFORE the branches: `err` used to be block-scoped to this try, so the
      // 400/409 and 401/403 branches threw a ReferenceError and the outer
      // catch reported "could not reach Paddle" for a real HTTP 403; and
      // `var code = ''` used to sit AFTER the capture below and wipe it.
      var code = '';
      var err = {};
      try {
        err = (data && data.error) || {};
        const first = (err.errors && err.errors[0]) || {};
        detail = String(first.detail || err.detail || err.code || '').slice(0, 300);
        if (err.code && detail.indexOf(String(err.code)) === -1) {
          detail = (detail + ' [' + String(err.code) + ']').slice(0, 340);
        }
        code = code || err.code;
      } catch (e) {
        /* keep detail empty */
      }
      // Paddle can return the same lock as 400 in production and 409 in docs.
      // Key on the error CODE, never the HTTP status (rule 5).
      // Locked paths are handled BEFORE the generic mistake hint, which stays
      // only for 400s that are NOT a subscription_locked_pending_changes lock.
      let hint = '';
      if (res.status === 404) {
        hint =
          ' - the subscription was not found by the ' +
          (sandbox ? 'SANDBOX' : 'LIVE') +
          ' API. The subscription and the API key may be in different Paddle environments. A sandbox key cannot reach a live subscription and the reverse. Check PADDLE_ENV, PADDLE_API_KEY and the subscription in the Paddle dashboard.';
      } else if (res.status === 400 || res.status === 409) {
        // Derive code from the caught error (err) so a 400 that did not
        // include a code stays empty, and a lock code is visible only for the
        // 400/409 path.
        code = err && err.code ? String(err.code) : '';
        if (code === 'subscription_locked_pending_changes') {
          // Paddle already holds a scheduled change for this subscription.
          // The app never stored that change, so the dashboard still shows a
          // Cancel button and would report a real success as a failure here.
          // Do not treat this as a failure: read the scheduled change from the
          // response so the caller can surface the true state.
          const sched = data && data.scheduled_change;
          if (sched && sched.action === 'cancel' && String(sched.effective_at || '').length >= 10) {
            // The cancel is already scheduled; short-circuit the caller so
            // the dashboard shows the real state without retrying.
            const body = {
              ok: true,
              alreadyScheduled: true,
              cancelAt: String(sched.effective_at),
              currentPeriodEnd: periodEndIso(sub.current_period_end),
              status: sub.status
            };
            console.warn(
              'billing cancel: already scheduled, subId=' +
                subId +
                ' env=' +
                (sandbox ? 'sandbox' : 'live') +
                ' http=' +
                res.status +
                ' code=' +
                code
            );
            await rememberCancelAt(env, session.sub, String(sched.effective_at));
            return json(body, 200);
          }
          if (sched && sched.action === 'pause') {
            const pauseAt = String(sched.effective_at || '').slice(0, 10);
            return json(
              {
                ok: false,
                error:
                  'A pause is already scheduled for ' +
                  (pauseAt || 'an unknown date') +
                  ' and is blocking the cancel. The pause must end or be cancelled before this subscription can be cancelled.'
              },
              403
            );
          }
          // Paddle sent the lock code but did not return a usable scheduled
          // change in the body. Do not guess the current state; quote the code.
          return json(
            {
              ok: false,
              error:
                'The subscription already has a pending change and the server could not read it back. ' +
                'This is a real cause quoted from Paddle: ' +
                code +
                '. Refresh and try again; if the Cancel button still appears after the refresh, the pending change may be a cancel or a pause.'
            },
            502
          );
        }
        // Any other 400/409: a rejected request, not a missing subscription.
        hint = ' - Paddle rejected the cancel request itself. This is not a missing subscription.';
      } else if (res.status === 401 || res.status === 403) {
        hint =
          ' - Paddle rejected the API key for the ' +
          (sandbox ? 'sandbox' : 'live') +
          ' API. The key may be for the wrong environment or lack subscription write scope.';
        code = err.code || code;
      }
      // Surface the subscription id we tried to cancel so the worker log is
      // actionable without guessing which row tripped it.
      console.warn(
        'billing cancel failed: subId=' +
          subId +
          ' env=' +
          (sandbox ? 'sandbox' : 'live') +
          ' http=' +
          res.status +
          ' detail=' +
          detail
      );
      return json(
        {
          ok: false,
          error:
            'cancel failed (Paddle HTTP ' +
            (res && res.status ? String(res.status) : '?') +
            ', code ' +
            (code || '') +
            ')' +
            hint +
            (detail ? ' , ' + detail : '')
        },
        502
      );
    }
    const sched = data && data.data && data.data.scheduled_change;
    const cancelAt = (sched && sched.effective_at) || null;
    await rememberCancelAt(env, session.sub, cancelAt || periodEndIso(sub.current_period_end));
    // Access runs to the end of the paid period; report the truth and let the
    // webhook finalise the status.
    return json({
      ok: true,
      alreadyScheduled: sched && sched.action === 'cancel' ? true : false,
      cancelAt: cancelAt,
      currentPeriodEnd: periodEndIso(sub.current_period_end),
      status: sub.status
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error:
          'cancel failed: could not reach Paddle (status ' +
          (e && e.status ? String(e.status) : '?') +
          ', code ' +
          (code || '') +
          ')'
      },
      502
    );
  }
}
