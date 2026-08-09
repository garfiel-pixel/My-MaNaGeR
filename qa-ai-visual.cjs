/* ============================================================
   AI WINDOW visual smoke — verifies the chat-style redesign:
   window opens, welcome bubble, preset chips, engine pill,
   chat input bar, user/bot bubbles after a local run, and a
   screenshot. Usage: node qa-ai-visual.cjs (server on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9242;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-ai-v-' + Date.now());
let ws, msgId = 0; const pending = new Map();
const log = (s) => process.stdout.write('[aivis] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 90000);
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

  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails && m.params.exceptionDetails.text));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  // Seed the unlock + a small demo project, then load the project page.
  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(2500);
  await ev(`(function(){
    localStorage.setItem('mmgr_unlocked_demo','1');
    localStorage.setItem('mmgr_current_project','demo');
    localStorage.setItem('mmgr_scope_demo','full');    // MERGED-AI-CONTROL (audit 1.2): seed tier 'local' so the fab is genuinely
    // visible — the old default (no config.ai) left the fab hidden behind
    // is-hide, and a programmatic .click() on display:none would mask a real
    // "fab missing" regression.
    localStorage.setItem('mmgr_state_demo', JSON.stringify({charter:{name:'Demo Tower', targetCompletion:'2026-12-01'}, tasks:[{id:'T1',name:'Foundations',status:'inprogress',endDate:'2026-09-01'},{id:'T2',name:'Steel',status:'todo',endDate:'2026-10-15'}], risks:[{id:'R1',description:'Weather delay',probability:'High',impact:'High'}], issues:[], budgetLines:[], config:{ai:{tier:'local'}} }));
    return true;
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo' }); await delay(4000);

  const results = [];
  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // Open the AI window.
  const o = await ev(`(function(){
    var fab = document.getElementById('ai-fab');
    return { fabVisible: !!fab && !fab.classList.contains('is-hide') };
  })()`);
  // MERGED-AI-CONTROL: with tier seeded 'local' the fab must be genuinely
  // visible before we click it — no display:none workaround.
  await ev(`document.getElementById('ai-fab').click(); true;`); await delay(600);
  const oOpen = await ev(`(function(){
    return { open: document.getElementById('ai-win').classList.contains('open') };
  })()`);
  const a = await ev(`(function(){
    var th = document.getElementById('ai-thread');
    var welcome = document.getElementById('ai-welcome');
    var chips = document.querySelectorAll('#ai-presets .ai-chip').length;
    var pill = document.getElementById('ai-engine-pill');
    var pillLbl = document.getElementById('ai-engine-pill-label');
    var q = document.getElementById('ai-q');
    var send = document.querySelector('[data-action="aiRun"]');
    var adv = document.querySelector('.ai-adv');
    return {
      thread: !!th,
      welcome: !!welcome && welcome.offsetParent !== null,
      chips: chips,
      pill: !!pill && !!pillLbl,
      inputBar: !!q && !!send,
      advCollapsed: !!adv && !adv.open
    };
  })()`);
  check('AI window opens with chat layout', o.fabVisible === true && oOpen.open === true, { fabVisible: o.fabVisible, open: oOpen.open });
  check('Welcome bubble visible + thread present', a.thread && a.welcome, a);
  check('Preset chips rendered (>=10) + engine pill + input bar + collapsed advanced', a.chips >= 10 && a.pill && a.inputBar && a.advCollapsed, a);

  // Switch to the local tier, send a free-form question, verify bubbles.
  const r = await ev(`(async function(){
    var G = window.MMGR;
    G.AiWin.setAiCfg({ tier: 'local' });
    G.AiWin.syncSettingsUI();
    var q = document.getElementById('ai-q');
    q.value = 'What is the completion status and what are the top risks?';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    var typingAppeared = false;
    var tid = setInterval(function(){
      if (document.querySelector('.ai-typing')) typingAppeared = true;
    }, 40);
    document.querySelector('[data-action="aiRun"]').click();
    var userBubble = null, botBubble = null, typing = null, trace = null;
    for (var i = 0; i < 80; i++) {
      await new Promise(function(res){ setTimeout(res, 100); });
      userBubble = document.querySelector('#ai-thread .ai-user');
      botBubble = document.querySelector('#ai-thread .ai-bot:not(.ai-welcome) .ai-text');
      typing = document.querySelector('.ai-typing');
      if (userBubble && botBubble && !typing) break;
    }
    clearInterval(tid);
    trace = document.querySelector('#ai-thread .ai-trace-inline');
    var pillNow = document.getElementById('ai-engine-pill-label').textContent;
    return {
      user: !!userBubble, bot: !!botBubble, typing: typingAppeared,
      pill: pillNow, trace: !!trace,
      userTxt: userBubble ? userBubble.textContent.slice(0, 40) : '',
      botTxt: botBubble ? botBubble.textContent.slice(0, 60) : ''
    };
  })()`);
  check('Send: typing indicator appeared', r.typing === true, r);
  check('Send: user + assistant bubbles rendered with trace', r.user === true && r.bot === true && r.trace === true, r);
  check('Engine pill reflects Local tier', (r.pill || '').indexOf('Local') > -1, r);
  check('Bot answer contains real state data', (r.botTxt || '').length > 10 && /Completion|Risks|complete/i.test(r.botTxt || ''), r);

  // Screenshot for the visual record.
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.data) {
    fs.writeFileSync(path.join(require('os').tmpdir(), 'ai-window.png'), Buffer.from(shot.data, 'base64'));
    log('screenshot -> ' + path.join(require('os').tmpdir(), 'ai-window.png'));
  }

  // Clear + reopen must restore the welcome state.
  const c = await ev(`(function(){
    document.querySelector('[data-action="aiClear"]').click();
    var welcome = document.getElementById('ai-welcome');
    var bubbles = document.querySelectorAll('#ai-thread .ai-bubble').length;
    return { welcome: welcome && welcome.offsetParent !== null, bubbles: bubbles };
  })()`);
  check('Clear resets to welcome state', c.welcome === true && c.bubbles === 1, c);

  await delay(300);
  check('no console errors', consoleErrors.length === 0, consoleErrors);

  const failed = results.filter(r2 => !r2.val);
  log('AIVIS ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
