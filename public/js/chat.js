import { api, esc, el, $, icon, md, ago, toast, confirmDialog, fileToBase64, debounce, CHANNEL_LABEL, CHANNEL_COLORS } from './util.js';
import { state, go, approvalCard, refreshState } from '../app.js';

const TOOL_META = {
  remember: ['brain', 'Saved to memory', (a) => a.content],
  recall: ['brain', 'Searched memory', (a) => a.query],
  forget: ['brain', 'Forgot a memory', (a) => `#${a.id}`],
  web_search: ['search', 'Searched the web', (a) => a.query],
  web_fetch: ['page', 'Read a page', (a) => a.url],
  http_request: ['globe', 'HTTP request', (a) => `${a.method || 'GET'} ${a.url}`],
  browser: ['browser', 'Browser', (a) => [a.action, a.url || (a.index ? `[${a.index}]` : ''), a.text ? `"${a.text}"` : ''].filter(Boolean).join(' ')],
  read_file: ['file', 'Read a file', (a) => a.path],
  write_file: ['file', 'Wrote a file', (a) => a.path],
  list_files: ['folder', 'Listed a folder', (a) => a.path || 'workspace'],
  search_files: ['search', 'Searched files', (a) => a.query],
  run_command: ['terminal', 'Ran a command', (a) => a.command],
  todo_add: ['list', 'Added a to-do', (a) => a.title],
  todo_list: ['list', 'Checked to-dos', () => ''],
  todo_done: ['check', 'Completed a to-do', (a) => `#${a.id}`],
  schedule_task: ['clock', 'Scheduled', (a) => `${a.when} — ${a.what}`],
  list_scheduled: ['clock', 'Checked the schedule', () => ''],
  cancel_scheduled: ['clock', 'Cancelled a schedule', (a) => a.id],
  calculate: ['calc', 'Calculated', (a) => a.expression],
  send_message: ['message', 'Sent a message', (a) => `${a.channel ? `${a.channel}: ` : ''}${a.text}`],
  use_skill: ['bolt', 'Used skill', (a) => a.name],
  create_skill: ['bolt', 'Created a skill', (a) => a.name],
  current_time: ['clock', 'Checked the time', () => ''],
};

const SUGGESTIONS = [
  ['Plan my day', 'Look at my to-dos and help me plan today', 'Look at my to-do list and schedule, and help me plan today in focused blocks.'],
  ['Remind me later', '“Remind me to call mum at 6pm”', 'Remind me to call mum at 6pm today.'],
  ['Research something', 'Search the web and cite sources', 'Use web research: what are the best ways to reduce screen time, according to recent studies?'],
  ['Get to know me', 'Tell it about yourself once', "Ask me 5 quick questions to get to know me and my priorities, one at a time, and remember my answers."],
  ['Groceries from a recipe', 'Turn a dish into a shopping list', 'Make me a grocery list for a vegetarian lasagna for 4 people.'],
  ['Morning briefing', 'Your day at a glance', 'Give me my morning briefing.'],
];

let ui = null; // DOM refs for the mounted chat view
let live = null; // in-progress assistant turn
let attachments = [];
let showJobs = false;
let talkMode = false;
let recognition = null;

const toolMeta = (name) => TOOL_META[name] || ['sparkle', name, (a) => JSON.stringify(a)];
const newId = () => `web-${Math.random().toString(36).slice(2, 10)}`;

// ------------------------------------------------------------ mount

