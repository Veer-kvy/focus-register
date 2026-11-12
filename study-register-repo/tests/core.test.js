'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/js/core.js');

let counter = 0;
function makeSession(entry, exit, options) {
  const settings = options || {};
  counter += 1;
  return {
    id: 'session-' + counter,
    subjectId: settings.subjectId || 'physics',
    subjectName: settings.subjectName || 'Physics',
    entry: entry.toISOString(),
    exit: exit.toISOString(),
    createdAt: entry.toISOString()
  };
}

function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
}

test('duration is computed from timestamps, not tick counts', () => {
  const session = makeSession(at(2026, 11, 1, 9, 0), at(2026, 11, 1, 11, 30));
  assert.equal(core.sessionDuration(session), 2.5 * 3600000);
});

test('timer formats elapsed hours without wrapping at 24h', () => {
  assert.equal(core.formatTimer(0), '00:00:00');
  assert.equal(core.formatTimer(3661000), '01:01:01');
  assert.equal(core.formatTimer(30 * 3600000 + 5000), '30:00:05');
});

test('durations format cleanly', () => {
  assert.equal(core.formatDuration(0), '0m');
  assert.equal(core.formatDuration(45 * 60000), '45m');
  assert.equal(core.formatDuration(2 * 3600000), '2h');
  assert.equal(core.formatDuration(2 * 3600000 + 5 * 60000), '2h 05m');
  assert.equal(core.formatDurationLong(2 * 3600000 + 30 * 60000), '2 hours 30 minutes');
});

test('sessions crossing midnight are split across both days', () => {
  const session = makeSession(at(2026, 11, 1, 23, 0), at(2026, 11, 2, 1, 15));
  const parts = core.splitSessionByDay(session);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0], { date: '2026-11-01', ms: 3600000 });
  assert.deepEqual(parts[1], { date: '2026-11-02', ms: 4500000 });
});

test('daily statistics only count actual recorded time inside the day', () => {
  const overnight = makeSession(at(2026, 11, 1, 23, 30), at(2026, 11, 2, 0, 30));
  const morning = makeSession(at(2026, 11, 2, 9, 0), at(2026, 11, 2, 10, 0));
  const stats = core.statsForDate([overnight, morning], '2026-11-02');
  assert.equal(stats.total, 90 * 60000);
  assert.equal(stats.count, 2);
  assert.equal(stats.longest, 60 * 60000);
  assert.equal(stats.average, 45 * 60000);
});

test('streak counts consecutive days and tolerates an unfinished today', () => {
  const now = at(2026, 11, 5, 18, 0);
  const sessions = [
    makeSession(at(2026, 11, 3, 9, 0), at(2026, 11, 3, 10, 0)),
    makeSession(at(2026, 11, 4, 9, 0), at(2026, 11, 4, 10, 0)),
    makeSession(at(2026, 11, 5, 9, 0), at(2026, 11, 5, 10, 0))
  ];
  assert.equal(core.streakInfo(sessions, now).count, 3);
  assert.equal(core.streakInfo(sessions, now).studiedToday, true);

  const withoutToday = sessions.slice(0, 2);
  const info = core.streakInfo(withoutToday, now);
  assert.equal(info.count, 2);
  assert.equal(info.studiedToday, false);

  assert.equal(core.streakInfo([], now).count, 0);
});

test('week range starts on Monday and ends next Monday', () => {
  const now = at(2026, 11, 1, 15, 0);
  const range = core.buildRange('week', [], now);
  assert.equal(core.dateKey(range.start), '2026-10-26');
  assert.equal(core.dateKey(range.end), '2026-11-02');
});

test('month and all-time ranges cover the right span', () => {
  const now = at(2026, 11, 15, 12, 0);
  const old = makeSession(at(2026, 8, 3, 9, 0), at(2026, 8, 3, 11, 0));
  const month = core.buildRange('month', [old], now);
  assert.equal(core.dateKey(month.start), '2026-11-01');
  assert.equal(core.dateKey(month.end), '2026-12-01');

  const all = core.buildRange('all', [old], now);
  assert.equal(core.dateKey(all.start), '2026-08-03');
  assert.equal(core.dateKey(all.end), '2026-11-16');
});

test('range stats clip sessions to the requested window', () => {
  const sessions = [
    makeSession(at(2026, 10, 31, 9, 0), at(2026, 10, 31, 11, 0)),
    makeSession(at(2026, 11, 1, 9, 0), at(2026, 11, 1, 10, 30))
  ];
  const stats = core.rangeStats(sessions, at(2026, 10, 1), at(2026, 11, 1));
  assert.equal(stats.total, 2 * 3600000);
  assert.equal(stats.count, 1);
  assert.equal(stats.longest, 2 * 3600000);
});

