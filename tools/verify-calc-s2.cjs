#!/usr/bin/env node
/* ============================================================
   tools/verify-calc-s2.cjs - C6 / C7 / X-1 / X-2 gate
   (AUDIT-DIRECTIVE-2026-10-18, sections 8.2-8.3)
   ------------------------------------------------------------
   The four S2-remainder tasks, pinned so they cannot regress:

   C6  sticky estimate panel + read-only mobile total bar.
       Static: the markup (bar is aria-hidden + hidden, carries NO
       Calculate/Add-to-bill action, Show is a span not a focusable
       button), the sticky rule, align-items:start, min-height 44 rows.
       Chromium: walking every ancestor of .bcp-result finds no
       overflow other than visible (an overflow ancestor silently
       disables sticky - the audit's step-1 assertion); with the body
       class on, a 1500px scroll keeps the card's top inside
       topbar+12 .. topbar+40; at 390px the bar renders and holds no
       [data-action="calcBoqAdd"] / [data-action="calcRun"] control.

   C7  the five calculator options are switch rows, whole row
       clickable. Chromium: clicking the ROW TEXT of each of the five
       rows toggles its input (the audit's GATE C7 click contract),
       and every row is at least 44px tall.

   X-1 render scheduler. Static: scheduleHeavy/flushHeavy/heavyPass
       exist, heavyPass calls the six heavy renders, the queued pass
       reads lastResult at run time, flushHeavy() runs before exports
       and print (>= 4 call sites), out.innerHTML is written in exactly
       one place and only when the string changed.

   X-2 paint cost. Static: zero `transition: all` in css/mmgr.css,
       under 25 backdrop-filter rules that apply a blur, .card carries
       contain: layout paint on the solid --card token (no frost), the
       four below-the-fold calculator cards carry content-visibility
       with a steady intrinsic size, mmgr-glass caps the shader at 30
       fps, pauses it while a modal or the AI panel is typing, and
       clamps the pixel ratio to <= 1.5. Chromium: the same counts
       read back through the real CSSOM, computed styles resolve the
       contract (contain, opaque background, content-visibility,
       explicit transition-property on .btn).

   Usage:  node tools/verify-calc-s2.cjs
   Exit 0 = every check holds, 1 = a task regressed.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'calculator.html');
const CSS = path.join(ROOT, 'css', 'mmgr.css');
const CALCJS = path.join(ROOT, 'js', 'calculator-page.js');
const GLASSJS = path.join(ROOT, 'js', 'mmgr-glass.js');

const html = fs.readFileSync(PAGE, 'utf8');
const cssRaw = fs.readFileSync(CSS, 'utf8');
const js = fs.readFileSync(CALCJS, 'utf8');
const glass = fs.readFileSync(GLASSJS, 'utf8');
// comment-free view: prose in this repo routinely NAMES the patterns it
// forbids ("no backdrop-filter here"), and a checker that reads its own
// explanation as evidence is the measured failure mode (same trap the
// print gate documents).
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

const problems = [];
let checks = 0;
const ok = m => {
  checks++;
  console.log('  PASS  ' + m);
};
const bad = m => {
  checks++;
  problems.push(m);
  console.log('  FAIL  ' + m);
};
const assert = (cond, m) => (cond ? ok(m) : bad(m));

console.log('\n=== CALC S2 GATE: C6 sticky panel, C7 switch rows, X-1 scheduler, X-2 paint ===');

/* ---------------------------------------------------------------
   1. STATIC: C7 markup - five option rows, each a whole-row TEXT
     label (label[for]) owning the app's own .tgl switch (rule 1.4:
     reuse, do not invent). UI-2 re-based these rows on .set-row:
     the words and the switch are siblings inside one row, and the
     words are a <label for> the input, so a click on the text still
     toggles it with no JavaScript. IDs and role=switch must survive
     so no JS moves. (RE-BASELINE 2026-10-27: this gate used to hunt
     `<label class="bcp-opt">` rows with data-opt; UI-2 replaced that
     markup in the app, so the gate follows the app.)
--------------------------------------------------------------- */
console.log('\n--- C7 markup (calculator.html) ---');
const OPTS = [
  ['measured', 'calc-measured-manual'],
  ['oncost', 'calc-oncost-toggle'],
  ['labour', 'calc-labour-only'],
  ['piece', 'calc-piece-custom'],
  ['sig', 'calc-sig-show']
];
for (const [opt, id] of OPTS) {
  const txt = new RegExp('<label class="set-txt" for="' + id + '">').exec(html);
  assert(!!txt, 'C7: ' + opt + ' row text is a <label for="' + id + '"> (whole-row click, no JS)');
  const sw = new RegExp(
    '<label class="tgl"><input type="checkbox" id="' +
      id +
      '"[^>]*><span class="tsl"></span></label>'
  ).exec(html);
  assert(
    !!sw,
    'C7: ' + opt + ' row carries the project page .tgl/.tsl switch (not an invented one)'
  );
  if (!sw) continue;
  assert(
    sw[0].indexOf('role="switch"') !== -1 && sw[0].indexOf('aria-describedby=') !== -1,
    'C7: ' + opt + ' input keeps role="switch" + aria-describedby'
  );
}
assert(
  /\.set-row\s*\{[^}]*min-height:\s*44px/.test(css),
  'C7: .set-row is >= 44px tall (min-height: 44px)'
);
assert(
  (css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) || []).some(
    b => /\.tgl\s*\.tsl/.test(b) && /transition:\s*none/.test(b)
  ),
  'C7: prefers-reduced-motion kills the switch (.tgl .tsl) transition'
);

