/* ============================================================
   My MaNaGeR - Team panel (RBAC sprint 2, directive 2026-10-25)
   ------------------------------------------------------------
   One module, three surfaces:
     - the header bell + count badge (project.html and app.html)
     - the glass panel with Invitations and Collaborators tabs
     - the "Shared with me" list on the launcher

   It is deliberately standalone: the launcher bundle has no
   mmgr-cloud.js, so nothing here may depend on MMGR.Cloud. Every
   write is still enforced by the Worker; this module only renders
   what the server returns and never decides access itself.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  var REFRESH_MS = 60000;
  var CACHE_KEY = 'mmgr_team_cache';
  var ROLE_LABEL = {
    owner: 'Owner',
    manager: 'Manager',
    supervisor: 'Supervisor',
    contractor: 'Contractor',
    client: 'Client'
  };
  var ROLE_SUMMARY = {
    manager: 'Can edit the whole project.',
    supervisor: 'Can edit Tasks, Resources, Risks and Meetings.',
    contractor: 'Can edit Tasks.',
    client: 'View only, in the sections the owner chose.'
  };
  var FALLBACK_SECTIONS = {
    charter: 'Charter',
    wbs: 'Tasks',
    res: 'Resources',
    bud: 'Budget',
    stk: 'Stakeholders',
    chg: 'Changes',
    log: 'Decision Log',
    risk: 'Risk and Issues',
    close: 'Closure',
    raci: 'RACI',
    comms: 'Comms Log',
    docs: 'Documents',
    dmaic: 'DMAIC',
    proc: 'Procurement',
    meet: 'Meetings',
    photos: 'Photos',
    supplierBook: 'Supplier Price Book'
  };
  // Sprint 3 (directive 2026-10-25): the three levels a section can carry. The
  // wording is plain on purpose - "Change" is what happens to the project, not
  // "edit", which means nothing to a site manager.
  var PERM_LEVELS = [
    { value: 'none', label: 'No access' },
    { value: 'view', label: 'View' },
    { value: 'edit', label: 'Change' }
  ];

  var state = {
    signedIn: false,
    invitations: [],
    memberships: [],
    projects: [],
    sections: FALLBACK_SECTIONS,
    open: false,
    tab: 'invitations',
    pendingDecline: 0,
    accepted: {},
    peopleOpen: {},
    accessOpen: {},
    templates: [],
    templatesLoaded: false,
    templateBusy: false
  };
  var els = {};

  function $(id) {
    return document.getElementById(id);
  }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function roleLabel(role) {
    return ROLE_LABEL[role] || 'Member';
  }
  function sectionLabel(key) {
    return state.sections[key] || FALLBACK_SECTIONS[key] || key;
  }
  function sectionList(scope) {
    if (!Array.isArray(scope) || !scope.length) {
      return '';
    }
    return scope.map(sectionLabel).join(', ');
  }

  // ---- Sprint 3: enterprise access tools ----------------------------------
  // The client never decides access; the Worker does. This gate only decides
  // whether the owner is OFFERED the tools, so a free or contractor account
  // never sees a control whose save would answer "upgrade required".
  function enterprise() {
    try {
      return !!(
        ns.Entitlements &&
        typeof ns.Entitlements.rbacEnterprise === 'function' &&
        ns.Entitlements.rbacEnterprise()
      );
    } catch (e) {
      return false;
    }
  }

  function sectionKeys() {
    var seen = {};
    Object.keys(state.sections).forEach(function (k) {
      seen[k] = 1;
    });
    Object.keys(FALLBACK_SECTIONS).forEach(function (k) {
      seen[k] = 1;
    });
    return Object.keys(seen);
  }

  // One section per row: the name, then the level. A grid of 16 rows is long,
  // so it lives inside a collapsed block the owner opens per person.
  function matrixEditorHtml(prefix, matrix) {
    var m = matrix || {};
    var rows = sectionKeys()
      .map(function (key) {
        var current = m[key] === 'view' || m[key] === 'edit' ? m[key] : 'none';
        var options = PERM_LEVELS.map(function (lvl) {
          return (
            '<option value="' +
            lvl.value +
            '"' +
            (current === lvl.value ? ' selected' : '') +
            '>' +
            lvl.label +
            '</option>'
          );
        }).join('');
        return (
          '<div class="team-matrix-row"><span class="team-matrix-label">' +
          esc(sectionLabel(key)) +
          '</span><select class="team-matrix-select" data-team-matrix-key="' +
          esc(key) +
          '" aria-label="' +
          esc(sectionLabel(key) + ' access') +
          '">' +
          options +
          '</select></div>'
        );
      })
      .join('');
    return '<div class="team-matrix" data-team-matrix="' + esc(prefix) + '">' + rows + '</div>';
  }

  function readMatrix(prefix) {
    var box = document.querySelector('[data-team-matrix="' + prefix + '"]');
    var out = {};
    if (!box) {
      return out;
    }
    var selects = box.querySelectorAll('[data-team-matrix-key]');
    for (var i = 0; i < selects.length; i++) {
      out[selects[i].getAttribute('data-team-matrix-key')] = selects[i].value;
    }
    return out;
  }

  function writeMatrix(prefix, matrix) {
    var box = document.querySelector('[data-team-matrix="' + prefix + '"]');
    if (!box || !matrix) {
      return;
    }
    var selects = box.querySelectorAll('[data-team-matrix-key]');
    for (var i = 0; i < selects.length; i++) {
      var key = selects[i].getAttribute('data-team-matrix-key');
      var lvl = matrix[key] === 'view' || matrix[key] === 'edit' ? matrix[key] : 'none';
      selects[i].value = lvl;
    }
  }

  // A date input holds YYYY-MM-DD in local time. Access ends at the END of the
  // chosen day, so a subcontractor working the last afternoon is not locked out
  // at midnight before it.
  function isoFromDateInput(value) {
    if (!value) {
      return null;
    }
    var parts = String(value).split('-');
    if (parts.length !== 3) {
      return null;
    }
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 0);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function dateInputFromIso(iso) {
    if (!iso) {
      return '';
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      return '';
    }
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    return (
      d.getFullYear() +
      '-' +
      (mm.length < 2 ? '0' + mm : mm) +
      '-' +
      (dd.length < 2 ? '0' + dd : dd)
    );
  }
  function fmtDate(iso) {
    if (!iso) {
      return '';
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      return '';
    }
    try {
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return String(iso).slice(0, 10);
    }
  }
  function toast(msg, type) {
    if (ns.App && ns.App.showToast) {
      ns.App.showToast(msg, type || 'ok');
    } else {
      setStatus(msg, type === 'err');
    }
  }
  function setStatus(msg, isErr) {
    if (!els.status) {
      return;
    }
    els.status.textContent = msg || '';
    els.status.classList.toggle('is-err', !!isErr);
  }
  function online() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  // ---- HTTP ---------------------------------------------------------------
  function jfetch(path, opts) {
    var o = Object.assign({ credentials: 'same-origin' }, opts || {});
    o.headers = Object.assign({ Accept: 'application/json' }, o.headers || {});
    return fetch(path, o)
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { status: res.status, ok: res.ok, body: body || {} };
          });
      })
      .catch(function () {
        return { status: 0, ok: false, body: {}, offline: true };
      });
  }
  function jpost(path, payload) {
    return jfetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  function cache(list) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          at: Date.now(),
          invitations: list.invitations,
          memberships: list.memberships
        })
      );
    } catch (e) {
      /* storage may be blocked */
    }
  }
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) {
        return null;
      }
      var p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : null;
    } catch (e) {
      return null;
    }
  }

  // ---- panel DOM ----------------------------------------------------------
  function buildPanel() {
    var pop = document.createElement('div');
    pop.id = 'team-pop';
    pop.className = 'team-pop';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.setAttribute('aria-label', 'Invitations and collaborators');
    pop.innerHTML =
      '<div class="team-pop-head">' +
      '<div class="team-tabs" role="tablist" aria-label="Team panel sections">' +
      '<button type="button" class="team-tab is-on" role="tab" id="team-tab-inv" aria-selected="true" aria-controls="team-pane-inv" data-team-tab="invitations">Invitations <span class="team-tab-count" id="team-tab-count" hidden>0</span></button>' +
      '<button type="button" class="team-tab" role="tab" id="team-tab-col" aria-selected="false" aria-controls="team-pane-col" data-team-tab="collaborators">Collaborators</button>' +
      '</div>' +
      '<button type="button" class="team-x" data-team-close aria-label="Close team panel"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button>' +
      '</div>' +
      '<div class="team-pane" id="team-pane-inv" role="tabpanel" aria-labelledby="team-tab-inv"><div class="team-list" id="team-inv-list"></div></div>' +
      '<div class="team-pane" id="team-pane-col" role="tabpanel" aria-labelledby="team-tab-col" hidden><div class="team-list" id="team-col-list"></div></div>' +
      '<div class="team-pop-foot"><span class="team-status" id="team-pop-status" role="status" aria-live="polite"></span><span class="team-offline" id="team-offline" hidden>Needs a connection</span></div>';
    document.body.appendChild(pop);
    els.pop = pop;
    els.invList = $('team-inv-list');
    els.colList = $('team-col-list');
    els.status = $('team-pop-status');
    els.offline = $('team-offline');
    els.tabCount = $('team-tab-count');

    pop.addEventListener('click', onPanelClick);
  }

  function onPanelClick(ev) {
    var t = ev.target.closest
      ? ev.target.closest(
          '[data-team-close],[data-team-tab],[data-team-accept],[data-team-decline],[data-team-open],[data-team-people],[data-team-resend],[data-team-revoke],[data-team-role],[data-team-access],[data-team-access-save],[data-team-extend],[data-team-bulk],[data-team-bulk-send],[data-team-tpls],[data-team-tpl-new],[data-team-tpl-save],[data-team-tpl-cancel],[data-team-tpl-apply],[data-team-tpl-del]'
        )
      : null;
    if (!t) {
      return;
    }
    if (t.hasAttribute('data-team-close')) {
      closePanel();
      return;
    }
    if (t.hasAttribute('data-team-tab')) {
      setTab(t.getAttribute('data-team-tab'));
      return;
    }
    if (t.hasAttribute('data-team-accept')) {
      acceptInvitation(Number(t.getAttribute('data-team-accept')));
      return;
    }
    if (t.hasAttribute('data-team-decline')) {
      declineInvitation(Number(t.getAttribute('data-team-decline')), t);
      return;
    }
    if (t.hasAttribute('data-team-open')) {
      openProject(t.getAttribute('data-team-open'));
      return;
    }
    if (t.hasAttribute('data-team-people')) {
      togglePeople(t.getAttribute('data-team-people'), t);
      return;
    }
    if (t.hasAttribute('data-team-resend')) {
      resend(t.getAttribute('data-team-project'), Number(t.getAttribute('data-team-resend')));
      return;
    }
    if (t.hasAttribute('data-team-revoke')) {
      revoke(t.getAttribute('data-team-project'), Number(t.getAttribute('data-team-revoke')), t);
      return;
    }
    if (t.hasAttribute('data-team-role')) {
      changeRole(
        t.getAttribute('data-team-project'),
        Number(t.getAttribute('data-team-role')),
        t.value
      );
      return;
    }
    // ---- sprint 3 ----
    if (t.hasAttribute('data-team-access')) {
      toggleAccess(Number(t.getAttribute('data-team-access')), t);
      return;
    }
    if (t.hasAttribute('data-team-access-save')) {
      saveAccess(
        t.getAttribute('data-team-project'),
        Number(t.getAttribute('data-team-access-save')),
        t
      );
      return;
    }
    if (t.hasAttribute('data-team-extend')) {
      extendAccess(t.getAttribute('data-team-project'), Number(t.getAttribute('data-team-extend')));
      return;
    }
    if (t.hasAttribute('data-team-bulk')) {
      toggleBlock('team-bulk-' + t.getAttribute('data-team-bulk'), t, 'Invite several people');
      return;
    }
    if (t.hasAttribute('data-team-bulk-send')) {
      sendBulk(t.getAttribute('data-team-bulk-send'), t);
      return;
    }
    if (t.hasAttribute('data-team-tpls')) {
      openTemplates(t.getAttribute('data-team-tpls'), t);
      return;
    }
    if (t.hasAttribute('data-team-tpl-new')) {
      var pe = $('team-tpl-editor-' + t.getAttribute('data-team-tpl-new'));
      if (pe) {
        pe.hidden = false;
      }
      return;
    }
    if (t.hasAttribute('data-team-tpl-cancel')) {
      var pc = $('team-tpl-editor-' + t.getAttribute('data-team-tpl-cancel'));
      if (pc) {
        pc.hidden = true;
      }
      return;
    }
    if (t.hasAttribute('data-team-tpl-save')) {
      saveTemplate(t.getAttribute('data-team-tpl-save'), t);
      return;
    }
    if (t.hasAttribute('data-team-tpl-apply')) {
      applyTemplate(Number(t.getAttribute('data-team-tpl-apply')));
      return;
    }
    if (t.hasAttribute('data-team-tpl-del')) {
      deleteTemplate(
        t.getAttribute('data-team-project'),
        Number(t.getAttribute('data-team-tpl-del')),
        t
      );
    }
  }

  function setTab(tab) {
    state.tab = tab === 'collaborators' ? 'collaborators' : 'invitations';
    var inv = $('team-tab-inv');
    var col = $('team-tab-col');
    var invPane = $('team-pane-inv');
    var colPane = $('team-pane-col');
    if (!inv || !col || !invPane || !colPane) {
      return;
    }
    inv.classList.toggle('is-on', state.tab === 'invitations');
    col.classList.toggle('is-on', state.tab === 'collaborators');
    inv.setAttribute('aria-selected', state.tab === 'invitations' ? 'true' : 'false');
    col.setAttribute('aria-selected', state.tab === 'collaborators' ? 'true' : 'false');
    invPane.hidden = state.tab !== 'invitations';
    colPane.hidden = state.tab !== 'collaborators';
    if (state.tab === 'collaborators') {
      loadCollaborators();
    }
  }

  function openPanel() {
    if (!els.pop) {
      return;
    }
    state.open = true;
    els.pop.hidden = false;
    var bell = document.querySelector('[data-team-bell]');
    if (bell) {
      bell.setAttribute('aria-expanded', 'true');
      placePanel(bell);
    }
    var first = els.pop.querySelector('.team-tab.is-on');
    if (first) {
      first.focus();
    }
    refresh();
  }
  // Fixed position computed from the bell itself: the launcher anchors it in
  // the rail (left edge) and the project page in the header (right edge), and
  // the header grows a row taller whenever a scope banner is on. Anchoring to
  // the measured rect keeps both pages correct at 360px without a page-specific
  // offset or a layout shift.
  function placePanel(bell) {
    if (!els.pop) {
      return;
    }
    var r = bell.getBoundingClientRect();
    var vw = window.innerWidth || 360;
    var vh = window.innerHeight || 640;
    var w = Math.min(380, vw - 16);
    els.pop.style.width = w + 'px';
    var left = r.left;
    if (left + w > vw - 8) {
      left = vw - w - 8;
    }
    if (left < 8) {
      left = 8;
    }
    els.pop.style.left = left + 'px';
    var top = r.bottom + 8;
    // Flip above the bell when there is not enough room below (a short
    // landscape phone) - still inside the viewport.
    var avail = vh - top - 8;
    if (avail < 240 && r.top > avail) {
      top = Math.max(8, r.top - 8 - Math.min(vh - 16, 480));
    }
    els.pop.style.top = top + 'px';
    els.pop.style.maxHeight = Math.max(200, vh - top - 12) + 'px';
  }
  function closePanel() {
    if (!els.pop) {
      return;
    }
    state.open = false;
    els.pop.hidden = true;
    var bell = document.querySelector('[data-team-bell]');
    if (bell) {
      bell.setAttribute('aria-expanded', 'false');
      try {
        bell.focus();
      } catch (e) {
        /* ignore */
      }
    }
  }
  function togglePanel() {
    if (state.open) {
      closePanel();
    } else {
      openPanel();
    }
  }
  function onKey(ev) {
    if (!state.open) {
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closePanel();
      return;
    }
    if (ev.key !== 'Tab' || !els.pop) {
      return;
    }
    var f = els.pop.querySelectorAll(
      'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!f.length) {
      return;
    }
    var first = f[0];
    var last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  // ---- badge --------------------------------------------------------------
  function setBadge(n) {
    var bell = document.querySelector('[data-team-bell]');
    var badge = $('team-bell-count');
    if (badge) {
      badge.textContent = String(n);
      badge.hidden = n <= 0;
    }
    if (els.tabCount) {
      els.tabCount.textContent = String(n);
      els.tabCount.hidden = n <= 0;
    }
    if (bell) {
      bell.setAttribute(
        'aria-label',
        n > 0
          ? n + (n === 1 ? ' invitation waiting' : ' invitations waiting')
          : 'Invitations and collaborators'
      );
    }
  }

  function setSignedIn(yes) {
    state.signedIn = !!yes;
    var bell = document.querySelector('[data-team-bell]');
    if (bell) {
      bell.hidden = !yes;
    }
    var shared = $('shared-dash');
    if (shared && !yes) {
      shared.hidden = true;
    }
  }

  // ---- render: invitations ------------------------------------------------
  function renderInvitations() {
    if (!els.invList) {
      return;
    }
    var list = state.invitations;
    if (!list.length) {
      els.invList.innerHTML =
        '<div class="team-empty"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-user"></use></svg><p>No invitations waiting.</p><p class="team-empty-sub">When an owner invites this email, it appears here.</p></div>';
    } else {
      els.invList.innerHTML = list
        .map(function (inv) {
          var scope = inv.role === 'client' ? sectionList(inv.scope) : ROLE_SUMMARY[inv.role] || '';
          var accepted = !!state.accepted[inv.projectId];
          return (
            '<article class="team-card" role="listitem">' +
            '<div class="team-card-top"><b>' +
            esc(inv.projectName) +
            '</b><span class="team-role team-role-' +
            esc(inv.role) +
            '">' +
            esc(roleLabel(inv.role)) +
            '</span></div>' +
            '<p class="team-card-sub">Invitation from ' +
            esc(inv.inviterName) +
            (inv.expiresAt ? ' &middot; expires ' + esc(fmtDate(inv.expiresAt)) : '') +
            '</p>' +
            (scope ? '<p class="team-card-scope">' + esc(scope) + '</p>' : '') +
            '<div class="team-card-actions">' +
            (accepted
              ? '<span class="team-ok">Accepted.</span><button type="button" class="btn btn-g btn-s" data-team-open="' +
                esc(inv.projectId) +
                '">Open project</button>'
              : '<button type="button" class="btn btn-g btn-s" data-team-accept="' +
                esc(inv.id) +
                '">Accept</button>' +
                '<button type="button" class="btn btn-o btn-s" data-team-decline="' +
                esc(inv.id) +
                '">' +
                (state.pendingDecline === inv.id ? 'Confirm decline' : 'Decline') +
                '</button>') +
            '</div></article>'
          );
        })
        .join('');
    }
    setBadge(state.invitations.length);
    if (els.offline) {
      els.offline.hidden = online();
    }
  }

  // ---- render: collaborators ---------------------------------------------
  function projectNameFor(pid) {
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].projectId === pid) {
        return state.projects[i].label || state.projects[i].projectId;
      }
    }
    return pid;
  }
  function ownedProjects() {
    return state.projects.filter(function (p) {
      return !p.deletedAt && !p.discontinued;
    });
  }

  function renderCollaborators() {
    if (!els.colList) {
      return;
    }
    var mine = state.memberships;
    var owned = ownedProjects();
    var html = '';
    html += '<section class="team-block"><h4>Shared with me</h4>';
    if (!mine.length) {
      html += '<p class="team-empty-sub">No projects shared with this email yet.</p>';
    } else {
      mine.forEach(function (m) {
        html +=
          '<div class="team-person"><div class="team-person-id"><b>' +
          esc(m.projectName) +
          '</b><span class="team-person-sub">' +
          esc(m.ownerName) +
          ' &middot; ' +
          esc(roleLabel(m.role)) +
          '</span></div>' +
          '<button type="button" class="btn btn-o btn-s" data-team-open="' +
          esc(m.projectId) +
          '">Open</button></div>';
      });
    }
    html += '</section><section class="team-block"><h4>Your projects</h4>';
    if (!owned.length) {
      html += '<p class="team-empty-sub">No cloud projects of your own to manage here.</p>';
    } else {
      owned.forEach(function (p) {
        html +=
          '<div class="team-project-row"><span class="team-project-name">' +
          esc(p.label || p.projectId) +
          '</span><button type="button" class="btn btn-o btn-s" data-team-people="' +
          esc(p.projectId) +
          '">People</button></div>' +
          '<div class="team-people" id="team-people-' +
          esc(p.projectId) +
          '" hidden></div>';
      });
    }
    html += '</section>';
    els.colList.innerHTML = html;
    Object.keys(state.peopleOpen).forEach(function (pid) {
      if (state.peopleOpen[pid]) {
        loadPeople(pid);
      }
    });
  }

  function personRow(pid, m) {
    var roleSelect =
      '<select class="team-role-select" aria-label="Role for ' +
      esc(m.inviteeEmail || 'member') +
      '" data-team-role="' +
      m.id +
      '" data-team-project="' +
      esc(pid) +
      '">' +
      ['manager', 'supervisor', 'contractor', 'client']
        .map(function (r) {
          return (
            '<option value="' +
            r +
            '"' +
            (m.role === r ? ' selected' : '') +
            '>' +
            roleLabel(r) +
            '</option>'
          );
        })
        .join('') +
      '</select>';
    var actions =
      m.status === 'pending'
        ? '<button type="button" class="team-link" data-team-resend="' +
          esc(m.id) +
          '" data-team-project="' +
          esc(pid) +
          '">Resend</button>'
        : '';
    if (enterprise()) {
      actions +=
        '<button type="button" class="team-link" data-team-access="' +
        esc(m.id) +
        '" aria-expanded="false" aria-controls="team-access-' +
        esc(m.id) +
        '">Access</button>';
    }
    actions +=
      '<button type="button" class="team-link team-link-danger" data-team-revoke="' +
      esc(m.id) +
      '" data-team-project="' +
      esc(pid) +
      '">Revoke</button>';
    var when =
      m.status === 'pending' && m.expiresAt
        ? 'Expires ' + fmtDate(m.expiresAt)
        : m.acceptedAt
          ? 'Joined ' + fmtDate(m.acceptedAt)
          : esc(m.status);
    // Sprint 3: the 7-day notice. The server computes `accessExpiringSoon`, so
    // the page cannot disagree with what the Worker will enforce.
    var box = '';
    if (m.accessExpiresAt) {
      box =
        '<span class="team-person-sub team-access-note' +
        (m.accessExpiringSoon ? ' is-soon' : '') +
        '">' +
        (m.accessExpired
          ? 'Access ended ' + fmtDate(m.accessExpiresAt)
          : m.accessExpiringSoon
            ? 'Access ends in under 7 days, on ' + fmtDate(m.accessExpiresAt)
            : 'Access ends ' + fmtDate(m.accessExpiresAt)) +
        '</span>';
    }
    var extend =
      enterprise() && m.accessExpiresAt
        ? '<button type="button" class="team-link" data-team-extend="' +
          esc(m.id) +
          '" data-team-project="' +
          esc(pid) +
          '">Add 30 days</button>'
        : '';
    var row =
      '<div class="team-person team-person-row">' +
      '<div class="team-person-id"><b>' +
      esc(m.inviteeEmail) +
      '</b><span class="team-person-sub">' +
      esc(m.status) +
      ' &middot; ' +
      when +
      '</span>' +
      box +
      '</div>' +
      roleSelect +
      '<div class="team-person-actions">' +
      actions +
      extend +
      '</div></div>';
    if (!enterprise()) {
      return row;
    }
    // The access editor: one row per section, the date the access ends, and a
    // save. It is collapsed until the owner asks for it, because 16 rows per
    // person would bury the list.
    var tplOptions =
      '<option value="">Pick a template</option>' +
      state.templates
        .map(function (t) {
          return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
        })
        .join('');
    return (
      row +
      '<div class="team-access" id="team-access-' +
      esc(m.id) +
      '" hidden>' +
      '<p class="team-note">' +
      (m.role === 'client'
        ? 'A client can never change the project. A level saved as Change is kept as View.'
        : 'Choose what this person can see and change, then save.') +
      '</p>' +
      '<div class="team-sub-row"><label class="team-sub-label" for="team-tpl-pick-' +
      esc(m.id) +
      '">Start from a template</label>' +
      '<select id="team-tpl-pick-' +
      esc(m.id) +
      '" class="team-role-select">' +
      tplOptions +
      '</select>' +
      '<button type="button" class="team-link" data-team-tpl-apply="' +
      esc(m.id) +
      '">Use it</button></div>' +
      matrixEditorHtml('m' + m.id, m.perm) +
      '<div class="team-access-row"><label class="team-sub-label" for="team-exp-' +
      esc(m.id) +
      '">Access ends (optional)</label>' +
      '<input type="date" class="team-date" id="team-exp-' +
      esc(m.id) +
      '" value="' +
      esc(dateInputFromIso(m.accessExpiresAt)) +
      '"></div>' +
      '<div class="team-sub-row"><button type="button" class="btn btn-g btn-s" data-team-access-save="' +
      esc(m.id) +
      '" data-team-project="' +
      esc(pid) +
      '">Save access</button></div>' +
      '</div>'
    );
  }

  function toolsHtml(pid) {
    if (!enterprise()) {
      return '';
    }
    var base = '/api/cloud/projects/' + encodeURIComponent(pid) + '/team';
    return (
      '<div class="team-tools">' +
      '<button type="button" class="team-link" data-team-bulk="' +
      esc(pid) +
      '">Invite several people</button>' +
      '<button type="button" class="team-link" data-team-tpls="' +
      esc(pid) +
      '">Templates</button>' +
      '<a class="team-link" href="' +
      esc(base) +
      '/audit.csv" download>Audit log (CSV)</a>' +
      '</div>' +
      '<div class="team-sub" id="team-bulk-' +
      esc(pid) +
      '" hidden>' +
      '<label class="team-sub-label" for="team-bulk-emails-' +
      esc(pid) +
      '">One email per line, up to 100</label>' +
      '<textarea class="team-bulk-box" id="team-bulk-emails-' +
      esc(pid) +
      '" rows="3" spellcheck="false"></textarea>' +
      '<div class="team-sub-row"><select class="team-role-select" id="team-bulk-role-' +
      esc(pid) +
      '" aria-label="Role for the new people">' +
      ['manager', 'supervisor', 'contractor', 'client']
        .map(function (r) {
          return '<option value="' + r + '">' + roleLabel(r) + '</option>';
        })
        .join('') +
      '</select>' +
      '<button type="button" class="btn btn-g btn-s" data-team-bulk-send="' +
      esc(pid) +
      '">Send invitations</button></div>' +
      '<p class="team-note" id="team-bulk-out-' +
      esc(pid) +
      '" role="status"></p>' +
      '</div>' +
      '<div class="team-sub" id="team-tpls-' +
      esc(pid) +
      '" hidden>' +
      '<p class="team-note">A template is a saved set of section permissions you can reuse on any of your projects.</p>' +
      '<div class="team-tpl-list" id="team-tpl-list-' +
      esc(pid) +
      '"></div>' +
      '<div class="team-sub-row"><input class="team-tpl-name" id="team-tpl-name-' +
      esc(pid) +
      '" maxlength="60" placeholder="Template name" aria-label="Template name">' +
      '<button type="button" class="btn btn-o btn-s" data-team-tpl-new="' +
      esc(pid) +
      '">New template</button></div>' +
      '<div id="team-tpl-editor-' +
      esc(pid) +
      '" hidden>' +
      matrixEditorHtml('tpl' + pid, {}) +
      '<div class="team-sub-row"><button type="button" class="btn btn-g btn-s" data-team-tpl-save="' +
      esc(pid) +
      '">Save template</button>' +
      '<button type="button" class="team-link" data-team-tpl-cancel="' +
      esc(pid) +
      '">Cancel</button></div>' +
      '</div>' +
      '</div>'
    );
  }

  async function loadPeople(pid) {
    var box = $('team-people-' + pid);
    if (!box) {
      return;
    }
    box.hidden = false;
    box.innerHTML = '<p class="team-empty-sub">Loading people.</p>';
    var r = await jfetch('/api/cloud/projects/' + encodeURIComponent(pid) + '/team');
    if (!r.ok) {
      box.innerHTML = '<p class="team-empty-sub">Could not load the people on this project.</p>';
      return;
    }
    var members = (r.body && r.body.members) || [];
    if (enterprise() && !state.templatesLoaded) {
      await ensureTemplates();
    }
    box.innerHTML =
      toolsHtml(pid) +
      (members.length
        ? members
            .map(function (m) {
              return personRow(pid, m);
            })
            .join('')
        : '<p class="team-empty-sub">Nobody else is on this project yet.</p>');
    if (els.offline) {
      els.offline.hidden = online();
    }
  }

  async function ensureTemplates() {
    var r = await jfetch('/api/team/templates');
    if (r.ok && r.body && r.body.ok) {
      state.templates = r.body.templates || [];
      state.templatesLoaded = true;
    }
    return state.templates;
  }

  function renderTemplateList(pid) {
    var box = $('team-tpl-list-' + pid);
    if (!box) {
      return;
    }
    if (!state.templates.length) {
      box.innerHTML = '<p class="team-empty-sub">No templates yet.</p>';
      return;
    }
    box.innerHTML = state.templates
      .map(function (t) {
        return (
          '<div class="team-person"><div class="team-person-id"><b>' +
          esc(t.name) +
          '</b><span class="team-person-sub">' +
          esc(
            sectionList(
              Object.keys(t.perm || {}).filter(function (k) {
                return t.perm[k] === 'view' || t.perm[k] === 'edit';
              })
            )
          ) +
          '</span></div>' +
          '<button type="button" class="team-link team-link-danger" data-team-tpl-del="' +
          esc(t.id) +
          '" data-team-project="' +
          esc(pid) +
          '">Delete</button></div>'
        );
      })
      .join('');
  }

  async function togglePeople(pid, btn) {
    var box = $('team-people-' + pid);
    if (!box) {
      return;
    }
    state.peopleOpen[pid] = box.hidden;
    if (box.hidden) {
      await loadPeople(pid);
      btn.textContent = 'Hide people';
    } else {
      box.hidden = true;
      btn.textContent = 'People';
    }
  }

  // ---- actions ------------------------------------------------------------
  async function acceptInvitation(id) {
    if (!online()) {
      setStatus('Needs a connection to accept.', true);
      return;
    }
    var inv = state.invitations.filter(function (i) {
      return i.id === id;
    })[0];
    var r = await jpost('/api/team/invitations/' + id + '/accept');
    if (!r.ok || !r.body.ok) {
      setStatus((r.body && r.body.error) || 'Could not accept the invitation.', true);
      return;
    }
    if (inv) {
      state.accepted[inv.projectId] = true;
    }
    state.invitations = state.invitations.filter(function (i) {
      return i.id !== id;
    });
    setBadge(state.invitations.length);
    renderInvitations();
    setStatus('Invitation accepted.', false);
    toast('Invitation accepted. The project is now in Shared with me.', 'ok');
    loadMemberships();
  }

  async function declineInvitation(id, btn) {
    if (!online()) {
      setStatus('Needs a connection to decline.', true);
      return;
    }
    if (state.pendingDecline !== id) {
      state.pendingDecline = id;
      renderInvitations();
      var again = els.invList.querySelector('[data-team-decline="' + id + '"]');
      if (again) {
        again.focus();
      }
      return;
    }
    state.pendingDecline = 0;
    var r = await jpost('/api/team/invitations/' + id + '/decline');
    if (!r.ok || !r.body.ok) {
      setStatus((r.body && r.body.error) || 'Could not decline the invitation.', true);
      return;
    }
    state.invitations = state.invitations.filter(function (i) {
      return i.id !== id;
    });
    setBadge(state.invitations.length);
    renderInvitations();
    setStatus('Invitation declined.', false);
    toast('Invitation declined.', 'ok');
  }

  async function resend(pid, mid) {
    var r = await jpost(
      '/api/cloud/projects/' + encodeURIComponent(pid) + '/team/' + mid + '/resend'
    );
    if (!r.ok || !r.body.ok) {
      setStatus((r.body && r.body.error) || 'Could not resend the invitation.', true);
      return;
    }
    setStatus('Invitation resent.', false);
    loadPeople(pid);
  }

  async function changeRole(pid, mid, role) {
    var r = await jfetch('/api/cloud/projects/' + encodeURIComponent(pid) + '/team/' + mid, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role })
    });
    if (!r.ok || !r.body.ok) {
      setStatus((r.body && r.body.error) || 'Could not change the role.', true);
      return;
    }
    setStatus('Role updated.', false);
    loadPeople(pid);
  }

  async function revoke(pid, mid, btn) {
    if (btn.getAttribute('data-confirm') !== '1') {
      btn.setAttribute('data-confirm', '1');
      btn.textContent = 'Confirm revoke';
      return;
    }
    btn.removeAttribute('data-confirm');
    var r = await jfetch('/api/cloud/projects/' + encodeURIComponent(pid) + '/team/' + mid, {
      method: 'DELETE'
    });
    if (!r.ok || !r.body.ok) {
      setStatus((r.body && r.body.error) || 'Could not revoke access.', true);
      return;
    }
    setStatus('Access revoked.', false);
    toast('Access revoked.', 'ok');
    loadPeople(pid);
  }

  // ---- sprint 3 actions ---------------------------------------------------
  function toggleBlock(id, btn, label) {
    var box = $(id);
    if (!box) {
      return;
    }
    box.hidden = !box.hidden;
    if (btn && btn.tagName === 'BUTTON') {
      btn.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
      btn.textContent = box.hidden ? label : 'Hide';
    }
  }

  function toggleAccess(mid, btn) {
    var box = $('team-access-' + mid);
    if (!box) {
      return;
    }
    box.hidden = !box.hidden;
    state.accessOpen[mid] = !box.hidden;
    btn.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
  }

  async function saveAccess(pid, mid, btn) {
    if (!online()) {
      setStatus('Needs a connection to save access.', true);
      return;
    }
    var matrix = readMatrix('m' + mid);
    var dateInput = $('team-exp-' + mid);
    var body = { perm: matrix };
    // An empty date clears the time box: access runs until revoked.
    body.accessExpiresAt = isoFromDateInput(dateInput ? dateInput.value : '');
    btn.disabled = true;
    var r = await jfetch('/api/cloud/projects/' + encodeURIComponent(pid) + '/team/' + mid, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    btn.disabled = false;
    if (!r.ok || !r.body.ok) {
      setStatus(
        (r.body && r.body.error === 'enterprise_feature'
          ? 'Custom access is not part of this plan.'
          : r.body && r.body.error) || 'Could not save that access.',
        true
      );
      return;
    }
    setStatus('Access saved.', false);
    toast('Access saved.', 'ok');
    await loadPeople(pid);
  }

  async function extendAccess(pid, mid) {
    if (!online()) {
      setStatus('Needs a connection to extend access.', true);
      return;
    }
    var r = await jpost(
      '/api/cloud/projects/' + encodeURIComponent(pid) + '/team/' + mid + '/extend',
      { days: 30 }
    );
    if (!r.ok || !r.body.ok) {
      setStatus(
        (r.body && r.body.error === 'enterprise_feature'
          ? 'Adding days is not part of this plan.'
          : r.body && r.body.error) || 'Could not add the days.',
        true
      );
      return;
    }
    setStatus('Access extended by 30 days.', false);
    toast('Access extended by 30 days.', 'ok');
    await loadPeople(pid);
  }

  var BULK_REASON = {
    invited: 'invited',
    already_member: 'already on the project',
    invalid: 'not a valid email',
    member_limit: 'over the seat limit',
    enterprise_feature: 'not included in the plan',
    template_not_found: 'the template was deleted'
  };

  async function sendBulk(pid, btn) {
    var ta = $('team-bulk-emails-' + pid);
    var out = $('team-bulk-out-' + pid);
    var roleSel = $('team-bulk-role-' + pid);
    var raw = ta ? ta.value : '';
    var list = raw
      .split(/[\s,;]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return !!s;
      });
    if (!list.length) {
      if (out) {
        out.textContent = 'Add at least one email address.';
      }
      return;
    }
    if (list.length > 100) {
      if (out) {
        out.textContent = 'One batch holds up to 100 addresses. Split the list and send again.';
      }
      return;
    }
    btn.disabled = true;
    if (out) {
      out.textContent = 'Sending.';
    }
    var r = await jpost('/api/cloud/projects/' + encodeURIComponent(pid) + '/team/bulk', {
      emails: list,
      role: roleSel ? roleSel.value : 'contractor'
    });
    btn.disabled = false;
    if (!r.ok || !r.body.ok) {
      if (out) {
        out.textContent =
          r.body && r.body.error === 'enterprise_feature'
            ? 'Inviting several people at once is not part of this plan.'
            : (r.body && r.body.error) || 'Could not send the invitations.';
      }
      return;
    }
    var counts = {};
    var rows = r.body.results || [];
    rows.forEach(function (row) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    });
    var parts = [];
    Object.keys(counts).forEach(function (k) {
      parts.push(counts[k] + ' ' + (BULK_REASON[k] || 'not added'));
    });
    if (out) {
      out.textContent = 'Results: ' + parts.join(', ') + '.';
    }
    if (ta) {
      ta.value = '';
    }
    await loadPeople(pid);
    var again = $('team-bulk-out-' + pid);
    if (again) {
      again.textContent = 'Results: ' + parts.join(', ') + '.';
    }
  }

  async function openTemplates(pid, btn) {
    var box = $('team-tpls-' + pid);
    if (!box) {
      return;
    }
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
    btn.textContent = box.hidden ? 'Templates' : 'Hide templates';
    if (box.hidden) {
      return;
    }
    await ensureTemplates();
    renderTemplateList(pid);
  }

  async function saveTemplate(pid, btn) {
    var nameBox = $('team-tpl-name-' + pid);
    var name = nameBox ? String(nameBox.value || '').trim() : '';
    if (name.length < 2) {
      setStatus('Give the template a name first.', true);
      return;
    }
    btn.disabled = true;
    var r = await jpost('/api/team/templates', { name: name, perm: readMatrix('tpl' + pid) });
    btn.disabled = false;
    if (!r.ok || !r.body.ok) {
      setStatus(
        r.body && r.body.error === 'template_limit'
          ? 'You already have the most templates this plan allows.'
          : (r.body && r.body.error) || 'Could not save the template.',
        true
      );
      return;
    }
    if (nameBox) {
      nameBox.value = '';
    }
    var ed = $('team-tpl-editor-' + pid);
    if (ed) {
      ed.hidden = true;
    }
    state.templatesLoaded = false;
    await ensureTemplates();
    renderTemplateList(pid);
    setStatus('Template saved.', false);
  }

  async function deleteTemplate(pid, id, btn) {
    if (btn.getAttribute('data-confirm') !== '1') {
      btn.setAttribute('data-confirm', '1');
      btn.textContent = 'Confirm delete';
      return;
    }
    btn.removeAttribute('data-confirm');
    var r = await jfetch('/api/team/templates/' + id, { method: 'DELETE' });
    if (!r.ok || !r.body.ok) {
      setStatus((r.body && r.body.error) || 'Could not delete the template.', true);
      return;
    }
    state.templates = state.templates.filter(function (t) {
      return Number(t.id) !== Number(id);
    });
    renderTemplateList(pid);
    setStatus('Template deleted.', false);
  }

  function applyTemplate(mid) {
    var sel = $('team-tpl-pick-' + mid);
    var tpl = null;
    if (sel && sel.value) {
      tpl =
        state.templates.filter(function (t) {
          return String(t.id) === String(sel.value);
        })[0] || null;
    }
    if (!tpl) {
      setStatus('Pick a template first.', true);
      return;
    }
    writeMatrix('m' + mid, tpl.perm);
    setStatus('Template filled in. Save access to keep it.', false);
  }

  // Opens a project this person does not own. Mirrors the launcher's own
  // load flow: fetch the snapshot, seed the local state, seed the scope slot
  // so the viewer applies the member's role, then navigate.
  async function openProject(pid) {
    if (!online()) {
      setStatus('Needs a connection to open the project.', true);
      return;
    }
    setStatus('Opening.', false);
    var res = await jfetch('/api/cloud/projects/' + encodeURIComponent(pid) + '/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    var data = res.body || {};
    if (!res.ok || !data.ok) {
      setStatus(data.error || 'Could not open the project.', true);
      return;
    }
    var role = data.teamRole || data.role || '';
    // A project with no cloud snapshot has nothing to open. Navigating anyway
    // bounced the member back to the launcher with no explanation, because the
    // project page finds no local state and sends them home. Say it here, the
    // same way the code-entry flow does, instead of a silent round trip.
    if (!data.state) {
      setStatus(
        'This project has no cloud snapshot yet. Ask the owner to save it once, then open it again.',
        true
      );
      return;
    }
    try {
      if (data.state) {
        localStorage.setItem('mmgr_state_' + pid, JSON.stringify(data.state));
        localStorage.setItem('mmgr_unlocked_' + pid, '1');
        localStorage.setItem('mmgr_scope_' + pid, role === 'client' ? 'readonly' : 'full');
        localStorage.setItem('mmgr_current_project', pid);
      }
      if (data.teamRole) {
        sessionStorage.setItem(
          'mmgr_cloud_escope_' + pid,
          JSON.stringify({
            label: 'Team ' + data.teamRole,
            sections: data.teamRole === 'client' ? data.sections || [] : data.scope || [],
            role: data.teamRole === 'client' ? 'client' : 'team',
            teamRole: data.teamRole
          })
        );
      }
    } catch (e) {
      setStatus('Storage is blocked, so the project cannot be opened here.', true);
      return;
    }
    window.location.href = 'project.html?id=' + encodeURIComponent(pid);
  }

  // ---- data load ----------------------------------------------------------
  async function loadSections() {
    var r = await jfetch('/api/cloud/sections');
    if (r.ok && r.body && Array.isArray(r.body.sections)) {
      var map = {};
      r.body.sections.forEach(function (s) {
        if (s && s.key) {
          map[s.key] = s.label || s.key;
        }
      });
      state.sections = Object.assign({}, FALLBACK_SECTIONS, map);
    }
  }

  async function loadMemberships() {
    var r = await jfetch('/api/team/memberships');
    if (r.ok && r.body && r.body.ok) {
      state.memberships = r.body.memberships || [];
      renderCollaborators();
      renderShared();
    }
    return r;
  }

  async function refresh() {
    var inv = await jfetch('/api/team/invitations');
    if (inv.status === 403) {
      // Signed out, or an unverified address. The bell is not useful there.
      setSignedIn(false);
      setBadge(0);
      return;
    }
    if (!inv.ok) {
      var cached = readCache();
      if (cached) {
        state.invitations = cached.invitations || [];
        renderInvitations();
      }
      if (els.offline) {
        els.offline.hidden = false;
      }
      return;
    }
    setSignedIn(true);
    state.invitations = (inv.body && inv.body.invitations) || [];
    renderInvitations();
    // The launcher renders "Shared with me" outside the panel, so the list has
    // to be loaded on the ordinary refresh - waiting for the Collaborators tab
    // would leave a returning member with no way to reach their project.
    if ($('shared-dash')) {
      await loadMemberships();
    }
    if (state.tab === 'collaborators') {
      await loadMemberships();
      await loadOwnedProjects();
    }
    cache({ invitations: state.invitations, memberships: state.memberships });
  }

  async function loadOwnedProjects() {
    var r = await jfetch('/api/cloud/projects');
    if (r.ok && r.body && r.body.ok) {
      state.projects = r.body.projects || [];
      renderCollaborators();
    }
  }

  async function loadCollaborators() {
    setStatus('', false);
    await Promise.all([loadMemberships(), loadOwnedProjects()]);
  }

  function renderShared() {
    var wrap = $('shared-dash');
    var list = $('shared-list');
    if (!wrap || !list) {
      return;
    }
    if (!state.memberships.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    list.innerHTML = state.memberships
      .map(function (m) {
        return (
          '<div class="cd-card" role="listitem"><div class="cd-card-head"><div class="cd-card-title">' +
          '<span class="db-project-ico"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-user"></use></svg></span>' +
          '<span class="cd-card-name">' +
          esc(m.projectName) +
          '</span></div>' +
          '<span class="team-role team-role-' +
          esc(m.role) +
          '">' +
          esc(roleLabel(m.role)) +
          '</span></div>' +
          '<div class="cd-card-meta"><span>Owner: ' +
          esc(m.ownerName) +
          '</span></div>' +
          '<div class="cd-card-actions"><button type="button" class="btn btn-o btn-s" data-team-open="' +
          esc(m.projectId) +
          '">Open project <svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-right"></use></svg></button></div></div>'
        );
      })
      .join('');
  }

  // A member whose project was revoked while the page is open must see it
  // without a reload. Called on the normal poll and exposed for QA.
  async function checkAccess() {
    if (!document.getElementById('app-header')) {
      return;
    }
    var pid = ns.projectId || new URLSearchParams(window.location.search).get('id') || '';
    var role = '';
    try {
      var raw = sessionStorage.getItem('mmgr_cloud_escope_' + pid);
      var es = raw ? JSON.parse(raw) : null;
      role = es && es.teamRole ? es.teamRole : '';
    } catch (e) {
      role = '';
    }
    if (!pid || !role) {
      return;
    }
    var r = await jfetch('/api/team/memberships');
    if (r.status === 403) {
      showAccessRemoved();
      return;
    }
    if (!r.ok) {
      return;
    }
    var still = ((r.body && r.body.memberships) || []).some(function (m) {
      return m.projectId === pid;
    });
    if (!still) {
      showAccessRemoved();
    }
  }

  function showAccessRemoved() {
    var b = $('team-access-banner');
    if (b) {
      b.classList.remove('is-hide');
    }
    try {
      sessionStorage.removeItem('mmgr_cloud_escope_' + (ns.projectId || ''));
    } catch (e) {
      /* ignore */
    }
    toast('Access removed. This project is no longer shared with you.', 'err');
    // Every Save-to-Cloud control the drawer can render, not just the first:
    // the drawer re-renders its action row per state, so there can be several
    // in the DOM at once.
    var saveBtns = document.querySelectorAll(
      '[data-action="cloudSave"], #cloud-save, [data-action="cloudAutoSave"]'
    );
    for (var i = 0; i < saveBtns.length; i++) {
      saveBtns[i].disabled = true;
      saveBtns[i].setAttribute('aria-disabled', 'true');
      saveBtns[i].setAttribute(
        'title',
        'Access removed. Ask the project owner for a new invitation.'
      );
    }
  }

  // ---- boot ---------------------------------------------------------------
  // Marks the document once the first refresh has settled. The bell starts
  // hidden (a signed-out visitor must never see it), so anything that reads
  // the DOM before this lands sees the pre-boot state rather than the answer.
  function markReady() {
    try {
      document.documentElement.setAttribute('data-team-ready', '1');
    } catch (e) {
      /* ignore */
    }
  }

  function boot() {
    var bell = document.querySelector('[data-team-bell]');
    if (!bell) {
      if ($('shared-dash')) {
        buildPanel();
        setSignedIn(false);
        refresh().then(markReady, markReady);
      } else {
        markReady();
      }
      return;
    }
    buildPanel();
    setSignedIn(false);
    bell.addEventListener('click', function (ev) {
      ev.preventDefault();
      togglePanel();
    });
    document.addEventListener('keydown', onKey);
    // "Open project" also lives in the launcher's Shared-with-me list, which is
    // OUTSIDE the panel - the panel's own delegated handler cannot see it. One
    // document-level handler serves those cards and skips anything inside the
    // panel so a card there never opens twice.
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-team-open]') : null;
      if (!t || (els.pop && els.pop.contains(t))) {
        return;
      }
      ev.preventDefault();
      openProject(t.getAttribute('data-team-open'));
    });
    document.addEventListener('click', function (ev) {
      if (!state.open || !els.pop) {
        return;
      }
      if (els.pop.contains(ev.target) || bell.contains(ev.target)) {
        return;
      }
      closePanel();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.signedIn) {
        refresh();
        checkAccess();
      }
    });
    window.addEventListener('focus', function () {
      if (state.signedIn) {
        refresh();
      }
    });
    window.addEventListener('online', function () {
      if (els.offline) {
        els.offline.hidden = true;
      }
      refresh();
    });
    setInterval(function () {
      if (document.visibilityState === 'visible') {
        refresh();
        checkAccess();
      }
    }, REFRESH_MS);
    loadSections();
    refresh().then(markReady, markReady);
    checkAccess();
  }

  ns.TeamUI = {
    refresh: refresh,
    refreshNow: function () {
      return refresh().then(checkAccess);
    },
    open: openPanel,
    close: closePanel,
    checkAccess: checkAccess,
    showAccessRemoved: showAccessRemoved,
    _state: state
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(MMGR);
window.MMGR = MMGR;
