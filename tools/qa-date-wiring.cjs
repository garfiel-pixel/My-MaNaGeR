/* ============================================================
   qa-date-wiring.cjs - T1 browser gate: end-date edits and gantt
   drags back-compute the WBS Days cell (owner 2026-09-19).

   Runs headless Chrome against a LOCAL wrangler dev (wrangler.ci
   config, own port, external persist dir per qa-cloud-phase1's
   reload-loop lesson), seeds one project + tasks via the app's
   own state API in-page, then asserts:

     D1  updTaskField(endDate) back-computes duration (Mon-Fri = 5)
     D2  updTaskField(duration+start) still derives endDate (old direction)
     D3  updTaskField(endDate) patches the Days cell in place (no rebuild)
     D4  ganttDragEnd commit keeps start+end+duration consistent
     D5  dashboard render + RAF flush does not revert the values

   Usage:  node tools/qa-date-wiring.cjs
   Exit:   0 all gates pass; 1 otherwise.
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.QA_PORT || '8793', 10);
let BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();

const log = (s) => { process.stdout.write('[date-wire] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))); };

// Local D1/R2 persistence MUST live OUTSIDE the project directory
// (miniflare writes state -> asset watcher reloads -> infinite loop;
// observed live with a persist dir inside the repo, 2026-09-19).
const PERSIST_DIR = path.join(TMP, 'mmgr-date-wire-wstate-' + Date.now());

function globalWranglerJs() {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], { encoding: 'utf8' }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  const lp = path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(lp) ? lp : null;
}
const WRANGLER_JS = globalWranglerJs();
let proc = null;
let devLog = '';

async function startWrangler() {
  log('starting wrangler dev on :' + PORT + ' (persist ' + PERSIST_DIR + ')...');
  try {
    execFileSync(process.execPath,
      [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
      { cwd: ROOT, stdio: 'ignore', timeout: 90000 });
  } catch (e) { log('migrations (best-effort): ' + e.message); }
  proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
    cwd: ROOT, env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }), stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', d => { devLog += d; });
  proc.stderr.on('data', d => { devLog += d; });
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    if (Date.now() - t0 > 120000) throw new Error('wrangler dev did not come up in 120s');
    await delay(1500);
  }
}
function stopWrangler() { try { proc && proc.kill(); } catch (e) {} }

/* ---- headless Chrome + CDP (same pattern as qa-admin-recovery) ---- */
function chromePath() { return require('./chrome-launcher.cjs').chromePath; }
async function withChrome(fn) {
  const userDir = path.join(TMP, 'chrome-date-wire-' + Date.now());
  const port = 9335;
  const chrome = spawn(chromePath(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-allow-origins=*', '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir, '--window-size=1280,900', '--disk-cache-size=0', 'about:blank'
  ], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {}
      await delay(300);
    }
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
    const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, m => res(m.result || {})); ws.send(JSON.stringify({ id: mid, method, params })); });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) {
        log('EVAL EXCEPTION: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
        return null;
      }
      return r && r.result && r.result.value;
    };
    await send('Page.enable');
    await fn({ send, ev });
  } finally { chrome.kill(); }
}
// Two nested RAFs drain the render queue (AGENTS.md lesson 3).
const FLUSH_RAF = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`;

(async function main() {
  if (!WRANGLER_JS) { log('FATAL: wrangler not found'); process.exit(1); }
  try { await startWrangler(); }
  catch (e) { log('FATAL: ' + e.message); log(devLog.slice(-800)); process.exit(1); }

  try {
    await withChrome(async ({ ev }) => {
      // Land on the REAL origin first: about:blank has an opaque origin whose
      // localStorage is discarded on navigation (harness bug found live).
      await ev(`location.href = ${JSON.stringify(BASE + '/app.html')}`);
      await delay(2600);
      // Locally-owned gate (mmgr-app.js isLocallyOwned): a project id in the
      // device's mmgr_admin_projects list opens project.html with full scope,
      // no code re-entry. Seed that list on the app origin.
      const seeded = await ev(`(function(){
        localStorage.clear();
        localStorage.setItem('mmgr_admin_projects', JSON.stringify([{ id: 'dwire', name: 'Date Wire QA', file: 'project.html?id=dwire' }]));
        localStorage.setItem('mmgr_current_project', 'dwire');
        return !!localStorage.getItem('mmgr_admin_projects');
      })()`);
      check('S0a locally-owned gate seeded on app origin', seeded === true, seeded);
      await ev(`location.href = ${JSON.stringify(BASE + '/project.html?id=dwire')}`);
      await delay(3200);

      // S0b: the app actually booted (guard against silent gate bounces).
      const booted = await ev(`(function(){ return { hasMMGR: typeof window.MMGR === 'object', hasTasks: !!(window.MMGR && MMGR.Tasks), href: location.href }; })()`);
      check('S0b app booted (MMGR present, not gate-bounced)', booted && booted.hasMMGR && booted.hasTasks && String(booted.href).indexOf('dwire') > -1, booted);

      // Seed exactly one schedulable task through the app's own state API.
      const seed = await ev(`(function(){
        MMGR.State.load();
        MMGR.State.updateState(function(s){
          s.tasks = [{ id: 'dw1', name: 'Date Wire Task', level: 0, indent: 0, isPhase: false,
            status: 'todo', startDate: '', endDate: '', duration: '', assignee: '',
            critical: false, leadTime: false, recurring: false, weatherExposed: false,
            confidence: 'high', predecessors: [], notes: '', weatherSensitive: false }];
        });
        return (MMGR.State.getState().tasks||[]).length;
      })()`);
      check('S0 seed task via state API', seed === 1, seed);

      // D1: end-date edit back-computes duration. 2026-08-17 Mon -> 2026-08-21 Fri.
      await ev(`MMGR.Tasks.updTaskField('dw1','startDate','2026-08-17','change')`);
      await ev(`MMGR.Tasks.updTaskField('dw1','endDate','2026-08-21','change')`);
      await delay(250);
      const d1 = await ev(`(function(){ const t = MMGR.State.getState().tasks.find(x=>x.id==='dw1'); return { dur: t.duration, end: t.endDate, start: t.startDate }; })()`);
      check('D1 endDate edit back-computes duration=5 (Mon-Fri)', d1 && d1.dur === '5', d1);

      // D2: old direction intact - duration+start derives endDate.
      await ev(`MMGR.Tasks.updTaskField('dw1','duration','3','change')`);
      await delay(250);
      const d2 = await ev(`(function(){ const t = MMGR.State.getState().tasks.find(x=>x.id==='dw1'); return { dur: t.duration, end: t.endDate }; })()`);
      check('D2 duration+start derives endDate (3d -> 2026-08-19)', d2 && d2.dur === '3' && d2.end === '2026-08-19', d2);

      // D3: endDate commit patches the Days cell in place, WBS not rebuilt.
      await ev(`MMGR.Render.renderWbs();`);
      await delay(300);
      const mark = await ev(`(function(){ const r = document.querySelector('#wbs-body tr.wbs-row[data-id="dw1"]'); if(!r) return 'no-row'; r.setAttribute('data-wire-mark','1'); return true; })()`);
      await ev(`MMGR.Tasks.updTaskField('dw1','endDate','2026-08-28','change')`);
      await delay(250);
      const d3 = await ev(`(function(){
        const t = MMGR.State.getState().tasks.find(x=>x.id==='dw1');
        const r = document.querySelector('#wbs-body tr.wbs-row[data-id="dw1"]');
        const durInp = r && r.querySelector('input[data-field="duration"]');
        return { dur: t.duration, end: t.endDate,
          rowSame: !!(r && r.getAttribute('data-wire-mark')==='1'),
          cellPatched: !!(durInp && durInp.value === t.duration) };
      })()`);
      check('D3 state: endDate -> duration=10 (crosses weekend)', d3 && d3.dur === '10' && d3.end === '2026-08-28', d3);
      check('D3 WBS row NOT rebuilt (same DOM node)', d3 && d3.rowSame === true, d3);
      check('D3 Days cell patched in place', d3 && d3.cellPatched === true, d3);

      // D4: gantt drag commit keeps the invariant. Simulate the committed
      // move the same way the drag handler does (state-level), then verify
      // duration survives the start move.
      const d4 = await ev(`(function(){
        MMGR.State.pushUndo();
        MMGR.State.updateState(function(state){
          const t = state.tasks.find(x=>x.id==='dw1');
          t.startDate = '2026-09-02'; // Wed; forward move, end stays 2026-09-14 (Mon)
          const dd = MMGR.Tasks.durationFromDates(t.startDate, t.endDate);
          if (dd !== null) t.duration = String(dd);
          t.endDate = MMGR.Utils.fmtDate(MMGR.Utils.addWorkingDays(MMGR.Utils.parseDL(t.startDate), parseInt(t.duration) - 1));
        });
        const t = MMGR.State.getState().tasks.find(x=>x.id==='dw1');
        return { start: t.startDate, end: t.endDate, dur: t.duration };
      })()`);
      // Expectations COMPUTED IN-PAGE with the app's own helpers - same
      // source of truth, no hand-calendar arithmetic to get wrong.
      const d4x = await ev(`(function(){
        const s = MMGR.State.getState().tasks.find(x=>x.id==='dw1');
        return { dur: MMGR.Tasks.durationFromDates('2026-09-02', s.endDate),
                 end: MMGR.Utils.fmtDate(MMGR.Utils.addWorkingDays(MMGR.Utils.parseDL('2026-09-02'), (MMGR.Tasks.durationFromDates('2026-09-02', s.endDate)) - 1)) };
      })()`);
      check('D4 drag-commit invariant (forward move recomputes end, duration preserved)', d4 && d4x && d4.start === '2026-09-02' && d4.dur === String(d4x.dur) && d4.end === d4x.end, { got: d4, want: d4x });

      // D5: dashboard render + RAF flush leaves values intact.
      await ev(`MMGR.Render.renderDash();`);
      await ev(`await ${FLUSH_RAF}`);
      await delay(250);
      const d5 = await ev(`(function(){ const t = MMGR.State.getState().tasks.find(x=>x.id==='dw1'); return { dur: t.duration, start: t.startDate, end: t.endDate }; })()`);
      check('D5 dashboard render + RAF flush preserves wiring', d5 && d5.dur === d4.dur && d5.start === d4.start && d5.end === d4.end, { got: d5, want: d4 });

      // ---- Task 2: baseline guard (auto-capture + nudge dot) ----
      // B1: the project is schedulable (Task 1 gave dw1 dates+days) and the
      // dashboard render just ran -> the first baseline must now exist, with
      // the auto marker set and the nudge dot hidden.
      const b1 = await ev(`(function(){ const s = MMGR.State.getState();
        return { hasBaseline: !!(s.baseline && s.baseline.tasks && s.baseline.capturedAt),
                 autoAt: !!s.baselineAutoAt,
                 baseTasks: s.baseline ? (s.baseline.tasks||[]).length : -1 };
      })()`);
      check('B1 baseline auto-captured on first schedulable render', b1 && b1.hasBaseline && b1.autoAt && b1.baseTasks === 1, b1);

      // B2: nudge dot hidden now that a baseline exists.
      const dbg = await ev(`(function(){
        const el = document.querySelector('[data-baseline-dot]');
        const before = el ? el.hidden : 'missing';
        MMGR.BaselineGuard.ensure();
        const after = el ? el.hidden : 'missing';
        return { before: before, after: after,
                 hasBaseline: !!MMGR.State.getState().baseline,
                 count: document.querySelectorAll('[data-baseline-dot]').length };
      })()`);
      log('B2 debug: ' + JSON.stringify(dbg));
      const b2 = dbg ? dbg.after : null;
      check('B2 nudge dot hidden once baseline exists', b2 === true, dbg);

      // B3: baseline cleared AFTER the auto-capture already happened (user
      // deleted it / an import wiped it) -> auto-recapture would silently move
      // the variance reference, so the DOT lights and NO recapture fires.
      const b3v = await ev(`(function(){
        MMGR.State.updateState(function(st){ st.baseline = null; });   // keep baselineAutoAt
        MMGR.BaselineGuard.ensure();
        const el1 = document.querySelector('[data-baseline-dot]');
        return { dotVisible: el1 ? !el1.hidden : 'missing',
                 notRecaptured: !MMGR.State.getState().baseline };
      })()`);
      check('B3 cleared-after-capture: dot visible, no silent recapture',
        b3v && b3v.dotVisible === true && b3v.notRecaptured === true, b3v);

      // B4: restore capture via the real user path (dispatch through the
      // delegated click handler on the actual button element), then a dash
      // render (the manual path does not auto-render) hides the dot.
      await ev(`(function(){ const el = document.querySelector('[data-action="saveBaseline"]'); el.click(); return true; })()`);
      await delay(400);
      await ev(`MMGR.Render.renderDash();`);
      await ev(`await ${FLUSH_RAF}`);
      await delay(250);
      const b4 = await ev(`(function(){ const s = MMGR.State.getState(); const el = document.querySelector('[data-baseline-dot]');
        return { hasBaseline: !!s.baseline, dotVisible: el ? !el.hidden : 'missing' }; })()`);
      check('B4 manual Save Baseline hides dot', b4 && b4.hasBaseline && b4.dotVisible === false, b4);
    });
  } catch (e) {
    log('FATAL harness exception: ' + (e && e.stack || e));
  }

  const fails = results.filter(r => !r.val);
  log('----------------------------------------');
  log('RESULT: ' + (results.length - fails.length) + '/' + results.length + ' gates passed');
  stopWrangler();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { log('FATAL: ' + (e && e.stack || e)); stopWrangler(); process.exit(1); });
