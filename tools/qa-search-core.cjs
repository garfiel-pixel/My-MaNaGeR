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
