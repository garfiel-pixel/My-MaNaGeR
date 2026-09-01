/* ============================================================
   My MaNaGeR , EVM (Earned Value Management) Module
   Ported from the monolith (MONOLITH-PORTING-GUIDE feature 4).
   computeEVM() is the single source of truth for every earned-value
   number in the app (dashboard card, linked KPIs, AI prompts).
   Returns null when there's not enough data yet (no tasks or no
   planned budget) , same "no fabricated numbers" rule as Health.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  function computeEVM(state) {
    const s = state || (ns.State ? ns.State.getState() : null);
    if (!s || !s.tasks) return null;
    const tot = s.tasks.length;
    const dn = s.tasks.filter(t => t.status === 'completed').length;
    const pct = tot ? dn / tot : 0;
    const Spend = ns.Spend;
    const tp = ((s.budgetLines || []).reduce((sum, b) => sum + (+b.planned || 0), 0));
    const ta = Spend && Spend.budgetLineActual
      ? (s.budgetLines || []).reduce((sum, b) => sum + Spend.budgetLineActual(b, s), 0)
      : (s.budgetLines || []).reduce((sum, b) => sum + (+b.actual || 0), 0);
    if (!tp || !tot) return null;

    // Planned Value is the time-phased cumulative planned spend as of today;
    // Earned Value credits each line by its linked task's completion (or the
    // blanket completion % when unlinked), same math as the monolith.
    const pv = Spend && Spend.budgetCumulativePlannedAt ? Spend.budgetCumulativePlannedAt(new Date(), s) : tp * pct;
    const ev = (s.budgetLines || []).reduce((sum, l) => {
      const planned = +l.planned || 0;
      const linkId = l.linkedTaskId || l.taskId || null;
      if (linkId) {
        const t = s.tasks.find(x => String(x.id) === String(linkId));
        if (t) return sum + planned * (t.status === 'completed' ? 1 : 0);
      }
      return sum + planned * pct;
    }, 0);
    const ac = ta;
    const spi = pv ? ev / pv : null;
    const cpi = ac ? ev / ac : null;
    const sv = ev - pv;
    const cv = ev - ac;
    const bac = tp;
    const eac = cpi ? ac + (bac - ev) / cpi : null;
    const etc = (eac !== null) ? eac - ac : null;
    const vac = (eac !== null) ? bac - eac : null;
    const tden = bac - ac;
    const tcpi = (tden !== 0) ? (bac - ev) / tden : null;
    return { pct: pct, tp: tp, ta: ta, pv: pv, ev: ev, ac: ac, spi: spi, cpi: cpi, sv: sv, cv: cv, bac: bac, eac: eac, etc: etc, vac: vac, tcpi: tcpi };
  }

  function renderEVM() {
    const e = computeEVM();
    const ids = ['evm-spi', 'evm-cpi', 'evm-ev', 'evm-sv', 'evm-cv', 'evm-pv', 'evm-ac', 'evm-spi-lbl', 'evm-cpi-lbl', 'evm-ev-lbl', 'evm-eac', 'evm-etc', 'evm-vac', 'evm-tcpi', 'evm-tcpi-lbl'];
    if (!e) {
      ids.forEach(id => { const el = document.getElementById(id); if (el) { el.textContent = '-'; el.style.color = ''; } });
      return;
    }
    const { pct, ev, ac, pv, spi, cpi, sv, cv, bac, eac, etc, vac, tcpi } = e;
    const fmt$ = (n) => { const sgn = n < 0 ? '-' : ''; return sgn + '$' + Math.abs(Math.round(+n || 0)).toLocaleString(); };
    const setE = (id, t, c) => { const el = document.getElementById(id); if (el) { el.textContent = t; if (c) el.style.color = c; } };
    const sc = !spi ? '' : spi >= 1 ? 'var(--green)' : spi >= 0.8 ? 'var(--amber)' : 'var(--danger)';
    const cc = !cpi ? '' : cpi >= 1 ? 'var(--green)' : cpi >= 0.8 ? 'var(--amber)' : 'var(--danger)';
    setE('evm-spi', spi ? spi.toFixed(2) : 'N/A', sc);
    setE('evm-spi-lbl', spi ? (spi >= 1 ? 'On / Ahead of Schedule' : spi >= 0.8 ? 'Slight Delay' : 'Behind Schedule') : '', sc);
    setE('evm-cpi', cpi ? cpi.toFixed(2) : 'N/A', cc);
    setE('evm-cpi-lbl', cpi ? (cpi >= 1 ? 'On / Under Budget' : cpi >= 0.8 ? 'Slight Overrun' : 'Over Budget') : '', cc);
    setE('evm-ev', fmt$(ev));
    setE('evm-ev-lbl', Math.round(pct * 100) + '% of planned budget earned');
    setE('evm-sv', fmt$(sv), sv >= 0 ? 'var(--green)' : 'var(--danger)');
    setE('evm-cv', fmt$(cv), cv >= 0 ? 'var(--green)' : 'var(--danger)');
    setE('evm-pv', fmt$(pv));
    setE('evm-ac', fmt$(ac));
    setE('evm-eac', eac !== null ? fmt$(eac) : 'N/A', eac !== null ? (eac <= bac ? 'var(--green)' : 'var(--danger)') : '');
    setE('evm-etc', etc !== null ? fmt$(etc) : 'N/A');
    setE('evm-vac', vac !== null ? fmt$(vac) : 'N/A', vac !== null ? (vac >= 0 ? 'var(--green)' : 'var(--danger)') : '');
    const tc = tcpi === null ? '' : tcpi <= 1 ? 'var(--green)' : tcpi <= 1.1 ? 'var(--amber)' : 'var(--danger)';
    setE('evm-tcpi', tcpi !== null ? tcpi.toFixed(2) : 'N/A', tc);
    setE('evm-tcpi-lbl', tcpi !== null ? (tcpi <= 1 ? 'On pace for original budget' : tcpi <= 1.1 ? 'Tight but achievable' : 'Must improve efficiency to hit budget') : '', tc);

    // C14 Cost-to-Complete: burn-rate projection
    var burnEl = document.getElementById('evm-burn');
    var monthsEl = document.getElementById('evm-months');
    var confEl = document.getElementById('evm-conf');
    var confLbl = document.getElementById('evm-conf-lbl');
    if (burnEl && monthsEl && confEl) {
      // Compute burn rate from actual cost over project duration
      var burnRate = 0;
      var monthsLeft = null;
      var confidence = '-';
      var confColor = '';
      if (ac > 0 && e && etc !== null) {
        // Estimate months from start to today
        var state = ns.State ? ns.State.getState() : null;
        var tasks = state && state.tasks ? state.tasks : [];
        var startDates = tasks.map(function(t) { return t.startDate ? new Date(t.startDate) : null; }).filter(function(d) { return d && !isNaN(d.getTime()); });
        var projectStart = startDates.length ? new Date(Math.min.apply(null, startDates.map(function(d) { return d.getTime(); }))) : new Date();
        var monthsElapsed = Math.max(1, (Date.now() - projectStart.getTime()) / (30.44 * 86400000)); // avg days per month
        burnRate = ac / monthsElapsed;
        if (burnRate > 0) monthsLeft = etc / burnRate;
        // Confidence based on CPI trend
        if (cpi !== null) {
          if (cpi >= 1) { confidence = 'High'; confColor = 'var(--green)'; }
          else if (cpi >= 0.8) { confidence = 'Medium'; confColor = 'var(--amber)'; }
          else { confidence = 'Low'; confColor = 'var(--danger)'; }
        }
      }
      burnEl.textContent = burnRate > 0 ? fmt$(burnRate) : 'N/A';
      monthsEl.textContent = monthsLeft !== null ? monthsLeft.toFixed(1) : 'N/A';
      confEl.textContent = confidence;
      confEl.style.color = confColor;
      if (confLbl) confLbl.textContent = confidence === 'High' ? 'CPI on target' : confidence === 'Medium' ? 'Monitor closely' : confidence === 'Low' ? 'Needs corrective action' : '';
    }
  }

  // ---- API ----
  ns.Evm = {
    compute: computeEVM,
    render: renderEVM
  };

})(MMGR);
window.MMGR = MMGR;
