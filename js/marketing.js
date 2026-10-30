/* ============================================================
   My MaNaGeR , marketing-site chrome (Liquid Glass front door).
   Shared by index.html / about.html / features.html / contact.html /
   mymanager-field-guide.html (the guide's email sign-in sheet is driven by the
   same .signin-trigger wiring here):
   - mobile menu toggle (with Escape-to-close + focus management)
   - footer year
   - icon-sprite deploy guard (icons vanish silently if the css/
     folder is missing on the host , surface it loudly on HTTP(S))
   Every lookup is null-guarded , this file must never throw.
   ============================================================ */
(function () {
  'use strict';

  /* ---- decorative images are inert (OWNER 2026-08-17) ----
     Edge/Chromium lets a user drag a page <img> out of the layout and drop
     it into the search bar. The hero photo, showcase-card images and
     photo-band photos are surface layers, not draggable objects: the markup
     carries draggable="false", the CSS blocks -webkit-user-drag + selection
     + pointer events, and this guard blocks the native dragstart and the
     right-click image menu on them. Null-guarded , never throws. */
  /* ---- S-5 escaper (AUDIT-DIRECTIVE-2026-10-18) ----
     Every value that reaches an innerHTML string on a marketing page goes
     through here. Same four replacements the sign-in button used inline. */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var NO_DRAG_IMGS = '.hero-photo, .hc-img img, .pb-img';
  function lockDecorativeImages() {
    var imgs = document.querySelectorAll(NO_DRAG_IMGS);
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        img.setAttribute('draggable', 'false');
        img.addEventListener('dragstart', function (e) {
          e.preventDefault();
        });
        img.addEventListener('contextmenu', function (e) {
          e.preventDefault();
        });
      })(imgs[i]);
    }
  }
  lockDecorativeImages();

  /* ---- mobile menu ---- */
  var toggle = document.getElementById('nav-toggle');
  var menu = document.getElementById('mobile-menu');

  function closeMenu(returnFocus) {
    if (!menu) {
      return;
    }
    menu.classList.remove('open');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      if (returnFocus) {
        toggle.focus();
      }
    }
  }
  function openMenu() {
    if (!menu) {
      return;
    }
    menu.classList.add('open');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
    }
    var first = menu.querySelector('a');
    if (first) {
      first.focus();
    }
  }

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      if (menu.classList.contains('open')) {
        closeMenu(true);
      } else {
        openMenu();
      }
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) {
        closeMenu(true);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenu(true);
      }
    });
  }

  /* ---- footer year ---- */
  var year = document.getElementById('year');
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  /* ---- PERF-1 (REFINEMENT-DIRECTIVE-2026-10-24): the motion switch ----
     U-10 (owner 2026-10-30): this control is now THE WCAG 2.2.2 mechanism,
     not a nice-to-have. The globe's own Pause button was removed because a
     control per widget is not what the criterion asks for - a page-wide one
     is. The label says what it does in plain words. ----
     Performance Mode has to be reachable from any page, and the footer is the
     one band every marketing page shares. The switch is the same control the app
     offers (same storage key, same [data-action="tglPerfMode"], wired by
     js/mmgr-perf.js's delegated change listener), so turning it on here follows
     the visitor into the app and back. Injected rather than repeated in nine
     footers: one piece of markup cannot drift out of sync with the other eight. */
  (function mountPerfSwitch() {
    var foot = document.querySelector('.site-footer .footer-bottom');
    if (!foot || foot.querySelector('.ft-perf')) {
      return;
    }
    var box = document.createElement('span');
    box.className = 'ft-perf';
    box.innerHTML =
      '<label class="ft-perf-box">' +
      '<input type="checkbox" class="ft-perf-in" data-action="tglPerfMode" ' +
      'aria-label="Pause animations: stops the globe and other motion on this page">' +
      '<span class="ft-perf-track" aria-hidden="true"></span>' +
      '<span class="ft-perf-text">Pause animations</span>' +
      '</label>';
    foot.appendChild(box);
    try {
      if (window.MMGR && window.MMGR.Perf && window.MMGR.Perf.syncInputs) {
        window.MMGR.Perf.syncInputs();
      } else {
        // No module on this page (a marketing page that never loaded one):
        // read the stored choice directly so the switch never lies.
        var on = false;
        try {
          on = localStorage.getItem('mmgr_perf_mode') === 'on';
        } catch (e) {}
        box.querySelector('input').checked = on;
      }
    } catch (e) {
      /* a footer control must never block the page */
    }
  })();

  /* ---- E2 universal back-navigation (owner 2026-09-29) ----
     Every [data-back] control returns the visitor to where they came from:
     history.back() when the referrer is a same-origin page (came from the
     site), the href fallback (index.html / app.html) when this page is the
     entry point (search, bookmark, shared link, PWA icon). Delegated on
     document so any page element can carry data-back; CSP-safe (no inline
     handlers); null-guarded, never throws. Referrer is normalized because
     Chrome caps it at origin-level for cross-page navigations - the origin
     match is the reliable same-site signal. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-back]') : null;
    if (!el) {
      return;
    }
    e.preventDefault();
    var ref = '';
    try {
      ref = document.referrer || '';
    } catch (err) {
      ref = '';
    }
    var sameOrigin = false;
    if (ref) {
      try {
        sameOrigin = new URL(ref).origin === window.location.origin;
      } catch (err) {
        sameOrigin = false;
      }
    }
    if (sameOrigin && window.history.length > 1) {
      window.history.back();
    } else {
      var href = el.getAttribute('href');
      if (href) {
        window.location.href = href;
      }
    }
  });

  /* ---- dot rail ----
     Big dot = major topic (the <a> links in index.html). Small dots = minor topics:
     MINORS_PER_GAP of them are generated between every pair of big dots and stand at
     equal thirds of the section above them. ONE dot is active, chosen by where the
     reading line (38% down the window) sits in page order. No labels, no tooltips. */
  var dotNav = document.querySelector('.dot-rail-navigation');
  if (dotNav) {
    var MINORS_PER_GAP = 2;
    var dotMajors = Array.prototype.slice.call(dotNav.querySelectorAll('a.dot-item.major'));
    var dotList = dotNav.querySelector('.dot-list');
    var dotStops = []; /* {dot, sec, frac} in page order */

    /* LAND-1 (REFINEMENT-DIRECTIVE-2026-10-24): the hover label is read from
       the section's own heading, so the rail can never drift out of sync with
       the page. The hero's h1 is a sentence, not a label, so an h2 wins first
       and the link's existing aria-label is the fallback. */
    function dotLabel(sec, fallback) {
      var h = sec.querySelector('h2');
      var t = h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : '';
      return t || fallback || '';
    }

    dotMajors.forEach(function (a, i) {
      var sec = document.getElementById((a.getAttribute('href') || '').slice(1));
      if (!sec) {
        return;
      }
      var label = dotLabel(sec, a.getAttribute('aria-label'));
      if (label) {
        a.setAttribute('data-label', label);
      }
      dotStops.push({ dot: a, sec: sec, frac: 0 });
      if (i === dotMajors.length - 1) {
        return;
      } /* nothing under the last big dot */
      for (var k = 1; k <= MINORS_PER_GAP; k++) {
        var li = document.createElement('li');
        li.setAttribute('aria-hidden', 'true');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'dot-item minor';
        b.tabIndex = -1;
        b.innerHTML = '<span class="dot"></span>';
        li.appendChild(b);
        a.parentElement.parentNode.insertBefore(li, dotMajors[i + 1].parentElement);
        dotStops.push({ dot: b, sec: sec, frac: k / (MINORS_PER_GAP + 1) });
      }
    });

    function dotStopY(s) {
      var r = s.sec.getBoundingClientRect();
      return r.top + window.scrollY + r.height * s.frac;
    }
    function dotReadLine() {
      return window.innerHeight * 0.38;
    }
    /* The stop positions are measured ONCE and cached. Reading 19 element rects
       on every scroll frame forced a layout each frame for a value that only
       changes when the page or the window is resized, which is what made
       scrolling past the rail feel heavy. The cache key covers both the page
       height (images landing, sections growing) and the window height (the read
       line is a fraction of it). */
    var dotYs = [];
    var dotYsKey = '';
    function dotStopsYs() {
      var key = document.documentElement.scrollHeight + 'x' + window.innerHeight;
      if (dotYs.length && key === dotYsKey) {
        return dotYs;
      }
      dotYsKey = key;
      dotYs = dotStops.map(dotStopY);
      return dotYs;
    }
    function syncDots() {
      if (!dotStops.length) {
        return;
      }
      var ys = dotStopsYs();
      var line = window.scrollY + dotReadLine();
      var cur = 0;
      for (var i = 0; i < dotStops.length; i++) {
        if (ys[i] <= line) {
          cur = i;
        } else {
          break;
        }
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        cur = dotStops.length - 1;
      }
      dotStops.forEach(function (s, i) {
        var on = i === cur;
        s.dot.classList.toggle('active', on);
        if (on) {
          s.dot.setAttribute('aria-current', 'true');
        } else {
          s.dot.removeAttribute('aria-current');
        }
      });
    }
    dotStops.forEach(function (s) {
      if (s.frac === 0) {
        return;
      } /* big dots are real links */
      s.dot.addEventListener('click', function () {
        var reduce =
          window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({
          top: dotStopY(s) - dotReadLine() + 2,
          behavior: reduce ? 'auto' : 'smooth'
        });
      });
    });
    var dotRaf = 0;
    function queueSyncDots() {
      if (dotRaf) {
        return;
      }
      dotRaf = window.requestAnimationFrame(function () {
        dotRaf = 0;
        syncDots();
      });
    }
    window.addEventListener('scroll', queueSyncDots, { passive: true });
    window.addEventListener('resize', queueSyncDots);
    window.addEventListener('load', queueSyncDots);
    syncDots();
  }

  /* ---- icon-sprite deploy guard (HTTP(S) only; file:// stays quiet) ---- */
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    fetch('css/mmgr-icons.svg')
      .then(function (r) {
        if (!r.ok) {
          console.warn(
            'ICON SPRITE MISSING: css/mmgr-icons.svg returned ' +
              r.status +
              ' , upload the css/ folder (mmgr.css + mmgr-icons.svg) to the site root.'
          );
        }
      })
      .catch(function () {
        console.warn(
          'ICON SPRITE MISSING: css/mmgr-icons.svg could not be fetched , upload the css/ folder to the site root.'
        );
      });
  }

  /* ---- header email sign-in sheet (OWNER 2026-08-14: "at the side of the
         hamburger or where appropriate") ----
     The shared email+password form comes from js/mmgr-google-auth.js (the SAME
     worker endpoints + session cookie as app.html/admin.html , never a duplicate
     auth implementation). The sheet is driven here: toggle + Escape +
     click-outside, one-time form mount, session restore, and the signed-in /
     signed-out states rendered from the module's events. A page may mount any
     number of trigger buttons , every element with class .signin-trigger opens
     the single #signin-sheet (marketing headers keep #signin-btn; the field-guide
     has one in the sidebar and one beside the mobile hamburger). All lookups are
     null-guarded , pages without the markup are unaffected. */
  var GA = window.MMGR && window.MMGR.GoogleAuth ? window.MMGR.GoogleAuth : null;
  var signinBtns = Array.prototype.slice.call(document.querySelectorAll('.signin-trigger'));
  var signinSheet = document.getElementById('signin-sheet');

  function setSigninOpen(open) {
    if (!signinSheet) {
      return;
    }
    signinSheet.hidden = !open;
    signinBtns.forEach(function (b) {
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (open) {
      var first = signinSheet.querySelector('input,button');
      if (first && first.focus) {
        try {
          first.focus();
        } catch (e) {
          /* focus is a hint */
        }
      }
    }
  }

  /* OWNER 2026-08-17: the header triggers themselves become the signed-in
     identity , a small avatar (photo or initial) + name , instead of the
     static "Sign in" label that stayed put after signing in. Clicking the
     chip still opens the sheet (which holds the account row + Sign out).
     DOM APIs only , remote data can't inject. */
  function renderSigninTriggers(user) {
    signinBtns.forEach(function (b) {
      b.innerHTML = '';
      b.classList.add('is-signedin');
      var displayName = (user && (user.name || user.email)) || 'Signed in';
      b.setAttribute('aria-label', 'Signed in as ' + displayName);
      /* Match the app sidebar pattern: SVG user icon + display name */
      var safe = esc(displayName);
      b.innerHTML =
        '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-user"></use></svg> ' +
        safe;
    });
  }
  function renderSigninSignedOutTriggers() {
    signinBtns.forEach(function (b) {
      b.classList.remove('is-signedin');
      b.removeAttribute('aria-label');
      b.textContent = 'Sign in';
    });
  }

  function renderSigninUser(user) {
    if (!signinSheet) {
      return;
    }
    var form = signinSheet.querySelector('.email-auth');
    var userBox = document.getElementById('signin-user');
    if (!form || !userBox) {
      return;
    }
    renderSigninTriggers(user);
    var nm = document.getElementById('signin-user-name');
    var sub = document.getElementById('signin-user-sub');
    var av = document.getElementById('signin-user-avatar');
    if (av) {
      av.innerHTML = '';
      var displayName = (user && (user.name || user.email || user.sub || '')) || '';
      var cleanName = displayName.replace(/^email:/i, '');
      var initial = cleanName.charAt(0).toUpperCase() || '?';
      av.title = 'Signed in as ' + (cleanName || 'User') + ' - click to manage';
      av.setAttribute('aria-label', 'Signed in as ' + (cleanName || 'User'));
      if (user && user.picture) {
        var img = document.createElement('img');
        img.src = user.picture;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        av.appendChild(img);
      } else {
        av.textContent = initial;
      }
    }
    if (nm) {
      nm.textContent = (user && (user.name || user.email)) || 'Signed in';
    }
    if (sub) {
      sub.textContent = user && user.email ? user.email : '';
    }
    form.hidden = true;
    userBox.hidden = false;
  }

  /* ---- PADDLE POST-CHECKOUT RETURN (owner report 2026-10-04) -----------
     Clicking "Upgrade to Premium" opens Paddle's hosted checkout, and
     Paddle returns the buyer to our DEFAULT PAYMENT LINK carrying
     ?_ptxn=txn_... . That parameter is NOT evidence that a payment
     happened - it is Paddle's instruction to OPEN the checkout, and it
     appears the moment a transaction record exists. Reading it as a
     return signal is what broke this page twice (see
     PADDLE-OWNS-_ptxn below), so nothing here treats the address bar as
     proof of anything.

     Reporting a completed checkout is therefore Paddle's job, not ours:
     onPaddleEvent listens for checkout.completed and then polls
     /api/billing/status, because the webhook that grants the plan is the
     only thing that can say so and it can land seconds after Paddle's own
     success screen. handlePaddleReturn() survives only to render
     Paddle's encoded checkout ERROR (pdc), which we do not decode - we
     did not cause it and cannot describe it accurately.

     HONESTY: the band never says "you are on Premium" until the server
     answers active. /api/billing/status reports the PLAN, not the
     payment, so "not active" proves nothing about whether anyone was
     charged and the copy must never assert otherwise. */
  function paddleReturnParams() {
    try {
      return new URLSearchParams(window.location.search);
    } catch (e) {
      return null;
    }
  }

  /* PADDLE-OWNS-_ptxn (fix 2026-10-05). `_ptxn` is Paddle's instruction to
     OPEN a checkout, not a "you have returned" signal. Paddle.Initialize()
     reads it from the URL, so NOTHING on this page may remove it before
     Initialize has run. The old handler stripped it first, which is why a
     buyer landed on /pricing and no checkout ever appeared. Completion is
     now reported by Paddle's own checkout.completed event (see
     onPaddleEvent), never inferred from the address bar. Only `pdc`
     (Paddle's encoded checkout error) is still read from the URL. */
  function stripOnly(keys) {
    try {
      var url = new URL(window.location.href);
      keys.forEach(function (k) {
        url.searchParams.delete(k);
      });
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch (e) {
      /* never let history rewrite break the page */
    }
  }

  function planBand(state, msg) {
    var host = document.querySelector('main') || document.body;
    if (!host) {
      return;
    }
    var old = document.getElementById('paddle-return-band');
    if (old) {
      old.remove();
    }
    var band = document.createElement('div');
    band.id = 'paddle-return-band';
    band.setAttribute('role', 'status');
    band.className = 'section';
    band.style.background = 'var(--surface-1, transparent)';
    band.style.borderTop = '1px solid var(--border, #ddd)';
    band.style.borderBottom = '1px solid var(--border, #ddd)';
    band.style.padding = '1.4rem 0';
    band.innerHTML =
      '<div class="container"><p style="margin:0"><strong>' +
      (state === 'ok'
        ? 'You are on Premium.'
        : state === 'wait'
          ? 'Almost there.'
          : 'Checkout did not complete.') +
      '</strong> ' +
      esc(msg) +
      '</p></div>';
    host.insertBefore(band, host.firstChild);
  }

  function handlePaddleReturn() {
    var q = paddleReturnParams();
    if (!q || !q.get('pdc')) {
      return;
    }
    stripOnly(['pdc']);
    planBand(
      'error',
      'Paddle reported that the checkout did not complete, so nothing has been charged. Nothing has been added to your account. You can try again from the button on this page, and we can help from the contact page if it keeps happening.'
    );
  }

  /* Poll /api/billing/status after a completed checkout. The webhook is the
     ONLY thing that grants the plan and it can land a few seconds after the
     buyer sees Paddle's success screen, so one read is not enough. 12 reads
     at 2.5 s = 30 s, stopping the moment the server says active. */
  function pollPlanAfterCheckout(tries) {
    if (typeof GA === 'undefined' || !GA || typeof GA.refreshPlan !== 'function') {
      return;
    }
    GA.refreshPlan().then(function (data) {
      if (data && data.active) {
        planBand(
          'ok',
          'Thank you. Premium is active on your account right now, and everything Premium unlocks is already available to you.'
        );
      } else if (tries < 11) {
        setTimeout(function () {
          pollPlanAfterCheckout(tries + 1);
        }, 2500);
      } else {
        planBand(
          'wait',
          'Your payment is still being confirmed. This can take a minute. Refresh this page shortly, and if Premium still is not showing, contact us from the contact page and we will sort it out.'
        );
      }
    });
  }

  function onPaddleEvent(ev) {
    if (!ev || !ev.name) {
      return;
    }
    if (ev.name === 'checkout.completed') {
      stripOnly(['_ptxn', 'plnk', '_pxc']);
      planBand(
        'wait',
        'Your payment went through. We are adding Premium to your account - this normally takes a few seconds.'
      );
      pollPlanAfterCheckout(0);
    } else if (ev.name === 'checkout.closed') {
      stripOnly(['_ptxn', 'plnk', '_pxc']);
    } else if (ev.name === 'checkout.error') {
      planBand(
        'error',
        'Paddle reported a problem opening the checkout, so nothing has been charged. Try the button again, and contact us if it keeps happening.'
      );
    }
  }

  /* ---- UPGRADE FROM THE PRICING PAGE (owner report 2026-10-04) -------
     pricing.html is both Paddle's default payment link AND the page a buyer
     lands on after paying, yet it described Premium and then said "go and
     use the button on your projects page" - so the page a customer is sent
     to in order to BUY had no way to buy. Now it has a real button.

     Same contract as the two app-side paths: session-gated POST
     /api/billing/checkout, then open the returned checkout.url. The tab is
     opened SYNCHRONOUSLY inside the click for the same reason as there:
     window.open() after the await has lost the user activation and Chrome
     blocks it with no message, which reads as a dead button. */
  function wireUpgradeButtons() {
    var btns = document.querySelectorAll('[data-pricing-upgrade]');
    if (!btns.length) {
      return;
    }
    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener('click', function () {
        var status = document.querySelector('[data-pricing-status]');
        function say(msg, bad) {
          if (!status) {
            return;
          }
          status.hidden = false;
          status.textContent = msg;
          status.style.color = bad ? 'var(--danger, #c0392b)' : '';
        }
        say('Opening checkout...');
        btn.disabled = true;
        var tab = window.open('about:blank', '_blank');
        // Multi-tier (Wave 6): the button names its plan via data-tier; the
        // server resolves the price ID. Legacy buttons keep the contractor
        // default by sending no tier.
        var tier = btn.getAttribute('data-tier');
        var checkoutUrl =
          '/api/billing/checkout' + (tier ? '?tier=' + encodeURIComponent(tier) : '');
        fetch(checkoutUrl, { method: 'POST', credentials: 'same-origin' })
          .then(function (res) {
            return res
              .json()
              .catch(function () {
                return {};
              })
              .then(function (d) {
                return { ok: res.ok, status: res.status, data: d };
              });
          })
          .then(function (r) {
            if (!r.ok || !r.data || !r.data.ok || !r.data.checkoutUrl) {
              if (tab) {
                try {
                  tab.close();
                } catch (e) {
                  /* already gone */
                }
              }
              btn.disabled = false;
              if (r.status === 403) {
                say('Sign in first - the plan is attached to your account.', true);
              } else if (r.status === 503) {
                say('Checkout is not available on this server yet.', true);
              } else {
                say((r.data && r.data.error) || 'Checkout failed (HTTP ' + r.status + ').', true);
              }
              return;
            }
            if (tab) {
              try {
                tab.opener = null;
                tab.location.replace(r.data.checkoutUrl);
              } catch (e) {
                window.open(r.data.checkoutUrl, '_blank', 'noopener');
              }
            } else {
              window.open(r.data.checkoutUrl, '_blank', 'noopener');
            }
            say('Checkout opened in a new tab. Finish there, then come back here.');
          })
          .catch(function () {
            if (tab) {
              try {
                tab.close();
              } catch (e) {
                /* already gone */
              }
            }
            btn.disabled = false;
            say('Could not reach the server.', true);
          });
      });
    });
  }

  function renderSigninSignedOut() {
    if (!signinSheet) {
      return;
    }
    var form = signinSheet.querySelector('.email-auth');
    var userBox = document.getElementById('signin-user');
    var av = document.getElementById('signin-user-avatar');
    if (form) {
      form.hidden = false;
    }
    if (userBox) {
      userBox.hidden = true;
    }
    if (av) {
      av.innerHTML = '';
      av.textContent = '';
    }
    renderSigninSignedOutTriggers();
  }

  if (signinBtns.length && signinSheet && GA) {
    var signinOut = document.getElementById('signin-out');
    if (signinOut) {
      signinOut.addEventListener('click', function () {
        GA.signOut();
      });
    }

    signinBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        setSigninOpen(signinSheet.hidden);
        /* iOS Safari: re-render GIS button after sheet becomes visible.
           GIS needs the host to be measurable (not display:none) for the
           button iframe to have non-zero dimensions. */
        if (!signinSheet.hidden) {
          if (typeof GA.ensureGisButton === 'function') {
            setTimeout(function () {
              GA.ensureGisButton();
            }, 60);
          }
          /* If GIS never loaded, show the styled fallback button immediately
             so the user always sees "Sign in with Google" + "Sign in with
             email instead" , never a blank slot. */
          if (typeof GA.showGoogleFallback === 'function') {
            setTimeout(function () {
              GA.showGoogleFallback();
            }, 120);
          }
        }
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !signinSheet.hidden) {
        setSigninOpen(false);
      }
    });
    document.addEventListener('click', function (e) {
      if (signinSheet.hidden) {
        return;
      }
      var onTrigger = signinBtns.some(function (b) {
        return e.target === b || b.contains(e.target);
      });
      if (onTrigger) {
        return;
      }
      if (signinSheet.contains(e.target)) {
        return;
      }
      setSigninOpen(false);
    });

    /* Mount the shared form + Google button inside the sheet. The email
       form is now the PRIMARY path (always visible, no toggle - owner
       2026-09-06); the Google button renders into #google-signin-button
       (added to all marketing signin-sheets 2026-08-22). Then restore the
       session so an already-signed-in visitor sees their state. */
    if (!document.getElementById('email-auth-block')) {
      GA.mountEmailAuth('marketing-email-auth', { showToggle: false });
    }
    /* OWNER 2026-09-09 (P5.4): the links (Forgot password? / Create account)
       move BELOW the Google button and float free - no boxes. Sheet order:
       email form, divider, Google, links, note. */
    (function () {
      var alt = document.querySelector('#signin-sheet .email-auth-alt');
      var gbtn = document.getElementById('google-signin-button');
      if (alt && gbtn) {
        gbtn.insertAdjacentElement('afterend', alt);
      }
    })();
    /* Re-render the GIS button when the sheet opens , GIS measures the host
       at render time, so a button drawn into a hidden host comes out 0x0.
       ensureGisButton() wipes a broken render and re-draws when measurable. */
    if (typeof GA.ensureGisButton === 'function') {
      GA.ensureGisButton();
    }
    /* AUTH MAINFRAME 2026-08-17: the signed-in account row carries the
       Change-password entry for email accounts (mounted once here; the
       shared control hides itself unless the account has a password). */
    GA.mountPasswordControl(document.getElementById('signin-user'));
    document.addEventListener('mmgr:user-changed', function (e) {
      renderSigninUser(e.detail);
    });
    document.addEventListener('mmgr:google-signed-out', function () {
      renderSigninSignedOut();
    });
    GA.restoreSession();
  }

  /* ---- SECTION-INDEX DROPDOWNS (OWNER 2026-08-17: hover a nav item to see
         the sections it contains; click one to jump there + highlight) ----
     Built from a manifest keyed by each .site-nav link's href, so the same
     code drives every marketing page. Clicking an item whose target exists
     on the CURRENT page scrolls to it (smooth) and flashes a gold ring;
     a target on another page navigates, and the on-load hash handler
     flashes it on arrival. Menus open on hover/focus (CSS), close on Escape
     or focus-out, and every lookup is null-guarded , never throws. */
  /* U-07 (2026-10-30): grouped, described, icon-tiled mega menu.
     The old menu was 700x590 of bare labels in a <span> (so `columns: 3` never
     applied) with no descriptions and no icons. Now each item carries the
     group it belongs to, a one-line description and an existing sprite icon
     (never an invented glyph, never an emoji). Order is the reading order the
     owner sees on the page: plan, control, field, then platform. */
  var NAV_DD = {
    'index.html#features': {
      groups: [
        {
          name: 'Plan and schedule',
          items: [
            {
              id: 'f-wbs',
              label: 'WBS + Gantt',
              desc: 'Outline in, live schedule out',
              icon: 'i-calendar'
            },
            {
              id: 'f-kanban',
              label: 'Kanban Board',
              desc: 'Lead-time lanes for permits',
              icon: 'i-clipboard'
            },
            {
              id: 'f-raci',
              label: 'RACI Matrix',
              desc: 'Roles built live from your WBS',
              icon: 'i-users'
            },
            {
              id: 'f-lookahead',
              label: 'Lookahead and Field Metrics',
              desc: 'Two-week lookaheads and PPC',
              icon: 'i-clock'
            }
          ]
        },
        {
          name: 'Control and forecast',
          items: [
            {
              id: 'f-budget',
              label: 'Budget and EVM',
              desc: 'S-curve, SPI, CPI, EAC, TCPI',
              icon: 'i-dollar'
            },
            {
              id: 'f-risk',
              label: 'Risk and Monte Carlo',
              desc: 'Monte Carlo on your finish date',
              icon: 'i-dice'
            },
            {
              id: 'f-health',
              label: 'Health and Portfolio',
              desc: 'One score across every project',
              icon: 'i-activity'
            },
            {
              id: 'f-gonogo',
              label: 'Bid Leveling and Go/No-Go',
              desc: 'Compare bids, decide by score',
              icon: 'i-target'
            }
          ]
        },
        {
          name: 'Field and records',
          items: [
            {
              id: 'f-voice',
              label: 'Voice to Notes and Claims',
              desc: 'Dictate on site, even offline',
              icon: 'i-mic'
            },
            {
              id: 'f-weather',
              label: 'Weather-Aware',
              desc: 'Flags tasks the rain will hit',
              icon: 'i-cloud-rain'
            },
            {
              id: 'f-meetings',
              label: 'Meetings and Decisions',
              desc: 'Minutes, actions, decision log',
              icon: 'i-list'
            },
            {
              id: 'f-claims',
              label: 'Claims and Digests',
              desc: 'Evidence-backed claims, digests',
              icon: 'i-receipt'
            },
            {
              id: 'f-registers',
              label: 'Registers and Compliance',
              desc: 'RFIs, submittals, permits',
              icon: 'i-folder'
            }
          ]
        },
        {
          name: 'Platform',
          platform: true,
          items: [
            {
              id: 'f-ai',
              label: 'Built-In AI',
              desc: 'Ask your project questions',
              icon: 'i-sparkle'
            },
            {
              id: 'f-offline',
              label: 'Offline-First',
              desc: 'No signal, no account needed',
              icon: 'i-download'
            }
          ]
        }
      ],
      foot: { href: 'features.html', label: 'See every feature in detail' }
    },
    'about.html': {
      groups: [
        {
          name: 'About',
          items: [
            {
              id: 'about-what',
              label: 'What it is',
              desc: 'One offline-first workspace',
              icon: 'i-compass'
            },
            {
              id: 'about-why',
              label: 'Why it exists',
              desc: 'Built from a real site',
              icon: 'i-flag'
            },
            {
              id: 'about-values',
              label: 'What matters to us',
              desc: 'Your data stays yours',
              icon: 'i-lock'
            }
          ]
        }
      ]
    },
    'contact.html': {
      groups: [
        {
          name: 'Contact',
          items: [
            { id: 'ct-email', label: 'Email', desc: 'Write to us directly', icon: 'i-mail' },
            { id: 'ct-phone', label: 'Phone', desc: 'Talk to a person', icon: 'i-phone' },
            {
              id: 'ct-access',
              label: 'Project access',
              desc: 'Bring your team on board',
              icon: 'i-users'
            },
            {
              id: 'ct-learn',
              label: 'Learn the app',
              desc: 'The field guide, start to finish',
              icon: 'i-book'
            },
            {
              id: 'ct-feedback',
              label: 'Feedback',
              desc: 'Tell us what to fix next',
              icon: 'i-info'
            }
          ]
        }
      ]
    },
    'reviews.html': {
      groups: [
        {
          name: 'Reviews',
          items: [
            {
              id: 'rv-leave',
              label: 'Leave a review',
              desc: 'Tell others how it went',
              icon: 'i-star'
            },
            {
              id: 'rv-field',
              label: 'From the field',
              desc: 'What crews say after a job',
              icon: 'i-users'
            }
          ]
        }
      ]
    }
  };
  /* Flatten once so the "does this target exist on this page" check stays
     cheap and the menu builder has a single source of truth. */
  var NAV_DD_ITEMS = {};
  Object.keys(NAV_DD).forEach(function (k) {
    (NAV_DD[k].groups || []).forEach(function (g) {
      g.items.forEach(function (it) {
        NAV_DD_ITEMS[it.id] = true;
      });
    });
  });

  var ddFlashTimer = null;
  function ddFlash(id) {
    var el = document.getElementById(id);
    if (!el) {
      return;
    }
    try {
      var rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
      el.scrollIntoView({ behavior: rm && rm.matches ? 'auto' : 'smooth', block: 'start' });
    } catch (e) {
      el.scrollIntoView();
    }
    el.classList.remove('dd-flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('dd-flash');
    if (ddFlashTimer) {
      clearTimeout(ddFlashTimer);
    }
    ddFlashTimer = setTimeout(function () {
      el.classList.remove('dd-flash');
    }, 2800);
  }

  /* OWNER 2026-08-17 dropdown behavior: hover (or keyboard focus) opens a
     SIMPLE LIGHT BOX menu. The menu stays open while the reader reaches it
     and picks; it closes on pressing Escape, picking an item, or focus/mouse
     moving away. The page-focus scrim (#nav-dd-scrim) was removed 2026-08-19
     (owner: "the full-viewport overlay blurred the entire page"). */
  /* Escape closes the menu and returns focus to the trigger; the guard stops
     the trigger's own focusin from re-opening it in the same tick. */
  var ddSuppressUntil = 0;
  function ddNow() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }
  /* OWNER 2026-10-23: the menu opens DIRECTLY UNDER THE ITEM BEING HOVERED,
     clamped to stay fully on screen - never centred in the viewport.
     Centring (the old left:50% + translateX(-50%)) put the 700px Features
     menu 393px right of its own trigger at 1280px wide (measured), so a
     reader sweeping straight down from the item MISSED the box, landed on the
     next nav item and swapped ITS menu in - the owner's "it switches the tab"
     complaint. left = trigger centre - half the menu, clamped to
     [8, viewport - menu - 8]; top = trigger bottom + 8, so the menu's ::before
     bridge (12px) covers the whole gap and the pointer meets no dead zone on
     the way down. Runs on creation, on every open, and on resize. */
  function placeNavMenu(wrap) {
    if (!wrap) {
      return;
    }
    var trig = wrap.querySelector('a.nav-link');
    var menu = wrap.querySelector('.nav-dd-menu');
    if (!trig || !menu) {
      return;
    }
    var r = trig.getBoundingClientRect();
    var w = menu.offsetWidth;
    var vw = document.documentElement.clientWidth;
    var left = Math.round(r.left + r.width / 2 - w / 2);
    left = Math.max(8, Math.min(left, Math.max(8, vw - w - 8)));
    menu.style.left = left + 'px';
    menu.style.top = Math.round(r.bottom + 8) + 'px';
  }
  function placeOpenNavMenus() {
    document.querySelectorAll('.nav-dd.is-open').forEach(placeNavMenu);
  }

  function closeDropdowns() {
    document.querySelectorAll('.nav-dd').forEach(function (w) {
      w.classList.remove('is-open');
    });
    document.querySelectorAll('.nav-dd a.nav-link').forEach(function (a) {
      a.setAttribute('aria-expanded', 'false');
    });
  }

  function wireNavDropdowns() {
    var links = document.querySelectorAll('.site-nav a.nav-link');
    var known = NAV_DD_ITEMS;
    if (!links.length) {
      return;
    }
    /* U-07 timings (NN/g mega-menu study, Radix defaults): open after a short
       stillness so a sweep across the nav does not fire every menu, close a
       moment after the pointer leaves so the diagonal journey down into the
       panel never dies in the gutter, and skip the open delay when the reader
       moves between two triggers quickly. */
    var OPEN_DELAY = 140;
    var CLOSE_DELAY = 280;
    var SKIP_DELAY = 300;
    var lastCloseAt = 0;
    var skipUntil = 0;

    Array.prototype.forEach.call(links, function (a) {
      if (a.closest('.nav-dd')) {
        return;
      } // idempotent , never re-wrap
      var cfg = NAV_DD[a.getAttribute('href')];
      if (!cfg || !cfg.groups) {
        return;
      }
      var wrap = document.createElement('div');
      wrap.className = 'nav-dd';
      var menu = document.createElement('div');
      menu.className = 'nav-dd-menu';
      menu.setAttribute('aria-label', String(a.textContent || '').trim() + ' sections');
      var page = (a.getAttribute('href') || '#').split('#')[0];
      var itemCount = 0;
      cfg.groups.forEach(function (g) {
        var col = document.createElement('div');
        col.className = 'nav-dd-col' + (g.platform ? ' is-platform' : '');
        var head = document.createElement('h6');
        head.className = 'nav-dd-head';
        head.textContent = g.name;
        col.appendChild(head);
        g.items.forEach(function (it) {
          itemCount++;
          var itA = document.createElement('a');
          itA.href = page + '#' + it.id;
          itA.className = 'nav-dd-item';
          var ico = document.createElement('span');
          ico.className = 'nav-dd-ico';
          ico.setAttribute('aria-hidden', 'true');
          var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'ico');
          svg.setAttribute('aria-hidden', 'true');
          var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttribute('href', 'css/mmgr-icons.svg#' + (it.icon || 'i-dot'));
          svg.appendChild(use);
          ico.appendChild(svg);
          var txt = document.createElement('span');
          txt.className = 'nav-dd-txt';
          var b = document.createElement('b');
          b.textContent = it.label;
          var small = document.createElement('small');
          small.className = 'nav-dd-desc';
          small.textContent = it.desc || '';
          txt.appendChild(b);
          txt.appendChild(small);
          itA.appendChild(ico);
          itA.appendChild(txt);
          itA.addEventListener('click', function (ev) {
            closeDropdowns();
            if (document.getElementById(it.id)) {
              ev.preventDefault();
              ddFlash(it.id);
              try {
                history.replaceState(null, '', '#' + it.id);
              } catch (e) {
                /* hash update is a hint */
              }
            }
          });
          col.appendChild(itA);
        });
        menu.appendChild(col);
      });
      wrap.classList.add(itemCount > 8 ? 'nav-dd-cols' : 'nav-dd-single');
      if (cfg.foot) {
        var footA = document.createElement('a');
        footA.href = cfg.foot.href;
        footA.className = 'nav-dd-foot';
        footA.textContent = cfg.foot.label;
        menu.appendChild(footA);
      }
      a.setAttribute('aria-haspopup', 'true');
      a.setAttribute('aria-expanded', 'false');
      // Swap the link for the wrapper FIRST (the link is still a child of its
      // parent at that moment), then move the link + menu INTO the wrapper.
      // The reverse order is a trap: wrap.appendChild(a) detaches the link,
      // and a later parent.replaceChild(wrap, a) throws.
      var parent = a.parentNode;
      parent.replaceChild(wrap, a);
      wrap.appendChild(a);
      wrap.appendChild(menu);
      placeNavMenu(wrap); // under its own trigger from the first paint

      var openT = 0;
      var closeT = 0;
      var open = false;
      function sync() {
        a.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      function clearTimers() {
        if (openT) {
          clearTimeout(openT);
          openT = 0;
        }
        if (closeT) {
          clearTimeout(closeT);
          closeT = 0;
        }
      }
      function doOpen() {
        if (ddNow() < ddSuppressUntil) {
          return;
        } /* Escape just closed it */
        closeDropdowns();
        placeNavMenu(wrap);
        wrap.classList.add('is-open');
        open = true;
        sync();
      }
      function openWrap() {
        clearTimers();
        if (open) {
          return;
        }
        var now = ddNow();
        var wait = now < skipUntil && now - lastCloseAt < SKIP_DELAY ? 0 : OPEN_DELAY;
        openT = setTimeout(doOpen, wait);
      }
      function closeWrap() {
        clearTimers();
        if (!open && !openT) {
          return;
        }
        closeT = setTimeout(function () {
          wrap.classList.remove('is-open');
          open = false;
          lastCloseAt = ddNow();
          skipUntil = lastCloseAt + SKIP_DELAY;
          sync();
        }, CLOSE_DELAY);
      }
      wrap.addEventListener('mouseenter', openWrap);
      wrap.addEventListener('mouseleave', closeWrap);
      wrap.addEventListener('focusin', openWrap);
      wrap.addEventListener('focusout', function (e) {
        if (!wrap.contains(e.relatedTarget)) {
          closeWrap();
        }
      });
      /* Touch and keyboard: a click on the trigger opens immediately (there is
         no hover to wait for) and a second click closes it. */
      a.addEventListener('click', function (ev) {
        if (!open) {
          ev.preventDefault();
          clearTimers();
          doOpen();
          return;
        }
        if (!document.getElementById(a.getAttribute('href').split('#')[1] || '')) {
          return;
        }
      });
    });

    window.addEventListener('resize', placeOpenNavMenus);

    /* Escape: close every menu and return focus to the trigger it came from. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') {
        return;
      }
      var trig = null;
      document.querySelectorAll('.nav-dd').forEach(function (w) {
        var l = w.querySelector('a.nav-link');
        if (l && l.getAttribute('aria-expanded') === 'true') {
          trig = l;
        }
      });
      closeDropdowns();
      if (trig) {
        ddSuppressUntil = ddNow() + 60;
        trig.focus();
      }
    });

    /* On arrival from another page with #target, flash it once. */
    if (location.hash) {
      var id = decodeURIComponent(location.hash.slice(1));
      if (known[id] && document.getElementById(id)) {
        setTimeout(function () {
          ddFlash(id);
        }, 120);
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
  var rvTargets = Array.prototype.slice.call(
    document.querySelectorAll(
      '.fcard, .aud-item, .step, .section-head, .guide-band, .pb-content, .hero-inner'
    )
  );
  if (rvTargets.length) {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!(reduceMotion && reduceMotion.matches) && 'IntersectionObserver' in window) {
      rvTargets.forEach(function (el, i) {
        el.classList.add('rv');
        el.style.setProperty('--rv-i', String(i > 8 ? 8 : i));
      });
      var rvIO = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              en.target.classList.add('rv-in');
              rvIO.unobserve(en.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
      );
      rvTargets.forEach(function (el) {
        rvIO.observe(el);
      });
    } else {
      // reduced-motion or no IO: everything visible immediately (CSS also
      // forces .rv to full visibility under reduced motion , belt + braces).
      rvTargets.forEach(function (el) {
        el.classList.add('rv-in');
      });
    }
  }

  /* ---- FEATURE PANELS (U-12, 2026-10-30) ----
     The auto-ticking carousel is GONE. It cloned five cards to fake a
     seamless loop (duplicate ids on the page), hid three quarters of the
     content behind a horizontal scroll, and needed a timer to keep moving -
     which is precisely the auto-advancing content WCAG 2.2.2 exists to
     prevent. The fifteen panels are a static bento grid now: everything is
     visible at once, nothing moves on its own, and there is no JS to run.
     Do not reintroduce a timer here; the grid replaced the mechanism. */

  /* ---- contact form (CONTACT 2026-09-14) ----
     contact.html form composes a ready-to-send email to the admin and
     opens the visitor's email app (mailto). A Copy message fallback covers
     devices without a mail client. Null-guarded, never throws, ASCII only. */
  function mountContactForm() {
    var form = document.getElementById('contact-form');
    if (!form) {
      return;
    }
    var status = document.getElementById('ct-status');
    var copyBtn = document.getElementById('ct-copy');
    var submitBtn = form.querySelector('button[type=submit]');
    var TO = 'admin@mymanagerworkspace.com';
    function field(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }
    function setStatus(msg, isErr) {
      if (!status) {
        return;
      }
      status.textContent = msg;
      status.classList.toggle('is-err', !!isErr);
      status.hidden = false;
    }
    function compose() {
      var name = field('ct-name');
      var email = field('ct-email');
      var topic = field('ct-topic') || 'Other';
      var msg = field('ct-msg');
      var lines = ['Topic: ' + topic];
      if (name) {
        lines.push('Name: ' + name);
      }
      if (email) {
        lines.push('Email: ' + email);
      }
      lines.push('');
      lines.push(msg);
      return { subject: 'My MaNaGeR contact: ' + topic, body: lines.join('\n') };
    }
    function validate() {
      var email = field('ct-email');
      var msg = field('ct-msg');
      if (!email) {
        setStatus('Please add your email so we can reply.', true);
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setStatus('That email address does not look right.', true);
        return false;
      }
      if (!msg) {
        setStatus('Please write a message first.', true);
        return false;
      }
      return true;
    }
    function mailtoFallback() {
      var c = compose();
      window.location.href =
        'mailto:' +
        TO +
        '?subject=' +
        encodeURIComponent(c.subject) +
        '&body=' +
        encodeURIComponent(c.body);
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validate()) {
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
      }
      setStatus('Sending your message...');
      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: field('ct-name'),
          email: field('ct-email'),
          topic: field('ct-topic'),
          message: field('ct-msg')
        })
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return { ok: false };
            })
            .then(function (data) {
              return { res: res, data: data };
            });
        })
        .then(function (r) {
          if (r.res.ok && r.data && r.data.ok) {
            form.reset();
            setStatus('Message sent. We will reply to your email.');
          } else if (r.res.status === 429) {
            setStatus(
              'That is a lot of messages in a short window. Please try again in about 30 minutes, or email ' +
                TO +
                ' directly.',
              true
            );
          } else if (r.data && r.data.error) {
            setStatus(r.data.error, true);
          } else {
            setStatus('Could not send just now. Opening your email app instead.', true);
            mailtoFallback();
          }
        })
        .catch(function () {
          setStatus(
            'No connection right now. Opening your email app with the message ready.',
            true
          );
          mailtoFallback();
        })
        .then(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
          }
        });
    });
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        if (!validate()) {
          return;
        }
        var c = compose();
        var text = c.subject + '\n\n' + c.body + '\n\nSent from the My MaNaGeR contact page.';
        var done = function () {
          setStatus('Message copied. Paste it into an email to ' + TO + '.');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {
            setStatus('Could not copy. Your email app will open instead.', true);
          });
        } else {
          setStatus('Copy is not available here. Use Send message instead.', true);
        }
      });
    }
  }
  /* Paddle returns the buyer here after checkout, carrying ?_ptxn= (see
     handlePaddleReturn). Called at MODULE scope rather than inside the
     sign-in-sheet block so every marketing page acknowledges the return
     even if it ever ships without a sheet - a completed purchase must
     never look like a page that did nothing. */
  /* ---- PADDLE.JS INITIALISATION (owner go 2026-10-04) ---------------
     Paddle's default payment link is REQUIRED to create transactions, and
     checkout.url is ALWAYS that link plus ?_ptxn=... by design - which is
     why buyers were being sent to a plain pricing page with no way to pay.
     Paddle's documented shape for that page is a page on the approved
     domain that loads Paddle.js: when the _ptxn query parameter is present
     Paddle.js opens the checkout overlay itself, with no click handler.

     So the token is carried on <body data-paddle-token> rather than in an
     inline script - a client-side token is DESIGNED to be public (it ships
     in browser JS and can only open checkouts), so this is where it belongs
     and it keeps the inline-script CSP hash set unchanged. This file carries
     the call rather than an inline block, for the same reason.

     initializePaddle() is a no-op unless BOTH the token and window.Paddle
     are present, so every other marketing page is unaffected and the app is
     untouched. handlePaddleReturn() still runs and still reports only what
     the server can verify. */
  var paddleReady = false;
  function initializePaddle() {
    if (paddleReady) {
      return;
    }
    var host = document.body;
    var token = host && host.getAttribute ? host.getAttribute('data-paddle-token') : '';
    if (!token) {
      return;
    }
    if (typeof window.Paddle === 'undefined' || typeof window.Paddle.Initialize !== 'function') {
      return;
    }
    try {
      /* A sandbox client token (test_...) only works against Paddle's sandbox
         environment, and Environment.set() must run BEFORE Initialize(). Live
         tokens (live_...) skip it. */
      if (
        /^test_/.test(token) &&
        window.Paddle.Environment &&
        typeof window.Paddle.Environment.set === 'function'
      ) {
        window.Paddle.Environment.set('sandbox');
      }
      window.Paddle.Initialize({ token: token, eventCallback: onPaddleEvent });
      paddleReady = true;
    } catch (e) {
      /* a checkout that will not open must not break the page */
    }
  }

  /* Paddle.js is deferred, so it may not exist yet when this runs. Poll
     briefly. If it never arrives (ad-blocker, CDN blocked, CSP) AND a buyer
     is trying to check out, SAY SO - a silent failure here looked exactly
     like "the pricing page redirected me to itself". */
  function initPaddleWhenReady() {
    initializePaddle();
    if (paddleReady) {
      return;
    }
    var tries = 0;
    var t = setInterval(function () {
      initializePaddle();
      if (paddleReady) {
        clearInterval(t);
        return;
      }
      if (++tries > 40) {
        clearInterval(t);
        var q = paddleReturnParams();
        if (
          q &&
          q.get('_ptxn') &&
          document.body &&
          document.body.getAttribute('data-paddle-token')
        ) {
          planBand(
            'error',
            'The secure payment form could not load. A browser extension or content blocker may be blocking Paddle (cdn.paddle.com). Allow it for this site and reload this page, and nothing has been charged.'
          );
        }
      }
    }, 150);
  }

  /* Dot rail tone: the dot must read on cream AND on the dark hero, so it
     follows the section behind it. elementsFromPoint at the rail's own edge,
     rAF-throttled, and skipped entirely when the rail is absent. */
  (function wireRailTone() {
    var rail = document.querySelector('.dot-rail-navigation');
    if (!rail || typeof document.elementsFromPoint !== 'function') {
      return;
    }
    function tone() {
      var r = rail.getBoundingClientRect();
      if (!r.width || !r.height) {
        return;
      }
      var hit = document.elementsFromPoint(r.right + 24, r.top + r.height / 2) || [];
      var shade = 'light';
      for (var i = 0; i < hit.length; i++) {
        if (rail.contains(hit[i])) {
          continue;
        }
        var band = hit[i].closest ? hit[i].closest('[data-tone]') : null;
        if (band) {
          shade = band.getAttribute('data-tone') || 'light';
          break;
        }
      }
      if (rail.getAttribute('data-tone') !== shade) {
        rail.setAttribute('data-tone', shade);
      }
    }
    var queued = false;
    function schedule() {
      if (queued) {
        return;
      }
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        tone();
      });
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    tone();
  })();

  /* UI pass 2026-10-30: the header used to be frosted at every scroll position,
     so it never read as part of the page. Solid at rest, frosted once content is
     under it. Passive listener + one rAF, no layout reads on the scroll thread,
     and the class is absent when the element is missing (every marketing page
     shares this script, not all of them have a header). */
  (function wireHeaderState() {
    var hdr = document.querySelector('.site-header');
    if (!hdr) {
      return;
    }
    var queued = false;
    function apply() {
      queued = false;
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      hdr.setAttribute('data-scrolled', y > 8 ? 'true' : 'false');
    }
    window.addEventListener(
      'scroll',
      function () {
        if (!queued) {
          queued = true;
          requestAnimationFrame(apply);
        }
      },
      { passive: true }
    );
    apply();
  })();

  /* ORDER MATTERS: Paddle must initialise (and read ?_ptxn=) before anything else touches the URL. */
  initPaddleWhenReady();
  handlePaddleReturn();
  wireUpgradeButtons();
  mountContactForm();
})();
