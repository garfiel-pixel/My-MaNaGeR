#!/usr/bin/env node
/* ============================================================
   tools/verify-sw10.cjs - SW-10 made permanent
   (REFINEMENT-DIRECTIVE-2026-10-24 section 11, Wave F)

   SW-10 asks: "clickable div or span with no role, tabindex or key
   handler". The sweep detector answers it (16 hits at baseline, all in
   admin.html, app.html and project.html), and this gate keeps the answer
   honest in four ways a bare zero cannot:

   1. The SWEEP must report zero. The detector in tools/sweep/sweep.cjs is
      the single source of the rule; re-deriving its regex here would let
      the two drift apart.
   2. The CORPUS must still be judged. A sweep that matches nothing also
      reports zero, so this arm requires that the served pages still carry
      at least a dozen div/span/li/td elements with data-action, and that
      the specific surfaces the fix touched (three nav scrims and six
      dialog backdrops) are still there to be judged.
   3. The two real controls must be OPERABLE, not merely labelled.
      #dirty-ind and #timeline-ind are click-driven controls: each carries
      role="button" and tabindex="0", and js/mmgr-app.js must hold the
      delegated keydown listener that turns Enter and Space into a click
      (label without activation is a control that cannot be pressed).
   4. A decorative backdrop must stay UNFOCUSABLE. The scrims and dialog
      backdrops are role="presentation" with aria-hidden, so giving one
      tabindex would create an aria-hidden-focus violation - this arm fails
      if any of the three scrims gains tabindex.

   Static, no server, no Chrome. Teeth proven by mutation: dropping
   role="button" from #dirty-ind fails arm 3; removing the keydown listener
   fails arm 3; adding tabindex to a scrim fails arm 4; restoring the
   markup returns the gate green byte-identical.

   Usage:  node tools/verify-sw10.cjs
   Registry: CI-TEST-COVERAGE.md -> CI row; wired in ci.yml T1 and
   `npm run verify:sw10`.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(
    '  ' +
      (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok || detail === undefined ? '' : '  <-- ' + JSON.stringify(detail))
  );
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---- ARM 1: the sweep's own SW-10 count is zero -------------------------
let sweepCount = null;
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'sweep', 'sweep.cjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  const m = /\[sweep\]\s+SW-10\s+(\d+)/.exec(out);
  sweepCount = m ? Number(m[1]) : null;
} catch (e) {
  sweepCount = null;
}
check('ARM 1: the sweep reports SW-10 = 0', sweepCount === 0, sweepCount);

// ---- ARM 2: the corpus the detector judges still exists -----------------
const TAG_RE = /<(div|span|li|td)\b[^>]*data-action="[^"]*"[^>]*>/g;
const PAGES = ['admin.html', 'app.html', 'project.html', 'calculator.html'];
let corpus = 0;
PAGES.forEach(rel => {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    return;
  }
  read(rel)
    .split('\n')
    .forEach(line => {
      TAG_RE.lastIndex = 0;
      while (TAG_RE.exec(line) !== null) {
        corpus++;
      }
    });
});
check('ARM 2a: at least 12 div/span/li/td data-action surfaces remain', corpus >= 12, corpus);

const project = read('project.html');
const admin = read('admin.html');
const app = read('app.html');
const backdropIds = [
  ['project.html', project, 'ai-mailbox'],
  ['project.html', project, 'chartup-modal'],
  ['project.html', project, 'gantt-export-modal'],
  ['project.html', project, 'wbsimport-modal'],
  ['project.html', project, 'importdates-modal'],
  ['project.html', project, 'bidpkg-modal']
];
const backdropsOk = backdropIds.every(
  ([, src, id]) =>
    new RegExp(
      '<(div|span)[^>]*id="' + id + '"[^>]*data-action="[^"]+"[^>]*role="presentation"'
    ).test(src) ||
    new RegExp(
      '<(div|span)[^>]*data-action="[^"]+"[^>]*id="' + id + '"[^>]*role="presentation"'
    ).test(src)
);
check(
  'ARM 2b: the six dialog backdrops are still judged (data-action + role=presentation)',
  backdropsOk
);

const scrims = [
  ['admin.html', admin, 'nav-scrim', 'tglNav'],
  ['app.html', app, 'db-scrim', 'toggleSidebar'],
  ['project.html', project, 'nav-scrim', 'tglNav']
];
const scrimsOk = scrims.every(([, src, id, action]) =>
  new RegExp('<div[^>]*id="' + id + '"[^>]*data-action="' + action + '"').test(src)
);
check('ARM 2c: the three nav scrims still carry their data-action', scrimsOk);

// ---- ARM 3: the two real controls are operable --------------------------
const dirty = /<div[^>]*id="dirty-ind"[^>]*>/.exec(project);
const timeline = /<div[^>]*id="timeline-ind"[^>]*>/.exec(project);
const hasAttrs = (tag, role, tabindex) =>
  !!tag &&
  tag[0].indexOf('role="' + role + '"') > -1 &&
  tag[0].indexOf('tabindex="' + tabindex + '"') > -1;
check(
  'ARM 3a: #dirty-ind carries role=button and tabindex=0',
  hasAttrs(dirty, 'button', '0'),
  dirty && dirty[0]
);
check(
  'ARM 3b: #timeline-ind carries role=button and tabindex=0',
  hasAttrs(timeline, 'button', '0'),
  timeline && timeline[0]
);

const appJs = read('js/mmgr-app.js');
const keyBlock = /document\.addEventListener\('keydown'[\s\S]{0,900}?el\.click\(\)/.test(appJs);
const guardsRole =
  /getAttribute\('role'\)\s*!==\s*'button'/.test(appJs) ||
  /getAttribute\("role"\)\s*!==\s*"button"/.test(appJs);
check(
  'ARM 3c: a delegated keydown activates role=button data-action elements (Enter/Space -> click)',
  keyBlock && guardsRole
);

// ---- ARM 4: decorative backdrops stay unfocusable ------------------------
const scrimFocusable = scrims.some(([, src, id]) => {
  const tag = new RegExp('<div[^>]*id="' + id + '"[^>]*>').exec(src);
  return !!tag && /tabindex=/.test(tag[0]);
});
check(
  'ARM 4: no nav scrim is focusable (aria-hidden + tabindex would be a violation)',
  !scrimFocusable
);

// ---- each dialog still has a keyboard close control ----------------------
const closeOk = backdropIds.every(([, src, id]) => {
  const start = src.indexOf('id="' + id + '"');
  if (start < 0) {
    return false;
  }
  const slice = src.slice(start, start + 6000);
  return (
    /<button[^>]*data-action="[^"]*(close|Close|Cancel)[^"]*"/.test(slice) ||
    /data-action="close[A-Za-z]*"/.test(slice)
  );
});
check('ARM 5: every dialog backdrop still offers a real close button', closeOk);

const failed = results.filter(r => !r.ok);
console.log('  ---');
console.log(
  '  verify-sw10: ' + (results.length - failed.length) + '/' + results.length + ' checks'
);
process.exit(failed.length ? 1 : 0);
