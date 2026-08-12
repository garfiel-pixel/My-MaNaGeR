/* ============================================================
   My MaNaGeR MCP — local engine (ported from the app)
   ------------------------------------------------------------
   Zero-dependency Node port of the app's deterministic AI tier
   (js/mmgr-ai.js localLookup/buildContext, mmgr-health.js,
   mmgr-evm.js, mmgr-forecast.js riskDays, mmgr-claim.js
   computeSlips). Same zero-fabrication discipline: every line
   of output traces to a real state field (the `trace` array),
   and the context dump is the SAME shape the cloud tier is
   grounded on, so local and cloud answers never disagree about
   what the data says.

   Functions are pure: (state, ...) -> result. No I/O.
   ============================================================ */

// ---- date helpers (port of js/mmgr-utils.js parseDL/isOverdue) ----
export function parseDL(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const parts = str.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/').map(Number);
    if (parts[0] > 12) return new Date(parts[2], parts[1] - 1, parts[0]);
    if (parts[1] > 12) return new Date(parts[2], parts[0] - 1, parts[1]);
    return new Date(parts[2], parts[1] - 1, parts[0]); // ambiguous: DD/MM/YYYY
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function isOverdue(endDate) {
  if (!endDate) return false;
  const end = parseDL(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !!end && end < today;
}

// ---- budget helpers (port of mmgr-resources.js / mmgr-health.js) ----
function curveFraction(t, shape) {
  t = Math.max(0, Math.min(1, t));
  const s = shape === 'bell' ? 'scurve' : shape === 'front-loaded' ? 'front' : shape === 'back-loaded' ? 'back' : shape;
  switch (s) {
    case 'scurve': return t * t * (3 - 2 * t);
    case 'front': return 1 - Math.pow(1 - t, 2);
    case 'back': return t * t;
    default: return t;
  }
}

function budgetLineWindow(line, s) {
  if (!s) return null;
  const linkId = line.linkedTaskId || line.taskId || null;
  if (linkId) {
    const t = (s.tasks || []).find(x => String(x.id) === String(linkId));
    if (t && t.startDate && t.endDate) return { start: parseDL(t.startDate), end: parseDL(t.endDate) };
  }
  const dated = (s.tasks || []).filter(t => t.startDate && t.endDate);
  if (!dated.length) return null;
  const starts = dated.map(t => parseDL(t.startDate).getTime());
  const ends = dated.map(t => parseDL(t.endDate).getTime());
  return { start: new Date(Math.min.apply(null, starts)), end: new Date(Math.max.apply(null, ends)) };
}

function lineCumulativeAt(line, asOf, s) {
  const planned = +line.planned || 0;
  const w = budgetLineWindow(line, s);
  if (!w) {
    const tasks = (s && s.tasks) || [];
    const tot = tasks.length;
    const dn = tasks.filter(t => t.status === 'completed').length;
    return planned * (tot ? dn / tot : 0);
  }
  const span = w.end - w.start;
  if (asOf <= w.start) return 0;
  if (asOf >= w.end || span <= 0) return planned;
  return planned * curveFraction((asOf - w.start) / span, line.curveShape || line.curve || 'linear');
}

// A budget line's actual $ — auto-derived from its own Spend Log entries
// once any exist (single source of truth), otherwise the manual value.
export function lineActual(line, s) {
  const log = ((s && s.spendLog) || []).filter(e => e.budgetLineId === line.id);
  if (log.length) return log.reduce((sum, e) => sum + (+e.amount || 0), 0);
  return +line.actual || 0;
}

function budgetCumulativePlannedAt(asOf, s) {
  return ((s && s.budgetLines) || []).reduce((sum, l) => sum + lineCumulativeAt(l, asOf, s), 0);
}

// ---- Health Score (port of mmgr-health.js computeHealthScore) ----
// 5-factor weighted formula: Completion 30% / Schedule 25% / Budget 20% /
// Risk 15% / Change 10%. Returns null when no tasks exist (never fabricates).
export function computeHealth(s) {
  if (!s || !s.tasks) return null;
  const tot = s.tasks.length;
  if (tot === 0) return null;
  const dn = s.tasks.filter(t => t.status === 'completed').length;
  const overdue = s.tasks.filter(t => isOverdue(t.endDate) && t.status !== 'completed').length;
  const liveIssues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
  const highRisks = (s.risks || []).filter(r => !r.issueId && r.probability === 'High' && r.impact === 'High').length;
  const pendingChg = (s.changes || []).filter(c => c.status === 'submitted' || c.status === 'review' || !c.status).length;
  const tp = (s.budgetLines || []).reduce((sum, b) => sum + (+b.planned || 0), 0);
  const ta = (s.budgetLines || []).reduce((sum, b) => sum + lineActual(b, s), 0);
  const pct = dn / tot;
  const ev = tp * pct;
  const cpi = (ta && tp) ? ev / ta : null;
  const hasSchedule = s.tasks.some(t => t.startDate && t.endDate);
  const hasBudget = !!(ta && tp);
  const hasRisks = (s.risks || []).length > 0;
  const hasChanges = (s.changes || []).length > 0;
  const f1 = (dn / tot) * 100;
  const f2 = hasSchedule ? Math.max(0, 100 - (overdue / tot) * 100) : null;
  const f3 = hasBudget ? Math.max(0, 100 - Math.abs(cpi - 1) * 200) : null;
  const f4 = hasRisks ? Math.max(0, 100 - (liveIssues * 15) - (highRisks * 5)) : null;
  const f5 = hasChanges ? Math.max(0, 100 - (pendingChg * 10)) : null;
  const weights = { f1: 0.30, f2: 0.25, f3: 0.20, f4: 0.15, f5: 0.10 };
  const factors = { f1, f2, f3, f4, f5 };
  let weightSum = 0, scoreSum = 0;
  Object.keys(factors).forEach(k => {
    if (factors[k] !== null) { weightSum += weights[k]; scoreSum += factors[k] * weights[k]; }
  });
  const score = weightSum ? Math.round(scoreSum / weightSum) : Math.round(f1);
  return { score, f1, f2, f3, f4, f5, hasSchedule, hasBudget, hasRisks, hasChanges, weightSum };
}

// ---- EVM (port of mmgr-evm.js computeEVM) ----
export function computeEvm(s) {
  if (!s || !s.tasks) return null;
  const tot = s.tasks.length;
  const dn = s.tasks.filter(t => t.status === 'completed').length;
  const pct = tot ? dn / tot : 0;
  const tp = (s.budgetLines || []).reduce((sum, b) => sum + (+b.planned || 0), 0);
  const ta = (s.budgetLines || []).reduce((sum, b) => sum + lineActual(b, s), 0);
  if (!tp || !tot) return null;
  const pv = budgetCumulativePlannedAt(new Date(), s);
  const ev = (s.budgetLines || []).reduce((sum, l) => {
    const planned = +l.planned || 0;
    const linkId = l.linkedTaskId || l.taskId || null;
    if (linkId) {
      const t = s.tasks.find(x => String(x.id) === String(linkId));
      if (t) return sum + planned * (t.status === 'completed' ? 1 : 0);
    }
    return sum + planned * pct;
  }, 0);
  const ac = ta;
  const spi = pv ? ev / pv : null;
  const cpi = ac ? ev / ac : null;
  const sv = ev - pv;
  const cv = ev - ac;
  const bac = tp;
  const eac = cpi ? ac + (bac - ev) / cpi : null;
  const etc = (eac !== null) ? eac - ac : null;
  const vac = (eac !== null) ? bac - eac : null;
  const tden = bac - ac;
  const tcpi = (tden !== 0) ? (bac - ev) / tden : null;
  return { pct, tp, ta, pv, ev, ac, spi, cpi, sv, cv, bac, eac, etc, vac, tcpi };
}

// ---- Weather risk days (port of mmgr-forecast.js riskDays) ----
const RISK_PRECIP = 60;
const HEAT_C = 32;
const COLD_C = 0;

export function riskDays(s) {
  const cache = s && s.wxCache;
  const days = cache && cache.days ? cache.days : [];
  if (!days.length) return [];
  const wxTasks = (s.tasks || []).filter(t => t.weatherSensitive && t.startDate && t.endDate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return days.map(d => {
    const risky = d.precip >= RISK_PRECIP || d.tMax >= HEAT_C || d.tMin <= COLD_C;
    if (!risky) return null;
    const dateObj = parseDL(d.date) || new Date(d.date + 'T00:00:00');
    const within7 = dateObj >= today && dateObj <= new Date(today.getTime() + 7 * 86400000);
    const affected = wxTasks.filter(t => {
      const ts = parseDL(t.startDate), te = parseDL(t.endDate);
      if (!ts || !te) return false;
      return dateObj >= ts && dateObj <= te;
    });
    if (!within7 && !affected.length) return null;
    const alerts = [];
    if (d.precip >= RISK_PRECIP) alerts.push('precip ' + d.precip + '%');
    if (d.tMax >= HEAT_C) alerts.push('heat ' + d.tMax + 'C');
    if (d.tMin <= COLD_C) alerts.push('cold ' + d.tMin + 'C');
    return { date: d.date, code: d.code, precip: d.precip, tMax: d.tMax, tMin: d.tMin, alerts, affected: affected.map(t => t.name) };
  }).filter(Boolean);
}

// ---- Claim slips (port of mmgr-claim.js computeSlips) ----
const DAY = 86400000;

function autoCause(s, task, baseEnd, curEnd) {
  const id = String(task.id);
  const wxHit = (s.weatherLog || []).some(e => {
    const d = parseDL(e.date);
    if (!d) return false;
    if (!(e.affectedTaskIds || []).map(String).some(x => x === id)) return false;
    return d >= baseEnd && d <= curEnd;
  });
  if (wxHit) return 'weather';
  const slippedIds = {};
  ((s.baseline && s.baseline.tasks) || []).forEach(bt => {
    const cur = (s.tasks || []).find(x => String(x.id) === String(bt.id));
    if (cur && bt.endDate && cur.endDate) {
      const d = Math.round((parseDL(cur.endDate) - parseDL(bt.endDate)) / DAY);
      if (d > 0) slippedIds[String(bt.id)] = true;
    }
  });
  if ((task.predecessors || []).some(p => slippedIds[String(p)])) return 'predecessor';
  return 'other';
}

export function computeSlips(s) {
  if (!s) return [];
  const baseMap = {};
  ((s.baseline && s.baseline.tasks) || []).forEach(bt => { baseMap[String(bt.id)] = bt; });
  const slips = [];
  (s.tasks || []).forEach(t => {
    const bt = baseMap[String(t.id)];
    if (!bt || !bt.endDate || !t.endDate) return;
    const baseEnd = parseDL(bt.endDate);
    const curEnd = parseDL(t.endDate);
    if (!baseEnd || !curEnd) return;
    const days = Math.round((curEnd - baseEnd) / DAY);
    if (days <= 0) return;
    slips.push({
      taskId: String(t.id),
      taskName: t.name || String(t.id),
      baselineStart: bt.startDate || '',
      baselineEnd: bt.endDate || '',
      currentStart: t.startDate || '',
      currentEnd: t.endDate || '',
      days,
      cause: autoCause(s, t, baseEnd, curEnd),
      causeSource: 'auto'
    });
  });
  return slips;
}

// ---- Context dump (port of js/mmgr-ai.js buildContext) ----
// The exact grounding payload both the app's cloud tier and this MCP's
// cloud fallback consume. Flat Markdown, section-grouped, every line a
// real state field. Capped at 12,000 chars (~3k tokens).
const CONTEXT_MAX_CHARS = 12000;

export function buildContext(state) {
  const s = state || {};
  const L = [];
  const sec = (title) => L.push('## ' + title);
  const line = (k, v) => L.push('- ' + k + ': ' + (v === undefined || v === null || v === '' ? '—' : v));
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
    const h = computeHealth(s);
    if (h) {
      line('Score', h.score + '/100');
      const label = h.score >= 70 ? 'Healthy' : h.score >= 40 ? 'Needs Attention' : 'At Risk';
      line('Status', label);
    } else {
      line('Score', 'not enough data yet');
    }
    const tasks = s.tasks || [];
    line('Tasks', tasks.length + ' total · ' + tasks.filter(t => t.status === 'completed').length + ' complete');
  } catch (e) {}

  try {
    sec('EVM (Earned Value)');
    const e = computeEvm(s);
    if (e) {
      line('SPI', e.spi !== undefined ? e.spi.toFixed(2) : null);
      line('CPI', e.cpi !== undefined ? e.cpi.toFixed(2) : null);
      line('EV / PV / AC', [e.ev, e.pv, e.ac].map(v => v !== undefined && v !== null ? '$' + Number(v).toLocaleString() : null).join(' / '));
    } else {
      line('Metrics', 'insufficient schedule/budget data');
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
    const rd = riskDays(s);
    line('Weather risk days', rd.length ? rd.slice(0, 5).map(d => d.date + ' (' + d.alerts.join(', ') + ')').join('; ') : 'none in forecast');
    line('Weather delay days logged', (s.weatherLog || []).length);
  } catch (e) {}

  let out = L.join('\n');
  if (out.length > CONTEXT_MAX_CHARS) {
    out = out.slice(0, CONTEXT_MAX_CHARS) + '\n…[context truncated — project data exceeds the safe packet size]';
  }
  return out;
}

// ---- Intent matcher (port of js/mmgr-ai.js localLookup) ----
// Answers a fixed intent set deterministically from state; anything outside
// it returns ok:false with the honest "not answerable locally" message so the
// caller can decide (this MCP: fall back to the cloud tier when a key is set).
export function localLookup(q, s) {
  const TRACE = [];
  const _t = (field) => TRACE.push(field);
  const fmt$ = (n) => '$' + Number(n || 0).toLocaleString();
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
    const od = tasks.filter(t => isOverdue(t.endDate) && t.status !== 'completed');
    _t('tasks[].endDate'); _t('tasks[].status');
    out.push('Overdue: ' + od.length + (od.length ? ' — ' + od.slice(0, 5).map(t => t.name + ' (due ' + t.endDate + ')').join('; ') : '.'));
  }
  if (/budget|cost|spend/.test(lower)) {
    const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
    const actual = (s.budgetLines || []).reduce((n, l) => n + lineActual(l, s), 0);
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
  if (/evm|earned|spi|cpi|variance/.test(lower)) {
    const e = computeEvm(s);
    _t('EVM.compute(s)');
    out.push(e ? 'EVM: SPI ' + e.spi.toFixed(2) + ', CPI ' + e.cpi.toFixed(2) + ', EV ' + fmt$(e.ev) + ' / PV ' + fmt$(e.pv) + ' / AC ' + fmt$(e.ac) + '.' : 'EVM: insufficient schedule/budget data.');
  }
  if (/weather|delay/.test(lower)) {
    const rd = riskDays(s);
    _t('weatherLog'); _t('wxCache');
    out.push('Weather: ' + (s.weatherLog || []).length + ' delay day(s) logged' + (rd.length ? '; risk days: ' + rd.slice(0, 3).map(d => d.date).join(', ') : '') + '.');
  }
  if (/health|score/.test(lower)) {
    const h = computeHealth(s);
    _t('Health.compute(s)');
    out.push(h ? 'Health: ' + h.score + '/100 (' + (h.score >= 70 ? 'Healthy' : h.score >= 40 ? 'Needs Attention' : 'At Risk') + ').' : 'Health: not enough data yet — add tasks.');
  }

  if (!out.length) {
    return {
      ok: false,
      error: 'This question needs reasoning beyond local lookup. Run it on the Cloud tier (set MMGR_MCP_AI_KEY + MMGR_MCP_PROVIDER), or copy the prompt + context into your AI tool.',
      tier: 'local'
    };
  }
  return { ok: true, tier: 'local', model: 'local-state-engine', text: out.join('\n'), trace: TRACE.slice() };
}
