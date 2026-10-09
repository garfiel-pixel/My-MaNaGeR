import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingStatusActive,
  billingFreeCap,
  deriveTier,
  periodEndIso,
  handleBillingStatus,
  handleBillingCancel,
  handleBillingCheckout,
  handleBillingWebhook
} from '../src/billing.js';
import { signSession, sessionKey } from '../src/lib/http.js';

test('billingStatusActive: active, on_trial and past_due are active (D1 grace)', () => {
  assert.equal(billingStatusActive('active'), true);
  assert.equal(billingStatusActive('on_trial'), true);
  assert.equal(billingStatusActive('past_due'), true);
});

test('billingStatusActive: cancelled, expired, paused and unknown are not active', () => {
  assert.equal(billingStatusActive('canceled'), false);
  assert.equal(billingStatusActive('cancelled'), false);
  assert.equal(billingStatusActive('expired'), false);
  assert.equal(billingStatusActive('paused'), false);
  assert.equal(billingStatusActive(''), false);
  assert.equal(billingStatusActive(undefined), false);
  assert.equal(billingStatusActive(null), false);
});

test('billingFreeCap: default is 1 (D3)', () => {
  assert.equal(billingFreeCap({}), 1);
  assert.equal(billingFreeCap(undefined), 1);
  assert.equal(billingFreeCap(null), 1);
});

test('billingFreeCap: a positive FREE_PROJECT_CAP overrides the default', () => {
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: 2 }), 2);
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: '5' }), 5);
});

test('billingFreeCap: a non-positive or unreadable override falls back to 1', () => {
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: 0 }), 1);
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: -3 }), 1);
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: 'nope' }), 1);
});

test('deriveTier: maps the enterprise price ID to enterprise', () => {
  const env = {
    PADDLE_ENTERPRISE_PRICE_ID: 'pri_ent',
    PADDLE_COMPANY_PRICE_ID: 'pri_com',
    PADDLE_PRICE_ID: 'pri_con'
  };
  assert.equal(deriveTier('pri_ent', env), 'enterprise');
});

test('deriveTier: maps the company price ID to company', () => {
  const env = {
    PADDLE_ENTERPRISE_PRICE_ID: 'pri_ent',
    PADDLE_COMPANY_PRICE_ID: 'pri_com',
    PADDLE_PRICE_ID: 'pri_con'
  };
  assert.equal(deriveTier('pri_com', env), 'company');
});

test('deriveTier: any other known price ID is contractor', () => {
  const env = {
    PADDLE_ENTERPRISE_PRICE_ID: 'pri_ent',
    PADDLE_COMPANY_PRICE_ID: 'pri_com',
    PADDLE_PRICE_ID: 'pri_con'
  };
  assert.equal(deriveTier('pri_con', env), 'contractor');
});

test('deriveTier: an unrecognised price ID falls back to contractor (never a downgrade)', () => {
  const env = { PADDLE_ENTERPRISE_PRICE_ID: 'pri_ent', PADDLE_COMPANY_PRICE_ID: 'pri_com' };
  assert.equal(deriveTier('pri_unknown', env), 'contractor');
});

test('deriveTier: a missing price ID or env is contractor', () => {
  assert.equal(deriveTier(null, { PADDLE_PRICE_ID: 'pri_con' }), 'contractor');
  assert.equal(deriveTier('pri_ent', null), 'contractor');
  assert.equal(deriveTier(undefined, undefined), 'contractor');
});

// --- ESTIMATOR (owner 2026-10-07): the homeowner plan renamed -------------
test('deriveTier: maps the estimator price ID to estimator', () => {
  const env = { PADDLE_ESTIMATOR_PRICE_ID: 'pri_est', PADDLE_PRICE_ID: 'pri_con' };
  assert.equal(deriveTier('pri_est', env), 'estimator');
});

