/* ============================================================
   QA-STRESS — Full stress battery beyond the per-rank gates.
   (WORKABILITY-AND-RETENTION-PRIORITY-DIRECTIVES v1.0)
   Drives headless Chrome against http://127.0.0.1:8765.

   DIR-1  Two-device merge stress: divergent offline edits,
          deliberate same-field conflicts, tie handling, undo,
          round-trip no-stamp-inflation, UI wiring.
   DIR-2  Messy voice-to-claim: jobsite-garbled transcript ->
          rule extraction -> claim pack (degradation logged);
          RUN_WHISPER=1 additionally runs the REAL whisper WASM
          against a synthesized noisy/overlapped meeting WAV.
   DIR-3  AI presets on a MESSY project (conflicting dates,
          incomplete risks, budget overruns, missing charter):
          zero-fabrication trace gate, audit correctness, per-
          preset local-tier usability findings.
   DIR-4  Durability: reload-mid-edit flush, hard SIGKILL with
          journal restore (the crash case), real, not simulated
          in a gate.

   Any uncaught page exception or console.error fails the run.
   Exit 0 only when every contract holds.
   Usage: node qa-stress.cjs        (server on :8765)
          RUN_WHISPER=1 node qa-stress.cjs   (+ real whisper run)
   ============================================================ */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromePath: CHROME, BASE } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(os.tmpdir(), 'mmgr-stress-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const pageErrors = [];
const log = (s) => { process.stdout.write('[stress] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 600000);

function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

async function bootChrome(port, profile, url) {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const pages = targets.filter(t => t.type === 'page');
  log('boot: ' + pages.length + ' page target(s): ' + pages.map(t => t.url).join(' | '));
  ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      pageErrors.push('exception: ' + (d && d.text) + (d && d.exception ? ' ' + (d.exception.description || '') : ''));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
      const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : a.description).join(' ');
      pageErrors.push('console.error: ' + args);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: url || (BASE + '/seed-test.html') });
  await delay(4000);
  return proc;
}

function hardKill(proc) {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /T /PID ' + proc.pid, { stdio: 'ignore' });
    } else {
      process.kill(proc.pid, 'SIGKILL');
    }
  } catch (e) { try { proc.kill('SIGKILL'); } catch (e2) {} }
}

