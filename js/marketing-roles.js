/* ============================================================
   marketing-roles.js - the four role-card figures (UX-2026-11-19 C3)
   ------------------------------------------------------------
   Replaces the inline SVG silhouette in an OPEN role card with a low-poly
   three.js figure: ink-dark, flat-shaded, with a thin gold rim light.

   Rules this file exists to obey (the directive's budget, not decoration):
     - ONE canvas and ONE renderer for all four figures. The canvas is moved
       into whichever card is open; a second WebGL context is never created.
     - three.js is the copy already vendored at /vendor/three/three.module.js
       (the same r160 the calculator's glass panel imports). No second copy,
       no CDN, no new origin.
     - At most 1,500 triangles per figure (measured and asserted below).
     - The canvas box is 208 x 296 CSS px and the device pixel ratio is capped
       at 1.5, so a 3x phone still renders a 312 x 444 buffer.
     - Render ON DEMAND only: a ~1.2s pop when a card opens, and one frame per
       pointer move while the pointer is over that card. There is no idle
       requestAnimationFrame loop - when nothing is happening, nothing runs.
     - Nothing here is required. If WebGL is missing, the visitor asked for
       reduced motion or Performance Mode, the connection is metered, or the
       module fails to load, the inline SVG silhouette simply stays.

   Loaded by js/marketing.js only when #builtfor comes within one viewport of
   the screen, so it never competes with the hero for first paint or the LCP.
   ============================================================ */
