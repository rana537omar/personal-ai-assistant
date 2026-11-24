#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.ASSISTANT_URL || `http://127.0.0.1:${process.env.PORT || 6100}`).replace(/\/$/, '');
const TOKEN = process.env.ASSISTANT_TOKEN || '';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  violet: (s) => `\x1b[38;5;141m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const headers = (json = true) => ({ ...(json ? { 'Content-Type': 'application/json' } : {}), ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) });

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, { ...opts, headers: headers(!!opts.body), body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function gatewayUp() {
  try {
    await api('/api/health');
    return true;
  } catch {
    return false;
  }
}

function help() {
  console.log(`
${c.bold('Personal AI Assistant')} — open-source, runs on your machine

${c.bold('Usage')}
  assistant start               Start the gateway (web app at ${BASE})
  assistant chat [--session ID] Chat in this terminal
  assistant send "message"      Send one message and print the reply
  assistant status              Model, permission mode, channels, pending approvals
  assistant doctor              Check Node, the model server, models and browser

${c.bold('Environment')}
  PORT=6100  HOST=127.0.0.1  OLLAMA_URL=…  ASSISTANT_DATA=./data
  ASSISTANT_URL / ASSISTANT_TOKEN   talk to a gateway on another machine
`);
}

// ------------------------------------------------------------ chat

async function* sse(url) {
  const res = await fetch(url, { headers: headers(false) });
  if (!res.ok) throw new Error(`Event stream failed: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (data) {
        try {
          yield JSON.parse(data);
        } catch {
          /* skip */
        }
      }
    }
  }
}

