/* ============================================================
   js/app/search.js - T-13 search core (UI-IA-AND-MCP-DIRECTIVE
   2026-11-11).

   Builds a fresh index of every feature, setting, tab, guide entry,
   prompt, shortcut, action, page and field-guide sheet, then answers
   a query with a deterministic score. The UI palette is T-14; this
   module is the data + ranking half only.

   Design rules from the directive:
     - buildIndex() runs on EVERY open. ~170 entries cost about a
       millisecond, and a fresh build removes the whole "the index
       went stale after a pack toggle" class of bug. No cache, no
       event subscriptions.
     - Scoring is deterministic and library-free: label exact 1000,
       label prefix 800, word-boundary prefix 600, alias exact 500,
       alias prefix 450 (compact project titles), subsequence 300
       (gap-penalised), hint/group contains 200.
       Tie-break: weight desc, label length asc, DOM order. Cap 12.
     - Gating reuses the existing guards, never a copy: pack-off
       sections are replaced by one synthetic "turn the pack on"
       result; editor/client scope is excluded with no synthetic
       result; [hidden] rows are excluded by the visibility filter.
     - Zero network requests: every source is DOM or a static table.

   T-15 (same directive): the palette rides every surface. Each page gets
   its own index - the project workspace indexes its sections and drawer,
   the launcher indexes its rail and projects, the admin panel indexes its
   rail and cards, the calculator indexes its cards and guide steps - so a
   result always names real UI on the page the reader is looking at.

   Exports: MMGR.AppSearch = { buildIndex, search, open, close, toggle,
   isOpen, surface, MAX_RESULTS }.
   ============================================================ */
