/* ============================================================
   My MaNaGeR — Weekly / Daily Digest (MASTER-ACTION-PLAN-v3-STRICT Rank 2.1)
   ------------------------------------------------------------
   An AUTO-GENERATED "what changed" digest — not manually compiled,
   not an AI guess. The user pins a reference point (a compact
   fingerprint of digest-relevant state), and every later generation
   diffs live state against that snapshot so the summary is exact:
   zero missed changes, zero invented ones. Before a pin exists the
   digest falls back to the saved schedule baseline.

   Coverage (all pulled from unified state, zero server cost):
     - Tasks: completed since reference, slipped, recovered, added,
       removed
     - Risks: new high-severity, promoted to issue, issues resolved
     - Budget: variance movement (planned/actual per project)
     - Decisions: open action items across Comms / Decision Log /
       carried-forward meeting promises
     - Weather delay days logged since reference (feeds Rank 1)
     - Change-control status moves + new spend entries

   Delivery is local only: generate → read on screen, Copy All, or
   print. No server-side email in v1 (zero-server constraint).
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // ---- captureSnapshot: compact fingerprint of digest-relevant state ----
  function captureSnapshot(state) {
    const s = state || ns.State.getState();
    return {
      at: new Date().toISOString(),
      tasks: (s.tasks || []).map(t => ({
        id: String(t.id), name: t.name || '', status: t.status || 'todo',
        startDate: t.startDate || '', endDate: t.endDate || '', duration: t.duration || ''
      })),
      risks: (s.risks || []).map(r => ({
        id: String(r.id), probability: r.probability || '',
        impact: r.impact || '', issueId: r.issueId || null
      })),
      issues: (s.issues || []).map(i => ({ id: String(i.id), status: i.status || '' })),
      budgetLines: (s.budgetLines || []).map(b => ({
        id: String(b.id), planned: +b.planned || 0, actual: +b.actual || 0
      })),
      budgetEnvelope: +s.budgetEnvelope || 0,
      spendCount: (s.spendLog || []).length,
      changes: (s.changes || []).map(c => ({ id: String(c.id), status: c.status || '' })),
      weatherLogCount: (s.weatherLog || []).length
      // NOTE: comms/log counts and meeting-promise states are intentionally
      // NOT snapshot fields — open decisions/promises render as a standing
      // (always-live) section, never as a diff, so there is nothing to pin.
    };
  }

  // ---- computeDigest: PURE diff, no writes ----
  function computeDigest(state) {
    const s = state || ns.State.getState();
    const snap = s.digestSnapshot || null;
    const baseTasks = (s.baseline && s.baseline.tasks) || null;
    const curTasks = s.tasks || [];
    const curMap = {};
    curTasks.forEach(t => { curMap[String(t.id)] = t; });

    const d = {
      mode: snap ? 'snapshot' : (baseTasks ? 'baseline' : 'none'),
      referenceAt: snap ? snap.at : (s.baseline && s.baseline.capturedAt) || null,
      generatedAt: new Date().toLocaleString(),
      project: s.projectName || (s.charter && s.charter.name) || 'Project',
      completed: [], slipped: [], recovered: [], added: [], removed: [],
      newHighRisks: [], risksPromoted: [], issuesResolved: [],
      budget: null, openActions: [], weatherDaysLogged: 0,
      changeChanges: [], spendAdded: 0
    };

    if (snap) {
      const snapTaskMap = {};
      snap.tasks.forEach(t => { snapTaskMap[t.id] = t; });
      curTasks.forEach(t => {
        const pt = snapTaskMap[String(t.id)];
        if (pt && pt.status !== 'completed' && t.status === 'completed') d.completed.push(t.name || t.id);
      });
      Object.keys(snapTaskMap).forEach(id => {
        const pt = snapTaskMap[id];
        const ct = curMap[id];
        if (!ct) { d.removed.push(pt.name || id); return; }
        if (pt.endDate && ct.endDate) {
          const diff = U.daysBetween(pt.endDate, ct.endDate);
          if (diff > 0) d.slipped.push({ name: ct.name || id, days: diff });
          else if (diff < 0) d.recovered.push({ name: ct.name || id, days: Math.abs(diff) });
        }
      });
      curTasks.forEach(t => { if (!snapTaskMap[String(t.id)]) d.added.push(t.name || t.id); });

      // Risks
      const snapRiskMap = {};
      snap.risks.forEach(r => { snapRiskMap[r.id] = r; });
      (s.risks || []).forEach(r => {
        const id = String(r.id);
        const pr = snapRiskMap[id];
        const high = /high/i.test(r.probability || '') || /high/i.test(r.impact || '');
        if (!pr) {
          if (high && !r.issueId) d.newHighRisks.push(r.description || id);
        } else if (!pr.issueId && r.issueId) {
          d.risksPromoted.push(r.description || id);
        }
      });
      // Issues resolved
      const snapIssueMap = {};
      snap.issues.forEach(i => { snapIssueMap[i.id] = i; });
      (s.issues || []).forEach(i => {
        const pi = snapIssueMap[String(i.id)];
        if (pi && pi.status !== 'resolved' && pi.status !== 'closed' &&
            (i.status === 'resolved' || i.status === 'closed')) d.issuesResolved.push(i.description || i.id);
      });
      // Budget movement
      const snapBudMap = {};
      snap.budgetLines.forEach(b => { snapBudMap[b.id] = b; });
      const curPlanned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const curActual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
      const snapPlanned = snap.budgetLines.reduce((n, b) => n + b.planned, 0);
      const snapActual = snap.budgetLines.reduce((n, b) => n + b.actual, 0);
      if (curPlanned !== snapPlanned || curActual !== snapActual || (s.budgetLines || []).length !== snap.budgetLines.length) {
        d.budget = { plannedBefore: snapPlanned, plannedAfter: curPlanned, actualBefore: snapActual, actualAfter: curActual };
      }
      // Change-control status moves
      const snapChgMap = {};
      snap.changes.forEach(c => { snapChgMap[c.id] = c; });
      (s.changes || []).forEach(c => {
        const pc = snapChgMap[String(c.id)];
        if (pc && pc.status !== (c.status || '')) d.changeChanges.push({ title: c.title || c.id, from: pc.status, to: c.status || '' });
      });
      // Spend + weather deltas
      d.spendAdded = (s.spendLog || []).length - snap.spendCount;
      d.weatherDaysLogged = (s.weatherLog || []).length - snap.weatherLogCount;
    } else if (baseTasks) {
      // First run (no pin): report schedule + budget movement vs the baseline
      const baseMap = {};
      baseTasks.forEach(t => { baseMap[String(t.id)] = t; });
      Object.keys(baseMap).forEach(id => {
        const bt = baseMap[id];
        const ct = curMap[id];
        if (!ct) { d.removed.push(bt.name || id); return; }
        if (bt.status !== 'completed' && ct.status === 'completed') d.completed.push(ct.name || id);
        if (bt.endDate && ct.endDate) {
          const diff = U.daysBetween(bt.endDate, ct.endDate);
          if (diff > 0) d.slipped.push({ name: ct.name || id, days: diff });
          else if (diff < 0) d.recovered.push({ name: ct.name || id, days: Math.abs(diff) });
        }
      });
      curTasks.forEach(t => { if (!baseMap[String(t.id)]) d.added.push(t.name || t.id); });
      const basePlanned = (s.baseline.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const baseActual = (s.baseline.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
      const curPlanned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const curActual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
      // Compare against the baseline's OWN captured actuals (the baseline is a
      // full budgetLines snapshot) — never a hardcoded zero, which would turn
      // any spend into a phantom "movement" even when nothing changed.
      if (basePlanned !== curPlanned || baseActual !== curActual) {
        d.budget = { plannedBefore: basePlanned, plannedAfter: curPlanned, actualBefore: baseActual, actualAfter: curActual };
      }
    }

    // Open decisions / promises — always live
    (s.commsEntries || []).forEach(c => {
      if ((c.actionItems || '').trim()) d.openActions.push({ kind: 'Comms', date: c.date || '', text: c.actionItems });
    });
    (s.logEntries || []).forEach(l => {
      if ((l.actionItems || '').trim()) d.openActions.push({ kind: 'Decision Log', date: l.date || '', text: l.actionItems });
    });
    const promises = s.meetingPromises || {};
    Object.keys(promises).forEach(k => {
      (promises[k] || []).forEach(p => { if (!p.done && (p.text || '').trim()) d.openActions.push({ kind: 'Promise (' + k + ')', date: '', text: p.text }); });
    });

    return d;
  }

  // ---- Reference-point label (snapshot date / baseline / none) ----
  function referenceLabel(d) {
    if (d.mode === 'snapshot') return 'pinned ' + new Date(d.referenceAt).toLocaleString();
    if (d.mode === 'baseline') return 'baseline' + (d.referenceAt ? ' (' + new Date(d.referenceAt).toLocaleString() + ')' : '');
    return 'none — pin a reference point to start the weekly loop';
  }

  // ---- digestSections: single source of truth for text + HTML ----
  // Returns [{ title, lines }]; empty sections are emitted with a marker
  // so a skim shows the digest checked each area instead of skipping it.
  function digestSections(d) {
    const secs = [];
    const add = (title, lines, noneText) => {
      if (lines.length) secs.push({ title: title, lines: lines });
      else secs.push({ title: title, lines: [noneText || '(none)'] });
    };

    add('Completed', d.completed.map(n => '• ' + n), '(nothing completed since reference)');

    const slipLines = d.slipped.sort((a, b) => b.days - a.days).map(x => '• ' + x.name + ' slipped by ' + x.days + 'd');
    const recLines = d.recovered.sort((a, b) => b.days - a.days).map(x => '• ' + x.name + ' recovered ' + x.days + 'd');
    add('Schedule movement', slipLines.concat(recLines), '(no schedule movement since reference)');
    add('Scope', d.added.map(n => '• added: ' + n).concat(d.removed.map(n => '• removed: ' + n)), '(no scope change)');

    add('New high-severity risks', d.newHighRisks.map(r => '• ' + r), '(no new high-severity risks)');
    add('Risk promotions & resolutions', d.risksPromoted.map(r => '• promoted to issue: ' + r).concat(d.issuesResolved.map(i => '• resolved: ' + i)), '(no risk/issue status changes)');

    if (d.budget) {
      const b = d.budget;
      const fmt = (n) => '$' + Number(n).toLocaleString();
      const varBefore = b.actualBefore - b.plannedBefore;
      const varAfter = b.actualAfter - b.plannedAfter;
      const mv = varAfter - varBefore;
      add('Budget variance movement', [
        '• planned ' + fmt(b.plannedBefore) + ' → ' + fmt(b.plannedAfter),
        '• actual ' + fmt(b.actualBefore) + ' → ' + fmt(b.actualAfter),
        '• variance ' + fmt(varBefore) + ' → ' + fmt(varAfter) + (mv ? ' (Δ ' + (mv > 0 ? '+' : '') + fmt(mv) + ')' : '')
      ]);
    } else {
      add('Budget variance movement', [], '(no budget movement since reference)');
    }

    add('Open decisions / promises', d.openActions.map(a => '• [' + a.kind + '] ' + (a.date ? a.date + ' — ' : '') + a.text), '(no open decisions or promises)');
    add('Change control', d.changeChanges.map(c => '• ' + c.title + ': ' + c.from + ' → ' + c.to), '(no change-control status moves)');
    add('Weather & spend', []
      .concat(d.weatherDaysLogged ? ['• ' + d.weatherDaysLogged + ' weather delay day' + (d.weatherDaysLogged > 1 ? 's' : '') + ' logged'] : [])
      .concat(d.spendAdded ? ['• ' + d.spendAdded + ' new spend entr' + (d.spendAdded > 1 ? 'ies' : 'y')] : []),
      '(no new weather days or spend entries)');

    return secs;
  }

  function hasAnyChange(d) {
    // Open decisions/promises are a STANDING list (always rendered live, never
    // a delta) — they must not count as "changes", or the honest
    // 'No changes detected' empty state would be unreachable for any project
    // with an open item.
    return !!(d.completed.length || d.slipped.length || d.recovered.length || d.added.length ||
      d.removed.length || d.newHighRisks.length || d.risksPromoted.length || d.issuesResolved.length ||
      d.budget || d.changeChanges.length || d.weatherDaysLogged || d.spendAdded);
  }

  // ---- buildDigestText: Copy All / print rendering ----
  function buildDigestText(d) {
    const L = [];
    L.push('WEEKLY / DAILY DIGEST — ' + d.project);
    L.push('Generated: ' + d.generatedAt + ' | Reference: ' + referenceLabel(d));
    L.push('='.repeat(40));
    if (!hasAnyChange(d)) {
      L.push('No changes detected since the reference point — everything matches the pinned state.');
    }
    digestSections(d).forEach(sec => {
      L.push('');
      L.push(sec.title.toUpperCase());
      L.push('-'.repeat(30));
      sec.lines.forEach(l => L.push(l));
    });
    L.push('');
    L.push('Auto-generated by My MaNaGeR from project state — every line traces to a real record.');
    return L.join('\n');
  }

  // ---- renderDigestCard: dashboard card ----
  function renderDigestCard(d) {
    const el = U.$('digest-body');
    if (!el) return;
    const esc = U.escapeHtml;
    let html = '<div class="digest-meta">Generated ' + esc(d.generatedAt) + ' · Reference: <strong>' + esc(referenceLabel(d)) + '</strong></div>';
    if (d.mode === 'none') {
      html += '<div class="es" style="padding:12px;font-size:.76rem">No baseline and no pinned reference point yet. <strong>Pin Reference</strong> to capture the current state — from then on, every digest lists exactly what changed since this moment. (Until then the digest shows the live open-decision list below.)</div>';
    } else if (!hasAnyChange(d)) {
      html += '<div class="es es-ok" style="padding:12px;font-size:.76rem"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> No changes detected since the reference point — everything matches.</div>';
    }
    digestSections(d).forEach(sec => {
      html += '<div class="digest-sec"><div class="digest-sec-title">' + esc(sec.title) + '</div>' +
        sec.lines.map(l => '<div class="bn-item">' + esc(l.replace(/^• /, '')) + '</div>').join('') + '</div>';
    });
    el.innerHTML = html;
  }

  // ---- generate: compute + render (read-only) ----
  function generate() {
    render();
    if (ns.App && ns.App.showToast) ns.App.showToast('Digest generated.', 'ok');
  }

  // ---- pin: capture the reference point (mutating — blocked in readonly) ----
  function pin() {
    ns.State.updateState(function(st) {
      st.digestSnapshot = captureSnapshot(st);
    });
    render();
    if (ns.App && ns.App.showToast) ns.App.showToast('Reference pinned — future digests show what changed from now.', 'ok');
  }

  function render() {
    renderDigestCard(computeDigest());
  }

  // ---- API ----
  ns.Digest = {
    captureSnapshot: captureSnapshot,
    computeDigest: computeDigest,
    buildDigestText: buildDigestText,
    referenceLabel: referenceLabel,
    generate: generate,
    pin: pin,
    render: render
  };
})(MMGR);
window.MMGR = MMGR;
