/* ============================================================
   My MaNaGeR — Client-side error surface (Phase 2)
   ------------------------------------------------------------
   A static-hosted SPA cannot ship logs to a server, so errors are
   captured client-side: the last 20 (timestamp + message + source
   action) persist in state.errorLog and are rendered in the
   Controls drawer. Hooks the window 'error' and
   'unhandledrejection' events at boot, and any module can record
   a deliberate, actionable entry via MMGR.Errors.log(msg, action).
   Never throws — the error surface must survive its own failures.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const MAX = 20;
  const U = ns.Utils;
  // Re-entrancy guard: logging must never recurse (an error thrown while
  // persisting the log would otherwise loop forever).
  let _busy = false;

  // ---- DIR-1b: opt-in remote error reporting (device-level slot) ----
  // Stored in localStorage (same family as mmgr_glass_mode / mmgr_sync_*),
  // NEVER in project state — an opt-in webhook URL must not travel in the
  // .json export. Off by default; zero network activity while off.
  const REPORT_KEY = 'mmgr_err_report';
  const WEBHOOK_KEY = 'mmgr_err_webhook';

  function getReportCfg() {
    let enabled = false;
    let url = '';
    try { enabled = localStorage.getItem(REPORT_KEY) === '1'; } catch (e) { /* ignored */ }
    try { url = (localStorage.getItem(WEBHOOK_KEY) || '').trim(); } catch (e) { /* ignored */ }
    return { enabled: enabled, url: url };
  }

  function setReportCfg(cfg) {
    try {
      if (cfg && typeof cfg.enabled === 'boolean') localStorage.setItem(REPORT_KEY, cfg.enabled ? '1' : '0');
      if (cfg && typeof cfg.url === 'string') localStorage.setItem(WEBHOOK_KEY, cfg.url.trim());
    } catch (e) { /* ignored */ }
  }

  // Fire-and-forget remote report. Routed through MMGR.Net's circuit-breaker
  // (the same module used for weather/AI) with maxRetries:0 — exactly ONE
  // POST attempt, no retry storm on a dead endpoint. Any failure degrades
  // silently to "still logged locally only"; never calls Errors.log() again
  // (that would re-enter and loop). https-only matches the deployed CSP
  // (connect-src https:), so an http:// webhook fails fast at the source
  // instead of being silently blocked downstream.
  async function _report(entry) {
    try {
      const cfg = getReportCfg();
      if (!cfg.enabled || !cfg.url) return;
      if (!/^https:\/\//i.test(cfg.url)) return;
      if (!ns.Net || typeof ns.Net.post !== 'function') return;
      await ns.Net.post(cfg.url, {
        app: 'My MaNaGeR',
        ts: entry.ts,
        action: entry.action || 'app',
        msg: entry.msg
      }, { maxRetries: 0 });
    } catch (e) { /* silent — the entry stays logged locally only */ }
  }

  // Plain-text line for the export path (DIR-1a Copy/Download). Shares the
  // same timestamp formatter as the drawer's render(), so the exported log
  // and the on-screen log can never drift apart.
  function formatEntry(en) {
    return '[' + fmtTs(en.ts) + '] [' + (en.action || 'app') + '] ' + en.msg;
  }

  function log(msg, action) {
    if (_busy) return;
    _busy = true;
    let entry = null;
    try {
      const s = ns.State.getState();
      if (!Array.isArray(s.errorLog)) s.errorLog = [];
      entry = {
        ts: new Date().toISOString(),
        msg: String(msg === undefined || msg === null ? 'unknown error' : msg).slice(0, 300),
        action: action || 'app'
      };
      s.errorLog.push(entry);
      if (s.errorLog.length > MAX) s.errorLog = s.errorLog.slice(s.errorLog.length - MAX);
      // Deliberate save(true) rather than updateState: updateState fires
      // change listeners + the streak touch on EVERY recorded error and could
      // re-enter the error path while persisting. The _busy guard already
      // stops recursion; a direct synchronous save keeps the log side-channel
      // invisible to the rest of the app.
      ns.State.save(true);
    } catch (e) { /* never throw from the error surface */ }
    _busy = false;
    // DIR-1b: the only hook that may leave this module. No-op when the
    // toggle is off (default) — the log() behavior above is unchanged.
    if (entry) _report(entry);
  }

  function clear() {
    try {
      ns.State.updateState(function(s) { s.errorLog = []; });
    } catch (e) { /* ignored */ }
    render();
  }

  function getLog() {
    const s = ns.State.getState();
    return (s && Array.isArray(s.errorLog)) ? s.errorLog : [];
  }

  function hookGlobals() {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('error', function(e) {
      log((e && e.message) || 'window error', 'global');
    });
    window.addEventListener('unhandledrejection', function(e) {
      const r = e && e.reason;
      log(r && r.message ? r.message : String(r === undefined || r === null ? 'unhandled rejection' : r), 'promise');
    });
  }

  function fmtTs(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // Renders into #errlog-body (Controls drawer). Zero inline styles —
  // classes come from css/mmgr.css (.errlog/.el-row/.el-ts/.el-act/...).
  function render() {
    const body = U.$('errlog-body');
    if (!body) return;
    const entries = getLog();
    if (!entries.length) {
      body.innerHTML = '<div class="el-empty">No client errors recorded.</div>';
      return;
    }
    body.innerHTML = entries.slice(0, MAX).map(function(en) {
      return '<div class="el-row">' +
        '<span class="el-ts">' + U.escapeHtml(fmtTs(en.ts)) + '</span>' +
        '<span class="el-act">' + U.escapeHtml(en.action || 'app') + '</span>' +
        '<span class="el-msg">' + U.escapeHtml(en.msg) + '</span>' +
        '</div>';
    }).join('');
  }

  // ---- API ----
  ns.Errors = {
    MAX: MAX,
    log: log,
    clear: clear,
    getLog: getLog,
    render: render,
    hookGlobals: hookGlobals,
    // DIR-1a
    formatEntry: formatEntry,
    // DIR-1b
    getReportCfg: getReportCfg,
    setReportCfg: setReportCfg
  };
})(MMGR);
window.MMGR = MMGR;
