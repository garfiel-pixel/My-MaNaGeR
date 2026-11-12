/* ============================================================
   tools/qa-search-core.cjs - T-13 search core gate
   (UI-IA-AND-MCP-DIRECTIVE-2026-11-11).

   Proves the search index + scoring half (the palette is T-14):

     S1  MMGR.AppSearch exists on a loaded project.
     S2  buildIndex() returns a substantial index (~170; the directive's
         own source list lands near 200).
     S3  buildIndex() + search() make ZERO network requests.
     S4  search('mcp') returns the Connect an AI entry first.
     S5  search('model context protocol') returns Connect an AI first.
     S6  hand-authored aliases resolve: 'dark mode' -> Look & feel,
         'undo' -> the Undo action, 'backup' -> Export.
     S7  MMGR.Shortcuts.table is exposed with the app shortcut rows.
     S8  [hidden] rows are excluded (a signed-out Danger Zone never
         appears in results).
     S9  a pack-off section is replaced by one synthetic pack result.

   Reuses an existing serve.cjs on :8765 if one is up, otherwise
   spawns its own and kills only the one it spawned. Drives real
   headless Chrome over CDP.

   Usage: node tools/qa-search-core.cjs
   Registry: docs/CI-TEST-COVERAGE.md + ci.yml (browser-app job).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const { chromePath: CHROME, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
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
    console.log('[search-core] no server on :8765 - spawning serve.cjs for this run');
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
      console.log('[search-core] FATAL: serve.cjs did not come up on ' + SERVE_BASE);
      if (ownServer) {
        try {
          ownServer.kill();
        } catch (e) {}
      }
      process.exit(1);
    }
  }

  // ---- Launch headless Chrome ------------------------------------------
  const userDir = path.join(os.tmpdir(), 'chrome-search-core-' + Date.now());
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
    if (r.result && r.result.exceptionDetails) {
      return { __err: r.result.exceptionDetails.text };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');
  await send('Page.enable');

  // ---- Load a project ---------------------------------------------------
  await send('Page.navigate', { url: SERVE_BASE + '/project.html?id=qa-search' });
  await delay(2000);
  await ev(
    `localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-search',title:'QA Search',description:'',status:'active',file:'project.html?id=qa-search',code:'QASRCH1',codeHash:'x'}]));`
  );
  await send('Page.navigate', { url: SERVE_BASE + '/project.html?id=qa-search' });
  let booted = false;
  for (let t = 0; t < 40; t++) {
    booted = await ev(
      `!!(window.MMGR && MMGR.AppSearch && typeof MMGR.AppSearch.buildIndex === 'function')`
    );
    if (booted) {
      break;
    }
    await delay(300);
  }
  check('S1 search: MMGR.AppSearch is present on a loaded project', booted === true, { booted });

  // ---- S2/S3: index size + zero network --------------------------------
  const core = await ev(`(function(){
    if (!(window.MMGR && MMGR.AppSearch)) { return { err: 'no AppSearch' }; }
    // S8: force the owner-conditional Danger Zone hidden so the visibility
    // filter is tested deterministically, whatever the local owner state is.
    var dz = document.getElementById('del-zone');
    if (dz) { dz.setAttribute('hidden', ''); }
    var dzb = document.getElementById('del-zone-body');
    if (dzb) { dzb.setAttribute('hidden', ''); }
    var before = performance.getEntriesByType('resource').length;
    var idx = MMGR.AppSearch.buildIndex();
    var mcp = MMGR.AppSearch.search('mcp');
    var mcpp = MMGR.AppSearch.search('model context protocol');
    var after = performance.getEntriesByType('resource').length;
    function top(list){ return list.length ? { label: list[0].label, kind: list[0].kind, group: list[0].group } : null; }
    function firstLabel(q){ var r = MMGR.AppSearch.search(q); return r.length ? r[0].label : ''; }
    return {
      count: idx.length,
      netDelta: after - before,
      mcpTop: top(mcp),
      mcppTop: top(mcpp),
      darkMode: firstLabel('dark mode'),
      undo: firstLabel('undo'),
      saveCopy: firstLabel('save a copy'),
      hasShortcutsTable: !!(window.MMGR && MMGR.Shortcuts && MMGR.Shortcuts.table && Array.isArray(MMGR.Shortcuts.table.app) && MMGR.Shortcuts.table.app.length > 0),
      danger: firstLabel('danger zone'),
      dangerPresent: MMGR.AppSearch.search('danger zone').some(function(e){ return e.label === 'Danger Zone'; }),
      money: firstLabel('money'),
      // Pack gating: a pack-off project carries the synthetic "Money pack"
      // result; a pack-on project carries the real Budget section instead.
      hasMoneyPack: idx.some(function(e){ return e.label === 'Money pack'; }),
      hasBudget: idx.some(function(e){ return e.label === 'Budget'; })
    };
  })()`);

  check(
    'S2 search: buildIndex() returns a substantial index (~170, directive source list)',
    core && typeof core.count === 'number' && core.count >= 150 && core.count <= 240,
    core
  );
  check(
    'S3 search: buildIndex() + search() make ZERO network requests',
    core && core.netDelta === 0,
    core
  );
  check(
    "S4 search: 'mcp' returns Connect an AI first",
    core && core.mcpTop && core.mcpTop.label === 'Connect an AI',
    core && core.mcpTop
  );
  check(
    "S5 search: 'model context protocol' returns Connect an AI first",
    core && core.mcppTop && core.mcppTop.label === 'Connect an AI',
    core && core.mcppTop
  );
  check(
    "S6 search: aliases resolve ('dark mode' -> Look & feel, 'undo' -> Undo, 'save a copy' -> Export)",
    core && core.darkMode === 'Look & feel' && core.undo === 'Undo' && core.saveCopy === 'Export',
    core && { darkMode: core.darkMode, undo: core.undo, saveCopy: core.saveCopy }
  );
  check(
    'S7 search: MMGR.Shortcuts.table is exposed with the app rows',
    core && core.hasShortcutsTable === true,
    core && { hasShortcutsTable: core.hasShortcutsTable }
  );
  check(
    'S8 search: [hidden] rows are excluded (signed-out Danger Zone never appears)',
    core && core.dangerPresent === false,
    core && { danger: core.danger, dangerPresent: core.dangerPresent }
  );
  check(
    'S9 search: a pack-off section is replaced by a synthetic pack result (or the pack-on Budget section)',
    core && (core.hasMoneyPack === true || core.hasBudget === true),
    core && { money: core.money, hasMoneyPack: core.hasMoneyPack, hasBudget: core.hasBudget }
  );

  // ---- T-14 palette: open / type / move / run / close ------------------
  const pal1 = await ev(`(function(){
    if (!(window.MMGR && MMGR.AppSearch && MMGR.AppSearch.open)) { return { err: 'no palette api' }; }
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true, cancelable:true }));
    var pal = document.getElementById('app-search');
    var q = document.getElementById('app-search-q');
    var out = {
      open: !!(pal && !pal.hidden),
      focused: document.activeElement === q,
      role: pal ? pal.getAttribute('role') : '',
      ariaModal: pal ? pal.getAttribute('aria-modal') : ''
    };
    q.value = 'mcp';
    q.dispatchEvent(new Event('input', { bubbles:true }));
    var opts = Array.prototype.slice.call(document.querySelectorAll('#app-search-list .search-opt'));
    out.options = opts.length;
    out.first = opts.length ? opts[0].querySelector('.search-opt-label').textContent : '';
    out.live = document.getElementById('app-search-live').textContent;
    out.expanded = q.getAttribute('aria-expanded');
    out.activeDesc = q.getAttribute('aria-activedescendant');
    out.selected0 = opts.length ? opts[0].getAttribute('aria-selected') : '';
    var before = q.getAttribute('aria-activedescendant');
    q.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true, cancelable:true }));
    out.moved = q.getAttribute('aria-activedescendant') !== before;
    out.selected1 = opts.length > 1 ? opts[1].getAttribute('aria-selected') : '';
    return out;
  })()`);
  check(
    'S10 palette: Ctrl+K opens a dialog with a focused combobox',
    pal1 &&
      pal1.open === true &&
      pal1.focused === true &&
      pal1.role === 'dialog' &&
      pal1.ariaModal === 'true',
    pal1
  );
  check(
    'S11 palette: typing mcp lists Connect an AI first with combobox + live-region semantics',
    pal1 &&
      pal1.options > 0 &&
      pal1.first === 'Connect an AI' &&
      pal1.expanded === 'true' &&
      pal1.activeDesc === 'search-opt-0' &&
      pal1.selected0 === 'true' &&
      /results?$/.test(pal1.live || ''),
    pal1
  );
  check(
    'S12 palette: ArrowDown moves the active option',
    pal1 && pal1.moved === true && pal1.selected1 === 'true',
    pal1
  );

  const pal2 = await ev(`(function(){
    var q = document.getElementById('app-search-q');
    q.value = 'theme';
    q.dispatchEvent(new Event('input', { bubbles:true }));
    var first = document.querySelector('#app-search-list .search-opt .search-opt-label');
    var label = first ? first.textContent : '';
    q.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
    var pal = document.getElementById('app-search');
    var drw = document.getElementById('drw');
    var ctrl = document.getElementById('db-ctrl');
    return {
      label: label,
      closed: !!(pal && pal.hidden),
      drawerOpen: !!(drw && drw.classList.contains('open')),
      ctrlVisible: !!(ctrl && !ctrl.classList.contains('is-hide'))
    };
  })()`);
  check(
    'S13 palette: Enter runs the top result and closes the palette (Theme reveals the Controls drawer)',
    pal2 &&
      pal2.label === 'Theme' &&
      pal2.closed === true &&
      pal2.drawerOpen === true &&
      pal2.ctrlVisible === true,
    pal2
  );

  const pal3 = await ev(`(function(){
    if (window.MMGR && MMGR.App && MMGR.App.closeDrw) { MMGR.App.closeDrw(); }
    // A temporary focusable button is the invoker, so the restore assertion is
    // deterministic regardless of which page controls happen to be visible.
    var inv = document.createElement('button');
    inv.type = 'button';
    inv.id = 'qa-search-invoker';
    inv.textContent = 'invoker';
    document.body.appendChild(inv);
    inv.focus();
    var invOk = document.activeElement === inv;
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true, cancelable:true }));
    var pal = document.getElementById('app-search');
    var opened = !!(pal && !pal.hidden);
    var q = document.getElementById('app-search-q');
    q.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    var out = {
      invOk: invOk,
      opened: opened,
      closed: !!(pal && pal.hidden),
      focusRestored: document.activeElement === inv
    };
    inv.remove();
    return out;
  })()`);
  check(
    'S14 palette: Escape closes it and restores focus to the invoker',
    pal3 &&
      pal3.invOk === true &&
      pal3.opened === true &&
      pal3.closed === true &&
      pal3.focusRestored === true,
    pal3
  );

  const net = await ev(`(function(){
    var before = performance.getEntriesByType('resource').length;
    MMGR.AppSearch.open();
    var q = document.getElementById('app-search-q');
    ['m','mc','mcp','theme','budget','risk','drive'].forEach(function (v) {
      q.value = v;
      q.dispatchEvent(new Event('input', { bubbles:true }));
    });
    var after = performance.getEntriesByType('resource').length;
    MMGR.AppSearch.close(true);
    return { delta: after - before };
  })()`);
  check('S15 palette: typing makes ZERO network requests', net && net.delta === 0, net);

  // Reduced motion: the reveal flash becomes a static outline (animation none).
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  const rm = await ev(`(function(){
    var el = document.querySelector('.sec-btn[data-section="dash"]') || document.body;
    el.classList.add('search-hit');
    var s = getComputedStyle(el);
    var out = { animationName: s.animationName, outlineWidth: s.outlineWidth };
    el.classList.remove('search-hit');
    return out;
  })()`);
  await send('Emulation.setEmulatedMedia', { features: [] });
  check(
    'S16 palette: prefers-reduced-motion removes the flash animation (static outline)',
    rm && rm.animationName === 'none',
    rm
  );

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
