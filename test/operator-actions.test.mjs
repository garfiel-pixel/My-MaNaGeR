/* ============================================================
   OPERATOR PROJECT ACTIONS (2026-11-25)
   ------------------------------------------------------------
   /operator lists every project on the site. Reissue, Restore and
   Purge used the ordinary project-owner gate, so an operator acting
   on somebody else's project always got 403 and the row stayed on
   the list after refresh ("delete does nothing"). These tests drive
   the real handlers with a forged operator session + admin token:
     - owner still works the old way (code returned inline);
     - the operator token is an explicit override on all three routes;
     - a caller with neither is refused;
     - an operator reissue emails the new code to the project's
       VERIFIED owner address and never prints it in the console.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleCloudProjectPurge,
  handleCloudProjectRestore,
  handleCloudRecover
} from '../src/cloud/projects.js';
import { signSession, sessionKey } from '../src/lib/http.js';

const OPERATOR_SUB = 'google:owner-account';
const OTHER_SUB = 'google:someone-else';
const OPERATOR_EMAIL = 'garfieldprocis@gmail.com';
const PROJECT_EMAIL = 'project-owner@example.com';
const SECRET = 'test-secret-operator-actions';
const TOKEN = 'operator-token-abc123';
const PID = 'test-project-0001';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeDb(state) {
  return {
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) {
          stmt.args = args;
          return stmt;
        },
        async first() {
          if (sql.indexOf('FROM admin_sessions WHERE token_hash = ?') > -1) {
            return state.sessions.find(s => s.token_hash === stmt.args[0]) || null;
          }
          if (sql.indexOf('FROM cloud_projects WHERE project_id = ?') > -1) {
            if (sql.indexOf('owner_email') > -1) {
              return {
                owner_email: state.project.ownerEmail || null,
                google_sub: state.project.googleSub
              };
            }
            return {
              google_sub: state.project.googleSub,
              google_name: state.project.label,
              owner_label: state.project.label
            };
          }
          return null;
        },
        async run() {
          state.writes.push(sql);
          return { meta: { changes: 1 } };
        }
      };
      return stmt;
    }
  };
}

function makeState(overrides) {
  const project = Object.assign(
    { googleSub: OTHER_SUB, ownerEmail: PROJECT_EMAIL, label: 'A site project' },
    (overrides && overrides.project) || {}
  );
  return {
    project,
    writes: [],
    sessions: [],
    mail: []
  };
}

async function makeEnv(state) {
  return {
    SESSION_SECRET: SECRET,
    GOOGLE_CLIENT_SECRET: SECRET,
    RESEND_API_KEY: 'test-resend-key',
    RESEND_FROM_EMAIL: 'admin@mymanagerworkspace.com',
    R2: {
      async list() {
        return { objects: [] };
      },
      async delete() {}
    },
    DB: makeDb(state)
  };
}

async function cookieFor(env, sub, email) {
  const key = await sessionKey(env);
  const token = await signSession({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600 }, key);
  return 'mmgr_session=' + token;
}

async function request(pathname, sub, email, withToken) {
  const env = await makeEnv(globalThis.__state);
  const headers = { Cookie: await cookieFor(env, sub, email) };
  if (withToken) {
    headers['X-Admin-Session'] = TOKEN;
    globalThis.__state.sessions = [
      {
        sub: OPERATOR_SUB,
        token_hash: await sha256Hex(TOKEN),
        expires_at: new Date(Date.now() + 3600000).toISOString()
      }
    ];
  }
  return {
    env,
    req: new Request('https://mymanagerworkspace.com' + pathname, {
      method: 'POST',
      headers,
      body: '{}'
    })
  };
}

function stubMail(state) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).indexOf('/emails') > -1) {
      state.mail.push({ url: String(url), body: String((opts && opts.body) || '') });
      return new Response('{"id":"test"}', { status: 200 });
    }
    return original(url, opts);
  };
  return () => {
    globalThis.fetch = original;
  };
}

test('operator token allows Purge of another account project', async () => {
  globalThis.__state = makeState();
  const { env, req } = await request(
    '/api/cloud/projects/' + PID + '/purge',
    OPERATOR_SUB,
    OPERATOR_EMAIL,
    true
  );
  const res = await handleCloudProjectPurge(req, env, PID);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('without the operator token the same Purge is refused', async () => {
  globalThis.__state = makeState();
  const { env, req } = await request(
    '/api/cloud/projects/' + PID + '/purge',
    OPERATOR_SUB,
    OPERATOR_EMAIL,
    false
  );
  const res = await handleCloudProjectPurge(req, env, PID);
  assert.equal(res.status, 403);
});

test('operator token allows Restore of another account project', async () => {
  globalThis.__state = makeState();
  const { env, req } = await request(
    '/api/cloud/projects/' + PID + '/restore',
    OPERATOR_SUB,
    OPERATOR_EMAIL,
    true
  );
  const res = await handleCloudProjectRestore(req, env, PID);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).restored, PID);
});

test('operator reissue emails the new code and never returns it in the response', async () => {
  globalThis.__state = makeState();
  const restoreFetch = stubMail(globalThis.__state);
  try {
    const { env, req } = await request(
      '/api/cloud/projects/' + PID + '/recover',
      OPERATOR_SUB,
      OPERATOR_EMAIL,
      true
    );
    const res = await handleCloudRecover(req, env, PID);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.delivered, 'email');
    assert.equal(body.to, PROJECT_EMAIL);
    assert.equal(body.ownerCode, undefined);
    assert.equal(globalThis.__state.mail.length, 1);
    assert.ok(globalThis.__state.mail[0].body.indexOf('New owner code:') > -1);
  } finally {
    restoreFetch();
  }
});

test('operator reissue refuses before rotating when the project has no verified email', async () => {
  globalThis.__state = makeState({ project: { ownerEmail: null } });
  const { env, req } = await request(
    '/api/cloud/projects/' + PID + '/recover',
    OPERATOR_SUB,
    OPERATOR_EMAIL,
    true
  );
  const res = await handleCloudRecover(req, env, PID);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /no verified owner email/);
  assert.equal(
    globalThis.__state.writes.some(s => s.indexOf('SET owner_code_salt') > -1),
    false
  );
});

test('the project owner still gets the code inline and no email is sent', async () => {
  globalThis.__state = makeState();
  const restoreFetch = stubMail(globalThis.__state);
  try {
    const { env, req } = await request(
      '/api/cloud/projects/' + PID + '/recover',
      OTHER_SUB,
      PROJECT_EMAIL,
      false
    );
    const res = await handleCloudRecover(req, env, PID);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.ownerCode, /^[A-Za-z0-9-]+$/);
    assert.equal(globalThis.__state.mail.length, 0);
  } finally {
    restoreFetch();
  }
});
