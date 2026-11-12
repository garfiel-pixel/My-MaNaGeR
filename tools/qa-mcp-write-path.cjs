/* ============================================================
   My MaNaGeR — PROJECT MCP WRITE-PATH GATE (qa-mcp-write-path)
   ------------------------------------------------------------
   MCP-DIRECTIVE-2026-11-11 P0/P1/P2. Drives the REAL project
   endpoint (handleMcpServer) with a mock D1 + R2 and a real API
   key fingerprint, so the proposal pipeline is exercised without
   a live Worker.

   Proves:
     W1  apply_changes {} -> structured isError, NO review row
     W2  1 diff  -> one proposal row
     W3  30 diffs -> one proposal row
     W4  200 diffs -> one proposal row
     W5  501 diffs -> refused by the envelope cap, NO row
     W6  a diff outside the key's sections is refused
     A1  invalid targetDate -> tool error; next call still works
     A2  invalid week ("2026-13-45") -> tool error
     A3  envelope 0 -> envelope null, envelopeRemaining null
     A4  default weekly view is never future-dated
     A5  an API-key catalog hides get_weather

   Run: node tools/qa-mcp-write-path.cjs
   ============================================================ */

const crypto = require('node:crypto');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fail++;
    console.log(
      'FAIL  ' + name + (detail !== undefined ? '  => ' + JSON.stringify(detail).slice(0, 500) : '')
    );
  }
}
function section(t) {
  console.log('\n--- ' + t + ' ---');
}

const PROJECT = 'p1';
const R2_KEY = 'projects/' + PROJECT + '/latest.json';
const ALL_SECTIONS = [
  'charter',
  'wbs',
  'res',
  'bud',
  'stk',
  'chg',
  'log',
  'risk',
  'close',
  'raci',
  'comms',
  'docs',
  'dmaic',
  'proc',
  'meet',
  'photos'
];
function fingerprint(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

// 200 tasks so the 200-diff arm is real; a 2027 spend entry so the weekly
// default arm proves it is clamped to the past.
const TASKS = [];
for (let i = 1; i <= 200; i++) {
  TASKS.push({
    id: 't' + i,
    name: 'Task ' + i,
    status: 'todo',
    startDate: '2026-10-01',
    endDate: '2026-10-05'
  });
}
const STATE = {
  schemaVersion: 19,
  projectId: PROJECT,
  currency: 'USD',
  projectName: 'Write Path',
  tasks: TASKS,
  risks: [{ id: 'r1', description: 'Weather', status: 'open', probability: 3, impact: 3 }],
  issues: [],
  budgetLines: [
    { id: 'b1', description: 'Concrete', planned: 1000, actual: 500, qty: 10, unit: 'm3' }
  ],
  spendLog: [
    { id: 's1', date: '2026-11-02', amount: 100, status: 'spent' },
    { id: 's2', date: '2027-01-11', amount: 200, status: 'spent' }
  ],
  deliveries: [],
  meetings: [],
  logEntries: [],
  changes: [],
  budgetEnvelope: 0
};

function makeEnv(opts) {
  const o = opts || {};
  const key = o.key || 'sk-mmgr-AAAAAA-BBBBBB-CCCCCC';
  const fp = fingerprint(key);
  const scope = o.scope || ALL_SECTIONS;
  const store = { cloud_reviews: [] };
  let reviewSeq = 500;
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const s = sql.toLowerCase();
              if (s.includes('from cloud_api_keys')) {
                if (args[0] !== fp || (args[1] && args[1] !== PROJECT)) {
                  return null;
                }
                return {
                  id: 1,
                  key_fingerprint: fp,
                  key_salt: 's',
                  key_hash: 'h',
                  label: 'Write key',
                  scope: JSON.stringify(scope),
                  expires_at: null,
                  budget_read: 1,
                  budget_write: 1,
                  deleted_at: null
                };
              }
              if (s.includes('from cloud_projects')) {
                return {
                  latest_r2_key: R2_KEY,
                  owner_code_hash: 'h',
                  owner_code_salt: 's',
                  google_sub: 'sub-abc'
                };
              }
              if (s.includes('from cloud_subscriptions')) {
                return { status: 'active', tier: 'premium', plan: 'premium' };
              }
              return null;
            },
            async all() {
              const s = sql.toLowerCase();
              if (s.includes('from cloud_reviews')) {
                return {
                  results: store.cloud_reviews.filter(function (r) {
                    return r.status === 'pending';
                  })
                };
              }
              return { results: [] };
            },
            async run() {
              const s = sql.toLowerCase();
              if (s.startsWith('insert into cloud_reviews')) {
                const cols = sql
                  .match(/insert into\s+cloud_reviews\s*\(([^)]+)\)/i)[1]
                  .split(',')
                  .map(function (c) {
                    return c.trim();
                  });
                const row = {};
                cols.forEach(function (c, i) {
                  row[c] = args[i];
                });
                row.id = ++reviewSeq;
                store.cloud_reviews.push(row);
                return { meta: { changes: 1, last_row_id: row.id } };
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
  const r2 = {
    async get(k) {
      if (String(k) === R2_KEY) {
        const blob = JSON.stringify(STATE);
        return {
          async text() {
            return blob;
          }
        };
      }
      return null;
    }
  };
  return { DB: db, KV: {}, R2: r2, __store: store, __key: key };
}

async function call(env, body) {
  const req = new Request('http://localhost/api/mcp/' + PROJECT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.__key },
    body: JSON.stringify(body)
  });
  const res = await env.__mod.handleMcpServer(req, env, PROJECT);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { __raw: text };
  }
}
function tool(env, id, name, args) {
  return call(env, {
    jsonrpc: '2.0',
    id: id,
    method: 'tools/call',
    params: { name: name, arguments: args || {} }
  });
}
function textOf(res) {
  return res && res.result && res.result.content && res.result.content[0]
    ? res.result.content[0].text
    : '';
}

