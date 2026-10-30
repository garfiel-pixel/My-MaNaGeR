#!/usr/bin/env node
/* ============================================================
   tools/verify-ci-coverage.cjs
   GATE: D-4 - the CI split moved every step, and dropped none
   ------------------------------------------------------------
   WHY THIS EXISTS (UI-CI-DIRECTIVE section D4.3)
   `verify-test-registry.cjs` proves every harness is REGISTERED. It cannot
   prove a registered harness is still EXECUTED: a step can vanish from
   `.github/workflows/ci.yml` while its registry row keeps saying "CI", and
   every other gate stays green. That is the silent-drop failure AGENTS.md
   section 14 is about, one level up.

   This script compares the split workflow with the single-job one it replaced:

     1. the multiset of `run:` command strings is UNCHANGED, after removing
        only the per-job setup lines (checkout/setup-node/install/build, the
        duplicated server start/stop scripts, the job-summary echoes) and the
        retired single CI Summary block, which the summary job replaces;
     2. every `if:` that reads `steps.<id>.outcome` names an id defined in the
        SAME job (a reference into another job is empty, and the step silently
        skips while its job stays green);
     3. every step name that contains `T4:` still exists, with the same count;
     4. the five worker jobs plus a `summary` job exist, and `summary` needs
        all five and runs with `if: always()`.

   Usage:  node tools/verify-ci-coverage.cjs [base-ref]
           default base-ref: BASE_REF env, else origin/main, else main
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (static job).
   ============================================================ */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NEW_FILE = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const JOB_NAMES = ['static', 'cloud-core', 'cloud-auth', 'browser-calc', 'browser-app'];
const results = [];
const log = s => process.stdout.write('[ci-coverage] ' + s + '\n');
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 4000))
  );
};

function loadYaml() {
  try {
    return require('yaml');
  } catch (e) {
    const alt = path.join(ROOT, 'node_modules', 'yaml');
    if (fs.existsSync(alt)) {
      return require(alt);
    }
    throw new Error('the yaml devDependency is missing: npm install --save-dev yaml');
  }
}

function baseRef() {
  if (process.env.BASE_REF) {
    return process.env.BASE_REF;
  }
  for (const ref of ['origin/main', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', ref + '^{commit}'], {
        cwd: ROOT,
        stdio: 'ignore'
      });
      return ref;
    } catch (e) {
      /* try the next */
    }
  }
  return '';
}

/* `run:` command strings for one parsed workflow, normalised so a re-indented
   block still matches. Step names starting with CI Summary / Job summary are
   excluded: that is the retired block and its replacement. */
function collect(doc) {
  const runs = [];
  const t4 = [];
  const idsPerJob = {};
  const refs = [];
  const jobs = (doc && doc.jobs) || {};
  for (const [jobName, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job && job.steps) ? job.steps : [];
    const ids = new Set();
    for (const st of steps) {
      if (st && typeof st.id === 'string') {
        ids.add(st.id);
      }
    }
    idsPerJob[jobName] = ids;
    for (const st of steps) {
      const name = (st && st.name) || '';
      if (name === 'CI Summary' || name.indexOf('Job summary (') === 0) {
        continue;
      }
      if (typeof st.run === 'string') {
        runs.push(
          st.run
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(l => l.replace(/\s+$/, ''))
            .join('\n')
            .trim()
        );
      }
      if (/^T4:/.test(name)) {
        t4.push(name);
      }
      if (typeof st.if === 'string' && /steps\.[A-Za-z0-9_-]+\.outcome/.test(st.if)) {
        const m = st.if.match(/steps\.([A-Za-z0-9_-]+)\.outcome/g) || [];
        for (const hit of m) {
          refs.push({ job: jobName, ref: hit.slice(6, -8), step: name });
        }
      }
    }
  }
  return { runs, t4, idsPerJob, refs, jobs: Object.keys(jobs) };
}

/* Run strings that legitimately multiply per job: the setup block and the
   server start/stop scripts. Anything else appearing more often is a
   duplicate step, not a per-job setup line. */
