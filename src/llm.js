import { getSettings } from './config.js';

/**
 * Model providers. Default is Ollama on this machine. "openai" means any server that speaks
 * the OpenAI-compatible chat-completions protocol — LM Studio, llama.cpp server, vLLM, LocalAI —
 * so everything can stay local.
 *
 * Internal message shape:
 *   { role: 'system'|'user'|'assistant'|'tool', content, images?: [base64], tool_calls?: [{id,name,args}], tool_call_id?, name? }
 */

const capsCache = new Map();

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(opts.timeout || 15000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function openaiHeaders(s) {
  const h = { 'Content-Type': 'application/json' };
  if (s.openaiApiKey) h.Authorization = `Bearer ${s.openaiApiKey}`;
  return h;
}

export async function modelCapabilities(name) {
  const s = getSettings();
  if (s.provider === 'openai') return ['completion', 'tools', ...(s.visionModel === name ? ['vision'] : [])];
  const key = `${s.ollamaUrl}|${name}`;
  if (capsCache.has(key)) return capsCache.get(key);
  let caps = ['completion'];
  try {
    const j = await fetchJson(`${s.ollamaUrl}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }) });
    if (Array.isArray(j.capabilities)) caps = j.capabilities;
  } catch {
    /* older Ollama: assume completion only */
  }
  capsCache.set(key, caps);
  return caps;
}

export async function listModels() {
  const s = getSettings();
  if (s.provider === 'openai') {
    const j = await fetchJson(`${s.openaiBaseUrl.replace(/\/$/, '')}/models`, { headers: openaiHeaders(s) });
    return (j.data || []).map((m) => ({ name: m.id, size: null, params: null, capabilities: ['completion', 'tools'] }));
  }
  const tags = await fetchJson(`${s.ollamaUrl}/api/tags`, { timeout: 5000 });
  const models = [];
  for (const m of tags.models || []) {
    models.push({
      name: m.name,
      size: m.size,
      params: m.details?.parameter_size || null,
      family: m.details?.family || null,
      capabilities: await modelCapabilities(m.name),
    });
  }
  return models;
}

const CHAT_PREFERENCE = [/qwen3/i, /gpt-oss/i, /qwen2\.5(?!-coder)/i, /llama3\.[123]/i, /mistral|ministral/i, /granite/i, /command-r/i, /qwen2\.5-coder/i, /./];
const MAX_AUTO_SIZE = 9e9; // keep auto-picks to models that run on an ordinary laptop GPU

function pickChatModel(models) {
  const usable = models.filter((m) => !m.capabilities.includes('embedding'));
  const tools = usable.filter((m) => m.capabilities.includes('tools'));
  const pool = tools.length ? tools : usable;
  for (const re of CHAT_PREFERENCE) {
    const hits = pool.filter((m) => re.test(m.name));
    if (!hits.length) continue;
    const fitting = hits.filter((m) => !m.size || m.size <= MAX_AUTO_SIZE).sort((a, b) => (b.size || 0) - (a.size || 0));
    return fitting[0] || hits.sort((a, b) => (a.size || 0) - (b.size || 0))[0];
  }
  return pool[0];
}

/** Which models to use right now, honouring settings and falling back to sensible auto-picks. */
export async function resolveModels() {
  const s = getSettings();
  if (s.provider === 'openai') {
    if (!s.model) throw new Error('No model selected. Open Settings → Model and choose one from your OpenAI-compatible server.');
    return { chat: s.model, chatCaps: ['completion', 'tools'], vision: s.visionModel || null, visionCaps: ['vision'] };
  }
  let models;
  try {
    models = await listModels();
  } catch (err) {
    throw new Error(`Can't reach Ollama at ${s.ollamaUrl} — is it running? Start it with "ollama serve". (${err.message})`);
  }
  if (!models.length) throw new Error('No local models installed yet. Install one with: ollama pull qwen3:8b  (or llama3.2:3b on smaller machines)');
  const chat = (s.model && models.find((m) => m.name === s.model)) || pickChatModel(models);
  const vision = (s.visionModel && models.find((m) => m.name === s.visionModel)) || (chat.capabilities.includes('vision') ? chat : models.find((m) => m.capabilities.includes('vision')));
  return { chat: chat.name, chatCaps: chat.capabilities, vision: vision?.name || null, visionCaps: vision?.capabilities || [] };
}

async function* readLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
  if (buf.trim()) yield buf;
}

function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  try {
    return JSON.parse(a || '{}');
  } catch {
    return {};
  }
}