(async () => {
  const server = await import('../src/mcp/server.js');
  const env = makeEnv({});
  env.__mod = server;

  section('W1 — empty apply_changes is a structured error, no row');
  const w1 = await tool(env, 1, 'apply_changes', {});
  check(
    'empty apply_changes returns isError "Nothing provided"',
    w1 && w1.result && w1.result.isError === true && /Nothing provided/.test(textOf(w1)),
    w1
  );
  check('empty apply_changes queued NO review row', env.__store.cloud_reviews.length === 0, {
    rows: env.__store.cloud_reviews.length
  });

  section('W2 — one diff queues one proposal');
  const w2 = await tool(env, 2, 'apply_changes', {
    diffs: [{ path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }]
  });
  check('one diff is queued', /Queued 1 field change/.test(textOf(w2)), w2);
  check(
    'one diff created exactly one row',
    env.__store.cloud_reviews.length === 1 && env.__store.cloud_reviews[0].proposal_type === 'mcp',
    env.__store.cloud_reviews
  );

  section('W3 — 30 diffs queue ONE proposal');
  const d30 = [];
  for (let i = 1; i <= 30; i++) {
    d30.push({ path: 'tasks', recordId: 't' + i, field: 'status', after: 'completed' });
  }
  const w3 = await tool(env, 3, 'apply_changes', { diffs: d30 });
  check('30 diffs are queued', /Queued 30 field change/.test(textOf(w3)), w3);
  check('30 diffs created exactly ONE row', env.__store.cloud_reviews.length === 2, {
    rows: env.__store.cloud_reviews.length
  });

  section('W4 — 200 diffs queue ONE proposal');
  const d200 = [];
  for (let i = 1; i <= 200; i++) {
    d200.push({ path: 'tasks', recordId: 't' + i, field: 'status', after: 'completed' });
  }
  const w4 = await tool(env, 4, 'apply_changes', { diffs: d200 });
  check('200 diffs are queued', /Queued 200 field change/.test(textOf(w4)), w4);
  check('200 diffs created exactly ONE row', env.__store.cloud_reviews.length === 3, {
    rows: env.__store.cloud_reviews.length
  });

  section('W5 — over-cap envelope is refused before the pipeline');
  const d501 = [];
  for (let i = 0; i < 501; i++) {
    d501.push({ path: 'tasks', recordId: 't' + i, field: 'status', after: 'completed' });
  }
  const w5 = await tool(env, 5, 'apply_changes', { diffs: d501 });
  check(
    '501 diffs is refused with the cap message',
    w5 && w5.result && w5.result.isError === true && /at most 500 diffs/.test(textOf(w5)),
    w5
  );
  check('the cap refusal queued NO row', env.__store.cloud_reviews.length === 3, {
    rows: env.__store.cloud_reviews.length
  });

  section('W6 — a diff outside the key sections is refused');
  const envBud = makeEnv({ key: 'sk-mmgr-DDDDDD-EEEEEE-FFFFFF', scope: ['bud'] });
  envBud.__mod = server;
  const w6 = await tool(envBud, 6, 'apply_changes', {
    diffs: [{ path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }]
  });
  check(
    'out-of-scope diff is refused',
    w6 &&
      w6.result &&
      w6.result.isError === true &&
      /outside the granted sections/.test(textOf(w6)),
    w6
  );
  check('the scope refusal queued NO row', envBud.__store.cloud_reviews.length === 0, {
    rows: envBud.__store.cloud_reviews.length
  });

  section('A1 — invalid targetDate is a tool error; endpoint stays healthy');
  const a1 = await tool(env, 7, 'run_monte_carlo', { targetDate: 'not-a-date' });
  check(
    'invalid targetDate returns isError',
    a1 &&
      a1.result &&
      a1.result.isError === true &&
      /targetDate must be an ISO date/.test(textOf(a1)),
    a1
  );
  const a1b = await tool(env, 8, 'get_project_summary', {});
  check(
    'the next call still succeeds (no crash)',
    a1b && a1b.result && !a1b.result.isError && /"totalTasks": 200/.test(textOf(a1b)),
    a1b
  );

  section('A2 — impossible week is refused');
  const a2 = await tool(env, 9, 'get_weekly_summary', { week: '2026-13-45' });
  check(
    'week 2026-13-45 returns isError',
    a2 && a2.result && a2.result.isError === true && /real date/.test(textOf(a2)),
    a2
  );

  section('A3 — unset envelope returns null remaining');
  const a3 = await tool(env, 10, 'get_budget', {});
  let budget = null;
  try {
    budget = JSON.parse(textOf(a3));
  } catch (e) {
    budget = null;
  }
  check(
    'envelope 0 -> envelope null and envelopeRemaining null',
    budget && budget.envelope === null && budget.envelopeRemaining === null,
    budget
  );

  section('A4 — default weekly view is never future-dated');
  const a4 = await tool(env, 11, 'get_weekly_summary', {});
  let weekly = null;
  try {
    weekly = JSON.parse(textOf(a4));
  } catch (e) {
    weekly = null;
  }
  const today = new Date().toISOString().slice(0, 10);
  check(
    'default week is on or before today',
    weekly && typeof weekly.week === 'string' && weekly.week <= today,
    { week: weekly && weekly.week, today }
  );

  section('A5 — an API-key catalog hides get_weather');
  const list = await call(env, { jsonrpc: '2.0', id: 12, method: 'tools/list' });
  const names = ((list.result && list.result.tools) || []).map(function (t) {
    return t.name;
  });
  check(
    'get_weather is hidden from an API-key catalog',
    names.indexOf('get_weather') === -1,
    names
  );
  check('the rest of the read tools are still listed', names.indexOf('get_tasks') > -1, names);

  section('M1 — 30 mixed calls, zero failures (1102 regression guard)');
  const lat = [];
  let bad = 0;
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    let res;
    if (i % 3 === 0) {
      res = await tool(env, 100 + i, 'get_project_summary', {});
    } else if (i % 3 === 1) {
      res = await tool(env, 100 + i, 'get_budget', {});
    } else {
      res = await tool(env, 100 + i, 'apply_changes', {
        diffs: [{ path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }]
      });
    }
    lat.push(Date.now() - t0);
    if (!res || res.jsonrpc !== '2.0' || !res.result) {
      bad++;
    }
  }
  lat.sort(function (a, b) {
    return a - b;
  });
  const p95 = lat[Math.floor(lat.length * 0.95)] || lat[lat.length - 1];
  check('30 mixed read/budget/write calls all answered', bad === 0, { bad });
  console.log('      p95 latency: ' + p95 + ' ms (in-process, mock D1/R2)');

  console.log(
    '\n========== QA-MCP-WRITE-PATH RESULT: ' + pass + ' passed, ' + fail + ' failed =========='
  );
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('QA harness crashed:', e);
  process.exit(1);
});
