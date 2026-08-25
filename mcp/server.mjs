#!/usr/bin/env node
/* ============================================================
   My MaNaGeR MCP server — zero-dependency stdio server
   ------------------------------------------------------------
   Exposes a construction project's exported state JSON (the app's
   portable single-file format) to MCP clients (Claude Desktop,
   Cursor, Claude Code, Gemini CLI, ...) as read/analytics tools,
   a local-first answer_question with cloud fallback, and — when
   MMGR_MCP_ALLOW_WRITES=1 — two-phase OWNER-APPROVED write tools.

   Safety model (per security-audit AI-AND-LLM.md):
   - Model output is untrusted input: every write op is validated
     by mcp/lib/validate.mjs (field whitelists + enum/type checks)
     BEFORE it can touch the file. No free-form JSON path writes.
   - Writes are two-phase: propose_change returns a preview + a
     single-use, TTL'd token; approve_change (the owner's explicit
     confirmation) is the ONLY path that touches the file. The
     token is created by code, not by the model — no guardrail
     prompt stands between attacker and file.
   - Every applied write is logged to a cloud-shaped changelog and
     backed up; AI-made changes are revertible (mmgr_revert_change)
     and reverts themselves are logged (history never erased).
   - Project selection is a bare filename resolved inside the
     configured dir (no path traversal).
   - The cloud key (MMGR_MCP_AI_KEY) comes from the environment
     only and is never written to any file.
   ============================================================ */

import fs from 'node:fs';
import readline from 'node:readline';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Engine from './lib/engine.mjs';
import * as Validate from './lib/validate.mjs';
import * as Cloud from './lib/cloud.mjs';
import * as Store from './lib/store.mjs';
import * as Changelog from './lib/changelog.mjs';
import * as CloudApi from './lib/cloud-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

// ---- Config (env) ----
const PROJECT_DIR = process.env.MMGR_MCP_DIR ? path.resolve(process.env.MMGR_MCP_DIR) : path.resolve(__dirname, 'projects');
const DEFAULT_PROJECT = process.env.MMGR_MCP_PROJECT || null;
const AI_KEY = process.env.MMGR_MCP_AI_KEY || null;
const AI_PROVIDER = process.env.MMGR_MCP_PROVIDER || 'google-gemini';
const ALLOW_WRITES = process.env.MMGR_MCP_ALLOW_WRITES === '1';
const TOKEN_TTL_MS = Number(process.env.MMGR_MCP_TOKEN_TTL_MS) || 10 * 60 * 1000;

// ---- Cloud mode (live project via Worker API) ----
const CLOUD_URL = process.env.MMGR_MCP_CLOUD_URL || null;
const CLOUD_OWNER_CODE = process.env.MMGR_MCP_OWNER_CODE || null;
const CLOUD_EDITOR_CODE = process.env.MMGR_MCP_EDITOR_CODE || null;
const CLOUD_PROJECT_ID = process.env.MMGR_MCP_CLOUD_PROJECT || null;
const CLOUD_MODE = !!(CLOUD_URL && (CLOUD_OWNER_CODE || CLOUD_EDITOR_CODE) && CLOUD_PROJECT_ID);

// ---- Pending approvals: token -> proposal ----
const pending = new Map();

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Periodic GC of expired proposals (bounded memory even if a client never
// rejects/approves and never reuses a token).
setInterval(() => {
  const now = Date.now();
  for (const [token, p] of pending) {
    if (now > p.expiresAt) pending.delete(token);
  }
}, Math.min(TOKEN_TTL_MS, 60000)).unref();

// ---- JSON-RPC helpers ----
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

// Tool result: readable markdown text + structuredContent for machines.
function toolResult(text, structured) {
  return { content: [{ type: 'text', text }], structuredContent: structured || {} };
}
function toolError(text) {
  return { content: [{ type: 'text', text }], structuredContent: {}, isError: true };
}

// ---- Project resolution helpers ----
function pickProject(argName) {
  const name = argName || DEFAULT_PROJECT;
  if (!name) return { ok: false, error: 'no project specified — pass "project" or set MMGR_MCP_PROJECT' };
  const file = Store.resolveProjectFile(PROJECT_DIR, name);
  if (!file) return { ok: false, error: 'project "' + name + '" not found in ' + PROJECT_DIR + ' — use mmgr_list_projects' };
  const loaded = Store.loadProject(file);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  return { ok: true, file, state: loaded.state };
}

// Cloud mode: load project state from the Worker API
async function cloudLoadState() {
  const r = await CloudApi.cloudLoadProject(CLOUD_URL, CLOUD_PROJECT_ID, CLOUD_OWNER_CODE, CLOUD_EDITOR_CODE);
  if (!r.ok) return { ok: false, error: 'cloud load failed: ' + r.error };
  return { ok: true, _cloud: true, state: r.state };
}

// Hash a state object for stale detection (cloud mode has no local file to fingerprint)
function stateHash(state) {
  try { return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex'); }
  catch (e) { return null; }
}

// Unified project resolver: works for both local files and cloud API.
// Returns { ok, state, _cloud?, file? } for both sync (local) and async (cloud) paths.
async function resolveProject(argName) {
  if (CLOUD_MODE && (!argName || argName === CLOUD_PROJECT_ID)) {
    return await cloudLoadState();
  }
  return pickProject(argName);
}

// ---- Read tools ----

function listProjectsTool() {
  const projects = Store.listProjects(PROJECT_DIR);
  const lines = [];
  if (projects.length) {
    lines.push('Local projects in ' + PROJECT_DIR + ':');
    projects.forEach(p => lines.push('  - ' + p));
  }
  if (CLOUD_MODE) {
    lines.push('\nCloud project (via ' + CLOUD_URL + '):');
    lines.push('  - [cloud] ' + CLOUD_PROJECT_ID + (CLOUD_OWNER_CODE ? ' (owner)' : ' (editor)'));
  }
  if (!projects.length && !CLOUD_MODE) {
    lines.push('No exported project .json files found in ' + PROJECT_DIR + '.');
    lines.push('Export one from the app (Settings → Export) and drop it here.');
    lines.push('Or set MMGR_MCP_CLOUD_URL + MMGR_MCP_OWNER_CODE + MMGR_MCP_CLOUD_PROJECT for cloud mode.');
  }
  return toolResult(lines.join('\n'), { dir: PROJECT_DIR, projects, cloudMode: CLOUD_MODE, cloudProject: CLOUD_PROJECT_ID });
}

async function getProjectOverviewTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const s = p.state;
  const h = Engine.computeHealth(s);
  const e = Engine.computeEvm(s);
  const tasks = s.tasks || [];
  const overview = {
    projectId: s.projectId || 'default',
    name: s.projectName || (s.charter && s.charter.name) || '(untitled)',
    methodology: s.methodology || '',
    schemaVersion: s.schemaVersion,
    tasks: tasks.length,
    tasksComplete: tasks.filter(t => t.status === 'completed').length,
    overdue: tasks.filter(t => Engine.isOverdue(t.endDate) && t.status !== 'completed').length,
    risks: (s.risks || []).length,
    issues: (s.issues || []).length,
    changes: (s.changes || []).length,
    budgetLines: (s.budgetLines || []).length,
    targetCompletion: (s.charter && (s.charter.targetCompletion || s.charter.end)) || null,
    health: h ? h.score : null,
    healthLabel: h ? (h.score >= 70 ? 'Healthy' : h.score >= 40 ? 'Needs Attention' : 'At Risk') : 'not enough data yet',
    spi: e && e.spi !== null && e.spi !== undefined ? Number(e.spi.toFixed(2)) : null,
    cpi: e && e.cpi !== null && e.cpi !== undefined ? Number(e.cpi.toFixed(2)) : null
  };
  const text = [
    '**' + overview.name + '** (' + overview.projectId + ', schema v' + overview.schemaVersion + ')',
    '- Methodology: ' + (overview.methodology || '—'),
    '- Health: ' + overview.health + '/100 (' + overview.healthLabel + ')',
    '- Tasks: ' + overview.tasks + ' total · ' + overview.tasksComplete + ' complete · ' + overview.overdue + ' overdue',
    '- EVM: SPI ' + (overview.spi === null ? 'N/A' : overview.spi) + ' · CPI ' + (overview.cpi === null ? 'N/A' : overview.cpi),
    '- Risks: ' + overview.risks + ' · Issues: ' + overview.issues + ' · Changes: ' + overview.changes + ' · Budget lines: ' + overview.budgetLines
  ].join('\n');
  return toolResult(text, { overview });
}

async function getContextTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const ctx = Engine.buildContext(p.state);
  return toolResult(ctx, { context: ctx });
}

