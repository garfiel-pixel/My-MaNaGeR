/* ============================================================
   My MaNaGeR , Cloud Editor Scope
   Grey-out panels an editor code cannot write.
   Extracted from mmgr-cloud.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const C = ns.Cloud;
  const $ = function (id) {
    return document.getElementById(id);
  };

  const VIEW_ONLY_PANELS = ['dash', 'def', 'kan', 'gantt', 'claim', 'digest', 'baselinen', 'wxlog'];

  // RBAC sprint 2 (directive 2026-10-25): a named team member's grant lives in
  // the same session slot an editor code uses, with role 'team' (supervisor /
  // contractor) or 'client' (team client) and a `teamRole` field. That keeps
  // one store and one set of readers while letting the UI tell a code holder
  // apart from a member (a member holds no code and must never be treated as
  // one for export or credential headers).
  function teamScope() {
    const es = C.getEScope();
    return es && es.teamRole && es.teamRole !== 'client' ? es : null;
  }
  const ROLE_SUMMARY = {
    manager:
      'You are a Manager on this project. You can edit everything except billing and owner settings.',
    supervisor:
      'You are a Supervisor on this project. You can edit Tasks, Resources, Risks and Meetings. Everything else is view only.',
    contractor:
      'You are a Contractor on this project. You can edit Tasks. Everything else is view only.',
    client:
      'You are a Client on this project. You can read the sections the owner shared with you. Saving is turned off.'
  };
  const ROLE_TEXT = {
    manager: 'Manager',
    supervisor: 'Supervisor',
    contractor: 'Contractor',
    client: 'Client'
  };

  // Any named member, including a client. teamScope() below deliberately
  // excludes clients because it answers "what may I WRITE"; this one answers
  // "am I a member at all", which is what the banner needs.
  function teamMember() {
    const es = C.getEScope();
    return es && es.teamRole ? es : null;
  }

  function isWritableSection(key) {
    const sections = C._getSections();
    if (sections) {
      for (let i = 0; i < sections.length; i++) {
        if (sections[i].key === key) {
          return true;
        }
      }
      return false;
    }
    return VIEW_ONLY_PANELS.indexOf(key) === -1;
  }

  function isSectionBlocked(section) {
    const team = teamScope();
    if (team) {
      return isWritableSection(section) && team.sections.indexOf(section) === -1;
    }
    const scope = C.getEScope();
    const isEditor = !!C.getECode() && !C.getCode();
    if (!isEditor || !scope) {
      return false;
    }
    return isWritableSection(section) && scope.sections.indexOf(section) === -1;
  }

  function applyTeamBanner() {
    const member = teamMember();
    const banner = $('team-scope-banner');
    if (!banner) {
      return;
    }
    banner.classList.toggle('is-hide', !member);
    if (!member) {
      return;
    }
    const txt = $('team-scope-text');
    if (txt) {
      const role = ROLE_TEXT[member.teamRole] || 'Member';
      txt.textContent =
        ROLE_SUMMARY[member.teamRole] ||
        'You are a ' + role + ' on this project. Only the sections the owner shared are editable.';
    }
  }

  function applyEditorScope() {
    const scope = C.getEScope();
    const team = teamScope();
    const isEditor = !!C.getECode() && !C.getCode();
    document.body.classList.toggle('editor-scope', (isEditor && !!scope) || !!team);
    document.body.classList.toggle('team-scope', !!team);
    const btns = document.querySelectorAll('.sec-btn[data-section]');
    for (let i = 0; i < btns.length; i++) {
      const sec = btns[i].getAttribute('data-section');
      const blocked = isSectionBlocked(sec);
      btns[i].classList.toggle('scope-blocked', blocked);
      if (blocked) {
        btns[i].setAttribute('disabled', 'disabled');
        btns[i].setAttribute('aria-disabled', 'true');
        btns[i].setAttribute(
          'title',
          team
            ? 'Outside your role on this project. Locked.'
            : 'Outside this editor code\u2019s scope. Locked.'
        );
      } else {
        btns[i].removeAttribute('disabled');
        btns[i].removeAttribute('aria-disabled');
        btns[i].removeAttribute('title');
      }
    }
    const banner = $('editor-scope-banner');
    if (banner) {
      banner.classList.toggle('is-hide', !(isEditor && !team));
    }
    applyTeamBanner();
  }

  // ---- C19 CLIENT SCOPE (owner D3: "navigation buttons for hidden
  // sections are removed") --------------------------------------------------
  // Clients see ONLY the granted sections. The editor grey-out would leak
  // the view-only panels to a client (VIEW_ONLY_PANELS are never blocked), so
  // clients HIDE the .sec-btn entirely (display:none via .client-hidden) and
  // showSection() redirects to the first granted section.
  function isClientSession() {
    const es = C.getEScope();
    if (!es || es.role !== 'client') {
      return false;
    }
    // A team client holds no code; the teamRole field is what proves the
    // session grant is a membership rather than a stale code slot.
    return !!C.getECode() || !!es.teamRole;
  }
  function isClientSectionHidden(section) {
    if (!isClientSession()) {
      return false;
    }
    const scope = C.getEScope();
    return !(scope && Array.isArray(scope.sections) && scope.sections.indexOf(section) > -1);
  }
  function applyClientScope() {
    const isClient = isClientSession();
    document.body.classList.toggle('client-scope', isClient);
    if (!isClient) {
      return;
    }
    const btns = document.querySelectorAll('.sec-btn[data-section]');
    for (let i = 0; i < btns.length; i++) {
      const sec = btns[i].getAttribute('data-section');
      const hidden = isClientSectionHidden(sec);
      btns[i].classList.toggle('client-hidden', hidden);
      if (hidden) {
        btns[i].setAttribute('aria-hidden', 'true');
        btns[i].removeAttribute('disabled'); // never a grey-out for clients
      } else {
        btns[i].removeAttribute('aria-hidden');
      }
    }
    // A named team client already has a banner that names their role and what
    // they may see. Stacking the generic client row on top of it repeats the
    // same message twice, so the generic row is reserved for CODE holders.
    const banner = $('client-scope-banner');
    if (banner) {
      const es = C.getEScope();
      banner.classList.toggle('is-hide', !!(es && es.teamRole));
    }
  }

  ns.CloudScope = {
    isWritableSection: isWritableSection,
    isSectionBlocked: isSectionBlocked,
    applyEditorScope: applyEditorScope,
    isClientSession: isClientSession,
    isClientSectionHidden: isClientSectionHidden,
    applyClientScope: applyClientScope
  };
})(MMGR);
window.MMGR = MMGR;
