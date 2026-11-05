#!/usr/bin/env node
/* ============================================================
   F2 - LOAD TEST (EXECUTION-PLAN 3.1)
   ------------------------------------------------------------
   Measures the cloud surface a contractor actually waits on, against a
   LOCAL wrangler dev with local D1 + R2, and publishes p50/p95/p99 per
   scenario. The numbers are what F5's internal targets get judged against
   (99.9% on /api/health, p95 under 300 ms) - they are internal, and no
   marketing number may quote them until F4 (the restore drill) exists.

   Scenarios:
     health  GET  /api/health                  - the uptime probe
     shell   GET  /app.html                    - the document every load pays
     load    POST /api/cloud/projects/:id/load - D1 row + R2 object read
     save    POST /api/cloud/projects/:id/save - diff, D1 write, R2 put

   WHY THE PROJECT FAN-OUT: the product's own per-code bucket allows 30
   requests a minute. A load test that hammers one owner code would spend
   its time measuring the rate limiter, not the app. Each scenario
   therefore seeds several projects and round-robins the owner codes, which
   is also closer to real traffic (many tenants, not one).

   A 429 in the results is a HARNESS failure, not an app failure: it means
   this script asked for more than the product allows, and every latency in
   that scenario is suspect. The gate fails on it and says how to fix it.

   Usage:
     node tools/qa-load-test.cjs                 # boots its own wrangler
     MMGR_LOAD_URL=http://127.0.0.1:8791 node tools/qa-load-test.cjs
   Environment:
     MMGR_LOAD_SECONDS      per-scenario wall clock (default 20)
     MMGR_LOAD_CONCURRENCY  parallel requests (default 8)
     MMGR_LOAD_PROJECTS     owner codes to rotate (default 20)
     MMGR_LOAD_RESULTS      results directory (default load/results)
   ============================================================ */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.MMGR_LOAD_PORT || 8791);
const BASE = process.env.MMGR_LOAD_URL || 'http://127.0.0.1:' + PORT;
const USE_EXTERNAL = !!process.env.MMGR_LOAD_URL;
const SECONDS = Number(process.env.MMGR_LOAD_SECONDS || 20);
const CONCURRENCY = Number(process.env.MMGR_LOAD_CONCURRENCY || 8);
// The cloud scenarios are CPU-bound on the owner-code KDF (100k PBKDF2 rounds
// per request). Running them at 8 would measure this dev server's queue, not
// the request: p50 goes from ~300ms to ~3s with no app work in between. Two in
// flight keeps the reported figure close to service time.
const CLOUD_CONCURRENCY = Number(process.env.MMGR_LOAD_CLOUD_CONCURRENCY || 2);
const PROJECT_COUNT = Number(process.env.MMGR_LOAD_PROJECTS || 20);
const RESULTS_DIR = path.resolve(ROOT, process.env.MMGR_LOAD_RESULTS || 'load/results');
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-load-' + Date.now().toString(36));

// The per-code allowance is 30/min. Ten requests per code inside a 60 s
// window leaves the whole run safely under it, including the one seed save.
const PER_CODE = 10;

const log = s => process.stdout.write('[load] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

let proc = null;
let devLog = '';

function wranglerJs() {
  const local = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (fs.existsSync(local)) {
    return local;
  }
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npm, ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    return fs.existsSync(p) ? p : null;
  } catch (e) {
    return null;
  }
}

async function healthOk() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
    if (!r.ok) {
      return false;
    }
    const body = await r.json().catch(() => null);
    return !!(body && body.ok === true);
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function startServer() {
  if (USE_EXTERNAL) {
    log('using ' + BASE);
    return;
  }
  const wjs = wranglerJs();
  if (!wjs) {
    throw new Error('wrangler not found (local node_modules or global)');
  }
  try {
    execFileSync(
      process.execPath,
      [
        wjs,
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
      { cwd: ROOT, stdio: 'ignore', timeout: 120000 }
    );
  } catch (e) {
    log('migrations apply (best-effort): ' + e.message);
  }
  log('starting wrangler dev on :' + PORT);
  proc = spawn(
    process.execPath,
    [
      wjs,
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
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  proc.stdout.on('data', d => (devLog += d));
  proc.stderr.on('data', d => (devLog += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    if (await healthOk()) {
      // The router can answer /api/health from the old isolate during a
      // reload; give the freshly-ready worker a moment to settle.
      await delay(1000);
      return;
    }
    await delay(1500);
  }
  throw new Error('wrangler dev never answered /api/health\n' + devLog.slice(-2000));
}

function stopServer() {
  try {
    proc && proc.kill();
  } catch (e) {
    /* best effort */
  }
}

// ---- traffic ---------------------------------------------------------------

async function timed(url, init) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, init);
    const body = await res.text();
    return { ms: performance.now() - t0, status: res.status, body: body };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, body: String(e && e.message) };
  }
}

