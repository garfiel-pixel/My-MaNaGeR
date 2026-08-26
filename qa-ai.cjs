/* ============================================================
   RANK 2.3 GATE — Real Model Wiring + Agent-Style Presets
   (PLAN-OF-ACTION-AI-VOICE-SYNC-v1)
   Drives headless Chrome against http://127.0.0.1:8765.
   Covers:
     - Config: tier toggle lives in state.config.ai, merged over
       MMGR.Config.ai defaults; NO schema bump when switching.
     - Tier A (local): zero-key deterministic engine — every
       preset output writes state.aiOutputs[type] with a `trace`
       array of the exact state fields used (zero-fabrication by
       construction), and free-form lookups answer from state.
     - Tier B (cloud, BYO-AI-KEY-SESSION-ONLY-v1): the session vault
       (MMGR.AiKey, sessionStorage-only) is the only key source — relay
       /api/ai/chat first, direct fallback when the relay is absent;
       OpenAI + Google Gemini payload shapes verified against a mocked
       fetch; circuit-break on network failure returns { ok:false }
       without throwing or corrupting state, and only an auth failure
       clears the session key.
     - Readonly gating: aiRunPreset / aiSet* stay blocked in
       view-only mode; open/load/copy stay allowed.
     - DIR-1 layout regression (A17): the one-click presets stay reachable
       via the Chat/Presets tab even after a long conversation at a short
       viewport — the condition that originally hid them entirely.
   Exit 0 only when every contract holds.
   Usage: node qa-ai.cjs  (server must be on :8765; override with
          QA_BASE=http://host:port to target a different server)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-ai-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write('[ai23] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 300000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/seed-test.html' }); await delay(4000);
  await ev('window.MMGR.Schedule.cascade("northern-temperate",{threshold:999}); window.MMGR.Render.renderAll();'); await delay(300);

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- 1. boot: modules present + config defaults ----
  const b1 = await ev(`(function(){
    return { ai: !!window.MMGR.AiWin,
      submit: typeof window.MMGR.AiWin.submit === 'function',
      runPreset: typeof window.MMGR.AiWin.runPreset === 'function',
      post: typeof window.MMGR.Net.post === 'function',
      tiers: !!window.MMGR.AiWin.TIERS && !!window.MMGR.AiWin.TIERS.local && !!window.MMGR.AiWin.TIERS.cloud };
  })()`);
  check('A01 boot: AiWin.submit + runPreset + Net.post + TIERS registered', !!(b1.ai && b1.submit && b1.runPreset && b1.post && b1.tiers), b1);

  const b2 = await ev(`(function(){
    var cfg = MMGR.Config.ai;
    return { tierOff: cfg.tier === 'off', provider: cfg.provider === 'openai',
      defaults: !!MMGR.Net.PROVIDER_DEFAULTS.openai && !!MMGR.Net.PROVIDER_DEFAULTS.anthropic };
  })()`);
  check('A02 config: default tier=off, provider=openai, provider defaults exist', b2.tierOff && b2.provider && b2.defaults, b2);

  // ---- 2. settings toggle: switching tiers is config-only, no schema change ----
  const t1 = await ev(`(function(){
    MMGR.AiWin.setAiCfg({ tier: 'local' });
    var s = MMGR.State.getState();
    return { tier: s.config.ai.tier, schema: s.schemaVersion, live: MMGR.State.SCHEMA_VERSION,
      merged: MMGR.Net.getConfig().ai.tier,
      aiOutputs: typeof s.aiOutputs === 'object' && s.aiOutputs !== null };
  })()`);
  // Schema must equal the CURRENT schema version — the point is the toggle
  // itself never bumps it (config-only by design).
  check('A03 toggle: setAiCfg(local) -> state.config.ai.tier=local, schema unchanged, aiOutputs exists', t1.tier === 'local' && t1.schema === t1.live && t1.merged === 'local' && t1.aiOutputs, t1);

  // ---- 3. Tier A (local): one-click preset writes state.aiOutputs with trace ----
  const l1 = await ev(`(async function(){
    var res = await MMGR.AiWin.runPreset('report');
    var s = MMGR.State.getState();
    var out = s.aiOutputs && s.aiOutputs.report;
    return { ok: res.ok, tier: res.tier, hasOut: !!out,
      savedTier: out && out.tier, hasTrace: !!(out && out.trace && out.trace.length),
      textHasProject: !!(out && out.text && out.text.indexOf('Demo Tower Renovation') > -1) };
  })()`);
  check('A04 local: runPreset(report) ok + state.aiOutputs.report written with trace', l1.ok && l1.tier === 'local' && l1.hasOut && l1.savedTier === 'local' && l1.hasTrace && l1.textHasProject, l1);

  const l2 = await ev(`(async function(){
    var res = await MMGR.AiWin.submit('what is our completion percent', '', { tier: 'local' });
    return { ok: res.ok, tier: res.tier, hasPct: /Completion/.test(res.text || ''), trace: Array.isArray(res.trace) && res.trace.length > 0 };
  })()`);
  check('A05 local: free-form lookup answered from state with trace', l2.ok && l2.tier === 'local' && l2.hasPct && l2.trace, l2);

  const l3 = await ev(`(async function(){
    // zero-fabrication: local digest output must NOT contain any token that
    // exists nowhere in state — spot-check a few impossible values.
    var res = await MMGR.AiWin.runPreset('digest');
    var s = MMGR.State.getState();
    var out = s.aiOutputs && s.aiOutputs.digest;
    var txt = (out && out.text) || '';
    var banned = ['$999,999,999', '2027-12-31', 'Invented Company X'].filter(function(b){ return txt.indexOf(b) > -1; });
    return { ok: res.ok, hasOut: !!out, banned: banned, project: (s.projectName || (s.charter && s.charter.name)) };
  })()`);
  check('A06 local: digest output contains no fabricated values', l3.ok && l3.hasOut && l3.banned.length === 0, l3);

  // ---- 3b. BYO session vault (BYO-AI-KEY-SESSION-ONLY-v1 STEP-1) ----
  const v1 = await ev(`(function(){
    var before = !!localStorage.getItem('mmgr_byo_ai');
    MMGR.AiKey.clearKey();
    return { empty: MMGR.AiKey.isConnected() === false,
      noLocal: !before && !localStorage.getItem('mmgr_byo_ai'),
      key: MMGR.AiKey.getKey() === null };
  })()`);
  check('B01 vault: isConnected false when sessionStorage empty, no localStorage write', v1.empty && v1.noLocal && v1.key, v1);

  const v2 = await ev(`(function(){
    MMGR.AiKey.setKey('openai', 'sk-session-789');
    var s = MMGR.State.getState();
    var json = JSON.stringify(s);
    return { on: MMGR.AiKey.isConnected() === true,
      provider: MMGR.AiKey.getProvider() === 'openai',
      key: MMGR.AiKey.getKey() === 'sk-session-789',
      noStateKey: json.indexOf('apiKey') === -1 && json.indexOf('sk-session-789') === -1 };
  })()`);
  check('B02 vault: setKey -> connected + provider/key stored; project state has NO key fields', v2.on && v2.provider && v2.key && v2.noStateKey, v2);

  const v3 = await ev(`(function(){
    MMGR.AiKey.clearKey();
    return { off: MMGR.AiKey.isConnected() === false, noLocal: !localStorage.getItem('mmgr_byo_ai') };
  })()`);
  check('B03 vault: clearKey -> disconnected, still nothing in localStorage', v3.off && v3.noLocal, v3);

  const v4 = await ev(`(function(){
    var threw = false;
    try { MMGR.AiKey.setKey('openai', '   '); } catch (e) { threw = true; }
    return { threw: threw, off: MMGR.AiKey.isConnected() === false };
  })()`);
  check('B04 vault: whitespace key rejected, stays disconnected', v4.threw && v4.off, v4);

  // B06: ANTHROPIC-CONNECTABLE — the whitelist must round-trip anthropic
  // (before this fast-follow, setKey('anthropic', ...) silently coerced to
  // 'openai', making the Anthropic ladder unreachable from the UI).
  const v5 = await ev(`(function(){
    MMGR.AiKey.clearKey();
    MMGR.AiKey.setKey('anthropic', 'sk-ant-vault');
    return { provider: MMGR.AiKey.getProvider() === 'anthropic', key: MMGR.AiKey.getKey() === 'sk-ant-vault' };
  })()`);
  check('B06 vault: anthropic is a first-class provider (whitelist round-trip)', v5.provider && v5.key, v5);

  // ---- 4. Tier B (cloud): session-vault key -> relay-first, direct fallback ----
  const c1 = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) return Promise.resolve(new Response('', { status: 404 })); // relay absent locally -> fallback
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'CLOUD-REPLY-OK' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiKey.setKey('openai', 'sk-test-123');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('draft report', '## PROJECT\\n- Name: Demo', { tier: 'cloud' });
      var direct = calls.filter(function(c){ return String(c.url).indexOf('openai.com') > -1; })[0];
      var body = direct && direct.opts ? JSON.parse(direct.opts.body) : null;
      return { ok: res.ok, text: res.text, tier: res.tier,
        relayFirst: calls.length > 0 && String(calls[0].url).indexOf('/api/ai/chat') === 0,
        auth: !!(direct && direct.opts && direct.opts.headers && direct.opts.headers.Authorization === 'Bearer sk-test-123'),
        hasMessages: !!(body && body.messages && body.messages.length === 2),
        hasSystem: !!(body && body.messages && body.messages[0].role === 'system') };
    } finally { window.fetch = orig; }
  })()`);
  check('A07 cloud: vault key -> relay-first, 404 fallback -> direct OpenAI POST with Bearer + system/user messages', c1.ok && c1.text === 'CLOUD-REPLY-OK' && c1.tier === 'cloud' && c1.relayFirst && c1.auth && c1.hasMessages && c1.hasSystem, c1);

  const c2 = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'CLOUD-GEMINI-OK' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiKey.setKey('google-gemini', 'AIza-test-456');
      // State provider is deliberately set to openai — the VAULT provider must win.
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var direct = calls.filter(function(c){ return String(c.url).indexOf('generativelanguage') > -1; })[0];
      var body = direct && direct.opts ? JSON.parse(direct.opts.body) : null;
      return { ok: res.ok, text: res.text,
        xkey: !!(direct && direct.opts && direct.opts.headers && direct.opts.headers['x-goog-api-key'] === 'AIza-test-456'),
        hasSystem: !!(body && body.systemInstruction && body.systemInstruction.parts && body.systemInstruction.parts[0].text.length > 0),
        hasContents: !!(body && body.contents && body.contents[0] && body.contents[0].parts && body.contents[0].parts[0].text.length > 0) };
    } finally { window.fetch = orig; }
  })()`);
  check('A08 cloud: Google Gemini POST with x-goog-api-key + systemInstruction/contents (vault provider wins)', c2.ok && c2.text === 'CLOUD-GEMINI-OK' && c2.xkey && c2.hasSystem && c2.hasContents, c2);

  const c2b = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      // Relay IS deployed here — answer with a live 200; no fallback may fire.
      return Promise.resolve(new Response(JSON.stringify({ ok: true, text: 'CLOUD-RELAY-OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiKey.setKey('openai', 'sk-relay-200');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var noDirect = calls.every(function(c){ return String(c.url).indexOf('openai.com') === -1 && String(c.url).indexOf('generativelanguage') === -1; });
      return { ok: res.ok, text: res.text, relayUsed: calls.length === 1 && String(calls[0].url).indexOf('/api/ai/chat') === 0, noDirect: noDirect };
    } finally { window.fetch = orig; }
  })()`);
  check('A08b cloud: relay 200 -> text rendered, NO direct fallback call', c2b.ok && c2b.text === 'CLOUD-RELAY-OK' && c2b.relayUsed && c2b.noDirect, c2b);

  // ---- GEMINI-MODEL-FALLBACK-LADDER (DIR-3/DIR-4) ----
  // A08c: primary model 429s (rate limited) -> the ladder retries the next,
  // smaller model (gemini-flash-lite-latest) and reports WHICH model actually
  // answered in res.model + res.trace (DIR-4 transparency).
  const c2c = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) return Promise.resolve(new Response('', { status: 404 })); // no relay -> direct per model
      if (String(url).indexOf('gemini-flash-latest:generateContent') > -1) return Promise.resolve(new Response('', { status: 429 })); // primary quota-exhausted
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'LADDER-OK' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiKey.setKey('google-gemini', 'AIza-ladder-1');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var liteCalled = calls.some(function(c){ return String(c.url).indexOf('gemini-flash-lite-latest:generateContent') > -1; });
      return { ok: res.ok, text: res.text, model: res.model,
        liteCalled: liteCalled,
        traceFallback: !!(res.trace && res.trace.join(' ').indexOf('fell back from gemini-flash-latest on 429') > -1) };
    } finally { window.fetch = orig; }
  })()`);
  check('A08c cloud: 429 on primary -> ladder falls back to flash-lite-latest, reports actual model + fallback trace', c2c.ok && c2c.text === 'LADDER-OK' && c2c.model === 'gemini-flash-lite-latest' && c2c.liteCalled && c2c.traceFallback, c2c);

  // A08d: 401 on the FIRST model stops the whole ladder (no smaller-model
  // attempt with a rejected key) AND clears the session key (401-only rule).
  const c2d = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(new Response('', { status: 401 })); // key rejected on every model
    };
    try {
      MMGR.AiKey.setKey('google-gemini', 'AIza-bad-ladder');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var geminiCalls = calls.filter(function(c){ return String(c.url).indexOf('generateContent') > -1; });
      var onlyPrimary = geminiCalls.length === 1 && String(geminiCalls[0].url).indexOf('gemini-flash-latest:generateContent') > -1 && String(geminiCalls[0].url).indexOf('gemini-flash-lite-latest') === -1;
      return { ok: res.ok, keyCleared: MMGR.AiKey.isConnected() === false,
        status: MMGR.AiWin.getConnectionState(),
        onlyPrimary: onlyPrimary,
        noLite: !calls.some(function(c){ return String(c.url).indexOf('gemini-flash-lite-latest') > -1; }) };
    } finally { window.fetch = orig; }
  })()`);
  check('A08d cloud: 401 on first model -> ladder STOPS (no lite attempt), session key cleared', c2d.ok === false && c2d.keyCleared && c2d.status === 'not_connected' && c2d.onlyPrimary && c2d.noLite, c2d);

  // A08e: RELAY-first ladder (the documented DIR-3 decision) — the relay
  // reports 429 on the first model, so the client retries THROUGH THE RELAY
  // with the next model and reports the actual answering model. No direct
  // provider call may fire while the relay is present.
  const c2e = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) {
        var b = opts && opts.body ? JSON.parse(opts.body) : null;
        if (b && b.model === 'gemini-flash-latest') return Promise.resolve(new Response('', { status: 429 })); // relay reports capacity on primary
        return Promise.resolve(new Response(JSON.stringify({ ok: true, text: 'RELAY-LADDER-OK', model: (b && b.model) || 'unknown' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    };
    try {
      MMGR.AiKey.setKey('google-gemini', 'AIza-relay-ladder');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var relayCalls = calls.filter(function(c){ return String(c.url).indexOf('/api/ai/chat') === 0; });
      var liteRelay = relayCalls.some(function(c){ var b = c.opts && c.opts.body ? JSON.parse(c.opts.body) : null; return b && b.model === 'gemini-flash-lite-latest'; });
      var noDirect = !calls.some(function(c){ return String(c.url).indexOf('generativelanguage') > -1; });
      return { ok: res.ok, text: res.text, model: res.model, liteRelay: liteRelay, noDirect: noDirect,
        traceFallback: !!(res.trace && res.trace.join(' ').indexOf('fell back from gemini-flash-latest on 429') > -1) };
    } finally { window.fetch = orig; }
  })()`);
  check('A08e cloud: relay 429 on primary -> ladder retries flash-lite-latest THROUGH the relay, reports actual model', c2e.ok && c2e.text === 'RELAY-LADDER-OK' && c2e.model === 'gemini-flash-lite-latest' && c2e.liteRelay && c2e.noDirect && c2e.traceFallback, c2e);

  // A08f: OPENAI ladder — 429 on gpt-4o-mini falls back to gpt-5-mini (the
  // first verified cheaper rung) and reports the actual model + fallback trace.
  const c2f = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) return Promise.resolve(new Response('', { status: 404 }));
      var b = opts && opts.body ? JSON.parse(opts.body) : null;
      if (b && b.model === 'gpt-4o-mini') return Promise.resolve(new Response('', { status: 429 }));
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'OPENAI-LADDER-OK' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiKey.setKey('openai', 'sk-ladder-1');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var triedGpt5Mini = calls.some(function(c){ var b = c.opts && c.opts.body ? JSON.parse(c.opts.body) : null; return b && b.model === 'gpt-5-mini'; });
      return { ok: res.ok, text: res.text, model: res.model, triedGpt5Mini: triedGpt5Mini,
        traceFallback: !!(res.trace && res.trace.join(' ').indexOf('fell back from gpt-4o-mini on 429') > -1) };
    } finally { window.fetch = orig; }
  })()`);
  check('A08f cloud: OpenAI 429 on gpt-4o-mini -> ladder falls back to gpt-5-mini, reports actual model', c2f.ok && c2f.text === 'OPENAI-LADDER-OK' && c2f.model === 'gpt-5-mini' && c2f.triedGpt5Mini && c2f.traceFallback, c2f);

  // A08g: ANTHROPIC wire format — the Messages API needs x-api-key +
  // anthropic-version headers, max_tokens + system field in the body, and the
  // reply comes back in content[0].text (NOT choices[0].message.content).
  const c2g = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'CLAUDE-OK' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiKey.setKey('anthropic', 'sk-ant-1');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var direct = calls.filter(function(c){ return String(c.url).indexOf('anthropic.com') > -1; })[0];
      var body = direct && direct.opts ? JSON.parse(direct.opts.body) : null;
      return { ok: res.ok, text: res.text,
        xkey: !!(direct && direct.opts && direct.opts.headers && direct.opts.headers['x-api-key'] === 'sk-ant-1'),
        version: !!(direct && direct.opts && direct.opts.headers && direct.opts.headers['anthropic-version'] === '2023-06-01'),
        maxTokens: !!(body && body.max_tokens > 0),
        system: !!(body && body.system && body.system.length > 0),
        messages: !!(body && body.messages && body.messages.length === 1 && body.messages[0].role === 'user') };
    } finally { window.fetch = orig; }
  })()`);
  check('A08g cloud: Anthropic direct POST uses x-api-key + anthropic-version + max_tokens/system, parses content[0].text', c2g.ok && c2g.text === 'CLAUDE-OK' && c2g.xkey && c2g.version && c2g.maxTokens && c2g.system && c2g.messages, c2g);

  // A08h: ANTHROPIC ladder — 429 on claude-3-5-sonnet-latest falls back to
  // claude-3-5-haiku-latest and reports the actual model + fallback trace.
  const c2h = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) return Promise.resolve(new Response('', { status: 404 }));
      var b = opts && opts.body ? JSON.parse(opts.body) : null;
      if (b && b.model === 'claude-3-5-sonnet-latest') return Promise.resolve(new Response('', { status: 429 }));
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'CLAUDE-HAIKU-OK' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiKey.setKey('anthropic', 'sk-ant-2');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var triedHaiku = calls.some(function(c){ var b = c.opts && c.opts.body ? JSON.parse(c.opts.body) : null; return b && b.model === 'claude-3-5-haiku-latest'; });
      return { ok: res.ok, text: res.text, model: res.model, triedHaiku: triedHaiku,
        traceFallback: !!(res.trace && res.trace.join(' ').indexOf('fell back from claude-3-5-sonnet-latest on 429') > -1) };
    } finally { window.fetch = orig; }
  })()`);
  check('A08h cloud: Anthropic 429 on sonnet -> ladder falls back to haiku, reports actual model', c2h.ok && c2h.text === 'CLAUDE-HAIKU-OK' && c2h.model === 'claude-3-5-haiku-latest' && c2h.triedHaiku && c2h.traceFallback, c2h);

  // A08i: ANTHROPIC CONNECT probe — Connect & Test must hit the Anthropic
  // models endpoint with x-api-key + anthropic-version, NOT the OpenAI
  // endpoint (a wrong-endpoint probe would 401 and clear the session key).
  const c2i = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      var r = await MMGR.AiWin.probeProvider('anthropic', 'sk-ant-probe');
      var hit = calls.filter(function(c){ return String(c.url).indexOf('api.anthropic.com/v1/models') > -1; })[0];
      return { ok: r.ok, status: r.status,
        anthropicUrl: !!hit,
        xkey: !!(hit && hit.opts && hit.opts.headers && hit.opts.headers['x-api-key'] === 'sk-ant-probe'),
        version: !!(hit && hit.opts && hit.opts.headers && hit.opts.headers['anthropic-version'] === '2023-06-01') };
    } finally { window.fetch = orig; }
  })()`);
  check('A08i cloud: Anthropic Connect probe hits /v1/models with x-api-key + anthropic-version', c2i.ok && c2i.status === 200 && c2i.anthropicUrl && c2i.xkey && c2i.version, c2i);

  // A08j: VISIBLE FALLBACK BADGE — after a 429-driven ladder fallback the
  // chat bubble must render a .ai-fallback chip naming both models (visible
  // without reading the trace), and the result must expose fellBackFrom.
  const c2j = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      if (String(url).indexOf('/api/ai/chat') === 0) return Promise.resolve(new Response('', { status: 404 }));
      var b = opts && opts.body ? JSON.parse(opts.body) : null;
      if (b && b.model === 'claude-3-5-sonnet-latest') return Promise.resolve(new Response('', { status: 429 }));
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'CLAUDE-HAIKU-OK' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiKey.setKey('anthropic', 'sk-ant-badge');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var q = document.getElementById('ai-q');
      if (q) q.value = 'is the schedule safe?';
      var res1 = await MMGR.AiWin.runQuestion();
      if (q) q.value = '';
      var bubbles = document.querySelectorAll('#ai-thread .ai-bubble');
      var last = bubbles.length ? bubbles[bubbles.length - 1] : null;
      var badge = last ? last.querySelector('.ai-fallback') : null;
      return {
        ok: res1.ok, model: res1.model, fellBackFrom: res1.fellBackFrom || null,
        badgeShown: !!(badge && badge.textContent.indexOf('claude-3-5-haiku-latest') > -1 && badge.textContent.indexOf('claude-3-5-sonnet-latest') > -1)
      };
    } finally { window.fetch = orig; }
  })()`);
  check('A08j UI: fallback bubble renders a visible .ai-fallback badge naming both models', c2j.ok && c2j.model === 'claude-3-5-haiku-latest' && c2j.fellBackFrom === 'claude-3-5-sonnet-latest' && c2j.badgeShown, c2j);

  // A08k: STATIC regression guard — the Gemini ladder must never point at a
  // dead model family. Verified live on 2026-08-10 with a real user key:
  // gemini-2.0-flash, gemini-2.0-flash-lite, gemini-2.5-flash and
  // gemini-2.5-flash-lite ALL return 404 "no longer available", and since a
  // 404 stops the ladder by design (only 429/503 advance), a dead primary
  // silently kills the entire fallback. This naming-convention gate only
  // catches families KNOWN to be dead (a static regex cannot predict the
  // next deprecation — the real verification is the live models-list probe
  // run with a user key, documented in mmgr-net.js). No rung may be from the
  // dead 2.0-/2.5- numbered families and at least one rung must be a
  // `-latest` alias (the aliases Google keeps current).
  const c2k = await ev(`(function(){
    var def = MMGR.Net.PROVIDER_DEFAULTS['google-gemini'];
    var models = [def.model].concat(def.fallbackModels || []);
    var dead = models.filter(function(m){ return /^gemini-2\.[05]-/.test(m); });
    return {
      model: def.model, fallbacks: (def.fallbackModels || []).slice(),
      noDeadFamily: dead.length === 0,
      hasLatestAlias: models.some(function(m){ return /-latest$/.test(m); })
    };
  })()`);
  check('A08k static: Gemini ladder avoids the dead 2.0/2.5- families and keeps a -latest alias rung', c2k.noDeadFamily && c2k.hasLatestAlias, c2k);

  const c3 = await ev(`(async function(){
    var orig = window.fetch;
    var errCount = MMGR.State.getState().errorLog ? MMGR.State.getState().errorLog.length : 0;
    window.fetch = function(){ return Promise.reject(new Error('network down')); };
    try {
      MMGR.AiKey.setKey('openai', 'sk-test-123');
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('anything', 'ctx', { tier: 'cloud' });
      var after = MMGR.State.getState();
      return { ok: res.ok, hasErr: !!res.error && res.error.indexOf('failed') > -1,
        stateIntact: typeof after.tasks === 'object' && Array.isArray(after.tasks),
        logged: after.errorLog.length > errCount,
        stillConnected: MMGR.AiKey.isConnected() };
    } finally { window.fetch = orig; }
  })()`);
  check('A09 cloud: network failure -> ok:false + error logged, state intact, session key KEPT (only auth failure clears it)', c3.ok === false && c3.hasErr && c3.stateIntact && c3.logged && c3.stillConnected, c3);

  // ---- 5. offline tier does not touch the network ----
  const o1 = await ev(`(async function(){
    var called = false;
    var orig = window.fetch;
    window.fetch = function(){ called = true; return Promise.reject(new Error('should not fire')); };
    try {
      MMGR.AiWin.setAiCfg({ tier: 'local' });
      var res = await MMGR.AiWin.submit('budget status', '', { tier: 'local' });
      return { ok: res.ok, noNet: !called, hasBudget: /Budget/.test(res.text || '') };
    } finally { window.fetch = orig; }
  })()`);
  check('A10 local: zero network calls for the local tier', o1.ok && o1.noNet && o1.hasBudget, o1);

  // ---- 6. UI: settings row + per-preset run buttons exist ----
  await ev('document.querySelector("[data-action=openAiWin]").click()'); await delay(400);
  const u1 = await ev(`(function(){
    return { tierSel: !!document.getElementById('ai-tier'),
      runBtns: document.querySelectorAll('[data-action="aiRunPreset"]').length,
      runMain: !!document.querySelector('[data-action="aiRun"]'),
      out: !!document.getElementById('ai-out'),
      chipCells: document.querySelectorAll('.ai-chip-cell').length };
  })()`);
  check('A11 ui: tier select + per-preset run buttons + result panel render', u1.tierSel && u1.runBtns >= 10 && u1.runMain && u1.out && u1.chipCells === u1.runBtns, u1);

  // ---- 6a. INTEGRATED-STRUCTURE-API-WINDOW (plan §1/§3): live API badge ----
  // force=true so the assert isn't swallowed by the open()-triggered probe
  // that may still be in flight on a slow server (review fix).
  const u1a = await ev(`(async function(){
    var pill = document.getElementById('ai-api-pill');
    var lbl = document.getElementById('ai-api-pill-label');
    var res = await MMGR.AiWin.checkApiHealth(true);
    await new Promise(function(r){ setTimeout(r, 150); });
    return { exists: !!pill && !!lbl,
      result: res,
      state: pill ? pill.getAttribute('data-state') : null,
      label: lbl ? lbl.textContent : null };
  })()`);
  check('A16 api: /api/health badge exists and reports online against the dev server', u1a.exists && u1a.result === 'connected' && u1a.state === 'connected' && u1a.label === 'Backend \u00b7 online', u1a);

  // ---- 6a2. AI-WINDOW-LAYOUT-SCROLL-AND-INPUT-BUG (DIR-1) regression gate:
  // the one-click presets must stay reachable via the Chat/Presets tab even
  // with a LONG conversation on a SHORT viewport — the exact condition that
  // originally pushed them below the modal's clipped edge. Asserts the thread
  // really overflowed, the Presets tab reveals the pane fully inside the
  // modal, and a chip click loads its prompt. ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1262, height: 420, deviceScaleFactor: 1, mobile: false }); await delay(250);
  const lay1 = await ev(`(async function(){
    var q = document.getElementById('ai-q');
    var th = document.getElementById('ai-thread');
    for (var i = 0; i < 8; i++) {
      q.value = 'Regression question ' + i + ' — what is blocking the critical path and how should the team respond to keep the schedule on track?';
      await MMGR.AiWin.runQuestion();
    }
    var threadScrollable = th.scrollHeight > th.clientHeight + 2;
    var segCount = document.querySelectorAll('.ai-seg-btn').length;
    document.getElementById('ai-seg-presets').click();
    await new Promise(function(r){ setTimeout(r, 150); });
    var p = document.getElementById('ai-pane-presets');
    var mb = document.querySelector('#ai-win .mb');
    var pr = p.getBoundingClientRect();
    var mr = mb.getBoundingClientRect();
    var onBtn = document.querySelector('.ai-seg-btn.is-on');
    var chipBtn = document.querySelector('.ai-chip');
    var chips = document.querySelectorAll('.ai-chip').length;
    if (chipBtn) chipBtn.click();
    await new Promise(function(r){ setTimeout(r, 100); });
    return { threadScrollable: threadScrollable,
      segCount: segCount,
      presetsVisible: !p.classList.contains('is-hide'),
      presetsInsideModal: pr.top >= mr.top - 1 && pr.bottom <= mr.bottom + 1,
      chipCount: chips,
      activeTab: onBtn ? onBtn.getAttribute('data-tab') : null,
      chipClickLoaded: q.value.length > 0,
      rects: { pTop: Math.round(pr.top), pBottom: Math.round(pr.bottom), mbTop: Math.round(mr.top), mbBottom: Math.round(mr.bottom) } };
  })()`);
  check('A17 ui: presets reachable via Chat/Presets tab after a long conversation on a short viewport', lay1.threadScrollable && lay1.segCount === 2 && lay1.presetsVisible && lay1.presetsInsideModal && lay1.chipCount >= 10 && lay1.activeTab === 'presets' && lay1.chipClickLoaded, lay1);
  await send('Emulation.clearDeviceMetricsOverride'); await delay(200);

  // ---- 6b. BYO Connect flow (STEP-2 + DIR-1 real connectivity probe) ----
  // DIR-1: Connect now VERIFIES the key with a cheap models-list request
  // through the circuit-broken Net path. Headless run mocks that probe with
  // a 200 so the flow deterministically reaches the 'connected' state — a
  // key present is NOT 'connected' until the probe confirms it.
  const u1b = await ev(`(async function(){
    var orig = window.fetch;
    window.fetch = function(url){
      if (String(url).indexOf('generativelanguage.googleapis.com') > -1 || String(url).indexOf('api.openai.com') > -1) {
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    };
    try {
      MMGR.AiWin.setAiCfg({ tier: 'cloud' }); MMGR.AiWin.syncSettingsUI();
      var p = document.getElementById('ai-byo-provider'); var k = document.getElementById('ai-byo-key');
      if (p) p.value = 'google-gemini'; if (k) k.value = 'AIza-ui-flow-1';
      var conn = document.getElementById('ai-byo-connect');
      if (conn) conn.click();
      await new Promise(function(r){ setTimeout(r, 300); });
      var st = document.getElementById('ai-byo-status');
      var send = document.querySelector('.ai-send');
      return { connected: MMGR.AiKey.isConnected(),
        status: MMGR.AiWin.getConnectionState(),
        chip: !!(st && st.getAttribute('data-state') === 'on' && st.textContent.indexOf('Connected') === 0 && st.textContent.indexOf('Google Gemini') > -1),
        inputCleared: !!k && k.value === '',
        sendEnabled: !!(send && !send.disabled) };
    } finally { window.fetch = orig; }
  })()`);
  check('B05 ui: Connect & Test -> verified "Connected · Google Gemini" chip, raw key cleared, cloud Send enabled', u1b.connected && u1b.status === 'connected' && u1b.chip && u1b.inputCleared && u1b.sendEnabled, u1b);

  const u1c = await ev(`(async function(){
    var clr = document.getElementById('ai-byo-clear');
    if (clr) clr.click();
    await new Promise(function(r){ setTimeout(r, 120); });
    var st = document.getElementById('ai-byo-status');
    var send = document.querySelector('.ai-send');
    var wrap = document.getElementById('ai-send-wrap');
    return { off: MMGR.AiKey.isConnected() === false,
      status: MMGR.AiWin.getConnectionState(),
      chip: !!(st && st.getAttribute('data-state') === 'off' && st.textContent.indexOf('Disconnected') === 0),
      sendBlocked: !!(send && send.disabled),
      // UI-DECLUTTER: the red inline hint is gone; the disabled Send button
      // explains itself through the WRAPPER's native tooltip (Chrome
      // suppresses title tooltips on disabled buttons).
      hintGone: !document.getElementById('ai-conn-hint'),
      tipSet: !!(wrap && wrap.getAttribute('title') && wrap.getAttribute('title').indexOf('Connect your AI key to send') > -1) };
  })()`);
  check('B06 ui: Clear -> Disconnected chip, session key gone, cloud Send disabled + native tooltip (no red hint)', u1c.off && u1c.status === 'not_connected' && u1c.chip && u1c.sendBlocked && u1c.hintGone && u1c.tipSet, u1c);

  // ---- DIR-1 canonical three states: saved-but-unverified vs rejected ----
  // B07a: provider unreachable -> key KEPT, status 'saved_untested', chip
  // "Key saved — not tested", Send stays blocked (no fabricated connected).
  const u1d = await ev(`(async function(){
    var orig = window.fetch;
    window.fetch = function(){ return Promise.reject(new Error('network down')); };
    try {
      MMGR.AiKey.clearKey();
      MMGR.AiWin.setAiCfg({ tier: 'cloud' }); MMGR.AiWin.syncSettingsUI();
      var k = document.getElementById('ai-byo-key');
      if (k) k.value = 'sk-offline-1';
      var res = await MMGR.AiWin.connectByo('openai', 'sk-offline-1');
      var st = document.getElementById('ai-byo-status');
      var send = document.querySelector('.ai-send');
      var wrap = document.getElementById('ai-send-wrap');
      return { ok: res.ok, status: MMGR.AiWin.getConnectionState(),
        keyKept: MMGR.AiKey.isConnected() === true,
        chip: !!(st && st.getAttribute('data-state') === 'untested' && st.textContent.indexOf('not tested') > -1),
        sendBlocked: !!(send && send.disabled),
        // textContent-equivalent on the wrapper tooltip: the saved_untested
        // message must render a plain '&' (the HTML entity would literally
        // show as "&amp;").
        tipClean: !!(wrap && wrap.getAttribute('title') && wrap.getAttribute('title').indexOf('&amp;') === -1 && wrap.getAttribute('title').indexOf('& Test') > -1) };
    } finally { window.fetch = orig; }
  })()`);
  check('B07a ui: unreachable provider -> key KEPT, "Key saved — not tested", Send stays blocked', u1d.ok === false && u1d.status === 'saved_untested' && u1d.keyKept && u1d.chip && u1d.sendBlocked, u1d);
  check('B07a tooltip: saved_untested message renders plain "&" (no literal &amp;)', u1d.tipClean, u1d);

  // B07b: provider rejects the key (401) -> key CLEARED, back to
  // 'not_connected', chip Disconnected (auth failure clears, not fabricates).
  const u1e = await ev(`(async function(){
    var orig = window.fetch;
    window.fetch = function(){ return Promise.resolve(new Response('{}', { status: 401 })); };
    try {
      MMGR.AiKey.clearKey();
      MMGR.AiWin.setAiCfg({ tier: 'cloud' }); MMGR.AiWin.syncSettingsUI();
      var k = document.getElementById('ai-byo-key');
      if (k) k.value = 'sk-rejected-1';
      var res = await MMGR.AiWin.connectByo('openai', 'sk-rejected-1');
      var st = document.getElementById('ai-byo-status');
      return { ok: res.ok, status: MMGR.AiWin.getConnectionState(),
        keyCleared: MMGR.AiKey.isConnected() === false,
        chip: !!(st && st.getAttribute('data-state') === 'off' && st.textContent.indexOf('Disconnected') === 0) };
    } finally { window.fetch = orig; }
  })()`);
  check('B07b ui: 401 from provider -> key CLEARED, Disconnected, status not_connected', u1e.ok === false && u1e.status === 'not_connected' && u1e.keyCleared && u1e.chip, u1e);

  // ---- DIR-2: provider secrets stripped from export AND import ----
  // The live key is session-vault-only, but the strip is the load-bearing
  // guard against a legacy apiKey riding in state (old pre-session-vault
  // exports, direct state writes). exportState must never emit it, and
  // importState/adoptExternal must never re-seed state with one.
  const d2 = await ev(`(function(){
    var s = MMGR.State.getState();
    if (!s.config || typeof s.config !== 'object') s.config = {};
    if (!s.config.ai || typeof s.config.ai !== 'object') s.config.ai = {};
    // Simulate a legacy leak directly in state (bypasses setAiCfg, which
    // now drops apiKey patches on the way in) and export.
    s.config.ai.apiKey = 'sk-LEGACY-SECRET-123';
    var json = MMGR.State.exportState();
    var stripped = json.indexOf('sk-LEGACY-SECRET-123') === -1 && json.indexOf('"apiKey"') === -1;
    // Import a legacy file carrying the key — must NOT re-seed state.
    var legacy = JSON.stringify({ schemaVersion: MMGR.State.SCHEMA_VERSION, config: { ai: { tier: 'cloud', apiKey: 'sk-IMPORT-SECRET-456' } } });
    MMGR.State.importState(legacy);
    var reExported = MMGR.State.exportState();
    var importStripped = reExported.indexOf('sk-IMPORT-SECRET-456') === -1;
    // Restore clean state for later tests.
    MMGR.State.updateState(function(st){ if (st.config && st.config.ai) delete st.config.ai.apiKey; });
    return { stripped: stripped, importStripped: importStripped };
  })()`);
  check('DIR-2 export/import: apiKey stripped from outgoing export AND from re-adopted legacy imports', d2.stripped && d2.importStripped, d2);

  await ev('MMGR.AiWin.setAiCfg({ tier: "cloud" }); MMGR.AiWin.syncSettingsUI();'); await delay(200);
  const u2 = await ev(`(function(){
    var cloud = document.getElementById('ai-cfg-cloud');
    var prov = document.getElementById('ai-byo-provider');
    if (prov) prov.value = 'openai'; // reset — earlier B-tests left it on gemini
    return { shown: cloud && !cloud.classList.contains('is-hide'),
      prov: prov ? prov.value : null,
      status: !!document.getElementById('ai-byo-status'),
      connect: !!document.getElementById('ai-byo-connect'),
      clear: !!document.getElementById('ai-byo-clear'),
      secCopy: !!(document.querySelector('.ai-byo-sec') && document.querySelector('.ai-byo-sec').textContent.indexOf('session only') > -1) };
  })()`);
  check('A12 ui: cloud tier reveals BYO connect flow (provider select, status chip, Connect/Clear, security copy)', u2.shown && u2.prov === 'openai' && u2.status && u2.connect && u2.clear && u2.secCopy, u2);
  await ev('MMGR.AiWin.setAiCfg({ tier: "local" }); MMGR.AiWin.syncSettingsUI();'); await delay(150);
  const u3 = await ev(`(function(){
    var cloud = document.getElementById('ai-cfg-cloud');
    return { hidden: cloud && cloud.classList.contains('is-hide') };
  })()`);
  check('A13 ui: back to local hides cloud fields', u3.hidden, u3);

  // ---- 7. readonly gating ----
  await ev('MMGR.State.save(true); true;'); await delay(200);
  await ev(`(function(){ localStorage.setItem('mmgr_scope_demo-project','readonly'); return true; })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(4000);
  const r1 = await ev(`(async function(){
    var before = MMGR.State.getState().aiOutputs ? JSON.stringify(MMGR.State.getState().aiOutputs) : '{}';
    // The read-only gate lives in the click delegation (like every other
    // mutating action) — drive the real button, not the API. The chips are
    // rendered lazily when the AI window opens, so open it first.
    document.querySelector('[data-action="openAiWin"]').click();
    await new Promise(function(r){ setTimeout(r, 300); });
    document.querySelector('[data-action="aiRunPreset"][data-type="report"]').click();
    await new Promise(function(r){ setTimeout(r, 400); });
    var after = JSON.stringify(MMGR.State.getState().aiOutputs || {});
    var toast = document.querySelector('.toast');
    return { same: before === after, blockedMsg: !!toast && toast.textContent.indexOf('View-only') > -1 };
  })()`);
  check('A14 readonly: runPreset click blocked, state unchanged, toast shown', r1.same && r1.blockedMsg, r1);

  const r2 = await ev(`(function(){
    var copyOut = !!document.querySelector('[data-action="aiCopyOut"]');
    MMGR.AiWin.copyOut();
    var toast = document.querySelector('.toast');
    return { btn: copyOut, notBlocked: !toast || toast.textContent.indexOf('View-only') === -1 };
  })()`);
  check('A15 readonly: aiCopyOut stays allowed (read-only)', r2.btn && r2.notBlocked, r2);

  // ---- AI-WINDOW-RESIZE: drag handles + per-device size persistence ----
  // A18a: save/apply round-trip — the size persists to localStorage
  // (mmgr_ai_size), is applied as inline style, and clearing the pref restores
  // the CSS default. A18b: a synthetic pointer drag on the SE corner handle
  // grows the modal AND persists the new size (the drag wiring runs on real
  // pointer events, so this exercises the actual handlers).
  const rz1 = await ev(`(async function(){
    var modal = document.getElementById('ai-win-mb');
    try { localStorage.removeItem('mmgr_ai_size'); } catch(e){}
    MMGR.AiWin.applyAiSizePref();
    await new Promise(function(r){ setTimeout(r, 120); });
    MMGR.AiWin.saveAiSize(640, 480);
    MMGR.AiWin.applyAiSizePref();
    var appliedW = Math.round(parseFloat(modal.style.width));
    var appliedH = Math.round(parseFloat(modal.style.height));
    var pref = JSON.parse(localStorage.getItem('mmgr_ai_size') || '{}');
    try { localStorage.removeItem('mmgr_ai_size'); } catch(e){}
    MMGR.AiWin.applyAiSizePref();
    return { appliedW: appliedW, appliedH: appliedH, prefW: pref.w, prefH: pref.h, clearedW: modal.style.width };
  })()`);
  check('A18a resize: save/apply round-trip (persisted, applied, default-restorable)', rz1.appliedW === 640 && rz1.appliedH === 480 && rz1.prefW === 640 && rz1.prefH === 480 && rz1.clearedW === '', rz1);

  const rz2 = await ev(`(async function(){
    var modal = document.getElementById('ai-win-mb');
    MMGR.AiWin.saveAiSize(800, 600);
    MMGR.AiWin.applyAiSizePref();
    await new Promise(function(r){ setTimeout(r, 120); });
    var before = modal.getBoundingClientRect();
    var se = modal.querySelector('.ai-rz-se');
    var cx = Math.round(before.right) - 6, cy = Math.round(before.bottom) - 6;
    se.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, clientX: cx, clientY: cy }));
    se.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 7, clientX: cx + 120, clientY: cy + 80 }));
    var mid = modal.getBoundingClientRect();
    se.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 7, clientX: cx + 120, clientY: cy + 80 }));
    var after = modal.getBoundingClientRect();
    var pref = JSON.parse(localStorage.getItem('mmgr_ai_size') || '{}');
    return { grewW: Math.round(after.width) > Math.round(before.width), grewH: Math.round(after.height) > Math.round(before.height), midW: Math.round(mid.width) > Math.round(before.width), persistedW: Math.round(pref.w) === Math.round(after.width), persistedH: Math.round(pref.h) === Math.round(after.height) };
  })()`);
  check('A18b resize: dragging the SE corner grows the modal (mid-drag + final) and persists the new size', rz2.grewW && rz2.grewH && rz2.midW && rz2.persistedW && rz2.persistedH, rz2);
  await ev(`(function(){ try { localStorage.removeItem('mmgr_ai_size'); } catch(e){} MMGR.AiWin.applyAiSizePref(); return true; })()`);

  // ---- A19: enlarged default size regression gate ----
  // With NO saved size pref the modal must render at the enlarged default
  // (width:min(1500px,100%) x height:min(92vh,950px), the AI-WINDOW-DOUBLED-
  // SIZE contract). This catches any regression to the old sizing (760px
  // wide, and the pre-height-fix modal that collapsed to ~317px tall with a
  // ~115px thread). No centered assertion: at wide viewports the default
  // width resolves to 100% (full-bleed within the 18px backdrop padding) so
  // the modal fills the width by design — it is only centered when narrower
  // than the viewport. Thresholds hold for the suite's fixed 1440x1200
  // window (width ~1376px / height ~905px measured) and any reasonably
  // sized screen.
  const rz3 = await ev(`(async function(){
    try { localStorage.removeItem('mmgr_ai_size'); } catch(e){}
    MMGR.AiWin.applyAiSizePref();
    MMGR.AiWin.open();
    await new Promise(function(r){ setTimeout(r, 200); });
    var modal = document.getElementById('ai-win-mb');
    var r = modal.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
      vw: window.innerWidth, vh: window.innerHeight,
      hasHandles: modal.querySelectorAll('.ai-rz').length === 8 };
  })()`);
  check('A19 size: modal renders at the enlarged default (>=1200px wide, >=700px tall, 8 resize handles, no saved pref)', rz3.w >= 1200 && rz3.h >= 700 && rz3.hasHandles, rz3);

  await ev(`(function(){ localStorage.setItem('mmgr_scope_demo-project','full'); return true; })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);

  const failed = results.filter(r => !r.val);
  log('AI23_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
