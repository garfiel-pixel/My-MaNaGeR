/* ============================================================
   SEC-14 - the MCP owner-code Bearer is counted, then gated.

   Audit 2026-11-01: the owner code is the full-power credential for the
   whole project. Sending it as an MCP Bearer hands that power to a
   third-party client, which is why the plan is a project API key
   (scoped, expiring, revocable). The cut cannot be made blind - the
   counter has to show who is still relying on it - and it cannot be made
   silent - the refusal has to name the replacement.

   These call the REAL handleMcpServer, so what is proven here is the
   behaviour a client meets, not a copy of it:

     1. Flag unset  -> the owner code still authenticates (no break),
                       and the use is logged as 'accepted'.
     2. Flag on     -> the owner code is refused with a JSON-RPC error
                       (-32001) at HTTP 200, naming the API key, and the
                       use is logged as 'refused'.
     3. Flag on     -> a real sk-mmgr- API key is NOT caught by the gate
                       (the replacement keeps working).
     4. No credentials -> no counter line, so the data is not polluted.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpServer } from '../src/mcp/server.js';

const PROJECT = 'qa-project';
const OWNER_CODE = 'owner-code-that-is-not-a-key';
const API_KEY = 'sk-mmgr-' + 'a'.repeat(32);

// Every query answers "nothing here": the point of the gate is that it
// decides BEFORE the credential is checked, so the database must never be
// reached on the refusal path. The log records any accidental query.
function fakeDb() {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              queries.push({ sql, args, kind: 'first' });
              return null;
            },
            async run() {
              queries.push({ sql, args, kind: 'run' });
              return {};
            },
            async all() {
              queries.push({ sql, args, kind: 'all' });
              return { results: [] };
            }
          };
        },
        async first() {
          queries.push({ sql, args: [], kind: 'first' });
          return null;
        }
      };
    }
  };
}

function mcpRequest(headers) {
  return new Request('https://mmgr.example/api/mcp/' + PROJECT, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  });
}

// Capture console.warn for the duration of one call and return the parsed
// lines that carry the SEC-14 event.
async function call(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    const res = await fn();
    const body = await res.clone().json();
    return {
      res,
      body,
      events: lines
        .map(l => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(e => e && e.event === 'mcp-owner-code-deprecated')
    };
  } finally {
    console.warn = original;
  }
}

test('flag unset: owner-code Bearer still passes the gate and is counted as accepted', async () => {
  const env = { DB: fakeDb() };

  // The accepted path rebuilds the Request around `request.body`, and Node's
  // Request constructor (unlike the Workers runtime) demands a `duplex`
  // option for a stream body. That throw is itself proof the gate let the
  // call through - a refused call never reaches the rebuild - so it is
  // caught here and asserted on, not hidden.
  let reachedForwarding = false;
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    await handleMcpServer(mcpRequest({ Authorization: 'Bearer ' + OWNER_CODE }), env, PROJECT);
  } catch (e) {
    reachedForwarding = /duplex/i.test(String(e && e.message));
    assert.ok(
      reachedForwarding,
      'the accepted path must fail only on Node duplex, not on a real error'
    );
  } finally {
    console.warn = original;
  }

  const events = lines
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(e => e && e.event === 'mcp-owner-code-deprecated');

  assert.equal(events.length, 1, 'one counter line per owner-code use');
  assert.equal(events[0].result, 'accepted');
  assert.equal(events[0].projectId, PROJECT);
});

test('flag on: owner-code Bearer is refused with -32001 naming the API key', async () => {
  const env = { DB: fakeDb(), MCP_REQUIRE_API_KEY: '1' };
  const out = await call(() =>
    handleMcpServer(mcpRequest({ Authorization: 'Bearer ' + OWNER_CODE }), env, PROJECT)
  );

  assert.equal(out.res.status, 200, 'refusal stays inside the protocol, never a transport 401');
  assert.equal(out.body.jsonrpc, '2.0');
  assert.equal(out.body.id, null);
  assert.equal(out.body.error.code, -32001);
  assert.match(out.body.error.message, /project API key/i);
  assert.match(out.body.error.message, /sk-mmgr-/);
  assert.equal(out.body.result, undefined);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].result, 'refused');
});

test('flag on: a real project API key is not caught by the owner-code gate', async () => {
  const env = { DB: fakeDb(), MCP_REQUIRE_API_KEY: '1' };
  const out = await call(() =>
    handleMcpServer(mcpRequest({ Authorization: 'Bearer ' + API_KEY }), env, PROJECT)
  );

  const code = out.body && out.body.error && out.body.error.code;
  assert.notEqual(code, -32001, 'the replacement credential must keep working');
  assert.equal(out.events.length, 0, 'API keys are not owner-code use');
});

test('no credentials: the counter stays silent', async () => {
  const env = { DB: fakeDb(), MCP_REQUIRE_API_KEY: '1' };
  const out = await call(() => handleMcpServer(mcpRequest({}), env, PROJECT));

  assert.equal(out.events.length, 0);
});

test('flag on: the gate decides before the credential is looked up', async () => {
  const db = fakeDb();
  const env = { DB: db, MCP_REQUIRE_API_KEY: '1' };
  await call(() =>
    handleMcpServer(mcpRequest({ Authorization: 'Bearer ' + OWNER_CODE }), env, PROJECT)
  );

  assert.equal(db.queries.length, 0, 'a refused owner code must not reach D1');
});
