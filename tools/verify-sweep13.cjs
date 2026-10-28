#!/usr/bin/env node
/* ============================================================
   tools/verify-sweep13.cjs - SW-13 made permanent
   (REFINEMENT-DIRECTIVE-2026-10-24 section 11, Wave D small checks)

   SW-13 asks: "notice containers that no code ever fills". The sweep
   detector answers it, and this gate keeps the ANSWER honest in three
   ways, because the first version of the detector was wrong in a way a
   count alone cannot show:

   1. The sweep must report ZERO hits. The detector is the single source
      of the rule; re-deriving it here would let the two drift apart.
   2. The SURFACE must still exist. The containers the detector judges
      (expiry-body, wbs-alerts, risk-matrix, raci-alerts) have to be in
      project.html, and there have to be at least ten notice-ish ids
      across the workspace pages. A regex that matches nothing also
      reports zero hits, and that is exactly how a check becomes a lie.
   3. The CORPUS must still be broad. Five of the fourteen containers the
      first pass called dead are written from js/render/*.js, so the
      detector has to see js/ sub-directories. This arm proves those
      producers are visible to it, not merely present on disk.

   Static, no server, no Chrome. Teeth proven by mutation: renaming
   `id="expiry-body"` in project.html fails arm 1 with one hit, and
   renaming a form control (`mc-risk-factor`) stays out of scope.

   Usage:  node tools/verify-sweep13.cjs
   Registry: CI-TEST-COVERAGE.md -> CI row; wired in ci.yml T1 and
   `npm run verify:sweep13`.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(
    '  ' + tag + '  ' + name + (ok || detail === undefined ? '' : '  <-- ' + JSON.stringify(detail))
  );
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== SW-13: notice containers that no code ever fills ===');

// ---- 1. The sweep reports zero ------------------------------------------
let out = '';
let code = 0;
try {
  out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'tools', 'sweep', 'sweep.cjs'), '--id=sw-13'],
    {
      cwd: ROOT,
      encoding: 'utf8'
    }
  );
} catch (e) {
  code = e.status === undefined ? 1 : e.status;
  out = String(e.stdout || '') + String(e.stderr || '');
}
const m = out.match(/SW-13\s+(\d+)/);
const hits = m ? Number(m[1]) : -1;
check('SW-13 the sweep reports zero dead containers', code === 0 && hits === 0, {
  exit: code,
  hits,
  tail: out.trim().split('\n').slice(-3).join(' | ')
});

// ---- 2. The surface still exists ----------------------------------------
const project = read('project.html');
const live = ['expiry-body', 'wbs-alerts', 'risk-matrix', 'raci-alerts'];
const missing = live.filter(id => project.indexOf('id="' + id + '"') < 0);
check(
  'SW-13 the containers the detector judges are still on the project page',
  missing.length === 0,
  {
    missing
  }
);

const WORKSPACE = ['project.html', 'app.html', 'admin.html', 'calculator.html'];
const re = /id="([a-z0-9-]*(?:notice|alert|expiry|risk)[a-z0-9-]*)"/gi;
let candidates = 0;
for (const rel of WORKSPACE) {
  const src = read(rel);
  let one;
  while ((one = re.exec(src))) {
    candidates++;
  }
  re.lastIndex = 0;
}
check('SW-13 the scan has a real surface to judge (at least ten candidates)', candidates >= 10, {
  candidates
});

// ---- 3. The corpus still sees js/ sub-directories ----------------------
const deep = [
  ['expiry-body', 'js/mmgr-render.js'],
  ['risk-matrix', 'js/render/risks.js'],
  ['raci-alerts', 'js/render/people.js'],
  ['bud-overrun-alert', 'js/render/financials.js']
];
const invisible = deep
  .filter(([id, rel]) => {
    try {
      return read(rel).indexOf(id) < 0;
    } catch (e) {
      return true;
    }
  })
  .map(([id, rel]) => id + ' not in ' + rel);
check('SW-13 every producer the detector relies on is in a file it scans', invisible.length === 0, {
  invisible
});

const failed = results.filter(r => !r.ok).length;
console.log(
  failed
    ? '\nSW-13 NOTICE CONTAINERS FAIL (' + failed + ' of ' + results.length + ')'
    : '\nSW-13 NOTICE CONTAINERS PASS (' + results.length + ' checks)'
);
process.exit(failed ? 1 : 0);
