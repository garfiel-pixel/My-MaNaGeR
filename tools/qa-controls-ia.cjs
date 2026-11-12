/* ============================================================
   tools/qa-controls-ia.cjs - Controls drawer IA gate (T-12,
   UI-IA-AND-MCP-DIRECTIVE-2026-11-11, Do #6).

   Proves the final 6-group, tabbed Controls drawer shape:

     C1  6 [data-ctl-group] nodes, each with >= 2 [data-ctl-tab].
     C2  exactly one [data-ctl-panel] visible (no is-hide) per group.
     C3  every preserved slot id exists inside #db-ctrl exactly once.
     C4  no .sr / .fmt-card / #errlog-body / #data-account /
         #template-list orphaned outside a .ctl-panel.
     C5  no nested accordion inside a panel (no .ctl-sec / .ctl-panel
         inside a .ctl-panel).
     C6  Esc, Enter and Space all still operate the headings.
     C7  the drawer does not overflow horizontally at 390 / 768 / 1440.

   Reuses an existing serve.cjs on :8765 if one is up (so it shares
   the browser-app job's server), otherwise spawns its own and kills
   only the one it spawned. Drives real headless Chrome over CDP.

   Usage: node tools/qa-controls-ia.cjs
   Registry: docs/CI-TEST-COVERAGE.md + ci.yml (browser-app job).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8765;
const SERVE_BASE = process.env.QA_BASE || 'http://127.0.0.1:' + SERVE_PORT;

const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, val, detail) {
  results.push({ name, val: !!val, detail });
  console.log(
    (val ? '[PASS] ' : '[FAIL] ') + name + (val ? '' : '  <-- ' + JSON.stringify(detail))
  );
}

(async () => {
  // ---- Ensure a server is reachable ------------------------------------
  let ownServer = null;
  let up = false;
  try {
    const probe = await fetch(SERVE_BASE + '/project.html');
    up = probe.ok;
  } catch (e) {
    up = false;
  }
  if (!up) {
    console.log('[controls-ia] no server on :8765 - spawning serve.cjs for this run');
    ownServer = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 30; i++) {
      try {
        const p = await fetch(SERVE_BASE + '/project.html');
        if (p.ok) {
          up = true;
          break;
        }
      } catch (e) {}
      await delay(500);
    }
    if (!up) {
      console.log('[controls-ia] FATAL: serve.cjs did not come up on ' + SERVE_BASE);
      if (ownServer) {
        try {
          ownServer.kill();
        } catch (e) {}
      }
      process.exit(1);
    }
  }

  // ---- Launch headless Chrome ------------------------------------------
  const userDir = path.join(os.tmpdir(), 'chrome-ctrl-ia-' + Date.now());
  const chromeProc = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      '--remote-allow-origins=*',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + userDir,
      '--window-size=1280,900',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) {
        break;
      }
    } catch (e) {}
    await delay(300);
  }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws fail'));
  });
  const send = (method, params = {}) =>
    new Promise(res => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');
  await send('Page.enable');

  // ---- Open the project and the Controls tab ----------------------------
  // The project workspace bounces to app.html when no project context exists,
  // so seed a local admin record (the same proven seam verify-controls-admin
  // uses) and reload with an ?id= so the Controls drawer actually renders.
  await send('Page.navigate', { url: SERVE_BASE + '/project.html?id=qa-ctrl' });
  await delay(2000);
  await ev(
    `localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-ctrl',title:'QA Ctrl',description:'',status:'active',file:'project.html?id=qa-ctrl',code:'QACTL1',codeHash:'x'}]));`
  );
  await send('Page.navigate', { url: SERVE_BASE + '/project.html?id=qa-ctrl' });
  // Wait for the deferred bundle to boot and controls-nav init() to wrap the
  // groups into .ctl-sec-group bodies (so the tab/panel contract is live).
  let booted = false;
  for (let t = 0; t < 40; t++) {
    booted = await ev(
      `!!(window.MMGR && MMGR.AppControls) && !!document.querySelector('#db-ctrl [data-ctl-group-body]')`
    );
    if (booted) {
      break;
    }
    await delay(300);
  }
  // Reveal the Controls tab content (the .db#db-ctrl panel carries is-hide
  // until the drawer is opened and switched to the Controls tab).
  await ev(`(function(){
    if (window.MMGR && MMGR.App && MMGR.App.openDrw) { MMGR.App.openDrw(); }
    var ctrlTab = document.querySelector('.dtab[data-tab="ctrl"]');
    if (ctrlTab && window.MMGR && MMGR.App && MMGR.App.swDtab) { MMGR.App.swDtab('ctrl', ctrlTab); }
  })()`);
  await delay(800);
  // Flush any requestAnimationFrame deferral in the tab switch.
  await ev(
    `new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); })`
  );
  await delay(400);

  // ---- C1: 6 groups, each >= 2 tabs ------------------------------------
  // After controls-nav init() the tabs live inside a .ctl-sec-group body, so
  // count them there (falling back to the following-sibling walk for the raw
  // pre-init markup).
  const c1 = await ev(`(function(){
    var secs = Array.prototype.slice.call(document.querySelectorAll('#db-ctrl .ctl-sec[data-ctl-group]'));
    var info = secs.map(function(g){
      var key = g.getAttribute('data-ctl-group');
      var body = document.querySelector('#db-ctrl [data-ctl-group-body="'+key+'"]');
      var n = 0;
      if (body) {
        n = body.querySelectorAll('.dtab[data-ctl-tab]').length;
      } else {
        var el = g.nextElementSibling;
        while (el && !(el.classList && el.classList.contains('ctl-sec'))) {
          if (el.matches && el.matches('.dtab[data-ctl-tab]')) n++;
          if (el.matches && el.matches('.dtabs')) n += el.querySelectorAll('.dtab[data-ctl-tab]').length;
          el = el.nextElementSibling;
        }
      }
      return { key: key, tabs: n };
    });
    return { count: secs.length, info: info };
  })()`);
  check('C1 controls: exactly 6 [data-ctl-group] nodes', c1 && c1.count === 6, c1);
  const badTabs = c1 && c1.info ? c1.info.filter(g => g.tabs < 2) : [];
  check('C1 controls: every group has >= 2 [data-ctl-tab]', badTabs.length === 0, badTabs);

  // ---- C2: exactly one visible panel per group --------------------------
  const c2 = await ev(`(function(){
    var secs = Array.prototype.slice.call(document.querySelectorAll('#db-ctrl .ctl-sec[data-ctl-group]'));
    return secs.map(function(g){
      var key = g.getAttribute('data-ctl-group');
      var body = document.querySelector('#db-ctrl [data-ctl-group-body="'+key+'"]');
      var panels;
      if (body) {
        panels = Array.prototype.slice.call(body.querySelectorAll('.ctl-panel'));
      } else {
        panels = []; var el = g.nextElementSibling;
        while (el && !(el.classList && el.classList.contains('ctl-sec'))) {
          if (el.matches && el.matches('.ctl-panel')) panels.push(el);
          el = el.nextElementSibling;
        }
      }
      var total = panels.length;
      var visible = panels.filter(function(p){ return !p.classList.contains('is-hide'); }).length;
      return { key: key, total: total, visible: visible };
    });
  })()`);
  const badPanels = c2 ? c2.filter(g => g.visible !== 1) : [];
  check(
    'C2 controls: exactly one visible [data-ctl-panel] per group',
    badPanels.length === 0,
    badPanels
  );

  // ---- C3: preserved slot ids inside #db-ctrl exactly once --------------
  const SLOTS = [
    'adv-packs-section',
    'rules-body',
    'theme-select',
    'ai-tgl',
    'ctrl-share',
    'user-name-in',
    'del-zone',
    'del-zone-body',
    'err-webhook',
    'data-account',
    'template-list',
    'errlog-body'
  ];
  const c3 = await ev(`(function(){
    var ids = ${JSON.stringify(SLOTS)};
    return ids.map(function(id){
      return { id: id, n: document.querySelectorAll('#db-ctrl #'+id).length };
    });
  })()`);
  const badSlots = c3 ? c3.filter(s => s.n !== 1) : [];
  check(
    'C3 controls: every preserved slot id exists inside #db-ctrl exactly once',
    badSlots.length === 0,
    badSlots
  );

  // ---- C4: no orphaned .sr / .fmt-card / #errlog-body / #data-account /
  //         #template-list outside a .ctl-panel ---------------------------
  const c4 = await ev(`(function(){
    function insidePanel(el){ return !!(el && el.closest && el.closest('#db-ctrl .ctl-panel')); }
    var srs = Array.prototype.slice.call(document.querySelectorAll('#db-ctrl .sr'));
    var fmts = Array.prototype.slice.call(document.querySelectorAll('#db-ctrl .fmt-card'));
    return {
      srOrphans: srs.filter(function(e){ return !insidePanel(e); }).length,
      fmtOrphans: fmts.filter(function(e){ return !insidePanel(e); }).length,
      errlogBody: insidePanel(document.getElementById('errlog-body')),
      dataAccount: insidePanel(document.getElementById('data-account')),
      templateList: insidePanel(document.getElementById('template-list'))
    };
  })()`);
  const c4ok =
    c4 &&
    c4.srOrphans === 0 &&
    c4.fmtOrphans === 0 &&
    c4.errlogBody === true &&
    c4.dataAccount === true &&
    c4.templateList === true;
  check(
    'C4 controls: no .sr / .fmt-card / #errlog-body / #data-account / #template-list orphaned outside a panel',
    c4ok,
    c4
  );

  // ---- C5: no nested accordion inside a panel ---------------------------
  const c5 = await ev(`(function(){
    var panels = Array.prototype.slice.call(document.querySelectorAll('#db-ctrl .ctl-panel'));
    var bad = panels.filter(function(p){
      return !!(p.querySelector && p.querySelector('.ctl-sec, .ctl-panel'));
    }).length;
    return { panels: panels.length, nested: bad };
  })()`);
  check('C5 controls: no nested accordion inside a panel', c5 && c5.nested === 0, c5);

  // ---- C6: Esc / Enter / Space operate the headings ---------------------
  // Open the drawer in its own call first (the proven seam: the toggle handler
  // is delegated on #db-ctrl and fires reliably once the Controls tab is
  // revealed), then dispatch the keys in a second call.
  await ev(`(function(){
    if (window.MMGR && MMGR.App && MMGR.App.openDrw) { MMGR.App.openDrw(); }
    var ctrlTab = document.querySelector('.dtab[data-tab="ctrl"]');
    if (ctrlTab && window.MMGR && MMGR.App && MMGR.App.swDtab) { MMGR.App.swDtab('ctrl', ctrlTab); }
  })()`);
  await delay(500);
  const c6 = await ev(`(function(){
    var h = document.querySelector('#db-ctrl .ctl-sec[data-ctl-toggle]');
    if (!h) { return { error: 'no heading' }; }
    h.focus();
    var before = h.getAttribute('aria-expanded');
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    var afterEnter = h.getAttribute('aria-expanded');
    h.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    var afterSpace = h.getAttribute('aria-expanded');
    var drwBefore = !!(document.getElementById('drw') && document.getElementById('drw').classList.contains('open'));
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    var drwAfter = !!(document.getElementById('drw') && document.getElementById('drw').classList.contains('open'));
    return { before: before, afterEnter: afterEnter, afterSpace: afterSpace, drwBefore: drwBefore, drwAfter: drwAfter };
  })()`);
  check('C6 controls: Enter toggles the heading', c6 && c6.afterEnter !== c6.before, c6);
  check('C6 controls: Space toggles the heading', c6 && c6.afterSpace !== c6.afterEnter, c6);
  check(
    'C6 controls: Escape closes the drawer (the heading lives in it)',
    c6 && c6.drwBefore === true && c6.drwAfter === false,
    c6
  );

  // ---- C7: no horizontal overflow at 390 / 768 / 1440 -------------------
  // Resize the real viewport via CDP so the responsive CSS actually applies,
  // then measure the Controls panel's scrollWidth vs clientWidth. The full
  // keyboard-only responsive proof (Do #7) is the owner's manual sign-off;
  // this is the automated overflow guard (tolerance 2px).
  const c7 = [];
  for (const w of [390, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await ev(`(function(){
        if (window.MMGR && MMGR.App && MMGR.App.openDrw) { MMGR.App.openDrw(); }
        var ctrlTab = document.querySelector('.dtab[data-tab="ctrl"]');
        if (ctrlTab && window.MMGR && MMGR.App && MMGR.App.swDtab) { MMGR.App.swDtab('ctrl', ctrlTab); }
      })()`);
    await delay(400);
    const m = await ev(`(function(){
        var ctrl = document.getElementById('db-ctrl');
        return { w: window.innerWidth, scroll: ctrl.scrollWidth, client: ctrl.clientWidth, over: ctrl.scrollWidth - ctrl.clientWidth };
      })()`);
    if (m) {
      c7.push(m);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride', {});
  const overBad = c7.filter(x => x.over > 2);
  check('C7 controls: no horizontal overflow at 390 / 768 / 1440', overBad.length === 0, c7);

  // ---- C8: the project status menu opens under its chip ----------------
  // OWNER 2026-11-12: the native [popover] kept the UA's inset:0 because the
  // authored rule only set margin:0, so it pinned to the viewport's top-left.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await ev(`(function(){ if (MMGR.App && MMGR.App.closeDrw) { MMGR.App.closeDrw(); } })()`);
  await delay(250);
  await ev(`(function(){
      var chip = document.getElementById('status-chip');
      if (chip) { chip.click(); }
    })()`);
  await delay(350);
  const c8 = await ev(`(function(){
      var chip = document.getElementById('status-chip');
      var pop = document.getElementById('status-pop');
      if (!chip || !pop) { return { missing: true }; }
      var c = chip.getBoundingClientRect();
      var p = pop.getBoundingClientRect();
      return {
        open: pop.matches(':popover-open'),
        dx: Math.round(p.left - c.left),
        dy: Math.round(p.top - c.bottom),
        width: Math.round(p.width)
      };
    })()`);
  check(
    'C8 status menu opens under the chip, not at the viewport corner',
    !!c8 && c8.open === true && Math.abs(c8.dx) <= 2 && c8.dy >= 0 && c8.dy <= 10,
    c8
  );
  await send('Emulation.clearDeviceMetricsOverride', {});

  // ---- Tear down -------------------------------------------------------
  try {
    await send('Page.close');
  } catch (e) {}
  try {
    chromeProc.kill();
  } catch (e) {}
  try {
    if (ownServer) {
      ownServer.kill();
    }
  } catch (e) {}

  const failed = results.filter(r => !r.val);
  console.log('========================================');
  console.log(results.length + ' checks, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.log('HARNESS ERROR: ' + ((e && e.stack) || e));
  try {
    process.exit(1);
  } catch (x) {}
});
