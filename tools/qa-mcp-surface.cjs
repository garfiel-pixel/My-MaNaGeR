/* ============================================================
   MCP SURFACE GATE (qa-mcp-surface)
   ------------------------------------------------------------
   Proves the readiness surface and the schema contract that the
   Resume Maker AI build exposed as gaps:

     S1  the JSON Schema advertises every accepted argument
         (creates[].tempId, idempotencyKey) and the summary
         description matches what the tool returns
     S2  tempId chains work END TO END through handleMcpServer:
         a second create references the first by tempId and the
         queued op carries the resolved id; an unknown predecessor
         gets the actionable hint instead of a dead end
     S3  the server CPM port is byte-identical to the REAL browser
         engine (js/mmgr-schedule.js loaded in a vm sandbox) across
         five fixtures: plain network, deadline float, 6-day week,
         phase roll-up and a predecessor cycle
     S4  get_schedule reports the window, critical path, cycles,
         dangling links and tasks the engine cannot schedule
     S5  get_project_health gates: unlinked WBS is not executable,
         a linked one is, envelope overrun fails, zero utilisation
         warns, pending proposals warn with the real count
     S6  get_resources matches the app's utilisation formula and
         only exposes the budget comparison with the read switch
     S7  run_monte_carlo flags an unlinked network as unreliable
         instead of reporting a fake 0% deadline probability
     S8  validate_changes returns structural lint without blocking
     S9  both surfaces expose the new tools (projectId required
         app-wide)

   Pure Node: no Chrome, no wrangler, no network.
   Registry: docs/CI-TEST-COVERAGE.md -> CI (static job).
   ============================================================ */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

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

/* ---- mock Worker env ---------------------------------------------------- */

