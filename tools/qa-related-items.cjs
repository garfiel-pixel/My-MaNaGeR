/* ============================================================
   qa-related-items.cjs - MAT-2 related items (chips + linter)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, MAT-2: "Related items the user
   would otherwise forget." The companion chips used to offer only
   WORK add-ons (line out, cart away, debrush). MAT-2 offers the
   RELATED TRADES from the directive's table - paint the wall you
   lined, screed the floor you tiled, hang gutters on the roof you
   covered - plus one chip that reveals the material lines the rate
   hides (MAT-1). Nothing is ever priced silently.

   This gate proves:
     (1) every chip points at a trade that EXISTS, and derives a
         quantity in that trade's own unit or is WITHHELD (null);
     (2) the directives's five pairs exist on BOTH sides - the chip
         and the forgotten-work linter - and every linter fix that
         names a companion (`cp`) resolves to that same companion, so
         the chip and the flag can never disagree about the quantity;
     (3) the linter's own fix button adds the line through the
         companion derivation, priced, from the flagged bill line;
     (4) the material chip opens the MAT-1 split and adds NO line;
     (5) withheld means withheld: without the dims a pair says
         nothing and no money moves.

   Usage:  node tools/qa-related-items.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (T4 browser battery).
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[related-items] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0,
  failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    log('PASS  ' + name);
  } else {
    failed++;
    log(
      'FAIL  ' +
        name +
        '  <-- ' +
        JSON.stringify(detail === undefined ? null : detail).slice(0, 600)
    );
  }
};
const near = (a, b, tol) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;

// The directive's table, as a contract both sides have to honour:
// { id, srcs = the trades the chip appears on, target = the trade it adds,
//   lint = the sources where the forgotten-work linter flags the same pair }.
const PAIRS = [
  {
    id: 'wallpaint',
    srcs: ['drywall', 'ceiling', 'render'],
    target: 'paint',
    lint: ['drywall', 'ceiling', 'render']
  },
  { id: 'skirt', srcs: ['drywall', 'tile'], target: 'skirt', lint: ['drywall', 'tile'] },
  { id: 'ceilgrid', srcs: ['drywall', 'framing'], target: 'ceiling', lint: [] },
  { id: 'screed', srcs: ['tile', 'slab'], target: 'floor-screed', lint: ['tile'] },
  { id: 'tile', srcs: ['floor-screed'], target: 'tile', lint: ['floor-screed'] },
  {
    id: 'renderwalls',
    srcs: ['blockwall', 'brickwall'],
    target: 'render',
    lint: ['blockwall', 'brickwall']
  },
  {
    id: 'gutterrun',
    srcs: ['roof', 'shingle-roof'],
    target: 'gutter',
    lint: ['roof', 'shingle-roof']
  },
  {
    id: 'fascia',
    srcs: ['roof', 'shingle-roof'],
    target: 'soffit-fascia',
    lint: ['roof', 'shingle-roof']
  }
];
// A chip may offer work the linter must NOT call forgotten - a wall is not a
// ceiling, and a bare slab may be a driveway. Every such case carries a WRITTEN
// reason, because the alternative (a rule that fires on every bill) is the
// noise the linter exists to avoid. Keyed '<id>@<source trade>'.
const LINT_SILENT = {
  'ceilgrid@drywall':
    'lined walls are not a ceiling: the linter cannot know a ceiling grid is in scope, so it stays quiet',
  'ceilgrid@framing':
    'a wall frame is not a ceiling frame: the linter cannot know a ceiling grid is in scope, so it stays quiet',
  'screed@slab':
    'a bare slab may be a driveway or a base with no floor finish - a screed is an offer, never forgotten work'
};
// The W2 companions that predate MAT-2 (line out, clear, cart away, debrush,
// post holes). They are not part of the directive's related-trade table and are
// covered by the CP family in qa-calculator-page.cjs; the reverse-drift check
// below only demands that every OTHER companion id is a pair this table knows.
const W2_COMPANIONS = ['lineout', 'brush', 'cart', 'cart3', 'debrush', 'holes'];

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {}
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) {
        return require(p);
      }
    }
  }
  throw new Error('playwright not found - npm i -D playwright');
}
function absolutizeChrome(p) {
  if (!p) {
    return undefined;
  }
  if (path.isAbsolute(p)) {
    return fs.existsSync(p) ? p : undefined;
  }
  const finder = os.platform() === 'win32' ? 'where' : 'command -v';
  try {
    const out = require('child_process')
      .execSync(finder + ' ' + JSON.stringify(p), { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) {
      return out;
    }
  } catch (e) {
    /* fall back */
  }
  return undefined;
}

