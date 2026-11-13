/* ============================================================
   APP-WIDE MCP SERVER — account-level Model Context Protocol
   ------------------------------------------------------------
   Wave 1 of the app-wide MCP upgrade. One connection per ACCOUNT
   (not per project): an external AI client authorises through the
   OAuth 2.1 authorization server in ./oauth.js, then operates
   across every cloud project the signed-in account can reach
   (owned, editor, or viewer) under the controls the owner set in
   the admin panel.

   Transport: Streamable HTTP (POST /api/mcp) - distinct from the
   per-project endpoint POST /api/mcp/:projectId. The two surfaces
   share the SAME read engine (executeTool) and the SAME review-
   queue proposal engine (queueMcpProposal) from ./server.js, so a
   project never looks different between them.

   Account model (migration 0037):
     mcp_server_config  - enabled + policy (allow_all / allow_read /
                          allow_subset / block_all) + tool_subset
     mcp_clients        - connected clients (RFC 7591 DCR)
     mcp_tokens         - opaque bearer tokens (only SHA-256 stored)
     cloud_projects.mcp_enabled - per-project opt-out

   Hard rules (owner, 2026-11-11):
     - Collaboration invites are NEVER exposed: there is no invite
       tool here, by design.
     - The MCP server cannot open the admin panel.
     - Writes (create_project, apply_changes) only queue a PENDING
       cloud_reviews row; nothing touches live state until the owner
       accepts it inside the project.
   ============================================================ */
import {
  json,
  cloudForbidden,
  readSession,
  cloudReadState,
  provenEmail,
  sanitizeProjectId,
  CLOUD_SECTIONS,
  teamScopeForRole
} from '../lib/http.js';
import { ownerTier } from '../cloud/team.js';
import { insertCloudProject } from '../cloud/projects.js';
import {
  TOOLS,
  executeTool,
  queueMcpProposal,
  withdrawMcpProposal,
  proposalStatusResult,
  applyReportResult,
  pendingDryRunResult,
  validateProposalEnvelope,
  MCP_PREMIUM_REFUSAL
} from './server.js';
import { validateChangesProposal } from './plan.js';
import {
  MCP_SERVER_VERSION,
  MCP_SERVER_INSTRUCTIONS,
  applyToolMeta,
  attachStructuredContent
} from './tool-meta.js';
import {
  verifyAccessToken,
  authorizationServerMetadata,
  protectedResourceMetadata
} from './oauth.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'my-manager-mcp-appwide', version: MCP_SERVER_VERSION };
// ADDENDUM A5: exported so the acceptance harness can prove both surfaces
// announce the same version without booting an account session.
export const APPWIDE_SERVER_INFO = SERVER_INFO;

// Tools that write. Everything else is a read. Used for policy + role gating.
const WRITE_TOOLS = ['create_project', 'apply_changes', 'withdraw_changes'];

/* ---- App-wide tool catalog -----------------------------------------------
   Project-scoped read tools reuse the per-project TOOLS descriptions but add a
   required projectId argument. Account-level tools (list_projects,
   create_project) and the queued-write apply_changes round it out. NO invite
   tool exists. */
