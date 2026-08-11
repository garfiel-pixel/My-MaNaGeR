/* ============================================================
   My MaNaGeR — FULL QA BATTERY (gap-list verification)
   Drives headless Chrome against http://127.0.0.1:8765
   and verifies every item in the gap list with evidence.
   Usage: node qa-full.cjs  (server must be running on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9228;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-qa-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
let consoleErrors = [];
let pageErrors = [];
const log = (s) => { process.stdout.write(s + '\n'); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG TIMEOUT'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 240000);

function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => { pending.delete(id); res(m.result || {}); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const desc = r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text;
    return { __err: desc };
  }
  return r.result && r.result.value;
}
async function check(name, expr, expected, hint) {
  // RIGOROUS: an expression MUST return {val: true} (or match `expected`)
  // AND must not throw. val:false or undefined is a FAIL — never a pass.
  const v = await ev(expr);
  const want = expected === undefined ? true : expected;
  const ok = !!v && v.__err === undefined && v.val === want;
  const status = ok ? 'PASS' : 'FAIL';
  results.push({ status, name, detail: v && v.__err ? v.__err : JSON.stringify(v) });
  log(`[${status}] ${name}${ok ? '' : '  <-- ' + results[results.length - 1].detail + (hint ? ' (' + hint + ')' : '')}`);
  return v;
}

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {}
    await delay(300);
  }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || 'exception');
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/seed-test.html' });
  await delay(4500);

  // ---- BOOT ----
  await check('01 boot: MMGR + active dash panel', `(function(){return {val: !!(window.MMGR && MMGR.App && MMGR.State && document.querySelector('#panel-dash').classList.contains('active') && document.querySelectorAll('.panel').length === 19)};})()`);
  await check('01b boot: no boot failure banner', `(function(){var el=document.querySelector('div[style*="99999"]');return {val: !el};})()`);

  // ---- GAP 1: Theme + Crosshair toggles ----
  await check('02 theme: light default + checkbox reflects', `(function(){return {val: !document.body.classList.contains('dark-mode') && document.querySelector('#thm-tgl').checked};})()`);
  await ev(`document.querySelector('#thm-tgl').click()`); await delay(200);
  await check('02b theme: click -> dark + state', `(function(){return {val: document.body.classList.contains('dark-mode') && MMGR.State.getState().theme === 'dark' && !document.querySelector('#thm-tgl').checked};})()`);
  await ev(`document.querySelector('#thm-tgl').click()`); await delay(200);
  await check('02c theme: click again -> light (no double-toggle)', `(function(){return {val: !document.body.classList.contains('dark-mode') && MMGR.State.getState().theme === 'light'};})()`);
  await ev(`document.querySelector('#ch-tgl').click()`); await delay(200);
  await check('03 crosshair: toggle on -> class + state', `(function(){return {val: document.body.classList.contains('crosshair-on') && MMGR.State.getState().crosshairOn};})()`);
  await ev(`document.dispatchEvent(new MouseEvent('mousemove',{clientX:321,clientY:222}));`);
  await check('03b crosshair: mousemove moves #cx/#cy lines', `(function(){var cx=document.getElementById('cx'),cy=document.getElementById('cy');return {val: cx && cy && cx.style.top==='222px' && cy.style.left==='321px'};})()`);
  await ev(`document.querySelector('#ch-tgl').click()`); await delay(200);
  await check('03c crosshair: toggle off -> class gone', `(function(){return {val: !document.body.classList.contains('crosshair-on')};})()`);
  // Persistence across reload. NOTE: theme boot honors the device-level pref
  // (localStorage mmgr_theme — written by tglTheme and read by the launcher,
  // admin, and app) as the MASTER, with state.theme only the portable
  // fallback for a fresh device. The earlier toggle clicks above left the
  // pref at 'light', so a bare state write would be overridden on reload —
  // set the pref exactly like the real toggle does (both slots).
  await ev(`try{localStorage.setItem('mmgr_theme','dark');}catch(e){} MMGR.State.updateState(function(s){s.theme='dark';s.crosshairOn=true;});`); await delay(400);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);
  await check('04 persistence: dark + crosshair survive hard refresh', `(function(){return {val: document.body.classList.contains('dark-mode') && document.body.classList.contains('crosshair-on')};})()`);
  await ev(`MMGR.State.updateState(function(s){s.theme='light';s.crosshairOn=false;});`); await delay(300);

  // ---- GAP 2: Snapshot Now ----
  await ev(`MMGR.App.openPrompt('daily')`); await delay(200);
  await check('05 snapshot: Snapshot Now button appears in modal', `(function(){return {val: !!document.getElementById('snap-daily-btn')};})()`);
  await ev(`document.getElementById('snap-daily-btn').click()`); await delay(300);
  await check('05b snapshot: click writes dailySnapshot state', `(function(){var s=MMGR.State.getState();return {val: !!(s.dailySnapshot && s.dailySnapshot.date && s.dailySnapshot.taskStates && Object.keys(s.dailySnapshot.taskStates).length >= 5)};})()`);
  await check('05c snapshot: not shown for other prompt types', `(function(){MMGR.App.openPrompt('report');return {val: !document.getElementById('snap-daily-btn')};})()`);
  await ev(`document.querySelector('#om .dc').click()`); await delay(150);

  // ---- GAP 3+4: Lead-Time Tracker + Float Watch ----
  await ev(`MMGR.Schedule.cascade('northern-temperate',{threshold:999}); MMGR.Render.renderAll();`); await delay(500);
  await check('06 leadtime tracker: table renders with t3', `(function(){var b=document.getElementById('leadtime-tracker-body');var t=b?b.textContent:'';return {val: !!b && !!b.querySelector('.lt-table') && t.indexOf('Permit - Utility') > -1 && t.indexOf('Days Left') > -1};})()`);
  await check('07 float watch: renders critical/near-critical/crash sections', `(function(){var b=document.getElementById('float-watch-body');var t=b?b.textContent:'';return {val: !!b && (t.indexOf('Critical') > -1 || t.indexOf('healthy float') > -1 || t.indexOf('crash') > -1) && t.length > 30};})()`);

  // ---- GAP 5: Weather Variance inputs ----
  await check('08 wx: inputs present', `(function(){return {val: !!document.getElementById('wx-start') && !!document.getElementById('wx-end') && !!document.getElementById('wx-buffer')};})()`);
  await ev(`(function(){var st=document.getElementById('wx-start');var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(st,'2026-06-01');st.dispatchEvent(new Event('change',{bubbles:true}));})()`); await delay(250);
  await ev(`(function(){var en=document.getElementById('wx-end');var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(en,'2026-11-30');en.dispatchEvent(new Event('change',{bubbles:true}));})()`); await delay(250);
  await check('08b wx: change persists state + rerenders stats', `(function(){var s=MMGR.State.getState();var b=document.getElementById('weather-variance-body');return {val: s.wxWindow.start==='2026-06-01' && s.wxWindow.end==='2026-11-30' && !!b && !!b.querySelector('.wx-stat')};})()`);
  await ev(`(function(){var bf=document.getElementById('wx-buffer');var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(bf,'12');bf.dispatchEvent(new Event('change',{bubbles:true}));})()`); await delay(250);
  await check('08c wx: buffer persists', `(function(){return {val: MMGR.State.getState().wxWindow.bufferDays === 12};})()`);

  // ---- GAP 6+7: Schedule Confidence + Monte Carlo ----
  await check('09 confidence: 3-way card renders', `(function(){var b=document.getElementById('schedule-confidence-card');return {val: !!b && !!b.querySelector('.sc-grid') && b.querySelectorAll('.sc-cell').length === 3};})()`);
  await ev(`document.querySelector('[data-action=runMonteCarlo]').click()`); await delay(700);
  await check('10 monte carlo: result panel populates', `(function(){var res=document.getElementById('mc-result');return {val: !!res && res.style.display!=='none' && document.getElementById('mc-headline').textContent.length > 5 && document.getElementById('mc-percentiles').textContent.indexOf('P10') > -1 && document.getElementById('mc-dist-bar').children.length > 1};})()`);
  await check('10b monte carlo: headline probability when target set', `(function(){var h=document.getElementById('mc-headline').textContent;return {val: h.indexOf('probability') > -1 || h.indexOf('median') > -1};})()`);

  // ---- GAP 8: Kanban lead-time lane toggle ----
  await check('11 kanban lane: visible initially (seed kbShowLeadtime=true)', `(function(){return {val: document.getElementById('col-leadtime').style.display !== 'none'};})()`);
  await ev(`document.querySelector('[data-action=tglLeadtimeLane]').click()`); await delay(300);
  await check('11b kanban lane: toggle off -> hidden + state false', `(function(){return {val: document.getElementById('col-leadtime').classList.contains('is-hide') && MMGR.State.getState().kbShowLeadtime === false};})()`);
  await ev(`document.querySelector('[data-action=tglLeadtimeLane]').click()`); await delay(300);
  await check('11c kanban lane: toggle on -> visible + chip is-on', `(function(){var c=document.querySelector('[data-action=tglLeadtimeLane]');return {val: document.getElementById('col-leadtime').style.display !== 'none' && MMGR.State.getState().kbShowLeadtime === true && c.classList.contains('is-on')};})()`);
  await check('11d kanban lane: leadtime card shows expected/days-left/elapsed (monolith detail)', `(function(){var el=document.getElementById('kc-lt');var t=el?el.textContent:'';return {val: !!el && t.indexOf('Expected') > -1 && (t.indexOf('d left') > -1 || t.indexOf('OVERDUE') > -1) && t.indexOf('elapsed') > -1};})()`);
  await check('11e kanban drop guard: leadtime card refused in work column', `(function(){MMGR.App.dragCard({dataTransfer:{effectAllowed:'move'}},'t3');var before=MMGR.State.getState().tasks.find(function(t){return t.id==='t3';}).status;MMGR.App.dropCard({preventDefault:function(){}},'inprogress');var after=MMGR.State.getState().tasks.find(function(t){return t.id==='t3';}).status;var toast=document.querySelector('.toast');var ttxt=(toast?toast.textContent:'').toLowerCase();return {val: before===after && ttxt.indexOf('lead-time lane') > -1,before:before,after:after,toast:toast?toast.textContent:null};})()`);
  await check('11f kanban drop guard: normal card still moves', `(function(){MMGR.App.dragCard({dataTransfer:{effectAllowed:'move'}},'t4');var before=MMGR.State.getState().tasks.find(function(t){return t.id==='t4';}).status;MMGR.App.dropCard({preventDefault:function(){}},'blocked');var after=MMGR.State.getState().tasks.find(function(t){return t.id==='t4';}).status;return {val: before!==after && after==='blocked'};})()`);

  // ---- Interaction audit (P2): Kanban DOM-id contract + import refresh ----
  await check('11g kanban DOM-id contract: drops render into every real column + WIP counter', `(function(){
    var st = MMGR.State.getState();
    var id = 'qa-kan-' + Date.now();
    st.tasks.push({id:id, name:'QA Kanban Probe', level:0, indent:0, isPhase:false, status:'todo', startDate:'', endDate:'', duration:'', assignee:'', critical:false, leadTime:false, recurring:false, weatherExposed:false, milestone:false, confidence:'high', predecessors:[], notes:'', weatherSensitive:false});
    MMGR.Render.renderKanban();
    var map = {inprogress:'ip', blocked:'bl', completed:'dn'};
    var ok = true, results = {};
    ['inprogress','blocked','completed'].forEach(function(status){
      MMGR.App.dragCard({dataTransfer:{effectAllowed:'move'}}, id);
      MMGR.App.dropCard({preventDefault:function(){}}, status);
      var s2 = MMGR.State.getState();
      var rollup = {};
      s2.tasks.forEach(function(x){ if(x.parentName) rollup[x.parentName]=1; });
      var expected = s2.tasks.filter(function(t){ return (t.status||'todo')===status && !t.isPhase && !((t.level||0)===0 && rollup[t.name]); }).length;
      var colEl = document.getElementById('kc-'+map[status]);
      var wipEl = document.getElementById('w-'+map[status]);
      var rendered = colEl ? colEl.querySelectorAll('.kc').length : -1;
      results[status] = {expected:expected, rendered:rendered, wip:wipEl?wipEl.textContent:null};
      if(!colEl || !wipEl || rendered !== expected || wipEl.textContent !== String(expected)) ok = false;
    });
    var s3 = MMGR.State.getState();
    var phaseLeak = s3.tasks.filter(function(t){ return t.isPhase; }).some(function(ph){
      return ['kc-todo','kc-ip','kc-bl','kc-dn'].some(function(c){
        return document.querySelector('#'+c+' .kc[data-id="'+ph.id+'"]') !== null;
      });
    });
    if(phaseLeak) ok = false;
    s3.tasks = s3.tasks.filter(function(t){return t.id!==id;});
    MMGR.Render.renderAll();
    return {val: ok, results: results, phaseLeak: phaseLeak};
  })()`);
  await check('11h import: wiCommit refreshes Kanban + Dash; phases stay off the board', `(function(){
    var st0 = MMGR.State.getState();
    var before = st0.tasks.length;
    var rollup0 = {};
    st0.tasks.forEach(function(t){ if(t.parentName) rollup0[t.parentName]=1; });
    var beforeTodo = st0.tasks.filter(function(t){ return (t.status||'todo')==='todo' && !t.isPhase && !((t.level||0)===0 && rollup0[t.name]); }).length;
    var g0 = document.getElementById('gantt-labels') ? document.getElementById('gantt-labels').children.length : -1;
    var src = document.getElementById('wi-source');
    if(!src) return {val:false, why:'no wi-source'};
    src.value = 'QA Phase\\n  QA Task One\\n  QA Task Two\\n';
    MMGR.Tasks.wiCommit();
    var s = MMGR.State.getState();
    var after = s.tasks.length;
    var imp = s.tasks.filter(function(t){ return ['QA Phase','QA Task One','QA Task Two'].indexOf(t.name)>-1; });
    var ph = imp.filter(function(t){ return t.name==='QA Phase'; })[0];
    var kids = imp.filter(function(t){ return t.name!=='QA Phase'; });
    var wbsPresent = imp.length===3 && imp.every(function(t){return document.querySelector('#wbs-body tr.wbs-row[data-id="'+t.id+'"]') !== null;});
    var todoCards = document.getElementById('kc-todo') ? document.getElementById('kc-todo').querySelectorAll('.kc').length : -1;
    var wipTodo = document.getElementById('w-todo') ? document.getElementById('w-todo').textContent : null;
    var rollup = {};
    s.tasks.forEach(function(t){ if(t.parentName) rollup[t.parentName]=1; });
    var todoExpected = s.tasks.filter(function(t){ return (t.status||'todo')==='todo' && !t.isPhase && !((t.level||0)===0 && rollup[t.name]); }).length;
    var phSel = ['kc-todo','kc-ip','kc-bl','kc-dn'].map(function(c){ return '#'+c+' .kc[data-id="'+ph.id+'"]'; }).join(',');
    var phaseOffBoard = !!ph && document.querySelector(phSel) === null;
    var kidsOnBoard = kids.length===2 && kids.every(function(t){ return document.querySelector('#kc-todo .kc[data-id="'+t.id+'"]') !== null; });
    var dashLbl = document.getElementById('today-date-lbl') ? document.getElementById('today-date-lbl').textContent : '';
    var g1 = document.getElementById('gantt-labels') ? document.getElementById('gantt-labels').children.length : -1;
    var ganttOk = g0 > 0 && g1 === g0; // renderGantt ran; undated imports add no bars
    var ok = after === before + 3 && wbsPresent && todoCards === todoExpected && todoCards === beforeTodo + 2 && wipTodo === String(todoExpected) && phaseOffBoard && kidsOnBoard && dashLbl.length > 0 && ganttOk;
    var s2 = MMGR.State.getState();
    var names = ['QA Phase','QA Task One','QA Task Two'];
    s2.tasks = s2.tasks.filter(function(t){return names.indexOf(t.name)===-1;});
    MMGR.Render.renderAll();
    return {val: ok, before:before, after:after, imp:imp.length, wbsPresent:wbsPresent, todoCards:todoCards, todoExpected:todoExpected, beforeTodo:beforeTodo, wipTodo:wipTodo, phaseOffBoard:phaseOffBoard, kidsOnBoard:kidsOnBoard, dashLbl:dashLbl, g0:g0, g1:g1};
  })()`);
  await check('11i import: idCommit refreshes Gantt + Kanban + Dash', `(function(){
    var gl0 = document.getElementById('gantt-labels') ? document.getElementById('gantt-labels').children.length : -1;
    var src = document.getElementById('id-source');
    if(!src) return {val:false, why:'no id-source'};
    src.value = 'QA Dated (5 d) [2026-01-01 \\u2192 2026-01-05]';
    MMGR.Tasks.idCommit();
    var s = MMGR.State.getState();
    var dated = s.tasks.filter(function(t){return t.startDate==='2026-01-01';}).length;
    var rollup = {};
    s.tasks.forEach(function(t){ if(t.parentName) rollup[t.parentName]=1; });
    var todoExpected = s.tasks.filter(function(t){ return (t.status||'todo')==='todo' && !t.isPhase && !((t.level||0)===0 && rollup[t.name]); }).length;
    var todoCards = document.getElementById('kc-todo') ? document.getElementById('kc-todo').querySelectorAll('.kc').length : -1;
    var ganttLabels = document.getElementById('gantt-labels') ? document.getElementById('gantt-labels').children.length : -1;
    var dashLbl = document.getElementById('today-date-lbl') ? document.getElementById('today-date-lbl').textContent : '';
    var ok = dated === 1 && ganttLabels === gl0 + 1 && todoCards === todoExpected && dashLbl.length > 0;
    var s2 = MMGR.State.getState();
    s2.tasks = s2.tasks.filter(function(t){return t.name!=='QA Dated';});
    MMGR.Render.renderAll();
    return {val: ok, gl0:gl0, ganttLabels:ganttLabels, dated:dated, todoExpected:todoExpected, todoCards:todoCards, dashLbl:dashLbl};
  })()`);
  await check('11j wbs: click task name -> edit -> blur commits name (no jump)', `(function(){
    var secBtn = document.querySelector('.sec-btn[data-section=wbs]');
    if (secBtn) secBtn.click();
    MMGR.Render.renderWbs();
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){return x.name==='Foundations';});
    if(!t) return {val:false, why:'no Foundations task'};
    var id = t.id;
    var row = document.querySelector('#wbs-body tr[data-id="'+id+'"]');
    if(!row) return {val:false, why:'row not rendered'};
    var nameSpan = row.querySelector('.wbs-name');
    if(!nameSpan) return {val:false, why:'no .wbs-name span'};
    nameSpan.click();
    var inp = row.querySelector('input.wbs-name-input');
    if(!inp) return {val:false, why:'click did not start edit'};
    var focused = document.activeElement === inp;
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, 'Foundations (Edited)');
    // Synthetic blur: headless Chrome's blur() dispatches no event, but a real
    // click-away fires it — commit() is what the app listens for.
    inp.dispatchEvent(new Event('blur'));
    var s2 = MMGR.State.getState();
    var after = s2.tasks.find(function(x){return x.id===id;});
    var ok = focused && !!after && after.name === 'Foundations (Edited)';
    s2.tasks.find(function(x){return x.id===id;}).name = 'Foundations';
    MMGR.Render.renderAll();
    return {val: ok, focused:focused, after: after?after.name:null};
  })()`);
  await check('11k kanban: phases + rollup parents never land on the board', `(function(){
    var src = document.getElementById('wi-source');
    if(!src) return {val:false, why:'no wi-source'};
    var NL = String.fromCharCode(10);
    src.value = 'QA Board Phase' + NL + '  QA Board Child' + NL;
    MMGR.Tasks.wiCommit();
    var s = MMGR.State.getState();
    var ph = s.tasks.find(function(t){ return t.name==='QA Board Phase'; });
    var ch = s.tasks.find(function(t){ return t.name==='QA Board Child'; });
    if(!ph || !ch) return {val:false, why:'import failed', ph:!!ph, ch:!!ch};
    var rollup = {};
    s.tasks.forEach(function(t){ if(t.parentName) rollup[t.parentName]=1; });
    var sel = function(id){ return ['kc-todo','kc-ip','kc-bl','kc-dn','kc-lt'].map(function(c){ return '#'+c+' .kc[data-id="'+id+'"]'; }).join(','); };
    var phaseLeak = document.querySelector(sel(ph.id)) !== null;
    var childOnBoard = document.querySelector(sel(ch.id)) !== null;
    var ok = true, counts = {};
    ['todo','inprogress','blocked','completed'].forEach(function(st){
      var key = {todo:'kc-todo',inprogress:'kc-ip',blocked:'kc-bl',completed:'kc-dn'}[st];
      var n = document.getElementById(key) ? document.getElementById(key).querySelectorAll('.kc').length : -1;
      var exp = s.tasks.filter(function(t){ return (t.status||'todo')===st && !t.isPhase && !((t.level||0)===0 && rollup[t.name]); }).length;
      counts[st] = {rendered:n, expected:exp};
      if(n !== exp) ok = false;
    });
    var s2 = MMGR.State.getState();
    s2.tasks = s2.tasks.filter(function(t){ return t.name!=='QA Board Phase' && t.name!=='QA Board Child'; });
    MMGR.Render.renderAll();
    return {val: !phaseLeak && childOnBoard && ok, phaseLeak:phaseLeak, childOnBoard:childOnBoard, counts:counts};
  })()`);
  await check('11l wbs: status change via updTaskField refreshes Dashboard (h-dn)', `(async function(){
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return x.status !== 'completed' && !x.isPhase; });
    if(!t) return {val:false, why:'no candidate task'};
    var id = t.id, orig = t.status;
    MMGR.Render.renderDash();
    var before = document.getElementById('h-dn') ? document.getElementById('h-dn').textContent : null;
    MMGR.Tasks.updTaskField(id, 'status', 'completed');
    await new Promise(function(r){ setTimeout(r, 80); }); // rerenderPreservingFocus defers via setTimeout(0)
    var s1 = MMGR.State.getState();
    var after = document.getElementById('h-dn') ? document.getElementById('h-dn').textContent : null;
    var expected = s1.tasks.filter(function(x){ return x.status==='completed'; }).length;
    var boardHas = document.querySelector('#kc-dn .kc[data-id="'+id+'"]') !== null;
    var s2 = MMGR.State.getState();
    s2.tasks.find(function(x){ return x.id===id; }).status = orig;
    MMGR.Render.renderAll();
    return {val: after === String(expected) && String(expected) !== before && boardHas, before:before, after:after, expected:expected, boardHas:boardHas};
  })()`);
  await check('11m kanban: lead-time drop refreshes WBS badge + Dash tracker', `(function(){
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return !x.leadTime && !x.isPhase; });
    if(!t) return {val:false, why:'no candidate task'};
    var id = t.id;
    MMGR.Render.renderWbs();
    var badgeBefore = document.querySelector('#wbs-body tr.wbs-row[data-id="'+id+'"] .tt-lead-badge');
    MMGR.App.dragCard({dataTransfer:{effectAllowed:'move'}}, id);
    MMGR.App.dropCardLeadtime({preventDefault:function(){}});
    var s1 = MMGR.State.getState();
    var isLT = s1.tasks.find(function(x){ return x.id===id; }).leadTime === true;
    var badgeAfter = document.querySelector('#wbs-body tr.wbs-row[data-id="'+id+'"] .tt-lead-badge');
    var tracker = document.getElementById('leadtime-tracker-body');
    var trackerHas = tracker ? tracker.textContent.indexOf(t.name) > -1 : false;
    var laneHas = (function(){
      var el = document.getElementById('kc-lt');
      var cards = el ? el.querySelectorAll('.kc') : [];
      for(var i=0;i<cards.length;i++){ if(cards[i].getAttribute('data-id')===id) return true; }
      return false;
    })();
    var s2 = MMGR.State.getState();
    s2.tasks.find(function(x){ return x.id===id; }).leadTime = false;
    MMGR.Render.renderAll();
    return {val: isLT && !badgeBefore && !!badgeAfter && trackerHas && laneHas, isLT:isLT, badgeBefore:!!badgeBefore, badgeAfter:!!badgeAfter, trackerHas:trackerHas, laneHas:laneHas};
  })()`);
  await check('11n wbs: date change commits WITHOUT rebuilding the WBS row (picker stays anchored)', `(async function(){
    document.querySelector('.sec-btn[data-section=wbs]').click();
    var s = MMGR.State.getState();
    // Exclude lead-time tasks: their WBS row renders submittedDate/expectedDate
    // inputs instead of startDate/endDate, so the row would have no startDate
    // input to commit against.
    var t = s.tasks.find(function(x){ return !x.isPhase && !x.leadTime && x.startDate && x.duration; });
    if(!t) return {val:false, why:'no dated task'};
    var id = t.id, origStart = t.startDate, origEnd = t.endDate;
    MMGR.Render.renderWbs();
    var row = document.querySelector('#wbs-body tr.wbs-row[data-id="'+id+'"]');
    var inp = row ? row.querySelector('input[data-field="startDate"]') : null;
    if(!inp) return {val:false, why:'no startDate input'};
    inp.focus();
    var node = inp;
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(inp, '2026-09-01');
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(function(r){ setTimeout(r, 120); }); // deferred renders settle
    var s1 = MMGR.State.getState();
    var t1 = s1.tasks.find(function(x){ return x.id===id; });
    var sameNode = node.isConnected && document.querySelector('#wbs-body tr.wbs-row[data-id="'+id+'"] input[data-field="startDate"]') === node;
    var committed = t1.startDate === '2026-09-01';
    var endRecomputed = !!t1.endDate && t1.endDate !== origEnd;
    var endShown = (function(){
      var e = document.querySelector('#wbs-body tr.wbs-row[data-id="'+id+'"] input[data-field="endDate"]');
      return !!e && e.value === t1.endDate;
    })();
    var s2 = MMGR.State.getState();
    var t2 = s2.tasks.find(function(x){ return x.id===id; });
    t2.startDate = origStart; t2.endDate = origEnd;
    MMGR.Render.renderAll();
    return {val: sameNode && committed && endRecomputed && endShown, sameNode:sameNode, committed:committed, endRecomputed:endRecomputed, endShown:endShown};
  })()`);
  await check('11g boot sync: lane hidden on fresh dash boot when kbShowLeadtime=false', `(function(){MMGR.State.updateState(function(s){s.kbShowLeadtime=false;});MMGR.Render.renderAll();return {val: document.getElementById('col-leadtime').classList.contains('is-hide') && !document.querySelector('[data-action=tglLeadtimeLane]').classList.contains('is-on')};})()`);
  await check('11h boot sync: lane + chip reflect true state after renderAll', `(function(){MMGR.State.updateState(function(s){s.kbShowLeadtime=true;s.hlCritical=true;});MMGR.Render.renderAll();return {val: document.getElementById('col-leadtime').style.display !== 'none' && document.querySelector('[data-action=tglLeadtimeLane]').classList.contains('is-on') && document.body.classList.contains('hl-critical') && document.querySelector('[data-action=toggleCritical]').classList.contains('is-on')};})()`);

  // ---- GAP 9: Critical Path Highlighter ----
  await ev(`MMGR.State.updateState(function(s){s.hlCritical=false;}); MMGR.Render.renderAll();`); await delay(200);
  await ev(`document.querySelector('[data-action=toggleCritical]').click()`); await delay(300);
  await check('12 critical hl: on -> body class + state + chip', `(function(){var c=document.querySelector('[data-action=toggleCritical]');return {val: document.body.classList.contains('hl-critical') && MMGR.State.getState().hlCritical === true && c.classList.contains('is-on')};})()`);
  await ev(`document.querySelector('[data-action=toggleCritical]').click()`); await delay(300);
  await check('12b critical hl: off -> cleared', `(function(){return {val: !document.body.classList.contains('hl-critical') && MMGR.State.getState().hlCritical === false};})()`);

  // ---- GAP 10: Gantt dependency arrows ----
  await ev(`document.querySelector('.sec-btn[data-section=gantt]').click()`); await delay(500);
  await check('13 gantt arrows: svg overlay with lines', `(function(){var svg=document.querySelector('#gantt-chart .gantt-arrows');return {val: !!svg && svg.querySelectorAll('line').length > 0};})()`);
  await check('13b gantt arrows: bar count matches rows', `(function(){return {val: document.querySelectorAll('#gantt-chart .gb').length >= 5};})()`);
  const linkInfo = await ev(`(function(){var l=document.querySelector('#gantt-chart .gan-link');return l?{from:l.getAttribute('data-from'),to:l.getAttribute('data-to')}:null;})()`);
  await ev(`(function(){var l=document.querySelector('#gantt-chart .gan-link');if(l)l.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;})()`); await delay(300);
  await check('13c gantt arrows: click -> confirm modal opens', `(function(){return {val: document.getElementById('cfm-modal').classList.contains('on')};})()`);
  await ev(`document.querySelector('#cfm-ok').click()`); await delay(400);
  await check('13d gantt arrows: confirm removes the dependency', `(function(){var l=${JSON.stringify(linkInfo)};if(!l)return {val:false};var s=MMGR.State.getState();var succ=s.tasks.find(function(t){return t.id===l.to;});return {val: !!(succ && succ.predecessors && succ.predecessors.indexOf(l.from)===-1)};})()`, undefined, 'expected predecessor removed: ' + JSON.stringify(linkInfo));

  // ---- GAP 11: Spend Log + S-curve ----
  await ev(`document.querySelector('.sec-btn[data-section=bud]').click()`); await delay(400);
  await ev(`MMGR.Budget.addBudgetLine();`); await delay(300);
  await ev(`MMGR.Budget.updBudgetLine(0,'planned',500000,'change');`); await delay(300);
  await check('14 cashflow: S-curve svg renders', `(function(){var el=document.getElementById('cashflow-chart');return {val: !!el && !!el.querySelector('svg polyline')};})()`);
  await ev(`MMGR.Spend.addSpendEntry();`); await delay(300);
  await check('14b spend log: row appears', `(function(){var b=document.getElementById('spendlog-body');return {val: !!b && !!b.querySelector('tr') && b.textContent.indexOf('No dated spend')===-1};})()`);
  await ev(`(function(){var row=document.querySelector('#spendlog-body tr');var a=row.querySelector('input[data-field=amount]');var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(a,'25000');a.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`); await delay(300);
  await check('14c spend log: amount persists to state', `(function(){var s=MMGR.State.getState();return {val: s.spendLog.length===1 && +s.spendLog[0].amount===25000};})()`);
  await check('14d spend log: delete works', `(function(){MMGR.Spend.delSpendEntry(0);return {val: MMGR.State.getState().spendLog.length===0};})()`);

  // ---- GAP 12: Baseline Variance ----
  await ev(`MMGR.State.saveBaseline(); MMGR.Render.renderDash();`); await delay(300);
  await check('15 baseline variance: table rows + cost roll-up', `(function(){var b=document.getElementById('base-var-body');var c=document.getElementById('base-var-cost');return {val: !!b && !!b.querySelector('tr') && !!c && c.textContent !== 'n/a'};})()`);
  await ev(`document.querySelector('.sec-btn[data-section=dash]').click()`); await delay(400);

  // ---- GAP 13: RACI prune on delete ----
  await ev(`MMGR.Raci.addRaciTaskFromPicker('t2'); MMGR.Raci.addRaciPersonFromPicker('r1'); MMGR.Raci.cycleRaci('t2','r1',{});`); await delay(300);
  await check('16 raci: matrix cell set', `(function(){var s=MMGR.State.getState();return {val: s.raci.tasks.length===1 && s.raci.persons.length===1 && s.raci.matrix['t2_r1']==='R'};})()`);
  await ev(`MMGR.Tasks.delTask('t2');`); await delay(300);
  await check('16b raci: task delete prunes row + cells', `(function(){var s=MMGR.State.getState();return {val: s.raci.tasks.length===0 && !('t2_r1' in s.raci.matrix)};})()`);
  await ev(`MMGR.Raci.addRaciPersonFromPicker('r1'); MMGR.Raci.cycleRaci('t4','r1',{}); MMGR.Resources.delResource(0);`); await delay(300);
  await check('16c raci: resource delete prunes person col + cells', `(function(){var s=MMGR.State.getState();return {val: s.raci.persons.length===0 && !('t4_r1' in s.raci.matrix)};})()`);
  await ev(`MMGR.Raci.addRaciPersonFromPicker('s1'); MMGR.Stakeholders.delStake(0);`); await delay(300);
  await check('16d raci: stakeholder delete prunes col', `(function(){var s=MMGR.State.getState();return {val: s.raci.persons.length===0};})()`);
  await ev(`MMGR.Raci.addRaciTaskFromPicker('t5'); MMGR.Raci.delRaciTask(0);`); await delay(200);
  await check('16e raci: manual row delete works', `(function(){return {val: MMGR.State.getState().raci.tasks.length===0};})()`);

  // ---- GAP 14: Meetings live session ----
  await ev(`document.querySelector('.sec-btn[data-section=meet]').click()`); await delay(400);
  await ev(`MMGR.Meetings.startMeeting('kickoff');`); await delay(300);
  await check('17 meetings: live card renders with elapsed badge', `(function(){var w=document.getElementById('active-meeting-wrap');return {val: !!w && !!document.getElementById('meet-elapsed') && w.textContent.indexOf('LIVE') > -1};})()`);
  await ev(`document.querySelector('[data-action=tglMeetItem]').click()`); await delay(300);
  await check('17b meetings: item toggle persists', `(function(){var s=MMGR.State.getState();return {val: s.activeMeeting && s.activeMeeting.items[0].done === true};})()`);
  await ev(`MMGR.Meetings.updMeetItemNote(1,'Car park access confirmed');`); await delay(200);
  await check('17c meetings: note persists without focus loss', `(function(){var s=MMGR.State.getState();return {val: s.activeMeeting.items[1].note === 'Car park access confirmed'};})()`);
  // elapsed auto-refresh: backdate startedAt 10 min, restart timer, wait one tick interval
  await ev(`MMGR.State.updateState(function(s){s.activeMeeting.startedAt = new Date(Date.now()-10*60000).toISOString();}); MMGR.Meetings.startElapsedTimer();`);
  await delay(16500);
  await check('17d meetings: elapsed badge auto-refreshes to ~10m', `(function(){var b=document.getElementById('meet-elapsed');var t=b?b.textContent:'';return {val: t.indexOf('10m') > -1 || t.indexOf('0h') > -1 || /\\d+m elapsed/.test(t)};})()`);
  await ev(`MMGR.Meetings.endMeeting();`); await delay(400);
  await check('17e meetings: ended -> history record + comms entry', `(function(){var s=MMGR.State.getState();var h=document.getElementById('meeting-history-body');return {val: s.meetings.length===1 && s.commsEntries.length>=1 && !!h && h.textContent.indexOf('Kickoff') > -1};})()`);
  await ev(`MMGR.Meetings.copyMeetingMinutes(MMGR.State.getState().meetings[0].id);`); await delay(300);
  await check('17f meetings: Copy Minutes toasts + no throw', `(function(){var t=document.querySelector('.toast');return {val: !!(t && t.textContent.indexOf('Minutes copied') > -1)};})()`);
  await check('17g meetings: history shows Copy Minutes button per row', `(function(){var b=document.getElementById('meeting-history-body');return {val: !!b && !!b.querySelector('[data-action=copyMeetingMinutes]')};})()`);

  // ---- GAP 15: Charter Upload ----
  await check('18 charter: modal documents docx/pdf limitation', `(function(){var h=document.getElementById('chartup-modal');var m=document.getElementById('cu-tab-file');m.click();var t=h?h.textContent:'';return {val: t.indexOf('docx') > -1 && t.indexOf('paste') > -1 && t.indexOf('security policy') > -1};})()`);
  await check('18b charter: upload input accepts txt/md/docx/pdf', `(function(){var i=document.getElementById('charter-upload');return {val: !!i && i.accept.indexOf('.docx') > -1 && i.accept.indexOf('.pdf') > -1 && i.accept.indexOf('.txt') > -1};})()`);
  await check('18c charter: .txt file upload reads text into source', `(function(){var nl=String.fromCharCode(10);var input=document.getElementById('charter-upload');var file=new File(['Project Name: Test Tower'+nl+'Sponsor: Jane'+nl+'Budget: 500000'],'charter.txt',{type:'text/plain'});var dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return {val:true};})()`);
  await delay(500);
  await check('18d charter: txt content lands in cu-source + prompt regenerates', `(function(){var src=document.getElementById('cu-source').value;var pr=document.getElementById('cu-prompt').value;return {val: src.indexOf('Test Tower') > -1 && pr.indexOf('DOCUMENT CONTENT') > -1};})()`);
  await check('18e charter: docx file lands on paste tab with clear error', `(function(){var input=document.getElementById('charter-upload');var file=new File(['binary'],'charter.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});var dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return {val:true};})()`);
  await delay(400);
  await check('18f charter: docx error toast + paste tab active', `(function(){var t=document.querySelector('.toast');var pp=document.getElementById('cu-pane-paste');return {val: !!t && t.textContent.toLowerCase().indexOf('docx') > -1 && !pp.classList.contains('is-hide')};})()`);
  await ev(`MMGR.Charter.closeChartUp();`); await delay(150);

  // ---- GAP 16: Emoji purge ----
  await check('19 emoji: no emoji in rendered DOM text', `(function(){var t=document.body.textContent;return {val: !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(t)};})()`);

  // ---- GAP 17: inline styles ----
  await check('20 inline styles: DOM census reduced below 250 (was 354 pre-refactor)', `(function(){var n=document.querySelectorAll('#app-main [style]').length;return {val: n < 250,count:n};})()`);

  // ---- GAP 18: dirty indicator + backup flow ----
  await check('21 dirty: shows Not backed up on fresh profile', `(function(){return {val: document.getElementById('dirty-ind').classList.contains('on')};})()`);
  await ev(`MMGR.App.saveProjectFile();`); await delay(400);
  await check('21b dirty: clears after file backup + watermark set', `(function(){var s=MMGR.State.getState();return {val: !document.getElementById('dirty-ind').classList.contains('on') && !!s.lastBackedUpAt};})()`);
  await ev(`MMGR.State.updateState(function(s){s.userName='G';});`); await delay(200);
  await check('21c dirty: returns on next edit', `(function(){return {val: document.getElementById('dirty-ind').classList.contains('on')};})()`);

  // ---- GAP 19: Focus Mode ----
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'f'}));`); await delay(300);
  await check('22 focus: F toggles class + state', `(function(){return {val: document.body.classList.contains('focus-mode') && MMGR.State.getState().focusMode === true};})()`);
  await check('22b focus: hides header/nav/drawer, keeps active panel', `(function(){var h=document.querySelector('#app-header');var n=document.querySelector('.sec-nav');var p=document.querySelector('.panel.active');var hidden=function(el){return el && getComputedStyle(el).display==='none';};return {val: hidden(h) && hidden(n) && !!p && getComputedStyle(p).display!=='none' && !!document.querySelector('.focus-ind') && getComputedStyle(document.querySelector('.focus-ind')).display!=='none'};})()`);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'f'}));`); await delay(300);
  await check('22c focus: F again exits', `(function(){return {val: !document.body.classList.contains('focus-mode')};})()`);

  // ---- GAP 20: Access gate ----
  await send('Page.navigate', { url: BASE + '/project.html?id=locked-test' }); await delay(2500);
  await check('23 access gate: locked project redirects to app entry', `(function(){return {val: location.href.indexOf('app.html?locked=') > -1};})()`);

  // ---- Extras: undo/redo, multi-tab, weather region, copy-all, console ----
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);
  await check('24 undo/redo: push -> mutate -> undo restores', `(function(){var before=MMGR.State.getState().tasks.length;MMGR.State.pushUndo();MMGR.State.updateState(function(s){s.tasks.push({id:'x-test'});});var after=MMGR.State.getState().tasks.length;MMGR.State.undo();var restored=MMGR.State.getState().tasks.length;return {val: before===restored && after===before+1};})()`);
  await check('25 multi-tab: storage conflict modal + keepTheirs', `(function(){var s=JSON.parse(JSON.stringify(MMGR.State.getState()));s.updatedAt=new Date(Date.now()+60000).toISOString();s.userName='OtherTab';window.dispatchEvent(new StorageEvent('storage',{key:MMGR.State.getProjectKey(),newValue:JSON.stringify(s)}));return {val:true};})()`);
  await delay(400);
  await check('25b multi-tab: conflict modal opens + keepTheirs adopts', `(function(){var on=document.getElementById('conflict-modal').classList.contains('on');document.querySelector('#conflict-modal [data-action=keepTheirs]').click();return {val: on && MMGR.State.getState().userName==='OtherTab'};})()`);
  await ev(`MMGR.App.setRegion('tropical');`); await delay(300);
  await check('26 weather region: persists', `(function(){return {val: MMGR.State.getState().weatherRegion==='tropical'};})()`);
  await check('27 copy-all: raci + comms blocks no-throw', `(function(){try{MMGR.App.cpAllPage('comms');MMGR.App.cpAllPage('raci');return {val:true};}catch(e){return {val:false};}})()`);
  await check('28 shortcuts: Escape closes drawer', `(function(){MMGR.App.openDrw();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return {val: !document.getElementById('drw').classList.contains('open')};})()`);

  // ---- Gap-17 conversion: every classList-toggle path must still work ----
  await check('29 drawer tabs: Q&A tab shows/hides via is-hide', `(function(){MMGR.App.openDrw();document.querySelector('[data-action=swDtab][data-tab=qa]').click();var qa=document.getElementById('db-qa'),feat=document.getElementById('db-feat');var ok=!qa.classList.contains('is-hide')&&feat.classList.contains('is-hide');MMGR.App.closeDrw();return {val: ok};})()`);
  await check('30 MLC card: hover shows, leave hides', `(function(){var b=document.querySelector('.tab-btn[data-mlc=waterfall]');b.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));var card=document.getElementById('meth-learn-card');var vis=card&&!card.classList.contains('is-hide');b.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}));return {val: vis};})()`);
  await delay(700);
  await check('30b MLC card: hides after leave timer', `(function(){return {val: document.getElementById('meth-learn-card').classList.contains('is-hide')};})()`);
  await check('31 dmaic signal: shows when active, hides when off', `(function(){MMGR.Dmaic.tglDMAIC(true);MMGR.Dmaic.tglDMAICPhase('define');MMGR.Render.renderDash();var w=document.getElementById('dmaic-signal-wrap');var vis=w&&!w.classList.contains('is-hide')&&w.textContent.indexOf('1/5 phases')>-1;MMGR.Dmaic.tglDMAIC(false);MMGR.Render.renderDash();var hid=w&&w.classList.contains('is-hide');return {val: vis&&hid};})()`);
  await check('32 res-warn: conflict shows wrap, cleared after', `(function(){var mk=function(id,start,end){return {id:id,name:'Conflict '+id,level:1,indent:1,status:'inprogress',startDate:start,endDate:end,duration:'10',assignee:'Bob',critical:true,predecessors:[],isPhase:false};};MMGR.State.updateState(function(s){s.tasks.push(mk('x9','2026-08-01','2026-08-25'));s.tasks.push(mk('xa','2026-08-10','2026-08-30'));});var during=MMGR.Schedule.findResourceConflicts();MMGR.Render.renderDash();var w=document.getElementById('res-warn-wrap');var vis=w&&!w.classList.contains('is-hide')&&w.textContent.indexOf('OVER-ALLOC')>-1;MMGR.State.updateState(function(s){s.tasks=s.tasks.filter(function(t){return t.id!=='x9'&&t.id!=='xa';});});MMGR.Render.renderDash();var hid=w&&w.classList.contains('is-hide');return {val: vis&&hid,vis:vis,hid:hid,during:during.length};})()`);
  await check('33 budget alerts: overspend bar-warn + overrun alert', `(function(){MMGR.Budget.updBudgetLine(0,'actual',2000000,'change');var w=document.getElementById('bud-bar-warn');var vis=!w.classList.contains('is-hide');MMGR.Budget.updBudgetLine(0,'actual',0,'change');MMGR.Budget.updBudgetLine(0,'planned',1500000,'change');var o=document.getElementById('bud-overrun-alert');var ov=!o.classList.contains('is-hide');MMGR.Budget.updBudgetLine(0,'planned',500000,'change');return {val: vis&&ov};})()`);
  await check('34 cfm-items: confirm list shows, then hides on cancel', `(function(){MMGR.App.askConfirm({title:'T',message:'M',items:['t1','t2']});var m=document.getElementById('cfm-modal');var i=document.getElementById('cfm-items');var vis=m.classList.contains('on')&&!i.classList.contains('is-hide');document.querySelector('#cfm-cancel').click();var hid=!m.classList.contains('on')&&i.classList.contains('is-hide');return {val: vis&&hid,vis:vis,hid:hid};})()`);
  await check('35 agile meetings section: visible in agile, hidden in waterfall', `(function(){MMGR.State.updateState(function(s){s.methodology='agile';});MMGR.Render.renderAll();var a=document.getElementById('meet-agile-sec');var vis=a&&!a.classList.contains('is-hide');MMGR.State.updateState(function(s){s.methodology='waterfall';});MMGR.Render.renderAll();var hid=a&&a.classList.contains('is-hide');return {val: vis&&hid};})()`);
  await check('36 mc-error: shown when too few scheduled tasks', `(function(){var snap=JSON.parse(JSON.stringify(MMGR.State.getState().tasks));MMGR.State.updateState(function(s){s.tasks.forEach(function(t){t.startDate='';t.endDate='';});});MMGR.Schedule.runMonteCarlo();var e=document.getElementById('mc-error');var vis=!e.classList.contains('is-hide')&&e.textContent.indexOf('2 scheduled')>-1;MMGR.State.updateState(function(s){s.tasks=snap;});MMGR.Render.renderAll();return {val: vis};})()`);
  await check('37 static markup: project.html source has zero inline styles', `(function(){return fetch('project.html').then(function(r){return r.text();}).then(function(t){return {val: t.indexOf('style=') === -1};});})()`);
  await check('38 dom census: rendered inline styles reduced', `(function(){return {val: document.querySelectorAll('[style]').length < 200};})()`);
  // .is-hide must WIN over display rules (.sp{flex} etc.) — assert computed styles, not classes.
  await check('38b computed visibility: is-hide beats .kcol/.sp display rules', `(function(){var cs=function(el){return el?getComputedStyle(el).display:null;};var lane=document.getElementById('col-leadtime');var sp=document.getElementById('sprint-p');MMGR.State.updateState(function(s){s.kbShowLeadtime=false;s.methodology='waterfall';});MMGR.Render.renderAll();var laneHidden=cs(lane)==='none';var spHidden=cs(sp)==='none';MMGR.State.updateState(function(s){s.kbShowLeadtime=true;s.methodology='agile';});MMGR.Render.renderAll();var laneShown=cs(lane)!=='none';var spShown=cs(sp)!=='none';MMGR.State.updateState(function(s){s.kbShowLeadtime=false;s.methodology='waterfall';});return {val: laneHidden&&spHidden&&laneShown&&spShown,laneHidden:laneHidden,spHidden:spHidden,laneShown:laneShown,spShown:spShown};})()`);

  // ---- ACTION-PLAN Phase 1: Today Decision Engine / Meeting promises / Health narrative ----
  await check('40 decisions: ranked needs-you-now list from 3+ sources', `(function(){
    MMGR.State.updateState(function(s){
      if(!s.risks)s.risks=[];
      if(!s.budgetLines)s.budgetLines=[];
      if(!s.commsEntries)s.commsEntries=[];
      s.tasks.push({id:'td1',name:'Critical Pour',level:1,indent:1,status:'inprogress',startDate:'2026-07-01',endDate:'2026-07-20',duration:'15',assignee:'Alice',critical:true,leadTime:false,predecessors:[],milestone:false,weatherSensitive:false,weatherExposed:false});
      s.risks.push({id:'rd1',description:'Crane supply delay',probability:'High',impact:'High',mitigation:'',issueId:null});
      s.budgetLines.push({id:'bd1',category:'Materials',planned:100000,actual:1000000,notes:''});
      s.commsEntries.push({id:'cd1',date:'2026-07-01',type:'Email',attendees:'',summary:'x',actionItems:'Confirm steel order',followUp:'2026-07-05'});
    });
    MMGR.Render.renderDash();
    var b=document.getElementById('today-decision-body');var t=b?b.textContent:'';
    var items=MMGR.Decisions.compute();
    var srcs={};items.forEach(function(i){srcs[i.src]=true;});
    var ranked=items.length>=2 && items[0].impact>=items[items.length-1].impact;
    MMGR.State.updateState(function(s){s.tasks=s.tasks.filter(function(t){return t.id!=='td1';});s.risks=s.risks.filter(function(r){return r.id!=='rd1';});s.budgetLines=s.budgetLines.filter(function(x){return x.id!=='bd1';});s.commsEntries=s.commsEntries.filter(function(c){return c.id!=='cd1';});});
    return {val: !!b && items.length>=3 && Object.keys(srcs).length>=3 && ranked && t.indexOf('Budget overrun')>-1 && t.indexOf('High risk')>-1, n:items.length, srcs:Object.keys(srcs)};
  })()`);
  await check('41 meetings: last-promises ribbon carries unresolved items + tick-off persists', `(function(){
    if(MMGR.State.getState().activeMeeting){MMGR.Meetings.endMeeting();}
    MMGR.Meetings.startMeeting('weekly');
    MMGR.Meetings.tglMeetItem(1);
    MMGR.Meetings.updMeetItemNote(1,'Chase structural drawings');
    MMGR.Meetings.endMeeting();
    var s=MMGR.State.getState();
    var p=(s.meetingPromises&&s.meetingPromises.weekly)||[];
    var open=p.filter(function(x){return !x.done;});
    MMGR.Meetings.renderMeetings();
    var w=document.getElementById('meet-promises-wrap');
    var body=document.getElementById('meet-promises');
    var vis=w&&!w.classList.contains('is-hide')&&body&&body.textContent.indexOf('Health Score & KPI trend')>-1;
    if(open.length){MMGR.Meetings.tglPromise('weekly',0);}
    var after=MMGR.State.getState().meetingPromises.weekly.filter(function(x){return x.done;}).length;
    var comms=(MMGR.State.getState().commsEntries||[]);
    var lastComms=comms[comms.length-1];
    return {val: p.length>=2 && open.length>=1 && vis && after>=1 && lastComms && lastComms.actionItems.length>0, p:p.length, open:open.length, afterDone:after, commsActions:lastComms?lastComms.actionItems:''};
  })()`);
  await check('42 health: narrative explains the score and its movement', `(function(){
    MMGR.Render.renderDash();
    var n=document.getElementById('health-narrative');
    var ok1=!!n && n.textContent.trim().length>8;
    MMGR.State.updateState(function(s){s.tasks.forEach(function(t){if(t.id==='t1')t.status='completed';});});
    MMGR.Render.renderDash();
    var n2=document.getElementById('health-narrative');
    var ok2=!!n2 && n2.textContent.indexOf('moved from')>-1;
    return {val: ok1 && ok2, text:n?n.textContent:'missing'};
  })()`);

  // ---- ACTION-PLAN Phase 2: Cross-linking ----
  await check('43 risk-prop: risk linked to overdue task flags LATE', `(function(){
    MMGR.State.updateState(function(s){
      s.tasks.push({id:'rp1',name:'Slip Source',level:1,indent:1,status:'inprogress',startDate:'2026-06-01',endDate:'2026-06-10',duration:'10',assignee:'A',critical:false,leadTime:false,predecessors:[],milestone:false,weatherSensitive:false,weatherExposed:false});
      s.tasks.push({id:'rp2',name:'Downstream Task',level:1,indent:1,status:'todo',startDate:'2026-06-15',endDate:'2026-06-25',duration:'10',assignee:'B',critical:false,leadTime:false,predecessors:['rp1'],milestone:false,weatherSensitive:false,weatherExposed:false});
      s.risks.push({id:'rpR',description:'Ripple risk',probability:'High',impact:'High',mitigation:'',issueId:null,linkedTaskId:'rp1',costImpactEstimate:50000});
    });
    MMGR.Render.renderRisks();
    var rows=Array.prototype.slice.call(document.querySelectorAll('#risk-body tr'));
    var row=rows.filter(function(r){return r.textContent.indexOf('Ripple risk')>-1;})[0];
    var late=!!row && row.textContent.indexOf('LATE')>-1;
    var hasLink=!!row && row.textContent.indexOf('Slip Source')>-1;
    MMGR.Render.renderWbs();
    var wrows=Array.prototype.slice.call(document.querySelectorAll('#wbs-body tr'));
    var dw=wrows.filter(function(r){return r.textContent.indexOf('Downstream Task')>-1;})[0];
    var chain=!!dw && dw.textContent.indexOf('CHAIN')>-1;
    MMGR.State.updateState(function(s){s.tasks=s.tasks.filter(function(t){return t.id!=='rp1'&&t.id!=='rp2';});s.risks=s.risks.filter(function(r){return r.id!=='rpR';});});
    return {val: late && hasLink && chain, late:late, hasLink:hasLink, chain:chain};
  })()`);
  await check('44 change-ripple: ripple cell parses days + $ + downstream', `(function(){
    MMGR.State.updateState(function(s){
      if(!s.changes)s.changes=[];
      s.changes.push({id:'cr1',date:'2026-08-01',title:'Facade change',requester:'Owner',schedImpact:'+10 days',costImpact:'$25,000',status:'submitted',approvedBy:'',notes:''});
    });
    MMGR.Render.renderChanges();
    var rows=Array.prototype.slice.call(document.querySelectorAll('#chg-body tr'));
    // The title lives in an <input value>, invisible to textContent — match the ID cell instead.
    var row=rows.filter(function(r){var t=r.querySelector('input[data-field=title]');return t&&t.value==='Facade change';})[0];
    var ripple=row?row.querySelector('.chg-ripple').textContent:'';
    var ok=!!row && ripple.indexOf('10d')>-1 && ripple.indexOf('$25,000')>-1 && ripple.indexOf('lines')>-1;
    MMGR.State.updateState(function(s){s.changes=s.changes.filter(function(c){return c.id!=='cr1';});});
    return {val: ok, ripple:ripple};
  })()`);
  await check('45 contingency: risk exposure vs contingency gap renders', `(function(){
    MMGR.State.updateState(function(s){
      s.risks.push({id:'cx1',description:'Exposure risk',probability:'High',impact:'Medium',mitigation:'',issueId:null,linkedTaskId:null,costImpactEstimate:100000});
      s.budgetLines.push({id:'bx1',category:'Contingency',planned:40000,actual:0,isContingency:true,notes:''});
    });
    MMGR.Render.renderBudget();
    var c=document.getElementById('risk-cont-con');
    var t=c?c.textContent:'';
    // High factor = 0.7 -> 0.7 x 100000 = $70,000 exposure; $40,000 reserved -> gap $30,000
    var ok=!!c && t.indexOf('$70,000')>-1 && t.indexOf('$40,000')>-1 && t.indexOf('$30,000')>-1 && t.indexOf('Exposure Gap')>-1;
    var hasCb=document.querySelectorAll('#bud-body input[data-field=isContingency]').length>=1;
    MMGR.State.updateState(function(s){s.risks=s.risks.filter(function(r){return r.id!=='cx1';});s.budgetLines=s.budgetLines.filter(function(b){return b.id!=='bx1';});});
    return {val: ok && hasCb, t:t, hasCb:hasCb};
  })()`);
  await check('46 raci-alerts: no-Accountable + multi-Accountable conflict alerts render', `(function(){
    MMGR.State.updateState(function(s){
      s.raci.tasks=[{id:'t1'},{id:'t2'}];
      s.raci.persons=[{id:'r1'},{id:'r2'}];
      s.raci.matrix={'t1_r1':'A','t1_r2':'A'}; // t1 over-loaded, t2 has none
    });
    MMGR.Render.renderRaci();
    var el=document.getElementById('raci-alerts');
    var t=el?el.textContent:'';
    var noA=t.indexOf('no Accountable')>-1;
    var multiA=t.indexOf('Accountable people')>-1;
    MMGR.State.updateState(function(s){s.raci.tasks=[];s.raci.persons=[];s.raci.matrix={};});
    return {val: noA && multiA, t:t, noA:noA, multiA:multiA};
  })()`);
  await check('47 leadtime need-by: expected past need-by flags red', `(function(){
    MMGR.State.updateState(function(s){
      s.tasks.push({id:'lt1',name:'Steel Delivery',level:1,indent:1,status:'todo',startDate:'',endDate:'',duration:'',assignee:'',critical:false,leadTime:true,predecessors:[],milestone:false,weatherSensitive:false,weatherExposed:false,submittedDate:'2026-07-01',expectedDate:'2026-08-20'});
      s.tasks.push({id:'lt2',name:'Erection',level:1,indent:1,status:'todo',startDate:'2026-08-10',endDate:'2026-08-30',duration:'20',assignee:'',critical:false,leadTime:false,predecessors:['lt1'],milestone:false,weatherSensitive:false,weatherExposed:false});
    });
    MMGR.Render.renderDash();
    var b=document.getElementById('leadtime-tracker-body');
    var t=b?b.textContent:'';
    var past=t.indexOf('past need-by')>-1;
    MMGR.State.updateState(function(s){s.tasks=s.tasks.filter(function(t){return t.id!=='lt1'&&t.id!=='lt2';});});
    return {val: past, t:t, past:past};
  })()`);

  // ---- ACTION-PLAN Phase 3: retention ----
  await check('48 aging: open action items age with escalating badges', `(function(){
    MMGR.State.updateState(function(s){
      if(!s.commsEntries)s.commsEntries=[];
      s.commsEntries.push({id:'ag1',date:'2026-07-01',type:'Site Visit',attendees:'',summary:'',actionItems:'Reinstate hoarding permit',followUp:'2026-07-05'});
      if(!s.meetingPromises)s.meetingPromises={};
      if(!s.meetingPromises.weekly)s.meetingPromises.weekly=[];
      s.meetingPromises.weekly.push({id:'P1',text:'Chase foundation rebar',done:false,sourceMeetingId:'m1',sourceDate:'2026-07-02',createdAt:new Date(Date.now()-10*86400000).toISOString()});
      s.meetingPromises.weekly.push({id:'P2',text:'Confirm tower crane',done:true,sourceMeetingId:'m1',sourceDate:'2026-07-02',createdAt:new Date().toISOString()});
    });
    MMGR.Render.renderDash();
    var b=document.getElementById('action-aging-body');
    var t=b?b.textContent:'';
    var items=MMGR.Render.computeAgingActions();
    var open=items.filter(function(i){return i.text==='Reinstate hoarding permit'||i.text==='Chase foundation rebar';});
    var doneExcluded=items.filter(function(i){return i.text==='Confirm tower crane';}).length===0;
    var overdue=open.filter(function(i){return (i.age||0)>0;});
    var amber=t.indexOf('overdue')>-1;
    var sorted=items.length===0 || items[0].age >= items[items.length-1].age;
    MMGR.State.updateState(function(s){s.commsEntries=s.commsEntries.filter(function(c){return c.id!=='ag1';});s.meetingPromises.weekly=[];});
    return {val: open.length===2 && doneExcluded && overdue.length===2 && amber && sorted && t.indexOf('Chase foundation rebar')>-1, open:open.length, doneExcluded:doneExcluded, overdue:overdue.length, sorted:sorted};
  })()`);
  await check('49 streak: consecutive-day counter bumps and persists', `(function(){
    var before=MMGR.State.getState().streak.count;
    MMGR.State.updateState(function(s){s.userName='streak-test';});
    var after=MMGR.State.getState().streak.count;
    MMGR.State.updateState(function(s){s.userName='streak-test-2';});
    var same=MMGR.State.getState().streak.count;
    var lastDate=MMGR.State.getState().streak.lastDate;
    var today=new Date().toISOString().slice(0,10);
    MMGR.State.updateState(function(s){s.userName='Grace';});
    return {val: after>=before && same===after && !!lastDate && lastDate<=today, before:before, after:after, same:same, lastDate:lastDate};
  })()`);
  await check('50 baseline narrative: plain-English diff + Copy All path', `(function(){
    MMGR.State.updateState(function(s){
      s.baseline={tasks:JSON.parse(JSON.stringify(s.tasks)),budgetLines:JSON.parse(JSON.stringify(s.budgetLines)),budgetEnvelope:s.budgetEnvelope,capturedAt:new Date().toISOString()};
      s.tasks.forEach(function(t){if(t.id==='t4')t.endDate='2026-11-10';}); // slip t4 vs baseline
    });
    MMGR.Render.renderDash();
    var b=document.getElementById('baseline-narrative-body');
    var t=b?b.textContent:'';
    var narr=MMGR.Render.computeBaselineNarrative();
    var hasSlip=!!narr && narr.join(' ').indexOf('slipped')>-1;
    var rendered=t.indexOf('slipped')>-1;
    var cpOk=true;
    try{MMGR.App.cpAllPage('baselinen');}catch(e){cpOk=false;}
    var toast=document.querySelector('.toast');
    var copied=!!toast && toast.textContent.indexOf('Copied')>-1;
    MMGR.State.updateState(function(s){s.tasks.forEach(function(t){if(t.id==='t4')t.endDate='2026-10-15';});});
    return {val: hasSlip && rendered && cpOk && copied, narr:narr, rendered:rendered, cpOk:cpOk, copied:copied};
  })()`);

  // ---- ACTION-PLAN Phase 4: access-control extensions ----
  await check('51 readonly scope: opens view-only mode with banner + blocked edits', `(function(){
    localStorage.setItem('mmgr_scope_demo-project','readonly');
    return {val:true};
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);
  await check('51b readonly scope: body class + banner visible after reload', `(function(){
    var banner=document.getElementById('readonly-banner');
    return {val: document.body.classList.contains('readonly-mode') && !!banner && !banner.classList.contains('is-hide') && banner.textContent.indexOf('View-only') > -1};
  })()`);
  await check('51c readonly scope: mutating data-action is refused with toast', `(function(){
    var before=MMGR.State.getState().tasks.length;
    document.querySelector('[data-action=addTask]').click();
    var after=MMGR.State.getState().tasks.length;
    var toast=document.querySelector('.toast');
    var t=toast?toast.textContent:'';
    return {val: before===after && t.indexOf('View-only') > -1, before:before, after:after, toast:t};
  })()`);
  await check('51d readonly scope: navigation + Copy All still work', `(function(){
    var navOk=true,copyOk=true;
    try{MMGR.App.cpAllPage('log');}catch(e){copyOk=false;}
    var toast=document.querySelector('.toast');
    var copied=!!toast && toast.textContent.indexOf('Copied') > -1;
    return {val: navOk && copyOk && copied, copied:copied};
  })()`);
  await ev(`localStorage.setItem('mmgr_scope_demo-project','full');`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);
  await check('51e readonly scope: full scope restores editing', `(function(){
    var banner=document.getElementById('readonly-banner');
    return {val: !document.body.classList.contains('readonly-mode') && !!banner && banner.classList.contains('is-hide')};
  })()`);
  await check('52 raci heatmap: workload rows render with weighted load', `(function(){
    MMGR.State.updateState(function(s){
      s.raci.tasks=[{id:'t1'},{id:'t2'},{id:'t3'},{id:'t4'}];
      s.raci.persons=[{id:'r1'},{id:'r2'}];
      s.raci.matrix={'t1_r1':'A','t2_r1':'A','t3_r1':'R','t4_r1':'C','t1_r2':'R','t2_r2':'I'};
    });
    MMGR.Render.renderRaci();
    var el=document.getElementById('raci-heatmap');
    var cells=el?el.querySelectorAll('.rw-cell').length:0;
    var wl=MMGR.Raci.raciWorkload();
    var r1=wl.filter(function(w){return w.person.id==='r1';})[0];
    var r2=wl.filter(function(w){return w.person.id==='r2';})[0];
    var aCount=r1?r1.counts.A:0;
    var sorted=wl.length===0 || wl[0].load>=wl[wl.length-1].load;
    var txt=el?el.textContent:'';
    MMGR.State.updateState(function(s){s.raci.tasks=[];s.raci.persons=[];s.raci.matrix={};});
    return {val: cells===2 && aCount===2 && r1.load>r2.load && sorted && txt.indexOf('A 2')>-1, cells:cells, aCount:aCount, r1:r1?r1.load:null, r2:r2?r2.load:null};
  })()`);

  // ---- ACTION-PLAN Phase 5: export & polish ----
  await check('53 cpFormats: slack/email/client all copy composed text', `(function(){
    var ok=true,toasts=[];
    ['slack','email','client'].forEach(function(k){
      try{MMGR.App.cpFormats(k);var t=document.querySelector('.toast');toasts.push(t?t.textContent:'');}catch(e){ok=false;}
    });
    return {val: ok && toasts.every(function(t){return t.indexOf('copied')>-1;}), toasts:toasts};
  })()`);
  await check('54 tooltip: data-def hover shows glossary entry', `(function(){
    var el=document.querySelector('[data-def="Health Score"]');
    if(!el){return {val:false,why:'no data-def element'};
    }
    el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    var tip=document.getElementById('def-tooltip');
    var ok=!!tip && tip.classList.contains('vis') && tip.textContent.indexOf('weighted')>-1;
    el.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));
    var hidden=!tip || !tip.classList.contains('vis');
    return {val: ok && hidden, ok:ok, hidden:hidden, txt:tip?tip.textContent:''};
  })()`);
  await check('55 gantt export: exports a PNG blob + toast', `(function(){
    // Blob-to-download is async; assert the canvas path produced a blob
    // by monkey-patching HTMLCanvasElement.prototype.toBlob.
    var captured=null;
    var orig=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(cb){captured=this;cb(new Blob(['png'],{type:'image/png'}));};
    var threw=false;
    try{MMGR.App.exportGanttPNG();}catch(e){threw=true;}
    HTMLCanvasElement.prototype.toBlob=orig;
    var t=document.querySelector('.toast');
    return {val: !threw && !!captured && captured.width>1000 && captured.height>200 && !!t && t.textContent.indexOf('PNG')>-1, w:captured?captured.width:0, h:captured?captured.height:0, toast:t?t.textContent:''};
  })()`);
  await check('56 onboarding empty states: WBS + Kanban deep-link to add task', `(function(){
    var snap=JSON.parse(JSON.stringify(MMGR.State.getState().tasks));
    MMGR.State.updateState(function(s){s.tasks=[];});
    document.querySelector('.sec-btn[data-section=wbs]').click();
    var wbsEmpty=document.getElementById('wbs-body').textContent.indexOf('No tasks yet')>-1;
    document.querySelector('.sec-btn[data-section=kan]').click();
    var kanDeep=!!document.querySelector('#kc-todo [data-action=showSec][data-section=wbs]');
    MMGR.State.updateState(function(s){s.tasks=snap;});
    document.querySelector('.sec-btn[data-section=dash]').click();
    return {val: wbsEmpty && kanDeep, wbsEmpty:wbsEmpty, kanDeep:kanDeep};
  })()`);

  // ---- ACTION-PLAN Phase 6: portfolio rollup ----
  await check('57 portfolio: ranks unlocked projects by urgency with visible reason', `(function(){
    // Seed a second project's saved state (mirroring mmgr_state_<id> keys)
    var hot={v:8,schemaVersion:8,projectId:'hot-project',projectName:'Hotel Fit-Out',updatedAt:new Date().toISOString(),
      tasks:[{id:'h1',name:'Pour Slab',level:0,indent:0,isPhase:true,status:'inprogress',startDate:'2026-06-01',endDate:'2026-07-01',duration:'30',assignee:'A',critical:true,leadTime:false,predecessors:[],milestone:false,weatherSensitive:false,weatherExposed:false},
             {id:'h2',name:'MEP Rough-In',level:1,indent:1,status:'inprogress',startDate:'2026-07-01',endDate:'2026-07-02',duration:'20',assignee:'B',critical:false,leadTime:false,predecessors:['h1'],milestone:false,weatherSensitive:false,weatherExposed:false}],
      issues:[{id:'i1',description:'Crane breakdown',status:'open'}],
      risks:[{id:'r1',description:'Steel strike',probability:'High',impact:'High'}],
      budgetLines:[{id:'b1',category:'Materials',planned:100000,actual:150000}],
      changes:[],logEntries:[],commsEntries:[],documents:[],resources:[],stakeholders:[],meetings:[],raci:{tasks:[],persons:[],matrix:{}},charter:{targetCompletion:'2026-07-01'}};
    localStorage.setItem('mmgr_state_hot-project',JSON.stringify(hot));
    localStorage.setItem('mmgr_unlocked_hot-project','1');
    // demo-project is already unlocked in this profile
    var ranked=MMGR.Portfolio.rank([{id:'demo-project',title:'Demo'},{id:'hot-project',title:'Hotel'}]);
    var hotRow=ranked.filter(function(r){return r.project.id==='hot-project';})[0];
    var demoRow=ranked.filter(function(r){return r.project.id==='demo-project';})[0];
    var hotFirst=ranked[0].project.id==='hot-project';
    var health=hotRow.health?hotRow.health.score:null;
    var hasReason=hotRow.urgency.reason.length>3;
    var demoHasScore=!!demoRow && !!demoRow.health && demoRow.health.score!==null;
    var tiers={};
    ranked.forEach(function(r){tiers[r.project.id]=r.urgency.tier;});
    localStorage.removeItem('mmgr_state_hot-project');
    localStorage.removeItem('mmgr_unlocked_hot-project');
    return {val: hotFirst && health!==null && hasReason && demoHasScore && tiers['hot-project']==='high', health:health, reason:hotRow.urgency.reason, demoScore:demoRow?demoRow.health.score:null, order:ranked.map(function(r){return r.project.id;})};
  })()`);

  // ---- ACTION-PLAN Phase 7: weather-aware scheduling ----
  await check('58 forecast: module booted + dashboard cards + wx buttons present', `(function(){
    var ok=!!window.MMGR && !!MMGR.Forecast;
    var c1=!!document.getElementById('weather-forecast-card');
    var c2=!!document.getElementById('weather-log-card');
    var c3=!!document.getElementById('ld-sri-strip');
    var b1=!!document.querySelector('[data-action=wxGeocode]');
    var b2=!!document.querySelector('[data-action=wxRefresh]');
    var b3=!!document.querySelector('[data-action=wxLogToday]');
    var b4=!!document.querySelector('[data-action=wxCopyNotice]');
    return {val: ok&&c1&&c2&&c3&&b1&&b2&&b3&&b4, ok:ok, cards:c1&&c2&&c3, btns:b1&&b2&&b3&&b4};
  })()`);
  await check('59 forecast: no location -> setup hint, no throw', `(function(){
    MMGR.State.updateState(function(s){s.siteLat=null;s.siteLon=null;s.sitePlace='';s.wxCache=null;});
    MMGR.Render.renderDash();
    var b=document.getElementById('weather-forecast-body');
    var t=b?b.textContent:'';
    return {val: !!b && t.indexOf('No site location set')>-1, t:t.slice(0,90)};
  })()`);
  await check('60 forecast: seeded cache renders strip + risk flags + heat alert', `(function(){
    var iso=function(d){var x=new Date(d);return x.toISOString().slice(0,10);};
    var today=new Date();today.setHours(0,0,0,0);
    var days=[];
    for(var i=1;i<=8;i++){var dt=new Date(today.getTime()+i*86400000);days.push({date:iso(dt),code:0,precip:i===1?80:5,tMax:i===2?34:26,tMin:i===3?-3:16});}
    MMGR.State.updateState(function(s){s.siteLat=10.4;s.siteLon=-61.4;s.sitePlace='Test City';s.wxCache={at:Date.now(),lat:10.4,lon:-61.4,days:days};});
    MMGR.Render.renderDash();
    var b=document.getElementById('weather-forecast-body');
    var t=b?b.textContent:'';
    var strip=b?b.querySelectorAll('.wfr-day').length:0;
    var hc=MMGR.Forecast.heatColdAlert(MMGR.State.getState());
    var risk=MMGR.Forecast.riskDays(MMGR.State.getState());
    return {val: !!b && strip>=6 && t.indexOf('Test City')>-1 && t.indexOf('RISK')>-1 && !!hc && hc.kind==='heat' && risk.length>=2, strip:strip, heat:hc?hc.kind:null, riskN:risk.length};
  })()`);
  await check('61 forecast: precip>=60 / heat>=32 / cold<=0 thresholds flag', `(function(){
    var risk=MMGR.Forecast.riskDays(MMGR.State.getState());
    var precip=risk.filter(function(r){return r.precip>=60;})[0];
    var heat=risk.filter(function(r){return r.tMax>=34;})[0];
    var cold=risk.filter(function(r){return r.tMin<=0;})[0];
    var alertsOk=!!precip && precip.alerts.join(',').indexOf('precip 80%')>-1;
    var heatOk=!!heat && heat.alerts.join(',').indexOf('heat 34C')>-1;
    var coldOk=!!cold && cold.alerts.join(',').indexOf('cold -3C')>-1;
    return {val: alertsOk&&heatOk&&coldOk, precip:precip?precip.date:null, heat:heat?heat.date:null, cold:cold?cold.date:null};
  })()`);
  await check('62 wx log: logWeatherDay + LD/SRI strip compute + rate input', `(function(){
    MMGR.State.updateState(function(s){s.ldRate=5000;s.weatherLog=[];});
    MMGR.Forecast.logWeatherDay(MMGR.State.getState(),{note:'Rain',affectedTaskIds:['t1'],manual:true});
    MMGR.Forecast.logWeatherDay(MMGR.State.getState(),{note:'Storm',affectedTaskIds:[],manual:true});
    MMGR.Render.renderDash();
    var b=document.getElementById('weather-log-body');
    var rows=b?b.querySelectorAll('#weather-log-body tbody tr').length:0;
    var strip=document.getElementById('ld-sri-strip');
    var st=strip?strip.textContent:'';
    var ld=MMGR.Forecast.ldExposure(MMGR.State.getState());
    var sriV=MMGR.Forecast.sri(MMGR.State.getState());
    var rateIn=document.getElementById('wx-ld-rate');
    return {val: rows===2 && ld.days===2 && ld.exposure===10000 && st.indexOf('$10,000')>-1 && st.indexOf('Schedule Reliability')>-1 && !!sriV && sriV.index>=0 && !!rateIn, rows:rows, exposure:ld.exposure, sri:sriV?sriV.index:null, st:st.slice(0,160)};
  })()`);
  await check('63 wx log: delete entry + subcontractor notice composes', `(function(){
    MMGR.Forecast.delWeatherLogEntry(0);
    MMGR.Render.renderDash();
    var b=document.getElementById('weather-log-body');
    var rows=b?b.querySelectorAll('#weather-log-body tbody tr').length:0;
    var notice=MMGR.Forecast.subcontractorNotice(MMGR.State.getState());
    var hasHead=notice.indexOf('SUBCONTRACTOR WEATHER NOTICE')>-1;
    var hasRisk=notice.indexOf('Affects:')>-1 || notice.indexOf('No weather-sensitive')>-1;
    return {val: rows===1 && hasHead && hasRisk, rows:rows, notice:notice.slice(0,120)};
  })()`);
  await check('63b readonly scope: wxLogToday refused (mutating)', `(function(){
    localStorage.setItem('mmgr_scope_demo-project','readonly');
    return {val:true};
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);
  await check('63c readonly scope: wxLogToday blocked + toast, copy still works', `(function(){
    var before=(MMGR.State.getState().weatherLog||[]).length;
    document.querySelector('[data-action=wxLogToday]').click();
    var after=(MMGR.State.getState().weatherLog||[]).length;
    var toast=document.querySelector('.toast');
    var t=toast?toast.textContent:'';
    var copyOk=true;
    try{MMGR.App.wxCopyNotice();}catch(e){copyOk=false;}
    return {val: before===after && t.indexOf('View-only')>-1 && copyOk, before:before, after:after, toast:t, copyOk:copyOk};
  })()`);
  await ev(`localStorage.setItem('mmgr_scope_demo-project','full');`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);
  await check('63d full scope: wxLogToday works again', `(function(){
    var before=(MMGR.State.getState().weatherLog||[]).length;
    MMGR.App.wxLogToday();
    var after=(MMGR.State.getState().weatherLog||[]).length;
    return {val: after===before+1, before:before, after:after};
  })()`);

  await check('64 decisions+weather: cached risk days surface a Weather item', `(function(){
    // Self-seed wxCache (do NOT rely on debounced save landing before reloads)
    var iso=function(d){var x=new Date(d);return x.toISOString().slice(0,10);};
    var today=new Date();today.setHours(0,0,0,0);
    var days=[];
    for(var i=1;i<=5;i++){var dt=new Date(today.getTime()+i*86400000);days.push({date:iso(dt),code:0,precip:i===1?80:10,tMax:i===2?34:26,tMin:i===3?-3:16});}
    MMGR.State.updateState(function(s){s.siteLat=10.4;s.siteLon=-61.4;s.sitePlace='TC';s.wxCache={at:Date.now(),lat:10.4,lon:-61.4,days:days};});
    var items=MMGR.Decisions.compute(MMGR.State.getState());
    var wx=items.filter(function(i){return i.src==='Weather';})[0];
    var impactOrder=items.length>=2 && items[0].impact>=items[items.length-1].impact;
    return {val: !!wx && wx.title.indexOf('Weather risk')>-1 && wx.impact===12 && wx.detail.indexOf('precip 80%')>-1 && impactOrder, wx:wx?wx.detail:null, impact:wx?wx.impact:null, n:items.length};
  })()`);
  await check('65 portfolio wx: cached risk days produce a card badge', `(function(){
    // Pure function + render-path test with an explicitly seeded state, so it
    // never depends on debounced-save persistence across page reloads.
    var iso=function(d){var x=new Date(d);return x.toISOString().slice(0,10);};
    var today=new Date();today.setHours(0,0,0,0);
    var days=[];
    for(var i=1;i<=4;i++){var dt=new Date(today.getTime()+i*86400000);days.push({date:iso(dt),code:0,precip:i===1?85:5,tMax:26,tMin:14});}
    var fake={tasks:[{id:'f1',name:'F',status:'inprogress',startDate:'2026-06-01',endDate:'2026-07-01'}],issues:[],risks:[],budgetLines:[],changes:[],wxCache:{at:Date.now(),lat:1,lon:1,days:days}};
    var wN=MMGR.Portfolio.wxRiskDays(fake).length;
    var backup=localStorage.getItem('mmgr_state_demo-project');
    localStorage.setItem('mmgr_state_demo-project',JSON.stringify(fake));
    var host=document.createElement('div');host.id='portfolio-strip';document.body.appendChild(host);
    window.MMGR_PROJECTS=[{id:'demo-project',title:'Demo'}];
    MMGR.Portfolio.render();
    var t=host.textContent;
    var badge=t.indexOf('wx-risk')>-1;
    host.remove();
    delete window.MMGR_PROJECTS;
    if(backup!==null){localStorage.setItem('mmgr_state_demo-project',backup);}
    return {val: wN>=1 && badge, wN:wN, badge:badge, t:t.slice(0,140)};
  })()`);

  // ---- Definitions glossary ----
  await ev(`document.querySelector('.sec-btn[data-section=def]').click()`); await delay(300);
  await check('39 def: section switcher shows and panel activates', `(function(){var b=document.querySelector('.sec-btn[data-section=def]');var p=document.getElementById('panel-def');return {val: !!b && !!p && p.classList.contains('active')};})()`);
  await check('39b def: glossary renders data-driven cards', `(function(){var c=document.getElementById('def-container');var cards=c?c.querySelectorAll('.def-card').length:0;var terms=c?c.querySelectorAll('.def-term').length:0;return {val: !!c && cards >= 40 && terms === cards, cards: cards, terms: terms};})()`);
  await check('39c def: every card has a term, a meaning, and a why', `(function(){var c=document.getElementById('def-container');var cards=c?Array.prototype.slice.call(c.querySelectorAll('.def-card')):[];var bad=cards.filter(function(k){var t=k.querySelector('.def-term');var b=k.querySelector('.def-body');var w=k.querySelector('.def-why');return !t||!b||!w||t.textContent.trim().length===0||b.textContent.trim().length===0||w.textContent.trim().length===0;});return {val: bad.length===0,bad:bad.length};})()`);
  await check('39d def: re-render is idempotent (no duplicate cards)', `(function(){MMGR.Render.renderAll();var c=document.getElementById('def-container');return {val: !!c && c.querySelectorAll('.def-card').length === MMGR.Defs.DATA.length};})()`);
  await check('39e def: new-feature terms render (Decision Engine + SRI)', `(function(){var d=MMGR.Defs.DATA.map(function(x){return x.term;});var txt=document.getElementById('def-container').textContent;return {val: d.indexOf('Today\u2019s Decision Engine')>-1 && d.indexOf('Schedule Reliability Index')>-1 && txt.indexOf('Decision Engine')>-1 && txt.indexOf('Schedule Reliability Index')>-1, count: d.length};})()`);

  // ---- V10 features (ACTION-PLAN 3.2/3.3, item 23, 7.3, manual override, AI window) ----
  await check('64 v10 streak: dashboard card renders and bumps on updateState', `(function(){
    var el=document.getElementById('streak-body');
    var before=MMGR.State.getState().streak.count;
    MMGR.State.updateState(function(s){s.userName='v10-streak-a';});
    var after=MMGR.State.getState().streak.count;
    MMGR.Render.renderAll();
    var t=el?el.textContent:'';
    return {val: !!el && t.indexOf('day')>-1 && after>=before, before:before, after:after, t:t.slice(0,60)};
  })()`);
  await check('64b v10 kickoff agenda: PMBOK items (Assumptions/Constraints/Sign-Off/Success) present', `(function(){
    var items=MMGR.Meetings.MEET_KICKOFF_ITEMS||[];
    var txt=items.join(' ');
    return {val: txt.indexOf('Assumptions')>-1 && txt.indexOf('Constraints')>-1 && txt.indexOf('Sign-Off')>-1 && txt.indexOf('Success Criteria')>-1, n:items.length};
  })()`);
  await check('65 v10 sentiment: pulse records + sparkline renders', `(function(){
    var beforeH=(MMGR.State.getState().sentimentHistory||[]).length;
    MMGR.Meetings.startMeeting('weekly');
    var btn=document.querySelector('[data-action=meetSentiment][data-val=positive]');
    if(btn)btn.click();
    var h=MMGR.State.getState().sentimentHistory||[];
    var added=h.length-beforeH;
    MMGR.Render.renderAll();
    var wrap=document.getElementById('meet-sentiment-wrap');
    var bars=wrap?wrap.querySelectorAll('.sent-bar').length:0;
    MMGR.State.updateState(function(s){s.activeMeeting=null;});
    return {val: added===1 && h[beforeH] && h[beforeH].value==='positive' && !!wrap && !wrap.classList.contains('is-hide') && bars>=1, added:added, n:h.length, bars:bars};
  })()`);
  await check('66 v10 rolling leadtime: stale badge + Review stamp clears it', `(function(){
    var body=document.getElementById('leadtime-tracker-body');
    var t=body?body.textContent:'';
    var hasRoll=t.indexOf('Rolling 3-Month')>-1;
    var b=document.querySelector('[data-action=tglLeadtimeReview][data-id=t3]');
    var wasStale=!!(body&&body.querySelector('.ltr-roll .badge.br'));
    var preUpd=MMGR.State.getState().tasks.find(function(x){return x.id==='t3';}).leadtimeUpdatedAt;
    if(b)b.click();
    var upd=MMGR.State.getState().tasks.find(function(x){return x.id==='t3';}).leadtimeUpdatedAt;
    MMGR.Render.renderAll();
    var nowStale=!!(document.getElementById('leadtime-tracker-body')&&document.getElementById('leadtime-tracker-body').querySelector('.ltr-roll .badge.br'));
    return {val: hasRoll && !!b && wasStale && !!upd && preUpd!==upd && !nowStale, hasRoll:hasRoll, wasStale:wasStale, nowStale:nowStale, preUpd:preUpd, upd:upd};
  })()`);
  await check('67 v10 distributed float: per-task input + cascade honors wxFloatPad', `(function(){
    var backup=localStorage.getItem('mmgr_state_demo-project');
    MMGR.Schedule.cascade('northern-temperate',{threshold:999});
    MMGR.Render.renderAll();
    var inp=document.querySelector('.wx-dist input[data-wxpad=t1]');
    var before=MMGR.State.getState().tasks.find(function(t){return t.id==='t1';})._schedPad;
    MMGR.State.updateState(function(s){var t=s.tasks.find(function(x){return x.id==='t1';});if(t)t.wxFloatPad=5;});
    MMGR.Schedule.cascade('northern-temperate',{threshold:999});
    var after=MMGR.State.getState().tasks.find(function(t){return t.id==='t1';})._schedPad;
    MMGR.State.updateState(function(s){var t=s.tasks.find(function(x){return x.id==='t1';});if(t)t.wxFloatPad=0;});
    if(backup!==null){localStorage.setItem('mmgr_state_demo-project',backup);}
    return {val: !!inp && before!==null && after!==null && after>=before+4, before:before, after:after, input:!!inp};
  })()`);
  await check('68 v10 manual weather override: wxLogManual writes a manual entry', `(function(){
    var backup=localStorage.getItem('mmgr_state_demo-project');
    document.getElementById('wx-manual-cond').value='rain 30mm wind 40kmh';
    document.getElementById('wx-manual-note').value='Slab pour halted';
    document.querySelector('[data-action=wxLogManual]').click();
    var log=MMGR.State.getState().weatherLog||[];
    var last=log[log.length-1];
    var ok=!!last && last.condition==='rain 30mm wind 40kmh' && last.manual===true && last.note==='Slab pour halted';
    MMGR.Forecast.delWeatherLogEntry(log.length-1);
    if(backup!==null){localStorage.setItem('mmgr_state_demo-project',backup);}
    return {val: ok, condition:last&&last.condition, manual:last&&last.manual};
  })()`);
  await check('69 v10 AI window: presets + free-form + context dump + copy', `(function(){
    document.querySelector('[data-action=openAiWin]').click();
    var open=document.getElementById('ai-win').classList.contains('open');
    var chips=document.querySelectorAll('#ai-presets .ai-chip').length;
    var first=document.querySelector('#ai-presets .ai-chip');
    if(first)first.click();
    var q=document.getElementById('ai-q').value;
    document.querySelector('[data-action=aiAttachContext]').click();
    var ctx=document.getElementById('ai-ctx').value;
    var ctxOk=ctx.indexOf('## PROJECT')>-1 && ctx.indexOf('HEALTH')>-1;
    document.querySelector('[data-action=aiCopy]').click();
    var toastTxt=(document.querySelector('.toast')||{}).textContent||'';
    document.querySelector('[data-action=closeAiWin]').click();
    var closed=!document.getElementById('ai-win').classList.contains('open');
    return {val: open && chips>=10 && q.length>0 && ctxOk && closed && toastTxt.indexOf('copied')>-1, chips:chips, qlen:q.length, ctxLen:ctx.length, toast:toastTxt.slice(0,60)};
  })()`);
  // The readonly gate reads its scope at BOOT (like checks 51-51e) — flip it
  // with a Page.navigate, not a runtime localStorage write.
  await check('69b v10 AI window: closes via overlay click and Escape', `(function(){
    document.querySelector('[data-action=openAiWin]').click();
    var opened=document.getElementById('ai-win').classList.contains('open');
    document.getElementById('ai-win').click();
    var overlayClosed=!document.getElementById('ai-win').classList.contains('open');
    document.querySelector('[data-action=openAiWin]').click();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    var escClosed=!document.getElementById('ai-win').classList.contains('open');
    return {val: opened && overlayClosed && escClosed, opened:opened, overlayClosed:overlayClosed, escClosed:escClosed};
  })()`);
  await check('71 v10 wxlog copy: dispute-ready record (date/conditions/note/affected + LD)', `(function(){
    var backup=localStorage.getItem('mmgr_state_demo-project');
    MMGR.Forecast.logWeatherDay(MMGR.State.getState(),{note:'Pour halted',affectedTaskIds:['t1'],manual:true,condition:'heavy rain'});
    var captured='';
    var orig=MMGR.Utils.copyToClipboard;
    MMGR.Utils.copyToClipboard=function(txt){captured=txt;};
    MMGR.App.cpAllPage('wxlog');
    MMGR.Utils.copyToClipboard=orig;
    var ok=captured.indexOf('WEATHER DELAY LOG')>-1 && captured.indexOf('heavy rain')>-1 && captured.indexOf('Pour halted')>-1 && captured.indexOf('Affected: t1')>-1 && captured.indexOf('LD EXPOSURE')>-1;
    var entries=MMGR.State.getState().weatherLog||[];
    MMGR.Forecast.delWeatherLogEntry(entries.length-1);
    if(backup!==null){localStorage.setItem('mmgr_state_demo-project',backup);}
    return {val: ok, len:captured.length};
  })()`);
  await check('71b v10 forecast view: 7d/16d toggle switches strip + active chip', `(function(){
    var s=MMGR.State.getState();
    s.siteLat=10;s.siteLon=10;s.sitePlace='Test City';
    var fake={at:Date.now(),lat:10,lon:10,days:[]};
    for(var i=0;i<16;i++){var d=new Date();d.setDate(d.getDate()+i);fake.days.push({date:d.toISOString().slice(0,10),code:0,precip:0,tMax:20,tMin:10});}
    s.wxCache=fake;s.wxViewDays=7;
    MMGR.Render.renderAll();
    var n7=document.querySelectorAll('#weather-forecast-body .wfr-day').length;
    var chip7=document.querySelector('[data-action=wxSetView][data-days="7"]');
    var chip7On=chip7&&chip7.classList.contains('is-on');
    document.querySelector('[data-action=wxSetView][data-days="16"]').click();
    var n16=document.querySelectorAll('#weather-forecast-body .wfr-day').length;
    var chip16=document.querySelector('[data-action=wxSetView][data-days="16"]');
    var chip16On=chip16&&chip16.classList.contains('is-on');
    document.querySelector('[data-action=wxSetView][data-days="7"]').click();
    s.wxCache=null;
    MMGR.Render.renderAll();
    return {val: n7<=7 && n16>=14 && chip7On && chip16On, n7:n7, n16:n16, chip7On:chip7On, chip16On:chip16On};
  })()`);
  // ---- MASTER-ACTION-PLAN-v3-STRICT Rank 1: Evidence / Claim Pack ----
  await check('72 claim: nav + panel + controls present', `(function(){
    var btn = document.querySelector('.sec-btn[data-section=claim]');
    var exists = !!btn;
    if (btn) btn.click();
    var panel = document.getElementById('panel-claim');
    var active = !!panel && panel.classList.contains('active');
    return {val: exists && active && !!document.getElementById('claim-from') && !!document.getElementById('claim-to') && !!document.getElementById('claim-slips-body') && !!document.getElementById('claim-package-body'), active:active};
  })()`);
  await check('73 claim: slips derived baseline-vs-current, weather cause auto-tagged', `(function(){
    // NOTE: t2 is deleted earlier in the battery (check 16b) and earlier
    // cascades re-date t4 — capture the LIVE end date and build every date
    // relative to it, so the checks never depend on absolute seed dates.
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    var wd = new Date(new Date(orig + 'T00:00:00').getTime() + 2*86400000).toISOString().slice(0,10);
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){
      var t = st.tasks.find(function(x){ return x.id==='t4'; }); if (t) t.endDate = ne;
      if (!st.weatherLog) st.weatherLog = [];
      st.weatherLog.push({date: wd, condition:'heavy rain', note:'pour halted', affectedTaskIds:['t4'], manual:true});
    });
    var slips = MMGR.Claim.computeSlips(MMGR.State.getState());
    var t4 = slips.find(function(sl){ return sl.taskId==='t4'; });
    var ok = !!t4 && t4.days >= 10 && t4.cause === 'weather' && t4.causeSource === 'auto';
    MMGR.State.updateState(function(st){ st.weatherLog = []; var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, days: t4 && t4.days, cause: t4 && t4.cause};
  })()`);
  await check('74 claim: cause never blank — defaults to unknown without evidence', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){
      var t = st.tasks.find(function(x){ return x.id==='t4'; }); if (t) t.endDate = ne;
      st.weatherLog = []; st.changes = [];
    });
    var t4 = MMGR.Claim.computeSlips(MMGR.State.getState()).find(function(sl){ return sl.taskId==='t4'; });
    var ok = !!t4 && t4.cause === 'unknown' && t4.cause !== '' && t4.cause !== undefined;
    MMGR.State.updateState(function(st){ var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, cause: t4 && t4.cause};
  })()`);
  await check('75 claim: setCause persists a user override', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){ var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=ne; });
    MMGR.Claim.setCause('t4', 'predecessor');
    var t4 = MMGR.Claim.computeSlips(MMGR.State.getState()).find(function(sl){ return sl.taskId==='t4'; });
    var persisted = MMGR.State.getState().slipCauses['t4'] === 'predecessor';
    var ok = !!t4 && t4.cause === 'predecessor' && t4.causeSource === 'user' && persisted;
    MMGR.State.updateState(function(st){ var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; if(st.slipCauses)delete st.slipCauses['t4']; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, cause: t4 && t4.cause, persisted: persisted};
  })()`);
  await check('76 claim: buildClaimPack pulls the full package live from state', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    var wd = new Date(new Date(orig + 'T00:00:00').getTime() + 2*86400000).toISOString().slice(0,10);
    var fromD = new Date(new Date(orig + 'T00:00:00').getTime() - 5*86400000).toISOString().slice(0,10);
    var toD = new Date(new Date(orig + 'T00:00:00').getTime() + 25*86400000).toISOString().slice(0,10);
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){
      var t = st.tasks.find(function(x){ return x.id==='t4'; }); if (t) t.endDate = ne;
      if (!st.weatherLog) st.weatherLog = [];
      st.weatherLog.push({date: wd, condition:'heavy rain', note:'Pour halted', affectedTaskIds:['t4'], manual:true});
      if (!st.changes) st.changes = [];
      st.changes.push({id:'C1', date: new Date(new Date(orig + 'T00:00:00').getTime() + 1*86400000).toISOString().slice(0,10), title:'Owner change order', requester:'Owner', schedImpact:'+5d', costImpact:'+$50k', status:'approved', approvedBy:'', notes:'t4'});
      if (!st.commsEntries) st.commsEntries = [];
      st.commsEntries.push({id:'C2', date: new Date(new Date(orig + 'T00:00:00').getTime() + 3*86400000).toISOString().slice(0,10), type:'Site meeting', attendees:'', summary:'Weather impact discussed', actionItems:'Notify insurer', followUp:''});
      st.ldRate = 5000;
    });
    var pack = MMGR.Claim.buildClaimPack(MMGR.State.getState(), fromD, toD);
    var hasWx = pack.weatherDelays.length === 1 && pack.weatherDelays[0].affectedTaskIds.indexOf('t4') > -1;
    var hasTask = pack.affectedTasks.some(function(t){ return t.id === 't4'; });
    var hasSlip = pack.slips.length >= 1 && pack.slips[0].cause !== '';
    var hasLD = pack.ld.exposure === 5000 && pack.ld.rate === 5000;
    var hasChg = pack.changeControl.some(function(c){ return c.title.indexOf('Owner') > -1; });
    var hasMeet = pack.meetings.some(function(m){ return m.actions.indexOf('insurer') > -1 || m.actions.indexOf('Insurer') > -1; });
    var narrOk = pack.narrative.indexOf('weather-delay') > -1 || pack.narrative.indexOf('weather delay') > -1;
    var ok = hasWx && hasTask && hasSlip && hasLD && hasChg && hasMeet && narrOk;
    MMGR.State.updateState(function(st){ st.weatherLog = []; st.ldRate = 0; if(st.changes)st.changes = st.changes.filter(function(c){return c.id!=='C1';}); if(st.commsEntries)st.commsEntries = st.commsEntries.filter(function(c){return c.id!=='C2';}); var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, wx: pack.weatherDelays.length, slips: pack.slips.length, ld: pack.ld.exposure, chg: pack.changeControl.length, meets: pack.meetings.length};
  })()`);
  await check('77 claim: Copy All exports the package via the claim section', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    var wd = new Date(new Date(orig + 'T00:00:00').getTime() + 2*86400000).toISOString().slice(0,10);
    var fromD = new Date(new Date(orig + 'T00:00:00').getTime() - 5*86400000).toISOString().slice(0,10);
    var toD = new Date(new Date(orig + 'T00:00:00').getTime() + 25*86400000).toISOString().slice(0,10);
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){
      var t = st.tasks.find(function(x){ return x.id==='t4'; }); if (t) t.endDate = ne;
      if (!st.weatherLog) st.weatherLog = [];
      st.weatherLog.push({date: wd, condition:'heavy rain', note:'', affectedTaskIds:['t4'], manual:true});
      st.ldRate = 5000;
    });
    var f = document.getElementById('claim-from'), tt = document.getElementById('claim-to');
    if (f) f.value = fromD;
    if (tt) tt.value = toD;
    var captured = '';
    var origCp = MMGR.Utils.copyToClipboard;
    MMGR.Utils.copyToClipboard = function(txt){ captured = txt; };
    MMGR.App.cpAllPage('claim');
    MMGR.Utils.copyToClipboard = origCp;
    var ok = captured.indexOf('CLAIM / DELAY PACKAGE') > -1 && captured.indexOf('heavy rain') > -1 && captured.indexOf('BASELINE VS ACTUAL') > -1 && captured.indexOf('LD / CONTRACT EXPOSURE') > -1 && captured.indexOf('CAUSE') > -1;
    MMGR.State.updateState(function(st){ st.weatherLog = []; st.ldRate = 0; var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, len: captured.length};
  })()`);
  await check('78 claim: budget tab LD rollup renders avoided vs incurred', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    var wd = new Date(new Date(orig + 'T00:00:00').getTime() + 2*86400000).toISOString().slice(0,10);
    var expected = '$' + (20 * 1000).toLocaleString();
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){
      var t = st.tasks.find(function(x){ return x.id==='t4'; }); if (t) t.endDate = ne;
      if (!st.weatherLog) st.weatherLog = [];
      st.weatherLog.push({date: wd, condition:'rain', note:'', affectedTaskIds:['t4'], manual:true});
      st.ldRate = 1000;
    });
    MMGR.Render.renderBudget();
    var el = document.getElementById('ld-rollup-body');
    var txt = el ? el.textContent : '';
    var ok = !!el && txt.indexOf('Avoided') > -1 && txt.indexOf('Incurred') > -1 && txt.indexOf(expected) > -1;
    MMGR.State.updateState(function(st){ st.weatherLog = []; st.ldRate = 0; var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; });
    MMGR.Render.renderBudget();
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, txt: txt.slice(0, 160), expected: expected};
  })()`);
  await check('79 phase0: unload-safety flush persists dirty edits (flushSave + beforeunload)', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    MMGR.State.updateState(function(s){ s.userName = 'FlushTest'; });
    MMGR.State.flushSave();
    var stored = JSON.parse(localStorage.getItem('mmgr_state_demo-project') || '{}');
    var okFlush = stored.userName === 'FlushTest';
    MMGR.State.updateState(function(s){ s.userName = 'VisTest'; });
    window.dispatchEvent(new Event('beforeunload'));
    var stored2 = JSON.parse(localStorage.getItem('mmgr_state_demo-project') || '{}');
    var okBunload = stored2.userName === 'VisTest';
    MMGR.State.updateState(function(s){ s.userName = (backup ? JSON.parse(backup).userName : '') || ''; });
    MMGR.State.flushSave();
    return {val: okFlush && okBunload, okFlush: okFlush, okBunload: okBunload};
  })()`);
  await check('79b claim: Generate Package button path populates the preview', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    var wd = new Date(new Date(orig + 'T00:00:00').getTime() + 2*86400000).toISOString().slice(0,10);
    var fromD = new Date(new Date(orig + 'T00:00:00').getTime() - 5*86400000).toISOString().slice(0,10);
    var toD = new Date(new Date(orig + 'T00:00:00').getTime() + 25*86400000).toISOString().slice(0,10);
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){
      var t = st.tasks.find(function(x){ return x.id==='t4'; }); if (t) t.endDate = ne;
      if (!st.weatherLog) st.weatherLog = [];
      st.weatherLog.push({date: wd, condition:'heavy rain', note:'', affectedTaskIds:['t4'], manual:true});
    });
    var f = document.getElementById('claim-from'), tt = document.getElementById('claim-to');
    if (f) f.value = fromD;
    if (tt) tt.value = toD;
    var genBtn = document.querySelector('[data-action=claimGenerate]');
    var beforeHtml = document.getElementById('claim-package-body').innerHTML;
    if (genBtn) genBtn.click();
    var after = document.getElementById('claim-package-body').innerHTML;
    // The preview content is what matters — the button must populate the
    // weather row (date + conditions + affected task) and the stats strip.
    var ok = !!genBtn && beforeHtml !== after && after.indexOf('heavy rain') > -1 && after.indexOf('LD Exposure') > -1 && after.indexOf(wd) > -1 && after.indexOf('t4') > -1;
    MMGR.State.updateState(function(st){ st.weatherLog = []; var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, changed: beforeHtml !== after, hasRain: after.indexOf('heavy rain') > -1, hasDate: after.indexOf(wd) > -1};
  })()`);
  await check('79c claim: reversed date range is refused with a toast', `(function(){
    var f = document.getElementById('claim-from'), tt = document.getElementById('claim-to');
    if (f) f.value = '2026-12-31';
    if (tt) tt.value = '2026-01-01';
    var before = document.getElementById('claim-package-body').innerHTML.length;
    var genBtn = document.querySelector('[data-action=claimGenerate]');
    if (genBtn) genBtn.click();
    var toast = document.querySelector('.toast');
    var txt = toast ? toast.textContent : '';
    var after = document.getElementById('claim-package-body').innerHTML.length;
    if (f) f.value = '';
    if (tt) tt.value = '';
    return {val: txt.indexOf('reversed') > -1 && after === before, toast: txt};
  })()`);

  // ---- Rank 2 (MASTER-ACTION-PLAN-v3-STRICT): Weekly/Daily Digest Engine ----
  await check('80 digest: dashboard card renders with mode fallback', `(function(){
    var card = document.getElementById('digest-card');
    var body = document.getElementById('digest-body');
    MMGR.Render.renderDash();
    var html = body ? body.innerHTML : '';
    return {val: !!card && !!body && html.length > 50, len: html.length, hasSec: html.indexOf('digest-sec') > -1};
  })()`);
  await check('81 digest: pin captures a compact reference snapshot (schema v13)', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    MMGR.Digest.pin();
    var s = MMGR.State.getState();
    var snap = s.digestSnapshot;
    var ok = !!snap && Array.isArray(snap.tasks) && snap.tasks.length > 0 && typeof snap.at === 'string' && !!snap.at;
    var d = MMGR.Digest.computeDigest(s);
    var label = MMGR.Digest.referenceLabel(d);
    MMGR.State.updateState(function(st){ st.digestSnapshot = null; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok && label.indexOf('pinned') > -1, tasks: snap ? snap.tasks.length : -1, label: label};
  })()`);
  await check('82 digest: diff vs pinned snapshot catches completed + slipped', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var origEnd = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var target = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.status!=='completed';}); return t?t:null; })();
    if (!target) return {val:false, why:'no non-completed task in seed'};
    var targetStatus = target.status;
    MMGR.Digest.pin();
    MMGR.State.updateState(function(st){
      var t4 = st.tasks.find(function(x){ return x.id==='t4'; });
      if (t4) t4.endDate = new Date(new Date(origEnd + 'T00:00:00').getTime() + 12*86400000).toISOString().slice(0,10);
      var tgt = st.tasks.find(function(x){ return x.id === (target && target.id); });
      if (tgt) tgt.status = 'completed';
    });
    var d = MMGR.Digest.computeDigest();
    var completedHit = d.completed.indexOf(target ? target.name : '') > -1;
    var slippedHit = d.slipped.some(function(x){ return x.days === 12; });
    MMGR.State.updateState(function(st){
      var t4 = st.tasks.find(function(x){ return x.id==='t4'; });
      if (t4) t4.endDate = origEnd;
      var tgt = st.tasks.find(function(x){ return x.id === (target && target.id); });
      if (tgt) tgt.status = targetStatus;
      st.digestSnapshot = null;
    });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: completedHit && slippedHit, completed: d.completed.slice(0,3), slipped: d.slipped.slice(0,3)};
  })()`);
  await check('83 digest: Copy All exports the digest text', `(function(){
    var captured = '';
    var origCp = MMGR.Utils.copyToClipboard;
    MMGR.Utils.copyToClipboard = function(txt){ captured = txt; };
    MMGR.App.cpAllPage('digest');
    MMGR.Utils.copyToClipboard = origCp;
    return {val: captured.indexOf('WEEKLY / DAILY DIGEST') > -1 && captured.indexOf('Reference:') > -1, len: captured.length};
  })()`);
  await check('84 digest: Generate Now button path populates the card', `(function(){
    var btn = document.querySelector('[data-action=digestGenerate]');
    var before = document.getElementById('digest-body').innerHTML.length;
    MMGR.Digest.generate();
    var after = document.getElementById('digest-body').innerHTML.length;
    var toast = document.querySelector('.toast');
    var txt = toast ? toast.textContent : '';
    return {val: !!btn && after > 50 && txt.indexOf('Digest generated') > -1, changed: before !== after, toast: txt};
  })()`);
  await check('85 prompts: claim + digest presets grounded in live evidence', `(function(){
    var claim = MMGR.Prompts.generate('claim');
    var digest = MMGR.Prompts.generate('digest');
    var list = MMGR.Prompts.list().indexOf('claim') > -1;
    var labels = (window.MMGR.AiWin && MMGR.AiWin.PRESET_LABELS) ? MMGR.AiWin.PRESET_LABELS.claim : '';
    return {val: claim.indexOf('SCHEDULE SLIPS') > -1 && claim.indexOf('LIQUIDATED DAMAGES EXPOSURE') > -1 && digest.indexOf('WEEKLY DIGEST') > -1 && list && labels === 'Claim Pack', claimLen: claim.length, label: labels};
  })()`);
  await check('86 claim: export reads like a counsel-ready print document', `(function(){
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 12*86400000).toISOString().slice(0,10);
    var wd = new Date(new Date(orig + 'T00:00:00').getTime() + 2*86400000).toISOString().slice(0,10);
    var fromD = new Date(new Date(orig + 'T00:00:00').getTime() - 5*86400000).toISOString().slice(0,10);
    var toD = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){
      var t = st.tasks.find(function(x){ return x.id==='t4'; }); if (t) t.endDate = ne;
      if (!st.weatherLog) st.weatherLog = [];
      st.weatherLog.push({date: wd, condition:'heavy rain', note:'Pour halted', affectedTaskIds:['t4'], manual:true});
      st.ldRate = 5000;
      st.userName = 'Jane Contractor';
    });
    var txt = MMGR.Claim.claimPackText(MMGR.Claim.buildClaimPack(MMGR.State.getState(), fromD, toD));
    var lines = txt.split('\\n');
    var secs = [];
    lines.forEach(function(l){ var m = l.match(/^([1-9])\. ([A-Z][A-Z &\-\/]+)/); if (m) secs.push(m[1]); });
    var ordered = secs.join(',') === '1,2,3,4,5,6,7,8,9';
    var titles = ['EXECUTIVE NARRATIVE','SCHEDULE DELTA','WEATHER DELAY LOG','AFFECTED WBS TASKS','LD / CONTRACT EXPOSURE','CHANGE CONTROL','MEETING DECISIONS','CARRIED-FORWARD','ATTESTATION'];
    var allTitles = titles.every(function(t){ return txt.indexOf(t) > -1; });
    var maxLine = Math.max.apply(null, lines.map(function(l){ return l.length; }));
    var firstLine = lines[0] || '';
    var headerOk = firstLine.indexOf('=') === 0 && txt.indexOf('CLAIM / DELAY PACKAGE') > -1 && txt.indexOf('Project:') > -1 && txt.indexOf('Reporting window:') > -1 && txt.indexOf('Prepared:') > -1 && txt.indexOf('Document ref:     CLAIM-') > -1;
    var attestOk = txt.indexOf('Signature:') > -1 && txt.indexOf('Name:          Jane Contractor') > -1 && txt.indexOf('Role:') > -1 && txt.indexOf('Date:') > -1;
    var aligned = txt.indexOf('TASK') > -1 && txt.indexOf('BASELINE END') > -1 && txt.indexOf('CURRENT END') > -1 && txt.indexOf('CAUSE') > -1;
    var foot = txt.split('\\n').slice(-2).join(' ').indexOf('Prepared by My MaNaGeR') > -1;
    var ok = ordered && allTitles && headerOk && attestOk && aligned && foot && maxLine < 100 && txt.length > 1500;
    MMGR.State.updateState(function(st){ st.weatherLog = []; st.ldRate = 0; st.userName = ''; var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, secs: secs.join(','), maxLine: maxLine, headerOk: headerOk, attestOk: attestOk, aligned: aligned, foot: foot, len: txt.length};
  })()`);
  await check('87 claim: later weather entry re-tags a slip from unknown to weather (pure re-derivation)', `(function(){
    // computeSlips() is a PURE derivation over live state — a slip logged as
    // 'unknown' at package time must re-tag to 'weather' the moment a weather
    // entry naming the task arrives LATER (inside the slip window), with zero
    // re-entry. A user override (state.slipCauses) must still win over the
    // auto re-tag — evidence cannot silently overwrite an explicit decision.
    var backup = localStorage.getItem('mmgr_state_demo-project');
    var orig = (function(){ var t=MMGR.State.getState().tasks.find(function(x){return x.id==='t4';}); return t?t.endDate:'2026-10-15'; })();
    var ne = new Date(new Date(orig + 'T00:00:00').getTime() + 20*86400000).toISOString().slice(0,10);
    var wd = new Date(new Date(orig + 'T00:00:00').getTime() + 2*86400000).toISOString().slice(0,10);
    MMGR.State.saveBaseline();
    MMGR.State.updateState(function(st){
      var t = st.tasks.find(function(x){ return x.id==='t4'; }); if (t) t.endDate = ne;
      st.weatherLog = []; st.changes = []; st.slipCauses = {};
    });
    var findT4 = function(){ return MMGR.Claim.computeSlips(MMGR.State.getState()).find(function(sl){ return sl.taskId==='t4'; }); };
    var before = findT4();
    var beforeOk = !!before && before.cause === 'unknown';
    // Add the weather evidence AFTER the fact — inside the slip window.
    MMGR.State.updateState(function(st){
      if (!st.weatherLog) st.weatherLog = [];
      st.weatherLog.push({date: wd, condition:'heavy rain', note:'late log entry', affectedTaskIds:['t4'], manual:true});
    });
    var after = findT4();
    var retagOk = !!after && after.cause === 'weather' && after.causeSource === 'auto';
    // User override must survive the new evidence.
    MMGR.State.updateState(function(st){ st.slipCauses['t4'] = 'predecessor'; });
    var overridden = findT4();
    var overrideOk = !!overridden && overridden.cause === 'predecessor' && overridden.causeSource === 'user';
    var ok = beforeOk && retagOk && overrideOk;
    MMGR.State.updateState(function(st){ st.weatherLog = []; st.changes = []; st.slipCauses = {}; var t=st.tasks.find(function(x){return x.id==='t4';}); if(t)t.endDate=orig; st.baseline=null; });
    if (backup !== null) { localStorage.setItem('mmgr_state_demo-project', backup); }
    return {val: ok, before: before && before.cause, after: after && after.cause, afterSrc: after && after.causeSource, overridden: overridden && overridden.cause};
  })()`);
  await check('70 v10 readonly: enter view-only scope', `(function(){localStorage.setItem('mmgr_scope_demo-project','readonly');return {val:true};})()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);
  await check('70b v10 readonly: wxLogManual + meetSentiment blocked, AI window allowed', `(function(){
    var banner=document.getElementById('readonly-banner');
    var ro=document.body.classList.contains('readonly-mode');
    MMGR.Meetings.startMeeting('weekly');
    var hb=MMGR.State.getState().sentimentHistory.length;
    var sb=document.querySelector('[data-action=meetSentiment][data-val=positive]'); if(sb)sb.click();
    var grew=MMGR.State.getState().sentimentHistory.length>hb;
    MMGR.State.updateState(function(s){s.activeMeeting=null;});
    var cond=document.getElementById('wx-manual-cond'); if(cond)cond.value='test';
    var n=MMGR.State.getState().weatherLog.length;
    var b=document.querySelector('[data-action=wxLogManual]'); if(b)b.click();
    var logGrew=MMGR.State.getState().weatherLog.length>n;
    document.querySelector('[data-action=openAiWin]').click();
    var aiOk=document.getElementById('ai-win').classList.contains('open');
    document.querySelector('[data-action=closeAiWin]').click();
    return {val: ro && !!banner && !banner.classList.contains('is-hide') && !grew && !logGrew && aiOk, ro:ro, grew:grew, logGrew:logGrew, aiOk:aiOk};
  })()`);
  await check('70g v10 readonly: digestGenerate allowed (read-only), digestPin refused', `(function(){
    var ro=document.body.classList.contains('readonly-mode');
    var beforeSnap=MMGR.State.getState().digestSnapshot;
    MMGR.State.updateState(function(s){s.digestSnapshot=null;});
    var gen=document.querySelector('[data-action=digestGenerate]'); if(gen)gen.click();
    var cardLen=document.getElementById('digest-body').innerHTML.length;
    var pin=document.querySelector('[data-action=digestPin]'); if(pin)pin.click();
    var afterSnap=MMGR.State.getState().digestSnapshot;
    var toast=document.querySelector('.toast');
    var txt=toast?toast.textContent:'';
    return {val: ro && cardLen>50 && afterSnap===null && txt.indexOf('View-only')>-1, ro:ro, cardLen:cardLen, pinned:afterSnap!==null, toast:txt.slice(0,60)};
  })()`);
  await ev(`localStorage.setItem('mmgr_scope_demo-project','full');`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);
  await check('70c v10 readonly: full scope restores editing', `(function(){
    var banner=document.getElementById('readonly-banner');
    return {val: !document.body.classList.contains('readonly-mode') && !!banner && banner.classList.contains('is-hide')};
  })()`);

  // Interaction audit (P2): the view-only unlock flow — admin publishes
  // roCodeHash (see admin.html); app.html must map it to the readonly
  // scope flag that project.html's gate reads. This runs against app.html
  // itself, which the rest of the battery never loads.
  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(2500);
  await check('70d v10 readonly: app.html roCodeHash unlocks into readonly scope', `(async function(){
    var code = 'QA-RO-CODE-9241';
    var hash = await mmgrHash(code);
    activeProject = {id:'qa-ro', title:'QA RO', description:'', status:'active', file:'project.html?id=demo-project', codeHash:'not-the-hash', roCodeHash:hash};
    document.getElementById('code-input').value = code;
    await attemptUnlock();
    var scope = localStorage.getItem('mmgr_scope_qa-ro');
    var unlocked = localStorage.getItem('mmgr_unlocked_qa-ro');
    localStorage.removeItem('mmgr_scope_qa-ro');
    localStorage.removeItem('mmgr_unlocked_qa-ro');
    return {val: scope === 'readonly' && unlocked === '1', scope:scope, unlocked:unlocked};
  })()`);
  await check('70f manifest: published demo roCodeHash unlocks viewdemo into readonly', `(async function(){
    var rec = window.MMGR_PROJECTS ? window.MMGR_PROJECTS.find(function(p){ return p.id === 'demo-project'; }) : null;
    if(!rec || !rec.roCodeHash) return {val:false, why:'no roCodeHash in manifest', ro: rec && rec.roCodeHash ? rec.roCodeHash.slice(0,8) : null};
    // Test isolation: capture the demo project's pre-existing unlock keys and
    // restore them afterwards — attemptUnlock() overwrites them and schedules
    // a 400ms navigation, and later checks (70e) depend on the scope key being
    // present so project.html opens past its gate.
    var prevUnlocked = localStorage.getItem('mmgr_unlocked_demo-project');
    var prevScope = localStorage.getItem('mmgr_scope_demo-project');
    activeProject = rec;
    document.getElementById('code-input').value = 'viewdemo';
    await attemptUnlock();
    var scope = localStorage.getItem('mmgr_scope_demo-project');
    var unlocked = localStorage.getItem('mmgr_unlocked_demo-project');
    if(prevUnlocked === null) localStorage.removeItem('mmgr_unlocked_demo-project'); else localStorage.setItem('mmgr_unlocked_demo-project', prevUnlocked);
    if(prevScope === null) localStorage.removeItem('mmgr_scope_demo-project'); else localStorage.setItem('mmgr_scope_demo-project', prevScope);
    return {val: scope === 'readonly' && unlocked === '1', scope:scope, unlocked:unlocked, ro:rec.roCodeHash.slice(0,8)};
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3000);

  // Interaction audit (P2): WBS task-name editing must be blocked in the
  // view-only scope (the name span is not covered by the input pointer guard).
  await ev(`localStorage.setItem('mmgr_scope_demo-project','readonly');`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3000);
  await check('70e v10 readonly: WBS task-name edit blocked in view-only scope', `(function(){
    var wbsBtn = document.querySelector('.sec-btn[data-section=wbs]');
    if (wbsBtn) wbsBtn.click();
    MMGR.Render.renderWbs();
    var row = document.querySelector('#wbs-body tr.wbs-row');
    if(!row) return {val:false, why:'no wbs row'};
    var span = row.querySelector('.wbs-name');
    if(!span) return {val:false, why:'no name span'};
    var id = row.getAttribute('data-id');
    span.click();
    var inp = row.querySelector('input.wbs-name-input');
    var s2 = MMGR.State.getState();
    var name = s2.tasks.find(function(t){return t.id===id;}).name;
    return {val: !inp, inp: !!inp, name: name};
  })()`);
  await ev(`localStorage.setItem('mmgr_scope_demo-project','full');`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3000);

  // ---- DIR-1 (ADMIN-PUBLISH-SYNC-AND-PROJECT-SELECT-POLISH): local-first
  // creator access — a project created on THIS device (admin.html's
  // mmgr_admin_projects) must render on app.html and open instantly with zero
  // code re-entry. The publish/deploy step gates only OTHER people's access,
  // never the creator's own. ----
  await ev(`localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-local', title:'QA Local Project', description:'created on this device', status:'planning', file:'project.html?id=qa-local', code:'QLOCAL1', codeHash:'x'}]));`);
  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(2500);
  await check('70g v11 local-first: locally-created project renders with On-this-device + Not-published chips', `(function(){
    var card = document.querySelector('.pcard[data-id="qa-local"]');
    return {val: !!card && !!card.querySelector('.pc-chip.pc-local') && !!card.querySelector('.pc-chip.pc-note'), hasCard: !!card};
  })()`);
  // The click is synchronous up to the navigation assignment, so all side
  // effects (full-scope unlock, no modal) are readable before unload. The
  // navigation to project.html?id=qa-local itself is verified by 70j.
  await check('70h v11 local-first: local project click = instant full unlock, no unlock modal', `(function(){
    handleCardClick('qa-local');
    var modalOpen = document.getElementById('om').classList.contains('open');
    var unlocked = localStorage.getItem('mmgr_unlocked_qa-local') === '1';
    var scope = localStorage.getItem('mmgr_scope_qa-local');
    return {val: !modalOpen && unlocked && scope === 'full', modalOpen: modalOpen, unlocked: unlocked, scope: scope};
  })()`);
  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(2500);
  // Visitor path must be unchanged: a published-only (non-local) project still
  // opens the access-code modal — publish validation still gates strangers.
  await check('70i v11 local-first: published-only project still opens the unlock modal', `(function(){
    var prevU = localStorage.getItem('mmgr_unlocked_demo-project');
    var prevS = localStorage.getItem('mmgr_scope_demo-project');
    localStorage.removeItem('mmgr_unlocked_demo-project');
    localStorage.removeItem('mmgr_scope_demo-project');
    var local = isLocalProject('demo-project');
    handleCardClick('demo-project');
    var modalOpen = document.getElementById('om').classList.contains('open');
    closeModal();
    if(prevU === null) localStorage.removeItem('mmgr_unlocked_demo-project'); else localStorage.setItem('mmgr_unlocked_demo-project', prevU);
    if(prevS === null) localStorage.removeItem('mmgr_scope_demo-project'); else localStorage.setItem('mmgr_scope_demo-project', prevS);
    return {val: modalOpen && !local, modalOpen: modalOpen, local: local};
  })()`);
  // Deep-link: project.html?id=qa-local with NO unlock flag set must pass the
  // gate purely because this device owns the project (mmgr_app checkAccess).
  await ev(`localStorage.removeItem('mmgr_unlocked_qa-local'); localStorage.removeItem('mmgr_scope_qa-local');`);
  await send('Page.navigate', { url: BASE + '/project.html?id=qa-local' }); await delay(3000);
  await check('70j v11 local-first: deep link to a locally-owned project bypasses the gate', `(function(){
    return {val: location.pathname.indexOf('project.html') > -1 && location.search.indexOf('locked') === -1 && !!window.MMGR && !!MMGR.App, href: location.href};
  })()`);
  await ev(`localStorage.removeItem('mmgr_admin_projects'); localStorage.removeItem('mmgr_unlocked_qa-local'); localStorage.removeItem('mmgr_scope_qa-local');`);
  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(2500);

  // ---- DOM-id contract (P2, interaction audit): every literal $('...') /
  // getElementById('...') target in render.js must exist in project.html.
  // This is the regression net for the kanban/import id class of bugs. ----
  {
    const fs = require('fs');
    const html = fs.readFileSync(path.join(__dirname, 'project.html'), 'utf8');
    const rsrc = fs.readFileSync(path.join(__dirname, 'js/mmgr-render.js'), 'utf8');
    const re = /\$\('([a-zA-Z0-9-]+)'\)|getElementById\('([a-zA-Z0-9-]+)'\)/g;
    const found = new Set();
    let mm;
    while ((mm = re.exec(rsrc)) !== null) found.add(mm[1] || mm[2]);
    const missing = Array.from(found).filter(id => html.indexOf('id="' + id + '"') === -1);
    results.push({ status: missing.length ? 'FAIL' : 'PASS', name: 'domid: every render.js $() target exists in project.html', detail: missing.length ? 'MISSING: ' + missing.join(', ') : found.size + ' ids checked, all present' });
  }

  // Interaction re-audit (should-fix #5): the demo project must publish a
  // view-only hash so the read-only path is demonstrable out of the box.
  {
    const fs = require('fs');
    const pjs = fs.readFileSync(path.join(__dirname, 'projects-data.js'), 'utf8');
    const ro = pjs.indexOf('roCodeHash') > -1;
    results.push({ status: ro ? 'PASS' : 'FAIL', name: 'manifest: demo project publishes roCodeHash for view-only', detail: ro ? 'roCodeHash present in projects-data.js' : 'MISSING roCodeHash' });
  }

  // ---- Console error summary ----
  // The DOCX charter error is the app's *intentional, verified* fallback (checks
  // 18/18e/18f assert it) — not a stray console error.
  const meaningful = consoleErrors.filter(e => e.indexOf('favicon') === -1 && e.indexOf('404') === -1 && e.indexOf('DOCX files can') === -1);
  log('\n==== CONSOLE ERRORS (' + meaningful.length + ') ====');
  meaningful.slice(0, 15).forEach(e => log('  ! ' + e));
  log('==== PAGE EXCEPTIONS (' + pageErrors.length + ') ====');
  pageErrors.slice(0, 10).forEach(e => log('  ! ' + e));

  const fails = results.filter(r => r.status === 'FAIL');
  const passes = results.length - fails.length;
  log('\n==== QA SUMMARY: ' + passes + ' passed / ' + fails.length + ' failed of ' + results.length + ' ====');
  if (fails.length) {
    log('FAILED CHECKS:');
    fails.forEach(f => log('  - ' + f.name + ' :: ' + f.detail));
  }
  proc.kill();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
