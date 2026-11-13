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
  cloudHealStaleClaims,
  readCloudBody,
  cloudScopeState,
  cloudScopeMerge,
  cloudDiffState,
  CLOUD_SECTIONS,
  CLOUD_KEY_TO_SECTION
} from '../lib/http.js';
import { API_SHAPES } from '../api/shapes.js';
import { enrichDiffs, setPathValue, getPathValue, valuesEqual } from '../cloud/proposal-diffs.js';
import { ownerTier } from '../cloud/team.js';
import { structuredLog } from '../lib/observe.js';
import {
  BUDGET_PROPOSAL_LIMIT,
  BUDGET_LARGE_PER_DAY,
  BUDGET_LINE_FIELDS,
  parseISO,
  buildBudgetProposal
} from '../lib/budget.js';
import { createDefaults, stampCreated, canonicalField } from './model.js';

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

// App-wide server (src/mcp/appwide.js) reuses this exact tool catalog and the
// read engine below, so the two surfaces never disagree about a project.
export const TOOLS = [
  {
    name: 'get_project_summary',
    description: 'Get the project name, description, and completion percentage.',
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
      'Get budget lines with planned vs actual costs, EVM metrics (SPI, CPI, EAC, ETC, VAC). H-5: each line also carries its BOQ quantity, unit, rate, deliveries, remaining quantity and a status chip; the frozen baseline and the variation count are included. Needs the Budget section AND the key\'s "Read budget" switch.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_deliveries',
    description:
      'Get every recorded delivery (quantity, unit price, supplier reference, status, amount) with the per-line rollup: quantity received, quantity left, money left, price variance and quantity variance. Needs the Budget section AND the key\'s "Read budget" switch.',
    inputSchema: {
      type: 'object',
      properties: {
        lineId: {
          type: 'string',
          description: 'Optional budget line id to narrow the answer to one line'
        }
      },
      required: []
    }
  },
  {
    name: 'get_weekly_summary',
    description:
      'Get the weekly budget view for one Monday-to-Sunday week: money spent that week, spent to date, plan to date, money used vs work done, forecast at completion, the price/quantity variance split and a status chip per line. Defaults to the latest week that has money in it. Needs the Budget section AND the key\'s "Read budget" switch.',
    inputSchema: {
      type: 'object',
      properties: {
        week: {
          type: 'string',
          description: 'Any ISO date inside the week (YYYY-MM-DD); the week starts on Monday'
        }
      },
      required: []
    }
  },
  {
    name: 'get_proposal_status',
    description:
      "Check what the owner decided about a proposal this key queued: pending, accepted, edited-and-accepted or rejected, with the owner's reason when one was given. Without an id it returns the most recent proposals for this key.",
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: {
          type: 'integer',
          description: 'The proposal number returned by apply_changes'
        },
        limit: {
          type: 'integer',
          description: 'How many recent proposals to list (default 10, max 50)'
        }
      },
      required: []
    }
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
      'Submit changes to the project: edit existing records with diffs, create new records with creates, or set whole values / nested object fields with sets. Everything goes through the owner review queue - never auto-applied. diffs: array of {path, recordId, field, before, after}. creates: array of {path, record} where record needs at least {name} (tasks also accept startDate/endDate/assignee/status; resources accept name/role/rate/type). sets: array of {path, field, value} for object sections (charter, dmaic, closure, raci) and scalar keys (projectDeadline, budgetEnvelope, projectName) - omit field to replace the whole value. budget: budget-only proposals (addLine, changeLine, addDelivery) - these need the key\'s "Propose budget changes" switch, every money value is checked on the server, and the server computes the delivery amount itself.',
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
        sets: {
          type: 'array',
          description:
            'Whole-value changes for sections that are objects or scalars rather than record lists. Each item is {path, field, value}: path is the state key ("dmaic", "closure", "raci", "charter", "projectDeadline", "budgetEnvelope"); field is a nested key ("define.problem", "lessons[0].text") and may be omitted for a scalar key. Queued for owner review like every other change.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'State key (e.g. "dmaic", "projectDeadline")' },
              field: {
                type: 'string',
                description: 'Nested field inside an object section; omit for a scalar key'
              },
              value: { description: 'The new value' }
            },
            required: ['path', 'value']
          }
        },
        budget: {
          type: 'array',
          description:
            'Budget proposals. addLine: {kind, line:{name, category, planned, qty, unit, rate, boqRef, linkedTaskId}}. changeLine: {kind, lineId, field, value}. addDelivery: {kind, lineId, qty, unitPrice, date, unit, supplierRef, status, note}. The amount of a delivery is qty x unitPrice, computed by the server. Deleting a budget line is not available.',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', description: 'addLine, changeLine or addDelivery' },
              line: { type: 'object', description: 'For addLine: the new line' },
              lineId: {
                type: 'string',
                description: 'For changeLine and addDelivery: the line id'
              },
              field: {
                type: 'string',
                description: 'For changeLine: name, category, planned, qty, unit, rate or boqRef'
              },
              value: { description: 'For changeLine: the new value' },
              qty: { type: 'number', description: 'For addDelivery: quantity received' },
              unitPrice: { type: 'number', description: 'For addDelivery: price per unit' },
              unit: {
                type: 'string',
                description: 'For addDelivery: unit; must match the line unit'
              },
              date: { type: 'string', description: 'For addDelivery: YYYY-MM-DD' },
              supplierRef: {
                type: 'string',
                description: 'For addDelivery: delivery note or invoice'
              },
              status: {
                type: 'string',
                description: 'For addDelivery: ordered, received or paid (default received)'
              },
              note: { type: 'string', description: 'For addDelivery: a short note' }
            },
            required: ['kind']
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
// MCP-AGENT-FIRST 2026-11-12 2.1: the defaults now come from src/mcp/model.js,
// which is derived from the app's own creators (js/mmgr-tasks.js createTask,
// js/mmgr-resources.js addResource, ...) and proven field-for-field by
// test/mcp-model.test.mjs. The old CREATE_DEFAULTS had drifted: a created
// task lacked createdDate/boardPosition/relations/custom, a risk was keyed on
// `name` while the app stores `description`, and documents/changes were
// missing their whole register shape. A create on a path that is not an
// editable list is refused, same as diffs. Scope enforcement is identical:
// the create lands only if the section is granted, and the whole proposal
// waits in the review queue regardless.
function mcpToday(nowMs) {
  // The client's U.todayStr() uses the browser's local day. The Worker has
  // only UTC, so a create near midnight can carry the neighbouring day; the
  // date is informational and the app re-stamps on the next real status move.
  return new Date(nowMs).toISOString().slice(0, 10);
}

// Mirrors js/mmgr-kanban.js nextPosition: the new card lands at the end of
// its column, never in the middle of the owner's ordering.
function nextTaskPosition(tasks, status) {
  let max = -1;
  (tasks || []).forEach(function (t) {
    if (!t || (t.status || 'todo') !== status) {
      return;
    }
    const p =
      typeof t.boardPosition === 'number' && isFinite(t.boardPosition)
        ? t.boardPosition
        : Number.MAX_SAFE_INTEGER;
    if (p !== Number.MAX_SAFE_INTEGER && p > max) {
      max = p;
    }
  });
  return max + 1;
}

function buildCreatedRecord(path, record, nowMs, counterRef, siblings) {
  const rec = createDefaults(path);
  if (!rec) {
    return null;
  }
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
      // A modelled alias lands on its canonical stored name (`name` on a
      // risk or issue becomes `description`). Unmodelled keys still pass
      // through in Phase 2.1; Phase 2.2 refuses them in planProposal.
      rec[canonicalField(path, k) || k] = record[k];
    }
  }
  return stampCreated(path, rec, {
    today: mcpToday(nowMs),
    boardPosition: path === 'tasks' ? nextTaskPosition(siblings, rec.status || 'todo') : 0
  });
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
// MCP-AGENT-FIRST 2026-11-12 1.1: the three money tables obey the key's
// "Read budget" switch exactly like get_budget / get_weekly_summary /
// get_deliveries already do. get_table used to skip that gate, so a key with
// the Budget section but read off could pull every figure through it.
const GET_TABLE_BUDGET = ['budgetLines', 'spendLog', 'budgetEnvelope'];

