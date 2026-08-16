/* ============================================================
   My MaNaGeR — Bid Leveling & Go/No-Go Scoring Module
   MARKET-FEATURE-ROADMAP A3 (bid leveling) + A4 (Go/No-Go bid
   scoring) — REBUILT to the owner's T8 spec (2026-08-16):
   (1) packages are created in the Add Bid Package modal (name,
       CSI Division Code, target baseline budget, bid deadline,
       scope line items with est. cost); (2) each package renders
       an EXPANDED leveled grid: rows = scope line items, columns
       = subcontractors, with BASE BID TOTAL, LEVELING
       ADJUSTMENTS (missing scope added at target cost), TRUE
       LEVELED TOTAL, VARIANCE TO BUDGET (green/red), and a per-sub
       ACTION row (Award Contract / View Original Proposal / Send
       Post-Bid Clarification Email); (3) Go/No-Go is a WEIGHTED
       questionnaire: categories with weights, 1-5 star criteria,
       a live score, GO/REVIEW/NO-GO verdict and an automation
       recommendation bar. HARD RULE (UI doctrine 8): every input
       is the app's soft-field treatment or the .dt transparent
       inline-edit; panels use the .card glass language.
   Zero third-party dependency — plain state records + pure
   scoring helpers, following the module pattern of mmgr-risks.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;
  const S = () => ns.State ? ns.State.getState() : null;

  // ---- CSI MasterFormat division codes (2-digit; canonical list used by
  //      both the modal select and the inline header selects) ----
  const CSI_DIVISIONS = [
    ['00', 'Procurement & Contracting Requirements'],
    ['01', 'General Requirements'],
    ['02', 'Existing Conditions'],
    ['03', 'Concrete'],
    ['04', 'Masonry'],
    ['05', 'Metals'],
    ['06', 'Wood, Plastics & Composites'],
    ['07', 'Thermal & Moisture Protection'],
    ['08', 'Openings'],
    ['09', 'Finishes'],
    ['10', 'Specialties'],
    ['11', 'Equipment'],
    ['12', 'Furnishings'],
    ['13', 'Special Construction'],
    ['14', 'Conveying Equipment'],
    ['21', 'Fire Suppression'],
    ['22', 'Plumbing'],
    ['23', 'Heating, Ventilating & Air Conditioning'],
    ['25', 'Integrated Automation'],
    ['26', 'Electrical'],
    ['27', 'Communications'],
    ['28', 'Electronic Safety & Security'],
    ['31', 'Earthwork'],
    ['32', 'Exterior Improvements'],
    ['33', 'Utilities'],
    ['34', 'Transportation'],
    ['40', 'Process Integration'],
    ['46', 'Water & Wastewater'],
    ['48', 'Electrical Power Generation']
  ];
  function csiOptions(selected) {
    return CSI_DIVISIONS.map(function(d) {
      return '<option value="' + d[0] + '"' + (String(selected) === d[0] ? ' selected' : '') + '>' + d[0] + ' - ' + U.escapeHtml(d[1]) + '</option>';
    }).join('');
  }
  function csiLabel(code) {
    const hit = CSI_DIVISIONS.filter(function(d) { return d[0] === String(code); })[0];
    return hit ? hit[0] + ' - ' + hit[1] : (code || '');
  }

  const esc = (v) => U.escapeHtml(v === undefined || v === null ? '' : String(v));
  const money = (n) => '$' + (+n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const toast = (msg, type) => { if (ns.App && ns.App.showToast) ns.App.showToast(msg, type || 'ok'); };

  // ---- Legacy-data normalization (T8 rebuild): pre-rebuild packages stored
  //      {package, bids:[{vendor,amount,scopeNotes,qualified}]} and scorecards
  //      stored {projectName, criteria:[{label,score 1/0.5/0}]}. Migrate them
  //      into the new shapes in place so old projects keep their numbers.
  function normalizeLegacy() {
    const s = S();
    if (!s) return false;
    let changed = false;
    (s.bidPackages || []).forEach(function(p) {
      if (!p.lineItems && Array.isArray(p.bids)) {
        p.lineItems = [{ description: 'Full package quote', estCost: 0 }];
        p.subs = (p.bids || []).map(function(b) {
          return {
            vendor: b.vendor || '',
            email: '',
            proposalUrl: '',
            awarded: false,
            amounts: [(+b.amount) || 0]
          };
        });
        p.csiDivision = p.csiDivision || '00';
        p.targetBudget = p.targetBudget || 0;
        p.bidDeadline = p.bidDeadline || '';
        delete p.bids;
        changed = true;
      }
    });
    (s.goNoGo || []).forEach(function(g) {
      if (!g.categories && Array.isArray(g.criteria)) {
        g.categories = [{
          label: 'Overall', weight: 100,
          criteria: (g.criteria || []).map(function(c) {
            const sc = +c.score || 0;
            return { label: c.label || '', stars: sc >= 1 ? 5 : sc >= 0.5 ? 3 : 0 };
          })
        }];
        delete g.criteria;
        changed = true;
      }
    });
    if (changed) ns.State.updateState(function() { /* mutation done above */ });
    return changed;
  }

  // ================= Bid package leveling math =================
  // base bid total = sum of the sub's quoted amounts
  // leveling adjustments = missing scope line items added at target cost
  // true leveled total = base + adjustments
  // variance to budget = (leveled - targetBudget) / targetBudget
  function leveledGrid(pkg) {
    const items = (pkg && Array.isArray(pkg.lineItems)) ? pkg.lineItems : [];
    const subs = (pkg && Array.isArray(pkg.subs)) ? pkg.subs : [];
    const budget = +pkg.targetBudget || 0;
    const targetTotal = items.reduce(function(sum, it) { return sum + (+it.estCost || 0); }, 0);
    const rows = subs.map(function(sub) {
      let base = 0, adj = 0;
      items.forEach(function(it, li) {
        const amt = (sub.amounts && sub.amounts[li] !== undefined && sub.amounts[li] !== null) ? (+sub.amounts[li] || 0) : null;
        if (amt === null) adj += (+it.estCost || 0);
        else base += amt;
      });
      const leveled = base + adj;
      return {
        vendor: sub.vendor || '',
        email: sub.email || '',
        proposalUrl: sub.proposalUrl || '',
        awarded: !!sub.awarded,
        base: base,
        adj: adj,
        leveled: leveled,
        varPct: budget > 0 ? ((leveled - budget) / budget) * 100 : null
      };
    });
    // Lowest true-leveled sub among named subs that priced at least one item.
    const pricedIdx = [];
    rows.forEach(function(r, si) {
      const sub = subs[si];
      const hasPrice = (sub && sub.amounts || []).some(function(a) { return a !== undefined && a !== null && +a > 0; });
      if (r.vendor && hasPrice) pricedIdx.push(si);
    });
    let lowestIdx = -1;
    if (pricedIdx.length) {
      let min = Infinity;
      pricedIdx.forEach(function(si) { if (rows[si].leveled < min) min = rows[si].leveled; });
      pricedIdx.forEach(function(si) { if (lowestIdx === -1 && rows[si].leveled === min) lowestIdx = si; });
    }
    return { items: items, subs: rows, budget: budget, targetTotal: targetTotal, lowestIdx: lowestIdx };
  }

  // ================= Go/No-Go weighted scoring =================
  // Each category carries a weight; each criterion a 1-5 star rating.
  // Category score = average stars / 5; total = weighted sum, normalized by
  // the total weight so drifting weights never inflate past 100. Unrated
  // criteria contribute 0 (an unscored questionnaire reads NO-GO, never a
  // fabricated GO). GO >= 75%, REVIEW >= 50%, else NO-GO.
  function weightedScore(g) {
    const cats = (g && Array.isArray(g.categories)) ? g.categories : [];
    const weightSum = cats.reduce(function(sum, c) { return sum + (+c.weight || 0); }, 0);
    const parts = cats.map(function(c) {
      const crs = (c.criteria || []).filter(function(cr) { return (cr.label || '').trim() || +cr.stars > 0; });
      const stars = crs.map(function(cr) { return Math.min(5, Math.max(0, +cr.stars || 0)); });
      const avg = stars.length ? stars.reduce(function(a, b) { return a + b; }, 0) / stars.length : 0;
      const w = weightSum > 0 ? ((+c.weight || 0) / weightSum) : 0;
      return { label: c.label || '', weight: +c.weight || 0, avg: avg, contribution: w * (avg / 5) };
    });
    const anyRated = parts.some(function(p) { return p.avg > 0; });
    if (!anyRated) return { pct: null, recommendation: null, parts: parts };
    const pct = parts.reduce(function(sum, p) { return sum + p.contribution; }, 0) * 100;
    return { pct: pct, recommendation: pct >= 75 ? 'GO' : pct >= 50 ? 'REVIEW' : 'NO-GO', parts: parts };
  }

  // ================= Add Bid Package modal =================
  let _draft = null; // { editPkgIdx: int|null, package, csiDivision, targetBudget, bidDeadline, lineItems:[{description,estCost}] }

  function openBidPkgModal(pkgIdx) {
    const s = S();
    const src = (pkgIdx !== undefined && pkgIdx !== null && s && s.bidPackages && s.bidPackages[pkgIdx]) ? s.bidPackages[pkgIdx] : null;
    _draft = src
      ? {
          editPkgIdx: pkgIdx,
          package: src.package || '',
          csiDivision: src.csiDivision || '00',
          targetBudget: +src.targetBudget || 0,
          bidDeadline: src.bidDeadline || '',
          lineItems: (src.lineItems || []).map(function(it) { return { description: it.description || '', estCost: +it.estCost || 0 }; })
        }
      : {
          editPkgIdx: null,
          package: '',
          csiDivision: '00',
          targetBudget: 0,
          bidDeadline: '',
          lineItems: [{ description: '', estCost: 0 }]
        };
    const modal = U.$('bidpkg-modal');
    if (!modal) return;
    const title = U.$('bp-title');
    if (title) title.textContent = _draft.editPkgIdx === null ? 'Add Bid Package' : 'Edit Bid Package';
    const nameEl = U.$('bp-name');
    if (nameEl) nameEl.value = _draft.package;
    const csiEl = U.$('bp-csi');
    if (csiEl) csiEl.innerHTML = csiOptions(_draft.csiDivision);
    const budEl = U.$('bp-budget');
    if (budEl) budEl.value = _draft.targetBudget ? String(_draft.targetBudget) : '';
    const dlEl = U.$('bp-deadline');
    if (dlEl) dlEl.value = _draft.bidDeadline || '';
    renderDraftItems();
    modal.classList.add('on');
    if (nameEl) setTimeout(function() { nameEl.focus(); }, 50);
  }

  function closeBidPkgModal() {
    const modal = U.$('bidpkg-modal');
    if (modal) modal.classList.remove('on');
    _draft = null;
  }

  function renderDraftItems() {
    const wrap = U.$('bp-items');
    if (!wrap || !_draft) return;
    wrap.innerHTML = _draft.lineItems.map(function(it, i) {
      return '<div class="bp-item">' +
        '<input type="text" class="bp-item-desc" value="' + esc(it.description) + '" placeholder="Line item description" aria-label="Line item ' + (i + 1) + ' description">' +
        '<input type="number" class="bp-item-cost" min="0" step="100" value="' + (+it.estCost || 0) + '" placeholder="Est. cost" aria-label="Line item ' + (i + 1) + ' estimated cost">' +
        '<button type="button" class="btn btn-s btn-d" data-action="bidModalDelItem" data-idx="' + i + '" aria-label="Remove line item"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> </button>' +
        '</div>';
    }).join('');
  }

  function bidModalAddItem() {
    if (!_draft) return;
    _draft.lineItems.push({ description: '', estCost: 0 });
    renderDraftItems();
  }

  function bidModalDelItem(idx) {
    if (!_draft) return;
    if (_draft.lineItems.length <= 1) { toast('A package needs at least one scope line item.', 'err'); return; }
    _draft.lineItems.splice(idx, 1);
    renderDraftItems();
  }

  function readDraft() {
    if (!_draft) return null;
    const name = (U.$('bp-name') || {}).value || '';
    const csi = (U.$('bp-csi') || {}).value || '00';
    const budget = parseFloat((U.$('bp-budget') || {}).value) || 0;
    const deadline = (U.$('bp-deadline') || {}).value || '';
    const items = [];
    (document.querySelectorAll('#bp-items .bp-item')).forEach(function(row) {
      const desc = (row.querySelector('.bp-item-desc') || {}).value || '';
      const cost = parseFloat((row.querySelector('.bp-item-cost') || {}).value) || 0;
      if (desc.trim()) items.push({ description: desc.trim(), estCost: cost });
    });
    return { name: name.trim(), csi: csi, budget: budget, deadline: deadline, items: items };
  }

  function bidPkgSave() {
    if (!_draft) return;
    const d = readDraft();
    if (!d) return;
    if (!d.name) { toast('Give the package a name before saving.', 'err'); const n = U.$('bp-name'); if (n) n.focus(); return; }
    if (!d.items.length) { toast('Add at least one scope line item with a description.', 'err'); return; }
    const isEdit = _draft.editPkgIdx !== null;
    let savedPkg = null;
    ns.State.updateState(function(s) {
      if (!s.bidPackages) s.bidPackages = [];
      const src = (_draft.editPkgIdx !== null && s.bidPackages[_draft.editPkgIdx]) ? s.bidPackages[_draft.editPkgIdx] : null;
      if (src) {
        src.package = d.name;
        src.csiDivision = d.csi;
        src.targetBudget = d.budget;
        src.bidDeadline = d.deadline;
        src.lineItems = d.items.map(function(it) { return { description: it.description, estCost: it.estCost }; });
        // Keep sub amounts aligned: grow/shrink to the new line-item count.
        (src.subs || []).forEach(function(sub) {
          if (!Array.isArray(sub.amounts)) sub.amounts = [];
          sub.amounts.length = d.items.length;
        });
        // Drop subs whose vendor is empty and never priced anything.
        src.subs = (src.subs || []).filter(function(sub) {
          return (sub.vendor || '').trim() || (sub.amounts || []).some(function(a) { return a !== undefined && a !== null && +a > 0; });
        });
        savedPkg = src;
      } else {
        const fresh = {
          id: U.genShortId('BID'),
          package: d.name,
          csiDivision: d.csi,
          targetBudget: d.budget,
          bidDeadline: d.deadline,
          lineItems: d.items.map(function(it) { return { description: it.description, estCost: it.estCost }; }),
          subs: []
        };
        s.bidPackages.push(fresh);
        savedPkg = fresh;
      }
    });
    closeBidPkgModal();
    R.renderStakeholders();
    toast(isEdit ? 'Bid package updated.' : 'Bid package saved.', 'ok');
    if (savedPkg) openRfqMailto(savedPkg);
  }

  function openRfqMailto(pkg) {
    const lines = (pkg.lineItems || []).map(function(it, i) {
      return (i + 1) + '. ' + (it.description || 'Line item') + ' - est. ' + money(it.estCost);
    }).join('\n');
    const subject = 'RFQ: ' + (pkg.package || 'Bid package');
    const body = 'Please quote the following scope for ' + (pkg.package || 'this package') + '.\n' +
      'CSI Division: ' + csiLabel(pkg.csiDivision) + '\n' +
      (pkg.bidDeadline ? 'Bid deadline: ' + pkg.bidDeadline + '\n' : '') +
      '\nScope line items:\n' + lines;
    window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  // ---- Bid package / sub / line mutations (inline grid edits) ----
  function pkgAt(pkgIdx) {
    const s = S();
    return (s && s.bidPackages && s.bidPackages[pkgIdx]) || null;
  }

  function addBidPackage() { openBidPkgModal(); }

  function updPkg(pkgIdx, field, value, evtType) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (!p) return;
      if (field === 'targetBudget') p.targetBudget = parseFloat(value) || 0;
      else p[field] = value;
    });
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function addSub(pkgIdx) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (!p) return;
      if (!p.subs) p.subs = [];
      p.subs.push({ vendor: '', email: '', proposalUrl: '', awarded: false, amounts: (p.lineItems || []).map(function() { return null; }) });
    });
    R.renderStakeholders();
  }

  function delSub(pkgIdx, sidx) {
    const p = pkgAt(pkgIdx);
    const sub = p && p.subs && p.subs[sidx];
    if (!p || !sub) return;
    const name = (sub.vendor || '').trim() || 'this subcontractor';
    if (!ns.App || !ns.App.askConfirm) { doDelSub(); return; }
    ns.App.askConfirm({
      title: 'Remove subcontractor?',
      message: 'This removes ' + name + ' and its quoted amounts from the package grid.',
      danger: true,
      confirmLabel: 'Remove',
      onOk: doDelSub
    });
    function doDelSub() {
      ns.State.updateState(function(s) {
        const pp = s.bidPackages && s.bidPackages[pkgIdx];
        if (pp && pp.subs) pp.subs.splice(sidx, 1);
      });
      R.renderStakeholders();
    }
  }

  function updSub(pkgIdx, sidx, field, value, evtType) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (p && p.subs && p.subs[sidx]) p.subs[sidx][field] = value;
    });
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function addLine(pkgIdx) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (!p) return;
      if (!p.lineItems) p.lineItems = [];
      p.lineItems.push({ description: '', estCost: 0 });
      (p.subs || []).forEach(function(sub) { if (!sub.amounts) sub.amounts = []; sub.amounts.push(null); });
    });
    R.renderStakeholders();
  }

  function delLine(pkgIdx, lidx) {
    const p = pkgAt(pkgIdx);
    if (!p || !p.lineItems || p.lineItems.length <= 1) { toast('A package needs at least one scope line item.', 'err'); return; }
    ns.State.updateState(function(s) {
      const pp = s.bidPackages && s.bidPackages[pkgIdx];
      if (!pp || !pp.lineItems) return;
      pp.lineItems.splice(lidx, 1);
      (pp.subs || []).forEach(function(sub) {
        if (Array.isArray(sub.amounts)) sub.amounts.splice(lidx, 1);
      });
    });
    R.renderStakeholders();
  }

  function updLine(pkgIdx, lidx, field, value, evtType) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (p && p.lineItems && p.lineItems[lidx]) {
        p.lineItems[lidx][field] = (field === 'estCost') ? (parseFloat(value) || 0) : value;
      }
    });
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function updAmount(pkgIdx, sidx, lidx, value, evtType) {
    ns.State.updateState(function(s) {
      const p = s.bidPackages && s.bidPackages[pkgIdx];
      if (!p || !p.subs || !p.subs[sidx]) return;
      const sub = p.subs[sidx];
      if (!Array.isArray(sub.amounts)) sub.amounts = [];
      const v = (value === '' || value === null || value === undefined) ? null : (parseFloat(value) || 0);
      sub.amounts[lidx] = v;
    });
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function awardSub(pkgIdx, sidx) {
    const p = pkgAt(pkgIdx);
    const sub = p && p.subs && p.subs[sidx];
    if (!p || !sub) return;
    if (sub.awarded) {
      // Undo the award.
      ns.State.updateState(function(s) {
        const pp = s.bidPackages && s.bidPackages[pkgIdx];
        if (pp && pp.subs && pp.subs[sidx]) pp.subs[sidx].awarded = false;
      });
      R.renderStakeholders();
      toast('Award withdrawn.', 'ok');
      return;
    }
    const name = (sub.vendor || '').trim() || 'this subcontractor';
    const doAward = function() {
      ns.State.updateState(function(s) {
        const pp = s.bidPackages && s.bidPackages[pkgIdx];
        if (pp && pp.subs && pp.subs[sidx]) pp.subs[sidx].awarded = true;
      });
      R.renderStakeholders();
      toast('Contract awarded to ' + (name || 'subcontractor') + '.', 'ok');
    };
    if (!ns.App || !ns.App.askConfirm) { doAward(); return; }
    ns.App.askConfirm({
      title: 'Award contract?',
      message: 'Award the contract for ' + (p.package || 'this package') + ' to ' + name + '?',
      confirmLabel: 'Award Contract',
      onOk: doAward
    });
  }

  function openProposal(pkgIdx, sidx) {
    const p = pkgAt(pkgIdx);
    const sub = p && p.subs && p.subs[sidx];
    if (!p || !sub) return;
    const url = (sub.proposalUrl || '').trim();
    if (!url) { toast('No proposal link saved for this subcontractor yet. Paste one in the header.', 'err'); return; }
    window.open(/^https?:\/\//i.test(url) ? url : 'https://' + url, '_blank', 'noopener');
  }

  function clarifySub(pkgIdx, sidx) {
    const p = pkgAt(pkgIdx);
    const sub = p && p.subs && p.subs[sidx];
    if (!p || !sub) return;
    const lines = (p.lineItems || []).map(function(it, i) {
      const amt = (sub.amounts && sub.amounts[i] !== undefined && sub.amounts[i] !== null) ? money(sub.amounts[i]) : 'not quoted';
      return (i + 1) + '. ' + (it.description || 'Line item') + ' - quoted ' + amt + ' (est. ' + money(it.estCost) + ')';
    }).join('\n');
    const subject = 'Post-bid clarification: ' + (p.package || 'Bid package');
    const body = 'Hi ' + (sub.vendor || 'there') + ',\n\n' +
      'Following up on your bid for ' + (p.package || 'this package') + '. Could you clarify the items below?\n\n' +
      lines + '\n\nThanks.';
    window.location.href = 'mailto:' + (sub.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  function delBidPackage(pkgIdx) {
    const p = pkgAt(pkgIdx);
    if (!p) return;
    const name = (p.package || '').trim() || 'this bid package';
    const doDel = function() {
      ns.State.updateState(function(s) {
        if (s.bidPackages) s.bidPackages.splice(pkgIdx, 1);
      });
      R.renderStakeholders();
      toast('Bid package deleted.', 'ok');
    };
    if (!ns.App || !ns.App.askConfirm) { doDel(); return; }
    ns.App.askConfirm({
      title: 'Delete bid package?',
      message: 'This deletes ' + name + ' and every subcontractor quote in its grid.',
      danger: true,
      confirmLabel: 'Delete',
      onOk: doDel
    });
  }

  // ================= Go/No-Go scorecard mutations =================
  function addGoNoGo() {
    ns.State.updateState(function(s) {
      if (!s.goNoGo) s.goNoGo = [];
      s.goNoGo.push({
        id: U.genShortId('GNG'),
        projectName: '',
        categories: [
          { label: 'Commercial', weight: 30, criteria: [{ label: '', stars: 0 }] },
          { label: 'Technical Fit', weight: 25, criteria: [{ label: '', stars: 0 }] },
          { label: 'Schedule', weight: 20, criteria: [{ label: '', stars: 0 }] },
          { label: 'Team & Resources', weight: 25, criteria: [{ label: '', stars: 0 }] }
        ]
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

  function addGoNoGoCat(idx) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      if (!g) return;
      if (!g.categories) g.categories = [];
      g.categories.push({ label: '', weight: 25, criteria: [{ label: '', stars: 0 }] });
    });
    R.renderStakeholders();
  }

  function delGoNoGoCat(idx, cidx) {
    const g = S() && S().goNoGo && S().goNoGo[idx];
    if (!g || !g.categories || g.categories.length <= 1) { toast('A scorecard needs at least one category.', 'err'); return; }
    ns.State.updateState(function(s) {
      const gg = s.goNoGo && s.goNoGo[idx];
      if (gg && gg.categories) gg.categories.splice(cidx, 1);
    });
    R.renderStakeholders();
  }

  function updGoNoGoCat(idx, cidx, field, value, evtType) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      if (g && g.categories && g.categories[cidx]) {
        g.categories[cidx][field] = (field === 'weight') ? (parseFloat(value) || 0) : value;
      }
    });
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function addGoNoGoCriterion(idx, cidx) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      if (!g) return;
      if (!g.categories) g.categories = [];
      const cat = g.categories[cidx === undefined || cidx === null ? 0 : cidx];
      if (!cat) return;
      if (!cat.criteria) cat.criteria = [];
      cat.criteria.push({ label: '', stars: 0 });
    });
    R.renderStakeholders();
  }

  function delGoNoGoCriterion(idx, cidx, ridx) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      const cat = g && g.categories && g.categories[cidx];
      if (cat && cat.criteria) cat.criteria.splice(ridx, 1);
    });
    R.renderStakeholders();
  }

  function updGoNoGoCrit(idx, cidx, ridx, field, value, evtType) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      const cat = g && g.categories && g.categories[cidx];
      if (cat && cat.criteria && cat.criteria[ridx]) cat.criteria[ridx][field] = value;
    });
    if (evtType === 'input') return;
    R.renderStakeholders();
  }

  function setGoNoGoStar(idx, cidx, ridx, val) {
    ns.State.updateState(function(s) {
      const g = s.goNoGo && s.goNoGo[idx];
      const cat = g && g.categories && g.categories[cidx];
      if (cat && cat.criteria && cat.criteria[ridx]) cat.criteria[ridx].stars = Math.min(5, Math.max(0, +val || 0));
    });
    R.renderStakeholders();
  }

  function delGoNoGo(idx) {
    const g = S() && S().goNoGo && S().goNoGo[idx];
    if (!g) return;
    const name = (g.projectName || '').trim() || 'this scorecard';
    const doDel = function() {
      ns.State.updateState(function(s) {
        if (s.goNoGo) s.goNoGo.splice(idx, 1);
      });
      R.renderStakeholders();
      toast('Scorecard deleted.', 'ok');
    };
    if (!ns.App || !ns.App.askConfirm) { doDel(); return; }
    ns.App.askConfirm({
      title: 'Delete scorecard?',
      message: 'This deletes ' + name + ' and all of its weighted criteria.',
      danger: true,
      confirmLabel: 'Delete',
      onOk: doDel
    });
  }

  // ================= Rendering =================
  function starRow(gi, ci, ri, val) {
    let out = '';
    for (let s = 1; s <= 5; s++) {
      out += '<button type="button" class="gn-star' + (s <= val ? ' on' : '') + '" data-action="gonogoStar" data-idx="' + gi + '" data-cidx="' + ci + '" data-ridx="' + ri + '" data-val="' + s + '" aria-label="Rate ' + s + ' of 5' + (s <= val ? ', selected' : '') + '" aria-pressed="' + (s <= val) + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-star"></use></svg></button>';
    }
    return out;
  }

  function scoreBar(sc) {
    const pct = sc.pct === null ? 0 : Math.round(sc.pct);
    const cls = sc.recommendation === 'GO' ? ' go' : sc.recommendation === 'REVIEW' ? ' review' : sc.recommendation === 'NO-GO' ? ' nogo' : ' empty';
    return '<div class="gn-scorebar" role="img" aria-label="' + (sc.pct === null ? 'Not scored yet' : pct + ' percent, ' + sc.recommendation) + '">' +
      '<div class="gn-scorebar-fill' + cls + '" style="width:' + pct + '%"></div>' +
      '<span class="gn-scorebar-mark m50" aria-hidden="true"></span>' +
      '<span class="gn-scorebar-mark m75" aria-hidden="true"></span>' +
      '</div>';
  }

  function renderGoNoGo() {
    const body = U.$('gonogo-body');
    if (!body) return;
    const s = S();
    const list = (s && s.goNoGo) || [];
    if (!list.length) {
      body.innerHTML = '<div class="es" style="padding:16px;font-size:.78rem">No Go/No-Go scorecards yet. Add a weighted questionnaire and rate it 1 to 5 stars before committing estimator time.</div>';
      return;
    }
    body.innerHTML = list.map(function(g, gi) {
      const sc = weightedScore(g);
      const badge = sc.recommendation === 'GO'
        ? '<span class="badge bg gn-badge">GO</span>'
        : sc.recommendation === 'REVIEW'
          ? '<span class="badge ba gn-badge">REVIEW</span>'
          : '<span class="badge br gn-badge">NO-GO</span>';
      const cats = (g.categories || []).map(function(c, ci) {
        const critRows = (c.criteria || []).map(function(cr, ri) {
          return '<div class="gn-crit">' +
            '<input type="text" value="' + esc(cr.label) + '" data-action="gonogoCritUpd" data-idx="' + gi + '" data-cidx="' + ci + '" data-ridx="' + ri + '" data-field="label" placeholder="Criterion">' +
            '<span class="gn-stars">' + starRow(gi, ci, ri, +cr.stars || 0) + '</span>' +
            '<button class="btn btn-s btn-d" data-action="gonogoDelCrit" data-idx="' + gi + '" data-cidx="' + ci + '" data-ridx="' + ri + '" aria-label="Remove criterion"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> </button>' +
            '</div>';
        }).join('');
        return '<div class="gn-cat">' +
          '<div class="gn-cat-head">' +
          '<input type="text" value="' + esc(c.label) + '" data-action="gonogoCatUpd" data-idx="' + gi + '" data-cidx="' + ci + '" data-field="label" placeholder="Category name">' +
          '<span class="gn-wt"><input type="number" min="0" max="100" step="5" value="' + (+c.weight || 0) + '" data-action="gonogoCatUpd" data-idx="' + gi + '" data-cidx="' + ci + '" data-field="weight" aria-label="Category weight percent">%</span>' +
          '<button class="btn btn-s btn-d" data-action="gonogoDelCat" data-idx="' + gi + '" data-cidx="' + ci + '" aria-label="Remove category"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> </button>' +
          '</div>' +
          (critRows || '<div class="es" style="padding:8px;font-size:.72rem">No criteria in this category yet.</div>') +
          '<button class="btn btn-n btn-s gn-addcrit" data-action="gonogoAddCrit" data-idx="' + gi + '" data-cidx="' + ci + '">+ Add Criterion</button>' +
          '</div>';
      }).join('');
      const scoreTxt = sc.pct === null
        ? 'Rate the criteria to score this opportunity'
        : sc.pct.toFixed(0) + '% ' + (sc.recommendation === 'GO' ? 'GO, pursue' : sc.recommendation === 'REVIEW' ? 'REVIEW, decide with caution' : 'NO-GO, do not pursue');
      return '<div class="gn-card">' +
        '<div class="bid-pkg-head">' +
        '<input type="text" value="' + esc(g.projectName) + '" data-action="gonogoUpd" data-idx="' + gi + '" data-field="projectName" placeholder="Opportunity / project name" style="flex:1;min-width:160px">' + badge +
        '<button class="btn btn-s btn-d" data-action="gonogoDel" data-idx="' + gi + '" aria-label="Delete scorecard"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> </button>' +
        '</div>' +
        scoreBar(sc) +
        '<div class="gn-cats">' + cats + '</div>' +
        '<div class="gn-foot">' +
        '<button class="btn btn-n btn-s" data-action="gonogoAddCat" data-idx="' + gi + '">+ Add Category</button>' +
        '<span class="gn-score-txt">' + scoreTxt + '</span>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function render() {
    const body = U.$('bid-body');
    if (!body) return;
    normalizeLegacy();
    const s = S();
    const pkgs = (s && s.bidPackages) || [];
    if (!pkgs.length) {
      body.innerHTML = '<div class="es" style="padding:16px;font-size:.78rem">No bid packages yet. Add a package to build a leveled comparison grid across subcontractor quotes.</div>';
      return;
    }
    body.innerHTML = pkgs.map(function(p, pi) { return renderPkg(p, pi); }).join('');
  }

  function renderPkg(p, pi) {
    const g = leveledGrid(p);
    const subs = (p.subs || []);
    const hasSubs = subs.length > 0;
    const subThs = subs.map(function(sub, si) {
      const awarded = !!sub.awarded;
      return '<th class="lvl-sub" scope="col">' +
        '<input type="text" class="lvl-sub-name" value="' + esc(sub.vendor) + '" data-action="bidSubUpd" data-pkg="' + pi + '" data-sid="' + si + '" data-field="vendor" placeholder="Subcontractor" aria-label="Subcontractor ' + (si + 1) + ' name">' +
        '<input type="text" class="lvl-sub-mini" value="' + esc(sub.email) + '" data-action="bidSubUpd" data-pkg="' + pi + '" data-sid="' + si + '" data-field="email" placeholder="Email" aria-label="Subcontractor ' + (si + 1) + ' email">' +
        '<input type="text" class="lvl-sub-mini" value="' + esc(sub.proposalUrl) + '" data-action="bidSubUpd" data-pkg="' + pi + '" data-sid="' + si + '" data-field="proposalUrl" placeholder="Proposal link" aria-label="Subcontractor ' + (si + 1) + ' proposal link">' +
        (awarded ? '<span class="badge bg lvl-awarded">AWARDED</span>' : '') +
        '<button class="btn btn-s btn-d lvl-sub-del" data-action="bidSubDel" data-pkg="' + pi + '" data-sid="' + si + '" aria-label="Remove subcontractor ' + (si + 1) + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> </button>' +
        '</th>';
    }).join('');

    const itemRows = g.items.map(function(it, li) {
      const amtTds = subs.map(function(sub, si) {
        const v = (sub.amounts && sub.amounts[li] !== undefined && sub.amounts[li] !== null) ? sub.amounts[li] : '';
        return '<td><input type="number" min="0" step="100" value="' + esc(v) + '" data-action="bidAmount" data-pkg="' + pi + '" data-sid="' + si + '" data-lid="' + li + '" placeholder="not quoted" aria-label="' + esc(sub.vendor || 'Subcontractor ' + (si + 1)) + ' quote for line item ' + (li + 1) + '"></td>';
      }).join('');
      return '<tr>' +
        '<td class="lvl-item-cell"><input type="text" value="' + esc(it.description) + '" data-action="bidLineUpd" data-pkg="' + pi + '" data-lid="' + li + '" data-field="description" placeholder="Line item description" aria-label="Line item ' + (li + 1) + ' description"></td>' +
        '<td class="lvl-tgt-cell"><input type="number" min="0" step="100" value="' + esc(it.estCost || 0) + '" data-action="bidLineUpd" data-pkg="' + pi + '" data-lid="' + li + '" data-field="estCost" aria-label="Line item ' + (li + 1) + ' estimated target cost"></td>' +
        amtTds +
        '<td class="lvl-del-cell"><button class="btn btn-s btn-d" data-action="bidLineDel" data-pkg="' + pi + '" data-lid="' + li + '" aria-label="Remove line item ' + (li + 1) + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> </button></td>' +
        '</tr>';
    }).join('');

    const tds = function(fn) { return subs.map(function(_, si) { return fn(g.subs[si], si); }).join(''); };
    const numTd = (n) => '<td class="lvl-num">' + money(n) + '</td>';
    const pctTd = (r) => {
      if (r.varPct === null) return '<td class="lvl-num lvl-var-na">&mdash;</td>';
      const cls = r.varPct <= 0 ? ' lvl-var-ok' : ' lvl-var-over';
      return '<td class="lvl-num' + cls + '">' + (r.varPct > 0 ? '+' : '') + r.varPct.toFixed(0) + '%</td>';
    };
    const actionTd = (r, si) => {
      const lowest = si === g.lowestIdx;
      const awarded = !!r.awarded;
      const awardBtn = awarded
        ? '<button class="btn btn-s btn-g lvl-act" data-action="bidAward" data-pkg="' + pi + '" data-sid="' + si + '" aria-pressed="true" title="Click to withdraw">Awarded</button>'
        : '<button class="btn btn-s btn-n lvl-act" data-action="bidAward" data-pkg="' + pi + '" data-sid="' + si + '">Award Contract</button>';
      return '<td class="lvl-act-cell">' +
        awardBtn +
        '<button class="btn btn-s btn-n lvl-act" data-action="bidProposal" data-pkg="' + pi + '" data-sid="' + si + '">View Proposal</button>' +
        '<button class="btn btn-s btn-n lvl-act" data-action="bidClarify" data-pkg="' + pi + '" data-sid="' + si + '">Clarify Email</button>' +
        (lowest ? '<span class="badge bg lvl-lowest">lowest leveled</span>' : '') +
        '</td>';
    };

    const totals = hasSubs
      ? '<tr class="lvl-total lvl-base"><td colspan="2" class="lvl-label">Base Bid Total</td>' + tds(function(r) { return numTd(r.base); }) + '<td></td></tr>' +
        '<tr class="lvl-total lvl-adj"><td colspan="2" class="lvl-label">Leveling Adjustments</td>' + tds(function(r) { return numTd(r.adj); }) + '<td></td></tr>' +
        '<tr class="lvl-total lvl-true"><td colspan="2" class="lvl-label">True Leveled Total</td>' + tds(function(r) { return numTd(r.leveled); }) + '<td></td></tr>' +
        '<tr class="lvl-total lvl-var"><td colspan="2" class="lvl-label">Variance to Budget</td>' + tds(function(r) { return pctTd(r); }) + '<td></td></tr>' +
        '<tr class="lvl-actions"><td colspan="2" class="lvl-label lvl-act-label">Actions</td>' + tds(function(r, si) { return actionTd(r, si); }) + '<td></td></tr>'
      : '';

    const chips = [];
    if (p.csiDivision) chips.push('<span class="bid-chip">CSI ' + esc(p.csiDivision) + '</span>');
    if (g.budget > 0) chips.push('<span class="bid-chip">' + money(g.budget) + '</span>');
    if (p.bidDeadline) chips.push('<span class="bid-chip">Due ' + esc(p.bidDeadline) + '</span>');
    if (!chips.length) chips.push('<span class="bid-chip bid-chip-muted">Add scope details in the modal</span>');

    return '<div class="bid-pkg">' +
      '<div class="bid-pkg-head">' +
      '<input type="text" value="' + esc(p.package) + '" data-action="bidPkgUpd" data-pkg="' + pi + '" data-field="package" placeholder="Package name" style="flex:1;min-width:160px">' +
      '<span class="bid-chips">' + chips.join('') + '</span>' +
      '<button class="btn btn-n btn-s" data-action="bidEdit" data-pkg="' + pi + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-edit"></use></svg> Edit</button>' +
      '<button class="btn btn-n btn-s" data-action="bidSubAdd" data-pkg="' + pi + '">+ Add Sub</button>' +
      '<button class="btn btn-s btn-d" data-action="bidDelPkg" data-pkg="' + pi + '" aria-label="Delete bid package"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> </button>' +
      '</div>' +
      (hasSubs
        ? '<div class="ox"><table class="dt lvl-grid"><thead><tr>' +
          '<th class="lvl-item-col">Scope Line Item</th><th class="lvl-tgt-col">Est. Target</th>' + subThs + '<th class="lvl-del-col"></th>' +
          '</tr></thead><tbody>' + itemRows + totals + '</tbody></table></div>'
        : '<div class="es" style="padding:12px;font-size:.74rem">No subcontractor quotes yet. Add a subcontractor to start comparing leveled totals.</div>') +
      '<div class="lvl-tools">' +
      '<button class="btn btn-n btn-s" data-action="bidAddLine" data-pkg="' + pi + '">+ Add Line Item</button>' +
      '<button class="btn btn-n btn-s" data-action="bidSubAdd" data-pkg="' + pi + '">+ Add Subcontractor</button>' +
      '</div>' +
      '</div>';
  }

  // ---- API ----
  ns.Bids = {
    // modal
    openBidPkgModal: openBidPkgModal,
    closeBidPkgModal: closeBidPkgModal,
    bidModalAddItem: bidModalAddItem,
    bidModalDelItem: bidModalDelItem,
    bidPkgSave: bidPkgSave,
    // bid packages
    addBidPackage: addBidPackage,
    delBidPackage: delBidPackage,
    updPkg: updPkg,
    addSub: addSub,
    delSub: delSub,
    updSub: updSub,
    addLine: addLine,
    delLine: delLine,
    updLine: updLine,
    updAmount: updAmount,
    awardSub: awardSub,
    openProposal: openProposal,
    clarifySub: clarifySub,
    // go/no-go
    addGoNoGo: addGoNoGo,
    updGoNoGo: updGoNoGo,
    addGoNoGoCat: addGoNoGoCat,
    delGoNoGoCat: delGoNoGoCat,
    updGoNoGoCat: updGoNoGoCat,
    addGoNoGoCriterion: addGoNoGoCriterion,
    delGoNoGoCriterion: delGoNoGoCriterion,
    updGoNoGoCrit: updGoNoGoCrit,
    setGoNoGoStar: setGoNoGoStar,
    delGoNoGo: delGoNoGo,
    // math
    leveledGrid: leveledGrid,
    weightedScore: weightedScore,
    // render
    render: render,
    renderGoNoGo: renderGoNoGo
  };

})(MMGR);
window.MMGR = MMGR;
