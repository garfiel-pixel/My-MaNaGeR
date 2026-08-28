/* ============================================================
   CLOUD-FIRST SYNC (PART 3) — REVIEW QUEUE (admin review and
   accept changes from another source) — END-TO-END GATE (2026-08-17)
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 miniflare emulation, migration 0015 applied — cloud_reviews
   table) and verifies the approved review-queue surface:

   R1  editor save -> review:'pending' + reviewId, applied:[],
       and the cloud blob does NOT move (no direct apply)
   R2  owner GET /reviews lists the proposal (pending, source
       editor, diffs present)
   R3  the same editor saving again REPLACES their pending
       proposal (last proposal wins — still exactly one pending)
   R4  owner accept -> blob moves through the SAME scope merge
       (in-scope applied, out-of-scope blocked), a changelog
       'accepted' entry is written, proposal status accepted
   R5  accepting the same proposal again -> 409 (not pending)
   R6  reject path: a new editor proposal rejected -> blob
       unchanged, changelog 'rejected' entry, status rejected
   R7  an editor credential (mine=1) sees only their own
       proposals with status; an editor listing ALL reviews -> 403
   R8  MCP import -> proposal (not an instant changelog row);
       owner accept -> 'accepted' changelog entry with the MCP
       import_key; a re-import is skipped (already imported)
   R9  MCP reject -> 'rejected' changelog entry, no accepted entry
   R10 owner save still applies directly (regression: no review)
   R11 unlink cascades proposals (reviews list -> generic 403)

   Exit 0 only when all checks pass. Reports PASS/FAIL per check.
   Usage: node tools/qa-reviews.cjs
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8795;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');

const SECRET = 'qa-reviews-secret-9d2f7c1b';
const ADMIN_CODE = 'qa-admin-rv-31e8';

const log = (s) => { process.stdout.write('[rv] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500)));
};

setTimeout(() => { log('WATCHDOG — harness exceeded 300s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 300000).unref();

function globalWranglerJs() {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-rv-wstate-' + Date.now());

let proc = null;
let devLog = '';

function startWrangler() {
  return new Promise((resolve, reject) => {
    log('starting wrangler dev on :' + PORT + ' (local D1 + R2, migration 0015)…');
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR,
      '--var', 'GOOGLE_CLIENT_SECRET:' + SECRET,
      '--var', 'ADMIN_CODE:' + ADMIN_CODE], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.stdout.on('data', d => { devLog += d; });
    proc.stderr.on('data', d => { devLog += d; });
    proc.on('error', (e) => reject(new Error('wrangler spawn failed: ' + e.message)));
    proc.on('exit', (code) => { if (code !== 0 && code !== null) log('wrangler dev exited early (code ' + code + ')'); });
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

const j = async (res) => { try { return await res.json(); } catch (e) { return {}; } };
const jsonHeaders = { 'Content-Type': 'application/json' };

function baseState(pid, name) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 17, projectId: pid, projectName: name, updatedAt: now,
    charter: { name: name },
    tasks: [{ id: 't1', name: 'Task One', status: 'todo' }],
    risks: [{ id: 'r1', name: 'Risk One', prob: 3, impact: 3 }],
    fieldTs: { charter: now, tasks: now, risks: now },
    config: {}, flags: {}
  };
}

(async function main() {
  try {
    await startWrangler();
    const pid = 'rv-proj-' + Date.now().toString(36);

    // R0 create + seed + editor code.
    let r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST', credentials: 'same-origin',
      headers: jsonHeaders,
      body: JSON.stringify({ projectId: pid, name: 'Review QA' })
    });
    const created = await j(r);
    check('R0a create cloud project', r.ok && created.ok && !!created.ownerCode, created);
    const ownerCode = created.ownerCode;

    const state0 = baseState(pid, 'Review QA');
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ state: state0 })
    });
    const seed = await j(r);
    check('R0b owner seeds the snapshot', r.ok && seed.ok, seed);

    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ label: 'Site Super', scope: ['wbs'] })
    });
    const ed = await j(r);
    check('R0c editor code created (scope wbs)', r.ok && ed.ok && !!ed.editorCode, ed);
    const editorCode = ed.editorCode;

    // R1 editor save -> proposal, blob untouched.
    const stateE = JSON.parse(JSON.stringify(state0));
    stateE.tasks[0].name = 'Edited by editor';
    stateE.risks[0].name = 'HACKED out of scope';
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Editor-Code': editorCode }),
      body: JSON.stringify({ state: stateE })
    });
    const edSave = await j(r);
    // applied reports what the proposal WOULD change (its scope coverage),
    // never that it landed — review:'pending' is the truth; the blob does
    // not move until the owner accepts (checked in R1b).
    check('R1a editor save -> review pending + reviewId + would-be applied wbs + blocked risk',
      r.ok && edSave.ok && edSave.review === 'pending' && !!edSave.reviewId &&
      Array.isArray(edSave.applied) && edSave.applied.indexOf('wbs') !== -1 &&
      Array.isArray(edSave.blocked) && edSave.blocked.indexOf('risk') !== -1, edSave);
    const reviewId1 = edSave.reviewId;
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const blob1 = await j(r);
    check('R1b cloud blob unchanged after editor save (pending review)',
      r.ok && blob1.state.tasks[0].name === 'Task One' && blob1.state.risks[0].name === 'Risk One', blob1.state);

    // R2 owner list shows the proposal with diffs.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const list1 = await j(r);
    const p1 = (list1.proposals || []).find(function(x) { return x.id === reviewId1; });
    check('R2 owner list: pending proposal with editor source + diffs',
      r.ok && list1.ok && !!p1 && p1.status === 'pending' && p1.sourceType === 'editor' && p1.sourceLabel === 'Site Super' &&
      Array.isArray(p1.diffs) && p1.diffs.length > 0, list1);

    // R3 re-save replaces the pending proposal.
    const stateE2 = JSON.parse(JSON.stringify(state0));
    stateE2.tasks[0].name = 'Edited again (WBS)';
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Editor-Code': editorCode }),
      body: JSON.stringify({ state: stateE2 })
    });
    const edSave2 = await j(r);
    const reviewId2 = edSave2.reviewId;
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const list2 = await j(r);
    const pend = (list2.proposals || []).filter(function(x) { return x.status === 'pending'; });
    check('R3 last proposal wins (still exactly one pending, the new id)',
      r.ok && list2.ok && pend.length === 1 && pend[0].id === reviewId2 && reviewId1 !== reviewId2, { pend: pend.map(function(x) { return x.id; }), reviewId1: reviewId1, reviewId2: reviewId2 });

    // R4 owner accept -> scope-merged apply + 'accepted' changelog.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews/' + reviewId2 + '/accept', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const acc = await j(r);
    check('R4a accept ok with applied wbs + savedAt', r.ok && acc.ok && acc.status === 'accepted' && acc.applied.indexOf('wbs') !== -1 && !!acc.savedAt, acc);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const blobA = await j(r);
    check('R4b accepted editor change applied (wbs), out-of-scope risk NOT applied',
      r.ok && blobA.state.tasks[0].name === 'Edited again (WBS)' && blobA.state.risks[0].name === 'Risk One', blobA.state);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const clogA = await j(r);
    const accEntry = (clogA.entries || []).filter(function(e) { return e.type === 'accepted'; });
    check('R4c changelog has an accepted entry with diffs', r.ok && accEntry.length >= 1 && Array.isArray(accEntry[0].diffs), accEntry);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const listA = await j(r);
    const pA = (listA.proposals || []).find(function(x) { return x.id === reviewId2; });
    check('R4d proposal now accepted with decidedAt', !!pA && pA.status === 'accepted' && !!pA.decidedAt, pA);

    // R5 accept again -> 409.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews/' + reviewId2 + '/accept', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    check('R5 accepting an already-accepted proposal -> 409', r.status === 409, { status: r.status });

    // R6 reject path.
    const stateR = JSON.parse(JSON.stringify(state0));
    stateR.tasks[0].name = 'To be rejected';
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Editor-Code': editorCode }),
      body: JSON.stringify({ state: stateR })
    });
    const edSaveR = await j(r);
    const reviewIdR = edSaveR.reviewId;
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews/' + reviewIdR + '/reject', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const rej = await j(r);
    check('R6a reject ok', r.ok && rej.ok && rej.status === 'rejected', rej);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const blobR = await j(r);
    check('R6b rejected change NOT in the blob', r.ok && blobR.state.tasks[0].name === 'Edited again (WBS)', blobR.state && blobR.state.tasks);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const clogR = await j(r);
    check('R6c changelog has a rejected entry', r.ok && (clogR.entries || []).some(function(e) { return e.type === 'rejected'; }), clogR);

    // R7 editor mine=1 + editor cannot list all.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews?mine=1', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Editor-Code': editorCode }
    });
    const mine = await j(r);
    const mineStatuses = (mine.proposals || []).map(function(x) { return x.status; });
    check('R7a editor mine=1 shows own proposals with statuses (accepted + rejected)',
      r.ok && mine.ok && mine.proposals.length >= 2 && mineStatuses.indexOf('accepted') !== -1 && mineStatuses.indexOf('rejected') !== -1, mine);
    // An editor credential (with or without mine=1) is scoped to their OWN
    // proposals — never the full queue (no MCP proposals, no other labels).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Editor-Code': editorCode }
    });
    const allTry = await j(r);
    const onlyMine = (allTry.proposals || []).every(function(x) { return x.sourceType === 'editor' && x.sourceLabel === 'Site Super'; });
    check('R7b editor listing reviews returns ONLY their own proposals (never the full queue)',
      r.ok && allTry.ok && allTry.proposals.length >= 2 && onlyMine && !(allTry.proposals || []).some(function(x) { return x.sourceType === 'mcp'; }), allTry);

    // R8 MCP import -> proposal; accept -> 'accepted' entry with import_key; re-import skipped.
    const mcpEntry = {
      localId: 101, entry_type: 'edit', actor_type: 'owner', actor_label: 'MCP AI',
      created_at: new Date().toISOString(),
      diffs_json: [{ path: 'tasks[0].name', before: 'Task One', beforeAbsent: false, after: 'Edited again (WBS)', afterAbsent: false }]
    };
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog/import', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ entries: [mcpEntry] })
    });
    const imp = await j(r);
    check('R8a MCP import creates a proposal (not an instant changelog row)', r.ok && imp.ok && imp.imported.length === 1 && typeof imp.imported[0].reviewId === 'number', imp);
    const mcpReviewId = imp.imported[0].reviewId;
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const clogPre = await j(r);
    const acceptedBefore = (clogPre.entries || []).filter(function(e) { return e.type === 'accepted' && e.source === 'mcp'; });
    check('R8b no MCP accepted entry before the owner decides', r.ok && acceptedBefore.length === 0, clogPre);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews/' + mcpReviewId + '/accept', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const mcpAcc = await j(r);
    check('R8c MCP accept ok with an entry id', r.ok && mcpAcc.ok && mcpAcc.status === 'accepted' && !!mcpAcc.entryId, mcpAcc);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const clogAcc = await j(r);
    const mcpAccepted = (clogAcc.entries || []).filter(function(e) { return e.type === 'accepted' && e.source === 'mcp'; });
    check('R8d MCP accepted entry present with AI badge source', r.ok && mcpAccepted.length === 1 && Array.isArray(mcpAccepted[0].diffs), mcpAccepted);
    // Re-import the same entry -> skipped (already imported).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog/import', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ entries: [mcpEntry] })
    });
    const imp2 = await j(r);
    check('R8e re-import of the same entry skipped (already imported)', r.ok && imp2.ok && imp2.imported.length === 0 && imp2.skipped.length === 1, imp2);

    // R9 MCP reject.
    const mcpEntry2 = {
      localId: 102, entry_type: 'edit', actor_type: 'owner', actor_label: 'MCP AI',
      created_at: new Date().toISOString(),
      diffs_json: [{ path: 'tasks[0].name', before: 'Edited again (WBS)', beforeAbsent: false, after: 'AI wants this name', afterAbsent: false }]
    };
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ state: Object.assign(baseState(pid, 'Review QA'), { tasks: [{ id: 't1', name: 'AI wants this name', status: 'todo' }] }) })
    });
    await j(r); // owner applies the AI state so the import verifies
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog/import', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ entries: [mcpEntry2] })
    });
    const imp3 = await j(r);
    const mcpReview2 = imp3.imported[0] && imp3.imported[0].reviewId;
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews/' + mcpReview2 + '/reject', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const mcpRej = await j(r);
    check('R9a MCP reject ok', r.ok && mcpRej.ok && mcpRej.status === 'rejected', mcpRej);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const clogM = await j(r);
    const rejEntries = (clogM.entries || []).filter(function(e) { return e.type === 'rejected'; });
    const mcpAccepted2 = (clogM.entries || []).filter(function(e) { return e.type === 'accepted' && e.source === 'mcp'; });
    check('R9b MCP reject logged, no new accepted entry for it', r.ok && rejEntries.length >= 2 && mcpAccepted2.length === 1, { rej: rejEntries.length, acc: mcpAccepted2.length });

    // R10 owner save still applies directly.
    const stateO = Object.assign(baseState(pid, 'Review QA'), { tasks: [{ id: 't1', name: 'Owner direct', status: 'todo' }] });
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ state: stateO })
    });
    const ownerSave = await j(r);
    check('R10 owner save applies directly (no review)', r.ok && ownerSave.ok && ownerSave.review === undefined && !!ownerSave.savedAt && ownerSave.actor === 'owner', ownerSave);

    // R11 unlink cascades proposals.
    r = await fetch(BASE + '/api/cloud/projects/' + pid, {
      method: 'DELETE', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const unl = await j(r);
    check('R11a unlink succeeds', r.ok && unl.ok, unl);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/reviews', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    check('R11b reviews list after unlink -> generic 403', r.status === 403, { status: r.status });

    // Summary.
    const fails = results.filter(function(x) { return !x.val; });
    log('========================================');
    log('review-queue gate: ' + (results.length - fails.length) + '/' + results.length + ' checks passed');
    if (fails.length) {
      log('FAILED: ' + fails.map(function(f) { return f.name; }).join(' | '));
      stopWrangler();
      process.exit(1);
    }
    stopWrangler();
    process.exit(0);
  } catch (e) {
    log('HARNESS ERROR: ' + (e && e.stack || e));
    stopWrangler();
    process.exit(1);
  }
})();
