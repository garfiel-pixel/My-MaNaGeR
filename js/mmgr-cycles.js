/* ============================================================
   My MaNaGeR, cycle model (Plane-inspired)
   ------------------------------------------------------------
   A cycle is a window with a commitment inside it. It owns no
   tasks: a task points at a cycle through `task.cycleId`, so a
   move is one write and a merge cannot duplicate membership.

   Pure: every function takes the state it reads and writes. No
   DOM, no storage, no timers.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const CYCLE_STATES = ['planned', 'active', 'closed'];
  const CYCLE_LABEL = { planned: 'Planned', active: 'Active', closed: 'Closed' };
  const MAX_NAME = 80;
  const MAX_NOTES = 2000;

  function nowIso() {
    return new Date().toISOString();
  }

  function todayStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function genId() {
    return 'cy' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function text(v, max) {
    return String(v === undefined || v === null ? '' : v).slice(0, max || MAX_NAME);
  }

  function day(v) {
    return String(v || '').slice(0, 10);
  }

  function list(state) {
    return state && Array.isArray(state.cycles) ? state.cycles : [];
  }

  function tasks(state) {
    return state && Array.isArray(state.tasks) ? state.tasks : [];
  }

  function find(state, id) {
    return (
      list(state).find(function (c) {
        return c && c.id === id;
      }) || null
    );
  }

  function stateOf(cycle) {
    const s = cycle && cycle.state;
    return CYCLE_STATES.indexOf(s) > -1 ? s : 'planned';
  }

  function label(cycle) {
    return CYCLE_LABEL[stateOf(cycle)];
  }

  function active(state) {
    return (
      list(state).find(function (c) {
        return stateOf(c) === 'active';
      }) || null
    );
  }

  function planned(state) {
    return list(state)
      .filter(function (c) {
        return stateOf(c) === 'planned';
      })
      .sort(function (a, b) {
        return day(a.start).localeCompare(day(b.start)) || String(a.id).localeCompare(String(b.id));
      });
  }

  // The next cycle a close can carry work into: the earliest cycle that has
  // not closed and starts after this one ends. An active cycle is a valid
  // destination - it is the window the team is running now.
  function nextPlanned(state, cycle) {
    const end = day(cycle && cycle.end);
    const self = cycle ? cycle.id : '';
    return (
      list(state)
        .filter(function (c) {
          return c && c.id !== self && stateOf(c) !== 'closed';
        })
        .filter(function (c) {
          return !end || day(c.start) >= end;
        })
        .sort(function (a, b) {
          return (
            day(a.start).localeCompare(day(b.start)) || String(a.id).localeCompare(String(b.id))
          );
        })[0] || null
    );
  }

  // A task's size in the unit the app already uses: working days. A task with
  // no duration counts as zero days but is still counted as a task, and the
  // callers say so rather than pretending the two are the same.
  function taskDays(task) {
    const n = parseInt((task && task.duration) || '', 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function tasksOf(state, id) {
    return tasks(state).filter(function (t) {
      return t && t.cycleId === id;
    });
  }

  function backlog(state) {
    return tasks(state).filter(function (t) {
      return t && !t.cycleId;
    });
  }

  function sumDays(rows) {
    return rows.reduce(function (n, t) {
      return n + taskDays(t);
    }, 0);
  }

  function commitment(state, cycle) {
    const rows = cycle ? tasksOf(state, cycle.id) : [];
    return { at: nowIso(), tasks: rows.length, days: sumDays(rows) };
  }

  // ---- writes -----------------------------------------------------------

  function newCycle(state, opts) {
    const o = opts || {};
    const name = text(o.name).trim();
    const start = day(o.start);
    const end = day(o.end);
    if (!name) {
      return { ok: false, message: 'Give the cycle a name.' };
    }
    if (!start || !end) {
      return { ok: false, message: 'A cycle needs a start and an end date.' };
    }
    if (end < start) {
      return { ok: false, message: 'The end date cannot be before the start date.' };
    }
    if (!Array.isArray(state.cycles)) {
      state.cycles = [];
    }
    const cycle = {
      id: genId(),
      name: name,
      start: start,
      end: end,
      state: 'planned',
      notes: text(o.notes, MAX_NOTES),
      commitment: null,
      close: null
    };
    state.cycles.push(cycle);
    return { ok: true, id: cycle.id, cycle: cycle };
  }

  // A closed cycle is history: its dates and membership stay still. Its name
  // and notes are still a person's words about it and stay editable.
  function updateCycle(state, id, field, value) {
    const cycle = find(state, id);
    if (!cycle) {
      return { ok: false, message: 'That cycle no longer exists.' };
    }
    const closed = stateOf(cycle) === 'closed';
    if (field === 'name') {
      const name = text(value).trim();
      if (!name) {
        return { ok: false, message: 'Give the cycle a name.' };
      }
      cycle.name = name;
      return { ok: true };
    }
    if (field === 'notes') {
      cycle.notes = text(value, MAX_NOTES);
      return { ok: true };
    }
    if (field === 'start' || field === 'end') {
      if (closed) {
        return { ok: false, message: 'A closed cycle keeps its dates.' };
      }
      const v = day(value);
      const start = field === 'start' ? v : day(cycle.start);
      const end = field === 'end' ? v : day(cycle.end);
      if (!start || !end) {
        return { ok: false, message: 'A cycle needs a start and an end date.' };
      }
      if (end < start) {
        return { ok: false, message: 'The end date cannot be before the start date.' };
      }
      cycle[field] = v;
      return { ok: true };
    }
    return { ok: false, message: 'That field is not open to edit here.' };
  }

  function removeCycle(state, id) {
    const cycle = find(state, id);
    if (!cycle) {
      return { ok: false, message: 'That cycle no longer exists.' };
    }
    if (stateOf(cycle) === 'active') {
      return { ok: false, message: 'Close the active cycle before deleting it.' };
    }
    const held = tasksOf(state, id);
    if (held.length) {
      return {
        ok: false,
        message:
          'That cycle holds ' +
          held.length +
          ' task' +
          (held.length === 1 ? '' : 's') +
          '. Move them out first.'
      };
    }
    state.cycles = list(state).filter(function (c) {
      return !c || c.id !== id;
    });
    return { ok: true };
  }

  // Activation is the moment the commitment is taken, and the previous active
  // cycle is deactivated in the SAME write: no render can catch two.
  function activate(state, id) {
    const cycle = find(state, id);
    if (!cycle) {
      return { ok: false, message: 'That cycle no longer exists.' };
    }
    if (stateOf(cycle) === 'closed') {
      return { ok: false, message: 'A closed cycle cannot be reopened.' };
    }
    if (stateOf(cycle) === 'active') {
      return { ok: false, message: 'That cycle is already active.', noop: true };
    }
    list(state).forEach(function (c) {
      if (c && stateOf(c) === 'active') {
        c.state = 'planned';
      }
    });
    cycle.state = 'active';
    cycle.commitment = commitment(state, cycle);
    return { ok: true, cycle: cycle, commitment: cycle.commitment };
  }

  // What closing would do, without doing it. The UI shows these numbers before
  // asking the question.
  function closePlan(state, id) {
    const cycle = find(state, id);
    if (!cycle) {
      return { ok: false, message: 'That cycle no longer exists.' };
    }
    if (stateOf(cycle) === 'closed') {
      return { ok: false, message: 'That cycle is already closed.' };
    }
    const rows = tasksOf(state, id);
    const open = rows.filter(function (t) {
      return t.status !== 'completed';
    });
    const unstated = rows.filter(function (t) {
      return !t.status;
    });
    return {
      ok: true,
      total: rows.length,
      done: rows.length - open.length,
      open: open.length,
      openDays: sumDays(open),
      unstated: unstated.length,
      next: nextPlanned(state, cycle) ? nextPlanned(state, cycle).id : '',
      canForward: !!nextPlanned(state, cycle)
    };
  }

  // Closing is a decision. `choice` is 'forward' (the next planned cycle takes
  // the unfinished work) or 'backlog' (it loses its cycle). There is no third
  // answer and no silent default.
  function close(state, id, choice) {
    const cycle = find(state, id);
    if (!cycle) {
      return { ok: false, message: 'That cycle no longer exists.' };
    }
    if (stateOf(cycle) === 'closed') {
      return { ok: false, message: 'That cycle is already closed.' };
    }
    const plan = closePlan(state, id);
    if (!plan.ok) {
      return plan;
    }
    if (plan.unstated) {
      return {
        ok: false,
        message:
          plan.unstated +
          ' task' +
          (plan.unstated === 1 ? ' has' : 's have') +
          ' no status. Set one before closing.'
      };
    }
    const pick = choice === 'forward' || choice === 'backlog' ? choice : '';
    if (!pick) {
      return { ok: false, message: 'Choose what happens to the unfinished work.' };
    }
    let target = null;
    if (pick === 'forward') {
      target = nextPlanned(state, cycle);
      if (!target) {
        return {
          ok: false,
          message: 'There is no planned cycle to carry into. Choose the backlog instead.'
        };
      }
    }
    const rows = tasksOf(state, id);
    let carried = 0;
    let carriedDays = 0;
    let returned = 0;
    let returnedDays = 0;
    rows.forEach(function (t) {
      if (t.status === 'completed') {
        return;
      }
      if (target) {
        t.cycleId = target.id;
        carried += 1;
        carriedDays += taskDays(t);
      } else {
        t.cycleId = '';
        returned += 1;
        returnedDays += taskDays(t);
      }
    });
    const doneRows = rows.filter(function (t) {
      return t.status === 'completed';
    });
    cycle.state = 'closed';
    cycle.close = {
      at: nowIso(),
      choice: pick,
      to: target ? target.id : '',
      carried: carried,
      carriedDays: carriedDays,
      returned: returned,
      returnedDays: returnedDays,
      done: doneRows.length,
      doneDays: sumDays(doneRows),
      tasks: rows.length,
      days: sumDays(rows)
    };
    return { ok: true, cycle: cycle, close: cycle.close, to: target ? target.id : '' };
  }

  // Membership. A closed cycle is history and cannot gain or lose a task; a
  // planned or active one can.
  function assign(state, taskIndex, cycleId) {
    const t = tasks(state)[taskIndex];
    if (!t) {
      return { ok: false, message: 'That task no longer exists.' };
    }
    const target = cycleId ? find(state, cycleId) : null;
    if (cycleId && !target) {
      return { ok: false, message: 'That cycle no longer exists.' };
    }
    if (target && stateOf(target) === 'closed') {
      return { ok: false, message: 'A closed cycle keeps its membership.' };
    }
    if (t.cycleId && t.cycleId !== (target ? target.id : '')) {
      const from = find(state, t.cycleId);
      if (from && stateOf(from) === 'closed') {
        return { ok: false, message: 'A closed cycle keeps its membership.' };
      }
    }
    t.cycleId = target ? target.id : '';
    return { ok: true, cycleId: t.cycleId };
  }

  // ---- the sprint fallback ---------------------------------------------
  // The old singleton sprint is converted into the first cycle by the
  // migration. This reads it only to seed that conversion.
  function fromSprint(state) {
    const sp = state && state.sprint;
    if (!sp || !day(sp.start) || !day(sp.end)) {
      return null;
    }
    return {
      name: text(sp.name || 'Sprint 1').trim() || 'Sprint 1',
      start: day(sp.start),
      end: day(sp.end)
    };
  }

  ns.Cycles = {
    CYCLE_STATES: CYCLE_STATES,
    CYCLE_LABEL: CYCLE_LABEL,
    list: list,
    find: find,
    stateOf: stateOf,
    label: label,
    active: active,
    planned: planned,
    nextPlanned: nextPlanned,
    taskDays: taskDays,
    tasksOf: tasksOf,
    backlog: backlog,
    sumDays: sumDays,
    newCycle: newCycle,
    updateCycle: updateCycle,
    removeCycle: removeCycle,
    activate: activate,
    closePlan: closePlan,
    close: close,
    assign: assign,
    fromSprint: fromSprint,
    todayStr: todayStr
  };
})(MMGR);
window.MMGR = MMGR;
