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
    M10  the connection URL is origin + /api/mcp, Copy reports, Retry reloads

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

  // ---- M10: the connection URL is the app-wide MCP endpoint ----------------
  const m10 = await ev(`(function(){
    const input = document.getElementById('mcp-connect-url');
    const copy = document.querySelector('[data-mcp-act="copy-url"]');
    const retry = document.querySelector('[data-mcp-act="reload"]');
    return {
      value: input ? input.value : '',
      origin: location.origin,
      copy: !!copy,
      retry: !!retry,
      steps: document.querySelectorAll('.mcp-admin-steps li').length
    };
  })()`);
  check(
    'M10 connection URL is origin + /api/mcp, with Copy, Retry and the Claude steps',
    m10.value === m10.origin + '/api/mcp' && m10.copy && m10.retry && m10.steps >= 5,
    m10
  );

  await ev(`document.querySelector('[data-mcp-act="copy-url"]').click();`);
  await delay(700);
  const copyState = await ev(`(function(){
    return {
      status: (document.getElementById('mcp-admin-status').textContent || '').trim(),
      value: document.getElementById('mcp-connect-url').value
    };
  })()`);
  check(
    'M10b Copy reports success (or asks for a manual copy) and never clears the URL',
    copyState.value.indexOf('/api/mcp') > -1 && /copied|Select the URL/i.test(copyState.status),
    copyState
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
      } else if (u.indexOf('/reviews') > -1) {
        body = u.indexOf('/accept') > -1 || u.indexOf('/reject') > -1
          ? { ok: true, reviewId: 43, status: 'accepted', applied: ['tasks'] }
          : {
              ok: true,
              proposals: [
                {
                  id: 43,
                  status: 'pending',
                  sourceLabel: 'MCP AI',
                  proposedAt: '2026-11-12T18:20:00Z',
                  diffTotal: 2,
                  diffs: [
                    { path: 'tasks', recordId: 'T009', recordName: 'MEP Rough-In', field: 'status', before: 'inprogress', after: 'completed', surfaces: ['Kanban board'] },
                    { path: 'tasks', recordId: 'T012', recordName: 'Seismic Retrofit', field: 'endDate', before: '2026-12-04', after: '2026-12-18', surfaces: ['Gantt'] }
                  ]
                }
              ]
            };
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: function () {
          return Promise.resolve(JSON.stringify(body));
        },
        json: function () {
          return Promise.resolve(body);
        }
      });
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

  // ---- M10c: Retry re-runs the load ---------------------------------------
  const beforeReload = (await ev('window.__calls.length')) || 0;
  await ev(`document.querySelector('[data-mcp-act="reload"]').click();`);
  await delay(800);
  const afterReload = (await ev('window.__calls.length')) || 0;
  check('M10c Retry re-runs the config load', afterReload > beforeReload, {
    beforeReload,
    afterReload
  });

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

  // ---- M11: the card is the MCP management area, wearing the brand mark ---
  const m11 = await ev(`(function(){
    const card = document.getElementById('mcp-admin-card');
    const title = card.querySelector('.mcp-admin-title');
    const use = card.querySelector('.mcp-admin-mark use');
    const chip = document.getElementById('mcp-admin-chip');
    return {
      section: card.tagName === 'SECTION',
      title: title ? (title.textContent || '').trim() : '',
      icon: use ? use.getAttribute('href') : '',
      sparkle: !!card.querySelector('use[href*="i-sparkle"]'),
      chip: chip ? (chip.textContent || '').trim() : '',
      chipKind: chip ? chip.getAttribute('data-kind') : '',
      tabs: Array.prototype.slice.call(card.querySelectorAll('[data-mcp-tab]')).map(function(t){
        return t.getAttribute('data-mcp-tab');
      })
    };
  })()`);
  check(
    'M11 MCP area is its own card with the brand mark and three tabs',
    m11.section &&
      /MCP server/i.test(m11.title) &&
      /#i-mpw$/.test(m11.icon) &&
      !m11.sparkle &&
      m11.tabs.join('|') === 'pending|connection|clients',
    m11
  );
  check(
    'M11b the chip counts the live client (never a bare "cloud")',
    /On, 1 client/.test(m11.chip) && m11.chipKind === 'ok',
    m11
  );

  // ---- M13: the rail is dropdown groups, with MCP Server under Go ---------
  const m13 = await ev(`(function(){
    const nav = document.getElementById('db-nav');
    const groups = Array.prototype.slice.call(nav.querySelectorAll(':scope > .db-link[data-rail-toggle]'));
    const go = document.getElementById('rail-g-go');
    const mcpRow = document.querySelector('[data-rail-toggle="rail-mcp"]');
    const inGo = !!(go && mcpRow && go.contains(mcpRow));
    const goT = document.querySelector('[data-rail-toggle="rail-g-go"]');
    if (go && go.hidden) goT.click();
    const mcpT = document.querySelector('[data-rail-toggle="rail-mcp"]');
    if (mcpT && document.getElementById('rail-mcp').hidden) mcpT.click();
    const sides = Array.prototype.slice.call(document.querySelectorAll('#rail-mcp [data-mcp-side]')).map(function(b){
      return b.textContent.replace(/[ ]+/g, ' ').trim();
    });
    return {
      groupCount: groups.length,
      groupLabels: groups.map(function(b){ return b.textContent.trim(); }),
      inGo: inGo,
      goOpen: !go.hidden,
      mcpOpen: !document.getElementById('rail-mcp').hidden,
      sides: sides
    };
  })()`);
  check(
    'M13 rail is four dropdown groups and MCP Server sits inside Go',
    m13.groupCount === 4 &&
      m13.groupLabels.join(',') === 'Projects,Export,Go,Customize' &&
      m13.inGo &&
      m13.goOpen &&
      m13.mcpOpen,
    m13
  );
  check(
    'M13b MCP submenu offers pending changes, connection and clients',
    m13.sides.join('|') === 'Pending changes|Connection & link|Connected clients',
    m13
  );

  // ---- M14: a rail destination opens the management area ------------------
  await ev(`(function(){
    document.querySelector('#rail-mcp [data-mcp-side="pending"]').click();
  })()`);
  await delay(1200);
  const m14 = await ev(`(function(){
    const card = document.getElementById('mcp-admin-card');
    const on = card.querySelector('.mcp-admin-tab.is-on');
    const r = card.getBoundingClientRect();
    return {
      tab: on ? on.getAttribute('data-mcp-tab') : '',
      pendingVisible: !document.getElementById('mcp-panel-pending').hidden,
      y: window.scrollY,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      viewport: window.innerHeight
    };
  })()`);
  check(
    'M14 "Pending changes" selects the queue and lands on the area',
    m14.tab === 'pending' && m14.pendingVisible && m14.bottom > 0 && m14.top < m14.viewport,
    m14
  );

  // ---- M12: the tabs switch the three panels ------------------------------
  await ev(`document.querySelector('[data-mcp-tab="connection"]').click();`);
  await delay(300);
  const m12 = await ev(`(function(){
    return {
      connection: !document.getElementById('mcp-panel-connection').hidden,
      pending: document.getElementById('mcp-panel-pending').hidden,
      clients: document.getElementById('mcp-panel-clients').hidden
    };
  })()`);
  check(
    'M12 Connection tab shows the connection panel only',
    m12.connection && m12.pending && m12.clients,
    m12
  );

  // ---- M15: the queue names the record and accepts from here --------------
  await ev(`document.querySelector('[data-mcp-tab="pending"]').click();`);
  await delay(400);
  const m15 = await ev(`(function(){
    const rows = Array.prototype.slice.call(document.querySelectorAll('#mcp-pending .mcp-q-row'));
    return {
      rows: rows.length,
      text: rows.length ? rows[0].textContent.replace(/[ ]+/g, ' ').trim() : '',
      accept: document.querySelectorAll('#mcp-pending [data-mcp-act="accept"]').length,
      reject: document.querySelectorAll('#mcp-pending [data-mcp-act="reject"]').length,
      count: (document.getElementById('mcp-pending-count').textContent || '').trim()
    };
  })()`);
  check(
    'M15 the queue names the record, the field and both values',
    m15.rows === 1 &&
      m15.accept === 1 &&
      m15.reject === 1 &&
      m15.count === '1' &&
      /MEP Rough-In/.test(m15.text) &&
      /Status/.test(m15.text) &&
      /inprogress/.test(m15.text) &&
      /completed/.test(m15.text),
    m15
  );
  await ev(`document.querySelector('#mcp-pending [data-mcp-act="accept"]').click();`);
  await delay(800);
  const m15b = await ev(`(function(){
    const calls = window.__calls || [];
    return {
      accept: calls.filter(function(c){ return /\\/reviews\\/43\\/accept$/.test(c.url) && c.method === 'POST'; }).length,
      status: (document.getElementById('mcp-admin-status').textContent || '').trim()
    };
  })()`);
  check(
    'M15b Accept posts to the project review accept route',
    m15b.accept === 1 && /Accepted/i.test(m15b.status),
    m15b
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
