/* ============================================================
   My MaNaGeR — Charter & KPI Management Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const S = () => ns.State.getState();

  // ---- Charter Data ----
  function loadCharterData() {
    const s = S();
    const c = s.charter || {};
    const setVal = (id, val) => { const el = U.$(id); if (el) el.value = val || ''; };
    setVal('ch-name', c.name);
    setVal('ch-sponsor', c.sponsor);
    setVal('ch-target-start', c.targetStart);
    setVal('ch-target-end', c.targetCompletion);
    setVal('ch-obj', c.objective);
    setVal('ch-scope', c.scope);
    setVal('ch-deliverables', c.deliverables);
    setVal('ch-constraints', c.constraints);
    setVal('ch-assumptions', c.assumptions);
    setVal('ch-exclusions', c.exclusions);
    setVal('ch-budget', c.budgetEnvelope);
    renderKpiList();
  }

  function updCharter(field, value) {
    ns.State.updateState(function(s) {
      if (!s.charter) s.charter = {};
      s.charter[field] = value;
    });
  }

  // ─── Linkable KPIs (MONOLITH-PORTING-GUIDE feature 3) ───────────
  // Opt-in traceability: a KPI can point at a live computed metric instead of
  // a hand-typed number. Manual (linkedMetric:null) is the default for every
  // KPI and behaves exactly as before. The target field always stays free
  // text — linking only supplies the *current value*.
  const KPI_METRICS = [
    { key: '', label: '— Manual (default) —' },
    { key: 'spi', label: 'SPI (Schedule Perf. Index)' },
    { key: 'cpi', label: 'CPI (Cost Perf. Index)' },
    { key: 'pctComplete', label: '% Complete' },
    { key: 'overdueTasks', label: 'Overdue Tasks' },
    { key: 'openRisks', label: 'Open Risks' },
    { key: 'healthScore', label: 'Health Score' },
    { key: 'timelineVarianceDays', label: 'Timeline Variance vs Target (days)' },
    { key: 'ltifrRollup', label: 'LTIFR (Quality/Safety + Risks rollup)' },
    { key: 'defectsHandoverRollup', label: 'Defects at Handover (Closeout punch-list)' },
    { key: 'nepaFindingsRollup', label: 'Critical NEPA/Municipal Findings (Precon + QA)' }
  ];

  function kpiMetricLabel(key) {
    return (KPI_METRICS.find(m => m.key === key) || {}).label || '';
  }

  // Walk up from a task to see if any ancestor matches a name pattern.
  function hasBranch(t, pattern) {
    const s = S();
    if (!s || !s.tasks) return false;
    const idx = s.tasks.indexOf(t);
    if (idx < 0) return false;
    for (let j = idx; j >= 0; j--) {
      if (pattern.test(s.tasks[j].name || '')) return true;
      if ((s.tasks[j].level || 0) === 0) break;
    }
    return false;
  }

  // Rollup computations for the three new metrics.
  function computeLtifrRollup() {
    const s = S();
    const tasks = (s && s.tasks) || [];
    const qsSafety = tasks.filter(t => hasBranch(t, /quality|safety/i));
    const done = qsSafety.filter(t => t.status === 'completed').length;
    const openRisks = (s.risks || []).filter(r => r.issueId || (r.probability === 'High' && r.impact === 'High')).length;
    const total = qsSafety.length;
    return total ? Math.round((done / total) * 100) - openRisks * 5 : null;
  }

  function computeDefectsRollup() {
    const s = S();
    const closeout = ((s && s.tasks) || []).filter(t => hasBranch(t, /closeout|close.?out|punch/i));
    return closeout.filter(t => t.status !== 'completed').length;
  }

  function computeNepaRollup() {
    const s = S();
    const branches = ((s && s.tasks) || []).filter(t => hasBranch(t, /preconstruction|precon|quality|safety/i));
    return branches.filter(t => t.status === 'blocked' || (t.notes || '').match(/nepa|municipal|permit|finding/i)).length;
  }

  // Live value for a linked metric key (null when not enough data).
  function kpiLiveValue(metric) {
    const s = S();
    switch (metric) {
      case 'spi': { const e = (ns.Evm && ns.Evm.compute) ? ns.Evm.compute(s) : null; return (e && e.spi != null) ? +e.spi.toFixed(2) : null; }
      case 'cpi': { const e = (ns.Evm && ns.Evm.compute) ? ns.Evm.compute(s) : null; return (e && e.cpi != null) ? +e.cpi.toFixed(2) : null; }
      case 'pctComplete': { const tot = (s.tasks || []).length; return tot ? Math.round(s.tasks.filter(t => t.status === 'completed').length / tot * 100) : null; }
      case 'overdueTasks': return (s.tasks || []).filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
      case 'openRisks': return (s.risks || []).filter(r => !(r.issueId && (r.status === 'resolved'))).length;
      case 'healthScore': return (ns.Health && ns.Health.get) ? ns.Health.get() : null;
      case 'timelineVarianceDays': { const t = (ns.Render && ns.Render.computeTimelineStatus) ? ns.Render.computeTimelineStatus(s) : null; return t ? t.overrunDays : null; }
      case 'ltifrRollup': return computeLtifrRollup();
      case 'defectsHandoverRollup': return computeDefectsRollup();
      case 'nepaFindingsRollup': return computeNepaRollup();
      default: return null;
    }
  }

  // Compares the live value to the user's free-text target using a simple
  // ≥/≤ read (direction chosen per-KPI). If the target has no parseable
  // number, the badge says so instead of guessing.
  function kpiStatus(k) {
    if (!k || !k.linkedMetric) return null;
    const live = kpiLiveValue(k.linkedMetric);
    if (live === null || live === undefined) return { live: null, cls: 'bs', txt: 'No data yet' };
    const num = parseFloat(String(k.target || '').replace(/[^0-9.\-]/g, ''));
    if (isNaN(num)) return { live: live, cls: 'bs', txt: 'Add a numeric target to compare' };
    const lower = k.dir === 'lower';
    const good = lower ? live <= num : live >= num;
    const band = lower ? num * 1.1 : num * 0.9;
    const near = lower ? (live <= band) : (live >= band);
    const cls = good ? 'bg' : (near ? 'ba' : 'br');
    const txt = good ? 'On track' : (near ? 'At risk' : 'Off track');
    return { live: live, cls: cls, txt: txt, num: num };
  }

  function updKPILink(i, metric) {
    ns.State.updateState(function(s) {
      if (s.charter && s.charter.kpis && s.charter.kpis[i]) s.charter.kpis[i].linkedMetric = metric || null;
    });
    renderKpiList();
  }

  function updKPIDir(i, dir) {
    ns.State.updateState(function(s) {
      if (s.charter && s.charter.kpis && s.charter.kpis[i]) s.charter.kpis[i].dir = dir;
    });
    renderKpiList();
  }

  // Shared one-line export used by Copy All / prompts so a linked KPI's
  // live value shows up consistently everywhere.
  function kpiExportLine(k) {
    let s = `- ${k.name || '(unnamed)'} | Target: ${k.target || '—'} | Measure: ${k.measure || '—'}`;
    if (k.linkedMetric) {
      const st = kpiStatus(k);
      s += ` | Live ${kpiMetricLabel(k.linkedMetric)}: ${st.live === null ? 'no data yet' : st.live}${st.txt ? ' (' + st.txt + ')' : ''}`;
    }
    return s;
  }

  // Auto-suggest a live link from the KPI name (Section 5 of the monolith).
  function kpiSuggestLink(name) {
    const n = (name || '').toLowerCase();
    if (/ltifr|lost time|injury/i.test(n)) return 'ltifrRollup';
    if (/defect.*handover|handover.*defect|punch.?list/i.test(n)) return 'defectsHandoverRollup';
    if (/nepa|municipal.*finding|findings.*municipal/i.test(n)) return 'nepaFindingsRollup';
    return null;
  }

  function renderKpiList() {
    const container = U.$('kpi-list');
    if (!container) return;
    const s = S();
    const kpis = (s.charter && s.charter.kpis) || [];
    if (kpis.length === 0) {
      container.innerHTML = '<div style="font-size:.78rem;color:var(--slate)">No KPIs defined. Add one below.</div>';
      return;
    }
    container.innerHTML = kpis.map((kpi, i) => {
      const st = kpiStatus(kpi);
      const statusBadge = st ? `<span class="badge ${st.cls}" style="font-size:.6rem;padding:2px 7px">${st.txt}${st.live !== null ? ' · ' + st.live : ''}</span>` : '';
      return `<div class="kpi-row-wrap">
        <div class="kpi-row">
          <input type="text" value="${U.escapeHtml(kpi.name)}" data-action="updKPI" data-idx="${i}" data-field="name" placeholder="KPI name">
          <input type="text" value="${U.escapeHtml(kpi.target)}" data-action="updKPI" data-idx="${i}" data-field="target" placeholder="Target">
          <select data-action="updKPI" data-idx="${i}" data-field="category" style="flex:0 0 120px">
            <option value="">Category</option>
            <option value="financial" ${kpi.category === 'financial' ? 'selected' : ''}>Financial</option>
            <option value="schedule" ${kpi.category === 'schedule' ? 'selected' : ''}>Schedule</option>
            <option value="quality" ${kpi.category === 'quality' ? 'selected' : ''}>Quality</option>
            <option value="safety" ${kpi.category === 'safety' ? 'selected' : ''}>Safety</option>
            <option value="environmental" ${kpi.category === 'environmental' ? 'selected' : ''}>Environmental</option>
          </select>
          <button class="btn btn-d btn-s" data-action="delKPI" data-idx="${i}">×</button>
        </div>
        <div class="kpi-link-row">
          <span class="kpi-trace"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-link"></use></svg> Trace to live data:</span>
          <select data-action="updKPILink" data-idx="${i}">${KPI_METRICS.map(m => `<option value="${m.key}" ${((kpi.linkedMetric || '') === m.key) ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
          <span style="font-size:.64rem;color:var(--slate)">Direction:</span>
          <select data-action="updKPIDir" data-idx="${i}"><option value="higher" ${kpi.dir !== 'lower' ? 'selected' : ''}>Higher is better</option><option value="lower" ${kpi.dir === 'lower' ? 'selected' : ''}>Lower is better</option></select>
          ${statusBadge}
        </div>
      </div>`;
    }).join('');
  }

  function addKPI() {
    ns.State.updateState(function(s) {
      if (!s.charter) s.charter = {};
      if (!s.charter.kpis) s.charter.kpis = [];
      s.charter.kpis.push({ name: '', target: '', status: '', category: '', measure: '', linkedMetric: null, dir: 'higher', suggestedLinks: [] });
    });
    renderKpiList();
  }

  function updKPI(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.charter && s.charter.kpis && s.charter.kpis[index]) {
        s.charter.kpis[index][field] = value;
        // Auto-link when a name matches a known metric and nothing is linked.
        if (field === 'name' && !s.charter.kpis[index].linkedMetric) {
          const sug = kpiSuggestLink(value);
          if (sug) {
            s.charter.kpis[index].linkedMetric = sug;
            if (ns.App && ns.App.showToast) ns.App.showToast('Auto-linked KPI to ' + kpiMetricLabel(sug), 'ok');
          }
        }
      }
    });
  }

  function delKPI(index) {
    ns.State.updateState(function(s) {
      if (s.charter && s.charter.kpis) s.charter.kpis.splice(index, 1);
    });
    renderKpiList();
  }

  // ---- Charter Upload Modal (MONOLITH-PORTING-GUIDE feature 12) ----
  function openChartUp(text) {
    const modal = U.$('chartup-modal');
    if (!modal) return;
    const src = U.$('cu-source');
    if (src && text !== undefined) src.value = text || '';
    const out = U.$('cu-output');
    if (out) out.value = '';
    regenChartPrompt();
    modal.classList.add('on');
  }

  function closeChartUp() {
    const modal = U.$('chartup-modal');
    if (modal) modal.classList.remove('on');
  }

  // V3.1 — modal tab switcher (Upload File vs Paste Text).
  function cuSwitchTab(which) {
    const tf = U.$('cu-tab-file'), tp = U.$('cu-tab-paste');
    const pf = U.$('cu-pane-file'), pp = U.$('cu-pane-paste');
    if (tf && tp) {
      tf.classList.toggle('active', which === 'file');
      tp.classList.toggle('active', which === 'paste');
    }
    if (pf) pf.classList.toggle('is-hide', which !== 'file');
    if (pp) pp.classList.toggle('is-hide', which !== 'paste');
    if (which === 'paste') { const s = U.$('cu-source'); if (s) setTimeout(() => s.focus(), 50); }
  }

  function uploadCharterDoc() {
    const inp = U.$('charter-upload');
    if (!inp) return;
    inp.value = '';
    inp.click();
  }

  async function handleCharterUpload(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const nmEl = U.$('cu-file-name');
    if (nmEl) nmEl.textContent = f.name;
    cuSwitchTab('file');
    const name = (f.name || '').toLowerCase();
    try {
      let text = '';
      if (name.endsWith('.txt') || name.endsWith('.md')) {
        text = await f.text();
      } else if (name.endsWith('.docx')) {
        // Client-side .docx parsing needs the mammoth library, which this
        // CSP-safe build does not vendor. Fall through to the manual path.
        throw new Error('DOCX files can\'t be parsed in-browser under this app\'s security policy. Open it in Word, select all, copy, and use Paste Text instead.');
      } else if (name.endsWith('.pdf')) {
        throw new Error('PDF files can\'t be parsed in-browser under this app\'s security policy. Open it in a PDF reader, select all, copy, and use Paste Text instead.');
      } else {
        throw new Error('Unsupported file type. Use .txt or .md — or paste the text directly.');
      }
      openChartUp(text.trim());
      if (ns.App && ns.App.showToast) ns.App.showToast('Text extracted — review, generate prompt, then paste AI output', 'ok');
    } catch (err) {
      console.error('Charter upload:', err);
      openChartUp('');
      // Unsupported binary formats land the user on the Paste tab with the
      // cursor ready — one paste away from continuing the workflow.
      cuSwitchTab('paste');
      if (ns.App && ns.App.showToast) ns.App.showToast(err.message || 'Could not extract text.', 'err');
    }
  }

  function generateCharterFillPrompt(textContent) {
    return 'You are an expert Project Manager. Read the charter document below and extract the information into STRICT valid JSON (no prose, no code fences, no comments). Use these exact keys and types:\n'
      + '{\n'
      + '  "name": string,           // Project name\n'
      + '  "sponsor": string,        // Executive sponsor\n'
      + '  "targetStart": "YYYY-MM-DD",    // Planned start date\n'
      + '  "targetCompletion": "YYYY-MM-DD",      // Planned end date\n'
      + '  "budgetEnvelope": number,         // Planned budget in dollars (numeric only)\n'
      + '  "objective": string,      // Business objective / quantifiable outcome\n'
      + '  "scope": string,          // In-scope items\n'
      + '  "deliverables": string,   // Key deliverables\n'
      + '  "constraints": string,    // Constraints\n'
      + '  "assumptions": string,    // Assumptions\n'
      + '  "exclusions": string,     // Out-of-scope items\n'
      + '  "kpis": [ { "name": string, "target": string, "category": "financial|schedule|quality|safety|environmental" } ]\n'
      + '}\n'
      + 'Rules:\n'
      + '- Return ONLY the JSON object. No markdown, no explanations.\n'
      + '- If a field is not present in the document, use "" or 0 or [] as appropriate.\n'
      + '- Preserve original wording where possible; consolidate bullet lists into newline-separated strings.\n\n'
      + 'DOCUMENT CONTENT:\n"""\n' + textContent + '\n"""';
  }

  function regenChartPrompt() {
    const source = U.$('cu-source');
    const prompt = U.$('cu-prompt');
    if (!source || !prompt) return;
    prompt.value = generateCharterFillPrompt(source.value || '[PASTE YOUR CHARTER TEXT ABOVE]');
  }

  function copyChartPrompt() {
    const prompt = U.$('cu-prompt');
    if (prompt && prompt.value) {
      U.copyToClipboard(prompt.value);
      ns.App.showToast('Prompt copied!', 'ok');
    }
  }

  // Tolerant JSON parse: strips code fences and leading/trailing prose.
  function tryParseCharterJSON(raw) {
    if (!raw) return null;
    let t = raw.trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const m = t.match(/\{[\s\S]*\}$/) || t.match(/\{[\s\S]*\}/);
    if (m) t = m[0];
    try { return JSON.parse(t); } catch (e) { return null; }
  }

  // Regex fallback for plain-text charters when the AI output isn't JSON.
  function regexExtractCharter(txt) {
    const grab = (label) => {
      const re = new RegExp('(?:^|\n)\s*' + label + '\s*[:\-–]\s*(.+?)(?=\n\s*[A-Z][A-Za-z /]{2,30}\s*[:\-–]|\n\s*\n|$)', 'is');
      const m = txt.match(re);
      return m ? m[1].trim() : '';
    };
    const budget = (() => { const m = txt.match(/budget\s*[:\-–]\s*\$?\s*([\d,]+(?:\.\d+)?)/i); return m ? +m[1].replace(/,/g, '') : 0; })();
    return {
      name: grab('Project Name') || grab('Project Title') || grab('Project'),
      sponsor: grab('Sponsor') || grab('Executive Sponsor'),
      targetStart: grab('Start Date') || grab('Start'),
      targetCompletion: grab('End Date') || grab('End') || grab('Target Completion'),
      budgetEnvelope: budget,
      objective: grab('Objective') || grab('Quantifiable Outcome') || grab('Success Criteria'),
      scope: grab('In Scope') || grab('In-Scope'),
      deliverables: grab('Deliverables') || grab('Key Deliverables'),
      constraints: grab('Constraints'),
      assumptions: grab('Assumptions'),
      exclusions: grab('Out of Scope') || grab('Out-of-Scope'),
      kpis: []
    };
  }

  function applyChartAIOutput() {
    const output = U.$('cu-output');
    if (!output) {
      ns.App.showToast('Paste AI output first.', 'err');
      return;
    }
    const raw = output.value || '';
    let data = tryParseCharterJSON(raw);
    if (!data) {
      const src = (U.$('cu-source') || {}).value || '';
      if (raw.trim() === '' && src.trim()) data = regexExtractCharter(src);
    }
    if (!data) {
      ns.App.showToast('Could not parse AI output as JSON. Make sure the AI returned a valid JSON object (no markdown fences).', 'err');
      return;
    }
    ns.State.updateState(function(s) {
      if (!s.charter) s.charter = {};
      const f = s.charter;
      const put = (k, v) => { if (v !== undefined && v !== null && v !== '') f[k] = v; };
      put('name', data.name); put('sponsor', data.sponsor);
      put('targetStart', data.targetStart || data.start);
      put('targetCompletion', data.targetCompletion || data.end);
      put('budgetEnvelope', data.budgetEnvelope !== undefined ? +data.budgetEnvelope : (data.budget !== undefined ? +data.budget : undefined));
      put('objective', data.objective || data.qo || data.req);
      put('scope', data.scope || data.ins);
      put('deliverables', data.deliverables || data.del);
      put('constraints', data.constraints || data['const']);
      put('assumptions', data.assumptions || data.assum);
      put('exclusions', data.exclusions || data.outs);
      if (Array.isArray(data.kpis) && data.kpis.length) {
        if (!s.charter.kpis) s.charter.kpis = [];
        data.kpis.forEach(k => {
          if (!k) return;
          s.charter.kpis.push({ name: k.name || '', target: k.target || '', status: '', category: k.category || '', measure: k.unit || '', linkedMetric: null, dir: 'higher', suggestedLinks: [] });
        });
      }
    });
    loadCharterData();
    closeChartUp();
    ns.App.showToast('Charter fields populated from AI output', 'ok');
  }

  // ---- MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-5: Print Charter ----
  // Restores the monolith's printCharter() — a scoped print that shows only
  // the charter section (body.print-charter + .charter-print-root, CSS
  // already present in css/mmgr.css). The textarea-expansion step fixes the
  // classic bug where a <textarea> only prints its scrolled-into-view text.
  function printCharter() {
    document.body.classList.add('print-charter');
    const tas = document.querySelectorAll('.charter-print-root textarea');
    const restore = [];
    tas.forEach(t => { restore.push([t, t.style.height]); t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; });
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.body.classList.remove('print-charter');
        restore.forEach(([t, h]) => { t.style.height = h; });
      }, 500);
    }, 100);
  }

  // ---- MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-6: Save Charter button ----
  // Restores the monolith's saveCharter() — an explicit save distinct from
  // the silent debounced autosave, with a confirming toast so the user gets
  // positive, visible confirmation the charter was persisted.
  function saveCharter() {
    const read = (id) => { const el = U.$(id); return el ? el.value : undefined; };
    const vals = {
      name: read('ch-name'),
      sponsor: read('ch-sponsor'),
      targetStart: read('ch-target-start'),
      targetCompletion: read('ch-target-end'),
      objective: read('ch-obj'),
      scope: read('ch-scope'),
      deliverables: read('ch-deliverables'),
      constraints: read('ch-constraints'),
      assumptions: read('ch-assumptions'),
      exclusions: read('ch-exclusions'),
      // budgetEnvelope is numeric everywhere else in state — coerce on save
      // so downstream math (buildBudgetSummary, EVM) never sees a string.
      budgetEnvelope: read('ch-budget') !== undefined && read('ch-budget') !== '' ? +read('ch-budget') : undefined
    };
    ns.State.updateState(function(st) {
      if (!st.charter) st.charter = {};
      Object.keys(vals).forEach(k => { if (vals[k] !== undefined) st.charter[k] = vals[k]; });
    });
    ns.State.save(true);
    if (ns.App && ns.App.showToast) ns.App.showToast('Charter saved!', 'ok');
  }

  // ---- API ----
  ns.Charter = {
    loadCharterData: loadCharterData,
    updCharter: updCharter,
    renderKpiList: renderKpiList,
    addKPI: addKPI,
    updKPI: updKPI,
    delKPI: delKPI,
    KPI_METRICS: KPI_METRICS,
    kpiMetricLabel: kpiMetricLabel,
    kpiLiveValue: kpiLiveValue,
    kpiStatus: kpiStatus,
    kpiExportLine: kpiExportLine,
    updKPILink: updKPILink,
    updKPIDir: updKPIDir,
    openChartUp: openChartUp,
    closeChartUp: closeChartUp,
    cuSwitchTab: cuSwitchTab,
    uploadCharterDoc: uploadCharterDoc,
    handleCharterUpload: handleCharterUpload,
    generateCharterFillPrompt: generateCharterFillPrompt,
    regenChartPrompt: regenChartPrompt,
    copyChartPrompt: copyChartPrompt,
    tryParseCharterJSON: tryParseCharterJSON,
    regexExtractCharter: regexExtractCharter,
    applyChartAIOutput: applyChartAIOutput,
    printCharter: printCharter,
    saveCharter: saveCharter
  };

})(MMGR);
window.MMGR = MMGR;