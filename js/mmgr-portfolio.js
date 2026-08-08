/* ============================================================
   My MaNaGeR — Portfolio Health Rollup (ACTION-PLAN 6.1)
   Loaded ONLY by app.html (the project dashboard / app entry).

   Reads every unlocked project's saved state from localStorage
   (same mmgr_state_<id> keys the project viewer writes) and
   computes:
     - a health score using the SAME 5-factor weighted formula as
       js/mmgr-health.js (Completion 30 / Schedule 25 / Budget 20
       / Risk 15 / Change 10, re-normalized over factors that have
       real data);
     - an urgency score from live risk signals: overdue tasks,
       open issues, timeline overrun vs the charter target,
       budget overrun, and high-severity risks.
   Projects are ranked by urgency (highest first) with a visible
   plain-English reason on each card.

   This is a pure client-side read (simulated backend: no server
   round-trip). No project's data leaves the browser.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  // ---- Health (mirror of mmgr-health.js computeHealthScore) ----   // Deliberately duplicated here (not loaded on app.html) so the
  // portfolio never depends on the project viewer's module graph.
  function daysBetween(a, b) {
    const da = new Date(a); const db = new Date(b);
    return Math.round((db - da) / 86400000);
  }
  function isOverdue(endDate) {
    if (!endDate) return false;
    const d = new Date(endDate); const t = new Date(); t.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return d < t;
  }

  function computeHealth(state) {
    const s = state || {};
    const tasks = s.tasks || [];
    if (!tasks.length) return null;
    const dn = tasks.filter(t => t.status === 'completed').length;
    const tot = tasks.length;
    const overdue = tasks.filter(t => isOverdue(t.endDate) && t.status !== 'completed').length;
    const liveIssues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
    const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
    const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
    const hasSchedule = tasks.some(t => t.startDate && t.endDate);
    const hasBudget = !!(actual && planned);
    const hasRisks = (s.risks || []).length > 0;
    const hasChanges = (s.changes || []).length > 0;
    const f1 = (dn / tot) * 100;
    const f2 = hasSchedule ? Math.max(0, 100 - (overdue / tot) * 100) : null;
    const f3 = hasBudget ? (planned ? Math.max(0, 100 - ((actual - planned) / planned) * 100) : 100) : null;
    const f4 = hasRisks ? Math.max(0, 100 - ((s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'high')).length * 12)) : null;
    const f5 = hasChanges ? Math.max(0, 100 - ((s.changes || []).filter(c => c.status === 'submitted' || c.status === 'review').length * 10)) : null;
    const weights = { f1: 0.30, f2: 0.25, f3: 0.20, f4: 0.15, f5: 0.10 };
    const factors = { f1: f1, f2: f2, f3: f3, f4: f4, f5: f5 };
    let weightSum = 0, scoreSum = 0;
    Object.keys(factors).forEach(k => {
      if (factors[k] !== null) { weightSum += weights[k]; scoreSum += factors[k] * weights[k]; }
    });
    const score = weightSum ? Math.round(scoreSum / weightSum) : Math.round(f1);
    return { score: score, overdue: overdue, liveIssues: liveIssues, hasData: weightSum > 0 };
  }

  // ---- Urgency ranking ----
  // Weighted risk signals; every contributing signal earns a named
  // reason so the ranking is explainable, never a black box.
  //   overdue tasks        +6 each (cap 30)
  //   open issues          +8 each (cap 24)
  //   timeline overrun     +2 per day (cap 20)
  //   budget overrun       +15 if actual > planned
  //   high risks           +5 each (cap 15)
  //   low health           +(100 - score) * 0.15
  function computeUrgency(state, health) {
    const s = state || {};
    const reasons = [];
    let score = 0;
    const overdue = health ? health.overdue : (s.tasks || []).filter(t => isOverdue(t.endDate) && t.status !== 'completed').length;
    if (overdue) { score += Math.min(30, overdue * 6); reasons.push(overdue + ' overdue task' + (overdue > 1 ? 's' : '')); }
    const issues = health ? health.liveIssues : (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
    if (issues) { score += Math.min(24, issues * 8); reasons.push(issues + ' open issue' + (issues > 1 ? 's' : '')); }
    const f = s.charter || {};
    const dated = (s.tasks || []).filter(t => t.endDate);
    if (f.targetCompletion && dated.length) {
      const target = new Date(f.targetCompletion);
      const proj = new Date(Math.max.apply(null, dated.map(t => new Date(t.endDate).getTime())));
      const over = daysBetween(target, proj);
      if (over > 0) { score += Math.min(20, over * 2); reasons.push('+' + over + 'd past target'); }
    }
    const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
    const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
    if (planned && actual > planned) { score += 15; reasons.push('over planned budget'); }
    const highRisks = (s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'high')).length;
    if (highRisks) { score += Math.min(15, highRisks * 5); reasons.push(highRisks + ' high risk' + (highRisks > 1 ? 's' : '')); }
    // Weather-risk days in the next 7 days (ACTION-PLAN 7.6) — +4 each, cap 12.
    const wxDays = wxRiskDays(s);
    if (wxDays.length) {
      score += Math.min(12, wxDays.length * 4);
      reasons.push(wxDays.length + ' weather-risk day' + (wxDays.length > 1 ? 's' : '') + ' in next 7d');
    }
    if (health && health.score !== null) { score += (100 - health.score) * 0.15; }
    const tier = score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
    return { score: Math.round(score), tier: tier, reason: reasons.slice(0, 3).join(', ') || 'on track' };
  }

  // ---- Weather-risk days (ACTION-PLAN 7.6) ----
  // Pure read of the project's cached 16-day Open-Meteo forecast (written by
  // js/mmgr-forecast.js on the project viewer). Mirrors the same thresholds
  // (precip>=60, heat>=32C, cold<=0C) so the portfolio badge never disagrees
  // with the viewer's own strip. No network call — the cache is client-side.
  function wxRiskDays(state) {
    const s = state || {};
    const c = s.wxCache;
    if (!c || !c.days || !c.days.length) return [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in7 = new Date(today.getTime() + 7 * 86400000);
    return c.days.filter(d => {
      const dateObj = new Date(String(d.date).replace(/-/g, '/') + ' 00:00:00');
      if (isNaN(dateObj) || dateObj < today || dateObj > in7) return false;
      return d.precip >= 60 || d.tMax >= 32 || d.tMin <= 0;
    });
  }

  // ---- Rollup over all published projects ----
  // Reads each project's OWN saved state. Locked projects (no unlock
  // flag in this browser) can't be opened, so they're ranked last with
  // a locked note — their data is never readable without the code.
  function rank(projects) {
    const list = (projects || []).map(p => {
      const unlocked = localStorage.getItem('mmgr_unlocked_' + p.id) === '1';
      if (!unlocked) {
        return { project: p, unlocked: false, health: null, urgency: { score: 0, tier: 'locked', reason: 'locked' }, rank: null };
      }
      let state = null;
      try { const raw = localStorage.getItem('mmgr_state_' + p.id); if (raw) state = JSON.parse(raw); } catch (e) { state = null; }
      const health = state ? computeHealth(state) : null;
      const urgency = state ? computeUrgency(state, health) : { score: 0, tier: 'none', reason: 'no saved data yet' };
      return { project: p, unlocked: true, state: state, health: health, urgency: urgency, rank: null };
    });
    // Rank: urgency score descending; unlocked-but-no-data above locked.
    const ranked = list.slice().sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return (b.urgency.score || 0) - (a.urgency.score || 0);
    });
    ranked.forEach((r, i) => { r.rank = i + 1; });
    return ranked;
  }

  function tierLabel(t) {
    return { high: 'Urgent', medium: 'Watch', low: 'On Track', locked: 'Locked', none: 'No Data' }[t] || t;
  }

  // ---- Render into the dashboard's portfolio strip ----
  function render() {
    const el = document.getElementById('portfolio-strip');
    if (!el) return;
    const projects = window.MMGR_PROJECTS || [];
    if (!projects.length) { el.innerHTML = ''; return; }
    const ranked = rank(projects);
    const badges = { high: 'br', medium: 'ba', low: 'bg', locked: '', none: 'bo' };
    el.innerHTML = ranked.map(r => {
      const p = r.project;
      const u = r.urgency;
      const healthTxt = r.health && r.health.score !== null ? r.health.score + '/100' : '—';
      const cls = badges[u.tier] || '';
      const wxN = r.state ? wxRiskDays(r.state).length : 0;
      const wxBadge = wxN ? `<span class="badge br" style="font-size:.6rem" title="${wxN} weather-risk day(s) in the next 7 days">${wxN} wx-risk</span>` : '';
      return `<div class="pf-card" data-id="${escapeHtml(p.id)}">
        <div class="pf-rank">${r.rank}</div>
        <div class="pf-body">
          <div class="pf-title">${escapeHtml(p.title)}</div>
          <div class="pf-meta">Health <strong>${healthTxt}</strong> · Urgency <span class="badge ${cls}" style="font-size:.6rem">${tierLabel(u.tier)}</span>${wxBadge}</div>
          <div class="pf-reason">${escapeHtml(u.reason)}</div>
        </div>
      </div>`;
    }).join('');
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  // ---- API ----
  ns.Portfolio = {
    computeHealth: computeHealth,
    computeUrgency: computeUrgency,
    rank: rank,
    render: render,
    wxRiskDays: wxRiskDays
  };
})(MMGR);
window.MMGR = MMGR;
