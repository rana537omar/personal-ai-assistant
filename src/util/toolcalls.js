/**
 * Small local models don't always use the structured tool-call channel. They sometimes
 * write the call into their text instead — as <tool_call>{…}</tool_call>, a ```tool / ```json
 * block, or a bare JSON object. This recovers those calls so the agent loop still works,
 * and it is also the protocol used for models with no native tool support at all.
 *
 * Models also tend to keep writing after the call and invent its result ("The museum opens
 * at 10…"). Everything from the first call onward is dropped from the visible text: the real
 * result hasn't happened yet.
 */

function normalize(obj, toolNames) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const fn = obj.function && typeof obj.function === 'object' ? obj.function : obj;
  const name = fn.name || fn.tool || fn.tool_name;
  if (typeof name !== 'string' || !toolNames.has(name)) return null;
  let args = fn.arguments ?? fn.args ?? fn.parameters ?? fn.input ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  return { name, args: args && typeof args === 'object' ? args : {} };
}

/** Extracts the balanced {...} or [...] JSON value starting at index i. */
function balanced(s, i) {
  const open = s[i];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(i, j + 1);
    }
  }
  return null;
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function callsFrom(raw, names) {
  const parsed = tryParse(raw);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((item) => normalize(item, names)).filter(Boolean);
}

export function parseTextToolCalls(content, toolNames) {
  const names = toolNames instanceof Set ? toolNames : new Set(toolNames);
  const text = String(content ?? '');
  const calls = [];
  let cutAt = -1;
  const found = (index, list) => {
    if (!list.length) return;
    calls.push(...list);
    if (cutAt < 0 || index < cutAt) cutAt = index;
  };

  // 1) Tagged and fenced forms
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) found(m.index, callsFrom(m[1], names));
  for (const m of text.matchAll(/```(?:tool|json|tool_code|tool_call)?[ \t]*\r?\n?\s*([\[{][\s\S]*?[\]}])\s*```/g)) found(m.index, callsFrom(m[1], names));

  // 2) Bare JSON objects (or an array of them), possibly after a short preamble
  if (!calls.length) {
    const start = text.search(/[\[{]\s*\{?\s*"(name|tool|function)"\s*:/);
    if (start >= 0) {
      let pos = start;
      while (pos < text.length) {
        const raw = balanced(text, pos);
        const list = raw ? callsFrom(raw, names) : [];
        if (!list.length) break;
        found(start, list);
        const rest = text.slice(pos + raw.length);
        const next = rest.search(/\S/);
        if (next < 0 || (rest[next] !== '{' && rest[next] !== '[')) break;
        pos += raw.length + next;
      }
    }
  }

  const visible = calls.length ? text.slice(0, cutAt) : text;
  return { calls, text: visible.replace(/<\/?tool_call>/g, '').trim(), unknown: calls.length ? [] : unknownCalls(text) };
}

/** Names from tool-call-shaped JSON whose tool doesn't exist (e.g. a skill called like a tool). */
function unknownCalls(text) {
  const names = [];
  for (const m of text.matchAll(/\{\s*"(?:name|tool)"\s*:\s*"([^"]+)"\s*,\s*"(?:arguments|args|parameters)"\s*:/g)) names.push(m[1]);
  return names;
}