(async () => {
  if (!process.env.BASE) {
    let up = false;
    try {
      up = (await fetch(BASE + '/calculator.html')).ok;
    } catch (e) {}
    if (!up) {
      log('starting serve.cjs for this run');
      global.__srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          if ((await fetch(BASE + '/calculator.html')).ok) {
            break;
          }
        } catch (e) {}
      }
    }
  }
  const pw = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {}
  executablePath = absolutizeChrome(executablePath);
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath,
    args: ['--disk-cache-size=0']
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  let pageErrors = 0;
  page.on('pageerror', e => {
    pageErrors++;
    log('page error: ' + String((e && e.message) || e).slice(0, 200));
  });
  await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    function () {
      return !!document.getElementById('calc-work') && !!window.__calcEngine;
    },
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(700);
  check('calculator page boots with the engine live', pageErrors === 0, pageErrors);

  // ---- (1) every pair: exists, derives, or is withheld ----------------------
  const pairs = await page.evaluate(list => {
    const WORK = window.__calcEngine.work();
    const out = { missingTrade: [], rows: [], withheld: [] };
    list.forEach(pair => {
      const id = pair.id,
        sources = pair.srcs,
        target = pair.target;
      if (!WORK[target]) {
        out.missingTrade.push(target);
      }
      sources.forEach(src => {
        const full = window.__calcEngine.companionsFor({
          work: src,
          units: 'metric',
          d1: '10',
          d2: '4',
          d3: '150'
        });
        const hit = full.filter(c => c.id === id)[0];
        // No dims at all: the pair must say nothing (never guessed).
        const bare = window.__calcEngine.companionsFor({ work: src, units: 'metric' });
        const bareHit = bare.filter(c => c.id === id)[0];
        out.rows.push({
          id: id,
          src: src,
          target: target,
          work: hit ? hit.work : null,
          qty: hit ? hit.qty : null,
          unit: hit ? WORK[hit.work].q(1).unit : null,
          bareOffered: !!bareHit
        });
        if (!hit) {
          out.withheld.push(src + ' -> ' + id);
        }
        if (bareHit) {
          out.withheld.push(src + ' -> ' + id + ' offered with NO dims');
        }
      });
    });
    return out;
  }, PAIRS);
  check(
    'every related item names a trade that exists in WORK',
    pairs.missingTrade.length === 0,
    pairs.missingTrade
  );
  check(
    'every related pair derives a quantity in the TARGET trade’s own unit',
    pairs.rows.length > 0 &&
      pairs.rows.every(r => r.work === r.target && r.qty > 0 && r.unit) &&
      pairs.withheld.length === 0,
    { rows: pairs.rows.slice(0, 8), withheld: pairs.withheld }
  );
  // Spot-check the arithmetic of three derivations against the typed dims. 10 x
  // 4 m is 40 m2 of wall (not 80) and 28 m of run around the space, and the
  // paint trade asks for litres at two coats over 10 m2 per litre.
  const calcs = await page.evaluate(() => {
    const paint = window.__calcEngine
      .companionsFor({ work: 'drywall', units: 'metric', d1: '10', d2: '4' })
      .filter(c => c.id === 'wallpaint')[0];
    const skirt = window.__calcEngine
      .companionsFor({ work: 'tile', units: 'metric', d1: '10', d2: '4' })
      .filter(c => c.id === 'skirt')[0];
    const roof = window.__calcEngine
      .companionsFor({ work: 'shingle-roof', units: 'metric', d1: '12', d2: '6' })
      .filter(c => c.id === 'gutterrun')[0];
    return { paint: paint && paint.qty, skirt: skirt && skirt.qty, gutter: roof && roof.qty };
  });
  check(
    'derivations are the typed dims: 10x4 wall = 40 m2 -> 8 L of paint (2 coats at 10 m2/L); 28 m of skirting; 12 m of gutter',
    near(calcs.paint, 8, 0.01) && near(calcs.skirt, 28, 0.01) && near(calcs.gutter, 12, 0.01),
    calcs
  );

  // ---- (2) the linter lists the same pairs ---------------------------------
  // Every (pair, source) the linter claims must fire AND must resolve to the
  // chip's own derivation for that source, so a flag and a chip can never
  // disagree about the quantity. The reverse direction (below) refuses a new
  // chip or a new lint fix that the other side does not know about.
  const lint = await page.evaluate(list => {
    const out = { pairs: [], noFix: [], wrongWork: [] };
    list.forEach(pair => {
      (pair.lint || []).forEach(src => {
        const rule = window.__calcEngine
          .billLint([{ st: { work: src } }])
          .filter(f => f.fix && f.fix.cp === pair.id)[0];
        const chip = window.__calcEngine
          .companionsFor({ work: src, units: 'metric', d1: '10', d2: '4' })
          .filter(c => c.id === pair.id)[0];
        const rec = {
          id: pair.id,
          src: src,
          target: pair.target,
          fired: !!rule,
          fixWork: rule && rule.fix ? rule.fix.work : null,
          chipWork: chip ? chip.work : null,
          chipQty: chip ? chip.qty : null
        };
        out.pairs.push(rec);
        if (!rule) {
          out.noFix.push(src + ' -> ' + pair.id);
        }
        if (!chip || chip.work !== pair.target || !(chip.qty > 0)) {
          out.wrongWork.push(rec);
        }
      });
    });
    return out;
  }, PAIRS);
  check(
    'X1 linter lists the same pairs the chips offer, on the same sources, with the same target work',
    lint.pairs.length > 0 &&
      lint.noFix.length === 0 &&
      lint.wrongWork.length === 0 &&
      lint.pairs.every(p => p.fixWork === p.target),
    { noFix: lint.noFix, wrongWork: lint.wrongWork, pairs: lint.pairs.slice(0, 4) }
  );
  // Every source the linter stays silent on carries a written reason, and no
  // excuse is stale (an exemption for a pair that does not exist, or for a
  // source the linter DOES flag, fails).
  const silent = [];
  PAIRS.forEach(p =>
    p.srcs.forEach(src => {
      if ((p.lint || []).indexOf(src) < 0) {
        silent.push(p.id + '@' + src);
      }
    })
  );
  const badExcuse = silent.filter(k => !(LINT_SILENT[k] && LINT_SILENT[k].length >= 20));
  const staleExcuse = Object.keys(LINT_SILENT).filter(k => silent.indexOf(k) < 0);
  check(
    'the pairs the linter deliberately does NOT flag each carry a written reason, and no reason is stale',
    silent.length === 3 && badExcuse.length === 0 && staleExcuse.length === 0,
    { silent: silent, badExcuse: badExcuse, staleExcuse: staleExcuse }
  );
  // The reverse drift gate: read the SHIPPED COMPANIONS / LINT_RULES tables and
  // refuse any pair either side added that this contract does not carry.
  await page.evaluate(legacy => {
    window.__QA_W2 = legacy;
  }, W2_COMPANIONS);
  const drift = await page.evaluate(list => {
    const bad = [];
    const pairIds = list.map(p => p.id);
    const legacy = window.__QA_W2 || [];
    const defs = window.__calcEngine.companionDefs();
    Object.keys(defs).forEach(id => {
      if (pairIds.indexOf(id) < 0 && legacy.indexOf(id) < 0) {
        bad.push('companion ' + id + ' exists in the page and in no pair row');
      }
    });
    window.__calcEngine.lintRules().forEach(r => {
      if (!r.fix || !r.fix.cp) {
        return;
      }
      const pair = list.filter(p => p.id === r.fix.cp)[0];
      if (!pair) {
        bad.push('rule ' + r.id + ' fixes with companion ' + r.fix.cp + ' that no chip offers');
        return;
      }
      if (pair.target !== r.fix.work) {
        bad.push('rule ' + r.id + ': fix work ' + r.fix.work + ' != chip target ' + pair.target);
      }
      if (pair.lint.length === 0) {
        bad.push(
          'rule ' + r.id + ' names ' + r.fix.cp + ' but the harness calls that pair lint-silent'
        );
      }
    });
    return bad;
  }, PAIRS);
  check(
    'no chip and no linter fix exists that the pair contract does not carry (reverse drift)',
    drift.length === 0,
    drift
  );
  // A fix that names a companion must resolve to a real companion whose target
  // work is the one the fix claims.
  const fixOk = await page.evaluate(() => {
    const bad = [];
    const ids = [
      'steel-no-concrete',
      'pour-no-formwork',
      'wall-no-footing',
      'excav-no-cart',
      'roof-no-gutter',
      'roof-no-fascia',
      'linings-no-paint',
      'wall-no-render',
      'tile-no-screed',
      'floor-no-skirting'
    ];
    const sample = [
      [{ st: { work: 'rebar' } }, 'steel-no-concrete'],
      [{ st: { work: 'slab' } }, 'pour-no-formwork'],
      [{ st: { work: 'blockwall' } }, 'wall-no-footing'],
      [{ st: { work: 'excav' } }, 'excav-no-cart'],
      [{ st: { work: 'roof' } }, 'roof-no-gutter'],
      [{ st: { work: 'roof' } }, 'roof-no-fascia'],
      [{ st: { work: 'drywall' } }, 'linings-no-paint'],
      [{ st: { work: 'brickwall' } }, 'wall-no-render'],
      [{ st: { work: 'tile' } }, 'tile-no-screed'],
      [{ st: { work: 'tile' } }, 'floor-no-skirting']
    ];
    sample.forEach(row => {
      const f = window.__calcEngine.billLint([row[0]]).filter(x => x.id === row[1])[0];
      if (!f) {
        bad.push(row[1] + ' did not fire');
        return;
      }
      if (f.fix && f.fix.cp) {
        const c = window.__calcEngine
          .companionsFor({ work: row[0].st.work, units: 'metric', d1: '10', d2: '4' })
          .filter(x => x.id === f.fix.cp)[0];
        if (!c || c.work !== f.fix.work) {
          bad.push(row[1] + ' fix ' + f.fix.cp + ' -> ' + (c && c.work));
        }
      }
    });
    return { bad: bad, ids: ids };
  });
  check(
    'a linter fix that names a companion resolves to that companion and its trade',
    fixOk.bad.length === 0,
    fixOk.bad
  );

  // ---- (3) the linter's fix button adds the line, priced -------------------
  // The fixture prices in US dollars on purpose: the model rates are planning
  // US-dollar figures, and a JMD line with no exchange rate is REFUSED by the
  // engine (rule N3), which would leave the bill empty and the linter box
  // hidden - that path is covered by verify-currency.cjs, not here.
  const fixPath = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      localStorage.removeItem('mmgr_calc_boq');
    } catch (e) {}
    $('calc-currency').value = 'USD';
    $('calc-currency').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-country').value = 'US';
    $('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-work').value = 'shingle-roof';
    $('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-d1').value = '12';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '6';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    document.querySelector('[data-action="calcBoqAdd"]').click();
    await flush();
    if (window.__calcFlushHeavy) {
      window.__calcFlushHeavy();
    }
    await flush();
    const box = $('calc-lint');
    const btn = box ? box.querySelector('[data-action="calcCompAdd"][data-cp="gutterrun"]') : null;
    const before = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]').length;
    const src = btn ? btn.getAttribute('data-cp-src') : null;
    if (btn) {
      btn.click();
    }
    await flush();
    const lines = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    const gutter = lines.filter(l => l.st && l.st.work === 'gutter')[0];
    const r = gutter ? window.__calcEngine.computeFor(gutter.st) : null;
    return {
      lintShown: !!box && !box.hidden,
      fixedButton: !!btn,
      src: src,
      before: before,
      after: lines.length,
      qty: gutter && gutter.st ? parseFloat(gutter.st.measuredQty) : null,
      priced: !!(r && !r.error && r.qty > 0),
      tag: gutter && gutter.st ? gutter.st.derivedFrom : null
    };
  });
  check(
    'the linter fix adds the missing eaves line through the companion derivation, priced',
    fixPath.lintShown &&
      fixPath.fixedButton &&
      fixPath.src === 'shingle-roof' &&
      fixPath.after === fixPath.before + 1 &&
      near(fixPath.qty, 12, 0.01) &&
      fixPath.priced &&
      fixPath.tag === 'shingle-roof:gutterrun',
    fixPath
  );

  // ---- (4) the material chip opens the split, adds nothing -----------------
  const materialChip = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      localStorage.removeItem('mmgr_calc_boq');
    } catch (e) {}
    $('calc-currency').value = 'USD';
    $('calc-currency').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-country').value = 'US';
    $('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-itemise').checked = false;
    $('calc-itemise').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-work').value = 'drywall';
    $('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-d1').value = '10';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '4';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    if (window.__calcFlushHeavy) {
      window.__calcFlushHeavy();
    }
    await flush();
    const wrap = $('calc-companions');
    const chip = wrap.querySelector('.bcp-cp-materials');
    const text = chip ? chip.textContent : '';
    const linesBefore = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]').length;
    if (chip) {
      chip.click();
    }
    await flush();
    return {
      chip: !!chip,
      text: text,
      split: $('calc-itemise').checked,
      linesBefore: linesBefore,
      linesAfter: JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]').length,
      drawerRows: document.querySelectorAll('#calc-acc-list .acc-row').length,
      chips: wrap.hidden ? 0 : wrap.querySelectorAll('.bcp-cp-chip').length
    };
  });
  check(
    'the material chip names the hidden lines and opens the split without adding money',
    materialChip.chip &&
      /5 material lines inside this rate/.test(materialChip.text) &&
      materialChip.split === true &&
      materialChip.linesAfter === materialChip.linesBefore &&
      materialChip.drawerRows === 5,
    materialChip
  );

  // ---- (5) one-tap related trade, and withheld without dims ----------------
  const chipPath = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      localStorage.removeItem('mmgr_calc_boq');
    } catch (e) {}
    $('calc-currency').value = 'USD';
    $('calc-currency').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-country').value = 'US';
    $('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-work').value = 'drywall';
    $('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-d1').value = '10';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '4';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    if (window.__calcFlushHeavy) {
      window.__calcFlushHeavy();
    }
    await flush();
    const chip = document.querySelector('#calc-companions [data-cp="wallpaint"]');
    if (chip) {
      chip.click();
    }
    await flush();
    const lines = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    const paint = lines.filter(l => l.st && l.st.work === 'paint')[0];
    const r = paint ? window.__calcEngine.computeFor(paint.st) : null;
    // Now take the dims away: the same pairs must offer nothing.
    $('calc-d1').value = '';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    if (window.__calcFlushHeavy) {
      window.__calcFlushHeavy();
    }
    await flush();
    const wrap = $('calc-companions');
    return {
      chipWork: paint && paint.st ? paint.st.work : null,
      qty: paint && paint.st ? parseFloat(paint.st.measuredQty) : null,
      unit: paint && paint.st ? paint.st.measuredUnit : null,
      priced: !!(r && !r.error && r.qty > 0),
      hiddenWithoutDims: wrap.hidden
    };
  });
  check(
    'one tap adds the related trade as a priced bill line in its own unit',
    chipPath.chipWork === 'paint' &&
      near(chipPath.qty, 8, 0.01) &&
      chipPath.unit === 'L' &&
      chipPath.priced,
    chipPath
  );
  check(
    'without the dims the set says nothing rather than guessing',
    chipPath.hiddenWithoutDims === true,
    chipPath
  );
  check('no uncaught page error during the wave', pageErrors === 0, pageErrors);

  await browser.close();
  if (global.__srv) {
    try {
      global.__srv.kill();
    } catch (e) {}
  }
  log('');
  log('RESULT  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  log('HARNESS ERROR ' + String((e && e.stack) || e).slice(0, 800));
  process.exit(1);
});
