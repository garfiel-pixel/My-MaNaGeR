/* ============================================================
   SUBSCRIPTION ORPHAN EVIDENCE (2026-11-25)
   ------------------------------------------------------------
   A project "delete" is a soft delete (deleted_at), so the row
   still exists and can be restored. That is deliberately enough
   to keep its paid subscription row visible: purging the project
   is the only way to release it. A deleted account therefore
   does NOT make its subscription an orphan on refresh.

   These checks pin the operator-facing explanation so the row
   says WHY it is still there and what to do next, instead of
   looking like a stubborn duplicate.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminSubscriptionList, handleAdminSubscriptionClear } from '../src/admin.js';

const OWNER = 'email:deleted@example.com';

function envWith(opts = {}) {
  const projectRow = opts.projectRow === undefined ? null : opts.projectRow;
  const subscriptionRow = {
    owner_sub: OWNER,
    ls_subscription_id: 'sub_1',
    status: 'active',
    plan: 'pro',
    tier: 'pro',
    current_period_end: null,
    updated_at: '2026-11-25T00:00:00.000Z'
  };
  const env = {
    ADMIN_CODE: 'test-code',
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.indexOf('cloud_projects') > -1) return projectRow;
                if (sql.indexOf('cloud_subscriptions') > -1) {
                  return { owner_sub: OWNER, ls_subscription_id: 'sub_1', status: 'active' };
                }
                return null;
              }
            };
          },
          all: async () => ({ results: opts.noSubscription ? [] : [subscriptionRow] })
        };
      }
    }
  };
  return env;
}

function request() {
  return new Request('https://example.com/api/admin/billing/subscriptions', {
    headers: { 'X-Admin-Code': 'test-code' }
  });
}

async function list(opts) {
  const res = await handleAdminSubscriptionList(request(), envWith(opts));
  assert.equal(res.status, 200);
  return (await res.json()).subscriptions[0];
}

test('a soft-deleted cloud project still holds the subscription and explains why', async () => {
  const row = await list({ projectRow: { deleted_at: '2026-11-25T00:00:00.000Z' } });
  assert.equal(row.orphaned, false);
  assert.match(row.evidence, /soft-deleted cloud project/);
  assert.match(row.evidence, /Delete permanently/);
});

test('a live cloud project holds the subscription with the plain evidence', async () => {
  const row = await list({ projectRow: { deleted_at: null } });
  assert.equal(row.orphaned, false);
  assert.equal(row.evidence, 'owns a cloud project');
});

test('with no remaining proof the subscription is an orphan', async () => {
  const row = await list({});
  assert.equal(row.orphaned, true);
  assert.match(row.evidence, /no account, project/);
});

test('clearing refuses a soft-deleted project before touching the provider', async () => {
  const env = envWith({ projectRow: { deleted_at: '2026-11-25T00:00:00.000Z' } });
  const res = await handleAdminSubscriptionClear(
    new Request('https://example.com/api/admin/billing/subscriptions/clear', {
      method: 'POST',
      headers: { 'X-Admin-Code': 'test-code', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerSub: OWNER })
    }),
    env
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'orphan');
  assert.match(body.error, /soft-deleted cloud project/);
});
