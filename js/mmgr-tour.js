/* ============================================================
   js/mmgr-tour.js - the first-project walkthrough (audit 2026-11-01, B8)
   ------------------------------------------------------------
   Owner: "a small tour on the first project opened or created: a summary
   of each section, then out." The calculator's first-run guide is the
   reference (js/calculator-page.js TOUR_STEPS), so this follows the same
   shape: a short list of steps, ONE flag in localStorage, a spotlight on
   the control being described, and the rest dimmed.

   Rules the directive sets, and where they live here:
     - shown ONCE per device, never re-shown automatically  -> FLAG +
       maybeAutoStart()
     - reachable later from the help surface                -> the
       "Take the tour" button in Settings > Features
       (data-action="startTour"), which calls MMGR.Tour.start()
     - keyboard operable, Escape closes                    -> the keydown
       router: Escape ends, ArrowRight/Enter advance, ArrowLeft goes back,
       Tab stays inside the card
     - reduced motion skips the ANIMATION only, not the content -> the
       card and every step still render; only the smooth scroll and the
       transitions are dropped
     - every step names a real control                     -> STEPS targets
       are the workspace's own section buttons and header controls

   No markup is added to project.html for this: the overlay is built on
   first use and positioned from the live control's box, so it cannot
   drift out of step with the page.
   ============================================================ */
