/* ============================================================
   My MaNaGeR — Service Worker (MASTER-ACTION-PLAN Rank 4.1)
   ------------------------------------------------------------
   Cache-first app shell: HTML/CSS/JS/sprite cached on install so
   the app loads instantly and works with zero connectivity.
   Everything else (Open-Meteo, optional AI cloud calls, or any
   cross-origin request) is passed through untouched — network
   calls stay circuit-broken at the JS layer, and this worker
   never intercepts them into a stale cache.

   Offline-first is a hard requirement: if a cached asset is
   requested while offline it is served from cache; navigations
   fall back to the cached shell (project.html). The full JSON
   project data lives in localStorage/IndexedDB, not here — this
   worker never touches user data.
   ============================================================ */
const CACHE = 'mmgr-shell-v16'; // bumped when shell content changes (v16: BYO-AI-KEY-SESSION-ONLY-v1 — session-only AI key vault module mmgr-ai-key.js added, Connect/Clear flow in the AI window, cloud chat now relay/vault-gated; v15: launcher/admin toggle handlers sync every instance — gate pill + header can't disagree with the saved pref; v14: launcher + admin gate gained the premium-glass & dark-theme preview — glass engine modules loaded on app.html/admin.html, gate preference pill; device-level mmgr_theme pref applied across launcher/admin/app; v13: review pass — readonly checkbox revert on view-only rejection, fab-visibility seed in qa-ai-visual; v12: audit 1.2 merged AI controls — drawer switch now drives state.config.ai.tier, tier select promoted to AI window header, flags.aiWindow dropped as a gate; v11: glass shader palette constrained — cool slate + low-weight gold, accent mix <= 0.15 dark / 0.06 light, chromatic offset reduced)
const SHELL = [
  './',
  'index.html',
  'project.html',
  'app.html',
  'css/mmgr.css',
  'css/mmgr-icons.svg',
  'icon.svg',
  'primary icon.png',
  'high contrast icon.png',
  'js/mmgr-state.js',
  'js/mmgr-utils.js',
  'js/mmgr-net.js',
  'js/mmgr-render.js',
  'js/mmgr-prompts.js',
  'js/mmgr-weather.js',
  'js/mmgr-field.js',
  'js/mmgr-schedule.js',
  'js/mmgr-resources.js',
  'js/mmgr-health.js',
  'js/mmgr-evm.js',
  'js/mmgr-dmaic.js',
  'js/mmgr-meetings.js',
  'js/mmgr-voice.js',
  'js/mmgr-errors.js',
  'js/mmgr-app.js',
  'js/mmgr-tasks.js',
  'js/mmgr-risks.js',
  'js/mmgr-stakeholders.js',
  'js/mmgr-closure.js',
  'js/mmgr-raci.js',
  'js/mmgr-charter.js',
  'js/mmgr-defs.js',
  'js/mmgr-portfolio.js',
  'js/mmgr-forecast.js',
  'js/mmgr-decisions.js',
  'js/mmgr-claim.js',
  'js/mmgr-digest.js',
  'js/mmgr-ai-key.js',
  'js/mmgr-ai.js',
  'js/mmgr-viewport.js',
  'js/mmgr-glass.js',
  'js/mmgr-sync.js',
  'js/mmgr-google-auth.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(SHELL).catch(function() {
        // A single missing asset must not fail the whole install — the
        // worker still activates with what cached successfully.
      });
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  const req = e.request;
  const url = new URL(req.url);

  // Never intercept cross-origin (Open-Meteo, AI cloud endpoints, etc.) —
  // those stay live-network, circuit-broken by the app, never cached here.
  if (url.origin !== self.location.origin) return;

  // Skip non-GET and any request the app explicitly wants fresh.
  if (req.method !== 'GET') return;

  // GOOGLE-OPERATOR-IDENTITY-v1: NEVER intercept the auth API. /api/auth/me
  // (a same-origin GET) must hit the Worker live every time — caching its
  // response would serve stale signed-in/out state after logout or expiry.
  if (url.pathname.indexOf('/api/') === 0) return;

  // HTML navigations: network-first, cached shell as offline fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function(res) {
        const copy = res.clone();
        caches.open(CACHE).then(function(cache) { cache.put(req, copy); });
        return res;
      }).catch(function() {
        return caches.match(req).then(function(hit) { return hit || caches.match('project.html'); });
      })
    );
    return;
  }

  // Static assets: cache-first.
  e.respondWith(
    caches.match(req).then(function(hit) {
      if (hit) return hit;
      return fetch(req).then(function(res) {
        if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then(function(cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function() { return caches.match('project.html'); });
    })
  );
});
