#!/usr/bin/env node
/* ============================================================
   tools/verify-marketing-markup.cjs — static rail + canvas guard.

   WHY THIS EXISTS (2026-10-07). The marketing page had two classes of defect
   that the existing gates could not catch:

     1. The marketing CANVAS was cropped: <main> carried max-width:1200px AND
        margin-left:96px, so every band (.hero, .section, ...) was clipped to
        a 1200px box on a 1534px window. The footer sat outside <main> and was
        full-width, so the page looked broken. The only harness measuring the
        96px gutter did so on PHONES only.
     2. The DOT RAIL had invisible big dots (inline <span>), invalid nested
        <li> markup, and a highlight that lit every subsection at once instead
        of following the reader.

   This gate now checks BOTH the canvas (no margin/max-width/width on main) and
   the rail (7 big dots, no labels/tooltips/lines, dot sizes, MINORS_PER_GAP
   present in js/marketing.js). It runs on every push via `npm run verify`.

   Exit: 0 = clean, 1 = the canvas or rail regressed.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const CSS = path.join(ROOT, 'css', 'marketing.css');
const JS = path.join(ROOT, 'js', 'marketing.js');

let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) fails++;
}

/* ---- 1. rail markup: 7 big dots, no labels/tooltips/lines, no nested <li> ---------- */
const html = fs.readFileSync(HTML, 'utf8');
const railStart = html.indexOf('class="dot-rail-navigation"');
ok('index.html carries the dot rail', railStart > -1);
if (railStart > -1) {
  const rail = html.slice(railStart, html.indexOf('</nav>', railStart));

  // no nested <li> (the old dot-group <li> contained children <li> - invalid)
  let nested = 0;
  let depth = 0;
  const tags = rail.match(/<\/?li\b[^>]*>/g) || [];
  tags.forEach(t => {
    if (/^<\/li/.test(t)) {
      depth = Math.max(0, depth - 1);
    } else {
      if (depth > 0) nested++;
      depth++;
    }
  });
  ok('rail <li> elements are never nested inside a <li>', nested === 0, nested + ' nested');
  ok('the rail closes every <li> it opens', depth === 0, 'depth=' + depth);

  // exactly 7 big dots (the new contract)
  const majors = (rail.match(/class="dot-item major"/g) || []).length;
  ok('the rail exposes seven big dots', majors === 7, 'got ' + majors);

  // no labels, tooltips, lines or dot-groups
  ok('the rail has no .tooltip', !/class="tooltip"/.test(rail));
  ok('the rail has no .dot-label', !/class="dot-label"/.test(rail));
  ok('the rail has no .rail-line', !/class="rail-line"/.test(rail));
  ok('the rail has no .dot-group', !/class="dot-group"/.test(rail));
}

/* ---- 2. a sized dot must not be an inline box -------------------------- */
const css = fs.readFileSync(CSS, 'utf8');
const baseDot = /(^|\n)\.dot\s*\{([^}]*)\}/.exec(css);
ok('css/marketing.css defines the .dot box', !!baseDot);
if (baseDot) {
  const body = baseDot[2];
  ok(
    '.dot declares a display that makes width/height apply',
    /display\s*:\s*(block|inline-block|flex|grid)/.test(body),
    'display not blockified -> an inline span measures 0x0'
  );
  // major dot >= 12px, minor dot <= 8px (the new contract)
  const major = /\.dot-item\.major\s+\.dot\s*\{([^}]*)\}/.exec(css);
  const minor = /\.dot-item\.minor\s+\.dot\s*\{([^}]*)\}/.exec(css);
  const px = (body, prop) => {
    const m = new RegExp(prop + '\\s*:\\s*(\\d+)px').exec(body || '');
    return m ? Number(m[1]) : null;
  };
  if (major) {
    const mj = px(major[1], 'width');
    ok('.dot-item.major .dot width >= 12px', mj !== null && mj >= 12, 'width=' + mj + 'px');
  } else {
    ok('.dot-item.major .dot rule present', false);
  }
  if (minor) {
    const mn = px(minor[1], 'width');
    ok('.dot-item.minor .dot width <= 8px', mn !== null && mn <= 8, 'width=' + mn + 'px');
  } else {
    ok('.dot-item.minor .dot rule present', false);
  }
}

/* ---- 3. canvas: <main> must be full-bleed ------------------------------ */
// FAIL if any rule whose selector is exactly `main` declares margin-left,
// margin-right, max-width (other than none) or width (other than 100%).
const mainRule = /(^|\n)\s*main\s*\{([^}]*)\}/gm;
let m;
while ((m = mainRule.exec(css)) !== null) {
  const body = m[2];
  if (/margin-left\s*:/.test(body)) {
    ok('main has no margin-left', false, 'margin-left declared');
  } else {
    ok('main has no margin-left', true);
  }
  if (/margin-right\s*:/.test(body)) {
    ok('main has no margin-right', false, 'margin-right declared');
  } else {
    ok('main has no margin-right', true);
  }
  // max-width must be 'none' (or absent); width must be '100%'
  const hasMaxWidth = /max-width\s*:\s*none\s*[;\n]/.test(body);
  const hasWidth100 = /width\s*:\s*100%\s*[;\n]/.test(body);
  ok(
    'main max-width is none',
    hasMaxWidth,
    'max-width=' + (body.match(/max-width\s*:\s*[^;\n]*/)?.[0] || 'absent')
  );
  ok(
    'main width is 100%',
    hasWidth100,
    'width=' + (body.match(/width\s*:\s*[^;\n]*/)?.[0] || 'absent')
  );
  if (!hasMaxWidth && /max-width\s*:/i.test(body))
    ok('main max-width is none', false, 'max-width declared (not none)');
  if (!hasWidth100 && /width\s*:/i.test(body))
    ok('main width is 100%', false, 'width declared (not 100%)');
}

/* ---- 4. js/marketing.js must declare MINORS_PER_GAP -------------------- */
const js = fs.readFileSync(JS, 'utf8');
ok('js/marketing.js declares MINORS_PER_GAP', /MINORS_PER_GAP\s*=/.test(js));

console.log('\n' + (fails === 0 ? 'MARKETING MARKUP PASS' : fails + ' CHECK(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
