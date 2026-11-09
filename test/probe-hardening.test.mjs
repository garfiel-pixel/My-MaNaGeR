/* ============================================================
   PROBE HARDENING (F, 2026-11-09)
   ------------------------------------------------------------
   A scanner requested /.env, /dump.sql, /database.sql and a fake WordPress
   PHP file. The asset layer's single-page fallback answered each with 200 and
   the app shell, so a probe that should read "not here" read "this host
   serves files". These tests drive the real worker export with a mocked
   ASSETS binding that behaves like the live one (HTML for any unknown path)
   and pin both halves:

     - a path that claims to be a file is a real 404, with no shell body;
     - a real app deep link still answers 200.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const SHELL = '<!doctype html><html><body>app shell</body></html>';

function makeEnv() {
  return {
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        // A real .well-known file is served with its own content type; every
        // other unknown path gets the single-page fallback, as in production.
        if (path.indexOf('/.well-known/') === 0) {
          return new Response('Contact: mailto:security@example.test\n', {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        }
        return new Response(SHELL, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }
  };
}

async function get(path) {
  const res = await worker.fetch(new Request('https://mymanagerworkspace.com' + path), makeEnv());
  const body = await res.text();
  return { status: res.status, body: body, type: res.headers.get('Content-Type') || '' };
}

const PROBES = [
  '/.env',
  '/dump.sql',
  '/database.sql',
  '/wp-admin/zzcanary-test.php',
  '/js/config.js',
  '/model-config.js',
  '/app.config.js'
];

test('every scanner path is a real 404 with no shell body', async () => {
  for (const path of PROBES) {
    const r = await get(path);
    assert.equal(r.status, 404, path + ' -> ' + r.status);
    assert.equal(r.body.indexOf('<html'), -1, path + ' returned the shell');
    assert.equal(r.body, 'Not Found', path + ' -> ' + r.body.slice(0, 60));
  }
});

test('the API namespace answers a JSON 404, never a page', async () => {
  const r = await get('/api/env');
  assert.equal(r.status, 404);
  assert.match(r.type, /application\/json/);
  assert.equal(r.body.indexOf('<html'), -1);
});

test('real app deep links still answer 200', async () => {
  for (const path of ['/', '/app', '/calculator', '/pricing', '/contact']) {
    const r = await get(path);
    assert.equal(r.status, 200, path + ' -> ' + r.status);
    assert.match(r.body, /app shell/, path + ' lost its document');
  }
});

test('a real html page is not mistaken for a probe', async () => {
  const r = await get('/pricing.html');
  assert.equal(r.status, 200);
});

test('a dotfile inside a nested directory is refused too', async () => {
  const r = await get('/js/.env');
  assert.equal(r.status, 404);
});

test('/.well-known stays public', async () => {
  const r = await get('/.well-known/security.txt');
  assert.equal(r.status, 200, 'the one public dotfile tree must pass the guard');
});
