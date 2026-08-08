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
     - Tier B (cloud): OpenAI + Anthropic payload shapes verified
       against a mocked fetch; circuit-break on network failure
       returns { ok:false } without throwing or corrupting state.
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
    return { tier: s.config.ai.tier, schema: s.schemaVersion,
      merged: MMGR.Net.getConfig().ai.tier,
      aiOutputs: typeof s.aiOutputs === 'object' && s.aiOutputs !== null };
  })()`);
  // Schema must equal the CURRENT schema version (16 as of Rank 3.1 packs) —
  // the point is the toggle itself never bumps it.
  check('A03 toggle: setAiCfg(local) -> state.config.ai.tier=local, schema unchanged, aiOutputs exists', t1.tier === 'local' && t1.schema === 16 && t1.merged === 'local' && t1.aiOutputs, t1);

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

  // ---- 4. Tier B (cloud): OpenAI payload + circuit-break via mocked fetch ----
  const c1 = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push({ url: url, opts: opts });
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'CLOUD-REPLY-OK' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', apiKey: 'sk-test-123', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('draft report', '## PROJECT\\n- Name: Demo', { tier: 'cloud' });
      var call = calls[0];
      var body = call && call.opts ? JSON.parse(call.opts.body) : null;
      return { ok: res.ok, text: res.text, tier: res.tier,
        url: call ? call.url : null,
        method: call && call.opts ? call.opts.method : null,
        auth: !!(call && call.opts && call.opts.headers && call.opts.headers.Authorization === 'Bearer sk-test-123'),
        hasMessages: !!(body && body.messages && body.messages.length === 2),
        hasSystem: !!(body && body.messages && body.messages[0].role === 'system') };
    } finally { window.fetch = orig; }
  })()`);
  check('A07 cloud: OpenAI POST with Bearer key + system/user messages', c1.ok && c1.text === 'CLOUD-REPLY-OK' && c1.tier === 'cloud' && c1.method === 'POST' && c1.auth && c1.hasMessages && c1.hasSystem, c1);

  const c2 = await ev(`(async function(){
    var calls = [];
    var orig = window.fetch;
    window.fetch = function(url, opts){
      calls.push(opts);
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'CLOUD-ANTHROPIC-OK' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    try {
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'anthropic', apiKey: 'sk-ant-456' });
      var res = await MMGR.AiWin.submit('hello', '', { tier: 'cloud' });
      var o = calls[0];
      var body = o ? JSON.parse(o.body) : null;
      return { ok: res.ok, text: res.text,
        xkey: !!(o && o.headers && o.headers['x-api-key'] === 'sk-ant-456'),
        version: !!(o && o.headers && o.headers['anthropic-version']),
        hasSystem: !!(body && typeof body.system === 'string' && body.system.length > 0),
        hasMessages: !!(body && body.messages && body.messages[0].role === 'user') };
    } finally { window.fetch = orig; }
  })()`);
  check('A08 cloud: Anthropic POST with x-api-key + anthropic-version + system string', c2.ok && c2.text === 'CLOUD-ANTHROPIC-OK' && c2.xkey && c2.version && c2.hasSystem && c2.hasMessages, c2);

  const c3 = await ev(`(async function(){
    var orig = window.fetch;
    var errCount = MMGR.State.getState().errorLog ? MMGR.State.getState().errorLog.length : 0;
    window.fetch = function(){ return Promise.reject(new Error('network down')); };
    try {
      MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', apiKey: 'sk-test-123', endpoint: '', model: '' });
      var res = await MMGR.AiWin.submit('anything', 'ctx', { tier: 'cloud', maxRetries: 0 });
      var after = MMGR.State.getState();
      return { ok: res.ok, hasErr: !!res.error && res.error.indexOf('failed') > -1,
        stateIntact: typeof after.tasks === 'object' && Array.isArray(after.tasks),
        logged: after.errorLog.length > errCount };
    } finally { window.fetch = orig; }
  })()`);
  check('A09 cloud: circuit-break on network failure -> ok:false + error logged, state intact', c3.ok === false && c3.hasErr && c3.stateIntact && c3.logged, c3);

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

  await ev('MMGR.AiWin.setAiCfg({ tier: "cloud" }); MMGR.AiWin.syncSettingsUI();'); await delay(200);
  const u2 = await ev(`(function(){
    var cloud = document.getElementById('ai-cfg-cloud');
    return { shown: cloud && !cloud.classList.contains('is-hide'),
      prov: document.getElementById('ai-provider') ? document.getElementById('ai-provider').value : null };
  })()`);
  check('A12 ui: cloud tier reveals provider/endpoint/key fields', u2.shown && u2.prov === 'openai', u2);
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
