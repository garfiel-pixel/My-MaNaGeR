/* ============================================================
   MCP BUDGET ACCESS, WITH PERMISSION (H-5)
   ------------------------------------------------------------
   BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05, gate T-MCP-BUDGET.

   Starts the Worker locally (wrangler dev, local D1 + R2, migrations
   applied) and proves the two API-key budget switches end to end:

     B1  a key cannot be granted "propose" without "read"
     B2  a key with the Budget section but neither switch reads no money
     B3  with "read": get_budget carries qty, unit, rate, deliveries,
         remaining quantity, status chip, the frozen baseline and the
         variation count
     B4  get_deliveries rolls up quantity, money and the two variances
     B5  get_weekly_summary matches the Weekly card's own numbers
     B6  a read-only key cannot queue a budget proposal
     B7  with "propose": a delivery proposal queues and changes NO live
         value
     B8  a text amount is refused
     B9  a negative amount is refused
     B10 a wrong unit is refused
     B11 a missing price is refused
     B12 get_proposal_status reports pending with the server's summary
     B13 an AI client cannot approve (review endpoints are owner-only)
     B14 the owner rejects with a reason
     B15 get_proposal_status reports rejected + the owner's reason
     B16 an accepted-with-edit proposal reads edited-and-accepted
     B17 the accepted delivery lands with the SERVER-computed amount
     B18 a task field diff queues with its record name and affected
         screens, and one-press accept actually writes it
     B18f a sets proposal reaches a scalar key and a nested object field
     B18i a set against a record list is refused (use diffs)
     B19 switching the two switches after the key was minted works, and
         the write-without-read pair is refused
     B20 an unknown kind and a delete are refused
     B21 tools/list advertises the budget read tools

   Exit 0 only when every arm passes.
   Usage: node tools/qa-mcp-budget.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.QA_PORT || '8817', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => {
  process.stdout.write('[mb] ' + s + '\n');
};
function annotateFailure(name, detail) {
  let payload;
  try {
    payload = String(JSON.stringify(detail || {}));
  } catch (e) {
    payload = '"(unserializable detail)"';
  }
  process.stdout.write(
    '::error title=QA gate failed: ' +
      name.replace(/[:"\\]/g, ' ') +
      '::' +
      payload.slice(0, 600) +
      '\n'
  );
}
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))
  );
  if (!val) {
    annotateFailure(name, detail);
  }
};

let proc = null;
setTimeout(() => {
  log('WATCHDOG - harness exceeded 360s');
  try {
    proc && proc.kill();
  } catch (e) {
    /* already gone */
  }
  process.exit(2);
}, 360000).unref();

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
  } catch (e) {
    /* fall through */
  }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-mb-wstate-' + Date.now());

