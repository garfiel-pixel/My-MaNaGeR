/* ============================================================
   My MaNaGeR , Weekly tracking
   ============================================================
   H-4 of BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05.

   One week at a time, Monday to Sunday (Q7), read from the same money
   functions the rest of the app uses - Spend.budgetLineActual,
   Spend.actualCumulativeAt and Spend.budgetCumulativePlannedAt - so the
   weekly view can never disagree with the Budget cards.

   Every figure here is DERIVED. The selected week is held in this module,
   never in project state, so changing it cannot write anything (the gate
   asserts exactly that).

   Exports: a PDF and a spreadsheet of the week on screen. They are the
   owner/editor copy (Q6): the project report's counts-only rule (A9) is
   untouched.
   ============================================================ */
var MMGR = window.MMGR || {};
(function (ns) {
  'use strict';
  const U = ns.Utils;
  // The selected week. Deliberately module state, not project state.
  let _week = '';

  function esc(v) {
    return U && U.escapeHtml
      ? U.escapeHtml(v == null ? '' : String(v))
      : String(v == null ? '' : v);
  }
  function money(n, cur) {
    const c = cur || (ns.State.getState() || {}).currency || 'USD';
    return U && U.fmtMoney ? U.fmtMoney(+n || 0, c) : '$' + Math.round(+n || 0).toLocaleString(); // ok: fixed currency table + digits only
  }
  function pct(n) {
    return Math.round(+n || 0) + '%';
  }

  // Monday of the week a date falls in, as YYYY-MM-DD.
  function weekStart(date) {
    const d = date instanceof Date ? new Date(date.getTime()) : U.parseDL(String(date || ''));
    if (!d || isNaN(d.getTime())) {
      return '';
    }
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 Sunday .. 6 Saturday
    const back = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - back);
    return U.dateToISO ? U.dateToISO(d) : isoOf(d);
  }
  function isoOf(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function addDays(iso, n) {
    const d = U.parseDL(iso);
    d.setDate(d.getDate() + n);
    return isoOf(d);
  }

  // Every week that has money in it, plus the week of today. Sorted.
  function weeks(state) {
    const s = state || ns.State.getState();
    const set = {};
    (s.spendLog || []).forEach(e => {
      if (e && e.date) {
        const w = weekStart(e.date);
        if (w) {
          set[w] = 1;
        }
      }
    });
    const now = weekStart(new Date());
    if (now) {
      set[now] = 1;
    }
    return Object.keys(set).sort();
  }

  // The line's earned fraction, using the app's own rule: a linked task's
  // completion, otherwise the blanket completion of all tasks.
  function earnedFraction(line, s) {
    const tasks = s.tasks || [];
    const linkId = line.linkedTaskId || line.taskId || null;
    if (linkId) {
      const t = tasks.find(x => String(x.id) === String(linkId));
      if (t) {
        return t.status === 'completed' ? 1 : 0;
      }
    }
    return tasks.length ? tasks.filter(t => t.status === 'completed').length / tasks.length : 0;
  }

  // Everything the view shows is AS OF the selected week's last day, so a
  // historical week reads as it did then - not as the project looks today.
  function summary(state, weekISO) {
    const s = state || ns.State.getState();
    const Spend = ns.Spend;
    const cur = s.currency || 'USD';
    const all = weeks(s);
    const w =
      weekISO && all.indexOf(weekISO) > -1 ? weekISO : all[all.length - 1] || weekStart(new Date());
    const from = w;
    const to = addDays(w, 6);
    const toDate = U.parseDL(to);
    toDate.setHours(23, 59, 59, 999);
    const log = (s.spendLog || []).filter(e => e && Spend.spendIsSpent(e));
    const lines = s.budgetLines || [];
    const rows = lines.map(l => {
      const own = log.filter(e => e.budgetLineId === l.id);
      const asOf = own.filter(e => !e.date || e.date <= to);
      const planned = +l.planned || 0;
      const spent = own.length ? asOf.reduce((n, e) => n + (+e.amount || 0), 0) : +l.actual || 0;
      const spentWeek = own
        .filter(e => e.date && e.date >= from && e.date <= to)
        .reduce((n, e) => n + (+e.amount || 0), 0);
      const usedPct = planned ? (spent / planned) * 100 : 0;
      const frac = earnedFraction(l, s);
      const baseQty = l.qty == null ? null : +l.qty || 0;
      const baseRate = l.rate == null ? null : +l.rate || 0;
      let qty = 0;
      let priceVar = 0;
      let latest = null;
      let anyQty = false;
      asOf.forEach(e => {
        if (e.qty != null && e.unitPrice != null) {
          anyQty = true;
          const q = +e.qty || 0;
          qty += q;
          priceVar += (Math.round((+e.unitPrice || 0) * 1e6) / 1e6 - (baseRate || 0)) * q;
          if (!latest || (e.date || '') >= (latest.date || '')) {
            latest = { date: e.date || '', price: +e.unitPrice || 0 };
          }
        }
      });
      const qtyLeft = baseQty == null ? null : Math.max(0, baseQty - qty);
      // Forecast at completion: what is left to receive at the LATEST price
      // paid, or - when the line has no quantity - the cost-performance
      // method (spent / earned fraction).
      let fcac = null;
      if (anyQty && baseQty != null && latest) {
        fcac = spent + qtyLeft * latest.price;
      } else if (frac > 0) {
        fcac = spent / frac;
      } else {
        fcac = planned;
      }
      // Q5: watch at 80 percent of the line's plan, over above 100 percent.
      let chip = 'ontrack';
      if (planned && usedPct > 100) {
        chip = 'over';
      } else if (planned && usedPct >= 80) {
        chip = 'watch';
      }
      if (priceVar > 0.005) {
        chip = chip === 'over' ? 'over' : 'price';
      }
      return {
        id: l.id,
        name: l.category || l.id,
        planned: planned,
        spent: spent,
        spentWeek: spentWeek,
        usedPct: usedPct,
        chip: chip,
        priceVar: priceVar,
        qtyVar: baseQty == null || baseRate == null ? null : planned - baseRate * qty,
        fcac: fcac,
        qty: baseQty,
        unit: l.unit,
        qtyReceived: qty,
        hasQty: anyQty && baseQty != null
      };
    });
    const spentToDate = rows.reduce((n, r) => n + r.spent, 0);
    const spentWeek = rows.reduce((n, r) => n + r.spentWeek, 0);
    const planned = rows.reduce((n, r) => n + r.planned, 0);
    const fcac = rows.reduce((n, r) => n + (r.fcac || 0), 0);
    const priceVar = rows.reduce((n, r) => n + (r.priceVar || 0), 0);
    const qtyVar = rows.reduce((n, r) => n + (r.qtyVar || 0), 0);
    const planToDate =
      Spend && Spend.budgetCumulativePlannedAt ? Spend.budgetCumulativePlannedAt(toDate, s) : 0;
    const tasks = s.tasks || [];
    const workPct = tasks.length
      ? (tasks.filter(t => t.status === 'completed').length / tasks.length) * 100
      : 0;
    return {
      week: w,
      from: from,
      to: to,
      weeks: all,
      currency: cur,
      rows: rows,
      spentWeek: spentWeek,
      spentToDate: spentToDate,
      planToDate: planToDate,
      planned: planned,
      moneyPct: planned ? (spentToDate / planned) * 100 : 0,
      workPct: workPct,
      forecast: fcac,
      priceVar: priceVar,
      qtyVar: qtyVar,
      baseline: (function () {
        const list = Array.isArray(s.budgetBaselines) ? s.budgetBaselines : [];
        return list.length ? list[list.length - 1] : null;
      })()
    };
  }

  const CHIP = {
    ontrack: 'On track',
    watch: 'Watch',
    over: 'Over',
    price: 'Price above BOQ rate'
  };

  function render() {
    const body = document.getElementById('bud-weekly-body');
    const cards = document.getElementById('bud-weekly-cards');
    const sel = document.getElementById('bud-week');
    const sub = document.getElementById('bud-weekly-sub');
    if (!body || !cards) {
      return;
    }
    const s = ns.State.getState();
    const d = summary(s, _week);
    _week = d.week;
    if (sel) {
      sel.innerHTML = d.weeks
        .map(function (w) {
          return (
            '<option value="' +
            esc(w) +
            '"' +
            (w === d.week ? ' selected' : '') +
            '>Week of ' +
            esc(w) +
            '</option>'
          );
        })
        .join('');
    }
    if (sub) {
      sub.textContent = d.from + ' to ' + d.to + ' (Monday to Sunday)';
    }
    const cur = d.currency;
    const card = (k, v, note, cls) =>
      '<div class="wk-card"><div class="wk-k">' +
      esc(k) +
      '</div><div class="wk-v ' +
      (cls || '') +
      '">' +
      esc(v) +
      '</div>' +
      (note ? '<div class="wk-n">' + esc(note) + '</div>' : '') +
      '</div>';
    cards.innerHTML =
      card('Spent this week', money(d.spentWeek, cur)) +
      card('Spent to date', money(d.spentToDate, cur), 'Plan to date ' + money(d.planToDate, cur)) +
      card(
        'Money used vs work done',
        pct(d.moneyPct) + ' / ' + pct(d.workPct),
        d.workPct
          ? 'Money is ' + pct(d.moneyPct - d.workPct) + ' ahead of work'
          : 'No tasks to measure work'
      ) +
      card(
        'Forecast at completion',
        money(d.forecast, cur),
        d.planned ? 'Against a plan of ' + money(d.planned, cur) : '',
        d.forecast > d.planned + 0.005 ? 'var-neg' : ''
      ) +
      card(
        'Variance split',
        (d.priceVar >= 0 ? '+' : '') + money(d.priceVar, cur) + ' price',
        (d.qtyVar >= 0 ? '+' : '') + money(d.qtyVar, cur) + ' quantity'
      );
    body.innerHTML = d.rows
      .map(function (r) {
        const cls =
          r.chip === 'over'
            ? 'wk-over'
            : r.chip === 'watch'
              ? 'wk-watch'
              : r.chip === 'price'
                ? 'wk-price'
                : 'wk-ontrack';
        return (
          '<tr>' +
          '<td>' +
          esc(r.name) +
          '</td>' +
          '<td>' +
          money(r.planned, cur) +
          '</td>' +
          '<td>' +
          money(r.spent, cur) +
          '</td>' +
          '<td>' +
          money(r.spentWeek, cur) +
          '</td>' +
          '<td>' +
          pct(r.usedPct) +
          '</td>' +
          '<td><span class="wk-chip ' +
          cls +
          '">' +
          esc(CHIP[r.chip]) +
          '</span></td>' +
          '<td>' +
          money(r.fcac, cur) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function setWeek(w) {
    _week = w || '';
    render();
  }

  // ---- exports -----------------------------------------------------------
  // The rows on screen, in the same order, with the same numbers. Both
  // exports are built from summary(), never from the DOM, so a scrolled or
  // filtered table cannot change what is exported.
  function exportRows(d) {
    const rows = [
      ['Line', 'Planned', 'Spent', 'Spent this week', 'Used %', 'Status', 'Forecast at completion']
    ];
    d.rows.forEach(r => {
      rows.push([
        r.name,
        Math.round(r.planned * 100) / 100,
        Math.round(r.spent * 100) / 100,
        Math.round(r.spentWeek * 100) / 100,
        Math.round(r.usedPct),
        CHIP[r.chip],
        Math.round((r.fcac || 0) * 100) / 100
      ]);
    });
    rows.push([
      'Total',
      Math.round(d.planned * 100) / 100,
      Math.round(d.spentToDate * 100) / 100,
      Math.round(d.spentWeek * 100) / 100,
      Math.round(d.moneyPct),
      '',
      Math.round(d.forecast * 100) / 100
    ]);
    return rows;
  }

  function fileBase() {
    const s = ns.State.getState();
    const name = (s.projectName || 'project').replace(/[^A-Za-z0-9._-]+/g, '-');
    return name + '-weekly-' + (_week || weekStart(new Date()));
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 400);
  }

  function exportXlsx() {
    const d = summary(ns.State.getState(), _week);
    if (!ns.XlsxLite || !ns.XlsxLite.build) {
      if (ns.App) {
        ns.App.showToast('Spreadsheet export is unavailable.', 'err');
      }
      return;
    }
    const rows = [
      ['Weekly budget report'],
      ['Project', (ns.State.getState() || {}).projectName || ''],
      ['Week', d.from + ' to ' + d.to],
      ['Currency', d.currency],
      [],
      ...exportRows(d)
    ];
    const bytes = ns.XlsxLite.build([
      {
        name: 'Weekly',
        rows: rows,
        widths: [34, 16, 16, 18, 10, 22, 22],
        money: [1, 2, 3, 6],
        bold: [0, 5]
      }
    ]);
    download(
      new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }),
      fileBase() + '.xlsx'
    );
    if (ns.App) {
      ns.App.showToast('Weekly report exported as a spreadsheet.', 'ok');
    }
  }

  function exportPdf() {
    const d = summary(ns.State.getState(), _week);
    if (!ns.Pdf || !ns.Pdf.build) {
      if (ns.App) {
        ns.App.showToast('PDF export is unavailable.', 'err');
      }
      return;
    }
    const W = 900;
    const M = 40;
    const prims = [];
    const text = function (x, y, str, o) {
      prims.push(
        Object.assign(
          { type: 'text', x: x, y: y, str: String(str), size: 11, fill: '#111827', weight: 400 },
          o || {}
        )
      );
    };
    const line = function (x1, y1, x2, y2, o) {
      prims.push(
        Object.assign(
          { type: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: '#d1d5db', lw: 1 },
          o || {}
        )
      );
    };
    const s = ns.State.getState();
    text(M, 50, 'WEEKLY BUDGET REPORT', { size: 20, weight: 700 });
    text(W - M, 50, d.from + ' to ' + d.to, { size: 12, align: 'right', fill: '#6b7280' });
    text(M, 70, s.projectName || 'Project', { size: 12, fill: '#374151' });
    text(W - M, 70, 'All money in ' + d.currency, { size: 11, align: 'right', fill: '#6b7280' });
    line(M, 82, W - M, 82, { stroke: '#111827', lw: 1.5 });
    // Summary band
    let y = 104;
    const facts = [
      ['Spent this week', money(d.spentWeek, d.currency)],
      ['Spent to date', money(d.spentToDate, d.currency)],
      ['Plan to date', money(d.planToDate, d.currency)],
      ['Money used', pct(d.moneyPct)],
      ['Work done', pct(d.workPct)],
      ['Forecast at completion', money(d.forecast, d.currency)]
    ];
    facts.forEach(function (f, i) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = M + col * 270;
      const yy = y + row * 34;
      text(x, yy, f[0], { size: 9, fill: '#6b7280', weight: 700 });
      text(x, yy + 14, f[1], { size: 12, weight: 700 });
    });
    y += 84;
    // Table
    const cols = [M, M + 250, M + 390, M + 510, M + 620, M + 690, M + 790];
    const head = ['Line', 'Planned', 'Spent', 'This week', 'Used', 'Status', 'Forecast'];
    head.forEach(function (h, i) {
      text(cols[i], y, h, { size: 9, fill: '#6b7280', weight: 700 });
    });
    y += 6;
    line(M, y, W - M, y, { stroke: '#111827', lw: 1 });
    y += 18;
    d.rows.forEach(function (r) {
      text(cols[0], y, r.name.slice(0, 40));
      text(cols[1], y, money(r.planned, d.currency), { align: 'right', x: cols[2] - 10 });
      text(cols[2], y, money(r.spent, d.currency), { align: 'right', x: cols[3] - 10 });
      text(cols[3], y, money(r.spentWeek, d.currency), { align: 'right', x: cols[4] - 10 });
      text(cols[4], y, pct(r.usedPct), { align: 'right', x: cols[5] - 10 });
      text(cols[5], y, CHIP[r.chip], { size: 9, fill: '#374151' });
      text(cols[6], y, money(r.fcac, d.currency), { align: 'right', x: W - M });
      y += 18;
    });
    line(M, y, W - M, y, { stroke: '#111827', lw: 1 });
    y += 18;
    text(M, y, 'Total', { weight: 700 });
    text(cols[1], y, money(d.planned, d.currency), {
      align: 'right',
      x: cols[2] - 10,
      weight: 700
    });
    text(cols[2], y, money(d.spentToDate, d.currency), {
      align: 'right',
      x: cols[3] - 10,
      weight: 700
    });
    text(cols[3], y, money(d.spentWeek, d.currency), {
      align: 'right',
      x: cols[4] - 10,
      weight: 700
    });
    text(cols[4], y, pct(d.moneyPct), { align: 'right', x: cols[5] - 10, weight: 700 });
    text(cols[6], y, money(d.forecast, d.currency), { align: 'right', x: W - M, weight: 700 });
    y += 34;
    text(
      M,
      y,
      'Variance: ' +
        (d.priceVar >= 0 ? '+' : '') +
        money(d.priceVar, d.currency) +
        ' price, ' +
        (d.qtyVar >= 0 ? '+' : '') +
        money(d.qtyVar, d.currency) +
        ' quantity.',
      { size: 10, fill: '#374151' }
    );
    y += 16;
    text(M, y, 'Owner and editor copy. The project report stays counts-only.', {
      size: 9,
      fill: '#6b7280'
    });
    const res = ns.Pdf.build(prims, { page: 'fit', W: W, H: y + 40, hdrPx: 0 });
    download(new Blob([res.bytes], { type: 'application/pdf' }), fileBase() + '.pdf');
    if (ns.App) {
      ns.App.showToast('Weekly report exported as a PDF.', 'ok');
    }
  }

  ns.Weekly = {
    weekStart: weekStart,
    weeks: weeks,
    summary: summary,
    render: render,
    setWeek: setWeek,
    exportXlsx: exportXlsx,
    exportPdf: exportPdf
  };
})(MMGR);
window.MMGR = MMGR;
