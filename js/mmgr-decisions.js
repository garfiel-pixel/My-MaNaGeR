/* ============================================================
   My MaNaGeR — Today Decision Engine (ACTION-PLAN-COMPETITIVE-GAPS 1.1)
   Ranked "needs you now" list on the Dashboard. Pulls from existing
   data sources and scores every item by IMPACT so the user sees
   what matters most, not just what is due soonest.

   IMPACT FORMULA (documented in-code, single source of truth):
     impact = wSchedule × daysLate        (overdue tasks, days past end date)
            + wStalled  × daysStalled     (tasks past their start date, never started)
            + wRisk     × severity        (High/High = 3, High/Med or Med/High = 2, Med/Med = 1)
            + wBudget   × budgetPct       (planned-vs-actual overrun %, capped at 60)
            + wAction   × openActions     (open action items in Comms / Decision Log / meeting promises)
     weights: wSchedule=4, wStalled=2, wRisk=6, wBudget=8, wAction=3
   Ranking = sort by impact descending, keep top 8. Live-updates
   because renderDash re-runs this on every state change.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // ---- Pure scoring over live state (no DOM, no writes) ----
  function riskSeverity(r) {
    const p = (r.probability || '').toLowerCase();
    const i = (r.impact || '').toLowerCase();
    if (p === 'high' && i === 'high') return 3;
    if ((p === 'high' && i === 'medium') || (p === 'medium' && i === 'high')) return 2;
    if (p === 'medium' && i === 'medium') return 1;
    return 0; // anything involving Low does not force its way into today
  }

  function openActionItemCount(s) {
    let n = 0;
    (s.commsEntries || []).forEach(c => { if ((c.actionItems || '').trim()) n++; });
    (s.logEntries || []).forEach(l => { if ((l.actionItems || '').trim()) n++; });
    const promises = s.meetingPromises || {};
    Object.keys(promises).forEach(k => { n += promises[k].filter(p => !p.done).length; });
    return n;
  }

  function computeTodayDecisions(state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s) return [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const W = { schedule: 4, stalled: 2, risk: 6, budget: 8, action: 3 };
    const items = [];

    // 1. Overdue tasks — schedule slip past their end date
    (s.tasks || []).forEach(t => {
      if (t.status === 'completed' || !t.endDate) return;
      const end = U.parseDL(t.endDate);
      if (!end) return;
      const days = Math.round((end - today) / 86400000);
      if (days >= 0) return;
      const slip = Math.abs(days);
      items.push({
        src: 'Schedule',
        title: 'Task overdue',
        detail: t.name + ' — ' + slip + 'd past end date',
        impact: Math.round(W.schedule * slip),
        reason: slip + ' days late'
      });
    });

    // 2. Stalled tasks — planned start passed, work never started
    (s.tasks || []).forEach(t => {
      if (t.status !== 'todo' && t.status !== '') return;
      if (!t.startDate) return;
      const st = U.parseDL(t.startDate);
      if (!st) return;
      const days = Math.round((today - st) / 86400000);
      if (days <= 0) return;
      items.push({
        src: 'Stalled',
        title: 'Work not started',
        detail: t.name + ' — planned start ' + t.startDate + ' passed ' + days + 'd ago',
        impact: Math.round(W.stalled * Math.min(days, 30)),
        reason: 'stalled ' + days + 'd'
      });
    });

    // 3. High-severity risks still open (not yet promoted to issues)
    (s.risks || []).forEach(r => {
      if (r.issueId) return;
      const sev = riskSeverity(r);
      if (!sev) return;
      items.push({
        src: 'Risk',
        title: 'High risk open',
        detail: (r.description || 'Untitled risk') + ' — ' + r.probability + ' / ' + r.impact,
        impact: W.risk * sev,
        reason: r.probability + ' probability, ' + r.impact + ' impact'
      });
    });

    // 4. Budget variance flag — actual spend past planned
    const planned = (s.budgetLines || []).reduce((sum, l) => sum + (+l.planned || 0), 0);
    const actual = (s.budgetLines || []).reduce((sum, l) => sum + (+l.actual || 0), 0);
    if (planned > 0 && actual > planned) {
      const pct = Math.min(60, Math.round((actual - planned) / planned * 100));
      items.push({
        src: 'Budget',
        title: 'Budget overrun',
        detail: '$' + (actual - planned).toLocaleString() + ' over planned spend',
        impact: Math.round(W.budget * pct),
        reason: pct + '% over planned'
      });
    }

    // 5. Open action items across Comms / Decision Log / meeting promises
    const open = openActionItemCount(s);
    if (open > 0) {
      items.push({
        src: 'Action',
        title: 'Open action items',
        detail: open + ' unresolved action item' + (open !== 1 ? 's' : '') + ' in Comms, Decision Log, or last meeting',
        impact: W.action * Math.min(open, 10),
        reason: open + ' open'
      });
    }

    // 6. Weather-risk days ahead (ACTION-PLAN 7.2) — only when the Forecast
    // module is live AND a cached forecast exists. Thresholds live in
    // mmgr-forecast.js (precip>=60 / heat>=32C / cold<=0C); the engine just
    // surfaces the nearest flagged day. Impact is fixed (12) so a weather
    // signal ranks above routine action items but below a High/High risk.
    if (ns.Forecast && ns.Forecast.riskDays && s.wxCache && s.wxCache.days && s.wxCache.days.length) {
      const wxToday = new Date(); wxToday.setHours(0, 0, 0, 0);
      const wxDays = (ns.Forecast.riskDays(s) || [])
        .filter(d => (U.parseDL(d.date) || new Date(d.date + 'T00:00:00')) >= wxToday);
      if (wxDays.length) {
        const first = wxDays[0];
        items.push({
          src: 'Weather',
          title: 'Weather risk ahead',
          detail: first.date + ' — ' + first.alerts.join(', ') +
            (first.affected.length ? ' (affects ' + first.affected.join(', ') + ')' : ''),
          impact: 12,
          reason: first.alerts.join(', ') + ' on ' + first.date
        });
      }
    }

    return items.sort((a, b) => b.impact - a.impact).slice(0, 8);
  }

  // ---- Render into the Dashboard "Today's Decision" card ----
  // Reuses the Today's-Focus row/badge classes; zero inline styles so the
  // audit's inline-style census stays flat. Idempotent by construction.
  function renderTodayDecisions() {
    const el = document.getElementById('today-decision-body');
    if (!el) return;
    const items = computeTodayDecisions();
    if (!items.length) {
      el.innerHTML = '<div class="es es-ok"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Nothing needs you right now — all tracked signals are clear.</div>';
      return;
    }
    el.innerHTML = items.map(it => {
      const cls = it.impact >= 20 ? 'br' : it.impact >= 10 ? 'ba' : 'bg';
      return '<div class="tf-row"><div><span class="badge ' + cls + '" title="Impact score: ' + U.escapeHtml(it.reason) + '">' + it.impact + '</span> <span class="tf-name">' + U.escapeHtml(it.title) + '</span></div><span class="tf-due">' + U.escapeHtml(it.detail) + '</span></div>';
    }).join('');
  }

  // ---- API ----
  ns.Decisions = {
    compute: computeTodayDecisions,
    render: renderTodayDecisions,
    riskSeverity: riskSeverity
  };
})(MMGR);
window.MMGR = MMGR;
