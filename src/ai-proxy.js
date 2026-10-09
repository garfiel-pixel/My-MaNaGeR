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
import { json, readSession } from './lib/http.js';
import { billingStatusActive } from './billing.js';

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
  'google-gemini': {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    model: 'gemini-flash-latest'
  }
};
// Strict model-id validation: the value is interpolated into the upstream URL
// path, so it must be a plain Gemini model id (letters/digits/dash/dot/underscore
// only , no slashes/colons/query): path-injection guard. Invalid -> default.
const GEMINI_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function geminiUrl(model) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
}
const AI_BODY_LIMIT_BYTES = 262144; // 256 KB max request body
const AI_TIMEOUT_MS = 30000; // hard upstream timeout

/* ---- Managed free pool (owner 2026-10-08) ---------------------------------
   The free section runs on the OWNER'S OWN Google keys, held as Worker
   secrets GEMINI_KEY_1..4 - never in the browser, never in D1, never echoed
   in a response (the relay still handles user-supplied keys unchanged).
   This is the LAST rung before the capacity message, and it only fires when
   there is no user key and the free Workers AI binding did not answer:

     user's own key  ->  Workers AI  ->  this pool  ->  capacity message

   Free accounts get FREE_DAILY_MESSAGE_CAP messages per 24-hour window,
   counted in KV (env.KV, the binding that already exists - no migration).
   Accounts with an active subscription are not capped.
   The SMALLEST model is used on this rung, and the client's requested model
   is deliberately ignored: a free key's most generous allowance is on the
   lite model, so stepping up would burn the pool faster for no benefit. */
const FREE_POOL_SLOTS = 4;
const FREE_POOL_MODEL = 'gemini-flash-lite-latest';
const FREE_DAILY_MESSAGE_CAP = 10;
const FREE_QUOTA_TTL_S = 86400; // the window resets 24h after a key's own reset
const FREE_QUOTA_PREFIX = 'aifree:';
// Status for "out of free messages" - deliberately NOT 429/503, which the
// client's model ladder reads as "advance to the next model" and would turn
// one exhausted quota into a burst of retries.
const FREE_QUOTA_STATUS = 402;

// Reads the pool in slot order, skipping any slot the operator never set, so
// 1 to 4 keys all work and adding a 5th is a constant + a secret.
function freePoolKeys(env) {
  const keys = [];
  for (let i = 1; i <= FREE_POOL_SLOTS; i++) {
    const v = env ? env['GEMINI_KEY_' + i] : null;
    if (typeof v === 'string' && v.trim()) keys.push(v.trim());
  }
  return keys;
}

// Is this account paying? D1 unreadable -> treated as free, because the cap's
// whole job is to protect a finite pool of free keys: the safe failure is
// "capped", never "uncapped".
async function poolIsPaid(env, sub) {
  if (!env || !env.DB || !sub) return false;
  try {
    const row = await env.DB.prepare('SELECT status FROM cloud_subscriptions WHERE owner_sub = ?')
      .bind(sub)
      .first();
    return !!(row && billingStatusActive(row.status));
  } catch (e) {
    return false;
  }
}

