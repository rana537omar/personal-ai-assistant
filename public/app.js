import { api, esc, el, $, $$, icon, toast } from './js/util.js';
import { renderChat, handleChatEvent, syncHeader, onRunningChanged } from './js/chat.js';
import { renderFocus, renderMemory, renderSkills, renderSchedules, renderChannels, renderActivity, handleViewEvent } from './js/views.js';
import { renderSettings, openOnboarding } from './js/settings.js';

export const state = {
  settings: null,
  provider: null,
  channels: [],
  approvals: [],
  running: new Set(),
  sessions: [],
  current: null,
  view: null,
  tools: [],
  browser: null,
  platform: '',
};

export const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

// ------------------------------------------------------------ state

export async function refreshState(refreshModels = false) {
  const s = await api(`/api/state${refreshModels ? '?refresh=1' : ''}`);
  state.settings = s.settings;
  state.provider = s.provider;
  state.channels = s.channels;
  state.approvals = s.approvals;
  state.running = new Set(s.running);
  state.tools = s.tools;
  state.browser = s.browser;
  state.platform = s.platform;
  state.version = s.version;
  paintShell();
  return s;
}

function paintShell() {
  const s = state.settings || {};
  $('#brandName').textContent = s.assistantName || 'Assistant';
  $('#brandMark').textContent = (s.assistantName || 'A')[0].toUpperCase();
  document.title = `${s.assistantName || 'Assistant'} · Personal AI Assistant`;
  const p = state.provider;
  const dot = $('#modelDot');
  if (!p) return;
  if (!p.ok) {
    dot.className = 'dot err';
    $('#modelName').textContent = p.provider === 'ollama' ? 'Ollama offline' : 'Model server offline';
    $('#modelSub').textContent = 'click for help';
  } else if (!p.resolved) {
    dot.className = 'dot warn';
    $('#modelName').textContent = 'No model installed';
    $('#modelSub').textContent = 'click for help';
  } else {
    dot.className = 'dot ok';
    $('#modelName').textContent = p.resolved.chat;
    $('#modelSub').textContent = p.resolved.vision && p.resolved.vision !== p.resolved.chat ? `+ ${p.resolved.vision} for images` : 'running locally';
  }
  const pairs = (state.channels || []).reduce((n, c) => n + c.contacts.filter((x) => x.status === 'pending').length, 0);
  $('#pairCount').textContent = pairs;
  $('#pairCount').classList.toggle('hidden', !pairs);
  $('#approvalCount').textContent = state.approvals.length;
  $('#approvalCount').classList.toggle('hidden', !state.approvals.length);
  renderTray();
  syncHeader();
}

// ------------------------------------------------------------ approvals

export function approvalCard(a) {
  const card = el(`<div class="approval" data-approval="${esc(a.id)}">
    <div class="approval-title">${icon('shield', 'sm')} Needs your OK</div>
    <div class="what"></div>
    <div class="row"><button class="btn ok sm" data-d="approve">${icon('check', 'sm')} Approve</button><button class="btn sm" data-d="deny">${icon('x', 'sm')} Deny</button><span class="faint grow" style="font-size:12px;text-align:right">code ${esc(a.id)} · ${esc(a.tool)}</span></div>
  </div>`);
  card.querySelector('.what').textContent = a.summary || `${a.tool} ${JSON.stringify(a.args)}`;
  card.querySelectorAll('button').forEach((b) => {
    b.onclick = async () => {
      card.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try {
        await api(`/api/approvals/${encodeURIComponent(a.id)}`, { method: 'POST', body: { decision: b.dataset.d } });
      } catch (err) {
        toast('Could not answer', err.message, { error: true });
      }
    };
  });
  return card;
}

