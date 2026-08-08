/* ============================================================
   My MaNaGeR — DMAIC Workflow Module
   Ported from the monolith (MONOLITH-PORTING-GUIDE feature 8).
   Full interactivity: editable phase content per DMAIC phase,
   per-phase complete/reopen, persistent via State.updateState.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  const DMAIC_DEFS = [
    { key: 'define', title: 'D — Define', hint: 'Define the problem, goal, and boundaries.', fields: [['problem', 'Problem Statement', 'State it in measurable terms.'], ['goal', 'Goal Statement', 'Measurable improvement by what date?'], ['scope', 'Project Scope', 'Processes included and excluded.'], ['sponsor', 'Champion / Sponsor', 'Authority and accountability.'], ['voice', 'Voice of the Customer', 'What does the customer say?']] },
    { key: 'measure', title: 'M — Measure', hint: 'Quantify the current state.', fields: [['baseline', 'Baseline Performance', 'Current defect rate / metric.'], ['defects', 'Defect Definition', 'What counts as a defect?'], ['unit', 'Unit of Measure', 'e.g. per pour, per floor.'], ['opportunity', 'Opportunities per Unit', 'How many ways can a defect occur?'], ['dpmo', 'DPMO', 'Defects per million opportunities.'], ['sigmaNow', 'Current Sigma Level', 'e.g. 2.8σ']] },
    { key: 'analyze', title: 'A — Analyze', hint: 'Identify root causes.', fields: [['rootCauses', 'Root Causes', '5 Whys / cause-effect analysis.'], ['fishbone', 'Fishbone Notes', 'Categorized contributors.'], ['paretoTop', 'Pareto Top Drivers', 'The vital few.']] },
    { key: 'improve', title: 'I — Improve', hint: 'Design and pilot solutions.', fields: [['solutions', 'Proposed Solutions', 'Ranked options.'], ['pilot', 'Pilot Plan', 'Where and how tested.'], ['results', 'Pilot Results', 'Measurable outcomes.']] },
    { key: 'control', title: 'C — Control', hint: 'Sustain the improvement.', fields: [['plan', 'Control Plan', 'Standards and procedures.'], ['metrics', 'Ongoing Metrics', 'KPIs to monitor.'], ['handover', 'Handover', 'Owner and review cadence.']] }
  ];

  function updDMAIC(phase, field, val) {
    ns.State.updateState(function(s) {
      if (!s.dmaic) s.dmaic = defaultDmaic();
      if (s.dmaic[phase]) s.dmaic[phase][field] = val;
    });
  }

  function tglDMAICPhase(phase) {
    ns.State.updateState(function(s) {
      if (!s.dmaic) s.dmaic = defaultDmaic();
      if (s.dmaic[phase]) s.dmaic[phase].done = !s.dmaic[phase].done;
    });
    renderDMAIC();
    // Keep the Dashboard signal live when a phase completes/reopens.
    renderDmaicSignal();
  }

  // DMAIC on/off — keeps the nav visible state in sync with methodology UI.
  function tglDMAIC(on) {
    ns.State.updateState(function(s) {
      if (!s.dmaic) s.dmaic = defaultDmaic();
      s.dmaic.active = !!on;
    });
    renderDMAIC();
    if (ns.App && ns.App.showToast && on) ns.App.showToast('DMAIC Mode activated — open the DMAIC tab.', 'ok');
  }

  function defaultDmaic() {
    return {
      active: false,
      define: { problem: '', goal: '', scope: '', sponsor: '', voice: '', done: false },
      measure: { baseline: '', defects: '', unit: '', opportunity: '', dpmo: '', sigmaNow: '', done: false },
      analyze: { rootCauses: '', fishbone: '', paretoTop: '', done: false },
      improve: { solutions: '', pilot: '', results: '', done: false },
      control: { plan: '', metrics: '', handover: '', done: false }
    };
  }

  function renderDMAIC() {
    const s = ns.State.getState();
    const el = U.$('dmaic-phases');
    if (!el) return;
    if (!s.dmaic || !s.dmaic.define) { el.innerHTML = ''; return; }
    el.innerHTML = DMAIC_DEFS.map(ph => {
      const data = s.dmaic[ph.key] || {};
      const done = !!data.done;
      return `<div class="card dmaic-card"><div class="card-title">${ph.title}<div class="dmaic-actions"><span class="badge ${done ? 'bg' : 'bs'}">${done ? 'Complete' : 'In Progress'}</span><button class="btn ${done ? 'btn-n' : 'btn-g'} btn-s" data-action="tglDMAICPhase" data-phase="${ph.key}">${done ? 'Reopen' : 'Mark Complete'}</button></div></div><div class="dmaic-hint">${ph.hint}</div><div class="charter-grid">${ph.fields.map(([f, lbl, sub]) => `<div class="cf-field full"><label class="cf-label">${lbl}</label><div class="cf-sub">${sub}</div><textarea class="cf-ta" data-action="updDMAIC" data-phase="${ph.key}" data-field="${f}">${(data[f] || '').replace(/</g, '&lt;')}</textarea></div>`).join('')}</div></div>`;
    }).join('');
  }

  // ---- Dashboard signal (gap: DMAIC phase completion drove no dashboard
  // signal) ----
  // A compact progress strip on the Dashboard — visible only while DMAIC is
  // active — so phase completion feeds the at-a-glance view instead of
  // living only inside the DMAIC tab.
  function renderDmaicSignal() {
    const s = ns.State.getState();
    const wrap = U.$('dmaic-signal-wrap');
    if (!wrap) return;
    const d = s.dmaic;
    if (!d || !d.active) { wrap.classList.add('is-hide'); return; }
    wrap.classList.remove('is-hide');
    const done = DMAIC_DEFS.filter(ph => d[ph.key] && d[ph.key].done).length;
    const total = DMAIC_DEFS.length;
    const pct = Math.round((done / total) * 100);
    const el = U.$('dmaic-signal');
    if (!el) return;
    const chips = DMAIC_DEFS.map(ph => {
      const isDone = !!(d[ph.key] && d[ph.key].done);
      return `<span class="dmaic-chip ${isDone ? 'done' : ''}" title="${U.escapeHtml(ph.title)}">${ph.key.charAt(0).toUpperCase()}</span>`;
    }).join('');
    el.innerHTML = `<div class="dmaic-signal-row">
      <div class="dmaic-chips">${chips}</div>
      <div class="dmaic-bar"><div class="dmaic-fill" style="width:${pct}%"></div></div>
      <div class="dmaic-pct">${done}/${total} phases complete (${pct}%)</div>
    </div>`;
  }

  // ---- API ----
  ns.Dmaic = {
    DMAIC_DEFS: DMAIC_DEFS,
    updDMAIC: updDMAIC,
    tglDMAICPhase: tglDMAICPhase,
    tglDMAIC: tglDMAIC,
    render: renderDMAIC,
    renderSignal: renderDmaicSignal,
    defaults: defaultDmaic
  };

})(MMGR);
window.MMGR = MMGR;