function buildAppwideTools() {
  const readNames = [
    'get_project_summary',
    'get_tasks',
    'get_budget',
    'get_deliveries',
    'get_weekly_summary',
    'get_risks',
    'get_weather',
    'get_meetings',
    'get_table',
    'get_schema',
    'run_monte_carlo',
    'get_proposal_status',
    'get_apply_report',
    'get_pending'
  ];
  const out = [];
  readNames.forEach(function (name) {
    const base = TOOLS.filter(function (t) {
      return t.name === name;
    })[0];
    if (!base) {
      return;
    }
    const props = Object.assign({}, base.inputSchema.properties || {});
    props.projectId = {
      type: 'string',
      description: 'Cloud project id to read. Use list_projects to discover ids.'
    };
    const req = (base.inputSchema.required || []).slice();
    if (req.indexOf('projectId') === -1) {
      req.push('projectId');
    }
    out.push({
      name: base.name,
      description: base.description,
      inputSchema: { type: 'object', properties: props, required: req }
    });
  });
  // apply_changes gets a projectId too.
  const applyBase = TOOLS.filter(function (t) {
    return t.name === 'apply_changes';
  })[0];
  if (applyBase) {
    const props = Object.assign({}, applyBase.inputSchema.properties || {});
    props.projectId = {
      type: 'string',
      description: 'Cloud project id to propose changes for.'
    };
    const req = (applyBase.inputSchema.required || []).slice();
    if (req.indexOf('projectId') === -1) {
      req.push('projectId');
    }
    out.push({
      name: 'apply_changes',
      description:
        applyBase.description +
        ' Changes are queued for the owner to accept inside the project - they never apply automatically.',
      inputSchema: { type: 'object', properties: props, required: req }
    });
  }
  // MCP-AGENT-FIRST 2.6: the dry run takes a projectId like apply_changes.
  const validateBase = TOOLS.filter(function (t) {
    return t.name === 'validate_changes';
  })[0];
  if (validateBase) {
    const props = Object.assign({}, validateBase.inputSchema.properties || {});
    props.projectId = {
      type: 'string',
      description: 'Cloud project id to dry-run the proposal against.'
    };
    const req = (validateBase.inputSchema.required || []).slice();
    if (req.indexOf('projectId') === -1) {
      req.push('projectId');
    }
    out.push({
      name: 'validate_changes',
      description: validateBase.description,
      inputSchema: { type: 'object', properties: props, required: req }
    });
  }
  // MCP-AGENT-FIRST 2026-11-12 3.3: withdraw_changes takes a projectId too.
  const withdrawBase = TOOLS.filter(function (t) {
    return t.name === 'withdraw_changes';
  })[0];
  if (withdrawBase) {
    const props = Object.assign({}, withdrawBase.inputSchema.properties || {});
    props.projectId = {
      type: 'string',
      description: 'Cloud project id the proposal was queued on.'
    };
    const req = (withdrawBase.inputSchema.required || []).slice();
    if (req.indexOf('projectId') === -1) {
      req.push('projectId');
    }
    out.push({
      name: 'withdraw_changes',
      description: withdrawBase.description,
      inputSchema: { type: 'object', properties: props, required: req }
    });
  }
  out.push({
    name: 'list_projects',
    description:
      'List every cloud project this account can reach - owned, editor, or viewer - with its access role and whether MCP is enabled for it.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  });
  out.push({
    name: 'create_project',
    description:
      'Create a new cloud project owned by this account. Returns the project id and the owner code needed to recover it. Premium accounts only.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Desired id (letters, numbers, dash, underscore).'
        },
        name: { type: 'string', description: 'Project display name.' },
        description: { type: 'string', description: 'Optional short description.' }
      },
      required: ['projectId', 'name']
    }
  });
  return out;
}

// ADDENDUM A5: the app-wide catalog is built by copying name/description/
// inputSchema from TOOLS, so the annotations and outputSchemas are attached
// here from the same map the per-project catalog uses.
export const APPWIDE_TOOLS = applyToolMeta(buildAppwideTools());

/* ---- Account config + project access ------------------------------------- */

async function getMcpConfig(env, accountSub) {
  const row = await env.DB.prepare(
    'SELECT enabled, policy, tool_subset FROM mcp_server_config WHERE account_sub = ?'
  )
    .bind(accountSub)
    .first();
  if (!row) {
    // Default-on for a premium account that has not visited the admin panel
    // yet; the owner can turn it off there.
    return { enabled: 1, policy: 'allow_all', toolSubset: null };
  }
  let subset = null;
  if (row.tool_subset) {
    try {
      subset = JSON.parse(row.tool_subset);
    } catch (e) {
      subset = null;
    }
  }
  return {
    enabled: row.enabled === 1 ? 1 : 0,
    policy: row.policy || 'allow_all',
    toolSubset: Array.isArray(subset) ? subset : null
  };
}

