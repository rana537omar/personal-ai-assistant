import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PUBLIC_DIR, ROOT } from './paths.js';
import { all, get, run, now } from './db.js';
import { bus, emit, log } from './events.js';
import { getSettings, setSettings, publicSettings, stripMasked, CHANNEL_DEFAULTS } from './config.js';
import { providerStatus } from './llm.js';
import { runTurn, stopRun, runningSessions, isRunning } from './agent.js';
import { decide, pendingApprovals } from './approvals.js';
import { listSessions, getSession, getMessages, renameSession, deleteSession, ensureSession, newSessionId } from './sessions.js';
import { listMemories, addMemory, updateMemory, deleteMemory } from './memory.js';
import { allSkills, getSkill, saveSkill, createSkill, deleteSkill } from './skills.js';
import { listJobs, createJob, updateJob, deleteJob, jobRuns, getJob } from './jobs.js';
import { startScheduler, runJob } from './scheduler.js';
import { startChannels, startChannel, channelStatus, getChannel, setContactStatus, removeContact, CHANNEL_INFO } from './channels/index.js';
import { parseWhen, formatWhen } from './util/schedule.js';
import { resolvePath } from './util/sandbox.js';
import { browserStatus, findBrowser } from './tools/browser.js';
import { enabledTools, ALL_TOOLS } from './tools/index.js';

const PORT = Number(process.env.PORT || 6100);
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const isText = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isText ? body : JSON.stringify(body));
}

const xml = (res, body) => send(res, 200, body, { 'Content-Type': 'text/xml; charset=utf-8' });

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isLocal(req) {
  const addr = req.socket.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  // Tunnels (ngrok, cloudflared…) connect from localhost but add forwarding headers — treat those as remote.
  const forwarded = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers.forwarded;
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return loopback && !forwarded && ['localhost', '127.0.0.1', '::1'].includes(host);
}