let callSeq = 0;
const newCallId = () => `call_${Date.now().toString(36)}_${(callSeq++).toString(36)}`;

function toolSpec(tools) {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

async function chatOllama({ model, messages, tools, onDelta, signal, format, temperature, numCtx }) {
  const s = getSettings();
  const body = {
    model,
    stream: true,
    keep_alive: '30m',
    messages: messages.map((m) => {
      const out = { role: m.role, content: m.content || '' };
      if (m.images?.length) out.images = m.images;
      if (m.tool_calls?.length) out.tool_calls = m.tool_calls.map((c) => ({ function: { name: c.name, arguments: c.args || {} } }));
      if (m.role === 'tool') out.tool_name = m.name;
      return out;
    }),
    options: { temperature: temperature ?? s.temperature, num_ctx: numCtx || s.contextWindow },
  };
  if (tools?.length) body.tools = toolSpec(tools);
  if (format) body.format = format;

  const res = await fetch(`${s.ollamaUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      msg = JSON.parse(t).error || t;
    } catch {
      /* raw */
    }
    if (/does not support tools/i.test(msg)) {
      const err = new Error(msg);
      err.code = 'NO_TOOLS';
      throw err;
    }
    throw new Error(`Ollama error ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  let content = '';
  const toolCalls = [];
  let stats = null;
  for await (const line of readLines(res.body)) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.error) throw new Error(j.error);
    const m = j.message || {};
    if (m.content) {
      content += m.content;
      onDelta?.(m.content);
    }
    for (const tc of m.tool_calls || []) toolCalls.push({ id: newCallId(), name: tc.function?.name, args: parseArgs(tc.function?.arguments) });
    if (j.done) stats = { promptTokens: j.prompt_eval_count, outputTokens: j.eval_count, ms: Math.round((j.total_duration || 0) / 1e6) };
  }
  return { content, toolCalls, stats };
}

async function chatOpenAI({ model, messages, tools, onDelta, signal, format, temperature }) {
  const s = getSettings();
  const body = {
    model,
    stream: true,
    temperature: temperature ?? s.temperature,
    messages: messages.map((m) => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content || '' };
      if (m.role === 'assistant' && m.tool_calls?.length) {
        return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) };
      }
      if (m.images?.length) {
        return { role: m.role, content: [{ type: 'text', text: m.content || '' }, ...m.images.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }))] };
      }
      return { role: m.role, content: m.content || '' };
    }),
  };
  if (tools?.length) body.tools = toolSpec(tools);
  if (format === 'json') body.response_format = { type: 'json_object' };

  const res = await fetch(`${s.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: openaiHeaders(s), body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`Model server error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let content = '';
  const partial = new Map();
  for await (const line of readLines(res.body)) {
    const l = line.trim();
    if (!l.startsWith('data:')) continue;
    const data = l.slice(5).trim();
    if (data === '[DONE]') break;
    const j = JSON.parse(data);
    const delta = j.choices?.[0]?.delta || {};
    if (delta.content) {
      content += delta.content;
      onDelta?.(delta.content);
    }
    for (const tc of delta.tool_calls || []) {
      const cur = partial.get(tc.index) || { id: tc.id, name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      partial.set(tc.index, cur);
    }
  }
  const toolCalls = [...partial.values()].map((c) => ({ id: c.id || newCallId(), name: c.name, args: parseArgs(c.args) }));
  return { content, toolCalls, stats: null };
}

export async function chat(opts) {
  const s = getSettings();
  return s.provider === 'openai' ? chatOpenAI(opts) : chatOllama(opts);
}

/** One-shot completion that returns plain text (used for summaries, memory extraction, vision). */
export async function complete({ model, system, prompt, images, format, signal, temperature = 0.2, numCtx }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt, images });
  const r = await chat({ model, messages, format, signal, temperature, numCtx });
  return r.content.trim();
}

export async function providerStatus() {
  const s = getSettings();
  try {
    const models = await listModels();
    let resolved = null;
    try {
      resolved = await resolveModels();
    } catch {
      /* no usable model */
    }
    return { ok: true, provider: s.provider, url: s.provider === 'openai' ? s.openaiBaseUrl : s.ollamaUrl, models, resolved };
  } catch (err) {
    return { ok: false, provider: s.provider, url: s.provider === 'openai' ? s.openaiBaseUrl : s.ollamaUrl, error: err.message, models: [] };
  }
}
