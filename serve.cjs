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
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 not found: ' + p);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message));
  }
});

server.listen(PORT, () => {
  process.stdout.write('mmgr dev server on http://localhost:' + PORT + '\n');
});