// MCP is Premium-gated on the owner's plan (B4, owner 2026-10-11). The
// harness unlocks it the production way - a signature-verified billing
// webhook - never a direct DB write.
const MB_LS_SECRET = 'qa-mcp-budget-ls-71c3e0d4';
function mbSignature(rawBody) {
  return require('crypto').createHmac('sha256', MB_LS_SECRET).update(rawBody).digest('hex');
}
async function mbSeedSubscription(sub) {
  const body = JSON.stringify({
    meta: { event_name: 'subscription_created', custom_data: { sub: sub } },
    data: {
      id: 'ls_sub_mb_' + Math.random().toString(36).slice(2, 8),
      attributes: {
        status: 'active',
        renews_at: new Date(Date.now() + 30 * 86400000).toISOString()
      }
    }
  });
  const res = await fetch(BASE + '/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': mbSignature(body) },
    body: body
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
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
      /* migrations may already be applied */
    }
    proc = spawn(
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
        'LEMONSQUEEZY_WEBHOOK_SECRET:' + MB_LS_SECRET
      ],
      {
        cwd: ROOT,
        stdio: 'ignore',
        env: Object.assign({}, process.env, { ADMIN_CODE: 'QA-MB-ADMIN' })
      }
    );
    proc.on('error', e => reject(new Error('wrangler spawn failed: ' + e.message)));
    const poll = async tries => {
      if (tries <= 0) {
        return reject(new Error('wrangler dev did not come up in 120s'));
      }
      try {
        const r = await fetch(BASE + '/api/health');
        if (r.ok) {
          return resolve();
        }
      } catch (e) {
        /* not up yet */
      }
      await delay(2000);
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

(async function main() {
  let exitCode = 1;
  try {
    await startWrangler();
    const pid = 'mb-qa-' + Date.now().toString(36);

    // ---- setup: session, project, a real budget snapshot -----------------
    let r = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mb-qa@example.com',
        password: 's3cure-pass-1',
        name: 'MCP Budget QA'
      })
    });
    let reg = await j(r);
    let cookie = '';
    const sc = r.headers.get('set-cookie') || '';
    const m = sc.match(/mmgr_session=([^;]+)/);
    if (m) {
      cookie = m[1];
    }
    if (!cookie || !reg.ok) {
      r = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mb-qa@example.com', password: 's3cure-pass-1' })
      });
      reg = await j(r);
      const sc2 = r.headers.get('set-cookie') || '';
      const m2 = sc2.match(/mmgr_session=([^;]+)/);
      if (m2) {
        cookie = m2[1];
      }
    }
    const authHeaders = { 'Content-Type': 'application/json' };
    if (cookie) {
      authHeaders.Cookie = 'mmgr_session=' + cookie;
    }
    check('B0a email session minted', !!cookie && !!reg.ok, { hasCookie: !!cookie });

    r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders,
      body: JSON.stringify({ projectId: pid, name: 'MCP Budget QA' })
    });
    const created = await j(r);
    check('B0b cloud project created', r.ok && created.ok && !!created.ownerCode, created);
    const ownerCode = created.ownerCode;
    const ownerHeaders = Object.assign({ 'X-Owner-Code': ownerCode }, authHeaders);

    const snapshot = {
      projectName: 'MCP Budget QA',
      currency: 'USD',
      updatedAt: new Date().toISOString(),
      // Four tasks, two done: workPct 50, and the weekly forecast for a
      // line with no quantity is spent / earned fraction.
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
          status: 'completed',
          startDate: '2026-10-05',
          endDate: '2026-10-20'
        },
        {
          id: 't3',
          name: 'Walls',
          status: 'in_progress',
          startDate: '2026-10-21',
          endDate: '2026-11-10'
        },
        { id: 't4', name: 'Roof', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-30' }
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
          taskId: 't3',
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
          supplierRef: 'DN-001',
          status: 'received',
          notes: 'First 20 loads'
        }
      ],
      nspid: 2,
      budgetBaselines: [
        {
          id: 'BL1',
          name: 'Baseline 1',
          total: 200000,
          at: '2026-10-01T09:00:00.000Z',
          by: 'Owner'
        }
      ],
      budgetVariations: [
        { id: 'V1', at: '2026-10-05T09:00:00.000Z', by: 'Owner', lineId: 'B1', field: 'planned' }
      ],
      budgetEnvelope: 250000
    };
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ state: snapshot })
    });
    const saved = await j(r);
    check('B0c owner save ok (real budget state)', r.ok && saved.ok, saved);

    const seeded = await mbSeedSubscription('email:mb-qa@example.com');
    check(
      'B0d billing webhook entitles the owner (MCP is a Premium feature)',
      seeded.status === 200 && seeded.body.status === 'active',
      seeded
    );

    // ---- key minting -----------------------------------------------------
    const mint = async (label, body) => {
      const rr = await fetch(BASE + '/api/cloud/projects/' + pid + '/api-keys', {
        method: 'POST',
        credentials: 'same-origin',
        headers: ownerHeaders,
        body: JSON.stringify(Object.assign({ label: label, scope: ['bud'] }, body))
      });
      return { status: rr.status, body: await j(rr) };
    };
    const writeOnly = await mint('Write without read', { budgetWrite: true });
    check(
      'B1a a key cannot be granted "propose" without "read" (400)',
      writeOnly.status === 400 && !writeOnly.body.ok,
      writeOnly.body
    );
    const keyRead = (await mint('Budget reader', { budgetRead: true })).body.apiKey;
    const keyWrite = (await mint('Budget assistant', { budgetRead: true, budgetWrite: true })).body
      .apiKey;
    const keyNone = (await mint('No budget', {})).body.apiKey;
    check(
      'B1b the three keys minted (none / read / read+write)',
      !!keyRead && !!keyWrite && !!keyNone,
      { keyRead: !!keyRead, keyWrite: !!keyWrite, keyNone: !!keyNone }
    );

    // ---- MCP helpers -----------------------------------------------------
    let rpcId = 0;
    const mcp = async (key, name, args) => {
      const res = await fetch(BASE + '/api/mcp/' + pid, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++rpcId,
          method: 'tools/call',
          params: { name: name, arguments: args || {} }
        })
      });
      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = {};
      }
      const content =
        data.result && Array.isArray(data.result.content) && data.result.content[0]
          ? String(data.result.content[0].text || '')
          : text;
      return {
        status: res.status,
        data: data,
        text: content,
        isError: !!(data.result && data.result.isError)
      };
    };
    const jsonOf = out => {
      try {
        return JSON.parse(out.text);
      } catch (e) {
        return null;
      }
    };
    const live = async () => {
      const rr = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
        method: 'POST',
        credentials: 'same-origin',
        headers: ownerHeaders,
        body: JSON.stringify({})
      });
      const d = await j(rr);
      return d.state || {};
    };
    const reviewCount = async () => {
      const rr = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews', {
        method: 'GET',
        credentials: 'same-origin',
        headers: ownerHeaders
      });
      const d = await j(rr);
      const list = d.reviews || d.proposals || [];
      return list.length;
    };

    // ---- B2: no switch, no money ----------------------------------------
    const noneBudget = await mcp(keyNone, 'get_budget');
    check(
      'B2a a key with the Budget section but no switch reads no money',
      noneBudget.status === 200 &&
        noneBudget.isError &&
        /may not read the budget/.test(noneBudget.text) &&
        noneBudget.text.indexOf('120000') === -1,
      noneBudget.text.slice(0, 240)
    );
    const noneDeliv = await mcp(keyNone, 'get_deliveries');
    check(
      'B2b get_deliveries is refused by the same switch',
      noneDeliv.isError && /may not read the budget/.test(noneDeliv.text),
      noneDeliv.text.slice(0, 200)
    );

    // ---- B3: read switch on ---------------------------------------------
    const readBudget = await mcp(keyRead, 'get_budget');
    const rb = jsonOf(readBudget) || {};
    const b1 = (rb.lines || []).find(l => l.id === 'B1') || {};
    check(
      'B3a get_budget carries BOQ quantity, unit and rate',
      b1.qty === 100 && b1.unit === 'load' && b1.rate === 1200 && b1.boqRef === 'Q3-1',
      b1
    );
    check(
      'B3b get_budget carries deliveries, remaining quantity and a chip',
      b1.deliveryCount === 1 &&
        b1.qtyReceived === 20 &&
        b1.qtyLeft === 80 &&
        typeof b1.status === 'string' &&
        b1.status === 'ontrack',
      { count: b1.deliveryCount, got: b1.qtyReceived, left: b1.qtyLeft, chip: b1.status }
    );
    check(
      'B3c get_budget carries the frozen baseline and the variation count',
      rb.baseline &&
        rb.baseline.total === 200000 &&
        rb.baseline.id === 'BL1' &&
        rb.variationCount === 1,
      rb.baseline
    );
    check(
      'B3d the envelope reads as a ceiling, not a second plan',
      rb.envelope === 250000 && rb.envelopeRemaining === 50000,
      { env: rb.envelope, left: rb.envelopeRemaining }
    );

    // ---- B4: deliveries --------------------------------------------------
    const deliv = await mcp(keyRead, 'get_deliveries');
    const dv = jsonOf(deliv) || {};
    const dvLine = (dv.lines || []).find(l => l.lineId === 'B1') || {};
    const dvRow = (dv.deliveries || [])[0] || {};
    check(
      'B4a get_deliveries lists the delivery with its quantity and price',
      dv.deliveryCount === 1 &&
        dvRow.qty === 20 &&
        dvRow.unitPrice === 1200 &&
        dvRow.amount === 24000,
      dvRow
    );
    check(
      'B4b get_deliveries rolls up quantity left and money left',
      dvLine.qtyLeft === 80 && dvLine.moneyLeft === 96000 && dvLine.spent === 24000,
      dvLine
    );

    // ---- B5: weekly summary ---------------------------------------------
    const weekly = await mcp(keyRead, 'get_weekly_summary', { week: '2026-10-21' });
    const wk = jsonOf(weekly) || {};
    check(
      'B5a get_weekly_summary snaps to the Monday of that week',
      wk.week === '2026-10-19' && wk.from === '2026-10-19' && wk.to === '2026-10-25',
      { week: wk.week, from: wk.from, to: wk.to }
    );
    check(
      'B5b spent this week is the delivery inside that week',
      wk.spentWeek === 24000 && wk.spentToDate === 24000,
      { week: wk.spentWeek, toDate: wk.spentToDate }
    );
    check(
      'B5c forecast at completion: B1 = spent + remaining quantity at the latest price',
      ((wk.rows || []).find(x => x.id === 'B1') || {}).fcac === 120000 && wk.forecast === 200000,
      { b1: ((wk.rows || []).find(x => x.id === 'B1') || {}).fcac, total: wk.forecast }
    );
    check(
      'B5d money used vs work done is reported (workPct 50 from four tasks)',
      Math.round(wk.workPct) === 50 && Math.round(wk.moneyPct) === 12,
      { work: wk.workPct, money: wk.moneyPct }
    );

    // ---- B6: read-only cannot propose -----------------------------------
    const before6 = await reviewCount();
    const readPropose = await mcp(keyRead, 'apply_changes', {
      budget: [{ kind: 'addDelivery', lineId: 'B1', qty: 5, unitPrice: 1200 }]
    });
    const after6 = await reviewCount();
    check(
      'B6a a read-only key cannot queue a budget proposal',
      readPropose.isError &&
        /may not propose budget changes/.test(readPropose.text) &&
        after6 === before6,
      { text: readPropose.text.slice(0, 200), before: before6, after: after6 }
    );

    // ---- B7: the write switch, a delivery that changes nothing live -----
    const liveBefore = await live();
    const propose = await mcp(keyWrite, 'apply_changes', {
      budget: [
        {
          kind: 'addDelivery',
          lineId: 'B1',
          qty: 10,
          unitPrice: 1250,
          date: '2026-10-22',
          supplierRef: 'DN-002',
          status: 'received'
        }
      ]
    });
    const liveAfter = await live();
    check(
      'B7a a delivery proposal queues (proposal number returned)',
      !propose.isError && /Queued/.test(propose.text) && /proposal #\d+/.test(propose.text),
      propose.text.slice(0, 240)
    );
    check(
      'B7b the proposal changes NO live value',
      JSON.stringify(liveBefore.spendLog) === JSON.stringify(liveAfter.spendLog) &&
        JSON.stringify(liveBefore.budgetLines) === JSON.stringify(liveAfter.budgetLines),
      { before: (liveBefore.spendLog || []).length, after: (liveAfter.spendLog || []).length }
    );
    const proposalId = (propose.text.match(/proposal #(\d+)/) || [])[1];

    // ---- B8..B11: server-side money validation --------------------------
    const refusedText = async args => {
      const out = await mcp(keyWrite, 'apply_changes', { budget: [args] });
      return out;
    };
    const textAmt = await refusedText({
      kind: 'addDelivery',
      lineId: 'B1',
      qty: '10',
      unitPrice: 1250
    });
    check(
      'B8 a text quantity is refused',
      textAmt.isError && /quantity must be a number/.test(textAmt.text),
      textAmt.text.slice(0, 240)
    );
    const negAmt = await refusedText({
      kind: 'addDelivery',
      lineId: 'B1',
      qty: -5,
      unitPrice: 1250
    });
    check(
      'B9 a negative quantity is refused',
      negAmt.isError && /greater than zero|cannot be negative/.test(negAmt.text),
      negAmt.text.slice(0, 240)
    );
    const wrongUnit = await refusedText({
      kind: 'addDelivery',
      lineId: 'B1',
      qty: 5,
      unitPrice: 1250,
      unit: 'm3'
    });
    check(
      'B10 a unit outside the line family is refused',
      wrongUnit.isError && /does not match this line/.test(wrongUnit.text),
      wrongUnit.text.slice(0, 240)
    );
    const noPrice = await refusedText({ kind: 'addDelivery', lineId: 'B1', qty: 5 });
    check(
      'B11 a delivery without a price is refused',
      noPrice.isError && /unit price is required/.test(noPrice.text),
      noPrice.text.slice(0, 240)
    );

    // ---- B12: status before a decision ----------------------------------
    const st1 = await mcp(keyWrite, 'get_proposal_status', { proposalId: Number(proposalId) });
    const s1 = jsonOf(st1) || {};
    const p1 = (s1.proposals || [])[0] || {};
    check(
      'B12 get_proposal_status reports pending with the server summary',
      p1.status === 'pending' &&
        p1.outcome === 'pending' &&
        /Record 10 load of Gravel at 1,250 per load \(12,500\)/.test(p1.summary || ''),
      p1
    );

    // ---- B13: an AI client cannot approve -------------------------------
    const approveTry = await fetch(
      BASE + '/api/cloud/projects/' + pid + '/reviews/' + proposalId + '/accept',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': keyWrite },
        body: JSON.stringify({})
      }
    );
    const approveBody = await j(approveTry);
    check(
      'B13 an AI client cannot approve (review endpoints are owner-only)',
      approveTry.status === 403 && !approveBody.ok,
      { status: approveTry.status, body: approveBody }
    );

    // ---- B14/B15: owner rejects with a reason ---------------------------
    const reject = await fetch(
      BASE + '/api/cloud/projects/' + pid + '/reviews/' + proposalId + '/reject',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: ownerHeaders,
        body: JSON.stringify({ note: 'Rate is above the agreed price for this load' })
      }
    );
    const rejected = await j(reject);
    check(
      'B14 the owner rejects with a reason',
      reject.ok && rejected.ok && rejected.status === 'rejected',
      rejected
    );
    const st2 = await mcp(keyWrite, 'get_proposal_status', { proposalId: Number(proposalId) });
    const s2 = jsonOf(st2) || {};
    const p2 = (s2.proposals || [])[0] || {};
    check(
      'B15 get_proposal_status reports rejected AND the owner reason',
      p2.status === 'rejected' &&
        p2.outcome === 'rejected' &&
        p2.decisionNote === 'Rate is above the agreed price for this load',
      p2
    );

    // ---- B16/B17: edited-and-accepted, server-computed amount -----------
    const propose2 = await mcp(keyWrite, 'apply_changes', {
      budget: [
        {
          kind: 'addDelivery',
          lineId: 'B2',
          qty: 5,
          unitPrice: 1600,
          date: '2026-10-23',
          status: 'received'
        }
      ]
    });
    const proposalId2 = (propose2.text.match(/proposal #(\d+)/) || [])[1];
    const accept2 = await fetch(
      BASE + '/api/cloud/projects/' + pid + '/reviews/' + proposalId2 + '/accept',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: ownerHeaders,
        body: JSON.stringify({ note: 'Approved after checking the delivery note', edited: true })
      }
    );
    const accepted2 = await j(accept2);
    check(
      'B16 the owner accepts with an edit note',
      accept2.ok && accepted2.ok && accepted2.status === 'accepted',
      accepted2
    );
    const st3 = await mcp(keyWrite, 'get_proposal_status', { proposalId: Number(proposalId2) });
    const s3 = jsonOf(st3) || {};
    const p3 = (s3.proposals || [])[0] || {};
    check(
      'B17 get_proposal_status reports edited-and-accepted with the note',
      p3.outcome === 'edited-and-accepted' &&
        p3.edited === true &&
        p3.decisionNote === 'Approved after checking the delivery note',
      p3
    );
    const live3 = await live();
    const s2row = (live3.spendLog || []).filter(e => e.budgetLineId === 'B2')[0] || {};
    check(
      'B18 the accepted delivery lands with the SERVER-computed amount (5 x 1,600 = 8,000)',
      s2row.amount === 8000 && s2row.qty === 5 && s2row.unitPrice === 1600 && s2row.id,
      s2row
    );

    // ---- B18b..B18e: a FIELD-DIFF proposal applies on one-press accept ----
    // Owner report 2026-11-12: a queued task change rendered as "undefined"
    // and Accept closed the row without moving the project. This proves the
    // stored leaf names its record + surfaces AND that accepting {} writes it.
    const keyTask = (await mint('Task assistant', { scope: ['wbs'] })).body.apiKey;
    const t3Before = ((await live()).tasks || []).find(t => t.id === 't3') || {};
    const diffPropose = await mcp(keyTask, 'apply_changes', {
      diffs: [
        {
          path: 'tasks',
          recordId: 't3',
          field: 'status',
          before: t3Before.status,
          after: 'blocked'
        }
      ]
    });
    const diffId = (diffPropose.text.match(/proposal #(\d+)/) || [])[1];
    check(
      'B18b a task field diff queues (proposal number returned)',
      !diffPropose.isError && !!diffId,
      diffPropose.text.slice(0, 240)
    );

    const reviewsRes = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews', {
      method: 'GET',
      credentials: 'same-origin',
      headers: ownerHeaders
    });
    const reviewsBody = await j(reviewsRes);
    const row = (reviewsBody.proposals || []).find(p => String(p.id) === String(diffId)) || {};
    const leaf = (row.diffs || [])[0] || {};
    check(
      'B18c the review row names the record and the affected screens',
      leaf.recordId === 't3' &&
        leaf.recordName === 'Walls' &&
        Array.isArray(leaf.surfaces) &&
        leaf.surfaces.indexOf('Kanban board') > -1,
      leaf
    );

    const accRes = await fetch(
      BASE + '/api/cloud/projects/' + pid + '/reviews/' + diffId + '/accept',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: ownerHeaders,
        body: JSON.stringify({})
      }
    );
    const accBody = await j(accRes);
    check(
      'B18d one-press accept saves the project',
      accRes.ok && accBody.ok && !!accBody.savedAt,
      accBody
    );

    const t3After = ((await live()).tasks || []).find(t => t.id === 't3') || {};
    check(
      'B18e the task status changed and its other fields survived',
      t3After.status === 'blocked' &&
        t3After.name === t3Before.name &&
        t3After.startDate === t3Before.startDate &&
        t3After.endDate === t3Before.endDate,
      { before: t3Before, after: t3After }
    );

    // ---- B18f..B18i: SETS reach object sections and scalar keys -----------
    // diffs/creates only touch record lists. projectName (scalar) and
    // dmaic.define.problem (nested object) need the scoped sets write.
    const keySets = (await mint('Charter assistant', { scope: ['charter', 'dmaic'] })).body.apiKey;
    const setsPropose = await mcp(keySets, 'apply_changes', {
      sets: [
        { path: 'projectName', value: 'MCP Budget QA (rebaselined)' },
        { path: 'dmaic', field: 'define.problem', value: 'Concrete strength below spec' }
      ]
    });
    const setsId = (setsPropose.text.match(/proposal #(\d+)/) || [])[1];
    check(
      'B18f a sets proposal queues both a scalar and a nested object field',
      !setsPropose.isError && !!setsId,
      setsPropose.text.slice(0, 240)
    );
    const setsAccept = await fetch(
      BASE + '/api/cloud/projects/' + pid + '/reviews/' + setsId + '/accept',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: ownerHeaders,
        body: JSON.stringify({})
      }
    );
    const setsBody = await j(setsAccept);
    const liveSets = await live();
    check(
      'B18g the accepted scalar set lands',
      setsAccept.ok && setsBody.ok && liveSets.projectName === 'MCP Budget QA (rebaselined)',
      { status: setsAccept.status, name: liveSets.projectName, body: setsBody }
    );
    check(
      'B18h the accepted nested object set lands',
      !!liveSets.dmaic &&
        liveSets.dmaic.define &&
        liveSets.dmaic.define.problem === 'Concrete strength below spec',
      liveSets.dmaic
    );
    const listTry = await mcp(keyTask, 'apply_changes', {
      sets: [{ path: 'tasks', field: 'status', value: 'todo' }]
    });
    check(
      'B18i a set against a record list is refused (use diffs)',
      listTry.isError && /record list/.test(listTry.text),
      listTry.text.slice(0, 240)
    );

    // ---- B19: switches after minting ------------------------------------
    const patchBad = await fetch(
      BASE +
        '/api/cloud/projects/' +
        pid +
        '/api-keys/' +
        (await (async () => {
          const rr = await fetch(BASE + '/api/cloud/projects/' + pid + '/api-keys', {
            method: 'GET',
            credentials: 'same-origin',
            headers: ownerHeaders
          });
          const d = await j(rr);
          const row = (d.keys || []).find(k => k.label === 'No budget');
          return row ? row.id : 0;
        })()),
      {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: ownerHeaders,
        body: JSON.stringify({ budgetWrite: true })
      }
    );
    check('B19a PATCH cannot turn propose on while read is off (400)', patchBad.status === 400, {
      status: patchBad.status,
      body: await j(patchBad)
    });
    const keyNoneRow = await (async () => {
      const rr = await fetch(BASE + '/api/cloud/projects/' + pid + '/api-keys', {
        method: 'GET',
        credentials: 'same-origin',
        headers: ownerHeaders
      });
      const d = await j(rr);
      return (d.keys || []).find(k => k.label === 'No budget') || {};
    })();
    const patchOk = await fetch(
      BASE + '/api/cloud/projects/' + pid + '/api-keys/' + keyNoneRow.id,
      {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: ownerHeaders,
        body: JSON.stringify({ budgetRead: true })
      }
    );
    const patched = await j(patchOk);
    check(
      'B19b PATCH turns "Read budget" on after the key was minted',
      patchOk.ok && patched.ok && patched.budgetRead === true && patched.budgetWrite === false,
      patched
    );
    const afterPatchRead = await mcp(keyNone, 'get_budget');
    check(
      'B19c the same key now reads the budget (the switch is live, not cached)',
      !afterPatchRead.isError && (jsonOf(afterPatchRead) || {}).lineCount === 2,
      afterPatchRead.text.slice(0, 200)
    );

    // ---- B20: no delete, unknown kinds refused --------------------------
    const delTry = await mcp(keyWrite, 'apply_changes', {
      budget: [{ kind: 'deleteLine', lineId: 'B1' }]
    });
    check(
      'B20a deleting a budget line through MCP is refused',
      delTry.isError && /not available through MCP/.test(delTry.text),
      delTry.text.slice(0, 200)
    );
    const unknownTry = await mcp(keyWrite, 'apply_changes', {
      budget: [{ kind: 'renameEverything' }]
    });
    check(
      'B20b an unknown proposal kind is refused with the allowed list',
      unknownTry.isError && /unknown kind/.test(unknownTry.text),
      unknownTry.text.slice(0, 200)
    );

    // ---- B21: tools/list advertises the new tools -----------------------
    const listRes = await fetch(BASE + '/api/mcp/' + pid, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + keyRead,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/list' })
    });
    const listBody = await j(listRes);
    const names = ((listBody.result && listBody.result.tools) || []).map(t => t.name);
    check(
      'B21 tools/list advertises get_deliveries, get_weekly_summary and get_proposal_status',
      names.indexOf('get_deliveries') > -1 &&
        names.indexOf('get_weekly_summary') > -1 &&
        names.indexOf('get_proposal_status') > -1,
      names
    );

    // ---- summary --------------------------------------------------------
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
      proc && proc.kill();
    } catch (e) {
      /* already gone */
    }
    await delay(300);
    process.exit(exitCode);
  }
})();