function renderTray() {
  const tray = $('#tray');
  tray.innerHTML = '';
  const onChat = state.view === 'chat';
  for (const a of state.approvals) {
    if (onChat && a.session_id === state.current) continue; // shown inline in the conversation
    const card = approvalCard(a);
    const session = a.session_id || '';
    const where = session.startsWith('job:') ? 'Scheduled task' : session.split(/[:-]/)[0];
    card.querySelector('.approval-title').insertAdjacentHTML('beforeend', `<a class="faint" style="margin-left:auto;font-size:12px;font-weight:500" href="#/chat/${encodeURIComponent(session)}">${esc(where)} →</a>`);
    tray.append(card);
  }
}

// ------------------------------------------------------------ events

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (msg) => {
    let ev;
    try {
      ev = JSON.parse(msg.data);
    } catch {
      return;
    }
    handleEvent(ev);
  };
  es.onerror = () => {
    $('#modelDot').className = 'dot err pulse';
    $('#modelName').textContent = 'Reconnecting…';
  };
  es.onopen = () => refreshState().catch(() => {});
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'approval':
      if (!state.approvals.some((a) => a.id === ev.approval.id)) state.approvals.unshift({ ...ev.approval, session_id: ev.sessionId });
      paintShell();
      if (document.hidden) notify('Approval needed', ev.approval.summary);
      break;
    case 'approval_decided':
      state.approvals = state.approvals.filter((a) => a.id !== ev.id);
      $$(`[data-approval="${CSS.escape(ev.id)}"]`).forEach((n) => n.remove());
      paintShell();
      break;
    case 'notification':
      if (ev.level === 'memory') toast('Memory', ev.text, { timeout: 4000 });
      else {
        toast(ev.title || 'Message', ev.text?.slice(0, 160));
        notify(ev.title || state.settings?.assistantName || 'Assistant', ev.text);
      }
      break;
    case 'pairing':
      toast('New contact wants to chat', `${ev.name || ev.peerId} on ${ev.channel} · code ${ev.code}. Approve it under Channels.`, { timeout: 9000 });
      refreshState().catch(() => {});
      break;
    case 'channels_changed':
    case 'settings_changed':
      refreshState().catch(() => {});
      break;
    case 'run_start':
    case 'run_end':
      if (ev.type === 'run_start') state.running.add(ev.sessionId);
      else state.running.delete(ev.sessionId);
      onRunningChanged();
      break;
    default:
      break;
  }
  handleChatEvent(ev);
  handleViewEvent(ev);
}

function notify(title, body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body: String(body || '').slice(0, 200), icon: '/favicon.svg' });
  } catch {
    /* unsupported */
  }
}

// ------------------------------------------------------------ router

async function route() {
  const hash = location.hash || '#/chat';
  const [, view = 'chat', ...rest] = hash.replace(/^#/, '').split('/');
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : null;
  state.view = view;
  $$('.nav a.item').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  document.getElementById('app').classList.remove('nav-open');
  const main = $('#view');
  const views = { chat: () => renderChat(main, arg), focus: () => renderFocus(main), memory: () => renderMemory(main), skills: () => renderSkills(main), schedules: () => renderSchedules(main), channels: () => renderChannels(main), activity: () => renderActivity(main), settings: () => renderSettings(main, arg) };
  try {
    await (views[view] || views.chat)();
  } catch (err) {
    main.innerHTML = `<div class="page"><div class="page-inner"><div class="msg-error">${esc(err.message)}</div></div></div>`;
  }
  renderTray();
}

// ------------------------------------------------------------ boot

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('pa-theme', t);
}

async function boot() {
  applyTheme(localStorage.getItem('pa-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  $('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#modelPill').onclick = () => go('#/settings/model');
  $('#mobileMenu').onclick = (e) => {
    e.stopPropagation();
    $('#app').classList.toggle('nav-open');
  };
  $('#view').addEventListener('click', () => $('#app').classList.remove('nav-open'));
  try {
    await refreshState();
  } catch (err) {
    $('#view').innerHTML = `<div class="page"><div class="page-inner"><div class="msg-error">Can't reach the assistant gateway: ${esc(err.message)}</div></div></div>`;
    return;
  }
  connectEvents();
  window.addEventListener('hashchange', route);
  await route();
  if (!state.settings.onboarded) openOnboarding();
}

boot();