function percentile(sorted, p) {
  if (!sorted.length) {
    return 0;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

async function runScenario(name, budget, concurrency, windowMs, makeRequest) {
  // One warm-up request so module init and the first D1/R2 touch are not
  // charged to the measured window.
  await makeRequest(0);
  const latencies = [];
  const statuses = {};
  let next = 0;
  let stop = false;

  const deadline = windowMs === Infinity ? Infinity : Date.now() + windowMs;
  const worker = async () => {
    while (!stop) {
      const i = next++;
      if (i >= budget || Date.now() > deadline) {
        stop = true;
        return;
      }
      const r = await makeRequest(i);
      latencies.push(r.ms);
      statuses[r.status] = (statuses[r.status] || 0) + 1;
      if (r.status === 0 || r.status >= 500) {
        log('  ' + name + ' status ' + r.status + ' ' + String(r.body).slice(0, 200));
      }
    }
  };

  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = Math.max(1, Date.now() - t0);

  const sorted = latencies.slice().sort((a, b) => a - b);
  const ok = statuses[200] || 0;
  return {
    name: name,
    n: latencies.length,
    ok: ok,
    limited: statuses[429] || 0,
    serverError: Object.keys(statuses)
      .filter(s => Number(s) >= 500)
      .reduce((n, s) => n + statuses[s], 0),
    transportError: statuses[0] || 0,
    p50: +percentile(sorted, 50).toFixed(1),
    p95: +percentile(sorted, 95).toFixed(1),
    p99: +percentile(sorted, 99).toFixed(1),
    max: +(sorted[sorted.length - 1] || 0).toFixed(1),
    rps: +(latencies.length / (elapsed / 1000)).toFixed(1)
  };
}

function stateBlob(pid, i) {
  const tasks = [];
  for (let k = 0; k < 40; k++) {
    tasks.push({
      id: 't' + k,
      name: 'Task ' + k,
      status: k % 3 === 0 ? 'done' : 'todo',
      start: '2026-11-0' + ((k % 9) + 1),
      dur: 3 + (k % 7),
      assignee: 'crew-' + (k % 5)
    });
  }
  const risks = [];
  for (let k = 0; k < 15; k++) {
    risks.push({ id: 'r' + k, name: 'Risk ' + k, prob: k % 5, impact: (k * 3) % 5, owner: 'PM' });
  }
  return {
    schemaVersion: 17,
    projectId: pid,
    projectName: 'Load ' + i,
    charter: { name: 'Load ' + i, client: 'QA', start: '2026-11-01', end: '2027-06-30' },
    tasks: tasks,
    risks: risks,
    issues: [{ id: 'i1', name: 'Sample issue', status: 'open' }],
    changes: [{ id: 'c1', name: 'Sample change', status: 'pending' }],
    budget: { lines: [{ id: 'b1', desc: 'Concrete', qty: 100, rate: 120 }] },
    fieldTs: {}
  };
}

async function seed() {
  const projects = [];
  const name = 'qa-load-' + Date.now().toString(36);
  for (let i = 0; i < PROJECT_COUNT; i++) {
    const pid = name + '-' + i;
    const create = await timed(BASE + '/api/cloud/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: pid, name: 'Load ' + i })
    });
    let body = null;
    try {
      body = JSON.parse(create.body);
    } catch (e) {
      body = null;
    }
    if (create.status !== 200 || !body || !body.ownerCode) {
      throw new Error(
        'seed create failed for ' + pid + ': ' + create.status + ' ' + create.body.slice(0, 300)
      );
    }
    const save = await timed(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': body.ownerCode },
      body: JSON.stringify({ state: stateBlob(pid, i) })
    });
    if (save.status !== 200) {
      throw new Error(
        'seed save failed for ' + pid + ': ' + save.status + ' ' + save.body.slice(0, 300)
      );
    }
    projects.push({ pid: pid, code: body.ownerCode });
    if ((i + 1) % 5 === 0) {
      log('seeded ' + (i + 1) + '/' + PROJECT_COUNT + ' projects');
    }
  }
  return projects;
}