export async function renderChat(main, sessionId) {
  state.current = sessionId || null;
  main.innerHTML = '';
  const name = esc(state.settings?.assistantName || 'Assistant');
  const root = el(`
    <div class="chat">
      <div class="sessions">
        <div class="sessions-head">
          <button class="btn primary grow" id="newChat">${icon('plus', 'sm')} New chat</button>
          <button class="btn ghost icon ${showJobs ? 'on' : ''}" id="toggleJobs" title="Show scheduled-task runs">${icon('clock', 'sm')}</button>
        </div>
        <div class="sessions-list" id="sessList"></div>
      </div>
      <div class="conv">
        <div class="conv-head">
          <button class="btn ghost icon menu-btn" id="menuBtn" title="Conversations">${icon('list')}</button>
          <div class="conv-title" id="convTitle" title="Click to rename">New conversation</div>
          <span id="convTag"></span>
          <div class="grow"></div>
          <select class="mode-select" id="modeSel" title="Permission mode">
            <option value="ask">🛡 Ask first</option>
            <option value="auto">⚡ Auto</option>
            <option value="readonly">👁 Read-only</option>
          </select>
          <button class="btn ghost icon" id="talkBtn" title="Talk mode: speak replies aloud and keep listening">${icon('speaker')}</button>
          <button class="btn ghost icon" id="delChat" title="Delete conversation">${icon('trash')}</button>
        </div>
        <div class="messages" id="msgs"><div class="thread" id="thread"></div></div>
        <div class="composer-wrap">
          <div class="composer" id="composer">
            <div class="attachments" id="atts"></div>
            <textarea id="input" rows="1" placeholder="Message ${name}…"></textarea>
            <div class="composer-bar">
              <button class="btn ghost icon" id="attachBtn" title="Attach an image">${icon('image')}</button>
              <input type="file" id="fileInput" accept="image/*" multiple hidden>
              <button class="btn ghost icon mic" id="micBtn" title="Dictate">${icon('mic')}</button>
              <div class="grow"></div>
              <span class="faint" style="font-size:12px;margin-right:6px" id="modelHint"></span>
              <button class="send" id="sendBtn" title="Send">${icon('send')}</button>
            </div>
          </div>
          <div class="composer-hint">Runs privately on this computer · risky actions ask first · <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</div>
        </div>
      </div>
    </div>`);
  main.append(root);
  ui = {
    root,
    sessList: $('#sessList', root),
    thread: $('#thread', root),
    msgs: $('#msgs', root),
    input: $('#input', root),
    send: $('#sendBtn', root),
    title: $('#convTitle', root),
    tag: $('#convTag', root),
    atts: $('#atts', root),
    mode: $('#modeSel', root),
    talk: $('#talkBtn', root),
    mic: $('#micBtn', root),
    hint: $('#modelHint', root),
  };
  wire(root);
  syncHeader();
  renderSessions();
  refreshSessions();
  if (state.current) await loadSession(state.current);
  else renderWelcome();
  ui.input.focus();
  // Prompts handed over from other pages (quick actions, "try this skill").
  const prefill = sessionStorage.getItem('pa-prefill');
  const draft = sessionStorage.getItem('pa-draft');
  sessionStorage.removeItem('pa-prefill');
  sessionStorage.removeItem('pa-draft');
  if (prefill || draft) {
    ui.input.value = prefill || draft;
    autosize();
    if (prefill) send();
  }
}

function wire(root) {
  $('#newChat', root).onclick = () => go('#/chat');
  $('#menuBtn', root).onclick = () => root.classList.toggle('show-sessions');
  ui.sessList.addEventListener('click', (e) => e.target.closest('.sess') && root.classList.remove('show-sessions'));
  $('#toggleJobs', root).onclick = (e) => {
    showJobs = !showJobs;
    e.currentTarget.classList.toggle('on', showJobs);
    e.currentTarget.style.color = showJobs ? 'var(--accent-strong)' : '';
    refreshSessions();
  };
  $('#delChat', root).onclick = async () => {
    if (!state.current) return;
    if (!(await confirmDialog('Delete this conversation?', 'Its messages are removed. Memories and to-dos stay.'))) return;
    await api(`/api/sessions/${encodeURIComponent(state.current)}`, { method: 'DELETE' });
    go('#/chat');
  };
  ui.title.onclick = () => {
    if (!state.current) return;
    ui.title.contentEditable = 'true';
    ui.title.focus();
    document.getSelection().selectAllChildren(ui.title);
  };
  ui.title.onblur = async () => {
    if (ui.title.contentEditable !== 'true') return;
    ui.title.contentEditable = 'false';
    const t = ui.title.textContent.trim();
    if (t && state.current) await api(`/api/sessions/${encodeURIComponent(state.current)}`, { method: 'PATCH', body: { title: t } });
    refreshSessions();
  };
  ui.title.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ui.title.blur();
    }
  };
  ui.mode.onchange = async () => {
    await api('/api/settings', { method: 'PUT', body: { permissionMode: ui.mode.value } });
    await refreshState();
    toast('Permission mode', { ask: 'Risky actions will ask you first.', auto: 'Tools run without asking. Hard blocks still apply.', readonly: 'Look-ups only — no changes.' }[ui.mode.value]);
  };
  ui.input.addEventListener('input', autosize);
  ui.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  ui.input.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      for (const f of files) await addAttachment(f);
    }
  });
  const composer = $('#composer', root);
  composer.addEventListener('dragover', (e) => e.preventDefault());
  composer.addEventListener('drop', async (e) => {
    e.preventDefault();
    for (const f of [...e.dataTransfer.files].filter((x) => x.type.startsWith('image/'))) await addAttachment(f);
  });
  $('#attachBtn', root).onclick = () => $('#fileInput', root).click();
  $('#fileInput', root).onchange = async (e) => {
    for (const f of e.target.files) await addAttachment(f);
    e.target.value = '';
  };
  ui.send.onclick = () => (isBusy() ? stop() : send());
  ui.mic.onclick = () => dictate();
  ui.talk.onclick = () => {
    talkMode = !talkMode;
    ui.talk.style.color = talkMode ? 'var(--accent-strong)' : '';
    ui.talk.style.background = talkMode ? 'var(--accent-soft)' : '';
    if (!talkMode) {
      speechSynthesis?.cancel();
      recognition?.stop();
    }
    toast(talkMode ? 'Talk mode on' : 'Talk mode off', talkMode ? 'Replies are spoken, then I listen again. Uses your browser’s speech features.' : '');
    if (talkMode) dictate();
  };
}

