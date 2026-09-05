/* ============================================================
   BYO-AI-KEY-SESSION-ONLY-v1 STEP-5 , /api/ai/chat relay
   ------------------------------------------------------------
   Stateless forwarder ONLY: the user's key is read from the per-request
   X-User-Api-Key header (or the body apiKey field) for that single request,
   forwarded to the provider endpoint over HTTPS, and never persisted. The
   key is not logged, not written to any binding (KV/D1/secrets), and never
   echoed in any error response. Enforced: max body size + hard upstream
   timeout. Missing key -> 401; bad body -> 400.
   ============================================================ */
import { json } from './lib/http.js';

const AI_PROVIDERS = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  // MODEL-FALLBACK-LADDER fast-follow (DIR-5): Anthropic joins the relay so
  // relay-hosted deployments get the same ladder as the direct path. The
  // Messages API authenticates with x-api-key + anthropic-version headers and
  // returns text in content[].text (handled below).
  anthropic: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-latest' },
  // GEMINI-MODEL-FALLBACK-LADDER (DIR-2): the Gemini model name is embedded in
  // the URL path, so the upstream URL is built per request via geminiUrl() , 
  // the static default above is only a fallback. The client drives the model
  // ladder THROUGH this relay (DIR-3): each attempt posts a validated `model`
  // field and the relay forwards to exactly that model; capacity statuses
  // (429/503) pass through with their own status so the client can advance.
  'google-gemini': { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', model: 'gemini-flash-latest' }
};
// Strict model-id validation: the value is interpolated into the upstream URL
// path, so it must be a plain Gemini model id (letters/digits/dash/dot/underscore
// only , no slashes/colons/query): path-injection guard. Invalid -> default.
const GEMINI_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function geminiUrl(model) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
}
const AI_BODY_LIMIT_BYTES = 262144; // 256 KB max request body
const AI_TIMEOUT_MS = 30000;        // hard upstream timeout

