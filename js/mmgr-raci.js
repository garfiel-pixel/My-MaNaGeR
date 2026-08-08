/* ============================================================
   My MaNaGeR — RACI Matrix Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;

  function refreshRaciTaskPicker() {
    const picker = U.$('raci-task-picker');
    if (!picker) return;
    const s = ns.State.getState();
    const tasks = (s.tasks || []).filter(t => t.isPhase || (t.level || 0) === 0);
    const raciTasks = (s.raci && s.raci.tasks) || [];
    const existing = new Set(raciTasks.map(t => t.id || t.name || t));
    picker.innerHTML = '<option value="">+ Task Row…</option>' +
      tasks.filter(t => !existing.has(t.id)).map(t => `<option value="${t.id}">${U.escapeHtml(t.name)}</option>`).join('');
  }

  function addRaciTaskFromPicker(taskId) {
    if (!taskId) return;
    ns.State.updateState(function(s) {
      if (!s.raci) s.raci = { tasks: [], persons: [], matrix: {} };
      const task = (s.tasks || []).find(t => t.id === taskId);
      if (task) s.raci.tasks.push({ id: task.id, name: task.name });
    });
    R.renderRaci();
  }

  function refreshRaciPersonPicker() {
    const picker = U.$('raci-person-picker');
    if (!picker) return;
    const s = ns.State.getState();
    const resources = s.resources || [];
    const stakeholders = s.stakeholders || [];
    const raciPersons = (s.raci && s.raci.persons) || [];
    const existing = new Set(raciPersons.map(p => p.id || p.name || p));
    picker.innerHTML = '<option value="">+ Person Col…</option>' +
      [...resources.map(r => ({id: r.id, name: r.name})),
       ...stakeholders.map(s => ({id: s.id, name: s.name}))]
      .filter(p => p.name && !existing.has(p.id))
      .map(p => `<option value="${p.id}">${U.escapeHtml(p.name)}</option>`).join('');
  }

  function addRaciPersonFromPicker(personId) {
    if (!personId) return;
    ns.State.updateState(function(s) {
      if (!s.raci) s.raci = { tasks: [], persons: [], matrix: {} };
      const resources = s.resources || [];
      const stks = s.stakeholders || [];
      const person = resources.find(r => r.id === personId) || stks.find(s => s.id === personId);
      if (person) s.raci.persons.push({ id: person.id, name: person.name });
    });
    R.renderRaci();
  }

  // ---- Cell colors + click-cycle (MONOLITH-PORTING-GUIDE feature 5) ----
  // Heat-colored R/A/C/I cells so overload/gaps are visible at a glance.
  // Pure functions of the letter → color, same treatment as the monolith.
  const RACI_CYCLE = ['', 'R', 'A', 'C', 'I'];
  const RACI_LABELS = {
    R: 'Responsible — does the work',
    A: 'Accountable — owns the outcome (exactly one per task)',
    C: 'Consulted — two-way input before the work',
    I: 'Informed — one-way, kept in the loop',
    '': 'Not involved — click to assign'
  };

  function raciCellBg(v) {
    return { R: 'rgba(0,155,58,.18)', A: 'rgba(212,175,55,.20)', C: 'rgba(59,130,246,.18)', I: 'rgba(138,149,165,.16)', '': 'rgba(0,0,0,.15)' }[v] || 'rgba(0,0,0,.15)';
  }

  function raciCellFg(v) {
    return { R: 'var(--green)', A: 'var(--gold)', C: '#3B82F6', I: 'var(--slate)', '': 'var(--slate)' }[v] || 'var(--slate)';
  }

  function cycleRaci(taskId, personId, ev) {
    // ev may be a real event (click/contextmenu) OR a plain options object
    // (keyboard handler / direct calls) — guard preventDefault so the cycle
    // never dies on a non-event argument.
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    const dir = ev && ev.button === 2 ? -1 : 1;
    ns.State.updateState(function(s) {
      if (!s.raci) s.raci = { tasks: [], persons: [], matrix: {} };
      const key = taskId + '_' + personId;
      let idx = RACI_CYCLE.indexOf(s.raci.matrix[key] || '');
      if (idx < 0) idx = 0;
      idx = (idx + dir + RACI_CYCLE.length) % RACI_CYCLE.length;
      s.raci.matrix[key] = RACI_CYCLE[idx];
    });
    R.renderRaci();
  }

  // Keyboard navigation for a focused RACI cell (Enter/Space forward,
  // Backspace/ArrowLeft back, ArrowRight forward) — delegated, no inline
  // handlers, so the CSP stays intact.
  document.addEventListener('keydown', function(e) {
    const cell = e.target.closest && e.target.closest('[data-action="cycleRaci"]');
    if (!cell) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      cycleRaci(cell.getAttribute('data-task'), cell.getAttribute('data-person'), {});
    } else if (e.key === 'Backspace' || e.key === 'ArrowLeft') {
      e.preventDefault();
      cycleRaci(cell.getAttribute('data-task'), cell.getAttribute('data-person'), { button: 2 });
    }
  });

  function raciPersonInfo(p) {
    const s = ns.State.getState();
    if (p.sourceType === 'resource') { const r = (s.resources || []).find(x => x.id === p.sourceId); if (r) return { name: r.name || '(unnamed)', role: r.role || '', tag: 'Resources', live: true }; }
    if (p.sourceType === 'stakeholder') { const st = (s.stakeholders || []).find(x => x.id === p.sourceId); if (st) return { name: st.name || '(unnamed)', role: st.role || '', tag: 'Stakeholders', live: true }; }
    return { name: p.name || '', role: p.role || '', tag: null, live: false };
  }

  function raciTaskInfo(t) {
    const s = ns.State.getState();
    if (t.sourceType === 'task') { const x = (s.tasks || []).find(y => y.id === t.sourceId); if (x) return { name: x.name || '(unnamed)', wbs: x.id || '', live: true }; }
    return { name: t.name || '', wbs: '', live: false };
  }

  // Copy-paste-ready text summary of the whole matrix (feeds Copy All).
  function raciExportBlock() {
    const s = ns.State.getState();
    const raci = s.raci || { tasks: [], persons: [], matrix: {} };
    const { tasks, persons, matrix } = raci;
    if (!tasks.length || !persons.length) return '(no RACI data yet — add task rows and person columns in the RACI tab first)';
    const header = 'Task | ' + persons.map(p => { const pi = raciPersonInfo(p); return pi.name + (pi.role ? ' (' + pi.role + ')' : ''); }).join(' | ');
    const rows = tasks.map(t => { const ti = raciTaskInfo(t); return ti.name + ' | ' + persons.map(p => matrix[t.id + '_' + p.id] || '—').join(' | '); });
    return [header].concat(rows).join('\n');
  }

  // Editable rows: linked entries are display-only (live data), custom
  // entries are free-text inputs driven by these updaters (CSP-safe).
  function updRaciTask(idx, value) {
    ns.State.updateState(function(s) {
      if (s.raci && s.raci.tasks && s.raci.tasks[idx]) s.raci.tasks[idx].name = value;
    });
  }

  function updRaciPerson(idx, field, value) {
    ns.State.updateState(function(s) {
      if (s.raci && s.raci.persons && s.raci.persons[idx]) s.raci.persons[idx][field] = value;
    });
  }

  // ---- Live-link pruning (gap: deleting a task / resource / stakeholder
  // left orphaned matrix keys) ----
  // Called from the WBS / Resources / Stakeholders delete paths. Removes any
  // RACI rows, person columns and matrix cells that reference the deleted
  // live records so the matrix can never point at something that no longer
  // exists. Ids are compared string-normalized (task ids may be numeric).
  function pruneDeleted(opts) {
    const taskIds = (opts && opts.taskIds) || [];
    const personIds = (opts && opts.personIds) || [];
    if (!taskIds.length && !personIds.length) return;
    const taskSet = taskIds.map(String);
    const personSet = personIds.map(String);
    ns.State.updateState(function(s) {
      if (!s.raci) return;
      const raci = s.raci;
      if (taskSet.length) {
        raci.tasks = (raci.tasks || []).filter(t => !taskSet.includes(String(t.id)) && !taskSet.includes(String(t.sourceId)));
      }
      if (personSet.length) {
        raci.persons = (raci.persons || []).filter(p => !personSet.includes(String(p.id)) && !personSet.includes(String(p.sourceId)));
      }
      Object.keys(raci.matrix || {}).forEach(k => {
        const parts = k.split('_');
        const kTask = parts[0], kPerson = parts[1];
        if ((taskSet.length && taskSet.includes(kTask)) || (personSet.length && personSet.includes(kPerson))) {
          delete raci.matrix[k];
        }
      });
    });
    R.renderRaci();
  }

  function delRaciTask(idx) {
    ns.State.updateState(function(s) {
      if (s.raci && s.raci.tasks) s.raci.tasks.splice(idx, 1);
    });
    R.renderRaci();
  }

  function delRaciPerson(idx) {
    ns.State.updateState(function(s) {
      if (!s.raci) return;
      const p = s.raci.persons && s.raci.persons[idx];
      if (p) Object.keys(s.raci.matrix || {}).forEach(k => { if (k.endsWith('_' + p.id)) delete s.raci.matrix[k]; });
      if (s.raci.persons) s.raci.persons.splice(idx, 1);
    });
    R.renderRaci();
  }

  // ---- 4.2 RACI-to-workload heatmap ----
  // Per-person workload derived straight from the matrix: how many R/A/C/I
  // assignments each person carries, weighted by ownership (A weighs most),
  // and how that load compares across the team. Pure function of state so
  // the heatmap and any export share the same numbers.
  const WORKLOAD_WEIGHT = { A: 2.0, R: 1.0, C: 0.5, I: 0.25 };

  function raciWorkload(state) {
    const s = state || ns.State.getState();
    const raci = (s && s.raci) || { tasks: [], persons: [], matrix: {} };
    const persons = raci.persons || [];
    if (!persons.length) return [];
    const rows = persons.map(p => {
      const counts = { R: 0, A: 0, C: 0, I: 0 };
      (raci.tasks || []).forEach(t => {
        const v = (raci.matrix || {})[t.id + '_' + p.id];
        if (counts[v] !== undefined) counts[v]++;
      });
      const load = counts.R * WORKLOAD_WEIGHT.R + counts.A * WORKLOAD_WEIGHT.A +
        counts.C * WORKLOAD_WEIGHT.C + counts.I * WORKLOAD_WEIGHT.I;
      return { person: p, counts: counts, load: load, info: raciPersonInfo(p) };
    }).sort((a, b) => b.load - a.load);
    const maxLoad = rows.length ? rows[0].load : 0;
    rows.forEach(r => { r.pct = maxLoad ? Math.round(r.load / maxLoad * 100) : 0; });
    return rows;
  }

  // ---- API ----
  ns.Raci = {
    refreshRaciTaskPicker: refreshRaciTaskPicker,
    addRaciTaskFromPicker: addRaciTaskFromPicker,
    refreshRaciPersonPicker: refreshRaciPersonPicker,
    addRaciPersonFromPicker: addRaciPersonFromPicker,
    cycleRaci: cycleRaci,
    raciCellBg: raciCellBg,
    raciCellFg: raciCellFg,
    raciExportBlock: raciExportBlock,
    raciPersonInfo: raciPersonInfo,
    raciTaskInfo: raciTaskInfo,
    updRaciTask: updRaciTask,
    updRaciPerson: updRaciPerson,
    delRaciTask: delRaciTask,
    delRaciPerson: delRaciPerson,
    pruneDeleted: pruneDeleted,
    raciWorkload: raciWorkload,
    RACI_LABELS: RACI_LABELS,
    RACI_CYCLE_FILTERED: function() { return RACI_CYCLE.filter(x => x); }
  };

})(MMGR);
window.MMGR = MMGR;