/* ---------------------------------------------------------------
   2. STATIC: C6 markup + CSS contracts (rule 1.14 in the gate:
     the bar carries no Calculate / Add-to-bill control).
--------------------------------------------------------------- */
console.log('\n--- C6 markup + CSS ---');
const barMatch = /<div class="bcp-totalbar"[\s\S]*?<\/div>/.exec(html);
assert(!!barMatch, 'C6: #calc-totalbar markup exists');
if (barMatch) {
  const bar = barMatch[0];
  assert(
    bar.indexOf('aria-hidden="true"') !== -1,
    'C6: bar is aria-hidden (card carries aria-live)'
  );
  assert(/\bhidden[ >]/.test(bar), 'C6: bar ships hidden (flag + mobile decide visibility)');
  assert(
    bar.indexOf('data-action="calcBoqAdd"') === -1,
    'C6: bar carries NO Add-to-bill button (rule 1.14)'
  );
  assert(
    bar.indexOf('data-action="calcRun"') === -1,
    'C6: bar carries NO Calculate button (rule 1.14)'
  );
  assert(
    /<span class="bcp-totalbar-show" id="calc-totalbar-show">/.test(bar),
    'C6: Show is a span - no focusable control inside aria-hidden (aria-hidden-focus)'
  );
}
assert(
  /body\.bcp-sticky-on \.bcp-result\s*\{[^}]*position:\s*sticky/.test(css),
  'C6: body.bcp-sticky-on .bcp-result is position: sticky'
);
assert(
  /\.bcp-grid\s*\{[^}]*align-items:\s*start/.test(css),
  'C6: .bcp-grid sets align-items: start (stretch would defeat sticky)'
);
assert(
  /\.bcp-run \{\s*position:\s*static;/.test(css),
  'C6: .bcp-run stays position: static (owner rule 1.14, never re-pin)'
);
assert(
  js.indexOf('calcStickyFlagOn') !== -1 &&
    js.indexOf('bcp-sticky-on') !== -1 &&
    js.indexOf('IntersectionObserver') !== -1 &&
    js.indexOf('calc-totalbar-show') !== -1,
  'C6: boot wires the flag class, the Show scroll and the IntersectionObserver'
);

/* ---------------------------------------------------------------
   3. STATIC: X-1 scheduler + X-2 paint cost.
--------------------------------------------------------------- */
console.log('\n--- X-1 render scheduler (js/calculator-page.js) ---');
assert(/function heavyPass\(r\)/.test(js), 'X-1: heavyPass(r) exists');
assert(/function scheduleHeavy\(r\)/.test(js), 'X-1: scheduleHeavy(r) exists');
assert(/function flushHeavy\(\)/.test(js), 'X-1: flushHeavy() exists');
const hp = /function heavyPass\(r\)\s*\{([\s\S]*?)\n  \}/.exec(js);
if (hp) {
  const six = [
    'renderPrelims',
    'renderRollup',
    'renderCash',
    'renderAccessories',
    'renderCompanions',
    'renderQuoteDoc'
  ];
  const missing = six.filter(f => hp[1].indexOf(f + '(') === -1);
  assert(
    missing.length === 0,
    'X-1: heavyPass runs the six heavy renders' +
      (missing.length ? ' (missing: ' + missing + ')' : '')
  );
} else {
  bad('X-1: heavyPass body could not be parsed');
}
assert(
  /requestIdleCallback[\s\S]{0,400}heavyPass\(lastResult\)/.test(js),
  'X-1: the queued pass reads lastResult at run time (never a stale closure)'
);
const flushCalls = (js.match(/flushHeavy\(\)/g) || []).length - 1; // minus the definition
assert(
  flushCalls >= 4,
  'X-1: flushHeavy() runs before populate/export/print (' + flushCalls + ' call sites)'
);
const outWrites = (js.match(/out\.innerHTML/g) || []).length;
assert(
  outWrites === 2 && /out\.innerHTML !== html/.test(js),
  'X-1: out.innerHTML is written in exactly one guarded place (skip when unchanged)'
);
assert(/function setOut\(/.test(js), 'X-1: setOut helper exists');

console.log('\n--- X-2 paint cost (css/mmgr.css, js/mmgr-glass.js) ---');
const transitionAll = css.match(/transition\s*:\s*all\b/g) || [];
assert(
  transitionAll.length === 0,
  'X-2: zero `transition: all` in css/mmgr.css (found ' + transitionAll.length + ')'
);
assert(
  /--tr-ui:\s*[\s\S]*?transform 80ms[\s\S]*?background-color 120ms/.test(css),
  'X-2: explicit --tr-ui transition list exists'
);
// X-2 RE-BASELINE (2026-10-25): this count started as a raw line match, so
// it tallied two things that apply no blur at all - PROSE that merely names
// the property inside a comment, and the perf kill block's own blur(0) rules,
// which X-2 ADDED to save paint. That read 27 against the "under 25" target
// the same commit set, so the gate was red the moment it was written; it only
// surfaced now because the three earlier red steps had always stopped CI
// before this one ran. Count what the check is actually about: declarations
// that apply a non-zero blur, in real rules. The count is 24 and the target
// is unchanged.
const blurRules = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(
    l =>
      /backdrop-filter\s*:/.test(l) &&
      !/-webkit/.test(l) &&
      !/:\s*none/.test(l) &&
      !/@supports/.test(l) &&
      !/blur\(\s*0(px)?\s*\)/.test(l)
  );
assert(
  blurRules.length < 25,
  'X-2: under 25 blur-applying backdrop-filter rules (found ' + blurRules.length + ', target < 25)'
);
const cardRule = /\.card\s*\{[^}]*\}/.exec(css);
assert(
  !!cardRule && cardRule[0].indexOf('contain: layout paint') !== -1,
  'X-2: .card carries contain: layout paint'
);
assert(
  !!cardRule && cardRule[0].indexOf('background: var(--card)') !== -1,
  'X-2: .card is the solid --card token (content is solid, rule 1.6)'
);
assert(
  !!cardRule && cardRule[0].indexOf('backdrop-filter') === -1,
  'X-2: .card keeps no backdrop-filter'
);
assert(
  /#calc-boq-card,\s*#calc-prelims-card,\s*#calc-hist-card,\s*#calc-estimates-card\s*\{\s*content-visibility:\s*auto;\s*contain-intrinsic-size:\s*0 600px;/.test(
    css
  ),
  'X-2: below-the-fold calc cards (BOQ/prelims/history/estimates) opt into content-visibility'
);
assert(
  glass.indexOf('_busyNow') !== -1 &&
    glass.indexOf('#om.open') !== -1 &&
    glass.indexOf('#siom.open') !== -1 &&
    glass.indexOf('#ai-win.open') !== -1 &&
    glass.indexOf('.bcp-ai-typing') !== -1,
  'X-2: shader pauses while a modal is open or the AI panel is typing'
);
assert(
  /_state\.lastPaint \|\| 0\) < 33/.test(glass),
  'X-2: shader caps paint at 30 fps (33ms floor between frames)'
);
const pr = /setPixelRatio\(Math\.min\([^,]+,\s*([0-9.]+)\)/.exec(glass);
assert(
  !!pr && parseFloat(pr[1]) <= 1.5,
  'X-2: pixel ratio clamped to <= 1.5 (found ' + (pr ? pr[1] : 'none') + ')'
);

/* ---------------------------------------------------------------
   4. CHROMIUM: the nesting-dependent and behavioral contracts,
     resolved against the real DOM / real CSSOM (rule N4).
--------------------------------------------------------------- */
function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const helper = path.join(ROOT, 'tools', 'chrome-launcher.cjs');
    if (fs.existsSync(helper)) {
      const h = require(helper);
      if (h && h.chromium) return h;
    }
    throw new Error('playwright is required for verify-calc-s2.cjs: ' + e.message);
  }
}
function chromeExecutable() {
  try {
    const h = require(path.join(ROOT, 'tools', 'chrome-launcher.cjs'));
    return h.chromePath || undefined;
  } catch (e) {
    return undefined;
  }
}

