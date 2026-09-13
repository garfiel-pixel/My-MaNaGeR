/* ============================================================
   CLIENT CODES END-TO-END (C19 / AREA C, 2026-09-04)
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 emulation, migrations applied) and verifies the C19 client
   portal surface:

   P1  create client code with sections + expiresInDays -> code +
       expiresAt (future); response sections echo the grant
   P2  lookup the client code -> role 'client' + sections
   P3  /load with X-Client-Code -> role 'client' + sections
   P4  /meta with X-Client-Code -> role 'client' + sections +
       updatedAt (powers the C1b refresh cadence)
   P5  /save with X-Client-Code -> 403 (clients can never write)
   P6  create with expiresInDays 0 -> never expires (no expiresAt)
   P7  create with expiresAt in the past -> lookup answers
       code_expired + /load answers code_expired (403)
   P8  revoke a client code -> lookup no longer resolves
   P9  deleted project -> client lookup answers project_deleted
   P10 headless Chrome (launcher + project): cloudCodeOpen client
       branch seeds escope role 'client' + sections and navigates;
       project.html boots with body.client-scope, grants visible,
       non-granted .sec-btn hidden (applyClientScope)

   Exit 0 only when all checks pass.
   Usage: node tools/qa-client-codes.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8798;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');

const log = (s) => { process.stdout.write('[cc] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400)));
};

let proc = null;
setTimeout(() => { log('WATCHDOG — harness exceeded 360s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 360000).unref();

function globalWranglerJs() {
  const localP = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (fs.existsSync(localP)) return localP;
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-cc-wstate-' + Date.now());

function startWrangler() {
  return new Promise((resolve, reject) => {
    try {
      execFileSync(process.execPath, [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR], { cwd: ROOT, stdio: 'ignore' });
    } catch (e) { /* migrations may already be applied */ }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
      cwd: ROOT, stdio: 'ignore',
      env: Object.assign({}, process.env, { ADMIN_CODE: 'QA-CC-ADMIN' })
    });
    proc.on('error', (e) => reject(new Error('wrangler spawn failed: ' + e.message)));
    proc.on('exit', (code) => { if (code !== 0 && code !== null) log('wrangler dev exited early (code ' + code + ')'); });
    // NOTHING touches `proc` after this. The browser click below targets the
    // `code-entry-btn` button element directly via CDP page evaluation; it does
    // NOT invoke `proc.stdin.write` or any child_process control channel.
    const poll = async (tries) => {
      if (tries <= 0) return reject(new Error('wrangler dev did not come up in 120s'));
      try {
        const r = await fetch(BASE + '/api/health');
        if (r.ok) return resolve();
      } catch (e) { /* not up yet */ }
      await delay(2000);
      return poll(tries - 1);
    };
    poll(60);
  });
}

const j = async (res) => { try { return await res.json(); } catch (e) { return {}; } };

