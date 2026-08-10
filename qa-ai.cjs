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
   Exit 0 only when every contract holds.
   Usage: node qa-ai.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
const PORT = 9237;
const BASE = 'http://127.0.0.1:8765';
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
  check('A16 api: /api/health badge exists and reports connected against the dev server', u1a.exists && u1a.result === 'connected' && u1a.state === 'connected' && u1a.label === 'API · connected', u1a);

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
    var hint = document.getElementById('ai-conn-hint');
    return { off: MMGR.AiKey.isConnected() === false,
      status: MMGR.AiWin.getConnectionState(),
      chip: !!(st && st.getAttribute('data-state') === 'off' && st.textContent.indexOf('Disconnected') === 0),
      sendBlocked: !!(send && send.disabled),
      hintShown: !!(hint && !hint.classList.contains('is-hide') && hint.textContent.length > 0) };
  })()`);
  check('B06 ui: Clear -> Disconnected chip, session key gone, cloud Send disabled + hint', u1c.off && u1c.status === 'not_connected' && u1c.chip && u1c.sendBlocked && u1c.hintShown, u1c);

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
      var hint = document.getElementById('ai-conn-hint');
      return { ok: res.ok, status: MMGR.AiWin.getConnectionState(),
        keyKept: MMGR.AiKey.isConnected() === true,
        chip: !!(st && st.getAttribute('data-state') === 'untested' && st.textContent.indexOf('not tested') > -1),
        sendBlocked: !!(send && send.disabled),
        // textContent path: the saved_untested hint must render a plain '&'
        // (the HTML entity would literally show as "&amp;").
        hintClean: !!hint && hint.textContent.indexOf('&amp;') === -1 && hint.textContent.indexOf('& Test') > -1 };
    } finally { window.fetch = orig; }
  })()`);
  check('B07a ui: unreachable provider -> key KEPT, "Key saved — not tested", Send stays blocked', u1d.ok === false && u1d.status === 'saved_untested' && u1d.keyKept && u1d.chip && u1d.sendBlocked, u1d);
  check('B07a hint: saved_untested hint renders plain "&" (no literal &amp;)', u1d.hintClean, u1d);

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

  await ev(`(function(){ localStorage.setItem('mmgr_scope_demo-project','full'); return true; })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);

  const failed = results.filter(r => !r.val);
  log('AI23_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