async function chat(args) {
  if (!(await gatewayUp())) {
    console.log(c.red(`The gateway isn't running at ${BASE}. Start it with: npm start`));
    process.exit(1);
  }
  const state = await api('/api/state');
  const name = state.settings.assistantName || 'Assistant';
  const idx = args.indexOf('--session');
  let sessionId = idx >= 0 ? args[idx + 1] : `cli-${Date.now().toString(36)}`;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n${c.violet('●')} ${c.bold(name)} ${c.dim(`· ${state.provider?.resolved?.chat || 'no model'} · ${state.settings.permissionMode} mode`)}`);
  console.log(c.dim('  /new  fresh conversation   /stop  stop   /exit  quit\n'));

  let waiting = null;
  let printed = '';
  let busy = false;

  (async () => {
    for await (const ev of sse(`${BASE}/api/events`)) {
      if (ev.sessionId && ev.sessionId !== sessionId) {
        if (ev.type === 'notification' && ev.level !== 'memory') process.stdout.write(`\n${c.yellow('🔔')} ${ev.title || ''} ${ev.text}\n`);
        continue;
      }
      switch (ev.type) {
        case 'run_start':
          printed = '';
          process.stdout.write(`${c.violet(name)} ${c.dim('›')} `);
          break;
        case 'delta':
          printed += ev.text;
          process.stdout.write(ev.text);
          break;
        case 'assistant_text':
          if (ev.text && !printed.trim()) process.stdout.write(ev.text);
          if (!ev.final) printed = '';
          break;
        case 'status':
          process.stdout.write(c.dim(`(${ev.text}) `));
          break;
        case 'tool_start': {
          const arg = Object.values(ev.call.args || {}).map(String).join(' ').slice(0, 90);
          process.stdout.write(`\n  ${c.dim(`⚙ ${ev.call.name} ${arg}`)}`);
          break;
        }
        case 'tool_end':
          process.stdout.write(` ${ev.result.status === 'ok' ? c.green('✓') : c.red(`✗ ${ev.result.status}`)}\n  `);
          break;
        case 'approval': {
          const a = ev.approval;
          process.stdout.write(`\n${c.yellow('⚠ Needs your OK:')} ${a.summary}\n`);
          const ans = await rl.question(c.yellow('  Approve? [y/N] '));
          await api(`/api/approvals/${a.id}`, { method: 'POST', body: { decision: /^y/i.test(ans.trim()) ? 'approve' : 'deny' } }).catch((e) => console.log(c.red(e.message)));
          break;
        }
        case 'run_end':
          if (ev.error) process.stdout.write(c.red(`\n${ev.message?.content || ev.error}`));
          process.stdout.write('\n\n');
          busy = false;
          waiting?.();
          break;
        default:
          break;
      }
    }
  })().catch((err) => {
    console.log(c.red(`\nLost connection to the gateway: ${err.message}`));
    process.exit(1);
  });

  for (;;) {
    const text = (await rl.question(c.bold('you › '))).trim();
    if (!text) continue;
    if (text === '/exit' || text === '/quit') break;
    if (text === '/new') {
      sessionId = `cli-${Date.now().toString(36)}`;
      console.log(c.dim('  Started a fresh conversation.\n'));
      continue;
    }
    if (text === '/stop') {
      await api('/api/chat/stop', { method: 'POST', body: { sessionId } });
      continue;
    }
    busy = true;
    const done = new Promise((r) => (waiting = r));
    try {
      await api('/api/chat', { method: 'POST', body: { sessionId, text, channel: 'cli' } });
    } catch (err) {
      console.log(c.red(err.message));
      busy = false;
      continue;
    }
    if (busy) await done;
  }
  rl.close();
  process.exit(0);
}

// ------------------------------------------------------------ other commands

async function send(text) {
  if (!text) return console.log('Usage: assistant send "your message"');
  const r = await api('/api/v1/message', { method: 'POST', body: { text, sessionId: 'cli-send' } });
  console.log(r.reply);
}

async function status() {
  if (!(await gatewayUp())) return console.log(c.red(`Gateway not running at ${BASE}`));
  const s = await api('/api/state');
  const r = s.provider?.resolved;
  console.log(`${c.bold(s.settings.assistantName)} ${c.dim(`v${s.version} · ${BASE}`)}`);
  console.log(`  model       ${s.provider.ok ? (r ? c.green(r.chat) + (r.vision && r.vision !== r.chat ? c.dim(` + ${r.vision} (vision)`) : '') : c.yellow('none installed')) : c.red(`unreachable (${s.provider.url})`)}`);
  console.log(`  permissions ${s.settings.permissionMode}`);
  console.log(`  channels    ${s.channels.map((ch) => `${ch.name}:${ch.status === 'connected' ? c.green(ch.status) : c.dim(ch.status)}`).join('  ')}`);
  console.log(`  approvals   ${s.approvals.length ? c.yellow(`${s.approvals.length} waiting`) : 'none waiting'}`);
  console.log(`  running     ${s.running.length ? s.running.join(', ') : 'idle'}`);
}

async function doctor() {
  const ok = (m) => console.log(`  ${c.green('✓')} ${m}`);
  const bad = (m) => console.log(`  ${c.red('✗')} ${m}`);
  const warn = (m) => console.log(`  ${c.yellow('!')} ${m}`);
  console.log(c.bold('\nChecking your setup…\n'));
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj > 22 || (maj === 22 && min >= 5)) ok(`Node.js ${process.versions.node}`);
  else bad(`Node.js ${process.versions.node} — version 22.5 or newer is required (for built-in SQLite)`);

  const up = await gatewayUp();
  up ? ok(`Gateway running at ${BASE}`) : warn(`Gateway not running at ${BASE} (start it with: npm start)`);

  const ollama = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  try {
    const res = await fetch(`${ollama}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const j = await res.json();
    ok(`Ollama reachable at ${ollama}`);
    if (!j.models?.length) bad('No models installed — run: ollama pull qwen3:8b   (or llama3.2:3b on smaller machines)');
    let withTools = 0;
    for (const m of j.models || []) {
      const show = await fetch(`${ollama}/api/show`, { method: 'POST', body: JSON.stringify({ model: m.name }) }).then((r) => r.json()).catch(() => ({}));
      const caps = show.capabilities || [];
      if (caps.includes('tools')) withTools++;
      console.log(`      ${m.name.padEnd(28)} ${c.dim(caps.join(', '))}`);
    }
    if (j.models?.length && !withTools) warn('No tool-capable model installed — the assistant will use a slower text-based tool protocol. Try: ollama pull qwen3:8b');
  } catch {
    warn(`Ollama not reachable at ${ollama} — install it from https://ollama.com (or use an OpenAI-compatible server in Settings)`);
  }

  const { findBrowser } = await import('../src/tools/browser.js').catch(() => ({}));
  const b = findBrowser?.(process.env.BROWSER_PATH || '');
  b ? ok(`Browser for automation: ${b}`) : warn('No Chrome/Edge/Brave/Chromium found — the browser tool will be unavailable');
  console.log('');
}

// ------------------------------------------------------------ main

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') help();
  else if (cmd === 'start') spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src', 'server.js')], { stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
  else if (cmd === 'chat') await chat(rest);
  else if (cmd === 'send') await send(rest.join(' '));
  else if (cmd === 'status') await status();
  else if (cmd === 'doctor') await doctor();
  else {
    console.log(c.red(`Unknown command "${cmd}"`));
    help();
  }
} catch (err) {
  console.error(c.red(err.message));
  process.exit(1);
}
