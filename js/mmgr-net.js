/* ============================================================
   My MaNaGeR — Network wrapper + central config (Phase 3)
   ------------------------------------------------------------
   Two contracts for API-readiness:

   1. MMGR.Config — the SINGLE object that will hold future API
      keys and endpoint URLs when the app grows a real backend
      (it is currently pure client-side: localStorage + optional
      Open-Meteo). `api.endpoints` / `api.keys` are EMPTY by
      design. A per-project override can be stored in
      state.config and merged over these defaults at boot.
      Nothing reads secrets from here yet — this is the
      designated home so a migration never scatters keys.

   2. MMGR.Net — the ONLY place network calls are allowed to
      live. Every outbound request routes through Net.get()
      (or Net.getJSON()), which already provides:
        - AbortController timeout (default 10s)
        - retry with exponential backoff (default max 3:
          base 800ms -> 800 / 1600 / 3200ms)
        - 5xx responses are retried; 4xx/3xx pass through so the
          caller decides (they are not transient server faults)
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  // ---- MMGR.Config ----
  // Rank 2.3 (PLAN-OF-ACTION-AI-VOICE-SYNC-v1): the AI config now carries a
  // real tier switch. tiers:
  //   'off'    — no generative call; the AI window stays copy-first.
  //   'local'  — zero-key in-browser engine (rule-based, offline-first, every
  //              line traces to a state field). No network, no key.
  //   'cloud'  — BYO key (OpenAI or Anthropic) through MMGR.Net's
  //              circuit-breaker (timeout/backoff/5xx-retry). Never required.
  // Switching tiers is a settings toggle only — no schema/architecture
  // change, per Rank 2.3's exit criterion.
  const PROVIDER_DEFAULTS = {
    openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-latest' }
  };

  const Config = {
    ai: {
      tier: 'off',
      provider: 'openai',
      endpoint: '',   // empty -> provider default above
      apiKey: '',     // BYO key; never sent for local/off tiers
      model: ''       // empty -> provider default above
    },
    // Future general API endpoints/keys (e.g. push sync, backup).
    api: { endpoints: {}, keys: {} },
    // Network policy used by MMGR.Net when no per-call override is given.
    net: {
      timeoutMs: 10000,
      maxRetries: 3,
      baseDelayMs: 800
    }
  };

  // Merge a per-project state.config over the static defaults.
  function getConfig(state) {
    const s = state || (ns.State && ns.State.getState ? ns.State.getState() : null);
    const over = (s && s.config) || {};
    const merged = {
      ai: Object.assign({}, Config.ai, over.ai || {}),
      api: Object.assign({}, Config.api, over.api || {}),
      net: Object.assign({}, Config.net, over.net || {})
    };
    return merged;
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function fetchWithTimeout(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(function() { ctrl.abort(); }, opts.timeoutMs);
    try {
      return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    } finally {
      clearTimeout(t);
    }
  }

  // ---- GET with timeout + exponential-backoff retry ----
  // opts: { timeoutMs, maxRetries, baseDelayMs, headers }
  // NOTE on semantics: maxRetries is the number of RETRY ATTEMPTS after the
  // first call, so the total request count is maxRetries + 1. The default
  // (3) therefore means up to 4 requests, backoff delays 800 / 1600 / 3200ms.
  // Resolves with the Response when it is ok OR a non-5xx status (the
  // caller decides how to surface 3xx/4xx). Rejects after retries are
  // exhausted for network errors, timeouts, 408/429 (rate limiting) and 5xx.
  async function get(url, opts) {
    const cfg = getConfig();
    const o = Object.assign({
      timeoutMs: cfg.net.timeoutMs,
      maxRetries: cfg.net.maxRetries,
      baseDelayMs: cfg.net.baseDelayMs,
      headers: {}
    }, opts || {});
    const maxRetries = Math.max(0, parseInt(o.maxRetries, 10) || 0);
    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchWithTimeout(url, { method: 'GET', headers: o.headers, timeoutMs: o.timeoutMs });
        // Retry transient server/rate-limit statuses; let 3xx/4xx (except
        // 408/429) pass through so the caller can surface them directly.
        const retriable = res.status >= 500 || res.status === 429 || res.status === 408;
        if (res.ok || !retriable) return res;
        lastErr = new Error('HTTP ' + res.status);
      } catch (e) {
        // Network failure or timeout — retriable.
        lastErr = e;
      }
      if (attempt < maxRetries) {
        await delay(o.baseDelayMs * Math.pow(2, attempt));
      }
    }
    throw (lastErr || new Error('request failed: ' + url));
  }

  async function getJSON(url, opts) {
    const res = await get(url, opts);
    return res.json();
  }

  // ---- POST with JSON body, same circuit-breaker discipline as GET ----
  // Rank 2.3: the AI cloud tier routes through THIS — timeout, exponential
  // backoff, 5xx/408/429 retry — so a dead AI endpoint degrades exactly like
  // a dead weather endpoint: the app keeps working, the call just fails
  // loudly but harmlessly. Resolves with the Response (caller surfaces
  // 3xx/4xx). Never throws after retries except on exhausted transient
  // failures.
  async function post(url, body, opts) {
    const cfg = getConfig();
    const o = Object.assign({
      timeoutMs: cfg.net.timeoutMs,
      maxRetries: cfg.net.maxRetries,
      baseDelayMs: cfg.net.baseDelayMs,
      headers: { 'Content-Type': 'application/json' }
    }, opts || {});
    const maxRetries = Math.max(0, parseInt(o.maxRetries, 10) || 0);
    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: o.headers,
          body: typeof body === 'string' ? body : JSON.stringify(body),
          timeoutMs: o.timeoutMs
        });
        const retriable = res.status >= 500 || res.status === 429 || res.status === 408;
        if (res.ok || !retriable) return res;
        lastErr = new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
      }
      if (attempt < maxRetries) {
        await delay(o.baseDelayMs * Math.pow(2, attempt));
      }
    }
    throw (lastErr || new Error('request failed: ' + url));
  }

  async function postJSON(url, body, opts) {
    const res = await post(url, body, opts);
    return res.json();
  }

  // ---- API ----
  ns.Config = Config;
  ns.Net = {
    Config: Config,
    PROVIDER_DEFAULTS: PROVIDER_DEFAULTS,
    getConfig: getConfig,
    get: get,
    getJSON: getJSON,
    post: post,
    postJSON: postJSON,
    DEFAULTS: Config.net
  };
})(MMGR);
window.MMGR = MMGR;
