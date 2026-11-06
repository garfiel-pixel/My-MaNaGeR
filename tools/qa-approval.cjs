/* ============================================================
   APPROVAL PREVIEW (H-6)
   ------------------------------------------------------------
   BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05, gate T-APPROVE.

   Phase A (API): a project with two budget lines and one delivery;
   an API key with read + propose; an MCP proposal that raises B1 by
   100,000 (large, Q5). The proposal queues and the live state does
   not move.

   Phase B (real Chrome on the local Worker):
     V1  View opens the full-width preview (real Budget + Weekly panels)
     V2  the changed row is marked and the impact line reads 120,000 to 220,000
     V3  the large-change warning is visible
     V4  editing 220,000 to 130,000 updates the impact line at once
     V5  Approve writes 130,000 (not the proposed 220,000)
     V6  the changelog carries the approved value, the proposal keeps the proposed one
     V7  Revert restores 120,000 and logs itself
     V8  a two-change proposal approves only the ticked change
     V9  a proposal made stale by a live save is blocked with both values
     V10 Reject needs a reason; get_proposal_status returns it

   Exit 0 only when every arm passes.
   Usage: node tools/qa-approval.cjs            (browser on)
          MMGR_QA_NO_BROWSER=1 node tools/qa-approval.cjs   (API only)
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.QA_PORT || '8818', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-apv-wstate-' + Date.now());
process.env.CHROME_DEBUG_PORT = process.env.CHROME_DEBUG_PORT || '9338';
const { chromePath: CHROME, DEBUG_PORT } = require('./chrome-launcher.cjs');

const PID = 'apv-' + Math.random().toString(36).slice(2, 8);
const LS_SECRET = 'qa-approval-ls-2f81c6';
const EMAIL = 'apv-qa@example.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Pace Cloud API calls so the harness stays under the 30/60s general rate
// limit (it otherwise bursts past it and the accept/reject calls come back
// 429). Enforces a minimum gap between rate-limited requests.
let _lastCall = 0;
const PACE_GAP = 2100;
async function pace() {
  const now = Date.now();
  const wait = PACE_GAP - (now - _lastCall);
  if (wait > 0) {
    await sleep(wait);
  }
  _lastCall = Date.now();
}

const results = [];
const log = s => process.stdout.write('[apv] ' + s + '\n');
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 420))
  );
  if (!val) {
    process.stdout.write(
      '::error title=QA gate failed: ' +
        name.replace(/[:"\\]/g, ' ') +
        '::' +
        JSON.stringify(detail || {}).slice(0, 500) +
        '\n'
    );
  }
};

let wrangler = null;
let chrome = null;
let userDir = null;
setTimeout(() => {
  log('WATCHDOG - harness exceeded 420s');
  try {
    chrome && chrome.kill();
  } catch (e) {}
  try {
    wrangler && wrangler.kill();
  } catch (e) {}
  process.exit(2);
}, 420000).unref();

function globalWranglerJs() {
  const localP = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (fs.existsSync(localP)) {
    return localP;
  }
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) {
      return p;
    }
  } catch (e) {}
  return null;
}
const WRANGLER_JS = globalWranglerJs();

function signature(raw) {
  return require('crypto').createHmac('sha256', LS_SECRET).update(raw).digest('hex');
}

function startWrangler() {
  return new Promise((resolve, reject) => {
    try {
      execFileSync(
        process.execPath,
        [
          WRANGLER_JS,
          'd1',
          'migrations',
          'apply',
          'my-manager-db',
          '--local',
          '--config',
          'wrangler.ci.jsonc',
          '--persist-to',
          PERSIST_DIR
        ],
        { cwd: ROOT, stdio: 'ignore', timeout: 120000 }
      );
    } catch (e) {
      /* already applied */
    }
    wrangler = spawn(
      process.execPath,
      [
        WRANGLER_JS,
        'dev',
        '--config',
        'wrangler.ci.jsonc',
        '--port',
        String(PORT),
        '--ip',
        '127.0.0.1',
        '--persist-to',
        PERSIST_DIR,
        '--var',
        'LEMONSQUEEZY_WEBHOOK_SECRET:' + LS_SECRET,
        '--var',
        'RATE_LIMIT_FACTOR:10'
      ],
      {
        cwd: ROOT,
        stdio: 'ignore',
        env: Object.assign({}, process.env, { ADMIN_CODE: 'QA-APV-ADMIN' })
      }
    );
    wrangler.on('error', e => reject(new Error('wrangler spawn failed: ' + e.message)));
    const poll = async tries => {
      if (tries <= 0) {
        return reject(new Error('wrangler dev did not come up in 120s'));
      }
      try {
        const r = await fetch(BASE + '/api/health');
        if (r.ok) {
          return resolve();
        }
      } catch (e) {}
      await sleep(2000);
      return poll(tries - 1);
    };
    poll(60);
  });
}

