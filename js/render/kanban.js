/* ============================================================
   My MaNaGeR , Kanban Board
   Card markup, board rendering, lead-time lane.
   Extracted from mmgr-render.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State ? ns.State.getState() : null;
  const U = ns.Utils;
  const $ = U.$;

  function kanbanCard(t) {
    const overdue = t.status !== 'completed' && U.isOverdue(t.endDate) ? 'overdue' : '';
    const pulse = U.isDueSoon(t.endDate, 3) && t.status !== 'completed' ? 'pls' : '';
    const lead = t.leadTime ? 'leadtime' : '';
    const rec = t.recurring ? 'recurring' : '';
    const wx = t.weatherExposed ? 'wex' : '';
    const crit = t.critical ? '<svg class="ico" aria-hidden="true" style="color:var(--gold);font-size:.7rem"><use href="css/mmgr-icons.svg#i-target"></use></svg> ' : '';
    return '<div class="kc ' + overdue + ' ' + pulse + ' ' + lead + ' ' + rec + ' ' + wx + '" draggable="true" data-drag-id="' + U.escapeHtml(t.id) + '" data-id="' + U.escapeHtml(t.id) + '">' +
      '<div class="cn">' + crit + U.escapeHtml(t.name) + '</div>' +
      '<div class="cm">' +
        '<span>' + U.escapeHtml(t.assignee || '\u2014') + '</span>' +
        (t.endDate ? '<span>' + U.fmtDateShort(t.endDate) + '</span>' : '') +
        (t.critical ? '<span class="badge bo" style="font-size:.6rem">CP</span>' : '') +
      '</div>' +
    '</div>';
  }

  function kanbanLeadtimeCard(t) {
    const overdue = t.status !== 'completed' && U.isOverdue(t.endDate) ? 'overdue' : '';
    const pulse = U.isDueSoon(t.endDate, 3) && t.status !== 'completed' ? 'pls' : '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = U.parseDL(t.expectedDate);
    const days = exp ? Math.round((exp - today) / 86400000) : null;
    let elapsed = (t.done !== undefined && t.done !== null && t.done !== '') ? t.done + '%' : '\u2014';
    const sub = U.parseDL(t.submittedDate);
    if (sub && exp && exp > sub) {
      const pct = Math.round((today - sub) / (exp - sub) * 100);
      elapsed = Math.max(0, Math.min(100, pct)) + '%';
    }
    const daysSpan = days !== null
      ? '<span class="' + (days <= 5 ? 'lt-card-urgent' : 'lt-card-ok') + '">' + (days < 0 ? 'OVERDUE' : days + 'd left') + '</span>'
      : '';
    return '<div class="kc leadtime ' + overdue + ' ' + pulse + '" draggable="true" data-drag-id="' + U.escapeHtml(t.id) + '" data-id="' + U.escapeHtml(t.id) + '">' +
      '<div class="cn">' + U.escapeHtml(t.name) + '</div>' +
      '<div class="cm">' +
        '<span>ID ' + U.escapeHtml(t.id) + '</span>' +
        (t.expectedDate ? '<span>Expected ' + U.escapeHtml(t.expectedDate) + '</span>' : '') +
        '<span>' + elapsed + ' elapsed</span>' +
        daysSpan +
      '</div>' +
    '</div>';
  }

  function renderKanban() {
    const s = S();
    if (!s || !s.tasks) return;
    const cols = [
      ['todo', 'kc-todo', 'w-todo'],
      ['inprogress', 'kc-ip', 'w-ip'],
      ['blocked', 'kc-bl', 'w-bl'],
      ['completed', 'kc-dn', 'w-dn']
    ];
    const kbShow = !!s.kbShowLeadtime;
    const ltFlagOff = !!(s.flags && s.flags.leadtimeLane === false);
    const ltLane = $('col-leadtime');
    if (ltLane) ltLane.classList.toggle('is-hide', !kbShow || ltFlagOff);
    const ltChip = document.querySelector('[data-action="tglLeadtimeLane"]');
    if (ltChip) ltChip.classList.toggle('is-on', kbShow);
    const noTasksAtAll = s.tasks.length === 0;
    const rollupParents = new Set();
    s.tasks.forEach(t => { if (t.parentName) rollupParents.add(t.parentName); });
    const isWorkItem = t => !t.isPhase && !((t.level || 0) === 0 && rollupParents.has(t.name));
    for (const col of cols) {
      const status = col[0];
      const el = $(col[1]);
      if (!el) continue;
      const tasks = s.tasks.filter(t => (t.status || 'todo') === status && isWorkItem(t));
      const wip = $(col[2]);
      if (wip) wip.textContent = tasks.length;
      if (noTasksAtAll) {
        el.innerHTML = status === 'todo'
          ? '<div class="es" style="padding:24px;font-size:.76rem">No tasks yet \u2014 add your first task to start the board.<div style="margin-top:10px"><button class="btn btn-g btn-s" data-action="showSec" data-section="wbs">+ Add Task</button></div></div>'
          : '';
        continue;
      }
      el.innerHTML = tasks.map(kanbanCard).join('');
    }
    const ltEl = $('kc-lt');
    if (ltEl) {
      const ltTasks = (s.tasks || []).filter(t => t.leadTime && isWorkItem(t));
      const wlt = $('w-lt');
      if (wlt) wlt.textContent = ltTasks.length;
      if (noTasksAtAll) {
        ltEl.innerHTML = '';
      } else if (!ltTasks.length) {
        ltEl.innerHTML = '<div class="es" style="padding:16px;font-size:.72rem">Drag a card here to mark it Lead-Time \u2014 or flip the clock toggle on any WBS row.</div>';
      } else {
        ltEl.innerHTML = ltTasks.map(kanbanLeadtimeCard).join('');
      }
    }
  }

  ns.RenderKanban = {
    kanbanCard: kanbanCard,
    kanbanLeadtimeCard: kanbanLeadtimeCard,
    renderKanban: renderKanban
  };
})(MMGR);
window.MMGR = MMGR;
