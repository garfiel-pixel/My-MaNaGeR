/* ============================================================
   MCP SERVER — per-project Model Context Protocol endpoint
   ============================================================
   Exposes project data as MCP tools for external AI clients
   (Claude Desktop, Cursor, Windsurf, etc.).

   Transport: Streamable HTTP (POST /api/mcp/:projectId)
   Auth (PATH-A, 2026-09-16 owner decision): the MCP handshake and the tool
   listing answer UNAUTHENTICATED by design - spec-driven clients (Claude
   Desktop's "No sign-in" mode) read a bare HTTP 401 on an MCP endpoint as
   an OAuth requirement and then fail discovery against routes that do not
   exist, so there is deliberately no transport-level 401/403 here.
   Authentication happens per tool call instead: every tools/call needs a
   valid credential - (1) a project API key (sk-mmgr-...) via
   Authorization: Bearer <key> or X-API-Key - scoped, expiring, revocable,
   recommended for external AI clients; (2) the owner code via
   Authorization: Bearer <owner-code> - full access. Without one, the call
   returns a normal MCP isError result (MCP_AUTH_REFUSAL) and no project
   data ever leaves.
   API-KEY-AUDIT (2026-09-16 directive): MCP is now a second transport on
   the cloud_api_keys system. Reads are projected through the key's section
   scope (cloudScopeState); apply_changes queues a cloud_reviews row
   (proposal_type 'mcp') merged under the key's scope - it NEVER imports to
   the changelog directly, so nothing touches live project state until the
   owner accepts the proposal inside the project.

   Tools:
     get_project_summary  — project name, description, health
     get_tasks            — task list with status, dates, deps
     get_budget           — budget lines, planned vs actual, EVM
     get_risks            — risk register with probability, impact
     get_weather          — weather forecast risk days + delay log
     get_meetings         — meeting log with decisions, actions
     get_table            — B3 (2026-10-11): one full table by name, scoped
     run_monte_carlo      — B3 (2026-10-11): schedule simulation, same engine
     apply_changes        — write diffs (goes through review queue)
   ============================================================ */

import {
  json,
  cloudAuthOwnerEither,
  cloudAuthApiKey,
  cloudReadState,
  readCloudBody,
  cloudScopeState,
  cloudScopeMerge,
  cloudDiffState,
  CLOUD_SECTIONS,
  CLOUD_KEY_TO_SECTION
} from '../lib/http.js';
import { API_SHAPES } from '../api/shapes.js';
import { ownerTier } from '../cloud/team.js';

// ---- MCP protocol constants ----

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'my-manager-mcp',
  version: '1.0.0'
};

// PATH-A (2026-09-16): the single tool-layer auth refusal. serve.cjs's dev
// mirror carries a byte-identical copy (it cannot import this ESM module)
// and the QA harnesses assert this exact text.
export const MCP_AUTH_REFUSAL =
  'This endpoint needs its own credential before it will share project data or accept changes. Supply the project API key as Authorization: Bearer <key> or X-API-Key, or the owner code as Authorization: Bearer <owner-code>.';

// B4 (owner 2026-10-11, "yes the mcp is a premium feature"): MCP is gated on
// the PROJECT OWNER's active plan - any paid tier, same standard as
// unlimitedCloud - whatever credential the caller holds (scoped key or owner
// code; both only ever act on that one project, so the owner's plan is the
// only one that can gate it). Same PATH-A law as MCP_AUTH_REFUSAL: this is a
// normal MCP isError result, never an HTTP 401/403 - on an MCP endpoint the
// HTTP status IS API. Credential check runs FIRST, so an unauthenticated or
// bad-Bearer caller still gets the credential refusal and learns nothing
// about plans, projects, or existence.
export const MCP_PREMIUM_REFUSAL =
  'MCP connections are a Premium feature. The project owner needs an active plan - upgrade at /pricing, then reconnect this tool. No project data is shared until then.';

// ---- Tool definitions (MCP schema format) ----

