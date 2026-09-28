/* ============================================================
   qa-calculator-page.cjs - T1 browser gate (owner 2026-09-28)
   ------------------------------------------------------------
   Two waves in one harness against serve.cjs + headless Chrome:

   PARALLEL-AWARE ASSISTANT (seeded project state):
     PL1  in-progress task with ready peer -> kickoff nudge notice
     PL2  nudge names the peer + shared window
     PL3  same-assignee peers -> crew-split advice in the text
     PL4  cluster: >=3 independent same-day starts -> one summary
     PL5  dependent same-day starts -> NO cluster notice
     PL6  severity classes render with the right dot tier
     PL7  notices dedupe across runs (no chatter)

   BUILD COST CALCULATOR (calculator.html):
     C1   slab 10 x 8 x 150mm -> 12.6 m3 (5% waste) exact
     C2   money math: mat+lab+tax = total (tax from JM 15%)
     C3   custom tax override replaces the country rate
     C4   rebar 50 m3 -> 4.25 t at 85 kg/m3
     C5   missing thickness -> inline error, no crash
     C6   history saves after Calculate (localStorage)
     C7   Recall restores the inputs + recomputes
     C8   Clear history empties the list and storage
     C9   dark-mode toggle persists to localStorage

   Usage:  node tools/qa-calculator-page.cjs   (needs serve.cjs on :8765)
   Registry: CI-TEST-COVERAGE.md -> CI row (fast, serve.cjs battery).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const PORT = 8765;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();
const log = (s) => process.stdout.write('[calc-page] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val: !!val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))); };

function chromePath() { return require('./chrome-launcher.cjs').chromePath; }
async function withChrome(fn) {
  const userDir = path.join(TMP, 'chrome-calc-' + Date.now());
  const port = 9347;
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
    const pending = new Map(); let id = 0;
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
    const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, m => res(m.result || {})); ws.send(JSON.stringify({ id: mid, method, params })); });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) { log('EVAL EXCEPTION: ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
      return r && r.result && r.result.value;
    };
    await send('Page.enable');
    await fn({ ev });
  } finally { try { chrome.kill(); } catch (e) {} }
}

(async function main() {
  // serve.cjs must be running (the CI serve battery starts it; locally start if absent)
  let served = false;
  try { const h = await fetch(BASE + '/calculator.html'); served = h.ok; } catch (e) {}
  if (!served) {
    log('serve.cjs not answering - starting one for this run');
    const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore', detached: false });
    for (let i = 0; i < 30; i++) { await delay(1000); try { const h = await fetch(BASE + '/calculator.html'); if (h.ok) { served = true; break; } } catch (e) {} }
    var startedHere = srv;
  }
  if (!served) { log('FATAL: serve.cjs did not come up'); process.exit(1); }

  await withChrome(async ({ ev }) => {
    // ---------- CALCULATOR PAGE ----------
    await ev(`location.href = ${JSON.stringify(BASE + '/calculator.html')}`);
    await delay(1800);
    const booted = await ev(`!!document.getElementById('calc-work') && !!document.getElementById('calc-output')`);
    check('C0 calculator page boots with form + output', !!booted, booted);

    // C1+C2: slab 10x8x150mm, JMD, Jamaica 15% - exact quantities + money math.
    const c12 = await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '8';
      document.getElementById('calc-d3').value = '150';
      document.getElementById('calc-currency').value = 'JMD';
      document.getElementById('calc-country').value = 'JM';
      document.getElementById('calc-currency').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action="calcRun"]').click();
      const out = document.getElementById('calc-output').textContent;
      const qty = out.match(/([\\d.]+) m3/);
      const lines = out.match(/Estimated total([\\s\\S]*?)Planning-grade/);
      return { out: out, qty: qty && qty[1], hasTotal: out.indexOf('Estimated total') > -1, hasTax: out.indexOf('15%') > -1 };
    })()`);
    check('C1 slab 10x8x150 -> 12.6 m3 (5% waste, exact)', c12 && c12.qty === '12.6', c12 && c12.qty);
    check('C2 breakdown carries tax 15% line + total', c12 && c12.hasTax && c12.hasTotal, c12 && { tax: c12.hasTax, total: c12.hasTotal });
    // money invariant: mat+lab+tax == total (labels may carry annotations
    // between the name and the amount, e.g. 'Tax (15%)' - skip to the currency)
    const money = await ev(`(function(){
      const txt = document.getElementById('calc-output').textContent;
      const grab = (label) => { const m = txt.match(new RegExp(label + '[^\\\\d]*\\\\$?\\\\s*[A-Z\\\\$\\u00A3\\u20AC]*\\$?([\\\\d,]+)')); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };
      const grab2 = (label) => { const m = txt.match(new RegExp(label + '[\\\\s\\\\S]*?J\\\\$([\\\\d,]+)')); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };
      const mat = grab2('Materials'), lab = grab2('Labor'), tax = grab2('Tax'), tot = grab2('Estimated total');
      return { mat, lab, tax, tot, sums: (mat!==null && lab!==null && tax!==null && tot!==null) ? (mat+lab+tax)===tot : false };
    })()`);
    check('C2b money invariant mat+lab+tax = total', money && money.sums === true, money);

    // C3: custom override replaces the country rate.
    const c3 = await ev(`(function(){
      document.getElementById('calc-tax-override').value = '8.25';
      document.getElementById('calc-tax-override').dispatchEvent(new Event('input',{bubbles:true}));
      const txt = document.getElementById('calc-output').textContent;
      return { has825: txt.indexOf('8.25%') > -1, hasYourRate: txt.indexOf('your rate') > -1, has15: txt.indexOf('Tax (15%') > -1 };
    })()`);
    check('C3 custom tax override (8.25%) replaces JM 15%', c3 && c3.has825 && c3.hasYourRate && !c3.has15, c3);

    // C4: rebar volume -> tonnage.
    const c4 = await ev(`(function(){
      document.getElementById('calc-tax-override').value = '';
      document.getElementById('calc-work').value = 'rebar';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '50';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      const out = document.getElementById('calc-output').textContent;
      const m = out.match(/([\\d.]+) t/);
      return { qty: m && m[1] };
    })()`);
    check('C4 rebar 50 m3 -> 4.25 t (85 kg/m3, exact)', c4 && c4.qty === '4.25', c4 && c4.qty);

    // C5: missing depth -> honest inline error (clear leftovers first).
    const c5 = await ev(`(function(){
      document.getElementById('calc-d2').value = '';
      document.getElementById('calc-d3').value = '';
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      return { err: document.getElementById('calc-output').textContent.indexOf('Enter the dimensions') > -1 };
    })()`);
    check('C5 missing dimensions -> inline guidance, no crash', c5 && c5.err === true, c5);

    // C6: history saved after a successful Calculate.
    const c6 = await ev(`(function(){
      document.getElementById('calc-d2').value = '8';
      document.getElementById('calc-d3').value = '150';
      document.querySelector('[data-action="calcRun"]').click();
      const raw = localStorage.getItem('mmgr_calc_history');
      const rows = document.querySelectorAll('.calc-hist-row').length;
      return { stored: !!raw, rows: rows, first: raw ? JSON.parse(raw)[0].name : null };
    })()`);
    check('C6 Calculate saves to device history', c6 && c6.stored && c6.rows >= 1, c6);

    // C7: Recall restores inputs.
    const c7 = await ev(`(function(){
      document.getElementById('calc-d1').value = '';
      document.querySelector('[data-action="calcRestore"]').click();
      return { d1: document.getElementById('calc-d1').value, work: document.getElementById('calc-work').value,
               out: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1 };
    })()`);
    check('C7 Recall restores inputs + recomputes', c7 && c7.d1 === '10' && c7.work === 'slab' && c7.out, c7);

    // C8: clear history.
    const c8 = await ev(`(function(){
      document.querySelector('[data-action="calcClearHistory"]').click();
      return { stored: !!localStorage.getItem('mmgr_calc_history'), empty: !!document.querySelector('.calc-hist .calc-empty') };
    })()`);
    check('C8 Clear history empties storage + list', c8 && !c8.stored && c8.empty, c8);

    // C9: theme toggle persists.
    const c9 = await ev(`(function(){
      document.querySelector('[data-action="tglTheme"]').click();
      const dark = document.body.classList.contains('dark-mode');
      const saved = localStorage.getItem('mmgr_theme');
      document.querySelector('[data-action="tglTheme"]').click();
      return { dark: dark, saved: saved, backLight: !document.body.classList.contains('dark-mode') };
    })()`);
    check('C9 theme toggle flips + persists', c9 && c9.dark && c9.saved === 'dark' && c9.backLight, c9);

    // ---------- PARALLEL-AWARE ASSISTANT (seeded project state) ----------
    // Seed through the served app bundle on project.html (locally-owned gate).
    await ev(`location.href = ${JSON.stringify(BASE + '/app.html')}`);
    await delay(2000);
    await ev(`(function(){
      localStorage.clear();
      localStorage.setItem('mmgr_admin_projects', JSON.stringify([{ id: 'parqa', name: 'Parallel QA', file: 'project.html?id=parqa' }]));
      localStorage.setItem('mmgr_current_project', 'parqa');
      return true;
    })()`);
    await ev(`location.href = ${JSON.stringify(BASE + '/project.html?id=parqa')}`);
    await delay(3200);
    const appBooted = await ev(`!!(window.MMGR && MMGR.Watch && MMGR.State)`);
    check('PL0 project booted with Watch module', !!appBooted, appBooted);
    // The assistant is signed-in-gated (Entitlements seam). Harness stubs the
    // seam exactly like the other watchers harnesses do.
    await ev(`(function(){ if (MMGR.Entitlements) { MMGR.Entitlements.aiAssistant = function(){ return true; }; } return !!(MMGR.Entitlements); })()`);

    // PL1-PL3: kickoff nudge with crew-split advice.
    const pl1 = await ev(`(function(){
      MMGR.State.updateState(function(s){
        s.tasks = [
          { id:'pa', name:'Slab pour A', status:'inprogress', startDate:'2026-09-28', endDate:'2026-10-02', duration:'5', assignee:'Crew One', critical:false, leadTime:false, predecessors:[], notes:'', weatherSensitive:false },
          { id:'pb', name:'Blockwork B', status:'todo', startDate:'2026-09-28', endDate:'2026-10-01', duration:'4', assignee:'Crew One', critical:false, leadTime:false, predecessors:[], notes:'', weatherSensitive:false },
          { id:'pc', name:'Solo task C', status:'todo', startDate:'2026-11-02', endDate:'2026-11-04', duration:'3', assignee:'Crew Two', critical:false, leadTime:false, predecessors:[], notes:'', weatherSensitive:false }
        ];
        s.aiInbox = [];
      });
      MMGR.Watch.run();
      const inbox = MMGR.State.getState().aiInbox || [];
      const par = inbox.filter(n => n.kind === 'parallel');
      return { count: par.length, text: par.length ? par[0].text : null,
               crew: par.length ? par[0].text.indexOf('Crew One') > -1 && par[0].text.indexOf('split the crew') > -1 : false,
               namesPeer: par.length ? par[0].text.indexOf('Blockwork B') > -1 && par[0].text.indexOf('Slab pour A') > -1 : false };
    })()`);
    check('PL1 kickoff nudge fires for in-progress + ready peer', pl1 && pl1.count >= 1, pl1 && pl1.count);
    check('PL2 nudge names both tasks + shared window', pl1 && pl1.namesPeer, pl1 && pl1.text);
    check('PL3 same-assignee -> crew-split advice', pl1 && pl1.crew, pl1 && pl1.text);

    // PL4: cluster summary for >=3 independent same-day starts.
    const pl4 = await ev(`(function(){
      MMGR.State.updateState(function(s){
        s.tasks[1].status = 'inprogress'; s.tasks[0].status = 'todo';
        s.tasks.push(
          { id:'pd', name:'Fencing D', status:'todo', startDate:'2027-01-11', endDate:'2027-01-13', duration:'3', assignee:'Crew Three', critical:false, leadTime:false, predecessors:[], notes:'', weatherSensitive:false },
          { id:'pe', name:'Painting E', status:'todo', startDate:'2027-01-11', endDate:'2027-01-14', duration:'4', assignee:'Crew Four', critical:false, leadTime:false, predecessors:[], notes:'', weatherSensitive:false },
          { id:'pf', name:'Tiling F', status:'todo', startDate:'2027-01-11', endDate:'2027-01-15', duration:'5', assignee:'Crew Five', critical:false, leadTime:false, predecessors:[], notes:'', weatherSensitive:false }
        );
        s.aiInbox = [];
      });
      MMGR.Watch.run();
      const par = (MMGR.State.getState().aiInbox || []).filter(n => n.kind === 'parallel');
      const cluster = par.find(n => n.text.indexOf('start together on 2027-01-11') > -1);
      return { cluster: !!cluster, text: cluster ? cluster.text : null, count3: cluster ? cluster.text.indexOf('3 tasks') > -1 : false };
    })()`);
    check('PL4 cluster summary fires for 3 independent same-day starts', pl4 && pl4.cluster && pl4.count3, pl4 && pl4.text);

    // PL5: a dependency inside the group kills the cluster notice.
    const pl5 = await ev(`(function(){
      MMGR.State.updateState(function(s){
        const f = s.tasks.find(t => t.id === 'pf'); f.predecessors = ['pd'];
        s.aiInbox = [];
      });
      MMGR.Watch.run();
      const par = (MMGR.State.getState().aiInbox || []).filter(n => n.kind === 'parallel' && n.text.indexOf('2027-01-11') > -1);
      return { gone: par.filter(n => n.text.indexOf('start together') > -1).length === 0 };
    })()`);
    check('PL5 dependent group -> no cluster notice (correct refusal)', pl5 && pl5.gone === true, pl5);

    // PL6: severity dot classes render in the mailbox DOM.
    const pl6 = await ev(`(function(){
      MMGR.State.updateState(function(s){
        s.aiInbox = [
          { id:'n1', at:'2026-09-28T00:00:00.000Z', kind:'budget', severity:'caution', text:'Caution notice', read:false },
          { id:'n2', at:'2026-09-28T00:00:00.000Z', kind:'parallel', severity:'info', text:'Info notice', read:false },
          { id:'n3', at:'2026-09-28T00:00:00.000Z', kind:'leadtime', severity:'attention', text:'Attention notice', read:false }
        ];
      });
      MMGR.Watch.openMailbox();
      const box = document.getElementById('ai-mailbox');
      const rows = box.querySelectorAll('.ai-note');
      return {
        caution: box.querySelectorAll('.ai-note-caution').length === 1,
        info: box.querySelectorAll('.ai-note-info').length === 1,
        hot: box.querySelectorAll('.ai-note-hot').length === 1,
        dots: box.querySelectorAll('.ai-sev-dot').length === 3,
        legacyKept: rows.length === 3
      };
    })()`);
    check('PL6 severity classes + dots render (caution/info/attention)', pl6 && pl6.caution && pl6.info && pl6.hot && pl6.dots && pl6.legacyKept, pl6);

    // PL7: dedupe - rerun does not duplicate parallel notices.
    const pl7 = await ev(`(function(){
      MMGR.State.updateState(function(s){ s.aiInbox = []; });
      MMGR.Watch.run(); MMGR.Watch.run();
      const par = (MMGR.State.getState().aiInbox || []).filter(n => n.kind === 'parallel');
      return { unique: par.length === new Set(par.map(n => n.text)).size, total: par.length };
    })()`);
    check('PL7 rerun dedupes parallel notices', pl7 && pl7.unique === true, pl7 && pl7.total);
  });

  if (startedHere) { try { startedHere.kill(); } catch (e) {} }
  const passed = results.filter(r => r.val).length;
  log(passed + '/' + results.length + ' gates passed');
  process.exit(passed === results.length ? 0 : 1);
})();
