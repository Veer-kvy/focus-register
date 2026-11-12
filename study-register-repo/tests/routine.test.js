'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/js/core.js');

function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
}

function slot(id, title, type, subjectId, start, end) {
  return { id, title, type, subjectId, notes: '', start, end };
}

function routineWith(day, slots) {
  const routineData = core.defaultRoutineData();
  routineData.routines[0].days[day] = slots;
  return routineData;
}

function session(id, entry, exit, subjectId, subjectName, extra) {
  return Object.assign({
    id,
    subjectId: subjectId || 'physics',
    subjectName: subjectName || 'Physics',
    entry: entry.toISOString(),
    exit: exit.toISOString(),
    createdAt: entry.toISOString()
  }, extra || {});
}

const MONDAY = at(2026, 11, 2, 0, 0);

test('new data includes a persistent default routine and exact-time notifications', () => {
  const data = core.normalizeData(null);
  assert.equal(data.version, 2);
  assert.equal(data.routine.routines.length, 1);
  assert.equal(data.routine.routines[0].isDefault, true);
  assert.equal(data.routine.defaultRoutineId, data.routine.routines[0].id);
  assert.deepEqual(data.routine.notifications.timings, [0]);
  assert.equal(data.routine.notifications.enabled, true);
  assert.equal(data.routine.notifications.missedReminder, false);
});

test('weekly assignment builds a chronological day plan', () => {
  const routineData = routineWith('mon', [
    slot('slot-b', 'Mathematics', 'mathematics', 'mathematics', '11:00', '12:00'),
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:30')
  ]);
  const plan = core.buildDayPlan(routineData, MONDAY);
  assert.equal(plan.source, 'routine');
  assert.equal(plan.weekday, 'mon');
  assert.equal(plan.slots.length, 2);
  assert.deepEqual(plan.slots.map((item) => item.id), ['slot-a', 'slot-b']);
  assert.equal(plan.slots[0].durationMinutes, 90);
  assert.equal(plan.slots[0].startAt, at(2026, 11, 2, 9, 0).getTime());
  assert.equal(plan.slots[0].endAt, at(2026, 11, 2, 10, 30).getTime());
});

test('different weekdays can follow different routines', () => {
  const routineData = core.defaultRoutineData();
  const weekday = routineData.routines[0];
  weekday.days.mon = [slot('mon-1', 'Physics', 'physics', 'physics', '09:00', '10:00')];
  routineData.routines.push({
    id: 'weekend',
    name: 'Weekend Revision',
    isDefault: false,
    days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [slot('sat-1', 'Revision', 'revision', 'revision', '08:00', '10:00')], sun: [] }
  });
  routineData.schedule.mon = weekday.id;
  routineData.schedule.sat = 'weekend';
  assert.equal(core.buildDayPlan(routineData, at(2026, 11, 2)).slots[0].title, 'Physics');
  assert.equal(core.buildDayPlan(routineData, at(2026, 11, 7)).slots[0].title, 'Revision');
});

test('overnight slots end on the next calendar day', () => {
  const routineData = routineWith('mon', [
    slot('sleep-1', 'Sleep', 'sleep', null, '23:00', '06:00')
  ]);
  const plan = core.buildDayPlan(routineData, MONDAY);
  assert.equal(plan.slots[0].overnight, true);
  assert.equal(plan.slots[0].durationMinutes, 420);
  assert.equal(plan.slots[0].startAt, at(2026, 11, 2, 23, 0).getTime());
  assert.equal(plan.slots[0].endAt, at(2026, 11, 3, 6, 0).getTime());
});

test('holiday exceptions suppress the permanent timetable without deleting it', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  routineData.exceptions.push({ id: 'holiday-1', date: '2026-11-02', kind: 'holiday', label: 'Diwali', slots: [] });
  const plan = core.buildDayPlan(routineData, MONDAY);
  assert.equal(plan.holiday, true);
  assert.equal(plan.source, 'holiday');
  assert.equal(plan.slots.length, 0);
  assert.equal(plan.label, 'Diwali');
  assert.equal(routineData.routines[0].days.mon.length, 1);
});

test('custom day exceptions replace the timetable for one date only', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  routineData.exceptions.push({
    id: 'exam-1',
    date: '2026-11-02',
    kind: 'custom',
    label: 'Mock Test',
    slots: [slot('exam-slot', 'Test', 'other', null, '10:00', '13:00')]
  });
  const custom = core.buildDayPlan(routineData, MONDAY);
  assert.equal(custom.source, 'custom');
  assert.equal(custom.slots[0].title, 'Test');
  assert.equal(custom.slots[0].durationMinutes, 180);
  assert.equal(core.buildDayPlan(routineData, at(2026, 11, 9)).slots[0].title, 'Physics');
});

