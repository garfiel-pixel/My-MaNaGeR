/* ============================================================
   My MaNaGeR — Application Controller Module
   Initialization, event handlers, drawer, modals, toast,
   keyboard shortcuts, theme, crosshair, methodology learning card.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State.getState();
  const U = ns.Utils;
  const R = ns.Render;

  // ---- Project ID ----
  const urlParams = new URLSearchParams(window.location.search);
  ns.projectId = urlParams.get('id') || localStorage.getItem('mmgr_current_project') || 'default';

  // ---- Access Gate ----
  // Full codes set mmgr_unlocked_<id>='1'. A VIEW-ONLY code (ACTION-PLAN
  // 4.1) sets the same unlock flag PLUS mmgr_scope_<id>='readonly' — the
  // project opens in a reduced, non-editable view. Both paths are
  // client-side localStorage (simulated backend), matching the existing
  // SHA-256 model; the plaintext code never leaves the browser.
  function checkAccess() {
    const projectId = ns.projectId;
    const unlocked = localStorage.getItem('mmgr_unlocked_' + projectId) === '1';
    if (!unlocked) {
      // The app entry now lives at app.html (index.html is the marketing
      // site). A locked visitor is sent back to the project list + unlock.
      window.location.href = 'app.html?locked=' + encodeURIComponent(projectId);
      return false;
    }
    // If this browser opened the project with a view-only code, drop the
    // app into read-only mode (reduced view).
    ns.scope = localStorage.getItem('mmgr_scope_' + projectId) === 'readonly' ? 'readonly' : 'full';
    return true;
  }

  function isReadonly() { return ns.scope === 'readonly'; }

  // ---- Init ----
  function init() {
    if (!checkAccess()) return;

    ns.State.load();

    const s = S();

    // ACTION-PLAN 4.1: view-only scope — reduced read-only view. The body
    // class + banner are the visible state; the delegated event guards below
    // block every mutating data-action, while navigation / Copy All / Print
    // keep working.
    if (isReadonly()) {
      document.body.classList.add('readonly-mode');
      const banner = U.$('readonly-banner');
      if (banner) banner.classList.remove('is-hide');
    }

    // Apply theme — light is the default; dark is opt-in
    const thmTgl = U.$('thm-tgl');
    if (s.theme === 'dark') {
      document.body.classList.add('dark-mode');
      if (thmTgl) thmTgl.checked = false;
    } else {
      document.body.classList.remove('dark-mode');
      if (thmTgl) thmTgl.checked = true;
    }
    // Apply crosshair
    if (s.crosshairOn) {
      document.body.classList.add('crosshair-on');
      const tgl = U.$('ch-tgl');
      if (tgl) tgl.checked = true;
    }
    // Crosshair alignment lines (#cx horizontal, #cy vertical) follow the
    // pointer. Monolith parity: bound once at init, CSS hides the lines when
    // the toggle is off.
    const cxEl = U.$('cx');
    const cyEl = U.$('cy');
    if (cxEl && cyEl) {
      document.addEventListener('mousemove', function(ev) {
        cxEl.style.top = ev.clientY + 'px';
        cyEl.style.left = ev.clientX + 'px';
      });
    }
    // Persisted focus mode (monolith S.focus parity)
    if (s.focusMode) document.body.classList.add('focus-mode');
    // Set user name
    const nameIn = U.$('user-name-in');
    if (nameIn) nameIn.value = s.userName || '';

    // Set work week
    const ww = U.$('ww-sel');
    if (ww) ww.value = s.workWeek || 5;

    // Load charter data
    ns.Charter && ns.Charter.loadCharterData();

    // Load sprint data
    ns.Sprint && ns.Sprint.loadSprintData();

    // Load budget envelope
    const env = U.$('bud-envelope');
    if (env) env.value = s.budgetEnvelope || 0;

    // Initial render
    R.renderAll();
    updateUndoUi();

    // Phase 2: hook the client error surface (window error + unhandledrejection)
    if (ns.Errors && ns.Errors.hookGlobals) ns.Errors.hookGlobals();

    // Rank 4.2: crash-durability journal restore — if the IndexedDB journal
    // holds a NEWER state than localStorage (a hard kill happened mid-edit),
    // adopt it and re-render. Async best-effort; never blocks first paint.
    ns.State.restoreFromJournal().then(function(restored) {
      if (restored) R.renderAll();
    });

    // Populate weather region selector + set current value
    const regSel = U.$('weather-region-sel');
    if (regSel && ns.Weather && ns.Weather.getRegions) {
      regSel.innerHTML = ns.Weather.getRegions().map(r =>
        '<option value="' + r.id + '"' + (r.id === (s.weatherRegion || 'northern-temperate') ? ' selected' : '') + '>' + U.escapeHtml(r.name) + '</option>'
      ).join('');
    }

    // Live dirty indicator: any state change (typing, toggles, imports)
    // updates the header badge immediately without a full re-render.
    ns.State.onChange(function() { R.renderDirtyIndicator(); });

    // Multi-tab conflict detection: storage events fire in OTHER tabs, so
    // this tab is notified whenever a peer overwrites the shared key.
    window.addEventListener('storage', function(e) {
      if (!ns.State.getProjectKey || e.key !== ns.State.getProjectKey() || !e.newValue) return;
      try {
        onExternalChange(JSON.parse(e.newValue));
      } catch(err) {
        console.warn('External change parse failed:', err);
      }
    });

    // Hide the boot loading skeleton after first paint of the real UI
    const splash = U.$('boot-splash');
    if (splash) {
      requestAnimationFrame(() => splash.classList.add('off'));
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo (not inside text inputs,
      // where the browser owns undo).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        const inInput = e.target.closest && e.target.closest('input,textarea,select');
        if (!inInput) {
          e.preventDefault();
          if (e.shiftKey) { redo(); } else { undo(); }
          return;
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        // e.target can be the document node (no closest) when nothing has
        // focus — guard so the shortcut never throws.
        const inInput = e.target.closest && e.target.closest('input,textarea,select');
        if (!e.ctrlKey && !e.metaKey && !inInput) {
          e.preventDefault();
          tglFocusMode();
        }
      }
      if (e.key === 'Escape') {
        closeDrw();
        closeOM();
        closeModals();
        if (ns.Charter) { ns.Charter.closeChartUp(); }
        if (ns.WbsImport) { ns.WbsImport.closeWbsImport(); }
        if (ns.ImportDates) { ns.ImportDates.closeImportDates(); }
        if (ns.AiWin) { ns.AiWin.close(); }
      }
    });

    // Run validation
    const issues = ns.State.validate();
    if (issues.length > 0) {
      console.warn('State validation issues:', issues);
    }

    console.log('My MaNaGeR initialized. Project:', ns.projectId, '| Schema v' + ns.State.SCHEMA_VERSION);
  }

  // ---- Theme & Settings ----
  function setUserName(name) {
    ns.State.updateState(function(s) { s.userName = name; });
    R.renderGreeting();
  }

  function tglTheme() {
    const tgl = U.$('thm-tgl');
    const isLight = tgl ? tgl.checked : S().theme !== 'dark';
    document.body.classList.toggle('dark-mode', !isLight);
    ns.State.updateState(function(s) { s.theme = isLight ? 'light' : 'dark'; });
  }

  function tglCh() {
    const tgl = U.$('ch-tgl');
    const on = tgl && tgl.checked;
    document.body.classList.toggle('crosshair-on', on);
    ns.State.updateState(function(s) { s.crosshairOn = on; });
  }

  // ---- Phase 2: feature flags ----
  // Checkbox-driven (same contract as theme/crosshair): Chrome toggles
  // `checked` before the handler runs, so read it as-is and let the native
  // toggle stand. state.flags drives the Controls-drawer chips and the
  // render-side UI gating (renderFlags in mmgr-render.js).
  function tglFlag(el) {
    const flag = el.getAttribute('data-flag');
    if (!flag) return;
    const on = el.type === 'checkbox' ? el.checked : (S().flags && S().flags[flag] !== false);
    ns.State.updateState(function(s) {
      if (!s.flags || typeof s.flags !== 'object') s.flags = {};
      s.flags[flag] = on;
    });
    R.renderAll();
  }

  // ---- Phase 2: client error surface ----
  function clearErrorLog() {
    if (ns.Errors && ns.Errors.clear) ns.Errors.clear();
    showToast('Error log cleared.', 'ok');
  }

  function tglLock() {
    ns.State.updateState(function(s) { s.methodologyLocked = !s.methodologyLocked; });
    R.renderLock();
  }

  function setWorkWeek(val) {
    ns.State.updateState(function(s) { s.workWeek = parseInt(val) || 5; });
  }

  // ---- Methodology ----
  function swMeth(meth, btn) {
    const s = S();
    if (s && s.methodologyLocked) {
      showToast('Methodology is locked. Unlock in Controls to switch.', 'err');
      return;
    }
    ns.State.updateState(function(state) { state.methodology = meth; });
    R.renderMethodology();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }

  // ---- Sections ----
  function showSec(section, btn) {
    R.showSection(section, btn);
  }

  // ---- Focus Mode ----
  function tglFocusMode() {
    // Monolith parity: the focus state persists so a hard refresh keeps the
    // focused workspace (S.focus in the monolith).
    ns.State.updateState(function(s) { s.focusMode = !s.focusMode; });
    document.body.classList.toggle('focus-mode', !!S().focusMode);
  }

  // ---- Drawer ----
  function openDrw() {
    const drw = U.$('drw');
    if (drw) drw.classList.add('open');
  }

  function closeDrw() {
    const drw = U.$('drw');
    if (drw) drw.classList.remove('open');
  }

  function swDtab(tab, btn) {
    document.querySelectorAll('.dtab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    ['feat', 'qa', 'prompt', 'ctrl'].forEach(t => {
      const el = U.$('db-' + t);
      if (el) el.classList.toggle('is-hide', t !== tab);
    });
  }

  // ---- Toast ----
  function showToast(msg, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'ok');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '28px', left: '50%',
      transform: 'translateX(-50%)', background: 'var(--card)',
      borderRadius: '8px', padding: '10px 20px', fontSize: '.78rem',
      zIndex: '9999', border: '1px solid ' + (type === 'err' ? 'var(--danger)' : 'var(--green)'),
      color: type === 'err' ? 'var(--danger)' : 'var(--green)'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ---- Methodology Learning Card ----
  let mlcTimer = null;
  const MLC_DATA = {
    waterfall: {
      title: 'Waterfall Methodology',
      body: 'A linear, sequential approach where each phase must be completed before the next begins. Best for construction, manufacturing, and regulated environments where requirements are stable and changes are costly.',
      when: 'Best for: Fixed-price contracts, regulatory projects, and any project where the full scope is known upfront.',
      example: 'Example: Building a bridge — design must be approved before steel is ordered, and steel must arrive before erection begins.'
    },
    agile: {
      title: 'Agile Methodology',
      body: 'An iterative approach that delivers work in small, time-boxed increments called sprints. Best for software, product development, and environments where requirements evolve rapidly.',
      when: 'Best for: Projects with evolving requirements, innovation work, and teams that benefit from rapid feedback loops.',
      example: 'Example: Developing a mobile app — each 2-week sprint delivers a working feature set that users can test and provide feedback on.'
    },
    hybrid: {
      title: 'Hybrid Methodology',
      body: 'Combines the structure of Waterfall (planning, design, governance) with the flexibility of Agile (iterative delivery, continuous improvement). Best for complex projects that need both certainty and adaptability.',
      when: 'Best for: Large-scale digital transformations, capital projects with software components, and any project where parts are well-defined and parts are exploratory.',
      example: 'Example: A factory automation project — the physical layout and equipment procurement follow Waterfall, while the control software is developed in Agile sprints.'
    }
  };

  function showMLC(meth) {
    const data = MLC_DATA[meth];
    if (!data) return;
    const card = U.$('meth-learn-card');
    if (!card) return;
    U.$('mlc-title').textContent = data.title;
    U.$('mlc-body').textContent = data.body;
    U.$('mlc-when').textContent = data.when;
    U.$('mlc-example').textContent = data.example;
    card.classList.remove('is-hide');
  }

  function closeMLC() {
    const card = U.$('meth-learn-card');
    if (card) card.classList.add('is-hide');
  }

  function scheduleMLCClose() {
    if (mlcTimer) clearTimeout(mlcTimer);
    mlcTimer = setTimeout(closeMLC, 500);
  }

  function clearMlcTimer() {
    if (mlcTimer) clearTimeout(mlcTimer);
  }

  // ---- Copy All ----
  // Section-specific formatted blocks for the ported sections (RACI, Comms,
  // Docs, Meetings) match the monolith's exports; everything else falls
  // back to the generic table-dump.
  function cpAllPage(section) {
    const s = ns.State.getState();
    const ts = `[Copied: ${new Date().toLocaleString()} | My MaNaGeR | ${((s && s.methodology) || '').toUpperCase()}]`;
    let text = ts + '\n\n';
    if (section === 'raci' && ns.Raci && ns.Raci.raciExportBlock) {
      text += 'RACI MATRIX\n' + '='.repeat(40) + '\n' + ns.Raci.raciExportBlock();
      U.copyToClipboard(text);
      showToast('Copied!', 'ok');
      return;
    }
    if (section === 'comms') {
      text += 'COMMUNICATION LOG\n' + '='.repeat(40) + '\n';
      ((s && s.commsEntries) || []).forEach(c => {
        text += `[${c.id}] ${c.date} | ${c.type} | ${c.attendees}\n  Summary: ${c.summary}\n  Actions: ${c.actionItems}\n  Follow-up: ${c.followUp || '—'}\n\n`;
      });
      U.copyToClipboard(text);
      showToast('Copied!', 'ok');
      return;
    }
    if (section === 'docs') {
      text += 'DOCUMENT REGISTER\n' + '='.repeat(40) + '\n';
      ((s && s.documents) || []).forEach(d => {
        text += `[${d.id}] ${d.docNo} | ${d.title} | ${d.type} v${d.version} | ${d.status} | ${d.responsible} | Issued: ${d.dateIssued || '—'} | ${d.notes || ''}\n`;
      });
      U.copyToClipboard(text);
      showToast('Copied!', 'ok');
      return;
    }
    // ACTION-PLAN 7.4: dispute-ready weather delay log export (date,
    // conditions, note, affected tasks + LD exposure). Client-side text —
    // no server round-trip; the log itself is localStorage state.
    if (section === 'wxlog') {
      text += 'WEATHER DELAY LOG (DISPUTE RECORD)\n' + '='.repeat(40) + '\n';
      const log = (s && s.weatherLog) || [];
      if (log.length) {
        log.forEach(e => {
          text += e.date + ' | ' + (e.condition || '—') + (e.note ? ' | Note: ' + e.note : '') +
            (e.affectedTaskIds && e.affectedTaskIds.length ? ' | Affected: ' + e.affectedTaskIds.join(', ') : '') + '\n';
        });
      } else {
        text += 'No weather delay days logged yet.\n';
      }
      if (ns.Forecast && ns.Forecast.ldExposure) {
        const ld = ns.Forecast.ldExposure(s);
        text += '\nLD EXPOSURE\n' + '-'.repeat(30) + '\n' +
          'Logged days: ' + ld.days + ' | LD rate: $' + Number(ld.rate).toLocaleString() + '/day | Exposure: $' + Number(ld.exposure).toLocaleString() + '\n';
      }
      U.copyToClipboard(text);
      showToast('Weather log copied!', 'ok');
      return;
    }
    if (section === 'meet' && ns.Meetings) {
      const M = ns.Meetings;
      text += 'MEETING AGENDAS & TEMPLATES\n' + '='.repeat(40) + '\n\nPRE-PROJECT KICKOFF (' + M.MEET_TEMPLATES.kickoff.dur + ')\n' + '-'.repeat(30) + '\n';
      M.MEET_KICKOFF_ITEMS.forEach((it, i) => { text += (i + 1) + '. ' + it + '\n'; });
      text += '\nRECURRING TEMPLATES\n' + '-'.repeat(30) + '\n';
      M.MEET_RECURRING.concat(M.MEET_SPECIALIZED).forEach(m => { text += '• ' + m.t + ' (' + m.dur + ') — ' + m.d + '\n'; });
      if (s && (s.methodology === 'agile' || s.methodology === 'hybrid')) {
        text += '\nAGILE CEREMONIES\n' + '-'.repeat(30) + '\n';
        M.MEET_AGILE.forEach(m => { text += '• ' + m.t + ' (' + m.dur + ') — ' + m.d + '\n'; });
      }
      U.copyToClipboard(text);
      showToast('All meeting templates copied!', 'ok');
      return;
    }
    // ACTION-PLAN 3.4: the weekly baseline narrative feeds Copy All — a
    // client-side plain-English diff, no server round-trip.
    if (section === 'baselinen') {
      text += 'WHAT CHANGED THIS WEEK\n' + '='.repeat(40) + '\n';
      const narr = ns.Render && ns.Render.computeBaselineNarrative ? ns.Render.computeBaselineNarrative(s) : null;
      if (narr) {
        narr.forEach(n => { text += '• ' + n + '\n'; });
      } else {
        text += 'No baseline captured yet — Settings > Controls > Save Baseline.\n';
      }
      text += '\nCURRENT PLAN (tasks)\n' + '='.repeat(40) + '\n';
      ((s && s.tasks) || []).forEach(t => {
        text += '[' + t.id + '] ' + t.name + ' | ' + (t.status || '') + ' | ' + (t.startDate || '—') + ' → ' + (t.endDate || '—') + '\n';
      });
      U.copyToClipboard(text);
      showToast('Copied!', 'ok');
      return;
    }
    // MASTER-ACTION-PLAN-v3-STRICT Rank 1.1: the one-click claim/delay
    // package — composed live from unified state via the Claim module,
    // windowed by the Claim Pack tab's date range. Client-side text, same
    // zero-server Copy All path.
    if (section === 'claim' && ns.Claim) {
      const fromEl = U.$('claim-from');
      const toEl = U.$('claim-to');
      const pack = ns.Claim.buildClaimPack(s, fromEl ? fromEl.value : '', toEl ? toEl.value : '');
      text += ns.Claim.claimPackText(pack);
      U.copyToClipboard(text);
      showToast('Claim pack copied!', 'ok');
      return;
    }
    // MASTER-ACTION-PLAN-v3-STRICT Rank 2.1: the auto-generated "what
    // changed" digest — diffed against the pinned reference point (or the
    // baseline) and copied as plain text. Local generation only.
    if (section === 'digest' && ns.Digest && ns.Digest.computeDigest && ns.Digest.buildDigestText) {
      text += ns.Digest.buildDigestText(ns.Digest.computeDigest(s));
      U.copyToClipboard(text);
      showToast('Digest copied!', 'ok');
      return;
    }
    const body = U.$(section + '-body');
    if (!body) return;
    text = Array.from(body.querySelectorAll('tr')).map(tr =>
      Array.from(tr.querySelectorAll('td,th')).map(td => td.textContent.trim()).join(' | ')
    ).join('\n');
    U.copyToClipboard(text);
    showToast('Copied!', 'ok');
  }

  // ============================================================
  // ACTION-PLAN Phase 5 — export & polish
  // ============================================================

  // ---- 5.1 Multi-format Copy All ----
  // Existing cpAllPage copies per-section tables. These three variants
  // compose the SAME live state into share-format text: a Slack digest,
  // an email digest, and a printable client summary. Pure client-side
  // composition (simulated backend: no server round-trip).
  function _fmtMoney(n) { return '$' + Number(n || 0).toLocaleString(); }

  function buildDigest(s) {
    const lines = [];
    const f = (s.charter) || {};
    lines.push('*' + (s.projectName || f.name || 'Project') + '*');
    lines.push('Status: ' + (f.status || '—') + ' | Methodology: ' + ((s.methodology || 'waterfall').toUpperCase()));
    const tasks = s.tasks || [];
    const done = tasks.filter(t => t.status === 'completed').length;
    const overdue = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
    lines.push('Tasks: ' + done + '/' + tasks.length + ' complete' + (overdue ? ' | *' + overdue + ' overdue*' : ''));
    if (f.targetCompletion) {
      const t = ns.Render && ns.Render.computeTimelineStatus ? ns.Render.computeTimelineStatus(s) : null;
      if (t) lines.push('Timeline: ' + t.status + (t.overrunDays > 0 ? ' (+' + t.overrunDays + 'd)' : ''));
    }
    const risks = (s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'high'));
    if (risks.length) lines.push('High risks: ' + risks.map(r => r.description).join('; '));
    const issues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
    if (issues.length) lines.push('Open issues: ' + issues.map(i => i.description).join('; '));
    const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
    const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
    lines.push('Budget: ' + _fmtMoney(actual) + ' spent of ' + _fmtMoney(planned) + ' planned' + (planned > actual ? '' : ' | *over planned*'));
    if (ns.Render && ns.Render.computeAgingActions) {
      const open = ns.Render.computeAgingActions(s).filter(a => (a.age || 0) > 0).length;
      if (open) lines.push('Action items past due: ' + open);
    }
    return lines.join('\n');
  }

  function cpFormats(kind) {
    const s = ns.State.getState();
    const ts = new Date().toLocaleString();
    if (kind === 'slack') {
      U.copyToClipboard('*My MaNaGeR — Weekly Digest* (' + ts + ')\n' + buildDigest(s));
      showToast('Slack digest copied!', 'ok');
    } else if (kind === 'email') {
      const body = buildDigest(s).replace(/\*/g, '');
      const html = 'Subject: Project Digest — ' + (s.projectName || '') + '\n\nHi team,\n\n' + body.replace(/\n/g, '\n') + '\n\n— My MaNaGeR\n';
      U.copyToClipboard(html);
      showToast('Email digest copied!', 'ok');
    } else if (kind === 'client') {
      // Printable client summary — clean text, no markup, safe to paste into
      // a doc or print directly.
      const f = (s.charter) || {};
      const tasks = s.tasks || [];
      const done = tasks.filter(t => t.status === 'completed').length;
      const lines = [];
      lines.push('CLIENT PROJECT SUMMARY');
      lines.push('='.repeat(40));
      lines.push('Project: ' + (s.projectName || f.name || '—'));
      lines.push('Status: ' + (f.status || '—'));
      lines.push('Prepared: ' + ts);
      lines.push('');
      lines.push('PROGRESS');
      lines.push('-'.repeat(30));
      lines.push('Completion: ' + (tasks.length ? Math.round(done / tasks.length * 100) : 0) + '% (' + done + ' of ' + tasks.length + ' tasks)');
      if (f.targetCompletion) lines.push('Target completion: ' + f.targetCompletion);
      lines.push('');
      lines.push('KEY METRICS');
      lines.push('-'.repeat(30));
      const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
      lines.push('Budget: ' + _fmtMoney(actual) + ' spent / ' + _fmtMoney(planned) + ' planned');
      lines.push('Open issues: ' + (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length);
      lines.push('Open high risks: ' + (s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'high')).length);
      lines.push('');
      lines.push('GENERATED BY MY MANAGER');
      U.copyToClipboard(lines.join('\n'));
      showToast('Client summary copied!', 'ok');
    }
  }

  // ---- 5.2 Definitions tooltips ----
  // Any element carrying data-def="<term>" gets a floating tooltip from
  // the Definitions glossary on hover. Delegated once, no inline handlers.
  // The tooltip element is created once lazily (same pattern as the toast).
  let _defTipEl = null;
  let _defTipTimer = null;

  function defTipFor(term) {
    if (!ns.Defs || !ns.Defs.DATA) return null;
    const entry = ns.Defs.DATA.find(d => d.term.toLowerCase() === String(term || '').toLowerCase());
    return entry || null;
  }

  function showDefTip(el, term) {
    const entry = defTipFor(term);
    if (!entry) return;
    if (_defTipTimer) { clearTimeout(_defTipTimer); _defTipTimer = null; }
    if (!_defTipEl) {
      _defTipEl = document.createElement('div');
      _defTipEl.id = 'def-tooltip';
      _defTipEl.className = 'def-tooltip';
      document.body.appendChild(_defTipEl);
    }
    _defTipEl.innerHTML = '<div class="dt-term">' + U.escapeHtml(entry.term) + (entry.group ? '<span class="def-badge">' + U.escapeHtml(entry.group) + '</span>' : '') + '</div>' +
      '<div class="dt-body">' + U.escapeHtml(entry.meaning) + '</div>';
    _defTipEl.classList.add('vis');
    const r = el.getBoundingClientRect();
    _defTipEl.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
    _defTipEl.style.top = (r.bottom + 8) + 'px';
  }

  function hideDefTip() {
    if (_defTipTimer) { clearTimeout(_defTipTimer); _defTipTimer = null; }
    if (_defTipEl) _defTipEl.classList.remove('vis');
  }

  // ---- 5.x Gantt high-res PNG export ----
  // Renders the CURRENT schedule to an offscreen 2x canvas (bars + critical
  // path gold + weather-exposed hatching + baseline overlay + weekday
  // header) and downloads it as a large print-ready PNG. Client-side only;
  // no server, no external library.
  function exportGanttPNG() {
    const s = ns.State.getState();
    const tasks = (s.tasks || []).filter(t => t.startDate && t.endDate);
    if (!tasks.length) { showToast('No dated tasks to export.', 'err'); return; }
    let minDate = null, maxDate = null;
    tasks.forEach(t => {
      if (!minDate || t.startDate < minDate) minDate = t.startDate;
      if (!maxDate || t.endDate > maxDate) maxDate = t.endDate;
    });
    const dayWidth = 14, rowH = 26, headerH = 40, padL = 180, padR = 20, padT = 16, padB = 24;
    const totalDays = U.daysBetween(minDate, maxDate) + 1;
    const W = padL + totalDays * dayWidth + padR;
    const H = padT + headerH + tasks.length * rowH + padB;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    // Background
    ctx.fillStyle = '#0e1116'; ctx.fillRect(0, 0, W, H);
    // Header + weekday labels
    ctx.fillStyle = '#f1f5f9'; ctx.font = '700 11px sans-serif';
    ctx.fillText((s.projectName || 'Project') + ' — Schedule Export', padL, padT + 12);
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#94a3b8';
    for (let i = 0; i < totalDays; i++) {
      const d = U.addDays(minDate, i);
      const x = padL + i * dayWidth;
      if (d.getDay() === 1) { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x, padT + headerH - 20, dayWidth, tasks.length * rowH + 20); ctx.fillStyle = '#94a3b8'; }
      ctx.fillText(String(d.getDate()), x + 1, padT + headerH - 6);
    }
    // Baseline overlay bars
    const baseMap = {};
    if (s.baseline && s.baseline.tasks) (s.baseline.tasks || []).forEach(bt => { baseMap[bt.id] = bt; });
    tasks.forEach((t, ri) => {
      const y = padT + headerH + ri * rowH;
      const x0 = padL + U.daysBetween(minDate, t.startDate) * dayWidth;
      const bw = Math.max(1, U.daysBetween(t.startDate, t.endDate)) * dayWidth;
      // Task label
      ctx.fillStyle = '#e2e8f0'; ctx.font = '600 10px sans-serif';
      ctx.fillText(U.escapeHtml ? t.name : t.name, 8, y + rowH / 2 + 3);
      // Baseline (grey underlay)
      const bt = baseMap[t.id];
      if (bt && bt.startDate && bt.endDate) {
        const bx = padL + U.daysBetween(minDate, bt.startDate) * dayWidth;
        const bww = Math.max(1, U.daysBetween(bt.startDate, bt.endDate)) * dayWidth;
        ctx.fillStyle = 'rgba(148,163,184,.35)'; ctx.fillRect(bx, y + 3, bww, rowH - 10);
      }
      // Weather hatching on exposed bars
      if (t.weatherExposed) {
        ctx.fillStyle = 'rgba(56,189,248,.25)';
        ctx.fillRect(x0, y, bw, rowH);
        ctx.strokeStyle = 'rgba(56,189,248,.8)'; ctx.lineWidth = 1;
        for (let hx = x0; hx < x0 + bw; hx += 7) { ctx.beginPath(); ctx.moveTo(hx, y); ctx.lineTo(hx + 7, y + rowH); ctx.stroke(); }
      }
      // Bar color by status
      const col = t.critical ? '#d4af37' : t.status === 'completed' ? '#009b3a' : U.isOverdue(t.endDate) && t.status !== 'completed' ? '#dc3545' : U.isDueSoon(t.endDate, 3) && t.status !== 'completed' ? '#f59e0b' : '#3b82f6';
      ctx.fillStyle = col;
      ctx.fillRect(x0, y + (t.critical ? 0 : 4), bw, rowH - (t.critical ? 0 : 8));
      if (t.critical) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, y + .5, bw - 1, rowH - 1); }
    });
    // Legend
    ctx.font = '9px sans-serif';
    const legend = [['#d4af37', 'Critical'], ['#3b82f6', 'Task'], ['#009b3a', 'Done'], ['#f59e0b', 'Due soon'], ['#dc3545', 'Overdue'], ['rgba(56,189,248,.6)', 'Weather-exposed'], ['rgba(148,163,184,.5)', 'Baseline']];
    let lx = padL;
    legend.forEach(l => {
      ctx.fillStyle = l[0]; ctx.fillRect(lx, H - 18, 12, 10);
      ctx.fillStyle = '#94a3b8'; ctx.fillText(l[1], lx + 15, H - 9);
      lx += 18 + ctx.measureText(l[1]).width + 16;
    });
    canvas.toBlob(function(blob) {
      if (!blob) { showToast('Export failed.', 'err'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (s.projectName || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-gantt-' + new Date().toISOString().slice(0, 10) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 400);
      showToast('High-res Gantt exported (PNG).', 'ok');
    }, 'image/png');
  }

  // ---- ACTION-PLAN 7 weather actions ----
  // Open-Meteo is fetch-only (CSP connect-src permits api.open-meteo.com).
  // All four handlers are client-side; failures degrade to a toast, never
  // a throw, and the static regional windows remain the fallback.
  async function wxGeocode() {
    const place = (U.$('wx-place-in') || {}).value || '';
    if (!place.trim()) { showToast('Enter a site city first.', 'err'); return; }
    const ok = await ns.Forecast.geocode(place.trim());
    if (ok) { showToast('Site located — refresh for the forecast.', 'ok'); R.renderAll(); }
    else { showToast('Could not find that location — check the city name.', 'err'); }
  }

  async function wxRefresh() {
    const s = S();
    if (s.siteLat === null || s.siteLon === null) { showToast('Locate the site city first.', 'err'); return; }
    try {
      await ns.Forecast.fetchForecast(s.siteLat, s.siteLon);
      showToast('Forecast refreshed.', 'ok');
    } catch (e) {
      showToast('Forecast unavailable (offline?). Using cached or regional windows.', 'err');
    }
    R.renderAll();
  }

  function wxLogToday() {
    const s = S();
    const today = U.todayStr();
    // Affected tasks: weather-sensitive tasks running today.
    const affected = (s.tasks || []).filter(t => t.weatherSensitive && t.startDate && t.endDate &&
      U.parseDL(t.startDate) <= new Date() && U.parseDL(t.endDate) >= new Date()).map(t => t.id);
    ns.Forecast.logWeatherDay(s, { note: '', affectedTaskIds: affected });
    showToast('Weather day logged.', 'ok');
    R.renderAll();
  }

  // ACTION-PLAN 25: manual on-site weather override. A PM can log today's
  // ACTUAL conditions (hyperlocal reality beats API forecast) instead of the
  // auto-pulled values — feeds the same dispute-ready daily log.
  function wxLogManual() {
    const s = S();
    const condEl = U.$('wx-manual-cond');
    const noteEl = U.$('wx-manual-note');
    const condition = (condEl && condEl.value.trim()) || '';
    if (!condition) { showToast('Enter the manual conditions first.', 'err'); return; }
    const note = (noteEl && noteEl.value.trim()) || '';
    const affected = (s.tasks || []).filter(t => t.weatherSensitive && t.startDate && t.endDate &&
      U.parseDL(t.startDate) <= new Date() && U.parseDL(t.endDate) >= new Date()).map(t => t.id);
    ns.Forecast.logWeatherDay(s, { note: note, affectedTaskIds: affected, manual: true, condition: condition });
    if (condEl) condEl.value = '';
    if (noteEl) noteEl.value = '';
    showToast('Manual weather day logged.', 'ok');
    R.renderAll();
  }

  function wxCopyNotice() {
    U.copyToClipboard(ns.Forecast.subcontractorNotice(S()));
    showToast('Subcontractor notice copied.', 'ok');
  }

  // ACTION-PLAN 7.1: forecast strip horizon toggle (7-day vs the 16-day
  // Open-Meteo max, used as the monthly-rollup approximation). View-only
  // preference; the forecast itself is never re-fetched by this toggle.
  function wxSetView(el) {
    const days = parseInt((el && el.getAttribute('data-days')) || '7', 10);
    ns.State.updateState(function(s) { s.wxViewDays = days === 16 ? 16 : 7; });
    R.renderAll();
  }

  function wxDelLogEntry(el) {
    ns.Forecast.delWeatherLogEntry(parseInt(el.getAttribute('data-idx'), 10));
    R.renderAll();
  }

  // ---- Hold to Clear ----
  // Press and HOLD the Clear All button for 10s to confirm. The hold starts
  // on pointerdown and is cancelled on release, pointer cancel, leaving the
  // button, or losing window focus (see delegation in the event layer).
  let holdTimer = null;
  let holdShowedBar = false; // did THIS hold bring up the undo bar?
  const HOLD_MSG_ON = ' Hold to clear — release to cancel';
  const HOLD_MSG_OFF = ' Page cleared.';

  function startHold(section) {
    if (holdTimer) return; // already holding
    const dur = U.$('ut');
    if (dur) dur.textContent = '10';
    // Only show the bar if it isn't already up with a real undo message —
    // a pending "Page cleared. Undo" bar must not be discarded by a tap.
    const ub = U.$('ub');
    if (ub && !ub.classList.contains('vis')) {
      ub.classList.add('vis');
      holdShowedBar = true;
    }
    const msg = U.$('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_ON;
    holdTimer = setInterval(() => {
      const el = U.$('ut');
      if (el) {
        const v = parseInt(el.textContent) - 1;
        el.textContent = v;
        if (v <= 0) {
          clearInterval(holdTimer);
          holdTimer = null;
          // The hold succeeded: the bar now legitimately shows "Page cleared."
          // so a later hold-cancel must not hide it as if it were ours.
          holdShowedBar = false;
          clearSection(section);
        }
      }
    }, 1000);
  }

  function cancelHold() {
    if (!holdTimer) return;
    clearInterval(holdTimer);
    holdTimer = null;
    if (holdShowedBar) {
      const ub = U.$('ub');
      if (ub) ub.classList.remove('vis');
      holdShowedBar = false;
    }
    const msg = U.$('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_OFF;
    const dur = U.$('ut');
    if (dur) dur.textContent = '5';
  }

  function clearSection(section) {
    // Make the whole clear undoable (persistent stack, not just the 5s bar)
    ns.State.pushUndo();
    ns.State.updateState(function(s) {
      switch(section) {
        case 'wbs': s.tasks = []; break;
        case 'risk': s.risks = []; s.issues = []; break;
        case 'log': s.logEntries = []; break;
        case 'kan': s.tasks = s.tasks.filter(t => t.status === 'completed'); break;
        case 'comms': s.commsEntries = []; break;
      }
    });
    R.renderWbs();
    R.renderKanban();
    R.renderRisks();
    R.renderLog();
    R.renderComms();
    R.renderDash();
    const ub = U.$('ub');
    if (ub) { ub.classList.add('vis'); setTimeout(() => ub.classList.remove('vis'), 5000); }
    const msg = U.$('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_OFF;
    updateUndoUi();
  }

  function undoClr() {
    const ub = U.$('ub');
    if (ub) ub.classList.remove('vis');
    if (ns.State.undo()) {
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      showToast('Undone.', 'ok');
    } else {
      showToast('Nothing to undo.', 'err');
    }
    updateUndoUi();
  }

  // ---- Persistent Undo / Redo (command stack, 20 snapshots) ----
  function undo() {
    if (ns.State.undo()) {
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      showToast('Undone.', 'ok');
    } else {
      showToast('Nothing to undo.', 'err');
    }
    updateUndoUi();
  }

  function redo() {
    if (ns.State.redo()) {
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      showToast('Redone.', 'ok');
    } else {
      showToast('Nothing to redo.', 'err');
    }
    updateUndoUi();
  }

  function updateUndoUi() {
    const u = U.$('undo-btn');
    if (u) u.textContent = 'Undo' + (ns.State.undoDepth() ? ' (' + ns.State.undoDepth() + ')' : '');
    const r = U.$('redo-btn');
    if (r) r.textContent = 'Redo' + (ns.State.redoDepth() ? ' (' + ns.State.redoDepth() + ')' : '');
  }

  // ---- Weather Region ----
  function setRegion(val) {
    ns.State.updateState(function(s) { s.weatherRegion = val; });
    if (ns.Schedule && ns.Schedule.checkWeatherExposure) {
      ns.Schedule.checkWeatherExposure((S().tasks || []), val);
    }
    R.renderWbs();
    R.renderGantt();
    let label = val;
    if (ns.Weather && ns.Weather.getRegion) {
      const r = ns.Weather.getRegion(val);
      if (r && r.name) label = r.name;
    }
    showToast('Weather region: ' + label, 'ok');
  }

  // ---- Confirmation Dialog (replaces bare confirm() for destructive ops) ----
  let _cfmCb = null;
  let _cfmCancelCb = null;
  function askConfirm(opts) {
    const modal = U.$('cfm-modal');
    if (!modal) {
      // No dialog in the DOM: fall back to native confirm so safety holds.
      if (window.confirm((opts && opts.message) || 'Confirm?')) {
        if (opts && opts.onOk) opts.onOk();
      }
      return;
    }
    _cfmCb = (opts && opts.onOk) || null;
    _cfmCancelCb = (opts && opts.onCancel) || null;
    const title = U.$('cfm-title');
    if (title) title.textContent = (opts && opts.title) || 'Confirm';
    const msg = U.$('cfm-msg');
    if (msg) msg.textContent = (opts && opts.message) || '';
    const items = U.$('cfm-items');
    if (items) {
      const list = (opts && opts.items) || [];
      if (list.length) {
        items.classList.remove('is-hide');
        items.innerHTML = '<div class="cfm-list-label">Affected task IDs:</div><div class="cfm-list">' +
          list.map(id => '<code>' + U.escapeHtml(id) + '</code>').join('') + '</div>';
      } else {
        items.classList.add('is-hide');
      }
    }
    const okBtn = U.$('cfm-ok');
    if (okBtn) {
      okBtn.textContent = (opts && opts.confirmLabel) || 'Confirm';
      if (opts && opts.danger) {
        okBtn.classList.add('btn-d');
        okBtn.classList.remove('btn-g');
      } else {
        okBtn.classList.add('btn-g');
        okBtn.classList.remove('btn-d');
      }
    }
    const cancelBtn = U.$('cfm-cancel');
    if (cancelBtn) cancelBtn.textContent = (opts && opts.cancelLabel) || 'Cancel';
    modal.classList.add('on');
  }

  function cfmOk() {
    const modal = U.$('cfm-modal');
    if (modal) modal.classList.remove('on');
    const items = U.$('cfm-items');
    if (items) items.classList.add('is-hide');
    const cb = _cfmCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

  function cfmCancel() {
    const modal = U.$('cfm-modal');
    if (modal) modal.classList.remove('on');
    const items = U.$('cfm-items');
    if (items) items.classList.add('is-hide');
    const cb = _cfmCancelCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

  // ---- Multi-tab Conflict Resolution ----
  let _pendingExternal = null;
  function onExternalChange(parsed) {
    const s = S();
    if (!parsed || !s || !parsed.updatedAt) return;
    if (parsed.updatedAt <= s.updatedAt) return; // not newer — ignore
    if (JSON.stringify(parsed) === JSON.stringify(s)) return; // same content
    _pendingExternal = parsed;
    const modal = U.$('conflict-modal');
    if (modal) {
      const info = U.$('conflict-info');
      if (info) {
        info.textContent = 'Another tab saved a newer version of this project (' +
          new Date(parsed.updatedAt).toLocaleString() +
          '). Keep your current edits, or load their version.';
      }
      modal.classList.add('on');
    }
  }

  function keepMine() {
    const modal = U.$('conflict-modal');
    if (modal) modal.classList.remove('on');
    _pendingExternal = null;
    ns.State.save(true); // re-persist ours with a fresh updatedAt
    showToast('Kept your version.', 'ok');
  }

  function keepTheirs() {
    const modal = U.$('conflict-modal');
    if (modal) modal.classList.remove('on');
    const incoming = _pendingExternal;
    _pendingExternal = null;
    if (incoming && ns.State.adoptExternal(incoming)) {
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      showToast('Loaded the other tab\'s version.', 'ok');
    }
  }

  // Close every custom modal we own (Escape key path). An Escape on the
  // confirmation dialog behaves exactly like Cancel — the onCancel callback
  // (e.g. a Gantt-drag rollback) must still run.
  function closeModals() {
    ['cfm-modal', 'conflict-modal'].forEach(id => {
      const el = U.$(id);
      if (el) el.classList.remove('on');
    });
    const cb = _cfmCancelCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

  // ---- Baseline Restore (undoable) ----
  function restoreBaseline() {
    const s = S();
    if (!s || !s.baseline || !s.baseline.tasks || !s.baseline.tasks.length) {
      showToast('No baseline saved.', 'err');
      return;
    }
    askConfirm({
      title: 'Restore Baseline?',
      message: 'This copies the baseline start/end dates, durations and statuses back onto the current task list.',
      danger: true,
      confirmLabel: 'Restore Baseline',
      onOk: function() {
        ns.State.pushUndo();
        ns.State.updateState(function(state) {
          const baseMap = {};
          (state.baseline.tasks || []).forEach(bt => { baseMap[bt.id] = bt; });
          (state.tasks || []).forEach(t => {
            const bt = baseMap[t.id];
            if (bt) {
              t.startDate = bt.startDate;
              t.endDate = bt.endDate;
              t.duration = bt.duration;
              if (bt.status) t.status = bt.status;
            }
          });
        });
        R.renderWbs();
        R.renderGantt();
        R.renderKanban();
        R.renderDash();
        showToast('Baseline restored.', 'ok');
        updateUndoUi();
      }
    });
  }

  // ---- Gantt (delegated) ----
  function cascadeGantt() {
    if (ns.Schedule && ns.Schedule.cascade) {
      // cascade() toasts its own outcomes and may show a confirmation dialog
      ns.Schedule.cascade();
    } else {
      R.renderGantt();
      showToast('Gantt refreshed.', 'ok');
    }
  }

  function toggleCritical(btn) {
    // Monolith Critical Path Highlighter (S.cp): persisted state that dims
    // the non-critical chain in the Gantt. State-driven so the chip and the
    // bars can never drift apart across re-renders.
    ns.State.updateState(function(st) { st.hlCritical = !st.hlCritical; });
    R.renderGantt();
    R.renderWbs();
    if (btn) btn.classList.toggle('is-on', !!S().hlCritical);
  }

  function tglLeadtimeLane(btn) {
    // Monolith kb-leadtime-tgl: dedicated Kanban swimlane for Lead-Time /
    // third-party tasks. Persisted so re-renders keep the lane state.
    ns.State.updateState(function(st) { st.kbShowLeadtime = !st.kbShowLeadtime; });
    R.renderKanban();
    if (btn) btn.classList.toggle('is-on', !!S().kbShowLeadtime);
  }

  // ---- Kanban ----
  let dragTaskId = null;

  function dragCard(ev, taskId) {
    dragTaskId = taskId;
    ev.dataTransfer.effectAllowed = 'move';
  }

  function dropCard(ev, status) {
    ev.preventDefault();
    if (dragTaskId) {
      const task = (S().tasks || []).find(t => t.id === dragTaskId);
      // Monolith drop guard: lead-time cards belong in the Lead-Time lane —
      // WIP columns are for crew-driven work. Refuse the drop with a toast
      // instead of silently moving a third-party wait into a work column.
      if (task && task.leadTime) {
        showToast('Lead-time cards belong in the Lead-Time lane — WIP columns are for crew-driven work.', 'err');
        dragTaskId = null;
        document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
        return;
      }
      ns.State.updateState(function(s) {
        const task = (s.tasks || []).find(t => t.id === dragTaskId);
        if (task) task.status = status;
      });
      R.renderKanban();
      R.renderWbs();
      R.renderDash();
    }
    dragTaskId = null;
    document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
  }

  function dropCardLeadtime(ev) {
    ev.preventDefault();
    if (dragTaskId) {
      ns.State.updateState(function(s) {
        const task = (s.tasks || []).find(t => t.id === dragTaskId);
        if (task) task.leadTime = !task.leadTime;
      });
      // Interaction re-audit: toggling lead-time changes the WBS row (LT badge
      // + submitted/expected inputs) and the Dashboard's Lead-Time Tracker —
      // refresh all three surfaces, not just the board lane.
      R.renderKanban();
      R.renderWbs();
      R.renderDash();
    }
    dragTaskId = null;
    // Symmetry with dropCard: clear any lingering drop-highlight styling on
    // the columns after a lead-time drop.
    document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
  }

  function populateSprint() {
    // Pull the sprint's date span from the unstarted (todo) tasks.
    const s = S();
    const unstarted = (s.tasks || []).filter(t => (t.status || 'todo') === 'todo' && !t.isPhase);
    if (!unstarted.length) {
      showToast('No unstarted tasks to populate the sprint with.', 'err');
      return;
    }
    const starts = unstarted.map(t => t.startDate).filter(Boolean).sort();
    const ends = unstarted.map(t => t.endDate).filter(Boolean).sort();
    ns.State.updateState(function(state) {
      if (!state.sprint) state.sprint = { name: 'Sprint 1', start: '', end: '' };
      state.sprint.start = starts.length ? starts[0] : '';
      state.sprint.end = ends.length ? ends[ends.length - 1] : '';
    });
    // Refresh the sprint panel inputs
    if (ns.Tasks && ns.Tasks.loadSprintData) ns.Tasks.loadSprintData();
    showToast('Sprint populated with ' + unstarted.length + ' unstarted task(s).', 'ok');
  }

  // ---- Prompts ----
  function openPrompt(type) {
    const prompt = ns.Prompts.generate(type);
    const txt = U.$('om-txt');
    const modal = U.$('om');
    if (txt && modal) {
      txt.value = prompt;
      U.$('om-title').innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-edit"></use></svg> Prompt — ' + type;
      modal.classList.add('open');
    }
    // Monolith port: the Daily Field report gets a "Snapshot Now" button in
    // the modal header. Clicking it saves today's task statuses so tomorrow's
    // prompt shows a real completed-since-last-snapshot diff.
    const existing = document.getElementById('snap-daily-btn');
    if (existing) existing.remove();
    if (type === 'daily') {
      const title = U.$('om-title');
      if (title) {
        setTimeout(() => {
          if (document.getElementById('snap-daily-btn')) return;
          const b = document.createElement('button');
          b.id = 'snap-daily-btn';
          b.className = 'btn btn-g btn-s';
          b.style.marginLeft = '10px';
          b.textContent = 'Snapshot Now';
          b.title = 'Save current task statuses. Tomorrow\'s report will show what changed since this snapshot.';
          b.addEventListener('click', function() {
            if (ns.FieldReport && ns.FieldReport.snapshotDaily) {
              ns.FieldReport.snapshotDaily();
            }
          });
          title.parentNode.appendChild(b);
        }, 30);
      }
    }
  }

  function openDrwToSave() {
    swDtab('ctrl', null);
    openDrw();
  }

  function openDrwToPrompts(type) {
    swDtab('prompt', null);
    openDrw();
  }

  function jumpToDashTimeline() {
    showSec('dash', document.querySelector('.sec-btn'));
  }

  // ---- Export Modal ----
  function openOM() {
    const modal = U.$('om');
    const txt = U.$('om-txt');
    if (!modal || !txt) return;
    txt.value = ns.State.exportState();
    modal.classList.add('open');
  }

  function closeOM() {
    const modal = U.$('om');
    if (modal) modal.classList.remove('open');
  }

  function cpOut() {
    const txt = U.$('om-txt');
    if (txt) { U.copyToClipboard(txt.value); showToast('Copied to clipboard!', 'ok'); }
  }

  function loadClip() {
    navigator.clipboard.readText().then(text => {
      if (text && ns.State.importState(text)) {
        R.renderAll();
        if (ns.Charter) ns.Charter.loadCharterData();
        if (ns.Sprint) ns.Sprint.loadSprintData();
        showToast('State loaded from clipboard!', 'ok');
      } else {
        showToast('Invalid state data in clipboard.', 'err');
      }
    }).catch(() => { showToast('Cannot read clipboard. Paste manually.', 'err'); });
  }

  // ---- File Import/Export ----
  function saveProjectFile() {
    const data = ns.State.exportState();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mmgr-project-' + ns.projectId + '-' + U.todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    // Stamp the file-backup watermark (same timestamp as updatedAt) so the
    // header dirty indicator clears — it returns the moment the project is
    // edited again.
    ns.State.save(true, { backup: true });
    R.renderDirtyIndicator();
    showToast('Project backed up to file!', 'ok');
  }

  function loadProjectFile(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      if (ns.State.importState(e.target.result)) {
        R.renderAll();
        if (ns.Charter) ns.Charter.loadCharterData();
        if (ns.Sprint) ns.Sprint.loadSprintData();
        showToast('Project loaded!', 'ok');
      } else {
        showToast('Invalid project file.', 'err');
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  function saveBaseline() {
    ns.State.saveBaseline();
    showToast('Baseline saved!', 'ok');
  }

  // ---- Init ----
  // Explicit module-readiness gate. init() must not run until every module
  // the app depends on is present, otherwise a module that fails to load (or
  // a future reorder of the <script> tags) produces a silent, partial boot.
  // We poll every 50ms — which covers deferred scripts and slow network — and
  // after ~5s give up LOUDLY with the missing module names instead of initing
  // against an incomplete namespace.
  //
  // NOTE: Utils and Render are captured at parse time (const U / const R
  // above), so those two scripts must still load BEFORE app.js — the gate
  // guards the rest of the boot, not that specific parse-time capture.
  const REQUIRED_MODULES = [
    'Utils', 'State', 'Render', 'Prompts', 'Weather', 'FieldReport', 'Schedule',
    'Tasks', 'Sprint', 'WbsImport', 'ImportDates',
    'Risks', 'Resources', 'Budget', 'Spend', 'Stakeholders', 'Changes', 'Log',
    'Closure', 'Comms', 'Documents', 'Raci', 'Charter',
    'Health', 'Evm', 'Dmaic', 'Meetings', 'Voice', 'Defs', 'Decisions', 'Forecast', 'Claim', 'Digest'
  ];

  function modulesReady() {
    return REQUIRED_MODULES.every(m => !!ns[m]);
  }

  function _boot() {
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // 100 × 50ms = 5s
    function tryInit() {
      if (document.readyState === 'loading') {
        attempts++;
        if (attempts > MAX_ATTEMPTS) {
          console.error('My MaNaGeR boot timed out waiting for the DOM.');
          return;
        }
        setTimeout(tryInit, 50);
        return;
      }
      if (!modulesReady()) {
        const missing = REQUIRED_MODULES.filter(m => !ns[m]);
        attempts++;
        if (attempts > MAX_ATTEMPTS) {
          const msg = 'My MaNaGeR boot ABORTED — missing modules: ' + missing.join(', ') + '. Check the <script> load order in project.html.';
          console.error(msg);
          // Fail visibly for end users too — a silent blank page tells them
          // nothing about why nothing rendered.
          const sp = document.getElementById('boot-splash');
          if (sp) sp.classList.add('off');
          const el = document.createElement('div');
          el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1a1a;color:#ff6b6b;font:14px/1.5 monospace;padding:40px;text-align:center;z-index:99999';
          el.textContent = 'App failed to start — missing modules: ' + missing.join(', ') + '. Check the <script> load order.';
          document.body.appendChild(el);
          return;
        }
        setTimeout(tryInit, 50);
        return;
      }
      init();
    }
    tryInit();
  }

  // ---- API ----
  ns.App = {
    init: init,
    _boot: _boot,
    isReadonly: isReadonly,
    setUserName: setUserName,
    tglTheme: tglTheme,
    tglCh: tglCh,
    tglLock: tglLock,
    setWorkWeek: setWorkWeek,
    swMeth: swMeth,
    showSec: showSec,
    tglFocusMode: tglFocusMode,
    openDrw: openDrw,
    closeDrw: closeDrw,
    swDtab: swDtab,
    showToast: showToast,
    showMLC: showMLC,
    closeMLC: closeMLC,
    scheduleMLCClose: scheduleMLCClose,
    tglFlag: tglFlag,
    clearErrorLog: clearErrorLog,
    clearMlcTimer: clearMlcTimer,
    cpAllPage: cpAllPage,
    cpFormats: cpFormats,
    wxGeocode: wxGeocode,
    wxRefresh: wxRefresh,
    wxSetView: wxSetView,
    wxLogToday: wxLogToday,
    wxLogManual: wxLogManual,
    wxCopyNotice: wxCopyNotice,
    wxDelLogEntry: wxDelLogEntry,
    defTipFor: defTipFor,
    showDefTip: showDefTip,
    hideDefTip: hideDefTip,
    exportGanttPNG: exportGanttPNG,
    startHold: startHold,
    cancelHold: cancelHold,
    clearSection: clearSection,
    undoClr: undoClr,
    undo: undo,
    redo: redo,
    updateUndoUi: updateUndoUi,
    setRegion: setRegion,
    askConfirm: askConfirm,
    cfmOk: cfmOk,
    cfmCancel: cfmCancel,
    keepMine: keepMine,
    keepTheirs: keepTheirs,
    restoreBaseline: restoreBaseline,
    cascadeGantt: cascadeGantt,
    toggleCritical: toggleCritical,
    tglLeadtimeLane: tglLeadtimeLane,
    dragCard: dragCard,
    dropCard: dropCard,
    dropCardLeadtime: dropCardLeadtime,
    populateSprint: populateSprint,
    openPrompt: openPrompt,
    openDrwToSave: openDrwToSave,
    openDrwToPrompts: openDrwToPrompts,
    jumpToDashTimeline: jumpToDashTimeline,
    openOM: openOM,
    closeOM: closeOM,
    cpOut: cpOut,
    loadClip: loadClip,
    saveProjectFile: saveProjectFile,
    loadProjectFile: loadProjectFile,
    saveBaseline: saveBaseline,
    checkAccess: checkAccess
  };

  // Auto-boot
  _boot();

})(MMGR);
window.MMGR = MMGR;

/* ============================================================
   Data-action event delegation system.
   Replaces all inline event handlers with data-action attributes.
   Usage: <button data-action="addTask">Add Task</button>
   ============================================================ */
(function() {   const ACTION_MAP = {
    // App controller
    'showSec': (el) => {
      const section = el.getAttribute('data-section');
      window.MMGR.App.showSec(section, el);
    },
    'swMeth': (el) => {
      const meth = el.getAttribute('data-meth');
      window.MMGR.App.swMeth(meth, el);
    },
    'swDtab': (el) => {
      window.MMGR.App.swDtab(el.getAttribute('data-tab'), el);
    },
    'addTask': () => window.MMGR.Tasks.addTask(),
    'delTask': (el) => window.MMGR.Tasks.delTask(el.getAttribute('data-id')),
    'indentTask': (el) => window.MMGR.Tasks.indentTask(el.getAttribute('data-id')),
    'outdentTask': (el) => window.MMGR.Tasks.outdentTask(el.getAttribute('data-id')),
    'tglPhase': (el) => window.MMGR.Tasks.tglPhase(el.getAttribute('data-id')),
    'tglWeather': (el) => window.MMGR.Tasks.tglWeather(el.getAttribute('data-id')),
    'tglLeadTime': (el) => window.MMGR.Tasks.tglLeadTime(el.getAttribute('data-id')),
    'openWbsImport': () => window.MMGR.Tasks.openWbsImport(),
    'wiPreview': () => window.MMGR.Tasks.wiPreview(),
    'wiCommit': () => window.MMGR.Tasks.wiCommit(),
    'openImportDates': () => window.MMGR.Tasks.openImportDates(),
    'idPreview': () => window.MMGR.Tasks.idPreview(),
    'idCommit': () => window.MMGR.Tasks.idCommit(),
    'saveSprint': () => window.MMGR.Tasks.saveSprint(),
    'addRisk': () => window.MMGR.Risks.addRisk(),
    'delRisk': (el) => window.MMGR.Risks.delRisk(parseInt(el.getAttribute('data-idx'))),
    'toggleRiskIssue': (el) => window.MMGR.Risks.toggleRiskIssue(parseInt(el.getAttribute('data-idx'))),
    'delIssue': (el) => window.MMGR.Risks.delIssue(parseInt(el.getAttribute('data-idx'))),
    'addResource': () => window.MMGR.Resources.addResource(),
    'delResource': (el) => window.MMGR.Resources.delResource(parseInt(el.getAttribute('data-idx'))),
    'pushResourcesToBudget': () => window.MMGR.Resources.pushResourcesToBudget(),
    'addBudgetLine': () => window.MMGR.Budget.addBudgetLine(),
    'delBudgetLine': (el) => window.MMGR.Budget.delBudgetLine(parseInt(el.getAttribute('data-idx'))),
    'updEnvelope': (el, e) => window.MMGR.Budget.updEnvelope(el.value, e && e.type),
    'addStake': () => window.MMGR.Stakeholders.addStake(),
    'delStake': (el) => window.MMGR.Stakeholders.delStake(parseInt(el.getAttribute('data-idx'))),
    'addChange': () => window.MMGR.Changes.addChange(),
    'delChange': (el) => window.MMGR.Changes.delChange(parseInt(el.getAttribute('data-idx'))),
    'addLog': () => window.MMGR.Log.addLog(),
    'delLog': (el) => window.MMGR.Log.delLog(parseInt(el.getAttribute('data-idx'))),
    'addCloseItem': () => window.MMGR.Closure.addCloseItem(),
    'delCloseItem': (el) => window.MMGR.Closure.delCloseItem(parseInt(el.getAttribute('data-idx'))),
    'addComms': () => window.MMGR.Comms.addComms(),
    'delComms': (el) => window.MMGR.Comms.delComms(parseInt(el.getAttribute('data-idx'))),
    'addDoc': () => window.MMGR.Documents.addDoc(),
    'delDoc': (el) => window.MMGR.Documents.delDoc(parseInt(el.getAttribute('data-idx'))),
    'addKPI': () => window.MMGR.Charter.addKPI(),
    'delKPI': (el) => window.MMGR.Charter.delKPI(parseInt(el.getAttribute('data-idx'))),
    'openChartUp': () => window.MMGR.Charter.openChartUp(),
    'closeChartUp': () => window.MMGR.Charter.closeChartUp(),
    'closeChartUpBg': (el, e) => { if (e.target === el) window.MMGR.Charter.closeChartUp(); },
    'regenChartPrompt': () => window.MMGR.Charter.regenChartPrompt(),
    'copyChartPrompt': () => window.MMGR.Charter.copyChartPrompt(),
    'applyChartAIOutput': () => window.MMGR.Charter.applyChartAIOutput(),
    'cpAllPage': (el) => window.MMGR.App.cpAllPage(el.getAttribute('data-section')),
    'cpFormats': (el) => window.MMGR.App.cpFormats(el.getAttribute('data-kind')),
    'exportGanttPNG': () => window.MMGR.App.exportGanttPNG(),
    'wxGeocode': () => window.MMGR.App.wxGeocode(),
    'wxRefresh': () => window.MMGR.App.wxRefresh(),
    'wxSetView': (el) => window.MMGR.App.wxSetView(el),
    'wxLogToday': () => window.MMGR.App.wxLogToday(),
    'wxLogManual': () => window.MMGR.App.wxLogManual(),
    'wxCopyNotice': () => window.MMGR.App.wxCopyNotice(),
    'delWeatherLogEntry': (el) => window.MMGR.App.wxDelLogEntry(el),
    // MASTER-ACTION-PLAN-v3-STRICT Rank 1: claim package + slip cause tags.
    'claimGenerate': () => window.MMGR.Claim.generate(),
    'claimSetCause': (el) => window.MMGR.Claim.setCause(el.getAttribute('data-task'), el.value),
    // MASTER-ACTION-PLAN-v3-STRICT Rank 2.1: digest generation is a read-only
    // compose; pinning writes the reference point into state.
    'digestGenerate': () => window.MMGR.Digest.generate(),
    'digestPin': () => window.MMGR.Digest.pin(),
    'meetSentiment': (el) => window.MMGR.Meetings.recordSentiment(el.getAttribute('data-val')),
    'tglLeadtimeReview': (el) => window.MMGR.Tasks.tglLeadtimeReview(el.getAttribute('data-id')),
    'openAiWin': () => window.MMGR.AiWin.open(),
    'closeAiWin': () => window.MMGR.AiWin.close(),
    'closeAiWinBg': (el, e) => { if (e.target === el) window.MMGR.AiWin.close(); },
    'aiPreset': (el) => window.MMGR.AiWin.preset(el.getAttribute('data-type')),
    'aiAttachContext': () => window.MMGR.AiWin.attachContext(),
    'aiCopy': () => window.MMGR.AiWin.copy(),
    'aiClear': () => window.MMGR.AiWin.clear(),
    // Rank 2.3: real model wiring — run preset / run question / settings.
    'aiRunPreset': (el) => window.MMGR.AiWin.runPreset(el.getAttribute('data-type')),
    'aiRun': () => window.MMGR.AiWin.runQuestion(),
    'aiCopyOut': () => window.MMGR.AiWin.copyOut(),
    'aiSetTier': (el) => { window.MMGR.AiWin.setAiCfg({ tier: el.value }); window.MMGR.AiWin.syncSettingsUI(); },
    'aiSetProvider': (el) => { window.MMGR.AiWin.setAiCfg({ provider: el.value }); window.MMGR.AiWin.syncSettingsUI(); },
    'aiSetEndpoint': (el) => window.MMGR.AiWin.setAiCfg({ endpoint: el.value }),
    'aiSetModel': (el) => window.MMGR.AiWin.setAiCfg({ model: el.value }),
    'aiSetKey': (el) => window.MMGR.AiWin.setAiCfg({ apiKey: el.value }),
    // Rank 3.4: viewport prompt answers write a device-level preference only
    // (localStorage, never project state) — safe in view-only. toggleFull is
    // a pure DOM class toggle.
    'vpAccept': (el) => window.MMGR.Viewport.accept(el.getAttribute('data-section')),
    'vpDismiss': (el) => window.MMGR.Viewport.dismiss(el.getAttribute('data-section')),
    'vpFull': (el) => window.MMGR.Viewport.toggleFull(el.getAttribute('data-section')),
    'cascadeGantt': () => window.MMGR.App.cascadeGantt(),
    'toggleCritical': (el) => window.MMGR.App.toggleCritical(el),
    'tglLeadtimeLane': (el) => window.MMGR.App.tglLeadtimeLane(el),
    'populateSprint': () => window.MMGR.App.populateSprint(),
    'openPrompt': (el) => window.MMGR.App.openPrompt(el.getAttribute('data-type')),
    'openDrwToSave': () => window.MMGR.App.openDrwToSave(),
    'openDrwToPrompts': (el) => window.MMGR.App.openDrwToPrompts(el.getAttribute('data-type')),
    'saveProjectFile': () => window.MMGR.App.saveProjectFile(),
    'saveBaseline': () => window.MMGR.App.saveBaseline(),
    'restoreBaseline': () => window.MMGR.App.restoreBaseline(),
    'undo': () => window.MMGR.App.undo(),
    'redo': () => window.MMGR.App.redo(),
    'setRegion': (el) => window.MMGR.App.setRegion(el.value),
    'cfmOk': () => window.MMGR.App.cfmOk(),
    'cfmCancel': () => window.MMGR.App.cfmCancel(),
    'keepMine': () => window.MMGR.App.keepMine(),
    'keepTheirs': () => window.MMGR.App.keepTheirs(),
    'openOM': () => window.MMGR.App.openOM(),
    'closeOM': () => window.MMGR.App.closeOM(),
    'cpOut': () => window.MMGR.App.cpOut(),
    'loadClip': () => window.MMGR.App.loadClip(),
    'openDrw': () => window.MMGR.App.openDrw(),
    'closeDrw': () => window.MMGR.App.closeDrw(),
    'undoClr': () => window.MMGR.App.undoClr(),
    'closeMLC': () => window.MMGR.App.closeMLC(),
    'closeWbsImport': () => window.MMGR.Tasks.closeWbsImport(),
    'closeWbsImportBg': (el, e) => { if (e.target === el) window.MMGR.Tasks.closeWbsImport(); },
    'closeImportDates': () => window.MMGR.Tasks.closeImportDates(),
    'closeImportDatesBg': (el, e) => { if (e.target === el) window.MMGR.Tasks.closeImportDates(); },
    'addRaciTaskFromPicker': (el) => { window.MMGR.Raci.addRaciTaskFromPicker(el.value); el.value = ''; },
    'addRaciPersonFromPicker': (el) => { window.MMGR.Raci.addRaciPersonFromPicker(el.value); el.value = ''; },
    'cycleRaci': (el, ev) => window.MMGR.Raci.cycleRaci(
      el.getAttribute('data-task'),
      el.getAttribute('data-person'),
      ev
    ),
    // Settings panel
    'setUserName': (el) => window.MMGR.App.setUserName(el.value),
    'tglTheme': (el) => { window.MMGR.App.tglTheme(); },
    'tglCh': (el) => { window.MMGR.App.tglCh(); },
    'tglFlag': (el) => window.MMGR.App.tglFlag(el),
    'clearErrorLog': () => window.MMGR.App.clearErrorLog(),
    // Rank 3.1: Core Mode vs Advanced Packs — toggling a pack mutates
    // state.packs (blocked in view-only, like every other write). Same
    // checkbox convention as tglFlag: Chrome has already flipped `checked`
    // before this runs, so read it as-is (no manual flip, no preventDefault).
    'tglPack': (el) => {
      const pack = el.getAttribute('data-pack');
      if (!pack) return;
      const on = el.type === 'checkbox' ? el.checked : (window.MMGR.State.getState().packs && window.MMGR.State.getState().packs[pack] !== false);
      window.MMGR.State.updateState(function(s) {
        if (!s.packs) s.packs = {};
        s.packs[pack] = on;
      });
      if (window.MMGR.Render && window.MMGR.Render.renderPacks) window.MMGR.Render.renderPacks();
      if (window.MMGR.Render && window.MMGR.Render.syncPackChips) window.MMGR.Render.syncPackChips();
      if (window.MMGR.App && window.MMGR.App.showToast) {
        window.MMGR.App.showToast('Advanced pack ' + pack + ' turned ' + (on ? 'on' : 'off') + '.', 'ok');
      }
    },
    'tglLock': () => window.MMGR.App.tglLock(),
    'setWorkWeek': (el) => window.MMGR.App.setWorkWeek(el.value),
    'loadProjectFileClick': () => { document.getElementById('load-file').click(); },
    'loadProjectFile': (el) => window.MMGR.App.loadProjectFile({ target: el }),
    'print': () => window.print(),
    // Charter fields
    'updCharter': (el) => {
      const field = el.getAttribute('data-charter-field');
      window.MMGR.Charter.updCharter(field, el.value);
    },
    // Closure fields
    'updClose': (el) => {
      const field = el.getAttribute('data-close-field');
      window.MMGR.Closure.updClose(field, el.value);
    },
    // Hold-to-clear is driven by pointerdown/pointerup delegation below,
    // NOT by click — a plain click must never start the hold countdown.
    // Drag and drop (Kanban)
    'dragDrop': (el) => {
      // Handled by special drag/drop event listeners
    },
    // Hold-to-clear runs on pointerdown delegation (never click), so the
    // click path is an explicit no-op — enforced by the headless audit.
    'startHold': () => {}, // pointerdown-only
    // Jump to timeline
    'jumpToDashTimeline': () => window.MMGR.App.jumpToDashTimeline(),
    // Generic field update for dynamic render templates (WBS, risks, etc.)
    // evtType ('input' vs 'change') is forwarded so table-rendering updaters
    // can save on keystroke but defer the re-render to blur/commit — a
    // re-render on every keystroke destroys the focused input (browser-verified).
    'updTaskField': (el, e) => {
      const id = el.getAttribute('data-id');
      const field = el.getAttribute('data-field');
      window.MMGR.Tasks.updTaskField(id, field, el.value, e && e.type);
    },
    'updKPI': (el) => {
      const idx = parseInt(el.getAttribute('data-idx'));
      const field = el.getAttribute('data-field');
      window.MMGR.Charter.updKPI(idx, field, el.value);
    },
    'updKPILink': (el) => window.MMGR.Charter.updKPILink(parseInt(el.getAttribute('data-idx')), el.value),
    'updKPIDir': (el) => window.MMGR.Charter.updKPIDir(parseInt(el.getAttribute('data-idx')), el.value),
    'updRaciTask': (el) => window.MMGR.Raci.updRaciTask(parseInt(el.getAttribute('data-idx')), el.value),
    'updRaciPerson': (el) => window.MMGR.Raci.updRaciPerson(parseInt(el.getAttribute('data-idx')), el.getAttribute('data-field'), el.value),
    'delRaciTask': (el) => window.MMGR.Raci.delRaciTask(parseInt(el.getAttribute('data-idx'))),
    'delRaciPerson': (el) => window.MMGR.Raci.delRaciPerson(parseInt(el.getAttribute('data-idx'))),
    'collapseAll': () => window.MMGR.Tasks.collapseAll(),
    'expandAll': () => window.MMGR.Tasks.expandAll(),
    'tglMilestone': (el) => window.MMGR.Tasks.tglMilestone(el.getAttribute('data-id')),
    'runMonteCarlo': () => window.MMGR.Schedule.runMonteCarlo(),
    'tglDMAICPhase': (el) => window.MMGR.Dmaic.tglDMAICPhase(el.getAttribute('data-phase')),
    'updDMAIC': (el) => window.MMGR.Dmaic.updDMAIC(el.getAttribute('data-phase'), el.getAttribute('data-field'), el.value),
    'uploadCharterDoc': () => window.MMGR.Charter.uploadCharterDoc(),
    'handleCharterUpload': (el) => window.MMGR.Charter.handleCharterUpload({ target: el }),
    'cuSwitchTab': (el) => window.MMGR.Charter.cuSwitchTab(el.getAttribute('data-which')),
    'addSpendEntry': () => window.MMGR.Spend.addSpendEntry(),
    'updSpendEntry': (el, e) => window.MMGR.Spend.updSpendEntry(parseInt(el.getAttribute('data-idx')), el.getAttribute('data-field'), el.value, e && e.type),
    'delSpendEntry': (el) => window.MMGR.Spend.delSpendEntry(parseInt(el.getAttribute('data-idx'))),
    // Meetings
    'startMeeting': (el) => window.MMGR.Meetings.startMeeting(el.getAttribute('data-kind')),
    'copyMeetingTemplate': (el) => window.MMGR.Meetings.copyMeetingTemplate(el.getAttribute('data-kind')),
    'openMeetPrompt': () => window.MMGR.Meetings.openMeetPrompt(),
    'tglMeetItem': (el) => window.MMGR.Meetings.tglMeetItem(parseInt(el.getAttribute('data-idx'))),
    'updMeetItemNote': (el) => window.MMGR.Meetings.updMeetItemNote(parseInt(el.getAttribute('data-idx')), el.value),
    'updMeetField': (el) => window.MMGR.Meetings.updMeetField(el.getAttribute('data-field'), el.value),
    'endMeeting': () => window.MMGR.Meetings.endMeeting(),
    'cancelActiveMeeting': () => window.MMGR.Meetings.cancelActiveMeeting(),
    'copyMeetingMinutes': (el) => window.MMGR.Meetings.copyMeetingMinutes(parseInt(el.getAttribute('data-id'))),
    'tglPromise': (el) => window.MMGR.Meetings.tglPromise(el.getAttribute('data-kind'), parseInt(el.getAttribute('data-idx'))),
    // Rank 1.5: meeting voice capture (mutates state — NOT in READONLY_SAFE_ACTIONS)
    'voiceStartCapture': () => window.MMGR.Voice.startCapture(),
    'voiceStopCapture': () => window.MMGR.Voice.stopCapture(),
    'voiceDiscardCapture': () => window.MMGR.Voice.discardCapture(false),
    // Tier 1: manual offline whisper transcription / retry (mutates state — blocked in view-only)
    'voiceTranscribeOffline': () => window.MMGR.Voice.transcribeOffline(),
    'voiceRecoverDismiss': () => window.MMGR.Voice.dismissRecovery(),
    'updField': (el, e) => {
      const module = el.getAttribute('data-module');
      const field = el.getAttribute('data-field');
      const idx = parseInt(el.getAttribute('data-idx'));
      const val = el.type === 'checkbox' ? el.checked : el.value;
      // Explicit module → { namespace, updater } map. No string surgery, so
      // a new module can never silently route to the wrong function.
      const MODULE_UPDATERS = {
        'Risks':        { ns: 'Risks', fn: 'updRisk' },
        'Issues':       { ns: 'Risks', fn: 'updIssue' }, // Issues live in Risks
        'Resources':    { ns: 'Resources', fn: 'updResource' },
        'Budget':       { ns: 'Budget', fn: 'updBudgetLine' },
        'Stakeholders': { ns: 'Stakeholders', fn: 'updStake' },
        'Changes':      { ns: 'Changes', fn: 'updChange' },
        'Log':          { ns: 'Log', fn: 'updLog' },
        // CloseItems' updater takes (index, done) — no field parameter.
        'CloseItems':   { ns: 'Closure', fn: 'updCloseItem', doneOnly: true },
        'Comms':        { ns: 'Comms', fn: 'updComms' },
        'Documents':    { ns: 'Documents', fn: 'updDoc' }
      };
      const target = MODULE_UPDATERS[module];
      if (!target) { console.warn('updField: no updater mapped for module "' + module + '"'); return; }
      const updater = window.MMGR[target.ns] && window.MMGR[target.ns][target.fn];
      if (typeof updater !== 'function') { console.warn('updField: ' + target.ns + '.' + target.fn + ' is not a function'); return; }
      // evtType forwarded (see 'updTaskField'): table-rendering updaters save
      // on `input` keystrokes and re-render on `change` so focus is kept.
      const evtType = e && e.type;
      if (target.doneOnly) {
        updater(idx, val, evtType);
      } else {
        updater(idx, field, val, evtType);
      }
    }
  };

  // ACTION-PLAN 4.1: read-only gate — the ONLY actions allowed in a
  // view-only scope are non-mutating ones (navigation, copy, print, drawer
  // views, report generation). Everything else is refused with a toast.
  const READONLY_SAFE_ACTIONS = {
    'showSec': 1, 'cpAllPage': 1, 'print': 1, 'openDrw': 1, 'closeDrw': 1,
    'swDtab': 1, 'openDrwToPrompts': 1, 'openDrwToSave': 1,
    'jumpToDashTimeline': 1, 'closeMLC': 1, 'openMeetPrompt': 1,
    'copyMeetingMinutes': 1, 'runMonteCarlo': 1, 'undoClr': 1,
    // Phase 7: wxRefresh (view the forecast) + wxCopyNotice (copy text) are
    // read-only; wxGeocode writes the site location config and wxLogToday /
    // wxLogManual write the LD-claim weather log — all stay blocked in
    // view-only mode. meetSentiment and tglLeadtimeReview mutate state too.
    'wxRefresh': 1, 'wxCopyNotice': 1,
    // Rank 3.1: tglPack mutates state.packs -> stays blocked in view-only.
    // Rank 1.1: claimGenerate composes a read-only package; claimSetCause
    // mutates slip tags and stays blocked in view-only mode.
    'claimGenerate': 1,
    // Rank 2.1: digestGenerate composes a read-only summary; digestPin writes
    // the reference snapshot and stays blocked in view-only mode.
    'digestGenerate': 1,
    // AI window: open/close/load/copy/attach are read-only. Rank 2.3's
    // aiRunPreset/aiRun WRITE state.aiOutputs and aiSet* writes state.config
    // — all correctly stay BLOCKED in view-only mode.
    'openAiWin': 1, 'closeAiWin': 1, 'closeAiWinBg': 1, 'aiPreset': 1,
    'aiAttachContext': 1, 'aiCopy': 1, 'aiClear': 1, 'aiCopyOut': 1,
    // Rank 1.5: dismissRecovery only hides a local chip (module flag + DOM)
    // — non-mutating, safe in view-only mode. The three capture actions
    // (voiceStartCapture/voiceStopCapture/voiceDiscardCapture) DO mutate
    // state and correctly stay blocked.
    'voiceRecoverDismiss': 1,
    // Rank 3.4: viewport preference is a device-level screen choice, not
    // project state — allowed in view-only (like theme is a preference, but
    // this one intentionally stays out of project state entirely).
    'vpAccept': 1, 'vpDismiss': 1, 'vpFull': 1
  };
  function guardReadonly(action) {
    // The ACTION_MAP delegation IIFE has no closure over the App module's
    // isReadonly() — route through the published API (MMGR.App.isReadonly).
    const ro = window.MMGR.App && typeof window.MMGR.App.isReadonly === 'function' && window.MMGR.App.isReadonly();
    if (!ro) return true;
    if (READONLY_SAFE_ACTIONS[action]) return true;
    if (window.MMGR.App && typeof window.MMGR.App.showToast === 'function') {
      window.MMGR.App.showToast('View-only mode — read-only access. Contact the admin for full access.', 'err');
    }
    return false;
  }

  // Click event delegation
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // P0 ("the dates are fighting me" — real-click path): editable field
    // controls (text/date inputs, selects, textareas) own their change/input
    // events; the delegated change/input listeners below are their ONLY
    // handlers. Firing their data-action on every click would re-render the
    // WBS row or derived panels mid-click (select dropdowns close, the native
    // date picker never opens because preventDefault suppresses the default
    // click action, and the next field is unclickable until the churn
    // settles). File inputs are skipped too so the native open-dialog default
    // is never prevented. Checkboxes keep their special-case handling below
    // (their click IS the action).
    const _tag = el.tagName;
    if (_tag === 'SELECT' || _tag === 'TEXTAREA' ||
        (_tag === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button')) {
      return;
    }
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) return;
    const handler = ACTION_MAP[action];
    if (handler) {
      if (el.tagName === 'INPUT' && el.type === 'checkbox') {
        // CRITICAL (browser-verified): Chrome toggles checkbox `checked` when
        // the click event is DISPATCHED — i.e. BEFORE this listener runs — and
        // a subsequent preventDefault() REVERTS it to the original value.
        // The old flip-then-preventDefault pattern therefore double-toggled
        // back to the pre-click value, leaving theme/crosshair/milestone
        // checkboxes dead. Fix: read the already-updated value as-is and let
        // the native toggle stand (no manual flip, no preventDefault).
        handler(el, e);
        return;
      }
      e.preventDefault();
      handler(el, e);
    }
  });

  // Change event delegation for input/select elements
  document.addEventListener('change', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) return;
    const handler = ACTION_MAP[action];
    if (handler && (action === 'updEnvelope' || action === 'saveSprint' || action === 'setWorkWeek' || action === 'setRegion' || action === 'loadProjectFile' || action === 'updCharter' || action === 'updClose' || action === 'setUserName' || action === 'addRaciTaskFromPicker' || action === 'addRaciPersonFromPicker' || action === 'updField' || action === 'updTaskField' || action === 'updKPI' || action === 'updKPILink' || action === 'updKPIDir' || action === 'updSpendEntry' || action === 'updRaciTask' || action === 'updRaciPerson' || action === 'claimSetCause' || action === 'aiSetTier' || action === 'aiSetProvider' || action === 'aiSetEndpoint' || action === 'aiSetModel' || action === 'aiSetKey')) {
      handler(el, e);
    }
  });

  // Rank 3.1: tglPack chips are checkboxes — the click delegation handles
  // them (checkbox click IS the action), and the action map entry above flips
  // state.packs. No change/input whitelist entry needed.

  // Input event delegation for textarea/input elements
  document.addEventListener('input', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) return;
    const handler = ACTION_MAP[action];
    if (handler && (action === 'updCharter' || action === 'updClose' || action === 'setUserName' || action === 'updEnvelope' || action === 'wiPreview' || action === 'idPreview' || action === 'regenChartPrompt' || action === 'updField' || action === 'updTaskField' || action === 'updKPI' || action === 'updSpendEntry' || action === 'updRaciTask' || action === 'updRaciPerson' || action === 'updDMAIC' || action === 'updMeetItemNote' || action === 'updMeetField' || action === 'handleCharterUpload' || action === 'aiSetEndpoint' || action === 'aiSetModel' || action === 'aiSetKey')) {
      handler(el, e);
    }
  });

  // 5.2 Definitions tooltips: any element with data-def="<term>" shows the
  // glossary entry on hover. Delegated mouseover/out — zero inline handlers.
  document.addEventListener('mouseover', function(e) {
    const el = e.target.closest && e.target.closest('[data-def]');
    if (el) window.MMGR.App.showDefTip(el, el.getAttribute('data-def'));
  });
  document.addEventListener('mouseout', function(e) {
    const el = e.target.closest && e.target.closest('[data-def]');
    if (el) window.MMGR.App.hideDefTip();
  });

  // RACI right-click cycles backward (feature 5) — contextmenu must be
  // prevented so the browser's menu never appears over the matrix.
  document.addEventListener('contextmenu', function(e) {
    const cell = e.target.closest && e.target.closest('[data-action="cycleRaci"]');
    if (cell) {
      e.preventDefault();
      window.MMGR.Raci.cycleRaci(cell.getAttribute('data-task'), cell.getAttribute('data-person'), { button: 2 });
    }
  });

  // RACI picker refresh on mousedown
  document.addEventListener('mousedown', function(e) {
    const el = e.target.closest('[data-action="addRaciTaskFromPicker"], [data-action="addRaciPersonFromPicker"]');
    if (el) {
      const action = el.getAttribute('data-action');
      if (action === 'addRaciTaskFromPicker') {
        window.MMGR.Raci.refreshRaciTaskPicker();
      } else if (action === 'addRaciPersonFromPicker') {
        window.MMGR.Raci.refreshRaciPersonPicker();
      }
    }
  });

  // MLC hover handling (mouseenter/mouseleave on meth buttons)
  // e.target can be the document node when synthetic/edge events fire —
  // guard every closest() so hover handling never throws.
  document.addEventListener('mouseenter', function(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-mlc]') : null;
    if (el) {
      window.MMGR.App.showMLC(el.getAttribute('data-mlc'));
    }
  }, true);

  document.addEventListener('mouseleave', function(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-mlc]') : null;
    if (el) {
      window.MMGR.App.scheduleMLCClose();
    }
  }, true);

  // MLC card hover — keep open
  document.addEventListener('mouseenter', function(e) {
    if (e.target && e.target.closest && e.target.closest('#meth-learn-card')) {
      window.MMGR.App.clearMlcTimer();
    }
  }, true);

  document.addEventListener('mouseleave', function(e) {
    if (e.target && e.target.closest && e.target.closest('#meth-learn-card')) {
      window.MMGR.App.scheduleMLCClose();
    }
  }, true);

  // Kanban drag and drop
  document.addEventListener('dragstart', function(e) {
    const el = e.target.closest('[data-drag-id]');
    if (el) {
      window.MMGR.App.dragCard(e, el.getAttribute('data-drag-id'));
    }
  });

  document.addEventListener('dragover', function(e) {
    const col = e.target.closest('[data-drop-status]');
    if (col) {
      e.preventDefault();
      col.classList.add('dov');
    }
  });

  document.addEventListener('dragleave', function(e) {
    const col = e.target.closest('[data-drop-status]');
    if (col) {
      col.classList.remove('dov');
    }
  });

  document.addEventListener('drop', function(e) {
    const col = e.target.closest('[data-drop-status]');
    if (!col) return;
    e.preventDefault();
    const status = col.getAttribute('data-drop-status');
    if (status === 'leadtime') {
      window.MMGR.App.dropCardLeadtime(e);
    } else {
      window.MMGR.App.dropCard(e, status);
    }
  });

  // Hold-to-clear: start the hold on pointer down; cancel on release,
  // pointer cancel, leaving the button, or window blur. cancelHold is a
  // no-op when no hold is active, so these may be global listeners.
  document.addEventListener('pointerdown', function(e) {
    const el = e.target.closest('[data-action="startHold"]');
    if (el) window.MMGR.App.startHold(el.getAttribute('data-section'));
  });

  // Release anywhere cancels — cancelHold is a no-op when nothing is held,
  // so no closest() gating is needed (and it covers releases over other
  // elements, re-rendered buttons, and pointer-capture edge cases).
  document.addEventListener('pointerup', () => window.MMGR.App.cancelHold());

  document.addEventListener('pointercancel', () => window.MMGR.App.cancelHold());

  document.addEventListener('mouseleave', function(e) {
    if (e.target.closest && e.target.closest('[data-action="startHold"]')) window.MMGR.App.cancelHold();
  }, true);

  window.addEventListener('blur', () => window.MMGR.App.cancelHold());
})();