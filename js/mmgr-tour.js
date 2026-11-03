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
      // The rail is .app-sidebar on desktop and #sec-nav in the compact
      // layout; aim at a nav group inside it, because the rail containers
      // themselves report no box while their children do.
      sel: ['.app-sidebar .nav-group', '#sec-nav .nav-group', '.sec-btn[data-section="dash"]'],
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
  let root = null;
  let card = null;
  let ring = null;
  let prevFocus = null;

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
        if (r && r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') {
          return el;
        }
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
      'background:rgba(8,9,11,.72)'
    ].join(';');

    ring = document.createElement('div');
    ring.id = 'tour-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = [
      'position:absolute',
      'pointer-events:none',
      'border-radius:10px',
      'box-shadow:0 0 0 2px var(--gold,#D4AF37)',
      'transition:none'
    ].join(';');

    card = document.createElement('div');
    card.id = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'tour-title');
    card.setAttribute('aria-describedby', 'tour-text');
    card.style.cssText = [
      'position:absolute',
      'pointer-events:auto',
      'max-width:340px',
      'background:var(--panel,#15171b)',
      'color:var(--tx,#e8eaee)',
      'border:1px solid rgba(212,175,55,.45)',
      'border-radius:12px',
      'padding:16px 16px 12px',
      'box-shadow:0 18px 48px rgba(0,0,0,.55)',
      'font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif'
    ].join(';');

    card.innerHTML = [
      '<div id="tour-count" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--slate,#8a95a5);margin-bottom:6px"></div>',
      '<div id="tour-title" style="font-weight:600;margin-bottom:6px"></div>',
      '<div id="tour-text" style="margin-bottom:12px"></div>',
      '<div style="display:flex;gap:8px;justify-content:flex-end">',
      '<button type="button" id="tour-skip" style="background:transparent;border:0;color:var(--slate,#8a95a5);font:inherit;cursor:pointer;padding:6px 8px">Skip</button>',
      '<button type="button" id="tour-back" style="background:transparent;border:0;color:var(--tx,#e8eaee);font:inherit;cursor:pointer;padding:6px 8px">Back</button>',
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

  function place(el) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = card.offsetWidth || 340;
    const ch = card.offsetHeight || 180;
    // Narrow screens: the card becomes a bottom sheet. A floating card there
    // is nearly as wide as the phone, and anchoring it beside a header control
    // covers the very controls the person is being told about.
    if (vw < 700) {
      card.style.left = '12px';
      card.style.right = '12px';
      card.style.width = 'auto';
      card.style.maxWidth = 'none';
      card.style.top = 'auto';
      card.style.bottom = '12px';
    } else {
      card.style.right = 'auto';
      card.style.bottom = 'auto';
      card.style.width = '';
      card.style.maxWidth = '340px';
    }
    if (!el) {
      ring.style.display = 'none';
      card.style.left = Math.max(12, (vw - cw) / 2) + 'px';
      card.style.top = Math.max(12, (vh - ch) / 2) + 'px';
      return;
    }
    const r = el.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.left = Math.round(r.left - 6) + 'px';
    ring.style.top = Math.round(r.top - 6) + 'px';
    ring.style.width = Math.round(r.width + 12) + 'px';
    ring.style.height = Math.round(r.height + 12) + 'px';
    if (vw < 700) {
      return;
    }
    // Prefer right of the target, fall back to left, then below/above; keep
    // the card on screen whatever the viewport is doing.
    let left = r.right + 14;
    if (left + cw > vw - 12) {
      left = r.left - cw - 14;
    }
    if (left < 12) {
      left = Math.max(12, Math.min(vw - cw - 12, r.left));
    }
    let top = r.top + r.height / 2 - ch / 2;
    top = Math.max(12, Math.min(vh - ch - 12, top));
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(top) + 'px';
  }

  function render() {
    build();
    const st = STEPS[idx];
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
      count.textContent = 'Step ' + (idx + 1) + ' of ' + STEPS.length;
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
      next.textContent = idx === STEPS.length - 1 ? 'Done' : 'Next';
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
    const flush = function () {
      if (idx >= 0 && STEPS[idx] === st) {
        place(pick(st.sel));
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

  function start(fromUser) {
    if (isOpen()) {
      return;
    }
    prevFocus = document.activeElement;
    build();
    idx = 0;
    render();
    if (fromUser) {
      // Started from the help surface: the flag is already set, and a manual
      // replay must not clear it, so nothing to write here.
      return;
    }
  }

  function next() {
    if (!isOpen()) {
      return;
    }
    if (idx >= STEPS.length - 1) {
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
    const st = STEPS[idx];
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

  ns.Tour = {
    start: function () {
      start(true);
    },
    end: end,
    isDone: done,
    isOpen: isOpen,
    steps: STEPS.map(function (s) {
      return { sel: s.sel, title: s.title };
    })
  };

  // Auto-open once the workspace is up. The app boots on DOMContentLoaded
  // and renders the rail from App.init(), so wait for the rail rather than
  // guessing at a delay.
  function arm() {
    let tries = 0;
    (function poll() {
      if (done() || document.querySelector('#sec-nav .sec-btn')) {
        return maybeAutoStart();
      }
      if (tries++ < 100) {
        setTimeout(poll, 50);
      }
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm);
  } else {
    arm();
  }
})();
