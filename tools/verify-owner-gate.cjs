#!/usr/bin/env node
/**
 * verify-owner-gate.cjs — OWNER-GATE-FIX regression gate (owner 2026-09-24)
 * ------------------------------------------------------------
 * Locks in the fix for the owner's live bug: the creator of a project,
 * signed in, was told "Open this project as its owner first" on their OWN
 * project and could not create API keys until they re-pushed a cloud
 * snapshot. Root causes were client-side (js/mmgr-cloud.js):
 *   1. adoptAdminRecordedCode() seeded the admin registry's 'session' link
 *      marker as if it were a real owner code -> X-Owner-Code: session on
 *      every owner action -> guaranteed 403.
 *   2. An EMAIL sign-in only dispatches mmgr:user-changed and the resume
 *      handler returns early when nothing is queued, so checkMe's cached
 *      "not signed in" and a memoized false session-owner probe survived
 *      the sign-in until a full page reload.
 *   3. probeOwnerSession() memoized a false negative while a code was
 *      held, so dropping the code never re-probed the session.
 * The gate asserts, against SOURCE and against the BUILT BUNDLE (so bundle
 * staleness cannot silently bypass it):
 *   - the 'session' marker is refused by the adopter AND sanitized by
 *     getCode() (defense-in-depth),
 *   - identity-change listeners invalidate _meChecked / _sessOwner,
 *   - the held-code probe path does NOT memoize its negative,
 *   - the single-line "Open this project as its owner first" message is
 *     gone, replaced by the state-aware ownerGateMessage(),
 *   - all three create gates (editor codes, client codes, API keys) use it.
 * Zero dependencies. Run:  node tools/verify-owner-gate.cjs
 * Exit 0 = all gates green. Exit 1 = regression detected.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'js', 'mmgr-cloud.js');
const BUNDLE = path.join(ROOT, 'dist', 'bundle.js'); // project.html bundle carries mmgr-cloud.js

let passes = 0;
let fails = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  PASS  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (detail ? ' -- ' + detail : '')); }
}

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

function run(label, content) {
  const has = (s) => content.indexOf(s) > -1;
  console.log('\n--- ' + label + ' ---');

  // G1: the adopter refuses the 'session' marker (no fake owner code).
  check('G1 adopter skips the session marker', has("if (c === 'session') return;"),
    'adoptAdminRecordedCode must not seed the registry marker as a code');

  // G2: getCode() sanitizes a poisoned slot (defense-in-depth).
  check('G2 getCode() sanitizes a stored session marker', has("v && v !== 'session' ? v : ''"),
    'a stray session value in the code slot must read as absent');

  // G3: identity changes invalidate both memoized ownership answers.
  check('G3a user-changed invalidates the checkMe memo', has("_meChecked = false;\n    clearSessOwner();"),
    'email sign-in must clear the cached not-signed-in + stale probe');
  check('G3b probe memo cleared by clearSessOwner', has('function clearSessOwner() { _sessOwner = false; _sessOwnerProbed = false; }'),
    'clearSessOwner must reset the probe memo too');

  // G4: a held code must not memoize the probe's negative.
  check('G4 held-code probe path does not memoize', has('if (getCode() || getECode()) { _sessOwnerProbed = false; return false; }'),
    'dropping a code must let the next render re-probe the session');

  // G5: the vague single-line owner message is gone.
  check('G5 old one-size message removed', !has('Open this project as its owner first'),
    'the symptom-only message must not return');

  // G6: the state-aware message exists and names the one-click fix.
  check('G6a ownerGateMessage defined', has('function ownerGateMessage()'));
  check('G6b signed-in branch names Link to my account', has('Link to my account'),
    'the message must tell the signed-in creator the exact next step');

  // G7: all three create gates speak the shared message.
  const uses = (content.match(/setStatus\(ownerGateMessage\(\), 'warn'\)/g) || []).length;
  check('G7 ownerGateMessage used at all three create gates (editor/client/API-key)', uses >= 3,
    'found ' + uses + ' call site(s), need >= 3');
}

console.log('Owner-gate regression gate (OWNER-GATE-FIX 2026-09-24)');

const src = readSafe(SRC);
if (src === null) { console.error('  FAIL  cannot read ' + SRC); process.exit(1); }
run('SOURCE js/mmgr-cloud.js', src);

const bundle = readSafe(BUNDLE);
if (bundle === null) {
  fails++;
  console.log('\n  FAIL  dist/bundle.js not found -- run "node build.js" first (the browser runs the bundle, not the source; an untested bundle is the #1 silent-edit trap).');
} else {
  // The bundle is minified: string literals survive (quote style may flip),
  // so assert on quote-agnostic probes.
  const lit = (s) => bundle.indexOf(s) > -1;
  const markerGuard = bundle.indexOf('==="session"') > -1 || bundle.indexOf('"session"===') > -1 ||
    bundle.indexOf("==='session'") > -1 || bundle.indexOf("'session'===") > -1;
  console.log('\n--- BUILT BUNDLE dist/bundle.js (string-literal probes) ---');
  check('B1 session-marker guard in bundle', markerGuard, 'the session-marker guard comparison must survive minification into the bundle');
  check('B2 state-aware message in bundle', lit('not linked to your account yet'), 'the new signed-in gate message must be in the bundle');
  check('B3 old message absent from bundle', !lit('Open this project as its owner first'), 'stale bundle = old bug still live in the browser');
}

console.log('\n----------------------------------------');
if (fails > 0) {
  console.log('OWNER-GATE GATE FAIL (' + fails + ' failed, ' + passes + ' passed)');
  process.exit(1);
}
console.log('OWNER-GATE GATE PASS (' + passes + '/' + passes + ')');
