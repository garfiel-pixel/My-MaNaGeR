/* ============================================================
   CALC WORKSPACE READ HARDENING (MCP-FINAL F1.6, 2026-11-16)
   ------------------------------------------------------------
   calc-ws/<sub>.json lives in R2 and is written by an older client,
   so its contents are untrusted storage. These tests drive the real
   handlers with a fake R2 and pin the read contract:

     - malformed JSON          -> ws:null, never a throw
     - a JSON array            -> ws:null (an array is not a workspace)
     - a JSON string / HTML    -> ws:null (nothing is echoed back)
     - a plain object          -> returned intact
     - PUT array               -> 400 (write side stays strict)
     - PUT object              -> stored with savedAt

   The session cookie is minted here with the same HMAC scheme the
   Worker uses, so readSession accepts it without a D1 row (no jti).
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleCalcWorkspaceGet, handleCalcWorkspacePut } from '../src/cloud/calc-workspace.js';

const SECRET = 'qa-calc-ws-secret';
const SUB = 'sub-calc-ws-qa';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function cookie() {
  // readSession signs the DECODED payload string, then base64url-encodes both
  // halves: <b64url(json)>.<b64url(hmac(json))>.
  const json = JSON.stringify({ sub: SUB, exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = b64url(createHmac('sha256', SECRET).update(json).digest());
  return 'mmgr_session=' + b64url(json) + '.' + sig;
}

function makeEnv(raw) {
  const stored = [];
  return {
    GOOGLE_CLIENT_SECRET: SECRET,
    R2: {
      async get(key) {
        assert.equal(key, 'calc-ws/' + SUB + '.json');
        return raw === undefined ? null : { text: async () => raw };
      },
      async put(key, value) {
        stored.push({ key, value });
      }
    },
    stored
  };
}

async function getWs(raw) {
  const env = makeEnv(raw);
  const req = new Request('https://example.test/api/calc/workspace', {
    headers: { Cookie: cookie() }
  });
  const res = await handleCalcWorkspaceGet(req, env);
  return { status: res.status, body: await res.json() };
}

test('malformed JSON in R2 reads as an empty workspace', async () => {
  const r = await getWs('{not json at all');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.ws, null);
});

test('a JSON array is not a workspace and is discarded', async () => {
  const r = await getWs(JSON.stringify([{ evil: true }]));
  assert.equal(r.status, 200);
  assert.equal(r.body.ws, null);
});

test('a JSON string carrying markup is discarded, never echoed', async () => {
  const r = await getWs(JSON.stringify('<script>alert(1)</script>'));
  assert.equal(r.status, 200);
  assert.equal(r.body.ws, null);
});

test('a plain object round-trips unchanged', async () => {
  const ws = { brand: { val: { name: 'Fairclough Build Ltd' }, updatedAt: 1 } };
  const r = await getWs(JSON.stringify(ws));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.ws, ws);
});

test('PUT rejects an array body with 400', async () => {
  const env = makeEnv(null);
  const req = new Request('https://example.test/api/calc/workspace', {
    method: 'PUT',
    headers: { Cookie: cookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify([1, 2, 3])
  });
  const res = await handleCalcWorkspacePut(req, env);
  assert.equal(res.status, 400);
  assert.equal(env.stored.length, 0);
});

test('PUT stores an object with a savedAt stamp', async () => {
  const env = makeEnv(null);
  const req = new Request('https://example.test/api/calc/workspace', {
    method: 'PUT',
    headers: { Cookie: cookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ boq: { val: [], updatedAt: 0 } })
  });
  const res = await handleCalcWorkspacePut(req, env);
  assert.equal(res.status, 200);
  assert.equal(env.stored.length, 1);
  const saved = JSON.parse(env.stored[0].value);
  assert.equal(saved.boq.updatedAt, 0);
  assert.equal(typeof saved.savedAt, 'string');
});
