/* ============================================================
   MCP SERVER — per-project Model Context Protocol endpoint
   ============================================================
   Exposes project data as MCP tools for external AI clients
   (Claude Desktop, Cursor, Windsurf, etc.).

   Transport: Streamable HTTP (POST /api/mcp/:projectId)
   Auth: (1) a project API key (sk-mmgr-...) via Authorization: Bearer <key>
   or X-API-Key - scoped, expiring, revocable, recommended for external AI
   clients; (2) the owner code via Authorization: Bearer <owner-code> -
   full access, kept for owners driving MCP with their master credential.
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
     apply_changes        — write diffs (goes through review queue)
   ============================================================ */

import { json, cloudForbidden, cloudAuthOwnerEither, cloudAuthApiKey, cloudReadState, readCloudBody,
  cloudScopeState, cloudScopeMerge, cloudDiffState, CLOUD_SECTIONS, CLOUD_KEY_TO_SECTION } from '../lib/http.js';
import { API_SHAPES } from '../api/shapes.js';

// ---- MCP protocol constants ----

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'my-manager-mcp',
  version: '1.0.0'
};

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
    description: 'Get budget lines with planned vs actual costs, EVM metrics (SPI, CPI, EAC, ETC, VAC).',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_risks',
    description: 'Get the risk register with probability, impact, status, and linked issues.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_weather',
    description: 'Get weather forecast risk days (precip >= 60%, temp >= 32C or <= 0C) and delay log.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_meetings',
    description: 'Get meeting log with decisions, action items, and attendees.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'apply_changes',
    description: 'Submit field-level changes to the project. Goes through owner review queue - never auto-applied. Provide diffs as an array of {path, recordId, field, before, after} objects.',
    inputSchema: {
      type: 'object',
      properties: {
        diffs: {
          type: 'array',
          description: 'Array of field-level changes',
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
        label: { type: 'string', description: 'Human-readable label for this change set' }
      },
      required: ['diffs']
    }
  }
];

// ---- Tool execution ----

// API-KEY-AUDIT F4 (2026-09-16): a scoped key only ever sees its granted
// sections. `scope` is null for an owner-code caller (full access) or the
// key's granted section keys (see CLOUD_SECTIONS) - each tool then either
// projects its output through cloudScopeState or refuses with a clear
// message when its whole section is not granted. Weather is not a grantable
// section at all, so scoped keys are refused there outright.
function sectionAllowed(scope, sec) { return !Array.isArray(scope) || scope.indexOf(sec) !== -1; }
function sectionRefusal(scope) {
  return 'This API key does not include that section. The owner granted it: ' + (Array.isArray(scope) && scope.length ? scope.join(', ') : '(no sections)') + '. Ask the project owner to tick more sections for this key.';
}