const j = async res => {
  try {
    return await res.json();
  } catch (e) {
    return {};
  }
};

const snapshot = () => ({
  projectName: 'Approval QA',
  currency: 'USD',
  schemaVersion: 25,
  projectId: PID,
  updatedAt: new Date().toISOString(),
  tasks: [
    {
      id: 't1',
      name: 'Clear site',
      status: 'completed',
      startDate: '2026-10-01',
      endDate: '2026-10-10'
    },
    {
      id: 't2',
      name: 'Footings',
      status: 'in_progress',
      startDate: '2026-10-05',
      endDate: '2026-10-20'
    }
  ],
  budgetLines: [
    {
      id: 'B1',
      category: 'Gravel',
      planned: 120000,
      actual: 0,
      qty: 100,
      unit: 'load',
      rate: 1200,
      source: 'boq',
      boqRef: 'Q3-1',
      taskId: 't2',
      curve: 'linear'
    },
    {
      id: 'B2',
      category: 'Concrete',
      planned: 80000,
      actual: 0,
      qty: 50,
      unit: 'm3',
      rate: 1600,
      source: 'boq',
      boqRef: 'Q3-2',
      taskId: 't2',
      curve: 'linear'
    }
  ],
  spendLog: [
    {
      id: 'S1',
      date: '2026-10-20',
      budgetLineId: 'B1',
      amount: 24000,
      qty: 20,
      unitPrice: 1200,
      unit: 'load',
      status: 'received'
    }
  ],
  nspid: 2,
  budgetEnvelope: 250000
});

