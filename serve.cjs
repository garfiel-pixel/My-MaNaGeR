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

// PART F T7 (2026-08-16): in-memory reviews store for the dev-server
// mirror below (production uses the Worker's D1 `reviews` table + R2).
const REVIEWS = [];

// OBSERVABILITY-SECURITY-DOMAIN-EXECUTION-DIRECTIVES DIR-2:   mirror of the
// production Worker headers (see worker.js) so the headless Chrome QA gates
// exercise the REAL CSP locally. Keep this in sync with worker.js whenever
// the CSP (inline-script hashes! GIS origins!) or any header changes.
// CSP construction rule: every SHA-256 hash source must stay INSIDE the
// script-src directive (space-separated). A hash as its own ';'-joined element
// becomes an invalid directive and the browser rejects the WHOLE policy,
// silently breaking every inline script. Must match worker.js exactly.
const INLINE_SCRIPT_HASHES = [
  "'sha256-xxa9/PuVrm+Taxz+xZPm96NYiSKIHPHZLX8VCKQnrXk='",
  "'sha256-reza4vd5o52LWNUf9lzK6WjApdstd5sm4xVx+lcnK2M='",
  "'sha256-DDYVqby/7w6QiwGTikwlcwwnf1qHWgEmMUmSvXmqy7E='",
  "'sha256-SOdsdeUaBMC/g/FSW5vXZk+K1tRpA9U5QM/9rJa1RLs='",
  "'sha256-6n6X5blbus8T7LO3a/rxKTOOdes6mm9KXmC/gWtOr1M='",
  "'sha256-PcY9TdIJsXGVPic0Qujx0Ov+GCt9gZG0hEtBVRDiLiM='",
  "'sha256-YCro8lbLi7sxkyRUO/k3RRsBdaIELQhDpVbA2FIpQHY='",
  "'sha256-BqWUiy09OUinLFx+kKoxyNtN/9eUc26v8xwgfoLr5aI='",
  "'sha256-7BIp3SE8LrjSq5puH0lRtmP51SnLzcmBy32sBq0Zcps='",
  "'sha256-PcY9TdIJsXGVPic0Qujx0Ov+GCt9gZG0hEtBVRDiLiM='",
  "'sha256-O9lvE/vAuiMHUX3RQGR53K5h6w13/d2P16BoUBsYKAk='",
  "'sha256-dapxYtjtsIXomB7cX8RHksAwO/QcwFZl1z2VYQ/fbnM='",
  "'sha256-Oa7ON+9A164SSXhnxu08mFn0V9Tj2SlZ2SzFXFoqKNE='",
  "'sha256-bNdw0+64xL2//htoz+u3InKWYZNEHO/CnuZqtcJIBgU='",
  "'sha256-7cQZf8bzyvMY1EwebBo5YuL3PZ9T/X5CTWFRXO3Aq5E='",
  "'sha256-c2U+m5SzyupzeOrPEiOjlnaSgS1KdAxZTFnYA5dW/Rk='",
  "'sha256-Is0jD76ptemzKTfgnVGlSCSEHBJeveC1gRTl/Wv4JBw='",
].join(' ');
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://unpkg.com https://accounts.google.com https://apis.google.com " + INLINE_SCRIPT_HASHES,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
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
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin'
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
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
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

    // PART F T7 (2026-08-16): mirror of the Worker's public reviews
    // endpoints so the local QA battery exercises reviews.html against
    // the dev server exactly like production (worker.js serves these
    // routes for real; this in-memory copy is dev-only). Same content
    // discipline: plain text only, name optional, newest first.
    if (p === '/api/reviews') {
      if (req.method === 'GET') {
        const list = REVIEWS.slice().sort(function(a, b) {
          if (a.createdAt === b.createdAt) return b.id - a.id;
          return a.createdAt < b.createdAt ? 1 : -1;
        }).slice(0, 200);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, reviews: list }));
        return;
      }
      if (req.method === 'POST') {
        let raw = '';
        req.on('data', function(c) {
          raw += c;
          if (raw.length > 8192) req.destroy();
        });
        req.on('end', function() {
          try {
            const body = JSON.parse(raw);
            const rawName = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
            const rawText = typeof body.review === 'string' ? body.review.trim() : '';
            if (!rawText) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'review text is required' })); return; }
            if (rawText.length > 2000) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'review too long' })); return; }
            if (/[<>]/.test(rawText + rawName) || /https?:\/\/|www\./i.test(rawText + rawName)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'plain text only — no HTML or links in reviews' }));
              return;
            }
            let stars = null;
            if (body.stars !== undefined && body.stars !== null && body.stars !== 0) {
              const n = Number(body.stars);
              if (Number.isInteger(n) && n >= 1 && n <= 5) stars = n;
              else { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'stars must be a whole number from 1 to 5' })); return; }
            }
            const now = new Date().toISOString();
            const review = { id: REVIEWS.length + 1, name: rawName || null, review: rawText, stars: stars, votes: 0, createdAt: now };
            REVIEWS.push(review);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ ok: true, review: review }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'bad request' }));
          }
        });
        return;
      }
    }

    let file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // CSS dev fallback: when dist/*.min.css is requested but doesn't exist
      // (no prior build), serve the original source file transparently.
      var cssFallback = {
        'dist/mmgr.min.css': 'css/mmgr.css',
        'dist/marketing.min.css': 'css/marketing.css'
      };
      if (cssFallback[p] && fs.existsSync(path.join(ROOT, cssFallback[p]))) {
        file = path.join(ROOT, cssFallback[p]);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 not found: ' + p);
        return;
      }
    }
    const ext = path.extname(file).toLowerCase();
    // Cache-Control parity with worker.js: HTML revalidates on every visit,
    // static assets cache for 1 year (content changes are SW-cache-busted),
    // JSON/manifest revalidate, everything else gets a short TTL.
    var cc;
    if (ext === '.html' || p === '/') {
      cc = 'no-cache';
    } else if (['.js', '.css', '.svg', '.png', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.otf'].indexOf(ext) !== -1) {
      cc = 'public, max-age=31536000, immutable';
    } else if (ext === '.json' || ext === '.webmanifest') {
      cc = 'no-cache';
    } else {
      cc = 'public, max-age=3600';
    }
    const headers = Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cc
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
