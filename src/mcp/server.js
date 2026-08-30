/* ============================================================
   MCP SERVER — per-project Model Context Protocol endpoint
   ============================================================
   Exposes project data as MCP tools for external AI clients
   (Claude Desktop, Cursor, Windsurf, etc.).

   Transport: Streamable HTTP (POST /api/mcp/:projectId)
   Auth: Owner code via Authorization: Bearer <code>

   Tools:
     get_project_summary  — project name, description, health
     get_tasks            — task list with status, dates, deps
     get_budget           — budget lines, planned vs actual, EVM
     get_risks            — risk register with probability, impact
     get_weather          — weather forecast risk days + delay log
     get_meetings         — meeting log with decisions, actions
     apply_changes        — write diffs (goes through review queue)
   ============================================================ */

import { json, cloudForbidden, cloudAuthOwnerEither, cloudReadState, readCloudBody } from '../lib/http.js';
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
    description: 'Submit field-level changes to the project. Goes through owner review queue — never auto-applied. Provide diffs as an array of {path, recordId, field, before, after} objects.',
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

function executeTool(name, state, projectId, label) {
  if (!state) return { content: [{ type: 'text', text: 'No project data available. Save a snapshot first.' }], isError: true };

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
      // This returns a special result that the caller handles
      // by submitting to the changelog import endpoint
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

    // Execute the tool
    const result = executeTool(toolName, state, projectId, auth.label || 'MCP AI');

    // Handle apply_changes specially — submit to changelog import
    if (result.pendingApply) {
      const diffs = toolArgs.diffs;
      if (!Array.isArray(diffs) || diffs.length === 0) {
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'No diffs provided. Supply an array of {path, recordId, field, after} objects.' }], isError: true }
        };
      }

      // Submit via changelog import
      const importBody = {
        entries: [{
          localId: 'mcp-' + Date.now(),
          type: 'edit',
          actorType: 'mcp',
          label: toolArgs.label || 'MCP AI change',
          diffs: diffs
        }]
      };

      try {
        const r = await fetch('http://internal/api/cloud/projects/' + encodeURIComponent(projectId) + '/changelog/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Owner-Code': auth.code || '' },
          body: JSON.stringify(importBody)
        });
        const data = await r.json();
        return {
          jsonrpc: '2.0', id,
          result: {
            content: [{
              type: 'text',
              text: data.ok
                ? 'Changes submitted for owner review. ' + (data.imported || 0) + ' entry(ies) queued, ' + (data.skipped || 0) + ' skipped. Owner must accept in the Review section.'
                : 'Failed: ' + (data.error || 'unknown error')
            }],
            isError: !data.ok
          }
        };
      } catch (e) {
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'Failed to submit changes: ' + (e.message || 'network error') }], isError: true }
        };
      }
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

  // Authenticate via Bearer token
  const authHeader = request.headers.get('Authorization') || '';
  const code = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!code) {
    return json({ ok: false, error: 'Missing Authorization: Bearer <owner-code>' }, 401);
  }

  // Verify owner code
  const auth = await cloudAuthOwnerEither(request, env, projectId, code);
  if (!auth) return cloudForbidden();

  // Parse request body
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'Request too large' }, 413);
  if (read.bad || !read.body) return json({ ok: false, error: 'Invalid JSON' }, 400);

  const body = read.body;
  const projectIdFromUrl = projectId;

  try {
    const response = await handleMcpRequest(body, projectIdFromUrl, env, { ...auth, code });
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
