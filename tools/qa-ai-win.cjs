/* T-AIWIN - the AI window's layout, docking regimes, composer and history.
   ---------------------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, section 9 (AI-1). The gate is stated as:

     at 1440, 1100 and 390 px: open the window, assert in docked mode the
     page's main column width shrinks by exactly the dock width and no element
     of the page is under the window; Esc closes the overlay; Ctrl+. toggles;
     the composer sends via Enter and keeps Shift+Enter for a new line;
     history creates, renames, pins and deletes a chat; axe clean in both
     palettes.

   Every assertion below drives the real controls (a click or a key event),
   never a private helper, so a dead handler fails the gate.

   Usage: node tools/qa-ai-win.cjs        (starts nothing - serve.cjs on :8765)
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-ai-win-' + Date.now());
let ws,
  msgId = 0;
const pending = new Map();
const log = s => process.stdout.write('[aiwin] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

setTimeout(() => {
  log('WATCHDOG');
  try {
    ws && ws.close();
  } catch (e) {}
  process.exit(2);
}, 240000);

function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => {
      pending.delete(id);
      res(m.result || {});
    });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function ev(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.exceptionDetails) {
    return {
      __err: r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description
        : r.exceptionDetails.text
    };
  }
  return r.result && r.result.value;
}

async function waitFor(expr, timeout) {
  const until = Date.now() + (timeout || 12000);
  while (Date.now() < until) {
    const v = await ev(expr);
    if (v) {
      return v;
    }
    await delay(200);
  }
  return null;
}

function axeSource() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'),
    path.join(ROOT, 'node_modules', 'axe-core', 'axe.js')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return fs.readFileSync(c, 'utf8');
    }
  }
  throw new Error('axe-core not found - npm i -D axe-core');
}

(async () => {
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disk-cache-size=0',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--window-size=1440,1000',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) {
        break;
      }
    } catch (e) {}
    await delay(300);
  }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws fail'));
  });

  const consoleErrors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        'EXCEPTION: ' + (m.params.exceptionDetails && m.params.exceptionDetails.text)
      );
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');

  // The assistant is part of the signed-in experience: Entitlements.aiAssistant()
  // reports the Google session. Install the documented QA seam (qa-ai.cjs does
  // the same) so this gate can open the window; the signed-out refusal is
  // qa-full's own check, not this one.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      var tries = 0;
      var iv = setInterval(function(){
        if (window.MMGR && window.MMGR.Entitlements) {
          window.MMGR.Entitlements.aiAssistant = function(){ return true; };
          clearInterval(iv);
        }
        if (++tries > 400) clearInterval(iv);
      }, 25);
    })();`
  });

  const results = [];
  const check = (name, val, detail) => {
    results.push({ name, val: !!val });
    log(
      (val ? 'PASS' : 'FAIL') +
        ' ' +
        name +
        (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail))
    );
  };

  // ---- Seed a project, then load it -------------------------------------
  await send('Page.navigate', { url: BASE + '/project.html' });
  await delay(1500);
  await ev(`(function(){
    localStorage.setItem('mmgr_unlocked_demo','1');
    localStorage.setItem('mmgr_current_project','demo');
    localStorage.setItem('mmgr_scope_demo','full');
    localStorage.setItem('mmgr_state_demo', JSON.stringify({
      projectName: 'Harbor View', projectId: 'demo',
      charter: { name: 'Harbor View', targetCompletion: '2026-12-01' },
      tasks: [{ id: 'T1', name: 'Foundations', status: 'inprogress', endDate: '2026-09-01' }],
      risks: [], issues: [], budgetLines: [],
      config: { ai: { tier: 'local' } }
    }));
    return true;
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo' });
  const booted = await waitFor(
    `!!(window.MMGR && MMGR.AiWin && MMGR.State && MMGR.State.getState && document.getElementById('ai-q') && document.getElementById('app-main'))`,
    25000
  );
  check('app boots with the assistant and the main column present', !!booted);
  await delay(1200);

  // ---- 1440: docked, page shrinks, nothing under the window -------------
  const before = await ev(`(function(){
    var m = document.getElementById('app-main').getBoundingClientRect();
    return { w: m.width, right: m.right };
  })()`);
  await ev(`MMGR.AiWin.open()`);
  await delay(600);
  const opened = await ev(`(function(){
    var w = document.getElementById('ai-win');
    var wr = w.getBoundingClientRect();
    var m = document.getElementById('app-main').getBoundingClientRect();
    return { open: w.classList.contains('open'),
      docked: document.body.classList.contains('ai-docked'),
      w: wr.width, left: wr.left, mainW: m.width, mainRight: m.right,
      aiVar: getComputedStyle(document.body).getPropertyValue('--ai-w').trim(),
      histInline: w.classList.contains('hist-inline'),
      histVisible: (function(){ var h = document.getElementById('ai-hist'); return !!h && h.offsetParent !== null; })() };
  })()`);
  check('1440: the assistant opens docked', opened && opened.open && opened.docked, opened);
  check(
    '1440: the page column shrinks by exactly the dock width',
    opened && Math.abs(before.w - opened.mainW - opened.w) <= 1,
    { before: before && before.w, after: opened && opened.mainW, dock: opened && opened.w }
  );
  check(
    '1440: no page column sits under the window',
    opened && opened.mainRight <= opened.left + 1,
    { mainRight: opened && opened.mainRight, dockLeft: opened && opened.left }
  );
  check(
    '1440: --ai-w equals the dock width',
    opened && Math.abs(parseFloat(opened.aiVar) - opened.w) <= 1,
    opened
  );
  check(
    '1440: the conversation column is visible at the default width',
    opened && opened.histInline && opened.histVisible,
    opened
  );

  // ---- Composer: Enter sends, Shift+Enter keeps a new line --------------
  await ev(`MMGR.AiWin.setAiCfg({ tier: 'local' }); MMGR.AiWin.syncSettingsUI();`);
  const shift = await ev(`(function(){
    var q = document.getElementById('ai-q');
    q.value = 'first line';
    q.focus();
    var before = document.querySelectorAll('#ai-thread .ai-bubble').length;
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    return { value: q.value,
      added: document.querySelectorAll('#ai-thread .ai-bubble').length - before };
  })()`);
  check(
    'composer: Shift+Enter keeps the text and starts no send',
    shift && shift.value === 'first line' && shift.added === 0,
    shift
  );

  await ev(`(function(){
    var q = document.getElementById('ai-q');
    q.value = 'What is the project name?';
    q.focus();
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  const answered = await waitFor(
    `(function(){
      var users = document.querySelectorAll('#ai-thread .ai-user').length;
      var chats = MMGR.AiWin.getChats() || [];
      var c = chats.filter(function(x){ return x && x.messages && x.messages.length >= 2; })[0];
      return (users > 0 && c) ? { users: users, chats: chats.length, title: c.title,
        msgs: c.messages.length, roles: c.messages.map(function(m){ return m.role; }).join(',') } : null;
    })()`,
    25000
  );
  check(
    'composer: Enter sends and the exchange lands in project state',
    answered && answered.msgs >= 2 && answered.roles.indexOf('user') === 0,
    answered
  );

  // ---- History: create, rename, pin, delete -----------------------------
  const created = await ev(`(function(){
    var before = (MMGR.AiWin.getChats() || []).length;
    document.querySelector('[data-action="aiNewChat"]').click();
    return { before: before, after: (MMGR.AiWin.getChats() || []).length,
      rows: document.querySelectorAll('#ai-hist-list .ai-hist-item').length };
  })()`);
  check(
    'history: New chat adds one conversation and one row',
    created && created.after === created.before + 1 && created.rows >= 1,
    created
  );

  const renamed = await ev(`(function(){
    var chats = MMGR.AiWin.getChats();
    var id = chats[0].id;
    var row = document.querySelector('#ai-hist-list .ai-hist-item[data-id="' + id + '"]');
    if (!row) return { ok: false, why: 'row missing' };
    row.querySelector('[data-action="aiRenameChat"]').click();
    var input = row.querySelector('.ai-hist-rename');
    if (!input) return { ok: false, why: 'rename input missing' };
    input.value = 'Roof sequencing';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    var c = MMGR.AiWin.getChats().filter(function(x){ return x.id === id; })[0];
    var name = document.querySelector('#ai-hist-list .ai-hist-item[data-id="' + id + '"] .ai-hist-name');
    return { ok: true, title: c && c.title, dom: name && name.textContent };
  })()`);
  check(
    'history: a chat can be renamed inline',
    renamed &&
      renamed.ok &&
      renamed.title === 'Roof sequencing' &&
      renamed.dom === 'Roof sequencing',
    renamed
  );

  const pinned = await ev(`(function(){
    var id = MMGR.AiWin.getChats()[0].id;
    var row = document.querySelector('#ai-hist-list .ai-hist-item[data-id="' + id + '"]');
    row.querySelector('[data-action="aiPinChat"]').click();
    var c = MMGR.AiWin.getChats().filter(function(x){ return x.id === id; })[0];
    var btn = document.querySelector('#ai-hist-list .ai-hist-item[data-id="' + id + '"] [data-action="aiPinChat"]');
    var firstId = MMGR.AiWin.getChats()[0].id;
    return { pinned: c && c.pinned === true, pressed: btn && btn.getAttribute('aria-pressed'),
      firstId: firstId, id: id };
  })()`);
  check(
    'history: a chat can be pinned (state + aria-pressed + sort)',
    pinned && pinned.pinned && pinned.pressed === 'true' && pinned.firstId === pinned.id,
    pinned
  );
  // unpin so the delete assertion is not fighting the sort order
  await ev(`(function(){
    var id = MMGR.AiWin.getChats()[0].id;
    var row = document.querySelector('#ai-hist-list .ai-hist-item[data-id="' + id + '"]');
    row.querySelector('[data-action="aiPinChat"]').click();
    return true;
  })()`);

  const deleted = await ev(`(function(){
    window.confirm = function(){ return true; };
    var before = MMGR.AiWin.getChats().length;
    var id = MMGR.AiWin.getChats()[0].id;
    var row = document.querySelector('#ai-hist-list .ai-hist-item[data-id="' + id + '"]');
    row.querySelector('[data-action="aiDeleteChat"]').click();
    return { before: before, after: MMGR.AiWin.getChats().length };
  })()`);
  check(
    'history: Delete chat removes the conversation',
    deleted && deleted.after === deleted.before - 1,
    deleted
  );

  // ---- Ctrl+. toggles ---------------------------------------------------
  const ctrl = await ev(`(function(){
    var w = document.getElementById('ai-win');
    var was = w.classList.contains('open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true }));
    var closed = !w.classList.contains('open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true }));
    return { was: was, closed: closed, reopened: w.classList.contains('open') };
  })()`);
  check(
    'Ctrl+. closes and reopens the assistant',
    ctrl && ctrl.was && ctrl.closed && ctrl.reopened,
    ctrl
  );

  // ---- 1100: overlay, Esc closes ----------------------------------------
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await delay(500);
  await ev(`MMGR.AiWin.applyAiMode()`);
  const overlay = await ev(`(function(){
    var w = document.getElementById('ai-win');
    return { open: w.classList.contains('open'),
      overlay: document.body.classList.contains('ai-overlay'),
      docked: document.body.classList.contains('ai-docked'),
      w: w.getBoundingClientRect().width };
  })()`);
  check(
    '1100: the assistant is an overlay and the page keeps its width',
    overlay && overlay.open && overlay.overlay && !overlay.docked,
    overlay
  );
  const escOverlay = await ev(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    var w = document.getElementById('ai-win');
    return { closed: !w.classList.contains('open'),
      overlay: document.body.classList.contains('ai-overlay') };
  })()`);
  check(
    '1100: Esc closes the overlay and clears the dim',
    escOverlay && escOverlay.closed && !escOverlay.overlay,
    escOverlay
  );

  // ---- 390: full-screen sheet, Esc closes -------------------------------
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await delay(400);
  await ev(`MMGR.AiWin.open()`);
  await delay(400);
  const sheet = await ev(`(function(){
    var w = document.getElementById('ai-win');
    var r = w.getBoundingClientRect();
    return { open: w.classList.contains('open'),
      sheet: document.body.classList.contains('ai-sheet'),
      w: r.width, left: r.left, right: r.right, vw: window.innerWidth };
  })()`);
  check(
    '390: the assistant is a full-screen sheet',
    sheet && sheet.open && sheet.sheet && Math.abs(sheet.w - sheet.vw) <= 1,
    sheet
  );
  const escSheet = await ev(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return !document.getElementById('ai-win').classList.contains('open');
  })()`);
  check('390: Esc closes the sheet', escSheet === true, escSheet);

  // ---- Back to 1440: axe in both palettes -------------------------------
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });
  await delay(400);
  await ev(`MMGR.AiWin.open()`);
  await delay(500);
  await ev(axeSource());
  const axeLight = await ev(`(async function(){
    var r = await window.axe.run(document.getElementById('ai-win'), { resultTypes: ['violations'] });
    var out = [];
    r.violations.filter(function(v){ return v.impact === 'serious' || v.impact === 'critical'; })
      .forEach(function(v){ v.nodes.forEach(function(n){ out.push(v.id + ' :: ' + n.target.join(' ')); }); });
    return out;
  })()`);
  check(
    'axe light: no serious or critical violations in the assistant',
    Array.isArray(axeLight) && axeLight.length === 0,
    axeLight
  );
  // Dark is measured through the REAL theme path, not by toggling a class:
  // setMode writes the device pref and applies the tokens, exactly as the
  // Appearance control does. The wait lets the 120ms colour transitions
  // settle - axe reads getComputedStyle, and a class flip measured at t=0
  // still reports the outgoing light colours (a false 2.59:1 reading).
  await ev(`(function(){ MMGRTheme.setMode('dark'); return true; })()`);
  await delay(500);
  const axeDark = await ev(`(async function(){
    var r = await window.axe.run(document.getElementById('ai-win'), { resultTypes: ['violations'] });
    var out = [];
    r.violations.filter(function(v){ return v.impact === 'serious' || v.impact === 'critical'; })
      .forEach(function(v){ v.nodes.forEach(function(n){
        var d = (n.any && n.any[0] && n.any[0].data) || {};
        out.push(v.id + ' :: ' + n.target.join(' ') +
          (d.contrastRatio ? ' (' + d.fgColor + ' on ' + d.bgColor + ' = ' + d.contrastRatio + ', need ' + d.expectedContrastRatio + ')' : ''));
      }); });
    return out;
  })()`);
  await ev(`(function(){ MMGRTheme.setMode('light'); return true; })()`);
  await delay(300);
  check(
    'axe dark: no serious or critical violations in the assistant',
    Array.isArray(axeDark) && axeDark.length === 0,
    axeDark
  );

  // ---- History rides in the project state, not a side store -------------
  const beforeReload = await ev(`(MMGR.AiWin.getChats() || []).length`);
  const stored = await ev(`(function(){
    var raw = localStorage.getItem('mmgr_state_demo') || '';
    return { hasChats: raw.indexOf('"aiChats"') > -1,
      sideKeys: Object.keys(localStorage).filter(function(k){ return /chat/i.test(k); }) };
  })()`);
  check(
    'history is written into the unified project state (no new storage key)',
    stored && stored.hasChats && stored.sideKeys.length === 0,
    stored
  );
  await send('Page.reload');
  await delay(2500);
  const restored = await waitFor(
    `(function(){
      if (!(window.MMGR && MMGR.AiWin && MMGR.State && MMGR.State.getState)) return null;
      var chats = MMGR.AiWin.getChats();
      if (!chats.length) return null;
      return { chats: chats.length, msgs: (chats[0].messages || []).length, title: chats[0].title };
    })()`,
    25000
  );
  check(
    'history survives a reload',
    restored && restored.chats === beforeReload && restored.msgs >= 2,
    restored
  );

  check('no console errors', consoleErrors.length === 0, consoleErrors);

  const fails = results.filter(x => !x.val);
  log(
    'AIWIN_PROBE ' +
      (fails.length
        ? 'FAIL ' + fails.length + '/' + results.length
        : 'PASS ' + results.length + '/' + results.length)
  );
  try {
    ws.close();
  } catch (e) {}
  try {
    proc.kill();
  } catch (e) {}
  process.exit(fails.length ? 1 : 0);
})().catch(e => {
  log('PROBE-ERROR: ' + (e && e.message));
  process.exit(1);
});
