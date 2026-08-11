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
const CACHE = 'mmgr-shell-v45'; // bumped when shell content changes (v45: AI-WINDOW-RESIZE polish — final size tracked on the drag object (no DOM re-read at release; a press-without-move saves nothing) and corner handles shrunk to 12x12 so they never overlap the Send button hit area (v44: AI-WINDOW-RESIZE — eight edge/corner drag handles on the AI window (.ai-rz, pointer-driven in mmgr-ai.js), size persisted per device in localStorage mmgr_ai_size and restored+clamped on open; qa-ai A18a/A18b gates (v43: AI-WINDOW-DOUBLED-SIZE cleanup — dropped the dead max-height:95vh (height:min(92vh,950px) always binds) and kept .ai-q max-height at 120px to match mmgr-ai.js grow()'s inline cap (v42: AI-WINDOW-DOUBLED-SIZE — chat bubbles capped at min(82%,760px)/min(88%,800px) so doubled-width window keeps readable text lines (v41: AI-WINDOW-DOUBLED-SIZE — modal given explicit height:min(92vh,950px) so the thread always fills the screen instead of collapsing to content height (v40: AI-WINDOW-DOUBLED-SIZE — #ai-win modal enlarged from min(760px,100%) to min(1500px,100%) with 95vh max-height, and the interior (thread padding, bubble text, bot avatar, chat input bar, Send, header, segment tabs) scaled up to suit the wider pane (css/mmgr.css); v39: CSP-AUDIT-FIX — project.html meta CSP was missing its own theme-script hash 'sha256-gCwlAVK...', silently blocking that inline <script> in production; hash added + verify-csp-hashes.cjs now checks page meta CSPs (v38: GATE-DECLUTTER — the same header/setup treatment applied to the access gates: admin.html login + setup screens get pill CTAs, the ONE app-wide focus ring on gate inputs (gold border + soft ring, DIR-3), shorter gate copy; app.html unlock modal gets pill Unlock/Cancel buttons and drops the redundant contact-hint line (the page notice + #om-desc already carry it) (app.html + admin.html); v37: AI-WINDOW-DECLUTTER-UI-UX-PLAN — the cloud-connection strip keeps ONE smart status chip + provider select while the raw API key input, Connect & Test, and the security footnote move into a settings-gear popover (ai-byo-gear/ai-byo-pop); the engine pill names the tier only (connection detail lives solely in the status chip); Chat/Presets tabs restyle as a pill segmented control; bot bubbles flatten to a soft card (no nested border box); the permanent red connection warning is gone — Send stays disabled with a native wrapper tooltip; chat input gains extension-icon-safe right padding (project.html + css/mmgr.css + js/mmgr-ai.js); v36: AI-WINDOW-POLISH review pass — copy-button reset now uses ONE shared timer (rapid re-clicks no longer leave the label stuck on 'Copied') and restores the static known HTML + aria-label instead of a captured snapshot (js/mmgr-ai.js); v35: AI-WINDOW-POLISH-AND-COPY — AI window decluttered: header engine/API pills + tier select grouped into one right-side cluster (.ai-head-right), cloud-connection row loses its verbose label and 3-line security paragraph (status chip + key-input title + one-line .ai-byo-sec keep the message), shorter chat/key placeholders, tighter header/pill/conn-row spacing; every assistant bubble gains a per-answer Copy button (delegated on the thread, exact text via dataset.copyText, green Copied feedback) — project.html + css/mmgr.css + js/mmgr-ai.js; v34: app.html ?locked= record gains the file field so a non-manifest cloud-code unlock navigates correctly; v33: app.html ?locked=<id> auto-opens the unlock modal so a cloud owner/editor code can be entered even for a project not yet in this device\u2019s manifest; v32: CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2+3 — editor codes with server-side section scoping (cloud_editor_codes migration), changelog with owner-only revert (cloud_changelog migration), admin cloud listing (ADMIN_CODE secret), app.html editor-code unlock, mmgr-cloud.js editor/changelog UI; v31: CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1 review pass — mmgr-cloud.js displays the owner code once in the linked section (escaped) and after create/recover, adds the fresh-device "Load with Code" flow's escaped display, and the worker now strips state secrets on save + equalizes unknown-project timing (dummy PBKDF2 + timing floor) so existence is not leaked by response time; v30: CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1 — project.html re-normalized to LF (the stash cycles had rewritten it CRLF, which breaks its inline-script CSP hashes — v18 rule); v29: CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1 — new js/mmgr-cloud.js added to the shell, project.html gains the #cloud-section slot + its script tag + frame-src accounts.google.com in the meta CSP, mmgr-app.js wires the cloudCreate/cloudSave/cloudLoad/cloudRecover/cloudCopyCode/cloudSignIn actions + READONLY_SAFE_ACTIONS entries + init hook, mmgr-render.js renderGreeting §10 self-overwrite bug fixed (name + time-of-day now composed in ONE innerHTML write); v28: QA-TAB-AI-LAYOUT-DOC — project.html #db-qa 'How does the built-in AI work' answer now documents the AI window's Chat / Presets tab bar (conversation under Chat, one-click prompt chips under Presets); v27: DEAD-AISET-ACTIONS-CLEANUP — aiSetProvider/aiSetEndpoint/aiSetModel ACTION_MAP entries and the leftover aiSetProvider/aiSetEndpoint/aiSetModel/aiSetKey change+input whitelist refs removed from mmgr-app.js (no markup ever dispatched them; provider flows through the BYO Connect & Test path only); v26: AI-WINDOW-LAYOUT-SCROLL-AND-INPUT-BUG-DIRECTIVE — AI window presets moved out of the scroll-competing thread column into their own Chat/Presets tab pane (always reachable regardless of conversation length), chat input gains an at-cap top-fade scroll affordance (project.html + css/mmgr.css + js/mmgr-ai.js); v25: MINOR-UI-MODERNIZATION-POLISH (DIR-1..5 in css/mmgr.css) — radius scale unified on small components (var(--radius)), base select restyled (appearance:none + gold chevron + hover + var(--radius)), ONE app-wide focus ring (input/select/textarea:focus gold border + soft ring, redundant per-component focus rules removed), hardcoded #eef1f6/#f8fafc backgrounds swapped for --track-bg/--tile-bg/--card so they adapt to dark/glass themes, Firefox scrollbar-width/scrollbar-color parity; v24: FEATURE-DOCS-AND-QA — project.html #db-qa Q&A tab populated (10 app-accurate Q&As incl. the AI rate-limit fallback), index.html Built-In AI card + features.html AI bullets + field-guide A-13 Cloud card & A-19 FAQ + about.html mention all document the model-fallback ladder and three connectable providers; v23: AI-FALLBACK-BADGE — mmgr-ai.js runCloud result exposes fellBackFrom and renderThread/seedThreadFromState render a visible .ai-fallback chip in the chat bubble (amber, names both models) so users see a 429-driven ladder fallback without reading the trace; runPreset persists fellBackFrom into aiOutputs; mmgr.css adds the .ai-fallback style; qa-ai.cjs A08j asserts the badge; v22: ANTHROPIC-CONNECTABLE fast-follow — Anthropic joins the BYO Connect flow (vault whitelist mmgr-ai-key.js, provider select project.html, live probe + provider labels mmgr-ai.js) so the Anthropic fallback ladder is reachable from the UI, and the A08g/A08h/A08i gates exercise it for real; v21: MODEL-FALLBACK-LADDER fast-follow — ladder generalized to ALL providers (callProviderWithFallback): openai PROVIDER_DEFAULTS gains fallbackModels gpt-5-mini/gpt-5-nano, anthropic gains claude-3-5-haiku-latest/claude-3-haiku + corrected Messages-API wire format (x-api-key/anthropic-version/max_tokens/content[].text) client + relay, runCloud reports actual model for every provider; v20: GEMINI-MODEL-FALLBACK-LADDER — mmgr-net.js PROVIDER_DEFAULTS gains fallbackModels + geminiEndpointFor + status-carrying Net errors; mmgr-ai.js adds the shared callGeminiWithFallback ladder routed by directChat/relayChat/runCloud (429/503 advances, 401 stops & clears), DIR-4 reports the model that actually answered; v19: ADMIN-PUBLISH-SYNC-AND-PROJECT-SELECT-POLISH — local-first creator access: app.html merges this device's admin projects (mmgr_admin_projects) into the grid and opens locally-owned projects instantly with zero code re-entry (publish/deploy now gates only OTHER people's access), project.html gate treats locally-owned ids as unlocked full-scope, admin rows show a quiet 'Not published — visitors can't open this yet' note + Download & publish button vs the live manifest, security banner rewritten to describe real opt-in Drive behavior (admin codes never leave the device), CSP hashes regenerated for app.html/admin.html (final: dead localProjectRecord removed, deleted-but-live list line added); v18: AI-CLOUD-CONNECT-UI-AND-KEY-SECURITY — cloud connection row promoted out of the collapsed AI details to an always-visible row under the tier select, Connect & Test runs a real provider probe (models-list via the circuit-broken Net path, 2xx only), single canonical state.config.ai.connectionStatus drives pill/chip/Send (not_connected/saved_untested/connected, never fabricated from key presence), provider secrets stripped from every export/import/adopt, dead aiSetKey action removed, orphaned .ai-cfg CSS cleaned, hint/toast copy use plain '&', project.html LF-normalized so its inline-script CSP hashes stay stable; v17: INTEGRATED-STRUCTURE-API-WINDOW — /api/health liveness badge in the AI window (checkApiHealth), mouse-tracking .mouse-glow on the premium glass backdrop; v16: BYO-AI-KEY-SESSION-ONLY-v1 — session-only AI key vault module mmgr-ai-key.js added, Connect/Clear flow in the AI window, cloud chat now relay/vault-gated; v15: launcher/admin toggle handlers sync every instance — gate pill + header can't disagree with the saved pref; v14: launcher + admin gate gained the premium-glass & dark-theme preview — glass engine modules loaded on app.html/admin.html, gate preference pill; device-level mmgr_theme pref applied across launcher/admin/app; v13: review pass — readonly checkbox revert on view-only rejection, fab-visibility seed in qa-ai-visual; v12: audit 1.2 merged AI controls — drawer switch now drives state.config.ai.tier, tier select promoted to AI window header, flags.aiWindow dropped as a gate; v11: glass shader palette constrained — cool slate + low-weight gold, accent mix <= 0.15 dark / 0.06 light, chromatic offset reduced)
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
  'js/mmgr-google-auth.js',
  'js/mmgr-cloud.js'
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
