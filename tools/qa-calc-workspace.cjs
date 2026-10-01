/* ============================================================
   qa-calc-workspace.cjs - client-docs W5 (owner 2026-10-01)
   ------------------------------------------------------------
   T2 harness for /api/calc/workspace (everything follows the
   account). Runs against a LOCAL wrangler dev + real D1/R2 state:

     g1  signed-out GET  -> 403 (session-gated, generic)
     g2  register -> PUT sample workspace -> ok + savedAt
     g3  GET round-trips the sections byte-for-byte
     g4  PUT oversize (>4 MB) -> 413
     g5  PUT non-JSON body -> 400
     g6  every GET response carries plan:'free' (entitlement seam source)

   Usage: node tools/qa-calc-workspace.cjs
   Registry: CI-TEST-COVERAGE.md -> CI row (T2 group in ci.yml).
   Wrangler log + persist dir stay OUTSIDE the repo (lesson 11).
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.QA_PORT || '8796', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const PERSIST_DIR = process.env.QA_PERSIST_DIR || path.join(HOME, 'wrangler-calcws-state');
const LOG_PATH = path.join(HOME, 'wrangler-calcws.log');
const log = (s) => process.stdout.write('[calc-ws] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val: !!val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))); };
const j = async (res) => { try { return await res.json(); } catch (e) { return {}; } };

let proc = null; let devLog = '';
function globalWranglerJs() {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), '--version'], { encoding: 'utf8', timeout: 30000 });
    if (out) return path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  } catch (e) { /* not local */ }
  const env = (process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'));
  const guess = path.join(env, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(guess) ? guess : null;
}
const WRANGLER_JS = globalWranglerJs();

async function startWrangler() {
  try { fs.mkdirSync(PERSIST_DIR, { recursive: true }); } catch (e) {}
  try {
    execFileSync(process.execPath, [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR], { cwd: ROOT, stdio: 'ignore', timeout: 90000 });
  } catch (e) { log('migrations (best-effort): ' + e.message); }
  const out = fs.openSync(LOG_PATH, 'a');
  proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
    cwd: ROOT, stdio: ['ignore', out, out],
    env: Object.assign({}, process.env, { ADMIN_CODE: 'QA-CALCWS-ADMIN', WRANGLER_SEND_METRICS: 'false' })
  });
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer); if (r.ok) return;
    } catch (e) { /* not up */ }
    if (Date.now() - t0 > 120000) throw new Error('wrangler dev did not come up (log ' + LOG_PATH + ')');
    await delay(1500);
  }
}
function stopWrangler() { try { proc && proc.kill(); } catch (e) {} }

(async function main() {
  if (!WRANGLER_JS) { log('FATAL: wrangler not found'); process.exit(1); }
  try { await startWrangler(); } catch (e) { log('FATAL: ' + e.message); process.exit(1); }
  try {
    // g1: signed-out GET is a generic 403 - the route exists but leaks nothing.
    const g1 = await fetch(BASE + '/api/calc/workspace', { method: 'GET' });
    const g1b = await j(g1);
    check('g1 signed-out GET /api/calc/workspace -> 403', g1.status === 403, { status: g1.status, body: g1b });

    // Register (proven recipe) for the session cookie.
    const email = 'calcws-' + Date.now().toString(36) + '@example.com';
    let r = await fetch(BASE + '/api/auth/register', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: 's3cure-pass-1', name: 'Calc WS QA' })
    });
    let reg = await j(r); let cookie = '';
    const m = (r.headers.get('set-cookie') || '').match(/mmgr_session=([^;]+)/);
    if (m) cookie = m[1];
    if (!cookie || !reg.ok) {
      r = await fetch(BASE + '/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 's3cure-pass-1' }) });
      reg = await j(r);
      const m2 = (r.headers.get('set-cookie') || '').match(/mmgr_session=([^;]+)/);
      if (m2) cookie = m2[1];
    }
    if (!cookie) { log('FATAL: no session minted'); process.exit(1); }
    const auth = { 'Content-Type': 'application/json', 'Cookie': 'mmgr_session=' + cookie };

    // g2: PUT a sample workspace -> ok + savedAt.
    const sample = {
      estimates: { val: [{ name: 'Jarrett Lane', total: '128,400' }], updatedAt: 1727770000000 },
      boq: { val: [], updatedAt: 0 },
      history: { val: [{ name: 'Slab 10x8', total: '1,000' }], updatedAt: 1727770001000 },
      packs: { val: [], updatedAt: 0 },
      rollup: { val: { designC: '10', constrC: '5' }, updatedAt: 1727770002000 },
      brand: { val: { name: 'Fairclough Build Ltd', logo: null }, updatedAt: 1727770003000 },
      sheets: { val: [{ id: 'sh1', name: 'low-bid', rates: { rateMat: '9500', rateLab: '5500' } }], updatedAt: 1727770003500 },
      docCounter: { val: { Estimate: 4, Quote: 2, Invoice: 9 }, updatedAt: 1727770004000 }
    };
    const g2 = await fetch(BASE + '/api/calc/workspace', { method: 'PUT', headers: auth, body: JSON.stringify(sample) });
    const g2b = await j(g2);
    check('g2 signed-in PUT sample workspace -> ok + savedAt', g2.status === 200 && g2b.ok && typeof g2b.savedAt === 'string' && g2b.savedAt.length > 0, { status: g2.status, body: g2b });

    // g3: GET round-trips the sections.
    const g3 = await fetch(BASE + '/api/calc/workspace', { method: 'GET', headers: { 'Cookie': 'mmgr_session=' + cookie } });
    const g3b = await j(g3);
    const rt = g3b.ws && g3b.ws.estimates && g3b.ws.estimates.val[0].name === 'Jarrett Lane'
      && g3b.ws.brand.val.name === 'Fairclough Build Ltd'
      && g3b.ws.docCounter.val.Invoice === 9
      && g3b.ws.sheets.val[0].name === 'low-bid' && g3b.ws.sheets.val[0].rates.rateMat === '9500'
      && g3b.ws.rollup.val.designC === '10'
      && typeof g3b.ws.savedAt === 'string';
    check('g3 GET round-trips the stored sections + savedAt', g3.status === 200 && g3b.ok && rt, { status: g3.status, ws: g3b.ws ? Object.keys(g3b.ws) : null });

    // g4: oversize PUT -> 413.
    const big = JSON.stringify({ big: 'x'.repeat(4100000) });
    const g4 = await fetch(BASE + '/api/calc/workspace', { method: 'PUT', headers: auth, body: big });
    check('g4 PUT over the 4MB cap -> 413', g4.status === 413, { status: g4.status });

    // g5: non-JSON body -> 400.
    const g5 = await fetch(BASE + '/api/calc/workspace', { method: 'PUT', headers: auth, body: 'not-json-at-all' });
    check('g5 PUT non-JSON body -> 400', g5.status === 400, { status: g5.status });

    // g6: plan:'free' rides every GET response (entitlement seam source).
    const g6 = await fetch(BASE + '/api/calc/workspace', { method: 'GET', headers: { 'Cookie': 'mmgr_session=' + cookie } });
    const g6b = await j(g6);
    check("g6 GET response carries plan:'free'", g6.status === 200 && g6b.plan === 'free', { status: g6.status, plan: g6b.plan });
  } finally {
    stopWrangler();
  }
  const failed = results.filter(r => !r.val).length;
  log(results.length + ' gates, ' + (results.length - failed) + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { log('FATAL: ' + e.message); stopWrangler(); process.exit(1); });