function makeEnv(opts) {
  const o = opts || {};
  const key = o.key || 'sk-mmgr-SURF01-AAAAAA-BBBBBB';
  const fp = fingerprint(key);
  const scope = o.scope || ALL_SECTIONS;
  const state = o.state || {};
  const store = { cloud_reviews: [] };
  let reviewSeq = 700;
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const s = sql.toLowerCase();
              if (s.includes('count(*) as c') && s.includes('cloud_reviews')) {
                return {
                  c: store.cloud_reviews.filter(function (r) {
                    return r.status === 'pending';
                  }).length
                };
              }
              if (s.includes('from cloud_api_keys')) {
                if (args[0] !== fp) {
                  return null;
                }
                return {
                  id: 1,
                  key_fingerprint: fp,
                  key_salt: 's',
                  key_hash: 'h',
                  label: 'Surface key',
                  scope: JSON.stringify(scope),
                  expires_at: null,
                  budget_read: o.budgetRead === false ? 0 : 1,
                  budget_write: o.budgetWrite === false ? 0 : 1,
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
                return { status: 'active', tier: 'contractor', plan: 'contractor' };
              }
              return null;
            },
            async all() {
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
                row.status = 'pending';
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
        const blob = JSON.stringify(state);
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
function jsonOf(res) {
  try {
    return JSON.parse(textOf(res));
  } catch (e) {
    return null;
  }
}

/* ---- the REAL browser schedule engine, sandboxed ------------------------ */

function loadBrowserEngine(state) {
  const sandbox = {
    window: { MMGR: {}, addEventListener() {} },
    document: {
      addEventListener() {},
      querySelector() {
        return null;
      }
    },
    console
  };
  sandbox.window.MMGR.State = {
    getState() {
      return state;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/mmgr-utils.js'), 'utf8'), sandbox, {
    filename: 'mmgr-utils.js'
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/mmgr-schedule.js'), 'utf8'), sandbox, {
    filename: 'mmgr-schedule.js'
  });
  return sandbox.window.MMGR;
}

// Run the engine's own three passes exactly as computePlan composes them and
// return comparable rows.
function engineRows(state, workWeek) {
  const MMGR = loadBrowserEngine(state);
  const work = state.tasks.map(function (t) {
    return Object.assign({}, t, { predecessors: (t.predecessors || []).slice() });
  });
  let sched = MMGR.Schedule.forwardPass(work);
  sched = MMGR.Schedule.backwardPass(work, sched, state.projectDeadline || null);
  sched = MMGR.Schedule.calcFloat(work, sched);
  return sched
    .map(function (r) {
      return {
        id: r.id,
        es: r.es ? MMGR.Utils.fmtDate(r.es) : null,
        ef: r.ef ? MMGR.Utils.fmtDate(r.ef) : null,
        ls: r.ls ? MMGR.Utils.fmtDate(r.ls) : null,
        lf: r.lf ? MMGR.Utils.fmtDate(r.lf) : null,
        totalFloat: r.totalFloat === undefined ? null : r.totalFloat,
        freeFloat: r.freeFloat === undefined ? null : r.freeFloat
      };
    })
    .sort(function (a, b) {
      return a.id < b.id ? -1 : 1;
    });
}

function portRows(report, onlyIds) {
  return report.rows
    .filter(function (r) {
      return !onlyIds || onlyIds.indexOf(r.id) !== -1;
    })
    .map(function (r) {
      return {
        id: r.id,
        es: r.es,
        ef: r.ef,
        ls: r.ls,
        lf: r.lf,
        totalFloat: r.totalFloat,
        freeFloat: r.freeFloat
      };
    })
    .sort(function (a, b) {
      return a.id < b.id ? -1 : 1;
    });
}

/* ---- fixtures ----------------------------------------------------------- */

function linkedState(extra) {
  return Object.assign(
    {
      schemaVersion: 19,
      projectId: PROJECT,
      charter: { name: 'Surface fixture' },
      workWeek: 5,
      projectDeadline: '',
      tasks: [
        {
          id: 'a',
          name: 'A',
          status: 'todo',
          duration: '5',
          startDate: '2026-11-02',
          endDate: '2026-11-06',
          predecessors: []
        },
        {
          id: 'b',
          name: 'B',
          status: 'todo',
          duration: '3',
          startDate: '2026-11-09',
          endDate: '2026-11-11',
          predecessors: ['a']
        },
        {
          id: 'c',
          name: 'C',
          status: 'todo',
          duration: '2',
          startDate: '2026-11-09',
          endDate: '2026-11-10',
          predecessors: []
        },
        {
          id: 'd',
          name: 'D',
          status: 'todo',
          duration: '4',
          startDate: '2026-11-16',
          endDate: '2026-11-19',
          predecessors: ['b', 'c']
        },
        {
          id: 'p1',
          name: 'Phase One',
          isPhase: true,
          status: 'todo',
          duration: '',
          startDate: '',
          endDate: '',
          predecessors: []
        }
      ],
      resources: [
        { id: 'r1', name: 'PM', type: 'Labor', rate: 100, availability: 100, hoursAllocated: 80 }
      ],
      budgetLines: [{ id: 'L1', name: 'Labour', planned: 8000, actual: 0 }],
      spendLog: [],
      risks: [],
      issues: [],
      meetings: [],
      logEntries: []
    },
    extra || {}
  );
}

function unlinkedState() {
  const s = linkedState();
  s.tasks = s.tasks.map(function (t) {
    return Object.assign({}, t, { predecessors: [] });
  });
  return s;
}

(async () => {
  const server = await import('../src/mcp/server.js');
  const appwide = await import('../src/mcp/appwide.js');
  const meta = await import('../src/mcp/tool-meta.js');
  const port = await import('../src/mcp/schedule.js');
  const health = await import('../src/mcp/health.js');

  // =====================================================================
  section('S1 — the schema advertises every accepted argument');
  // =====================================================================
  {
    const ac = server.TOOLS.filter(function (t) {
      return t.name === 'apply_changes';
    })[0];
    const createProps = ac.inputSchema.properties.creates.items.properties;
    check(
      'S1a creates[].tempId is a declared schema property',
      !!createProps.tempId && createProps.tempId.type === 'string',
      Object.keys(createProps)
    );
    check(
      'S1b idempotencyKey is a declared schema property',
      !!ac.inputSchema.properties.idempotencyKey &&
        ac.inputSchema.properties.idempotencyKey.type === 'string',
      Object.keys(ac.inputSchema.properties)
    );
    check(
      'S1c the tempId description says how a predecessor may reference it',
      /predecessor/i.test(createProps.tempId.description || ''),
      createProps.tempId
    );

    const sum = server.TOOLS.filter(function (t) {
      return t.name === 'get_project_summary';
    })[0];
    check(
      'S1d the summary description names the counts, risks and deadline it returns',
      /status/i.test(sum.description) &&
        /risk/i.test(sum.description) &&
        /deadline/i.test(sum.description),
      sum.description
    );
    check(
      'S1e the summary description no longer claims only name/description/completion',
      !/^Get the project name, description, and completion percentage\.$/.test(sum.description),
      sum.description
    );

    const vc = server.TOOLS.filter(function (t) {
      return t.name === 'validate_changes';
    })[0];
    check(
      'S1f validate_changes documents the lint block',
      /lint/i.test(vc.description),
      vc.description
    );

    check(
      'S1g the server version is a semver and both surfaces announce it',
      /^\d+\.\d+\.\d+$/.test(meta.MCP_SERVER_VERSION) &&
        appwide.APPWIDE_SERVER_INFO.version === meta.MCP_SERVER_VERSION,
      { version: meta.MCP_SERVER_VERSION, app: appwide.APPWIDE_SERVER_INFO.version }
    );

    const everyToolHasMeta = server.TOOLS.every(function (t) {
      return t.annotations && t.outputSchema && t.outputSchema.type === 'object';
    });
    check('S1h every project tool carries annotations + an outputSchema', everyToolHasMeta, null);
  }

  // =====================================================================
  section('S2 — tempId chains work end to end through handleMcpServer');
  // =====================================================================
  {
    const state = linkedState({ tasks: [], resources: [], budgetLines: [] });
    const env = makeEnv({ state: state, key: 'sk-mmgr-SURF02-AAAAAA-BBBBBB' });
    env.__mod = server;
    const res = await tool(env, 1, 'apply_changes', {
      changeSetId: 'cs_surface_temp',
      creates: [
        {
          path: 'tasks',
          tempId: 'w1',
          record: { name: 'Discovery', duration: '5', startDate: '2026-11-02' }
        },
        {
          path: 'tasks',
          tempId: 'w2',
          record: { name: 'Design', duration: '4', startDate: '2026-11-09', predecessors: ['w1'] }
        }
      ]
    });
    check('S2a the chained create is queued', /Queued/i.test(textOf(res)), textOf(res));
    const row = env.__store.cloud_reviews[0];
    let ops = [];
    try {
      ops = JSON.parse(row.ops_json).ops || [];
    } catch (e) {
      ops = [];
    }
    const creates = ops.filter(function (op) {
      return op.op === 'create';
    });
    check('S2b two create ops were queued', creates.length === 2, ops);
    const firstId = creates[0] && creates[0].record && creates[0].record.id;
    const secondPreds = creates[1] && creates[1].record && creates[1].record.predecessors;
    check(
      'S2c the predecessor carries the resolved server id, not the tempId',
      !!firstId &&
        Array.isArray(secondPreds) &&
        secondPreds[0] === firstId &&
        secondPreds[0] !== 'w1',
      { firstId: firstId, secondPreds: secondPreds }
    );
    check(
      'S2d the op records the tempId it was given',
      creates[1] && creates[1].tempId === 'w2',
      creates[1] && creates[1].tempId
    );

    const env2 = makeEnv({ state: linkedState(), key: 'sk-mmgr-SURF03-AAAAAA-BBBBBB' });
    env2.__mod = server;
    const bad = await tool(env2, 2, 'apply_changes', {
      diffs: [{ path: 'tasks', recordId: 'a', field: 'predecessors', after: ['ghost'] }]
    });
    check(
      'S2e an unknown predecessor explains tempId instead of dead-ending',
      /declare it with creates\[\]\.tempId/i.test(textOf(bad)),
      textOf(bad)
    );
  }

  // =====================================================================
  section('S3 — the CPM port is byte-identical to the browser engine');
  // =====================================================================
  {
    const fixtures = [
      { name: 'plain network, no deadline', state: linkedState() },
      {
        name: 'deadline after the finish (float)',
        state: linkedState({ projectDeadline: '2026-12-31' })
      },
      {
        name: 'six-day week starting on a Saturday',
        state: linkedState({
          workWeek: 6,
          tasks: [
            {
              id: 'a',
              name: 'A',
              duration: '3',
              startDate: '2026-11-07',
              endDate: '2026-11-10',
              predecessors: []
            },
            {
              id: 'b',
              name: 'B',
              duration: '2',
              startDate: '2026-11-11',
              endDate: '2026-11-12',
              predecessors: ['a']
            }
          ]
        })
      },
      {
        name: 'phase roll-up from children',
        state: linkedState({
          tasks: [
            {
              id: 'k1',
              name: 'Child 1',
              duration: '3',
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              parentName: 'Phase One',
              predecessors: []
            },
            {
              id: 'k2',
              name: 'Child 2',
              duration: '2',
              startDate: '2026-11-05',
              endDate: '2026-11-06',
              parentName: 'Phase One',
              predecessors: []
            },
            {
              id: 'p1',
              name: 'Phase One',
              isPhase: true,
              duration: '',
              startDate: '',
              endDate: '',
              predecessors: []
            }
          ]
        })
      }
    ];
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      const engine = engineRows(f.state, f.state.workWeek);
      const report = port.computeSchedule(f.state);
      // The three pure passes do not roll a phase span up; computePlan does.
      // So the phase fixture is compared on its work items here and the
      // roll-up itself is asserted directly below.
      const phaseIds = (f.state.tasks || [])
        .filter(function (t) {
          return t.isPhase;
        })
        .map(function (t) {
          return t.id;
        });
      const ids = engine
        .map(function (r) {
          return r.id;
        })
        .filter(function (id) {
          return phaseIds.indexOf(id) === -1;
        });
      const mine = portRows(report, ids);
      check(
        'S3' + (i + 1) + ' parity: ' + f.name,
        JSON.stringify(
          engine.filter(function (r) {
            return phaseIds.indexOf(r.id) === -1;
          })
        ) === JSON.stringify(mine),
        { engine: engine, port: mine }
      );
    }

    // computePlan's phase span: earliest child start to latest child finish.
    const phaseState = fixtures[3].state;
    const phaseReport = port.computeSchedule(phaseState);
    const phaseRow = phaseReport.rows.filter(function (r) {
      return r.id === 'p1';
    })[0];
    const childStarts = phaseReport.rows
      .filter(function (r) {
        return r.id === 'k1' || r.id === 'k2';
      })
      .map(function (r) {
        return r.es;
      })
      .sort();
    const childEnds = phaseReport.rows
      .filter(function (r) {
        return r.id === 'k1' || r.id === 'k2';
      })
      .map(function (r) {
        return r.ef;
      })
      .sort();
    check(
      'S3d a phase spans its children (computePlan roll-up)',
      phaseRow && phaseRow.es === childStarts[0] && phaseRow.ef === childEnds[childEnds.length - 1],
      { phase: phaseRow, starts: childStarts, ends: childEnds }
    );

    // The cycle fixture: both sides must agree on the members and neither may
    // invent dates for them.
    const cyc = linkedState({
      tasks: [
        {
          id: 'x',
          name: 'X',
          duration: '2',
          startDate: '2026-11-02',
          endDate: '2026-11-03',
          predecessors: ['y']
        },
        {
          id: 'y',
          name: 'Y',
          duration: '2',
          startDate: '2026-11-04',
          endDate: '2026-11-05',
          predecessors: ['x']
        }
      ]
    });
    const cycEngine = loadBrowserEngine(cyc).Schedule.findCycles(cyc.tasks).sort();
    const cycReport = port.computeSchedule(cyc);
    check(
      'S3e both engines report the same cycle members',
      JSON.stringify(cycEngine) === JSON.stringify(cycReport.cycles.slice().sort()),
      { engine: cycEngine, port: cycReport.cycles }
    );
    check(
      'S3f a cycle never produces invented dates',
      cycReport.rows.every(function (r) {
        return r.es === null && r.ef === null;
      }),
      cycReport.rows
    );
  }

  // =====================================================================
  section('S4 — get_schedule reports the plan and its defects');
  // =====================================================================
  {
    const env = makeEnv({ state: linkedState(), key: 'sk-mmgr-SURF04-AAAAAA-BBBBBB' });
    env.__mod = server;
    const s = jsonOf(await tool(env, 10, 'get_schedule', {}));
    check('S4a the schedule answers', !!s, s);
    check(
      'S4b project window is computed',
      s.projectStart === '2026-11-02' && s.projectEnd === '2026-11-17',
      {
        start: s.projectStart,
        end: s.projectEnd
      }
    );
    check(
      'S4c the critical path is a non-empty chain ending at the last task',
      Array.isArray(s.criticalPath) &&
        s.criticalPath.length >= 2 &&
        s.criticalPath[s.criticalPath.length - 1] === 'd',
      s.criticalPath
    );
    check(
      'S4d links and edges are counted',
      s.links.edges === 3 && s.links.unlinkedTasks === 0,
      s.links
    );
    check(
      'S4e weather padding is declared as not applied',
      s.weather && s.weather.applied === false && /weather/i.test(s.weather.reason),
      s.weather
    );

    const dangling = linkedState();
    dangling.tasks[1].predecessors = ['ghost'];
    const envD = makeEnv({ state: dangling, key: 'sk-mmgr-SURF05-AAAAAA-BBBBBB' });
    envD.__mod = server;
    const sd = jsonOf(await tool(envD, 11, 'get_schedule', {}));
    check(
      'S4f a dangling predecessor is counted, not crashed',
      sd.links.danglingPredecessors === 1,
      sd.links
    );

    const noDur = linkedState();
    noDur.tasks[0].duration = '';
    const envN = makeEnv({ state: noDur, key: 'sk-mmgr-SURF06-AAAAAA-BBBBBB' });
    envN.__mod = server;
    const sn = jsonOf(await tool(envN, 12, 'get_schedule', {}));
    check(
      'S4g a dated task with no duration is reported',
      sn.missingDuration === 1,
      sn.missingDuration
    );
  }

  // =====================================================================
  section('S5 — get_project_health gates');
  // =====================================================================
  {
    const envLinked = makeEnv({ state: linkedState(), key: 'sk-mmgr-SURF07-AAAAAA-BBBBBB' });
    envLinked.__mod = server;
    const h1 = jsonOf(await tool(envLinked, 20, 'get_project_health', {}));
    check(
      'S5a a linked, costed plan is executable',
      h1 && h1.executable === true,
      h1 && h1.overall
    );
    check(
      'S5b the schedule gate is ok on a linked plan',
      h1 && h1.gates.schedule.status === 'ok',
      h1 && h1.gates.schedule
    );

    const envUnlinked = makeEnv({ state: unlinkedState(), key: 'sk-mmgr-SURF08-AAAAAA-BBBBBB' });
    envUnlinked.__mod = server;
    const h2 = jsonOf(await tool(envUnlinked, 21, 'get_project_health', {}));
    check(
      'S5c an unlinked WBS is not executable',
      h2 && h2.executable === false && h2.gates.schedule.status === 'warn',
      h2 && h2.schedule
    );
    check(
      'S5d the warning says it is a dated list, not a network',
      h2 &&
        h2.gates.schedule.checks.some(function (c) {
          return /dated task list/i.test(c.detail);
        }),
      h2 && h2.gates.schedule.checks
    );

    const over = linkedState({ budgetEnvelope: 5000 });
    const envOver = makeEnv({ state: over, key: 'sk-mmgr-SURF09-AAAAAA-BBBBBB' });
    envOver.__mod = server;
    const h3 = jsonOf(await tool(envOver, 22, 'get_project_health', {}));
    check(
      'S5e planned over envelope fails the budget gate',
      h3 && h3.gates.budget.status === 'fail' && h3.overall === 'fail',
      h3 && h3.gates.budget
    );

    const idle = linkedState({
      resources: [{ id: 'r1', name: 'PM', rate: 100, availability: 100, hoursAllocated: 0 }]
    });
    const envIdle = makeEnv({ state: idle, key: 'sk-mmgr-SURF10-AAAAAA-BBBBBB' });
    envIdle.__mod = server;
    const h4 = jsonOf(await tool(envIdle, 23, 'get_project_health', {}));
    check(
      'S5f zero utilisation warns the resources gate',
      h4 &&
        h4.gates.resources.status === 'warn' &&
        /utilisation/i.test(JSON.stringify(h4.gates.resources)),
      h4 && h4.gates.resources
    );

    const envPending = makeEnv({ state: linkedState(), key: 'sk-mmgr-SURF11-AAAAAA-BBBBBB' });
    envPending.__mod = server;
    envPending.__store.cloud_reviews.push({ id: 900, status: 'pending', ops_json: '[]' });
    const h5 = jsonOf(await tool(envPending, 24, 'get_project_health', {}));
    check(
      'S5g pending proposals are reported with the real count',
      h5 &&
        h5.gates.data.checks.some(function (c) {
          return c.count === 1 && /proposal/i.test(c.detail);
        }),
      h5 && h5.gates.data
    );

    const noBase = jsonOf(await tool(envLinked, 25, 'get_project_health', {}));
    check(
      'S5h a missing frozen baseline is a budget warning',
      noBase &&
        noBase.gates.budget.checks.some(function (c) {
          return /baseline/i.test(c.detail);
        }),
      noBase && noBase.gates.budget
    );
  }

  // =====================================================================
  section('S6 — get_resources matches the app formula and gates money');
  // =====================================================================
  {
    const env = makeEnv({ state: linkedState(), key: 'sk-mmgr-SURF12-AAAAAA-BBBBBB' });
    env.__mod = server;
    const r = jsonOf(await tool(env, 30, 'get_resources', {}));
    const expected = Math.round((80 / (5 * 4 * 8)) * 100);
    check(
      'S6a utilisation uses availability x work-week x 4 x 8h',
      r.resources[0].utilization === expected,
      {
        got: r.resources[0].utilization,
        expected: expected
      }
    );
    check('S6b labour cost is rate x hours', r.totals.labourCost === 8000, r.totals);
    check(
      'S6c the budget comparison is present with the read switch',
      !!r.budget && r.budget.planned === 8000,
      r.budget
    );

    const envNo = makeEnv({
      state: linkedState(),
      key: 'sk-mmgr-SURF13-AAAAAA-BBBBBB',
      budgetRead: false
    });
    envNo.__mod = server;
    const rn = jsonOf(await tool(envNo, 31, 'get_resources', {}));
    check(
      'S6d no budget block without the read switch',
      rn && rn.budget === undefined,
      rn && rn.budget
    );
  }

  // =====================================================================
  section('S7 — Monte Carlo refuses to fake a forecast');
  // =====================================================================
  {
    const envU = makeEnv({ state: unlinkedState(), key: 'sk-mmgr-SURF14-AAAAAA-BBBBBB' });
    envU.__mod = server;
    const mu = jsonOf(
      await tool(envU, 40, 'run_monte_carlo', { simulations: 100, targetDate: '2026-11-10' })
    );
    check(
      'S7a an unlinked network is marked unreliable',
      mu && mu.networkHealth && mu.networkHealth.reliable === false,
      mu && mu.networkHealth
    );
    check(
      'S7b the note says it is not a forecast and what to do',
      mu && /NOT A FORECAST/.test(mu.note || '') && /predecessor/i.test(mu.note || ''),
      mu && mu.note
    );

    const envL = makeEnv({ state: linkedState(), key: 'sk-mmgr-SURF15-AAAAAA-BBBBBB' });
    envL.__mod = server;
    const ml = jsonOf(await tool(envL, 41, 'run_monte_carlo', { simulations: 100 }));
    check(
      'S7c a linked network is reliable and carries no warning note',
      ml && ml.networkHealth.reliable === true && ml.note === undefined,
      ml && ml.networkHealth
    );
  }

  // =====================================================================
  section('S8 — validate_changes returns structural lint without blocking');
  // =====================================================================
  {
    const state = linkedState({ tasks: [], resources: [], budgetLines: [] });
    const env = makeEnv({ state: state, key: 'sk-mmgr-SURF16-AAAAAA-BBBBBB' });
    env.__mod = server;
    const res = await tool(env, 50, 'validate_changes', {
      creates: [
        { path: 'tasks', record: { name: 'Phase A', isPhase: true } },
        {
          path: 'tasks',
          record: { name: 'Dated, no duration', startDate: '2026-11-02', endDate: '2026-11-06' }
        }
      ]
    });
    const body = jsonOf(res);
    check('S8a the dry run answers with ok', body && body.ok === true, body);
    check(
      'S8b lint lists the empty phase',
      body &&
        body.lint.some(function (l) {
          return /phase has no child/i.test(l.detail);
        }),
      body && body.lint
    );
    check(
      'S8c lint lists the dated task with no duration',
      body &&
        body.lint.some(function (l) {
          return /no duration/i.test(l.detail);
        }),
      body && body.lint
    );
    check(
      'S8d lint counts are reported',
      body && body.lintCount && body.lintCount.warn >= 2 && body.lintCount.fail === 0,
      body && body.lintCount
    );
    check(
      'S8e lint does not queue anything',
      env.__store.cloud_reviews.length === 0,
      env.__store.cloud_reviews.length
    );
  }

  // =====================================================================
  section('S9 — both surfaces expose the new tools');
  // =====================================================================
  {
    const names = appwide.APPWIDE_TOOLS.map(function (t) {
      return t.name;
    });
    ['get_project_health', 'get_schedule', 'get_resources'].forEach(function (n) {
      const t = appwide.APPWIDE_TOOLS.filter(function (x) {
        return x.name === n;
      })[0];
      check(
        'S9 ' + n + ' is shared and requires projectId app-wide',
        !!t && t.inputSchema.required.indexOf('projectId') !== -1,
        t && t.inputSchema.required
      );
    });
    check(
      'S9d every project tool is present on the app-wide catalog',
      server.TOOLS.every(function (t) {
        return names.indexOf(t.name) !== -1;
      }),
      server.TOOLS.filter(function (t) {
        return names.indexOf(t.name) === -1;
      }).map(function (t) {
        return t.name;
      })
    );
  }

  console.log(
    '\n========== QA-MCP-SURFACE RESULT: ' + pass + ' passed, ' + fail + ' failed =========='
  );
  if (fail) {
    console.log('failed: ' + failures.join(', '));
  }
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('QA harness crashed:', e);
  process.exit(1);
});
