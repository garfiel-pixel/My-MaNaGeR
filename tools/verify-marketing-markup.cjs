#!/usr/bin/env node
/* ============================================================
   tools/verify-marketing-markup.cjs — static rail guard.

   WHY THIS EXISTS (2026-10-07). Two defects shipped on the marketing page and
   NEITHER was catchable by the gates that existed, because the only harness
   covering the rail was EXTENDED (weekly) and had been pointing at markup that
   no longer existed:

     1. `.dot-item.major`'s dot is a bare <span>. A span is inline, and width /
        height are IGNORED on inline boxes, so every big dot on the rail
        rendered 0x0 - invisible - while the CSS that "sized" it looked
        perfectly correct in review.
     2. The rail's group was `<li class="dot-group">` containing `<li>`
        children. <li> cannot nest without a list in between, so the parser
        implicitly closed the outer one: the DOM came out FLAT and every
        `>`-scoped rule silently matched nothing.

   Both are visible in the SOURCE, with no browser needed, so this gate runs on
   every push via `npm run verify` instead of once a week.

   Exit: 0 = clean, 1 = the rail markup or the dot box regressed.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const CSS = path.join(ROOT, 'css', 'marketing.css');

let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) fails++;
}

/* ---- 1. the rail's list items must not nest inside each other ---------- */
const html = fs.readFileSync(HTML, 'utf8');
const railStart = html.indexOf('class="dot-rail-navigation"');
ok('index.html carries the dot rail', railStart > -1);
let nested = 0;
let depth = 0;
if (railStart > -1) {
  const rail = html.slice(railStart, html.indexOf('</nav>', railStart));
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
  ok(
    'the subsection cluster is a div, not an <li>',
    /<div class="dot-group-children"/.test(rail),
    /<li class="dot-group-children"/.test(rail) ? 'still an <li>' : 'ok'
  );
  const majors = (rail.match(/class="dot-item major"/g) || []).length;
  ok('the rail exposes six big dots', majors === 6, 'got ' + majors);
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
  ok('.dot still declares a size', /width\s*:/.test(body) && /height\s*:/.test(body));
}

/* the major dots must stay LARGER than the minor dots (owner spec) */
const major = /\.dot-item\.major\s+\.dot\s*\{([^}]*)\}/.exec(css);
const minor = /\.dot-item\.minor\s+\.dot\s*\{([^}]*)\}/.exec(css);
const px = (body, prop) => {
  const m = new RegExp(prop + '\\s*:\\s*(\\d+)px').exec(body || '');
  return m ? Number(m[1]) : null;
};
if (major && minor) {
  const mj = px(major[1], 'width');
  const mn = px(minor[1], 'width');
  ok(
    'the big dots are bigger than the small ones',
    mj > mn,
    'major=' + mj + 'px minor=' + mn + 'px'
  );
} else {
  ok('both dot sizes are declared', false, 'major=' + !!major + ' minor=' + !!minor);
}

console.log('\n' + (fails === 0 ? 'MARKETING MARKUP PASS' : fails + ' CHECK(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
