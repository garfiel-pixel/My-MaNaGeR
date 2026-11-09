/* ============================================================
   My MaNaGeR, cycles renderer (Plane-inspired)
   ------------------------------------------------------------
   The Planning section: the cycle table, the selected cycle's
   work, and the backlog that can be pulled into it. Markup only;
   the model judges and the App handlers write.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const S = () => (ns.State ? ns.State.getState() : null);
  const U = ns.Utils;
  const $ = U.$;
  const esc = U.escapeHtml;

  const STATUS_LABEL = {
    todo: 'To do',
    inprogress: 'In progress',
    blocked: 'Blocked',
    completed: 'Completed',
    leadtime: 'Lead time'
  };

  function cycleRow(c, sel) {
    const rows = ns.Cycles.tasksOf(S(), c.id);
    const done = rows.filter(function (t) {
      return t.status === 'completed';
    }).length;
    const st = ns.Cycles.stateOf(c);
    return (
      '<tr class="' +
      (sel ? 'is-sel' : '') +
      '"><td><button class="lnk" data-action="cycSelect" data-id="' +
      esc(c.id) +
      '">' +
      esc(c.name) +
      '</button></td>' +
      '<td class="t-xs">' +
      esc(c.start || '-') +
      ' \u2192 ' +
      esc(c.end || '-') +
      '</td>' +
      '<td><span class="cyc-badge is-' +
      st +
      '">' +
      esc(ns.Cycles.CYCLE_LABEL[st]) +
      '</span></td>' +
      '<td class="t-xs">' +
      rows.length +
      ' \u00b7 ' +
      done +
      ' done</td>' +
      '<td class="t-xs">' +
      ns.Cycles.sumDays(rows) +
      ' d</td>' +
      '<td class="cyc-act">' +
      (st === 'planned'
        ? '<button class="btn btn-g btn-s" data-action="cycActivate" data-id="' +
          esc(c.id) +
          '">Activate</button>'
        : '') +
      (st === 'closed'
        ? ''
        : '<button class="btn btn-o btn-s" data-action="cycClose" data-id="' +
          esc(c.id) +
          '">Close</button>') +
      (st === 'active'
        ? ''
        : '<button class="btn btn-d btn-s" data-action="cycDel" data-id="' +
          esc(c.id) +
          '">Delete</button>') +
      '</td></tr>'
    );
  }

  function taskRow(t, i, canRemove) {
    return (
      '<tr><td>' +
      esc(t.name || 'Untitled task') +
      '</td><td class="t-xs">' +
      esc(STATUS_LABEL[t.status] || t.status || '-') +
      '</td><td class="t-xs">' +
      ns.Cycles.taskDays(t) +
      ' d</td>' +
      (canRemove
        ? '<td><button class="btn btn-d btn-s" data-action="cycUnassign" data-idx="' +
          i +
          '" title="Return this task to the backlog">Remove</button></td>'
        : '<td></td>') +
      '</tr>'
    );
  }

  // Closing is a decision, so it is asked as one: the numbers first, then two
  // answers and a way out. The choice lives in state.cycClosing (a view
  // preference) so a re-render cannot lose the question.
  function closeBox(s, cycle) {
    const plan = ns.Cycles.closePlan(s, cycle.id);
    if (!plan.ok) {
      return '<div class="es es-row">' + esc(plan.message) + '</div>';
    }
    const next = plan.next ? ns.Cycles.find(s, plan.next) : null;
    return (
      '<div class="cyc-close" role="group" aria-label="Close cycle">' +
      '<div class="cyc-ct">Close ' +
      esc(cycle.name) +
      '</div>' +
      '<div class="sr-hint">' +
      plan.done +
      ' done, ' +
      plan.open +
      ' unfinished (' +
      plan.openDays +
      ' working days).' +
      (plan.unstated ? ' ' + plan.unstated + ' task(s) have no status.' : '') +
      '</div>' +
      (plan.canForward
        ? '<button class="btn btn-g btn-s" data-action="cycCloseForward" data-id="' +
          esc(cycle.id) +
          '">Carry into ' +
          esc(next ? next.name : 'the next cycle') +
          '</button>'
        : '<div class="sr-hint">There is no planned cycle to carry into, so the backlog is the only answer.</div>') +
      '<button class="btn btn-n btn-s" data-action="cycCloseBacklog" data-id="' +
      esc(cycle.id) +
      '">Return to the backlog</button>' +
      '<button class="btn btn-o btn-s" data-action="cycCloseCancel">Cancel</button>' +
      '</div>'
    );
  }

  function renderCycles() {
    const host = $('cyc-body');
    if (!host) {
      return;
    }
    const s = S();
    if (!s) {
      return;
    }
    const all = ns.Cycles.list(s);
    const sel = ns.Cycles.find(s, s.cycSel) || ns.Cycles.active(s) || all[0] || null;
    host.innerHTML = all.length
      ? all
          .slice()
          .sort(function (a, b) {
            return (
              String(a.start).localeCompare(String(b.start)) ||
              String(a.id).localeCompare(String(b.id))
            );
          })
          .map(function (c) {
            return cycleRow(c, sel && sel.id === c.id);
          })
          .join('')
      : '<tr><td colspan="6"><div class="es es-row">No cycles yet. A cycle is a window with a commitment inside it.</div></td></tr>';

    const pick = $('cyc-pick');
    if (pick) {
      const open = all.filter(function (c) {
        return ns.Cycles.stateOf(c) !== 'closed';
      });
      pick.innerHTML = open.length
        ? '<option value="">Choose a cycle</option>' +
          open
            .map(function (c) {
              return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
            })
            .join('')
        : '<option value="">No open cycle</option>';
    }

    const detail = $('cyc-detail');
    if (detail) {
      if (!sel) {
        detail.innerHTML = '<div class="es es-row">Select a cycle to see the work inside it.</div>';
      } else {
        const rows = ns.Cycles.tasksOf(s, sel.id);
        const closed = ns.Cycles.stateOf(sel) === 'closed';
        const idxOf = t => s.tasks.indexOf(t);
        detail.innerHTML =
          '<div class="cyc-dh"><span class="cyc-dn">' +
          esc(sel.name) +
          '</span><span class="cyc-badge is-' +
          esc(ns.Cycles.stateOf(sel)) +
          '">' +
          esc(ns.Cycles.label(sel)) +
          '</span></div>' +
          (s.cycClosing === sel.id ? closeBox(s, sel) : '') +
          (sel.commitment
            ? '<div class="sr-hint">Committed at activation: ' +
              esc(String(sel.commitment.tasks)) +
              ' task' +
              (sel.commitment.tasks === 1 ? '' : 's') +
              ', ' +
              esc(String(sel.commitment.days)) +
              ' working days.</div>'
            : '') +
          (sel.close
            ? '<div class="sr-hint">Closed ' +
              esc(String(sel.close.at).slice(0, 10)) +
              ': ' +
              esc(String(sel.close.done)) +
              ' done, ' +
              esc(String(sel.close.carried)) +
              ' carried forward, ' +
              esc(String(sel.close.returned)) +
              ' returned to the backlog.</div>'
            : '') +
          '<div class="ox"><table class="dt"><thead><tr><th>Task</th><th class="w110">Status</th><th class="w70">Days</th><th class="w90"></th></tr></thead><tbody>' +
          (rows.length
            ? rows
                .map(function (t) {
                  return taskRow(t, idxOf(t), !closed);
                })
                .join('')
            : '<tr><td colspan="4"><div class="es es-row">Nothing is committed to this cycle yet.</div></td></tr>') +
          '</tbody></table></div>';
      }
    }

    const back = $('cyc-backlog');
    if (back) {
      const rows = ns.Cycles.backlog(s);
      back.innerHTML = rows.length
        ? rows
            .map(function (t) {
              return (
                '<div class="cyc-bl"><span class="cyc-bt">' +
                esc(t.name || 'Untitled task') +
                '</span><span class="t-xs">' +
                esc(STATUS_LABEL[t.status] || t.status || '-') +
                ' \u00b7 ' +
                esc(String(ns.Cycles.taskDays(t))) +
                ' d</span>' +
                '<button class="btn btn-n btn-s" data-action="cycAssign" data-idx="' +
                esc(String(s.tasks.indexOf(t))) +
                '">Add to cycle</button></div>'
              );
            })
            .join('')
        : '<div class="es es-row">Every task is in a cycle.</div>';
    }
  }

  ns.RenderCycles = { renderCycles: renderCycles };
})(MMGR);
window.MMGR = MMGR;
