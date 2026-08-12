/* ============================================================
   My MaNaGeR — local static dev server (QA harness support)
   Zero dependencies. Serves the project directory on :8765 so
   the headless Chrome QA battery (qa-*.cjs) can load the SPA
   exactly as a static host would. Dev tooling only.
   Usage: node serve.cjs   (Ctrl+C to stop)
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8765;

// OBSERVABILITY-SECURITY-DOMAIN-EXECUTION-DIRECTIVES DIR-2:   mirror of the
// production Worker headers (see worker.js) so the headless Chrome QA gates
// exercise the REAL CSP locally. Keep this in sync with worker.js whenever
// the CSP (inline-script hashes! GIS origins!) or any header changes.
// CSP construction rule: every SHA-256 hash source must stay INSIDE the
// script-src directive (space-separated). A hash as its own ';'-joined element
// becomes an invalid directive and the browser rejects the WHOLE policy,
// silently breaking every inline script. Must match worker.js exactly.
const INLINE_SCRIPT_HASHES = [
  "'sha256-gCwlAVKUNamFRjZeFSwcBd1zxQs+/mZ2GoLF8lqT/II='",
  "'sha256-o+0No2XpbES4E5QJh31mY9JsJFqSmE+B4x+z1fNPjVc='",
  "'sha256-gCwlAVKUNamFRjZeFSwcBd1zxQs+/mZ2GoLF8lqT/II='",
  "'sha256-gh1pJ1rSyd7LP4eITg17YwZIFfNkKQgLCGxUMAf1tkc='",
  "'sha256-qbHZHLyhdEDRwWrA8/I8ty4xIjUv+L/+Y6/0cIXdkJo='",
  "'sha256-zTSNRzMhnvwuiiAKdVsLTpLHaN9XACR8m4E6jrA8VU0='",
  "'sha256-Oa7ON+9A164SSXhnxu08mFn0V9Tj2SlZ2SzFXFoqKNE='",
  "'sha256-DRiA9m7qJLb4z1QyfjbEUFyubzWHRCl2Cgf+YJkjyi8='",
  "'sha256-l7T1LLezhae1ZGfmUGxTadrqmveWG2jA4nLGwRkmB3k='",
  "'sha256-c2U+m5SzyupzeOrPEiOjlnaSgS1KdAxZTFnYA5dW/Rk='",
  "'sha256-3TjcOBgQeATMpPC1MUJPRDjeq7SvgohH62pIViDmtnk='"
].join(' ');
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://unpkg.com https://accounts.google.com https://apis.google.com " + INLINE_SCRIPT_HASHES,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https: https://accounts.google.com https://oauth2.googleapis.com blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src https://accounts.google.com",
    "frame-ancestors 'none'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()'
};

// WHISPER-CSP (QA-STRESS DIR-2 finding, Aug 2026): the bundled offline
// whisper runtime (vendor/whisper/) runs its Emscripten glue inside a
// module worker, and that glue builds function invokers with `new Function`
// (Asyncify invoker generation + embind method callers). Chrome enforces
// the CSP delivered WITH THE WORKER SCRIPT for the worker's own script
// execution — NOT the embedding document's CSP (probe-verified: the
// tools/csp-probe* harness shows evalAllowed:true when only the worker
// script's response is relaxed). So the app pages keep the STRICT CSP
// above, and ONLY this vendored, trusted whisper subtree gets the eval
// allowance it needs. Must stay in sync with the production Worker's
// WHISPER_CSP (worker.js).
const WHISPER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  // Rank 1.5 Tier 1: bundled offline whisper runtime + model (vendor/whisper/)
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream'
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + PORT);
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';

    // INTEGRATED-STRUCTURE-API-WINDOW plan §1: mirror of the Worker's
    // GET /api/health liveness probe so the local QA battery exercises the
    // same API-status pill path against the dev server (worker.js serves
    // this route in production).
    if (p === '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, status: 'ok', app: 'my-manager', time: new Date().toISOString() }));
      return;
    }

    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 not found: ' + p);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    }, SECURITY_HEADERS);
    // Scoped CSP: only the vendored whisper runtime files get the relaxed
    // policy (see WHISPER_CSP above). Everything else stays strict.
    // CHECK ON THE RESOLVED PATH (review finding): the raw URL pathname can
    // contain dot-segments (/vendor/whisper/../../js/x.js resolves to a real
    // non-whisper file under ROOT), so a prefix test on `p` alone would hand
    // the relaxed CSP to non-whisper content. `file` is already the
    // path.join(ROOT, p) result used for serving — test it directly.
    if (file.startsWith(path.join(ROOT, 'vendor', 'whisper') + path.sep)) {
      headers['Content-Security-Policy'] = WHISPER_CSP;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message));
  }
});

server.listen(PORT, () => {
  process.stdout.write('mmgr dev server on http://localhost:' + PORT + '\n');
});
