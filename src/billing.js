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

// Which provider (if any) this deployment is configured for. Paddle wins
// when both sets exist - that is the migration direction (LS -> Paddle).
export function billingProvider(env) {
  if (env && env.PADDLE_WEBHOOK_SECRET && env.PADDLE_API_KEY && env.PADDLE_PRICE_ID)
    return 'paddle';
  if (
    env &&
    env.LEMONSQUEEZY_WEBHOOK_SECRET &&
    env.LEMONSQUEEZY_API_KEY &&
    env.LEMONSQUEEZY_VARIANT_ID &&
    env.LEMONSQUEEZY_STORE_ID
  )
    return 'lemonsqueezy';
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
export function deriveTier(priceId, env) {
  if (!priceId || !env) return 'contractor';
  if (env.PADDLE_ENTERPRISE_PRICE_ID && priceId === String(env.PADDLE_ENTERPRISE_PRICE_ID))
    return 'enterprise';
  if (env.PADDLE_COMPANY_PRICE_ID && priceId === String(env.PADDLE_COMPANY_PRICE_ID))
    return 'company';
  if (env.PADDLE_ESTIMATOR_PRICE_ID && priceId === String(env.PADDLE_ESTIMATOR_PRICE_ID))
    return 'estimator';
  if (env.PADDLE_HOMEOWNER_PRICE_ID && priceId === String(env.PADDLE_HOMEOWNER_PRICE_ID))
    return 'estimator';
  return 'contractor';
}

// D1 (2026-10-06): a failed payment keeps entitlement while Paddle retries,
// so 'past_due' counts as active. Exported so the cloud layer can gate
// tier-dependent features (RBAC member caps) on the SAME rule.
export function billingStatusActive(status) {
  return status === 'active' || status === 'on_trial' || status === 'past_due';
}

// D1 stores current_period_end as epoch SECONDS. JavaScript's Date() takes
// MILLISECONDS, so handing the stored number to the browser made it render
// 1794154608 (Nov 8, 2026) as 1794154608 ms = "Jan 21, 1970". Every date that
// leaves the API is an ISO-8601 UTC string instead - one format, no unit to
// get wrong. A missing or non-positive value is null, never 1970.
export function periodEndIso(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
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
      for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
      return hex;
    });
}

// ---- LemonSqueezy (legacy provider, kept until the owner retires it) ------

async function lsVerifySignature(env, rawBody, sigHeader) {
  if (!env || !env.LEMONSQUEEZY_WEBHOOK_SECRET) return false;
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
  if (lifecycle.indexOf(event) === -1) return json({ ok: true, ignored: event });
  if (!ownerSub || !lsId)
    return json({ ok: false, error: 'missing owner identity in custom_data' }, 400);
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
  if (!env || !env.PADDLE_WEBHOOK_SECRET) return false;
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
    if (!tsPart || !h1s.length) return false;
    const ts = parseInt(tsPart, 10);
    if (!Number.isFinite(ts)) return false;
    if (Math.abs(Date.now() / 1000 - ts) > PADDLE_TS_TOLERANCE_SEC) return false;
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
  if (lifecycle.indexOf(event) === -1 && event !== 'transaction.completed')
    return json({ ok: true, ignored: event });
  // A subscription's own transactions (first charge AND every renewal) must
  // never write the entitlement row: they carry no billing period and a
  // transaction id, so a renewal used to overwrite the real subscription id
  // and wipe current_period_end. The subscription.* events own entitlement;
  // only a ONE-TIME purchase (no subscription_id) is granted from here.
  if (event === 'transaction.completed' && data.subscription_id)
    return json({ ok: true, ignored: 'subscription transaction' });
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
    if (payload && payload.occurred_at) occurredAt = new Date(payload.occurred_at).toISOString();
  } catch (e) {
    /* keep now */
  }
  let status,
    periodEnd = null;
  if (event === 'transaction.completed') {
    // One-time purchase: grant a tier with no period end (nothing renews).
    status = 'active';
  } else {
    status = paddleStatus(data.status);
    const endRaw = data.current_billing_period && data.current_billing_period.ends_at;
    if (endRaw) periodEnd = Math.floor(new Date(endRaw).getTime() / 1000);
  }
  // Paddle events carry items[0].price.id on subscription and transaction
  // events; the price ID is what names the tier, never a hardcoded 'pro'.
  const priceId =
    (data && data.items && data.items[0] && data.items[0].price && data.items[0].price.id) || null;
  const tier = deriveTier(priceId, env);
  const applied = await applySubscription(env, ownerSub, pdId, status, tier, periodEnd, occurredAt);
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
  occurredAt
) {
  const now = occurredAt || new Date().toISOString();
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
    'INSERT INTO cloud_subscriptions (owner_sub, ls_subscription_id, status, plan, tier, current_period_end, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(owner_sub) DO UPDATE SET ls_subscription_id = excluded.ls_subscription_id, status = excluded.status, ' +
      'plan = excluded.plan, tier = excluded.tier, ' +
      'current_period_end = excluded.current_period_end, updated_at = excluded.updated_at ' +
      'WHERE excluded.updated_at >= cloud_subscriptions.updated_at'
  )
    .bind(ownerSub, providerSubId, status, tier, tier, periodEnd, now, now)
    .run();
  return true;
}

