/* ============================================================
   My MaNaGeR , Resource & Budget Management Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;

  // ---- Resources ----
  function addResource() {
    ns.State.updateState(function (s) {
      if (!s.resources) {
        s.resources = [];
      }
      s.resources.push({
        id: U.genShortId('R'),
        name: '',
        type: 'Labor',
        role: '',
        availability: 100,
        rate: 0,
        hoursAllocated: 0,
        utilization: 0
      });
    });
    R.renderResources();
  }

  function updResource(index, field, value, evtType) {
    ns.State.updateState(function (s) {
      if (s.resources && s.resources[index]) {
        s.resources[index][field] =
          field === 'availability' || field === 'rate' || field === 'hoursAllocated'
            ? parseFloat(value) || 0
            : value;
      }
    });
    // Focus discipline: save on keystroke, re-render on blur/commit (see
    // app.js 'updTaskField'). Re-rendering on `input` drops the caret.
    if (evtType === 'input') {
      return;
    }
    R.renderResources();
  }

  function delResource(index) {
    let removedId = null;
    ns.State.updateState(function (s) {
      if (s.resources && s.resources[index]) {
        removedId = s.resources[index].id;
        s.resources.splice(index, 1);
      }
    });
    // Keep the RACI matrix consistent: drop the deleted resource's column.
    if (removedId != null && ns.Raci && ns.Raci.pruneDeleted) {
      ns.Raci.pruneDeleted({ personIds: [removedId] });
    }
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
    // Availability defaults to 100 when absent (the same default every other
    // resource path uses - addResource/import both write availability:100).
    // Treating a missing field as 0% availability zeroed every legacy/demo
    // resource's utilization to 0 (2026-09-05).
    const cap = ((+r.availability || 100) / 100) * monthlyHours();
    return cap ? Math.round(((+r.hoursAllocated || 0) / cap) * 100) : 0;
  }

  function pushResourcesToBudget() {
    ns.State.updateState(function (s) {
      const resources = s.resources || [];
      if (!s.budgetLines) {
        s.budgetLines = [];
      }
      for (const r of resources) {
        const cost = (r.rate || 0) * (r.hoursAllocated || 0);
        if (cost > 0) {
          s.budgetLines.push({
            id: U.genShortId('B'),
            category: r.name + ' (' + (r.type || 'Resource') + ')',
            planned: cost,
            actual: 0,
            notes: 'Auto-generated from resources',
            taskId: '',
            curve: 'linear'
          });
        }
      }
    });
    R.renderBudget();
    ns.App.showToast('Resources pushed to budget.', 'ok');
  }

  // ---- Budget ----
  function addBudgetLine() {
    ns.State.updateState(function (s) {
      if (!s.budgetLines) {
        s.budgetLines = [];
      }
      s.budgetLines.push({
        id: U.genShortId('B'),
        category: '',
        planned: 0,
        actual: 0,
        notes: '',
        taskId: '',
        curve: 'linear',
        // MARKET-FEATURE-ROADMAP A2: lien-waiver status tracking , US-convention
        // labels per the roadmap (Jamaica legal verification is B7, still open).
        waiverStatus: 'pending',
        waiverReceivedAt: '',
        // MARKET-FEATURE-ROADMAP C12: committed-but-not-spent bucket. Null =
        // unset (falls back to planned, preserving pre-C12 behavior); set 0
        // for a planning-stage line that isn't a contractual commitment yet.
        committed: null
      });
    });
    R.renderBudget();
  }

  function updBudgetLine(index, field, value, evtType) {
    ns.State.updateState(function (s) {
      if (s.budgetLines && s.budgetLines[index]) {
        s.budgetLines[index][field] =
          field === 'planned' || field === 'actual' || field === 'committed'
            ? parseFloat(value) || 0
            : value;
      }
    });
    // Focus discipline: save on keystroke, re-render on blur/commit.
    if (evtType === 'input') {
      return;
    }
    R.renderBudget();
  }

  function delBudgetLine(index) {
    ns.State.updateState(function (s) {
      if (s.budgetLines) {
        s.budgetLines.splice(index, 1);
      }
    });
    R.renderBudget();
  }

  function updEnvelope(value, evtType) {
    ns.State.updateState(function (s) {
      s.budgetEnvelope = parseFloat(value) || 0;
    });
    // Focus discipline: save on keystroke, re-render on blur/commit.
    if (evtType === 'input') {
      return;
    }
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
    const s =
      shape === 'bell'
        ? 'scurve'
        : shape === 'front-loaded'
          ? 'front'
          : shape === 'back-loaded'
            ? 'back'
            : shape;
    switch (s) {
      case 'scurve':
        return t * t * (3 - 2 * t);
      case 'front':
        return 1 - Math.pow(1 - t, 2);
      case 'back':
        return t * t;
      default:
        return t;
    }
  }

  // A budget line's spend window: its linked task's dates if set, otherwise
  // the whole project's span (earliest task start to latest task end).
  function budgetLineWindow(line, state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s) {
      return null;
    }
    const linkId = line.linkedTaskId || line.taskId || null;
    if (linkId) {
      const t = (s.tasks || []).find(x => String(x.id) === String(linkId));
      if (t && t.startDate && t.endDate) {
        return { start: U.parseDL(t.startDate), end: U.parseDL(t.endDate) };
      }
    }
    const dated = (s.tasks || []).filter(t => t.startDate && t.endDate);
    if (!dated.length) {
      return null;
    }
    const starts = dated.map(t => U.parseDL(t.startDate).getTime());
    const ends = dated.map(t => U.parseDL(t.endDate).getTime());
    return {
      start: new Date(Math.min.apply(null, starts)),
      end: new Date(Math.max.apply(null, ends))
    };
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
    if (asOf <= w.start) {
      return 0;
    }
    if (asOf >= w.end || span <= 0) {
      return planned;
    }
    return (
      planned * curveFraction((asOf - w.start) / span, line.curveShape || line.curve || 'linear')
    );
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
    if (!s) {
      return 0;
    }
    const log = s.spendLog || [];
    if (log.length) {
      return log
        .filter(e => e.date && U.parseDL(e.date) <= asOf)
        .reduce((sum, e) => sum + (+e.amount || 0), 0);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const q = asOf > today ? today : asOf;
    return (s.budgetLines || []).reduce((sum, l) => {
      const actual = +l.actual || 0;
      const w = budgetLineWindow(l, s);
      if (!w || actual <= 0 || q <= w.start) {
        return sum;
      }
      const denom = Math.max(1, Math.min(today, w.end) - w.start);
      return sum + actual * Math.min(1, (q - w.start) / denom);
    }, 0);
  }

  // A budget line's actual $ is auto-derived from its own Spend Log entries
  // once any exist (single source of truth, no drift risk between the two);
  // otherwise the manually-typed lump value is used.
  //
  // H-3 (BUDGET-BOQ directive 2026-11-05): an entry recorded as ORDERED is a
  // commitment, not money out, so it does not count as Spent (Q1). Every
  // other status - and a legacy entry with no status at all - does.
  function spendIsSpent(e) {
    const st = (e && e.status) || 'received';
    return st !== 'ordered';
  }
  function spendIsPaid(e) {
    return ((e && e.status) || 'received') === 'paid';
  }
  function budgetLineActual(line, state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    const log = ((s && s.spendLog) || []).filter(
      e => e.budgetLineId === line.id && spendIsSpent(e)
    );
    if (log.length) {
      return log.reduce((sum, e) => sum + (+e.amount || 0), 0);
    }
    return +line.actual || 0;
  }

  // H-3: what a line's deliveries add up to, so an overspend can be read as
  // PRICE or as QUANTITY instead of one unexplained number.
  //   qtyReceived  units recorded as received (ordered ones excluded)
  //   qtyLeft      the BOQ quantity minus what arrived
  //   moneyLeft    planned minus spent
  //   priceVar     (price paid - BOQ rate) x quantity, summed
  //   qtyVar       planned - (BOQ rate x quantity received), the quantity part
  function deliveryRollup(line, state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    const log = ((s && s.spendLog) || []).filter(e => e.budgetLineId === line.id);
    const baseQty = line.qty == null ? null : +line.qty || 0;
    const baseRate = line.rate == null ? null : +line.rate || 0;
    let qty = 0;
    let spent = 0;
    let paid = 0;
    let priceVar = 0;
    let anyQty = false;
    log.forEach(e => {
      if (!spendIsSpent(e)) {
        return;
      }
      spent += +e.amount || 0;
      if (spendIsPaid(e)) {
        paid += +e.amount || 0;
      }
      if (e.qty != null && e.unitPrice != null) {
        anyQty = true;
        const q = +e.qty || 0;
        qty += q;
        priceVar += (Math.round((+e.unitPrice || 0) * 1e6) / 1e6 - (baseRate || 0)) * q;
      }
    });
    const planned = +line.planned || 0;
    return {
      hasQty: anyQty && baseQty != null,
      qtyReceived: qty,
      qtyLeft: baseQty == null ? null : Math.max(0, baseQty - qty),
      qtyPct: baseQty ? Math.round((qty / baseQty) * 100) : 0,
      moneyLeft: planned - spent,
      planned: planned,
      spent: spent,
      paid: paid,
      owed: Math.max(0, spent - paid),
      priceVar: priceVar,
      qtyVar: baseQty == null || baseRate == null ? null : planned - baseRate * qty
    };
  }

  function addSpendEntry() {
    const s = ns.State.getState();
    if (!(s.budgetLines || []).length) {
      ns.App.showToast('Add a budget line first.', 'err');
      return;
    }
    ns.State.updateState(function (st) {
      if (!st.spendLog) {
        st.spendLog = [];
      }
      if (!st.nspid) {
        st.nspid = 1;
      }
      st.spendLog.push({
        id: 'S' + st.nspid++,
        date: U.todayStr(),
        budgetLineId: st.budgetLines[0].id,
        amount: 0,
        notes: ''
      });
    });
    R.renderBudget();
  }

  function delSpendEntry(index) {
    ns.State.updateState(function (s) {
      if (s.spendLog) {
        s.spendLog.splice(index, 1);
      }
    });
    R.renderBudget();
  }

  function updSpendEntry(index, field, value, evtType) {
    ns.State.updateState(function (s) {
      const e = s.spendLog && s.spendLog[index];
      if (!e) {
        return;
      }
      e[field] =
        field === 'amount' ? parseFloat(value) || 0 : field === 'budgetLineId' ? value : value;
    });
    // Focus discipline: save on keystroke, re-render on blur/commit.
    if (evtType === 'input') {
      return;
    }
    // Date-commit discipline (same class as the WBS date bug): the native
    // date picker is anchored to the focused input. Rebuilding the Budget
    // panel on a spend-date commit destroys that input mid-interaction. The
    // date value is already saved; nothing else on the Budget panel derives
    // from it, so skip the rebuild on date commits.
    if (field === 'date') {
      return;
    }
    R.renderBudget();
  }

  // ---- Pay Applications (MARKET-FEATURE-ROADMAP C13) ----
  // Draw-request register: a generated draft carries the live spend figure
  // (sum of budget-line actuals, the same source the Budget panel shows) so
  // the amount is never hand-typed twice. Zero third-party , plain records.
  function currentPeriodLabel() {
    const d = new Date();
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
      d.getMonth()
    ];
    return m + ' ' + d.getFullYear();
  }

  function liveSpendTotal() {
    const s = ns.State ? ns.State.getState() : null;
    const lines = (s && s.budgetLines) || [];
    return lines.reduce((sum, l) => sum + budgetLineActual(l, s), 0);
  }

  function addPayApp(manual) {
    ns.State.updateState(function (s) {
      if (!s.payApps) {
        s.payApps = [];
      }
      const n = s.payApps.length + 1;
      const amount = manual ? 0 : Math.round(liveSpendTotal());
      s.payApps.push({
        id: U.genShortId('PA'),
        number: 'PA-' + n,
        period: currentPeriodLabel(),
        amount: amount,
        status: 'draft',
        dateSubmitted: '',
        dateApproved: '',
        notes: ''
      });
    });
    R.renderBudget();
    if (!manual) {
      ns.App.showToast('Pay application draft generated from live spend.', 'ok');
    }
  }

  function genPayApp() {
    addPayApp(false);
  }

  function updPayApp(index, field, value, evtType) {
    ns.State.updateState(function (s) {
      if (s.payApps && s.payApps[index]) {
        s.payApps[index][field] = field === 'amount' ? parseFloat(value) || 0 : value;
      }
    });
    if (evtType === 'input') {
      return;
    }
    R.renderBudget();
  }

  function delPayApp(index) {
    ns.State.updateState(function (s) {
      if (s.payApps) {
        s.payApps.splice(index, 1);
      }
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

  // ---- Time Tracking (MARKET-FEATURE-ROADMAP C27) ----
  // Per-task hours log for field crew.
  function addTimeEntry() {
    ns.State.updateState(function (s) {
      if (!s.timeEntries) {
        s.timeEntries = [];
      }
      s.timeEntries.push({
        id: U.genShortId('TE'),
        task: '',
        resource: '',
        date: '',
        hours: '',
        notes: ''
      });
    });
    R.renderResources();
  }

  function updTimeEntry(index, field, value, evtType) {
    ns.State.updateState(function (s) {
      if (s.timeEntries && s.timeEntries[index]) {
        s.timeEntries[index][field] = field === 'hours' ? parseFloat(value) || 0 : value;
      }
    });
    if (evtType === 'input') {
      return;
    }
    R.renderResources();
  }

  function delTimeEntry(index) {
    ns.State.updateState(function (s) {
      if (s.timeEntries) {
        s.timeEntries.splice(index, 1);
      }
    });
    R.renderResources();
  }

  ns.TimeTracking = {
    addTimeEntry: addTimeEntry,
    updTimeEntry: updTimeEntry,
    delTimeEntry: delTimeEntry
  };

  // ---- Equipment Log (MARKET-FEATURE-ROADMAP C28) ----
  // Equipment usage, maintenance, allocation.
  function addEquipment() {
    ns.State.updateState(function (s) {
      if (!s.equipment) {
        s.equipment = [];
      }
      s.equipment.push({
        id: U.genShortId('EQ'),
        name: '',
        type: '',
        status: 'active',
        ownership: 'owned',
        vendor: '',
        startDate: '',
        endDate: '',
        cost: '',
        maintenanceDate: '',
        notes: ''
      });
    });
    R.renderResources();
  }

  function updEquipment(index, field, value, evtType) {
    ns.State.updateState(function (s) {
      if (s.equipment && s.equipment[index]) {
        s.equipment[index][field] = value;
      }
    });
    if (evtType === 'input') {
      return;
    }
    R.renderResources();
  }

  function delEquipment(index) {
    ns.State.updateState(function (s) {
      if (s.equipment) {
        s.equipment.splice(index, 1);
      }
    });
    R.renderResources();
  }

  ns.Equipment = {
    addEquipment: addEquipment,
    updEquipment: updEquipment,
    delEquipment: delEquipment
  };

  ns.PayApps = {
    addPayApp: addPayApp,
    genPayApp: genPayApp,
    updPayApp: updPayApp,
    delPayApp: delPayApp,
    currentPeriodLabel: currentPeriodLabel,
    liveSpendTotal: liveSpendTotal
  };

  // ---- H-3 (BUDGET-BOQ directive 2026-11-05): RECORD A DELIVERY ----------
  // Extends the Spend Log entry; it does not replace it. An entry without the
  // new fields is a legacy entry and still counts exactly as it always did.
  // Quick path: pick the line (pre-picked from its row), type the quantity,
  // confirm the prefilled price, Save - three taps on a phone.
  let _dlv = { lineId: '', photo: '', override: false };

  function deliveryHost() {
    let el = document.getElementById('dlv-modal');
    if (el) {
      return el;
    }
    el = document.createElement('div');
    el.id = 'dlv-modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'dlv-title');
    el.innerHTML =
      '<div class="mb dlv-mb">' +
      '<div class="mh"><span class="mt" id="dlv-title">Record a delivery</span>' +
      '<button class="dc" data-action="deliveryClose" aria-label="Close"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button></div>' +
      '<div class="mbody">' +
      '<label class="dlv-l" for="dlv-line">Budget line</label>' +
      '<select id="dlv-line" class="dlv-in"></select>' +
      '<div class="dlv-row">' +
      '<div><label class="dlv-l" for="dlv-qty">Quantity received</label><input id="dlv-qty" class="dlv-in" type="number" min="0" step="any" inputmode="decimal"></div>' +
      '<div><label class="dlv-l" for="dlv-unit">Unit</label><input id="dlv-unit" class="dlv-in" type="text" maxlength="24"></div>' +
      '<div><label class="dlv-l" for="dlv-price">Price paid per unit</label><input id="dlv-price" class="dlv-in" type="number" min="0" step="any" inputmode="decimal"></div>' +
      '</div>' +
      '<div class="dlv-row">' +
      '<div><label class="dlv-l" for="dlv-amount">Amount</label><input id="dlv-amount" class="dlv-in" type="number" min="0" step="0.01" inputmode="decimal"></div>' +
      '<div><label class="dlv-l" for="dlv-status">Status</label><select id="dlv-status" class="dlv-in"><option value="received">Received</option><option value="ordered">Ordered (not spent yet)</option><option value="invoiced">Invoiced</option><option value="paid">Paid</option></select></div>' +
      '<div><label class="dlv-l" for="dlv-paid">Paid on</label><input id="dlv-paid" class="dlv-in" type="date"></div>' +
      '</div>' +
      '<div class="dlv-row">' +
      '<div><label class="dlv-l" for="dlv-supplier">Supplier</label><input id="dlv-supplier" class="dlv-in" type="text" maxlength="80"></div>' +
      '<div><label class="dlv-l" for="dlv-ref">Ticket or invoice</label><input id="dlv-ref" class="dlv-in" type="text" maxlength="40"></div>' +
      '<div><label class="dlv-l" for="dlv-date">Date</label><input id="dlv-date" class="dlv-in" type="date"></div>' +
      '</div>' +
      '<label class="dlv-l" for="dlv-note">Note</label>' +
      '<input id="dlv-note" class="dlv-in" type="text" maxlength="160">' +
      '<div class="dlv-override is-hide" id="dlv-override-wrap">' +
      '<label class="dlv-l" for="dlv-reason">Why does the amount differ from quantity x price?</label>' +
      '<input id="dlv-reason" class="dlv-in" type="text" maxlength="160">' +
      '</div>' +
      '<div class="dlv-row dlv-foot">' +
      '<div><label class="dlv-l" for="dlv-photo">Photo of the ticket</label><input id="dlv-photo" class="dlv-in dlv-file" type="file" accept="image/*"></div>' +
      '<div class="dlv-who"><span class="dlv-l">Recorded by</span><span id="dlv-who"></span></div>' +
      '</div>' +
      '<p class="dlv-err" id="dlv-err" role="alert"></p>' +
      '</div>' +
      '<div class="mf"><button class="btn btn-n btn-s" data-action="deliveryClose">Cancel</button>' +
      '<button class="btn btn-g btn-s" data-action="deliverySave">Save delivery</button></div>' +
      '</div>';
    document.body.appendChild(el);
    const lineSel = el.querySelector('#dlv-line');
    if (lineSel) {
      lineSel.addEventListener('change', function () {
        prefillDelivery(lineSel.value);
      });
    }
    ['dlv-qty', 'dlv-price'].forEach(function (id) {
      const inp = el.querySelector('#' + id);
      if (inp) {
        inp.addEventListener('input', function () {
          if (!_dlv.override) {
            recomputeDelivery();
          }
        });
      }
    });
    const amt = el.querySelector('#dlv-amount');
    if (amt) {
      amt.addEventListener('input', function () {
        _dlv.override = true;
        const wrap = el.querySelector('#dlv-override-wrap');
        if (wrap) {
          wrap.classList.remove('is-hide');
        }
      });
    }
    const photo = el.querySelector('#dlv-photo');
    if (photo) {
      photo.addEventListener('change', function () {
        readDeliveryPhoto(photo);
      });
    }
    return el;
  }

  function deliveryWho() {
    try {
      const u = ns.GoogleAuth && ns.GoogleAuth.getUser ? ns.GoogleAuth.getUser() : null;
      return (u && (u.email || u.name)) || 'Owner';
    } catch (e) {
      return 'Owner';
    }
  }

  // A ticket photo is evidence, not a gallery item: 900 px on the long edge,
  // JPEG, so one delivery adds tens of kilobytes to the project and still
  // syncs inside the normal state blob.
  function readDeliveryPhoto(input) {
    const file = input && input.files && input.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      const img = new Image();
      img.onload = function () {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        try {
          _dlv.photo = c.toDataURL('image/jpeg', 0.7);
        } catch (e) {
          _dlv.photo = '';
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function prefillDelivery(lineId) {
    const s = ns.State.getState();
    const line = (s.budgetLines || []).find(l => l.id === lineId);
    if (!line) {
      return;
    }
    _dlv.lineId = lineId;
    const q = document.getElementById('dlv-qty');
    const u = document.getElementById('dlv-unit');
    const p = document.getElementById('dlv-price');
    if (u) {
      u.value = line.unit || '';
    }
    if (p) {
      p.value = line.rate == null || line.rate === '' ? '' : String(line.rate);
    }
    if (q) {
      q.value = '';
    }
    recomputeDelivery();
  }

  function recomputeDelivery() {
    const q = parseFloat((document.getElementById('dlv-qty') || {}).value);
    const p = parseFloat((document.getElementById('dlv-price') || {}).value);
    const a = document.getElementById('dlv-amount');
    if (a && isFinite(q) && isFinite(p) && q > 0 && p >= 0) {
      a.value = String(Math.round(q * p * 100) / 100);
    }
  }

  function openDelivery(lineId) {
    const s = ns.State.getState();
    const lines = s.budgetLines || [];
    if (!lines.length) {
      ns.App.showToast('Add a budget line first.', 'err');
      return;
    }
    const el = deliveryHost();
    const sel = document.getElementById('dlv-line');
    if (sel) {
      sel.innerHTML = lines
        .map(function (l) {
          return (
            '<option value="' +
            U.escapeHtml(l.id) +
            '">' +
            U.escapeHtml(l.category || l.id) +
            '</option>'
          );
        })
        .join('');
      sel.value = lineId || lines[0].id;
    }
    _dlv.photo = '';
    _dlv.override = false;
    const wrap = document.getElementById('dlv-override-wrap');
    if (wrap) {
      wrap.classList.add('is-hide');
    }
    ['dlv-supplier', 'dlv-ref', 'dlv-note', 'dlv-reason'].forEach(function (id) {
      const inp = document.getElementById(id);
      if (inp) {
        inp.value = '';
      }
    });
    const date = document.getElementById('dlv-date');
    if (date) {
      date.value = U.todayStr();
    }
    const paid = document.getElementById('dlv-paid');
    if (paid) {
      paid.value = '';
    }
    const st = document.getElementById('dlv-status');
    if (st) {
      st.value = 'received';
    }
    const whoEl = document.getElementById('dlv-who');
    if (whoEl) {
      whoEl.textContent = deliveryWho();
    }
    const err = document.getElementById('dlv-err');
    if (err) {
      err.textContent = '';
    }
    prefillDelivery(sel ? sel.value : lines[0].id);
    el.classList.add('on');
    const q = document.getElementById('dlv-qty');
    if (q) {
      q.focus();
    }
  }

  function closeDelivery() {
    const el = document.getElementById('dlv-modal');
    if (el) {
      el.classList.remove('on');
    }
  }

  function saveDelivery() {
    const s = ns.State.getState();
    const err = document.getElementById('dlv-err');
    const say = function (msg) {
      if (err) {
        err.textContent = msg;
      }
    };
    const lineId = (document.getElementById('dlv-line') || {}).value || '';
    const line = (s.budgetLines || []).find(l => l.id === lineId);
    if (!line) {
      say('Pick the budget line this delivery belongs to.');
      return;
    }
    const qtyRaw = (document.getElementById('dlv-qty') || {}).value;
    const priceRaw = (document.getElementById('dlv-price') || {}).value;
    const qty = qtyRaw === '' || qtyRaw == null ? null : parseFloat(qtyRaw);
    const price = priceRaw === '' || priceRaw == null ? null : parseFloat(priceRaw);
    const amount = parseFloat((document.getElementById('dlv-amount') || {}).value);
    if (!isFinite(amount) || amount <= 0) {
      say('The amount has to be more than zero.');
      return;
    }
    if (qty != null && (!isFinite(qty) || qty <= 0)) {
      say('The quantity has to be more than zero.');
      return;
    }
    if (price != null && (!isFinite(price) || price < 0)) {
      say('The price has to be zero or more.');
      return;
    }
    const computed = qty != null && price != null ? Math.round(qty * price * 100) / 100 : null;
    const reason = ((document.getElementById('dlv-reason') || {}).value || '').trim();
    if (computed != null && Math.abs(computed - amount) > 0.005 && !reason) {
      say('The amount differs from quantity x price. Say why in the box above.');
      const box = document.getElementById('dlv-reason');
      if (box) {
        box.focus();
      }
      return;
    }
    const status = (document.getElementById('dlv-status') || {}).value || 'received';
    const paidDate = (document.getElementById('dlv-paid') || {}).value || '';
    if (status === 'paid' && !paidDate) {
      say('A paid delivery needs the date it was paid.');
      return;
    }
    const entry = {
      date: (document.getElementById('dlv-date') || {}).value || U.todayStr(),
      budgetLineId: lineId,
      amount: Math.round(amount * 100) / 100,
      notes: ((document.getElementById('dlv-note') || {}).value || '').trim(),
      status: status,
      paidDate: paidDate,
      by: deliveryWho()
    };
    if (qty != null) {
      entry.qty = qty;
      entry.unit =
        ((document.getElementById('dlv-unit') || {}).value || '').trim() || line.unit || '';
    }
    if (price != null) {
      entry.unitPrice = price;
    }
    if (computed != null) {
      entry.computedAmount = computed;
    }
    if (reason) {
      entry.overrideReason = reason;
    }
    const supplier = ((document.getElementById('dlv-supplier') || {}).value || '').trim();
    if (supplier) {
      entry.supplier = supplier;
    }
    const ref = ((document.getElementById('dlv-ref') || {}).value || '').trim();
    if (ref) {
      entry.ref = ref;
    }
    if (_dlv.photo) {
      entry.photo = _dlv.photo;
    }
    ns.State.updateState(function (st) {
      if (!st.spendLog) {
        st.spendLog = [];
      }
      if (!st.nspid) {
        st.nspid = 1;
      }
      entry.id = 'S' + st.nspid++;
      st.spendLog.push(entry);
    });
    closeDelivery();
    R.renderBudget();
    ns.App.showToast('Delivery recorded against ' + (line.category || line.id) + '.', 'ok');
  }

  // The per-line quantity and price picture, under the Spend Log. Only lines
  // that carry a quantity or have deliveries appear - a manual line has
  // nothing to say here.
  function renderDeliveries() {
    const body = document.getElementById('bud-deliveries');
    const wrap = document.getElementById('bud-deliveries-wrap');
    if (!body || !wrap) {
      return;
    }
    const s = ns.State.getState();
    const cur = s.currency || 'USD';
    const fmt = n => (U.fmtMoney ? U.fmtMoney(n, cur) : '$' + Math.round(+n || 0).toLocaleString()); // ok: fixed currency table + digits only
    const rows = (s.budgetLines || [])
      .map(l => ({ l: l, r: deliveryRollup(l, s) }))
      .filter(x => x.r.hasQty || x.r.spent > 0);
    if (!rows.length) {
      wrap.classList.add('is-hide');
      body.innerHTML = '';
      return;
    }
    wrap.classList.remove('is-hide');
    body.innerHTML = rows
      .map(function (x) {
        const l = x.l;
        const r = x.r;
        const priceCls = r.priceVar > 0.005 ? 'var-neg' : r.priceVar < -0.005 ? 'var-pos' : '';
        const qtyTxt = r.hasQty
          ? U.escapeHtml(r.qtyReceived) +
            ' of ' +
            U.escapeHtml(l.qty) +
            ' ' +
            U.escapeHtml(l.unit || '')
          : '-';
        return (
          '<tr>' +
          '<td>' +
          U.escapeHtml(l.category || l.id) +
          '</td>' +
          '<td>' +
          qtyTxt +
          '</td>' +
          '<td>' +
          (r.hasQty ? U.escapeHtml(r.qtyLeft) + ' ' + U.escapeHtml(l.unit || '') : '-') +
          '</td>' +
          '<td>' +
          fmt(r.moneyLeft) +
          '</td>' +
          '<td class="' +
          priceCls +
          '">' +
          (r.hasQty ? (r.priceVar >= 0 ? '+' : '') + fmt(r.priceVar) : '-') +
          '</td>' +
          '<td>' +
          (r.qtyVar == null ? '-' : (r.qtyVar >= 0 ? '+' : '') + fmt(r.qtyVar)) +
          '</td>' +
          '<td>' +
          fmt(r.spent) +
          (r.owed > 0.005 ? '<span class="dlv-owed">' + fmt(r.owed) + ' owed</span>' : '') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  ns.Spend = {
    curveFraction: curveFraction,
    budgetLineWindow: budgetLineWindow,
    lineCumulativeAt: lineCumulativeAt,
    budgetCumulativePlannedAt: budgetCumulativePlannedAt,
    actualCumulativeAt: actualCumulativeAt,
    budgetLineActual: budgetLineActual,
    deliveryRollup: deliveryRollup,
    spendIsSpent: spendIsSpent,
    spendIsPaid: spendIsPaid,
    addSpendEntry: addSpendEntry,
    delSpendEntry: delSpendEntry,
    updSpendEntry: updSpendEntry,
    openDelivery: openDelivery,
    closeDelivery: closeDelivery,
    saveDelivery: saveDelivery,
    renderDeliveries: renderDeliveries
  };
})(MMGR);
window.MMGR = MMGR;
