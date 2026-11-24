# Connecting chat apps

Every channel is configured in the web app under **Channels**: paste the credentials, press **Save & connect**, then message the bot. The first message from any person returns a **pairing code**; approve it in the Channels page and from then on that person can talk to the assistant. Block or remove people at any time.

Commands that work in every chat app:

| Command | |
|---|---|
| `/new` | Start a fresh conversation (memory is kept) |
| `/stop` | Stop what the assistant is doing |
| `/approve <code>` · `/deny <code>` | Answer an approval request |
| `/status` · `/help` | |

When the assistant needs approval during a chat-app conversation it asks right there (Telegram shows Approve / Deny buttons). You can also answer from the web app.

---

## Telegram

No public URL needed (long polling).

1. In Telegram, message **@BotFather** → `/newbot` → choose a name and a username ending in `bot`.
2. Copy the token (`123456789:AA…`) into Channels → Telegram → **Bot token**.
3. Save & connect, then message your bot and approve the pairing code.

In group chats the bot only answers when @mentioned or replied to.

## Discord

No public URL needed (Gateway WebSocket).

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** → **Reset Token** → copy it into Channels → Discord.
3. On the same page enable **Message Content Intent** (required to read messages).
4. **OAuth2 → URL Generator**: scope `bot`; permissions *Send Messages*, *Read Message History*. Open the URL to add the bot to your server.
5. DM the bot, or @mention it in a channel, and approve the pairing code.

## Slack

No public URL needed (Socket Mode).

1. https://api.slack.com/apps → **Create New App** → *From scratch*.
2. **Socket Mode** → enable → create an app-level token with `connections:write` (starts with `xapp-`).
3. **OAuth & Permissions** → bot token scopes: `chat:write`, `im:history`, `app_mentions:read` → **Install to Workspace** → copy the bot token (`xoxb-`).
4. **Event Subscriptions** → enable → *Subscribe to bot events*: `message.im`, `app_mention`.
5. **App Home** → enable *Allow users to send Slash commands and messages from the messages tab*.
6. Paste both tokens, save, DM the app and approve the pairing code.

## WhatsApp (Business Cloud API)

Needs a public HTTPS URL for the webhook.

1. Create an app at https://developers.facebook.com with the **WhatsApp** product.
2. From **WhatsApp → API Setup** copy the access token and the *Phone number ID*.
3. Expose the gateway, e.g. `cloudflared tunnel --url http://localhost:6100`, and set **Settings → Remote access → Public URL** to the tunnel address.
4. In **WhatsApp → Configuration** set the callback URL to `https://<public-url>/webhooks/whatsapp`, enter the same *Verify token* you typed in Channels, and subscribe to the `messages` field.
5. Add the **App secret** (App settings → Basic) so incoming webhooks are signature-checked.
6. Message the number from your phone and approve the pairing code.

## SMS and phone calls (Twilio)

Needs a public HTTPS URL for the webhooks. Twilio signs every request; the gateway verifies the signature against your Public URL, so set it exactly.

1. Buy a number in the Twilio console.
2. Paste the Account SID, Auth token and the number (E.164, e.g. `+15551234567`) into Channels → SMS & phone calls.
3. Expose the gateway and set the Public URL (see WhatsApp step 3).
4. On the number's configuration page:
   - *A message comes in* → Webhook → `https://<public-url>/webhooks/twilio/sms` (HTTP POST)
   - *A call comes in* → Webhook → `https://<public-url>/webhooks/twilio/voice` (HTTP POST)
5. Text the number and approve the pairing code. Calling works for the same approved number.

**Calls**: Twilio transcribes what you say, the assistant answers, and Twilio reads the answer aloud. Local models can be slower than a phone call's patience, so while it thinks the line holds with short pauses; after about 75 seconds it says it will text you the answer instead, and does.

## HTTP API

```bash
curl -X POST http://localhost:6100/api/v1/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access token>" \
  -d '{"text": "Add milk to my shopping list", "sessionId": "shortcuts"}'
# → {"reply": "...", "sessionId": "shortcuts"}
```

From the same computer no token is needed. From other devices use the access token in Settings → Remote access. Good for iOS Shortcuts, Home Assistant, cron scripts and so on.

## Exposing the gateway safely

- The gateway listens on `127.0.0.1` by default. To reach the web app from your phone use a tunnel or a VPN like Tailscale rather than opening a port on your router.
- Requests arriving through a tunnel are treated as remote even though they come from localhost (forwarding headers are detected), so they need the access token.
- Webhook paths (`/webhooks/...`) skip the token but are verified with each provider's own signature (WhatsApp app secret, Twilio auth token).
