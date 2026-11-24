import { chunkText } from '../util/text.js';
import { decide } from '../approvals.js';
import { get } from '../db.js';

/** Telegram via the Bot API with long polling — works behind NAT, no public URL needed. */
export class TelegramChannel {
  constructor(cfg, manager) {
    this.token = cfg.token.trim();
    this.manager = manager;
    this.offset = 0;
    this.running = false;
    this.status = 'connecting';
    this.detail = '';
  }

  async api(method, body = {}, signal) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(20000),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.description || `Telegram ${method} failed`);
    return j.result;
  }

  async start() {
    const me = await this.api('getMe');
    this.botName = `@${me.username}`;
    this.username = me.username;
    this.running = true;
    this.status = 'connected';
    this.api('setMyCommands', {
      commands: [
        { command: 'new', description: 'Start a fresh conversation' },
        { command: 'stop', description: 'Stop the current task' },
        { command: 'status', description: 'What I am doing' },
        { command: 'help', description: 'How to use me' },
      ],
    }).catch(() => {});
    this.loop();
  }

  async loop() {
    while (this.running) {
      this.controller = new AbortController();
      try {
        const updates = await this.api('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, AbortSignal.any([this.controller.signal, AbortSignal.timeout(35000)]));
        this.status = 'connected';
        this.detail = '';
        for (const u of updates) {
          this.offset = u.update_id + 1;
          this.handle(u).catch((err) => this.manager.log('telegram', err.message));
        }
      } catch (err) {
        if (!this.running) break;
        if (err.name === 'TimeoutError') continue;
        this.status = 'error';
        this.detail = err.message;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  async download(fileId) {
    const f = await this.api('getFile', { file_id: fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${f.file_path}`);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }

  async handle(u) {
    if (u.callback_query) {
      const q = u.callback_query;
      const [action, id] = String(q.data || '').split(':');
      const contact = get("SELECT * FROM contacts WHERE channel = 'telegram' AND peer_id = ? AND status = 'allowed'", String(q.from.id));
      let note = 'Not allowed';
      if (contact && id) {
        const r = decide(id, action === 'approve' ? 'approved' : 'denied', `telegram:${q.from.username || q.from.id}`);
        note = r.ok ? (r.status === 'approved' ? 'Approved' : 'Declined') : r.error;
        if (r.ok && q.message) {
          this.api('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `${q.message.text}\n\n→ ${note}` }).catch(() => {});
        }
      }
      await this.api('answerCallbackQuery', { callback_query_id: q.id, text: note }).catch(() => {});
      return;
    }
    const m = u.message;
    if (!m || !m.from || m.from.is_bot) return;
    const isGroup = m.chat.type !== 'private';
    let text = m.text || m.caption || '';
    if (isGroup) {
      const mention = `@${this.username}`;
      const replyingToMe = m.reply_to_message?.from?.username === this.username;
      if (!text.includes(mention) && !replyingToMe && !text.startsWith('/')) return;
      text = text.replace(mention, '').trim();
    }
    const chatId = String(m.chat.id);
    const reply = (t) => this.send(chatId, t);
    if (m.voice || m.audio || m.video_note) {
      await reply("I can't listen to voice notes yet — could you type it?");
      return;
    }
    const images = [];
    if (m.photo?.length) images.push(await this.download(m.photo.at(-1).file_id));
    else if (m.document?.mime_type?.startsWith('image/')) images.push(await this.download(m.document.file_id));
    await this.manager.handleInbound({
      channel: 'telegram',
      peerId: String(m.from.id),
      peerName: [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || m.from.username,
      chatId,
      isGroup,
      text,
      images,
      reply,
      typing: () => this.api('sendChatAction', { chat_id: chatId, action: 'typing' }),
    });
  }

  async send(chatId, text) {
    for (const chunk of chunkText(text, 4000)) {
      await this.api('sendMessage', { chat_id: chatId, text: chunk, disable_web_page_preview: true });
    }
  }

  async sendApproval(chatId, approval, text) {
    await this.api('sendMessage', {
      chat_id: chatId,
      text: `⚠️ I need your OK to: ${approval.summary}`,
      reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve:${approval.id}` }, { text: '✖️ Deny', callback_data: `deny:${approval.id}` }]] },
    }).catch(() => this.send(chatId, text));
  }

  async stop() {
    this.running = false;
    this.status = 'off';
    this.controller?.abort();
  }
}
