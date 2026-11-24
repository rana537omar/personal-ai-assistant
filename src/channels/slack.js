import { chunkText } from '../util/text.js';

/** Slack app over Socket Mode (no public URL). Answers DMs and @mentions in channels. */
export class SlackChannel {
  constructor(cfg, manager) {
    this.botToken = cfg.botToken.trim();
    this.appToken = cfg.appToken.trim();
    this.manager = manager;
    this.status = 'connecting';
    this.detail = '';
    this.running = false;
  }

  async call(method, body, token = this.botToken) {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(`Slack ${method}: ${j.error}`);
    return j;
  }

  async start() {
    const auth = await this.call('auth.test');
    this.botUserId = auth.user_id;
    this.botName = auth.user;
    this.running = true;
    await this.connect();
  }

  async connect() {
    if (!this.running) return;
    let url;
    try {
      url = (await this.call('apps.connections.open', {}, this.appToken)).url;
    } catch (err) {
      this.status = 'error';
      this.detail = err.message;
      setTimeout(() => this.connect(), 15000);
      return;
    }
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'connected';
      this.detail = '';
    };
    ws.onmessage = (e) => {
      const env = JSON.parse(e.data);
      if (env.envelope_id) ws.send(JSON.stringify({ envelope_id: env.envelope_id }));
      if (env.type === 'disconnect') ws.close();
      if (env.type === 'events_api') this.onEvent(env.payload?.event).catch((err) => this.manager.log('slack', err.message));
    };
    ws.onclose = () => {
      if (!this.running || this.ws !== ws) return;
      this.status = 'connecting';
      setTimeout(() => this.connect(), 3000);
    };
    ws.onerror = () => {};
  }

  async onEvent(ev) {
    if (!ev || ev.bot_id || ev.subtype || ev.user === this.botUserId) return;
    const isDM = ev.type === 'message' && ev.channel_type === 'im';
    const isMention = ev.type === 'app_mention';
    if (!isDM && !isMention) return;
    const text = String(ev.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
    await this.manager.handleInbound({
      channel: 'slack',
      peerId: ev.user,
      peerName: ev.user,
      chatId: ev.channel,
      isGroup: !isDM,
      text,
      images: [],
      reply: (t) => this.send(ev.channel, t, isMention ? ev.thread_ts || ev.ts : undefined),
    });
  }

  async send(channel, text, threadTs) {
    for (const chunk of chunkText(text, 3500)) await this.call('chat.postMessage', { channel, text: chunk, thread_ts: threadTs, unfurl_links: false });
  }

  async stop() {
    this.running = false;
    this.status = 'off';
    try {
      this.ws?.close();
    } catch {
      /* closed */
    }
  }
}
