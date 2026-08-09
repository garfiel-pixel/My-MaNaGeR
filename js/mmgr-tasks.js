/* ============================================================
   My MaNaGeR — WBS / Task Management Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State.getState();
  const U = ns.Utils;
  const R = ns.Render;

  // ---- Task CRUD ----
  function addTask() {
    ns.State.updateState(function(s) {
      if (!s.tasks) s.tasks = [];
      s.tasks.push({
        id: U.genId('t'),
        name: 'New Task',
        level: 0, indent: 0, isPhase: false,
        status: 'todo', startDate: '', endDate: '', duration: '',
        assignee: '', critical: false, leadTime: false,
        recurring: false, weatherExposed: false,
        confidence: 'high', predecessors: [], notes: '',
        weatherSensitive: false
      });
    });
    R.renderWbs();
  }

  // ---- Milestone flag (feature 11) ----
  function tglMilestone(id) {
    ns.State.updateState(function(s) {
      const task = (s.tasks || []).find(t => t.id === id);
      if (task) task.milestone = !task.milestone;
    });
    R.renderWbs();
    R.renderDash();
  }

  // ---- Weather-sensitive flag ----
  function tglWeather(id) {
    ns.State.updateState(function(s) {
      const task = (s.tasks || []).find(t => t.id === id);
      if (task) task.weatherSensitive = !task.weatherSensitive;
    });
    R.renderWbs();
    R.renderGantt();
  }

  // ---- Lead-Time flag (monolith taskType 'leadtime') ----
  // Marks a task as a third-party / vendor wait tracked by Submitted and
  // Expected dates instead of Start/End + % done. Feeds the Dashboard
  // Lead-Time Tracker, the Kanban Lead-Time lane, the hatched Gantt bar and
  // excludes it from crash-candidate compression. When switching ON, the
  // submitted date defaults to today so the tracker has an anchor; the
  // expected date is left for the user (never fabricated).
  function tglLeadTime(id) {
    ns.State.updateState(function(s) {
      const task = (s.tasks || []).find(t => t.id === id);
      if (!task) return;
      task.leadTime = !task.leadTime;
      if (task.leadTime && !task.submittedDate) {
        task.submittedDate = U.todayStr();
      }
    });
    R.renderWbs();
    R.renderGantt();
    R.renderKanban();
    R.renderDash();
  }

  // ---- Item 23: rolling lead-time review stamp ----
  // Marks a lead-time item's rolling 3-month forecast as reviewed now, so
  // the Dashboard tracker can show a fresh (non-stale) badge. Client-side
  // state only — a "last updated" timestamp, not a server sync.
  function tglLeadtimeReview(id) {
    ns.State.updateState(function(s) {
      const task = (s.tasks || []).find(t => t.id === id);
      if (task) task.leadtimeUpdatedAt = new Date().toISOString();
    });
    R.renderDash();
  }

  function updTaskField(id, field, value, evtType) {
    ns.State.updateState(function(s) {
      const task = (s.tasks || []).find(t => t.id === id);
      if (task) {
        task[field] = value;
        if (field === 'duration' || field === 'startDate') {
          if (task.startDate && task.duration) {
            const dur = parseInt(task.duration);
            if (!isNaN(dur)) {
              // Duration counts WORKING days (respects the work-week control).
              task.endDate = U.fmtDate(U.addWorkingDays(task.startDate, dur - 1));
            }
          }
        }
      }
    });
    // Focus discipline (browser-verified): re-rendering the WBS table on
    // every `input` keystroke destroys the focused input and drops the caret,
    // so only one character could ever be typed. State is saved on every
    // keystroke; the table re-renders on `change` (blur/commit) instead.
    if (evtType === 'input') return;
    // Date-commit discipline (user-reported "the dates are fighting me" bug):
    // the native date picker is anchored to the focused input element. On a
    // date commit Chrome fires `change`; rebuilding the WBS table from that
    // handler destroys the input mid-interaction, and the focus() restore on
    // the rebuilt twin re-opens the picker (Chrome re-opens the native picker
    // the moment a date input gains focus), so the user can never reach the
    // next date field. Date commits therefore NEVER rebuild the WBS table:
    // state is already saved on `input`; only the recomputed endDate cell is
    // patched in place; the derived panels (Gantt/Kanban/Dashboard) refresh
    // without touching the WBS DOM.
    if (field === 'startDate' || field === 'endDate' || field === 'submittedDate' || field === 'expectedDate') {
      if (field === 'startDate') {
        const st = ns.State.getState();
        const task = (st.tasks || []).find(t => t.id === id);
        if (task && task.endDate) {
          const row = document.querySelector('#wbs-body tr.wbs-row[data-id="' + id + '"]');
          const endInp = row && row.querySelector('input[data-field="endDate"]');
          if (endInp) endInp.value = task.endDate;
        }
      }
      R.renderGantt();
      R.renderKanban();
      R.renderDash();
      return;
    }
    // Focus discipline (interaction audit): duration/status/name/assignee
    // edits fire `change` immediately, so the table rebuild would drop the
    // caret. Re-render through rerenderPreservingFocus — the rebuilt twin
    // input keeps focus.
    U.rerenderPreservingFocus(function() {
      // If the user's focus has moved to a native date/time input (e.g. they
      // clicked a date picker right after editing another field), rebuilding
      // the WBS table would destroy that input just as its picker is opening
      // — the "dates are fighting me" bug. Skip ONLY the WBS rebuild in that
      // case (state is already saved); the derived panels never touch the
      // WBS DOM, so they still refresh. Note: date commits themselves never
      // reach this path at all — see the date branch above.
      const ae = document.activeElement;
      const pickerFocused = ae && ae.type && (ae.type === 'date' || ae.type === 'time' ||
        ae.type === 'month' || ae.type === 'week' || ae.type === 'datetime-local');
      if (!pickerFocused) R.renderWbs();
      R.renderGantt();
      R.renderKanban();
      // Interaction re-audit: a status change also moves the health ring,
      // Today's Focus, and the Decision Engine — refresh the Dashboard or
      // those counters stay stale until the next unrelated re-render.
      R.renderDash();
    });
  }

  function delTask(id) {
    ns.State.updateState(function(s) {
      if (s.tasks) s.tasks = s.tasks.filter(t => t.id !== id);
    });
    // Keep the RACI matrix consistent: drop the deleted task's row + cells.
    if (ns.Raci && ns.Raci.pruneDeleted) ns.Raci.pruneDeleted({ taskIds: [id] });
    R.renderWbs();
    R.renderGantt();
    R.renderKanban();
    R.renderDash();
  }

  function indentTask(id) {
    ns.State.updateState(function(s) {
      if (!s.tasks) return;
      const idx = s.tasks.findIndex(t => t.id === id);
      if (idx > 0) {
        const prev = s.tasks[idx - 1];
        s.tasks[idx].indent = Math.min((prev.indent || 0) + 1, 3);
        s.tasks[idx].level = s.tasks[idx].indent;
      }
    });
    R.renderWbs();
  }

  function outdentTask(id) {
    ns.State.updateState(function(s) {
      if (!s.tasks) return;
      const task = s.tasks.find(t => t.id === id);
      if (task) {
        task.indent = Math.max((task.indent || 0) - 1, 0);
        task.level = task.indent;
      }
    });
    R.renderWbs();
  }

  function tglPhase(id) {
    // Toggle phase collapse. State is persisted per task id with the flag
    // meaning "expanded": undefined/true = expanded, false = collapsed.
    // The DOM is driven by re-render from state, so it can never drift.
    ns.State.updateState(function(s) {
      if (!s.defExpanded) s.defExpanded = {};
      s.defExpanded[id] = (s.defExpanded[id] === false);
    });
    R.renderWbs();
  }

  // ---- Bulk collapse/expand all phases (MONOLITH-PORTING-GUIDE feature 9) ----
  function collapseAll() {
    ns.State.updateState(function(s) {
      if (!s.defExpanded) s.defExpanded = {};
      // Collapse every phase container (isPhase or level 0) except standalone
      // tasks — the render treats isPhase || level===0 as a collapsible row.
      (s.tasks || []).forEach(t => {
        if (t.isPhase || (t.level || 0) === 0) s.defExpanded[t.id] = false;
      });
    });
    R.renderWbs();
  }

  function expandAll() {
    ns.State.updateState(function(s) {
      if (!s.defExpanded) s.defExpanded = {};
      (s.tasks || []).forEach(t => {
        if (t.isPhase || (t.level || 0) === 0) delete s.defExpanded[t.id]; // undefined = expanded
      });
    });
    R.renderWbs();
  }

  // ---- Sprint ----
  function loadSprintData() {
    const s = S();
    const spr = s.sprint || {};
    const setVal = (id, val) => { const el = U.$(id); if (el) el.value = val || ''; };
    setVal('sp-nm', spr.name);
    setVal('sp-st', spr.start);
    setVal('sp-en', spr.end);
  }

  function saveSprint() {
    ns.State.updateState(function(s) {
      if (!s.sprint) s.sprint = {};
      s.sprint.name = (U.$('sp-nm') || {}).value || 'Sprint 1';
      s.sprint.start = (U.$('sp-st') || {}).value || '';
      s.sprint.end = (U.$('sp-en') || {}).value || '';
    });
  }

  // ---- WBS Import ----
  function openWbsImport() {
    const modal = U.$('wbsimport-modal');
    if (modal) modal.classList.add('on');
  }

  function closeWbsImport() {
    const modal = U.$('wbsimport-modal');
    if (modal) modal.classList.remove('on');
  }

  function wiPreview() {
    const source = U.$('wi-source');
    const preview = U.$('wi-preview');
    const commitBtn = U.$('wi-commit-btn');
    if (!source || !preview) return;
    const text = source.value.trim();
    if (!text) {
      preview.innerHTML = '<div style="color:var(--slate);padding:10px">Paste your task outline to see a preview.</div>';
      if (commitBtn) commitBtn.disabled = true;
      return;
    }
    const lines = text.split('\n').filter(l => l.trim());
    let html = '<table class="dt" style="font-size:.74rem"><thead><tr><th>Level</th><th>Task Name</th></tr></thead><tbody>';
    let taskCount = 0;
    for (const line of lines) {
      const cleaned = line.replace(/^[\s\-•*]+/, '').replace(/^[\d]+[\.\)]\s*/, '').trim();
      if (!cleaned) continue;
      const indent = Math.min(Math.floor((line.search(/\S/) || 0) / 2), 2);
      html += `<tr><td>L${indent}</td><td>${U.escapeHtml(cleaned)}</td></tr>`;
      taskCount++;
    }
    html += '</tbody></table>';
    preview.innerHTML = html;
    if (commitBtn) commitBtn.disabled = taskCount === 0;
  }

  function wiCommit() {
    const source = U.$('wi-source');
    if (!source) return;
    const text = source.value.trim();
    if (!text) return;
    const lines = text.split('\n').filter(l => l.trim());
    // Bulk import is destructive (adds tasks) — make it undoable.
    ns.State.pushUndo();
    // Phase 2 idempotency: importing the SAME outline twice must not duplicate
    // tasks. A line is skipped when a task with the same name already exists
    // at the same level under the same parent phase — so the WBS is a set,
    // not an append log.
    let added = 0, skipped = 0;
    ns.State.updateState(function(s) {
      if (!s.tasks) s.tasks = [];
      let currentPhase = null;
      for (const line of lines) {
        const cleaned = line.replace(/^[\s\-•*]+/, '').replace(/^[\d]+[\.\)]\s*/, '').trim();
        if (!cleaned) continue;
        const indent = Math.min(Math.floor((line.search(/\S/) || 0) / 2), 2);
        // Track the phase line even when it is itself a duplicate, so its
        // children keep the correct parent linkage on a re-import (a skipped
        // phase must not orphan the next line into parentName=null, which
        // would break the dedupe match and duplicate the children).
        if (indent === 0) currentPhase = cleaned;
        const parentName = indent === 0 ? null : currentPhase;
        const dup = s.tasks.some(t =>
          t.name === cleaned &&
          (t.level || 0) === indent &&
          (t.parentName || null) === parentName
        );
        if (dup) { skipped++; continue; }
        if (indent === 0) {
          s.tasks.push({
            id: U.genId('t'), name: cleaned,
            level: 0, indent: 0, isPhase: true,
            status: 'todo', startDate: '', endDate: '', duration: '', assignee: '',
            critical: false, leadTime: false, recurring: false, weatherExposed: false,
            confidence: 'high', predecessors: [], notes: '', weatherSensitive: false
          });
        } else {
          s.tasks.push({
            id: U.genId('t'), name: cleaned,
            level: indent, indent: indent, isPhase: false,
            status: 'todo', startDate: '', endDate: '', duration: '', assignee: '',
            critical: false, leadTime: false, recurring: false, weatherExposed: false,
            confidence: 'high', predecessors: [], notes: '', weatherSensitive: false,
            parentName: currentPhase
          });
        }
        added++;
      }
    });
    // Full-view refresh (interaction audit): the import changes live state, so
    // every surface that reads tasks must re-render — not just the WBS panel
    // the import modal lives in. Kanban, Gantt and the Dashboard would stay
    // stale until the next unrelated re-render otherwise.
    R.renderWbs();
    R.renderKanban();
    R.renderGantt();
    R.renderDash();
    closeWbsImport();
    const noun = added === 1 ? ' task imported' : ' tasks imported';
    ns.App.showToast(added + noun + (skipped ? ' — ' + skipped + ' already present, skipped' : '!'), 'ok');
  }

  // ---- Import Dates ----
  function openImportDates() {
    const modal = U.$('importdates-modal');
    const template = U.$('id-template');
    if (!modal || !template) return;
    const s = S();
    const tasks = (s.tasks || []).filter(t => !t.isPhase);
    template.value = tasks.map(t => `${t.name} (${t.duration || '?'}d)`).join('\n');
    // Fresh modal: clear the editable field and disable the Fill In button
    // until a valid preview exists, so state never carries across opens.
    const source = U.$('id-source');
    if (source) source.value = '';
    const commitBtn = U.$('id-commit-btn');
    if (commitBtn) commitBtn.disabled = true;
    modal.classList.add('on');
  }

  function closeImportDates() {
    const modal = U.$('importdates-modal');
    if (modal) modal.classList.remove('on');
  }

  // ---- MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-2: 'Copy List' ----
  // Restores the monolith's copyIdTemplate() — one click copies the readonly
  // id-template textarea (the task list the user takes to dictate durations)
  // to the clipboard. The spec mislabeled this as a stakeholder feature; the
  // monolith reference (button ~469, def ~3300) shows it belongs to the
  // Import Dates modal, so that is what is restored here.
  function copyIdTemplate() {
    const template = U.$('id-template');
    if (!template) return;
    // execCommand returns false on failure rather than throwing — check the
    // return value so the async clipboard fallback actually fires when the
    // legacy path fails (read-only content is safe to select + copy).
    template.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (ok) {
      ns.App.showToast('Copied — paste it wherever you\'re going to dictate.', 'ok');
    } else {
      U.copyToClipboard(template.value);
      ns.App.showToast('Copied to clipboard.', 'ok');
    }
  }

  function idPreview() {
    // Reads the editable textarea (id-source), NOT the readonly template.
    const source = U.$('id-source');
    const preview = U.$('id-preview');
    const commitBtn = U.$('id-commit-btn');
    if (!source || !preview) return;
    const text = source.value.trim();
    if (!text) {
      preview.innerHTML = '<div style="color:var(--slate);padding:10px">Paste date-formatted tasks to see a preview.</div>';
      if (commitBtn) commitBtn.disabled = true;
      return;
    }
    const lines = text.split('\n').filter(l => l.trim());
    let html = '<table class="dt" style="font-size:.74rem"><thead><tr><th>Task</th><th>Duration</th><th>Start</th><th>End</th></tr></thead><tbody>';
    let validCount = 0;
    for (const line of lines) {
      const parts = line.match(/^(.+?)\s*\(\s*(\d+)\s*d\s*\)\s*\[\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})\s*\]\s*$/);
      if (parts) {
        html += `<tr><td>${U.escapeHtml(parts[1].trim())}</td><td>${parts[2]}d</td><td>${parts[3]}</td><td>${parts[4]}</td></tr>`;
        validCount++;
      }
    }
    html += '</tbody></table>';
    preview.innerHTML = html;
    if (commitBtn) commitBtn.disabled = validCount === 0;
  }

  function idCommit() {
    const source = U.$('id-source');
    if (!source) return;
    const text = source.value.trim();
    if (!text) { ns.App.showToast('No data to import.', 'err'); return; }
    const lines = text.split('\n').filter(l => l.trim());
    // Bulk import is destructive — make it undoable.
    ns.State.pushUndo();
    let created = 0, updated = 0;
    const createdThisRun = new Set(); // same-name-twice-in-one-import guard
    ns.State.updateState(function(s) {
      if (!s.tasks) s.tasks = [];
      for (const line of lines) {
        const parts = line.match(/^(.+?)\s*\(\s*(\d+)\s*d\s*\)\s*\[\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})\s*\]\s*$/);
        if (parts) {
          const name = parts[1].trim();
          const dur = parts[2];
          const start = parts[3];
          const end = parts[4];
          // Phase 2 idempotency: match by NAME regardless of dates, so
          // re-importing the same dated list updates in place instead of
          // creating duplicate same-named tasks.
          let task = s.tasks.find(t => t.name === name);
          if (!task) {
            task = {
              id: U.genId('t'), name: name,
              level: 0, indent: 0, isPhase: false,
              status: 'todo', startDate: '', endDate: '', duration: '', assignee: '',
              critical: false, leadTime: false, recurring: false, weatherExposed: false,
              confidence: 'high', predecessors: [], notes: '', weatherSensitive: false
            };
            s.tasks.push(task);
            createdThisRun.add(task.id);
            created++;
          } else if (!createdThisRun.has(task.id)) {
            // A task created earlier in THIS import is an in-run update, not
            // a pre-existing task — don't inflate the "updated" counter.
            updated++;
          }
          task.duration = dur;
          task.startDate = start;
          task.endDate = end;
        }
      }
    });
    R.renderWbs();
    R.renderGantt();
    R.renderKanban();
    R.renderDash();
    closeImportDates();
    ns.App.showToast('Dates imported — ' + created + ' created, ' + updated + ' updated.', 'ok');
  }

  // ---- API ----
  ns.Tasks = {
    addTask: addTask,
    updTaskField: updTaskField,
    tglMilestone: tglMilestone,
    tglWeather: tglWeather,
    tglLeadTime: tglLeadTime,
    tglLeadtimeReview: tglLeadtimeReview,
    delTask: delTask,
    indentTask: indentTask,
    outdentTask: outdentTask,
    tglPhase: tglPhase,
    collapseAll: collapseAll,
    expandAll: expandAll,
    loadSprintData: loadSprintData,
    saveSprint: saveSprint,
    openWbsImport: openWbsImport,
    closeWbsImport: closeWbsImport,
    wiPreview: wiPreview,
    wiCommit: wiCommit,
    openImportDates: openImportDates,
    closeImportDates: closeImportDates,
    idPreview: idPreview,
    idCommit: idCommit,
    copyIdTemplate: copyIdTemplate
  };

  // Alias for backward compat with inline onclick
  ns.Sprint = {
    loadSprintData: loadSprintData,
    saveSprint: saveSprint
  };
  ns.WbsImport = {
    openWbsImport: openWbsImport,
    closeWbsImport: closeWbsImport,
    wiPreview: wiPreview,
    wiCommit: wiCommit
  };
  ns.ImportDates = {
    openImportDates: openImportDates,
    closeImportDates: closeImportDates,
    idPreview: idPreview,
    idCommit: idCommit,
    copyIdTemplate: copyIdTemplate
  };

})(MMGR);
window.MMGR = MMGR;