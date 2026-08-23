/* ============================================================
   My MaNaGeR , People Panel
   Stakeholders, Changes, Log, RACI, RACI Heatmap, RACI Alerts,
   Communications.
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

  // ---- Stakeholders ----
  function renderStakeholders() {
    const s = S();
    if (!s) return;
    const body = $('stk-body');
    if (!body) return;
    const stks = s.stakeholders || [];
    const soon = 30;
    const expiring = (ns.Stakeholders && ns.Stakeholders.getExpiringCompliance)
      ? ns.Stakeholders.getExpiringCompliance(stks, soon)
      : [];
    const banner = $('stk-compliance');
    if (banner) {
      const n = expiring.length;
      const txt = n
        ? n + ' stakeholder' + (n === 1 ? ' has' : 's have') + ' COI or license documentation expiring within ' + soon + ' days , see the Compliance columns below.'
        : '';
      banner.classList.toggle('is-hide', !n);
      const btxt = banner.querySelector('.stk-cmp-txt');
      if (btxt) btxt.textContent = txt;
    }
    syncStakeComplianceBadges(expiring.length);
    if (ns.Bids) {
      if (ns.Bids.render) ns.Bids.render();
      if (ns.Bids.renderGoNoGo) ns.Bids.renderGoNoGo();
    }
    if (stks.length === 0) {
      body.innerHTML = emptyStateRow(12, 'No stakeholders registered yet.', '<button class="btn btn-g btn-s" data-action="addStake">+ Add Stakeholder</button>');
      return;
    }
    body.innerHTML = stks.map((stk, i) => {
      const coi = stk.coiExpiry ? new Date(stk.coiExpiry) : null;
      const lic = stk.licenseExpiry ? new Date(stk.licenseExpiry) : null;
      const coiBad = coi && coi <= new Date(Date.now() + soon * 86400000);
      const licBad = lic && lic <= new Date(Date.now() + soon * 86400000);
      const emrStale = ns.Stakeholders && ns.Stakeholders.isEmrStale ? ns.Stakeholders.isEmrStale(stk) : false;
      const coiCell = `<input type="date" value="${U.escapeHtml(stk.coiExpiry || '')}" class="${coiBad ? 'stk-exp-bad' : ''}" data-action="updField" data-module="Stakeholders" data-field="coiExpiry" data-idx="${i}" title="COI expiry${coiBad ? ' , expires within ' + soon + ' days' : ''}">${coiBad ? `<span class="badge br" title="Expires within ${soon} days">soon</span>` : ''}`;
      const licCell = `<input type="date" value="${U.escapeHtml(stk.licenseExpiry || '')}" class="${licBad ? 'stk-exp-bad' : ''}" data-action="updField" data-module="Stakeholders" data-field="licenseExpiry" data-idx="${i}" title="Trade license expiry${licBad ? ' , expires within ' + soon + ' days' : ''}">${licBad ? `<span class="badge br" title="Expires within ${soon} days">soon</span>` : ''}`;
      const emrCell = `<input type="text" value="${U.escapeHtml(stk.emr || '')}" data-action="updField" data-module="Stakeholders" data-field="emr" data-idx="${i}" style="width:52px" placeholder="0.00">${emrStale ? `<span class="badge br" title="EMR stale , verify or set a verification date">stale</span>` : ''}`;
      return `<tr>
      <td>${U.escapeHtml(stk.id || 'S' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(stk.name)}" data-action="updField" data-module="Stakeholders" data-field="name" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(stk.role || '')}" data-action="updField" data-module="Stakeholders" data-field="role" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Stakeholders" data-field="influence" data-idx="${i}">${['Low','Medium','High'].map(v => `<option ${stk.influence === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="Stakeholders" data-field="interest" data-idx="${i}">${['Low','Medium','High'].map(v => `<option ${stk.interest === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(stk.strategy || '')}" data-action="updField" data-module="Stakeholders" data-field="strategy" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(stk.contact || '')}" data-action="updField" data-module="Stakeholders" data-field="contact" data-idx="${i}"></td>
      <td>${coiCell}</td>
      <td>${licCell}</td>
      <td>${emrCell}</td>
      <td><input type="date" value="${U.escapeHtml(stk.emrVerifiedAt || '')}" data-action="updField" data-module="Stakeholders" data-field="emrVerifiedAt" data-idx="${i}" title="EMR verification date"></td>
      <td><button class="btn btn-s btn-d" data-action="delStake" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
  }

  function syncStakeComplianceBadges(count) {
    const h = $('h-coi');
    if (h) h.textContent = count;
    const card = $('health-card');
    if (card) card.classList.toggle('has-compliance', count > 0);
    document.querySelectorAll('[data-section="stk"] .sec-badge').forEach(function(b) {
      b.textContent = count;
      b.classList.toggle('is-hide', count === 0);
    });
  }

  // ---- Changes ----
  function renderChanges() {
    const s = S();
    if (!s) return;
    const body = $('chg-body');
    if (!body) return;
    const changes = s.changes || [];
    if (changes.length === 0) {
      body.innerHTML = emptyStateRow(11, 'No change requests logged yet.', '<button class="btn btn-g btn-s" data-action="addChange">+ Add Change Request</button>');
      return;
    }
    const Render = ns.Render || {};
    const parseImpactDays = Render.parseImpactDays || function() { return 0; };
    const parseImpactCost = Render.parseImpactCost || function() { return 0; };
    const exposedLines = (s.budgetLines || []).length;
    const downstreamTasks = (s.tasks || []).filter(t => t.status !== 'completed' && t.endDate && !U.isOverdue(t.endDate)).length;
    body.innerHTML = changes.map((c, i) => {
      const days = parseImpactDays(c.schedImpact);
      const cost = parseImpactCost(c.costImpact);
      const hasRipple = days > 0 || cost > 0 || exposedLines > 0;
      const rippleHtml = hasRipple
        ? `<span style="color:${c.status === 'approved' ? 'var(--green)' : 'var(--amber)'}">~${days}d · ${exposedLines} lines${cost ? ' · $' + cost.toLocaleString() : ''}${downstreamTasks ? ' · ' + downstreamTasks + ' tasks' : ''}</span>`
        : '-';
      return `<tr>
      <td>${U.escapeHtml(c.id || 'C' + (i+1))}</td>
      <td><input type="date" value="${c.date || ''}" data-action="updField" data-module="Changes" data-field="date" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(c.title)}" data-action="updField" data-module="Changes" data-field="title" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(c.requester || '')}" data-action="updField" data-module="Changes" data-field="requester" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(c.schedImpact || '')}" data-action="updField" data-module="Changes" data-field="schedImpact" data-idx="${i}" style="width:100px" title="e.g. +10 days / 2 weeks"></td>
      <td><input type="text" value="${U.escapeHtml(c.costImpact || '')}" data-action="updField" data-module="Changes" data-field="costImpact" data-idx="${i}" style="width:100px" title="e.g. $25,000"></td>
      <td><select data-action="updField" data-module="Changes" data-field="status" data-idx="${i}">${['submitted','review','approved','rejected','cancelled'].map(s => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td class="chg-ripple">${rippleHtml}</td>
      <td><input type="text" value="${U.escapeHtml(c.approvedBy || '')}" data-action="updField" data-module="Changes" data-field="approvedBy" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(c.notes || '')}" data-action="updField" data-module="Changes" data-field="notes" data-idx="${i}"></td>
      <td><button class="btn btn-s btn-d" data-action="delChange" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
  }

  // ---- Log ----
  function renderLog() {
    const s = S();
    if (!s) return;
    const body = $('log-body');
    if (!body) return;
    const entries = s.logEntries || [];
    if (entries.length === 0) {
      body.innerHTML = emptyStateRow(5, 'No decision log entries yet.', '<button class="btn btn-g btn-s" data-action="addLog">+ Add Entry</button>');
      return;
    }
    body.innerHTML = entries.map((e, i) => `<tr>
      <td style="font-size:.7rem;white-space:nowrap">${U.escapeHtml(e.date || e.timestamp || '')}</td>
      <td><input type="text" value="${U.escapeHtml(e.decision || e.text || '')}" data-action="updField" data-module="Log" data-field="decision" data-idx="${i}" style="min-width:200px"></td>
      <td><input type="text" value="${U.escapeHtml(e.by || e.person || '')}" data-action="updField" data-module="Log" data-field="by" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(e.actionItems || '')}" data-action="updField" data-module="Log" data-field="actionItems" data-idx="${i}"></td>
      <td><button class="btn btn-s btn-d" data-action="delLog" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- RACI ----
  function renderRaci() {
    const s = S();
    if (!s || !s.raci) return;
    const con = $('raci-con');
    if (!con) return;
    const raci = s.raci;
    const tasks = raci.tasks || [];
    const persons = raci.persons || [];
    const matrix = raci.matrix || {};
    const Raci = ns.Raci;
    if (!Raci) { con.innerHTML = ''; return; }
    if (Raci.refreshRaciPersonPicker) Raci.refreshRaciPersonPicker();
    if (Raci.refreshRaciTaskPicker) Raci.refreshRaciTaskPicker();
    if (tasks.length === 0 && persons.length === 0) {
      con.innerHTML = '<div class="es"><div class="ic"><svg class="ico" style="font-size:2rem" aria-hidden="true"><use href="css/mmgr-icons.svg#i-users"></use></svg></div>' +
        '<div>No RACI matrix yet , add a task row and a person column using the two pickers above.</div></div>';
      renderRaciAlerts();
      return;
    }
    if (tasks.length === 0 || persons.length === 0) {
      con.innerHTML = '<div style="font-size:.78rem;color:var(--slate);padding:20px;text-align:center">' +
        (tasks.length === 0 ? 'Add a task row to build the matrix.' : 'Add a person column to build the matrix.') +
        '</div>';
      renderRaciAlerts();
      return;
    }
    const esc = (s2) => (s2 || '').replace(/"/g, '&quot;');
    const legend = '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:.7rem;color:var(--slate)">' +
      Raci.RACI_CYCLE_FILTERED().map(k => `<span><span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:4px;font-weight:800;background:${Raci.raciCellBg(k)};color:${Raci.raciCellFg(k)};border:1px solid ${Raci.raciCellFg(k)}">${k}</span> ${Raci.RACI_LABELS[k].split(' , ')[0]}</span>`).join('') +
      '<span style="margin-left:auto">Click a cell to cycle R → A → C → I → blank · Right-click to go back</span></div>';
    let html = legend + '<table class="dt"><thead><tr><th style="min-width:200px">Task / Deliverable</th>';
    persons.forEach((p, pi) => {
      const info = Raci.raciPersonInfo(p);
      const head = info.live
        ? `<div style="font-size:.7rem;font-weight:700">${esc(info.name)}</div><div style="font-size:.65rem;color:var(--slate)">${esc(info.role) || '&nbsp;'}</div><div class="raci-live-tag"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-link"></use></svg> ${info.tag}</div>`
        : `<input value="${esc(info.name)}" data-action="updRaciPerson" data-idx="${pi}" data-field="name" style="font-size:.7rem;font-weight:700;width:90px"><div><input value="${esc(info.role)}" data-action="updRaciPerson" data-idx="${pi}" data-field="role" style="font-size:.65rem;color:var(--slate);width:90px" placeholder="Role"></div>`;
      html += `<th style="min-width:110px">${head}<button class="btn btn-s btn-d" data-action="delRaciPerson" data-idx="${pi}" style="margin-top:2px">remove</button></th>`;
    });
    html += '</tr></thead><tbody>';
    tasks.forEach((t, ti) => {
      const info = Raci.raciTaskInfo(t);
      const cell = info.live
        ? `<div style="min-width:190px;font-size:.78rem"><span style="color:var(--gold);font-size:.65rem">${esc(info.wbs)}</span> ${esc(info.name)} <span class="raci-live-tag"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-link"></use></svg> WBS</span></div>`
        : `<input value="${esc(info.name)}" data-action="updRaciTask" data-idx="${ti}" style="min-width:190px">`;
      html += `<tr><td>${cell}</td>`;
      persons.forEach(p => {
        const key = `${t.id}_${p.id}`;
        const val = matrix[key] || '';
        html += `<td style="text-align:center">
          <button type="button" class="raci-cell" tabindex="0" data-action="cycleRaci" data-task="${U.escapeHtml(t.id)}" data-person="${U.escapeHtml(p.id)}" title="${esc(Raci.RACI_LABELS[val])}" style="background:${Raci.raciCellBg(val)};color:${Raci.raciCellFg(val)};border:1.5px solid ${val ? Raci.raciCellFg(val) : 'var(--border)'}">${val || '·'}</button>
        </td>`;
      });
      html += `<td><button class="btn btn-s btn-d" data-action="delRaciTask" data-idx="${ti}">×</button></td></tr>`;
    });
    html += '</tbody></table>';
    con.innerHTML = html;
    renderRaciAlerts();
    renderRaciHeatmap();
  }

  // ---- 4.2 RACI workload heatmap ----
  function renderRaciHeatmap() {
    const el = $('raci-heatmap');
    if (!el) return;
    const s = S();
    const raci = (s && s.raci) || { tasks: [], persons: [], matrix: {} };
    if (!(raci.persons || []).length) {
      el.innerHTML = '';
      return;
    }
    const rows = ns.Raci.raciWorkload(s);
    const heat = (pct) => pct >= 75 ? 'var(--danger)' : pct >= 50 ? 'var(--amber)' : pct >= 25 ? 'var(--gold)' : 'var(--green)';
    el.innerHTML = '<div class="rst" style="margin-top:18px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-bar-chart"></use></svg> Team Workload (4.2)</div>' +
      '<div class="rw-grid">' + rows.map(r => {
        const nm = r.info.name || '-';
        const c = r.counts;
        const barColor = heat(r.pct);
        return `<div class="rw-cell">
          <div class="rw-head"><span class="rw-name">${U.escapeHtml(nm)}</span><span class="rw-load" style="color:${barColor}">${r.load.toFixed(1)}</span></div>
          <div class="rw-bar"><div class="rw-fill" style="width:${Math.max(4, r.pct)}%;background:${barColor}"></div></div>
          <div class="rw-counts"><span class="rw-r">R ${c.R}</span><span class="rw-a">A ${c.A}</span><span class="rw-c">C ${c.C}</span><span class="rw-i">I ${c.I}</span></div>
        </div>`;
      }).join('') + '</div>';
  }

  // ---- RACI alerts (feature 5) ----
  function renderRaciAlerts() {
    const s = S();
    const el = $('raci-alerts');
    if (!el) return;
    const raci = (s && s.raci) || { tasks: [], persons: [], matrix: {} };
    const { tasks, persons, matrix } = raci;
    const Raci = ns.Raci;
    if (!Raci) { el.innerHTML = ''; return; }
    const alerts = [];
    tasks.forEach(t => {
      const hasA = persons.some(p => matrix[t.id + '_' + p.id] === 'A');
      if (!hasA && persons.length) {
        const ti = Raci.raciTaskInfo(t);
        alerts.push(`"${ti.name}" has no Accountable person assigned.`);
      }
      const aCount = persons.filter(p => matrix[t.id + '_' + p.id] === 'A').length;
      if (aCount > 1) {
        const ti = Raci.raciTaskInfo(t);
        alerts.push(`"${ti.name}" has ${aCount} Accountable people , exactly one is expected.`);
      }
    });
    persons.forEach(p => {
      const aCount = tasks.filter(t => matrix[t.id + '_' + p.id] === 'A').length;
      if (aCount > 5) {
        const pi = Raci.raciPersonInfo(p);
        alerts.push(`${pi.name} is Accountable for ${aCount} tasks , consider redistributing.`);
      }
    });
    el.innerHTML = alerts.map(a => `<div style="font-size:.72rem;color:var(--amber);margin-bottom:3px">${a}</div>`).join('');
  }

  // ---- Comms ----
  function renderComms() {
    const s = S();
    if (!s) return;
    const body = $('comms-body');
    if (!body) return;
    const entries = s.commsEntries || [];
    if (entries.length === 0) {
      body.innerHTML = emptyStateRow(8, 'No communications logged yet.', '<button class="btn btn-g btn-s" data-action="addComms">+ Add Entry</button>');
      return;
    }
    body.innerHTML = entries.map((e, i) => `<tr>
      <td>${U.escapeHtml(e.id || 'C' + (i+1))}</td>
      <td><input type="date" value="${e.date || ''}" data-action="updField" data-module="Comms" data-field="date" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Comms" data-field="type" data-idx="${i}">${['Meeting','Call','Email','Site Visit','Letter'].map(t => `<option ${e.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(e.attendees || '')}" data-action="updField" data-module="Comms" data-field="attendees" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(e.summary || '')}" data-action="updField" data-module="Comms" data-field="summary" data-idx="${i}" style="min-width:150px"></td>
      <td><input type="text" value="${U.escapeHtml(e.actionItems || '')}" data-action="updField" data-module="Comms" data-field="actionItems" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(e.followUp || '')}" data-action="updField" data-module="Comms" data-field="followUp" data-idx="${i}"></td>
      <td><button class="btn btn-s btn-d" data-action="delComms" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  ns.RenderPeople = {
    renderStakeholders: renderStakeholders,
    syncStakeComplianceBadges: syncStakeComplianceBadges,
    renderChanges: renderChanges,
    renderLog: renderLog,
    renderRaci: renderRaci,
    renderRaciHeatmap: renderRaciHeatmap,
    renderRaciAlerts: renderRaciAlerts,
    renderComms: renderComms
  };
})(MMGR);
window.MMGR = MMGR;
