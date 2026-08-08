/* ============================================================
   My MaNaGeR — Health Score Module
   Ported from the monolith (MONOLITH-PORTING-GUIDE feature 1).
   computeHealthScore() holds the exact 5-factor weighted formula
   (Completion 30% / Schedule 25% / Budget 20% / Risk 15% /
   Change 10%), exposed as a pure function of state so Linkable
   KPIs can point at "Health Score" without duplicating the math.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // A budget line's actual $ — auto-derived from its own Spend Log entries
  // once any exist (single source of truth), otherwise the manual value.
  // Lives here as a pure helper; the Spend module exposes the same math for
  // the cash-flow chart. Kept dependency-free so Health stays portable.
  function lineActual(line, state) {
    const log = (state.spendLog || []).filter(e => e.budgetLineId === line.id);
    if (log.length) return log.reduce((s, e) => s + (+e.amount || 0), 0);
    return +line.actual || 0;
  }

  function computeHealthScore(state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s || !s.tasks) return null;
    const tot = s.tasks.length;
    // Empty project: no tasks means no completion/schedule/budget data exists
    // yet. A computed number here would be fabricated, not measured.
    if (tot === 0) return null;

    const dn = s.tasks.filter(t => t.status === 'completed').length;
    const overdue = s.tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
    const liveIssues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
    const highRisks = (s.risks || []).filter(r => !r.issueId && r.probability === 'High' && r.impact === 'High').length;
    const pendingChg = (s.changes || []).filter(c => c.status === 'submitted' || c.status === 'review' || !c.status).length;

    const tp = (s.budgetLines || []).reduce((sum, b) => sum + (+b.planned || 0), 0);
    const ta = (s.budgetLines || []).reduce((sum, b) => sum + lineActual(b, s), 0);
    const pct = dn / tot;
    const ev = tp * pct;
    const cpi = (ta && tp) ? ev / ta : null;

    // An empty risk log, an empty change log, and tasks with no dates entered
    // yet must NOT silently score as "perfect" (100) purely because there was
    // nothing there to flag as bad. Each factor below requires real
    // underlying data to count at all; otherwise it's excluded from the score
    // entirely and the remaining factors' weights are re-normalized.
    const hasSchedule = s.tasks.some(t => t.startDate && t.endDate);
    const hasBudget = !!(ta && tp);
    const hasRisks = (s.risks || []).length > 0;
    const hasChanges = (s.changes || []).length > 0;
    const f1 = (dn / tot) * 100;
    const f2 = hasSchedule ? Math.max(0, 100 - (overdue / tot) * 100) : null;
    const f3 = hasBudget ? Math.max(0, 100 - Math.abs(cpi - 1) * 200) : null;
    const f4 = hasRisks ? Math.max(0, 100 - (liveIssues * 15) - (highRisks * 5)) : null;
    const f5 = hasChanges ? Math.max(0, 100 - (pendingChg * 10)) : null;
    const weights = { f1: 0.30, f2: 0.25, f3: 0.20, f4: 0.15, f5: 0.10 };
    const factors = { f1: f1, f2: f2, f3: f3, f4: f4, f5: f5 };
    let weightSum = 0, scoreSum = 0;
    Object.keys(factors).forEach(k => {
      if (factors[k] !== null) { weightSum += weights[k]; scoreSum += factors[k] * weights[k]; }
    });
    const score = weightSum ? Math.round(scoreSum / weightSum) : Math.round(f1);
    return { score: score, f1: f1, f2: f2, f3: f3, f4: f4, f5: f5, hasSchedule: hasSchedule, hasBudget: hasBudget, hasRisks: hasRisks, hasChanges: hasChanges, weightSum: weightSum };
  }

  function getHealthScore() {
    const h = computeHealthScore();
    return h ? h.score : null;
  }

  function renderHealthScore() {
    const h = computeHealthScore();
    const setE = (id, v, c) => { const el = document.getElementById(id); if (el) { el.textContent = v; if (c) el.style.color = c; } };
    const suffix = document.getElementById('health-score-suffix');
    if (!h) {
      setE('health-score-num', '—', 'var(--slate)');
      if (suffix) suffix.classList.add('is-hide');
      setE('health-score-label', 'Add tasks to calculate', 'var(--slate)');
      const bar = document.getElementById('health-bar');
      if (bar) { bar.style.width = '0%'; bar.style.background = 'var(--border)'; }
      const bd = document.getElementById('health-breakdown');
      if (bd) bd.innerHTML = '<div>Score becomes available once at least one task exists.</div>';
      _lastScore = null;
      return;
    }
    if (suffix) suffix.classList.remove('is-hide');
    // Narrative must compare against the PREVIOUS score, then we advance.
    const narrative = buildNarrative(h);
    _lastScore = h.score;
    const { score, f1, f2, f3, f4, f5, hasSchedule, hasBudget, hasRisks, hasChanges, weightSum } = h;
    // Distinguish "building baseline" (early project, normal) from a real
    // concern — only treat as warning if there's enough real data behind it
    // (weightSum) OR the schedule factor itself shows an actual problem.
    const earlyStage = weightSum < 0.6 && (f2 === null || f2 >= 80);
    const color = earlyStage ? 'var(--slate)' : score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--amber)' : 'var(--danger)';
    const label = earlyStage ? 'Building Baseline' : score >= 70 ? 'Healthy' : score >= 40 ? 'Needs Attention' : 'At Risk';
    setE('health-score-num', score, color);
    setE('health-score-label', label, color);
    const bar = document.getElementById('health-bar');
    if (bar) { bar.style.width = score + '%'; bar.style.background = color; }
    const row = (labelTxt, val, active) => active
      ? '<div>' + labelTxt + ': ' + Math.round(val) + '</div>'
      : '<div style="color:var(--slate)">' + labelTxt + ': <em>not enough data yet</em></div>';
    const bd = document.getElementById('health-breakdown');
    if (bd) {
      bd.innerHTML = '<div id="health-narrative" style="color:var(--slate);font-style:italic;font-size:.72rem;margin-bottom:6px">' + U.escapeHtml(narrative) + '</div>' +
        (earlyStage
        ? '<div style="color:var(--slate);font-style:italic;margin-bottom:4px">This number is mostly Completion % right now — normal for an early project, not a warning. It becomes a real signal once Budget/Risk/Change have data too.</div>'
        : '') +
        [
          row('Completion (30%)', f1, true),
          row('Schedule (25%)', f2, hasSchedule),
          row('Budget (20%)', f3, hasBudget),
          row('Risk (15%)', f4, hasRisks),
          row('Change (10%)', f5, hasChanges)
        ].join('') +
        (hasSchedule && hasBudget && hasRisks && hasChanges
          ? ''
          : '<div style="margin-top:4px;color:var(--slate);font-style:italic">Score is weighted only across the factors above with real data — the rest count in automatically as you add them.</div>');
    }
  }

  // ---- Narrative Health Score (ACTION-PLAN 1.3) ----
  // Rule-based sentence generator — NO AI call. Explains WHY the score is
  // what it is: which weighted factor drags it, which factors are still
  // waiting on data (excluded from the weighting), and whether it moved
  // since the last render in this session. Regenerated on every render,
  // so it updates live whenever the underlying inputs change.
  let _lastScore = null;

  function buildNarrative(h) {
    if (!h) return 'Add tasks to calculate a Health Score.';
    const parts = [];
    if (_lastScore !== null && _lastScore !== h.score) {
      parts.push('Score moved from ' + _lastScore + ' to ' + h.score + ' since the last update.');
    }
    const factorNames = { f1: 'Completion', f2: 'Schedule', f3: 'Budget', f4: 'Risk', f5: 'Change' };
    let worst = null;
    Object.keys(factorNames).forEach(k => {
      const v = h[k];
      if (v !== null && v !== undefined && (worst === null || v < worst.v)) worst = { k: k, v: v };
    });
    if (worst && worst.v < 80) {
      parts.push(factorNames[worst.k] + ' is the main drag at ' + Math.round(worst.v) + ' — the rest score higher.');
    }
    const missing = [];
    if (!h.hasSchedule) missing.push('Schedule');
    if (!h.hasBudget) missing.push('Budget');
    if (!h.hasRisks) missing.push('Risk');
    if (!h.hasChanges) missing.push('Change');
    if (missing.length) {
      parts.push('Waiting on data: ' + missing.join(', ') + ' — excluded from the weighting until they have real inputs.');
    }
    if (!parts.length) parts.push('All weighted factors are healthy.');
    return parts.join(' ');
  }

  // ---- API ----
  ns.Health = {
    compute: computeHealthScore,
    get: getHealthScore,
    render: renderHealthScore,
    lineActual: lineActual,
    narrative: buildNarrative
  };

})(MMGR);
window.MMGR = MMGR;