function executeGetTable(state, scope, args, auth) {
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
  // MCP-AGENT-FIRST 2026-11-12 1.1: money tables need "Read budget" as well as
  // the Budget section. Refuse before any value is serialised.
  if (GET_TABLE_BUDGET.indexOf(name) !== -1 && !budgetReadAllowed(auth)) {
    return { content: [{ type: 'text', text: BUDGET_READ_REFUSAL }], isError: true };
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

// S-1 (AUDIT-DIRECTIVE-2026-10-18, rule N5): src/ carries no Math.random at
// all, so the sampler draws from a xorshift128 generator seeded once from the
// CSPRNG. Percentiles come from the same triangular math; the source of the
// uniform numbers is not predictable from earlier output.
let _mcRngState = null;
function mcpNextUniform() {
  if (!_mcRngState) {
    const seed = new Uint32Array(4);
    crypto.getRandomValues(seed);
    // All-zero state is a fixed point of xorshift: nudge it.
    if (!seed[0] && !seed[1] && !seed[2] && !seed[3]) {
      seed[0] = 0x9e3779b9;
    }
    _mcRngState = seed;
  }
  let t = _mcRngState[3];
  const s0 = _mcRngState[0];
  _mcRngState[3] = _mcRngState[2];
  _mcRngState[2] = _mcRngState[1];
  _mcRngState[1] = s0;
  t ^= t << 11;
  t ^= t >>> 8;
  _mcRngState[0] = (t ^ s0 ^ (s0 >>> 19)) >>> 0;
  return _mcRngState[0] / 4294967296;
}

// Triangular sampler - byte-for-byte the app's math (mmgr-schedule.js).
function mcpTriSample(min, ml, max) {
  const u = mcpNextUniform();
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
  // P1 (MCP-DIRECTIVE 2026-11-11): validate targetDate up front. The live
  // endpoint used to run the full simulation first and only then reject a
  // nonsense date, and an invalid date was observed to crash the Worker with
  // a Cloudflare 1102. Reject before any simulation work.
  const target = String((args && args.targetDate) || '').trim();
  let targetDate = null;
  if (target) {
    targetDate = new Date(target);
    if (isNaN(targetDate.getTime())) {
      return {
        content: [{ type: 'text', text: 'targetDate must be an ISO date, e.g. "2026-12-01".' }],
        isError: true
      };
    }
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
  if (targetDate) {
    const pct = Math.round(
      (results.filter(function (d) {
        return d <= targetDate;
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

// ---- H-5 budget access (BUDGET-BOQ directive 2026-11-05) ------------------
//
// Two switches, separate from the section scope and both OFF until the owner
// turns them on. The section decides what a key can see at all; these decide
// what it can do with money. An owner-code caller is not an API key and is
// never limited by them.
//
// The read tools below mirror the app's own money functions
// (js/mmgr-resources.js spendIsSpent / budgetLineActual / deliveryRollup and
// js/mmgr-weekly.js summary) so an AI client and the owner's screen can never
// disagree about the same project. When one of those changes, change this too.
const BUDGET_READ_REFUSAL =
  'This API key may not read the budget. The project owner can turn on "Read budget" for this key in Cloud, Share, API Keys. No budget figures are included in this answer.';
const BUDGET_WRITE_REFUSAL =
  'This API key may not propose budget changes. The owner can turn on "Propose budget changes" for this key in Cloud, Share, API Keys. A proposal never changes a live figure - the owner approves it inside the project.';

function budgetReadAllowed(auth) {
  return !auth || auth.role !== 'api' || auth.budgetRead === true;
}
function budgetWriteAllowed(auth) {
  return !auth || auth.role !== 'api' || (auth.budgetRead === true && auth.budgetWrite === true);
}
function spendIsSpent(e) {
  const st = (e && e.status) || 'received';
  return st !== 'ordered';
}
function spendIsPaid(e) {
  return ((e && e.status) || 'received') === 'paid';
}
function lineActual(line, spendLog) {
  const log = (spendLog || []).filter(e => e.budgetLineId === line.id && spendIsSpent(e));
  if (log.length) {
    return log.reduce((sum, e) => sum + (+e.amount || 0), 0);
  }
  return +line.actual || 0;
}
// Same shape as Spend.deliveryRollup in js/mmgr-resources.js.
function deliveryRollup(line, spendLog) {
  const log = (spendLog || []).filter(e => e.budgetLineId === line.id);
  const baseQty = line.qty == null ? null : +line.qty || 0;
  const baseRate = line.rate == null ? null : +line.rate || 0;
  let qty = 0;
  let spent = 0;
  let paid = 0;
  let committed = 0;
  let priceVar = 0;
  let anyQty = false;
  log.forEach(e => {
    if (!spendIsSpent(e)) {
      committed += +e.amount || 0;
      return;
    }
    spent += +e.amount || 0;
    if (spendIsPaid(e)) {
      paid += +e.amount || 0;
    }
    if (e.qty != null && e.unitPrice != null) {
      anyQty = true;
      const q = +e.qty || 0;
      qty += q;
      priceVar += (Math.round((+e.unitPrice || 0) * 1e6) / 1e6 - (baseRate || 0)) * q;
    }
  });
  const planned = +line.planned || 0;
  return {
    hasQty: anyQty && baseQty != null,
    qtyReceived: qty,
    qtyLeft: baseQty == null ? null : Math.max(0, baseQty - qty),
    qtyPct: baseQty ? Math.round((qty / baseQty) * 100) : 0,
    moneyLeft: planned - spent,
    planned: planned,
    spent: spent,
    committed: committed,
    paid: paid,
    owed: Math.max(0, spent - paid),
    priceVar: priceVar,
    qtyVar: baseQty == null || baseRate == null ? null : planned - baseRate * qty
  };
}
// Q5 chips: watch at 80 percent of plan, over above 100 percent, and price
// when the average price paid is above the BOQ rate.
function chipFor(planned, spent, priceVar) {
  const usedPct = planned ? (spent / planned) * 100 : 0;
  let chip = 'ontrack';
  if (planned && usedPct > 100) {
    chip = 'over';
  } else if (planned && usedPct >= 80) {
    chip = 'watch';
  }
  if (priceVar > 0.005) {
    chip = chip === 'over' ? 'over' : 'price';
  }
  return { usedPct: usedPct, chip: chip };
}
function baselineOf(state) {
  const list = Array.isArray(state && state.budgetBaselines) ? state.budgetBaselines : [];
  return list.length ? list[list.length - 1] : null;
}

// ---- week helpers (UTC; the client uses local dates for the same rule) ----
function isoOf(d) {
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return d.getUTCFullYear() + '-' + m + '-' + day;
}
function weekStartOf(iso) {
  const d = parseISO(iso);
  if (!d) {
    return '';
  }
  const day = d.getUTCDay(); // 0 Sunday .. 6 Saturday
  const back = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return isoOf(d);
}
function addDaysIso(iso, n) {
  const d = parseISO(iso);
  if (!d) {
    return '';
  }
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}
function weeksOf(state) {
  const set = {};
  (state.spendLog || []).forEach(e => {
    if (e && e.date) {
      const w = weekStartOf(e.date);
      if (w) {
        set[w] = 1;
      }
    }
  });
  const now = weekStartOf(isoOf(new Date()));
  if (now) {
    set[now] = 1;
  }
  return Object.keys(set).sort();
}
function earnedFraction(line, state) {
  const tasks = state.tasks || [];
  const linkId = line.linkedTaskId || line.taskId || null;
  if (linkId) {
    const t = tasks.find(x => String(x.id) === String(linkId));
    if (t) {
      return t.status === 'completed' ? 1 : 0;
    }
  }
  return tasks.length ? tasks.filter(t => t.status === 'completed').length / tasks.length : 0;
}
function curveFraction(t, shape) {
  t = Math.max(0, Math.min(1, t));
  const s =
    shape === 'bell'
      ? 'scurve'
      : shape === 'front-loaded'
        ? 'front'
        : shape === 'back-loaded'
          ? 'back'
          : shape;
  switch (s) {
    case 'scurve':
      return t * t * (3 - 2 * t);
    case 'front':
      return 1 - Math.pow(1 - t, 2);
    case 'back':
      return t * t;
    default:
      return t;
  }
}
function lineWindowMs(line, state) {
  const linkId = line.linkedTaskId || line.taskId || null;
  const tasks = (state && state.tasks) || [];
  if (linkId) {
    const t = tasks.find(x => String(x.id) === String(linkId));
    if (t && t.startDate && t.endDate && parseISO(t.startDate) && parseISO(t.endDate)) {
      return { start: parseISO(t.startDate).getTime(), end: parseISO(t.endDate).getTime() };
    }
  }
  const dated = tasks.filter(
    t => t.startDate && t.endDate && parseISO(t.startDate) && parseISO(t.endDate)
  );
  if (!dated.length) {
    return null;
  }
  const starts = dated.map(t => parseISO(t.startDate).getTime());
  const ends = dated.map(t => parseISO(t.endDate).getTime());
  return { start: Math.min.apply(null, starts), end: Math.max.apply(null, ends) };
}
function lineCumulativeAt(line, asOfMs, state) {
  const planned = +line.planned || 0;
  const w = lineWindowMs(line, state);
  if (!w) {
    const tasks = (state && state.tasks) || [];
    const tot = tasks.length;
    const dn = tasks.filter(t => t.status === 'completed').length;
    return planned * (tot ? dn / tot : 0);
  }
  const span = w.end - w.start;
  if (asOfMs <= w.start) {
    return 0;
  }
  if (asOfMs >= w.end || span <= 0) {
    return planned;
  }
  return (
    planned * curveFraction((asOfMs - w.start) / span, line.curveShape || line.curve || 'linear')
  );
}
// Same numbers as the Weekly card (js/mmgr-weekly.js summary), as of the
// selected week's last day. `taskSource` is the UNSCOPED state: the money
// rules need task dates and completion, but only aggregate figures (a
// percentage, a plan-to-date total) ever leave this function - no task names,
// no task rows.
function weeklySummary(state, weekISO, taskSource) {
  const sched = taskSource || state;
  const all = weeksOf(state);
  // P2 (MCP-DIRECTIVE 2026-11-11): the default week must be the latest week
  // that actually has money AND is not in the future. A stray 2027 spend
  // entry used to push the default to a future week, so an owner asking
  // "how did last week go?" got January 2027.
  const nowWeek = weekStartOf(isoOf(new Date()));
  const pastWeeks = all.filter(function (x) {
    return x <= nowWeek;
  });
  const w =
    weekISO && all.indexOf(weekISO) > -1
      ? weekISO
      : pastWeeks.length
        ? pastWeeks[pastWeeks.length - 1]
        : all.length
          ? all[0]
          : nowWeek;
  const from = w;
  const to = addDaysIso(w, 6);
  const toMs = parseISO(to).getTime();
  const log = (state.spendLog || []).filter(e => e && spendIsSpent(e));
  const lines = state.budgetLines || [];
  const rows = lines.map(l => {
    const own = log.filter(e => e.budgetLineId === l.id);
    const asOf = own.filter(e => !e.date || e.date <= to);
    const planned = +l.planned || 0;
    const spent = own.length ? asOf.reduce((n, e) => n + (+e.amount || 0), 0) : +l.actual || 0;
    const spentWeek = own
      .filter(e => e.date && e.date >= from && e.date <= to)
      .reduce((n, e) => n + (+e.amount || 0), 0);
    const frac = earnedFraction(l, sched);
    const baseQty = l.qty == null ? null : +l.qty || 0;
    const baseRate = l.rate == null ? null : +l.rate || 0;
    let qty = 0;
    let priceVar = 0;
    let latest = null;
    let anyQty = false;
    asOf.forEach(e => {
      if (e.qty != null && e.unitPrice != null) {
        anyQty = true;
        const q = +e.qty || 0;
        qty += q;
        priceVar += (Math.round((+e.unitPrice || 0) * 1e6) / 1e6 - (baseRate || 0)) * q;
        if (!latest || (e.date || '') >= (latest.date || '')) {
          latest = { date: e.date || '', price: +e.unitPrice || 0 };
        }
      }
    });
    const qtyLeft = baseQty == null ? null : Math.max(0, baseQty - qty);
    let fcac = null;
    if (anyQty && baseQty != null && latest) {
      fcac = spent + qtyLeft * latest.price;
    } else if (frac > 0) {
      fcac = spent / frac;
    } else {
      fcac = planned;
    }
    const chipInfo = chipFor(planned, spent, priceVar);
    return {
      id: l.id,
      name: l.category || l.id,
      planned: planned,
      spent: spent,
      spentWeek: spentWeek,
      usedPct: chipInfo.usedPct,
      chip: chipInfo.chip,
      priceVar: priceVar,
      qtyVar: baseQty == null || baseRate == null ? null : planned - baseRate * qty,
      fcac: fcac,
      qty: baseQty,
      unit: l.unit || null,
      qtyReceived: qty,
      hasQty: anyQty && baseQty != null
    };
  });
  const spentToDate = rows.reduce((n, r) => n + r.spent, 0);
  const spentWeek = rows.reduce((n, r) => n + r.spentWeek, 0);
  const planned = rows.reduce((n, r) => n + r.planned, 0);
  const fcac = rows.reduce((n, r) => n + (r.fcac || 0), 0);
  const priceVar = rows.reduce((n, r) => n + (r.priceVar || 0), 0);
  const qtyVar = rows.reduce((n, r) => n + (r.qtyVar || 0), 0);
  const planToDate = (state.budgetLines || []).reduce(
    (n, l) => n + lineCumulativeAt(l, toMs, sched),
    0
  );
  const tasks = sched.tasks || [];
  const workPct = tasks.length
    ? (tasks.filter(t => t.status === 'completed').length / tasks.length) * 100
    : 0;
  return {
    week: w,
    from: from,
    to: to,
    weeks: all,
    currency: state.currency || 'USD',
    spentWeek: spentWeek,
    spentToDate: spentToDate,
    planToDate: planToDate,
    planned: planned,
    moneyPct: planned ? (spentToDate / planned) * 100 : 0,
    workPct: workPct,
    forecast: fcac,
    priceVar: priceVar,
    qtyVar: qtyVar,
    rows: rows
  };
}

export function executeTool(name, state, projectId, label, scope, args, auth, fullState) {
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
      // P3 (MCP-DIRECTIVE 2026-11-11): count risks whose status is actually
      // open (a promoted risk carries issueId; a mitigated/closed one is not
      // open), instead of counting every risk that simply lacks an issueId -
      // which used to include Mitigated risks.
      const openRisks = risks.filter(function (r) {
        return !r.issueId && (r.status || 'open') === 'open';
      }).length;
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
      if (!budgetReadAllowed(auth)) {
        return { content: [{ type: 'text', text: BUDGET_READ_REFUSAL }], isError: true };
      }
      const lines = Array.isArray(state.budgetLines) ? state.budgetLines : [];
      const spendLog = Array.isArray(state.spendLog) ? state.spendLog : [];
      const enriched = lines.map(line => {
        const roll = deliveryRollup(line, spendLog);
        const actual = lineActual(line, spendLog);
        const chipInfo = chipFor(roll.planned, actual, roll.priceVar);
        const own = spendLog.filter(e => e.budgetLineId === line.id);
        return {
          id: line.id,
          name: line.name || line.id,
          category: line.category || null,
          source: line.source || 'manual',
          boqRef: line.boqRef || null,
          planned: roll.planned,
          actual: actual,
          committed: roll.committed,
          paid: roll.paid,
          owed: roll.owed,
          variance: roll.planned - actual,
          usedPct: Math.round(chipInfo.usedPct),
          status: chipInfo.chip,
          qty: line.qty == null ? null : +line.qty || 0,
          unit: line.unit || null,
          rate: line.rate == null ? null : +line.rate || 0,
          qtyReceived: roll.qtyReceived,
          qtyLeft: roll.qtyLeft,
          qtyPct: roll.qtyPct,
          moneyLeft: roll.moneyLeft,
          priceVar: roll.priceVar,
          qtyVar: roll.qtyVar,
          deliveryCount: own.length,
          lastDelivery: own.length
            ? own
                .map(e => e.date || '')
                .filter(Boolean)
                .sort()
                .slice(-1)[0] || null
            : null,
          linkedTaskId: line.linkedTaskId || line.taskId || null
        };
      });
      const totalPlanned = enriched.reduce((s, l) => s + l.planned, 0);
      const totalActual = enriched.reduce((s, l) => s + l.actual, 0);
      const base = baselineOf(fullState || state);
      const variations = Array.isArray((fullState || state).budgetVariations)
        ? (fullState || state).budgetVariations
        : [];
      // P2 (MCP-DIRECTIVE 2026-11-11): a stored 0 is "no envelope set", not a
      // funded-but-empty plan. Reporting envelopeRemaining as the negative of
      // the whole plan reads as "$1.75M over budget" on a project that never
      // set an envelope, so 0/null are treated as unset.
      const rawEnv = state.budgetEnvelope == null ? null : Number(state.budgetEnvelope);
      const envelope = rawEnv != null && rawEnv > 0 ? rawEnv : null;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                currency: (fullState || state).currency || 'USD',
                totalPlanned,
                totalActual,
                variance: totalPlanned - totalActual,
                lineCount: enriched.length,
                envelope: envelope,
                envelopeRemaining: envelope == null ? null : envelope - totalPlanned,
                baseline: base
                  ? {
                      id: base.id,
                      name: base.name || null,
                      total: +base.total || 0,
                      frozenAt: base.at || null,
                      frozenBy: base.by || null
                    }
                  : null,
                variationCount: variations.length,
                lines: enriched
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'get_deliveries': {
      if (!sectionAllowed(scope, 'bud')) {
        return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      }
      if (!budgetReadAllowed(auth)) {
        return { content: [{ type: 'text', text: BUDGET_READ_REFUSAL }], isError: true };
      }
      const onlyLine = args && args.lineId ? String(args.lineId) : '';
      const lines = (Array.isArray(state.budgetLines) ? state.budgetLines : []).filter(
        l => !onlyLine || String(l.id) === onlyLine
      );
      if (onlyLine && !lines.length) {
        return {
          content: [{ type: 'text', text: 'No budget line with id ' + onlyLine + '.' }],
          isError: true
        };
      }
      const spendLog = Array.isArray(state.spendLog) ? state.spendLog : [];
      const byId = {};
      lines.forEach(l => {
        byId[String(l.id)] = l;
      });
      const rows = lines.map(l => {
        const roll = deliveryRollup(l, spendLog);
        return {
          lineId: l.id,
          name: l.name || l.id,
          category: l.category || null,
          planned: roll.planned,
          qty: l.qty == null ? null : +l.qty || 0,
          unit: l.unit || null,
          rate: l.rate == null ? null : +l.rate || 0,
          qtyReceived: roll.qtyReceived,
          qtyLeft: roll.qtyLeft,
          qtyPct: roll.qtyPct,
          spent: roll.spent,
          committed: roll.committed,
          paid: roll.paid,
          owed: roll.owed,
          moneyLeft: roll.moneyLeft,
          priceVar: roll.priceVar,
          qtyVar: roll.qtyVar
        };
      });
      const deliveries = spendLog
        .filter(e => e && byId[String(e.budgetLineId)])
        .map(e => ({
          id: e.id || null,
          date: e.date || null,
          lineId: e.budgetLineId,
          lineName: byId[String(e.budgetLineId)].name || byId[String(e.budgetLineId)].id,
          qty: e.qty == null ? null : +e.qty || 0,
          unit: e.unit || byId[String(e.budgetLineId)].unit || null,
          unitPrice: e.unitPrice == null ? null : +e.unitPrice || 0,
          amount: +e.amount || 0,
          supplierRef: e.supplierRef || null,
          status: e.status || 'received',
          note: e.note || null
        }))
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                currency: (fullState || state).currency || 'USD',
                lineCount: rows.length,
                deliveryCount: deliveries.length,
                lines: rows,
                deliveries: deliveries
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'get_weekly_summary': {
      if (!sectionAllowed(scope, 'bud')) {
        return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      }
      if (!budgetReadAllowed(auth)) {
        return { content: [{ type: 'text', text: BUDGET_READ_REFUSAL }], isError: true };
      }
      // P1 (MCP-DIRECTIVE 2026-11-11): parseISO is lenient - "2026-13-45"
      // rolls month 13 into a valid 2027 date, so a nonsense week was
      // silently answered as a different (real) week. Reject anything that
      // does not round-trip to the exact input.
      const asked = args && args.week ? String(args.week).slice(0, 10) : '';
      const askedDate = asked ? parseISO(asked) : null;
      if (asked && (!askedDate || isoOf(askedDate) !== asked)) {
        return {
          content: [{ type: 'text', text: 'The week must be a real date in the form YYYY-MM-DD.' }],
          isError: true
        };
      }
      const weekISO = askedDate ? weekStartOf(asked) : '';
      const out = weeklySummary(state, weekISO, fullState || state);
      out.currency = (fullState || state).currency || 'USD';
      const base = baselineOf(fullState || state);
      out.baseline = base
        ? {
            id: base.id,
            name: base.name || null,
            total: +base.total || 0,
            frozenAt: base.at || null
          }
        : null;
      out.weekStartsOn = 'Monday';
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
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
      return executeGetTable(state, scope, args, auth);
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

// ---- H-5 budget proposals -------------------------------------------------
//
// The only write path a key with the "Propose budget changes" switch gets.
// Everything here is validated on the SERVER before the proposal is queued:
// a text amount, a negative amount, a missing price or a unit outside the
// line's family is refused, and the delivery amount is computed here rather
// than trusted from the caller. Nothing touches live project state - the
// proposal becomes a cloud_reviews row the owner accepts or rejects.
//
// Kinds: addLine, changeLine, addDelivery. There is deliberately NO delete:
// v1 cannot remove a budget line through MCP at all, so the option to enable
// it per key can be added later without a migration.
// H-5: what happened to a proposal. An API key only ever sees proposals that
// carry its own label (source_type 'api'), so one agent cannot read another
// agent's queue. The owner's reason comes back verbatim - that is the whole
// point of the tool: a refused proposal must be able to explain itself.
async function proposalStatusResult(env, projectId, auth, args, rpcId) {
  // MCP-AGENT-FIRST 2026-11-12 1.6(a): an abandoned claim reads as pending.
  await cloudHealStaleClaims(env, projectId);
  const isApi = auth.role === 'api';
  const one = args && args.proposalId != null ? parseInt(args.proposalId, 10) : 0;
  let limit = args && args.limit != null ? parseInt(args.limit, 10) : 10;
  if (!isFinite(limit) || limit < 1) {
    limit = 10;
  }
  if (limit > 50) {
    limit = 50;
  }
  let sql =
    'SELECT id, proposal_type, source_type, source_label, status, diffs_json, ops_count, proposal_json, proposed_at, decided_at, decided_by, decision_note, decision_edited, accepted_entry_id FROM cloud_reviews WHERE project_id = ?';
  const binds = [projectId];
  if (isApi) {
    sql += ' AND source_type = ? AND source_label = ?';
    binds.push('api', auth.label || 'MCP AI');
  }
  if (one) {
    sql += ' AND id = ?';
    binds.push(one);
  }
  sql += ' ORDER BY id DESC LIMIT ' + (one ? 1 : limit);
  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  const list = (rows.results || []).map(function (r) {
    let proposal = null;
    try {
      proposal = r.proposal_json ? JSON.parse(r.proposal_json) : null;
    } catch (e) {
      proposal = null;
    }
    let diffCount = r.ops_count == null ? 0 : Number(r.ops_count) || 0;
    if (!diffCount) {
      try {
        const d = r.diffs_json ? JSON.parse(r.diffs_json) : [];
        diffCount = Array.isArray(d) ? d.length : 0;
      } catch (e) {
        diffCount = 0;
      }
    }
    const edited = r.decision_edited === 1;
    return {
      proposalId: r.id,
      status: r.status === 'accepting' ? 'pending' : r.status,
      outcome:
        r.status === 'pending' || r.status === 'accepting'
          ? 'pending'
          : r.status === 'rejected'
            ? 'rejected'
            : edited
              ? 'edited-and-accepted'
              : 'accepted',
      summary: proposal && proposal.summary ? proposal.summary : diffCount + ' field change(s)',
      changeCount:
        proposal && Array.isArray(proposal.changes) ? proposal.changes.length : diffCount,
      changes: proposal && Array.isArray(proposal.changes) ? proposal.changes : null,
      proposedAt: r.proposed_at || null,
      decidedAt: r.decided_at || null,
      decidedBy: r.decided_by || null,
      decisionNote: r.decision_note || '',
      edited: edited,
      acceptedEntryId: r.accepted_entry_id == null ? null : r.accepted_entry_id
    };
  });
  if (one && !list.length) {
    return {
      jsonrpc: '2.0',
      id: rpcId,
      result: {
        content: [
          {
            type: 'text',
            text:
              'No proposal #' +
              one +
              ' belongs to this key on this project. Use get_proposal_status without an id to list the recent ones.'
          }
        ],
        isError: true
      }
    };
  }
  return {
    jsonrpc: '2.0',
    id: rpcId,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { projectId: projectId, count: list.length, proposals: list },
            null,
            2
          )
        }
      ]
    }
  };
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
    // P2 (MCP-DIRECTIVE 2026-11-11): weather is not a grantable section, so
    // API keys can never call get_weather - yet it was advertised to every
    // key, and AI clients kept trying a tool that always refused. Hide it from
    // scoped-key callers; owner-code callers (full access) still see it.
    let tools = TOOLS;
    if (auth && auth.role === 'api') {
      tools = TOOLS.filter(function (t) {
        return t.name !== 'get_weather';
      });
    }
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: tools }
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
    // H-5: the decision feed needs the database, not the project snapshot, so
    // it answers before the state read. An AI client can see what the owner
    // decided but can never decide anything itself - there is no approve tool
    // and the review endpoints are owner-auth only.
    if (toolName === 'get_proposal_status') {
      return await proposalStatusResult(env, projectId, auth, toolArgs, id);
    }
    // P0 (MCP-DIRECTIVE 2026-11-11): reject an empty/oversized/invalid
    // apply_changes envelope BEFORE loading (and decrypting) the snapshot.
    // This is what makes apply_changes {} a fast structured error instead of
    // a 1102.
    if (toolName === 'apply_changes') {
      const precheck = validateProposalEnvelope(toolArgs, auth);
      if (precheck) {
        return { jsonrpc: '2.0', id, result: precheck };
      }
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
      toolArgs,
      auth,
      state
    );

    // Handle apply_changes - queue a pending review proposal (API-KEY-AUDIT
    // F3, 2026-09-16). Field-level diffs are materialized onto a copy of the
    // stored state, merged under the caller's section scope exactly like the
    // REST save path, and inserted as a pending cloud_reviews row. NOTHING
    // is written to live project state here - the owner accepts or rejects
    // inside the project, and only the accept applies the change.
    if (result.pendingApply) {
      // APP-WIDE MCP (Wave 1): the proposal-queue engine is now a shared,
      // exported function so the per-project and app-wide servers cannot drift.
      return await queueMcpProposal(env, projectId, auth, toolArgs, id, state);
    }

    return { jsonrpc: '2.0', id, result };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found: ' + method }
  };
}

// ---- Shared proposal queue (per-project + app-wide MCP) ------------------
// APP-WIDE MCP (Wave 1): extracted from handleMcpRequest so the per-project
// and app-wide servers build identical review-queue proposals. It materialises
// diffs/creates/budget changes onto a copy of the stored state, merges them
// under the caller's section scope, and inserts a single PENDING cloud_reviews
// row (proposal_type 'mcp'). Nothing reaches live project state until the
// owner accepts it inside the project.

// MCP-DIRECTIVE 2026-11-11 P0: validate the apply_changes envelope BEFORE
// loading project state. An empty or malformed envelope must return a tool
// error in microseconds - never load and decrypt a multi-megabyte snapshot
// (and never reach the platform CPU limit) just to reject it. Both servers
// call this same function, so the refusal text cannot drift.
export const MCP_MAX_DIFFS = 500;
export const MCP_MAX_CREATES = 500;
export const MCP_MAX_SETS = 100;
// Wall-clock ceiling for the write pipeline. Cloudflare's 1102 must never be
// the first signal: abort with a plain, structured message before the
// platform limit. The state read is cached (r2DeriveKey), so a normal
// 1/30/200-diff proposal finishes far inside this budget.
export const MCP_WRITE_BUDGET_MS = 4000;

export function validateProposalEnvelope(toolArgs, auth) {
  const a = toolArgs || {};
  const diffs = Array.isArray(a.diffs) ? a.diffs : [];
  const creates = Array.isArray(a.creates) ? a.creates : [];
  const budgetRaw = Array.isArray(a.budget) ? a.budget : [];
  const setsRaw = Array.isArray(a.sets) ? a.sets : [];
  if (
    diffs.length === 0 &&
    creates.length === 0 &&
    budgetRaw.length === 0 &&
    setsRaw.length === 0
  ) {
    return {
      content: [
        {
          type: 'text',
          text: 'Nothing provided. Supply diffs as {path, recordId, field, after}, creates as {path, record} objects, sets as {path, field, value} objects, or budget changes as {kind, ...} objects.'
        }
      ],
      isError: true
    };
  }
  if (diffs.length > MCP_MAX_DIFFS) {
    return {
      content: [
        {
          type: 'text',
          text:
            'A proposal can carry at most ' +
            MCP_MAX_DIFFS +
            ' diffs. Split this into smaller proposals.'
        }
      ],
      isError: true
    };
  }
  if (creates.length > MCP_MAX_CREATES) {
    return {
      content: [
        {
          type: 'text',
          text:
            'A proposal can carry at most ' +
            MCP_MAX_CREATES +
            ' creates. Split this into smaller proposals.'
        }
      ],
      isError: true
    };
  }
  if (setsRaw.length > MCP_MAX_SETS) {
    return {
      content: [
        {
          type: 'text',
          text:
            'A proposal can carry at most ' +
            MCP_MAX_SETS +
            ' sets. Split this into smaller proposals.'
        }
      ],
      isError: true
    };
  }
  // H-5: the write switch. A key without it cannot queue a budget proposal
  // AT ALL - the whole call is refused rather than silently dropping the
  // budget part and queuing the rest.
  if (budgetRaw.length && !budgetWriteAllowed(auth)) {
    return { content: [{ type: 'text', text: BUDGET_WRITE_REFUSAL }], isError: true };
  }
  if (budgetRaw.length > BUDGET_PROPOSAL_LIMIT) {
    return {
      content: [
        {
          type: 'text',
          text:
            'A proposal can carry at most ' +
            BUDGET_PROPOSAL_LIMIT +
            ' budget changes. Split this into smaller proposals.'
        }
      ],
      isError: true
    };
  }
  return null;
}

function writeBudgetExceeded(id) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        {
          type: 'text',
          text: 'MCP_WRITE_BUDGET_EXCEEDED - this proposal is too large to process safely. Split it into smaller proposals.'
        }
      ],
      isError: true
    }
  };
}

function mcpShortValue(v) {
  if (v === undefined) {
    return '(absent)';
  }
  if (v === null) {
    return 'null';
  }
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }
  return String(v);
}

// MCP-AGENT-FIRST 2026-11-12 1.7: canonical JSON (sorted keys) so the same
// arguments always hash the same, whatever order the client serialised them.
function mcpCanonicalJson(v) {
  if (v === null || typeof v !== 'object') {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    return '[' + v.map(mcpCanonicalJson).join(',') + ']';
  }
  const keys = Object.keys(v).sort();
  return (
    '{' +
    keys
      .map(function (k) {
        return JSON.stringify(k) + ':' + mcpCanonicalJson(v[k]);
      })
      .join(',') +
    '}'
  );
}

async function mcpSha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(function (b) {
      return b.toString(16).padStart(2, '0');
    })
    .join('');
}

