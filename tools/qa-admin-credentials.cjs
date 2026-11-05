#!/usr/bin/env node
/* ============================================================
   tools/qa-admin-credentials.cjs  —  5.4 A1 + A2 (2026-11-05)
   ------------------------------------------------------------
   Pure-static gate (T1: no Chrome, no wrangler). Reads the served
   HTML source for app.html + admin.html and asserts two things the
   previous waves left as short codes without an in-repo acceptance
   doc:

   A1  Brand-new instance
       - The projects grid empty state leads with a "Create your
         first project" primary CTA (not a plain hint line).
       - That CTA routes to the Admin panel (data-nav="admin").
       - Demo projects are excluded from the user grid (userProjects
         filter drops p.demo).

   A2  Credential kinds named correctly in admin.html
       - The four kinds are all named: Access code, View-only,
         Owner code, Client code.
       - Demo projects stay off the admin list (renderProjects drops
         isDemo rows and demo-*-prefixed ids).

   Usage:  node tools/qa-admin-credentials.cjs
   Exit:   0 = all gates pass, 1 = any gate failed
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const APP = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const ADM = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('[5.4] PASS  ' + name);
  } else {
    fail++;
    console.error('[5.4] FAIL  ' + name + (detail !== undefined ? '  <-- ' + detail : ''));
  }
}

// ---------- A1: brand-new-instance empty state ----------
check(
  'A1a empty state leads with "Create your first project"',
  APP.indexOf('empty-first') !== -1 && APP.indexOf('Create your first project') !== -1,
  'missing empty-first class or CTA text in app.html'
);

check(
  'A1b the CTA is a button that routes to the Admin panel',
  /data-nav="admin"/.test(APP) && /Create your first project<\/button>/.test(APP),
  'no data-nav="admin" Create-your-first-project button found'
);

check(
  'A1c the old grid empty-state hint line is gone (replaced by the CTA)',
  !/grid\.innerHTML\s*=\s*'<div class="empty">No projects yet\. Add one from the Admin panel\.<\/div>'/.test(
    APP
  ),
  'old grid empty-state string still present in app.html'
);

check(
  'A1d demo projects are excluded from the user grid',
  /userProjects\s*=\s*projects\.filter\(function\(p\)\s*\{\s*return !p\.demo;/.test(APP),
  'renderCards userProjects filter does not drop p.demo'
);

// ---------- A2: credential kinds named in admin.html ----------
check(
  'A2a Access code is named',
  /Access code\b/.test(ADM),
  'no "Access code" label in admin.html'
);
check(
  'A2b View-only code is named (visible label)',
  /View-only:\s*\$\{/.test(ADM),
  'no visible "View-only:" label in admin.html project row'
);
check(
  'A2c Owner code is named (visible label)',
  /Owner code:\s*<code/.test(ADM),
  'no visible "Owner code:" label in admin.html'
);
check('A2d Client code is named', /Client code/.test(ADM), 'no "Client code" label in admin.html');

check(
  'A2e demo projects stay off the admin list',
  /!row\.p\.isDemo && !\(row\.p\.id && row\.p\.id\.indexOf\('demo-'\) === 0\)/.test(ADM),
  'admin renderProjects does not filter demo rows'
);

console.log('----------------------------------------');
if (fail) {
  console.error('[5.4] RESULT: ' + fail + ' gate(s) FAILED');
  process.exit(1);
}
console.log('[5.4] RESULT: all 5.4 A1/A2 gates passed');
