import { all, get, run, now, json } from './db.js';
import { emit } from './events.js';
import { shortId } from './util/text.js';

export const newSessionId = (prefix = 'web') => `${prefix}-${shortId(8)}`;

export function ensureSession(id, channel = 'web', peer = null) {
  let s = get('SELECT * FROM sessions WHERE id = ?', id);
  if (!s) {
    const t = now();
    run('INSERT INTO sessions (id, channel, peer, title, created_at, updated_at) VALUES (?,?,?,?,?,?)', id, channel, peer, null, t, t);
    s = get('SELECT * FROM sessions WHERE id = ?', id);
    emit('sessions_changed', { sessionId: id });
  }
  return s;
}

export const getSession = (id) => get('SELECT * FROM sessions WHERE id = ?', id);

export function listSessions({ includeJobs = false, limit = 200 } = {}) {
  const rows = all(
    `SELECT s.*, (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role IN ('user','assistant') AND m.tool_calls IS NULL ORDER BY m.id DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.role = 'user') AS user_messages
     FROM sessions s ${includeJobs ? '' : "WHERE s.channel != 'job'"} ORDER BY s.updated_at DESC LIMIT ?`,
    limit
  );
  return rows;
}

export function publicMessage(m) {
  if (!m) return m;
  return { ...m, tool_calls: json(m.tool_calls), images: json(m.images, []), meta: json(m.meta, {}) };
}

export function addMessage(sessionId, { role, content = '', tool_calls, tool_call_id, tool_name, images, meta }) {
  const t = now();
  const r = run(
    'INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, tool_name, images, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    sessionId, role, String(content ?? ''), tool_calls?.length ? JSON.stringify(tool_calls) : null, tool_call_id, tool_name,
    images?.length ? JSON.stringify(images) : null, meta ? JSON.stringify(meta) : null, t
  );
  run('UPDATE sessions SET updated_at = ? WHERE id = ?', t, sessionId);
  return publicMessage(get('SELECT * FROM messages WHERE id = ?', r.lastInsertRowid));
}

export function getMessages(sessionId, { limit = 400 } = {}) {
  return all('SELECT * FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC', sessionId, limit).map(publicMessage);
}

export function renameSession(id, title) {
  run('UPDATE sessions SET title = ? WHERE id = ?', String(title).slice(0, 120), id);
  emit('sessions_changed', { sessionId: id });
}

export function deleteSession(id) {
  run('DELETE FROM sessions WHERE id = ?', id);
  emit('sessions_changed', { sessionId: id, deleted: true });
}

export function autoTitle(sessionId, text) {
  const s = getSession(sessionId);
  if (!s || s.title) return;
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return;
  renameSession(sessionId, clean.length > 48 ? `${clean.slice(0, 46).replace(/\s\S*$/, '')}…` : clean);
}
