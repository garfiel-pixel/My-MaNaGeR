/* ============================================================
   My MaNaGeR — MCP PARITY GATE (qa-mcp-parity)
   ------------------------------------------------------------
   MCP-DIRECTIVE-2026-11-11 §3.3: the project endpoint
   (/api/mcp/:projectId) and the app-wide endpoint (/api/mcp)
   must share ONE tool registry, ONE scope projector and ONE
   proposal pipeline. This harness fails on drift.

   Runs WITHOUT a live Worker. It imports the real modules and
   asserts:
     P1  every project tool is either shared by the app-wide
         catalog or in the documented intentional-difference
         list (get_proposal_status: project-scoped only)
     P2  the app-wide catalog adds exactly list_projects +
         create_project
     P3  for every shared tool, the app-wide input schema equals
         the project schema plus a REQUIRED projectId, and the
         description is unchanged
     P4  the app-wide module does NOT define its own executor,
         proposal pipeline or envelope validator - it imports
         them from ./server.js (no fork)
     P5  adding projectId to a shared tool's arguments does not
         change the projected output (projectId is inert in the
         shared engine, so both endpoints project identically)
     P6  the auth/premium refusal constants are shared, not
         duplicated (the app-wide surface answers a 401 challenge,
         not the project refusal text)

   Run: node tools/qa-mcp-parity.cjs
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

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

// Project tools that are deliberately NOT on the app-wide surface. The
// app-wide server is a cross-project connector; proposal status is answered
// inside the project UI. Anything else missing is drift.
const INTENTIONAL_ABSENT = ['get_proposal_status'];
// Account-level tools the app-wide catalog adds.
const APPWIDE_ONLY = ['list_projects', 'create_project'];

// A minimal state that exercises every shared read tool. Parity is about
// EQUALITY between the two call shapes, not about the numbers being correct.
const STATE = {
  schemaVersion: 19,
  projectId: 'p1',
  currency: 'USD',
  projectName: 'Parity Project',
  charter: { objective: 'parity' },
  tasks: [
    { id: 't1', name: 'Battle', status: 'todo', startDate: '2026-10-01', endDate: '2026-10-05' },
    { id: 't2', name: 'Glass', status: 'completed', startDate: '2026-10-06', endDate: '2026-10-10' }
  ],
  risks: [{ id: 'r1', description: 'Weather', status: 'open', probability: 3, impact: 3 }],
  issues: [],
  budgetLines: [{ id: 'b1', description: 'Concrete', planned: 1000, actual: 500 }],
  spendLog: [],
  deliveries: [],
  meetings: [{ id: 'm1', date: '2026-10-02', title: 'Kickoff' }],
  logEntries: [{ id: 'l1', date: '2026-10-02', text: 'Started' }],
  changes: [],
  budgetEnvelope: 0
};

// Minimal arguments per shared tool (projectId is added by the app-wide
// surface, so the project call omits it).
const ARGS = {
  get_project_summary: {},
  get_tasks: {},
  get_budget: {},
  get_deliveries: {},
  get_weekly_summary: {},
  get_risks: {},
  get_weather: {},
  get_meetings: {},
  get_table: { table: 'tasks' },
  run_monte_carlo: { simulations: 100 },
  apply_changes: {}
};

(async () => {
  const server = await import('../src/mcp/server.js');
  const appwide = await import('../src/mcp/appwide.js');
  const TOOLS = server.TOOLS;
  const APPWIDE_TOOLS = appwide.APPWIDE_TOOLS;

  const projectNames = TOOLS.map(t => t.name).sort();
  const appwideNames = APPWIDE_TOOLS.map(t => t.name).sort();
  const shared = projectNames.filter(n => appwideNames.indexOf(n) > -1);

  section('P1 — every project tool is shared or intentionally absent');
  const missing = projectNames.filter(
    n => appwideNames.indexOf(n) === -1 && INTENTIONAL_ABSENT.indexOf(n) === -1
  );
  check('no unexpected project tool is missing from the app-wide catalog', missing.length === 0, {
    missing
  });
  const staleAbsent = INTENTIONAL_ABSENT.filter(n => projectNames.indexOf(n) === -1);
  check('intentional-absent list names real project tools', staleAbsent.length === 0, {
    staleAbsent
  });

  section('P2 — app-wide adds exactly list_projects + create_project');
  const extra = appwideNames.filter(n => projectNames.indexOf(n) === -1).sort();
  check(
    'app-wide-only tools are exactly list_projects + create_project',
    JSON.stringify(extra) === JSON.stringify(APPWIDE_ONLY.slice().sort()),
    { extra, expected: APPWIDE_ONLY }
  );

  section('P2b — validate_changes and get_schema are registered in both catalogs');
  const projValidate = TOOLS.filter(t => t.name === 'validate_changes')[0];
  const appValidate = APPWIDE_TOOLS.filter(t => t.name === 'validate_changes')[0];
  check(
    'validate_changes is in the project catalog',
    !!projValidate && !!projValidate.inputSchema,
    { projectNames }
  );
  check(
    'app-wide validate_changes requires a string projectId',
    !!appValidate &&
      !!(appValidate.inputSchema.properties || {}).projectId &&
      (appValidate.inputSchema.required || []).indexOf('projectId') > -1,
    { appValidate }
  );
  check(
    'get_schema is in both catalogs and takes an optional table',
    projectNames.indexOf('get_schema') > -1 &&
      appwideNames.indexOf('get_schema') > -1 &&
      (function () {
        const s = APPWIDE_TOOLS.filter(t => t.name === 'get_schema')[0];
        return (
          !!s &&
          !!(s.inputSchema.properties || {}).table &&
          !!(s.inputSchema.properties || {}).projectId &&
          JSON.stringify((s.inputSchema.required || []).slice().sort()) ===
            JSON.stringify(['projectId'])
        );
      })(),
    { projectNames, appwideNames }
  );

  section('P3 — schema parity for every shared tool');
  const byName = {};
  TOOLS.forEach(t => {
    byName[t.name] = t;
  });
  const appByName = {};
  APPWIDE_TOOLS.forEach(t => {
    appByName[t.name] = t;
  });
  let schemaDrift = [];
  shared.forEach(function (name) {
    const p = byName[name];
    const a = appByName[name];
    if (!p || !a) {
      schemaDrift.push(name + ': missing catalog entry');
      return;
    }
    const pp = Object.assign({}, (p.inputSchema && p.inputSchema.properties) || {});
    const ap = Object.assign({}, (a.inputSchema && a.inputSchema.properties) || {});
    const projectIdProp = ap.projectId;
    delete ap.projectId;
    if (JSON.stringify(pp) !== JSON.stringify(ap)) {
      schemaDrift.push(name + ': properties differ');
      return;
    }
    if (!projectIdProp || projectIdProp.type !== 'string') {
      schemaDrift.push(name + ': app-wide schema lacks a string projectId');
      return;
    }
    const preq = ((p.inputSchema && p.inputSchema.required) || []).slice().sort();
    const areq = ((a.inputSchema && a.inputSchema.required) || []).slice().sort();
    const areqNoPid = areq.filter(function (x) {
      return x !== 'projectId';
    });
    if (JSON.stringify(preq) !== JSON.stringify(areqNoPid) || areq.indexOf('projectId') === -1) {
      schemaDrift.push(name + ': required list differs');
      return;
    }
    if (name !== 'apply_changes' && p.description !== a.description) {
      schemaDrift.push(name + ': description differs');
    }
  });
  check('shared tool schemas match (plus a required projectId)', schemaDrift.length === 0, {
    schemaDrift
  });
  check(
    'apply_changes keeps its project description as the prefix',
    /^Changes are queued for the owner|queued for the owner/.test(
      appByName.apply_changes ? appByName.apply_changes.description : ''
    ),
    appByName.apply_changes && appByName.apply_changes.description
  );

  section('P4 — no forked executor / pipeline / validator');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'mcp', 'appwide.js'), 'utf8');
  check(
    'app-wide does not define its own executeTool',
    !/function\s+executeTool\b/.test(src),
    'executeTool defined in appwide.js'
  );
  check(
    'app-wide does not define its own queueMcpProposal',
    !/function\s+queueMcpProposal\b/.test(src),
    'queueMcpProposal defined in appwide.js'
  );
  check(
    'app-wide does not define its own validateProposalEnvelope',
    !/function\s+validateProposalEnvelope\b/.test(src),
    'validateProposalEnvelope defined in appwide.js'
  );
  check(
    'app-wide imports the shared engine from ./server.js',
    /from\s+'\.\/server\.js'/.test(src) && /executeTool/.test(src) && /queueMcpProposal/.test(src),
    'missing shared import'
  );

  section('P5 — projectId is inert in the shared engine (output parity)');
  let outputDrift = [];
  shared.forEach(function (name) {
    const args = ARGS[name] || {};
    const auth = { role: 'owner', label: 'MCP AI' };
    let a;
    let b;
    try {
      a = server.executeTool(name, STATE, 'p1', 'MCP AI', null, args, auth, STATE);
      b = server.executeTool(
        name,
        STATE,
        'p1',
        'MCP AI',
        null,
        Object.assign({}, args, { projectId: 'p1' }),
        auth,
        STATE
      );
    } catch (e) {
      outputDrift.push(name + ': threw ' + (e && e.message));
      return;
    }
    if (name === 'run_monte_carlo') {
      // Monte Carlo is stochastic by design (Math.random), so compare the
      // SHAPE, not the sampled dates.
      let ja;
      let jb;
      try {
        ja = JSON.parse(a.content[0].text);
        jb = JSON.parse(b.content[0].text);
      } catch (e) {
        outputDrift.push(name + ': unparseable output');
        return;
      }
      const shape = o =>
        Object.keys(o).sort().join(',') +
        '|' +
        Object.keys(o.percentiles || {})
          .sort()
          .join(',');
      if (shape(ja) !== shape(jb)) {
        outputDrift.push(name + ': shape changed when projectId was present');
      }
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      outputDrift.push(name + ': output changed when projectId was present');
    }
  });
  check(
    'every shared tool projects identically with and without projectId',
    outputDrift.length === 0,
    {
      outputDrift
    }
  );

  section('P6 — refusal constants are shared, not duplicated');
  check(
    'MCP_AUTH_REFUSAL stays the project refusal; app-wide answers the 401 challenge',
    typeof server.MCP_AUTH_REFUSAL === 'string' &&
      server.MCP_AUTH_REFUSAL.length > 0 &&
      // T-26 (2026-11-12): the app-wide surface no longer carries the tool
      // refusal text. A remote connector needs a transport-level 401 with the
      // protected-resource metadata URL to start OAuth, so appwide.js must
      // advertise that challenge instead of a second copy of the constant.
      src.indexOf('MCP_AUTH_REFUSAL') === -1 &&
      src.indexOf('WWW-Authenticate') > -1 &&
      src.indexOf('resource_metadata') > -1,
    {
      constant: !!server.MCP_AUTH_REFUSAL,
      challenge: src.indexOf('resource_metadata') > -1
    }
  );
  check(
    'MCP_PREMIUM_REFUSAL is exported by server.js and used verbatim by app-wide',
    typeof server.MCP_PREMIUM_REFUSAL === 'string' &&
      server.MCP_PREMIUM_REFUSAL.length > 0 &&
      src.indexOf('MCP_PREMIUM_REFUSAL') > -1,
    server.MCP_PREMIUM_REFUSAL
  );
  const emptyRefusal = server.validateProposalEnvelope({}, { role: 'owner' });
  check(
    'shared envelope validator refuses an empty proposal with a stable message',
    emptyRefusal &&
      emptyRefusal.isError === true &&
      /Nothing provided/.test(emptyRefusal.content[0].text),
    emptyRefusal
  );

  console.log(
    '\n========== QA-MCP-PARITY RESULT: ' + pass + ' passed, ' + fail + ' failed =========='
  );
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('QA harness crashed:', e);
  process.exit(1);
});
