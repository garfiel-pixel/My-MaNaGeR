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
    // MODEL-FALLBACK-LADDER (DIR-5 fast-follow): OpenAI + Anthropic now carry
    // the same ordered fallback lists as Gemini — 'model' first (preferred/
    // highest-quality), then 'fallbackModels' smaller/cheaper as safety nets.
    // Verified against provider docs on 2026-08-09 (same discipline as the
    // Gemini ladder): OpenAI — gpt-4o-mini remains active; gpt-5-mini and
    // gpt-5-nano are the active cheaper siblings (gpt-4.1-nano is deprecated
    // and was NOT used). Anthropic — claude-3-5-sonnet-latest ->
    // claude-3-5-haiku-latest -> claude-3-haiku.
    openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', fallbackModels: ['gpt-5-mini', 'gpt-5-nano'] },
    anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-latest', fallbackModels: ['claude-3-5-haiku-latest', 'claude-3-haiku'] },
    // BYO-AI-KEY-SESSION-ONLY-v1: Google Gemini joins the v1 provider set.
    // ANTHROPIC-CONNECTABLE fast-follow: Anthropic is now a full Connect-flow
    // provider too (vault whitelist + provider select + live probe), so the
    // claude ladder above is reachable from the UI, not just legacy config.
    //
    // GEMINI-MODEL-FALLBACK-LADDER (DIR-1): the Gemini provider now carries an
    // ordered fallback ladder — `model` first (preferred/highest-quality),
    // then `fallbackModels` from smaller/cheaper to last-resort safety net,
    // matching the semantics of Garfield's own Python fallback (big model
    // first, smaller ones as safety nets, never the reverse). Model IDs were
    // verified against the LIVE API on 2026-08-09 before hardcoding (DIR-1
    // verification_before_edit): gemini-2.5-flash and gemini-2.5-flash-lite
    // BOTH returned 404 "no longer available to new users" (the directive's
    // illustrative IDs are dead — using them would turn a rate-limit failure
    // into an instant 404, worse than doing nothing), while gemini-flash-latest
    // returned a real 200 generation on a quota-starved free key and is the
    // last-rung safety net. DIR-2: the endpoint below is the DEFAULT-model
    // URL; every ladder rung builds its own via geminiEndpointFor(modelId)
    // because the model name lives in the URL path.
    'google-gemini': {
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      model: 'gemini-2.0-flash',
      fallbackModels: ['gemini-2.0-flash-lite', 'gemini-flash-latest']
    }
  };

  // GEMINI-MODEL-FALLBACK-LADDER (DIR-2): the Gemini model name is embedded in
  // the endpoint URL path, so a fallback to a different model cannot reuse the
  // static `endpoint` string — the URL has to be built per attempted model.
  // This is the single builder both the direct call (mmgr-ai.js) and the
  // Worker relay (worker.js) use for whichever model is being tried.
  function geminiEndpointFor(modelId) {
    return 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':generateContent';
  }

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
        // GEMINI-MODEL-FALLBACK-LADDER (DIR-3): carry the HTTP status on the
        // thrown error so the AI ladder can tell capacity rejections (429 rate
        // limit / 503 overload) apart from everything else and fall back to a
        // smaller model ONLY on capacity, never on auth/config bugs.
        lastErr.status = res.status;
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
        // GEMINI-MODEL-FALLBACK-LADDER (DIR-3): carry the HTTP status on the
        // thrown error so the AI ladder can tell capacity rejections (429 rate
        // limit / 503 overload) apart from everything else and fall back to a
        // smaller model ONLY on capacity, never on auth/config bugs.
        lastErr.status = res.status;
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
    geminiEndpointFor: geminiEndpointFor,
    getConfig: getConfig,
    get: get,
    getJSON: getJSON,
    post: post,
    postJSON: postJSON,
    DEFAULTS: Config.net
  };
})(MMGR);
window.MMGR = MMGR;