// OpenAI-style [{role,content}] -> Gemini generateContent payload.
function aiGeminiPayload(messages) {
  let system = '';
  const contents = [];
  (messages || []).forEach(function(m) {
    if (m && m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
    else if (m && m.content) contents.push({ role: (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user', parts: [{ text: m.content }] });
  });
  const p = { contents: contents };
  if (system) p.systemInstruction = { parts: [{ text: system }] };
  return p;
}

function aiExtractText(provider, data) {
  if (provider === 'google-gemini') {
    return data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
      ? data.candidates[0].content.parts.map(function(p) { return p.text || ''; }).join('') : null;
  }
  if (provider === 'anthropic') {
    return data && Array.isArray(data.content)
      ? data.content.map(function(c) { return (c && c.type === 'text' && c.text) ? c.text : ''; }).join('') : null;
  }
  return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
}

// OpenAI-style [{role,content}] -> Anthropic Messages API payload (mirror of
// mmgr-ai.js anthropicPayload): system split out, max_tokens required.
function aiAnthropicPayload(model, messages) {
  let system = '';
  const msgs = [];
  (messages || []).forEach(function(m) {
    if (m && m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
    else if (m && m.content) msgs.push({ role: (m.role === 'assistant' || m.role === 'model') ? 'assistant' : 'user', content: m.content });
  });
  const p = { model: model, max_tokens: 4096, messages: msgs };
  if (system) p.system = system;
  return p;
}

// Read + parse the JSON body with a hard size cap. Content-Length alone is
// not enough (string bodies from browsers often omit it), so the stream is
// read with a running byte budget and abandoned once it exceeds the limit.
async function readAiBody(request) {
  const cl = Number(request.headers.get('Content-Length') || 0);
  if (cl > AI_BODY_LIMIT_BYTES) return { tooLarge: true };
  if (!request.body) {
    try { return { body: await request.json() }; } catch (e) { return { bad: true }; }
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  let done = false;
  while (!done) {
    const res = await reader.read();
    done = res.done;
    if (res.value) {
      total += res.value.byteLength;
      if (total > AI_BODY_LIMIT_BYTES) return { tooLarge: true };
      chunks.push(res.value);
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return { body: JSON.parse(text) }; } catch (e) { return { bad: true }; }
}

// MCP CONTEXT INJECTION: when the client sends mcpProjectId + mcpCode,
// fetch the project state and inject it into the system prompt so the AI
// can reference real project data (tasks, budget, risks, etc.).
async function buildMcpContext(env, projectId, code) {
  if (!projectId || !code) return '';
  try {
    const key = 'projects/' + projectId + '/latest.json';
    const row = await env.DB.prepare(
      'SELECT latest_r2_key, owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?'
    ).bind(projectId).first();
    if (!row || !row.latest_r2_key) return '';
    // Import cloudReadState
    const { cloudReadState } = await import('./lib/http.js');
    const state = await cloudReadState(env, key, row.owner_code_hash, row.owner_code_salt);
    if (!state) return '';
    // Build a compact context summary
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    const budgetLines = Array.isArray(state.budgetLines) ? state.budgetLines : [];
    const risks = Array.isArray(state.risks) ? state.risks : [];
    const issues = Array.isArray(state.issues) ? state.issues : [];
    const meetings = Array.isArray(state.meetings) ? state.meetings : [];
    const weatherLog = Array.isArray(state.weatherLog) ? state.weatherLog : [];
    const totalPlanned = budgetLines.reduce((s, l) => s + (+l.planned || 0), 0);
    const totalActual = budgetLines.reduce((s, l) => s + (+l.actual || 0), 0);
    const completed = tasks.filter(t => t.status === 'completed').length;
    const overdue = tasks.filter(t => t.status !== 'completed' && t.endDate && new Date(t.endDate) < new Date()).length;
    const highRisks = risks.filter(r => /high/i.test(r.probability || '') && /high/i.test(r.impact || '')).length;
    return [
      '\n## PROJECT DATA (MCP context for project: ' + projectId + ')',
      'Tasks: ' + tasks.length + ' total, ' + completed + ' completed, ' + overdue + ' overdue',
      tasks.slice(0, 20).map(t => '  - [' + (t.status || 'todo') + '] ' + (t.name || t.id) + (t.endDate ? ' (due ' + t.endDate + ')' : '') + (t.critical ? ' [CRITICAL]' : '')).join('\n'),
      'Budget: $' + totalPlanned.toLocaleString() + ' planned, $' + totalActual.toLocaleString() + ' actual',
      budgetLines.slice(0, 10).map(l => '  - ' + (l.name || l.id) + ': $' + (+l.planned || 0).toLocaleString() + ' planned / $' + (+l.actual || 0).toLocaleString() + ' actual').join('\n'),
      'Risks: ' + risks.length + ' total, ' + highRisks + ' high',
      risks.slice(0, 10).map(r => '  - [' + (r.probability || '?') + '/' + (r.impact || '?') + '] ' + (r.description || r.id) + (r.status ? ' (' + r.status + ')' : '')).join('\n'),
      'Issues: ' + issues.length,
      'Meetings: ' + meetings.length,
      'Weather delays: ' + weatherLog.filter(w => +w.delayDays > 0).length + ' days logged',
      '\nTo suggest changes to this project, describe what should change and the user will review it in the Cloud section.',       'Do NOT fabricate data - use only what is shown above. If data is missing, say so.\n'
    ].join('\n');
  } catch (e) {
    return '';
  }
}

export async function handleAiChat(request, env) {
  const read = await readAiBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad) return json({ ok: false, error: 'bad request' }, 400);
  const body = read.body;
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const provider = String(body.provider || '').toLowerCase();
  if (!AI_PROVIDERS[provider]) return json({ ok: false, error: 'unsupported provider' }, 400);
  const reqModel = (typeof body.model === 'string' && GEMINI_MODEL_RE.test(body.model)) ? body.model : null;
  const model = reqModel || AI_PROVIDERS[provider].model;
  const key = String(request.headers.get('X-User-Api-Key') || '').trim()
    || (typeof body.apiKey === 'string' ? String(body.apiKey).trim() : '');
  if (!Array.isArray(body.messages) || !body.messages.length) return json({ ok: false, error: 'bad request' }, 400);

  // MCP: inject project context if mcpProjectId + mcpCode provided
  if (body.mcpProjectId && body.mcpCode) {
    const mcpCtx = await buildMcpContext(env, body.mcpProjectId, body.mcpCode);
    if (mcpCtx) {
      // Prepend MCP context to the system message
      const sysIdx = body.messages.findIndex(function(m) { return m && m.role === 'system'; });
      if (sysIdx >= 0) {
        body.messages[sysIdx] = { role: 'system', content: body.messages[sysIdx].content + mcpCtx };
      } else {
        body.messages.unshift({ role: 'system', content: 'You are an AI assistant for a construction project management app called My MaNaGeR. You have access to the user\'s live project data below.' + mcpCtx });
      }
    }
  }

  // WORKERS-AI-FIRST (Rank 2): if no BYO key and Workers AI binding is
  // available, run inference at the edge — zero external calls, zero API
  // keys in the browser, sub-100ms latency. Falls through to external
  // providers when a key IS provided (user's own endpoint preference).
  if (!key && env && env.AI) {
    try {
      const aiModel = '@cf/meta/llama-3.1-8b-instruct';
      const aiResult = await env.AI.run(aiModel, {
        messages: body.messages.map(function(m) {
          return { role: m.role || 'user', content: m.content || '' };
        })
      });
      const aiText = aiResult && aiResult.response;
      if (aiText) return json({ ok: true, text: String(aiText), model: aiModel, source: 'workers-ai' });
    } catch (e) {
      // Workers AI failed — fall through to external providers
    }
  }

  if (!key) return json({ ok: false, error: 'missing api key' }, 401);
  const ctrl = new AbortController();
  const timer = setTimeout(function() { ctrl.abort(); }, AI_TIMEOUT_MS);
  let upstream;
  try {
    const isGemini = provider === 'google-gemini';
    const isAnthropic = provider === 'anthropic';
    upstream = await fetch(isGemini ? geminiUrl(model) : AI_PROVIDERS[provider].url, {
      method: 'POST',
      headers: isGemini
        ? { 'Content-Type': 'application/json', 'x-goog-api-key': key }
        : isAnthropic
          ? { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
          : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(isGemini ? aiGeminiPayload(body.messages) : isAnthropic ? aiAnthropicPayload(model, body.messages) : { model: model, messages: body.messages }),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    return json({ ok: false, error: 'upstream unreachable or timed out' }, 502);
  }
  clearTimeout(timer);
  if (!upstream.ok) {
    // Provider auth failures surface as 401 so the client clears its session
    // key (STEP-4). The key itself is never echoed anywhere.
    if (upstream.status === 401 || upstream.status === 403) return json({ ok: false, error: 'provider rejected the key' }, 401);
    // GEMINI-MODEL-FALLBACK-LADDER (DIR-3): capacity rejections (429 rate
    // limit / 503 overload) pass through with their own status so the client's
    // model ladder can detect them and retry the NEXT model through this same
    // relay. Everything else collapses to a generic 502.
    if (upstream.status === 429 || upstream.status === 503) return json({ ok: false, error: 'provider rate limited (HTTP ' + upstream.status + ')' }, upstream.status);
    return json({ ok: false, error: 'provider error ' + upstream.status }, 502);
  }
  let data;
  try { data = await upstream.json(); } catch (e) { return json({ ok: false, error: 'bad provider response' }, 502); }
  const text = aiExtractText(provider, data);
  if (!text) return json({ ok: false, error: 'empty provider response' }, 502);
  // Echo the model that actually answered so the client can report it (DIR-4).
  return json({ ok: true, text: String(text), model: model });
}