(async function main() {
  try {
    await startWrangler();
    const pid = 'cc-qa-' + Date.now().toString(36);

    // P0a: mint a real session (email register + login) — client-code
    // create/list/revoke require a signed-in session matching the project
    // owner (google_sub), unlike editor codes which are owner-code-only.
    let r = await fetch(BASE + '/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cc-qa@example.com', password: 's3cure-pass-1', name: 'Client QA' })
    });
    let reg = await j(r);
    let cookie = '';
    const sc = r.headers.get('set-cookie') || '';
    const m = sc.match(/mmgr_session=([^;]+)/);
    if (m) cookie = m[1];
    if (!cookie || !reg.ok) {
      // Fall back to login (account may exist from a previous run's WAL).
      r = await fetch(BASE + '/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'cc-qa@example.com', password: 's3cure-pass-1' })
      });
      reg = await j(r);
      const sc2 = r.headers.get('set-cookie') || '';
      const m2 = sc2.match(/mmgr_session=([^;]+)/);
      if (m2) cookie = m2[1];
    }
    const authHeaders = { 'Content-Type': 'application/json' };
    if (cookie) authHeaders.Cookie = 'mmgr_session=' + cookie;
    check('P0a email session minted (client-code create needs a signed-in owner)', !!cookie && !!reg.ok, { reg, hasCookie: !!cookie });

    // P0: create a cloud project WITH the session (so google_sub matches) +
    // save a snapshot so the launcher open can navigate (needs rd.state).
    r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST', credentials: 'same-origin',
      headers: authHeaders,
      body: JSON.stringify({ projectId: pid, name: 'Client Codes QA' })
    });
    const created = await j(r);
    check('P0 create cloud project (session-linked)', r.ok && created.ok && !!created.ownerCode, created);
    const ownerCode = created.ownerCode;
    const ownerHeaders = Object.assign({ 'X-Owner-Code': ownerCode }, authHeaders);
    const snapshot = { name: 'Client Codes QA', tasks: [{ id: 't1', title: 'Client-visible task' }], wbs: [{ id: 'w1' }], def: { scope: 'x' } };
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ state: snapshot })
    });
    const saved = await j(r);
    check('P0b owner save ok (snapshot for the client to load)', r.ok && saved.ok, saved);

    // P0c-e: EDITOR code lookup must carry the scope (OWNER BUG 2026-09-12:
    // the launcher's code-entry flow seeds the project-page grant from this
    // lookup; without `scope` the fresh-device editor saw "editor for
    // unknown" and zero granted panels).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST', credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ label: 'HR Editor', scope: ['res', 'wbs'], role: 'editor' })
    });
    const ec = await j(r);
    check('P0c create editor code (scope res+wbs)', r.ok && ec.ok && !!ec.editorCode && (ec.scope || []).join(',') === 'res,wbs', ec);
    const editorCode = ec.editorCode;
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: editorCode })
    });
    const elk = await j(r);
    check('P0d editor code lookup -> role editor + scope res+wbs (fix gate)', r.ok && elk.ok && elk.role === 'editor' && elk.projectId === pid && (elk.scope || []).join(',') === 'res,wbs', elk);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Editor-Code': editorCode },
      body: JSON.stringify({})
    });
    const eld = await j(r);
    check('P0e load with X-Editor-Code -> role editor + scope (grant parity)', r.ok && eld.ok && eld.role === 'editor' && (eld.scope || []).join(',') === 'res,wbs' && !!eld.state, eld);

    // P1: create client code with sections + 30-day expiry.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'POST', credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ sections: ['wbs', 'bud'], expiresInDays: 30 })
    });
    const cc = await j(r);
    const futureOk = !!cc.expiresAt && new Date(cc.expiresAt).getTime() > Date.now();
    check('P1 create client code (sections + 30d expiry)', r.ok && cc.ok && !!cc.code && cc.sections.join(',') === 'wbs,bud' && futureOk, cc);
    const clientCode = cc.code;

    // P2: lookup resolves to role client + sections.
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: clientCode })
    });
    const lk = await j(r);
    check('P2 client code lookup -> role client + sections', r.ok && lk.ok && lk.role === 'client' && lk.projectId === pid && (lk.sections || []).join(',') === 'wbs,bud', lk);

    // P3: /load under X-Client-Code.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Client-Code': clientCode },
      body: JSON.stringify({})
    });
    const cl = await j(r);
    check('P3 load with X-Client-Code -> role client + sections + state', r.ok && cl.ok && cl.role === 'client' && (cl.sections || []).join(',') === 'wbs,bud' && cl.state && cl.state.name === 'Client Codes QA', cl);

    // P4: /meta under X-Client-Code (C1b refresh cadence probe) — GET only.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/meta', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-Client-Code': clientCode }
    });
    const cm = await j(r);
    check('P4 meta with X-Client-Code -> role client + sections + updatedAt', r.ok && cm.ok && cm.role === 'client' && !!cm.updatedAt, cm);

    // P5: /save under X-Client-Code is refused (clients never write).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Client-Code': clientCode },
      body: JSON.stringify({ state: { hacked: true } })
    });
    const cs = await j(r);
    check('P5 save with X-Client-Code -> refused (403)', r.status === 403 && !cs.ok, { status: r.status, cs });

    // P6: never-expiring code (expiresInDays 0 / omitted).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'POST', credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ sections: ['dash'], expiresInDays: 0 })
    });
    const cn = await j(r);
    check('P6 create with expiresInDays 0 -> never expires (no expiresAt)', r.ok && cn.ok && !cn.expiresAt, cn);

    // P7: expired code — expiresAt in the past -> lookup + load answer code_expired.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'POST', credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ sections: ['risk'], expiresAt: new Date(Date.now() - 86400000).toISOString() })
    });
    const cx = await j(r);
    const expCode = cx.code;
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: expCode })
    });
    const exl = await j(r);
    check('P7a expired code lookup -> code_expired', r.status === 403 && !exl.ok && exl.error === 'code_expired', { status: r.status, exl });
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Client-Code': expCode },
      body: JSON.stringify({})
    });
    const exd = await j(r);
    check('P7b expired code load -> code_expired (403)', r.status === 403 && exd.error === 'code_expired', { status: r.status, exd });

    // P8: revoked client code no longer resolves.
    const listRes = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'GET', credentials: 'same-origin', headers: ownerHeaders
    });
    const list = await j(listRes);
    const revokedId = (list.codes || []).find(c => (c.sections || []).join(',') === 'dash' && !c.expires_at);
    check('P8a list returns codes incl. expires_at field', listRes.ok && list.ok && (list.codes || []).length >= 3 && (list.codes || []).every(c => 'expires_at' in c), list);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes/' + (revokedId && revokedId.id), {
      method: 'DELETE', credentials: 'same-origin', headers: ownerHeaders
    });
    const rv = await j(r);
    check('P8b revoke ok', r.ok && rv.ok, rv);
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cn.code })
    });
    const rvl = await j(r);
    check('P8c revoked client code lookup -> generic 403 (no match)', r.status === 403 && !rvl.ok, { status: r.status, rvl });

    // P10: headless Chrome — launcher cloudCodeOpen client branch + project
    // boot applyClientScope (grants visible, non-granted nav hidden).
    try {
      const { chromePath } = require('./chrome-launcher.cjs');
      const userDir = path.join(os.tmpdir(), 'chrome-cc-' + Date.now());
      const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
        '--remote-allow-origins=*', '--remote-debugging-port=9231',
        '--user-data-dir=' + userDir, '--window-size=1280,900', '--disk-cache-size=0', 'about:blank'], { stdio: 'ignore' });
      let ws = null;
      for (let i = 0; i < 40; i++) {
        try { const v = await (await fetch('http://127.0.0.1:9231/json/version')).json(); if (v.webSocketDebuggerUrl) break; } catch (e) {}
        await delay(300);
      }
      const targets = await (await fetch('http://127.0.0.1:9231/json')).json();
      const tgt = targets.find(t => t.type === 'page');
      ws = new WebSocket(tgt.webSocketDebuggerUrl);
      const pending = new Map(); let cid = 0;
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
      const send = (method, params = {}) => new Promise(res => { const mid = ++cid; pending.set(mid, m => res(m.result || {})); ws.send(JSON.stringify({ id: mid, method, params })); });
      const ev = async (expr) => { const rr = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return rr && rr.result && rr.result.value; };
      await send('Page.enable');
      const navReq = await send('Page.navigate', { url: BASE + '/app.html' });
      log('P10 Page.navigate result: ' + JSON.stringify(navReq));
      await delay(3500);
      // Install ONE console.error override, once, before touching the click.
      // The previous staging installed two separate overrides (one before click,
      // one after) — the second overwrote the first from a fresh empty array, so
      // postClickConsole was always [] regardless of what cloudCodeOpen threw.
      // This single live array is readable at any point and stays honest.
      await ev(`(function(){
        if (window.__mmgrConsoleErrors) return;
        window.__mmgrConsoleErrors = [];
        const orig = console.error;
        console.error = function() {
          window.__mmgrConsoleErrors.push(Array.prototype.slice.call(arguments).map(String).join(' '));
          orig.apply(console, arguments);
        };
      })()`);
      // Before polling for the button wiring, enter the client code into the input
      // so that the moment the button becomes wired the code is ready. The input is a
      // plain text field (fill via JavaScript, not CDP input), and the button is a plain
      // DOM element (click via JavaScript, not CDP click). Both happen in the page,
      // not in the node process.
      const wireDeadline = Date.now() + 45000;
      const pollReads = [];
      let wiredUntil = null;
      let pollI = 0;
      while (Date.now() < wireDeadline) {
        pollI++;
        try {
          const s = await ev(`(function(){ try {
            const _b = document.getElementById('code-entry-btn');
            const _in = document.getElementById('code-entry-in');
            return {
              wired: (typeof DASH_ACTION_MAP === 'object' && DASH_ACTION_MAP && typeof DASH_ACTION_MAP['cloudCodeOpen'] === 'function'),
              btnDisabled: _b ? !!_b.disabled : true,
              cloudCodeOpenDefined: typeof cloudCodeOpen === 'function',
              bodyClass: document.body ? document.body.className : '',
              btnExists: !!_b,
              codeEntryExists: !!_in,
              cdSectionExists: !!document.getElementById('code-entry'),
            };
          } catch(e) { return { error: 'eval-threw: ' + String(e && e.message || e) }; } })()`);
          if (s && s.error) { log('P10 poll eval error: ' + s.error); }            if (s && !s.error) {
              if (s) pollReads.push({ i: pollI, t: Date.now(), s });
              if (s.wired && !s.btnDisabled) { wiredUntil = s; break; }
            }
        } catch (e) { log('P10 poll eval error (outer): ' + String(e && e.message || e)); }
        await delay(250);
      }
      log('P10 pollN=' + pollI + ' wiredUntil=' + JSON.stringify(wiredUntil));
      if (!wiredUntil) {
        log('P10 wire poll reads (last 4): ' + JSON.stringify(pollReads.slice(-4)));
        const why = await ev(`(function(){ try {
          const _b = document.getElementById('code-entry-btn');
          return {
            btnPresent: !!_b,
            btnDisabled: _b ? !!_b.disabled : null,
            cloudCodeOpenDefined: typeof cloudCodeOpen === 'function',
            dashActionHasKey: !!(typeof DASH_ACTION_MAP === 'object' && DASH_ACTION_MAP && DASH_ACTION_MAP['cloudCodeOpen']),
            scriptCount: document.querySelectorAll('script').length,
          };
        } catch(e) { return { error: 'never-wired eval-threw: ' + String(e && e.message || e) }; })()`);
        log('P10 never-wired snapshot=' + JSON.stringify(why));
      }

      // Navigate the input value and click in the SAME synchronous eval, so the value
      // is definitely set before the click dispatches. Both operations happen inside the
      // page, not in the node process.
      const prepAndClick = await ev(`(function(){ try {
            var b = document.getElementById('code-entry-btn');
            var inp = document.getElementById('code-entry-in');
            var inited = (function(){ try { return typeof DASH_ACTION_MAP === 'object' && DASH_ACTION_MAP && typeof DASH_ACTION_MAP['cloudCodeOpen'] === 'function'; } catch(e) { return false; } })();
            var ready = !!(b && !b.disabled && inited);
            var preFill = { btnTextBefore: b ? b.textContent.trim() : null, inValueBefore: inp ? inp.value : null };
            var clicked = false;
            if (ready && inp) inp.value = ${JSON.stringify(clientCode)};
            var postFill = { inValueAfter: inp ? inp.value : null };
            if (ready && b) { b.click(); clicked = true; }
            return { clicked: clicked, ready: ready, preFill: preFill, postFill: postFill };
          } catch(e) { return { clicked: false, error: e && e.message ? String(e.message) : String(e) }; } })()`);
      log('P10 prepAndClick: ' + JSON.stringify(prepAndClick));
      // cloudCodeOpen is async: two sequential fetches before it navigates, and
      // local wrangler dev cold fetches run 1.5s+ each. A fixed sleep is a race
      // (probe2: the flow completed but after the harness's 4s window). POLL for
      // the navigation instead; every sample carries the console-error capture
      // and the escope/unlocked storage state as diagnostic evidence.
      const navDeadline = Date.now() + 30000;
      const navSamples = [];
      let navState = null;
      while (Date.now() < navDeadline) {
        await delay(500);
        navState = await ev(`(function(){ try {
          var b = document.getElementById('code-entry-btn'); var s = document.getElementById('code-entry-status');
          return { href: location.href, btnText: b ? b.textContent.trim() : null, status: s ? s.textContent : null,
            inValue: (document.getElementById('code-entry-in') || {}).value || null,
            errs: window.__mmgrConsoleErrors || [],
            escope: (function(){ try { var raw = sessionStorage.getItem('mmgr_cloud_escope_${pid}'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } })(),
            unlocked: localStorage.getItem('mmgr_unlocked_${pid}') };
        } catch(e) { return { error: String(e && e.message || e) }; } })()`);
        if (navState && !navState.error) {
          navSamples.push(navState);
          // Production strips .html (project.html -> /project); accept both.
          if (navState.href.indexOf('project.html?id=' + pid) > -1 || navState.href.indexOf('/project?id=' + pid) > -1) break;
          if (navState.btnText === 'Open from Cloud' && navState.status) break; // flow returned with an error message
        }
      }
      const consoleErrors = (navSamples.length ? navSamples[navSamples.length - 1].errs : []);
      const postClickPageState = navState ? { href: navState.href, btnTextAfter: navState.btnText, statusText: navState.status, inValueAfter: navState.inValue } : null;
      const launcherState = navState ? { href: navState.href, escope: navState.escope, unlocked: navState.unlocked } : null;
      const esc = launcherState && launcherState.escope;
      // Production strips .html (project.html -> /project); accept both.
      const navOk = launcherState && (launcherState.href.indexOf('project.html?id=' + pid) > -1 || launcherState.href.indexOf('/project?id=' + pid) > -1);
      check('P10a launcher client open -> navigates to project + escope role client', navOk && esc && esc.role === 'client' && (esc.sections || []).join(',') === 'wbs,bud', { launcherState, consoleErrors, prepAndClick, postClickPageState, navSamples: navSamples.slice(-3) });
      // Project boot: poll for applyClientScope's body class + banner instead of
      // sleeping (renders land inside requestAnimationFrame; re-reading beats a
      // fixed wait, and a fresh navigation needs its own boot time).
      const bootDeadline = Date.now() + 20000;
      let scopeState = null;
      while (Date.now() < bootDeadline) {
        await delay(600);
        scopeState = await ev(`(function(){
          const sec = function(s){ const b = document.querySelector('.sec-btn[data-section="' + s + '"]'); return b ? { hidden: b.classList.contains('client-hidden'), aria: b.getAttribute('aria-hidden') } : null; };
          return { clientScope: document.body.classList.contains('client-scope'),
            readonly: document.body.classList.contains('readonly-mode') || (document.body.getAttribute('data-scope') === 'readonly'),
            wbs: sec('wbs'), def: sec('def'), dash: sec('dash'),
            banner: (function(){ const b = document.getElementById('client-scope-banner'); return b ? !b.classList.contains('is-hide') : null; })() };
        })()`);
        if (scopeState && scopeState.clientScope === true && scopeState.banner === true) break;
      }
      check('P10b project boots client scope (readonly + banner)', scopeState && scopeState.clientScope === true && scopeState.banner === true, scopeState);
      check('P10c granted section visible / non-granted hidden (applyClientScope)',
        scopeState && scopeState.wbs && scopeState.wbs.hidden === false && scopeState.def && scopeState.def.hidden === true, scopeState);
      // P10 done — close the CDP socket and Chrome exactly once, AFTER every page eval.
      log('P10 done; closing chrome + ws');
      try { ws.close(); } catch (e) {}
      try { chrome.kill(); } catch (e) {}
    } catch (e) {
      check('P10 headless chrome section', false, { threw: String(e && e.message || e) });
    }


    // P9: deleted project -> client lookup answers project_deleted.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/delete', {
      method: 'POST', credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({})
    });
    const del = await j(r);
    check('P9a soft delete ok', r.ok && del.ok, del);
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: clientCode })
    });
    const dll = await j(r);
    check('P9b client lookup after project delete -> project_deleted', r.status === 403 && dll.error === 'project_deleted', { status: r.status, dll });

    const failed = results.filter(x => !x.val).length;
    log('----------------------------------------');
    log(failed === 0 ? 'ALL CLIENT-CODE GATES PASSED' : failed + ' CHECK(S) FAILED');
    try { proc && proc.kill(); } catch (e) {}
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    log('HARNESS ERROR: ' + (e && e.stack || e));
    try { proc && proc.kill(); } catch (x) {}
    process.exit(1);
  }
})();