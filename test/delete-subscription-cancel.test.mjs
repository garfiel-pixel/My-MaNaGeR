/* ============================================================
   ACCOUNT DELETION CANCELS THE SUBSCRIPTION (W3, 2026-10-15)
   ------------------------------------------------------------
   Owner decision: deleting your account cancels the subscription
   IMMEDIATELY and forfeits the remaining paid days. Two things are
   asserted here that a future edit could silently undo:

     1. effective_from is 'immediately' - the manage-subscription
        path uses 'next_billing_period' and returning to that value
        here would leave a deleted account billed to period end.
     2. A refusal from Paddle returns ok:false so the caller does
        NOT delete. Deleting the account while billing continues
        removes the only panel that could cancel it.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingCancelForDeletion } from '../src/billing.js';

const LIVE = {
  PADDLE_WEBHOOK_SECRET: 'whsec_test',
  PADDLE_API_KEY: 'test_key',
  PADDLE_PRICE_ID: 'pri_test',
  PADDLE_ENV: 'live'
};

function envWith(row, opts = {}) {
  const env = Object.assign({}, LIVE, opts.env || {});
  env.DB = {
    prepare() {
      return {
        bind() {
          return {
            first: async () => {
              if (opts.dbThrows) {
                throw new Error('d1 down');
              }
              return row;
            }
          };
        }
      };
    }
  };
  return env;
}

// Runs fn with globalThis.fetch replaced, always restoring the real one.
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const neverCalled = async () => {
  throw new Error('fetch should not have been called');
};

test('no subscription row: nothing to cancel, no network call', async () => {
  const env = envWith(null);
  const out = await withFetch(neverCalled, () => billingCancelForDeletion(env, 'email:a@b.co'));
  assert.deepEqual(out, { ok: true });
});

test('a cancelled subscription does not block deletion', async () => {
  const env = envWith({ status: 'canceled', ls_subscription_id: 'sub_x' });
  const out = await withFetch(neverCalled, () => billingCancelForDeletion(env, 'email:a@b.co'));
  assert.deepEqual(out, { ok: true });
});

test('an ACTIVE subscription is cancelled with effective_from immediately', async () => {
  const env = envWith({ status: 'active', ls_subscription_id: 'sub_123' });
  let seen = null;
  const out = await withFetch(
    async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    () => billingCancelForDeletion(env, 'email:a@b.co')
  );
  assert.deepEqual(out, { ok: true });
  assert.equal(seen.url, 'https://api.paddle.com/subscriptions/sub_123/cancel');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer test_key');
  assert.deepEqual(JSON.parse(seen.init.body), { effective_from: 'immediately' });
});

test('a past_due subscription is cancelled too (billing grace is still billing)', async () => {
  const env = envWith({ status: 'past_due', ls_subscription_id: 'sub_pd' });
  let called = false;
  const out = await withFetch(
    async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
    () => billingCancelForDeletion(env, 'email:a@b.co')
  );
  assert.equal(called, true);
  assert.equal(out.ok, true);
});

test('sandbox deployments hit the sandbox API', async () => {
  const env = envWith(
    { status: 'active', ls_subscription_id: 'sub_s' },
    { env: { PADDLE_ENV: 'sandbox' } }
  );
  let url = '';
  await withFetch(
    async u => {
      url = u;
      return { ok: true, status: 200, json: async () => ({}) };
    },
    () => billingCancelForDeletion(env, 'email:a@b.co')
  );
  assert.match(url, /^https:\/\/sandbox-api\.paddle\.com\//);
});

test('a refusal from Paddle BLOCKS deletion (ok:false)', async () => {
  const env = envWith({ status: 'active', ls_subscription_id: 'sub_403' });
  const out = await withFetch(
    async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { detail: 'no scope' } })
    }),
    () => billingCancelForDeletion(env, 'email:a@b.co')
  );
  assert.equal(out.ok, false);
  assert.match(out.error, /refused/);
});

test('a subscription already gone at Paddle counts as cancelled', async () => {
  const env = envWith({ status: 'active', ls_subscription_id: 'sub_missing' });
  const out = await withFetch(
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    () => billingCancelForDeletion(env, 'email:a@b.co')
  );
  assert.equal(out.ok, true);
  assert.equal(out.alreadyGone, true);
});

test('an unreachable Paddle blocks deletion (never bill a deleted account)', async () => {
  const env = envWith({ status: 'active', ls_subscription_id: 'sub_net' });
  const out = await withFetch(
    async () => {
      throw new Error('network');
    },
    () => billingCancelForDeletion(env, 'email:a@b.co')
  );
  assert.equal(out.ok, false);
});

test('a missing subscription reference blocks deletion', async () => {
  const env = envWith({ status: 'active', ls_subscription_id: '' });
  const out = await withFetch(neverCalled, () => billingCancelForDeletion(env, 'email:a@b.co'));
  assert.equal(out.ok, false);
});

test('an unreadable database blocks deletion rather than guessing', async () => {
  const env = envWith(null, { dbThrows: true });
  const out = await withFetch(neverCalled, () => billingCancelForDeletion(env, 'email:a@b.co'));
  assert.equal(out.ok, false);
});
