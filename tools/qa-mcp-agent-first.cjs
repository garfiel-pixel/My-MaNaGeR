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
      predecessors: [],
      notes: ''
    });
  }
  return {
    schemaVersion: 19,
    projectId: PROJECT,
    updatedAt: '2026-11-01T00:00:00.000Z',
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
  const etags = Object.create(null);
  const etagOf = function (v) {
    return crypto.createHash('md5').update(String(v)).digest('hex');
  };
  r2map[R2_KEY] = JSON.stringify(state);
  etags[R2_KEY] = etagOf(r2map[R2_KEY]);
  const r2 = {
    async get(k) {
      const key = String(k);
      const v = r2map[key];
      if (v === undefined) {
        return null;
      }
      return {
        etag: etags[key],
        async text() {
          return v;
        }
      };
    },
    async put(k, v, opts) {
      const key = String(k);
      const cond = opts && opts.onlyIf;
      if (cond && cond.etagMatches && etags[key] !== cond.etagMatches) {
        const e = new Error("The request's precondition failed");
        e.code = 10031;
        throw e;
      }
      if (cond && cond.etagDoesNotMatch === '*' && etags[key]) {
        const e = new Error("The request's precondition failed");
        e.code = 10031;
        throw e;
      }
      r2map[key] = String(v);
      etags[key] = etagOf(r2map[key]);
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
              if (low.includes('from cloud_reviews') && low.includes('import_key')) {
                const r = store.reviews.find(function (x) {
                  return x.import_key === args[0];
                });
                return r ? Object.assign({}, r) : null;
              }
              if (low.includes('from cloud_reviews') && /\bid\s*=\s*\?/.test(low)) {
                // A SELECT returns a snapshot, not a live reference: two
                // concurrent accepts must both read the row as it was, which
                // is exactly what the missing claim fails to guard. Scan all
                // bound args for the review id (the SELECT orders project_id
                // before id, so the id is not always args[0]).
                let r = null;
                for (let ai = 0; ai < args.length; ai++) {
                  const cand = reviewRowById(args[ai]);
                  if (cand) {
                    r = cand;
                    break;
                  }
                }
                return r ? Object.assign({}, r) : null;
              }
              if (
                low.includes('from cloud_reviews') &&
                (low.includes('count(*)') || low.includes('coalesce(sum'))
              ) {
                // MCP-AGENT-FIRST addendum A1 (2026-11-13): per-key abuse
                // limits. Compute the pending cap and the daily op sum from
                // the in-memory review store, honouring project_id, key_id (IS
                // null-safe) and the status / proposed_at filters.
                let rows = store.reviews.slice();
                rows = rows.filter(function (r) {
                  return String(r.project_id) === String(args[0]);
                });
                rows = rows.filter(function (r) {
                  return String(r.key_id) === String(args[1]);
                });
                if (low.includes("status in ('pending','accepting')")) {
                  rows = rows.filter(function (r) {
                    return r.status === 'pending' || r.status === 'accepting';
                  });
                } else if (low.includes("status in ('pending','accepting','accepted')")) {
                  rows = rows.filter(function (r) {
                    return (
                      r.status === 'pending' || r.status === 'accepting' || r.status === 'accepted'
                    );
                  });
                }
                if (low.includes('proposed_at >= ?')) {
                  rows = rows.filter(function (r) {
                    return String(r.proposed_at || '') >= String(args[2]);
                  });
                }
                if (low.includes('count(*)')) {
                  return { c: rows.length };
                }
                let total = 0;
                rows.forEach(function (r) {
                  total += Number(r.ops_count) || 0;
                });
                return { total: total };
              }
              if (low.includes('from cloud_reviews')) {
                return null;
              }
              return null;
            },
            async all() {
              if (low.includes('from cloud_changelog')) {
                return { results: store.changelog.slice() };
              }
              if (low.includes('from cloud_reviews')) {
                // Honor the SQL's status filter so post-accept queries that
                // return accepted/resolved rows work, while the change-set and
                // pending previews that ask for pending still see only those.
                let rows = store.reviews.slice();
                if (low.includes("status = 'pending'")) {
                  rows = rows.filter(function (r) {
                    return r.status === 'pending';
                  });
                }
                // ADDENDUM 4.1/AT09: the large-change counter asks for
                // pending+accepting+accepted, so the mock must honour it -
                // otherwise a rejected row would count against the quota.
                const isLargeCounter =
                  low.includes("status in ('pending','accepting','accepted')") &&
                  low.includes('proposal_json');
                if (isLargeCounter) {
                  rows = rows.filter(function (r) {
                    return (
                      r.status === 'pending' || r.status === 'accepting' || r.status === 'accepted'
                    );
                  });
                }
                if (isLargeCounter && low.includes('source_label = ?')) {
                  rows = rows.filter(function (r) {
                    return String(r.source_label) === String(args[1]);
                  });
                }
                if (low.includes('proposed_at >= ?')) {
                  rows = rows.filter(function (r) {
                    return String(r.proposed_at || '') >= String(args[2]);
                  });
                }
                return { results: rows };
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
                if (
                  row.import_key &&
                  store.reviews.some(function (r) {
                    return r.import_key === row.import_key;
                  })
                ) {
                  const err = new Error('UNIQUE constraint failed: cloud_reviews.import_key');
                  err.code = 'SQLITE_CONSTRAINT';
                  throw err;
                }
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
                const needPending = low.includes("and status = 'pending'");
                const needAccepting = low.includes("and status = 'accepting'");
                const guarded =
                  needPending ||
                  needAccepting ||
                  low.includes('and status=?') ||
                  low.includes('status in (');
                let row = null;
                for (let ai = 0; ai < args.length; ai++) {
                  const cand = reviewRowById(args[ai]);
                  if (cand) {
                    row = cand;
                    break;
                  }
                }
                if (!row) {
                  return { meta: { changes: 0 } };
                }
                if (needPending && row.status !== 'pending') {
                  return { meta: { changes: 0 } };
                }
                if (needAccepting && row.status !== 'accepting') {
                  return { meta: { changes: 0 } };
                }
                if (
                  guarded &&
                  !needPending &&
                  !needAccepting &&
                  row.status !== 'pending' &&
                  row.status !== 'accepting'
                ) {
                  return { meta: { changes: 0 } };
                }
                // Apply the SET clause, binding ? tokens to args in order and
                // honouring literal / NULL assignments. This is what lets a
                // partial withdraw rewrite ops_json / ops_count / diffs_json.
                const setMatch = /set\s+([\s\S]*?)\s+where/i.exec(String(sql));
                if (setMatch) {
                  const assigns = setMatch[1].match(/([a-z_]+)\s*=\s*(\?|null|'[^']*')/gi) || [];
                  let qi = 0;
                  assigns.forEach(function (m) {
                    const cm = /^([a-z_]+)\s*=\s*(\?|null|'[^']*')/i.exec(m);
                    if (!cm) {
                      return;
                    }
                    const col = cm[1].toLowerCase();
                    const tok = cm[2].toLowerCase();
                    if (tok === '?') {
                      row[col] = args[qi++];
                    } else if (tok === 'null') {
                      row[col] = null;
                    } else {
                      row[col] = cm[2].replace(/^'|'$/g, '');
                    }
                  });
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

function blockJson(res, index) {
  try {
    return JSON.parse(res.result.content[index].text);
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
  const reportStore = await import('../src/mcp/report-store.js');
  const projects = await import('../src/cloud/projects.js');
  const mod = {
    handleMcpServer: server.handleMcpServer,
    queueMcpProposal: server.queueMcpProposal,
    handleReviewAccept: reviews.handleReviewAccept,
    handleChangeSetAccept: reviews.handleChangeSetAccept,
    handleChangeSetReject: reviews.handleChangeSetReject,
    withdrawMcpProposal: server.withdrawMcpProposal,
    handleCloudSave: projects.handleCloudSave,
    hashOwnerCode: http.hashOwnerCode,
    cloudDecryptState: http.cloudDecryptState,
    cloudLogSave: http.cloudLogSave,
    storeApplyReport: reportStore.storeApplyReport,
    summarizeApplyReport: reportStore.summarizeApplyReport,
    pruneDecidedReports: reportStore.pruneDecidedReports
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
    const capped = (function () {
      try {
        return JSON.parse(row.diffs_json).length;
      } catch (e) {
        return -1;
      }
    })();
    const full = (function () {
      try {
        return (JSON.parse(row.ops_json).ops || []).length;
      } catch (e) {
        return -1;
      }
    })();
    check(
      'R01a the queue reports the true op count and the op list is preserved',
      queued === row.ops_count && queued === full && typeof row.ops_json === 'string',
      { queued, opsCount: row.ops_count, full, capped }
    );
    check('R01b accept applies all 100 proposed creates', created === 100, {
      created,
      total: st.tasks.length,
      acceptStatus: a.status
    });
    check(
      'R01c the row carries the uncapped op list and diffs_json is display-capped',
      typeof row.ops_json === 'string' && full === row.ops_count && capped <= 500,
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
    const q1Proposal = (function () {
      try {
        return JSON.parse(on.__store.reviews[0].proposal_json);
      } catch (e) {
        return null;
      }
    })();
    check(
      'R04b a budget-line diff queues as a changeLine op in proposal_json',
      n1 === 1 &&
        !!q1Proposal &&
        Array.isArray(q1Proposal.changes) &&
        q1Proposal.changes.some(function (c) {
          return c.kind === 'changeLine';
        }),
      { text: textOf(q1).slice(0, 140), n1, proposal: q1Proposal }
    );
    check(
      'R04c a spendLog diff is refused and points at addDelivery',
      /use the budget array \(addDelivery\)/.test(textOf(q2)) && n2 === n1,
      { text: textOf(q2).slice(0, 140), n1, n2 }
    );
    const q3Proposal = (function () {
      try {
        return JSON.parse(on.__store.reviews[1].proposal_json);
      } catch (e) {
        return null;
      }
    })();
    check(
      'R04d an envelope set queues and carries the large flag',
      n3 === 2 && !!q3Proposal && /"large":true/.test(JSON.stringify(q3Proposal)),
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
        ok = queued;
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
  section('R05 — a stale agent before is refused with both values');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 20, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't6', field: 'status', before: 'completed', after: 'inprogress' }
      ]
    });
    check(
      'R05 a wrong before is refused with expected and live',
      /stale before: expected completed, live todo/.test(textOf(q)) &&
        env.__store.reviews.length === 0,
      { text: textOf(q).slice(0, 160), rows: env.__store.reviews.length }
    );
    const ok = await makeEnv({ mod });
    const q2 = await tool(ok, 21, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't6', field: 'status', before: 'todo', after: 'inprogress' }
      ]
    });
    const a = await accept(ok, ok.__store.reviews[0].id);
    const st = await stateOf(ok);
    check(
      'R05b a correct before queues and accepts',
      /Queued 1 field change/.test(textOf(q2)) &&
        a.status === 200 &&
        st.tasks[5].status === 'inprogress',
      { status: a.status, live: st.tasks[5].status }
    );
    const noBefore = await makeEnv({ mod });
    const q3 = await tool(noBefore, 22, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'notes', after: 'no before' }]
    });
    const row3 = noBefore.__store.reviews[0];
    const ops3 = (function () {
      try {
        return JSON.parse(row3.ops_json).ops || [];
      } catch (e) {
        return [];
      }
    })();
    check(
      'R05c an omitted before still queues the change',
      /Queued 1 field change/.test(textOf(q3)) &&
        ops3.length === 1 &&
        ops3[0].after === 'no before',
      { text: textOf(q3).slice(0, 160), op: ops3[0] }
    );
  }

  // =====================================================================
  // R06 — the large-budget message omits the incoming count
  // =====================================================================
  section('R06 — 24 large budget changes name N, U and L');
  {
    const env = await makeEnv({ mod });
    const budget = [];
    for (let i = 1; i <= 24; i++) {
      budget.push({ kind: 'addLine', line: { name: 'Large ' + i, planned: 60000 } });
    }
    const q = await tool(env, 30, 'apply_changes', { budget });
    const t = textOf(q);
    check(
      'R06 the message names the 24 incoming, 0 used and the 10 limit',
      /This call has 24 large budget change\(s\)/.test(t) &&
        /This key has 0 large change\(s\) pending or accepted today \(UTC\)/.test(t) &&
        /The limit is 10 per day and 10 per call/.test(t) &&
        env.__store.reviews.length === 0,
      { text: t.slice(0, 300), rows: env.__store.reviews.length }
    );
  }

  // =====================================================================
  // R07 — two concurrent accepts of the same proposal both pass
  // =====================================================================
  section('R07 — one concurrent accept wins the claim');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 40, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'notes', after: 'race' }]
    });
    const id = env.__store.reviews[0].id;
    const [a1, a2] = await Promise.all([accept(env, id), accept(env, id)]);
    const codes = [a1.status, a2.status].sort();
    const st = await stateOf(env);
    check(
      'R07 exactly one accept answers 200 and the other 409',
      codes[0] === 200 &&
        codes[1] === 409 &&
        /already being decided/i.test((a1.status === 409 ? a1.text : a2.text) || '') &&
        st.tasks[5].notes === 'race',
      { codes, q: textOf(q).slice(0, 80), notes: st.tasks[5].notes }
    );
  }

  // =====================================================================
  // R07b — a UI save and an accept must not lose each other
  // =====================================================================
  section('R07b — a UI save and an accept keep both changes');
  {
    const env = await makeEnv({ mod });
    await tool(env, 41, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'notes', after: 'from agent' }]
    });
    const id = env.__store.reviews[0].id;
    const uiState = await stateOf(env);
    uiState.tasks[7].name = 'From UI';
    const saveReq = new Request('http://localhost/api/cloud/projects/' + PROJECT + '/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-code': OWNER_CODE },
      body: JSON.stringify({
        state: uiState,
        syncMode: 'auto',
        baseUpdatedAt: uiState.updatedAt || null
      })
    });
    const saveP = env.__mod.handleCloudSave(saveReq, env, PROJECT, null);
    const accP = accept(env, id);
    const [saveRes, accRes] = await Promise.all([saveP, accP]);
    const saveData = await saveRes
      .clone()
      .json()
      .catch(function () {
        return null;
      });
    const st = await stateOf(env);
    check('R07b the UI save lands', saveRes.status === 200 && !!(saveData && saveData.ok), {
      status: saveRes.status,
      data: saveData
    });
    check(
      'R07b both the saved field and the accepted field survive',
      st.tasks[5].notes === 'from agent' && st.tasks[7].name === 'From UI',
      {
        notes: st.tasks[5].notes,
        name: st.tasks[7].name,
        acceptStatus: accRes.status,
        saveOk: !!(saveData && saveData.ok)
      }
    );
  }

  // =====================================================================
  // R08 — an identical retry must return the original proposal
  // =====================================================================
  section('R08 — identical apply_changes retried returns the first proposal');
  {
    const env = await makeEnv({ mod });
    const args = { diffs: [{ path: 'tasks', recordId: 't7', field: 'notes', after: 'retry' }] };
    const a = await tool(env, 50, 'apply_changes', args);
    const b = await tool(env, 51, 'apply_changes', args);
    const idA = Number((textOf(a).match(/proposal #(\d+)/) || [])[1] || 0);
    const idB = Number((textOf(b).match(/proposal #(\d+)/) || [])[1] || 0);
    check(
      'R08 a retry returns the same proposal with duplicate: true',
      env.__store.reviews.length === 1 &&
        idA === idB &&
        idA > 0 &&
        /duplicate: true/.test(textOf(b)),
      { rows: env.__store.reviews.length, idA, idB, text: textOf(b).slice(0, 160) }
    );
    const realNow = Date.now;
    Date.now = function () {
      return realNow() + 25 * 60 * 1000;
    };
    const c = await tool(env, 52, 'apply_changes', args);
    Date.now = realNow;
    const idC = Number((textOf(c).match(/proposal #(\d+)/) || [])[1] || 0);
    check(
      'R08b a resend after 25 minutes queues a new row',
      env.__store.reviews.length === 2 && idC !== idA && !/duplicate/.test(textOf(c)),
      { rows: env.__store.reviews.length, idC, text: textOf(c).slice(0, 160) }
    );
  }

  // =====================================================================
  // R08c — the structured second block names every refused op
  // =====================================================================
  section('R08c — the structured block reports refused ops and warnings');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 60, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't6', field: 'notes', after: 'ok' },
        { path: 'tasks', recordId: 't6', field: 'status', before: 'wrong', after: 'todo' },
        { path: 'tasks', recordId: 'nope', field: 'notes', after: 'x' },
        { path: 'bogus', recordId: 'x', field: 'y', after: 1 }
      ],
      sets: [{ path: 'charter', field: 'bad field!', value: 'x' }]
    });
    const meta = blockJson(q, 1);
    check(
      'R08c every refused op appears with a reason',
      meta &&
        Array.isArray(meta.refused) &&
        meta.refused.length === 4 &&
        meta.refused.every(function (r) {
          return r && typeof r.reason === 'string' && r.reason.length > 0;
        }),
      { meta: meta }
    );
    check(
      'R08c counts and proposalId are machine-readable',
      meta &&
        typeof meta.proposalId === 'number' &&
        meta.counts &&
        meta.counts.diffs === 4 &&
        meta.counts.sets === 1 &&
        meta.duplicate === false &&
        meta.truncated === false,
      { meta: meta }
    );
    const env2 = await makeEnv({ mod });
    const q2 = await tool(env2, 61, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'notes', after: 'no before' }]
    });
    const meta2 = blockJson(q2, 1);
    check(
      'R08c an omitted before is listed in warnings',
      meta2 &&
        Array.isArray(meta2.warnings) &&
        meta2.warnings.some(function (w) {
          return /before not checked/.test(w);
        }),
      { warnings: meta2 && meta2.warnings }
    );
  }

  // =====================================================================
  // R09 — a name-only risk reads its name and openRisks is case-insensitive
  // (2.4 acceptance: the defect this section used to reproduce is fixed)
  // =====================================================================
  section('R09 — name-only risks read, openRisks case-insensitive');
  {
    const env = await makeEnv({ mod });
    const r = await tool(env, 60, 'get_risks', {});
    const data = jsonOf(r);
    const risks = data.risks || [];
    const r1 = risks.filter(function (x) {
      return x.id === 'r1';
    })[0];
    check(
      'R09a a risk with name only reads its name in both fields',
      !!r1 && r1.name === 'No description risk' && r1.description === 'No description risk',
      { r1: r1 }
    );
    check(
      'R09b every risk carries isOpen and openRiskCount counts both',
      risks.length === 2 &&
        risks.every(function (x) {
          return x.isOpen === true;
        }) &&
        data.openRiskCount === 2,
      {
        openRiskCount: data.openRiskCount,
        flags: risks.map(function (x) {
          return x.isOpen;
        })
      }
    );
    const s = await tool(env, 61, 'get_project_summary', {});
    const summary = jsonOf(s);
    check('R09c openRisks counts the "Open"-cased risk too', summary.openRisks === 2, {
      openRisks: summary.openRisks
    });
    // A promoted risk (carries issueId) is not open even with status "open".
    const promotedState = baseState();
    promotedState.risks.push({
      id: 'r3',
      description: 'Promoted risk',
      status: 'open',
      issueId: 'i1'
    });
    const env2 = await makeEnv({ mod, state: promotedState });
    const r2 = await tool(env2, 62, 'get_risks', {});
    const data2 = jsonOf(r2);
    const r3 = (data2.risks || []).filter(function (x) {
      return x.id === 'r3';
    })[0];
    check(
      'R09d a promoted risk is not open',
      !!r3 && r3.isOpen === false && r3.promoted === true && data2.openRiskCount === 2,
      { r3: r3, openRiskCount: data2.openRiskCount }
    );
  }

  // =====================================================================
  // R10 — status "done" is refused with the allowed enum
  // =====================================================================
  section('R10 — an unknown status is refused with the allowed enum');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 70, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'status', after: 'done' }]
    });
    const st = await stateOf(env);
    const txt = textOf(q);
    check(
      'R10a status "done" is refused with the allowed list and no row is queued',
      /not one of: todo, inprogress, blocked, completed/.test(txt) &&
        env.__store.reviews.length === 0 &&
        st.tasks[5].status === 'todo',
      { q: txt.slice(0, 160), rows: env.__store.reviews.length, live: st.tasks[5].status }
    );
    // Case-insensitive input maps to the canonical lowercase value.
    const q2 = await tool(env, 71, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'status', after: 'InProgress' }]
    });
    check(
      'R10b "InProgress" queues and stores the canonical lowercase value',
      /Queued 1 field change/.test(textOf(q2)) &&
        env.__store.reviews.length === 1 &&
        JSON.parse(env.__store.reviews[0].submitted_json).tasks[5].status === 'inprogress',
      { q: textOf(q2).slice(0, 120) }
    );
  }

  // =====================================================================
  // R11 — a derived field is refused
  // =====================================================================
  section('R11 — a derived field is refused');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 80, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'critical', after: true }]
    });
    const st = await stateOf(env);
    check(
      'R11 critical is refused as derived and nothing is queued',
      /derived field, recomputed by the app/.test(textOf(q)) &&
        env.__store.reviews.length === 0 &&
        st.tasks[5].critical !== true,
      { q: textOf(q).slice(0, 160), rows: env.__store.reviews.length }
    );
    // A create cannot smuggle a derived field either.
    const q2 = await tool(env, 81, 'apply_changes', {
      creates: [{ path: 'tasks', record: { name: 'Smuggled', critical: true } }]
    });
    check(
      'R11b a create carrying critical is refused',
      /critical: derived field/.test(textOf(q2)) && env.__store.reviews.length === 0,
      { q: textOf(q2).slice(0, 160) }
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
      'R13b the entry has no proposal_id / source_label attribution (not yet attributed)',
      row && row.proposal_id == null && row.source_label == null,
      { row }
    );
  }

  // =====================================================================
  // R14 — get_changes_since is part of the catalog (Phase 4.2 RE-BASELINE:
  // the Phase 0 defect was a missing tool; the fix is the tool plus its
  // paging contract, so this test now proves PRESENCE and the schema).
  // =====================================================================
  section('R14 — get_changes_since is in the catalog with its paging schema');
  {
    const env = await makeEnv({ mod });
    const r = await call(env, { jsonrpc: '2.0', id: 100, method: 'tools/list' });
    const tool = (r.result.tools || []).filter(function (t) {
      return t.name === 'get_changes_since';
    })[0];
    const props = (tool && tool.inputSchema && tool.inputSchema.properties) || {};
    check(
      'R14 tools/list advertises get_changes_since with since, cursor, limit and path',
      !!(tool && props.since && props.cursor && props.limit && props.path),
      { found: !!tool, props: Object.keys(props) }
    );
    check(
      'R14b it is a read tool with an outputSchema',
      !!(
        tool &&
        tool.annotations &&
        tool.annotations.readOnlyHint === true &&
        tool.outputSchema &&
        tool.outputSchema.type === 'object'
      ),
      { annotations: tool && tool.annotations }
    );
  }

  // =====================================================================
  // F1 — validate_changes and apply_changes agree on 50 generated inputs
  // =====================================================================
  section('F1 — the dry run and the queue return identical refusals');
  {
    // Deterministic PRNG so a failure is reproducible.
    function mulberry32(a) {
      return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rnd = mulberry32(20261112);
    const pick = function (arr) {
      return arr[Math.floor(rnd() * arr.length)];
    };
    const PATHS = [
      'tasks',
      'resources',
      'risks',
      'issues',
      'logEntries',
      'meetings',
      'stakeholders',
      'documents',
      'changes',
      'commsEntries',
      'budgetLines',
      'spendLog',
      'nope'
    ];
    const IDS = ['t1', 't6', 't30', 'b1', 's1', 'R001', 'nope', ''];
    const FIELDS = [
      'name',
      'status',
      'notes',
      'description',
      'critical',
      'startDate',
      'predecessors',
      'probability',
      'planned',
      'nope',
      'id'
    ];
    const VALUES = [
      'todo',
      'done',
      'Open',
      'high',
      '2026-02-30',
      '2026-11-12',
      true,
      false,
      0,
      42,
      null,
      '',
      [],
      'x'.repeat(4100)
    ];
    const build = function () {
      const args = {};
      const mode = rnd();
      if (mode < 0.55) {
        const n = 1 + Math.floor(rnd() * 3);
        args.diffs = [];
        for (let i = 0; i < n; i++) {
          args.diffs.push({
            path: pick(PATHS),
            recordId: pick(IDS),
            field: pick(FIELDS),
            after: pick(VALUES)
          });
        }
      } else if (mode < 0.8) {
        const n = 1 + Math.floor(rnd() * 2);
        args.creates = [];
        for (let i = 0; i < n; i++) {
          const rec = {};
          const keys = 1 + Math.floor(rnd() * 3);
          for (let k = 0; k < keys; k++) {
            rec[pick(FIELDS)] = pick(VALUES);
          }
          if (rnd() < 0.7) {
            rec.name = 'Generated ' + i;
          }
          args.creates.push({ path: pick(PATHS), record: rec });
        }
      } else {
        args.sets = [
          {
            path: pick([
              'charter',
              'dmaic',
              'closure',
              'raci',
              'projectName',
              'projectDeadline',
              'methodology',
              'nope'
            ]),
            field: pick([
              'name',
              'define.problem',
              'define.nope',
              'well',
              'methodology',
              'nope',
              ''
            ]),
            value: pick(VALUES)
          }
        ];
      }
      return args;
    };
    const mismatches = [];
    for (let i = 0; i < 50; i++) {
      const args = build();
      const envV = await makeEnv({ mod });
      const envA = await makeEnv({ mod });
      const v = await tool(envV, 1000 + i, 'validate_changes', args);
      const a = await tool(envA, 2000 + i, 'apply_changes', args);
      const vBody = jsonOf(v);
      const aBlock = blockJson(a, 1);
      let same;
      if (vBody) {
        // apply_changes has no structured block when nothing was queued; its
        // prose then carries the same joined refusal list.
        let aRef = null;
        if (aBlock) {
          aRef = aBlock.refusedText;
        } else {
          const idx = textOf(a).indexOf('Refused: ');
          aRef =
            idx === -1
              ? []
              : textOf(a)
                  .slice(idx + 9)
                  .replace(/\.$/, '')
                  .split('; ');
        }
        same =
          JSON.stringify(vBody.refusedText) === JSON.stringify(aRef) &&
          JSON.stringify(vBody.warnings) === JSON.stringify(aBlock ? aBlock.warnings : []);
      } else {
        same = textOf(v) === textOf(a);
      }
      if (!same) {
        mismatches.push({
          i: i,
          args: args,
          validate: textOf(v).slice(0, 300),
          apply: textOf(a).slice(0, 300)
        });
      }
    }
    check(
      'F1 50 generated inputs produce identical refusals from both tools',
      mismatches.length === 0,
      mismatches.slice(0, 2)
    );
  }

  // =====================================================================
  // T1 — a 30-task chain with tempId dependencies in one call
  // =====================================================================
  section('T1 — tempId maps a create chain onto real ids');
  {
    const env = await makeEnv({ mod });
    const creates = [];
    for (let i = 0; i < 30; i++) {
      creates.push({
        path: 'tasks',
        tempId: 'tmp' + i,
        record: {
          name: 'Chain ' + i,
          predecessors: i === 0 ? [] : ['tmp' + (i - 1)]
        }
      });
    }
    const q = await tool(env, 300, 'apply_changes', { creates });
    const row = env.__store.reviews[0];
    const submitted = row ? JSON.parse(row.submitted_json) : { tasks: [] };
    const created = submitted.tasks.slice(BASE_TASKS);
    check(
      'T1a 30 creates queue in one proposal',
      created.length === 30 && /Queued \d+ field change/.test(textOf(q)),
      { q: textOf(q).slice(0, 120), created: created.length }
    );
    check(
      'T1b every stored predecessor is the previous real id',
      created.every(function (t, i) {
        if (i === 0) {
          return (t.predecessors || []).length === 0;
        }
        return t.predecessors && t.predecessors[0] === created[i - 1].id;
      }),
      {
        first: created[0] && created[0].predecessors,
        second: created[1] && created[1].predecessors,
        id0: created[0] && created[0].id
      }
    );
    check(
      'T1c no tempId leaks into the stored state',
      !JSON.stringify(submitted).includes('tmp0') && !JSON.stringify(submitted).includes('tmp29')
    );
    // A forward reference resolves too: A depends on B, B is created after A.
    const env2 = await makeEnv({ mod });
    await tool(env2, 301, 'apply_changes', {
      creates: [
        { path: 'tasks', tempId: 'a', record: { name: 'A', predecessors: ['b'] } },
        { path: 'tasks', tempId: 'b', record: { name: 'B' } }
      ]
    });
    const sub2 = JSON.parse(env2.__store.reviews[0].submitted_json).tasks;
    const a2 = sub2[sub2.length - 2];
    const b2 = sub2[sub2.length - 1];
    check(
      'T1d a forward tempId reference resolves to the later id',
      a2.name === 'A' && b2.name === 'B' && a2.predecessors[0] === b2.id,
      { a: a2, b: b2 }
    );
    // An unknown reference is refused.
    const env3 = await makeEnv({ mod });
    const bad = await tool(env3, 302, 'apply_changes', {
      creates: [{ path: 'tasks', record: { name: 'Orphan', predecessors: ['nope'] } }]
    });
    check(
      'T1e an unknown predecessor is refused',
      /not a task in this project/.test(textOf(bad)) && env3.__store.reviews.length === 0,
      { q: textOf(bad).slice(0, 160) }
    );
  }

  // =====================================================================
  // AT07 — withdraw_changes pulls a queued proposal (whole or partial) back
  // =====================================================================
  section('AT07 — withdraw_changes removes queued ops before the owner decides');
  {
    const findRow = function (store, id) {
      return store.reviews.find(function (r) {
        return String(r.id) === String(id);
      });
    };
    // Whole withdraw: a proposal with several ops is removed from the queue.
    const env = await makeEnv({ mod });
    await tool(env, 400, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't1', field: 'notes', after: 'w1' },
        { path: 'tasks', recordId: 't2', field: 'notes', after: 'w2' },
        { path: 'tasks', recordId: 't3', field: 'notes', after: 'w3' }
      ]
    });
    const wholeId = env.__store.reviews[0].id;
    check('AT07a a proposal with 3 ops is queued', env.__store.reviews[0].ops_count === 3, {
      opsCount: env.__store.reviews[0].ops_count
    });
    const w = await tool(env, 401, 'withdraw_changes', { proposalId: wholeId });
    const wrow = findRow(env.__store, wholeId);
    check(
      'AT07b whole withdraw marks the proposal withdrawn',
      !w.result.isError &&
        /Withdrew proposal #/.test(textOf(w)) &&
        wrow &&
        wrow.status === 'withdrawn',
      { text: textOf(w).slice(0, 120), status: wrow && wrow.status }
    );

    // Partial withdraw: pull two of three ops, leaving one queued.
    const env2 = await makeEnv({ mod });
    await tool(env2, 410, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't1', field: 'notes', after: 'p1' },
        { path: 'tasks', recordId: 't2', field: 'notes', after: 'p2' },
        { path: 'tasks', recordId: 't3', field: 'notes', after: 'p3' }
      ]
    });
    const partId = env2.__store.reviews[0].id;
    const p = await tool(env2, 411, 'withdraw_changes', { proposalId: partId, opIndexes: [0, 2] });
    const prow = findRow(env2.__store, partId);
    let remainingOps = 0;
    try {
      remainingOps = (JSON.parse(prow.ops_json).ops || []).length;
    } catch (e) {}
    check(
      'AT07c partial withdraw keeps the surviving op queued (count 1)',
      !p.result.isError && prow.status === 'pending' && prow.ops_count === 1 && remainingOps === 1,
      { text: textOf(p).slice(0, 120), status: prow.status, opsCount: prow.ops_count, remainingOps }
    );
    // Withdrawing the last op empties the proposal, which becomes withdrawn.
    const p2 = await tool(env2, 412, 'withdraw_changes', { proposalId: partId, opIndexes: [0] });
    check(
      'AT07d withdrawing the last op withdraws the whole proposal',
      !p2.result.isError && findRow(env2.__store, partId).status === 'withdrawn',
      { status: findRow(env2.__store, partId).status }
    );

    // Ownership: a key may not withdraw another key's proposal.
    const env3 = await makeEnv({ mod });
    const otherId = addReview(env3, { source_label: 'Other key', key_id: 'other' });
    const o = await tool(env3, 413, 'withdraw_changes', { proposalId: otherId });
    check(
      "AT07e a key cannot withdraw another key's proposal",
      o.result.isError &&
        /another key/.test(textOf(o)) &&
        findRow(env3.__store, otherId).status === 'pending',
      { text: textOf(o).slice(0, 120), status: findRow(env3.__store, otherId).status }
    );
  }

  // =====================================================================
  // AT08 — change-set accept decides the whole set in ONE R2 write
  // (MCP-AGENT-FIRST 2026-11-12 3.6). Two proposals queued under the
  // same change_set_id are applied proposal-by-proposal on one snapshot
  // and written to R2 exactly once.
  // =====================================================================
  section('AT08 — change-set accept is one read-modify-write for the set');
  {
    const CS = 'cs-AT08';
    const opsA = JSON.stringify({
      v: 2,
      ops: [
        {
          op: 'set',
          path: 'tasks',
          recordId: 't6',
          field: 'status',
          before: 'todo',
          beforeAbsent: false,
          after: 'inprogress',
          afterAbsent: false
        }
      ]
    });
    const opsB = JSON.stringify({
      v: 2,
      ops: [
        {
          op: 'set',
          path: 'tasks',
          recordId: 't7',
          field: 'status',
          before: 'todo',
          beforeAbsent: false,
          after: 'blocked',
          afterAbsent: false
        }
      ]
    });
    const env = await makeEnv({ mod });
    addReview(env, {
      change_set_id: CS,
      key_id: 'k-AT08',
      ops_json: opsA,
      ops_count: 1,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    addReview(env, {
      change_set_id: CS,
      key_id: 'k-AT08',
      ops_json: opsB,
      ops_count: 1,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });

    // Instrument R2.put to count writes to the project state key.
    let r2Puts = 0;
    const origPut = env.R2.put.bind(env.R2);
    env.R2.put = function (k, v, o) {
      if (k === R2_KEY) {
        r2Puts++;
      }
      return origPut(k, v, o);
    };

    const req = new Request(
      'http://localhost/api/cloud/projects/' + PROJECT + '/changesets/' + CS + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner-code': OWNER_CODE },
        body: JSON.stringify({})
      }
    );
    const res = await mod.handleChangeSetAccept(req, env, PROJECT, CS, undefined);
    let data = null;
    try {
      data = await res.clone().json();
    } catch (e) {
      data = null;
    }
    const st = await stateOf(env);
    const rows = env.__store.reviews;
    const bothAccepted =
      rows.length === 2 && rows[0].status === 'accepted' && rows[1].status === 'accepted';
    check(
      'AT08a the set accepts with both proposals decided',
      res.status === 200 && data && data.ok === true && bothAccepted,
      {
        status: res.status,
        data,
        rows: rows.map(function (r) {
          return r.status;
        })
      }
    );
    check(
      'AT08b the two task changes are both present in the resulting state',
      st.tasks[5].status === 'inprogress' && st.tasks[6].status === 'blocked',
      { t6: st.tasks[5].status, t7: st.tasks[6].status }
    );
    check('AT08c the whole set was written to R2 exactly once', r2Puts === 1, { r2Puts });
    check(
      'AT08d each proposal got its own apply_report_json and a changelog entry',
      rows.every(function (r) {
        return !!r.apply_report_json;
      }) && env.__store.changelog.length === 2,
      {
        reports: rows.map(function (r) {
          return !!r.apply_report_json;
        }),
        changelog: env.__store.changelog.length
      }
    );
  }

  // =====================================================================
  // AT09 — change-set reject declines every pending proposal in the set
  // =====================================================================
  section('AT09 — change-set reject declines the whole set');
  {
    const CS = 'cs-AT09';
    const env = await makeEnv({ mod });
    addReview(env, {
      change_set_id: CS,
      key_id: 'k-AT09',
      ops_json: JSON.stringify({
        v: 2,
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't6',
            field: 'notes',
            before: '',
            beforeAbsent: false,
            after: 'r1',
            afterAbsent: false
          }
        ]
      }),
      ops_count: 1,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    addReview(env, {
      change_set_id: CS,
      key_id: 'k-AT09',
      ops_json: JSON.stringify({
        v: 2,
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't7',
            field: 'notes',
            before: '',
            beforeAbsent: false,
            after: 'r2',
            afterAbsent: false
          }
        ]
      }),
      ops_count: 1,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    const req = new Request(
      'http://localhost/api/cloud/projects/' + PROJECT + '/changesets/' + CS + '/reject',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner-code': OWNER_CODE },
        body: JSON.stringify({})
      }
    );
    const res = await mod.handleChangeSetReject(req, env, PROJECT, CS);
    let data = null;
    try {
      data = await res.clone().json();
    } catch (e) {
      data = null;
    }
    const rows = env.__store.reviews;
    check(
      'AT09a the whole set is rejected',
      res.status === 200 &&
        data &&
        data.ok === true &&
        data.rejected === 2 &&
        rows.length === 2 &&
        rows.every(function (r) {
          return r.status === 'rejected';
        }),
      {
        status: res.status,
        data,
        rows: rows.map(function (r) {
          return r.status;
        })
      }
    );
  }

  // =====================================================================
  // AT10 — get_apply_report reads the stored report (pending = null, after
  // accept = the per-op report)
  // =====================================================================
  section('AT10 — get_apply_report returns the stored accept report');
  {
    const env = await makeEnv({ mod });
    const q = await tool(env, 900, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'status', after: 'inprogress' }]
    });
    const idA = Number((textOf(q).match(/proposal #(\d+)/) || [])[1] || 0);
    const before = await tool(env, 901, 'get_apply_report', { proposalId: idA });
    const bData = jsonOf(before);
    check(
      'AT10a a pending proposal has no report yet',
      bData && bData.reports && bData.reports.length === 1 && bData.reports[0].report === null,
      { bData }
    );
    const a = await accept(env, idA);
    const after = await tool(env, 902, 'get_apply_report', { proposalId: idA });
    const aData = jsonOf(after);
    const rep = aData && aData.reports && aData.reports[0] ? aData.reports[0].report : null;
    check(
      'AT10b after accept the report lists the applied op',
      a.status === 200 &&
        rep &&
        Array.isArray(rep.report) &&
        rep.report.length === 1 &&
        rep.report[0].result === 'applied',
      { status: a.status, rep }
    );
  }

  // =====================================================================
  // AT11 — get_proposal_status: change-set listing + accepted-with-conflicts
  // =====================================================================
  section('AT11 — get_proposal_status lists by change set and reports conflicts');
  {
    const cs = 'cs-AT11';
    const env = await makeEnv({ mod });
    addReview(env, { change_set_id: cs, key_id: 'k-AT11' });
    addReview(env, { change_set_id: cs, key_id: 'k-AT11' });
    const list = await tool(env, 910, 'get_proposal_status', { changeSetId: cs });
    const lData = jsonOf(list);
    check(
      'AT11a changeSetId returns the two proposals in the set',
      lData && lData.count === 2 && lData.proposals.length === 2,
      { lData }
    );
    // Mixed proposal: one op applies, one conflicts (stale before).
    const env2 = await makeEnv({ mod });
    addReview(env2, {
      change_set_id: 'cs-mix',
      key_id: 'k-mix',
      ops_json: JSON.stringify({
        v: 2,
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't6',
            field: 'status',
            before: 'todo',
            beforeAbsent: false,
            after: 'inprogress',
            afterAbsent: false
          },
          {
            op: 'set',
            path: 'tasks',
            recordId: 't7',
            field: 'status',
            before: 'completed',
            beforeAbsent: false,
            after: 'blocked',
            afterAbsent: false
          }
        ]
      }),
      ops_count: 2,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    const mixedId = env2.__store.reviews[0].id;
    const acc = await accept(env2, mixedId);
    const status = await tool(env2, 911, 'get_proposal_status', { proposalId: mixedId });
    const sData = jsonOf(status);
    const prop = sData && sData.proposals && sData.proposals[0] ? sData.proposals[0] : null;
    check(
      'AT11b a proposal with a conflict is surfaced as accepted-with-conflicts',
      acc.status === 200 &&
        prop &&
        prop.outcome === 'accepted-with-conflicts' &&
        sData.proposals[0].changeSetId === 'cs-mix',
      { accStatus: acc.status, outcome: prop && prop.outcome, cs: prop && prop.changeSetId }
    );
  }

  // =====================================================================
  // AT12 — get_pending: change-set grouping + read-only dry-run preview
  // =====================================================================
  section('AT12 — get_pending groups by change set and previews conflicts');
  {
    const cs = 'cs-AT12';
    const env = await makeEnv({ mod });
    addReview(env, {
      change_set_id: cs,
      key_id: 'k-AT12',
      ops_json: JSON.stringify({
        v: 2,
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't6',
            field: 'status',
            before: 'todo',
            beforeAbsent: false,
            after: 'inprogress',
            afterAbsent: false
          }
        ]
      }),
      ops_count: 1,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    addReview(env, {
      change_set_id: cs,
      key_id: 'k-AT12',
      ops_json: JSON.stringify({
        v: 2,
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't7',
            field: 'notes',
            before: '',
            beforeAbsent: false,
            after: 'pending note',
            afterAbsent: false
          }
        ]
      }),
      ops_count: 1,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    const pend = await tool(env, 920, 'get_pending', {});
    const pData = jsonOf(pend);
    const sets = pData && pData.changeSets ? Object.keys(pData.changeSets) : [];
    const thisSet = pData && pData.changeSets ? pData.changeSets[cs] : null;
    check(
      'AT12a pending proposals are grouped by change set',
      pData &&
        sets.length === 1 &&
        thisSet &&
        thisSet.proposals.length === 2 &&
        thisSet.proposals[0].opCount === 1,
      { sets, thisSet }
    );
    check(
      'AT12b the dry run previews the accept with no conflicts',
      pData &&
        pData.dryRun &&
        pData.dryRun.ok === true &&
        Array.isArray(pData.dryRun.conflicts) &&
        pData.dryRun.conflicts.length === 0,
      { dryRun: pData && pData.dryRun }
    );
  }

  // AT22 (A1): per-API-key-per-project abuse limits refuse the whole call.
  {
    // 22a: pending-proposal cap (50). Seed 50 pending rows for this key.
    const env = await makeEnv({ mod });
    for (let i = 0; i < 50; i++) {
      env.__store.reviews.push({
        id: 9000 + i,
        project_id: PROJECT,
        key_id: '1',
        status: 'pending',
        ops_count: 1,
        proposed_at: new Date().toISOString(),
        import_key: 'seed' + i,
        ops_json: JSON.stringify({ v: 2, ops: [] }),
        diffs_json: '[]',
        proposal_type: 'mcp',
        source_type: 'api'
      });
    }
    const capRes = await mod.queueMcpProposal(
      env,
      PROJECT,
      { apiKeyId: '1', scope: ALL_SECTIONS, label: 'Agent key' },
      { diffs: [{ path: 'tasks', recordId: 't1', field: 'notes', after: 'x' }] },
      1,
      env.__store.state
    );
    check(
      'AT22a pending cap (50) refuses the whole call',
      capRes &&
        capRes.result &&
        capRes.result.isError === true &&
        /50 pending/.test(capRes.result.content[0].text),
      capRes && capRes.result && capRes.result.content && capRes.result.content[0].text
    );

    // 22b: daily op limit (2000). Seed an accepted-today row summing 2000 ops.
    const env2 = await makeEnv({ mod });
    env2.__store.reviews.push({
      id: 9500,
      project_id: PROJECT,
      key_id: '1',
      status: 'accepted',
      ops_count: 2000,
      proposed_at: new Date().toISOString(),
      import_key: 'seed-big',
      ops_json: JSON.stringify({ v: 2, ops: [] }),
      diffs_json: '[]',
      proposal_type: 'mcp',
      source_type: 'api'
    });
    const dayRes = await mod.queueMcpProposal(
      env2,
      PROJECT,
      { apiKeyId: '1', scope: ALL_SECTIONS, label: 'Agent key' },
      { diffs: [{ path: 'tasks', recordId: 't1', field: 'notes', after: 'y' }] },
      1,
      env2.__store.state
    );
    check(
      'AT22b daily op limit (2000) refuses the whole call',
      dayRes &&
        dayRes.result &&
        dayRes.result.isError === true &&
        /today/.test(dayRes.result.content[0].text),
      dayRes && dayRes.result && dayRes.result.content && dayRes.result.content[0].text
    );

    // 22c: a rejected row frees its pending slot, so a 50th is allowed.
    const env3 = await makeEnv({ mod });
    for (let i = 0; i < 49; i++) {
      env3.__store.reviews.push({
        id: 9600 + i,
        project_id: PROJECT,
        key_id: '1',
        status: 'pending',
        ops_count: 1,
        proposed_at: new Date().toISOString(),
        import_key: 's' + i,
        ops_json: JSON.stringify({ v: 2, ops: [] }),
        diffs_json: '[]',
        proposal_type: 'mcp',
        source_type: 'api'
      });
    }
    env3.__store.reviews.push({
      id: 9699,
      project_id: PROJECT,
      key_id: '1',
      status: 'rejected',
      ops_count: 1,
      proposed_at: new Date().toISOString(),
      import_key: 'srej',
      ops_json: JSON.stringify({ v: 2, ops: [] }),
      diffs_json: '[]',
      proposal_type: 'mcp',
      source_type: 'api'
    });
    const okRes = await mod.queueMcpProposal(
      env3,
      PROJECT,
      { apiKeyId: '1', scope: ALL_SECTIONS, label: 'Agent key' },
      { diffs: [{ path: 'tasks', recordId: 't1', field: 'notes', after: 'z' }] },
      1,
      env3.__store.state
    );
    check(
      'AT22c a rejected row frees its pending slot so the 50th is allowed',
      okRes && okRes.result && okRes.result.isError !== true,
      okRes && okRes.result && okRes.result.content && okRes.result.content[0].text
    );
  }

  // =====================================================================
  // AT23 (A2) — a FIXED error-code set. Every `refused` entry and every
  // non-applied apply-report result carries a `code` from the set, and
  // get_schema publishes the set so an agent can branch on a stable token.
  // =====================================================================
  section('AT23 — fixed error codes on refusals and apply results');
  {
    // 23a: get_schema publishes the frozen 23-code set.
    const env = await makeEnv({ mod });
    const sch = await tool(env, 920, 'get_schema', {});
    const sData = jsonOf(sch);
    const codes = sData && Array.isArray(sData.errorCodes) ? sData.errorCodes : [];
    const codeSet = new Set(codes);
    check(
      'AT23a get_schema publishes the fixed error-code set (23 codes)',
      codes.length === 23 &&
        codeSet.has('STALE_BEFORE') &&
        codeSet.has('REFUSED') &&
        codeSet.has('SKIPPED_ALREADY'),
      { errorCodes: codes }
    );

    // 23b: one valid diff keeps the call queueable, three bad ones are refused;
    // every structured refusal carries a code in the published set.
    const q = await tool(env, 921, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't1', field: 'notes', after: 'ok' },
        { path: 'tasks', recordId: 't1', field: 'nope', after: 'x' },
        { path: 'tasks', recordId: 't1', field: 'status', after: 'bogus' },
        { path: 'tasks', recordId: 'zzz', field: 'notes', after: 'x' },
        { path: 'notASection', recordId: 'x', field: 'y', after: 1 }
      ]
    });
    const sBlock = blockJson(q, 1);
    const refused = (sBlock && sBlock.refused) || [];
    check(
      'AT23b every structured refusal carries a code in the set',
      refused.length >= 3 &&
        refused.every(function (r) {
          return r && typeof r.code === 'string' && codeSet.has(r.code);
        }),
      { refused: refused }
    );

    // 23c: a mixed proposal (one applied, one stale conflict) accepted; every
    // NON-applied apply-report entry carries a code in the set.
    const env2 = await makeEnv({ mod });
    addReview(env2, {
      change_set_id: 'cs-AT23',
      key_id: 'k-AT23',
      ops_json: JSON.stringify({
        v: 2,
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't6',
            field: 'status',
            before: 'todo',
            beforeAbsent: false,
            after: 'inprogress',
            afterAbsent: false
          },
          {
            op: 'set',
            path: 'tasks',
            recordId: 't7',
            field: 'status',
            before: 'completed',
            beforeAbsent: false,
            after: 'blocked',
            afterAbsent: false
          }
        ]
      }),
      ops_count: 2,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    const mixedId = env2.__store.reviews[0].id;
    const acc = await accept(env2, mixedId);
    const repRes = await tool(env2, 922, 'get_apply_report', { proposalId: mixedId });
    const rData = jsonOf(repRes);
    const rep = rData && rData.reports && rData.reports[0] ? rData.reports[0].report : null;
    const entries = (rep && rep.report) || [];
    const nonApplied = entries.filter(function (e) {
      return e && e.result !== 'applied';
    });
    check(
      'AT23c every non-applied apply-report result carries a code in the set',
      acc.status === 200 &&
        nonApplied.length >= 1 &&
        nonApplied.every(function (e) {
          return typeof e.code === 'string' && codeSet.has(e.code);
        }),
      { accStatus: acc.status, entries: entries }
    );
  }

  // =====================================================================
  // AT24 (A3) — cross-proposal dependencies. A proposal is validated against
  // live state OVERLAID with the same key's pending ops; when it targets a
  // record a pending proposal creates, its ops_json records dependsOn; a
  // single accept of a dependent is refused (DEPENDS_ON_PENDING); Accept-all
  // applies in id order; withdrawing a depended-on proposal is refused.
  // =====================================================================
  section('AT24 — cross-proposal dependencies');
  {
    const KEY = { apiKeyId: '1', scope: ALL_SECTIONS, label: 'Agent key' };
    const env = await makeEnv({ mod });
    const p1 = await mod.queueMcpProposal(
      env,
      PROJECT,
      KEY,
      { creates: [{ path: 'tasks', record: { name: 'Dep Task' } }] },
      1,
      env.__store.state
    );
    check(
      'AT24a P1 create queued',
      p1 && p1.result && p1.result.isError !== true,
      p1 && p1.result && p1.result.content && p1.result.content[0].text
    );
    const p1Row = env.__store.reviews.find(function (r) {
      return r.proposal_type === 'mcp' && r.status === 'pending';
    });
    const p1Env = p1Row ? JSON.parse(p1Row.ops_json) : null;
    const createOp =
      p1Env && p1Env.ops
        ? p1Env.ops.find(function (o) {
            return o.op === 'create';
          })
        : null;
    const createdId = createOp && createOp.record ? createOp.record.id : null;
    const p1Id = p1Row ? p1Row.id : null;

    // P2 targets the record P1 creates - it exists ONLY in the overlay.
    const p2 = await mod.queueMcpProposal(
      env,
      PROJECT,
      KEY,
      { diffs: [{ path: 'tasks', recordId: createdId, field: 'notes', after: 'depends' }] },
      2,
      env.__store.state
    );
    const p2Row = env.__store.reviews.find(function (r) {
      return r.status === 'pending' && r.id !== p1Id;
    });
    const p2Env = p2Row ? JSON.parse(p2Row.ops_json) : null;
    check(
      'AT24b P2 validates against the overlaid state and queues',
      p2 && p2.result && p2.result.isError !== true,
      p2 && p2.result && p2.result.content && p2.result.content[0].text
    );
    check(
      'AT24c P2 ops_json records dependsOn [P1]',
      !!(
        p2Env &&
        Array.isArray(p2Env.dependsOn) &&
        p2Env.dependsOn.map(String).indexOf(String(p1Id)) > -1
      ),
      { dependsOn: p2Env && p2Env.dependsOn, p1Id: p1Id }
    );

    // Single accept of the dependent while its dependency is pending -> 409.
    const acc = await accept(env, p2Row.id);
    check(
      'AT24d single accept of a dependent proposal is refused (DEPENDS_ON_PENDING)',
      acc.status === 409 && /depend/i.test(acc.text),
      { status: acc.status, text: acc.text }
    );

    // Accept-all applies the whole chain in id order.
    const cs = p1Row.change_set_id;
    const req = new Request(
      'http://localhost/api/cloud/projects/' + PROJECT + '/changesets/' + cs + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner-code': OWNER_CODE },
        body: '{}'
      }
    );
    const res = await mod.handleChangeSetAccept(req, env, PROJECT, cs, undefined);
    let data = null;
    try {
      data = await res.clone().json();
    } catch (e) {
      data = null;
    }
    const st = await stateOf(env);
    const hasTask =
      st &&
      Array.isArray(st.tasks) &&
      st.tasks.some(function (t) {
        return String(t.id) === String(createdId) && t.notes === 'depends';
      });
    check(
      'AT24e accept-all applies the dependency chain in id order',
      res.status === 200 && !!(data && data.ok) && hasTask,
      { status: res.status, hasTask: hasTask }
    );

    // Withdrawing a depended-on proposal is refused.
    const envF = await makeEnv({ mod });
    await mod.queueMcpProposal(
      envF,
      PROJECT,
      KEY,
      { creates: [{ path: 'tasks', record: { name: 'Dep Task F' } }] },
      3,
      envF.__store.state
    );
    const f1Row = envF.__store.reviews.find(function (r) {
      return r.proposal_type === 'mcp' && r.status === 'pending';
    });
    const f1Env = f1Row ? JSON.parse(f1Row.ops_json) : null;
    const fCreate =
      f1Env && f1Env.ops
        ? f1Env.ops.find(function (o) {
            return o.op === 'create';
          })
        : null;
    const fCreatedId = fCreate && fCreate.record ? fCreate.record.id : null;
    await mod.queueMcpProposal(
      envF,
      PROJECT,
      KEY,
      { diffs: [{ path: 'tasks', recordId: fCreatedId, field: 'notes', after: 'dep' }] },
      4,
      envF.__store.state
    );
    const wd = await mod.withdrawMcpProposal(
      envF,
      PROJECT,
      { apiKeyId: '1', role: 'api', scope: ALL_SECTIONS, label: 'Agent key' },
      { proposalId: f1Row.id },
      950
    );
    check(
      'AT24f withdrawing a depended-on proposal is refused',
      wd && wd.result && wd.result.isError === true && /depend/i.test(wd.result.content[0].text),
      wd && wd.result && wd.result.content && wd.result.content[0].text
    );
  }

  // =====================================================================
  // AT25 (A4) — D1/R2 recovery. The R2 state is written BEFORE the D1 status
  // update, so a crash between them leaves the change persisted but the
  // proposal still pending. Re-accepting then finds every op already applied
  // (skipped_already) and must HEAL to accepted instead of 409.
  // =====================================================================
  section('AT25 — D1/R2 recovery (all-skipped heals to accepted)');
  {
    // 25a: single accept, then simulate a lost D1 status update (R2 keeps the
    // change); the retry must heal to accepted.
    const env = await makeEnv({ mod });
    const q = await tool(env, 970, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'status', after: 'inprogress' }]
    });
    const id = Number((textOf(q).match(/proposal #(\d+)/) || [])[1] || 0);
    await accept(env, id);
    const row = env.__store.reviews.find(function (r) {
      return r.id === id;
    });
    // R2 holds the change now; simulate the D1 status update being lost.
    row.status = 'pending';
    row.apply_report_json = null;
    const retry = await accept(env, id);
    check(
      'AT25a a retry after a lost D1 status heals to accepted (not 409)',
      retry.status === 200 &&
        !!(retry.data && retry.data.ok === true && retry.data.status === 'accepted'),
      { status: retry.status, data: retry.data && { ok: retry.data.ok, status: retry.data.status } }
    );
    check(
      'AT25b the healing retry reports the op as skipped, not applied',
      !!(retry.data && retry.data.skipped >= 1 && retry.data.applied === 0),
      retry.data && { skipped: retry.data.skipped, applied: retry.data.applied }
    );
    const rowAfter = env.__store.reviews.find(function (r) {
      return r.id === id;
    });
    check(
      'AT25c D1 status is accepted after the healing retry',
      !!(rowAfter && rowAfter.status === 'accepted'),
      { status: rowAfter && rowAfter.status }
    );

    // 25d: the same recovery for a whole change set (Accept-all).
    const env2 = await makeEnv({ mod });
    const CS = 'cs-AT25';
    addReview(env2, {
      change_set_id: CS,
      key_id: 'k-AT25',
      ops_json: JSON.stringify({
        v: 2,
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't6',
            field: 'status',
            before: 'todo',
            beforeAbsent: false,
            after: 'inprogress',
            afterAbsent: false
          }
        ]
      }),
      ops_count: 1,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    const setReq = function () {
      return new Request(
        'http://localhost/api/cloud/projects/' + PROJECT + '/changesets/' + CS + '/accept',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-owner-code': OWNER_CODE },
          body: '{}'
        }
      );
    };
    const firstSet = await mod.handleChangeSetAccept(setReq(), env2, PROJECT, CS, undefined);
    // Simulate the D1 status update being lost for every row in the set.
    env2.__store.reviews.forEach(function (r) {
      if (r.change_set_id === CS) {
        r.status = 'pending';
      }
    });
    const retrySet = await mod.handleChangeSetAccept(setReq(), env2, PROJECT, CS, undefined);
    let retryData = null;
    try {
      retryData = await retrySet.clone().json();
    } catch (e) {
      retryData = null;
    }
    check(
      'AT25d a change-set retry after a lost D1 status heals to accepted',
      firstSet.status === 200 && retrySet.status === 200 && !!(retryData && retryData.ok === true),
      {
        firstStatus: firstSet.status,
        retryStatus: retrySet.status,
        retryOk: retryData && retryData.ok
      }
    );
  }

  // =====================================================================
  // AT26 (A5) — MCP polish. Every tool advertises machine-readable
  // annotations + an outputSchema, every successful call returns
  // structuredContent that equals the JSON block, the server announces
  // version 2.0.0, and both surfaces warn that record text is data.
  // =====================================================================
  section('AT26 — MCP polish (annotations, outputSchema, version, injection warning)');
  {
    const env = await makeEnv({ mod });
    const init = await call(env, { jsonrpc: '2.0', id: 960, method: 'initialize', params: {} });
    const info = init && init.result && init.result.serverInfo;
    const instr = (init && init.result && init.result.instructions) || '';
    check(
      'AT26a initialize reports serverInfo.version 2.0.0 and the record-text warning',
      !!(
        info &&
        info.version === '2.0.0' &&
        /record/i.test(instr) &&
        /not instructions/i.test(instr)
      ),
      { version: info && info.version, instructions: instr.slice(0, 120) }
    );

    const list = await call(env, { jsonrpc: '2.0', id: 961, method: 'tools/list', params: {} });
    const tools = (list && list.result && list.result.tools) || [];
    const badAnn = tools.filter(function (t) {
      const a = t.annotations || {};
      return (
        typeof a.title !== 'string' ||
        !a.title ||
        typeof a.readOnlyHint !== 'boolean' ||
        typeof a.destructiveHint !== 'boolean' ||
        typeof a.openWorldHint !== 'boolean' ||
        typeof a.idempotentHint !== 'boolean'
      );
    });
    check(
      'AT26b every advertised tool carries a full annotation block',
      tools.length >= 16 && badAnn.length === 0,
      {
        tools: tools.length,
        bad: badAnn.map(function (t) {
          return t.name;
        })
      }
    );

    const noSchema = tools.filter(function (t) {
      return !t.outputSchema || t.outputSchema.type !== 'object';
    });
    check(
      'AT26c every advertised tool declares an object outputSchema',
      tools.length > 0 && noSchema.length === 0,
      {
        bad: noSchema.map(function (t) {
          return t.name;
        })
      }
    );

    // A schema whose required list names a property it does not describe is a
    // contract the server can never honour - fail it statically.
    const brokenSchema = tools.filter(function (t) {
      const sch = t.outputSchema || {};
      const props = sch.properties || {};
      return (sch.required || []).some(function (k) {
        return !props[k];
      });
    });
    check('AT26d no outputSchema requires an undeclared property', brokenSchema.length === 0, {
      bad: brokenSchema.map(function (t) {
        return t.name;
      })
    });

    // The hints must be honest, not decorative.
    const byName = {};
    tools.forEach(function (t) {
      byName[t.name] = t.annotations || {};
    });
    const reads = tools.filter(function (t) {
      return t.name.indexOf('get_') === 0 || t.name === 'validate_changes';
    });
    const dishonestReads = reads.filter(function (t) {
      const a = byName[t.name];
      return a.readOnlyHint !== true || a.destructiveHint !== false;
    });
    check(
      'AT26e every read tool is readOnlyHint true and destructiveHint false',
      reads.length >= 12 && dishonestReads.length === 0,
      {
        reads: reads.length,
        bad: dishonestReads.map(function (t) {
          return t.name;
        })
      }
    );
    check(
      'AT26f write tools are not readOnly and Monte Carlo is not idempotent',
      byName.apply_changes.readOnlyHint === false &&
        byName.withdraw_changes.readOnlyHint === false &&
        byName.apply_changes.destructiveHint === true &&
        byName.run_monte_carlo.idempotentHint === false &&
        byName.get_project_summary.idempotentHint === true,
      {
        apply: byName.apply_changes,
        withdraw: byName.withdraw_changes,
        mc: byName.run_monte_carlo
      }
    );

    // structuredContent must be the machine copy of the text block, never a
    // second rendering that can drift.
    const sum = await tool(env, 962, 'get_project_summary', {});
    const sumBody = jsonOf(sum);
    const sumSc = sum && sum.result && sum.result.structuredContent;
    check(
      'AT26g a read call returns structuredContent equal to its JSON text block',
      !!sumSc &&
        typeof sumSc === 'object' &&
        JSON.stringify(sumSc) === JSON.stringify(sumBody) &&
        typeof sumSc.projectId === 'string' &&
        typeof sumSc.completion === 'number',
      { keys: sumSc ? Object.keys(sumSc) : null }
    );

    const q = await tool(env, 963, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't7', field: 'status', after: 'inprogress' }]
    });
    const qSc = q && q.result && q.result.structuredContent;
    check(
      'AT26h apply_changes returns structuredContent from its second (JSON) block',
      !!(qSc && qSc.proposalId > 0 && qSc.counts && qSc.counts.diffs === 1),
      { sc: qSc && { proposalId: qSc.proposalId, counts: qSc.counts } }
    );

    const bad = await tool(env, 964, 'get_apply_report', {});
    check(
      'AT26i an isError result carries no structuredContent',
      !!(
        bad &&
        bad.result &&
        bad.result.isError === true &&
        bad.result.structuredContent === undefined
      ),
      { isError: bad && bad.result && bad.result.isError }
    );

    // The app-wide surface shares the catalog and the constants.
    const appwide = await import('../src/mcp/appwide.js');
    const awTools = appwide.APPWIDE_TOOLS || [];
    const awBad = awTools.filter(function (t) {
      return !t.annotations || !t.outputSchema || t.outputSchema.type !== 'object';
    });
    check(
      'AT26j the app-wide catalog carries the same annotations and outputSchemas',
      awTools.length >= 17 &&
        awBad.length === 0 &&
        !!(appwide.APPWIDE_SERVER_INFO && appwide.APPWIDE_SERVER_INFO.version === '2.0.0'),
      {
        tools: awTools.length,
        bad: awBad.map(function (t) {
          return t.name;
        }),
        version: appwide.APPWIDE_SERVER_INFO && appwide.APPWIDE_SERVER_INFO.version
      }
    );
  }

  // =====================================================================
  // AT27 (A6) — report size and retention. A stored report keeps at most 500
  // entries plus a summary of ALL of them, decided rows older than 90 days
  // lose their op list and keep only that summary, and get_apply_report says
  // so instead of pretending the report never existed.
  // =====================================================================
  section('AT27 — report size and retention');
  {
    const env = await makeEnv({ mod });
    const store = typeof mod.storeApplyReport === 'function' ? mod.storeApplyReport : null;
    check('AT27a the report store helper is exported', !!store, {
      type: typeof mod.storeApplyReport
    });

    // 600 entries is the shape a bulk proposal produces; the stored copy must
    // be capped while the summary still counts every one of them.
    let capped = null;
    try {
      capped = store
        ? JSON.parse(
            store(
              Array.from({ length: 600 }, function (_, i) {
                return { path: 'tasks', recordId: 't' + i, field: 'status', result: 'applied' };
              }),
              [{ path: 'tasks', field: 'critical' }],
              []
            )
          )
        : null;
    } catch (e) {
      capped = null;
    }
    check(
      'AT27b a 600-entry report stores 500 entries and counts all 600',
      !!(
        capped &&
        Array.isArray(capped.report) &&
        capped.report.length === 500 &&
        capped.truncated === true &&
        capped.summary &&
        capped.summary.total === 600 &&
        capped.summary.applied === 600 &&
        capped.storedCount === 500
      ),
      capped && {
        kept: capped.report && capped.report.length,
        truncated: capped.truncated,
        summary: capped.summary,
        storedCount: capped.storedCount
      }
    );

    // A real accept must persist that shape, not the raw report.
    const q = await tool(env, 980, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't6', field: 'status', after: 'inprogress' },
        { path: 'tasks', recordId: 't7', field: 'status', after: 'blocked' }
      ]
    });
    const pid = Number((textOf(q).match(/proposal #(\d+)/) || [])[1] || 0);
    await accept(env, pid);
    const stored = env.__store.reviews.find(function (r) {
      return r.id === pid;
    });
    let storedRep = null;
    try {
      storedRep = stored && stored.apply_report_json ? JSON.parse(stored.apply_report_json) : null;
    } catch (e) {
      storedRep = null;
    }
    check(
      'AT27c a real accept stores the versioned report with its summary',
      !!(
        storedRep &&
        storedRep.v === 1 &&
        storedRep.summary &&
        storedRep.summary.total === 2 &&
        storedRep.summary.applied === 2 &&
        Array.isArray(storedRep.report) &&
        storedRep.report.length === 2 &&
        storedRep.truncated === false
      ),
      storedRep && {
        v: storedRep.v,
        summary: storedRep.summary,
        kept: storedRep.report && storedRep.report.length
      }
    );

    // Retention: 90 days. Build one old accepted row, one fresh accepted row
    // and one old PENDING row (which must never be touched).
    const env2 = await makeEnv({ mod });
    const DAY = 86400000;
    const oldIso = new Date(Date.now() - 120 * DAY).toISOString();
    const freshIso = new Date(Date.now() - 2 * DAY).toISOString();
    const reportJson = JSON.stringify({
      v: 1,
      summary: { total: 1, applied: 1 },
      report: [{ path: 'tasks', recordId: 't6', field: 'status', result: 'applied' }],
      truncated: false,
      storedCount: 1,
      derivedChanges: [],
      conflicts: []
    });
    const oldId = addReview(env2, {
      status: 'accepted',
      decided_at: oldIso,
      ops_json: JSON.stringify({ v: 2, ops: [{ op: 'set', path: 'tasks' }] }),
      ops_count: 1,
      apply_report_json: reportJson,
      change_set_id: 'cs-AT27-old'
    });
    const freshId = addReview(env2, {
      status: 'accepted',
      decided_at: freshIso,
      ops_json: JSON.stringify({ v: 2, ops: [{ op: 'set', path: 'tasks' }] }),
      ops_count: 1,
      apply_report_json: reportJson,
      change_set_id: 'cs-AT27-fresh'
    });
    const pendingId = addReview(env2, {
      status: 'pending',
      proposed_at: oldIso,
      ops_json: JSON.stringify({ v: 2, ops: [{ op: 'set', path: 'tasks' }] }),
      ops_count: 1,
      change_set_id: 'cs-AT27-pending'
    });

    const prune = typeof mod.pruneDecidedReports === 'function' ? mod.pruneDecidedReports : null;
    let pruned = null;
    try {
      pruned = prune ? await prune(env2, Date.now()) : null;
    } catch (e) {
      pruned = { error: e && e.message };
    }
    const byId = function (id) {
      return env2.__store.reviews.find(function (r) {
        return r.id === id;
      });
    };
    const oldRow = byId(oldId);
    const freshRow = byId(freshId);
    const pendingRow = byId(pendingId);
    let oldRep = null;
    try {
      oldRep = oldRow && oldRow.apply_report_json ? JSON.parse(oldRow.apply_report_json) : null;
    } catch (e) {
      oldRep = null;
    }
    check(
      'AT27d a 120-day-old decided row loses its op list and keeps a summary',
      !!(
        prune &&
        oldRow &&
        oldRow.ops_json === null &&
        oldRep &&
        oldRep.pruned === true &&
        !oldRep.report &&
        oldRep.summary &&
        oldRep.summary.total === 1
      ),
      {
        prune: pruned,
        ops: oldRow && oldRow.ops_json,
        rep: oldRep && {
          pruned: oldRep.pruned,
          summary: oldRep.summary,
          hasReport: !!oldRep.report
        }
      }
    );
    check(
      'AT27e a 2-day-old decided row keeps its op list and its full report',
      !!(
        freshRow &&
        typeof freshRow.ops_json === 'string' &&
        freshRow.apply_report_json &&
        JSON.parse(freshRow.apply_report_json).report.length === 1
      ),
      {
        ops: freshRow && typeof freshRow.ops_json,
        rep: freshRow && freshRow.apply_report_json ? 'present' : null
      }
    );
    check(
      'AT27f a pending row is never pruned, however old',
      !!(pendingRow && typeof pendingRow.ops_json === 'string'),
      { ops: pendingRow && typeof pendingRow.ops_json }
    );

    // The read tool must say "pruned", not "no report".
    const rep = await tool(env2, 981, 'get_apply_report', { proposalId: oldId });
    const repBody = jsonOf(rep);
    const one = repBody && repBody.reports && repBody.reports[0];
    check(
      'AT27g get_apply_report returns the summary and pruned:true for a pruned row',
      !!(
        one &&
        one.pruned === true &&
        one.report === null &&
        one.summary &&
        one.summary.total === 1 &&
        typeof one.note === 'string' &&
        one.note.length > 0
      ),
      one && { pruned: one.pruned, report: one.report, summary: one.summary, note: one.note }
    );
  }

  // =====================================================================
  // AT15 (4.1) — attribution. The changelog must say WHO wrote a change:
  // 'ui' for the owner's own save, 'editor' for an editor/team save, 'agent'
  // with the key label and key id for an accepted agent proposal. The human
  // who clicked Accept stays in actor_type / actor_label.
  // =====================================================================
  section('AT15 — changelog attribution (agent vs ui vs editor)');
  {
    // 15a: the owner's own save is 'ui'.
    const env = await makeEnv({ mod });
    const st = await stateOf(env);
    st.tasks[8].name = 'Renamed in the UI';
    const saveReq = new Request('http://localhost/api/cloud/projects/' + PROJECT + '/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-code': OWNER_CODE },
      body: JSON.stringify({ state: st, syncMode: 'auto', baseUpdatedAt: st.updatedAt || null })
    });
    const saveRes = await mod.handleCloudSave(saveReq, env, PROJECT, null);
    const saveData = await saveRes
      .clone()
      .json()
      .catch(function () {
        return null;
      });
    const uiEntry = env.__store.changelog[env.__store.changelog.length - 1];
    check(
      'AT15a a direct owner save is attributed to the ui',
      !!(
        saveRes.status === 200 &&
        uiEntry &&
        uiEntry.source_type === 'ui' &&
        typeof uiEntry.source_label === 'string' &&
        uiEntry.source_label.length > 0 &&
        uiEntry.actor_type === 'owner'
      ),
      {
        status: saveRes.status,
        ok: saveData && saveData.ok,
        source: uiEntry && { type: uiEntry.source_type, label: uiEntry.source_label },
        actor: uiEntry && uiEntry.actor_type
      }
    );

    // 15b: an accepted agent proposal is 'agent', with the key label and id.
    const env2 = await makeEnv({ mod });
    const q = await tool(env2, 950, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'notes', after: 'from the agent' }]
    });
    const pid = Number((textOf(q).match(/proposal #(\d+)/) || [])[1] || 0);
    await accept(env2, pid);
    const agentEntry = env2.__store.changelog[env2.__store.changelog.length - 1];
    check(
      'AT15b an accepted agent proposal carries agent, the key label and key_id',
      !!(
        agentEntry &&
        agentEntry.source_type === 'agent' &&
        agentEntry.source_label === 'Agent key' &&
        String(agentEntry.key_id) === '1' &&
        Number(agentEntry.proposal_id) === pid &&
        agentEntry.actor_type === 'owner'
      ),
      agentEntry && {
        source: agentEntry.source_type,
        label: agentEntry.source_label,
        keyId: agentEntry.key_id,
        proposalId: agentEntry.proposal_id,
        actor: agentEntry.actor_type
      }
    );

    // 15c: a legacy editor proposal is 'editor', never 'agent'.
    const env3 = await makeEnv({ mod });
    const base = await stateOf(env3);
    const edited = JSON.parse(JSON.stringify(base));
    edited.tasks[9].notes = 'edited by the site editor';
    const eid = addReview(env3, {
      proposal_type: 'save',
      source_type: 'editor',
      source_label: 'Site Editor',
      diffs_json: JSON.stringify([
        {
          path: 'tasks',
          recordId: 't10',
          field: 'notes',
          before: '',
          after: 'edited by the site editor'
        }
      ]),
      submitted_json: JSON.stringify(edited)
    });
    const ea = await accept(env3, eid);
    const editorEntry = env3.__store.changelog[env3.__store.changelog.length - 1];
    check(
      'AT15c an accepted editor proposal is attributed to the editor',
      !!(
        ea.status === 200 &&
        editorEntry &&
        editorEntry.source_type === 'editor' &&
        editorEntry.source_label === 'Site Editor' &&
        editorEntry.key_id == null
      ),
      {
        status: ea.status,
        text: (ea.text || '').slice(0, 120),
        source: editorEntry && { type: editorEntry.source_type, label: editorEntry.source_label }
      }
    );
  }

  // =====================================================================
  // AT15 (4.2) — get_changes_since. Attribution, field-level changes, scope
  // filtering and two-dimensional paging (500 changes / 200 entries per call,
  // a single huge entry split by changeId:offset).
  // =====================================================================
  section('AT15 — get_changes_since (audit read)');
  {
    // 15d: a real accepted proposal reads back with its attribution.
    const env = await makeEnv({ mod });
    const q = await tool(env, 970, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'notes', after: 'audited note' }],
      changeSetId: 'cs-AT15'
    });
    const pid = Number((textOf(q).match(/proposal #(\d+)/) || [])[1] || 0);
    await accept(env, pid);
    const read = await tool(env, 971, 'get_changes_since', {});
    const body = jsonOf(read);
    const entry = body && body.entries && body.entries[0];
    const all = (body && body.entries ? body.entries : []).reduce(function (acc, e) {
      return acc.concat(e.changes || []);
    }, []);
    const ch = all.filter(function (c) {
      return String(c.recordId) === 't6' && String(c.field).indexOf('notes') !== -1;
    })[0];
    check(
      'AT15d an accepted agent change reads back with its attribution',
      !!(
        entry &&
        entry.approvedBy &&
        entry.approvedBy.type === 'owner' &&
        entry.source &&
        entry.source.type === 'agent' &&
        entry.source.label === 'Agent key' &&
        String(entry.source.keyId) === '1' &&
        Number(entry.proposalId) === pid &&
        entry.changeSetId === 'cs-AT15'
      ),
      entry && {
        approvedBy: entry.approvedBy,
        source: entry.source,
        proposalId: entry.proposalId,
        changeSetId: entry.changeSetId
      }
    );
    check(
      'AT15e each change names the table, record, field and both values',
      !!(
        ch &&
        ch.path === 'tasks' &&
        String(ch.recordId) === 't6' &&
        typeof ch.field === 'string' &&
        ch.field.indexOf('notes') !== -1 &&
        ch.after === 'audited note'
      ),
      ch
    );

    // 15f: a scoped key sees only its own sections, and budget needs the switch.
    const scoped = await makeEnv({ mod, scope: ['wbs'], budgetRead: false });
    const st = await stateOf(scoped);
    const next = JSON.parse(JSON.stringify(st));
    next.tasks[0].notes = 'wbs change';
    next.budgetLines[0].planned = 123456;
    await scoped.__mod.cloudLogSave(
      scoped,
      PROJECT,
      st,
      next,
      { type: 'owner', label: 'Owner' },
      'accepted'
    );
    const scopedRead = await tool(scoped, 972, 'get_changes_since', {});
    const scopedBody = jsonOf(scopedRead);
    const allChanges = (scopedBody && scopedBody.entries ? scopedBody.entries : []).reduce(
      function (acc, e) {
        return acc.concat(e.changes || []);
      },
      []
    );
    const paths = allChanges.map(function (c) {
      return c.path;
    });
    check(
      'AT15f a wbs-only key sees the task change and never the budget change',
      !!(paths.indexOf('tasks') !== -1 && paths.indexOf('budgetLines') === -1),
      { paths: paths }
    );

    // 15g: paging. A 600-record entry is far over the 500-change cap.
    const big = await makeEnv({ mod });
    const bprev = await stateOf(big);
    const bnext = JSON.parse(JSON.stringify(bprev));
    for (let i = 0; i < 600; i++) {
      bnext.tasks.push({
        id: 'bulk' + i,
        name: 'Bulk ' + i,
        status: 'todo',
        notes: '',
        startDate: '2026-11-01',
        endDate: '2026-11-02'
      });
    }
    const saved = await big.__mod.cloudLogSave(
      big,
      PROJECT,
      bprev,
      bnext,
      { type: 'owner', label: 'Owner' },
      'accepted',
      { proposalId: 4242, sourceType: 'agent', sourceLabel: 'Agent key', keyId: '1' }
    );
    const bigRow = big.__store.changelog[big.__store.changelog.length - 1];
    const totalLeaves = (function () {
      try {
        return JSON.parse(bigRow.diffs_json || 'null') ? 0 : 0;
      } catch (e) {
        return 0;
      }
    })();
    // Page 1.
    const p1 = jsonOf(await tool(big, 973, 'get_changes_since', {}));
    // Page 2 and 3 follow the cursor.
    const p2 =
      p1 && p1.nextCursor
        ? jsonOf(await tool(big, 974, 'get_changes_since', { cursor: p1.nextCursor }))
        : null;
    const p3 =
      p2 && p2.nextCursor
        ? jsonOf(await tool(big, 975, 'get_changes_since', { cursor: p2.nextCursor }))
        : null;
    const pages = [p1, p2, p3].filter(Boolean);
    const totalChanges = pages.reduce(function (n, pg) {
      return n + (pg.changeCount || 0);
    }, 0);
    const ids = pages.reduce(function (acc, pg) {
      (pg.entries || []).forEach(function (e) {
        (e.changes || []).forEach(function (c) {
          acc.push(String(c.recordId) + '|' + String(c.field) + '|' + String(c.before));
        });
      });
      return acc;
    }, []);
    check(
      'AT15g a 600-record entry pages 500 + 500 + rest with no repeats',
      !!(
        saved &&
        p1 &&
        p1.changeCount === 500 &&
        p1.moreInEntry === true &&
        typeof p1.nextCursor === 'string' &&
        p2 &&
        p2.changeCount === 500 &&
        p3 &&
        p3.changeCount > 0 &&
        totalChanges > 600 &&
        new Set(ids).size === ids.length
      ),
      {
        saved: saved,
        pageCounts: pages.map(function (pg) {
          return pg.changeCount;
        }),
        moreInEntry: pages.map(function (pg) {
          return pg.moreInEntry;
        }),
        cursors: pages.map(function (pg) {
          return pg.nextCursor;
        }),
        unique: new Set(ids).size,
        total: ids.length,
        totalLeaves: totalLeaves
      }
    );
  }

  // =====================================================================
  // AT02 — the owner edits a record in the UI after the proposal was queued.
  // Accepting the older proposal must conflict THAT op (the UI value wins),
  // apply the rest, and name the conflicted op in the stored report.
  // =====================================================================
  section('AT02 — a UI edit after the queue conflicts one op, applies the rest');
  {
    const env = await makeEnv({ mod });
    const id = addReview(env, {
      change_set_id: 'cs-AT02',
      key_id: 'k-AT02',
      ops_json: JSON.stringify({
        v: 2,
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't6',
            field: 'status',
            before: 'todo',
            beforeAbsent: false,
            after: 'inprogress',
            afterAbsent: false
          },
          {
            op: 'set',
            path: 'tasks',
            recordId: 't7',
            field: 'notes',
            before: '',
            beforeAbsent: false,
            after: 'the agent note',
            afterAbsent: false
          }
        ]
      }),
      ops_count: 2,
      proposal_json: JSON.stringify({ changes: [], currency: 'USD' })
    });
    // The owner edits t7's notes in the UI between queue and accept.
    const live = await stateOf(env);
    live.tasks[6].notes = 'the owner note';
    await env.R2.put(R2_KEY, JSON.stringify(live));
    const acc = await accept(env, id);
    const after = await stateOf(env);
    const row = env.__store.reviews.find(function (r) {
      return r.id === id;
    });
    let rep = null;
    try {
      rep = row && row.apply_report_json ? JSON.parse(row.apply_report_json) : null;
    } catch (e) {
      rep = null;
    }
    const conflictEntry =
      rep && Array.isArray(rep.report)
        ? rep.report.filter(function (e) {
            return e && e.result === 'conflict';
          })[0]
        : null;
    check(
      'AT02a the accept succeeds and applies the unconflicted op',
      !!(acc.status === 200 && after.tasks[5].status === 'inprogress'),
      { status: acc.status, t6: after.tasks[5].status }
    );
    check(
      'AT02b the UI value survives the older proposal',
      after.tasks[6].notes === 'the owner note',
      { t7: after.tasks[6].notes }
    );
    check(
      'AT02c the report names the conflicted op and its record',
      !!(
        conflictEntry &&
        String(conflictEntry.recordId) === 't7' &&
        conflictEntry.field === 'notes' &&
        (conflictEntry.code === 'CONFLICT' || conflictEntry.code === 'STALE_BEFORE')
      ),
      conflictEntry && {
        recordId: conflictEntry.recordId,
        field: conflictEntry.field,
        code: conflictEntry.code,
        reason: conflictEntry.reason
      }
    );
    check(
      'AT02d the summary counts one applied and one conflict',
      !!(rep && rep.summary && rep.summary.applied === 1 && rep.summary.conflict === 1),
      rep && rep.summary
    );
  }

  // =====================================================================
  // AT03 — an invalid enum is answered by BOTH tools with the allowed list:
  // validate_changes refuses it in the dry run, apply_changes refuses it and
  // queues nothing.
  // =====================================================================
  section('AT03 — both tools refuse an invalid enum with the allowed list');
  {
    const env = await makeEnv({ mod });
    const args = {
      diffs: [{ path: 'tasks', recordId: 't6', field: 'status', after: 'done' }]
    };
    const dry = await tool(env, 920, 'validate_changes', args);
    const dryBody = jsonOf(dry);
    const dryRefused = (dryBody && dryBody.refused) || [];
    check(
      'AT03a validate_changes refuses "done" and lists the allowed values',
      !!(
        dryBody &&
        dryBody.ok === false &&
        dryRefused.length === 1 &&
        dryRefused[0].code === 'INVALID_ENUM' &&
        /todo, inprogress, blocked, completed/.test(String(dryRefused[0].reason || ''))
      ),
      dryBody && { ok: dryBody.ok, refused: dryRefused }
    );
    const real = await tool(env, 921, 'apply_changes', args);
    check(
      'AT03b apply_changes refuses the same op and queues no row',
      !!(
        /not one of: todo, inprogress, blocked, completed/.test(textOf(real)) &&
        env.__store.reviews.length === 0
      ),
      { text: textOf(real).slice(0, 120), rows: env.__store.reviews.length }
    );
  }

  // =====================================================================
  // AT04 — every derived field family is refused: the computed task fields
  // (critical, totalFloat) and the two status stamps (statusSince,
  // completedDate), on a diff and on a create.
  // =====================================================================
  section('AT04 — computed and stamp fields are refused as derived');
  {
    const env = await makeEnv({ mod });
    const cases = [
      { field: 'critical', after: true },
      { field: 'totalFloat', after: 4.5 },
      { field: 'statusSince', after: '2026-11-01' },
      { field: 'completedDate', after: '2026-11-01' }
    ];
    let bad = [];
    for (let i = 0; i < cases.length; i++) {
      const r = await tool(env, 930 + i, 'apply_changes', {
        diffs: [{ path: 'tasks', recordId: 't6', field: cases[i].field, after: cases[i].after }]
      });
      if (!/derived field, recomputed by the app/.test(textOf(r))) {
        bad.push({ field: cases[i].field, text: textOf(r).slice(0, 100) });
      }
    }
    check(
      'AT04a critical, totalFloat, statusSince and completedDate are all refused as derived',
      bad.length === 0 && env.__store.reviews.length === 0,
      { bad: bad, rows: env.__store.reviews.length }
    );
    const created = await tool(env, 935, 'apply_changes', {
      creates: [{ path: 'tasks', record: { name: 'Smuggled float', totalFloat: 2 } }]
    });
    check(
      'AT04b a create cannot smuggle a computed field',
      !!(/totalFloat: derived field/.test(textOf(created)) && env.__store.reviews.length === 0),
      { text: textOf(created).slice(0, 140) }
    );
  }

  // =====================================================================
  // AT05 — a hard failure (a predecessor cycle the queue could not see) rolls
  // back the WHOLE accept: 422, the R2 blob is byte-identical, nothing is
  // applied, and the report names the op that caused it instead of claiming
  // the set applied.
  // =====================================================================
  section('AT05 — a predecessor cycle rolls the whole accept back');
  {
    const env = await makeEnv({ mod });
    const blobBefore = await env.R2.get(R2_KEY);
    const etagBefore = blobBefore.etag;
    const stateBefore = await stateOf(env);
    const q = await tool(env, 950, 'apply_changes', {
      diffs: [
        { path: 'tasks', recordId: 't1', field: 'predecessors', after: ['t2'] },
        { path: 'tasks', recordId: 't2', field: 'predecessors', after: ['t1'] }
      ]
    });
    check(
      'AT05a the cycle-forming proposal is queued (the queue cannot see the whole set)',
      env.__store.reviews.length === 1 && env.__store.reviews[0].status === 'pending',
      { text: textOf(q).slice(0, 160) }
    );
    const row = env.__store.reviews[0];
    const a = await accept(env, row.id);
    check(
      'AT05b the accept refuses with 422 accept-failed',
      a.status === 422 && a.data && a.data.error === 'accept-failed',
      { status: a.status, error: a.data && a.data.error }
    );
    const blobAfter = await env.R2.get(R2_KEY);
    check(
      'AT05c the stored blob is byte-identical after the rollback',
      blobAfter.etag === etagBefore,
      { before: etagBefore, after: blobAfter.etag }
    );
    const stateAfter = await stateOf(env);
    const untouched =
      JSON.stringify((stateBefore.tasks[0] || {}).predecessors || []) === '[]' &&
      JSON.stringify((stateAfter.tasks[0] || {}).predecessors || []) === '[]' &&
      JSON.stringify((stateAfter.tasks[1] || {}).predecessors || []) === '[]';
    check('AT05d neither task kept the cyclic predecessors', untouched, {
      t1: (stateAfter.tasks[0] || {}).predecessors,
      t2: (stateAfter.tasks[1] || {}).predecessors
    });
    const rows = (a.data && a.data.report) || [];
    const blamed = rows.filter(function (r) {
      return r.code === 'CYCLE';
    });
    const cycleIds = ((a.data && a.data.hardFailure && a.data.hardFailure.ids) || []).map(String);
    check(
      'AT05e the report names the op(s) that created the cycle',
      blamed.length >= 1 &&
        cycleIds.length >= 2 &&
        blamed.every(r => r.field === 'predecessors' && cycleIds.indexOf(String(r.recordId)) > -1),
      { blamed: blamed.map(r => r.recordId + '.' + r.field), cycleIds: cycleIds }
    );
    const claimed = rows.filter(function (r) {
      return r.result === 'applied';
    });
    check(
      'AT05f no row claims it applied after the rollback',
      rows.length >= 2 && claimed.length === 0 && rows.every(r => r.result === 'rolled_back'),
      { results: rows.map(r => r.result) }
    );
    check(
      'AT05g the proposal is still pending, not accepted',
      env.__store.reviews[0].status === 'pending',
      { status: env.__store.reviews[0].status }
    );
  }

  // =====================================================================
  // AT06 — the derived summary agrees with the records after an accept:
  // completedTasks counts real work items only, and openRisks counts the same
  // set for UI-shaped, promoted and MCP-created risks.
  // =====================================================================
  section('AT06 — summary counts match the records after an accept');
  {
    const env = await makeEnv({ mod });
    // UI-shaped rows go straight into the snapshot, which is what the app
    // writes: one closed risk, one promoted to an issue, one plain open.
    const seeded = await stateOf(env);
    seeded.risks.push({ id: 'r3', description: 'Closed risk', status: 'closed' });
    seeded.risks.push({
      id: 'r4',
      description: 'Promoted risk',
      status: 'open',
      issueId: 'i1'
    });
    await env.R2.put(R2_KEY, JSON.stringify(seeded));
    const q = await tool(env, 960, 'apply_changes', {
      creates: [
        { path: 'risks', record: { description: 'Created with no status' } },
        { path: 'risks', record: { description: 'Created closed', status: 'closed' } },
        { path: 'tasks', record: { name: 'Done A', status: 'completed' } },
        { path: 'tasks', record: { name: 'Done B', status: 'completed' } },
        { path: 'tasks', record: { name: 'Todo C', status: 'todo' } }
      ]
    });
    check('AT06a the five creates queue as one proposal', env.__store.reviews.length === 1, {
      text: textOf(q).slice(0, 160)
    });
    const a = await accept(env, env.__store.reviews[0].id);
    check('AT06b the accept succeeds', a.status === 200, { status: a.status });

    const st = await stateOf(env);
    const summary = jsonOf(await tool(env, 961, 'get_project_summary', {}));
    const risks = jsonOf(await tool(env, 962, 'get_risks', {}));

    // Independent count: work items are cards, so phases and rollup parents
    // are excluded - the same definition the board uses.
    const rollups = {};
    st.tasks.forEach(function (t) {
      if (t.parentName) {
        rollups[t.parentName] = 1;
      }
    });
    const work = st.tasks.filter(function (t) {
      return !t.isPhase && !((t.level || 0) === 0 && rollups[t.name]);
    });
    const expectedDone = work.filter(t => t.status === 'completed').length;
    check(
      'AT06c completedTasks equals the work items with status completed',
      summary && summary.completedTasks === expectedDone && expectedDone === 7,
      { got: summary && summary.completedTasks, want: expectedDone }
    );
    check(
      'AT06d statusCounts.completed agrees and the counts sum to every task',
      summary &&
        summary.statusCounts.completed === expectedDone &&
        summary.totalTasks === st.tasks.length &&
        Object.keys(summary.statusCounts).reduce(function (n, k) {
          return n + summary.statusCounts[k];
        }, 0) === st.tasks.length,
      { counts: summary && summary.statusCounts, total: summary && summary.totalTasks }
    );

    const expectedOpen = st.risks.filter(function (r) {
      if (r.issueId) {
        return false;
      }
      const s = String(r.status == null ? '' : r.status)
        .trim()
        .toLowerCase();
      return s === '' || s === 'open';
    }).length;
    check(
      'AT06e openRisks counts open, promoted and MCP-created risks the same way',
      summary && summary.openRisks === expectedOpen && expectedOpen === 3,
      {
        got: summary && summary.openRisks,
        want: expectedOpen,
        statuses: st.risks.map(
          r => r.id + ':' + (r.status || '(none)') + (r.issueId ? '+promoted' : '')
        )
      }
    );
    check(
      'AT06f get_risks reports the same open count as the summary',
      risks && risks.openRiskCount === summary.openRisks && risks.riskCount === st.risks.length,
      { open: risks && risks.openRiskCount, summary: summary && summary.openRisks }
    );
    check(
      'AT06g completion percent matches the counted work items',
      summary && summary.completion === Math.round((expectedDone / work.length) * 100),
      { got: summary && summary.completion, want: Math.round((expectedDone / work.length) * 100) }
    );
  }

  // =====================================================================
  // AT09 — the large-change message counts N (this call) and U (today, this
  // key) against L, and U only counts pending/accepting/accepted rows: a
  // rejected row frees its quota.
  // =====================================================================
  section('AT09 — the large-change counter counts only live decisions');
  {
    const env = await makeEnv({ mod });
    const large = function (n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push({ kind: 'addLine', line: { name: 'Large ' + i, planned: 60000 } });
      }
      return out;
    };
    // Three large changes already pending (they count), five in a REJECTED row
    // (they must not).
    addReview(env, {
      source_type: 'api',
      source_label: 'Agent key',
      status: 'pending',
      proposal_json: JSON.stringify({
        changes: [
          { kind: 'addLine', large: true },
          { kind: 'addLine', large: true },
          { kind: 'addLine', large: true }
        ]
      })
    });
    addReview(env, {
      source_type: 'api',
      source_label: 'Agent key',
      status: 'rejected',
      proposal_json: JSON.stringify({
        changes: [
          { kind: 'addLine', large: true },
          { kind: 'addLine', large: true },
          { kind: 'addLine', large: true },
          { kind: 'addLine', large: true },
          { kind: 'addLine', large: true }
        ]
      })
    });
    const q = await tool(env, 940, 'apply_changes', { budget: large(8) });
    const t = textOf(q);
    check(
      'AT09a the message names 8 incoming, 3 used (rejected 5 excluded) and the 10 limit',
      /This call has 8 large budget change\(s\)/.test(t) &&
        /This key has 3 large change\(s\) pending or accepted today \(UTC\)/.test(t) &&
        /The limit is 10 per day and 10 per call/.test(t),
      { text: t.slice(0, 320) }
    );
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
