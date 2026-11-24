import crypto from 'node:crypto';
import { all, get, run, now } from '../db.js';
import { bus, emit, log } from '../events.js';
import { getSettings, setSettings } from '../config.js';
import { runTurn, stopRun, isRunning } from '../agent.js';
import { decide } from '../approvals.js';
import { addMessage, getSession, ensureSession, newSessionId } from '../sessions.js';
import { TelegramChannel } from './telegram.js';
import { DiscordChannel } from './discord.js';
import { SlackChannel } from './slack.js';
import { WhatsAppChannel } from './whatsapp.js';
import { PhoneChannel } from './phone.js';

/**
 * Channel manager. Every chat app funnels into handleInbound(), which enforces pairing
 * (unknown senders must be approved by the owner before the assistant will talk to them),
 * handles slash commands, and runs the agent in a per-chat session.
 */

const ADAPTERS = { telegram: TelegramChannel, discord: DiscordChannel, slack: SlackChannel, whatsapp: WhatsAppChannel, phone: PhoneChannel };
export const CHANNEL_INFO = {
  telegram: { label: 'Telegram', needs: ['token'] },
  discord: { label: 'Discord', needs: ['token'] },
  slack: { label: 'Slack', needs: ['botToken', 'appToken'] },
  whatsapp: { label: 'WhatsApp', needs: ['token', 'phoneNumberId', 'verifyToken'], webhook: '/webhooks/whatsapp' },
  phone: { label: 'SMS & phone calls (Twilio)', needs: ['accountSid', 'authToken', 'fromNumber'], webhook: '/webhooks/twilio/sms' },
};
const ALIASES = { sms: 'phone', voice: 'phone', twilio: 'phone' };
const instances = new Map();

const manager = { handleInbound, log };

export function getChannel(name) {
  return instances.get(ALIASES[name] || name);
}

function configured(name, cfg) {
  return CHANNEL_INFO[name].needs.every((k) => String(cfg?.[k] || '').trim());
}

export async function startChannel(name) {
  await stopChannel(name);
  const cfg = getSettings().channels[name];
  if (!cfg?.enabled || !configured(name, cfg)) return;
  const inst = new ADAPTERS[name](cfg, manager);
  instances.set(name, inst);
  try {
    await inst.start();
    log('channels', `${name} connected${inst.botName ? ` as ${inst.botName}` : ''}`);
  } catch (err) {
    inst.status = 'error';
    inst.detail = err.message;
    log('channels', `${name} failed: ${err.message}`);
  }
  emit('channels_changed', {});
}

export async function stopChannel(name) {
  const inst = instances.get(name);
  if (!inst) return;
  instances.delete(name);
  try {
    await inst.stop();
  } catch {
    /* already stopped */
  }
  emit('channels_changed', {});
}

export async function startChannels() {
  for (const name of Object.keys(ADAPTERS)) await startChannel(name);
}

export function channelStatus() {
  const s = getSettings();
  return Object.entries(CHANNEL_INFO).map(([name, info]) => {
    const cfg = s.channels[name] || {};
    const inst = instances.get(name);
    return {
      name,
      label: info.label,
      enabled: !!cfg.enabled,
      configured: configured(name, cfg),
      status: inst ? inst.status || 'connecting' : cfg.enabled ? (configured(name, cfg) ? 'stopped' : 'needs setup') : 'off',
      detail: inst?.detail || '',
      botName: inst?.botName || '',
      webhook: info.webhook || null,
      contacts: all('SELECT channel, peer_id, name, status, code, last_seen_at FROM contacts WHERE channel = ? ORDER BY last_seen_at DESC', name),
    };
  });
}

// ---------- pairing ----------

function contactFor(channel, peerId, name, chatId) {
  let c = get('SELECT * FROM contacts WHERE channel = ? AND peer_id = ?', channel, peerId);
  if (!c) {
    const code = String(crypto.randomInt(100000, 999999));
    run('INSERT INTO contacts (channel, peer_id, name, status, code, chat_id, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?)', channel, peerId, name, 'pending', code, chatId, now(), now());
    c = get('SELECT * FROM contacts WHERE channel = ? AND peer_id = ?', channel, peerId);
    emit('pairing', { channel, peerId, name, code });
    emit('channels_changed', {});
  } else {
    run('UPDATE contacts SET name = coalesce(?, name), chat_id = coalesce(?, chat_id), last_seen_at = ? WHERE channel = ? AND peer_id = ?', name, chatId, now(), channel, peerId);
  }
  return c;
}

export function setContactStatus(channel, peerId, status) {
  if (!['allowed', 'blocked', 'pending'].includes(status)) throw new Error('Bad status');
  const c = get('SELECT * FROM contacts WHERE channel = ? AND peer_id = ?', channel, peerId);
  if (!c) throw new Error('Unknown contact');
  run('UPDATE contacts SET status = ? WHERE channel = ? AND peer_id = ?', status, channel, peerId);
  if (status === 'allowed' && c.chat_id) {
    const inst = instances.get(channel);
    const s = getSettings();
    inst?.send(c.chat_id, `You're connected! I'm ${s.assistantName}. Ask me anything — send /help to see commands.`).catch(() => {});
    if (!s.defaultPeers[channel]) setSettings({ defaultPeers: { [channel]: c.chat_id } });
  }
  emit('channels_changed', {});
}

export function removeContact(channel, peerId) {
  run('DELETE FROM contacts WHERE channel = ? AND peer_id = ?', channel, peerId);
  emit('channels_changed', {});
}

// ---------- inbound ----------

function sessionFor(channel, chatId) {
  const key = `${channel}:${chatId}`;
  const map = getSettings().chatSessions || {};
  return map[key] || key;
}

