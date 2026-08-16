/* ============================================================
   My MaNaGeR — MARKET-FEATURE-ROADMAP Section A smoke harness
   Drives headless Chrome against http://127.0.0.1:8765 and
   verifies the A1/A2/A3/A4/A5/A7 implementations end-to-end:
   - A1/A5: stakeholder COI/license expiry + EMR staleness
   - A2: lien-waiver status on budget lines
   - A3: bid leveling (T8 rebuild — modal-created packages, leveled grid
     with base totals / leveling adjustments / true leveled totals /
     variance, per-sub award/proposal/clarify actions, legacy migration)
   - A4: Go/No-Go weighted star scorecard (category weights, live score,
     GO/REVIEW/NO-GO verdicts, automation bar)
   - A7: claim-compliance AI preset (prompt + local builder)
   Usage: node tools/qa-market-features.cjs  (serve.cjs on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9231;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-mkt-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => process.stdout.write(s + '\n');
setTimeout(() => { log('WATCHDOG TIMEOUT'); process.exit(2); }, 120000);

function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => { pending.delete(id); res(m.result || {}); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
  return r.result && r.result.value;
}
async function check(name, expr, hint) {
  const v = await ev(expr);
  const ok = !!v && v.__err === undefined && v.val === true;
  results.push({ status: ok ? 'PASS' : 'FAIL', name });
  log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : '  <-- ' + (v && (v.__err || JSON.stringify(v))) + (hint ? ' (' + hint + ')' : '')}`);
  return v;
}

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  // Wait for the debugger endpoint
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json');
      const list = await r.json();
      const page = list.find(x => x.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) {}
    if (!wsUrl) await delay(250);
  }
  if (!wsUrl) { log('Chrome debugger not reachable'); process.exit(1); }
  ws = new WebSocket(wsUrl);
  await new Promise(res => ws.addEventListener('open', res));
  ws.addEventListener('message', function(evt) {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  });
  await send('Runtime.enable');
  await send('Page.enable');

  // Same boot discipline as qa-full.cjs: seed-test.html first populates the
  // profile's localStorage (unlocked demo-project etc.), THEN the project page.
  await send('Page.navigate', { url: BASE + '/seed-test.html' });
  await delay(4500);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' });
  await delay(4000);

  // ---- Module presence ----
  await check('A0 module loaded', `(function(){return {val: !!MMGR.Bids && !!MMGR.Stakeholders.getExpiringCompliance && !!MMGR.Stakeholders.isEmrStale};})()`);

  // ---- A3 (T8 REBUILD): bid leveling — modal-created packages + leveled grid ----
  await ev(`MMGR.Bids.openBidPkgModal();`); await delay(250);
  await check('A3 modal opens with CSI select + one line item', `(function(){var m=document.getElementById('bidpkg-modal');var csi=document.getElementById('bp-csi');return {val: m && m.classList.contains('on') && csi && csi.options.length>=20 && document.querySelectorAll('#bp-items .bp-item').length===1};})()`);
  await ev(`MMGR.Bids.bidModalAddItem();`); await delay(150);
  await check('A3 modal add line item row', `(function(){return {val: document.querySelectorAll('#bp-items .bp-item').length===2};})()`);
  // Fill the draft through the DOM (same path a real user takes) and save.
  await ev(`(function(){document.getElementById('bp-name').value='Electrical Phase 1';document.getElementById('bp-csi').value='26';document.getElementById('bp-budget').value='100000';document.getElementById('bp-deadline').value='2026-09-30';var rows=document.querySelectorAll('#bp-items .bp-item');rows[0].querySelector('.bp-item-desc').value='Rough-in';rows[0].querySelector('.bp-item-cost').value='45000';rows[1].querySelector('.bp-item-desc').value='Fixtures';rows[1].querySelector('.bp-item-cost').value='30000';return true;})()`); await delay(150);
  await ev(`MMGR.Bids.bidPkgSave();`); await delay(350);
  await check('A3 save creates package + closes modal', `(function(){var s=MMGR.State.getState();var m=document.getElementById('bidpkg-modal');return {val: s.bidPackages.length===1 && s.bidPackages[0].lineItems.length===2 && s.bidPackages[0].csiDivision==='26' && s.bidPackages[0].targetBudget===100000 && !m.classList.contains('on')};})()`);
  await check('A3 page context alive after RFQ mailto', `(function(){return {val: !!(window.MMGR && MMGR.State)};})()`);
  // Add two subcontractors and price the grid (sub 1 skips Fixtures).
  await ev(`MMGR.Bids.addSub(0); MMGR.Bids.addSub(0);`); await delay(250);
  await ev(`MMGR.Bids.updSub(0,0,'vendor','ABC Electrical Ltd'); MMGR.Bids.updSub(0,1,'vendor','XYZ Wiring Co');`); await delay(200);
  await ev(`MMGR.Bids.updAmount(0,0,0,45000); MMGR.Bids.updAmount(0,0,1,30000); MMGR.Bids.updAmount(0,1,0,41000);`); await delay(350);
  await check('A3 leveled grid math (base/adjustments/leveled/variance)', `(function(){var p=MMGR.State.getState().bidPackages[0];var g=MMGR.Bids.leveledGrid(p);var a=g.subs[0],b=g.subs[1];return {val: a.base===75000 && a.adj===0 && a.leveled===75000 && Math.round(a.varPct)===-25 && b.base===41000 && b.adj===30000 && b.leveled===71000 && Math.round(b.varPct)===-29 && g.lowestIdx===1 && g.targetTotal===75000};})()`);
  await check('A3 grid renders totals rows + variance color + actions', `(function(){var el=document.getElementById('bid-body');return {val: !!el && el.querySelectorAll('.bid-pkg').length===1 && !!el.querySelector('.lvl-grid') && !!el.querySelector('.lvl-base') && !!el.querySelector('.lvl-adj') && !!el.querySelector('.lvl-true') && !!el.querySelector('.lvl-var') && el.querySelectorAll('.lvl-var-ok').length===2 && !!el.querySelector('[data-action=bidAward]') && !!el.querySelector('[data-action=bidProposal]') && !!el.querySelector('[data-action=bidClarify]') && el.querySelector('.lvl-lowest')!==null};})()`);
  // Award Contract flows through the shared confirm dialog.
  await ev(`MMGR.Bids.awardSub(0,1);`); await delay(200);
  await check('A3 award asks for confirmation', `(function(){return {val: document.getElementById('cfm-modal').classList.contains('on')};})()`);
  await ev(`MMGR.App.cfmOk();`); await delay(300);
  await check('A3 award persists + badge renders', `(function(){var p=MMGR.State.getState().bidPackages[0];var b=document.getElementById('bid-body');return {val: p.subs[1].awarded===true && b.innerHTML.indexOf('AWARDED')>-1};})()`);
  // Legacy shape (pre-rebuild {package,bids[]}) migrates in place on render.
  await ev(`MMGR.State.updateState(function(s){if(!s.bidPackages)s.bidPackages=[];s.bidPackages.push({id:'BID-legacy',package:'Legacy Package',bids:[{vendor:'Legacy Co',amount:50000}]});});`); await delay(250);
  // renderAll re-renders only the ACTIVE panel — open the Stakeholders panel
  // (where the bid cards live) so render() runs and migrates the legacy shape.
  await ev(`document.querySelector('[data-action=showSec][data-section=stk]').click();`); await delay(400);
  await ev(`MMGR.Render.renderAll();`); await delay(300);
  await check('A3 legacy package migrates to new shape', `(function(){var s=MMGR.State.getState();var p=s.bidPackages[1];var b=document.getElementById('bid-body');var dbg={li:p&&p.lineItems&&p.lineItems.length,hasSubs:!!(p&&p.subs),vendor:p&&p.subs&&p.subs[0]&&p.subs[0].vendor,pkgs:b?b.querySelectorAll('.bid-pkg').length:-1,hasBids:p&&Array.isArray(p.bids)};return {val: !!p.lineItems && p.lineItems.length===1 && !!p.subs && p.subs[0].vendor==='Legacy Co' && b.querySelectorAll('.bid-pkg').length===2, dbg: JSON.stringify(dbg)};})()`, 'debug: see dbg field');

  // ---- A4 (T8 REBUILD): Go/No-Go weighted star scorecard ----
  await ev(`MMGR.Bids.addGoNoGo();`); await delay(200);
  await ev(`MMGR.Bids.updGoNoGo(0,'projectName','Riverside Tower Phase 2');`); await delay(200);
  await check('A4 scorecard defaults to 30/25/20/25 weights', `(function(){var g=MMGR.State.getState().goNoGo[0];return {val: g.categories.length===4 && g.categories[0].weight===30 && g.categories[1].weight===25 && g.categories[2].weight===20 && g.categories[3].weight===25};})()`);
  // Rate 5/5/2/4 stars across the four categories -> 30 + 25 + 8 + 20 = 83 GO.
  await ev(`MMGR.Bids.setGoNoGoStar(0,0,0,5); MMGR.Bids.setGoNoGoStar(0,1,0,5); MMGR.Bids.setGoNoGoStar(0,2,0,2); MMGR.Bids.setGoNoGoStar(0,3,0,4);`); await delay(350);
  await check('A4 weighted score 83% GO', `(function(){var g=MMGR.State.getState().goNoGo[0];var sc=MMGR.Bids.weightedScore(g);return {val: Math.round(sc.pct)===83 && sc.recommendation==='GO'};})()`);
  await ev(`MMGR.Bids.setGoNoGoStar(0,0,0,4); MMGR.Bids.setGoNoGoStar(0,1,0,3); MMGR.Bids.setGoNoGoStar(0,2,0,2); MMGR.Bids.setGoNoGoStar(0,3,0,1);`); await delay(350);
  await check('A4 weighted score REVIEW band', `(function(){var g=MMGR.State.getState().goNoGo[0];var sc=MMGR.Bids.weightedScore(g);return {val: sc.pct>=50 && sc.pct<75 && sc.recommendation==='REVIEW'};})()`);
  await ev(`MMGR.Bids.setGoNoGoStar(0,0,0,1); MMGR.Bids.setGoNoGoStar(0,1,0,1); MMGR.Bids.setGoNoGoStar(0,2,0,1); MMGR.Bids.setGoNoGoStar(0,3,0,1);`); await delay(350);
  await check('A4 weighted score NO-GO band', `(function(){var g=MMGR.State.getState().goNoGo[0];var sc=MMGR.Bids.weightedScore(g);return {val: sc.pct<50 && sc.recommendation==='NO-GO'};})()`);
  await check('A4 scorecard renders categories + stars + bar + badge', `(function(){var b=document.getElementById('gonogo-body');return {val: !!b && b.querySelectorAll('.gn-card').length===1 && b.querySelectorAll('.gn-cat').length===4 && b.querySelectorAll('.gn-star').length===20 && b.querySelectorAll('.gn-star.on').length===4 && !!b.querySelector('.gn-scorebar-fill') && b.querySelector('.gn-badge')!==null};})()`);

  // ---- A1/A5: stakeholder compliance ----
  await ev(`MMGR.Stakeholders.addStake();`); await delay(200);
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await ev(`MMGR.Stakeholders.updStake(0,'name','ABC Electrical Ltd'); MMGR.Stakeholders.updStake(0,'coiExpiry','${soon}'); MMGR.Stakeholders.updStake(0,'emr','1.8'); MMGR.Stakeholders.updStake(0,'emrVerifiedAt','2019-01-01');`); await delay(300);
  await ev(`MMGR.Render.renderAll();`); await delay(300);
  await check('A1 getExpiringCompliance flags expiring COI', `(function(){var s=MMGR.State.getState().stakeholders;var e=MMGR.Stakeholders.getExpiringCompliance(s,30);return {val: e.length===1 && e[0].coiExpiring===true};})()`);
  await check('A5 isEmrStale true for stale EMR', `(function(){var s=MMGR.State.getState().stakeholders[0];return {val: MMGR.Stakeholders.isEmrStale(s)===true};})()`);
  await check('A1 dashboard health badge shows count', `(function(){var el=document.getElementById('h-coi');return {val: el && el.textContent==='1'};})()`);
  await check('A1 nav badge shows count', `(function(){var b=document.querySelector('[data-section=stk] .sec-badge');return {val: b && b.textContent==='1' && !b.classList.contains('is-hide')};})()`);
  // Open the Stakeholders section — the compliance banner lives there and
  // renders on section entry (renderAll renders only the active panel).
  await ev(`document.querySelector('[data-action=showSec][data-section=stk]').click();`); await delay(400);
  await check('A1 compliance banner visible', `(function(){var c=document.getElementById('stk-compliance');return {val: c && !c.classList.contains('is-hide') && c.textContent.indexOf('within 30 days')>-1};})()`);
  await check('A1 compliance columns rendered', `(function(){var b=document.getElementById('stk-body');return {val: !!b && b.querySelector('[data-field=coiExpiry]')!==null && b.querySelector('[data-field=emr]')!==null};})()`);

  // ---- A2: lien waiver ----
  await ev(`MMGR.Budget.addBudgetLine();`); await delay(200);
  await ev(`MMGR.Budget.updBudgetLine(0,'category','Electrical'); MMGR.Budget.updBudgetLine(0,'planned',45000); MMGR.Budget.updBudgetLine(0,'waiverStatus','unconditional'); MMGR.Budget.updBudgetLine(0,'waiverReceivedAt','2026-08-01');`); await delay(400);
  await check('A2 waiver columns rendered', `(function(){var b=document.getElementById('bud-body');return {val: !!b && b.querySelector('[data-field=waiverStatus]')!==null && b.querySelector('[data-field=waiverReceivedAt]')!==null};})()`);
  await check('A2 waiver rollup shows received', `(function(){var el=document.getElementById('bud-waivers');return {val: el && el.textContent.indexOf('1 received')>-1};})()`);
  await check('A2 waiver wrap visible', `(function(){var w=document.getElementById('bud-waivers-wrap');return {val: w && !w.classList.contains('is-hide')};})()`);

  // ---- A7: claim-compliance AI preset ----
  await check('A7 prompt builds without throw', `(function(){var p=MMGR.Prompts.generate('complianceCheck');return {val: typeof p==='string' && p.indexOf('DELAY NARRATIVE')>-1 && p.indexOf('REQUESTED RELIEF')>-1};})()`);
  await check('A7 preset listed + labelled', `(function(){return {val: MMGR.Prompts.list().indexOf('complianceCheck')>-1 && MMGR.AiWin.PRESET_LABELS.complianceCheck==='Claim Compliance'};})()`);
  await ev(`MMGR.State.updateState(function(s){if(!s.config)s.config={};if(!s.config.ai)s.config.ai={};s.config.ai.tier='local';});`); await delay(200);
  const presetOut = await ev(`MMGR.AiWin.runPreset('complianceCheck')`);
  await check('A7 local tier audit returns verdict', `(function(){return {val: ${JSON.stringify(!!presetOut && (presetOut.text || '').indexOf('VERDICT')>-1)}};})()`, 'runPreset returned: ' + JSON.stringify(presetOut).slice(0, 200));

  // ============================================================
  // SECTION C batch 1 (MARKET-FEATURE-ROADMAP C1/C2/C3/C7/C8)
  // ============================================================
  // ---- C1: RFI Register ----
  await ev(`document.querySelector('[data-action=showSec][data-section=docs]').click();`); await delay(400);
  await ev(`MMGR.Rfis.addRfi();`); await delay(200);
  await ev(`MMGR.Rfis.updRfi(0,'number','RFI-001'); MMGR.Rfis.updRfi(0,'question','Slab thickness discrepancy S-102 vs A-201'); MMGR.Rfis.updRfi(0,'to','Design Engineer'); MMGR.Rfis.updRfi(0,'status','routed'); MMGR.Rfis.updRfi(0,'ballInCourt','Design Engineer');`); await delay(300);
  await check('C1 rfi state + lifecycle persisted', `(function(){var r=MMGR.State.getState().rfis[0];return {val: !!r && r.number==='RFI-001' && r.status==='routed' && r.ballInCourt==='Design Engineer'};})()`);
  await check('C1 rfi rendered with fields', `(function(){var b=document.getElementById('rfi-body');return {val: !!b && b.querySelector('[data-field=question]')!==null && b.querySelector('[data-field=ballInCourt]')!==null && b.querySelector('[data-field=status]')!==null};})()`);
  await check('C1 rfi summary line', `(function(){var s=document.getElementById('rfi-sum');return {val: s && s.textContent.indexOf('open')>-1};})()`);
  await ev(`MMGR.Rfis.delRfi(0);`); await delay(200);
  await check('C1 rfi delete works', `(function(){var s=MMGR.State.getState();return {val: !s.rfis || s.rfis.length===0};})()`);

  // ---- C2: Submittal Register ----
  await ev(`MMGR.Submittals.addSubmittal();`); await delay(200);
  await ev(`MMGR.Submittals.updSubmittal(0,'item','Glazing shop drawings'); MMGR.Submittals.updSubmittal(0,'trade','Glazing'); MMGR.Submittals.updSubmittal(0,'status','approved');`); await delay(300);
  await check('C2 submittal state persisted', `(function(){var s=MMGR.State.getState().submittals[0];return {val: !!s && s.item==='Glazing shop drawings' && s.status==='approved'};})()`);
  await check('C2 submittal rendered + summary', `(function(){var b=document.getElementById('sub-body');var s=document.getElementById('sub-sum');return {val: !!b && b.querySelector('[data-field=status]')!==null && s && s.textContent.indexOf('approved')>-1};})()`);

  // ---- C3: Punch List ----
  await ev(`document.querySelector('[data-action=showSec][data-section=close]').click();`); await delay(400);
  await ev(`MMGR.PunchList.addPunch();`); await delay(200);
  await ev(`MMGR.PunchList.updPunch(0,'item','Touch up paint — lobby wall'); MMGR.PunchList.updPunch(0,'location','Level 1, Lobby'); MMGR.PunchList.updPunch(0,'assignee','J. Smith'); MMGR.PunchList.updPunch(0,'priority','High'); MMGR.PunchList.updPunch(0,'status','inprogress');`); await delay(300);
  await check('C3 punch state persisted', `(function(){var p=MMGR.State.getState().punchList[0];return {val: !!p && p.location==='Level 1, Lobby' && p.assignee==='J. Smith' && p.priority==='High' && p.status==='inprogress'};})()`);
  await check('C3 punch rendered with columns + summary', `(function(){var b=document.getElementById('punch-body');var s=document.getElementById('punch-sum');return {val: !!b && b.querySelector('[data-field=location]')!==null && b.querySelector('[data-field=assignee]')!==null && s && s.textContent.indexOf('open')>-1};})()`);

  // ---- C7: Lookahead (pure fn + dashboard render) ----
  await check('C7 lookaheadTasks filters horizon + overdue, drops completed/far', `(function(){
    var today = new Date(); today.setHours(0,0,0,0);
    var p2 = function(n){ return (n<10?'0':'')+n; };
    var fmt = function(d){ return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
    var t = fmt(new Date(today.getTime()+3*86400000));
    var o = fmt(new Date(today.getTime()-2*86400000));
    var far = fmt(new Date(today.getTime()+30*86400000));
    var tasks = [
      {id:'t1', name:'Pour slab', status:'todo', startDate:t, endDate:t},
      {id:'t2', name:'Overdue roof', status:'inprogress', startDate:o, endDate:o},
      {id:'t3', name:'Far future', status:'todo', startDate:far, endDate:far},
      {id:'t4', name:'Done', status:'completed', startDate:t, endDate:t}
    ];
    var l = MMGR.Schedule.lookaheadTasks(tasks, 14);
    return {val: l.length===2 && l.some(function(x){return x.id==='t1';}) && l.some(function(x){return x.id==='t2';})};
  })()`);
  await ev(`(function(){
    var p2 = function(n){ return (n<10?'0':'')+n; };
    var fmt = function(d){ return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
    var mon = MMGR.Schedule.isoWeekStart(0);
    MMGR.State.updateState(function(s){
      s.tasks.forEach(function(t,i){
        var d = new Date(mon); d.setDate(mon.getDate()+i);
        t.endDate = fmt(d); t.startDate = t.endDate;
      });
    });
  })()`); await delay(200);
  await ev(`document.querySelector('[data-action=showSec][data-section=dash]').click();`); await delay(400);
  // The exact group headers depend on today's weekday (e.g. every planted
  // Mon-Fri task reads as Overdue on a Saturday) — assert the invariant that
  // matters: the card renders at least one group header and one task row.
  await check('C7 lookahead dashboard card renders groups', `(function(){var b=document.getElementById('lookahead-body');return {val: !!b && b.querySelector('.tf-group')!==null && b.querySelector('.tf-row')!==null && (b.innerHTML.indexOf('Overdue')>-1 || b.innerHTML.indexOf('This Week')>-1 || b.innerHTML.indexOf('Next Week')>-1)};})()`);

  // ---- C8: PPC (pure fn + dashboard render) ----
  await check('C8 computePpc current week planned/completed/pct', `(function(){
    var s = MMGR.Schedule.isoWeekStart(0);
    var p2 = function(n){ return (n<10?'0':'')+n; };
    var fmt = function(d){ return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
    var mon = fmt(s), tue = fmt(new Date(s.getTime()+1*86400000)), next = fmt(new Date(s.getTime()+7*86400000));
    var tasks = [
      {id:'a', endDate:mon, status:'completed'},
      {id:'b', endDate:tue, status:'todo'},
      {id:'c', endDate:next, status:'completed'}
    ];
    var w0 = MMGR.Schedule.computePpc(tasks, 0);
    return {val: w0.planned===2 && w0.completed===1 && w0.pct===50};
  })()`);
  await check('C8 computePpc null when nothing planned', `(function(){
    var s = MMGR.Schedule.isoWeekStart(0);
    var p2 = function(n){ return (n<10?'0':'')+n; };
    var fmt = function(d){ return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
    var far = fmt(new Date(s.getTime()+30*86400000));
    var w0 = MMGR.Schedule.computePpc([{id:'a', endDate:far, status:'completed'}], 0);
    return {val: w0.planned===0 && w0.pct===null};
  })()`);
  await check('C8 ppc dashboard card renders figure + history bars', `(function(){
    var h = document.getElementById('ppc-head');
    var b = document.getElementById('ppc-body');
    return {val: !!b && b.querySelectorAll('.ppc-bar-row').length>=4 && h && /[0-9]+ of [0-9]+ tasks planned this week completed/.test(h.textContent)};
  })()`);

  // ============================================================
  // SECTION C batch 2 (C6/C11/C12/C13/C16/C17/C18/C26/C29/C30)
  // ============================================================
  // ---- C12: committed cost ----
  await ev(`document.querySelector('[data-action=showSec][data-section=bud]').click();`); await delay(400);
  await ev(`MMGR.Budget.addBudgetLine();`); await delay(200);
  await ev(`MMGR.Budget.updBudgetLine(0,'category','Electrical'); MMGR.Budget.updBudgetLine(0,'planned',45000); MMGR.Budget.updBudgetLine(0,'actual',20000); MMGR.Budget.updBudgetLine(0,'committed',30000);`); await delay(400);
  await check('C12 committed column rendered + persisted', `(function(){var b=document.getElementById('bud-body');var s=MMGR.State.getState().budgetLines[0];return {val: !!b && b.querySelector('[data-field=committed]')!==null && s.committed===30000};})()`);
  await check('C12 committed summary shows explicit committed, not planned', `(function(){var el=document.getElementById('bud-committed');return {val: el && el.textContent==='$30,000'};})()`);
  await check('C12 committed-not-spent gap sub-label', `(function(){var el=document.getElementById('bud-committed-gap');return {val: el && el.textContent.indexOf('committed, not yet spent')>-1 && el.textContent.indexOf('$10,000')>-1};})()`);
  await check('C12 blank committed defaults to planned', `(function(){var el=document.getElementById('bud-committed');var before=el.textContent;var g=MMGR.State.getState();g.budgetLines[0].committed=null;MMGR.Render.renderAll();return {val: document.getElementById('bud-committed').textContent==='$45,000'};})()`);
  await ev(`MMGR.State.getState().budgetLines[0].committed=30000; MMGR.Render.renderAll();`); await delay(200);

  // ---- C13: pay applications ----
  await ev(`MMGR.PayApps.addPayApp(false);`); await delay(200);
  await check('C13 genPayApp drafts from live spend', `(function(){var s=MMGR.State.getState().payApps[0];return {val: !!s && s.status==='draft' && s.amount===20000};})()`);
  await check('C13 payapp rendered with status walk', `(function(){var b=document.getElementById('payapp-body');var gen=document.querySelector('[data-action=genPayApp]');return {val: !!b && b.querySelector('[data-field=status]')!==null && !!gen};})()`);
  await ev(`MMGR.PayApps.updPayApp(0,'status','approved'); MMGR.PayApps.updPayApp(0,'dateApproved','2026-08-10');`); await delay(300);
  await check('C13 payapp status persisted + summary billed', `(function(){var s=MMGR.State.getState().payApps[0];var el=document.getElementById('payapp-sum');return {val: s.status==='approved' && s.dateApproved==='2026-08-10' && el && el.textContent.indexOf('billed')>-1};})()`);

  // ---- C16: inspection checklists ----
  await ev(`document.querySelector('[data-action=showSec][data-section=risk]').click();`); await delay(400);
  await ev(`MMGR.Inspections.addInspection();`); await delay(200);
  await ev(`MMGR.Inspections.updInspection(0,'title','Post-pour concrete inspection'); MMGR.Inspections.updInspection(0,'trade','Concrete');`); await delay(200);
  await ev(`MMGR.Inspections.addInspItem(0);`); await delay(200);
  await ev(`MMGR.Inspections.updInspItem(0,0,'text','Slab surface tolerance'); MMGR.Inspections.updInspItem(0,1,'text','Curing compound applied');`); await delay(300);
  await check('C16 inspection state + items persisted', `(function(){var i=MMGR.State.getState().inspections[0];return {val: !!i && i.title==='Post-pour concrete inspection' && i.items.length===2 && i.items[1].text==='Curing compound applied'};})()`);
  await check('C16 inspection rendered with item rows', `(function(){var b=document.getElementById('insp-body');return {val: !!b && b.querySelector('[data-action=inspItemToggle]')!==null && b.querySelector('[data-action=updInspItem]')!==null};})()`);
  await ev(`MMGR.Inspections.toggleInspItem(0,0); MMGR.Inspections.toggleInspItem(0,1);`); await delay(300);
  await check('C16 all items pass auto-advances status', `(function(){var i=MMGR.State.getState().inspections[0];return {val: i.status==='passed'};})()`);
  await ev(`MMGR.Inspections.toggleInspItem(0,0);`); await delay(300);
  await check('C16 failed item reopens inspection', `(function(){var i=MMGR.State.getState().inspections[0];return {val: i.status==='open'};})()`);

  // ---- C17: incident corrective-action loop ----
  await ev(`MMGR.Incidents.addIncident();`); await delay(200);
  await ev(`MMGR.Incidents.updIncident(0,'description','Worker near-miss — scaffold plank'); MMGR.Incidents.updIncident(0,'severity','High'); MMGR.Incidents.updIncident(0,'status','action');`); await delay(200);
  await ev(`MMGR.Incidents.updIncident(0,'rootCause','Plank not secured per checklist'); MMGR.Incidents.updIncident(0,'correctiveAction','Re-train crew + daily plank check');`); await delay(200);
  await ev(`MMGR.Incidents.updIncident(0,'status','closed');`); await delay(300);
  await check('C17 closing stamps closedDate', `(function(){var i=MMGR.State.getState().incidents[0];return {val: i.status==='closed' && i.closedDate!=='' && i.rootCause.indexOf('Plank')>-1};})()`);
  await check('C17 incident rendered with closure fields', `(function(){var b=document.getElementById('inc-body');return {val: !!b && b.querySelector('[data-field=rootCause]')!==null && b.querySelector('[data-field=correctiveAction]')!==null};})()`);

  // ---- C18: handover package ----
  await ev(`document.querySelector('[data-action=showSec][data-section=close]').click();`); await delay(400);
  await ev(`MMGR.Handover.addHandoverItem();`); await delay(200);
  await ev(`MMGR.Handover.updHandoverItem(0,'item','O&M manuals — HVAC'); MMGR.Handover.updHandoverItem(0,'category','O&M Manual'); MMGR.Handover.updHandoverItem(0,'status','filed');`); await delay(300);
  await check('C18 handover state + render', `(function(){var h=MMGR.State.getState().handover[0];var b=document.getElementById('handover-body');return {val: !!h && h.item==='O&M manuals — HVAC' && h.status==='filed' && !!b && b.querySelector('[data-field=status]')!==null};})()`);

  // ---- C26: warranty tracker ----
  await ev(`MMGR.Warranty.addWarranty();`); await delay(200);
  const wEnd = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  await ev(`MMGR.Warranty.updWarranty(0,'item','Roofing system'); MMGR.Warranty.updWarranty(0,'provider','RoofWorks Ltd'); MMGR.Warranty.updWarranty(0,'warrantyEnd','${wEnd}');`); await delay(300);
  await check('C26 warranty state + render + days-left', `(function(){var w=MMGR.State.getState().warrantyItems[0];var b=document.getElementById('warranty-body');return {val: !!w && w.item==='Roofing system' && !!b && b.innerHTML.indexOf('left')>-1};})()`);

  // ---- C11: drawing distribution log ----
  await ev(`document.querySelector('[data-action=showSec][data-section=docs]').click();`); await delay(400);
  await ev(`MMGR.DrawingLog.addDrawLog();`); await delay(200);
  await ev(`MMGR.DrawingLog.updDrawLog(0,'drawingNo','A-201'); MMGR.DrawingLog.updDrawLog(0,'rev','C'); MMGR.DrawingLog.updDrawLog(0,'distributedTo','ABC Electrical Ltd');`); await delay(300);
  await check('C11 drawlog state + render', `(function(){var d=MMGR.State.getState().drawingLog[0];var b=document.getElementById('drawlog-body');return {val: !!d && d.rev==='C' && d.distributedTo==='ABC Electrical Ltd' && !!b && b.querySelector('[data-field=distributedTo]')!==null};})()`);

  // ---- C30: permit register ----
  await ev(`MMGR.Permits.addPermit();`); await delay(200);
  await ev(`MMGR.Permits.updPermit(0,'permitNo','BLD-2026-441'); MMGR.Permits.updPermit(0,'type','Building'); MMGR.Permits.updPermit(0,'agency','City Planning'); MMGR.Permits.updPermit(0,'status','active');`); await delay(300);
  await check('C30 permit state + render', `(function(){var p=MMGR.State.getState().permits[0];var b=document.getElementById('permit-body');return {val: !!p && p.permitNo==='BLD-2026-441' && !!b && b.querySelector('[data-field=status]')!==null};})()`);

  // ---- C6: ball-in-court rollup ----
  await ev(`MMGR.Rfis.addRfi();`); await delay(200);
  await ev(`MMGR.Rfis.updRfi(0,'number','RFI-002'); MMGR.Rfis.updRfi(0,'status','open'); MMGR.Rfis.updRfi(0,'ballInCourt','Architect');`); await delay(200);
  await ev(`MMGR.Risks.addRisk();`); await delay(200);
  await ev(`MMGR.Risks.toggleRiskIssue(0);`); await delay(300);
  await ev(`MMGR.State.getState().issues[0].owner='J. Smith';`); await delay(200);
  await check('C6 getBallInCourt aggregates RFI + issue', `(function(){var l=MMGR.BallInCourt.getBallInCourt();return {val: l.length>=2 && l.some(function(x){return x.kind==='RFI' && x.who==='Architect';}) && l.some(function(x){return x.kind==='Issue' && x.who==='J. Smith';})};})()`);
  await check('C6 ball-in-court card renders', `(function(){var b=document.getElementById('blc-body');return {val: !!b && b.innerHTML.indexOf('RFI')>-1};})()`);

  // ---- C29: expiry & renewals rollup ----
  const pEnd = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  await ev(`MMGR.Permits.updPermit(0,'expires','${pEnd}');`); await delay(200);
  await check('C29 getExpiryRollup rolls up permit + warranty', `(function(){var l=MMGR.Compliance.getExpiryRollup(60);return {val: l.some(function(x){return x.kind==='Permit' && x.daysLeft<=20;}) && l.some(function(x){return x.kind==='Warranty';})};})()`);
  await ev(`document.querySelector('[data-action=showSec][data-section=dash]').click();`); await delay(400);
  await check('C29 expiry dashboard card visible with items', `(function(){var c=document.getElementById('expiry-card');var b=document.getElementById('expiry-body');return {val: c && !c.classList.contains('is-hide') && !!b && b.querySelectorAll('.badge').length>=1};})()`);

  const failed = results.filter(r => r.status === 'FAIL').length;
  log(`\n==== MKT_FEATURES_SUMMARY: ${results.length - failed} passed / ${failed} failed of ${results.length} ====`);
  try { ws.close(); } catch (e) {}
  proc.kill();
  process.exit(failed ? 1 : 0);
})().catch(e => { log('FATAL: ' + (e && e.stack || e)); process.exit(1); });
