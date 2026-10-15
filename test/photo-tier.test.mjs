/* ============================================================
   PHOTO UPLOAD PAID TIER (W10, 2026-10-15)
   ------------------------------------------------------------
   The owner's rule: a FREE account must not be able to upload
   photos. A photo writes bytes into R2, so uploading is a paid
   feature - viewing what is already there is not, and stays open
   to every role that could see it before.

   What these tests pin, because each one fails silently in
   production if it regresses:

     - billing DORMANT (no Paddle secrets) changes nothing at all.
       Every other entitlement check in this codebase is dormant
       until configured, and this one must be too, or a deployment
       without billing would refuse uploads it never used to.
     - billing ON and no account can be found to bill -> refused
       402. This is the hole a free tier would use: a project
       created while signed out has cloud_projects.google_sub NULL,
       so nobody's subscription covers it.
     - billing ON and the project owner's subscription is active
       (or past_due - a failed payment keeps entitlement while
       Paddle retries) -> the upload goes through.
     - billing ON and the owner's subscription is gone/expired
       -> refused.
     - auth and role are still checked FIRST: a wrong or missing
       owner code answers 403 exactly as it did before, and never
       402, so an unauthenticated caller learns nothing about
       billing from the status code.
     - a refusal stores NOTHING: no R2 object, no metadata row.

   The real round trip (upload -> list -> bytes -> meta -> delete)
   and the role matrix live in tools/qa-cloud-photos.cjs against a
   real wrangler dev; these are the ledger-side checks that harness
   cannot reach without a subscription row.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePhotoUpload } from '../src/cloud/photos.js';
import { hashOwnerCode } from '../src/lib/http.js';

// A real 1x1 PNG, so the content-type and size paths run on real bytes.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

const OWNER_CODE = 'ABCD-EFGH-JKLM-NPQR';
const PROJECT_ID = 'p1';
// The same identity namespace: cloud_projects.google_sub is what
// handleCloudCreate writes from session.sub, and cloud_subscriptions is
// keyed on owner_sub (migration 0007 treats them identically).
const OWNER_SUB = '102577792911984404733';

const PADDLE_ON = {
  PADDLE_WEBHOOK_SECRET: 'whsec_test',
  PADDLE_API_KEY: 'paddle_api_test',
  PADDLE_PRICE_ID: 'pri_test'
};

async function makeEnv(opts = {}) {
  const o = Object.assign(
    {
      billing: false,
      googleSub: OWNER_SUB,
      // owner_sub -> status. Missing key means no subscription row at all.
      subs: {}
    },
    opts
  );
  const salt = '0123456789abcdef0123456789abcdef';
  const hash = await hashOwnerCode(OWNER_CODE, salt);

  const project = {
    project_id: PROJECT_ID,
    owner_code_salt: salt,
    owner_code_hash: hash,
    owner_code_fingerprint: 'fp',
    google_sub: o.googleSub,
    google_name: 'QA Owner',
    owner_label: 'QA',
    latest_r2_key: null,
    created_at: '2026-10-15T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
    last_owner_seen_at: '2026-10-15T00:00:00.000Z',
    deleted_at: null
  };

  const sql = [];
  const r2Put = [];

  const prepare = statement => ({
    bind: (...args) => ({
      first: async () => {
        sql.push({ statement, args });
        if (statement.indexOf('FROM cloud_projects') !== -1) {
          // Only the seeded project exists; any other id must miss, which is
          // what makes the local-only-project refusal meaningful.
          return args[0] === PROJECT_ID ? project : null;
        }
        if (statement.indexOf('FROM cloud_subscriptions') !== -1) {
          const status = o.subs[args[0]];
          return status ? { status: status } : null;
        }
        if (statement.indexOf('COUNT(*)') !== -1) {
          return { c: 0 };
        }
        if (statement.indexOf('MAX(sort_order)') !== -1) {
          return { n: 1 };
        }
        // The upload re-reads the row it just wrote to build its response.
        if (
          statement.indexOf('FROM cloud_project_photos') !== -1 &&
          statement.indexOf('WHERE id') !== -1
        ) {
          return {
            id: args[0],
            photo_id: 'photo-test-1',
            filename: 'site.png',
            caption: 'Foundation pour',
            captured_at: null,
            uploaded_by: 'Owner',
            content_type: 'image/png',
            size_bytes: PNG.length,
            sort_order: 1,
            created_at: '2026-10-15T00:00:00.000Z'
          };
        }
        return null;
      },
      run: async () => {
        sql.push({ statement, args });
        return { meta: { changes: 1, last_row_id: 1 } };
      },
      all: async () => {
        sql.push({ statement, args });
        return { results: [] };
      }
    }),
    run: async () => {
      sql.push({ statement, args: [] });
      return { meta: { changes: 1 } };
    }
  });

  const env = {
    DB: { prepare },
    R2: {
      put: async key => {
        r2Put.push(key);
      },
      list: async () => ({ objects: [], truncated: false }),
      delete: async () => {}
    },
    KV: {
      get: async () => null,
      put: async () => {}
    }
  };
  if (o.billing) {
    Object.assign(env, PADDLE_ON);
  }
  return { env, sql, r2Put };
}

function uploadRequest(headers = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'site.png');
  fd.append('caption', 'Foundation pour');
  return new Request('https://example.test/api/cloud/projects/' + PROJECT_ID + '/photos', {
    method: 'POST',
    headers: Object.assign({ 'X-Owner-Code': OWNER_CODE }, headers),
    body: fd
  });
}

const didInsert = sql =>
  sql.some(s => s.statement.indexOf('INSERT INTO cloud_project_photos') === 0);

test('billing dormant: the gate changes nothing, the upload succeeds', async () => {
  const f = await makeEnv({ billing: false, googleSub: null, subs: {} });
  const res = await handlePhotoUpload(uploadRequest(), f.env, PROJECT_ID);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.ok(body.photo && body.photo.id, 'a photo id comes back');
  assert.equal(f.r2Put.length, 1, 'the blob was written');
  assert.equal(didInsert(f.sql), true);
});

test('billing on, no account to bill: refused 402 and NOTHING is stored', async () => {
  // google_sub NULL (created while signed out) AND no session on the
  // request -> there is nobody whose subscription could cover this upload.
  const f = await makeEnv({ billing: true, googleSub: null, subs: {} });
  const res = await handlePhotoUpload(uploadRequest(), f.env, PROJECT_ID);
  const body = await res.json();
  assert.equal(res.status, 402, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.equal(body.code, 'upgrade_required');
  assert.equal(body.upgrade, true);
  assert.match(String(body.error), /paid plan/);
  // The refusal happens before the body is stored, not after it.
  assert.equal(f.r2Put.length, 0, 'no R2 object was written');
  assert.equal(didInsert(f.sql), false, 'no metadata row was written');
});

test('billing on, owner is signed out and has no subscription: refused 402', async () => {
  const f = await makeEnv({ billing: true, googleSub: OWNER_SUB, subs: {} });
  const res = await handlePhotoUpload(uploadRequest(), f.env, PROJECT_ID);
  const body = await res.json();
  assert.equal(res.status, 402, JSON.stringify(body));
  assert.equal(body.upgrade, true);
  assert.equal(f.r2Put.length, 0);
});

test('billing on, owner subscription active: the upload goes through', async () => {
  const f = await makeEnv({ billing: true, googleSub: OWNER_SUB, subs: { [OWNER_SUB]: 'active' } });
  const res = await handlePhotoUpload(uploadRequest(), f.env, PROJECT_ID);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(f.r2Put.length, 1);
});

test('billing on, past_due still uploads - a failed payment keeps entitlement', async () => {
  const f = await makeEnv({
    billing: true,
    googleSub: OWNER_SUB,
    subs: { [OWNER_SUB]: 'past_due' }
  });
  const res = await handlePhotoUpload(uploadRequest(), f.env, PROJECT_ID);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
});

test('billing on, subscription cancelled or expired: refused 402', async () => {
  for (const status of ['canceled', 'cancelled', 'expired', 'trial_expired', 'paused']) {
    const f = await makeEnv({ billing: true, googleSub: OWNER_SUB, subs: { [OWNER_SUB]: status } });
    const res = await handlePhotoUpload(uploadRequest(), f.env, PROJECT_ID);
    const body = await res.json();
    assert.equal(res.status, 402, status + ' -> ' + JSON.stringify(body));
    assert.equal(body.upgrade, true, status);
    assert.equal(f.r2Put.length, 0, status);
  }
});

test('a wrong owner code is still 403, never 402 - auth runs before billing', async () => {
  const f = await makeEnv({ billing: true, googleSub: OWNER_SUB, subs: {} });
  const req = uploadRequest({ 'X-Owner-Code': 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
  const res = await handlePhotoUpload(req, f.env, PROJECT_ID);
  assert.equal(res.status, 403, 'a failed credential must not reveal the billing gate');
  assert.equal(f.r2Put.length, 0);
});

test('no credentials at all is still 403, never 402', async () => {
  const f = await makeEnv({ billing: true, googleSub: OWNER_SUB, subs: { [OWNER_SUB]: 'active' } });
  const req = uploadRequest({ 'X-Owner-Code': '' });
  const res = await handlePhotoUpload(req, f.env, PROJECT_ID);
  assert.equal(res.status, 403);
  assert.equal(f.r2Put.length, 0);
});

test('a project with no cloud row is still 403 before any billing question', async () => {
  const f = await makeEnv({ billing: true });
  const res = await handlePhotoUpload(uploadRequest(), f.env, 'local-only-project');
  assert.equal(res.status, 403);
  assert.equal(f.r2Put.length, 0);
});
