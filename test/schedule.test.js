import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextCronTime, parseWhen, parseTimeOfDay, describeSchedule, nextRun } from '../src/util/schedule.js';

// Tuesday 24 Nov 2026, 14:10 local time
const NOW = new Date(2026, 10, 24, 14, 10, 0, 0);

test('parseTimeOfDay', () => {
  assert.deepEqual(parseTimeOfDay('8am'), [8, 0]);
  assert.deepEqual(parseTimeOfDay('8:30 pm'), [20, 30]);
  assert.deepEqual(parseTimeOfDay('12am'), [0, 0]);
  assert.deepEqual(parseTimeOfDay('17:45'), [17, 45]);
  assert.deepEqual(parseTimeOfDay('noon'), [12, 0]);
  assert.equal(parseTimeOfDay('25:00'), null);
  assert.equal(parseTimeOfDay('13pm'), null);
});

test('cron parsing and next run', () => {
  const c = parseCron('*/15 9-17 * * 1-5');
  assert.ok(c.minutes.has(45) && !c.minutes.has(10));
  const next = new Date(nextCronTime('0 8 * * *', NOW.getTime()));
  assert.equal(next.getDate(), 25);
  assert.equal(next.getHours(), 8);
  const weekday = new Date(nextCronTime('30 8 * * 1-5', new Date(2026, 10, 27, 9, 0).getTime())); // Friday after 8:30
  assert.equal(weekday.getDay(), 1); // → Monday
  assert.throws(() => parseCron('61 * * * *'));
  assert.throws(() => parseCron('* * *'));
});

test('parseWhen: relative and one-off times', () => {
  const in20 = parseWhen('in 20 minutes', NOW);
  assert.equal(in20.nextRun - NOW.getTime(), 20 * 60000);
  assert.ok(in20.schedule.startsWith('at:'));
  assert.equal(parseWhen('in an hour', NOW).nextRun - NOW.getTime(), 3600000);
  assert.equal(parseWhen('in half an hour', NOW).nextRun - NOW.getTime(), 1800000);

  const tmr = new Date(parseWhen('tomorrow at 9am', NOW).nextRun);
  assert.deepEqual([tmr.getDate(), tmr.getHours(), tmr.getMinutes()], [25, 9, 0]);

  const fivePm = new Date(parseWhen('5pm', NOW).nextRun);
  assert.deepEqual([fivePm.getDate(), fivePm.getHours()], [24, 17]);
  const nineAm = new Date(parseWhen('9am', NOW).nextRun); // already passed today → tomorrow
  assert.equal(nineAm.getDate(), 25);

  const fri = new Date(parseWhen('friday 5pm', NOW).nextRun);
  assert.deepEqual([fri.getDay(), fri.getHours()], [5, 17]);

  const iso = new Date(parseWhen('2026-12-01 09:30', NOW).nextRun);
  assert.deepEqual([iso.getMonth(), iso.getDate(), iso.getHours(), iso.getMinutes()], [11, 1, 9, 30]);
});

test('parseWhen: recurring', () => {
  assert.equal(parseWhen('every weekday at 8:30', NOW).schedule, 'cron:30 8 * * 1-5');
  assert.equal(parseWhen('every day at 7pm', NOW).schedule, 'cron:0 19 * * *');
  assert.equal(parseWhen('daily at 8', NOW).schedule, 'cron:0 8 * * *');
  assert.equal(parseWhen('every monday at 10:15am', NOW).schedule, 'cron:15 10 * * 1');
  assert.equal(parseWhen('weekly on friday at 4pm', NOW).schedule, 'cron:0 16 * * 5');
  assert.equal(parseWhen('every morning', NOW).schedule, 'cron:0 9 * * *');
  assert.equal(parseWhen('every 2 hours', NOW).schedule, 'every:120');
  assert.equal(parseWhen('every 15 minutes', NOW).schedule, 'every:15');
  assert.equal(parseWhen('0 8 * * *', NOW).schedule, 'cron:0 8 * * *');
});

test('parseWhen rejects nonsense and the past', () => {
  assert.equal(parseWhen('whenever you feel like it', NOW), null);
  assert.equal(parseWhen('', NOW), null);
  assert.equal(parseWhen('2020-01-01 09:00', NOW), null);
});

test('describe + nextRun', () => {
  assert.equal(describeSchedule('cron:30 8 * * 1-5'), 'every weekday at 08:30');
  assert.equal(describeSchedule('every:120'), 'every 2 hours');
  assert.equal(nextRun('every:30', 1000), 1000 + 30 * 60000);
  assert.equal(nextRun(`at:${NOW.getTime() - 1}`, NOW.getTime()), null);
});
