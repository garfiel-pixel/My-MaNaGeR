/* ============================================================
   qa-engine-parity.cjs - E-T4 (owner 2026-09-27, "can't skip the engine")
   ------------------------------------------------------------
   The bank-renovation lesson: a schedule authored by hand (or by an
   outside AI) with invented dates/critical flags can sit in cloud
   state looking complete while violating the engine's own math -
   the background advisor then flags the fiction. This harness locks
   the parity law end-to-end against a LOCAL wrangler dev + real
   headless Chrome:

     A. session -> cloud project -> owner save -> full-scope key
     B. MCP initialize / tools/list / get_tasks over the REAL route
     C. REST /load under X-API-Key (the predecessors-carrying read;
        get_tasks projects `dependencies` and never `predecessors`)
     D. the REAL served engine (the exported forward/backward/
        calcFloat spine, identical to computePlan's pipeline) runs
        inside the served project page over the MCP-loaded state and
        catches a seeded hand-authored dependency violation
     E. apply_changes queues the engine-derived remediation (the
        review-queue law: never auto-applied)

   Exit 0 only when all gates pass.
   Usage: node tools/qa-engine-parity.cjs
   Registry: CI-TEST-COVERAGE.md -> EXTENDED (extended-qa.yml E-T4).
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.QA_PORT || '8794', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();
const log = s => process.stdout.write('[engine-parity] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val: !!val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))
  );
};

const PERSIST_DIR = path.join(TMP, 'mmgr-parity-wstate-' + Date.now());
const j = async res => {
  try {
    return await res.json();
  } catch (e) {
    return {};
  }
};

let proc = null;
let devLog = '';
function globalWranglerJs() {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), '--version'],
      { encoding: 'utf8', timeout: 30000 }
    );
    if (out) return path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  } catch (e) {
    /* not local */
  }
  const env = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const guess = path.join(env, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(guess) ? guess : null;
}
const WRANGLER_JS = globalWranglerJs();

async function startWrangler() {
  try {
    execFileSync(
      process.execPath,
      [
        WRANGLER_JS,
        'd1',
        'migrations',
        'apply',
        'my-manager-db',
        '--local',
        '--config',
        'wrangler.ci.jsonc',
        '--persist-to',
        PERSIST_DIR
      ],
      { cwd: ROOT, stdio: 'ignore', timeout: 90000 }
    );
  } catch (e) {
    log('migrations (best-effort): ' + e.message);
  }
  proc = spawn(
    process.execPath,
    [
      WRANGLER_JS,
      'dev',
      '--config',
      'wrangler.ci.jsonc',
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      PERSIST_DIR
    ],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        ADMIN_CODE: 'QA-PARITY-ADMIN',
        WRANGLER_SEND_METRICS: 'false'
      })
    }
  );
  proc.stdout.on('data', d => {
    devLog += d;
  });
  proc.stderr.on('data', d => {
    devLog += d;
  });
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) return;
    } catch (e) {
      /* not up */
    }
    if (Date.now() - t0 > 120000) throw new Error('wrangler dev did not come up');
    await delay(1500);
  }
}
function stopWrangler() {
  try {
    proc && proc.kill();
  } catch (e) {}
}

function chromePath() {
  return require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath;
}
async function withChrome(fn) {
  const userDir = path.join(TMP, 'chrome-parity-' + Date.now());
  const port = 9341;
  const chrome = spawn(
    chromePath(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      '--remote-allow-origins=*',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + userDir,
      '--window-size=1280,900',
      '--disk-cache-size=0',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  try {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch('http://127.0.0.1:' + port + '/json/version');
        if (r.ok) break;
      } catch (e) {}
      await delay(300);
    }
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('ws fail'));
    });
    const send = (method, params = {}) =>
      new Promise(res => {
        const mid = ++id;
        pending.set(mid, m => res(m.result || {}));
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    const ev = async expr => {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      });
      if (r && r.exceptionDetails) {
        log('EVAL EXCEPTION: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
        return null;
      }
      return r && r.result && r.result.value;
    };
    await send('Page.enable');
    await fn({ ev });
  } finally {
    try {
      chrome.kill();
    } catch (e) {}
  }
}