const TOOLS = [
  {
    name: 'get_project_summary',
    description: 'Get the project name, description, health score, and completion percentage.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_tasks',
    description: 'Get all tasks with status, start/end dates, dependencies, and critical flag.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_budget',
    description:
      'Get budget lines with planned vs actual costs, EVM metrics (SPI, CPI, EAC, ETC, VAC).',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_risks',
    description: 'Get the risk register with probability, impact, status, and linked issues.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_weather',
    description:
      'Get weather forecast risk days (precip >= 60%, temp >= 32C or <= 0C) and delay log.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_meetings',
    description: 'Get meeting log with decisions, action items, and attendees.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_table',
    description:
      'Read one full project table by name: tasks, resources, budgetLines, spendLog, stakeholders, changes, logEntries, risks, issues, meetings, documents, commsEntries, raci, dmaic, closure, charter, budgetEnvelope or projectDeadline. API keys only see tables inside their granted sections; the owner code sees all of them. Weather tables (wxCache, weatherLog) are owner-only, same as get_weather.',
    inputSchema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'Table name - one of the names listed in this tool description'
        },
        limit: {
          type: 'integer',
          description: 'Max records to return from an array table (default 200)'
        }
      },
      required: ['table']
    }
  },
  {
    name: 'run_monte_carlo',
    description:
      'Run the schedule Monte Carlo simulation (triangular distribution, the same engine the app uses) and return completion percentiles P10/P50/P80/P90 plus, optionally, the probability of finishing by a target date. Needs the WBS section. High x high risks widen the spread only when the key also grants the Risk section.',
    inputSchema: {
      type: 'object',
      properties: {
        targetDate: {
          type: 'string',
          description: 'Optional ISO date (YYYY-MM-DD) to score completion probability against'
        },
        riskFactor: {
          type: 'number',
          description: 'Duration stretch factor, clamped to 1.0-3.0 (default 1.2)'
        },
        simulations: {
          type: 'integer',
          description: 'Number of runs, clamped to 100-5000 (default 1000)'
        }
      },
      required: []
    }
  },
  {
    name: 'apply_changes',
    description:
      'Submit changes to the project: edit existing records with diffs, or create new records with creates. Everything goes through the owner review queue - never auto-applied. diffs: array of {path, recordId, field, before, after}. creates: array of {path, record} where record needs at least {name} (tasks also accept startDate/endDate/assignee/status; resources accept name/role/rate/type).',
    inputSchema: {
      type: 'object',
      properties: {
        diffs: {
          type: 'array',
          description: 'Array of field-level changes to EXISTING records',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'State key (e.g. "tasks", "budgetLines")' },
              recordId: { type: 'string', description: 'Record ID within the array' },
              field: { type: 'string', description: 'Field name to change' },
              before: { description: 'Current value (for verification)' },
              after: { description: 'New value to set' }
            },
            required: ['path', 'recordId', 'field', 'after']
          }
        },
        creates: {
          type: 'array',
          description:
            'Array of NEW records to propose (e.g. add a task or a resource). Queued for owner review like diffs.',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'List to append to (e.g. "tasks", "resources", "risks", "logEntries")'
              },
              record: {
                type: 'object',
                description:
                  'The new record. Must carry at least a "name" field. Unknown fields are kept; missing fields get list-appropriate defaults so the record renders correctly in the app.'
              }
            },
            required: ['path', 'record']
          }
        },
        label: { type: 'string', description: 'Human-readable label for this change set' }
      },
      required: []
    }
  }
];

// OWNER 2026-09-17 (CREATE support): the owner's lazy-PM scenario - talk to
// the AI in a terminal, it ADDS the new people/tasks, the owner verifies.
// Defaults mirror the app's own creators (js/mmgr-tasks.js addTask,
// js/mmgr-resources.js addResource) so an MCP-created record renders and
// behaves exactly like one created in the UI. A create on a path that is not
// an editable list is refused, same as diffs. Scope enforcement is identical:
// the create lands only if the section is granted, and the whole proposal
// waits in the review queue regardless.
const CREATE_DEFAULTS = {
  tasks: {
    id: null,
    name: 'New Task',
    level: 0,
    indent: 0,
    isPhase: false,
    status: 'todo',
    startDate: '',
    endDate: '',
    duration: '',
    assignee: '',
    critical: false,
    leadTime: false,
    recurring: false,
    weatherExposed: false,
    confidence: 'high',
    predecessors: [],
    notes: '',
    weatherSensitive: false
  },
  resources: {
    id: null,
    name: '',
    type: 'Labor',
    role: '',
    availability: 100,
    rate: 0,
    hoursAllocated: 0,
    utilization: 0
  },
  risks: { id: null, name: '', probability: 'Low', impact: 'Medium', status: 'Open', notes: '' },
  issues: { id: null, name: '', status: 'Open', notes: '' },
  logEntries: { id: null, title: '', decision: '', date: '' },
  meetings: { id: null, title: '', date: '', notes: '' },
  stakeholders: { id: null, name: '', role: '', notes: '' },
  budgetLines: { id: null, name: '', amount: 0 },
  spendLog: { id: null, name: '', amount: 0, date: '' },
  commsEntries: { id: null, title: '', notes: '', date: '' },
  documents: { id: null, name: '', notes: '' },
  changes: { id: null, name: '', notes: '' }
};
function buildCreatedRecord(path, record, nowMs, counterRef) {
  const base = CREATE_DEFAULTS[path] || { id: null, name: '' };
  const rec = JSON.parse(JSON.stringify(base));
  rec.id =
    (path === 'tasks' ? 't_' : path === 'resources' ? 'R' : 'mcp_') +
    nowMs.toString(36) +
    '_' +
    ++counterRef.n;
  if (record && typeof record === 'object') {
    for (const k of Object.keys(record)) {
      if (k === 'id') {
        continue;
      } // ids are server-assigned, never client-supplied
      rec[k] = record[k];
    }
  }
  return rec;
}

