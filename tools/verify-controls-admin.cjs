/* ============================================================
   CONTROLS-AND-ADMIN browser verification (owner directive 2026-08-15)
     S1 — admin.html: header has NO google-signin-button / theme toggle;
          rail has Account (auth-bar mount) + Customize (rail-ctl-row)
     S2 — admin.html: Import Project button + file input present
     S3 — admin.html: Publish to Cloud button present in project rows
     S4 — project.html: Controls tab shows ctrl-share + Copy As cards
   Run: node tools/verify-controls-admin.cjs
   ============================================================ */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const userDir = path.join(os.tmpdir(), 'chrome-ctrl-' + Date.now());

const delay = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(
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

const results = [];
function check(name, val, detail) {
  results.push({ name, val: !!val, detail });
  console.log(
    (val ? '[PASS] ' : '[FAIL] ') + name + (val ? '' : '  <-- ' + JSON.stringify(detail))
  );
}

(async () => {
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

  // ---- S1/S2: admin.html (DOM presence — elements exist even while the gate hides #admin-app) --
  await send('Page.navigate', { url: BASE + '/admin.html' });
  // Local static /api routes are served by serve.cjs; if there is no local server
  // running this navigation will be a 404 and every S1/S2 DOM probe will be empty.
  await delay(4000);
  const a1 = await ev(`(function(){
    const hdr = document.querySelector('#admin-app header');
    const rail = document.getElementById('app-sidebar');
    const siom = document.getElementById('siom');
    const toolbar = document.querySelector('.toolbar');
    return {
      hdrSignin: !!(hdr && hdr.querySelector('#google-signin-button')),
      hdrTheme: !!(hdr && hdr.querySelector('[data-action="tglTheme"]')),
      // OWNER 2026-09-06/07: DOM nodes cannot cross returnByValue, so every
      // rail probe is a serializable boolean computed INSIDE the page.
      railSignin: !!(rail && rail.querySelector('.db-signin')),
      railAuth: !!(rail && rail.querySelector('.auth-bar')),
      railOpenSignIn: !!(rail && rail.querySelector('[data-action="openSignIn"]')),
      siomPresent: !!siom,
      siomGoogle: !!(siom && siom.querySelector('#google-signin-button')),
      railCtl: (rail && rail.querySelectorAll('.rail-ctl-row').length) || 0,
      railPremium: !!(rail && /Premium/i.test(rail.textContent || '')),
      hdrPlan: !!(hdr && hdr.querySelector('#plan-badge')),
      toolbarTxt: toolbar ? (toolbar.textContent || '') : '',
      fileInput: !!document.getElementById('import-project-file')
    };
  })()`);
  // OWNER 2026-09-07: sign-in entry lives ONLY on the app page. Admin is
  // read-only in the rail footer; the rail user renderer + the shared #siom
  // sheet (which still mounts the GIS button) are what we assert here.
  check('S1 admin header: no sign-in / theme in header', !a1.hdrSignin && !a1.hdrTheme, a1);
  // OWNER 2026-09-07: sign-in entry lives ONLY on the app page. The admin
  // rail is read-only (auth-bar mount + renderRailUser()), and the shared
  // #siom sheet still mounts the GIS button.
  check(
    'S1 admin rail: account bar present and #siom sheet mounts the GIS button',
    !!(a1.railAuth && a1.siomPresent && a1.siomGoogle),
    a1
  );
  // OWNER 2026-09-07: the rail Sign-in trigger lives on the app page
  // (.db-signin[data-action="openSignIn"]), not in the admin rail.
  check(
    'S1 admin rail: rail has no sign-in trigger (app page owns sign-in)',
    !a1.railOpenSignIn,
    a1
  );
  // OWNER 2026-09-07: the Customize block nests the Theme row inside a
  // .dock.dock-inline wrapper, so the count is one higher than the number of
  // visible controls. T-19 (UI-IA-AND-MCP 2026-11-11) removed the dead
  // Premium label, so the contract is now theme/perf/cross-project = 4 nodes
  // (outer dock wrapper + nested theme span + perf + cross-project), and the
  // plan control lives in the header as #plan-badge. Re-baselined to the new
  // contract; asserting the label is GONE is the point of the change.
  check(
    'S1 admin rail: Customize rows (theme/perf/cross-project, no Premium)',
    a1.railCtl === 4 && !a1.railPremium && a1.hdrPlan,
    a1
  );
  check(
    'S2 admin toolbar: Import Project present',
    a1.toolbarTxt.indexOf('Import Project') > -1,
    a1.toolbarTxt
  );
  check('S2 admin: import file input present', a1.fileInput === true, a1);

  // ---- S3: unlock the gate so project rows render ---------------------------
  await ev(`(function(){
    const setup = document.getElementById('setup-screen');
    if (setup && !setup.classList.contains('hidden')) {
      const p1 = document.getElementById('setup-pass1');
      const p2 = document.getElementById('setup-pass2');
      if (p1 && p2) { p1.value = 'TestPass123!'; p2.value = 'TestPass123!'; }
      const b = setup.querySelector('[data-action="adminSetupPassword"]');
      if (b) b.click();
    }
    const login = document.getElementById('login-screen');
    if (login && !login.classList.contains('hidden')) {
      const p = document.getElementById('login-pass');
      if (p) p.value = 'TestPass123!';
      const b = login.querySelector('[data-action="adminLogin"]');
      if (b) b.click();
    }
  })()`);
  // AREA G (Tier B, shipped after this harness's last green run): a fresh
  // setup now parks the panel behind the show-once recovery-code modal until
  // the save checkbox is confirmed — poll-dismiss it (PBKDF2 + code gen can
  // take a beat) so enterAdmin() runs and rows render.
  for (let t = 0; t < 24; t++) {
    const done = await ev(`(function(){
      const om = document.getElementById('rc-om');
      const adminApp = document.getElementById('admin-app');
      if (adminApp && !adminApp.classList.contains('hidden')) return 'unlocked';
      if (om && om.classList.contains('show')){
        const cb = document.getElementById('rc-saved-cb');
        if (cb && !cb.checked){ cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        const doneBtn = document.querySelector('#rc-om [data-action="confirmRecoverySaved"]');
        if (doneBtn) doneBtn.click();
      }
      return 'waiting';
    })()`);
    if (done === 'unlocked') {
      break;
    }
    await delay(500);
  }
  await delay(500);
  const a2 = await ev(`(function(){
    const btns = Array.from(document.querySelectorAll('#project-list [data-action="publishToCloud"]'));
    return { rows: document.querySelectorAll('#project-list .prow').length,
      pub: btns.map(b => b.textContent.trim()), anyPub: btns.length > 0 };
  })()`);
  check('S3 admin: project rows rendered', a2.rows > 0, a2);
  check('S3 admin: Publish to Cloud button on rows', a2.anyPub, a2);

  // ---- S5: the starter project must open, never ask for a code --------------
  // OWNER 2026-11-01: the seed lived in memory only, so a fresh admin panel
  // never wrote it to mmgr_admin_projects - and the project gate treats an id
  // it cannot find there as a stranger, bouncing the owner out of their own
  // starter project with "enter your access code". Two contracts pinned here:
  // the seed is persisted with a working hash, and a legacy record (plaintext
  // code, no hash) is repaired so its code can actually be accepted.
  const s5 = await ev(`(async function(){
    var seeded = null;
    try { seeded = JSON.parse(localStorage.getItem('mmgr_admin_projects') || 'null'); } catch(e) {}
    var starter = (seeded || []).filter(function(p){ return p && p.id === 'starter-project'; })[0] || null;
    localStorage.setItem('mmgr_admin_projects', JSON.stringify([{ id:'legacy-proj', title:'Legacy', description:'', status:'active', file:'project.html?id=legacy-proj', code:'LEGACY123', codeHash:'' }]));
    loadProjects();
    await repairCodeHashes();
    var repaired = JSON.parse(localStorage.getItem('mmgr_admin_projects') || '[]')[0];
    return {
      starterHash: starter ? starter.codeHash : '',
      starterCode: starter ? starter.code : '',
      repairedHash: repaired ? repaired.codeHash : '',
      repairedLen: repaired ? (repaired.codeHash || '').length : 0
    };
  })()`);
  check(
    'S5 admin: the starter project is persisted with a usable code hash',
    !!s5 && !!s5.starterCode && !!(s5.starterHash && s5.starterHash.length === 64),
    s5
  );
  check(
    'S5 admin: a record with a plaintext code but no hash is repaired',
    !!s5 && s5.repairedLen === 64,
    s5
  );

  // ---- S4: project.html Controls tab -----------------------------------------
  await send('Page.navigate', { url: BASE + '/project.html?id=qa-ctrl' });
  await delay(3500);
  // Local-first: seed an admin record so the gate opens and the cloud module renders.
  await ev(
    `localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-ctrl',title:'QA Ctrl',description:'',status:'active',file:'project.html?id=qa-ctrl',code:'QACTL1',codeHash:'x'}]));`
  );
  await send('Page.navigate', { url: BASE + '/project.html?id=qa-ctrl' });
  await delay(3500);
  // Open the drawer AND switch to the Controls tab (db-ctrl starts hidden via is-hide).
  await ev(`(function(){
    MMGR.App.openDrw();
    MMGR.App.swDtab('ctrl', document.querySelector('.dtab[data-tab="ctrl"]'));
  })()`);
  await delay(1000);
  const p1 = await ev(`(function(){
    const share = document.getElementById('ctrl-share');
    const shareCards = share ? share.querySelectorAll('.share-card').length : 0;
    const shareText = share ? (share.textContent || '') : '';
    const ctrl = document.getElementById('db-ctrl');
    const ctrlText = ctrl ? (ctrl.textContent || '') : '';
    return { shareCards: shareCards,
      shareHasCreate: shareText.indexOf('Create Cloud Project') > -1,
      shareHasOwner: shareText.indexOf('Owner code') > -1 || shareText.indexOf('editor code') > -1 || shareText.indexOf('Link this project') > -1,
      ctrlHasCopyAs: ctrlText.indexOf('Copy As') > -1 || ctrlText.indexOf('Slack') > -1 || ctrlText.indexOf('Email') > -1,
      ctrlHasName: ctrlText.indexOf('Your Name') > -1,
      ctrlHasStatus: ctrlText.indexOf('Status') > -1 || ctrlText.indexOf('Change') > -1 || ctrlText.indexOf('Risk') > -1,
      ctrlLen: ctrlText.length };
  })()`);
  check('S4 project: ctrl-share card rendered', p1.shareCards > 0, p1);
  check(
    'S4 project: Share & Access explains link/share',
    p1.shareHasCreate && p1.shareHasOwner,
    p1
  );
  check(
    'S4 project: Controls has Copy As + Your Name + Status sections',
    p1.ctrlHasCopyAs && p1.ctrlHasName && p1.ctrlHasStatus,
    p1
  );
  console.log('   ctrl text length: ' + p1.ctrlLen);

  // ---- M-2: Your data (export + account delete gating) ---------------------
  // exportMyData() walks every mmgr_* localStorage slot into one timestamped
  // JSON payload and returns it, so we assert the shape directly. We also
  // render the account-delete block while SIGNED OUT and require it to stay
  // empty (the Worker's delete endpoint only makes sense behind a session).
  const m2 = await ev(`(async function(){
    var p = MMGR.App.exportMyData();
    var keys = Object.keys(p.data);
    await MMGR.App.renderDataAccount();
    var host = document.getElementById('data-account');
    return {
      count: p.count,
      keysAllMmgr: keys.length > 0 && keys.every(function(k){ return k.indexOf('mmgr_') === 0; }),
      seeded: keys.indexOf('mmgr_admin_projects') > -1,
      hasAt: /^\\d{4}-\\d{2}-\\d{2}T/.test(p.exportedAt || ''),
      hasExportBtn: !!document.querySelector('[data-action="exportMyData"]'),
      hostHtml: host ? host.innerHTML : ''
    };
  })()`);
  check(
    'M-2 export: one timestamped JSON payload, every key an mmgr_ slot, the seeded record included',
    m2.count >= 1 && m2.keysAllMmgr && m2.seeded && m2.hasAt,
    m2
  );
  check(
    'M-2 export: Download button present in the Your data section',
    m2.hasExportBtn === true,
    m2
  );
  check(
    'M-2 delete: signed out -> NO account-delete block is rendered',
    m2.hostHtml.indexOf('Delete my account') === -1 &&
      m2.hostHtml.indexOf('del-acct-secret') === -1,
    { hostLen: m2.hostHtml.length }
  );

  // ---- S6: the settings drawer must never trap the user ---------------------
  // OWNER 2026-11-01: the drawer opened from the Core-Mode callout appeared to
  // have no exit. Its header X works, but there was no gesture-based way out
  // and Focus Mode made the whole panel invisible. Three exits pinned here:
  // the header close, Escape, and a click on the workspace behind it; plus a
  // jump from Focus Mode must land on a visible drawer, not a hidden one.
  const s6 = await ev(`(async function(){
    function clear(){ var d = document.getElementById('drw'); if (d) d.classList.remove('open'); document.body.classList.remove('focus-mode'); }
    function isOpen(){ var d = document.getElementById('drw'); return !!(d && d.classList.contains('open')); }
    function visible(){ var d = document.getElementById('drw'); if (!d || !d.classList.contains('open')) return false; var s = getComputedStyle(d); return s.display !== 'none' && s.visibility !== 'hidden'; }
    clear();
    MMGR.App.openDrw();
    var afterOpen = isOpen();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    var afterEsc = isOpen();
    clear();
    MMGR.App.openDrw();
    document.body.click();
    var afterOutside = isOpen();
    clear();
    // Real Focus Mode (state + body class); openPacks must leave it.
    if (!document.body.classList.contains('focus-mode')) MMGR.App.tglFocusMode();
    var inFocus = document.body.classList.contains('focus-mode');
    MMGR.App.openPacks();
    var fromFocus = visible();
    var stillFocus = document.body.classList.contains('focus-mode');
    var x = document.querySelector('#drw .dh button[data-action="closeDrw"]');
    if (x) x.click();
    var afterX = isOpen();
    document.body.classList.remove('focus-mode');
    return { afterOpen: afterOpen, afterEsc: afterEsc, afterOutside: afterOutside, inFocus: inFocus, fromFocus: fromFocus, stillFocus: stillFocus, afterX: afterX, closeBtn: !!x };
  })()`);
  check(
    'S6 drawer: opens, and the header close button closes it',
    !!s6 && s6.afterOpen === true && s6.closeBtn === true && s6.afterX === false,
    s6
  );
  check('S6 drawer: Escape closes it', !!s6 && s6.afterEsc === false, s6);
  check(
    'S6 drawer: a click on the workspace behind it closes it',
    !!s6 && s6.afterOutside === false,
    s6
  );
  check(
    'S6 drawer: the packs jump from Focus Mode lands on a VISIBLE panel',
    !!s6 && s6.inFocus === true && s6.fromFocus === true && s6.stillFocus === false,
    s6
  );

  try {
    await send('Page.close');
  } catch (e) {}
  try {
    proc.kill();
  } catch (e) {}
  const failed = results.filter(r => !r.val);
  console.log('========================================');
  console.log(results.length + ' checks, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.log('HARNESS ERROR: ' + ((e && e.stack) || e));
  try {
    proc.kill();
  } catch (x) {}
  process.exit(1);
});