test('deriveTier: the pre-rename homeowner price ID is an ALIAS for estimator', () => {
  const env = { PADDLE_HOMEOWNER_PRICE_ID: 'pri_home', PADDLE_PRICE_ID: 'pri_con' };
  assert.equal(deriveTier('pri_home', env), 'estimator');
});

test('deriveTier: the alias applies only to that price, never to contractor', () => {
  const env = {
    PADDLE_ESTIMATOR_PRICE_ID: 'pri_est',
    PADDLE_HOMEOWNER_PRICE_ID: 'pri_home',
    PADDLE_PRICE_ID: 'pri_con'
  };
  assert.equal(deriveTier('pri_con', env), 'contractor');
  assert.equal(deriveTier('pri_est', env), 'estimator');
  assert.equal(deriveTier('pri_home', env), 'estimator');
});

test('deriveTier: the estimator price wins over a stale homeowner price', () => {
  const env = {
    PADDLE_ESTIMATOR_PRICE_ID: 'pri_est',
    PADDLE_HOMEOWNER_PRICE_ID: 'pri_est',
    PADDLE_PRICE_ID: 'pri_con'
  };
  assert.equal(deriveTier('pri_est', env), 'estimator');
});

// ---------------------------------------------------------------------------
// Handler-level tests. These call the REAL handlers with a fake D1, a fake
// Paddle API (global fetch) and a genuinely signed session / webhook, so a
// regression in src/billing.js fails here. (The two tests that used to sit in
// this spot copied an `if` statement into the test body and never called the
// handler, so they passed whatever the handler did.)
// ---------------------------------------------------------------------------

const SECRET = 'test-google-client-secret';
const WH_SECRET = 'pdl_ntfset_test_secret';
const SUB = 'sub_01m4e4v5652cz8vsgsz0eeaq96';
const PERIOD_END_SEC = 1794154608; // 2026-11-08T16:16:48Z, the real live row

function fakeDb(state) {
  const log = [];
  return {
    log,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              log.push({ sql, args, kind: 'first' });
              if (/FROM auth_sessions/.test(sql)) return { revoked_at: null };
              if (/FROM cloud_subscriptions WHERE owner_sub/.test(sql)) return state.sub || null;
              if (/COUNT\(\*\)/.test(sql)) return { c: 0 };
              return null;
            },
            async run() {
              log.push({ sql, args, kind: 'run' });
              return {};
            }
          };
        }
      };
    }
  };
}

async function authedRequest(env, method, url, body) {
  const key = await sessionKey(env);
  const token = await signSession(
    {
      sub: 'owner-1',
      email: 'o@example.com',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600
    },
    key
  );
  const headers = { Cookie: 'mmgr_session=' + token };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

function baseEnv(state, extra) {
  return Object.assign(
    {
      GOOGLE_CLIENT_SECRET: SECRET,
      DB: fakeDb(state),
      PADDLE_API_KEY: 'pdl_test_key',
      PADDLE_WEBHOOK_SECRET: WH_SECRET,
      PADDLE_PRICE_ID: 'pri_con'
    },
    extra || {}
  );
}

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return handler(String(url), init || {});
  };
  return fn(calls).finally(() => {
    globalThis.fetch = real;
  });
}

const paddleJson = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function signedWebhook(env, event) {
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.PADDLE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(ts + ':' + body));
  const h1 = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request('https://x.test/api/billing/webhook', {
    method: 'POST',
    headers: { 'Paddle-Signature': 'ts=' + ts + ';h1=' + h1 },
    body
  });
}

const subEvent = (type, id, status, ownerSub) => ({
  event_type: type,
  occurred_at: new Date().toISOString(),
  data: {
    id,
    status,
    custom_data: { sub: ownerSub || 'owner-1', tier: 'enterprise' },
    current_billing_period: { ends_at: '2026-11-08T16:16:48Z' },
    items: [{ price: { id: 'pri_con' } }]
  }
});