test('day summary derives upcoming, current, completed and missed statuses', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:30'),
    slot('slot-b', 'Mathematics', 'mathematics', 'mathematics', '11:00', '12:00'),
    slot('slot-c', 'Revision', 'revision', 'revision', '14:00', '15:00')
  ]);
  const sessions = [session('s1', at(2026, 11, 2, 9, 5), at(2026, 11, 2, 9, 45))];
  const summary = core.routineDaySummary(routineData, MONDAY, sessions, null, at(2026, 11, 2, 12, 30));
  const byId = new Map(summary.slots.map((item) => [item.id, item]));
  assert.equal(byId.get('slot-a').status, 'completed');
  assert.equal(byId.get('slot-b').status, 'missed');
  assert.equal(byId.get('slot-c').status, 'upcoming');
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.missedCount, 1);
  assert.equal(summary.plannedStudyMs, 210 * 60000);
  assert.equal(summary.actualStudyMs, 40 * 60000);
  assert.equal(summary.next.id, 'slot-c');
  assert.equal(summary.progressPct, 0.5);
});

test('a running session counts toward today without changing the plan', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  const active = { id: 'active-1', subjectId: 'physics', subjectName: 'Physics', entry: at(2026, 11, 2, 9, 10).toISOString() };
  const summary = core.routineDaySummary(routineData, MONDAY, [], active, at(2026, 11, 2, 9, 40));
  assert.equal(summary.slots[0].status, 'current');
  assert.equal(summary.actualStudyMs, 30 * 60000);
  assert.equal(summary.slots[0].actualMs, 30 * 60000);
  assert.equal(summary.plan.slots[0].durationMinutes, 60);
});

test('overnight activities carry into the next morning without duplicating history', () => {
  const routineData = routineWith('mon', [
    slot('sleep-1', 'Sleep', 'sleep', null, '23:00', '06:00')
  ]);
  core.ensureDayPlan(routineData, MONDAY, at(2026, 11, 2, 8, 0));
  const summary = core.routineDaySummary(routineData, at(2026, 11, 3), [], null, at(2026, 11, 3, 2, 0));
  const carry = summary.slots.find((item) => item.id === 'sleep-1');
  assert.ok(carry);
  assert.equal(carry.carryOver, true);
  assert.equal(carry.status, 'current');
  assert.equal(carry.planDate, '2026-11-02');
});

test('sessions link to a matching slot without rewriting actual times or subject', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:30')
  ]);
  core.ensureDayPlan(routineData, MONDAY, at(2026, 11, 2, 8, 0));
  const original = session('s1', at(2026, 11, 2, 9, 12), at(2026, 11, 2, 9, 48));
  const linked = core.linkSessionToRoutine(routineData, original, at(2026, 11, 2, 10, 0));
  assert.equal(linked.routineSlotId, 'slot-a');
  assert.equal(linked.routineDate, '2026-11-02');
  assert.equal(linked.routineTitle, 'Physics');
  assert.equal(linked.entry, original.entry);
  assert.equal(linked.exit, original.exit);
  assert.equal(linked.subjectId, original.subjectId);
});

test('editing the timetable leaves already-snapshotted days untouched', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  const now = at(2026, 11, 2, 8, 0);
  core.ensureDayPlan(routineData, MONDAY, now);
  assert.equal(routineData.dayPlans['2026-11-02'].slots[0].title, 'Physics');
  routineData.routines[0].days.mon = [slot('slot-a', 'Chemistry', 'chemistry', 'chemistry', '09:00', '10:00')];
  assert.equal(core.planForDate(routineData, MONDAY).slots[0].title, 'Physics');
  core.invalidateDayPlans(routineData, now);
  assert.equal(core.planForDate(routineData, MONDAY).slots[0].title, 'Chemistry');
});

