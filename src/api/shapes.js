/* ============================================================
   API SHAPES — read-only resource projections
   ------------------------------------------------------------
   Extracted from worker.js. Pure functions: take a state object,
   return a shaped data object. Zero dependencies on request/env.
   ============================================================ */
import { json, cloudForbidden, cloudAuthOwnerEither, cloudReadState } from '../lib/http.js';

// ---- date helpers (mirror mmgr-utils.js DL-string handling) ---

function apiDaysBetween(a, b) {
  const A = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const B = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((B - A) / 86400000);
}

function apiIsOverdue(endDate) {
  if (!endDate) return false;
  const d = new Date(String(endDate).replace(/-/g, '/') + ' 00:00:00');
  if (isNaN(d)) return false;
  return d < new Date();
}

function apiDayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// ---- tasks — counts + the raw list (id/name/status/dates/critical only) ---

function apiTasks(state) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400000);
  const done = tasks.filter(t => t.status === 'completed').length;
  const overdue = tasks.filter(t => t.status !== 'completed' && apiIsOverdue(t.endDate));
  const dueSoon = tasks.filter(t => t.status !== 'completed' && t.endDate && !apiIsOverdue(t.endDate) && new Date(String(t.endDate).replace(/-/g, '/')) <= in7);
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  return {
    shape: 'tasks', count: tasks.length, completed: done, inProgress: tasks.filter(t => t.status === 'inprogress').length,
    blocked: blocked, overdueCount: overdue.length, dueSoonCount: dueSoon.length,
    overdue: overdue.map(t => ({ id: t.id, name: t.name || t.id, endDate: t.endDate || null })),
    dueSoon: dueSoon.map(t => ({ id: t.id, name: t.name || t.id, endDate: t.endDate || null })),
    tasks: tasks.map(t => ({ id: t.id, name: t.name || t.id, status: t.status || 'todo', startDate: t.startDate || null, endDate: t.endDate || null, critical: !!t.critical }))
  };
}

// ---- baseline — saved baseline vs current completion ---

function apiBaseline(state) {
  const base = state.baseline || null;
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const baseTasks = (base && Array.isArray(base.tasks)) ? base.tasks : [];
  const curDone = tasks.filter(t => t.status === 'completed').length;
  const baseDone = baseTasks.filter(t => t.status === 'completed').length;
  return {
    shape: 'baseline', saved: !!base, capturedAt: (base && base.capturedAt) || null,
    currentTotal: tasks.length, currentCompleted: curDone, currentPct: tasks.length ? Math.round(curDone / tasks.length * 100) : 0,
    baselineTotal: baseTasks.length, baselineCompleted: baseDone, baselinePct: baseTasks.length ? Math.round(baseDone / baseTasks.length * 100) : null
  };
}

// ---- risks — open vs resolved + high/critical flags ---

function apiRisks(state) {
  const risks = Array.isArray(state.risks) ? state.risks : [];
  const issues = Array.isArray(state.issues) ? state.issues : [];
  const open = risks.filter(r => !r.issueId);
  const high = open.filter(r => /high/i.test(r.probability || '') || /high/i.test(r.impact || ''));
  return {
    shape: 'risks', count: risks.length, openCount: open.length,
    highCount: high.length, issuesCount: issues.length,
    risks: risks.map(r => ({ id: r.id, description: r.description || '(untitled)', probability: r.probability || null, impact: r.impact || null, status: r.status || 'open', promoted: !!r.issueId })),
    issues: issues.map(i => ({ id: i.id, description: i.description || '(untitled)', status: i.status || 'open', owner: i.owner || null }))
  };
}

// ---- weather — cached forecast risk days + delay log ---

