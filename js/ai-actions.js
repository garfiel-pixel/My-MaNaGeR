/*
 * Wave 4d (owner 2026-11-10): bounded, reviewable AI actions inside a project.
 *
 * The owner's rule: the assistant inside a project may GUIDE and ASSIST, but it
 * must never silently execute a complex change. A bounded, single-record edit
 * (move a task's dates, mark a status, set a budget figure, add a risk or a
 * decision) is fine to DO - but only after the person has seen exactly what will
 * change and clicked Apply. A multi-record, restructure-the-plan request is
 * refused as an action and answered as a numbered directive instead.
 *
 * This module is the single place that knows the op grammar. The chat (mmgr-ai.js)
 * parses the assistant's ACTIONS: block out of the RESPONSE (never the prompt)
 * and hands it here. Everything that touches project state goes through
 * MMGR.State.updateState + MMGR.State.pushUndo, so every applied action is
 * one-click reversible and rides the normal cloud snapshot.
 *
 * No action result is ever interpolated as innerHTML from a model string: the
 * preview and the report are built with textContent / DOM nodes only.
 */
(function (MMGR) {
  'use strict';
  var ns = MMGR || (window.MMGR = {});

  // Ops the assistant may perform. Each is single-record and reversible.
  var ALLOWED = {
    setTaskDates: 'Move a task on the schedule',
    setTaskDuration: 'Change a task duration',
    setTaskStatus: 'Set a task status',
    setBudgetLinePlanned: 'Set a budget line figure',
    addRisk: 'Add a risk',
    addDecision: 'Add a decision'
  };

  // Phrases that mark a request too big to DO - the assistant must answer with
  // steps instead of writing. Kept deliberately conservative.
  var COMPLEX_HINTS = [
    /re-?plan (the |my )?(whole |entire )?schedule/i,
    /restructure (the |my )?(wbs|work breakdown|plan)/i,
    /rewrite (the |my )?(entire |whole )?budget/i,
    /rebuild (the |my )?(gantt|chart|timeline)/i,
    /resequence (all|every|the whole) tasks/i
  ];

  function isComplex(text) {
    var t = String(text || '');
    for (var i = 0; i < COMPLEX_HINTS.length; i++) {
      if (COMPLEX_HINTS[i].test(t)) {
        return true;
      }
    }
    return false;
  }

  // Pull the ACTIONS: [... ] block out of a reply. Defensive: a malformed block
  // is ignored rather than crashing the chat.
  function parseActions(text) {
    var s = String(text == null ? '' : text);
    var m = s.match(/ACTIONS:\s*(\[[\s\S]*?\])\s*(?:\n|$)/);
    if (!m) {
      return null;
    }
    try {
      var arr = JSON.parse(m[1]);
      return Array.isArray(arr) ? arr : null;
    } catch (e) {
      return null;
    }
  }

  function opLabel(op) {
    return ALLOWED[op] || (typeof op === 'string' ? op : '');
  }

  // Validate one op against the grammar. Returns {ok, error}.
  function validateOp(a) {
    if (!a || typeof a !== 'object') {
      return { ok: false, error: 'empty action' };
    }
    if (!ALLOWED[a.op]) {
      return { ok: false, error: 'unsupported action: ' + String(a.op || '') };
    }
    if (a.op === 'setTaskDates' || a.op === 'setTaskDuration' || a.op === 'setTaskStatus') {
      if (!a.taskId) {
        return { ok: false, error: 'missing taskId' };
      }
    }
    if (a.op === 'setBudgetLinePlanned') {
      if (!a.lineId) {
        return { ok: false, error: 'missing lineId' };
      }
    }
    return { ok: true };
  }

  // Apply the validated ops. Returns a report: [{name, ok, detail}].
  // pushUndo is captured ONCE before the batch so the whole set is one undo.
  function apply(actions) {
    if (!Array.isArray(actions) || !actions.length) {
      return { ok: false, applied: 0, report: [] };
    }
    var S = ns.State;
    if (!S || typeof S.updateState !== 'function' || typeof S.pushUndo !== 'function') {
      return {
        ok: false,
        applied: 0,
        report: [{ name: 'state', ok: false, detail: 'state unavailable' }]
      };
    }
    var report = [];
    var applied = 0;
    S.pushUndo();
    S.updateState(function (s) {
      var tasks = (s.tasks = s.tasks || []);
      var lines = (s.budgetLines = s.budgetLines || []);
      var risks = (s.risks = s.risks || []);
      var decisions = (s.decisions = s.decisions || []);
      actions.forEach(function (a) {
        var v = validateOp(a);
        if (!v.ok) {
          report.push({ name: opLabel(a && a.op), ok: false, detail: v.error });
          return;
        }
        try {
          if (a.op === 'setTaskDates') {
            var t = findBy(tasks, 'id', a.taskId);
            if (!t) {
              report.push({ name: 'task dates', ok: false, detail: 'task not found: ' + a.taskId });
              return;
            }
            if (a.startDate != null) t.startDate = String(a.startDate);
            if (a.endDate != null) t.endDate = String(a.endDate);
            report.push({
              name: 'task dates',
              ok: true,
              detail: labelOf(t) + ' -> ' + (a.startDate || '') + ' to ' + (a.endDate || '')
            });
            applied++;
          } else if (a.op === 'setTaskDuration') {
            var t2 = findBy(tasks, 'id', a.taskId);
            if (!t2) {
              report.push({
                name: 'task duration',
                ok: false,
                detail: 'task not found: ' + a.taskId
              });
              return;
            }
            if (a.duration != null) t2.duration = Number(a.duration) || 0;
            report.push({
              name: 'task duration',
              ok: true,
              detail: labelOf(t2) + ' -> ' + (a.duration || 0) + 'd'
            });
            applied++;
          } else if (a.op === 'setTaskStatus') {
            var t3 = findBy(tasks, 'id', a.taskId);
            if (!t3) {
              report.push({
                name: 'task status',
                ok: false,
                detail: 'task not found: ' + a.taskId
              });
              return;
            }
            t3.status = String(a.status || 'not-started');
            report.push({
              name: 'task status',
              ok: true,
              detail: labelOf(t3) + ' -> ' + (a.status || 'not-started')
            });
            applied++;
          } else if (a.op === 'setBudgetLinePlanned') {
            var l = findBy(lines, 'id', a.lineId);
            if (!l) {
              report.push({
                name: 'budget line',
                ok: false,
                detail: 'line not found: ' + a.lineId
              });
              return;
            }
            l.planned = Number(a.planned) || 0;
            report.push({
              name: 'budget line',
              ok: true,
              detail: (l.label || l.name || a.lineId) + ' -> ' + l.planned
            });
            applied++;
          } else if (a.op === 'addRisk') {
            var r = {
              id: 'ai-' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8),
              title: String(a.title || 'Risk from assistant'),
              category: a.category || 'schedule',
              likelihood: a.likelihood || 'medium',
              impact: a.impact || 'medium',
              description: String(a.description || ''),
              source: 'ai'
            };
            risks.push(r);
            report.push({ name: 'risk', ok: true, detail: r.title });
            applied++;
          } else if (a.op === 'addDecision') {
            var d = {
              id: 'ai-' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8),
              title: String(a.title || 'Decision from assistant'),
              body: String(a.body || ''),
              date: new Date().toISOString().slice(0, 10),
              source: 'ai'
            };
            decisions.push(d);
            report.push({ name: 'decision', ok: true, detail: d.title });
            applied++;
          } else {
            report.push({ name: opLabel(a.op), ok: false, detail: 'unsupported' });
          }
        } catch (e) {
          report.push({ name: opLabel(a.op), ok: false, detail: 'could not apply' });
        }
      });
      // H-6-style guard: a write while an approval preview is active must never
      // land on the real project. pushUndo already ran, but updateState refuses
      // in that state, so nothing here is persisted; report it honestly.
      if (S.isPreview && S.isPreview()) {
        report.unshift({
          name: 'guard',
          ok: false,
          detail: 'an approval preview is open - nothing changed'
        });
      }
    });
    // One changelog line so the audit trail shows what the assistant did.
    try {
      if (typeof ns.Changelog === 'object' && ns.Changelog.add) {
        ns.Changelog.add({
          type: 'ai',
          text:
            'AI assistant applied ' +
            applied +
            ' action' +
            (applied === 1 ? '' : 's') +
            ' to this project.'
        });
      }
    } catch (e) {
      /* changelog is best-effort */
    }
    return { ok: applied > 0, applied: applied, report: report };
  }

  function findBy(arr, key, val) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i][key] === val) {
        return arr[i];
      }
    }
    return null;
  }
  function labelOf(t) {
    return t.label || t.name || t.title || t.id || 'task';
  }

  // Build a preview table (DOM nodes, textContent only) the chat can show before
  // the person clicks Apply.
  function buildPreview(actions) {
    var wrap = document.createElement('div');
    wrap.className = 'ai-actions-preview';
    var title = document.createElement('p');
    title.className = 'ai-actions-preview-title';
    title.textContent = 'The assistant can make these changes. Review, then Apply:';
    wrap.appendChild(title);
    var table = document.createElement('table');
    table.className = 'ai-actions-table';
    var thead = document.createElement('thead');
    thead.innerHTML = '';
    var htr = document.createElement('tr');
    ['Action', 'Detail'].forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    actions.forEach(function (a) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td');
      td1.textContent = opLabel(a && a.op);
      var td2 = document.createElement('td');
      td2.textContent = detailFor(a);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function detailFor(a) {
    if (!a || !a.op) {
      return '';
    }
    switch (a.op) {
      case 'setTaskDates':
        return (a.taskId || '') + ': ' + (a.startDate || '') + ' to ' + (a.endDate || '');
      case 'setTaskDuration':
        return (a.taskId || '') + ': ' + (a.duration || 0) + 'd';
      case 'setTaskStatus':
        return (a.taskId || '') + ': ' + (a.status || '');
      case 'setBudgetLinePlanned':
        return (a.lineId || '') + ': ' + (a.planned || 0);
      case 'addRisk':
        return a.title || 'risk';
      case 'addDecision':
        return a.title || 'decision';
      default:
        return '';
    }
  }

  ns.AiActions = {
    ALLOWED: ALLOWED,
    isComplex: isComplex,
    parseActions: parseActions,
    validateOp: validateOp,
    apply: apply,
    buildPreview: buildPreview,
    opLabel: opLabel
  };
})(window.MMGR);
