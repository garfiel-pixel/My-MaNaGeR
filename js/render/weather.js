/* ============================================================
 My MaNaGeR, Weather Rendering
 Forecast strip, weather log, safety banner, LD/SRI,
 weather variance, float watch, lead-time tracker,
 schedule confidence, weather window inputs.
 Extracted from mmgr-render.js.
 ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State ? ns.State.getState() : null;
  const U = ns.Utils;
  const $ = U.$;

  function emptyStateRow(colspan, text, actionsHtml) {
 return '<tr><td colspan="' + colspan + '"><div class="es es-row">' +
 '<div>' + text + '</div>' +
 (actionsHtml ? '<div class="es-actions">' + actionsHtml + '</div>' : '') +
 '</div></td></tr>';
  }

  function getNearCritical() {
 if (ns.Schedule && ns.Schedule.getNearCritical) return ns.Schedule.getNearCritical();
 return [];
  }

  function crashCandidates() {
 if (ns.Schedule && ns.Schedule.crashCandidates) return ns.Schedule.crashCandidates();
 return [];
  }

  // ---- Lead-Time Tracker ----
  function renderLeadtimeTracker() {
 const el = $('leadtime-tracker-body');
 if (!el) return;
 const s = S();
 const lt = ((s && s.tasks) || []).filter(t => t.leadTime);
 if (!lt.length) {
 el.innerHTML = '<div class="lt-empty">No lead-time tasks yet. In the WBS, mark any task as <strong>Lead-Time</strong> (or drag it onto the Lead-Time lane) to track vendor-side waits, procurement, utility applications, permits.</div>';
 return;
 }
 const today = new Date(); today.setHours(0, 0, 0, 0);
 el.innerHTML = '<div class="ox"><table class="dt"><thead><tr><th>Task</th><th>Submitted</th><th>Expected</th><th>Status</th></tr></thead><tbody>' +
 lt.map(t => {
 const sub = U.parseDL(t.submittedDate);
 const exp = U.parseDL(t.expectedDate);
 let status = '';
 let cls = '';
 if (exp) {
 const days = Math.round((exp - today) / 86400000);
 if (days < 0) { status = 'OVERDUE by ' + Math.abs(days) + 'd'; cls = 'txt-danger'; }
 else if (days <= 5) { status = days + 'd remaining'; cls = 'txt-warn'; }
 else { status = days + 'd remaining'; cls = 'txt-green'; }
 } else {
 status = 'No expected date set';
 }
 const pct = (sub && exp && exp > sub) ? Math.round((today - sub) / (exp - sub) * 100) : null;
 return '<tr><td>' + U.escapeHtml(t.name) + '</td><td>' + U.escapeHtml(t.submittedDate || '-') + '</td><td>' + U.escapeHtml(t.expectedDate || '-') + '</td><td class="' + cls + '">' + status + (pct !== null ? ' (' + Math.max(0, Math.min(100, pct)) + '% elapsed)' : '') + '</td></tr>';
 }).join('') +
 '</tbody></table></div>' +
 // Rolling 3-Month review section
 '<div class="lt-section"><div class="lt-section-h">Rolling 3-Month</div><div class="ox"><table class="dt"><thead><tr><th>Task</th><th>Last Reviewed</th><th>Status</th><th></th></tr></thead><tbody>' +
 lt.map(t => {
 const lastReview = t.leadtimeUpdatedAt ? U.parseDL(t.leadtimeUpdatedAt) : null;
 const threeMonthsAgo = new Date(today); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
 const isStale = !lastReview || lastReview < threeMonthsAgo;
 const reviewLabel = lastReview ? lastReview.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : 'Never';
 return '<tr class="ltr-roll"><td>' + U.escapeHtml(t.name) + '</td>' +
 '<td>' + U.escapeHtml(reviewLabel) + '</td>' +
 '<td>' + (isStale ? '<span class="badge br">Stale</span>' : '<span class="badge bg">Reviewed</span>') + '</td>' +
 '<td><button class="btn btn-s btn-g" data-action="tglLeadtimeReview" data-id="' + U.escapeHtml(t.id) + '">Review</button></td>' +
 '</tr>';
 }).join('') +
 '</tbody></table></div></div>';
  }

  // ---- Float Watch ----
  function renderFloatWatch() {
 const el = $('float-watch-body');
 if (!el) return;
 const s = S();
 const tasks = (s && s.tasks) || [];
 const nc = getNearCritical();
 const crit = tasks.filter(t => t.totalFloat === 0);
 if (!nc.length && !crit.length) {
 const anyFloat = tasks.some(t => t.totalFloat !== null && t.totalFloat !== undefined);
 el.innerHTML = anyFloat
 ? '<div class="fw-ok"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> All tasks have healthy float.</div>'
 : '<div class="fw-empty">Add task dates + predecessors and run <strong>Cascade Dates</strong> (Gantt toolbar) and float will compute automatically.</div>';
 return;
 }
 const critHtml = crit.length ? '<div class="fw-section"><div class="fw-h crit"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-dot"></use></svg> Critical (zero float)</div>' + crit.map(t => '<div class="fw-row crit"><span>' + U.escapeHtml(t.name) + '</span></div>').join('') + '</div>' : '';
 const ncHtml = nc.length ? '<div class="fw-section"><div class="fw-h nc"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Near-Critical (float \u226410d or >30% consumed)</div>' + nc.map(t => {
 const consumed = t.floatBaseline ? Math.round((t.floatBaseline - t.totalFloat) / t.floatBaseline * 100) : 0;
 return '<div class="fw-row nc"><span>' + U.escapeHtml(t.name) + '</span><span class="fw-meta">Float ' + t.totalFloat + 'd' + (t.floatBaseline ? ' / baseline ' + t.floatBaseline + 'd (' + consumed + '% consumed)' : '') + '</span></div>';
 }).join('') + '</div>' : '';
 const cc = crashCandidates();
 const ccHtml = cc.length ? '<div class="fw-section"><div class="fw-h cc"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-tool"></use></svg> Crash Candidates - best compression targets on the critical path</div>' + cc.map(c => '<div class="fw-row cc"><span>' + U.escapeHtml(c.task.name) + '</span><span class="fw-meta">' + c.duration + 'd task - up to ~' + c.recoverable + 'd recoverable</span></div>').join('') + '<div class="fw-note">Estimates only - confirm with the crew before committing. Regulatory/curing/waiting-time tasks are excluded since more labor can\'t compress them.</div></div>' : '';
 el.innerHTML = critHtml + ncHtml + ccHtml;
  }

  // ---- Weather Variance ----
  function renderWeatherVariance() {
 const el = $('weather-variance-body');
 if (!el) return;
 bindWxInputs();
 const s = S();
 const w = (s && s.wxWindow) || { start: '', end: '', bufferDays: 0 };
 const st = $('wx-start'); if (st && st !== document.activeElement) st.value = w.start || '';
 const en = $('wx-end'); if (en && en !== document.activeElement) en.value = w.end || '';
 const bf = $('wx-buffer'); if (bf && bf !== document.activeElement) bf.value = w.bufferDays || 0;
 const winSt = U.parseDL(w.start), winEn = U.parseDL(w.end);
 const spanDays = (winSt && winEn) ? Math.round((winEn - winSt) / 86400000) : 0;
 const spanWarn = spanDays > 210 ? '<div class="wx-warn"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Season window is ' + spanDays + ' days - a real hurricane season runs about 180 days. This one likely has Season End set to a project date rather than a season boundary (e.g. Nov 30), which will overstate exposure. Fix the date above.</div>' : '';
 const tasks = (s && s.tasks) || [];
 const wxTasks = tasks.filter(t => t.weatherExposed && t.startDate && t.endDate);
 if (!wxTasks.length) {
 el.innerHTML = spanWarn + '<div class="wx-empty"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg> No tasks tagged weather-exposed. Use the cloud button on any WBS row to mark a task weather-sensitive and include it here.</div>';
 return;
 }
 let totalDays = 0, inWindowDays = 0;
 wxTasks.forEach(t => {
 const ts = U.parseDL(t.startDate), te = U.parseDL(t.endDate);
 if (!ts || !te) return;
 const dur = Math.max(1, Math.round((te - ts) / 86400000) + 1);
 totalDays += dur;
 if (winSt && winEn) {
 const ovStart = new Date(Math.max(ts, winSt));
 const ovEnd = new Date(Math.min(te, winEn));
 if (ovStart <= ovEnd) inWindowDays += Math.round((ovEnd - ovStart) / 86400000) + 1;
 }
 });
 const buffer = w.bufferDays || 0;
 const variance = inWindowDays - buffer;
 const varCls = variance <= 0 ? 'var-pos' : 'var-neg';
 const inWinLbl = (winSt && winEn) ? inWindowDays + 'd' : 'set window';
 const varLbl = (winSt && winEn) ? (variance > 0 ? '+' : '') + variance + 'd' : '-';
 const distHtml = wxTasks.length ? '<div class="wx-dist"><div class="rst"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg> Distributed Float<span class="ct-sub">Extra buffer days tied to this task - applied on Cascade Dates</span></div>' +
 wxTasks.map(t => '<div class="wx-dist-row"><span class="wx-dist-name">' + U.escapeHtml(t.name) + '</span><input type="number" min="0" max="60" step="1" value="' + (+(t.wxFloatPad || 0)) + '" data-wxpad="' + U.escapeHtml(t.id) + '" title="Extra weather float days for this task (ACTION-PLAN 7.3)"><span class="wx-dist-unit">d</span></div>').join('') + '</div>' : '';
 el.innerHTML = spanWarn + '<div class="wx-stats">' +
 '<div class="wx-stat"><div class="k">Exposed Tasks</div><div class="v">' + wxTasks.length + '</div></div>' +
 '<div class="wx-stat"><div class="k">Total Duration</div><div class="v">' + totalDays + 'd</div></div>' +
 '<div class="wx-stat"><div class="k">In Hurricane Window</div><div class="v" style="color:var(--amber)">' + inWinLbl + '</div></div>' +
 '<div class="wx-stat"><div class="k">vs Charter Buffer</div><div class="v ' + varCls + '">' + varLbl + '</div></div>' +
 '</div>' +
 ((winSt && winEn && variance > 0) ? '<div class="wx-warn"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Weather-exposed work in the hurricane window exceeds the Charter buffer by ' + variance + ' day' + (variance !== 1 ? 's' : '') + '. Reconsider sequencing or increase the buffer.</div>' : '') +
 distHtml;
 Array.prototype.forEach.call(el.querySelectorAll('input[data-wxpad]'), function(inp) {
 inp.addEventListener('change', function() {
 ns.State.updateState(function(st) {
 const task = (st.tasks || []).find(x => x.id === inp.getAttribute('data-wxpad'));
 if (task) task.wxFloatPad = Math.max(0, Math.min(60, (+inp.value || 0)));
 });
 renderWeatherVariance();
 });
 });
  }

  // ---- Weather window inputs ----
  function updWxWindow() {
 ns.State.updateState(function(s) {
 if (!s.wxWindow) s.wxWindow = { start: '', end: '', bufferDays: 0 };
 const stEl = $('wx-start'), enEl = $('wx-end');
 s.wxWindow.start = (stEl && stEl.value) || '';
 s.wxWindow.end = (enEl && enEl.value) || '';
 if (s.wxWindow.start && s.wxWindow.end) {
 const spanDays = Math.round((new Date(s.wxWindow.end) - new Date(s.wxWindow.start)) / 86400000);
 if (spanDays > 210 && ns.App && ns.App.showToast) {
 ns.App.showToast("That's a " + spanDays + "-day season window - a real hurricane season runs about 180 days (e.g. Jun 1-Nov 30). Double-check Season End isn't your project finish date by mistake.", 'err');
 }
 }
 });
 renderWeatherVariance();
  }

  function updWxBuffer() {
 ns.State.updateState(function(s) {
 if (!s.wxWindow) s.wxWindow = { start: '', end: '', bufferDays: 0 };
 const bfEl = $('wx-buffer');
 s.wxWindow.bufferDays = bfEl ? (+bfEl.value || 0) : 0;
 });
 renderWeatherVariance();
  }

  function updLdRate() {
 ns.State.updateState(function(s) {
 const el = $('wx-ld-rate');
 s.ldRate = el ? (+el.value || 0) : (s.ldRate || 0);
 });
 renderWeatherLog();
  }

  // ---- Schedule Confidence ----
  function renderScheduleConfidence() {
 const el = $('schedule-confidence-card');
 if (!el) return;
 const s = S();
 const f = (s && s.charter) || {};
 if (!f.targetCompletion && !f.end) {
 el.innerHTML = '<div class="es" style="padding:14px;font-size:.76rem">Set a Target Completion Date in the Charter to activate Schedule Confidence.</div>';
 return;
 }
 const highRiskCount = (s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'high') && (r.impact === 'High' || r.impact === 'high')).length;
 const sim = (ns.Schedule && ns.Schedule.simulateSchedule) ? ns.Schedule.simulateSchedule(300, 1.2, highRiskCount * 2) : null;
 let probHtml = '<div class="sc-cell"><div class="lbl" style="color:var(--slate)">Not enough scheduled tasks yet to simulate.</div></div>';
 if (sim) {
 const td = new Date(f.targetCompletion || f.end);
 const pct = Math.round(sim.results.filter(d => d <= td).length / sim.results.length * 100);
 const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--danger)';
 probHtml = '<div class="sc-cell"><div class="big" style="color:' + color + '">' + pct + '%</div><div class="lbl">chance of hitting ' + td.toLocaleDateString() + '</div></div>';
 }
 const w = (s && s.wxWindow) || {};
 const wxTasks = (s.tasks || []).filter(t => t.weatherExposed && t.startDate && t.endDate);
 let wxHtml = '<div class="sc-cell"><div class="lbl" style="color:var(--slate)">No weather window set.</div></div>';
 if (w.start && w.end && wxTasks.length) {
 const winSt = U.parseDL(w.start), winEn = U.parseDL(w.end);
 let inWindow = 0;
 wxTasks.forEach(t => {
 const ts = U.parseDL(t.startDate), te = U.parseDL(t.endDate);
 if (!ts || !te) return;
 const ovStart = new Date(Math.max(ts, winSt)), ovEnd = new Date(Math.min(te, winEn));
 if (ovStart <= ovEnd) inWindow += Math.round((ovEnd - ovStart) / 86400000) + 1;
 });
 const over = inWindow - (w.bufferDays || 0);
 wxHtml = '<div class="sc-cell"><div class="big" style="color:' + (over > 0 ? 'var(--danger)' : 'var(--green)') + '">' + (over > 0 ? '+' + over + 'd' : 'OK') + '</div><div class="lbl">' + (over > 0 ? 'over weather buffer' : 'within weather buffer') + '</div></div>';
 } else if (w.start && w.end) {
 wxHtml = '<div class="sc-cell"><div class="big" style="color:var(--slate)">-</div><div class="lbl">no tasks tagged weather-exposed yet</div></div>';
 }
 const cc = crashCandidates();
 const riskHtml = cc.length
 ? '<div class="sc-cell"><div class="big sc-crash">' + U.escapeHtml(cc[0].task.name) + '</div><div class="lbl">biggest crash candidate - up to ~' + cc[0].recoverable + 'd recoverable</div></div>'
 : '<div class="sc-cell"><div class="lbl" style="color:var(--slate)">No crash candidates identified yet.</div></div>';
 el.innerHTML = '<div class="sc-grid">' + probHtml + wxHtml + riskHtml + '</div>';
  }

  // ---- Safety Banner ----
  function renderSafetyBanner() {
 const el = $('safety-banner');
 if (!el) return;
 const s = S();
 const Fc = ns.Forecast;
 if (!Fc) { el.classList.add('is-hide'); return; }
 const hc = Fc.heatColdAlert(s);
 const txt = $('safety-banner-text');
 if (!hc) {
 el.classList.remove('safety-heat', 'safety-cold');
 el.classList.add('is-hide');
 if (txt) txt.textContent = '';
 return;
 }
 el.classList.remove('safety-heat', 'safety-cold');
 el.classList.add('safety-' + hc.kind);
 if (txt) txt.textContent = hc.text;
 el.classList.remove('is-hide');
  }

  // ---- Weather Forecast ----
  function renderWeatherForecast() {
 const el = $('weather-forecast-body');
 if (!el) return;
 const s = S();
 const Fc = ns.Forecast;
 if (!Fc) { el.innerHTML = ''; return; }
 const place = s.sitePlace || '';
 const hasLoc = !!(s.siteLat !== null && s.siteLon !== null);
 const days = Fc.getForecast(s);
 if (!hasLoc) {
 el.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">No site location set. Enter the site city above and click <strong>Locate</strong> (geocoded once via Open-Meteo, stored in this browser) - or keep using the regional weather windows below.</div>';
 return;
 }
 const placeIn = $('wx-place-in');
 if (placeIn && place && placeIn !== document.activeElement) placeIn.value = place;
 if (!days) {
 el.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">Forecast not fetched yet (or the 3h cache expired). Click <strong>Refresh</strong> to pull the 16-day Open-Meteo forecast for ' + U.escapeHtml(place) + '.</div>';
 return;
 }
 const risky = Fc.riskDays(s);
 const heatCold = Fc.heatColdAlert(s);
 const now = new Date(); now.setHours(0, 0, 0, 0);
 const horizon = (s.wxViewDays === 16) ? 16 : 7;
 const tglBtns = document.querySelectorAll('.wx-view-tgl .btn[data-action=wxSetView]');
 Array.prototype.forEach.call(tglBtns, function(b) { b.classList.toggle('is-on', (+b.getAttribute('data-days')) === horizon); });
 const next7 = days.filter(d => (U.parseDL(d.date) || new Date(d.date + 'T00:00:00')) >= now).slice(0, horizon);
 const strip = next7.map(d => {
 const isRisk = risky.some(r => r.date === d.date);
 const r = isRisk ? risky.find(x => x.date === d.date) : null;
 const cls = isRisk ? (r.alerts.some(a => a.indexOf('heat') === 0 || a.indexOf('cold') === 0) ? 'wfr-heat' : 'wfr-risk') : '';
 const lbl = isRisk ? (r.alerts[0] || 'risk') : (d.precip > 30 ? d.precip + '%' : (d.tMax || '-') + 'C');
 const dow = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
 const tip = isRisk && r ? d.date + ': ' + r.alerts.join(', ') : (d.date + ' - ' + (d.precip > 30 ? d.precip + '%' : (d.tMax || '-') + 'C'));
 return '<div class="wfr-day ' + cls + '" title="' + U.escapeHtml(tip) + '"><div class="wfr-dow">' + dow + '</div><div class="wfr-lbl">' + U.escapeHtml(lbl) + '</div></div>';
 }).join('');
 const riskList = risky.length
 ? risky.slice(0, 4).map(r => '<div class="wfr-risk-row"><span class="badge br" style="font-size:.6rem">RISK</span> ' + U.escapeHtml(r.date + ' - ' + r.alerts.join(', ')) + (r.affected.length ? ' <span class="txt-sl">(affects ' + U.escapeHtml(r.affected.join(', ')) + ')</span>' : '') + '</div>').join('')
 : '<div class="wfr-ok"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> No threshold-clearing weather risk in the next 16 days.</div>';
 el.innerHTML = (heatCold ? '<div class="wfr-alert wfr-' + heatCold.kind + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> ' + U.escapeHtml(heatCold.text) + '</div>' : '') +
 '<div class="wfr-strip">' + strip + '</div>' +
 '<div style="margin-top:8px">' + riskList + '</div>' +
 '<div class="wfr-meta">Site: ' + U.escapeHtml(place) + ' \u00b7 Forecast cached ' + new Date((s.wxCache && s.wxCache.at) || Date.now()).toLocaleTimeString() + '</div>';
  }

  // ---- Weather Log ----
  function renderWeatherLog() {
 const el = $('weather-log-body');
 if (!el) return;
 const s = S();
 const Fc = ns.Forecast;
 if (!Fc) { el.innerHTML = ''; return; }
 const ldIn = $('wx-ld-rate');
 if (ldIn && ldIn !== document.activeElement) ldIn.value = s.ldRate || 0;
 const strip = $('ld-sri-strip');
 if (strip) {
 const ld = Fc.ldExposure(s);
 const sriV = Fc.sri(s);
 strip.innerHTML =
 '<div class="wx-stat"><div class="k">Logged Weather Days</div><div class="v">' + ld.days + '</div></div>' +
 '<div class="wx-stat"><div class="k">LD Rate (per day)</div><div class="v">$' + Number(ld.rate).toLocaleString() + '</div></div>' +
 '<div class="wx-stat"><div class="k">LD Exposure</div><div class="v ' + (ld.exposure ? 'var-neg' : 'var-pos') + '">$' + Number(ld.exposure).toLocaleString() + '</div></div>' +
 '<div class="wx-stat"><div class="k">Schedule Reliability</div><div class="v">' + (sriV ? sriV.index + '%' : '-') + '</div></div>';
 }
 const log = s.weatherLog || [];
 if (!log.length) {
 el.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">No weather delays logged. Click <strong>+ Log Today</strong> to record today\'s conditions with affected tasks - the export is dispute-ready for LD claims.</div>';
 return;
 }
 el.innerHTML = '<div class="ox"><table class="dt"><thead><tr><th>Date</th><th>Conditions</th><th>Note</th><th>Affected Tasks</th><th class="w60"></th></tr></thead><tbody>' +
 log.map((e, i) => '<tr><td>' + U.escapeHtml(e.date) + '</td><td>' + U.escapeHtml(e.condition || '') + '</td><td>' + U.escapeHtml(e.note || '') + '</td><td>' + U.escapeHtml((e.affectedTaskIds || []).join(', ') || '-') + '</td><td><button class="btn btn-s btn-d" data-action="delWeatherLogEntry" data-idx="' + i + '">\u00d7</button></td></tr>').join('') +
 '</tbody></table></div>';
  }

  // ---- Weather window input binding ----
  function bindWxInputs() {
 const stEl = $('wx-start');
 const enEl = $('wx-end');
 const bfEl = $('wx-buffer');
 if (stEl && !stEl._wxBound) { stEl._wxBound = true; stEl.addEventListener('change', updWxWindow); }
 if (enEl && !enEl._wxBound) { enEl._wxBound = true; enEl.addEventListener('change', updWxWindow); }
 if (bfEl && !bfEl._wxBound) { bfEl._wxBound = true; bfEl.addEventListener('change', updWxBuffer); }
  }

  ns.RenderWeather = {
 getNearCritical: getNearCritical,
 crashCandidates: crashCandidates,
 renderLeadtimeTracker: renderLeadtimeTracker,
 renderFloatWatch: renderFloatWatch,
 renderWeatherVariance: renderWeatherVariance,
 updWxWindow: updWxWindow,
 updWxBuffer: updWxBuffer,
 updLdRate: updLdRate,
 renderScheduleConfidence: renderScheduleConfidence,
 renderSafetyBanner: renderSafetyBanner,
 renderWeatherForecast: renderWeatherForecast,
 renderWeatherLog: renderWeatherLog,
 bindWxInputs: bindWxInputs
  };
})(MMGR);
window.MMGR = MMGR;
