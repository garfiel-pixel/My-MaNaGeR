/* ============================================================
   MCP AGENT-FIRST — reproduction + acceptance harness
   ------------------------------------------------------------
   MCP-AGENT-FIRST-DIRECTIVE (2026-11-12), Phase 0.

   R01-R14 are the DEFECT reproductions. Each one must fail on the
   pre-fix tree for the reason stated in the directive; after the
   matching phase it must pass. The harness drives the REAL project
   endpoint (handleMcpServer) and the REAL accept route
   (handleReviewAccept) against a fake D1 + R2, so the pipeline is
   exercised without a live Worker.

   Run: node tools/qa-mcp-agent-first.cjs
   ============================================================ */
const crypto = require('node:crypto');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fail++;
    failures.push(name);
    console.log(
      'FAIL  ' + name + (detail !== undefined ? '  => ' + JSON.stringify(detail).slice(0, 600) : '')
    );
  }
}
function section(t) {
  console.log('\n--- ' + t + ' ---');
}

const PROJECT = 'p1';
const BASE_TASKS = 60;
const R2_KEY = 'projects/' + PROJECT + '/latest.json';
const OWNER_CODE = 'OWNR-2F7K-9QMX-4TZB';
const OWNER_SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
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

function baseState() {
  const tasks = [];
  for (let i = 1; i <= BASE_TASKS; i++) {
    tasks.push({
      id: 't' + i,
      name: 'Task ' + i,
      status: i <= 5 ? 'completed' : 'todo',
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      critical: false,
      totalFloat: 0,
      predecessors: []
    });
  }
  return {
    schemaVersion: 19,
    projectId: PROJECT,
    currency: 'USD',
    projectName: 'Agent First',
    projectDeadline: '2027-06-30',
    budgetEnvelope: 500000,
    tasks: tasks,
    risks: [
      {
        id: 'r1',
        name: 'No description risk',
        status: 'Open',
        probability: 'High',
        impact: 'High'
      },
      { id: 'r2', name: 'Open risk', status: 'open', probability: 'Low', impact: 'Low' }
    ],
    issues: [],
    budgetLines: [
      {
        id: 'b1',
        name: 'Concrete',
        category: 'Concrete',
        planned: 100000,
        actual: 0,
        qty: 100,
        unit: 'm3'
      }
    ],
    spendLog: [{ id: 's1', name: 'Concrete pour', lineId: 'b1', amount: 10, date: '2026-10-02' }],
    meetings: [],
    logEntries: [],
    changes: [],
    documents: [],
    stakeholders: []
  };
}

