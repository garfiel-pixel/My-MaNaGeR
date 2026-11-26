/* ============================================================
   MCP schedule engine (port of js/mmgr-schedule.js)
   ------------------------------------------------------------
   The browser owns the schedule: forwardPass / backwardPass /
   calcFloat / deadlineFor, with the working-day helpers from
   js/mmgr-utils.js. This module is a PURE port of exactly those
   functions so the MCP can answer "what is the plan?" without a
   browser - and so an accepted WBS is not left with null floats
   until a human opens the app.

   Parity contract: `tools/qa-mcp-surface.cjs` loads the REAL
   browser engine into a vm sandbox and asserts every ES/EF/LS/LF/
   float value here matches it for the same fixture. Change one
   side, that harness fails.

   Deliberately absent: weather padding. It needs regional climate
   data the Worker does not carry, so `weather.applied` is false and
   the report says so rather than pretending the pad happened.
   ============================================================ */

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

// js/mmgr-utils.js parseDL - identical accepted shapes and fallbacks.
export function parseDL(str) {
  if (!str) {
    return null;
  }
  const s = String(str);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const parts = s.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split('/').map(Number);
    if (parts[0] > 12) {
      return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    if (parts[1] > 12) {
      return new Date(parts[2], parts[0] - 1, parts[1]);
    }
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  const m = s.match(/^(\d{1,2})-([a-zA-Z]{3})-(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month !== undefined) {
      return new Date(+m[3], month, +m[1]);
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// js/mmgr-utils.js fmtDate - LOCAL date parts, zero padded.
export function fmtDate(d) {
  if (!d) {
    return '';
  }
  const date = typeof d === 'string' ? parseDL(d) : d;
  if (!date || isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return y + '-' + mo + '-' + day;
}

export function daysBetween(a, b) {
  if (!a || !b) {
    return 0;
  }
  const da = typeof a === 'string' ? parseDL(a) : a;
  const db = typeof b === 'string' ? parseDL(b) : b;
  if (!da || !db || isNaN(da.getTime()) || isNaN(db.getTime())) {
    return 0;
  }
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

export function isWorkDay(d, workWeek) {
  const date = typeof d === 'string' ? parseDL(d) : d;
  if (!date || isNaN(date.getTime())) {
    return false;
  }
  const ww = parseInt(workWeek, 10) || 5;
  if (ww >= 7) {
    return true;
  }
  const dow = date.getDay();
  return dow >= 1 && dow <= ww;
}

export function addWorkingDays(d, n, workWeek) {
  const date = typeof d === 'string' ? parseDL(d) : d;
  if (!date || isNaN(date.getTime())) {
    return new Date();
  }
  const ww = parseInt(workWeek, 10) || 5;
  const r = new Date(date);
  r.setHours(0, 0, 0, 0);
  let steps = Math.abs(n);
  const dir = n >= 0 ? 1 : -1;
  while (steps > 0) {
    r.setDate(r.getDate() + dir);
    if (isWorkDay(r, ww)) {
      steps--;
    }
  }
  return r;
}

// Working days STRICTLY between a and b, sign-aware (mirrors Utils).
export function workingDaysBetween(a, b, workWeek) {
  if (!a || !b) {
    return 0;
  }
  const da = typeof a === 'string' ? parseDL(a) : a;
  const db = typeof b === 'string' ? parseDL(b) : b;
  if (!da || !db || isNaN(da.getTime()) || isNaN(db.getTime())) {
    return 0;
  }
  const ww = parseInt(workWeek, 10) || 5;
  const forward = da <= db;
  const lo = forward ? da : db;
  const hi = forward ? db : da;
  let count = 0;
  const cur = new Date(lo);
  cur.setHours(0, 0, 0, 0);
  cur.setDate(cur.getDate() + 1);
  while (cur < hi) {
    if (isWorkDay(cur, ww)) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return forward ? count : -count;
}

export function topologicalSort(tasks) {
  const taskMap = {};
  tasks.forEach(function (t) {
    taskMap[t.id] = t;
  });
  const inDegree = {};
  const adj = {};
  tasks.forEach(function (t) {
    inDegree[t.id] = 0;
    adj[t.id] = [];
  });
  tasks.forEach(function (t) {
    if (t.predecessors && t.predecessors.length) {
      t.predecessors.forEach(function (predId) {
        if (adj[predId]) {
          adj[predId].push(t.id);
          inDegree[t.id] = (inDegree[t.id] || 0) + 1;
        }
      });
    }
  });
  const queue = tasks
    .filter(function (t) {
      return (inDegree[t.id] || 0) === 0;
    })
    .map(function (t) {
      return t.id;
    });
  const sorted = [];
  while (queue.length) {
    const id = queue.shift();
    sorted.push(id);
    (adj[id] || []).forEach(function (succId) {
      inDegree[succId]--;
      if (inDegree[succId] === 0) {
        queue.push(succId);
      }
    });
  }
  return sorted
    .map(function (id) {
      return taskMap[id];
    })
    .filter(Boolean);
}

export function findCycles(tasks) {
  const taskMap = {};
  tasks.forEach(function (t) {
    taskMap[t.id] = t;
  });
  const visited = new Set();
  const path = [];
  const inPath = new Set();
  const cyclic = new Set();
  function visit(id) {
    if (inPath.has(id)) {
      const idx = path.indexOf(id);
      for (let i = idx; i < path.length; i++) {
        cyclic.add(path[i]);
      }
      return;
    }
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    inPath.add(id);
    path.push(id);
    const task = taskMap[id];
    if (task && task.predecessors) {
      task.predecessors.forEach(function (pred) {
        if (taskMap[pred]) {
          visit(pred);
        }
      });
    }
    path.pop();
    inPath.delete(id);
  }
  tasks.forEach(function (t) {
    visit(t.id);
  });
  return Array.from(cyclic);
}

export function forwardPass(tasks, workWeek) {
  const sorted = topologicalSort(tasks);
  const taskMap = {};
  sorted.forEach(function (t) {
    taskMap[t.id] = t;
  });
  let earliestStart = null;
  sorted.forEach(function (t) {
    if (t.startDate && (!earliestStart || t.startDate < earliestStart)) {
      earliestStart = t.startDate;
    }
  });
  const sched = [];
  const schedMap = {};
  sorted.forEach(function (t) {
    const rec = { id: t.id };
    const dur = parseInt(t._padDuration || t.duration, 10) || 1;
    rec.weatherPad = (t._sched && t._sched.weatherPad) || 0;
    rec.paddedDuration = dur;
    if (!t.duration && !t._padDuration) {
      rec.es = null;
      rec.ef = null;
      rec.late = false;
    } else {
      let maxPredEF = null;
      if (t.predecessors && t.predecessors.length) {
        t.predecessors.forEach(function (predId) {
          const ps = schedMap[predId];
          if (ps && ps.ef && (!maxPredEF || ps.ef > maxPredEF)) {
            maxPredEF = ps.ef;
          }
        });
      }
      if (t.parentId) {
        const parent = taskMap[t.parentId];
        if (parent && parent.startDate) {
          const ps = parseDL(parent.startDate);
          if (ps && (!maxPredEF || ps > maxPredEF)) {
            maxPredEF = ps;
          }
        }
      }
      const anchor = t.startDate
        ? parseDL(t.startDate)
        : earliestStart
          ? parseDL(earliestStart)
          : null;
      if (maxPredEF) {
        rec.es = addWorkingDays(maxPredEF, 1, workWeek);
      } else if (anchor) {
        rec.es = anchor;
      } else {
        rec.es = null;
      }
      if (rec.es) {
        rec.ef = addWorkingDays(rec.es, dur - 1, workWeek);
        rec.late = !!(t.endDate && daysBetween(t.endDate, rec.ef) > 0);
      } else {
        rec.ef = null;
        rec.late = false;
      }
    }
    sched.push(rec);
    schedMap[t.id] = rec;
  });
  return sched;
}

export function deadlineFor(tasks, sched, projectDeadline) {
  const dl = parseDL(projectDeadline);
  if (!dl) {
    return null;
  }
  const dlStr = fmtDate(dl);
  const hasSucc = {};
  (tasks || []).forEach(function (t) {
    (t.predecessors || []).forEach(function (p) {
      hasSucc[p] = true;
    });
  });
  let terminalEF = null;
  sched.forEach(function (rec) {
    if (rec.ef && !hasSucc[rec.id] && (!terminalEF || rec.ef > terminalEF)) {
      terminalEF = rec.ef;
    }
  });
  if (terminalEF && dlStr < fmtDate(terminalEF)) {
    return null;
  }
  return dlStr;
}

function toSchedMap(sched) {
  const map = {};
  (sched || []).forEach(function (rec) {
    map[rec.id] = rec;
  });
  return map;
}

function hasSuccessor(tasks, id) {
  for (let i = 0; i < tasks.length; i++) {
    const other = tasks[i];
    if (other.predecessors && other.predecessors.length && other.predecessors.indexOf(id) !== -1) {
      return true;
    }
  }
  return false;
}

export function backwardPass(tasks, sched, deadline, workWeek) {
  const schedMap = toSchedMap(sched);
  let projectEnd = null;
  sched.forEach(function (rec) {
    if (rec.ef && (!projectEnd || rec.ef > projectEnd)) {
      projectEnd = rec.ef;
    }
  });
  if (!projectEnd) {
    return sched;
  }
  const dlDate = deadline ? parseDL(deadline) : null;
  if (dlDate && dlDate > projectEnd) {
    projectEnd = dlDate;
  }
  const ordered = topologicalSort(tasks).reverse();
  ordered.forEach(function (t) {
    const rec = schedMap[t.id];
    if (!rec || !rec.es || !t.duration) {
      return;
    }
    const dur = parseInt(t.duration, 10) || 1;
    let minSuccLS = null;
    tasks.forEach(function (other) {
      if (other.predecessors && other.predecessors.indexOf(t.id) !== -1) {
        const os = schedMap[other.id];
        if (os && os.ls && (!minSuccLS || os.ls < minSuccLS)) {
          minSuccLS = os.ls;
        }
      }
    });
    const lf = minSuccLS
      ? addWorkingDays(minSuccLS, -1, workWeek)
      : dlDate && !hasSuccessor(tasks, t.id) && rec.ef < dlDate
        ? dlDate
        : projectEnd;
    rec.lf = lf;
    rec.ls = addWorkingDays(lf, -(dur - 1), workWeek);
  });
  return sched;
}

function signAwareFloat(ef, lf, workWeek) {
  return ef <= lf ? workingDaysBetween(ef, lf, workWeek) : -workingDaysBetween(lf, ef, workWeek);
}

export function calcFloat(tasks, sched, workWeek) {
  const schedMap = toSchedMap(sched);
  sched.forEach(function (rec) {
    rec.totalFloat = rec.lf && rec.ef ? signAwareFloat(rec.ef, rec.lf, workWeek) : null;
  });
  sched.forEach(function (rec) {
    if (!rec.ef) {
      rec.freeFloat = null;
      return;
    }
    let minSuccES = null;
    tasks.forEach(function (other) {
      if (other.predecessors && other.predecessors.indexOf(rec.id) !== -1) {
        const os = schedMap[other.id];
        if (os && os.es && (!minSuccES || os.es < minSuccES)) {
          minSuccES = os.es;
        }
      }
    });
    rec.freeFloat = minSuccES
      ? workingDaysBetween(rec.ef, minSuccES, workWeek) - 1
      : rec.totalFloat;
  });
  return sched;
}

// One deterministic critical chain: start at the critical terminal with the
// latest EF, then walk back through the predecessor that ends the working day
// before this one starts (ties broken by float, then id). The `criticalTasks`
// array stays the complete zero-float set; this is only the headline path.
function criticalChain(tasks, schedMap, workWeek) {
  const critical = tasks.filter(function (t) {
    const rec = schedMap[t.id];
    return rec && rec.totalFloat !== null && rec.totalFloat <= 0 && !t.isPhase;
  });
  if (!critical.length) {
    return [];
  }
  let end = null;
  critical.forEach(function (t) {
    const rec = schedMap[t.id];
    if (!rec.ef) {
      return;
    }
    if (!end || rec.ef > schedMap[end.id].ef) {
      end = t;
    }
  });
  if (!end) {
    return [];
  }
  const chain = [];
  const seen = Object.create(null);
  let cur = end;
  while (cur && !seen[cur.id]) {
    seen[cur.id] = true;
    chain.push(cur.id);
    const rec = schedMap[cur.id];
    const expected = rec && rec.es ? fmtDate(addWorkingDays(rec.es, -1, workWeek)) : null;
    let next = null;
    (cur.predecessors || []).forEach(function (pid) {
      const cand = tasks.filter(function (t) {
        return t.id === pid;
      })[0];
      const crec = cand && schedMap[cand.id];
      if (!cand || !crec || !crec.ef) {
        return;
      }
      const touches = expected && fmtDate(crec.ef) === expected;
      const score = [touches ? 0 : 1, crec.totalFloat === null ? 99 : crec.totalFloat];
      if (
        !next ||
        score[0] < next.score[0] ||
        (score[0] === next.score[0] && score[1] < next.score[1])
      ) {
        next = { task: cand, score: score };
      }
    });
    cur = next ? next.task : null;
  }
  return chain.reverse();
}

/**
 * Compute the plan for a stored project state. Pure: the caller's state is
 * never mutated (tasks are cloned).
 *
 * @param {object} state  the project state (tasks, workWeek, projectDeadline)
 * @param {object} [opts] { workWeek }
 * @returns {object} the schedule report described in get_schedule
 */
export function computeSchedule(state, opts) {
  const s = state || {};
  const options = opts || {};
  const workWeek = parseInt(options.workWeek || s.workWeek, 10) || 5;
  const live = Array.isArray(s.tasks) ? s.tasks : [];
  const work = live.map(function (t) {
    const c = Object.assign({}, t);
    c.predecessors = Array.isArray(t.predecessors) ? t.predecessors.slice() : [];
    return c;
  });

  const ids = Object.create(null);
  work.forEach(function (t) {
    if (t && t.id != null) {
      ids[String(t.id)] = true;
    }
  });

  let edges = 0;
  let dangling = 0;
  const linked = Object.create(null);
  const hasSucc = Object.create(null);
  work.forEach(function (t) {
    (t.predecessors || []).forEach(function (p) {
      if (!ids[String(p)]) {
        dangling++;
        return;
      }
      edges++;
      linked[String(t.id)] = true;
      hasSucc[String(p)] = true;
    });
  });

  const cycles = findCycles(work);
  let sched = forwardPass(work, workWeek);
  const deadline = deadlineFor(work, sched, s.projectDeadline);
  sched = backwardPass(work, sched, deadline, workWeek);
  sched = calcFloat(work, sched, workWeek);

  const schedMap = toSchedMap(sched);
  // Phase roll-up, exactly as computePlan does it.
  live
    .filter(function (t) {
      return t && t.isPhase;
    })
    .forEach(function (phase) {
      const children = live.filter(function (c) {
        return c.parentName === phase.name || c.parentId === phase.id;
      });
      const childRecs = children
        .map(function (c) {
          return schedMap[c.id];
        })
        .filter(function (r) {
          return r && r.es && r.ef;
        });
      if (!childRecs.length) {
        return;
      }
      let minES = null;
      let maxEF = null;
      childRecs.forEach(function (r) {
        if (!minES || r.es < minES) {
          minES = r.es;
        }
        if (!maxEF || r.ef > maxEF) {
          maxEF = r.ef;
        }
      });
      const rec = schedMap[phase.id] || (schedMap[phase.id] = { id: phase.id });
      rec.es = minES;
      rec.ef = maxEF;
    });

  let projectStart = null;
  let projectEnd = null;
  let noDuration = 0;
  let noDates = 0;
  const rows = live.map(function (t) {
    const rec = schedMap[t.id] || {};
    if (!t.isPhase) {
      if (!t.duration) {
        noDuration++;
      }
      if (!t.startDate && !t.endDate) {
        noDates++;
      }
    }
    if (rec.es && (!projectStart || rec.es < projectStart)) {
      projectStart = rec.es;
    }
    if (rec.ef && (!projectEnd || rec.ef > projectEnd)) {
      projectEnd = rec.ef;
    }
    const critical = rec.totalFloat !== null && rec.totalFloat !== undefined && rec.totalFloat <= 0;
    return {
      id: t.id,
      name: t.name || t.id,
      status: t.status || 'todo',
      isPhase: !!t.isPhase,
      milestone: !!t.milestone,
      duration: t.duration === '' || t.duration == null ? null : t.duration,
      startDate: t.startDate || null,
      endDate: t.endDate || null,
      es: rec.es ? fmtDate(rec.es) : null,
      ef: rec.ef ? fmtDate(rec.ef) : null,
      ls: rec.ls ? fmtDate(rec.ls) : null,
      lf: rec.lf ? fmtDate(rec.lf) : null,
      totalFloat: rec.totalFloat === undefined ? null : rec.totalFloat,
      freeFloat: rec.freeFloat === undefined ? null : rec.freeFloat,
      critical: !!critical,
      late: !!rec.late,
      predecessors: t.predecessors || []
    };
  });

  const criticalTasks = rows
    .filter(function (r) {
      return r.critical && !r.isPhase;
    })
    .map(function (r) {
      return r.id;
    });
  const chain = criticalChain(work, schedMap, workWeek);
  const unlinked = rows.filter(function (r) {
    return !r.isPhase && !linked[String(r.id)] && !hasSucc[String(r.id)];
  });

  const deadlineDate = parseDL(s.projectDeadline);
  const deadlineMissed = !!(
    projectEnd &&
    deadlineDate &&
    fmtDate(projectEnd) > fmtDate(deadlineDate)
  );

  return {
    workWeek: workWeek,
    taskCount: live.length,
    workItemCount: rows.filter(function (r) {
      return !r.isPhase;
    }).length,
    scheduledCount: rows.filter(function (r) {
      return r.ef;
    }).length,
    missingDuration: noDuration,
    missingDates: noDates,
    links: {
      edges: edges,
      linkedTasks: Object.keys(linked).length,
      unlinkedTasks: unlinked.length,
      unlinked: unlinked.map(function (r) {
        return r.id;
      }),
      danglingPredecessors: dangling
    },
    cycles: cycles,
    projectStart: projectStart ? fmtDate(projectStart) : null,
    projectEnd: projectEnd ? fmtDate(projectEnd) : null,
    deadline: s.projectDeadline || null,
    deadlineMissed: deadlineMissed,
    criticalTasks: criticalTasks,
    criticalPath: chain,
    weather: {
      applied: false,
      reason:
        'weather padding needs the regional climate data the app carries; this plan is the relational schedule'
    },
    rows: rows
  };
}
