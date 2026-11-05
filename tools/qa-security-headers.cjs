/* ============================================================
   SECURITY HEADERS - seven surfaces (AUDIT-DIRECTIVE-2026-11-01, wave 4.4)
   ------------------------------------------------------------
   The headers in worker.js HEADERS are only worth what the response actually
   carries. This harness drives the real worker.js export over the seven
   shapes the app serves and reads the headers back:

     1  marketing document   /index.html        text/html
     2  app document         /project.html      text/html
     3  admin document       /admin.html        text/html
     4  pricing document     /pricing.html      text/html (scoped Paddle CSP)
     5  static asset         /css/mmgr.css      text/css
     6  API response         /api/health         application/json
     7  404 document         /no-such-page       text/html (extension-less)

   Every surface must answer `nosniff`. Every DOCUMENT must also carry the
   full hardening set and a hash-only script-src, and the report-only policy
   SEC-06 introduced. The pricing page must get the PADDLE policy, not the
   base one - that scoping is the reason checkout works at all.

   Drives worker.js in-process with a mocked ASSETS binding: no server, no
   network, deterministic. Usage: node tools/qa-security-headers.cjs
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const results = [];
const log = s => process.stdout.write('[sec-headers] ' + s + '\n');
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS ' : 'FAIL ') +
      name +
      (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail))
  );
};

const HTML = '<!doctype html><html><head></head><body>page</body></html>';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgr-hdr-'));
  const mjs = path.join(dir, 'worker.mjs');
  fs.copyFileSync(path.join(ROOT, 'worker.js'), mjs);
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  const mod = await import(pathToFileURL(mjs).href);

  // The asset layer answers like wrangler's: the content type is decided by
  // the extension, which is exactly what the Worker inspects to classify a
  // response as a document.
  const ASSETS = {
    fetch: async function (req) {
      const p = new URL(req.url).pathname;
      if (/\.css$/.test(p)) {
        return new Response('body{color:#000}', {
          status: 200,
          headers: { 'Content-Type': 'text/css; charset=utf-8' }
        });
      }
      if (/\.js$/.test(p)) {
        return new Response('/*x*/', {
          status: 200,
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
        });
      }
      return new Response(HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  };
  const env = { ASSETS };

  const get = async p => {
    const res = await mod.default.fetch(new Request('https://app.example' + p), env);
    return {
      status: res.status,
      h: name => res.headers.get(name) || '',
      all: res.headers
    };
  };

  const surfaces = [
    { key: 'marketing document', path: '/index.html', doc: true },
    { key: 'app document', path: '/project.html', doc: true },
    { key: 'admin document', path: '/admin.html', doc: true },
    { key: 'pricing document', path: '/pricing.html', doc: true },
    { key: 'static asset', path: '/css/mmgr.css', doc: false },
    { key: 'API response', path: '/api/health', doc: false },
    { key: '404 document', path: '/no-such-page', doc: true }
  ];

  const seen = {};
  for (const s of surfaces) {
    const r = await get(s.path);
    seen[s.key] = r;

    // --- every surface -----------------------------------------------------
    check(
      s.key + ' (' + s.path + ') answers nosniff',
      r.h('X-Content-Type-Options') === 'nosniff',
      { status: r.status, nosniff: r.h('X-Content-Type-Options') }
    );
    check(
      s.key + ' (' + s.path + ') carries Strict-Transport-Security with a one-year floor',
      /max-age=(\d+)/.test(r.h('Strict-Transport-Security')) && Number(RegExp.$1) >= 31536000,
      { hsts: r.h('Strict-Transport-Security') }
    );

    if (!s.doc) {
      continue;
    }

    // --- documents ---------------------------------------------------------
    const csp = r.h('Content-Security-Policy');
    check(s.key + ' carries a Content-Security-Policy', !!csp, { csp: csp.slice(0, 60) });
    check(
      s.key + " script-src is hash-only (no 'unsafe-inline')",
      !!csp && /script-src [^;]*/.test(csp) && !/script-src [^;]*'unsafe-inline'/.test(csp),
      { scriptSrc: (csp.match(/script-src [^;]*/) || [''])[0].slice(0, 80) }
    );
    check(
      s.key + " keeps object-src 'none', base-uri 'self' and frame-ancestors",
      /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /frame-ancestors /.test(csp),
      { csp: csp.slice(0, 160) }
    );
    check(s.key + ' sends X-Frame-Options: DENY', r.h('X-Frame-Options') === 'DENY', {
      xfo: r.h('X-Frame-Options')
    });
    check(
      s.key + ' sends Referrer-Policy: strict-origin-when-cross-origin',
      r.h('Referrer-Policy') === 'strict-origin-when-cross-origin',
      { rp: r.h('Referrer-Policy') }
    );
    check(
      s.key + ' denies camera, payment and usb while allowing geolocation(self)',
      /camera=\(\)/.test(r.h('Permissions-Policy')) &&
        /payment=\(\)/.test(r.h('Permissions-Policy')) &&
        /usb=\(\)/.test(r.h('Permissions-Policy')) &&
        /geolocation=\(self\)/.test(r.h('Permissions-Policy')),
      { pp: r.h('Permissions-Policy') }
    );
    check(
      s.key + ' sends COOP and CORP',
      r.h('Cross-Origin-Opener-Policy') === 'same-origin-allow-popups' &&
        r.h('Cross-Origin-Resource-Policy') === 'same-origin',
      {
        coop: r.h('Cross-Origin-Opener-Policy'),
        corp: r.h('Cross-Origin-Resource-Policy')
      }
    );
    check(
      s.key + ' carries the SEC-06 report-only policy (the observation window)',
      /connect-src/.test(r.h('Content-Security-Policy-Report-Only')) &&
        /report-uri \/api\/csp-report/.test(r.h('Content-Security-Policy-Report-Only')),
      { ro: r.h('Content-Security-Policy-Report-Only').slice(0, 80) }
    );
  }

  // --- surface-specific ----------------------------------------------------
  const base = seen['app document'].h('Content-Security-Policy');
  const pricing = seen['pricing document'].h('Content-Security-Policy');
  check(
    'pricing gets the scoped PADDLE policy, not the base one (checkout depends on it)',
    pricing !== base &&
      /frame-src [^;]*https:\/\/buy\.paddle\.com/.test(pricing) &&
      /frame-ancestors 'self'/.test(pricing) &&
      !/frame-src [^;]*https:\/\/buy\.paddle\.com/.test(base),
    { pricingFrame: (pricing.match(/frame-src [^;]*/) || [''])[0].slice(0, 90) }
  );
  check(
    "every other document keeps frame-ancestors 'none'",
    seen['marketing document'].h('Content-Security-Policy').indexOf("frame-ancestors 'none'") !==
      -1 &&
      seen['app document'].h('Content-Security-Policy').indexOf("frame-ancestors 'none'") !== -1,
    {}
  );
  check(
    'the API response is never cacheable',
    seen['API response'].h('Cache-Control') === 'no-store',
    { cc: seen['API response'].h('Cache-Control') }
  );
  check(
    'the 404 document is a real 404 and still hardened',
    seen['404 document'].status === 404 && !!seen['404 document'].h('Content-Security-Policy'),
    { status: seen['404 document'].status }
  );
  check(
    'the static asset carries CORP (a cross-origin page cannot read it)',
    seen['static asset'].h('Cross-Origin-Resource-Policy') === 'same-origin',
    { corp: seen['static asset'].h('Cross-Origin-Resource-Policy') }
  );

  // --- the set is not vacuous ---------------------------------------------
  const distinctCsp = new Set(
    surfaces.filter(s => s.doc).map(s => seen[s.key].h('Content-Security-Policy'))
  );
  check(
    'the document policies are not all one string (the pricing scope is real)',
    distinctCsp.size >= 2,
    { distinct: distinctCsp.size }
  );

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