async function makeEnv(opts) {
  const o = opts || {};
  const key = o.key || 'sk-mmgr-AAAAAA-BBBBBB-CCCCCC';
  const fp = fingerprint(key);
  const scope = o.scope || ALL_SECTIONS;
  const state = JSON.parse(JSON.stringify(o.state || baseState()));
  const store = {
    reviews: [],
    changelog: [],
    state: state,
    reviewSeq: 500,
    reviewStatus: o.reviewStatus || 'pending'
  };
  let seq = 100;
  const ownerHash = await o.mod.hashOwnerCode(OWNER_CODE, OWNER_SALT);

  const r2map = Object.create(null);
  r2map[R2_KEY] = JSON.stringify(state);
  const r2 = {
    async get(k) {
      const v = r2map[String(k)];
      if (v === undefined) {
        return null;
      }
      return {
        async text() {
          return v;
        }
      };
    },
    async put(k, v) {
      r2map[String(k)] = String(v);
      return { ok: true };
    }
  };

  function projectRow() {
    return {
      latest_r2_key: R2_KEY,
      owner_code_hash: ownerHash,
      owner_code_salt: OWNER_SALT,
      google_sub: 'sub-abc',
      google_name: 'Owner',
      owner_email: 'owner@example.com',
      deleted_at: null
    };
  }

  function reviewRowById(id) {
    return store.reviews.find(function (r) {
      return String(r.id) === String(id);
    });
  }

  const db = {
    prepare(sql) {
      const low = String(sql).toLowerCase();
      return {
        bind(...args) {
          return {
            async first() {
              if (low.includes('from cloud_api_keys')) {
                if (args[0] !== fp || (args[1] && args[1] !== PROJECT)) {
                  return null;
                }
                return {
                  id: 1,
                  key_fingerprint: fp,
                  key_salt: 's',
                  key_hash: 'h',
                  label: o.keyLabel || 'Agent key',
                  scope: JSON.stringify(scope),
                  expires_at: null,
                  budget_read: o.budgetRead === undefined ? 1 : o.budgetRead,
                  budget_write: o.budgetWrite === undefined ? 1 : o.budgetWrite,
                  deleted_at: null
                };
              }
              if (low.includes('from cloud_projects')) {
                return projectRow();
              }
              if (low.includes('from cloud_subscriptions')) {
                return { status: 'active', tier: 'premium', plan: 'premium' };
              }
              if (low.includes('from cloud_reviews') && low.includes('where id =')) {
                return reviewRowById(args[0]) || null;
              }
              if (low.includes('from cloud_reviews')) {
                return null;
              }
              return null;
            },
            async all() {
              if (low.includes('from cloud_reviews')) {
                return {
                  results: store.reviews.filter(function (r) {
                    return r.status === 'pending';
                  })
                };
              }
              return { results: [] };
            },
            async run() {
              if (low.startsWith('insert into cloud_reviews')) {
                const cols = String(sql)
                  .match(/insert into\s+cloud_reviews\s*\(([^)]+)\)/i)[1]
                  .split(',')
                  .map(function (c) {
                    return c.trim();
                  });
                const row = { id: ++store.reviewSeq, status: 'pending' };
                cols.forEach(function (c, i) {
                  row[c] = args[i];
                });
                store.reviews.push(row);
                return { meta: { changes: 1, last_row_id: row.id } };
              }
              if (low.startsWith('insert into cloud_changelog')) {
                const cols = String(sql)
                  .match(/insert into\s+cloud_changelog\s*\(([^)]+)\)/i)[1]
                  .split(',')
                  .map(function (c) {
                    return c.trim();
                  });
                const row = { id: ++seq };
                cols.forEach(function (c, i) {
                  row[c] = args[i];
                });
                store.changelog.push(row);
                return { meta: { changes: 1, last_row_id: row.id } };
              }
              if (low.startsWith('update cloud_reviews')) {
                // The claim (Phase 1.6) is conditional on pending; the final
                // decision write is not. Honour the guard so a second accept
                // loses the claim exactly as it would in D1.
                const guarded =
                  low.includes("and status = 'pending'") || low.includes('and status=?');
                const idArg = args[args.length - 1];
                const row = reviewRowById(idArg);
                if (!row) {
                  return { meta: { changes: 0 } };
                }
                if (guarded && row.status !== 'pending') {
                  return { meta: { changes: 0 } };
                }
                if (low.includes('set status')) {
                  row.status = String(args[0]);
                }
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
  return {
    DB: db,
    KV: {},
    R2: r2,
    __store: store,
    __key: key,
    __ownerCode: OWNER_CODE,
    __mod: o.mod,
    __r2map: r2map
  };
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
function jsonOf(res) {
  try {
    return JSON.parse(textOf(res));
  } catch (e) {
    return null;
  }
}

// The accept route reads the owner code header, so the fake project carries a
// real PBKDF2 hash of this code.
async function accept(env, reviewId, body) {
  const mod = env.__mod;
  const req = new Request(
    'http://localhost/api/cloud/projects/' + PROJECT + '/reviews/' + reviewId + '/accept',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-owner-code': OWNER_CODE
      },
      body: JSON.stringify(body || {})
    }
  );
  const res = await mod.handleReviewAccept(req, env, PROJECT, reviewId);
  let data = null;
  try {
    data = await res.clone().json();
  } catch (e) {
    data = null;
  }
  return {
    status: res.status,
    data: data,
    text: data ? String(data.message || data.error || '') : ''
  };
}

async function stateOf(env) {
  const raw = await env.R2.get(R2_KEY);
  const text = await raw.text();
  const parsed = JSON.parse(text);
  // Accept encrypts with the owner credentials; the fake project supplies a
  // real hash/salt, so decrypt through the same module the Worker uses.
  if (parsed && parsed.v === 2) {
    return env.__mod.cloudDecryptState(
      parsed,
      await env.__mod.hashOwnerCode(OWNER_CODE, OWNER_SALT),
      OWNER_SALT
    );
  }
  return parsed;
}

function addReview(env, row) {
  const full = Object.assign(
    {
      id: ++env.__store.reviewSeq,
      project_id: PROJECT,
      proposal_type: 'mcp',
      source_type: 'api',
      source_label: 'Agent key',
      status: 'pending',
      scope: JSON.stringify(ALL_SECTIONS),
      proposed_at: new Date().toISOString()
    },
    row
  );
  env.__store.reviews.push(full);
  return full.id;
}

(async () => {
  const server = await import('../src/mcp/server.js');
  const http = await import('../src/lib/http.js');
  const reviews = await import('../src/reviews.js');
  const mod = {
    handleMcpServer: server.handleMcpServer,
    handleReviewAccept: reviews.handleReviewAccept,
    hashOwnerCode: http.hashOwnerCode,
    cloudDecryptState: http.cloudDecryptState,
    cloudLogSave: http.cloudLogSave
  };

  // =====================================================================
  // R01 — 100 creates exceed the 500-leaf cap; accept applies only ~25
  // =====================================================================
  section('R01 — 100 task creates survive the 500-leaf cap');
  {
    const env = await makeEnv({ mod });
    const creates = [];
    for (let i = 1; i <= 100; i++) {
      creates.push({ path: 'tasks', record: { name: 'Bulk task ' + i } });
    }
    const q = await tool(env, 1, 'apply_changes', { creates });
    const qText = textOf(q);
    const row = env.__store.reviews[0];
    const queued = Number((qText.match(/Queued (\d+) field change/) || [])[1] || 0);
    const a = await accept(env, row.id);
    const st = await stateOf(env);
    const created = st.tasks.length - BASE_TASKS;
    const capped = JSON.parse(row.diffs_json).length;
    const full = JSON.parse(row.ops_json || '[]').length;
    check(
      'R01a the queue reports the true op count, above the 500-leaf display cap',
      queued > 500 && queued === row.ops_count && queued === full,
      { queued, opsCount: row.ops_count, full, capped }
    );
    check('R01b accept applies all 100 proposed creates', created === 100, {
      created,
      total: st.tasks.length,
      acceptStatus: a.status
    });
    check(
      'R01c the row carries the uncapped op list and keeps diffs_json at 500',
      typeof row.ops_json === 'string' && capped === 500 && full === row.ops_count,
      { opsCount: row.ops_count, capped, full }
    );
  }

  // =====================================================================
  // R02 — a row with no stored diffs merges the whole array and rolls back
  //        a field that moved in the live state since
  // =====================================================================
  section('R02 — a diffless MCP row is refused, never whole-array merged');
  {
    const env = await makeEnv({ mod });
    const st = await stateOf(env);
    st.tasks[0].status = 'completed'; // changed in the UI after the proposal
    await env.R2.put(R2_KEY, JSON.stringify(st));
    const submitted = JSON.parse(JSON.stringify(st));
    submitted.tasks[0].status = 'inprogress'; // the stale proposal value
    const id = addReview(env, {
      diffs_json: null,
      submitted_json: JSON.stringify(submitted)
    });
    const a = await accept(env, id);
    const after = await stateOf(env);
    check(
      'R02 a row without stored diffs is refused with 409',
      a.status === 409 && /no stored field changes/i.test(a.text || ''),
      { status: a.status, text: (a.text || '').slice(0, 140) }
    );
    check(
      'R02b the live status is untouched by the refused accept',
      after.tasks[0].status === 'completed',
      { live: after.tasks[0].status }
    );
    const legacy = await makeEnv({ mod });
    const lrow = addReview(legacy, {
      diffs_json: JSON.stringify(
        new Array(500).fill({ path: 'tasks', recordId: 't1', field: 'x' })
      ),
      submitted_json: '{}'
    });
    const la = await accept(legacy, lrow);
    check(
      'R02c a legacy 500-leaf row is refused as truncated',
      la.status === 409 && /truncated when it was queued/i.test(la.text || ''),
      { status: la.status, text: (la.text || '').slice(0, 140) }
    );
  }

  // =====================================================================
  // R03 — get_table honours the key's Read budget switch
  // =====================================================================
  section('R03 — get_table refuses money tables with Read budget off');
  {
    const env = await makeEnv({ mod, budgetRead: 0, budgetWrite: 0 });
    for (const table of ['budgetLines', 'spendLog', 'budgetEnvelope']) {
      const r = await tool(env, 10, 'get_table', { table });
      const t = textOf(r);
      check(
        'R03 ' + table + ' is refused to a key with Read budget off',
        /may not read the budget/i.test(t) && t.indexOf('"table"') === -1,
        { table, text: t.slice(0, 120) }
      );
    }
    const on = await makeEnv({ mod, budgetRead: 1 });
    const rOn = await tool(on, 14, 'get_table', { table: 'budgetLines' });
    const dOn = jsonOf(rOn);
    check(
      'R03b a key with Read budget on still gets the table',
      dOn.table === 'budgetLines' && Array.isArray(dOn.records) && dOn.records.length === 1,
      { text: textOf(rOn).slice(0, 120) }
    );
  }

  // =====================================================================
  // R04 — the generic path queues budget diffs with Propose budget off
  // =====================================================================
  section('R04 — budget diffs are refused with Propose budget changes off');
  {
    const env = await makeEnv({ mod, budgetWrite: 0 });
    const before = env.__store.reviews.length;
    const d1 = await tool(env, 11, 'apply_changes', {
      diffs: [{ path: 'budgetLines', recordId: 'b1', field: 'planned', after: 120000 }]
    });
    const d2 = await tool(env, 12, 'apply_changes', {
      diffs: [{ path: 'spendLog', recordId: 's1', field: 'amount', after: 50 }]
    });
    const d3 = await tool(env, 13, 'apply_changes', {
      sets: [{ path: 'budgetEnvelope', value: 600000 }]
    });
    const queued = env.__store.reviews.length - before;
    check(
      'R04 budgetLines/spendLog/budgetEnvelope are refused without the write switch',
      queued === 0 &&
        [d1, d2, d3].every(function (r) {
          return /may not propose budget changes/i.test(textOf(r));
        }),
      { queued, texts: [textOf(d1), textOf(d2), textOf(d3)] }
    );
    const on = await makeEnv({ mod });
    const q1 = await tool(on, 14, 'apply_changes', {
      diffs: [{ path: 'budgetLines', recordId: 'b1', field: 'planned', after: 120000 }]
    });
    const n1 = on.__store.reviews.length;
    const q2 = await tool(on, 15, 'apply_changes', {
      diffs: [{ path: 'spendLog', recordId: 's1', field: 'amount', after: 50 }]
    });
    const n2 = on.__store.reviews.length;
    const q3 = await tool(on, 16, 'apply_changes', {
      sets: [{ path: 'budgetEnvelope', value: 600000 }]
    });
    const n3 = on.__store.reviews.length;
    check(
      'R04b a budget-line diff queues as a changeLine op',
      /Queued 1 field change/.test(textOf(q1)) && n1 === 1,
      { text: textOf(q1).slice(0, 140), n1 }
    );
    check(
      'R04c a spendLog diff is refused and points at addDelivery',
      /use the budget array \(addDelivery\)/.test(textOf(q2)) && n2 === n1,
      { text: textOf(q2).slice(0, 140), n1, n2 }
    );
    check(
      'R04d an envelope set queues and carries the large flag',
      /Queued 1 field change/.test(textOf(q3)) &&
        n3 === 2 &&
        /"large":true/.test(on.__store.reviews[1].proposal_json || ''),
      { text: textOf(q3).slice(0, 140), n3, proposal: (on.__store.reviews[1] || {}).proposal_json }
    );
    const bad = await tool(on, 17, 'apply_changes', {
      sets: [{ path: 'budgetEnvelope', value: 'lots' }]
    });
    check(
      'R04e a non-numeric envelope is refused',
      /envelope must be a number/i.test(textOf(bad)),
      { text: textOf(bad).slice(0, 140) }
    );
  }

  // =====================================================================
  // R04m — the budget permission matrix (1.2 gate)
  // section Budget {on,off} x Read {on,off} x Write {on,off} x op
  // =====================================================================
  section('R04m — budget permission matrix');
  {
    const ops = {
      diff: { diffs: [{ path: 'budgetLines', recordId: 'b1', field: 'planned', after: 120000 }] },
      create: { creates: [{ path: 'budgetLines', record: { name: 'New line', planned: 10 } }] },
      set: { sets: [{ path: 'budgetEnvelope', value: 600000 }] },
      budget: { budget: [{ kind: 'changeLine', lineId: 'b1', field: 'planned', value: 120000 }] }
    };
    const cases = [];
    for (const sectionOn of [0, 1]) {
      for (const read of [0, 1]) {
        for (const write of [0, 1]) {
          for (const op of Object.keys(ops)) {
            cases.push({ sectionOn, read, write, op });
          }
        }
      }
    }
    let bad = 0;
    const detail = [];
    for (const c of cases) {
      const scope = ALL_SECTIONS.filter(function (s) {
        return c.sectionOn === 1 || s !== 'bud';
      });
      const env = await makeEnv({
        mod,
        scope,
        budgetRead: c.read,
        budgetWrite: c.write
      });
      const r = await tool(env, 200, 'apply_changes', ops[c.op]);
      const t = textOf(r);
      const queued = env.__store.reviews.length > 0;
      let ok;
      if (c.sectionOn === 0) {
        // The write switch is checked first, so an unswitched key is refused
        // for the switch even when the section is also absent; both refusals
        // are correct and neither queues.
        ok =
          !queued &&
          (/outside the granted sections/i.test(t) || /may not propose budget changes/i.test(t));
      } else if (c.op === 'create') {
        // Always refused on the generic path; only the switch decides which
        // refusal wins (write refusal comes first).
        ok = !queued && /use the budget array \(addLine\)|may not propose budget changes/i.test(t);
      } else if (!c.read || !c.write) {
        ok = !queued && /may not propose budget changes/i.test(t);
      } else {
        ok = queued && /Queued 1 field change/.test(t);
      }
      if (!ok) {
        bad++;
        detail.push({ ...c, text: t.slice(0, 100), queued });
      }
    }
    check('R04m every budget permission combination behaves', bad === 0, {
      cases: cases.length,
      bad,
      detail: detail.slice(0, 6)
    });
  }

  // =====================================================================
  // R05 — the agent's before is not checked at queue time
  // =====================================================================
  section('R05 — an agent before that does not match the live value is queued');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 20, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't6', field: 'status', before: 'completed', after: 'inprogress' }
      ]
    });
    const row = env.__store.reviews[0];
    const stored = JSON.parse(row.diffs_json);
    const a = await accept(env, row.id);
    const st = await stateOf(env);
    check(
      'R05 the wrong before is replaced by the live value and queued',
      /Queued 1 field change/.test(textOf(q)) && stored[0].before === 'todo',
      { text: textOf(q), storedBefore: stored[0].before }
    );
    check(
      'R05b accept succeeds with no stale flag',
      a.status === 200 && st.tasks[5].status === 'inprogress',
      { status: a.status, live: st.tasks[5].status }
    );
  }

  // =====================================================================
  // R06 — the large-budget message omits the incoming count
  // =====================================================================
  section('R06 — 24 large budget changes get the misleading limit message');
  {
    const env = await makeEnv({ mod });
    const budget = [];
    for (let i = 1; i <= 24; i++) {
      budget.push({ kind: 'addLine', line: { name: 'Large ' + i, planned: 60000 } });
    }
    const q = await tool(env, 30, 'apply_changes', { budget });
    const t = textOf(q);
    check(
      'R06 the message says "already queued 0" and never names the 24',
      /already queued 0 large budget change\(s\) today and a day allows 10/.test(t) &&
        t.indexOf('24') === -1,
      { text: t.slice(0, 240) }
    );
  }

  // =====================================================================
  // R07 — two concurrent accepts of the same proposal both pass
  // =====================================================================
  section('R07 — concurrent accepts both pass the pending check');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 40, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'notes', after: 'race' }]
    });
    const id = env.__store.reviews[0].id;
    const [a1, a2] = await Promise.all([accept(env, id), accept(env, id)]);
    const codes = [a1.status, a2.status];
    check(
      'R07 both accepts answer 200 (the second should have been refused)',
      codes[0] === 200 && codes[1] === 200,
      { codes, q: textOf(q).slice(0, 80) }
    );
  }

  // =====================================================================
  // R08 — a retry with identical arguments queues a second row
  // =====================================================================
  section('R08 — identical apply_changes retried queues two rows');
  {
    const env = await makeEnv({ mod });
    const args = { diffs: [{ path: 'tasks', recordId: 't7', field: 'notes', after: 'retry' }] };
    const a = await tool(env, 50, 'apply_changes', args);
    const b = await tool(env, 51, 'apply_changes', args);
    check(
      'R08 two identical calls create two pending rows',
      env.__store.reviews.length === 2 && !/duplicate/i.test(textOf(b)),
      { rows: env.__store.reviews.length, text: textOf(b).slice(0, 120) }
    );
  }

  // =====================================================================
  // R09 — a name-only risk reads as untitled and is missing from openRisks
  // =====================================================================
  section('R09 — get_risks ignores name and openRisks miscounts');
  {
    const env = await makeEnv({ mod });
    const r = await tool(env, 60, 'get_risks', {});
    const data = jsonOf(r);
    const names = (data.risks || []).map(function (x) {
      return x.description;
    });
    const s = await tool(env, 61, 'get_project_summary', {});
    const summary = jsonOf(s);
    check('R09a a risk with name only reads as "(untitled)"', names.indexOf('(untitled)') > -1, {
      names
    });
    check(
      'R09b openRisks misses the "Open" risk (case-sensitive status)',
      summary.openRisks === 1,
      { openRisks: summary.openRisks }
    );
  }

  // =====================================================================
  // R10 — status "done" is accepted and completion stays 0
  // =====================================================================
  section('R10 — status "done" is queued, accepted, and invisible');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 70, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'status', after: 'done' }]
    });
    const a = await accept(env, env.__store.reviews[0].id);
    const st = await stateOf(env);
    const s = await tool(env, 71, 'get_project_summary', {});
    const summary = jsonOf(s);
    check(
      'R10a the unknown enum is queued and accepted without a refusal',
      /Queued 1 field change/.test(textOf(q)) && a.status === 200 && st.tasks[5].status === 'done',
      { q: textOf(q).slice(0, 100), status: a.status, live: st.tasks[5].status }
    );
    check(
      'R10b completedTasks stays 0 because "done" is not "completed"',
      summary.completedTasks === 5,
      { completedTasks: summary.completedTasks }
    );
  }

  // =====================================================================
  // R11 — a derived field (critical) is writable
  // =====================================================================
  section('R11 — critical is accepted as an agent write');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 80, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'critical', after: true }]
    });
    const a = await accept(env, env.__store.reviews[0].id);
    const st = await stateOf(env);
    check(
      'R11 critical:true is queued and accepted (derived field, no guard)',
      /Queued 1 field change/.test(textOf(q)) && a.status === 200 && st.tasks[5].critical === true,
      { q: textOf(q).slice(0, 100), status: a.status, critical: st.tasks[5].critical }
    );
  }

  // =====================================================================
  // R12 — completing a task does not stamp completedDate/statusSince
  // =====================================================================
  section('R12 — a completed status leaves the stamps unset');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 90, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'status', after: 'completed' }]
    });
    const a = await accept(env, env.__store.reviews[0].id);
    const st = await stateOf(env);
    const t = st.tasks[5];
    check(
      'R12 accept sets status but neither completedDate nor statusSince',
      a.status === 200 && t.status === 'completed' && !t.completedDate && !t.statusSince,
      { status: a.status, completedDate: t.completedDate, statusSince: t.statusSince }
    );
  }

  // =====================================================================
  // R13 — a 40+ leaf accept writes a changelog entry with null diffs
  // =====================================================================
  section('R13 — a large accept loses the changelog diffs and the proposal');
  {
    const env = await makeEnv({ mod });
    const prev = await stateOf(env);
    const next = JSON.parse(JSON.stringify(prev));
    for (let i = 0; i < 41; i++) {
      next.tasks[i].notes = 'bulk note ' + i;
    }
    const entry = await env.__mod.cloudLogSave(
      env,
      PROJECT,
      prev,
      next,
      { type: 'owner', label: 'Owner' },
      'accepted'
    );
    const row = env.__store.changelog[0];
    check(
      'R13a the entry exists but carries null diffs_json (snapshot only)',
      !!entry && row && row.diffs_json === null && !!row.snapshot_key,
      { entry, row: row && { diffs_json: row.diffs_json, snapshot_key: row.snapshot_key } }
    );
    check(
      'R13b the entry has no proposal_id / source_label attribution columns',
      row && row.proposal_id === undefined && row.source_label === undefined,
      { row }
    );
  }

  // =====================================================================
  // R14 — get_changes_since is absent from tools/list
  // =====================================================================
  section('R14 — get_changes_since is not in the catalog');
  {
    const env = await makeEnv({ mod });
    const r = await call(env, { jsonrpc: '2.0', id: 100, method: 'tools/list' });
    const names = (r.result.tools || []).map(function (t) {
      return t.name;
    });
    check('R14 tools/list has no get_changes_since', names.indexOf('get_changes_since') === -1, {
      count: names.length
    });
  }

  console.log('\n========================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (failures.length) {
    console.log('failed: ' + failures.join(' | '));
  }
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
