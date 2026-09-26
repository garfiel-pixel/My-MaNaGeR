/* ============================================================
   My MaNaGeR - Background Assistant (watchers + mailbox)
   ------------------------------------------------------------
   Task 6 (owner directive 2026-09-19): deterministic watchers
   over live state. Every notice's text is derived from real
   fields - traceable, never invented. Notices persist on the
   local machine in s.aiInbox until the user deletes them
   (deleting silences the current occurrence, not the
   condition - a persistent condition resurfaces later, by
   design). Premium gate comes LATER via the Entitlements seam;
   ships ungated. Zero network. Zero-throw.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';
  const U = ns.Utils;

  // Lead-time watchdog: a lead-time task whose Expected date is within 2
  // days (or past) and not delivered. Owner's example: "steel fixing lead
  // time - two days left, signal the PM."
  function watchLeadTimes(s, today) {
    const out = [];
    for (const t of (s.tasks || [])) {
      if (!t.leadTime || !t.expectedDate || t.delivered) continue;
      const d = U.daysBetween(today, t.expectedDate); // negative = overdue
      if (d <= 2) {
        out.push({ kind: 'leadtime', severity: d < 0 ? 'attention' : 'info',
          text: t.name + ' lead time: ' + (d < 0 ? Math.abs(d) + ' day(s) past' : d + ' day(s) left') +
                ' (expected ' + t.expectedDate + '). Check on the vendor.' });
      }
    }
    return out;
  }

  // Budget watchdog: any category running >=10% over planned.
  function watchBudget(s) {
    const out = [];
    const byCat = {};
    for (const b of (s.budgetLines || [])) {
      const cat = b.category || 'Uncategorized';
      if (!byCat[cat]) byCat[cat] = { planned: 0, actual: 0 };
      byCat[cat].planned += (+b.planned || 0);
      byCat[cat].actual += (+b.actual || 0) + (+b.committed || 0);
    }
    for (const cat in byCat) {
      const c = byCat[cat];
      if (c.planned > 0 && c.actual > c.planned * 1.10) {
        out.push({ kind: 'budget', severity: 'attention',
          text: cat + ' is running ' + Math.round((c.actual / c.planned - 1) * 100) + '% over plan (' +
                Math.round(c.actual).toLocaleString() + ' of ' + Math.round(c.planned).toLocaleString() + ').' });
      }
    }
    return out;
  }

  // Resource watchdog: any resource allocated above 100%.
  function watchResources(s) {
    const out = [];
    for (const r of (s.resources || [])) {
      if ((+r.allocation || 0) > 100) {
        out.push({ kind: 'resource', severity: 'info',
          text: r.name + ' is allocated ' + r.allocation + '% - over capacity. Consider rebalancing.' });
      }
    }
    return out;
  }

  // Weather-aware scheduling hint (Task 9): weather-EXPOSED tasks whose
  // window contains a forecast risk day. Reads ONLY the forecast module's
  // cached days through its own riskDays() - same thresholds (precip 60%,
  // heat 32C, cold 0C), same source of truth; this never invents weather.
  // Offline (no/expired cache) it silently returns nothing.
  function watchWeather(s) {
    if (!ns.Forecast || !ns.Forecast.riskDays) return [];
    const risky = ns.Forecast.riskDays(s);
    if (!risky || !risky.length) return [];
    const out = [];
    for (const t of (s.tasks || [])) {
      if (!t.weatherExposed || !t.startDate || !t.endDate) continue;
      for (const d of risky) {
        if (d.date >= t.startDate && d.date <= t.endDate) {
          const why = (d.alerts && d.alerts.length) ? d.alerts.join(', ') : 'weather risk';
          out.push({ kind: 'weather', severity: 'info',
            text: t.name + ' runs ' + t.startDate + ' to ' + t.endDate + ' - forecast flags ' + d.date + ' (' + why + '). Check the window.' });
          break; // one notice per task, not per day
        }
      }
    }
    return out;
  }

  // Schedule-health watcher (owner 2026-09-26): the assistant reads the
  // plan like a consultant and recommends changes - NEVER edits, and never
  // more than one notice per condition (the run() dedup handles repeats).
  // Grounded strictly in stored state: no invention, no model calls.
  function watchSchedule(s) {
    const out = [];
    const tasks = (s.tasks || []).filter(t => t.startDate && t.endDate && !t.isPhase);
    if (tasks.length < 3) return out;
    // 1. Phase gates with zero slack: a failed inspection cascades into the
    // next phase. Gates on the critical path with no float deserve reserve.
    const gates = (s.tasks || []).filter(t => /gate/i.test(t.name || '') && !t.isPhase);
    gates.forEach(g => {
      if (g.critical && (g.totalFloat === 0 || g.totalFloat === null || g.totalFloat === undefined)) {
        out.push({ kind: 'schedule', severity: 'info',
          text: g.name + ' sits on the critical path with no slack. Best practice is 2-3 days of management reserve before a gate so one failed inspection does not cascade into the next phase.' });
      }
    });
    // 2. Long-lead items that finish well before their successor needs them:
    // front-loaded cash with no schedule benefit - stagger the order.
    const byId = new Map((s.tasks || []).map(t => [t.id, t]));
    for (const t of tasks) {
      if (!t.leadTime || !t.expectedDate) continue;
      let minSuccessorStart = null, succName = '';
      for (const c of tasks) {
        if (!(c.predecessors || []).some(p => String(p) === String(t.id))) continue;
        if (minSuccessorStart === null || c.startDate < minSuccessorStart) { minSuccessorStart = c.startDate; succName = c.name; }
      }
      if (!minSuccessorStart) continue;
      const slack = U.daysBetween(t.expectedDate, minSuccessorStart);
      if (slack >= 7) {
        out.push({ kind: 'schedule', severity: 'info',
          text: t.name + ' is expected ' + t.expectedDate + ' but its first successor (' + succName + ') does not start until ' + minSuccessorStart + ' - ' + slack + ' days of idle lead time. Staggering this order frees cash without moving the schedule.' });
      }
    }
    // 3. Weather-sensitive tasks with zero buffer: resequence or add float
    // so one rain day does not land on the critical chain.
    for (const t of tasks) {
      if (!t.weatherSensitive) continue;
      const dur = parseInt(t.duration) || 0;
      if (t.critical && dur >= 3 && !t._schedPad) {
        out.push({ kind: 'schedule', severity: 'info',
          text: t.name + ' is weather-sensitive, critical, and runs ' + dur + ' working days with no buffer. Check the window against the rainy season or resequence it off the chain.' });
      }
    }
    // 4. Early drift: completed/started tasks that ended after their plan
    // (or are running past their end date) - catch slip before it compounds.
    const today = U.todayStr();
    for (const t of tasks) {
      if (t.status === 'completed' && t.completedDate && t.endDate && t.completedDate > t.endDate) {
        out.push({ kind: 'schedule', severity: 'attention',
          text: t.name + ' finished ' + t.completedDate + ' but was planned to finish ' + t.endDate + ' - actual slip already on the record. Check whether its successors absorbed it or inherited it.' });
      } else if (t.status === 'inprogress' && t.endDate && t.endDate < today) {
        out.push({ kind: 'schedule', severity: 'attention',
          text: t.name + ' is still in progress past its ' + t.endDate + ' end date. Update the plan or the end date before the slip cascades.' });
      }
    }
    return out;
  }

  // Signed-in gate (Task 9): the assistant is part of the signed-in
  // experience. Signed-out, run() is a no-op and the mailbox shows the
  // plain-language card. The Entitlements seam is the only rule source.
  function assistantActive() {
    return !!(ns.Entitlements && ns.Entitlements.aiAssistant && ns.Entitlements.aiAssistant());
  }

  // Dedup: a (kind + text) pair already in the inbox (read or unread) is
  // not re-added. Dismissed notices are removed from the array entirely,
  // so a persistent condition resurfaces as a NEW notice later - by design.
  function run() {
    try {
      if (!assistantActive()) { renderBell(); return; }
      const s = ns.State.getState();
      if (!s || !s.tasks) return;
      const today = U.todayStr();
      const found = [].concat(watchLeadTimes(s, today), watchBudget(s), watchResources(s), watchWeather(s), watchSchedule(s));
      if (!found.length) return;
      let added = 0;
      ns.State.updateState(function(st) {
        if (!Array.isArray(st.aiInbox)) st.aiInbox = [];
        const seen = new Set(st.aiInbox.map(n => n.kind + '|' + n.text));
        for (const f of found) {
          if (seen.has(f.kind + '|' + f.text)) continue;
          st.aiInbox.unshift({ id: U.genId('n'), at: new Date().toISOString(),
            kind: f.kind, severity: f.severity, text: f.text, read: false });
          added++;
        }
        st.aiInbox = st.aiInbox.slice(0, 50); // hard cap, newest first
      });
      if (added > 0 && ns.App && ns.App.showToast) {
        ns.App.showToast('Assistant spotted ' + added + ' thing(s) - check the bell.', 'ok');
      }
      renderBell();
    } catch (e) { /* zero-throw: a watcher must never break the app */ }
  }

  function unreadCount() {
    const s = ns.State.getState();
    return (s && Array.isArray(s.aiInbox)) ? s.aiInbox.filter(n => !n.read).length : 0;
  }

  function renderBell() {
    const bell = document.getElementById('ai-bell');
    if (!bell) return;
    const n = unreadCount();
    const dot = bell.querySelector('[data-bell-dot]');
    if (dot) dot.hidden = n === 0;
    bell.setAttribute('aria-label', 'Assistant notices' + (n ? ', ' + n + ' unread' : ''));
  }

  function openMailbox() {
    const box = document.getElementById('ai-mailbox');
    if (!box) return;
    const list = box.querySelector('[data-mailbox-list]');
    // Task 9: locked card for signed-out users - plain language, one route
    // to the existing sign-in sheet. No notices are computed or shown.
    if (!assistantActive()) {
      if (list) list.innerHTML =
        '<div class="ai-note"><div class="ai-note-tx">The background assistant is part of the signed-in experience. Sign in and it starts watching lead times, budget and resources on this project - everything stays on this machine either way.</div>' +
        '<div style="margin-top:6px"><button class="btn btn-g btn-s" data-action="openSignIn">Sign in</button></div></div>';
      renderBell();
      box.classList.add('on');
      return;
    }
    const s = ns.State.getState();
    if (list) {
      const items = (s.aiInbox || []).map(n =>
        '<div class="ai-note' + (n.severity === 'attention' ? ' ai-note-hot' : '') + '">' +
        '<div class="ai-note-tx">' + U.escapeHtml(n.text) + '</div>' +
        '<div class="ai-note-meta">' + U.escapeHtml((n.at || '').slice(0, 10)) + '</div>' +
        '<button class="btn btn-s btn-n" data-action="dismissAiNote" data-id="' + U.escapeHtml(n.id) + '">Dismiss</button>' +
        '</div>').join('') ||
        '<div class="ai-note ai-note-empty">Nothing right now - the assistant pings you here when it spots something.</div>';
      list.innerHTML = items;
    }
    // Opening the mailbox reads everything: unread dot clears.
    ns.State.updateState(function(st) { (st.aiInbox || []).forEach(n => { n.read = true; }); });
    renderBell();
    box.classList.add('on');
  }

  function closeMailbox() {
    const box = document.getElementById('ai-mailbox');
    if (box) box.classList.remove('on');
  }

  function dismissNote(id) {
    ns.State.updateState(function(st) { st.aiInbox = (st.aiInbox || []).filter(n => n.id !== id); });
    openMailbox(); // re-render open panel
  }

  function clearMailbox() {
    ns.State.updateState(function(st) { st.aiInbox = []; });
    openMailbox();
  }

  ns.Watch = { run: run, openMailbox: openMailbox, closeMailbox: closeMailbox,
    dismissNote: dismissNote, clearMailbox: clearMailbox, unreadCount: unreadCount,
    renderBell: renderBell, watchLeadTimes: watchLeadTimes, watchBudget: watchBudget,
    watchResources: watchResources, watchWeather: watchWeather };
})(MMGR);
window.MMGR = MMGR;