(async function main() {
  if (!WRANGLER_JS) {
    log('FATAL: wrangler not found');
    process.exit(1);
  }
  try {
    await startWrangler();
  } catch (e) {
    log('FATAL: ' + e.message);
    log(devLog.slice(-600));
    process.exit(1);
  }
  let hardFail = false;
  try {
    // ---- A. proven seeding recipe (qa-api-keys P0) ----
    const pid = 'parity-' + Date.now().toString(36);
    let r = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'parity-qa@example.com',
        password: 's3cure-pass-1',
        name: 'Parity QA'
      })
    });
    let reg = await j(r);
    let cookie = '';
    const sc = r.headers.get('set-cookie') || '';
    const m = sc.match(/mmgr_session=([^;]+)/);
    if (m) cookie = m[1];
    if (!cookie || !reg.ok) {
      r = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'parity-qa@example.com', password: 's3cure-pass-1' })
      });
      reg = await j(r);
      const m2 = (r.headers.get('set-cookie') || '').match(/mmgr_session=([^;]+)/);
      if (m2) cookie = m2[1];
    }
    check('A1 email session minted', !!cookie && !!reg.ok, { reg, hasCookie: !!cookie });
    const authHeaders = { 'Content-Type': 'application/json' };
    if (cookie) authHeaders.Cookie = 'mmgr_session=' + cookie;

    r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders,
      body: JSON.stringify({ projectId: pid, name: 'Parity Probe' })
    });
    const created = await j(r);
    check(
      'A2 cloud project created (session-linked, ownerCode back)',
      r.ok && created.ok && !!created.ownerCode,
      created
    );
    const ownerHeaders = Object.assign({ 'X-Owner-Code': created.ownerCode }, authHeaders);

    const snapshot = {
      schemaVersion: 19,
      projectId: pid,
      projectName: 'Parity Probe',
      updatedAt: new Date().toISOString(),
      tasks: [
        {
          id: 'p1',
          name: 'Hand-authored A',
          status: 'todo',
          startDate: '2026-10-05',
          endDate: '2026-10-09',
          duration: '5',
          critical: true,
          predecessors: [],
          assignee: '',
          notes: '',
          weatherSensitive: false,
          leadTime: false,
          confidence: 'high'
        },
        {
          id: 'p2',
          name: 'Hand-authored B',
          status: 'todo',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
          duration: '2',
          critical: true,
          predecessors: ['p1'],
          assignee: '',
          notes: '',
          weatherSensitive: false,
          leadTime: false,
          confidence: 'high'
        }
      ],
      resources: [],
      budgetLines: [],
      risks: [],
      meetings: [],
      logEntries: [],
      spendLog: [],
      stakeholders: [],
      issues: [],
      changes: [],
      commsEntries: [],
      documents: []
    };
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ state: snapshot })
    });
    const saved = await j(r);
    check('A3 owner save (real snapshot for scoped reads)', r.ok && saved.ok, saved);

    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/api-keys', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({
        label: 'Parity key',
        scope: [
          'charter',
          'wbs',
          'bud',
          'res',
          'stk',
          'chg',
          'log',
          'risk',
          'close',
          'raci',
          'comms',
          'docs',
          'dmaic',
          'meet'
        ],
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      })
    });
    const createdKey = await j(r);
    const KEY = createdKey.apiKey;
    check(
      'A4 full-scope key minted (sk-mmgr-)',
      !!KEY && KEY.lastIndexOf('sk-mmgr-', 0) === 0,
      createdKey
    );

    // ---- B. MCP over the REAL endpoint ----
    const mcp = async body => {
      const res = await fetch(BASE + '/api/mcp/' + pid, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    };
    const init = await mcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'parity-probe', version: '1.0.0' }
      }
    });
    check('B1 MCP initialize', !!(init && init.result && init.result.serverInfo), init);
    await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    check(
      'B2 tools/list has 7 tools',
      !!(list && list.result && list.result.tools && list.result.tools.length === 7),
      list && list.result && list.result.tools && list.result.tools.length
    );
    const gt = await mcp({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_tasks', arguments: {} }
    });
    const gtTasks = gt && gt.result && JSON.parse(gt.result.content[0].text).tasks;
    check(
      'B3 get_tasks returns seeded tasks with fiction intact',
      gtTasks && gtTasks.length === 2 && gtTasks[0].critical === true,
      gtTasks && gtTasks.length
    );

    // ---- C. REST /load carries predecessors ----
    const loadRes = await (
      await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: '{}'
      })
    ).json();
    check(
      'C1 /load projects tasks with predecessors',
      !!(loadRes.ok && loadRes.state && loadRes.state.tasks[1].predecessors[0] === 'p1'),
      loadRes.ok && loadRes.state && loadRes.state.tasks[1].predecessors
    );

    // ---- D. browser parity: real served engine over MCP-loaded state ----
    await withChrome(async ({ ev }) => {
      // Locally-owned gate seed (qa-date-wiring S0a pattern) so project.html boots full scope.
      await ev(`location.href = ${JSON.stringify(BASE + '/app.html')}`);
      await delay(2200);
      await ev(`(function(){
        localStorage.clear();
        localStorage.setItem('mmgr_admin_projects', JSON.stringify([{ id: ${JSON.stringify(pid)}, name: 'Parity Probe', file: 'project.html?id=${pid}' }]));
        localStorage.setItem('mmgr_current_project', ${JSON.stringify(pid)});
        return true;
      })()`);
      await ev(`location.href = ${JSON.stringify(BASE + '/project.html?id=' + pid)}`);
      await delay(3200);
      const booted = await ev(
        `!!(window.MMGR && MMGR.Schedule && MMGR.Schedule.forwardPass && MMGR.Schedule.backwardPass && MMGR.Schedule.calcFloat && MMGR.Utils)`
      );
      check('D1 project booted with the REAL schedule engine', !!booted, booted);
      const parity = await ev(`(function(){
        const live = ${JSON.stringify(loadRes.state.tasks)};
        // The engine's exported pure spine - the exact pipeline computePlan
        // runs (forward -> backward -> float) on transient clones.
        const work = live.map(function(t){ const c = Object.assign({}, t); c.predecessors = (t.predecessors||[]).slice(); return c; });
        try {
          let sched = MMGR.Schedule.forwardPass(work);
          sched = MMGR.Schedule.backwardPass(work, sched);
          sched = MMGR.Schedule.calcFloat(work, sched);
          const map = {}; sched.forEach(function(r){ map[r.id] = r; });
          const p2 = map['p2'];
          const es = p2 && p2.es ? MMGR.Utils.fmtDate(p2.es) : null;
          // Engine truth: p1 ends Fri 2026-10-09, so p2 (its successor) must
          // start Mon 2026-10-12 - the hand-authored 2026-10-01 is fiction.
          return { p2Start: es, p2TF: p2.totalFloat, catchesViolation: es === '2026-10-12' };
        } catch (e) { return { err: e.message }; }
      })()`);
      check('D2 real engine runs over MCP-loaded state', !!parity && !parity.err, parity);
      check(
        'D3 engine catches the violation: p2 start corrected to 2026-10-12',
        !!parity && parity.catchesViolation === true,
        parity
      );

      // ---- E. MCP remediation loop ----
      const apply = await mcp({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'apply_changes',
          arguments: {
            diffs: [
              {
                path: 'tasks',
                recordId: 'p2',
                field: 'startDate',
                before: '2026-10-01',
                after: '2026-10-12'
              }
            ],
            label: 'Parity remediation'
          }
        }
      });
      const at =
        (apply && apply.result && apply.result.content && apply.result.content[0].text) || '';
      check(
        'E1 apply_changes queues the engine-derived fix',
        at.indexOf('Queued') === 0 && at.indexOf('owner review') !== -1,
        at.slice(0, 200)
      );
    });
  } catch (e) {
    log('FATAL: ' + e.message);
    hardFail = true;
  } finally {
    stopWrangler();
    const passed = results.filter(x => x.val).length;
    log(passed + '/' + results.length + ' gates passed');
    process.exit(hardFail || passed !== results.length ? 1 : 0);
  }
})();