// Resolve the account's access to a single project and whether MCP is allowed
// on it. Returns null when the account cannot reach the project at all.
async function resolveProjectAccess(env, accountSub, projectId) {
  const email =
    typeof accountSub === 'string' && accountSub.indexOf('email:') === 0
      ? accountSub.slice('email:'.length)
      : null;
  const owned = await env.DB.prepare(
    'SELECT project_id, owner_code_hash, owner_code_salt, latest_r2_key, mcp_enabled, deleted_at FROM cloud_projects WHERE project_id = ? AND deleted_at IS NULL AND (google_sub = ? OR owner_email = ?)'
  )
    .bind(projectId, accountSub, email || '')
    .first();
  if (owned) {
    return { role: 'owner', mcpEnabled: owned.mcp_enabled !== 0, row: owned };
  }
  const adopted = await env.DB.prepare(
    'SELECT p.project_id, p.owner_code_hash, p.owner_code_salt, p.latest_r2_key, p.mcp_enabled, p.deleted_at, a.role AS adopted_role, e.scope AS editor_scope FROM cloud_adoptions a JOIN cloud_projects p ON p.project_id = a.project_id LEFT JOIN cloud_editor_codes e ON e.id = a.editor_code_id WHERE a.recipient_sub = ? AND a.project_id = ? AND p.deleted_at IS NULL'
  )
    .bind(accountSub, projectId)
    .first();
  if (adopted) {
    // The adopted member's real section scope lives on the editor code, not on
    // a role template. Parsing it here gives the app-wide server the SAME
    // visible sections the app itself would hand that member, and makes a
    // diff outside those sections a genuine "outside the granted sections"
    // refusal instead of silently widening access.
    let scope = [];
    try {
      const p = adopted.editor_scope ? JSON.parse(adopted.editor_scope) : null;
      if (Array.isArray(p)) {
        scope = p.filter(function (x) {
          return !!CLOUD_SECTIONS[x];
        });
      }
    } catch (e) {
      scope = [];
    }
    return {
      role: adopted.adopted_role === 'view' ? 'view' : 'editor',
      mcpEnabled: adopted.mcp_enabled !== 0,
      scope: scope,
      row: adopted
    };
  }
  return null;
}

async function listProjectsForAccount(env, accountSub) {
  const email =
    typeof accountSub === 'string' && accountSub.indexOf('email:') === 0
      ? accountSub.slice('email:'.length)
      : null;
  const ownedStmt = env.DB.prepare(
    'SELECT project_id, owner_label, status, mcp_enabled FROM cloud_projects WHERE deleted_at IS NULL AND (google_sub = ? OR owner_email = ?)'
  ).bind(accountSub, email || '');
  const adoptedStmt = env.DB.prepare(
    'SELECT p.project_id, p.owner_label, p.status, p.mcp_enabled, a.role AS adopted_role FROM cloud_adoptions a JOIN cloud_projects p ON p.project_id = a.project_id WHERE a.recipient_sub = ? AND p.deleted_at IS NULL'
  ).bind(accountSub);
  let owned;
  let adopted;
  if (typeof env.DB.batch === 'function') {
    const both = await env.DB.batch([ownedStmt, adoptedStmt]);
    owned = both[0];
    adopted = both[1];
  } else {
    owned = await ownedStmt.all();
    adopted = await adoptedStmt.all();
  }
  const seen = {};
  const projects = [];
  ((owned && owned.results) || []).forEach(function (r) {
    seen[r.project_id] = 1;
    projects.push({
      projectId: r.project_id,
      label: r.owner_label || null,
      status: r.status || 'active',
      accessRole: 'owner',
      mcpEnabled: r.mcp_enabled !== 0
    });
  });
  ((adopted && adopted.results) || []).forEach(function (r) {
    if (seen[r.project_id]) {
      return;
    }
    projects.push({
      projectId: r.project_id,
      label: r.owner_label || null,
      status: r.status || 'active',
      accessRole: r.adopted_role === 'view' ? 'view' : 'editor',
      mcpEnabled: r.mcp_enabled !== 0
    });
  });
  projects.sort(function (a, b) {
    return String(a.projectId).localeCompare(String(b.projectId));
  });
  return projects;
}