async function subEmailNotice(env, recipient, confirmed) {
  if (!recipient) return;
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
    if (!env || !env.PADDLE_WEBHOOK_SECRET)
      return json({ ok: false, error: 'webhook not configured' }, 401);
    if (!(await paddleVerifySignature(env, rawBody, sigPaddle)))
      return json({ ok: false, error: 'invalid signature' }, 401);
    return paddleApplyWebhook(env, rawBody);
  }
  if (sigLS) {
    // Wave 8.13: same rule for a legacy delivery to a retired destination.
    if (!env || !env.LEMONSQUEEZY_WEBHOOK_SECRET)
      return json({ ok: false, error: 'webhook not configured' }, 401);
    if (!(await lsVerifySignature(env, rawBody, sigLS)))
      return json({ ok: false, error: 'invalid signature' }, 401);
    return lsApplyWebhook(env, rawBody);
  }
  return json({ ok: false, error: 'invalid signature' }, 401);
}

// ---- status -----------------------------------------------------------------

export async function handleBillingStatus(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const provider = billingProvider(env);
  const cap = billingFreeCap(env);
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM cloud_projects WHERE google_sub = ?')
    .bind(session.sub)
    .first();
  const projectCount = (cnt && cnt.c) || 0;
  if (!provider)
    return json({
      ok: true,
      configured: false,
      plan: 'free',
      active: false,
      projectCap: null,
      projectCount: projectCount
    });
  const sub = await env.DB.prepare(
    'SELECT status, plan, tier, current_period_end FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(session.sub)
    .first();
  const active = !!(sub && billingStatusActive(sub.status));
  return json({
    ok: true,
    configured: true,
    provider: provider,
    plan: active ? sub.tier || sub.plan || 'contractor' : 'free',
    active: active,
    currentPeriodEnd: periodEndIso(sub && sub.current_period_end),
    projectCap: cap,
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
  const base = sandbox ? PADDLE_SANDBOX_BASE : PADDLE_API_BASE;
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
      if (found) customerId = String(found);
      else {
        const c = await fetch(base + '/customers', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ email: email })
        });
        const cd = await c.json().catch(function () {
          return {};
        });
        if (c.ok && cd && cd.data && cd.data.id) customerId = String(cd.data.id);
      }
    }
    const body = {
      items: [{ quantity: 1, price_id: priceId }],
      custom_data: { sub: session.sub, tier: tierParam }
    };
    if (customerId) body.customer_id = customerId;
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