// ---- B3 (owner 2026-10-11): full table access + Monte Carlo run ----------
// Two gaps closed, nothing widened. get_table opens the tables the six named
// read tools never covered (resources, stakeholders, decisions, documents,
// RACI, DMAIC, closure...) but validates against the SAME
// CLOUD_KEY_TO_SECTION map apply_changes uses, so a scoped key can never read
// a section it was not granted; the weather tables stay owner-only exactly
// like get_weather. run_monte_carlo is a faithful port of the app's own
// engine (js/mmgr-schedule.js triSample/simulateSchedule/runMonteCarlo -
// triangular sampler, FS predecessor links, fixed-point pass capped at 50,
// the same confidence high/low adjustments) - the parity law: an MCP answer
// and the panel in the app must never disagree about the same schedule.
const GET_TABLE_NAMES = [
  'tasks',
  'resources',
  'budgetLines',
  'spendLog',
  'budgetEnvelope',
  'stakeholders',
  'changes',
  'logEntries',
  'risks',
  'issues',
  'meetings',
  'documents',
  'commsEntries',
  'raci',
  'dmaic',
  'closure',
  'charter',
  'projectDeadline'
];
const GET_TABLE_OWNER_ONLY = ['wxCache', 'weatherLog'];

function executeGetTable(state, scope, args) {
  const name = String((args && args.table) || '').trim();
  if (!name) {
    return {
      content: [
        {
          type: 'text',
          text:
            'Name the table to read, e.g. {"table": "resources"}. Available: ' +
            GET_TABLE_NAMES.join(', ') +
            '.'
        }
      ],
      isError: true
    };
  }
  const ownerOnly = GET_TABLE_OWNER_ONLY.indexOf(name) !== -1;
  if (ownerOnly) {
    if (Array.isArray(scope)) {
      return {
        content: [
          {
            type: 'text',
            text: 'Weather data is not a grantable section, so API keys cannot read it. The project owner can read it inside the app.'
          }
        ],
        isError: true
      };
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify({ table: name, value: state[name] || null }, null, 2) }
      ]
    };
  }
  if (GET_TABLE_NAMES.indexOf(name) === -1) {
    return {
      content: [
        {
          type: 'text',
          text:
            'Unknown table: ' +
            name +
            '. Available: ' +
            GET_TABLE_NAMES.join(', ') +
            (Array.isArray(scope) ? '' : '. Weather: ' + GET_TABLE_OWNER_ONLY.join(', ') + '.')
        }
      ],
      isError: true
    };
  }
  const sec = CLOUD_KEY_TO_SECTION[name];
  if (sec && !sectionAllowed(scope, sec)) {
    return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
  }
  const value = state[name];
  if (value === undefined || value === null) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ table: name, count: 0, records: [] }, null, 2) }
      ]
    };
  }
  if (Array.isArray(value)) {
    const limit = Math.min(1000, Math.max(1, +(args && args.limit) || 200));
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              table: name,
              count: value.length,
              returned: Math.min(limit, value.length),
              records: value.slice(0, limit)
            },
            null,
            2
          )
        }
      ]
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ table: name, value: value }, null, 2) }]
  };
}

// Triangular sampler - byte-for-byte the app's math (mmgr-schedule.js).
function mcpTriSample(min, ml, max) {
  const u = Math.random();
  const fc = (ml - min) / (max - min);
  if (u < fc) {
    return min + Math.sqrt(u * (max - min) * (ml - min));
  }
  return max - Math.sqrt((1 - u) * (max - min) * (max - ml));
}