/* ---- JSON-RPC helpers ---------------------------------------------------- */

function rpcResult(id, result) {
  // ADDENDUM A5: one exit for every result, so structuredContent is
  // attached on this surface exactly as it is on the per-project one.
  return json(attachStructuredContent({ jsonrpc: '2.0', id: id, result: result }), 200);
}
function rpcErrorResult(id, text) {
  return json(
    { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: text }], isError: true } },
    200
  );
}
function rpcError(id, code, message) {
  return json({ jsonrpc: '2.0', id: id, error: { code: code, message: message } }, 200);
}

/* ---- Main handler -------------------------------------------------------- */

// T-26 (2026-11-12): a remote connector only starts OAuth when the MCP
// endpoint answers 401 with the protected-resource metadata URL. The old
// PATH-A behaviour (handshake 200, refusal inside tools/call) meant Claude
// detected "no sign in" and never offered the consent screen.
function unauthorized(origin, message, invalidToken) {
  const prm = origin + '/.well-known/oauth-protected-resource';
  const challenge = invalidToken
    ? 'Bearer error="invalid_token", resource_metadata="' + prm + '"'
    : 'Bearer resource_metadata="' + prm + '"';
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: message }
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'WWW-Authenticate': challenge
      }
    }
  );
}

export async function handleAppwideMcp(request, env) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'MCP server requires POST' }, 405);
  }
  const origin = new URL(request.url).origin;
  const authHeader = request.headers.get('Authorization') || '';
  const bearer = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7).trim() : '';
  const acct = await verifyAccessToken(env, bearer);
  if (!acct) {
    return unauthorized(
      origin,
      bearer
        ? 'The access token is invalid or expired. Reconnect the connector.'
        : 'Connect with OAuth to use this MCP server.',
      !!bearer
    );
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return rpcError(null, -32700, 'parse error');
  }
  const method = body && body.method;
  const id = body && body.id;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: MCP_SERVER_INSTRUCTIONS
    });
  }
  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204 });
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: APPWIDE_TOOLS });
  }
  if (method === 'tools/call') {
    const params = body.params || {};
    const toolName = params.name;
    const toolArgs = params.arguments || {};
    if (!toolName) {
      return rpcError(id, -32602, 'Missing tool name');
    }

    // The bearer was verified at the transport gate above, so every tool call
    // below runs with a real account. No token, no data, no writes.
    const accountSub = acct.accountSub;

    const cfg = await getMcpConfig(env, accountSub);
    if (!cfg.enabled || cfg.policy === 'block_all') {
      return rpcErrorResult(
        id,
        'The MCP server is turned off for this account. Enable it in the admin panel.'
      );
    }

    // B4 premium gate, evaluated on the CONNECTING account (not the project
    // owner), so an editor inviting their own client still pays for MCP.
    const tier = await ownerTier(env, accountSub);
    if (tier === 'free') {
      return rpcResult(id, {
        content: [{ type: 'text', text: MCP_PREMIUM_REFUSAL }],
        isError: true
      });
    }

    if (cfg.policy === 'allow_read' && WRITE_TOOLS.indexOf(toolName) > -1) {
      return rpcErrorResult(
        id,
        'This account allows MCP read-only access. Writing tools (create_project, apply_changes) are turned off.'
      );
    }
    if (cfg.policy === 'allow_subset' && (cfg.toolSubset || []).indexOf(toolName) === -1) {
      return rpcErrorResult(
        id,
        'This tool is not enabled for your account. Change the tool access policy in the admin panel.'
      );
    }

    if (toolName === 'list_projects') {
      const projects = await listProjectsForAccount(env, accountSub);
      return rpcResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: projects.length, projects: projects }, null, 2)
          }
        ]
      });
    }

    if (toolName === 'create_project') {
      return await createProject(env, accountSub, toolArgs, id);
    }

    // Everything else is project-scoped.
    const projectId = String(toolArgs.projectId || '').trim();
    if (!projectId) {
      return rpcErrorResult(
        id,
        'This tool needs a projectId argument. Use list_projects to discover ids.'
      );
    }
    const access = await resolveProjectAccess(env, accountSub, projectId);
    if (!access) {
      return rpcErrorResult(id, 'You do not have access to that project through this account.');
    }
    if (!access.mcpEnabled) {
      return rpcErrorResult(
        id,
        'MCP access is turned off for that project. Enable it in the admin panel or the project controls.'
      );
    }
    if (access.role === 'view' && WRITE_TOOLS.indexOf(toolName) > -1) {
      return rpcErrorResult(
        id,
        'You have view-only access to that project; writing tools are disabled.'
      );
    }

    const row = access.row;
    let auth;
    if (access.role === 'owner') {
      auth = { role: 'owner', label: 'MCP AI' };
    } else {
      // Prefer the adopted member's own section scope (from the editor code).
      // Only fall back to a role template when the row carries none - and map
      // the adoption roles ('editor' | 'view') to real templates, because
      // teamScopeForRole knows manager/supervisor/contractor/client, not
      // 'editor'. Passing an unknown role yields an empty scope, which would
      // refuse every read.
      let scope = Array.isArray(access.scope) ? access.scope : [];
      if (!scope.length) {
        scope =
          access.role === 'view'
            ? teamScopeForRole('client', Object.keys(CLOUD_SECTIONS))
            : teamScopeForRole('manager');
      }
      auth = {
        role: 'api',
        label: 'MCP AI',
        scope: scope,
        budgetRead: scope.indexOf('bud') > -1,
        budgetWrite: access.role !== 'view' && scope.indexOf('bud') > -1
      };
    }

    // P0 (MCP-DIRECTIVE 2026-11-11): reject an empty/oversized/invalid
    // apply_changes envelope BEFORE loading the snapshot. Same shared
    // validator as the project endpoint, so refusal text cannot drift.
    if (toolName === 'apply_changes') {
      const precheck = validateProposalEnvelope(toolArgs, auth);
      if (precheck) {
        return rpcResult(id, precheck);
      }
    }

    const state = row.latest_r2_key
      ? await cloudReadState(
          env,
          'projects/' + projectId + '/latest.json',
          row.owner_code_hash,
          row.owner_code_salt
        )
      : null;

    if (toolName === 'apply_changes' || toolName === 'validate_changes') {
      const result = executeTool(
        toolName,
        state,
        projectId,
        'MCP AI',
        auth.role === 'api' ? auth.scope : null,
        toolArgs,
        auth,
        state
      );
      if (result.pendingValidate) {
        const dry = await validateChangesProposal(env, projectId, auth, toolArgs, id, state);
        return json(dry, 200);
      }
      if (result.pendingApply) {
        // queueMcpProposal returns a JSON-RPC envelope object; the router
        // expects a Response from this handler, so wrap it here (the project
        // endpoint wraps it in handleMcpServer - same envelope either way).
        const proposal = await queueMcpProposal(env, projectId, auth, toolArgs, id, state);
        return json(proposal, 200);
      }
      return rpcResult(id, result);
    }

    if (toolName === 'withdraw_changes') {
      // 3.3: withdraw_changes reads and writes only the calling key's own
      // rows; the same engine as the per-project endpoint.
      const r = await withdrawMcpProposal(env, projectId, auth, toolArgs, id);
      return json(r, 200);
    }

    // 3.8: the report readers are owner/account-scoped on the app-wide surface
    // (the connecting account is the owner of its own projects), so they read
    // every proposal on the project rather than just one key's queue.
    if (toolName === 'get_proposal_status') {
      const r = await proposalStatusResult(env, projectId, auth, toolArgs, id);
      return json(r, 200);
    }
    if (toolName === 'get_apply_report') {
      const r = await applyReportResult(env, projectId, auth, toolArgs, id);
      return json(r, 200);
    }
    if (toolName === 'get_pending') {
      const r = await pendingDryRunResult(env, projectId, auth, toolArgs, id);
      return json(r, 200);
    }

    const result = executeTool(
      toolName,
      state,
      projectId,
      'MCP AI',
      auth.role === 'api' ? auth.scope : null,
      toolArgs,
      auth,
      state
    );
    return rpcResult(id, result);
  }

  return rpcError(id, -32601, 'Method not found: ' + (method || '(none)'));
}

