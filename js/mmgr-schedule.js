/* ============================================================
   My MaNaGeR , Schedule Engine Module
   Topological-sorted forward/backward pass, float calculation,
   critical path, selective weather padding, resource conflicts.

   PURITY CONTRACT (Phase A):
   topologicalSort / forwardPass / backwardPass / calcFloat are
   PURE: they accept a task array, read only, and return a new
   array of _sched records ({ id, es, ef, lf, ls, totalFloat,
   freeFloat, ... }). They NEVER touch a live task's fields.

   The ONLY place schedule data is written back onto live tasks
   is cascade() (via applyPlan). audit() computes and reports
   without rewriting anything.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // Number of tasks whose dates may be rewritten before cascade asks for
  // confirmation. Deliberate: one mis-click must never silently rewrite the
  // plan.
  const CASCADE_CONFIRM_THRESHOLD = 5;

  // ---- Helpers ----
  function getTasks() {
    const s = ns.State.getState();
    return (s && s.tasks) || [];
  }

  function toSchedMap(sched) {
    const map = {};
    (sched || []).forEach(rec => { map[rec.id] = rec; });
    return map;
  }

  // ---- Topological Sort (Kahn's algorithm) ----
  // PURE: orders a task array without mutating it.
  function topologicalSort(tasks) {
    const taskMap = {};
    tasks.forEach(t => { taskMap[t.id] = t; });

    const inDegree = {};
    const adj = {}; // successor adjacency
    tasks.forEach(t => {
      inDegree[t.id] = 0;
      adj[t.id] = [];
    });
    tasks.forEach(t => {
      if (t.predecessors && t.predecessors.length) {
        for (const predId of t.predecessors) {
          if (adj[predId]) {
            adj[predId].push(t.id);
            inDegree[t.id] = (inDegree[t.id] || 0) + 1;
          }
        }
      }
    });

    const queue = tasks.filter(t => (inDegree[t.id] || 0) === 0).map(t => t.id);
    const sorted = [];
    while (queue.length) {
      const id = queue.shift();
      sorted.push(id);
      for (const succId of (adj[id] || [])) {
        inDegree[succId]--;
        if (inDegree[succId] === 0) queue.push(succId);
      }
    }
    // Tasks in dependency order (or original order if no deps)
    return sorted.map(id => taskMap[id]).filter(Boolean);
  }

  // ---- Cycle Detection ----
  // Walks the predecessor graph and returns the ids of every task
  // participating in a circular predecessor chain. Must run before any
  // cascade , Kahn's sort silently drops cycle members.
  function findCycles(tasks) {
    const taskMap = {};
    tasks.forEach(t => { taskMap[t.id] = t; });
    const visited = new Set();
    const path = [];
    const inPath = new Set();
    const cyclic = new Set();

    function visit(id) {
      if (inPath.has(id)) {
        // Cycle found: from the first occurrence of id on the path to the end
        const idx = path.indexOf(id);
        for (let i = idx; i < path.length; i++) cyclic.add(path[i]);
        return;
      }
      if (visited.has(id)) return;
      visited.add(id);
      inPath.add(id);
      path.push(id);
      const task = taskMap[id];
      if (task && task.predecessors) {
        for (const pred of task.predecessors) {
          if (taskMap[pred]) visit(pred);
        }
      }
      path.pop();
      inPath.delete(id);
    }

    tasks.forEach(t => visit(t.id));
    return Array.from(cyclic);
  }

  // ---- Forward Pass (Early Start / Early Finish) ----
  // PURE. Returns a new array of { id, es, ef, late } records.
  // A task with no start date is anchored to the EARLIEST start date in the
  // task set (mirroring the original cascade behaviour) so successors still
  // schedule even when the user only dated the first task. If nothing in the
  // set has a date, es stays null and the task is simply unscheduled.
  function forwardPass(tasks) {
    const sorted = topologicalSort(tasks);
    const taskMap = {};
    sorted.forEach(t => { taskMap[t.id] = t; });
    let earliestStart = null;
    sorted.forEach(t => {
      if (t.startDate && (!earliestStart || t.startDate < earliestStart)) earliestStart = t.startDate;
    });
    const sched = [];
    const schedMap = {};

    sorted.forEach(t => {
      const rec = { id: t.id };
      // Duration is the PADDED duration when weather padding was applied to a
      // transient work clone (t._padDuration); otherwise the task's own
      // duration. Read-only either way , never writes to the input.
      const dur = parseInt(t._padDuration || t.duration) || 1;
      rec.weatherPad = (t._sched && t._sched.weatherPad) || 0;
      rec.paddedDuration = dur;
      if (!t.duration && !t._padDuration) {
        rec.es = null;
        rec.ef = null;
        rec.late = false;
      } else {
        // ES = max of predecessors' EF (+1)
        let maxPredEF = null;
        if (t.predecessors && t.predecessors.length) {
          for (const predId of t.predecessors) {
            const ps = schedMap[predId];
            if (ps && ps.ef && (!maxPredEF || ps.ef > maxPredEF)) maxPredEF = ps.ef;
          }
        }
        // Parent containment acts as a floor on ES (read-only)
        if (t.parentId) {
          const parent = taskMap[t.parentId];
          if (parent && parent.startDate) {
            const ps = U.parseDL(parent.startDate);
            if (ps && (!maxPredEF || ps > maxPredEF)) maxPredEF = ps;
          }
        }
        const anchor = t.startDate ? U.parseDL(t.startDate) : (earliestStart ? U.parseDL(earliestStart) : null);
        if (maxPredEF) {
          // Successor starts on the NEXT WORKING DAY after the predecessor's
          // early finish (skips weekends when the work week is < 7).
          rec.es = U.addWorkingDays(maxPredEF, 1);
        } else if (anchor) {
          rec.es = anchor;
        } else {
          rec.es = null;
        }
        if (rec.es) {
          // Duration is expressed in working days: a 5-day task Mon→Fri stays
          // Mon→Fri instead of drifting across the weekend.
          rec.ef = U.addWorkingDays(rec.es, dur - 1);
          rec.late = !!(t.endDate && U.daysBetween(t.endDate, rec.ef) > 0);
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

  // ---- Backward Pass (Late Start / Late Finish) ----
  // PURE with respect to tasks. Accepts the schedule array produced by
  // forwardPass (transient objects) and returns it annotated with lf/ls.
  function backwardPass(tasks, sched) {
    const schedMap = toSchedMap(sched);
    let projectEnd = null;
    sched.forEach(rec => {
      if (rec.ef && (!projectEnd || rec.ef > projectEnd)) projectEnd = rec.ef;
    });
    if (!projectEnd) return sched;

    // Reverse dependency order so successors' ls are already computed.
    const ordered = topologicalSort(tasks).reverse();
    ordered.forEach(t => {
      const rec = schedMap[t.id];
      if (!rec || !rec.es || !t.duration) return;
      const dur = parseInt(t.duration) || 1;

      // LF = min of successors' LS - 1
      let minSuccLS = null;
      for (const other of tasks) {
        if (other.predecessors && other.predecessors.includes(t.id)) {
          const os = schedMap[other.id];
          if (os && os.ls && (!minSuccLS || os.ls < minSuccLS)) minSuccLS = os.ls;
        }
      }
      const lf = minSuccLS ? U.addWorkingDays(minSuccLS, -1) : projectEnd;
      rec.lf = lf;
      rec.ls = U.addWorkingDays(lf, -(dur - 1));
    });
    return sched;
  }

  // ---- Float Calculation ----
  // PURE with respect to tasks. Annotates the transient sched array.
  function calcFloat(tasks, sched) {
    const schedMap = toSchedMap(sched);
    sched.forEach(rec => {
      rec.totalFloat = (rec.lf && rec.ef) ? U.workingDaysBetween(rec.ef, rec.lf) : null;
    });
    sched.forEach(rec => {
      if (!rec.ef) { rec.freeFloat = null; return; }
      let minSuccES = null;
      for (const other of tasks) {
        if (other.predecessors && other.predecessors.includes(rec.id)) {
          const os = schedMap[other.id];
          if (os && os.es && (!minSuccES || os.es < minSuccES)) minSuccES = os.es;
        }
      }
      rec.freeFloat = minSuccES ? (U.workingDaysBetween(rec.ef, minSuccES) - 1) : rec.totalFloat;
    });
    return sched;
  }

  // ---- Weather helpers ----
  // Number of WORKING days of the task's span that fall inside ANY relevant
  // regional weather window (winter / monsoon / hurricane for that region).
  // The buffer is expressed in the SAME unit as duration (working days): a
  // storm that lands on Saturday does not consume a working day, so only
  // working days inside a hostile window count toward padding. This is what
  // drives SELECTIVE padding , a task gets buffer only for the days it
  // actually works inside a hostile window.
  function getWeatherOverlapDays(task, regionId) {
    if (!task || !task.startDate || !task.endDate) return 0;
    if (!ns.Weather) return 0;
    const region = ns.Weather.getRegion ? ns.Weather.getRegion(regionId) : null;
    if (!region) return 0;
    const windows = [];
    ['winter', 'monsoon', 'hurricane'].forEach(k => {
      if (region[k]) windows.push(region[k]);
    });
    if (!windows.length) return 0;
    const start = U.parseDL(task.startDate);
    const end = U.parseDL(task.endDate);
    if (!start || !end) return 0;
    let overlap = 0;
    const total = U.daysBetween(start, end) + 1;
    for (let i = 0; i < total; i++) {
      const dStr = U.fmtDate(U.addDays(start, i));
      if (windows.some(w => ns.Weather.isDateInWindow(dStr, w)) && U.isWorkDay(dStr)) overlap++;
    }
    return overlap;
  }

  // Selective weather buffer: only weather-SENSITIVE tasks, and only the days
  // inside the region's windows, capped at the configured max buffer.
  function calculateWeatherBuffer(task, regionId, bufferDays) {
    if (!task || !task.weatherSensitive) return 0;
    const exposure = getTaskWeatherExposure(task, regionId);
    if (!exposure.exposed) return 0;
    const overlap = getWeatherOverlapDays(task, regionId);
    const cap = bufferDays || 5;
    return Math.min(overlap, cap);
  }

  function getTaskWeatherExposure(task, regionId) {
    if (!ns.Weather || !task || !task.startDate || !task.endDate) return { exposed: false, reason: '' };
    return ns.Weather.getTaskWeatherExposure(task, regionId);
  }

  // ---- Apply weather padding to a TRANSIENT work array ----
  // The caller must pass a clone , this function annotates it in place so
  // the pure forward pass can read the padded duration.
  function applyWeatherPadding(tasks, regionId, bufferDays) {
    tasks.forEach(t => {
      if (t.weatherSensitive && t.duration) {
        // `pad` counts WORKING days inside hostile windows (see
        // getWeatherOverlapDays), the same unit as duration, so the buffer
        // composes with the schedule rather than inflating it.
        const baseDur = parseInt(t.duration) || 1;
        // ACTION-PLAN 7.3: distributed weather float , a PM can assign extra
        // buffer days to a SPECIFIC task (wxFloatPad, set on the Dashboard
        // Weather Exposure card). This is front-loaded float at the exact
        // weather-vulnerable point in the schedule, on top of the auto
        // regional pad, not a single buffer stacked at the project end.
        const manual = (parseInt(t.wxFloatPad, 10) || 0);
        const pad = calculateWeatherBuffer(t, regionId, bufferDays) + Math.max(0, Math.min(manual, 60));
        t._sched = t._sched || {};
        t._sched.paddedDuration = baseDur + pad;
        t._sched.weatherPad = pad;
        // Expose the padded duration to the pure forward pass via a clone field
        t._padDuration = baseDur + pad;
      }
    });
  }

  // ---- Compute the full schedule plan on a transient clone ----
  // Returns { sched, schedMap, changes } where changes lists every live task
  // whose start/end date would be rewritten, with before/after values.
  function computePlan(regionId, bufferDays) {
    const live = getTasks();
    // Transient work clone , mutating it never touches live task data.
    const work = live.map(t => {
      const c = Object.assign({}, t);
      c.predecessors = t.predecessors ? t.predecessors.slice() : [];
      return c;
    });

    applyWeatherPadding(work, regionId, bufferDays || 5);

    let sched = forwardPass(work);
    sched = backwardPass(work, sched);
    sched = calcFloat(work, sched);

    // Phase roll-up: phase spans derive from their children's plan.
    const schedMap = toSchedMap(sched);
    live.filter(t => t.isPhase).forEach(phase => {
      const children = live.filter(c => c.parentName === phase.name || c.parentId === phase.id);
      const childRecs = children.map(c => schedMap[c.id]).filter(r => r && r.es && r.ef);
      if (childRecs.length) {
        let minES = null, maxEF = null;
        childRecs.forEach(r => {
          if (!minES || r.es < minES) minES = r.es;
          if (!maxEF || r.ef > maxEF) maxEF = r.ef;
        });
        const rec = schedMap[phase.id] || (schedMap[phase.id] = { id: phase.id });
        rec.es = minES;
        rec.ef = maxEF;
      }
    });

    // Which live tasks would actually change?
    const changes = [];
    live.forEach(t => {
      const rec = schedMap[t.id];
      if (!rec || !rec.es || !rec.ef) return;
      const newStart = U.fmtDate(rec.es);
      const newEnd = U.fmtDate(rec.ef);
      if (newStart !== t.startDate || newEnd !== t.endDate) {
        changes.push({ id: t.id, fromStart: t.startDate, toStart: newStart, fromEnd: t.endDate, toEnd: newEnd });
      }
    });

    return { sched, schedMap, changes };
  }

  // ---- Apply the computed plan back onto LIVE tasks ----
  // The ONLY destructive write in this module. Caller must pushUndo() first.
  function applyPlan(regionId) {
    const live = getTasks();
    const plan = computePlan(regionId, 5);
    const { schedMap, changes } = plan;

    live.forEach(t => {
      const rec = schedMap[t.id];
      if (!rec) return;
      // Date write-back
      if (rec.es && rec.ef && !t.isPhase) {
        t.startDate = U.fmtDate(rec.es);
        t.endDate = U.fmtDate(rec.ef);
      } else if (t.isPhase && rec.es && rec.ef) {
        t.startDate = U.fmtDate(rec.es);
        t.endDate = U.fmtDate(rec.ef);
      }
      // Float / critical sync (rendering reads these directly)
      t.critical = rec.totalFloat !== null && rec.totalFloat <= 0;
      t.totalFloat = rec.totalFloat;
      t.freeFloat = rec.freeFloat;
      // Baseline float: captured on first computation (monolith computeFloat
      // behaviour) so Float Watch can show how much slack has been consumed.
      if (t.floatBaseline === null || t.floatBaseline === undefined) {
        t.floatBaseline = rec.totalFloat;
      }
      // Weather exposure flag reflects both the facts and the user's intent
      const exposure = getTaskWeatherExposure(t, regionId);
      t.weatherExposed = !!(exposure.exposed && t.weatherSensitive);
      t._schedPad = rec.weatherPad !== undefined ? rec.weatherPad : null;
    });
    return changes;
  }

  // ---- Cascade Dates ----
  // Runs the full schedule engine and writes computed dates back to tasks.
  // When more than CASCADE_CONFIRM_THRESHOLD tasks would be rewritten, the
  // write-back is gated behind a confirmation dialog listing the affected ids.
  function cascade(regionId, opts) {
    const tasks = getTasks();
    if (!tasks.length) { ns.App.showToast('No tasks to cascade.', 'err'); return false; }

    // Check for tasks without durations
    const noDuration = tasks.filter(t => !t.duration && !t.isPhase);
    if (noDuration.length > 0) {
      ns.App.showToast(noDuration.length + ' task(s) have no duration. Set durations first.', 'err');
      return false;
    }

    // Cycle check BEFORE any computation , never allow a partial plan.
    const cyclic = findCycles(tasks);
    if (cyclic.length > 0) {
      ns.App.showToast('Cyclic predecessor links detected: ' + cyclic.join(', ') + '. Break the loop to cascade.', 'err');
      console.warn('Schedule cascade aborted , cycle involving:', cyclic);
      return false;
    }

    const s = ns.State.getState();
    const region = regionId || s.weatherRegion || 'northern-temperate';

    // Compute the plan on a transient clone first , nothing written yet.
    const plan = computePlan(region, 5);
    const affected = plan.changes;

    const proceed = function() {
      // Capture the pre-cascade plan so the whole rewrite is undoable.
      ns.State.pushUndo();
      applyPlan(region);
      ns.State.save(true);
      ns.Render.renderWbs();
      ns.Render.renderGantt();
      ns.Render.renderDash();
      const critTasks = tasks.filter(t => t.critical && !t.isPhase);
      ns.App.showToast('Cascade complete. ' + critTasks.length + ' tasks on critical path.', 'ok');
      return true;
    };

    const threshold = (opts && typeof opts.threshold === 'number') ? opts.threshold : CASCADE_CONFIRM_THRESHOLD;
    if (affected.length > threshold) {
      ns.App.askConfirm({
        title: 'Confirm Schedule Cascade',
        message: affected.length + ' task(s) will have their start/end dates rewritten by this cascade.',
        items: affected.map(c => c.id),
        danger: true,
        confirmLabel: 'Cascade Dates',
        cancelLabel: 'Cancel',
        onOk: proceed,
        onCancel: (opts && opts.cancel) || null
      });
      return false;
    }
    return proceed();
  }

  // ---- Mark Critical (annotate live tasks from a sched array) ----
  // Used only by the cascade write path.
  function markCritical(sched) {
    const schedMap = toSchedMap(sched);
    const tasks = getTasks();
    tasks.forEach(t => {
      const rec = schedMap[t.id];
      if (!rec) return;
      t.critical = rec.totalFloat !== null && rec.totalFloat <= 0;
      t.totalFloat = rec.totalFloat;
      t.freeFloat = rec.freeFloat;
      if (t.floatBaseline === null || t.floatBaseline === undefined) {
        t.floatBaseline = rec.totalFloat;
      }
    });
  }

  // ---- Weather Exposure Check ----
  // Annotates live tasks with the weatherExposed flag (fact AND user intent).
  function checkWeatherExposure(tasks, regionId) {
    tasks.forEach(t => {
      if (t.startDate && t.endDate && ns.Weather) {
        const exposure = ns.Weather.getTaskWeatherExposure(t, regionId);
        t.weatherExposed = !!(exposure.exposed && t.weatherSensitive);
      }
    });
  }

  // ---- Find Crash Candidates ----
  // Exact port of the monolith crashCandidates(): CRITICAL-path leaf tasks
  // only, ranked by realistic recoverable days (≈28% of duration), with
  // regulatory / curing / waiting-time work excluded since adding labor
  // cannot compress it. Returns { task, duration, recoverable } records.
  const CRASH_EXCLUDE_RE = /\b(cure|curing|clearance|approval|sign.?off|inspection|certificate|permit|wait|review|dry(ing)?|set(ting)?)\b/i;
  function crashCandidates() {
    const tasks = getTasks();
    const crit = tasks.filter((t, i) => {
      if (t.totalFloat !== 0 || !t.startDate || !t.endDate) return false;
      const next = tasks[i + 1];
      const tLvl = t.indent !== undefined ? t.indent : (t.level || 0);
      const nLvl = next ? (next.indent !== undefined ? next.indent : (next.level || 0)) : 0;
      return !(next && nLvl > tLvl); // leaf tasks only , not phase rollups
    });
    return crit
      .filter(t => {
        if (t.leadTime) return false; // third-party/waiting time, not labor-driven
        if (CRASH_EXCLUDE_RE.test(t.name || '')) return false;
        const dur = Math.max(1, U.daysBetween(t.startDate, t.endDate) + 1);
        return dur >= 4; // not worth flagging a 1-3 day task as a crash target
      })
      .map(t => {
        const dur = Math.max(1, U.daysBetween(t.startDate, t.endDate) + 1);
        // Rough, conservative guideline: labor-intensive critical-path work
        // can often absorb ~25-30% compression with added crews/shifts before
        // hitting real diminishing returns. Planning-level estimate only , 
        // always confirm with whoever actually runs that crew.
        const recoverable = Math.max(1, Math.round(dur * 0.28));
        return { task: t, duration: dur, recoverable: recoverable };
      })
      .sort((a, b) => b.recoverable - a.recoverable)
      .slice(0, 5);
  }

  // ---- Find Crash Candidates (backward-compat shape) ----
  // The pre-port findCrashCandidates() returned { id, name, duration,
  // totalFloat, assignee }; keep that contract on this name while the new
  // crashCandidates() (monolith rules + recoverable estimate) is canonical.
  function findCrashCandidates() {
    return crashCandidates().map(c => ({
      id: c.task.id,
      name: c.task.name,
      duration: c.duration,
      totalFloat: c.task.totalFloat,
      assignee: c.task.assignee || 'unassigned'
    }));
  }

  // ---- Near-Critical Tasks (Float Watch) ----
  // Exact port of the monolith getNearCritical(): float ≤10d OR >30% of
  // baseline float consumed. True-critical (0 float) is handled separately.
  function getNearCritical() {
    return getTasks().filter(t => {
      if (t.totalFloat === null || t.totalFloat === undefined) return false;
      if (t.totalFloat <= 0) return false; // true critical is separate
      if (t.totalFloat <= 10) return true;
      if (t.floatBaseline && t.floatBaseline > 0) {
        const consumed = (t.floatBaseline - t.totalFloat) / t.floatBaseline;
        if (consumed > 0.30) return true;
      }
      return false;
    });
  }

  // ---- Identify Lead-Time Items ----
  function findLeadTimeItems() {
    return getTasks().filter(t => t.leadTime && !t.isPhase);
  }

  // ---- Resource Over-Allocation (warning only) ----
  // Same person assigned to overlapping critical-path tasks. No levelling.
  function findResourceConflicts() {
    const tasks = getTasks().filter(t =>
      !t.isPhase && t.assignee && t.critical && t.startDate && t.endDate
    );
    const byPerson = {};
    tasks.forEach(t => {
      if (!byPerson[t.assignee]) byPerson[t.assignee] = [];
      byPerson[t.assignee].push(t);
    });
    const conflicts = [];
    Object.keys(byPerson).forEach(person => {
      const list = byPerson[person];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const overlaps = U.daysBetween(b.startDate, a.endDate) >= 0 && U.daysBetween(a.startDate, b.endDate) >= 0;
          if (overlaps) {
            conflicts.push({ assignee: person, a: a.id, b: b.id });
          }
        }
      }
    });
    return conflicts;
  }

  // ---- Run Full Schedule Audit ----
  // Non-destructive: computes, reports, never rewrites dates.
  function audit() {
    const tasks = getTasks();
    const issues = [];

    // Surface cyclic predecessor links as an error issue (same detection as
    // cascade, so the audit and the live path never disagree).
    const cyclic = findCycles(tasks);
    if (cyclic.length > 0) {
      issues.push({ severity: 'error', task: cyclic.join(', '), message: 'Cyclic predecessor links detected , these tasks cannot be scheduled' });
    }

    // Pure computation on transient clones , live tasks stay untouched.
    const work = tasks.map(t => Object.assign({}, t));
    let sched = forwardPass(work);
    sched = backwardPass(work, sched);
    sched = calcFloat(work, sched);
    const schedMap = toSchedMap(sched);

    for (const t of tasks) {
      const rec = schedMap[t.id] || {};
      if (t.startDate && t.endDate && t.startDate > t.endDate) {
        issues.push({ severity: 'error', task: t.id, message: 'End date ' + t.endDate + ' is before start date ' + t.startDate });
      }
      if (t.predecessors && rec.es) {
        for (const predId of t.predecessors) {
          const pred = tasks.find(p => p.id === predId);
          const predRec = schedMap[predId];
          if (pred && predRec && predRec.ef && U.daysBetween(predRec.ef, rec.es) < 0) {
            issues.push({ severity: 'warning', task: t.id, message: 'Starts before predecessor ' + predId + ' finishes' });
          }
        }
      }
      if (t.parentId) {
        const parent = tasks.find(p => p.id === t.parentId);
        if (parent && parent.startDate && t.startDate && parent.startDate > t.startDate) {
          issues.push({ severity: 'warning', task: t.id, message: 'Starts before parent ' + parent.id });
        }
        if (parent && parent.endDate && t.endDate && t.endDate > parent.endDate) {
          issues.push({ severity: 'warning', task: t.id, message: 'Ends after parent ' + parent.id });
        }
      }
      if (!t.duration && !t.isPhase) {
        issues.push({ severity: 'info', task: t.id, message: 'No duration set' });
      }
    }

    // Resource over-allocation warning
    const conflicts = findResourceConflicts();
    conflicts.forEach(c => {
      issues.push({
        severity: 'warning',
        task: c.a + ' / ' + c.b,
        message: c.assignee + ' is assigned to overlapping critical-path tasks (' + c.a + ', ' + c.b + ')'
      });
    });

    const totalTasks = tasks.filter(t => !t.isPhase).length;
    let criticalCount = 0;
    let lowFloat = 0;
    tasks.forEach(t => {
      const rec = schedMap[t.id];
      if (t.isPhase) return;
      if (rec && rec.totalFloat !== null && rec.totalFloat <= 0) criticalCount++;
      if (rec && rec.totalFloat !== null && rec.totalFloat > 0 && rec.totalFloat <= 5) lowFloat++;
    });
    issues.push({ severity: 'info', task: 'all', message: criticalCount + '/' + totalTasks + ' tasks on critical path. ' + lowFloat + ' tasks with low float (≤5d).' });

    return issues;
  }

  // ---- Monte Carlo Schedule Simulation (feature 7) ----
  // Triangular distribution sampler: min/mode/max. Pure math.
  function triSample(min, ml, max) {
    const u = Math.random();
    const fc = (ml - min) / (max - min);
    if (u < fc) return min + Math.sqrt(u * (max - min) * (ml - min));
    return max - Math.sqrt((1 - u) * (max - min) * (max - ml));
  }

  // Pure simulation core , returns N sorted completion-date results for the
  // given risk settings. Uses simple FS predecessor links (the current
  // schema has no SS/FF/type data, matching the schedule engine's model).
  function simulateSchedule(N, riskFactor, riskAdder) {
    const s = ns.State.getState();
    const tasks = (s.tasks || []).filter(t => t.startDate && t.endDate && !t.isPhase);
    if (tasks.length < 2) return null;
    const results = [];
    for (let sim = 0; sim < N; sim++) {
      const simDur = {};
      tasks.forEach(t => {
        const baseDur = Math.max(1, U.daysBetween(t.startDate, t.endDate));
        let taskRiskFactor = riskFactor, taskRiskAdder = riskAdder;
        if (t.confidenceLevel === 'high' || t.confidence === 'high') {
          taskRiskFactor = Math.min(riskFactor, 1.1);
          taskRiskAdder = Math.min(riskAdder, 1);
        } else if (t.confidenceLevel === 'low' || t.confidence === 'low') {
          taskRiskFactor = riskFactor * 1.3;
          taskRiskAdder = riskAdder + 2;
        }
        simDur[t.id] = triSample(baseDur * 0.8, baseDur, baseDur * taskRiskFactor + taskRiskAdder);
      });
      const startDates = {}, endDates = {};
      let changed = true, passes = 0;
      tasks.forEach(t => { startDates[t.id] = new Date(t.startDate); endDates[t.id] = new Date(t.startDate); });
      while (changed && passes < 50) {
        changed = false;
        passes++;
        tasks.forEach(t => {
          const preds = Array.isArray(t.predecessors) ? t.predecessors : [];
          let minStart = null;
          preds.forEach(pid => {
            if (!endDates[pid] || !startDates[pid]) return;
            const cs = new Date(endDates[pid]);
            if (!minStart || cs > minStart) minStart = cs;
          });
          let sd = new Date(t.startDate);
          if (minStart && minStart > sd) sd = minStart;
          if (!startDates[t.id] || sd > startDates[t.id]) { startDates[t.id] = sd; changed = true; }
          const se = new Date(sd);
          se.setDate(se.getDate() + Math.round(simDur[t.id]));
          if (!endDates[t.id] || se > endDates[t.id]) { endDates[t.id] = se; changed = true; }
        });
      }
      results.push(new Date(Math.max.apply(null, Object.keys(endDates).map(k => endDates[k].getTime()))));
    }
    results.sort((a, b) => a - b);
    return { results: results, tasks: tasks };
  }

  // Runs the simulation from the MC panel inputs and renders the results
  // into the mc-* elements (reusing the monolith's exact element IDs).
  function runMonteCarlo() {
    const s = ns.State.getState();
    const targetStr = (U.$('mc-target') || {}).value || '';
    const riskFactor = parseFloat((U.$('mc-risk-factor') || {}).value) || 1.2;
    const highRiskCount = (s.risks || []).filter(r => !r.issueId && r.probability === 'High' && r.impact === 'High').length;
    const riskAdder = highRiskCount * 2;
    const sim = simulateSchedule(1000, riskFactor, riskAdder);
    if (!sim) {
      const err = U.$('mc-error');
      if (err) { err.classList.remove('is-hide'); err.textContent = 'Need at least 2 scheduled tasks to simulate.'; }
      return;
    }
    const errEl = U.$('mc-error');
    if (errEl) errEl.classList.add('is-hide');
    const { results, tasks } = sim;
    const N = results.length;
    const p10 = results[Math.floor(N * 0.10)], p50 = results[Math.floor(N * 0.50)], p80 = results[Math.floor(N * 0.80)], p90 = results[Math.floor(N * 0.90)];
    let targetPct = 0;
    if (targetStr) {
      const td = new Date(targetStr);
      targetPct = Math.round(results.filter(d => d <= td).length / N * 100);
    }
    const res = U.$('mc-result');
    if (res) res.classList.remove('is-hide');
    const hl = U.$('mc-headline');
    if (hl) {
      if (targetStr) {
        hl.textContent = `${targetPct}% probability of completing by ${new Date(targetStr).toLocaleDateString()}`;
        hl.style.color = targetPct >= 80 ? 'var(--green)' : targetPct >= 50 ? 'var(--amber)' : 'var(--danger)';
      } else {
        hl.textContent = '50th percentile (median) completion: ' + p50.toLocaleDateString();
        hl.style.color = 'var(--gold)';
      }
    }
    const confHighN = tasks.filter(t => t.confidenceLevel === 'high' || t.confidence === 'high').length;
    const confLowN = tasks.filter(t => t.confidenceLevel === 'low' || t.confidence === 'low').length;
    const det = U.$('mc-detail');
    if (det) {
      det.textContent = `Based on ${N} simulations | ${tasks.length} tasks | ${highRiskCount} high×high risks detected${(confHighN || confLowN) ? ` | ${confHighN} conf:high (tighter spread), ${confLowN} conf:low (wider spread)` : ''}`;
    }
    const pctEl = U.$('mc-percentiles');
    if (pctEl) {
      pctEl.innerHTML = `P10 (optimistic): ${p10.toLocaleDateString()} &nbsp;|&nbsp; P50 (median): ${p50.toLocaleDateString()} &nbsp;|&nbsp; P80 (safe): ${p80.toLocaleDateString()} &nbsp;|&nbsp; P90 (conservative): ${p90.toLocaleDateString()}`;
    }
    const buckets = {};
    results.forEach(d => { const key = d.toLocaleString('default', { month: 'short', year: '2-digit' }); buckets[key] = (buckets[key] || 0) + 1; });
    const maxC = Math.max.apply(null, Object.keys(buckets).map(k => buckets[k]));
    const dist = U.$('mc-dist-bar');
    if (dist) {
      dist.innerHTML = '<div style="font-size:.7rem;color:var(--slate);margin-bottom:5px">Simulation distribution:</div>' +
        Object.keys(buckets).map(k => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:.68rem"><span style="min-width:55px;color:var(--slate)">${k}</span><div style="height:12px;background:var(--green);border-radius:2px;width:${Math.round(buckets[k] / maxC * 200)}px;opacity:.8"></div><span style="color:var(--slate)">${buckets[k]}</span></div>`).join('');
    }
  }

  // ---- MARKET-FEATURE-ROADMAP C7: Lookahead ----
  // Tasks that matter in the next N days (default 14): anything still open
  // that starts or finishes inside the horizon, PLUS overdue carryover that
  // should already have finished. Pure function of tasks , no new state.
  function lookaheadTasks(tasks, days) {
    const d = (days === undefined || days === null) ? 14 : +days;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = new Date(today); horizon.setDate(today.getDate() + d);
    // U.parseDL is the app's canonical date parser (local midnight for
    // YYYY-MM-DD) , never new Date('YYYY-MM-DD'), which is UTC and drifts
    // across midnight boundaries on non-UTC machines.
    const p = (str) => U.parseDL(str);
    return (tasks || []).filter(function(t) {
      if (t.status === 'completed') return false;
      const s = t.startDate ? p(t.startDate) : null;
      const e = t.endDate ? p(t.endDate) : null;
      if (!e && !s) return false;
      if (e && e < today) return true;    // overdue carryover
      if (e && e <= horizon) return true; // finishing within horizon
      if (s && s <= horizon) return true; // starting within horizon
      return false;
    }).sort(function(a, b) {
      return p(a.endDate || a.startDate) - p(b.endDate || b.startDate);
    });
  }

  // ---- MARKET-FEATURE-ROADMAP C8: Percent Plan Complete (PPC) ----
  // Lean metric: of the tasks planned to finish in a given ISO week (Mon-Sun,
  // by endDate), how many are actually completed. weekOffset 0 = current week,
  // -1 = last week, etc. pct is null when nothing was planned that week , 
  // never a fabricated 0%. Zero new state; pure function of task dates.
  function isoWeekStart(offset) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day - ((offset || 0) * 7));
    return d;
  }

  function computePpc(tasks, weekOffset) {
    const start = isoWeekStart(weekOffset);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    // Same parseDL discipline as lookaheadTasks , local-midnight parsing.
    const due = (tasks || []).filter(function(t) {
      if (!t.endDate) return false;
      const e = U.parseDL(t.endDate);
      return e && e >= start && e <= end;
    });
    if (!due.length) return { planned: 0, completed: 0, pct: null, start: start, end: end };
    const completed = due.filter(function(t) { return t.status === 'completed'; }).length;
    return { planned: due.length, completed: completed, pct: Math.round((completed / due.length) * 100), start: start, end: end };
  }

  // ---- API ----
  ns.Schedule = {
    lookaheadTasks: lookaheadTasks,
    computePpc: computePpc,
    isoWeekStart: isoWeekStart,
    cascade: cascade,
    findCycles: findCycles,
    topologicalSort: topologicalSort,
    forwardPass: forwardPass,
    backwardPass: backwardPass,
    calcFloat: calcFloat,
    markCritical: markCritical,
    checkWeatherExposure: checkWeatherExposure,
    applyWeatherPadding: applyWeatherPadding,
    calculateWeatherBuffer: calculateWeatherBuffer,
    getWeatherOverlapDays: getWeatherOverlapDays,
    findCrashCandidates: findCrashCandidates,
    crashCandidates: crashCandidates,
    getNearCritical: getNearCritical,
    findLeadTimeItems: findLeadTimeItems,
    findResourceConflicts: findResourceConflicts,
    audit: audit,
    triSample: triSample,
    simulateSchedule: simulateSchedule,
    runMonteCarlo: runMonteCarlo
  };

})(MMGR);
window.MMGR = MMGR;
