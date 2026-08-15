/* ============================================================
   My MaNaGeR — Bid Leveling & Go/No-Go Scoring Module
   MARKET-FEATURE-ROADMAP A3 (bid leveling / side-by-side sub-bid
   comparison) + A4 (Go/No-Go bid scoring). Zero third-party
   dependency — plain state records + pure scoring helpers,
   following the exact module pattern of mmgr-risks.js /
   mmgr-stakeholders.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;
  const S = () => ns.State ? ns.State.getState() : null;

  // ---- Bid leveling (A3) ----
  function addBidPackage() {
    ns.State.updateState(function(s) {
      if (!s.bidPackages) s.bidPackages = [];
      s.bidPackages.push({
        id: U.genShortId('BID'), package: '', bids: []
      });
    });
    R.renderStakeholders();
  }

  function addBid(pkgIdx) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (!p) return;
      if (!p.bids) p.bids = [];
      p.bids.push({ vendor: '', amount: 0, scopeNotes: '', qualified: true });
    });
    R.renderStakeholders();
  }

  function updBid(pkgIdx, bidIdx, field, value, evtType) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (p && p.bids && p.bids[bidIdx]) {
        p.bids[bidIdx][field] = (field === 'amount') ? parseFloat(value) || 0 : value;
      }
    });
    // Focus discipline (same as updBudgetLine): save on keystroke, re-render
    // on commit so the lowest / scope-gap flags stay live.
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function updBidPackage(pkgIdx, value, evtType) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (p) p.package = value;
    });
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function delBid(pkgIdx, bidIdx) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (p && p.bids) p.bids.splice(bidIdx, 1);
    });
    R.renderStakeholders();
  }

  function delBidPackage(pkgIdx) {
    ns.State.updateState(function(s) {
      if (s.bidPackages) s.bidPackages.splice(pkgIdx, 1);
    });
    R.renderStakeholders();
  }

  // Roadmap A3 helper: flags the lowest bid and, when bids carry differing
  // scope notes, marks every non-lowest bid as scope-different so the
  // comparison is honest (two different-scope bids are never compared as if
  // they were apples-to-apples).
  function flagScopeGaps(bids) {
    const list = (bids || []).filter(function(b) { return b.vendor; });
    if (!list.length) return list;
    const min = Math.min.apply(null, list.map(function(x) { return +x.amount || 0; }));
    const scopeSet = list.map(function(b) { return (b.scopeNotes || '').trim().toLowerCase(); });
    const hasScopeVariance = scopeSet.some(function(t) { return t; }) &&
      scopeSet.some(function(t) { return t !== scopeSet[0]; });
    return list.map(function(b) {
      const isLow = (+b.amount || 0) === min && min > 0;
      const scopeGap = hasScopeVariance && (b.scopeNotes || '').trim().toLowerCase() !== scopeSet[0];
      return Object.assign({}, b, { lowestAmount: isLow, scopeGap: scopeGap });
    });
  }

  // ---- Go/No-Go scoring (A4) ----
  function addGoNoGo() {
    ns.State.updateState(function(s) {
      if (!s.goNoGo) s.goNoGo = [];
      s.goNoGo.push({
        id: U.genShortId('GNG'), projectName: '',
        criteria: [{ label: '', score: 0.5 }]
      });
    });
    R.renderStakeholders();
  }

  function updGoNoGo(idx, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.goNoGo && s.goNoGo[idx]) s.goNoGo[idx][field] = value;
    });
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function addGoNoGoCriterion(idx) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      if (!g) return;
      if (!g.criteria) g.criteria = [];
      g.criteria.push({ label: '', score: 0.5 });
    });
    R.renderStakeholders();
  }

  function updGoNoGoCriterion(idx, critIdx, field, value, evtType) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      if (g && g.criteria && g.criteria[critIdx]) {
        g.criteria[critIdx][field] = (field === 'score') ? parseFloat(value) || 0 : value;
      }
    });
    // Score select commits immediately — refresh the GO/REVIEW/NO-GO badge.
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function delGoNoGoCriterion(idx, critIdx) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      if (g && g.criteria) g.criteria.splice(critIdx, 1);
    });
    R.renderStakeholders();
  }

  function delGoNoGo(idx) {
    ns.State.updateState(function(s) {
      if (s.goNoGo) s.goNoGo.splice(idx, 1);
    });
    R.renderStakeholders();
  }

  // Roadmap A4 helper: 1 = yes, 0 = no, 0.5 = maybe; ≥75% GO, ≥50% REVIEW,
  // else NO-GO. No criteria = no verdict (never fabricate a score).
  function goNoGoScore(criteria) {
    const list = (criteria || []).filter(function(c) { return (c.label || '').trim(); });
    if (!list.length) return { pct: null, recommendation: null };
    const total = list.reduce(function(sum, c) { return sum + (+c.score || 0); }, 0);
    const pct = total / list.length;
    return { pct: pct, recommendation: pct >= 0.75 ? 'GO' : pct >= 0.5 ? 'REVIEW' : 'NO-GO' };
  }

  // ---- Rendering (hosted inside the Stakeholders panel) ----
  function renderBids() {
    const body = U.$('bid-body');
    if (!body) return;
    const s = S();
    const pkgs = (s && s.bidPackages) || [];
    if (!pkgs.length) {
      body.innerHTML = '<div class="es" style="padding:16px;font-size:.78rem">No bid packages yet — add one to compare subcontractor quotes side by side.</div>';
      return;
    }
    const esc = (v) => U.escapeHtml(v || '');
    const rows = pkgs.map((p, pi) => {
      const bids = flagScopeGaps(p.bids);
      const min = bids.length ? Math.min.apply(null, bids.map(b => +b.amount || 0)) : 0;
      const table = bids.length
        ? '<table class="dt bid-tbl"><thead><tr><th>Vendor</th><th class="w110">Amount</th><th>Scope Notes</th><th class="w80">Qualified</th><th class="w70">Lowest</th><th class="w50"></th></tr></thead><tbody>' +
          bids.map((b, bi) => {
            const qual = typeof b.qualified === 'string' ? (b.qualified !== 'false') : b.qualified !== false;
            return '<tr>' +
              '<td><input type="text" value="' + esc(b.vendor) + '" data-action="updBid" data-pkg="' + pi + '" data-idx="' + bi + '" data-field="vendor" placeholder="Vendor name"></td>' +
              '<td><input type="number" value="' + (+b.amount || 0) + '" min="0" step="100" data-action="updBid" data-pkg="' + pi + '" data-idx="' + bi + '" data-field="amount" style="width:90px"></td>' +
              '<td><input type="text" value="' + esc(b.scopeNotes) + '" data-action="updBid" data-pkg="' + pi + '" data-idx="' + bi + '" data-field="scopeNotes" placeholder="Scope / exclusions"></td>' +
              '<td><select data-action="updBid" data-pkg="' + pi + '" data-idx="' + bi + '" data-field="qualified">' + ['true','false'].map(v => '<option value="' + v + '"' + (String(b.qualified) === v || (v === 'true' && b.qualified === undefined) ? ' selected' : '') + '>' + (v === 'true' ? 'Yes' : 'No') + '</option>').join('') + '</select></td>' +
              '<td>' + (b.lowestAmount ? '<span class="badge bg">lowest</span>' : (b.scopeGap ? '<span class="badge ba" title="Scope differs from the lowest bid">scope gap</span>' : '—')) + '</td>' +
              '<td><button class="btn btn-s btn-d" data-action="bidDelRow" data-pkg="' + pi + '" data-idx="' + bi + '">×</button></td>' +
              '</tr>';
          }).join('') + '</tbody></table>'
        : '<div class="es" style="padding:12px;font-size:.74rem">No bids in this package yet — add rows to compare quotes.</div>';
      return '<div class="bid-pkg">' +
        '<div class="bid-pkg-head"><input type="text" value="' + esc(p.package) + '" data-action="updBidPkg" data-pkg="' + pi + '" placeholder="Package name (e.g. Electrical — Phase 1)" style="flex:1;min-width:160px">' +
        '<button class="btn btn-n btn-s" data-action="bidAddRow" data-pkg="' + pi + '">+ Add Bid</button>' +
        '<button class="btn btn-s btn-d" data-action="bidDelPkg" data-pkg="' + pi + '">×</button></div>' +
        (min > 0 ? '<div class="bid-min">Lowest: $' + min.toLocaleString() + '</div>' : '') +
        table +
        '</div>';
    }).join('');
    body.innerHTML = rows;
  }

  function renderGoNoGo() {
    const body = U.$('gonogo-body');
    if (!body) return;
    const s = S();
    const list = (s && s.goNoGo) || [];
    if (!list.length) {
      body.innerHTML = '<div class="es" style="padding:16px;font-size:.78rem">No Go/No-Go scorecards yet — score an opportunity before committing estimator time.</div>';
      return;
    }
    const esc = (v) => U.escapeHtml(v || '');
    const cards = list.map((g, gi) => {
      const scored = goNoGoScore(g.criteria);
      const badge = scored.recommendation === 'GO'
        ? '<span class="badge bg gn-badge">GO</span>'
        : scored.recommendation === 'REVIEW'
          ? '<span class="badge ba gn-badge">REVIEW</span>'
          : '<span class="badge br gn-badge">NO-GO</span>';
      const critRows = (g.criteria || []).map((c, ci) =>
        '<div class="gn-crit">' +
        '<input type="text" value="' + esc(c.label) + '" data-action="updGoNoGoCrit" data-idx="' + gi + '" data-cidx="' + ci + '" data-field="label" placeholder="Criterion" style="flex:1;min-width:140px">' +
        '<select data-action="updGoNoGoCrit" data-idx="' + gi + '" data-cidx="' + ci + '" data-field="score">' + [['1','Yes'],['0.5','Maybe'],['0','No']].map(o => '<option value="' + o[0] + '"' + (+c.score === +o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
        '<button class="btn btn-s btn-d" data-action="gonogoDelCrit" data-idx="' + gi + '" data-cidx="' + ci + '">×</button>' +
        '</div>').join('');
      return '<div class="gn-card">' +
        '<div class="bid-pkg-head"><input type="text" value="' + esc(g.projectName) + '" data-action="updGoNoGo" data-idx="' + gi + '" data-field="projectName" placeholder="Opportunity / project name" style="flex:1;min-width:160px">' + badge +
        '<button class="btn btn-s btn-d" data-action="gonogoDel" data-idx="' + gi + '">×</button></div>' +
        '<div class="gn-crits">' + (critRows || '<div class="es" style="padding:8px;font-size:.72rem">No criteria — add some to score this opportunity.</div>') + '</div>' +
        '<div class="gn-score"><button class="btn btn-n btn-s" data-action="gonogoAddCrit" data-idx="' + gi + '">+ Add Criterion</button>' +
        '<span class="gn-score-txt">' + (scored.pct === null ? 'Add criteria to score' : scored.pct.toFixed(0) + '% — ' + (scored.recommendation === 'GO' ? 'pursue' : scored.recommendation === 'REVIEW' ? 'review before deciding' : 'do not pursue')) + '</span></div>' +
        '</div>';
    }).join('');
    body.innerHTML = cards;
  }

  // ---- API ----
  ns.Bids = {
    addBidPackage: addBidPackage,
    addBid: addBid,
    updBid: updBid,
    updBidPackage: updBidPackage,
    delBid: delBid,
    delBidPackage: delBidPackage,
    flagScopeGaps: flagScopeGaps,
    addGoNoGo: addGoNoGo,
    updGoNoGo: updGoNoGo,
    addGoNoGoCriterion: addGoNoGoCriterion,
    updGoNoGoCriterion: updGoNoGoCriterion,
    delGoNoGoCriterion: delGoNoGoCriterion,
    delGoNoGo: delGoNoGo,
    goNoGoScore: goNoGoScore,
    render: renderBids,
    renderGoNoGo: renderGoNoGo
  };

})(MMGR);
window.MMGR = MMGR;
