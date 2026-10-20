/*
 * js/consent.js - S-2 / M-1 cookie and storage consent (audit 2026-10-18, 8.2).
 *
 * What this file owns:
 *   - the choice itself: localStorage `mmgr_consent` = {v, iv, analytics, ts}
 *   - the server-readable mirror: cookie `mmgr_consent_a` (value 1, only set
 *     when analytics is allowed) so the Worker's Content-Security-Policy can
 *     allow or block the analytics script per response
 *   - the banner (three equal buttons, no dark pattern) and its "Choose" panel
 *   - MMGR.Consent.allows(category) for other code to ask before doing
 *     anything optional
 *
 * WHY THE CSP GATES THE ANALYTICS SCRIPT INSTEAD OF THIS FILE INJECTING IT:
 * the directive's design assumed we control the analytics tag. We do not:
 * Cloudflare's zone auto-injects the Web Analytics beacon into the <body> of
 * every browser navigation at the edge, AFTER the Worker's response is built
 * (verified live 2026-10-20: curl without browser headers sees no beacon, a
 * real browser sees it appended before </body>). No API or Worker response
 * can switch that off (the toggle is dashboard-only, Speed > Web Analytics >
 * Manage site > Disable auto injection). So the enforcement point we DO own
 * is the CSP header: worker.js includes static.cloudflareinsights.com in
 * script-src ONLY when this file has set the mmgr_consent_a cookie. Without
 * consent the browser refuses the injected script before fetching it - zero
 * requests, which is exactly the S-2 gate. If the owner later disables
 * auto-injection in the dashboard, this mechanism stays correct and simply
 * gates nothing (no tag is injected at all).
 *
 * No inline script anywhere: this file is loaded with a plain script tag
 * (public pages) or through the project bundle (app pages), so the CSP
 * inline-script hash set never changes.
 */
