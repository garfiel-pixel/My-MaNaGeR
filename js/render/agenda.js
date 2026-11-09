/* ============================================================
   My MaNaGeR, merged agenda renderer (Leantime-inspired)
   ------------------------------------------------------------
   Draws MMGR.Agenda.build() as day-grouped sections. Every event is a
   button: a reader with a keyboard gets the same jump the mouse gets.
   The model owns what belongs in the feed; this file owns nothing but
   markup and the window chips.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const U = ns.Utils;
  const $ = U.$;

  function S() {
    return ns.State.getState();
  }

  function windowOf(state) {
    if (state.agendaDays === 7 || state.agendaDays === 0) {
      return state.agendaDays;
    }
    return 30;
  }

  function eventButton(ev) {
    const kind = ns.Agenda.KIND_LABEL[ev.kind] || ev.kind;
    const late = ev.overdue ? ' ag-over' : '';
    return (
      '<button class="ag-ev ag-' +
      ev.kind +
      late +
      '" data-action="agendaJump" data-section="' +
      U.escapeHtml(ev.section) +
      '" data-id="' +
      U.escapeHtml(ev.targetId) +
      '">' +
      '<span class="ag-k">' +
      U.escapeHtml(kind) +
      '</span>' +
      '<span class="ag-t">' +
      U.escapeHtml(ev.title) +
      '</span>' +
      (ev.detail ? '<span class="ag-d">' + U.escapeHtml(ev.detail) + '</span>' : '') +
      (ev.overdue ? '<span class="ag-late">Overdue</span>' : '') +
      '</button>'
    );
  }

  function renderAgenda() {
    const s = S();
    const host = $('agenda-body');
    if (!s || !host) {
      return;
    }
    const days = windowOf(s);
    const events = ns.Agenda.build(s, { days: days });
    const groups = ns.Agenda.group(events);
    const sum = ns.Agenda.summary(s, events, { days: days });

    const sumEl = $('agenda-summary');
    if (sumEl) {
      sumEl.textContent =
        sum.total === 0
          ? 'Nothing dated in this window'
          : sum.total +
            (sum.total === 1 ? ' entry' : ' entries') +
            (sum.overdue ? ', ' + sum.overdue + ' overdue' : '');
    }

    document.querySelectorAll('[data-action="setAgendaDays"]').forEach(function (btn) {
      const on = Number(btn.getAttribute('data-days')) === days;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (!groups.length) {
      host.innerHTML =
        '<div class="es es-row">Nothing is dated in this window. Add a task end date, ' +
        'a meeting, or an idea and it appears here.</div>';
      return;
    }

    host.innerHTML = groups
      .map(function (group) {
        const head =
          '<div class="ag-dh"><span class="ag-dl">' +
          U.escapeHtml(ns.Agenda.dayLabel(group.date, { today: U.todayStr() })) +
          '</span><span class="ag-dc">' +
          group.events.length +
          '</span></div>';
        return (
          '<section class="ag-day" aria-label="' +
          U.escapeHtml(ns.Agenda.dayLabel(group.date, { today: U.todayStr() })) +
          '">' +
          head +
          '<div class="ag-list">' +
          group.events
            .map(function (ev) {
              return eventButton(ev);
            })
            .join('') +
          '</div></section>'
        );
      })
      .join('');
  }

  ns.RenderAgenda = {
    renderAgenda: renderAgenda
  };
})(MMGR);
