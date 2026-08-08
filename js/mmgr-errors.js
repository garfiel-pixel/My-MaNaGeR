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

  function log(msg, action) {
    if (_busy) return;
    _busy = true;
    try {
      const s = ns.State.getState();
      if (!Array.isArray(s.errorLog)) s.errorLog = [];
      s.errorLog.push({
        ts: new Date().toISOString(),
        msg: String(msg === undefined || msg === null ? 'unknown error' : msg).slice(0, 300),
        action: action || 'app'
      });
      if (s.errorLog.length > MAX) s.errorLog = s.errorLog.slice(s.errorLog.length - MAX);
      // Deliberate save(true) rather than updateState: updateState fires
      // change listeners + the streak touch on EVERY recorded error and could
      // re-enter the error path while persisting. The _busy guard already
      // stops recursion; a direct synchronous save keeps the log side-channel
      // invisible to the rest of the app.
      ns.State.save(true);
    } catch (e) { /* never throw from the error surface */ }
    _busy = false;
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
    hookGlobals: hookGlobals
  };
})(MMGR);
window.MMGR = MMGR;
