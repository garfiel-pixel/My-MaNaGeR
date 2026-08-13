/* ============================================================
   My MaNaGeR — Report Issue package (MASTER-ACTION-PLAN-v3-STRICT
   Rank 6.1, executed 2026-08-12)
   ------------------------------------------------------------
   Zero-network diagnostic export for static hosting. "Report
   Issue" packages a SANITIZED snapshot into a copyable /
   downloadable block:

     - app + schema version, generated timestamp, UA + viewport,
       theme
     - active panel id, feature flags (packs ON / OFF)
     - NON-SENSITIVE COUNTS only (tasks / issues / risks / budget
       lines / changes / meetings / decisions)
     - the client error-log slice (last 20, ts + action + msg)

   STRICTLY EXCLUDED by default (hard rule from the plan — the
   exported payload never includes budget dollar figures, risk
   descriptions, or personal names): the package is counts-only.
   An explicit per-report opt-in (Include project context, default
   OFF) adds project/charter name, task/risk/issue lists, and
   budget totals — still never AI keys, because only enumerated
   fields are ever read.

   Nothing is ever SENT anywhere — the user copies or downloads it
   themselves (offline-first / zero-server constraint intact).

   reportIssueText() is a PURE function (explicit inputs, no DOM)
   so the exclusion rules are statically testable — see
   tools/verify-report-issue.cjs. Depends only on ns.State /
   ns.Errors / ns.Utils, all consulted lazily and never required.
   ============================================================ */
(function(ns) {
  'use strict';

  // Stable pack order for the feature-flag line. Pack KEYS are schema-stable
  // (mmgr-render.js PACK_ORDER carries the same five); the order is copied
  // here so this module never needs the render module's DOM-bound API.
  const PACK_ORDER = ['schedule', 'money', 'governance', 'field', 'quality'];

  function readState() {
    try { return (ns.State && ns.State.getState) ? ns.State.getState() : {}; }
    catch (e) { return {}; }
  }
  function readErrors() {
    try { return (ns.Errors && ns.Errors.getLog) ? ns.Errors.getLog() : []; }
    catch (e) { return []; }
  }
  function fmtTs(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // PURE builder — explicit inputs, no DOM, harness-testable. opts:
  //   includeContext (bool), activePanel, viewport, theme, ua
  function reportIssueText(state, errorEntries, opts) {
    const o = opts || {};
    const include = !!o.includeContext;
    const s = state || {};
    const L = [];
    L.push('My MaNaGeR — Report Issue package');
    L.push('Generated: ' + new Date().toISOString());
    L.push('Schema version: ' + (s.schemaVersion === undefined || s.schemaVersion === null ? '?' : s.schemaVersion));
    if (o.ua || o.viewport) L.push('Environment: ' + (o.ua || '?') + (o.viewport ? ' | viewport ' + o.viewport : ''));
    if (o.theme) L.push('Theme: ' + o.theme);
    L.push('Active panel: ' + (o.activePanel || 'none'));
    const packs = s.packs || {};
    const on = PACK_ORDER.filter(function(p) { return packs[p] !== false; });
    const off = PACK_ORDER.filter(function(p) { return packs[p] === false; });
    L.push('Packs ON: ' + (on.length ? on.join(', ') : '(none)') + (off.length ? ' | OFF: ' + off.join(', ') : ''));
    L.push('Counts — tasks: ' + (s.tasks || []).length +
      ' | issues: ' + (s.issues || []).length +
      ' | risks: ' + (s.risks || []).length +
      ' | budget lines: ' + (s.budgetLines || []).length +
      ' | changes: ' + (s.changes || []).length +
      ' | meetings: ' + (s.meetings || []).length +
      ' | decisions: ' + (s.decisions || []).length);
    if (include) {
      const ch = s.charter || {};
      L.push('Project: ' + (ch.name || '(untitled)') + ' | Sponsor: ' + (ch.sponsor || '(none)'));
      L.push('Tasks: ' + ((s.tasks || []).map(function(t) {
        return (t.id || '?') + ' [' + (t.status || '') + '] ' + (t.name || '');
      }).join(' | ') || '(none)'));
      const planned = (s.budgetLines || []).reduce(function(n, l) { return n + (+l.planned || 0); }, 0);
      const actual = (s.budgetLines || []).reduce(function(n, l) { return n + (+l.actual || 0); }, 0);
      L.push('Budget: $' + Number(planned).toLocaleString() + ' planned / $' + Number(actual).toLocaleString() + ' actual');
      L.push('Risks: ' + ((s.risks || []).map(function(r) {
        return (r.description || '(untitled)') + (r.probability ? ' [' + r.probability + (r.impact ? '/' + r.impact : '') + ']' : '');
      }).join(' | ') || '(none)'));
      L.push('Issues: ' + ((s.issues || []).map(function(i) { return i.description || '(untitled)'; }).join(' | ') || '(none)'));
    } else {
      L.push('(Project context omitted — names and figures stay off the report unless "Include project context" is checked.)');
    }
    L.push('');
    const errs = Array.isArray(errorEntries) ? errorEntries : [];
    L.push('Error log (' + errs.length + '):');
    if (errs.length) {
      errs.forEach(function(en) {
        L.push('[' + fmtTs(en && en.ts) + '] [' + ((en && en.action) || 'app') + '] ' + ((en && en.msg) || ''));
      });
    } else {
      L.push('(none)');
    }
    return L.join('\n');
  }

  // Live builder — reads current state + error log + DOM context. Never
  // throws: every DOM/state read is guarded so a partial page can still
  // produce the pure fields.
  function buildPackage(includeContext) {
    const s = readState();
    const errs = readErrors();
    let activePanel = 'none';
    let viewport = '';
    let theme = '';
    let ua = '';
    try {
      const ap = document.querySelector('.panel.active');
      if (ap) activePanel = ap.id.replace('panel-', '');
      viewport = window.innerWidth + 'x' + window.innerHeight;
      theme = (document.documentElement && document.documentElement.getAttribute('data-theme')) || 'default';
      if (document.body && document.body.classList.contains('dark-mode')) theme += ' (dark)';
      ua = navigator.userAgent;
    } catch (e) { /* DOM unavailable — keep the pure fields */ }
    return reportIssueText(s, errs, {
      includeContext: includeContext, activePanel: activePanel,
      viewport: viewport, theme: theme, ua: ua
    });
  }

  // Copy the package to the clipboard. Uses Utils.copyToClipboard (the same
  // clipboard-API + execCommand fallback the rest of the app uses); resolves
  // false when the helper is unavailable, never throws.
  async function copyPackage(includeContext) {
    try {
      const text = buildPackage(includeContext);
      if (!ns.Utils || typeof ns.Utils.copyToClipboard !== 'function') return false;
      return await ns.Utils.copyToClipboard(text);
    } catch (e) { return false; }
  }

  // Download the package as a .txt file. Returns true when a download was
  // triggered; never throws.
  function downloadPackage(includeContext) {
    try {
      const text = buildPackage(includeContext);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mymanager-report-issue-' + new Date().toISOString().slice(0, 10) + '.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 400);
      return true;
    } catch (e) { return false; }
  }

  ns.Report = {
    PACK_ORDER: PACK_ORDER,
    reportIssueText: reportIssueText,
    buildPackage: buildPackage,
    copyPackage: copyPackage,
    downloadPackage: downloadPackage
  };
})(window.MMGR || (window.MMGR = {}));