test('daily series is zero-filled and accrues overtime correctly', () => {
  const sessions = [makeSession(at(2026, 11, 3, 22, 0), at(2026, 11, 4, 1, 0))];
  const series = core.dailySeries(sessions, at(2026, 11, 1), at(2026, 11, 6));
  assert.deepEqual(series.map((item) => item.date), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(series[2].ms, 2 * 3600000);
  assert.equal(series[3].ms, 3600000);
});

test('hourly series attributes minutes to the right hour', () => {
  const sessions = [makeSession(at(2026, 11, 1, 9, 40), at(2026, 11, 1, 10, 20))];
  const series = core.hourlySeries(sessions, '2026-11-01');
  assert.equal(series[9].ms, 20 * 60000);
  assert.equal(series[10].ms, 20 * 60000);
  assert.equal(series.reduce((sum, item) => sum + item.ms, 0), 40 * 60000);
});

test('subject totals group by id and keep removed subject labels', () => {
  const subjects = [
    { id: 'physics', name: 'Physics', color: '#7C9CFF' },
    { id: 'math', name: 'Maths', color: '#FFB86B' }
  ];
  const sessions = [
    makeSession(at(2026, 11, 1, 9, 0), at(2026, 11, 1, 11, 0), { subjectId: 'physics', subjectName: 'Physics' }),
    makeSession(at(2026, 11, 1, 12, 0), at(2026, 11, 1, 13, 0), { subjectId: 'removed', subjectName: 'Biology' })
  ];
  const distribution = core.subjectTotals(sessions, at(2026, 11, 1), at(2026, 11, 2), subjects);
  assert.equal(distribution.total, 3 * 3600000);
  assert.equal(distribution.list.length, 2);
  assert.equal(distribution.list[0].name, 'Physics');
  assert.equal(distribution.list[1].name, 'Biology');
  assert.ok(distribution.list[0].pct > 0.66);
});

test('normalizing data drops broken sessions and keeps a valid active session', () => {
  const raw = {
    settings: { dailyTargetMinutes: 99999, appearance: 'neon', defaultSubjectId: 'missing' },
    subjects: [
      { id: 'physics', name: '  Physics  ', color: '#7C9CFF' },
      { id: 'physics', name: 'Physics', color: '#35C98B' },
      { id: 'chem', name: 'Chemistry', color: 'not-a-color' }
    ],
    sessions: [
      { id: 'a', subjectId: 'chem', subjectName: 'Chemistry', entry: at(2026, 11, 1, 9, 0).toISOString(), exit: at(2026, 11, 1, 10, 0).toISOString() },
      { id: 'b', subjectId: 'chem', subjectName: 'Chemistry', entry: at(2026, 11, 1, 12, 0).toISOString(), exit: at(2026, 11, 1, 11, 0).toISOString() },
      { id: 'c', subjectId: 'chem', entry: 'nonsense', exit: 'nonsense' }
    ],
    activeSession: { subjectId: 'chem', subjectName: 'Chemistry', entry: at(2026, 11, 1, 18, 0).toISOString() },
    meta: {}
  };
  const data = core.normalizeData(raw);
  assert.equal(data.sessions.length, 1);
  assert.equal(data.activeSession.subjectId, 'chem');
  assert.equal(data.settings.dailyTargetMinutes, 1440);
  assert.equal(data.settings.appearance, 'dark');
  assert.equal(data.subjects.length, 2);
  assert.equal(data.subjects[0].name, 'Physics');
  assert.match(data.settings.defaultSubjectId, /^physics|chem$/);
});

test('garbage input yields a usable default register', () => {
  const data = core.normalizeData(null);
  assert.equal(data.sessions.length, 0);
  assert.equal(data.subjects.length, 6);
  assert.equal(data.activeSession, null);
  assert.equal(data.settings.dailyTargetMinutes, 360);
  assert.equal(core.normalizeData({ sessions: 'nope', subjects: 'nope' }).subjects.length, 6);
});

test('CSV export is Excel friendly, quoted and complete', () => {
  const session = makeSession(at(2026, 11, 1, 9, 0), at(2026, 11, 1, 11, 30), { subjectName: 'Coding, "DSA"' });
  const csv = core.buildCsv([session]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('Date,Subject,Entry time'));
  assert.ok(csv.includes('"Coding, ""DSA"""'));
  assert.ok(csv.includes('150,2:30'));
});

test('subject names are sanitized for storage', () => {
  assert.equal(core.sanitizeSubjectName('  Organic   Chemistry '), 'Organic Chemistry');
  assert.equal(core.sanitizeSubjectName('bad\u0000name'), 'bad name');
  assert.equal(core.sanitizeSubjectName(''), '');
  assert.equal(core.sanitizeSubjectName('x'.repeat(80)).length, 32);
});

test('datetime-local values keep seconds and round-trip', () => {
  const date = new Date(2026, 10, 1, 9, 7, 42);
  const value = core.toLocalInputValue(date);
  assert.equal(value, '2026-11-01T09:07:42');
  assert.equal(core.fromLocalInputValue(value).getTime(), date.getTime());
  assert.equal(core.toLocalInputValue('nonsense'), '');
});

test('countDays is inclusive of today and guards future ranges', () => {
  const now = at(2026, 11, 5, 12, 0);
  assert.equal(core.countDays(at(2026, 11, 1), at(2026, 11, 8), now), 5);
  assert.equal(core.countDays(at(2027, 1, 1), at(2027, 2, 1), now), 1);
});
