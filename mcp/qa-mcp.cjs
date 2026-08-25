/* ============================================================
   My MaNaGeR MCP — QA harness (qa-mcp)
   ------------------------------------------------------------
   Spawns mcp/server.mjs as a child process, drives the MCP
   JSON-RPC protocol over stdio, and asserts:
     H1  initialize handshake (protocolVersion, capabilities, serverInfo)
     H2  tools/list returns the full catalog
     R1  mmgr_list_projects finds the fixture
     R2  mmgr_get_project_overview returns health + EVM + counts
     R3  mmgr_get_context returns the sectioned Markdown dump
     R4  mmgr_get_tasks filters by status
     R5  mmgr_answer_question answers a LOCAL intent with trace
     R6  mmgr_answer_question honestly declines an unanswerable
         question when no cloud key is configured
     W1  write tools are gated off without MMGR_MCP_ALLOW_WRITES=1
     W2  (writes on) propose -> approve applies + changelog entry
     W3  propose -> reject leaves the file untouched
     W4  invalid ops are rejected before any staging
     W5  approve refuses when the file changed on disk (stale)
     W6  revert restores the pre-change state + logs a revert row
     W7  changelog entries carry the cloud shape (diffs_json)
   Run: node mcp/qa-mcp.cjs   (from repo root)
   ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(__dirname, 'server.mjs');
const FIXTURE = path.join(__dirname, 'fixtures', 'sample-project.json');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail !== undefined ? '  => ' + JSON.stringify(detail).slice(0, 400) : '')); }
}

// ---- tiny JSON-RPC client over the child's stdio ----
function makeClient(env) {
  const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: Object.assign({}, process.env, env), stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buf = '';
  let nextId = 1;
  const stderr = [];
  child.stderr.on('data', d => stderr.push(String(d)));
  child.stdout.on('data', d => {
    buf += String(d);
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error('rpc error ' + msg.error.code + ': ' + msg.error.message));
        else resolve(msg.result);
      }
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method, params) => { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); };
  const close = () => { child.stdin.end(); child.kill(); };
  return { rpc, notify, close, stderr };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgr-mcp-qa-'));
  const projName = 'sample-project.json';
  const projFile = path.join(tmpDir, projName);
  fs.copyFileSync(FIXTURE, projFile);
  const baseEnv = { MMGR_MCP_DIR: tmpDir, MMGR_MCP_PROJECT: projName };
  let c;

  // ---- Read-only server (no writes) ----
  c = makeClient(baseEnv);
  await sleep(250);
  const init = await c.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'qa-mcp' } });
  check('H1 initialize returns protocol + capabilities + serverInfo',
    init && init.protocolVersion === '2024-11-05' && init.capabilities && init.capabilities.tools && init.serverInfo && init.serverInfo.name === 'mymanager-mcp', init);
  c.notify('notifications/initialized', {});
  await sleep(50);

  const list = await c.rpc('tools/list', {});
  const names = list.tools.map(t => t.name);
  check('H2 tools/list returns the full catalog (31 tools)',
    names.length === 31 && ['mmgr_list_projects', 'mmgr_get_project_overview', 'mmgr_get_context', 'mmgr_answer_question', 'mmgr_propose_change', 'mmgr_approve_change', 'mmgr_reject_change', 'mmgr_revert_change', 'mmgr_list_writable_fields', 'mmgr_get_resources', 'mmgr_get_stakeholders', 'mmgr_get_meetings', 'mmgr_get_decisions', 'mmgr_get_documents', 'mmgr_get_bids', 'mmgr_get_closure', 'mmgr_get_sprint', 'mmgr_get_dmaic', 'mmgr_get_spend_log', 'mmgr_get_weather_log'].every(n => names.includes(n)), names.length);

  const projs = await c.rpc('tools/call', { name: 'mmgr_list_projects', arguments: {} });
  check('R1 list_projects finds the fixture', projs.structuredContent.projects.includes(projName), projs.structuredContent.projects);

  const overview = await c.rpc('tools/call', { name: 'mmgr_get_project_overview', arguments: {} });
  check('R2 overview returns health + EVM + counts',
    overview.structuredContent.overview && overview.structuredContent.overview.name === 'Riverwalk Retail Fit-Out' && typeof overview.structuredContent.overview.health === 'number' && overview.structuredContent.overview.tasks === 6, overview);

  const ctx = await c.rpc('tools/call', { name: 'mmgr_get_context', arguments: {} });
  check('R3 context is the sectioned Markdown dump',
    ctx.structuredContent.context.includes('## PROJECT') && ctx.structuredContent.context.includes('## HEALTH SCORE') && ctx.structuredContent.context.includes('## EVM (Earned Value)') && ctx.structuredContent.context.includes('## WEATHER'), '');

  const tasks = await c.rpc('tools/call', { name: 'mmgr_get_tasks', arguments: { status: 'inprogress' } });
  check('R4 get_tasks filters by status', tasks.structuredContent.tasks.length === 1 && tasks.structuredContent.tasks[0].name === 'MEP Rough-In', tasks.structuredContent.tasks);

  const ans = await c.rpc('tools/call', { name: 'mmgr_answer_question', arguments: { question: 'What is the completion percentage?' } });
  check('R5 answer_question LOCAL intent with trace',
    ans.structuredContent.tier === 'local' && ans.structuredContent.text.includes('Completion:') && Array.isArray(ans.structuredContent.trace) && ans.structuredContent.trace.includes('tasks[].status'), ans.structuredContent);

  const ans2 = await c.rpc('tools/call', { name: 'mmgr_answer_question', arguments: { question: 'Write me a poetic haiku about the project.' } });
  check('R6 answer_question honestly declines without a cloud key',
    ans2.isError === true && /reasoning beyond local lookup/.test(ans2.content[0].text), ans2);

  // R7-R17: new read tools for all project sections
  const res = await c.rpc('tools/call', { name: 'mmgr_get_resources', arguments: {} });
  check('R7 get_resources returns resources array', Array.isArray(res.structuredContent.resources), res);

  const stk = await c.rpc('tools/call', { name: 'mmgr_get_stakeholders', arguments: {} });
  check('R8 get_stakeholders returns stakeholders array', Array.isArray(stk.structuredContent.stakeholders), stk);

  const mtg = await c.rpc('tools/call', { name: 'mmgr_get_meetings', arguments: {} });
  check('R9 get_meetings returns meetings array', Array.isArray(mtg.structuredContent.meetings), mtg);

  const dec = await c.rpc('tools/call', { name: 'mmgr_get_decisions', arguments: {} });
  check('R10 get_decisions returns decisions array', Array.isArray(dec.structuredContent.decisions), dec);

  const doc = await c.rpc('tools/call', { name: 'mmgr_get_documents', arguments: {} });
  check('R11 get_documents returns documents array', Array.isArray(doc.structuredContent.documents), doc);

  const bid = await c.rpc('tools/call', { name: 'mmgr_get_bids', arguments: {} });
  check('R12 get_bids returns bidPackages array', Array.isArray(bid.structuredContent.bidPackages), bid);

  const cls = await c.rpc('tools/call', { name: 'mmgr_get_closure', arguments: {} });
  check('R13 get_closure returns closure object', cls.structuredContent.closure !== undefined, cls);

  const spr = await c.rpc('tools/call', { name: 'mmgr_get_sprint', arguments: {} });
  check('R14 get_sprint returns sprint object', spr.structuredContent.sprint !== undefined, spr);

  const dmc = await c.rpc('tools/call', { name: 'mmgr_get_dmaic', arguments: {} });
  check('R15 get_dmaic returns dmaic object', dmc.structuredContent.dmaic !== undefined, dmc);

  const spl = await c.rpc('tools/call', { name: 'mmgr_get_spend_log', arguments: {} });
  check('R16 get_spend_log returns entries array', Array.isArray(spl.structuredContent.entries), spl);

  const wxl = await c.rpc('tools/call', { name: 'mmgr_get_weather_log', arguments: {} });
  check('R17 get_weather_log returns entries array', Array.isArray(wxl.structuredContent.entries), wxl);

  const wOff = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-2', status: 'completed' }] } });
  check('W1 write tools gated off without MMGR_MCP_ALLOW_WRITES=1',
    wOff.isError === true && /ALLOW_WRITES/.test(wOff.content[0].text), wOff);
  c.close();
  await sleep(100);

  // ---- Write-enabled server ----
  c = makeClient(Object.assign({}, baseEnv, { MMGR_MCP_ALLOW_WRITES: '1' }));
  await sleep(250);
  await c.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'qa-mcp' } });
  c.notify('notifications/initialized', {});
  await sleep(50);

  // W4: invalid ops rejected before staging
  const bad = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-2', status: 'banana' }] } });
  check('W4 invalid op value rejected pre-staging', bad.isError === true && /invalid value/.test(bad.content[0].text), bad);

  const bad2 = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-2', surpriseField: 'x' }] } });
  check('W4b non-whitelisted field rejected', bad2.isError === true && /unexpected field/.test(bad2.content[0].text), bad2);

  const bad3 = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'mystery.delete', id: 'x' }] } });
  check('W4c unknown op rejected', bad3.isError === true && /unknown operation/.test(bad3.content[0].text), bad3);

  // W3: reject leaves file untouched
  const beforeReject = fs.readFileSync(projFile, 'utf8');
  const rej = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-3', status: 'completed' }] } });
  check('W3a propose returns a token + preview', !rej.isError && rej.structuredContent.token && rej.structuredContent.preview.includes('UPDATE task'), rej.structuredContent);
  const rejTok = rej.structuredContent.token;
  const rej2 = await c.rpc('tools/call', { name: 'mmgr_reject_change', arguments: { token: rejTok } });
  check('W3b reject succeeds', !rej2.isError && rej2.structuredContent.rejected === true, rej2);
  check('W3c file untouched after reject', fs.readFileSync(projFile, 'utf8') === beforeReject, '');
  const rej3 = await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: rejTok } });
  check('W3d consumed token cannot be replayed', rej3.isError === true && /already-used/.test(rej3.content[0].text), rej3);

  // W5: approve refuses on stale file
  const stale = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-5', notes: 'stale probe' }] } });
  fs.writeFileSync(projFile, fs.readFileSync(projFile, 'utf8') + '\n'); // external touch
  const stale2 = await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: stale.structuredContent.token } });
  check('W5 approve refuses when file changed on disk', stale2.isError === true && /changed on disk/.test(stale2.content[0].text), stale2);

  // W2: propose -> approve applies + changelog entry
  const prop = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-2', status: 'completed' }] } });
  check('W2a propose stages task.update', !prop.isError && prop.structuredContent.token, prop);
  const propTok = prop.structuredContent.token;
  const appr = await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: propTok } });
  check('W2b approve applies + returns changelog entry id', !appr.isError && typeof appr.structuredContent.entryId === 'number', appr);

  const reloaded = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const t2 = reloaded.tasks.find(t => t.id === 't-2');
  check('W2c state actually changed on disk (status completed)', t2.status === 'completed', t2);

  const cl = await c.rpc('tools/call', { name: 'mmgr_get_changelog', arguments: {} });
  check('W2d changelog has the edit entry (cloud shape: entry_type + diffs_json)',
    cl.structuredContent.entries.length === 1 && cl.structuredContent.entries[0].entry_type === 'edit' && cl.structuredContent.entries[0].actor_label === 'mcp-ai' && Array.isArray(cl.structuredContent.entries[0].diffs_json) && cl.structuredContent.entries[0].diffs_json[0].path === 'tasks[1].status', cl.structuredContent.entries);

  // W6: revert restores + logs revert row
  const entryId = cl.structuredContent.entries[0].id;
  const rev = await c.rpc('tools/call', { name: 'mmgr_revert_change', arguments: { entryId } });
  check('W6a revert applies', !rev.isError && rev.structuredContent.reverted === true, rev);
  const afterRev = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const t2b = afterRev.tasks.find(t => t.id === 't-2');
  check('W6b state restored (status back to inprogress)', t2b.status === 'inprogress', t2b);
  const cl2 = await c.rpc('tools/call', { name: 'mmgr_get_changelog', arguments: {} });
  check('W6c revert logged as new row (history preserved)',
    cl2.structuredContent.entries.length === 2 && cl2.structuredContent.entries[1].entry_type === 'revert' && cl2.structuredContent.entries[1].reverts_id === entryId, cl2.structuredContent.entries);
  const rev2 = await c.rpc('tools/call', { name: 'mmgr_revert_change', arguments: { entryId } });
  check('W6d re-reverting is refused', rev2.isError === true && /already been reverted/.test(rev2.content[0].text), rev2);

  // W7: an add op lands + delete op round-trips through revert
  const add = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'risk.add', description: 'QA harness risk', probability: 'Low', impact: 'Medium' }] } });
  const addTok = add.structuredContent.token;
  await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: addTok } });
  const withRisk = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const newRisk = (withRisk.risks || []).find(r => r.description === 'QA harness risk');
  check('W7a add op lands with generated id', !!newRisk && /^r-/.test(newRisk.id), newRisk);

  const cl3 = await c.rpc('tools/call', { name: 'mmgr_get_changelog', arguments: {} });
  const addEntry = cl3.structuredContent.entries.find(e => e.entry_type === 'edit' && e.diffs_json && e.diffs_json.length === 1 && e.diffs_json[0].beforeAbsent === true);
  check('W7b add diff uses beforeAbsent (cloud shape)', !!addEntry, cl3.structuredContent.entries);
  const revAdd = await c.rpc('tools/call', { name: 'mmgr_revert_change', arguments: { entryId: addEntry.id } });
  check('W7c add revert removes the record', !revAdd.isError, revAdd);
  const noRisk = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  check('W7d risk removed after revert', !(noRisk.risks || []).some(r => r.description === 'QA harness risk'), '');

  // W8 (review fix): approve writes a REAL pre-change backup file next to the project.
  const bkProbe = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-3', notes: 'backup probe' }] } });
  const bkApprove = await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: bkProbe.structuredContent.token } });
  const backupName = bkApprove.structuredContent.backup;
  const backupPath = path.join(tmpDir, backupName);
  check('W8 approve writes a real pre-change backup', !bkApprove.isError && fs.existsSync(backupPath) && fs.readFileSync(backupPath, 'utf8').includes('Riverwalk Retail Fit-Out'), backupName);

  // W8b (review fix): the changelog's add-op diff records the REAL written id
  // (no phantom propose-time id) — propose a FRESH add, approve it, and verify
  // the recorded recordId is the one actually in the file.
  const add2 = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'issue.add', description: 'QA harness issue' }] } });
  const add2Approve = await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: add2.structuredContent.token } });
  const cl4 = await c.rpc('tools/call', { name: 'mmgr_get_changelog', arguments: {} });
  const addEntry2 = cl4.structuredContent.entries.find(e => e.id === add2Approve.structuredContent.entryId);
  const writtenIds = JSON.parse(fs.readFileSync(projFile, 'utf8')).issues.map(i => i.id);
  check('W8b add-op changelog records the real written id', addEntry2 && addEntry2.diffs_json && writtenIds.includes(addEntry2.diffs_json[0].recordId), { entry: addEntry2, writtenIds });
  const revAdd2 = await c.rpc('tools/call', { name: 'mmgr_revert_change', arguments: { entryId: add2Approve.structuredContent.entryId } });
  check('W8c revert of that add uses the recorded id', !revAdd2.isError, revAdd2);

  // W9 (review fix): revert resolves by record ID, so a later index-shifting edit
  // cannot make an old revert hit the wrong record. Stage an update to t-5, then
  // delete t-1 (shifts indices), then revert the t-5 update — t-5 must still change.
  const driftProp = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-5', notes: 'drift-probe notes' }] } });
  await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: driftProp.structuredContent.token } });
  const cl5 = await c.rpc('tools/call', { name: 'mmgr_get_changelog', arguments: {} });
  const driftEntry = cl5.structuredContent.entries.find(e => e.entry_type === 'edit' && e.diffs_json && e.diffs_json[0].recordId === 't-5');
  const delProp = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.delete', id: 't-1' }] } });
  const delApprove = await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: delProp.structuredContent.token } });
  check('W9a index-shifting delete lands', !delApprove.isError, delApprove);
  const revDrift = await c.rpc('tools/call', { name: 'mmgr_revert_change', arguments: { entryId: driftEntry.id } });
  const afterDrift = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const t5 = afterDrift.tasks.find(t => t.id === 't-5');
  check('W9b revert hits the right record by id after index drift', !revDrift.isError && t5 && t5.notes === '', { t5notes: t5 && t5.notes });

  // W9c (review fix 2): reverting an update whose record was DELETED by a later
  // edit must SKIP (never mutate the wrong record now sitting at that index).
  const preDel = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-4', notes: 'doomed notes' }] } });
  await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: preDel.structuredContent.token } });
  const cl6 = await c.rpc('tools/call', { name: 'mmgr_get_changelog', arguments: {} });
  const doomedEntry = cl6.structuredContent.entries.find(e => e.entry_type === 'edit' && e.diffs_json && e.diffs_json[0].recordId === 't-4');
  const del2 = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.delete', id: 't-4' }] } });
  const del2Approve = await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: del2.structuredContent.token } });
  check('W9c target record deleted before revert', !del2Approve.isError, del2Approve);
  const beforeRevert = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const revDoomed = await c.rpc('tools/call', { name: 'mmgr_revert_change', arguments: { entryId: doomedEntry.id } });
  const afterDoomed = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const t5Before = beforeRevert.tasks.find(t => t.id === 't-5');
  const t5After = afterDoomed.tasks.find(t => t.id === 't-5');
  check('W9d skipped revert leaves other records untouched', !revDoomed.isError && JSON.stringify(t5Before) === JSON.stringify(t5After) && afterDoomed.tasks.length === beforeRevert.tasks.length, { t5Before, t5After });

  // W10 (review fix): a FIELD-level add (beforeAbsent leaf diff — a
  // whitelisted field that was undefined on the record, e.g. milestone) must
  // revert by deleting just that field — never by splicing the whole record.
  const fldProp = await c.rpc('tools/call', { name: 'mmgr_propose_change', arguments: { operations: [{ op: 'task.update', id: 't-3', milestone: true }] } });
  const fldApprove = await c.rpc('tools/call', { name: 'mmgr_approve_change', arguments: { token: fldProp.structuredContent.token } });
  const afterAdd = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const t3added = afterAdd.tasks.find(t => t.id === 't-3');
  check('W10a field-add lands on the existing record', !fldApprove.isError && t3added && t3added.milestone === true, { approve: fldApprove, t3: t3added });
  const cl10 = await c.rpc('tools/call', { name: 'mmgr_get_changelog', arguments: {} });
  const fldEntry = cl10.structuredContent.entries.find(e => e.entry_type === 'edit' && e.diffs_json && e.diffs_json[0].recordId === 't-3' && e.diffs_json[0].beforeAbsent === true);
  const revFld = await c.rpc('tools/call', { name: 'mmgr_revert_change', arguments: { entryId: fldEntry.id } });
  const afterFldRev = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const t3rev = afterFldRev.tasks.find(t => t.id === 't-3');
  check('W10b field-add revert keeps the record and removes the field', !revFld.isError && !!t3rev && t3rev.milestone === undefined && t3rev.name === 'Drywall & Ceiling Grid', { revert: revFld, t3: t3rev, taskCount: afterFldRev.tasks.length });

  // Cleanup
  c.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n========== QA-MCP RESULT: ' + pass + ' passed, ' + fail + ' failed ==========');
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  console.error('QA harness crashed:', e);
  process.exit(1);
});
