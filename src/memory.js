import { all, get, run, now } from './db.js';
import { emit, log } from './events.js';
import { getSettings } from './config.js';

export const MEMORY_KINDS = ['preference', 'person', 'project', 'goal', 'routine', 'fact'];

const STOP = new Set('the a an and or but if then than that this these those with without for from into onto about over under of to in on at by is are was were be been being have has had do does did can could should would will shall may might must not no yes you your yours me my mine i we our ours they them their what which who whom whose when where why how all any each every some such only own same so too very just also please thanks thank tell remind know want need like get make let'.split(' '));

function ftsQuery(text) {
  const words = (String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w));
  const unique = [...new Set(words)].slice(0, 14);
  return unique.length ? unique.map((w) => `"${w}"*`).join(' OR ') : null;
}

const normalizeKind = (k) => (MEMORY_KINDS.includes(k) ? k : 'fact');
const clampImportance = (n) => Math.max(1, Math.min(5, Math.round(Number(n) || 3)));

export function addMemory({ content, kind = 'fact', importance = 3, source = 'user' }) {
  const text = String(content ?? '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('Memory content is empty');
  if (text.length > 1000) throw new Error('Memory is too long — keep it to one or two sentences');
  const existing = get('SELECT * FROM memories WHERE lower(content) = lower(?)', text);
  if (existing) {
    run('UPDATE memories SET importance = max(importance, ?), updated_at = ? WHERE id = ?', clampImportance(importance), now(), existing.id);
    return { ...existing, duplicate: true };
  }
  const t = now();
  const r = run('INSERT INTO memories (kind, content, importance, source, created_at, updated_at) VALUES (?,?,?,?,?,?)', normalizeKind(kind), text, clampImportance(importance), source, t, t);
  const mem = get('SELECT * FROM memories WHERE id = ?', r.lastInsertRowid);
  emit('memory', { action: 'added', memory: mem });
  return mem;
}

export function updateMemory(id, patch) {
  const m = get('SELECT * FROM memories WHERE id = ?', id);
  if (!m) throw new Error(`Memory #${id} not found`);
  run('UPDATE memories SET content = ?, kind = ?, importance = ?, updated_at = ? WHERE id = ?',
    patch.content != null ? String(patch.content).trim() : m.content,
    patch.kind != null ? normalizeKind(patch.kind) : m.kind,
    patch.importance != null ? clampImportance(patch.importance) : m.importance,
    now(), id);
  const updated = get('SELECT * FROM memories WHERE id = ?', id);
  emit('memory', { action: 'updated', memory: updated });
  return updated;
}

export function deleteMemory(id) {
  const m = get('SELECT * FROM memories WHERE id = ?', id);
  if (!m) return false;
  run('DELETE FROM memories WHERE id = ?', id);
  emit('memory', { action: 'deleted', memory: m });
  return true;
}

export function listMemories({ q, kind, limit = 500 } = {}) {
  if (q) {
    const rows = searchMemories(q, limit);
    return kind ? rows.filter((r) => r.kind === kind) : rows;
  }
  if (kind) return all('SELECT * FROM memories WHERE kind = ? ORDER BY importance DESC, updated_at DESC LIMIT ?', kind, limit);
  return all('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?', limit);
}

export function searchMemories(text, limit = 8) {
  const q = ftsQuery(text);
  if (!q) return [];
  try {
    return all(
      `SELECT m.*, bm25(memories_fts) AS score FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
       WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) - (m.importance * 0.3) LIMIT ?`,
      q, limit
    );
  } catch {
    const like = `%${String(text).slice(0, 60)}%`;
    return all('SELECT * FROM memories WHERE content LIKE ? ORDER BY importance DESC LIMIT ?', like, limit);
  }
}

/** Memories for the system prompt: always-on core facts plus whatever matches the message. */
export function relevantMemories(text, limit = 12) {
  const core = all('SELECT * FROM memories WHERE importance >= 4 ORDER BY importance DESC, updated_at DESC LIMIT 8');
  const hits = searchMemories(text, 8);
  const seen = new Set();
  const out = [];
  for (const m of [...core, ...hits]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= limit) break;
  }
  if (out.length) run(`UPDATE memories SET last_used_at = ? WHERE id IN (${out.map(() => '?').join(',')})`, now(), ...out.map((m) => m.id));
  return out;
}

// Only spend a model call on messages where the user tells us something about themselves.
const SIGNAL = /\b(i am|i'm|i've|i have|i work|i live|i like|i love|i hate|i enjoy|i prefer|i usually|i always|i never|i don'?t (like|eat|drink|want)|i can'?t (eat|drink|stand)|we are|we're|we have|our (kids?|family|team|company|house|home)|my (name|wife|husband|partner|son|daughter|kids?|children|mom|mum|dad|mother|father|brother|sister|friend|best friend|boss|manager|team|company|job|role|birthday|anniversary|favou?rite|goal|dog|cat|car|home|address|doctor|gym)|allergic|vegan|vegetarian|call me|remember that)\b/i;

const EXTRACT_SYSTEM = `You maintain a personal assistant's long-term memory about its user.
Read the user's message and extract only DURABLE facts worth remembering for months: preferences, people in their life, their work and projects, goals, routines, important dates, constraints (diet, allergies, accessibility).
Do NOT extract one-off requests, tasks, to-dos, reminders, questions, small talk, or anything about the assistant itself (tasks are stored elsewhere).
Write each memory as one short third-person sentence about the user ("Prefers window seats on trains.").
Respond with JSON only: {"memories":[{"content":"...","kind":"preference|person|project|goal|routine|fact","importance":1-5}]}
Return {"memories":[]} when there is nothing durable.`;

let extracting = Promise.resolve();

/** Background: pull lasting facts out of a user message. Serialised so it never competes
 *  with itself for the GPU. Returns the memories that were added. */
export function extractMemoriesInBackground({ text, model, sessionId }) {
  const s = getSettings();
  if (!s.autoMemory || !text || text.length < 12 || !SIGNAL.test(text)) return;
  extracting = extracting.then(async () => {
    try {
      // Wait until the assistant is idle so this never slows down a conversation.
      const { runningSessions } = await import('./agent.js');
      for (let i = 0; i < 90 && runningSessions().length; i++) await new Promise((r) => setTimeout(r, 2000));
      const { complete } = await import('./llm.js');
      const raw = await complete({ model, system: EXTRACT_SYSTEM, prompt: text.slice(0, 2000), format: 'json', temperature: 0, numCtx: 4096 });
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed?.memories) ? parsed.memories : [];
      for (const item of list.slice(0, 4)) {
        if (!item?.content || String(item.content).length < 6) continue;
        const similar = searchMemories(item.content, 1)[0];
        if (similar && overlap(similar.content, item.content) > 0.7) continue;
        const mem = addMemory({ content: item.content, kind: item.kind, importance: item.importance, source: 'auto' });
        if (!mem.duplicate) emit('notification', { sessionId, level: 'memory', text: `Remembered: ${mem.content}` });
      }
    } catch (err) {
      log('memory', 'extraction skipped:', err.message);
    }
  });
}

function overlap(a, b) {
  const wa = new Set(String(a).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const wb = new Set(String(b).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wb) if (wa.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}