async function getTasksTool(project, status, limit) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  let tasks = (p.state.tasks || []).slice();
  if (status && status !== 'all') {
    const allowed = Validate.STATUS_ENUM;
    if (!allowed.includes(status)) return toolError('status must be one of: ' + allowed.join(', '));
    tasks = tasks.filter(t => t.status === status);
  }
  if (limit && Number(limit) > 0) tasks = tasks.slice(0, Number(limit));
  const text = tasks.length
    ? tasks.map(t => '- [' + (t.status || 'todo') + '] ' + (t.name || t.id) + (t.endDate ? ' (due ' + t.endDate + ')' : '') + (Engine.isOverdue(t.endDate) && t.status !== 'completed' ? ' ⚠ overdue' : '')).join('\n')
    : 'No tasks' + (status && status !== 'all' ? ' with status "' + status + '"' : '') + '.';
  return toolResult(text, { tasks });
}

async function getTaskTool(project, id) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const t = (p.state.tasks || []).find(x => String(x.id) === String(id));
  if (!t) return toolError('task "' + id + '" not found');
  return toolResult(JSON.stringify(t, null, 2), { task: t });
}

async function getRisksTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const risks = (p.state.risks || []).filter(r => !r.issueId);
  const text = risks.length
    ? risks.map(r => '- [' + (r.probability || '?') + '/' + (r.impact || '?') + '] ' + (r.description || '(untitled)') + (r.mitigation ? ' — ' + r.mitigation : '')).join('\n')
    : 'No open risks.';
  return toolResult(text, { risks });
}

async function getIssuesTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const issues = (p.state.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
  const text = issues.length
    ? issues.map(i => '- [' + (i.status || 'open') + '] ' + (i.description || '(untitled)')).join('\n')
    : 'No live issues.';
  return toolResult(text, { issues });
}

async function getBudgetTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const lines = (p.state.budgetLines || []).map(l => ({
    id: l.id, name: l.name || '(untitled)', planned: +l.planned || 0, actual: Engine.lineActual(l, p.state)
  }));
  const planned = lines.reduce((n, l) => n + l.planned, 0);
  const actual = lines.reduce((n, l) => n + l.actual, 0);
  const text = [
    '**Budget** — envelope ' + (p.state.budgetEnvelope ? '$' + Number(p.state.budgetEnvelope).toLocaleString() : 'not set'),
    'Planned: $' + planned.toLocaleString() + ' · Actual: $' + actual.toLocaleString(),
    ...(lines.length ? lines.map(l => '- ' + l.name + ': $' + l.actual.toLocaleString() + ' / $' + l.planned.toLocaleString()) : ['(no budget lines)'])
  ].join('\n');
  return toolResult(text, { budgetEnvelope: p.state.budgetEnvelope || 0, planned, actual, lines });
}

async function getEvmTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const e = Engine.computeEvm(p.state);
  if (!e) return toolResult('EVM: insufficient schedule/budget data (need tasks AND planned budget).', { evm: null });
  const text = [
    'EVM: SPI ' + e.spi.toFixed(2) + (e.spi >= 1 ? ' (on/ahead)' : ' (behind)') + ' · CPI ' + e.cpi.toFixed(2) + (e.cpi >= 1 ? ' (on/under)' : ' (over)'),
    'EV $' + Math.round(e.ev).toLocaleString() + ' / PV $' + Math.round(e.pv).toLocaleString() + ' / AC $' + Math.round(e.ac).toLocaleString(),
    'BAC $' + Math.round(e.bac).toLocaleString() + (e.eac !== null ? ' · EAC $' + Math.round(e.eac).toLocaleString() : '') + (e.vac !== null ? ' · VAC $' + Math.round(e.vac).toLocaleString() : '')
  ].join('\n');
  return toolResult(text, { evm: e });
}

async function getHealthTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const h = Engine.computeHealth(p.state);
  if (!h) return toolResult('Health: not enough data yet — add tasks.', { health: null });
  const rows = [
    ['Completion (30%)', h.f1], ['Schedule (25%)', h.f2], ['Budget (20%)', h.f3],
    ['Risk (15%)', h.f4], ['Change (10%)', h.f5]
  ];
  const text = [
    'Health: ' + h.score + '/100 (' + (h.score >= 70 ? 'Healthy' : h.score >= 40 ? 'Needs Attention' : 'At Risk') + ')',
    ...rows.map(([label, v]) => '- ' + label + ': ' + (v === null ? 'not enough data yet (excluded from weighting)' : Math.round(v)))
  ].join('\n');
  return toolResult(text, { health: h });
}

async function getScheduleAuditTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const tasks = p.state.tasks || [];
  const issues = [];
  tasks.forEach(t => {
    if (t.startDate && t.endDate && t.startDate > t.endDate) issues.push({ severity: 'error', task: t.id, message: 'Task ' + (t.name || t.id) + ': end before start' });
    if (t.parentId) {
      const parent = tasks.find(x => x.id === t.parentId);
      if (parent && parent.startDate && t.startDate && parent.startDate > t.startDate) issues.push({ severity: 'error', task: t.id, message: 'Task starts before parent ' + parent.id });
      if (parent && parent.endDate && t.endDate && t.endDate > parent.endDate) issues.push({ severity: 'error', task: t.id, message: 'Task ends after parent ' + parent.id });
    }
    (t.predecessors || []).forEach(pid => {
      const pred = tasks.find(x => x.id === pid);
      if (pred && pred.endDate && t.startDate && pred.endDate > t.startDate) issues.push({ severity: 'error', task: t.id, message: 'Task starts before predecessor ' + pid + ' finishes' });
    });
  });
  const text = issues.length
    ? 'Schedule logic audit — ' + issues.length + ' issue(s):\n' + issues.map(i => '- ' + i.message).join('\n')
    : 'Schedule logic audit — no date-logic issues found.';
  return toolResult(text, { issues });
}

async function getWeatherTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const rd = Engine.riskDays(p.state);
  const text = [
    'Site: ' + (p.state.sitePlace || 'not set'),
    'Weather risk days: ' + (rd.length ? rd.slice(0, 5).map(d => d.date + ' (' + d.alerts.join(', ') + ')').join('; ') : 'none in forecast'),
    'Weather delay days logged: ' + (p.state.weatherLog || []).length
  ].join('\n');
  return toolResult(text, { riskDays: rd, weatherLogCount: (p.state.weatherLog || []).length });
}

async function getClaimSlipsTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const slips = Engine.computeSlips(p.state);
  const text = slips.length
    ? 'Schedule slips vs baseline:\n' + slips.map(sl => '- ' + sl.taskName + ': +' + sl.days + 'd (cause: ' + sl.cause + ')').join('\n')
    : 'No schedule slips detected (save a baseline in the app first).';
  return toolResult(text, { slips });
}