function executeMonteCarlo(state, scope, args) {
  if (!sectionAllowed(scope, 'wbs')) {
    return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
  }
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(function (t) {
    return t && t.startDate && t.endDate && !t.isPhase;
  });
  if (tasks.length < 2) {
    return {
      content: [{ type: 'text', text: 'Need at least 2 scheduled tasks to simulate.' }],
      isError: true
    };
  }
  const N = Math.min(5000, Math.max(100, Math.round(+(args && args.simulations) || 1000)));
  const riskFactor = Math.min(3, Math.max(1, +(args && args.riskFactor) || 1.2));
  // The app counts high x high open risks (*2 days) - and a scoped key's
  // state was already projected through cloudScopeState above, so a key
  // without the Risk section simply contributes 0 here. Same math either way.
  const highRiskCount = (Array.isArray(state.risks) ? state.risks : []).filter(function (r) {
    return r && !r.issueId && r.probability === 'High' && r.impact === 'High';
  }).length;
  const riskAdder = highRiskCount * 2;

  const results = [];
  for (let sim = 0; sim < N; sim++) {
    const simDur = {};
    tasks.forEach(function (t) {
      const baseDur = Math.max(
        1,
        Math.round((new Date(t.endDate) - new Date(t.startDate)) / 86400000)
      );
      let taskRiskFactor = riskFactor;
      let taskRiskAdder = riskAdder;
      if (t.confidenceLevel === 'high' || t.confidence === 'high') {
        taskRiskFactor = Math.min(riskFactor, 1.1);
        taskRiskAdder = Math.min(riskAdder, 1);
      } else if (t.confidenceLevel === 'low' || t.confidence === 'low') {
        taskRiskFactor = riskFactor * 1.3;
        taskRiskAdder = riskAdder + 2;
      }
      simDur[t.id] = mcpTriSample(baseDur * 0.8, baseDur, baseDur * taskRiskFactor + taskRiskAdder);
    });
    const startDates = {};
    const endDates = {};
    tasks.forEach(function (t) {
      startDates[t.id] = new Date(t.startDate);
      endDates[t.id] = new Date(t.startDate);
    });
    let changed = true;
    let passes = 0;
    while (changed && passes < 50) {
      changed = false;
      passes++;
      tasks.forEach(function (t) {
        const preds = Array.isArray(t.predecessors) ? t.predecessors : [];
        let minStart = null;
        preds.forEach(function (pid) {
          if (!endDates[pid] || !startDates[pid]) {
            return;
          }
          const cs = new Date(endDates[pid]);
          if (!minStart || cs > minStart) {
            minStart = cs;
          }
        });
        let sd = new Date(t.startDate);
        if (minStart && minStart > sd) {
          sd = minStart;
        }
        if (!startDates[t.id] || sd > startDates[t.id]) {
          startDates[t.id] = sd;
          changed = true;
        }
        const se = new Date(sd);
        se.setDate(se.getDate() + Math.round(simDur[t.id]));
        if (!endDates[t.id] || se > endDates[t.id]) {
          endDates[t.id] = se;
          changed = true;
        }
      });
    }
    results.push(
      new Date(
        Math.max.apply(
          null,
          Object.keys(endDates).map(function (k) {
            return endDates[k].getTime();
          })
        )
      )
    );
  }
  results.sort(function (a, b) {
    return a - b;
  });
  const iso = function (d) {
    return d.toISOString().slice(0, 10);
  };
  const out = {
    simulations: N,
    tasksSimulated: tasks.length,
    highRiskCount: highRiskCount,
    riskFactor: riskFactor,
    riskAdder: riskAdder,
    percentiles: {
      p10: iso(results[Math.floor(N * 0.1)]),
      p50: iso(results[Math.floor(N * 0.5)]),
      p80: iso(results[Math.floor(N * 0.8)]),
      p90: iso(results[Math.floor(N * 0.9)])
    }
  };
  const target = String((args && args.targetDate) || '').trim();
  if (target) {
    const td = new Date(target);
    if (isNaN(td.getTime())) {
      return {
        content: [{ type: 'text', text: 'targetDate must be an ISO date, e.g. "2026-12-01".' }],
        isError: true
      };
    }
    const pct = Math.round(
      (results.filter(function (d) {
        return d <= td;
      }).length /
        N) *
        100
    );
    out.target = { date: target, probabilityPct: pct };
  }
  return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
}

// ---- Tool execution ----

