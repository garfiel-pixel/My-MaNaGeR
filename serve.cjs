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
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = 8765;

// PART F T7 (2026-08-16): in-memory reviews store for the dev-server
// mirror below (production uses the Worker's D1 `reviews` table + R2).
const REVIEWS = [];
const CONTACT = [];          // dev mirror of POST /api/contact (2026-09-14)
const CONTACT_BUCKETS = {};  // per-IP rate buckets for the contact mirror

// MCP DEV MIRROR (owner 2026-09-16): qa-full carries standing MCP gates,
// so the dev server mirrors the Worker's /api/mcp/:id transport contract
// (405 POST-only, PATH-A per-tool auth, section-scope refusals) against an
// in-memory key store. PBKDF2 parameters MUST stay in sync with
// src/lib/http.js (CLOUD_PBKDF2_ITERS). The deep auth/D1 gates remain in
// tools/qa-api-keys.cjs against real wrangler + D1.
const MCP_PBKDF2_ITERS = 100000; // keep in sync with src/lib/http.js
const MCP_KEYS = new Map();      // sha256(key) fingerprint -> key row
const MCP_TASKS = [];
const MCP_RISKS = [];
const MCP_TOOLS_LIST = ['get_project_summary', 'get_tasks', 'get_budget', 'get_risks', 'get_weather', 'get_meetings', 'apply_changes'];
function mcpSha256Hex(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'); }
async function mcpHashKey(key, saltHex) {
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(saltHex), iterations: MCP_PBKDF2_ITERS, hash: 'SHA-256' },
    await crypto.subtle.importKey('raw', new TextEncoder().encode(key), 'PBKDF2', false, ['deriveBits']),
    256
  );
  return Array.from(new Uint8Array(bits)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}
function mcpJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function mcpReadBody(req, cb) {
  let raw = '';
  req.on('data', function(c) { raw += c; if (raw.length > 262144) req.destroy(); });
  req.on('end', function() { let b = null; try { b = JSON.parse(raw); } catch (e) {} cb(b); });
}
// Same refusal text as src/mcp/server.js so gates assert identical bytes.
function mcpScopeGate(scope, sec) { return Array.isArray(scope) && scope.indexOf(sec) === -1; }
function mcpRefusal(scope) {
  return 'This API key does not include that section. The owner granted it: ' + (Array.isArray(scope) && scope.length ? scope.join(', ') : '(no sections)') + '. Ask the project owner to tick more sections for this key.';
}
// PATH-A (2026-09-16): byte-identical copy of MCP_AUTH_REFUSAL from
// src/mcp/server.js - this CommonJS file cannot import the ESM module.
const MCP_AUTH_REFUSAL = 'This endpoint needs its own credential before it will share project data or accept changes. Supply the project API key as Authorization: Bearer <key> or X-API-Key, or the owner code as Authorization: Bearer <owner-code>.';

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
  "'sha256-5or126vT/Zglw3U/tddN1oiYfQWWU72J4+5skzkCYWA='",
  "'sha256-32OrKvBTd4t3c/ByJMRp2EAI4phrVdX+LEPphWfgSz4='",
  "'sha256-6n6X5blbus8T7LO3a/rxKTOOdes6mm9KXmC/gWtOr1M='",
  "'sha256-PcY9TdIJsXGVPic0Qujx0Ov+GCt9gZG0hEtBVRDiLiM='",
  "'sha256-UbDx44vSDny3VslAGcGApbO56dR8hRvFQbe+phFAAxE='",
  "'sha256-sffw/zCX8kIC9wG3VBxLULiMMEAlFw+dQJtCK8V30q8='", // app.html block 4 (2026-09-21 sync-wiring wave)
  "'sha256-7BIp3SE8LrjSq5puH0lRtmP51SnLzcmBy32sBq0Zcps='",
  "'sha256-PcY9TdIJsXGVPic0Qujx0Ov+GCt9gZG0hEtBVRDiLiM='",
  "'sha256-O9lvE/vAuiMHUX3RQGR53K5h6w13/d2P16BoUBsYKAk='",
  "'sha256-p5gErSMcMFFQSkxQW5TvgsGZ3qSY01b9dZD8Wq8fEyw='", // admin.html block 4 (2026-09-21 sync-wiring wave)
  "'sha256-Oa7ON+9A164SSXhnxu08mFn0V9Tj2SlZ2SzFXFoqKNE='",
  "'sha256-pmiUsOqQa0BPAXsieggzTCopGA0jQO863MBE2hEoBb8='",
  "'sha256-7cQZf8bzyvMY1EwebBo5YuL3PZ9T/X5CTWFRXO3Aq5E='",
  "'sha256-c2U+m5SzyupzeOrPEiOjlnaSgS1KdAxZTFnYA5dW/Rk='",
  "'sha256-Is0jD76ptemzKTfgnVGlSCSEHBJeveC1gRTl/Wv4JBw='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-nsm9D+YbB4LQUmNXHf3kbpV7BWERupRhGClSKaU+DEo='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
].join(' ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://unpkg.com https://accounts.google.com https://apis.google.com https://static.cloudflareinsights.com " + INLINE_SCRIPT_HASHES,
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
    // OWNER 2026-09-14: dev mirror of the Worker's POST /api/contact -
    // same validation contract as src/contact.js (email required, plain
    // text, rate limit 5/30min per IP) minus the real Resend send. The
    // local QA battery exercises the contact form against this exactly
    // like production.
    if (p === '/api/contact' && req.method === 'POST') {
      let raw = '';
      req.on('data', function(c) {
        raw += c;
        if (raw.length > 8192) req.destroy();
      });
      req.on('end', function() {
        let body = null;
        try { body = JSON.parse(raw); } catch (e) { body = null; }
        if (!body || typeof body !== 'object') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'bad request' }));
          return;
        }
        const email = typeof body.email === 'string' ? body.email.trim().slice(0, 120) : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
        if (!email) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'your email is required so we can reply' })); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'that email address does not look right' })); return; }
        if (!message) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'a message is required' })); return; }
        if (message.length > 2000) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'message too long (max 2000 characters)' })); return; }
        if (/[<>]/.test(message + name)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'plain text only - no HTML or markup' })); return; }
        const ip = req.socket.remoteAddress || 'anon';
        const now = Date.now();
        CONTACT_BUCKETS[ip] = (CONTACT_BUCKETS[ip] || []).filter(function(t){ return t > now - 30 * 60000; });
        if (CONTACT_BUCKETS[ip].length >= 5) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'too many messages - try again in a bit' }));
          return;
        }
        CONTACT_BUCKETS[ip].push(now);
        CONTACT.push({ name: name, email: email, topic: String(body.topic || 'Other').slice(0, 40), message: message, createdAt: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, sent: true }));
      });
      return;
    }

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
              res.end(JSON.stringify({ ok: false, error: 'plain text only - no HTML or links in reviews' }));
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

    // ---- MCP DEV MIRROR routes (qa-full standing gates) ----
    if (p === '/__qa/mcp-reset' && req.method === 'POST') {
      MCP_KEYS.clear(); MCP_TASKS.length = 0; MCP_RISKS.length = 0;
      mcpJson(res, 200, { ok: true });
      return;
    }
    if (p === '/__qa/mcp-seed' && req.method === 'POST') {
      MCP_TASKS.length = 0; MCP_RISKS.length = 0;
      MCP_TASKS.push({ id: 't1', name: 'Pour foundation', status: 'todo', startDate: '2026-09-20', endDate: '2026-10-01', critical: true, dependencies: [] });
      MCP_RISKS.push({ id: 'r1', description: 'Rain delay', probability: 'high', impact: 'high', status: 'open', promoted: false });
      mcpJson(res, 200, { ok: true, tasks: MCP_TASKS.length, risks: MCP_RISKS.length });
      return;
    }
    var mkm = p.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/api-keys$/);
    if (mkm && req.method === 'POST') {
      mcpReadBody(req, async function(b) {
        if (!b || typeof b !== 'object') { mcpJson(res, 400, { ok: false, error: 'bad request' }); return; }
        const label = typeof b.label === 'string' ? b.label.slice(0, 60) : 'API key';
        const scope = Array.isArray(b.scope) ? b.scope.filter(function(s) { return typeof s === 'string'; }).slice(0, 20) : [];
        if (!scope.length) { mcpJson(res, 400, { ok: false, error: 'select at least one section' }); return; }
        const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const grp = function() { return Array.from(crypto.randomBytes(6)).map(function(x) { return abc[x % 36]; }).join(''); };
        const key = 'sk-mmgr-' + grp() + '-' + grp() + '-' + grp();
        const saltHex = crypto.randomBytes(16).toString('hex');
        const keyHash = await mcpHashKey(key, saltHex);
        MCP_KEYS.set(mcpSha256Hex(key), { saltHex: saltHex, keyHash: keyHash, label: label, scope: scope, active: true });
        mcpJson(res, 200, { ok: true, apiKey: key, keyId: MCP_KEYS.size, scope: scope, expiresAt: null });
      });
      return;
    }
    var mmm = p.match(/^\/api\/mcp\/([A-Za-z0-9_-]{1,64})$/);
    if (mmm) {
      if (req.method !== 'POST') { mcpJson(res, 405, { ok: false, error: 'MCP server requires POST' }); return; }
      const ah = String(req.headers['authorization'] || '');
      const bearer = ah.lastIndexOf('Bearer ', 0) === 0 ? ah.slice(7).trim() : '';
      const xkey = String(req.headers['x-api-key'] || '').trim();
      const cand = xkey || (bearer.lastIndexOf('sk-mmgr-', 0) === 0 ? bearer : '');
      const krow = cand ? MCP_KEYS.get(mcpSha256Hex(cand)) : null;
      // PATH-A: no transport-level 401/403 - bad credentials just mean the
      // tool layer refuses; only owner-code full access maps to scope null.
      const kscope = (krow && krow.active) ? krow.scope : null;
      const kauthed = !!(krow && krow.active);
      mcpReadBody(req, function(body) {
        if (!body || typeof body !== 'object') { mcpJson(res, 400, { ok: false, error: 'Invalid JSON' }); return; }
        const id = body.id;
        const method = body.method;
        if (method === 'initialize') {
          mcpJson(res, 200, { jsonrpc: '2.0', id: id, result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'my-manager-mcp', version: '1.0.0' } } });
          return;
        }
        if (method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
        if (method === 'tools/list') {
          mcpJson(res, 200, { jsonrpc: '2.0', id: id, result: { tools: MCP_TOOLS_LIST.map(function(n) { return { name: n }; }) } });
          return;
        }
        if (method === 'tools/call') {
          const t = (body.params || {}).name;
          const out = function(text, isErr) { mcpJson(res, 200, { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: text }], isError: !!isErr } }); };
          // PATH-A per-tool auth gate: without a valid credential every
          // tool call gets the refusal as a normal MCP isError result.
          if (!kauthed) return out(MCP_AUTH_REFUSAL, true);
          if (t === 'get_tasks') {
            if (mcpScopeGate(kscope, 'wbs')) return out(mcpRefusal(kscope), true);
            return out(JSON.stringify({ count: MCP_TASKS.length, tasks: MCP_TASKS }, null, 2));
          }
          if (t === 'get_risks') {
            if (mcpScopeGate(kscope, 'risk')) return out(mcpRefusal(kscope), true);
            return out(JSON.stringify({ riskCount: MCP_RISKS.length, issueCount: 0, risks: MCP_RISKS }, null, 2));
          }
          return out('Unknown tool: ' + t, true);
        }
        mcpJson(res, 200, { jsonrpc: '2.0', id: id, error: { code: -32601, message: 'Method not found: ' + method } });
      });
      return;
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