test('periodEndIso: epoch seconds become an ISO string, never 1970', () => {
  assert.equal(periodEndIso(PERIOD_END_SEC), '2026-11-08T16:16:48.000Z');
  assert.ok(new Date(periodEndIso(PERIOD_END_SEC)).getUTCFullYear() >= 2026);
  // the bug: the same number read as milliseconds is Jan 21, 1970
  assert.equal(new Date(PERIOD_END_SEC).toISOString().slice(0, 10), '1970-01-21');
});

test('periodEndIso: missing, zero, negative and junk are null (not 1970)', () => {
  for (const v of [null, undefined, 0, -5, '', 'abc', NaN]) assert.equal(periodEndIso(v), null);
});

test('GET /api/billing/status returns currentPeriodEnd as an ISO string', async () => {
  const env = baseEnv({
    sub: {
      status: 'active',
      plan: 'enterprise',
      tier: 'enterprise',
      current_period_end: PERIOD_END_SEC
    }
  });
  const res = await handleBillingStatus(
    await authedRequest(env, 'GET', 'https://x.test/api/billing/status'),
    env
  );
  const d = await res.json();
  assert.equal(d.active, true);
  assert.equal(d.plan, 'enterprise');
  assert.equal(d.currentPeriodEnd, '2026-11-08T16:16:48.000Z');
});

test('DELETE /api/billing/subscription POSTs to the LIVE cancel operation with the stored sub id and answers with ISO dates', async () => {
  const env = baseEnv({
    sub: { status: 'active', ls_subscription_id: SUB, current_period_end: PERIOD_END_SEC }
  });
  await withFetch(
    () =>
      paddleJson(200, {
        data: { scheduled_change: { action: 'cancel', effective_at: '2026-11-08T16:16:48Z' } }
      }),
    async calls => {
      const res = await handleBillingCancel(
        await authedRequest(env, 'DELETE', 'https://x.test/api/billing/subscription', {
          confirm: 'CANCEL'
        }),
        env
      );
      const d = await res.json();
      assert.equal(res.status, 200);
      assert.equal(d.ok, true);
      assert.equal(d.cancelAt, '2026-11-08T16:16:48Z');
      assert.equal(d.currentPeriodEnd, '2026-11-08T16:16:48.000Z');
      assert.equal(calls.length, 1);
      // Paddle creates a scheduled change ONLY through the dedicated cancel
      // operation; a PATCH with a scheduled_change body is answered 400.
      assert.equal(calls[0].url, 'https://api.paddle.com/subscriptions/' + SUB + '/cancel');
      assert.equal(calls[0].init.method, 'POST');
      assert.deepEqual(JSON.parse(calls[0].init.body), { effective_from: 'next_billing_period' });
    }
  );
});

test('cancel: PADDLE_ENV=sandbox goes to the sandbox host', async () => {
  const env = baseEnv(
    { sub: { status: 'active', ls_subscription_id: SUB, current_period_end: PERIOD_END_SEC } },
    { PADDLE_ENV: 'sandbox' }
  );
  await withFetch(
    () => paddleJson(200, { data: {} }),
    async calls => {
      await handleBillingCancel(
        await authedRequest(env, 'DELETE', 'https://x.test/api/billing/subscription', {
          confirm: 'CANCEL'
        }),
        env
      );
      assert.equal(calls[0].url, 'https://sandbox-api.paddle.com/subscriptions/' + SUB + '/cancel');
    }
  );
});

test("cancel: a 404 from the LIVE api names the environment and keeps Paddle's error code", async () => {
  const env = baseEnv({
    sub: { status: 'active', ls_subscription_id: SUB, current_period_end: PERIOD_END_SEC }
  });
  await withFetch(
    () =>
      paddleJson(404, {
        error: { code: 'not_found', detail: 'Entity sub_x not found' }
      }),
    async () => {
      const res = await handleBillingCancel(
        await authedRequest(env, 'DELETE', 'https://x.test/api/billing/subscription', {
          confirm: 'CANCEL'
        }),
        env
      );
      const d = await res.json();
      assert.equal(res.status, 502);
      assert.match(d.error, /Paddle HTTP 404/);
      assert.match(d.error, /not found by the LIVE API/);
      assert.match(d.error, /\[not_found\]/);
    }
  );
});