function apiWeather(state) {
  const cache = state.wxCache || null;
  const days = (cache && Array.isArray(cache.days)) ? cache.days : [];
  const today = apiDayStart(new Date());
  const in7 = new Date(today.getTime() + 7 * 86400000);
  const riskDays = days.filter(d => {
    const dateObj = new Date(String(d.date).replace(/-/g, '/') + ' 00:00:00');
    if (isNaN(dateObj) || dateObj < today || dateObj > in7) return false;
    return (+d.precip || 0) >= 60 || (+d.tMax || 0) >= 32 || (+d.tMin || 0) <= 0;
  }).map(d => ({ date: d.date, precip: +d.precip || 0, tMax: +d.tMax || 0, tMin: +d.tMin || 0 }));
  const log = Array.isArray(state.weatherLog) ? state.weatherLog : [];
  return {
    shape: 'weather', cachedAt: (cache && cache.at) ? new Date(cache.at).toISOString() : null,
    riskDayCount: riskDays.length, riskDays: riskDays,
    logCount: log.length,
    log: log.map(w => ({ date: w.date || null, condition: w.condition || null, delayDays: +w.delayDays || 0, cause: w.cause || null })).slice(-30)
  };
}

// ---- evm — faithful port of computeEVM (Spend math) ---

function apiEVM(state) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const tot = tasks.length;
  if (!tot) return { shape: 'evm', available: false };
  const dn = tasks.filter(t => t.status === 'completed').length;
  const pct = dn / tot;
  const lines = Array.isArray(state.budgetLines) ? state.budgetLines : [];
  const spendLog = Array.isArray(state.spendLog) ? state.spendLog : [];
  const lineActual = function(line) {
    const log = spendLog.filter(e => e.budgetLineId === line.id);
    if (log.length) return log.reduce((s, e) => s + (+e.amount || 0), 0);
    return +line.actual || 0;
  };
  const tp = lines.reduce((sum, l) => sum + (+l.planned || 0), 0);
  const ta = lines.reduce((sum, l) => sum + lineActual(l), 0);
  if (!tp) return { shape: 'evm', available: false };
  const windowOf = function(line) {
    const linkId = line.linkedTaskId || line.taskId || null;
    if (linkId) {
      const t = tasks.find(x => String(x.id) === String(linkId));
      if (t && t.startDate && t.endDate) return { start: new Date(String(t.startDate).replace(/-/g, '/')), end: new Date(String(t.endDate).replace(/-/g, '/')) };
    }
    const dated = tasks.filter(t => t.startDate && t.endDate);
    if (!dated.length) return null;
    const starts = dated.map(t => new Date(String(t.startDate).replace(/-/g, '/')).getTime());
    const ends = dated.map(t => new Date(String(t.endDate).replace(/-/g, '/')).getTime());
    return { start: new Date(Math.min.apply(null, starts)), end: new Date(Math.max.apply(null, ends)) };
  };
  const curveFraction = function(t, shape) {
    t = Math.max(0, Math.min(1, t));
    const s = shape === 'bell' ? 'scurve' : shape === 'front-loaded' ? 'front' : shape === 'back-loaded' ? 'back' : shape;
    if (s === 'scurve') return t * t * (3 - 2 * t);
    if (s === 'front') return 1 - Math.pow(1 - t, 2);
    if (s === 'back') return t * t;
    return t;
  };
  const today = apiDayStart(new Date());
  const pv = lines.reduce((sum, l) => {
    const planned = +l.planned || 0;
    const w = windowOf(l);
    if (!w) return sum + planned * pct;
    const span = w.end - w.start;
    if (today <= w.start) return sum;
    if (today >= w.end || span <= 0) return sum + planned;
    return sum + planned * curveFraction((today - w.start) / span, l.curveShape || l.curve || 'linear');
  }, 0);
  const ev = lines.reduce((sum, l) => {
    const planned = +l.planned || 0;
    const linkId = l.linkedTaskId || l.taskId || null;
    if (linkId) {
      const t = tasks.find(x => String(x.id) === String(linkId));
      if (t) return sum + planned * (t.status === 'completed' ? 1 : 0);
    }
    return sum + planned * pct;
  }, 0);
  const ac = ta;
  const spi = pv ? ev / pv : null;
  const cpi = ac ? ev / ac : null;
  const bac = tp;
  const eac = cpi ? ac + (bac - ev) / cpi : null;
  const etc = (eac !== null) ? eac - ac : null;
  const vac = (eac !== null) ? bac - eac : null;
  const tden = bac - ac;
  const tcpi = (tden !== 0) ? (bac - ev) / tden : null;
  return { shape: 'evm', available: true, pct: Math.round(pct * 100), planned: tp, actual: ta, pv: Math.round(pv), ev: Math.round(ev), ac: Math.round(ac), spi: spi !== null ? +spi.toFixed(3) : null, cpi: cpi !== null ? +cpi.toFixed(3) : null, sv: Math.round(ev - pv), cv: Math.round(ev - ac), bac: bac, eac: eac !== null ? Math.round(eac) : null, etc: etc !== null ? Math.round(etc) : null, vac: vac !== null ? Math.round(vac) : null, tcpi: tcpi !== null ? +tcpi.toFixed(3) : null };
}