async function findDuplicateProposal(env, keys) {
  for (let i = 0; i < keys.length; i++) {
    if (!keys[i]) {
      continue;
    }
    try {
      const row = await env.DB.prepare(
        'SELECT id, ops_count, diffs_json FROM cloud_reviews WHERE import_key = ?'
      )
        .bind(keys[i])
        .first();
      // A harness (or an older mock) that ignores the WHERE clause can return
      // a shapeless object; only a real row with an id is a duplicate.
      if (row && row.id != null) {
        return row;
      }
    } catch (e) {
      /* a lookup failure must never block a fresh proposal */
    }
  }
  return null;
}

export async function queueMcpProposal(env, projectId, auth, toolArgs, id, state) {
  const precheck = validateProposalEnvelope(toolArgs, auth);
  if (precheck) {
    return { jsonrpc: '2.0', id, result: precheck };
  }
  const diffs = Array.isArray(toolArgs.diffs) ? toolArgs.diffs : [];
  const creates = Array.isArray(toolArgs.creates) ? toolArgs.creates : [];
  const setsRaw = Array.isArray(toolArgs.sets) ? toolArgs.sets : [];
  const budgetRaw = Array.isArray(toolArgs.budget) ? toolArgs.budget : [];
  const writeStartedAt = Date.now();
  // MCP-AGENT-FIRST 2026-11-12 1.2: the generic paths (diffs, creates, sets)
  // can name the money tables too. Before this, a key with "Propose budget
  // changes" OFF could queue a budget-line diff, a spendLog create or an
  // envelope set and bypass the switch the budget array has always honoured.
  // The whole call is refused, exactly like the budget array.
  const BUDGET_WRITE_PATHS = ['budgetLines', 'spendLog', 'budgetEnvelope', 'nspid'];
  const touchesBudget =
    diffs.some(function (d) {
      return d && BUDGET_WRITE_PATHS.indexOf(String(d.path || '')) !== -1;
    }) ||
    creates.some(function (c) {
      return c && BUDGET_WRITE_PATHS.indexOf(String(c.path || '')) !== -1;
    }) ||
    setsRaw.some(function (s) {
      return s && BUDGET_WRITE_PATHS.indexOf(String(s.path || '')) !== -1;
    });
  if (touchesBudget && !budgetWriteAllowed(auth)) {
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: BUDGET_WRITE_REFUSAL }], isError: true }
    };
  }
  // Budget-line diffs and envelope sets are re-expressed as budget-array ops so
  // ONE validator (buildBudgetProposal) owns every money check.
  const budgetFromDiffs = [];
  const budgetFromSets = [];

  const granted = Array.isArray(auth.scope) ? auth.scope : Object.keys(CLOUD_SECTIONS);
  let prev = state; // the full stored state fetched above (pre-scope)
  // CREATE into an empty project (owner 2026-09-17): a brand-new cloud
  // project has no snapshot yet - the owner's lazy-PM scenario starts
  // exactly there. With creates only, seed a minimal prev instead of
  // refusing; the review-accept path writes the merged state either way.
  if (!prev && diffs.length === 0 && (creates.length > 0 || setsRaw.length > 0)) {
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
  const warnings = [];
  for (let i = 0; i < diffs.length; i++) {
    if (Date.now() - writeStartedAt > MCP_WRITE_BUDGET_MS) {
      return writeBudgetExceeded(id);
    }
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
    // MCP-AGENT-FIRST 2026-11-12 1.2: money tables do not take generic diffs.
    // A budget-line diff on a writable field becomes a changeLine op so the
    // money validation and the large-change flag still run; everything else
    // is refused with the path the agent should use instead.
    if (path === 'budgetLines') {
      if (BUDGET_LINE_FIELDS.indexOf(field) === -1) {
        refused.push(
          path +
            '.' +
            (field || '(no field)') +
            ': not writable through MCP. Allowed: ' +
            BUDGET_LINE_FIELDS.join(', ') +
            '.'
        );
        continue;
      }
      budgetFromDiffs.push({
        kind: 'changeLine',
        lineId: rec,
        field: field,
        value: d.after,
        before: d.before
      });
      continue;
    }
    if (path === 'spendLog') {
      refused.push(path + ': use the budget array (addDelivery)');
      continue;
    }
    if (path === 'budgetEnvelope') {
      refused.push(
        path + ': use a set ({"path":"budgetEnvelope","value":<number>}) rather than a diff'
      );
      continue;
    }
    if (path === 'nspid') {
      refused.push(path + ': server-managed and cannot be written');
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
    // MCP-AGENT-FIRST 2026-11-12 1.4: a supplied `before` is a promise about
    // the live value. When it does not match, the op is refused with both
    // values instead of being silently rewritten to the live one. An omitted
    // `before` is allowed, but the owner is told it was not checked.
    if (d.before !== undefined) {
      if (!valuesEqual(d.before, item[field])) {
        refused.push(
          path +
            '[' +
            rec +
            '].' +
            field +
            ': stale before: expected ' +
            mcpShortValue(d.before) +
            ', live ' +
            mcpShortValue(item[field])
        );
        continue;
      }
    } else {
      warnings.push(path + '[' + rec + '].' + field + ': before not checked');
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
    if (Date.now() - writeStartedAt > MCP_WRITE_BUDGET_MS) {
      return writeBudgetExceeded(id);
    }
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
    // MCP-AGENT-FIRST 2026-11-12 1.2: a budget line is created through
    // addLine (money validation, server-assigned id) and a delivery through
    // addDelivery (the server computes the amount). The generic create path
    // must not bypass either.
    if (cpath === 'budgetLines' || cpath === 'spendLog') {
      refusedCreates.push(
        cpath +
          ': use the budget array (' +
          (cpath === 'budgetLines' ? 'addLine' : 'addDelivery') +
          ')'
      );
      continue;
    }
    if (cpath === 'nspid') {
      refusedCreates.push(cpath + ': server-managed and cannot be written');
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
      recInput.title !== undefined && recInput.title !== null ? String(recInput.title).trim() : '';
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
    if (!createDefaults(cpath)) {
      refusedCreates.push(cpath + ': not a list that accepts new records');
      continue;
    }
    const arr2 = Array.isArray(base[cpath]) ? base[cpath] : (base[cpath] = []);
    arr2.push(buildCreatedRecord(cpath, recInput, nowMs, counterRef, arr2));
    submitted[cpath] = arr2;
  }
  // SETS (owner 2026-11-12): object sections and scalar keys are not record
  // lists, so diffs/creates cannot reach them. A set writes one nested field
  // ("dmaic.define.problem") or a whole scalar ("projectDeadline"), then the
  // same review queue decides it. Lists are refused here on purpose - a
  // wholesale array replacement is what the tasks-array guard exists to stop.
  const refusedSets = [];
  const SET_FIELD_RE = /^[A-Za-z0-9_]+(\[\d+\])?(\.[A-Za-z0-9_]+(\[\d+\])?)*$/;
  for (let i = 0; i < setsRaw.length; i++) {
    if (Date.now() - writeStartedAt > MCP_WRITE_BUDGET_MS) {
      return writeBudgetExceeded(id);
    }
    const s = setsRaw[i];
    if (!s || typeof s !== 'object') {
      refusedSets.push('set ' + i + ': invalid');
      continue;
    }
    const spath = String(s.path || '');
    const sec = CLOUD_KEY_TO_SECTION[spath];
    if (!sec) {
      refusedSets.push((spath || '(empty)') + ': not a project section');
      continue;
    }
    if (granted.indexOf(sec) === -1) {
      refusedSets.push(spath + ': outside the granted sections');
      continue;
    }
    // MCP-AGENT-FIRST 2026-11-12 1.2: the envelope is money, so it goes
    // through buildBudgetProposal (finite, non-negative, large-change flag)
    // instead of the generic scalar set.
    if (spath === 'budgetEnvelope') {
      const envField = s.field === undefined || s.field === null ? '' : String(s.field);
      if (envField) {
        refusedSets.push(spath + '.' + envField + ': the envelope is a single number - omit field');
        continue;
      }
      if (
        s.before !== undefined &&
        !valuesEqual(s.before, base.budgetEnvelope == null ? null : +base.budgetEnvelope)
      ) {
        refusedSets.push(
          spath +
            ': stale before: expected ' +
            mcpShortValue(s.before) +
            ', live ' +
            mcpShortValue(base.budgetEnvelope)
        );
        continue;
      }
      budgetFromSets.push({ kind: 'changeEnvelope', value: s.value, before: s.before });
      continue;
    }
    if (spath === 'nspid') {
      refusedSets.push(spath + ': server-managed and cannot be written');
      continue;
    }
    if (Array.isArray(base[spath])) {
      refusedSets.push(spath + ': is a record list - use diffs or creates');
      continue;
    }
    if (s.value === undefined) {
      refusedSets.push(spath + ': missing value');
      continue;
    }
    const field = s.field === undefined || s.field === null ? '' : String(s.field);
    if (field) {
      if (!SET_FIELD_RE.test(field)) {
        refusedSets.push(spath + '.' + field + ': not a valid field path');
        continue;
      }
      // MCP-AGENT-FIRST 2026-11-12 1.4: same `before` promise as a diff.
      if (s.before !== undefined) {
        const cur = getPathValue(base, spath + '.' + field);
        if (!valuesEqual(s.before, cur)) {
          refusedSets.push(
            spath +
              '.' +
              field +
              ': stale before: expected ' +
              mcpShortValue(s.before) +
              ', live ' +
              mcpShortValue(cur)
          );
          continue;
        }
      } else {
        warnings.push(spath + '.' + field + ': before not checked');
      }
      if (!setPathValue(base, spath + '.' + field, s.value)) {
        refusedSets.push(spath + '.' + field + ': could not be set');
        continue;
      }
    } else if (s.value && typeof s.value === 'object') {
      base[spath] = JSON.parse(JSON.stringify(s.value));
    } else {
      base[spath] = s.value;
    }
    submitted[spath] = base[spath];
  }

  // H-5: budget proposals. Built and validated on the server, then folded
  // into the same review row as any other change set.
  let budgetBuilt = { submitted: {}, changes: [], refused: [], summary: '' };
  const budgetAll = budgetRaw.concat(budgetFromDiffs, budgetFromSets);
  if (budgetAll.length) {
    if (granted.indexOf('bud') === -1) {
      refusedCreates.push('budget: outside the granted sections');
    } else if (budgetAll.length > BUDGET_PROPOSAL_LIMIT) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text:
                'A proposal can carry at most ' +
                BUDGET_PROPOSAL_LIMIT +
                ' budget changes. Split this into smaller proposals.'
            }
          ],
          isError: true
        }
      };
    } else {
      budgetBuilt = buildBudgetProposal(base, budgetAll, base.currency);
      Object.keys(budgetBuilt.submitted).forEach(function (k) {
        submitted[k] = budgetBuilt.submitted[k];
      });
      if (budgetBuilt.refused.length) {
        refusedCreates.push.apply(refusedCreates, budgetBuilt.refused);
      }
      // Q5 + the per-key daily cap: a large change is 10 percent of the
      // line or 50,000 in project currency, whichever is smaller. Count
      // what this key already queued today before accepting more.
      const newLarge = budgetBuilt.changes.filter(function (c) {
        return c.large;
      }).length;
      if (newLarge) {
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        let usedLarge = 0;
        try {
          // MCP-AGENT-FIRST 2026-11-12 1.5: only undecided or accepted rows
          // count. A rejected row frees its quota, and `accepting` is a
          // pending decision (1.6).
          const todayRows = await env.DB.prepare(
            "SELECT proposal_json FROM cloud_reviews WHERE project_id = ? AND source_type = 'api' AND source_label = ? AND proposed_at >= ? AND status IN ('pending','accepting','accepted')"
          )
            .bind(projectId, auth.label || 'MCP AI', dayStart.toISOString())
            .all();
          (todayRows.results || []).forEach(function (r) {
            try {
              const p = r.proposal_json ? JSON.parse(r.proposal_json) : null;
              if (p && Array.isArray(p.changes)) {
                usedLarge += p.changes.filter(function (c) {
                  return c.large;
                }).length;
              }
            } catch (e) {
              /* a malformed old row must not block a new proposal */
            }
          });
        } catch (e) {
          usedLarge = 0;
        }
        if (usedLarge + newLarge > BUDGET_LARGE_PER_DAY) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text:
                    'This call has ' +
                    newLarge +
                    ' large budget change(s). This key has ' +
                    usedLarge +
                    ' large change(s) pending or accepted today (UTC). The limit is ' +
                    BUDGET_LARGE_PER_DAY +
                    ' per day and ' +
                    BUDGET_LARGE_PER_DAY +
                    ' per call. Split into calls of at most ' +
                    BUDGET_LARGE_PER_DAY +
                    ' large changes, or ask the owner to decide pending ones.'
                }
              ],
              isError: true
            }
          };
        }
      }
    }
  }
  const allRefused = refused.concat(refusedCreates, refusedSets);
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
  // Guard rail (MCP-DIRECTIVE 2026-11-11 P0): a tasks proposal replaces the
  // WHOLE tasks array on accept, so warn when this key already has a pending
  // tasks proposal for the same project - the owner should fold them into one.
  let tasksWarning = '';
  if (submitted.tasks) {
    try {
      const prior = await env.DB.prepare(
        "SELECT submitted_json FROM cloud_reviews WHERE project_id = ? AND proposal_type = 'mcp' AND source_label = ? AND status = 'pending' LIMIT 20"
      )
        .bind(projectId, auth.label || 'MCP AI')
        .all();
      const priorHasTasks = ((prior && prior.results) || []).some(function (r) {
        try {
          const s = r.submitted_json ? JSON.parse(r.submitted_json) : null;
          return !!(s && s.tasks);
        } catch (e) {
          return false;
        }
      });
      if (priorHasTasks) {
        tasksWarning =
          ' Warning: a pending tasks proposal already exists for this key; accepting this one will replace the whole tasks array - fold the changes into one proposal.';
      }
    } catch (e) {
      /* the warning is best-effort and must never block the proposal */
    }
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
              (allRefused.length ? ' Refused: ' + allRefused.join('; ') + '.' : '')
          }
        ],
        isError: true
      }
    };
  }
  const now = new Date().toISOString();
  const rawLeaves = cloudDiffState(prev, merged.next) || [];
  const diffsJson = enrichDiffs(rawLeaves, prev, merged.next).diffs;
  // MCP-AGENT-FIRST 2026-11-12 1.3: diffs_json stays capped at 500 for the
  // review UI, but the full enriched list is stored uncapped in ops_json and
  // its true total in ops_count. Accept reads ops_json, so nothing an agent
  // proposed is ever silently dropped.
  const fullOps = enrichDiffs(rawLeaves, prev, merged.next, 1000000000).diffs;
  // MCP-AGENT-FIRST 2026-11-12 1.7: one idempotency key per call. An explicit
  // idempotencyKey is stable forever; otherwise the whole argument object is
  // hashed into a 10-minute bucket, and the previous bucket is checked too so
  // a retry that straddles the boundary still hits.
  const idemKeyId = auth.apiKeyId != null ? String(auth.apiKeyId) : 'owner';
  const explicitIdem =
    typeof toolArgs.idempotencyKey === 'string' ? toolArgs.idempotencyKey.trim().slice(0, 80) : '';
  const BUCKET_MS = 600000;
  let importKey = null;
  let prevImportKey = null;
  if (explicitIdem) {
    importKey = 'mcp:' + projectId + ':' + idemKeyId + ':' + explicitIdem;
  } else {
    const hashArgs = Object.assign({}, toolArgs);
    delete hashArgs.idempotencyKey;
    const argHash = await mcpSha256Hex(mcpCanonicalJson(hashArgs));
    const bucket = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
    importKey =
      'mcp:' + projectId + ':' + idemKeyId + ':' + argHash + ':' + new Date(bucket).toISOString();
    prevImportKey =
      'mcp:' +
      projectId +
      ':' +
      idemKeyId +
      ':' +
      argHash +
      ':' +
      new Date(bucket - BUCKET_MS).toISOString();
  }
  const duplicate = await findDuplicateProposal(env, [importKey, prevImportKey]);
  if (duplicate) {
    const dupCount =
      duplicate.ops_count != null
        ? Number(duplicate.ops_count) || 0
        : (function () {
            try {
              const d = duplicate.diffs_json ? JSON.parse(duplicate.diffs_json) : [];
              return Array.isArray(d) ? d.length : 0;
            } catch (e) {
              return 0;
            }
          })();
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text:
              'Queued ' +
              dupCount +
              ' field change(s) for owner review (proposal #' +
              duplicate.id +
              '). duplicate: true Nothing changes until the owner accepts it inside the project.'
          },
          {
            type: 'text',
            text: JSON.stringify({
              proposalId: duplicate.id,
              changeSetId: null,
              duplicate: true,
              counts: {
                diffs: diffs.length,
                creates: creates.length,
                sets: setsRaw.length,
                deletes: 0,
                budget: budgetAll.length
              },
              opsQueued: dupCount,
              refused: [],
              warnings: warnings,
              truncated: false
            })
          }
        ]
      }
    };
  }
  let res;
  const proposalJson = budgetBuilt.changes.length
    ? JSON.stringify({
        summary: budgetBuilt.summary,
        currency: budgetBuilt.currency,
        changes: budgetBuilt.changes
      })
    : null;
  try {
    res = await env.DB.prepare(
      'INSERT INTO cloud_reviews (project_id, proposal_type, source_type, source_label, editor_code_id, scope, submitted_json, diffs_json, status, proposed_at, proposal_json, ops_json, ops_count, import_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
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
        now,
        proposalJson,
        JSON.stringify(fullOps),
        fullOps.length,
        importKey
      )
      .run();
  } catch (e) {
    // A UNIQUE violation means a concurrent identical call won the insert.
    const raced = await findDuplicateProposal(env, [importKey]);
    if (raced) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text:
                'Queued ' +
                (raced.ops_count != null ? Number(raced.ops_count) || 0 : 0) +
                ' field change(s) for owner review (proposal #' +
                raced.id +
                '). duplicate: true Nothing changes until the owner accepts it inside the project.'
            },
            {
              type: 'text',
              text: JSON.stringify({
                proposalId: raced.id,
                changeSetId: null,
                duplicate: true,
                counts: {
                  diffs: diffs.length,
                  creates: creates.length,
                  sets: setsRaw.length,
                  deletes: 0,
                  budget: budgetAll.length
                },
                opsQueued: raced.ops_count != null ? Number(raced.ops_count) || 0 : 0,
                refused: [],
                warnings: warnings,
                truncated: false
              })
            }
          ]
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
            text: 'Could not queue the proposal: ' + (e.message || 'database error')
          }
        ],
        isError: true
      }
    };
  }
  // MCP-AGENT-FIRST 2026-11-12 1.8: the first block stays byte-compatible with
  // every existing assertion; the second block is machine-readable so an agent
  // can see exactly what was refused and why without parsing prose.
  const refusedStructured = allRefused.map(function (s) {
    const text = String(s);
    const m = /^([A-Za-z0-9_]+)(?:\[([^\]]+)\])?(?:\.([A-Za-z0-9_.\[\]]+))?:\s*(.*)$/.exec(text);
    const path = m ? m[1] : null;
    return {
      section: path && CLOUD_KEY_TO_SECTION[path] ? CLOUD_KEY_TO_SECTION[path] : null,
      index: null,
      path: path,
      recordId: m && m[2] ? m[2] : null,
      field: m && m[3] ? m[3] : null,
      reason: m ? m[4] : text
    };
  });
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        {
          type: 'text',
          text:
            'Queued ' +
            fullOps.length +
            ' field change(s) for owner review (proposal #' +
            res.meta.last_row_id +
            ').' +
            (budgetBuilt.summary ? ' ' + budgetBuilt.summary + '.' : '') +
            (allRefused.length ? ' Refused: ' + allRefused.join('; ') + '.' : '') +
            tasksWarning +
            ' Nothing changes until the owner accepts it inside the project.'
        },
        {
          type: 'text',
          text: JSON.stringify({
            proposalId: res.meta.last_row_id,
            changeSetId: null,
            duplicate: false,
            counts: {
              diffs: diffs.length,
              creates: creates.length,
              sets: setsRaw.length,
              deletes: 0,
              budget: budgetAll.length
            },
            opsQueued: fullOps.length,
            refused: refusedStructured,
            warnings: warnings,
            truncated: false
          })
        }
      ]
    }
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
    // SEC-14 (audit 2026-11-01): the full-power owner code as a Bearer is on
    // its way out. Phase 1 (now) COUNTS every use so the cut can be justified
    // by data rather than by hope; phase 2 flips MCP_REQUIRE_API_KEY=1 and
    // refuses, with a message that names the replacement. Nothing is cut
    // silently, and the switch is one environment variable to roll back.
    structuredLog(env, 'warn', 'mcp-owner-code-deprecated', {
      projectId: projectId,
      result: env && env.MCP_REQUIRE_API_KEY === '1' ? 'refused' : 'accepted'
    });
    if (env && env.MCP_REQUIRE_API_KEY === '1') {
      // Answer inside the protocol (200 + JSON-RPC error) rather than with a
      // transport 401: PATH-A exists so an MCP client does not mistake this
      // server for an OAuth resource, and that stays true after the cut.
      return json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32001,
            message:
              'Owner codes are no longer accepted by the MCP server. Create a project API key (scoped to the sections you choose, expiring, revocable) and send it as Authorization: Bearer sk-mmgr-... instead.'
          }
        },
        200
      );
    }
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