export async function handleBillingCheckout(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const provider = billingProvider(env);
  if (!provider) return json({ ok: false, error: 'billing not configured' }, 503);
  if (provider !== 'paddle') return lsCheckout(env, session);
  // A second checkout while a subscription is live creates a SECOND Paddle
  // subscription that is billed separately. The one-row-per-owner table can
  // only remember one of them, so the other keeps charging and can no longer
  // be seen or cancelled from the app. Refuse until the first is cancelled.
  const held = await env.DB.prepare(
    'SELECT status, ls_subscription_id FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(session.sub)
    .first();
  if (
    held &&
    billingStatusActive(held.status) &&
    String(held.ls_subscription_id || '').indexOf('sub_') === 0
  )
    return json(
      {
        ok: false,
        code: 'already_subscribed',
        error:
          'You already have an active subscription. Cancel it from your dashboard first - a second one would be billed separately and could not be managed from here.'
      },
      409
    );
  const url = new URL(request.url);
  const tierParam = url.searchParams.get('tier') || 'contractor';
  let priceId;
  if (tierParam === 'enterprise' && env.PADDLE_ENTERPRISE_PRICE_ID) {
    priceId = String(env.PADDLE_ENTERPRISE_PRICE_ID);
  } else if (tierParam === 'company' && env.PADDLE_COMPANY_PRICE_ID) {
    priceId = String(env.PADDLE_COMPANY_PRICE_ID);
  } else if (
    (tierParam === 'estimator' || tierParam === 'homeowner') &&
    (env.PADDLE_ESTIMATOR_PRICE_ID || env.PADDLE_HOMEOWNER_PRICE_ID)
  ) {
    // estimator is the plan; homeowner is the pre-rename alias for the same one
    priceId = String(env.PADDLE_ESTIMATOR_PRICE_ID || env.PADDLE_HOMEOWNER_PRICE_ID);
  } else {
    priceId = String(env.PADDLE_PRICE_ID); // contractor (default)
  }
  return paddleCheckout(env, session, priceId, tierParam === 'homeowner' ? 'estimator' : tierParam);
}

// ---- manage / cancel (Wave 8.10, owner 2026-10-06) --------------------------
// Schedule a cancel-at-period-end on Paddle. The subscriber KEEPS Premium until
// the end of the period they already paid for , cancelling stops the NEXT
// payment, it never revokes access early. We do not write 'cancelled' here:
// Paddle's own subscription.canceled webhook is the only thing that flips the
// local status, so the local row cannot disagree with Paddle about when access
// ends. The row is never deleted.
export async function handleBillingCancel(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const provider = billingProvider(env);
  if (!provider) return json({ ok: false, error: 'billing not configured' }, 503);
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
    if (raw) confirmWord = String((JSON.parse(raw) || {}).confirm || '');
  } catch (e) {
    confirmWord = '';
  }
  if (confirmWord.trim().toUpperCase() !== 'CANCEL')
    return json(
      {
        ok: false,
        code: 'confirm_required',
        error: 'Type CANCEL to confirm cancelling your subscription.'
      },
      400
    );
  const sub = await env.DB.prepare(
    'SELECT status, ls_subscription_id, current_period_end FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(session.sub)
    .first();
  if (!sub || !billingStatusActive(sub.status))
    return json({ ok: false, error: 'no active subscription' }, 404);
  // ls_subscription_id is the generic provider subscription id; Paddle writes
  // its sub_... there via applySubscription().
  const subId = String(sub.ls_subscription_id || '');
  if (!subId) return json({ ok: false, error: 'subscription reference missing' }, 409);
  const sandbox = String(env.PADDLE_ENV || '') === 'sandbox';
  const base = sandbox ? PADDLE_SANDBOX_BASE : PADDLE_API_BASE;
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
      try {
        const err = (data && data.error) || {};
        const first = (err.errors && err.errors[0]) || {};
        detail = String(first.detail || err.detail || err.code || '').slice(0, 300);
        if (err.code && detail.indexOf(String(err.code)) === -1)
          detail = (detail + ' [' + String(err.code) + ']').slice(0, 340);
      } catch (e) {
        /* keep detail empty */
      }
      // Mirror the checkout path's environment mismatch explainer. A 400/404 on
      // the cancel PATCH is very often the same live/sandbox catalog split: the
      // subscription lives in one Paddle environment and the API key + PADDLE_ENV
      // are pointing at the other. Say so instead of returning the raw Paddle
      // "Invalid request." which is not actionable from the admin panel.
      let hint = '';
      if (res.status === 404) {
        hint =
          ' - the subscription was not found by the ' +
          (sandbox ? 'SANDBOX' : 'LIVE') +
          ' API. The subscription and the API key may be in different Paddle environments. A sandbox key cannot reach a live subscription and the reverse. Check PADDLE_ENV, PADDLE_API_KEY and the subscription in the Paddle dashboard.';
      } else if (res.status === 400) {
        // A 400 means Paddle refused the REQUEST, not that the subscription is
        // missing - the old shared hint sent the owner hunting an environment
        // mismatch that did not exist. Say what a 400 actually means.
        hint = ' - Paddle rejected the cancel request itself. This is not a missing subscription.';
      } else if (res.status === 401 || res.status === 403) {
        hint =
          ' - Paddle rejected the API key for the ' +
          (sandbox ? 'sandbox' : 'live') +
          ' API. The key may be for the wrong environment or lack subscription write scope.';
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
            'cancel failed (Paddle HTTP ' + res.status + ')' + hint + (detail ? ' , ' + detail : '')
        },
        502
      );
    }
    const sched = data && data.data && data.data.scheduled_change;
    const cancelAt = (sched && sched.effective_at) || null;
    // Access runs to the end of the paid period; report the truth and let the
    // webhook finalise the status.
    return json({
      ok: true,
      cancelAt: cancelAt,
      currentPeriodEnd: periodEndIso(sub.current_period_end),
      status: sub.status
    });
  } catch (e) {
    return json({ ok: false, error: 'cancel failed (upstream unreachable)' }, 502);
  }
}