/* ---- create_project (account-owned cloud project) ------------------------- */

async function createProject(env, accountSub, toolArgs, id) {
  const projectId = sanitizeProjectId(toolArgs.projectId);
  if (!projectId) {
    return rpcErrorResult(id, 'bad project id');
  }
  const name = typeof toolArgs.name === 'string' ? toolArgs.name.slice(0, 120) : '';
  if (!name) {
    return rpcErrorResult(id, 'a project name is required');
  }
  const existing = await env.DB.prepare(
    'SELECT project_id FROM cloud_projects WHERE project_id = ?'
  )
    .bind(projectId)
    .first();
  if (existing) {
    return rpcErrorResult(id, 'that project id is taken');
  }
  const email =
    typeof accountSub === 'string' && accountSub.indexOf('email:') === 0
      ? accountSub.slice('email:'.length)
      : null;
  const ins = await insertCloudProject(env, {
    projectId: projectId,
    name: name,
    accountSub: accountSub,
    googleName: null,
    email: email,
    status: 'active',
    syncMode: 'auto'
  });
  if (!ins.ok) {
    return rpcErrorResult(id, ins.error || 'could not create project');
  }
  return rpcResult(id, {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            projectId: ins.projectId,
            ownerCode: ins.ownerCode,
            status: ins.status,
            syncMode: ins.syncMode
          },
          null,
          2
        )
      }
    ]
  });
}