// API-KEY-AUDIT F4 (2026-09-16): a scoped key only ever sees its granted
// sections. `scope` is null for an owner-code caller (full access) or the
// key's granted section keys (see CLOUD_SECTIONS) - each tool then either
// projects its output through cloudScopeState or refuses with a clear
// message when its whole section is not granted. Weather is not a grantable
// section at all, so scoped keys are refused there outright.
function sectionAllowed(scope, sec) {
  return !Array.isArray(scope) || scope.indexOf(sec) !== -1;
}
function sectionRefusal(scope) {
  return (
    'This API key does not include that section. The owner granted it: ' +
    (Array.isArray(scope) && scope.length ? scope.join(', ') : '(no sections)') +
    '. Ask the project owner to tick more sections for this key.'
  );
}

function executeTool(name, state, projectId, label, scope, args) {
  if (!state) {
    return {
      content: [{ type: 'text', text: 'No project data available. Save a snapshot first.' }],
      isError: true
    };
  }
  if (Array.isArray(scope)) {
    state = cloudScopeState(state, scope);
  }

  switch (name) {
    case 'get_project_summary': {
      const tasks = Array.isArray(state.tasks) ? state.tasks : [];
      const done = tasks.filter(t => t.status === 'completed').length;
      const total = tasks.length;
      const risks = Array.isArray(state.risks) ? state.risks : [];
      const openRisks = risks.filter(r => !r.issueId).length;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                projectId,
                name: state.charter && state.charter.name ? state.charter.name : projectId,
                description:
                  state.charter && state.charter.description ? state.charter.description : '',
                completion: total ? Math.round((done / total) * 100) : 0,
                totalTasks: total,
                completedTasks: done,
                openRisks,
                charter: state.charter || null
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'get_tasks': {
      if (!sectionAllowed(scope, 'wbs')) {
        return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      }
      const tasks = Array.isArray(state.tasks) ? state.tasks : [];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: tasks.length,
                tasks: tasks.map(t => ({
                  id: t.id,
                  name: t.name || t.id,
                  status: t.status || 'todo',
                  startDate: t.startDate || null,
                  endDate: t.endDate || null,
                  critical: !!t.critical,
                  // B16 (audit 2026-09-28): the app's dependency field is
                  // `predecessors` (mmgr-tasks.js defaults, mmgr-schedule.js
                  // engine) - the old read of t.dependencies ALWAYS produced [],
                  // so every AI client saw an unlinked schedule with no critical
                  // path. Output field name stays `dependencies` (the published
                  // MCP shape qa-engine-parity asserts); the source is corrected.
                  dependencies:
                    Array.isArray(t.predecessors) && t.predecessors.length
                      ? t.predecessors
                      : Array.isArray(t.dependencies)
                        ? t.dependencies
                        : [],
                  assignee: t.assignee || null,
                  notes: t.notes || null
                }))
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'get_budget': {
      if (!sectionAllowed(scope, 'bud')) {
        return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      }
      const lines = Array.isArray(state.budgetLines) ? state.budgetLines : [];
      const spendLog = Array.isArray(state.spendLog) ? state.spendLog : [];
      const enriched = lines.map(line => {
        const log = spendLog.filter(e => e.budgetLineId === line.id);
        const actual = log.length
          ? log.reduce((s, e) => s + (+e.amount || 0), 0)
          : +line.actual || 0;
        return {
          id: line.id,
          name: line.name || line.id,
          category: line.category || null,
          planned: +line.planned || 0,
          actual,
          variance: (+line.planned || 0) - actual,
          linkedTaskId: line.linkedTaskId || line.taskId || null
        };
      });
      const totalPlanned = enriched.reduce((s, l) => s + l.planned, 0);
      const totalActual = enriched.reduce((s, l) => s + l.actual, 0);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                totalPlanned,
                totalActual,
                variance: totalPlanned - totalActual,
                lineCount: enriched.length,
                lines: enriched
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'get_risks': {
      if (!sectionAllowed(scope, 'risk')) {
        return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      }
      const risks = Array.isArray(state.risks) ? state.risks : [];
      const issues = Array.isArray(state.issues) ? state.issues : [];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                riskCount: risks.length,
                issueCount: issues.length,
                risks: risks.map(r => ({
                  id: r.id,
                  description: r.description || '(untitled)',
                  probability: r.probability || null,
                  impact: r.impact || null,
                  status: r.status || 'open',
                  promoted: !!r.issueId,
                  mitigation: r.mitigation || null
                })),
                issues: issues.map(i => ({
                  id: i.id,
                  description: i.description || '(untitled)',
                  status: i.status || 'open',
                  owner: i.owner || null
                }))
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'get_weather': {
      if (Array.isArray(scope)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Weather data is not a grantable section, so API keys cannot read it. The project owner can read it inside the app.'
            }
          ],
          isError: true
        };
      }
      const cache = state.wxCache || null;
      const days = cache && Array.isArray(cache.days) ? cache.days : [];
      const log = Array.isArray(state.weatherLog) ? state.weatherLog : [];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                cachedAt: cache && cache.at ? new Date(cache.at).toISOString() : null,
                forecastDays: days.length,
                forecast: days.slice(0, 14).map(d => ({
                  date: d.date,
                  precip: +d.precip || 0,
                  tMax: +d.tMax || 0,
                  tMin: +d.tMin || 0
                })),
                delayLogCount: log.length,
                delayLog: log.slice(-20).map(w => ({
                  date: w.date || null,
                  condition: w.condition || null,
                  delayDays: +w.delayDays || 0,
                  cause: w.cause || null
                }))
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'get_meetings': {
      if (!sectionAllowed(scope, 'meet')) {
        return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      }
      const meetings = Array.isArray(state.meetings) ? state.meetings : [];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: meetings.length,
                meetings: meetings.map(m => ({
                  id: m.id,
                  date: m.date || null,
                  title: m.title || m.name || '(untitled)',
                  attendees: m.attendees || [],
                  decisions: m.decisions || [],
                  actions: m.actions || m.actionItems || [],
                  notes: m.notes || null
                }))
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'get_table':
      return executeGetTable(state, scope, args);
    case 'run_monte_carlo':
      return executeMonteCarlo(state, scope, args);
    case 'apply_changes': {
      // API-KEY-AUDIT F3 (2026-09-16): this used to return a special result
      // and the route handler fetched /changelog/import - an AUDIT-LOG
      // importer that only records diffs already true in the stored state,
      // so a genuinely new change always came back 'diverged' and the tool
      // could never do what its description promised. The queueing now lives
      // in handleMcpRequest (below) and creates a pending cloud_reviews row.
      return { pendingApply: true };
    }
    default:
      return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
  }
}

// ---- MCP protocol handler ----

async function handleMcpRequest(body, projectId, env, auth) {
  const method = body && body.method;
  const id = body && body.id;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: SERVER_INFO
      }
    };
  }

  if (method === 'notifications/initialized') {
    // Client acknowledgment, no response needed
    return null;
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS }
    };
  }

  if (method === 'tools/call') {
    const params = body.params || {};
    const toolName = params.name;
    const toolArgs = params.arguments || {};

    if (!toolName) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
    }

    // PATH-A auth gate (2026-09-16): the transport connected this caller
    // without credentials, so the tool layer refuses here - a normal MCP
    // isError result, never an HTTP 401. No credential, no data, no writes.
    if (!auth) {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: MCP_AUTH_REFUSAL }], isError: true }
      };
    }

    // Read project state
    const key = 'projects/' + projectId + '/latest.json';
    const row = await env.DB.prepare(
      'SELECT latest_r2_key, owner_code_hash, owner_code_salt, google_sub FROM cloud_projects WHERE project_id = ?'
    )
      .bind(projectId)
      .first();

    // B4 premium gate: valid credential, but the project owner has no active
    // plan -> refuse in MCP shape. A project with no linked owner (no
    // google_sub) reads as free, same as an absent entitlement row.
    const mcpTier = await ownerTier(env, (row && row.google_sub) || '');
    if (mcpTier === 'free') {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: MCP_PREMIUM_REFUSAL }], isError: true }
      };
    }
    const state =
      row && row.latest_r2_key
        ? await cloudReadState(env, key, row.owner_code_hash, row.owner_code_salt)
        : null;

    // Execute the tool. API-KEY-AUDIT F4: a scoped key's reads are filtered
    // to its granted sections; an owner-code caller gets scope=null (full).
    const result = executeTool(
      toolName,
      state,
      projectId,
      auth.label || 'MCP AI',
      auth.role === 'api' ? auth.scope : null,
      toolArgs
    );

    // Handle apply_changes - queue a pending review proposal (API-KEY-AUDIT
    // F3, 2026-09-16). Field-level diffs are materialized onto a copy of the
    // stored state, merged under the caller's section scope exactly like the
    // REST save path, and inserted as a pending cloud_reviews row. NOTHING
    // is written to live project state here - the owner accepts or rejects
    // inside the project, and only the accept applies the change.
    if (result.pendingApply) {
      const diffs = Array.isArray(toolArgs.diffs) ? toolArgs.diffs : [];
      const creates = Array.isArray(toolArgs.creates) ? toolArgs.creates : [];
      if (diffs.length === 0 && creates.length === 0) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: 'Nothing provided. Supply diffs as {path, recordId, field, after} and/or creates as {path, record} objects.'
              }
            ],
            isError: true
          }
        };
      }

      const granted = Array.isArray(auth.scope) ? auth.scope : Object.keys(CLOUD_SECTIONS);
      let prev = state; // the full stored state fetched above (pre-scope)
      // CREATE into an empty project (owner 2026-09-17): a brand-new cloud
      // project has no snapshot yet - the owner's lazy-PM scenario starts
      // exactly there. With creates only, seed a minimal prev instead of
      // refusing; the review-accept path writes the merged state either way.
      if (!prev && diffs.length === 0 && creates.length > 0) {
        prev = { schemaVersion: 19, projectId: projectId, updatedAt: new Date().toISOString() };
      }
      if (!prev) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: 'No project data available. Save a snapshot first, or use creates to add new records to the empty project.'
              }
            ],
            isError: true
          }
        };
      }
      const base = JSON.parse(JSON.stringify(prev));
      const submitted = {};
      const refused = [];
      for (let i = 0; i < diffs.length; i++) {
        const d = diffs[i];
        if (!d || typeof d !== 'object') {
          refused.push('diff ' + i + ': invalid');
          continue;
        }
        const path = String(d.path || '');
        const rec = String(d.recordId || '');
        const field = String(d.field || '');
        const sec = CLOUD_KEY_TO_SECTION[path];
        if (!sec) {
          refused.push((path || '(empty)') + ': not a project section');
          continue;
        }
        if (granted.indexOf(sec) === -1) {
          refused.push(path + ': outside the granted sections');
          continue;
        }
        const arr = base[path];
        if (!Array.isArray(arr)) {
          refused.push(path + ': not an editable list');
          continue;
        }
        let item = null;
        for (let j = 0; j < arr.length; j++) {
          if (arr[j] && String(arr[j].id) === rec) {
            item = arr[j];
            break;
          }
        }
        if (!item) {
          refused.push((rec || '(no record id)') + ': not found in ' + path);
          continue;
        }
        if (!field) {
          refused.push('diff ' + i + ': missing field');
          continue;
        }
        item[field] = d.after !== undefined ? d.after : null;
        submitted[path] = arr;
      }
      // CREATE support (owner 2026-09-17): append new records to editable
      // list paths, defaults per list, ids server-assigned. Same scope and
      // review-queue rules as diffs.
      const refusedCreates = [];
      const counterRef = { n: 0 };
      const nowMs = Date.now();
      for (let i = 0; i < creates.length; i++) {
        const c = creates[i];
        if (!c || typeof c !== 'object') {
          refusedCreates.push('create ' + i + ': invalid');
          continue;
        }
        const cpath = String(c.path || '');
        const recInput = c.record;
        const csec = CLOUD_KEY_TO_SECTION[cpath];
        if (!csec) {
          refusedCreates.push((cpath || '(empty)') + ': not a project section');
          continue;
        }
        if (granted.indexOf(csec) === -1) {
          refusedCreates.push(cpath + ': outside the granted sections');
          continue;
        }
        if (!recInput || typeof recInput !== 'object') {
          refusedCreates.push('create ' + i + ': missing record');
          continue;
        }
        // TITLE-KEYED LISTS (2026-09-26): meetings, logEntries and commsEntries
        // are title-keyed by the app's own creators (mmgr-meetings.js,
        // mmgr-decisions.js, mmgr-closure.js) AND by CREATE_DEFAULTS below, so
        // the gate must accept name OR title. A title-only create used to be
        // refused with 'record needs at least a name', silently shrinking the
        // queued proposal (found via the bank-renovation #20 field-count gap).
        const titleVal =
          recInput.title !== undefined && recInput.title !== null
            ? String(recInput.title).trim()
            : '';
        const hasName =
          (recInput.name !== undefined &&
            recInput.name !== null &&
            String(recInput.name).trim() !== '') ||
          titleVal !== '';
        if (!hasName) {
          refusedCreates.push(
            'create ' + i + ' (' + cpath + '): record needs at least a name or title'
          );
          continue;
        }
        if (!CREATE_DEFAULTS[cpath]) {
          refusedCreates.push(cpath + ': not a list that accepts new records');
          continue;
        }
        const arr2 = Array.isArray(base[cpath]) ? base[cpath] : (base[cpath] = []);
        arr2.push(buildCreatedRecord(cpath, recInput, nowMs, counterRef));
        submitted[cpath] = arr2;
      }
      const allRefused = refused.concat(refusedCreates);
      if (!Object.keys(submitted).length) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text:
                  'Nothing to propose. ' +
                  (allRefused.length ? 'Refused: ' + allRefused.join('; ') + '.' : '')
              }
            ],
            isError: true
          }
        };
      }
      const merged = cloudScopeMerge(prev, submitted, granted);
      if (!merged.applied.length) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text:
                  'No changes were within the granted sections.' +
                  (refused.length ? ' Refused: ' + refused.join('; ') + '.' : '')
              }
            ],
            isError: true
          }
        };
      }
      const now = new Date().toISOString();
      const diffsJson = (cloudDiffState(prev, merged.next) || []).filter(function (d) {
        return String(d.path).indexOf('fieldTs') !== 0;
      });
      let res;
      try {
        res = await env.DB.prepare(
          'INSERT INTO cloud_reviews (project_id, proposal_type, source_type, source_label, editor_code_id, scope, submitted_json, diffs_json, status, proposed_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
        )
          .bind(
            projectId,
            'mcp',
            'api',
            auth.label || 'MCP AI',
            null,
            JSON.stringify(granted),
            JSON.stringify(submitted),
            JSON.stringify(diffsJson),
            'pending',
            now
          )
          .run();
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: 'Could not queue the proposal: ' + (e.message || 'database error')
              }
            ],
            isError: true
          }
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text:
                'Queued ' +
                diffsJson.length +
                ' field change(s) for owner review (proposal #' +
                res.meta.last_row_id +
                ').' +
                (refused.length ? ' Refused: ' + refused.join('; ') + '.' : '') +
                ' Nothing changes until the owner accepts it inside the project.'
            }
          ]
        }
      };
    }

    return { jsonrpc: '2.0', id, result };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found: ' + method }
  };
}