function executeTool(name, state, projectId, label, scope) {
  if (!state) return { content: [{ type: 'text', text: 'No project data available. Save a snapshot first.' }], isError: true };
  if (Array.isArray(scope)) state = cloudScopeState(state, scope);

  switch (name) {
    case 'get_project_summary': {
      const tasks = Array.isArray(state.tasks) ? state.tasks : [];
      const done = tasks.filter(t => t.status === 'completed').length;
      const total = tasks.length;
      const risks = Array.isArray(state.risks) ? state.risks : [];
      const openRisks = risks.filter(r => !r.issueId).length;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            name: state.charter && state.charter.name ? state.charter.name : projectId,
            description: state.charter && state.charter.description ? state.charter.description : '',
            completion: total ? Math.round(done / total * 100) : 0,
            totalTasks: total,
            completedTasks: done,
            openRisks,
            charter: state.charter || null
          }, null, 2)
        }]
      };
    }
    case 'get_tasks': {
      if (!sectionAllowed(scope, 'wbs')) return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      const tasks = Array.isArray(state.tasks) ? state.tasks : [];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: tasks.length,
            tasks: tasks.map(t => ({
              id: t.id, name: t.name || t.id, status: t.status || 'todo',
              startDate: t.startDate || null, endDate: t.endDate || null,
              critical: !!t.critical, dependencies: t.dependencies || [],
              assignee: t.assignee || null, notes: t.notes || null
            }))
          }, null, 2)
        }]
      };
    }
    case 'get_budget': {
      if (!sectionAllowed(scope, 'bud')) return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      const lines = Array.isArray(state.budgetLines) ? state.budgetLines : [];
      const spendLog = Array.isArray(state.spendLog) ? state.spendLog : [];
      const enriched = lines.map(line => {
        const log = spendLog.filter(e => e.budgetLineId === line.id);
        const actual = log.length ? log.reduce((s, e) => s + (+e.amount || 0), 0) : (+line.actual || 0);
        return {
          id: line.id, name: line.name || line.id, category: line.category || null,
          planned: +line.planned || 0, actual,
          variance: (+line.planned || 0) - actual,
          linkedTaskId: line.linkedTaskId || line.taskId || null
        };
      });
      const totalPlanned = enriched.reduce((s, l) => s + l.planned, 0);
      const totalActual = enriched.reduce((s, l) => s + l.actual, 0);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            totalPlanned, totalActual, variance: totalPlanned - totalActual,
            lineCount: enriched.length, lines: enriched
          }, null, 2)
        }]
      };
    }
    case 'get_risks': {
      if (!sectionAllowed(scope, 'risk')) return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      const risks = Array.isArray(state.risks) ? state.risks : [];
      const issues = Array.isArray(state.issues) ? state.issues : [];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            riskCount: risks.length, issueCount: issues.length,
            risks: risks.map(r => ({
              id: r.id, description: r.description || '(untitled)',
              probability: r.probability || null, impact: r.impact || null,
              status: r.status || 'open', promoted: !!r.issueId,
              mitigation: r.mitigation || null
            })),
            issues: issues.map(i => ({
              id: i.id, description: i.description || '(untitled)',
              status: i.status || 'open', owner: i.owner || null
            }))
          }, null, 2)
        }]
      };
    }
    case 'get_weather': {
      if (Array.isArray(scope)) return { content: [{ type: 'text', text: 'Weather data is not a grantable section, so API keys cannot read it. The project owner can read it inside the app.' }], isError: true };
      const cache = state.wxCache || null;
      const days = (cache && Array.isArray(cache.days)) ? cache.days : [];
      const log = Array.isArray(state.weatherLog) ? state.weatherLog : [];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cachedAt: cache && cache.at ? new Date(cache.at).toISOString() : null,
            forecastDays: days.length,
            forecast: days.slice(0, 14).map(d => ({
              date: d.date, precip: +d.precip || 0,
              tMax: +d.tMax || 0, tMin: +d.tMin || 0
            })),
            delayLogCount: log.length,
            delayLog: log.slice(-20).map(w => ({
              date: w.date || null, condition: w.condition || null,
              delayDays: +w.delayDays || 0, cause: w.cause || null
            }))
          }, null, 2)
        }]
      };
    }
    case 'get_meetings': {
      if (!sectionAllowed(scope, 'meet')) return { content: [{ type: 'text', text: sectionRefusal(scope) }], isError: true };
      const meetings = Array.isArray(state.meetings) ? state.meetings : [];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: meetings.length,
            meetings: meetings.map(m => ({
              id: m.id, date: m.date || null, title: m.title || m.name || '(untitled)',
              attendees: m.attendees || [], decisions: m.decisions || [],
              actions: m.actions || m.actionItems || [], notes: m.notes || null
            }))
          }, null, 2)
        }]
      };
    }
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
      jsonrpc: '2.0', id,
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
      jsonrpc: '2.0', id,
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

    // Read project state
    const key = 'projects/' + projectId + '/latest.json';
    const row = await env.DB.prepare(
      'SELECT latest_r2_key, owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
    ).bind(projectId).first();
    const state = row && row.latest_r2_key
      ? await cloudReadState(env, key, row.owner_code_hash, row.owner_code_salt)
      : null;

    // Execute the tool. API-KEY-AUDIT F4: a scoped key's reads are filtered
    // to its granted sections; an owner-code caller gets scope=null (full).
    const result = executeTool(toolName, state, projectId, auth.label || 'MCP AI', auth.role === 'api' ? auth.scope : null);

    // Handle apply_changes - queue a pending review proposal (API-KEY-AUDIT
    // F3, 2026-09-16). Field-level diffs are materialized onto a copy of the
    // stored state, merged under the caller's section scope exactly like the
    // REST save path, and inserted as a pending cloud_reviews row. NOTHING
    // is written to live project state here - the owner accepts or rejects
    // inside the project, and only the accept applies the change.
    if (result.pendingApply) {
      const diffs = toolArgs.diffs;
      if (!Array.isArray(diffs) || diffs.length === 0) {
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'No diffs provided. Supply an array of {path, recordId, field, after} objects.' }], isError: true }
        };
      }

      const granted = Array.isArray(auth.scope) ? auth.scope : Object.keys(CLOUD_SECTIONS);
      const prev = state; // the full stored state fetched above (pre-scope)
      if (!prev) {
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'No project data available. Save a snapshot first.' }], isError: true }
        };
      }
      const base = JSON.parse(JSON.stringify(prev));
      const submitted = {};
      const refused = [];
      for (let i = 0; i < diffs.length; i++) {
        const d = diffs[i];
        if (!d || typeof d !== 'object') { refused.push('diff ' + i + ': invalid'); continue; }
        const path = String(d.path || '');
        const rec = String(d.recordId || '');
        const field = String(d.field || '');
        const sec = CLOUD_KEY_TO_SECTION[path];
        if (!sec) { refused.push((path || '(empty)') + ': not a project section'); continue; }
        if (granted.indexOf(sec) === -1) { refused.push(path + ': outside the granted sections'); continue; }
        const arr = base[path];
        if (!Array.isArray(arr)) { refused.push(path + ': not an editable list'); continue; }
        let item = null;
        for (let j = 0; j < arr.length; j++) {
          if (arr[j] && String(arr[j].id) === rec) { item = arr[j]; break; }
        }
        if (!item) { refused.push((rec || '(no record id)') + ': not found in ' + path); continue; }
        if (!field) { refused.push('diff ' + i + ': missing field'); continue; }
        item[field] = d.after !== undefined ? d.after : null;
        submitted[path] = arr;
      }
      if (!Object.keys(submitted).length) {
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'Nothing to propose. ' + (refused.length ? 'Refused: ' + refused.join('; ') + '.' : '') }], isError: true }
        };
      }
      const merged = cloudScopeMerge(prev, submitted, granted);
      if (!merged.applied.length) {
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'No changes were within the granted sections.' + (refused.length ? ' Refused: ' + refused.join('; ') + '.' : '') }], isError: true }
        };
      }
      const now = new Date().toISOString();
      const diffsJson = (cloudDiffState(prev, merged.next) || []).filter(function(d) { return String(d.path).indexOf('fieldTs') !== 0; });
      let res;
      try {
        res = await env.DB.prepare(
          'INSERT INTO cloud_reviews (project_id, proposal_type, source_type, source_label, editor_code_id, scope, submitted_json, diffs_json, status, proposed_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
        ).bind(projectId, 'mcp', 'api', auth.label || 'MCP AI', null, JSON.stringify(granted),
          JSON.stringify(submitted), JSON.stringify(diffsJson), 'pending', now).run();
      } catch (e) {
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'Could not queue the proposal: ' + (e.message || 'database error') }], isError: true }
        };
      }
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{
            type: 'text',
            text: 'Queued ' + diffsJson.length + ' field change(s) for owner review (proposal #' + res.meta.last_row_id + ').'
              + (refused.length ? ' Refused: ' + refused.join('; ') + '.' : '')
              + ' Nothing changes until the owner accepts it inside the project.'
          }]
        }
      };
    }

    return { jsonrpc: '2.0', id, result };
  }

  return {
    jsonrpc: '2.0', id,
    error: { code: -32601, message: 'Method not found: ' + method }
  };
}

