# Security

Personal AI Assistant can run commands, write files and act on websites for you. This page explains what protects you and what you should know.

## Threat model

The main risks for any AI agent with tools are:

1. **Strangers controlling it** through a chat app.
2. **Prompt injection** — instructions hidden in a web page, email or file that try to make the assistant do something you didn't ask for (for example, read a secret and send it somewhere).
3. **Mistakes** — a small model misunderstanding and doing something destructive.

## Protections

| Protection | Against |
|---|---|
| **Pairing codes** — chat apps only answer people you approve; unknown senders just get a code | 1 |
| **Local-only by default** — the gateway binds to `127.0.0.1`; remote requests (including through tunnels, detected by forwarding headers) need the access token | 1 |
| **Signed webhooks** — WhatsApp (app secret) and Twilio (auth token) requests are signature-verified | 1 |
| **CSRF protection** — API changes must be JSON from the app's own origin, so other websites can't drive your local gateway | 1 |
| **Permission modes** — in *Ask* mode commands, browser clicks/typing, non-GET HTTP requests, writes outside the workspace and new skills wait for your approval | 2, 3 |
| **Workspace sandbox** — file tools stay inside the workspace folder unless you enable full disk access; symlinks are resolved | 2, 3 |
| **Conservative allowlist** — auto-approved commands are plain read-only invocations; any pipe, redirect, chaining or substitution asks; file readers like `cat` are not allowlisted by default | 2 |
| **Untrusted-content labels** — fetched pages, search results and API responses are marked as data, not instructions | 2 |
| **No credentials** — the browser tool refuses to type into password fields, and the system prompt forbids entering passwords or card details | 2 |
| **Hard blocks** — wiping disks, formatting, recursive deletes of the root, shutdown and similar commands are refused in every mode, including Auto | 3 |
| **Audit log** — every tool call and approval is recorded under Activity | all |

## Known limitations

- **Web reads are automatic.** In Ask mode the assistant can fetch any URL without asking. A prompt-injected page could make it *request* a URL containing data it has seen in the conversation. Keep secrets out of conversations, and use Read-only mode when researching untrusted material if that matters to you.
- **Auto mode trusts the model.** Only use it on a machine or account where mistakes are cheap.
- **Local models are weaker at refusing manipulation** than large hosted models. The approval step is your real safeguard — read what you approve.
- **Settings are stored unencrypted** in `data/assistant.db` (bot tokens included). Protect that folder like you would an `.env` file.

## Reporting a vulnerability

Please don't open a public issue for security problems. Email the maintainers (see the repository profile) or use GitHub's private vulnerability reporting, with steps to reproduce. We aim to respond within a week.
