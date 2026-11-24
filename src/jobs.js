import { all, get, run, now } from './db.js';
import { emit } from './events.js';
import { parseWhen, nextRun, describeSchedule } from './util/schedule.js';
import { shortId } from './util/text.js';

/** Storage for scheduled jobs (reminders, recurring tasks, briefings). The runner lives in scheduler.js. */

export function decorate(job) {
  return job ? { ...job, enabled: !!job.enabled, human: describeSchedule(job.schedule) } : null;
}

export function createJob({ name, when, schedule, prompt, sessionId = null, channel = 'web', peer = null }) {
  let sched = schedule;
  let next;
  if (sched) {
    next = nextRun(sched);
  } else {
    const parsed = parseWhen(when);
    if (!parsed) throw new Error(`Couldn't understand the time "${when}". Try "in 20 minutes", "tomorrow at 9am", "every weekday at 8:30", "every 2 hours" or a cron expression like "0 8 * * *".`);
    sched = parsed.schedule;
    next = parsed.nextRun;
  }
  if (!next) throw new Error('That time is in the past');
  const text = String(prompt ?? '').trim();
  if (!text) throw new Error('A scheduled job needs something to do');
  const id = shortId(6);
  run('INSERT INTO jobs (id, name, schedule, prompt, session_id, channel, peer, enabled, next_run_at, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
    id, String(name || text).slice(0, 80), sched, text, sessionId, channel, peer, next, now());
  const job = getJob(id);
  emit('jobs_changed', { job });
  return job;
}

export const getJob = (id) => decorate(get('SELECT * FROM jobs WHERE id = ?', id));
export const listJobs = () => all('SELECT * FROM jobs ORDER BY enabled DESC, next_run_at IS NULL, next_run_at ASC').map(decorate);
export const jobRuns = (id, limit = 20) => all('SELECT * FROM job_runs WHERE job_id = ? ORDER BY id DESC LIMIT ?', id, limit);

export function updateJob(id, patch) {
  const job = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!job) throw new Error(`No scheduled job "${id}"`);
  let { schedule, next_run_at: next } = job;
  if (patch.when) {
    const parsed = parseWhen(patch.when);
    if (!parsed) throw new Error(`Couldn't understand the time "${patch.when}"`);
    schedule = parsed.schedule;
    next = parsed.nextRun;
  }
  const enabled = patch.enabled === undefined ? job.enabled : patch.enabled ? 1 : 0;
  if (enabled && !job.enabled && !patch.when) next = nextRun(schedule);
  if (enabled && !next) throw new Error('That one-time job has already run — give it a new time');
  run('UPDATE jobs SET name = ?, prompt = ?, schedule = ?, channel = ?, peer = ?, enabled = ?, next_run_at = ? WHERE id = ?',
    patch.name ?? job.name, patch.prompt ?? job.prompt, schedule, patch.channel ?? job.channel, patch.peer === undefined ? job.peer : patch.peer, enabled, enabled ? next : job.next_run_at, id);
  const updated = getJob(id);
  emit('jobs_changed', { job: updated });
  return updated;
}

export function deleteJob(id) {
  const job = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!job) return false;
  run('DELETE FROM jobs WHERE id = ?', id);
  run('DELETE FROM job_runs WHERE job_id = ?', id);
  emit('jobs_changed', { deleted: id });
  return true;
}