async function main() {
  const startedAt = new Date();
  log(
    'base ' +
      BASE +
      ', ' +
      SECONDS +
      's/scenario, concurrency ' +
      CONCURRENCY +
      ', ' +
      PROJECT_COUNT +
      ' codes'
  );
  await startServer();

  const projects = await seed();

  // Each request gets its own project so no owner code is asked for more
  // than PER_CODE requests in the window.
  const pick = i => projects[i % projects.length];

  const scenarios = [];
  scenarios.push(
    await runScenario('health', SECONDS * 60, CONCURRENCY, SECONDS * 1000, async () =>
      timed(BASE + '/api/health')
    )
  );
  scenarios.push(
    await runScenario('shell', SECONDS * 30, CONCURRENCY, SECONDS * 1000, async () =>
      timed(BASE + '/app.html')
    )
  );
  scenarios.push(
    await runScenario('load', projects.length * PER_CODE, CLOUD_CONCURRENCY, Infinity, async i => {
      const p = pick(i);
      return timed(BASE + '/api/cloud/projects/' + p.pid + '/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Code': p.code },
        body: '{}'
      });
    })
  );
  scenarios.push(
    await runScenario('save', projects.length * PER_CODE, CLOUD_CONCURRENCY, Infinity, async i => {
      const p = pick(i);
      const blob = stateBlob(p.pid, i);
      blob.fieldTs = { 'tasks.t0.name': new Date().toISOString() };
      blob.tasks[0].name = 'Task 0 rev ' + i;
      return timed(BASE + '/api/cloud/projects/' + p.pid + '/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Code': p.code },
        body: JSON.stringify({ state: blob })
      });
    })
  );

  const meta = {
    date: startedAt.toISOString(),
    commit: (() => {
      try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
          cwd: ROOT,
          encoding: 'utf8'
        }).trim();
      } catch (e) {
        return 'unknown';
      }
    })(),
    node: process.version,
    platform: process.platform + ' ' + os.arch(),
    base: BASE,
    secondsPerScenario: SECONDS,
    concurrency: CONCURRENCY,
    codes: PROJECT_COUNT,
    scenarios: scenarios
  };

  log('');
  log('scenario   n     ok   429   5xx   p50     p95     p99     max     rps');
  for (const s of scenarios) {
    log(
      s.name.padEnd(10) +
        String(s.n).padEnd(6) +
        String(s.ok).padEnd(6) +
        String(s.limited).padEnd(6) +
        String(s.serverError + s.transportError).padEnd(6) +
        (s.p50 + 'ms').padEnd(8) +
        (s.p95 + 'ms').padEnd(8) +
        (s.p99 + 'ms').padEnd(8) +
        (s.max + 'ms').padEnd(8) +
        s.rps
    );
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const jsonPath = path.join(RESULTS_DIR, stamp + '-' + meta.commit + '.json');
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2) + '\n');

  const md = [
    '# Load test - ' + meta.date,
    '',
    'Commit `' + meta.commit + '` | ' + meta.node + ' | ' + meta.platform,
    '',
    'Local wrangler dev with local D1 and R2, ' +
      meta.codes +
      ' owner codes rotated, concurrency ' +
      meta.concurrency +
      ', ' +
      meta.secondsPerScenario +
      's per scenario.',
    '',
    '| Scenario | n | ok | 429 | 5xx | p50 | p95 | p99 | max | req/s |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...scenarios.map(
      s =>
        '| ' +
        s.name +
        ' | ' +
        s.n +
        ' | ' +
        s.ok +
        ' | ' +
        s.limited +
        ' | ' +
        (s.serverError + s.transportError) +
        ' | ' +
        s.p50 +
        ' ms | ' +
        s.p95 +
        ' ms | ' +
        s.p99 +
        ' ms | ' +
        s.max +
        ' ms | ' +
        s.rps +
        ' |'
    ),
    '',
    'Targets (`docs/RELIABILITY-TARGETS.md`): `/api/health` p95 under 300 ms. ' +
      'These are local numbers; staging is measured separately and no number is public before F4.',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(RESULTS_DIR, 'latest.md'), md);
  log('wrote ' + path.relative(ROOT, jsonPath));

  // ---- gate ---------------------------------------------------------------
  let failed = 0;
  const fail = msg => {
    failed++;
    log('FAIL  ' + msg);
  };
  for (const s of scenarios) {
    if (s.serverError) {
      fail(s.name + ': ' + s.serverError + ' server error(s)');
    }
    if (s.transportError) {
      fail(s.name + ': ' + s.transportError + ' transport error(s)');
    }
    if (s.limited) {
      fail(
        s.name +
          ': ' +
          s.limited +
          ' rate-limited - the harness asked for more than the product allows; raise MMGR_LOAD_PROJECTS or lower MMGR_LOAD_CONCURRENCY'
      );
    }
    if (s.n < 20) {
      fail(s.name + ': only ' + s.n + ' samples, too few to publish a p99');
    }
  }
  const health = scenarios.find(s => s.name === 'health');
  if (health && health.p95 > 300) {
    fail('health p95 ' + health.p95 + 'ms exceeds the 300ms target');
  }

  if (failed) {
    log('');
    log('LOAD GATE FAIL - ' + failed + ' problem(s)');
    return 1;
  }
  log('');
  log('LOAD GATE PASS - no 5xx, no 429, health p95 within target');
  return 0;
}

let code = 1;
main()
  .then(c => {
    code = c;
  })
  .catch(e => {
    log('ERROR ' + (e && e.stack ? e.stack : e));
    code = 2;
  })
  .finally(() => {
    stopServer();
    setTimeout(() => process.exit(code), 500);
  });