test('planned versus actual analytics reports completion, subjects and missed slots', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:30'),
    slot('slot-b', 'Mathematics', 'mathematics', 'mathematics', '11:00', '12:00')
  ]);
  const subjects = core.defaultSubjects();
  const sessions = [session('s1', at(2026, 11, 2, 9, 5), at(2026, 11, 2, 9, 45))];
  const result = core.routineAnalytics(routineData, sessions, MONDAY, MONDAY, at(2026, 11, 2, 23, 0), subjects);
  assert.equal(result.plannedMs, 150 * 60000);
  assert.equal(result.actualMs, 40 * 60000);
  assert.equal(result.completionPct, 0.5);
  assert.equal(result.completedCount, 1);
  assert.equal(result.missedCount, 1);
  assert.equal(result.averageDailyMs, 40 * 60000);
  assert.equal(result.missedSessions.length, 1);
  assert.equal(result.missedSessions[0].title, 'Mathematics');
  const physics = result.bySubject.find((item) => item.id === 'physics');
  const maths = result.bySubject.find((item) => item.id === 'mathematics');
  assert.equal(physics.plannedMs, 90 * 60000);
  assert.equal(physics.actualMs, 40 * 60000);
  assert.equal(maths.plannedMs, 60 * 60000);
  assert.equal(maths.actualMs, 0);
  assert.equal(result.consistency.length, 2);
});

test('overlap validation covers same-day and across-midnight conflicts', () => {
  const day = [
    slot('a', 'Physics', 'physics', 'physics', '09:00', '10:00'),
    slot('b', 'Chemistry', 'chemistry', 'chemistry', '09:30', '10:30'),
    slot('c', 'Coding', 'coding', 'coding', '11:00', '12:00')
  ];
  assert.equal(core.findDayConflicts(day).length, 1);

  const routineData = routineWith('mon', [
    slot('night', 'Revision', 'revision', 'revision', '23:00', '01:00')
  ]);
  routineData.routines[0].days.tue = [
    slot('early', 'Physics', 'physics', 'physics', '00:30', '01:30')
  ];
  assert.equal(core.findRoutineConflicts(routineData.routines[0]).length, 1);
});

test('exact-time reminders are enabled by default for every activity', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  const atStart = core.dueNotifications(routineData, [], null, at(2026, 11, 2, 9, 0));
  assert.equal(atStart.length, 1);
  assert.equal(atStart[0].title, 'Time to Study – Physics');
  assert.match(atStart[0].body, /mark your Entry/);
  assert.equal(atStart[0].key, '2026-11-02:slot-a:0');

  routineData.notifications.activities['slot-a'] = { enabled: false, timings: null };
  assert.equal(core.dueNotifications(routineData, [], null, at(2026, 11, 2, 9, 0)).length, 0);
});

test('multiple reminders respect their offsets and suppress stale pre-alerts', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Chemistry', 'chemistry', 'chemistry', '09:00', '10:00')
  ]);
  routineData.notifications.timings = [0, 5, 10];
  assert.equal(core.dueNotifications(routineData, [], null, at(2026, 11, 2, 8, 45)).length, 0);
  const tenBefore = core.dueNotifications(routineData, [], null, at(2026, 11, 2, 8, 50));
  assert.equal(tenBefore.length, 1);
  assert.equal(tenBefore[0].offsetMinutes, 10);
  const fiveBefore = core.dueNotifications(routineData, [], null, at(2026, 11, 2, 8, 55));
  assert.deepEqual(fiveBefore.map((item) => item.offsetMinutes), [5]);
  const exact = core.dueNotifications(routineData, [], null, at(2026, 11, 2, 9, 0));
  assert.equal(exact.length, 1);
  assert.equal(exact[0].offsetMinutes, 0);
});

test('next reminder wake-up is exact and respects muted activities', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00'),
    slot('slot-b', 'Chemistry', 'chemistry', 'chemistry', '11:00', '12:00')
  ]);
  routineData.notifications.timings = [0, 5];
  assert.equal(core.nextNotificationAt(routineData, at(2026, 11, 2, 8, 40)), at(2026, 11, 2, 8, 55).getTime());
  assert.equal(core.nextNotificationAt(routineData, at(2026, 11, 2, 9, 0)), at(2026, 11, 2, 10, 0).getTime());
  routineData.notifications.activities['slot-a'] = { enabled: false, timings: null };
  assert.equal(core.nextNotificationAt(routineData, at(2026, 11, 2, 8, 40)), at(2026, 11, 2, 10, 55).getTime());
  routineData.exceptions.push({ id: 'h', date: '2026-11-02', kind: 'holiday', label: 'Holiday', slots: [] });
  assert.equal(core.nextNotificationAt(routineData, at(2026, 11, 2, 8, 40)), null);
  assert.equal(core.nextNotificationAt(routineData, at(2026, 11, 2, 23, 0)), null);
});

