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

  // The commitment records the ids as well as the totals: without them a
  // scope-change number is an opinion. daysById keeps the size each task had
  // at activation, so a later duration edit cannot rewrite history.
  function commitment(state, cycle) {
    const rows = cycle ? tasksOf(state, cycle.id) : [];
    const ids = [];
    const daysById = {};
    rows.forEach(function (t) {
      ids.push(t.id);
      daysById[t.id] = taskDays(t);
    });
    return { at: nowIso(), tasks: rows.length, days: sumDays(rows), ids: ids, daysById: daysById };
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

  // ---- Analytics --------------------------------------------------------
  // Every number here restates a record: the commitment taken at activation,
  // the close record, and the daily snapshots. Nothing is extrapolated, and
  // where the records do not exist the answer says so.
  function snapshotList(state) {
    return state && Array.isArray(state.dailySnapshots) ? state.dailySnapshots : [];
  }

  function dayList(from, to) {
    const out = [];
    if (!from || !to) {
      return out;
    }
    const d = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    if (isNaN(d.getTime()) || isNaN(end.getTime())) {
      return out;
    }
    let guard = 0;
    while (d <= end && guard < 400) {
      const p = n => String(n).padStart(2, '0');
      out.push(d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()));
      d.setDate(d.getDate() + 1);
      guard += 1;
    }
    return out;
  }

  function burndown(state, cycle) {
    const noCommit = {
      points: [],
      gaps: [],
      excluded: 0,
      canDraw: false,
      reason: 'This cycle has no commitment, so there is nothing to burn down.'
    };
    if (!cycle || !cycle.commitment) {
      return noCommit;
    }
    const ids = Array.isArray(cycle.commitment.ids) ? cycle.commitment.ids : [];
    const daysById = cycle.commitment.daysById || {};
    if (!ids.length) {
      return Object.assign({}, noCommit, {
        reason: 'The commitment holds no tasks, so there is nothing to burn down.'
      });
    }
    const snaps = {};
    snapshotList(state).forEach(function (sn) {
      if (sn && sn.date) {
        snaps[String(sn.date).slice(0, 10)] = sn;
      }
    });
    const points = [];
    const gaps = [];
    dayList(cycle.start, cycle.end).forEach(function (dayKey) {
      const sn = snaps[dayKey];
      if (!sn) {
        gaps.push(dayKey);
        return;
      }
      const byId = {};
      (sn.tasks || []).forEach(function (t) {
        if (t && t.id) {
          byId[t.id] = t;
        }
      });
      let remaining = 0;
      ids.forEach(function (id) {
        const row = byId[id];
        if (row && row.completed) {
          return;
        }
        remaining += +daysById[id] || 0;
      });
      points.push({ date: dayKey, remainingDays: remaining });
    });
    const excluded = ids.filter(function (id) {
      return !(+daysById[id] > 0);
    }).length;
    let reason = '';
    if (!points.length) {
      reason = 'No daily snapshot was taken inside this window, so there is no line to draw.';
    } else if (points.length === 1) {
      reason = 'Only one daily snapshot was taken inside this window, so there is no line to draw.';
    }
    return {
      points: points,
      gaps: gaps,
      excluded: excluded,
      canDraw: points.length > 1,
      reason: reason
    };
  }

  function analytics(state, cycle) {
    if (!cycle) {
      return { ok: false, reason: 'Select a cycle.' };
    }
    const c = cycle.commitment;
    const live = tasksOf(state, cycle.id);
    const liveIds = {};
    live.forEach(function (t) {
      liveIds[t.id] = 1;
    });
    const committedIds = c && Array.isArray(c.ids) ? c.ids : null;
    const daysById = (c && c.daysById) || {};
    let added = 0;
    let addedDays = 0;
    let removed = 0;
    let removedDays = 0;
    if (committedIds) {
      live.forEach(function (t) {
        if (committedIds.indexOf(t.id) < 0) {
          added += 1;
          addedDays += taskDays(t);
        }
      });
      committedIds.forEach(function (id) {
        if (!liveIds[id]) {
          removed += 1;
          removedDays += +daysById[id] || 0;
        }
      });
    }
    const closed = stateOf(cycle) === 'closed';
    const close = cycle.close || null;
    return {
      ok: true,
      hasCommitment: !!c,
      committed: c ? c.tasks : null,
      committedDays: c ? c.days : null,
      current: live.length,
      currentDays: sumDays(live),
      added: committedIds ? added : null,
      addedDays: committedIds ? addedDays : null,
      removed: committedIds ? removed : null,
      removedDays: committedIds ? removedDays : null,
      velocityDays: closed && c && close ? close.doneDays : null,
      canVelocity: !!(closed && c && close),
      carry: close ? { tasks: close.carried, days: close.carriedDays } : null,
      reason: closed
        ? c
          ? ''
          : 'This cycle was never activated, so it has no commitment and no velocity.'
        : 'Velocity is reported only for a closed cycle.'
    };
  }

  // The review is generated once, at close, and it is text a person can edit
  // afterwards. Nothing here recomputes: the close record is the source.
  function reviewText(state, cycle) {
    if (!cycle || !cycle.close) {
      return '';
    }
    const a = analytics(state, cycle);
    const k = cycle.close;
    const lines = [];
    lines.push('Cycle review: ' + cycle.name + ' (' + cycle.start + ' to ' + cycle.end + ')');
    lines.push(
      'Committed ' +
        (cycle.commitment
          ? cycle.commitment.tasks + ' task(s), ' + cycle.commitment.days + ' working days'
          : 'nothing') +
        '.'
    );
    lines.push(
      'Finished ' +
        k.done +
        ' task(s), ' +
        k.doneDays +
        ' working days' +
        (a.canVelocity ? ' (velocity ' + a.velocityDays + ' working days).' : '.')
    );
    if (a.added !== null) {
      lines.push(
        'Scope moved: ' +
          a.added +
          ' added (' +
          a.addedDays +
          ' d), ' +
          a.removed +
          ' removed (' +
          a.removedDays +
          ' d).'
      );
    }
    lines.push(
      k.choice === 'forward'
        ? 'Carried forward: ' + k.carried + ' task(s), ' + k.carriedDays + ' working days.'
        : 'Returned to the backlog: ' +
            k.returned +
            ' task(s), ' +
            k.returnedDays +
            ' working days.'
    );
    return lines.join('\n');
  }

  // ---- Modules ----------------------------------------------------------
  // A module groups work by outcome across phases and cycles. It holds task
  // ids, because a package has contents; a task can sit in several modules,
  // which is the point. Membership is validated on every read, so a deleted
  // task cannot leave a phantom.
  const MODULE_STATUSES = ['planned', 'active', 'done'];
  const MODULE_LABEL = { planned: 'Planned', active: 'Active', done: 'Done' };

  function modules(state) {
    return state && Array.isArray(state.modules) ? state.modules : [];
  }

  function findModule(state, id) {
    return (
      modules(state).find(function (m) {
        return m && m.id === id;
      }) || null
    );
  }

  function moduleTasks(state, module) {
    if (!module || !Array.isArray(module.taskIds)) {
      return [];
    }
    const byId = {};
    tasks(state).forEach(function (t) {
      if (t && t.id) {
        byId[t.id] = t;
      }
    });
    return module.taskIds
      .map(function (id) {
        return byId[id];
      })
      .filter(Boolean);
  }

  function moduleProgress(state, module) {
    const rows = moduleTasks(state, module);
    if (!rows.length) {
      return null;
    }
    const days = sumDays(rows);
    const done = rows.filter(function (t) {
      return t.status === 'completed';
    });
    const doneDays = sumDays(done);
    return {
      tasks: rows.length,
      done: done.length,
      days: days,
      doneDays: doneDays,
      pct:
        days > 0
          ? Math.round((doneDays / days) * 100)
          : Math.round((done.length / rows.length) * 100),
      weighted: days > 0
    };
  }

  function newModule(state, opts) {
    const o = opts || {};
    const name = text(o.name).trim();
    if (!name) {
      return { ok: false, message: 'Give the module a name.' };
    }
    if (!Array.isArray(state.modules)) {
      state.modules = [];
    }
    const module = {
      id: 'md' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name,
      lead: text(o.lead, 120),
      target: day(o.target),
      status: 'planned',
      taskIds: []
    };
    state.modules.push(module);
    return { ok: true, id: module.id, module: module };
  }

  function updateModule(state, id, field, value) {
    const module = findModule(state, id);
    if (!module) {
      return { ok: false, message: 'That module no longer exists.' };
    }
    if (field === 'name') {
      const name = text(value).trim();
      if (!name) {
        return { ok: false, message: 'Give the module a name.' };
      }
      module.name = name;
      return { ok: true };
    }
    if (field === 'lead') {
      module.lead = text(value, 120);
      return { ok: true };
    }
    if (field === 'target') {
      module.target = day(value);
      return { ok: true };
    }
    if (field === 'status') {
      if (MODULE_STATUSES.indexOf(value) < 0) {
        return { ok: false, message: 'Unknown module status.' };
      }
      module.status = value;
      return { ok: true };
    }
    return { ok: false, message: 'That field is not open to edit here.' };
  }

  function removeModule(state, id) {
    const module = findModule(state, id);
    if (!module) {
      return { ok: false, message: 'That module no longer exists.' };
    }
    state.modules = modules(state).filter(function (m) {
      return !m || m.id !== id;
    });
    return { ok: true };
  }

  function addTask(state, moduleId, taskIndex) {
    const module = findModule(state, moduleId);
    if (!module) {
      return { ok: false, message: 'That module no longer exists.' };
    }
    const t = tasks(state)[taskIndex];
    if (!t || !t.id) {
      return { ok: false, message: 'That task no longer exists.' };
    }
    if (!Array.isArray(module.taskIds)) {
      module.taskIds = [];
    }
    if (module.taskIds.indexOf(t.id) > -1) {
      return { ok: false, message: 'That task is already in the module.', noop: true };
    }
    module.taskIds.push(t.id);
    return { ok: true };
  }

  function removeTask(state, moduleId, taskId) {
    const module = findModule(state, moduleId);
    if (!module) {
      return { ok: false, message: 'That module no longer exists.' };
    }
    module.taskIds = (module.taskIds || []).filter(function (id) {
      return id !== taskId;
    });
    return { ok: true };
  }

  ns.Modules = {
    MODULE_STATUSES: MODULE_STATUSES,
    MODULE_LABEL: MODULE_LABEL,
    list: modules,
    find: findModule,
    tasks: moduleTasks,
    progress: moduleProgress,
    newModule: newModule,
    updateModule: updateModule,
    removeModule: removeModule,
    addTask: addTask,
    removeTask: removeTask
  };

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
    todayStr: todayStr,
    burndown: burndown,
    analytics: analytics,
    reviewText: reviewText
  };
})(MMGR);
window.MMGR = MMGR;
