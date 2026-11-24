import { all, get, run, now } from './db.js';
import { emit, log } from './events.js';
import { getSettings } from './config.js';
import { runTurn } from './agent.js';
import { getJob } from './jobs.js';
import { nextRun, describeSchedule } from './util/schedule.js';

/** Wakes up due jobs (reminders, recurring tasks, the daily briefing), runs them through the
 *  agent in their own session, and delivers the result where the job was created. */

const inFlight = new Set();
let timer = null;

export async function runJob(id, { manual = false } = {}) {
  const job = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!job || inFlight.has(id)) return null;
  inFlight.add(id);
  const started = now();

  // Advance the schedule first so a slow run can never fire twice.
  if (!manual) {
    const next = nextRun(job.schedule, Math.max(started, (job.next_run_at || started) + 1000));
    run('UPDATE jobs SET next_run_at = ?, enabled = ? WHERE id = ?', next, next ? job.enabled : 0, id);
  }
  const runRow = run('INSERT INTO job_runs (job_id, started_at, status) VALUES (?,?,?)', id, started, 'running');
  emit('job_run', { jobId: id, status: 'running' });

  const s = getSettings();
  const prompt = [
    `[Scheduled task "${job.name}" — ${describeSchedule(job.schedule)}${manual ? ', run manually' : ''}]`,
    job.prompt,
    `Do it now. Your reply will be sent to ${s.userName || 'the user'} as a message, so write it to them directly.`,
  ];
  // Only conditional jobs ("tell me if the price drops") may stay silent; everything else must report.
  if (/\b(if|only|unless|whether|changed?|changes|drops?|rises?|below|above|new|NO_REPLY)\b/i.test(job.prompt)) {
    prompt.push('If the condition is not met and there is nothing worth telling them, reply with exactly NO_REPLY.');
  } else {
    prompt.push('Always reply with the result — never an empty answer.');
  }
  const text = prompt.join('\n');

  let status = 'ok';
  let output = '';
  try {
    const res = await runTurn({ sessionId: `job:${id}`, text, channel: 'job', origin: 'job' });
    output = (res.text || '').trim();
    if (res.error) status = 'error';
    else if (res.stopped) status = 'stopped';
    else if (!output || /^NO_REPLY\b/i.test(output)) status = 'silent';
    else {
      const { deliver } = await import('./channels/index.js');
      const d = await deliver({ channel: job.channel, peer: job.peer, sessionId: job.session_id, text: output, title: job.name, from: 'job' });
      if (!d.ok) {
        status = 'undelivered';
        output = `${output}\n\n(Delivery via ${job.channel} failed: ${d.error})`;
      }
    }
  } catch (err) {
    status = 'error';
    output = err.message;
  } finally {
    inFlight.delete(id);
  }
  run('UPDATE job_runs SET finished_at = ?, status = ?, output = ? WHERE id = ?', now(), status, output.slice(0, 4000), runRow.lastInsertRowid);
  run('UPDATE jobs SET last_run_at = ?, last_status = ?, last_output = ?, run_count = run_count + 1 WHERE id = ?', started, status, output.slice(0, 2000), id);
  log('scheduler', `job ${id} "${job.name}" → ${status}`);
  emit('job_run', { jobId: id, status });
  emit('jobs_changed', { job: getJob(id) });
  return { status, output };
}

function tick() {
  const due = all('SELECT id FROM jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?', now());
  for (const { id } of due) runJob(id).catch((err) => log('scheduler', `job ${id} failed:`, err.message));
}

export function startScheduler() {
  // Catch up: one-shot reminders that came due while we were off still fire once; recurring
  // jobs that were missed just move on to their next slot.
  const t = now();
  for (const job of all('SELECT * FROM jobs WHERE enabled = 1 AND next_run_at < ?', t)) {
    if (!job.schedule.startsWith('at:')) run('UPDATE jobs SET next_run_at = ? WHERE id = ?', nextRun(job.schedule, t), job.id);
  }
  timer = setInterval(tick, 15000);
  setTimeout(tick, 3000);
}

export function stopScheduler() {
  clearInterval(timer);
}
