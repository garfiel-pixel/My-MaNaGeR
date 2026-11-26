/* ============================================================
   src/domain/task-effects.js - server port of the client's task side effects
   ------------------------------------------------------------
   MCP-FINAL 2026-11-16 F1.2. The browser stamps a task when its status moves
   (js/mmgr-kanban.js stampStatus) and recomputes the start/duration/end triad
   and the phase roll-up on a date edit (js/mmgr-tasks.js updTaskField). An MCP
   accept applies the ops on the server, so without this port an accepted
   status change lands with `status` set but `statusSince`/`completedDate`
   blank and `leadTime` stuck - the R12 defect. This module is a faithful,
   pure port so the server can produce exactly what the client would.

   DATES ARE UTC. The client uses LOCAL calendar dates (new Date(y,m,d) and
   getFullYear/getMonth/getDate); the Worker only has UTC. A status stamped
   near local midnight can therefore be the neighbouring UTC day. The app
   re-stamps on the next real status move, so this is a documented, harmless
   nuance rather than a divergence the owner sees. Working-day math is UTC for
   the same reason (deterministic on the server, no host timezone).
   ============================================================ */

// Today as a UTC YYYY-MM-DD string (the client's todayStr, in UTC).
export function todayStrUTC(now) {
  const d = now instanceof Date ? now : new Date();
  return d.toISOString().slice(0, 10);
}

// Parse a YYYY-MM-DD string to a Date at UTC midnight. Returns null when the
// string is not a plain date (matching the client's "nothing to write").
function parseUTCDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return null;
  }
  const p = s.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return isNaN(d.getTime()) ? null : d;
}

