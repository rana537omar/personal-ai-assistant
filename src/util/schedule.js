/**
 * Scheduling helpers: a small 5-field cron engine, a natural-language "when" parser
 * ("in 20 minutes", "tomorrow at 9am", "every weekday at 8:30") and human descriptions.
 * Schedules are stored as strings:  at:<epoch ms> | every:<minutes> | cron:<expr>
 * All times use the machine's local timezone.
 */

const DOW_NAMES = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MON_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseField(field, min, max, names = {}) {
  const set = new Set();
  const val = (v) => {
    const k = v.toLowerCase();
    if (k in names) return names[k];
    if (!/^\d+$/.test(v)) return NaN;
    return parseInt(v, 10);
  };
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in "${field}"`);
    let lo;
    let hi;
    if (rangePart === '*') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      [lo, hi] = rangePart.split('-').map(val);
    } else {
      lo = val(rangePart);
      hi = stepPart === undefined ? lo : max;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo < min || hi > max || lo > hi) throw new Error(`Bad cron field "${field}"`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set;
}

export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron needs 5 fields: minute hour day-of-month month day-of-week');
  const [mi, ho, dom, mon, dow] = parts;
  const dows = parseField(dow, 0, 7, DOW_NAMES);
  if (dows.has(7)) {
    dows.delete(7);
    dows.add(0);
  }
  return {
    minutes: parseField(mi, 0, 59),
    hours: parseField(ho, 0, 23),
    doms: parseField(dom, 1, 31),
    months: parseField(mon, 1, 12, MON_NAMES),
    dows,
    domAny: dom === '*',
    dowAny: dow === '*',
  };
}

/** Next time (epoch ms) strictly after `from` that matches the cron expression. */
export function nextCronTime(expr, from = Date.now()) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from + 400 * 86400000;
  const dayMatches = (date) => {
    const domOk = c.doms.has(date.getDate());
    const dowOk = c.dows.has(date.getDay());
    if (c.domAny && c.dowAny) return true;
    if (c.domAny) return dowOk;
    if (c.dowAny) return domOk;
    return domOk || dowOk;
  };
  while (d.getTime() < limit) {
    if (!c.months.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d.getTime();
  }
  return null;
}

const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, ninety: 90 };
const UNIT_MIN = { m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, d: 1440, day: 1440, days: 1440, w: 10080, week: 10080, weeks: 10080 };
const PART_OF_DAY = { morning: [9, 0], noon: [12, 0], midday: [12, 0], afternoon: [14, 0], evening: [18, 0], tonight: [20, 0], night: [21, 0], midnight: [0, 0] };

/** "8", "8am", "8:30 pm", "20:15", "noon", "evening" → [hour, minute] */
export function parseTimeOfDay(text) {
  const s = String(text).trim().toLowerCase().replace(/\./g, '');
  if (s in PART_OF_DAY) return PART_OF_DAY[s];
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.[0];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else if (h > 23) return null;
  return [h, min];
}

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = ([h, m]) => `${pad(h)}:${pad(m)}`;

function atTime(base, [h, m]) {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

export function formatWhen(ms) {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Natural language → { schedule, human, nextRun } or null.
 */
export function parseWhen(input, now = new Date()) {
  let s = String(input ?? '').trim().toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ');
  s = s.replace(/^(remind me\s+)?(at|on)\s+/, '').replace(/[.!]$/, '');
  if (!s) return null;
  const nowMs = now.getTime();
  const once = (d) => {
    const ms = d.getTime();
    return ms > nowMs ? { schedule: `at:${ms}`, human: `once, ${formatWhen(ms)}`, nextRun: ms } : null;
  };
  const cron = (expr, human) => {
    try {
      const next = nextCronTime(expr, nowMs);
      return next ? { schedule: `cron:${expr}`, human, nextRun: next } : null;
    } catch {
      return null;
    }
  };

  // raw cron expression
  if (/^[\d*/,\-a-z]+(\s+[\d*/,\-a-z]+){4}$/.test(s) && /[\d*]/.test(s.split(' ')[0])) {
    const r = cron(s, describeSchedule(`cron:${s}`));
    if (r) return r;
  }

  // every N minutes/hours
  let m = s.match(/^(?:every|each)\s+(\d+|[a-z-]+)?\s*(m|mins?|minutes?|h|hrs?|hours?)$/);
  if (m) {
    const n = m[1] ? (/^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUM_WORDS[m[1]]) : 1;
    if (!n) return null;
    const minutes = n * UNIT_MIN[m[2]];
    if (minutes < 1) return null;
    return { schedule: `every:${minutes}`, human: `every ${minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`}`, nextRun: nowMs + minutes * 60000 };
  }
  if (s === 'hourly') return { schedule: 'every:60', human: 'every hour', nextRun: nowMs + 3600000 };

  // every day / weekday / monday ... (at time)
  m = s.match(/^(?:every|each)\s+(day|morning|afternoon|evening|night|weekday|weekdays|weekend|weekends|week|(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*)(?:\s+(?:on\s+)?((?:sun|mon|tue|wed|thu|fri|sat)[a-z]*))?(?:\s+(?:at\s+)?(.+))?$/)
    || s.match(/^(daily|weekdays|weekly)(?:\s+(?:on\s+)?((?:sun|mon|tue|wed|thu|fri|sat)[a-z]*))?(?:\s+(?:at\s+)?(.+))?$/);
  if (m) {
    let [, what, onDay, timeText] = m;
    if (what === 'daily') what = 'day';
    if (what === 'weekly') what = 'week';
    let time = timeText ? parseTimeOfDay(timeText) : null;
    if (timeText && !time) return null;
    if (!time) time = PART_OF_DAY[what] || [9, 0];
    if (['morning', 'afternoon', 'evening', 'night'].includes(what)) what = 'day';
    let dow = '*';
    let label = 'every day';
    if (what.startsWith('weekday')) {
      dow = '1-5';
      label = 'every weekday';
    } else if (what.startsWith('weekend')) {
      dow = '0,6';
      label = 'every weekend day';
    } else if (what === 'week') {
      const d = onDay ? DOW_NAMES[onDay.slice(0, 3)] : 1;
      if (d === undefined) return null;
      dow = String(d);
      label = `every ${DAY_LABEL[d]}`;
    } else if (what !== 'day') {
      const d = DOW_NAMES[what.replace(/s$/, '')] ?? DOW_NAMES[what.slice(0, 3)];
      if (d === undefined) return null;
      dow = String(d);
      label = `every ${DAY_LABEL[d]}`;
    }
    return cron(`${time[1]} ${time[0]} * * ${dow}`, `${label} at ${fmtTime(time)}`);
  }

  // in N units
  m = s.match(/^in\s+(\d+(?:\.\d+)?|[a-z-]+)\s+(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/) || s.match(/^in\s+(half an?)\s+(hour)$/);
  if (m) {
    const n = m[1].startsWith('half') ? 0.5 : /^[\d.]+$/.test(m[1]) ? parseFloat(m[1]) : NUM_WORDS[m[1]];
    if (!n) return null;
    return once(new Date(nowMs + Math.round(n * UNIT_MIN[m[2]] * 60000)));
  }

  // today / tonight / tomorrow / day after tomorrow (at time)
  m = s.match(/^(today|tonight|tomorrow|day after tomorrow)(?:\s+(?:at\s+)?(.+))?$/);
  if (m) {
    const offset = m[1] === 'tomorrow' ? 1 : m[1] === 'day after tomorrow' ? 2 : 0;
    let time = m[2] ? parseTimeOfDay(m[2]) : m[1] === 'tonight' ? PART_OF_DAY.tonight : m[1] === 'today' ? null : [9, 0];
    if (m[2] && !time) return null;
    if (!time) time = [Math.min(now.getHours() + 1, 23), 0];
    if (m[1] === 'tonight' && time[0] < 12) time = [time[0] + 12, time[1]];
    const base = new Date(nowMs);
    base.setDate(base.getDate() + offset);
    return once(atTime(base, time));
  }

  // (next) monday (at time)
  m = s.match(/^(?:next\s+|this\s+)?((?:sun|mon|tue|wed|thu|fri|sat)[a-z]*)(?:\s+(?:at\s+)?(.+))?$/);
  if (m && DOW_NAMES[m[1]] !== undefined) {
    const target = DOW_NAMES[m[1]];
    const time = m[2] ? parseTimeOfDay(m[2]) : [9, 0];
    if (!time) return null;
    const base = new Date(nowMs);
    let add = (target - base.getDay() + 7) % 7;
    if (add === 0 && atTime(base, time).getTime() <= nowMs) add = 7;
    base.setDate(base.getDate() + add);
    return once(atTime(base, time));
  }

  // bare time today (or tomorrow if passed)
  const t = parseTimeOfDay(s);
  if (t) {
    const d = atTime(now, t);
    if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
    return once(d);
  }

  // ISO-ish date "2026-12-01 09:00" or anything Date can parse ("Dec 5 2026 3pm")
  m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ t](.+))?$/);
  if (m) {
    const [y, mo, da] = m[1].split('-').map(Number);
    const time = m[2] ? parseTimeOfDay(m[2]) : [9, 0];
    if (!time) return null;
    return once(new Date(y, mo - 1, da, time[0], time[1]));
  }
  const parsed = Date.parse(input);
  if (!Number.isNaN(parsed)) return once(new Date(parsed));
  return null;
}

