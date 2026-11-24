import { api, esc, el, $, $$, icon, ago, until, when, toast, modal, confirmDialog, copy, debounce, CHANNEL_LABEL } from './util.js';
import { state, go, refreshState } from '../app.js';

let current = null; // { name, refresh }
const page = (main, inner) => {
  main.innerHTML = '';
  const p = el(`<div class="page"><div class="page-inner">${inner}</div></div>`);
  main.append(p);
  return p;
};

/** Opens a fresh chat and sends `prompt` (or, with draft=true, just types it in). */
function startChat(prompt, draft = false) {
  sessionStorage.setItem(draft ? 'pa-draft' : 'pa-prefill', prompt);
  go('#/chat');
}

export function handleViewEvent(ev) {
  if (!current) return;
  const map = {
    focus: ['todos_changed', 'jobs_changed', 'job_run', 'memory'],
    memory: ['memory'],
    skills: ['skills_changed'],
    schedules: ['jobs_changed', 'job_run'],
    channels: ['channels_changed', 'pairing'],
    activity: ['run_end', 'approval_decided'],
  };
  if (state.view === current.name && (map[current.name] || []).includes(ev.type)) current.refresh();
}

// ================================================================ Focus

export async function renderFocus(main) {
  const s = state.settings || {};
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const p = page(main, `
    <p class="muted" style="margin:0 0 2px">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</p>
    <h1 class="hello">${greet}${s.userName ? `, ${esc(s.userName)}` : ''}.</h1>
    <div class="quick" id="quick"></div>
    <div class="stat-row" id="stats"></div>
    <div class="focus-grid">
      <div class="card">
        <div class="row"><h3 class="grow">To-dos</h3><span class="faint" id="todoCount"></span></div>
        <form class="row" id="todoForm" style="margin:10px 0 4px">
          <input id="todoTitle" placeholder="Add a to-do…" autocomplete="off">
          <input id="todoDue" placeholder="Due (e.g. friday 5pm)" style="max-width:190px" autocomplete="off">
          <button class="btn primary">${icon('plus', 'sm')}</button>
        </form>
        <div class="list" id="todos"></div>
      </div>
      <div class="stack">
        <div class="card"><div class="row"><h3 class="grow">Coming up</h3><a href="#/schedules" class="faint" style="font-size:12.5px">All schedules →</a></div><div class="list" id="upcoming"></div></div>
        <div class="card"><div class="row"><h3 class="grow">What I'm keeping in mind</h3><a href="#/memory" class="faint" style="font-size:12.5px">Memory →</a></div><div class="list" id="mind"></div></div>
      </div>
    </div>
    <div class="section-title">Recent activity</div>
    <div class="card" style="padding:6px 16px"><div class="list" id="recent"></div></div>`);

  const quick = [
    ['sparkle', 'Morning briefing', 'Give me my morning briefing.'],
    ['list', 'Plan my day', 'Look at my to-dos and schedule and help me plan today in focused blocks.'],
    ['clock', 'Weekly review', 'Run my weekly review.'],
    ['link', 'Summarize a link', 'Summarize this link for me: '],
    ['brain', 'What do you know about me?', 'What do you remember about me? Group it by topic.'],
  ];
  for (const [ic, label, prompt] of quick) {
    const b = el(`<button class="chip">${icon(ic, 'sm')} ${esc(label)}</button>`);
    b.onclick = () => startChat(prompt, prompt.endsWith(': '));
    $('#quick', p).append(b);
  }

  $('#todoForm', p).onsubmit = async (e) => {
    e.preventDefault();
    const title = $('#todoTitle', p).value.trim();
    if (!title) return;
    try {
      await api('/api/todos', { method: 'POST', body: { title, due: $('#todoDue', p).value.trim() || undefined } });
      $('#todoTitle', p).value = '';
      $('#todoDue', p).value = '';
      refresh();
    } catch (err) {
      toast('Could not add', err.message, { error: true });
    }
  };

  async function refresh() {
    const [todos, jobs, memories, audit] = await Promise.all([api('/api/todos'), api('/api/jobs'), api('/api/memories'), api('/api/audit?limit=8')]);
    const open = todos.filter((t) => !t.done);
    const overdue = open.filter((t) => t.due_at && t.due_at < Date.now());
    $('#stats', p).innerHTML = [
      [open.length, 'open to-dos'],
      [overdue.length, 'overdue'],
      [jobs.filter((j) => j.enabled).length, 'active schedules'],
      [memories.length, 'things remembered'],
    ].map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
    $('#todoCount', p).textContent = open.length ? `${open.length} open` : '';
    const list = $('#todos', p);
    list.innerHTML = '';
    const shown = [...open, ...todos.filter((t) => t.done).slice(0, 4)];
    if (!shown.length) list.innerHTML = '<div class="empty">Nothing on your list. Tell me what you need to get done.</div>';
    for (const t of shown) {
      const late = !t.done && t.due_at && t.due_at < Date.now();
      const row = el(`<div class="list-row">
        <button class="todo-check ${t.done ? 'done' : ''}" title="${t.done ? 'Mark as open' : 'Mark as done'}">${icon('check', 'sm')}</button>
        <span class="prio p${t.priority}" title="${['', 'High', 'Normal', 'Low'][t.priority]} priority"></span>
        <div class="grow" style="min-width:0"><div class="todo-title ${t.done ? 'done' : ''}"></div>${t.due_at ? `<div style="font-size:12px" class="${late ? '' : 'faint'}"><span ${late ? 'style="color:var(--danger)"' : ''}>${late ? 'Overdue · ' : ''}${esc(when(t.due_at))}</span></div>` : ''}</div>
        <button class="btn ghost icon sm" title="Delete">${icon('trash', 'sm')}</button>
      </div>`);
      row.querySelector('.todo-title').textContent = t.title;
      row.querySelector('.todo-check').onclick = async () => {
        await api(`/api/todos/${t.id}`, { method: 'PATCH', body: { done: !t.done } });
        refresh();
      };
      row.querySelector('[title=Delete]').onclick = async () => {
        await api(`/api/todos/${t.id}`, { method: 'DELETE' });
        refresh();
      };
      list.append(row);
    }

    const up = $('#upcoming', p);
    up.innerHTML = '';
    const next = jobs.filter((j) => j.enabled && j.next_run_at).slice(0, 5);
    if (!next.length) up.innerHTML = '<div class="empty">Nothing scheduled. Try “remind me to stretch every day at 3pm”.</div>';
    for (const j of next) {
      const row = el(`<div class="list-row"><span class="tool-ico">${icon('clock', 'sm')}</span><div class="grow" style="min-width:0"><div class="name" style="font-weight:550"></div><div class="faint" style="font-size:12px">${esc(j.human)}</div></div><span class="badge accent">${esc(until(j.next_run_at))}</span></div>`);
      row.querySelector('.name').textContent = j.name;
      up.append(row);
    }

    const mind = $('#mind', p);
    mind.innerHTML = '';
    const top = memories.filter((m) => ['project', 'goal', 'person', 'preference'].includes(m.kind)).sort((a, b) => b.importance - a.importance || b.updated_at - a.updated_at).slice(0, 6);
    if (!top.length) mind.innerHTML = '<div class="empty">I\'ll keep your projects, goals and preferences here as we talk.</div>';
    for (const m of top) {
      const row = el(`<div class="list-row"><span class="kind ${esc(m.kind)}">${esc(m.kind)}</span><div class="grow"></div></div>`);
      row.querySelector('.grow').textContent = m.content;
      mind.append(row);
    }

    const recent = $('#recent', p);
    recent.innerHTML = '';
    if (!audit.length) recent.innerHTML = '<div class="empty">No activity yet.</div>';
    for (const a of audit) {
      const row = el(`<div class="list-row"><span class="badge ${a.status === 'ok' || a.status === 'approved' ? 'ok' : a.status === 'error' ? 'err' : 'warn'}">${esc(a.status)}</span><span class="mono">${esc(a.name)}</span><span class="faint grow truncate" style="font-size:12.5px"></span><span class="faint" style="font-size:12px">${esc(ago(a.ts))}</span></div>`);
      row.querySelector('.truncate').textContent = a.input || '';
      recent.append(row);
    }
  }
  current = { name: 'focus', refresh: debounce(refresh, 200) };
  await refresh();
}

