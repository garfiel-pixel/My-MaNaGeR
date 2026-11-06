/* ============================================================
   My MaNaGeR , BOQ to budget bridge
   ============================================================
   H-2 of BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05.

   The calculator prices a bill and writes ONE handoff record:

     localStorage['mmgr_boq_handoff'] = { '<projectId>': payload }

   The payload is already priced (the calculator owns computeFor; this page
   does not and must never re-price), so the bridge's job is matching,
   previewing and applying:

     - every bill line becomes a budget line with source 'boq' and a durable
       boqRef, so a second send matches instead of duplicating;
     - the first apply freezes Baseline 1 (date, who, total, the lines);
     - a later apply that changes a planned figure records a variation with
       the reason the person typed, who made it and who approved it;
     - nothing is applied until the person ticks it and presses Apply.

   Manual lines are never touched: the bridge only reads and writes lines
   whose source is 'boq'.
   ============================================================ */
var MMGR = window.MMGR || {};
(function (ns) {
  'use strict';
  const U = ns.Utils;
  const HANDOFF_KEY = 'mmgr_boq_handoff';
  const KIND_LABEL = {
    work: 'Work',
    site: 'Site cost',
    tax: 'Tax',
    overhead: 'Overhead',
    margin: 'Margin',
    contingency: 'Contingency'
  };
  // Keys the dialog is holding while it is open. Nothing here is saved.
  let _open = null;

  function pid() {
    const m = /[?&]id=([^&#]+)/.exec(window.location.search || '');
    return m ? decodeURIComponent(m[1]) : '';
  }

  function esc(v) {
    return U && U.escapeHtml
      ? U.escapeHtml(v == null ? '' : String(v))
      : String(v == null ? '' : v);
  }

  function money(n, cur) {
    const c = cur || (ns.State && ns.State.getState() ? ns.State.getState().currency : 'USD');
    return U && U.fmtMoney
      ? U.fmtMoney(+n || 0, c || 'USD')
      : '$' + Math.round(+n || 0).toLocaleString();
  }

  function who() {
    try {
      const u = ns.GoogleAuth && ns.GoogleAuth.getUser ? ns.GoogleAuth.getUser() : null;
      return (u && (u.email || u.name)) || 'Owner';
    } catch (e) {
      return 'Owner';
    }
  }

  function round2(n) {
    return Math.round((+n || 0) * 100) / 100;
  }

  // ---- the handoff record ------------------------------------------------
  function readAll() {
    try {
      return JSON.parse(localStorage.getItem(HANDOFF_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function handoffFor(projectId) {
    const all = readAll();
    const p = all[projectId || pid()];
    if (!p || p.v !== 1 || !Array.isArray(p.lines) || !p.lines.length) {
      return null;
    }
    return p;
  }

  // The calculator writes this; the project page only reads it.
  function fingerprint(payload) {
    return (payload.lines || [])
      .map(l => [l.boqRef, round2(l.planned), round2(l.qty), round2(l.rate)].join('|'))
      .join(';');
  }

  // ---- matching ----------------------------------------------------------
  // PURE: what would change, with no state written. `adds` are new refs,
  // `changes` are refs already on a line whose figures moved, `removes` are
  // BOQ lines the new bill no longer carries. A line with spend entries is
  // never proposed for removal - its money is real even if the bill moved on.
  function planFor(payload, state) {
    const s = state || (ns.State ? ns.State.getState() : null) || {};
    const lines = Array.isArray(s.budgetLines) ? s.budgetLines : [];
    const byRef = {};
    lines.forEach(l => {
      if (l && l.source === 'boq' && l.boqRef) {
        byRef[l.boqRef] = l;
      }
    });
    const seen = {};
    const adds = [];
    const changes = [];
    const removes = [];
    (payload.lines || []).forEach(src => {
      seen[src.boqRef] = 1;
      const cur = byRef[src.boqRef];
      if (!cur) {
        adds.push(src);
        return;
      }
      const fields = [];
      if (round2(cur.planned) !== round2(src.planned)) {
        fields.push({ field: 'planned', from: round2(cur.planned), to: round2(src.planned) });
      }
      if (cur.qty != null && Math.abs(+cur.qty - +src.qty) > 1e-9) {
        fields.push({ field: 'qty', from: +cur.qty, to: +src.qty });
      }
      if (cur.rate != null && Math.abs(+cur.rate - +src.rate) > 1e-6) {
        fields.push({ field: 'rate', from: +cur.rate, to: +src.rate });
      }
      if ((cur.category || '') !== (src.name || '')) {
        fields.push({ field: 'category', from: cur.category || '', to: src.name || '' });
      }
      if (fields.length) {
        changes.push({ line: cur, src: src, fields: fields });
      }
    });
    lines.forEach(l => {
      if (l && l.source === 'boq' && l.boqRef && !seen[l.boqRef]) {
        const spent = ns.Spend && ns.Spend.budgetLineActual ? ns.Spend.budgetLineActual(l, s) : 0;
        removes.push({ line: l, hasSpend: spent > 0, spent: spent });
      }
    });
    return {
      adds: adds,
      changes: changes,
      removes: removes,
      same: !adds.length && !changes.length && !removes.length,
      total: round2((payload.lines || []).reduce((n, l) => n + (+l.planned || 0), 0))
    };
  }

  function currentTotal(state) {
    const s = state || (ns.State ? ns.State.getState() : null) || {};
    return round2((s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0));
  }

  function baselineOf(state) {
    const s = state || (ns.State ? ns.State.getState() : null) || {};
    const list = Array.isArray(s.budgetBaselines) ? s.budgetBaselines : [];
    return list.length ? list[list.length - 1] : null;
  }

  // ---- apply -------------------------------------------------------------
  // `accepted` is a Set-like object keyed 'add:<ref>' / 'chg:<ref>' /
  // 'rem:<ref>'. Everything else is left exactly as it is.
  function apply(payload, accepted, reason) {
    const pidNow = pid();
    const s = ns.State.getState();
    const plan = planFor(payload, s);
    const note = String(reason || '').trim();
    const by = who();
    let added = 0;
    let changed = 0;
    let removed = 0;
    const firstBaseline = !(Array.isArray(s.budgetBaselines) && s.budgetBaselines.length);
    ns.State.updateState(function (st) {
      if (!Array.isArray(st.budgetLines)) {
        st.budgetLines = [];
      }
      if (!st.nblid) {
        st.nblid = 1;
      }
      if (!Array.isArray(st.budgetVariations)) {
        st.budgetVariations = [];
      }
      plan.adds.forEach(src => {
        if (!accepted['add:' + src.boqRef]) {
          return;
        }
        const id = 'B' + st.nblid++;
        st.budgetLines.push({
          id: id,
          category: src.name || src.description || 'Bill line',
          description: src.description || '',
          planned: round2(src.planned),
          committed: null,
          actual: 0,
          taskId: src.taskId || '',
          curve: 'linear',
          isContingency: src.kind === 'contingency',
          waiverStatus: 'pending',
          waiverReceivedAt: '',
          notes: src.notes || '',
          source: 'boq',
          boqRef: src.boqRef,
          qty: src.qty == null ? null : +src.qty,
          unit: src.unit || '',
          rate: src.rate == null ? null : +src.rate,
          rateUnit: src.unit || '',
          kind: src.kind || 'work',
          phase: src.phase || '',
          baselineId: 'BL' + (st.budgetBaselines.length || 1)
        });
        added++;
      });
      plan.changes.forEach(ch => {
        if (!accepted['chg:' + ch.src.boqRef]) {
          return;
        }
        const line = st.budgetLines.find(l => l && l.id === ch.line.id);
        if (!line) {
          return;
        }
        // One variation per LINE, not per field: a re-priced bill moves the
        // planned figure and the rate together, and two rows for one decision
        // would read as two changes. `fields` says what moved; from/to always
        // carry the planned money, which is what the baseline compares.
        const before = {
          planned: round2(line.planned),
          qty: line.qty == null ? null : +line.qty,
          rate: line.rate == null ? null : +line.rate
        };
        const moved = [];
        ch.fields.forEach(f => {
          line[f.field] = f.to;
          if (f.field === 'planned' || f.field === 'qty' || f.field === 'rate') {
            moved.push(f.field);
          }
        });
        if (moved.length) {
          st.budgetVariations.push({
            id: 'V' + (st.budgetVariations.length + 1),
            at: new Date().toISOString(),
            by: by,
            approver: by,
            lineId: line.id,
            lineName: line.category,
            boqRef: ch.src.boqRef,
            field: 'planned',
            fields: moved,
            from: before.planned,
            to: round2(line.planned),
            qtyFrom: before.qty,
            qtyTo: line.qty == null ? null : +line.qty,
            rateFrom: before.rate,
            rateTo: line.rate == null ? null : +line.rate,
            reason: note,
            baselineId: (baselineOf(st) || {}).id || ''
          });
          changed++;
        }
      });
      plan.removes.forEach(rm => {
        if (!accepted['rem:' + rm.line.boqRef] || rm.hasSpend) {
          return;
        }
        const at = st.budgetLines.findIndex(l => l && l.id === rm.line.id);
        if (at > -1) {
          st.budgetLines.splice(at, 1);
          removed++;
        }
      });
      // Baseline 1 is the budget as it was HANDED OVER, so it is frozen after
      // the first apply lands, not before it. A later apply leaves it alone.
      if (firstBaseline) {
        if (!Array.isArray(st.budgetBaselines)) {
          st.budgetBaselines = [];
        }
        st.budgetBaselines.push({
          id: 'BL1',
          n: 1,
          at: new Date().toISOString(),
          by: by,
          currency: st.currency || 'USD',
          total: round2((st.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0)),
          lines: (st.budgetLines || []).map(l => ({
            id: l.id,
            category: l.category,
            planned: round2(l.planned),
            qty: l.qty == null ? null : +l.qty,
            unit: l.unit || '',
            rate: l.rate == null ? null : +l.rate,
            kind: l.kind || 'manual',
            boqRef: l.boqRef || ''
          })),
          note: 'Frozen when the bill was first applied to this project.'
        });
      }
    });
    if (ns.Render && ns.Render.renderBudget) {
      ns.Render.renderBudget();
    }
    if (ns.Render && ns.Render.renderDash) {
      ns.Render.renderDash();
    }
    return { added: added, changed: changed, removed: removed };
  }

  // ---- dialog ------------------------------------------------------------
  function host() {
    let el = document.getElementById('boq-modal');
    if (el) {
      return el;
    }
    el = document.createElement('div');
    el.id = 'boq-modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'boq-title');
    el.innerHTML =
      '<div class="mb boq-mb">' +
      '<div class="mh"><span class="mt" id="boq-title">Budget from the bill</span>' +
      '<button class="dc" data-action="boqClose" aria-label="Close"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button></div>' +
      '<div class="mbody" id="boq-body"></div>' +
      '<div class="mf"><button class="btn btn-n btn-s" data-action="boqClose">Cancel</button>' +
      '<button class="btn btn-g btn-s" data-action="boqApply" id="boq-apply">Apply</button></div>' +
      '</div>';
    document.body.appendChild(el);
    return el;
  }

  function close() {
    const el = document.getElementById('boq-modal');
    if (el) {
      el.classList.remove('on');
    }
    _open = null;
  }

  function rowFor(kind, ref, title, detail, ticked, disabled, warn) {
    return (
      '<tr class="boq-row boq-' +
      kind +
      '">' +
      '<td class="boq-tick"><input type="checkbox" data-boq-pick="' +
      esc(ref) +
      '"' +
      (ticked ? ' checked' : '') +
      (disabled ? ' disabled' : '') +
      ' aria-label="' +
      esc(title) +
      '"></td>' +
      '<td class="boq-kind">' +
      esc(KIND_LABEL[kind === 'add' ? 'work' : kind] || '') +
      '</td>' +
      '<td class="boq-name">' +
      esc(title) +
      (warn ? '<span class="boq-warn">' + esc(warn) + '</span>' : '') +
      '</td>' +
      '<td class="boq-num">' +
      detail +
      '</td>' +
      '</tr>'
    );
  }

  function open() {
    const projectId = pid();
    const payload = handoffFor(projectId);
    const el = host();
    const body = document.getElementById('boq-body');
    if (!body) {
      return;
    }
    if (!payload) {
      body.innerHTML =
        '<p class="modal-txt">No bill has been sent to this project yet. Open the calculator, price the work, then use <strong>Send bill to project</strong> and pick this project.</p>' +
        '<p class="modal-txt">Your budget lines are unchanged.</p>';
      const applyBtn = document.getElementById('boq-apply');
      if (applyBtn) {
        applyBtn.disabled = true;
      }
      el.classList.add('on');
      _open = { empty: true };
      return;
    }
    const s = ns.State.getState();
    const plan = planFor(payload, s);
    const cur = payload.currency || s.currency || 'USD';
    const existing = currentTotal(s);
    const delta = round2(plan.total - existing);
    const hasChanges = plan.changes.length > 0;
    let rows = '';
    plan.adds.forEach(l => {
      rows += rowFor(
        'add',
        'add:' + l.boqRef,
        l.name,
        money(l.planned, cur) +
          (l.qty != null ? ' · ' + l.qty + ' ' + (l.unit || '') : '') +
          (l.kind && l.kind !== 'work' ? ' · ' + (KIND_LABEL[l.kind] || l.kind) : ''),
        true,
        false,
        ''
      );
    });
    plan.changes.forEach(ch => {
      const detail =
        '<span class="boq-from">' +
        money(ch.fields[0].from, cur) +
        '</span> <span class="boq-arrow" aria-hidden="true">&rarr;</span> <span class="boq-to">' +
        money(ch.fields[0].to, cur) +
        '</span>';
      rows += rowFor('chg', 'chg:' + ch.src.boqRef, ch.src.name, detail, true, false, '');
    });
    plan.removes.forEach(rm => {
      rows += rowFor(
        'rem',
        'rem:' + rm.line.boqRef,
        rm.line.category,
        money(rm.line.planned, cur),
        !rm.hasSpend,
        rm.hasSpend,
        rm.hasSpend
          ? 'Kept - this line already has money recorded against it'
          : 'No longer in the bill'
      );
    });
    const summary = plan.same
      ? 'The budget already matches this bill. Nothing to apply.'
      : plan.adds.length +
        ' new line' +
        (plan.adds.length === 1 ? '' : 's') +
        ', ' +
        plan.changes.length +
        ' changed, ' +
        plan.removes.length +
        ' no longer in the bill.';
    body.innerHTML =
      '<p class="modal-txt"><strong>' +
      esc(payload.billName || 'Bill of quantities') +
      '</strong> was sent ' +
      esc(String(payload.at || '').slice(0, 10)) +
      '. ' +
      esc(summary) +
      '</p>' +
      '<div class="boq-totals"><span>Bill total <strong>' +
      money(plan.total, cur) +
      '</strong></span><span>Budget now <strong>' +
      money(existing, cur) +
      '</strong></span><span>After <strong>' +
      money(plan.total, cur) +
      '</strong> <span class="' +
      (delta >= 0 ? 'boq-up' : 'boq-down') +
      '">' +
      (delta >= 0 ? '+' : '') +
      money(delta, cur) +
      '</span></span></div>' +
      (rows
        ? '<div class="ox boq-scroll"><table class="dt boq-table"><thead><tr><th class="w40"></th><th class="w110">Kind</th><th>Line</th><th class="w220">Money</th></tr></thead><tbody>' +
          rows +
          '</tbody></table></div>'
        : '') +
      (hasChanges
        ? '<label class="boq-reason-lbl" for="boq-reason">Why is this changing?</label>' +
          '<input class="boq-reason" id="boq-reason" type="text" maxlength="240" placeholder="For example: the bill was re-priced after the site visit">' +
          '<p class="boq-hint">A variation is recorded with the reason, who made it and who approved it. The baseline stays as it was.</p>'
        : '');
    const applyBtn = document.getElementById('boq-apply');
    if (applyBtn) {
      applyBtn.disabled = plan.same;
    }
    el.classList.add('on');
    _open = { plan: plan, payload: payload, currency: cur };
    const first = el.querySelector('[data-boq-pick]:not([disabled])');
    if (first) {
      first.focus();
    }
  }

  function applyOpen() {
    if (!_open || !_open.plan) {
      return;
    }
    const plan = _open.plan;
    const box = document.getElementById('boq-modal');
    const accepted = {};
    Array.prototype.forEach.call(
      (box || document).querySelectorAll('[data-boq-pick]'),
      function (cb) {
        if (cb.checked && !cb.disabled) {
          accepted[cb.getAttribute('data-boq-pick')] = true;
        }
      }
    );
    if (plan.changes.length && !Object.keys(accepted).some(k => k.indexOf('chg:') === 0)) {
      // Nothing selected is a valid answer only when there are no changes to
      // explain; otherwise the person has unticked the point of the dialog.
    }
    const reasonEl = document.getElementById('boq-reason');
    const reason = reasonEl ? reasonEl.value : '';
    if (plan.changes.length && Object.keys(accepted).some(k => k.indexOf('chg:') === 0)) {
      if (!String(reason || '').trim()) {
        if (reasonEl) {
          reasonEl.focus();
          reasonEl.classList.add('is-err');
        }
        return;
      }
    }
    const done = apply(_open.payload, accepted, reason);
    close();
    const bits = [];
    if (done.added) {
      bits.push(done.added + ' line' + (done.added === 1 ? '' : 's') + ' added');
    }
    if (done.changed) {
      bits.push(done.changed + ' variation' + (done.changed === 1 ? '' : 's') + ' recorded');
    }
    if (done.removed) {
      bits.push(done.removed + ' line' + (done.removed === 1 ? '' : 's') + ' removed');
    }
    if (ns.App && ns.App.showToast) {
      ns.App.showToast(
        bits.length ? 'Budget updated: ' + bits.join(', ') + '.' : 'Nothing changed.',
        'ok'
      );
    }
  }

  // ---- the baseline strip under the summary cards ------------------------
  function renderBaselineStrip() {
    const el = document.getElementById('bud-baseline');
    if (!el) {
      return;
    }
    const s = ns.State.getState();
    const bl = baselineOf(s);
    const vars = Array.isArray(s.budgetBaselines) && s.budgetVariations ? s.budgetVariations : [];
    if (!bl) {
      el.classList.add('is-hide');
      el.innerHTML = '';
      return;
    }
    const cur = s.currency || 'USD';
    const varTotal = vars.reduce(
      (n, v) => n + (v.field === 'planned' ? (+v.to || 0) - (+v.from || 0) : 0),
      0
    );
    el.classList.remove('is-hide');
    el.innerHTML =
      '<span class="bl-k">Baseline ' +
      esc(bl.n) +
      '</span> ' +
      '<span class="bl-v">' +
      esc(money(bl.total, bl.currency || cur)) +
      '</span>' +
      '<span class="bl-m">frozen ' +
      esc(String(bl.at || '').slice(0, 10)) +
      ' by ' +
      esc(bl.by || 'Owner') +
      '</span>' +
      (vars.length
        ? '<span class="bl-m">' +
          esc(vars.length) +
          ' variation' +
          (vars.length === 1 ? '' : 's') +
          ', ' +
          esc((varTotal >= 0 ? '+' : '') + money(varTotal, cur)) +
          '</span>'
        : '<span class="bl-m">No variations</span>');
  }

  ns.BoqBridge = {
    readHandoff: handoffFor,
    planFor: planFor,
    fingerprint: fingerprint,
    open: open,
    close: close,
    applyOpen: applyOpen,
    renderBaselineStrip: renderBaselineStrip
  };
})(MMGR);
window.MMGR = MMGR;