const SETUP_PREFIXES = [
  'npm install --ignore-scripts --no-audit --no-fund',
  'npm run build',
  'node serve.cjs > /tmp/serve-static.log',
  'npm install --no-save --ignore-scripts playwright',
  'node tools/install-test-deps.cjs',
  // The shared :8787 wrangler has to exist in BOTH jobs that read it (one
  // starts at the top, one restarts it for controls admin), and each browser
  // job starts and stops its own serve.cjs.
  'rm -rf .wrangler/',
  'echo "--- Final wrangler log ---"',
  'pkill -f "node serve.cjs" || true'
];
// The T4: steps that are per-job environment setup, not test steps.
const T4_SETUP_NAMES = [
  'T4: Start static QA server (serve.cjs)',
  'T4: Install test deps (playwright devDep)',
  'T4: Stop static QA server'
];
function isSetupRun(s) {
  return SETUP_PREFIXES.some(p => s.indexOf(p) === 0);
}

function multiset(list) {
  const m = new Map();
  for (const s of list) {
    m.set(s, (m.get(s) || 0) + 1);
  }
  return m;
}

(async () => {
  const YAML = loadYaml();
  const NEW = YAML.parse(fs.readFileSync(NEW_FILE, 'utf8'));

  const ref = baseRef();
  let OLD = null;
  if (ref) {
    try {
      const raw = execFileSync('git', ['show', ref + ':.github/workflows/ci.yml'], {
        cwd: ROOT,
        encoding: 'utf8'
      });
      OLD = YAML.parse(raw);
    } catch (e) {
      OLD = null;
    }
  }
  check(
    'the base workflow is readable from git (' + (ref || 'no ref found') + ')',
    !!OLD,
    ref ? 'git show ' + ref + ':.github/workflows/ci.yml failed' : 'no base ref'
  );

  log('jobs: ' + JSON.stringify(collect(NEW).jobs));
  for (const name of JOB_NAMES.concat(['summary'])) {
    check('job "' + name + '" exists', !!(NEW.jobs && NEW.jobs[name]), collect(NEW).jobs);
  }
  const summary = (NEW.jobs && NEW.jobs.summary) || null;
  check(
    'the summary job needs all five worker jobs and runs always()',
    !!summary &&
      Array.isArray(summary.needs) &&
      JOB_NAMES.every(n => summary.needs.indexOf(n) > -1) &&
      summary.needs.length === JOB_NAMES.length &&
      summary.if === 'always()',
    summary && { needs: summary.needs, if: summary.if }
  );

  const n = collect(NEW);
  if (OLD) {
    const o = collect(OLD);
    const om = multiset(o.runs);
    const nm = multiset(n.runs);
    const dropped = [];
    const extra = [];
    for (const [cmd, count] of om) {
      const got = nm.get(cmd) || 0;
      if (got < count) {
        dropped.push({ command: cmd.split('\n')[0].slice(0, 120), want: count, got });
      }
    }
    for (const [cmd, count] of nm) {
      const want = om.get(cmd) || 0;
      // want === 0 is a NEW step (the coverage gate itself). A pre-existing
      // command that now appears more often is the duplication to catch.
      if (want > 0 && count > want && !isSetupRun(cmd)) {
        extra.push({ command: cmd.split('\n')[0].slice(0, 120), want, got: count });
      }
    }
    check('no run: step was dropped or changed by the split', dropped.length === 0, dropped);
    check('no run: step was duplicated outside the per-job setup lines', extra.length === 0, extra);
    log('old run blocks: ' + o.runs.length + ', new run blocks: ' + n.runs.length);
    const t4Missing = o.t4.filter(x => n.t4.indexOf(x) === -1);
    const t4Extra = n.t4.filter(x => o.t4.indexOf(x) === -1 && T4_SETUP_NAMES.indexOf(x) === -1);
    check(
      'every T4: step survived, and only the per-job server steps repeated',
      o.t4.length > 0 && t4Missing.length === 0 && t4Extra.length === 0,
      { old: o.t4.length, now: n.t4.length, missing: t4Missing, unexpected: t4Extra }
    );
  }

  const badRefs = n.refs.filter(r => !(n.idsPerJob[r.job] && n.idsPerJob[r.job].has(r.ref)));
  check(
    'every steps.<id>.outcome reads an id defined in the same job',
    badRefs.length === 0,
    badRefs
  );

  const failed = results.filter(r => !r.ok);
  log('');
  log(
    (failed.length ? 'FAIL' : 'PASS') +
      ' - ' +
      (results.length - failed.length) +
      '/' +
      results.length +
      ' gates'
  );
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  log('PROBE-ERROR: ' + (e && e.message));
  process.exit(1);
});
