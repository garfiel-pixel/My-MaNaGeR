/* ============================================================
   My MaNaGeR — Financials Panel
   Money formatter, Spend Log, Cash-Flow S-Curve, Budget,
   Pay Applications.
   Extracted from mmgr-render.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State ? ns.State.getState() : null;
  const U = ns.Utils;
  const $ = U.$;

  function emptyStateRow(colspan, text, actionsHtml) {
    return '<tr><td colspan="' + colspan + '"><div class="es es-row">' +
      '<div>' + text + '</div>' +
      (actionsHtml ? '<div class="es-actions">' + actionsHtml + '</div>' : '') +
      '</div></td></tr>';
  }

  function fmt$(n) {
    const s = n < 0 ? '-' : '';
    return s + '$' + Math.abs(Math.round(+n || 0)).toLocaleString();
  }

  function renderSpendLog() {
    const s = S();
    if (!s) return;
    const b = $('spendlog-body');
    if (!b) return;
    const log = s.spendLog || [];
    const lines = s.budgetLines || [];
    if (log.length === 0) {
      b.innerHTML = '<tr><td colspan="5"><div class="es" style="padding:10px;font-size:.72rem">No dated spend logged yet — the cash flow chart\'s Actual line is estimated until you add entries here.</div></td></tr>';
      return;
    }
    const lineOpts = (cur) => lines.map(l =>
      `<option value="${U.escapeHtml(l.id)}" ${cur === l.id ? 'selected' : ''}>${U.escapeHtml(l.category || 'Untitled')}</option>`
    ).join('');
    b.innerHTML = log.map((e, i) => `<tr>
      <td><input type="date" value="${e.date || ''}" data-action="updSpendEntry" data-idx="${i}" data-field="date"></td>
      <td><select data-action="updSpendEntry" data-idx="${i}" data-field="budgetLineId">${lineOpts(e.budgetLineId)}</select></td>
      <td><input type="number" value="${e.amount || 0}" min="0" step="10" data-action="updSpendEntry" data-idx="${i}" data-field="amount" style="width:90px"></td>
      <td><input type="text" value="${U.escapeHtml(e.notes || '')}" data-action="updSpendEntry" data-idx="${i}" data-field="notes" placeholder="Invoice #, vendor..."></td>
      <td><button class="btn btn-s btn-d" data-action="delSpendEntry" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  function renderCashFlowChart() {
    const s = S();
    if (!s) return;
    const wrap = $('cashflow-chart');
    if (!wrap) return;
    const dated = (s.tasks || []).filter(t => t.startDate && t.endDate);
    if (!dated.length || !(s.budgetLines || []).length) {
      wrap.innerHTML = '<div class="es" style="padding:14px;font-size:.76rem">Add budget lines and schedule at least one task to see the cash flow forecast.</div>';
      return;
    }
    const Spend = ns.Spend;
    if (!Spend) { wrap.innerHTML = ''; return; }
    const starts = dated.map(t => U.parseDL(t.startDate).getTime());
    const ends = dated.map(t => U.parseDL(t.endDate).getTime());
    const projStart = new Date(Math.min.apply(null, starts));
    const projEnd = new Date(Math.max.apply(null, ends));
    const totalDays = Math.max(1, Math.round((projEnd - projStart) / 86400000));
    const buckets = Math.min(24, Math.max(6, Math.round(totalDays / 14)));
    const step = totalDays / buckets;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const pts = [];
    for (let i = 0; i <= buckets; i++) {
      const d = U.addDays(projStart, Math.round(i * step));
      pts.push({ date: d, planned: Spend.budgetCumulativePlannedAt(d, s), actual: Spend.actualCumulativeAt(d, s) });
    }
    const maxVal = Math.max.apply(null, [1].concat(pts.map(p => Math.max(p.planned, p.actual))));
    const W = 680, H = 220, padL = 64, padB = 20, padT = 14, padR = 14;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const x = (i) => padL + (i / buckets) * plotW;
    const y = (v) => padT + plotH - (v / maxVal) * plotH;
    const plannedPts = pts.map((p, i) => `${x(i)},${y(p.planned)}`).join(' ');
    let todayBucket = buckets;
    for (let i = 0; i <= buckets; i++) { if (pts[i].date >= today) { todayBucket = i; break; } }
    const actualPts = pts.filter(p => p.date <= today).map((p, i) => `${x(i)},${y(p.actual)}`).join(' ');
    const gridLines = [0, .25, .5, .75, 1].map(f => {
      const yy = padT + plotH - (f * plotH);
      return `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--border)" stroke-width="1"/><text x="${padL - 8}" y="${yy + 3}" font-size="9" fill="var(--slate)" text-anchor="end">${fmt$(maxVal * f)}</text>`;
    }).join('');
    const hasLog = (s.spendLog || []).length > 0;
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:240px">
    ${gridLines}
    <line x1="${x(todayBucket)}" y1="${padT}" x2="${x(todayBucket)}" y2="${H - padB}" stroke="var(--slate)" stroke-dasharray="3,3" stroke-width="1"/>
    <text x="${x(todayBucket) + 4}" y="${padT + 10}" font-size="9" fill="var(--slate)">Today</text>
    <polyline points="${plannedPts}" fill="none" stroke="var(--gold)" stroke-width="2"/>
    ${actualPts ? `<polyline points="${actualPts}" fill="none" stroke="var(--green)" stroke-width="2"/>` : ''}
  </svg>
  <div style="display:flex;gap:16px;font-size:.68rem;color:var(--slate);margin-top:4px;flex-wrap:wrap">
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--gold);border-radius:2px;margin-right:4px"></span>Planned (time-phased)</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--green);border-radius:2px;margin-right:4px"></span>Actual${hasLog ? '' : ' (estimated — log dated spend below for a real actual line)'}</span>
  </div>`;
  }

  function renderBudget() {
    const s = S();
    if (!s) return;
    const body = $('bud-body');
    if (!body) return;
    const lines = s.budgetLines || [];
    const envelope = s.budgetEnvelope || 0;
    const planned = lines.reduce((sum, l) => sum + (+l.planned || 0), 0);
    const actual = lines.reduce((sum, l) => sum + (+l.actual || 0), 0);
    const remaining = envelope - actual;
    const unallocated = envelope - planned;
    const lineCommitted = (l) => (l.committed !== null && l.committed !== undefined && l.committed !== '')
      ? +l.committed || 0 : +l.planned || 0;
    const committed = lines.reduce((sum, l) => sum + lineCommitted(l), 0);
    const committedGap = Math.max(0, committed - actual);
    const setVal = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    setVal('bud-envelope-disp', '$' + Number(envelope).toLocaleString());
    setVal('bud-committed', '$' + committed.toLocaleString());
    setVal('bud-committed-pct', envelope ? Math.round((committed/envelope)*100) + '% of envelope' : '0%');
    setVal('bud-committed-gap', committedGap > 0 ? '$' + committedGap.toLocaleString() + ' committed, not yet spent' : 'All committed spend is out');
    const gapEl = $('bud-committed-gap');
    if (gapEl) gapEl.style.color = committedGap > 0 ? 'var(--amber)' : 'var(--slate)';
    setVal('bud-ta', '$' + actual.toLocaleString());
    setVal('bud-spent-pct', envelope ? Math.round((actual/envelope)*100) + '% of envelope' : '0%');
    setVal('bud-remaining', '$' + Math.max(0, remaining).toLocaleString());
    setVal('bud-remaining-pct', remaining >= 0 ? 'On budget' : 'Over budget');
    const remainingPctEl = $('bud-remaining-pct');
    if (remainingPctEl) remainingPctEl.style.color = remaining >= 0 ? 'var(--slate)' : 'var(--danger)';
    setVal('bud-unallocated', '$' + Math.max(0, unallocated).toLocaleString());
    setVal('bud-bar-pct-label', envelope ? Math.round((actual/envelope)*100) + '%' : '0%');
    const bar = $('bud-bar');
    if (bar) bar.style.width = envelope ? Math.min(100, (actual/envelope)*100) + '%' : '0%';
    const warn = $('bud-bar-warn');
    if (warn) warn.classList.toggle('is-hide', !(actual > envelope));
    const overrun = $('bud-overrun-alert');
    const overrunAmt = $('bud-overrun-amt');
    if (overrun && overrunAmt) {
      if (planned > envelope) {
        overrun.classList.remove('is-hide');
        overrunAmt.textContent = '$' + (planned - envelope).toLocaleString();
      } else {
        overrun.classList.add('is-hide');
      }
    }
    renderSpendLog();
    renderCashFlowChart();
    if (lines.length === 0) {
      body.innerHTML = emptyStateRow(14, 'No budget lines yet.', '<button class="btn btn-g btn-s" data-action="addBudgetLine">+ Add Budget Line</button>');
      return;
    }
    const wTotal = lines.length;
    const wRecv = lines.filter(l => l.waiverStatus === 'unconditional' || l.waiverStatus === 'conditional').length;
    const wPending = lines.filter(l => !l.waiverStatus || l.waiverStatus === 'pending').length;
    const wReq = lines.filter(l => l.waiverStatus === 'not_required').length;
    const waiverTxt = wTotal
      ? (wRecv + ' received · ' + wPending + ' pending · ' + wReq + ' not required')
      : '';
    setVal('bud-waivers', waiverTxt);
    const waiverEl = $('bud-waivers-wrap');
    if (waiverEl) waiverEl.classList.toggle('is-hide', !waiverTxt);
    body.innerHTML = lines.map((l, i) => `<tr>
      <td>${U.escapeHtml(l.id || 'B' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(l.category)}" data-action="updField" data-module="Budget" data-field="category" data-idx="${i}"></td>
      <td><input type="number" value="${l.planned || 0}" min="0" step="100" data-action="updField" data-module="Budget" data-field="planned" data-idx="${i}" style="width:90px"></td>
      <td><input type="number" value="${l.committed !== null && l.committed !== undefined && l.committed !== '' ? l.committed : ''}" min="0" step="100" data-action="updField" data-module="Budget" data-field="committed" data-idx="${i}" style="width:90px" placeholder="${l.planned || 0}" title="Committed $ — blank defaults to Planned (C12)"></td>
      <td><input type="number" value="${l.actual || 0}" min="0" step="100" data-action="updField" data-module="Budget" data-field="actual" data-idx="${i}" style="width:90px"></td>
      <td style="color:${((l.planned || 0) - (l.actual || 0)) >= 0 ? 'var(--green)' : 'var(--danger)'}">${((l.planned || 0) - (l.actual || 0)) >= 0 ? '+' : ''}$${Math.abs((l.planned || 0) - (l.actual || 0)).toLocaleString()}</td>
      <td>${envelope ? Math.round(((l.actual || 0) / envelope) * 100) + '%' : '0%'}</td>
      <td><select data-action="updField" data-module="Budget" data-field="taskId" data-idx="${i}"><option value="">—</option>${(s.tasks || []).map(t => `<option ${t.id === l.taskId ? 'selected' : ''}>${U.escapeHtml(t.id)}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="Budget" data-field="curve" data-idx="${i}">${['linear','front-loaded','back-loaded','bell'].map(c => `<option ${l.curve === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><input type="checkbox" ${l.isContingency ? 'checked' : ''} data-action="updField" data-module="Budget" data-field="isContingency" data-idx="${i}" title="Contingency reserve — compared against risk exposure (2.5)"></td>
      <td><select data-action="updField" data-module="Budget" data-field="waiverStatus" data-idx="${i}" title="Lien waiver status">${['pending','conditional','unconditional','not_required'].map(w => `<option ${(l.waiverStatus || 'pending') === w ? 'selected' : ''}>${w}</option>`).join('')}</select></td>
      <td><input type="date" value="${U.escapeHtml(l.waiverReceivedAt || '')}" data-action="updField" data-module="Budget" data-field="waiverReceivedAt" data-idx="${i}" title="Date the waiver was received"></td>
      <td><input type="text" value="${U.escapeHtml(l.notes || '')}" data-action="updField" data-module="Budget" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delBudgetLine" data-idx="${i}">×</button></td>
    </tr>`).join('');
    const rcc = $('risk-cont-con');
    if (rcc) {
      const Render = ns.Render || {};
      const exposure = Render.riskExposure ? Render.riskExposure(s) : 0;
      const cont = Render.contingencyTotal ? Render.contingencyTotal(s) : 0;
      if (!exposure && !cont) {
        rcc.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">Add a cost estimate to any risk in the Risk tab, then flag a budget line as Contingency here to compare the two.</div>';
      } else {
        const gap = exposure - cont;
        rcc.innerHTML = '<div class="wx-stats">' +
          '<div class="wx-stat"><div class="k">Risk Exposure (expected value)</div><div class="v ' + (exposure ? 'var-neg' : '') + '">$' + Math.round(exposure).toLocaleString() + '</div></div>' +
          '<div class="wx-stat"><div class="k">Contingency Reserved</div><div class="v">$' + Math.round(cont).toLocaleString() + '</div></div>' +
          '<div class="wx-stat"><div class="k">' + (gap > 0 ? 'Exposure Gap' : 'Covered') + '</div><div class="v ' + (gap > 0 ? 'var-neg' : 'var-pos') + '">' + (gap > 0 ? '$' + Math.round(gap).toLocaleString() : 'covered') + '</div></div>' +
          '</div>';
      }
    }
    if (ns.Claim && ns.Claim.renderLdRollup) ns.Claim.renderLdRollup();
    renderPayApps();
  }

  function renderPayApps() {
    const s = S();
    if (!s) return;
    const body = $('payapp-body');
    if (!body) return;
    const apps = s.payApps || [];
    const sum = $('payapp-sum');
    const billed = apps.filter(a => a.status === 'approved' || a.status === 'submitted').reduce((t, a) => t + (+a.amount || 0), 0);
    if (sum) sum.textContent = apps.length ? (apps.length + ' on file · $' + billed.toLocaleString() + ' billed') : '';
    if (apps.length === 0) {
      body.innerHTML = emptyStateRow(8, 'No pay applications yet.', '<button class="btn btn-g btn-s" data-action="addPayApp">+ Add Pay App</button><button class="btn btn-n btn-s" data-action="genPayApp"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Generate from live spend</button>');
      return;
    }
    const statusColor = (st) => st === 'approved' ? 'var(--green)' : st === 'submitted' ? 'var(--gold)' : st === 'rejected' ? 'var(--danger)' : 'var(--slate)';
    body.innerHTML = apps.map((a, i) => `<tr>
      <td>${U.escapeHtml(a.number || a.id || 'PA' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(a.period)}" data-action="updField" data-module="PayApps" data-field="period" data-idx="${i}" placeholder="e.g. Aug 2026"></td>
      <td><input type="number" value="${a.amount || 0}" min="0" step="100" data-action="updField" data-module="PayApps" data-field="amount" data-idx="${i}" style="width:100px"></td>
      <td><select data-action="updField" data-module="PayApps" data-field="status" data-idx="${i}" style="color:${statusColor(a.status)}">${['draft','submitted','approved','rejected'].map(v => `<option ${a.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="date" value="${a.dateSubmitted || ''}" data-action="updField" data-module="PayApps" data-field="dateSubmitted" data-idx="${i}"></td>
      <td><input type="date" value="${a.dateApproved || ''}" data-action="updField" data-module="PayApps" data-field="dateApproved" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(a.notes || '')}" data-action="updField" data-module="PayApps" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delPayApp" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  ns.RenderFinancials = {
    fmt$: fmt$,
    renderSpendLog: renderSpendLog,
    renderCashFlowChart: renderCashFlowChart,
    renderBudget: renderBudget,
    renderPayApps: renderPayApps
  };
})(MMGR);
window.MMGR = MMGR;
