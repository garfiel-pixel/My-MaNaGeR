#!/usr/bin/env node
/* ============================================================
   tools/verify-observability-redaction.cjs - S-3
   (AUDIT-DIRECTIVE-2026-10-18, 8.1 S-3)
   ------------------------------------------------------------
   "Observability cost and privacy."

   Two halves, one file:

   1. THE CONFIG. Every request used to be recorded, the AI relay
      and the auth routes included. Now: traces at 10%, invocation
      logs off (the installed wrangler only offers a boolean, and
      "off" is the stricter reading of the directive), the query
      string redacted, and ERRORS left at 1 - a sampled-away error
      is an error nobody can diagnose.

   2. THE REDACTION. No log line may carry an Authorization header,
      a Cookie, an idToken, a session token or an API key. The
      scrubber lives in src/lib/observe.js and this gate drives the
      REAL function: it captures what structuredLog() actually
      writes and asserts the secret is not in it.

   It also reads the source: a log line that NAMES a credential is a
   bug even when the scrubber would catch it, because the scrubber
   is the last line of defence and the caller is the first.

   Exit 0 = clean, 1 = a hit that has to be fixed.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log(
      '  FAIL  ' +
        name +
        '  <-- ' +
        JSON.stringify(detail === undefined ? null : detail).slice(0, 600)
    );
  }
};

// ---- a small JSONC reader (the config carries // comments) -------------
function stripJsonComments(text) {
  let out = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] === undefined ? '' : text[i + 1];
        i++;
      } else if (c === quote) {
        inStr = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, out);
    } else if (p.endsWith('.js') || p.endsWith('.mjs')) {
      out.push(p);
    }
  }
  return out;
}

// The source lines that actually write to the log tail.
function codeLines(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const withoutBlocks = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return withoutBlocks.split(/\r?\n/).map(l => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*')) return '';
    return l;
  });
}

(async () => {
  console.log('\n=== OBSERVABILITY: sampling + redaction (S-3) ===\n');

  // ---- 1. the config -------------------------------------------------
  const cfgPath = path.join(ROOT, 'wrangler.jsonc');
  const cfg = JSON.parse(stripJsonComments(fs.readFileSync(cfgPath, 'utf8')));
  const obs = cfg.observability || {};
  const logs = obs.logs || {};
  const traces = obs.traces || {};

  check('observability is enabled', obs.enabled === true, { enabled: obs.enabled });
  check(
    'traces are sampled at 10% or less',
    typeof traces.head_sampling_rate === 'number' && traces.head_sampling_rate <= 0.1,
    { traces: traces.head_sampling_rate }
  );
  check('errors stay at 1 (the log sampling rate is not below 1)', logs.head_sampling_rate === 1, {
    logs: logs.head_sampling_rate
  });
  check('no record of every request (invocation logs are off)', logs.invocation_logs === false, {
    invocation_logs: logs.invocation_logs
  });
  check(
    'the query string is redacted (a URL can carry a token)',
    obs.redact_query_string === true,
    { redact_query_string: obs.redact_query_string }
  );

  // ---- 2. the redaction, driven through the real log path ------------
  const observe = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'observe.js')).href);
  check('observe.js exports the scrubber', typeof observe.redactSensitive === 'function', {
    has: typeof observe.redactSensitive
  });

  const captured = [];
  const realLog = console.log;
  const realWarn = console.warn;
  const realError = console.error;
  const capture =
    (sink, level) =>
    (...args) => {
      captured.push({
        level,
        line: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
      });
    };
  console.log = capture(captured, 'log');
  console.warn = capture(captured, 'warn');
  console.error = capture(captured, 'error');

  const SECRETS = {
    authHeader: 'Bearer ZZZsecretheaderZZZ',
    cookieValue: 'mmgr_session=QQQsessioncookieQQQ; Path=/',
    idToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.RRRsignatureRRR',
    sessionToken: 'SSSsessiontokenSSS',
    apiKey: 'sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  };

  observe.structuredLog({}, 'info', 'redaction-probe', {
    authorization: SECRETS.authHeader,
    cookie: SECRETS.cookieValue,
    idToken: SECRETS.idToken,
    sessionToken: SECRETS.sessionToken,
    apiKey: SECRETS.apiKey,
    // The same secrets under innocent keys - a value that LOOKS like a
    // credential must go too, not only a key that NAMES one.
    note: 'call with ' + SECRETS.authHeader,
    headers: { Authorization: SECRETS.authHeader, Cookie: SECRETS.cookieValue },
    // Useful context must survive untouched.
    projectId: 'demo-project',
    bytes: 4096
  });
  observe.trackError(
    { ANALYTICS: null },
    'redaction-probe-error',
    new Error('upstream refused ' + SECRETS.authHeader),
    { projectId: 'demo-project' }
  );
  console.log = realLog;
  console.warn = realWarn;
  console.error = realError;

  const allLines = captured.map(c => c.line).join('\n');
  const leaks = [];
  for (const [label, value] of Object.entries(SECRETS)) {
    if (allLines.indexOf(value) > -1) {
      leaks.push(label);
    }
    // The pieces of a credential matter too: a header without its scheme
    // is still a credential.
    const bare = value
      .replace(/^Bearer /, '')
      .split('=')
      .pop();
    if (bare.length > 12 && allLines.indexOf(bare) > -1) {
      leaks.push(label + ' (bare)');
    }
  }
  check('no secret value reached the log tail', leaks.length === 0, { leaks, allLines });

  const lastLine = captured.length ? captured[captured.length - 1].line : '';
  // The probe logs twice: once as info (with the innocent context) and
  // once as an error. Each line is checked against ITS OWN payload -
  // the info line must keep projectId + bytes, the error line must
  // keep the project it failed for.
  const infoLine =
    (captured.find(c => c.line.indexOf('"event":"redaction-probe"') > -1) || {}).line || '';
  const errorLine = lastLine;
  check('the redaction marker is where the secret was', errorLine.indexOf('[redacted]') > -1, {
    lastLine: errorLine.slice(0, 200)
  });
  check(
    'useful context survives the scrubber',
    infoLine.indexOf('demo-project') > -1 && infoLine.indexOf('4096') > -1,
    { infoLine: infoLine.slice(0, 200) }
  );
  check(
    'the error line keeps its context (only the secret is cut)',
    errorLine.indexOf('demo-project') > -1,
    { lastLine: errorLine.slice(0, 200) }
  );
  check(
    'the fixed fields win (a payload cannot rename the event)',
    errorLine.indexOf('"event":"redaction-probe-error"') > -1,
    { lastLine: errorLine.slice(0, 200) }
  );

  // ---- 3. the source does not log a credential -----------------------
  const files = walk(path.join(ROOT, 'src'), []).concat([path.join(ROOT, 'worker.js')]);
  const CREDENTIAL_WORD =
    /authorization|cookie|id[-_]?token|session[-_]?token|api[-_]?key|apikey|\bsecret\b|password|bearer/i;
  const LOG_CALL =
    /console\.(log|warn|error)\s*\(|structuredLog\s*\(|trackEvent\s*\(|trackError\s*\(/;
  const hits = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    // observe.js is the scrubber itself: it NAMES these words on purpose.
    if (rel === path.join('src', 'lib', 'observe.js')) continue;
    codeLines(file).forEach((line, i) => {
      if (!LOG_CALL.test(line)) return;
      if (CREDENTIAL_WORD.test(line)) {
        hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) });
      }
      if (/\.headers\b/.test(line)) {
        hits.push({
          file: rel,
          line: i + 1,
          text: 'logs a request header: ' + line.trim().slice(0, 140)
        });
      }
    });
  }
  check('no source line logs a credential or a request header', hits.length === 0, { hits });

  // ---- 4. the scrubber itself is still there -------------------------
  const observeSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'observe.js'), 'utf8');
  check(
    'the scrubber is wired into the log path',
    observeSrc.indexOf('redactSensitive(data || {})') > -1,
    { wired: observeSrc.indexOf('redactSensitive(data || {})') > -1 }
  );

  console.log('');
  console.log(failed ? 'OBSERVABILITY FAIL: ' + failed + ' check(s) failed' : 'OBSERVABILITY PASS');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('harness crashed: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
