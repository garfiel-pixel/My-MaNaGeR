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

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
  '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + userDir, '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });

const results = [];
function check(name, val, detail) {
  results.push({ name, val: !!val, detail });
  console.log((val ? '[PASS] ' : '[FAIL] ') + name + (val ? '' : '  <-- ' + JSON.stringify(detail)));
}

(async () => {
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
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable'); await send('Page.enable');

  // ---- S1/S2: admin.html (DOM presence — elements exist even while the gate hides #admin-app) --
  await send('Page.navigate', { url: BASE + '/admin.html' });
  await delay(3000);
  const a1 = await ev(`(function(){
    const hdr = document.querySelector('#admin-app header');
    const rail = document.getElementById('app-sidebar');
    const railAuth = rail && rail.querySelector('.auth-bar');
    const toolbar = document.querySelector('.toolbar');
    return {
      hdrSignin: !!(hdr && hdr.querySelector('#google-signin-button')),
      hdrTheme: !!(hdr && hdr.querySelector('[data-action="tglTheme"]')),
      railAuth: !!railAuth,
      railSignin: !!(railAuth && railAuth.querySelector('#google-signin-button')),
      railChip: !!(railAuth && railAuth.querySelector('#google-user-chip')),
      railCtl: (rail && rail.querySelectorAll('.rail-ctl-row').length) || 0,
      toolbarTxt: toolbar ? (toolbar.textContent || '') : '',
      fileInput: !!document.getElementById('import-project-file')
    };
  })()`);
  check('S1 admin header: no sign-in / theme in header', !a1.hdrSignin && !a1.hdrTheme, a1);
  check('S1 admin rail: auth-bar mount + sign-in + chip in rail', a1.railAuth && a1.railSignin && a1.railChip, a1);
  // D11 (2026-09-03): the Appearance row was consolidated into the shared
  // bottom dock — the rail now carries Premium / Premium Glass / Cross-Project.
  check('S1 admin rail: Customize rows (premium/glass/cross-project)', a1.railCtl === 3, a1);
  check('S2 admin toolbar: Import Project present', a1.toolbarTxt.indexOf('Import Project') > -1, a1.toolbarTxt);
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
    if (done === 'unlocked') break;
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

  // ---- S4: project.html Controls tab -----------------------------------------
  await send('Page.navigate', { url: BASE + '/project.html?id=qa-ctrl' });
  await delay(3500);
  // Local-first: seed an admin record so the gate opens and the cloud module renders.
  await ev(`localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-ctrl',title:'QA Ctrl',description:'',status:'active',file:'project.html?id=qa-ctrl',code:'QACTL1',codeHash:'x'}]));`);
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
  check('S4 project: Share & Access explains link/share', p1.shareHasCreate && p1.shareHasOwner, p1);
  check('S4 project: Controls has Copy As + Your Name + Status sections', p1.ctrlHasCopyAs && p1.ctrlHasName && p1.ctrlHasStatus, p1);
  console.log('   ctrl text length: ' + p1.ctrlLen);

  try { await send('Page.close'); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  const failed = results.filter(r => !r.val);
  console.log('========================================');
  console.log(results.length + ' checks, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + (e && e.stack || e)); try { proc.kill(); } catch (x) {} process.exit(1); });
