/* ============================================================
   My MaNaGeR — marketing-site chrome (Liquid Glass front door).
   Shared by index.html / about.html / features.html / contact.html:
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
    var spy = new IntersectionObserver(function(entries){
      var current = null;
      entries.forEach(function(entry){
        if (entry.isIntersecting) current = entry.target.id;
      });
      /* null when scrolled back above the first section — nothing active */
      setSpy(current);
    }, { rootMargin: '-30% 0px -50% 0px', threshold: 0 });
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
})();
