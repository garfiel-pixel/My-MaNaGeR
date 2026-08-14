/* ============================================================
   My MaNaGeR — marketing-site chrome (Liquid Glass front door).
   Shared by index.html / about.html / features.html / contact.html /
   mymanager-field-guide.html (the guide's email sign-in sheet is driven by the
   same .signin-trigger wiring here):
   - mobile menu toggle (with Escape-to-close + focus management)
   - footer year
   - icon-sprite deploy guard (icons vanish silently if the css/
     folder is missing on the host — surface it loudly on HTTP(S))
   Every lookup is null-guarded — this file must never throw.
   ============================================================ */
(function(){
  'use strict';

  /* ---- mobile menu ---- */
  var toggle = document.getElementById('nav-toggle');
  var menu = document.getElementById('mobile-menu');

  function closeMenu(returnFocus){
    if (!menu) return;
    menu.classList.remove('open');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      if (returnFocus) toggle.focus();
    }
  }
  function openMenu(){
    if (!menu) return;
    menu.classList.add('open');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
    }
    var first = menu.querySelector('a');
    if (first) first.focus();
  }

  if (toggle && menu) {
    toggle.addEventListener('click', function(){
      if (menu.classList.contains('open')) { closeMenu(true); }
      else { openMenu(); }
    });
    menu.addEventListener('click', function(e){
      if (e.target.closest && e.target.closest('a')) closeMenu(true);
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') closeMenu(true);
    });
  }

  /* ---- footer year ---- */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---- slim edge scroll-spy (homepage only) ---- */
  var spyNav = document.querySelector('.scroll-spy');
  if (spyNav && 'IntersectionObserver' in window) {
    var spyLinks = Array.prototype.slice.call(spyNav.querySelectorAll('a'));
    var spyById = {};
    spyLinks.forEach(function(a){
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#') spyById[href.slice(1)] = a;
    });
    var spySections = Object.keys(spyById)
      .map(function(id){ return document.getElementById(id); })
      .filter(Boolean);
    function setSpy(id){
      spyLinks.forEach(function(a){
        var on = id !== null && a === spyById[id];
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }
    var lastId = spyLinks.length
      ? (spyLinks[spyLinks.length - 1].getAttribute('href') || '').slice(1)
      : null;
    function atPageBottom(){
      return (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 4);
    }
    /* Pick the section with the largest visible share, not just "the last one
       that intersected" — when several sections are in frame, the most visible
       one wins, so the active stick tracks what is actually on screen. */
    var spy = new IntersectionObserver(function(entries){
      var best = null, bestRatio = -1;
      entries.forEach(function(entry){
        if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
          bestRatio = entry.intersectionRatio;
          best = entry.target.id;
        }
      });
      /* Bottom of the page: a short final section can sit entirely above the
         observer band, so force the last spy link active instead of none. */
      if (!best && atPageBottom() && lastId) best = lastId;
      setSpy(best);
    }, { rootMargin: '-40% 0px -45% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
    spySections.forEach(function(el){ spy.observe(el); });
  }

  /* ---- icon-sprite deploy guard (HTTP(S) only; file:// stays quiet) ---- */
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    fetch('css/mmgr-icons.svg').then(function(r){
      if (!r.ok) console.warn('ICON SPRITE MISSING: css/mmgr-icons.svg returned ' + r.status + ' — upload the css/ folder (mmgr.css + mmgr-icons.svg) to the site root.');
    }).catch(function(){
      console.warn('ICON SPRITE MISSING: css/mmgr-icons.svg could not be fetched — upload the css/ folder to the site root.');
    });
  }

  /* ---- header email sign-in sheet (OWNER 2026-08-14: "at the side of the
         hamburger or where appropriate") ----
     The shared email+password form comes from js/mmgr-google-auth.js (the SAME
     worker endpoints + session cookie as app.html/admin.html — never a duplicate
     auth implementation). The sheet is driven here: toggle + Escape +
     click-outside, one-time form mount, session restore, and the signed-in /
     signed-out states rendered from the module's events. A page may mount any
     number of trigger buttons — every element with class .signin-trigger opens
     the single #signin-sheet (marketing headers keep #signin-btn; the field-guide
     has one in the sidebar and one beside the mobile hamburger). All lookups are
     null-guarded — pages without the markup are unaffected. */
  var GA = (window.MMGR && window.MMGR.GoogleAuth) ? window.MMGR.GoogleAuth : null;
  var signinBtns = Array.prototype.slice.call(document.querySelectorAll('.signin-trigger'));
  var signinSheet = document.getElementById('signin-sheet');

  function setSigninOpen(open){
    if (!signinSheet) return;
    signinSheet.hidden = !open;
    signinBtns.forEach(function(b){ b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    if (open) {
      var first = signinSheet.querySelector('input,button');
      if (first && first.focus) { try { first.focus(); } catch (e) { /* focus is a hint */ } }
    }
  }

  function renderSigninUser(user){
    if (!signinSheet) return;
    var form = signinSheet.querySelector('.email-auth');
    var userBox = document.getElementById('signin-user');
    if (!form || !userBox) return;
    var nm = document.getElementById('signin-user-name');
    var sub = document.getElementById('signin-user-sub');
    if (nm) nm.textContent = (user && (user.name || user.email)) || 'Signed in';
    if (sub) sub.textContent = (user && user.email) ? user.email : '';
    form.hidden = true;
    userBox.hidden = false;
  }

  function renderSigninSignedOut(){
    if (!signinSheet) return;
    var form = signinSheet.querySelector('.email-auth');
    var userBox = document.getElementById('signin-user');
    if (form) form.hidden = false;
    if (userBox) userBox.hidden = true;
  }

  if (signinBtns.length && signinSheet && GA) {
    var signinOut = document.getElementById('signin-out');
    if (signinOut) signinOut.addEventListener('click', function(){ GA.signOut(); });

    signinBtns.forEach(function(b){
      b.addEventListener('click', function(){
        setSigninOpen(signinSheet.hidden);
      });
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && !signinSheet.hidden) setSigninOpen(false);
    });
    document.addEventListener('click', function(e){
      if (signinSheet.hidden) return;
      var onTrigger = signinBtns.some(function(b){ return e.target === b || b.contains(e.target); });
      if (onTrigger) return;
      if (signinSheet.contains(e.target)) return;
      setSigninOpen(false);
    });

    /* One-time mount of the shared form inside the sheet (no Google button on
       the marketing pages, so the toggle is hidden and the form shown). Then
       restore the session so an already-signed-in visitor sees their state. */
    GA.mountEmailAuth('marketing-email-auth', { showToggle: false });
    document.addEventListener('mmgr:user-changed', function(e){ renderSigninUser(e.detail); });
    document.addEventListener('mmgr:google-signed-out', function(){ renderSigninSignedOut(); });
    GA.restoreSession();
  }
})();