// ---- portfolio — health score (faithful 5-factor port) + derived summary ---

function apiPortfolio(state) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const tot = tasks.length;
  if (!tot) return { shape: 'portfolio', available: false };
  const dn = tasks.filter(t => t.status === 'completed').length;
  const overdue = tasks.filter(t => apiIsOverdue(t.endDate) && t.status !== 'completed').length;
  const liveIssues = (Array.isArray(state.issues) ? state.issues : []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
  const highRisks = (Array.isArray(state.risks) ? state.risks : []).filter(r => !r.issueId && /^high$/i.test(r.probability || '') && /^high$/i.test(r.impact || '')).length;
  const pendingChg = (Array.isArray(state.changes) ? state.changes : []).filter(c => c.status === 'submitted' || c.status === 'review' || !c.status).length;
  const lines = Array.isArray(state.budgetLines) ? state.budgetLines : [];
  const spendLog = Array.isArray(state.spendLog) ? state.spendLog : [];
  const lineActual = function(line) {
    const log = spendLog.filter(e => e.budgetLineId === line.id);
    if (log.length) return log.reduce((s, e) => s + (+e.amount || 0), 0);
    return +line.actual || 0;
  };
  const tp = lines.reduce((sum, b) => sum + (+b.planned || 0), 0);
  const ta = lines.reduce((sum, b) => sum + lineActual(b), 0);
  const pct = dn / tot;
  const cpi = (ta && tp) ? (tp * pct) / ta : null;
  const hasSchedule = tasks.some(t => t.startDate && t.endDate);
  const hasBudget = !!(ta && tp);
  const hasRisks = (Array.isArray(state.risks) ? state.risks : []).length > 0;
  const hasChanges = (Array.isArray(state.changes) ? state.changes : []).length > 0;
  const f1 = (dn / tot) * 100;
  const f2 = hasSchedule ? Math.max(0, 100 - (overdue / tot) * 100) : null;
  const f3 = hasBudget ? Math.max(0, 100 - Math.abs(cpi - 1) * 200) : null;
  const f4 = hasRisks ? Math.max(0, 100 - (liveIssues * 15) - (highRisks * 5)) : null;
  const f5 = hasChanges ? Math.max(0, 100 - (pendingChg * 10)) : null;
  const weights = { f1: 0.30, f2: 0.25, f3: 0.20, f4: 0.15, f5: 0.10 };
  let weightSum = 0, scoreSum = 0;
  [f1, f2, f3, f4, f5].forEach((v, i) => {
    if (v !== null) { weightSum += weights['f' + (i + 1)]; scoreSum += v * weights['f' + (i + 1)]; }
  });
  const score = weightSum ? Math.round(scoreSum / weightSum) : Math.round(f1);
  const atRisk = score < 60;
  return { shape: 'portfolio', available: true, healthScore: score, atRisk: atRisk, completion: Math.round(pct * 100), overdueCount: overdue, liveIssues: liveIssues, highRisks: highRisks, pendingChanges: pendingChg };
}

// ---- shape registry + route handler ---

export const API_SHAPES = { tasks: apiTasks, baseline: apiBaseline, risks: apiRisks, weather: apiWeather, evm: apiEVM, portfolio: apiPortfolio };

// Export individual shapes for webhook evaluator (needs apiPortfolio directly)
export { apiPortfolio };

export async function handleApiShape(request, env, projectId, shape) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT latest_r2_key FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  const state = row && row.latest_r2_key ? await cloudReadState(env, row.latest_r2_key) : null;
  if (!state) return json({ ok: true, shape: shape, exists: false, data: null });
  const builder = API_SHAPES[shape];
  return json({ ok: true, shape: shape, exists: true, generatedAt: new Date().toISOString(), data: builder(state) });
}
