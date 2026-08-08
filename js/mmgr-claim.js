/* ============================================================
   My MaNaGeR — Evidence / Claim Pack (MASTER-ACTION-PLAN-v3-STRICT Rank 1)
   ------------------------------------------------------------
   - 1.2  Baseline-vs-actual delta as a FIRST-CLASS object:
         computeSlips() derives every schedule slip (task, days, cause
         tag) from baseline-vs-current, auto-tagging cause from live
         evidence (weather delay log / predecessor slips / change
         control), defaulting to 'unknown' — never silently blank.
         Explicit user overrides persist in state.slipCauses.
   - 1.1  One-click Claim/Delay package: buildClaimPack() pulls the ENTIRE
         package from unified state (weather delay log, affected WBS,
         LD/contract exposure, baseline delta, change control, meeting
         decisions/action items tied to the window) with zero manual
         re-entry; claimPackText() renders it for the Copy All path.
   - 1.3  LD exposure rollup: ldRollup() splits exposure into avoided
         (weather-caused slips) vs incurred (all other causes) on the
         Budget tab, driven by 1.2's cause tags.

   Architecture constraints honored: reads/writes the SAME project state
   (schema v12), zero server cost, offline-first, no notification spam,
   portable .json export.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const CAUSES = ['weather', 'predecessor', 'change', 'unknown'];
  const DAY = 86400000;

  // ---- LD rate (same source as Forecast.ldExposure: state.ldRate, else charter) ----
  function ldRate(state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s) return 0;
    return +((s.ldRate !== undefined ? s.ldRate : (s.charter && s.charter.ldRate)) || 0);
  }

  // ---- 1.2 computeSlips: PURE derivation, no writes ----
  // Returns [{ taskId, taskName, baselineStart, baselineEnd, currentStart,
  //            currentEnd, days, cause, causeSource }] sorted by days desc.
  function computeSlips(state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s) return [];
    const baseMap = {};
    ((s.baseline && s.baseline.tasks) || []).forEach(bt => { baseMap[String(bt.id)] = bt; });
    const slips = [];
    (s.tasks || []).forEach(t => {
      const bt = baseMap[String(t.id)];
      if (!bt || !bt.endDate || !t.endDate) return;
      const baseEnd = U.parseDL(bt.endDate);
      const curEnd = U.parseDL(t.endDate);
      if (!baseEnd || !curEnd) return;
      const days = Math.round((curEnd - baseEnd) / DAY);
      if (days <= 0) return; // only slips, never gains, are claim-relevant
      slips.push({
        taskId: String(t.id),
        taskName: t.name || String(t.id),
        baselineStart: bt.startDate || '',
        baselineEnd: bt.endDate || '',
        currentStart: t.startDate || '',
        currentEnd: t.endDate || '',
        days: days,
        cause: autoCause(s, t, baseEnd, curEnd),
        causeSource: 'auto'
      });
    });
    // Explicit user overrides win over auto-tags.
    const overrides = s.slipCauses || {};
    slips.forEach(sl => {
      if (overrides[sl.taskId] && CAUSES.indexOf(overrides[sl.taskId]) > -1) {
        sl.cause = overrides[sl.taskId];
        sl.causeSource = 'user';
      }
    });
    return slips.sort((a, b) => b.days - a.days);
  }

  // Auto-tag precedence: weather > predecessor > change > unknown (never blank).
  function autoCause(s, task, baseEnd, curEnd) {
    const id = String(task.id);
    // 1. weather — a logged weather-delay day inside the slip window that
    //    names this task as affected.
    const wxHit = (s.weatherLog || []).some(e => {
      const d = U.parseDL(e.date);
      if (!d) return false;
      if (!(e.affectedTaskIds || []).map(String).some(x => x === id)) return false;
      return d >= baseEnd && d <= curEnd;
    });
    if (wxHit) return 'weather';
    // 2. predecessor — any predecessor also slipped vs baseline.
    const slippedIds = {};
    ((s.baseline && s.baseline.tasks) || []).forEach(bt => {
      const cur = (s.tasks || []).find(x => String(x.id) === String(bt.id));
      if (cur && bt.endDate && cur.endDate) {
        const d = Math.round((U.parseDL(cur.endDate) - U.parseDL(bt.endDate)) / DAY);
        if (d > 0) slippedIds[String(bt.id)] = true;
      }
    });
    if ((task.predecessors || []).some(p => slippedIds[String(p)])) return 'predecessor';
    // 3. change — a change-control entry references this task by id or name.
    const nameLc = String(task.name || '').toLowerCase();
    const chgHit = (s.changes || []).some(c => {
      const hay = [c.title, c.notes, c.ripple, c.schedImpact, c.costImpact].filter(Boolean).join(' ');
      // Token-boundary id match ("t4" must be its own token — never a
      // substring like "st4el"), plus a name match only when the name is
      // specific enough (>= 3 chars) to avoid false positives.
      const tokens = hay.split(/[^a-zA-Z0-9_]+/).filter(Boolean);
      if (tokens.indexOf(id) > -1) return true;
      return nameLc.length >= 3 && hay.toLowerCase().indexOf(nameLc) > -1;
    });
    if (chgHit) return 'change';
    // 4. never silently blank.
    return 'unknown';
  }

  // ---- setCause: persist a user override (writes state.slipCauses) ----
  function setCause(taskId, cause) {
    if (CAUSES.indexOf(cause) === -1) return;
    ns.State.updateState(function(s) {
      if (!s.slipCauses || typeof s.slipCauses !== 'object' || Array.isArray(s.slipCauses)) s.slipCauses = {};
      s.slipCauses[String(taskId)] = cause;
    });
    // renderClaimPanel also refreshes the Budget-tab LD rollup card
    // (renderLdRollup writes the same DOM node renderBudget populates).
    renderClaimPanel();
  }

  // ---- 1.3 ldRollup: avoided (weather cause) vs incurred (every other cause) ----
  function ldRollup(state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    const zero = { rate: 0, avoidedDays: 0, incurredDays: 0, avoided: 0, incurred: 0, total: 0, totalDays: 0 };
    if (!s) return zero;
    const rate = ldRate(s);
    const slips = computeSlips(s);
    let avoidedDays = 0, incurredDays = 0;
    slips.forEach(sl => {
      if (sl.cause === 'weather') avoidedDays += sl.days;
      else incurredDays += sl.days;
    });
    return {
      rate: rate,
      avoidedDays: avoidedDays,
      incurredDays: incurredDays,
      avoided: avoidedDays * rate,
      incurred: incurredDays * rate,
      total: (avoidedDays + incurredDays) * rate,
      totalDays: avoidedDays + incurredDays
    };
  }

  // ---- 1.1 buildClaimPack: everything pulled LIVE from unified state ----
  function buildClaimPack(state, from, to) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s) return null;
    const f = s.charter || {};
    const project = s.projectName || f.name || 'Project';
    const fromD = from ? U.parseDL(from) : null;
    const toD = to ? U.parseDL(to) : null;
    const inRange = function(dStr) {
      if (!dStr) return false;
      const d = U.parseDL(dStr);
      if (!d) return false;
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
      return true;
    };
    // Weather delay rows in the window (Rank 7.4 data — the Rank 1 dependency)
    const weatherDelays = (s.weatherLog || []).filter(e => inRange(e.date)).map(e => ({
      date: e.date, condition: e.condition || '', note: e.note || '',
      affectedTaskIds: (e.affectedTaskIds || []).map(String)
    }));
    // Affected WBS tasks: union of task ids named by weather rows in the window
    const taskMap = {};
    (s.tasks || []).forEach(t => { taskMap[String(t.id)] = t; });
    const affectedIds = [];
    weatherDelays.forEach(e => (e.affectedTaskIds || []).forEach(id => {
      if (affectedIds.indexOf(id) === -1) affectedIds.push(id);
    }));
    const affectedTasks = affectedIds.map(id => {
      const t = taskMap[id];
      return t
        ? { id: id, name: t.name || id, status: t.status || '', dates: (t.startDate ? t.startDate + ' → ' : '') + (t.endDate || '') }
        : { id: id, name: id, status: '', dates: '' };
    });
    // Schedule delta: slips whose baseline end or current end falls in the window
    const slips = computeSlips(s).filter(sl => inRange(sl.baselineEnd) || inRange(sl.currentEnd));
    const rate = ldRate(s);
    const ld = { days: weatherDelays.length, rate: rate, exposure: weatherDelays.length * rate };
    // WINDOW-scoped avoided/incurred rollup, so the package is internally
    // consistent: weather-tagged slips in the window = defensible; every
    // other cause in the window = incurred. (The Budget-tab card shows the
    // project-to-date figure via ldRollup() — that is a different, labeled
    // surface.)
    let wAvoidedDays = 0, wIncurredDays = 0;
    slips.forEach(sl => { if (sl.cause === 'weather') wAvoidedDays += sl.days; else wIncurredDays += sl.days; });
    const ldRoll = {
      rate: rate,
      avoidedDays: wAvoidedDays, incurredDays: wIncurredDays,
      avoided: wAvoidedDays * rate, incurred: wIncurredDays * rate,
      total: (wAvoidedDays + wIncurredDays) * rate,
      totalDays: wAvoidedDays + wIncurredDays
    };
    // Change control in the window
    const changeControl = (s.changes || []).filter(c => inRange(c.date)).map(c => ({
      date: c.date, title: c.title || '', requester: c.requester || '',
      status: c.status || '', schedImpact: c.schedImpact || '',
      costImpact: c.costImpact || '', notes: c.notes || ''
    }));
    // Meeting decisions / action items tied to the window (comms + decision log)
    const meetings = [];
    (s.commsEntries || []).filter(c => inRange(c.date) && (c.actionItems || c.summary)).forEach(c => {
      meetings.push({ date: c.date, kind: c.type || 'Communication', summary: c.summary || '', actions: c.actionItems || '', followUp: c.followUp || '' });
    });
    (s.logEntries || []).forEach(l => {
      // Decision log stores a locale string — best-effort parse. Format in
      // LOCAL time (never toISOString) so a late-evening entry doesn't drift
      // across the day boundary via UTC and silently leave the window.
      const d = new Date(l.date);
      const iso = isNaN(d.getTime()) ? '' : toLocalISO(d);
      if (iso && inRange(iso) && (l.decision || l.actionItems)) {
        meetings.push({ date: iso, kind: 'Decision Log', summary: l.decision || '', actions: l.actionItems || '', followUp: '' });
      }
    });
    // Open carried-forward meeting promises — always cited, not range-bound
    const openPromises = [];
    const promises = s.meetingPromises || {};
    Object.keys(promises).forEach(k => {
      (promises[k] || []).forEach(p => { if (!p.done) openPromises.push({ text: p.text || '', meeting: k }); });
    });
    const narrative = buildNarrative(project, weatherDelays, slips, ldRoll, from, to);
    return {
      project: project, from: from || '', to: to || '',
      generatedAt: new Date().toLocaleString(), narrative: narrative,
      weatherDelays: weatherDelays, affectedTasks: affectedTasks,
      slips: slips, ld: ld, ldRollup: ldRoll,
      changeControl: changeControl, meetings: meetings, openPromises: openPromises
    };
  }

  function buildNarrative(project, weatherDelays, slips, ldRoll, from, to) {
    const parts = [];
    parts.push('This package documents the delay and exposure position for ' + project +
      (from || to ? ' over ' + (from || 'project start') + ' to ' + (to || 'today') : '') + '.');
    if (weatherDelays.length) {
      const impacts = weatherDelays.reduce((n, e) => n + (e.affectedTaskIds.length || 0), 0);
      parts.push(weatherDelays.length + ' weather-delay day' + (weatherDelays.length > 1 ? 's' : '') +
        ' were logged in the window, covering ' + impacts + ' task-day impact' + (impacts === 1 ? '' : 's') + '.');
    } else {
      parts.push('No weather-delay days were logged in the window.');
    }
    const slipDays = slips.reduce((n, sl) => n + sl.days, 0);
    if (slips.length) {
      const wxSlips = slips.filter(sl => sl.cause === 'weather').length;
      parts.push(slips.length + ' task' + (slips.length > 1 ? 's' : '') + ' slipped vs baseline by a total of ' +
        slipDays + ' day' + (slipDays > 1 ? 's' : '') +
        (wxSlips ? ', of which ' + wxSlips + ' carr' + (wxSlips > 1 ? 'y' : 'ies') + ' a weather cause tag' : '') + '.');
    } else {
      parts.push('No schedule slip vs baseline was detected in the window.');
    }
    if (ldRoll.rate > 0 && (ldRoll.avoided || ldRoll.incurred)) {
      parts.push('At the contract LD rate of $' + Number(ldRoll.rate).toLocaleString() + '/day, weather-caused slippage represents $' +
        Number(ldRoll.avoided).toLocaleString() + ' of defensible (avoided) exposure, with $' +
        Number(ldRoll.incurred).toLocaleString() + ' attributable to non-weather causes.');
    }
    return parts.join(' ');
  }

  // ---- 1.1 claimPackText: counsel-ready text export for direct print ----
  // Layout contract (enforced by QA check 86): the document opens with a
  // titled header block (project / window / prepared / doc ref), every
  // section is NUMBERED 1..9 in order with a ruled sub-line, tabular rows
  // are column-aligned via pad(), and the document closes with a formal
  // ATTESTATION block (signature / name / role / date) so the pasted text
  // stands alone as a submittable record. Zero hand-typed content.
  function claimPackText(pack) {
    if (!pack) return 'No claim package generated yet. Open the Claim Pack tab, set a date range, and click Generate.';
    const s = (ns.State && ns.State.getState) ? ns.State.getState() : {};
    const userName = String(s.userName || '').trim();
    const L = [];
    const rule = function(ch, n) { L.push(ch.repeat(n || 64)); };
    const pad = function(str, width) {
      str = String(str === undefined || str === null ? '' : str);
      return str.length >= width ? str.slice(0, width - 1) + '…' : str + ' '.repeat(width - str.length);
    };
    const blank = function() { L.push(''); };
    const section = function(num, title) { blank(); L.push(num + '. ' + title); rule('-'); };
    const wrap = function(text, width) {
      // Word-wrap for print: no line longer than `width` chars, breaking at
      // word boundaries so the pasted document prints without ragged overrun.
      const words = String(text || '').split(/\s+/).filter(Boolean);
      const out = [];
      let cur = '';
      words.forEach(function(w) {
        // Hard fallback: a single unbreakable token longer than the width
        // (URL, long task name) is sliced so a line can never overflow.
        const word = w.length > width ? w.slice(0, width) : w;
        if (!cur) { cur = word; return; }
        if (cur.length + 1 + word.length > width) { out.push(cur); cur = word; }
        else { cur += ' ' + word; }
      });
      if (cur) out.push(cur);
      return out;
    };
    const ref = ((pack.from || 'START') + '-' + (pack.to || 'TODAY')).replace(/[^0-9A-Za-z-]/g, '');

    // ---- Header block ----
    rule('=');
    L.push('CLAIM / DELAY PACKAGE');
    rule('=');
    L.push('Project:          ' + pack.project);
    L.push('Reporting window: ' + (pack.from || 'project start') + '  →  ' + (pack.to || 'today'));
    L.push('Prepared:         ' + pack.generatedAt);
    L.push('Document ref:     CLAIM-' + ref);
    rule('=');
    blank();

    // ---- 1. Executive narrative ----
    section(1, 'EXECUTIVE NARRATIVE');
    // Sentence-split WITHOUT lookbehind (portable to older WebViews): match
    // runs ending in sentence punctuation, then trim. A blank line separates
    // sentences for readability in print.
    (pack.narrative.match(/[^.!?]+[.!?]/g) || [pack.narrative]).forEach(function(sent) {
      wrap(sent.trim(), 92).forEach(function(line) { L.push(line); });
      blank();
    });

    // ---- 2. Schedule delta (baseline vs actual, cause-tagged) ----
    section(2, 'SCHEDULE DELTA — BASELINE VS ACTUAL (CAUSE-TAGGED)');
    const deltaHead = pad('TASK', 26) + pad('ID', 7) + pad('+DAYS', 7) + pad('BASELINE END', 14) + pad('CURRENT END', 14) + 'CAUSE';
    L.push(deltaHead);
    rule('-', deltaHead.length);
    if (pack.slips.length) {
      pack.slips.forEach(sl => L.push(pad(sl.taskName, 26) + pad(sl.taskId, 7) + pad('+' + sl.days + 'd', 7) +
        pad(sl.baselineEnd, 14) + pad(sl.currentEnd, 14) + sl.cause + (sl.causeSource === 'user' ? ' (manual tag)' : '')));
    } else { L.push('No slips detected in window.'); }

    // ---- 3. Weather delay log (window) ----
    section(3, 'WEATHER DELAY LOG (WINDOW)');
    const wxHead = pad('DATE', 12) + pad('CONDITIONS', 18) + pad('NOTE', 26) + 'AFFECTED TASKS';
    L.push(wxHead);
    rule('-', wxHead.length);
    if (pack.weatherDelays.length) {
      pack.weatherDelays.forEach(e => L.push(pad(e.date, 12) + pad(e.condition, 18) +
        pad(e.note || '', 26) + (e.affectedTaskIds.length ? e.affectedTaskIds.join(', ') : '—')));
    } else { L.push('None logged in window.'); }

    // ---- 4. Affected WBS tasks ----
    section(4, 'AFFECTED WBS TASKS');
    if (pack.affectedTasks.length) {
      pack.affectedTasks.forEach(t => L.push('[' + t.id + '] ' + t.name + ' — ' + (t.status || 'no status') + (t.dates ? ' (' + t.dates + ')' : '')));
    } else { L.push('None identified in window.'); }

    // ---- 5. LD / contract exposure (window) ----
    section(5, 'LD / CONTRACT EXPOSURE (WINDOW)');
    L.push(pad('LD rate', 34) + '$' + Number(pack.ld.rate).toLocaleString() + ' / day');
    L.push(pad('Weather days in window', 34) + pack.ld.days + ' day' + (pack.ld.days === 1 ? '' : 's') + ' → exposure $' + Number(pack.ld.exposure).toLocaleString());
    L.push(pad('Avoided (weather cause)', 34) + '$' + Number(pack.ldRollup.avoided).toLocaleString() + ' over ' + pack.ldRollup.avoidedDays + 'd');
    L.push(pad('Incurred (other causes)', 34) + '$' + Number(pack.ldRollup.incurred).toLocaleString() + ' over ' + pack.ldRollup.incurredDays + 'd');

    // ---- 6. Change control (window) ----
    section(6, 'CHANGE CONTROL (WINDOW)');
    if (pack.changeControl.length) {
      pack.changeControl.forEach(c => L.push('[' + c.date + '] ' + (c.title || 'Change') + ' | status: ' + c.status +
        (c.schedImpact ? ' | sched: ' + c.schedImpact : '') + (c.costImpact ? ' | cost: ' + c.costImpact : '') +
        (c.notes ? ' | ' + c.notes : '')));
    } else { L.push('None in window.'); }

    // ---- 7. Meeting decisions & action items (window) ----
    section(7, 'MEETING DECISIONS & ACTION ITEMS (WINDOW)');
    if (pack.meetings.length) {
      pack.meetings.forEach(m => L.push('[' + m.date + '] ' + m.kind + (m.summary ? ' — ' + m.summary : '') +
        (m.actions ? ' | Actions: ' + m.actions : '') + (m.followUp ? ' | Follow-up: ' + m.followUp : '')));
    } else { L.push('None tied to window.'); }

    // ---- 8. Carried-forward commitments ----
    section(8, 'CARRIED-FORWARD COMMITMENTS');
    if (pack.openPromises.length) {
      pack.openPromises.forEach(p => L.push('• ' + p.text + ' (' + p.meeting + ')'));
    } else { L.push('None open.'); }

    // ---- 9. Attestation ----
    section(9, 'ATTESTATION');
    L.push('I/we certify that the facts, dates, and figures recorded in this');
    L.push('package are drawn directly from the project\'s live records, that');
    L.push('each entry is traceable to its source log, and that no values');
    L.push('were hand-typed into this export.');
    blank();
    L.push('Signature:     ____________________________');
    L.push('Name:          ' + (userName || '______________________________'));
    L.push('Role:          ____________________________');
    L.push('Date:          ' + (pack.generatedAt || '____________________________'));
    blank();
    rule('=');
    L.push('Prepared by My MaNaGeR from project state — CLAIM-' + ref + '.');
    return L.join('\n');
  }

  // Local calendar date (YYYY-MM-DD) without UTC conversion.
  function toLocalISO(d) {
    const p = function(n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ---- generate(): read the panel's date range, build + render the package ----
  function generate() {
    const fromEl = U.$('claim-from');
    const toEl = U.$('claim-to');
    const from = fromEl ? fromEl.value : '';
    const to = toEl ? toEl.value : '';
    if (from && to && from > to) { // ISO dates compare lexicographically
      if (ns.App && ns.App.showToast) ns.App.showToast('Date range is reversed — From must be before To.', 'err');
      return;
    }
    const pack = buildClaimPack(ns.State.getState(), from, to);
    renderPackage(pack);
    if (ns.App && ns.App.showToast) ns.App.showToast('Claim package generated.', 'ok');
  }

  // ---- renderPackage: live preview in the Claim Pack panel ----
  function renderPackage(pack) {
    const el = U.$('claim-package-body');
    if (!el) return;
    const esc = U.escapeHtml;
    let html = '<div class="claim-narr">' + esc(pack.narrative) + '</div>';
    html += '<div class="wx-stats">' +
      '<div class="wx-stat"><div class="k">Weather Days (window)</div><div class="v">' + pack.weatherDelays.length + '</div></div>' +
      '<div class="wx-stat"><div class="k">Slipped Tasks</div><div class="v">' + pack.slips.length + '</div></div>' +
      '<div class="wx-stat"><div class="k">LD Exposure (window)</div><div class="v">$' + Number(pack.ld.exposure).toLocaleString() + '</div></div>' +
      '<div class="wx-stat"><div class="k">Change Requests</div><div class="v">' + pack.changeControl.length + '</div></div>' +
      '</div>';
    if (pack.weatherDelays.length) {
      html += '<div class="ox"><table class="dt"><thead><tr><th>Date</th><th>Conditions</th><th>Note</th><th>Affected</th></tr></thead><tbody>' +
        pack.weatherDelays.map(e => '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.condition) + '</td><td>' + esc(e.note || '') + '</td><td>' + esc(e.affectedTaskIds.join(', ')) + '</td></tr>').join('') +
        '</tbody></table></div>';
    } else {
      html += '<div class="es" style="padding:12px;font-size:.76rem">No weather delays in the selected window. The narrative, delta and LD sections still pull live state.</div>';
    }
    el.innerHTML = html;
  }

  // ---- renderLdRollup: Budget-tab LD exposure card (1.3) ----
  function renderLdRollup() {
    const el = U.$('ld-rollup-body');
    if (!el) return;
    const ld = ldRollup(ns.State.getState());
    if (!ld.rate && !ld.totalDays) {
      el.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">Set an LD rate ($/day) in the Weather Delay Log card, then slip tasks vs baseline (Claims tab). Weather-tagged slips count as defensible (avoided) exposure; every other cause counts as incurred.</div>';
      return;
    }
    el.innerHTML = '<div class="wx-stats">' +
      '<div class="wx-stat"><div class="k">LD Rate (per day)</div><div class="v">$' + Number(ld.rate).toLocaleString() + '</div></div>' +
      '<div class="wx-stat"><div class="k">Avoided (weather)</div><div class="v var-pos">$' + Number(ld.avoided).toLocaleString() + '</div><div class="t-xxs">' + ld.avoidedDays + 'd weather-caused</div></div>' +
      '<div class="wx-stat"><div class="k">Incurred (other)</div><div class="v ' + (ld.incurred ? 'var-neg' : '') + '">$' + Number(ld.incurred).toLocaleString() + '</div><div class="t-xxs">' + ld.incurredDays + 'd other causes</div></div>' +
      '</div>';
  }

  // ---- renderClaimPanel: slips table with cause tagging + live package preview ----
  function renderClaimPanel() {
    const body = U.$('claim-slips-body');
    if (body) {
      const s = ns.State.getState();
      const slips = computeSlips(s);
      const rate = ldRate(s);
      if (!slips.length) {
        body.innerHTML = '<tr><td colspan="6" class="wbs-empty"><div>No schedule slip vs baseline detected. Save a baseline (Settings &gt; Controls &gt; Save Baseline), then move a task end date past its baseline end to populate this log with cause tags.</div></td></tr>';
      } else {
        body.innerHTML = slips.map(sl =>
          '<tr data-task="' + sl.taskId + '">' +
          '<td>' + U.escapeHtml(sl.taskName) + '</td>' +
          '<td>' + U.escapeHtml(sl.baselineEnd) + '</td>' +
          '<td>' + U.escapeHtml(sl.currentEnd) + '</td>' +
          '<td>+' + sl.days + 'd</td>' +
          '<td><select class="cause-sel" data-action="claimSetCause" data-task="' + sl.taskId + '">' +
          CAUSES.map(c => '<option value="' + c + '"' + (sl.cause === c ? ' selected' : '') + '>' + c +
            (sl.causeSource === 'user' && sl.cause === c ? ' (manual)' : '') + '</option>').join('') +
          '</select></td>' +
          '<td class="txt-sl">' + (sl.cause === 'weather' ? '$' + (sl.days * rate).toLocaleString() + ' defensible' :
            sl.cause === 'unknown' ? 'tag to classify' : '$' + (sl.days * rate).toLocaleString() + ' at risk') + '</td>' +
          '</tr>'
        ).join('');
      }
    }
    renderLdRollup(); // keep the Budget-tab card in sync
    const pkg = U.$('claim-package-body');
    if (pkg) {
      const fromEl = U.$('claim-from'), toEl = U.$('claim-to');
      if (fromEl && toEl) {
        renderPackage(buildClaimPack(ns.State.getState(), fromEl.value, toEl.value));
      }
    }
  }

  // ---- API ----
  ns.Claim = {
    CAUSES: CAUSES,
    computeSlips: computeSlips,
    setCause: setCause,
    ldRollup: ldRollup,
    buildClaimPack: buildClaimPack,
    claimPackText: claimPackText,
    generate: generate,
    render: renderClaimPanel,
    renderClaimPanel: renderClaimPanel,
    renderLdRollup: renderLdRollup
  };
})(MMGR);
window.MMGR = MMGR;