export function describeSchedule(schedule) {
  const [kind, value] = [schedule.slice(0, schedule.indexOf(':')), schedule.slice(schedule.indexOf(':') + 1)];
  if (kind === 'at') return `once, ${formatWhen(Number(value))}`;
  if (kind === 'every') {
    const n = Number(value);
    return n % 60 === 0 ? `every ${n / 60 === 1 ? 'hour' : `${n / 60} hours`}` : `every ${n} minutes`;
  }
  if (kind === 'cron') {
    const p = value.split(' ');
    if (p.length === 5 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) && p[2] === '*' && p[3] === '*') {
      const time = fmtTime([Number(p[1]), Number(p[0])]);
      if (p[4] === '*') return `every day at ${time}`;
      if (p[4] === '1-5') return `every weekday at ${time}`;
      if (p[4] === '0,6') return `every weekend day at ${time}`;
      if (/^\d$/.test(p[4])) return `every ${DAY_LABEL[Number(p[4])]} at ${time}`;
    }
    return `cron "${value}"`;
  }
  return schedule;
}

/** Next run (epoch ms) for a stored schedule string, or null if it will not run again. */
export function nextRun(schedule, from = Date.now()) {
  const i = schedule.indexOf(':');
  const kind = schedule.slice(0, i);
  const value = schedule.slice(i + 1);
  if (kind === 'at') {
    const t = Number(value);
    return t > from ? t : null;
  }
  if (kind === 'every') return from + Number(value) * 60000;
  if (kind === 'cron') return nextCronTime(value, from);
  return null;
}
