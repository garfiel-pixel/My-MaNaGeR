/* ============================================================
   My MaNaGeR — AI Assistant Window + Model Wiring (Rank 2.3)
   ------------------------------------------------------------
   Floating entry point (#ai-fab) opening a modal with:
     (a) one-click preset prompts (the existing prompt generators),
     (b) a free-form question box,
     (c) an automatic context dump of live project state,
     (d) Rank 2.3: a real submit() seam with two tiers:
           Tier A — 'local': zero-key, in-browser, deterministic
             engine. Every line of its output traces to a real
             state field (the `trace` array on each output), so
             zero-fabrication is guaranteed BY CONSTRUCTION —
             it never invents a date, amount, or name.
             Constraint-satisfying redesign note: a WebGPU LLM
             would require bundling a multi-hundred-MB model or
             a CDN fetch, both of which violate the offline-first
             + zero-server + CSP constraints this app ships under
             (same call that kept whisper's model in-repo but
             rejected cloud diarization). The seam below is
             provider-shaped so a WebGPU runtime can be dropped
             into runLocal() later without touching the UI.
           Tier B — 'cloud': BYO key (OpenAI or Anthropic), same
             submit() seam, routed through MMGR.Net.post() with
             the exact circuit-breaker discipline weather uses
             (timeout, backoff, 5xx-retry). A failed cloud call
             degrades loudly but never breaks the app.
   Switching tiers = a settings toggle only (state.config.ai.tier)
   — no schema or architecture change, per Rank 2.3's exit gate.

   Presets are now AGENT-STYLE: one click generates AND writes the
   structured result back into state.aiOutputs[<type>] (unified
   state only — the .json export carries it). The old copy-first
   flow remains for the 'off' tier.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // Readable labels for the existing prompt generators.
  const PRESET_LABELS = {
    report: 'Report Writing',
    forecast: 'Forecasting',
    risk: 'Risk Analysis',
    digest: 'Weekly Digest',
    health: 'Health Summary',
    audit: 'Schedule Audit',
    visual: 'Visual Output',
    change: 'Change Impact',
    client: 'Client Update',
    charterdates: 'Charter Dates',
    gendates: 'Generate Dates',
    daily: 'Daily Field Report',
    claim: 'Claim Pack'
  };

  // Rank 2.3 tier metadata — shown in the AI window settings row.
  const TIERS = {
    off:   { label: 'Off — copy-first only' },
    local: { label: 'Local (zero-key, offline, zero-fabrication)' },
    cloud: { label: 'Cloud (BYO key, OpenAI / Anthropic)' }
  };

  function toast(msg, type) {
    if (ns.App && ns.App.showToast) ns.App.showToast(msg, type || 'ok');
  }

  function open() {
    const modal = U.$('ai-win');
    if (!modal) return;
    const chips = U.$('ai-presets');
    if (chips && !chips.dataset.filled) {
      const types = (ns.Prompts && ns.Prompts.list) ? ns.Prompts.list() : [];
      chips.innerHTML = types.map(t =>
        '<span class="ai-chip-cell">' +
        '<button class="ai-chip" data-action="aiPreset" data-type="' + U.escapeHtml(t) + '">' +
        U.escapeHtml(PRESET_LABELS[t] || t) + '</button>' +
        '<button class="ai-run" data-action="aiRunPreset" data-type="' + U.escapeHtml(t) + '" title="One-click: generate with AI and save to project state">' +
        '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg></button>' +
        '</span>'
      ).join('') || '<span class="txt-sl">No presets available.</span>';
      chips.dataset.filled = '1';
    }
    syncSettingsUI();
    modal.classList.add('open');
  }

  function close() {
    const modal = U.$('ai-win');
    if (modal) modal.classList.remove('open');
  }

  function preset(type) {
    const q = U.$('ai-q');
    if (!q) return;
    q.value = (ns.Prompts && ns.Prompts.generate) ? ns.Prompts.generate(type) : '';
    toast('Preset prompt loaded — Run it with AI, edit, or copy.');
  }

  function clear() {
    const q = U.$('ai-q');
    const c = U.$('ai-ctx');
    const o = U.$('ai-out');
    if (q) q.value = '';
    if (c) c.value = '';
    if (o) o.value = '';
    toast('Cleared.');
  }

  // ============================================================
  // CONTEXT_SCHEMA — the exact shape of the automatic context dump
  // ------------------------------------------------------------
  // Rank 2.3: buildContext() output is the grounding payload BOTH
  // tiers consume. The dump is flat Markdown lines grouped by
  // section, and the cloud system prompt forbids using anything
  // outside it — so traceability to state fields is the contract.
  const CONTEXT_SCHEMA = {
    sections: ['PROJECT', 'HEALTH SCORE', 'EVM (Earned Value)', 'TIMELINE', 'CRITICAL PATH', 'TOP RISKS / ISSUES', 'WEATHER'],
    format: '## <SECTION>\n- <key>: <value>',
    keysBySection: {
      'PROJECT': ['Name', 'Methodology', 'Sponsor', 'Objective', 'Target completion', 'Budget envelope', 'Constraints', 'Assumptions'],
      'HEALTH SCORE': ['Score', 'Status', 'Tasks'],
      'EVM (Earned Value)': ['SPI', 'CPI', 'EV / PV / AC'],
      'TIMELINE': ['Target vs planned finish', 'Overdue tasks'],
      'CRITICAL PATH': ['Tasks on zero float'],
      'TOP RISKS / ISSUES': ['Open risks', 'Live issues'],
      'WEATHER': ['Site', 'Weather risk days', 'Weather delay days logged']
    }
  };

  // ---- Automatic context dump of live state ----
  // Pure client-side read of the state tree. Every section is defensive
  // (try/catch) so one missing field can never blank the whole dump.
  function buildContext(state) {
    const s = state || ((ns.State && ns.State.getState) ? ns.State.getState() : {});
    const L = [];
    const sec = (title) => L.push('## ' + title);
    const line = (k, v) => L.push('- ' + k + ': ' + (v === undefined || v === null || v === '' ? '—' : v));
    // NOTE: `f` is hoisted to function scope on purpose. In the pre-refactor
    // version it lived inside the PROJECT try-block, so the TIMELINE section
    // hit a ReferenceError on `(f && f.targetCompletion)` and silently
    // rendered as an empty header. Hoisting makes TIMELINE actually render.
    const f = s.charter || {};

    try {
      sec('PROJECT');
      line('Name', s.projectName || f.name);
      line('Methodology', s.methodology);
      line('Sponsor', f.sponsor);
      line('Objective', f.objective);
      line('Target completion', f.targetCompletion || f.end);
      line('Budget envelope', f.budgetEnvelope ? '$' + Number(f.budgetEnvelope).toLocaleString() : null);
      line('Constraints', f.constraints);
      line('Assumptions', f.assumptions);
    } catch (e) {}

    try {
      sec('HEALTH SCORE');
      if (ns.Health && ns.Health.get) {
        const h = ns.Health.get();
        if (h && h.score !== null && h.score !== undefined) {
          line('Score', h.score + '/100');
          const label = h.score >= 70 ? 'Healthy' : h.score >= 40 ? 'Needs Attention' : 'At Risk';
          line('Status', label);
        } else {
          line('Score', 'not enough data yet');
        }
      }
      const tasks = s.tasks || [];
      line('Tasks', tasks.length + ' total · ' + tasks.filter(t => t.status === 'completed').length + ' complete');
    } catch (e) {}

    try {
      sec('EVM (Earned Value)');
      if (ns.Evm && ns.Evm.compute) {
        const e = ns.Evm.compute(s);
        if (e) {
          line('SPI', e.spi !== undefined ? e.spi.toFixed(2) : null);
          line('CPI', e.cpi !== undefined ? e.cpi.toFixed(2) : null);
          line('EV / PV / AC', [e.ev, e.pv, e.ac].map(v => v !== undefined && v !== null ? '$' + Number(v).toLocaleString() : null).join(' / '));
        } else {
          line('Metrics', 'insufficient schedule/budget data');
        }
      }
    } catch (e) {}

    try {
      sec('TIMELINE');
      const tgt = (f && f.targetCompletion) || (f && f.end) || null;
      const dated = (s.tasks || []).filter(t => t.endDate);
      if (tgt && dated.length) {
        const projected = new Date(Math.max.apply(null, dated.map(t => new Date(t.endDate).getTime())));
        const over = Math.round((projected.getTime() - new Date(tgt).getTime()) / 86400000);
        line('Target vs planned finish', tgt + ' → ' + projected.toISOString().slice(0, 10) + ' (' + (over > 0 ? '+' + over + 'd over' : over < 0 ? Math.abs(over) + 'd ahead' : 'on target') + ')');
      } else {
        line('Timeline', 'no target completion date and/or no dated tasks yet');
      }
      const overdue = dated.filter(t => t.status !== 'completed' && new Date(t.endDate) < new Date());
      line('Overdue tasks', overdue.length);
    } catch (e) {}

    try {
      sec('CRITICAL PATH');
      const crit = (s.tasks || []).filter(t => t.totalFloat === 0 && t.status !== 'completed');
      line('Tasks on zero float', crit.length ? crit.slice(0, 8).map(t => t.name).join('; ') : 'none identified (run Cascade Dates)');
    } catch (e) {}

    try {
      sec('TOP RISKS / ISSUES');
      const risks = (s.risks || []).filter(r => !r.issueId);
      const high = risks.filter(r => /high/i.test(r.probability || '') || /high/i.test(r.impact || ''));
      line('Open risks', risks.length + (high.length ? ' (' + high.length + ' high) ' : '') + (high.length ? high.slice(0, 5).map(r => r.description).join('; ') : ''));
      const issues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
      line('Live issues', issues.length ? issues.slice(0, 5).map(i => i.description).join('; ') : 'none');
    } catch (e) {}

    try {
      sec('WEATHER');
      if (s.sitePlace) line('Site', s.sitePlace + ' (Open-Meteo' + (s.wxCache && s.wxCache.days && s.wxCache.days.length ? ', cached ' + s.wxCache.days.length + '-day forecast' : ', no forecast cached') + ')');
      else line('Site', 'no location set — regional weather windows only');
      if (ns.Forecast && ns.Forecast.riskDays) {
        const rd = ns.Forecast.riskDays(s) || [];
        line('Weather risk days', rd.length ? rd.slice(0, 5).map(d => d.date + ' (' + d.alerts.join(', ') + ')').join('; ') : 'none in forecast');
      }
      line('Weather delay days logged', (s.weatherLog || []).length);
    } catch (e) {}

    return L.join('\n');
  }

  function attachContext() {
    const ctx = U.$('ai-ctx');
    if (!ctx) return;
    const text = buildContext();
    ctx.value = text;
    toast('Project context attached (' + text.split('\n').length + ' lines).');
  }

  // ---- Copy prompt + context (unchanged copy-first flow) ----
  function copy() {
    const q = U.$('ai-q');
    const c = U.$('ai-ctx');
    let txt = (q && q.value) || '';
    const ctx = (c && c.value) || '';
    if (ctx) txt += (txt ? '\n\n==== PROJECT CONTEXT ====\n' : '==== PROJECT CONTEXT ====\n') + ctx;
    if (!txt.trim()) { toast('Nothing to copy yet — pick a preset or type a question.', 'err'); return; }
    U.copyToClipboard(txt);
    toast('Prompt + context copied — paste into your AI tool.');
  }

  // ============================================================
  // RANK 2.3 — CONFIG + SUBMIT() SEAM
  // ============================================================

  // Read the merged AI config (state.config.ai over Config.ai defaults).
  function getAiCfg() {
    const cfg = (ns.Net && ns.Net.getConfig) ? ns.Net.getConfig() : { ai: {} };
    return Object.assign({}, ns.Config && ns.Config.ai ? ns.Config.ai : {}, cfg.ai || {});
  }

  // Settings toggle — writes into state.config.ai (per-project, portable,
  // merged over defaults by Net.getConfig). No schema change.
  function setAiCfg(patch) {
    ns.State.updateState(function(s) {
      if (!s.config || typeof s.config !== 'object' || Array.isArray(s.config)) s.config = {};
      if (!s.config.ai || typeof s.config.ai !== 'object' || Array.isArray(s.config.ai)) s.config.ai = {};
      Object.keys(patch).forEach(function(k) { s.config.ai[k] = patch[k]; });
    });
  }

  // Sync the AI window's tier/keys inputs from state.
  function syncSettingsUI() {
    const cfg = getAiCfg();
    const set = (id, val) => { const el = U.$(id); if (el && el.value !== val) el.value = val; };
    set('ai-tier', cfg.tier || 'off');
    set('ai-provider', cfg.provider || 'openai');
    set('ai-endpoint', cfg.endpoint || '');
    set('ai-model', cfg.model || '');
    set('ai-key', cfg.apiKey || '');
    const cloudRow = U.$('ai-cfg-cloud');
    if (cloudRow) cloudRow.classList.toggle('is-hide', (cfg.tier || 'off') !== 'cloud');
  }

  // ---- Tier A: local zero-key engine ----
  // Deterministic. Output is built ONLY from state fields; the returned
  // `trace` array names the exact fields each line came from, so the
  // Rank 2.3 acceptance gate ("zero-fabrication, traceable line-by-line")
  // is satisfied by construction — there is no generator randomness to
  // audit. Free-form lookups are answered by a small intent matcher;
  // anything it can't ground is answered honestly ("not answerable
  // locally — switch to Cloud tier").
  const TRACE = { fields: [] };

  function _t(field) { TRACE.fields.push(field); }

  function fmt$(n) {
    return '$' + Number(n || 0).toLocaleString();
  }

  function localLookup(q, s) {
    TRACE.fields = [];
    const text = String(q || '');
    const lower = text.toLowerCase();
    const tasks = s.tasks || [];
    const done = tasks.filter(t => t.status === 'completed').length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const out = [];

    if (/completion|percent|progress|how (much|many).*done|status/.test(lower)) {
      _t('tasks[].status');
      out.push('Completion: ' + pct + '% (' + done + ' of ' + tasks.length + ' tasks complete).');
    }
    if (/overdue|behind|late/.test(lower)) {
      const od = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed');
      _t('tasks[].endDate'); _t('tasks[].status');
      out.push('Overdue: ' + od.length + (od.length ? ' — ' + od.slice(0, 5).map(t => t.name + ' (due ' + t.endDate + ')').join('; ') : '.'));
    }
    if (/budget|cost|spend/.test(lower)) {
      const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
      _t('budgetLines[].planned'); _t('budgetLines[].actual'); _t('budgetEnvelope');
      out.push('Budget: ' + fmt$(actual) + ' actual vs ' + fmt$(planned) + ' planned (envelope ' + fmt$(s.budgetEnvelope) + ').');
    }
    if (/risk/.test(lower)) {
      const high = (s.risks || []).filter(r => !r.issueId && (/high/i.test(r.probability || '') || /high/i.test(r.impact || '')));
      _t('risks[].probability'); _t('risks[].impact'); _t('risks[].description');
      out.push('Open risks: ' + (s.risks || []).length + ' (' + high.length + ' high).' + (high.length ? ' ' + high.slice(0, 5).map(r => r.description).join('; ') : ''));
    }
    if (/issue/.test(lower)) {
      const live = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
      _t('issues[].status'); _t('issues[].description');
      out.push('Live issues: ' + live.length + (live.length ? ' — ' + live.slice(0, 5).map(i => i.description).join('; ') : '.'));
    }
    if (/critical|float|path/.test(lower)) {
      const crit = tasks.filter(t => t.totalFloat === 0 && t.status !== 'completed');
      _t('tasks[].totalFloat'); _t('tasks[].status');
      out.push('Critical path: ' + (crit.length ? crit.map(t => t.name).join(' → ') : 'none identified (run Cascade Dates).'));
    }
    if (/evm|earned|spi|cpi|variance/.test(lower) && ns.Evm && ns.Evm.compute) {
      const e = ns.Evm.compute(s);
      _t('EVM.compute(s)');
      out.push(e ? 'EVM: SPI ' + e.spi.toFixed(2) + ', CPI ' + e.cpi.toFixed(2) + ', EV ' + fmt$(e.ev) + ' / PV ' + fmt$(e.pv) + ' / AC ' + fmt$(e.ac) + '.' : 'EVM: insufficient schedule/budget data.');
    }
    if (/weather|delay/.test(lower) && ns.Forecast && ns.Forecast.riskDays) {
      const rd = ns.Forecast.riskDays(s) || [];
      _t('weatherLog'); _t('wxCache');
      out.push('Weather: ' + (s.weatherLog || []).length + ' delay day(s) logged' + (rd.length ? '; risk days: ' + rd.slice(0, 3).map(d => d.date).join(', ') : '') + '.');
    }

    if (!out.length) {
      return {
        ok: false,
        error: 'This question needs reasoning beyond local lookup. Run it on the Cloud tier (Settings ▸ AI Engine), or copy the prompt + context into your AI tool.',
        tier: 'local'
      };
    }
    return { ok: true, tier: 'local', model: 'local-state-engine', text: out.join('\n'), trace: TRACE.fields.slice() };
  }

  // Per-preset structured builders for the local tier. Each returns
  // { text, trace } where trace lists the state fields consumed.
  const LOCAL_BUILDERS = {
    digest: function(s) {
      TRACE.fields = [];
      if (!ns.Digest) return { text: 'Digest engine not loaded.', trace: [] };
      const d = ns.Digest.computeDigest(s);
      _t('Digest.computeDigest(s) — digestSnapshot/baseline diff');
      return { text: ns.Digest.buildDigestText(d), trace: TRACE.fields.slice() };
    },
    health: function(s) {
      TRACE.fields = [];
      let text = 'HEALTH SUMMARY\n';
      if (ns.Health && ns.Health.get) {
        const h = ns.Health.get();
        _t('Health.get()');
        if (h && h.score !== null && h.score !== undefined) {
          const label = h.score >= 70 ? 'Healthy' : h.score >= 40 ? 'Needs Attention' : 'At Risk';
          text += 'Overall: ' + h.score + '/100 (' + label + ').\n';
        }
      }
      const tasks = s.tasks || [];
      const bl = tasks.filter(t => t.status === 'blocked').length;
      const od = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
      const ip = tasks.filter(t => t.status === 'inprogress').length;
      _t('tasks[].status'); _t('tasks[].endDate');
      text += 'In progress: ' + ip + ' | Blocked: ' + bl + ' | Overdue: ' + od + '\n';
      const live = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
      _t('issues[].status');
      text += 'Live issues: ' + live.length + '\n';
      const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
      _t('budgetLines[].planned'); _t('budgetLines[].actual');
      text += 'Budget: ' + fmt$(actual) + ' spent of ' + fmt$(planned) + ' planned.';
      return { text: text, trace: TRACE.fields.slice() };
    },
    forecast: function(s) {
      TRACE.fields = [];
      let text = 'FORECAST\n';
      let proj = null;
      const dated = (s.tasks || []).filter(t => t.endDate);
      const tgt = (s.charter && (s.charter.targetCompletion || s.charter.end)) || null;
      if (dated.length) {
        proj = new Date(Math.max.apply(null, dated.map(t => new Date(t.endDate).getTime())));
        _t('tasks[].endDate');
      }
      if (tgt && proj) {
        const over = Math.round((proj - new Date(tgt)) / 86400000);
        _t('charter.targetCompletion');
        text += 'Projected finish: ' + proj.toISOString().slice(0, 10) + ' vs target ' + tgt + ' (' + (over > 0 ? '+' + over + 'd over' : over < 0 ? Math.abs(over) + 'd ahead' : 'on target') + ').\n';
      } else {
        text += 'Projected finish: cannot compute — set a target completion and dated tasks.\n';
      }
      if (ns.Evm && ns.Evm.compute) {
        const e = ns.Evm.compute(s);
        _t('EVM.compute(s)');
        if (e && e.cpi) text += 'Burn rate (CPI): ' + e.cpi.toFixed(2) + ' — EAC trend ' + (e.cpi < 1 ? 'over budget' : 'at/below budget') + '.\n';
      }
      const wx = (s.weatherLog || []).length;
      _t('weatherLog');
      text += 'Weather delay days logged: ' + wx + '.';
      return { text: text, trace: TRACE.fields.slice() };
    },
    report: function(s) {
      TRACE.fields = [];
      const tasks = s.tasks || [];
      const done = tasks.filter(t => t.status === 'completed').length;
      const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
      const od = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed');
      const bl = tasks.filter(t => t.status === 'blocked');
      const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
      const high = (s.risks || []).filter(r => !r.issueId && (/high/i.test(r.probability || '') || /high/i.test(r.impact || '')));
      const live = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
      _t('charter.name'); _t('tasks[].status'); _t('tasks[].endDate'); _t('budgetLines[].planned');
      _t('budgetLines[].actual'); _t('risks[].probability'); _t('risks[].impact'); _t('issues[].status');
      const L = [];
      L.push('PROJECT STATUS REPORT — ' + ((s.charter && s.charter.name) || s.projectName || 'Project'));
      L.push('Completion: ' + pct + '% (' + done + '/' + tasks.length + ' tasks). Overdue: ' + od.length + '. Blocked: ' + bl.length + '.');
      L.push('Budget: ' + fmt$(actual) + ' actual / ' + fmt$(planned) + ' planned (envelope ' + fmt$(s.budgetEnvelope) + ').');
      L.push('Risks: ' + (s.risks || []).length + ' open (' + high.length + ' high). Live issues: ' + live.length + '.');
      if (od.length) L.push('Needs attention: ' + od.slice(0, 5).map(t => t.name + ' (due ' + t.endDate + ')').join('; '));
      if (bl.length) L.push('Blocked: ' + bl.slice(0, 5).map(t => t.name).join('; '));
      return { text: L.join('\n'), trace: TRACE.fields.slice() };
    },
    risk: function(s) {
      TRACE.fields = [];
      const risks = (s.risks || []).filter(r => !r.issueId);
      _t('risks[].description'); _t('risks[].probability'); _t('risks[].impact');
      const L = ['RISK REGISTER — ranked by probability × impact'];
      const score = r => ({ Low: 1, low: 1, Medium: 2, medium: 2, High: 3, high: 3 }[(r.probability || '')] || 1) * ({ Low: 1, low: 1, Medium: 2, medium: 2, High: 3, high: 3 }[(r.impact || '')] || 1);
      const sorted = risks.slice().sort((a, b) => score(b) - score(a));
      sorted.forEach(r => L.push('- [' + (score(r) >= 6 ? 'HIGH' : score(r) >= 3 ? 'MED' : 'LOW') + '] ' + (r.description || '(untitled)') + ' | P:' + (r.probability || '—') + ' I:' + (r.impact || '—') + (r.mitigation ? ' | Mitigation: ' + r.mitigation : '')));
      if (!sorted.length) L.push('(no open risks)');
      return { text: L.join('\n'), trace: TRACE.fields.slice() };
    },
    audit: function(s) {
      TRACE.fields = [];
      const tasks = s.tasks || [];
      const issues = [];
      tasks.forEach(t => {
        if (t.startDate && t.endDate && t.startDate > t.endDate) issues.push('Task ' + t.id + ' (' + t.name + '): end before start.');
        if (t.parentId) {
          const p = tasks.find(x => x.id === t.parentId);
          if (p && p.startDate && t.startDate && p.startDate > t.startDate) issues.push('Task ' + t.id + ' starts before parent ' + p.id + '.');
          if (p && p.endDate && t.endDate && t.endDate > p.endDate) issues.push('Task ' + t.id + ' ends after parent ' + p.id + '.');
        }
        (t.predecessors || []).forEach(pid => {
          const pred = tasks.find(x => x.id === pid);
          if (pred && pred.endDate && t.startDate && pred.endDate > t.startDate) issues.push('Task ' + t.id + ' starts before predecessor ' + pid + ' finishes.');
        });
      });
      _t('tasks[].startDate'); _t('tasks[].endDate'); _t('tasks[].predecessors'); _t('tasks[].parentId');
      return { text: 'SCHEDULE LOGIC AUDIT\n' + (issues.length ? issues.map(i => '- ' + i).join('\n') : '(no date-logic issues found)'), trace: TRACE.fields.slice() };
    },
    change: function(s) {
      TRACE.fields = [];
      const pending = (s.changes || []).filter(c => c.status === 'submitted' || c.status === 'review');
      _t('changes[].status'); _t('changes[].title'); _t('changes[].schedImpact'); _t('changes[].costImpact');
      const L = ['CHANGE IMPACT — pending requests'];
      pending.forEach(c => L.push('- ' + (c.title || '(untitled)') + ' | Sched: ' + (c.schedImpact || '—') + ' | Cost: ' + (c.costImpact || '—') + ' | ' + c.status));
      if (!pending.length) L.push('(no pending change requests)');
      return { text: L.join('\n'), trace: TRACE.fields.slice() };
    },
    client: function(s) {
      TRACE.fields = [];
      const tasks = s.tasks || [];
      const done = tasks.filter(t => t.status === 'completed').length;
      const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
      _t('tasks[].status'); _t('charter.name');
      return {
        text: 'CLIENT UPDATE — ' + ((s.charter && s.charter.name) || s.projectName || 'Project') + '\nCompletion: ' + pct + '% (' + done + ' of ' + tasks.length + ' tasks).\nOverall: ' + (pct >= 70 ? 'On track.' : pct >= 40 ? 'Progressing — minor concerns.' : 'Early stage — attention needed.'),
        trace: TRACE.fields.slice()
      };
    },
    claim: function(s) {
      TRACE.fields = [];
      const L = ['CLAIM PACK EVIDENCE'];
      if (ns.Claim && ns.Claim.computeSlips) {
        const slips = ns.Claim.computeSlips(s) || [];
        _t('Claim.computeSlips(s)');
        if (slips.length) slips.forEach(x => L.push('- Slip: ' + (x.taskName || x.taskId) + ' ' + x.days + 'd (cause: ' + (x.cause || 'unknown') + ')'));
        else L.push('- No schedule slips detected.');
      }
      if (ns.Claim && ns.Claim.ldRollup) {
        const ld = ns.Claim.ldRollup(s);
        _t('Claim.ldRollup(s)');
        if (ld) L.push('- LD exposure: ' + fmt$(ld.incurredLd || 0) + ' incurred / ' + fmt$(ld.avoidedLd || 0) + ' defensible.');
      }
      L.push('- Weather delay days logged: ' + (s.weatherLog || []).length + '.');
      _t('weatherLog');
      return { text: L.join('\n'), trace: TRACE.fields.slice() };
    },
    daily: function(s) {
      TRACE.fields = [];
      const tasks = s.tasks || [];
      const bl = tasks.filter(t => t.status === 'blocked');
      const crit = tasks.filter(t => t.totalFloat === 0 && t.status !== 'completed');
      _t('tasks[].status'); _t('tasks[].totalFloat');
      const L = ['DAILY FIELD DIGEST'];
      L.push('Blocked: ' + (bl.length ? bl.map(t => t.name + (t.notes ? ' — ' + t.notes : '')).join('; ') : 'none'));
      L.push('Critical: ' + (crit.length ? crit.map(t => t.name).join(', ') : 'none'));
      return { text: L.join('\n'), trace: TRACE.fields.slice() };
    }
  };

  // Local fallback: honest "can't do this locally" answer.
  function localUnavailable() {
    return {
      ok: false,
      error: 'Local tier has no generator for this preset — run it on the Cloud tier instead.',
      tier: 'local'
    };
  }

  async function runLocal(prompt, type) {
    const s = ns.State.getState();
    if (type && LOCAL_BUILDERS[type]) {
      const built = LOCAL_BUILDERS[type](s);
      // Builders return { text, trace } — normalize to the full result shape.
      return { ok: true, tier: 'local', model: 'local-state-engine', text: built.text, trace: built.trace || [] };
    }
    if (type) return localUnavailable();
    return localLookup(prompt, s);
  }

  // ---- Tier B: cloud call (OpenAI or Anthropic), circuit-broken ----
  const CLOUD_SYSTEM_PROMPT =
    'You are an assistant grounded ONLY in the project data below. Use ONLY that data — never invent dates, amounts, names, or facts. If a requested detail is not present in the data, say "not in data" explicitly. Keep every claim traceable to a line of the provided context.';

  async function runCloud(prompt, ctx, cfg) {
    const provider = (cfg.provider === 'anthropic') ? 'anthropic' : 'openai';
    const def = (ns.Net && ns.Net.PROVIDER_DEFAULTS) ? ns.Net.PROVIDER_DEFAULTS[provider] : {};
    const endpoint = cfg.endpoint || def.endpoint;
    const model = cfg.model || def.model;
    if (!endpoint) throw new Error('no AI endpoint configured');
    if (!cfg.apiKey) throw new Error('no API key configured for cloud tier');
    const userContent = (prompt || '') + (ctx ? '\n\n==== PROJECT CONTEXT (grounding only) ====\n' + ctx : '');
    let res;
    if (provider === 'anthropic') {
      res = await ns.Net.post(endpoint, {
        model: model,
        max_tokens: 2048,
        system: CLOUD_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      }, { headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' } });
    } else {
      res = await ns.Net.post(endpoint, {
        model: model,
        messages: [
          { role: 'system', content: CLOUD_SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ]
      }, { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey } });
    }
    if (!res.ok) throw new Error('AI endpoint HTTP ' + res.status);
    const data = await res.json();
    let text = null;
    if (provider === 'anthropic') {
      text = data && data.content && data.content[0] && data.content[0].text;
    } else {
      text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    }
    if (!text) throw new Error('empty AI response');
    return { ok: true, tier: 'cloud', model: model, text: String(text), trace: ['cloud:' + provider + ':' + model, 'grounded in attached context'] };
  }

  // ---- submit(): the single seam both tiers share ----
  // opts: { tier (override), type (preset type for local builders) }
  async function submit(prompt, ctx, opts) {
    const cfg = getAiCfg();
    const tier = (opts && opts.tier) || cfg.tier || 'off';
    const type = (opts && opts.type) || null;
    try {
      if (tier === 'off') {
        return { ok: false, error: 'AI engine is Off — enable Local or Cloud in the AI window settings row (or Settings ▸ Controls ▸ AI Engine).', tier: 'off' };
      }
      if (tier === 'local') {
        const out = await runLocal(prompt, type);
        // Normalize: every local path returns { ok, tier, model, text, trace }.
        if (!out.ok) return out;
        return {
          ok: true,
          tier: 'local',
          model: out.model || 'local-state-engine',
          text: out.text,
          trace: (out.trace || []).slice()
        };
      }
      if (tier === 'cloud') {
        return await runCloud(prompt, ctx || buildContext(), cfg);
      }
      return { ok: false, error: 'Unknown tier: ' + tier, tier: tier };
    } catch (e) {
      if (ns.Errors && ns.Errors.log) ns.Errors.log('AI submit failed: ' + (e && e.message), 'aiSubmit');
      return { ok: false, error: 'AI call failed — ' + (e && e.message ? e.message : 'unknown error') + '. The app is unaffected; check Settings ▸ AI Engine and try again.', tier: tier };
    }
  }

  // ---- Agent-style preset run: generate → submit → write to state ----
  async function runPreset(type) {
    const q = U.$('ai-q');
    const c = U.$('ai-ctx');
    const prompt = (ns.Prompts && ns.Prompts.generate) ? ns.Prompts.generate(type) : '';
    const ctx = (c && c.value) ? c.value : buildContext();
    if (q) q.value = prompt;
    if (c) c.value = ctx;
    const res = await submit(prompt, ctx, { type: type });
    if (res.ok) {
      // Structured write-back into unified state (constraint #1/#5).
      ns.State.updateState(function(s) {
        if (!s.aiOutputs) s.aiOutputs = {};
        s.aiOutputs[type] = {
          at: new Date().toISOString(),
          tier: res.tier,
          model: res.model,
          promptType: type,
          text: res.text,
          trace: res.trace || []
        };
      });
      renderOutput(type, res);
      toast('Preset run complete — saved to project state (' + res.tier + ').', 'ok');
      return res;
    }
    renderOutput(type, res);
    toast(res.error || 'AI run failed.', 'err');
    return res;
  }

  // ---- Run the free-form question box ----
  async function runQuestion() {
    const q = U.$('ai-q');
    const c = U.$('ai-ctx');
    const prompt = (q && q.value) || '';
    if (!prompt.trim()) { toast('Type a question first.', 'err'); return { ok: false, error: 'empty question' }; }
    const ctx = (c && c.value) ? c.value : buildContext();
    const res = await submit(prompt, ctx, {});
    if (res.ok) {
      renderOutput(null, res);
      toast('Answer generated (' + res.tier + ').', 'ok');
    } else {
      renderOutput(null, res);
      toast(res.error || 'AI call failed.', 'err');
    }
    return res;
  }

  // ---- Render the result panel (#ai-out) ----
  function renderOutput(type, res) {
    const out = U.$('ai-out');
    if (!out) return;
    if (res && res.ok) {
      out.value = (type ? '[' + type + ' · ' + res.tier + ' · ' + (res.model || '') + ' — saved to project]\n\n' : '[answer · ' + res.tier + ' · ' + (res.model || '') + ']\n\n') + res.text;
      const trace = U.$('ai-trace');
      if (trace) trace.textContent = 'Traceable to: ' + ((res.trace && res.trace.length) ? res.trace.join(', ') : '(grounded in attached context)');
    } else {
      out.value = '—';
      const trace = U.$('ai-trace');
      if (trace) trace.textContent = (res && res.error) ? res.error : '';
    }
  }

  function copyOut() {
    const out = U.$('ai-out');
    if (!out || !out.value || out.value === '—') { toast('Nothing to copy yet — run a preset first.', 'err'); return; }
    U.copyToClipboard(out.value);
    toast('Result copied.');
  }

  // ---- API ----
  ns.AiWin = {
    open: open,
    close: close,
    preset: preset,
    clear: clear,
    attachContext: attachContext,
    buildContext: buildContext,
    CONTEXT_SCHEMA: CONTEXT_SCHEMA,
    copy: copy,
    PRESET_LABELS: PRESET_LABELS,
    // Rank 2.3
    TIERS: TIERS,
    getAiCfg: getAiCfg,
    setAiCfg: setAiCfg,
    submit: submit,
    runPreset: runPreset,
    runQuestion: runQuestion,
    renderOutput: renderOutput,
    copyOut: copyOut,
    syncSettingsUI: syncSettingsUI
  };
})(MMGR);
window.MMGR = MMGR;
