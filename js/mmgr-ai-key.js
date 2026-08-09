/* ============================================================
   My MaNaGeR — BYO AI Key session vault (BYO-AI-KEY-SESSION-ONLY-v1 STEP-1)
   ------------------------------------------------------------
   The ONLY home of the user's bring-your-own AI API key.

   Rules that are load-bearing (do not relax):
   - Persistence is sessionStorage ONLY, under the fixed key `mmgr_byo_ai`,
     as JSON { provider, key }. Forbidden everywhere else: localStorage,
     indexedDB, cookies, Worker secrets, project state, exports, logs.
   - Lifetime is the tab/session. Close the tab or hit Clear -> the entry is
     gone; the next visit requires pasting the key again.
   - Empty/whitespace keys are rejected by setKey() (throws).
   - The key must never be placed in a URL query, history, or postMessage
     payload — this module only ever reads/writes its own sessionStorage slot.
   - Provider set is locked to providers_v1: openai, google-gemini.

   API: setKey(provider, apiKey), getKey(), getProvider(), clearKey(),
   isConnected(). Exposed as MMGR.AiKey (loaded before mmgr-ai.js).
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  // Locked sessionStorage slot name (spec: architecture_lock).
  const KEY_NAME = 'mmgr_byo_ai';

  // providers_v1 — the only providers the Connect flow may offer.
  const PROVIDERS = ['openai', 'google-gemini'];

  // Read + validate the vault. Returns { provider, key } or null.
  // Any malformed/absent entry is treated as disconnected (never throws).
  function read() {
    let raw;
    try { raw = sessionStorage.getItem(KEY_NAME); } catch (e) { return null; }
    if (!raw) return null;
    let data;
    try { data = JSON.parse(raw); } catch (e) { return null; }
    if (!data || typeof data !== 'object') return null;
    if (typeof data.key !== 'string' || !data.key.trim()) return null;
    return {
      provider: PROVIDERS.indexOf(data.provider) >= 0 ? data.provider : 'openai',
      key: data.key
    };
  }

  // Store a key for THIS session only. Rejects empty/whitespace keys.
  // Returns true on success; throws on invalid input.
  function setKey(provider, apiKey) {
    const p = PROVIDERS.indexOf(provider) >= 0 ? provider : 'openai';
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('API key cannot be empty');
    }
    try {
      sessionStorage.setItem(KEY_NAME, JSON.stringify({ provider: p, key: apiKey.trim() }));
    } catch (e) {
      throw new Error('could not store key for this session');
    }
    return true;
  }

  function getKey() {
    const d = read();
    return d ? d.key : null;
  }

  function getProvider() {
    const d = read();
    return d ? d.provider : null;
  }

  function clearKey() {
    try { sessionStorage.removeItem(KEY_NAME); } catch (e) { /* noop */ }
  }

  function isConnected() {
    return read() !== null;
  }

  ns.AiKey = {
    KEY_NAME: KEY_NAME,
    PROVIDERS: PROVIDERS,
    setKey: setKey,
    getKey: getKey,
    getProvider: getProvider,
    clearKey: clearKey,
    isConnected: isConnected
  };
})(MMGR);
window.MMGR = MMGR;
