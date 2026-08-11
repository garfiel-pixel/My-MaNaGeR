/* AI-WINDOW-POLISH probe — verifies (1) the decluttered header cluster, (2)
   the compact cloud-connection row, (3) the per-answer Copy button on bot
   bubbles: it exists, copies the EXACT answer text to the clipboard, and
   shows the Copied feedback state. Usage: node tools/_probe-ai-polish.cjs
   (serve.cjs must be on :8765). */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9244;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-ai-polish-' + Date.now());
let ws, msgId = 0; const pending = new Map();
const log = (s) => process.stdout.write('[polish] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 90000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await send('Runtime.enable'); await send('Page.enable');
  try { await send('Browser.grantPermissions', { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch (e) {}

  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails && m.params.exceptionDetails.text));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  const results = [];
  const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(2500);
  await ev(`(function(){
    localStorage.setItem('mmgr_unlocked_demo','1');
    localStorage.setItem('mmgr_current_project','demo');
    localStorage.setItem('mmgr_scope_demo','full');
    localStorage.setItem('mmgr_state_demo', JSON.stringify({charter:{name:'Demo Tower', targetCompletion:'2026-12-01'}, tasks:[{id:'T1',name:'Foundations',status:'inprogress',endDate:'2026-09-01'},{id:'T2',name:'Steel',status:'todo',endDate:'2026-10-15'}], risks:[{id:'R1',description:'Weather delay',probability:'High',impact:'High'}], issues:[], budgetLines:[], config:{ai:{tier:'local'}} }));
    return true;
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo' }); await delay(4000);

  // ---- 1. Polished layout assertions ----
  const lay = await ev(`(function(){
    var right = document.querySelector('.ai-head-right');
    var hasLabel = !!document.querySelector('.ai-conn-row-label');
    var connRow = document.getElementById('ai-cfg-cloud');
    var tier = document.getElementById('ai-tier');
    var engine = document.getElementById('ai-engine-pill');
    var api = document.getElementById('ai-api-pill');
    var sec = document.querySelector('.ai-byo-sec');
    // syncSettingsUI is what actually drives row visibility (runs on window
    // open and every tier change) — invoke it so the assertion mirrors the
    // real on-screen state. tier is seeded 'local'.
    MMGR.AiWin.syncSettingsUI();
    return { rightExists: !!right,
      rightHasTier: right && !!right.querySelector('#ai-tier'),
      rightHasEngine: right && !!right.querySelector('#ai-engine-pill'),
      rightHasApi: right && !!right.querySelector('#ai-api-pill'),
      labelGone: !hasLabel,
      connGoneWhenLocal: !connRow || connRow.classList.contains('is-hide'),
      secKept: !!sec && sec.textContent.indexOf('session only') > -1,
      tierSel: !!tier, engine: !!engine, api: !!api };
  })()`);
  check('polish: header control cluster groups tier + engine pill + API pill', lay.rightExists && lay.rightHasTier && lay.rightHasEngine && lay.rightHasApi, lay);
  check('polish: verbose cloud-connection label removed', lay.labelGone === true, lay);
  check('polish: cloud row hidden on local tier + .ai-byo-sec security copy kept', lay.connGoneWhenLocal && lay.secKept, lay);

  // ---- 2. Cloud tier reveals the compact row (no label) ----
  const cld = await ev(`(function(){
    MMGR.AiWin.setAiCfg({ tier: 'cloud' }); MMGR.AiWin.syncSettingsUI();
    var row = document.getElementById('ai-cfg-cloud');
    return { shown: row && !row.classList.contains('is-hide'),
      labelGone: !document.querySelector('.ai-conn-row-label'),
      chip: !!document.getElementById('ai-byo-status'),
      prov: (document.getElementById('ai-byo-provider')||{}).value };
  })()`);
  check('polish: cloud tier shows compact connect row (no label, chip + provider intact)', cld.shown && cld.labelGone && cld.chip && cld.prov === 'openai', cld);
  await ev('MMGR.AiWin.setAiCfg({ tier: "local" }); MMGR.AiWin.syncSettingsUI();');

  // ---- 3a. Clipboard support: headless Chrome refuses the async Clipboard
  // API unless the page is reported focused — emulate focus, then prove both
  // (i) the API round-trips and (ii) the app hands it the EXACT answer text
  // (capture patch). The execCommand fallback is covered by the Copied-state
  // check. ----
  try { await send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) {}
  const selfTest = await ev(`(async function(){
    try {
      await navigator.clipboard.writeText('probe-self-test-123');
      var back = await navigator.clipboard.readText();
      return { roundTrip: back === 'probe-self-test-123', back: back };
    } catch (e) { return { roundTrip: false, err: (e && e.message) || String(e) }; }
  })()`);
  check('env: clipboard write->read round-trip works (focused page)', selfTest.roundTrip === true, selfTest);

  // ---- 3. Per-answer Copy flow ----
  const r = await ev(`(async function(){
    var q = document.getElementById('ai-q');
    q.value = 'What is the completion status and what are the top risks?';
    var res = await MMGR.AiWin.runQuestion();
    var bubble = null, copyBtn = null;
    for (var i = 0; i < 80; i++) {
      await new Promise(function(r2){ setTimeout(r2, 100); });
      bubble = document.querySelector('#ai-thread .ai-bot:not(.ai-welcome)');
      copyBtn = document.querySelector('#ai-thread .ai-bot:not(.ai-welcome) .ai-copy-btn');
      if (bubble && copyBtn) break;
    }
    var stored = bubble ? bubble.dataset.copyText : null;
    var matches = !!stored && res.ok && stored === res.text;
    var metaHasBtn = !!copyBtn;
    var btnTxt = copyBtn ? copyBtn.textContent : null;
    // Capture exactly what the app routes to the clipboard API.
    window.__clipCaptured = null;
    var origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = function(t){ window.__clipCaptured = t; return origWrite(t).catch(function(){ return Promise.resolve(); }); };
    if (copyBtn) copyBtn.click();
    await new Promise(function(r2){ setTimeout(r2, 250); });
    var feedback = copyBtn ? copyBtn.classList.contains('is-copied') : false;
    var feedbackTxt = copyBtn ? copyBtn.textContent : null;
    var captured = window.__clipCaptured;
    var clip = '';
    try { clip = await navigator.clipboard.readText(); } catch (e) { clip = 'READ-ERR:' + (e && e.message ? e.message : e); }
    // Windows normalizes LF -> CRLF in the system clipboard; compare with \r
    // stripped so a byte-identical copy modulo line endings counts as exact.
    var norm = String(clip).replace(/\\r/g, '');
    return { ok: res.ok, hasBubble: !!bubble, metaHasBtn: metaHasBtn, btnTxt: btnTxt,
      storedMatches: matches, feedback: feedback, feedbackTxt: feedbackTxt,
      capturedExact: !!stored && captured === stored,
      capturedLen: captured ? captured.length : 0,
      clipMatches: !!stored && norm === stored, clipLen: (clip || '').length,
      storedLen: stored ? stored.length : 0,
      clipHead: String(clip).slice(0, 60), storedHead: stored ? stored.slice(0, 60) : '' };
  })()`);
  check('copy: bot bubble has a Copy button in its meta row', r.hasBubble && r.metaHasBtn && /Copy/.test(r.btnTxt || ''), r);
  check('copy: stored text equals the exact AI answer', r.storedMatches === true, r);
  check('copy: click flips button to green Copied state', r.feedback === true && /Copied/.test(r.feedbackTxt || ''), r);
  check('copy: app routes the exact answer text to the clipboard API', r.capturedExact === true && r.capturedLen === r.storedLen, r);
  check('copy: clipboard holds the exact answer text', r.clipMatches === true, r);

  await send('Page.captureScreenshot', { format: 'png' }).then(async (s) => {
    if (s && s.data) {
      const fs = require('fs');
      fs.writeFileSync(path.join(require('os').tmpdir(), 'ai-polished.png'), Buffer.from(s.data, 'base64'));
      log('screenshot -> ' + path.join(require('os').tmpdir(), 'ai-polished.png'));
    }
  });

  check('copy: no console errors', consoleErrors.length === 0, consoleErrors);
  const fails = results.filter(x => !x.val);
  log('POLISH_PROBE ' + (fails.length ? 'FAIL ' + fails.length + '/' + results.length : 'PASS ' + results.length + '/' + results.length));
  try { ws.close(); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
})().catch(e => { log('PROBE-ERROR: ' + (e && e.message)); process.exit(1); });