(function (MMGR) {
  'use strict';

  var MAX_RESULTS = 12;

  // ---- Static page table (~12 rows) ------------------------------------
  var PAGES = [
    {
      id: 'app',
      label: 'Projects dashboard',
      hint: 'All your projects in one place',
      href: 'app.html',
      icon: 'i-home'
    },
    {
      id: 'admin',
      label: 'Admin',
      hint: 'Project list and operator tools',
      href: 'admin.html',
      icon: 'i-tool'
    },
    {
      id: 'calculator',
      label: 'Calculator',
      hint: 'Trades and build-cost calculator',
      href: 'calculator.html',
      icon: 'i-calculator'
    },
    {
      id: 'field-guide',
      label: 'Field guide',
      hint: 'Every panel explained, sheet by sheet',
      href: 'mymanager-field-guide.html',
      icon: 'i-book'
    },
    {
      id: 'dashboard',
      label: 'Market dashboard',
      hint: 'Feature and market view',
      href: 'dashboard.html',
      icon: 'i-bar-chart'
    },
    {
      id: 'pricing',
      label: 'Pricing',
      hint: 'Plans and upgrade',
      href: 'pricing.html',
      icon: 'i-dollar'
    },
    {
      id: 'features',
      label: 'Features',
      hint: 'What the app does',
      href: 'features.html',
      icon: 'i-sparkle'
    },
    { id: 'about', label: 'About', hint: 'Who makes it', href: 'about.html', icon: 'i-users' },
    { id: 'contact', label: 'Contact', hint: 'Get in touch', href: 'contact.html', icon: 'i-mail' },
    {
      id: 'privacy',
      label: 'Privacy',
      hint: 'What we store',
      href: 'privacy.html',
      icon: 'i-lock'
    },
    { id: 'terms', label: 'Terms', hint: 'Terms of use', href: 'terms.html', icon: 'i-file-text' },
    {
      id: 'refund',
      label: 'Refund policy',
      hint: 'Refunds',
      href: 'refund.html',
      icon: 'i-refresh'
    }
  ];

  // ---- Field-guide sheets (36 rows, kept honest by T-18) ----------------
  // Ascending, A-00 through A-35. Signing In is A-35 (T-18): it used to share
  // A-26 with the Shared Resource Pool, which made both sheets unfindable by
  // number.
  var SHEETS = [
    { no: 'A-00', id: 'welcome', title: 'Welcome & Orientation' },
    { no: 'A-01', id: 'quickstart', title: 'Your First 15 Minutes' },
    { no: 'A-02', id: 'dashboard', title: 'Dashboard & Health Score' },
    { no: 'A-03', id: 'charter', title: 'Charter & Definitions' },
    { no: 'A-04', id: 'wbs', title: 'WBS, Gantt & Critical Path' },
    { no: 'A-05', id: 'kanban', title: 'Kanban & RACI' },
    { no: 'A-06', id: 'resources', title: 'Resources & Budget' },
    { no: 'A-07', id: 'risk', title: 'Risk, Issues & Simulation' },
    { no: 'A-08', id: 'records', title: 'Stakeholders, Changes & Closure' },
    { no: 'A-09', id: 'meetings', title: 'Meetings & Agenda Templates' },
    { no: 'A-10', id: 'voice', title: 'Voice Capture & Field Reports' },
    { no: 'A-11', id: 'claim', title: 'Claim Pack & Voice-to-Claim' },
    { no: 'A-12', id: 'comms', title: 'Comms Log & Documents' },
    { no: 'A-13', id: 'ai', title: 'AI Assistant' },
    { no: 'A-14', id: 'dmaic', title: 'DMAIC (Six Sigma Mode)' },
    { no: 'A-15', id: 'data', title: 'Data, Backup & Access' },
    { no: 'A-16', id: 'weather', title: 'Weather & Forecast' },
    { no: 'A-17', id: 'interface', title: 'Interface & Shortcuts' },
    { no: 'A-18', id: 'trouble', title: 'When Something Looks Off' },
    { no: 'A-19', id: 'faq', title: 'Frequently Asked' },
    { no: 'A-20', id: 'projects-admin', title: 'Projects, Admin & Create Your Own' },
    { no: 'A-21', id: 'bids-compliance', title: 'Bids, Compliance & Go/No-Go' },
    { no: 'A-22', id: 'rfi-field-metrics', title: 'RFIs, Submittals & Field Metrics' },
    { no: 'A-23', id: 'registers-compliance', title: 'Registers, Compliance & Handover' },
    { no: 'A-24', id: 'reviews-window', title: 'Public Reviews Window' },
    { no: 'A-25', id: 'calculator', title: 'Floating Calculator & Trades Math' },
    { no: 'A-26', id: 'shared-pool', title: 'Shared Resource Pool' },
    { no: 'A-27', id: 'connect-ai', title: 'Connect an Outside AI' },
    { no: 'A-28', id: 'api-keys', title: 'API Keys & Rotation' },
    { no: 'A-29', id: 'deadline', title: 'Project Deadline & Float' },
    { no: 'A-30', id: 'build-cost', title: 'Build Cost Calculator' },
    { no: 'A-31', id: 'procurement', title: 'Procurement & Quotes' },
    { no: 'A-32', id: 'named-team', title: 'Named Team Members' },
    { no: 'A-33', id: 'budget-boq', title: 'Budget from BOQ, Deliveries & Approvals' },
    { no: 'A-34', id: 'ideas', title: 'Intake & Agenda' },
    { no: 'A-35', id: 'signin', title: 'Signing In' }
  ];

  // ---- Action allow-list ------------------------------------------------
  var ACTIONS = [
    {
      id: 'undo',
      label: 'Undo',
      hint: 'Undo the last change',
      icon: 'i-corner-down-left',
      action: 'undo'
    },
    {
      id: 'redo',
      label: 'Redo',
      hint: 'Redo the last undone change',
      icon: 'i-refresh',
      action: 'redo'
    },
    {
      id: 'save',
      label: 'Save project',
      hint: 'Download the project as a .json file',
      icon: 'i-save',
      action: 'saveProjectFile'
    },
    {
      id: 'load',
      label: 'Load project',
      hint: 'Open a .json project file',
      icon: 'i-folder-open',
      action: 'loadProjectFileClick'
    },
    {
      id: 'merge',
      label: 'Merge project',
      hint: 'Merge a .json file into this project',
      icon: 'i-refresh',
      action: 'mergeProjectFileClick'
    },
    {
      id: 'print',
      label: 'Print / PDF',
      hint: 'Print the sheet or save as PDF',
      icon: 'i-printer',
      action: 'print'
    },
    {
      id: 'backup',
      label: 'Backup',
      hint: 'Save or load a backup',
      icon: 'i-download',
      action: 'saveProjectFile'
    },
    {
      id: 'signin',
      label: 'Sign in',
      hint: 'Sign in to sync projects',
      icon: 'i-user',
      action: 'openSignIn'
    },
    {
      id: 'settings',
      label: 'Settings',
      hint: 'Open the controls drawer',
      icon: 'i-settings',
      action: ''
    }
  ];

  // ---- Hand-authored aliases (~40 rows) ---------------------------------
  // Each row maps everyday words to an entry by label (or action:<id>).
  var ALIASES = [
    {
      terms: ['mcp', 'model context protocol', 'claude', 'cursor', 'api'],
      target: 'Connect an AI'
    },
    { terms: ['ai', 'assistant', 'chat', 'gemini', 'openai'], target: 'AI Assistant' },
    {
      terms: ['dark mode', 'theme', 'appearance', 'light mode', 'colour', 'color'],
      target: 'Look & feel'
    },
    { terms: ['backup', 'save a copy', 'export'], target: 'Export' },
    { terms: ['drive', 'google drive', 'gdrive'], target: 'Drive backup' },
    { terms: ['cloud', 'sync', 'backup to cloud'], target: 'Cloud & Sync' },
    { terms: ['undo'], target: 'action:undo' },
    { terms: ['redo'], target: 'action:redo' },
    { terms: ['keyboard', 'shortcuts', 'hotkeys', 'keys'], target: 'shortcut:sheet' },
    { terms: ['budget', 'money', 'evm', 'cost'], target: 'Budget' },
    { terms: ['risk', 'monte carlo', 'simulation', 'issues'], target: 'Risk / Issues' },
    { terms: ['schedule', 'gantt', 'critical path'], target: 'Gantt' },
    { terms: ['tasks', 'wbs', 'breakdown'], target: 'WBS' },
    { terms: ['team', 'raci', 'roles', 'people'], target: 'RACI' },
    { terms: ['photos', 'pictures', 'images'], target: 'Photos' },
    { terms: ['meetings', 'minutes'], target: 'Meetings' },
    { terms: ['claim', 'delay', 'weather delay'], target: 'Claim Pack' },
    { terms: ['procurement', 'suppliers', 'quotes', 'purchase'], target: 'Procurement' },
    { terms: ['stakeholders', 'contacts'], target: 'Stakeholders' },
    { terms: ['changes', 'variations'], target: 'Changes' },
    { terms: ['documents', 'files', 'docs'], target: 'Documents' },
    { terms: ['closure', 'close out', 'handover'], target: 'Closure' },
    { terms: ['charter', 'brief'], target: 'Charter' },
    { terms: ['dashboard', 'home', 'overview'], target: 'Dashboard' },
    { terms: ['kanban', 'board', 'sprint'], target: 'Kanban' },
    { terms: ['intake', 'ideas', 'suggestions'], target: 'Intake' },
    { terms: ['dmaic', 'six sigma', 'quality'], target: 'DMAIC' },
    { terms: ['calculator', 'math', 'trades', 'estimate'], target: 'Calculator' },
    { terms: ['field guide', 'help', 'manual'], target: 'Field guide' },
    { terms: ['print', 'pdf', 'paper'], target: 'Print / PDF' },
    { terms: ['save', 'download', 'json'], target: 'Save project' },
    { terms: ['load', 'open file', 'import'], target: 'Load project' },
    { terms: ['sign in', 'login', 'account', 'google'], target: 'Sign in' },
    { terms: ['settings', 'controls', 'preferences', 'options'], target: 'Settings' },
    { terms: ['weather', 'forecast', 'rain'], target: 'Weather Region' },
    { terms: ['resources', 'labour', 'labor', 'crew'], target: 'Resources' },
    { terms: ['planning', 'plan'], target: 'Planning' },
    { terms: ['comms', 'communication log', 'correspondence'], target: 'Comms Log' },
    { terms: ['decision log', 'decisions'], target: 'Decision Log' },
    { terms: ['packs', 'modules', 'features', 'advanced'], target: 'Packs' }
  ];

  // Pack labels used when a pack is switched off. One synthetic result
  // replaces every section the pack owns.
  var PACK_LABELS = {
    money: { label: 'Money pack', hint: 'Turn it on to see Budget, Resources, Procurement' },
    schedule: { label: 'Schedule pack', hint: 'Turn it on to see Gantt and scheduling tools' },
    governance: {
      label: 'Governance pack',
      hint: 'Turn it on to see RACI, Comms Log, Documents, Stakeholders, Changes, Decision Log, Risk'
    },
    field: { label: 'Field pack', hint: 'Turn it on to see Meetings, Photos, Claim Pack' },
    quality: { label: 'Quality pack', hint: 'Turn it on to see DMAIC' },
    procurement: { label: 'Procurement pack', hint: 'Turn it on to see Procurement' }
  };

  // ---- Helpers ----------------------------------------------------------
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function txt(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function slug(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  // Compact form: punctuation and spaces stripped. The launcher's own project
  // search matches "newtown" against "New Town Hotel Renovation" this way,
  // and the palette must not lose that behaviour (owner bug 2026-09-17).
  function compact(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }
  // Which page is this? Each surface indexes its own real UI.
  function surfaceName() {
    if (document.body && document.body.classList.contains('calculator-page')) {
      return 'calculator';
    }
    if (document.getElementById('admin-app')) {
      return 'admin';
    }
    if (document.getElementById('sec-nav') || document.getElementById('db-ctrl')) {
      return 'project';
    }
    return 'launcher';
  }
  // The [hidden] attribute is the gate. We deliberately do NOT use computed
  // display:none here: a setting that lives in a non-active tab panel is
  // display:none via .is-hide, and it must still be searchable.
  function isHidden(el) {
    if (!el) {
      return true;
    }
    if (el.hasAttribute && el.hasAttribute('hidden')) {
      return true;
    }
    if (el.closest && el.closest('[hidden]')) {
      return true;
    }
    return false;
  }
  // The visible label of a row, with form-control text stripped. A theme row
  // reads "Theme" from its <label>, never "ThemeLightDarkSystem...".
  function labelOf(el) {
    if (!el) {
      return '';
    }
    var clone = el.cloneNode(true);
    var controls = clone.querySelectorAll(
      'select, option, input, button, textarea, .bcp-hist-note'
    );
    for (var i = 0; i < controls.length; i++) {
      if (controls[i].parentNode) {
        controls[i].parentNode.removeChild(controls[i]);
      }
    }
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function iconFrom(el, fallback) {
    var use = el ? el.querySelector('use') : null;
    if (use) {
      var href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      var i = href.indexOf('#i-');
      if (i > -1) {
        return href.slice(i + 1);
      }
    }
    return fallback || 'i-search';
  }
  function elById(id) {
    return id ? document.getElementById(id) : null;
  }
  function flash(el) {
    if (!el || !el.classList) {
      return;
    }
    el.classList.add('search-hit');
    setTimeout(function () {
      el.classList.remove('search-hit');
    }, 1600);
  }

  // ---- Reveal seams (reused by the palette in T-14) ---------------------
  function revealSection(id) {
    if (window.MMGR && MMGR.App && MMGR.App.showSec) {
      var btn = $('.sec-btn[data-section="' + id + '"]');
      MMGR.App.showSec(id, btn);
    }
  }
  function openDrawerTab(tabKey) {
    if (window.MMGR && MMGR.App && MMGR.App.openDrw) {
      MMGR.App.openDrw();
    }
    var btn = $('.dtab[data-tab="' + tabKey + '"]');
    if (btn && window.MMGR && MMGR.App && MMGR.App.swDtab) {
      MMGR.App.swDtab(tabKey, btn);
    }
  }
  function focusSetting(group, tab, id) {
    openDrawerTab('ctrl');
    if (window.MMGR && MMGR.AppControls && MMGR.AppControls.focus) {
      MMGR.AppControls.focus(group, tab);
    }
    var el = elById(id);
    if (el) {
      if (el.scrollIntoView) {
        el.scrollIntoView({ block: 'center' });
      }
      flash(el);
    }
  }
  function runAction(action) {
    if (!action) {
      return;
    }
    var el = $('[data-action="' + action + '"]');
    if (el && el.click) {
      el.click();
      return;
    }
    if (window.MMGR && MMGR.App && typeof MMGR.App[action] === 'function') {
      MMGR.App[action]();
    }
  }

  // ---- Surface collectors (T-15) ---------------------------------------
  // Launcher: the rail plus every project the page can open. Projects come
  // from the SAME source the #ps-modal reads (searchCandidates), so the two
  // searches can never disagree about what exists.
  function collectLauncher(push) {
    $$('#db-sidebar .db-link, #sidebar-icons .sidebar-icon').forEach(function (el) {
      if (isHidden(el)) {
        return;
      }
      var sub = el.closest ? el.closest('.db-sub') : null;
      if (sub && sub.hidden) {
        return;
      }
      var label = txt(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '';
      if (!label) {
        return;
      }
      push({
        id: 'lnav-' + slug(label),
        kind: 'section',
        label: label,
        hint: 'Launcher',
        group: 'Go to',
        icon: iconFrom(el, 'i-arrow-right'),
        weight: 70,
        run: function () {
          el.click();
        }
      });
    });

    if (typeof window.searchCandidates !== 'function') {
      return;
    }
    var list = [];
    try {
      list = window.searchCandidates() || [];
    } catch (e) {
      list = [];
    }
    list.forEach(function (p) {
      var title = p.title || p.id || 'Untitled';
      var where = p.demo ? 'Demo project' : p._src === 'cloud' ? 'Cloud project' : 'Project';
      push({
        id: 'lproj-' + (p.id || slug(title)),
        kind: 'project',
        label: title,
        hint: p.description ? String(p.description).slice(0, 90) : where,
        group: 'Projects',
        icon: 'i-folder',
        weight: 130,
        aliases: [compact(title)],
        run: function () {
          location.href = 'project.html?id=' + encodeURIComponent(p.id || '');
        }
      });
    });
  }

  // Admin: its rail (including the closed Site operator tools disclosure) and
  // its cards, plus the project rows the panel is showing.
  function collectAdmin(push) {
    $$('#db-nav .db-link').forEach(function (el) {
      if (isHidden(el)) {
        return;
      }
      var sub = el.closest ? el.closest('.db-sub') : null;
      if (sub && sub.hidden) {
        return;
      }
      var label = txt(el);
      if (!label) {
        return;
      }
      push({
        id: 'adnav-' + slug(label),
        kind: 'section',
        label: label,
        hint: 'Admin menu',
        group: 'Go to',
        icon: iconFrom(el, 'i-arrow-right'),
        weight: 70,
        run: function () {
          var href = el.getAttribute ? el.getAttribute('href') : '';
          var target = href && href.charAt(0) === '#' ? document.querySelector(href) : null;
          if (target && target.tagName === 'DETAILS') {
            target.open = true;
          }
          el.click();
          if (target && target.scrollIntoView) {
            target.scrollIntoView({ block: 'start' });
          }
        }
      });
    });

    $$('#admin-app .card').forEach(function (card) {
      if (isHidden(card)) {
        return;
      }
      var titleEl = card.querySelector('.card-title');
      var label = labelOf(titleEl);
      if (!label) {
        return;
      }
      push({
        id: 'adcard-' + slug(label),
        kind: 'setting-group',
        label: label,
        hint: 'Admin card',
        group: 'Admin',
        icon: iconFrom(titleEl, 'i-list'),
        weight: 60,
        run: function () {
          var d = card.closest ? card.closest('details') : null;
          if (d) {
            d.open = true;
          }
          if (card.scrollIntoView) {
            card.scrollIntoView({ block: 'center' });
          }
          flash(card);
        }
      });
    });

    $$('#project-list .prow').forEach(function (row) {
      if (isHidden(row)) {
        return;
      }
      var titleEl = row.querySelector('.prow-title');
      var label = labelOf(titleEl);
      if (!label) {
        return;
      }
      push({
        id: 'adproj-' + slug(label),
        kind: 'project',
        label: label,
        hint: 'Open this project from the admin panel',
        group: 'Projects',
        icon: 'i-folder',
        weight: 130,
        aliases: [compact(label)],
        run: function () {
          var a = row.querySelector('.prow-actions a[href^="project.html"]');
          if (a) {
            a.click();
          }
        }
      });
    });
  }

  // Calculator: its cards and the How to use steps. The steps live in JS, not
  // in the DOM (one is rendered at a time), so calculator-page.js exports the
  // list and a jump-to-step hook.
  function collectCalculator(push) {
    $$('#main .card').forEach(function (card) {
      if (isHidden(card)) {
        return;
      }
      var titleEl = card.querySelector('.card-title');
      var label = labelOf(titleEl);
      if (!label) {
        return;
      }
      push({
        id: 'calccard-' + slug(label),
        kind: 'setting-group',
        label: label,
        hint: 'Calculator card',
        group: 'Calculator',
        icon: iconFrom(titleEl, 'i-calculator'),
        weight: 70,
        run: function () {
          if (card.scrollIntoView) {
            card.scrollIntoView({ block: 'center' });
          }
          flash(card);
        }
      });
    });

    var steps = window.MMGR_CALC_GUIDE;
    if (!steps || !steps.length) {
      return;
    }
    steps.forEach(function (text, i) {
      var label = String(text || '')
        .split(/[.!?]/)[0]
        .trim();
      if (!label) {
        return;
      }
      if (label.length > 72) {
        label = label.slice(0, 69) + '...';
      }
      push({
        id: 'calcstep-' + i,
        kind: 'guide',
        label: label,
        hint: 'How to use, step ' + (i + 1) + ' of ' + steps.length,
        group: 'How to use',
        icon: 'i-book',
        weight: 40,
        run: function () {
          if (typeof window.MMGR_CALC_GUIDE_GOTO === 'function') {
            window.MMGR_CALC_GUIDE_GOTO(i);
          }
        }
      });
    });
  }

  // ---- Index build ------------------------------------------------------
  function buildIndex() {
    var entries = [];
    var order = 0;
    var SURFACE = surfaceName();
    function push(e) {
      e.order = order++;
      e.aliases = e.aliases || [];
      e.weight = e.weight || 0;
      entries.push(e);
    }

    // 1) Project sections. A pack-off section (is-hide) is excluded; one
    //    synthetic result per off pack is added below.
    var offPacks = {};
    $$('#sec-nav .sec-btn').forEach(function (btn) {
      if (isHidden(btn)) {
        return;
      }
      var pack = btn.getAttribute('data-pack');
      if (pack && btn.classList.contains('is-hide')) {
        offPacks[pack] = true;
        return;
      }
      var sec = btn.getAttribute('data-section');
      if (!sec) {
        return;
      }
      var grp = btn.closest('.nav-group');
      var grpLabel = grp ? txt(grp.querySelector('.nav-group-label')) : '';
      var label = txt(btn)
        .replace(/\s*\d+\s*$/, '')
        .trim();
      push({
        id: 'sec-' + sec,
        kind: 'section',
        label: label,
        hint: grpLabel ? grpLabel + ' section' : 'Section',
        group: grpLabel,
        icon: iconFrom(btn),
        weight: 80,
        run: function () {
          revealSection(sec);
        }
      });
    });
    // Pack state can also be read from the pack toggles when no nav button
    // carries the pack (defensive: the nav is the primary signal).
    Object.keys(PACK_LABELS).forEach(function (pack) {
      if (offPacks[pack]) {
        push({
          id: 'pack-' + pack,
          kind: 'setting-group',
          label: PACK_LABELS[pack].label,
          hint: PACK_LABELS[pack].hint,
          group: 'Packs',
          icon: 'i-cube',
          weight: 60,
          aliases: [pack],
          run: function () {
            openDrawerTab('ctrl');
            if (window.MMGR && MMGR.AppControls && MMGR.AppControls.focus) {
              MMGR.AppControls.focus('workspace', 'packs');
            }
          }
        });
      }
    });

    // 2) Controls drawer: setting groups, settings, format cards, tabs.
    var ctrl = document.getElementById('db-ctrl');
    if (ctrl) {
      $$('#db-ctrl .ctl-sec[data-ctl-group]').forEach(function (sec) {
        if (isHidden(sec)) {
          return;
        }
        var key = sec.getAttribute('data-ctl-group');
        var label = txt(sec);
        push({
          id: 'grp-' + key,
          kind: 'setting-group',
          label: label,
          hint: 'Settings group',
          group: label,
          icon: iconFrom(sec, 'i-settings'),
          weight: 70,
          run: function () {
            openDrawerTab('ctrl');
            if (window.MMGR && MMGR.AppControls && MMGR.AppControls.setOpen) {
              MMGR.AppControls.setOpen(key, true);
            }
          }
        });
      });

      // Settings rows (.sr .sl), excluding the dynamically rendered MCP
      // block (represented by the explicit Connect an AI entry below).
      $$('#db-ctrl .sr .sl').forEach(function (sl) {
        if (isHidden(sl) || (sl.closest && sl.closest('#ctrl-mcp'))) {
          return;
        }
        var row = sl.closest('.sr');
        if (!row) {
          return;
        }
        var panel = row.closest('[data-ctl-panel]');
        var body = row.closest('[data-ctl-group-body]');
        var tab = panel ? panel.getAttribute('data-ctl-panel') : '';
        var groupKey = body ? body.getAttribute('data-ctl-group-body') : '';
        var groupSec = groupKey ? $('.ctl-sec[data-ctl-group="' + groupKey + '"]') : null;
        var groupLabel = txt(groupSec);
        var label = labelOf(sl);
        if (!label) {
          return;
        }
        var rowId = row.id || (row.querySelector('[id]') ? row.querySelector('[id]').id : '');
        push({
          id: 'set-' + (rowId || slug(groupKey + '-' + tab + '-' + label)),
          kind: 'setting',
          label: label,
          hint: groupLabel ? groupLabel + (tab ? ' > ' + tab : '') : 'Setting',
          group: groupLabel,
          icon: iconFrom(sl, 'i-settings'),
          weight: 60,
          run: (function (g, t, id) {
            return function () {
              focusSetting(g, t, id);
            };
          })(groupKey, tab, rowId)
        });
      });

      // Format cards (digests / emails).
      $$('#db-ctrl .fmt-card .fmt-title').forEach(function (t) {
        if (isHidden(t)) {
          return;
        }
        var card = t.closest('.fmt-card');
        var panel = card ? card.closest('[data-ctl-panel]') : null;
        var body = card ? card.closest('[data-ctl-group-body]') : null;
        var tab = panel ? panel.getAttribute('data-ctl-panel') : '';
        var groupKey = body ? body.getAttribute('data-ctl-group-body') : '';
        var groupSec = groupKey ? $('.ctl-sec[data-ctl-group="' + groupKey + '"]') : null;
        var groupLabel = txt(groupSec);
        push({
          id: 'fmt-' + slug(txt(t)),
          kind: 'setting',
          label: txt(t),
          hint: groupLabel ? groupLabel + ' > ' + tab : 'Format',
          group: groupLabel,
          icon: iconFrom(t, 'i-file-text'),
          weight: 55,
          run: (function (g, tb) {
            return function () {
              focusSetting(g, tb, '');
            };
          })(groupKey, tab)
        });
      });

      // Tabs inside groups.
      $$('#db-ctrl .dtab[data-ctl-tab]').forEach(function (tabEl) {
        if (isHidden(tabEl)) {
          return;
        }
        var body = tabEl.closest('[data-ctl-group-body]');
        var groupKey = body ? body.getAttribute('data-ctl-group-body') : '';
        var groupSec = groupKey ? $('.ctl-sec[data-ctl-group="' + groupKey + '"]') : null;
        var groupLabel = txt(groupSec);
        var tabKey = tabEl.getAttribute('data-ctl-tab');
        push({
          id: 'tab-' + groupKey + '-' + tabKey,
          kind: 'tab',
          label: txt(tabEl),
          hint: groupLabel ? groupLabel + ' tab' : 'Tab',
          group: groupLabel,
          icon: 'i-folder',
          weight: 50,
          run: (function (g, t) {
            return function () {
              focusSetting(g, t, '');
            };
          })(groupKey, tabKey)
        });
      });
    }

    // Top-level drawer tabs (Controls / Guide / Q&A / Prompt ...).
    $$('#drw .dtab[data-tab]').forEach(function (tabEl) {
      if (isHidden(tabEl)) {
        return;
      }
      var key = tabEl.getAttribute('data-tab');
      push({
        id: 'drw-' + key,
        kind: 'tab',
        label: txt(tabEl),
        hint: 'Drawer tab',
        group: 'Drawer',
        icon: 'i-folder',
        weight: 45,
        run: function () {
          openDrawerTab(key);
        }
      });
    });

    // 3) Guide entries (drawer Guide and Q&A panels).
    ['#db-feat', '#db-qa'].forEach(function (rootSel) {
      $$(rootSel + ' .fi').forEach(function (fi) {
        if (isHidden(fi)) {
          return;
        }
        var fn = fi.querySelector('.fn');
        if (!fn) {
          return;
        }
        var label = labelOf(fn);
        var fd = fi.querySelector('.fd');
        var drawerTab = rootSel === '#db-feat' ? 'feat' : 'qa';
        push({
          id: 'guide-' + slug(label),
          kind: 'guide',
          label: label,
          hint: fd ? txt(fd) : 'Guide',
          group: rootSel === '#db-feat' ? 'Guide' : 'Q&A',
          icon: iconFrom(fn, 'i-book'),
          weight: 40,
          run: function () {
            openDrawerTab(drawerTab);
            var target = fi;
            if (target && target.scrollIntoView) {
              target.scrollIntoView({ block: 'center' });
            }
            flash(target);
          }
        });
      });
    });

    // 4) Prompt chips.
    $$('#db-prompt [data-action="openPrompt"]').forEach(function (btn) {
      if (isHidden(btn)) {
        return;
      }
      push({
        id: 'prompt-' + slug(txt(btn)),
        kind: 'prompt',
        label: txt(btn),
        hint: 'Prompt',
        group: 'Prompts',
        icon: iconFrom(btn, 'i-sparkle'),
        weight: 35,
        run: function () {
          openDrawerTab('prompt');
          flash(btn);
        }
      });
    });

    // 5) Shortcuts (guarded: mmgr-shortcuts.js is not on every page).
    var sc = window.MMGR && MMGR.Shortcuts && MMGR.Shortcuts.table;
    if (sc) {
      var rows = (sc.app || []).concat(sc.calc || []);
      rows.forEach(function (r) {
        var what = r && r.what ? String(r.what) : '';
        if (!what) {
          return;
        }
        push({
          id: 'sc-' + slug(what),
          kind: 'shortcut',
          label: what,
          hint: r.keys ? 'Key: ' + r.keys : 'Shortcut',
          group: 'Shortcuts',
          icon: 'i-key',
          weight: 30,
          aliases: r.keys ? [String(r.keys)] : [],
          run: function () {
            if (window.MMGR && MMGR.Shortcuts && MMGR.Shortcuts.open) {
              MMGR.Shortcuts.open();
            }
          }
        });
      });
    }

    // 6) Action allow-list. These are project commands; other surfaces must
    //    not offer a result that can only no-op.
    if (SURFACE === 'project') {
      ACTIONS.forEach(function (a) {
        push({
          id: 'action-' + a.id,
          kind: 'action',
          label: a.label,
          hint: a.hint,
          group: 'Actions',
          icon: a.icon,
          weight: 65,
          run: (function (action, id) {
            return function () {
              if (id === 'settings') {
                openDrawerTab('ctrl');
                return;
              }
              runAction(action);
            };
          })(a.action, a.id)
        });
      });
    }

    // 7) Static pages.
    PAGES.forEach(function (p) {
      push({
        id: 'page-' + p.id,
        kind: 'page',
        label: p.label,
        hint: p.hint,
        group: 'Pages',
        icon: p.icon,
        weight: 20,
        run: function () {
          location.href = p.href;
        }
      });
    });

    // 8) Field-guide sheets.
    SHEETS.forEach(function (s) {
      push({
        id: 'sheet-' + s.id,
        kind: 'page',
        label: s.title,
        hint: 'Sheet ' + s.no + ' in the field guide',
        group: 'Field guide',
        icon: 'i-book',
        weight: 15,
        run: function () {
          location.href = 'mymanager-field-guide.html#' + s.id;
        }
      });
    });

    // 9) Surface-specific UI (T-15). Project collectors above already ran
    //    inert on other pages, so this only adds what that page really has.
    if (SURFACE === 'launcher') {
      collectLauncher(push);
    } else if (SURFACE === 'admin') {
      collectAdmin(push);
    } else if (SURFACE === 'calculator') {
      collectCalculator(push);
    }

    // 10) Explicit Connect an AI entry (the directive's MCP example). It is
    //    added even when the cloud-rendered MCP block is absent, so search
    //    for mcp / model context protocol is deterministic. Project only:
    //    the reveal opens the workspace drawer.
    if (SURFACE === 'project') {
      push({
        id: 'ctrl-connect-ai',
        kind: 'setting',
        label: 'Connect an AI',
        hint: 'Connect an outside AI to this project',
        group: 'Connect & Sync',
        icon: 'i-sparkle',
        weight: 95,
        aliases: ['mcp', 'model context protocol', 'claude', 'cursor', 'api'],
        run: function () {
          focusSetting('connect', 'ai', 'ctrl-mcp');
        }
      });
    }

    // 11) Apply aliases by target label / action id.
    ALIASES.forEach(function (row) {
      var target = row.target;
      var hit = null;
      if (target.indexOf('action:') === 0) {
        var aid = target.slice(7);
        hit = entries.filter(function (e) {
          return e.id === 'action-' + aid;
        })[0];
      } else if (target === 'shortcut:sheet') {
        hit = entries.filter(function (e) {
          return e.kind === 'shortcut';
        })[0];
      } else {
        hit = entries.filter(function (e) {
          return e.label === target;
        })[0];
      }
      if (hit) {
        row.terms.forEach(function (t) {
          if (hit.aliases.indexOf(t) === -1) {
            hit.aliases.push(t);
          }
        });
      }
    });

    // 12) Exclude client/editor-scope sections with no synthetic result.
    entries = entries.filter(function (e) {
      if (e.kind !== 'section') {
        return true;
      }
      var sec = e.id.slice(4);
      if (
        window.MMGR &&
        window.MMGR.Cloud &&
        window.MMGR.Cloud.isClientSectionHidden &&
        window.MMGR.Cloud.isClientSectionHidden(sec)
      ) {
        return false;
      }
      return true;
    });

    // 13) Dedupe by kind + label + group (first wins, preserving order).
    var seen = {};
    entries = entries.filter(function (e) {
      var k = e.kind + '|' + e.label + '|' + (e.group || '');
      if (seen[k]) {
        return false;
      }
      seen[k] = true;
      return true;
    });

    return entries;
  }

  // ---- Scoring ----------------------------------------------------------
  function subsequenceScore(label, q) {
    // Returns 1..300 when q is a subsequence of label, else 0. Every skipped
    // character costs one point (gap penalty), so tighter matches rank higher.
    var li = 0;
    var qi = 0;
    var gaps = 0;
    while (li < label.length && qi < q.length) {
      if (label.charAt(li) === q.charAt(qi)) {
        qi++;
      } else if (qi > 0) {
        gaps++;
      }
      li++;
    }
    if (qi < q.length) {
      return 0;
    }
    return Math.max(1, 300 - gaps);
  }

  function scoreEntry(e, q) {
    var label = String(e.label || '').toLowerCase();
    var hint = String(e.hint || '').toLowerCase();
    var group = String(e.group || '').toLowerCase();
    if (!q) {
      return 0;
    }
    if (label === q) {
      return 1000;
    }
    if (label.indexOf(q) === 0) {
      return 800;
    }
    var words = label.split(/[^a-z0-9]+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i] && words[i].indexOf(q) === 0) {
        return 600;
      }
    }
    for (var a = 0; a < e.aliases.length; a++) {
      var al = String(e.aliases[a]).toLowerCase();
      if (al === q) {
        return 500;
      }
      // Compact titles ("newtown" -> "New Town Hotel Renovation") are stored
      // as aliases; a prefix hit keeps the launcher's unspaced search working.
      if (al.indexOf(q) === 0) {
        return 450;
      }
    }
    var sub = subsequenceScore(label, q);
    if (sub > 0) {
      return sub;
    }
    if (hint.indexOf(q) > -1 || group.indexOf(q) > -1) {
      return 200;
    }
    return 0;
  }

  var _index = null;

  function search(query) {
    var q = String(query === undefined || query === null ? '' : query)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!_index) {
      _index = buildIndex();
    }
    if (!q) {
      return [];
    }
    var scored = [];
    for (var i = 0; i < _index.length; i++) {
      var e = _index[i];
      var s = scoreEntry(e, q);
      if (s > 0) {
        scored.push({ entry: e, score: s });
      }
    }
    scored.sort(function (a, b) {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if ((b.entry.weight || 0) !== (a.entry.weight || 0)) {
        return (b.entry.weight || 0) - (a.entry.weight || 0);
      }
      if (a.entry.label.length !== b.entry.label.length) {
        return a.entry.label.length - b.entry.label.length;
      }
      return a.entry.order - b.entry.order;
    });
    return scored.slice(0, MAX_RESULTS).map(function (x) {
      return x.entry;
    });
  }

  // ---- Palette UI (T-14) ------------------------------------------------
  // DOM built in JS and appended to <body>; role=dialog + aria-modal and
  // hidden until opened. Zero inline scripts, so the CSP hash never moves.
  var _pal = null;
  var _lastFocus = null;
  var _flat = [];
  var _active = -1;

  var KIND_HEAD = {
    project: 'Projects',
    section: 'Sections',
    'setting-group': 'Settings',
    setting: 'Settings',
    tab: 'Tabs',
    guide: 'Guide',
    prompt: 'Prompts',
    shortcut: 'Shortcuts',
    action: 'Actions',
    page: 'Pages'
  };

  var PLACEHOLDER = {
    project: 'Search every feature and setting',
    launcher: 'Search projects, pages and settings',
    admin: 'Search the admin panel',
    calculator: 'Search the calculator'
  };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildPalette() {
    if (_pal) {
      return _pal;
    }
    var el = document.createElement('div');
    el.id = 'app-search';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'app-search-title');
    el.hidden = true;
    el.innerHTML =
      '<div class="mb">' +
      '<div class="mh">' +
      '<span class="mt" id="app-search-title">' +
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-search"></use></svg>' +
      ' Search</span>' +
      '<button type="button" class="dc" data-search="close" aria-label="Close search">' +
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg>' +
      '</button>' +
      '</div>' +
      '<div class="mbody">' +
      '<input id="app-search-q" type="text" role="combobox" aria-expanded="false" ' +
      'aria-controls="app-search-list" aria-autocomplete="list" aria-activedescendant="" ' +
      'placeholder="' +
      esc(PLACEHOLDER[surfaceName()] || PLACEHOLDER.project) +
      '" autocomplete="off" spellcheck="false">' +
      '<div id="app-search-list" role="listbox" aria-label="Search results"></div>' +
      '<div id="app-search-live" class="sr-only" aria-live="polite"></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(el);
    _pal = el;

    var q = el.querySelector('#app-search-q');
    q.addEventListener('input', function () {
      renderResults(q.value);
    });

    el.addEventListener('keydown', function (e) {
      if (_pal.hidden) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette(true);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(_active + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(_active - 1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        runActive(_active);
        return;
      }
      if (e.key === 'Tab') {
        trapTab(e);
      }
    });

    el.addEventListener('click', function (e) {
      var close = e.target.closest ? e.target.closest('[data-search="close"]') : null;
      if (close) {
        e.preventDefault();
        closePalette(true);
        return;
      }
      var opt = e.target.closest ? e.target.closest('.search-opt') : null;
      if (opt) {
        e.preventDefault();
        runActive(parseInt(opt.getAttribute('data-idx'), 10));
      }
    });

    return el;
  }

  function trapTab(e) {
    var f = _pal.querySelectorAll('input, button, [tabindex]');
    if (!f.length) {
      return;
    }
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function setActive(i) {
    if (!_flat.length) {
      _active = -1;
      return;
    }
    if (i < 0) {
      i = 0;
    }
    if (i >= _flat.length) {
      i = _flat.length - 1;
    }
    _active = i;
    var opts = _pal.querySelectorAll('.search-opt');
    for (var k = 0; k < opts.length; k++) {
      var on = k === i;
      opts[k].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && opts[k].scrollIntoView) {
        opts[k].scrollIntoView({ block: 'nearest' });
      }
    }
    var q = _pal.querySelector('#app-search-q');
    q.setAttribute('aria-activedescendant', 'search-opt-' + i);
  }

  function renderResults(query) {
    var list = _pal.querySelector('#app-search-list');
    var live = _pal.querySelector('#app-search-live');
    var q = _pal.querySelector('#app-search-q');
    list.innerHTML = '';
    _flat = [];
    _active = -1;
    var raw = String(query === undefined || query === null ? '' : query);
    if (!raw.trim()) {
      q.setAttribute('aria-expanded', 'false');
      q.setAttribute('aria-activedescendant', '');
      live.textContent = '';
      return;
    }
    var res = search(raw);
    if (!res.length) {
      list.innerHTML = '<div class="search-empty">No matches for "' + esc(raw) + '"</div>';
      q.setAttribute('aria-expanded', 'false');
      q.setAttribute('aria-activedescendant', '');
      live.textContent = 'No results';
      return;
    }
    // Group by kind in first-appearance order, preserving score order within.
    var order = [];
    var map = {};
    res.forEach(function (e) {
      if (!map[e.kind]) {
        map[e.kind] = [];
        order.push(e.kind);
      }
      map[e.kind].push(e);
    });
    order.forEach(function (kind) {
      var head = document.createElement('div');
      head.className = 'search-group-head';
      head.textContent = KIND_HEAD[kind] || kind;
      list.appendChild(head);
      map[kind].forEach(function (e) {
        var idx = _flat.length;
        _flat.push(e);
        var opt = document.createElement('div');
        opt.className = 'search-opt';
        opt.id = 'search-opt-' + idx;
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', 'false');
        opt.setAttribute('data-idx', String(idx));
        opt.innerHTML =
          '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#' +
          esc(e.icon || 'i-search') +
          '"></use></svg>' +
          '<span class="search-opt-text">' +
          '<span class="search-opt-label">' +
          esc(e.label) +
          '</span>' +
          '<span class="search-opt-hint">' +
          esc(e.hint || '') +
          '</span></span>';
        list.appendChild(opt);
      });
    });
    q.setAttribute('aria-expanded', 'true');
    live.textContent = res.length + (res.length === 1 ? ' result' : ' results');
    setActive(0);
  }

  function runActive(i) {
    if (i < 0 || i >= _flat.length) {
      return;
    }
    var entry = _flat[i];
    // Close WITHOUT restoring focus: the reveal decides where focus lands.
    closePalette(false);
    try {
      entry.run();
    } catch (e) {
      /* a broken reveal must never break the app */
    }
  }

  function openPalette() {
    buildPalette();
    // The first-open tour owns Escape/Enter in the CAPTURE phase; step it
    // aside (without marking it seen) so the palette owns its own keys.
    if (window.MMGR && MMGR.Tour && MMGR.Tour.isOpen && MMGR.Tour.isOpen() && MMGR.Tour.end) {
      MMGR.Tour.end(false);
    }
    _lastFocus = document.activeElement;
    // Fresh index on every open (T-13 rule: never a stale pack state).
    _index = buildIndex();
    var q = _pal.querySelector('#app-search-q');
    q.value = '';
    renderResults('');
    _pal.hidden = false;
    q.focus();
  }

  function closePalette(restore) {
    if (!_pal || _pal.hidden) {
      return;
    }
    _pal.hidden = true;
    if (restore && _lastFocus && _lastFocus.focus && document.contains(_lastFocus)) {
      _lastFocus.focus();
    }
    _lastFocus = null;
  }

  function togglePalette() {
    if (_pal && !_pal.hidden) {
      closePalette(true);
    } else {
      openPalette();
    }
  }

  function isPaletteOpen() {
    return !!(_pal && !_pal.hidden);
  }

  // Ctrl/⌘+K opens the palette. Capture phase so it wins before any page
  // handler; '/' stays the assistant's key (mmgr-shortcuts.js owns it).
  document.addEventListener(
    'keydown',
    function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        togglePalette();
      }
    },
    true
  );

  // Every surface carries its own button: <button data-app-search-open>.
  // Delegated, so the markup needs no per-page handler and no inline script.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-app-search-open]') : null;
    if (!t) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    openPalette();
  });

  MMGR.AppSearch = {
    buildIndex: function () {
      _index = buildIndex();
      return _index;
    },
    search: search,
    open: openPalette,
    close: closePalette,
    toggle: togglePalette,
    isOpen: isPaletteOpen,
    surface: surfaceName,
    MAX_RESULTS: MAX_RESULTS
  };
})(window.MMGR || (window.MMGR = {}));
