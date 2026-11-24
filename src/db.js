import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './paths.js';

export const db = new DatabaseSync(process.env.ASSISTANT_DB || path.join(DATA_DIR, 'assistant.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'web',
  peer TEXT,
  title TEXT,
  summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  images TEXT,
  meta TEXT,
  compacted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  source TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, kind, content='memories', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, kind) VALUES (new.id, new.content, new.kind);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, kind) VALUES ('delete', old.id, old.content, old.kind);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content, kind ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, kind) VALUES ('delete', old.id, old.content, old.kind);
  INSERT INTO memories_fts(rowid, content, kind) VALUES (new.id, new.content, new.kind);
END;

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_at INTEGER,
  priority INTEGER NOT NULL DEFAULT 2,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  prompt TEXT NOT NULL,
  session_id TEXT,
  channel TEXT NOT NULL DEFAULT 'web',
  peer TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  last_output TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT,
  output TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  tool TEXT NOT NULL,
  args TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL,
  name TEXT,
  input TEXT,
  output TEXT,
  status TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);

CREATE TABLE IF NOT EXISTS contacts (
  channel TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  code TEXT,
  chat_id TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  notified_at INTEGER,
  PRIMARY KEY (channel, peer_id)
);
`);

const clean = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export const all = (sql, ...params) => db.prepare(sql).all(...clean(params));
export const get = (sql, ...params) => db.prepare(sql).get(...clean(params));
export const run = (sql, ...params) => db.prepare(sql).run(...clean(params));
export const now = () => Date.now();

export function json(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function audit({ sessionId, kind, name, input, output, status, durationMs }) {
  const clip = (v) => {
    if (v == null) return null;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 4000 ? s.slice(0, 4000) + '…' : s;
  };
  run(
    'INSERT INTO audit (ts, session_id, kind, name, input, output, status, duration_ms) VALUES (?,?,?,?,?,?,?,?)',
    now(), sessionId, kind, name, clip(input), clip(output), status, durationMs
  );
}