(async function main() {
  let exitCode = 1;
  try {
    await startWrangler();

    // ---- session + project ------------------------------------------------
    let r = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: 's3cure-pass-1', name: 'Approval QA' })
    });
    let reg = await j(r);
    let cookie = '';
    let m = (r.headers.get('set-cookie') || '').match(/mmgr_session=([^;]+)/);
    if (m) {
      cookie = m[1];
    }
    if (!cookie || !reg.ok) {
      r = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: 's3cure-pass-1' })
      });
      reg = await j(r);
      m = (r.headers.get('set-cookie') || '').match(/mmgr_session=([^;]+)/);
      if (m) {
        cookie = m[1];
      }
    }
    const authH = { 'Content-Type': 'application/json', Cookie: 'mmgr_session=' + cookie };
    check('A1 email session minted', !!cookie && !!reg.ok, { hasCookie: !!cookie });

    r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authH,
      body: JSON.stringify({ projectId: PID, name: 'Approval QA' })
    });
    const created = await j(r);
    const OC = created.ownerCode;
    const ownerH = Object.assign({ 'X-Owner-Code': OC }, authH);
    check('A2 cloud project created', r.ok && created.ok && !!OC, created);

    const base = snapshot();
    r = await fetch(BASE + '/api/cloud/projects/' + PID + '/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerH,
      body: JSON.stringify({ state: base })
    });
    check('A3 owner save ok', r.ok && (await j(r)).ok, null);

    const sub = JSON.stringify({
      meta: { event_name: 'subscription_created', custom_data: { sub: 'email:' + EMAIL } },
      data: {
        id: 'ls_sub_apv_' + Math.random().toString(36).slice(2, 8),
        attributes: {
          status: 'active',
          renews_at: new Date(Date.now() + 30 * 86400000).toISOString()
        }
      }
    });
    r = await fetch(BASE + '/api/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signature(sub) },
      body: sub
    });
    check('A4 owner entitled (MCP premium gate)', r.ok, null);

    const km = await j(
      await fetch(BASE + '/api/cloud/projects/' + PID + '/api-keys', {
        method: 'POST',
        credentials: 'same-origin',
        headers: ownerH,
        body: JSON.stringify({
          label: 'Approval assistant',
          scope: ['bud'],
          budgetRead: true,
          budgetWrite: true
        })
      })
    );
    const KEY = km.apiKey;
    check('A5 API key with read + propose minted', !!KEY, km);

    let rpc = 0;
    const mcp = async (name, args) => {
      await pace();
      const res = await fetch(BASE + '/api/mcp/' + PID, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++rpc,
          method: 'tools/call',
          params: { name: name, arguments: args || {} }
        })
      });
      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (e) {}
      return {
        data: data,
        text:
          data.result && data.result.content && data.result.content[0]
            ? String(data.result.content[0].text)
            : text,
        isError: !!(data.result && data.result.isError)
      };
    };
    const live = async () => {
      await pace();
      const rr = await fetch(BASE + '/api/cloud/projects/' + PID + '/load', {
        method: 'POST',
        credentials: 'same-origin',
        headers: ownerH,
        body: JSON.stringify({})
      });
      return (await j(rr)).state || {};
    };

    const propose = async budget => {
      const out = await mcp('apply_changes', { budget: budget });
      return {
        text: out.text,
        id: Number((out.text.match(/proposal #(\d+)/) || [])[1] || 0),
        isError: out.isError
      };
    };

    // ---- A6: a large single change queues, live untouched -----------------
    const p1 = await propose([
      { kind: 'changeLine', lineId: 'B1', field: 'planned', value: 220000 }
    ]);
    const liveA = await live();
    const b1A = (liveA.budgetLines || []).find(l => l.id === 'B1') || {};
    check('A6a a +100,000 proposal queues', !p1.isError && p1.id > 0, p1.text.slice(0, 200));
    check('A6b live planned is untouched (120,000)', b1A.planned === 120000, b1A);

    const p2 = await propose([
      { kind: 'changeLine', lineId: 'B1', field: 'planned', value: 125000 },
      { kind: 'changeLine', lineId: 'B2', field: 'planned', value: 85000 }
    ]);
    check('A7 a two-change proposal queues', !p2.isError && p2.id > 0, p2.text.slice(0, 200));

    const p3 = await propose([
      { kind: 'changeLine', lineId: 'B1', field: 'planned', value: 140000 }
    ]);
    check(
      'A8 a third proposal queues (stale probe)',
      !p3.isError && p3.id > 0,
      p3.text.slice(0, 200)
    );

    const p4 = await propose([
      {
        kind: 'addDelivery',
        lineId: 'B2',
        qty: 5,
        unitPrice: 1600,
        date: '2026-10-23',
        status: 'received'
      }
    ]);
    check(
      'A9 a delivery proposal queues (reject probe)',
      !p4.isError && p4.id > 0,
      p4.text.slice(0, 200)
    );

    // ---------- PHASE B: the real preview in Chrome ----------
    if (process.env.MMGR_QA_NO_BROWSER === '1') {
      log('MMGR_QA_NO_BROWSER=1 - skipping the preview phase');
    } else {
      userDir = path.join(os.tmpdir(), 'chrome-apv-' + Date.now());
      chrome = spawn(
        CHROME,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-sandbox',
          '--disk-cache-size=0',
          '--remote-allow-origins=*',
          '--remote-debugging-port=' + DEBUG_PORT,
          '--user-data-dir=' + userDir,
          '--window-size=1400,1000',
          'about:blank'
        ],
        { stdio: 'ignore' }
      );
      let ws = null;
      let send = null;
      let ev = null;
      const pageLogs = [];
      let mid = 0;
      try {
        for (let i = 0; i < 60; i++) {
          try {
            const v = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version');
            if (v.ok) {
              break;
            }
          } catch (e) {}
          await sleep(300);
        }
        const targets = await (await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json')).json();
        ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
        const pending = new Map();
        ws.onmessage = e => {
          const msg = JSON.parse(e.data);
          if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
          if (msg.method === 'Runtime.consoleAPICalled') {
            pageLogs.push(
              (msg.params.args || [])
                .map(a => (a.value !== undefined ? String(a.value) : a.description || ''))
                .join(' ')
            );
            if (pageLogs.length > 40) {
              pageLogs.shift();
            }
          }
        };
        await new Promise((res, rej) => {
          ws.onopen = res;
          ws.onerror = () => rej(new Error('ws fail'));
        });
        send = (method, params = {}) =>
          new Promise(res => {
            const i = ++mid;
            pending.set(i, res);
            ws.send(JSON.stringify({ id: i, method, params }));
          });
        ev = async expr => {
          const out = await send('Runtime.evaluate', {
            expression: expr,
            returnByValue: true,
            awaitPromise: true
          });
          return out.result && out.result.result ? out.result.result.value : undefined;
        };
        await send('Runtime.enable');
        await send('Page.enable');

        await send('Page.navigate', { url: BASE + '/project.html?id=' + PID });
        await sleep(2000);
        await ev(`(function(){
          localStorage.setItem('mmgr_admin_projects', JSON.stringify([{ id: '${PID}', title: 'Approval QA', description: '', status: 'active', file: 'project.html?id=${PID}' }]));
          localStorage.setItem('mmgr_unlocked_${PID}', '1');
          localStorage.setItem('mmgr_state_${PID}', JSON.stringify(${JSON.stringify(base)}));
        })()`);
        await send('Page.navigate', { url: BASE + '/project.html?id=' + PID });
        let ready = null;
        for (let i = 0; i < 80; i++) {
          ready = await ev(
            `(function(){ try { return { app: !!(window.MMGR && window.MMGR.Approval), state: !!window.MMGR.State }; } catch (e) { return { err: String(e) }; } })()`
          );
          if (ready && ready.app) {
            break;
          }
          await sleep(600);
        }
        check(
          'V0 project page loads with the approval module (CSP intact)',
          !!(ready && ready.app),
          {
            ready,
            logs: pageLogs.slice(-6)
          }
        );

        const b2 = await ev(`(async function(){
          try {
            sessionStorage.setItem('mmgr_cloud_code_${PID}', ${JSON.stringify(OC)});
            await window.MMGR.Cloud.render();
            return { has: !!document.getElementById('cloud-review-list') };
          } catch (e) { return { threw: String(e && e.message || e) }; }
        })()`);
        check('V0b cloud section renders with the owner code held', !!(b2 && b2.has), b2);

        // V1-V3: open the +100,000 proposal.
        const v1 = await ev(`(async function(){
          try {
            await window.MMGR.Approval.open(${p1.id});
            await new Promise(r => setTimeout(r, 600));
            const ov = document.getElementById('apv-ov');
            const imp = document.getElementById('apv-impact');
            const prev = document.getElementById('apv-prev');
            return {
              open: !!ov,
              wide: !!ov && ov.querySelector('.apv-win').getBoundingClientRect().width > 900,
              cards: ov ? ov.querySelectorAll('.apv-chg').length : 0,
              large: ov ? ov.querySelectorAll('.apv-chg.is-large').length : 0,
              warn: (ov && ov.querySelector('.apv-warn') ? ov.querySelector('.apv-warn').textContent : '').trim(),
              impact: imp ? imp.textContent : '',
              cardText: ov ? (ov.querySelector('.apv-chg') ? ov.querySelector('.apv-chg').textContent : '') : '',
              marked: prev ? prev.querySelectorAll('tr[data-apv-chg]').length : 0,
              hasTable: !!(prev && prev.querySelector('tbody tr'))
            };
          } catch (e) { return { threw: String(e && e.message || e) }; }
        })()`);
        check(
          'V1 View opens a full-width preview with the real panels',
          v1 && v1.open && v1.wide && v1.cards === 1 && v1.hasTable,
          v1
        );
        check(
          'V2 the changed row is marked and the card shows 120,000 to 220,000',
          v1 && v1.marked >= 1 && /120,000/.test(v1.cardText) && /220,000/.test(v1.cardText),
          v1
        );
        check(
          'V3 the large-change warning is visible',
          v1 && v1.large === 1 && /Large change/.test(v1.warn),
          v1
        );

        // V4: edit 220,000 -> 130,000; the impact line follows at once.
        const v4 = await ev(`(function(){
          try {
            window.MMGR.Approval.editValue(0, '', '130000');
            const card = document.querySelector('#apv-ov .apv-chg');
            const imp = document.getElementById('apv-impact');
            const inp = document.querySelector('#apv-ov [data-apv="edit"]');
            return {
              impact: imp ? imp.textContent : '',
              cardText: card ? card.textContent : '',
              value: inp ? inp.value : ''
            };
          } catch (e) { return { threw: String(e && e.message || e) }; }
        })()`);
        check(
          'V4 editing the value updates the card and impact at once',
          v4 &&
            /130,000/.test(v4.cardText) &&
            !/220,000/.test(v4.cardText) &&
            v4.value === '130000',
          v4
        );

        // V5: approve.
        await sleep(2100);
        const v5 = await ev(`(async function(){
          try {
            await window.MMGR.Approval.approve();
            await new Promise(r => setTimeout(r, 2500));
            return { open: !!document.getElementById('apv-ov') };
          } catch (e) { return { threw: String(e && e.message || e) }; }
        })()`);
        const liveB = await live();
        const b1B = (liveB.budgetLines || []).find(l => l.id === 'B1') || {};
        check(
          'V5 Approve writes the EDITED 130,000 (not the proposed 220,000)',
          v5 && v5.open === false && b1B.planned === 130000,
          { closed: v5 && !v5.open, planned: b1B.planned }
        );

        // V6: the changelog carries the approved value; the proposal keeps
        // the proposed one.
        await pace();
        const chl = await j(
          await fetch(BASE + '/api/cloud/projects/' + PID + '/changelog', {
            credentials: 'same-origin',
            headers: ownerH
          })
        );
        const entries = chl.entries || chl.changelog || [];
        const last = entries[0] || {};
        const lastDiffs = JSON.stringify(last.diffs || last.diffsJson || []);
        await pace();
        const revs = await j(
          await fetch(BASE + '/api/cloud/projects/' + PID + '/reviews', {
            credentials: 'same-origin',
            headers: ownerH
          })
        );
        const prop = (revs.proposals || []).find(x => String(x.id) === String(p1.id)) || {};
        const proposedVal =
          prop.proposal && prop.proposal.changes && prop.proposal.changes[0]
            ? prop.proposal.changes[0].after
            : null;
        check(
          'V6 changelog records the approved value; the proposal keeps the proposed one',
          /130000/.test(lastDiffs) && proposedVal === 220000 && prop.status === 'accepted',
          { diffs: lastDiffs.slice(0, 200), proposedVal, status: prop.status }
        );

        // V7: revert the accepted entry restores 120,000.
        const entryId = last.id;
        let revertOk = false;
        let afterRevert = null;
        if (entryId) {
          await pace();
          const rv = await fetch(
            BASE + '/api/cloud/projects/' + PID + '/changelog/' + entryId + '/revert',
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: ownerH,
              body: JSON.stringify({})
            }
          );
          revertOk = rv.ok;
          afterRevert = await live();
        }
        const b1C = (afterRevert && (afterRevert.budgetLines || []).find(l => l.id === 'B1')) || {};
        check('V7 Revert restores the original 120,000', revertOk && b1C.planned === 120000, {
          revertOk,
          planned: b1C.planned
        });

        // V8: partial approval - untick the second change.
        await sleep(2100);
        const v8 = await ev(`(async function(){
          try {
            await window.MMGR.Approval.open(${p2.id});
            await new Promise(r => setTimeout(r, 500));
            window.MMGR.Approval.toggleTick(1, false);
            await new Promise(r => setTimeout(r, 300));
            await window.MMGR.Approval.approve();
            await new Promise(r => setTimeout(r, 2500));
            return { ok: true };
          } catch (e) { return { threw: String(e && e.message || e) }; }
        })()`);
        const liveD = await live();
        const b1D = (liveD.budgetLines || []).find(l => l.id === 'B1') || {};
        const b2D = (liveD.budgetLines || []).find(l => l.id === 'B2') || {};
        check(
          'V8 partial approval applies only the ticked change',
          v8 && v8.ok && b1D.planned === 125000 && b2D.planned === 80000,
          { b1: b1D.planned, b2: b2D.planned }
        );

        // V9: stale - change B1 behind the proposal's back, then approve.
        const staleState = JSON.parse(JSON.stringify(await live()));
        staleState.budgetLines.find(l => l.id === 'B1').planned = 121000;
        await pace();
        const sv = await fetch(BASE + '/api/cloud/projects/' + PID + '/save', {
          method: 'POST',
          credentials: 'same-origin',
          headers: ownerH,
          body: JSON.stringify({ state: staleState })
        });
        await sleep(2100);
        const v9 = await ev(`(async function(){
          try {
            // Sync the local view to the live edit (B1=121000) so the
            // background autosave does not clobber the cloud change with the
            // stale local value it still holds from an earlier accept. This
            // mirrors a real owner whose local project has synced.
            window.MMGR.State.updateState(function(s){
              const l = (s.budgetLines || []).find(x => x.id === 'B1');
              if (l) { l.planned = 121000; }
            });
            // Force the cloud push now so the server sees 121000 at approve time
            // (the idle autosave alone is not deterministic for the test).
            if (window.MMGR.Cloud && window.MMGR.Cloud.saveToCloud) {
              await window.MMGR.Cloud.saveToCloud();
            }
            await new Promise(r => setTimeout(r, 800));
            await window.MMGR.Approval.open(${p3.id});
            await new Promise(r => setTimeout(r, 500));
            await window.MMGR.Approval.approve();
            await new Promise(r => setTimeout(r, 1800));
            const st = document.querySelector('#apv-ov .apv-stale');
            return { banner: !!st, text: st ? st.textContent : '', stillOpen: !!document.getElementById('apv-ov') };
          } catch (e) { return { threw: String(e && e.message || e) }; }
        })()`);
        const liveE = await live();
        const b1E = (liveE.budgetLines || []).find(l => l.id === 'B1') || {};
        check(
          'V9 a stale proposal is blocked and shows both values',
          v9 && v9.banner && /121,000|121000/.test(v9.text) && b1E.planned === 121000,
          {
            banner: v9 && v9.banner,
            text: v9 && v9.text,
            b1E: b1E.planned,
            liveEKeys: Object.keys(liveE).slice(0, 12),
            blen: (liveE.budgetLines || []).length,
            stillOpen: v9 && v9.stillOpen
          }
        );

        // V10: reject with a reason; the reason comes back to the client.
        await sleep(2100);
        const v10 = await ev(`(async function(){
          try {
            await window.MMGR.Approval.close();
            await window.MMGR.Approval.open(${p4.id});
            await new Promise(r => setTimeout(r, 500));
            const note = document.getElementById('apv-note');
            if (note) { note.value = 'Price is above the agreed rate'; note.dispatchEvent(new Event('input', { bubbles: true })); }
            await window.MMGR.Approval.reject();
            await new Promise(r => setTimeout(r, 1800));
            return { closed: !document.getElementById('apv-ov') };
          } catch (e) { return { threw: String(e && e.message || e) }; }
        })()`);
        await pace();
        const status = await mcp('get_proposal_status', { proposalId: p4.id });
        let statusJson = null;
        try {
          statusJson = JSON.parse(status.text);
        } catch (e) {}
        const one = statusJson && statusJson.proposals && statusJson.proposals[0];
        check(
          'V10 Reject needs a reason and the reason reaches get_proposal_status',
          v10 &&
            v10.closed &&
            one &&
            one.status === 'rejected' &&
            one.decisionNote === 'Price is above the agreed rate',
          one
        );

        // V11: no console error from the preview.
        check(
          'V11 the preview produced no console error',
          !pageLogs.some(l => /Uncaught|TypeError|ReferenceError/.test(l)),
          pageLogs.slice()
        );
      } finally {
        try {
          ws && ws.close();
        } catch (e) {}
        try {
          chrome && chrome.kill();
        } catch (e) {}
      }
    }

    const passed = results.filter(x => x.val).length;
    const failed = results.length - passed;
    log('---------------------------------------------');
    log('RESULT ' + passed + ' passed, ' + failed + ' failed of ' + results.length);
    exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    log('FATAL ' + ((e && e.stack) || e));
    exitCode = 2;
  } finally {
    try {
      chrome && chrome.kill();
    } catch (e) {}
    try {
      wrangler && wrangler.kill();
    } catch (e) {}
    await sleep(300);
    process.exit(exitCode);
  }
})();
