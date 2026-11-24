import { api, esc, el, $, $$, icon, toast, modal, copy } from './util.js';
import { state, go, refreshState } from '../app.js';

const SECTIONS = [
  ['assistant', 'Assistant'],
  ['model', 'Model'],
  ['permissions', 'Permissions'],
  ['tools', 'Tools'],
  ['web', 'Web & browser'],
  ['remote', 'Remote access'],
  ['data', 'Data'],
  ['about', 'About'],
];

const MODES = [
  ['ask', 'shield', 'Ask first', 'Looks things up freely. Commands, edits outside the workspace and actions on websites wait for your OK.'],
  ['auto', 'bolt', 'Auto', 'Everything runs without asking. Hard blocks on destructive commands still apply. For trusted setups.'],
  ['readonly', 'search', 'Read-only', 'Can search, read and remember — but never changes files, runs commands or acts on websites.'],
];

const GROUP_INFO = {
  memory: 'Remember and recall facts about you',
  tasks: 'To-dos, reminders, schedules, calculator',
  web: 'Web search and reading pages',
  browser: 'Drive a real browser (click, type, screenshots)',
  files: 'Read and write files (workspace by default)',
  shell: 'Run terminal commands (asks first in Ask mode)',
  messaging: 'Message you on your connected apps',
  skills: 'Use and create skills',
  http: 'Call HTTP APIs (non-GET asks first)',
};

const save = async (patch, msg = 'Saved') => {
  try {
    await api('/api/settings', { method: 'PUT', body: patch });
    await refreshState();
    if (msg) toast(msg);
  } catch (err) {
    toast('Not saved', err.message, { error: true });
  }
};

function modelOptions(models, selected, filter) {
  const list = models.filter(filter);
  return `<option value="">Automatic (recommended)</option>${list.map((m) => `<option value="${esc(m.name)}" ${m.name === selected ? 'selected' : ''}>${esc(m.name)}${m.params ? ` · ${esc(m.params)}` : ''}${m.capabilities.includes('tools') ? ' · tools' : ''}${m.capabilities.includes('vision') ? ' · vision' : ''}</option>`).join('')}`;
}

export async function renderSettings(main, section = 'assistant') {
  const sec = SECTIONS.some(([k]) => k === section) ? section : 'assistant';
  main.innerHTML = '';
  const p = el(`<div class="page"><div class="page-inner" style="max-width:860px"><h1>Settings</h1><p class="lead">Everything is stored on this computer in the <code>data/</code> folder.</p><div class="settings-nav" id="secNav"></div><div id="sec"></div></div></div>`);
  main.append(p);
  for (const [k, label] of SECTIONS) {
    const c = el(`<a class="chip ${k === sec ? 'on' : ''}" href="#/settings/${k}">${label}</a>`);
    $('#secNav', p).append(c);
  }
  const box = $('#sec', p);
  const s = state.settings;
  await ({ assistant, model, permissions, tools, web, remote, data, about }[sec])(box, s);
}

// ---------------------------------------------------------------- sections

function assistant(box, s) {
  box.innerHTML = `<div class="card stack">
    <div class="grid2">
      <label class="field">Assistant's name<input id="aName"></label>
      <label class="field">Your name<input id="uName"></label>
    </div>
    <label class="field">Personality<span class="hint">How it talks and behaves.</span><textarea id="persona" rows="3"></textarea></label>
    <label class="field">About you<span class="hint">Included in every conversation — work, family, priorities, how you like things done.</span><textarea id="about" rows="6"></textarea></label>
    <label class="field">Time zone<input id="tz" placeholder="Europe/London"></label>
    <div class="row"><div class="grow"></div><button class="btn primary" id="saveA">Save</button></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="set-row"><div><div class="t">Desktop notifications</div><div class="d">Show reminders and messages even when this tab is in the background.</div></div><button class="btn sm" id="notif">${'Notification' in window && Notification.permission === 'granted' ? 'Enabled ✓' : 'Enable'}</button></div>
  <div class="set-row"><div><div class="t">Run setup again</div><div class="d">The welcome walkthrough.</div></div><button class="btn sm" id="reOnboard">Open</button></div></div>`;
  $('#aName', box).value = s.assistantName;
  $('#uName', box).value = s.userName;
  $('#persona', box).value = s.persona;
  $('#about', box).value = s.aboutUser;
  $('#tz', box).value = s.timezone;
  $('#saveA', box).onclick = () => save({ assistantName: $('#aName', box).value.trim() || 'Assistant', userName: $('#uName', box).value.trim(), persona: $('#persona', box).value, aboutUser: $('#about', box).value, timezone: $('#tz', box).value.trim() || s.timezone });
  $('#notif', box).onclick = async (e) => {
    if (!('Notification' in window)) return toast('Not supported in this browser');
    const r = await Notification.requestPermission();
    e.target.textContent = r === 'granted' ? 'Enabled ✓' : 'Blocked';
  };
  $('#reOnboard', box).onclick = () => openOnboarding();
}