test('cancel: a 400 says Paddle refused the request, not that the subscription is missing', async () => {
  // The live failure that started this: Paddle answered 400 Invalid request.
  // to a PATCH that could not create a cancel. The old shared hint claimed the
  // subscription was "not found by the LIVE API", which was false and sent the
  // owner hunting an environment mismatch that did not exist.
  const env = baseEnv({
    sub: { status: 'active', ls_subscription_id: SUB, current_period_end: PERIOD_END_SEC }
  });
  await withFetch(
    () => paddleJson(400, { error: { code: 'bad_request', detail: 'Invalid request.' } }),
    async () => {
      const res = await handleBillingCancel(
        await authedRequest(env, 'DELETE', 'https://x.test/api/billing/subscription', {
          confirm: 'CANCEL'
        }),
        env
      );
      const d = await res.json();
      assert.equal(res.status, 502);
      assert.match(d.error, /Paddle HTTP 400/);
      assert.match(d.error, /rejected the cancel request itself/);
      assert.doesNotMatch(d.error, /not found by/);
    }
  );
});

test('cancel: a 403 is reported as a rejected key, not a missing subscription', async () => {
  const env = baseEnv({
    sub: { status: 'active', ls_subscription_id: SUB, current_period_end: PERIOD_END_SEC }
  });
  await withFetch(
    () => paddleJson(403, { error: { code: 'forbidden', detail: 'no scope' } }),
    async () => {
      const res = await handleBillingCancel(
        await authedRequest(env, 'DELETE', 'https://x.test/api/billing/subscription', {
          confirm: 'CANCEL'
        }),
        env
      );
      const d = await res.json();
      assert.match(d.error, /rejected the API key for the live API/);
      assert.doesNotMatch(d.error, /not found by/);
    }
  );
});

test('cancel: no active row is 404 and never calls Paddle', async () => {
  const env = baseEnv({ sub: { status: 'canceled', ls_subscription_id: SUB } });
  await withFetch(
    () => paddleJson(200, {}),
    async calls => {
      const res = await handleBillingCancel(
        await authedRequest(env, 'DELETE', 'https://x.test/api/billing/subscription', {
          confirm: 'CANCEL'
        }),
        env
      );
      assert.equal(res.status, 404);
      assert.equal(calls.length, 0);
    }
  );
});

// ---- Owner 2026-10-09: cancelling takes a typed confirmation word ----
// The panel makes the user type the word; the server refuses any cancel that
// does not carry it. These pin the server half, which is the half a stray click
// or a hand-made request cannot talk its way past.

function cancelGuardEnv() {
  return baseEnv({
    sub: { status: 'active', ls_subscription_id: SUB, current_period_end: PERIOD_END_SEC }
  });
}

for (const [label, body] of [
  ['no body at all', undefined],
  ['an empty body', ''],
  ['a body with no confirm field', { tier: 'enterprise' }],
  ['the WRONG word', { confirm: 'confirm' }],
  ['a near miss', { confirm: 'CANCELED' }]
]) {
  test(`cancel: refused (400) and never reaches the database or Paddle with ${label}`, async () => {
    const env = cancelGuardEnv();
    await withFetch(
      () => paddleJson(200, {}),
      async calls => {
        const res = await handleBillingCancel(
          await authedRequest(env, 'DELETE', 'https://x.test/api/billing/subscription', body),
          env
        );
        const d = await res.json();
        assert.equal(res.status, 400);
        assert.equal(d.code, 'confirm_required');
        assert.equal(calls.length, 0, 'Paddle must not be called');
        assert.equal(
          env.DB.log.filter(l => /cloud_subscriptions/.test(l.sql)).length,
          0,
          'the subscription row must not even be read'
        );
      }
    );
  });
}