test('reminders are suppressed after a session starts or a slot is skipped', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  const live = [session('s1', at(2026, 11, 2, 9, 0), at(2026, 11, 2, 9, 30), 'physics', 'Physics', { routineSlotId: 'slot-a' })];
  assert.equal(core.dueNotifications(routineData, live, null, at(2026, 11, 2, 9, 1)).length, 0);

  routineData.completions['2026-11-02'] = { 'slot-a': { status: 'skipped', at: at(2026, 11, 2, 8, 55).toISOString() } };
  assert.equal(core.dueNotifications(routineData, [], null, at(2026, 11, 2, 9, 0)).length, 0);
});

test('missed reminders are opt-in, deduplicated and limited to recent slots', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  assert.equal(core.dueNotifications(routineData, [], null, at(2026, 11, 2, 10, 30)).length, 0);
  routineData.notifications.missedReminder = true;
  const missed = core.dueNotifications(routineData, [], null, at(2026, 11, 2, 10, 30));
  assert.equal(missed.length, 1);
  assert.equal(missed[0].kind, 'missed');
  routineData.notifyLog.push({ key: missed[0].key, kind: 'missed', sentAt: new Date().toISOString(), date: '2026-11-02', slotId: 'slot-a' });
  assert.equal(core.dueNotifications(routineData, [], null, at(2026, 11, 2, 10, 31)).length, 0);
  assert.equal(core.dueNotifications(routineData, [], null, at(2026, 11, 2, 12, 30)).length, 0);
});

test('holidays suppress routine reminders', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  routineData.exceptions.push({ id: 'h', date: '2026-11-02', kind: 'holiday', label: 'Holiday', slots: [] });
  assert.equal(core.dueNotifications(routineData, [], null, at(2026, 11, 2, 9, 0)).length, 0);
});

test('per-subject timing overrides inherit until the activity overrides them', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  routineData.notifications.subjects.physics = { enabled: null, timings: [0, 30] };
  let prefs = core.notificationPrefsForSlot(routineData, routineData.routines[0].days.mon[0]);
  assert.deepEqual(prefs.timings, [0, 30]);
  routineData.notifications.activities['slot-a'] = { enabled: null, timings: [15] };
  prefs = core.notificationPrefsForSlot(routineData, routineData.routines[0].days.mon[0]);
  assert.deepEqual(prefs.timings, [15]);
});

test('routine data survives normalization and keeps session associations', () => {
  const routineData = routineWith('mon', [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00')
  ]);
  const raw = core.defaultData();
  raw.routine = routineData;
  raw.sessions = [
    session('s1', at(2026, 11, 2, 9, 0), at(2026, 11, 2, 10, 0), 'physics', 'Physics', {
      routineSlotId: 'slot-a',
      routineDate: '2026-11-02',
      routineTitle: 'Physics'
    })
  ];
  const normalized = core.normalizeData(raw);
  assert.equal(normalized.sessions[0].routineSlotId, 'slot-a');
  assert.equal(normalized.sessions[0].routineDate, '2026-11-02');
  assert.equal(normalized.routine.routines[0].days.mon.length, 1);
  assert.equal(normalized.routine.notifications.timings[0], 0);
});

test('garbage routine data falls back to an editable empty routine', () => {
  const data = core.normalizeData({ routine: { routines: 'nope', notifications: { timings: [999] } } });
  assert.equal(data.routine.routines.length, 1);
  assert.deepEqual(data.routine.notifications.timings, [0]);
  assert.equal(data.routine.dayPlans && typeof data.routine.dayPlans, 'object');
});

test('template copies keep times and subjects with independent ids', () => {
  const source = [
    slot('slot-a', 'Physics', 'physics', 'physics', '09:00', '10:00'),
    slot('slot-b', 'Break', 'break', null, '10:00', '10:15')
  ];
  const used = new Set(['slot-a', 'slot-b']);
  const clones = core.cloneRoutineSlots(source, used);
  assert.equal(clones.length, 2);
  assert.equal(clones[0].title, 'Physics');
  assert.equal(clones[0].subjectId, 'physics');
  assert.equal(clones[0].start, '09:00');
  assert.equal(clones[0].end, '10:00');
  assert.notEqual(clones[0].id, 'slot-a');
  assert.notEqual(clones[0].id, clones[1].id);
  assert.ok(used.has(clones[0].id) && used.has(clones[1].id));
  assert.equal(source[0].id, 'slot-a');
  assert.equal(source[1].id, 'slot-b');
});
