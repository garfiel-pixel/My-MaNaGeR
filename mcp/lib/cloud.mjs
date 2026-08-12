/* ============================================================
   My MaNaGeR MCP — cloud chat (BYO key, fallback ladder)
   ------------------------------------------------------------
   Port of the app's cloud tier (js/mmgr-net.js PROVIDER_DEFAULTS
   + js/mmgr-ai.js callProviderWithFallback) for the MCP server's
   answer_question fallback. The app routes through the Worker
   relay (/api/ai/chat); this local server calls providers directly
   with a key from the environment (MMGR_MCP_AI_KEY) — the key
   never comes from project files and is never written anywhere.

   Same ladder discipline as the app (DIR-3): advance to the next,
   smaller model ONLY on 429/503 (capacity); 401/403 stops the
   ladder (key is bad); anything else stops it (would mask a real
   config bug). Same grounding system prompt: use ONLY the provided
   project context, never invent facts.
   ============================================================ */

const PROVIDER_DEFAULTS = {
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', fallbackModels: ['gpt-5-mini', 'gpt-5-nano'] },
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-latest', fallbackModels: ['claude-3-5-haiku-latest', 'claude-3-haiku'] },
  'google-gemini': {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    model: 'gemini-flash-latest',
    fallbackModels: ['gemini-flash-lite-latest']
  }
};

export function geminiEndpointFor(modelId) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':generateContent';
}

export function providerCatalog() {
  return Object.keys(PROVIDER_DEFAULTS).map(p => ({ provider: p, model: PROVIDER_DEFAULTS[p].model, fallbackModels: PROVIDER_DEFAULTS[p].fallbackModels }));
}

const CLOUD_SYSTEM_PROMPT =
  'You are an assistant grounded ONLY in the project data provided. Use ONLY that data — never invent dates, amounts, names, or facts. If a requested detail is not present in the data, say "not in data" explicitly. Keep every claim traceable to a line of the provided context.';

function geminiPayload(messages) {
  let system = '';
  const contents = [];
  (messages || []).forEach(function (m) {
    if (m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
    else contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] });
  });
  const p = { contents };
  if (system) p.systemInstruction = { parts: [{ text: system }] };
  return p;
}

function anthropicPayload(model, messages) {
  let system = '';
  const msgs = [];
  (messages || []).forEach(function (m) {
    if (m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
    else msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' });
  });
  const p = { model, max_tokens: 4096, messages: msgs };
  if (system) p.system = system;
  return p;
}

async function fetchJson(url, opts, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 30000);
  try {
    const res = await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

async function openaiAttempt(key, model, messages) {
  const def = PROVIDER_DEFAULTS.openai;
  const { status, ok, body } = await fetchJson(def.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model, messages })
  });
  if (status === 429 || status === 503) { const e = new Error('OpenAI rate limited (HTTP ' + status + ')'); e.status = status; throw e; }
  if (status === 401 || status === 403) { const e = new Error('provider rejected the key'); e.status = 401; throw e; }
  if (!ok) throw new Error('AI endpoint HTTP ' + status);
  const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (!text) throw new Error('empty AI response');
  return String(text);
}

async function anthropicAttempt(key, model, messages) {
  const def = PROVIDER_DEFAULTS.anthropic;
  const { status, ok, body } = await fetchJson(def.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(anthropicPayload(model, messages))
  });
  if (status === 429 || status === 503) { const e = new Error('Anthropic rate limited (HTTP ' + status + ')'); e.status = status; throw e; }
  if (status === 401 || status === 403) { const e = new Error('provider rejected the key'); e.status = 401; throw e; }
  if (!ok) throw new Error('AI endpoint HTTP ' + status);
  const text = (body && Array.isArray(body.content)) ? body.content.map(c => (c && c.type === 'text' && c.text) ? c.text : '').join('') : null;
  if (!text) throw new Error('empty AI response');
  return String(text);
}

async function geminiAttempt(key, model, messages) {
  const { status, ok, body } = await fetchJson(geminiEndpointFor(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(geminiPayload(messages))
  });
  if (status === 429 || status === 503) { const e = new Error('Gemini rate limited (HTTP ' + status + ')'); e.status = status; throw e; }
  if (status === 401 || status === 403) { const e = new Error('provider rejected the key'); e.status = 401; throw e; }
  if (!ok) throw new Error('AI endpoint HTTP ' + status);
  const text = (body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts)
    ? body.candidates[0].content.parts.map(p => p.text || '').join('') : null;
  if (!text) throw new Error('empty AI response');
  return String(text);
}

// The shared fallback ladder (DIR-3 semantics). Returns the text of whichever
// model answered, plus which model that was and whether a fallback fired.
export async function chatWithFallback(provider, key, messages, ctx) {
  const def = PROVIDER_DEFAULTS[provider];
  if (!def) throw new Error('unknown provider "' + provider + '" — use one of: ' + Object.keys(PROVIDER_DEFAULTS).join(', '));
  const models = [def.model].concat(def.fallbackModels || []).filter(Boolean);
  const attempt = provider === 'google-gemini' ? geminiAttempt
    : provider === 'anthropic' ? anthropicAttempt
    : openaiAttempt;
  let lastCapacityErr = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const text = await attempt(key, model, messages);
      return { ok: true, text, model, fellBackFrom: i > 0 ? models[0] : null };
    } catch (e) {
      const status = e && e.status;
      if (status === 429 || status === 503) { lastCapacityErr = e; continue; }
      throw e;
    }
  }
  if (lastCapacityErr) throw lastCapacityErr;
  const e = new Error('all ' + provider + ' models rate-limited or unavailable');
  e.status = 429;
  throw e;
}

// Build the grounding message pair exactly like the app's runCloud.
export function groundingMessages(prompt, context, key) {
  const userContent = (prompt || '') + (context ? '\n\n==== PROJECT CONTEXT (grounding only) ====\n' + String(context).split(key).join('[key removed]') : '');
  return [
    { role: 'system', content: CLOUD_SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ];
}
