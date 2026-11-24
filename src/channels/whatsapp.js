import crypto from 'node:crypto';
import { chunkText } from '../util/text.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** WhatsApp through the official WhatsApp Business Cloud API. Inbound messages arrive on a
 *  webhook, so the gateway must be reachable from the internet (e.g. through a tunnel). */
export class WhatsAppChannel {
  constructor(cfg, manager) {
    this.cfg = cfg;
    this.manager = manager;
    this.status = 'connecting';
    this.detail = '';
  }

  async graph(path, opts = {}) {
    const res = await fetch(`${GRAPH}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${this.cfg.token.trim()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `WhatsApp API ${res.status}`);
    return j;
  }

  async start() {
    const info = await this.graph(`/${this.cfg.phoneNumberId.trim()}?fields=display_phone_number,verified_name`);
    this.botName = info.verified_name || info.display_phone_number;
    this.status = 'connected';
    this.detail = 'Waiting for webhook events';
  }

  verify(query) {
    if (query.get('hub.mode') === 'subscribe' && query.get('hub.verify_token') === this.cfg.verifyToken) return query.get('hub.challenge');
    return null;
  }

  checkSignature(rawBody, header) {
    if (!this.cfg.appSecret) return true;
    const expected = `sha256=${crypto.createHmac('sha256', this.cfg.appSecret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(String(header || ''));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async media(id) {
    const meta = await this.graph(`/${id}`);
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${this.cfg.token.trim()}` } });
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }

  async onWebhook(payload) {
    this.detail = '';
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const msg of v.messages || []) {
          const from = msg.from;
          let text = '';
          const images = [];
          if (msg.type === 'text') text = msg.text?.body || '';
          else if (msg.type === 'image') {
            text = msg.image?.caption || '';
            images.push(await this.media(msg.image.id));
          } else if (msg.type === 'interactive') text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
          else {
            await this.send(from, 'I can read text and photos for now.');
            continue;
          }
          this.manager.handleInbound({
            channel: 'whatsapp',
            peerId: from,
            peerName: names[from] || from,
            chatId: from,
            text,
            images,
            reply: (t) => this.send(from, t),
          }).catch((err) => this.manager.log('whatsapp', err.message));
        }
      }
    }
  }

  async send(to, text) {
    for (const chunk of chunkText(text, 4000)) {
      await this.graph(`/${this.cfg.phoneNumberId.trim()}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: chunk, preview_url: false } }) });
    }
  }

  async stop() {
    this.status = 'off';
  }
}
