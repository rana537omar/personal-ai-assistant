import { all, get, run, now, audit } from './db.js';
import { emit } from './events.js';
import { shortId } from './util/text.js';

/**
 * Human-in-the-loop approvals. When a tool call needs consent, the agent loop awaits
 * requestApproval(); the person can answer from the web UI, the terminal, or the chat app the
 * conversation is happening in (/approve <id>). Unanswered requests expire and count as "no".
 */

const waiters = new Map();
const TIMEOUT_MS = 10 * 60 * 1000;

// Anything left pending from a previous run of the process can never be resumed.
run("UPDATE approvals SET status = 'expired', decided_at = ?, decided_by = 'restart' WHERE status = 'pending'", now());

export function requestApproval({ sessionId, tool, args, summary, signal }) {
  const id = shortId(5);
  const approval = { id, session_id: sessionId, tool, args: JSON.stringify(args ?? {}), summary, status: 'pending', created_at: now() };
  run('INSERT INTO approvals (id, session_id, tool, args, summary, status, created_at) VALUES (?,?,?,?,?,?,?)', id, sessionId, tool, approval.args, summary, 'pending', approval.created_at);
  emit('approval', { sessionId, approval: { ...approval, args: args ?? {} } });
  return new Promise((resolve) => {
    const timer = setTimeout(() => decide(id, 'expired', 'timeout'), TIMEOUT_MS);
    waiters.set(id, { resolve, timer });
    signal?.addEventListener('abort', () => decide(id, 'expired', 'stopped'), { once: true });
  });
}

export function decide(id, decision, by = 'web') {
  const row = get('SELECT * FROM approvals WHERE id = ?', String(id).toLowerCase());
  if (!row) return { ok: false, error: `No approval request "${id}"` };
  if (row.status !== 'pending') return { ok: false, error: `Request ${id} was already ${row.status}` };
  const status = decision === 'approved' || decision === 'approve' ? 'approved' : decision === 'expired' ? 'expired' : 'denied';
  run('UPDATE approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?', status, now(), by, row.id);
  audit({ sessionId: row.session_id, kind: 'approval', name: row.tool, input: row.summary, output: status, status, durationMs: now() - row.created_at });
  const w = waiters.get(row.id);
  if (w) {
    clearTimeout(w.timer);
    waiters.delete(row.id);
    w.resolve(status);
  }
  emit('approval_decided', { sessionId: row.session_id, id: row.id, status, by });
  return { ok: true, status };
}

export function pendingApprovals() {
  return all("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC").map((a) => ({ ...a, args: safeParse(a.args) }));
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