async function getChangelogTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  let entries = [];
  if (p._cloud) {
    // Cloud mode: read from the MCP sidecar changelog
    const sidecarFile = path.join(__dirname, 'projects', 'cloud-' + CLOUD_PROJECT_ID + '.mcp-changelog.json');
    try { entries = JSON.parse(fs.readFileSync(sidecarFile, 'utf8')); } catch (e) { /* no entries yet */ }
  } else {
    const log = Changelog.loadChangelog(p.file);
    entries = log.entries || [];
  }
  const text = entries.length
    ? 'MCP changelog (' + entries.length + ' entries):\n' + entries.slice().reverse().map(e =>
        '- #' + e.id + ' [' + e.entry_type + '] ' + (e.section || '') + ' by ' + e.actor_label + ' @ ' + (e.created_at || e.created_at) +
        (e.diffs_json && e.diffs_json.length ? ' — ' + e.diffs_json.length + ' field(s)' : '')).join('\n')
    : 'No MCP changes yet.';
  return toolResult(text, { entries });
}

// ---- answer_question: local-first, cloud fallback ----
async function answerQuestionTool(project, question) {
  if (!question || !String(question).trim()) return toolError('question is required');
  const p = pickProject(project);
  if (!p.ok) return toolError(p.error);
  const local = Engine.localLookup(String(question), p.state);
  if (local.ok) {
    return toolResult(local.text, { tier: 'local', model: local.model, text: local.text, trace: local.trace });
  }
  if (!AI_KEY) {
    return toolError(local.error);
  }
  try {
    const ctx = Engine.buildContext(p.state);
    const messages = Cloud.groundingMessages(String(question), ctx, AI_KEY);
    const r = await Cloud.chatWithFallback(AI_PROVIDER, AI_KEY, messages, ctx);
    return toolResult(r.text, { tier: 'cloud', provider: AI_PROVIDER, model: r.model, fellBackFrom: r.fellBackFrom || null, text: r.text });
  } catch (e) {
    return toolError('Cloud tier failed: ' + ((e && e.message) || 'unknown error') + ' — check MMGR_MCP_AI_KEY / MMGR_MCP_PROVIDER.');
  }
}

// ---- Cloud mode project resolver ----
async function cloudPickProject() {
  if (!CLOUD_MODE) return null;
  const r = await CloudApi.cloudLoadProject(CLOUD_URL, CLOUD_PROJECT_ID, CLOUD_OWNER_CODE, CLOUD_EDITOR_CODE);
  if (!r.ok) return { ok: false, error: 'cloud load failed: ' + r.error };
  return { ok: true, state: r.state, _cloud: true };
}

// ---- New read tools for all project sections ----

async function getResourcesTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const resources = p.state.resources || [];
  const text = resources.length
    ? resources.map(r => '- [' + (r.type || 'Labor') + '] ' + (r.name || '(unnamed)') + (r.role ? ' — ' + r.role : '') + ' (' + (r.availability || 100) + '% avail, $' + (r.rate || 0) + '/hr)').join('\n')
    : 'No resources assigned.';
  return toolResult(text, { resources });
}

async function getStakeholdersTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const stakeholders = p.state.stakeholders || [];
  const text = stakeholders.length
    ? stakeholders.map(s => '- ' + (s.name || '(unnamed)') + (s.role ? ' — ' + s.role : '') + ' [' + (s.influence || 'Medium') + ' influence, ' + (s.interest || 'Medium') + ' interest]' + (s.strategy ? ' (' + s.strategy + ')' : '')).join('\n')
    : 'No stakeholders registered.';
  return toolResult(text, { stakeholders });
}

async function getMeetingsTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const meetings = p.state.meetings || [];
  const text = meetings.length
    ? meetings.slice(-10).map(m => '- [' + (m.kind || 'custom') + '] ' + (m.date || 'no date') + (m.attendees ? ' (' + (Array.isArray(m.attendees) ? m.attendees.join(', ') : m.attendees) + ')' : '') + (m.minutes ? ' — ' + m.minutes.slice(0, 80) : '')).join('\n')
    : 'No meetings logged.';
  return toolResult(text, { meetings: meetings.slice(-10), total: meetings.length });
}

async function getDecisionsTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  // Decisions live in the decision engine output (mmgr-decisions.js)
  const decisions = p.state.decisions || [];
  const text = decisions.length
    ? decisions.map(d => '- [' + (d.status || 'pending') + '] ' + (d.title || '(untitled)') + (d.owner ? ' — ' + d.owner : '') + (d.date ? ' @ ' + d.date : '')).join('\n')
    : 'No decisions logged.';
  return toolResult(text, { decisions });
}

async function getDocumentsTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const docs = p.state.documents || [];
  const text = docs.length
    ? docs.map(d => '- [' + (d.type || 'other') + '] ' + (d.name || '(unnamed)') + (d.location ? ' — ' + d.location : '')).join('\n')
    : 'No documents registered.';
  return toolResult(text, { documents: docs });
}

async function getBidsTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const bids = p.state.bidPackages || [];
  const text = bids.length
    ? bids.map(b => '- ' + (b.package || '(unnamed)') + (b.targetBudget ? ' (budget: $' + b.targetBudget.toLocaleString() + ')' : '') + (b.bidDeadline ? ' due ' + b.bidDeadline : '') + (b.lineItems ? ' [' + b.lineItems.length + ' line items]' : '')).join('\n')
    : 'No bid packages.';
  return toolResult(text, { bidPackages: bids });
}

async function getClosureTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const c = p.state.closure || { items: [], well: '', imp: '', rec: '' };
  const items = (c.items || []).map(i => '- [' + (i.status || 'pending') + '] ' + (i.text || i.name || '(unnamed)')).join('\n');
  const text = [
    'Closure checklist:', items || '(empty)',
    c.well ? '\nWhat went well: ' + c.well : '',
    c.imp ? '\nImprovements: ' + c.imp : '',
    c.rec ? '\nRecommendations: ' + c.rec : ''
  ].filter(Boolean).join('\n');
  return toolResult(text, { closure: c });
}

async function getSprintTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const sp = p.state.sprint || { name: 'Sprint 1', start: '', end: '' };
  const text = 'Sprint: ' + (sp.name || 'unnamed') + (sp.start ? ' (' + sp.start + ' to ' + (sp.end || '?') + ')' : '');
  return toolResult(text, { sprint: sp });
}

async function getDmaicTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const d = p.state.dmaic || {};
  const phases = ['define', 'measure', 'analyze', 'improve', 'control'];
  const text = phases.map(ph => {
    const p_data = d[ph] || {};
    const fields = Object.keys(p_data).filter(k => k !== 'done');
    const filled = fields.filter(k => p_data[k] && p_data[k] !== '' && p_data[k] !== false);
    return '- ' + ph.charAt(0).toUpperCase() + ph.slice(1) + ': ' + (p_data.done ? 'done' : 'in progress') + ' (' + filled.length + '/' + fields.length + ' fields filled)';
  }).join('\n');
  return toolResult(text, { dmaic: d });
}

async function getSpendLogTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const log = p.state.spendLog || [];
  const total = log.reduce((s, e) => s + (e.amount || 0), 0);
  const text = log.length
    ? 'Spend log (' + log.length + ' entries, $' + total.toLocaleString() + ' total):\n' + log.slice(-10).map(e => '- ' + (e.date || '?') + ': $' + (e.amount || 0).toLocaleString() + (e.description ? ' — ' + e.description : '')).join('\n')
    : 'No spend entries.';
  return toolResult(text, { entries: log.slice(-10), total, count: log.length });
}