// ================================================================ Memory

const KINDS = ['preference', 'person', 'project', 'goal', 'routine', 'fact'];

export async function renderMemory(main) {
  let kind = '';
  let q = '';
  const p = page(main, `
    <div class="row"><div class="grow"><h1>Memory</h1><p class="lead">What your assistant knows about you. It learns from conversations — and you can edit anything here.</p></div></div>
    <div class="grid2" style="grid-template-columns: 1.6fr 1fr; align-items:start">
      <div class="card">
        <div class="row" style="margin-bottom:10px"><input id="memSearch" placeholder="Search memories…"><button class="btn primary" id="addMem">${icon('plus', 'sm')} Add</button></div>
        <div class="row wrap" id="kinds" style="margin-bottom:6px"></div>
        <div class="list" id="memList"></div>
      </div>
      <div class="stack">
        <div class="card">
          <h3>About you</h3><p class="sub">Always included in every conversation.</p>
          <textarea id="about" rows="7" placeholder="What you do, who matters to you, your priorities, how you like things done…"></textarea>
          <div class="row" style="margin-top:10px"><span class="faint grow" style="font-size:12px" id="aboutSaved"></span><button class="btn sm" id="saveAbout">Save</button></div>
        </div>
        <div class="card">
          <h3>Learning</h3>
          <div class="set-row"><div><div class="t">Learn from conversations</div><div class="d">Pulls lasting facts out of what you tell it, in the background.</div></div><label class="switch"><input type="checkbox" id="autoMem"><span></span></label></div>
        </div>
      </div>
    </div>`);
  $('#about', p).value = state.settings.aboutUser || '';
  $('#autoMem', p).checked = !!state.settings.autoMemory;
  $('#autoMem', p).onchange = async (e) => {
    await api('/api/settings', { method: 'PUT', body: { autoMemory: e.target.checked } });
    refreshState();
  };
  $('#saveAbout', p).onclick = async () => {
    await api('/api/settings', { method: 'PUT', body: { aboutUser: $('#about', p).value } });
    $('#aboutSaved', p).textContent = 'Saved';
    refreshState();
  };
  const chips = $('#kinds', p);
  for (const k of ['', ...KINDS]) {
    const c = el(`<button class="chip ${k === kind ? 'on' : ''}">${k || 'All'}</button>`);
    c.onclick = () => {
      kind = k;
      $$('.chip', chips).forEach((x) => x.classList.toggle('on', x === c));
      refresh();
    };
    chips.append(c);
  }
  $('#memSearch', p).oninput = debounce((e) => {
    q = e.target.value.trim();
    refresh();
  }, 200);
  $('#addMem', p).onclick = () => {
    const { box, close } = modal(`<h2>Add a memory</h2><p class="lead">One short sentence about you, someone in your life, a project or a preference.</p>
      <label class="field">Memory<textarea id="mText" rows="3" placeholder="e.g. My sister Lina's birthday is on 14 March."></textarea></label>
      <div class="grid2" style="margin-top:12px"><label class="field">Type<select id="mKind">${KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label>
      <label class="field">Importance<select id="mImp"><option value="5">5 — core</option><option value="4">4 — important</option><option value="3" selected>3 — useful</option><option value="2">2</option><option value="1">1 — trivia</option></select></label></div>
      <div class="modal-foot"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div>`);
    box.querySelector('[data-x]').onclick = close;
    box.querySelector('[data-ok]').onclick = async () => {
      try {
        await api('/api/memories', { method: 'POST', body: { content: $('#mText', box).value, kind: $('#mKind', box).value, importance: Number($('#mImp', box).value) } });
        close();
        refresh();
      } catch (err) {
        toast('Not saved', err.message, { error: true });
      }
    };
  };

  async function refresh() {
    const rows = await api(`/api/memories?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`);
    const list = $('#memList', p);
    list.innerHTML = rows.length ? '' : `<div class="empty">${q || kind ? 'No matches.' : 'Nothing yet. Tell your assistant about yourself — it will remember.'}</div>`;
    for (const m of rows) {
      const row = el(`<div class="list-row">
        <span class="kind ${esc(m.kind)}">${esc(m.kind)}</span>
        <div class="mem-text"><div class="txt"></div><div class="faint" style="font-size:11.5px">${m.source === 'auto' ? 'learned automatically' : m.source === 'assistant' ? 'saved by assistant' : 'added by you'} · ${esc(ago(m.updated_at))}</div></div>
        <span class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" class="${n <= m.importance ? 'on' : ''}" title="Importance ${n}">★</button>`).join('')}</span>
        <button class="btn ghost icon sm" data-del title="Forget">${icon('trash', 'sm')}</button>
      </div>`);
      const txt = row.querySelector('.txt');
      txt.textContent = m.content;
      txt.contentEditable = 'true';
      txt.title = 'Click to edit';
      txt.onblur = async () => {
        const v = txt.textContent.trim();
        if (v && v !== m.content) {
          await api(`/api/memories/${m.id}`, { method: 'PATCH', body: { content: v } });
          toast('Memory updated');
        }
      };
      txt.onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), txt.blur());
      row.querySelectorAll('.stars button').forEach((b) => {
        b.onclick = async () => {
          await api(`/api/memories/${m.id}`, { method: 'PATCH', body: { importance: Number(b.dataset.n) } });
          refresh();
        };
      });
      row.querySelector('[data-del]').onclick = async () => {
        await api(`/api/memories/${m.id}`, { method: 'DELETE' });
        refresh();
      };
      list.append(row);
    }
  }
  current = { name: 'memory', refresh: debounce(refresh, 300) };
  await refresh();
}

// ================================================================ Skills

export async function renderSkills(main) {
  const p = page(main, `
    <div class="row"><div class="grow"><h1>Skills</h1><p class="lead">Reusable playbooks your assistant loads when a request matches. It can also write new ones for itself.</p></div><button class="btn primary" id="newSkill">${icon('plus', 'sm')} New skill</button></div>
    <div class="skill-grid" id="skills"></div>`);
  $('#newSkill', p).onclick = () => editSkill(null);

  async function refresh() {
    const skills = await api('/api/skills');
    const grid = $('#skills', p);
    grid.innerHTML = '';
    for (const s of skills) {
      const card = el(`<div class="card skill">
        <div class="row"><span class="tool-ico">${icon('bolt', 'sm')}</span><span class="name grow"></span><label class="switch" title="Enabled"><input type="checkbox" ${s.enabled ? 'checked' : ''}><span></span></label></div>
        <div class="desc"></div>
        <div class="row"><span class="badge ${s.source === 'custom' ? 'accent' : ''}">${s.source === 'custom' ? (s.overridesBundled ? 'customised' : 'custom') : 'built-in'}</span><div class="grow"></div><button class="btn sm" data-edit>${icon('edit', 'sm')} ${s.source === 'custom' ? 'Edit' : 'View / customise'}</button><button class="btn sm ghost" data-try title="Try it in chat">${icon('play', 'sm')}</button></div>
      </div>`);
      card.querySelector('.name').textContent = s.name;
      card.querySelector('.desc').textContent = s.description;
      card.querySelector('input').onchange = async (e) => {
        await api(`/api/skills/${encodeURIComponent(s.name)}/toggle`, { method: 'POST', body: { enabled: e.target.checked } });
        refreshState();
      };
      card.querySelector('[data-edit]').onclick = () => editSkill(s.name);
      card.querySelector('[data-try]').onclick = () => startChat(`Use your ${s.name} skill.`);
      grid.append(card);
    }
  }

  async function editSkill(name) {
    const s = name ? await api(`/api/skills/${encodeURIComponent(name)}`) : null;
    const template = `---\nname: my-skill\ndescription: One line saying when to use this skill\n---\n\n1. First step — name the tool to use.\n2. Second step.\n\nOutput format: …\n\nNever pay, message other people or delete anything without the user's explicit OK.\n`;
    const { box, close } = modal(`<h2>${s ? esc(s.name) : 'New skill'}</h2>
      <p class="lead">${s?.source === 'bundled' ? 'Built-in skill. Saving creates your own customised copy (you can reset it later).' : 'Markdown with a small header. Keep steps short and name the tools to use.'}</p>
      ${s ? '' : '<label class="field">Name<input id="skName" placeholder="lowercase-with-dashes"></label><div class="spacer"></div>'}
      <textarea class="code" id="skRaw"></textarea>
      <div class="modal-foot">${s?.source === 'custom' ? `<button class="btn danger" data-del>${s.overridesBundled ? 'Reset to built-in' : 'Delete'}</button>` : ''}<div class="grow"></div><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, { wide: true });
    $('#skRaw', box).value = s ? s.raw : template;
    box.querySelector('[data-x]').onclick = close;
    box.querySelector('[data-del]')?.addEventListener('click', async () => {
      await api(`/api/skills/${encodeURIComponent(s.name)}`, { method: 'DELETE' });
      close();
      refresh();
    });
    box.querySelector('[data-ok]').onclick = async () => {
      const raw = $('#skRaw', box).value;
      const nm = s ? s.name : ($('#skName', box).value.trim() || (raw.match(/^name:\s*(.+)$/m) || [])[1] || '').trim();
      try {
        await api(`/api/skills/${encodeURIComponent(nm)}`, { method: 'PUT', body: { raw } });
        close();
        toast('Skill saved', nm);
        refresh();
      } catch (err) {
        toast('Not saved', err.message, { error: true });
      }
    };
  }
  current = { name: 'skills', refresh: debounce(refresh, 300) };
  await refresh();
}

// ================================================================ Schedules

export async function renderSchedules(main) {
  const p = page(main, `
    <h1>Schedules</h1><p class="lead">Reminders, recurring tasks and briefings. At the set time your assistant does the task and messages you with the result.</p>
    <div class="card">
      <h3>New schedule</h3><p class="sub">Or just ask in chat: “every weekday at 8:30, send me the weather and my top 3 to-dos”.</p>
      <div class="grid2">
        <label class="field">When<input id="jWhen" placeholder="every weekday at 8:30 · in 20 minutes · friday 5pm"><span class="hint" id="jPreview">&nbsp;</span></label>
        <label class="field">Deliver to<select id="jChan"></select></label>
      </div>
      <label class="field" style="margin-top:12px">What should happen<textarea id="jWhat" rows="2" placeholder="Remind me to stretch · Check the Hacker News front page and send me the 3 most interesting AI stories"></textarea></label>
      <div class="row" style="margin-top:12px"><input id="jName" placeholder="Label (optional)" style="max-width:280px"><div class="grow"></div><button class="btn primary" id="jAdd">${icon('plus', 'sm')} Schedule</button></div>
    </div>
    <div class="section-title">Scheduled</div>
    <div class="stack" id="jobs"></div>`);
  const chan = $('#jChan', p);
  chan.innerHTML = '<option value="web">This app (notification)</option>' + state.channels.filter((c) => c.status === 'connected').map((c) => `<option value="${esc(c.name)}">${esc(c.label)}</option>`).join('');
  $('#jWhen', p).oninput = debounce(async (e) => {
    const v = e.target.value.trim();
    const prev = $('#jPreview', p);
    if (!v) return (prev.innerHTML = '&nbsp;');
    const r = await api(`/api/parse-when?q=${encodeURIComponent(v)}`);
    prev.textContent = r.ok ? `✓ ${r.human} — next: ${r.next}` : 'Not understood yet…';
    prev.style.color = r.ok ? 'var(--mint)' : 'var(--faint)';
  }, 250);
  $('#jAdd', p).onclick = async () => {
    try {
      await api('/api/jobs', { method: 'POST', body: { when: $('#jWhen', p).value, prompt: $('#jWhat', p).value, name: $('#jName', p).value || undefined, channel: chan.value } });
      ['#jWhen', '#jWhat', '#jName'].forEach((s) => ($(s, p).value = ''));
      $('#jPreview', p).innerHTML = '&nbsp;';
      toast('Scheduled');
      refresh();
    } catch (err) {
      toast('Not scheduled', err.message, { error: true });
    }
  };

  async function refresh() {
    const jobs = await api('/api/jobs');
    const box = $('#jobs', p);
    box.innerHTML = jobs.length ? '' : '<div class="card empty">Nothing scheduled yet.</div>';
    for (const j of jobs) {
      const st = j.last_status;
      const card = el(`<div class="card" style="padding:14px 16px">
        <div class="row">
          <span class="tool-ico" style="${j.enabled ? 'color:var(--accent-strong);background:var(--accent-soft)' : ''}">${icon('clock', 'sm')}</span>
          <div class="grow" style="min-width:0"><div style="font-weight:600" class="jn"></div><div class="faint" style="font-size:12.5px">${esc(j.human)} · to ${esc(CHANNEL_LABEL[j.channel] || j.channel)}${j.enabled && j.next_run_at ? ` · next ${esc(when(j.next_run_at))}` : j.enabled ? '' : ' · paused'}</div></div>
          ${st ? `<span class="badge ${st === 'ok' ? 'ok' : st === 'silent' ? '' : st === 'running' ? 'accent' : 'err'}" title="Last run ${esc(ago(j.last_run_at))}">${esc(st === 'silent' ? 'nothing to report' : st)}</span>` : ''}
          <button class="btn sm" data-run title="Run now">${icon('play', 'sm')} Run</button>
          <label class="switch" title="${j.enabled ? 'Pause' : 'Resume'}"><input type="checkbox" ${j.enabled ? 'checked' : ''}><span></span></label>
          <button class="btn ghost icon sm" data-del title="Delete">${icon('trash', 'sm')}</button>
        </div>
        <details class="help" style="margin-top:8px"><summary>Details & runs</summary><div class="lbl faint" style="font-size:12px;margin-top:6px">Task</div><div class="detail-pre jp"></div><div class="runs"></div></details>
      </div>`);
      card.querySelector('.jn').textContent = j.name;
      card.querySelector('.jp').textContent = j.prompt;
      card.querySelector('[data-run]').onclick = async () => {
        await api(`/api/jobs/${j.id}/run`, { method: 'POST', body: {} });
        toast('Running now', j.name);
      };
      card.querySelector('input').onchange = async (e) => {
        try {
          await api(`/api/jobs/${j.id}`, { method: 'PATCH', body: { enabled: e.target.checked } });
        } catch (err) {
          toast('Could not change', err.message, { error: true });
        }
        refresh();
      };
      card.querySelector('[data-del]').onclick = async () => {
        if (await confirmDialog('Delete this schedule?', j.name)) {
          await api(`/api/jobs/${j.id}`, { method: 'DELETE' });
          refresh();
        }
      };
      card.querySelector('details').ontoggle = async (e) => {
        if (!e.target.open) return;
        const runs = await api(`/api/jobs/${j.id}/runs`);
        const r = card.querySelector('.runs');
        r.innerHTML = runs.length ? '' : '<div class="faint" style="font-size:12.5px">No runs yet.</div>';
        for (const run of runs) {
          const d = el(`<div style="margin-top:8px"><div class="row" style="font-size:12.5px"><span class="badge">${esc(run.status || '…')}</span><span class="faint">${esc(when(run.started_at))}</span></div><div class="detail-pre"></div></div>`);
          d.querySelector('.detail-pre').textContent = run.output || '';
          r.append(d);
        }
      };
      box.append(card);
    }
  }
  current = { name: 'schedules', refresh: debounce(refresh, 300) };
  await refresh();
}

// ================================================================ Channels

const CH = {
  telegram: {
    color: '#2aabee', letter: 'T',
    fields: [['token', 'Bot token', 'password', '123456:ABC-DEF…']],
    steps: ['Open Telegram and message <b>@BotFather</b>.', 'Send <code>/newbot</code>, pick a name and username.', 'Copy the token it gives you and paste it here.', 'Message your new bot — it replies with a pairing code. Approve it below.'],
  },
  discord: {
    color: '#5865f2', letter: 'D',
    fields: [['token', 'Bot token', 'password', 'From the Bot page of your Discord application']],
    steps: ['Go to discord.com/developers/applications → <b>New Application</b>.', 'Open <b>Bot</b> → <b>Reset Token</b> and copy it.', 'Turn on <b>Message Content Intent</b> on the same page.', 'OAuth2 → URL Generator → scope <code>bot</code>, permissions Send Messages + Read Message History → open the URL to add it to your server.', 'DM the bot (or @mention it) and approve the pairing code below.'],
  },
  slack: {
    color: '#4a154b', letter: 'S',
    fields: [['botToken', 'Bot token (xoxb-…)', 'password', 'xoxb-…'], ['appToken', 'App-level token (xapp-…)', 'password', 'xapp-… with connections:write']],
    steps: ['api.slack.com/apps → <b>Create New App</b> → From scratch.', '<b>Socket Mode</b>: enable it and create an app-level token with <code>connections:write</code> (xapp-…).', '<b>OAuth & Permissions</b>: add bot scopes <code>chat:write</code>, <code>im:history</code>, <code>app_mentions:read</code>; install to workspace; copy the xoxb- token.', '<b>Event Subscriptions</b>: enable, subscribe to bot events <code>message.im</code> and <code>app_mention</code>.', '<b>App Home</b>: allow users to send messages. Then DM the app and approve the pairing code.'],
  },
  whatsapp: {
    color: '#25d366', letter: 'W',
    fields: [['token', 'Access token', 'password', 'Permanent or temporary token'], ['phoneNumberId', 'Phone number ID', 'text', 'From WhatsApp → API Setup'], ['verifyToken', 'Verify token (you choose)', 'text', 'Any secret string'], ['appSecret', 'App secret (recommended)', 'password', 'Signs webhook calls']],
    steps: ['Create a Meta app with the <b>WhatsApp</b> product (developers.facebook.com).', 'Copy the access token and phone number ID from <b>API Setup</b>.', 'Make this gateway reachable from the internet (e.g. <code>cloudflared tunnel --url http://localhost:6100</code>) and set the Public URL in Settings.', 'In WhatsApp → Configuration, set the webhook URL below and your verify token; subscribe to <code>messages</code>.', 'Message the number and approve the pairing code below.'],
  },
  phone: {
    color: '#f22f46', letter: '☎',
    fields: [['accountSid', 'Account SID', 'text', 'AC…'], ['authToken', 'Auth token', 'password', ''], ['fromNumber', 'Your Twilio number', 'text', '+15551234567']],
    toggle: ['voice', 'Answer phone calls (speech)'],
    steps: ['Buy a number in Twilio (console.twilio.com).', 'Make this gateway reachable from the internet (tunnel) and set the Public URL in Settings — Twilio signatures are checked against it.', 'Number → Messaging: “A message comes in” → webhook <code>/webhooks/twilio/sms</code> (POST).', 'Number → Voice: “A call comes in” → webhook <code>/webhooks/twilio/voice</code> (POST).', 'Text the number and approve the pairing code below. Then you can text or call your assistant.'],
  },
};

export async function renderChannels(main) {
  const p = page(main, `
    <h1>Channels</h1><p class="lead">Talk to your assistant from the apps you already use. Strangers can't use it: every new sender gets a pairing code you approve here.</p>
    <div class="stack" id="chans"></div>
    <div class="section-title">Terminal & API</div>
    <div class="card" id="apiCard"></div>`);
  const s = state.settings;
  const base = s.publicUrl || location.origin;
  $('#apiCard', p).innerHTML = `
    <h3>Command line</h3><p class="sub">Chat from any terminal on this computer:</p>
    <pre class="detail-pre">npm run chat        # or: node bin/assistant.js chat</pre>
    <h3 style="margin-top:14px">HTTP API</h3><p class="sub">For scripts, shortcuts and home automations. Needs the access token when called from another device.</p>
    <pre class="detail-pre">curl -X POST ${esc(base)}/api/v1/message \\
  -H "Authorization: Bearer &lt;access token from Settings → Remote access&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"What is on my to-do list?"}'</pre>`;

  async function refresh() {
    const channels = await api('/api/channels');
    const settings = state.settings;
    const wrap = $('#chans', p);
    wrap.innerHTML = '';
    for (const c of channels) {
      const meta = CH[c.name];
      const cfg = settings.channels[c.name] || {};
      const statusBadge = { connected: 'ok', error: 'err', connecting: 'accent', 'needs setup': 'warn' }[c.status] || '';
      const card = el(`<div class="card channel-card">
        <div class="channel-head">
          <div class="channel-logo" style="background:${meta.color}">${meta.letter}</div>
          <div class="grow"><h3 style="margin:0">${esc(c.label)}</h3><div class="faint" style="font-size:12.5px">${c.botName ? `Connected as <b>${esc(c.botName)}</b>` : 'Not connected'}${c.detail ? ` · ${esc(c.detail)}` : ''}</div></div>
          <span class="badge ${statusBadge}">${esc(c.status)}</span>
          <label class="switch" title="Enabled"><input type="checkbox" data-enable ${cfg.enabled ? 'checked' : ''}><span></span></label>
        </div>
        <details class="help" ${!c.configured && cfg.enabled ? 'open' : ''}><summary>Setup</summary>
          <ol class="steps">${meta.steps.map((x) => `<li>${x}</li>`).join('')}</ol>
          <div class="grid2" style="margin-top:12px">${meta.fields.map(([k, label, type, ph]) => `<label class="field">${esc(label)}<input data-k="${k}" type="${type}" placeholder="${esc(ph)}" autocomplete="off"></label>`).join('')}</div>
          ${meta.toggle ? `<div class="set-row"><div class="t">${esc(meta.toggle[1])}</div><label class="switch"><input type="checkbox" data-t="${meta.toggle[0]}" ${cfg[meta.toggle[0]] !== false ? 'checked' : ''}><span></span></label></div>` : ''}
          ${c.webhook ? `<label class="field" style="margin-top:12px">Webhook URL<div class="copy-field"><input readonly value="${esc(base + c.webhook)}"><button class="btn sm" data-copy>${icon('copy', 'sm')}</button></div></label>` : ''}
          <div class="row" style="margin-top:12px"><div class="grow"></div><button class="btn primary" data-save>Save & connect</button></div>
        </details>
        <div class="contacts"></div>
      </div>`);
      meta.fields.forEach(([k]) => (card.querySelector(`[data-k="${k}"]`).value = cfg[k] || ''));
      card.querySelector('[data-copy]')?.addEventListener('click', () => copy(base + c.webhook));
      const save = async (enabled) => {
        const body = { enabled };
        meta.fields.forEach(([k]) => (body[k] = card.querySelector(`[data-k="${k}"]`).value));
        if (meta.toggle) body[meta.toggle[0]] = card.querySelector('[data-t]').checked;
        try {
          const r = await api(`/api/channels/${c.name}`, { method: 'PUT', body });
          toast(c.label, r.status === 'connected' ? `Connected${r.botName ? ` as ${r.botName}` : ''}` : r.detail || r.status, { error: r.status === 'error' });
          await refreshState();
          refresh();
        } catch (err) {
          toast(c.label, err.message, { error: true });
        }
      };
      card.querySelector('[data-save]').onclick = () => save(true);
      card.querySelector('[data-enable]').onchange = (e) => save(e.target.checked);

      const contacts = card.querySelector('.contacts');
      if (c.contacts.length) {
        contacts.innerHTML = '<div class="lbl faint" style="font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:650;margin-bottom:4px">People</div>';
        for (const ct of c.contacts) {
          const row = el(`<div class="list-row">
            <span class="badge ${ct.status === 'allowed' ? 'ok' : ct.status === 'blocked' ? 'err' : 'warn'}">${esc(ct.status)}</span>
            <div class="grow"><b class="cn"></b> <span class="faint mono">${esc(ct.peer_id)}</span>${ct.status === 'pending' ? ` <span class="faint">· code <b class="mono" style="color:var(--text)">${esc(ct.code)}</b></span>` : ''}</div>
            <span class="faint" style="font-size:12px">${esc(ago(ct.last_seen_at))}</span>
            ${ct.status !== 'allowed' ? '<button class="btn ok sm" data-s="allowed">Approve</button>' : ''}
            ${ct.status !== 'blocked' ? '<button class="btn sm" data-s="blocked">Block</button>' : ''}
            <button class="btn ghost icon sm" data-rm title="Remove">${icon('trash', 'sm')}</button>
          </div>`);
          row.querySelector('.cn').textContent = ct.name || '';
          row.querySelectorAll('[data-s]').forEach((b) => {
            b.onclick = async () => {
              await api(`/api/channels/${c.name}/contacts/${encodeURIComponent(ct.peer_id)}`, { method: 'POST', body: { status: b.dataset.s } });
              refreshState();
              refresh();
            };
          });
          row.querySelector('[data-rm]').onclick = async () => {
            await api(`/api/channels/${c.name}/contacts/${encodeURIComponent(ct.peer_id)}`, { method: 'DELETE' });
            refresh();
          };
          contacts.append(row);
        }
      }
      wrap.append(card);
    }
  }
  current = { name: 'channels', refresh: debounce(refresh, 300) };
  await refresh();
}

// ================================================================ Activity

export async function renderActivity(main) {
  let kind = '';
  const p = page(main, `
    <h1>Activity</h1><p class="lead">Every tool your assistant used and every approval — a complete audit trail of what it did on your behalf.</p>
    <div class="row wrap" id="filters" style="margin-bottom:12px"></div>
    <div class="card" style="padding:4px 8px"><table class="data"><thead><tr><th style="width:120px">When</th><th style="width:110px">Type</th><th>Action</th><th style="width:110px">Result</th><th style="width:80px">Time</th></tr></thead><tbody id="rows"></tbody></table></div>`);
  for (const [k, label] of [['', 'All'], ['tool', 'Tools'], ['approval', 'Approvals']]) {
    const c = el(`<button class="chip ${k === kind ? 'on' : ''}">${label}</button>`);
    c.onclick = () => {
      kind = k;
      $$('#filters .chip', p).forEach((x) => x.classList.toggle('on', x === c));
      refresh();
    };
    $('#filters', p).append(c);
  }
  async function refresh() {
    const rows = await api(`/api/audit?limit=300${kind ? `&kind=${kind}` : ''}`);
    const body = $('#rows', p);
    body.innerHTML = rows.length ? '' : '<tr><td colspan="5" class="empty">Nothing yet.</td></tr>';
    for (const a of rows) {
      const tr = el(`<tr class="clickable"><td class="faint">${esc(ago(a.ts))}</td><td><span class="badge">${esc(a.kind)}</span></td><td><span class="mono">${esc(a.name)}</span> <span class="faint truncate" style="display:inline-block;vertical-align:bottom;max-width:420px"></span></td><td><span class="badge ${a.status === 'ok' || a.status === 'approved' ? 'ok' : a.status === 'error' ? 'err' : 'warn'}">${esc(a.status)}</span></td><td class="faint">${a.duration_ms != null ? `${(a.duration_ms / 1000).toFixed(1)}s` : ''}</td></tr>`);
      tr.querySelector('.truncate').textContent = a.input || '';
      tr.onclick = () => {
        const next = tr.nextElementSibling;
        if (next?.classList.contains('detail')) return next.remove();
        const d = el('<tr class="detail"><td colspan="5"><div class="faint" style="font-size:12px">Input</div><div class="detail-pre in"></div><div class="faint" style="font-size:12px">Output</div><div class="detail-pre out"></div><div class="faint" style="font-size:12px">Conversation: <a class="sess"></a></div></td></tr>');
        d.querySelector('.in').textContent = a.input || '';
        d.querySelector('.out').textContent = a.output || '';
        const link = d.querySelector('.sess');
        link.textContent = a.session_id || '—';
        if (a.session_id) link.href = `#/chat/${encodeURIComponent(a.session_id)}`;
        tr.after(d);
      };
      body.append(tr);
    }
  }
  current = { name: 'activity', refresh: debounce(refresh, 500) };
  await refresh();
}
