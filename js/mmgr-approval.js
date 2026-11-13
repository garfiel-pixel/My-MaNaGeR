/* ============================================================
   My MaNaGeR , Approval preview (H-6)
   ============================================================
   BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05, task H-6.

   A proposal from an AI client (or an editor) opens here, full width,
   in three parts:

     1. A plain-words line per change, with a warning on a large change
        (Q5), and a flag on a duplicate, a negative value, a unit
        mismatch or a price above the BOQ rate.
     2. A LIVE rendering of the real Budget and Weekly panels, built
        from a THROWAWAY copy of the project state with the ticked
        changes applied. Changed cells get a gold edge, added rows a
        green edge. Nothing here is saved: State.setPreviewState makes
        every renderer read the copy, and State.updateState refuses to
        write while it is active.
     3. Editing before approval: every proposed value is a field. An
        edit recomputes the preview and the impact line at once. Each
        change has its own tick; a Reject needs a short reason that goes
        back to the AI client through get_proposal_status.

   A proposal whose "before" no longer matches the live line is STALE:
   the server refuses the accept with 409 and names both values, and
   this screen shows them and asks for a refresh.

   Exports: ns.Approval.
   ============================================================ */
var MMGR = window.MMGR || {};
(function (ns) {
  'use strict';
  const U = ns.Utils;
  const LARGE_ABS = 50000;
  const LARGE_PCT = 0.1;

  let _p = null; // the proposal being viewed
  let _draft = []; // one entry per change: {c, tick, value, qty, unitPrice, name, planned, ...}
  let _stale = null; // [{lineId, field, expected, actual}] from a 409
  let _note = ''; // the reject reason

  function esc(v) {
    return U && U.escapeHtml
      ? U.escapeHtml(v == null ? '' : String(v))
      : String(v == null ? '' : v);
  }
  function money(n) {
    const s = ns.State.getState() || {};
    return U && U.fmtMoney
      ? U.fmtMoney(+n || 0, s.currency || 'USD')
      : '$' + Math.round(+n || 0).toLocaleString(); // ok: fixed currency table + digits only
  }
  function pct(n) {
    return Math.round(+n || 0) + '%';
  }
  function num(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function pid() {
    return ns.Cloud && ns.Cloud._pid ? ns.Cloud._pid() : '';
  }
  function ownerHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const code = ns.Cloud && ns.Cloud.getCode ? ns.Cloud.getCode() : '';
    if (code) {
      h['X-Owner-Code'] = code;
    }
    return h;
  }
  function toast(msg, kind) {
    if (ns.App && ns.App.showToast) {
      ns.App.showToast(msg, kind || 'ok');
    }
  }
  function lineOf(state, id) {
    return (state.budgetLines || []).find(l => String(l.id) === String(id)) || null;
  }
  function spendIsSpent(e) {
    return ((e && e.status) || 'received') !== 'ordered';
  }
  function totals(state) {
    const lines = state.budgetLines || [];
    const log = (state.spendLog || []).filter(spendIsSpent);
    const planned = lines.reduce((n, l) => n + (+l.planned || 0), 0);
    const spent = log.reduce((n, e) => n + (+e.amount || 0), 0);
    return { planned: planned, spent: spent, remaining: planned - spent };
  }

  // ---- the draft ---------------------------------------------------------

  function draftFrom(proposal) {
    const out = [];
    const changes =
      proposal && Array.isArray(proposal.changes)
        ? proposal.changes
        : proposal && proposal.proposal && Array.isArray(proposal.proposal.changes)
          ? proposal.proposal.changes
          : [];
    changes.forEach(function (c) {
      const d = { c: c, tick: true };
      if (c.kind === 'changeLine') {
        d.value = c.after;
      } else if (c.kind === 'addLine') {
        d.name = (c.after && c.after.name) || '';
        d.planned = (c.after && c.after.planned) || 0;
        d.qty = c.after && c.after.qty != null ? c.after.qty : '';
        d.unit = (c.after && c.after.unit) || '';
        d.rate = c.after && c.after.rate != null ? c.after.rate : '';
      } else if (c.kind === 'addDelivery') {
        d.qty = c.after && c.after.qty != null ? c.after.qty : 0;
        d.unitPrice = c.after && c.after.unitPrice != null ? c.after.unitPrice : 0;
        d.date = (c.after && c.after.date) || '';
        d.unit = (c.after && c.after.unit) || '';
        d.supplierRef = (c.after && c.after.supplierRef) || '';
        d.status = (c.after && c.after.status) || 'received';
      }
      out.push(d);
    });
    return out;
  }

  // The change objects sent back to the server, for the TICKED rows only.
  function approvedChanges() {
    const out = [];
    _draft.forEach(function (d) {
      if (!d.tick) {
        return;
      }
      const c = d.c;
      if (c.kind === 'changeLine') {
        // The value may have been typed into a <input> (a string) and the
        // server's money validator requires a real number; the original
        // "before" travels too so the server can detect a stale proposal.
        const isMoney = c.field === 'planned' || c.field === 'qty' || c.field === 'rate';
        out.push({
          kind: 'changeLine',
          lineId: c.lineId,
          field: c.field,
          value: isMoney ? num(d.value) : d.value,
          before: c.before
        });
      } else if (c.kind === 'addLine') {
        out.push({
          kind: 'addLine',
          line: {
            name: d.name,
            category: d.name,
            planned: d.planned,
            qty: d.qty === '' ? undefined : d.qty,
            unit: d.unit,
            rate: d.rate === '' ? undefined : d.rate,
            boqRef: (c.after && c.after.boqRef) || ''
          }
        });
      } else if (c.kind === 'addDelivery') {
        out.push({
          kind: 'addDelivery',
          lineId: c.lineId,
          qty: num(d.qty),
          unitPrice: num(d.unitPrice),
          unit: d.unit,
          date: d.date,
          status: d.status,
          supplierRef: d.supplierRef,
          note: (c.after && c.after.notes) || ''
        });
      }
    });
    return out;
  }

  // A budget proposal also carries the snapshot diff of the same edit
  // (path "budgetLines[0]"), which is NOT a task/risk field change: render
  // diffs only when the proposal has no budget changes of its own.
  function fieldDiffs() {
    if (_draft.length) {
      return [];
    }
    return (_p && Array.isArray(_p.diffs) ? _p.diffs : []).filter(Boolean);
  }

  function approvedDiffs() {
    const diffs = (_p && Array.isArray(_p.diffs) ? _p.diffs : []).filter(function (d) {
      return _tickMap[diffKey(d)] !== false;
    });
    return diffs;
  }
  let _tickMap = {};

  // A throwaway copy of the live project with the ticked changes applied.
  function draftState() {
    const live = ns.State.getState();
    const tmp = JSON.parse(JSON.stringify(live));
    if (!Array.isArray(tmp.budgetLines)) {
      tmp.budgetLines = [];
    }
    if (!Array.isArray(tmp.spendLog)) {
      tmp.spendLog = [];
    }
    let nspid = +tmp.nspid || 1;
    let n = 0;
    tmp.__apvChanged = [];
    tmp.__apvAdded = [];
    _draft.forEach(function (d) {
      if (!d.tick) {
        return;
      }
      const c = d.c;
      if (c.kind === 'changeLine') {
        const l = lineOf(tmp, c.lineId);
        if (l) {
          l[c.field] =
            c.field === 'planned' || c.field === 'qty' || c.field === 'rate'
              ? num(d.value)
              : String(d.value);
          tmp.__apvChanged.push(String(l.id));
        }
      } else if (c.kind === 'addLine') {
        n++;
        tmp.__apvAdded.push('PV' + n);
        tmp.budgetLines.push({
          id: 'PV' + n,
          category: d.name,
          name: d.name,
          planned: num(d.planned),
          actual: 0,
          qty: d.qty === '' ? null : num(d.qty),
          unit: d.unit,
          rate: d.rate === '' ? null : num(d.rate),
          source: 'manual',
          curve: 'linear'
        });
      } else if (c.kind === 'addDelivery') {
        tmp.spendLog.push({
          id: 'PVS' + nspid++,
          date: d.date,
          budgetLineId: c.lineId,
          amount: Math.round(num(d.qty) * num(d.unitPrice) * 100) / 100,
          qty: num(d.qty),
          unitPrice: num(d.unitPrice),
          unit: d.unit,
          supplierRef: d.supplierRef,
          status: d.status
        });
      }
    });
    // Field diffs from a task/risk proposal (H-6 "all proposal types").
    // Budget proposals keep their snapshot diff out of the draft: their
    // changes array is the authoritative edit.
    (_draft.length ? [] : _p && Array.isArray(_p.diffs) ? _p.diffs : []).forEach(function (d) {
      if (_tickMap[diffKey(d)] === false) {
        return;
      }
      if (!d.field) {
        tmp[d.path] = d.after;
        return;
      }
      const arr = tmp[d.path];
      if (!Array.isArray(arr)) {
        return;
      }
      let item = null;
      if (d.recordId) {
        item = arr.find(x => x && String(x.id) === String(d.recordId));
      }
      if (!item && typeof d.index === 'number' && arr[d.index]) {
        item = arr[d.index];
      }
      if (item) {
        setField(item, d.field, d.after);
      }
    });
    tmp.nspid = nspid;
    return tmp;
  }

  // ---- the real panels, rendered from the throwaway copy -----------------

  function sanitize(html) {
    // Ids and actions belong to the LIVE panels; a copy must not carry them
    // (duplicate ids break the page, and a stray action would edit the real
    // project from inside a preview).
    return String(html || '')
      .replace(/\sid="[^"]*"/g, '')
      .replace(/\sdata-action="[^"]*"/g, ' data-apv-inert="1"');
  }
  function snapshotPanels() {
    const get = id => document.getElementById(id);
    const txt = id => {
      const el = get(id);
      return el ? el.textContent : '';
    };
    return {
      rows: get('bud-body') ? sanitize(get('bud-body').innerHTML) : '',
      wkCards: get('bud-weekly-cards') ? sanitize(get('bud-weekly-cards').innerHTML) : '',
      wkRows: get('bud-weekly-body') ? sanitize(get('bud-weekly-body').innerHTML) : '',
      cards: {
        spent: txt('bud-ta'),
        remaining: txt('bud-remaining'),
        committed: txt('bud-committed'),
        unallocated: txt('bud-unallocated')
      }
    };
  }
  function renderPanels(tmp) {
    const RF = ns.RenderFinancials;
    const W = ns.Weekly;
    ns.State.setPreviewState(tmp);
    try {
      if (RF && RF.renderBudget) {
        RF.renderBudget();
      }
      if (W && W.render) {
        W.render();
      }
      // Mark the changed and added rows so the preview shows where the
      // change lands (gold edge / green edge) without inventing a second
      // table renderer.
      const body = document.getElementById('bud-body');
      if (body) {
        const changed = tmp.__apvChanged || [];
        const added = tmp.__apvAdded || [];
        Array.prototype.forEach.call(body.children, function (tr, i) {
          const l = (tmp.budgetLines || [])[i] || {};
          if (added.indexOf(String(l.id)) > -1) {
            tr.setAttribute('data-apv-add', '1');
          } else if (changed.indexOf(String(l.id)) > -1) {
            tr.setAttribute('data-apv-chg', '1');
          }
        });
      }
      return snapshotPanels();
    } finally {
      ns.State.setPreviewState(null);
      if (RF && RF.renderBudget) {
        RF.renderBudget();
      }
      if (W && W.render) {
        W.render();
      }
    }
  }

  // ---- flags -------------------------------------------------------------

  function flagsFor(d) {
    const out = [];
    const c = d.c;
    if (c.kind === 'changeLine') {
      const v = num(d.value);
      if (v < 0) {
        out.push('negative value');
      }
      if (String(c.field) === 'planned' && v === +c.before) {
        out.push('no change');
      }
    }
    if (c.kind === 'addDelivery') {
      if (num(d.qty) <= 0) {
        out.push('quantity must be above zero');
      }
      if (num(d.unitPrice) < 0) {
        out.push('negative price');
      }
      const live = ns.State.getState();
      const line = lineOf(live, c.lineId);
      if (line && line.rate != null && num(d.unitPrice) > +line.rate + 0.005) {
        out.push('price above the BOQ rate');
      }
      if (line && line.unit && d.unit && String(line.unit) !== String(d.unit)) {
        out.push('unit does not match the line');
      }
    }
    return out;
  }
  function isLarge(d) {
    const c = d.c;
    if (
      c.kind === 'changeLine' &&
      (c.field === 'planned' || c.field === 'qty' || c.field === 'rate')
    ) {
      const delta = Math.abs(num(d.value) - (+c.before || 0));
      return delta >= Math.min(Math.abs(+c.before || 0) * LARGE_PCT, LARGE_ABS);
    }
    if (c.kind === 'addLine') {
      return num(d.planned) >= LARGE_ABS;
    }
    if (c.kind === 'addDelivery') {
      const line = lineOf(ns.State.getState(), c.lineId);
      const cap = Math.min(Math.abs(+(line && line.planned) || 0) * LARGE_PCT, LARGE_ABS);
      return Math.round(num(d.qty) * num(d.unitPrice) * 100) / 100 >= cap;
    }
    return !!c.large;
  }

  // ---- readable labels and values ---------------------------------------
  // OWNER 2026-11-11: the review screen used to print the raw payload - an
  // unordered list of internal field names, bare numbers and record ids. It
  // now groups changes, names the record and says "this to that" in money or
  // plain words. Presentation only: the approved payload is unchanged.

  const FIELD_LABELS = {
    planned: 'Planned budget',
    actual: 'Actual spend',
    qty: 'Quantity',
    rate: 'Rate',
    unit: 'Unit',
    unitPrice: 'Price per unit',
    name: 'Name',
    category: 'Category',
    boqRef: 'BOQ reference',
    status: 'Status',
    owner: 'Owner',
    startDate: 'Start date',
    endDate: 'End date',
    dueDate: 'Due date',
    progress: 'Progress',
    description: 'Description',
    title: 'Title',
    notes: 'Notes',
    severity: 'Severity',
    likelihood: 'Likelihood',
    mitigation: 'Mitigation',
    supplierRef: 'Supplier reference',
    date: 'Date',
    amount: 'Amount',
    assignee: 'Assignee',
    dependsOn: 'Depends on',
    duration: 'Duration',
    workingDays: 'Working days',
    priority: 'Priority',
    impact: 'Impact',
    probability: 'Probability',
    response: 'Response',
    note: 'Note',
    ref: 'Reference',
    text: 'Text',
    problem: 'Problem statement',
    goal: 'Goal',
    phase: 'Phase',
    percent: 'Percent complete'
  };
  const PATH_LABELS = {
    tasks: 'Task',
    risks: 'Risk',
    issues: 'Issue',
    budgetLines: 'Budget line',
    spendLog: 'Delivery',
    stakeholders: 'Stakeholder',
    resources: 'Resource',
    changes: 'Change request',
    logEntries: 'Decision',
    documents: 'Document',
    commsEntries: 'Comms entry',
    raci: 'RACI entry',
    meetings: 'Meeting',
    meetingPromises: 'Promise',
    charter: 'Charter',
    closure: 'Closure',
    dmaic: 'DMAIC',
    supplierBook: 'Supplier',
    projectName: 'Project name',
    methodology: 'Methodology',
    methodologyLocked: 'Methodology lock',
    projectDeadline: 'Project deadline',
    budgetEnvelope: 'Budget envelope',
    nspid: 'Delivery counter',
    nmeetid: 'Meeting counter',
    currency: 'Currency'
  };
  const MONEY_FIELDS = { planned: 1, actual: 1, rate: 1, unitPrice: 1, amount: 1 };
  const PCT_FIELDS = { progress: 1, percent: 1 };

  function fieldLabel(f) {
    const k = String(f || '');
    if (FIELD_LABELS[k]) {
      return FIELD_LABELS[k];
    }
    return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, function (c) {
      return c.toUpperCase();
    });
  }
  function isMoneyField(f) {
    return !!MONEY_FIELDS[String(f)];
  }
  function plainVal(field, v) {
    if (v == null || v === '') {
      return 'blank';
    }
    if (isMoneyField(field)) {
      return money(v);
    }
    if (PCT_FIELDS[String(field)]) {
      return num(v) + '%';
    }
    if (typeof v === 'number') {
      return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return String(v);
  }
  function signedDelta(field, before, after) {
    if (isMoneyField(field)) {
      const d = num(after) - num(before);
      if (!d) {
        return '';
      }
      return (d > 0 ? '+' : '-') + money(Math.abs(d));
    }
    if (typeof before === 'string' || typeof after === 'string') {
      return '';
    }
    const d = num(after) - num(before);
    if (!d) {
      return '';
    }
    return (d > 0 ? '+' : '') + d.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function recordLabel(path, id, index, name) {
    // The proposal's own record name wins: the live state may not carry the
    // record yet (a create) or may have been renamed since it was queued.
    if (name) {
      return String(name);
    }
    const s = ns.State.getState() || {};
    const arr = Array.isArray(s[path]) ? s[path] : [];
    let item = null;
    if (id !== undefined && id !== null && id !== '') {
      item = arr.find(function (x) {
        return x && String(x.id) === String(id);
      });
    }
    // Legacy rows carry only an array index - point at that row rather than
    // rendering an empty or "undefined" name.
    if (!item && typeof index === 'number' && arr[index]) {
      item = arr[index];
    }
    const label = item && (item.name || item.title || item.description || item.label || item.ref);
    if (label) {
      return String(label);
    }
    if (id !== undefined && id !== null && id !== '') {
      return String(id);
    }
    if (typeof index === 'number') {
      return 'Item ' + (index + 1);
    }
    return '';
  }
  function pathLabel(p) {
    const k = String(p || '');
    if (PATH_LABELS[k]) {
      return PATH_LABELS[k];
    }
    return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, function (c) {
      return c.toUpperCase();
    });
  }
  // Must match the server's diffKey: legacy leaves have no recordId, so the
  // array index is the identity.
  function diffKey(d) {
    const rec = d.recordId || (d.index === null || d.index === undefined ? '' : '#' + d.index);
    return d.path + '|' + rec + '|' + d.field;
  }
  // Set a nested field ("define.problem", "lessons[0].text") on a preview copy.
  function setField(obj, field, value) {
    const parts = [];
    String(field || '')
      .split('.')
      .forEach(function (part) {
        const m = /^([A-Za-z0-9_]+)((?:\[\d+\])*)$/.exec(part);
        if (!m) {
          parts.push(part);
          return;
        }
        parts.push(m[1]);
        (m[2].match(/\[(\d+)\]/g) || []).forEach(function (tok) {
          parts.push(Number(tok.slice(1, -1)));
        });
      });
    if (!parts.length) {
      return false;
    }
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      const k = parts[i];
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        return false;
      }
      if (i === parts.length - 1) {
        cur[k] = value;
        return true;
      }
      if (cur[k] === null || cur[k] === undefined) {
        cur[k] = typeof parts[i + 1] === 'number' ? [] : {};
      }
      cur = cur[k];
      if (!cur || typeof cur !== 'object') {
        return false;
      }
    }
    return false;
  }
  function lineName(state, id) {
    const line = lineOf(state, id);
    return (line && (line.name || line.category)) || String(id);
  }
  function lineSpent(state, id) {
    return (state.spendLog || [])
      .filter(spendIsSpent)
      .filter(function (e) {
        return String(e.budgetLineId) === String(id);
      })
      .reduce(function (n, e) {
        return n + (+e.amount || 0);
      }, 0);
  }
  function arrow() {
    return '<svg class="ico apv-arrow" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-right"></use></svg>';
  }
  function deltaRow(label, before, after, diffText) {
    return (
      '<div class="apv-delta">' +
      '<span class="apv-k">' +
      esc(label) +
      '</span>' +
      '<span class="apv-was">' +
      esc(before) +
      '</span>' +
      arrow() +
      '<span class="apv-now">' +
      esc(after) +
      '</span>' +
      (diffText
        ? '<span class="apv-diff' +
          (diffText.charAt(0) === '-' ? ' is-down' : '') +
          '">' +
          esc(diffText) +
          '</span>'
        : '') +
      '</div>'
    );
  }
  function input(i, key, label, value, type) {
    const money = type === 'money';
    return (
      '<label class="apv-f"><span>' +
      esc(label) +
      '</span><input type="' +
      (money ? 'number' : type || 'text') +
      '" class="ctl-in apv-in" data-apv="edit" data-i="' +
      i +
      '"' +
      (key ? ' data-k="' + key + '"' : '') +
      ' value="' +
      esc(value) +
      '"' +
      (money ? ' step="any" inputmode="decimal"' : '') +
      '></label>'
    );
  }
  function notesInner(d) {
    let out = '';
    if (isLarge(d)) {
      out +=
        '<div class="apv-warn"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Large change: 10 percent of the line or ' +
        esc(money(LARGE_ABS)) +
        ', whichever is smaller.</div>';
    }
    const flags = flagsFor(d);
    if (flags.length) {
      out +=
        '<div class="apv-flag"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-info"></use></svg> ' +
        esc(flags.join('; ')) +
        '</div>';
    }
    return out;
  }

  // One "this to that" line per change, rebuilt whenever a field is edited.
  function cardDelta(d) {
    const c = d.c;
    if (c.kind === 'changeLine') {
      return deltaRow(
        fieldLabel(c.field),
        plainVal(c.field, c.before),
        plainVal(c.field, d.value),
        signedDelta(c.field, c.before, d.value)
      );
    }
    if (c.kind === 'addLine') {
      return deltaRow('Planned budget', 'not in the budget', money(num(d.planned)), '');
    }
    if (c.kind === 'addDelivery') {
      const live = ns.State.getState();
      const amount = Math.round(num(d.qty) * num(d.unitPrice) * 100) / 100;
      return deltaRow(
        'Spent on this line',
        money(lineSpent(live, c.lineId)),
        money(lineSpent(live, c.lineId) + amount),
        '+' + money(amount)
      );
    }
    return '';
  }

  // ---- rendering ---------------------------------------------------------

  function changeCard(d, i) {
    const c = d.c;
    let tag = '';
    let fields = '';
    if (c.kind === 'changeLine') {
      tag =
        '<div class="apv-tag"><span class="apv-pill">Budget line</span>' +
        esc(lineName(ns.State.getState(), c.lineId)) +
        '</div>' +
        cardDelta(d);
      fields =
        '<div class="apv-fields">' +
        input(
          i,
          '',
          'New ' + fieldLabel(c.field).toLowerCase(),
          d.value,
          isMoneyField(c.field) ? 'money' : 'text'
        ) +
        '</div>';
    } else if (c.kind === 'addLine') {
      tag =
        '<div class="apv-tag"><span class="apv-pill">New budget line</span>' +
        esc(d.name || 'Untitled line') +
        '</div>' +
        cardDelta(d);
      fields =
        '<div class="apv-fields">' +
        input(i, 'name', 'Line name', d.name, 'text') +
        input(i, 'planned', 'Planned budget', d.planned, 'money') +
        input(i, 'qty', 'Quantity', d.qty, 'money') +
        input(i, 'unit', 'Unit', d.unit, 'text') +
        input(i, 'rate', 'Rate', d.rate, 'money') +
        '</div>';
    } else if (c.kind === 'addDelivery') {
      tag =
        '<div class="apv-tag"><span class="apv-pill">Delivery</span>' +
        esc(lineName(ns.State.getState(), c.lineId)) +
        '</div>' +
        cardDelta(d);
      fields =
        '<div class="apv-fields">' +
        input(i, 'qty', 'Quantity', d.qty, 'money') +
        input(i, 'unitPrice', 'Price per unit', d.unitPrice, 'money') +
        '<label class="apv-f"><span>Date</span><input type="date" class="ctl-in apv-in" data-apv="edit" data-i="' +
        i +
        '" data-k="date" value="' +
        esc(d.date) +
        '"></label>' +
        '</div>';
    }
    return (
      '<div class="apv-chg' +
      (isLarge(d) ? ' is-large' : '') +
      '" data-i="' +
      i +
      '">' +
      '<label class="apv-tick"><input type="checkbox" data-apv="tick" data-i="' +
      i +
      '"' +
      (d.tick ? ' checked' : '') +
      '><span class="sr-only">Approve change ' +
      (i + 1) +
      '</span></label>' +
      '<div class="apv-chg-b">' +
      tag +
      fields +
      '<div class="apv-notes">' +
      notesInner(d) +
      '</div>' +
      '</div></div>'
    );
  }

  function surfacesLine(d) {
    const list = Array.isArray(d.surfaces) ? d.surfaces : [];
    if (!list.length) {
      return '';
    }
    return (
      '<div class="apv-surf"><span>Affects</span>' +
      list
        .map(function (s) {
          return '<em>' + esc(s) + '</em>';
        })
        .join('') +
      '</div>'
    );
  }

  function diffCard(d, i) {
    const key = diffKey(d);
    return (
      '<div class="apv-chg" data-diff="' +
      esc(key) +
      '">' +
      '<label class="apv-tick"><input type="checkbox" data-apv="tickdiff" data-key="' +
      esc(key) +
      '"' +
      (_tickMap[key] === false ? '' : ' checked') +
      '><span class="sr-only">Approve change ' +
      (i + 1) +
      '</span></label>' +
      '<div class="apv-chg-b">' +
      '<div class="apv-tag"><span class="apv-pill">' +
      esc(pathLabel(d.path)) +
      '</span>' +
      esc(d.field ? recordLabel(d.path, d.recordId, d.index, d.recordName) : pathLabel(d.path)) +
      '</div>' +
      (d.field
        ? deltaRow(fieldLabel(d.field), plainVal(d.field, d.before), plainVal(d.field, d.after), '')
        : deltaRow('Value', plainVal('', d.before), plainVal('', d.after), '')) +
      surfacesLine(d) +
      '</div></div>'
    );
  }

  // Changes are grouped by what they touch, in that order - budget edits,
  // new lines, deliveries, then record fields - instead of payload order.
  function changesColumn() {
    const groups = [
      { key: 'changeLine', title: 'Budget lines updated' },
      { key: 'addLine', title: 'New budget lines' },
      { key: 'addDelivery', title: 'Deliveries recorded' }
    ];
    let html = '';
    groups.forEach(function (g) {
      const rows = [];
      _draft.forEach(function (d, i) {
        if (d.c.kind === g.key) {
          rows.push(changeCard(d, i));
        }
      });
      if (rows.length) {
        html +=
          '<div class="apv-sect"><div class="apv-sect-h">' +
          g.title +
          '</div>' +
          rows.join('') +
          '</div>';
      }
    });
    const diffs = fieldDiffs();
    if (diffs.length) {
      html +=
        '<div class="apv-sect"><div class="apv-sect-h">Record fields updated</div>' +
        diffs
          .map(function (d, i) {
            return diffCard(d, i);
          })
          .join('') +
        '</div>';
    }
    return html || '<div class="sr-hint">This proposal carries no changes.</div>';
  }

  function budgetTotalsCards() {
    const before = totals(ns.State.getState());
    const after = totals(draftState());
    const rows = [
      ['Planned budget', before.planned, after.planned],
      ['Spent', before.spent, after.spent],
      ['Remaining', before.remaining, after.remaining]
    ];
    return rows
      .map(function (r) {
        const d = r[2] - r[1];
        return (
          '<div class="apv-card"><span>' +
          r[0] +
          '</span><b>' +
          esc(money(r[1])) +
          '</b>' +
          arrow() +
          '<b>' +
          esc(money(r[2])) +
          '</b>' +
          (d ? '<em class="apv-card-d">' + (d > 0 ? '+' : '') + esc(money(d)) + '</em>' : '') +
          '</div>'
        );
      })
      .join('');
  }

  // Only the ticked changes, one row each: record, what moves, before, after.
  function miniRows() {
    const live = ns.State.getState();
    const rows = [];
    // Same order as the cards: budget edits, new lines, deliveries, fields.
    const ordered = [];
    ['changeLine', 'addLine', 'addDelivery'].forEach(function (kind) {
      _draft.forEach(function (d) {
        if (d.c.kind === kind) {
          ordered.push(d);
        }
      });
    });
    ordered.forEach(function (d) {
      if (!d.tick) {
        return;
      }
      const c = d.c;
      if (c.kind === 'changeLine') {
        rows.push([
          lineName(live, c.lineId),
          fieldLabel(c.field),
          plainVal(c.field, c.before),
          plainVal(c.field, d.value)
        ]);
      } else if (c.kind === 'addLine') {
        rows.push([
          d.name || 'New line',
          'Added to the budget',
          'not in the budget',
          money(num(d.planned))
        ]);
      } else if (c.kind === 'addDelivery') {
        rows.push([
          lineName(live, c.lineId),
          'Delivery' + (d.date ? ' on ' + d.date : ''),
          money(lineSpent(live, c.lineId)),
          money(lineSpent(live, c.lineId) + num(d.qty) * num(d.unitPrice))
        ]);
      }
    });
    fieldDiffs().forEach(function (d) {
      if (_tickMap[diffKey(d)] === false) {
        return;
      }
      rows.push([
        d.field ? recordLabel(d.path, d.recordId, d.index, d.recordName) : pathLabel(d.path),
        d.field ? fieldLabel(d.field) : 'Value',
        plainVal(d.field, d.before),
        plainVal(d.field, d.after)
      ]);
    });
    return rows
      .map(function (r) {
        return (
          '<tr><td>' +
          esc(r[0]) +
          '</td><td>' +
          esc(r[1]) +
          '</td><td class="apv-was">' +
          esc(r[2]) +
          '</td><td class="apv-now">' +
          esc(r[3]) +
          '</td></tr>'
        );
      })
      .join('');
  }
  function miniTable() {
    return (
      '<table class="apv-mini"><thead><tr><th>Record</th><th>What changes</th><th>Before</th><th>After</th></tr></thead><tbody id="apv-mini-body">' +
      miniRows() +
      '</tbody></table>'
    );
  }

  function fullPreview(snap) {
    return (
      '<div class="apv-prev" id="apv-prev">' +
      '<div class="apv-tbl"><table><thead><tr><th>Category</th><th>Planned</th><th>Actual</th><th>Committed</th><th>Contingency</th><th>Remaining</th><th>% of Plan</th><th></th></tr></thead><tbody>' +
      (snap.rows || '') +
      '</tbody></table></div>' +
      '<div class="apv-h apv-h2">Weekly view</div>' +
      '<div class="wk-cards">' +
      (snap.wkCards || '') +
      '</div>' +
      '<div class="apv-tbl"><table><thead><tr><th>Line</th><th>Planned</th><th>Spent</th><th>This week</th><th>Used</th><th>Status</th><th>Forecast</th></tr></thead><tbody>' +
      (snap.wkRows || '') +
      '</tbody></table></div>' +
      '</div>'
    );
  }

  function previewColumn(snap, isBudget) {
    if (!isBudget) {
      return (
        '<div class="apv-col apv-col-prev">' +
        '<div class="apv-h">What this will change</div>' +
        miniTable() +
        '<p class="sr-hint">Only the ticked fields are written. Nothing is saved until you approve.</p>' +
        '</div>'
      );
    }
    return (
      '<div class="apv-col apv-col-prev">' +
      '<div class="apv-h">Before and after</div>' +
      '<div class="apv-cards" id="apv-cards">' +
      budgetTotalsCards() +
      '</div>' +
      miniTable() +
      '<details class="apv-more"><summary>Full budget and weekly view</summary>' +
      fullPreview(snap) +
      '</details>' +
      '</div>'
    );
  }

  function impactLine() {
    const live = ns.State.getState();
    const before = totals(live);
    const after = totals(draftState());
    const d = after.planned - before.planned;
    const parts = [
      'Planned ' + money(before.planned) + ' to ' + money(after.planned),
      'Spent ' + money(before.spent) + ' to ' + money(after.spent),
      'Remaining ' + money(before.remaining) + ' to ' + money(after.remaining)
    ];
    return (
      '<div class="apv-impact" id="apv-impact" role="status" aria-live="polite">' +
      '<span class="apv-k">If approved</span>' +
      esc(parts.join('  \u00b7  ')) +
      (d ? ' <b>(' + (d > 0 ? '+' : '') + money(d) + ' planned)</b>' : '') +
      '</div>'
    );
  }

  function staleBanner() {
    if (!_stale || !_stale.length) {
      return '';
    }
    const rows = _stale
      .map(function (s) {
        const line = lineOf(ns.State.getState(), s.lineId);
        return (
          '<li>' +
          esc((line && (line.category || line.name)) || s.lineId) +
          ' ' +
          esc(fieldLabel(s.field)) +
          ': proposed from <b>' +
          esc(s.expected) +
          '</b>, now <b>' +
          esc(s.actual) +
          '</b></li>'
        );
      })
      .join('');
    return (
      '<div class="apv-stale" role="alert"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg>' +
      '<div><b>This line changed since the proposal was made.</b><ul>' +
      rows +
      '</ul><button class="btn btn-n btn-s" data-apv="refresh">Refresh the proposal</button></div></div>'
    );
  }

  function overlayHtml(snap) {
    const p = _p || {};
    const isBudget = !!(p.proposal && Array.isArray(p.proposal.changes));
    const n = _draft.length + fieldDiffs().length;
    return (
      '<div class="apv-ov" id="apv-ov" role="dialog" aria-modal="true" aria-labelledby="apv-title">' +
      '<div class="apv-win">' +
      '<div class="apv-hd">' +
      '<div><div class="apv-title" id="apv-title">Proposal #' +
      esc(p.id) +
      ' from ' +
      esc(p.sourceLabel || 'an editor') +
      '</div>' +
      '<div class="sr-hint apv-sub">' +
      esc(
        (n ? n + (n === 1 ? ' change' : ' changes') + ' - ' : '') +
          (isBudget ? 'budget proposal.' : 'field proposal.') +
          ' Nothing is saved until you approve.'
      ) +
      '</div></div>' +
      '<button class="btn btn-n btn-s" data-apv="close" aria-label="Close the preview">Close</button>' +
      '</div>' +
      staleBanner() +
      '<div class="apv-grid">' +
      '<div class="apv-col">' +
      '<div class="apv-h">Changes</div>' +
      changesColumn() +
      '</div>' +
      previewColumn(snap, isBudget) +
      '</div>' +
      (isBudget ? impactLine() : '') +
      '<div class="apv-ft">' +
      '<input type="text" class="ctl-in apv-note" id="apv-note" placeholder="Reason (needed to reject)" maxlength="200" autocomplete="off" aria-label="Reason for rejecting">' +
      '<span class="apv-actions">' +
      '<button class="btn btn-o btn-s" data-apv="reject"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Reject</button>' +
      '<button class="btn btn-g btn-s" data-apv="approve"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Approve ticked changes</button>' +
      '</span>' +
      '</div>' +
      '</div></div>'
    );
  }

  // The overlay carries data-apv (NOT data-action): the global action
  // dispatcher ignores it, so a preview control can never reach a real
  // project mutation by accident. Every handler is bound here, once.
  function wire(host) {
    if (!host) {
      return;
    }
    host.querySelectorAll('[data-apv="edit"]').forEach(function (el) {
      el.addEventListener('input', function () {
        editValue(el.getAttribute('data-i'), el.getAttribute('data-k'), el.value);
      });
    });
    host.querySelectorAll('[data-apv="tick"]').forEach(function (el) {
      el.addEventListener('change', function () {
        toggleTick(el.getAttribute('data-i'), el.checked);
      });
    });
    host.querySelectorAll('[data-apv="tickdiff"]').forEach(function (el) {
      el.addEventListener('change', function () {
        toggleDiff(el.getAttribute('data-key'), el.checked);
      });
    });
    const on = function (name, fn) {
      host.querySelectorAll('[data-apv="' + name + '"]').forEach(function (el) {
        el.addEventListener('click', fn);
      });
    };
    on('approve', approve);
    on('reject', reject);
    on('close', close);
    on('refresh', refresh);
    host.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        close();
      }
    });
    host.addEventListener('click', function (e) {
      if (e.target === host) {
        close();
      }
    });
  }

  function paint() {
    const tmp = draftState();
    const snap = renderPanels(tmp);
    let host = document.getElementById('apv-ov');
    const html = overlayHtml(snap);
    if (host) {
      host.outerHTML = html;
    } else {
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap.firstChild);
    }
    host = document.getElementById('apv-ov');
    wire(host);
    const note = document.getElementById('apv-note');
    if (note && _note) {
      note.value = _note;
    }
    note &&
      note.addEventListener('input', function () {
        _note = note.value;
      });
  }

  // Re-render only the totals, the change table, the impact line and each
  // card's own "this to that" line after an edit, so the field keeps its
  // focus and caret.
  function repaintPreview() {
    const snap = renderPanels(draftState());
    const cards = document.getElementById('apv-cards');
    if (cards) {
      cards.innerHTML = budgetTotalsCards();
    }
    const mini = document.getElementById('apv-mini-body');
    if (mini) {
      mini.innerHTML = miniRows();
    }
    const imp = document.getElementById('apv-impact');
    if (imp) {
      imp.outerHTML = impactLine();
    }
    const prev = document.getElementById('apv-prev');
    if (prev) {
      const bodies = prev.querySelectorAll('tbody');
      if (bodies[0]) {
        bodies[0].innerHTML = snap.rows || ''; // ok: captured from the app's own renderer and stripped of ids/actions
      }
      if (bodies[1]) {
        bodies[1].innerHTML = snap.wkRows || ''; // ok: captured from the app's own renderer and stripped of ids/actions
      }
      const wk = prev.querySelector('.wk-cards');
      if (wk) {
        wk.innerHTML = snap.wkCards || ''; // ok: captured from the app's own renderer and stripped of ids/actions
      }
    }
    const ovEl = document.getElementById('apv-ov');
    _draft.forEach(function (d, i) {
      const card = ovEl ? ovEl.querySelector('.apv-chg[data-i="' + i + '"]') : null;
      if (!card) {
        return;
      }
      const delta = card.querySelector('.apv-delta');
      const nextDelta = cardDelta(d);
      if (delta && nextDelta) {
        delta.outerHTML = nextDelta;
      }
      const notes = card.querySelector('.apv-notes');
      if (notes) {
        notes.innerHTML = notesInner(d);
      }
      card.classList.toggle('is-large', isLarge(d));
    });
  }

  // ---- actions -----------------------------------------------------------

  async function open(id) {
    if (!id) {
      return;
    }
    let p = null;
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews', {
        method: 'GET',
        credentials: 'same-origin',
        headers: ownerHeaders()
      });
      const data = await res.json().catch(function () {
        return {};
      });
      const list = data.proposals || data.reviews || [];
      p = list.find(x => String(x.id) === String(id)) || null;
    } catch (e) {
      toast('Cloud is unavailable here, so the preview cannot open.', 'err');
      return;
    }
    if (!p) {
      toast('That proposal is no longer in the queue.', 'warn');
      return;
    }
    _p = p;
    _draft = draftFrom(p);
    _tickMap = {};
    _stale = null;
    _note = '';
    paint();
    const first = document.querySelector('#apv-ov input, #apv-ov button');
    if (first) {
      first.focus();
    }
  }

  function close() {
    const host = document.getElementById('apv-ov');
    if (host) {
      host.remove();
    }
    _p = null;
    _draft = [];
    _stale = null;
  }

  function editValue(i, key, value) {
    const d = _draft[+i];
    if (!d) {
      return;
    }
    if (key) {
      d[key] = value;
    } else {
      d.value = value;
    }
    const inp = document.querySelector(
      '#apv-ov [data-apv="edit"][data-i="' +
        i +
        '"]' +
        (key ? '[data-k="' + key + '"]' : ':not([data-k])')
    );
    if (inp) {
      inp.value = value;
    }
    repaintPreview();
  }

  function toggleTick(i, on) {
    const d = _draft[+i];
    if (!d) {
      return;
    }
    d.tick = !!on;
    repaintPreview();
  }

  function toggleDiff(key, on) {
    _tickMap[key] = !!on;
    repaintPreview();
  }

  async function approve() {
    if (!_p) {
      return;
    }
    if (_stale && _stale.length) {
      toast('Refresh the proposal first - the project changed since it was made.', 'warn');
      return;
    }
    const isBudget = !!(_p.proposal && Array.isArray(_p.proposal.changes));
    const changes = isBudget ? approvedChanges() : null;
    const diffs = isBudget ? null : approvedDiffs();
    if ((isBudget && !changes.length) || (!isBudget && !diffs.length)) {
      toast('Tick at least one change to approve.', 'warn');
      return;
    }
    const note = (document.getElementById('apv-note') || {}).value || '';
    const body = { note: String(note).slice(0, 500), edited: true };
    if (isBudget) {
      body.changes = changes;
    } else {
      body.diffs = diffs;
    }
    try {
      const res = await fetch(
        '/api/cloud/projects/' +
          encodeURIComponent(pid()) +
          '/reviews/' +
          encodeURIComponent(_p.id) +
          '/accept',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: ownerHeaders(),
          body: JSON.stringify(body)
        }
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (res.status === 409 && data.error === 'stale') {
        _stale = data.stale || [];
        paint();
        toast('This proposal changed since it was made. Refresh it before approving.', 'warn');
        return;
      }
      if (!res.ok || !data.ok) {
        toast((data && data.error) || 'Could not approve (HTTP ' + res.status + ').', 'err');
        return;
      }
      toast(
        data.savedAt
          ? 'Approved - the change is in the cloud project and the changelog.'
          : 'Approved, but there was nothing left to apply - the project already had these values.',
        data.savedAt ? 'ok' : 'warn'
      );
      close();
      if (ns.Cloud && ns.Cloud.cloudReviewList) {
        ns.Cloud.cloudReviewList();
      }
      refreshBadge();
    } catch (e) {
      toast('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  async function reject() {
    if (!_p) {
      return;
    }
    const note = ((document.getElementById('apv-note') || {}).value || '').trim();
    if (!note) {
      toast('Give a short reason first - it goes back to whoever made the proposal.', 'warn');
      return;
    }
    try {
      const res = await fetch(
        '/api/cloud/projects/' +
          encodeURIComponent(pid()) +
          '/reviews/' +
          encodeURIComponent(_p.id) +
          '/reject',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: ownerHeaders(),
          body: JSON.stringify({ note: note.slice(0, 500) })
        }
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        toast((data && data.error) || 'Could not reject (HTTP ' + res.status + ').', 'err');
        return;
      }
      toast('Rejected - the reason goes back to the AI client.', 'ok');
      close();
      if (ns.Cloud && ns.Cloud.cloudReviewList) {
        ns.Cloud.cloudReviewList();
      }
      refreshBadge();
    } catch (e) {
      toast('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  async function refresh() {
    if (!_p) {
      return;
    }
    const id = _p.id;
    close();
    await open(id);
  }

  // ---- header notice -----------------------------------------------------

  async function refreshBadge() {
    const bell = document.getElementById('apv-bell');
    const n = document.getElementById('apv-bell-n');
    if (!bell || !n) {
      return;
    }
    if (!ns.Cloud || !ns.Cloud.getCode) {
      return;
    }
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews', {
        method: 'GET',
        credentials: 'same-origin',
        headers: ownerHeaders()
      });
      const data = await res.json().catch(function () {
        return {};
      });
      const list = data.proposals || data.reviews || [];
      const waiting = list.filter(x => x.status === 'pending').length;
      n.textContent = String(waiting);
      bell.classList.toggle('is-hide', waiting === 0);
      bell.setAttribute(
        'aria-label',
        waiting === 0
          ? 'No proposals waiting for review'
          : waiting + ' proposal' + (waiting === 1 ? '' : 's') + ' waiting for review'
      );
    } catch (e) {
      bell.classList.add('is-hide');
    }
  }

  function openLatest() {
    fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews', {
      method: 'GET',
      credentials: 'same-origin',
      headers: ownerHeaders()
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        const list = data.proposals || data.reviews || [];
        const pending = list.filter(x => x.status === 'pending');
        if (!pending.length) {
          toast('No proposals are waiting for review.', 'ok');
          return;
        }
        open(pending[0].id);
      })
      .catch(function () {
        toast('Cloud is unavailable here.', 'err');
      });
  }

  ns.Approval = {
    open: open,
    close: close,
    editValue: editValue,
    toggleTick: toggleTick,
    toggleDiff: toggleDiff,
    approve: approve,
    reject: reject,
    refresh: refresh,
    refreshBadge: refreshBadge,
    openLatest: openLatest,
    fieldLabel: fieldLabel,
    pathLabel: pathLabel,
    diffKey: diffKey
  };
})(MMGR);
window.MMGR = MMGR;
