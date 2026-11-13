/* ============================================================
   tools/qa-search.cjs - T-16 search gate (UI-IA-AND-MCP-DIRECTIVE
   2026-11-11).

   Proves the palette on EVERY surface, end to end, in real Chrome:

   Project (S1-S16)
     S1  MMGR.AppSearch is present on a loaded project.
     S2  Ctrl+K opens the dialog with focus in the combobox.
     S3  Escape closes it and restores focus to the invoker.
     S4  'mcp' returns Connect an AI first. This is the alias-removal
         control: delete the mcp alias and this check fails.
     S5  'model context protocol' returns Connect an AI first.
     S6  'dark mode' returns Look & feel first.
     S7  'backup' resolves to Backup or Export.
     S8  'budget' returns the Budget section first.
     S9  'undo' returns the Undo action first.
     S10 'shortcuts' returns a shortcut entry.
     S11 'privacy' returns a Privacy entry.
     S12 running a setting result opens the drawer, its group and tab,
         and flashes the real control.
     S13 a pack-off section is absent and exactly one synthetic pack
         result replaces it.
     S14 a client scope cannot find a section outside its grant.
     S15 typing six queries makes ZERO network requests.
     S16 the index stays in its expected size band.

   Launcher (S17-S21)
     S17 surface() is 'launcher' and the index is substantial.
     S18 #db-search-btn opens the palette.
     S19 a seeded project is found by name.
     S20 the compact-title match still finds 'New Town Hotel Renovation'
         from 'newtown'.
     S21 MMGR.Shortcuts is absent and buildIndex() does not throw.

   Admin (S22-S24)
     S22 surface() is 'admin' and the header button opens the palette.
     S23 the rail and the cards are indexed (Shortcuts still absent).
     S24 Ctrl+K opens it.

   Calculator (S25-S27)
     S25 surface() is 'calculator' and the top-bar button opens it.
     S26 the cards are indexed.
     S27 a How to use result opens the guide at that step.

   Reuses an existing serve.cjs on :8765 if one is up, otherwise spawns
   its own and kills only the one it spawned. Drives headless Chrome
   over CDP. Usage: node tools/qa-search.cjs
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
    console.log('[search] no server on :8765 - spawning serve.cjs for this run');
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
      console.log('[search] FATAL: serve.cjs did not come up on ' + SERVE_BASE);
      if (ownServer) {
        try {
          ownServer.kill();
        } catch (e) {}
      }
      process.exit(1);
    }
  }

  // ---- Launch headless Chrome ------------------------------------------
  const userDir = path.join(os.tmpdir(), 'chrome-search-' + Date.now());
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

  async function nav(url) {
    await send('Page.navigate', { url });
    await delay(2200);
  }
  async function waitFor(expr) {
    for (let t = 0; t < 40; t++) {
      if (await ev(expr)) {
        return true;
      }
      await delay(300);
    }
    return false;
  }

  try {
    // =====================================================================
    // Project surface
    // =====================================================================
    await nav(SERVE_BASE + '/project.html?id=qa-search');
    await ev(
      `localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-search',title:'QA Search',description:'',status:'active',file:'project.html?id=qa-search',code:'QASRCH1',codeHash:'x'}]));`
    );
    await nav(SERVE_BASE + '/project.html?id=qa-search');
    const booted = await waitFor(
      `!!(window.MMGR && MMGR.AppSearch && typeof MMGR.AppSearch.buildIndex === 'function')`
    );
    check('S1 search: MMGR.AppSearch is present on a loaded project', booted === true, { booted });

    // Put the project in its fullest state so the section queries below test
    // real sections, not the pack-off synthetic result (S13 tests that).
    await ev(
      `(function(){ var pk = document.getElementById('pk-money'); if (!pk) { return 'no-toggle'; } if (!pk.checked) { pk.click(); } return 'ok'; })()`
    );
    await delay(800);

    // S2: Ctrl+K opens with focus in the combobox.
    const s2 = await ev(`(function(){
      document.dispatchEvent(new KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true, cancelable:true }));
      var pal = document.getElementById('app-search');
      var q = document.getElementById('app-search-q');
      return {
        open: !!(pal && !pal.hidden),
        focused: document.activeElement === q,
        role: pal ? pal.getAttribute('role') : '',
        modal: pal ? pal.getAttribute('aria-modal') : ''
      };
    })()`);
    check(
      'S2 palette: Ctrl+K opens a modal dialog with focus in the combobox',
      s2 && s2.open === true && s2.focused === true && s2.role === 'dialog' && s2.modal === 'true',
      s2
    );

    // S3: Escape closes and restores focus to the invoker.
    const s3 = await ev(`(function(){
      var inv = document.createElement('button');
      inv.id = 'qa-search-invoker';
      document.body.appendChild(inv);
      inv.focus();
      MMGR.AppSearch.open();
      var opened = MMGR.AppSearch.isOpen();
      var q = document.getElementById('app-search-q');
      q.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
      var out = { opened: opened, closed: !MMGR.AppSearch.isOpen(), restored: document.activeElement === inv };
      inv.parentNode.removeChild(inv);
      return out;
    })()`);
    check(
      'S3 palette: Escape closes it and restores focus to the invoker',
      s3 && s3.opened === true && s3.closed === true && s3.restored === true,
      s3
    );

    // S4-S11: the eight real queries.
    const q8 = await ev(`(function(){
      function top(q){ var r = MMGR.AppSearch.search(q); return r.length ? r[0].label : ''; }
      function has(q, label){ return MMGR.AppSearch.search(q).some(function(e){ return e.label === label; }); }
      function kind(q, k){ return MMGR.AppSearch.search(q).some(function(e){ return e.kind === k; }); }
      var before = performance.getEntriesByType('resource').length;
      var typed = ['mcp','model context protocol','dark mode','backup','budget','undo','shortcuts','privacy'];
      typed.forEach(function(q){ MMGR.AppSearch.search(q); });
      var after = performance.getEntriesByType('resource').length;
      return {
        mcp: top('mcp'),
        mcpp: top('model context protocol'),
        dark: top('dark mode'),
        backup: has('backup','Backup') || has('backup','Export'),
        budget: top('budget'),
        undo: top('undo'),
        shortcut: kind('shortcuts','shortcut'),
        privacy: has('privacy','Privacy'),
        netDelta: after - before
      };
    })()`);
    check(
      "S4 search: 'mcp' returns Connect an AI first (fails if the alias is removed)",
      q8 && q8.mcp === 'Connect an AI',
      q8 && q8.mcp
    );
    check(
      "S5 search: 'model context protocol' returns Connect an AI first",
      q8 && q8.mcpp === 'Connect an AI',
      q8 && q8.mcpp
    );
    check(
      "S6 search: 'dark mode' returns Look & feel first",
      q8 && q8.dark === 'Look & feel',
      q8 && q8.dark
    );
    check(
      "S7 search: 'backup' resolves to Backup or Export",
      q8 && q8.backup === true,
      q8 && q8.backup
    );
    check(
      "S8 search: 'budget' returns the Budget section first",
      q8 && q8.budget === 'Budget',
      q8 && q8.budget
    );
    check(
      "S9 search: 'undo' returns the Undo action first",
      q8 && q8.undo === 'Undo',
      q8 && q8.undo
    );
    check(
      "S10 search: 'shortcuts' returns a shortcut entry",
      q8 && q8.shortcut === true,
      q8 && q8.shortcut
    );
    check(
      "S11 search: 'privacy' returns a Privacy entry",
      q8 && q8.privacy === true,
      q8 && q8.privacy
    );
    check(
      'S15 palette: typing eight queries makes ZERO network requests',
      q8 && q8.netDelta === 0,
      q8 && q8.netDelta
    );

    // S12: running a setting result reveals the real control.
    const s12 = await ev(`(function(){
      MMGR.AppSearch.open();
      var q = document.getElementById('app-search-q');
      q.value = 'theme';
      q.dispatchEvent(new Event('input', { bubbles:true }));
      var first = document.querySelector('#app-search-list .search-opt');
      var label = first ? first.querySelector('.search-opt-label').textContent : '';
      first.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
      var sel = document.getElementById('theme-select');
      var body = document.querySelector('[data-ctl-group-body="workspace"]');
      return {
        label: label,
        drawer: !!document.querySelector('#db-ctrl') && !document.getElementById('db-ctrl').classList.contains('is-hide'),
        group: !!(body && !body.classList.contains('is-hide')),
        hit: !!(sel && sel.classList.contains('search-hit')),
        palClosed: !MMGR.AppSearch.isOpen()
      };
    })()`);
    check(
      'S12 reveal: a setting result opens the drawer, its group and flashes the control',
      s12 &&
        s12.label === 'Theme' &&
        s12.drawer === true &&
        s12.group === true &&
        s12.hit === true &&
        s12.palClosed === true,
      s12
    );

    // S13: pack gating is deterministic - force Money off.
    const pkState = await ev(`(function(){
      var pk = document.getElementById('pk-money');
      return { exists: !!pk, checked: pk ? pk.checked : null };
    })()`);
    if (pkState && pkState.checked) {
      await ev(`document.getElementById('pk-money').click()`);
      await delay(700);
    }
    const s13 = await ev(`(function(){
      var idx = MMGR.AppSearch.buildIndex();
      return {
        moneyOff: !document.getElementById('pk-money').checked,
        budget: idx.filter(function(e){ return e.id === 'sec-budget'; }).length,
        packs: idx.filter(function(e){ return e.label === 'Money pack'; }).length
      };
    })()`);
    check(
      'S13 gating: a pack-off section is absent and exactly one synthetic pack result replaces it',
      s13 && s13.moneyOff === true && s13.budget === 0 && s13.packs === 1,
      s13
    );

    // S14: a client scope cannot find a section outside its grant. Put the
    // Money pack back on first, so the ONLY reason Budget disappears is the
    // scope guard (setEScope is internal; write the session slot directly).
    const moneyBack = await ev(
      `(function(){ var pk = document.getElementById('pk-money'); if (!pk) { return 'no-toggle'; } if (!pk.checked) { pk.click(); } return 'ok'; })()`
    );
    await delay(800);
    const s14 = await ev(`(function(){
      var pid = (window.MMGR && MMGR.projectId) || 'default';
      var key = 'mmgr_cloud_escope_' + (localStorage.getItem('mmgr_cloud_id_' + pid) || pid);
      sessionStorage.setItem(key, JSON.stringify({ label:'QA Client', sections:['dash'], role:'client', teamRole:'client' }));
      var idx = MMGR.AppSearch.buildIndex();
      return {
        moneyOn: document.getElementById('pk-money').checked,
        budget: idx.filter(function(e){ return e.id === 'sec-budget'; }).length,
        dash: idx.filter(function(e){ return e.id === 'sec-dash'; }).length,
        hasClient: MMGR.Cloud.isClientSectionHidden('budget')
      };
    })()`);
    check(
      'S14 gating: a client scope cannot find a section outside its grant',
      moneyBack === 'ok' &&
        s14 &&
        s14.moneyOn === true &&
        s14.hasClient === true &&
        s14.budget === 0 &&
        s14.dash === 1,
      s14
    );
    await ev('sessionStorage.clear()');

    // S16: index size band (pack-off state, client scope cleared).
    await nav(SERVE_BASE + '/project.html?id=qa-search');
    const s16 = await ev('MMGR.AppSearch.buildIndex().length');
    check('S16 search: the index stays in its expected size band', s16 >= 150 && s16 <= 300, s16);

    // S28 (MCP-AGENT-FIRST 2026-11-12): a project RECORD is searchable and the
    // result lands on the row. The palette used to index only chrome, so a
    // task search returned settings and left the page at the top.
    await nav(SERVE_BASE + '/project.html?id=demo-filled');
    await waitFor(`!!(window.MMGR && MMGR.AppSearch && MMGR.State && MMGR.State.getState)`);
    await delay(1200);
    const s28 = await ev(`(function(){
      var hits = MMGR.AppSearch.search('structural assessment');
      var rec = hits.filter(function(e){ return e.kind === 'record'; })[0];
      if (!rec) { return { found:false, kinds: hits.map(function(e){ return e.kind; }) }; }
      rec.run();
      return new Promise(function(res){ setTimeout(function(){
        var row = document.querySelector('#wbs-body tr.wbs-row.search-hit');
        res({
          found: true,
          label: rec.label,
          section: (document.querySelector('.sec-btn.active') || {}).textContent.trim(),
          hit: !!row
        });
      }, 700); });
    })()`);
    check(
      'S28 a task search result lands on its WBS row',
      s28 && s28.found && s28.hit && /WBS/.test(s28.section),
      s28
    );

    // =====================================================================
    // Launcher surface
    // =====================================================================
    await nav(SERVE_BASE + '/app.html');
    await ev(
      `localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-l',title:'Riverside Tower',description:'QA probe project'},{id:'qa-n',title:'New Town Hotel Renovation',description:'QA probe two'}]));`
    );
    await nav(SERVE_BASE + '/app.html');
    const lBoot = await waitFor(`!!(window.MMGR && MMGR.AppSearch)`);
    const l1 = await ev(`(function(){
      var idx = MMGR.AppSearch.buildIndex();
      return { surface: MMGR.AppSearch.surface(), count: idx.length };
    })()`);
    check(
      "S17 launcher: surface() is 'launcher' and the index is substantial",
      lBoot === true && l1 && l1.surface === 'launcher' && l1.count > 20,
      l1
    );
    await ev(`document.getElementById('db-search-btn').click()`);
    await delay(400);
    check(
      'S18 launcher: #db-search-btn opens the palette',
      (await ev('MMGR.AppSearch.isOpen()')) === true
    );
    const l2 = await ev(
      `JSON.stringify(MMGR.AppSearch.search('riverside').map(function(e){ return e.kind + ':' + e.label; }))`
    );
    check(
      'S19 launcher: a seeded project is found by name',
      String(l2).indexOf('project:Riverside Tower') > -1,
      l2
    );
    const l3 = await ev(
      `JSON.stringify(MMGR.AppSearch.search('newtown').map(function(e){ return e.label; }))`
    );
    check(
      "S20 launcher: the compact-title match finds 'New Town Hotel Renovation' from 'newtown'",
      String(l3).indexOf('New Town Hotel Renovation') > -1,
      l3
    );
    const l4 = await ev(`(function(){
      var noShortcuts = typeof window.MMGR.Shortcuts === 'undefined';
      var ok = false;
      try { ok = MMGR.AppSearch.buildIndex().length > 0; } catch (e) { ok = false; }
      return { noShortcuts: noShortcuts, ok: ok };
    })()`);
    check(
      'S21 launcher: MMGR.Shortcuts is absent and buildIndex() does not throw',
      l4 && l4.noShortcuts === true && l4.ok === true,
      l4
    );

    // =====================================================================
    // Admin surface
    // =====================================================================
    await nav(SERVE_BASE + '/admin.html');
    const aBoot = await waitFor(`!!(window.MMGR && MMGR.AppSearch)`);
    const a1 = await ev(`(function(){
      return { surface: MMGR.AppSearch.surface(), count: MMGR.AppSearch.buildIndex().length };
    })()`);
    check(
      "S22 admin: surface() is 'admin' and the header button exists",
      aBoot === true &&
        a1 &&
        a1.surface === 'admin' &&
        (await ev(`!!document.querySelector('.hdr-actions [data-app-search-open]')`)) === true,
      a1
    );
    await ev(`document.querySelector('.hdr-actions [data-app-search-open]').click()`);
    await delay(400);
    check(
      'S22b admin: the header button opens the palette',
      (await ev('MMGR.AppSearch.isOpen()')) === true
    );
    const a2 = await ev(`(function(){
      var hits = MMGR.AppSearch.search('cloud projects').map(function(e){ return e.label; });
      return {
        hits: hits,
        noShortcuts: typeof window.MMGR.Shortcuts === 'undefined',
        rail: MMGR.AppSearch.search('new project').some(function(e){ return e.label === 'New Project'; })
      };
    })()`);
    check(
      'S23 admin: the rail and the cards are indexed (Shortcuts still absent)',
      a2 && a2.rail === true && a2.hits.indexOf('Cloud Projects') > -1 && a2.noShortcuts === true,
      a2
    );
    await ev('MMGR.AppSearch.close(false)');
    await ev(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true, cancelable:true }))`
    );
    await delay(300);
    check('S24 admin: Ctrl+K opens the palette', (await ev('MMGR.AppSearch.isOpen()')) === true);

    // =====================================================================
    // Calculator surface
    // =====================================================================
    await nav(SERVE_BASE + '/calculator.html');
    const cBoot = await waitFor(`!!(window.MMGR && MMGR.AppSearch)`);
    const c1 = await ev(`(function(){
      return { surface: MMGR.AppSearch.surface(), count: MMGR.AppSearch.buildIndex().length };
    })()`);
    check(
      "S25 calculator: surface() is 'calculator' and the top-bar button exists",
      cBoot === true &&
        c1 &&
        c1.surface === 'calculator' &&
        (await ev(`!!document.querySelector('.bcp-top-right [data-app-search-open]')`)) === true,
      c1
    );
    await ev(`document.querySelector('.bcp-top-right [data-app-search-open]').click()`);
    await delay(400);
    check(
      'S25b calculator: the top-bar button opens the palette',
      (await ev('MMGR.AppSearch.isOpen()')) === true
    );
    const c2 = await ev(
      `JSON.stringify(MMGR.AppSearch.search('estimate').map(function(e){ return e.label; }))`
    );
    check('S26 calculator: the cards are indexed', String(c2).indexOf('Estimate') > -1, c2);
    const c3 = await ev(`(function(){
      var hit = MMGR.AppSearch.search('contingency')[0];
      if (!hit) { return { err: 'no guide hit' }; }
      MMGR.AppSearch.close(false);
      hit.run();
      var text = document.getElementById('calc-guide-text');
      var body = document.getElementById('calc-guide-body');
      return {
        kind: hit.kind,
        text: text ? text.textContent : '',
        open: !!(body && !body.hidden)
      };
    })()`);
    check(
      'S27 calculator: a How to use result opens the guide at that step',
      c3 && c3.kind === 'guide' && c3.open === true && String(c3.text).indexOf('Contingency') > -1,
      c3
    );
  } catch (e) {
    check('harness completed without an exception', false, String(e && e.stack ? e.stack : e));
  }

  console.log('\n========================================');
  const failed = results.filter(r => !r.val).length;
  console.log(results.length + ' checks, ' + failed + ' failed');

  try {
    ws.close();
  } catch (e) {}
  try {
    chromeProc.kill();
  } catch (e) {}
  if (ownServer) {
    try {
      ownServer.kill();
    } catch (e) {}
  }
  process.exit(failed === 0 ? 0 : 1);
})();
