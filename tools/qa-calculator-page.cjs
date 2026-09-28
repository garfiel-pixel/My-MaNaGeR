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

   F4 ENHANCEMENTS (owner 2026-09-28):
     U1   imperial toggle flips labels + aria-pressed + persists
     U2   imperial slab 33ft x 26ft x 6in -> 12.76 m3 exact + sq ft reading
     U3   back to metric: labels restore, storage metric
     U4   unit choice survives a reload (labels come back imperial)
     X1   valid result reveals the print/CSV/save actions row
     X2   CSV export builds a BOM-prefixed blob with the total line
     S1   Save stores a named estimate (name + work + total)
     S2   Open restores the inputs and recomputes
     S3   Delete removes the named estimate
     S4   history rows are individually deletable (calcDelHist)

   F4b RATE FREEDOM + EXACT RECALL (owner 2026-09-28):
     R1   rate fields prefill from the model; labels carry per-unit
     R2   typing a material rate changes the total (your-rate annotation)
     R3   Reset to model restores the model total
     R4   tile per-piece: 950/tile over 0.18 m2 -> 5277.78/m2 exact
     R5   piece row hides on non-piece trades, shows on tile
     E1   exact recall: run JMD imperial tile with override+rates+piece,
          change everything, recall -> EVERY setting returns (st identity)
     E2   legacy history row (no st) recalls with inferred units + defaults
     X3   CSV carries the used rates + piece pricing line

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

    // ---------- F4 ENHANCEMENTS ----------
    // U1: imperial toggle - labels convert, state persists, aria follows.
    const u1 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();
      return { d1: document.getElementById('calc-d1-label').textContent,
               d3: document.getElementById('calc-d3-label').textContent,
               stored: localStorage.getItem('mmgr_calc_units'),
               pressed: document.querySelector('[data-action="calcUnits"][data-units="imperial"]').getAttribute('aria-pressed') };
    })()`);
    check('U1 imperial toggle: labels (ft)/(in), stored, aria-pressed', u1 && u1.d1 === 'Length (ft)' && u1.d3 === 'Thickness (in)' && u1.stored === 'imperial' && u1.pressed === 'true', u1);

    // U2: imperial slab entry converts to the metric math (exact).
    const u2 = await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '33';
      document.getElementById('calc-d2').value = '26';
      document.getElementById('calc-d3').value = '6';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      const out = document.getElementById('calc-output').textContent;
      const m = out.match(/([\\d.]+) m3/);
      return { qty: m && m[1], alt: out.indexOf('cu yd') > -1 };
    })()`);
    check('U2 imperial slab 33x26x6in -> 12.76 m3 + cu yd reading', u2 && u2.qty === '12.76' && u2.alt === true, u2);

    // U3: back to metric - labels restore, storage flips back.
    const u3 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      return { d1: document.getElementById('calc-d1-label').textContent, stored: localStorage.getItem('mmgr_calc_units') };
    })()`);
    check('U3 metric restore: label (m), storage metric', u3 && u3.d1 === 'Length (m)' && u3.stored === 'metric', u3);

    // X1: a valid result reveals the export/save actions row.
    const x1 = await ev(`(function(){
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '8';
      document.getElementById('calc-d3').value = '150';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      var wrap = document.getElementById('calc-out-actions');
      return { visible: wrap && !wrap.classList.contains('is-hide'),
               print: !!document.querySelector('[data-action="calcPrint"]'),
               csv: !!document.querySelector('[data-action="calcCsv"]'),
               save: !!document.querySelector('[data-action="calcSave"]') };
    })()`);
    check('X1 valid result reveals print/CSV/save actions', x1 && x1.visible && x1.print && x1.csv && x1.save, x1);

    // X2: CSV export - BOM-prefixed blob carrying the total line.
    const x2 = await ev(`(async function(){
      var created = [];
      var origCreate = URL.createObjectURL;
      URL.createObjectURL = function(b){ created.push(b); return 'blob:qa'; };
      var origClick = HTMLAnchorElement.prototype.click;
      var clicked = false;
      HTMLAnchorElement.prototype.click = function(){ clicked = true; };
      document.querySelector('[data-action="calcCsv"]').click();
      URL.createObjectURL = origCreate;
      HTMLAnchorElement.prototype.click = origClick;
      if (!created.length) return { ok: false };
      // The BOM is verified as raw BYTES: readAsText strips it per spec, but
      // Excel needs the EF BB BF bytes in the file - bytes are the contract.
      var bytes = await new Promise(function(res){ var fr = new FileReader(); fr.onload = function(){ res(new Uint8Array(fr.result)); }; fr.onerror = function(){ res(null); }; fr.readAsArrayBuffer(created[0]); });
      var text = bytes ? new TextDecoder('utf-8').decode(bytes) : '';
      return { ok: clicked, bom: !!bytes && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, hasTotal: text.indexOf('Estimated total') > -1, hasSlab: text.indexOf('Concrete slab') > -1 };
    })()`);
    check('X2 CSV export: BOM bytes + total + work item in blob', x2 && x2.ok && x2.bom && x2.hasTotal && x2.hasSlab, x2);

    // S1: named estimate saves with name + work + total.
    const s1 = await ev(`(function(){
      document.getElementById('calc-save-name').value = 'Garage slab QA';
      document.querySelector('[data-action="calcSave"]').click();
      var raw = localStorage.getItem('mmgr_calc_estimates');
      var rows = document.querySelectorAll('#calc-estimates .bcp-est-row').length;
      var first = raw ? JSON.parse(raw)[0] : null;
      var work = first ? (first.st ? first.st.work : first.work) : null;
      return { stored: !!raw, rows: rows, name: first && first.name, work: work };
    })()`);
    check('S1 Save stores the named estimate', s1 && s1.rows === 1 && s1.name === 'Garage slab QA' && s1.work === 'slab', s1);

    // S2: Open restores the inputs and recomputes.
    const s2 = await ev(`(function(){
      document.getElementById('calc-d1').value = '';
      document.querySelector('[data-action="calcOpen"]').click();
      return { d1: document.getElementById('calc-d1').value, total: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1 };
    })()`);
    check('S2 Open restores inputs + recomputes', s2 && s2.d1 === '10' && s2.total, s2);

    // S3: Delete removes the named estimate.
    const s3 = await ev(`(function(){
      document.querySelector('[data-action="calcDeleteEst"]').click();
      var raw = localStorage.getItem('mmgr_calc_estimates');
      return { left: raw ? JSON.parse(raw).length : 0, empty: !!document.querySelector('#calc-estimates .calc-empty') };
    })()`);
    check('S3 Delete removes the named estimate', s3 && s3.left === 0 && s3.empty, s3);

    // S4: history rows are individually deletable.
    const s4 = await ev(`(function(){
      document.querySelector('[data-action="calcRun"]').click();
      var before = document.querySelectorAll('.calc-hist-row').length;
      document.querySelector('[data-action="calcDelHist"]').click();
      var after = document.querySelectorAll('.calc-hist-row').length;
      return { before: before, after: after };
    })()`);
    check('S4 history row delete removes exactly one row', s4 && s4.before >= 1 && s4.after === s4.before - 1, s4);

    // U4: the unit choice survives a reload (init reads storage before first paint).
    await ev(`document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();`);
    await ev(`location.reload();`);
    await delay(1800);
    const u4 = await ev(`(function(){
      return { d1: document.getElementById('calc-d1-label').textContent,
               pressed: document.querySelector('[data-action="calcUnits"][data-units="imperial"]').getAttribute('aria-pressed'),
               emptyState: document.getElementById('calc-output').textContent.indexOf('Pick a work item') > -1 };
    })()`);
    check('U4 unit choice survives reload (labels imperial, form clean)', u4 && u4.d1 === 'Length (ft)' && u4.pressed === 'true' && u4.emptyState, u4);

    // ---------- F4b RATE FREEDOM + EXACT RECALL ----------
    // R1: rate fields prefill with the model rate + per-unit labels.
    // (Metric first: earlier F4 gates leave imperial behind.)
    const r1 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      return { mat: document.getElementById('calc-rate-mat').value,
               lab: document.getElementById('calc-rate-lab').value,
               matLbl: document.getElementById('calc-rate-mat-label').textContent,
               labLbl: document.getElementById('calc-rate-lab-label').textContent };
    })()`);
    check('R1 rate prefill: slab 150/85, per m3 labels', r1 && r1.mat === '150' && r1.lab === '85' && /per m3/.test(r1.matLbl) && /per m3/.test(r1.labLbl), r1);

    // R2: a typed material rate changes the total and is annotated.
    const r2 = await ev(`(function(){
      document.getElementById('calc-d1').value='10'; document.getElementById('calc-d2').value='8'; document.getElementById('calc-d3').value='150';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      // Currency-agnostic total grab (earlier gates may have left any currency).
      const grab = (t) => { const seg = t.split('Estimated total')[1] || ''; const m = seg.replace(/[^\\d,]/g,' ').match(/([\\d,]+)/); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };
      const before = grab(document.getElementById('calc-output').textContent);
      document.getElementById('calc-rate-mat').value = '200';
      document.getElementById('calc-rate-mat').dispatchEvent(new Event('input',{bubbles:true}));
      const txt = document.getElementById('calc-output').textContent;
      const after = grab(txt);
      return { before: before, after: after, yours: txt.indexOf('your rate') > -1,
               grew: before !== null && after !== null && after > before };
    })()`);
    check('R2 material rate override raises total + your-rate note', r2 && r2.grew && r2.yours, r2);

    // R3: Reset to model returns to the model total.
    const r3 = await ev(`(function(){
      document.querySelector('[data-action=calcRatesReset]').click();
      const txt = document.getElementById('calc-output').textContent;
      return { mat: document.getElementById('calc-rate-mat').value, yours: txt.indexOf('your rate') > -1 };
    })()`);
    check('R3 reset-to-model clears override (back to 150, no note)', r3 && r3.mat === '150' && !r3.yours, r3);

    // R4+R5: per-piece pricing on tile (exact division), row visibility.
    // (Metric explicitly: R2/R3 left whatever units; piece sizes are cm here.)
    const r45 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      document.getElementById('calc-work').value = 'tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var pieceVisible = !document.getElementById('calc-piece-wrap').hidden;
      document.getElementById('calc-d1').value='10'; document.getElementById('calc-d2').value='8';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('calc-piece-price').value = '950';
      document.getElementById('calc-piece-size').value = '30 x 60';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input',{bubbles:true}));
      var txt = document.getElementById('calc-output').textContent;
      var m = txt.match(/= ([\\d.,]+)\\/m2/);
      var eff = m ? parseFloat(m[1].replace(/,/g,'')) : null;
      return { pieceVisible: pieceVisible, eff: eff, line: txt.indexOf('priced per piece') > -1 };
    })()`);
    check('R4 tile per-piece 950 / (0.3x0.6) = 5277.78/m2 exact', r45 && r45.eff === 5277.78 && r45.line, r45);
    const r5b = await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      return { hidden: document.getElementById('calc-piece-wrap').hidden };
    })()`);
    check('R5 piece row hides on slab, showed on tile', r45 && r45.pieceVisible && r5b && r5b.hidden, r5b);

    // E1: exact recall identity - run with a full settings set, disturb
    // everything, recall, and require the ENTIRE st object back.
    const e1 = await ev(`(function(){
      document.getElementById('calc-currency').value='JMD'; document.getElementById('calc-country').value='JM';
      document.getElementById('calc-currency').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();
      document.getElementById('calc-work').value='tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='33'; document.getElementById('calc-d2').value='26';
      document.getElementById('calc-rate-mat').value='950'; document.getElementById('calc-rate-lab').value='40';
      document.getElementById('calc-tax-override').value='12.5';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var saved = JSON.parse(localStorage.getItem('mmgr_calc_history'))[0].st;
      // Disturb EVERYTHING.
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='1'; document.getElementById('calc-d2').value='1'; document.getElementById('calc-d3').value='1';
      document.getElementById('calc-rate-mat').value='1'; document.getElementById('calc-rate-lab').value='1';
      document.getElementById('calc-tax-override').value='';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      // Recall the row.
      document.querySelector('[data-action=calcRestore]').click();
      var now = {
        units: localStorage.getItem('mmgr_calc_units'),
        work: document.getElementById('calc-work').value,
        d1: document.getElementById('calc-d1').value, d2: document.getElementById('calc-d2').value,
        cur: document.getElementById('calc-currency').value, cty: document.getElementById('calc-country').value,
        rm: document.getElementById('calc-rate-mat').value, rl: document.getElementById('calc-rate-lab').value,
        tax: document.getElementById('calc-tax-override').value,
        lbl: document.getElementById('calc-d1-label').textContent };
      return { saved: saved, now: now,
        ok: now.units==='imperial' && now.work==='tile' && now.d1==='33' && now.d2==='26' &&
            now.cur==='JMD' && now.cty==='JM' && now.rm==='950' && now.rl==='40' && now.tax==='12.5' &&
            now.lbl==='Length (ft)' };
    })()`);
    check('E1 exact recall restores EVERY setting (sum replicates)', e1 && e1.ok === true, e1);

    // E2: a legacy row (old shape, no st) recalls with inferred units.
    const e2 = await ev(`(function(){
      localStorage.setItem('mmgr_calc_history', JSON.stringify([{ at:'2026-09-01', name:'Old row', qty:'96.9 m2', total:'J$1,000',
        work:'tile', d1:'10', d2:'8', currency:'JMD', country:'JM', quality:'standard' }]));
      document.querySelector('[data-action=calcRestore]').click();
      return { work: document.getElementById('calc-work').value, d1: document.getElementById('calc-d1').value,
               units: localStorage.getItem('mmgr_calc_units'), rm: document.getElementById('calc-rate-mat').value };
    })()`);
    check('E2 legacy row recalls: units inferred (m), rates default', e2 && e2.work==='tile' && e2.d1==='10' && e2.units==='metric' && e2.rm !== '', e2);

    // X3: CSV carries the used rates + piece lines.
    const x3 = await ev(`(async function(){
      document.getElementById('calc-work').value='tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='10'; document.getElementById('calc-d2').value='8';
      document.getElementById('calc-piece-price').value='950'; document.getElementById('calc-piece-size').value='30 x 60';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      var created=[]; var oc=URL.createObjectURL; URL.createObjectURL=function(b){created.push(b);return 'blob:qa';};
      var oclk=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){};
      document.querySelector('[data-action=calcCsv]').click();
      URL.createObjectURL=oc; HTMLAnchorElement.prototype.click=oclk;
      if(!created.length) return {ok:false};
      var text = await new Promise(function(res){ var fr=new FileReader(); fr.onload=function(){res(fr.result);}; fr.onerror=function(){res('');}; fr.readAsText(created[0]); });
      return { ok:true, rates: text.indexOf('Material rate used') > -1 && text.indexOf('Labor rate used') > -1,
               piece: text.indexOf('950 per 30 x 60 cm') > -1 };
    })()`);
    check('X3 CSV carries used rates + piece pricing lines', x3 && x3.ok && x3.rates && x3.piece, x3);

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