(function () {
  'use strict';
  const ns = (window.MMGR = window.MMGR || {});

  const FLAG = 'mmgr_first_project_tour_v1';

  // The eight things the owner named, in the order a person meets them,
  // plus an opening and a closing card. `sel: null` is a centred card with
  // no spotlight (the calculator's final step works the same way).
  const STEPS = [
    {
      // The rail is #app-sidebar on desktop and #sec-nav in the compact
      // layout; aim at a nav group inside it, because the rail containers
      // themselves report no box while their children do. The desktop rail is
      // an ID (`<aside id="app-sidebar">`), not a class: a class selector
      // matches nothing and the step loses its spotlight.
      // The hamburger is the last fallback: on a phone the rail is the
      // off-canvas drawer and the button is the one control that names it.
      sel: [
        '#app-sidebar .nav-group',
        '#sec-nav .nav-group',
        '.sec-btn[data-section="dash"]',
        '#nav-btn'
      ],
      title: 'Your project, in sections',
      text: 'Everything lives in one project. This rail switches between the sections - the tour walks the ones you will use most, then gets out of your way.'
    },
    {
      sel: '.sec-btn[data-section="dash"]',
      title: 'Overview',
      text: 'The dashboard: what is late, what is next, and the health of the job at a glance.'
    },
    {
      sel: '.sec-btn[data-section="wbs"]',
      title: 'Plan',
      text: 'The work breakdown - tasks, durations, predecessors. Add a row and the schedule, Gantt and Kanban all follow it.'
    },
    {
      sel: '.sec-btn[data-section="stk"]',
      title: 'Collaborate',
      text: 'Stakeholders, meetings and the responsibility matrix. Who does what, and who needs to know.'
    },
    {
      sel: '[data-action="openDrw"]',
      title: 'Control panel',
      text: 'Settings, prompts and the full feature list. Everything optional lives here, and nothing here is required to finish a project.'
    },
    {
      sel: '#ai-bell',
      title: 'Notifications',
      text: 'Assistant notices land here - the digest, the watch items, anything it wants you to see. It never interrupts you with a pop-up.'
    },
    {
      sel: '#ai-fab',
      title: 'AI assistant',
      text: 'Ask about this project in plain language, or run a preset. It reads the project you have open, not someone else\u2019s.'
    },
    {
      sel: '.sec-btn[data-section="bud"]',
      title: 'Calculator',
      text: 'Budget and bill of quantities. Lines priced in the calculator arrive here, and totals stay editable on this device.'
    },
    {
      // The Methodology section button is hidden until the method pack is on,
      // so the tour points at the switcher a person can always see.
      sel: '[data-action="swMeth"]',
      title: 'Methodologies',
      text: 'Waterfall, Agile or Hybrid: pick the shape that fits the job. The section tabs for each method appear once you have chosen one, and you can change it later.'
    },
    {
      sel: null,
      title: 'That is the tour',
      text: 'You can replay it any time from Settings > Features. Nothing here was a setup step - the project is already yours.'
    }
  ];

  let idx = -1;
  let plan = [];
  // OWNER 2026-11-10 made the rail collapsed by default, so the four section
  // steps lost their targets and a first-run walk silently skipped them. The
  // tour is the introduction to that rail, so it pins the rail open for the
  // walk and puts it back when the walk ends.
  let _railOpenedByTour = false;
  let root = null;
  let card = null;
  let ring = null;
  let prevFocus = null;
  let placeTimer = null;

  function done() {
    try {
      return localStorage.getItem(FLAG) === '1';
    } catch (e) {
      return false;
    }
  }

  function markDone() {
    try {
      localStorage.setItem(FLAG, '1');
    } catch (e) {
      /* private mode: the tour simply shows again next time */
    }
  }

  function reduceMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function isOpen() {
    return idx >= 0;
  }

  // The workspace renders its section buttons TWICE: .sec-nav (the compact
  // rail, hidden at desktop width) and .app-sidebar (the rail a person
  // actually sees). querySelector would hand back the hidden copy and the
  // spotlight would land on a zero-size box, so every step resolves to the
  // first match with real geometry.
  function pick(sel) {
    if (!sel) {
      return null;
    }
    const sels = Array.isArray(sel) ? sel : [sel];
    for (let s = 0; s < sels.length; s++) {
      let list;
      try {
        list = document.querySelectorAll(sels[s]);
      } catch (e) {
        continue;
      }
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (!r || r.width <= 0 || r.height <= 0 || getComputedStyle(el).visibility === 'hidden') {
          continue;
        }
        // I-11: reject only a target parked OFF-CANVAS HORIZONTALLY (the phone
        // drawer slid to -105% can never be scrolled into view, so a spotlight
        // there would ring empty space). A target that is merely BELOW THE FOLD
        // inside the open, scrollable rail is still reachable: render() calls
        // scrollIntoView() on it before placing the ring, so it must not be
        // dropped from the plan just because the rail has not scrolled to it
        // yet. (This is what used to drop "Collaborate" and the lower rail
        // sections: their real-box buttons sat below the fold at plan-build
        // time and were mistaken for unreachable ones.)
        if (r.right <= 0 || r.left >= window.innerWidth) {
          continue;
        }
        return el;
      }
    }
    return null;
  }

  // ---- the overlay, built once --------------------------------------------
  function build() {
    if (root) {
      return;
    }
    root = document.createElement('div');
    root.id = 'tour-root';
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:9000',
      'display:none',
      // The coach-mark NEVER blocks the app. A first-run tour that eats the
      // person's first click (or a gate's click) is worse than no tour: the
      // card takes its own clicks, everything else passes through and simply
      // dismisses the tour.
      'pointer-events:none',
      // I-11: the dim is drawn by the ring's huge outer shadow so the target
      // stays LIT through a rounded cut-out. Only a target-less step (the
      // closing card) dims the whole viewport from here.
      'background:transparent'
    ].join(';');

    ring = document.createElement('div');
    ring.id = 'tour-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = [
      'position:absolute',
      'pointer-events:none',
      'border-radius:14px',
      // First shadow paints on top: a gold halo, then the 3px gold ring, then
      // the 9999px dim. The border box itself is the hole, so the control
      // under the spotlight keeps its full colour while everything outside
      // is covered.
      'box-shadow:0 0 26px 4px rgba(212,175,55,.35),0 0 0 3px var(--gold,#D4AF37),0 0 0 9999px rgba(8,9,11,.72)',
      'transition:none'
    ].join(';');

    card = document.createElement('div');
    card.id = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'tour-title');
    card.setAttribute('aria-describedby', 'tour-text');
    // Real theme tokens only. --panel and --tx do not exist in this app, so
    // their fallbacks painted a dark card under light-theme text: on a light
    // page the muted lines measured 2.4:1. --card/--text/--text-secondary
    // exist in both palettes, so the card stays readable either way.
    card.style.cssText = [
      'position:absolute',
      'pointer-events:auto',
      'max-width:340px',
      'background:var(--card,#15171b)',
      'color:var(--text,#e8eaee)',
      'border:1px solid rgba(212,175,55,.45)',
      'border-radius:12px',
      'padding:16px 16px 12px',
      'box-shadow:0 18px 48px rgba(0,0,0,.55)',
      'font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif'
    ].join(';');

    card.innerHTML = [
      '<div id="tour-count" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:6px"></div>',
      '<div id="tour-title" style="font-weight:600;margin-bottom:6px"></div>',
      '<div id="tour-text" style="margin-bottom:12px"></div>',
      '<div style="display:flex;gap:8px;justify-content:flex-end">',
      '<button type="button" id="tour-skip" style="background:transparent;border:0;color:var(--text-secondary);font:inherit;cursor:pointer;padding:6px 8px">Skip</button>',
      '<button type="button" id="tour-back" style="background:transparent;border:0;color:var(--text,#e8eaee);font:inherit;cursor:pointer;padding:6px 8px">Back</button>',
      '<button type="button" id="tour-next" style="background:var(--gold,#D4AF37);border:0;border-radius:8px;color:#111;font:inherit;font-weight:600;cursor:pointer;padding:7px 12px">Next</button>',
      '</div>'
    ].join('');

    root.appendChild(ring);
    root.appendChild(card);
    document.body.appendChild(root);

    root.addEventListener('click', function (e) {
      const t = e.target;
      if (!t || !t.id) {
        return;
      }
      if (t.id === 'tour-next') {
        next();
      } else if (t.id === 'tour-back') {
        prev();
      } else if (t.id === 'tour-skip') {
        end();
      }
    });
    // Any press outside the card dismisses it, and the press still reaches
    // the control it was aimed at, because the root takes no pointer events.
    document.addEventListener(
      'mousedown',
      function (e) {
        if (!isOpen()) {
          return;
        }
        if (card && card.contains(e.target)) {
          return;
        }
        end();
      },
      true
    );
  }

  // Does a card at (left, top, cw, ch) touch the target box (inflated by
  // `pad`)? The tip must never sit on the thing it is describing.
  function overlaps(left, top, cw, ch, r, pad) {
    pad = pad || 0;
    return !(
      left + cw + pad <= r.left ||
      left - pad >= r.right ||
      top + ch + pad <= r.top ||
      top - pad >= r.bottom
    );
  }

  function place(el) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = card.offsetWidth || 340;
    const ch = card.offsetHeight || 180;
    if (!el) {
      // Target-less step: dim the whole viewport and centre the card.
      root.style.background = 'rgba(8,9,11,.72)';
      ring.style.display = 'none';
      card.style.left = '12px';
      card.style.right = '12px';
      card.style.width = 'auto';
      card.style.maxWidth = 'none';
      card.style.bottom = 'auto';
      card.style.top = Math.max(12, (vh - ch) / 2) + 'px';
      if (vw >= 700) {
        card.style.left = Math.max(12, (vw - cw) / 2) + 'px';
        card.style.width = '';
        card.style.maxWidth = '340px';
      }
      return;
    }
    root.style.background = 'transparent';
    const r = el.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.left = Math.round(r.left - 6) + 'px';
    ring.style.top = Math.round(r.top - 6) + 'px';
    ring.style.width = Math.round(r.width + 12) + 'px';
    ring.style.height = Math.round(r.height + 12) + 'px';

    // Narrow screens: the card is a full-width sheet. Put it on the OPPOSITE
    // half from the target (top half target -> sheet at the bottom, and the
    // reverse), so a phone-sized sheet never covers the control it describes.
    if (vw < 700) {
      card.style.left = '12px';
      card.style.right = '12px';
      card.style.width = 'auto';
      card.style.maxWidth = 'none';
      const mid = r.top + r.height / 2;
      if (mid < vh / 2) {
        card.style.top = 'auto';
        card.style.bottom = '12px';
      } else {
        card.style.bottom = 'auto';
        card.style.top = '12px';
      }
      return;
    }

    card.style.right = 'auto';
    card.style.bottom = 'auto';
    card.style.width = '';
    card.style.maxWidth = '340px';

    // Prefer right of the target, then left, then below, then above. A
    // candidate must fit the viewport AND clear the target; only when none
    // does both do we fall back to a clamped position.
    const gap = 14;
    const cx = r.left + r.width / 2 - cw / 2;
    const below = r.bottom + gap;
    const above = r.top - ch - gap;
    // Side placement first, then centred below/above, then the same two
    // edge-aligned. Header controls live in the top-right corner and the AI
    // button in the bottom-right: without the edge-aligned variants the card
    // had nowhere to go but on top of the control it describes.
    const cands = [
      { left: r.right + gap, top: r.top + r.height / 2 - ch / 2 },
      { left: r.left - cw - gap, top: r.top + r.height / 2 - ch / 2 },
      { left: cx, top: below },
      { left: cx, top: above },
      { left: r.left, top: below },
      { left: r.right - cw, top: below },
      { left: r.left, top: above },
      { left: r.right - cw, top: above }
    ];
    const fits = function (c) {
      return c.left >= 12 && c.top >= 12 && c.left + cw <= vw - 12 && c.top + ch <= vh - 12;
    };
    let spot = null;
    for (let i = 0; i < cands.length; i++) {
      if (fits(cands[i]) && !overlaps(cands[i].left, cands[i].top, cw, ch, r, 8)) {
        spot = cands[i];
        break;
      }
    }
    if (!spot) {
      for (let i = 0; i < cands.length; i++) {
        if (fits(cands[i])) {
          spot = cands[i];
          break;
        }
      }
    }
    if (!spot) {
      spot = {
        left: Math.max(12, Math.min(vw - cw - 12, r.left)),
        top: Math.max(12, Math.min(vh - ch - 12, r.top + r.height / 2 - ch / 2))
      };
    }
    card.style.left = Math.round(spot.left) + 'px';
    card.style.top = Math.round(spot.top) + 'px';
  }

  function render() {
    build();
    if (placeTimer) {
      clearTimeout(placeTimer);
      placeTimer = null;
    }
    const st = plan[idx];
    if (!st) {
      return end();
    }
    const el = pick(st.sel);
    const count = document.getElementById('tour-count');
    const title = document.getElementById('tour-title');
    const text = document.getElementById('tour-text');
    const back = document.getElementById('tour-back');
    const next = document.getElementById('tour-next');
    if (count) {
      count.textContent = 'Step ' + (idx + 1) + ' of ' + plan.length;
    }
    if (title) {
      title.textContent = st.title;
    }
    if (text) {
      text.textContent = st.text;
    }
    if (back) {
      back.hidden = idx === 0;
    }
    if (next) {
      next.textContent = idx === plan.length - 1 ? 'Done' : 'Next';
    }
    root.style.display = 'block';
    if (el) {
      try {
        el.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: reduceMotion() ? 'auto' : 'smooth'
        });
      } catch (e) {
        /* old browsers: leave the scroll where it is */
      }
    }
    // Position after the scroll lands, on the next frame, from the live box.
    // The rail is still laying out when the tour opens, so a step whose target
    // has no box yet is retried briefly instead of being left unringed: the
    // first card used to point at nothing for the whole step.
    let tries = 0;
    let lastKey = '';
    const flush = function () {
      if (idx < 0 || plan[idx] !== st) {
        return;
      }
      const target = pick(st.sel);
      const r = target ? target.getBoundingClientRect() : null;
      // Re-place whenever the resolved target (or its box) CHANGES, not only
      // when it is missing: at boot the first pick can be the hamburger
      // fallback while the rail is still laying out, and the real target
      // appears a few frames later. Retrying only on a miss left the ring
      // parked on the fallback for the whole step.
      const key = r ? [r.left, r.top, r.width, r.height].map(Math.round).join(',') : '';
      if (key !== lastKey) {
        lastKey = key;
        place(target);
      }
      if (st.sel && tries++ < 10) {
        placeTimer = setTimeout(flush, 150);
      }
    };
    if (reduceMotion()) {
      flush();
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(flush);
      });
      // A smooth scroll is still moving when the first frames land, so place
      // again once it has settled. Without this the ring sat wherever the
      // target happened to be mid-scroll.
      setTimeout(flush, 420);
    }
    const focusTarget = document.getElementById('tour-next');
    if (focusTarget) {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch (e) {
        /* focus is a nicety here */
      }
    }
  }

  // I-11: a step whose target is not on screen for this person (a section
  // hidden by a pack, the phone drawer parked off-canvas) is SKIPPED, so the
  // walk only ever rings something real. The plan is built when the tour
  // opens; the count then matches what will actually be shown.
  function openRailForTour() {
    if (window.innerWidth <= 768) {
      return;
    }
    if (document.body.classList.contains('sidebar-open')) {
      return;
    }
    const S = window.MMGR && window.MMGR.AppSidebar;
    if (!S || typeof S.setSidebarOpen !== 'function') {
      return;
    }
    // tour-open keeps the hover-peek from collapsing the rail while the
    // pointer sits on the card instead of the rail. tour-rail-instant makes
    // the rail land in this frame: the walk is planned immediately after, and
    // a sliding rail would still be off-canvas when the plan is built.
    document.body.classList.add('tour-open', 'tour-rail-instant');
    S.setSidebarOpen(true);
    void document.body.offsetWidth;
    requestAnimationFrame(function () {
      document.body.classList.remove('tour-rail-instant');
    });
    _railOpenedByTour = true;
  }

  function closeRailAfterTour() {
    if (!_railOpenedByTour) {
      return;
    }
    _railOpenedByTour = false;
    document.body.classList.remove('tour-open');
    const S = window.MMGR && window.MMGR.AppSidebar;
    if (S && typeof S.setSidebarOpen === 'function') {
      S.setSidebarOpen(false);
    }
  }

  // I-11: a step whose target is not on screen for this person (a section
  // hidden by a pack, the phone drawer parked off-canvas) is SKIPPED, so the
  // walk only ever rings something real. The plan is built after the shell
  // has settled, so a section that is merely late to render is not mistaken
  // for a permanently hidden one.
  function buildPlan() {
    plan = STEPS.filter(function (s) {
      return !s.sel || !!pick(s.sel);
    });
  }

  // The rail's section buttons are rendered by the shell and can still be
  // 0x0 (present in the DOM, display:flex, but no box yet) for a moment after
  // the rail opens - on a real device this is immediate, in a cold headless
  // boot it can take a couple of seconds. A step whose target has no box must
  // not be dropped as "hidden" while the rail is still populating. Re-plan
  // until the plan stops CHANGING (three unchanged polls) AND, when the rail
  // is open, at least one section button has a real box - then render. The
  // walker never meets a partial plan. A transient layout that momentarily
  // hides a target must never SHRINK the walk: keep the steps already found
  // and try again next tick.
  function sectionsSized() {
    if (
      !document.body.classList.contains('sidebar-open') &&
      !document.body.classList.contains('tour-open')
    ) {
      // The rail is not open, so there is nothing to wait for - render.
      return true;
    }
    const list = document.querySelectorAll('.sec-btn[data-section]');
    for (let i = 0; i < list.length; i++) {
      const r = list[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return true;
      }
    }
    return false;
  }

  function settlePlan() {
    let stable = 0;
    let lastKeys = '';
    let tries = 0;
    (function poll() {
      if (idx < 0) {
        // The person closed (or the app took the screen) while we settled.
        return;
      }
      const before = plan.slice();
      buildPlan();
      if (before.length && plan.length < before.length) {
        // A transient layout (the rail mid-transition) must never SHRINK the
        // walk: keep the steps already found and try again next tick.
        plan = before;
      }
      const keys = plan
        .map(function (s) {
          return s.title;
        })
        .join('|');
      if (keys === lastKeys && plan.length > 0) {
        stable++;
      } else {
        stable = 0;
        lastKeys = keys;
      }
      // Render only once the plan is stable AND the rail's section buttons
      // have a real box (when the rail is open). This is what keeps a late-
      // rendering section from being dropped. A hard try cap bounds the wait.
      if ((stable >= 3 && sectionsSized()) || tries++ >= 50) {
        if (!plan.length) {
          return end();
        }
        render();
        return;
      }
      setTimeout(poll, 120);
    })();
  }

  function start(fromUser) {
    if (isOpen()) {
      return;
    }
    prevFocus = document.activeElement;
    openRailForTour();
    build();
    plan = [];
    idx = 0;
    // Settle the plan (re-plan until the shell stops laying out its rail and
    // section targets) before the first card appears, so a late-rendered
    // section is never dropped from the walk.
    settlePlan();
  }

  function next() {
    if (!isOpen()) {
      return;
    }
    if (idx >= plan.length - 1) {
      return end();
    }
    idx++;
    render();
  }

  function prev() {
    if (!isOpen() || idx === 0) {
      return;
    }
    idx--;
    render();
  }

  function end(seen) {
    if (!isOpen()) {
      return;
    }
    idx = -1;
    plan = [];
    closeRailAfterTour();
    if (placeTimer) {
      clearTimeout(placeTimer);
      placeTimer = null;
    }
    // seen === false is an interruption (the app took the screen), not the
    // person finishing the walk, so the flag stays unset and it shows again
    // next time a project is opened.
    if (seen !== false) {
      markDone();
    }
    if (root) {
      root.style.display = 'none';
    }
    if (ring) {
      ring.style.display = 'none';
    }
    if (prevFocus && prevFocus.focus) {
      try {
        prevFocus.focus({ preventScroll: true });
      } catch (e) {}
    }
    prevFocus = null;
  }

  // Escape closes, the arrows walk it, Tab stays inside the card. Capture
  // phase so the workspace's own key handling never sees these keys while
  // the tour owns the screen.
  document.addEventListener(
    'keydown',
    function (e) {
      if (!isOpen()) {
        return;
      }
      // If the app already has an overlay of its own up (drawer, modal, AI
      // window), the tour is the wrong thing to be holding the keyboard: it
      // steps aside WITHOUT recording that it was seen, and the key goes to
      // the overlay the person actually opened.
      if (document.querySelector('#drw.open, .mb.open, #om.open, #ai-win.open')) {
        end(false);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return end();
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        return next();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        return prev();
      }
      if (e.key === 'Tab') {
        const btns = ['tour-skip', 'tour-back', 'tour-next']
          .map(function (id) {
            return document.getElementById(id);
          })
          .filter(function (b) {
            return b && !b.hidden;
          });
        if (!btns.length) {
          return;
        }
        const at = btns.indexOf(document.activeElement);
        const step = e.shiftKey ? -1 : 1;
        const to = btns[(at + step + btns.length) % btns.length];
        e.preventDefault();
        try {
          to.focus({ preventScroll: true });
        } catch (err) {}
      }
    },
    true
  );

  function replaceNow() {
    if (!isOpen()) {
      return;
    }
    const st = plan[idx];
    place(st && st.sel ? pick(st.sel) : null);
  }
  window.addEventListener('resize', replaceNow);
  // Any scroll while the tour is open (the person may scroll themselves)
  // re-anchors the ring to the control it describes.
  window.addEventListener(
    'scroll',
    function () {
      if (!isOpen()) {
        return;
      }
      if (replaceNow.pending) {
        return;
      }
      replaceNow.pending = true;
      requestAnimationFrame(function () {
        replaceNow.pending = false;
        replaceNow();
      });
    },
    true
  );

  // ---- first open only ----------------------------------------------------
  function maybeAutoStart() {
    if (done() || isOpen()) {
      return;
    }
    // A workspace may open with a dialog already up (recovery code, share
    // sheet). Never cover one: the person has something else to finish.
    if (document.querySelector('#om.open, #drw.open, .mb.open, #ai-win.open')) {
      return;
    }
    if (!document.querySelector('#sec-nav')) {
      return;
    }
    start(false);
  }

  function box(r) {
    return r
      ? {
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height)
        }
      : null;
  }

  ns.Tour = {
    start: function () {
      start(true);
    },
    end: end,
    isDone: done,
    isOpen: isOpen,
    // Live geometry for the T-TOUR gate: the resolved target, the spotlight
    // cut-out and the tip, all in viewport pixels.
    current: function () {
      if (!isOpen()) {
        return null;
      }
      const st = plan[idx];
      const el = st && st.sel ? pick(st.sel) : null;
      return {
        title: st ? st.title : null,
        index: idx,
        total: plan.length,
        target: el ? box(el.getBoundingClientRect()) : null,
        ring: ring && ring.style.display !== 'none' ? box(ring.getBoundingClientRect()) : null,
        card: card ? box(card.getBoundingClientRect()) : null
      };
    },
    steps: STEPS.map(function (s) {
      return { sel: s.sel, title: s.title };
    })
  };

  // Auto-open once the workspace is up. The app boots on DOMContentLoaded
  // and renders the rail from App.init(), so wait for the rail rather than
  // guessing at a delay.
  function arm() {
    let tries = 0;
    let lastCount = -1;
    let stable = 0;
    (function poll() {
      if (done()) {
        return maybeAutoStart();
      }
      // Wait for the section nav to STOP changing, not merely to exist: the
      // workspace renders its section buttons over several frames and the
      // rail may still be sliding. A plan built mid-render drops a section
      // (the tour then walks 9 of its 10 cards) or rings the hamburger
      // fallback. Three unchanged polls at 100 ms is the settle signal.
      const count = document.querySelectorAll('.sec-btn[data-section]').length;
      if (count > 0 && count === lastCount) {
        stable++;
      } else {
        stable = 0;
        lastCount = count;
      }
      if (count > 0 && stable >= 3) {
        return maybeAutoStart();
      }
      if (tries++ < 60) {
        setTimeout(poll, 100);
      } else if (count > 0) {
        maybeAutoStart();
      }
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm);
  } else {
    arm();
  }
})();
