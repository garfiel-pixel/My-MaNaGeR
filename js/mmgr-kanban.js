/* ============================================================
   My MaNaGeR, Kanban board model
   ------------------------------------------------------------
   The board rules live here, once:
     - card membership and order inside a status column
     - WIP limits (0 = unlimited, warnings never block a move)
     - the ephemeral filter set
     - derived swimlanes
     - lead and cycle time

   Every function takes the state object it should read, so this
   file is pure enough to load in Node without a browser. The only
   module-level mutable value is the filter set, which is
   deliberately ephemeral: filters must never become a storage key.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const COLUMNS = ['todo', 'inprogress', 'blocked', 'completed'];
  const LABELS = {
    todo: 'To Do',
    inprogress: 'In Progress',
    blocked: 'Blocked',
    completed: 'Completed'
  };
  const DAY = 86400000;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function todayStr() {
    if (ns.Utils && ns.Utils.todayStr) {
      return ns.Utils.todayStr();
    }
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dayDiff(a, b) {
    if (!a || !b) {
      return null;
    }
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    if (isNaN(da.getTime()) || isNaN(db.getTime())) {
      return null;
    }
    return Math.round((da - db) / DAY);
  }

  function defaultSettings() {
    return {
      wip: { todo: 0, inprogress: 0, blocked: 0, completed: 0 },
      swimlane: 'none'
    };
  }

  function ensureSettings(state) {
    if (!state) {
      return defaultSettings();
    }
    if (!state.kanban || typeof state.kanban !== 'object') {
      state.kanban = defaultSettings();
    }
    if (!state.kanban.wip || typeof state.kanban.wip !== 'object') {
      state.kanban.wip = {};
    }
    COLUMNS.forEach(function (key) {
      const n = parseInt(state.kanban.wip[key], 10);
      state.kanban.wip[key] = n > 0 ? n : 0;
    });
    if (state.kanban.swimlane !== 'assignee' && state.kanban.swimlane !== 'parent') {
      state.kanban.swimlane = 'none';
    }
    return state.kanban;
  }

  function wipLimit(state, status) {
    const wip = state && state.kanban && state.kanban.wip;
    const n = wip ? parseInt(wip[status], 10) : 0;
    return n > 0 ? n : 0;
  }

  // A "card" is a work item. Phases and rollup parents are schedule
  // scaffolding, not work, and the old renderer already excluded them.
  function isWorkItem(task, rollups) {
    if (!task) {
      return false;
    }
    if (task.isPhase) {
      return false;
    }
    return !((task.level || 0) === 0 && rollups && rollups[task.name]);
  }

  function workItems(state) {
    const tasks = (state && state.tasks) || [];
    const rollups = {};
    tasks.forEach(function (t) {
      if (t && t.parentName) {
        rollups[t.parentName] = 1;
      }
    });
    return tasks.filter(function (t) {
      return isWorkItem(t, rollups);
    });
  }

  function positionOf(task) {
    if (task && typeof task.boardPosition === 'number' && isFinite(task.boardPosition)) {
      return task.boardPosition;
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function nextPosition(tasks, status) {
    let max = -1;
    (tasks || []).forEach(function (t) {
      if (!t || (t.status || 'todo') !== status) {
        return;
      }
      const p = positionOf(t);
      if (p !== Number.MAX_SAFE_INTEGER && p > max) {
        max = p;
      }
    });
    return max + 1;
  }

  function normalizePositions(state) {
    const tasks = (state && state.tasks) || [];
    const next = {};
    tasks.forEach(function (t) {
      if (!t) {
        return;
      }
      const st = t.status || 'todo';
      if (typeof t.boardPosition === 'number' && isFinite(t.boardPosition)) {
        next[st] = Math.max(next[st] === undefined ? -1 : next[st], t.boardPosition);
      }
    });
    tasks.forEach(function (t) {
      if (!t) {
        return;
      }
      const st = t.status || 'todo';
      if (typeof t.boardPosition !== 'number' || !isFinite(t.boardPosition)) {
        next[st] = (next[st] === undefined ? -1 : next[st]) + 1;
        t.boardPosition = next[st];
      }
    });
    return state;
  }

  function sortedColumn(state, status) {
    const indexed = [];
    workItems(state).forEach(function (t, i) {
      if ((t.status || 'todo') === status) {
        indexed.push({ t: t, i: i });
      }
    });
    indexed.sort(function (a, b) {
      const pa = positionOf(a.t);
      const pb = positionOf(b.t);
      if (pa !== pb) {
        return pa - pb;
      }
      return a.i - b.i;
    });
    return indexed.map(function (x) {
      return x.t;
    });
  }

  function renumber(tasks, status) {
    tasks
      .filter(function (t) {
        return t && (t.status || 'todo') === status;
      })
      .sort(function (a, b) {
        return positionOf(a) - positionOf(b);
      })
      .forEach(function (t, i) {
        t.boardPosition = i;
      });
  }

  function moveTo(state, id, status, beforeId) {
    if (!state || !Array.isArray(state.tasks) || COLUMNS.indexOf(status) === -1) {
      return { changed: false };
    }
    const task = state.tasks.find(function (t) {
      return t && t.id === id;
    });
    if (!task) {
      return { changed: false };
    }
    const from = task.status || 'todo';
    const original = sortedColumn(state, status);
    const originalIndex = original.findIndex(function (t) {
      return t.id === id;
    });
    const siblings = original.filter(function (t) {
      return t.id !== id;
    });
    let at = siblings.length;
    if (beforeId) {
      const found = siblings.findIndex(function (t) {
        return t.id === beforeId;
      });
      if (found > -1) {
        at = found;
      }
    }
    siblings.splice(at, 0, task);
    siblings.forEach(function (t, i) {
      t.boardPosition = i;
    });
    task.status = status;
    if (from !== status) {
      renumber(state.tasks, from);
    }
    return {
      changed: from !== status || at !== originalIndex,
      from: from,
      to: status,
      index: at
    };
  }

  // Move one slot inside the current column. delta -1 is up, +1 is down.
  // Returns changed:false at the edges so a keyboard handler can stay quiet.
  function moveBy(state, id, delta) {
    if (!state || !Array.isArray(state.tasks)) {
      return { changed: false };
    }
    const task = state.tasks.find(function (t) {
      return t && t.id === id;
    });
    if (!task) {
      return { changed: false };
    }
    const status = task.status || 'todo';
    const column = sortedColumn(state, status);
    const at = column.findIndex(function (t) {
      return t.id === id;
    });
    const target = at + delta;
    if (at < 0 || target < 0 || target >= column.length) {
      return { changed: false };
    }
    column.splice(at, 1);
    column.splice(target, 0, task);
    column.forEach(function (t, i) {
      t.boardPosition = i;
    });
    return { changed: true, from: status, to: status, index: target };
  }

  // Status transitions own their date stamps. One helper, so a drag, a
  // select, a keyboard move, and a WBS edit can never disagree.
  function stampStatus(task, status, today) {
    if (!task) {
      return task;
    }
    const day = today || todayStr();
    task.status = status;
    task.statusSince = day;
    if (status === 'inprogress' && !task.startedDate) {
      task.startedDate = day;
    }
    if (status === 'completed') {
      if (!task.completedDate) {
        task.completedDate = day;
      }
    } else if (task.completedDate) {
      delete task.completedDate;
    }
    return task;
  }

  function wip(state, status) {
    const limit = wipLimit(state, status);
    const count = workItems(state).filter(function (t) {
      return (t.status || 'todo') === status;
    }).length;
    return {
      count: count,
      limit: limit,
      over: limit > 0 && count > limit,
      remaining: limit > 0 ? Math.max(0, limit - count) : null
    };
  }

  // ---- Filters (ephemeral: module memory only, never persisted) ----
  const FILTER_DEFAULTS = { text: '', assignee: '', due: '', flag: '' };
  let filters = { text: '', assignee: '', due: '', flag: '' };

  function getFilters() {
    return {
      text: filters.text,
      assignee: filters.assignee,
      due: filters.due,
      flag: filters.flag
    };
  }

  function setFilters(patch) {
    if (!patch) {
      return getFilters();
    }
    if (patch.text !== undefined) {
      filters.text = String(patch.text);
    }
    if (patch.assignee !== undefined) {
      filters.assignee = String(patch.assignee);
    }
    if (patch.due !== undefined) {
      filters.due = String(patch.due);
    }
    if (patch.flag !== undefined) {
      filters.flag = String(patch.flag);
    }
    return getFilters();
  }

  function clearFilters() {
    filters = { text: '', assignee: '', due: '', flag: '' };
    return getFilters();
  }

  function filtersActive() {
    return !!(filters.text || filters.assignee || filters.due || filters.flag);
  }

  function matchTask(task, f, today) {
    if (!task) {
      return false;
    }
    const set = f || FILTER_DEFAULTS;
    const day = today || todayStr();
    if (set.text) {
      const hay = (
        (task.name || '') +
        ' ' +
        (task.assignee || '') +
        ' ' +
        (task.notes || '') +
        ' ' +
        (task.id || '')
      ).toLowerCase();
      if (hay.indexOf(set.text.toLowerCase()) === -1) {
        return false;
      }
    }
    if (set.assignee && (task.assignee || '') !== set.assignee) {
      return false;
    }
    if (set.flag === 'critical' && !task.critical) {
      return false;
    }
    if (set.flag === 'lead' && !task.leadTime) {
      return false;
    }
    if (set.flag === 'milestone' && !task.milestone) {
      return false;
    }
    if (set.flag === 'recurring' && !task.recurring) {
      return false;
    }
    if (set.due === 'overdue') {
      if (task.status === 'completed' || !task.endDate) {
        return false;
      }
      const d = dayDiff(task.endDate, day);
      if (d === null || d >= 0) {
        return false;
      }
    }
    if (set.due === 'week') {
      const d = dayDiff(task.endDate, day);
      if (d === null || d < 0 || d > 7) {
        return false;
      }
    }
    if (set.due === 'none' && task.endDate) {
      return false;
    }
    return true;
  }

  function columnTasks(state, status, override, today) {
    const set = override || getFilters();
    const day = today || todayStr();
    return sortedColumn(state, status).filter(function (t) {
      return matchTask(t, set, day);
    });
  }

  function counts(state) {
    const out = { todo: 0, inprogress: 0, blocked: 0, completed: 0 };
    workItems(state).forEach(function (t) {
      const st = t.status || 'todo';
      if (out[st] !== undefined) {
        out[st] += 1;
      }
    });
    return out;
  }

  // ---- Derived swimlanes ----
  // A lane is a view over the same cards, never a second copy. `mode` is
  // persisted in state.kanban.swimlane; the grouping itself is derived.
  function laneGroups(tasks, mode) {
    if (!mode || mode === 'none') {
      return [{ key: 'all', label: '', tasks: (tasks || []).slice() }];
    }
    const map = {};
    const order = [];
    (tasks || []).forEach(function (t) {
      const key = mode === 'assignee' ? t.assignee || 'Unassigned' : t.parentName || 'No phase';
      if (!map[key]) {
        map[key] = [];
        order.push(key);
      }
      map[key].push(t);
    });
    order.sort(function (a, b) {
      const aLast = a === 'Unassigned' || a === 'No phase';
      const bLast = b === 'Unassigned' || b === 'No phase';
      if (aLast !== bLast) {
        return aLast ? 1 : -1;
      }
      return a.localeCompare(b);
    });
    return order.map(function (key) {
      return { key: key, label: key, tasks: map[key] };
    });
  }

  // ---- Flow metrics ----
  // Same definitions as Kanboard's TaskAnalyticModel:
  //   lead  = createdDate  -> completedDate
  //   cycle = startedDate  -> completedDate
  // Tasks missing a date are skipped, not guessed, and the sample count is
  // returned so the UI can say what the average is based on.
  function flow(state) {
    const done = workItems(state).filter(function (t) {
      return (t.status || 'todo') === 'completed';
    });
    let lead = 0;
    let leadN = 0;
    let cycle = 0;
    let cycleN = 0;
    done.forEach(function (t) {
      // Only a recorded completion counts. Guessing "today" for a migrated
      // card would quietly inflate the average it is supposed to report.
      const end = t.completedDate || '';
      if (t.createdDate && end) {
        const d = dayDiff(end, t.createdDate);
        if (d !== null) {
          lead += d;
          leadN += 1;
        }
      }
      if (t.startedDate && end) {
        const d = dayDiff(end, t.startedDate);
        if (d !== null) {
          cycle += d;
          cycleN += 1;
        }
      }
    });
    return {
      completed: done.length,
      leadSamples: leadN,
      cycleSamples: cycleN,
      avgLead: leadN ? Math.round(lead / leadN) : null,
      avgCycle: cycleN ? Math.round(cycle / cycleN) : null
    };
  }

  // ---- Quick add ----
  // "Fix door @Sam due:2026-11-01" -> name, assignee, endDate.
  // Everything is optional; an empty or whitespace-only line returns null.
  function parseQuickAdd(text) {
    let raw = String(text == null ? '' : text).trim();
    if (!raw) {
      return null;
    }
    let assignee = '';
    let endDate = '';
    const dueMatch = raw.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/i);
    if (dueMatch) {
      endDate = dueMatch[1];
      raw = raw.replace(dueMatch[0], ' ');
    }
    const whoMatch = raw.match(/(?:^|\s)@([^\s]+)/);
    if (whoMatch) {
      assignee = whoMatch[1];
      raw = raw.replace(whoMatch[0], ' ');
    }
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name) {
      return null;
    }
    return { name: name, assignee: assignee, endDate: endDate };
  }

  ns.Kanban = {
    COLUMNS: COLUMNS,
    LABELS: LABELS,
    defaultSettings: defaultSettings,
    ensureSettings: ensureSettings,
    normalizePositions: normalizePositions,
    isWorkItem: isWorkItem,
    workItems: workItems,
    positionOf: positionOf,
    nextPosition: nextPosition,
    sortedColumn: sortedColumn,
    columnTasks: columnTasks,
    counts: counts,
    wip: wip,
    moveTo: moveTo,
    moveBy: moveBy,
    stampStatus: stampStatus,
    getFilters: getFilters,
    setFilters: setFilters,
    clearFilters: clearFilters,
    filtersActive: filtersActive,
    matchTask: matchTask,
    laneGroups: laneGroups,
    flow: flow,
    parseQuickAdd: parseQuickAdd
  };
})(MMGR);
window.MMGR = MMGR;
