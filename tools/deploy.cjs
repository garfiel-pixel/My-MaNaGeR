/* ============================================================
   My MaNaGeR — cross-platform deploy staging
   ------------------------------------------------------------
   WHY THIS FILE EXISTS (incident 2026-09-22):
   `npm run deploy` used to be a bash one-liner built around
   "$HOME/mmgr-deploy". npm runs package.json scripts through cmd.exe on
   Windows, where $HOME is NOT a variable - so the string stayed literal and
   the script staged into `./$HOME/mmgr-deploy` INSIDE the repo, tarred the
   repo into a copy of itself, npm-installed 231 MB of node_modules into the
   working tree, and deployed from that directory. It "worked" (the staged
   copy still held the right files), which is exactly what made it dangerous:
   no error, no warning, just a deploy from a path nobody wrote.

   Paths in node cannot silently become literal, so the whole recipe lives
   here instead. Same stages as the documented one:

     1. rebuild the bundles (dist/, the minified CSS)
     2. run the static gates (npm run verify)
     3. stage a clean copy into os.homedir()/mmgr-deploy, with the same
        excludes the tar recipe used - never /tmp (AGENTS.md lesson 7: bash's
        /tmp and Windows' C:\tmp are different places) and never the repo root
        (wrangler uploads EVERYTHING - it does not honour .gitignore)
     4. PROVE the staged copy carries the current bytes before shipping
        (byte-compare, not a grep - lesson 7's "verify the staged copy")
     5. deploy from the staged config

   Usage:
     node tools/deploy.cjs               # build + verify + stage + deploy
     node tools/deploy.cjs --stage-only  # everything except the deploy
     STAGE_DIR=/some/path node tools/deploy.cjs   # override the stage path
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGE_ONLY = process.argv.includes('--stage-only');
const STAGE = path.resolve(process.env.STAGE_DIR || path.join(os.homedir(), 'mmgr-deploy'));

const fail = (msg) => { console.error('\nDEPLOY ABORTED: ' + msg); process.exit(1); };
const step = (msg) => console.log('\n== ' + msg);

// ---- Stage-path safety ------------------------------------------------
// Both of these were real failure modes, not hypotheticals: a literal "$HOME"
// (cmd.exe) and a stage inside the repo (wrangler uploads every file under the
// assets directory).
if (/[$%]/.test(STAGE)) fail('stage path contains an unexpanded variable: ' + STAGE);
if (STAGE === ROOT || STAGE.startsWith(ROOT + path.sep)) {
  fail('stage path is inside the repo (' + STAGE + ') - wrangler would upload it');
}

// ---- Excludes: mirror the tar recipe exactly --------------------------
const SKIP_DIRS = new Set([
  '.git', '.wrangler', 'node_modules', '.agents', '_archive', 'tmp',
  'screenshots', 'web-research', 'dogfood-output'
]);
const SKIP_FILE_RE = [
  /^\.dev\.vars/, /^\.gitattributes$/, /^\.gitignore$/, /\.md$/i, /\.json$/i,
  /^Freebuff/i, /^Windows PowerShell/i, /^crashes from last session\.txt$/i,
  /favicon/i, /^\.claude$/i, /^\.codebuff$/i
];
// Copied back after the sweep (the tar recipe did the same): the config the
// deploy actually needs, which the *.json / *.md excludes would otherwise drop.
const COPY_BACK = ['package.json', 'wrangler.jsonc'];

// Files whose staged bytes must match the working tree before shipping.
const MUST_MATCH = [
  'index.html', 'app.html', 'project.html', 'admin.html', 'dashboard.html',
  'sw.js', 'manifest.webmanifest', 'css/mmgr.css', 'dist/mmgr.min.css',
  'dist/bundle.js', 'dist/app-bundle.js', 'worker.js'
];

// Two call shapes: run(bin, [args]) spawns directly; run('full command line')
// goes through the shell (needed for npm.cmd on Windows). The shell form takes
// NO args array - passing args together with shell:true triggers Node's
// DEP0190 warning, which would be noise on every deploy.
function run(cmd, args, opts) {
  const useShell = !Array.isArray(args);
  const r = spawnSync(cmd, useShell ? undefined : args, Object.assign({ stdio: 'inherit', shell: useShell }, opts || {}));
  if (r.error) fail(cmd + ' failed to start: ' + r.error.message);
  if (r.status !== 0) fail(cmd + ' exited ' + r.status);
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      copyTree(from, to);
    } else if (entry.isFile()) {
      if (SKIP_FILE_RE.some((re) => re.test(entry.name))) continue;
      fs.copyFileSync(from, to);
    }
  }
}

function sameBytes(a, b) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

// ---- 1. build ---------------------------------------------------------
step('Building bundles');
run(process.execPath, [path.join(ROOT, 'build.js')], { cwd: ROOT });

// ---- 2. static gates --------------------------------------------------
step('Static gates (npm run verify)');
run('npm run verify', null, { cwd: ROOT });

// ---- 3. stage ---------------------------------------------------------
step('Staging a clean copy');
if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
copyTree(ROOT, STAGE);
for (const f of COPY_BACK) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) fail('missing ' + f);
  fs.copyFileSync(src, path.join(STAGE, f));
}
const staged = fs.readdirSync(STAGE).length;
console.log('   staged ' + staged + ' entries into ' + STAGE);
if (fs.existsSync(path.join(STAGE, '.git'))) fail('.git was staged - the excludes are wrong');
if (fs.existsSync(path.join(STAGE, 'node_modules'))) fail('node_modules was staged - the excludes are wrong');

// ---- 4. prove the staged copy is the current code ---------------------
step('Verifying the staged copy carries the current bytes');
let stale = 0;
for (const rel of MUST_MATCH) {
  const a = path.join(ROOT, rel);
  const b = path.join(STAGE, rel);
  if (!fs.existsSync(a)) { console.log('   (not present in the repo) ' + rel); continue; }
  if (!sameBytes(a, b)) { console.log('   STALE  ' + rel); stale++; }
}
if (stale) fail(stale + ' staged file(s) differ from the working tree - refusing to deploy stale code');
console.log('   all ' + MUST_MATCH.length + ' tracked deploy files byte-identical');

// ---- 5. deploy --------------------------------------------------------
if (STAGE_ONLY) {
  console.log('\n--stage-only: skipping `wrangler deploy`. Stage verified at ' + STAGE);
  process.exit(0);
}
step('Deploying from ' + STAGE);
const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!fs.existsSync(wrangler)) fail('wrangler not found at ' + wrangler + ' - run npm install');
run(process.execPath, [wrangler, 'deploy'], { cwd: STAGE });
console.log('\nDeploy finished. Stage kept at ' + STAGE + ' (outside the repo).');
