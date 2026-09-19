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

  // Dedup: a (kind + text) pair already in the inbox (read or unread) is
  // not re-added. Dismissed notices are removed from the array entirely,
  // so a persistent condition resurfaces as a NEW notice later - by design.
  function run() {
    try {
      const s = ns.State.getState();
      if (!s || !s.tasks) return;
      const today = U.todayStr();
      const found = [].concat(watchLeadTimes(s, today), watchBudget(s), watchResources(s));
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
    const s = ns.State.getState();
    const box = document.getElementById('ai-mailbox');
    if (!box) return;
    const list = box.querySelector('[data-mailbox-list]');
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
    watchResources: watchResources };
})(MMGR);
window.MMGR = MMGR;