async function getWeatherLogTool(project) {
  const p = await resolveProject(project);
  if (!p.ok) return toolError(p.error);
  const log = p.state.weatherLog || [];
  const total = log.reduce((s, e) => s + (e.delayDays || 0), 0);
  const text = log.length
    ? 'Weather delay log (' + log.length + ' entries, ' + total + ' total delay days):\n' + log.slice(-10).map(e => '- ' + (e.date || '?') + ': ' + (e.delayDays || 0) + 'd' + (e.reason ? ' — ' + e.reason : '')).join('\n')
    : 'No weather delays logged.';
  return toolResult(text, { entries: log.slice(-10), totalDelayDays: total, count: log.length });
}

function listWritableFieldsTool() {
  const catalog = Validate.opCatalog();
  const text = [
    'Writable operations (verb → required fields; only whitelisted fields may be written):',
    ...catalog.map(c => '- ' + c.op + ' (req: ' + (c.required.length ? c.required.join(', ') : 'none') + ') — fields: ' + c.fields.join(', ')),
    '',
    'Status enums — task: ' + Validate.STATUS_ENUM.join('|'),
    '— risk level: ' + Validate.LEVEL_ENUM.join('|'),
    '— issue: ' + Validate.ISSUE_STATUS_ENUM.join('|'),
    '— change: ' + Validate.CHANGE_STATUS_ENUM.join('|')
  ].join('\n');
  return toolResult(text, { catalog });
}

// ---- Write tools (gated on ALLOW_WRITES + two-phase approval) ----

function writeGate() {
  if (!ALLOW_WRITES) {
    return { ok: false, error: 'write tools are disabled — restart the server with MMGR_MCP_ALLOW_WRITES=1 to enable owner-approved changes' };
  }
  return { ok: true };
}

