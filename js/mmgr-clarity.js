/*
 * js/mmgr-clarity.js - Microsoft Clarity session analytics, consent-gated.
 *
 * WHY A LOADER INSTEAD OF THE STOCK SNIPPET
 * The snippet Microsoft hands you is an inline <script>. This site's
 * Content-Security-Policy is hash-only for inline script (no 'unsafe-inline'),
 * so pasting it would either be blocked outright or force a policy relaxation
 * on every page. A same-origin deferred file keeps the hash gate intact and,
 * more importantly, lets the tag be WITHHELD until the visitor says yes - so
 * the pre-consent request count stays at zero, the same GATE S-2 contract that
 * already gates Cloudflare Web Analytics.
 *
 * THE QUEUE STUB IS NOT OPTIONAL (measured 2026-11-24)
 * The stock snippet creates window.clarity as a queue function BEFORE it
 * appends the tag. The tag's first line is `a[c].v || ...`, so without that
 * stub it throws "Cannot read properties of undefined (reading 'v')", never
 * loads clarity.js, and records nothing - a silent total failure that looks
 * exactly like working analytics in the network tab (the tag file itself is
 * fetched). qa-consent B7c now asserts the stub exists, so this cannot
 * regress unnoticed again.
 *
 * CONSENT PROTOCOL (Microsoft's documented V1 API)
 *   window.clarity('consent')        -> the visitor accepted; set cookies
 *   window.clarity('consent', false) -> erase Clarity cookies, stop tracking
 * The calls queue through the stub, so granting before the tag finishes
 * loading is safe - the real implementation drains the queue on start.
 *
 * The project id is public by design: it is the tag id in every page source.
 */
(function (ns) {
  'use strict';

  var PROJECT_ID = 'zimybl2f3q';
  var TAG_SRC = 'https://www.clarity.ms/tag/' + PROJECT_ID;
  var MARK = 'data-mmgr-clarity';
  var loaded = false;

  function tag() {
    return document.querySelector('script[' + MARK + ']');
  }

  // The vendor's own stub, reproduced exactly: a function that pushes its
  // arguments onto window.clarity.q. Defining it when the tag is injected is
  // what makes the tag run at all, and it also lets 'consent' calls made
  // before the real script arrives be replayed instead of lost.
  function stub() {
    if (typeof window.clarity !== 'function') {
      window.clarity = function () {
        (window.clarity.q = window.clarity.q || []).push(arguments);
      };
    }
    if (!window.clarity.q) {
      window.clarity.q = [];
    }
  }

  function grant() {
    if (typeof window.clarity === 'function') {
      window.clarity('consent');
    }
  }

  function revoke() {
    // Loaded but the visitor has now chosen "Necessary only": erase the
    // Clarity cookies and stop further collection. The script cannot be
    // unloaded, so this call is the actual gate.
    if (typeof window.clarity === 'function') {
      window.clarity('consent', false);
    }
  }

  function inject() {
    stub();
    if (loaded || tag()) {
      grant();
      return;
    }
    var s = document.createElement('script');
    s.async = true;
    s.src = TAG_SRC;
    s.setAttribute(MARK, '1');
    s.addEventListener('load', function () {
      loaded = true;
      grant();
    });
    document.head.appendChild(s);
  }

  function apply() {
    var C = ns.Consent;
    if (!C || typeof C.allows !== 'function') {
      return;
    }
    if (C.allows('analytics')) {
      inject();
    } else {
      revoke();
    }
  }

  // consent.js fires this on every save, so accepting the banner starts the
  // tag immediately instead of waiting for the next page view.
  document.addEventListener('mmgr:consent', apply);
  apply();
})((window.MMGR = window.MMGR || {}));