// Format a Date as YYYY-MM-DD in UTC (the client's fmtDate, in UTC).
function fmtUTCDay(d) {
  if (!d || isNaN(d.getTime())) {
    return '';
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// workWeek = days worked per week: 5 -> Mon-Fri, 6 -> Mon-Sat, 7 -> every day.
function isWorkDayUTC(d, workWeek) {
  if (typeof d === 'string') {
    d = parseUTCDay(d);
  }
  if (!d || isNaN(d.getTime())) {
    return false;
  }
  const ww = parseInt(workWeek, 10) || 5;
  if (ww >= 7) {
    return true;
  }
  const dow = d.getUTCDay(); // 0 = Sunday
  return dow >= 1 && dow <= ww;
}

// Advance n WORKING days from d (n may be negative). Skips non-working days.
function addWorkingDaysUTC(d, n, workWeek) {
  if (typeof d === 'string') {
    d = parseUTCDay(d);
  }
  if (!d || isNaN(d.getTime())) {
    return new Date();
  }
  const ww = parseInt(workWeek, 10) || 5;
  const r = new Date(d.getTime());
  let steps = Math.abs(n);
  const dir = n >= 0 ? 1 : -1;
  while (steps > 0) {
    r.setUTCDate(r.getUTCDate() + dir);
    if (isWorkDayUTC(r, ww)) {
      steps--;
    }
  }
  return r;
}

// Working days strictly between a and b (positive when b is after a).
function workingDaysBetweenUTC(a, b, workWeek) {
  if (!a || !b) {
    return 0;
  }
  if (typeof a === 'string') {
    a = parseUTCDay(a);
  }
  if (typeof b === 'string') {
    b = parseUTCDay(b);
  }
  if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) {
    return 0;
  }
  const ww = parseInt(workWeek, 10) || 5;
  const forward = a <= b;
  const lo = forward ? a : b;
  const hi = forward ? b : a;
  let count = 0;
  const cur = new Date(lo.getTime());
  cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur < hi) {
    if (isWorkDayUTC(cur, ww)) {
      count++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return forward ? count : -count;
}

// Inclusive working-day count between two dates (the client's durationFromDates).
function durationFromDatesUTC(start, end, workWeek) {
  if (!start || !end) {
    return null;
  }
  if (start === end) {
    return 1;
  }
  const between = workingDaysBetweenUTC(start, end, workWeek);
  if (between < 0) {
    return null;
  }
  const raw =
    between + (isWorkDayUTC(start, workWeek) ? 1 : 0) + (isWorkDayUTC(end, workWeek) ? 1 : 0);
  return Math.floor(raw + 0.5);
}

// ---- The status stamp (js/mmgr-kanban.js stampStatus) ---------------------
export function stampStatus(task, status, day) {
  if (!task) {
    return task;
  }
  const d = day || todayStrUTC();
  task.status = status;
  task.statusSince = d;
  if (status === 'inprogress' && !task.startedDate) {
    task.startedDate = d;
  }
  if (status === 'completed') {
    if (!task.completedDate) {
      task.completedDate = d;
    }
  } else if (task.completedDate) {
    delete task.completedDate;
  }
  return task;
}

// ---- Parent span + roll-up (js/mmgr-schedule.js phaseSpan / rollupPhases) --
// A parent's dates are a SPAN over its children - earliest start to latest
// end - never the sum of their durations. Both a phase row and a non-phase
// "main task" that children name are parents (schedule scaffolding).
export function phaseSpan(parent, all) {
  const kids = (all || []).filter(
    c =>
      c !== parent &&
      !c.isPhase &&
      c.startDate &&
      c.endDate &&
      (String(c.parentId) === String(parent.id) || c.parentName === parent.name)
  );
  if (!kids.length) {
    return null;
  }
  let start = kids[0].startDate;
  let end = kids[0].endDate;
  kids.forEach(c => {
    if (c.startDate < start) {
      start = c.startDate;
    }
    if (c.endDate > end) {
      end = c.endDate;
    }
  });
  return { start: start, end: end };
}

export function parentKeys(tasks) {
  const ids = Object.create(null);
  const names = Object.create(null);
  (tasks || []).forEach(c => {
    if (!c) {
      return;
    }
    if (c.parentId != null && c.parentId !== '') {
      ids[String(c.parentId)] = true;
    }
    if (c.parentName) {
      names[String(c.parentName)] = true;
    }
  });
  return { ids, names };
}

export function isParentRow(row, keys) {
  if (!row) {
    return false;
  }
  if (row.isPhase) {
    return true;
  }
  return !!(
    (row.id != null && keys.ids[String(row.id)]) ||
    (row.name && keys.names[String(row.name)])
  );
}

export function rollupPhases(tasks, workWeek) {
  const all = tasks || [];
  const keys = parentKeys(all);
  const parents = all.filter(t => isParentRow(t, keys));
  let changed = 0;
  for (let pass = 0; pass < 16; pass++) {
    let passChanged = 0;
    parents.forEach(p => {
      const span = phaseSpan(p, all);
      if (!span) {
        return;
      }
      if (p.startDate !== span.start || p.endDate !== span.end) {
        p.startDate = span.start;
        p.endDate = span.end;
        passChanged++;
      }
      // A phase keeps its stored duration; a main-task roll-up takes its Days
      // cell from the span so it can never show a summed duration.
      if (!p.isPhase) {
        const days = durationFromDatesUTC(span.start, span.end, workWeek);
        if (days != null && String(p.duration) !== String(days)) {
          p.duration = String(days);
          passChanged++;
        }
      }
    });
    changed += passChanged;
    if (!passChanged) {
      break;
    }
  }
  return changed;
}

/* Apply the client side effects to a post-op task list by diffing it against
   the pre-op snapshot:
     - a task whose status changed gets stampStatus + `leadTime = false`
       (exactly the updTaskField status branch);
     - a task whose startDate or duration changed recomputes endDate, and a
       task whose endDate changed recomputes duration (the working-day triad);
     - any date edit rolls the phases up from their children.
   Created tasks (no snapshot entry) are skipped: their stamps come from the
   create/default path, not a status CHANGE. Returns counts for the log. */
export function applyTaskEffects(tasks, beforeTasks, opts) {
  const workWeek = opts && opts.workWeek;
  const today = (opts && opts.today) || todayStrUTC();
  const beforeById = new Map();
  (beforeTasks || []).forEach(t => {
    if (t && t.id != null) {
      beforeById.set(String(t.id), t);
    }
  });
  let statusChanges = 0;
  let dateEdits = 0;
  (tasks || []).forEach(t => {
    if (!t || t.id == null) {
      return;
    }
    const b = beforeById.get(String(t.id));
    if (!b) {
      return; // created in this accept
    }
    const beforeStatus = b.status || 'todo';
    const afterStatus = t.status || 'todo';
    if (beforeStatus !== afterStatus) {
      stampStatus(t, afterStatus, today);
      t.leadTime = false;
      statusChanges++;
    }
    const startChanged = String(b.startDate || '') !== String(t.startDate || '');
    const durChanged = String(b.duration || '') !== String(t.duration || '');
    const endChanged = String(b.endDate || '') !== String(t.endDate || '');
    if (startChanged || durChanged) {
      if (t.startDate && t.duration) {
        const dur = parseInt(t.duration, 10);
        if (!isNaN(dur) && dur >= 1) {
          t.endDate = fmtUTCDay(addWorkingDaysUTC(t.startDate, dur - 1, workWeek));
          dateEdits++;
        }
      }
    } else if (endChanged) {
      const dur = durationFromDatesUTC(t.startDate, t.endDate, workWeek);
      if (dur !== null) {
        t.duration = String(dur);
        dateEdits++;
      } else if (!t.startDate && t.duration && !t.isPhase) {
        const d = parseInt(t.duration, 10);
        if (!isNaN(d) && d >= 1) {
          t.startDate = fmtUTCDay(addWorkingDaysUTC(t.endDate, -(d - 1), workWeek));
          dateEdits++;
        }
      }
    }
  });
  if (dateEdits) {
    rollupPhases(tasks, workWeek);
  }
  return { statusChanges, dateEdits };
}
