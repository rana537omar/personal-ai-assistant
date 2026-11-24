import crypto from 'node:crypto';
import { chunkText, escapeXml, speakable, stripMarkdown } from '../util/text.js';
import { getSettings } from '../config.js';
import { get } from '../db.js';

/**
 * Text or call your assistant through a Twilio phone number.
 * SMS:   POST /webhooks/twilio/sms   → reply is sent back with the REST API.
 * Voice: POST /webhooks/twilio/voice → speech is transcribed by Twilio <Gather>, the agent
 *        runs, and the answer is spoken with <Say>. Because local models can take longer than
 *        Twilio's 15-second webhook limit, the call holds with short pauses until the answer is
 *        ready, and falls back to texting the answer if it takes too long.
 */
const pendingCalls = new Map(); // CallSid -> { done, text, started }
const VOICE_WAIT_MS = 75000;

export class PhoneChannel {
  constructor(cfg, manager) {
    this.cfg = cfg;
    this.manager = manager;
    this.status = 'connecting';
    this.detail = '';
  }

  auth() {
    return `Basic ${Buffer.from(`${this.cfg.accountSid.trim()}:${this.cfg.authToken.trim()}`).toString('base64')}`;
  }

  async start() {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid.trim()}.json`, { headers: { Authorization: this.auth() }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Twilio rejected the credentials (${res.status})`);
    const j = await res.json();
    this.botName = this.cfg.fromNumber;
    this.status = 'connected';
    this.detail = `Account ${j.friendly_name || ''} — waiting for webhook events`.trim();
  }

  /** https://www.twilio.com/docs/usage/webhooks/webhooks-security */
  checkSignature(fullUrl, params, signature) {
    const data = fullUrl + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const expected = crypto.createHmac('sha1', this.cfg.authToken.trim()).update(Buffer.from(data, 'utf8')).digest('base64');
    const a = Buffer.from(String(signature || ''));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async media(url) {
    const res = await fetch(url, { headers: { Authorization: this.auth() }, redirect: 'follow' });
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }

  async send(to, text) {
    for (const chunk of chunkText(stripMarkdown(text), 1500)) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid.trim()}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: this.auth(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: this.cfg.fromNumber.trim(), To: to, Body: chunk }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Twilio SMS failed: ${(await res.text()).slice(0, 200)}`);
    }
  }

  // ---------- SMS ----------
  async onSms(params) {
    const from = params.From;
    const images = [];
    const n = Number(params.NumMedia || 0);
    for (let i = 0; i < Math.min(n, 2); i++) {
      if (String(params[`MediaContentType${i}`] || '').startsWith('image/')) images.push(await this.media(params[`MediaUrl${i}`]));
    }
    this.manager.handleInbound({
      channel: 'phone',
      surface: 'sms',
      peerId: from,
      peerName: from,
      chatId: from,
      text: params.Body || '',
      images,
      reply: (t) => this.send(from, t),
    }).catch((err) => this.manager.log('phone', err.message));
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  // ---------- Voice ----------
  gather(say, base) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${base}/webhooks/twilio/voice/turn" method="POST" speechTimeout="auto"><Say>${escapeXml(say)}</Say></Gather><Say>I didn't hear anything, so I'll hang up. Talk soon.</Say></Response>`;
  }

  onCall(params, base) {
    const s = getSettings();
    if (this.cfg.voice === false) return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Voice calls are turned off. Please send a text instead.</Say></Response>';
    const contact = get("SELECT * FROM contacts WHERE channel = 'phone' AND peer_id = ?", params.From);
    if (contact?.status !== 'allowed') {
      // Route through the normal pairing flow (it texts the code), and say it too.
      this.manager.handleInbound({ channel: 'phone', surface: 'sms', peerId: params.From, peerName: params.From, chatId: params.From, text: '', reply: (t) => this.send(params.From, t) }).catch(() => {});
      const c = get("SELECT * FROM contacts WHERE channel = 'phone' AND peer_id = ?", params.From);
      const code = c?.code ? String(c.code).split('').join(' ') : '';
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Hi. This assistant only talks to approved numbers. ${code ? `Your pairing code is ${code}. ` : ''}Goodbye.</Say><Hangup/></Response>`;
    }
    return this.gather(`Hi${s.userName ? ` ${s.userName}` : ''}, it's ${s.assistantName}. What can I do for you?`, base);
  }

  onTurn(params, base) {
    const speech = String(params.SpeechResult || '').trim();
    if (!speech) return this.gather("Sorry, I didn't catch that. Could you say it again?", base);
    const sid = params.CallSid;
    const entry = { done: false, text: '', started: Date.now(), from: params.From };
    pendingCalls.set(sid, entry);
    this.manager.handleInbound({
      channel: 'phone',
      surface: 'voice',
      peerId: params.From,
      peerName: params.From,
      chatId: params.From,
      text: speech,
      reply: async (t) => {
        entry.text = t;
        entry.done = true;
        if (entry.textInstead) await this.send(params.From, t);
      },
    }).catch((err) => {
      entry.text = `Sorry, something went wrong: ${err.message}`;
      entry.done = true;
    });
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>One moment.</Say><Redirect method="POST">${base}/webhooks/twilio/voice/wait</Redirect></Response>`;
  }

  onWait(params, base) {
    const entry = pendingCalls.get(params.CallSid);
    if (!entry) return this.gather('What else can I do for you?', base);
    if (entry.done) {
      pendingCalls.delete(params.CallSid);
      return this.gather(`${speakable(entry.text).slice(0, 900)} ... Anything else?`, base);
    }
    if (Date.now() - entry.started > VOICE_WAIT_MS) {
      entry.textInstead = true;
      pendingCalls.delete(params.CallSid);
      return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This is taking a little while. I will text you the answer as soon as it is ready. Bye for now.</Say><Hangup/></Response>';
    }
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="2"/><Redirect method="POST">${base}/webhooks/twilio/voice/wait</Redirect></Response>`;
  }

  async stop() {
    this.status = 'off';
  }
}