test('cancel: the word is case-insensitive and tolerates surrounding space (a phone autocapitalises)', async () => {
  const env = cancelGuardEnv();
  await withFetch(
    () => paddleJson(200, { data: { scheduled_change: { effective_at: '2026-11-08T16:16:48Z' } } }),
    async () => {
      const res = await handleBillingCancel(
        await authedRequest(env, 'DELETE', 'https://x.test/api/billing/subscription', {
          confirm: '  cancel  '
        }),
        env
      );
      assert.equal(res.status, 200);
    }
  );
});

test('checkout: refuses (409) while an active sub_ subscription exists, and never calls Paddle', async () => {
  const env = baseEnv({ sub: { status: 'active', ls_subscription_id: SUB } });
  await withFetch(
    () => paddleJson(200, {}),
    async calls => {
      const res = await handleBillingCheckout(
        await authedRequest(env, 'POST', 'https://x.test/api/billing/checkout?tier=enterprise'),
        env
      );
      const d = await res.json();
      assert.equal(res.status, 409);
      assert.equal(d.code, 'already_subscribed');
      assert.equal(calls.length, 0);
    }
  );
});

test('checkout: a canceled or missing row is NOT blocked', async () => {
  for (const sub of [null, { status: 'canceled', ls_subscription_id: SUB }]) {
    const env = baseEnv({ sub });
    await withFetch(
      url =>
        url.includes('/customers')
          ? paddleJson(200, { data: [{ id: 'ctm_1' }] })
          : paddleJson(200, { data: { checkout: { url: 'https://pay.test/c' } } }),
      async () => {
        const res = await handleBillingCheckout(
          await authedRequest(env, 'POST', 'https://x.test/api/billing/checkout'),
          env
        );
        assert.notEqual(res.status, 409);
      }
    );
  }
});

test('webhook: cancelling an OLD subscription does not strip the live one', async () => {
  const env = baseEnv({ sub: { status: 'active', ls_subscription_id: SUB } });
  const res = await handleBillingWebhook(
    await signedWebhook(env, subEvent('subscription.canceled', 'sub_OLD_duplicate', 'canceled')),
    env
  );
  assert.equal(res.status, 200);
  assert.equal(env.DB.log.filter(l => l.kind === 'run').length, 0, 'no write may happen');
});

test('webhook: the CURRENT subscription canceling still writes', async () => {
  const env = baseEnv({ sub: { status: 'active', ls_subscription_id: SUB } });
  await handleBillingWebhook(
    await signedWebhook(env, subEvent('subscription.canceled', SUB, 'canceled')),
    env
  );
  const writes = env.DB.log.filter(l => l.kind === 'run');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args[1], SUB);
  assert.equal(writes[0].args[2], 'canceled');
});

test('webhook: first subscription for an owner writes sub id, status and period end in seconds', async () => {
  const env = baseEnv({ sub: null });
  await handleBillingWebhook(
    await signedWebhook(env, subEvent('subscription.activated', SUB, 'active')),
    env
  );
  const w = env.DB.log.filter(l => l.kind === 'run')[0];
  assert.equal(w.args[0], 'owner-1');
  assert.equal(w.args[1], SUB);
  assert.equal(w.args[2], 'active');
  assert.equal(w.args[5], PERIOD_END_SEC - 0 /* 2026-11-08T16:16:48Z */);
});

test('webhook: a bad signature is 401 and writes nothing', async () => {
  const env = baseEnv({ sub: null });
  const req = new Request('https://x.test/api/billing/webhook', {
    method: 'POST',
    headers: { 'Paddle-Signature': 'ts=' + Math.floor(Date.now() / 1000) + ';h1=deadbeef' },
    body: JSON.stringify(subEvent('subscription.activated', SUB, 'active'))
  });
  const res = await handleBillingWebhook(req, env);
  assert.equal(res.status, 401);
  assert.equal(env.DB.log.length, 0);
});