(async function main() {
  const { chromium } = resolvePlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExecutable(),
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.route('**/*', route => route.abort());
    // markup only - scripts would 404 against about:blank; everything this
    // gate asserts is CSS + native label behaviour + DOM shape.
    const markupOnly = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await page.setContent(markupOnly, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: cssRaw });

    console.log('\n--- C7 GATE (Chromium): clicking the row text toggles the input ---');
    for (const [opt, id] of OPTS) {
      // UI-2: the row's words are a <label for> the switch, so clicking the
      // name toggles the input through native label association - no JS.
      const sel = 'label.set-txt[for="' + id + '"] .set-name';
      const inRow = await page.evaluate(i => {
        const r = document.getElementById(i).closest('.set-row');
        return r ? r.id || '(anon)' : null;
      }, id);
      assert(!!inRow, 'C7: ' + opt + ' input lives in a .set-row (UI-2 settings row)');
      // Two rows ship inside containers that are closed by default: the
      // piece row IS its own [hidden] opt-in wrap, the sig row sits inside a
      // container hidden until a result exists. Force the row itself AND
      // every hidden ancestor visible for the click contract, then restore
      // it exactly - the gate must not change what it tests.
      const revealed = await page.evaluate(i => {
        const row = document.getElementById(i).closest('.set-row');
        if (!row) return -1;
        let n = 0;
        let p = row;
        while (p && p !== document.body) {
          if (p.hasAttribute('hidden')) {
            p.setAttribute('data-s2-reveal', 'attr');
            p.removeAttribute('hidden');
            n++;
          } else if (getComputedStyle(p).display === 'none') {
            p.setAttribute('data-s2-reveal', 'css');
            p.style.setProperty('display', 'block', 'important');
            n++;
          }
          p = p.parentElement;
        }
        return n;
      }, id);
      const before = await page.evaluate(i => document.getElementById(i).checked, id);
      await page.click(sel);
      const after = await page.evaluate(i => document.getElementById(i).checked, id);
      await page.click(sel);
      const back = await page.evaluate(i => document.getElementById(i).checked, id);
      const h = await page.evaluate(
        i =>
          Math.round(document.getElementById(i).closest('.set-row').getBoundingClientRect().height),
        id
      );
      await page.evaluate(() => {
        document.querySelectorAll('[data-s2-reveal]').forEach(el => {
          if (el.getAttribute('data-s2-reveal') === 'attr') {
            el.setAttribute('hidden', '');
          } else {
            el.style.removeProperty('display');
          }
          el.removeAttribute('data-s2-reveal');
        });
      });
      assert(
        before === false && after === true && back === false,
        'C7: real click on the ' +
          opt +
          ' row text toggles #' +
          id +
          ' (got ' +
          before +
          ' -> ' +
          after +
          ' -> ' +
          back +
          ')' +
          (revealed ? ' [row revealed from its hidden wrap for the test]' : '')
      );
      assert(h >= 44, 'C7: ' + opt + ' row is ' + h + 'px tall (>= 44px touch target)');
    }

    console.log('\n--- C6 GATE (Chromium): sticky pin + no overflow ancestor ---');
    await page.evaluate(() => {
      document.body.classList.add('bcp-sticky-on');
      // give the sticky element a containing block tall enough to scroll past
      const g = document.querySelector('.bcp-grid');
      if (g) g.style.minHeight = '4000px';
      const spacer = document.createElement('div');
      spacer.style.height = '4000px';
      document.body.appendChild(spacer);
    });
    const overflowAncestors = await page.evaluate(() => {
      const card = document.querySelector('.bcp-result');
      const bad = [];
      // When <html> computes overflow: visible, the BODY's overflow
      // propagates to the viewport instead of clipping (CSS Overflow spec),
      // so body is not an ancestor clipper - the 1500px pin test below is
      // the behavioral proof.
      const htmlClips = getComputedStyle(document.documentElement).overflow !== 'visible';
      let node = card ? card.parentElement : null; // ancestors only: the card's own overflow:auto is by design
      while (node) {
        const cs = getComputedStyle(node);
        const clips =
          cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
        if (clips && !(node === document.body && !htmlClips)) {
          bad.push(
            node.tagName.toLowerCase() +
              (node.className ? '.' + String(node.className).split(' ')[0] : '') +
              ' (overflow: ' +
              cs.overflow +
              '/' +
              cs.overflowX +
              '/' +
              cs.overflowY +
              ')'
          );
        }
        node = node.parentElement;
      }
      return bad;
    });
    assert(
      overflowAncestors.length === 0,
      'C6: no ancestor of .bcp-result sets overflow (sticky killer)' +
        (overflowAncestors.length ? ' - found: ' + overflowAncestors.join(', ') : '')
    );
    const stickyPos = await page.evaluate(
      () => getComputedStyle(document.querySelector('.bcp-result')).position
    );
    assert(
      stickyPos === 'sticky',
      'C6: .bcp-result computed position is sticky (' + stickyPos + ')'
    );
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(200);
    const pin = await page.evaluate(() => {
      const topbar =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bcp-topbar-h')) ||
        64;
      const top = document.querySelector('.bcp-result').getBoundingClientRect().top;
      return { topbar: topbar, top: Math.round(top) };
    });
    assert(
      pin.top >= pin.topbar + 12 && pin.top <= pin.topbar + 40,
      'C6: after a 1500px scroll the card top stays pinned (' +
        pin.top +
        'px, window ' +
        (pin.topbar + 12) +
        '..' +
        (pin.topbar + 40) +
        ')'
    );

    console.log('\n--- C6 GATE (Chromium): 390px total bar, read-only ---');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const bar = document.getElementById('calc-totalbar');
      if (bar) bar.hidden = false;
    });
    await page.waitForTimeout(100);
    const barReport = await page.evaluate(() => {
      const bar = document.getElementById('calc-totalbar');
      if (!bar) return { exists: false };
      const cs = getComputedStyle(bar);
      return {
        exists: true,
        display: cs.display,
        blur: cs.backdropFilter || '',
        actions: bar.querySelectorAll('[data-action="calcBoqAdd"], [data-action="calcRun"]').length,
        show: !!document.getElementById('calc-totalbar-show')
      };
    });
    assert(
      barReport.exists && barReport.display === 'flex',
      'C6: at 390px the bar renders (display: ' + (barReport.display || 'missing') + ')'
    );
    assert(
      barReport.actions === 0,
      'C6: the visible bar still holds no Calculate / Add-to-bill control'
    );
    assert(barReport.show, 'C6: the Show tap target exists');
    assert(
      !/blur/.test(barReport.blur || ''),
      'C6: no glass on the bar (solid surface, content layer)'
    );

    console.log('\n--- X-2 GATE (Chromium): real CSSOM + computed styles ---');
    const cssom = await page.evaluate(() => {
      const out = { blur: 0, transitionAll: [], unparsable: 0 };
      function walk(rules) {
        for (const rule of rules) {
          if (typeof rule.selectorText !== 'string') {
            if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
            continue;
          }
          const t = rule.style ? rule.style.cssText || '' : '';
          if (/backdrop-filter\s*:/.test(t) && !/:\s*none/.test(t)) out.blur++;
          if (/\btransition\s*:\s*all\b/.test(t)) out.transitionAll.push(rule.selectorText);
        }
      }
      for (const sheet of document.styleSheets) {
        try {
          walk(sheet.cssRules);
        } catch (e) {
          out.unparsable++;
        }
      }
      return out;
    });
    assert(cssom.blur < 25, 'X-2: CSSOM agrees - under 25 blur rules (' + cssom.blur + ')');
    assert(
      cssom.transitionAll.length === 0,
      'X-2: CSSOM finds no all-property transition' +
        (cssom.transitionAll.length ? ': ' + cssom.transitionAll.join(', ') : '')
    );
    const computed = await page.evaluate(() => {
      const card = document.getElementById('calc-input-card');
      const cardCs = card ? getComputedStyle(card) : null;
      const btn = document.querySelector('.btn');
      const btnCs = btn ? getComputedStyle(btn) : null;
      const lazy = [
        'calc-boq-card',
        'calc-prelims-card',
        'calc-hist-card',
        'calc-estimates-card'
      ].map(id => {
        const el = document.getElementById(id);
        return el ? getComputedStyle(el).contentVisibility : 'missing';
      });
      const run = document.querySelector('.bcp-run');
      return {
        contain: cardCs ? cardCs.contain : 'missing',
        bg: cardCs ? cardCs.backgroundColor : 'missing',
        cardBlur: cardCs ? cardCs.backdropFilter || '' : 'missing',
        btnTransition: btnCs ? btnCs.transitionProperty : 'missing',
        lazy: lazy,
        runPos: run ? getComputedStyle(run).position : 'missing'
      };
    });
    assert(
      /layout/.test(computed.contain) && /paint/.test(computed.contain),
      'X-2: .card computed contain = "' + computed.contain + '"'
    );
    const alpha = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(computed.bg);
    const isOpaque = computed.bg.indexOf('rgba') === -1 || (alpha && parseFloat(alpha[1]) === 1);
    assert(!!isOpaque, 'X-2: .card background is solid (' + computed.bg + ')');
    assert(
      !/blur/.test(computed.cardBlur),
      'X-2: .card computed backdrop-filter carries no blur (' + computed.cardBlur + ')'
    );
    assert(
      computed.btnTransition !== 'all' && /transform/.test(computed.btnTransition),
      'X-2: .btn resolves to an explicit transition-property list (' + computed.btnTransition + ')'
    );
    assert(
      computed.lazy.every(v => v === 'auto'),
      'X-2: the four below-the-fold cards resolve content-visibility: auto (' +
        computed.lazy.join(',') +
        ')'
    );
    assert(
      computed.runPos === 'static',
      'X-2: .bcp-run computed position is static - the pinned buttons stay gone (owner rule 1.14)'
    );
  } catch (e) {
    bad('gate crashed: ' + ((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
  }

  if (problems.length) {
    console.log('\nCALC S2 GATE FAIL (' + problems.length + ' of ' + checks + ' checks):');
    problems.forEach(p => console.log('  - ' + p));
    process.exit(1);
  }
  console.log('\nCALC S2 GATE PASS (' + checks + ' checks)');
  process.exit(0);
})();