/* ---- Admin panel API (Wave 2): manage the account's MCP server ----------
   Reached from the admin panel's "MCP Server" section. Every route is scoped
   to the signed-in Google account (readSession): a person may only manage
   their OWN account-level MCP server, never another's. The admin panel is the
   UI surface; the Google account is the authority. No admin-code dance is
   needed because the server is account-scoped, not site-scoped. */

const MCP_POLICIES = ['allow_all', 'allow_read', 'allow_subset', 'block_all'];
// The account policy gates APP-WIDE tools, so the subset must be validated
// against the app-wide catalog, not the per-project TOOLS.
const ALL_TOOL_NAMES = (APPWIDE_TOOLS || []).map(function (t) {
  return t.name;
});

async function upsertMcpConfig(env, accountSub, enabled, policy, toolSubset) {
  const existing = await env.DB.prepare(
    'SELECT account_sub FROM mcp_server_config WHERE account_sub = ?'
  )
    .bind(accountSub)
    .first();
  if (existing) {
    await env.DB.prepare(
      'UPDATE mcp_server_config SET enabled = ?, policy = ?, tool_subset = ? WHERE account_sub = ?'
    )
      .bind(enabled, policy, toolSubset, accountSub)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO mcp_server_config (account_sub, enabled, policy, tool_subset) VALUES (?, ?, ?, ?)'
    )
      .bind(accountSub, enabled, policy, toolSubset)
      .run();
  }
}

