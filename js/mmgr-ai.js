/* ============================================================
   My MaNaGeR , AI Assistant Window + Model Wiring (Rank 2.3)
   ------------------------------------------------------------
   Floating entry point (#ai-fab) opening a modal with:
     (a) one-click preset prompts (the existing prompt generators),
     (b) a free-form question box,
     (c) an automatic context dump of live project state,
     (d) Rank 2.3: a real submit() seam with two tiers:
           Tier A , 'local': zero-key, in-browser, deterministic
             engine. Every line of its output traces to a real
             state field (the `trace` array on each output), so
             zero-fabrication is guaranteed BY CONSTRUCTION , 
             it never invents a date, amount, or name.
             Constraint-satisfying redesign note: a WebGPU LLM
             would require bundling a multi-hundred-MB model or
             a CDN fetch, both of which violate the offline-first
             + zero-server + CSP constraints this app ships under
             (same call that kept whisper's model in-repo but
             rejected cloud diarization). The seam below is
             provider-shaped so a WebGPU runtime can be dropped
             into runLocal() later without touching the UI.
           Tier B , 'cloud': BYO key (OpenAI or Anthropic), same
             submit() seam, routed through MMGR.Net.post() with
             the exact circuit-breaker discipline weather uses
             (timeout, backoff, 5xx-retry). A failed cloud call
             degrades loudly but never breaks the app.
   Switching tiers = a settings toggle only (state.config.ai.tier)
   , no schema or architecture change, per Rank 2.3's exit gate.

   Presets are now AGENT-STYLE: one click generates AND writes the
   structured result back into state.aiOutputs[<type>] (unified
   state only , the .json export carries it). The old copy-first
   flow remains for the 'off' tier.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // BYO-AI-KEY-SESSION-ONLY-v1: the session vault (mmgr-ai-key.js). The AI
  // key NEVER lives in project state / localStorage / exports , only in
  // sessionStorage for this tab, cleared on Close or Clear. A missing vault
  // module degrades to disconnected (live chat disabled), never crashes.
  const BYO = ns.AiKey || {
    isConnected: function() { return false; },
    getKey: function() { return null; },
    getProvider: function() { return 'openai'; },
    setKey: function() { throw new Error('session vault not loaded'); },
    clearKey: function() {}
  };

  // BYO-AI-KEY-SESSION-ONLY-v1: scrub any legacy apiKey the pre-directive
  // flow may have persisted in state.config.ai. The key must never survive
  // in project state or any export , the session vault is its only home now.
  // Runs once at module load; adds nothing to the state schema.
  (function scrubLegacyKey() {
    try {
      const s = (ns.State && ns.State.getState) ? ns.State.getState() : null;
      if (s && s.config && s.config.ai && typeof s.config.ai.apiKey === 'string' && s.config.ai.apiKey) {
        ns.State.updateState(function(st) {
          if (st.config && st.config.ai && typeof st.config.ai.apiKey === 'string') delete st.config.ai.apiKey;
        });
      }
    } catch (e) { /* never block boot on cleanup */ }
  })();

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
    claim: 'Claim Pack',
    email: 'Stakeholder Email',
    complianceCheck: 'Claim Compliance'
  };

  // Rank 2.3 tier metadata , shown in the AI window settings row.
  const TIERS = {
    off:   { label: 'Off , copy-first only' },
    local: { label: 'Local (zero-key, offline, zero-fabrication)' },
    cloud: { label: 'Cloud (BYO key, session-only , OpenAI / Google Gemini / Anthropic)' }
  };

  function toast(msg, type) {
    if (ns.App && ns.App.showToast) ns.App.showToast(msg, type || 'ok');
  }

  // Readable provider names for the connect UI (ANTHROPIC-CONNECTABLE
  // fast-follow: Anthropic joined the selectable set, so a two-way ternary
  // is no longer enough).
  function providerLabel(provider) {
    if (provider === 'google-gemini') return 'Google Gemini';
    if (provider === 'anthropic') return 'Anthropic Claude';
    return 'OpenAI';
  }

  // ============================================================
  // INTEGRATED-STRUCTURE-API-WINDOW , live backend-API status badge
  // ------------------------------------------------------------
  // The plan's AIWindow pings the backend health endpoint on mount and
  // reports checking / connected / error / disconnected. Adaptation: the
  // app's backend is the same-origin Worker relay, so the badge pings
  // GET /api/health (worker.js) through the existing MMGR.Net circuit
  // breaker. A missing endpoint (static/local hosting without the Worker)
  // resolves to 'disconnected' , the window still works, it just says so.
  // The raw pill element is exposed so the QA battery can drive it.
  let _apiCheckInFlight = false;

  function setApiStatus(state, label) {
    const pill = U.$('ai-api-pill');
    if (pill) pill.setAttribute('data-state', state);
    const lbl = U.$('ai-api-pill-label');
    if (lbl) lbl.textContent = label;
  }

  // Pings /api/health with a SHORT timeout and zero retries (a health check
  // must fail fast, not back off). Resolves the pill state and returns it
  // so callers/QA can assert the outcome.
  //
  // Mapping: 2xx -> 'connected'; 404/405 (static hosting without the Worker
  // relay, same degradation relayChat() treats as "no Worker -> direct") ->
  // 'disconnected'; any other HTTP status -> 'error'; network failure/
  // timeout -> 'disconnected'. force=true (the pill click) bypasses the
  // in-flight guard so a user re-check is never silently swallowed by a
  // slow earlier probe.
  async function checkApiHealth(force) {
    if (_apiCheckInFlight && !force) return null;
    _apiCheckInFlight = true;        setApiStatus('checking', 'Backend · checking');
    let result = 'disconnected';
    try {
      const res = await ns.Net.get('/api/health', { timeoutMs: 4000, maxRetries: 0 });
      if (res && res.ok) {
        result = 'connected';
        setApiStatus('connected', 'Backend · online');
      } else if (res && (res.status === 404 || res.status === 405)) {
        result = 'disconnected';
        setApiStatus('disconnected', 'Backend · offline');
      } else {
        result = 'error';
        setApiStatus('error', 'Backend · error' + (res ? ' ' + res.status : ''));
      }
    } catch (e) {
      result = 'disconnected';
      setApiStatus('disconnected', 'Backend · offline');
      if (ns.Errors && ns.Errors.log) ns.Errors.log('api health check failed: ' + ((e && e.message) || 'unreachable'), 'apiHealth');
    } finally {
      _apiCheckInFlight = false;
    }
    return result;
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
    checkApiHealth(); // live backend-API status badge (plan §3)
    seedThreadFromState();
    setAiTab('chat'); // DIR-1: reopen on the Chat view (matches the welcome hint)
    applyAiSizePref(); // AI-WINDOW-RESIZE: restore the saved size (and re-center) before showing
    modal.classList.add('open');
    const q = U.$('ai-q');
    if (q) setTimeout(function() { q.focus(); }, 60);
  }

  function close() {
    const modal = U.$('ai-win');
    if (modal) modal.classList.remove('open');
  }

  function preset(type) {
    const q = U.$('ai-q');
    if (!q) return;
    q.value = (ns.Prompts && ns.Prompts.generate) ? ns.Prompts.generate(type) : '';
    q.focus();
    toast('Preset prompt loaded , send it, edit it, or copy it.');
  }

  function clear() {
    const q = U.$('ai-q');
    const c = U.$('ai-ctx');
    const o = U.$('ai-out');
    const t = U.$('ai-trace');
    if (q) { q.value = ''; q.style.height = ''; q.classList.remove('at-cap'); }
    if (c) c.value = '';
    if (o) o.value = '';
    if (t) t.textContent = '';
    resetThread();
    toast('Cleared , new conversation.');
  }

  // ============================================================
  // CONTEXT_SCHEMA , the exact shape of the automatic context dump
  // ------------------------------------------------------------
  // Rank 2.3: buildContext() output is the grounding payload BOTH
  // tiers consume. The dump is flat Markdown lines grouped by
  // section, and the cloud system prompt forbids using anything
  // outside it , so traceability to state fields is the contract.
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

  // BYO-AI-KEY-SESSION-ONLY-v1 STEP-3: cap the serialized context so a very
  // large project can never blow a provider's input window. Limit documented
  // here: 12,000 chars ≈ ~3k tokens , comfortably inside every v1 provider's
  // context budget and still far richer than a chat-only prompt.
  const CONTEXT_MAX_CHARS = 12000;

  // ---- Automatic context dump of live state ----
  // Pure client-side read of the state tree. Every section is defensive
  // (try/catch) so one missing field can never blank the whole dump.
  function buildContext(state) {
    const s = state || ((ns.State && ns.State.getState) ? ns.State.getState() : {});
    const L = [];
    const sec = (title) => L.push('## ' + title);
    const line = (k, v) => L.push('- ' + k + ': ' + (v === undefined || v === null || v === '' ? '-' : v));
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
        const over = Math.round((projected.getTime() - new Date(tgt).getTime()) / MMGR.Utils.MS_PER_DAY);
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
      else line('Site', 'no location set , regional weather windows only');
      if (ns.Forecast && ns.Forecast.riskDays) {
        const rd = ns.Forecast.riskDays(s) || [];
        line('Weather risk days', rd.length ? rd.slice(0, 5).map(d => d.date + ' (' + d.alerts.join(', ') + ')').join('; ') : 'none in forecast');
      }
      line('Weather delay days logged', (s.weatherLog || []).length);
    } catch (e) {}

    let out = L.join('\n');
    if (out.length > CONTEXT_MAX_CHARS) {
      out = out.slice(0, CONTEXT_MAX_CHARS) + '\n…[context truncated , project data exceeds the safe packet size]';
    }
    return out;
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
    if (!txt.trim()) { toast('Nothing to copy yet , pick a preset or type a question.', 'err'); return; }
    U.copyToClipboard(txt);
    toast('Prompt + context copied , paste into your AI tool.');
  }

  // ============================================================
  // RANK 2.3 , CONFIG + SUBMIT() SEAM
  // ============================================================

  // Read the merged AI config (state.config.ai over Config.ai defaults).
  function getAiCfg() {
    const cfg = (ns.Net && ns.Net.getConfig) ? ns.Net.getConfig() : { ai: {} };
    return Object.assign({}, ns.Config && ns.Config.ai ? ns.Config.ai : {}, cfg.ai || {});
  }

  // Settings toggle , writes into state.config.ai (per-project, portable,
  // merged over defaults by Net.getConfig). No schema change.
  // MERGED-AI-CONTROL (audit 1.2): whenever a non-off tier is selected, it is
  // remembered as lastTier so the drawer master switch can restore it when
  // flipped back ON (default 'local' when never set).
  // AI-CLOUD-CONNECT-UI (DIR-2): apiKey is NEVER written to project state , 
  // the session vault (mmgr-ai-key.js) is its only home. Any patch carrying
  // apiKey is silently dropped here, so no caller (action map, tests, future
  // UI) can ever persist a secret into state or into an export.
  function setAiCfg(patch) {
    const safe = {};
    Object.keys(patch || {}).forEach(function(k) {
      if (k !== 'apiKey') safe[k] = patch[k];
    });
    ns.State.updateState(function(s) {
      if (!s.config || typeof s.config !== 'object' || Array.isArray(s.config)) s.config = {};
      // Atomic: build new AI config object, then assign in one step.
      var cur = (s.config.ai && typeof s.config.ai === 'object' && !Array.isArray(s.config.ai)) ? s.config.ai : {};
      var next = {};
      var k;
      for (k in cur) { if (cur.hasOwnProperty(k)) next[k] = cur[k]; }
      for (k in safe) { if (safe.hasOwnProperty(k)) next[k] = safe[k]; }
      if (safe.tier !== undefined && safe.tier !== 'off') next.lastTier = safe.tier;
      s.config.ai = next;
    });
  }

  // MERGED-AI-CONTROL (audit 1.2): the Settings ▸ Features "AI Assistant"
  // switch is now the SINGLE AI on/off control , it reads/writes
  // state.config.ai.tier directly (flags.aiWindow is dropped as a gate).
  // OFF -> tier 'off'; ON -> restore the last non-off tier (default 'local').
  // Chrome flips checkbox `checked` before the click handler runs, so read it
  // as-is and let the native toggle stand.
  function tglDrawerTier(el) {
    const on = el.type === 'checkbox' ? el.checked : false;
    const cfg = getAiCfg();
    const tier = on ? (cfg.lastTier || 'local') : 'off';
    setAiCfg({ tier: tier });
    // syncSettingsUI re-gates the fab (renderFlags) so visibility and tier
    // can never disagree , no separate renderFlags call needed here.
    syncSettingsUI();
  }

  // Sync the AI window's tier select + BYO connect UI + send gate.
  // BYO-AI-KEY-SESSION-ONLY-v1: the key inputs live in the session vault
  // (mmgr-ai-key.js), never in project state , so nothing here reads or
  // writes an apiKey from state.config.
  function syncSettingsUI() {
    const cfg = getAiCfg();
    const set = (id, val) => { const el = U.$(id); if (el && el.value !== val) el.value = val; };
    set('ai-tier', cfg.tier || 'off');
    const cloudRow = U.$('ai-cfg-cloud');
    if (cloudRow) cloudRow.classList.toggle('is-hide', (cfg.tier || 'off') !== 'cloud');
    syncByoStatus();
    syncMcpToggle();
    syncSendGate();
    // Engine-status pill in the chat header. AI-CLOUD-CONNECT-UI (DIR-1): the
    // cloud label reads the SAME canonical status field as the chip and the
    // Send gate , no two indicators can disagree anymore.
    const pill = U.$('ai-engine-pill');
    if (pill) pill.setAttribute('data-tier', cfg.tier || 'off');
    const pillLbl = U.$('ai-engine-pill-label');
    const tier = cfg.tier || 'off';
    if (pillLbl) {
      // UI-DECLUTTER: the engine pill names the TIER only , the live
      // BYO key connection detail lives in the ONE smart status chip
      // next to the provider dropdown (ai-byo-status). The backend
      // health pill (ai-api-pill) is independent , it checks server
      // reachability, not key connection, so they can legitimately
      // show different states (e.g. 'Backend · online' + 'Disconnected').
      pillLbl.textContent = tier === 'local' ? 'Local · zero-key'
        : tier === 'cloud' ? 'Cloud'
        : 'Off · copy-first';
    }
    // MERGED-AI-CONTROL: the fab visibility follows the tier (hidden only
    // when the engine is fully off) , re-gate here so the header select and
    // the drawer switch can never leave the fab disagreeing with the tier.
    if (ns.Render && ns.Render.renderFlags) ns.Render.renderFlags();
  }

  // ---- BYO Connect flow (BYO-AI-KEY-SESSION-ONLY-v1 STEP-2) ----
  //
  // AI-CLOUD-CONNECT-UI (DIR-1): exactly three states, driven by ONE
  // canonical field , state.config.ai.connectionStatus:
  //   'not_connected'  , no key in the session vault (or key was rejected).
  //   'saved_untested' , a key IS in the vault, but Connect & Test has not
  //                      confirmed it against the provider yet (or the last
  //                      probe failed). A key present is NOT 'connected'.
  //   'connected'      , the last Connect & Test probe returned 2xx.
  // Plus state.config.ai.lastTestedAt (ISO) set when 'connected' was last
  // achieved. EVERY visible indicator (engine pill, BYO chip, Send button
  // state) reads this one field via getConnectionState() , two indicators
  // can no longer disagree. The vault remains the ground truth: no vault
  // entry always means 'not_connected', even if a stale 'connected' record
  // survived in state from a previous session.
  function getConnectionState() {
    if (!BYO.isConnected()) return 'not_connected';
    const cfg = getAiCfg();
    return (cfg.connectionStatus === 'connected' && cfg.lastTestedAt) ? 'connected' : 'saved_untested';
  }

  function setConnectionStatus(status) {
    const patch = { connectionStatus: status };
    if (status === 'connected') patch.lastTestedAt = new Date().toISOString();
    setAiCfg(patch);
  }

  // MCP TOGGLE: show only when tier=cloud + key connected. Persisted per-project.
  function syncMcpToggle() {
    var mcpRow = U.$('ai-cfg-mcp');
    var mcpCb = U.$('ai-mcp-toggle');
    if (!mcpRow) return;
    var cfg = getAiCfg();
    var isConnected = getConnectionState() === 'connected';
    var showMcp = (cfg.tier || 'off') === 'cloud' && isConnected;
    mcpRow.style.display = showMcp ? '' : 'none';
    // Restore saved state
    if (mcpCb) {
      var pid = window.MMGR && MMGR.App && MMGR.App.projectId ? MMGR.App.projectId : '';
      var saved = false;
      try { saved = localStorage.getItem('mmgr_mcp_toggle_' + pid) === '1'; } catch(e) {}
      mcpCb.checked = saved;
    }
  }

  function syncByoStatus() {
    const st = U.$('ai-byo-status');
    if (!st) return;
    const txt = st.querySelector('.ai-byo-status-txt');
    const status = getConnectionState();
    if (status === 'connected') {
      st.setAttribute('data-state', 'on');
      if (txt) txt.textContent = 'Connected · ' + providerLabel(BYO.getProvider());
    } else if (status === 'saved_untested') {
      st.setAttribute('data-state', 'untested');
      if (txt) txt.textContent = 'Key saved , not tested';
    } else {
      st.setAttribute('data-state', 'off');
      if (txt) txt.textContent = 'Disconnected';
    }
  }

  // STEP-4 + DIR-1: live chat is gated on the CANONICAL status, not on key
  // presence. Cloud Send unlocks only when Connect & Test has verified the
  // key ('connected'); a saved-but-unverified key keeps Send disabled with
  // an honest hint. Off tier also disables Send (presets stay usable).
  function syncSendGate() {
    const s = U.$('ai-send');
    if (!s) return;
    const tier = getAiCfg().tier || 'off';
    const status = getConnectionState();
    const off = tier === 'off';
    const cloudNotVerified = tier === 'cloud' && status !== 'connected';
    s.disabled = off || cloudNotVerified;
    // UI-DECLUTTER: no permanent red warning text in the input bar. The
    // disabled Send button carries a native tooltip explaining what to do
    // next , hosted on the WRAPPER because Chrome suppresses title tooltips
    // on disabled buttons. NOTE: plain '&', not the HTML entity.
    const msg = (tier === 'cloud' && status === 'not_connected')
      ? 'Connect your AI key to send (session-only) , open the key settings next to the provider.'
      : (tier === 'cloud' && status === 'saved_untested')
        ? 'Key saved , Connect & Test to verify before sending.'
        : (off ? 'Engine is Off , choose Local or Cloud in the tier select.' : '');
    const wrap = U.$('ai-send-wrap');
    if (wrap) wrap.setAttribute('title', msg || 'Send');
  }

  // DIR-1: the real connectivity check. One minimal, cheap request through
  // the existing circuit-broken Net path (mmgr-net.js , timeout + zero
  // retries: a probe must fail fast, not back off): the provider's
  // models-list endpoint. Only a 2xx means the key is genuinely usable , a
  // typo'd/revoked/wrong-provider key returns 401/403 and must NOT count as
  // connected. Returns { ok, status }.
  async function probeProvider(provider, key) {
    const def = (ns.Net && ns.Net.PROVIDER_DEFAULTS) ? ns.Net.PROVIDER_DEFAULTS[provider] : null;
    if (!def) return { ok: false, status: 0 };
    const isGemini = provider === 'google-gemini';
    const isAnthropic = provider === 'anthropic';
    const url = isGemini
      ? 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key)
      : isAnthropic
        ? 'https://api.anthropic.com/v1/models'
        : 'https://api.openai.com/v1/models';
    const headers = isGemini ? {} : isAnthropic
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { 'Authorization': 'Bearer ' + key };
    try {
      const res = await ns.Net.get(url, { headers: headers, timeoutMs: 6000, maxRetries: 0 });
      return { ok: !!(res && res.ok), status: res ? res.status : 0 };
    } catch (e) {
      return { ok: false, status: 0 };
    }
  }

  // Connect a BYO key for this session only, then VERIFY it with the probe.
  // Empty key -> error, stay not_connected. The full key is never rendered
  // again after connect. The chip/pill/Send all follow the probe outcome via
  // the canonical status field , nothing is fabricated from key presence.
  async function connectByo(provider, apiKey) {
    if (!apiKey || !String(apiKey).trim()) {
      toast('Paste your API key first , session-only, never stored.', 'err');
      return { ok: false, error: 'empty key', status: 'not_connected' };
    }
    try {
      BYO.setKey(provider, apiKey);
    } catch (e) {
      toast('Could not connect , ' + ((e && e.message) || 'invalid key'), 'err');
      return { ok: false, error: (e && e.message) || 'invalid key', status: 'not_connected' };
    }
    const k = U.$('ai-byo-key');
    if (k) k.value = ''; // never show the raw key after connect (with_key_ux)
    // Key is now saved , but that is 'saved_untested', NOT 'connected'.
    setConnectionStatus('saved_untested');
    syncSettingsUI();
    const probe = await probeProvider(provider, BYO.getKey());
    if (probe.ok) {
      setConnectionStatus('connected');
      syncSettingsUI();
      toast('Key connected and verified against ' + providerLabel(provider) + ' , this session only. Cleared when you close the tab.', 'ok');
      return { ok: true, status: 'connected' };
    }
    if (probe.status === 401 || probe.status === 403) {
      // Provider explicitly rejected the key , clear it (auth failure, the
      // only condition that clears a session key, consistent with runCloud).
      BYO.clearKey();
      setConnectionStatus('not_connected');
      syncSettingsUI();
      toast('Provider rejected the key (401/403) , check it and connect again.', 'err');
      return { ok: false, error: 'provider rejected the key', status: 'not_connected' };
    }
    // Network failure / timeout / other status: key stays saved but unverified.
    syncSettingsUI();
    // NOTE: toast uses textContent , plain '&', not the HTML entity.
    toast('Key saved for this session, but the provider check could not confirm it , check the key and your connection, then Connect & Test again.', 'err');
    return { ok: false, error: 'probe failed', status: 'saved_untested' };
  }

  function clearByo() {
    BYO.clearKey();
    setConnectionStatus('not_connected');
    syncSettingsUI();
    toast('Session key cleared , you will paste it again next time.', 'ok');
  }

  // ---- Tier A: local zero-key engine ----
  // Deterministic. Output is built ONLY from state fields; the returned
  // `trace` array names the exact fields each line came from, so the
  // Rank 2.3 acceptance gate ("zero-fabrication, traceable line-by-line")
  // is satisfied by construction , there is no generator randomness to
  // audit. Free-form lookups are answered by a small intent matcher;
  // anything it can't ground is answered honestly ("not answerable
  // locally , switch to Cloud tier").
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
      out.push('Overdue: ' + od.length + (od.length ? ' , ' + od.slice(0, 5).map(t => t.name + ' (due ' + t.endDate + ')').join('; ') : '.'));
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
      out.push('Live issues: ' + live.length + (live.length ? ' , ' + live.slice(0, 5).map(i => i.description).join('; ') : '.'));
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
      _t('Digest.computeDigest(s) , digestSnapshot/baseline diff');
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
        const over = Math.round((proj - new Date(tgt)) / MMGR.Utils.MS_PER_DAY);
        _t('charter.targetCompletion');
        text += 'Projected finish: ' + proj.toISOString().slice(0, 10) + ' vs target ' + tgt + ' (' + (over > 0 ? '+' + over + 'd over' : over < 0 ? Math.abs(over) + 'd ahead' : 'on target') + ').\n';
      } else {
        text += 'Projected finish: cannot compute , set a target completion and dated tasks.\n';
      }
      if (ns.Evm && ns.Evm.compute) {
        const e = ns.Evm.compute(s);
        _t('EVM.compute(s)');
        if (e && e.cpi) text += 'Burn rate (CPI): ' + e.cpi.toFixed(2) + ' , EAC trend ' + (e.cpi < 1 ? 'over budget' : 'at/below budget') + '.\n';
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
      L.push('PROJECT STATUS REPORT , ' + ((s.charter && s.charter.name) || s.projectName || 'Project'));
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
      const L = ['RISK REGISTER , ranked by probability × impact'];
      const score = r => ({ Low: 1, low: 1, Medium: 2, medium: 2, High: 3, high: 3 }[(r.probability || '')] || 1) * ({ Low: 1, low: 1, Medium: 2, medium: 2, High: 3, high: 3 }[(r.impact || '')] || 1);
      const sorted = risks.slice().sort((a, b) => score(b) - score(a));
      sorted.forEach(r => L.push('- [' + (score(r) >= 6 ? 'HIGH' : score(r) >= 3 ? 'MED' : 'LOW') + '] ' + (r.description || '(untitled)') + ' | P:' + (r.probability || '-') + ' I:' + (r.impact || '-') + (r.mitigation ? ' | Mitigation: ' + r.mitigation : '')));
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
      const L = ['CHANGE IMPACT , pending requests'];
      pending.forEach(c => L.push('- ' + (c.title || '(untitled)') + ' | Sched: ' + (c.schedImpact || '-') + ' | Cost: ' + (c.costImpact || '-') + ' | ' + c.status));
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
        text: 'CLIENT UPDATE , ' + ((s.charter && s.charter.name) || s.projectName || 'Project') + '\nCompletion: ' + pct + '% (' + done + ' of ' + tasks.length + ' tasks).\nOverall: ' + (pct >= 70 ? 'On track.' : pct >= 40 ? 'Progressing , minor concerns.' : 'Early stage , attention needed.'),
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
      L.push('Blocked: ' + (bl.length ? bl.map(t => t.name + (t.notes ? ' , ' + t.notes : '')).join('; ') : 'none'));
      L.push('Critical: ' + (crit.length ? crit.map(t => t.name).join(', ') : 'none'));
      return { text: L.join('\n'), trace: TRACE.fields.slice() };
    },
    // BACKLOG B-N: the email preset's LOCAL tier returns the static
    // App.emailTpl('status') template VERBATIM , zero-fabrication by
    // construction, the guaranteed no-model fallback the backlog requires.
    // The Cloud tier drafts a richer, AI-polished version on top.
    email: function(s) {
      TRACE.fields = [];
      _t('charter.name'); _t('charter.sponsor'); _t('tasks[].status'); _t('tasks[].endDate');
      _t('issues[].status'); _t('risks[].probability'); _t('risks[].impact');
      _t('budgetLines[].planned'); _t('budgetLines[].actual');
      const base = (ns.App && ns.App.emailTplText) ? ns.App.emailTplText('status') : 'Static email template unavailable.';
      return {
        text: base + '\n\n(Static template from My MaNaGeR , run the Cloud tier for an AI-polished stakeholder email.)',
        trace: TRACE.fields.slice()
      };
    },
    // MARKET-FEATURE-ROADMAP A7: zero-key local tier for the compliance check.
    // Deterministic element-by-element audit of the assembled claim-pack data
    // , no model call, zero fabrication. Each element is PRESENT / MISSING /
    // N/A judged only from real state fields.
    complianceCheck: function(s) {
      TRACE.fields = [];
      _t('Claim.computeSlips(s)'); _t('Claim.ldRollup(s)'); _t('weatherLog');
      _t('changes[].status'); _t('logEntries');
      const L = ['CLAIM PACKAGE COMPLIANCE CHECK (local engine)'];
      const slips = (ns.Claim && ns.Claim.computeSlips) ? (ns.Claim.computeSlips(s) || []) : [];
      const ld = (ns.Claim && ns.Claim.ldRollup) ? ns.Claim.ldRollup(s) : null;
      const weatherLog = (s.weatherLog || []).length;
      const pendingChg = (s.changes || []).filter(c => c.status === 'submitted' || c.status === 'review').length;
      const decLog = (s.logEntries || []).length;
      // 1. Delay narrative , slips with a cause tag are the narrative core.
      const narrative = slips.filter(x => x.cause && x.cause !== 'unknown').length;
      L.push(narrative ? '1. DELAY NARRATIVE , PRESENT (' + narrative + ' cause-tagged slip' + (narrative === 1 ? '' : 's') + ')'
        : '1. DELAY NARRATIVE , MISSING (no cause-tagged schedule slips captured; record slip causes in the Claim Pack tab)');
      // 2. Supporting evidence references , weather log / changes / decisions.
      const evidence = (weatherLog > 0 ? 1 : 0) + (pendingChg > 0 ? 1 : 0) + (decLog > 0 ? 1 : 0);
      L.push(evidence >= 2 ? '2. SUPPORTING EVIDENCE , PRESENT (weather log ' + weatherLog + ', pending changes ' + pendingChg + ', decisions ' + decLog + ')'
        : '2. SUPPORTING EVIDENCE , ' + (evidence === 0 ? 'MISSING' : 'THIN') + ' (only ' + evidence + ' of 3 evidence types present: weather log ' + weatherLog + ', changes ' + pendingChg + ', decisions ' + decLog + ' , add the missing ones)');
      // 3. Cost impact breakdown , LD rollup with both buckets.
      L.push(ld && (ld.incurredLd > 0 || ld.avoidedLd > 0)
        ? '3. COST IMPACT , PRESENT (LD ' + fmt$(ld.incurredLd || 0) + ' exposure / ' + fmt$(ld.avoidedLd || 0) + ' defensible)'
        : '3. COST IMPACT , MISSING (no LD exposure computed; set an LD rate in the Budget panel and tag slip causes)');
      // 4. Contractual basis , no state field exists; honest N/A.
      L.push('4. CONTRACTUAL BASIS , N/A locally (no contract-terms field exists yet; the Cloud tier can assess a pasted contract basis)');
      // 5. Requested relief , the claim narrative draft is the ask.
      L.push('5. REQUESTED RELIEF , see the Claim Pack preset: draft the explicit ask (EoT / LD waiver / amount) once 1-3 are present');
      const present = (narrative ? 1 : 0) + (evidence >= 2 ? 1 : 0) + (ld && (ld.incurredLd > 0 || ld.avoidedLd > 0) ? 1 : 0);
      L.push('');
      L.push('VERDICT: ' + (present >= 3 ? 'ready to draft , run the Cloud tier for the full element-by-element review.' : (present === 2 ? 'nearly ready , close the one gap above, then run the Cloud tier.' : 'not submission-ready , ' + (3 - present) + ' of 3 core elements missing; fix the gaps above first.')));
      return { text: L.join('\n'), trace: TRACE.fields.slice() };
    }
  };

  // Local fallback: honest "can't do this locally" answer.
  function localUnavailable() {
    return {
      ok: false,
      error: 'Local tier has no generator for this preset , run it on the Cloud tier instead.',
      tier: 'local'
    };
  }

  async function runLocal(prompt, type) {
    const s = ns.State.getState();
    if (type && LOCAL_BUILDERS[type]) {
      const built = LOCAL_BUILDERS[type](s);
      // Builders return { text, trace } , normalize to the full result shape.
      return { ok: true, tier: 'local', model: 'local-state-engine', text: built.text, trace: built.trace || [] };
    }
    if (type) return localUnavailable();
    return localLookup(prompt, s);
  }

  // ---- Tier B: cloud call (OpenAI or Anthropic), circuit-broken ----
  const CLOUD_SYSTEM_PROMPT =
    'You are an assistant grounded ONLY in the project data below. Use ONLY that data , never invent dates, amounts, names, or facts. If a requested detail is not present in the data, say "not in data" explicitly. Keep every claim traceable to a line of the provided context.';

  // Convert OpenAI-style [{role,content}] into the Gemini generateContent
  // payload shape (systemInstruction + contents with role 'user'/'model').
  function geminiPayload(messages) {
    let system = '';
    const contents = [];
    (messages || []).forEach(function(m) {
      if (m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
      else contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] });
    });
    const p = { contents: contents };
    if (system) p.systemInstruction = { parts: [{ text: system }] };
    return p;
  }

  // ============================================================
  // MODEL-FALLBACK-LADDER (DIR-3, generalized to all providers)
  // ------------------------------------------------------------
  // ONE shared fallback implementation, used by BOTH hosting modes and ALL
  // providers. directChat() and relayChat() both route through
  // callProviderWithFallback(); nobody implements a second ladder.
  // Model list is [def.model].concat(def.fallbackModels || []) per provider
  // from PROVIDER_DEFAULTS , ordered preferred/highest-quality first ->
  // smallest/cheapest last (DIR-1). Fallback IDs were verified against the
  // providers' current model docs on 2026-08-09 (see mmgr-net.js).
  //
  // Fallback classification (DIR-3): an attempt advances to the next, smaller
  // model ONLY on capacity rejections , 429 (rate limit) or 503 (overload). A
  // 401/403 on ANY attempt stops the whole ladder immediately: the key itself
  // is rejected, so the existing 401-only key-clear rule (BYO.clearKey() in
  // runCloud) applies , never keep trying smaller models with a key that is
  // already confirmed bad. Any OTHER error (400 bad request, network failure
  // after normal retries) also stops the ladder: silently trying a different
  // model would mask a real configuration bug.
  //
  // Relay-vs-direct (DIR-3 decision, documented): the client drives the
  // ladder THROUGH the same-origin Worker relay when it is active , each
  // attempt posts to /api/ai/chat with a per-attempt `model` field, and the
  // relay (worker.js) forwards to exactly that model and passes 429/503
  // through with their own status so the ladder can advance. If the relay
  // route is absent (404/405, e.g. local static hosting) or a relay network
  // failure occurs, the attempt degrades to the direct provider call for the
  // SAME model before the ladder advances. Both hosting modes therefore get
  // identical fallback behavior from this one function.

  // Single DIRECT OpenAI attempt at ONE model. Key rides the Authorization
  // Bearer header. Throws errors with .status set (429/503 capacity, 401 auth).
  async function openaiDirectAttempt(key, model, messages) {
    const def = (ns.Net && ns.Net.PROVIDER_DEFAULTS) ? ns.Net.PROVIDER_DEFAULTS.openai : {};
    if (!def || !def.endpoint) throw new Error('no AI endpoint configured');
    const res = await ns.Net.post(def.endpoint, { model: model, messages: messages }, { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, timeoutMs: 30000, maxRetries: 1 });
    if (res.status === 429 || res.status === 503) { const e = new Error('OpenAI rate limited (HTTP ' + res.status + ')'); e.status = res.status; throw e; }
    if (res.status === 401 || res.status === 403) { const e = new Error('provider rejected the key'); e.status = 401; throw e; }
    if (!res.ok) throw new Error('AI endpoint HTTP ' + res.status);
    const data = await res.json().catch(function() { return null; });
    const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    if (!text) throw new Error('empty AI response');
    return String(text);
  }

  // OpenAI-style [{role,content}] -> Anthropic Messages API payload: the
  // system prompt splits out into its own field, roles are 'user'/'assistant'
  // (never 'model'), and max_tokens is required by the API.
  function anthropicPayload(model, messages) {
    let system = '';
    const msgs = [];
    (messages || []).forEach(function(m) {
      if (m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
      else msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' });
    });
    const p = { model: model, max_tokens: 4096, messages: msgs };
    if (system) p.system = system;
    return p;
  }

  // Single DIRECT Anthropic attempt at ONE model. The Messages API authenticates
  // with x-api-key + anthropic-version headers (NOT Bearer), requires
  // max_tokens, and returns text in data.content[].text.
  async function anthropicDirectAttempt(key, model, messages) {
    const def = (ns.Net && ns.Net.PROVIDER_DEFAULTS) ? ns.Net.PROVIDER_DEFAULTS.anthropic : {};
    if (!def || !def.endpoint) throw new Error('no AI endpoint configured');
    const res = await ns.Net.post(def.endpoint, anthropicPayload(model, messages), { headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeoutMs: 30000, maxRetries: 1 });
    if (res.status === 429 || res.status === 503) { const e = new Error('Anthropic rate limited (HTTP ' + res.status + ')'); e.status = res.status; throw e; }
    if (res.status === 401 || res.status === 403) { const e = new Error('provider rejected the key'); e.status = 401; throw e; }
    if (!res.ok) throw new Error('AI endpoint HTTP ' + res.status);
    const data = await res.json().catch(function() { return null; });
    const text = (data && Array.isArray(data.content)) ? data.content.map(function(c) { return (c && c.type === 'text' && c.text) ? c.text : ''; }).join('') : null;
    if (!text) throw new Error('empty AI response');
    return String(text);
  }

  // Single DIRECT attempt at ONE Gemini model (the per-model call refactored
  // out of the old directChat Gemini branch). Endpoint is parameterized by
  // model (DIR-2). Key rides the x-goog-api-key header only.
  // NOTE: Net.post throws with .status after exhausting retries on 429/408/5xx
  // and carries status-less network failures up as-is. The ladder classifies
  // both: 429/503 advance, everything else (including a status-less network
  // failure) stops the ladder , DIR-3 says a network failure must NOT
  // silently fall through to a smaller model.
  async function geminiDirectAttempt(key, model, messages) {
    const url = (ns.Net && ns.Net.geminiEndpointFor) ? ns.Net.geminiEndpointFor(model) : null;
    if (!url) throw new Error('no AI endpoint configured');
    const res = await ns.Net.post(url, geminiPayload(messages), { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, timeoutMs: 30000, maxRetries: 1 });
    if (res.status === 429 || res.status === 503) { const e = new Error('Gemini rate limited (HTTP ' + res.status + ')'); e.status = res.status; throw e; }
    if (res.status === 401 || res.status === 403) { const e = new Error('provider rejected the key'); e.status = 401; throw e; }
    if (!res.ok) throw new Error('AI endpoint HTTP ' + res.status);
    const data = await res.json().catch(function() { return null; });
    const text = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts)
      ? data.candidates[0].content.parts.map(function(p) { return p.text || ''; }).join('') : null;
    if (!text) throw new Error('empty AI response');
    return String(text);
  }

  // One attempt against ONE model of ANY provider. directOnly skips the relay
  // hop (used when the relay already proved absent , static hosting /
  // directChat). Relay 429/503/401 (or any relay-reported 5xx/408 with a
  // status) is a real answer , carried up. A status-less throw is a network
  // failure/timeout: degrade to the direct call for the SAME model.
  async function providerAttempt(provider, key, model, messages, ctx, directOnly) {
    const direct = function() {
      if (provider === 'google-gemini') return geminiDirectAttempt(key, model, messages);
      if (provider === 'anthropic') return anthropicDirectAttempt(key, model, messages);
      return openaiDirectAttempt(key, model, messages);
    };
    if (!directOnly) {
      let res;
      try {
        // MCP: include project context params when toggle is ON
        var mcpPayload = { provider: provider, model: model, messages: messages, context: ctx || '' };
        var mcpCb = U.$('ai-mcp-toggle');
        if (mcpCb && mcpCb.checked && window.MMGR && MMGR.Render && MMGR.Render.getProjectId) {
          var pid = MMGR.App.projectId;
          var ocode = '';
          try { ocode = sessionStorage.getItem('mmgr_cloud_code_' + pid) || ''; } catch(e) {}
          var ecode = '';
          try { ecode = sessionStorage.getItem('mmgr_cloud_ecode_' + pid) || ''; } catch(e) {}
          if (pid && (ocode || ecode)) {
            mcpPayload.mcpProjectId = pid;
            mcpPayload.mcpCode = ocode || ecode;
          }
        }
        res = await ns.Net.post('/api/ai/chat', mcpPayload, {
          headers: { 'Content-Type': 'application/json', 'X-User-Api-Key': key },
          timeoutMs: 30000, maxRetries: 1
        });
      } catch (e) {
        if (e && (e.status === 429 || e.status === 503 || e.status === 401 || e.status === 403)) throw e;
        return direct();
      }
      if (res.status === 404 || res.status === 405) return direct();
      if (res.status === 429 || res.status === 503) { const e = new Error('provider rate limited (HTTP ' + res.status + ')'); e.status = res.status; throw e; }
      if (res.status === 401 || res.status === 403) { const e = new Error('provider rejected the key'); e.status = 401; throw e; }
      if (!res.ok) throw new Error('AI chat HTTP ' + res.status);
      const data = await res.json().catch(function() { return null; });
      if (!data || typeof data.text !== 'string' || !data.text) throw new Error('empty AI response');
      return String(data.text);
    }
    return direct();
  }

  // The ladder itself (DIR-3 core). Returns { ok:true, text, model,
  // fellBackFrom } , `model` is the model that ACTUALLY answered and
  // `fellBackFrom` is the original preferred model when a fallback fired
  // (DIR-4 transparency). Throws the last capacity error when every rung is
  // exhausted.
  async function callProviderWithFallback(provider, key, messages, ctx, opts) {
    const def = (ns.Net && ns.Net.PROVIDER_DEFAULTS && ns.Net.PROVIDER_DEFAULTS[provider]) || {};
    const models = [def.model].concat(def.fallbackModels || []).filter(Boolean);
    if (!models.length) throw new Error('no model configured for provider ' + provider);
    const directOnly = !!(opts && opts.directOnly);
    let lastCapacityErr = null;
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        const text = await providerAttempt(provider, key, model, messages, ctx || '', directOnly);
        return { ok: true, text: text, model: model, fellBackFrom: i > 0 ? models[0] : null };
      } catch (e) {
        const status = e && e.status;
        if (status === 429 || status === 503) { lastCapacityErr = e; continue; }
        throw e; // 401/403 or any other error , stop the ladder immediately
      }
    }
    if (lastCapacityErr) throw lastCapacityErr;
    const e = new Error('all ' + provider + ' models rate-limited or unavailable');
    e.status = 429;
    throw e;
  }

  // Direct provider call , the fallback used only when the Worker relay is
  // not reachable/deployed (local/static hosting). The key still comes from
  // the session vault, never from project state. Every provider routes
  // through the shared ladder in direct-only mode (DIR-3).
  async function directChat(provider, key, messages) {
    const r = await callProviderWithFallback(provider, key, messages, '', { directOnly: true });
    return r.text;
  }

  // Preferred path (STEP-4/5): the same-origin Worker relay POST
  // /api/ai/chat carries the key only in the per-request X-User-Api-Key
  // header, forwards to the provider, and never stores or logs it. Every
  // provider routes through the shared ladder (relay-first per model, DIR-3);
  // the relay is a thin forwarder that accepts the per-attempt model and
  // passes 429/503 through.
  async function relayChat(provider, key, messages, ctx) {
    const r = await callProviderWithFallback(provider, key, messages, ctx || '');
    return r.text;
  }

  async function runCloud(prompt, ctx, cfg) {
    // STEP-4 gate: live chat requires a connected session key. The key and
    // provider come from the vault ONLY , state.config.ai.apiKey (legacy) is
    // never read, so no project-state field can ever carry the key.
    const key = BYO.getKey();
    if (!key) throw new Error('No AI key connected , connect one in the AI window (session-only, cleared when the tab closes).');
    const provider = BYO.getProvider() || 'openai';
    const def = (ns.Net && ns.Net.PROVIDER_DEFAULTS) ? ns.Net.PROVIDER_DEFAULTS[provider] : {};
    // Provider defaults only: legacy config.ai.endpoint/model overrides were
    // UI-removed by this directive, and the relay path ignores them anyway , 
    // honoring them only in the direct fallback would be inconsistent.
    const model = (def && def.model) || provider;
    // STEP-3: the key must never appear in the packet , defensive strip even
    // though buildContext() only ever reads project state.
    const userContent = (prompt || '') + (ctx ? '\n\n==== PROJECT CONTEXT (grounding only) ====\n' + String(ctx).split(key).join('[key removed]') : '');
    const messages = [
      { role: 'system', content: CLOUD_SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ];
    let text;
    // DIR-4: report the model that ACTUALLY answered, not the configured one.
    let actualModel = model;
    let fellBackFrom = null;
    try {
      const r = await callProviderWithFallback(provider, key, messages, ctx || '');
      text = r.text;
      actualModel = r.model;
      fellBackFrom = r.fellBackFrom;
    } catch (e) {
      // STEP-4: auth failure is the ONLY condition that clears the session
      // key , network/timeout/provider-5xx errors leave it in place.
      if (e && e.status === 401) {
        BYO.clearKey();
        setConnectionStatus('not_connected');
        syncSettingsUI();
        throw new Error('AI key rejected by the provider , session key cleared. Connect again.');
      }
      throw e;
    }
    // DIR-4 transparency: tell the user which model actually answered, and
    // when a 429 pushed the ladder to a smaller tier.
    const trace = ['cloud:' + provider + ':' + actualModel + (fellBackFrom && fellBackFrom !== actualModel ? ' (fell back from ' + fellBackFrom + ' on 429)' : '')];
    trace.push('grounded in attached context');
    return { ok: true, tier: 'cloud', model: actualModel, fellBackFrom: fellBackFrom, text: String(text), trace: trace };
  }

  // ---- submit(): the single seam both tiers share ----
  // opts: { tier (override), type (preset type for local builders) }
  async function submit(prompt, ctx, opts) {
    const cfg = getAiCfg();
    const tier = (opts && opts.tier) || cfg.tier || 'off';
    const type = (opts && opts.type) || null;
    try {
      if (tier === 'off') {
        return { ok: false, error: 'AI engine is Off , enable Local or Cloud in the AI window settings row (or Settings ▸ Controls ▸ AI Engine).', tier: 'off' };
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
        // STEP-4 gate at the single seam (covers Enter-send, preset runs, and
        // any caller that bypasses the disabled Send button).
        if (!BYO.isConnected()) {
          return { ok: false, error: 'No AI key connected , open the AI window, pick Cloud, and Connect your key (session-only, never stored). Live chat needs it.', tier: 'cloud' };
        }
        return await runCloud(prompt, ctx || buildContext(), cfg);
      }
      return { ok: false, error: 'Unknown tier: ' + tier, tier: tier };
    } catch (e) {
      if (ns.Errors && ns.Errors.log) ns.Errors.log('AI submit failed: ' + (e && e.message), 'aiSubmit');
      return { ok: false, error: 'AI call failed , ' + (e && e.message ? e.message : 'unknown error') + '. The app is unaffected; check Settings ▸ AI Engine and try again.', tier: tier };
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
    if (_aiBusy) return { ok: false, error: 'busy' };
    _aiBusy = true;
    showTyping();
    let res;
    try {
      res = await submit(prompt, ctx, { type: type });
    } catch (e) {
      hideTyping();
      res = { ok: false, error: (e && e.message) || 'AI run failed.' };
    } finally {
      _aiBusy = false;
    }
    await holdTyping();
    renderThread(prompt, res);
    if (res.ok) {
      // Structured write-back into unified state (constraint #1/#5).
      ns.State.updateState(function(s) {
        if (!s.aiOutputs) s.aiOutputs = {};
        s.aiOutputs[type] = {
          at: new Date().toISOString(),
          tier: res.tier,
          model: res.model,
          fellBackFrom: res.fellBackFrom,
          promptType: type,
          text: res.text,
          trace: res.trace || []
        };
      });
      renderOutput(type, res);
      toast('Preset run complete , saved to project state (' + res.tier + ').', 'ok');
      return res;
    }
    renderOutput(type, res);
    toast(res.error || 'AI run failed.', 'err');
    return res;
  }

  // ---- Run the free-form question box ----
  let _aiBusy = false; // guards the Send path against rapid double-submits
  async function runQuestion() {
    if (_aiBusy) return { ok: false, error: 'busy' };
    const q = U.$('ai-q');
    const c = U.$('ai-ctx');
    const prompt = (q && q.value) || '';
    if (!prompt.trim()) { toast('Type a question first.', 'err'); return { ok: false, error: 'empty question' }; }
    const ctx = (c && c.value) ? c.value : buildContext();
    _aiBusy = true;
    showTyping();
    let res;
    try {
      res = await submit(prompt, ctx, {});
    } catch (e) {
      hideTyping();
      res = { ok: false, error: (e && e.message) || 'AI call failed.' };
    } finally {
      _aiBusy = false;
    }
    await holdTyping();
    renderThread(prompt, res);
    if (res.ok) {
      renderOutput(null, res);
      // AI-WINDOW-SEND-CLEAR: the sent question leaves the input box and lives
      // in the thread , the box empties (and collapses its grown height) so a
      // follow-up can be typed immediately. The answer stays in the thread AND
      // in #ai-out, each with its own copy affordance.
      clearQuestionBox();
      toast('Answer generated (' + res.tier + ').', 'ok');
    } else {
      renderOutput(null, res);
      // Keep the user's text on failure so they can fix/retry without retyping.
      toast(res.error || 'AI call failed.', 'err');
    }
    return res;
  }

  // ---- AI-WINDOW-SEND-CLEAR: empty the question box after a successful send
  // (mirrors the clear() reset , value, grown height, at-cap marker) and put
  // focus back in it so the next question can be typed immediately.
  function clearQuestionBox() {
    const q = U.$('ai-q');
    if (!q) return;
    q.value = '';
    q.style.height = '';
    q.classList.remove('at-cap');
    q.focus();
  }

  // ---- Render the result panel (#ai-out) ----
  function renderOutput(type, res) {
    const out = U.$('ai-out');
    if (!out) return;
    if (res && res.ok) {
      out.value = (type ? '[' + type + ' · ' + res.tier + ' · ' + (res.model || '') + ' , saved to project]\n\n' : '[answer · ' + res.tier + ' · ' + (res.model || '') + ']\n\n') + res.text;
      const trace = U.$('ai-trace');
      if (trace) trace.textContent = 'Traceable to: ' + ((res.trace && res.trace.length) ? res.trace.join(', ') : '(grounded in attached context)');
    } else {
      out.value = '-';
      const trace = U.$('ai-trace');
      if (trace) trace.textContent = (res && res.error) ? res.error : '';
    }
  }

  function copyOut() {
    const out = U.$('ai-out');
    if (!out || !out.value || out.value === '-') { toast('Nothing to copy yet , run a preset first.', 'err'); return; }
    U.copyToClipboard(out.value);
    toast('Result copied.');
  }

  // ---- Chat-thread rendering ----------------------------------------------
  // The window renders each exchange as user/assistant bubbles (a real chat
  // UI) while #ai-out stays the hidden functional store copyOut/state use.
  let _typingEl = null;
  let _typingShownAt = 0;
  const MIN_TYPING_MS = 500; // hold the typing beat long enough to read, even for instant local answers
  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = (s === undefined || s === null) ? '' : String(s);
    return d.innerHTML;
  }
  function scrollThread() {
    const th = U.$('ai-thread');
    if (th) th.scrollTop = th.scrollHeight;
  }
  function hideWelcome() {
    const w = U.$('ai-welcome');
    if (w) w.classList.add('is-hide');
  }
  function hideTyping() {
    if (_typingEl) { _typingEl.remove(); _typingEl = null; }
  }
  function resetThread() {
    hideTyping();
    const th = U.$('ai-thread');
    if (!th) return;
    if (th.dataset) delete th.dataset.seeded;
    Array.prototype.forEach.call(th.querySelectorAll('.ai-bubble'), function(b) {
      if (b.id !== 'ai-welcome') b.remove();
    });
    const w = U.$('ai-welcome');
    if (w) w.classList.remove('is-hide');
  }
  function showTyping() {
    const th = U.$('ai-thread');
    if (!th) return;
    hideWelcome();
    hideTyping();
    _typingShownAt = Date.now();
    _typingEl = document.createElement('div');
    _typingEl.className = 'ai-bubble ai-bot ai-typing';
    _typingEl.innerHTML = '<span></span><span></span><span></span>';
    th.appendChild(_typingEl);
    scrollThread();
  }
  // Let the typing beat play for at least MIN_TYPING_MS so fast (local) answers
  // don't blink it away imperceptibly. Adds no latency when the call is slower.
  async function holdTyping() {
    const elapsed = Date.now() - _typingShownAt;
    if (elapsed < MIN_TYPING_MS) {
      await new Promise(function(r) { setTimeout(r, MIN_TYPING_MS - elapsed); });
    }
  }
  function addBubble(role, innerHtml, copyText) {
    const th = U.$('ai-thread');
    if (!th) return;
    hideWelcome();
    const b = document.createElement('div');
    b.className = role === 'user' ? 'ai-bubble ai-user' : 'ai-bubble ai-bot';
    b.innerHTML = innerHtml;
    if (copyText !== undefined && copyText !== null) b.dataset.copyText = String(copyText);
    th.appendChild(b);
    scrollThread();
  }
  function botAvatar() {
    return '<div class="ai-bot-avatar"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-sparkle"></use></svg></div>';
  }
  // AI-FALLBACK-BADGE: ONE shared chip builder , renderThread and
  // seedThreadFromState both call it, so the two render paths can never
  // drift (same convention as the shared fallback ladder itself). Returns
  // '' when no fallback fired. Tier gate keeps it cloud-only (the only tier
  // with a ladder).
  function fallbackBadgeHtml(tier, model, fellBackFrom) {
    if (tier !== 'cloud' || !fellBackFrom || !model || fellBackFrom === model) return '';
    return '<div class="ai-fallback" role="status"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-down"></use></svg> Fell back to <strong>' + escHtml(model) + '</strong> , ' + escHtml(fellBackFrom) + ' hit its rate limit</div>';
  }

  function botBubbleHtml(textHtml, metaHtml, badgeHtml, traceHtml) {
    return botAvatar() + '<div class="ai-bot-body"><div class="ai-text">' + textHtml + '</div>' + (metaHtml || '') + (badgeHtml || '') + (traceHtml || '') + '</div>';
  }
  function botMeta(engine, copyHtml) {
    return '<div class="ai-meta"><span><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> ' + escHtml(engine) + '</span>' + (copyHtml || '') + '</div>';
  }
  // AI-WINDOW-POLISH: every assistant bubble carries a per-answer Copy button
  // in its meta row. The raw text rides on the bubble's dataset (set via DOM
  // property , never interpolated into markup), so the clipboard copy is exact
  // while the rendered bubble stays fully escaped. Delegated click handling
  // below; no per-bubble listeners.
  function copyBtnHtml() {
    return '<button type="button" class="ai-copy-btn" title="Copy this answer" aria-label="Copy this answer"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy</button>';
  }
  // Render one exchange: prompt = user bubble, res = submit() result shape.
  function renderThread(prompt, res) {
    hideTyping();
    if (prompt && String(prompt).trim()) {
      addBubble('user', escHtml(prompt).replace(/\n/g, '<br>'));
    }
    if (!res) return;
    if (res.ok) {
      const engine = (res.tier === 'local') ? 'Local engine' : (res.tier === 'cloud' ? 'Cloud' : res.tier) + (res.model ? ' · ' + res.model : '');
      // MODEL-FALLBACK-LADDER badge (DIR-4 visibility): when a 429 pushed the
      // ladder to a smaller model, render a visible chip so users see the
      // fallback fired WITHOUT having to read the trace line.
      const fallback = fallbackBadgeHtml(res.tier, res.model, res.fellBackFrom);
      const trace = (res.trace && res.trace.length)
        ? '<div class="ai-trace-inline">Traceable to: ' + escHtml(res.trace.join(', ')) + '</div>'
        : '';
      addBubble('bot', botBubbleHtml(escHtml(res.text).replace(/\n/g, '<br>'), botMeta(engine, copyBtnHtml()), fallback, trace), res.text);
    } else {
      addBubble('bot', botAvatar() + '<div class="ai-bot-body ai-err">' + escHtml(res.error || 'Something went wrong.') + '</div>');
    }
  }
  // On open, surface the most recent persisted result so the conversation
  // feels continuous (reads state.aiOutputs only , never invents anything).
  function seedThreadFromState() {
    const th = U.$('ai-thread');
    if (!th || th.dataset.seeded) return;
    th.dataset.seeded = '1';
    const s = (ns.State && ns.State.getState) ? ns.State.getState() : {};
    const outputs = (s && s.aiOutputs) || {};
    const types = Object.keys(outputs);
    if (!types.length) return;
    const last = outputs[types[types.length - 1]];
    if (!last || !last.text) return;
    const engine = (last.tier === 'local') ? 'Local engine' : (last.tier === 'cloud' ? 'Cloud' : last.tier);
    const badge = fallbackBadgeHtml(last.tier, last.model, last.fellBackFrom);
    addBubble('bot', botBubbleHtml(escHtml(last.text).replace(/\n/g, '<br>'),
      botMeta(engine + ' · saved ' + (last.at ? new Date(last.at).toLocaleString() : ''), copyBtnHtml()), badge), last.text);
  }

  // ---- DIR-1 (AI-WINDOW-LAYOUT-SCROLL-AND-INPUT-BUG): Chat/Presets tab ----
  // segment , swaps which pane is visible. UI-only, wired directly (like the
  // BYO controls) so it never touches the read-only action lists. Both panes
  // stay in the DOM, so switching needs no re-render; the presets pane is
  // reachable regardless of conversation length. open() resets to the Chat
  // tab so the welcome hint matches the view on first open.
  function setAiTab(tab) {
    document.querySelectorAll('.ai-seg-btn').forEach(function(b) {
      const on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const c = U.$('ai-pane-chat');
    const p = U.$('ai-pane-presets');
    if (c) c.classList.toggle('is-hide', tab !== 'chat');
    if (p) p.classList.toggle('is-hide', tab !== 'presets');
  }
  (function() {
    const segBtns = document.querySelectorAll('.ai-seg-btn');
    if (!segBtns.length) return;
    segBtns.forEach(function(b) {
      b.addEventListener('click', function() {
        setAiTab(b.getAttribute('data-tab') || 'chat');
      });
    });
  })();

  // AI-WINDOW-POLISH: per-bubble Copy , delegated on the thread so bubbles
  // added at any time (live chat or state seed) pick it up without rebinding.
  // The exact answer text is read from the bubble's dataset.copyText.
  (function() {
    const th = U.$('ai-thread');
    if (!th) return;
    // REVIEW FIX: a single shared timer , rapid re-clicks clear the pending
    // restore instead of stacking stale captures (double-click used to leave
    // the label stuck on "Copied" without the green styling). The reset also
    // restores the static known HTML + aria-label, never a captured snapshot.
    let resetTimer = null;
    th.addEventListener('click', function(e) {
      const t = e.target;
      const btn = (t && t.closest) ? t.closest('.ai-copy-btn') : null;
      if (!btn) return;
      const bubble = btn.closest('.ai-bubble');
      const text = (bubble && bubble.dataset) ? bubble.dataset.copyText : '';
      if (!text) { toast('Nothing to copy here yet.', 'err'); return; }
      U.copyToClipboard(text);
      toast('Answer copied.');
      if (resetTimer) clearTimeout(resetTimer);
      btn.classList.add('is-copied');
      btn.setAttribute('aria-label', 'Copied');
      btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Copied';
      resetTimer = setTimeout(function() {
        btn.classList.remove('is-copied');
        btn.setAttribute('aria-label', 'Copy this answer');
        btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy';
        resetTimer = null;
      }, 1600);
    });
  })();

  // ---- Chat input: Enter sends (Shift+Enter = new line) + auto-grow ------
  (function() {
    const q = U.$('ai-q');
    if (!q) return;
    q.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        runQuestion();
      }
    });
    const grow = function() {
      q.style.height = 'auto';
      q.style.height = Math.min(q.scrollHeight, 120) + 'px';
      // DIR-2: when the box is capped at 120px and internally scrollable, mark
      // it so CSS can show the top-edge fade (scrollable, not clipped).
      q.classList.toggle('at-cap', q.scrollHeight > q.offsetHeight + 2);
    };
    q.addEventListener('input', grow);
    q.addEventListener('focus', grow);
  })();

  // ---- BYO Connect/Clear controls (STEP-2) ----
  // Wired directly (not through the action map) so the vault flow never
  // touches the read-only action lists , connecting a key is not a project
  // mutation and must stay available in view-only mode.
  (function() {
    const conn = U.$('ai-byo-connect');
    if (conn) conn.addEventListener('click', function() {
      const p = U.$('ai-byo-provider');
      const k = U.$('ai-byo-key');
      connectByo((p && p.value) || 'openai', (k && k.value) || '');
    });
    const clr = U.$('ai-byo-clear');
    if (clr) clr.addEventListener('click', clearByo);
    const pk = U.$('ai-byo-key');
    if (pk) pk.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const p = U.$('ai-byo-provider');
        connectByo((p && p.value) || 'openai', pk.value);
      }
    });
  })();

  // UI-DECLUTTER: the API-key setup (paste + Connect & Test + security
  // footnote) lives in a popover toggled by the settings gear , the status
  // chip and provider select stay visible in the strip, the raw key input is
  // one click away. Wired directly (like the connect/clear buttons above) so
  // it stays available in view-only mode.
  (function() {
    const gear = U.$('ai-byo-gear');
    const pop = U.$('ai-byo-pop');
    if (!gear || !pop) return;
    gear.addEventListener('click', function() {
      const open = pop.classList.contains('is-hide');
      pop.classList.toggle('is-hide', !open);
      gear.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  })();

  // INTEGRATED-STRUCTURE-API-WINDOW (plan §3): click (or Enter/Space on) the
  // API pill to re-check the backend health route on demand. force=true so a
  // user re-check bypasses an in-flight earlier probe.
  (function() {
    const pill = U.$('ai-api-pill');
    if (!pill) return;
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.addEventListener('click', function() { checkApiHealth(true); });
    pill.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        checkApiHealth(true);
      }
    });
  })();

  // ---- AI-WINDOW-RESIZE: edge/corner drag resize + per-device persistence ----
  // The size lives in localStorage under mmgr_ai_size (the same device-pref
  // slot pattern as mmgr_theme) , a UI preference, deliberately NOT project
  // state. Restored on open, clamped to the current viewport, min 480x360.
  const AI_SIZE_KEY = 'mmgr_ai_size';
  const AI_SIZE_MIN_W = 480;
  const AI_SIZE_MIN_H = 360;

  function readAiSizePref() {
    try {
      const raw = localStorage.getItem(AI_SIZE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const w = Math.round(Number(d && d.w));
      const h = Math.round(Number(d && d.h));
      if (!(w > 0) || !(h > 0)) return null;
      return { w: w, h: h };
    } catch (e) { return null; }
  }

  function clampAiSize(w, h) {
    const maxW = Math.max(AI_SIZE_MIN_W, window.innerWidth - 40);
    const maxH = Math.max(AI_SIZE_MIN_H, window.innerHeight - 40);
    return {
      w: Math.min(Math.max(Math.round(w), AI_SIZE_MIN_W), maxW),
      h: Math.min(Math.max(Math.round(h), AI_SIZE_MIN_H), maxH)
    };
  }

  function saveAiSize(w, h) {
    try { localStorage.setItem(AI_SIZE_KEY, JSON.stringify({ w: w, h: h })); } catch (e) { /* ignore */ }
  }

  // Restore the saved size on open: clear any session absolute position so the
  // modal re-centers, then apply the saved (clamped) size. No saved size ->
  // the CSS default (min(1500px,100%) x min(92vh,950px)) applies.
  function applyAiSizePref() {
    const modal = U.$('ai-win-mb');
    if (!modal) return;
    modal.style.position = '';
    modal.style.left = '';
    modal.style.top = '';
    const p = readAiSizePref();
    if (p) {
      const c = clampAiSize(p.w, p.h);
      modal.style.width = c.w + 'px';
      modal.style.height = c.h + 'px';
    } else {
      modal.style.width = '';
      modal.style.height = '';
    }
  }

  (function() {
    const modal = U.$('ai-win-mb');
    if (!modal) return;
    const handles = Array.prototype.slice.call(modal.querySelectorAll('.ai-rz'));
    if (!handles.length) return;
    let drag = null;
    function onDown(e) {
      const edge = e.currentTarget.getAttribute('data-edge') || 'se';
      const r = modal.getBoundingClientRect();
      // Anchor absolutely at the current rect so edge drags track the cursor
      // 1:1 (flex centering would re-center and halve the delta).
      modal.style.position = 'absolute';
      modal.style.left = r.left + 'px';
      modal.style.top = r.top + 'px';
      modal.style.width = r.width + 'px';
      modal.style.height = r.height + 'px';
      drag = { edge: edge, startX: e.clientX, startY: e.clientY, left: r.left, top: r.top, width: r.width, height: r.height, w: null, h: null };
      e.preventDefault();
      try { if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    }
    function onMove(e) {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const edge = drag.edge;
      let width = drag.width;
      let height = drag.height;
      if (edge.indexOf('e') > -1) width = drag.width + dx;
      if (edge.indexOf('s') > -1) height = drag.height + dy;
      if (edge.indexOf('w') > -1) width = drag.width - dx;
      if (edge.indexOf('n') > -1) height = drag.height - dy;
      const c = clampAiSize(width, height);
      drag.w = c.w;
      drag.h = c.h;
      let left = drag.left;
      let top = drag.top;
      // Keep the fixed edge pinned when the opposite drag is clamped.
      if (edge.indexOf('w') > -1) left = drag.left + (drag.width - c.w);
      if (edge.indexOf('n') > -1) top = drag.top + (drag.height - c.h);
      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
      modal.style.width = c.w + 'px';
      modal.style.height = c.h + 'px';
    }
    function onUp() {
      if (!drag) return;
      // Persist the size tracked on the drag object (set by onMove); a press
      // without a move leaves w/h null and saves nothing.
      const w = drag.w;
      const h = drag.h;
      drag = null;
      if (w && h && w >= AI_SIZE_MIN_W && h >= AI_SIZE_MIN_H) saveAiSize(w, h);
    }
    handles.forEach(function(h) {
      h.addEventListener('pointerdown', onDown);
      h.addEventListener('pointermove', onMove);
      h.addEventListener('pointerup', onUp);
      h.addEventListener('pointercancel', onUp);
    });
    // A release anywhere (not just on the handle) ends the drag.
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  })();

  // ---- Dashboard command card ----
  // The single Ask-your-project entry point: opens the AI assistant with the
  // question pre-filled and runs it right away (one action, no second Send).
  function askFromCommandBar(e) {
    var inp = document.getElementById('ai-command-input');
    if (!inp) return;
    var val = inp.value.trim();
    inp.value = '';
    open();
    if (!val) return; // empty Ask just opens the assistant
    var aiQ = U.$('ai-q');
    if (aiQ) aiQ.value = val;
    // Small delay lets the window settle (thread seed + focus) before the run.
    setTimeout(function() {
      if (typeof runQuestion === 'function') runQuestion();
    }, 120);
  }
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    var inp = document.getElementById('ai-command-input');
    if (!inp || document.activeElement !== inp) return;
    e.preventDefault();
    askFromCommandBar(e);
  });
  document.addEventListener('click', function(e) {
    var btn = e.target.closest ? e.target.closest('#ai-command-btn') : null;
    if (!btn) return;
    askFromCommandBar(e);
  });

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
    tglDrawerTier: tglDrawerTier,
    submit: submit,
    runPreset: runPreset,
    runQuestion: runQuestion,
    renderOutput: renderOutput,
    copyOut: copyOut,
    syncSettingsUI: syncSettingsUI,
    // BYO-AI-KEY-SESSION-ONLY-v1 + AI-CLOUD-CONNECT-UI (DIR-1)
    connectByo: connectByo,
    clearByo: clearByo,
    syncByoStatus: syncByoStatus,
    syncSendGate: syncSendGate,
    getConnectionState: getConnectionState,
    setConnectionStatus: setConnectionStatus,
    probeProvider: probeProvider,
    // INTEGRATED-STRUCTURE-API-WINDOW (plan §1/§3)
    checkApiHealth: checkApiHealth,
    setApiStatus: setApiStatus,
    // AI-WINDOW-RESIZE
    readAiSizePref: readAiSizePref,
    saveAiSize: saveAiSize,
    clampAiSize: clampAiSize,
    applyAiSizePref: applyAiSizePref
  };
})(MMGR);
window.MMGR = MMGR;
