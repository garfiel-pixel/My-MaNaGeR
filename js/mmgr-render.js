/* ============================================================
   My MaNaGeR, Rendering Engine
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
  // time-of-day-only message, destroying the name on every render (this is
  // why the personalized greeting never appeared). Now the icon (time of
  // day) + text (time label + name suffix) are composed ONCE and written as
  // a single innerHTML assignment. The name is escapeHtml because it is
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
    // id, the sidebar mirrors the same visibility by construction.
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
    // Glass §5: the Lock button is a binary chip, solid when locked.
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

    // Ring (STRUCTURAL-IA §1: brand-new project != 0%, quiet the empty zero)
    // circ = 2pi*r with r=39, matches the ring markup (thicker 18px stroke,
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
    // Stakeholders nav-badge count stays fresh, the nav pill must reflect
    // compliance even before the Stakeholders section is ever opened.
    const stkCmp = (ns.Stakeholders && ns.Stakeholders.getExpiringCompliance)
      ? ns.Stakeholders.getExpiringCompliance(s.stakeholders || [], 30).length
      : 0;
    syncStakeComplianceBadges(stkCmp);
    // §4 tiering: a non-zero Blocked/Overdue/Live-Issues count gets the
    // strongest static treatment, existing --danger token, no motion.
    const healthCard = $('health-card');
    if (healthCard) {
      healthCard.classList.toggle('has-danger', blocked > 0 || overdue > 0 || issues > 0);
      // §1: brand-new project, quiet the zero badges too.
      healthCard.classList.toggle('health-empty', total === 0);
    }

    // Next 3 priority actions
    const n3 = $('n3');
    if (n3) {
      if (total === 0) {
        // STRUCTURAL-IA §1: a brand-new project (no tasks at all) is NOT the
        // same state as "all tasks complete", give it a real empty state.
        n3.innerHTML = '<li class="txt-sl">No tasks yet, add your first task to see prioritized next steps.</li>' +
          '<li class="txt-sl"><button class="btn btn-g btn-s" data-action="showSec" data-section="wbs">+ Add Task</button></li>';
      } else if (done === total) {
        n3.innerHTML = `<li class="n3-done"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check-circle"></use></svg> ${done} of ${total} tasks complete, nothing pending.</li>`;
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
        // break the 33px row rhythm, at any sidebar width (OWNER 2026-08-15
        // sidebar-only view narrowed the content column).
        n3.innerHTML = sorted.map(t => `<li><span title="${U.escapeHtml(t.name)}">${U.escapeHtml(t.name)}${t.critical ? ' <svg class="ico" aria-hidden="true" style="color:var(--gold)"><use href="css/mmgr-icons.svg#i-target"></use></svg>' : ''}${t.endDate ? ', due ' + U.fmtDateShort(t.endDate) : ''}</span></li>`).join('');
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
        budEl.textContent = '';
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
      if (bud.length === 0) budSub.innerHTML = 'No budget lines yet, add one in Budget';
      else budSub.textContent = `Planned: $${planned.toLocaleString()} | Actual: $${actual.toLocaleString()}`;
    }

    // Resource Utilization
    const resources = s.resources || [];
    const avgUtil = resources.length ? Math.round(resources.reduce((sum, r) => sum + (ns.Resources && ns.Resources.resUtil ? ns.Resources.resUtil(r) : (+r.utilization || 0)), 0) / resources.length) : 0;
    const utilEl = $('dw-util');
    const utilCard = $('dw-util-card');
    if (utilEl) {
      if (resources.length === 0) {
        utilEl.textContent = '';
        utilEl.style.color = 'var(--slate)';
        if (utilCard) utilCard.classList.add('tier3');
      } else {
        utilEl.textContent = avgUtil + '%';
        utilEl.style.color = '';
        if (utilCard) utilCard.classList.remove('tier3');
      }
    }
    setVal('dw-util-sub', resources.length ? `Avg across ${resources.length} resources` : 'No resources added, add them in Resources');

    // Pending Changes
    const changes = s.changes || [];
    const pending = changes.filter(c => c.status === 'submitted' || c.status === 'review').length;
    const chgEl = $('dw-chg');
    const chgCard = $('dw-chg-card');
    if (chgEl) {
      if (changes.length === 0) {
        chgEl.textContent = '';
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
      baseEl.textContent = '';
      baseEl.style.color = 'var(--slate)';
      if (baseSub) baseSub.textContent = 'No baseline saved, use Save Baseline in Settings';
      if (baseCard) baseCard.classList.add('tier3');
    }

    // Baseline variance table, schedule days per task + overall cost delta
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
            '<tr><td>' + U.escapeHtml(r.name) + '</td><td>' + U.escapeHtml(r.bEnd || '') + '</td><td>' + U.escapeHtml(r.cEnd || '') + '</td>' +
            '<td style="' + (r.schedVar === null ? '' : (r.schedVar > 0 ? 'color:var(--danger)' : r.schedVar < 0 ? 'color:var(--green)' : '')) + '">' +
            (r.schedVar === null ? '' : (r.schedVar > 0 ? '+' + r.schedVar + 'd' : r.schedVar + 'd')) + '</td></tr>'
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

    // Health Score (feature 1), must be cheap; renders only its own card.
    if (ns.Health && ns.Health.render) ns.Health.render();
    // DMAIC progress signal (visible only while DMAIC is active)
    if (ns.Dmaic && ns.Dmaic.renderSignal) ns.Dmaic.renderSignal();
    // EVM (feature 4)
    if (ns.Evm && ns.Evm.render) ns.Evm.render();
    // Defer non-critical below-the-fold sub-renderers so the initial paint
    // lands fast. requestAnimationFrame yields to the browser's paint cycle
    // before running the analytics panels (Today's Focus, Lookahead, PPC,
    // Decision Engine, Lead-Time, Weather, Meetings, Digest, etc.).
    requestAnimationFrame(function() {
      // Today's Focus (feature 10)
      renderTodayView();
      // MARKET-FEATURE-ROADMAP C7/C8: 2-week Lookahead + Percent Plan Complete
      renderLookahead();
      renderPpc();
      // MARKET-FEATURE-ROADMAP C29: expiry & renewal rollup card.
      renderExpiryCard();
      // Today's Decision Engine (ACTION-PLAN 1.1), impact-scored ranking
      if (ns.Decisions && ns.Decisions.render) ns.Decisions.render();
      // Milestone Timeline + Timeline Target status (feature 11)
      renderMilestoneTimeline();
      renderTimelineStatus();
      // V3.3/V3.5 secondary panels (monolith port), Lead-Time Tracker,
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
      // Rank 2: Weekly/Daily Digest Engine, 'What Changed' diff + snapshot
      if (ns.Digest && ns.Digest.render) ns.Digest.render();
    });
  }

  // ---- Today's Focus View (MONOLITH-PORTING-GUIDE feature 10) ----
  // Tasks active today, due today, due this week, or in progress, at a
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
  // next 2 weeks (plus overdue carryover), grouped by week, distinct from
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
        <div><span class="tf-name">${U.escapeHtml(t.name)}</span><span class="tf-due">${t.startDate ? U.fmtDateShort(t.startDate) : '?'} -> ${t.endDate ? U.fmtDateShort(t.endDate) : '?'}${t.assignee ? ' · ' + U.escapeHtml(t.assignee) : ''}${t.weatherExposed ? ' <svg class="ico" aria-hidden="true" style="color:var(--blue)"><use href="css/mmgr-icons.svg#i-cloud"></use></svg>' : ''}</span></div>
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
    el.innerHTML = content || '<div class="es" style="padding:14px;font-size:.78rem">No tasks starting or finishing in the next 2 weeks, the schedule ahead is clear.</div>';
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
      if (now.planned === 0) head.textContent = 'No tasks planned to finish this week, add end dates to schedule work.';
      else head.textContent = now.completed + ' of ' + now.planned + ' tasks planned this week completed (' + now.pct + '%)';
    }
    const overdue = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
    const bars = hist.map(h => {
      const lbl = h.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const pct = h.pct === null ? 0 : h.pct;
      const w = h.planned ? pct : 2;
      const col = h.pct === null ? 'var(--border)' : pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--danger)';
      return `<div class="ppc-bar-row"><span class="ppc-bar-lbl">${lbl}</span><div class="ppc-bar-track"><div class="ppc-bar-fill" style="width:${Math.max(2, w)}%;background:${col}"></div></div><span class="ppc-bar-val">${h.pct === null ? '' : pct + '%'}${h.planned ? ' (' + h.completed + '/' + h.planned + ')' : ''}</span></div>`;
    }).join('');
    el.innerHTML = `<div class="ppc-now">${now.planned ? `<span class="stat-xl" style="font-size:1.6rem;color:${now.pct >= 80 ? 'var(--green)' : now.pct >= 50 ? 'var(--amber)' : 'var(--danger)'}">${now.pct}%</span>` : '<span class="stat-xl" style="font-size:1.2rem;color:var(--slate)"></span>'}</div>` +
      '<div class="ppc-bars">' + bars + '</div>' +
      (overdue ? `<div class="ppc-note"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> ${overdue} task${overdue === 1 ? ' is' : 's are'} overdue from earlier weeks.</div>` : '') +
      '<div class="ppc-basis">Basis: tasks whose end date falls in each week, by completion status.</div>';
  }

  // Safe wrapper, computePpc lives on Schedule; never let a missing module
  // kill the dashboard render.
  function computePpcSafe(tasks, offset) {
    if (ns.Schedule && ns.Schedule.computePpc) return ns.Schedule.computePpc(tasks, offset);
    return { planned: 0, completed: 0, pct: null, start: new Date(), end: new Date() };
  }

  // ---- Expiry & Renewals dashboard card (MARKET-FEATURE-ROADMAP C29) ----
  // Single rollup across COI/license/EMR, warranties, and permits, anything
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
    else if (overrunDays <= 14) { status = `At Risk, ${overrunDays}d over target`; cls = 'ba'; }
    else { status = `Over Target, ${overrunDays}d over`; cls = 'br'; }
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
        hdrBadge.textContent = (t.overrunDays <= 14 ? 'At risk, ' : 'Over, ') + t.overrunDays + 'd over target';
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
  // Variance, Schedule Confidence, exact ports of the monolith
  // renderLeadtimeTracker / renderFloatWatch / renderWeatherVariance /
  // renderScheduleConfidence, rewritten against the modular field names
  // (startDate/endDate, totalFloat/floatBaseline, leadTime) and the CSS
  // class system instead of inline styles.
  // ==================================================================

  // ---- Weather rendering ---- (extracted to js/render/weather.js)
  function getNearCritical() { return ns.RenderWeather ? ns.RenderWeather.getNearCritical() : []; }
  function crashCandidates() { return ns.RenderWeather ? ns.RenderWeather.crashCandidates() : []; }

  // ---- Lead-Time Tracker (monolith renderLeadtimeTracker) ----
  // Lead-time tasks tracked by Submitted/Expected dates instead of % done:
  // days remaining (or overdue) vs the Expected Date.
  // ---- Weather rendering ---- (extracted to js/render/weather.js)
  function renderLeadtimeTracker() { if (ns.RenderWeather) ns.RenderWeather.renderLeadtimeTracker(); }
  function renderFloatWatch() { if (ns.RenderWeather) ns.RenderWeather.renderFloatWatch(); }
  function renderWeatherVariance() { if (ns.RenderWeather) ns.RenderWeather.renderWeatherVariance(); }
  function updWxWindow() { if (ns.RenderWeather) ns.RenderWeather.updWxWindow(); }
  function updWxBuffer() { if (ns.RenderWeather) ns.RenderWeather.updWxBuffer(); }
  function updLdRate() { if (ns.RenderWeather) ns.RenderWeather.updLdRate(); }
  function renderScheduleConfidence() { if (ns.RenderWeather) ns.RenderWeather.renderScheduleConfidence(); }
  function renderWeatherForecast() { if (ns.RenderWeather) ns.RenderWeather.renderWeatherForecast(); }
  function renderWeatherLog() { if (ns.RenderWeather) ns.RenderWeather.renderWeatherLog(); }
  function renderSafetyBanner() { if (ns.RenderWeather) ns.RenderWeather.renderSafetyBanner(); }

  // ==================================================================
  // ACTION-PLAN Phase 3, retention, professional and non-blocking
  // ------------------------------------------------------------------
  // 3.1 Action-item aging (escalating visibility), 3.4 weekly baseline
  // narrative. 3.3 streak lives in state; both surfaces below are
  // read-only analytics over live state, additive only, never gate core
  // paths.
  // ==================================================================

  // ---- 3.1 Action-item aging ----
  // Collects every OPEN action item from the live data: meeting promises
  // carried forward, comms-log action items (with their follow-up date
  // when set), and decision-log action items. Each is aged from its due
  // date (or creation date when no due date exists) and gets escalating
  // visibility: amber at ≤7d overdue, red 8-21d, bold red beyond 21d.
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
    return { cls: 'br', label: age + 'd, STALE', stale: true };
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
  // gates any core path. Client-side state, no server round-trip.
  function renderStreak() {
    const el = $('streak-body');
    if (!el) return;
    const s = S();
    const st = (s && s.streak) || { count: 0, lastDate: null };
    const count = st.count || 0;
    const last = st.lastDate ? String(st.lastDate) : null;
    el.innerHTML = '<div class="stk-row"><div class="stk-num">' + count + (count === 1 ? ' day' : ' days') + '</div>' +
      '<div class="stk-meta">consecutive working days on this project' + (last ? ' · last activity ' + U.escapeHtml(last) : '') + '</div></div>' +
      (count === 0 ? '<div class="stk-hint">The streak builds quietly as you update the plan, no pressure, no fuss.</div>' : '');
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
      sentences.push(slipped.length + ' task' + (slipped.length > 1 ? 's' : '') + ' slipped by an average of ' + Math.round(total / slipped.length) + 'd since baseline' + (slipped[0] ? ', worst: ' + slipped[0].name + ' (+' + slipped[0].days + 'd)' : '') + '.');
    }
    if (gained.length) {
      const total = gained.reduce((n, t) => n + t.days, 0);
      sentences.push(gained.length + ' task' + (gained.length > 1 ? 's' : '') + ' pulled in by an average of ' + Math.round(total / gained.length) + 'd.');
    }
    // Scope drift
    const added = cur.filter(t => !baseMap[t.id]);
    const removed = base.filter(t => !curMap[t.id]);
    if (added.length) sentences.push(added.length + ' task' + (added.length > 1 ? 's' : '') + ' added since baseline (' + added.slice(0, 3).map(t => t.name).join(', ') + (added.length > 3 ? '...' : '') + ').');
    if (removed.length) sentences.push(removed.length + ' task' + (removed.length > 1 ? 's' : '') + ' removed since baseline.');
    // Completion movement
    const baseDone = base.filter(t => t.status === 'completed').length;
    const curDone = cur.filter(t => t.status === 'completed').length;
    if (curDone !== baseDone) sentences.push('Completed tasks moved from ' + baseDone + ' to ' + curDone + ' since baseline.');
    // Cost movement (planned $ only, actuals are live, not baseline)
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
  //   1. Cloud-linked (Cloud.getCode()) -> GREEN "Cloud backed up" chip
  //      the durable backup lives in the cloud and auto-syncs as the user
  //      works, so the alarming amber state is replaced entirely. Casual
  //      users who just add a task no longer get the "huh?" trigger.
  //   2. Not linked + never file-backed-up -> amber "Not backed up", with
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
      ind.setAttribute('title', 'This project is backed up to the cloud, snapshots auto-sync as you work. Click for backup options (cloud or a portable .json file).');
    } else {
      ind.classList.remove('ci-cloud');
      backedUp = !!(s.lastBackedUpAt && s.updatedAt && s.lastBackedUpAt >= s.updatedAt);
      if (!backedUp) {
        ind.classList.add('on');
        ind.innerHTML = 'Not backed up';
        ind.setAttribute('title', 'Your changes are safe in this browser (autosave). A file backup is optional, save one whenever you\'re ready, e.g. at the end of a task. Click for backup options.');
      } else {
        ind.classList.remove('on');
        ind.innerHTML = 'Not backed up';
        ind.setAttribute('title', 'Changes save to this browser automatically. Click for backup options (cloud or a .json file).');
      }
    }
    // Backup popover footer (OWNER 2026-08-15).
    const foot = $('bk-foot');
    if (foot) {
      foot.textContent = linked
        ? 'Cloud backup active, a .json file copy is optional (e.g. to keep in your file manager).'
        : (backedUp && s.lastBackedUpAt
          ? 'Last file backup: ' + new Date(s.lastBackedUpAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '.'
          : 'No file backup yet, autosave keeps your changes on this device.');
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

  // Meetings panel (MEETING_TRACKING_SPEC), delegates to the Meetings module.
  function renderMeetingsPanel() {
    if (ns.Meetings && ns.Meetings.renderMeetings) ns.Meetings.renderMeetings();
  }

  // Claim Pack panel (MASTER-ACTION-PLAN-v3-STRICT Rank 1), delegates to the
  // Claim module (slips cause tags, package preview).
  function renderClaimPanel() {
    if (ns.Claim && ns.Claim.render) ns.Claim.render();
  }

  function showSection(section, btn) {
    // EDITOR-SCOPE (mmgr-cloud.js applyEditorScope/isSectionBlocked): a scoped
    // editor code must not open a writable section outside its grant. The nav
    // grey-out (pointer-events:none + disabled) blocks mouse and keyboard on
    // the buttons, but in-panel jump buttons (empty-state "+ Add Task" calls
    // data-action=showSec) and any direct showSection call would bypass it
    // guard the switch itself so every path is blocked, not just the nav.
    // View-only panels (dash/def/kan/gantt/claim/digest/baselinen/wxlog) are
    // never blocked; the server also enforces the scope on every save (B11).
    if (window.MMGR && window.MMGR.Cloud && window.MMGR.Cloud.isSectionBlocked && window.MMGR.Cloud.isSectionBlocked(section)) {
      if (ns.App && ns.App.showToast) ns.App.showToast('That section is outside this editor code\'s scope. Locked.', 'warn');
      return;
    }
    // PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE DIR-2: every section switch
    // starts from a consistent top position, a carried-over scroll offset
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
    // Rank 3.4: viewport-aware layout detection, offer the one-time
    // simplified-view prompt for dense sections on narrow screens.
    if (ns.Viewport && ns.Viewport.maybePrompt) ns.Viewport.maybePrompt(section);
    // PLAN-OF-ACTION-LIQUID-GLASS-UI §2: the SAME detection signal also
    // drives the glass engine choice, one signal, two consumers (layout
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
    // Semantics: defExpanded[id] === false  ->  phase is collapsed (true/undefined = expanded).
    const collapsedIds = new Set();
    Object.keys(defExpanded).forEach(id => { if (defExpanded[id] === false) collapsedIds.add(id); });
    // 2.1 dependency-aware risk propagation: any task with an overdue
    // predecessor is downstream of a slip, flagged inline, live.
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
          <button class="cbtn ${isPhase ? '' : 'cls'}" data-action="tglPhase" data-id="${U.escapeHtml(t.id)}">&#9660;</button>
          <span class="wbs-name">${U.escapeHtml(t.name)}</span>
          <label class="wb-milestone" title="Mark as Milestone"><input type="checkbox" ${t.milestone ? 'checked' : ''} data-action="tglMilestone" data-id="${U.escapeHtml(t.id)}"> <svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-flag"></use></svg></label>
          ${t.critical ? '<span class="badge bo" style="font-size:.6rem;padding:1px 4px;margin-left:4px">CP</span>' : ''}
          ${chainRisk ? '<span class="badge br" style="font-size:.6rem;padding:1px 4px;margin-left:4px" title="A predecessor is overdue, this downstream chain is at risk (2.1)">CHAIN</span>' : ''}
          ${t.leadTime ? '<span class="tt-lead-badge">LT</span>' : ''}
          ${t.recurring ? '<span class="tt-rec-badge"><svg class="ico" aria-hidden="true" style="font-size:.6rem"><use href="css/mmgr-icons.svg#i-refresh"></use></svg></span>' : ''}
          ${t.weatherExposed ? '<svg class="ico" aria-hidden="true" style="color:#38bdf8;font-size:.7rem" title="Weather-exposed"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg>' : ''}
        </td>
        <td><input type="text" value="${U.escapeHtml(t.assignee || '')}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="assignee" placeholder="--"></td>
        ${t.leadTime
          ? `<td><label class="wbs-lt-lbl">Submitted</label><input type="date" value="${t.submittedDate || ''}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="submittedDate"></td>
             <td><label class="wbs-lt-lbl">Expected</label><input type="date" value="${t.expectedDate || ''}" data-action="updTaskField" data-id="${U.escapeHtml(t.id)}" data-field="expectedDate"></td>
             <td><span class="wbs-lt-note">Lead-time task, tracked by dates, not % done</span></td>`
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
          <button class="btn btn-s ${t.weatherSensitive ? 'btn-wx' : 'btn-n'}" data-action="tglWeather" data-id="${U.escapeHtml(t.id)}" title="${t.weatherSensitive ? 'Weather-sensitive, buffer added for regional windows during cascade' : 'Mark weather-sensitive, adds selective buffer for regional windows during cascade'}" style="padding:5px 8px"><svg class="ico" aria-hidden="true" style="font-size:.62rem"><use href="css/mmgr-icons.svg#i-cloud-rain"></use></svg></button>
          <button class="btn btn-s ${t.leadTime ? 'btn-lt' : 'btn-n'}" data-action="tglLeadTime" data-id="${U.escapeHtml(t.id)}" title="${t.leadTime ? 'Lead-Time, tracked by Submitted/Expected dates (click to unmark)' : 'Mark as Lead-Time, vendor/third-party wait tracked by Submitted/Expected dates (procurement, permits, deliveries)'}" style="padding:5px 8px"><svg class="ico" aria-hidden="true" style="font-size:.62rem"><use href="css/mmgr-icons.svg#i-clock"></use></svg></button>
          <button class="btn btn-s btn-n" data-action="indentTask" data-id="${U.escapeHtml(t.id)}" title="Indent">&rarr;</button>
          <button class="btn btn-s btn-n" data-action="outdentTask" data-id="${U.escapeHtml(t.id)}" title="Outdent">&larr;</button>
          <button class="btn btn-s btn-d" data-action="delTask" data-id="${U.escapeHtml(t.id)}" title="Delete">&times;</button>
        </td>
      </tr>`;
    }).join('');
  }

  // ---- WBS Schedule-Issues Banner (RESTORE-7) ----
  // Surfaces lightweight schedule-health warnings above the WBS table:
  // circular predecessors, orphan tasks (no predecessor in a project that
  // has dependencies), and tasks with identical IDs.  Non-blocking,
  // read-only, the banner is informational and can be toggled off.
  let _wbsIssuesVisible = true;
  function renderWbsAlerts() {
    const el = $('wbs-alerts');
    if (!el) return;
    const s = S();
    if (!s || !s.tasks || s.tasks.length === 0) { el.innerHTML = ''; return; }
    if (!_wbsIssuesVisible) { el.innerHTML = ''; return; }
    const alerts = [];
    // Circular predecessors
    const cycles = (ns.Schedule && ns.Schedule.findCycles) ? ns.Schedule.findCycles(s.tasks) : [];
    if (cycles.length) {
      alerts.push('<div class="wbs-alert-item"><svg class="ico" aria-hidden="true" style="color:var(--danger)"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> ' + cycles.length + ' circular predecessor chain' + (cycles.length > 1 ? 's' : '') + ' detected. Break a dependency to restore a valid schedule.</div>');
    }
    // Duplicate IDs
    const ids = {};
    let dupCount = 0;
    s.tasks.forEach(function (t) { if (ids[t.id]) dupCount++; ids[t.id] = true; });
    if (dupCount) {
      alerts.push('<div class="wbs-alert-item"><svg class="ico" aria-hidden="true" style="color:var(--amber)"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> ' + dupCount + ' duplicate task ID' + (dupCount > 1 ? 's' : '') + '. Check WBS for naming conflicts.</div>');
    }
    el.innerHTML = alerts.join('');
  }
  function toggleWbsIssues() {
    _wbsIssuesVisible = !_wbsIssuesVisible;
    renderWbsAlerts();
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
    // chain is dimmed via body.hl-critical, gold stays on the critical bars.
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

    // Remove any previous overlay FIRST, repeated renders/cascades must
    // never stack multiple SVGs.
    const oldArrows = gc.querySelector('.gantt-arrows');
    if (oldArrows) oldArrows.remove();

    // When the Gantt panel is hidden, rects are all zeros, skip the overlay;
    // renderGantt redraws arrows the next time the section is shown.
    if (!gc.offsetParent) return;

    // Only draw if there are predecessor links
    const hasPreds = tasks.some(t => t.predecessors && t.predecessors.length);
    if (!hasPreds) return;

    const bars = gc.querySelectorAll('.gb');
    if (!bars.length) return;

    // Map task id -> bar element (attribute lookup, no selector escaping)
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
  // ---- Kanban ---- (extracted to js/render/kanban.js)
  function kanbanCard(t) { return ns.RenderKanban ? ns.RenderKanban.kanbanCard(t) : ""; }
  function kanbanLeadtimeCard(t) { return ns.RenderKanban ? ns.RenderKanban.kanbanLeadtimeCard(t) : ""; }
  function renderKanban() { if (ns.RenderKanban) ns.RenderKanban.renderKanban(); }

  // ---- Risks ---- (extracted to js/render/risks.js)
  function parseImpactDays(text) { return ns.RenderRisks ? ns.RenderRisks.parseImpactDays(text) : 0; }
  function parseImpactCost(text) { return ns.RenderRisks ? ns.RenderRisks.parseImpactCost(text) : 0; }
  function riskExposure(state) { return ns.RenderRisks ? ns.RenderRisks.riskExposure(state) : 0; }
  function contingencyTotal(state) { return ns.RenderRisks ? ns.RenderRisks.contingencyTotal(state) : 0; }
  function riskMatrixCell(prob, imp) { if (ns.RenderRisks) ns.RenderRisks.riskMatrixCell(prob, imp); }
  function clearRiskFilter() { if (ns.RenderRisks) ns.RenderRisks.clearRiskFilter(); }
  function renderRiskMatrix() { if (ns.RenderRisks) ns.RenderRisks.renderRiskMatrix(); }
  function renderRisks() { if (ns.RenderRisks) ns.RenderRisks.renderRisks(); }

  // ---- Resources ---- (extracted to js/render/resources.js)
  function renderResources() { if (ns.RenderResources) ns.RenderResources.renderResources(); }
  function renderResourceLeveling() { if (ns.RenderResources) ns.RenderResources.renderResourceLeveling(); }

  // ---- Financials ---- (extracted to js/render/financials.js)
  function fmt$(n) { return ns.RenderFinancials ? ns.RenderFinancials.fmt$(n) : ""; }
  function renderSpendLog() { if (ns.RenderFinancials) ns.RenderFinancials.renderSpendLog(); }
  function renderCashFlowChart() { if (ns.RenderFinancials) ns.RenderFinancials.renderCashFlowChart(); }
  function renderBudget() { if (ns.RenderFinancials) ns.RenderFinancials.renderBudget(); }
  function renderPayApps() { if (ns.RenderFinancials) ns.RenderFinancials.renderPayApps(); }

  // ---- People ---- (extracted to js/render/people.js)
  function renderStakeholders() { if (ns.RenderPeople) ns.RenderPeople.renderStakeholders(); }
  function syncStakeComplianceBadges(count) { if (ns.RenderPeople) ns.RenderPeople.syncStakeComplianceBadges(count); }
  function renderChanges() { if (ns.RenderPeople) ns.RenderPeople.renderChanges(); }
  function renderLog() { if (ns.RenderPeople) ns.RenderPeople.renderLog(); }

  // ---- Closure ---- (extracted to js/render/closure.js)
  function renderPunchList() { if (ns.RenderClosure) ns.RenderClosure.renderPunchList(); }
  function renderHandover() { if (ns.RenderClosure) ns.RenderClosure.renderHandover(); }
  function renderWarranty() { if (ns.RenderClosure) ns.RenderClosure.renderWarranty(); }
  function renderClosure() { if (ns.RenderClosure) ns.RenderClosure.renderClosure(); }

  // ---- RACI + Comms ---- (extracted to js/render/people.js)
  function renderRaci() { if (ns.RenderPeople) ns.RenderPeople.renderRaci(); }
  function renderRaciHeatmap() { if (ns.RenderPeople) ns.RenderPeople.renderRaciHeatmap(); }
  function renderRaciAlerts() { if (ns.RenderPeople) ns.RenderPeople.renderRaciAlerts(); }
  function renderComms() { if (ns.RenderPeople) ns.RenderPeople.renderComms(); }

  // ---- Documents ---- (extracted to js/render/documents.js)
  // Shims delegate to ns.RenderDocs for backward compatibility.
  function renderRfis() { if (ns.RenderDocs) ns.RenderDocs.renderRfis(); }
  function renderSubmittals() { if (ns.RenderDocs) ns.RenderDocs.renderSubmittals(); }
  function renderBallInCourt() { if (ns.RenderDocs) ns.RenderDocs.renderBallInCourt(); }
  function renderDrawLog() { if (ns.RenderDocs) ns.RenderDocs.renderDrawLog(); }
  function renderPermits() { if (ns.RenderDocs) ns.RenderDocs.renderPermits(); }
  function renderDocuments() { if (ns.RenderDocs) ns.RenderDocs.renderDocuments(); }

  // ---- DMAIC ----
  // Full interactive renderer lives in js/mmgr-dmaic.js (feature 8); this
  // Charter is data-filled from live state on every entry (no event binding),
  // so a shim keeps SECTION_RENDERERS wiring stable, switching back to the
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
    // drawer AI switch now both follow state.config.ai.tier, one control,
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
    // outright (even if kbShowLeadtime is true, otherwise the lane would
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
    // DIR-3: pack state changed, re-evaluate the Core-Mode callout (toggling
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
  // CloseItems / spend log) carry no accessible name, the static a11y pass
  // can't reach them. This pass derives one from the column header + the
  // row's first text cell, e.g. "Planned, Demolition", and runs after every
  // section render. External accessible names (aria-label / title / label[for]
  // written without our marker) are skipped so static labels and future
  // per-field fixes are never clobbered, but labels THIS pass writes are
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
      // label, skip it and look for a plain text cell (row id, task name).
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
        else if (own) clearLabel(); // row lost its labelable text, drop the stale name
        return;
      }
      const parts = [];
      const th = columnHeaderFor(row, inp);
      if (th) parts.push(th);
      const rl = rowLabelFor(row, inp);
      if (rl) parts.push(rl);
      if (parts.length) setLabel(parts.join(', '));
      else if (own) clearLabel(); // nothing derivable now, drop the stale name
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
    // DIR-2: the sticky nav's offset tracks the header's real height, the
    // greeting line changes height, so re-measure on every full render.
    if (ns.Viewport && ns.Viewport.syncHeaderStack) ns.Viewport.syncHeaderStack();
    // OWNER 2026-08-15: Controls-tab live previews (Copy As + Email Templates)
    // must mirror the current state, App is loaded after Render, so guard.
    if (window.MMGR && window.MMGR.App && window.MMGR.App.renderCtrlPreviews) {
      window.MMGR.App.renderCtrlPreviews();
    }
  }



  // ==================================================================
  // Phase C, Gantt interactions: drag-to-reschedule, clickable
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

    // Commit the drag as an undoable edit, this task only. A drag is a
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
    // never rewrites the plan, a full re-schedule stays an explicit action.
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
    const label = (fromT ? fromT.name : fromId) + ' -> ' + (toT ? toT.name : toId);
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
  // Phase F, Keyboard-first WBS: arrow navigation, Enter to edit name,
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
    // not covered by the input/select pointer-events guard, block renames
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

  // Weather window inputs (dashboard card), direct listeners, not
  // data-action (see updWxWindow comment). Bound lazily on the first panel
  // render so the card's inputs are always wired regardless of where or
  // when the scripts load; stub elements in tests simply no-op.
  let _wxBound = false;
  function bindWxInputs() { if (ns.RenderWeather) ns.RenderWeather.bindWxInputs(); }

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