function tokenOk(req) {
  const expected = getSettings().accessToken;
  const auth = String(req.headers.authorization || '');
  const cookie = String(req.headers.cookie || '').match(/(?:^|;\s*)pa_token=([^;]+)/)?.[1];
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : cookie ? decodeURIComponent(cookie) : '';
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicBase(req) {
  const s = getSettings();
  if (s.publicUrl) return s.publicUrl.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || (isLocal(req) ? 'http' : 'https');
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

const IMAGE_SIG = [['/9j/', 'image/jpeg'], ['iVBOR', 'image/png'], ['R0lG', 'image/gif'], ['UklG', 'image/webp']];
const imageMime = (b64) => IMAGE_SIG.find(([sig]) => b64.startsWith(sig))?.[1] || 'image/jpeg';

/** Messages go to the browser without inline base64 images (they're fetched by URL instead). */
function slim(m) {
  if (!m) return m;
  const imgs = Array.isArray(m.images) ? m.images : [];
  return { ...m, images: imgs.map((_, i) => `/api/messages/${m.id}/images/${i}`) };
}

function slimEvent(e) {
  if (e.message) return { ...e, message: slim(e.message) };
  return e;
}

// ---------------------------------------------------------------- router

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')).replace(/\*$/, '(.*)')}$`);
  if (pattern.endsWith('*')) keys.push('rest');
  routes.push({ method, re, keys, handler });
};

// ---------- status & settings

route('GET', '/api/health', () => ({ ok: true, version: VERSION }));

let providerCache = { at: 0, value: null };
async function cachedProvider(force = false) {
  if (force || !providerCache.value || Date.now() - providerCache.at > 15000) providerCache = { at: Date.now(), value: await providerStatus() };
  return providerCache.value;
}

route('GET', '/api/state', async (req, url) => ({
  version: VERSION,
  settings: publicSettings(),
  provider: await cachedProvider(url.searchParams.has('refresh')),
  channels: channelStatus(),
  approvals: pendingApprovals(),
  running: runningSessions(),
  browser: { ...browserStatus(), found: findBrowser(getSettings().browserPath) },
  tools: ALL_TOOLS.map((t) => ({ name: t.name, group: t.group, description: t.description })),
  platform: process.platform,
}));

route('GET', '/api/settings', () => publicSettings());
route('PUT', '/api/settings', (req, url, body) => {
  const patch = stripMasked(body || {});
  delete patch.accessToken;
  delete patch.channels;
  if (patch.permissionMode && !['ask', 'auto', 'readonly'].includes(patch.permissionMode)) throw new HttpError(400, 'Unknown permission mode');
  for (const k of ['contextWindow', 'maxToolSteps', 'historyMessages', 'shellTimeoutSec', 'temperature']) if (k in patch) patch[k] = Number(patch[k]);
  setSettings(patch);
  providerCache.at = 0;
  emit('settings_changed', {});
  return publicSettings();
});
route('POST', '/api/settings/token', () => {
  setSettings({ accessToken: crypto.randomBytes(24).toString('base64url') });
  return { accessToken: getSettings().accessToken };
});
route('GET', '/api/models', async () => cachedProvider(true));

route('POST', '/api/onboard', (req, url, b) => {
  const patch = {
    onboarded: true,
    assistantName: String(b.assistantName || 'Assistant').trim().slice(0, 40) || 'Assistant',
    userName: String(b.userName || '').trim().slice(0, 60),
    aboutUser: String(b.aboutUser || '').trim().slice(0, 3000),
  };
  if (b.persona) patch.persona = String(b.persona).slice(0, 600);
  if (['ask', 'auto', 'readonly'].includes(b.permissionMode)) patch.permissionMode = b.permissionMode;
  if (b.model !== undefined) patch.model = b.model;
  if (b.visionModel !== undefined) patch.visionModel = b.visionModel;
  setSettings(patch);
  for (const fact of (b.facts || []).slice(0, 10)) if (String(fact).trim()) addMemory({ content: fact, kind: 'fact', importance: 4, source: 'user' });
  if (b.dailyBriefing?.enabled) {
    try {
      createJob({ name: 'Morning briefing', when: `every day at ${b.dailyBriefing.time || '8:00'}`, prompt: 'Give me my morning briefing — use the daily-briefing skill.', channel: 'web' });
    } catch (err) {
      log('onboard', err.message);
    }
  }
  emit('settings_changed', {});
  return { ok: true, settings: publicSettings() };
});

// ---------- sessions & chat

route('GET', '/api/sessions', (req, url) => listSessions({ includeJobs: url.searchParams.get('jobs') === '1' }).map((s) => ({ ...s, running: isRunning(s.id) })));
route('POST', '/api/sessions', (req, url, b) => {
  const id = newSessionId(b?.channel === 'cli' ? 'cli' : 'web');
  ensureSession(id, b?.channel === 'cli' ? 'cli' : 'web', null);
  return getSession(id);
});
route('GET', '/api/sessions/:id', (req, url, b, p) => {
  const session = getSession(p.id);
  if (!session) throw new HttpError(404, 'No such conversation');
  return { session, messages: getMessages(p.id).map(slim), running: isRunning(p.id) };
});
route('PATCH', '/api/sessions/:id', (req, url, b, p) => {
  if (b.title) renameSession(p.id, b.title);
  return getSession(p.id);
});
route('DELETE', '/api/sessions/:id', (req, url, b, p) => {
  stopRun(p.id);
  deleteSession(p.id);
  return { ok: true };
});
route('GET', '/api/messages/:id/images/:n', (req, url, b, p, res) => {
  const m = get('SELECT images FROM messages WHERE id = ?', Number(p.id));
  const list = m?.images ? JSON.parse(m.images) : [];
  const b64 = list[Number(p.n)];
  if (!b64) throw new HttpError(404, 'No image');
  res.writeHead(200, { 'Content-Type': imageMime(b64), 'Cache-Control': 'private, max-age=86400' });
  res.end(Buffer.from(b64, 'base64'));
});

route('POST', '/api/chat', (req, url, b) => {
  const text = String(b.text || '').trim();
  const images = Array.isArray(b.images) ? b.images.slice(0, 4) : [];
  if (!text && !images.length) throw new HttpError(400, 'Say something first');
  let sessionId = b.sessionId;
  if (!sessionId || !getSession(sessionId)) {
    sessionId = sessionId && /^[\w:.-]{3,80}$/.test(sessionId) ? sessionId : newSessionId(b.channel === 'cli' ? 'cli' : 'web');
    ensureSession(sessionId, b.channel === 'cli' ? 'cli' : 'web', null);
  }
  const session = getSession(sessionId);
  const surface = b.channel === 'cli' ? 'cli' : session.channel === 'job' ? 'web' : ['web', 'cli'].includes(session.channel) ? session.channel : 'web';
  runTurn({ sessionId, text, images, channel: ['web', 'cli'].includes(session.channel) ? session.channel : 'web', surface }).catch((err) => log('chat', err.message));
  return { ok: true, sessionId };
});
route('POST', '/api/chat/stop', (req, url, b) => ({ ok: stopRun(b.sessionId) }));

// Synchronous HTTP API for scripts, shortcuts and home automations (needs the access token when remote).
route('POST', '/api/v1/message', async (req, url, b) => {
  const text = String(b.text || '').trim();
  if (!text) throw new HttpError(400, '"text" is required');
  const sessionId = /^[\w:.-]{3,80}$/.test(b.sessionId || '') ? b.sessionId : 'api-default';
  ensureSession(sessionId, 'api', null);
  const r = await runTurn({ sessionId, text, images: b.images || [], channel: 'api', surface: 'api' });
  return { reply: r.text, sessionId, error: r.error || false };
});

// ---------- approvals

route('GET', '/api/approvals', () => pendingApprovals());
route('POST', '/api/approvals/:id', (req, url, b, p) => {
  const r = decide(p.id, b.decision === 'approve' || b.decision === 'approved' ? 'approved' : 'denied', 'web');
  if (!r.ok) throw new HttpError(409, r.error);
  return r;
});

// ---------- memory & to-dos

route('GET', '/api/memories', (req, url) => listMemories({ q: url.searchParams.get('q') || '', kind: url.searchParams.get('kind') || '' }));
route('POST', '/api/memories', (req, url, b) => addMemory({ content: b.content, kind: b.kind, importance: b.importance, source: 'user' }));
route('PATCH', '/api/memories/:id', (req, url, b, p) => updateMemory(Number(p.id), b));
route('DELETE', '/api/memories/:id', (req, url, b, p) => ({ ok: deleteMemory(Number(p.id)) }));

route('GET', '/api/todos', () => all('SELECT * FROM todos ORDER BY done, due_at IS NULL, due_at, priority, id DESC LIMIT 300'));
route('POST', '/api/todos', (req, url, b) => {
  const title = String(b.title || '').trim();
  if (!title) throw new HttpError(400, 'Title is required');
  let due = null;
  if (b.due) {
    const p = parseWhen(b.due);
    if (!p) throw new HttpError(400, `Couldn't understand "${b.due}"`);
    due = p.nextRun;
  }
  const r = run('INSERT INTO todos (title, notes, due_at, priority, created_at) VALUES (?,?,?,?,?)', title, b.notes || '', due, [1, 2, 3].includes(Number(b.priority)) ? Number(b.priority) : 2, now());
  emit('todos_changed', {});
  return get('SELECT * FROM todos WHERE id = ?', r.lastInsertRowid);
});
route('PATCH', '/api/todos/:id', (req, url, b, p) => {
  const t = get('SELECT * FROM todos WHERE id = ?', Number(p.id));
  if (!t) throw new HttpError(404, 'No such to-do');
  const done = b.done === undefined ? t.done : b.done ? 1 : 0;
  run('UPDATE todos SET title = ?, notes = ?, priority = ?, done = ?, done_at = ? WHERE id = ?', b.title ?? t.title, b.notes ?? t.notes, b.priority ?? t.priority, done, done ? t.done_at || now() : null, t.id);
  emit('todos_changed', {});
  return get('SELECT * FROM todos WHERE id = ?', t.id);
});
route('DELETE', '/api/todos/:id', (req, url, b, p) => {
  run('DELETE FROM todos WHERE id = ?', Number(p.id));
  emit('todos_changed', {});
  return { ok: true };
});

// ---------- skills

const skillView = (s) => ({ name: s.name, description: s.description, source: s.source, enabled: s.enabled, overridesBundled: !!s.overridesBundled });
route('GET', '/api/skills', () => allSkills().map(skillView));
route('GET', '/api/skills/:name', (req, url, b, p) => {
  const s = getSkill(p.name);
  if (!s) throw new HttpError(404, 'No such skill');
  return { ...skillView(s), raw: s.raw };
});
route('PUT', '/api/skills/:name', (req, url, b, p) => skillView(saveSkill(p.name, b.raw)));
route('POST', '/api/skills', (req, url, b) => skillView(createSkill(b)));
route('DELETE', '/api/skills/:name', (req, url, b, p) => {
  deleteSkill(p.name);
  return { ok: true };
});
route('POST', '/api/skills/:name/toggle', (req, url, b, p) => {
  const set = new Set(getSettings().disabledSkills || []);
  if (b.enabled) set.delete(p.name);
  else set.add(p.name);
  setSettings({ disabledSkills: [...set] });
  return { ok: true };
});

// ---------- schedules

route('GET', '/api/jobs', () => listJobs());
route('GET', '/api/parse-when', (req, url) => {
  const r = parseWhen(url.searchParams.get('q') || '');
  return r ? { ok: true, human: r.human, next: formatWhen(r.nextRun) } : { ok: false };
});
route('POST', '/api/jobs', (req, url, b) => {
  const channel = b.channel || 'web';
  return createJob({ name: b.name, when: b.when, prompt: b.prompt, channel, sessionId: null, peer: channel === 'web' ? null : getSettings().defaultPeers[channel] || null });
});
route('PATCH', '/api/jobs/:id', (req, url, b, p) => updateJob(p.id, b));
route('DELETE', '/api/jobs/:id', (req, url, b, p) => ({ ok: deleteJob(p.id) }));
route('POST', '/api/jobs/:id/run', (req, url, b, p) => {
  if (!getJob(p.id)) throw new HttpError(404, 'No such job');
  runJob(p.id, { manual: true }).catch((err) => log('scheduler', err.message));
  return { ok: true };
});
route('GET', '/api/jobs/:id/runs', (req, url, b, p) => jobRuns(p.id));

// ---------- channels

route('GET', '/api/channels', () => channelStatus());
route('PUT', '/api/channels/:name', async (req, url, b, p) => {
  if (!CHANNEL_INFO[p.name]) throw new HttpError(404, 'Unknown channel');
  const clean = stripMasked({ channels: { [p.name]: b } }).channels[p.name] || {};
  const allowed = Object.keys(CHANNEL_DEFAULTS[p.name]);
  const patch = Object.fromEntries(Object.entries(clean).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  setSettings({ channels: { [p.name]: patch } });
  await startChannel(p.name);
  return channelStatus().find((c) => c.name === p.name);
});
route('POST', '/api/channels/:name/contacts/:peer', (req, url, b, p) => {
  setContactStatus(p.name, p.peer, b.status);
  return { ok: true };
});
route('DELETE', '/api/channels/:name/contacts/:peer', (req, url, b, p) => {
  removeContact(p.name, p.peer);
  return { ok: true };
});

// ---------- activity, files, export

route('GET', '/api/audit', (req, url) => {
  const kind = url.searchParams.get('kind');
  const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
  return kind ? all('SELECT * FROM audit WHERE kind = ? ORDER BY id DESC LIMIT ?', kind, limit) : all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', limit);
});

route('GET', '/api/files/*', (req, url, b, p, res) => {
  const s = getSettings();
  const { target, inside } = resolvePath(decodeURIComponent(p.rest), s.workspace, false);
  if (!inside || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new HttpError(404, 'Not found');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(target).pipe(res);
});

route('GET', '/api/export', (req, url, b, p, res) => {
  const s = publicSettings();
  delete s.accessToken;
  const data = {
    exportedAt: new Date().toISOString(),
    version: VERSION,
    settings: s,
    memories: all('SELECT * FROM memories'),
    todos: all('SELECT * FROM todos'),
    jobs: all('SELECT * FROM jobs'),
    sessions: all('SELECT * FROM sessions'),
    messages: all('SELECT id, session_id, role, content, tool_name, created_at FROM messages'),
  };
  send(res, 200, data, { 'Content-Disposition': `attachment; filename="assistant-export-${new Date().toISOString().slice(0, 10)}.json"` });
});

// ---------- webhooks (verified by each provider's own signature scheme)

route('GET', '/webhooks/whatsapp', (req, url, b, p, res) => {
  const ch = getChannel('whatsapp');
  const challenge = ch?.verify(url.searchParams);
  if (!challenge) throw new HttpError(403, 'Verification failed');
  send(res, 200, challenge);
});
route('POST', '/webhooks/whatsapp', async (req, url, b, p, res, raw) => {
  const ch = getChannel('whatsapp');
  if (!ch) throw new HttpError(503, 'WhatsApp channel is off');
  if (!ch.checkSignature(raw, req.headers['x-hub-signature-256'])) throw new HttpError(401, 'Bad signature');
  ch.onWebhook(b).catch((err) => log('whatsapp', err.message));
  return { ok: true };
});

function twilio(handler) {
  return (req, url, b, p, res) => {
    const ch = getChannel('phone');
    if (!ch) throw new HttpError(503, 'Phone channel is off');
    const base = publicBase(req);
    if (!ch.checkSignature(base + req.url, b || {}, req.headers['x-twilio-signature'])) {
      log('phone', `rejected webhook with bad signature (expected URL ${base + req.url} — set Public URL in Settings if this is wrong)`);
      throw new HttpError(403, 'Bad signature');
    }
    return Promise.resolve(handler(ch, b || {}, base)).then((body) => xml(res, body));
  };
}
route('POST', '/webhooks/twilio/sms', twilio((ch, b) => ch.onSms(b)));
route('POST', '/webhooks/twilio/voice', twilio((ch, b, base) => ch.onCall(b, base)));
route('POST', '/webhooks/twilio/voice/turn', twilio((ch, b, base) => ch.onTurn(b, base)));
route('POST', '/webhooks/twilio/voice/wait', twilio((ch, b, base) => ch.onWait(b, base)));

// ---------------------------------------------------------------- server

const LOGIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<style>body{font:15px system-ui;background:#0e1016;color:#e8e9ee;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#161922;padding:28px;border-radius:14px;width:min(360px,90vw);border:1px solid #262a36}input,button{width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #2c3140;background:#0e1016;color:inherit;font:inherit;margin-top:10px}button{background:#8b7cff;border:0;color:#fff;font-weight:600;cursor:pointer}p{color:#9aa0b2;font-size:13px}</style></head>
<body><form onsubmit="document.cookie='pa_token='+encodeURIComponent(this.t.value)+';path=/;SameSite=Strict;max-age=31536000'+(location.protocol==='https:'?';Secure':'');location.href='/';return false"><b>Personal AI Assistant</b><p>This gateway is being opened remotely. Paste the access token from Settings → Remote access on the computer it runs on.</p><input name="t" type="password" placeholder="Access token" autofocus><button>Unlock</button></form></body></html>`;

function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.resolve(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(full.endsWith('.html') ? { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'" } : {}),
  });
  fs.createReadStream(full).pipe(res);
  return true;
}

function events(req, res, url) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  const only = url.searchParams.get('session');
  const onEvent = (e) => {
    if (only && e.sessionId && e.sessionId !== only) return;
    res.write(`data: ${JSON.stringify(slimEvent(e))}\n\n`);
  };
  bus.on('event', onEvent);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    bus.off('event', onEvent);
    clearInterval(ping);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  try {
    const isWebhook = pathname.startsWith('/webhooks/');
    const local = isLocal(req);
    if (!isWebhook && !local && !tokenOk(req)) {
      if (req.method === 'GET' && !pathname.startsWith('/api/')) return send(res, 401, LOGIN_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
      throw new HttpError(401, 'Access token required');
    }
    // CSRF: browsers may only change things from this app's own pages.
    if (!isWebhook && req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked');
      if (pathname.startsWith('/api/') && !/application\/json/.test(req.headers['content-type'] || '') && req.headers['content-length'] !== '0' && req.headers['content-length']) {
        throw new HttpError(415, 'Send JSON');
      }
    }

    if (req.method === 'GET' && pathname === '/api/events') return events(req, res, url);

    const match = routes.find((r) => r.method === req.method && r.re.test(pathname));
    if (!match) {
      if (req.method === 'GET' && serveStatic(req, res, pathname)) return;
      throw new HttpError(404, 'Not found');
    }
    const m = pathname.match(match.re);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, k === 'rest' ? m[i + 1] : decodeURIComponent(m[i + 1])]));
    let raw = Buffer.alloc(0);
    let body = {};
    if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
      raw = await readBody(req);
      const type = req.headers['content-type'] || '';
      if (raw.length && /json/.test(type)) {
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          throw new HttpError(400, 'Invalid JSON');
        }
      } else if (raw.length && /x-www-form-urlencoded/.test(type)) {
        body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
      }
    }
    const result = await match.handler(req, url, body, params, res, raw);
    if (result !== undefined && !res.headersSent) send(res, 200, result);
  } catch (err) {
    const status = err.status || 400;
    if (status >= 500 || !err.status) log('http', `${req.method} ${pathname}: ${err.message}`);
    if (!res.headersSent) send(res, status, { error: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — is the assistant already running? Set PORT=… to use another port.\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, async () => {
  const s = getSettings();
  fs.mkdirSync(s.workspace, { recursive: true });
  console.log(`\n  Personal AI Assistant v${VERSION}`);
  console.log(`  ➜ Open http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('  ⚠ Listening beyond this computer — remote visitors need the access token (Settings → Remote access).');
  const p = await providerStatus();
  console.log(p.ok ? `  ➜ Models: ${p.resolved ? `${p.resolved.chat}${p.resolved.vision && p.resolved.vision !== p.resolved.chat ? ` + ${p.resolved.vision} (vision)` : ''}` : 'none installed yet'}` : `  ⚠ ${p.provider} not reachable at ${p.url}`);
  console.log(`  ➜ Tools: ${enabledTools(s).length}  ·  Permission mode: ${s.permissionMode}\n`);
  startScheduler();
  startChannels().catch((err) => log('channels', err.message));
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nShutting down…');
    server.close();
    process.exit(0);
  });
}
