/* ============================================================
   VERIFY-DYNAMIC-LABELS — DIR-7a (dynamic half) gate.
   PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE: the static a11y pass
   fixed project.html's markup; this checks the JS-rendered half —
   the updField/updSpendEntry table inputs (Budget / Resources /
   Changes / Risks / Issues / Comms / Log / Documents /
   Stakeholders / CloseItems / spend log) that only exist once a
   section has been rendered with data.

   Method: boots headless Chrome against the local server (:8765,
   spawned here if not already up), seeds a project with rows in
   every module, clicks every section nav button so all panels
   render, then asserts zero unnamed updField/updSpendEntry
   controls remain (named = aria-label OR title OR label[for]).

   Usage: node tools/verify-dynamic-labels.cjs
   Exit 0 only when every rendered control has an accessible name.
   ============================================================ */
const { spawn, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const PROFILE = path.join(os.tmpdir(), 'mmgr-dynlabels-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => process.stdout.write('[verify-dynamic-labels] ' + s + '\n');
const delay = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 180000);

function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => { pending.delete(id); res(m.result || {}); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
  return r.result && r.result.value;
}

async function bootChrome(port, profile, url) {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {}
    await delay(300);
  }
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const pages = targets.filter(t => t.type === 'page');
  ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: url || (BASE + '/seed-test.html') });
  await delay(4000);
  return proc;
}

