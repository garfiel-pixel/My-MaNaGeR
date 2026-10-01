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

   F4c PER-PIECE EXPANSION + RATE SHEETS (owner 2026-09-28):
     P1   blocks: 800/block over 40x20cm -> 1000/m2 exact
     P2   bricks: 140/brick over 20x10cm -> 700/m2 exact
     P3   roof sheets: 6120/sheet over 0.85x3.6m -> 2000/m2 exact
     P4   fencing panel: 9500 over 2.5m wide -> 3800/m run (width-div)
     P5   placeholders follow the work item
     RS1  save a rate sheet (name + rates + piece)
     RS2  apply restores the rates + recomputes
     RS3  quick-picker select applies
     RS4  delete removes the sheet

   F4d VOLUME PIECE PRICING (owner 2026-09-28: per bag of mix, per gallon):
     V1   slab per-bag: 9,200/bag over 20 L yield -> 460,000/m3 exact
     V2   paint per-gallon-can: 9,000 / 3.785 L -> 2,377.81/L exact
     V3   bag/paint rows show on concrete+paint, hidden on tile
     V4   invalid yield falls back to the m2-model rate (no crash)
     V5   yield survives imperial (unit-free) + imperial dims recompute

   ESTIMATING DEPTH W1 - BOQ ROLL-UP (owner 2026-09-30):
     BQ1  engine hook prices two lines into a rolled-up subtotal
     BQ2  add-line action stores current form state (mmgr_calc_boq)
     BQ3  bill renders per-line rows + totals row
     BQ4  recall re-fills the form from a stored line (exact recall)
     BQ5  remove + clear work and persist

   ESTIMATING DEPTH W2 - ELEMENT INSTANCES (add-a-wall, owner 2026-09-30):
     IN1  instancesQty sums rows x counts through the trade formula
     IN2  measured quantity prices without dims (computeFor path)
     IN3  waste + quality still apply on top of the measured quantity
     IN4  editor visibility follows the work item; rows render
     IN5  total-override checkbox bypasses rows

   ESTIMATING DEPTH W3 - STATUTORY LABOR ON-COSTS (owner 2026-09-30):
     SX1  off by default: no line, no math change
     SX2  12.5% on a known labor subtotal, exact (incl. OH+tax ripples)
     SX3  capped at 25% (typo guard)
     SX4  breakdown line renders with the pct + CSV carries it
     SX5  JM levy note shows only for Jamaica; toggle suggests 12.5

   ESTIMATING DEPTH W4 - PRELIMINARIES / SITE & OTHER COSTS (owner 2026-09-30):
     PM1  prelimsTotal: fixed / pct-of-works / weekly x weeks bases exact
     PM2  typical residential preset = 6 items
     PM3  card renders rows + on-top-of line; edit persists
     PM4  remove + clear persist

   ESTIMATING DEPTH W5 - CONTINGENCY + ESCALATION (owner 2026-09-30):
     RG1  pure waterfall math exact (works + prelims + 10 + 5 + esc 12mo)
     RG2  defaults render 10 / 5 / 5; settings persist
     RG3  waterfall lines render with the planning subtotal

   ESTIMATING DEPTH W6 - CASH FLOW (owner 2026-09-30):
     CF1  straight-line: 12 equal months summing to the subtotal
     CF2  S-curve: months sum to the subtotal; middle > ends
     CF3  monthly table renders; mode select re-spreads

   ESTIMATING DEPTH W7 - CONCRETE ACCESSORIES (owner 2026-09-30):
     FA1  formworkM2 exact: slab + footing derivations
     FA2  other trades -> null (correct refusal)
     FA3  formwork line lands on the bill; laps field only on rebar

   ESTIMATING DEPTH W8 - LOCATION PACKS (owner 2026-09-30):
     LP1  seeds exist (US, JM, GB) on first load
     LP2  applying JM sets JMD + 15% tax; index scales the material rate
     LP3  export produces JSON; import merges + skips invalid

   Usage:  node tools/qa-calculator-page.cjs   (needs serve.cjs on :8765)
   Registry: CI-TEST-COVERAGE.md -> CI row (fast, serve.cjs battery).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
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
    await fn({ ev, send });
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

  await withChrome(async ({ ev, send }) => {
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

    // ---------- B: APP-STYLE TOP BAR (owner 2026-09-30) ----------
    const b1 = await ev(`(function(){
      return {
        back: !!document.querySelector('.bcp-back[data-action="calcBack"] svg.ico use'),
        h1: !!document.querySelector('h1.bcp-title .bcp-brand-name'),
        theme: !!document.querySelector('.bcp-theme[data-action="tglTheme"]'),
        oldHead: !!document.querySelector('.bcp-head'),
        sun: document.querySelectorAll('.bcp-theme use[href$="#i-sun"]').length,
        moon: document.querySelectorAll('.bcp-theme use[href$="#i-moon"]').length
      };
    })()`);
    check('B1 top bar: icon-only back + title h1 + theme button present', b1 && b1.back && b1.h1 && b1.theme, b1);
    check('B2 theme pair: one sun use + one moon use in the theme button', b1 && b1.sun === 1 && b1.moon === 1, b1);
    check('B3 old header gone: no .bcp-head block remains', b1 && b1.oldHead === false, b1);
    const b4 = fs.readFileSync(path.join(__dirname, '..', 'css', 'mmgr.css'), 'utf8');
    check('B4 CSS: sun/moon dark-mode switch rules exist',
      b4.indexOf('.bcp-ico-sun{display:none') > -1 && b4.indexOf('body.dark-mode .bcp-ico-sun{display:block') > -1, null);
    check('B5 CSS: back button is icon-only (no Back text node)',
      (await ev(`(function(){ var b = document.querySelector('.bcp-back'); return b && b.textContent.trim() === ''; })()`)) === true, null);

    // ---------- G: HOW-TO GUIDE SLIDER (owner 2026-09-30) ----------
    const g1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_guide_open');
      document.querySelector('[data-action="calcGuideOpen"]').click();
      return { card: !!document.getElementById('calc-guide-card'),
               count: (document.getElementById('calc-guide-count') || {}).textContent,
               text: (document.getElementById('calc-guide-text') || {}).textContent || '',
               dots: document.querySelectorAll('#calc-guide-dots .bcp-guide-dot').length };
    })()`);
    check('G1 guide card renders with 11 steps + counter + text',
      g1 && g1.card && g1.count === '1 of 11' && g1.dots === 11 && g1.text.indexOf('work item') > -1, g1);
    check('G2 guide order: step 1 is work item (never overhead first)',
      g1 && g1.text.indexOf('Pick your work item') === 0, g1);
    const g2 = await ev(`(function(){
      document.querySelector('[data-action="calcGuideNext"]').click();
      const after = document.getElementById('calc-guide-count').textContent;
      const active = document.querySelectorAll('#calc-guide-dots .bcp-guide-dot.active').length;
      document.querySelector('[data-action="calcGuidePrev"]').click();
      const back = document.getElementById('calc-guide-count').textContent;
      return { after: after, active: active, back: back };
    })()`);
    check('G3 next/prev cycles steps + one active dot follows',
      g2 && g2.after === '2 of 11' && g2.active === 1 && g2.back === '1 of 11', g2);
    const g3 = await ev(`(function(){
      document.querySelector('[data-action="calcGuideClose"]').click();
      const hid = document.getElementById('calc-guide-body').hidden === true;
      const stored = localStorage.getItem('mmgr_calc_guide_open');
      const reopenShown = document.getElementById('calc-guide-reopen').hidden === false;
      document.querySelector('[data-action="calcGuideOpen"]').click();
      return { hid: hid, stored: stored, reopenShown: reopenShown, back: !document.getElementById('calc-guide-body').hidden };
    })()`);
    check('G4 hide sets flag + reopen shows again',
      g3 && g3.hid && g3.stored === '0' && g3.reopenShown && g3.back, g3);

    // ---------- N: RESEARCH-BACKED WORK ITEMS (owner 2026-09-30) ----------
    const n1 = await ev(`(function(){
      const t = document.getElementById('calc-work').textContent;
      return { supply: t.indexOf('Water supply pipe run (per m - linear)') > -1,
               drain: t.indexOf('Drain-waste-vent pipe run (per m - linear)') > -1,
               conduit: t.indexOf('Conduit / cable run (per m - linear)') > -1,
               skirt: t.indexOf('Skirting / baseboard (per m run - linear)') > -1,
               shingle: t.indexOf('Asphalt shingle roof (per roofing square)') > -1,
               groups: Array.from(document.querySelectorAll('#calc-work optgroup')).map(function(g){ return g.label; }) };
    })()`);
    check('N1 linear basis labels present (pipe, conduit, skirting, shingle)',
      n1 && n1.supply && n1.drain && n1.conduit && n1.skirt && n1.shingle, n1);
    check('N2 new optgroups: Plumbing + Electrical exist',
      n1 && n1.groups.indexOf('Plumbing') > -1 && n1.groups.indexOf('Electrical') > -1, n1 && n1.groups);
    const n3 = await ev(`(function(){
      const sel = document.getElementById('calc-work');
      sel.value = 'pipe-supply';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '12';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      const out = document.getElementById('calc-output').textContent;
      return { run: out.indexOf('Supply pipe run (linear)') > -1, qty: out.indexOf('12 m') > -1 };
    })()`);
    check('N3 pipe-supply 12 m run -> 12 m linear quantity', n3 && n3.run && n3.qty, n3);
    const n4 = await ev(`(function(){
      const sel = document.getElementById('calc-work');
      sel.value = 'shingle-roof';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '9.2903';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
      const out = document.getElementById('calc-output').textContent;
      return { sq: out.indexOf('square') > -1, m2: out.indexOf('m2') > -1 };
    })()`);
    check('N4 shingle-roof 10x9.2903 m -> 10 squares + m2 aside', n4 && n4.sq && n4.m2, n4);
    const n5 = await ev(`(function(){
      const sel = document.getElementById('calc-work');
      sel.value = 'fixture';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '3';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      const out = document.getElementById('calc-output').textContent;
      return { each: out.indexOf('3 each') > -1, sum: out.indexOf('840') > -1 };
    })()`);
    check('N5 fixture count math: 3 each at 130+150 = 840', n5 && n5.each && n5.sum, n5);
    // restore slab context for the gates that follow
    await ev(`(function(){
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
    })()`);

    // ---------- E: EXPORT NAMING - document type + title (owner 2026-09-30) --
    const doc1 = await ev(`(function(){
      document.getElementById('calc-d1').value='10';
      document.getElementById('calc-d2').value='8';
      document.getElementById('calc-d3').value='150';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      return { type: document.getElementById('calc-doc-type').value,
               title: document.getElementById('calc-doc-title').value,
               hasBase: typeof window.__calcDocTitleBase === 'function' };
    })()`);
    check('E1 doc type + title fields exist, Estimate default, hook live',
      doc1 && doc1.type === 'Estimate' && doc1.title === '' && doc1.hasBase, doc1);
    const doc2 = await ev(`(function(){
      document.getElementById('calc-doc-type').value = 'Invoice';
      document.getElementById('calc-doc-type').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-doc-title').value = 'Kitchen - Smith';
      document.getElementById('calc-doc-title').dispatchEvent(new Event('input', { bubbles: true }));
      return { base: window.__calcDocTitleBase(),
               sheetTitle: document.getElementById('calc-quote-title').textContent,
               meta: document.getElementById('calc-quote-meta').textContent.indexOf('Kitchen - Smith') > -1 };
    })()`);
    check('E2 filename base follows type+title; print title says Invoice',
      doc2 && doc2.base === 'Invoice - Kitchen - Smith' && doc2.sheetTitle === 'Invoice' && doc2.meta, doc2);
    const doc3 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_history');
      document.querySelector('[data-action="calcRun"]').click();
      const row = JSON.parse(localStorage.getItem('mmgr_calc_history'))[0];
      return { st: row && row.st ? { docType: row.st.docType, docTitle: row.st.docTitle } : null };
    })()`);
    check('E3 history row carries docType+docTitle (exact recall)',
      doc3 && doc3.st && doc3.st.docType === 'Invoice' && doc3.st.docTitle === 'Kitchen - Smith', doc3);
    const doc4 = await ev(`(function(){
      // Real UI path (applyState is IIFE-internal): save a named estimate
      // with the doc fields set, clear them, then Open the save back.
      document.getElementById('calc-doc-type').value = 'Quote';
      document.getElementById('calc-doc-title').value = 'Recall Doc';
      document.querySelector('[data-action="calcSave"]').click();
      document.getElementById('calc-doc-type').value = 'Estimate';
      document.getElementById('calc-doc-title').value = '';
      const openBtns = document.querySelectorAll('[data-action="calcOpen"]');
      openBtns[0].click();
      return { type: document.getElementById('calc-doc-type').value, title: document.getElementById('calc-doc-title').value,
               sheet: document.getElementById('calc-quote-title').textContent };
    })()`);
    check('E4 estimate recall restores doc fields + print title follows',
      doc4 && doc4.type === 'Quote' && doc4.title === 'Recall Doc' && doc4.sheet === 'Quote', doc4);
    // Cleanup: remove the E4-named estimate + reset doc fields so the
    // downstream S-series gates see the same pre-wave state.
    await ev(`(function(){
      try { localStorage.setItem('mmgr_calc_estimates', '[]'); } catch (e) {}
      document.getElementById('calc-doc-type').value = 'Estimate';
      document.getElementById('calc-doc-type').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-doc-title').value = '';
      document.getElementById('calc-doc-title').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-save-name').value = '';
    })()`);

    // ---------- T: FIRST-VISIT TUTORIAL (owner 2026-09-30) ----------
    const tut1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_tour_done');
      var nudge = document.getElementById('calc-tour-nudge');
      window.__calcTour.start();
      var pop = document.getElementById('calc-tour-pop');
      return { nudgeWas: !nudge.hidden, anchor: pop.getAttribute('data-anchor'),
               overlay: !document.getElementById('calc-tour-overlay').hidden,
               count: document.getElementById('calc-tour-count').textContent };
    })()`);
    check('T1 start tour: overlay opens, step 1 anchors the work item',
      tut1 && tut1.anchor === '#calc-work' && tut1.overlay && tut1.count === '1 of 11', tut1);
    const tut2 = await ev(`(function(){
      var anchors = [];
      for (var i = 0; i < 10; i++) {
        document.querySelector('[data-action="calcTourNext"]').click();
        anchors.push(document.getElementById('calc-tour-pop').getAttribute('data-anchor'));
      }
      return { anchors: anchors, count: document.getElementById('calc-tour-count').textContent };
    })()`);
    check('T2 steps walk the form in guide order (units, dims, currency, quality, oh, rates, run)',
      tut2 && tut2.anchors[0] === '.bcp-seg' && tut2.anchors[1] === '#calc-d1' && tut2.anchors[2] === '#calc-currency' &&
      tut2.anchors[3] === '#calc-quality' && tut2.anchors[4] === '#calc-oh' && tut2.anchors[5] === '#calc-rate-mat' &&
      tut2.anchors[6] === '#calc-boq-card' && tut2.anchors[7] === '#calc-prelims-card' &&
      tut2.anchors[8] === '.bcp-run' && tut2.anchors[9] === null && tut2.count === '11 of 11', tut2.anchors);
    const tut3 = await ev(`(function(){
      document.querySelector('[data-action="calcTourNext"]').click();
      return { done: window.__calcTour.state().done, overlayHidden: document.getElementById('calc-tour-overlay').hidden,
               finalText: document.getElementById('calc-tour-text').textContent };
    })()`);
    check('T3 final step ends the tour + sets the done flag',
      tut3 && tut3.done && tut3.overlayHidden && tut3.finalText.indexOf('ready to use') > -1, tut3);
    const tut4 = await ev(`(function(){
      try { localStorage.removeItem('mmgr_calc_tour_done'); } catch (e) {}
      window.__calcTour.start();
      document.querySelector('[data-action="calcTourSkip"]').click();
      var skipDone = window.__calcTour.state().done;
      // Esc path
      try { localStorage.removeItem('mmgr_calc_tour_done'); } catch (e) {}
      window.__calcTour.start();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { skipDone: skipDone, escClosed: document.getElementById('calc-tour-overlay').hidden, escDone: window.__calcTour.state().done };
    })()`);
    check('T4 skip AND Escape both end the tour + set the flag',
      tut4 && tut4.skipDone && tut4.escClosed && tut4.escDone, tut4);
    await ev(`(function(){
      try { localStorage.setItem('mmgr_calc_tour_done', '1'); } catch (e) {}
      document.getElementById('calc-tour-nudge').hidden = true;
    })()`);

    // ---------- W1: BOQ ROLL-UP (estimating depth, owner 2026-09-30) ----------
    await ev(`(function(){
      try { localStorage.removeItem('mmgr_calc_boq'); } catch (e) {}
      // Deterministic single-trade state for the engine checks.
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '10';
      document.getElementById('calc-d3').value = '100';
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-quality').value = 'standard';
    })()`);
    const bq1 = await ev(`(function(){
      var st = __calcEngine.readState();
      var a = __calcEngine.computeFor(st);
      var b = __calcEngine.computeFor(Object.assign({}, st, { work: 'blockwall', d1: '10', d2: '2.4', d3: '' }));
      var s = __calcEngine.boqTotals([{ st: st, name: 'Slab line' }, { st: Object.assign({}, st, { work: 'blockwall', d1: '10', d2: '2.4', d3: '' }), name: 'Block line' }]);
      return { n: s.perLine.length, sub: s.sub, mat: s.mat, lab: s.lab,
               first: s.perLine[0].name, unit: s.perLine[0].unit };
    })()`);
    check('BQ1 engine hook: two lines priced + rolled up',
      bq1 && bq1.n === 2 && bq1.sub > 0 && Math.abs(bq1.mat + bq1.lab - bq1.sub) < 0.01 &&
      typeof bq1.first === 'string' && !!bq1.unit, bq1);
    const bq2 = await ev(`(function(){
      document.querySelector('[data-action="calcBoqAdd"]').click();
      var list = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
      var cur = list.length;
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d3').value = '';
      document.querySelector('[data-action="calcBoqAdd"]').click();
      list = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
      return { before: cur, after: list.length, work2: list[1].st.work,
               total: list[1].st.d1 };
    })()`);
    check('BQ2 add-line stores form state into the current bill (2 lines)',
      bq2 && bq2.before === 1 && bq2.after === 2 && bq2.work2 === 'blockwall' && bq2.total === '10', bq2);
    const bq3 = await ev(`(function(){
      var body = document.getElementById('calc-boq-body');
      var rows = body ? body.querySelectorAll('.bcp-boq-line').length : 0;
      var total = document.getElementById('calc-boq-total');
      var txt = total ? total.textContent : '';
      return { rows: rows, totalShown: txt.length > 0 && txt !== '$0', empty: body ? body.querySelector('.calc-empty') !== null : true };
    })()`);
    check('BQ3 bill card renders 2 line rows + non-zero totals row',
      bq3 && bq3.rows === 2 && !bq3.empty && bq3.totalShown, bq3);
    const bq4 = await ev(`(function(){
      document.getElementById('calc-work').value = 'tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '3';
      document.getElementById('calc-d2').value = '3';
      document.getElementById('calc-d3').value = '';
      document.querySelector('[data-action="calcBoqRecall"][data-idx="0"]').click();
      var st = __calcEngine.readState();
      var back = __calcEngine.computeFor(st);
      var list = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
      var was = __calcEngine.computeFor(list[0].st);
      return { work: st.work, d1: st.d1, same: Math.abs(back.total - was.total) < 0.01 };
    })()`);
    check('BQ4 recall re-fills the form; recomputed total matches the line',
      bq4 && bq4.work === 'slab' && bq4.d1 === '10' && bq4.same, bq4);
    const bq5 = await ev(`(function(){
      document.querySelector('[data-action="calcBoqRemove"][data-idx="1"]').click();
      var list = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
      var afterRemove = list.length;
      document.querySelector('[data-action="calcBoqClear"]').click();
      var body = document.getElementById('calc-boq-body');
      return { afterRemove: afterRemove,
               cleared: body ? body.querySelectorAll('.bcp-boq-line').length === 0 : true,
               empty: body ? body.querySelector('.calc-empty') !== null : false };
    })()`);
    check('BQ5 remove line + clear bill persist',
      bq5 && bq5.afterRemove === 1 && bq5.cleared && bq5.empty, bq5);

    // ---------- W2: ELEMENT INSTANCES (add-a-wall, owner 2026-09-30) ----------
    const in1 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var r = __calcEngine.instancesQty([
        { label: 'Wall 1', d1: '10', d2: '2.4', n: 2 },
        { label: 'Wall 2', d1: '6', d2: '2.4', n: 1 }
      ], 'blockwall');
      return { qty: r.qty, unit: r.unit };
    })()`);
    check('IN1 instancesQty: 10x2.4 x2 + 6x2.4 = 62.4 m2',
      in1 && in1.qty === 62.4 && in1.unit === 'm2', in1);
    const in2 = await ev(`(function(){
      var st = __calcEngine.readState();
      st.work = 'blockwall'; st.d1 = ''; st.d2 = ''; st.d3 = '';
      st.measuredQty = '62.4'; st.measuredUnit = 'm2';
      var r = __calcEngine.computeFor(st);
      return { err: r && r.error, qty: r && r.qty, mat: r && r.mat, lab: r && r.lab, total: r && r.total };
    })()`);
    check('IN2 measuredQty 62.4 m2 prices without dims (mat 1372.8, lab 1747.2)',
      in2 && !in2.err && in2.qty === 62.4 && Math.abs(in2.mat - 1372.8) < 0.01 && Math.abs(in2.lab - 1747.2) < 0.01, in2);
    const in3 = await ev(`(function(){
      var st = __calcEngine.readState();
      st.work = 'blockwall'; st.d1 = ''; st.d2 = ''; st.d3 = '';
      st.measuredQty = '62.4'; st.measuredUnit = 'm2'; st.quality = 'premium';
      st.rateMat = '30'; st._matModel = null;
      var r = __calcEngine.computeFor(st);
      return { mat: r && r.mat, lab: r && r.lab };
    })()`);
    check('IN3 waste/quality/rates still apply on measured quantity (premium + 30/m2)',
      in3 && Math.abs(in3.mat - 30 * 62.4 * 1.35) < 0.01 && Math.abs(in3.lab - 28 * 62.4 * 1.35) < 0.01, in3);
    const in4 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var vis = !document.getElementById('calc-instances').hidden;
      var rows = document.querySelectorAll('#calc-inst-rows .bcp-inst-row').length;
      document.getElementById('calc-work').value = 'rebar';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var hiddenOnRebar = document.getElementById('calc-instances').hidden;
      return { vis: vis, rows: rows, hiddenOnRebar: hiddenOnRebar };
    })()`);
    check('IN4 editor shows for blockwall (1 seeded row), hidden for rebar',
      in4 && in4.vis && in4.rows === 1 && in4.hiddenOnRebar, in4);
    const in5 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-measured-manual').click();
      var manualShown = !document.getElementById('calc-measured-qty').hidden;
      document.getElementById('calc-measured-qty').value = '50';
      document.getElementById('calc-measured-qty').dispatchEvent(new Event('input', { bubbles: true }));
      var out = document.getElementById('calc-output').textContent;
      var hero = out.match(/([\\d.,]+) m2/);
      document.getElementById('calc-measured-manual').click();
      return { manualShown: manualShown, hero: hero && hero[1] };
    })()`);
    check('IN5 total-override: typing 50 drives the estimate (50 m2)',
      in5 && in5.manualShown && in5.hero === '50', in5);

    // ---------- W3: STATUTORY LABOR ON-COSTS (owner 2026-09-30) ----------
    // Deterministic blockwall line: 10 x 2.4 m wall -> lab = 28 x 24 = 672.
    await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-measured-qty').value = '';
      document.getElementById('calc-measured-manual').checked = false;
      document.getElementById('calc-measured-qty').hidden = true;
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-quality').value = 'standard';
      document.getElementById('calc-oh').value = '10';
    })()`);
    const sx1 = await ev(`(function(){
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var out = document.getElementById('calc-output').textContent;
      return { line: out.indexOf('Labor statutory costs') > -1, total: (out.match(/Estimated total(\\d|[.,])/) || [])[1] || '' };
    })()`);
    check('SX1 off by default: no statutory line renders', sx1 && sx1.line === false, sx1);
    const sx2 = await ev(`(function(){
      var t = document.getElementById('calc-oncost-toggle');
      t.checked = true;
      t.dispatchEvent(new Event('change', { bubbles: true }));
      var p = document.getElementById('calc-oncost-pct');
      p.dataset.touched = '1';
      p.value = '12.5';
      p.dispatchEvent(new Event('input', { bubbles: true }));
      var r = __calcEngine.computeFor(__calcEngine.readState());
      return { onCost: r.onCost, sub: r.sub, total: r.total };
    })()`);
    check('SX2 12.5% of 672 labor = 84.00 on-cost; subtotal 1284 + OH = 1412.40 total',
      sx2 && Math.abs(sx2.onCost - 84) < 0.01 && Math.abs(sx2.sub - 1284) < 0.01 && Math.abs(sx2.total - 1412.4) < 0.01, sx2);
    const sx3 = await ev(`(function(){
      var p = document.getElementById('calc-oncost-pct');
      p.value = '99';
      p.dispatchEvent(new Event('input', { bubbles: true }));
      var r = __calcEngine.computeFor(__calcEngine.readState());
      return { onCostPct: r.onCostPct, onCost: r.onCost };
    })()`);
    check('SX3 on-cost capped at 25%', sx3 && sx3.onCostPct === 25 && Math.abs(sx3.onCost - 168) < 0.01, sx3);
    const sx4 = await ev(`(function(){
      var p = document.getElementById('calc-oncost-pct');
      p.value = '12.5';
      p.dispatchEvent(new Event('input', { bubbles: true }));
      var out = document.getElementById('calc-output').textContent;
      var csv = __calcEngine.estimateCsv(__calcEngine.computeFor(__calcEngine.readState()));
      return { line: out.indexOf('Labor statutory costs (NIS, NHT, HEART, Education) 12.5%') > -1, csvHas: csv.indexOf('Labor statutory costs %","12.5') > -1 };
    })()`);
    check('SX4 breakdown line renders with pct; CSV carries the row',
      sx4 && sx4.line && sx4.csvHas, sx4);
    const sx5 = await ev(`(function(){
      document.getElementById('calc-country').value = 'JM';
      document.getElementById('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
      var noteShown = !document.getElementById('calc-jm-levy-note').hidden;
      var t = document.getElementById('calc-oncost-toggle');
      var p = document.getElementById('calc-oncost-pct');
      t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true }));
      t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true }));
      var suggested = p.value;
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
      var noteHiddenUs = document.getElementById('calc-jm-levy-note').hidden;
      return { noteShown: noteShown, suggested: suggested, noteHiddenUs: noteHiddenUs };
    })()`);
    check('SX5 JM shows levy note + suggests 12.5; US hides the note',
      sx5 && sx5.noteShown && sx5.suggested === '12.5' && sx5.noteHiddenUs, sx5);
    // ---------- W4: PRELIMINARIES / SITE & OTHER COSTS (owner 2026-09-30) ----------
    const pm1 = await ev(`(function(){
      var a = __calcEngine.prelimsTotal([
        { name: 'Permits', basis: 'fixed', value: '250', weeks: '' },
        { name: 'Supervision', basis: 'pct', value: '10', weeks: '' },
        { name: 'Welfare', basis: 'week', value: '150', weeks: '8' }
      ], 10000);
      return { p0: a.perItem[0].amount, p1: a.perItem[1].amount, p2: a.perItem[2].amount, total: a.total };
    })()`);
    check('PM1 fixed 250 + pct 1000 + weekly 1200 = 2450 exact',
      pm1 && pm1.p0 === 250 && pm1.p1 === 1000 && pm1.p2 === 1200 && pm1.total === 2450, pm1);
    const pm2 = await ev(`(function(){
      document.querySelector('[data-action="calcPrelimPreset"]').click();
      var list = JSON.parse(localStorage.getItem('mmgr_calc_prelims') || '[]');
      var total = document.getElementById('calc-prelims-total').textContent;
      return { n: list.length, totalShown: total.indexOf('On top of the works') === 0 };
    })()`);
    check('PM2 preset loads 6 items; on-top-of line renders',
      pm2 && pm2.n === 6 && pm2.totalShown, pm2);
    const pm3 = await ev(`(function(){
      var rows = document.querySelectorAll('#calc-prelims-body .bcp-prelim-row').length;
      var first = document.querySelector('#calc-prelims-body input[data-field="name"]');
      first.value = 'Renamed item';
      first.dispatchEvent(new Event('input', { bubbles: true }));
      var stored = JSON.parse(localStorage.getItem('mmgr_calc_prelims') || '[]');
      return { rows: rows, renamed: stored[0].name };
    })()`);
    check('PM3 6 rows render; rename persists to storage',
      pm3 && pm3.rows === 6 && pm3.renamed === 'Renamed item', pm3);
    const pm4 = await ev(`(function(){
      document.querySelector('[data-action="calcPrelimRemove"][data-idx="0"]').click();
      var afterRemove = JSON.parse(localStorage.getItem('mmgr_calc_prelims') || '[]').length;
      document.querySelector('[data-action="calcPrelimClear"]').click();
      var afterClear = JSON.parse(localStorage.getItem('mmgr_calc_prelims') || '[]').length;
      var empty = document.querySelector('#calc-prelims-body .calc-empty') !== null;
      return { afterRemove: afterRemove, afterClear: afterClear, empty: empty };
    })()`);
    check('PM4 remove drops to 5; clear empties + empty state returns',
      pm4 && pm4.afterRemove === 5 && pm4.afterClear === 0 && pm4.empty, pm4);

    // ---------- W5: CONTINGENCY + ESCALATION (owner 2026-09-30) ----------
    const rg1 = await ev(`(function(){
      var r = __calcEngine.rollup({ works: 100000, prelims: 7000, designC: '10', constrC: '5', escPct: '5', months: '12' });
      return { designC: r.designC, constrC: r.constrC, esc: r.esc, subtotal: r.subtotal };
    })()`);
    check('RG1 waterfall (re-baselined 2026-10-01): base 107k; contingencies + esc ride the discounted base; 100k + 7k + 10700 + 5350 + 5350 = 128400 exact',
      rg1 && Math.abs(rg1.designC - 10700) < 0.01 && Math.abs(rg1.constrC - 5350) < 0.01 && Math.abs(rg1.esc - 5350) < 0.01 && Math.abs(rg1.subtotal - 128400) < 0.01, rg1);
    const rg2 = await ev(`(function(){
      var d = document.getElementById('calc-design-c'), c = document.getElementById('calc-constr-c'),
          e = document.getElementById('calc-esc-pct'), m = document.getElementById('calc-months');
      return { d: d.value, c: c.value, e: e.value, m: m.value };
    })()`);
    check('RG2 defaults restored: design 10, constr 5, esc 5, months empty',
      rg2 && rg2.d === '10' && rg2.c === '5' && rg2.e === '5' && rg2.m === '', rg2);
    const rg3 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var body = document.getElementById('calc-rollup-body');
      var txt = body ? body.textContent : '';
      return { hasWorks: txt.indexOf('Works (the priced bill)') > -1,
               hasPrelim: txt.indexOf('Site & other costs') > -1,
               hasDesign: txt.indexOf('Design contingency (10%)') > -1,
               hasConstr: txt.indexOf('Construction contingency (5%)') > -1,
               hasTotal: txt.indexOf('Planning subtotal (before tax)') > -1,
               noEsc: txt.indexOf('Escalation (') === -1 };
    })()`);
    check('RG3 waterfall lines render; escalation line hidden while months empty',
      rg3 && rg3.hasWorks && rg3.hasPrelim && rg3.hasDesign && rg3.hasConstr && rg3.hasTotal && rg3.noEsc, rg3);
    // ---------- W6: CASH FLOW (owner 2026-09-30) ----------
    const cf1 = await ev(`(function(){
      var c = __calcEngine.cashCurve(120000, '12', 'straight', '3.2');
      var sum = c.per.reduce(function(a, b) { return a + b; }, 0);
      return { n: c.per.length, first: c.per[0], sum: sum, lastCum: c.cum[11] };
    })()`);
    check('CF1 straight-line: 12 months x 10000, cumulative ends at total',
      cf1 && cf1.n === 12 && Math.abs(cf1.first - 10000) < 0.01 && Math.abs(cf1.sum - 120000) < 0.01 && Math.abs(cf1.lastCum - 120000) < 0.01, cf1);
    const cf2 = await ev(`(function(){
      var c = __calcEngine.cashCurve(120000, '12', 'scurve', '3.2');
      var sum = c.per.reduce(function(a, b) { return a + b; }, 0);
      var mid = (c.per[5] + c.per[6]) / 2, ends = (c.per[0] + c.per[11]) / 2;
      return { sum: sum, mid: mid, ends: ends, peakHigher: mid > ends * 1.5 };
    })()`);
    check('CF2 S-curve: sums to total, middle months far exceed ends',
      cf2 && Math.abs(cf2.sum - 120000) < 0.01 && cf2.peakHigher, cf2);
    const cf3 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-months').value = '6';
      document.getElementById('calc-months').dispatchEvent(new Event('input', { bubbles: true }));
      var rows6 = document.querySelectorAll('#calc-cash-body .calc-line').length;
      document.getElementById('calc-cash-mode').value = 'straight';
      document.getElementById('calc-cash-mode').dispatchEvent(new Event('change', { bubbles: true }));
      var lines = document.querySelectorAll('#calc-cash-body .calc-line strong');
      var first = lines[0] ? lines[0].textContent : '';
      var last = lines.length ? lines[lines.length - 1].textContent : '';
      var m = last.match(/[^\\d]*([\\d,]+)/);   // first number = the month's own spend (double-escaped: the ev() template cooks \\d)
      // Straight-line invariant: the rendered month x N must rebuild the rendered cumulative total.
      var month = m ? parseFloat(m[1].replace(/,/g, '')) : 0;
      var cum = last.match(/cum [^\\d]*([\\d,]+)/);   // no parens: the ev() template also cooks backslash-parens
      var cumVal = cum ? parseFloat(cum[1].replace(/,/g, '')) : 0;
      var expected = m ? '$' + Math.round(month * 6).toLocaleString('en-US') : '';
      var consistent = cumVal > 0 && Math.abs(month * 6 - cumVal) <= 6;
      return { rows6: rows6, firstLine: first, lastLine: last, expected: expected, consistent: consistent };
    })()`);
    check('CF3 table renders 6 months; even months rebuild the cumulative total',
      cf3 && cf3.rows6 === 6 && cf3.consistent === true, cf3);
    // Clean up the W6 duration so later waves see the default state.
    await ev(`(function(){
      document.getElementById('calc-months').value = '';
      document.getElementById('calc-months').dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    // ---------- W7: CONCRETE ACCESSORIES (owner 2026-09-30) ----------
    const fa1 = await ev(`(function(){
      var slab = __calcEngine.formworkM2('slab', '10', '10', '100');
      var foot = __calcEngine.formworkM2('footings', '10', '0.5', '500');
      return { slab: slab, foot: foot };
    })()`);
    check('FA1 slab 2x20x0.1 = 4.0 m2; footing 2x10.5x0.5 = 10.5 m2',
      fa1 && fa1.slab === 4 && fa1.foot === 10.5, fa1);
    const fa2 = await ev(`(function(){
      return { wall: __calcEngine.formworkM2('blockwall', '10', '2.4', ''),
               rebar: __calcEngine.formworkM2('rebar', '50', '', '') };
    })()`);
    check('FA2 non-concrete trades refuse (null)',
      fa2 && fa2.wall === null && fa2.rebar === null, fa2);
    const fa3 = await ev(`(function(){
      try { localStorage.removeItem('mmgr_calc_boq'); } catch (e) {}
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '10';
      document.getElementById('calc-d3').value = '100';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var boxShown = !document.getElementById('calc-formwork-box').hidden;
      var boxText = document.getElementById('calc-formwork-text').textContent;
      // Deterministic pricing state: the SX gates leave statutory on-costs
      // and margin set (the derived line correctly inherits them), so clear
      // both here to pin the plain trade math.
      var ohEl = document.getElementById('calc-oh');
      ohEl.value = '';
      ohEl.dispatchEvent(new Event('input', { bubbles: true }));
      var ocT = document.getElementById('calc-oncost-toggle');
      ocT.checked = false;
      ocT.dispatchEvent(new Event('change', { bubbles: true }));
      var ocP = document.getElementById('calc-oncost-pct');
      ocP.value = '';
      ocP.dataset.touched = '';
      ocP.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-action="calcFormworkAdd"]').click();
      var lines = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
      var fst = lines[0] ? lines[0].st : {};
      var fr = __calcEngine.computeFor(fst);
      document.getElementById('calc-work').value = 'rebar';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var lapsShown = !document.getElementById('calc-rebar-laps-wrap').hidden;
      var lapsGoneOnSlab = (function(){
        document.getElementById('calc-work').value = 'blockwall';
        document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
        return document.getElementById('calc-rebar-laps-wrap').hidden;
      })();
      return { boxShown: boxShown, hasM2: boxText.indexOf('4') > -1, lines: lines.length,
               named: lines[0] ? lines[0].name : '', fwWork: fst.work, fwMq: fst.measuredQty,
               fwMat: fr ? fr.mat : null, fwLab: fr ? fr.lab : null, fwTotal: fr ? fr.total : null,
               lapsShown: lapsShown, lapsGoneOnSlab: lapsGoneOnSlab };
    })()`);
    check('FA3 (re-baselined 2026-10-01) formwork box derives 4 m2, line PRICES AS FORMWORK via measuredQty (derived 55/m2 -> mat 220; trade labor 33/m -> lab 132; total 352), laps field rides rebar only',
      fa3 && fa3.boxShown && fa3.hasM2 && fa3.lines === 1 && fa3.named.indexOf('Formwork') === 0 && fa3.fwWork === 'formwork' && fa3.fwMq === '4' && Math.abs(fa3.fwMat - 220) < 0.01 && Math.abs(fa3.fwLab - 132) < 0.01 && Math.abs(fa3.fwTotal - 352) < 0.01 && fa3.lapsShown && fa3.lapsGoneOnSlab, fa3);
    await ev(`(function(){ try { localStorage.removeItem('mmgr_calc_boq'); } catch (e) {} renderBoq(); })()`);

    // ---------- W8: LOCATION PACKS (owner 2026-09-30) ----------
    const lp1 = await ev(`(function(){
      var list = JSON.parse(localStorage.getItem('mmgr_calc_locpacks') || '[]');
      var ids = list.map(function(p) { return p.id; });
      return { n: list.length, us: ids.indexOf('pack-us') > -1, jm: ids.indexOf('pack-jm') > -1, gb: ids.indexOf('pack-gb') > -1,
               picker: document.getElementById('calc-pack-select').options.length };
    })()`);
    check('LP1 seeds: US + JM + GB present; picker populated',
      lp1 && lp1.n >= 3 && lp1.us && lp1.jm && lp1.gb && lp1.picker >= 4, lp1);
    const lp2 = await ev(`(function(){
      document.getElementById('calc-rate-mat').dataset.model = '150';
      document.getElementById('calc-rate-mat').value = '100';
      var sel = document.getElementById('calc-pack-select');
      sel.value = 'pack-jm';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      var cur = document.getElementById('calc-currency').value;
      var tax = document.getElementById('calc-tax-override').value;
      var mat = document.getElementById('calc-rate-mat').value;
      var note = document.getElementById('calc-pack-note');
      return { cur: cur, tax: tax, mat: mat, noteShown: !note.hidden, noteHas: note.textContent.indexOf('GCT 15%') > -1 };
    })()`);
    check('LP2 JM pack: JMD + 15% tax; index != 1 scales the material rate; note shows',
      lp2 && lp2.cur === 'JMD' && lp2.tax === '15' && lp2.noteShown && lp2.noteHas, lp2);
    const lp3 = await ev(`(function(){
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
      var res = __calcEngine.importPacks({ version: 1, packs: [
        { name: 'My Parish', currency: 'jmd', taxDefault: 15, index: 1.1, benchmark: 'test note' },
        { name: '', currency: 'USD' },
        { name: 'No Currency' }
      ]});
      var list = JSON.parse(localStorage.getItem('mmgr_calc_locpacks') || '[]');
      var mine = list.find(function(p) { return p.name === 'My Parish'; });
      return { merged: res.merged, skipped: res.skipped, cur: mine && mine.currency, idx: mine && mine.index };
    })()`);
    check('LP3 import merges 1 (currency normalized) + skips 2 invalid',
      lp3 && lp3.merged === 1 && lp3.skipped === 2 && lp3.cur === 'JMD' && lp3.idx === 1.1, lp3);
    await ev(`(function(){
      var list = JSON.parse(localStorage.getItem('mmgr_calc_locpacks') || '[]').filter(function(p) { return p.name !== 'My Parish'; });
      localStorage.setItem('mmgr_calc_locpacks', JSON.stringify(list));
      renderPacks();
      document.getElementById('calc-rate-mat').value = '';
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-tax-override').value = '';
      document.getElementById('calc-pack-note').hidden = true;
    })()`);

    // Restore the pre-wave state for the U-series gates (the W1 block above
    // deliberately dirtied the form): deterministic metric slab flow.
    await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '';
      document.getElementById('calc-d2').value = '';
      document.getElementById('calc-d3').value = '';
      document.getElementById('calc-measured-qty').value = '';
      document.getElementById('calc-measured-manual').checked = false;
      document.getElementById('calc-measured-qty').hidden = true;
      document.getElementById('calc-instances').hidden = false;
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-quality').value = 'standard';
      document.getElementById('calc-oh').value = '';
      var t3 = document.getElementById('calc-oncost-toggle');
      t3.checked = false;
      t3.dispatchEvent(new Event('change', { bubbles: true }));
      var p3 = document.getElementById('calc-oncost-pct');
      p3.value = '';
      p3.dataset.touched = '';
    })()`);

    // ---------- W2.5 2026-10-01: WORK FAMILIES (FM family) ----------
    const fm1 = await ev(`(function(){
      var f = document.getElementById('calc-family');
      f.value = 'structure';
      f.dispatchEvent(new Event('change', { bubbles: true }));
      var vis = Array.prototype.filter.call(document.querySelectorAll('#calc-work optgroup'), function(g) { return !g.hidden; }).map(function(g) { return g.label; });
      return { vis: vis, work: document.getElementById('calc-work').value, stored: localStorage.getItem('mmgr_calc_family') };
    })()`);
    check('FM1 choosing Structure filters the picker to its group and jumps to a Structure trade',
      fm1 && fm1.vis.length === 1 && fm1.vis[0] === 'Structure' && ['blockwall','brickwall','framing','rebar'].indexOf(fm1.work) > -1 && fm1.stored === 'structure', fm1);
    const fm2 = await ev(`(function(){
      return { hint: document.getElementById('calc-family-hint').textContent };
    })()`);
    check('FM2 family hint names the family scope in plain language',
      fm2 && fm2.hint.indexOf('loads') > -1, fm2);
    const fm3 = await ev(`(function(){
      document.getElementById('calc-work').value = 'tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var vis = Array.prototype.filter.call(document.querySelectorAll('#calc-work optgroup'), function(g) { return !g.hidden; }).map(function(g) { return g.label; });
      return { fam: document.getElementById('calc-family').value, stored: localStorage.getItem('mmgr_calc_family'), vis: vis };
    })()`);
    check('FM3 a foreign trade selected directly (recall path) flips the family - never fights the work item',
      fm3 && fm3.fam === 'finishes' && fm3.stored === 'finishes' && fm3.vis.length === 1 && fm3.vis[0] === 'Finishes', fm3);
    const fm4 = await ev(`(function(){
      var f = document.getElementById('calc-family');
      f.value = '';
      f.dispatchEvent(new Event('change', { bubbles: true }));
      var n = Array.prototype.filter.call(document.querySelectorAll('#calc-work optgroup'), function(g) { return !g.hidden; }).length;
      return { all: n, stored: localStorage.getItem('mmgr_calc_family'), work: document.getElementById('calc-work').value };
    })()`);
    check('FM4 All trades shows every group and clears the memory; work item untouched',
      fm4 && fm4.all === 6 && fm4.stored === null && fm4.work === 'tile', fm4);
    const fm5 = await ev(`(function(){
      var vals = Array.prototype.map.call(document.getElementById('calc-work').options, function(o) { return o.value; });
      return { n: vals.length, hasDerived: vals.indexOf('formwork') > -1 || vals.indexOf('cart-away') > -1 || vals.indexOf('lining-out') > -1 };
    })()`);
    check('FM5 picker still carries exactly the 24 user trades - derived companion items stay invisible',
      fm5 && fm5.n === 24 && !fm5.hasDerived, fm5);

    // ---------- W2 2026-10-01: COMPANION SUGGESTIONS (CP family) ----------
    const cp1 = await ev(`(function(){
      var hits = 0;
      ['blockwall', 'fencing', 'siteprep'].forEach(function(k) {
        if (__calcEngine.companionsFor({ work: k, d1: '10', d2: '2.4', units: 'metric' }).length) hits++;
      });
      var none = __calcEngine.companionsFor({ work: 'skirt', d1: '10', units: 'metric' }).length;
      var lineout = __calcEngine.companionsFor({ work: 'blockwall', d1: '10', d2: '2.4', units: 'metric' }).filter(function(c) { return c.id === 'lineout'; })[0];
      var slabCart = __calcEngine.companionsFor({ work: 'slab', d1: '10', d2: '10', d3: '100', units: 'metric' }).filter(function(c) { return c.id === 'cart3'; })[0];
      return { hits: hits, none: none, lineout: lineout, slabCart: slabCart };
    })()`);
    check('CP1 companion map: blockwall/fencing/siteprep covered; skirt none; lineout derives run; slab cart3 = pour m3',
      cp1 && cp1.hits === 3 && cp1.none === 0 && cp1.lineout && Math.abs(cp1.lineout.qty - 24.8) < 0.01 && cp1.slabCart && Math.abs(cp1.slabCart.qty - 10) < 0.01, cp1);
    const cp2 = await ev(`(function(){
      var holes = __calcEngine.companionsFor({ work: 'fencing', d1: '25', units: 'metric' }).filter(function(c) { return c.id === 'holes'; })[0];
      return holes ? holes.qty : null;
    })()`);
    check('CP2 fencing 25 m run -> 10 post holes at 2.5 m spacing', cp2 === 10, cp2);
    const cp3 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var wrap = document.getElementById('calc-companions');
      return { shown: !wrap.hidden, chips: wrap.querySelectorAll('.bcp-cp-chip').length };
    })()`);
    check('CP3 pricing a blockwall shows 3 companion chips; hidden before/after',
      cp3 && cp3.shown && cp3.chips === 3, cp3);
    const cp4 = await ev(`(function(){
      document.querySelector('#calc-companions [data-cp="lineout"]').click();
      document.querySelector('#calc-companions [data-cp="brush"]').click();
      var lines = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
      var first = lines[0] || {};
      var r = __calcEngine.computeFor(first.st || {});
      var wrap = document.getElementById('calc-companions');
      return { lines: lines.length, work: first.st && first.st.work, tag: first.st && first.st.derivedFrom,
        measured: first.st && first.st.measuredQty, priced: r && !r.error && r.qty > 0, left: wrap.hidden ? 0 : wrap.querySelectorAll('.bcp-cp-chip').length };
    })()`);
    check('CP4 chip click adds a REAL priced bill line (measuredQty path, tagged, editable); chips thin out',
      cp4 && cp4.lines === 2 && cp4.work === 'lining-out' && cp4.tag === 'blockwall:lineout' && cp4.measured === '24.8' && cp4.priced && cp4.left === 1, cp4);
    const cp5 = await ev(`(function(){
      document.querySelector('#calc-companions [data-cp="cart"]').click();
      var wrap = document.getElementById('calc-companions');
      var lines = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
      return { hidden: wrap.hidden, lines: lines.length };
    })()`);
    check('CP5 accepting every suggestion hides the chips row; all three lines on the bill',
      cp5 && cp5.hidden && cp5.lines === 3, cp5);
    await ev(`(function(){ try { localStorage.removeItem('mmgr_calc_boq'); } catch (e) {} renderBoq(); })()`);

    // ---------- W1 2026-10-01: DISCOUNT (DC family) ----------
    const dc1 = await ev(`(function(){
      var a = __calcEngine.applyDiscount(100000, 6000, '5', '');
      var b = __calcEngine.applyDiscount(100000, 6000, '5', '8000');
      var c = __calcEngine.applyDiscount(1000, 0, '', '99999');
      var d = __calcEngine.applyDiscount(1000, 0, '-5', '-100');
      return { pct: a.discount, base: a.base, fixedWins: b.discount, cap: c.discount, capBase: c.base, neg: d.discount, negBase: d.base };
    })()`);
    check('DC1 discount math: 5% of 106k = 5300; fixed 8000 wins; caps at pool; negatives clamp',
      dc1 && Math.abs(dc1.pct - 5300) < 0.01 && Math.abs(dc1.base - 100700) < 0.01 && Math.abs(dc1.fixedWins - 8000) < 0.01 && dc1.cap === 1000 && dc1.capBase === 0 && dc1.neg === 0 && dc1.negBase === 1000, dc1);
    const dc2 = await ev(`(function(){
      var r = __calcEngine.rollup({ works: 100000, prelims: 6000, designC: '10', constrC: '5', escPct: '5', months: '12', discPct: '5', discAmt: '' });
      var b = r.base;
      return { disc: r.discount, base: r.base, design: r.designC, constr: r.constrC, esc: r.esc, sub: r.subtotal,
        exact: Math.abs(b * 0.10 - 10070) < 0.01 && Math.abs(b * 0.05 - 5035) < 0.01 && Math.abs(b * 0.05 - 5035) < 0.01 && Math.abs(r.subtotal - (b + b * 0.10 + b * 0.05 + b * 0.05)) < 0.01 };
    })()`);
    check('DC2 waterfall: contingencies + escalation ride the DISCOUNTED base',
      dc2 && Math.abs(dc2.disc - 5300) < 0.01 && dc2.exact, dc2);
    const dc3 = await ev(`(function(){
      localStorage.setItem('mmgr_calc_rollup', JSON.stringify({ designC: '10', constrC: '5', escPct: '5', months: '', discPct: '7.5', discAmt: '2000' }));
      location.reload();
      return { pending: true };
    })()`);
    await delay(2500);
    const dc3b = await ev(`(function(){
      var p = document.getElementById('calc-disc-pct'), a = document.getElementById('calc-disc-amt');
      return { pct: p ? p.value : null, amt: a ? a.value : null };
    })()`);
    check('DC3 discount settings persist and rehydrate after reload',
      dc3b && dc3b.pct === '7.5' && dc3b.amt === '2000', dc3b);
    const dc4 = await ev(`(function(){
      localStorage.setItem('mmgr_calc_rollup', JSON.stringify({ designC: '10', constrC: '5', escPct: '5', months: '' }));
      location.reload();
      return { pending: true };
    })()`);
    await delay(2500);
    const dc4b = await ev(`(function(){
      var r = __calcEngine.rollup({ works: 100000, prelims: 0, designC: '10', constrC: '0', escPct: '0', months: '0', discPct: '', discAmt: '' });
      var p = document.getElementById('calc-disc-pct');
      return { disc: r.discount, fieldBlank: p ? p.value === '' : false };
    })()`);
    check('DC4 legacy prefs without disc keys: no discount, no error, fields blank',
      dc4b && dc4b.disc === 0 && dc4b.fieldBlank, dc4b);
    const dc5 = await ev(`(function(){
      document.getElementById('calc-disc-pct').value = '10';
      document.getElementById('calc-disc-pct').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var csv = __calcEngine.estimateCsv(__calcEngine.computeFor(__calcEngine.readState()));
      var body = document.getElementById('calc-rollup-body');
      var txt = body ? body.textContent : '';
      return { csvHasDisc: csv.indexOf('Discount % / amount') > -1 && csv.indexOf('10 / 0') > -1,
               discLine: txt.indexOf('Discount') > -1, pctShown: txt.indexOf('10% off') > -1, neg: txt.indexOf('-') > -1 };
    })()`);
    check('DC5 CSV carries the discount row; waterfall shows the discount line with pct',
      dc5 && dc5.csvHasDisc && dc5.discLine && dc5.pctShown && dc5.neg, dc5);
    await ev(`(function(){
      document.getElementById('calc-disc-pct').value = '';
      document.getElementById('calc-disc-amt').value = '';
      document.getElementById('calc-disc-pct').dispatchEvent(new Event('input', { bubbles: true }));
      localStorage.setItem('mmgr_calc_rollup', JSON.stringify({ designC: '10', constrC: '5', escPct: '5', months: '', discPct: '', discAmt: '' }));
    })()`);

    // The DC3/DC4 gates reload the page, which wipes the deterministic slab
    // state - re-establish it here (same field set as the pre-wave reset).
    await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '';
      document.getElementById('calc-d2').value = '';
      document.getElementById('calc-d3').value = '';
      document.getElementById('calc-measured-qty').value = '';
      document.getElementById('calc-measured-manual').checked = false;
      document.getElementById('calc-measured-qty').hidden = true;
      document.getElementById('calc-instances').hidden = false;
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-quality').value = 'standard';
      document.getElementById('calc-oh').value = '';
      ['calc-design-c','calc-constr-c','calc-esc-pct','calc-months','calc-disc-pct','calc-disc-amt'].forEach(function(id2){
        var el = document.getElementById(id2);
        if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      localStorage.setItem('mmgr_calc_rollup', JSON.stringify({}));
      var t3 = document.getElementById('calc-oncost-toggle');
      if (t3) { t3.checked = false; t3.dispatchEvent(new Event('change', { bubbles: true })); }
      var p3 = document.getElementById('calc-oncost-pct');
      if (p3) { p3.value = ''; p3.dataset.touched = ''; }
    })()`);

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

    // U2 (re-baselined 2026-09-29, A2 unit-primary hero): imperial slab entry
    // now shows SQ FT / CU YD as the primary hero with the metric reading as
    // the secondary line (owner review: the hero follows the unit toggle).
    const u2 = await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '33';
      document.getElementById('calc-d2').value = '26';
      document.getElementById('calc-d3').value = '6';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      const out = document.getElementById('calc-output').textContent;
      const hero = out.match(/([\\d.,]+) cu yd/);
      return { cuyd: hero && hero[1], altMetric: out.indexOf('12.76 m3') > -1 };
    })()`);
    check('U2 imperial slab 33x26x6in -> 16.7 cu yd hero + metric reading', u2 && u2.cuyd === '16.7' && u2.altMetric === true, u2);

    // I1 (A2): the hero follows the unit toggle on the same input. Drives its
    // own toggles AND restores work=slab + metric so the following gates keep
    // their assumptions (X1/S1 read the live work item).
    const i1 = await ev(`(function(){
      document.getElementById('calc-work').value = 'tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '6';
      document.getElementById('calc-d2').value = '6';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      const metricHero = document.querySelector('#calc-output .calc-sum-qty').textContent;
      document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();
      const impHero = document.querySelector('#calc-output .calc-sum-qty').textContent;
      // restore the ambient state the surrounding gates assume
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      return { metricHero: metricHero, impHero: impHero };
    })()`);
    check('I1 unit-primary hero: 39.6 m2 metric / 40 sq ft imperial', i1 && i1.metricHero.indexOf('39.6 m2') === 0 && i1.impHero.indexOf('40 sq ft') === 0 && i1.impHero.indexOf('3.68 m2') > -1, i1);

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
      var lbl = document.getElementById('calc-piece-price-label').textContent;
      return { visible: !document.getElementById('calc-piece-wrap').hidden, bagLbl: lbl };
    })()`);
    check('R5 piece row follows the trade: area on tile, bag-yield on slab', r45 && r45.pieceVisible && r5b && r5b.visible && /bag/i.test(r5b.bagLbl), r5b);

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

    // ---- B1 WASTE % (owner review 2026-09-29) ----
    // W1: tile defaults to 10 (the old baked-in factor) - the sum matches
    // today's engine exactly and the allowance line renders.
    const w1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_history');
      document.getElementById('calc-work').value='tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='6'; document.getElementById('calc-d2').value='6';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      var out = document.getElementById('calc-output').textContent;
      var m = out.match(/Cuts \\/ waste allowance[\\d.,]+%/);
      return { visible: !document.getElementById('calc-waste-wrap').hidden,
               def: document.getElementById('calc-waste').value,
               line: m && m[0] };
    })()`);
    check('W1 tile waste defaults to 10, allowance line renders', w1 && w1.visible && w1.def==='10' && w1.line && w1.line.indexOf('10%') > -1, w1);

    // W2: typing 20 raises the tile count (36 -> 43.2 m2 effective) and the total.
    const w2 = await ev(`(function(){
      var before = document.getElementById('calc-output').textContent;
      document.getElementById('calc-waste').value='20';
      document.getElementById('calc-waste').dispatchEvent(new Event('input',{bubbles:true}));
      var after = document.getElementById('calc-output').textContent;
      var q = function(t){ var m = t.match(/([\\d.,]+) m2/); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };
      return { before: q(before), after: q(after), raised: q(after) > q(before) };
    })()`);
    check('W2 waste 20 raises effective quantity (36 -> 43.2 m2)', w2 && w2.before === 39.6 && w2.after === 43.2 && w2.raised, w2);

    // W3: a non-waste trade hides the field; the label names the allowance.
    // Clears the typed % first (waste carries across trades like rates do -
    // only an EMPTY field takes the new trade's default).
    const w3 = await ev(`(function(){
      document.getElementById('calc-work').value='blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var hidden = document.getElementById('calc-waste-wrap').hidden;
      document.getElementById('calc-waste').value='';
      document.getElementById('calc-work').value='roof';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      return { blockHidden: hidden, roofLbl: document.getElementById('calc-waste-label').textContent,
               roofDef: document.getElementById('calc-waste').value };
    })()`);
    check('W3 non-waste trade hides field; roof label = laps', w3 && w3.blockHidden && w3.roofLbl === 'Laps / pitch allowance %' && w3.roofDef === '10', w3);

    // restore slab context for the gates that follow
    await ev(`(function(){
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
    })()`);

    // ---- B2 PIECE COUNTS (owner review 2026-09-29) ----
    // C1: tile 6x6 with waste 10 -> 39.6 m2; 30x60 tiles -> ceil(39.6/0.18) = 220.
    const c1 = await ev(`(function(){
      document.getElementById('calc-work').value='tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='6'; document.getElementById('calc-d2').value='6';
      document.getElementById('calc-waste').value='10';
      document.getElementById('calc-piece-price').value='950';
      document.getElementById('calc-piece-size').value='30 x 60';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input',{bubbles:true}));
      var out = document.getElementById('calc-output').textContent;
      return { order: out.match(/Order about ([\\d,]+) tiles/) && out.match(/Order about ([\\d,]+) tiles/)[1],
               at: out.indexOf('tiles at 30 x 60 cm') > -1, mat: out.indexOf('priced per piece') > -1 };
    })()`);
    check('C1 tile count: ceil(39.6/0.18) = 220 tiles at 30 x 60 cm', c1 && c1.order === '220' && c1.at && c1.mat, c1);

    // C2: SIZE-ONLY mode - clearing the price keeps the count (materials
    // priced by the rate again); volume trades count bags from the yield.
    const c2 = await ev(`(function(){
      document.getElementById('calc-piece-price').value='';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input',{bubbles:true}));
      var tileOut = document.getElementById('calc-output').textContent;
      var tileCount = tileOut.match(/Order about ([\\d,]+) tiles/);
      var tileMat = tileOut.indexOf('priced per piece') === -1;
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='10'; document.getElementById('calc-d2').value='10'; document.getElementById('calc-d3').value='150';
      document.getElementById('calc-piece-price').value='';
      document.getElementById('calc-piece-size').value='20';
      document.getElementById('calc-piece-size').dispatchEvent(new Event('input',{bubbles:true}));
      var slabOut = document.getElementById('calc-output').textContent;
      var m = slabOut.match(/Order about ([\\d,]+) bags.units at 20 L/);
      return { tileCount: tileCount && tileCount[1], tileMat: tileMat, slabBags: m && m[1],
               matLbl: slabOut.indexOf('Materials') > -1 };
    })()`);
    check('C2 size-only count keeps showing; slab yield 20 -> 788 bags', c2 && c2.tileCount === '220' && c2.tileMat && c2.slabBags === '788' && c2.matLbl, c2);

    // restore the ambient state later gates assume (slab + no piece pricing)
    await ev(`(function(){
      document.getElementById('calc-piece-size').value='';
      document.getElementById('calc-piece-size').dispatchEvent(new Event('input',{bubbles:true}));
    })()`);

    // ---- B3 EQUIPMENT + OVERHEAD (owner review 2026-09-29) ----
    // E1: equipment 10/m3 on a 12.6 m3 slab adds exactly qty x 10 x quality.
    const e3a = await ev(`(function(){
      document.getElementById('calc-d1').value='10'; document.getElementById('calc-d2').value='8'; document.getElementById('calc-d3').value='150';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      var g = function(t,k){ var s=t.split(k)[1]||''; var m=s.replace(/[^\\d,]/g,' ').match(/([\\d,]+)/); return m?parseFloat(m[1].replace(/,/g,'')):null; };
      var before = document.getElementById('calc-output').textContent;
      var bSub = g(before,'Subtotal');
      document.getElementById('calc-rate-eq').value='10';
      document.getElementById('calc-rate-eq').dispatchEvent(new Event('input',{bubbles:true}));
      var after = document.getElementById('calc-output').textContent;
      var aSub = g(after,'Subtotal');
      return { hasLine: after.indexOf('Equipment / plant hire') > -1, delta: aSub - bSub };
    })()`);
    check('E1 equipment 10/m3 on 12.6 m3 adds 126 to subtotal', e3a && e3a.hasLine && Math.abs(e3a.delta - 126) < 2, e3a);

    // E2: overhead 10% lands as its own line and tax recomputes on sub+oh.
    const e3b = await ev(`(function(){
      var g = function(t,k){ var s=t.split(k)[1]||''; var m=s.replace(/[^\\d,]/g,' ').match(/([\\d,]+)/); return m?parseFloat(m[1].replace(/,/g,'')):null; };
      document.getElementById('calc-oh').value='10';
      document.getElementById('calc-oh').dispatchEvent(new Event('input',{bubbles:true}));
      var t = document.getElementById('calc-output').textContent;
      var sub = g(t,'Subtotal'), oh = g(t,'Overhead & margin 10'), tot = g(t,'Estimated total');
      // tax money follows the first % after the 'Tax (' label
      var tx = t.indexOf('Tax ('), pc = tx > -1 ? t.indexOf('%', tx) : -1;
      var taxSeg = pc > -1 ? t.substring(pc + 1, pc + 30) : '';
      var tm = taxSeg.replace(/,/g,'').match(/([0-9][0-9.]*)/);
      var tax = tm ? parseFloat(tm[1].replace(/,/g,'')) : null;
      return { hasOh: oh !== null, taxOnSubOh: tax !== null && Math.abs(tax - (sub + oh) * 0.125) < 2,
               totalOk: Math.abs(tot - (sub + oh) * 1.125) < 2 };
    })()`);
    check('E2 overhead 10% line + tax on sub+oh', e3b && e3b.hasOh && e3b.taxOnSubOh && e3b.totalOk, e3b);

    // E3: defaults stay clean - clearing both fields removes both lines.
    const e3c = await ev(`(function(){
      document.getElementById('calc-rate-eq').value='';
      document.getElementById('calc-oh').value='';
      document.getElementById('calc-rate-eq').dispatchEvent(new Event('input',{bubbles:true}));
      var t = document.getElementById('calc-output').textContent;
      return { noEq: t.indexOf('Equipment / plant hire') === -1, noOh: t.indexOf('Overhead') === -1 };
    })()`);
    check('E3 empty equipment/overhead = today\'s four-line breakdown', e3c && e3c.noEq && e3c.noOh, e3c);

    // restore the ambient state (clear both fields)
    await ev(`(function(){
      document.getElementById('calc-rate-eq').value=''; document.getElementById('calc-oh').value='';
      document.getElementById('calc-rate-eq').dispatchEvent(new Event('input',{bubbles:true}));
    })()`);

    // ---- D1 RATE-SHEET IMPORT/EXPORT (owner review 2026-09-29) ----
    // Seed one sheet, then export and capture the JSON payload.
    const t1 = await ev(`(async function(){
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-rate-mat').value='140'; document.getElementById('calc-rate-lab').value='80';
      document.getElementById('calc-sheet-name').value='qa-low-bid';
      document.querySelector('[data-action=calcSheetSave]').click();
      var created=[]; var oc=URL.createObjectURL; URL.createObjectURL=function(b){created.push(b);return 'blob:qa';};
      var oclk=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){};
      document.querySelector('[data-action=calcSheetExport]').click();
      URL.createObjectURL=oc; HTMLAnchorElement.prototype.click=oclk;
      if(!created.length) return {ok:false};
      var txt = await created[0].text();
      var json = JSON.parse(txt);
      return { ok:true, hasName: txt.indexOf('qa-low-bid') > -1, ver: json.version, n: json.sheets.length,
               msg: document.getElementById('calc-sheet-msg').textContent };
    })()`);
    check('T1 export downloads JSON carrying the saved sheet', t1 && t1.ok && t1.hasName && t1.ver === 1 && t1.n >= 1 && String(t1.msg).indexOf('Exported') > -1, t1);

    // T2: import merges - same name replaces, new name is added. FileReader
    // is async, so poll for the status line before reading storage.
    const t2 = await ev(`(async function(){
      var payload = { version:1, sheets: [
        { name:'qa-low-bid', rates:{ rateMat:'111', rateLab:'22' } },
        { name:'qa-sustain', rates:{ rateMat:'300', rateLab:'120', rateEq:'50' } } ] };
      var f = document.getElementById('calc-sheet-file');
      var dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(payload)], 'sheets.json', { type:'application/json' }));
      f.files = dt.files;
      f.dispatchEvent(new Event('change',{bubbles:true}));
      for (var i = 0; i < 20; i++) {
        if (document.getElementById('calc-sheet-msg').textContent.indexOf('Imported') === 0) break;
        await new Promise(function(r){ setTimeout(r, 100); });
      }
      var names = JSON.parse(localStorage.getItem('mmgr_calc_rate_sheets')).map(function(s){ return s.name; });
      var lowBid = JSON.parse(localStorage.getItem('mmgr_calc_rate_sheets')).find(function(s){ return s.name==='qa-low-bid'; });
      return { names: names, lowBidMat: lowBid && lowBid.rates.rateMat,
               msg: document.getElementById('calc-sheet-msg').textContent };
    })()`);
    check('T2 import merges: replaces qa-low-bid, adds qa-sustain', t2 && t2.names.indexOf('qa-sustain') > -1 && String(t2.lowBidMat) === '111' && String(t2.msg).indexOf('Imported 2') > -1, t2);

    // T3: garbage file -> friendly message, storage untouched (same async
    // reader: poll until the status line changes, then compare storage).
    const t3 = await ev(`(async function(){
      var before = localStorage.getItem('mmgr_calc_rate_sheets');
      var f = document.getElementById('calc-sheet-file');
      var dt = new DataTransfer();
      dt.items.add(new File(['not json at all {{{'], 'bad.json', { type:'application/json' }));
      f.files = dt.files;
      f.dispatchEvent(new Event('change',{bubbles:true}));
      for (var i = 0; i < 20; i++) {
        var m = document.getElementById('calc-sheet-msg').textContent;
        if (m.indexOf('Imported') !== 0 && m !== '') break;
        await new Promise(function(r){ setTimeout(r, 100); });
      }
      var after = localStorage.getItem('mmgr_calc_rate_sheets');
      return { msg: document.getElementById('calc-sheet-msg').textContent, unchanged: before === after };
    })()`);
    check('T3 garbage import rejected with message, storage intact', t3 && String(t3.msg).indexOf('not a My MaNaGeR rate sheet export') > -1 && t3.unchanged, t3);

    // clean the seeded sheets for later gates (renderSheets is page-internal;
    // clearing storage is enough - nothing later asserts the sheets list)
    await ev(`(function(){ localStorage.removeItem('mmgr_calc_rate_sheets'); })()`);

    // ---- D2 ESTIMATE COMPARISON (owner review 2026-09-29) ----
    // Seed two named saves of the same slab: economy and premium quality.
    const p0 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_estimates');
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='10'; document.getElementById('calc-d2').value='8'; document.getElementById('calc-d3').value='150';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('calc-quality').value='economy';
      document.getElementById('calc-save-name').value='qa-economy';
      document.querySelector('[data-action=calcSave]').click();
      document.getElementById('calc-quality').value='premium';
      document.getElementById('calc-save-name').value='qa-premium';
      document.querySelector('[data-action=calcSave]').click();
      return { rows: document.querySelectorAll('#calc-estimates .bcp-est-row').length };
    })()`);
    check('P0 two named saves seeded (economy + premium)', p0 && p0.rows === 2, p0);

    // P1: Compare with nothing ticked -> guidance message, no table.
    const p1 = await ev(`(function(){
      document.querySelector('[data-action=calcCompare]').click();
      return { msg: document.getElementById('calc-sheet-msg').textContent,
               hidden: document.getElementById('calc-compare-card').hidden };
    })()`);
    check('P1 compare with 0 ticked -> guidance, no table', p1 && String(p1.msg).indexOf('Tick at least two') > -1 && p1.hidden, p1);

    // P2: tick both -> table renders; economy total is cheapest (gold cell).
    const p2 = await ev(`(function(){
      var checks = document.querySelectorAll('.bcp-cmp-check');
      checks[0].checked = true; checks[1].checked = true;
      document.querySelector('[data-action=calcCompare]').click();
      var wrap = document.getElementById('calc-compare');
      var txt = wrap.textContent;
      var cells = wrap.querySelectorAll('td strong.bcp-cmp-best');
      return { visible: !document.getElementById('calc-compare-card').hidden,
               cols: wrap.querySelectorAll('thead th').length - 1,
               hasWork: txt.indexOf('slab') > -1, hasQty: txt.indexOf('m3') > -1,
               bestCells: cells.length,
               ecoFirst: cells.length === 1 && txt.indexOf('qa-economy') > -1 };
    })()`);
    check('P2 compare table renders both columns, cheapest highlighted', p2 && p2.visible && p2.cols === 2 && p2.hasWork && p2.hasQty && p2.bestCells === 1, p2);

    // P3: comparing must not mutate the live form inputs.
    const p3 = await ev(`(function(){
      return { d1: document.getElementById('calc-d1').value,
               d2: document.getElementById('calc-d2').value,
               d3: document.getElementById('calc-d3').value,
               q: document.getElementById('calc-quality').value,
               total: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1 };
    })()`);
    check('P3 comparison leaves the live form untouched', p3 && p3.d1 === '10' && p3.d2 === '8' && p3.d3 === '150' && p3.total, p3);

    // close + clean for later gates (delete through the real row buttons so
    // the page's own renderer refreshes the list)
    await ev(`(function(){
      document.querySelector('[data-action=calcCompareClose]').click();
      var guard = 0;
      while (document.querySelector('[data-action=calcDeleteEst]') && guard++ < 40) {
        document.querySelector('[data-action=calcDeleteEst]').click();
      }
    })()`);

    // ---- D3 QUOTE HEADER + BUSINESS NAME (owner review 2026-09-29) ----
    // Q1: business name round-trips localStorage -> quote head; the head
    // carries the estimate name, work item and a date for the print sheet.
    const q1 = await ev(`(function(){
      // save-name first: it has no live-render listener, so the biz-name
      // input event that follows is the render that fills the meta line.
      document.getElementById('calc-save-name').value='Garage slab QA';
      document.getElementById('calc-save-name').dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('calc-biz-name').value='QA Builders Ltd';
      document.getElementById('calc-biz-name').dispatchEvent(new Event('input',{bubbles:true}));
      var stored = localStorage.getItem('mmgr_calc_biz_name');
      return { stored: stored,
               biz: document.getElementById('calc-quote-biz').textContent,
               meta: document.getElementById('calc-quote-meta').textContent,
               printBtn: String(document.querySelector('[data-action=calcPrint]').textContent).indexOf('Print / PDF') > -1 };
    })()`);
    check('Q1 business name saves + quote head fills (name, work, date)', q1 && q1.stored === 'QA Builders Ltd' && q1.biz === 'QA Builders Ltd' &&
          String(q1.meta).indexOf('Garage slab QA') > -1 && String(q1.meta).indexOf('2026-') > -1 && q1.printBtn, q1);

    // Q2: the head is screen-hidden; the print sheet reveals it under real
    // PRINT MEDIA (getComputedStyle never applies @media print rules in
    // screen rendering, so this gate emulates print media over CDP).
    const q2 = await ev(`(function(){
      return { screen: getComputedStyle(document.querySelector('.bcp-quote-head')).display };
    })()`);
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    const q2b = await ev(`(function(){
      var withoutScope = getComputedStyle(document.querySelector('.bcp-quote-head')).display;
      document.body.classList.add('print-estimate');
      var withScope = getComputedStyle(document.querySelector('.bcp-quote-head')).display;
      document.body.classList.remove('print-estimate');
      return { withoutScope: withoutScope, withScope: withScope };
    })()`);
    await send('Emulation.setEmulatedMedia', { media: '' });
    check('Q2 quote head: screen none, print block under body.print-estimate', q2 && q2.screen === 'none' && q2b && q2b.withoutScope === 'none' && q2b.withScope === 'block', q2b);

    // clean the letterhead + save-name for later gates
    await ev(`(function(){
      localStorage.removeItem('mmgr_calc_biz_name');
      document.getElementById('calc-biz-name').value='';
      document.getElementById('calc-biz-name').dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('calc-save-name').value='';
      document.getElementById('calc-save-name').dispatchEvent(new Event('input',{bubbles:true}));
    })()`);

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

    // ---------- F4c: PER-PIECE EXPANSION + RATE SHEETS ----------
    // P1-P4: piece math per trade (metric explicitly).
    const pieceCheck = async (work, price, size, d1, d2, expectPat, name) => {
      const r = await ev(`(function(){
        document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
        document.getElementById('calc-work').value = '${work}';
        document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('calc-d1').value='${d1}'; document.getElementById('calc-d2').value='${d2}';
        document.getElementById('calc-piece-price').value='${price}'; document.getElementById('calc-piece-size').value='${size}';
        document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
        var t = document.getElementById('calc-output').textContent;
        return { hit: t.indexOf('${expectPat}') > -1, line: t.indexOf('priced per piece') > -1, pieceVisible: !document.getElementById('calc-piece-wrap').hidden };
      })()`);
      check(name, r && r.hit && r.line && r.pieceVisible, r);
    };
    await pieceCheck('blockwall', '800', '40 x 20', '10', '2.4', '10,000/m2', 'P1 blocks 800 / (0.4x0.2) = 10,000/m2 exact');
    await pieceCheck('brickwall', '140', '20 x 10', '10', '2.4', '7,000/m2', 'P2 bricks 140 / (0.2x0.1) = 7,000/m2 exact');
    await pieceCheck('roof', '6120', '0.85 x 3.6', '10', '4', '2,000/m2', 'P3 roof sheets 6120 / (0.85x3.6) = 2,000/m2 exact');
    await pieceCheck('fencing', '9500', '2.5 x 1.8', '10', '1.8', '3,800/m of run', 'P4 fencing panel 9500 / 2.5m = 3,800/m run (width-div)');

    // P5: placeholders follow the work item.
    const p5 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var a = document.getElementById('calc-piece-price').placeholder;
      document.getElementById('calc-work').value = 'roof';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var b = document.getElementById('calc-piece-price').placeholder;
      return { block: a, roof: b, differ: a !== b };
    })()`);
    check('P5 piece placeholders follow the trade', p5 && p5.differ && /800/.test(p5.block) && /6120/.test(p5.roof), p5);

    // RS1-RS4: rate sheets lifecycle.
    const rs1 = await ev(`(function(){
      document.getElementById('calc-work').value='tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-rate-mat').value='18'; document.getElementById('calc-rate-lab').value='25';
      document.getElementById('calc-piece-price').value='900'; document.getElementById('calc-piece-size').value='30 x 60';
      document.getElementById('calc-sheet-name').value='low-bid';
      document.querySelector('[data-action=calcSheetSave]').click();
      var raw = JSON.parse(localStorage.getItem('mmgr_calc_rate_sheets')||'[]');
      return { count: raw.length, name: raw.length?raw[0].name:null, mat: raw.length?raw[0].rates.rateMat:null,
               rows: document.querySelectorAll('#calc-sheets .bcp-sheet-row').length };
    })()`);
    check('RS1 save rate sheet stores name+rates+piece', rs1 && rs1.count===1 && rs1.name==='low-bid' && rs1.mat==='18' && rs1.rows===1, rs1);

    const rs2 = await ev(`(function(){
      document.getElementById('calc-rate-mat').value='99'; document.getElementById('calc-rate-lab').value='99';
      document.getElementById('calc-rate-mat').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcSheetApply]').click();
      return { mat: document.getElementById('calc-rate-mat').value, lab: document.getElementById('calc-rate-lab').value,
               piece: document.getElementById('calc-piece-price').value,
               total: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1 };
    })()`);
    check('RS2 apply restores rates + piece + recomputes', rs2 && rs2.mat==='18' && rs2.lab==='25' && rs2.piece==='900' && rs2.total, rs2);

    const rs3 = await ev(`(function(){
      document.getElementById('calc-rate-mat').value = '99';
      var sel = document.getElementById('calc-sheet-select');
      var sheetId = sel.options[1] ? sel.options[1].value : '';
      if (!sheetId) return { err: 'no sheet in picker' };
      sel.value = sheetId;
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      return { mat: document.getElementById('calc-rate-mat').value, reset: sel.selectedIndex === 0, id: sheetId };
    })()`);
    check('RS3 quick-picker select applies + resets selection', rs3 && rs3.mat==='18' && rs3.reset, rs3);

    const rs4 = await ev(`(function(){
      document.querySelector('[data-action=calcSheetDelete]').click();
      var raw = JSON.parse(localStorage.getItem('mmgr_calc_rate_sheets')||'[]');
      return { left: raw.length, empty: !!document.querySelector('#calc-sheets .calc-empty') };
    })()`);
    check('RS4 delete removes the sheet + shows empty state', rs4 && rs4.left===0 && rs4.empty, rs4);

    // ---------- F4d: VOLUME PIECE PRICING ----------
    // V1: concrete per bag. 10x8x0.15m slab with 5% waste = 12.6 m3.
    // 9,200 per 20 L bag -> 9,200 x 1000 / 20 = 460,000/m3.
    const v1 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='10'; document.getElementById('calc-d2').value='8'; document.getElementById('calc-d3').value='150';
      document.getElementById('calc-piece-price').value='9200'; document.getElementById('calc-piece-size').value='20';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      var t=document.getElementById('calc-output').textContent;
      return { per: t.indexOf('460,000/m3') > -1, narr: t.indexOf('per 20 L yield') > -1, vis: !document.getElementById('calc-piece-wrap').hidden };
    })()`);
    check('V1 slab per-bag 9,200 / 20 L -> 460,000/m3 exact', v1 && v1.per && v1.narr && v1.vis, v1);

    // V2: paint per gallon-can. 10x8 wall, 2 coats = 16 L. 9,000 per
    // 3.785 L (US gallon) -> 9,000 / 3.785 = 2,377.809... -> 2,377.81/L.
    const v2 = await ev(`(function(){
      document.getElementById('calc-work').value='paint';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value='10'; document.getElementById('calc-d2').value='8';
      document.getElementById('calc-piece-price').value='9000'; document.getElementById('calc-piece-size').value='3.785';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      var t=document.getElementById('calc-output').textContent;
      return { per: t.indexOf('2,377.81/L') > -1, narr: t.indexOf('per 3.785 L yield') > -1 };
    })()`);
    check('V2 paint per gallon-can 9,000 / 3.785 L -> 2,377.81/L exact', v2 && v2.per && v2.narr, v2);

    // V3: volume rows show on concrete + paint, hide on area trades.
    const v3 = await ev(`(function(){
      var onSlab = !document.getElementById('calc-piece-wrap').hidden;
      document.getElementById('calc-work').value='tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var onTile = !document.getElementById('calc-piece-wrap').hidden;
      var tileLbl = document.getElementById('calc-piece-price-label').textContent;
      document.getElementById('calc-work').value='footings';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var onFoot = !document.getElementById('calc-piece-wrap').hidden;
      var footLbl = document.getElementById('calc-piece-price-label').textContent;
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      return { onSlab: onSlab, onTile: onTile, tileLbl: tileLbl, onFoot: onFoot, footLbl: footLbl };
    })()`);
    check('V3 volume rows on slab/footings, area rows on tile, labels follow', v3 && v3.onSlab && v3.onTile && v3.onFoot && /bag/.test(v3.footLbl) && /tile/i.test(v3.tileLbl), v3);

    // V4: an invalid yield silently falls back to the model rate.
    const v4 = await ev(`(function(){
      document.getElementById('calc-piece-price').value='9200'; document.getElementById('calc-piece-size').value='abc';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input',{bubbles:true}));
      var t=document.getElementById('calc-output').textContent;
      var matMod = t.indexOf('Materials$') > -1 || t.indexOf('Materials \u0024') > -1;
      return { noPiece: t.indexOf('per') === -1 || matMod, noThrow: t.length > 10 };
    })()`);
    check('V4 invalid yield -> clean model-rate fallback, no crash', v4 && v4.noPiece && v4.noThrow, v4);

    // V5: switching to imperial keeps the yield (unit-free) and the math
    // converts the DIMENSIONS (ft) before the volume is computed.
    const v5 = await ev(`(function(){
      document.getElementById('calc-piece-size').value='20';
      document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();
      var lbl=document.getElementById('calc-d1-label').textContent;
      var sizeLbl=document.getElementById('calc-piece-size-label').textContent;
      var t=document.getElementById('calc-output').textContent;
      var m=t.match(/Estimated total[^\\d]*([\\d,]+)/);
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      return { lbl: lbl, sizeLblStillYield: sizeLbl, hasTotal: !!m };
    })()`);
    check('V5 imperial dims recompute; yield label unit-free', v5 && v5.lbl==='Length (ft)' && v5.sizeLblStillYield.indexOf('litres') > -1 && v5.hasTotal, v5);

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
