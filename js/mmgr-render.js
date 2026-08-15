/* ============================================================
   My MaNaGeR — Rendering Engine
   All panel rendering functions.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State ? ns.State.getState() : null;
  const U = ns.Utils;
  const $ = U.$;

  // ---- Empty-state row helper (STRUCTURAL-IA §5) ----
  // Three-part empty state: explain why it's empty, give a direct primary
  // action (an EXISTING data-action, surfaced prominently), and keep the
  // chrome quiet. Used by every panel that renders a table from state data.
  function emptyStateRow(colspan, text, actionsHtml) {
    return '<tr><td colspan="' + colspan + '"><div class="es es-row">' +
      '<div>' + text + '</div>' +
      (actionsHtml ? '<div class="es-actions">' + actionsHtml + '</div>' : '') +
      '</div></td></tr>';
  }

  // ---- Render Queue (batched updates) ----
  let _renderQueue = [];
  let _renderScheduled = false;

  function scheduleRender(fn) {
    _renderQueue.push(fn);
    if (!_renderScheduled) {
      _renderScheduled = true;
      requestAnimationFrame(() => {
        const batch = _renderQueue.slice();
        _renderQueue = [];
        _renderScheduled = false;
        batch.forEach(fn => fn());
      });
    }
  }

  // ---- Greeting ----
  // SINGLE-WRITE (CLOUD-BACKEND-ARCHITECTURE-PLAN §10 self-overwrite bug):
  // the old implementation wrote "Welcome, {userName}" into #greeting-text,
  // then IMMEDIATELY overwrote the parent #greeting's innerHTML with a
  // time-of-day-only message — destroying the name on every render (this is
  // why the personalized greeting never appeared). Now the icon (time of
  // day) + text (time label + name suffix) are composed ONCE and written as
  // a single innerHTML assignment. The name is escapeHtml'd because it is
  // interpolated into markup, not set via textContent.
  function renderGreeting() {
    const g = $('greeting');
    if (!g) return;
    const s = S();
    const hour = new Date().getHours();
    let icon = 'i-moon', timeLabel = 'Good Evening';
    if (hour < 12) { icon = 'i-sun'; timeLabel = 'Good Morning'; }
    else if (hour < 18) { icon = 'i-sun'; timeLabel = 'Good Afternoon'; }
    const nameSuffix = (s && s.userName) ? ', ' + U.escapeHtml(String(s.userName)) : '';
    g.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#' + icon + '"></use></svg> <span id="greeting-text">' + timeLabel + nameSuffix + '</span>';
  }

  // ---- Methodology ----
  function renderMethodology() {
    const s = S();
    if (!s) return;
    const meth = s.methodology || 'waterfall';
    const methLabel = meth.charAt(0).toUpperCase() + meth.slice(1);
    const el = $('meth-lbl');
    if (el) el.textContent = methLabel + ' View';
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.toLowerCase() === meth);
    });
    // Sprint visibility (is-hide class, not inline style)
    const sprintPanel = $('sprint-p');
    if (sprintPanel) sprintPanel.classList.toggle('is-hide', meth !== 'agile');
    // SIDEBAR-HAMBURGER-TOGGLE-PLAN: the gate targets EVERY .sec-btn for the
    // section (top pill nav + desktop sidebar clones), not just #dmaic-nav by
    // id — the sidebar mirrors the same visibility by construction.
    document.querySelectorAll('.sec-btn[data-section="dmaic"]').forEach(function (el) {
      el.classList.toggle('is-hide', meth !== 'hybrid');
    });
  }

  // ---- Lock Indicator ----
  function renderLock() {
    const s = S();
    if (!s) return;
    const locked = s.methodologyLocked;
    const ind = $('lk-ind');
    if (ind) {
      ind.classList.toggle('on', !!locked);
      $('lk-lbl').textContent = s.methodology ? s.methodology.charAt(0).toUpperCase() + s.methodology.slice(1) : '';
    }
    // Glass §5: the Lock button is a binary chip — solid when locked.
    const lockBtn = document.querySelector('[data-action="tglLock"]');
    if (lockBtn) lockBtn.classList.toggle('is-on', !!locked);
  }

  // ---- Dashboard ----
  function renderDash() {
    const s = S();
    if (!s || !s.tasks) return;
    // DIR-3: keep the Core-Mode onboarding callout in sync with pack state
    // (a pack toggled on elsewhere must hide it the moment the user returns
    // to the Dashboard).
    renderCoreCallout();
    const tasks = s.tasks;
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'completed').length;
    const ip = tasks.filter(t => t.status === 'inprogress').length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;
    const overdue = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
    const atRisk = tasks.filter(t => U.isDueSoon(t.endDate, 3) && t.status !== 'completed').length;
    const issues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length;

    // Ring (STRUCTURAL-IA §1: brand-new project ≠ 0% — quiet the empty zero)
    // circ = 2πr with r=39 — matches the ring markup (thicker 18px stroke,
    // owner 2026-08-15).
    const pct = total ? Math.round((done / total) * 100) : 0;
    const circ = 245;
    const offset = circ - (circ * pct / 100);
    const rf = $('rf');
    if (rf) rf.style.strokeDashoffset = offset;
    const rt = $('rt');
    if (rt) rt.textContent = total === 0 ? 'No tasks yet' : pct + '% Completed';
    const dc = $('dc');
    if (dc) { dc.textContent = done; dc.style.color = total === 0 ? 'var(--slate)' : ''; }
    const tc = $('tc');
    if (tc) { tc.textContent = total; tc.style.color = total === 0 ? 'var(--slate)' : ''; }

    // Health
    const setVal = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    setVal('h-ip', ip); setVal('h-ar', atRisk); setVal('h-bl', blocked);
    setVal('h-dn', done); setVal('h-od', overdue); setVal('h-is', issues);
    // MARKET-FEATURE-ROADMAP A1: subcontractor compliance count on the
    // Dashboard Project Health card (same badge pattern as the risk counts).
    // renderDash runs on every renderAll, so this is ALSO where the
    // Stakeholders nav-badge count stays fresh — the nav pill must reflect
    // compliance even before the Stakeholders section is ever opened.
    const stkCmp = (ns.Stakeholders && ns.Stakeholders.getExpiringCompliance)
      ? ns.Stakeholders.getExpiringCompliance(s.stakeholders || [], 30).length
      : 0;
    syncStakeComplianceBadges(stkCmp);
    // §4 tiering: a non-zero Blocked/Overdue/Live-Issues count gets the
    // strongest static treatment — existing --danger token, no motion.
    const healthCard = $('health-card');
    if (healthCard) {
      healthCard.classList.toggle('has-danger', blocked > 0 || overdue > 0 || issues > 0);
      // §1: brand-new project — quiet the zero badges too.
      healthCard.classList.toggle('health-empty', total === 0);
    }

    // Next 3 priority actions
    const n3 = $('n3');
    if (n3) {
      if (total === 0) {
        // STRUCTURAL-IA §1: a brand-new project (no tasks at all) is NOT the
        // same state as "all tasks complete" — give it a real empty state.
        n3.innerHTML = '<li class="txt-sl">No tasks yet — add your first task to see prioritized next steps.</li>' +
          '<li class="txt-sl"><button class="btn btn-g btn-s" data-action="showSec" data-section="wbs">+ Add Task</button></li>';
      } else if (done === total) {
        n3.innerHTML = `<li class="n3-done"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check-circle"></use></svg> ${done} of ${total} tasks complete — nothing pending.</li>`;
      } else {
        const sorted = tasks
          .filter(t => t.status !== 'completed')
          .sort((a, b) => {
            // Critical path first, then due soon, then by priority
            const aCrit = a.critical ? 1 : 0;
            const bCrit = b.critical ? 1 : 0;
            if (bCrit !== aCrit) return bCrit - aCrit;
            const aDue = a.endDate ? U.daysBetween(new Date(), a.endDate) : 999;
            const bDue = b.endDate ? U.daysBetween(new Date(), b.endDate) : 999;
            return aDue - bDue;
          })
          .slice(0, 3);
        // The row text sits in a single-line ellipsis span (same pattern as
        // the health-row labels) so a long priority name can never wrap and
        // break the 33px row rhythm — at any sidebar width (OWNER 2026-08-15
        // sidebar-only view narrowed the content column).
        n3.innerHTML = sorted.map(t => `<li><span title="${U.escapeHtml(t.name)}">${U.escapeHtml(t.name)}${t.critical ? ' <svg class="ico" aria-hidden="true" style="color:var(--gold)"><use href="css/mmgr-icons.svg#i-target"></use></svg>' : ''}${t.endDate ? ' — due ' + U.fmtDateShort(t.endDate) : ''}</span></li>`).join('');
      }
    }

    // ---- Dashboard stat cards (STRUCTURAL-IA §1 empty states + §4 tiering) ----
    // Budget Variance
    const bud = s.budgetLines || [];
    const planned = bud.reduce((sum, l) => sum + (+l.planned || 0), 0);
    const actual = bud.reduce((sum, l) => sum + (+l.actual || 0), 0);
    const variance = planned - actual;
    const budEl = $('dw-bud');
    const budCard = $('dw-bud-card');
    if (budEl) {
      if (bud.length === 0) {
        // Empty: explain why + quiet the zero (§1.2).
        budEl.textContent = '—';
        budEl.style.color = 'var(--slate)';
        if (budCard) budCard.classList.add('tier3');
      } else {
        budEl.textContent = (variance >= 0 ? '+' : '') + '$' + Math.abs(variance).toLocaleString();
        budEl.style.color = variance >= 0 ? 'var(--green)' : 'var(--danger)';
        if (budCard) budCard.classList.remove('tier3');
      }
    }
    const budSub = $('dw-bud-sub');
    if (budSub) {
      if (bud.length === 0) budSub.innerHTML = 'No budget lines yet — add one in Budget';
      else budSub.textContent = `Planned: $${planned.toLocaleString()} | Actual: $${actual.toLocaleString()}`;
    }

    // Resource Utilization
    const resources = s.resources || [];
    const avgUtil = resources.length ? Math.round(resources.reduce((sum, r) => sum + (ns.Resources && ns.Resources.resUtil ? ns.Resources.resUtil(r) : (+r.utilization || 0)), 0) / resources.length) : 0;
    const utilEl = $('dw-util');
    const utilCard = $('dw-util-card');
    if (utilEl) {
      if (resources.length === 0) {
        utilEl.textContent = '—';
        utilEl.style.color = 'var(--slate)';
        if (utilCard) utilCard.classList.add('tier3');
      } else {
        utilEl.textContent = avgUtil + '%';
        utilEl.style.color = '';
        if (utilCard) utilCard.classList.remove('tier3');
      }
    }
    setVal('dw-util-sub', resources.length ? `Avg across ${resources.length} resources` : 'No resources added — add them in Resources');

    // Pending Changes
    const changes = s.changes || [];
    const pending = changes.filter(c => c.status === 'submitted' || c.status === 'review').length;
    const chgEl = $('dw-chg');
    const chgCard = $('dw-chg-card');
    if (chgEl) {
      if (changes.length === 0) {
        chgEl.textContent = '—';
        chgEl.style.color = 'var(--slate)';
        if (chgCard) chgCard.classList.add('tier3');
      } else {
        chgEl.textContent = pending;
        chgEl.style.color = '';
        if (chgCard) chgCard.classList.remove('tier3');
      }
    }

    // Baseline Variance
    const base = s.baseline;
    const baseEl = $('dw-base');
    const baseSub = $('dw-base-sub');
    const baseCard = $('dw-base-card');
    if (base && baseEl) {
      const baseTasks = base.tasks || [];
      const baseDone = baseTasks.filter(t => t.status === 'completed').length;
      const basePct = baseTasks.length ? Math.round((baseDone / baseTasks.length) * 100) : 0;
      const currentPct = total ? Math.round((done / total) * 100) : 0;
      const diff = currentPct - basePct;
      baseEl.textContent = (diff >= 0 ? '+' : '') + diff + '%';
      baseEl.style.color = diff >= 0 ? 'var(--green)' : 'var(--danger)';
      if (baseSub) baseSub.textContent = `vs baseline (${basePct}% at capture)`;
      if (baseCard) baseCard.classList.remove('tier3');
    } else if (baseEl) {
      baseEl.textContent = '—';
      baseEl.style.color = 'var(--slate)';
      if (baseSub) baseSub.textContent = 'No baseline saved — use Save Baseline in Settings';
      if (baseCard) baseCard.classList.add('tier3');
    }

    // Baseline variance table — schedule days per task + overall cost delta
    const bvt = $('base-var-body');
    if (bvt) {
      const currentMap = {};
      (s.tasks || []).forEach(t => { currentMap[t.id] = t; });
      let costVar = null;
      if (base && base.tasks) {
        const basePlanned = (base.budgetLines || []).reduce((sum, l) => sum + (+l.planned || 0), 0);
        const curPlanned = bud.reduce((sum, l) => sum + (+l.planned || 0), 0);
        if (basePlanned > 0 || curPlanned > 0) costVar = curPlanned - basePlanned;
        const rows = [];
        (base.tasks || []).forEach(bt => {
          const cur = currentMap[bt.id];
          if (!cur) return;
          let schedVar = null;
          if (bt.endDate && cur.endDate) schedVar = U.daysBetween(bt.endDate, cur.endDate);
          rows.push({ name: bt.name, bEnd: bt.endDate || '', cEnd: cur.endDate || '', schedVar: schedVar });
        });
        if (rows.length === 0) {
          bvt.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--slate);padding:14px">Save a baseline to see per-task schedule variance.</td></tr>';
        } else {
          bvt.innerHTML = rows.map(r =>
            '<tr><td>' + U.escapeHtml(r.name) + '</td><td>' + U.escapeHtml(r.bEnd || '—') + '</td><td>' + U.escapeHtml(r.cEnd || '—') + '</td>' +
            '<td style="' + (r.schedVar === null ? '' : (r.schedVar > 0 ? 'color:var(--danger)' : r.schedVar < 0 ? 'color:var(--green)' : '')) + '">' +
            (r.schedVar === null ? '—' : (r.schedVar > 0 ? '+' + r.schedVar + 'd' : r.schedVar + 'd')) + '</td></tr>'
          ).join('');
        }
      } else {
        bvt.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--slate);padding:14px">No baseline captured yet. Use Save Baseline in Settings &gt; Controls.</td></tr>';
      }
      const costEl = $('base-var-cost');
      if (costEl) {
        costEl.textContent = costVar === null ? 'n/a' : ((costVar >= 0 ? '+' : '') + '$' + Math.abs(costVar).toLocaleString());
        costEl.style.color = costVar === null ? 'var(--slate)' : (costVar > 0 ? 'var(--danger)' : 'var(--green)');
      }
    }

    // Resource over-allocation warning (same assignee on overlapping critical tasks)
    const rwWrap = $('res-warn-wrap');
    const rw = $('res-warn');
    if (rw && rwWrap) {
      const conflicts = (ns.Schedule && ns.Schedule.findResourceConflicts) ? ns.Schedule.findResourceConflicts() : [];
      if (conflicts.length) {
        rwWrap.classList.remove('is-hide');
        rw.innerHTML = conflicts.map(c =>
          '<div style="padding:5px 0"><span class="badge br" style="font-size:.62rem">OVER-ALLOC</span> ' +
          U.escapeHtml(c.assignee) + ' is assigned to overlapping critical tasks ' +
          '<code>' + U.escapeHtml(c.a) + '</code> and <code>' + U.escapeHtml(c.b) + '</code></div>'
        ).join('');
      } else {
        rwWrap.classList.add('is-hide');
      }
    }

    // Active Issues
    const issEl = $('d-iss');
    if (issEl) {
      const activeIssues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
      if (activeIssues.length === 0) {
        issEl.innerHTML = 'No active issues logged.';
      } else {
        issEl.innerHTML = activeIssues.map(i => `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">${U.escapeHtml(i.description)} <span class="badge br" style="font-size:.65rem">${i.status || 'open'}</span></div>`).join('');
      }
    }

    // Health Score (feature 1) — must be cheap; renders only its own card.
    if (ns.Health && ns.Health.render) ns.Health.render();
    // DMAIC progress signal (visible only while DMAIC is active)
    if (ns.Dmaic && ns.Dmaic.renderSignal) ns.Dmaic.renderSignal();
    // EVM (feature 4)
    if (ns.Evm && ns.Evm.render) ns.Evm.render();
    // Today's Focus (feature 10)
    renderTodayView();
    // MARKET-FEATURE-ROADMAP C7/C8: 2-week Lookahead + Percent Plan Complete
    renderLookahead();
    renderPpc();
    // MARKET-FEATURE-ROADMAP C29: expiry & renewal rollup card.
    renderExpiryCard();
    // Today's Decision Engine (ACTION-PLAN 1.1) — impact-scored ranking
    if (ns.Decisions && ns.Decisions.render) ns.Decisions.render();
    // Milestone Timeline + Timeline Target status (feature 11)
    renderMilestoneTimeline();
    renderTimelineStatus();
    // V3.3/V3.5 secondary panels (monolith port) — Lead-Time Tracker,
    // Float Watch (+ Crash Candidates), Weather Variance, Schedule
    // Confidence. All read-only analytics over live state.
    renderLeadtimeTracker();
    renderFloatWatch();
    renderWeatherVariance();
    renderScheduleConfidence();
    // ACTION-PLAN Phase 3: action aging + weekly baseline narrative
    renderActionAging();
    renderStreak();
    renderBaselineNarrative();
    // ACTION-PLAN Phase 7: Open-Meteo forecast + delay log + LD/SRI
    renderSafetyBanner();
    renderWeatherForecast();
    renderWeatherLog();
    // Meetings (MEETING_TRACKING_SPEC)
    renderMeetingsPanel();
    // Rank 2: Weekly/Daily Digest Engine — 'What Changed' diff + snapshot
    if (ns.Digest && ns.Digest.render) ns.Digest.render();
  }

  // ---- Today's Focus View (MONOLITH-PORTING-GUIDE feature 10) ----
  // Tasks active today, due today, due this week, or in progress — at a
  // glance, without scrolling the full WBS. Status changes go through the
  // same updTaskField data-action the WBS uses.
  function renderTodayView() {
    const s = S();
    if (!s) return;
    const el = $('today-body');
    if (!el) return;
    const lbl = $('today-date-lbl');
    if (lbl) lbl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in7 = new Date(today); in7.setDate(today.getDate() + 7);
    const tasks = s.tasks || [];
    const overdue = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed');
    const dueToday = tasks.filter(t => !U.isOverdue(t.endDate) && t.endDate && t.status !== 'completed' && U.parseDL(t.endDate) && U.parseDL(t.endDate).getTime() === today.getTime());
    const thisWeek = tasks.filter(t => !U.isOverdue(t.endDate) && t.endDate && t.status !== 'completed' && U.parseDL(t.endDate) && U.parseDL(t.endDate).getTime() > today.getTime() && U.parseDL(t.endDate) <= in7);
    const inProgress = tasks.filter(t => t.status === 'inprogress' && !U.isOverdue(t.endDate) && !(t.endDate && U.parseDL(t.endDate) <= in7));
    const renderGroup = (title, list, color, icon) => {
      if (!list.length) return '';
      const head = `<div class="tf-head" style="color:${color}"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#${icon}"></use></svg> ${title} (${list.length})</div>`;
      const rows = list.map(t => `<div class="tf-row" style="border-left-color:${color}">
        <div><span class="tf-name">${U.escapeHtml(t.name)}</span>${t.endDate ? `<span class="tf-due"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-calendar"></use></svg> ${t.endDate}</span>` : ''}</div>
        <select class="tf-status" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="status"><option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option><option value="inprogress" ${t.status === 'inprogress' ? 'selected' : ''}>In Progress</option><option value="blocked" ${t.status === 'blocked' ? 'selected' : ''}>Blocked</option><option value="completed" ${t.status === 'completed' ? 'selected' : ''}>Completed</option></select>
      </div>`).join('');
      return `<div class="tf-group">${head}${rows}</div>`;
    };
    const content = [
      renderGroup('Overdue', overdue, 'var(--danger)', 'i-alert-triangle'),
      renderGroup('Due Today', dueToday, 'var(--amber)', 'i-dot'),
      renderGroup('Due This Week', thisWeek, 'var(--gold)', 'i-calendar'),
      renderGroup('In Progress', inProgress, 'var(--green)', 'i-tool')
    ].join('');
    el.innerHTML = content || '<div class="es es-ok"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Nothing urgent. All tasks on track.</div>';
  }

  // ---- Lookahead (MARKET-FEATURE-ROADMAP C7) ----
  // Short-horizon field view: every open task starting or finishing in the
  // next 2 weeks (plus overdue carryover), grouped by week — distinct from
  // the full Gantt. Status changes go through the same updTaskField the WBS
  // and Today's Focus use.
  function renderLookahead() {
    const s = S();
    if (!s) return;
    const el = $('lookahead-body');
    if (!el) return;
    const tasks = (ns.Schedule && ns.Schedule.lookaheadTasks) ? ns.Schedule.lookaheadTasks(s.tasks || [], 14) : [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const wkLabel = (d) => 'Week of ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const group = (label, list, color) => {
      if (!list.length) return '';
      const rows = list.map(t => `<div class="tf-row" style="border-left-color:${color}">
        <div><span class="tf-name">${U.escapeHtml(t.name)}</span><span class="tf-due">${t.startDate ? U.fmtDateShort(t.startDate) : '?'} → ${t.endDate ? U.fmtDateShort(t.endDate) : '?'}${t.assignee ? ' · ' + U.escapeHtml(t.assignee) : ''}${t.weatherExposed ? ' <svg class="ico" aria-hidden="true" style="color:var(--blue)"><use href="css/mmgr-icons.svg#i-cloud"></use></svg>' : ''}</span></div>
        <select class="tf-status" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="status"><option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option><option value="inprogress" ${t.status === 'inprogress' ? 'selected' : ''}>In Progress</option><option value="blocked" ${t.status === 'blocked' ? 'selected' : ''}>Blocked</option><option value="completed" ${t.status === 'completed' ? 'selected' : ''}>Completed</option></select>
      </div>`).join('');
      return `<div class="tf-group"><div class="tf-head" style="color:${color}"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-calendar"></use></svg> ${label} (${list.length})</div>${rows}</div>`;
    };
    const overdue = tasks.filter(t => t.endDate && new Date(t.endDate) < today);
    const wkStart = new Date(today); wkStart.setDate(today.getDate() + (7 - ((today.getDay() + 6) % 7)) % 7); // next Monday
    const thisWk = tasks.filter(t => t.endDate && new Date(t.endDate) >= today && new Date(t.endDate) < wkStart);
    const nextWk = tasks.filter(t => t.endDate && new Date(t.endDate) >= wkStart);
    const noEnd = tasks.filter(t => !t.endDate);
    const content = group('Overdue Carryover', overdue, 'var(--danger)')
      + group('This Week', thisWk, 'var(--gold)')
      + group('Next Week', nextWk, 'var(--green)')
      + (noEnd.length ? group('Starting Soon (no end date)', noEnd, 'var(--slate)') : '');
    el.innerHTML = content || '<div class="es" style="padding:14px;font-size:.78rem">No tasks starting or finishing in the next 2 weeks — the schedule ahead is clear.</div>';
  }

  // ---- Percent Plan Complete (MARKET-FEATURE-ROADMAP C8) ----
  // Lean metric: of the tasks planned to finish in each ISO week, how many
  // are completed. Current week figure + last 4 weeks as quiet history bars.
  function renderPpc() {
    const s = S();
    if (!s) return;
    const el = $('ppc-body');
    if (!el) return;
    const tasks = s.tasks || [];
    const now = computePpcSafe(tasks, 0);
    const hist = [1, 2, 3, 4].map(o => computePpcSafe(tasks, o)).reverse();
    const head = $('ppc-head');
    if (head) {
      if (now.planned === 0) head.textContent = 'No tasks planned to finish this week — add end dates to schedule work.';
      else head.textContent = now.completed + ' of ' + now.planned + ' tasks planned this week completed (' + now.pct + '%)';
    }
    const overdue = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
    const bars = hist.map(h => {
      const lbl = h.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const pct = h.pct === null ? 0 : h.pct;
      const w = h.planned ? pct : 2;
      const col = h.pct === null ? 'var(--border)' : pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--danger)';
      return `<div class="ppc-bar-row"><span class="ppc-bar-lbl">${lbl}</span><div class="ppc-bar-track"><div class="ppc-bar-fill" style="width:${Math.max(2, w)}%;background:${col}"></div></div><span class="ppc-bar-val">${h.pct === null ? '—' : pct + '%'}${h.planned ? ' (' + h.completed + '/' + h.planned + ')' : ''}</span></div>`;
    }).join('');
    el.innerHTML = `<div class="ppc-now">${now.planned ? `<span class="stat-xl" style="font-size:1.6rem;color:${now.pct >= 80 ? 'var(--green)' : now.pct >= 50 ? 'var(--amber)' : 'var(--danger)'}">${now.pct}%</span>` : '<span class="stat-xl" style="font-size:1.2rem;color:var(--slate)">—</span>'}</div>` +
      '<div class="ppc-bars">' + bars + '</div>' +
      (overdue ? `<div class="ppc-note"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> ${overdue} task${overdue === 1 ? ' is' : 's are'} overdue from earlier weeks.</div>` : '') +
      '<div class="ppc-basis">Basis: tasks whose end date falls in each week, by completion status.</div>';
  }

  // Safe wrapper — computePpc lives on Schedule; never let a missing module
  // kill the dashboard render.
  function computePpcSafe(tasks, offset) {
    if (ns.Schedule && ns.Schedule.computePpc) return ns.Schedule.computePpc(tasks, offset);
    return { planned: 0, completed: 0, pct: null, start: new Date(), end: new Date() };
  }

  // ---- Expiry & Renewals dashboard card (MARKET-FEATURE-ROADMAP C29) ----
  // Single rollup across COI/license/EMR, warranties, and permits — anything
  // with a date coming due in the next 60 days (or already past).
  function renderExpiryCard() {
    const s = S();
    if (!s) return;
    const el = $('expiry-body');
    if (!el) return;
    const wrap = $('expiry-card');
    const list = (ns.Compliance && ns.Compliance.getExpiryRollup)
      ? ns.Compliance.getExpiryRollup(60) : [];
    if (list.length === 0) {
      if (wrap) wrap.classList.add('is-hide');
      return;
    }
    if (wrap) wrap.classList.remove('is-hide');
    const setVal = (id, val) => { const x = $(id); if (x) x.textContent = val; };
    setVal('expiry-count', list.length + (list.length === 1 ? ' item' : ' items') + ' due');
    const kindColor = (k) => k === 'COI' || k === 'License' ? 'var(--gold)' : k === 'Warranty' ? 'var(--cyan)' : k === 'Permit' ? 'var(--amber)' : 'var(--danger)';
    el.innerHTML = list.map(x => {
      const dlTxt = x.daysLeft === null ? 'overdue' : x.daysLeft < 0 ? Math.abs(x.daysLeft) + 'd overdue' : x.daysLeft === 0 ? 'today' : x.daysLeft + 'd left';
      const dlColor = x.daysLeft === null || x.daysLeft < 0 ? 'var(--danger)' : x.daysLeft <= 14 ? 'var(--danger)' : x.daysLeft <= 30 ? 'var(--amber)' : 'var(--slate)';
      return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        <span class="badge" style="color:${kindColor(x.kind)};border-color:${kindColor(x.kind)}">${x.kind}</span>
        <span style="flex:1;font-size:.8rem">${U.escapeHtml(x.label)}${x.date ? ' <span style="color:var(--slate)">' + U.escapeHtml(x.date) + '</span>' : ''}</span>
        <span class="badge" style="color:${dlColor};border-color:${dlColor}">${dlTxt}</span>
      </div>`;
    }).join('');
  }

  // ---- Timeline Target status (feature 11) ----
  // Compares Charter Target Completion Date against the latest end date
  // among scheduled tasks. Returns null (never a fabricated number) unless
  // BOTH a Target Completion Date is set AND at least one task has an end
  // date.
  function computeTimelineStatus(state) {
    const s = state || S();
    if (!s) return null;
    const f = s.charter || {};
    if (!f.targetCompletion && !f.end) return null;
    const dated = (s.tasks || []).filter(t => t.endDate || t.end);
    if (!dated.length) return null;
    const targetDate = f.targetCompletion || f.end;
    const target = new Date(targetDate);
    const projected = new Date(Math.max.apply(null, dated.map(t => new Date(t.endDate || t.end).getTime())));
    const msPerDay = 86400000;
    const overrunDays = Math.round((projected - target) / msPerDay);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysToTarget = Math.round((target - today) / msPerDay);
    let status, cls;
    if (overrunDays <= 0) { status = overrunDays < 0 ? `Ahead of Target by ${Math.abs(overrunDays)}d` : 'On Target'; cls = 'bg'; }
    else if (overrunDays <= 14) { status = `At Risk — ${overrunDays}d over target`; cls = 'ba'; }
    else { status = `Over Target — ${overrunDays}d over`; cls = 'br'; }
    return { target: targetDate, start: (f.targetStart || f.start) || null, projected: projected.toISOString().slice(0, 10), overrunDays: overrunDays, daysToTarget: daysToTarget, status: status, cls: cls };
  }

  function renderTimelineStatus() {
    const s = S();
    if (!s) return;
    const wrap = $('timeline-target-card');
    if (!wrap) return;
    const t = computeTimelineStatus(s);
    const hdrBadge = $('timeline-ind');
    if (!t) {
      const f = s.charter || {};
      const msg = (!f.targetCompletion && !f.end)
        ? 'Set a <strong>Target Completion Date</strong> in the Charter tab to activate timeline tracking.'
        : 'Schedule at least one task with an end date (WBS/Gantt) to compare it against your Target Completion Date.';
      wrap.innerHTML = `<div class="es" style="padding:14px;font-size:.78rem">${msg}</div>`;
      if (hdrBadge) hdrBadge.classList.remove('on');
      return;
    }
    const color = t.overrunDays <= 0 ? 'var(--green)' : t.overrunDays <= 14 ? 'var(--amber)' : 'var(--danger)';
    wrap.innerHTML = `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
    <div style="text-align:center"><div style="font-size:1.9rem;font-weight:900;color:${color}">${t.overrunDays > 0 ? '+' : ''}${t.overrunDays}d</div><div style="font-size:.66rem;color:var(--slate)">vs Target Completion</div></div>
    <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:5px;font-size:.76rem">
      <div>Target Completion: <strong>${t.target}</strong>${t.start ? ` <span style="color:var(--slate)">(mobilized ${t.start})</span>` : ''}</div>
      <div>Current Planned Finish: <strong>${t.projected}</strong> <span style="color:var(--slate)">(latest scheduled task end date)</span></div>
      <div style="color:var(--slate)">${t.daysToTarget >= 0 ? t.daysToTarget + ' day(s) remaining to target' : Math.abs(t.daysToTarget) + ' day(s) past target date'}</div>
    </div>
    <span class="badge ${t.cls}" style="font-size:.75rem;padding:6px 14px;white-space:nowrap">${t.status}</span>
  </div>`;
    if (hdrBadge) {
      if (t.overrunDays > 0) {
        hdrBadge.textContent = (t.overrunDays <= 14 ? 'At risk — ' : 'Over — ') + t.overrunDays + 'd over target';
        hdrBadge.className = 'timeline-ind on ' + (t.overrunDays <= 14 ? 'ti-ba' : 'ti-br');
      } else {
        hdrBadge.classList.remove('on');
      }
    }
  }

  // ---- Milestone Timeline (feature 11) ----
  // Horizontal timeline of milestone tasks (t.milestone && endDate), distinct
  // from the full Gantt chart.
  function renderMilestoneTimeline() {
    const s = S();
    if (!s) return;
    const el = $('milestone-timeline');
    if (!el) return;
    const milestones = (s.tasks || []).filter(t => t.milestone && t.endDate).sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
    if (!milestones.length) {
      el.innerHTML = '<div class="es" style="padding:10px;font-size:.72rem">No milestones set. Tick the milestone box in WBS to mark milestones.</div>';
      return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    el.innerHTML = `<div style="display:flex;align-items:center;gap:0;overflow-x:auto;padding:8px 0">${milestones.map((m, i) => {
      const due = new Date(m.endDate); due.setHours(0, 0, 0, 0);
      const done = m.status === 'completed';
      const overdue = due < today && !done;
      const color = done ? 'var(--green)' : overdue ? 'var(--danger)' : 'var(--gold)';
      const icon = done ? '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg>' : overdue ? '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg>' : '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-diamond"></use></svg>';
      return `${i > 0 ? '<div style="height:2px;min-width:40px;background:var(--border);flex:1"></div>' : ''}<div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:100px;text-align:center"><div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:.8rem;color:#0b0c10;font-weight:700;flex-shrink:0">${icon}</div><div style="font-size:.68rem;font-weight:700;color:${color};max-width:90px">${U.escapeHtml(m.name)}</div><div style="font-size:.62rem;color:var(--slate)">${m.endDate}</div>${overdue ? '<div style="font-size:.6rem;color:var(--danger)">OVERDUE</div>' : ''}</div>`;
    }).join('')}</div>`;
  }

  // ---- Timeline Indicator ----
  function renderTimelineIndicator() {
    const s = S();
    if (!s) return;
    const ind = $('timeline-ind');
    if (!ind) return;
    const target = s.charter && s.charter.targetCompletion;
    if (!target) { ind.classList.remove('on'); return; }
    // Find the latest end date among tasks
    const tasks = s.tasks || [];
    let latestEnd = null;
    for (const t of tasks) {
      if (t.endDate && (!latestEnd || t.endDate > latestEnd)) latestEnd = t.endDate;
    }
    if (!latestEnd) { ind.classList.remove('on'); return; }
    const diff = U.daysBetween(target, latestEnd);
    if (diff > 0) {
      ind.classList.add('on', 'ti-br');
      ind.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Over target by ' + diff + 'd';
    } else if (diff < 0) {
      ind.classList.add('on', 'ti-ba');
      ind.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clock"></use></svg> ' + Math.abs(diff) + 'd ahead of target';
    } else {
      ind.classList.add('on', 'ti-ba');
      ind.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> On target';
    }
  }

  // ==================================================================
  // V3.3 / V3.5 Dashboard secondary panels (MONOLITH PORT)
  // ------------------------------------------------------------------
  // Lead-Time Tracker, Float Watch (+ Crash Candidates), Weather
  // Variance, Schedule Confidence — exact ports of the monolith
  // renderLeadtimeTracker / renderFloatWatch / renderWeatherVariance /
  // renderScheduleConfidence, rewritten against the modular field names
  // (startDate/endDate, totalFloat/floatBaseline, leadTime) and the CSS
  // class system instead of inline styles.
  // ==================================================================

  function getNearCritical() {
    if (ns.Schedule && ns.Schedule.getNearCritical) return ns.Schedule.getNearCritical();
    return [];
  }

  function crashCandidates() {
    if (ns.Schedule && ns.Schedule.crashCandidates) return ns.Schedule.crashCandidates();
    return [];
  }

  // ---- Lead-Time Tracker (monolith renderLeadtimeTracker) ----
  // Lead-time tasks tracked by Submitted/Expected dates instead of % done:
  // days remaining (or overdue) vs the Expected Date.
  function renderLeadtimeTracker() {
    const el = $('leadtime-tracker-body');
    if (!el) return;
    const s = S();
    const lt = ((s && s.tasks) || []).filter(t => t.leadTime);
    if (!lt.length) {
      el.innerHTML = '<div class="lt-empty">No lead-time tasks yet. In the WBS, mark any task as <strong>Lead-Time</strong> (or drag it onto the Lead-Time lane) to track vendor-side waits — procurement, utility applications, permits.</div>';
      return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // 2.3 procurement lead-time vs need-by: the earliest start of any task
    // that depends on this lead-time item is its need-by date. A flag fires
    // when the expected delivery pushes past it (schedule-risk flag).
    const needBy = {};
    lt.forEach(t => {
      const deps = ((s && s.tasks) || []).filter(d => (d.predecessors || []).some(p => String(p) === String(t.id)) && d.startDate);
      if (deps.length) {
        const starts = deps.map(d => U.parseDL(d.startDate)).filter(Boolean).sort((a, b) => a - b);
        if (starts.length) needBy[String(t.id)] = starts[0];
      }
    });
    const rows = lt.map(t => {
      const exp = U.parseDL(t.expectedDate);
      const days = exp ? Math.round((exp - today) / 86400000) : null;
      const isRed = days !== null && days <= 5;
      const needByDate = needBy[String(t.id)] || null;
      const pastNeedBy = !!(needByDate && exp && exp > needByDate);
      // Elapsed: auto-progress vs the submitted→expected span (monolith
      // auto-progress for leadtime tasks); falls back to t.done when the
      // WBS % is set, otherwise a quiet dash.
      let elapsed = '—';
      const sub = U.parseDL(t.submittedDate);
      if (sub && exp && exp > sub) {
        const pct = Math.round((today - sub) / (exp - sub) * 100);
        elapsed = Math.max(0, Math.min(100, pct)) + '%';
      } else if (t.done !== undefined && t.done !== null && t.done !== '') {
        elapsed = t.done + '%';
      }
      return { t, days, isRed, elapsed, needByDate, pastNeedBy };
    }).sort((a, b) => { if (a.days === null) return 1; if (b.days === null) return -1; return a.days - b.days; });
    const tableHtml = '<table class="lt-table"><thead><tr><th>Task</th><th>Submitted</th><th>Expected</th><th>Need-By</th><th>Days Left</th><th>Elapsed</th></tr></thead><tbody>' +
      rows.map(r => `<tr class="${r.isRed ? 'lt-warn' : ''}"><td>${U.escapeHtml(r.t.name)}</td><td class="lt-elapsed">${U.escapeHtml(r.t.submittedDate || '—')}</td><td>${U.escapeHtml(r.t.expectedDate || '—')}</td><td class="lt-days ${r.pastNeedBy ? 'red' : ''}">${r.needByDate ? r.needByDate.toISOString().slice(0, 10) + (r.pastNeedBy ? ' <span class="badge br" style="font-size:.58rem;padding:0 4px">past need-by</span>' : '') : '—'}</td><td class="lt-days ${r.isRed ? 'red' : (r.days !== null && r.days <= 15 ? 'amber' : '')}">${r.days === null ? '—' : (r.days < 0 ? Math.abs(r.days) + 'd over' : r.days + 'd')}</td><td class="lt-elapsed">${r.elapsed}</td></tr>`).join('') + '</tbody></table>';
    // Item 23: rolling 3-month material lead-time window — a 12-week rolling
    // forecast per lead-time item, revisited on a weekly cadence, with a
    // visible "last reviewed" staleness indicator so stale vendor data never
    // silently passes as current. Client-side only (state stamp).
    const weekMs = 7 * 86400000;
    const todayR = new Date(); todayR.setHours(0, 0, 0, 0);
    const rolling = lt.map(t => {
      const exp = U.parseDL(t.expectedDate);
      const segs = [];
      for (let w = 0; w < 12; w++) {
        const wkStart = new Date(todayR.getTime() + w * weekMs);
        const wkEnd = new Date(wkStart.getTime() + weekMs);
        let cls = 'ltr-clear';
        if (exp) {
          if (wkStart.getTime() > exp.getTime()) cls = 'ltr-due';
          else if (wkEnd.getTime() > exp.getTime()) cls = 'ltr-near';
        }
        segs.push('<span class="ltr-seg ' + cls + '" title="' + U.escapeHtml(wkStart.toISOString().slice(0, 10)) + '"></span>');
      }
      const updated = t.leadtimeUpdatedAt ? U.parseDL(String(t.leadtimeUpdatedAt).slice(0, 10)) : null;
      const stale = !updated || (Math.round((todayR.getTime() - updated.getTime()) / 86400000) > 7);
      const revTxt = updated ? 'reviewed ' + updated.toISOString().slice(0, 10) : 'never reviewed';
      return '<div class="ltr-row">' +
        '<span class="ltr-name">' + U.escapeHtml(t.name) + '</span>' +
        '<span class="ltr-segs">' + segs.join('') + '</span>' +
        (stale
          ? '<span class="badge br" style="font-size:.58rem;white-space:nowrap" title="Rolling forecast not reviewed in over a week — refresh vendor dates">stale</span>'
          : '<span class="badge bg" style="font-size:.58rem;white-space:nowrap">' + revTxt + '</span>') +
        '<button class="btn btn-s btn-n" data-action="tglLeadtimeReview" data-id="' + U.escapeHtml(t.id) + '" title="Mark this rolling forecast as reviewed this week">Review</button>' +
        '</div>';
    }).join('');
    const rollingHtml = '<div class="ltr-roll"><div class="ltr-head">Rolling 3-Month Forecast<span class="ltr-sub">12-week window · review weekly to keep vendor data current</span></div>' +
      (lt.length ? rolling : '<div class="ltr-empty">No lead-time tasks yet.</div>') + '</div>';
    el.innerHTML = tableHtml + rollingHtml;
  }

  // ---- Float Watch (monolith renderFloatWatch) ----
  // Critical (zero float) + near-critical (float ≤10d or >30% of baseline
  // consumed) + the Crash Candidates compression ranking.
  function renderFloatWatch() {
    const el = $('float-watch-body');
    if (!el) return;
    const s = S();
    const tasks = (s && s.tasks) || [];
    const nc = getNearCritical();
    const crit = tasks.filter(t => t.totalFloat === 0);
    if (!nc.length && !crit.length) {
      const anyFloat = tasks.some(t => t.totalFloat !== null && t.totalFloat !== undefined);
      el.innerHTML = anyFloat
        ? '<div class="fw-ok"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> All tasks have healthy float.</div>'
        : '<div class="fw-empty">Add task dates + predecessors and run <strong>Cascade Dates</strong> (Gantt toolbar) and float will compute automatically.</div>';
      return;
    }
    const critHtml = crit.length ? `<div class="fw-section"><div class="fw-h crit"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-dot"></use></svg> Critical (zero float)</div>${crit.map(t => `<div class="fw-row crit"><span>${U.escapeHtml(t.name)}</span></div>`).join('')}</div>` : '';
    const ncHtml = nc.length ? `<div class="fw-section"><div class="fw-h nc"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Near-Critical (float ≤10d or >30% consumed)</div>${nc.map(t => {
      const consumed = t.floatBaseline ? Math.round((t.floatBaseline - t.totalFloat) / t.floatBaseline * 100) : 0;
      return `<div class="fw-row nc"><span>${U.escapeHtml(t.name)}</span><span class="fw-meta">Float ${t.totalFloat}d${t.floatBaseline ? ' / baseline ' + t.floatBaseline + 'd (' + consumed + '% consumed)' : ''}</span></div>`;
    }).join('')}</div>` : '';
    const cc = crashCandidates();
    const ccHtml = cc.length ? `<div class="fw-section"><div class="fw-h cc"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-tool"></use></svg> Crash Candidates — best compression targets on the critical path</div>${cc.map(c => `<div class="fw-row cc"><span>${U.escapeHtml(c.task.name)}</span><span class="fw-meta">${c.duration}d task — up to ~${c.recoverable}d recoverable</span></div>`).join('')}<div class="fw-note">Estimates only — confirm with the crew before committing. Regulatory/curing/waiting-time tasks are excluded since more labor can't compress them.</div></div>` : '';
    el.innerHTML = critHtml + ncHtml + ccHtml;
  }

  // ---- Weather Variance (monolith renderWeatherVariance) ----
  // Compares weather-exposed work inside the hurricane/wet-season window
  // against the Charter buffer. Inputs live in the card itself.
  function renderWeatherVariance() {
    const el = $('weather-variance-body');
    if (!el) return;
    bindWxInputs();
    const s = S();
    const w = (s && s.wxWindow) || { start: '', end: '', bufferDays: 0 };
    const st = $('wx-start'); if (st && st !== document.activeElement) st.value = w.start || '';
    const en = $('wx-end'); if (en && en !== document.activeElement) en.value = w.end || '';
    const bf = $('wx-buffer'); if (bf && bf !== document.activeElement) bf.value = w.bufferDays || 0;
    const winSt = U.parseDL(w.start), winEn = U.parseDL(w.end);
    const spanDays = (winSt && winEn) ? Math.round((winEn - winSt) / 86400000) : 0;
    const spanWarn = spanDays > 210 ? `<div class="wx-warn"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Season window is ${spanDays} days — a real hurricane season runs about 180 days. This one likely has Season End set to a project date rather than a season boundary (e.g. Nov 30), which will overstate exposure. Fix the date above.</div>` : '';
    const tasks = (s && s.tasks) || [];
    const wxTasks = tasks.filter(t => t.weatherExposed && t.startDate && t.endDate);
    if (!wxTasks.length) {
      el.innerHTML = spanWarn + '<div class="wx-empty"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg> No tasks tagged weather-exposed. Use the cloud button on any WBS row to mark a task weather-sensitive and include it here.</div>';
      return;
    }
    let totalDays = 0, inWindowDays = 0;
    wxTasks.forEach(t => {
      const ts = U.parseDL(t.startDate), te = U.parseDL(t.endDate);
      if (!ts || !te) return;
      const dur = Math.max(1, Math.round((te - ts) / 86400000) + 1);
      totalDays += dur;
      if (winSt && winEn) {
        const ovStart = new Date(Math.max(ts, winSt));
        const ovEnd = new Date(Math.min(te, winEn));
        if (ovStart <= ovEnd) inWindowDays += Math.round((ovEnd - ovStart) / 86400000) + 1;
      }
    });
    const buffer = w.bufferDays || 0;
    const variance = inWindowDays - buffer;
    const varCls = variance <= 0 ? 'var-pos' : 'var-neg';
    const inWinLbl = (winSt && winEn) ? inWindowDays + 'd' : 'set window';
    const varLbl = (winSt && winEn) ? (variance > 0 ? '+' : '') + variance + 'd' : '—';
    // ACTION-PLAN 7.3: distributed weather float — an editable extra-buffer
    // input per weather-exposed task. Entries are consumed by the schedule
    // engine on the next Cascade Dates (mmgr-schedule.js applyWeatherPadding).
    const distHtml = wxTasks.length ? '<div class="wx-dist"><div class="rst"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg> Distributed Float<span class="ct-sub">Extra buffer days tied to this task — applied on Cascade Dates</span></div>' +
      wxTasks.map(t => '<div class="wx-dist-row"><span class="wx-dist-name">' + U.escapeHtml(t.name) + '</span><input type="number" min="0" max="60" step="1" value="' + (+(t.wxFloatPad || 0)) + '" data-wxpad="' + U.escapeHtml(t.id) + '" title="Extra weather float days for this task (ACTION-PLAN 7.3)"><span class="wx-dist-unit">d</span></div>').join('') + '</div>' : '';
    el.innerHTML = `${spanWarn}<div class="wx-stats">
      <div class="wx-stat"><div class="k">Exposed Tasks</div><div class="v">${wxTasks.length}</div></div>
      <div class="wx-stat"><div class="k">Total Duration</div><div class="v">${totalDays}d</div></div>
      <div class="wx-stat"><div class="k">In Hurricane Window</div><div class="v" style="color:var(--amber)">${inWinLbl}</div></div>
      <div class="wx-stat"><div class="k">vs Charter Buffer</div><div class="v ${varCls}">${varLbl}</div></div>
    </div>` +
    ((winSt && winEn && variance > 0) ? `<div class="wx-warn"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Weather-exposed work in the hurricane window exceeds the Charter buffer by ${variance} day${variance !== 1 ? 's' : ''}. Reconsider sequencing or increase the buffer.</div>` : '') +
    distHtml;
    // Bind the distributed-float inputs directly (change only, never input,
    // so typing is never interrupted by a re-render). Client-side state.
    Array.prototype.forEach.call(el.querySelectorAll('input[data-wxpad]'), function(inp) {
      inp.addEventListener('change', function() {
        ns.State.updateState(function(st) {
          const task = (st.tasks || []).find(x => x.id === inp.getAttribute('data-wxpad'));
          if (task) task.wxFloatPad = Math.max(0, Math.min(60, (+inp.value || 0)));
        });
        renderWeatherVariance();
      });
    });
  }

  // ---- Weather window inputs ----
  // Reads the three inputs, persists via the state module (fires change
  // listeners + debounced save, matching app convention) and re-renders.
  // Bound directly, NOT via data-action: the click delegation preventDefaults
  // every data-action element, which would block the native date picker.
  function updWxWindow() {
    ns.State.updateState(function(s) {
      if (!s.wxWindow) s.wxWindow = { start: '', end: '', bufferDays: 0 };
      const stEl = $('wx-start'), enEl = $('wx-end');
      s.wxWindow.start = (stEl && stEl.value) || '';
      s.wxWindow.end = (enEl && enEl.value) || '';
      if (s.wxWindow.start && s.wxWindow.end) {
        const spanDays = Math.round((new Date(s.wxWindow.end) - new Date(s.wxWindow.start)) / 86400000);
        if (spanDays > 210 && ns.App && ns.App.showToast) {
          ns.App.showToast("That's a " + spanDays + "-day season window — a real hurricane season runs about 180 days (e.g. Jun 1–Nov 30). Double-check Season End isn't your project finish date by mistake.", 'err');
        }
      }
    });
    renderWeatherVariance();
  }

  function updWxBuffer() {
    ns.State.updateState(function(s) {
      if (!s.wxWindow) s.wxWindow = { start: '', end: '', bufferDays: 0 };
      const bfEl = $('wx-buffer');
      s.wxWindow.bufferDays = bfEl ? (+bfEl.value || 0) : 0;
    });
    renderWeatherVariance();
  }

  // ---- ACTION-PLAN 7.5: LD rate input ----
  // Per-day liquidated-damages rate from the weather-log card header. Persists
  // to state (client-side only) and re-renders the LD/SRI strip.
  function updLdRate() {
    ns.State.updateState(function(s) {
      const el = $('wx-ld-rate');
      s.ldRate = el ? (+el.value || 0) : (s.ldRate || 0);
    });
    renderWeatherLog();
  }

  // ---- Schedule Confidence (monolith renderScheduleConfidence) ----
  // One glance instead of four cards: simulation probability of hitting the
  // Charter target + weather-buffer check + biggest crash candidate. Uses
  // the same simulateSchedule() core as the Monte Carlo panel (300 iters on
  // dashboard renders vs 1000 on demand).
  function renderScheduleConfidence() {
    const el = $('schedule-confidence-card');
    if (!el) return;
    const s = S();
    const f = (s && s.charter) || {};
    if (!f.targetCompletion && !f.end) {
      el.innerHTML = '<div class="es" style="padding:14px;font-size:.76rem">Set a Target Completion Date in the Charter to activate Schedule Confidence.</div>';
      return;
    }
    const highRiskCount = (s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'high') && (r.impact === 'High' || r.impact === 'high')).length;
    const sim = (ns.Schedule && ns.Schedule.simulateSchedule) ? ns.Schedule.simulateSchedule(300, 1.2, highRiskCount * 2) : null;
    let probHtml = '<div class="sc-cell"><div class="lbl" style="color:var(--slate)">Not enough scheduled tasks yet to simulate.</div></div>';
    if (sim) {
      const td = new Date(f.targetCompletion || f.end);
      const pct = Math.round(sim.results.filter(d => d <= td).length / sim.results.length * 100);
      const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--danger)';
      probHtml = `<div class="sc-cell"><div class="big" style="color:${color}">${pct}%</div><div class="lbl">chance of hitting ${td.toLocaleDateString()}</div></div>`;
    }
    const w = (s && s.wxWindow) || {};
    const wxTasks = (s.tasks || []).filter(t => t.weatherExposed && t.startDate && t.endDate);
    let wxHtml = '<div class="sc-cell"><div class="lbl" style="color:var(--slate)">No weather window set.</div></div>';
    if (w.start && w.end && wxTasks.length) {
      const winSt = U.parseDL(w.start), winEn = U.parseDL(w.end);
      let inWindow = 0;
      wxTasks.forEach(t => {
        const ts = U.parseDL(t.startDate), te = U.parseDL(t.endDate);
        if (!ts || !te) return;
        const ovStart = new Date(Math.max(ts, winSt)), ovEnd = new Date(Math.min(te, winEn));
        if (ovStart <= ovEnd) inWindow += Math.round((ovEnd - ovStart) / 86400000) + 1;
      });
      const over = inWindow - (w.bufferDays || 0);
      wxHtml = `<div class="sc-cell"><div class="big" style="color:${over > 0 ? 'var(--danger)' : 'var(--green)'}">${over > 0 ? '+' + over + 'd' : 'OK'}</div><div class="lbl">${over > 0 ? 'over weather buffer' : 'within weather buffer'}</div></div>`;
    } else if (w.start && w.end) {
      wxHtml = '<div class="sc-cell"><div class="big" style="color:var(--slate)">—</div><div class="lbl">no tasks tagged weather-exposed yet</div></div>';
    }
    const cc = crashCandidates();
    const riskHtml = cc.length
      ? `<div class="sc-cell"><div class="big sc-crash">${U.escapeHtml(cc[0].task.name)}</div><div class="lbl">biggest crash candidate — up to ~${cc[0].recoverable}d recoverable</div></div>`
      : '<div class="sc-cell"><div class="lbl" style="color:var(--slate)">No crash candidates identified yet.</div></div>';
    el.innerHTML = `<div class="sc-grid">${probHtml}${wxHtml}${riskHtml}</div>`;
  }

  // ==================================================================
  // ACTION-PLAN Phase 7 — Open-Meteo forecast, delay log, LD/SRI
  // ------------------------------------------------------------------
  // 7.1 forecast strip (cached 3h, risk-day thresholds), 7.4 weather
  // delay log, 7.5 LD exposure, SRI. All degrade gracefully when no
  // geocode/forecast exists — the static regional windows stay the
  // fallback.
  // ==================================================================

  // ---- Heat/Cold SAFETY banner (Rank 10 item 21, promoted 2026-08-13) ----
  // Full-width page-top banner when a heat or cold risk day is in the cached
  // forecast. Deliberately distinct from the amber schedule-risk flags so a
  // safety concern never reads as a schedule concern. Uses the SAME source as
  // the in-panel wfr-alert (Fc.heatColdAlert) so the two can never disagree.
  // Degrades gracefully: no location / no forecast / no heat-cold risk ->
  // hidden (.is-hide), exactly like the readonly/editor-scope banners.
  function renderSafetyBanner() {
    const el = $('safety-banner');
    if (!el) return;
    const s = S();
    const Fc = ns.Forecast;
    if (!Fc) { el.classList.add('is-hide'); return; }
    const hc = Fc.heatColdAlert(s);
    const txt = $('safety-banner-text');
    if (!hc) {
      el.classList.remove('safety-heat', 'safety-cold');
      el.classList.add('is-hide');
      if (txt) txt.textContent = '';
      return;
    }
    el.classList.remove('safety-heat', 'safety-cold');
    el.classList.add('safety-' + hc.kind);
    if (txt) txt.textContent = hc.text;
    el.classList.remove('is-hide');
  }

  function renderWeatherForecast() {
    const el = $('weather-forecast-body');
    if (!el) return;
    const s = S();
    const Fc = ns.Forecast;
    if (!Fc) { el.innerHTML = ''; return; }
    const place = s.sitePlace || '';
    const hasLoc = !!(s.siteLat !== null && s.siteLon !== null);
    const days = Fc.getForecast(s);
    if (!hasLoc) {
      el.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">No site location set. Enter the site city above and click <strong>Locate</strong> (geocoded once via Open-Meteo, stored in this browser) — or keep using the regional weather windows below.</div>';
      return;
    }
    const placeIn = $('wx-place-in');
    if (placeIn && place && placeIn !== document.activeElement) placeIn.value = place;
    if (!days) {
      el.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">Forecast not fetched yet (or the 3h cache expired). Click <strong>Refresh</strong> to pull the 16-day Open-Meteo forecast for ' + U.escapeHtml(place) + '.</div>';
      return;
    }
    const risky = Fc.riskDays(s);
    const heatCold = Fc.heatColdAlert(s);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    // ACTION-PLAN 7.1: weekly (7d) vs monthly-rollup (16d, the Open-Meteo
    // max horizon) strip — toggled by the 7d/16d buttons in the card title.
    const horizon = (s.wxViewDays === 16) ? 16 : 7;
    const tglBtns = document.querySelectorAll('.wx-view-tgl .btn[data-action=wxSetView]');
    Array.prototype.forEach.call(tglBtns, function(b) { b.classList.toggle('is-on', (+b.getAttribute('data-days')) === horizon); });
    const next7 = days.filter(d => (U.parseDL(d.date) || new Date(d.date + 'T00:00:00')) >= now).slice(0, horizon);
    const strip = next7.map(d => {
      const isRisk = risky.some(r => r.date === d.date);
      const r = isRisk ? risky.find(x => x.date === d.date) : null;
      const cls = isRisk ? (r.alerts.some(a => a.indexOf('heat') === 0 || a.indexOf('cold') === 0) ? 'wfr-heat' : 'wfr-risk') : '';
      const lbl = isRisk ? (r.alerts[0] || 'risk') : (d.precip > 30 ? d.precip + '%' : (d.tMax || '—') + 'C');
      const dow = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      // NOTE: `r` (a risk-day object with .alerts) may be absent — raw forecast
      // days only carry precip/tMax/tMin, so the title must fall back to those.
      const tip = isRisk && r ? d.date + ': ' + r.alerts.join(', ') : (d.date + ' — ' + (d.precip > 30 ? d.precip + '%' : (d.tMax || '—') + 'C'));
      return '<div class="wfr-day ' + cls + '" title="' + U.escapeHtml(tip) + '"><div class="wfr-dow">' + dow + '</div><div class="wfr-lbl">' + U.escapeHtml(lbl) + '</div></div>';
    }).join('');
    const riskList = risky.length
      ? risky.slice(0, 4).map(r => '<div class="wfr-risk-row"><span class="badge br" style="font-size:.6rem">RISK</span> ' + U.escapeHtml(r.date + ' — ' + r.alerts.join(', ')) + (r.affected.length ? ' <span class="txt-sl">(affects ' + U.escapeHtml(r.affected.join(', ')) + ')</span>' : '') + '</div>').join('')
      : '<div class="wfr-ok"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> No threshold-clearing weather risk in the next 16 days.</div>';
    el.innerHTML = (heatCold ? '<div class="wfr-alert wfr-' + heatCold.kind + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> ' + U.escapeHtml(heatCold.text) + '</div>' : '') +
      '<div class="wfr-strip">' + strip + '</div>' +
      '<div style="margin-top:8px">' + riskList + '</div>' +
      '<div class="wfr-meta">Site: ' + U.escapeHtml(place) + ' · Forecast cached ' + new Date((s.wxCache && s.wxCache.at) || Date.now()).toLocaleTimeString() + '</div>';
  }

  function renderWeatherLog() {
    const el = $('weather-log-body');
    if (!el) return;
    const s = S();
    const Fc = ns.Forecast;
    if (!Fc) { el.innerHTML = ''; return; }
    // LD + SRI strip
    const ldIn = $('wx-ld-rate');
    if (ldIn && ldIn !== document.activeElement) ldIn.value = s.ldRate || 0;
    const strip = $('ld-sri-strip');
    if (strip) {
      const ld = Fc.ldExposure(s);
      const sriV = Fc.sri(s);
      strip.innerHTML =
        '<div class="wx-stat"><div class="k">Logged Weather Days</div><div class="v">' + ld.days + '</div></div>' +
        '<div class="wx-stat"><div class="k">LD Rate (per day)</div><div class="v">$' + Number(ld.rate).toLocaleString() + '</div></div>' +
        '<div class="wx-stat"><div class="k">LD Exposure</div><div class="v ' + (ld.exposure ? 'var-neg' : 'var-pos') + '">$' + Number(ld.exposure).toLocaleString() + '</div></div>' +
        '<div class="wx-stat"><div class="k">Schedule Reliability</div><div class="v">' + (sriV ? sriV.index + '%' : '—') + '</div></div>';
    }
    const log = s.weatherLog || [];
    if (!log.length) {
      el.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">No weather delays logged. Click <strong>+ Log Today</strong> to record today\'s conditions with affected tasks — the export is dispute-ready for LD claims.</div>';
      return;
    }
    el.innerHTML = '<div class="ox"><table class="dt"><thead><tr><th>Date</th><th>Conditions</th><th>Note</th><th>Affected Tasks</th><th class="w60"></th></tr></thead><tbody>' +
      log.map((e, i) => '<tr><td>' + U.escapeHtml(e.date) + '</td><td>' + U.escapeHtml(e.condition || '') + '</td><td>' + U.escapeHtml(e.note || '') + '</td><td>' + U.escapeHtml((e.affectedTaskIds || []).join(', ') || '—') + '</td><td><button class="btn btn-s btn-d" data-action="delWeatherLogEntry" data-idx="' + i + '">×</button></td></tr>').join('') +
      '</tbody></table></div>';
  }

  // ==================================================================
  // ACTION-PLAN Phase 3 — retention, professional and non-blocking
  // ------------------------------------------------------------------
  // 3.1 Action-item aging (escalating visibility), 3.4 weekly baseline
  // narrative. 3.3 streak lives in state; both surfaces below are
  // read-only analytics over live state — additive only, never gate core
  // paths.
  // ==================================================================

  // ---- 3.1 Action-item aging ----
  // Collects every OPEN action item from the live data: meeting promises
  // carried forward, comms-log action items (with their follow-up date
  // when set), and decision-log action items. Each is aged from its due
  // date (or creation date when no due date exists) and gets escalating
  // visibility: amber at ≤7d overdue, red 8–21d, bold red beyond 21d.
  function computeAgingActions(state) {
    const s = state || S();
    if (!s) return [];
    const items = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayMs = 86400000;
    const daysFrom = (d) => d ? Math.round((today - d) / dayMs) : null;
    // Meeting promises (source of truth for the closed loop)
    const promises = s.meetingPromises || {};
    Object.keys(promises).forEach(kind => {
      (promises[kind] || []).forEach(p => {
        if (p.done) return;
        const created = p.createdAt ? U.parseDL(p.createdAt.slice(0, 10)) : null;
        items.push({ text: p.text, src: 'Meeting promise', kind: kind, age: daysFrom(created), due: created });
      });
    });
    // Comms-log action items (follow-up date is the due date when present)
    ((s.commsEntries) || []).forEach(c => {
      const txt = (c.actionItems || '').trim();
      if (!txt) return;
      const due = U.parseDL(c.followUp);
      const base = due || U.parseDL(c.date);
      items.push({ text: txt, src: 'Comms ' + (c.type || ''), kind: 'comms', age: daysFrom(base), due: due });
    });
    // Decision-log action items
    ((s.logEntries) || []).forEach(l => {
      const txt = (l.actionItems || '').trim();
      if (!txt) return;
      const base = U.parseDL(String(l.date || '').slice(0, 10)) || null;
      items.push({ text: txt, src: 'Decision log', kind: 'log', age: daysFrom(base), due: null });
    });
    // Escalation: overdue items surface first, oldest on top.
    items.sort((a, b) => {
      const ad = a.age === null ? -1 : a.age;
      const bd = b.age === null ? -1 : b.age;
      return bd - ad;
    });
    return items;
  }

  function agingTier(age) {
    if (age === null) return { cls: 'ba', label: 'no due date' };
    if (age <= 0) return { cls: 'bg', label: age === 0 ? 'due today' : 'due in ' + Math.abs(age) + 'd' };
    if (age <= 7) return { cls: 'ba', label: age + 'd overdue' };
    if (age <= 21) return { cls: 'br', label: age + 'd overdue' };
    return { cls: 'br', label: age + 'd — STALE', stale: true };
  }

  function renderActionAging() {
    const el = $('action-aging-body');
    if (!el) return;
    const items = computeAgingActions();
    if (!items.length) {
      el.innerHTML = '<div class="es es-ok"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> No open action items. Everything carried is either resolved or ticked off.</div>';
      return;
    }
    const rows = items.slice(0, 8).map(it => {
      const tier = agingTier(it.age);
      return `<div class="aa-row${tier.stale ? ' aa-stale' : ''}">
        <div class="aa-txt">${U.escapeHtml(it.text)}<span class="aa-src">${U.escapeHtml(it.src)}${it.kind && it.kind !== 'comms' && it.kind !== 'log' ? ' · ' + U.escapeHtml(it.kind) : ''}</span></div>
        <span class="badge ${tier.cls}" style="font-size:.62rem;white-space:nowrap">${tier.label}</span>
      </div>`;
    }).join('');
    const overdue = items.filter(i => (i.age || 0) > 0).length;
    el.innerHTML = (overdue > 0 ? '<div class="aa-overdue-note">' + overdue + ' of ' + items.length + ' open action items are past due.</div>' : '') + rows;
  }

  // ---- 3.3 PM consistency streak (quiet, non-guilt) ----
  // Renders the consecutive-day counter already tracked by the state module
  // (ACTION-PLAN 3.3). Informational only: neutral copy, no toasts, never
  // gates any core path. Client-side state — no server round-trip.
  function renderStreak() {
    const el = $('streak-body');
    if (!el) return;
    const s = S();
    const st = (s && s.streak) || { count: 0, lastDate: null };
    const count = st.count || 0;
    const last = st.lastDate ? String(st.lastDate) : null;
    el.innerHTML = '<div class="stk-row"><div class="stk-num">' + count + (count === 1 ? ' day' : ' days') + '</div>' +
      '<div class="stk-meta">consecutive working days on this project' + (last ? ' · last activity ' + U.escapeHtml(last) : '') + '</div></div>' +
      (count === 0 ? '<div class="stk-hint">The streak builds quietly as you update the plan — no pressure, no fuss.</div>' : '');
  }

  // ---- 3.4 Weekly baseline narrative ----
  // Plain-English diff of the CURRENT plan vs the last saved baseline:
  // what moved, what was added/removed, and what it means. Pure function
  // of state so the dashboard card and Copy All share the same wording.
  function computeBaselineNarrative(state) {
    const s = state || S();
    if (!s || !s.baseline || !s.baseline.tasks) return null;
    const base = s.baseline.tasks || [];
    const cur = s.tasks || [];
    const curMap = {}; cur.forEach(t => { curMap[t.id] = t; });
    const baseMap = {}; base.forEach(t => { baseMap[t.id] = t; });
    const sentences = [];
    // Schedule shifts
    const slipped = []; const gained = [];
    base.forEach(bt => {
      const ct = curMap[bt.id];
      if (!ct || !bt.endDate || !ct.endDate) return;
      const d = U.daysBetween(bt.endDate, ct.endDate);
      if (d > 0) slipped.push({ name: bt.name, days: d });
      else if (d < 0) gained.push({ name: bt.name, days: Math.abs(d) });
    });
    if (slipped.length) {
      slipped.sort((a, b) => b.days - a.days);
      const total = slipped.reduce((n, t) => n + t.days, 0);
      sentences.push(slipped.length + ' task' + (slipped.length > 1 ? 's' : '') + ' slipped by an average of ' + Math.round(total / slipped.length) + 'd since baseline' + (slipped[0] ? ' — worst: ' + slipped[0].name + ' (+' + slipped[0].days + 'd)' : '') + '.');
    }
    if (gained.length) {
      const total = gained.reduce((n, t) => n + t.days, 0);
      sentences.push(gained.length + ' task' + (gained.length > 1 ? 's' : '') + ' pulled in by an average of ' + Math.round(total / gained.length) + 'd.');
    }
    // Scope drift
    const added = cur.filter(t => !baseMap[t.id]);
    const removed = base.filter(t => !curMap[t.id]);
    if (added.length) sentences.push(added.length + ' task' + (added.length > 1 ? 's' : '') + ' added since baseline (' + added.slice(0, 3).map(t => t.name).join(', ') + (added.length > 3 ? '…' : '') + ').');
    if (removed.length) sentences.push(removed.length + ' task' + (removed.length > 1 ? 's' : '') + ' removed since baseline.');
    // Completion movement
    const baseDone = base.filter(t => t.status === 'completed').length;
    const curDone = cur.filter(t => t.status === 'completed').length;
    if (curDone !== baseDone) sentences.push('Completed tasks moved from ' + baseDone + ' to ' + curDone + ' since baseline.');
    // Cost movement (planned $ only — actuals are live, not baseline)
    const basePlanned = (s.baseline.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
    const curPlanned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
    if (basePlanned !== curPlanned) {
      const delta = curPlanned - basePlanned;
      sentences.push('Planned budget ' + (delta > 0 ? 'increased' : 'decreased') + ' by $' + Math.abs(delta).toLocaleString() + ' since baseline' + (delta > 0 ? '.' : '.'));
    }
    return sentences.length ? sentences : ['No material changes since the baseline was captured.'];
  }

  function renderBaselineNarrative() {
    const el = $('baseline-narrative-body');
    if (!el) return;
    const narr = computeBaselineNarrative();
    if (!narr) {
      el.innerHTML = '<div class="es" style="padding:12px;font-size:.76rem">Save a baseline (Settings &gt; Controls &gt; Save Baseline) to see a plain-English week-over-week diff here, and copy it into reports via Copy All.</div>';
      return;
    }
    el.innerHTML = narr.map(n => '<div class="bn-item"><svg class="ico" aria-hidden="true" style="font-size:.7rem"><use href="css/mmgr-icons.svg#i-dot"></use></svg> ' + U.escapeHtml(n) + '</div>').join('');
  }

  // ---- Dirty Indicator ----
  // OWNER 2026-08-15: THREE states, driven by the cloud link + the FILE-
  // backup watermark (state.lastBackedUpAt, stamped by saveProjectFile).
  //   1. Cloud-linked (Cloud.getCode()) -> GREEN "Cloud backed up" chip —
  //      the durable backup lives in the cloud and auto-syncs as the user
  //      works, so the alarming amber state is replaced entirely. Casual
  //      users who just add a task no longer get the "huh?" trigger.
  //   2. Not linked + never file-backed-up -> amber "Not backed up" — with
  //      softened copy: autosave already keeps changes safe in this browser;
  //      a file backup is optional, save one whenever you're ready.
  //   3. Not linked + file-backed-up -> indicator hidden (clean).
  function renderDirtyIndicator() {
    const ind = $('dirty-ind');
    if (!ind) return;
    const s = S();
    if (!s || !ns.State) return;
    const C = window.MMGR.Cloud;
    const linked = !!(C && C.getCode && C.getCode());
    let backedUp = false;
    if (linked) {
      ind.classList.add('on', 'ci-cloud');
      ind.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cloud"></use></svg> Cloud backed up';
      ind.setAttribute('title', 'This project is backed up to the cloud — snapshots auto-sync as you work. Click for backup options (cloud or a portable .json file).');
    } else {
      ind.classList.remove('ci-cloud');
      backedUp = !!(s.lastBackedUpAt && s.updatedAt && s.lastBackedUpAt >= s.updatedAt);
      if (!backedUp) {
        ind.classList.add('on');
        ind.innerHTML = '● Not backed up';
        ind.setAttribute('title', 'Your changes are safe in this browser (autosave). A file backup is optional — save one whenever you\u2019re ready, e.g. at the end of a task. Click for backup options.');
      } else {
        ind.classList.remove('on');
        ind.innerHTML = '● Not backed up';
        ind.setAttribute('title', 'Changes save to this browser automatically. Click for backup options (cloud or a .json file).');
      }
    }
    // Backup popover footer (OWNER 2026-08-15).
    const foot = $('bk-foot');
    if (foot) {
      foot.textContent = linked
        ? 'Cloud backup active — a .json file copy is optional (e.g. to keep in your file manager).'
        : (backedUp && s.lastBackedUpAt
          ? 'Last file backup: ' + new Date(s.lastBackedUpAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '.'
          : 'No file backup yet — autosave keeps your changes on this device.');
    }
  }

  // ---- Sections ----
  // Single lookup used by both showSection and renderAll so the active
  // panel can be re-rendered after any state change.
  const SECTION_RENDERERS = {
    dash: renderDash, def: renderDefs, wbs: renderWbs, gantt: renderGantt, kan: renderKanban,
    risk: renderRisks, res: renderResources, bud: renderBudget,
    stk: renderStakeholders, chg: renderChanges, log: renderLog,
    close: renderClosure, raci: renderRaci, comms: renderComms,
    docs: renderDocuments, dmaic: renderDmaic, meet: renderMeetingsPanel,
    charter: renderCharter, claim: renderClaimPanel
  };

  // Definitions glossary (data + render live in js/mmgr-defs.js).
  function renderDefs() {
    if (ns.Defs && ns.Defs.render) ns.Defs.render();
  }

  // Meetings panel (MEETING_TRACKING_SPEC) — delegates to the Meetings module.
  function renderMeetingsPanel() {
    if (ns.Meetings && ns.Meetings.renderMeetings) ns.Meetings.renderMeetings();
  }

  // Claim Pack panel (MASTER-ACTION-PLAN-v3-STRICT Rank 1) — delegates to the
  // Claim module (slips cause tags, package preview).
  function renderClaimPanel() {
    if (ns.Claim && ns.Claim.render) ns.Claim.render();
  }

  function showSection(section, btn) {
    // PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE DIR-2: every section switch
    // starts from a consistent top position — a carried-over scroll offset
    // from a long section reads as a "jump" into unrelated content.
    window.scrollTo(0, 0);
    // Update nav buttons
    document.querySelectorAll('.sec-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    // Show panel
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = $('panel-' + section);
    if (panel) panel.classList.add('active');
    // Render section-specific content
    const renderer = SECTION_RENDERERS[section];
    if (renderer) renderer();
    // DIR-7a: give the freshly rendered table inputs their accessible names.
    labelDynamicFields();
    // Rank 3.4: viewport-aware layout detection — offer the one-time
    // simplified-view prompt for dense sections on narrow screens.
    if (ns.Viewport && ns.Viewport.maybePrompt) ns.Viewport.maybePrompt(section);
    // PLAN-OF-ACTION-LIQUID-GLASS-UI §2: the SAME detection signal also
    // drives the glass engine choice — one signal, two consumers (layout
    // simplification and glass-engine selection). Section changes re-check
    // so a resize/switch into a narrow view never leaves a heavy engine on.
    if (ns.Glass && ns.Glass.sync) ns.Glass.sync();
  }

  // ---- WBS ----
  function renderWbs() {
    const s = S();
    if (!s) return;
    const body = $('wbs-body');
    if (!body) return;
    // RESTORE-7: keep the schedule-issues banner in sync with the rows below.
    renderWbsAlerts();
    const tasks = s.tasks || [];
    const defExpanded = s.defExpanded || {};
    if (tasks.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="wbs-empty"><div>No tasks yet.</div><div style="display:flex;gap:6px;justify-content:center"><button class="btn btn-g btn-s" data-action="addTask">+ Add Task</button><button class="btn btn-n btn-s" data-action="openWbsImport">Import from text</button></div></td></tr>';
      return;
    }
    // Skip rows whose phase ancestor is collapsed.
    // Semantics: defExpanded[id] === false  →  phase is collapsed (true/undefined = expanded).
    const collapsedIds = new Set();
    Object.keys(defExpanded).forEach(id => { if (defExpanded[id] === false) collapsedIds.add(id); });
    // 2.1 dependency-aware risk propagation: any task with an overdue
    // predecessor is downstream of a slip — flagged inline, live.
    const overdueIds = new Set(tasks.filter(t => t.status !== 'completed' && U.isOverdue(t.endDate)).map(t => String(t.id)));
    const visibleTasks = [];
    const phaseStack = []; // open phase ancestors: { indent, id }
    for (const t of tasks) {
      const indent = t.indent !== undefined ? t.indent : (t.level || 0);
      while (phaseStack.length && phaseStack[phaseStack.length - 1].indent >= indent) phaseStack.pop();
      const hidden = phaseStack.some(p => collapsedIds.has(p.id));
      // A row counts as a phase container when it is a phase OR a top-level
      // task (level 0), matching the row template's `isPhase || level === 0`.
      if (t.isPhase || (t.level || 0) === 0) phaseStack.push({ indent: indent, id: t.id });
      if (!hidden) visibleTasks.push(t);
    }
    body.innerHTML = visibleTasks.map(t => {
      const level = t.level || 0;
      const isPhase = t.isPhase || level === 0;
      const indent = t.indent !== undefined ? t.indent : level;
      const cls = 'wl' + Math.min(indent, 3);
      const overdue = t.status !== 'completed' && U.isOverdue(t.endDate) ? 'overdue' : '';
      const lowConf = t.confidence === 'low' ? 'wbs-lowconf' : '';
      const chainRisk = (t.predecessors || []).some(p => overdueIds.has(String(p)));
      // Apply collapse state from defExpanded
      const collapsed = defExpanded[t.id] === false ? 'collapsed' : '';
      return `<tr class="wbs-row ${cls} ${overdue} ${lowConf} ${collapsed}" data-id="${U.escapeHtml(t.id)}" tabindex="0">
        <td>${U.escapeHtml(t.id || '')}</td>
        <td>
          <button class="cbtn ${isPhase ? '' : 'cls'}" data-action="tglPhase" data-id="${U.escapeHtml(t.id)}">▼</button>
          <span class="wbs-name">${U.escapeHtml(t.name)}</span>
          <label class="wb-milestone" title="Mark as Milestone"><input type="checkbox" ${t.milestone ? 'checked' : ''} data-action="tglMilestone" data-id="${U.escapeHtml(t.id)}"> <svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-flag"></use></svg></label>
          ${t.critical ? '<span class="badge bo" style="font-size:.6rem;padding:1px 4px;margin-left:4px">CP</span>' : ''}
          ${chainRisk ? '<span class="badge br" style="font-size:.6rem;padding:1px 4px;margin-left:4px" title="A predecessor is overdue — this downstream chain is at risk (2.1)">CHAIN</span>' : ''}
          ${t.leadTime ? '<span class="tt-lead-badge">LT</span>' : ''}
          ${t.recurring ? '<span class="tt-rec-badge"><svg class="ico" aria-hidden="true" style="font-size:.6rem"><use href="css/mmgr-icons.svg#i-refresh"></use></svg></span>' : ''}
          ${t.weatherExposed ? '<svg class="ico" aria-hidden="true" style="color:#38bdf8;font-size:.7rem" title="Weather-exposed"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg>' : ''}
        </td>
        <td><input type="text" value="${U.escapeHtml(t.assignee || '')}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="assignee" placeholder="—"></td>
        ${t.leadTime
          ? `<td><label class="wbs-lt-lbl">Submitted</label><input type="date" value="${t.submittedDate || ''}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="submittedDate"></td>
             <td><label class="wbs-lt-lbl">Expected</label><input type="date" value="${t.expectedDate || ''}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="expectedDate"></td>
             <td><span class="wbs-lt-note">Lead-time task — tracked by dates, not % done</span></td>`
          : `<td><input type="text" value="${U.escapeHtml(t.duration || '')}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="duration" placeholder="days" style="width:60px"></td>
             <td><input type="date" value="${t.startDate || ''}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="startDate"></td>
             <td><input type="date" value="${t.endDate || ''}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="endDate"></td>`}
        <td>
          <select data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="status">
            <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option>
            <option value="inprogress" ${t.status === 'inprogress' ? 'selected' : ''}>In Progress</option>
            <option value="blocked" ${t.status === 'blocked' ? 'selected' : ''}>Blocked</option>
            <option value="completed" ${t.status === 'completed' ? 'selected' : ''}>Done</option>
          </select>
        </td>
        <td style="white-space:nowrap">
          <button class="btn btn-s ${t.weatherSensitive ? 'btn-wx' : 'btn-n'}" data-action="tglWeather" data-id="${U.escapeHtml(t.id)}" title="${t.weatherSensitive ? 'Weather-sensitive — buffer added for regional windows during cascade' : 'Mark weather-sensitive — adds selective buffer for regional windows during cascade'}" style="padding:5px 8px"><svg class="ico" aria-hidden="true" style="font-size:.62rem"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg></button>
          <button class="btn btn-s ${t.leadTime ? 'btn-lt' : 'btn-n'}" data-action="tglLeadTime" data-id="${U.escapeHtml(t.id)}" title="${t.leadTime ? 'Lead-Time — tracked by Submitted/Expected dates (click to unmark)' : 'Mark as Lead-Time — vendor/third-party wait tracked by Submitted/Expected dates (procurement, permits, deliveries)'}" style="padding:5px 8px"><svg class="ico" aria-hidden="true" style="font-size:.62rem"><use href="css/mmgr-icons.svg#i-clock"></use></svg></button>
          <button class="btn btn-s btn-n" data-action="indentTask" data-id="${U.escapeHtml(t.id)}" title="Indent">→</button>
          <button class="btn btn-s btn-n" data-action="outdentTask" data-id="${U.escapeHtml(t.id)}" title="Outdent">←</button>
          <button class="btn btn-s btn-d" data-action="delTask" data-id="${U.escapeHtml(t.id)}" title="Delete">×</button>
        </td>
      </tr>`;
    }).join('');
  }

  // ---- Gantt ----
  // INVARIANT: renderGantt is the ONLY function that mutates the visible
  // content of #gantt-chart. The arrow overlay is redrawn from live state
  // (see redrawGanttArrows), so there is no cached snapshot that can drift
  // from what is actually on screen.
  let _ganttMeta = null; // { minDate, maxDate, dayWidth } set by renderGantt

  function renderGantt() {
    const s = S();
    if (!s || !s.tasks) return;
    const gc = $('gantt-chart');
    const gl = $('gantt-labels');
    if (!gc) return;

    const tasks = s.tasks.filter(t => t.startDate && t.endDate);
    if (tasks.length === 0) {
      gc.innerHTML = '<div class="es"><div class="ic"><svg class="ico" style="font-size:2rem" aria-hidden="true"><use href="css/mmgr-icons.svg#i-bar-chart"></use></svg></div><div>Add tasks with dates to see the Gantt chart.</div><button class="btn btn-g btn-s" data-action="showSec" data-section="wbs">+ Add Task</button></div>';
      if (gl) gl.innerHTML = '';
      _ganttMeta = null;
      return;
    }

    // Find date range (no hard limit)
    let minDate = null, maxDate = null;
    for (const t of tasks) {
      if (!minDate || t.startDate < minDate) minDate = t.startDate;
      if (!maxDate || t.endDate > maxDate) maxDate = t.endDate;
    }
    if (!minDate || !maxDate) { gc.innerHTML = '<div class="es">No valid date range.</div>'; return; }

    const totalDays = U.daysBetween(minDate, maxDate) + 1;
    const dayWidth = 28;

    // Stash chart geometry for pointer drags (see ganttDrag section)
    _ganttMeta = { minDate: minDate, maxDate: maxDate, dayWidth: dayWidth };

    // Baseline overlay: grey bars under the current plan (same row alignment)
    const baseMap = {};
    if (s.baseline && s.baseline.tasks) {
      (s.baseline.tasks || []).forEach(bt => { baseMap[bt.id] = bt; });
    }

    // Critical Path Highlighter (monolith S.cp): when on, the non-critical
    // chain is dimmed via body.hl-critical — gold stays on the critical bars.
    const hlOn = !!s.hlCritical;
    if (document.body) document.body.classList.toggle('hl-critical', hlOn);
    const hlChip = document.querySelector('[data-action="toggleCritical"]');
    if (hlChip) hlChip.classList.toggle('is-on', hlOn);

    // Render header (show week numbers + day numbers)
    let headerHtml = '<div class="gh">';
    for (let i = 0; i < totalDays; i++) {
      const d = U.addDays(minDate, i);
      const isMonday = d.getDay() === 1;
      const isFirst = i === 0;
      headerHtml += `<div class="gd${isMonday || isFirst ? ' gd-hl' : ''}">${d.getDate()}</div>`;
    }
    headerHtml += '</div>';
    gc.innerHTML = headerHtml;

    // Build task bars (baseline grey bar under the live bar per row)
    let barsHtml = '';
    let labelsHtml = '';

    for (const t of tasks) {
      const start = U.parseDL(t.startDate);
      const end = U.parseDL(t.endDate);
      if (!start || !end) continue;

      const left = Math.max(0, U.daysBetween(minDate, t.startDate)) * dayWidth;
      const width = Math.max(U.daysBetween(t.startDate, t.endDate), 1) * dayWidth;

      // Baseline grey overlay bar (same row, from baseline dates)
      let baseBar = '';
      const bt = baseMap[t.id];
      if (bt && bt.startDate && bt.endDate) {
        const bLeft = Math.max(0, U.daysBetween(minDate, bt.startDate)) * dayWidth;
        const bWidth = Math.max(U.daysBetween(bt.startDate, bt.endDate), 1) * dayWidth;
        baseBar = `<div class="gb gb-base" data-id="${U.escapeHtml(t.id)}" style="left:${bLeft}px;width:${bWidth}px" title="Baseline: ${U.escapeHtml(bt.startDate)} to ${U.escapeHtml(bt.endDate)}"></div>`;
      }

      // Classes
      const classes = [];
      if (t.critical) classes.push('crit');
      if (t.status !== 'completed' && U.isOverdue(t.endDate)) classes.push('od');
      if (U.isDueSoon(t.endDate, 3) && t.status !== 'completed') classes.push('pls');
      if (t.status === 'completed') classes.push('dn');
      if (t.leadTime) classes.push('leadtime');
      if (t.recurring) classes.push('recurring');
      if (t.confidence === 'low') classes.push('lowconf');
      if (t.weatherExposed) classes.push('wex');

      // Float indicator
      const floatStr = t.totalFloat !== null && t.totalFloat !== undefined
        ? `<span class="float-badge ${t.totalFloat <= 0 ? 'float-critical' : t.totalFloat <= 5 ? 'float-consumed' : ''}">TF:${t.totalFloat}d</span>`
        : '';

      // Weather icon
      const weatherIcon = t.weatherExposed ? '<svg class="ico" aria-hidden="true" style="font-size:.6rem"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg>' : '';

      barsHtml += `<div class="gr">
        ${baseBar}
        <div class="gb ${classes.join(' ')}" data-id="${U.escapeHtml(t.id)}" style="left:${left}px;width:${width}px" title="${U.escapeHtml(t.name)}${t.weatherExposed ? ' [Weather-exposed]' : ''}${t.critical ? ' [Critical Path]' : ''}${t.totalFloat !== null ? ' [Float: ' + t.totalFloat + 'd]' : ''}">
          ${weatherIcon}${U.escapeHtml(t.name)}
        </div>
      </div>`;

      // Labels
      labelsHtml += `<div class="gr ${(hlOn && !t.critical) ? 'hl-dim' : ''}" style="padding:0 10px;display:flex;align-items:center;gap:4px;font-size:.72rem">
        <span class="${t.critical ? 'cp-lbl' : ''}" style="${t.critical ? 'color:var(--gold);font-weight:700' : ''}">${U.escapeHtml(t.name)}</span>
        ${floatStr}
        ${t.critical ? '<span class="badge bo" style="font-size:.55rem;padding:1px 5px">CP</span>' : ''}
        ${t.weatherExposed ? '<svg class="ico" aria-hidden="true" style="color:#38bdf8;font-size:.65rem" title="Weather-exposed"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg>' : ''}
      </div>`;
    }

    gc.innerHTML = headerHtml + barsHtml;
    if (gl) gl.innerHTML = labelsHtml;

    // Draw dependency arrows (SVG overlay)
    drawDependencyArrows(tasks);
  }

  // ---- Dependency Arrows (SVG overlay) ----
  // Dashed gold lines from each task's bar to its successors, with an
  // arrowhead at the successor end. The overlay lives INSIDE the scrolling
  // chart container (#gantt-chart) and uses content-relative coordinates
  // (rect offset + scroll), so arrows stay glued to the bars while scrolling.
  function drawDependencyArrows(tasks) {
    const gc = $('gantt-chart');
    if (!gc) return;

    // Remove any previous overlay FIRST — repeated renders/cascades must
    // never stack multiple SVGs.
    const oldArrows = gc.querySelector('.gantt-arrows');
    if (oldArrows) oldArrows.remove();

    // When the Gantt panel is hidden, rects are all zeros — skip the overlay;
    // renderGantt redraws arrows the next time the section is shown.
    if (!gc.offsetParent) return;

    // Only draw if there are predecessor links
    const hasPreds = tasks.some(t => t.predecessors && t.predecessors.length);
    if (!hasPreds) return;

    const bars = gc.querySelectorAll('.gb');
    if (!bars.length) return;

    // Map task id → bar element (attribute lookup, no selector escaping)
    const barMap = {};
    Array.prototype.forEach.call(bars, bar => {
      barMap[bar.getAttribute('data-id')] = bar;
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'gantt-arrows');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'visible';
    svg.style.zIndex = '5';

    // Arrowhead marker
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'gantt-arrowhead');
    marker.setAttribute('viewBox', '0 0 8 8');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '4');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto');
    const markerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    markerPath.setAttribute('d', 'M0,0 L8,4 L0,8 z');
    markerPath.setAttribute('fill', 'var(--gold)');
    marker.appendChild(markerPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const gcRect = gc.getBoundingClientRect();
    const scrollX = gc.scrollLeft || 0;
    const scrollY = gc.scrollTop || 0;

    tasks.forEach(t => {
      const preds = t.predecessors || [];
      if (!preds.length) return;
      const b2 = barMap[t.id];
      if (!b2) return;
      const rect2 = b2.getBoundingClientRect();
      const x2 = rect2.left - gcRect.left + scrollX;
      const y2 = rect2.top + rect2.height / 2 - gcRect.top + scrollY;
      for (const predId of preds) {
        const b1 = barMap[predId];
        if (!b1) continue;
        const rect1 = b1.getBoundingClientRect();
        const x1 = rect1.right - gcRect.left + scrollX;
        const y1 = rect1.top + rect1.height / 2 - gcRect.top + scrollY;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', 'var(--gold)');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-dasharray', '4,3');
        line.setAttribute('opacity', '0.55');
        line.setAttribute('marker-end', 'url(#gantt-arrowhead)');
        // Clickable dependency link (Phase C): hover + click to remove/edit
        line.setAttribute('class', 'gan-link');
        line.setAttribute('data-from', predId);
        line.setAttribute('data-to', t.id);
        line.style.pointerEvents = 'stroke';
        line.style.cursor = 'pointer';
        // Transparent wide hit target so tiny links are still clickable
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
        hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '12');
        hit.setAttribute('class', 'gan-link');
        hit.setAttribute('data-from', predId);
        hit.setAttribute('data-to', t.id);
        hit.style.pointerEvents = 'stroke';
        hit.style.cursor = 'pointer';
        svg.appendChild(hit);
        svg.appendChild(line);
      }
    });

    gc.appendChild(svg);
  }

  // ---- Redraw Arrows on Scroll / Resize ----
  // Re-runs the overlay so arrows stay glued to the bars while the user
  // scrolls the chart or the window is resized. The task set is re-derived
  // from LIVE state with the same filter renderGantt applies, so there is no
  // cached snapshot that can drift from what is drawn. If a future path ever
  // changed the bars without calling renderGantt, drawDependencyArrows still
  // skips any bar id that is not in the DOM, so the overlay can never point
  // at a bar that is not on screen.
  // rAF-throttled: at most one redraw per frame regardless of event volume.
  let _arrowsRaf = null;
  function redrawGanttArrows() {
    if (_arrowsRaf) return;
    _arrowsRaf = requestAnimationFrame(() => {
      _arrowsRaf = null;
      const s = S();
      if (!s || !s.tasks) return;
      const tasks = s.tasks.filter(t => t.startDate && t.endDate);
      // Draw even with zero tasks: drawDependencyArrows removes any stale
      // overlay before its empty-early-return, so a chart emptied without a
      // full re-render never keeps dead arrows on screen.
      drawDependencyArrows(tasks);
    });
  }

  // Scroll events don't bubble, so catch them in the capture phase. Redraw
  // when the scroll originates on the chart, anything inside it, or its
  // .gw wrapper (the grid can also scroll on narrow layouts).
  document.addEventListener('scroll', function(e) {
    const t = e.target;
    const gc = document.getElementById('gantt-chart');
    if (t && gc && (gc.contains(t) || t.contains(gc))) redrawGanttArrows();
  }, true);
  window.addEventListener('resize', redrawGanttArrows);

  // ---- Kanban ----
  // Card markup shared by the four status columns and the Lead-Time lane so
  // a card never looks different depending on where it sits.
  function kanbanCard(t) {
    const overdue = t.status !== 'completed' && U.isOverdue(t.endDate) ? 'overdue' : '';
    const pulse = U.isDueSoon(t.endDate, 3) && t.status !== 'completed' ? 'pls' : '';
    const lead = t.leadTime ? 'leadtime' : '';
    const rec = t.recurring ? 'recurring' : '';
    const wx = t.weatherExposed ? 'wex' : '';
    const crit = t.critical ? '<svg class="ico" aria-hidden="true" style="color:var(--gold);font-size:.7rem"><use href="css/mmgr-icons.svg#i-target"></use></svg> ' : '';
    return `<div class="kc ${overdue} ${pulse} ${lead} ${rec} ${wx}" draggable="true" data-drag-id="${U.escapeHtml(t.id)}" data-id="${U.escapeHtml(t.id)}">
      <div class="cn">${crit}${U.escapeHtml(t.name)}</div>
      <div class="cm">
        <span>${U.escapeHtml(t.assignee || '—')}</span>
        ${t.endDate ? '<span>' + U.fmtDateShort(t.endDate) + '</span>' : ''}
        ${t.critical ? '<span class="badge bo" style="font-size:.6rem">CP</span>' : ''}
      </div>
    </div>`;
  }

  // ---- Lead-Time lane card (monolith kanban leadtime-lane treatment) ----
  // Lead-time cards in the dedicated lane show the vendor-wait facts the
  // generic card can't: Expected date, auto-progress elapsed % (submitted →
  // expected, falling back to % done) and days-left / OVERDUE. This is what
  // makes the lane a tracker instead of just another column.
  function kanbanLeadtimeCard(t) {
    const overdue = t.status !== 'completed' && U.isOverdue(t.endDate) ? 'overdue' : '';
    const pulse = U.isDueSoon(t.endDate, 3) && t.status !== 'completed' ? 'pls' : '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = U.parseDL(t.expectedDate);
    const days = exp ? Math.round((exp - today) / 86400000) : null;
    let elapsed = (t.done !== undefined && t.done !== null && t.done !== '') ? t.done + '%' : '—';
    const sub = U.parseDL(t.submittedDate);
    if (sub && exp && exp > sub) {
      const pct = Math.round((today - sub) / (exp - sub) * 100);
      elapsed = Math.max(0, Math.min(100, pct)) + '%';
    }
    const daysSpan = days !== null
      ? `<span class="${days <= 5 ? 'lt-card-urgent' : 'lt-card-ok'}">${days < 0 ? 'OVERDUE' : days + 'd left'}</span>`
      : '';
    return `<div class="kc leadtime ${overdue} ${pulse}" draggable="true" data-drag-id="${U.escapeHtml(t.id)}" data-id="${U.escapeHtml(t.id)}">
      <div class="cn">${U.escapeHtml(t.name)}</div>
      <div class="cm">
        <span>ID ${U.escapeHtml(t.id)}</span>
        ${t.expectedDate ? '<span>Expected ' + U.escapeHtml(t.expectedDate) + '</span>' : ''}
        <span>${elapsed} elapsed</span>
        ${daysSpan}
      </div>
    </div>`;
  }

  function renderKanban() {
    const s = S();
    if (!s || !s.tasks) return;
    // DOM-id contract (interaction audit): the board columns in project.html
    // are kc-todo/w-todo, kc-ip/w-ip, kc-bl/w-bl, kc-dn/w-dn — short ids.
    // Map each status to its real element ids so cards land in every column.
    const cols = [
      ['todo', 'kc-todo', 'w-todo'],
      ['inprogress', 'kc-ip', 'w-ip'],
      ['blocked', 'kc-bl', 'w-bl'],
      ['completed', 'kc-dn', 'w-dn']
    ];
    // Lead-Time lane visibility (monolith kbShowLeadtime) + toolbar chip sync.
    // The Phase-2 leadtimeLane flag OFF hides the lane outright (full gate,
    // so renderFlags and renderKanban agree on every entry path).
    const kbShow = !!s.kbShowLeadtime;
    const ltFlagOff = !!(s.flags && s.flags.leadtimeLane === false);
    const ltLane = $('col-leadtime');
    if (ltLane) ltLane.classList.toggle('is-hide', !kbShow || ltFlagOff);
    const ltChip = document.querySelector('[data-action="tglLeadtimeLane"]');
    if (ltChip) ltChip.classList.toggle('is-on', kbShow);
    const noTasksAtAll = s.tasks.length === 0;
    // Interaction re-audit: phase containers (explicit isPhase) and rollup
    // parents (non-phase level-0 rows that other tasks point at via
    // parentName) are structural WBS headers, not work items — they must not
    // pollute the board. Each WIP counter mirrors exactly what its column
    // renders (work items only). Parent linkage is by name (the import
    // convention), so narrowing the rollup check to level 0 keeps deeper
    // same-named children on the board; a level-0 work item sharing a
    // parent's name is the one documented limitation.
    const rollupParents = new Set();
    s.tasks.forEach(t => { if (t.parentName) rollupParents.add(t.parentName); });
    const isWorkItem = t => !t.isPhase && !((t.level || 0) === 0 && rollupParents.has(t.name));
    for (const col of cols) {
      const status = col[0];
      const el = $(col[1]);
      if (!el) continue;
      const tasks = s.tasks.filter(t => (t.status || 'todo') === status && isWorkItem(t));
      const wip = $(col[2]);
      if (wip) wip.textContent = tasks.length;
      // STRUCTURAL-IA §5: brand-new project — one clear empty state across
      // the board instead of four identical empty columns.
      if (noTasksAtAll) {
        el.innerHTML = status === 'todo'
          ? '<div class="es" style="padding:24px;font-size:.76rem">No tasks yet — add your first task to start the board.<div style="margin-top:10px"><button class="btn btn-g btn-s" data-action="showSec" data-section="wbs">+ Add Task</button></div></div>'
          : '';
        continue;
      }
      el.innerHTML = tasks.map(kanbanCard).join('');
    }
    // Lead-Time lane content (monolith parity): leadTime tasks live here
    // when the lane is enabled. Dragging a card onto it toggles t.leadTime
    // (dropCardLeadtime), and the WBS toggle feeds the same flag.
    const ltEl = $('kc-lt');
    if (ltEl) {
      const ltTasks = (s.tasks || []).filter(t => t.leadTime && isWorkItem(t));
      const wlt = $('w-lt');
      if (wlt) wlt.textContent = ltTasks.length;
      if (noTasksAtAll) {
        ltEl.innerHTML = '';
      } else if (!ltTasks.length) {
        ltEl.innerHTML = '<div class="es" style="padding:16px;font-size:.72rem">Drag a card here to mark it Lead-Time — or flip the clock toggle on any WBS row.</div>';
      } else {
        ltEl.innerHTML = ltTasks.map(kanbanLeadtimeCard).join('');
      }
    }
  }

  // ---- Phase-2 cross-linking helpers (ACTION-PLAN 2) ----
  // 2.1 / 2.2 ripple math: parse schedule days and $ from free-text impact
  // fields (e.g. "+10 days", "2 weeks", "$25,000"). Pure, state-free.
  function parseImpactDays(text) {
    if (!text) return 0;
    const m = String(text).match(/(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.charAt(0) === 'd') return Math.round(n);
    if (unit.charAt(0) === 'w') return Math.round(n * 5);
    if (unit.charAt(0) === 'm') return Math.round(n * 21);
    return 0;
  }
  function parseImpactCost(text) {
    if (!text) return 0;
    const m = String(text).match(/\$\s?([\d,]+(?:\.\d+)?)/);
    return m ? (parseFloat(m[1].replace(/,/g, '')) || 0) : 0;
  }
  // 2.5 risk exposure = Σ (probability factor × cost estimate); contingency
  // = Σ planned $ of budget lines flagged isContingency. Pure functions of
  // state so Budget and any other surface can share the same math.
  const PROB_FACTOR = { 'very low': 0.05, 'low': 0.2, 'medium': 0.4, 'high': 0.7, 'very high': 0.85 };
  function riskExposure(state) {
    const s = state || S();
    return ((s && s.risks) || []).reduce((sum, r) => sum + ((+r.costImpactEstimate || 0) * (PROB_FACTOR[String(r.probability || '').toLowerCase()] || 0)), 0);
  }
  function contingencyTotal(state) {
    const s = state || S();
    return ((s && s.budgetLines) || []).filter(l => l.isContingency).reduce((sum, l) => sum + (+l.planned || 0), 0);
  }

  // ---- Risks ----
  // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-1: clickable probability ×
  // impact matrix. Clicking a cell filters the risk list to that exact
  // probability/impact combination (active cell keeps a gold outline); a
  // Clear filter button appears only while a filter is active. Restored from
  // the monolith's clickRiskCell / clearRiskFilter / renderRiskMatrix,
  // adapted to the current 5-level string model ('Very Low'..'Very High').
  let riskMatrixFilter = null; // { prob, imp } or null

  function riskMatrixCell(prob, imp) {
    riskMatrixFilter = (riskMatrixFilter && riskMatrixFilter.prob === prob && riskMatrixFilter.imp === imp)
      ? null
      : { prob: prob, imp: imp };
    renderRisks();
  }

  function clearRiskFilter() {
    riskMatrixFilter = null;
    renderRisks();
  }

  function renderRiskMatrix() {
    const el = $('risk-matrix');
    if (!el) return;
    const s = S();
    const risks = (s && s.risks) || [];
    if (!risks.length) {
      el.innerHTML = '<div class="es" style="padding:10px;font-size:.7rem">Matrix populates once you add tracked risks above.</div>';
      return;
    }
    const LEVELS = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
    const counts = {};
    // Counts ALL risks, including issue-promoted ones — deliberate divergence
    // from the monolith (which excluded r.issue): the risk table below this
    // matrix also shows every risk, so the counts stay consistent with what
    // the user can see and click on in the same panel.
    risks.forEach(r => { const k = (r.probability || '') + '|' + (r.impact || ''); counts[k] = (counts[k] || 0) + 1; });
    const active = riskMatrixFilter;
    const sev = (p, i) => { const sum = LEVELS.indexOf(p) + LEVELS.indexOf(i); return sum <= 3 ? 'bg' : sum <= 5 ? 'ba' : 'br'; };
    const hdr = `<tr><td></td>${LEVELS.map(p => `<td style="font-size:.62rem;color:var(--slate);text-align:center;padding-bottom:3px">${p}</td>`).join('')}</tr>`;
    const rows = LEVELS.slice().reverse().map(imp => {
      const cells = LEVELS.map(p => {
        const n = counts[p + '|' + imp] || 0;
        const on = active && active.prob === p && active.imp === imp;
        return `<td style="padding:2px"><div class="badge ${sev(p, imp)}" data-action="riskMatrixCell" data-prob="${p}" data-imp="${imp}" style="width:44px;min-height:26px;justify-content:center;cursor:pointer;font-weight:700;${on ? 'outline:2px solid var(--gold);outline-offset:1px' : ''}" title="Probability ${p} × Impact ${imp} — click to filter">${n || ''}</div></td>`;
      }).join('');
      return `<tr><td style="font-size:.62rem;color:var(--slate);text-align:right;padding-right:6px;white-space:nowrap">${imp}</td>${cells}</tr>`;
    }).join('');
    el.innerHTML = `<div style="font-size:.64rem;color:var(--slate);margin-bottom:6px">Impact ↑ &nbsp;/&nbsp; Probability → &nbsp;(click a cell to filter the list below)</div>
      <table style="border-collapse:collapse">${hdr}${rows}</table>
      ${active ? `<button class="btn btn-n btn-s" data-action="riskMatrixClear" style="margin-top:8px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Clear filter</button>` : ''}`;
  }

  // ---- MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-7: WBS schedule-issues
  // collapsible banner. The schedule engine's audit() computed issues that
  // nothing surfaced — restore the monolith's badge banner consuming its
  // output (collapsed badge count, click to expand the detail list).
  let wbsIssuesOpen = false;
  function toggleWbsIssues() {
    wbsIssuesOpen = !wbsIssuesOpen;
    renderWbsAlerts();
  }
  function renderWbsAlerts() {
    const el = $('wbs-alerts');
    if (!el) return;
    // Runs a full schedule audit per WBS render (matches the monolith's
    // renderWBS behaviour) — acceptable on project-sized schedules; if this
    // ever shows up in profiling, debounce the audit rather than caching it,
    // since the whole point is that it never goes stale.
    const issues = (ns.Schedule && ns.Schedule.audit) ? ns.Schedule.audit() : [];
    // audit() always appends a summary 'info' row (task 'all') — the badge
    // counts actionable rows; the detail lists them all.
    const real = issues.filter(i => i.task !== 'all');
    if (!real.length) { el.innerHTML = ''; return; }
    const sevCls = { error: 'br', warning: 'ba', info: 'bs' };
    el.innerHTML = `<div class="badge br" style="padding:6px 12px;cursor:pointer" data-action="tglWbsIssues"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> ${real.length} schedule logic issue${real.length !== 1 ? 's' : ''} detected — click for details</div>
      <div id="wbs-issues-detail" style="display:${wbsIssuesOpen ? 'block' : 'none'};margin-top:8px;font-size:.74rem;background:rgba(0,0,0,.2);border-radius:6px;padding:10px 12px">
        ${real.map(i => `<div style="margin-bottom:6px"><span class="badge ${sevCls[i.severity] || 'bs'}" style="font-size:.6rem;padding:1px 5px">${U.escapeHtml(i.severity)}</span> <strong>${U.escapeHtml(i.task)}</strong> — ${U.escapeHtml(i.message)}</div>`).join('')}
      </div>`;
  }

  function renderRisks() {
    const s = S();
    if (!s) return;
    const body = $('risk-body');
    if (body) {
      let risks = s.risks || [];
      // RESTORE-1: an active matrix cell filters the list below.
      if (riskMatrixFilter) {
        risks = risks.filter(r => (r.probability || '') === riskMatrixFilter.prob && (r.impact || '') === riskMatrixFilter.imp);
      }
      // 2.1 dependency-aware risk propagation: flag risks whose linked task
      // is overdue, and offer the task link in the row itself.
      const overdueIds = {};
      (s.tasks || []).forEach(t => { if (t.status !== 'completed' && U.isOverdue(t.endDate)) overdueIds[String(t.id)] = true; });
      const taskOpts = (s.tasks || []).map(t => `<option value="${U.escapeHtml(String(t.id))}">${U.escapeHtml(t.name)}</option>`).join('');
      if (risks.length === 0) {
        body.innerHTML = emptyStateRow(9, riskMatrixFilter ? 'No risks in this matrix cell.' : 'No risks logged yet.', riskMatrixFilter ? '' : '<button class="btn btn-g btn-s" data-action="addRisk">+ Add Risk</button>');
      } else {
        body.innerHTML = risks.map((r, i) => {
          const linkedLate = r.linkedTaskId && overdueIds[String(r.linkedTaskId)];
          return `<tr>
          <td>${U.escapeHtml(r.id || 'R' + (i+1))}</td>
          <td>${U.escapeHtml(r.description)}</td>
          <td><select data-action="updField" data-module="Risks" data-field="probability" data-idx="${i}">${['Very Low','Low','Medium','High','Very High'].map(p => `<option ${r.probability === p ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
          <td><select data-action="updField" data-module="Risks" data-field="impact" data-idx="${i}">${['Very Low','Low','Medium','High','Very High'].map(p => `<option ${r.impact === p ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
          <td><input type="text" value="${U.escapeHtml(r.mitigation || '')}" data-action="updField" data-module="Risks" data-field="mitigation" data-idx="${i}" placeholder="Mitigation plan"></td>
          <td><select data-action="updField" data-module="Risks" data-field="linkedTaskId" data-idx="${i}" title="Link the task this risk threatens — it is flagged live when that task slips"><option value="">— task —</option>${taskOpts}</select>${linkedLate ? '<span class="badge br" style="font-size:.6rem;padding:1px 4px;margin-left:4px" title="Linked task is overdue — this risk is live">LATE</span>' : ''}</td>
          <td><input type="number" value="${r.costImpactEstimate || 0}" min="0" step="100" data-action="updField" data-module="Risks" data-field="costImpactEstimate" data-idx="${i}" style="width:84px" title="Estimated $ impact if this risk lands (2.5)"></td>
          <td><button class="btn btn-s ${r.issueId ? 'btn-d' : 'btn-n'}" data-action="toggleRiskIssue" data-idx="${i}">${r.issueId ? '→ Issue' : '→ Issue'}</button></td>
          <td><button class="btn btn-s btn-d" data-action="delRisk" data-idx="${i}">×</button></td>
        </tr>`;
        }).join('');
      }
    }
    const issueBody = $('issue-body');
    if (issueBody) {
      const issues = s.issues || [];
      if (issues.length === 0) {
        issueBody.innerHTML = emptyStateRow(6, 'No live issues. Tracked risks can be promoted to issues with the “→ Issue” button.');
      } else {
        issueBody.innerHTML = issues.map((iss, i) => `<tr class="irow">
          <td>${U.escapeHtml(iss.id || 'I' + (i+1))}</td>
          <td>${U.escapeHtml(iss.description)}</td>
          <td>${U.escapeHtml(iss.owner || '')}</td>
          <td><input type="date" value="${iss.targetDate || ''}" data-action="updField" data-module="Issues" data-field="targetDate" data-idx="${i}"></td>
          <td><select data-action="updField" data-module="Issues" data-field="status" data-idx="${i}">${['open','inprogress','resolved','closed'].map(s => `<option ${iss.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
          <td><button class="btn btn-s btn-d" data-action="delIssue" data-idx="${i}">×</button></td>
        </tr>`).join('');
      }
    }
    renderRiskMatrix();
    // MARKET-FEATURE-ROADMAP C16/C17: inspection checklists + incident
    // register live in the Risk & Issue panel (quality/safety compliance hub).
    renderInspections();
    renderIncidents();
  }

  // ---- Inspection Checklists (MARKET-FEATURE-ROADMAP C16) ----
  // One card per inspection: pass/fail item rows + a status select that
  // auto-advances to 'passed' when every item checks. Zero third-party.
  function renderInspections() {
    const s = S();
    if (!s) return;
    const body = $('insp-body');
    if (!body) return;
    const list = s.inspections || [];
    const sum = $('insp-sum');
    const passed = list.filter(x => x.status === 'passed' || x.status === 'closed').length;
    if (sum) sum.textContent = list.length ? (passed + ' passed · ' + (list.length - passed) + ' open') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(8, 'No inspection checklists yet.', '<button class="btn btn-g btn-s" data-action="addInspection">+ Add Inspection</button>');
      return;
    }
    const statusColor = (st) => st === 'passed' || st === 'closed' ? 'var(--green)' : st === 'failed' ? 'var(--danger)' : 'var(--amber)';
    body.innerHTML = list.map((x, i) => {
      const items = x.items || [];
      const itemRows = items.map((it, j) => `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
        <input type="checkbox" ${it.pass ? 'checked' : ''} data-action="inspItemToggle" data-idx="${i}" data-iidx="${j}" title="Pass / fail">
        <input type="text" value="${U.escapeHtml(it.text)}" data-action="updInspItem" data-field="text" data-idx="${i}" data-iidx="${j}" placeholder="Checklist item" style="flex:1;min-width:120px">
        <input type="text" value="${U.escapeHtml(it.notes || '')}" data-action="updInspItem" data-field="notes" data-idx="${i}" data-iidx="${j}" placeholder="—" style="width:130px">
        <button class="btn btn-s btn-d" data-action="delInspItem" data-idx="${i}" data-iidx="${j}" title="Remove item">×</button>
      </div>`).join('');
      return `<tr>
        <td>${U.escapeHtml(x.id || 'INSP' + (i+1))}</td>
        <td><input type="text" value="${U.escapeHtml(x.title)}" data-action="updField" data-module="Inspections" data-field="title" data-idx="${i}" style="min-width:130px" placeholder="Inspection title"></td>
        <td><input type="text" value="${U.escapeHtml(x.trade || '')}" data-action="updField" data-module="Inspections" data-field="trade" data-idx="${i}" style="width:90px" placeholder="Trade"></td>
        <td><input type="text" value="${U.escapeHtml(x.area || '')}" data-action="updField" data-module="Inspections" data-field="area" data-idx="${i}" style="width:100px" placeholder="Area"></td>
        <td><input type="date" value="${x.date || ''}" data-action="updField" data-module="Inspections" data-field="date" data-idx="${i}"></td>
        <td style="min-width:220px">${itemRows}
          <button class="btn btn-s btn-g" data-action="addInspItem" data-idx="${i}">+ item</button>
        </td>
        <td><select data-action="updField" data-module="Inspections" data-field="status" data-idx="${i}" style="color:${statusColor(x.status)}">${['open','passed','failed','closed'].map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><button class="btn btn-s btn-d" data-action="delInspection" data-idx="${i}">×</button></td>
      </tr>`;
    }).join('');
  }

  // ---- Incident Register w/ corrective-action loop (MARKET-FEATURE-ROADMAP
  // C17) ----
  // Quality/safety incidents with root cause + corrective action closure.
  function renderIncidents() {
    const s = S();
    if (!s) return;
    const body = $('inc-body');
    if (!body) return;
    const list = s.incidents || [];
    const sum = $('inc-sum');
    const open = list.filter(x => x.status !== 'closed').length;
    if (sum) sum.textContent = list.length ? (open + ' open · ' + (list.length - open) + ' closed') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(10, 'No incidents logged.', '<button class="btn btn-g btn-s" data-action="addIncident">+ Log Incident</button>');
      return;
    }
    const statusColor = (st) => st === 'closed' ? 'var(--green)' : st === 'action' ? 'var(--gold)' : st === 'investigation' ? 'var(--amber)' : 'var(--danger)';
    body.innerHTML = list.map((x, i) => `<tr>
      <td>${U.escapeHtml(x.id || 'INC' + (i+1))}</td>
      <td><input type="date" value="${x.date || ''}" data-action="updField" data-module="Incidents" data-field="date" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Incidents" data-field="type" data-idx="${i}">${['Safety','Quality','Environmental'].map(v => `<option ${x.type === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="Incidents" data-field="severity" data-idx="${i}" style="color:${x.severity === 'High' ? 'var(--danger)' : x.severity === 'Medium' ? 'var(--amber)' : 'var(--slate)'}">${['Low','Medium','High','Critical'].map(v => `<option ${x.severity === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.description)}" data-action="updField" data-module="Incidents" data-field="description" data-idx="${i}" style="min-width:150px" placeholder="What happened"></td>
      <td><input type="text" value="${U.escapeHtml(x.owner || '')}" data-action="updField" data-module="Incidents" data-field="owner" data-idx="${i}" style="width:90px" placeholder="Owner"></td>
      <td><select data-action="updField" data-module="Incidents" data-field="status" data-idx="${i}" style="color:${statusColor(x.status)}">${(ns.Incidents && ns.Incidents.statuses || ['open','investigation','action','closed']).map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.rootCause || '')}" data-action="updField" data-module="Incidents" data-field="rootCause" data-idx="${i}" style="width:120px" placeholder="Root cause"></td>
      <td><input type="text" value="${U.escapeHtml(x.correctiveAction || '')}" data-action="updField" data-module="Incidents" data-field="correctiveAction" data-idx="${i}" style="width:120px" placeholder="Corrective action"></td>
      <td><button class="btn btn-s btn-d" data-action="delIncident" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Resources ----
  function renderResources() {
    const s = S();
    if (!s) return;
    const body = $('res-body');
    if (!body) return;
    const resources = s.resources || [];
    if (resources.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No resources added yet.', '<button class="btn btn-g btn-s" data-action="addResource">+ Add Resource</button>');
      renderResourceLeveling();
      return;
    }
    body.innerHTML = resources.map((r, i) => {
      const u = (ns.Resources && ns.Resources.resUtil) ? ns.Resources.resUtil(r) : (+r.utilization || 0);
      const over = u > 100;
      return `<tr>
      <td>${U.escapeHtml(r.id || 'R' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(r.name)}" data-action="updField" data-module="Resources" data-field="name" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Resources" data-field="type" data-idx="${i}">${['Labor','Equipment','Material','Subcontractor'].map(t => `<option ${r.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(r.role || '')}" data-action="updField" data-module="Resources" data-field="role" data-idx="${i}" placeholder="Role / Spec"></td>
      <td><input type="number" value="${r.availability || 100}" min="0" max="100" data-action="updField" data-module="Resources" data-field="availability" data-idx="${i}" style="width:60px">%</td>
      <td><input type="number" value="${r.rate || 0}" min="0" step="5" data-action="updField" data-module="Resources" data-field="rate" data-idx="${i}" style="width:80px"></td>
      <td><input type="number" value="${r.hoursAllocated || 0}" min="0" data-action="updField" data-module="Resources" data-field="hoursAllocated" data-idx="${i}" style="width:80px"></td>          <td class="${over ? 'txt-danger' : 'txt-green'}">${u}%${over ? '<svg class="ico" aria-hidden="true" style="font-size:.6rem"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg>' : ''}</td>
      <td><button class="btn btn-s btn-d" data-action="delResource" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
    renderResourceLeveling();
  }

  // ---- Resource Leveling visual (feature 6) ----
  // Display-only utilization strip, one bar per resource, reusing the same
  // resUtil() math. Color bands match the badge convention (>100% danger,
  // 85-100% amber, <85% green).
  function renderResourceLeveling() {
    const s = S();
    if (!s) return;
    const el = $('res-leveling');
    if (!el) return;
    const resources = s.resources || [];
    if (!resources.length) { el.innerHTML = ''; return; }
    const util = (ns.Resources && ns.Resources.resUtil) ? ns.Resources.resUtil : null;
    el.innerHTML = '<div class="rl-title"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-bar-chart"></use></svg> Utilization Overview</div>' +
      resources.map(r => {
        const u = util ? util(r) : (+r.utilization || 0);
        const col = u > 100 ? 'var(--danger)' : u >= 85 ? 'var(--amber)' : 'var(--green)';
        const nm = (r.name || 'Unnamed').replace(/</g, '&lt;');
        return `<div class="rl-row">
        <div class="rl-name" title="${nm}">${nm}</div>
        <div class="rl-bar">
          <div class="rl-fill" style="width:${Math.min(100, u)}%;background:${col}"></div>
        </div>
        <div class="rl-pct" style="color:${col}">${u}%${u > 100 ? '<svg class="ico" aria-hidden="true" style="font-size:.6rem"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg>' : ''}</div>
      </div>`;
      }).join('');
  }

  // ---- Money formatter (shared by EVM / cash-flow renderers) ----
  function fmt$(n) {
    const s = n < 0 ? '-' : '';
    return s + '$' + Math.abs(Math.round(+n || 0)).toLocaleString();
  }

  // ---- Spend Log (MONOLITH-PORTING-GUIDE feature 2) ----
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

  // ---- Cash-Flow S-Curve chart (feature 2) ----
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

  // ---- Budget ----
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
    // MARKET-FEATURE-ROADMAP C12: committed-but-not-spent bucket. A line's
    // committed figure defaults to planned when unset (preserving pre-C12
    // behavior); set 0 on a line to drop it out of the commitment total.
    const lineCommitted = (l) => (l.committed !== null && l.committed !== undefined && l.committed !== '')
      ? +l.committed || 0 : +l.planned || 0;
    const committed = lines.reduce((sum, l) => sum + lineCommitted(l), 0);
    const committedGap = Math.max(0, committed - actual);

    // Update summary cards
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

    // Spend Log + Cash-Flow chart (feature 2)
    renderSpendLog();
    renderCashFlowChart();

    if (lines.length === 0) {
      body.innerHTML = emptyStateRow(14, 'No budget lines yet.', '<button class="btn btn-g btn-s" data-action="addBudgetLine">+ Add Budget Line</button>');
      return;
    }
    // MARKET-FEATURE-ROADMAP A2: lien-waiver rollup for the summary strip.
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
      <td><select data-action="updField" data-module="Budget" data-field="waiverStatus" data-idx="${i}" title="Lien waiver status (US-convention labels — Jamaica verification pending, roadmap B7)">${['pending','conditional','unconditional','not_required'].map(w => `<option ${(l.waiverStatus || 'pending') === w ? 'selected' : ''}>${w}</option>`).join('')}</select></td>
      <td><input type="date" value="${U.escapeHtml(l.waiverReceivedAt || '')}" data-action="updField" data-module="Budget" data-field="waiverReceivedAt" data-idx="${i}" title="Date the waiver was received (set once status is conditional/unconditional)"></td>
      <td><input type="text" value="${U.escapeHtml(l.notes || '')}" data-action="updField" data-module="Budget" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delBudgetLine" data-idx="${i}">×</button></td>
    </tr>`).join('');
    // 2.5 risk-to-budget contingency linkage: compare summed expected value
    // of logged risks against reserved contingency lines.
    const rcc = $('risk-cont-con');
    if (rcc) {
      const exposure = riskExposure(s);
      const cont = contingencyTotal(s);
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
    // MASTER-ACTION-PLAN-v3-STRICT Rank 1.3: LD exposure rollup on the Budget
    // tab — avoided (weather cause) vs incurred (every other cause), driven
    // by 1.2's cause tags, not weather tags alone.
    if (ns.Claim && ns.Claim.renderLdRollup) ns.Claim.renderLdRollup();
    // MARKET-FEATURE-ROADMAP C13: pay application register.
    renderPayApps();
  }

  // ---- Pay Applications (MARKET-FEATURE-ROADMAP C13) ----
  // Draw-request register card in the Budget panel. Generated drafts carry
  // the live spend figure; statuses walk draft → submitted → approved.
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

  // ---- Stakeholders ----
  function renderStakeholders() {
    const s = S();
    if (!s) return;
    const body = $('stk-body');
    if (!body) return;
    const stks = s.stakeholders || [];
    const soon = 30; // MARKET-FEATURE-ROADMAP A1: 30-day compliance horizon
    const expiring = (ns.Stakeholders && ns.Stakeholders.getExpiringCompliance)
      ? ns.Stakeholders.getExpiringCompliance(stks, soon)
      : [];
    // Compliance heads-up banner — card language, not a bare strip (UI doctrine 1).
    const banner = $('stk-compliance');
    if (banner) {
      const n = expiring.length;
      const txt = n
        ? n + ' stakeholder' + (n === 1 ? ' has' : 's have') + ' COI or license documentation expiring within ' + soon + ' days — see the Compliance columns below.'
        : '';
      banner.classList.toggle('is-hide', !n);
      const btxt = banner.querySelector('.stk-cmp-txt');
      if (btxt) btxt.textContent = txt;
    }
    syncStakeComplianceBadges(expiring.length);
    // MARKET-FEATURE-ROADMAP A3/A4: bid leveling + Go/No-Go scorecards live
    // in the Stakeholders panel — rendered by the same entry point so every
    // re-render of this section refreshes all three blocks together.
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
      // Always-editable date inputs (the app's inline-edit pattern); the
      // expiring/current state rides alongside as a quiet flag, never a
      // read-only span that traps the value.
      const coiCell = `<input type="date" value="${U.escapeHtml(stk.coiExpiry || '')}" class="${coiBad ? 'stk-exp-bad' : ''}" data-action="updField" data-module="Stakeholders" data-field="coiExpiry" data-idx="${i}" title="COI expiry${coiBad ? ' — expires within ' + soon + ' days' : ''}">${coiBad ? `<span class="badge br" title="Expires within ${soon} days">soon</span>` : ''}`;
      const licCell = `<input type="date" value="${U.escapeHtml(stk.licenseExpiry || '')}" class="${licBad ? 'stk-exp-bad' : ''}" data-action="updField" data-module="Stakeholders" data-field="licenseExpiry" data-idx="${i}" title="Trade license expiry${licBad ? ' — expires within ' + soon + ' days' : ''}">${licBad ? `<span class="badge br" title="Expires within ${soon} days">soon</span>` : ''}`;
      const emrCell = `<input type="text" value="${U.escapeHtml(stk.emr || '')}" data-action="updField" data-module="Stakeholders" data-field="emr" data-idx="${i}" style="width:52px" placeholder="0.00">${emrStale ? `<span class="badge br" title="EMR stale — verify or set a verification date">stale</span>` : ''}`;
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
      <td><input type="date" value="${U.escapeHtml(stk.emrVerifiedAt || '')}" data-action="updField" data-module="Stakeholders" data-field="emrVerifiedAt" data-idx="${i}" title="EMR verification date — used for staleness (A5)"></td>
      <td><button class="btn btn-s btn-d" data-action="delStake" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
  }

  // MARKET-FEATURE-ROADMAP A1: keep the Dashboard Project Health badge and the
  // Stakeholders nav badge (sec-nav + its sidebar clone) in step with the
  // expiring-compliance count. Hidden at zero; red pill when anything is due.
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
    // 2.2 change control ripple: live estimate of affected schedule days
    // (parsed from the Sched Impact field), budget lines exposed, and
    // downstream tasks that could shift. Shown before approval is finalised.
    const exposedLines = (s.budgetLines || []).length;
    const downstreamTasks = (s.tasks || []).filter(t => t.status !== 'completed' && t.endDate && !U.isOverdue(t.endDate)).length;
    body.innerHTML = changes.map((c, i) => {
      const days = parseImpactDays(c.schedImpact);
      const cost = parseImpactCost(c.costImpact);
      const hasRipple = days > 0 || cost > 0 || exposedLines > 0;
      const rippleHtml = hasRipple
        ? `<span style="color:${c.status === 'approved' ? 'var(--green)' : 'var(--amber)'}">~${days}d · ${exposedLines} lines${cost ? ' · $' + cost.toLocaleString() : ''}${downstreamTasks ? ' · ' + downstreamTasks + ' tasks' : ''}</span>`
        : '—';
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

  // ---- Closure ----
  // ---- Punch List (MARKET-FEATURE-ROADMAP C3) ----
  // Dedicated defect/closeout items with location + assignee + category +
  // priority. Lives in the Closure panel as its own card (separate from the
  // simple Closeout Checklist, which stays for broad closeout items).
  function renderPunchList() {
    const s = S();
    if (!s) return;
    const body = $('punch-body');
    if (!body) return;
    const items = s.punchList || [];
    const open = items.filter(i => i.status !== 'done').length;
    const done = items.length - open;
    const sum = $('punch-sum');
    if (sum) sum.textContent = items.length ? (done + ' done · ' + open + ' open') : '';
    if (items.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No punch-list items yet.', '<button class="btn btn-g btn-s" data-action="addPunch">+ Add Punch Item</button>');
      return;
    }
    const p = (v) => v === 'High' ? 'var(--danger)' : v === 'Medium' ? 'var(--amber)' : 'var(--slate)';
    body.innerHTML = items.map((it, i) => `<tr>
      <td>${U.escapeHtml(it.id || 'P' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(it.item)}" data-action="updField" data-module="PunchList" data-field="item" data-idx="${i}" style="min-width:160px"></td>
      <td><input type="text" value="${U.escapeHtml(it.location || '')}" data-action="updField" data-module="PunchList" data-field="location" data-idx="${i}" placeholder="e.g. Level 2, Room 204"></td>
      <td><input type="text" value="${U.escapeHtml(it.assignee || '')}" data-action="updField" data-module="PunchList" data-field="assignee" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="PunchList" data-field="category" data-idx="${i}">${['Defect','Snag','Touch-up','Safety','Other'].map(v => `<option ${it.category === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="PunchList" data-field="priority" data-idx="${i}" style="color:${p(it.priority)}">${['Low','Medium','High'].map(v => `<option ${it.priority === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="PunchList" data-field="status" data-idx="${i}">${['open','inprogress','done'].map(v => `<option ${it.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(it.notes || '')}" data-action="updField" data-module="PunchList" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delPunch" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Handover / Closeout Package (MARKET-FEATURE-ROADMAP C18) ----
  function renderHandover() {
    const s = S();
    if (!s) return;
    const body = $('handover-body');
    if (!body) return;
    const list = s.handover || [];
    const filed = list.filter(x => x.status === 'filed').length;
    const sum = $('handover-sum');
    if (sum) sum.textContent = list.length ? (filed + ' of ' + list.length + ' filed') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(6, 'No handover items yet. Bundle O&M manuals, as-builts, warranties, certificates and sign-offs for handover.', '<button class="btn btn-g btn-s" data-action="addHandoverItem">+ Add Item</button>');
      return;
    }
    body.innerHTML = list.map((x, i) => `<tr>
      <td>${U.escapeHtml(x.id || 'HO' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.item)}" data-action="updField" data-module="Handover" data-field="item" data-idx="${i}" style="min-width:150px" placeholder="Item / document"></td>
      <td><select data-action="updField" data-module="Handover" data-field="category" data-idx="${i}">${['O&M Manual','Warranty','As-Built','Certificates','Sign-off','Other'].map(v => `<option ${x.category === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="Handover" data-field="status" data-idx="${i}" style="color:${x.status === 'filed' ? 'var(--green)' : x.status === 'ready' ? 'var(--gold)' : 'var(--amber)'}">${['required','ready','filed'].map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Handover" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delHandoverItem" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Warranty Tracker (MARKET-FEATURE-ROADMAP C26) ----
  function renderWarranty() {
    const s = S();
    if (!s) return;
    const body = $('warranty-body');
    if (!body) return;
    const list = s.warrantyItems || [];
    const sum = $('warranty-sum');
    if (sum) sum.textContent = list.length ? (list.length + ' tracked') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(8, 'No warranty items yet.', '<button class="btn btn-g btn-s" data-action="addWarranty">+ Add Warranty</button>');
      return;
    }
    function dl(d) {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return Math.round((dt.getTime() - Date.now()) / 86400000);
    }
    body.innerHTML = list.map((x, i) => {
      const left = dl(x.warrantyEnd);
      const leftTxt = left === null ? '—' : left < 0 ? (Math.abs(left) + 'd ago') : left + 'd left';
      const leftColor = left === null ? 'var(--slate)' : left < 0 ? 'var(--danger)' : left <= 60 ? 'var(--amber)' : 'var(--green)';
      return `<tr>
      <td>${U.escapeHtml(x.id || 'WR' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.item)}" data-action="updField" data-module="Warranty" data-field="item" data-idx="${i}" style="min-width:150px" placeholder="Item / system"></td>
      <td><input type="text" value="${U.escapeHtml(x.provider || '')}" data-action="updField" data-module="Warranty" data-field="provider" data-idx="${i}" placeholder="Provider"></td>
      <td><input type="date" value="${x.warrantyStart || ''}" data-action="updField" data-module="Warranty" data-field="warrantyStart" data-idx="${i}"></td>
      <td><input type="date" value="${x.warrantyEnd || ''}" data-action="updField" data-module="Warranty" data-field="warrantyEnd" data-idx="${i}"></td>
      <td style="color:${leftColor}">${leftTxt}</td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Warranty" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delWarranty" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
  }

  function renderClosure() {
    const s = S();
    if (!s) return;
    // Punch List renders even when the closure object is unset (fresh/seed
    // projects may never have touched Closure) — it is its own state.
    renderPunchList();
    // Handover + Warranty are their own state keys too — never gated on the
    // closure object existing.
    renderHandover();
    renderWarranty();
    if (!s.closure) return;
    const items = s.closure.items || [];
    const chk = $('close-chk');
    if (chk) {
      if (items.length === 0) {
        chk.innerHTML = '<div class="es" style="padding:16px;font-size:.78rem">No closeout items yet.</div>';
      } else {
        chk.innerHTML = items.map((item, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
          <input type="checkbox" ${item.done ? 'checked' : ''} data-action="updField" data-module="CloseItems" data-field="done" data-idx="${i}">
          <span style="${item.done ? 'text-decoration:line-through;color:var(--slate)' : ''}">${U.escapeHtml(item.text)}</span>
          <button class="btn btn-s btn-d" style="margin-left:auto" data-action="delCloseItem" data-idx="${i}">×</button>
        </div>`).join('');
      }
    }
    // Lessons learned
    const well = $('ll-well');
    if (well) well.value = s.closure.well || '';
    const imp = $('ll-imp');
    if (imp) imp.value = s.closure.imp || '';
    const rec = $('ll-rec');
    if (rec) rec.value = s.closure.rec || '';
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
    // Refresh the pickers so newly-added resources/stakeholders/tasks appear.
    if (Raci.refreshRaciPersonPicker) Raci.refreshRaciPersonPicker();
    if (Raci.refreshRaciTaskPicker) Raci.refreshRaciTaskPicker();
    if (tasks.length === 0 && persons.length === 0) {
      con.innerHTML = '<div class="es"><div class="ic"><svg class="ico" style="font-size:2rem" aria-hidden="true"><use href="css/mmgr-icons.svg#i-users"></use></svg></div>' +
        '<div>No RACI matrix yet — add a task row and a person column using the two pickers above.</div></div>';
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
    // Legend chips (feature 5) — heat-colored so overload/gaps read at a glance.
    const legend = '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:.7rem;color:var(--slate)">' +
      Raci.RACI_CYCLE_FILTERED().map(k => `<span><span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:4px;font-weight:800;background:${Raci.raciCellBg(k)};color:${Raci.raciCellFg(k)};border:1px solid ${Raci.raciCellFg(k)}">${k}</span> ${Raci.RACI_LABELS[k].split(' — ')[0]}</span>`).join('') +
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
  // Renders the per-person load summary under the matrix. Pure read of
  // Raci.raciWorkload(); empty state when no matrix exists yet.
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
        const nm = r.info.name || '—';
        const c = r.counts;
        const barColor = heat(r.pct);
        return `<div class="rw-cell">
          <div class="rw-head"><span class="rw-name">${U.escapeHtml(nm)}</span><span class="rw-load" style="color:${barColor}">${r.load.toFixed(1)}</span></div>
          <div class="rw-bar"><div class="rw-fill" style="width:${Math.max(4, r.pct)}%;background:${barColor}"></div></div>
          <div class="rw-counts"><span class="rw-r">R ${c.R}</span><span class="rw-a">A ${c.A}</span><span class="rw-c">C ${c.C}</span><span class="rw-i">I ${c.I}</span></div>
        </div>`;
      }).join('') + '</div>';
  }

  // ---- RACI alerts (feature 5): tasks with no Accountable, people with too many ----
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
      // 2.4: more than one Accountable per task is a conflict (exactly one A
      // is the RACI rule) — warned, never blocking.
      const aCount = persons.filter(p => matrix[t.id + '_' + p.id] === 'A').length;
      if (aCount > 1) {
        const ti = Raci.raciTaskInfo(t);
        alerts.push(`"${ti.name}" has ${aCount} Accountable people — exactly one is expected.`);
      }
    });
    persons.forEach(p => {
      const aCount = tasks.filter(t => matrix[t.id + '_' + p.id] === 'A').length;
      if (aCount > 5) {
        const pi = Raci.raciPersonInfo(p);
        alerts.push(`${pi.name} is Accountable for ${aCount} tasks — consider redistributing.`);
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

  // ---- Documents ----
  // ---- RFI Register (MARKET-FEATURE-ROADMAP C1) ----
  function renderRfis() {
    const s = S();
    if (!s) return;
    const body = $('rfi-body');
    if (!body) return;
    const list = s.rfis || [];
    const open = list.filter(r => r.status !== 'closed').length;
    const sum = $('rfi-sum');
    if (sum) sum.textContent = list.length ? (open + ' open · ' + (list.length - open) + ' closed') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(11, 'No RFIs yet.', '<button class="btn btn-g btn-s" data-action="addRfi">+ Add RFI</button>');
      return;
    }
    const statusColor = (st) => st === 'closed' ? 'var(--green)' : st === 'responded' ? 'var(--gold)' : st === 'routed' ? 'var(--amber)' : 'var(--danger)';
    body.innerHTML = list.map((r, i) => `<tr>
      <td>${U.escapeHtml(r.number || r.id || 'R' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(r.question)}" data-action="updField" data-module="Rfis" data-field="question" data-idx="${i}" style="min-width:180px" placeholder="The question / discrepancy"></td>
      <td><input type="text" value="${U.escapeHtml(r.from || '')}" data-action="updField" data-module="Rfis" data-field="from" data-idx="${i}" placeholder="From"></td>
      <td><input type="text" value="${U.escapeHtml(r.to || '')}" data-action="updField" data-module="Rfis" data-field="to" data-idx="${i}" placeholder="To (designer / engineer)"></td>
      <td><input type="date" value="${r.dateIssued || ''}" data-action="updField" data-module="Rfis" data-field="dateIssued" data-idx="${i}"></td>
      <td><input type="date" value="${r.dueDate || ''}" data-action="updField" data-module="Rfis" data-field="dueDate" data-idx="${i}" title="Response due"></td>
      <td><select data-action="updField" data-module="Rfis" data-field="status" data-idx="${i}" style="color:${statusColor(r.status)}">${['open','routed','responded','closed'].map(v => `<option ${r.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(r.ballInCourt || '')}" data-action="updField" data-module="Rfis" data-field="ballInCourt" data-idx="${i}" placeholder="Whose turn is it" title="Ball-in-court — whose turn to respond"></td>
      <td><input type="text" value="${U.escapeHtml(r.response || '')}" data-action="updField" data-module="Rfis" data-field="response" data-idx="${i}" style="min-width:140px" placeholder="Response / answer"></td>
      <td><button class="btn btn-s btn-d" data-action="delRfi" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Submittal Register (MARKET-FEATURE-ROADMAP C2) ----
  function renderSubmittals() {
    const s = S();
    if (!s) return;
    const body = $('sub-body');
    if (!body) return;
    const list = s.submittals || [];
    const approved = list.filter(x => x.status === 'approved' || x.status === 'approved-comments').length;
    const pending = list.filter(x => x.status === 'pending' || x.status === 'review').length;
    const sum = $('sub-sum');
    if (sum) sum.textContent = list.length ? (approved + ' approved · ' + pending + ' pending') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(10, 'No submittals yet.', '<button class="btn btn-g btn-s" data-action="addSubmittal">+ Add Submittal</button>');
      return;
    }
    const statusColor = (st) => st === 'approved' ? 'var(--green)' : st === 'approved-comments' ? 'var(--gold)' : st === 'rejected' ? 'var(--danger)' : 'var(--amber)';
    body.innerHTML = list.map((x, i) => `<tr>
      <td>${U.escapeHtml(x.number || x.id || 'S' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.item)}" data-action="updField" data-module="Submittals" data-field="item" data-idx="${i}" style="min-width:180px" placeholder="Material / shop drawing"></td>
      <td><input type="text" value="${U.escapeHtml(x.trade || '')}" data-action="updField" data-module="Submittals" data-field="trade" data-idx="${i}" placeholder="Trade"></td>
      <td><input type="text" value="${U.escapeHtml(x.submittedTo || '')}" data-action="updField" data-module="Submittals" data-field="submittedTo" data-idx="${i}" placeholder="Architect / engineer"></td>
      <td><input type="date" value="${x.dateSubmitted || ''}" data-action="updField" data-module="Submittals" data-field="dateSubmitted" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Submittals" data-field="status" data-idx="${i}" style="color:${statusColor(x.status)}">${['pending','review','approved','approved-comments','rejected'].map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="date" value="${x.responseDate || ''}" data-action="updField" data-module="Submittals" data-field="responseDate" data-idx="${i}" title="Response date"></td>
      <td><input type="text" value="${U.escapeHtml(x.ballInCourt || '')}" data-action="updField" data-module="Submittals" data-field="ballInCourt" data-idx="${i}" placeholder="Whose turn is it" title="Ball-in-court"></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Submittals" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delSubmittal" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Ball-in-court rollup (MARKET-FEATURE-ROADMAP C6) ----
  // Cross-module "whose turn is it" — every open RFI / submittal / issue
  // with the person whose action is awaited, sorted by due date.
  function renderBallInCourt() {
    const s = S();
    if (!s) return;
    const body = $('blc-body');
    if (!body) return;
    const list = (ns.BallInCourt && ns.BallInCourt.getBallInCourt)
      ? ns.BallInCourt.getBallInCourt() : [];
    const sum = $('blc-sum');
    if (sum) sum.textContent = list.length ? (list.length + ' items awaiting action') : '';
    if (list.length === 0) {
      body.innerHTML = '<div class="es" style="padding:14px;font-size:.78rem">Nothing awaiting action — every open item has a named next step or none is open.</div>';
      return;
    }
    const kindColor = (k) => k === 'RFI' ? 'var(--gold)' : k === 'Submittal' ? 'var(--cyan)' : 'var(--amber)';
    body.innerHTML = list.map((x) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
      <span class="badge" style="color:${kindColor(x.kind)};border-color:${kindColor(x.kind)}">${x.kind}</span>
      <span style="flex:1;font-size:.8rem">${U.escapeHtml(x.ref)} — ${U.escapeHtml(x.who)}${x.due ? ' <span style="color:var(--slate)">due ' + U.escapeHtml(x.due) + '</span>' : ''}</span>
    </div>`).join('');
  }

  // ---- Drawing Distribution Log (MARKET-FEATURE-ROADMAP C11) ----
  function renderDrawLog() {
    const s = S();
    if (!s) return;
    const body = $('drawlog-body');
    if (!body) return;
    const list = s.drawingLog || [];
    const sum = $('drawlog-sum');
    if (sum) sum.textContent = list.length ? (list.length + ' distributions') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(8, 'No drawing distributions logged yet.', '<button class="btn btn-g btn-s" data-action="addDrawLog">+ Add Distribution</button>');
      return;
    }
    body.innerHTML = list.map((x, i) => `<tr>
      <td>${U.escapeHtml(x.id || 'DL' + (i+1))}</td>
      <td><input type="date" value="${x.date || ''}" data-action="updField" data-module="DrawingLog" data-field="date" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(x.drawingNo)}" data-action="updField" data-module="DrawingLog" data-field="drawingNo" data-idx="${i}" style="min-width:100px" placeholder="Drawing no."></td>
      <td><input type="text" value="${U.escapeHtml(x.rev || '')}" data-action="updField" data-module="DrawingLog" data-field="rev" data-idx="${i}" style="width:50px" placeholder="Rev"></td>
      <td><input type="text" value="${U.escapeHtml(x.distributedTo || '')}" data-action="updField" data-module="DrawingLog" data-field="distributedTo" data-idx="${i}" style="min-width:120px" placeholder="Distributed to"></td>
      <td><select data-action="updField" data-module="DrawingLog" data-field="method" data-idx="${i}">${['Email','Print','Portal','Hand'].map(v => `<option ${x.method === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="DrawingLog" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delDrawLog" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Permit Register (MARKET-FEATURE-ROADMAP C30) ----
  function renderPermits() {
    const s = S();
    if (!s) return;
    const body = $('permit-body');
    if (!body) return;
    const list = s.permits || [];
    const sum = $('permit-sum');
    const active = list.filter(x => x.status === 'active').length;
    if (sum) sum.textContent = list.length ? (active + ' active') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No permits tracked yet.', '<button class="btn btn-g btn-s" data-action="addPermit">+ Add Permit</button>');
      return;
    }
    function dl(d) {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return Math.round((dt.getTime() - Date.now()) / 86400000);
    }
    const statusColor = (st) => st === 'active' ? 'var(--green)' : st === 'applied' ? 'var(--amber)' : st === 'expiring' ? 'var(--amber)' : st === 'expired' ? 'var(--danger)' : 'var(--slate)';
    body.innerHTML = list.map((x, i) => {
      const left = dl(x.expires);
      const expiryTxt = left === null ? '' : left < 0 ? ' <span style="color:var(--danger)">expired ' + Math.abs(left) + 'd ago</span>' : left <= 30 ? ' <span style="color:var(--amber)">' + left + 'd left</span>' : '';
      return `<tr>
      <td>${U.escapeHtml(x.id || 'PM' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.permitNo)}" data-action="updField" data-module="Permits" data-field="permitNo" data-idx="${i}" style="min-width:90px" placeholder="Permit no."></td>
      <td><input type="text" value="${U.escapeHtml(x.type || '')}" data-action="updField" data-module="Permits" data-field="type" data-idx="${i}" style="width:110px" placeholder="Type"></td>
      <td><input type="text" value="${U.escapeHtml(x.agency || '')}" data-action="updField" data-module="Permits" data-field="agency" data-idx="${i}" style="min-width:110px" placeholder="Agency"></td>
      <td><input type="date" value="${x.dateIssued || ''}" data-action="updField" data-module="Permits" data-field="dateIssued" data-idx="${i}"></td>
      <td><input type="date" value="${x.expires || ''}" data-action="updField" data-module="Permits" data-field="expires" data-idx="${i}">${expiryTxt}</td>
      <td><select data-action="updField" data-module="Permits" data-field="status" data-idx="${i}" style="color:${statusColor(x.status)}">${['applied','active','expiring','expired','closed'].map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Permits" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delPermit" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
  }

  function renderDocuments() {
    const s = S();
    if (!s) return;
    // RFI + Submittal registers render even when the document table is empty.
    renderRfis();
    renderSubmittals();
    // C6 rollup + C11 distribution log + C30 permit register (own state).
    renderBallInCourt();
    renderDrawLog();
    renderPermits();
    const body = $('doc-body');
    if (!body) return;
    const docs = s.documents || [];
    if (docs.length === 0) {
      body.innerHTML = emptyStateRow(10, 'No documents registered yet.', '<button class="btn btn-g btn-s" data-action="addDoc">+ Add Document</button>');
      return;
    }
    body.innerHTML = docs.map((d, i) => `<tr>
      <td>${U.escapeHtml(d.id || 'D' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(d.docNo || '')}" data-action="updField" data-module="Documents" data-field="docNo" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(d.title)}" data-action="updField" data-module="Documents" data-field="title" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Documents" data-field="type" data-idx="${i}">${['Drawing','Contract','Permit','Specification','Report','Other'].map(t => `<option ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input type="text" value="${d.version || ''}" data-action="updField" data-module="Documents" data-field="version" data-idx="${i}" style="width:50px"></td>
      <td><select data-action="updField" data-module="Documents" data-field="status" data-idx="${i}">${['current','pending-review','superseded','outstanding'].map(s => `<option ${d.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(d.responsible || '')}" data-action="updField" data-module="Documents" data-field="responsible" data-idx="${i}"></td>
      <td><input type="date" value="${d.dateIssued || ''}" data-action="updField" data-module="Documents" data-field="dateIssued" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(d.notes || '')}" data-action="updField" data-module="Documents" data-field="notes" data-idx="${i}"></td>
      <td><button class="btn btn-s btn-d" data-action="delDoc" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- DMAIC ----
  // Full interactive renderer lives in js/mmgr-dmaic.js (feature 8); this
  // Charter is data-filled from live state on every entry (no event binding),
  // so a shim keeps SECTION_RENDERERS wiring stable — switching back to the
  // Charter tab re-reads state, so linked KPIs show current values.
  // Safe to call on every renderAll: updCharter saves on each input keystroke,
  // so the refill always reads state that already contains the user's edits.
  function renderCharter() {
    if (ns.Charter && ns.Charter.loadCharterData) ns.Charter.loadCharterData();
  }

  // shim keeps SECTION_RENDERERS wiring stable.
  function renderDmaic() {
    if (ns.Dmaic && ns.Dmaic.render) ns.Dmaic.render();
  }

  // ---- Persistent toggle sync (monolith parity, boot-safe) ----
  // The Kanban lead-time lane + chip and the Gantt critical-highlighter chip
  // are persisted state, but they only re-render when their own section is
  // active. On a hard refresh landing on any other panel, the lane/chips
  // would silently disagree with state until the user visits Kanban/Gantt.
  // renderAll calls this so boot and every re-render are deterministic.
  function syncPersistentToggles() {
    const s = S();
    if (!s) return;
    const kbShow = !!s.kbShowLeadtime;
    const ltLane = $('col-leadtime');
    if (ltLane) ltLane.classList.toggle('is-hide', !kbShow);
    const ltChip = document.querySelector('[data-action="tglLeadtimeLane"]');
    if (ltChip) ltChip.classList.toggle('is-on', kbShow);
    const hlOn = !!s.hlCritical;
    document.body.classList.toggle('hl-critical', hlOn);
    const hlChip = document.querySelector('[data-action="toggleCritical"]');
    if (hlChip) hlChip.classList.toggle('is-on', hlOn);
  }

  // ---- Phase 2: feature flags (Controls drawer) ----
  // state.flags drives two things: the checkbox chips in the Controls tab
  // and the visibility of the corresponding optional UI. All flags default
  // on; a flag off hides its button/card via the existing is-hide class.
  function renderFlags() {
    const s = S();
    if (!s) return;
    const fl = s.flags || {};
    document.querySelectorAll('[data-action="tglFlag"]').forEach(function(chip) {
      const f = chip.getAttribute('data-flag');
      const on = !f || fl[f] !== false;
      chip.checked = on;
      chip.classList.toggle('is-on', on);
    });
    const gate = function(sel, flag) {
      document.querySelectorAll(sel).forEach(function(el) {
        el.classList.toggle('is-hide', fl[flag] === false);
      });
    };
    // MERGED-AI-CONTROL (audit 1.2): flags.aiWindow is gone. The fab and the
    // drawer AI switch now both follow state.config.ai.tier — one control,
    // one meaning. The fab is hidden only when the engine is fully off, so
    // the entry point can never disagree with the tier value.
    const aiCfg = (ns.AiWin && ns.AiWin.getAiCfg) ? ns.AiWin.getAiCfg() : null;
    const aiOn = aiCfg ? (aiCfg.tier || 'off') !== 'off' : false;
    document.querySelectorAll('#ai-fab').forEach(function(el) {
      el.classList.toggle('is-hide', !aiOn);
    });
    const aiChip = document.querySelector('[data-action="tglAiTier"]');
    if (aiChip) { aiChip.checked = aiOn; aiChip.classList.toggle('is-on', aiOn); }
    gate('[data-action="runMonteCarlo"]', 'monteCarlo');
    gate('[data-action="exportGanttPNG"]', 'ganttExport');
    gate('[data-action="tglLeadtimeLane"]', 'leadtimeLane');
    gate('#weather-forecast-card', 'weatherForecast');
    // Full gate for the lead-time lane itself: the flag OFF hides the lane
    // outright (even if kbShowLeadtime is true — otherwise the lane would
    // stay visible with no toggle control to hide it). When the flag is ON,
    // the lane stays driven by kbShowLeadtime exactly as before.
    if (fl.leadtimeLane === false) {
      const ltLane = $('col-leadtime');
      if (ltLane) ltLane.classList.add('is-hide');
    }
    // Phase 2: keep the Controls error surface in sync with state.
    if (ns.Errors && ns.Errors.render) ns.Errors.render();
  }

  // ---- Full Render ----
  // ---- Rank 3.1 (MASTER-ACTION-PLAN Rank 3.1): Core Mode vs Advanced Packs ----
  // Progressive disclosure: new projects start Core-only (Dashboard +
  // Definitions + Charter + WBS + Kanban). Every other section carries a
  // data-pack attribute and is hidden until its pack is toggled on. Existing
  // projects migrate with all packs ON (see mmgr-state.js migration 16) so
  // nothing disappears mid-project.
  const PACK_LABELS = {
    schedule: 'Schedule Science (Gantt / critical path / Monte Carlo)',
    money: 'Money (Budget / Resources / EVM)',
    governance: 'Governance (RACI / Risk / Changes / Log / Comms / Docs / Closure / Stakeholders / Claim)',
    field: 'Field (Meetings / Claim)',
    quality: 'Quality (DMAIC)'
  };
  const PACK_ORDER = ['schedule', 'money', 'governance', 'field', 'quality'];

  function packOfSection(sec) {
    const btn = document.querySelector('.sec-btn[data-section="' + sec + '"]');
    return btn ? btn.getAttribute('data-pack') : null;
  }

  // Hide/show every pack-gated nav button; if the currently active section
  // belongs to a pack that was just switched off, fall back to Dashboard so
  // the user is never stranded on a hidden panel.
  // NOTE (coordination): the DMAIC nav button is ALSO gated by methodology
  // (hybrid only, see renderMethodology). When its pack is ON we leave the
  // is-hide class alone so the methodology gate keeps ruling it; when the
  // pack is OFF we force-hide it. Same for any future dual-gated button.
  function renderPacks() {
    const s = S();
    if (!s) return;
    const packs = s.packs || {};
    document.querySelectorAll('.sec-btn[data-pack]').forEach(function(btn) {
      const pack = btn.getAttribute('data-pack');
      const on = packs[pack] !== false;
      // SIDEBAR-HAMBURGER-TOGGLE-PLAN: gate by the data attribute (carried by
      // the sidebar clones too) instead of the id (originals only), so the
      // desktop sidebar's DMAIC clone gets the same methodology-vs-pack split.
      const dualGated = btn.getAttribute('data-dual-gate') === '1';
      if (on && dualGated) return; // leave to the other gate (methodology)
      btn.classList.toggle('is-hide', !on);
    });
    const active = document.querySelector('.panel.active');
    if (active) {
      const sec = active.id.replace('panel-', '');
      const pack = packOfSection(sec);
      if (pack && packs[pack] === false) {
        showSection('dash', document.querySelector('.sec-btn[data-section="dash"]'));
      }
    }
    // DIR-3: pack state changed — re-evaluate the Core-Mode callout (toggling
    // a pack on hides it even if the user is inside the drawer, not the Dash).
    renderCoreCallout();
  }

  // ---- DIR-3 (PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE): Core-Mode onboarding
  // callout. Shown only while NO advanced pack is enabled AND none has EVER
  // been toggled on AND the user hasn't dismissed it. Toggling any pack on or
  // dismissing hides it forever (per-project state).
  function renderCoreCallout() {
    const s = S();
    const el = $('core-callout');
    if (!s || !el) return;
    const packs = s.packs || {};
    const anyOn = PACK_ORDER.some(function(p) { return packs[p] !== false; });
    const show = !anyOn && !s.packsEverEnabled && !s.packsCalloutDismissed;
    el.classList.toggle('is-hide', !show);
  }

  // ---- DIR-7a (PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE, DYNAMIC half): the
  // JS-rendered updField/updSpendEntry table inputs (Budget / Resources /
  // Changes / Risks / Issues / Comms / Log / Documents / Stakeholders /
  // CloseItems / spend log) carry no accessible name — the static a11y pass
  // can't reach them. This pass derives one from the column header + the
  // row's first text cell, e.g. "Planned, Demolition", and runs after every
  // section render. External accessible names (aria-label / title / label[for]
  // written without our marker) are skipped so static labels and future
  // per-field fixes are never clobbered — but labels THIS pass writes are
  // stamped data-a11y-auto="1" and refreshed on every pass, so an in-place
  // row update (task rename in one cell while a later column's input survives)
  // never leaves a stale derived label behind (review finding, 2026-08-11).
  function columnHeaderFor(row, inp) {
    const cells = Array.prototype.slice.call(row.cells || []);
    const idx = cells.findIndex(function(c) { return c.contains(inp); });
    if (idx < 0) return null;
    const table = row.closest('table');
    const thead = table && table.querySelector('thead');
    if (!thead) return null;
    const ths = thead.querySelectorAll('th');
    const th = ths[idx];
    if (!th) return null;
    const t = (th.textContent || '').replace(/\s+/g, ' ').trim();
    return t || null;
  }

  function rowLabelFor(row, inp) {
    const cells = Array.prototype.slice.call(row.cells || []);
    for (let c = 0; c < cells.length; c++) {
      if (cells[c].contains(inp)) continue; // never name a control after itself
      // A cell whose text lives in interactive children (a <select>'s option
      // list, an <input>'s value, a <button>'s label) is not a stable row
      // label — skip it and look for a plain text cell (row id, task name).
      if (cells[c].querySelector('input,select,textarea,button')) continue;
      const t = (cells[c].textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t.slice(0, 60);
    }
    return null;
  }

  function labelDynamicFields() {
    document.querySelectorAll(
      'input[data-action="updField"], select[data-action="updField"], ' +
      'input[data-action="updSpendEntry"], select[data-action="updSpendEntry"]'
    ).forEach(function(inp) {
      // Skip EXTERNAL accessible names only (truthy aria-label WITHOUT our
      // marker, or any title). A label this pass wrote itself carries
      // data-a11y-auto="1", so it is re-derived on the next pass instead of
      // going stale when the row's text changes in place. Truthy check on
      // aria-label keeps parity with verify-dynamic-labels' "named" rule and
      // the old behaviour: an empty-string aria-label is NOT a name and may
      // be (re)derived (review finding, 2026-08-11).
      const external = (inp.getAttribute('aria-label') && inp.getAttribute('data-a11y-auto') === null) || !!inp.getAttribute('title');
      if (external) return;
      const own = inp.getAttribute('data-a11y-auto') !== null;
      const setLabel = function(label) {
        inp.setAttribute('aria-label', label);
        inp.setAttribute('data-a11y-auto', '1');
      };
      const clearLabel = function() {
        inp.removeAttribute('aria-label');
        inp.removeAttribute('data-a11y-auto');
      };
      const id = inp.id;
      if (id && /^[A-Za-z][A-Za-z0-9:_-]*$/.test(id) && document.querySelector('label[for="' + id + '"]')) return;
      const row = inp.closest('tr');
      if (!row) {
        // Non-table row layouts (e.g. closure items render as flex rows): name
        // the control from its container's own non-interactive text (the item
        // label), never from buttons/inputs it sits beside.
        const container = inp.parentElement;
        if (!container) return;
        const clone = container.cloneNode(true);
        clone.querySelectorAll('input,select,textarea,button').forEach(function(n) { n.remove(); });
        const t = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) setLabel(t.slice(0, 80));
        else if (own) clearLabel(); // row lost its labelable text — drop the stale name
        return;
      }
      const parts = [];
      const th = columnHeaderFor(row, inp);
      if (th) parts.push(th);
      const rl = rowLabelFor(row, inp);
      if (rl) parts.push(rl);
      if (parts.length) setLabel(parts.join(', '));
      else if (own) clearLabel(); // nothing derivable now — drop the stale name
    });
  }

  // Sync the Controls drawer pack toggle chips with state.
  function syncPackChips() {
    const s = S();
    if (!s) return;
    const packs = s.packs || {};
    document.querySelectorAll('[data-action="tglPack"]').forEach(function(chip) {
      const p = chip.getAttribute('data-pack');
      const on = packs[p] !== false;
      chip.checked = on;
      chip.classList.toggle('is-on', on);
    });
  }

  function renderAll() {
    renderGreeting();
    renderMethodology();
    renderLock();
    renderDash();
    renderTimelineIndicator();
    renderDirtyIndicator();
    syncPersistentToggles();
    renderFlags();
    renderPacks();
    syncPackChips();
    // Re-render the currently active section so state changes show immediately
    const active = document.querySelector('.panel.active');
    if (active) {
      const renderer = SECTION_RENDERERS[active.id.replace('panel-', '')];
      if (renderer && renderer !== renderDash) renderer();
    }
    // DIR-7a: label any inputs the re-render just (re)created.
    labelDynamicFields();
    // DIR-2: the sticky nav's offset tracks the header's real height — the
    // greeting line changes height, so re-measure on every full render.
    if (ns.Viewport && ns.Viewport.syncHeaderStack) ns.Viewport.syncHeaderStack();
    // OWNER 2026-08-15: Controls-tab live previews (Copy As + Email Templates)
    // must mirror the current state — App is loaded after Render, so guard.
    if (window.MMGR && window.MMGR.App && window.MMGR.App.renderCtrlPreviews) {
      window.MMGR.App.renderCtrlPreviews();
    }
  }



  // ==================================================================
  // Phase C — Gantt interactions: drag-to-reschedule, clickable
  // dependency arrows, hover tooltip with float / weather padding.
  // ==================================================================
  let _ganttDrag = null; // { taskId, startX, origStartDate, origEndDate, minAllowed, moved }

  function ganttBarById(id) {
    const gc = $('gantt-chart');
    if (!gc) return null;
    const bars = gc.querySelectorAll('.gb');
    for (let i = 0; i < bars.length; i++) {
      if (bars[i].getAttribute('data-id') === id) return bars[i];
    }
    return null;
  }

  function ganttDragStart(e) {
    const bar = e.target.closest && e.target.closest('.gb');
    if (!bar || !_ganttMeta) return;
    // Baseline overlays are inert
    if (bar.classList.contains('gb-base')) return;
    const gc = $('gantt-chart');
    if (!gc || !gc.contains(bar)) return;
    const taskId = bar.getAttribute('data-id');
    const s = S();
    const task = (s.tasks || []).find(t => t.id === taskId);
    if (!task || task.isPhase) return;
    e.preventDefault();
    if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);

    // Earliest allowed start = max(predecessor end + 1, chart min date)
    let minAllowed = U.parseDL(_ganttMeta.minDate);
    (task.predecessors || []).forEach(predId => {
      const pred = (s.tasks || []).find(t => t.id === predId);
      if (pred && pred.endDate) {
        // May start on the next WORKING day after the predecessor finishes.
        const pef = U.addWorkingDays(U.parseDL(pred.endDate), 1);
        if (pef && pef > minAllowed) minAllowed = pef;
      }
    });

    _ganttDrag = {
      taskId: taskId,
      startX: e.clientX,
      origStartDate: task.startDate,
      origEndDate: task.endDate,
      minAllowed: minAllowed,
      moved: false
    };
    document.body.classList.add('gantt-dragging');
  }

  function ganttDragMove(e) {
    const d = _ganttDrag;
    if (!d || !_ganttMeta) return;
    const deltaDays = Math.round((e.clientX - d.startX) / _ganttMeta.dayWidth);
    if (!d.moved && deltaDays === 0) return;
    d.moved = true;
    const s = S();
    const task = (s.tasks || []).find(t => t.id === d.taskId);
    if (!task) return;
    // Preview in the SAME unit as the commit: working days. The bar moves
    // one work step per grid cell crossed and never lands on a non-working
    // day, so what you see during the drag is what you get on release.
    const rawStart = U.addWorkingDays(U.parseDL(d.origStartDate), deltaDays);
    const constrained = rawStart < d.minAllowed;
    const newStart = constrained ? d.minAllowed : rawStart;
    const dur = parseInt(task.duration) || 1;

    // Live preview: move the bar + redraw arrows without touching state
    const bar = ganttBarById(d.taskId);
    if (bar) {
      const left = Math.max(0, U.daysBetween(_ganttMeta.minDate, newStart)) * _ganttMeta.dayWidth;
      bar.style.left = left + 'px';
      bar.classList.toggle('gb-invalid', constrained);
      bar.setAttribute('data-preview-start', U.fmtDate(newStart));
    }
    const tip = $('gantt-tip');
    if (tip) {
      tip.classList.add('vis');
      tip.innerHTML = '<strong>' + U.escapeHtml(task.name) + '</strong><br>Start: ' + U.fmtDate(newStart) +
        (constrained ? '<br><span style="color:var(--danger)">Constrained by predecessor / chart start</span>' : '');
      positionGanttTip(e);
    }
    redrawGanttArrows();
  }

  function ganttDragEnd(e) {
    const d = _ganttDrag;
    _ganttDrag = null;
    document.body.classList.remove('gantt-dragging');
    const tip = $('gantt-tip');
    if (tip) tip.classList.remove('vis');
    if (!d || !d.moved) return;
    const s = S();
    const task = (s.tasks || []).find(t => t.id === d.taskId);
    if (!task) return;
    const bar = ganttBarById(d.taskId);
    const newStart = bar ? bar.getAttribute('data-preview-start') : null;
    if (!newStart || newStart === task.startDate) return;

    // Commit the drag as an undoable edit — this task only. A drag is a
    // deliberate single-task nudge; re-scheduling the whole plan stays an
    // explicit action (Cascade Dates) so one mis-click can never rewrite the
    // rest of the project.
    ns.State.pushUndo();
    const dur = parseInt(task.duration) || 1;
    ns.State.updateState(function(state) {
      const t = (state.tasks || []).find(x => x.id === d.taskId);
      if (t) {
        t.startDate = newStart;
        // Duration counts WORKING days (respects the work-week control).
        t.endDate = U.fmtDate(U.addWorkingDays(U.parseDL(newStart), dur - 1));
      }
    });
    // Refresh float / critical annotations READ-ONLY (dates untouched) so the
    // TF badges and CP markers stay honest after the single-task move. This
    // never rewrites the plan — a full re-schedule stays an explicit action.
    if (ns.Schedule && ns.Schedule.forwardPass && ns.Schedule.markCritical) {
      const fresh = (S().tasks || []).filter(x => x.startDate && x.endDate);
      let sc = ns.Schedule.forwardPass(fresh);
      sc = ns.Schedule.backwardPass(fresh, sc);
      sc = ns.Schedule.calcFloat(fresh, sc);
      ns.Schedule.markCritical(sc);
    }
    ns.Render.renderGantt();
    ns.Render.renderWbs();
    ns.Render.renderDash();
    if (ns.App && ns.App.showToast) {
      ns.App.showToast('Task moved to start ' + newStart + '.', 'ok');
    }
  }

  function removeDependency(predId, succId) {
    ns.State.pushUndo();
    ns.State.updateState(function(state) {
      const succ = (state.tasks || []).find(t => t.id === succId);
      if (succ && succ.predecessors) {
        succ.predecessors = succ.predecessors.filter(p => p !== predId);
      }
    });
    ns.Render.renderGantt();
    ns.Render.renderWbs();
    if (ns.App && ns.App.showToast) ns.App.showToast('Dependency removed.', 'ok');
  }

  function ganttTipFor(task) {
    const s = S();
    const region = (s && s.weatherRegion) || 'northern-temperate';
    let pad = 0;
    if (ns.Schedule && ns.Schedule.calculateWeatherBuffer) {
      pad = ns.Schedule.calculateWeatherBuffer(task, region, 5);
    }
    let html = '<strong>' + U.escapeHtml(task.name) + '</strong><br>';
    html += U.escapeHtml(task.startDate || '?') + ' to ' + U.escapeHtml(task.endDate || '?') + '<br>';
    html += 'Total float: ' + (task.totalFloat === null || task.totalFloat === undefined ? 'n/a' : task.totalFloat + 'd') + '<br>';
    html += 'Free float: ' + (task.freeFloat === null || task.freeFloat === undefined ? 'n/a' : task.freeFloat + 'd') + '<br>';
    const schedPad = (task._schedPad !== undefined && task._schedPad !== null) ? task._schedPad : (task.weatherSensitive ? pad : 0);
    html += 'Weather pad: ' + (task.weatherSensitive ? schedPad + 'd (weather-sensitive)' : 'none');
    return html;
  }

  function positionGanttTip(e) {
    const tip = $('gantt-tip');
    if (!tip) return;
    const x = Math.min(e.clientX + 14, window.innerWidth - 240);
    const y = Math.min(e.clientY + 14, window.innerHeight - 140);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  // Drag via pointer events (delegated, no inline handlers)
  document.addEventListener('pointerdown', function(e) {
    const gc = $('gantt-chart');
    if (gc && e.target.closest && e.target.closest('.gb') && gc.contains(e.target)) {
      ganttDragStart(e);
    }
  });
  document.addEventListener('pointermove', function(e) {
    if (_ganttDrag) ganttDragMove(e);
  });
  document.addEventListener('pointerup', function(e) {
    if (_ganttDrag) ganttDragEnd(e);
  });
  document.addEventListener('pointercancel', function() {
    if (_ganttDrag) {
      _ganttDrag = null;
      document.body.classList.remove('gantt-dragging');
      const tip = $('gantt-tip');
      if (tip) tip.classList.remove('vis');
      ns.Render.renderGantt();
    }
  });

  // Click a dependency arrow to edit / remove the link
  document.addEventListener('click', function(e) {
    const gc = $('gantt-chart');
    if (!gc) return;
    const link = e.target.closest && e.target.closest('.gan-link');
    if (!link || !gc.contains(link)) return;
    e.preventDefault();
    e.stopPropagation();
    const fromId = link.getAttribute('data-from');
    const toId = link.getAttribute('data-to');
    const s = S();
    const fromT = (s.tasks || []).find(t => t.id === fromId);
    const toT = (s.tasks || []).find(t => t.id === toId);
    const label = (fromT ? fromT.name : fromId) + ' → ' + (toT ? toT.name : toId);
    if (ns.App && ns.App.askConfirm) {
      ns.App.askConfirm({
        title: 'Dependency Link',
        message: 'Remove the dependency ' + label + '?',
        danger: true,
        confirmLabel: 'Remove Link',
        onOk: function() { removeDependency(fromId, toId); }
      });
    } else {
      removeDependency(fromId, toId);
    }
  });

  // Hover tooltip with float / weather pad info
  document.addEventListener('mouseover', function(e) {
    const bar = e.target.closest && e.target.closest('.gb');
    if (!bar || bar.classList.contains('gb-base')) return;
    const gc = $('gantt-chart');
    if (!gc || !gc.contains(bar)) return;
    const s = S();
    const task = (s.tasks || []).find(t => t.id === bar.getAttribute('data-id'));
    if (!task) return;
    const tip = $('gantt-tip');
    if (tip) {
      tip.innerHTML = ganttTipFor(task);
      tip.classList.add('vis');
    }
  }, true);

  document.addEventListener('mousemove', function(e) {
    const tip = $('gantt-tip');
    if (tip && tip.classList.contains('vis')) positionGanttTip(e);
  });

  document.addEventListener('mouseout', function(e) {
    const gc = $('gantt-chart');
    if (!gc) return;
    const bar = e.target.closest && e.target.closest('.gb');
    if (!bar) return;
    const rt = e.relatedTarget;
    if (!rt || !gc.contains(rt)) {
      const tip = $('gantt-tip');
      if (tip) tip.classList.remove('vis');
    }
  }, true);

  // ==================================================================
  // Phase F — Keyboard-first WBS: arrow navigation, Enter to edit name,
  // visible focus ring. Also click-to-select for mouse users.
  // ==================================================================
  function wbsRows() {
    const body = $('wbs-body');
    return body ? Array.prototype.slice.call(body.querySelectorAll('tr.wbs-row')) : [];
  }

  function selectWbsRow(row) {
    wbsRows().forEach(r => r.classList.remove('wbs-sel'));
    if (row) {
      row.classList.add('wbs-sel');
      row.setAttribute('tabindex', '0');
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function startWbsNameEdit(row) {
    // Read-only scope (view-only codes): the task name is a <span>, so it is
    // not covered by the input/select pointer-events guard — block renames
    // here for both the click and Enter paths before any mutation can happen.
    if (document.body.classList.contains('readonly-mode')) return;
    const id = row.getAttribute('data-id');
    const s = S();
    const task = (s.tasks || []).find(t => t.id === id);
    if (!task) return;
    const nameEl = row.querySelector('.wbs-name');
    if (!nameEl) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = task.name || '';
    input.className = 'wbs-name-input';
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = function() {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (val && val !== task.name && ns.Tasks && ns.Tasks.updTaskField) {
        ns.Tasks.updTaskField(id, 'name', val);
      } else {
        ns.Render.renderWbs();
      }
      // Re-select the row after re-render so the caret stays in the list
      requestAnimationFrame(() => {
        const rr = wbsRows().find(r => r.getAttribute('data-id') === id);
        if (rr) selectWbsRow(rr);
      });
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { done = true; ns.Render.renderWbs(); }
    });
  }

  document.addEventListener('keydown', function(e) {
    const body = $('wbs-body');
    if (!body || !body.contains(e.target)) return;
    if (e.target.closest && e.target.closest('input,select,textarea')) return; // native editing
    const rows = wbsRows();
    if (!rows.length) return;
    const idx = rows.indexOf(e.target.closest('tr'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (next >= 0 && next < rows.length) selectWbsRow(rows[next]);
    } else if (e.key === 'Enter') {
      if (idx >= 0 && e.target.tagName === 'TR') {
        e.preventDefault();
        startWbsNameEdit(rows[idx]);
      }
    }
  });

  document.addEventListener('click', function(e) {
    const body = $('wbs-body');
    if (!body || !body.contains(e.target)) return;
    if (e.target.closest && e.target.closest('input,select,button,a,svg')) return;
    // Click-to-edit the task name (mouse parity with the Enter-key path).
    const nameTarget = e.target.closest ? e.target.closest('.wbs-name') : null;
    if (nameTarget) {
      const nameRow = nameTarget.closest('tr.wbs-row');
      if (nameRow) { e.preventDefault(); startWbsNameEdit(nameRow); return; }
    }
    const row = e.target.closest('tr.wbs-row');
    if (row) selectWbsRow(row);
  });

  // Weather window inputs (dashboard card) — direct listeners, not
  // data-action (see updWxWindow comment). Bound lazily on the first panel
  // render so the card's inputs are always wired regardless of where or
  // when the scripts load; stub elements in tests simply no-op.
  let _wxBound = false;
  function bindWxInputs() {
    if (_wxBound) return;
    ['wx-start', 'wx-end'].forEach(function(id) {
      const el = $(id);
      if (el && el.addEventListener) el.addEventListener('change', updWxWindow);
    });
    const bfEl = $('wx-buffer');
    if (bfEl && bfEl.addEventListener) bfEl.addEventListener('change', updWxBuffer);
    const ldEl = $('wx-ld-rate');
    if (ldEl && ldEl.addEventListener) ldEl.addEventListener('change', updLdRate);
    _wxBound = true;
  }

  // ---- API ----
  ns.Render = {
    scheduleRender: scheduleRender,
    renderAll: renderAll,
    renderDash: renderDash,
    renderWbs: renderWbs,
    renderGantt: renderGantt,
    renderKanban: renderKanban,
    // RESTORE-1: risk matrix click-to-filter actions (view-only).
    riskMatrixCell: riskMatrixCell,
    clearRiskFilter: clearRiskFilter,
    // RESTORE-7: WBS schedule-issues banner toggle (view-only).
    toggleWbsIssues: toggleWbsIssues,
    renderWbsAlerts: renderWbsAlerts,
    renderRisks: renderRisks,
    renderResources: renderResources,
    renderBudget: renderBudget,
    renderStakeholders: renderStakeholders,
    renderChanges: renderChanges,
    renderLog: renderLog,
    renderClosure: renderClosure,
    renderPunchList: renderPunchList,
    renderRfis: renderRfis,
    renderSubmittals: renderSubmittals,
    renderRaci: renderRaci,
    renderRaciHeatmap: renderRaciHeatmap,
    renderComms: renderComms,
    renderDocuments: renderDocuments,
    renderDmaic: renderDmaic,
    renderDefs: renderDefs,
    renderMeetingsPanel: renderMeetingsPanel,
    renderTodayView: renderTodayView,
    renderLookahead: renderLookahead,
    renderPpc: renderPpc,
    renderMilestoneTimeline: renderMilestoneTimeline,
    computeTimelineStatus: computeTimelineStatus,
    renderTimelineStatus: renderTimelineStatus,
    showSection: showSection,
    renderGreeting: renderGreeting,
    renderMethodology: renderMethodology,
    renderLock: renderLock,
    renderTimelineIndicator: renderTimelineIndicator,
    renderDirtyIndicator: renderDirtyIndicator,
    computeAgingActions: computeAgingActions,
    renderActionAging: renderActionAging,
    renderStreak: renderStreak,
    computeBaselineNarrative: computeBaselineNarrative,
    renderBaselineNarrative: renderBaselineNarrative,
    renderSafetyBanner: renderSafetyBanner,
    renderWeatherForecast: renderWeatherForecast,
    renderWeatherLog: renderWeatherLog,
    renderClaimPanel: renderClaimPanel,
    renderLeadtimeTracker: renderLeadtimeTracker,
    renderFloatWatch: renderFloatWatch,
    renderWeatherVariance: renderWeatherVariance,
    renderScheduleConfidence: renderScheduleConfidence,
    syncPersistentToggles: syncPersistentToggles,
    renderFlags: renderFlags,
    updWxWindow: updWxWindow,
    updWxBuffer: updWxBuffer,
    updLdRate: updLdRate,
    crashCandidates: crashCandidates,
    getNearCritical: getNearCritical,
    parseImpactDays: parseImpactDays,
    parseImpactCost: parseImpactCost,
    riskExposure: riskExposure,
    contingencyTotal: contingencyTotal,
    // Rank 3.1 (Core Mode vs Advanced Packs)
    PACK_LABELS: PACK_LABELS,
    PACK_ORDER: PACK_ORDER,
    renderPacks: renderPacks,
    syncPackChips: syncPackChips,
    // DIR-3: Core-Mode onboarding callout visibility.
    renderCoreCallout: renderCoreCallout,
    // DIR-7a (dynamic half): accessible names for rendered table inputs.
    labelDynamicFields: labelDynamicFields
  };
})(MMGR);
window.MMGR = MMGR;