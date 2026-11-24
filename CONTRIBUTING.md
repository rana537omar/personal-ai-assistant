# Contributing

Thanks for helping! A few principles keep this project easy to run and easy to trust.

## Principles

- **Zero dependencies.** Everything uses Node.js built-ins (`node:http`, `node:sqlite`, `fetch`, `WebSocket`) and plain browser JavaScript. Please don't add npm packages; if something truly needs one, open an issue first.
- **Local first.** Features must work with a local model. Anything that sends data off the machine should be opt-in and obvious.
- **Safe by default.** New tools declare a risk level (`safe`, `read`, `workspace`, `sensitive`, `write`, `exec`, `external`) and a `summarize()` for approval prompts when they can change things.
- **Small-model friendly.** Keep tool descriptions and skills short and concrete; test with a 3–8B model.

## Getting started

```bash
git clone https://github.com/rana537omar/personal-ai-assistant.git
cd personal-ai-assistant
npm start          # http://localhost:6100
npm test
```

Use `ASSISTANT_DATA=/tmp/pa-dev PORT=6200 npm start` to keep a separate dev database.

## Adding a tool

1. Add an object to a file in `src/tools/` (or a new file registered in `src/tools/index.js`):

```js
{
  name: 'weather',
  group: 'web',
  risk: 'read',
  description: 'Current weather and forecast for a place.',
  parameters: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] },
  run: async ({ place }, ctx) => '…text the model will read…',
}
```

2. Return plain text (or `{ output, image }`). Throw errors with a helpful message — the model sees it and can recover.
3. Add an icon/label in `public/js/chat.js` (`TOOL_META`).

## Adding a channel

Create `src/channels/<name>.js` with a class exposing `start()`, `stop()`, `send(chatId, text)` and `status`/`detail`/`botName`, and call `manager.handleInbound({ channel, peerId, peerName, chatId, text, images, reply, typing })` for each incoming message. Register it in `src/channels/index.js` and the defaults in `src/config.js`, and add a setup card in `public/js/views.js`.

## Pull requests

- Keep changes focused; describe what and why.
- Run `npm test` and try the change in the web app with a local model.
- Update the README or `docs/` if behaviour changes.