const HELP = (name) => `I'm ${name}, your private assistant. Just talk to me normally. Commands:
/new — start a fresh conversation
/stop — stop what I'm doing
/approve <code> — allow an action I asked about
/deny <code> — decline it
/status — what I'm up to`;

/**
 * @param {object} m  { channel, peerId, peerName, chatId, text, images, surface, reply(text), typing() }
 */
export async function handleInbound(m) {
  const s = getSettings();
  const contact = contactFor(m.channel, String(m.peerId), m.peerName || null, String(m.chatId));
  if (contact.status === 'blocked') return;
  if (contact.status !== 'allowed') {
    // Tell an unknown sender how to get access, at most once an hour.
    if (!contact.notified_at || now() - contact.notified_at > 3600000) {
      run('UPDATE contacts SET notified_at = ? WHERE channel = ? AND peer_id = ?', now(), m.channel, String(m.peerId));
      await m.reply(`Hi! I'm a private assistant and I only talk to people my owner has approved.\nYour pairing code is ${contact.code}. If you're my owner, approve it in the web app under Channels.`).catch(() => {});
    }
    return;
  }
  if (!m.isGroup && s.defaultPeers[m.channel] !== String(m.chatId)) setSettings({ defaultPeers: { [m.channel]: String(m.chatId) } });

  const text = String(m.text || '').trim();
  const sessionId = sessionFor(m.channel, m.chatId);
  const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*(.*)$/s);
  if (cmd) {
    const [, name, arg] = cmd;
    const c = name.toLowerCase();
    if (c === 'start' || c === 'help') return m.reply(HELP(s.assistantName));
    if (c === 'new' || c === 'reset') {
      const id = newSessionId(m.channel);
      ensureSession(id, m.channel, String(m.chatId));
      setSettings({ chatSessions: { [`${m.channel}:${m.chatId}`]: id } });
      return m.reply('Started a fresh conversation. (I still remember what I know about you.)');
    }
    if (c === 'stop') return m.reply(stopRun(sessionId) ? 'Stopped.' : 'Nothing is running.');
    if (c === 'status') return m.reply(isRunning(sessionId) ? 'Working on your last message…' : 'Idle and ready.');
    if (c === 'approve' || c === 'deny' || c === 'yes' || c === 'no') {
      const code = arg.trim().split(/\s+/)[0];
      if (!code) return m.reply('Which one? Send /approve <code> with the code from my question.');
      const r = decide(code, c === 'approve' || c === 'yes' ? 'approved' : 'denied', `${m.channel}:${m.peerName || m.peerId}`);
      return m.reply(r.ok ? (r.status === 'approved' ? '👍 Approved.' : '👎 Declined.') : r.error);
    }
  }
  if (!text && !m.images?.length) return;

  ensureSession(sessionId, m.channel, String(m.chatId));
  let typingTimer = null;
  if (m.typing) {
    m.typing().catch(() => {});
    typingTimer = setInterval(() => m.typing().catch(() => {}), 4500);
  }
  try {
    const res = await runTurn({ sessionId, text, images: m.images || [], channel: m.channel, peer: String(m.chatId), surface: m.surface || m.channel });
    if (res.text && !res.stopped) await m.reply(res.text);
    return res;
  } finally {
    clearInterval(typingTimer);
  }
}

// ---------- outbound ----------

/** Sends text to the owner on a channel. For the web app it lands in a conversation + notification. */
export async function deliver({ channel, peer, sessionId, text, title, from }) {
  const name = ALIASES[channel] || channel || 'web';
  if (name === 'web' || name === 'cli' || name === 'api') {
    let sid = sessionId && getSession(sessionId) ? sessionId : null;
    if (!sid) {
      sid = 'web-notifications';
      ensureSession(sid, 'web', null);
      const sess = getSession(sid);
      if (!sess.title) run('UPDATE sessions SET title = ? WHERE id = ?', '🔔 Notifications', sid);
    }
    const msg = addMessage(sid, { role: 'assistant', content: text, meta: { from, title } });
    emit('message', { sessionId: sid, message: msg });
    emit('notification', { sessionId: sid, level: 'message', title: title || getSettings().assistantName, text });
    return { ok: true, sessionId: sid };
  }
  const inst = instances.get(name);
  if (!inst) return { ok: false, error: `${name} is not connected` };
  const to = peer || getSettings().defaultPeers[name];
  if (!to) return { ok: false, error: `no ${name} chat yet — message the bot once first` };
  try {
    await inst.send(to, text);
    const sid = sessionId && getSession(sessionId) ? sessionId : sessionFor(name, to);
    ensureSession(sid, name, to);
    const msg = addMessage(sid, { role: 'assistant', content: text, meta: { from, title } });
    emit('message', { sessionId: sid, message: msg });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// When the agent needs approval inside a chat-app conversation, ask in that chat too.
bus.on('event', (e) => {
  if (e.type !== 'approval') return;
  const session = getSession(e.sessionId);
  if (!session) return;
  let channel = session.channel;
  let peer = session.peer;
  if (channel === 'job') {
    const job = get('SELECT * FROM jobs WHERE id = ?', e.sessionId.replace(/^job:/, ''));
    channel = job?.channel;
    peer = job?.peer || getSettings().defaultPeers[channel];
  }
  const inst = instances.get(ALIASES[channel] || channel);
  if (!inst || !peer) return;
  const a = e.approval;
  const text = `⚠️ I need your OK to: ${a.summary}\nReply /approve ${a.id} or /deny ${a.id}`;
  (inst.sendApproval ? inst.sendApproval(peer, a, text) : inst.send(peer, text)).catch((err) => log('channels', 'approval notice failed:', err.message));
});
