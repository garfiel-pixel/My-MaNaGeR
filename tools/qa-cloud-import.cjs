/* ============================================================
   CLOUD-MCP-IMPORT — END-TO-END GATE (mcp changelog → D1)
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 miniflare emulation — migrations incl. 0005 applied) and
   verifies the changelog-import pipeline end to end:

   Q1  auth: import is owner-only — no code / wrong code / unknown
       project all return the SAME generic 403 (no existence leak)
   Q2  happy path: a charter.name diff that matches the saved blob
       is imported with a FRESH D1 id; the stored row carries
       entry_type 'edit', actor_label 'mcp-ai', section 'charter',
       and import_key 'mcp:<pid>:<localId>'
   Q3  HONESTY GATE: a diff whose after-value does not match the
       blob is skipped with a reason and NEVER stored
   Q4  no snapshot: a project with no blob yet rejects every entry
       ('no cloud snapshot to verify against')
   Q5  idempotency: re-importing the same localId is a no-op
       ('already imported') and row count does not change
   Q6  recordId resolution: MCP-style add / delete / field diffs
       import cleanly, and the existing owner revert route undoes
       each one correctly (delete restore re-inserts, add removes,
       field write restores) — regression that cloud-native reverts
       still work through the same route
   Q7  bulk normalization: an MCP 'bulk' entry carrying diffs is
       stored as 'edit' (no R2 snapshot exists on the MCP side)
   Q8  entry validation: bad localId / entry_type / created_at are
       skipped with reasons, never stored
   Q9  revert-of-revert: reverting the revert row restores again
   Q10 CLI end-to-end: tools/import-mcp-changelog.cjs dry-run,
       live push, ledger write, and a repeat run reports nothing
       left to import

   Exit 0 only when all checks pass. Reports PASS/FAIL per check.
   Usage: node tools/qa-cloud-import.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8793;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');

const log = (s) => { process.stdout.write('[qci] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))); };

let proc = null;
let devLog = '';
setTimeout(() => { log('WATCHDOG — harness exceeded 360s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 360000).unref();

// ---- wrangler location + local dev (same scaffolding as phase 2) ----------
function globalWranglerJs() {
  const localP = path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
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
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-cloud-wstate-import-' + Date.now());

function startWrangler() {
  return new Promise((resolve, reject) => {
    log('starting wrangler dev on :' + PORT + ' (local D1 + R2, migrations incl. 0005)…');
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 90000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.stdout.on('data', d => { devLog += d; });
    proc.stderr.on('data', d => { devLog += d; });
    proc.on('error', (e) => reject(new Error('wrangler spawn failed: ' + e.message)));
    const t0 = Date.now();
    const poll = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(function() { ctrl.abort(); }, 3000);
        const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) return resolve();
      } catch (e) { /* not up yet */ }
      if (Date.now() - t0 > 120000) return reject(new Error('wrangler dev did not come up in 120s'));
      setTimeout(poll, 1500);
    };
    poll();
  });
}
function stopWrangler() {
  try { proc && proc.kill(); } catch (e) {}
}

// ---- D1 direct inspection --------------------------------------------------
function d1File() {
  const dir = path.join(PERSIST_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.sqlite') && !f.startsWith('metadata')) return path.join(dir, f);
  }
  return null;
}
function queryD1(sql) {
  const f = d1File();
  if (f && typeof require('node:sqlite') === 'object') {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(f, { readOnly: true });
      const rows = [];
      for (const row of db.prepare(sql).all()) rows.push(row);
      db.close();
      return rows;
    } catch (e) { log('node:sqlite read failed (' + e.message + ')'); }
  }
  return null;
}

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({}, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, text: res.status + '|' + JSON.stringify(body) };
}

// ---- state builders -------------------------------------------------------
function baseState(pid, name) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 17, projectId: pid, projectName: name, updatedAt: now,
    charter: { name: name, sponsor: 'Sponsor' },
    tasks: [
      { id: 't1', name: 'Task One', status: 'done', start: '2026-01-01', end: '2026-01-05' },
      { id: 't9', name: 'AI Added', status: 'planned', start: '2026-02-01', end: '2026-02-05' }
    ],
    risks: [],
    closure: { status: 'open', handoverNotes: 'Initial handover' },
    raci: { tasks: [], persons: [], matrix: {} },
    resources: [], budgetLines: [], budgetEnvelope: 0, spendLog: [], stakeholders: [],
    fieldTs: { charter: now, tasks: now, risks: now, closure: now },
    config: {}, flags: {}, errorLog: []
  };
}

