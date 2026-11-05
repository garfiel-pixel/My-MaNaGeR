/* ============================================================
   SEC-06 - connect-src gate (AUDIT-DIRECTIVE-2026-11-01, wave 4.3)
   ------------------------------------------------------------
   `connect-src 'self' https: ...` is an exfiltration channel: a bare scheme
   source lets any injected script POST to any TLS host, which makes every
   other XSS control cheaper to defeat. This gate proves the replacement is
   real, not aspirational.

   ARM 1  the REPORT-ONLY policy a document actually receives carries the
          explicit candidate and NO bare scheme source.
   ARM 2  every origin in that candidate is referenced by code (no dead
          allow-list entry), with ONE documented exemption: the Cloudflare
          Web Analytics beacon target, which the edge injects and this repo
          therefore never names.
   ARM 3  the promotion switch works: with CSP_CONNECT_ENFORCE=1 the ENFORCED
          header carries the candidate too, and the bare `https:` is gone.
   ARM 4  the rollback switch works: CSP_REPORT_ONLY=off removes the
          report-only header entirely.
   ARM 5  the sink exists and is wired: /api/csp-report answers 204, is
          body-capped, and never echoes the report back.

   Drives the real worker.js export with a mocked ASSETS binding. No server.
   Usage: node tools/verify-csp-connect.cjs
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const results = [];
const log = s => process.stdout.write('[csp-connect] ' + s + '\n');
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS ' : 'FAIL ') +
      name +
      (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail))
  );
};

// The only origin allowed to sit in connect-src without a literal reference in
// this repo: Cloudflare injects the Web Analytics beacon at the edge and the
// beacon POSTs to this host. There is no source line to point at, by design.
const BEACON_HOSTS = ['https://cloudflareinsights.com'];

// A scheme source with no host: 'https:', 'http:', 'ws:', '*', 'data:'. The
// first three are the dangerous ones; '*' would allow everything.
const BARE_SCHEME = /(^|\s)(https?:|\*|wss?:)(?=\s|$)/;

function directives(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach(part => {
      const p = part.trim();
      if (!p) {
        return;
      }
      const i = p.indexOf(' ');
      if (i < 0) {
        out[p.toLowerCase()] = '';
      } else {
        out[p.slice(0, i).toLowerCase()] = p.slice(i + 1).trim();
      }
    });
  return out;
}

(async () => {
  // ---- import the worker with a mocked asset layer -------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgr-csp-'));
  const mjs = path.join(dir, 'worker.mjs');
  fs.copyFileSync(path.join(ROOT, 'worker.js'), mjs);
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  const mod = await import(pathToFileURL(mjs).href);

  const htmlEnv = extra =>
    Object.assign(
      {
        ASSETS: {
          fetch: async function () {
            return new Response('<html><body>page</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }
        }
      },
      extra || {}
    );

  const getPage = async extra => {
    const res = await mod.default.fetch(
      new Request('https://app.example/index.html'),
      htmlEnv(extra)
    );
    return {
      status: res.status,
      enforced: res.headers.get('Content-Security-Policy') || '',
      reportOnly: res.headers.get('Content-Security-Policy-Report-Only') || ''
    };
  };

  // ---- ARM 1: the report-only policy --------------------------------------
  const ro = await getPage();
  const roDir = directives(ro.reportOnly);
  const roConnect = roDir['connect-src'] || '';
  check('ARM 1 a document receives Content-Security-Policy-Report-Only', !!ro.reportOnly, {
    status: ro.status
  });
  check(
    "ARM 1 the report-only connect-src carries no bare scheme source ('https:', '*')",
    !!roConnect && !BARE_SCHEME.test(roConnect),
    { connectSrc: roConnect }
  );
  check(
    'ARM 1 the report-only policy still names every non-connect directive of the enforced one',
    Object.keys(directives(ro.enforced)).every(k => {
      if (k === 'connect-src') {
        return true;
      }
      return roDir[k] === directives(ro.enforced)[k];
    }),
    { enforcedKeys: Object.keys(directives(ro.enforced)), roKeys: Object.keys(roDir) }
  );
  check(
    'ARM 1 the report-only policy points at the sink',
    (roDir['report-uri'] || '') === '/api/csp-report',
    { reportUri: roDir['report-uri'] }
  );
  check(
    'ARM 1 upgrade-insecure-requests is observed (report-only), not enforced',
    Object.prototype.hasOwnProperty.call(roDir, 'upgrade-insecure-requests') &&
      !/upgrade-insecure-requests/.test(ro.enforced),
    { enforced: ro.enforced.slice(0, 80) }
  );
  check(
    'ARM 1 require-trusted-types-for is NOT switched on by default (it reports on every innerHTML write)',
    !/require-trusted-types-for/.test(ro.reportOnly),
    { reportOnly: ro.reportOnly.slice(0, 120) }
  );

  // ---- ARM 2: no dead allow-list entries ----------------------------------
  const origins = roConnect
    .split(/\s+/)
    .filter(s => s && s !== "'self'" && s !== 'blob:' && s !== 'data:');
  const corpus = [];
  const walk = rel => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      return;
    }
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      fs.readdirSync(full).forEach(name => walk(path.join(rel, name)));
      return;
    }
    if (/\.(js|mjs|html)$/i.test(rel)) {
      corpus.push(fs.readFileSync(full, 'utf8'));
    }
  };
  ['js', 'src'].forEach(walk);
  // worker.js minus the candidate block itself, so an entry cannot vouch for
  // itself merely by being listed.
  const workerSrc = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  const candStart = workerSrc.indexOf('const CONNECT_SRC_CANDIDATE');
  const candEnd = workerSrc.indexOf('].join', candStart);
  const workerMinusCandidate =
    candStart < 0 ? workerSrc : workerSrc.slice(0, candStart) + workerSrc.slice(candEnd);
  const haystack = corpus.join('\n') + '\n' + workerMinusCandidate;

  const dead = origins.filter(o => BEACON_HOSTS.indexOf(o) === -1 && haystack.indexOf(o) === -1);
  check(
    'ARM 2 every connect-src origin is referenced by code (no dead entries)',
    dead.length === 0,
    {
      dead,
      origins
    }
  );
  check('ARM 2 the candidate is a real allow-list, not a placeholder', origins.length >= 8, {
    count: origins.length
  });

  // ---- ARM 3: the promotion switch ---------------------------------------
  const promoted = await getPage({ CSP_CONNECT_ENFORCE: '1' });
  const promotedConnect = directives(promoted.enforced)['connect-src'] || '';
  check(
    'ARM 3 CSP_CONNECT_ENFORCE=1 swaps the ENFORCED connect-src to the candidate',
    promotedConnect === roConnect,
    { enforcedConnect: promotedConnect, candidate: roConnect }
  );
  check(
    'ARM 3 the promoted policy carries no bare scheme source',
    !!promotedConnect && !BARE_SCHEME.test(promotedConnect),
    { enforcedConnect: promotedConnect }
  );

  // ---- ARM 4: the rollback switch ----------------------------------------
  const rolledBack = await getPage({ CSP_REPORT_ONLY: 'off' });
  check(
    'ARM 4 CSP_REPORT_ONLY=off removes the report-only header (one-flag rollback)',
    rolledBack.reportOnly === '',
    { reportOnly: rolledBack.reportOnly.slice(0, 60) }
  );
  check('ARM 4 ...and leaves the enforced policy untouched', rolledBack.enforced === ro.enforced, {
    same: rolledBack.enforced === ro.enforced
  });

  // ---- ARM 5: the sink ----------------------------------------------------
  const sinkEnv = htmlEnv();
  const good = await mod.default.fetch(
    new Request('https://app.example/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report', Origin: 'https://app.example' },
      body: JSON.stringify({
        'csp-report': {
          'document-uri': 'https://app.example/index.html',
          'violated-directive': 'connect-src',
          'blocked-uri': 'https://tracker.example/x'
        }
      })
    }),
    sinkEnv
  );
  const sinkText = await good.text();
  check('ARM 5 /api/csp-report accepts a legacy csp-report body with 204', good.status === 204, {
    status: good.status
  });
  check(
    'ARM 5 the sink never echoes the report back',
    sinkText === '' && (good.headers.get('Content-Type') || '') === '',
    { body: sinkText.slice(0, 80), type: good.headers.get('Content-Type') }
  );
  const big = await mod.default.fetch(
    new Request('https://app.example/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report', Origin: 'https://app.example' },
      body: JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(20000) } })
    }),
    sinkEnv
  );
  check('ARM 5 an oversized report body is capped (413), never parsed', big.status === 413, {
    status: big.status
  });
  const malformed = await mod.default.fetch(
    new Request('https://app.example/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report', Origin: 'https://app.example' },
      body: 'not json'
    }),
    sinkEnv
  );
  check(
    'ARM 5 a malformed report still answers 204 (a browser must not see an error)',
    malformed.status === 204,
    {
      status: malformed.status
    }
  );
  const crossOrigin = await mod.default.fetch(
    new Request('https://app.example/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report', Origin: 'https://elsewhere.example' },
      body: '{}'
    }),
    sinkEnv
  );
  check('ARM 5 the sink sits behind the same-origin gate', crossOrigin.status === 403, {
    status: crossOrigin.status
  });

  const passed = results.filter(r => r.val).length;
  log('');
  log(
    passed === results.length
      ? 'ALL GREEN - ' + passed + '/' + results.length
      : 'FAILURES - ' + (results.length - passed) + '/' + results.length + ' failed'
  );
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => {
  log('CRASH ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