(function (ns) {
  'use strict';

  var KEY = 'mmgr_consent'; // localStorage - the choice of record
  var COOKIE = 'mmgr_consent_a'; // cookie - server-readable mirror for the CSP
  var INVENTORY_VERSION = 1; // bump when docs/STORAGE-INVENTORY.md changes a category
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // re-ask every 12 months
  var CARD_ID = 'consent-card';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) {
        return null;
      }
      var c = JSON.parse(raw);
      if (!c || c.v !== 1) {
        return null;
      }
      return c;
    } catch (e) {
      return null;
    }
  }

  // A choice counts only while it is fresh: same inventory version and
  // younger than 12 months. Anything else means "ask again".
  function isFresh(c) {
    if (!c || typeof c.iv !== 'number' || c.iv !== INVENTORY_VERSION) {
      return false;
    }
    if (!c.ts) {
      return false;
    }
    var t = Date.parse(c.ts);
    if (!t || Date.now() - t >= MAX_AGE_MS) {
      return false;
    }
    return true;
  }

  function writeCookieMirror(analytics) {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    if (analytics) {
      document.cookie =
        COOKIE + '=1; path=/; max-age=' + Math.floor(MAX_AGE_MS / 1000) + '; SameSite=Lax' + secure;
    } else {
      document.cookie = COOKIE + '=; path=/; max-age=0; SameSite=Lax' + secure;
    }
  }

  function allows(category) {
    var c = read();
    if (!isFresh(c)) {
      return false;
    }
    // Analytics is the only optional category today (see the inventory).
    return category === 'analytics' ? !!c.analytics : false;
  }

  function currentAnalytics() {
    return allows('analytics');
  }

  function save(analytics) {
    var c = {
      v: 1,
      iv: INVENTORY_VERSION,
      analytics: !!analytics,
      ts: new Date().toISOString()
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch (e) {
      /* private mode: the banner still works for this page view */
    }
    writeCookieMirror(!!analytics);
    hide();
  }

  function card() {
    return document.getElementById(CARD_ID);
  }

  function hide() {
    var el = card();
    if (el) {
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function showChoose() {
    var el = card();
    if (!el) {
      return;
    }
    var panel = el.querySelector('.consent-choose');
    var actions = el.querySelector('.consent-actions');
    if (panel) {
      panel.hidden = false;
    }
    if (actions) {
      actions.hidden = true;
    }
    var box = el.querySelector('#consent-analytics');
    if (box) {
      box.checked = currentAnalytics();
      box.focus();
    }
  }

  function showMain() {
    var el = card();
    if (!el) {
      return;
    }
    var panel = el.querySelector('.consent-choose');
    var actions = el.querySelector('.consent-actions');
    if (panel) {
      panel.hidden = true;
    }
    if (actions) {
      actions.hidden = false;
    }
  }

  function open() {
    var el = card();
    if (!el) {
      return;
    }
    el.hidden = false;
    el.removeAttribute('aria-hidden');
    showMain();
    // Reopening from the footer is a deliberate act: put the keyboard on
    // the first choice so Tab order starts where the eye lands.
    var first = el.querySelector('.consent-actions button');
    if (first && document.activeElement === document.body) {
      first.focus();
    }
  }

  function build() {
    if (document.getElementById(CARD_ID)) {
      return;
    }
    var el = document.createElement('div');
    el.id = CARD_ID;
    el.className = 'consent-card';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Cookie choices');
    el.innerHTML =
      '<div class="consent-body">' +
      '<p class="consent-title">Cookies on this site</p>' +
      '<p class="consent-text">A few cookies keep you signed in and remember your work on this ' +
      'device. With your permission we also count visits, to see which pages get used. ' +
      'Nothing is used for advertising.</p>' +
      '</div>' +
      '<div class="consent-actions">' +
      '<button type="button" class="consent-btn" data-consent="all">Accept all</button>' +
      '<button type="button" class="consent-btn" data-consent="necessary">Necessary only</button>' +
      '<button type="button" class="consent-btn" data-consent="choose">Choose</button>' +
      '</div>' +
      '<div class="consent-choose" hidden>' +
      '<div class="consent-opt">' +
      '<input type="checkbox" id="consent-analytics" class="consent-check">' +
      '<label for="consent-analytics">Usage statistics</label>' +
      '<p class="consent-opt-note">Counts visits and page views. No personal profiles.</p>' +
      '</div>' +
      '<div class="consent-actions">' +
      '<button type="button" class="consent-btn" data-consent="save">Save choices</button>' +
      '<button type="button" class="consent-btn" data-consent="back">Back</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(el);
    // Starts hidden: a visitor with a valid choice never sees it, and the
    // stale-choice path below calls open() explicitly.
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) {
      return;
    }
    var opener = t.closest('[data-consent-open]');
    if (opener) {
      e.preventDefault();
      open();
      return;
    }
    var btn = t.closest('[data-consent]');
    if (!btn || !card() || card().hidden) {
      return;
    }
    var choice = btn.getAttribute('data-consent');
    if (choice === 'all') {
      save(true);
    } else if (choice === 'necessary') {
      save(false);
    } else if (choice === 'choose') {
      showChoose();
    } else if (choice === 'back') {
      showMain();
    } else if (choice === 'save') {
      var box = card().querySelector('#consent-analytics');
      save(!!(box && box.checked));
    }
  }

  // The signed-in app carries the choice as a Settings > Privacy toggle
  // instead of a banner (audit 8.2 item 7). The toggle is static markup, so
  // it must be told what the device actually chose - otherwise it ships
  // "off" and misreports a device that already accepted.
  function syncInputs() {
    var boxes = document.querySelectorAll('input[data-action="tglConsentStat"]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = currentAnalytics();
    }
  }

  function init() {
    if (!document.body) {
      return;
    }
    // Every page syncs its own toggle; only the public pages show a banner.
    syncInputs();
    // Public pages opt in with data-consent-banner="on" on <body>. The
    // signed-in app never shows the banner (audit 8.2 item 7): its choice
    // surface is Settings, Privacy.
    if (document.body.getAttribute('data-consent-banner') !== 'on') {
      return;
    }
    build();
    var stale = read();
    if (!isFresh(stale)) {
      // Nothing valid is remembered: the analytics script stays blocked
      // (mirror cleared so the server policy matches) and the banner asks.
      writeCookieMirror(false);
      open();
    }
    document.addEventListener('click', onClick);
  }

  ns.Consent = {
    allows: allows,
    currentAnalytics: currentAnalytics,
    open: open,
    save: save,
    read: read,
    syncInputs: syncInputs,
    INVENTORY_VERSION: INVENTORY_VERSION
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})((window.MMGR = window.MMGR || {}));