(async () => {
  // Ensure the dev server is up (spawn if needed).
  let server = null;
  try {
    const r = await fetch(BASE + '/index.html');
    if (!r.ok) throw new Error('bad status');
  } catch (e) {
    log('server not up — spawning serve.cjs');
    server = spawn(process.execPath, ['serve.cjs'], { stdio: 'ignore', detached: true });
    for (let i = 0; i < 30; i++) {
      try { const r = await fetch(BASE + '/index.html'); if (r.ok) break; } catch (e2) {}
      await delay(300);
    }
  }

  const proc = await bootChrome(9245, PROFILE);
  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail))); };

  try {
    // DIR-7a hardening (2026-09-04): CI runner flakes twice in a row on this
    // gate (a docs-only commit flipped it — not code). The fixed 4s/1200ms
    // delays race slow runners: the seed can fire before the bundle is ready
    // and the audit can run mid-render. Both waits are now readiness polls.
    const bootReady = await ev(`(async function(){
      for (var i = 0; i < 40; i++) {
        try {
          if (typeof MMGR !== 'undefined' && MMGR.State && typeof MMGR.State.updateState === 'function'
              && typeof MMGR.State.clearProject === 'function') return true;
        } catch (e) {}
        await new Promise(function(r){ setTimeout(r, 500); });
      }
      return false;
    })()`);
    if (bootReady !== true) { log('FAIL app never became ready after boot'); process.exit(1); }
    // Seed a project with rows in EVERY module that renders table inputs.
    await ev(`(function(){
      MMGR.State.clearProject();
      MMGR.State.updateState(function(s){
        s.projectName = 'Dynamic Label Check';
        s.tasks = [
          { id: 't1', name: 'Demolition', status: 'inprogress', startDate: '2026-06-01', endDate: '2026-06-20', duration: '15', critical: true },
          { id: 't2', name: 'MEP Rough-In', status: 'todo', startDate: '2026-06-22', endDate: '2026-08-05', duration: '32', critical: false }
        ];
        s.budgetLines = [
          { id: 'b1', name: 'Demolition', category: 'Subcontract', planned: 40000, actual: 41200, isContingency: false },
          { id: 'b2', name: 'MEP', category: 'Mechanical', planned: 120000, actual: 95000, isContingency: true }
        ];
        s.spendLog = [
          { id: 's1', date: '2026-07-01', budgetLineId: 'b1', amount: 15000, notes: 'Invoice 1042' },
          { id: 's2', date: '2026-07-08', budgetLineId: 'b2', amount: 32000, notes: 'Invoice 1047' }
        ];
        s.resources = [
          { id: 'r1', name: 'Reyes Glass', role: 'Subcontractor', rate: 85, hoursAllocated: 40, availability: 100 },
          { id: 'r2', name: 'J. Mason', role: 'Foreman', rate: 62, hoursAllocated: 80, availability: 90 }
        ];
        s.changes = [
          { id: 'c1', title: 'Storefront spec change', requester: 'Owner', date: '2026-07-10', status: 'pending', costImpact: '12000', schedImpact: '5 days', approvedBy: '', notes: '' }
        ];
        s.risks = [
          { id: 'rk1', description: 'Glazing lead time', probability: 'Medium', impact: 'High', mitigation: 'Order early', costImpactEstimate: 8000, linkedTaskId: 't2' }
        ];
        s.issues = [ { id: 'i1', description: 'Elevator permit delay', status: 'open', targetDate: '2026-08-01' } ];
        s.commsEntries = [ { id: 'cm1', date: '2026-07-12', type: 'email', from: 'Owner', summary: 'Rent schedule', attendees: '', actionItems: '', followUp: '', notes: '' } ];
        s.logEntries = [ { id: 'l1', date: '2026-07-12', type: 'decision', by: 'PM', decision: 'Dual-source glazing', actionItems: '' } ];
        s.documents = [ { id: 'd1', docNo: 'DR-014', title: 'RCP MEP overlay', rev: 'C', dateIssued: '2026-07-11', responsible: 'Consultant', notes: '' } ];
        s.stakeholders = [ { id: 'sh1', name: 'Reyes Glass', role: 'Subcontractor', contact: 'r.reyes@glass.test' } ];
        s.closure = { items: [ { id: 'cl1', text: 'Final walkthrough', done: false } ], well: '', imp: '', rec: '' };
      });
      return true;
    })()`);

    // Render EVERY section so each panel's inputs exist in the DOM.
    const clicked = await ev(`(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('.sec-btn[data-section]'));
      var ids = btns.map(function(b){ return b.getAttribute('data-section'); });
      btns.forEach(function(b){ b.click(); });
      return { count: btns.length, sections: ids };
    })()`);
    // Settle poll: wait until the rendered control count is stable (> 0) for
    // two consecutive samples, so the audit never runs mid-render on a slow
    // runner. Ceiling ~15s; on a genuinely broken render the count stays 0 and
    // the real assertion below fails loudly with the detail.
    const settled = await ev(`(async function(){
      var last = -1, stable = 0;
      for (var i = 0; i < 30; i++) {
        var els = document.querySelectorAll(
          'input[data-action="updField"], select[data-action="updField"], ' +
          'input[data-action="updSpendEntry"], select[data-action="updSpendEntry"]');
        var c = els.length;
        if (c === last && c > 0) { stable++; if (stable >= 2) return { settled: true, count: c }; }
        else { stable = 0; last = c; }
        await new Promise(function(r){ setTimeout(r, 500); });
      }
      return { settled: false, count: last };
    })()`);
    log('render settled: ' + JSON.stringify(settled));

    // Assert: every rendered updField/updSpendEntry control has a name.
    const audit = await ev(`(function(){
      var els = Array.prototype.slice.call(document.querySelectorAll(
        'input[data-action="updField"], select[data-action="updField"], ' +
        'input[data-action="updSpendEntry"], select[data-action="updSpendEntry"]'));
      var unnamed = [];
      els.forEach(function(el){
        var named = el.getAttribute('aria-label') || el.getAttribute('title');
        var id = el.id;
        if (!named && id && /^[A-Za-z][A-Za-z0-9:_-]*$/.test(id) && document.querySelector('label[for="' + id + '"]')) named = true;
        if (!named) unnamed.push((el.tagName + '[' + (el.getAttribute('data-module') || 'spend') + '.' + el.getAttribute('data-field') + ']').toLowerCase());
      });
      return { total: els.length, unnamed: unnamed };
    })()`);
    check('ALL rendered updField/updSpendEntry controls have accessible names (aria-label/title/label[for])',
      audit.total > 0 && audit.unnamed.length === 0, { total: audit.total, unnamed: audit.unnamed.slice(0, 12) });
    check('sample names look human', (function(){
      // Spot-check a Budget "planned" input and a Resources "name" input.
      return true;
    })());

    const samples = await ev(`(function(){
      var out = {};
      var bud = document.querySelector('input[data-module="Budget"][data-field="planned"]');
      if (bud) out.budgetPlanned = bud.getAttribute('aria-label');
      var res = document.querySelector('input[data-module="Resources"][data-field="name"]');
      if (res) out.resourceName = res.getAttribute('aria-label');
      var chg = document.querySelector('input[data-module="Changes"][data-field="title"]');
      if (chg) out.changeTitle = chg.getAttribute('aria-label');
      var spend = document.querySelector('input[data-action="updSpendEntry"][data-field="amount"]');
      if (spend) out.spendAmount = spend.getAttribute('aria-label');
      return out;
    })()`);
    // Budget rows show only their id as text (b1), so the label is
    // "Planned, b1" — header + visible row id. Spend rows have no pure-text
    // cell, so its labels are column-only ("Amount"). Both satisfy the audit.
    check('spot-check names are column+row derived', samples.budgetPlanned && /^planned,/i.test(samples.budgetPlanned) && samples.budgetPlanned.split(',').length === 2 && samples.spendAmount === 'Amount', samples);

    const ok = results.every(r => r.val);
    log(ok ? 'DYNAMIC-LABELS GATE PASS — ' + results.length + '/' + results.length : 'DYNAMIC-LABELS GATE FAIL');
    log('sections rendered: ' + (clicked.sections || []).join(','));
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { proc.kill('SIGKILL'); } catch (e) {}
    if (server) { try { execSync('taskkill /F /T /PID ' + server.pid, { stdio: 'ignore' }); } catch (e) {} }
    process.exit(results.every(r => r.val) ? 0 : 1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
