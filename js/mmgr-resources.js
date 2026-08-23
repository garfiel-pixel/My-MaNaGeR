/* ============================================================
   My MaNaGeR , Resource & Budget Management Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;

  // ---- Resources ----
  function addResource() {
    ns.State.updateState(function(s) {
      if (!s.resources) s.resources = [];
      s.resources.push({
        id: U.genShortId('R'), name: '', type: 'Labor', role: '',
        availability: 100, rate: 0, hoursAllocated: 0, utilization: 0
      });
    });
    R.renderResources();
  }

  function updResource(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.resources && s.resources[index]) {
        s.resources[index][field] = (field === 'availability' || field === 'rate' || field === 'hoursAllocated')
          ? parseFloat(value) || 0 : value;
      }
    });
    // Focus discipline: save on keystroke, re-render on blur/commit (see
    // app.js 'updTaskField'). Re-rendering on `input` drops the caret.
    if (evtType === 'input') return;
    R.renderResources();
  }

  function delResource(index) {
    let removedId = null;
    ns.State.updateState(function(s) {
      if (s.resources && s.resources[index]) {
        removedId = s.resources[index].id;
        s.resources.splice(index, 1);
      }
    });
    // Keep the RACI matrix consistent: drop the deleted resource's column.
    if (removedId != null && ns.Raci && ns.Raci.pruneDeleted) ns.Raci.pruneDeleted({ personIds: [removedId] });
    R.renderResources();
  }

  // ---- Utilization math (MONOLITH-PORTING-GUIDE feature 6) ----
  // Capacity = availability % × monthly hours for the configured work week
  // (workWeek × 4 weeks × 8 h/day). Utilization = allocated hours / capacity.
  function workWeekDays() {
    const s = ns.State ? ns.State.getState() : null;
    return +(s && s.workWeek) || 5;
  }

  function monthlyHours() {
    return workWeekDays() * 4 * 8;
  }

  function resUtil(r) {
    const cap = ((+r.availability || 0) / 100) * monthlyHours();
    return cap ? Math.round(((+r.hoursAllocated || 0) / cap) * 100) : 0;
  }

  function pushResourcesToBudget() {
    ns.State.updateState(function(s) {
      const resources = s.resources || [];
      if (!s.budgetLines) s.budgetLines = [];
      for (const r of resources) {
        const cost = (r.rate || 0) * (r.hoursAllocated || 0);
        if (cost > 0) {
          s.budgetLines.push({
            id: U.genShortId('B'), category: r.name + ' (' + (r.type || 'Resource') + ')',
            planned: cost, actual: 0, notes: 'Auto-generated from resources',
            taskId: '', curve: 'linear'
          });
        }
      }
    });
    R.renderBudget();
    ns.App.showToast('Resources pushed to budget.', 'ok');
  }

  // ---- Budget ----
  function addBudgetLine() {
    ns.State.updateState(function(s) {
      if (!s.budgetLines) s.budgetLines = [];
      s.budgetLines.push({
        id: U.genShortId('B'), category: '', planned: 0, actual: 0,
        notes: '', taskId: '', curve: 'linear',
        // MARKET-FEATURE-ROADMAP A2: lien-waiver status tracking , US-convention
        // labels per the roadmap (Jamaica legal verification is B7, still open).
        waiverStatus: 'pending', waiverReceivedAt: '',
        // MARKET-FEATURE-ROADMAP C12: committed-but-not-spent bucket. Null =
        // unset (falls back to planned, preserving pre-C12 behavior); set 0
        // for a planning-stage line that isn't a contractual commitment yet.
        committed: null
      });
    });
    R.renderBudget();
  }

  function updBudgetLine(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.budgetLines && s.budgetLines[index]) {
        s.budgetLines[index][field] = (field === 'planned' || field === 'actual' || field === 'committed')
          ? parseFloat(value) || 0 : value;
      }
    });
    // Focus discipline: save on keystroke, re-render on blur/commit.
    if (evtType === 'input') return;
    R.renderBudget();
  }

  function delBudgetLine(index) {
    ns.State.updateState(function(s) {
      if (s.budgetLines) s.budgetLines.splice(index, 1);
    });
    R.renderBudget();
  }

  function updEnvelope(value, evtType) {
    ns.State.updateState(function(s) {
      s.budgetEnvelope = parseFloat(value) || 0;
    });
    // Focus discipline: save on keystroke, re-render on blur/commit.
    if (evtType === 'input') return;
    R.renderBudget();
  }

  // ---- Spend Log + Cash-Flow S-Curve (MONOLITH-PORTING-GUIDE feature 2) ----
  // Ported pure math over budgetLines + spendLog. All functions take state
  // (or the specific arrays) as parameters , they never touch a live object.

  // Fraction of a spend window elapsed, shaped by the line's curve.
  // Shapes (monolith semantics): 'scurve' slow-fast-slow, 'front' heavy
  // early spend, 'back' heavy late spend, default linear. Accepts the
  // older UI labels ('bell'→scurve, 'front-loaded'→front, 'back-loaded'→back).
  function curveFraction(t, shape) {
    t = Math.max(0, Math.min(1, t));
    const s = shape === 'bell' ? 'scurve' : shape === 'front-loaded' ? 'front' : shape === 'back-loaded' ? 'back' : shape;
    switch (s) {
      case 'scurve': return t * t * (3 - 2 * t);
      case 'front': return 1 - Math.pow(1 - t, 2);
      case 'back': return t * t;
      default: return t;
    }
  }

  // A budget line's spend window: its linked task's dates if set, otherwise
  // the whole project's span (earliest task start to latest task end).
  function budgetLineWindow(line, state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s) return null;
    const linkId = line.linkedTaskId || line.taskId || null;
    if (linkId) {
      const t = (s.tasks || []).find(x => String(x.id) === String(linkId));
      if (t && t.startDate && t.endDate) return { start: U.parseDL(t.startDate), end: U.parseDL(t.endDate) };
    }
    const dated = (s.tasks || []).filter(t => t.startDate && t.endDate);
    if (!dated.length) return null;
    const starts = dated.map(t => U.parseDL(t.startDate).getTime());
    const ends = dated.map(t => U.parseDL(t.endDate).getTime());
    return { start: new Date(Math.min.apply(null, starts)), end: new Date(Math.max.apply(null, ends)) };
  }

  // Cumulative PLANNED $ for one line, as of a date. Falls back to the same
  // task-count proxy the original EVM formula used when no schedule exists.
  function lineCumulativeAt(line, asOf, state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    const planned = +line.planned || 0;
    const w = budgetLineWindow(line, s);
    if (!w) {
      const tasks = (s && s.tasks) || [];
      const tot = tasks.length;
      const dn = tasks.filter(t => t.status === 'completed').length;
      return planned * (tot ? dn / tot : 0);
    }
    const span = w.end - w.start;
    if (asOf <= w.start) return 0;
    if (asOf >= w.end || span <= 0) return planned;
    return planned * curveFraction((asOf - w.start) / span, line.curveShape || line.curve || 'linear');
  }

  function budgetCumulativePlannedAt(asOf, state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    return ((s && s.budgetLines) || []).reduce((sum, l) => sum + lineCumulativeAt(l, asOf, s), 0);
  }

  // Cumulative ACTUAL $ as of a date. Uses the dated Spend Log if any
  // entries exist; otherwise approximates each line's lump "actual" as
  // accrued linearly from its window start to today (labeled as an estimate
  // wherever it's shown).
  function actualCumulativeAt(asOf, state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s) return 0;
    const log = s.spendLog || [];
    if (log.length) {
      return log.filter(e => e.date && U.parseDL(e.date) <= asOf).reduce((sum, e) => sum + (+e.amount || 0), 0);
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const q = asOf > today ? today : asOf;
    return (s.budgetLines || []).reduce((sum, l) => {
      const actual = +l.actual || 0;
      const w = budgetLineWindow(l, s);
      if (!w || actual <= 0 || q <= w.start) return sum;
      const denom = Math.max(1, Math.min(today, w.end) - w.start);
      return sum + actual * Math.min(1, (q - w.start) / denom);
    }, 0);
  }

  // A budget line's actual $ is auto-derived from its own Spend Log entries
  // once any exist (single source of truth, no drift risk between the two);
  // otherwise the manually-typed lump value is used.
  function budgetLineActual(line, state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    const log = ((s && s.spendLog) || []).filter(e => e.budgetLineId === line.id);
    if (log.length) return log.reduce((sum, e) => sum + (+e.amount || 0), 0);
    return +line.actual || 0;
  }

  function addSpendEntry() {
    const s = ns.State.getState();
    if (!(s.budgetLines || []).length) { ns.App.showToast('Add a budget line first.', 'err'); return; }
    ns.State.updateState(function(st) {
      if (!st.spendLog) st.spendLog = [];
      if (!st.nspid) st.nspid = 1;
      st.spendLog.push({
        id: 'S' + (st.nspid++),
        date: U.todayStr(),
        budgetLineId: st.budgetLines[0].id,
        amount: 0,
        notes: ''
      });
    });
    R.renderBudget();
  }

  function delSpendEntry(index) {
    ns.State.updateState(function(s) {
      if (s.spendLog) s.spendLog.splice(index, 1);
    });
    R.renderBudget();
  }

  function updSpendEntry(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      const e = s.spendLog && s.spendLog[index];
      if (!e) return;
      e[field] = field === 'amount' ? (parseFloat(value) || 0) : (field === 'budgetLineId' ? value : value);
    });
    // Focus discipline: save on keystroke, re-render on blur/commit.
    if (evtType === 'input') return;
    // Date-commit discipline (same class as the WBS date bug): the native
    // date picker is anchored to the focused input. Rebuilding the Budget
    // panel on a spend-date commit destroys that input mid-interaction. The
    // date value is already saved; nothing else on the Budget panel derives
    // from it, so skip the rebuild on date commits.
    if (field === 'date') return;
    R.renderBudget();
  }

  // ---- Pay Applications (MARKET-FEATURE-ROADMAP C13) ----
  // Draw-request register: a generated draft carries the live spend figure
  // (sum of budget-line actuals, the same source the Budget panel shows) so
  // the amount is never hand-typed twice. Zero third-party , plain records.
  function currentPeriodLabel() {
    const d = new Date();
    const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return m + ' ' + d.getFullYear();
  }

  function liveSpendTotal() {
    const s = ns.State ? ns.State.getState() : null;
    const lines = (s && s.budgetLines) || [];
    return lines.reduce((sum, l) => sum + budgetLineActual(l, s), 0);
  }

  function addPayApp(manual) {
    ns.State.updateState(function(s) {
      if (!s.payApps) s.payApps = [];
      const n = s.payApps.length + 1;
      const amount = manual ? 0 : Math.round(liveSpendTotal());
      s.payApps.push({
        id: U.genShortId('PA'), number: 'PA-' + n, period: currentPeriodLabel(),
        amount: amount, status: 'draft', dateSubmitted: '', dateApproved: '', notes: ''
      });
    });
    R.renderBudget();
    if (!manual) ns.App.showToast('Pay application draft generated from live spend.', 'ok');
  }

  function genPayApp() { addPayApp(false); }

  function updPayApp(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.payApps && s.payApps[index]) {
        s.payApps[index][field] = field === 'amount' ? (parseFloat(value) || 0) : value;
      }
    });
    if (evtType === 'input') return;
    R.renderBudget();
  }

  function delPayApp(index) {
    ns.State.updateState(function(s) {
      if (s.payApps) s.payApps.splice(index, 1);
    });
    R.renderBudget();
  }

  // ---- API ----
  ns.Resources = {
    addResource: addResource,
    updResource: updResource,
    delResource: delResource,
    pushResourcesToBudget: pushResourcesToBudget,
    resUtil: resUtil,
    workWeekDays: workWeekDays,
    monthlyHours: monthlyHours
  };

  ns.Budget = {
    addBudgetLine: addBudgetLine,
    updBudgetLine: updBudgetLine,
    delBudgetLine: delBudgetLine,
    updEnvelope: updEnvelope
  };

  ns.PayApps = {
    addPayApp: addPayApp,
    genPayApp: genPayApp,
    updPayApp: updPayApp,
    delPayApp: delPayApp,
    currentPeriodLabel: currentPeriodLabel,
    liveSpendTotal: liveSpendTotal
  };

  ns.Spend = {
    curveFraction: curveFraction,
    budgetLineWindow: budgetLineWindow,
    lineCumulativeAt: lineCumulativeAt,
    budgetCumulativePlannedAt: budgetCumulativePlannedAt,
    actualCumulativeAt: actualCumulativeAt,
    budgetLineActual: budgetLineActual,
    addSpendEntry: addSpendEntry,
    delSpendEntry: delSpendEntry,
    updSpendEntry: updSpendEntry
  };

})(MMGR);
window.MMGR = MMGR;