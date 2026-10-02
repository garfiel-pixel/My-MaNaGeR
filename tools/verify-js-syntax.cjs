/* ============================================================
   VERIFY-JS-SYNTAX — every shipped source script PARSES
   ------------------------------------------------------------
   WHY THIS EXISTS (owner directive 2026-10-02, incident during
   the JIC 2025-2027 rate wave):

   js/calculator-page.js shipped with UNQUOTED HYPHENATED OBJECT
   KEYS (`plumbing-pipe:` instead of `'plumbing-pipe':`). That
   is a hard SyntaxError, so the ENTIRE Build Cost Calculator page
   was dead - every trade, every rate, the whole engine.

   Nothing caught it, because:
     - `node build.js` never parses it: calculator.html loads
       js/calculator-page.js as a STANDALONE external script, it
       is not part of any bundle.
     - `npm run verify` never parsed it either.
   Only a browser-run harness would have surfaced it, and the
   battery's own baselines were simultaneously stale, so the
   failure was masked rather than reported.

   This gate closes that hole: it parses every source script the
   site can serve, standalone or bundled, so a syntax error is
   caught on every push instead of on a user's screen.

   Deliberately NOT a linter: no style rules, no unused vars.
   One job only - "does this file parse".
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const log = (s) => process.stdout.write(s + '\n');

// Collect the source scripts the site can actually serve. Anything under
// these roots is either bundled by build.js or loaded standalone by a page;
// both must parse. tmp/, node_modules/, dist/, vendor/ and test harnesses
// (which are executed, therefore already parsed) are out of scope.
const SCAN_DIRS = ['js', 'src', 'js/app', 'js/render'];
const ROOT_FILES = ['worker.js', 'serve.cjs', 'sw.js', 'build.js'];

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
for (const f of ROOT_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) files.push(p);
}

// De-duplicate: js/app and js/render are already under js/.
const seen = new Set();
const uniq = files.filter(f => {
  const rel = path.relative(ROOT, f);
  if (seen.has(rel)) return false;
  seen.add(rel);
  return true;
});

let failed = 0;
for (const f of uniq) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe', timeout: 30000 });
    results.push({ rel, ok: true });
  } catch (e) {
    failed++;
    const err = ((e.stderr && e.stderr.toString()) || e.message || '').trim().split('\n').slice(0, 4).join(' ');
    results.push({ rel, ok: false, err });
  }
}

for (const r of results) {
  log((r.ok ? '  PASS  ' : '  FAIL  ') + r.rel + (r.ok ? '' : '   <-- ' + r.err));
}
const pass = results.length - failed;
log('');
log('[verify-js-syntax] ' + pass + '/' + results.length + ' source scripts parse.');

if (failed) {
  log('');
  log('A source script does NOT parse - anything it powers is DEAD in the browser.');
  log('Common cause: an unquoted hyphenated object key (`my-key:` must be `\'my-key\':`).');
  log('Note: standalone pages (calculator.html -> js/calculator-page.js) are NOT');
  log('parsed by `node build.js`, which is exactly how a syntax error reaches users.');
  log('');
  log('JS SYNTAX FAIL (' + failed + ')');
  process.exit(1);
}
log('JS SYNTAX PASS');
process.exit(0);