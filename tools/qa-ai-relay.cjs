/* ============================================================
   BYO-AI-KEY-SESSION-ONLY-v1 STEP-5 — /api/ai/chat relay VERIFY
   ------------------------------------------------------------
   Imports worker.js as a module (copied to a .mjs temp so Node's
   CJS/ESM detection doesn't fight us) and drives its fetch handler
   with a mocked ASSETS binding + a mocked global fetch standing in
   for the upstream AI providers. Verifies:
     - POST without key -> 401 JSON
     - bad body -> 400 JSON, unsupported provider -> 400 JSON
     - oversized body -> 413
     - openai forward: Bearer header, model+messages, text extracted
     - gemini forward: x-goog-api-key header, systemInstruction/contents
     - provider 401 -> relay 401 (client clears its session key)
     - static pages still decorated (CSP headers) via ASSETS
     - /api/auth/me still answers before ASSETS (auth routes intact)
   Exit 0 only when every check passes. No server required.
   Usage: node tools/qa-ai-relay.cjs
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const results = [];
const log = (s) => process.stdout.write('[relay] ' + s + '\n');
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS ' : 'FAIL ') + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

(async () => {
  // Import worker.js as an ES module.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgr-relay-'));
  const mjs = path.join(dir, 'worker.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'worker.js'), mjs);
  const mod = await import(pathToFileURL(mjs).href + '?v=' + Date.now());

  let upstreamCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function(url, opts) {
    upstreamCalls.push({ url: String(url), opts });
    const u = String(url);
    if (u.indexOf('generativelanguage') !== -1) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'GEMINI-OK' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OPENAI-OK' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const env = {
    ASSETS: {
      fetch: async function(req) {
        return new Response('<html>shell</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
    }
  };

  const run = (pathname, init) => mod.default.fetch(new Request('https://app.example' + pathname, init), env);

  // 1. Missing key -> 401
  const r1 = await run('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'openai', messages: [{ role: 'user', content: 'hi' }] }) });
  const d1 = await r1.json();
  check('R01 missing key -> 401 JSON', r1.status === 401 && d1.ok === false, { status: r1.status, d1 });

  // 2. Bad JSON body -> 400
  const r2 = await run('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
  check('R02 malformed body -> 400 JSON', r2.status === 400, { status: r2.status });

  // 3. Unsupported provider -> 400
  const r3 = await run('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Api-Key': 'sk-x' }, body: JSON.stringify({ provider: 'wat', messages: [] }) });
  check('R03 unsupported provider -> 400 JSON', r3.status === 400, { status: r3.status });

  // 4. OpenAI forward (header key) -> 200 + text, Bearer used, no key echoed
  upstreamCalls = [];
  const r4 = await run('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Api-Key': 'sk-secret-1' }, body: JSON.stringify({ provider: 'openai', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], context: 'ctx' }) });
  const d4 = await r4.json();
  const up4 = upstreamCalls[0];
  const upBody4 = up4 ? JSON.parse(up4.opts.body) : null;
  check('R04 openai: 200 {ok:true,text}, Bearer key, model+messages, no key echoed', r4.status === 200 && d4.ok === true && d4.text === 'OPENAI-OK' && up4.opts.headers.Authorization === 'Bearer sk-secret-1' && upBody4.messages.length === 2 && upBody4.model && JSON.stringify(d4).indexOf('sk-secret-1') === -1, { status: r4.status, d4, auth: up4 && up4.opts.headers.Authorization });

  // 5. Gemini forward -> x-goog-api-key header + systemInstruction/contents
  upstreamCalls = [];
  const r5 = await run('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Api-Key': 'AIza-secret-2' }, body: JSON.stringify({ provider: 'google-gemini', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], context: 'ctx' }) });
  const d5 = await r5.json();
  const up5 = upstreamCalls[0];
  const upBody5 = up5 ? JSON.parse(up5.opts.body) : null;
  check('R05 gemini: 200 {ok:true,text}, x-goog-api-key, systemInstruction+contents', r5.status === 200 && d5.ok === true && d5.text === 'GEMINI-OK' && up5.opts.headers['x-goog-api-key'] === 'AIza-secret-2' && upBody5.systemInstruction.parts[0].text.length > 0 && upBody5.contents[0].parts[0].text === 'hi', { status: r5.status, d5, xkey: up5 && up5.opts.headers['x-goog-api-key'] });

  // 6. Provider auth failure -> relay 401 (client clears session key)
  globalThis.fetch = async function() { return new Response('', { status: 401 }); };
  const r6 = await run('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Api-Key': 'sk-bad' }, body: JSON.stringify({ provider: 'openai', messages: [{ role: 'user', content: 'hi' }] }) });
  const d6 = await r6.json();
  check('R06 provider 401 -> relay 401, key never echoed', r6.status === 401 && d6.ok === false && JSON.stringify(d6).indexOf('sk-bad') === -1, { status: r6.status, d6 });
  globalThis.fetch = realFetch;

  // 7. Oversized body -> 413
  const big = JSON.stringify({ provider: 'openai', messages: [{ role: 'user', content: 'x'.repeat(300000) }] });
  const r7 = await run('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Api-Key': 'sk-x' }, body: big });
  check('R07 oversized body -> 413', r7.status === 413, { status: r7.status });

  // 8. Static page still decorated with CSP headers (ASSETS path preserved)
  const r8 = await run('/project.html', { method: 'GET' });
  check('R08 static page served + CSP header intact', r8.status === 200 && (r8.headers.get('Content-Security-Policy') || '').indexOf('default-src') !== -1, { status: r8.status, csp: r8.headers.get('Content-Security-Policy') });

  // 9. /api/auth/* routes still answer before ASSETS
  const r9 = await run('/api/auth/me', { method: 'GET' });
  const d9 = await r9.json();
  check('R09 /api/auth/me still handled (auth routes intact)', r9.status === 200 && d9 && d9.ok === false && d9.user === null, { status: r9.status, d9 });

  // 10. Unknown /api route still 404 JSON (not index.html)
  const r10 = await run('/api/nope', { method: 'GET' });
  check('R10 unknown /api/* -> 404 JSON', r10.status === 404, { status: r10.status });

  const failed = results.filter(r => !r.val);
  log('RELAY_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + (e && e.stack || e)); process.exit(1); });
