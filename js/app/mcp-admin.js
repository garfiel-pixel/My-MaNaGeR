/* MCP server panel for the admin page (T-25, 2026-11-12).
   Account-scoped: the Worker answers 403 until a session exists, so the panel
   renders a sign-in hint instead of controls in that state. Every dynamic
   value is written with textContent; no user or client name is ever parsed as
   HTML. Actions are namespaced (data-mcp-act) so the admin page's inline
   action map and its CSP hashes stay untouched. */
(function (MMGR) {
  'use strict';

  var card = null;
  var state = null;
  var clientList = [];
  var pendingList = [];
  var activeTab = 'pending';
  // Item P (owner report 2026-11-21): the chip may only count clients once the
  // client request has actually answered. Until then the panel is loading, not
  // "On, no client yet" - that sentence is a verdict about a question nobody
  // asked yet, and it is the same bug class as the old "Unavailable".
  var clientsKnown = false;
  var clientsFailed = false;

  function $(sel) {
    return card ? card.querySelector(sel) : null;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) {
      n.className = cls;
    }
    if (text != null) {
      n.textContent = String(text);
    }
    return n;
  }
  function setStatus(msg, kind) {
    var s = document.getElementById('mcp-admin-status');
    if (!s) {
      return;
    }
    s.textContent = msg || '';
    s.setAttribute('data-kind', kind || '');
  }
  // T-28: the summary carries the real state, so a folded card still answers
  // "is this connected?" without a click. "On" alone would repeat the bug the
  // owner reported (a panel that claimed cloud while nothing was connected),
  // so the chip counts live clients.
  function setChip(text, kind) {
    var chip = document.getElementById('mcp-admin-chip');
    if (!chip) {
      return;
    }
    chip.textContent = text;
    chip.setAttribute('data-kind', kind || '');
  }
  function syncChip() {
    if (!state) {
      setChip('Signed out', 'muted');
      return;
    }
    var cfg = state.config || {};
    if (cfg.enabled === 0 || cfg.enabled === false) {
      setChip('Off', 'muted');
      return;
    }
    if (!clientsKnown) {
      setChip('Loading...', 'busy');
      return;
    }
    // A count of clients we could not fetch would be a guess. Say the server is
    // on and leave the number out.
    if (clientsFailed) {
      setChip('On', 'ok');
      return;
    }
    var live = (clientList || []).filter(function (c) {
      return c && !c.revoked;
    });
    if (!live.length) {
      setChip('On, no client yet', 'warn');
      return;
    }
    setChip('On, ' + live.length + ' client' + (live.length === 1 ? '' : 's'), 'ok');
  }
  function api(path, opts) {
    var init = {
      credentials: 'same-origin',
      cache: 'no-store'
    };
    if (opts) {
      init.method = opts.method || 'GET';
      if (opts.body) {
        // Only a request WITH a body carries Content-Type; a bare GET stays a
        // simple same-origin request.
        init.headers = { 'Content-Type': 'application/json' };
        init.body = opts.body;
      }
    }
    return fetch(path, init).then(function (res) {
      // Read the text first: a Worker 500 or a Cloudflare edge page is HTML,
      // and res.json() would throw away the status that explains it.
      return res.text().then(function (text) {
        var data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (e) {
            data = null;
          }
        }
        if (!data || typeof data !== 'object') {
          data = {
            error: 'The service answered with an unexpected page (HTTP ' + res.status + ').'
          };
        }
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }
  function errorText(r) {
    var msg = r && r.data && r.data.error;
    if (msg) {
      return String(msg);
    }
    return 'The MCP settings service answered HTTP ' + (r ? r.status : '?') + '.';
  }
  function fmtDate(iso) {
    if (!iso) {
      return '';
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      return String(iso);
    }
    try {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return String(iso).slice(0, 10);
    }
  }

  function renderTools(tools, selected) {
    var host = $('#mcp-tools');
    if (!host) {
      return;
    }
    host.textContent = '';
    var picked = {};
    (selected || []).forEach(function (n) {
      picked[n] = 1;
    });
    (tools || []).forEach(function (name) {
      var label = el('label', 'mcp-admin-tool');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.value = name;
      box.checked = !!picked[name];
      label.appendChild(box);
      label.appendChild(document.createTextNode(' ' + name));
      host.appendChild(label);
    });
  }

  // Item P: a failed client fetch used to render "No client has connected yet."
  // - a network error dressed up as an empty account. It now says what
  // happened, keeps the count badge hidden, and leaves the chip on "On"
  // because the server state did load; only the list did not.
  function renderClientsFailed() {
    clientList = [];
    clientsKnown = true;
    clientsFailed = true;
    var count = document.getElementById('mcp-client-count');
    if (count) {
      count.textContent = '0';
      count.hidden = true;
    }
    var host = $('#mcp-clients');
    if (host) {
      host.textContent = '';
      host.appendChild(
        el('div', 'mcp-admin-empty', 'Could not load connected clients. Press Refresh.')
      );
    }
    syncChip();
  }

  function renderClients(clients) {
    clientList = Array.isArray(clients) ? clients : [];
    clientsKnown = true;
    clientsFailed = false;
    syncChip();
    var count = document.getElementById('mcp-client-count');
    if (count) {
      var live = clientList.filter(function (c) {
        return c && !c.revoked;
      }).length;
      count.textContent = String(live);
      count.hidden = live === 0;
    }
    var host = $('#mcp-clients');
    if (!host) {
      return;
    }
    host.textContent = '';
    if (!clients || !clients.length) {
      host.appendChild(el('div', 'mcp-admin-empty', 'No client has connected yet.'));
      return;
    }
    var wrap = el('div', 'mcp-admin-rows');
    clients.forEach(function (c) {
      var row = el('div', 'mcp-admin-row');
      var left = el('div');
      left.appendChild(el('div', 'mcp-admin-name', c.name || c.clientId));
      var meta = 'Added ' + fmtDate(c.createdAt);
      if (c.lastUsedAt) {
        meta += ' | Last used ' + fmtDate(c.lastUsedAt);
      }
      if (c.revoked) {
        meta += ' | Revoked';
      }
      left.appendChild(el('div', 'mcp-admin-meta', meta));
      row.appendChild(left);
      if (!c.revoked) {
        var btn = el('button', 'btn btn-n btn-s', 'Revoke');
        btn.type = 'button';
        btn.setAttribute('data-mcp-act', 'revoke');
        btn.setAttribute('data-client-id', c.clientId);
        row.appendChild(btn);
      }
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  function renderProjects(projects) {
    var host = $('#mcp-projects');
    if (!host) {
      return;
    }
    host.textContent = '';
    if (!projects || !projects.length) {
      host.appendChild(el('div', 'mcp-admin-empty', 'No linked project yet.'));
      return;
    }
    var wrap = el('div', 'mcp-admin-rows');
    projects.forEach(function (p) {
      var row = el('div', 'mcp-admin-row');
      var left = el('div');
      left.appendChild(el('div', 'mcp-admin-name', p.label || p.projectId));
      left.appendChild(el('div', 'mcp-admin-meta', p.projectId));
      row.appendChild(left);
      if (p.accessRole === 'owner') {
        var label = el('label', 'tgl');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = p.mcpEnabled !== false;
        box.setAttribute('data-mcp-act', 'project-toggle');
        box.setAttribute('data-project-id', p.projectId);
        box.setAttribute('aria-label', 'Allow MCP on ' + (p.label || p.projectId));
        label.appendChild(box);
        label.appendChild(el('span', 'tsl'));
        row.appendChild(label);
      } else {
        row.appendChild(el('span', 'mcp-admin-meta', 'Shared with you (' + p.accessRole + ')'));
      }
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  // Item P: three explicit panel states, one owner. "Loading" holds the card
  // open with two dim rows, "ready" is the real panel, "failed" hides both and
  // leaves the status line naming the reason next to Refresh. "Unavailable" is
  // gone: it was a conclusion the user could not act on and it read as "this
  // feature does not exist".
  function setPanelState(kind) {
    var loading = document.getElementById('mcp-admin-loading');
    if (loading) {
      loading.hidden = kind !== 'loading';
    }
    var body = document.getElementById('mcp-admin-body');
    if (body) {
      body.hidden = kind !== 'ready';
    }
  }

  function applyConfig(data) {
    state = data;
    var cfg = data.config || {};
    setPanelState('ready');
    var enabled = $('#mcp-enabled');
    if (enabled) {
      enabled.checked = cfg.enabled !== 0 && cfg.enabled !== false;
    }
    var policy = $('#mcp-policy');
    if (policy) {
      policy.value = cfg.policy || 'allow_all';
    }
    var subset = cfg.toolSubset != null ? cfg.toolSubset : cfg.tool_subset;
    if (typeof subset === 'string') {
      try {
        subset = JSON.parse(subset);
      } catch (e) {
        subset = [];
      }
    }
    renderTools(data.tools, subset);
    syncSubsetVisibility();
    renderProjects(data.projects);
    syncChip();
  }

  function fmtWhen(iso) {
    if (!iso) {
      return '';
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      return String(iso);
    }
    try {
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return fmtDate(iso);
    }
  }

  function setTab(name) {
    activeTab = name === 'connection' || name === 'clients' ? name : 'pending';
    if (!card) {
      return;
    }
    var tabs = card.querySelectorAll('[data-mcp-tab]');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-mcp-tab') === activeTab;
      tabs[i].classList.toggle('is-on', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var panels = card.querySelectorAll('[data-mcp-panel]');
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].getAttribute('data-mcp-panel') !== activeTab;
    }
  }

  // The names and field words are the same ones the project-page approval
  // preview uses (js/mmgr-approval.js). Keep the two maps in step so an owner
  // sees "Task Battle: Status todo -> completed" here too, never "task 1".
  var FIELD_WORDS = {
    planned: 'Planned budget',
    actual: 'Actual spend',
    qty: 'Quantity',
    rate: 'Rate',
    unit: 'Unit',
    unitPrice: 'Price per unit',
    name: 'Name',
    category: 'Category',
    boqRef: 'BOQ reference',
    status: 'Status',
    owner: 'Owner',
    startDate: 'Start date',
    endDate: 'End date',
    dueDate: 'Due date',
    progress: 'Progress',
    description: 'Description',
    title: 'Title',
    notes: 'Notes',
    severity: 'Severity',
    likelihood: 'Likelihood',
    mitigation: 'Mitigation',
    supplierRef: 'Supplier reference',
    date: 'Date',
    amount: 'Amount',
    assignee: 'Assignee',
    dependsOn: 'Depends on',
    duration: 'Duration',
    workingDays: 'Working days',
    priority: 'Priority',
    impact: 'Impact',
    probability: 'Probability',
    response: 'Response',
    note: 'Note',
    ref: 'Reference',
    text: 'Text',
    problem: 'Problem statement',
    goal: 'Goal',
    phase: 'Phase',
    percent: 'Percent complete'
  };
  var PATH_WORDS = {
    tasks: 'Task',
    risks: 'Risk',
    issues: 'Issue',
    budgetLines: 'Budget line',
    spendLog: 'Delivery',
    stakeholders: 'Stakeholder',
    resources: 'Resource',
    changes: 'Change request',
    logEntries: 'Decision',
    documents: 'Document',
    commsEntries: 'Comms entry',
    raci: 'RACI entry',
    meetings: 'Meeting',
    meetingPromises: 'Promise',
    charter: 'Charter',
    closure: 'Closure',
    dmaic: 'DMAIC',
    supplierBook: 'Supplier',
    projectName: 'Project name',
    methodology: 'Methodology',
    methodologyLocked: 'Methodology lock',
    projectDeadline: 'Project deadline',
    budgetEnvelope: 'Budget envelope',
    nspid: 'Delivery counter',
    nmeetid: 'Meeting counter',
    currency: 'Currency'
  };
  function human(k, map) {
    var s = String(k || '');
    if (map[s]) {
      return map[s];
    }
    return s
      .replace(/\./g, ' / ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
  }
  function fieldLabel(field) {
    return human(field, FIELD_WORDS);
  }
  function pathLabel(path) {
    return human(path, PATH_WORDS);
  }

  function fullValue(v, absent) {
    if (absent) {
      return 'not set';
    }
    if (v === undefined || v === null || v === '') {
      return 'blank';
    }
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }

  // Group the flat diff leaves by the record they touch, in arrival order.
  // The server already stamps every leaf with recordName, so the group head
  // can carry a real name rather than a bare id or "Item 1".
  function groupDiffs(diffs) {
    var groups = [];
    var byKey = {};
    (Array.isArray(diffs) ? diffs : []).forEach(function (d) {
      if (!d) {
        return;
      }
      var rec = d.recordId || (d.index === null || d.index === undefined ? '' : '#' + d.index);
      var key = String(d.path || '') + '|' + rec;
      var g = byKey[key];
      if (!g) {
        g = {
          path: String(d.path || ''),
          recordId: d.recordId || '',
          recordName: d.recordName || '',
          index: d.index,
          rows: []
        };
        byKey[key] = g;
        groups.push(g);
      }
      if (!g.recordName && d.recordName) {
        g.recordName = d.recordName;
      }
      g.rows.push(d);
    });
    return groups;
  }

  // The budget proposal shape has changes[] instead of diffs[]. Present them
  // through the same grouped renderer so the owner reads one consistent view.
  function diffList(p) {
    if (p && Array.isArray(p.diffs) && p.diffs.length) {
      return p.diffs.filter(Boolean);
    }
    var changes = p && p.proposal && Array.isArray(p.proposal.changes) ? p.proposal.changes : [];
    return changes.map(function (c) {
      return {
        path: 'budgetLines',
        recordId: String(c.lineId || ''),
        recordName: c.lineName || c.name || '',
        field: c.field || c.kind,
        before: c.before,
        after: c.value,
        surfaces: []
      };
    });
  }

  // One grouped, fully-spelled change view. Every write uses textContent:
  // a client can name a record or a value with markup and it stays text.
  function changeDetail(p, full) {
    var host = el('div', full ? 'mcp-view-groups' : 'mcp-q-diffs');
    var groups = groupDiffs(diffList(p));
    groups.forEach(function (g) {
      var card = el('div', full ? 'mcp-view-g' : 'mcp-q-g');
      var head = el('div', 'mcp-view-g-head');
      head.appendChild(el('span', 'mcp-view-kind', pathLabel(g.path)));
      var rec =
        g.recordName ||
        g.recordId ||
        (g.index != null ? 'Item ' + (g.index + 1) : pathLabel(g.path));
      head.appendChild(el('span', 'mcp-view-rec', rec));
      card.appendChild(head);
      g.rows.forEach(function (d) {
        var row = el('div', 'mcp-view-row');
        row.appendChild(el('span', 'mcp-view-field', fieldLabel(d.field || d.path)));
        row.appendChild(
          el('span', 'mcp-view-before', fullValue(d.before, d.beforeAbsent === true))
        );
        row.appendChild(el('span', 'mcp-view-arrow', '\u2192'));
        row.appendChild(el('span', 'mcp-view-after', fullValue(d.after, d.afterAbsent === true)));
        card.appendChild(row);
        var surfaces = Array.isArray(d.surfaces) ? d.surfaces : [];
        if (surfaces.length) {
          card.appendChild(el('div', 'mcp-view-surf', 'Affects ' + surfaces.join(', ')));
        }
      });
      host.appendChild(card);
    });
    if (!groups.length) {
      host.appendChild(el('div', 'mcp-admin-empty', 'This proposal carries no field changes.'));
    }
    return host;
  }

  function proposalCount(p) {
    if (p && p.proposal && Array.isArray(p.proposal.changes)) {
      return p.proposal.changes.length;
    }
    return p && Number.isFinite(p.diffTotal) ? p.diffTotal : p && p.diffs ? p.diffs.length : 0;
  }

  function renderPending() {
    var host = document.getElementById('mcp-pending');
    var count = document.getElementById('mcp-pending-count');
    if (count) {
      count.textContent = String(pendingList.length);
      count.hidden = pendingList.length === 0;
    }
    if (!host) {
      return;
    }
    host.textContent = '';
    if (!pendingList.length) {
      host.appendChild(
        el(
          'div',
          'mcp-admin-empty',
          'Nothing is waiting for you. Every change an AI proposes appears here first.'
        )
      );
      return;
    }
    var wrap = el('div', 'mcp-q');
    pendingList.forEach(function (item) {
      var p = item.proposal;
      var total = proposalCount(p);
      var row = el('div', 'mcp-q-row');
      var main = el('div', 'mcp-q-main');
      var top = el('div', 'mcp-q-top');
      top.appendChild(el('span', 'mcp-q-proj', item.projectLabel || item.projectId));
      top.appendChild(el('span', 'mcp-q-badge', total + (total === 1 ? ' change' : ' changes')));
      if (p.sourceLabel) {
        top.appendChild(el('span', 'mcp-q-src', p.sourceLabel));
      }
      main.appendChild(top);
      main.appendChild(
        el('div', 'mcp-q-meta', 'Proposed ' + fmtWhen(p.proposedAt) + ' | proposal #' + p.id)
      );
      // OWNER 2026-11-11 / deferred T-25: show exactly what moves - the real
      // record name, the field and both values - for EVERY change, not a flat
      // "task 1 will change" list truncated to three lines.
      main.appendChild(changeDetail(p, false));
      row.appendChild(main);
      var acts = el('div', 'mcp-q-acts');
      var view = el('button', 'btn btn-n btn-s', 'View');
      view.type = 'button';
      view.setAttribute('data-mcp-act', 'view');
      view.setAttribute('data-project-id', item.projectId);
      view.setAttribute('data-review-id', String(p.id));
      acts.appendChild(view);
      var accept = el('button', 'btn btn-g btn-s', 'Accept');
      accept.type = 'button';
      accept.setAttribute('data-mcp-act', 'accept');
      accept.setAttribute('data-project-id', item.projectId);
      accept.setAttribute('data-review-id', String(p.id));
      var reject = el('button', 'btn btn-n btn-s', 'Reject');
      reject.type = 'button';
      reject.setAttribute('data-mcp-act', 'reject');
      reject.setAttribute('data-project-id', item.projectId);
      reject.setAttribute('data-review-id', String(p.id));
      acts.appendChild(accept);
      acts.appendChild(reject);
      row.appendChild(acts);
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  // "View" opens the full change sheet before any decision. It reads the same
  // proposal object the queue already loaded, so no second fetch is needed and
  // the values are exactly the ones Accept would apply. The panel is inert:
  // its controls use data-mcp-view, never the global data-action dispatcher.
  function closeView() {
    var ov = document.getElementById('mcp-view-ov');
    if (ov) {
      ov.remove();
    }
  }
  function openView(projectId, reviewId) {
    var item = null;
    (pendingList || []).forEach(function (x) {
      if (
        String(x.projectId) === String(projectId) &&
        String(x.proposal && x.proposal.id) === String(reviewId)
      ) {
        item = x;
      }
    });
    if (!item) {
      return;
    }
    closeView();
    var p = item.proposal;
    var ov = el('div', 'mcp-view-ov');
    ov.id = 'mcp-view-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'mcp-view-title');
    var win = el('div', 'mcp-view-win');
    var hd = el('div', 'mcp-view-hd');
    var left = el('div');
    left.appendChild(el('div', 'mcp-view-title', 'Proposal #' + p.id));
    left.appendChild(
      el(
        'div',
        'mcp-view-sub',
        (item.projectLabel || item.projectId) +
          ' \u00b7 ' +
          (p.sourceLabel || 'AI edit') +
          ' \u00b7 Proposed ' +
          fmtWhen(p.proposedAt)
      )
    );
    hd.appendChild(left);
    var close = el('button', 'btn btn-n btn-s', 'Close');
    close.type = 'button';
    close.setAttribute('data-mcp-view', 'close');
    hd.appendChild(close);
    win.appendChild(hd);
    win.appendChild(changeDetail(p, true));
    var hint = el(
      'div',
      'mcp-view-hint',
      'Nothing is saved until you Accept. Reject sends a short reason back to whoever made the proposal.'
    );
    win.appendChild(hint);
    var ft = el('div', 'mcp-view-ft');
    var rej = el('button', 'btn btn-n btn-s', 'Reject');
    rej.type = 'button';
    rej.setAttribute('data-mcp-view', 'reject');
    rej.setAttribute('data-project-id', projectId);
    rej.setAttribute('data-review-id', String(p.id));
    var acc = el('button', 'btn btn-g btn-s', 'Accept this proposal');
    acc.type = 'button';
    acc.setAttribute('data-mcp-view', 'accept');
    acc.setAttribute('data-project-id', projectId);
    acc.setAttribute('data-review-id', String(p.id));
    ft.appendChild(rej);
    ft.appendChild(acc);
    win.appendChild(ft);
    ov.appendChild(win);
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target === ov) {
        closeView();
      }
    });
    ov.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeView();
      }
    });
    if (close.focus) {
      close.focus();
    }
  }

  // The management table the owner asked for: one place that shows what every
  // connected agent has queued, across every project this account owns, with
  // the decision buttons right here. The project page keeps its own queue; the
  // two read the same cloud_reviews rows.
  function loadPending() {
    pendingList = [];
    if (!state || !Array.isArray(state.projects)) {
      renderPending();
      return Promise.resolve();
    }
    var owners = state.projects.filter(function (p) {
      return p && p.accessRole === 'owner';
    });
    var jobs = owners.map(function (p) {
      return api('/api/cloud/projects/' + encodeURIComponent(p.projectId) + '/reviews')
        .then(function (r) {
          if (!r.ok || !r.data.ok || !Array.isArray(r.data.proposals)) {
            return;
          }
          r.data.proposals.forEach(function (row) {
            if (!row || (row.status !== 'pending' && row.status !== 'accepting')) {
              return;
            }
            pendingList.push({
              projectId: p.projectId,
              projectLabel: p.label || p.projectId,
              proposal: row
            });
          });
        })
        .catch(function () {
          /* one unreachable project must not hide the rest */
        });
    });
    return Promise.all(jobs).then(function () {
      pendingList.sort(function (a, b) {
        return String(b.proposal.proposedAt || '').localeCompare(
          String(a.proposal.proposedAt || '')
        );
      });
      renderPending();
    });
  }

  function decide(kind, projectId, reviewId, btn) {
    if (!projectId || !reviewId) {
      return;
    }
    if (btn) {
      btn.disabled = true;
    }
    setStatus((kind === 'accept' ? 'Accepting' : 'Rejecting') + ' proposal #' + reviewId + '...');
    var path =
      '/api/cloud/projects/' +
      encodeURIComponent(projectId) +
      '/reviews/' +
      encodeURIComponent(reviewId) +
      '/' +
      (kind === 'accept' ? 'accept' : 'reject');
    api(path, { method: 'POST' })
      .then(function (r) {
        if (!r.ok || !r.data.ok) {
          if (btn) {
            btn.disabled = false;
          }
          setStatus((r.data && (r.data.message || r.data.error)) || errorText(r), 'err');
          return null;
        }
        setStatus(
          (kind === 'accept' ? 'Accepted' : 'Rejected') +
            ' proposal #' +
            reviewId +
            '. The project list is up to date.',
          'ok'
        );
        return loadPending();
      })
      .catch(function () {
        if (btn) {
          btn.disabled = false;
        }
        setStatus('Could not reach the review service. Press Refresh.', 'err');
      });
  }

  function syncSubsetVisibility() {
    var policy = $('#mcp-policy');
    var host = $('#mcp-tools');
    if (host) {
      host.hidden = !policy || policy.value !== 'allow_subset';
    }
  }

  function load() {
    card = document.getElementById('mcp-admin-card');
    if (!card) {
      return;
    }
    // The URL is origin-relative so the panel stays truthful on any host.
    var urlInput = document.getElementById('mcp-connect-url');
    if (urlInput) {
      urlInput.value = location.origin + '/api/mcp';
    }
    clientsKnown = false;
    clientsFailed = false;
    setPanelState('loading');
    setStatus('Loading MCP settings...');
    setChip('Loading...', 'busy');
    api('/api/mcp/config')
      .then(function (r) {
        if (r.status === 403 || r.status === 401) {
          state = null;
          syncChip();
          setStatus(
            'Sign in to your account to manage the MCP server: open the app, use Sign in, then press Refresh. The connection URL above still works: Claude sends you here to sign in.',
            'muted'
          );
          setPanelState('failed');
          return null;
        }
        if (!r.ok || !r.data.ok) {
          setChip('Could not load', 'err');
          setStatus(errorText(r) + ' Press Refresh.', 'err');
          setPanelState('failed');
          return null;
        }
        applyConfig(r.data);
        setStatus('');
        return api('/api/mcp/clients')
          .then(
            function (c) {
              if (c.ok && c.data.ok) {
                renderClients(c.data.clients);
              } else {
                renderClientsFailed();
              }
            },
            function () {
              renderClientsFailed();
            }
          )
          .then(function () {
            return loadPending();
          });
      })
      .catch(function () {
        var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        setChip(offline ? 'Offline' : 'Could not load', 'err');
        setStatus(
          offline
            ? 'You are offline. Reconnect, then press Refresh.'
            : 'Could not reach the MCP settings service. Press Refresh.',
          'err'
        );
        setPanelState('failed');
      });
  }

  function copyUrl(after) {
    var input = document.getElementById('mcp-connect-url');
    if (!input) {
      return;
    }
    var url = input.value;
    var settled = false;
    function finish(fn) {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    }
    function done() {
      setStatus('Connection URL copied. Paste it into your connector.', 'ok');
      if (after) {
        after();
      }
    }
    function fallback() {
      input.removeAttribute('readonly');
      input.select();
      try {
        document.execCommand('copy');
        done();
      } catch (e) {
        setStatus('Select the URL and copy it.', 'muted');
      }
      input.setAttribute('readonly', 'readonly');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          finish(done);
        },
        function () {
          finish(fallback);
        }
      );
      // A clipboard promise can stay pending when the document is not focused;
      // never leave the button looking dead.
      setTimeout(function () {
        finish(fallback);
      }, 1200);
      return;
    }
    fallback();
  }

  // The rail's MCP Server menu drives the management area. Every destination
  // opens the card, selects its tab, and lands on it; a folded card would hide
  // the very thing the click asked for.
  function openPanel(tab) {
    card = document.getElementById('mcp-admin-card');
    if (!card) {
      return;
    }
    setTab(tab || activeTab);
    var reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    var on = card.querySelector('.mcp-admin-tab.is-on');
    if (on && on.focus) {
      try {
        on.focus({ preventScroll: true });
      } catch (e) {
        on.focus();
      }
    }
    if (!state) {
      load();
    }
  }

  function scrollInside(target) {
    if (!target) {
      return;
    }
    var reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }

  function sideAction(kind) {
    if (kind === 'pending' || kind === 'open') {
      openPanel('pending');
      return;
    }
    if (kind === 'connection') {
      openPanel('connection');
      return;
    }
    if (kind === 'clients') {
      openPanel('clients');
      scrollInside(document.getElementById('mcp-clients'));
      return;
    }
    if (kind === 'copy') {
      openPanel('connection');
      copyUrl(function () {
        if (typeof window.toast === 'function') {
          window.toast('Connection URL copied. Paste it into your connector.', 'ok');
        }
      });
    }
  }

  function save() {
    var enabled = $('#mcp-enabled');
    var policy = $('#mcp-policy');
    var subset = [];
    if (policy && policy.value === 'allow_subset') {
      var boxes = card.querySelectorAll('#mcp-tools input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked) {
          subset.push(boxes[i].value);
        }
      }
    }
    setStatus('Saving...');
    api('/api/mcp/config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: !!(enabled && enabled.checked),
        policy: policy ? policy.value : 'allow_all',
        tool_subset: policy && policy.value === 'allow_subset' ? subset : null
      })
    })
      .then(function (r) {
        if (!r.ok || !r.data.ok) {
          setStatus(errorText(r), 'err');
          return;
        }
        applyConfig({
          config: r.data.config,
          tools: state ? state.tools : [],
          projects: state ? state.projects : []
        });
        setStatus('MCP settings saved.', 'ok');
      })
      .catch(function () {
        setStatus('Could not reach the MCP settings service.', 'err');
      });
  }

  function revoke(clientId, btn) {
    if (!clientId) {
      return;
    }
    if (btn) {
      btn.disabled = true;
    }
    setStatus('Revoking client...');
    api('/api/mcp/clients/revoke', {
      method: 'POST',
      body: JSON.stringify({ clientId: clientId })
    })
      .then(function (r) {
        if (!r.ok || !r.data.ok) {
          setStatus(errorText(r), 'err');
          if (btn) {
            btn.disabled = false;
          }
          return;
        }
        setStatus('Client revoked. Its live tokens are dead now.', 'ok');
        return api('/api/mcp/clients').then(function (c) {
          if (c.ok && c.data.ok) {
            renderClients(c.data.clients);
          }
        });
      })
      .catch(function () {
        setStatus('Could not reach the MCP settings service.', 'err');
        if (btn) {
          btn.disabled = false;
        }
      });
  }

  function toggleProject(projectId, box) {
    if (!projectId || !box) {
      return;
    }
    var want = box.checked;
    setStatus('Updating project access...');
    api('/api/mcp/projects/' + encodeURIComponent(projectId) + '/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled: want })
    })
      .then(function (r) {
        if (!r.ok || !r.data.ok) {
          box.checked = !want;
          setStatus(errorText(r), 'err');
          return;
        }
        setStatus((want ? 'MCP allowed on ' : 'MCP blocked on ') + projectId + '.', 'ok');
      })
      .catch(function () {
        box.checked = !want;
        setStatus('Could not reach the MCP settings service.', 'err');
      });
  }

  document.addEventListener('DOMContentLoaded', load);
  document.addEventListener('click', function (e) {
    // The full change sheet is on <body>, outside the card. Its controls are
    // namespaced with data-mcp-view so they never reach the action dispatcher.
    var mv = e.target && e.target.closest ? e.target.closest('[data-mcp-view]') : null;
    if (mv) {
      e.preventDefault();
      var what = mv.getAttribute('data-mcp-view');
      if (what === 'close') {
        closeView();
      } else if (what === 'accept' || what === 'reject') {
        var pid = mv.getAttribute('data-project-id');
        var rid = mv.getAttribute('data-review-id');
        closeView();
        decide(what, pid, rid, null);
      }
      return;
    }
    var side = e.target && e.target.closest ? e.target.closest('[data-mcp-side]') : null;
    if (side) {
      e.preventDefault();
      sideAction(side.getAttribute('data-mcp-side'));
      return;
    }
    var tabBtn = e.target && e.target.closest ? e.target.closest('[data-mcp-tab]') : null;
    if (tabBtn && card && card.contains(tabBtn)) {
      e.preventDefault();
      setTab(tabBtn.getAttribute('data-mcp-tab'));
      return;
    }
    var t = e.target && e.target.closest ? e.target.closest('[data-mcp-act]') : null;
    if (!t || !card || !card.contains(t)) {
      return;
    }
    var act = t.getAttribute('data-mcp-act');
    if (act === 'save') {
      e.preventDefault();
      save();
    } else if (act === 'revoke') {
      e.preventDefault();
      revoke(t.getAttribute('data-client-id'), t);
    } else if (act === 'reload') {
      e.preventDefault();
      load();
    } else if (act === 'copy-url') {
      e.preventDefault();
      copyUrl();
    } else if (act === 'view') {
      e.preventDefault();
      openView(t.getAttribute('data-project-id'), t.getAttribute('data-review-id'));
    } else if (act === 'accept' || act === 'reject') {
      e.preventDefault();
      decide(act, t.getAttribute('data-project-id'), t.getAttribute('data-review-id'), t);
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || !card || !card.contains(t)) {
      return;
    }
    if (t.id === 'mcp-policy') {
      syncSubsetVisibility();
      return;
    }
    if (t.getAttribute('data-mcp-act') === 'project-toggle') {
      toggleProject(t.getAttribute('data-project-id'), t);
    }
  });

  MMGR.McpAdmin = { load: load, open: openPanel, copyUrl: copyUrl, setTab: setTab };
})(window.MMGR || (window.MMGR = {}));
