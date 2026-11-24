import { addMemory, deleteMemory, searchMemories, MEMORY_KINDS } from '../memory.js';
import { all, get, run, now } from '../db.js';
import { emit } from '../events.js';
import { createJob, listJobs, deleteJob } from '../jobs.js';
import { parseWhen, formatWhen } from '../util/schedule.js';
import { calculate } from '../util/calc.js';

const PRIORITY = { 1: 'high', 2: 'normal', 3: 'low' };

function todoLine(t) {
  const due = t.due_at ? ` (due ${formatWhen(t.due_at)}${!t.done && t.due_at < Date.now() ? ', OVERDUE' : ''})` : '';
  return `#${t.id} ${t.done ? '[done] ' : ''}${t.title}${due}${t.priority === 1 ? ' — high priority' : ''}${t.notes ? ` — ${t.notes}` : ''}`;
}

export default [
  {
    name: 'remember',
    group: 'memory',
    risk: 'safe',
    description: 'Save a lasting fact about the user to long-term memory: preferences, people in their life, projects, goals, routines, important dates. Use whenever they share something worth knowing next month.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'One short sentence, e.g. "Prefers aisle seats on trains."' },
        kind: { type: 'string', enum: MEMORY_KINDS },
        importance: { type: 'integer', description: '1-5. 5 = core to who they are, 3 = useful, 1 = trivia' },
      },
      required: ['content'],
    },
    run: ({ content, kind, importance }) => {
      const m = addMemory({ content, kind, importance, source: 'assistant' });
      return m.duplicate ? `Already in memory as #${m.id}.` : `Saved to memory as #${m.id}.`;
    },
  },
  {
    name: 'recall',
    group: 'memory',
    risk: 'safe',
    description: 'Search long-term memory for what you know about the user, a person, a project or a preference.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Keywords to look for' } }, required: ['query'] },
    run: ({ query }) => {
      const rows = searchMemories(query, 10);
      return rows.length ? rows.map((m) => `#${m.id} [${m.kind}] ${m.content}`).join('\n') : 'No matching memories.';
    },
  },
  {
    name: 'forget',
    group: 'memory',
    risk: 'safe',
    description: 'Delete a memory by its #id when the user asks you to forget it or it is no longer true.',
    parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    run: ({ id }) => (deleteMemory(Number(id)) ? `Forgot memory #${id}.` : `There is no memory #${id}.`),
  },
  {
    name: 'todo_add',
    group: 'tasks',
    risk: 'safe',
    description: "Add an item to the user's to-do list.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        due: { type: 'string', description: 'Optional, natural language: "friday 5pm", "tomorrow", "in 3 days"' },
        priority: { type: 'integer', description: '1 high, 2 normal, 3 low' },
        notes: { type: 'string' },
      },
      required: ['title'],
    },
    run: ({ title, due, priority, notes }) => {
      let dueAt = null;
      if (due) {
        const p = parseWhen(due);
        if (!p) throw new Error(`Couldn't understand the due date "${due}"`);
        dueAt = p.nextRun;
      }
      const pr = [1, 2, 3].includes(Number(priority)) ? Number(priority) : 2;
      const r = run('INSERT INTO todos (title, notes, due_at, priority, created_at) VALUES (?,?,?,?,?)', String(title).trim(), notes || '', dueAt, pr, now());
      emit('todos_changed', {});
      return `Added to-do #${r.lastInsertRowid}: ${title}${dueAt ? ` (due ${formatWhen(dueAt)})` : ''}, ${PRIORITY[pr]} priority.`;
    },
  },
  {
    name: 'todo_list',
    group: 'tasks',
    risk: 'safe',
    description: "Show the user's to-do list (open items first, most urgent first).",
    parameters: { type: 'object', properties: { include_done: { type: 'boolean', description: 'Also show recently completed items' } } },
    run: ({ include_done }) => {
      const open = all('SELECT * FROM todos WHERE done = 0 ORDER BY due_at IS NULL, due_at, priority, id LIMIT 50');
      const done = include_done ? all('SELECT * FROM todos WHERE done = 1 ORDER BY done_at DESC LIMIT 10') : [];
      if (!open.length && !done.length) return 'The to-do list is empty.';
      return [...open, ...done].map(todoLine).join('\n');
    },
  },
  {
    name: 'todo_done',
    group: 'tasks',
    risk: 'safe',
    description: 'Mark a to-do as done by its #id.',
    parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    run: ({ id }) => {
      const t = get('SELECT * FROM todos WHERE id = ?', Number(id));
      if (!t) return `There is no to-do #${id}.`;
      run('UPDATE todos SET done = 1, done_at = ? WHERE id = ?', now(), t.id);
      emit('todos_changed', {});
      return `Marked #${t.id} "${t.title}" as done.`;
    },
  },
  {
    name: 'schedule_task',
    group: 'tasks',
    risk: 'safe',
    description: 'Schedule a reminder or a recurring job. At that time you are woken up with the "what" text, and your reply is sent to the user. Use for "remind me…", "every morning…", "check X daily and tell me if…".',
    parameters: {
      type: 'object',
      properties: {
        when: { type: 'string', description: 'e.g. "in 20 minutes", "tomorrow at 9am", "friday 5pm", "every weekday at 8:30", "every 2 hours", or cron "0 8 * * *"' },
        what: { type: 'string', description: 'What to do or say then, e.g. "Remind them to call the dentist" or "Check the price of the Sony headphones and tell them if it dropped below $250"' },
        name: { type: 'string', description: 'Short label' },
      },
      required: ['when', 'what'],
    },
    run: ({ when, what, name }, ctx) => {
      const job = createJob({ name: name || what, when, prompt: what, sessionId: ctx.delivery.sessionId, channel: ctx.delivery.channel, peer: ctx.delivery.peer });
      return `Scheduled job ${job.id}: ${job.human}. Next run ${formatWhen(job.next_run_at)}. It will be delivered via ${job.channel}.`;
    },
  },
  {
    name: 'list_scheduled',
    group: 'tasks',
    risk: 'safe',
    description: 'List scheduled reminders and recurring jobs.',
    parameters: { type: 'object', properties: {} },
    run: () => {
      const jobs = listJobs();
      if (!jobs.length) return 'Nothing is scheduled.';
      return jobs.map((j) => `${j.id}: "${j.name}" — ${j.human}${j.enabled ? (j.next_run_at ? `, next ${formatWhen(j.next_run_at)}` : '') : ' (paused)'}`).join('\n');
    },
  },
  {
    name: 'cancel_scheduled',
    group: 'tasks',
    risk: 'safe',
    description: 'Cancel a scheduled reminder or job by its id.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: ({ id }) => (deleteJob(String(id)) ? `Cancelled ${id}.` : `No scheduled job "${id}".`),
  },
  {
    name: 'calculate',
    group: 'tasks',
    risk: 'safe',
    description: 'Evaluate arithmetic exactly instead of doing it in your head: + - * / % ^, parentheses, "15% of 80", sqrt(), round(), min(), max().',
    parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
    run: ({ expression }) => `${expression} = ${calculate(expression)}`,
  },
];
