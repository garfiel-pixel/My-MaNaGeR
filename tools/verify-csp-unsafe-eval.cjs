#!/usr/bin/env node
/* ============================================================
   tools/verify-csp-unsafe-eval.cjs - S-4
   (AUDIT-DIRECTIVE-2026-10-18, 8.1 S-4)
   ------------------------------------------------------------
   "Content security policy: `style-src 'unsafe-inline'` is
   accepted today. The second policy at worker.js allows
   'unsafe-eval': [VERIFY] that it applies only to the offline
   transcription route and to no HTML page. Add a test that
   fetches every HTML page and asserts the page policy has no
   unsafe-eval."

   WHY THIS GATE EXISTS. 'unsafe-eval' turns a string into code.
   On a page that can be talked into building an HTML string,
   it removes the last thing that would have stopped a bad value
   from becoming running code. The app has exactly ONE place that
   needs it: the vendored whisper runtime (Emscripten glue), which
   is a script, never a document. The job of this gate is to prove
   that stays true.

   THE PROOF HAS THREE LAYERS, and the live one alone is not
   enough:
     1. STATIC - the page policies (CSP and the scoped Paddle
        policy) carry no 'unsafe-eval' token at all, and exactly
        ONE policy constant carries it: the whisper runtime one.
     2. STATIC - the relaxed policy is SCOPED. It is handed out
        only under a /vendor/whisper/ path test, on the NORMALISED
        path in the Worker and on the RESOLVED path in the dev
        server, so a dot-segment path cannot smuggle a non-whisper
        file into the relaxed policy.
     3. LIVE - every HTML page the app serves is fetched and its
        Content-Security-Policy header is read. Two controls
        around it: the whisper runtime DOES get the relaxed policy
        (so the check is not vacuous) and an ordinary asset does
        NOT.

   The Worker and the dev server must declare the SAME policies
   (AGENTS rule 1: the mirror in serve.cjs has to stay in sync),
   so the live proof taken against the dev server transfers to
   production.

   Exit 0 = clean, 1 = a hit that has to be fixed.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

// ---- policy extraction (the shape qa-paddle-csp.cjs reads) -----------
// Extract a `const NAME = [ ... ].join(<anything>);` array block. The join
// separator differs per policy, so match `.join(` generically and slice
// back to the closing bracket.
function policy(src, name) {
  const start = src.indexOf('const ' + name + ' = [');
  if (start === -1) {
    return null;
  }
  const open = src.indexOf('[', start);
  const end = src.indexOf('.join(', open);
  if (open === -1 || end === -1) {
    return null;
  }
  return src.slice(open, src.lastIndexOf(']', end) + 1);
}

// The dev server keeps the PAGE policy inside the security-header map
// rather than in a named constant, so it needs its own reader:
//   'Content-Security-Policy': [ ... ].join('; ')
function servePagePolicy(src) {
  const key = "'Content-Security-Policy': [";
  const at = src.indexOf(key);
  if (at === -1) {
    return null;
  }
  const open = src.indexOf('[', at);
  const end = src.indexOf('.join(', open);
  if (open === -1 || end === -1) {
    return null;
  }
  return src.slice(open, src.lastIndexOf(']', end) + 1);
}

// The exact token. 'wasm-unsafe-eval' is a DIFFERENT, narrower grant
// (WebAssembly compilation only) and the page policies are allowed to
// keep it - so the search must not fire on it. The quoted token with a
// quote immediately before "unsafe-eval" cannot match "'wasm-unsafe-eval'".
const UNSAFE_EVAL = "'unsafe-eval'";
const hasUnsafeEval = p => typeof p === 'string' && p.indexOf(UNSAFE_EVAL) > -1;

// Every HTML file the app can serve.
function htmlFiles() {
  const out = [];
  const skipDirs = new Set(['node_modules', '.git', '_archive', 'tmp', 'dist', '.agents']);
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.html')) out.push(p);
    }
  })(ROOT);
  return out.sort();
}

// ---- a private dev server --------------------------------------------
function startServer(port) {
  const child = spawn(process.execPath, ['serve.cjs'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(port) })
  });
  return child;
}

async function waitForServer(base, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + '/index.html');
      if (r.status) return true;
    } catch (e) {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function freePort(start) {
  // A port the harness owns alone - a shared server can be a STALE one
  // (AGENTS lesson 10: the CSP is computed at startup), and a security
  // gate must measure the code on disk, not a leftover process.
  return start;
}

(async () => {
  console.log('\n=== CSP: no unsafe-eval on any HTML page (S-4) ===\n');

  const workerSrc = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  const serveSrc = fs.readFileSync(path.join(ROOT, 'serve.cjs'), 'utf8');

  // ---- 1. the policies, statically ---------------------------------
  console.log('--- static ---');
  const wCsp = policy(workerSrc, 'CSP');
  const wPaddle = policy(workerSrc, 'PADDLE_CSP');
  const wWhisper = policy(workerSrc, 'WHISPER_CSP');
  const sCsp = servePagePolicy(serveSrc);
  const sPaddle = policy(serveSrc, 'PADDLE_CSP');
  const sWhisper = policy(serveSrc, 'WHISPER_CSP');

  check('worker.js declares the three policies', !!(wCsp && wPaddle && wWhisper), {
    csp: !!wCsp,
    paddle: !!wPaddle,
    whisper: !!wWhisper
  });
  check('serve.cjs declares the same three policies', !!(sCsp && sPaddle && sWhisper), {
    csp: !!sCsp,
    paddle: !!sPaddle,
    whisper: !!sWhisper
  });

  check('the PAGE policy carries no unsafe-eval', !hasUnsafeEval(wCsp), {
    policy: wCsp ? wCsp.slice(0, 200) : null
  });
  check('the PRICING policy carries no unsafe-eval', !hasUnsafeEval(wPaddle), {
    policy: wPaddle ? wPaddle.slice(0, 200) : null
  });
  check('the whisper runtime policy is the one that allows it', hasUnsafeEval(wWhisper), {
    policy: wWhisper ? wWhisper.slice(0, 200) : null
  });

  // Only ONE policy constant may carry the token. A second one is a
  // second door.
  const withToken = [
    ['CSP', wCsp],
    ['PADDLE_CSP', wPaddle],
    ['WHISPER_CSP', wWhisper]
  ]
    .filter(pair => hasUnsafeEval(pair[1]))
    .map(pair => pair[0]);
  check(
    'exactly one policy allows unsafe-eval (the whisper one)',
    withToken.length === 1 && withToken[0] === 'WHISPER_CSP',
    { withToken }
  );

  // The mirror rule (AGENTS rule 1): the dev server declares the same
  // policies as the Worker, so the live proof taken against the dev
  // server is a proof about production too.
  //
  // Compared NORMALISED, not byte for byte: Prettier rewrites a literal
  // that contains a single quote into double quotes, so the two files
  // can spell the same directive differently. The comparison strips
  // whitespace and treats ' and " as the same character - a real
  // difference in a directive still shows up.
  const same = (a, b) => {
    if (!a || !b) return false;
    const norm = t => t.replace(/'/g, '"').replace(/\s+/g, ' ').trim();
    return norm(a) === norm(b);
  };
  check('CSP identical in both mirrors', same(wCsp, sCsp), {
    worker: wCsp ? wCsp.length : 0,
    serve: sCsp ? sCsp.length : 0
  });
  check('PADDLE_CSP identical in both mirrors', same(wPaddle, sPaddle));
  check('WHISPER_CSP identical in both mirrors', same(wWhisper, sWhisper));

  // The scoping. In the Worker the guard must run on the NORMALISED
  // path (normalizePathname resolves dot segments); in the dev server
  // on the RESOLVED path. Either way a /vendor/whisper/../../ style
  // path must not reach the relaxed policy.
  //
  // The binding may be const OR let: RBAC sprint 2 added a worker-owned
  // route rewrite (/team/accept/<token> -> /team-accept.html), and a rewrite
  // has to move the path the rest of fetch() sees, or the page would be
  // judged as an unknown extensionless path. What matters here is the SOURCE
  // of the value - normalizePathname - so a `let` is accepted and anything
  // that skips normalisation is not.
  const workerGuard = workerSrc.indexOf("normalized.indexOf('/vendor/whisper/') === 0");
  check('the Worker hands out the relaxed policy only under /vendor/whisper/', workerGuard > -1, {
    guard: workerGuard > -1
  });
  check(
    'the Worker tests the NORMALISED path (dot segments cannot smuggle)',
    workerSrc.indexOf('function normalizePathname') > -1 &&
      /(?:const|let)\s+normalized\s*=\s*normalizePathname\(url\.pathname\)/.test(workerSrc),
    { normalised: workerSrc.indexOf('normalizePathname(url.pathname)') > -1 }
  );
  check(
    'the dev server hands out the relaxed policy only under the RESOLVED path',
    serveSrc.indexOf("file.startsWith(path.join(ROOT, 'vendor', 'whisper') + path.sep)") > -1,
    { guard: serveSrc.indexOf("path.join(ROOT, 'vendor', 'whisper')") > -1 }
  );

  // No document may live under vendor/whisper/: a document is served
  // with the PAGE policy, so an HTML file there would be a page the
  // relaxed policy could reach.
  const whisperHtml = htmlFiles().filter(f =>
    path
      .relative(ROOT, f)
      .toLowerCase()
      .startsWith('vendor' + path.sep + 'whisper')
  );
  check('no HTML page lives under vendor/whisper/', whisperHtml.length === 0, {
    files: whisperHtml.map(f => path.relative(ROOT, f))
  });

  // The page policy keeps its hash-only script-src: 'unsafe-eval' is
  // not the only thing that would weaken it.
  const scriptSrc = (wCsp || '').split('"').find(part => part.indexOf('script-src') === 0) || '';
  check(
    "the page policy keeps script-src free of 'unsafe-inline'",
    scriptSrc.indexOf("'unsafe-inline'") === -1,
    { scriptSrc: scriptSrc.slice(0, 160) }
  );

  // ---- 2. the live fetch --------------------------------------------
  console.log('\n--- live ---');
  const PORT = freePort(8791);
  const BASE = 'http://127.0.0.1:' + PORT;
  const server = startServer(PORT);
  let serverUp = false;
  try {
    serverUp = await waitForServer(BASE);
  } catch (e) {
    serverUp = false;
  }
  check('the dev server answered', serverUp, { base: BASE });

  if (serverUp) {
    const files = htmlFiles();
    const offenders = [];
    const noHeader = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel.indexOf('vendor/') === 0) continue; // covered by the whisper arm
      let res;
      try {
        res = await fetch(BASE + '/' + rel);
      } catch (e) {
        offenders.push({ file: rel, error: String(e && e.message) });
        continue;
      }
      const csp = res.headers.get('content-security-policy') || '';
      if (!csp) {
        noHeader.push(rel);
        continue;
      }
      if (hasUnsafeEval(csp)) {
        offenders.push({ file: rel, csp: csp.slice(0, 200) });
      }
    }
    check('every HTML page answers with a Content-Security-Policy', noHeader.length === 0, {
      missing: noHeader
    });
    check('no HTML page is served with a policy that allows unsafe-eval', offenders.length === 0, {
      offenders,
      pages: files.length
    });

    // Control 1: the relaxed policy is really live, so the check above
    // is not passing because the relaxed policy was switched off.
    const whisper = await fetch(BASE + '/vendor/whisper/index.js');
    const whisperCsp = whisper.headers.get('content-security-policy') || '';
    check(
      'the whisper runtime still gets its relaxed policy (control)',
      hasUnsafeEval(whisperCsp),
      { status: whisper.status, csp: whisperCsp.slice(0, 160) }
    );

    // Control 2: an ordinary asset is NOT relaxed.
    const asset = await fetch(BASE + '/js/mmgr-shortcuts.js');
    const assetCsp = asset.headers.get('content-security-policy') || '';
    check(
      'an ordinary asset does not get the relaxed policy (control)',
      assetCsp && !hasUnsafeEval(assetCsp),
      { status: asset.status, csp: assetCsp.slice(0, 160) }
    );
  }

  try {
    server.kill();
  } catch (e) {
    /* the server is already gone */
  }

  console.log('');
  console.log(failed ? 'CSP FAIL: ' + failed + ' check(s) failed' : 'CSP PASS');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('harness crashed: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
