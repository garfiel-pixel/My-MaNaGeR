/* ============================================================
   PHASE 2/3 GATE (schema v11) — feature flags, client error
   surface, MMGR.Net retry/backoff, idempotent imports,
   MMGR.Config, AI context-dump contract.
   Usage: node qa-v11.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9235;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-v11-' + Date.now());
let ws, msgId = 0; const pending = new Map();
const log = (s) => { process.stdout.write('[v11] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 240000);
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

  const results = [];
  const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- FLAGS --------------------------------------------------------------
  const f1 = await ev(`(function(){
    var s = MMGR.State.getState();
    var fl = s.flags || {};
    // MERGED-AI-CONTROL (audit 1.2): aiWindow is no longer a flag — the AI
    // assistant follows state.config.ai.tier. Only the four real UI modules
    // remain flags, all default-on.
    return { has: typeof s.flags === 'object' && s.flags !== null,
      allOn: ['monteCarlo','ganttExport','leadtimeLane','weatherForecast'].every(function(k){ return fl[k] !== false; }) };
  })()`);
  check('01 flags: state.flags object present, all default on', f1.has && f1.allOn, f1);

  const f2 = await ev(`(function(){
    var chips = Array.prototype.slice.call(document.querySelectorAll('[data-action="tglFlag"]'));
    var ai = document.querySelector('[data-action="tglAiTier"]');
    return { count: chips.length,
      checked: chips.every(function(c){ return c.checked; }),
      labels: chips.map(function(c){ return c.getAttribute('data-flag'); }).join(','),
      aiSwitch: !!ai && ai.type === 'checkbox' && !ai.getAttribute('data-flag') };
  })()`);
  check('02 flags: 4 chips render in Controls (AI is a tier switch, not a flag)', f2.count === 4 && f2.checked && f2.labels.indexOf('weatherForecast') > -1 && f2.aiSwitch, f2);

  // MERGED-AI-CONTROL: the drawer switch is the single AI on/off. Default tier
  // is 'off' -> switch unchecked + FAB hidden. Turning it ON restores the last
  // non-off tier (default 'local') and shows the FAB; OFF -> tier 'off' + FAB
  // hidden. This exercises the 'can never disagree' invariant both ways.
  const f3a = await ev(`(function(){
    var fab = document.getElementById('ai-fab');
    var ai = document.querySelector('[data-action="tglAiTier"]');
    return { tier: (MMGR.AiWin && MMGR.AiWin.getAiCfg) ? MMGR.AiWin.getAiCfg().tier : null,
      fabHidden: !!fab && fab.classList.contains('is-hide'),
      chipChecked: !!ai && ai.checked };
  })()`);
  check('03a flags: default AI state = tier off, switch unchecked, FAB hidden', f3a.tier === 'off' && f3a.fabHidden && !f3a.chipChecked, f3a);

  await ev(`document.querySelector('[data-action="tglAiTier"]').click()`); await delay(300);
  const f3b = await ev(`(function(){
    var fab = document.getElementById('ai-fab');
    var ai = document.querySelector('[data-action="tglAiTier"]');
    return { tier: MMGR.AiWin.getAiCfg().tier,
      fabVisible: !!fab && !fab.classList.contains('is-hide'),
      chipChecked: !!ai && ai.checked };
  })()`);
  check('03b flags: AI switch ON -> tier local (restore default), FAB visible', f3b.tier === 'local' && f3b.fabVisible && f3b.chipChecked, f3b);

  await ev(`document.querySelector('[data-action="tglAiTier"]').click()`); await delay(300);
  const f3c = await ev(`(function(){
    var fab = document.getElementById('ai-fab');
    var ai = document.querySelector('[data-action="tglAiTier"]');
    return { tier: MMGR.AiWin.getAiCfg().tier,
      fabHidden: !!fab && fab.classList.contains('is-hide'),
      chipChecked: !!ai && ai.checked };
  })()`);
  check('03c flags: AI switch OFF -> tier off, FAB hidden again', f3c.tier === 'off' && f3c.fabHidden && !f3c.chipChecked, f3c);

  await ev(`document.querySelector('[data-action="tglFlag"][data-flag="monteCarlo"]').click()`); await delay(300);
  const f4 = await ev(`(function(){
    var btn = document.querySelector('[data-action="runMonteCarlo"]');
    return { off: MMGR.State.getState().flags.monteCarlo === false && !!btn && btn.classList.contains('is-hide') };
  })()`);
  await ev(`document.querySelector('[data-action="tglFlag"][data-flag="monteCarlo"]').click()`); await delay(300);
  const f4b = await ev(`(function(){
    var btn = document.querySelector('[data-action="runMonteCarlo"]');
    return { on: MMGR.State.getState().flags.monteCarlo === true && !!btn && !btn.classList.contains('is-hide') };
  })()`);
  check('04 flags: monteCarlo toggle hides + restores Run Simulation', f4.off && f4b.on, { off: f4, on: f4b });

  await ev(`document.querySelector('[data-action="tglFlag"][data-flag="ganttExport"]').click()`); await delay(250);
  const f5 = await ev(`(function(){
    var btn = document.querySelector('[data-action="exportGanttPNG"]');
    return { off: MMGR.State.getState().flags.ganttExport === false && !!btn && btn.classList.contains('is-hide') };
  })()`);
  check('05 flags: ganttExport off -> Export Chart hidden', f5.off, f5);

  await ev(`document.querySelector('[data-action="tglFlag"][data-flag="leadtimeLane"]').click()`); await delay(250);
  const f6 = await ev(`(function(){
    var chip = document.querySelector('[data-action="tglLeadtimeLane"]');
    var lane = document.getElementById('col-leadtime');
    // kbShowLeadtime is true in the seed, so a flag OFF must still hide the lane.
    return { off: MMGR.State.getState().flags.leadtimeLane === false && !!chip && chip.classList.contains('is-hide') && !!lane && lane.classList.contains('is-hide') };
  })()`);
  check('06 flags: leadtimeLane off -> chip + lane hidden even with kbShowLeadtime', f6.off, f6);

  await ev(`document.querySelector('[data-action="tglFlag"][data-flag="weatherForecast"]').click()`); await delay(250);
  const f7 = await ev(`(function(){
    var card = document.getElementById('weather-forecast-card');
    return { off: MMGR.State.getState().flags.weatherForecast === false && !!card && card.classList.contains('is-hide') };
  })()`);
  check('07 flags: weatherForecast off -> forecast card hidden', f7.off, f7);

  // persist + gate across a hard refresh. Flush the debounced autosave
  // explicitly (deterministic, no timing bet on the 300ms save timer).
  await ev('MMGR.State.save(true); true;'); await delay(200);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(4000);
  const f8 = await ev(`(function(){
    var s = MMGR.State.getState();
    var fab = document.getElementById('ai-fab');
    var card = document.getElementById('weather-forecast-card');
    var lane = document.getElementById('col-leadtime');
    var ai = document.querySelector('[data-action="tglAiTier"]');
    // MERGED-AI-CONTROL: AI 'off' is now tier === 'off' (persisted in
    // state.config.ai), and the switch + FAB must still agree after refresh.
    var aiTier = (MMGR.AiWin && MMGR.AiWin.getAiCfg) ? MMGR.AiWin.getAiCfg().tier : null;
    return { aiOff: aiTier === 'off', wxOff: s.flags.weatherForecast === false, ltOff: s.flags.leadtimeLane === false,
      fabHidden: !!fab && fab.classList.contains('is-hide'),
      cardHidden: !!card && card.classList.contains('is-hide'),
      laneHidden: !!lane && lane.classList.contains('is-hide'),
      aiChipSynced: !!ai && ai.checked === (aiTier !== 'off'),
      chipsSynced: Array.prototype.every.call(document.querySelectorAll('[data-action="tglFlag"]'), function(c){
        var want = s.flags[c.getAttribute('data-flag')] !== false; return c.checked === want;
      }) };
  })()`);
  check('08 flags: off-flags persist + gates + chips sync after hard refresh', f8.aiOff && f8.wxOff && f8.ltOff && f8.fabHidden && f8.cardHidden && f8.laneHidden && f8.aiChipSynced && f8.chipsSynced, f8);

  // ---- ERROR LOG -----------------------------------------------------------
  const e1 = await ev(`(async function(){
    MMGR.Errors.log('probe failure one', 'probeAction');
    await new Promise(function(r){ setTimeout(r, 150); });
    var s = MMGR.State.getState();
    var last = (s.errorLog || [])[(s.errorLog || []).length - 1];
    MMGR.Render.renderAll();
    var body = document.getElementById('errlog-body');
    return { len: (s.errorLog || []).length, hasTs: !!last && !!last.ts, hasMsg: last.msg === 'probe failure one',
      hasAction: last.action === 'probeAction', rendered: !!body && body.textContent.indexOf('probe failure one') > -1 };
  })()`);
  check('09 errors: log() persists ts/msg/action + renders', e1.len >= 1 && e1.hasTs && e1.hasMsg && e1.hasAction && e1.rendered, e1);

  const e2 = await ev(`(async function(){
    for (var i = 0; i < 25; i++) MMGR.Errors.log('spam ' + i, 'spam');
    await new Promise(function(r){ setTimeout(r, 150); });
    var s = MMGR.State.getState();
    var len = (s.errorLog || []).length;
    var first = s.errorLog[0] ? s.errorLog[0].msg : null;
    return { len: len, capped: len === 20, newest: s.errorLog[len - 1].msg === 'spam 24' };
  })()`);
  check('10 errors: capped at last 20', e2.len === 20 && e2.capped && e2.newest, e2);

  await ev(`document.querySelector('[data-action="clearErrorLog"]').click()`); await delay(250);
  const e3 = await ev(`(function(){
    var s = MMGR.State.getState();
    var body = document.getElementById('errlog-body');
    return { len: (s.errorLog || []).length, empty: body.textContent.indexOf('No client errors') > -1 };
  })()`);
  check('11 errors: Clear empties state + DOM', e3.len === 0 && e3.empty, e3);

  const e4 = await ev(`(async function(){
    window.dispatchEvent(new ErrorEvent('error', { message: 'synthetic global boom' }));
    await new Promise(function(r){ setTimeout(r, 150); });
    var s = MMGR.State.getState();
    var last = (s.errorLog || [])[(s.errorLog || []).length - 1];
    return { got: !!last && last.action === 'global' && last.msg.indexOf('synthetic global boom') > -1 };
  })()`);
  check('12 errors: window error hook records action=global', e4.got, e4);

  const e5 = await ev(`(async function(){
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.reject(new Error('synthetic rejection')), reason: new Error('synthetic rejection') }));
    await new Promise(function(r){ setTimeout(r, 150); });
    var s = MMGR.State.getState();
    var last = (s.errorLog || [])[(s.errorLog || []).length - 1];
    return { got: !!last && last.action === 'promise' && last.msg.indexOf('synthetic rejection') > -1 };
  })()`);
  check('13 errors: unhandledrejection hook records action=promise', e5.got, e5);

  // ---- NET ----------------------------------------------------------------
  const n1 = await ev(`(function(){
    return {
      net: typeof MMGR.Net === 'object' && typeof MMGR.Net.get === 'function' && typeof MMGR.Net.getJSON === 'function',
      cfg: typeof MMGR.Config === 'object',
      defaults: MMGR.Net.DEFAULTS.timeoutMs === 10000 && MMGR.Net.DEFAULTS.maxRetries === 3 && MMGR.Net.DEFAULTS.baseDelayMs === 800
    };
  })()`);
  check('14 net: MMGR.Net + MMGR.Config exist with documented defaults', n1.net && n1.cfg && n1.defaults, n1);

  const n2 = await ev(`(async function(){
    var calls = 0;
    var orig = window.fetch;
    window.fetch = function(){
      calls++;
      if (calls < 3) return Promise.reject(new Error('network down'));
      return Promise.resolve(new Response('ok-body', { status: 200 }));
    };
    try {
      var res = await MMGR.Net.get('https://api.example.test/retry', { maxRetries: 3, baseDelayMs: 30 });
      var text = await res.text();
      return { resolved: res.ok && text === 'ok-body', calls: calls };
    } finally { window.fetch = orig; }
  })()`);
  check('15 net: get() retries transient failures with backoff (3 calls)', n2.resolved && n2.calls === 3, n2);

  const n3 = await ev(`(async function(){
    var calls = 0;
    var orig = window.fetch;
    window.fetch = function(){ calls++; return Promise.reject(new Error('down')); };
    var rejected = false;
    try { await MMGR.Net.get('https://api.example.test/noretry', { maxRetries: 0 }); } catch (e) { rejected = true; }
    window.fetch = orig;
    return { rejected: rejected, calls: calls };
  })()`);
  check('16 net: maxRetries 0 -> single call, rejects', n3.rejected && n3.calls === 1, n3);

  const n4 = await ev(`(async function(){
    var calls = 0;
    var orig = window.fetch;
    window.fetch = function(){ calls++; return Promise.resolve(new Response('nf', { status: 404 })); };
    var res = await MMGR.Net.get('https://api.example.test/missing', { maxRetries: 3 });
    window.fetch = orig;
    return { status: res.status, calls: calls };
  })()`);
  check('17 net: 4xx passes through without retry', n4.status === 404 && n4.calls === 1, n4);

  // ---- IDEMPOTENT IMPORT -----------------------------------------------------
  const i1 = await ev(`(async function(){
    var st0 = MMGR.State.getState();
    var before = st0.tasks.length;
    var src = document.getElementById('wi-source');
    src.value = 'QA Idem Phase\\n  QA Idem One\\n  QA Idem Two\\n';
    MMGR.Tasks.wiCommit();
    var after1 = MMGR.State.getState().tasks.length;
    var names = ['QA Idem Phase', 'QA Idem One', 'QA Idem Two'];
    var count1 = MMGR.State.getState().tasks.filter(function(t){ return names.indexOf(t.name) > -1; }).length;
    src.value = 'QA Idem Phase\\n  QA Idem One\\n  QA Idem Two\\n';
    MMGR.Tasks.wiCommit();
    var after2 = MMGR.State.getState().tasks.length;
    var count2 = MMGR.State.getState().tasks.filter(function(t){ return names.indexOf(t.name) > -1; }).length;
    var toast = document.querySelector('.toast');
    var s2 = MMGR.State.getState();
    s2.tasks = s2.tasks.filter(function(t){ return names.indexOf(t.name) === -1; });
    MMGR.Render.renderAll();
    return { added3: after1 === before + 3 && count1 === 3, secondIsZero: after2 === after1 && count2 === 3,
      toastMentionsSkipped: !!toast && toast.textContent.indexOf('already present') > -1 };
  })()`);
  check('18 import: same outline twice -> no duplicates, second run all skipped', i1.added3 && i1.secondIsZero && i1.toastMentionsSkipped, i1);

  const i2 = await ev(`(async function(){
    var src = document.getElementById('id-source');
    src.value = 'QA Dated (5 d) [2026-01-01 \u2192 2026-01-05]';
    MMGR.Tasks.idCommit();
    var c1 = MMGR.State.getState().tasks.filter(function(t){ return t.name === 'QA Dated'; }).length;
    src.value = 'QA Dated (7 d) [2026-02-01 \u2192 2026-02-07]';
    MMGR.Tasks.idCommit();
    var c2 = MMGR.State.getState().tasks.filter(function(t){ return t.name === 'QA Dated'; }).length;
    var t = MMGR.State.getState().tasks.find(function(x){ return x.name === 'QA Dated'; });
    var upd = !!t && t.startDate === '2026-02-01' && t.endDate === '2026-02-07' && t.duration === '7';
    var s2 = MMGR.State.getState();
    s2.tasks = s2.tasks.filter(function(x){ return x.name !== 'QA Dated'; });
    MMGR.Render.renderAll();
    return { first: c1 === 1, secondStillOne: c2 === 1, updatedInPlace: upd };
  })()`);
  check('19 import: dated re-import updates in place, no duplicate', i2.first && i2.secondStillOne && i2.updatedInPlace, i2);

  // ---- CONFIG + AI CONTEXT ---------------------------------------------------
  const c1 = await ev(`(function(){
    var cfg = MMGR.Config;
    var merged = MMGR.Net.getConfig({ config: { ai: { endpoint: 'https://future.example/ai' }, net: { timeoutMs: 5000 } } });
    return { aiEmpty: cfg.ai.endpoint === '' && cfg.ai.apiKey === '',
      mergeWorks: merged.ai.endpoint === 'https://future.example/ai' && merged.net.timeoutMs === 5000 && merged.net.maxRetries === 3 };
  })()`);
  check('20 config: MMGR.Config empty by default + getConfig merges state overrides', c1.aiEmpty && c1.mergeWorks, c1);

  const a1 = await ev(`(function(){
    var text = MMGR.AiWin.buildContext();
    var schema = MMGR.AiWin.CONTEXT_SCHEMA;
    var missing = schema.sections.filter(function(sec){ return text.indexOf('## ' + sec) === -1; });
    return { hasText: text.length > 50, sectionsOk: missing.length === 0, schemaSections: schema.sections.length === 7 };
  })()`);
  check('21 ai: buildContext emits every CONTEXT_SCHEMA section', a1.hasText && a1.sectionsOk && a1.schemaSections, a1);

  const a2 = await ev(`(function(){
    MMGR.AiWin.attachContext();
    var ctx = document.getElementById('ai-ctx');
    return { filled: !!ctx && ctx.value.indexOf('## PROJECT') > -1 && ctx.value.length > 50 };
  })()`);
  check('22 ai: attachContext fills the context textarea', a2.filled, a2);

  // ---- READONLY GATING OF NEW ACTIONS ----------------------------------------
  await ev(`(function(){ localStorage.setItem('mmgr_scope_demo-project','readonly'); return true; })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(4000);
  const r1 = await ev(`(function(){
    // MERGED-AI-CONTROL: the drawer switch mutates state.config.ai.tier, so
    // like every other write it must be refused in view-only mode.
    var before = (MMGR.AiWin && MMGR.AiWin.getAiCfg) ? MMGR.AiWin.getAiCfg().tier : null;
    var chip = document.querySelector('[data-action="tglAiTier"]');
    chip.click();
    var after = (MMGR.AiWin && MMGR.AiWin.getAiCfg) ? MMGR.AiWin.getAiCfg().tier : null;
    var toast = document.querySelector('.toast');
    return { blocked: before === after && before === 'off', toastShown: !!toast && toast.textContent.indexOf('View-only') > -1 };
  })()`);
  check('23 readonly: AI master switch refused with toast, tier unchanged', r1.blocked && r1.toastShown, r1);

  await ev(`(function(){ localStorage.setItem('mmgr_scope_demo-project','full'); return true; })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);

  const failed = results.filter(r => !r.val);
  log('V11_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