export async function handleMcpAdminConfig(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return cloudForbidden();
  }
  const accountSub = session.sub;
  if (request.method === 'GET') {
    const cfg = await getMcpConfig(env, accountSub);
    // The admin panel renders the per-project opt-out beside the account
    // policy, so the same GET carries the account's projects. Reuses the
    // list_projects query so the two surfaces cannot drift.
    const projects = await listProjectsForAccount(env, accountSub);
    return json({ ok: true, config: cfg, tools: ALL_TOOL_NAMES, projects: projects }, 200);
  }
  if (request.method === 'PUT') {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'bad json' }, 400);
    }
    const enabled = body.enabled === false || body.enabled === 0 ? 0 : 1;
    if (MCP_POLICIES.indexOf(body.policy) === -1) {
      return json({ ok: false, error: 'policy must be one of ' + MCP_POLICIES.join(', ') }, 400);
    }
    let toolSubset = null;
    if (body.tool_subset != null) {
      if (
        !Array.isArray(body.tool_subset) ||
        body.tool_subset.some(function (n) {
          return typeof n !== 'string' || ALL_TOOL_NAMES.indexOf(n) === -1;
        })
      ) {
        return json({ ok: false, error: 'tool_subset must list known tool names' }, 400);
      }
      toolSubset = JSON.stringify(body.tool_subset);
    }
    await upsertMcpConfig(env, accountSub, enabled, body.policy, toolSubset);
    return json({ ok: true, config: await getMcpConfig(env, accountSub) }, 200);
  }
  return json({ ok: false, error: 'method not allowed' }, 405);
}

export async function handleMcpAdminClientsList(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return cloudForbidden();
  }
  const accountSub = session.sub;
  const rows = await env.DB.prepare(
    'SELECT client_id, name, created_at, last_used_at, revoked FROM mcp_clients WHERE account_sub = ? ORDER BY created_at DESC'
  )
    .bind(accountSub)
    .all();
  const clients = ((rows && rows.results) || []).map(function (c) {
    return {
      clientId: c.client_id,
      name: c.name,
      createdAt: c.created_at,
      lastUsedAt: c.last_used_at,
      revoked: c.revoked === 1
    };
  });
  return json({ ok: true, clients: clients }, 200);
}

export async function handleMcpAdminClientRevoke(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return cloudForbidden();
  }
  const accountSub = session.sub;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad json' }, 400);
  }
  const clientId = typeof body.clientId === 'string' ? body.clientId : '';
  if (!clientId) {
    return json({ ok: false, error: 'clientId is required' }, 400);
  }
  // Account-scoped: only this account's own client can be revoked.
  const row = await env.DB.prepare(
    'SELECT client_id FROM mcp_clients WHERE account_sub = ? AND client_id = ?'
  )
    .bind(accountSub, clientId)
    .first();
  if (!row) {
    return json({ ok: false, error: 'unknown client' }, 404);
  }
  await env.DB.prepare('UPDATE mcp_clients SET revoked = 1 WHERE account_sub = ? AND client_id = ?')
    .bind(accountSub, clientId)
    .run();
  // Revoke any live tokens the client holds so the revocation is immediate.
  await env.DB.prepare('UPDATE mcp_tokens SET revoked = 1 WHERE account_sub = ? AND client_id = ?')
    .bind(accountSub, clientId)
    .run();
  return json({ ok: true }, 200);
}

export async function handleMcpAdminProjectEnabled(request, env, projectId) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return cloudForbidden();
  }
  const accountSub = session.sub;
  const access = await resolveProjectAccess(env, accountSub, projectId);
  if (!access || access.role !== 'owner') {
    return json({ ok: false, error: 'only the project owner can change MCP access' }, 403);
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad json' }, 400);
  }
  const enabled = body.enabled === false || body.enabled === 0 ? 0 : 1;
  await env.DB.prepare('UPDATE cloud_projects SET mcp_enabled = ? WHERE project_id = ?')
    .bind(enabled, projectId)
    .run();
  return json({ ok: true, projectId: projectId, mcpEnabled: enabled === 1 }, 200);
}
