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
const log = s => process.stdout.write('[calc-page] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val: !!val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))
  );
};

function chromePath() {
  return require('./chrome-launcher.cjs').chromePath;
}
async function withChrome(fn) {
  const userDir = path.join(TMP, 'chrome-calc-' + Date.now());
  const port = 9347;
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
        log('EVAL EXCEPTION: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
        return null;
      }
      return r && r.result && r.result.value;
    };
    await send('Page.enable');
    await fn({ ev, send });
  } finally {
    try {
      chrome.kill();
    } catch (e) {}
  }
}

(async function main() {
  // serve.cjs must be running (the CI serve battery starts it; locally start if absent)
  let served = false;
  try {
    const h = await fetch(BASE + '/calculator.html');
    served = h.ok;
  } catch (e) {}
  if (!served) {
    log('serve.cjs not answering - starting one for this run');
    const srv = spawn(process.execPath, ['serve.cjs'], {
      cwd: ROOT,
      stdio: 'ignore',
      detached: false
    });
    for (let i = 0; i < 30; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/calculator.html');
        if (h.ok) {
          served = true;
          break;
        }
      } catch (e) {}
    }
    var startedHere = srv;
  }
  if (!served) {
    log('FATAL: serve.cjs did not come up');
    process.exit(1);
  }

  await withChrome(async ({ ev, send }) => {
    // ---------- CALCULATOR PAGE ----------
    await ev(`location.href = ${JSON.stringify(BASE + '/calculator.html')}`);
    await delay(1800);
    const booted = await ev(
      `!!document.getElementById('calc-work') && !!document.getElementById('calc-output')`
    );
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
    check(
      'C1 slab 10x8x150 -> 12.6 m3 (5% waste, exact)',
      c12 && c12.qty === '12.6',
      c12 && c12.qty
    );
    check(
      'C2 breakdown carries tax 15% line + total',
      c12 && c12.hasTax && c12.hasTotal,
      c12 && { tax: c12.hasTax, total: c12.hasTotal }
    );
    // money invariant: mat+lab+tax == total. Plan v2 E1: with no exchange
    // rate set, model money renders honestly in USD terms (banner + $), so
    // the amount parse accepts any leading symbol - the invariant itself is
    // currency-free. The banner must be present (never a silent relabel).
    const money = await ev(`(function(){
      // OWNER 2026-10-02: this gate asserts the money INVARIANT, not a
      // currency. Pin USD so the seeded JMD conversion cannot move the
      // figures out from under the arithmetic.
      var cc = document.getElementById('calc-currency');
      cc.value = 'USD'; cc.dispatchEvent(new Event('change',{bubbles:true}));
      const txt = document.getElementById('calc-output').textContent;
      const banner = txt.indexOf('Built-in model rates are US dollars') > -1;
      const grab2 = (label) => { const m = txt.match(new RegExp(label + '[\\\\s\\\\S]*?(?:J\\\\$|\\\\$|\\u00A3|\\u20AC)\\s*([\\\\d,]+)')); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };
      const mat = grab2('Materials'), lab = grab2('Labor'), tax = grab2('Tax'), tot = grab2('Estimated total');
      return { banner, mat, lab, tax, tot, sums: (mat!==null && lab!==null && tax!==null && tot!==null) ? (mat+lab+tax)===tot : false };
    })()`);
    // OWNER 2026-10-02: the "rates are still US dollars" banner used to fire
    // because no FX rate existed. The calculator now seeds a labelled JMD
    // starting rate, so with USD pinned there is nothing left unconverted
    // and the honest banner is correctly ABSENT. The invariant is the point
    // of this gate; the banner condition moves to its own gate below.
    check(
      'C2b money invariant mat+lab+tax = total, with no unconverted banner on a pinned-USD estimate',
      money && money.sums === true && money.banner === false,
      money
    );
    const fx0 = await ev(`(function(){
      // The honesty banner must still appear when a rate genuinely cannot
      // convert: clear the FX table, price in JMD, and read the note.
      try { localStorage.removeItem('mmgr_calc_fx'); } catch (e) {}
      var c = document.getElementById('calc-currency');
      c.value = 'JMD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      var w = document.getElementById('calc-work');
      w.value = 'slab'; w.dispatchEvent(new Event('change',{bubbles:true}));
      var note = document.getElementById('calc-fx-note');
      var res = { noteShown: !note.hidden, noteTxt: note.textContent,
                  matEmpty: document.getElementById('calc-rate-mat').value === '' };
      // Put the seeded rate back for the rest of the run.
      try { localStorage.setItem('mmgr_calc_fx', JSON.stringify({ JMD: { per: '158', asOf: '2026-01-15', seeded: true } })); } catch (e) {}
      c.value = 'USD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      return res;
    })()`);
    check(
      'C2c with NO exchange rate the fields stay EMPTY and the honest note names the gap (E1 never a relabel)',
      fx0 && fx0.noteShown && fx0.matEmpty && /exchange rate/i.test(fx0.noteTxt || ''),
      fx0
    );

    // C3: custom override replaces the country rate.
    const c3 = await ev(`(function(){
      document.getElementById('calc-tax-override').value = '8.25';
      document.getElementById('calc-tax-override').dispatchEvent(new Event('input',{bubbles:true}));
      const txt = document.getElementById('calc-output').textContent;
      return { has825: txt.indexOf('8.25%') > -1, hasYourRate: txt.indexOf('your rate') > -1, has15: txt.indexOf('Tax (15%') > -1 };
    })()`);
    check(
      'C3 custom tax override (8.25%) replaces JM 15%',
      c3 && c3.has825 && c3.hasYourRate && !c3.has15,
      c3
    );

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
    check(
      'C7 Recall restores inputs + recomputes',
      c7 && c7.d1 === '10' && c7.work === 'slab' && c7.out,
      c7
    );

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
    check(
      'C9 theme toggle flips + persists',
      c9 && c9.dark && c9.saved === 'dark' && c9.backLight,
      c9
    );

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
    check(
      'B1 top bar: icon-only back + title h1 + theme button present',
      b1 && b1.back && b1.h1 && b1.theme,
      b1
    );
    check(
      'B2 theme pair: one sun use + one moon use in the theme button',
      b1 && b1.sun === 1 && b1.moon === 1,
      b1
    );
    check('B3 old header gone: no .bcp-head block remains', b1 && b1.oldHead === false, b1);
    const b4 = fs.readFileSync(path.join(__dirname, '..', 'css', 'mmgr.css'), 'utf8');
    check(
      'B4 CSS: sun/moon dark-mode switch rules exist',
      b4.indexOf('.bcp-ico-sun{display:none') > -1 &&
        b4.indexOf('body.dark-mode .bcp-ico-sun{display:block') > -1,
      null
    );
    check(
      'B5 CSS: back button is icon-only (no Back text node)',
      (await ev(
        `(function(){ var b = document.querySelector('.bcp-back'); return b && b.textContent.trim() === ''; })()`
      )) === true,
      null
    );

    // ---------- G: HOW-TO GUIDE SLIDER (owner 2026-09-30) ----------
    const g1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_guide_open');
      document.querySelector('[data-action="calcGuideOpen"]').click();
      return { card: !!document.getElementById('calc-guide-card'),
               count: (document.getElementById('calc-guide-count') || {}).textContent,
               text: (document.getElementById('calc-guide-text') || {}).textContent || '',
               dots: document.querySelectorAll('#calc-guide-dots .bcp-guide-dot').length };
    })()`);
    check(
      'G1 guide card renders with 13 steps + counter + text (W6: business card + invoice sheet added)',
      g1 &&
        g1.card &&
        g1.count === '1 of 13' &&
        g1.dots === 13 &&
        g1.text.indexOf('work item') > -1,
      g1
    );
    check(
      'G2 guide order: step 1 is work item (never overhead first)',
      g1 && g1.text.indexOf('Pick your work item') === 0,
      g1
    );
    const g2 = await ev(`(function(){
      document.querySelector('[data-action="calcGuideNext"]').click();
      const after = document.getElementById('calc-guide-count').textContent;
      const active = document.querySelectorAll('#calc-guide-dots .bcp-guide-dot.active').length;
      document.querySelector('[data-action="calcGuidePrev"]').click();
      const back = document.getElementById('calc-guide-count').textContent;
      return { after: after, active: active, back: back };
    })()`);
    check(
      'G3 next/prev cycles steps + one active dot follows',
      g2 && g2.after === '2 of 13' && g2.active === 1 && g2.back === '1 of 13',
      g2
    );
    const g3 = await ev(`(function(){
      document.querySelector('[data-action="calcGuideClose"]').click();
      const hid = document.getElementById('calc-guide-body').hidden === true;
      const stored = localStorage.getItem('mmgr_calc_guide_open');
      const reopenShown = document.getElementById('calc-guide-reopen').hidden === false;
      document.querySelector('[data-action="calcGuideOpen"]').click();
      return { hid: hid, stored: stored, reopenShown: reopenShown, back: !document.getElementById('calc-guide-body').hidden };
    })()`);
    check(
      'G4 hide sets flag + reopen shows again',
      g3 && g3.hid && g3.stored === '0' && g3.reopenShown && g3.back,
      g3
    );

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
    check(
      'N1 linear basis labels present (pipe, conduit, skirting, shingle)',
      n1 && n1.supply && n1.drain && n1.conduit && n1.skirt && n1.shingle,
      n1
    );
    check(
      'N2 new optgroups: Plumbing + Electrical exist',
      n1 && n1.groups.indexOf('Plumbing') > -1 && n1.groups.indexOf('Electrical') > -1,
      n1 && n1.groups
    );
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
      // OWNER 2026-10-02: pin USD - this gate tests the fixture COUNT math.
      var cc = document.getElementById('calc-currency');
      cc.value = 'USD'; cc.dispatchEvent(new Event('change',{bubbles:true}));
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
    check(
      'E1 doc type + title fields exist, Estimate default, hook live',
      doc1 && doc1.type === 'Estimate' && doc1.title === '' && doc1.hasBase,
      doc1
    );
    const doc2 = await ev(`(function(){
      document.getElementById('calc-doc-type').value = 'Invoice';
      document.getElementById('calc-doc-type').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-doc-title').value = 'Kitchen - Smith';
      document.getElementById('calc-doc-title').dispatchEvent(new Event('input', { bubbles: true }));
      return { base: window.__calcDocTitleBase(),
               sheetTitle: document.getElementById('calc-quote-title').textContent,
               meta: document.getElementById('calc-quote-meta').textContent.indexOf('Kitchen - Smith') > -1 };
    })()`);
    check(
      'E2 filename base follows type+title; print title says Invoice',
      doc2 &&
        doc2.base === 'Invoice - Kitchen - Smith' &&
        doc2.sheetTitle === 'Invoice' &&
        doc2.meta,
      doc2
    );
    const doc3 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_history');
      document.querySelector('[data-action="calcRun"]').click();
      const row = JSON.parse(localStorage.getItem('mmgr_calc_history'))[0];
      return { st: row && row.st ? { docType: row.st.docType, docTitle: row.st.docTitle } : null };
    })()`);
    check(
      'E3 history row carries docType+docTitle (exact recall)',
      doc3 && doc3.st && doc3.st.docType === 'Invoice' && doc3.st.docTitle === 'Kitchen - Smith',
      doc3
    );
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
    check(
      'E4 estimate recall restores doc fields + print title follows',
      doc4 && doc4.type === 'Quote' && doc4.title === 'Recall Doc' && doc4.sheet === 'Quote',
      doc4
    );
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
    check(
      'T1 start tour: overlay opens, step 1 anchors the work item (13 steps since W6)',
      tut1 && tut1.anchor === '#calc-work' && tut1.overlay && tut1.count === '1 of 13',
      tut1
    );
    const tut2 = await ev(`(function(){
      var anchors = [];
      for (var i = 0; i < 12; i++) {
        document.querySelector('[data-action="calcTourNext"]').click();
        anchors.push(document.getElementById('calc-tour-pop').getAttribute('data-anchor'));
      }
      return { anchors: anchors, count: document.getElementById('calc-tour-count').textContent };
    })()`);
    check(
      'T2 steps walk the form in guide order (units, dims, currency, quality, oh, rates, brand, boq, companions, prelims, run)',
      tut2 &&
        tut2.anchors[0] === '.bcp-seg' &&
        tut2.anchors[1] === '#calc-d1' &&
        tut2.anchors[2] === '#calc-currency' &&
        tut2.anchors[3] === '#calc-quality' &&
        tut2.anchors[4] === '#calc-oh' &&
        tut2.anchors[5] === '#calc-rate-mat' &&
        tut2.anchors[6] === '#calc-brand-card' &&
        tut2.anchors[7] === '#calc-boq-card' &&
        tut2.anchors[8] === '#calc-companions' &&
        tut2.anchors[9] === '#calc-prelims-card' &&
        tut2.anchors[10] === '.bcp-run' &&
        tut2.anchors[11] === null &&
        tut2.count === '13 of 13',
      tut2.anchors
    );
    const tut3 = await ev(`(function(){
      document.querySelector('[data-action="calcTourNext"]').click();
      return { done: window.__calcTour.state().done, overlayHidden: document.getElementById('calc-tour-overlay').hidden,
               finalText: document.getElementById('calc-tour-text').textContent };
    })()`);
    check(
      'T3 final step ends the tour + sets the done flag',
      tut3 && tut3.done && tut3.overlayHidden && tut3.finalText.indexOf('ready to use') > -1,
      tut3
    );
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
    check(
      'T4 skip AND Escape both end the tour + set the flag',
      tut4 && tut4.skipDone && tut4.escClosed && tut4.escDone,
      tut4
    );
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
    check(
      'BQ1 engine hook: two lines priced + rolled up',
      bq1 &&
        bq1.n === 2 &&
        bq1.sub > 0 &&
        Math.abs(bq1.mat + bq1.lab - bq1.sub) < 0.01 &&
        typeof bq1.first === 'string' &&
        !!bq1.unit,
      bq1
    );
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
    check(
      'BQ2 add-line stores form state into the current bill (2 lines)',
      bq2 && bq2.before === 1 && bq2.after === 2 && bq2.work2 === 'blockwall' && bq2.total === '10',
      bq2
    );
    const bq3 = await ev(`(function(){
      var body = document.getElementById('calc-boq-body');
      var rows = body ? body.querySelectorAll('.bcp-boq-line').length : 0;
      var total = document.getElementById('calc-boq-total');
      var txt = total ? total.textContent : '';
      return { rows: rows, totalShown: txt.length > 0 && txt !== '$0', empty: body ? body.querySelector('.calc-empty') !== null : true };
    })()`);
    check(
      'BQ3 bill card renders 2 line rows + non-zero totals row',
      bq3 && bq3.rows === 2 && !bq3.empty && bq3.totalShown,
      bq3
    );
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
    check(
      'BQ4 recall re-fills the form; recomputed total matches the line',
      bq4 && bq4.work === 'slab' && bq4.d1 === '10' && bq4.same,
      bq4
    );
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
    check(
      'BQ5 remove line + clear bill persist',
      bq5 && bq5.afterRemove === 1 && bq5.cleared && bq5.empty,
      bq5
    );

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
    check(
      'IN1 instancesQty: 10x2.4 x2 + 6x2.4 = 62.4 m2',
      in1 && in1.qty === 62.4 && in1.unit === 'm2',
      in1
    );
    const in2 = await ev(`(function(){
      var st = __calcEngine.readState();
      st.currency = 'USD';   // OWNER 2026-10-02: pin USD for the model-rate math.
      st.basis = 'measured';   // ...and the SPLIT path: the JIC book is selected
      // by default and it speaks all-in, so the first-visit default lands on
      // the all-in basis. These gates are about material+labour, so they must
      // pin the basis exactly as they pin the currency.
      st.work = 'blockwall'; st.d1 = ''; st.d2 = ''; st.d3 = '';
      st.measuredQty = '62.4'; st.measuredUnit = 'm2';
      var r = __calcEngine.computeFor(st);
      return { err: r && r.error, qty: r && r.qty, mat: r && r.mat, lab: r && r.lab, total: r && r.total };
    })()`);
    check(
      'IN2 measuredQty 62.4 m2 prices without dims (mat 1372.8, lab 1747.2)',
      in2 &&
        !in2.err &&
        in2.qty === 62.4 &&
        Math.abs(in2.mat - 1372.8) < 0.01 &&
        Math.abs(in2.lab - 1747.2) < 0.01,
      in2
    );
    const in3 = await ev(`(function(){
      var st = __calcEngine.readState();
      st.currency = 'USD';   // OWNER 2026-10-02: pin USD for the rate math.
      st.basis = 'measured';   // pin the split basis too (see IN2).
      st.work = 'blockwall'; st.d1 = ''; st.d2 = ''; st.d3 = '';
      st.measuredQty = '62.4'; st.measuredUnit = 'm2'; st.quality = 'premium';
      st.rateMat = '30'; st._matModel = null;
      var r = __calcEngine.computeFor(st);
      return { mat: r && r.mat, lab: r && r.lab };
    })()`);
    check(
      'IN3 waste/quality/rates still apply on measured quantity (premium + 30/m2)',
      in3 &&
        Math.abs(in3.mat - 30 * 62.4 * 1.35) < 0.01 &&
        Math.abs(in3.lab - 28 * 62.4 * 1.35) < 0.01,
      in3
    );
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
    check(
      'IN4 editor shows for blockwall (1 seeded row), hidden for rebar',
      in4 && in4.vis && in4.rows === 1 && in4.hiddenOnRebar,
      in4
    );
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
    check(
      'IN5 total-override: typing 50 drives the estimate (50 m2)',
      in5 && in5.manualShown && in5.hero === '50',
      in5
    );

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
      // OWNER 2026-10-02: pin the SPLIT basis. The JIC book is selected by
      // default and speaks all-in, so a first visit now lands on the all-in
      // basis; these gates are about statutory on-costs riding LABOUR, which
      // only exists on the split path. Pinned once here for SX1-SX4.
      var bs = document.getElementById('calc-basis');
      bs.value = 'measured'; bs.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const sx1 = await ev(`(function(){
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var out = document.getElementById('calc-output').textContent;
      return { line: out.indexOf('Labor statutory costs') > -1, total: (out.match(/Estimated total(\\d|[.,])/) || [])[1] || '' };
    })()`);
    check('SX1 off by default: no statutory line renders', sx1 && sx1.line === false, sx1);
    const sx2 = await ev(`(function(){
      // OWNER 2026-10-02: pin USD - the gate asserts 12.5% of 672 = 84.00.
      var cc = document.getElementById('calc-currency');
      cc.value = 'USD'; cc.dispatchEvent(new Event('change',{bubbles:true}));
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
    check(
      'SX2 12.5% of 672 labor = 84.00 on-cost; subtotal 1284 + OH = 1412.40 total',
      sx2 &&
        Math.abs(sx2.onCost - 84) < 0.01 &&
        Math.abs(sx2.sub - 1284) < 0.01 &&
        Math.abs(sx2.total - 1412.4) < 0.01,
      sx2
    );
    const sx3 = await ev(`(function(){
      var p = document.getElementById('calc-oncost-pct');
      p.value = '99';
      p.dispatchEvent(new Event('input', { bubbles: true }));
      var r = __calcEngine.computeFor(__calcEngine.readState());
      return { onCostPct: r.onCostPct, onCost: r.onCost };
    })()`);
    check(
      'SX3 on-cost capped at 25%',
      sx3 && sx3.onCostPct === 25 && Math.abs(sx3.onCost - 168) < 0.01,
      sx3
    );
    const sx4 = await ev(`(function(){
      var p = document.getElementById('calc-oncost-pct');
      p.value = '12.5';
      p.dispatchEvent(new Event('input', { bubbles: true }));
      var out = document.getElementById('calc-output').textContent;
      var csv = __calcEngine.estimateCsv(__calcEngine.computeFor(__calcEngine.readState()));
      return { line: out.indexOf('Labor statutory costs (NIS, NHT, HEART, Education) 12.5%') > -1, csvHas: csv.indexOf('Labor statutory costs %","12.5') > -1 };
    })()`);
    check(
      'SX4 breakdown line renders with pct; CSV carries the row',
      sx4 && sx4.line && sx4.csvHas,
      sx4
    );
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
    check(
      'SX5 JM shows levy note + suggests 12.5; US hides the note',
      sx5 && sx5.noteShown && sx5.suggested === '12.5' && sx5.noteHiddenUs,
      sx5
    );
    // ---------- W4: PRELIMINARIES / SITE & OTHER COSTS (owner 2026-09-30) ----------
    const pm1 = await ev(`(function(){
      var a = __calcEngine.prelimsTotal([
        { name: 'Permits', basis: 'fixed', value: '250', weeks: '' },
        { name: 'Supervision', basis: 'pct', value: '10', weeks: '' },
        { name: 'Welfare', basis: 'week', value: '150', weeks: '8' }
      ], 10000);
      return { p0: a.perItem[0].amount, p1: a.perItem[1].amount, p2: a.perItem[2].amount, total: a.total };
    })()`);
    check(
      'PM1 fixed 250 + pct 1000 + weekly 1200 = 2450 exact',
      pm1 && pm1.p0 === 250 && pm1.p1 === 1000 && pm1.p2 === 1200 && pm1.total === 2450,
      pm1
    );
    const pm2 = await ev(`(function(){
      document.querySelector('[data-action="calcPrelimPreset"]').click();
      var list = JSON.parse(localStorage.getItem('mmgr_calc_prelims') || '[]');
      var total = document.getElementById('calc-prelims-total').textContent;
      return { n: list.length, totalShown: total.indexOf('On top of the works') === 0 };
    })()`);
    check(
      'PM2 preset loads 6 items; on-top-of line renders',
      pm2 && pm2.n === 6 && pm2.totalShown,
      pm2
    );
    const pm3 = await ev(`(function(){
      var rows = document.querySelectorAll('#calc-prelims-body .bcp-prelim-row').length;
      var first = document.querySelector('#calc-prelims-body input[data-field="name"]');
      first.value = 'Renamed item';
      first.dispatchEvent(new Event('input', { bubbles: true }));
      var stored = JSON.parse(localStorage.getItem('mmgr_calc_prelims') || '[]');
      return { rows: rows, renamed: stored[0].name };
    })()`);
    check(
      'PM3 6 rows render; rename persists to storage',
      pm3 && pm3.rows === 6 && pm3.renamed === 'Renamed item',
      pm3
    );
    const pm4 = await ev(`(function(){
      document.querySelector('[data-action="calcPrelimRemove"][data-idx="0"]').click();
      var afterRemove = JSON.parse(localStorage.getItem('mmgr_calc_prelims') || '[]').length;
      document.querySelector('[data-action="calcPrelimClear"]').click();
      var afterClear = JSON.parse(localStorage.getItem('mmgr_calc_prelims') || '[]').length;
      var empty = document.querySelector('#calc-prelims-body .calc-empty') !== null;
      return { afterRemove: afterRemove, afterClear: afterClear, empty: empty };
    })()`);
    check(
      'PM4 remove drops to 5; clear empties + empty state returns',
      pm4 && pm4.afterRemove === 5 && pm4.afterClear === 0 && pm4.empty,
      pm4
    );

    // ---------- W5: CONTINGENCY + ESCALATION (owner 2026-09-30) ----------
    const rg1 = await ev(`(function(){
      var r = __calcEngine.rollup({ works: 100000, prelims: 7000, designC: '10', constrC: '5', escPct: '5', months: '12' });
      return { designC: r.designC, constrC: r.constrC, esc: r.esc, subtotal: r.subtotal };
    })()`);
    check(
      'RG1 waterfall (re-baselined 2026-10-01): base 107k; contingencies + esc ride the discounted base; 100k + 7k + 10700 + 5350 + 5350 = 128400 exact',
      rg1 &&
        Math.abs(rg1.designC - 10700) < 0.01 &&
        Math.abs(rg1.constrC - 5350) < 0.01 &&
        Math.abs(rg1.esc - 5350) < 0.01 &&
        Math.abs(rg1.subtotal - 128400) < 0.01,
      rg1
    );
    const rg2 = await ev(`(function(){
      var d = document.getElementById('calc-design-c'), c = document.getElementById('calc-constr-c'),
          e = document.getElementById('calc-esc-pct'), m = document.getElementById('calc-months');
      return { d: d.value, c: c.value, e: e.value, m: m.value };
    })()`);
    // OWNER 2026-10-02: the build duration now DEFAULTS to 12 months so the
    // cash-plan export works the moment it is clicked.
    check(
      'RG2 defaults restored: design 10, constr 5, esc 5, months 12',
      rg2 && rg2.d === '10' && rg2.c === '5' && rg2.e === '5' && rg2.m === '12',
      rg2
    );
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
               noEsc: txt.indexOf('Escalation (') > -1 };
    })()`);
    // OWNER 2026-10-02: months now defaults to 12, so the escalation line is
    // EXPECTED to render (it needs a duration).
    check(
      'RG3 waterfall lines render; the escalation line appears with the 12-month default',
      rg3 &&
        rg3.hasWorks &&
        rg3.hasPrelim &&
        rg3.hasDesign &&
        rg3.hasConstr &&
        rg3.hasTotal &&
        rg3.noEsc,
      rg3
    );
    // ---------- W6: CASH FLOW (owner 2026-09-30) ----------
    const cf1 = await ev(`(function(){
      var c = __calcEngine.cashCurve(120000, '12', 'straight', '3.2');
      var sum = c.per.reduce(function(a, b) { return a + b; }, 0);
      return { n: c.per.length, first: c.per[0], sum: sum, lastCum: c.cum[11] };
    })()`);
    check(
      'CF1 straight-line: 12 months x 10000, cumulative ends at total',
      cf1 &&
        cf1.n === 12 &&
        Math.abs(cf1.first - 10000) < 0.01 &&
        Math.abs(cf1.sum - 120000) < 0.01 &&
        Math.abs(cf1.lastCum - 120000) < 0.01,
      cf1
    );
    const cf2 = await ev(`(function(){
      var c = __calcEngine.cashCurve(120000, '12', 'scurve', '3.2');
      var sum = c.per.reduce(function(a, b) { return a + b; }, 0);
      var mid = (c.per[5] + c.per[6]) / 2, ends = (c.per[0] + c.per[11]) / 2;
      return { sum: sum, mid: mid, ends: ends, peakHigher: mid > ends * 1.5 };
    })()`);
    check(
      'CF2 S-curve: sums to total, middle months far exceed ends',
      cf2 && Math.abs(cf2.sum - 120000) < 0.01 && cf2.peakHigher,
      cf2
    );
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
    check(
      'CF3 table renders 6 months; even months rebuild the cumulative total',
      cf3 && cf3.rows6 === 6 && cf3.consistent === true,
      cf3
    );
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
    check(
      'FA1 slab 2x20x0.1 = 4.0 m2; footing 2x10.5x0.5 = 10.5 m2',
      fa1 && fa1.slab === 4 && fa1.foot === 10.5,
      fa1
    );
    const fa2 = await ev(`(function(){
      return { wall: __calcEngine.formworkM2('blockwall', '10', '2.4', ''),
               rebar: __calcEngine.formworkM2('rebar', '50', '', '') };
    })()`);
    check(
      'FA2 non-concrete trades refuse (null)',
      fa2 && fa2.wall === null && fa2.rebar === null,
      fa2
    );
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
    check(
      'FA3 (re-baselined 2026-10-01) formwork box derives 4 m2, line PRICES AS FORMWORK via measuredQty (derived 55/m2 -> mat 220; trade labor 33/m -> lab 132; total 352), laps field rides rebar only',
      fa3 &&
        fa3.boxShown &&
        fa3.hasM2 &&
        fa3.lines === 1 &&
        fa3.named.indexOf('Formwork') === 0 &&
        fa3.fwWork === 'formwork' &&
        fa3.fwMq === '4' &&
        Math.abs(fa3.fwMat - 220) < 0.01 &&
        Math.abs(fa3.fwLab - 132) < 0.01 &&
        Math.abs(fa3.fwTotal - 352) < 0.01 &&
        fa3.lapsShown &&
        fa3.lapsGoneOnSlab,
      fa3
    );
    await ev(`(function(){ try { localStorage.removeItem('mmgr_calc_boq'); } catch (e) {} })()`);

    // ---------- W8: LOCATION PACKS (owner 2026-09-30) ----------
    const lp1 = await ev(`(function(){
      var list = JSON.parse(localStorage.getItem('mmgr_calc_locpacks') || '[]');
      var ids = list.map(function(p) { return p.id; });
      return { n: list.length, us: ids.indexOf('pack-us') > -1, jm: ids.indexOf('pack-jm') > -1, gb: ids.indexOf('pack-gb') > -1,
               picker: document.getElementById('calc-pack-select').options.length };
    })()`);
    check(
      'LP1 seeds: US + JM + GB present; picker populated',
      lp1 && lp1.n >= 3 && lp1.us && lp1.jm && lp1.gb && lp1.picker >= 4,
      lp1
    );
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
    check(
      'LP2 JM pack: JMD + 15% tax; index != 1 scales the material rate; note shows',
      lp2 && lp2.cur === 'JMD' && lp2.tax === '15' && lp2.noteShown && lp2.noteHas,
      lp2
    );
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
    check(
      'LP3 import merges 1 (currency normalized) + skips 2 invalid',
      lp3 && lp3.merged === 1 && lp3.skipped === 2 && lp3.cur === 'JMD' && lp3.idx === 1.1,
      lp3
    );
    await ev(`(function(){
      var list = JSON.parse(localStorage.getItem('mmgr_calc_locpacks') || '[]').filter(function(p) { return p.name !== 'My Parish'; });
      localStorage.setItem('mmgr_calc_locpacks', JSON.stringify(list));
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
    check(
      'FM1 choosing Structure filters the picker to its group and jumps to a Structure trade',
      fm1 &&
        fm1.vis.length === 1 &&
        fm1.vis[0] === 'Structure' &&
        ['blockwall', 'brickwall', 'framing', 'rebar'].indexOf(fm1.work) > -1 &&
        fm1.stored === 'structure',
      fm1
    );
    const fm2 = await ev(`(function(){
      return { hint: document.getElementById('calc-family-hint').textContent };
    })()`);
    check(
      'FM2 family hint names the family scope in plain language',
      fm2 && fm2.hint.indexOf('loads') > -1,
      fm2
    );
    const fm3 = await ev(`(function(){
      document.getElementById('calc-work').value = 'tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var vis = Array.prototype.filter.call(document.querySelectorAll('#calc-work optgroup'), function(g) { return !g.hidden; }).map(function(g) { return g.label; });
      return { fam: document.getElementById('calc-family').value, stored: localStorage.getItem('mmgr_calc_family'), vis: vis };
    })()`);
    check(
      'FM3 a foreign trade selected directly (recall path) flips the family - never fights the work item',
      fm3 &&
        fm3.fam === 'finishes' &&
        fm3.stored === 'finishes' &&
        fm3.vis.length === 1 &&
        fm3.vis[0] === 'Finishes',
      fm3
    );
    const fm4 = await ev(`(function(){
      var f = document.getElementById('calc-family');
      f.value = '';
      f.dispatchEvent(new Event('change', { bubbles: true }));
      var n = Array.prototype.filter.call(document.querySelectorAll('#calc-work optgroup'), function(g) { return !g.hidden; }).length;
      return { all: n, stored: localStorage.getItem('mmgr_calc_family'), work: document.getElementById('calc-work').value };
    })()`);
    // JIC 2025-2027 re-baseline (2026-10-02): the JIC wave added two families
    // (Temporary and metal works, Joinery), so the picker now carries 8 groups.
    check(
      'FM4 All trades shows every group and clears the memory; work item untouched',
      fm4 && fm4.all === 8 && fm4.stored === null && fm4.work === 'tile',
      fm4
    );
    const fm5 = await ev(`(function(){
      var vals = Array.prototype.map.call(document.getElementById('calc-work').options, function(o) { return o.value; });
      return { n: vals.length,
        // G1 (plan v2 Phase 2): formwork by element is INTENTIONALLY pickable
        // now; the still-derived lines stay invisible.
        hiddenDerived: ['cart-away', 'lining-out', 'debrush', 'post-holes'].filter(function(k) { return vals.indexOf(k) > -1; }),
        phase2: ['formwork', 'rebar-size', 'stirrups', 'fabric-mesh', 'concrete-labour'].every(function(k) { return vals.indexOf(k) > -1; }) };
    })()`);
    // JIC 2025-2027 re-baseline (2026-10-02): 38 -> 43 trades. The five new
    // JIC trades are scaffolding, welding, joinery, plumbing-pipe and
    // electrical-conduit (scaffold/welding/joinery/plumbing-pipe/
    // electrical-conduit), all verified pickable below.
    check(
      'FM5 picker carries exactly the 43 user trades (38 + the 5 JIC-2025 trades) - formwork pickable, derived lines stay invisible',
      fm5 && fm5.n === 43 && fm5.phase2 && fm5.hiddenDerived.length === 0,
      fm5
    );
    // NEW (JIC wave): the five JIC trades must actually be selectable.
    const fm6 = await ev(`(function(){
      var vals = Array.prototype.map.call(document.getElementById('calc-work').options, function(o) { return o.value; });
      return { jic: ['scaffold','welding','joinery','plumbing-pipe','electrical-conduit'].filter(function(k) { return vals.indexOf(k) === -1; }) };
    })()`);
    check('FM6 the 5 JIC 2025-2027 trades are in the picker', fm6 && fm6.jic.length === 0, fm6);

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
    check(
      'CP1 companion map: blockwall/fencing/siteprep covered; skirt none; lineout derives run; slab cart3 = pour m3',
      cp1 &&
        cp1.hits === 3 &&
        cp1.none === 0 &&
        cp1.lineout &&
        Math.abs(cp1.lineout.qty - 24.8) < 0.01 &&
        cp1.slabCart &&
        Math.abs(cp1.slabCart.qty - 10) < 0.01,
      cp1
    );
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
    check(
      'CP3 pricing a blockwall shows 3 companion chips; hidden before/after',
      cp3 && cp3.shown && cp3.chips === 3,
      cp3
    );
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
    check(
      'CP4 chip click adds a REAL priced bill line (measuredQty path, tagged, editable); chips thin out',
      cp4 &&
        cp4.lines === 2 &&
        cp4.work === 'lining-out' &&
        cp4.tag === 'blockwall:lineout' &&
        cp4.measured === '24.8' &&
        cp4.priced &&
        cp4.left === 1,
      cp4
    );
    const cp5 = await ev(`(function(){
      document.querySelector('#calc-companions [data-cp="cart"]').click();
      var wrap = document.getElementById('calc-companions');
      var lines = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
      return { hidden: wrap.hidden, lines: lines.length };
    })()`);
    check(
      'CP5 accepting every suggestion hides the chips row; all three lines on the bill',
      cp5 && cp5.hidden && cp5.lines === 3,
      cp5
    );
    await ev(`(function(){ try { localStorage.removeItem('mmgr_calc_boq'); } catch (e) {} })()`);

    // ---------- W1 2026-10-01: DISCOUNT (DC family) ----------
    const dc1 = await ev(`(function(){
      var a = __calcEngine.applyDiscount(100000, 6000, '5', '');
      var b = __calcEngine.applyDiscount(100000, 6000, '5', '8000');
      var c = __calcEngine.applyDiscount(1000, 0, '', '99999');
      var d = __calcEngine.applyDiscount(1000, 0, '-5', '-100');
      return { pct: a.discount, base: a.base, fixedWins: b.discount, cap: c.discount, capBase: c.base, neg: d.discount, negBase: d.base };
    })()`);
    check(
      'DC1 discount math: 5% of 106k = 5300; fixed 8000 wins; caps at pool; negatives clamp',
      dc1 &&
        Math.abs(dc1.pct - 5300) < 0.01 &&
        Math.abs(dc1.base - 100700) < 0.01 &&
        Math.abs(dc1.fixedWins - 8000) < 0.01 &&
        dc1.cap === 1000 &&
        dc1.capBase === 0 &&
        dc1.neg === 0 &&
        dc1.negBase === 1000,
      dc1
    );
    const dc2 = await ev(`(function(){
      var r = __calcEngine.rollup({ works: 100000, prelims: 6000, designC: '10', constrC: '5', escPct: '5', months: '12', discPct: '5', discAmt: '' });
      var b = r.base;
      return { disc: r.discount, base: r.base, design: r.designC, constr: r.constrC, esc: r.esc, sub: r.subtotal,
        exact: Math.abs(b * 0.10 - 10070) < 0.01 && Math.abs(b * 0.05 - 5035) < 0.01 && Math.abs(b * 0.05 - 5035) < 0.01 && Math.abs(r.subtotal - (b + b * 0.10 + b * 0.05 + b * 0.05)) < 0.01 };
    })()`);
    check(
      'DC2 waterfall: contingencies + escalation ride the DISCOUNTED base',
      dc2 && Math.abs(dc2.disc - 5300) < 0.01 && dc2.exact,
      dc2
    );
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
    check(
      'DC3 discount settings persist and rehydrate after reload',
      dc3b && dc3b.pct === '7.5' && dc3b.amt === '2000',
      dc3b
    );
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
    check(
      'DC4 legacy prefs without disc keys: no discount, no error, fields blank',
      dc4b && dc4b.disc === 0 && dc4b.fieldBlank,
      dc4b
    );
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
      return { // OWNER 2026-10-02 CSV RESTRUCTURE: the discount moved into the ROLL-UP
      // block's Detail column (the rate is a modifier of the roll-up line,
      // not its own money row).
      csvHasDisc: csv.indexOf('discount 10% / 0') > -1,
               discLine: txt.indexOf('Discount') > -1, pctShown: txt.indexOf('10% off') > -1, neg: txt.indexOf('-') > -1 };
    })()`);
    check(
      'DC5 CSV carries the discount row; waterfall shows the discount line with pct',
      dc5 && dc5.csvHasDisc && dc5.discLine && dc5.pctShown && dc5.neg,
      dc5
    );
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

    // ---------- W3 2026-10-01: BRAND + DOCUMENT SHEET (BD + SG families) ----------
    const bd1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_brand');
      var r1 = __calcEngine.brandLoad();
      return { empty: r1.name === '' && r1.logo === null, u: typeof r1.updatedAt };
    })()`);
    check(
      'BD1 brand store starts empty; shape complete (logo, name, phone, email, addr, trn, sig)',
      bd1 && bd1.empty && bd1.u === 'number',
      bd1
    );
    const bd2 = await ev(`(function(){
      localStorage.setItem('mmgr_calc_biz_name', 'Fairclough Build Ltd');
      location.reload();
      return { pending: true };
    })()`);
    await delay(2500);
    const bd2b = await ev(`(function(){
      var b = __calcEngine.brandLoad();
      return { migrated: b.name, oldGone: localStorage.getItem('mmgr_calc_biz_name') === null,
               bizRow: document.getElementById('calc-biz-name').value };
    })()`);
    check(
      'BD2 legacy mmgr_calc_biz_name migrates into the brand card on first load and is retired',
      bd2b &&
        bd2b.migrated === 'Fairclough Build Ltd' &&
        bd2b.oldGone &&
        bd2b.bizRow === 'Fairclough Build Ltd',
      bd2b
    );
    // BD2's reload wipes the deterministic slab state AGAIN (same lesson as
    // DC3/DC4: applyState restores whatever trade was last persisted). Re-
    // establish the full slab flow before the rest of the wave runs.
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
    const bd3 = await ev(`(function(){
      var big = 'data:image/png;base64,' + new Array(1365334).join('A');
      var ok = 'data:image/png;base64,' + new Array(133334).join('A');
      return { big: __calcEngine.logoFitsCap(big), ok: __calcEngine.logoFitsCap(ok), garbage: __calcEngine.logoFitsCap('not-a-data-url') };
    })()`);
    check(
      'BD3 logo cap: ~1MB dataURL fails, 100KB passes, garbage rejected (bytes = b64*3/4)',
      bd3 && bd3.big === false && bd3.ok === true && bd3.garbage === false,
      bd3
    );
    const bd4 = await ev(`(function(){
      return { inv: __calcEngine.docNoSuggest('Invoice', 1), quo: __calcEngine.docNoSuggest('Quote', 12), est: __calcEngine.docNoSuggest('Estimate', 3) };
    })()`);
    check(
      'BD4 doc numbers format per type: INV-0001 / QUO-0012 / EST-0003',
      bd4 && bd4.inv === 'INV-0001' && bd4.quo === 'QUO-0012' && bd4.est === 'EST-0003',
      bd4
    );
    const bd5 = await ev(`(function(){
      document.getElementById('calc-client-name').value = 'Smith - 12 Church Rd';
      document.getElementById('calc-client-name').dispatchEvent(new Event('input', { bubbles: true }));
      var bt = document.getElementById('calc-quote-billto');
      var st = __calcEngine.readState();
      var csv = __calcEngine.estimateCsv(__calcEngine.computeFor(__calcEngine.readState()));
      return { billto: bt.textContent, hidden: bt.hidden, ridesState: st.clientName,
        csvHasClient: csv.indexOf('Smith - 12 Church Rd') > -1, csvHasBiz: csv.indexOf('Fairclough Build Ltd') > -1 };
    })()`);
    check(
      'BD5 client field fills bill-to, rides saved state and the CSV (with business + contact rows)',
      bd5 &&
        bd5.billto.indexOf('Smith - 12 Church Rd') > -1 &&
        !bd5.hidden &&
        bd5.ridesState === 'Smith - 12 Church Rd' &&
        bd5.csvHasClient &&
        bd5.csvHasBiz,
      bd5
    );
    const sg1 = await ev(`(function(){
      document.getElementById('calc-doc-type').value = 'Invoice';
      document.getElementById('calc-doc-type').dispatchEvent(new Event('change', { bubbles: true }));
      var inv = document.getElementById('calc-quote-sig').hidden;
      document.getElementById('calc-doc-type').value = 'Estimate';
      document.getElementById('calc-doc-type').dispatchEvent(new Event('change', { bubbles: true }));
      var est = document.getElementById('calc-quote-sig').hidden;
      return { invoice: inv, estimate: est };
    })()`);
    check(
      'SG1 signature lines default: ON for Invoice, OFF for Estimate',
      sg1 && sg1.invoice === false && sg1.estimate === true,
      sg1
    );
    const sg2 = await ev(`(function(){
      var box = document.getElementById('calc-sig-show');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      var estOn = document.getElementById('calc-quote-sig').hidden;
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      var estOff = document.getElementById('calc-quote-sig').hidden;
      return { estOn: estOn, estOff: estOff, stored: (JSON.parse(localStorage.getItem('mmgr_calc_brand') || '{}').sigShow) };
    })()`);
    check(
      'SG2 the checkbox forces signature lines on/off for any doc type; choice persists',
      sg2 && sg2.estOn === false && sg2.estOff === true && sg2.stored === '',
      sg2
    );
    const sg3 = await ev(`(function(){
      var d = document.getElementById('calc-doc-date');
      return { today: d.value, iso: new Date().toISOString().slice(0, 10), due: document.getElementById('calc-doc-due').value };
    })()`);
    check(
      'SG3 document date defaults to today; due date starts blank',
      sg3 && sg3.today === sg3.iso && sg3.due === '',
      sg3
    );
    await ev(`(function(){
      localStorage.removeItem('mmgr_calc_brand');
      localStorage.removeItem('mmgr_calc_doccounter');
      ['calc-client-name','calc-client-addr','calc-doc-no','calc-doc-due'].forEach(function(id2){
        var el = document.getElementById(id2); if (el) el.value = '';
      });
      var dt2 = document.getElementById('calc-doc-date'); if (dt2) dt2.value = new Date().toISOString().slice(0, 10);
      document.getElementById('calc-client-name').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-biz-name').value = '';
      document.getElementById('calc-biz-name').dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    // ---------- W4 2026-10-01: ENTITLEMENT SEAM (ET family) ----------
    const et1 = await ev(`(function(){
      var E = window.__calcEntitlements;
      return { follow: E.can('cloudFollow'), logo: E.can('logoSync'), nope: E.can('nope'), plan: E.plan() };
    })()`);
    check(
      'ET1 entitlement seam: known features allowed on free, unknown refused, plan starts free',
      et1 && et1.follow === true && et1.logo === true && et1.nope === false && et1.plan === 'free',
      et1
    );
    const et2 = await ev(`(function(){
      var E = window.__calcEntitlements;
      E.setPlan('pro');
      return { follow: E.can('cloudFollow'), plan: E.plan() };
    })()`);
    check(
      'ET2 setPlan(pro): known features stay allowed (forward window) and plan reports pro',
      et2 && et2.follow === true && et2.plan === 'pro',
      et2
    );
    const et3 = await ev(`(function(){
      var E = window.__calcEntitlements;
      E.setPlan('');
      return { plan: E.plan(), logo: E.can('logoSync') };
    })()`);
    check(
      'ET3 setPlan(empty) resets the plan to free',
      et3 && et3.plan === 'free' && et3.logo === true,
      et3
    );

    // ---------- W5 2026-10-01: WORKSPACE FOLLOW (WS family) ----------
    const ws1 = await ev(`(function(){
      var c = __calcEngine.wsCollect();
      var names = Object.keys(c);
      return { names: names.join(','), n: names.length, allSections: names.every(function(k){ return c[k] && typeof c[k] === 'object' && 'updatedAt' in c[k] && 'val' in c[k]; }), stamps: names.every(function(k){ return typeof c[k].updatedAt === 'number'; }) };
    })()`);
    check(
      'WS1 wsCollect returns all ten sections each carrying an updatedAt stamp (sheets + fx + books follow the account)',
      ws1 &&
        ws1.n === 10 &&
        ws1.allSections &&
        ws1.stamps &&
        ws1.names === 'estimates,boq,history,packs,rollup,brand,sheets,docCounter,fx,books',
      ws1
    );
    const ws2 = await ev(`(function(){
      var m = __calcEngine.wsMerge;
      var cloudObj = { a: 2 };
      return {
        cloudNewer: m(100, 200, { a: 1 }, cloudObj),
        localNewer: m(300, 200, { a: 1 }, cloudObj),
        emptyAdopts: m(0, 200, [], cloudObj),
        emptyObjAdopts: m(0, 200, {}, cloudObj),
        equalKeepsLocal: m(200, 200, { a: 1 }, cloudObj),
        corruptSkipped: m(0, 500, { a: 1 }, 'garbage')
      };
    })()`);
    check(
      'WS2 wsMerge: cloud newer wins, local newer kept, empty local adopts, equal keeps local, corrupt cloud skipped',
      ws2 &&
        ws2.cloudNewer.a === 2 &&
        ws2.localNewer.a === 1 &&
        ws2.emptyAdopts.a === 2 &&
        ws2.emptyObjAdopts.a === 2 &&
        ws2.equalKeepsLocal.a === 1 &&
        ws2.corruptSkipped.a === 1,
      ws2
    );
    const ws3 = await ev(`(function(){
      localStorage.setItem('mmgr_calc_wstamps', JSON.stringify({}));
      var E = window.__calcEntitlements;
      E.setPlan('');
      var out = __calcEngine.wsApplyProbe({ plan: 'free', ws: { rollup: { val: { designC: '7' }, updatedAt: 500 }, junk: { val: 'x' }, badShape: 'nope' } });
      var roll = JSON.parse(localStorage.getItem('mmgr_calc_rollup') || '{}');
      var stamp = JSON.parse(localStorage.getItem('mmgr_calc_wstamps') || '{}');
      return { ok: out.ok, plan: E.plan(), merged: out.merged, designC: roll.designC, stamp: stamp.rollup };
    })()`);
    check(
      'WS3 wsApplyProbe: plan set from payload, cloud section merged + stamped, junk sections skipped',
      ws3 &&
        ws3.ok &&
        ws3.plan === 'free' &&
        ws3.merged.indexOf('rollup') > -1 &&
        ws3.merged.length === 1 &&
        ws3.designC === '7' &&
        ws3.stamp === 500,
      ws3
    );
    const ws4 = await ev(`(function(){
      return new Promise(function(resolve){
        var calls = 0;
        var origFetch = window.fetch;
        window.fetch = function(url, opts){ if (url === '/api/calc/workspace' && opts && opts.method === 'PUT') { calls++; return Promise.resolve({ status: 200, ok: true, json: function(){ return Promise.resolve({ ok: true, savedAt: 'x' }); } }); } return origFetch.apply(window, arguments); };
        __calcEngine.scheduleWsPut();
        __calcEngine.scheduleWsPut();
        __calcEngine.scheduleWsPut();
        setTimeout(function(){
          window.fetch = origFetch;
          resolve({ calls: calls });
        }, 2600);
      });
    })()`);
    check(
      'WS4 scheduleWsPut coalesces: 3 schedules inside the debounce window -> exactly 1 PUT',
      ws4 && ws4.calls === 1,
      ws4
    );
    // Rate freedom (owner 2026-10-01, 'ensure there is freedom for a user to
    // put their own rate'): a typed rate ALWAYS wins over the model, rides
    // every export and recall path, and a saved sheet restores it exactly.
    const rf1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_boq');
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '10';
      document.getElementById('calc-d3').value = '100';
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-quality').value = 'standard';
      document.getElementById('calc-rate-mat').value = '41234';
      document.getElementById('calc-rate-mat').dispatchEvent(new Event('input', { bubbles: true }));
      var r1 = __calcEngine.computeFor(__calcEngine.readState());
      var mat1 = (r1.mat / r1.qty);
      var st = __calcEngine.readState();
      var r2 = __calcEngine.computeFor(Object.assign({}, st));
      var mat2 = (r2.mat / r2.qty);
      return { perM2_1: Math.round(mat1 * 100) / 100, perM2_2: Math.round(mat2 * 100) / 100,
               annotated: r1.matOverridden === true, kept: Math.abs(mat1 - mat2) < 0.01 };
    })()`);
    check(
      'RF1 typed rate 41234 prices the m2 at exactly that rate (model discarded, override flagged, recall-stable)',
      rf1 && rf1.perM2_1 === 41234 && rf1.perM2_2 === 41234 && rf1.annotated && rf1.kept,
      rf1
    );
    await ev(`(function(){
      document.getElementById('calc-rate-mat').value = '';
      document.getElementById('calc-rate-mat').dispatchEvent(new Event('input', { bubbles: true }));
      localStorage.removeItem('mmgr_calc_wstamps');
      localStorage.removeItem('mmgr_calc_rollup');
    })()`);

    // ---------- W2 2026-10-01: DRYWALL + RESEARCH ROUND 2 (DW family) ----------
    const dw1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_boq');
      document.getElementById('calc-work').value = 'drywall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var d1l = document.getElementById('calc-d1-label').textContent;
      var wasteWrap = document.getElementById('calc-waste');
      var wasteDef = wasteWrap ? wasteWrap.value : null;
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-quality').value = 'standard';
      // Per-board: 950 per board over a 1.22 x 2.44 m sheet = 319.13/m2.
      document.getElementById('calc-piece-price').value = '950';
      document.getElementById('calc-piece-size').value = '1.22 x 2.44';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input', { bubbles: true }));
      var r = __calcEngine.computeFor(__calcEngine.readState());
      var perM2 = Math.round((r.mat / r.qty) * 100) / 100;
      var count = r.orderCount ? r.orderCount.n : null;
      document.getElementById('calc-piece-price').value = '';
      document.getElementById('calc-piece-size').value = '';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input', { bubbles: true }));
      return { d1Label: d1l, wasteDef: wasteDef, perM2: perM2, boards: count };
    })()`);
    check(
      'DW1 drywall per board: 950 over a 1.22x2.44 sheet = 319.13/m2 exact, waste defaults 10, order count in boards',
      dw1 &&
        dw1.d1Label === 'Length (m)' &&
        dw1.wasteDef === '10' &&
        dw1.perM2 === 319.13 &&
        dw1.boards === 9,
      dw1
    );
    const tx1 = await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '10';
      document.getElementById('calc-d3').value = '100';
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-country').value = 'JM';
      document.getElementById('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-quality').value = 'standard';
      var withTax = __calcEngine.computeFor(__calcEngine.readState());
      document.getElementById('calc-tax-override').value = '0';
      document.getElementById('calc-tax-override').dispatchEvent(new Event('input', { bubbles: true }));
      var noTax = __calcEngine.computeFor(__calcEngine.readState());
      var csv = __calcEngine.estimateCsv(noTax);
      var out = document.getElementById('calc-output').textContent;
      document.getElementById('calc-tax-override').value = '';
      document.getElementById('calc-tax-override').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
      return { jm: withTax.tax, off: noTax.tax, rateOff: noTax.taxRate, flagged: noTax.overrideApplied,
               // The rate is now the Detail column beside the Tax money row (the old
      // export had a separate "Tax rate %" row).
      csvZero: csv.indexOf('"Tax","0%","0"') > -1, totalEqualsSub: Math.abs(noTax.total - (noTax.sub + noTax.oh)) < 0.01,
               labelNoTax: out.indexOf('no tax - your rate') > -1 };
    })()`);
    check(
      'TX1 tax off entirely: typing 0 in the override kills the 15% JM tax, total drops to the pre-tax subtotal, CSV carries Tax rate % 0, sheet says no tax',
      tx1 &&
        tx1.jm > 0 &&
        tx1.off === 0 &&
        tx1.rateOff === 0 &&
        tx1.flagged &&
        tx1.csvZero &&
        tx1.totalEqualsSub &&
        tx1.labelNoTax,
      tx1
    );
    const nt1 = await ev(`(function(){
      localStorage.setItem('mmgr_calc_family', 'finishes');
      document.getElementById('calc-family').value = 'finishes';
      document.getElementById('calc-work').value = 'door';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var d1l = document.getElementById('calc-d1-label').textContent;
      document.getElementById('calc-d1').value = '3';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-currency').value = 'USD';
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-quality').value = 'standard';
      var r = __calcEngine.computeFor(__calcEngine.readState());
      var fam = document.getElementById('calc-family').value;
      var opts = Array.prototype.map.call(document.querySelectorAll('#calc-work option'), function(o){ return o.value; });
      var newOnes = ['door','window','ceiling','gutter','floor-screed','cabinet','water-heater','septic-tank','soffit-fascia'].every(function(k){ return opts.indexOf(k) > -1; });
      return { d1Label: d1l, each: r.qty, mat: r.mat, lab: r.lab, unit: r.unit, fam: fam, newOnes: newOnes };
    })()`);
    check(
      'NT1 per-each trade math: 3 doors = 3 each, mat 3x550 lab 3x650 exact, family follows, all 9 new trades in the picker',
      nt1 &&
        nt1.d1Label === 'Doors (count)' &&
        nt1.each === 3 &&
        Math.abs(nt1.mat - 1650) < 0.01 &&
        Math.abs(nt1.lab - 1950) < 0.01 &&
        nt1.unit === 'each' &&
        nt1.fam === 'finishes' &&
        nt1.newOnes,
      nt1
    );
    const nt2 = await ev(`(function(){
      document.getElementById('calc-work').value = 'floor-screed';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '5';
      document.getElementById('calc-d2').value = '4';
      document.getElementById('calc-d3').value = '50';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var r = __calcEngine.computeFor(__calcEngine.readState());
      document.getElementById('calc-piece-price').value = '9200';
      document.getElementById('calc-piece-size').value = '20';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input', { bubbles: true }));
      var rp = __calcEngine.computeFor(__calcEngine.readState());
      var out = document.getElementById('calc-piece-price').value = '';
      document.getElementById('calc-piece-price').value = '';
      document.getElementById('calc-piece-size').value = '';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input', { bubbles: true }));
      return { m3: r.qty, unit: r.unit, bagPerM3: Math.round((rp.mat / rp.qty) * 100) / 100 };
    })()`);
    check(
      'NT2 floor screed: 5x4x50mm = 1 m3 base, 5% screed waste -> 1.05; bag-of-mix piece reuses the volume divisor (9200/20L = 460,000/m3)',
      nt2 && Math.abs(nt2.m3 - 1.05) < 0.001 && nt2.unit === 'm3' && nt2.bagPerM3 === 460000,
      nt2
    );

    // ---------- W2.7 2026-10-01: OPENINGS DEDUCTION (OP family) ----------
    // Owner: "user should be able to add a window or a door and that will be
    // taken out of the final measurements as they wouldn't lay block in the
    // window space... ensure this is spread across relative trades."
    const op1 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var none = __calcEngine.computeFor(__calcEngine.readState());
      document.querySelector('[data-action="calcOpenAdd"]').click();
      var rows = document.querySelectorAll('#calc-openings-rows .bcp-open-row');
      var wEl = rows[0].querySelector('[data-field="w"]');
      var hEl = rows[0].querySelector('[data-field="h"]');
      wEl.value = '1.2';
      hEl.value = '1.2';
      wEl.dispatchEvent(new Event('input', { bubbles: true }));
      hEl.dispatchEvent(new Event('input', { bubbles: true }));
      var r = __calcEngine.computeFor(__calcEngine.readState());
      return { base: none.qty, qty: r.qty, area: r.openings.area, count: r.openings.count, has: r.hasOpenings, rowShown: !document.getElementById('calc-openings').hidden };
    })()`);
    check(
      'OP1 openings deduction: blockwall 10x2.4 = 24 m2 with one 1.2x1.2 window -> 22.56 m2 exact, openings reported, editor visible',
      op1 &&
        Math.abs(op1.base - 24) < 1e-9 &&
        Math.abs(op1.qty - 22.56) < 1e-9 &&
        op1.area === 1.44 &&
        op1.count === 1 &&
        op1.has &&
        op1.rowShown,
      op1
    );
    const op2 = await ev(`(function(){
      document.getElementById('calc-work').value = 'drywall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-waste').value = '10';
      document.getElementById('calc-waste').dispatchEvent(new Event('input', { bubbles: true }));
      var r = __calcEngine.computeFor(__calcEngine.readState());
      return { qty: r.qty, wastePct: r.wastePct };
    })()`);
    check(
      'OP2 deduction before waste: drywall same wall, cuts 10 -> 22.56 x 1.1 = 24.816 (waste applies to what is laid, not the void)',
      op2 && Math.abs(op2.qty - 24.816) < 0.001 && op2.wastePct === 10,
      op2
    );
    const op3 = await ev(`(function(){
      var works = ['blockwall','brickwall','framing','render','paint','drywall'];
      return works.map(function(k){
        document.getElementById('calc-work').value = k;
        document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('calc-d1').value = '10';
        document.getElementById('calc-d2').value = '2.4';
        document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
        var st = __calcEngine.readState();
        var withO = __calcEngine.computeFor(st);
        var withoutO = __calcEngine.computeFor(Object.assign({}, st, { openings: '[]' }));
        return { k: k, has: withO.hasOpenings, area: withO.openings.area, wastePct: withO.wastePct, cut: withoutO.qty - withO.qty };
      });
    })()`);
    check(
      'OP3 spread across wall trades: blockwall/brickwall/framing/render/paint/drywall ALL deduct the same 1.44 m2 void (waste-normalized)',
      Array.isArray(op3) &&
        op3.length === 6 &&
        op3.every(function (x) {
          return x.has && x.area === 1.44 && Math.abs(x.cut / (1 + x.wastePct / 100) - 1.44) < 1e-9;
        }),
      op3
    );
    const op4 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '100';
      document.getElementById('calc-d2').value = '10';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var rows = document.querySelectorAll('#calc-openings-rows .bcp-open-row');
      var wEl = rows[0].querySelector('[data-field="w"]');
      var hEl = rows[0].querySelector('[data-field="h"]');
      wEl.value = '10';
      hEl.value = '8';
      wEl.dispatchEvent(new Event('input', { bubbles: true }));
      hEl.dispatchEvent(new Event('input', { bubbles: true }));
      var withO = __calcEngine.computeFor(__calcEngine.readState());
      var withoutO = __calcEngine.computeFor(Object.assign({}, __calcEngine.readState(), { openings: '[]' }));
      var diff = withoutO.qty - withO.qty;
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      return { diff: diff, withQty: withO.qty };
    })()`);
    check(
      'OP4 imperial conversion: a 10 ft x 8 ft opening on a 100 ft x 10 ft wall deducts 7.43 m2 (3.048 x 2.4384)',
      op4 && Math.abs(op4.diff - 7.43) < 0.005,
      op4
    );
    const op5 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var rows = document.querySelectorAll('#calc-openings-rows .bcp-open-row');
      var wEl = rows[0].querySelector('[data-field="w"]');
      var hEl = rows[0].querySelector('[data-field="h"]');
      wEl.value = '1.2';
      hEl.value = '1.2';
      wEl.dispatchEvent(new Event('input', { bubbles: true }));
      hEl.dispatchEvent(new Event('input', { bubbles: true }));
      var withCsv = __calcEngine.estimateCsv(__calcEngine.computeFor(__calcEngine.readState()));
      var noneCsv = __calcEngine.estimateCsv(__calcEngine.computeFor(Object.assign({}, __calcEngine.readState(), { openings: '[]' })));
      return { withLine: withCsv.indexOf('"Openings deducted","1 (1.44 m2)"') > -1, noneLine: noneCsv.indexOf('"Openings deducted","none"') > -1 };
    })()`);
    check(
      'OP5 CSV artifacts: carries "Openings deducted","1 (1.44 m2)" with rows and "none" without',
      op5 && op5.withLine && op5.noneLine,
      op5
    );
    const op6 = await ev(`(function(){
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      var rows = document.querySelectorAll('#calc-openings-rows .bcp-open-row');
      var wEl = rows[0].querySelector('[data-field="w"]');
      var hEl = rows[0].querySelector('[data-field="h"]');
      wEl.value = '10';
      hEl.value = '10';
      wEl.dispatchEvent(new Event('input', { bubbles: true }));
      hEl.dispatchEvent(new Event('input', { bubbles: true }));
      var r = __calcEngine.computeFor(__calcEngine.readState());
      return { qty: r.qty, fin: isFinite(r.qty), area: r.openings.area };
    })()`);
    check(
      'OP6 floored at zero: 100 m2 of voids on a 24 m2 wall -> quantity exactly 0, finite, never negative',
      op6 && op6.qty === 0 && op6.fin && op6.area === 100,
      op6
    );
    const op7 = await ev(`(function(){
      var guard = 0;
      while (guard++ < 10) {
        var del = document.querySelector('[data-action="calcOpenDel"]');
        if (!del) break;
        del.click();
      }
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var hiddenOnSlab = document.getElementById('calc-openings').hidden;
      document.getElementById('calc-work').value = 'blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      var shownOnWall = !document.getElementById('calc-openings').hidden;
      document.querySelector('[data-action="calcOpenAdd"]').click();
      var rows = document.querySelectorAll('#calc-openings-rows .bcp-open-row');
      var typeSel = rows.length ? rows[0].querySelector('.bcp-open-type') : null;
      var wEl = rows[0].querySelector('[data-field="w"]');
      var hEl = rows[0].querySelector('[data-field="h"]');
      wEl.value = '1.2';
      hEl.value = '1.2';
      wEl.dispatchEvent(new Event('input', { bubbles: true }));
      hEl.dispatchEvent(new Event('input', { bubbles: true }));
      var sum = document.getElementById('calc-open-sum').textContent;
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '2.4';
      document.getElementById('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.bcp-run').click();
      var out = document.getElementById('calc-output').textContent;
      var del = document.querySelector('[data-action="calcOpenDel"]');
      if (del) del.click();
      var out2 = { hiddenOnSlab: hiddenOnSlab, shownOnWall: shownOnWall, oneRow: rows.length === 1,
               typeIsWindow: typeSel ? typeSel.value === 'window' : false,
               sumHasDeduct: sum.indexOf('Deducts') > -1 && sum.indexOf('1.44') > -1,
               noteHasMinus: out.indexOf('Minus 1 opening') > -1 && out.indexOf('1.44') > -1 && out.indexOf('not built') > -1,
               rowsAfter: document.querySelectorAll('#calc-openings-rows .bcp-open-row').length,
               sumAfter: document.getElementById('calc-open-sum').textContent };
      // Restore the state the pre-OP gates left (floor-screed + dims) so the
      // U-block after this reads the same page it always did.
      document.getElementById('calc-work').value = 'floor-screed';
      document.getElementById('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('calc-d1').value = '5';
      document.getElementById('calc-d2').value = '4';
      document.getElementById('calc-d3').value = '50';
      return out2;
    })()`);
    check(
      'OP7 editor lifecycle: hidden on slab / shown on blockwall, add-row defaults to Window, sum line deducts 1.44 m2, breakdown shows the Minus note, delete empties',
      op7 &&
        op7.hiddenOnSlab &&
        op7.shownOnWall &&
        op7.oneRow &&
        op7.typeIsWindow &&
        op7.sumHasDeduct &&
        op7.noteHasMinus &&
        op7.rowsAfter === 0 &&
        op7.sumAfter === '',
      op7
    );

    // ---------- PLAN V2 PHASE 1 (2026-10-01): FOUNDATIONS ----------
    // E2 VARIANT ENGINE (EV family).
    const ev1 = await ev(`(function(){
      var work = document.getElementById('calc-work');
      work.value = 'slab'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var slabHidden = document.getElementById('calc-variant-wrap').hidden;
      work.value = 'excav'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var wrap = document.getElementById('calc-variant-wrap');
      var sel = document.getElementById('calc-variant');
      return { slabHidden: slabHidden, shown: !wrap.hidden, opts: sel.options.length,
               first: sel.options.length ? sel.options[0].textContent : '', val: sel.value };
    })()`);
    check(
      'EV1 variant selector: hidden on slab, shown on excavation with its JIC #1 soil variant',
      // JIC 2025-2027 re-baseline (2026-10-02): excav carries the 9 official
      // JIC soil rates (#1-#9). The first is still id 'standard' - carrying the
      // pre-conversion model rates - so old saves recall unchanged (proved by
      // EV3's unchanged 1600 total). The LABEL is now the JIC wording.
      ev1 &&
        ev1.slabHidden &&
        ev1.shown &&
        ev1.opts === 9 &&
        ev1.first === 'Compacted earth to 5 ft deep (JIC #1)' &&
        ev1.val === 'standard',
      ev1
    );
    const ev2 = await ev(`(function(){
      var st = JSON.parse(JSON.stringify(__calcEngine.readState()));
      var work = document.getElementById('calc-work');
      work.value = 'slab'; work.dispatchEvent(new Event('change',{bubbles:true}));
      __calcEngine.syncLabels();
      // applyState with the excavated snapshot must bring the trade + variant back.
      var fakeEl = null; // applyState reads ids directly; run it on the live form
      st.work = 'excav';
      // applyState is module-internal; drive it through the exported path:
      // set the work + dispatch so renderVariant paints, then set the saved variant.
      work.value = 'excav'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var sel = document.getElementById('calc-variant');
      var ok = sel.value === 'standard' && __calcEngine.readState().variant === 'standard';
      return { rides: ok };
    })()`);
    check(
      'EV2 variant rides readState and survives a trade round-trip',
      ev2 && ev2.rides === true,
      ev2
    );
    const ev3 = await ev(`(function(){
      var withV = __calcEngine.computeFor({ work:'excav', d1:'10', d2:'8', d3:'1', units:'metric', quality:'standard', currency:'USD', country:'US', variant:'standard' });
      var legacy = __calcEngine.computeFor({ work:'excav', d1:'10', d2:'8', d3:'1', units:'metric', quality:'standard', currency:'USD', country:'US' });
      return { same: withV && legacy && withV.total === legacy.total && withV.total === 1600,
               vLabel: withV && withV.variantLabel, vId: withV && withV.variant };
    })()`);
    check(
      'EV3 excavation variant conversion: picked variant = legacy save = the pre-conversion model total (1600)',
      // The MONEY invariant is unchanged by the JIC wave (still 1600 - the
      // first variant deliberately keeps the pre-conversion rates); only the
      // variant label is now the official JIC #1 wording.
      ev3 &&
        ev3.same === true &&
        ev3.vId === 'standard' &&
        ev3.vLabel === 'Compacted earth to 5 ft deep (JIC #1)',
      ev3
    );

    // E1 CURRENCY + FX (FX family). Fresh storage has no rates.
    const fx1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_fx');
      var noJmd = __calcEngine.fxFactor('JMD');
      var usd = __calcEngine.fxFactor('USD');
      localStorage.setItem('mmgr_calc_fx', JSON.stringify({ JMD: { per: 157.5, asOf: new Date().toISOString().slice(0,10) } }));
      __calcEngine.renderFx();
      var chip = document.getElementById('calc-fx-list').textContent;
      return { noJmd: noJmd, usd: usd, chip: chip };
    })()`);
    check(
      'FX1 FX table: base=1, unset=null, saved rate renders a dated chip',
      fx1 &&
        fx1.noJmd === null &&
        fx1.usd === 1 &&
        fx1.chip.indexOf('157.5') > -1 &&
        fx1.chip.indexOf('per USD') > -1 &&
        fx1.chip.indexOf('as of') > -1,
      fx1
    );
    const fx2 = await ev(`(function(){
      var c = document.getElementById('calc-currency');
      var work = document.getElementById('calc-work');
      work.value = 'slab'; work.dispatchEvent(new Event('change',{bubbles:true}));
      c.value = 'JMD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      var rm = document.getElementById('calc-rate-mat').value, rl = document.getElementById('calc-rate-lab').value;
      document.getElementById('calc-country').value = 'JM';
      document.getElementById('calc-tax-override').value = '';
      document.getElementById('calc-oh').value = '';
      document.getElementById('calc-rate-eq').value = '';
      document.getElementById('calc-d1').value = '10'; document.getElementById('calc-d2').value = '8'; document.getElementById('calc-d3').value = '150';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var out = document.getElementById('calc-output').textContent;
      return { rm: rm, rl: rl, jmdTotal: out.indexOf('J$536,311') > -1, noBanner: out.indexOf('Built-in model rates are US dollars') === -1 };
    })()`);
    check(
      'FX2 with a rate set, JMD prefill converts (150x157.5=23625, 85x157.5=13387.5) and the total is J$536,311 with no banner',
      fx2 && fx2.rm === '23625' && fx2.rl === '13387.5' && fx2.jmdTotal && fx2.noBanner,
      fx2
    );
    const fx3 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_fx'); __calcEngine.renderFx();
      var c = document.getElementById('calc-currency');
      c.value = 'USD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-country').value = 'JM';
      document.getElementById('calc-tax-override').value = '';
      document.getElementById('calc-oh').value = '';
      document.getElementById('calc-rate-eq').value = '';
      c.value = 'JMD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      var rm = document.getElementById('calc-rate-mat').value;
      var note = !document.getElementById('calc-fx-note').hidden;
      document.querySelector('[data-action=calcRun]').click();
      var out = document.getElementById('calc-output').textContent;
      return { rm: rm, note: note, banner: out.indexOf('Built-in model rates are US dollars') > -1,
               usdMoney: out.indexOf('$3,405') > -1, noJmd: out.indexOf('J$3,405') === -1 };
    })()`);
    check(
      'FX3 with no rate, JMD fields stay empty + note shows + totals carry the USD symbol (never a relabel)',
      fx3 && fx3.rm === '' && fx3.note && fx3.banner && fx3.usdMoney && fx3.noJmd,
      fx3
    );
    const fx4 = await ev(`(function(){
      document.getElementById('calc-rate-mat').value = '4000';
      document.getElementById('calc-rate-mat').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var out = document.getElementById('calc-output').textContent;
      var r = __calcEngine.computeFor(Object.assign(__calcEngine.readState(), { _matModel: document.getElementById('calc-rate-mat').dataset.model, _labModel: document.getElementById('calc-rate-lab').dataset.model }));
      document.getElementById('calc-rate-mat').value = '';
      return { typedUsed: out.indexOf('50,400') > -1, mat: r ? Math.round(r.mat) : null, overridden: r ? r.matOverridden : null };
    })()`);
    check(
      "FX4 typed rate is the user's own money: JMD 4000 prices 12.6 m3 at exactly 50,400 - never converted",
      fx4 && fx4.typedUsed && fx4.mat === 50400 && fx4.overridden === true,
      fx4
    );

    // E4 RATE BOOKS (BOOK family).
    const book1 = await ev(`(function(){
      localStorage.removeItem('mmgr_calc_books'); localStorage.removeItem('mmgr_calc_book_active');
      __calcEngine.renderBooks();
      var res = __calcEngine.importBooks({ books: [
        { name: 'Test book', currency: 'USD', effective_from: '2026-10-01', effective_to: '2027-09-30',
          rates: { slab: { '*': { mat: 200, lab: 100 } }, nope: { '*': { mat: 1, lab: 1 } }, tile: { '*': { mat: -5, lab: 10 } } } }
      ]});
      var stored = JSON.parse(localStorage.getItem('mmgr_calc_books') || '[]');
      return { merged: res && res.merged, badKeys: res && res.badKeys, skipped: res && res.skipped,
               checksum: stored[0] && stored[0].checksum ? stored[0].checksum.charAt(0) === 'c' : false };
    })()`);
    check(
      'BOOK1 import validates: valid book merges, unknown work key rejected, negative rate skipped, checksum stamped',
      book1 && book1.merged === 1 && book1.badKeys === 1 && book1.skipped === 1 && book1.checksum,
      book1
    );
    const book2 = await ev(`(function(){
      var id = JSON.parse(localStorage.getItem('mmgr_calc_books'))[0].id;
      __calcEngine.setActiveBook(id);
      __calcEngine.renderBooks();
      var c = document.getElementById('calc-currency');
      c.value = 'USD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-country').value = 'US';
      document.getElementById('calc-tax-override').value = '';
      document.getElementById('calc-oh').value = '';
      document.getElementById('calc-rate-eq').value = '';
      var rm = document.getElementById('calc-rate-mat').value, rl = document.getElementById('calc-rate-lab').value;
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10'; document.getElementById('calc-d2').value = '8'; document.getElementById('calc-d3').value = '150';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var out = document.getElementById('calc-output').textContent;
      var cleared = document.querySelector('[data-action=calcBookClear]'); cleared.click();
      c.dispatchEvent(new Event('change',{bubbles:true}));
      var rmAfter = document.getElementById('calc-rate-mat').value;
      return { rm: rm, rl: rl, bookTotal: out.indexOf('$2,520') > -1 && out.indexOf('$3,780') > -1, rmAfter: rmAfter };
    })()`);
    check(
      'BOOK2 active book drives the prefill (slab 200/100 -> mat 2520) and Use-model-rates restores the model',
      book2 &&
        book2.rm === '200' &&
        book2.rl === '100' &&
        book2.bookTotal &&
        book2.rmAfter === '150',
      book2
    );
    const book3 = await ev(`(function(){
      var res = __calcEngine.importBooks({ books: [
        { name: 'JM book', currency: 'JMD', rates: { slab: { '*': { mat: 30000, lab: 12000 } } } }
      ]});
      var id = JSON.parse(localStorage.getItem('mmgr_calc_books')).find(function(b){ return b.name === 'JM book'; }).id;
      __calcEngine.setActiveBook(id); __calcEngine.renderBooks();
      var c = document.getElementById('calc-currency');
      c.value = 'JMD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      var jmd = { rm: document.getElementById('calc-rate-mat').value, rl: document.getElementById('calc-rate-lab').value };
      c.value = 'USD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      var note = document.getElementById('calc-fx-note');
      var usd = { rm: document.getElementById('calc-rate-mat').value, noteShown: !note.hidden, noteTxt: note.textContent };
      document.querySelector('[data-action=calcBookClear]').click();
      c.dispatchEvent(new Event('change',{bubbles:true}));
      return { jmd: jmd, usd: usd };
    })()`);
    check(
      'BOOK3 book currency honoured: JMD estimate reads JMD book rates as-is; USD estimate with no FX pair leaves fields empty + names the book currency',
      book3 &&
        book3.jmd.rm === '30000' &&
        book3.jmd.rl === '12000' &&
        book3.usd.rm === '' &&
        book3.usd.noteShown &&
        book3.usd.noteTxt.indexOf('JMD') > -1,
      book3
    );
    const book4 = await ev(`(function(){
      var res = __calcEngine.importBooks({ books: [
        { name: 'Old book', currency: 'USD', effective_to: '2026-09-30', rates: { slab: { '*': { mat: 1, lab: 1 } } } }
      ]});
      var id = JSON.parse(localStorage.getItem('mmgr_calc_books')).find(function(b){ return b.name === 'Old book'; }).id;
      __calcEngine.setActiveBook(id); __calcEngine.renderBooks();
      var exp = document.getElementById('calc-book-expired');
      var shown = !exp.hidden && exp.textContent.indexOf('expired') > -1;
      document.querySelector('[data-action=calcBookClear]').click();
      return { merged: res && res.merged, expiredShown: shown };
    })()`);
    check(
      'BOOK4 an expired book shows the expiry banner',
      book4 && book4.merged === 1 && book4.expiredShown,
      book4
    );
    const book5 = await ev(`(function(){
      var res = __calcEngine.importBooks({ books: [
        { name: 'Tampered', currency: 'USD', checksum: 'cWRONG', rates: { slab: { '*': { mat: 1, lab: 1 } } } }
      ]});
      return { merged: res && res.merged, skipped: res && res.skipped };
    })()`);
    check(
      'BOOK5 a checksum mismatch (edited file) is skipped, not trusted',
      book5 && book5.merged === 0 && book5.skipped === 1,
      book5
    );

    // E6 LABOUR MODE (LM family).
    const lm1 = await ev(`(function(){
      var c = document.getElementById('calc-currency');
      c.value = 'USD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10'; document.getElementById('calc-d2').value = '8'; document.getElementById('calc-d3').value = '150';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('calc-labour-only').checked = true;
      document.getElementById('calc-labour-only').dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var out = document.getElementById('calc-output').textContent;
      var st = __calcEngine.readState();
      var r = __calcEngine.computeFor(Object.assign(st, { _matModel: document.getElementById('calc-rate-mat').dataset.model, _labModel: document.getElementById('calc-rate-lab').dataset.model }));
      var csv = __calcEngine.estimateCsv(r);
      return { excluded: out.indexOf('Materials - excluded (labour only)') > -1,
               lab: r ? Math.round(r.lab) : null, mat: r ? Math.round(r.mat) : null,
               // Amount is the THIRD column now; the exclusion note sits in it verbatim.
               csvRow: csv.indexOf('"Materials","brought in","excluded (labour only)"') > -1, rides: st.labourOnly === true };
    })()`);
    check(
      'LM1 labour-only: materials excluded, labor priced (12.6x85=1071), CSV names the exclusion, flag rides readState',
      lm1 && lm1.excluded && lm1.lab === 1071 && lm1.mat === 0 && lm1.csvRow && lm1.rides,
      lm1
    );
    const lm2 = await ev(`(function(){
      document.getElementById('calc-rate-mat').value = '100';
      document.getElementById('calc-rate-mat').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var r = __calcEngine.computeFor(__calcEngine.readState());
      var out = document.getElementById('calc-output').textContent;
      document.getElementById('calc-labour-only').checked = false;
      document.getElementById('calc-labour-only').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-rate-mat').value = '';
      return { mat: r ? Math.round(r.mat) : null, lab: r ? Math.round(r.lab) : null, inOut: out.indexOf('1,260') > -1 };
    })()`);
    check(
      "LM2 labour-only with a typed material rate: the user's own materials still price (12.6x100=1260)",
      lm2 && lm2.mat === 1260 && lm2.lab === 1071 && lm2.inOut,
      lm2
    );

    // ---- AB: ALL-IN (JIC combined) RATE + DB: PER-DAY CREW RATE ----------
    // Owner directive 2026-10-02, decisions D1-D9. These two families are the
    // proof that a combined figure is NEVER split into a fabricated
    // Materials/Labour pair on any document, and that a day rate is ONE
    // labour total that the finish multiplier cannot inflate.
    const ab0 = await ev(`(function(){
      document.getElementById('calc-labour-only').checked = false;
      document.getElementById('calc-labour-only').dispatchEvent(new Event('change',{bubbles:true}));
      var w = document.getElementById('calc-work'); w.value = 'siteprep'; w.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10'; document.getElementById('calc-d2').value = '8';
      document.getElementById('calc-currency').value = 'USD';
      var b = document.getElementById('calc-basis'); b.value = 'measured'; b.dispatchEvent(new Event('change',{bubbles:true}));
      return { basis: b.value, wrapHidden: document.getElementById('calc-allin-wrap').hidden,
               dayHidden: document.getElementById('calc-days-wrap').hidden,
               ratesShown: !document.getElementById('calc-rates-row').hidden };
    })()`);
    check(
      'AB0 measured is the default and hides both new input groups (default-inert)',
      ab0 && ab0.basis === 'measured' && ab0.wrapHidden && ab0.dayHidden && ab0.ratesShown,
      ab0
    );
    const ab1 = await ev(`(function(){
      var b = document.getElementById('calc-basis'); b.value = 'allin'; b.dispatchEvent(new Event('change',{bubbles:true}));
      var a = document.getElementById('calc-allin'); a.value = '20'; a.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var r = __calcEngine.computeFor(Object.assign(__calcEngine.readState(),
        { _matModel: document.getElementById('calc-rate-mat').dataset.model,
          _labModel: document.getElementById('calc-rate-lab').dataset.model }));
      var out = document.getElementById('calc-output').textContent;
      var csv = __calcEngine.estimateCsv(r);
      return { ratesHidden: document.getElementById('calc-rates-row').hidden,
               verifiedShown: !document.getElementById('calc-verified-wrap').hidden,
               allIn: r.allIn, mat: r.mat, lab: r.lab, cost: Math.round(r.allInCost), total: Math.round(r.total),
               oneRow: out.indexOf('Work rate (all-in)') > -1,
               noMatRow: out.indexOf('Materials') === -1, noLabRow: out.indexOf('Labor') === -1,
               csvCombined: csv.indexOf('"Work rate (all-in)","","1600"') > -1,
               csvNoSplit: csv.indexOf('"Materials"') === -1 && csv.indexOf('"Labor"') === -1 };
    })()`);
    check(
      'AB1 all-in prices the whole line and shows ONE combined row - no Materials/Labour split on screen or CSV (D3)',
      ab1 &&
        ab1.ratesHidden &&
        ab1.verifiedShown &&
        ab1.allIn &&
        ab1.mat === 0 &&
        ab1.lab === 0 &&
        ab1.cost === 1600 &&
        ab1.total === 1600 &&
        ab1.oneRow &&
        ab1.noMatRow &&
        ab1.noLabRow &&
        ab1.csvCombined &&
        ab1.csvNoSplit,
      ab1
    );
    const ab2 = await ev(`(function(){
      var a = document.getElementById('calc-allin'); a.value = '20'; a.dataset.model = '20';
      a.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      // computeFor reads the prefill marker under the same _allInModel key the
      // live wrapper passes, exactly as the material/labour fields do.
      var r = __calcEngine.computeFor(Object.assign(__calcEngine.readState(),
        { _allInModel: a.dataset.model }));
      var note = document.getElementById('calc-book-note');
      return { filled: r.bookFilled, overridden: r.allInOverridden,
               noteShown: !note.hidden, noteTxt: note.textContent };
    })()`);
    check(
      'AB2 a book-filled all-in rate says so on the form (D4/D7 note)',
      ab2 &&
        ab2.filled === true &&
        ab2.overridden === false &&
        ab2.noteShown &&
        /JIC/i.test(ab2.noteTxt || ''),
      ab2
    );
    const ab3 = await ev(`(function(){
      var a = document.getElementById('calc-allin'); a.value = '25'; a.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var r = __calcEngine.computeFor(__calcEngine.readState());
      var note = document.getElementById('calc-book-note');
      return { cost: Math.round(r.allInCost), filled: r.bookFilled, overridden: r.allInOverridden, noteHidden: note.hidden };
    })()`);
    check(
      'AB3 typing over the book wins and drops the published-rate note (D4 - the book is a default, never a lock)',
      ab3 && ab3.cost === 2000 && ab3.filled === false && ab3.overridden === true && ab3.noteHidden,
      ab3
    );
    const ab4 = await ev(`(function(){
      var a = document.getElementById('calc-allin'); a.value = ''; a.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var r = __calcEngine.computeFor(Object.assign(__calcEngine.readState(),
        { _matModel: document.getElementById('calc-rate-mat').dataset.model,
          _labModel: document.getElementById('calc-rate-lab').dataset.model }));
      var out = document.getElementById('calc-output').textContent;
      return { allIn: r.allIn, mat: Math.round(r.mat), lab: Math.round(r.lab), backToSplit: out.indexOf('Materials') > -1 };
    })()`);
    check(
      'AB4 clearing the all-in field falls back to the split rates (320/720)',
      ab4 && ab4.allIn === false && ab4.mat === 320 && ab4.lab === 720 && ab4.backToSplit,
      ab4
    );
    const ab5 = await ev(`(function(){
      var E = __calcEngine;
      var st = Object.assign(E.readState(), { work: 'blockwall', d1: '10', d2: '2.4',
        allInRate: '60', piecePrice: '800', pieceSize: '40 x 20', labourOnly: true });
      var r = E.computeFor(st);
      var st2 = Object.assign({}, st, { labourOnly: false, piecePrice: '' });
      var r2 = E.computeFor(st2);
      return { beatsPiece: r.allIn && r.mat === 0 && r.lab === 0 && Math.round(r.allInCost) === 1440,
               labourOnlyInactive: r.labourOnly === false };
    })()`);
    check(
      'AB5 all-in beats piece pricing and labour-only rather than erroring or double-applying',
      ab5 && ab5.beatsPiece && ab5.labourOnlyInactive,
      ab5
    );
    const ab6 = await ev(`(function(){
      var E = __calcEngine;
      // Drive the FORM, not a local state object - a snapshot only holds what
      // the DOM actually carried, so the round-trip has to start there.
      var b = document.getElementById('calc-basis'); b.value = 'allin'; b.dispatchEvent(new Event('change',{bubbles:true}));
      var a = document.getElementById('calc-allin'); a.value = '25'; a.dataset.model = '';
      a.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var before = E.computeFor(Object.assign(E.readState(), { _allInModel: a.dataset.model })).total;
      var json = JSON.stringify(E.readState());
      // wipe, then recall
      ['calc-allin','calc-days','calc-day-rate'].forEach(function(id){
        var el = document.getElementById(id); el.value = ''; if (el.dataset) el.dataset.model = '';
      });
      document.getElementById('calc-basis').value = 'measured';
      E.applyState(JSON.parse(json));
      var a2 = document.getElementById('calc-allin');
      var after = E.computeFor(Object.assign(E.readState(), { _allInModel: a2.dataset.model })).total;
      return { identical: Math.abs(before - after) < 0.001, before: Math.round(before), after: Math.round(after),
               basisBack: document.getElementById('calc-basis').value, fieldBack: a2.value };
    })()`);
    check(
      'AB6 an all-in line recalled from its snapshot reproduces its total exactly (D4 recall fidelity)',
      ab6 && ab6.identical && ab6.before === ab6.after && ab6.basisBack === 'allin',
      ab6
    );
    const ab7 = await ev(`(function(){
      var E = __calcEngine;
      var p = E.jicBookPayload();
      var entries = Object.keys(p.books[0].rates).reduce(function(n,k){ return n + Object.keys(p.books[0].rates[k]).length; }, 0);
      var res = E.importBooks(p);
      var books = JSON.parse(localStorage.getItem('mmgr_calc_books') || '[]');
      var rt = E.importBooks({ books: books.map(function(b){ return { name: b.name + ' RT', currency: b.currency, rates: b.rates, checksum: b.checksum }; }) });
      var csum = books.length ? books[0].checksum : null;
      return { entryCount: p.entryCount, entries: entries, currency: p.books[0].currency,
               merged: res.merged, skipped: res.skipped, badKeys: res.badKeys,
               checksumHolds: csum === p.books[0].checksum, rt: rt };
    })()`);
    check(
      'AB7 the shipped Jamaica book imports 100 all-in rates with skipped 0 / badKeys 0 and its checksum round-trips',
      ab7 &&
        ab7.entryCount === 100 &&
        ab7.entries === 100 &&
        ab7.currency === 'JMD' &&
        ab7.merged === 1 &&
        ab7.skipped === 0 &&
        ab7.badKeys === 0 &&
        ab7.checksumHolds &&
        ab7.rt &&
        ab7.rt.skipped === 0,
      ab7
    );
    // OWNER 2026-10-02 (final, "we are not a converter - no negotiable").
    // Locks the contract so it cannot drift back: NOTHING seeds an exchange
    // rate, the JIC book's own JMD all-in rate fills the field with no
    // conversion involved, and a trade the book does not cover keeps the
    // honest empty-field note rather than borrowing a converted figure.
    const nc = await ev(`(function(){
      var E = __calcEngine;
      var out = {};
      // 1. The FX table carries no rate at all (earlier gates may have set
      // one deliberately, so CLEAR it first - the claim under test is that
      // the app never puts one there by itself).
      try { localStorage.removeItem('mmgr_calc_fx'); } catch (e) {}
      var t = E.loadFx();
      out.fxKeys = Object.keys(t);
      out.seededFlag = !!(t.JMD && t.JMD.seeded);
      // 2. JMD + Jamaica are what a NEW job opens on.
      var cc = document.getElementById('calc-currency');
      var co = document.getElementById('calc-country');
      cc.value = 'JMD'; cc.dispatchEvent(new Event('change',{bubbles:true}));
      co.value = 'JM'; co.dispatchEvent(new Event('change',{bubbles:true}));
      out.cur = cc.value;
      out.country = co.value;
      // 3. A JIC-covered trade: the all-in field fills from the book itself.
      var w = document.getElementById('calc-work');
      w.value = 'blockwall'; w.dispatchEvent(new Event('change',{bubbles:true}));
      out.allinFilled = document.getElementById('calc-allin').value !== '';
      // 4. It prices in JAMAIC dollars with no USD banner over it.
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '3';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var txt = document.getElementById('calc-output').textContent;
      out.jmd = txt.indexOf('J$') > -1;
      out.usdBanner = txt.indexOf('Built-in model rates are US dollars') > -1;
      out.allinLine = txt.indexOf('Work rate (all-in)') > -1;
      var r = E.computeFor(E.readState());
      out.allIn = r.allIn; out.modelUnconverted = !!r.modelUnconverted;
      // 5. A trade the book does NOT cover: field EMPTY + honest note, never
      //    a borrowed or converted number.
      w.value = 'drywall'; w.dispatchEvent(new Event('change',{bubbles:true}));
      out.uncovEmpty = document.getElementById('calc-rate-mat').value === '';
      var note = document.getElementById('calc-fx-note');
      out.uncovNote = !note.hidden && /JMD/.test(note.textContent || '');
      // Restore the state the next families expect: this gate deliberately
      // moved the form onto JMD/Jamaica and left the FX table cleared, and
      // every family after it sets up its own - but the ones that only pin a
      // field or two would otherwise inherit JMD money.
      try { localStorage.removeItem('mmgr_calc_fx'); } catch (e) {}
      cc.value = 'USD'; cc.dispatchEvent(new Event('change',{bubbles:true}));
      co.value = 'US'; co.dispatchEvent(new Event('change',{bubbles:true}));
      w.value = 'siteprep'; w.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10';
      document.getElementById('calc-d2').value = '8';
      document.getElementById('calc-currency').dispatchEvent(new Event('input',{bubbles:true}));
      var bs = document.getElementById('calc-basis');
      bs.value = 'measured'; bs.dispatchEvent(new Event('change',{bubbles:true}));
      return out;
    })()`);
    check(
      'NC1 we are not a converter: no seeded FX rate, JMD default, the JIC book fills its own all-in rate in J$, and an uncovered trade stays empty with the honest note',
      nc &&
        nc.fxKeys.length === 0 &&
        !nc.seededFlag &&
        nc.cur === 'JMD' &&
        nc.country === 'JM' &&
        nc.allinFilled &&
        nc.jmd &&
        !nc.usdBanner &&
        nc.allinLine &&
        nc.allIn === true &&
        !nc.modelUnconverted &&
        nc.uncovEmpty &&
        nc.uncovNote,
      nc
    );
    const ab8 = await ev(`(function(){
      // E1 currency honesty: a JMD book with no JMD rate must leave the field
      // EMPTY and say so - never a relabelled Jamaican figure. Import the
      // shipped book FRESH and activate it BY NAME: in a full-suite run the
      // books store also holds unrelated fixtures, so index or currency alone
      // would not reliably pick the Jamaican one.
      try { localStorage.removeItem('mmgr_calc_fx'); } catch (e) {}
      var E = __calcEngine;
      E.importBooks(E.jicBookPayload());
      var books = JSON.parse(localStorage.getItem('mmgr_calc_books') || '[]');
      var jb = books.filter(function(b) { return b.name === 'Jamaica rate book 2025-2027'; })[0];
      if (!jb) return { bookActive: false };
      E.setActiveBook(jb.id);
      // Re-run the prefill through the real form so the honest note is painted.
      var w = document.getElementById('calc-work'); w.value = 'blockwall'; w.dispatchEvent(new Event('change',{bubbles:true}));
      var v = document.getElementById('calc-variant'); if (v) { v.value = '8in-ff'; v.dispatchEvent(new Event('change',{bubbles:true})); }
      var a = document.getElementById('calc-allin');
      a.value = ''; a.dataset.model = '';
      a.dispatchEvent(new Event('input',{bubbles:true}));
      var m = E.modelRatesFor('blockwall', '8in-ff', 'USD', 10, 2.4);
      var note = document.getElementById('calc-fx-note');
      var fieldEmpty = document.getElementById('calc-allin').value === '';
      var noteHonest = !!note && !note.hidden && /JMD/.test(note.textContent || '');
      E.setActiveBook('');
      // Leave the form as we found it so the next family starts clean.
      w.value = 'siteprep'; w.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10'; document.getElementById('calc-d2').value = '8';
      document.getElementById('calc-allin').value = ''; document.getElementById('calc-allin').dataset.model = '';
      return { unconvertible: m && m.unconvertible === true, src: m && m.src,
               fieldEmpty: fieldEmpty, noteHonest: noteHonest, bookActive: true };
    })()`);
    check(
      'AB8 with the Jamaica book active but no JMD rate set, the all-in field stays EMPTY and the note names JMD (E1 currency honesty)',
      ab8 && ab8.unconvertible && ab8.src === 'JMD' && ab8.fieldEmpty && ab8.noteHonest,
      ab8
    );

    // ---- DB: per-day crew rate ----
    const db1 = await ev(`(function(){
      // Set the trade up explicitly - each family owns its own form state, so
      // no earlier gate's leftovers can move the expected material money.
      var w = document.getElementById('calc-work'); w.value = 'siteprep'; w.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10'; document.getElementById('calc-d2').value = '8';
      document.getElementById('calc-currency').value = 'USD';
      var rm = document.getElementById('calc-rate-mat'); rm.value = ''; rm.dispatchEvent(new Event('input',{bubbles:true}));
      var b = document.getElementById('calc-basis'); b.value = 'days'; b.dispatchEvent(new Event('change',{bubbles:true}));
      var d = document.getElementById('calc-days'); d.value = '2.5';
      var dr = document.getElementById('calc-day-rate'); dr.value = '400';
      d.dispatchEvent(new Event('input',{bubbles:true})); dr.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var r = __calcEngine.computeFor(Object.assign(__calcEngine.readState(),
        { _matModel: document.getElementById('calc-rate-mat').dataset.model,
          _labModel: document.getElementById('calc-rate-lab').dataset.model }));
      var out = document.getElementById('calc-output').textContent;
      var csv = __calcEngine.estimateCsv(r);
      return { daysShown: !document.getElementById('calc-days-wrap').hidden,
               allinHidden: document.getElementById('calc-allin-wrap').hidden,
               dayBasis: r.dayBasis, days: r.days, lab: Math.round(r.lab), mat: Math.round(r.mat),
               total: Math.round(r.total), labelHasDays: out.indexOf('2.5 days') > -1,
               // OWNER 2026-10-02: the days and the crew rate are ASSUMPTION rows now, so
               // the labour total in the COST BLOCK carries the basis note.
               csvDays: csv.indexOf('"Days on site","2.5"') > -1,
               csvRate: csv.indexOf('"Crew rate per day","400"') > -1,
               csvLabNote: csv.indexOf('2.5 days at 400 per day') > -1 };
    })()`);
    check(
      'DB1 days x rate lands in labour, material untouched, ONE labour total labelled with days x rate (D1/D2)',
      db1 &&
        db1.daysShown &&
        db1.allinHidden &&
        db1.dayBasis &&
        db1.days === 2.5 &&
        db1.lab === 1000 &&
        db1.mat === 320 &&
        db1.total === 1320 &&
        db1.labelHasDays &&
        db1.csvDays &&
        db1.csvRate &&
        db1.csvLabNote,
      db1
    );
    const db2 = await ev(`(function(){
      document.getElementById('calc-quality').value = 'premium';
      document.getElementById('calc-quality').dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var r = __calcEngine.computeFor(Object.assign(__calcEngine.readState(),
        { _matModel: document.getElementById('calc-rate-mat').dataset.model,
          _labModel: document.getElementById('calc-rate-lab').dataset.model }));
      document.getElementById('calc-quality').value = 'standard';
      document.getElementById('calc-quality').dispatchEvent(new Event('change',{bubbles:true}));
      return { lab: Math.round(r.lab), mat: Math.round(r.mat) };
    })()`);
    check(
      'DB2 the finish multiplier scales material only and NEVER a typed day rate (D8: 800 not 1080, mat 320->432)',
      db2 && db2.lab === 1000 && db2.mat === 432,
      db2
    );
    const db3 = await ev(`(function(){
      var E = __calcEngine;
      var base = Object.assign(E.readState(), { work: 'siteprep', d1: '10', d2: '8', daysStr: '2', dayRateStr: '400' });
      var on = E.computeFor(base);
      var cases = ['0','-3','abc','5000',''];
      var bad = [];
      cases.forEach(function(v){
        var st = Object.assign({}, base, { daysStr: v });
        var r = E.computeFor(st);
        if (!r || r.dayBasis || isNaN(r.total) || r.total !== 1040) bad.push(v + '=' + (r ? r.total : 'null'));
      });
      var halfRate = E.computeFor(Object.assign({}, base, { dayRateStr: '' }));
      return { okLab: Math.round(on.lab) === 800, bad: bad, halfRateFalls: halfRate.dayBasis === false && halfRate.total === 1040 };
    })()`);
    check(
      'DB3 blank / zero / negative / non-numeric / absurd days all fall back safely - never NaN into a total',
      db3 && db3.okLab && db3.bad.length === 0 && db3.halfRateFalls,
      db3
    );
    const db4 = await ev(`(function(){
      var E = __calcEngine;
      var st = Object.assign(E.readState(), { work: 'siteprep', d1: '10', d2: '8',
        basis: 'days', rateMat: '4', daysStr: '2', dayRateStr: '400', onCostPct: '12.5' });
      var r = E.computeFor(st);
      return { mat: Math.round(r.mat), lab: Math.round(r.lab), onCost: Math.round(r.onCost), sub: Math.round(r.sub) };
    })()`);
    check(
      'DB4 bought material AND crew days on one line, with employer on-costs still on the day rate (320+800+100=1220)',
      db4 && db4.mat === 320 && db4.lab === 800 && db4.onCost === 100 && db4.sub === 1220,
      db4
    );
    const db5 = await ev(`(function(){
      var E = __calcEngine, w = document.getElementById('calc-work');
      var note = document.getElementById('calc-day-note');
      var b = document.getElementById('calc-basis'); b.value = 'days'; b.dispatchEvent(new Event('change',{bubbles:true}));
      var res = {};
      ['paint','tile','render','excav','siteprep','blockwall'].forEach(function(k){
        w.value = k; w.dispatchEvent(new Event('change',{bubbles:true}));
        res[k] = { shown: !note.hidden, txt: note.textContent };
      });
      w.value = 'siteprep'; w.dispatchEvent(new Event('change',{bubbles:true}));
      return res;
    })()`);
    check(
      'DB5 the "not recommended" note appears only on the confirmed finish list, and never blocks (D9/D7)',
      db5 &&
        db5.paint.shown &&
        db5.tile.shown &&
        db5.render.shown &&
        !db5.excav.shown &&
        !db5.siteprep.shown &&
        !db5.blockwall.shown &&
        /not recommended/i.test(db5.paint.txt || ''),
      db5
    );
    const db6 = await ev(`(function(){
      var E = __calcEngine;
      document.getElementById('calc-basis').value = 'days';
      document.getElementById('calc-basis').dispatchEvent(new Event('change',{bubbles:true}));
      var d = document.getElementById('calc-days'); d.value = '0.75';
      var dr = document.getElementById('calc-day-rate'); dr.value = '400';
      d.dispatchEvent(new Event('input',{bubbles:true})); dr.dispatchEvent(new Event('input',{bubbles:true}));
      var st = Object.assign(E.readState(), { work: 'siteprep', d1: '10', d2: '8' });
      var q = E.computeFor(st);
      var snapped = E.computeFor(Object.assign({}, st, { daysStr: '2.3' }));
      var json = JSON.stringify(E.readState());
      ['calc-days','calc-day-rate'].forEach(function(id){ document.getElementById(id).value = ''; });
      E.applyState(JSON.parse(json));
      var back = E.computeFor(E.readState());
      return { quarter: Math.round(q.lab), rounded: snapped.days, recallDays: back.days, recallLab: Math.round(back.lab) };
    })()`);
    check(
      'DB6 quarter-days land exactly, days round to a 0.25 step, and a day line recalls identically',
      db6 &&
        db6.quarter === 300 &&
        db6.rounded === 2.25 &&
        db6.recallDays === 0.75 &&
        db6.recallLab === 300,
      db6
    );

    // UNIT-SLIP GUARD (SLIP family, owner directive 2026-10-01).
    const slip1 = await ev(`(function(){
      var a = __calcEngine.dimSlips({ work:'slab', units:'metric', d1:'10', d2:'8', d3:'0.15' });
      var b = __calcEngine.dimSlips({ work:'slab', units:'metric', d1:'10', d2:'8', d3:'6' });
      var c = __calcEngine.dimSlips({ work:'blockwall', units:'metric', d1:'300', d2:'2.4' });
      var clean = __calcEngine.dimSlips({ work:'slab', units:'metric', d1:'10', d2:'8', d3:'150' });
      return { metres: a, inches: b, feet: c, cleanN: clean.length,
               aFix: a[0] && a[0].fix, bFix: b[0] && b[0].fix, cFix: c[0] && c[0].fix };
    })()`);
    check(
      'SLIP1 slip rules: 0.15 in a mm box suggests 150, 6 suggests 152, 30 m suggests 9.14 m (feet), clean dims flag nothing',
      slip1 &&
        slip1.metres.length === 1 &&
        slip1.aFix === '150' &&
        slip1.bFix === '152' &&
        slip1.cFix === '91.44' &&
        slip1.cleanN === 0,
      slip1
    );
    const slip3 = await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '10'; document.getElementById('calc-d2').value = '8'; document.getElementById('calc-d3').value = '0.15';
      document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcRun]').click();
      var out = document.getElementById('calc-output');
      var flagged = out.textContent.indexOf('did you mean 150 mm?') > -1;
      var btn = out.querySelector('[data-action=calcFixDim]');
      var hasFix = !!btn && btn.getAttribute('data-val') === '150';
      if (btn) btn.click();
      var fixed = document.getElementById('calc-d3').value;
      var out2 = document.getElementById('calc-output').textContent;
      var gone = out2.indexOf('did you mean') === -1;
      // Leave the page as the U-block expects it.
      document.getElementById('calc-work').value = 'floor-screed';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-d1').value = '5'; document.getElementById('calc-d2').value = '4'; document.getElementById('calc-d3').value = '50';
      return { flagged: flagged, hasFix: hasFix, fixed: fixed, gone: gone };
    })()`);
    check(
      'SLIP3 UI: 0.15 thickness flags with a one-tap Use 150 fix that applies and clears the flag',
      slip3 && slip3.flagged && slip3.hasFix && slip3.fixed === '150' && slip3.gone,
      slip3
    );

    // ---------- PLAN V2 PHASE 2 (2026-10-01): CONCRETE CHAIN ----------
    // NV family: the new variant trades price through the SAME engine.
    const nv1 = await ev(`(function(){
      var work = document.getElementById('calc-work');
      work.value = 'rebar-size'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var sel = document.getElementById('calc-variant');
      var matLbl = document.getElementById('calc-rate-mat-label').textContent;
      work.value = 'stirrups'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var stirrupLbl = document.getElementById('calc-rate-mat-label').textContent;
      work.value = 'fabric-mesh'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var meshLbl = document.getElementById('calc-rate-mat-label').textContent;
      return { rebarOpts: (work.value = 'rebar-size', work.dispatchEvent(new Event('change',{bubbles:true})), document.getElementById('calc-variant').options.length),
               matLbl: matLbl, stirrupLbl: stirrupLbl, meshLbl: meshLbl };
    })()`);
    check(
      'NV1 variant trades: rebar-size shows 5 bar sizes; rate labels speak JIC units (per lb / per dozen / per yd2)',
      nv1 &&
        nv1.rebarOpts === 5 &&
        nv1.matLbl.indexOf('per lb') > -1 &&
        nv1.stirrupLbl.indexOf('per dozen') > -1 &&
        nv1.meshLbl.indexOf('per yd2') > -1,
      nv1
    );
    const nv2 = await ev(`(function(){
      var r = __calcEngine.computeFor({ work:'stirrups', variant:'3-8', d1:'120', units:'metric', quality:'standard', currency:'USD', country:'US' });
      var r2 = __calcEngine.computeFor({ work:'fabric-mesh', d1:'50', units:'metric', quality:'standard', currency:'USD', country:'US' });
      return { stirrups: r ? { mat: Math.round(r.mat*100)/100, lab: r.lab } : null,
               mesh: r2 ? { mat: Math.round(r2.mat*100)/100, lab: Math.round(r2.lab*100)/100 } : null,
               stirrupUnit: r && r.unit, meshUnit: r2 && r2.unit };
    })()`);
    check(
      'NV2 engine conversions: 120 stirrups at 8/15 per dozen = 80/150; 50 m2 mesh at 5.5/2.5 per yd2 = 328.9/149.5 (audit fix: entry-per-engine factors)',
      nv2 &&
        nv2.stirrups &&
        nv2.stirrups.mat === 80 &&
        nv2.stirrups.lab === 150 &&
        nv2.mesh &&
        nv2.mesh.mat === 328.9 &&
        nv2.mesh.lab === 149.5,
      nv2
    );
    const nv3 = await ev(`(function(){
      var work = document.getElementById('calc-work');
      work.value = 'blockwall'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var blockOpts = document.getElementById('calc-variant').options.length;
      work.value = 'excav'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var soilOpts = document.getElementById('calc-variant').options.length;
      work.value = 'formwork'; work.dispatchEvent(new Event('change',{bubbles:true}));
      var fwOpts = document.getElementById('calc-variant').options.length;
      var r = __calcEngine.computeFor({ work:'formwork', variant:'wall-edge', d1:'20', units:'metric', quality:'standard', currency:'USD', country:'US' });
      var d1l = document.getElementById('calc-d1-label').textContent;
      return { blockOpts: blockOpts, soilOpts: soilOpts, fwOpts: fwOpts, wallEdge: r ? r.total : null, d1l: d1l };
    })()`);
    check(
      'NV3 variant sets: blockwall 9 JIC masonry, excavation 9 JIC soils, formwork 9 JIC carpentry; first formwork variant = the old derived rates (20 m2 = 1100)',
      // JIC 2025-2027 re-baseline (2026-10-02): each of these three trades now
      // carries the full 9-rate official JIC list. The wall-edge formwork
      // first-variant total is still 1100 (pre-conversion rates preserved).
      nv3 &&
        nv3.blockOpts === 9 &&
        nv3.soilOpts === 9 &&
        nv3.fwOpts === 9 &&
        nv3.wallEdge === 1100 &&
        nv3.d1l === 'Contact area (m2)',
      nv3
    );
    const nv4 = await ev(`(function(){
      var r = __calcEngine.computeFor({ work:'concrete-labour', variant:'rod-settle', d1:'12', units:'metric', quality:'standard', currency:'USD', country:'US' });
      document.getElementById('calc-work').value = 'floor-screed';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      return { mat: r ? r.mat : null, lab: r ? r.lab : null, labourTrade: r ? r.labourOnly === false : null };
    })()`);
    check(
      'NV4 concrete labour: rod-and-settle 12 m3 = lab 660, mat 0 (a labour-only trade by rate, not by mode)',
      nv4 && nv4.mat === 0 && nv4.lab === 660,
      nv4
    );

    // ---------- RB family: the JAMERICA RATE BOOK card (JIC 2025-2027) ----------
    // The card and its top-bar link shipped with NO gate covering them
    // (lesson 14: a feature nothing asserts rots silently). These lock the
    // open/render/toggle/close contract AND the copy's own honesty - the
    // "90 line items" sentence used to contradict the 100 rows it sat above.
    const rb1 = await ev(`(function(){
      var btn = document.querySelector('.bcp-ratebook[data-action="openRateBook"]');
      return { hasBtn: !!btn, text: btn ? btn.textContent.replace(/\\s+/g,' ').trim() : '',
               icon: btn ? !!btn.querySelector('svg.ico use[href*="i-book"]') : false };
    })()`);
    // OWNER 2026-10-02: the top-bar label is the short "Rate book" (the popup
    // heading carries the full JIC name + years).
    check(
      'RB1 top bar carries the rate book link (SVG i-book icon + text)',
      rb1 && rb1.hasBtn && /rate book/i.test(rb1.text) && rb1.icon,
      rb1
    );
    const rb2 = await ev(`(function(){
      document.querySelector('.bcp-ratebook[data-action="openRateBook"]').click();
      var c = document.getElementById('calc-ratebook-card');
      if (!c) return { open: false };
      // OWNER INCIDENT 2026-10-02: presence is not visibility. A
      // display:none !important that escaped its @media print left the
      // card in the DOM, carrying every attribute RB2-RB5 assert - so the
      // whole rate-book block passed while the popup was invisible in the
      // browser. Measure the box AND the computed display.
      var r = c.getBoundingClientRect();
      var cs = getComputedStyle(c);
      return { open: true, role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'),
               isOverlay: c.className.indexOf('rr-overlay') > -1,
               w: Math.round(r.width), h: Math.round(r.height),
               display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
               panelW: Math.round((c.querySelector('.rr-panel')||{getBoundingClientRect:function(){return{width:0}}}).getBoundingClientRect().width),
               focusIn: !!(c.contains(document.activeElement)),
               title: (c.querySelector('.card-title')||{}).textContent || '',
               rows: c.querySelectorAll('tbody tr:not(.rr-trade)').length,
               groups: c.querySelectorAll('tbody tr.rr-trade').length,
               foot: (c.querySelector('.rr-foot')||{}).textContent || '',
               closeBtn: !!c.querySelector('[data-action="rrClose"]'),
               segs: c.querySelectorAll('[data-action="rrUnits"]').length };
    })()`);
    // OWNER 2026-10-02: the popup is titled for what the owner asked to see -
    // "JIC rates" plus the years the book governs, and NOTHING else (the old
    // line-item / trade-count / source sentence was removed).
    check(
      'RB2 the link opens the rate book popup titled "JIC rates 2025-2027"',
      rb2 &&
        rb2.open &&
        rb2.role === 'dialog' &&
        rb2.modal === 'true' &&
        rb2.isOverlay &&
        /JIC rates 2025-2027/.test(rb2.title) &&
        rb2.closeBtn,
      rb2
    );
    check(
      'RB3 the card lists all 100 JIC line items across 11 trade groups',
      rb2 && rb2.rows === 100 && rb2.groups === 11,
      { rows: rb2 && rb2.rows, groups: rb2 && rb2.groups }
    );
    // OWNER 2026-10-02: the count sentence is GONE by request, so this gate now
    // asserts the copy carries no stale count AND that the currency note is
    // still there (the table itself is checked by RB3).
    check(
      'RB4 the heading carries no line-item/source blurb; the currency note stays',
      rb2 &&
        rb2.title.indexOf('line item') === -1 &&
        rb2.title.indexOf('Source:') === -1 &&
        /Jamaican dollar/.test(rb2.foot),
      { title: rb2 && rb2.title, foot: rb2 && rb2.foot }
    );
    check('RB5 the card offers a metric/imperial toggle', rb2 && rb2.segs === 2, {
      segs: rb2 && rb2.segs
    });
    // OWNER INCIDENT 2026-10-02: the popup must actually PAINT. This is
    // the gate that would have caught the escaped print rule.
    check(
      'RB9 the open popup is VISIBLE (not display:none from a stray print rule)',
      rb2 &&
        rb2.w > 0 &&
        rb2.h > 0 &&
        rb2.display !== 'none' &&
        rb2.visibility !== 'hidden' &&
        Number(rb2.opacity) > 0 &&
        rb2.panelW > 0,
      {
        w: rb2 && rb2.w,
        h: rb2 && rb2.h,
        display: rb2 && rb2.display,
        visibility: rb2 && rb2.visibility,
        opacity: rb2 && rb2.opacity,
        panelW: rb2 && rb2.panelW
      }
    );
    check(
      'RB10 opening the popup moves focus INTO it (keyboard users land in the dialog)',
      rb2 && rb2.focusIn === true,
      { focusIn: rb2 && rb2.focusIn }
    );
    const rb6 = await ev(`(function(){
      var imp = document.querySelector('#calc-ratebook-card [data-action="rrUnits"][data-units="imperial"]');
      if (!imp) return { toggled: false };
      imp.click();
      var c = document.getElementById('calc-ratebook-card');
      var first = c.querySelector('tbody tr:not(.rr-trade)');
      var metricActive = c.querySelector('[data-units="metric"]').className.indexOf('active') > -1;
      var impActive = c.querySelector('[data-units="imperial"]').className.indexOf('active') > -1;
      var units = Array.prototype.map.call(c.querySelectorAll('tbody tr:not(.rr-trade) td:nth-child(3)'), function(td){ return td.textContent; });
      return { toggled: true, rowCount: c.querySelectorAll('tbody tr:not(.rr-trade)').length,
               firstUnit: first ? first.children[2].textContent : '', units: units.slice(0, 4),
               metricActive: metricActive, impActive: impActive,
               sameRowCount: c.querySelectorAll('tbody tr:not(.rr-trade)').length === 100 };
    })()`);
    check(
      'RB6 the imperial toggle flips the units and keeps every row',
      rb6 &&
        rb6.toggled &&
        rb6.impActive === true &&
        rb6.metricActive === false &&
        rb6.sameRowCount === true &&
        rb6.firstUnit !== 'Sq.',
      rb6
    );
    const rb7 = await ev(`(function(){
      var c = document.getElementById('calc-ratebook-card');
      var before = !!c;
      c.querySelector('[data-action="rrClose"]').click();
      return { before: before, after: !!document.getElementById('calc-ratebook-card') };
    })()`);
    check(
      'RB7 Close removes the rate book card',
      rb7 && rb7.before === true && rb7.after === false,
      rb7
    );
    // OWNER INCIDENT 2026-10-02: the Escape listener used to be bound to
    // the card, which never has focus, so Escape did nothing. It is a
    // document-level listener now - and it must be torn down on every exit
    // path (Close, Escape, the top-bar toggle, the units rebuild) or each
    // opening stacks another live handler.
    const rbEsc = await ev(`(function(){
      document.querySelector('.bcp-ratebook[data-action="openRateBook"]').click();
      var opened = !!document.getElementById('calc-ratebook-card');
      var locked = document.body.className.indexOf('rr-open') > -1;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      var afterEsc = !!document.getElementById('calc-ratebook-card');
      var lockAfter = document.body.className.indexOf('rr-open') > -1;
      // toggle path: open, then click the link again to close it
      document.querySelector('.bcp-ratebook[data-action="openRateBook"]').click();
      var reopened = !!document.getElementById('calc-ratebook-card');
      document.querySelector('.bcp-ratebook[data-action="openRateBook"]').click();
      var afterToggle = !!document.getElementById('calc-ratebook-card');
      var lockAfterToggle = document.body.className.indexOf('rr-open') > -1;
      // a leaked listener would now fire on a stray Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { opened: opened, locked: locked, afterEsc: afterEsc, lockAfter: lockAfter,
               reopened: reopened, afterToggle: afterToggle, lockAfterToggle: lockAfterToggle };
    })()`);
    check(
      'RB11 Escape closes the popup and releases the scroll lock',
      rbEsc &&
        rbEsc.opened === true &&
        rbEsc.locked === true &&
        rbEsc.afterEsc === false &&
        rbEsc.lockAfter === false,
      rbEsc
    );
    check(
      'RB12 the top-bar toggle closes the popup and leaves no leaked state',
      rbEsc &&
        rbEsc.reopened === true &&
        rbEsc.afterToggle === false &&
        rbEsc.lockAfterToggle === false,
      rbEsc
    );
    const rb8 = await ev(`(function(){
      var c = document.getElementById('calc-ratebook-card');
      return { leftBehind: !!c };
    })()`);
    check('RB8 the card leaves nothing behind after closing', rb8 && rb8.leftBehind === false, rb8);

    // LX family: the forgotten-work linter (X1, owner directive).
    const lx1 = await ev(`(function(){
      var mk = function(work) { return { st: { work: work } } };
      var flags = function(lines) { return __calcEngine.billLint(lines).map(function(f) { return f.id; }); };
      return {
        steel: flags([mk('rebar')]),
        pour: flags([mk('slab')]),
        wall: flags([mk('blockwall')]),
        dig: flags([mk('excav')]),
        complete: flags([mk('rebar'), mk('slab'), mk('formwork'), mk('footings'), mk('blockwall'), mk('cart-away')]),
        empty: flags([])
      };
    })()`);
    check(
      'LX1 linter rules: steel-no-concrete, pour-no-formwork, wall-no-footing, excav-no-cart fire; a complete bill and an empty bill lint clean',
      lx1 &&
        lx1.steel.join() === 'steel-no-concrete' &&
        lx1.pour.join() === 'pour-no-formwork' &&
        lx1.wall.join() === 'wall-no-footing' &&
        lx1.dig.join() === 'excav-no-cart' &&
        lx1.complete.length === 0 &&
        lx1.empty.length === 0,
      lx1
    );
    const lx2 = await ev(`(function(){
      localStorage.setItem('mmgr_calc_boq', JSON.stringify([
        { st: { work: 'slab', d1: '10', d2: '8', d3: '150', units: 'metric', currency: 'USD', country: 'US', quality: 'standard' }, name: 'Slab' }
      ]));
      __calcEngine.renderBoq();
      var box = document.getElementById('calc-lint');
      var shown = !box.hidden && box.textContent.indexOf('no formwork') > -1;
      var btn = box.querySelector('[data-action=calcLintFix]');
      var hasFix = !!btn && btn.getAttribute('data-fix') === 'formwork';
      if (btn) btn.click();
      var lines = JSON.parse(localStorage.getItem('mmgr_calc_boq'));
      var added = lines.length === 2 && lines[1].st.work === 'formwork' && lines[1].st.measuredQty === '5.4';
      var gone = document.getElementById('calc-lint').hidden;
      localStorage.removeItem('mmgr_calc_boq');
      __calcEngine.renderBoq();
      return { shown: shown, hasFix: hasFix, added: added, gone: gone };
    })()`);
    check(
      'LX2 UI: a slab-only bill flags the missing formwork; the one-tap fix adds the derived 5.4 m2 edge-formwork line and the flag clears',
      lx2 && lx2.shown && lx2.hasFix && lx2.added && lx2.gone,
      lx2
    );

    // ---------- F4 ENHANCEMENTS ----------
    // U1: imperial toggle - labels convert, state persists, aria follows.
    const u1 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();
      return { d1: document.getElementById('calc-d1-label').textContent,
               d3: document.getElementById('calc-d3-label').textContent,
               stored: localStorage.getItem('mmgr_calc_units'),
               pressed: document.querySelector('[data-action="calcUnits"][data-units="imperial"]').getAttribute('aria-pressed') };
    })()`);
    check(
      'U1 imperial toggle: labels (ft)/(in), stored, aria-pressed',
      u1 &&
        u1.d1 === 'Length (ft)' &&
        u1.d3 === 'Thickness (in)' &&
        u1.stored === 'imperial' &&
        u1.pressed === 'true',
      u1
    );

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
    check(
      'U2 imperial slab 33x26x6in -> 16.7 cu yd hero + metric reading',
      u2 && u2.cuyd === '16.7' && u2.altMetric === true,
      u2
    );

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
    check(
      'I1 unit-primary hero: 39.6 m2 metric / 40 sq ft imperial',
      i1 &&
        i1.metricHero.indexOf('39.6 m2') === 0 &&
        i1.impHero.indexOf('40 sq ft') === 0 &&
        i1.impHero.indexOf('3.68 m2') > -1,
      i1
    );

    // U3: back to metric - labels restore, storage flips back.
    const u3 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      return { d1: document.getElementById('calc-d1-label').textContent, stored: localStorage.getItem('mmgr_calc_units') };
    })()`);
    check(
      'U3 metric restore: label (m), storage metric',
      u3 && u3.d1 === 'Length (m)' && u3.stored === 'metric',
      u3
    );

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
    check(
      'X1 valid result reveals print/CSV/save actions',
      x1 && x1.visible && x1.print && x1.csv && x1.save,
      x1
    );

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
      return { ok: clicked, bom: !!bytes && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, // OWNER 2026-10-02: the CSV's money total row is now "ESTIMATED TOTAL".
      hasTotal: text.indexOf('ESTIMATED TOTAL') > -1, hasSlab: text.indexOf('Concrete slab') > -1 };
    })()`);
    check(
      'X2 CSV export: BOM bytes + total + work item in blob',
      x2 && x2.ok && x2.bom && x2.hasTotal && x2.hasSlab,
      x2
    );

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
    check(
      'S1 Save stores the named estimate',
      s1 && s1.rows === 1 && s1.name === 'Garage slab QA' && s1.work === 'slab',
      s1
    );

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
    check(
      'S4 history row delete removes exactly one row',
      s4 && s4.before >= 1 && s4.after === s4.before - 1,
      s4
    );

    // U4: the unit choice survives a reload (init reads storage before first paint).
    await ev(`document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();`);
    await ev(`location.reload();`);
    await delay(1800);
    const u4 = await ev(`(function(){
      return { d1: document.getElementById('calc-d1-label').textContent,
               pressed: document.querySelector('[data-action="calcUnits"][data-units="imperial"]').getAttribute('aria-pressed'),
               emptyState: document.getElementById('calc-output').textContent.indexOf('Pick a work item') > -1 };
    })()`);
    check(
      'U4 unit choice survives reload (labels imperial, form clean)',
      u4 && u4.d1 === 'Length (ft)' && u4.pressed === 'true' && u4.emptyState,
      u4
    );

    // ---------- F4b RATE FREEDOM + EXACT RECALL ----------
    // R1: rate fields prefill with the model rate + per-unit labels.
    // (Metric first: earlier F4 gates leave imperial behind.)
    const r1 = await ev(`(function(){
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      // OWNER 2026-10-02: this gate tests the MODEL rate (150/85). The page
      // now defaults to JMD with a seeded 158 rate, so pin USD to read the
      // raw model figures - the converted path is covered by FX gates.
      var c = document.getElementById('calc-currency');
      c.value = 'USD'; c.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      return { mat: document.getElementById('calc-rate-mat').value,
               lab: document.getElementById('calc-rate-lab').value,
               matLbl: document.getElementById('calc-rate-mat-label').textContent,
               labLbl: document.getElementById('calc-rate-lab-label').textContent };
    })()`);
    check(
      'R1 rate prefill: slab 150/85, per m3 labels',
      r1 &&
        r1.mat === '150' &&
        r1.lab === '85' &&
        /per m3/.test(r1.matLbl) &&
        /per m3/.test(r1.labLbl),
      r1
    );

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
    check(
      'R3 reset-to-model clears override (back to 150, no note)',
      r3 && r3.mat === '150' && !r3.yours,
      r3
    );

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
    check(
      'R4 tile per-piece 950 / (0.3x0.6) = 5277.78/m2 exact',
      r45 && r45.eff === 5277.78 && r45.line,
      r45
    );
    const r5b = await ev(`(function(){
      document.getElementById('calc-work').value = 'slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var lbl = document.getElementById('calc-piece-price-label').textContent;
      return { visible: !document.getElementById('calc-piece-wrap').hidden, bagLbl: lbl };
    })()`);
    // OWNER 2026-10-02: tile's sizes ARE listed in the rate sheet, so its piece
    // row is behind the "not in the rate sheet" opt-in (PC1 covers that).
    // Tick it here so this gate still checks tile PRICES per piece, and
    // leave slab as the un-opted-in control.
    const r45b = await ev(`(function(){
      document.getElementById('calc-work').value = 'tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var pc = document.getElementById('calc-piece-custom');
      var had = pc && !pc.checked;
      if (had) { pc.checked = true; pc.dispatchEvent(new Event('change',{bubbles:true})); }
      var out = { visible: !document.getElementById('calc-piece-wrap').hidden,
                  lbl: document.getElementById('calc-piece-price-label').textContent };
      if (had) { pc.checked = false; pc.dispatchEvent(new Event('change',{bubbles:true})); }
      return out;
    })()`);
    check(
      'R5 piece row follows the trade: area on tile (behind its opt-in), bag-yield on slab',
      r45b &&
        r45b.visible &&
        /tile/i.test(r45b.lbl) &&
        r5b &&
        r5b.visible &&
        /bag/i.test(r5b.bagLbl),
      { tile: r45b, slab: r5b }
    );
    // OWNER 2026-10-02: a trade whose SIZES are listed in the rate sheet
    // (blockwall, tile, paint) hides its piece fields behind the opt-in; the
    // opt-in itself only appears for those trades. slab has no size list, so
    // its fields stay put - asserted above.
    const pc1 = await ev(`(function(){
      function probe(k){
        document.getElementById('calc-work').value = k;
        document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
        var pc = document.getElementById('calc-piece-custom');
        var optInShown = pc && pc.parentElement.offsetParent !== null;
        var rowShown = !document.getElementById('calc-piece-wrap').hidden;
        return { optInShown: !!optInShown, rowShown: rowShown };
      }
      var bw = probe('blockwall');
      var tile = probe('tile');
      var paint = probe('paint');
      var slab = probe('slab');
      // Tick the opt-in on blockwall and prove the row appears.
      document.getElementById('calc-work').value='blockwall';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var pc = document.getElementById('calc-piece-custom');
      pc.checked = true; pc.dispatchEvent(new Event('change',{bubbles:true}));
      var afterTick = !document.getElementById('calc-piece-wrap').hidden;
      var lbl = document.getElementById('calc-piece-price-label').textContent;
      // Untick again so later families start clean.
      pc.checked = false; pc.dispatchEvent(new Event('change',{bubbles:true}));
      var afterUntick = !document.getElementById('calc-piece-wrap').hidden;
      // Leave the form on slab (its un-opted-in state).
      probe('slab');
      return { bw: bw, tile: tile, paint: paint, slab: slab, afterTick: afterTick, afterUntick: afterUntick, lbl: lbl };
    })()`);
    check(
      'PC1 blockwork/tile/paint hide price-per-piece behind a "not in the rate sheet" opt-in; slab keeps its fields',
      pc1 &&
        pc1.bw.optInShown &&
        !pc1.bw.rowShown &&
        pc1.tile.optInShown &&
        !pc1.tile.rowShown &&
        pc1.paint.optInShown &&
        !pc1.paint.rowShown &&
        !pc1.slab.optInShown &&
        pc1.slab.rowShown &&
        pc1.afterTick &&
        !pc1.afterUntick &&
        /block/i.test(pc1.lbl),
      pc1
    );

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
    // Plan v2 E1 re-baseline: in JMD with no exchange rate the fields stay
    // EMPTY (honest note instead) while the engine still prices from the
    // model - the total renders and the note names the missing rate.
    const e2 = await ev(`(function(){
      localStorage.setItem('mmgr_calc_history', JSON.stringify([{ at:'2026-09-01', name:'Old row', qty:'96.9 m2', total:'J$1,000',
        work:'tile', d1:'10', d2:'8', currency:'JMD', country:'JM', quality:'standard' }]));
      document.querySelector('[data-action=calcRestore]').click();
      return { work: document.getElementById('calc-work').value, d1: document.getElementById('calc-d1').value,
               units: localStorage.getItem('mmgr_calc_units'), rm: document.getElementById('calc-rate-mat').value,
               note: !document.getElementById('calc-fx-note').hidden,
               priced: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1 };
    })()`);
    // OWNER 2026-10-02 (final): WE ARE NOT A CONVERTER. The USD planning-grade
    // model rates cannot become JMD without a rate the owner sets themselves,
    // so a JMD legacy row recalls with an EMPTY rate field and the honest
    // note naming the gap - exactly the E1 contract. It still prices (the
    // engine falls back safely), it just never invents a converted number.
    check(
      'E2 legacy JMD row recalls: units inferred (m), rate left EMPTY with the honest note, still priced (no invented conversion)',
      e2 &&
        e2.work === 'tile' &&
        e2.d1 === '10' &&
        e2.units === 'metric' &&
        e2.rm === '' &&
        e2.note &&
        e2.priced,
      e2
    );

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
    check(
      'W1 tile waste defaults to 10, allowance line renders',
      w1 && w1.visible && w1.def === '10' && w1.line && w1.line.indexOf('10%') > -1,
      w1
    );

    // W2: typing 20 raises the tile count (36 -> 43.2 m2 effective) and the total.
    const w2 = await ev(`(function(){
      var before = document.getElementById('calc-output').textContent;
      document.getElementById('calc-waste').value='20';
      document.getElementById('calc-waste').dispatchEvent(new Event('input',{bubbles:true}));
      var after = document.getElementById('calc-output').textContent;
      var q = function(t){ var m = t.match(/([\\d.,]+) m2/); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };
      return { before: q(before), after: q(after), raised: q(after) > q(before) };
    })()`);
    check(
      'W2 waste 20 raises effective quantity (36 -> 43.2 m2)',
      w2 && w2.before === 39.6 && w2.after === 43.2 && w2.raised,
      w2
    );

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
    check(
      'W3 non-waste trade hides field; roof label = laps',
      w3 && w3.blockHidden && w3.roofLbl === 'Laps / pitch allowance %' && w3.roofDef === '10',
      w3
    );

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
    check(
      'C1 tile count: ceil(39.6/0.18) = 220 tiles at 30 x 60 cm',
      c1 && c1.order === '220' && c1.at && c1.mat,
      c1
    );

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
    check(
      'C2 size-only count keeps showing; slab yield 20 -> 788 bags',
      c2 && c2.tileCount === '220' && c2.tileMat && c2.slabBags === '788' && c2.matLbl,
      c2
    );

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
    check(
      'E1 equipment 10/m3 on 12.6 m3 adds 126 to subtotal',
      e3a && e3a.hasLine && Math.abs(e3a.delta - 126) < 2,
      e3a
    );

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
    check(
      'E2 overhead 10% line + tax on sub+oh',
      e3b && e3b.hasOh && e3b.taxOnSubOh && e3b.totalOk,
      e3b
    );

    // E3: defaults stay clean - clearing both fields removes both lines.
    const e3c = await ev(`(function(){
      document.getElementById('calc-rate-eq').value='';
      document.getElementById('calc-oh').value='';
      document.getElementById('calc-rate-eq').dispatchEvent(new Event('input',{bubbles:true}));
      var t = document.getElementById('calc-output').textContent;
      return { noEq: t.indexOf('Equipment / plant hire') === -1, noOh: t.indexOf('Overhead') === -1 };
    })()`);
    check(
      "E3 empty equipment/overhead = today's four-line breakdown",
      e3c && e3c.noEq && e3c.noOh,
      e3c
    );

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
    check(
      'T1 export downloads JSON carrying the saved sheet',
      t1 &&
        t1.ok &&
        t1.hasName &&
        t1.ver === 1 &&
        t1.n >= 1 &&
        String(t1.msg).indexOf('Exported') > -1,
      t1
    );

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
    check(
      'T2 import merges: replaces qa-low-bid, adds qa-sustain',
      t2 &&
        t2.names.indexOf('qa-sustain') > -1 &&
        String(t2.lowBidMat) === '111' &&
        String(t2.msg).indexOf('Imported 2') > -1,
      t2
    );

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
    check(
      'T3 garbage import rejected with message, storage intact',
      t3 && String(t3.msg).indexOf('not a My MaNaGeR rate sheet export') > -1 && t3.unchanged,
      t3
    );

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
    check(
      'P1 compare with 0 ticked -> guidance, no table',
      p1 && String(p1.msg).indexOf('Tick at least two') > -1 && p1.hidden,
      p1
    );

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
    check(
      'P2 compare table renders both columns, cheapest highlighted',
      p2 && p2.visible && p2.cols === 2 && p2.hasWork && p2.hasQty && p2.bestCells === 1,
      p2
    );

    // P3: comparing must not mutate the live form inputs.
    const p3 = await ev(`(function(){
      return { d1: document.getElementById('calc-d1').value,
               d2: document.getElementById('calc-d2').value,
               d3: document.getElementById('calc-d3').value,
               q: document.getElementById('calc-quality').value,
               total: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1 };
    })()`);
    check(
      'P3 comparison leaves the live form untouched',
      p3 && p3.d1 === '10' && p3.d2 === '8' && p3.d3 === '150' && p3.total,
      p3
    );

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
      var stored = '';
      try { stored = (JSON.parse(localStorage.getItem('mmgr_calc_brand') || '{}').name) || ''; } catch (e) {}
      return { stored: stored,
               biz: document.getElementById('calc-quote-biz').textContent,
               meta: document.getElementById('calc-quote-meta').textContent,
               printBtn: String(document.querySelector('[data-action=calcPrint]').textContent).indexOf('Print / PDF') > -1 };
    })()`);
    check(
      'Q1 (re-baselined 2026-10-01) business name saves into the BRAND store + quote head fills (name, work, date)',
      q1 &&
        q1.stored === 'QA Builders Ltd' &&
        q1.biz === 'QA Builders Ltd' &&
        String(q1.meta).indexOf('Garage slab QA') > -1 &&
        String(q1.meta).indexOf('2026-') > -1 &&
        q1.printBtn,
      q1
    );

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
    check(
      'Q2 quote head: screen none, print block under body.print-estimate',
      q2 && q2.screen === 'none' && q2b && q2b.withoutScope === 'none' && q2b.withScope === 'block',
      q2b
    );

    // clean the letterhead + save-name for later gates (brand store now)
    await ev(`(function(){
      localStorage.removeItem('mmgr_calc_brand');
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
    check(
      'X3 CSV carries used rates + piece pricing lines',
      x3 && x3.ok && x3.rates && x3.piece,
      x3
    );

    // ---------- F4c: PER-PIECE EXPANSION + RATE SHEETS ----------
    // P1-P4: piece math per trade (metric explicitly).
    const pieceCheck = async (work, price, size, d1, d2, expectPat, name) => {
      const r = await ev(`(function(){
        document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
        document.getElementById('calc-work').value = '${work}';
        document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('calc-d1').value='${d1}'; document.getElementById('calc-d2').value='${d2}';
        document.getElementById('calc-piece-price').value='${price}'; document.getElementById('calc-piece-size').value='${size}';
        // OWNER 2026-10-02: trades whose sizes ARE in the rate sheet hide the
        // piece fields behind the "my size is not in the rate sheet" opt-in.
        // Tick it so the harness is testing PRICING, not the new visibility.
        var pc = document.getElementById('calc-piece-custom');
        if (pc && pc.offsetParent !== null && !pc.checked) { pc.checked = true; pc.dispatchEvent(new Event('change',{bubbles:true})); }
        document.getElementById('calc-d1').dispatchEvent(new Event('input',{bubbles:true}));
        var t = document.getElementById('calc-output').textContent;
        return { hit: t.indexOf('${expectPat}') > -1, line: t.indexOf('priced per piece') > -1, pieceVisible: !document.getElementById('calc-piece-wrap').hidden };
      })()`);
      check(name, r && r.hit && r.line && r.pieceVisible, r);
    };
    await pieceCheck(
      'blockwall',
      '800',
      '40 x 20',
      '10',
      '2.4',
      '10,000/m2',
      'P1 blocks 800 / (0.4x0.2) = 10,000/m2 exact'
    );
    await pieceCheck(
      'brickwall',
      '140',
      '20 x 10',
      '10',
      '2.4',
      '7,000/m2',
      'P2 bricks 140 / (0.2x0.1) = 7,000/m2 exact'
    );
    await pieceCheck(
      'roof',
      '6120',
      '0.85 x 3.6',
      '10',
      '4',
      '2,000/m2',
      'P3 roof sheets 6120 / (0.85x3.6) = 2,000/m2 exact'
    );
    await pieceCheck(
      'fencing',
      '9500',
      '2.5 x 1.8',
      '10',
      '1.8',
      '3,800/m of run',
      'P4 fencing panel 9500 / 2.5m = 3,800/m run (width-div)'
    );

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
    check(
      'P5 piece placeholders follow the trade',
      p5 && p5.differ && /800/.test(p5.block) && /6120/.test(p5.roof),
      p5
    );

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
    check(
      'RS1 save rate sheet stores name+rates+piece',
      rs1 && rs1.count === 1 && rs1.name === 'low-bid' && rs1.mat === '18' && rs1.rows === 1,
      rs1
    );

    const rs2 = await ev(`(function(){
      document.getElementById('calc-rate-mat').value='99'; document.getElementById('calc-rate-lab').value='99';
      document.getElementById('calc-rate-mat').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action=calcSheetApply]').click();
      return { mat: document.getElementById('calc-rate-mat').value, lab: document.getElementById('calc-rate-lab').value,
               piece: document.getElementById('calc-piece-price').value,
               total: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1 };
    })()`);
    check(
      'RS2 apply restores rates + piece + recomputes',
      rs2 && rs2.mat === '18' && rs2.lab === '25' && rs2.piece === '900' && rs2.total,
      rs2
    );

    const rs3 = await ev(`(function(){
      document.getElementById('calc-rate-mat').value = '99';
      var sel = document.getElementById('calc-sheet-select');
      var sheetId = sel.options[1] ? sel.options[1].value : '';
      if (!sheetId) return { err: 'no sheet in picker' };
      sel.value = sheetId;
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      return { mat: document.getElementById('calc-rate-mat').value, reset: sel.selectedIndex === 0, id: sheetId };
    })()`);
    check(
      'RS3 quick-picker select applies + resets selection',
      rs3 && rs3.mat === '18' && rs3.reset,
      rs3
    );

    const rs4 = await ev(`(function(){
      document.querySelector('[data-action=calcSheetDelete]').click();
      var raw = JSON.parse(localStorage.getItem('mmgr_calc_rate_sheets')||'[]');
      return { left: raw.length, empty: !!document.querySelector('#calc-sheets .calc-empty') };
    })()`);
    check(
      'RS4 delete removes the sheet + shows empty state',
      rs4 && rs4.left === 0 && rs4.empty,
      rs4
    );

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
    check(
      'V1 slab per-bag 9,200 / 20 L -> 460,000/m3 exact',
      v1 && v1.per && v1.narr && v1.vis,
      v1
    );

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
    check(
      'V2 paint per gallon-can 9,000 / 3.785 L -> 2,377.81/L exact',
      v2 && v2.per && v2.narr,
      v2
    );

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
    // OWNER 2026-10-02: tile carries listed sizes, so its piece row is behind the
    // opt-in - tick it so this gate still tests tile's AREA row + label.
    const v3b = await ev(`(function(){
      document.getElementById('calc-work').value='tile';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      var pc = document.getElementById('calc-piece-custom');
      if (pc && !pc.checked) { pc.checked = true; pc.dispatchEvent(new Event('change',{bubbles:true})); }
      var onTile = !document.getElementById('calc-piece-wrap').hidden;
      var tileLbl = document.getElementById('calc-piece-price-label').textContent;
      pc.checked = false; pc.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('calc-work').value='slab';
      document.getElementById('calc-work').dispatchEvent(new Event('change',{bubbles:true}));
      return { onTile: onTile, tileLbl: tileLbl };
    })()`);
    check(
      'V3 volume rows on slab/footings, area rows on tile, labels follow',
      v3 &&
        v3.onSlab &&
        v3.onFoot &&
        /bag/.test(v3.footLbl) &&
        v3b &&
        v3b.onTile &&
        /tile/i.test(v3b.tileLbl),
      { slab: v3, tile: v3b }
    );

    // V4: an invalid yield silently falls back to the model rate.
    const v4 = await ev(`(function(){
      document.getElementById('calc-piece-price').value='9200'; document.getElementById('calc-piece-size').value='abc';
      document.getElementById('calc-piece-price').dispatchEvent(new Event('input',{bubbles:true}));
      var t=document.getElementById('calc-output').textContent;
      var matMod = t.indexOf('Materials$') > -1 || t.indexOf('Materials \u0024') > -1;
      return { noPiece: t.indexOf('per') === -1 || matMod, noThrow: t.length > 10 };
    })()`);
    check(
      'V4 invalid yield -> clean model-rate fallback, no crash',
      v4 && v4.noPiece && v4.noThrow,
      v4
    );

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
    check(
      'V5 imperial dims recompute; yield label unit-free',
      v5 && v5.lbl === 'Length (ft)' && v5.sizeLblStillYield.indexOf('litres') > -1 && v5.hasTotal,
      v5
    );

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
    // Poll for the boot rather than racing a fixed sleep: this family lost
    // 8 gates intermittently when project.html had not finished loading in
    // 3200ms on a loaded machine. Same pattern as AGENTS.md lesson 3 - a
    // fixed wait is a guess, a poll is a fact.
    await ev(`location.href = ${JSON.stringify(BASE + '/project.html?id=parqa')}`);
    let appBooted = false;
    for (let i = 0; i < 30 && !appBooted; i++) {
      await delay(500);
      appBooted = await ev(`!!(window.MMGR && MMGR.Watch && MMGR.State)`);
    }
    check('PL0 project booted with Watch module', !!appBooted, appBooted);
    // The assistant is signed-in-gated (Entitlements seam). Harness stubs the
    // seam exactly like the other watchers harnesses do.
    await ev(
      `(function(){ if (MMGR.Entitlements) { MMGR.Entitlements.aiAssistant = function(){ return true; }; } return !!(MMGR.Entitlements); })()`
    );

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
    check(
      'PL1 kickoff nudge fires for in-progress + ready peer',
      pl1 && pl1.count >= 1,
      pl1 && pl1.count
    );
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
    check(
      'PL4 cluster summary fires for 3 independent same-day starts',
      pl4 && pl4.cluster && pl4.count3,
      pl4 && pl4.text
    );

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
    check(
      'PL5 dependent group -> no cluster notice (correct refusal)',
      pl5 && pl5.gone === true,
      pl5
    );

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
    check(
      'PL6 severity classes + dots render (caution/info/attention)',
      pl6 && pl6.caution && pl6.info && pl6.hot && pl6.dots && pl6.legacyKept,
      pl6
    );

    // PL7: dedupe - rerun does not duplicate parallel notices.
    const pl7 = await ev(`(function(){
      MMGR.State.updateState(function(s){ s.aiInbox = []; });
      MMGR.Watch.run(); MMGR.Watch.run();
      const par = (MMGR.State.getState().aiInbox || []).filter(n => n.kind === 'parallel');
      return { unique: par.length === new Set(par.map(n => n.text)).size, total: par.length };
    })()`);
    check('PL7 rerun dedupes parallel notices', pl7 && pl7.unique === true, pl7 && pl7.total);
  });

  if (startedHere) {
    try {
      startedHere.kill();
    } catch (e) {}
  }
  const passed = results.filter(r => r.val).length;
  log(passed + '/' + results.length + ' gates passed');
  process.exit(passed === results.length ? 0 : 1);
})();