// Apply validated ops to a deep clone of state, generating ids for adds.
// Returns { state, diffs } or throws on record-not-found.
function applyOps(state, ops) {
  const s = JSON.parse(JSON.stringify(state));
  const diffs = [];
  const ensureList = (key) => { if (!s[key] || !Array.isArray(s[key])) s[key] = []; return s[key]; };
  const findIn = (key, id) => {
    const list = ensureList(key);
    const idx = list.findIndex(r => String(r.id) === String(id));
    return { list, idx, rec: idx >= 0 ? list[idx] : null };
  };
  for (const op of ops) {
    switch (op.op) {
      case 'task.add': {
        const list = ensureList('tasks');
        const rec = { id: 't-' + crypto.randomBytes(4).toString('hex'), name: op.name, level: 0, indent: 0, isPhase: false, status: op.status || 'todo', startDate: op.startDate || '', endDate: op.endDate || '', duration: op.duration !== undefined ? op.duration : '', assignee: op.assignee || '', critical: false, leadTime: false, recurring: false, weatherExposed: false, confidence: op.confidence || 'high', predecessors: [], notes: op.notes || '', weatherSensitive: op.weatherSensitive || false };
        if (op.milestone !== undefined) rec.milestone = op.milestone;
        list.push(rec);
        diffs.push({ path: 'tasks[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'task.update': {
        const { list, idx, rec } = findIn('tasks', op.id);
        if (!rec) throw new Error('task "' + op.id + '" not found');
        for (const f of ['name', 'status', 'startDate', 'endDate', 'duration', 'assignee', 'confidence', 'milestone', 'weatherSensitive', 'notes']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'tasks[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'task.delete': {
        const { list, idx, rec } = findIn('tasks', op.id);
        if (!rec) throw new Error('task "' + op.id + '" not found');
        diffs.push({ path: 'tasks[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'risk.add': {
        const list = ensureList('risks');
        const rec = { id: 'r-' + crypto.randomBytes(4).toString('hex'), description: op.description, probability: op.probability, impact: op.impact, mitigation: op.mitigation || '' };
        list.push(rec);
        diffs.push({ path: 'risks[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'risk.update': {
        const { list, idx, rec } = findIn('risks', op.id);
        if (!rec) throw new Error('risk "' + op.id + '" not found');
        for (const f of ['description', 'probability', 'impact', 'mitigation']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'risks[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'risk.delete': {
        const { list, idx, rec } = findIn('risks', op.id);
        if (!rec) throw new Error('risk "' + op.id + '" not found');
        diffs.push({ path: 'risks[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'issue.add': {
        const list = ensureList('issues');
        const rec = { id: 'i-' + crypto.randomBytes(4).toString('hex'), description: op.description, status: op.status || 'open' };
        list.push(rec);
        diffs.push({ path: 'issues[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'issue.update': {
        const { list, idx, rec } = findIn('issues', op.id);
        if (!rec) throw new Error('issue "' + op.id + '" not found');
        for (const f of ['description', 'status']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'issues[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'issue.delete': {
        const { list, idx, rec } = findIn('issues', op.id);
        if (!rec) throw new Error('issue "' + op.id + '" not found');
        diffs.push({ path: 'issues[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'budgetLine.add': {
        const list = ensureList('budgetLines');
        const rec = { id: 'b-' + crypto.randomBytes(4).toString('hex'), name: op.name, planned: op.planned, actual: op.actual !== undefined ? op.actual : 0 };
        list.push(rec);
        diffs.push({ path: 'budgetLines[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'budgetLine.update': {
        const { list, idx, rec } = findIn('budgetLines', op.id);
        if (!rec) throw new Error('budget line "' + op.id + '" not found');
        for (const f of ['name', 'planned', 'actual']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'budgetLines[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'budgetLine.delete': {
        const { list, idx, rec } = findIn('budgetLines', op.id);
        if (!rec) throw new Error('budget line "' + op.id + '" not found');
        diffs.push({ path: 'budgetLines[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'change.update': {
        const { list, idx, rec } = findIn('changes', op.id);
        if (!rec) throw new Error('change "' + op.id + '" not found');
        for (const f of ['title', 'status']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'changes[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'charter.update': {
        if (!s.charter || typeof s.charter !== 'object') s.charter = {};
        for (const f of ['name', 'sponsor', 'objective', 'scope', 'deliverables', 'targetStart', 'targetCompletion', 'budgetEnvelope', 'constraints', 'assumptions']) {
          if (op[f] !== undefined && JSON.stringify(s.charter[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'charter.' + f, before: s.charter[f], after: op[f], beforeAbsent: s.charter[f] === undefined, afterAbsent: false });
            s.charter[f] = op[f];
          }
        }
        break;
      }
      case 'resource.add': {
        const list = ensureList('resources');
        const rec = { id: 'R-' + crypto.randomBytes(4).toString('hex'), name: op.name, type: op.type || 'Labor', role: op.role || '', availability: op.availability !== undefined ? op.availability : 100, rate: op.rate || 0, hoursAllocated: op.hoursAllocated || 0 };
        list.push(rec);
        diffs.push({ path: 'resources[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'resource.update': {
        const { list, idx, rec } = findIn('resources', op.id);
        if (!rec) throw new Error('resource "' + op.id + '" not found');
        for (const f of ['name', 'type', 'role', 'availability', 'rate', 'hoursAllocated']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'resources[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'resource.delete': {
        const { list, idx, rec } = findIn('resources', op.id);
        if (!rec) throw new Error('resource "' + op.id + '" not found');
        diffs.push({ path: 'resources[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'stakeholder.add': {
        const list = ensureList('stakeholders');
        const rec = { id: 'S-' + crypto.randomBytes(4).toString('hex'), name: op.name, role: op.role || '', influence: op.influence || 'Medium', interest: op.interest || 'Medium', strategy: op.strategy || '', contact: op.contact || '' };
        list.push(rec);
        diffs.push({ path: 'stakeholders[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'stakeholder.update': {
        const { list, idx, rec } = findIn('stakeholders', op.id);
        if (!rec) throw new Error('stakeholder "' + op.id + '" not found');
        for (const f of ['name', 'role', 'influence', 'interest', 'strategy', 'contact']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'stakeholders[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'stakeholder.delete': {
        const { list, idx, rec } = findIn('stakeholders', op.id);
        if (!rec) throw new Error('stakeholder "' + op.id + '" not found');
        diffs.push({ path: 'stakeholders[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'meeting.add': {
        const list = ensureList('meetings');
        const rec = { id: 'mt-' + crypto.randomBytes(4).toString('hex'), kind: op.kind || 'custom', date: op.date || '', attendees: op.attendees || [], minutes: op.minutes || '', actionItems: op.actionItems || [] };
        list.push(rec);
        diffs.push({ path: 'meetings[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'meeting.update': {
        const { list, idx, rec } = findIn('meetings', op.id);
        if (!rec) throw new Error('meeting "' + op.id + '" not found');
        for (const f of ['kind', 'date', 'attendees', 'minutes', 'actionItems']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'meetings[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'meeting.delete': {
        const { list, idx, rec } = findIn('meetings', op.id);
        if (!rec) throw new Error('meeting "' + op.id + '" not found');
        diffs.push({ path: 'meetings[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'decision.add': {
        const list = ensureList('decisions');
        const rec = { id: 'dec-' + crypto.randomBytes(4).toString('hex'), title: op.title, date: op.date || '', owner: op.owner || '', rationale: op.rationale || '', status: op.status || 'pending' };
        list.push(rec);
        diffs.push({ path: 'decisions[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'decision.update': {
        const { list, idx, rec } = findIn('decisions', op.id);
        if (!rec) throw new Error('decision "' + op.id + '" not found');
        for (const f of ['title', 'date', 'owner', 'rationale', 'status']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'decisions[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'decision.delete': {
        const { list, idx, rec } = findIn('decisions', op.id);
        if (!rec) throw new Error('decision "' + op.id + '" not found');
        diffs.push({ path: 'decisions[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'document.add': {
        const list = ensureList('documents');
        const rec = { id: 'doc-' + crypto.randomBytes(4).toString('hex'), name: op.name, type: op.type || 'other', location: op.location || '', notes: op.notes || '' };
        list.push(rec);
        diffs.push({ path: 'documents[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'document.update': {
        const { list, idx, rec } = findIn('documents', op.id);
        if (!rec) throw new Error('document "' + op.id + '" not found');
        for (const f of ['name', 'type', 'location', 'notes']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'documents[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'document.delete': {
        const { list, idx, rec } = findIn('documents', op.id);
        if (!rec) throw new Error('document "' + op.id + '" not found');
        diffs.push({ path: 'documents[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'bidPackage.add': {
        const list = ensureList('bidPackages');
        const rec = { id: 'bid-' + crypto.randomBytes(4).toString('hex'), package: op.package, targetBudget: op.targetBudget || 0, bidDeadline: op.bidDeadline || '', status: op.status || 'pending', lineItems: [], subs: [] };
        list.push(rec);
        diffs.push({ path: 'bidPackages[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'bidPackage.update': {
        const { list, idx, rec } = findIn('bidPackages', op.id);
        if (!rec) throw new Error('bid package "' + op.id + '" not found');
        for (const f of ['package', 'targetBudget', 'bidDeadline', 'status']) {
          if (op[f] !== undefined && JSON.stringify(rec[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'bidPackages[' + idx + '].' + f, recordId: rec.id, before: rec[f], after: op[f], beforeAbsent: rec[f] === undefined, afterAbsent: false });
            rec[f] = op[f];
          }
        }
        break;
      }
      case 'bidPackage.delete': {
        const { list, idx, rec } = findIn('bidPackages', op.id);
        if (!rec) throw new Error('bid package "' + op.id + '" not found');
        diffs.push({ path: 'bidPackages[' + idx + ']', recordId: rec.id, before: rec, after: undefined, beforeAbsent: false, afterAbsent: true });
        list.splice(idx, 1);
        break;
      }
      case 'closure.update': {
        if (!s.closure || typeof s.closure !== 'object') s.closure = { items: [], well: '', imp: '', rec: '' };
        for (const f of ['well', 'imp', 'rec']) {
          const target = f === 'imp' ? 'improvements' : f === 'rec' ? 'recommendations' : f;
          if (op[target] !== undefined && JSON.stringify(s.closure[f]) !== JSON.stringify(op[target])) {
            diffs.push({ path: 'closure.' + f, before: s.closure[f], after: op[target], beforeAbsent: s.closure[f] === undefined, afterAbsent: false });
            s.closure[f] = op[target];
          }
        }
        break;
      }
      case 'sprint.update': {
        if (!s.sprint || typeof s.sprint !== 'object') s.sprint = { name: 'Sprint 1', start: '', end: '' };
        for (const f of ['name', 'start', 'end']) {
          if (op[f] !== undefined && JSON.stringify(s.sprint[f]) !== JSON.stringify(op[f])) {
            diffs.push({ path: 'sprint.' + f, before: s.sprint[f], after: op[f], beforeAbsent: s.sprint[f] === undefined, afterAbsent: false });
            s.sprint[f] = op[f];
          }
        }
        break;
      }
      case 'spendLog.add': {
        const list = ensureList('spendLog');
        const rec = { id: 'sp-' + crypto.randomBytes(4).toString('hex'), date: op.date, amount: op.amount, description: op.description || '', category: op.category || '' };
        list.push(rec);
        diffs.push({ path: 'spendLog[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'weatherLog.add': {
        const list = ensureList('weatherLog');
        const rec = { id: 'wx-' + crypto.randomBytes(4).toString('hex'), date: op.date, delayDays: op.delayDays, reason: op.reason || '' };
        list.push(rec);
        diffs.push({ path: 'weatherLog[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'commsEntry.add': {
        const list = ensureList('commsEntries');
        const rec = { id: 'cm-' + crypto.randomBytes(4).toString('hex'), date: op.date, to: op.to || '', subject: op.subject, body: op.body || '' };
        list.push(rec);
        diffs.push({ path: 'commsEntries[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'logEntry.add': {
        const list = ensureList('logEntries');
        const rec = { id: 'log-' + crypto.randomBytes(4).toString('hex'), date: op.date, text: op.text };
        list.push(rec);
        diffs.push({ path: 'logEntries[' + (list.length - 1) + ']', recordId: rec.id, before: undefined, after: rec, beforeAbsent: true, afterAbsent: false });
        break;
      }
      case 'dmaic.update': {
        if (!s.dmaic || typeof s.dmaic !== 'object') s.dmaic = {};
        const phase = op.phase;
        if (!s.dmaic[phase] || typeof s.dmaic[phase] !== 'object') s.dmaic[phase] = {};
        const field = op.field;
        if (JSON.stringify(s.dmaic[phase][field]) !== JSON.stringify(op.value)) {
          diffs.push({ path: 'dmaic.' + phase + '.' + field, before: s.dmaic[phase][field], after: op.value, beforeAbsent: s.dmaic[phase][field] === undefined, afterAbsent: false });
          s.dmaic[phase][field] = op.value;
        }
        break;
      }
      case 'raci.update': {
        if (!s.raci || typeof s.raci !== 'object') s.raci = { tasks: [], persons: [], matrix: {} };
        if (!s.raci.tasks.includes(op.task)) s.raci.tasks.push(op.task);
        if (!s.raci.persons.includes(op.person)) s.raci.persons.push(op.person);
        const key = op.task + '::' + op.person;
        if (JSON.stringify(s.raci.matrix[key]) !== JSON.stringify(op.value)) {
          diffs.push({ path: 'raci.matrix.' + key, before: s.raci.matrix[key], after: op.value, beforeAbsent: s.raci.matrix[key] === undefined, afterAbsent: false });
          s.raci.matrix[key] = op.value;
        }
        break;
      }
      default:
        throw new Error('unhandled op ' + op.op);
    }
  }
  return { state: s, diffs };
}

function humanPreview(ops, diffs) {
  const L = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const d = diffs[i];
    if (!d) continue;
    const verb = op.op;
    const recordType = op.op.split('.')[0];
    const label = op.name || op.description || op.id || '';
    if (verb.endsWith('.add')) L.push('+ ADD ' + recordType + ': ' + label);
    else if (verb.endsWith('.delete')) L.push('- DELETE ' + recordType + ': ' + label);
    else L.push('~ UPDATE ' + recordType + ': ' + label);
    if (verb === 'charter.update') {
      for (const f of Object.keys(op)) {
        if (f === 'op') continue;
        L.push('  ' + f + ': "' + String(op[f]) + '"');
      }
    }
  }
  return L.join('\n');
}

async function proposeChangeTool(project, operations) {
  const gate = writeGate();
  if (!gate.ok) return toolError(gate.error);
  // Resolve project: local file or cloud API
  let p;
  if (CLOUD_MODE && (!project || project === CLOUD_PROJECT_ID)) {
    p = await cloudLoadState();
  } else {
    p = pickProject(project);
  }
  if (!p.ok) return toolError(p.error);
  const v = Validate.validateOps(operations);
  if (!v.ok) return toolError(v.error);
  let applied;
  try {
    applied = applyOps(p.state, v.ops);
  } catch (e) {
    return toolError(e.message);
  }
  // Build diffs per op (for the changelog) and a human preview (for the owner).
  const diffs = applied.diffs;
  const preview = humanPreview(v.ops, diffs);
  const token = newToken();
  pending.set(token, {
    project: p._cloud ? null : p.file,
    _cloud: !!p._cloud,
    projectName: p.state.projectName || (p.state.charter && p.state.charter.name) || 'project',
    ops: v.ops,
    diffs,
    beforeFingerprint: p._cloud ? stateHash(p.state) : Store.fingerprint(p.file),
    expiresAt: Date.now() + TOKEN_TTL_MS
  });
  const mode = p._cloud ? 'cloud (' + CLOUD_URL + ')' : 'local (' + path.basename(p.file) + ')';
  const text = [
    'PROPOSED CHANGE (' + mode + ') — awaiting your approval (token expires in ' + Math.round(TOKEN_TTL_MS / 60000) + ' min).',
    'Project: ' + (p.state.projectName || '(untitled)'),
    '',
    preview,
    '',
    'To apply: call mmgr_approve_change with token "' + token + '".',
    'To discard: call mmgr_reject_change with the same token.'
  ].join('\n');
  return toolResult(text, { token, ttlMs: TOKEN_TTL_MS, ops: v.ops, diffs, preview, cloud: !!p._cloud });
}

function takeToken(token) {
  if (!token) return { ok: false, error: 'token is required' };
  const proposal = pending.get(token);
  if (!proposal) return { ok: false, error: 'unknown or already-used token — propose a fresh change' };
  if (Date.now() > proposal.expiresAt) {
    pending.delete(token);
    return { ok: false, error: 'token expired — propose the change again' };
  }
  pending.delete(token); // single-use: consumed the moment it's validated
  return { ok: true, proposal };
}

async function approveChangeTool(token) {
  const gate = writeGate();
  if (!gate.ok) return toolError(gate.error);
  const t = takeToken(token);
  if (!t.ok) return toolError(t.error);
  const proposal = t.proposal;

  // ---- Load current state (local or cloud) ----
  let before, currentState;
  if (proposal._cloud) {
    // Cloud mode: re-fetch from the API and compare state hash
    const fresh = await cloudLoadState();
    if (!fresh.ok) return toolError('cloud reload failed: ' + fresh.error);
    const freshHash = stateHash(fresh.state);
    if (proposal.beforeFingerprint && freshHash !== proposal.beforeFingerprint) {
      return toolError('cloud project changed since this change was proposed — propose it again against the current data');
    }
    before = fresh.state;
    currentState = fresh.state;
  } else {
    // Local mode: stale-file guard via file fingerprint
    const nowFp = Store.fingerprint(proposal.project);
    if (proposal.beforeFingerprint && nowFp !== proposal.beforeFingerprint) {
      return toolError('project file changed on disk since this change was proposed — propose it again against the current data');
    }
    const loaded = Store.loadProject(proposal.project);
    if (!loaded.ok) return toolError(loaded.error);
    before = loaded.state;
    currentState = loaded.state;
  }

  // ---- Apply ops ----
  let applied;
  try {
    applied = applyOps(currentState, proposal.ops);
  } catch (e) {
    return toolError(e.message);
  }
  const after = Store.stampLikeApp(applied.state, before);

  // ---- Save (cloud or local) ----
  let saved;
  if (proposal._cloud) {
    saved = await CloudApi.cloudSaveProject(CLOUD_URL, CLOUD_PROJECT_ID, after, CLOUD_OWNER_CODE, CLOUD_EDITOR_CODE);
    if (!saved.ok) return toolError('cloud save failed: ' + saved.error);
  } else {
    // Pre-compute the changelog id so the pre-change backup carries the same id.
    const prevLog = Changelog.loadChangelog(proposal.project);
    const entryId = prevLog.entries.length ? Math.max.apply(null, prevLog.entries.map(e => e.id)) + 1 : 1;
    // Real pre-change backup (BEFORE state) next to the project file.
    const backupFile = proposal.project.replace(/\.json$/i, '') + '.pre-' + entryId + '.json';
    try { fs.writeFileSync(backupFile, Store.serialize(before)); } catch (e) { /* backup is best-effort */ }
    saved = Store.saveProject(proposal.project, after);
    if (!saved.ok) return toolError(saved.error);
    // Store entryId for the changelog + text below
    proposal._localEntryId = entryId;
    proposal._backupFile = backupFile;
  }

  // ---- Log changelog entry ----
  const section = applied.diffs.length ? applied.diffs[0].path.split(/[.[]/)[0] : null;
  let entry;
  if (proposal._cloud) {
    // Cloud mode: write changelog to a sidecar file next to the MCP server
    // (the cloud project's changelog lives in D1, synced separately)
    const sidecarDir = path.join(__dirname, 'projects');
    const sidecarFile = path.join(sidecarDir, 'cloud-' + CLOUD_PROJECT_ID + '.mcp-changelog.json');
    let sidecarEntries = [];
    try { sidecarEntries = JSON.parse(fs.readFileSync(sidecarFile, 'utf8')); } catch (e) { /* new file */ }
    const entryId = sidecarEntries.length ? Math.max.apply(null, sidecarEntries.map(e => e.id)) + 1 : 1;
    entry = {
      id: entryId,
      entry_type: applied.diffs.length > 5 ? 'bulk' : 'edit',
      actor_type: 'owner',
      actor_label: 'mcp-ai',
      section,
      diffs_json: applied.diffs,
      created_at: new Date().toISOString()
    };
    sidecarEntries.push(entry);
    try {
      if (!fs.existsSync(sidecarDir)) fs.mkdirSync(sidecarDir, { recursive: true });
      fs.writeFileSync(sidecarFile, JSON.stringify(sidecarEntries, null, 2));
    } catch (e) { /* changelog write is best-effort */ }
  } else {
    entry = Changelog.appendEntry(proposal.project, {
      id: proposal._localEntryId,
      entry_type: applied.diffs.length > 5 ? 'bulk' : 'edit',
      actor_type: 'owner',
      actor_label: 'mcp-ai',
      section,
      diffs_json: applied.diffs
    });
  }

  // ---- Build response ----
  const mode = proposal._cloud ? 'cloud (' + CLOUD_URL + '/' + CLOUD_PROJECT_ID + ')' : 'local (' + path.basename(proposal.project) + ')';
  const lines = [
    'CHANGE APPLIED (' + mode + ') — project "' + proposal.projectName + '" updated.',
    'Changelog entry #' + entry.id + ' (' + entry.entry_type + ', ' + applied.diffs.length + ' field(s)).',
  ];
  if (!proposal._cloud) {
    lines.push('Pre-change backup: ' + path.basename(proposal._backupFile));
  } else {
    lines.push('Saved at: ' + (saved.savedAt || 'now'));
  }
  lines.push('To undo: call mmgr_revert_change with entryId ' + entry.id + '.');
  const result = { applied: true, entryId: entry.id, entry, diffs: applied.diffs, cloud: !!proposal._cloud };
  if (proposal._cloud) { result.savedAt = saved.savedAt; }
  else { result.backup = path.basename(proposal._backupFile); }
  return toolResult(lines.join('\n'), result);
}

function rejectChangeTool(token) {
  const gate = writeGate();
  if (!gate.ok) return toolError(gate.error);
  const t = takeToken(token);
  if (!t.ok) return toolError(t.error);
  return toolResult('Change rejected and discarded — the project file was not modified.', { applied: false, rejected: true });
}

async function revertChangeTool(project, entryId) {
  const gate = writeGate();
  if (!gate.ok) return toolError(gate.error);

  // ---- Resolve project ----
  let p;
  if (CLOUD_MODE && (!project || project === CLOUD_PROJECT_ID)) {
    p = await cloudLoadState();
  } else {
    p = pickProject(project);
  }
  if (!p.ok) return toolError(p.error);

  // ---- Find the entry to revert ----
  let entry;
  if (p._cloud) {
    // Cloud mode: read from the MCP sidecar changelog
    const sidecarFile = path.join(__dirname, 'projects', 'cloud-' + CLOUD_PROJECT_ID + '.mcp-changelog.json');
    let entries = [];
    try { entries = JSON.parse(fs.readFileSync(sidecarFile, 'utf8')); } catch (e) { return toolError('no MCP changelog found for this cloud project'); }
    entry = entries.find(e => e.id === Number(entryId));
    if (!entry) return toolError('changelog entry #' + entryId + ' not found');
    if (entry.entry_type === 'revert') return toolError('entry #' + entryId + ' is already a revert — refusing to double-revert');
    // Apply inverse diffs
    const reverted = Changelog.applyInverseDiffs(p.state, entry.diffs_json || []);
    const after = Store.stampLikeApp(reverted, p.state);
    // Save to cloud
    const saved = await CloudApi.cloudSaveProject(CLOUD_URL, CLOUD_PROJECT_ID, after, CLOUD_OWNER_CODE, CLOUD_EDITOR_CODE);
    if (!saved.ok) return toolError('cloud save failed: ' + saved.error);
    // Log the revert in the sidecar
    const logId = entries.length ? Math.max.apply(null, entries.map(e => e.id)) + 1 : 1;
    const revertEntry = Object.assign({ id: logId }, Changelog.revertEntryShape(entry), { created_at: new Date().toISOString() });
    entries.push(revertEntry);
    try { fs.writeFileSync(sidecarFile, JSON.stringify(entries, null, 2)); } catch (e) { /* best-effort */ }
    const text = [
      'REVERT APPLIED (cloud) — change #' + entry.id + ' (' + entry.entry_type + ') undone.',
      'Revert logged as changelog entry #' + logId + ' (history preserved).',
      'Saved at: ' + (saved.savedAt || 'now')
    ].join('\n');
    return toolResult(text, { reverted: true, revertedEntryId: entry.id, revertLogEntryId: logId, cloud: true });
  }

  // ---- Local mode ----
  const prep = Changelog.prepareRevert(p.file, Number(entryId));
  if (!prep.ok) return toolError(prep.error);
  const loaded = Store.loadProject(p.file);
  if (!loaded.ok) return toolError(loaded.error);
  const reverted = Changelog.applyInverseDiffs(loaded.state, prep.entry.diffs_json || []);
  const after = Store.stampLikeApp(reverted, loaded.state);
  const prevLog = Changelog.loadChangelog(p.file);
  const logId = prevLog.entries.length ? Math.max.apply(null, prevLog.entries.map(e => e.id)) + 1 : 1;
  const backupFile = p.file.replace(/\.json$/i, '') + '.pre-' + logId + '.json';
  try { fs.writeFileSync(backupFile, Store.serialize(loaded.state)); } catch (e) { /* best-effort */ }
  const saved = Store.saveProject(p.file, after);
  if (!saved.ok) return toolError(saved.error);
  const entry2 = Changelog.appendEntry(p.file, Object.assign({ id: logId }, Changelog.revertEntryShape(prep.entry)));
  const text = [
    'REVERT APPLIED — change #' + prep.entry.id + ' (' + prep.entry.entry_type + ') undone.',
    'Revert logged as changelog entry #' + entry2.id + ' (history preserved — nothing was erased).'
  ].join('\n');
  return toolResult(text, { reverted: true, revertedEntryId: prep.entry.id, revertLogEntryId: entry2.id, entry: entry2 });
}

// ---- Tool registry ----
const TOOLS = [
  {
    name: 'mmgr_list_projects',
    description: 'List the exported My MaNaGeR project .json files available in the configured project directory. Call this first to discover what projects exist and their exact file names.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'mmgr_get_project_overview',
    description: 'One-line summary of a project: name, methodology, health score, EVM SPI/CPI, task counts, open risks/issues/changes, target completion.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Exported .json file name (from mmgr_list_projects)' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_context',
    description: 'The full automatic project-context dump (Markdown, section-grouped, every line a real state field) — the same grounding payload the app\'s AI uses. Best single call before answering questions.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Exported .json file name' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_tasks',
    description: 'List tasks, optionally filtered by status (todo|inprogress|blocked|completed) and limited in length.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, status: { type: 'string', enum: Validate.STATUS_ENUM.concat(['all']), description: 'Filter by status; "all" or omitted for every task' }, limit: { type: 'number', description: 'Max rows to return' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_task',
    description: 'Get one task by id, with all its fields.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, id: { type: 'string' } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'mmgr_get_risks',
    description: 'List open risks with probability/impact and mitigation.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_issues',
    description: 'List live (unresolved/unclosed) issues.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_budget',
    description: 'Budget lines with planned vs actual, plus the envelope.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_evm',
    description: 'Earned-value metrics: SPI, CPI, EV/PV/AC, BAC, EAC, VAC.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_health',
    description: 'The 5-factor health score with per-factor breakdown (completion/schedule/budget/risk/change).',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_schedule_audit',
    description: 'Non-destructive schedule logic audit: end-before-start, parent-range violations, predecessor ordering.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_weather',
    description: 'Site, weather risk days in the forecast, and weather delay days logged.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_claim_slips',
    description: 'Schedule slips vs baseline with auto-assigned causes (weather/predecessor/other) — claim evidence.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_changelog',
    description: 'Read the MCP changelog for a project (every AI-made edit/revert, cloud-shaped entries).',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_answer_question',
    description: 'Answer a question about the project. Uses the deterministic LOCAL engine first (completion, overdue, budget, risks, issues, critical path, EVM, weather, health) with zero-fabrication trace; questions the local engine cannot ground fall through to the CLOUD provider when MMGR_MCP_AI_KEY is configured.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, question: { type: 'string' } }, required: ['question'], additionalProperties: false }
  },
  {
    name: 'mmgr_get_resources',
    description: 'List resources (labor, equipment, materials, subcontractors) with type, role, availability, and rate.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_stakeholders',
    description: 'List stakeholders with influence, interest, strategy, and contact info.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_meetings',
    description: 'List recent meetings (last 10) with kind, date, attendees, and minutes summary.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_decisions',
    description: 'List decisions with status, owner, date, and rationale.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_documents',
    description: 'List registered documents with type, name, and location.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_bids',
    description: 'List bid packages with budget, deadline, and line item count.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_closure',
    description: 'Project closure checklist status and lessons learned.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_sprint',
    description: 'Current sprint name, start, and end dates.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_dmaic',
    description: 'DMAIC quality methodology phase status with field completion counts.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_spend_log',
    description: 'Recent spend log entries with amounts, descriptions, and total.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_get_weather_log',
    description: 'Weather delay log with dates, delay days, reasons, and total.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'mmgr_list_writable_fields',
    description: 'Introspect the write-operation catalog: every verb, its required fields, the whitelisted writable fields per record type, and the allowed enums. Read this before proposing any change.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'mmgr_propose_change',
    description: 'Validate and stage a batch of write operations against a project. Returns a preview (before/after) and a single-use approval token. Does NOT modify the file — the owner must approve via mmgr_approve_change. Operations: task/risk/issue/resource/stakeholder/decision/document/bidPackage.add/update/delete, budgetLine.add/update/delete, change.update, charter.update, closure.update, sprint.update, spendLog.add, weatherLog.add, commsEntry.add, logEntry.add, dmaic.update, raci.update. Only whitelisted fields per record type (see mmgr_list_writable_fields).',
    description: 'Validate and stage a batch of write operations against a project. Returns a preview (before/after) and a single-use approval token. Does NOT modify the file — the owner must approve via mmgr_approve_change. Operations: task.add/update/delete, risk.add/update/delete, issue.add/update/delete, budgetLine.add/update/delete, change.update, charter.update. Only whitelisted fields per record type (see mmgr_list_writable_fields).',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Exported .json file name' },
        operations: { type: 'array', items: { type: 'object' }, description: 'Batch of validated write operations' }
      },
      required: ['operations'],
      additionalProperties: false
    }
  },
  {
    name: 'mmgr_approve_change',
    description: 'OWNER APPROVAL: apply a proposed change by token. This is the only action that writes to the project file. Refuses if the file changed on disk since the proposal (no clobbering). Logs the change to the changelog.',
    inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'], additionalProperties: false }
  },
  {
    name: 'mmgr_reject_change',
    description: 'Discard a proposed change by token. The project file is never touched.',
    inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'], additionalProperties: false }
  },
  {
    name: 'mmgr_revert_change',
    description: 'Revert an MCP-AI change by changelog entry id. Restores the pre-change field values and logs a NEW revert changelog entry (history preserved). Only MCP-AI edits can be reverted this way.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, entryId: { type: 'number' } }, required: ['entryId'], additionalProperties: false }
  }
];

// ---- Method dispatch ----
async function handleCall(name, args) {
  switch (name) {
    case 'mmgr_list_projects': return listProjectsTool();
    case 'mmgr_get_project_overview': return getProjectOverviewTool(args && args.project);
    case 'mmgr_get_context': return getContextTool(args && args.project);
    case 'mmgr_get_tasks': return getTasksTool(args && args.project, args && args.status, args && args.limit);
    case 'mmgr_get_task': return getTaskTool(args && args.project, args && args.id);
    case 'mmgr_get_risks': return getRisksTool(args && args.project);
    case 'mmgr_get_issues': return getIssuesTool(args && args.project);
    case 'mmgr_get_budget': return getBudgetTool(args && args.project);
    case 'mmgr_get_evm': return getEvmTool(args && args.project);
    case 'mmgr_get_health': return getHealthTool(args && args.project);
    case 'mmgr_get_schedule_audit': return getScheduleAuditTool(args && args.project);
    case 'mmgr_get_weather': return getWeatherTool(args && args.project);
    case 'mmgr_get_claim_slips': return getClaimSlipsTool(args && args.project);
    case 'mmgr_get_changelog': return getChangelogTool(args && args.project);
    case 'mmgr_answer_question': return await answerQuestionTool(args && args.project, args && args.question);
    case 'mmgr_get_resources': return getResourcesTool(args && args.project);
    case 'mmgr_get_stakeholders': return getStakeholdersTool(args && args.project);
    case 'mmgr_get_meetings': return getMeetingsTool(args && args.project);
    case 'mmgr_get_decisions': return getDecisionsTool(args && args.project);
    case 'mmgr_get_documents': return getDocumentsTool(args && args.project);
    case 'mmgr_get_bids': return getBidsTool(args && args.project);
    case 'mmgr_get_closure': return getClosureTool(args && args.project);
    case 'mmgr_get_sprint': return getSprintTool(args && args.project);
    case 'mmgr_get_dmaic': return getDmaicTool(args && args.project);
    case 'mmgr_get_spend_log': return getSpendLogTool(args && args.project);
    case 'mmgr_get_weather_log': return getWeatherLogTool(args && args.project);
    case 'mmgr_list_writable_fields': return listWritableFieldsTool();
    case 'mmgr_propose_change': return proposeChangeTool(args && args.project, args && args.operations);
    case 'mmgr_approve_change': return approveChangeTool(args && args.token);
    case 'mmgr_reject_change': return rejectChangeTool(args && args.token);
    case 'mmgr_revert_change': return revertChangeTool(args && args.project, args && args.entryId);
    default: return toolError('unknown tool "' + name + '"');
  }
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    respondError(null, -32600, 'invalid request');
    return;
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      if (isNotification) return;
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mymanager-mcp', version: VERSION }
      });
      return;
    }
    case 'notifications/initialized': {
      return; // no response to notifications
    }
    case 'ping': {
      if (isNotification) return;
      respond(id, {});
      return;
    }
    case 'tools/list': {
      if (isNotification) return;
      respond(id, { tools: TOOLS });
      return;
    }
    case 'tools/call': {
      if (isNotification) return;
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!name) { respondError(id, -32602, 'tools/call requires a tool name'); return; }
      handleCall(name, args).then(
        result => respond(id, result),
        err => respondError(id, -32603, 'tool ' + name + ' failed: ' + ((err && err.message) || err))
      );
      return;
    }
    default: {
      if (isNotification) return;
      respondError(id, -32601, 'method not found: ' + method);
    }
  }
}

// ---- Bootstrap ----
function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write([
      'My MaNaGeR MCP server (zero-dep, stdio)',
      '',
      'Local mode (exported .json files):',
      '  MMGR_MCP_DIR            directory of exported project .json files (default ' + PROJECT_DIR + ')',
      '  MMGR_MCP_PROJECT        default project file name',
      '',
      'Cloud mode (live project via Worker API):',
      '  MMGR_MCP_CLOUD_URL      Worker URL (e.g. https://my-manager.workers.dev)',
      '  MMGR_MCP_CLOUD_PROJECT  cloud project ID to edit',
      '  MMGR_MCP_OWNER_CODE     owner code for full access',
      '  MMGR_MCP_EDITOR_CODE    editor code for scoped access (alternative to owner)',
      '',
      'AI + writes:',
      '  MMGR_MCP_AI_KEY         BYO cloud key for answer_question fallback (optional)',
      '  MMGR_MCP_PROVIDER       google-gemini | openai | anthropic (default ' + AI_PROVIDER + ')',
      '  MMGR_MCP_ALLOW_WRITES=1 enables the owner-approved write tools',
      '  MMGR_MCP_TOKEN_TTL_MS   approval token TTL (default 600000)'
    ].join('\n') + '\n');
    process.exit(0);
  }
  if (!fs.existsSync(PROJECT_DIR)) {
    process.stderr.write('[mymanager-mcp] project dir does not exist: ' + PROJECT_DIR + '\n');
    process.stderr.write('[mymanager-mcp] create it and drop exported .json files in it, or set MMGR_MCP_DIR\n');
  }
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      return;
    }
    try {
      handleMessage(msg);
    } catch (e) {
      if (msg && msg.id !== undefined && msg.id !== null) {
        respondError(msg.id, -32603, 'internal error: ' + ((e && e.message) || e));
      }
    }
  });
  rl.on('close', () => process.exit(0));
}

main();