// ---- Route handler ----

export async function handleMcpServer(request, env, projectId) {
  // Only POST is supported for Streamable HTTP
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'MCP server requires POST' }, 405);
  }

  // Authenticate. API-KEY-AUDIT F2 (2026-09-16): a project API key
  // (Authorization: Bearer sk-mmgr-... or X-API-Key) is the RECOMMENDED
  // credential - scoped to its granted sections, expiring, revocable from
  // the project's API Keys panel. The owner-code Bearer still works with
  // full access. Owner-code auth: MCP-BEARER-FIX (2026-09-12 owner review)
  // - cloudAuthOwnerEither takes (request, env, projectId), so the Bearer
  // token is routed through the X-Owner-Code header the helper reads.
  let auth = null;
  const apiKey = String(request.headers.get('X-API-Key') || '').trim();
  if (!apiKey) {
    const authHeader = request.headers.get('Authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (bearer && bearer.lastIndexOf('sk-mmgr-', 0) === 0) {
      auth = await cloudAuthApiKey(request, env, projectId, bearer);
    }
  }
  if (!auth && apiKey) {
    auth = await cloudAuthApiKey(request, env, projectId, apiKey);
  }
  if (!auth) {
    const authHeader = request.headers.get('Authorization') || '';
    const code = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!code) {
      return json({ ok: false, error: 'Missing Authorization: Bearer <api-key or owner-code>' }, 401);
    }
    const authHeaders = new Headers(request.headers);
    authHeaders.set('X-Owner-Code', code);
    const authReq = new Request(request.url, { method: 'POST', headers: authHeaders, body: request.body });
    auth = await cloudAuthOwnerEither(authReq, env, projectId);
  }
  if (!auth) return cloudForbidden();

  // Parse request body
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'Request too large' }, 413);
  if (read.bad || !read.body) return json({ ok: false, error: 'Invalid JSON' }, 400);

  const body = read.body;
  const projectIdFromUrl = projectId;

  try {
    const response = await handleMcpRequest(body, projectIdFromUrl, env, auth);
    if (!response) return new Response(null, { status: 202 });
    return json(response, 200);
  } catch (e) {
    console.error('MCP error:', e && e.message);
    return json({
      jsonrpc: '2.0',
      id: body && body.id,
      error: { code: -32603, message: 'Internal error: ' + (e.message || 'unknown') }
    }, 500);
  }
}
