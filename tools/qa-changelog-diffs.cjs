/* ============================================================
   qa-changelog-diffs.cjs — CHANGELOG-DIFF-EXPAND (2026-08-12)
   ------------------------------------------------------------
   Standalone gate for the click-to-expand before/after diff
   panel rendered by js/mmgr-cloud.js (listLog -> renderDiffPanel /
   clVal). The module is a browser IIFE, so the harness stubs the
   minimal globals it touches at LOAD time only (window, document,
   storage) and then drives the pure string-builder test hook
   MMGR.Cloud._renderDiffPanel directly — no DOM, no network.

   Usage:  node tools/qa-changelog-diffs.cjs
   Exit:   0 = all gates pass, 1 = any gate failed
   ============================================================ */

const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---- minimal load-time browser stubs -------------------------
global.window = { MMGR: {} };
global.document = {
  readyState: 'complete', // non-'loading' → the module's boot render() runs; stub returns null
  addEventListener: function() {},
  getElementById: function() { return null; },
  querySelector: function() { return null; },
  querySelectorAll: function() { return []; },
  createElement: function() { return { className: '', style: {}, appendChild: function() {}, setAttribute: function() {} }; },
  createTextNode: function() { return {}; }
};
global.sessionStorage = { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {} };
global.localStorage = { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {} };
global.navigator = { clipboard: {} };

require(path.join(ROOT, 'js', 'mmgr-cloud.js'));

const R = global.window.MMGR.Cloud && global.window.MMGR.Cloud._renderDiffPanel;
if (typeof R !== 'function') {
  console.error('[cl-diffs] FATAL: MMGR.Cloud._renderDiffPanel test hook not exposed');
  process.exit(1);
}

let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('[cl-diffs] PASS  ' + name); }
  else { fail++; console.error('[cl-diffs] FAIL  ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

// G1: a normal edit entry renders path + before + after.
const h1 = R({ id: 1, diffs: [
  { path: 'charter.name', before: 'Old Name', after: 'New Name', beforeAbsent: false, afterAbsent: false },
  { path: 'tasks[2].status', before: null, after: 'done', beforeAbsent: false, afterAbsent: false }
] });
check('G1a renders the field path', h1.indexOf('charter.name') !== -1 && h1.indexOf('tasks[2].status') !== -1, h1);
check('G1b renders before/after values', h1.indexOf('Old Name') !== -1 && h1.indexOf('New Name') !== -1, h1);
check('G1c renders null value', h1.indexOf('null') !== -1, h1);
check('G1d header row labels the columns', h1.indexOf('Field') !== -1 && h1.indexOf('Before') !== -1 && h1.indexOf('After') !== -1, h1);
check('G1e before gets the old (danger) class, after the new (green) class', h1.indexOf('cl-old') !== -1 && h1.indexOf('cl-new') !== -1, h1);

// G2: absent states render as "absent" (not the raw value).
const h2 = R({ id: 2, diffs: [
  { path: 'raci.matrix.mike', before: 'A', beforeAbsent: true, after: 'R', afterAbsent: false },
  { path: 'tasks[0]', before: { id: 't1', name: 'Found' }, beforeAbsent: false, after: null, afterAbsent: true }
] });
check('G2a beforeAbsent shows absent', h2.indexOf('cl-absent') !== -1 && h2.indexOf('>absent<') !== -1, h2);
check('G2b afterAbsent shows absent', (h2.match(/cl-absent/g) || []).length === 2, h2);
// The record JSON is escaped on output (&quot;), so assert the escaped form.
check('G2c whole-record before becomes JSON', h2.indexOf('&quot;id&quot;:&quot;t1&quot;') !== -1 && h2.indexOf('{') !== -1, h2);

// G3: values are HTML-escaped (server state interpolated into innerHTML).
const h3 = R({ id: 3, diffs: [
  { path: 'closure.note', before: '<img src=x onerror=alert(1)>', after: 'clean', beforeAbsent: false, afterAbsent: false }
] });
check('G3a raw HTML value is escaped', h3.indexOf('&lt;img') !== -1 && h3.indexOf('<img') === -1, h3);
check('G3b path is escaped', h3.indexOf('closure.note') !== -1, h3);

// G4: long values are ellipsis-truncated on screen, full value in title.
const longVal = 'X'.repeat(200);
const h4 = R({ id: 4, diffs: [
  { path: 'wbs.note', before: longVal, after: 'short', beforeAbsent: false, afterAbsent: false }
] });
// The full value lives in the title BY DESIGN; only the on-screen <code> text
// is truncated. Extract the old-value cell and assert it is short + ends '…'.
const m4 = /cl-val cl-old"[^>]*>([^<]*)<\/code>/.exec(h4);
check('G4a long value truncated with ellipsis on screen', !!m4 && m4[1].length <= 145 && m4[1].indexOf('…') !== -1 && m4[1].length < longVal.length, m4 && m4[1].length);
check('G4b full value rides in the title attribute', h4.indexOf('title="' + longVal + '"') !== -1, h4.slice(0, 400));

// G5: empty / missing diffs render an empty panel (no toggle content).
check('G5a empty diffs array -> empty panel', R({ id: 5, diffs: [] }) === '', R({ id: 5, diffs: [] }));
check('G5b missing diffs -> empty panel', R({ id: 6 }) === '', R({ id: 6 }));

// G6: render cap — more than 60 diffs shows a "… and N more" footer.
const big = [];
for (let i = 0; i < 70; i++) big.push({ path: 'tasks[' + i + '].name', before: 'b' + i, after: 'a' + i, beforeAbsent: false, afterAbsent: false });
const h6 = R({ id: 7, diffs: big });
// Count ONLY row divs (class="cl-diff" exactly) — cl-diff-head / cl-diff-path
// also contain the substring and must not be counted.
check('G6a panel capped at 60 rows', (h6.match(/class="cl-diff"/g) || []).length === 60, h6.length);
check('G6b footer reports the overflow', h6.indexOf('10 more field(s)') !== -1, h6.slice(-160));

// G7: a value with a double-quote inside is safe in the title attribute.
const quoteVal = 'he said "hi" then <b>left</b>';
const h7 = R({ id: 8, diffs: [
  { path: 'log.txt', before: quoteVal, after: '', beforeAbsent: false, afterAbsent: false }
] });
check('G7a quote value rendered escaped', h7.indexOf('&quot;hi&quot;') !== -1 && h7.indexOf('"hi"') === -1, h7);

console.log('----------------------------------------');
if (fail) { console.error('[cl-diffs] RESULT: ' + fail + ' gate(s) FAILED'); process.exit(1); }
console.log('[cl-diffs] RESULT: all changelog-diff gates passed');
