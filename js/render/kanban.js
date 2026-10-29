/* ============================================================
 My MaNaGeR, Kanban Board
 Card markup, board rendering, lead-time lane.
 Extracted from mmgr-render.js.
 ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const S = () => (ns.State ? ns.State.getState() : null);
  const U = ns.Utils;
  const $ = U.$;

  // Load-order guard: the model must exist before any board render.
  function boardModel() {
    if (!ns.Kanban) {
      throw new Error('mmgr-kanban.js must load before js/render/kanban.js');
    }
    return ns.Kanban;
  }

  function kanbanCard(t) {
    const overdue = t.status !== 'completed' && U.isOverdue(t.endDate) ? 'overdue' : '';
    const pulse = U.isDueSoon(t.endDate, 3) && t.status !== 'completed' ? 'pls' : '';
    const lead = t.leadTime ? 'leadtime' : '';
    const rec = t.recurring ? 'recurring' : '';
    const wx = t.weatherExposed ? 'wex' : '';
    const crit = t.critical
      ? '<svg class="ico" aria-hidden="true" style="color:var(--gold);font-size:.7rem"><use href="css/mmgr-icons.svg#i-target"></use></svg> '
      : '';
    return (
      '<div class="kc ' +
      overdue +
      ' ' +
      pulse +
      ' ' +
      lead +
      ' ' +
      rec +
      ' ' +
      wx +
      '" draggable="true" tabindex="0" role="button" aria-label="' +
      U.escapeHtml(t.name + ', ' + (t.status || 'todo')) +
      '" data-drag-id="' +
      U.escapeHtml(t.id) +
      '" data-id="' +
      U.escapeHtml(t.id) +
      '">' +
      '<div class="cn">' +
      crit +
      U.escapeHtml(t.name) +
      '</div>' +
      '<div class="cm">' +
      '<span>' +
      U.escapeHtml(t.assignee || '-') +
      '</span>' +
      (t.endDate ? '<span>' + U.escapeHtml(U.fmtDateShort(t.endDate)) + '</span>' : '') +
      (t.critical ? '<span class="badge bo" style="font-size:.6rem">CP</span>' : '') +
      '</div>' +
      '</div>'
    );
  }

  function kanbanLeadtimeCard(t) {
    const overdue = t.status !== 'completed' && U.isOverdue(t.endDate) ? 'overdue' : '';
    const pulse = U.isDueSoon(t.endDate, 3) && t.status !== 'completed' ? 'pls' : '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = U.parseDL(t.expectedDate);
    const days = exp ? Math.round((exp - today) / 86400000) : null;
    let elapsed = t.done !== undefined && t.done !== null && t.done !== '' ? t.done + '%' : '-';
    const sub = U.parseDL(t.submittedDate);
    if (sub && exp && exp > sub) {
      const pct = Math.round(((today - sub) / (exp - sub)) * 100);
      elapsed = Math.max(0, Math.min(100, pct)) + '%';
    }
    const daysSpan =
      days !== null
        ? '<span class="' +
          (days <= 5 ? 'lt-card-urgent' : 'lt-card-ok') +
          '">' +
          (days < 0 ? 'OVERDUE' : days + 'd left') +
          '</span>'
        : '';
    return (
      '<div class="kc leadtime ' +
      overdue +
      ' ' +
      pulse +
      '" draggable="true" tabindex="0" role="button" aria-label="' +
      U.escapeHtml(t.name + ', lead time') +
      '" data-drag-id="' +
      U.escapeHtml(t.id) +
      '" data-id="' +
      U.escapeHtml(t.id) +
      '">' +
      '<div class="cn">' +
      U.escapeHtml(t.name) +
      '</div>' +
      '<div class="cm">' +
      '<span>ID ' +
      U.escapeHtml(t.id) +
      '</span>' +
      (t.expectedDate ? '<span>Expected ' + U.escapeHtml(t.expectedDate) + '</span>' : '') +
      '<span>' +
      elapsed +
      ' elapsed</span>' +
      daysSpan +
      '</div>' +
      '</div>'
    );
  }

  function renderKanban() {
    const s = S();
    if (!s || !s.tasks) {
      return;
    }
    const cols = [
      ['todo', 'kc-todo', 'w-todo', 'col-todo'],
      ['inprogress', 'kc-ip', 'w-ip', 'col-ip'],
      ['blocked', 'kc-bl', 'w-bl', 'col-bl'],
      ['completed', 'kc-dn', 'w-dn', 'col-dn']
    ];
    const kbShow = !!s.kbShowLeadtime;
    const ltFlagOff = !!(s.flags && s.flags.leadtimeLane === false);
    const ltLane = $('col-leadtime');
    if (ltLane) {
      ltLane.classList.toggle('is-hide', !kbShow || ltFlagOff);
    }
    const ltChip = document.querySelector('[data-action="tglLeadtimeLane"]');
    if (ltChip) {
      ltChip.classList.toggle('is-on', kbShow);
    }
    const K = boardModel();
    const noTasksAtAll = K.workItems(s).length === 0;
    function quickAddMarkup(colStatus) {
      return (
        '<div class="kqa">' +
        '<button type="button" class="kqa-add" data-action="kbQuickAdd" data-status="' +
        colStatus +
        '">+ Add card</button>' +
        '<input class="kqa-in is-hide" type="text" maxlength="140" autocomplete="off" ' +
        'data-status="' +
        colStatus + // ok: colStatus is one of the four fixed column keys from the cols table
        '" placeholder="Name @who due:2026-11-01" aria-label="New card name for ' +
        U.escapeHtml(K.LABELS[colStatus]) +
        '">' +
        '</div>'
      );
    }
    for (const col of cols) {
      const status = col[0];
      const el = $(col[1]);
      if (!el) {
        continue;
      }
      // Order and filtering are model concerns. The renderer only draws.
      const tasks = K.columnTasks(s, status);
      const info = K.wip(s, status);
      const wip = $(col[2]);
      if (wip) {
        wip.textContent = info.limit ? info.count + ' / ' + info.limit : String(info.count);
        wip.classList.toggle('over', info.over);
        wip.setAttribute(
          'title',
          info.limit ? info.count + ' cards, limit ' + info.limit : info.count + ' cards, no limit'
        );
      }
      const colEl = $(col[3]);
      if (colEl) {
        colEl.classList.toggle('kcol-over', info.over);
        const visible = tasks.length !== info.count ? ', ' + tasks.length + ' shown by filter' : '';
        colEl.setAttribute(
          'aria-label',
          K.LABELS[status] +
            ', ' +
            info.count +
            (info.limit ? ' of ' + info.limit + ' planned' : ' cards') +
            visible
        );
      }
      if (noTasksAtAll) {
        el.innerHTML =
          status === 'todo'
            ? '<div class="es" style="padding:24px;font-size:.76rem">No tasks yet - add your first task to start the board.<div style="margin-top:10px"><button class="btn btn-g btn-s" data-action="showSec" data-section="wbs">+ Add Task</button></div></div>'
            : '';
        continue;
      }
      el.innerHTML = tasks.map(kanbanCard).join('') + quickAddMarkup(status);
    }
    const ltEl = $('kc-lt');
    if (ltEl) {
      const ltTasks = K.workItems(s)
        .filter(t => t.leadTime)
        .sort((a, b) => K.positionOf(a) - K.positionOf(b));
      const wlt = $('w-lt');
      if (wlt) {
        wlt.textContent = ltTasks.length;
      }
      if (noTasksAtAll) {
        ltEl.innerHTML = '';
      } else if (!ltTasks.length) {
        ltEl.innerHTML =
          '<div class="es" style="padding:16px;font-size:.72rem">Drag a card here to mark it Lead-Time - or flip the clock toggle on any WBS row.</div>';
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
