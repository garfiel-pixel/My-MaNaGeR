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

  // Analytics: the numbers first, then the burn-down as recorded points with
  // the gaps named. There is no curve drawn between two endpoints, because a
  // line that invents a Tuesday is a line that will be quoted in a meeting.
  function analyticsBox(s, cycle) {
    const a = ns.Cycles.analytics(s, cycle);
    const b = ns.Cycles.burndown(s, cycle);
    if (!a.ok) {
      return '';
    }
    const bits = [];
    if (a.hasCommitment) {
      bits.push(
        'Committed ' + esc(String(a.committed)) + ' task(s), ' + esc(String(a.committedDays)) + ' d'
      );
      bits.push('now ' + esc(String(a.current)) + ' task(s), ' + esc(String(a.currentDays)) + ' d');
      if (a.added !== null) {
        bits.push(
          'scope +' +
            esc(String(a.added)) +
            ' (' +
            esc(String(a.addedDays)) +
            ' d), -' +
            esc(String(a.removed)) +
            ' (' +
            esc(String(a.removedDays)) +
            ' d)'
        );
      }
    } else {
      bits.push(esc(a.reason));
    }
    if (a.canVelocity) {
      bits.push('velocity ' + esc(String(a.velocityDays)) + ' d');
    }
    if (a.carry) {
      bits.push(
        'carried ' + esc(String(a.carry.tasks)) + ' task(s), ' + esc(String(a.carry.days)) + ' d'
      );
    }
    const rows = b.points
      .map(function (p) {
        return (
          '<tr><td class="t-xs">' +
          esc(p.date) +
          '</td><td class="t-xs">' +
          esc(String(p.remainingDays)) +
          ' d</td></tr>'
        );
      })
      .join('');
    const gaps = b.gaps.length
      ? '<div class="sr-hint">No snapshot on ' +
        b.gaps
          .slice(0, 8)
          .map(function (d) {
            return esc(d);
          })
          .join(', ') +
        (b.gaps.length > 8 ? ' and ' + esc(String(b.gaps.length - 8)) + ' more' : '') +
        '. Those days are gaps, not zero.</div>'
      : '';
    return (
      '<div class="cyc-an" role="region" aria-label="Cycle analytics">' +
      '<div class="cyc-at">' +
      bits.join(' \u00b7 ') +
      '</div>' +
      (b.excluded
        ? '<div class="sr-hint">' +
          esc(String(b.excluded)) +
          ' task(s) have no duration and are counted as zero days.</div>'
        : '') +
      (b.canDraw
        ? '<table class="dt cyc-bt"><thead><tr><th class="w120">Snapshot day</th><th class="w90">Remaining</th></tr></thead><tbody>' +
          rows +
          '</tbody></table>' +
          gaps
        : '<div class="sr-hint">' + esc(b.reason || 'No burn-down is available.') + '</div>') +
      (cycle.close && !cycle.reviewLogged
        ? '<div class="sr"><span class="sl"></span><button class="btn btn-g btn-s" data-action="cycReview" data-id="' +
          esc(cycle.id) +
          '">Write the review to the log</button></div>'
        : '') +
      (cycle.reviewLogged ? '<div class="sr-hint">The review was written to the log.</div>' : '') +
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
    // Cycles are an agile tool and follow the sprint bar's rule; modules are
    // not, so the section itself stays reachable on a waterfall project and
    // only the three cycle cards step aside.
    const agile = (s.methodology || 'waterfall') === 'agile';
    ['cyc-card', 'cyc-detail-card', 'cyc-backlog-card'].forEach(function (id) {
      const el = $(id);
      if (el) {
        el.classList.toggle('is-hide', !agile);
      }
    });
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
          '</tbody></table></div>' +
          analyticsBox(s, sel);
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

  // Modules: the cross-cutting packages. Progress is duration-weighted and
  // only shown when the module has work; an empty module says so rather than
  // showing a confident zero.
  function moduleRow(s, m) {
    const p = ns.Modules.progress(s, m);
    const inModule = {};
    (m.taskIds || []).forEach(function (id) {
      inModule[id] = 1;
    });
    // ok: only the task index and the escaped name reach the markup below
    const list = (s.tasks || [])
      .filter(function (t) {
        return t && t.id && !inModule[t.id];
      })
      .slice(0, 120);
    const idxOf = t => (s.tasks || []).indexOf(t);
    const options = list
      .map(function (t) {
        return (
          '<option value="' +
          esc(String(idxOf(t))) +
          '">' +
          esc(t.name || 'Untitled task') +
          '</option>'
        );
      })
      .join('');
    return (
      '<tr><td>' +
      esc(m.name) +
      '</td><td class="t-xs">' +
      esc(m.lead || '-') +
      '</td><td class="t-xs">' +
      esc(m.target || '-') +
      '</td><td class="t-xs">' +
      (p ? p.tasks + ' task' + (p.tasks === 1 ? '' : 's') + ' · ' + p.days + ' d' : 'No work yet') +
      '</td><td class="t-xs">' +
      (p ? p.pct + '%' + (p.weighted ? ' (by days)' : ' (by tasks)') : '-') +
      '</td><td class="cyc-act"><select class="ctl-in" data-action="modAddTask" data-id="' +
      esc(m.id) +
      '" aria-label="Add a task to ' +
      esc(m.name) +
      '"><option value="">Add task</option>' +
      options +
      '</select> <button class="btn btn-o btn-s" data-action="modClear" data-id="' +
      esc(m.id) +
      '">Clear</button> <button class="btn btn-d btn-s" data-action="modDel" data-id="' +
      esc(m.id) +
      '">&times;</button></td></tr>'
    );
  }

  function renderModules() {
    const host = $('mod-body');
    if (!host) {
      return;
    }
    const s = S();
    if (!s) {
      return;
    }
    const all = ns.Modules.list(s);
    host.innerHTML = all.length
      ? all
          .map(function (m) {
            return moduleRow(s, m);
          })
          .join('')
      : '<tr><td colspan="6"><div class="es es-row">No modules yet. A module groups work by outcome across phases and cycles.</div></td></tr>';
  }

  ns.RenderCycles = { renderCycles: renderCycles, renderModules: renderModules };
})(MMGR);
window.MMGR = MMGR;