async function model(box, s) {
  box.innerHTML = '<div class="card"><div class="row"><span class="spin"></span><span class="muted">Checking models…</span></div></div>';
  await refreshState(true);
  const p = state.provider;
  const models = p.models || [];
  box.innerHTML = `<div class="card stack">
    <div class="row"><span class="dot ${p.ok ? (p.resolved ? 'ok' : 'warn') : 'err'}"></span><div class="grow"><b>${p.ok ? (p.resolved ? `Using ${esc(p.resolved.chat)}` : 'Connected, but no models installed') : `Can't reach ${p.provider === 'ollama' ? 'Ollama' : 'the model server'} at ${esc(p.url)}`}</b>${p.error ? `<div class="faint" style="font-size:12.5px">${esc(p.error)}</div>` : ''}</div><button class="btn sm" id="refresh">${icon('refresh', 'sm')} Refresh</button></div>
    <label class="field">Provider<select id="prov"><option value="ollama">Ollama (local, recommended)</option><option value="openai">OpenAI-compatible server (LM Studio, llama.cpp, vLLM, LocalAI…)</option></select></label>
    <div id="ollamaBox"><label class="field">Ollama URL<input id="oUrl"></label></div>
    <div id="oaBox" class="grid2"><label class="field">Base URL<input id="oaUrl" placeholder="http://127.0.0.1:1234/v1"></label><label class="field">API key (if your server needs one)<input id="oaKey" type="password"></label></div>
    <div class="grid2">
      <label class="field">Chat model<span class="hint">Needs tool support to act. Automatic picks the best installed one.</span><select id="mChat">${modelOptions(models, s.model, (m) => !m.capabilities.includes('embedding'))}</select></label>
      <label class="field">Vision model<span class="hint">Used to look at images you send.</span><select id="mVision">${modelOptions(models, s.visionModel, (m) => m.capabilities.includes('vision'))}</select></label>
    </div>
    <div class="grid3">
      <label class="field">Context window<select id="ctx">${[4096, 8192, 16384, 32768, 65536].map((n) => `<option value="${n}" ${n === s.contextWindow ? 'selected' : ''}>${n.toLocaleString()} tokens</option>`).join('')}</select></label>
      <label class="field">Temperature<input id="temp" type="number" min="0" max="1.5" step="0.1"></label>
      <label class="field">Max tool steps per reply<input id="steps" type="number" min="1" max="30"></label>
    </div>
    <div class="row"><div class="grow"></div><button class="btn primary" id="saveM">Save</button></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Recommended local models</h3><p class="sub">Pick by your GPU memory. Run the command in a terminal, then press Refresh.</p>
    <table class="data"><tbody>
      <tr><td><code>ollama pull qwen3:8b</code></td><td class="muted">Best all-rounder with tools · ~6 GB VRAM</td></tr>
      <tr><td><code>ollama pull llama3.2:3b</code></td><td class="muted">Small & fast with tools · ~3 GB</td></tr>
      <tr><td><code>ollama pull gpt-oss:20b</code></td><td class="muted">Strongest reasoning · 16 GB+</td></tr>
      <tr><td><code>ollama pull gemma3:4b</code></td><td class="muted">Vision — reads photos & screenshots</td></tr>
    </tbody></table>
    <p class="faint" style="font-size:12.5px;margin:10px 0 0">Installed: ${models.length ? models.map((m) => `<code>${esc(m.name)}</code>`).join(' ') : 'none'}</p>
  </div>`;
  $('#prov', box).value = s.provider;
  $('#oUrl', box).value = s.ollamaUrl;
  $('#oaUrl', box).value = s.openaiBaseUrl;
  $('#oaKey', box).value = s.openaiApiKey;
  $('#temp', box).value = s.temperature;
  $('#steps', box).value = s.maxToolSteps;
  const sync = () => {
    $('#ollamaBox', box).classList.toggle('hidden', $('#prov', box).value !== 'ollama');
    $('#oaBox', box).classList.toggle('hidden', $('#prov', box).value === 'ollama');
  };
  sync();
  $('#prov', box).onchange = sync;
  $('#refresh', box).onclick = () => model(box, state.settings);
  $('#saveM', box).onclick = async () => {
    await save({ provider: $('#prov', box).value, ollamaUrl: $('#oUrl', box).value.trim(), openaiBaseUrl: $('#oaUrl', box).value.trim(), openaiApiKey: $('#oaKey', box).value, model: $('#mChat', box).value, visionModel: $('#mVision', box).value, contextWindow: Number($('#ctx', box).value), temperature: Number($('#temp', box).value), maxToolSteps: Number($('#steps', box).value) });
    model(box, state.settings);
  };
}

function permissions(box, s) {
  box.innerHTML = `<div class="card stack">
    <div><h3>Permission mode</h3><p class="sub">You can also switch this from the chat header.</p><div class="mode-cards" id="modes"></div></div>
    <label class="field">Workspace folder<span class="hint">Where the assistant reads and writes files by default.</span><input id="ws"></label>
    <div class="set-row"><div><div class="t">Full disk access</div><div class="d">Allow file tools outside the workspace. In Ask mode those still need your OK.</div></div><label class="switch"><input type="checkbox" id="fda"><span></span></label></div>
    <label class="field">Commands that never need approval<span class="hint">One per line. Exact prefix; pipes, redirects and chaining always ask.</span><textarea id="allow" rows="6" class="mono"></textarea></label>
    <label class="field" style="max-width:240px">Command timeout (seconds)<input id="tout" type="number" min="5" max="1800"></label>
    <div class="row"><div class="grow"></div><button class="btn primary" id="saveP">Save</button></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>${icon('shield', 'sm')} Always on</h3><ul class="steps">
    <li>Destructive system commands (wiping disks, formatting, recursive deletes of the root) are blocked in every mode.</li>
    <li>The browser tool never types into password fields.</li>
    <li>Web pages, files and tool results are marked as untrusted data for the model.</li>
    <li>Chat apps only answer people you've approved with a pairing code.</li>
    <li>Every tool call is logged under Activity.</li></ul></div>`;
  let mode = s.permissionMode;
  const paint = () => {
    const wrap = $('#modes', box);
    wrap.innerHTML = '';
    for (const [k, ic, label, desc] of MODES) {
      const c = el(`<div class="mode-card ${k === mode ? 'on' : ''}"><b>${icon(ic, 'sm')} ${label}</b><span>${desc}</span></div>`);
      c.onclick = () => {
        mode = k;
        paint();
      };
      wrap.append(c);
    }
  };
  paint();
  $('#ws', box).value = s.workspace;
  $('#fda', box).checked = !!s.fullDiskAccess;
  $('#allow', box).value = (s.shellAllowlist || []).join('\n');
  $('#tout', box).value = s.shellTimeoutSec;
  $('#saveP', box).onclick = () => save({ permissionMode: mode, workspace: $('#ws', box).value.trim(), fullDiskAccess: $('#fda', box).checked, shellAllowlist: $('#allow', box).value.split('\n').map((x) => x.trim()).filter(Boolean), shellTimeoutSec: Number($('#tout', box).value) });
}

function tools(box, s) {
  const byGroup = {};
  for (const t of state.tools) (byGroup[t.group] ||= []).push(t);
  box.innerHTML = '<div class="card" id="tg"></div>';
  for (const [g, list] of Object.entries(byGroup)) {
    const row = el(`<div class="set-row"><div style="min-width:0"><div class="t" style="text-transform:capitalize">${esc(g)}</div><div class="d">${esc(GROUP_INFO[g] || '')}</div><div class="faint mono" style="font-size:11.5px;margin-top:3px">${list.map((t) => esc(t.name)).join(' · ')}</div></div><label class="switch"><input type="checkbox" ${s.toolGroups?.[g] !== false ? 'checked' : ''}><span></span></label></div>`);
    row.querySelector('input').onchange = (e) => save({ toolGroups: { [g]: e.target.checked } }, `${g} tools ${e.target.checked ? 'on' : 'off'}`);
    $('#tg', box).append(row);
  }
}

function web(box, s) {
  const b = state.browser || {};
  box.innerHTML = `<div class="card stack">
    <h3>Search</h3>
    <label class="field">Search engine<select id="sp"><option value="duckduckgo">DuckDuckGo (no key needed)</option><option value="searxng">SearXNG (self-hosted, private)</option></select></label>
    <label class="field" id="sxBox">SearXNG URL<span class="hint">Your instance, with JSON output enabled in settings.yml.</span><input id="sx" placeholder="http://localhost:8080"></label>
    <h3 style="margin-top:8px">Browser</h3>
    <div class="set-row"><div><div class="t">Detected browser</div><div class="d mono">${esc(b.found || 'none found')}</div></div><span class="badge ${b.running ? 'ok' : ''}">${b.running ? 'running' : 'idle'}</span></div>
    <label class="field">Browser path override<input id="bp" placeholder="Leave empty to auto-detect Chrome / Edge / Brave / Chromium"></label>
    <div class="set-row"><div><div class="t">Show the browser window</div><div class="d">Watch it work — and sign in to sites yourself so it can use them later (the profile is kept in data/browser-profile).</div></div><label class="switch"><input type="checkbox" id="headful"><span></span></label></div>
    <div class="row"><div class="grow"></div><button class="btn primary" id="saveW">Save</button></div>
  </div>`;
  $('#sp', box).value = s.searchProvider;
  $('#sx', box).value = s.searxngUrl;
  $('#bp', box).value = s.browserPath;
  $('#headful', box).checked = !s.browserHeadless;
  const sync = () => $('#sxBox', box).classList.toggle('hidden', $('#sp', box).value !== 'searxng');
  sync();
  $('#sp', box).onchange = sync;
  $('#saveW', box).onclick = () => save({ searchProvider: $('#sp', box).value, searxngUrl: $('#sx', box).value.trim(), browserPath: $('#bp', box).value.trim(), browserHeadless: !$('#headful', box).checked }, 'Saved — applies next time the browser starts');
}

function remote(box, s) {
  box.innerHTML = `<div class="card stack">
    <p class="muted" style="margin:0">By default the gateway only listens on this computer. To reach it from your phone or for webhooks (WhatsApp, Twilio), expose it with a tunnel such as <code>cloudflared tunnel --url http://localhost:6100</code> or Tailscale. Remote visitors must enter the access token.</p>
    <label class="field">Access token<div class="copy-field"><input id="tok" type="password" readonly><button class="btn sm" id="show">Show</button><button class="btn sm" id="cp">${icon('copy', 'sm')}</button><button class="btn sm" id="regen">${icon('refresh', 'sm')} New</button></div></label>
    <label class="field">Public URL<span class="hint">The address the internet uses to reach this gateway (needed for Twilio signature checks and shown in webhook instructions).</span><input id="pub" placeholder="https://my-assistant.example.com"></label>
    <div class="row"><div class="grow"></div><button class="btn primary" id="saveR">Save</button></div>
  </div>`;
  $('#tok', box).value = s.accessToken;
  $('#pub', box).value = s.publicUrl;
  $('#show', box).onclick = (e) => {
    const i = $('#tok', box);
    i.type = i.type === 'password' ? 'text' : 'password';
    e.target.textContent = i.type === 'password' ? 'Show' : 'Hide';
  };
  $('#cp', box).onclick = () => copy($('#tok', box).value);
  $('#regen', box).onclick = async () => {
    const r = await api('/api/settings/token', { method: 'POST', body: {} });
    $('#tok', box).value = r.accessToken;
    await refreshState();
    toast('New access token', 'Old links and API clients need the new one.');
  };
  $('#saveR', box).onclick = () => save({ publicUrl: $('#pub', box).value.trim().replace(/\/$/, '') });
}

function data(box) {
  box.innerHTML = `<div class="card stack">
    <div class="set-row"><div><div class="t">Export everything</div><div class="d">Memories, to-dos, schedules, conversations and settings (secrets removed) as JSON.</div></div><a class="btn" href="/api/export" download>${icon('download', 'sm')} Export</a></div>
    <div class="set-row"><div><div class="t">Where your data lives</div><div class="d">A single SQLite file at <code>data/assistant.db</code>, skills you create in <code>data/skills/</code>, and files in the workspace folder. Back up the <code>data/</code> folder to keep everything.</div></div></div>
    <div class="set-row"><div><div class="t">What leaves this computer</div><div class="d">Only what tools fetch on your behalf (web searches, pages, APIs) and messages to chat apps you connect. With a local model, your conversations never leave the machine. No telemetry.</div></div></div>
  </div>`;
}

function about(box) {
  box.innerHTML = `<div class="card stack">
    <div class="row"><div class="brand-mark">${esc((state.settings.assistantName || 'A')[0])}</div><div><b>Personal AI Assistant</b> <span class="badge">v${esc(state.version || '')}</span><div class="faint" style="font-size:12.5px">Open source · MIT licence · runs on your machine</div></div></div>
    <ul class="steps">
      <li><b>Chat anywhere</b>: this web app, the terminal (<code>npm run chat</code>), Telegram, Discord, Slack, WhatsApp, SMS and phone calls.</li>
      <li><b>Remembers you</b>: long-term memory it builds as you talk, which you can see and edit.</li>
      <li><b>Proactive</b>: reminders, recurring tasks, a morning briefing — delivered where you are.</li>
      <li><b>Does things</b>: web research, a real browser, files, terminal commands, HTTP APIs — with approvals.</li>
      <li><b>Extensible</b>: skills are Markdown files; it can write new ones itself.</li>
    </ul>
    <p class="faint" style="font-size:12.5px;margin:0">Docs live in the project's <code>README.md</code> and <code>docs/</code> folder.</p>
  </div>`;
}

// ---------------------------------------------------------------- onboarding

export function openOnboarding() {
  const s = state.settings;
  const d = {
    assistantName: s.assistantName === 'Assistant' ? '' : s.assistantName,
    userName: s.userName,
    aboutUser: s.aboutUser,
    tone: 'friendly',
    permissionMode: s.permissionMode,
    model: s.model,
    visionModel: s.visionModel,
    briefing: true,
    briefingTime: '8:00',
  };
  const TONES = {
    friendly: ['Friendly & concise', 'Warm, direct and practical. Gets things done, keeps answers short, and checks in before doing anything risky.'],
    pro: ['Professional', 'Calm, precise and professional, like an excellent executive assistant. Structured answers, no fluff.'],
    playful: ['Playful', 'Upbeat and witty with a light sense of humour, but always useful and to the point.'],
  };
  let step = 0;
  const { box, close } = modal('<div id="ob"></div>', { wide: true });
  const root = $('#ob', box);

  const steps = [
    () => `<h2>👋 Let's set up your assistant</h2><p class="lead">It runs on this computer, remembers what matters to you, and can act for you — always asking before anything risky.</p>
      <div class="grid2"><label class="field">What should your assistant be called?<input id="o1" placeholder="e.g. Atlas"></label><label class="field">What should it call you?<input id="o2" placeholder="Your first name"></label></div>
      <div class="name-chips">${['Atlas', 'Nova', 'Sage', 'Juno', 'Orbit', 'Pilot'].map((n) => `<button class="chip" data-n="${n}">${n}</button>`).join('')}</div>`,
    () => `<h2>Tell it about you</h2><p class="lead">A few lines go a long way. This is included in every conversation; you can change it any time.</p>
      <label class="field">About you<textarea id="o3" rows="6" placeholder="I'm a product designer in Cairo. I care most about shipping my side project and getting fit. I like short answers and morning summaries. My partner is Sam."></textarea></label>
      <div class="field" style="margin-top:14px">Personality<div class="row wrap" id="tones" style="margin-top:6px"></div></div>`,
    () => {
      const p = state.provider || {};
      const models = p.models || [];
      return `<h2>Its brain</h2><p class="lead">Your assistant uses a model running locally through ${p.provider === 'openai' ? 'your OpenAI-compatible server' : 'Ollama'} — nothing you say leaves this computer.</p>
      ${!p.ok ? `<div class="msg-error">Can't reach ${esc(p.url || 'the model server')}. Install Ollama from ollama.com, start it, then come back (you can finish setup now and fix this later in Settings → Model).</div>` : !models.length ? `<div class="msg-error">Ollama is running but has no models. In a terminal run <code>ollama pull qwen3:8b</code> (or <code>llama3.2:3b</code> on smaller machines), then press Refresh.</div>` : `<div class="row" style="margin-bottom:10px"><span class="dot ok"></span><span>Found ${models.length} model${models.length === 1 ? '' : 's'}. Automatic picks <b>${esc(p.resolved?.chat || '—')}</b>${p.resolved?.vision ? ` and <b>${esc(p.resolved.vision)}</b> for images` : ''}.</span></div>`}
      <div class="grid2"><label class="field">Chat model<select id="o4">${modelOptions(models, d.model, (m) => !m.capabilities.includes('embedding'))}</select></label><label class="field">Vision model<select id="o5">${modelOptions(models, d.visionModel, (m) => m.capabilities.includes('vision'))}</select></label></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="oRefresh">${icon('refresh', 'sm')} Refresh</button></div>`;
    },
    () => `<h2>How much freedom?</h2><p class="lead">You can change this any time from the chat header.</p><div class="mode-cards" id="oModes"></div>
      <div class="card" style="margin-top:16px;padding:14px"><div class="set-row" style="padding:0"><div><div class="t">Morning briefing</div><div class="d">Each day: your to-dos, what's scheduled and relevant news.</div></div><div class="row"><input id="oTime" style="width:80px" value="${esc(d.briefingTime)}"><label class="switch"><input type="checkbox" id="oBrief" ${d.briefing ? 'checked' : ''}><span></span></label></div></div></div>`,
  ];

  const collect = () => {
    if (step === 0) {
      d.assistantName = $('#o1', root).value.trim();
      d.userName = $('#o2', root).value.trim();
    }
    if (step === 1) d.aboutUser = $('#o3', root).value;
    if (step === 2) {
      d.model = $('#o4', root)?.value ?? d.model;
      d.visionModel = $('#o5', root)?.value ?? d.visionModel;
    }
    if (step === 3) {
      d.briefing = $('#oBrief', root).checked;
      d.briefingTime = $('#oTime', root).value.trim() || '8:00';
    }
  };

  const paint = () => {
    root.innerHTML = `<div class="onboard-steps">${steps.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>${steps[step]()}
      <div class="modal-foot">${step ? '<button class="btn ghost" id="back">Back</button>' : '<button class="btn ghost" id="skip">Skip for now</button>'}<div class="grow"></div><button class="btn primary" id="next">${step === steps.length - 1 ? 'Start chatting' : 'Continue'}</button></div>`;
    if (step === 0) {
      $('#o1', root).value = d.assistantName;
      $('#o2', root).value = d.userName;
      $$('[data-n]', root).forEach((b) => (b.onclick = () => ($('#o1', root).value = b.dataset.n)));
      setTimeout(() => $('#o1', root).focus(), 30);
    }
    if (step === 1) {
      $('#o3', root).value = d.aboutUser;
      for (const [k, [label]] of Object.entries(TONES)) {
        const c = el(`<button class="chip ${d.tone === k ? 'on' : ''}">${label}</button>`);
        c.onclick = () => {
          d.tone = k;
          $$('#tones .chip', root).forEach((x) => x.classList.toggle('on', x === c));
        };
        $('#tones', root).append(c);
      }
    }
    if (step === 2) {
      $('#oRefresh', root).onclick = async () => {
        collect();
        await refreshState(true);
        paint();
      };
    }
    if (step === 3) {
      for (const [k, ic, label, desc] of MODES) {
        const c = el(`<div class="mode-card ${k === d.permissionMode ? 'on' : ''}"><b>${icon(ic, 'sm')} ${label}${k === 'ask' ? ' <span class="badge accent">recommended</span>' : ''}</b><span>${desc}</span></div>`);
        c.onclick = () => {
          d.permissionMode = k;
          $$('#oModes .mode-card', root).forEach((x) => x.classList.toggle('on', x === c));
        };
        $('#oModes', root).append(c);
      }
    }
    $('#back', root)?.addEventListener('click', () => {
      collect();
      step--;
      paint();
    });
    $('#skip', root)?.addEventListener('click', finish);
    $('#next', root).onclick = async () => {
      collect();
      if (step < steps.length - 1) {
        step++;
        paint();
      } else await finish();
    };
  };

  async function finish() {
    collect();
    try {
      await api('/api/onboard', {
        method: 'POST',
        body: {
          assistantName: d.assistantName || 'Assistant',
          userName: d.userName,
          aboutUser: d.aboutUser,
          persona: TONES[d.tone][1],
          permissionMode: d.permissionMode,
          model: d.model,
          visionModel: d.visionModel,
          dailyBriefing: { enabled: d.briefing, time: d.briefingTime },
        },
      });
      await refreshState();
      close();
      go('#/chat');
      toast(`Say hi to ${d.assistantName || 'your assistant'}!`, 'Try: “Remind me to drink water every 2 hours”.');
    } catch (err) {
      toast('Setup not saved', err.message, { error: true });
    }
  }
  paint();
}
