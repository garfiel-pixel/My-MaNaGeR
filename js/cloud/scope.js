/* ============================================================
   My MaNaGeR , Cloud Editor Scope
   Grey-out panels an editor code cannot write.
   Extracted from mmgr-cloud.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const C = ns.Cloud;
  const $ = function(id) { return document.getElementById(id); };

  const VIEW_ONLY_PANELS = ['dash', 'def', 'kan', 'gantt', 'claim', 'digest', 'baselinen', 'wxlog'];

  function isWritableSection(key) {
    const sections = C._getSections();
    if (sections) {
      for (let i = 0; i < sections.length; i++) if (sections[i].key === key) return true;
      return false;
    }
    return VIEW_ONLY_PANELS.indexOf(key) === -1;
  }

  function isSectionBlocked(section) {
    const scope = C.getEScope();
    const isEditor = !!C.getECode() && !C.getCode();
    if (!isEditor || !scope) return false;
    return isWritableSection(section) && scope.sections.indexOf(section) === -1;
  }

  function applyEditorScope() {
    const scope = C.getEScope();
    const isEditor = !!C.getECode() && !C.getCode();
    document.body.classList.toggle('editor-scope', isEditor && !!scope);
    const btns = document.querySelectorAll('.sec-btn[data-section]');
    for (let i = 0; i < btns.length; i++) {
      const sec = btns[i].getAttribute('data-section');
      const blocked = isSectionBlocked(sec);
      btns[i].classList.toggle('scope-blocked', blocked);
      if (blocked) {
        btns[i].setAttribute('disabled', 'disabled');
        btns[i].setAttribute('aria-disabled', 'true');
        btns[i].setAttribute('title', 'Outside this editor code\u2019s scope. Locked.');
      } else {
        btns[i].removeAttribute('disabled');
        btns[i].removeAttribute('aria-disabled');
        btns[i].removeAttribute('title');
      }
    }
    const banner = $('editor-scope-banner');
    if (banner) banner.classList.toggle('is-hide', !isEditor);
  }

  // ---- C19 CLIENT SCOPE (owner D3: "navigation buttons for hidden
  // sections are removed") --------------------------------------------------
  // Clients see ONLY the granted sections. The editor grey-out would leak
  // the view-only panels to a client (VIEW_ONLY_PANELS are never blocked), so
  // clients HIDE the .sec-btn entirely (display:none via .client-hidden) and
  // showSection() redirects to the first granted section.
  function isClientSession() {
    return !!C.getECode() && !C.getCode() && C.isClientSession();
  }
  function isClientSectionHidden(section) {
    if (!isClientSession()) return false;
    const scope = C.getEScope();
    return !(scope && Array.isArray(scope.sections) && scope.sections.indexOf(section) > -1);
  }
  function applyClientScope() {
    const isClient = isClientSession();
    document.body.classList.toggle('client-scope', isClient);
    if (!isClient) return;
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
    const banner = $('client-scope-banner');
    if (banner) banner.classList.toggle('is-hide', false);
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
