#!/usr/bin/env node
/* ============================================================
   My MaNaGeR — Wave 2 app-wide MCP ADMIN API harness (node).

   Drives the account-scoped admin handlers in src/mcp/appwide.js
   (handleMcpAdminConfig / ClientsList / ClientRevoke /
   ProjectEnabled) against an in-memory mock D1 + a real HMAC
   session cookie (the same readSession path the Worker uses).

   Run:  node tools/qa-mcp-admin.cjs
   ============================================================ */
'use strict';

const APPWIDE = '../src/mcp/appwide.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + '  => ' + JSON.stringify(extra));
  }
}
function section(t) {
  console.log('\n--- ' + t + ' ---');
}

// ---- mock D1 + session cookie -------------------------------------------
const crypto = globalThis.crypto;
const SESSION_SECRET = 'test-secret-for-admin-harness';

async function signSessionCookie(sub) {
  const { base64UrlEncode, bytesToBase64Url } = await import('../src/lib/http.js');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const jsonStr = JSON.stringify({
    sub: sub,
    email: sub + '@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(jsonStr));
  return 'mmgr_session=' + base64UrlEncode(jsonStr) + '.' + bytesToBase64Url(new Uint8Array(sig));
}

function makeEnv(seed) {
  const store = {
    mcp_server_config: seed.config ? [seed.config] : [],
    mcp_clients: seed.clients || [],
    mcp_tokens: seed.tokens || [],
    cloud_projects: seed.projects || [],
    cloud_adoptions: seed.adoptions || []
  };
  let clientSeq = 500;

  function route(sql, args) {
    const s = sql.toLowerCase();
    if (s.startsWith('update ')) {
      const m = sql.match(/update\s+(\w+)\s+set\s+([^;]+)/i);
      const table = m[1];
      // crude: pull the SET column assignments by position is hard; handle the
      // few statements this harness drives explicitly.
      if (table === 'mcp_server_config') {
        const row = store.mcp_server_config.find(r => r.account_sub === args[3]) || null;
        if (row) {
          row.enabled = args[0];
          row.policy = args[1];
          row.tool_subset = args[2];
        }
        return { meta: { changes: row ? 1 : 0 } };
      }
      if (table === 'mcp_clients') {
        const n = store.mcp_clients.filter(
          c => c.account_sub === args[0] && c.client_id === args[1]
        ).length;
        store.mcp_clients.forEach(c => {
          if (c.account_sub === args[0] && c.client_id === args[1]) {
            c.revoked = 1;
          }
        });
        return { meta: { changes: n } };
      }
      if (table === 'mcp_tokens') {
        const n = store.mcp_tokens.filter(
          t => t.account_sub === args[0] && t.client_id === args[1]
        ).length;
        store.mcp_tokens.forEach(t => {
          if (t.account_sub === args[0] && t.client_id === args[1]) {
            t.revoked = 1;
          }
        });
        return { meta: { changes: n } };
      }
      if (table === 'cloud_projects') {
        const row = store.cloud_projects.find(p => p.project_id === args[1]);
        if (row) {
          row.mcp_enabled = args[0];
        }
        return { meta: { changes: row ? 1 : 0 } };
      }
      return { meta: { changes: 0 } };
    }
    if (s.startsWith('insert into')) {
      const m = sql.match(/insert into\s+(\w+)\s*\(([^)]+)\)/i);
      const table = m[1];
      const cols = m[2].split(',').map(c => c.trim());
      const row = {};
      cols.forEach((c, i) => {
        row[c] = args[i];
      });
      store[table].push(row);
      return { meta: { changes: 1, last_row_id: row.id || 1 } };
    }
    if (s.includes('from mcp_server_config')) {
      return store.mcp_server_config.find(r => r.account_sub === args[0]) || null;
    }
    if (s.includes('from mcp_clients')) {
      // SELECT client_id FROM mcp_clients WHERE account_sub = ? (list) or
      // ... AND client_id = ? (revoke lookup).
      const rows = store.mcp_clients.filter(c => c.account_sub === args[0]);
      const filtered = args.length > 1 ? rows.filter(c => c.client_id === args[1]) : rows;
      return filtered.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    if (s.includes('from cloud_projects') && s.includes('google_sub = ? or owner_email = ?')) {
      const pid = args[0];
      const sub = args[1];
      return (
        store.cloud_projects.find(
          p =>
            p.project_id === pid && !p.deleted_at && (p.google_sub === sub || p.owner_email === sub)
        ) || null
      );
    }
    if (s.includes('from cloud_adoptions')) {
      const sub = args[0];
      const pid = args[1];
      return (
        store.cloud_adoptions.find(a => a.recipient_sub === sub && a.project_id === pid) || null
      );
    }
    return null;
  }

  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const r = route(sql, args);
              return Array.isArray(r) ? r[0] || null : r;
            },
            async all() {
              const r = route(sql, args);
              return { results: Array.isArray(r) ? r : r ? [r] : [] };
            },
            async run() {
              return route(sql, args) || { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
  return { DB: db, GOOGLE_CLIENT_SECRET: SESSION_SECRET, KV: {}, R2: {}, _store: store };
}

async function asRequest(method, path, body, cookie) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) {
    headers['cookie'] = cookie;
  }
  return new Request('http://localhost' + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

async function call(method, path, body, cookie) {
  const mod = await import(APPWIDE);
  const req = await asRequest(method, path, body, cookie);
  if (path === '/api/mcp/config') {
    return mod.handleMcpAdminConfig(req, makeEnvFor(cookie));
  }
  if (path === '/api/mcp/clients') {
    return mod.handleMcpAdminClientsList(req, makeEnvFor(cookie));
  }
  if (path === '/api/mcp/clients/revoke') {
    return mod.handleMcpAdminClientRevoke(req, makeEnvFor(cookie));
  }
  const pm = path.match(/^\/api\/mcp\/projects\/([A-Za-z0-9_-]{1,64})\/enabled$/);
  if (pm) {
    return mod.handleMcpAdminProjectEnabled(req, makeEnvFor(cookie), pm[1]);
  }
  return null;
}

// The env must be stable across the cookie used; build one per call from the
// shared seed so writes persist within a scenario via module-level seed.
const SEED = {
  config: null,
  clients: [
    {
      account_sub: 'sub-abc',
      client_id: 'client-1',
      name: 'Claude',
      created_at: '2026-01-01',
      last_used_at: null,
      revoked: 0
    },
    {
      account_sub: 'sub-abc',
      client_id: 'client-2',
      name: 'ChatGPT',
      created_at: '2026-02-01',
      last_used_at: null,
      revoked: 0
    },
    {
      account_sub: 'sub-other',
      client_id: 'client-x',
      name: 'Other',
      created_at: '2026-01-01',
      last_used_at: null,
      revoked: 0
    }
  ],
  tokens: [
    {
      account_sub: 'sub-abc',
      client_id: 'client-1',
      access_hash: 'a',
      refresh_hash: 'r',
      revoked: 0
    },
    {
      account_sub: 'sub-abc',
      client_id: 'client-2',
      access_hash: 'a2',
      refresh_hash: 'r2',
      revoked: 0
    }
  ],
  projects: [
    {
      project_id: 'p1',
      google_sub: 'sub-abc',
      owner_email: null,
      mcp_enabled: 1,
      deleted_at: null
    },
    {
      project_id: 'p2',
      google_sub: 'sub-other',
      owner_email: null,
      mcp_enabled: 1,
      deleted_at: null
    }
  ],
  adoptions: []
};
function makeEnvFor(cookie) {
  // re-seed a fresh store each call; scenarios that need persistence rebuild
  // their own env by calling makeEnv directly. Default env shares SEED for the
  // read-only client checks; mutation scenarios pass their own env instead.
  return makeEnv(JSON.parse(JSON.stringify(SEED)));
}

(async function () {
  const { base64UrlEncode, bytesToBase64Url } = await import('../src/lib/http.js');
  // warm the import + signature path
  await signSessionCookie('sub-abc');

  section('WAVE2 A1 — config requires a session');
  const noSession = await call('GET', '/api/mcp/config', null, null);
  check(
    'GET config with no cookie is refused',
    noSession && noSession.status === 403,
    noSession && noSession.status
  );

  section('WAVE2 A2/A3 — PUT config sets policy + enabled');
  let env = makeEnv(JSON.parse(JSON.stringify(SEED)));
  const cookie = await signSessionCookie('sub-abc');
  const mod = await import(APPWIDE);
  const putReq = await asRequest(
    'PUT',
    '/api/mcp/config',
    { enabled: 0, policy: 'allow_read' },
    cookie
  );
  const putRes = await mod.handleMcpAdminConfig(putReq, env);
  check('PUT config ok', putRes && putRes.status === 200, putRes && putRes.status);
  const getReq = await asRequest('GET', '/api/mcp/config', null, cookie);
  const getRes = await mod.handleMcpAdminConfig(getReq, env);
  const cfg = getRes && getRes.status === 200 ? (await getRes.json()).config : null;
  check(
    'GET config reflects allow_read + disabled',
    cfg && cfg.policy === 'allow_read' && cfg.enabled === 0,
    cfg
  );

  section('WAVE2 A4 — policy + tool_subset validation');
  const badPolicy = await mod.handleMcpAdminConfig(
    await asRequest('PUT', '/api/mcp/config', { policy: 'bogus' }, cookie),
    env
  );
  check('bad policy is 400', badPolicy.status === 400, badPolicy.status);
  const badSubset = await mod.handleMcpAdminConfig(
    await asRequest(
      'PUT',
      '/api/mcp/config',
      { policy: 'allow_subset', tool_subset: ['not_a_tool'] },
      cookie
    ),
    env
  );
  check('unknown tool in subset is 400', badSubset.status === 400, badSubset.status);
  const goodSubset = await mod.handleMcpAdminConfig(
    await asRequest(
      'PUT',
      '/api/mcp/config',
      { policy: 'allow_subset', tool_subset: ['list_projects', 'get_project_summary'] },
      cookie
    ),
    env
  );
  const cfg2 = goodSubset.status === 200 ? (await goodSubset.json()).config : null;
  check(
    'valid subset is stored',
    goodSubset.status === 200 &&
      JSON.stringify(cfg2.toolSubset) === '["list_projects","get_project_summary"]',
    cfg2
  );

  section('WAVE2 A5 — clients list + revoke (account-scoped)');
  const listRes = await mod.handleMcpAdminClientsList(
    await asRequest('GET', '/api/mcp/clients', null, cookie),
    env
  );
  const clients = (await listRes.json()).clients;
  check(
    'lists only sub-abc clients (2)',
    clients.length === 2 && clients.every(c => c.clientId.indexOf('client-') === 0),
    clients
  );
  const revokeRes = await mod.handleMcpAdminClientRevoke(
    await asRequest('POST', '/api/mcp/clients/revoke', { clientId: 'client-1' }, cookie),
    env
  );
  check('revoke returns ok', revokeRes.status === 200, revokeRes.status);
  // tokens for client-1 must also be revoked
  const tok1 = env._store.mcp_tokens.find(t => t.client_id === 'client-1');
  check('client-1 revoked', tok1 && tok1.revoked === 1, tok1);
  // another account's client cannot be revoked by sub-abc
  const crossRevoke = await mod.handleMcpAdminClientRevoke(
    await asRequest('POST', '/api/mcp/clients/revoke', { clientId: 'client-x' }, cookie),
    env
  );
  check('cross-account revoke is 404', crossRevoke.status === 404, crossRevoke.status);

  section('WAVE2 A6 — project opt-out toggle (owner only)');
  const ownerToggle = await mod.handleMcpAdminProjectEnabled(
    await asRequest('PUT', '/api/mcp/projects/p1/enabled', { enabled: 0 }, cookie),
    env,
    'p1'
  );
  const ownerBody =
    ownerToggle.status === 200
      ? await ownerToggle.json()
      : await ownerToggle.json().catch(() => null);
  check(
    'owner can disable MCP on owned project',
    ownerToggle.status === 200 && ownerBody.mcpEnabled === false,
    { status: ownerToggle.status, body: ownerBody }
  );
  const nonOwner = await mod.handleMcpAdminProjectEnabled(
    await asRequest('PUT', '/api/mcp/projects/p2/enabled', { enabled: 0 }, cookie),
    env,
    'p2'
  );
  check('non-owner toggle is 403', nonOwner.status === 403, nonOwner.status);
  const noSessProj = await mod.handleMcpAdminProjectEnabled(
    await asRequest('PUT', '/api/mcp/projects/p1/enabled', { enabled: 1 }, null),
    env,
    'p1'
  );
  check('project toggle without session is 403', noSessProj.status === 403, noSessProj.status);

  console.log(
    '\n========== QA-MCP-ADMIN RESULT: ' + pass + ' passed, ' + fail + ' failed =========='
  );
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('QA harness crashed:', e);
  process.exit(1);
});