// KV is best-effort the other way: a cache fault must never take the free AI
// down, so an unreadable or missing counter means "allow" (0 used).
async function freeQuotaUsed(env, sub) {
  if (!env || !env.KV || !sub) return 0;
  try {
    const n = parseInt(await env.KV.get(FREE_QUOTA_PREFIX + sub), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

async function freeQuotaBump(env, sub, used) {
  if (!env || !env.KV || !sub) return;
  try {
    await env.KV.put(FREE_QUOTA_PREFIX + sub, String(used + 1), {
      expirationTtl: FREE_QUOTA_TTL_S
    });
  } catch (e) {
    /* best-effort accounting; never block an answer on it */
  }
}

// One attempt per key, in slot order. A key that is rate-limited, out of
// quota, revoked or simply wrong costs ONE attempt, so a dead key can never
// take the whole rung down with it.
async function poolAttempt(keys, messages) {
  for (let i = 0; i < keys.length; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, AI_TIMEOUT_MS);
    try {
      const res = await fetch(geminiUrl(FREE_POOL_MODEL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[i] },
        body: JSON.stringify(aiGeminiPayload(messages)),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue; // 429 / 503 / 401 / 403 -> next key
      const data = await res.json();
      const text = aiExtractText('google-gemini', data);
      if (text) return { text: String(text) };
    } catch (e) {
      clearTimeout(timer);
      // network error or timeout: next key
    }
  }
  return null;
}

// OpenAI-style [{role,content}] -> Gemini generateContent payload.
function aiGeminiPayload(messages) {
  let system = '';
  const contents = [];
  (messages || []).forEach(function (m) {
    if (m && m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
    else if (m && m.content)
      contents.push({
        role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
  });
  const p = { contents: contents };
  if (system) p.systemInstruction = { parts: [{ text: system }] };
  return p;
}

function aiExtractText(provider, data) {
  if (provider === 'google-gemini') {
    return data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts
      ? data.candidates[0].content.parts
          .map(function (p) {
            return p.text || '';
          })
          .join('')
      : null;
  }
  if (provider === 'anthropic') {
    return data && Array.isArray(data.content)
      ? data.content
          .map(function (c) {
            return c && c.type === 'text' && c.text ? c.text : '';
          })
          .join('')
      : null;
  }
  return (
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
  );
}

// OpenAI-style [{role,content}] -> Anthropic Messages API payload (mirror of
// mmgr-ai.js anthropicPayload): system split out, max_tokens required.
function aiAnthropicPayload(model, messages) {
  let system = '';
  const msgs = [];
  (messages || []).forEach(function (m) {
    if (m && m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
    else if (m && m.content)
      msgs.push({
        role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
        content: m.content
      });
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
    try {
      return { body: await request.json() };
    } catch (e) {
      return { bad: true };
    }
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
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return { body: JSON.parse(text) };
  } catch (e) {
    return { bad: true };
  }
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
    )
      .bind(projectId)
      .first();
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
    const overdue = tasks.filter(
      t => t.status !== 'completed' && t.endDate && new Date(t.endDate) < new Date()
    ).length;
    const highRisks = risks.filter(
      r => /high/i.test(r.probability || '') && /high/i.test(r.impact || '')
    ).length;
    return [
      '\n## PROJECT DATA (MCP context for project: ' + projectId + ')',
      'Tasks: ' + tasks.length + ' total, ' + completed + ' completed, ' + overdue + ' overdue',
      tasks
        .slice(0, 20)
        .map(
          t =>
            '  - [' +
            (t.status || 'todo') +
            '] ' +
            (t.name || t.id) +
            (t.endDate ? ' (due ' + t.endDate + ')' : '') +
            (t.critical ? ' [CRITICAL]' : '')
        )
        .join('\n'),
      'Budget: $' +
        totalPlanned.toLocaleString() +
        ' planned, $' +
        totalActual.toLocaleString() +
        ' actual',
      budgetLines
        .slice(0, 10)
        .map(
          l =>
            '  - ' +
            (l.name || l.id) +
            ': $' +
            (+l.planned || 0).toLocaleString() +
            ' planned / $' +
            (+l.actual || 0).toLocaleString() +
            ' actual'
        )
        .join('\n'),
      'Risks: ' + risks.length + ' total, ' + highRisks + ' high',
      risks
        .slice(0, 10)
        .map(
          r =>
            '  - [' +
            (r.probability || '?') +
            '/' +
            (r.impact || '?') +
            '] ' +
            (r.description || r.id) +
            (r.status ? ' (' + r.status + ')' : '')
        )
        .join('\n'),
      'Issues: ' + issues.length,
      'Meetings: ' + meetings.length,
      'Weather delays: ' + weatherLog.filter(w => +w.delayDays > 0).length + ' days logged',
      '\nTo suggest changes to this project, describe what should change and the user will review it in the Cloud section.',
      'Do NOT fabricate data - use only what is shown above. If data is missing, say so.\n'
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
  const reqModel =
    typeof body.model === 'string' && GEMINI_MODEL_RE.test(body.model) ? body.model : null;
  const model = reqModel || AI_PROVIDERS[provider].model;
  const key =
    String(request.headers.get('X-User-Api-Key') || '').trim() ||
    (typeof body.apiKey === 'string' ? String(body.apiKey).trim() : '');
  if (!Array.isArray(body.messages) || !body.messages.length)
    return json({ ok: false, error: 'bad request' }, 400);

  // MCP: inject project context if mcpProjectId + mcpCode provided
  if (body.mcpProjectId && body.mcpCode) {
    const mcpCtx = await buildMcpContext(env, body.mcpProjectId, body.mcpCode);
    if (mcpCtx) {
      // Prepend MCP context to the system message
      const sysIdx = body.messages.findIndex(function (m) {
        return m && m.role === 'system';
      });
      if (sysIdx >= 0) {
        body.messages[sysIdx] = { role: 'system', content: body.messages[sysIdx].content + mcpCtx };
      } else {
        body.messages.unshift({
          role: 'system',
          content:
            "You are an AI assistant for a construction project management app called My MaNaGeR. You have access to the user's live project data below." +
            mcpCtx
        });
      }
    }
  }

  // FREE-POOL rung (owner 2026-10-08). Plan A1 order, and the order matters:
  //   user key (BYO) -> THIS POOL -> Workers AI binding -> capacity message.
  // The pool is the free section's own engine, so it answers BEFORE the
  // Workers AI binding; Workers AI is the safety net for when the pool cannot
  // serve at all (no keys configured, every key throttled or revoked), and the
  // plain capacity message is the last rung. Signed-in only: the daily cap is
  // per account and there is no account to count against otherwise.
  if (!key) {
    const session = await readSession(request, env);
    const pool = freePoolKeys(env);
    if (session && session.sub && pool.length) {
      const paid = await poolIsPaid(env, session.sub);
      const used = paid ? 0 : await freeQuotaUsed(env, session.sub);
      if (!paid && used >= FREE_DAILY_MESSAGE_CAP) {
        return json(
          {
            ok: false,
            error:
              'You have used all ' +
              FREE_DAILY_MESSAGE_CAP +
              ' free AI messages for today. They reset 24 hours after your first one, or connect your own AI key in the AI window (Settings, AI Engine) for unlimited questions.',
            tier: 'free-pool',
            remaining: 0
          },
          FREE_QUOTA_STATUS
        );
      }
      const poolOut = await poolAttempt(pool, body.messages);
      if (poolOut) {
        if (!paid) await freeQuotaBump(env, session.sub, used);
        return json({
          ok: true,
          text: poolOut.text,
          model: FREE_POOL_MODEL,
          source: 'free-pool',
          remaining: paid ? null : Math.max(0, FREE_DAILY_MESSAGE_CAP - used - 1)
        });
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
        messages: body.messages.map(function (m) {
          return { role: m.role || 'user', content: m.content || '' };
        })
      });
      const aiText = aiResult && aiResult.response;
      if (aiText)
        return json({ ok: true, text: String(aiText), model: aiModel, source: 'workers-ai' });
    } catch (e) {
      // Workers AI failed — fall through to external providers
    }
  }

  if (!key) {
    // OWNER 2026-09-16: the Workers-AI no-key path used to fall through to
    // 'missing api key' when the free binding was exhausted or errored - a
    // flat-out wrong message that sent owners hunting for a key they never
    // needed. Say what actually happened.
    return json(
      {
        ok: false,
        error:
          'The built-in free AI is at capacity right now - try again in a few minutes, or connect your own AI key in the AI window (Settings, AI Engine).',
        tier: 'workers-ai'
      },
      503
    );
  }

  const ctrl = new AbortController();
  const timer = setTimeout(function () {
    ctrl.abort();
  }, AI_TIMEOUT_MS);
  let upstream;
  try {
    const isGemini = provider === 'google-gemini';
    const isAnthropic = provider === 'anthropic';
    upstream = await fetch(isGemini ? geminiUrl(model) : AI_PROVIDERS[provider].url, {
      method: 'POST',
      headers: isGemini
        ? { 'Content-Type': 'application/json', 'x-goog-api-key': key }
        : isAnthropic
          ? {
              'Content-Type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01'
            }
          : { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(
        isGemini
          ? aiGeminiPayload(body.messages)
          : isAnthropic
            ? aiAnthropicPayload(model, body.messages)
            : { model: model, messages: body.messages }
      ),
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
    if (upstream.status === 401 || upstream.status === 403)
      return json({ ok: false, error: 'provider rejected the key' }, 401);
    // GEMINI-MODEL-FALLBACK-LADDER (DIR-3): capacity rejections (429 rate
    // limit / 503 overload) pass through with their own status so the client's
    // model ladder can detect them and retry the NEXT model through this same
    // relay. Everything else collapses to a generic 502.
    if (upstream.status === 429 || upstream.status === 503)
      return json(
        { ok: false, error: 'provider rate limited (HTTP ' + upstream.status + ')' },
        upstream.status
      );
    return json({ ok: false, error: 'provider error ' + upstream.status }, 502);
  }
  let data;
  try {
    data = await upstream.json();
  } catch (e) {
    return json({ ok: false, error: 'bad provider response' }, 502);
  }
  const text = aiExtractText(provider, data);
  if (!text) return json({ ok: false, error: 'empty provider response' }, 502);
  // Echo the model that actually answered so the client can report it (DIR-4).
  return json({ ok: true, text: String(text), model: model });
}
