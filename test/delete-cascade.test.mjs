/* ============================================================
   DELETE CASCADE (W2, 2026-10-15)
   ------------------------------------------------------------
   Before this work, deleting a project or an account left data
   behind permanently:

     - R2 objects under photos/<project_id>/ were never listed.
       cloudDeleteProjectFully only walked projects/<id>/, so every
       uploaded site photo survived project deletion, account
       deletion AND the nightly orphan sweep forever.
     - cloud_client_codes, cloud_api_keys, cloud_team_members,
       cloud_pool_links, webhook_subscriptions and
       cloud_project_photos landed in migrations 0017-0025, all
       after the helper was written, and none were added to it.
     - Deleting an ACCOUNT left the account referenced in other
       people's projects (team membership, adoption, pool item)
       plus its calculator workspace blob.

   These tests drive the real functions with a fake env and assert
   the cascade, because the failure mode is invisible: nothing
   errors, the rows and blobs just stay.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudDeleteProjectFully, cloudPurgeAccountRows } from '../src/cloud/projects.js';

const OTHER_KEY = 'projects/other/latest.json';

function fakeEnv(opts = {}) {
  const sql = [];
  const deleted = [];
  const keys = {
    'projects/p1/': ['projects/p1/latest.json', 'projects/p1/changelog/abc.json'],
    'photos/p1/': ['photos/p1/photo-a.jpg', 'photos/p1/photo-b.png'],
    'projects/other/': [OTHER_KEY],
    'photos/other/': ['photos/other/keep-me.jpg'],
    'calc-ws/email:user@example.com.json': []
  };
  const prepare = statement => {
    const record = args => {
      if (
        opts.failTable &&
        (statement.indexOf('FROM ' + opts.failTable) !== -1 ||
          statement.indexOf('UPDATE ' + opts.failTable) !== -1)
      ) {
        throw new Error('no such table: ' + opts.failTable);
      }
      if (opts.hardFail) {
        throw new Error('database is locked');
      }
      sql.push({ statement, args });
      return { meta: { changes: 1 } };
    };
    return {
      bind(...args) {
        return {
          run: async () => record(args),
          first: async () => null,
          all: async () => ({ results: [] })
        };
      },
      run: async () => record([])
    };
  };
  return {
    env: {
      DB: { prepare },
      R2: {
        list: async ({ prefix }) => ({
          objects: (keys[prefix] || []).map(key => ({ key })),
          truncated: false
        }),
        delete: async key => {
          deleted.push(key);
        }
      }
    },
    sql,
    deleted
  };
}

const tablesDeleted = sql =>
  sql.map(s => (s.statement.match(/DELETE FROM ([a-z_]+)/) || [])[1]).filter(Boolean);

// Every project-scoped table that holds rows for one project_id.
const PROJECT_TABLES = [
  'cloud_editor_codes',
  'cloud_changelog',
  'cloud_adoptions',
  'offline_copies',
  'cloud_reviews',
  'cloud_client_codes',
  'cloud_api_keys',
  'cloud_team_members',
  'cloud_pool_links',
  'webhook_subscriptions',
  'cloud_project_photos'
];

test('project purge deletes BOTH R2 prefixes (state and photos)', async () => {
  const f = fakeEnv();
  await cloudDeleteProjectFully(f.env, 'p1');
  assert.deepEqual(f.deleted.sort(), [
    'photos/p1/photo-a.jpg',
    'photos/p1/photo-b.png',
    'projects/p1/changelog/abc.json',
    'projects/p1/latest.json'
  ]);
});

test('project purge never touches another project', async () => {
  const f = fakeEnv();
  await cloudDeleteProjectFully(f.env, 'p1');
  assert.equal(f.deleted.includes(OTHER_KEY), false);
  assert.equal(
    f.deleted.some(k => k.indexOf('other/') !== -1),
    false
  );
});

test('project purge deletes every project-scoped table', async () => {
  const f = fakeEnv();
  await cloudDeleteProjectFully(f.env, 'p1');
  const done = tablesDeleted(f.sql);
  const missing = PROJECT_TABLES.filter(t => done.indexOf(t) === -1);
  assert.deepEqual(missing, [], 'these tables kept rows after a project delete');
});

test('every project-scoped delete is bound to that project id only', async () => {
  const f = fakeEnv();
  await cloudDeleteProjectFully(f.env, 'p1');
  const withArgs = f.sql.filter(s => s.statement.indexOf('DELETE FROM') === 0);
  assert.equal(withArgs.length, PROJECT_TABLES.length);
  withArgs.forEach(s => {
    assert.match(s.statement, /WHERE project_id = \?$/, 'unscoped delete: ' + s.statement);
    assert.deepEqual(s.args, ['p1'], 'wrong bind for: ' + s.statement);
  });
});

// RE-BASELINED 2026-10-28 (RBAC sprint 1): membership is keyed by verified
// email, not by sub, so the purge now binds BOTH. A Google member's sub never
// equals the address the owner invited, so deleting by sub alone left the row
// inside someone else's project.
test('account purge removes team memberships, adoptions and pool rows', async () => {
  const f = fakeEnv();
  const sub = 'google-113487';
  await cloudPurgeAccountRows(f.env, sub, 'User@Example.com');
  const done = tablesDeleted(f.sql);
  ['cloud_team_members', 'cloud_adoptions', 'cloud_pool_links', 'cloud_pool_items'].forEach(t => {
    assert.equal(done.indexOf(t) !== -1, true, 'account purge missed ' + t);
  });
  const team = f.sql.filter(s => /DELETE FROM cloud_team_members/.test(s.statement))[0];
  assert.deepEqual(team.args, [sub, 'user@example.com'], 'membership delete must bind sub + email');
  f.sql
    .filter(s => s.statement.indexOf('DELETE FROM') === 0 && s !== team)
    .forEach(s => {
      assert.deepEqual(s.args, [sub], 'wrong bind for: ' + s.statement);
    });
});

test('account purge anonymises the membership audit trail but keeps the events', async () => {
  const f = fakeEnv();
  await cloudPurgeAccountRows(f.env, 'email:user@example.com', 'user@example.com');
  const updates = f.sql.filter(s => s.statement.indexOf('UPDATE cloud_team_audit') === 0);
  assert.equal(updates.length, 2, 'both the target and the actor side must be cleared');
  updates.forEach(u => {
    assert.match(u.statement, /SET .*NULL/);
    assert.deepEqual(u.args, ['user@example.com']);
  });
  assert.equal(
    updates.some(u => /invitee_email/i.test(u.statement)),
    false,
    'audit rows must survive: they are the project history, only identifiers go'
  );
});

// Production has been one migration behind before (0025), and account
// deletion must not break on a database without 0028.
test('a database without the audit table still deletes the account', async () => {
  const f = fakeEnv({ failTable: 'cloud_team_audit' });
  await cloudPurgeAccountRows(f.env, 'email:user@example.com', 'user@example.com');
  assert.equal(f.deleted.includes('calc-ws/email:user@example.com.json'), true);
  assert.equal(tablesDeleted(f.sql).includes('cloud_team_members'), true);
});

test('account purge deletes pool links BEFORE pool items (they reference the ids)', async () => {
  const f = fakeEnv();
  await cloudPurgeAccountRows(f.env, 'email:user@example.com');
  const done = tablesDeleted(f.sql);
  assert.equal(
    done.indexOf('cloud_pool_links') < done.indexOf('cloud_pool_items'),
    true,
    'links must go first or they are left pointing at deleted items'
  );
});

test('account purge deletes the calculator workspace blob', async () => {
  const f = fakeEnv();
  await cloudPurgeAccountRows(f.env, 'email:user@example.com');
  assert.equal(f.deleted.includes('calc-ws/email:user@example.com.json'), true);
});

// Verified 2026-10-15: production D1 is one migration BEHIND (0025_project_photos
// is unapplied), so the photos table does not exist there yet. An unconditional
// DELETE would have thrown and taken project deletion, account deletion and the
// nightly orphan sweep down with it.
test('a table whose migration is not applied yet does not break the purge', async () => {
  const f = fakeEnv({ failTable: 'cloud_project_photos' });
  await cloudDeleteProjectFully(f.env, 'p1');
  const done = tablesDeleted(f.sql);
  assert.equal(done.includes('cloud_project_photos'), false);
  const expected = PROJECT_TABLES.filter(t => t !== 'cloud_project_photos');
  const missing = expected.filter(t => done.indexOf(t) === -1);
  assert.deepEqual(missing, [], 'the OTHER tables must still be purged');
  // R2 must still be cleaned even though a table was missing.
  assert.equal(f.deleted.length, 4);
});

test('a real database error still propagates (only "no such table" is tolerated)', async () => {
  const f = fakeEnv({ hardFail: true });
  await assert.rejects(() => cloudDeleteProjectFully(f.env, 'p1'), /database is locked/);
});
