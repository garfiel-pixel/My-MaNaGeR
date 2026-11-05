/* ============================================================
   PARTICLE LINE - B6 (audit 2026-11-01)
   ------------------------------------------------------------
   A quiet, theme-reactive particle line for the Advanced Packs panel.

     - ONE canvas (#adv-particle-line), decorative (aria-hidden, no input).
     - Colours are read from CSS custom properties, so every palette (including
       the newer neoprene/cyan ones) follows for free.
     - Paused while offscreen (IntersectionObserver) and under reduced motion
       (a single static frame is drawn, then the loop stops).
     - The wobbly baseline + particle advance are cheap in the rAF loop; the
       expensive path rebuild runs behind requestIdleCallback so it never
       blocks first paint or interaction.

   Self-contained: reached directly as MMGR.ParticleLine. No monolith wrappers
   (same pattern as components.js / entitlements.js / section-accelerator.js).
   ============================================================ */
(function (ns) {
  'use strict';

  var canvas = null;
  var ctx = null;
  var raf = 0;
  var running = false;
  var visible = false;
  var reduced = false;
  var hover = 0; // 0..1 jiggle amount, decays
  var t = 0;
  var W = 0;
  var H = 0;
  var dpr = 1;
  // Theme colours (refreshed on theme change).
  var col = {
    line: '#d4af37',
    glow: 'rgba(212,175,55,0.25)',
    dot: '#e6c878',
    fade: 'rgba(0,0,0,0)'
  };
  var path = []; // pre-computed baseline points (rebuilt in idle callback)

  function readTheme() {
    try {
      var cs = getComputedStyle(document.documentElement);
      var g = cs.getPropertyValue('--gold').trim();
      var ink = cs.getPropertyValue('--text-secondary').trim();
      if (g) col.line = g;
      if (ink) col.dot = ink;
      col.glow = 'rgba(' + hexToRgb(g || '#d4af37') + ',0.22)';
    } catch (e) {}
  }

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }

  function size() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Rebuild the wobbly baseline. Called behind requestIdleCallback.
  function rebuildPath() {
    path = [];
    if (W < 2) return;
    var steps = Math.max(24, Math.floor(W / 6));
    for (var i = 0; i <= steps; i++) {
      var x = (i / steps) * W;
      // two summed sines -> gentle, non-repeating wobble
      var y = H * 0.5 + Math.sin(i * 0.35) * H * 0.18 + Math.sin(i * 0.11 + 1.3) * H * 0.1;
      path.push({ x: x, y: y });
    }
  }

  function yAt(x) {
    if (!path.length) return H * 0.5;
    var f = (x / W) * (path.length - 1);
    var i = Math.floor(f);
    if (i >= path.length - 1) return path[path.length - 1].y;
    var frac = f - i;
    return path[i].y + (path[i + 1].y - path[i].y) * frac;
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // line
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col.line;
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 6 + hover * 10;
    ctx.beginPath();
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      var yy = p.y + Math.sin(t * 0.04 + i * 0.2) * hover * 4;
      if (i === 0) ctx.moveTo(p.x, yy);
      else ctx.lineTo(p.x, yy);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // particles riding the line
    var count = 7;
    for (var k = 0; k < count; k++) {
      var px = (t * 0.6 + (k * W) / count) % W;
      var py = yAt(px) + Math.sin(t * 0.05 + k) * hover * 3;
      ctx.beginPath();
      ctx.fillStyle = col.dot;
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop() {
    if (!running) return;
    t += 1;
    hover *= 0.94; // decay jiggle
    draw();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (running || !canvas || !ctx) return;
    if (!visible || reduced) {
      // draw a single static frame so the panel is never empty
      if (reduced && ctx) draw();
      return;
    }
    running = true;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function scheduleRebuild() {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(rebuildPath, { timeout: 200 });
    } else {
      setTimeout(rebuildPath, 0);
    }
  }

  function init() {
    canvas = document.getElementById('adv-particle-line');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    readTheme();
    size();
    rebuildPath();

    // pause offscreen
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(
        function (entries) {
          visible = entries[0].isIntersecting;
          if (visible) {
            // the canvas may have been sized while its container was hidden
            // (display:none -> zero box); re-measure and rebuild now that it shows.
            size();
            scheduleRebuild();
            start();
          } else {
            stop();
          }
        },
        { threshold: 0.05 }
      );
      io.observe(canvas);
    } else {
      visible = true;
      size();
      scheduleRebuild();
      start();
    }

    // hover jiggle on the panel header
    var sec = document.getElementById('adv-packs-section');
    var host = sec ? sec.parentElement : canvas.parentElement;
    if (host) {
      host.addEventListener('mouseenter', function () {
        hover = 1;
      });
    }

    // theme change -> refresh colours + rebuild. Self-contained: observe the
    // body's dark-mode class rather than depending on an app theme hook.
    var lastDark = document.body.classList.contains('dark-mode');
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function () {
        var nowDark = document.body.classList.contains('dark-mode');
        if (nowDark !== lastDark) {
          lastDark = nowDark;
          readTheme();
          scheduleRebuild();
        }
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    // also rebuild on resize (cheap)
    window.addEventListener('resize', function () {
      size();
      scheduleRebuild();
    });

    start();
  }

  ns.ParticleLine = {
    init: init,
    start: start,
    stop: stop,
    isRunning: function () {
      return running;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})((window.MMGR = window.MMGR || {}));
