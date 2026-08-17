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

  /* OWNER 2026-08-17: the header triggers themselves become the signed-in
     identity — a small avatar (photo or initial) + name — instead of the
     static "Sign in" label that stayed put after signing in. Clicking the
     chip still opens the sheet (which holds the account row + Sign out).
     DOM APIs only — remote data can't inject. */
  function renderSigninTriggers(user){
    signinBtns.forEach(function(b){
      b.innerHTML = '';
      b.classList.add('is-signedin');
      b.setAttribute('aria-label', 'Signed in as ' + ((user && (user.name || user.email)) || 'operator'));
      var av = document.createElement('span');
      av.className = 'sb-avatar';
      if (user && user.picture) {
        var img = document.createElement('img');
        img.src = user.picture;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        av.appendChild(img);
      } else {
        av.textContent = (user && (user.name || user.email)) ? String(user.name || user.email).charAt(0).toUpperCase() : '?';
      }
      var nm = document.createElement('span');
      nm.className = 'sb-name';
      nm.textContent = (user && (user.name || user.email)) || 'Signed in';
      b.appendChild(av);
      b.appendChild(nm);
    });
  }
  function renderSigninSignedOutTriggers(){
    signinBtns.forEach(function(b){
      b.classList.remove('is-signedin');
      b.removeAttribute('aria-label');
      b.textContent = 'Sign in';
    });
  }

  function renderSigninUser(user){
    if (!signinSheet) return;
    var form = signinSheet.querySelector('.email-auth');
    var userBox = document.getElementById('signin-user');
    if (!form || !userBox) return;
    renderSigninTriggers(user);
    var nm = document.getElementById('signin-user-name');
    var sub = document.getElementById('signin-user-sub');
    var av = document.getElementById('signin-user-avatar');
    /* STABILIZATION 2026-08-16: the identity now leads with the profile
       picture — Google photo when available, otherwise the first letter of
       the name (the app.html avatar pattern). Written via DOM APIs so
       remote data can't inject. */
    if (av) {
      av.innerHTML = '';
      if (user && user.picture) {
        var img = document.createElement('img');
        img.src = user.picture;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        av.appendChild(img);
      } else {
        var initial = user ? (user.name || user.email || '?').charAt(0).toUpperCase() : '?';
        av.textContent = initial;
      }
    }
    if (nm) nm.textContent = (user && (user.name || user.email)) || 'Signed in';
    if (sub) sub.textContent = (user && user.email) ? user.email : '';
    form.hidden = true;
    userBox.hidden = false;
  }

  function renderSigninSignedOut(){
    if (!signinSheet) return;
    var form = signinSheet.querySelector('.email-auth');
    var userBox = document.getElementById('signin-user');
    var av = document.getElementById('signin-user-avatar');
    if (form) form.hidden = false;
    if (userBox) userBox.hidden = true;
    if (av) { av.innerHTML = ''; av.textContent = ''; }
    renderSigninSignedOutTriggers();
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
    /* AUTH MAINFRAME 2026-08-17: the signed-in account row carries the
       Change-password entry for email accounts (mounted once here; the
       shared control hides itself unless the account has a password). */
    GA.mountPasswordControl(document.getElementById('signin-user'));
    document.addEventListener('mmgr:user-changed', function(e){ renderSigninUser(e.detail); });
    document.addEventListener('mmgr:google-signed-out', function(){ renderSigninSignedOut(); });
    GA.restoreSession();
  }

  /* ---- SECTION-INDEX DROPDOWNS (OWNER 2026-08-17: hover a nav item to see
         the sections it contains; click one to jump there + highlight) ----
     Built from a manifest keyed by each .site-nav link's href, so the same
     code drives every marketing page. Clicking an item whose target exists
     on the CURRENT page scrolls to it (smooth) and flashes a gold ring;
     a target on another page navigates, and the on-load hash handler
     flashes it on arrival. Menus open on hover/focus (CSS), close on Escape
     or focus-out, and every lookup is null-guarded — never throws. */
  var NAV_DD = {
    'index.html#features': {
      items: [
        { id: 'f-wbs', label: 'WBS + Gantt' },
        { id: 'f-kanban', label: 'Kanban Board' },
        { id: 'f-raci', label: 'RACI Matrix' },
        { id: 'f-risk', label: 'Risk + Monte Carlo' },
        { id: 'f-budget', label: 'Budget / EVM' },
        { id: 'f-ai', label: 'Built-In AI' },
        { id: 'f-voice', label: 'Voice to Notes & Claims' },
        { id: 'f-weather', label: 'Weather-Aware' },
        { id: 'f-offline', label: 'Offline-First' }
      ],
      foot: { href: 'features.html', label: 'See every feature in detail' }
    },
    'mymanager-field-guide.html': {
      items: [
        { id: 'welcome', label: 'A-00 Welcome & Orientation' },
        { id: 'quickstart', label: 'A-01 Your First 15 Minutes' },
        { id: 'dashboard', label: 'A-02 Dashboard & Health Score' },
        { id: 'charter', label: 'A-03 Charter & Definitions' },
        { id: 'wbs', label: 'A-04 WBS, Gantt & Critical Path' },
        { id: 'kanban', label: 'A-05 Kanban & RACI' },
        { id: 'resources', label: 'A-06 Resources & Budget' },
        { id: 'risk', label: 'A-07 Risk, Issues & Simulation' },
        { id: 'records', label: 'A-08 Stakeholders, Changes & Closure' },
        { id: 'meetings', label: 'A-09 Meetings & Agenda Templates' },
        { id: 'voice', label: 'A-10 Voice Capture & Field Reports' },
        { id: 'claim', label: 'A-11 Claim Pack & Voice-to-Claim' },
        { id: 'comms', label: 'A-12 Comms Log & Documents' },
        { id: 'ai', label: 'A-13 AI Assistant' },
        { id: 'dmaic', label: 'A-14 DMAIC (Six Sigma Mode)' },
        { id: 'data', label: 'A-15 Data, Backup & Access' },
        { id: 'weather', label: 'A-16 Weather & Forecast' },
        { id: 'interface', label: 'A-17 Interface & Shortcuts' },
        { id: 'trouble', label: 'A-18 When Something Looks Off' },
        { id: 'faq', label: 'A-19 Frequently Asked' },
        { id: 'projects-admin', label: 'A-20 Projects, Admin & Create Your Own' },
        { id: 'bids-compliance', label: 'A-21 Bids, Compliance & Go/No-Go' },
        { id: 'rfi-field-metrics', label: 'A-22 RFIs, Submittals & Field Metrics' },
        { id: 'registers-compliance', label: 'A-23 Registers, Compliance & Handover' },
        { id: 'reviews-window', label: 'A-24 Public Reviews Window' }
      ]
    },
    'about.html': {
      items: [
        { id: 'about-what', label: 'What it is' },
        { id: 'about-why', label: 'Why it exists' },
        { id: 'about-values', label: 'What matters to us' }
      ]
    },
    'contact.html': {
      items: [
        { id: 'ct-email', label: 'Email' },
        { id: 'ct-phone', label: 'Phone' },
        { id: 'ct-access', label: 'Project access' },
        { id: 'ct-learn', label: 'Learn the app' },
        { id: 'ct-feedback', label: 'Feedback' }
      ]
    },
    'reviews.html': {
      items: [
        { id: 'rv-leave', label: 'Leave a review' },
        { id: 'rv-field', label: 'From the field' }
      ]
    }
  };

  var ddFlashTimer = null;
  function ddFlash(id){
    var el = document.getElementById(id);
    if (!el) return;
    try {
      var rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
      el.scrollIntoView({ behavior: (rm && rm.matches) ? 'auto' : 'smooth', block: 'start' });
    } catch (e) { el.scrollIntoView(); }
    el.classList.remove('dd-flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('dd-flash');
    if (ddFlashTimer) clearTimeout(ddFlashTimer);
    ddFlashTimer = setTimeout(function(){ el.classList.remove('dd-flash'); }, 2800);
  }

  function wireNavDropdowns(){
    var links = document.querySelectorAll('.site-nav a.nav-link');
    var known = {};
    Object.keys(NAV_DD).forEach(function(k){
      NAV_DD[k].items.forEach(function(it){ known[it.id] = true; });
    });
    if (links.length) {
      Array.prototype.forEach.call(links, function(a){
        if (a.closest('.nav-dd')) return; // idempotent — never re-wrap
        var cfg = NAV_DD[a.getAttribute('href')];
        if (!cfg) return;
        var wrap = document.createElement('span');
        wrap.className = 'nav-dd' + (cfg.items.length > 8 ? ' nav-dd-cols' : '') + (cfg.items.length > 12 ? ' nav-dd-tall' : '');
        var menu = document.createElement('span');
        menu.className = 'nav-dd-menu';
        menu.setAttribute('aria-label', String(a.textContent || '').trim() + ' sections');
        var list = document.createElement('span');
        list.className = 'nav-dd-list';
        var page = (a.getAttribute('href') || '#').split('#')[0];
        cfg.items.forEach(function(it){
          var itA = document.createElement('a');
          itA.href = page + '#' + it.id;
          itA.className = 'nav-dd-item';
          itA.textContent = it.label;
          itA.addEventListener('click', function(ev){
            if (document.getElementById(it.id)) {
              ev.preventDefault();
              ddFlash(it.id);
              try { history.replaceState(null, '', '#' + it.id); } catch (e) { /* hash update is a hint */ }
            }
          });
          list.appendChild(itA);
        });
        menu.appendChild(list);
        if (cfg.foot) {
          var footA = document.createElement('a');
          footA.href = cfg.foot.href;
          footA.className = 'nav-dd-foot';
          footA.textContent = cfg.foot.label;
          menu.appendChild(footA);
        }
        a.setAttribute('aria-haspopup', 'true');
        a.setAttribute('aria-expanded', 'false');
        // Swap the link for the wrapper FIRST (the link is still a child of
        // its parent at that moment), then move the link + menu INTO the
        // wrapper. The reverse order is a trap: wrap.appendChild(a) removes
        // the link from its parent, so a later parent.replaceChild(wrap, a)
        // throws "node to be replaced is not a child" — the link ends up in a
        // detached wrapper and the loop aborts.
        var parent = a.parentNode;
        parent.replaceChild(wrap, a);
        wrap.appendChild(a);
        wrap.appendChild(menu);
        // aria-expanded tracks the hover/focus open state.
        var open = false;
        function sync(){ a.setAttribute('aria-expanded', open ? 'true' : 'false'); }
        wrap.addEventListener('mouseenter', function(){ open = true; sync(); });
        wrap.addEventListener('mouseleave', function(){ open = false; sync(); });
        wrap.addEventListener('focusin', function(){ open = true; sync(); });
        wrap.addEventListener('focusout', function(e){
          if (!wrap.contains(e.relatedTarget)) { open = false; sync(); }
        });
      });
    }
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') {
        document.querySelectorAll('.nav-dd').forEach(function(w){
          var a = w.querySelector('a.nav-link');
          if (a && a.getAttribute('aria-expanded') === 'true') {
            a.focus();
            a.setAttribute('aria-expanded', 'false');
          }
        });
      }
    });
    // Cross-page deep link: an arriving hash that names a known section
    // target scrolls to it and flashes on arrival (the dropdown item was
    // the navigator). Runs even on pages without .site-nav (the field
    // guide) so a dropdown click there lands with the same highlight.
    if (location.hash) {
      var t = decodeURIComponent(location.hash.slice(1));
      if (known[t] && document.getElementById(t)) {
        setTimeout(function(){ ddFlash(t); }, 120);
      }
    }
  }
  wireNavDropdowns();

  /* ---- REVEAL-ON-SCROLL (owner 2026-08-16) ----
     Feature cards / steps / audience items / section heads fade and rise into
     view as they enter the viewport. Progressive enhancement: .rv is added by
     JS only, so a static no-JS page sees everything fully visible; reduced-
     motion and no-IntersectionObserver users get the same instant visibility.
     Elements unobserve themselves once revealed. Never throws. */
  var rvTargets = Array.prototype.slice.call(document.querySelectorAll(
    '.fcard, .aud-item, .step, .section-head, .guide-band, .pb-content, .hero-inner'
  ));
  if (rvTargets.length) {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!(reduceMotion && reduceMotion.matches) && 'IntersectionObserver' in window) {
      rvTargets.forEach(function(el, i){
        el.classList.add('rv');
        el.style.setProperty('--rv-i', String(i > 8 ? 8 : i));
      });
      var rvIO = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if (en.isIntersecting) {
            en.target.classList.add('rv-in');
            rvIO.unobserve(en.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      rvTargets.forEach(function(el){ rvIO.observe(el); });
    } else {
      // reduced-motion or no IO: everything visible immediately (CSS also
      // forces .rv to full visibility under reduced motion — belt + braces).
      rvTargets.forEach(function(el){ el.classList.add('rv-in'); });
    }
  }
})();