(async () => {
  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  let proc = await bootChrome(9244, PROFILE);

  // ============================================================
  // DIR-1 — TWO-DEVICE MERGE STRESS
  // ============================================================
  log('---- DIR-1: two-device merge stress ----');

  // Seed a realistic project ("device A and B both start here").
  await ev(`(function(){
    MMGR.State.clearProject();
    MMGR.State.updateState(function(s){
      s.projectName = 'Harbor View Retail Fit-Out';
      s.charter.name = 'Harbor View Retail Fit-Out';
      s.charter.targetCompletion = '2026-12-15';
      s.budgetEnvelope = 480000;
      s.ldRate = 2500;
      s.tasks = [
        { id: 'a1', name: 'Demolition', status: 'completed', startDate: '2026-06-01', endDate: '2026-06-20', duration: '15', critical: false },
        { id: 'a2', name: 'MEP Rough-In', status: 'inprogress', startDate: '2026-06-22', endDate: '2026-08-05', duration: '32', critical: true },
        { id: 'a3', name: 'Storefront Glazing', status: 'todo', startDate: '2026-08-10', endDate: '2026-09-18', duration: '28', critical: false }
      ];
      s.budgetLines = [ { id: 'b1', name: 'Demolition', planned: 40000, actual: 41200 }, { id: 'b2', name: 'MEP', planned: 120000, actual: 95000 } ];
      s.risks = [ { id: 'r1', description: 'Glazing lead time', probability: 'Medium', impact: 'High', mitigation: 'Order early' } ];
    });
    return true;
  })()`);
  await delay(400);
  // Field-level LWW means two devices must NOT both write the same top-level
  // field for a zero-loss merge, so A and B deliberately edit DISJOINT fields:
  //   A edits: budgetLines, risks, weatherLog
  //   B edits: tasks, stakeholders, projectName, theme, workWeek
  // Every field adopts cleanly; no field has two writers (the true
  // "non-conflicting" offline case).
  //
  // Device A's offline edits.
  await ev(`(function(){
    MMGR.State.updateState(function(s){
      s.budgetLines[0].actual = 42500;
      s.risks[0].mitigation = 'Order early; dual-source';
      s.weatherLog = [ { date: '2026-07-14', condition: 'heavy rain', note: 'Pour halted', affectedTaskIds: ['a2'] } ];
    });
    return true;
  })()`);
  await delay(700); // let the debounced save settle — deterministic, no timer races
  // Freeze A's stamps: its 3 edited fields at July 15, everything else at
  // the July 14 base. Freezing only touches fieldTs/updatedAt (merge
  // metadata, not tracked fields) so save() never re-stamps it.
  await ev(`(function(){
    MMGR.State.updateState(function(s){
      Object.keys(s.fieldTs || {}).forEach(function(k){ s.fieldTs[k] = '2026-07-14T08:00:00.000Z'; });
      ['budgetLines','risks','weatherLog'].forEach(function(k){ s.fieldTs[k] = '2026-07-15T10:00:00.000Z'; });
      s.updatedAt = '2026-07-15T10:00:00.000Z';
    });
    return true;
  })()`);
  await delay(300);
  const exportA = await ev('MMGR.State.exportState()');

  // Device B's file: derived from A's export with A's edits reverted (B
  // never saw them) and its OWN edits on DIFFERENT fields. B's stamps are
  // frozen — its 5 fields at July 16, everything else at July 13 (older
  // than A's base) so the merge never lets B's untouched copies beat A's
  // real work. Built as pure JSON — the app stays on DEVICE A's state the
  // whole time (the faithful two-device shape), so no import dance.
  const exportB = await ev('(function(){ var a = ' + JSON.stringify(exportA) + '; var b = JSON.parse(a); b.budgetLines[0].actual = 41200; b.risks[0].mitigation = "Order early"; b.weatherLog = []; b.tasks[2].name = "Storefront Glazing (cladded system)"; b.tasks[2].assignee = "Reyes Glass"; b.stakeholders = [ { id: "sh1", name: "Reyes Glass", role: "Subcontractor" } ]; b.projectName = "Harbor View Retail Fit-Out (B)"; b.theme = "dark"; b.workWeek = 6; b.updatedAt = "2026-07-16T09:10:00.000Z"; Object.keys(b.fieldTs || {}).forEach(function(k){ b.fieldTs[k] = "2026-07-13T00:00:00.000Z"; }); ["tasks","stakeholders","projectName","theme","workWeek"].forEach(function(k){ b.fieldTs[k] = "2026-07-16T09:00:00.000Z"; }); return JSON.stringify(b); })()');

  // Device A merges B's file. The merge AND the post-merge read happen in
  // ONE evaluation so no pending debounce timer can interleave.
  const merged = await ev('(function(){ var b = ' + JSON.stringify(exportB) + '; var out = MMGR.State.mergeExternal(JSON.parse(b)); var s = MMGR.State.getState(); var r = { adopted: out.adopted, report: out.report, aActual: s.budgetLines[0].actual, aMitigation: s.risks[0].mitigation, weatherLog: (s.weatherLog || []).length, bTaskName: s.tasks[2].name, bAssignee: s.tasks[2].assignee, bStakeholder: (s.stakeholders || []).length, bTheme: s.theme, bWorkWeek: s.workWeek, bProject: s.projectName }; return r; })()');
  await delay(700);
  const st1 = merged;
  const aOk = st1.aActual === 42500 && st1.aMitigation === 'Order early; dual-source' && st1.weatherLog === 1;
  const bOk = st1.bTaskName.indexOf('cladded') > -1 && st1.bAssignee === 'Reyes Glass' && st1.bStakeholder === 1 && st1.bTheme === 'dark' && st1.bWorkWeek === 6 && st1.bProject.indexOf('(B)') > -1;
  check('S01 two-device: non-conflicting offline edits merge with ZERO data loss (A and B both kept)', aOk && bOk, st1);
  check('S02 merge: report counts adoptions and names each field', st1 && st1.adopted >= 4 && Array.isArray(st1.report) && st1.report.some(r => r.field === 'stakeholders' && r.side === 'incoming'), st1 && { adopted: st1.adopted, fields: st1.report.map(r => r.field + ':' + r.side) });

  // Deliberate conflict — same field (tasks), both sides edit:
  // A edits at 12:00 (July 17), incoming B copy edits at 11:00 -> A kept.
  const conflict = await ev(`(function(){
    MMGR.State.updateState(function(s){ s.tasks[2].endDate = '2026-09-25'; });
    MMGR.State.updateState(function(s){ s.fieldTs.tasks = '2026-07-17T12:00:00.000Z'; s.updatedAt = '2026-07-17T12:00:00.000Z'; });
    var inc = JSON.parse(MMGR.State.exportState());
    inc.tasks[2].endDate = '2026-09-10';
    inc.fieldTs.tasks = '2026-07-17T11:00:00.000Z';
    inc.updatedAt = '2026-07-17T11:30:00.000Z';
    var out = MMGR.State.mergeExternal(inc);
    var s2 = MMGR.State.getState();
    var reportField = (out.report || []).filter(function(r){ return r.field === 'tasks'; })[0];
    return { adopted: out.adopted, keptA: s2.tasks[2].endDate === '2026-09-25', side: reportField && reportField.side };
  })()`);
  check('S03 conflict: newer local edit wins the same-field conflict; conflict not silently overwritten', conflict.keptA === true && conflict.adopted === 0 && conflict.side === 'local', conflict);

  // Reverse conflict: incoming genuinely newer -> adopted, older side loses
  // to the NEWER edit (surfaced in the report).
  const conflict2 = await ev(`(function(){
    var inc = JSON.parse(MMGR.State.exportState());
    inc.tasks[2].endDate = '2026-09-30';
    inc.fieldTs.tasks = '2026-07-18T09:00:00.000Z';
    inc.updatedAt = '2026-07-18T09:00:00.000Z';
    var out = MMGR.State.mergeExternal(inc);
    var s2 = MMGR.State.getState();
    var f = (out.report || []).filter(function(r){ return r.field === 'tasks'; })[0];
    return { adopted: out.adopted, won: s2.tasks[2].endDate === '2026-09-30', side: f && f.side };
  })()`);
  check('S04 conflict-reverse: genuinely newer other-device edit IS adopted (LWW by timestamp)', conflict2.adopted === 1 && conflict2.won && conflict2.side === 'incoming', conflict2);

  // Tie: identical timestamps never lose local data.
  const tie = await ev(`(function(){
    var inc = JSON.parse(MMGR.State.exportState());
    inc.tasks[2].endDate = '2026-10-01';
    inc.fieldTs.tasks = '2026-07-18T09:00:00.000Z';
    inc.updatedAt = '2026-07-18T09:00:00.000Z';
    var before = MMGR.State.getState().tasks[2].endDate;
    var out = MMGR.State.mergeExternal(inc);
    var after = MMGR.State.getState().tasks[2].endDate;
    return { before: before, after: after, adopted: out.adopted };
  })()`);
  check('S05 tie: identical timestamp keeps LOCAL value (never loses local on a tie)', tie.before === '2026-09-30' && tie.after === '2026-09-30' && tie.adopted === 0, tie);

  // Merge is undoable back to the exact pre-merge state.
  // TIME-BOMB FIX (2026-08-11): the incoming stamp was a hardcoded past date
  // (2026-08-09) that the real clock eventually overtook, so "incoming newer"
  // no longer held and the merge (correctly) kept local — the test then
  // failed and its undo() popped an OLDER stack entry. The stamp is now
  // relative to the running clock (+1 min), so the merge always adopts and
  // its own undo point is the one restored. The merge CODE was verified
  // correct by S03/S04/S05 (the LWW conflict/tie checks); this was a test
  // artifact, not an app bug.
  const undoCheck = await ev(`(function(){
    MMGR.State.updateState(function(s){ s.projectName = 'Harbor View (pre-undo)'; });
    var inc = JSON.parse(MMGR.State.exportState());
    inc.projectName = 'Harbor View (merged in)';
    inc.fieldTs.projectName = new Date(Date.now() + 60000).toISOString();
    MMGR.State.mergeExternal(inc);
    var merged = MMGR.State.getState().projectName;
    var undone = MMGR.State.undo();
    var afterUndo = MMGR.State.getState().projectName;
    return { merged: merged, undone: undone, afterUndo: afterUndo };
  })()`);
  check('S06 undo: a merge is undoable back to the exact pre-merge state', undoCheck.merged === 'Harbor View (merged in)' && undoCheck.undone === true && undoCheck.afterUndo === 'Harbor View (pre-undo)', undoCheck);

  // Round-trip / no stamp inflation: B edits the same field again (newer),
  // A merges, A does its own save in between, then merges again — B's
  // second edit must still win.
  // TIME-BOMB FIX (2026-08-11): B's stamps were hardcoded to 2026-08-10/11,
  // so once the real clock passed them the "newer" side stopped being newer
  // (o1=o2=0, nothing adopted). Stamps are now Date.now()-relative (+1h,
  // +2h) so B edit 1 is always newer than the base and B edit 2 always newer
  // than B edit 1 AND A's intervening workWeek save — the round-trip and
  // no-stamp-inflation contract still holds on any run date.
  const roundTrip = await ev(`(function(){
    MMGR.State.updateState(function(s){ s.projectName = 'Harbor View (base)'; });
    var b1 = new Date(Date.now() + 3600000).toISOString();
    var out1 = MMGR.State.mergeExternal(JSON.parse('{"schemaVersion":' + MMGR.State.SCHEMA_VERSION + ',"updatedAt":"' + b1 + '","fieldTs":{"projectName":"' + b1 + '"},"projectName":"Harbor View (B edit 1)"}'));
    MMGR.State.updateState(function(s){ s.workWeek = 5; }); // A works on in between
    var b2 = new Date(Date.now() + 7200000).toISOString();
    var out2 = MMGR.State.mergeExternal(JSON.parse('{"schemaVersion":' + MMGR.State.SCHEMA_VERSION + ',"updatedAt":"' + b2 + '","fieldTs":{"projectName":"' + b2 + '"},"projectName":"Harbor View (B edit 2)"}'));
    var final = MMGR.State.getState().projectName;
    return { o1: out1.adopted, o2: out2.adopted, final: final };
  })()`);
  check('S07 round-trip: second merge adopts B\'s newer edit despite A\'s intervening save (no stamp inflation)', roundTrip.o1 === 1 && roundTrip.o2 === 1 && roundTrip.final === 'Harbor View (B edit 2)', roundTrip);

  // UI wiring: merge entry point + handler + API on project.html.
  const ui = await ev(`(function(){
    var html = document.body ? document.body.innerHTML : '';
    var hasBtn = html.indexOf('Merge Project (.json)') > -1;
    var hasInput = !!document.getElementById('merge-file');
    var api = typeof window.MMGR.App.mergeProjectFile === 'function';
    var hasAction = !!document.querySelector('[data-action=mergeProjectFileClick]');
    return { hasBtn: hasBtn, hasInput: hasInput, api: api, hasAction: hasAction };
  })()`);
  check('S08 ui: Merge Project (.json) button + file input + handler + API wired', ui.hasBtn && ui.hasInput && ui.api && ui.hasAction, ui);

  // ============================================================
  // DIR-2 — MESSY VOICE-TO-CLAIM (degradation findings)
  // ============================================================
  log('---- DIR-2: messy voice-to-claim ----');

  // A realistically messy transcript: what whisper outputs from a noisy
  // jobsite recording — overlapped speech, machinery interjections,
  // misheard jargon, stutters, filler.
  const MESSY = "uh okay so we're gonna go over the job real quick, um the foundation pour was supposed to start Tuesday but the concrete supplier says the mix design review slipped, i'll chase the revised shop drawings by Friday before the pour window closes, we agreed to move the rebar delivery up a week to cover the delay, the crane is on site but the lift plan review is still pending with the structural engineer, that's blocking the steel erection, crane beeping in background, foreman what's the crew status, we got ten guys on the scaffold today drywall rough in is about sixty percent done in the east wing, the water table is high and the pump has been running non stop, so excavation is behind by three days, i'll need the revised shoring plan by Monday to keep the trench open, otherwise the inspector shuts us down, someone needs to order the sealant for the curtain wall, the supplier quote expires end of month, payroll is due did you get the timesheets, um i'll handle the permits, inspector coming at two";

  const messyExtract = await ev(`(function(){
    var res = MMGR.Voice.extractFromTranscript('${MESSY.replace(/'/g, "\\'").replace(/\n/g, ' ')}');
    return res;
  })()`);
  const act = messyExtract.actions || [];
  const dec = messyExtract.decisions || [];
  const find = (arr, needle) => arr.filter(a => a.text.toLowerCase().indexOf(needle) > -1).length;
  check('M01 messy extract: action items still recovered from garbled transcript', find(act, 'shop drawings') === 1 && find(act, 'shoring plan') === 1 && find(act, 'sealant') === 1, act.map(a => a.text));
  check('M02 messy extract: decision ("we agreed") recovered', find(dec, 'rebar delivery') === 1, dec.map(d => d.text));

  // Full pipeline into state: end a meeting with the messy transcript, then
  // build the claim pack — must pull the extracted decisions + slips live.
  const messyPipe = await ev(`(function(){
    MMGR.Meetings.startMeeting('weekly');
    MMGR.State.updateState(function(s){
      s.activeMeeting.transcript = '${MESSY.replace(/'/g, "\\'").replace(/\n/g, ' ')}';
    });
    MMGR.Meetings.endMeeting();
    var s = MMGR.State.getState();
    s.baseline = { tasks: JSON.parse(JSON.stringify(s.tasks)), budgetLines: JSON.parse(JSON.stringify(s.budgetLines)), budgetEnvelope: s.budgetEnvelope, capturedAt: '2026-07-01T00:00:00.000Z' };
    s.tasks[1].endDate = '2026-08-08';
    var p = MMGR.Claim.buildClaimPack(s, '2026-07-01', '2026-08-31');
    return {
      promises: ((s.meetingPromises || {}).weekly || []).map(function(x){ return x.text; }),
      log: (s.logEntries || []).map(function(x){ return x.decision || x.text || ''; }),
      slips: (p.slips || []).map(function(x){ return { name: x.taskName, days: x.days, cause: x.cause }; }),
      ld: p.ldRollup
    };
  })()`);
  check('M03 claim: messy meeting\'s decisions land in Decision Log', (messyPipe.log || []).some(l => l.indexOf('rebar delivery') > -1), messyPipe.log);
  check('M04 claim: messy meeting\'s actions land in Meeting-to-Action promises', (messyPipe.promises || []).some(t => t.indexOf('shop drawings') > -1), messyPipe.promises);
  check('M05 claim: slips derived baseline-vs-current with cause tag (never blank)', (messyPipe.slips || []).some(x => x.days === 3 && x.cause && x.cause.length > 0), messyPipe.slips);

  // ============================================================
  // DIR-3 — AI PRESETS ON A MESSY PROJECT (per-preset findings)
  // ============================================================
  log('---- DIR-3: AI presets on a messy project (local tier) ----');
  await ev(`(function(){
    MMGR.AiWin.setAiCfg({ tier: 'local', provider: 'openai' });
    MMGR.State.updateState(function(s){
      // Messy, realistic state: conflicting dates, orphan task, missing
      // risk fields, budget actual over envelope, empty charter name.
      s.charter.name = '';
      s.charter.objective = 'Fit-out a retail unit';
      s.charter.targetCompletion = '2026-12-15';
      s.budgetEnvelope = 480000;
      s.ldRate = 2500;
      s.tasks = [
        { id: 'm1', name: 'Demolition', status: 'completed', startDate: '2026-06-01', endDate: '2026-06-20' },
        { id: 'm2', name: 'MEP Rough-In', status: 'inprogress', startDate: '2026-06-22', endDate: '2026-08-05', critical: true },
        { id: 'm3', name: 'Storefront Glazing', status: 'todo', startDate: '2026-09-10', endDate: '2026-09-01', critical: false },
        { id: 'm4', name: 'Orphan Task', status: 'todo', startDate: '2026-07-01', endDate: '2026-07-15', parentId: 'no-such-parent' },
        { id: 'm5', name: 'Predecessor Ghost', status: 'todo', startDate: '2026-07-02', endDate: '2026-07-16', predecessors: ['ghost'] }
      ];
      s.budgetLines = [
        { id: 'mb1', name: 'Demolition', planned: 40000, actual: 39000 },
        { id: 'mb2', name: 'MEP', planned: 120000, actual: 515000 }
      ];
      s.risks = [
        { id: 'mr1', description: 'Glazing lead time slips', probability: 'Medium', impact: 'High', mitigation: 'Order early' },
        { id: 'mr2', description: 'Unspecified vendor risk', probability: '', impact: '', mitigation: '' },
        { id: 'mr3', description: 'Water table is high maybe something about dewatering unclear', probability: 'High', impact: 'Medium' }
      ];
      s.weatherLog = [ { date: '2026-07-14', condition: 'heavy rain', note: 'Pour halted', affectedTaskIds: ['m2'] } ];
    });
    return true;
  })()`);
  await delay(400);

  const PRESETS = ['report', 'forecast', 'risk', 'digest', 'health', 'audit', 'change', 'client', 'daily'];
  for (const p of PRESETS) {
    await ev(`(async function(){ try { return await MMGR.AiWin.runPreset('${p}'); } catch (e) { return { ok:false, error: String(e && e.message || e) }; } })()`);
    await delay(150);
  }
  const stateAfter = await ev(`(function(){ var s = MMGR.State.getState(); var out = {}; Object.keys(s.aiOutputs || {}).forEach(function(k){ out[k] = { tier: s.aiOutputs[k].tier, len: (s.aiOutputs[k].text || '').length, trace: (s.aiOutputs[k].trace || []).length, text: s.aiOutputs[k].text }; }); return out; })()`);

  const allWrote = PRESETS.every(p => stateAfter[p] && stateAfter[p].len > 0);
  check('P01 presets: all 9 run on the local tier and write structured output to state', allWrote, Object.keys(stateAfter));
  check('P02 presets: every output carries a trace (zero-fabrication gate)', PRESETS.every(p => stateAfter[p] && stateAfter[p].trace > 0), Object.keys(stateAfter).map(k => k + ':' + stateAfter[k].trace));

  const auditText = stateAfter.audit ? stateAfter.audit.text : '';
  check('P03 audit correctness: catches the reversed start/end task on messy data', auditText.indexOf('m3') > -1 && auditText.toLowerCase().indexOf('end before start') > -1, auditText.slice(0, 300));
  check('P04 risk resilience: incomplete/ambiguous risks render without crash or blanking the register', stateAfter.risk && stateAfter.risk.text.indexOf('Unspecified vendor risk') > -1 && stateAfter.risk.text.indexOf('—') > -1, stateAfter.risk && stateAfter.risk.text.slice(0, 300));
  check('P05 budget honesty: report reflects the actual-over-envelope overrun from state (no invented figure)', stateAfter.report && stateAfter.report.text.indexOf('554,000') > -1 && stateAfter.report.text.indexOf('480,000') > -1, stateAfter.report && stateAfter.report.text.slice(0, 400));

  const ff = await ev(`(async function(){ return await MMGR.AiWin.submit('what is overdue?', null, { tier: 'local' }); })()`);
  check('P06 free-form: local lookup answered from state (grounded)', ff.ok === true && typeof ff.text === 'string' && ff.text.length > 0, ff);

  const cloudNoKey = await ev(`(async function(){
    var before = MMGR.State.exportState();
    MMGR.AiWin.setAiCfg({ tier: 'cloud', provider: 'openai', apiKey: '', endpoint: '' });
    var r = await MMGR.AiWin.submit('anything', null, {});
    MMGR.AiWin.setAiCfg({ tier: 'local', provider: 'openai', apiKey: null, endpoint: null });
    var after = MMGR.State.exportState();
    // The failed call appends to state.errorLog (the client error surface —
    // correct, desired behavior), so strip config.ai AND errorLog from the
    // comparison: the test is about PROJECT DATA integrity.
    var strip = function(j){ var o = JSON.parse(j); if (o.config && o.config.ai) delete o.config.ai; o.errorLog = []; o.updatedAt = ''; o.fieldTs = {}; o.lastBackedUpAt = ''; return JSON.stringify(o); };
    return { ok: r.ok, hasError: !!(r.error && r.error.length), stateIntact: strip(before) === strip(after), tier: r.tier };
  })()`);
  check('P07 cloud-no-key: clean circuit-break error, project state untouched', cloudNoKey.ok === false && cloudNoKey.hasError && cloudNoKey.stateIntact, cloudNoKey);

  // Log the per-preset usability findings (DIR-3 asks for these).
  log('--- DIR-3 findings (local tier, messy project) ---');
  for (const p of PRESETS) {
    const o = stateAfter[p];
    log('  preset[' + p + '] tier=' + (o && o.tier) + ' len=' + (o && o.len) + ' trace=' + (o && o.trace));
  }

  // ============================================================
  // DIR-4 — DURABILITY (real, beyond the gates)
  // ============================================================
  log('---- DIR-4: durability ----');

  // D01: reload mid-edit (before the 300ms debounce) — the unload flush
  // must land the last keystroke.
  await ev(`(function(){
    MMGR.State.updateState(function(s){ s.userName = 'Grace-Stress-Edited'; });
    return true;
  })()`);
  await send('Page.reload', {});
  await delay(3500);
  const d01state = await ev('(function(){ var s = MMGR.State.getState(); return { user: s.userName }; })()');
  check('D01 reload-mid-edit: edit made just before reload survives (unload flush)', d01state.user === 'Grace-Stress-Edited', d01state);

  // D02: HARD KILL (SIGKILL, no unload event) inside the debounce window —
  // only the IndexedDB journal can carry the last edit. Real kill, real
  // relaunch on the same profile.
  await ev(`(function(){
    MMGR.State.updateState(function(s){ s.userName = 'Grace-Crash-Edited'; });
    return true;
  })()`);
  await delay(150); // journal write lands; the 300ms debounce has NOT fired
  // Confirm the journal actually holds the crash edit BEFORE the kill (so a
  // failure is attributable to restore, not to a too-fast kill).
  const jBefore = await ev('(async function(){ var r = await MMGR.State.journalGet(); if (!r || !r.json) return null; try { return JSON.parse(r.json).userName; } catch(e){ return null; } })()');
  log('D02 pre-kill journal holds: ' + jBefore);
  hardKill(proc);
  await delay(2000);
  // Clean Chrome singleton locks left by the unclean kill so the same
  // profile reopens cleanly (this is the crash-recovery relaunch).
  try {
    fs.readdirSync(PROFILE).filter(function(f){ return f.indexOf('Singleton') === 0; }).forEach(function(f){
      try { fs.unlinkSync(path.join(PROFILE, f)); } catch (e) {}
    });
  } catch (e) {}
  log('hard-killed Chrome mid-debounce — relaunching on same profile...');
  // NOTE: relaunch DIRECTLY onto the project page — seed-test.html would
  // clobber localStorage with the legacy v5 demo seed (it rewrites the key
  // on every load), which would make the journal look older than the LS
  // record and mask the crash-restore. Real users never hit that page.
  proc = await bootChrome(9245, PROFILE, BASE + '/project.html?id=demo-project');
  const d02 = await ev(`(function(){
    var key = MMGR.State.getProjectKey();
    var raw = localStorage.getItem(key);
    var lsUser = null;
    try { if (raw) lsUser = JSON.parse(raw).userName; } catch (e) {}
    return { user: MMGR.State.getState().userName, lsUser: lsUser, lsLen: raw ? raw.length : 0 };
  })()`);
  log('D02 post-relaunch state: ' + JSON.stringify(d02));
  check('D02 hard-kill mid-edit: last edit restored via journal on relaunch (real crash case)', d02.user === 'Grace-Crash-Edited', d02);
  hardKill(proc);
  await delay(1000);
  proc = await bootChrome(9246, PROFILE);

  // ============================================================
  // RUN_WHISPER=1 — REAL whisper on the messy synthesized recording
  // ============================================================
  if (process.env.RUN_WHISPER === '1') {
    log('RUN_WHISPER=1 — real offline whisper on messy-meeting.wav (31.6s noisy/overlapped)...');
    const messyWav = 'vendor/whisper/samples/messy-meeting.wav';
    const wavExists = fs.existsSync(path.join(__dirname, messyWav));
    check('W01 real: messy-meeting.wav synthesized and present', wavExists === true, messyWav);
    if (wavExists) {
      // Headless Chrome has no microphone: mock MediaRecorder + getUserMedia
      // in-page (same pattern as qa-voice) so the REAL capture -> chunk ->
      // IndexedDB -> whisper path runs end to end.
      await ev(`(function(){
        window.__fakeStream = { getTracks: function(){ return [{ stop: function(){} }]; } };
        try {
          Object.defineProperty(navigator, 'mediaDevices', {
            value: { getUserMedia: function(){ return Promise.resolve(window.__fakeStream); } },
            configurable: true, writable: true
          });
        } catch(e) {}
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;
        window.MediaRecorder = function FakeMediaRecorder(stream, opts){
          var self = this; self.state = 'inactive'; self._opts = opts || {};
          self.start = function(ts){ self._ts = ts; self.state = 'recording'; };
          self.stop = function(){ if (self.state === 'inactive') return; self.state = 'inactive'; if (self.onstop) self.onstop(); };
        };
        return true;
      })()`);
      const wr = await ev(`(async function(){
        MMGR.Meetings.startMeeting('weekly');
        var started = await MMGR.Voice.startCapture();
        return { started: started, sid: MMGR.State.getState().activeMeeting.captureSession };
      })()`);
      await delay(500);
      const wsid = wr && wr.sid;
      log('W02 capture probe: ' + JSON.stringify(wr));
      const staged = await ev(`(async function(){ var b = await (await fetch("${messyWav}")).blob(); return await MMGR.Voice.appendChunk("${wsid}", b); })()`);
      check('W02 real: messy wav staged as a session chunk via IndexedDB', wr && wr.started === true && staged === true && wsid, { started: wr && wr.started, staged: staged, wsid: wsid });
      await ev('MMGR.Voice.stopCapture(); MMGR.Meetings.endMeeting();');
      let done = false, tx = '';
      let lastState = null;
      for (let i = 0; i < 150 && !done; i++) {
        await delay(2000);
        const st = await ev(`(function(){ var s = MMGR.State.getState(); var m = (s.meetings || []).find(function(x){ return x.captureSession === '${wsid}'; }); var t1 = MMGR.Voice.tier1Status(); return { t: m ? m.transcript : '', busy: t1.transcribing, ts: m ? m.transcribeState : null, t1ready: t1.ready, t1src: t1.modelSource, t1err: t1.error, chunks: null }; })()`);
        lastState = st;
        if (st && st.t && st.t.length > 15) { done = true; tx = st.t; }
        else if (st && !st.busy && (st.ts === 'failed' || st.ts === 'idle')) break;
      }
      const wdiag = await ev(`(function(){ var s = MMGR.State.getState(); var m = (s.meetings || []).find(function(x){ return x.captureSession === '${wsid}'; }); return { ts: m ? m.transcribeState : null, cm: m ? m.captureMethod : null, tlen: m ? (m.transcript || '').length : 0, errs: (s.errorLog || []).filter(function(e){ return String(e.msg || e.message || '').indexOf('voice') > -1 || String(e.msg || e.message || '').indexOf('tier1') > -1; }).slice(-4).map(function(e){ return e.msg || e.message; }) }; })()`);
      log('W03 diagnostics: lastPoll=' + JSON.stringify(lastState) + ' diag=' + JSON.stringify(wdiag));
      check('W03 real: whisper transcribed the MESSY recording (noise + overlap) to a transcript', done === true && tx.length > 15, { done: done, len: tx.length, diag: wdiag });
      log('--- DIR-2 messy transcript (whisper, real) ---');
      log(tx.slice(0, 900));
      const lower = tx.toLowerCase();
      const terms = { 'rebar': 'rebar delivery', 'shoring': 'shoring plan', 'sealant': 'curtain wall sealant', 'crane': 'crane lift plan', 'drawings': 'shop drawings' };
      for (const k of Object.keys(terms)) {
        const hit = lower.indexOf(k) > -1;
        log('  degradation: term "' + terms[k] + '" ' + (hit ? 'SURVIVED' : 'LOST/mangled'));
      }
      const realPipe = await ev(`(function(){
        var s = MMGR.State.getState();
        var m = (s.meetings || []).find(function(x){ return x.captureSession === '${wsid}'; });
        if (!m) return { noMeeting: true };
        var res = MMGR.Voice.applyExtractionToState(m);
        var p = MMGR.Claim.buildClaimPack(s, '2026-07-01', '2026-12-31');
        return { decisions: res.decisions.length, actions: res.actions.length, claimslips: (p.slips || []).length };
      })()`);
      check('W04 real: extraction + claim pack ran end-to-end on real whisper output', realPipe.noMeeting !== true && typeof realPipe.decisions === 'number', realPipe);
      log('  real-pipeline extraction: ' + JSON.stringify(realPipe));
    }
  } else {
    log('RUN_WHISPER=1 to also run the real whisper pipeline on the messy recording.');
  }

  // ============================================================
  // Wrap-up
  // ============================================================
  hardKill(proc);
  const failed = results.filter(r => !r.val);
  const realPageErrors = pageErrors.filter(e => e.indexOf('favicon') === -1);
  log('PAGE ERRORS: ' + (realPageErrors.length ? realPageErrors.join(' | ') : 'none'));
  log('STRESS_GATE ' + (failed.length === 0 && realPageErrors.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken checks, ' + realPageErrors.length + ' page errors)'));
  process.exit(failed.length === 0 && realPageErrors.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