function autosize() {
  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(ui.input.scrollHeight, 220)}px`;
  syncSend();
}

const isBusy = () => !!state.current && state.running.has(state.current);

function syncSend() {
  if (!ui) return;
  const busy = isBusy();
  ui.send.classList.toggle('stop', busy);
  ui.send.innerHTML = busy ? icon('stop') : icon('send');
  ui.send.title = busy ? 'Stop' : 'Send';
  ui.send.disabled = !busy && !ui.input.value.trim() && !attachments.length;
}

export function syncHeader() {
  if (!ui) return;
  ui.mode.value = state.settings?.permissionMode || 'ask';
  const r = state.provider?.resolved;
  ui.hint.textContent = r ? r.chat : '';
  ui.input.placeholder = `Message ${state.settings?.assistantName || 'Assistant'}…`;
  syncSend();
}

async function addAttachment(file) {
  if (attachments.length >= 4) return toast('Up to 4 images per message');
  try {
    attachments.push(await fileToBase64(file));
    renderAttachments();
  } catch (err) {
    toast('Could not read image', err.message, { error: true });
  }
}

function renderAttachments() {
  ui.atts.innerHTML = '';
  attachments.forEach((src, i) => {
    const a = el(`<div class="att"><img src="${src}" alt=""><button title="Remove">×</button></div>`);
    a.querySelector('button').onclick = () => {
      attachments.splice(i, 1);
      renderAttachments();
    };
    ui.atts.append(a);
  });
  syncSend();
}

// ------------------------------------------------------------ sessions list

export const refreshSessions = debounce(async () => {
  try {
    state.sessions = await api(`/api/sessions${showJobs ? '?jobs=1' : ''}`);
    renderSessions();
  } catch {
    /* offline */
  }
}, 150);

function renderSessions() {
  if (!ui) return;
  const list = state.sessions || [];
  ui.sessList.innerHTML = list.length ? '' : '<div class="empty">No conversations yet.</div>';
  for (const s of list) {
    const ch = s.channel;
    const running = state.running.has(s.id);
    const a = el(`<a class="sess ${s.id === state.current ? 'active' : ''}" href="#/chat/${encodeURIComponent(s.id)}">
      <div class="sess-title">${running ? '<span class="dot ok pulse"></span>' : ''}<span style="overflow:hidden;text-overflow:ellipsis">${esc(s.title || (ch === 'web' ? 'New conversation' : `${CHANNEL_LABEL[ch] || ch} chat`))}</span></div>
      <div class="sess-prev">${esc((s.last_message || '').replace(/[#*_`>]/g, '').slice(0, 90)) || '&nbsp;'}</div>
      <div class="sess-meta">${ch !== 'web' ? `<span class="ch-tag" style="color:${CHANNEL_COLORS[ch] || 'inherit'}">${esc(CHANNEL_LABEL[ch] || ch)}</span>` : ''}<span>${ago(s.updated_at)}</span></div>
    </a>`);
    ui.sessList.append(a);
  }
}

// ------------------------------------------------------------ thread rendering

function renderWelcome() {
  const s = state.settings || {};
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  ui.title.textContent = 'New conversation';
  ui.tag.innerHTML = '';
  ui.thread.innerHTML = '';
  const w = el(`<div class="welcome">
    <div class="big-mark">${esc((s.assistantName || 'A')[0].toUpperCase())}</div>
    <h2>${greet}${s.userName ? `, ${esc(s.userName)}` : ''}.</h2>
    <p>I'm ${esc(s.assistantName || 'your assistant')}. I can remember things, set reminders, research the web, use a browser and work with your files — privately, on this computer.</p>
    <div class="suggestions"></div>
  </div>`);
  for (const [title, sub, prompt] of SUGGESTIONS) {
    const b = el(`<div class="suggestion"><b>${esc(title)}</b><span>${esc(sub)}</span></div>`);
    b.onclick = () => {
      ui.input.value = prompt;
      autosize();
      send();
    };
    $('.suggestions', w).append(b);
  }
  ui.thread.append(w);
}

async function loadSession(id) {
  let data;
  try {
    data = await api(`/api/sessions/${encodeURIComponent(id)}`);
  } catch {
    ui.thread.innerHTML = '<div class="empty">This conversation doesn\'t exist any more.</div>';
    return;
  }
  if (state.current !== id) return;
  const ch = data.session.channel;
  ui.title.textContent = data.session.title || 'New conversation';
  ui.tag.innerHTML = ch !== 'web' ? `<span class="ch-tag" style="color:${CHANNEL_COLORS[ch] || 'inherit'}">${esc(CHANNEL_LABEL[ch] || ch)}</span>` : '';
  if (data.running) state.running.add(id);
  renderThread(data.messages);
  if (data.running) {
    live = null;
    ensureLive();
  }
  syncSend();
}

function userBubble(m) {
  const imgs = (m.images || []).map((src) => `<img src="${esc(src)}" alt="attached image">`).join('');
  const meta = m.meta || {};
  const node = el(`<div class="msg-user" data-id="${m.id}">${imgs ? `<div class="imgs">${imgs}</div>` : ''}<span></span></div>`);
  node.querySelector('span').textContent = meta.origin === 'job' ? m.content.split('\n')[0] : m.content;
  return node;
}

function newTurn(label = '') {
  const s = state.settings || {};
  const t = el(`<div class="turn"><div class="avatar">${esc((s.assistantName || 'A')[0].toUpperCase())}</div><div class="turn-body">${label ? `<div class="turn-label">${label}</div>` : ''}</div></div>`);
  return t;
}

export function toolCard(call, result) {
  const [ic, label, argFn] = toolMeta(call.name);
  let arg = '';
  try {
    arg = argFn(call.args || {}) || '';
  } catch {
    /* odd args */
  }
  const status = result ? result.status : 'running';
  const card = el(`<div class="tool ${status}" data-call="${esc(call.id)}">
    <div class="tool-head"><span class="tool-ico">${icon(ic, 'sm')}</span><span class="tool-name">${esc(label)}</span><span class="tool-arg"></span><span class="tool-state"></span></div>
    <div class="tool-body"><div class="lbl">Input</div><pre class="tool-in"></pre><div class="lbl">Result</div><pre class="tool-out"></pre></div>
  </div>`);
  card.querySelector('.tool-arg').textContent = String(arg).slice(0, 160);
  card.querySelector('.tool-in').textContent = JSON.stringify(call.args || {}, null, 2);
  card.querySelector('.tool-head').onclick = () => card.classList.toggle('open');
  setToolResult(card, result);
  return card;
}

function setToolResult(card, result) {
  const st = card.querySelector('.tool-state');
  const out = card.querySelector('.tool-out');
  card.classList.remove('running', 'waiting', 'ok', 'error', 'denied');
  if (!result) {
    card.classList.add('running');
    st.innerHTML = '<span class="spin"></span>';
    out.textContent = '…';
    return;
  }
  if (result.status === 'waiting') {
    card.classList.add('waiting');
    st.innerHTML = '<span class="badge warn">waiting for you</span>';
    return;
  }
  card.classList.add(result.status);
  st.innerHTML = result.status === 'ok' ? icon('check', 'sm') : `<span class="badge ${result.status === 'denied' ? 'warn' : 'err'}">${result.status === 'denied' ? 'not done' : 'error'}</span>`;
  st.style.color = 'var(--mint)';
  out.textContent = result.output || '';
  if (result.image && !card.querySelector('.tool-shot')) {
    const img = el(`<img class="tool-shot" alt="screenshot" src="${esc(result.image)}">`);
    card.after(img);
  }
}

function textSeg(content, cls = '') {
  const d = el(`<div class="md ${cls}"></div>`);
  d.innerHTML = md(content);
  return d;
}

function renderThread(messages) {
  ui.thread.innerHTML = '';
  if (!messages.length) return renderWelcome();
  let turn = null;
  const cards = new Map();
  const body = () => {
    if (!turn) {
      turn = newTurn();
      ui.thread.append(turn);
    }
    return turn.querySelector('.turn-body');
  };
  for (const m of messages) {
    const meta = m.meta || {};
    if (m.role === 'user') {
      turn = null;
      if (meta.origin === 'job') {
        turn = newTurn(`${icon('clock', 'sm')} Scheduled task`);
        ui.thread.append(turn);
        continue;
      }
      ui.thread.append(userBubble(m));
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      if (m.content?.trim()) body().append(textSeg(m.content));
      for (const c of m.tool_calls) {
        const card = toolCard(c, { status: 'ok', output: '' });
        cards.set(c.id, card);
        body().append(card);
      }
    } else if (m.role === 'tool') {
      const card = cards.get(m.tool_call_id);
      if (card) setToolResult(card, { status: meta.status || 'ok', output: m.content, image: meta.image });
    } else if (m.role === 'assistant') {
      if (meta.from === 'job' || meta.from === 'tool') {
        turn = newTurn(`${icon(meta.from === 'job' ? 'clock' : 'message', 'sm')} ${esc(meta.title || (meta.from === 'job' ? 'Scheduled' : 'Message'))}`);
        ui.thread.append(turn);
      }
      body().append(meta.error ? el(`<div class="msg-error">${esc(m.content)}</div>`) : textSeg(m.content, meta.stopped ? 'faint' : ''));
      turn = meta.from ? null : turn;
    }
  }
  for (const a of state.approvals.filter((x) => x.session_id === state.current)) body().append(approvalCard(a));
  scrollDown(true);
}

function scrollDown(force = false) {
  const m = ui?.msgs;
  if (!m) return;
  const near = m.scrollHeight - m.scrollTop - m.clientHeight < 160;
  if (force || near) requestAnimationFrame(() => (m.scrollTop = m.scrollHeight));
}

// ------------------------------------------------------------ live streaming

function ensureLive(runId) {
  if (live && (!runId || live.runId === runId || !live.runId)) {
    if (runId) live.runId = runId;
    return live;
  }
  const turn = newTurn();
  const bodyEl = turn.querySelector('.turn-body');
  const thinking = el('<div class="thinking-wrap"><div class="thinking"><i></i><i></i><i></i></div></div>');
  bodyEl.append(thinking);
  ui.thread.querySelector('.welcome')?.remove();
  ui.thread.append(turn);
  live = { runId, turn, body: bodyEl, seg: null, text: '', cards: new Map(), thinking };
  scrollDown(true);
  return live;
}

let renderQueued = false;
function renderLiveText() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!live?.seg) return;
    live.seg.innerHTML = md(live.text);
    live.seg.classList.add('caret');
    scrollDown();
  });
}

function endSegment() {
  if (!live?.seg) return;
  live.seg.classList.remove('caret');
  if (!live.text.trim()) live.seg.remove();
  live.seg = null;
  live.text = '';
}

/** Shown again between steps (after a tool finishes) while the model works out what to do next. */
function showThinking() {
  if (!live || live.thinking) return;
  live.thinking = el('<div class="thinking-wrap"><div class="thinking"><i></i><i></i><i></i></div></div>');
  live.body.append(live.thinking);
}

function hideThinking() {
  if (live?.thinking) {
    live.thinking.remove();
    live.thinking = null;
  }
}

export function handleChatEvent(ev) {
  if (ev.type === 'run_start') state.running.add(ev.sessionId);
  if (ev.type === 'run_end') state.running.delete(ev.sessionId);
  if (['run_start', 'run_end', 'message', 'sessions_changed'].includes(ev.type)) refreshSessions();
  if (!ui || !document.body.contains(ui.root)) return;
  if (ev.sessionId !== state.current) {
    if (ev.type === 'run_start' || ev.type === 'run_end') renderSessions();
    return;
  }

  switch (ev.type) {
    case 'message': {
      const m = ev.message;
      if (ui.thread.querySelector(`[data-id="${m.id}"]`)) break;
      ui.thread.querySelector('.welcome')?.remove();
      if (m.role === 'user' && m.meta?.origin !== 'job') {
        ui.thread.append(userBubble(m));
        scrollDown(true);
      } else if (m.role === 'assistant' && !live) {
        loadSession(state.current);
      }
      break;
    }
    case 'run_start':
      ensureLive(ev.runId);
      syncSend();
      break;
    case 'status': {
      const l = ensureLive(ev.runId);
      if (l.thinking) l.thinking.innerHTML = `<div class="row"><span class="spin"></span><span class="status-line">${esc(ev.text)}</span></div>`;
      break;
    }
    case 'delta': {
      const l = ensureLive(ev.runId);
      hideThinking();
      if (!l.seg) {
        l.seg = el('<div class="md"></div>');
        l.body.append(l.seg);
      }
      l.text += ev.text;
      renderLiveText();
      break;
    }
    case 'assistant_text': {
      const l = ensureLive(ev.runId);
      if (!ev.text) {
        if (l.seg) {
          l.text = '';
          endSegment();
        }
        break;
      }
      hideThinking();
      if (!l.seg) {
        l.seg = el('<div class="md"></div>');
        l.body.append(l.seg);
      }
      l.text = ev.text;
      l.seg.innerHTML = md(l.text);
      if (!ev.final) endSegment();
      break;
    }
    case 'tool_start': {
      const l = ensureLive(ev.runId);
      hideThinking();
      endSegment();
      const card = toolCard(ev.call, null);
      l.cards.set(ev.call.id, card);
      l.body.append(card);
      scrollDown();
      break;
    }
    case 'tool_waiting': {
      const card = live?.cards.get(ev.callId);
      if (card) setToolResult(card, { status: 'waiting' });
      break;
    }
    case 'tool_end': {
      const card = live?.cards.get(ev.call.id);
      if (card) setToolResult(card, ev.result);
      showThinking();
      scrollDown();
      break;
    }
    case 'approval': {
      const l = ensureLive(ev.runId);
      hideThinking();
      l.body.append(approvalCard(ev.approval));
      scrollDown(true);
      break;
    }
    case 'run_end': {
      const finalText = ev.message?.content || '';
      live = null;
      loadSession(state.current).then(() => {
        if (talkMode && finalText && !ev.error && !ev.stopped) speak(finalText);
      });
      syncSend();
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------ actions

async function send() {
  const text = ui.input.value.trim();
  if ((!text && !attachments.length) || isBusy()) return;
  const images = attachments.slice();
  if (!state.current) {
    state.current = newId();
    history.replaceState(null, '', `#/chat/${state.current}`);
    ui.thread.innerHTML = '';
    ui.title.textContent = text.slice(0, 48) || 'Image';
  }
  ui.input.value = '';
  attachments = [];
  renderAttachments();
  autosize();
  state.running.add(state.current);
  syncSend();
  try {
    await api('/api/chat', { method: 'POST', body: { sessionId: state.current, text, images } });
  } catch (err) {
    state.running.delete(state.current);
    syncSend();
    toast('Message not sent', err.message, { error: true });
    ui.input.value = text;
  }
}

async function stop() {
  if (!state.current) return;
  await api('/api/chat/stop', { method: 'POST', body: { sessionId: state.current } }).catch(() => {});
}

// ------------------------------------------------------------ voice

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const clean = text.replace(/```[\s\S]*?```/g, ' code omitted ').replace(/[#*_`>|]/g, '').replace(/https?:\/\/\S+/g, 'link').slice(0, 1500);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = navigator.language || 'en-US';
  u.onend = () => talkMode && setTimeout(dictate, 250);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function dictate() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice input isn’t available in this browser', 'Try Chrome or Edge, or type instead.', { error: true });
  if (recognition) {
    recognition.stop();
    return;
  }
  recognition = new SR();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  const before = ui.input.value;
  ui.mic.classList.add('live');
  recognition.onresult = (e) => {
    const t = [...e.results].map((r) => r[0].transcript).join('');
    ui.input.value = (before ? `${before} ` : '') + t;
    autosize();
  };
  recognition.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Voice input stopped', e.error, { error: true });
  };
  recognition.onend = () => {
    ui.mic.classList.remove('live');
    recognition = null;
    if (ui.input.value.trim() && ui.input.value !== before) send();
  };
  recognition.start();
}

export function onRunningChanged() {
  syncSend();
  renderSessions();
}
