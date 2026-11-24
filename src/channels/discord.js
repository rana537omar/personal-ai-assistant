import { chunkText } from '../util/text.js';

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const API = 'https://discord.com/api/v10';
// GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT (privileged — enable it in the developer portal)
const INTENTS = (1 << 9) | (1 << 12) | (1 << 15);

/** Discord bot over the Gateway WebSocket. Answers DMs, and messages that @mention it in servers. */
export class DiscordChannel {
  constructor(cfg, manager) {
    this.token = cfg.token.trim();
    this.manager = manager;
    this.status = 'connecting';
    this.detail = '';
    this.running = false;
    this.seq = null;
  }

  async rest(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (personal-ai-assistant, 0.1)' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  }

  async start() {
    const me = await this.rest('GET', '/users/@me');
    this.botName = me.username;
    this.running = true;
    this.connect();
  }

  connect() {
    if (!this.running) return;
    const ws = new WebSocket(GATEWAY);
    this.ws = ws;
    ws.onmessage = (e) => this.onPayload(JSON.parse(e.data));
    ws.onclose = (e) => {
      clearInterval(this.hb);
      if (!this.running || this.ws !== ws) return;
      if (e.code === 4004) {
        this.status = 'error';
        this.detail = 'Discord rejected the bot token.';
        return;
      }
      if (e.code === 4014) {
        this.status = 'error';
        this.detail = 'Enable the MESSAGE CONTENT intent for this bot in the Discord developer portal.';
        return;
      }
      this.status = 'connecting';
      setTimeout(() => this.connect(), 5000);
    };
    ws.onerror = () => {};
  }

  sendWs(payload) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(payload));
  }

  onPayload(p) {
    if (p.s != null) this.seq = p.s;
    if (p.op === 10) {
      clearInterval(this.hb);
      this.hb = setInterval(() => this.sendWs({ op: 1, d: this.seq }), p.d.heartbeat_interval);
      this.sendWs({ op: 2, d: { token: this.token, intents: INTENTS, properties: { os: process.platform, browser: 'personal-ai-assistant', device: 'personal-ai-assistant' } } });
    } else if (p.op === 7 || p.op === 9) {
      this.ws?.close(4000);
    } else if (p.op === 0) {
      if (p.t === 'READY') {
        this.userId = p.d.user.id;
        this.botName = p.d.user.username;
        this.status = 'connected';
        this.detail = '';
      } else if (p.t === 'MESSAGE_CREATE') {
        this.onMessage(p.d).catch((err) => this.manager.log('discord', err.message));
      }
    }
  }

  async onMessage(d) {
    if (d.author?.bot) return;
    const isDM = !d.guild_id;
    const mentioned = (d.mentions || []).some((u) => u.id === this.userId);
    if (!isDM && !mentioned) return;
    const text = String(d.content || '').replace(new RegExp(`<@!?${this.userId}>`, 'g'), '').trim();
    const images = [];
    for (const a of d.attachments || []) {
      if (!a.content_type?.startsWith('image/') || images.length >= 2) continue;
      const res = await fetch(a.url);
      images.push(Buffer.from(await res.arrayBuffer()).toString('base64'));
    }
    await this.manager.handleInbound({
      channel: 'discord',
      peerId: d.author.id,
      peerName: d.author.global_name || d.author.username,
      chatId: d.channel_id,
      isGroup: !isDM,
      text,
      images,
      reply: (t) => this.send(d.channel_id, t),
      typing: () => this.rest('POST', `/channels/${d.channel_id}/typing`),
    });
  }

  async send(channelId, text) {
    for (const chunk of chunkText(text, 1900)) await this.rest('POST', `/channels/${channelId}/messages`, { content: chunk, allowed_mentions: { parse: [] } });
  }

  async stop() {
    this.running = false;
    this.status = 'off';
    clearInterval(this.hb);
    try {
      this.ws?.close(1000);
    } catch {
      /* closed */
    }
  }
}
