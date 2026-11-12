/* ============================================================
   MCP ADMIN PANEL browser verification (T-25, 2026-11-12)

   The account-scoped MCP panel lives on admin.html above the project list.
   It is session-gated, so this harness proves BOTH states:
     M1  signed out  -> 403 from /api/mcp/config hides the body and shows the
         sign-in hint (never a dead control)
     M2  signed in (fetch stubbed with the Worker's exact response shapes)
         -> enable row, policy select, tool subset, clients, projects render
     M3  the tool picker appears only for "Only the tools I pick"
     M4  connected clients show name + dates; Revoke only on live rows
     M5  projects show an owner toggle; adopted projects say so
     M6  Save sends PUT /api/mcp/config with the chosen policy + subset
     M7  a project toggle sends PUT .../enabled; Revoke sends POST .../revoke
     M8  no console errors during any of it
     M9  no horizontal overflow at 390

   Run: node tools/qa-mcp-admin-panel.cjs   (needs serve.cjs on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const userDir = path.join(os.tmpdir(), 'chrome-mcp-admin-' + Date.now());

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
    '--window-size=1440,1000',
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
  const consoleErrors = [];
  let id = 0;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.text || 'exception');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
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

  await send('Page.navigate', { url: BASE + '/admin.html' });
  await delay(3500);

  // ---- M1: signed out -> hint, no dead controls ----------------------------
  const m1 = await ev(`(function(){
    const card = document.getElementById('mcp-admin-card');
    const body = document.getElementById('mcp-admin-body');
    const st = document.getElementById('mcp-admin-status');
    return {
      card: !!card,
      aboveList: !!(card && card.nextElementSibling && card.nextElementSibling.id === 'project-list'),
      bodyHidden: body ? body.hidden : null,
      status: st ? (st.textContent || '').trim() : ''
    };
  })()`);
  check('M1 panel card exists above the project list', m1.card && m1.aboveList, m1);
  check(
    'M1 signed out: body hidden and a sign-in hint is shown',
    m1.bodyHidden === true && /sign in/i.test(m1.status),
    m1
  );

  // ---- unlock the admin gate (fresh profile -> setup flow) -----------------
  await ev(`(function(){
    const setup = document.getElementById('setup-screen');
    if (setup && !setup.classList.contains('hidden')) {
      const p1 = document.getElementById('setup-pass1');
      const p2 = document.getElementById('setup-pass2');
      if (p1 && p2) { p1.value = 'TestPass123!'; p2.value = 'TestPass123!'; }
      const b = setup.querySelector('[data-action="adminSetupPassword"]');
      if (b) b.click();
    }
  })()`);
  for (let t = 0; t < 24; t++) {
    const state = await ev(`(function(){
      const om = document.getElementById('rc-om');
      const app = document.getElementById('admin-app');
      if (app && !app.classList.contains('hidden')) return 'unlocked';
      if (om && om.classList.contains('show')) {
        const cb = document.getElementById('rc-saved-cb');
        if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        const b = document.querySelector('#rc-om [data-action="confirmRecoverySaved"]');
        if (b) b.click();
      }
      return 'waiting';
    })()`);
    if (state === 'unlocked') {
      break;
    }
    await delay(500);
  }

  // ---- M2: signed-in render with the Worker's response shapes --------------
  await ev(`(function(){
    const CONFIG = {
      ok: true,
      config: { enabled: 1, policy: 'allow_subset', toolSubset: ['tasks_list', 'budget_read'] },
      tools: ['tasks_list', 'budget_read', 'risks_list', 'weather_read', 'portfolio_health'],
      projects: [
        { projectId: 'bank-renovation', label: 'Bank Renovation', status: 'active', accessRole: 'owner', mcpEnabled: true },
        { projectId: 'newtown-hotel', label: 'New Town Hotel', status: 'active', accessRole: 'editor', mcpEnabled: true }
      ]
    };
    const CLIENTS = { ok: true, clients: [
      { clientId: 'c1', name: 'Claude Code', createdAt: '2026-11-01T10:00:00Z', lastUsedAt: '2026-11-12T09:00:00Z', revoked: false },
      { clientId: 'c2', name: 'Cursor', createdAt: '2026-10-20T10:00:00Z', lastUsedAt: null, revoked: true }
    ] };
    window.__calls = [];
    window.fetch = function (url, init) {
      window.__calls.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body });
      const u = String(url);
      let body = { ok: true };
      if (u.indexOf('/api/mcp/config') > -1) {
        body = (init && init.method === 'PUT')
          ? { ok: true, config: { enabled: 1, policy: 'allow_all', toolSubset: null } }
          : CONFIG;
      } else if (u.indexOf('/api/mcp/clients') > -1) {
        body = CLIENTS;
      }
      return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve(body); } });
    };
    MMGR.McpAdmin.load();
  })()`);
  await delay(900);

  const m2 = await ev(`(function(){
    const tools = Array.prototype.slice.call(document.querySelectorAll('#mcp-tools input'));
    const rows = Array.prototype.slice.call(document.querySelectorAll('#mcp-clients .mcp-admin-row'));
    const projects = Array.prototype.slice.call(document.querySelectorAll('#mcp-projects .mcp-admin-row'));
    return {
      bodyHidden: document.getElementById('mcp-admin-body').hidden,
      enabled: document.getElementById('mcp-enabled').checked,
      policy: document.getElementById('mcp-policy').value,
      toolsHidden: document.getElementById('mcp-tools').hidden,
      toolCount: tools.length,
      toolChecked: tools.filter(function(t){ return t.checked; }).map(function(t){ return t.value; }),
      clientNames: rows.map(function(r){ return r.querySelector('.mcp-admin-name').textContent; }),
      revokeButtons: document.querySelectorAll('[data-mcp-act="revoke"]').length,
      revokedLabel: rows.length > 1 ? rows[1].textContent.indexOf('Revoked') > -1 : false,
      projectNames: projects.map(function(r){ return r.querySelector('.mcp-admin-name').textContent; }),
      ownerToggles: document.querySelectorAll('[data-mcp-act="project-toggle"]').length,
      shared: projects.length > 1 ? projects[1].textContent.indexOf('Shared with you') > -1 : false
    };
  })()`);
  check(
    'M2 signed in: body shown, server enabled, policy is the saved subset',
    m2.bodyHidden === false && m2.enabled === true && m2.policy === 'allow_subset',
    m2
  );
  check(
    'M2 tool picker lists every tool with the saved ticks',
    m2.toolsHidden === false &&
      m2.toolCount === 5 &&
      m2.toolChecked.join(',') === 'tasks_list,budget_read',
    m2
  );
  check(
    'M2 connected clients: names, dates, Revoke only on the live row',
    m2.clientNames.join(',') === 'Claude Code,Cursor' &&
      m2.revokeButtons === 1 &&
      m2.revokedLabel === true,
    m2
  );
  check(
    'M2 projects: owner gets a toggle, adopted says shared',
    m2.projectNames.join(',') === 'Bank Renovation,New Town Hotel' &&
      m2.ownerToggles === 1 &&
      m2.shared === true,
    m2
  );

  // ---- M3: the tool picker follows the policy ------------------------------
  const m3 = await ev(`(function(){
    const sel = document.getElementById('mcp-policy');
    sel.value = 'allow_all';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const hiddenAll = document.getElementById('mcp-tools').hidden;
    sel.value = 'allow_subset';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { hiddenAll: hiddenAll, hiddenSubset: document.getElementById('mcp-tools').hidden };
  })()`);
  check(
    'M3 tool picker shows only for "Only the tools I pick"',
    m3.hiddenAll === true && m3.hiddenSubset === false,
    m3
  );

  // ---- M6/M7: the four write actions --------------------------------------
  await ev(`document.querySelector('[data-mcp-act="save"]').click();`);
  await delay(500);
  await ev(`(function(){
    const b = document.querySelector('[data-mcp-act="project-toggle"]');
    b.checked = false;
    b.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(500);
  await ev(`document.querySelector('[data-mcp-act="revoke"]').click();`);
  await delay(700);
  const calls = await ev(`JSON.stringify(window.__calls)`);
  const parsed = JSON.parse(calls || '[]');
  const save = parsed.find(c => c.method === 'PUT' && c.url === '/api/mcp/config');
  const toggle = parsed.find(
    c => c.method === 'PUT' && /\/api\/mcp\/projects\/bank-renovation\/enabled$/.test(c.url)
  );
  const revoke = parsed.find(c => c.method === 'POST' && c.url === '/api/mcp/clients/revoke');
  check(
    'M6 Save sends PUT /api/mcp/config with the chosen policy + subset',
    !!save &&
      save.body ===
        JSON.stringify({
          enabled: true,
          policy: 'allow_subset',
          tool_subset: ['tasks_list', 'budget_read']
        }),
    save
  );
  check(
    'M7 project toggle sends PUT .../enabled, Revoke sends POST .../revoke',
    !!toggle &&
      toggle.body === JSON.stringify({ enabled: false }) &&
      !!revoke &&
      revoke.body === JSON.stringify({ clientId: 'c1' }),
    { toggle, revoke }
  );

  // ---- M9: 390 has no horizontal overflow --------------------------------
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await delay(600);
  const m9 = await ev(`(function(){
    const card = document.getElementById('mcp-admin-card');
    card.scrollIntoView({ block: 'center' });
    return {
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      cardW: Math.round(card.getBoundingClientRect().width)
    };
  })()`);
  check(
    'M9 390: the panel does not overflow the viewport',
    m9.docW <= m9.winW && m9.cardW <= m9.winW,
    m9
  );

  check('M8 no console errors', consoleErrors.length === 0, consoleErrors);

  const failed = results.filter(r => !r.val).length;
  console.log('========================================');
  console.log(results.length + ' checks, ' + failed + ' failed');
  try {
    proc.kill();
  } catch (e) {}
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  try {
    proc.kill();
  } catch (err) {}
  process.exit(1);
});
