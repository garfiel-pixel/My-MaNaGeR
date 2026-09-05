/* ============================================================
   C23 POOL UI WIRING GATE (Phase 6, 2026-09-04)
   ------------------------------------------------------------
   Verifies the in-project pool surface renders and degrades
   gracefully when no cloud credential is held (offline-first):
     U1  ns.Pool exists with the full API surface
     U2  bootMerge with no credential is a silent no-op (no throw)
     U3  cross-project toggle ON -> Resources card shows the
         "Shared Resource Pool" button (poolOpenLibrary)
     U4  poolOpenLibrary opens the #pool-modal and shows the
         graceful credential-needed state (no crash)
     U5  a linked resource row (poolItemId set) renders the pool
         badge; an unlinked row shows "+ pool" when toggle is on
     U6  Escape closes the pool modal
   Usage: node tools/qa-pool-ui.cjs  (serve.cjs on BASE required)
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const userDir = path.join(os.tmpdir(), 'chrome-poolui-' + Date.now());
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  console.log((val ? '[PASS] ' : '[FAIL] ') + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400)));
}

(async function () {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir, '--window-size=1280,900', '--disk-cache-size=0', 'about:blank'
  ], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {}
      await delay(300);
    }
    const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
    const send = (method, params = {}) => new Promise(res => {
      const mid = ++id; pending.set(mid, m => res(m.result || {})); ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r && r.result && (r.result.value !== undefined ? r.result.value : (r.result.description || ''));
    };
    await send('Page.enable');

    // boot the launcher, seed a locally-owned default project, open it
    await send('Page.navigate', { url: BASE + '/app.html' });
    await delay(3000);
    await ev(`(function(){
      try {
        var list = JSON.parse(localStorage.getItem('mmgr_admin_projects') || '[]');
        if (!list.some(function(p){ return p && p.id === 'default'; })) list.push({ id: 'default', name: 'QA Seed', created: Date.now() });
        localStorage.setItem('mmgr_admin_projects', JSON.stringify(list));
        localStorage.setItem('mmgr_unlocked_default', '1');
        // seed a couple of resources so the table renders rows
        var st = JSON.parse(localStorage.getItem('mmgr_state_default') || '{}');
        st.resources = [
          { id: 'R1', name: 'Forman', type: 'Labor', role: '', availability: 100, rate: 45, hoursAllocated: 20, utilization: 0 },
          { id: 'R2', name: 'Crane', type: 'Equipment', role: '', availability: 80, rate: 250, hoursAllocated: 8, utilization: 0, poolItemId: 'pool-test-1', poolUpdatedAt: '2026-09-04T00:00:00.000Z' }
        ];
        localStorage.setItem('mmgr_state_default', JSON.stringify(st));
      } catch (e) { return String(e); }
      return 'seeded';
    })()`);
    await send('Page.navigate', { url: BASE + '/project.html' });
    await delay(4000);

    // U1: ns.Pool surface
    const u1 = await ev(`(function(){
      const P = window.MMGR && MMGR.Pool;
      return { exists: !!P,
        fns: ['refresh','linkItem','unlinkItem','createItem','updateItem','deleteItem','flushPending','mergeIntoState','refreshAndMerge','addRowToPool','bootMerge'].filter(function(f){ return P && typeof P[f] === 'function'; }) };
    })()`);
    check('U1 ns.Pool exposes the full API surface', u1 && u1.exists && u1.fns.length === 11, u1);

    // U2: bootMerge with no credential is a silent no-op
    const u2 = await ev(`(async function(){
      try { await MMGR.Pool.bootMerge(); return { threw: false }; }
      catch (e) { return { threw: true, err: String(e) }; }
    })()`);
    check('U2 bootMerge without a credential = silent no-op', u2 && u2.threw === false, u2);

    // U3: cross-project toggle ON -> the Shared Resource Pool button exists
    await ev(`(function(){ try { localStorage.setItem('mmgr_cross_project', '1'); } catch(e){} return 1; })()`);
    await ev(`(function(){ if (MMGR.Render && MMGR.Render.renderResources) MMGR.Render.renderResources(); return 1; })()`);
    await delay(400);
    const u3 = await ev(`(function(){
      const btn = Array.prototype.slice.call(document.querySelectorAll('[data-action="poolOpenLibrary"]'));
      const badge = document.querySelectorAll('.pool-badge').length;
      const addPool = Array.prototype.slice.call(document.querySelectorAll('[data-action="poolAddRow"]'));
      return { btnCount: btn.length, badgeCount: badge, addPoolCount: addPool.length,
        resRows: document.querySelectorAll('#res-body tr').length };
    })()`);
    check('U3 toggle ON renders Shared Resource Pool button', u3 && u3.btnCount >= 1, u3);
    check('U5 linked row shows pool badge, unlinked row shows + pool', u3 && u3.badgeCount >= 1 && u3.addPoolCount >= 1, u3);

    // U4: poolOpenLibrary opens the modal with the graceful state
    await ev(`(function(){ const b = document.querySelector('[data-action="poolOpenLibrary"]'); if (b) b.click(); return 1; })()`);
    await delay(900);
    const u4 = await ev(`(function(){
      const m = document.getElementById('pool-modal');
      const status = m ? m.querySelector('#pool-status') : null;
      const list = m ? m.querySelector('#pool-list') : null;
      return { open: !!m, status: status ? status.textContent : null, listEmpty: list ? (list.innerHTML === '') : true };
    })()`);
    check('U4 pool modal opens + graceful credential-needed state (no crash)',
      u4 && u4.open && u4.status && u4.status.length > 0, u4);

    // U6: Escape closes the pool modal
    await ev(`(function(){
      var e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(e);
      return 1;
    })()`);
    await delay(300);
    const u6 = await ev(`!document.getElementById('pool-modal')`);
    check('U6 Escape closes the pool modal', u6 === true, u6);

    const fails = results.filter(r2 => !r2.val).length;
    console.log('\n' + (results.length - fails) + ' passed, ' + fails + ' failed');
    process.exitCode = fails ? 1 : 0;
  } finally {
    try { proc.kill(); } catch (e) {}
  }
})();