// ---- Route handler ----

export async function handleMcpServer(request, env, projectId) {
  // Only POST is supported for Streamable HTTP
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'MCP server requires POST' }, 405);
  }

  // Resolve credentials BEST-EFFORT. PATH-A (2026-09-16): there is no
  // transport-level 401/403 - the handshake and tools/list answer
  // unauthenticated so MCP clients can connect without the server being
  // mistaken for an OAuth resource, and every tools/call is gated inside
  // handleMcpRequest instead. A project API key (Authorization: Bearer
  // sk-mmgr-... or X-API-Key) is the RECOMMENDED credential - scoped,
  // expiring, revocable (API-KEY-AUDIT F2). The owner-code Bearer still
  // works with full access; cloudAuthOwnerEither takes (request, env,
  // projectId), so the Bearer token is routed through the X-Owner-Code
  // header the helper reads (MCP-BEARER-FIX, 2026-09-12 owner review).
  let auth = null;
  const apiKey = String(request.headers.get('X-API-Key') || '').trim();
  const authHeader = request.headers.get('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!apiKey && bearer && bearer.lastIndexOf('sk-mmgr-', 0) === 0) {
    auth = await cloudAuthApiKey(request, env, projectId, bearer);
  }
  if (!auth && apiKey) {
    auth = await cloudAuthApiKey(request, env, projectId, apiKey);
  }
  if (!auth && bearer && bearer.lastIndexOf('sk-mmgr-', 0) !== 0) {
    const authHeaders = new Headers(request.headers);
    authHeaders.set('X-Owner-Code', bearer);
    const authReq = new Request(request.url, {
      method: 'POST',
      headers: authHeaders,
      body: request.body
    });
    auth = await cloudAuthOwnerEither(authReq, env, projectId);
  }

  // Parse request body
  const read = await readCloudBody(request);
  if (read.tooLarge) {
    return json({ ok: false, error: 'Request too large' }, 413);
  }
  if (read.bad || !read.body) {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const body = read.body;
  const projectIdFromUrl = projectId;

  try {
    const response = await handleMcpRequest(body, projectIdFromUrl, env, auth);
    if (!response) {
      return new Response(null, { status: 202 });
    }
    return json(response, 200);
  } catch (e) {
    console.error('MCP error:', e && e.message);
    return json(
      {
        jsonrpc: '2.0',
        id: body && body.id,
        error: { code: -32603, message: 'Internal error: ' + (e.message || 'unknown') }
      },
      500
    );
  }
}