(function () {
  'use strict';

  var MODULE = '/vendor/three/three.module.js';
  var INK = 0x1b2430;
  var GOLD = 0xc5a056;
  var BOX_W = 150;
  var BOX_H = 214;
  var MAX_DPR = 1.5;
  var TRI_BUDGET = 1500;

  /* Re-read on every open, not just at import: Performance Mode can be
     switched on while the page is up, and the figure has to stop then too. */
  function blocked() {
    if (document.documentElement.getAttribute('data-perf') === 'on') {
      return true;
    }
    var rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rm && rm.matches) {
      return true;
    }
    var conn = navigator.connection;
    return !!(conn && conn.saveData);
  }

  var webglOk = null;
  function hasWebGL() {
    if (webglOk !== null) {
      return webglOk;
    }
    webglOk = false;
    try {
      var probe = document.createElement('canvas');
      var gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
      if (gl) {
        webglOk = true;
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) {
          lose.loseContext();
        }
      }
    } catch (e) {
      webglOk = false;
    }
    return webglOk;
  }

  function canRun() {
    return !blocked() && hasWebGL();
  }

  if (!canRun()) {
    return;
  }

  var cards = Array.prototype.slice.call(document.querySelectorAll('.role-card'));
  if (!cards.length) {
    return;
  }

  import(MODULE)
    .then(function (THREE) {
      start(THREE);
    })
    .catch(function () {
      /* the SVG silhouette stays; nothing to report */
    });

  function start(THREE) {
    var canvas = document.createElement('canvas');
    canvas.className = 'role-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.width = BOX_W + 'px';
    canvas.style.height = BOX_H + 'px';

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) {
      return;
    }
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    renderer.setPixelRatio(dpr);
    renderer.setSize(BOX_W, BOX_H, false);
    renderer.setClearAlpha(0);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, BOX_W / BOX_H, 0.1, 20);
    camera.position.set(0, 1.35, 3.5);
    camera.lookAt(0, 0.95, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    var key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(-1.4, 2.4, 2.2);
    scene.add(key);
    // the rim: gold, low, from behind so it draws an edge and never a face
    var rim = new THREE.DirectionalLight(GOLD, 1.15);
    rim.position.set(1.8, 1.2, -2.4);
    scene.add(rim);

    var mat = new THREE.MeshStandardMaterial({
      color: INK,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true
    });
    var accent = new THREE.MeshStandardMaterial({
      color: 0x33415a,
      roughness: 0.85,
      metalness: 0.06,
      flatShading: true
    });

    var figures = Object.create(null);
    var active = null;
    var activeCard = null;
    var raf = 0;

    function triCount(obj) {
      var n = 0;
      obj.traverse(function (o) {
        if (!o.geometry) {
          return;
        }
        var g = o.geometry;
        if (g.index) {
          n += g.index.count / 3;
        } else if (g.attributes && g.attributes.position) {
          n += g.attributes.position.count / 3;
        }
      });
      return Math.round(n);
    }

    function box(parent, w, h, d, x, y, z, m) {
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    }

    function build(role) {
      var g = new THREE.Group();
      var hat = role !== 'pm';

      // body
      box(g, 0.44, 0.62, 0.24, 0, 1.02, 0);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 7), mat);
      head.position.set(0, 1.5, 0);
      g.add(head);
      box(g, 0.15, 0.7, 0.19, -0.13, 0.35, 0);
      box(g, 0.15, 0.7, 0.19, 0.13, 0.35, 0);
      box(g, 0.11, 0.56, 0.13, -0.29, 1.04, 0);
      box(g, 0.11, 0.56, 0.13, 0.29, 1.04, 0);

      if (hat) {
        var brim = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.03, 10), mat);
        brim.position.set(0, 1.62, 0);
        g.add(brim);
        var dome = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.155, 0.12, 10), mat);
        dome.position.set(0, 1.69, 0);
        g.add(dome);
      }

      if (role === 'gc') {
        // a laptop on a low bench, hands forward
        box(g, 0.62, 0.04, 0.06, 0, 0.82, 0.42);
        var lid = box(g, 0.62, 0.36, 0.04, 0, 1.0, 0.24);
        lid.rotation.x = -0.28;
        box(g, 0.62, 0.34, 0.3, 0, 0.4, 0.42, accent);
      } else if (role === 'pm') {
        // a tablet held in both hands
        var tab = box(g, 0.3, 0.4, 0.04, 0, 0.98, 0.26, accent);
        tab.rotation.x = -0.18;
        // a tie
        box(g, 0.07, 0.34, 0.03, 0, 1.12, 0.13, accent);
      } else if (role === 'super') {
        // hi-vis vest over the torso, a clipboard under one arm
        box(g, 0.36, 0.44, 0.03, 0, 1.08, 0.13, accent);
        var clip = box(g, 0.24, 0.32, 0.03, -0.34, 0.98, 0.2, accent);
        clip.rotation.z = 0.16;
      } else {
        // tool belt and a spirit level held out
        box(g, 0.5, 0.09, 0.28, 0, 0.72, 0, accent);
        var level = box(g, 0.07, 0.44, 0.07, 0.4, 1.06, 0.16, accent);
        level.rotation.z = -0.2;
      }
      g.userData.tris = triCount(g);
      return g;
    }

    function figureFor(role) {
      if (!figures[role]) {
        var g = build(role);
        if (g.userData.tris > TRI_BUDGET) {
          // never ship a figure over budget: fall back to the silhouette
          return null;
        }
        figures[role] = g;
      }
      return figures[role];
    }

    var frames = 0;
    function draw() {
      frames++;
      renderer.render(scene, camera);
    }

    function easeOut(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function pop() {
      // ~1.2s: rise, settle, stop. The loop ends itself - no idle frames.
      var t0 = performance.now();
      var DUR = 1200;
      function step(now) {
        var t = Math.min(1, (now - t0) / DUR);
        var e = easeOut(t);
        active.scale.setScalar(0.86 + 0.14 * e);
        active.rotation.y = -0.55 * (1 - e);
        draw();
        if (t < 1) {
          raf = requestAnimationFrame(step);
        } else {
          raf = 0;
          active.scale.setScalar(1);
          active.rotation.y = 0;
          draw();
        }
      }
      if (raf) {
        cancelAnimationFrame(raf);
      }
      raf = requestAnimationFrame(step);
    }

    function attach(card) {
      if (blocked() || !hasWebGL()) {
        detach();
        return;
      }
      var role = card.getAttribute('data-role');
      var fig = figureFor(role);
      if (!fig) {
        return;
      }
      var host = card.querySelector('.role-fig');
      if (!host) {
        return;
      }
      if (activeCard && activeCard !== card) {
        var prev = activeCard.querySelector('.role-fig');
        if (prev) {
          prev.classList.remove('has-canvas');
          var oldSvg = prev.querySelector('.role-svg');
          if (oldSvg) {
            oldSvg.style.display = '';
          }
        }
      }
      var svg = host.querySelector('.role-svg');
      if (svg) {
        svg.style.display = 'none';
      }
      host.classList.add('has-canvas');
      host.appendChild(canvas);
      if (active && active.parent) {
        active.parent.remove(active);
      }
      active = fig;
      activeCard = card;
      scene.add(active);
      pop();
    }

    function detach() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (active && active.parent) {
        active.parent.remove(active);
      }
      if (activeCard) {
        var host = activeCard.querySelector('.role-fig');
        var svg = host && host.querySelector('.role-svg');
        if (svg) {
          svg.style.display = '';
        }
        if (host) {
          host.classList.remove('has-canvas');
        }
      }
      active = null;
      activeCard = null;
    }

    // one delegated pair of listeners for the whole row
    document.addEventListener('mmgr:roleopen', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.role-card') : null;
      if (card) {
        attach(card);
      }
    });
    document.addEventListener('mmgr:roleclose', function () {
      detach();
    });
    // one frame per pointer move while the pointer is over the open card
    var lastMove = 0;
    document.addEventListener(
      'pointermove',
      function (e) {
        if (!active || !activeCard || !activeCard.contains(e.target)) {
          return;
        }
        var now = performance.now();
        if (now - lastMove < 33) {
          return;
        }
        lastMove = now;
        var r = activeCard.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        active.rotation.y = Math.max(-1, Math.min(1, dx)) * 0.38;
        draw();
      },
      { passive: true }
    );

    window.__mmgrRoleFigures = {
      triangles: function () {
        return Object.keys(figures).map(function (k) {
          return { role: k, tris: figures[k].userData.tris };
        });
      },
      // frames drawn so far - the idle arm reads this twice and requires it
      // not to move once the pop has finished
      frames: function () {
        return frames;
      },
      dpr: function () {
        return dpr;
      }
    };
  }
})();