// Helper: build the import payload entries (MCP sidecar shape).
function mcpEntry(localId, type, actorType, actorLabel, diffs, createdAt) {
  return { localId: localId, entry_type: type, actor_type: actorType, actor_label: actorLabel, diffs_json: diffs, created_at: createdAt };
}
const ISO = new Date().toISOString();

(async () => {
  if (!WRANGLER_JS) { log('FATAL: global wrangler not found (npm root -g)'); process.exit(1); }
  try { await startWrangler(); }
  catch (e) { log('FATAL: ' + e.message); log('--- last dev log ---'); log(devLog.slice(-1500)); process.exit(1); }

  try {
    // ================================================================
    // SETUP — two projects: P (with blob) and P2 (no blob)
    // ================================================================
    const PID = 'qci-' + Date.now().toString(36);
    const P2 = 'qci-noblob-' + Date.now().toString(36);
    const NAME = 'Import QA';
    const create = await api('/api/cloud/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PID, name: NAME }) });
    check('Q0a project create ok + owner code', create.status === 200 && create.body && create.body.ok === true && typeof create.body.ownerCode === 'string', create.text);
    const OC = create.body ? create.body.ownerCode : '';
    const createP2 = await api('/api/cloud/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: P2, name: 'No Blob' }) });
    const OC2 = createP2.body && createP2.body.ok ? createP2.body.ownerCode : '';
    check('Q0c no-blob project created', !!OC2, createP2.text);

    // Blob state: MCP-AFTER of the edits we will import.
    const state1 = baseState(PID, NAME); // charter.name = 'Import QA', tasks has t1(done) + t9, risks EMPTY
    const save = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: state1 })
    });
    check('Q0b owner save ok', save.status === 200 && save.body && save.body.ok === true, save.text);

    // ================================================================
    // Q1 — owner-only auth
    // ================================================================
    const q1a = await api('/api/cloud/projects/' + PID + '/changelog/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: [] }) });
    check('Q1a import without code -> generic 403', q1a.status === 403 && q1a.body && q1a.body.error === 'invalid project or owner code', q1a.text);
    const q1b = await api('/api/cloud/projects/' + PID + '/changelog/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': 'AAAA-BBBB-CCCC-DDDD' }, body: JSON.stringify({ entries: [] }) });
    check('Q1b import with wrong code -> same generic 403', q1b.status === 403 && q1b.body && q1b.body.error === 'invalid project or owner code', q1b.text);
    const q1c = await api('/api/cloud/projects/' + 'nope-nope-nope' + '/changelog/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({ entries: [] }) });
    check('Q1c import for unknown project -> same generic 403', q1c.status === 403 && q1c.body && q1c.body.error === 'invalid project or owner code', q1c.text);

    // ================================================================
    // Q2 — happy path: charter diff matching the blob
    // ================================================================
    // MCP changed charter.name 'Old Name' -> 'Import QA'; blob holds 'Import QA'.
    const d2 = [{ path: 'charter.name', before: 'Old Name', after: 'Import QA', beforeAbsent: false, afterAbsent: false }];
    const q2 = await api('/api/cloud/projects/' + PID + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ entries: [mcpEntry(1, 'edit', 'owner', 'mcp-ai', d2, ISO)] })
    });
    check('Q2a matching diff imported with fresh id', q2.status === 200 && q2.body && q2.body.ok === true && q2.body.imported.length === 1 && q2.body.imported[0].cloudId > 0 && q2.body.imported[0].localId === 1 && q2.body.skipped.length === 0, q2.text);
    const rowQ2 = queryD1("SELECT entry_type, actor_type, actor_label, section, diffs_json, import_key, created_at FROM cloud_changelog WHERE project_id = " + "'" + PID.replace(/'/g, "''") + "'" + " AND import_key = " + "'mcp:" + PID.replace(/'/g, "''") + ":1'");
    const row = rowQ2 && rowQ2[0];
    check('Q2b stored row shape (edit/mcp-ai/charter/import_key)', row && row.entry_type === 'edit' && row.actor_type === 'owner' && row.actor_label === 'mcp-ai' && row.section === 'charter' && row.import_key === 'mcp:' + PID + ':1', row);
    let diffsRow = null;
    try { diffsRow = row ? JSON.parse(row.diffs_json) : null; } catch (e) {}
    check('Q2c diffs_json persisted with before/after + beforeAbsent/afterAbsent', diffsRow && diffsRow.length === 1 && diffsRow[0].path === 'charter.name' && diffsRow[0].after === 'Import QA' && diffsRow[0].beforeAbsent === false, diffsRow);
    const rowCountBase = queryD1("SELECT COUNT(*) AS n FROM cloud_changelog WHERE project_id = " + "'" + PID.replace(/'/g, "''") + "'")[0].n;

    // ================================================================
    // Q3 — HONESTY GATE: divergent diff skipped, never stored
    // ================================================================
    const d3 = [{ path: 'charter.name', before: 'Old', after: 'DIFFERENT', beforeAbsent: false, afterAbsent: false }];
    const q3 = await api('/api/cloud/projects/' + PID + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ entries: [mcpEntry(50, 'edit', 'owner', 'mcp-ai', d3, ISO)] })
    });
    check('Q3a divergent diff skipped with reason', q3.status === 200 && q3.body && q3.body.imported.length === 0 && q3.body.skipped.length === 1 && /diverged/.test(q3.body.skipped[0].reason), q3.text);
    const rowQ3 = queryD1("SELECT COUNT(*) AS n FROM cloud_changelog WHERE project_id = " + "'" + PID.replace(/'/g, "''") + "'" + " AND import_key = " + "'mcp:" + PID.replace(/'/g, "''") + ":50'");
    check('Q3b nothing stored for the divergent entry', rowQ3 && Number(rowQ3[0].n) === 0, rowQ3);

    // ================================================================
    // Q4 — no snapshot: everything skipped with the right reason
    // ================================================================
    const q4 = await api('/api/cloud/projects/' + P2 + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC2 },
      body: JSON.stringify({ entries: [mcpEntry(1, 'edit', 'owner', 'mcp-ai', d2, ISO)] })
    });
    check('Q4a no-snapshot project skips every entry', q4.status === 200 && q4.body && q4.body.imported.length === 0 && q4.body.skipped.length === 1 && /no cloud snapshot/.test(q4.body.skipped[0].reason), q4.text);

    // ================================================================
    // Q5 — idempotency: same localId again -> no-op, row count stable
    // ================================================================
    const q5 = await api('/api/cloud/projects/' + PID + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ entries: [mcpEntry(1, 'edit', 'owner', 'mcp-ai', d2, ISO)] })
    });
    check('Q5a re-import reported as already imported', q5.status === 200 && q5.body && q5.body.imported.length === 0 && q5.body.skipped.length === 1 && q5.body.skipped[0].reason === 'already imported', q5.text);
    const rowCountAfter = queryD1("SELECT COUNT(*) AS n FROM cloud_changelog WHERE project_id = " + "'" + PID.replace(/'/g, "''") + "'")[0].n;
    check('Q5b no duplicate rows on re-import', Number(rowCountAfter) === Number(rowCountBase), { base: rowCountBase, after: rowCountAfter });

    // ================================================================
    // Q6 — recordId add/delete/field diffs import + revert via owner route
    // ================================================================
    // All three diffs describe the SAME blob state1 (t9 present, r1 absent,
    // t1.status 'done'):
    const d6 = [
      { path: 'tasks[1]', recordId: 't9', after: { id: 't9', name: 'AI Added', status: 'planned', start: '2026-02-01', end: '2026-02-05' }, beforeAbsent: true, afterAbsent: false },
      { path: 'risks[0]', recordId: 'r1', before: { id: 'r1', name: 'Risk One', prob: 3 }, beforeAbsent: false, afterAbsent: true },
      { path: 'tasks[0].status', recordId: 't1', before: 'todo', after: 'done', beforeAbsent: false, afterAbsent: false }
    ];
    const q6 = await api('/api/cloud/projects/' + PID + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ entries: [mcpEntry(2, 'edit', 'owner', 'mcp-ai', d6, ISO)] })
    });
    check('Q6a recordId diffs (add/delete/field) imported', q6.status === 200 && q6.body && q6.body.imported.length === 1 && q6.body.imported[0].section === 'multiple' && q6.body.skipped.length === 0, q6.text);
    const E6 = q6.body ? q6.body.imported[0].cloudId : null;

    // Revert the imported entry (delete-restore + add-remove + field-write).
    const q6r = await api('/api/cloud/projects/' + PID + '/changelog/' + E6 + '/revert', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    check('Q6b owner revert of imported entry ok + logs revert row', q6r.status === 200 && q6r.body && q6r.body.ok === true && q6r.body.revertEntryId > 0, q6r.text);
    const load6 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const st6 = load6.body && load6.body.state;
    const t9gone = st6 && !(st6.tasks || []).some(t => t.id === 't9');
    const r1back = st6 && (st6.risks || []).some(r => r.id === 'r1' && r.name === 'Risk One');
    const t1status = st6 && (st6.tasks || []).find(t => t.id === 't1');
    check('Q6c revert restored exactly: t9 removed, r1 re-inserted, t1.status->todo', t9gone === true && r1back === true && t1status && t1status.status === 'todo', st6 && { tasks: st6.tasks, risks: st6.risks });
    const revertRow = queryD1("SELECT entry_type, actor_label, diffs_json FROM cloud_changelog WHERE project_id = " + "'" + PID.replace(/'/g, "''") + "'" + " AND entry_type = 'revert' ORDER BY id DESC LIMIT 1");
    // Cloud semantics: the OWNER who clicks revert is the actor of the revert row
    // (auth.label — 'Owner' when no Google name is linked); the diffs are the
    // inverses of the imported entry's.
    check('Q6d revert row attributed to owner with inverse diffs', revertRow && revertRow[0] && revertRow[0].entry_type === 'revert' && revertRow[0].actor_label === 'Owner' && revertRow[0].diffs_json && revertRow[0].diffs_json.indexOf('"path"') !== -1, revertRow && revertRow[0]);

    // ================================================================
    // Q9 — revert of the revert: re-reverting restores the reverted state
    // ================================================================
    const E6rev = q6r.body ? q6r.body.revertEntryId : null;
    const q9 = await api('/api/cloud/projects/' + PID + '/changelog/' + E6rev + '/revert', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    check('Q9a revert-of-revert accepted', q9.status === 200 && q9.body && q9.body.ok === true, q9.text);
    const load9 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const st9 = load9.body && load9.body.state;
    const t9back = st9 && (st9.tasks || []).some(t => t.id === 't9' && t.name === 'AI Added');
    const r1gone = st9 && !(st9.risks || []).some(r => r.id === 'r1');
    const t1done = st9 && (st9.tasks || []).find(t => t.id === 't1');
    check('Q9b revert-of-revert restored t9, removed r1, status->done', t9back === true && r1gone === true && t1done && t1done.status === 'done', st9 && { tasks: st9.tasks, risks: st9.risks });

    // ================================================================
    // Q7 — bulk normalization (diffs -> stored as edit)
    // ================================================================
    const q7 = await api('/api/cloud/projects/' + PID + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ entries: [mcpEntry(3, 'bulk', 'owner', 'mcp-ai', d2, ISO)] })
    });
    check('Q7a MCP bulk with diffs imported as edit', q7.status === 200 && q7.body && q7.body.imported.length === 1 && q7.body.imported[0].type === 'edit', q7.text);
    const q7b = await api('/api/cloud/projects/' + PID + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ entries: [mcpEntry(4, 'bulk', 'owner', 'mcp-ai', null, ISO)] })
    });
    check('Q7b bulk without diffs rejected (nothing reversible)', q7.status === 200 && q7b.body && q7b.body.imported.length === 0 && q7b.body.skipped.length === 1 && /no diffs/.test(q7b.body.skipped[0].reason), q7b.text);

    // ================================================================
    // Q8 — entry validation
    // ================================================================
    const q8 = await api('/api/cloud/projects/' + PID + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ entries: [
        mcpEntry('nope', 'edit', 'owner', 'mcp-ai', d2, ISO),
        mcpEntry(5, 'recovery', 'owner', 'mcp-ai', d2, ISO),
        mcpEntry(6, 'edit', 'owner', 'mcp-ai', d2, 'not-a-date')
      ] })
    });
    const reasons8 = (q8.body && q8.body.skipped || []).map(s => s.reason);
    check('Q8a bad localId/type/created_at all skipped with reasons', q8.status === 200 && q8.body && q8.body.imported.length === 0 && q8.body.skipped.length === 3 && reasons8[0] && reasons8[0].indexOf('positive integer') !== -1 && reasons8[1] && reasons8[1].indexOf('unsupported entry_type') !== -1 && reasons8[2] && reasons8[2].indexOf('ISO date') !== -1, { body: q8.body });

    // ================================================================
    // Q11/Q12 — cloud-NATIVE leaf-diff reverts (REVIEW-FIX regression
    // gates): the app's own saves produce leaf diffs, so reverting a
    // field-add must delete ONLY the field, and reverting a record-add
    // must not splice away the FOLLOWING records.
    // ================================================================
    // Q11 — field added to an existing record via a normal save, then
    // reverted: the record survives, the field is gone.
    const q11a = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: Object.assign({}, state1, { tasks: (state1.tasks || []).map(function(t) { return t.id === 't1' ? Object.assign({}, t, { notes: 'field added later' }) : t; }) }) })
    });
    const E11 = q11a.body && q11a.body.changelog ? q11a.body.changelog.id : null;
    check('Q11a field-add save logged an edit entry', q11a.status === 200 && q11a.body && q11a.body.changelog && q11a.body.changelog.type === 'edit' && E11 > 0, q11a.text);
    const q11r = await api('/api/cloud/projects/' + PID + '/changelog/' + E11 + '/revert', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const load11 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const st11 = load11.body && load11.body.state;
    const t1n = st11 && (st11.tasks || []).find(t => t.id === 't1');
    check('Q11b field-add revert kept the record and removed the field', q11r.status === 200 && t1n && t1n.notes === undefined && (st11.tasks || []).length === 2, { revert: q11r.text, t1: t1n, len: st11 && st11.tasks && st11.tasks.length });

    // Q12 — record added via a normal save (leaf diffs at the same index),
    // then reverted: the added record becomes an empty shell, the FOLLOWING
    // records survive (the pre-fix code spliced them away one by one).
    const state3 = baseState(PID, NAME);
    state3.tasks.push({ id: 't3', name: 'Third Task', status: 'planned', start: '2026-03-01', end: '2026-03-05' });
    const q12a = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: state3 })
    });
    const E12 = q12a.body && q12a.body.changelog ? q12a.body.changelog.id : null;
    check('Q12a record-add save logged an edit entry', q12a.status === 200 && q12a.body && q12a.body.changelog && q12a.body.changelog.type === 'edit' && E12 > 0, q12a.text);
    const q12r = await api('/api/cloud/projects/' + PID + '/changelog/' + E12 + '/revert', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const load12 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const st12 = load12.body && load12.body.state;
    const t12a = st12 && (st12.tasks || []).find(t => t.id === 't1');
    const t12b = st12 && (st12.tasks || []).find(t => t.id === 't9');
    const t12c = st12 && (st12.tasks || []).find(t => t.id === 't3');
    check('Q12b record-add revert kept every neighbor record', q12r.status === 200 && !!t12a && !!t12b && !t12c, { revert: q12r.text, ids: st12 && (st12.tasks || []).map(t => t.id) });

    // ================================================================
    // Q13 — OBJECT content-key revert (REVIEW-FIX #2 regression gate):
    // closure.* is leaf-diffed by the app's own saves; reverting it must
    // restore the field via the generic path helpers, not silently no-op.
    // ================================================================
    const q13a = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: Object.assign({}, state1, { closure: { status: 'closed', handoverNotes: 'Done' } }) })
    });
    const E13 = q13a.body && q13a.body.changelog ? q13a.body.changelog.id : null;
    check('Q13a closure change save logged an edit entry', q13a.status === 200 && q13a.body && q13a.body.changelog && q13a.body.changelog.type === 'edit' && E13 > 0, q13a.text);
    const q13r = await api('/api/cloud/projects/' + PID + '/changelog/' + E13 + '/revert', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const load13 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const st13 = load13.body && load13.body.state;
    check('Q13b closure revert restored the object field', q13r.status === 200 && st13 && st13.closure && st13.closure.status === 'open' && st13.closure.handoverNotes === 'Initial handover', { revert: q13r.text, closure: st13 && st13.closure });

    // ================================================================
    // Q10 — CLI end-to-end (dry-run, live push, ledger, re-run)
    // ================================================================
    const CLI = path.join(ROOT, 'tools', 'import-mcp-changelog.cjs');
    const dir = path.join(os.tmpdir(), 'mmgr-qci-cli-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    const cliPid = 'qci-cli-' + Date.now().toString(36);
    const cliCreate = await api('/api/cloud/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: cliPid, name: 'CLI QA' }) });
    const cliOC = cliCreate.body ? cliCreate.body.ownerCode : '';
    const cliState = baseState(cliPid, 'CLI QA');
    await api('/api/cloud/projects/' + cliPid + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': cliOC }, body: JSON.stringify({ state: cliState }) });
    const cliFile = path.join(dir, 'cli-proj.json');
    fs.writeFileSync(cliFile, JSON.stringify(cliState));
    // Diffs must match THIS project's blob ('CLI QA') — the honesty gate proves
    // itself here: a mismatched after-value is exactly what it rejects.
    const dCli = [{ path: 'charter.name', before: 'Old Name', after: 'CLI QA', beforeAbsent: false, afterAbsent: false }];
    const sidecar = path.join(dir, 'cli-proj.mcp-changelog.json');
    fs.writeFileSync(sidecar, JSON.stringify({ version: 1, entries: [
      { id: 1, entry_type: 'edit', actor_type: 'owner', actor_label: 'mcp-ai', section: 'charter', diffs_json: JSON.stringify(dCli), created_at: ISO },
      { id: 2, entry_type: 'edit', actor_type: 'owner', actor_label: 'mcp-ai', section: 'wbs', diffs_json: JSON.stringify([{ path: 'tasks[0].status', recordId: 't1', before: 'todo', after: 'done', beforeAbsent: false, afterAbsent: false }]), created_at: ISO }
    ] }));

    let dry = '';
    try {
      dry = execFileSync(process.execPath, [CLI, '--file', cliFile, '--url', BASE, '--owner-code', cliOC, '--dry-run'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    } catch (e) { dry = 'ERR ' + e.message; }
    check('Q10a CLI dry-run prints plan and pushes nothing', dry.indexOf('DRY RUN') !== -1 && dry.indexOf('pending=2') !== -1, dry.slice(0, 300));

    let live = '';
    try {
      live = execFileSync(process.execPath, [CLI, '--file', cliFile, '--url', BASE, '--owner-code', cliOC], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    } catch (e) { live = 'ERR ' + e.message; }
    check('Q10b CLI live push imports 2 entries', live.indexOf('imported=2') !== -1 && live.indexOf('-> cloud entry') !== -1, live.slice(0, 500));
    const ledgerPath = path.join(dir, 'cli-proj.mcp-changelog.imported.json');
    let ledger = null;
    try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch (e) {}
    check('Q10c ledger written with localId->cloudId mapping', ledger && ledger.projectId === cliPid && ledger.entries && Object.keys(ledger.entries).length === 2, ledger);

    let rerun = '';
    try {
      rerun = execFileSync(process.execPath, [CLI, '--file', cliFile, '--url', BASE, '--owner-code', cliOC], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    } catch (e) { rerun = 'ERR ' + e.message; }
    check('Q10d CLI re-run reports nothing to import', rerun.indexOf('nothing to import') !== -1, rerun.slice(0, 200));
    const cliRows = queryD1("SELECT COUNT(*) AS n FROM cloud_changelog WHERE project_id = " + "'" + cliPid.replace(/'/g, "''") + "'");
    check('Q10e cloud rows exist for the CLI-imported entries (2)', cliRows && Number(cliRows[0].n) === 2, cliRows);
    const cliLedgerRow = queryD1("SELECT import_key FROM cloud_changelog WHERE project_id = " + "'" + cliPid.replace(/'/g, "''") + "'" + " ORDER BY id");
    check('Q10f import_keys are scoped to the CLI project id', cliLedgerRow && cliLedgerRow.every(r => String(r.import_key).indexOf('mcp:' + cliPid + ':') === 0), cliLedgerRow);
  } catch (e) {
    log('FATAL harness exception: ' + (e && e.stack || e));
  }

  stopWrangler();
  const fails = results.filter(r => !r.val);
  log('----------------------------------------');
  log('RESULT: ' + (results.length - fails.length) + '/' + results.length + ' gates passed');
  if (fails.length) {
    fails.forEach(f => log('FAILED: ' + f.name));
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { log('FATAL: ' + (e && e.stack || e)); stopWrangler(); process.exit(1); });
