/*
 * Study Register core logic.
 * Pure functions shared by the Electron main process, both renderer windows
 * and the Node test suite. No DOM, no Node APIs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SRCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const DEFAULT_TARGET_MINUTES = 360;
  const COLOR_PALETTE = ['#7C9CFF', '#35C98B', '#FFB86B', '#B98CFF', '#FF6268', '#5ED3E8', '#F4A4C0', '#9AD36B'];

  const DEFAULT_SUBJECTS = [
    { id: 'physics', name: 'Physics', color: '#7C9CFF' },
    { id: 'chemistry', name: 'Chemistry', color: '#35C98B' },
    { id: 'mathematics', name: 'Mathematics', color: '#FFB86B' },
    { id: 'coding', name: 'Coding', color: '#B98CFF' },
    { id: 'revision', name: 'Revision', color: '#FF6268' },
    { id: 'other', name: 'Other', color: '#9296A2' }
  ];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    return new Date(value);
  }

  function isValidDate(d) {
    return d instanceof Date && !Number.isNaN(d.getTime());
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function dateKey(value) {
    const d = toDate(value);
    if (!isValidDate(d)) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dateFromKey(key) {
    const parts = String(key || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return isValidDate(d) ? d : null;
  }

  function startOfDay(value) {
    const d = toDate(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(value, days) {
    const d = toDate(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  }

  function startOfWeek(value) {
    const d = startOfDay(value);
    const offset = (d.getDay() + 6) % 7;
    return addDays(d, -offset);
  }

  function startOfMonth(value) {
    const d = toDate(value);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function startOfNextMonth(value) {
    const d = toDate(value);
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }

  function startOfNextDay(value) {
    return addDays(startOfDay(value), 1);
  }

  function sessionDuration(session) {
    if (!session) return 0;
    const entry = new Date(session.entry).getTime();
    const exit = new Date(session.exit).getTime();
    if (!Number.isFinite(entry) || !Number.isFinite(exit)) return 0;
    return Math.max(0, exit - entry);
  }

  function overlapMs(entry, exit, start, end) {
    const a = Math.max(new Date(entry).getTime(), new Date(start).getTime());
    const b = Math.min(new Date(exit).getTime(), new Date(end).getTime());
    return Math.max(0, b - a);
  }

  /** Splits a finished session across local day boundaries. */
  function splitSessionByDay(session) {
    const out = [];
    const startMs = new Date(session.entry).getTime();
    const endMs = new Date(session.exit).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return out;
    let cursor = startMs;
    let guard = 0;
    while (cursor < endMs && guard < 370) {
      const dayEnd = startOfNextDay(new Date(cursor)).getTime();
      const segmentEnd = Math.min(endMs, dayEnd);
      out.push({ date: dateKey(new Date(cursor)), ms: segmentEnd - cursor });
      cursor = segmentEnd;
      guard += 1;
    }
    return out;
  }

  function dailyTotals(sessions) {
    const totals = new Map();
    (sessions || []).forEach((session) => {
      splitSessionByDay(session).forEach((seg) => {
        totals.set(seg.date, (totals.get(seg.date) || 0) + seg.ms);
      });
    });
    return totals;
  }

  function totalForDate(sessions, key) {
    return dailyTotals(sessions).get(key) || 0;
  }

  function statsForDate(sessions, key) {
    const dayStart = dateFromKey(key) || startOfDay(new Date());
    const dayEnd = startOfNextDay(dayStart);
    let total = 0;
    let count = 0;
    let longest = 0;
    (sessions || []).forEach((session) => {
      const ms = overlapMs(session.entry, session.exit, dayStart, dayEnd);
      if (ms > 0) {
        total += ms;
        count += 1;
        longest = Math.max(longest, ms);
      }
    });
    return {
      total,
      count,
      longest,
      average: count ? Math.round(total / count) : 0
    };
  }

  function streakInfo(sessions, now, minMs) {
    const minimum = minMs == null ? 60000 : minMs;
    const totals = dailyTotals(sessions);
    const today = dateKey(now || new Date());
    let cursor = startOfDay(now || new Date());
    if (!(totals.get(today) >= minimum)) cursor = addDays(cursor, -1);
    let count = 0;
    let guard = 0;
    while (guard < 3650) {
      const key = dateKey(cursor);
      if ((totals.get(key) || 0) >= minimum) {
        count += 1;
        cursor = addDays(cursor, -1);
        guard += 1;
      } else {
        break;
      }
    }
    return { count, studiedToday: (totals.get(today) || 0) >= minimum };
  }

  function buildRange(key, sessions, now) {
    const base = now || new Date();
    const today = startOfDay(base);
    if (key === 'week') {
      const start = startOfWeek(base);
      return { key, start, end: addDays(start, 7) };
    }
    if (key === 'month') {
      const start = startOfMonth(base);
      return { key, start, end: startOfNextMonth(base) };
    }
    if (key === 'all') {
      let start = today;
      (sessions || []).forEach((s) => {
        const entry = startOfDay(new Date(s.entry));
        if (isValidDate(entry) && entry < start) start = entry;
      });
      return { key, start, end: startOfNextDay(base) };
    }
    return { key: 'today', start: today, end: startOfNextDay(base) };
  }

  function sessionsInRange(sessions, start, end) {
    return (sessions || []).filter((s) => overlapMs(s.entry, s.exit, start, end) > 0);
  }

  function rangeStats(sessions, start, end) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    let total = 0;
    let count = 0;
    let longest = 0;
    let activeDays = 0;
    const daySet = new Set();
    (sessions || []).forEach((session) => {
      const ms = overlapMs(session.entry, session.exit, start, end);
      if (ms > 0) {
        total += ms;
        count += 1;
        longest = Math.max(longest, sessionDuration(session));
        splitSessionByDay(session).forEach((seg) => {
          if (seg.date >= dateKey(start) && seg.date < dateKey(end) && seg.ms > 0) daySet.add(seg.date);
        });
      }
    });
    activeDays = daySet.size;
    return {
      startMs,
      endMs,
      total,
      count,
      longest,
      activeDays,
      averagePerSession: count ? Math.round(total / count) : 0
    };
  }

  function countDays(start, end, now) {
    const base = now || new Date();
    const limit = new Date(Math.min(new Date(end).getTime(), startOfNextDay(base).getTime()));
    let cursor = startOfDay(start);
    let days = 0;
    let guard = 0;
    while (cursor < limit && guard < 4000) {
      days += 1;
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    return Math.max(1, days);
  }

  function subjectTotals(sessions, start, end, subjects) {
    const map = new Map();
    const lookup = new Map((subjects || []).map((s) => [s.id, s]));
    (sessions || []).forEach((session) => {
      const ms = overlapMs(session.entry, session.exit, start, end);
      if (ms <= 0) return;
      const key = session.subjectId || 'legacy:' + (session.subjectName || 'Other');
      const subject = lookup.get(session.subjectId);
      const entry = map.get(key) || {
        id: key,
        name: (subject && subject.name) || session.subjectName || 'Other',
        color: (subject && subject.color) || colorForName(session.subjectName || 'Other'),
        ms: 0
      };
      entry.ms += ms;
      if (subject) {
        entry.name = subject.name;
        entry.color = subject.color;
      }
      map.set(key, entry);
    });
    const list = Array.from(map.values()).sort((a, b) => b.ms - a.ms);
    const total = list.reduce((sum, item) => sum + item.ms, 0);
    list.forEach((item) => {
      item.pct = total ? item.ms / total : 0;
    });
    return { total, list };
  }

  function colorForName(name) {
    let hash = 0;
    for (let i = 0; i < String(name).length; i += 1) hash = (hash * 31 + String(name).charCodeAt(i)) >>> 0;
    return COLOR_PALETTE[hash % COLOR_PALETTE.length];
  }

  function dailySeries(sessions, start, end) {
    const out = [];
    let cursor = startOfDay(start);
    let guard = 0;
    while (cursor < end && guard < 400) {
      const key = dateKey(cursor);
      out.push({ date: key, start: cursor.getTime(), ms: 0 });
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    const index = new Map(out.map((item) => [item.date, item]));
    (sessions || []).forEach((session) => {
      splitSessionByDay(session).forEach((seg) => {
        const bucket = index.get(seg.date);
        if (bucket) bucket.ms += seg.ms;
      });
    });
    return out;
  }

  function monthlySeries(sessions, start, end) {
    const out = [];
    let cursor = startOfMonth(start);
    let guard = 0;
    while (cursor < end && guard < 600) {
      out.push({ date: dateKey(cursor), start: cursor.getTime(), ms: 0, month: cursor.getMonth(), year: cursor.getFullYear() });
      cursor = startOfNextMonth(cursor);
      guard += 1;
    }
    const inRange = (ms, from, to) => Math.max(0, Math.min(ms, to.getTime()) - Math.max(0, from.getTime()));
    (sessions || []).forEach((session) => {
      const sMs = new Date(session.entry).getTime();
      const eMs = new Date(session.exit).getTime();
      if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) return;
      out.forEach((bucket) => {
        const from = new Date(bucket.year, bucket.month, 1);
        const to = new Date(bucket.year, bucket.month + 1, 1);
        bucket.ms += Math.max(0, Math.min(eMs, to.getTime()) - Math.max(sMs, from.getTime()));
      });
    });
    return out;
  }

  function hourlySeries(sessions, key) {
    const day = dateFromKey(key) || startOfDay(new Date());
    const out = [];
    for (let hour = 0; hour < 24; hour += 1) {
      out.push({
        hour,
        start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).getTime(),
        ms: 0
      });
    }
    (sessions || []).forEach((session) => {
      const sMs = new Date(session.entry).getTime();
      const eMs = new Date(session.exit).getTime();
      if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) return;
      out.forEach((bucket) => {
        const hourStart = bucket.start;
        const hourEnd = hourStart + 3600000;
        bucket.ms += Math.max(0, Math.min(eMs, hourEnd) - Math.max(sMs, hourStart));
      });
    });
    return out;
  }

  function formatDuration(ms) {
    const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
    if (totalMinutes <= 0) return '0m';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return minutes + 'm';
    if (!minutes) return hours + 'h';
    return hours + 'h ' + pad2(minutes) + 'm';
  }

  function formatDurationLong(ms) {
    const totalMinutes = Math.round(Math.max(0, ms) / 60000);
    if (totalMinutes <= 0) return '0 minutes';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (hours) parts.push(hours + (hours === 1 ? ' hour' : ' hours'));
    if (minutes) parts.push(minutes + (minutes === 1 ? ' minute' : ' minutes'));
    return parts.join(' ');
  }

  function formatTimer(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds);
  }

  function formatHoursValue(ms) {
    const hours = Math.max(0, ms) / 3600000;
    if (hours >= 100) return Math.round(hours) + 'h';
    if (hours >= 10) return hours.toFixed(1).replace(/\.0$/, '') + 'h';
    return hours.toFixed(2).replace(/0$/, '').replace(/\.0$/, '').replace('.', '.') + 'h';
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (!isValidDate(d)) return '—';
    let hour = d.getHours();
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return pad2(hour) + ':' + pad2(d.getMinutes()) + ' ' + suffix;
  }

  function formatTimeWithSeconds(value) {
    const d = toDate(value);
    let hour = d.getHours();
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return pad2(hour) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ' ' + suffix;
  }

  function formatDateFull(value) {
    const d = toDate(value);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(d);
  }

  function formatDateMedium(value) {
    const d = toDate(value);
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }

  function formatMonthYear(value) {
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(toDate(value));
  }

  function formatDayLabel(key, now) {
    const todayKey = dateKey(now || new Date());
    const yesterdayKey = dateKey(addDays(startOfDay(now || new Date()), -1));
    if (key === todayKey) return 'Today';
    if (key === yesterdayKey) return 'Yesterday';
    const d = dateFromKey(key);
    if (!d) return key;
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  }

  function rangeLabel(key, range, now) {
    const base = now || new Date();
    if (key === 'today') {
      return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(base);
    }
    if (key === 'week') {
      const start = range.start;
      const end = addDays(range.start, 6);
      return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(start) +
        ' – ' +
        new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(end);
    }
    if (key === 'month') return formatMonthYear(base);
    return formatDateMedium(range.start) + ' – ' + formatDateMedium(base);
  }

  function toLocalInputValue(value) {
    const d = toDate(value);
    if (!isValidDate(d)) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function fromLocalInputValue(value) {
    if (!value) return null;
    const d = new Date(value);
    return isValidDate(d) ? d : null;
  }

  function relativeTime(iso, now) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const diff = Math.max(0, (now || Date.now()) - then);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  function sanitizeSubjectName(name) {
    return String(name == null ? '' : name)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 32);
  }

  /* ------------------------------------------------------------------ */
  /* My Routine                                                          */
  /* ------------------------------------------------------------------ */

  const WEEKDAYS = [
    { id: 'mon', label: 'Monday', short: 'Mon' },
    { id: 'tue', label: 'Tuesday', short: 'Tue' },
    { id: 'wed', label: 'Wednesday', short: 'Wed' },
    { id: 'thu', label: 'Thursday', short: 'Thu' },
    { id: 'fri', label: 'Friday', short: 'Fri' },
    { id: 'sat', label: 'Saturday', short: 'Sat' },
    { id: 'sun', label: 'Sunday', short: 'Sun' }
  ];
  const WEEKDAY_IDS = WEEKDAYS.map((day) => day.id);
  const ACTIVITY_TYPES = [
    { id: 'physics', label: 'Physics', study: true },
    { id: 'chemistry', label: 'Chemistry', study: true },
    { id: 'mathematics', label: 'Mathematics', study: true },
    { id: 'coding', label: 'Coding', study: true },
    { id: 'revision', label: 'Revision', study: true },
    { id: 'coaching', label: 'Coaching / Classes', study: true },
    { id: 'homework', label: 'Homework', study: true },
    { id: 'break', label: 'Break', study: false },
    { id: 'personal', label: 'Personal', study: false },
    { id: 'sleep', label: 'Sleep', study: false },
    { id: 'other', label: 'Other', study: true }
  ];
  const NOTIFICATION_OFFSETS = [0, 5, 10, 15, 30];
  const DEFAULT_NOTIFICATION_TIMINGS = [0];
  const ROUTINE_REMINDER_GRACE_MS = 10 * 60000;
  const ROUTINE_MISSED_GRACE_MS = 60 * 60000;

  function sanitizeRoutineText(value, max) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function clockMinutes(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function minuteString(minutes) {
    const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
  }

  function normalizeClock(value, fallback) {
    const minutes = clockMinutes(value);
    return minutes == null ? fallback : minuteString(minutes);
  }

  function formatClock(value) {
    const minutes = clockMinutes(value);
    if (minutes == null) return '—';
    let hour = Math.floor(minutes / 60);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return hour + ':' + pad2(minutes % 60) + ' ' + suffix;
  }

  function formatClockRange(start, end) {
    return formatClock(start) + ' – ' + formatClock(end);
  }

  function asLocalDate(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return dateFromKey(value) || new Date(NaN);
    }
    return toDate(value);
  }

  function weekdayId(value) {
    const date = asLocalDate(value);
    if (!isValidDate(date)) return WEEKDAY_IDS[0];
    return WEEKDAY_IDS[(date.getDay() + 6) % 7];
  }

  function activityType(type) {
    return ACTIVITY_TYPES.find((item) => item.id === type) || ACTIVITY_TYPES[ACTIVITY_TYPES.length - 1];
  }

  function isStudyType(type) {
    return activityType(type).study;
  }

  function slotWindow(slot) {
    if (!slot) return null;
    const start = clockMinutes(slot.start);
    const end = clockMinutes(slot.end);
    if (start == null || end == null || end === start) return null;
    const overnight = end < start;
    const duration = overnight ? end + 1440 - start : end - start;
    return { start, end: start + duration, overnight, duration };
  }

  function normalizeTimingList(raw, fallback) {
    if (!Array.isArray(raw)) return fallback.slice();
    const list = Array.from(new Set(raw.map(Number).filter((n) => NOTIFICATION_OFFSETS.includes(n))))
      .sort((a, b) => a - b);
    return raw.length && !list.length ? fallback.slice() : list;
  }

  function normalizePrefMap(raw) {
    const out = {};
    Object.entries(raw && typeof raw === 'object' ? raw : {}).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;
      const id = String(key).slice(0, 80);
      if (!id) return;
      out[id] = {
        enabled: typeof value.enabled === 'boolean' ? value.enabled : null,
        timings: Array.isArray(value.timings) ? normalizeTimingList(value.timings, []) : null
      };
    });
    return out;
  }

  function normalizeRoutineSlot(raw, subjects, seenIds, defaultType) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const subjectIds = new Set((subjects || []).map((item) => item.id));
    let type = ACTIVITY_TYPES.some((item) => item.id === source.type) ? source.type : null;
    if (!type) type = ACTIVITY_TYPES.some((item) => item.id === defaultType) ? defaultType : 'other';
    const meta = activityType(type);
    const subjectId = subjectIds.has(source.subjectId) ? source.subjectId : null;
    const subject = subjectId ? (subjects || []).find((item) => item.id === subjectId) : null;
    let title = sanitizeRoutineText(source.title, 64);
    if (!title) title = subject ? subject.name : meta.label;
    const start = normalizeClock(source.start, '09:00');
    let end = normalizeClock(source.end, '10:00');
    if (end === start) end = minuteString(clockMinutes(start) + 60);
    let id = source.id ? String(source.id).slice(0, 80) : slugId('slot');
    if (seenIds.has(id)) id = slugId('slot');
    seenIds.add(id);
    return {
      id,
      title,
      type,
      subjectId,
      notes: sanitizeRoutineText(source.notes, 240),
      start,
      end,
      createdAt: isValidDate(new Date(source.createdAt)) ? new Date(source.createdAt).toISOString() : new Date().toISOString()
    };
  }

  function cloneRoutineSlots(slots, usedIds) {
    const ids = usedIds instanceof Set ? usedIds : new Set(usedIds || []);
    const createdAt = new Date().toISOString();
    return (Array.isArray(slots) ? slots : []).map((slot) => {
      let id = slugId('slot');
      while (ids.has(id)) id = slugId('slot');
      ids.add(id);
      return Object.assign({}, slot, { id, createdAt });
    });
  }

  function normalizeRoutine(raw, subjects, seenIds) {
    const source = raw && typeof raw === 'object' ? raw : {};
    let id = source.id ? String(source.id).slice(0, 80) : slugId('routine');
    if (seenIds.has(id)) id = slugId('routine');
    seenIds.add(id);
    const days = {};
    WEEKDAY_IDS.forEach((day) => {
      const list = source.days && Array.isArray(source.days[day]) ? source.days[day] : [];
      days[day] = list.slice(0, 60)
        .map((slot) => normalizeRoutineSlot(slot, subjects, seenIds))
        .filter((slot) => slotWindow(slot))
        .sort((a, b) => {
          const wa = slotWindow(a);
          const wb = slotWindow(b);
          return wa.start - wb.start || wa.end - wb.end;
        });
    });
    return {
      id,
      name: sanitizeRoutineText(source.name, 48) || 'My Routine',
      isDefault: source.isDefault === true,
      days
    };
  }

  function defaultRoutineEntry(seenIds) {
    let id = 'routine-main';
    if (seenIds.has(id)) id = slugId('routine');
    seenIds.add(id);
    const days = {};
    WEEKDAY_IDS.forEach((day) => { days[day] = []; });
    return { id, name: 'My Routine', isDefault: true, days };
  }

  function normalizeRoutineException(raw, subjects, seenIds) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const date = dateKey(source.date);
    if (!date) return null;
    let id = source.id ? String(source.id).slice(0, 80) : slugId('exception');
    if (seenIds.has(id)) id = slugId('exception');
    seenIds.add(id);
    const kind = source.kind === 'custom' ? 'custom' : 'holiday';
    const slots = kind === 'custom'
      ? (Array.isArray(source.slots) ? source.slots : []).slice(0, 60)
        .map((slot) => normalizeRoutineSlot(slot, subjects, seenIds))
        .filter((slot) => slotWindow(slot))
        .sort((a, b) => slotWindow(a).start - slotWindow(b).start)
      : [];
    return {
      id,
      date,
      kind,
      label: sanitizeRoutineText(source.label, 48) || (kind === 'holiday' ? 'Holiday' : 'Custom day'),
      slots
    };
  }

  function normalizeDayPlanSlot(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const startAt = new Date(source.startAt).getTime();
    const endAt = new Date(source.endAt).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return null;
    const window = slotWindow(source);
    const start = window ? source.start : new Date(startAt).toTimeString().slice(0, 5);
    const end = window ? source.end : new Date(endAt).toTimeString().slice(0, 5);
    const type = ACTIVITY_TYPES.some((item) => item.id === source.type) ? source.type : 'other';
    return {
      id: source.id ? String(source.id).slice(0, 80) : slugId('slot'),
      title: sanitizeRoutineText(source.title, 64) || activityType(type).label,
      type,
      subjectId: source.subjectId ? String(source.subjectId).slice(0, 80) : null,
      notes: sanitizeRoutineText(source.notes, 240),
      start,
      end,
      startAt,
      endAt,
      overnight: Boolean(window && window.overnight),
      durationMinutes: Math.round((endAt - startAt) / 60000)
    };
  }

  function normalizeDayPlan(raw, key, fallbackNow) {
    const source = raw && typeof raw === 'object' ? raw : {};
    if (!dateFromKey(key)) return null;
    const seen = new Set();
    const slots = (Array.isArray(source.slots) ? source.slots : [])
      .map(normalizeDayPlanSlot)
      .filter(Boolean)
      .filter((slot) => {
        if (seen.has(slot.id)) return false;
        seen.add(slot.id);
        return true;
      })
      .sort((a, b) => a.startAt - b.startAt);
    const sourceDate = dateFromKey(key);
    return {
      date: key,
      weekday: weekdayId(sourceDate),
      source: ['routine', 'custom', 'holiday', 'none'].includes(source.source) ? source.source : 'routine',
      holiday: source.holiday === true,
      routineId: source.routineId ? String(source.routineId).slice(0, 80) : null,
      routineName: sanitizeRoutineText(source.routineName, 48),
      label: sanitizeRoutineText(source.label, 48),
      tzOffset: Number.isFinite(source.tzOffset) ? source.tzOffset : sourceDate.getTimezoneOffset(),
      createdAt: isValidDate(new Date(source.createdAt))
        ? new Date(source.createdAt).toISOString()
        : (fallbackNow || new Date()).toISOString(),
      slots
    };
  }

  function normalizeCompletions(raw) {
    const out = {};
    Object.entries(raw && typeof raw === 'object' ? raw : {}).forEach(([key, value]) => {
      if (!dateFromKey(key) || !value || typeof value !== 'object') return;
      const day = {};
      Object.entries(value).forEach(([slotId, state]) => {
        if (!state) return;
        const status = typeof state === 'string' ? state : state.status;
        if (status !== 'done' && status !== 'skipped') return;
        const stamp = state && state.at && isValidDate(new Date(state.at)) ? new Date(state.at).toISOString() : new Date().toISOString();
        day[String(slotId).slice(0, 80)] = { status, at: stamp };
      });
      if (Object.keys(day).length) out[key] = day;
    });
    return out;
  }

  function normalizeNotifyLog(raw) {
    return (Array.isArray(raw) ? raw : [])
      .filter((item) => item && typeof item === 'object' && item.key)
      .slice(-500)
      .map((item) => ({
        key: String(item.key).slice(0, 160),
        kind: ['start', 'upcoming', 'missed', 'end'].includes(item.kind) ? item.kind : 'start',
        sentAt: isValidDate(new Date(item.sentAt)) ? new Date(item.sentAt).toISOString() : new Date().toISOString(),
        date: dateFromKey(item.date) ? item.date : '',
        slotId: item.slotId ? String(item.slotId).slice(0, 80) : ''
      }));
  }

  function normalizeRoutineData(raw, subjects, now) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const rawRoutines = Array.isArray(source.routines) ? source.routines.slice(0, 12) : [];
    let routines = rawRoutines.map((routine) => normalizeRoutine(routine, subjects, seen)).filter(Boolean);
    if (!routines.length) routines = [defaultRoutineEntry(seen)];

    let chosen = routines.find((routine) => routine.isDefault);
    if (!chosen && source.defaultRoutineId) chosen = routines.find((routine) => routine.id === source.defaultRoutineId);
    if (!chosen) chosen = routines[0];
    routines.forEach((routine) => { routine.isDefault = routine.id === chosen.id; });

    const schedule = {};
    WEEKDAY_IDS.forEach((day) => {
      const id = source.schedule && typeof source.schedule[day] === 'string' ? source.schedule[day] : null;
      schedule[day] = routines.some((routine) => routine.id === id) ? id : null;
    });

    const exceptionSeen = new Set();
    const byDate = new Map();
    (Array.isArray(source.exceptions) ? source.exceptions : []).forEach((item) => {
      const exception = normalizeRoutineException(item, subjects, exceptionSeen);
      if (exception) byDate.set(exception.date, exception);
    });
    const exceptions = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-400);

    const dayPlans = {};
    Object.entries(source.dayPlans && typeof source.dayPlans === 'object' ? source.dayPlans : {})
      .forEach(([key, value]) => {
        const plan = normalizeDayPlan(value, key, now);
        if (plan) dayPlans[key] = plan;
      });
    const planKeys = Object.keys(dayPlans).sort();
    if (planKeys.length > 800) {
      planKeys.slice(0, planKeys.length - 800).forEach((key) => delete dayPlans[key]);
    }

    const notifications = source.notifications && typeof source.notifications === 'object' ? source.notifications : {};
    return {
      version: 1,
      defaultRoutineId: chosen.id,
      routines,
      schedule,
      exceptions,
      dayPlans,
      completions: normalizeCompletions(source.completions),
      notifications: {
        enabled: notifications.enabled !== false,
        timings: normalizeTimingList(notifications.timings, DEFAULT_NOTIFICATION_TIMINGS),
        missedReminder: notifications.missedReminder === true,
        completionReminder: notifications.completionReminder !== false,
        subjects: normalizePrefMap(notifications.subjects),
        activities: normalizePrefMap(notifications.activities)
      },
      notifyLog: normalizeNotifyLog(source.notifyLog)
    };
  }

  function defaultRoutineData() {
    const seen = new Set();
    const routine = defaultRoutineEntry(seen);
    const schedule = {};
    WEEKDAY_IDS.forEach((day) => { schedule[day] = null; });
    return {
      version: 1,
      defaultRoutineId: routine.id,
      routines: [routine],
      schedule,
      exceptions: [],
      dayPlans: {},
      completions: {},
      notifications: {
        enabled: true,
        timings: DEFAULT_NOTIFICATION_TIMINGS.slice(),
        missedReminder: false,
        completionReminder: true,
        subjects: {},
        activities: {}
      },
      notifyLog: []
    };
  }

  function routineById(routineData, id) {
    if (!routineData || !id) return null;
    return (routineData.routines || []).find((routine) => routine.id === id) || null;
  }

  function defaultRoutine(routineData) {
    if (!routineData) return null;
    return routineById(routineData, routineData.defaultRoutineId) ||
      (routineData.routines || []).find((routine) => routine.isDefault) ||
      (routineData.routines || [])[0] || null;
  }

  function absoluteSlot(slot, date, routineId) {
    const window = slotWindow(slot);
    if (!window) return null;
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const startAt = new Date(year, month, day, 0, window.start).getTime();
    const endDay = day + (window.end >= 1440 ? 1 : 0);
    const endAt = new Date(year, month, endDay, 0, window.end % 1440).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return null;
    return {
      id: slot.id,
      title: slot.title,
      type: slot.type,
      subjectId: slot.subjectId || null,
      notes: slot.notes || '',
      start: slot.start,
      end: slot.end,
      startAt,
      endAt,
      overnight: window.overnight,
      durationMinutes: window.duration,
      routineId: routineId || null
    };
  }

  function buildDayPlan(routineData, dateLike, now) {
    const date = asLocalDate(dateLike);
    if (!isValidDate(date)) return null;
    const key = dateKey(date);
    const weekday = weekdayId(date);
    const exceptions = routineData ? routineData.exceptions || [] : [];
    const exception = exceptions.find((item) => item.date === key) || null;
    const stamp = (now || new Date()).toISOString();

    if (exception && exception.kind === 'holiday') {
      return {
        date: key,
        weekday,
        source: 'holiday',
        holiday: true,
        routineId: null,
        routineName: '',
        label: exception.label || 'Holiday',
        tzOffset: date.getTimezoneOffset(),
        createdAt: stamp,
        slots: []
      };
    }

    let routine = null;
    let source = 'none';
    let daySlots = [];
    let label = 'No routine assigned';
    if (exception && exception.kind === 'custom') {
      source = 'custom';
      daySlots = exception.slots || [];
      label = exception.label || 'Custom day';
    } else {
      const assignedId = routineData && routineData.schedule ? routineData.schedule[weekday] : null;
      routine = routineById(routineData, assignedId) || defaultRoutine(routineData);
      if (routine) {
        source = 'routine';
        daySlots = (routine.days && routine.days[weekday]) || [];
        label = routine.name;
      }
    }

    return {
      date: key,
      weekday,
      source,
      holiday: false,
      routineId: routine ? routine.id : null,
      routineName: routine ? routine.name : '',
      label,
      tzOffset: date.getTimezoneOffset(),
      createdAt: stamp,
      slots: daySlots
        .map((slot) => absoluteSlot(slot, date, routine ? routine.id : null))
        .filter(Boolean)
        .sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt)
    };
  }

  function planForDate(routineData, dateLike) {
    const date = asLocalDate(dateLike);
    if (!isValidDate(date)) return null;
    const key = dateKey(date);
    const stored = routineData && routineData.dayPlans ? routineData.dayPlans[key] : null;
    return stored || buildDayPlan(routineData, date);
  }

  function ensureDayPlan(routineData, dateLike, now) {
    if (!routineData) return null;
    const date = asLocalDate(dateLike);
    if (!isValidDate(date)) return null;
    const key = dateKey(date);
    const stored = routineData.dayPlans[key];
    if (stored && stored.tzOffset === date.getTimezoneOffset()) return stored;
    const plan = buildDayPlan(routineData, date, now);
    if (!plan) return null;
    const today = startOfDay(now || new Date());
    if (date >= today) {
      routineData.dayPlans[key] = plan;
      const keys = Object.keys(routineData.dayPlans).sort();
      if (keys.length > 800) {
        keys.slice(0, keys.length - 800).forEach((oldKey) => delete routineData.dayPlans[oldKey]);
      }
    }
    return plan;
  }

  function invalidateDayPlans(routineData, now) {
    if (!routineData) return;
    const today = dateKey(now || new Date());
    Object.keys(routineData.dayPlans || {}).forEach((key) => {
      if (key >= today) delete routineData.dayPlans[key];
    });
  }

  function refreshDayPlans(routineData, now) {
    if (!routineData) return;
    const today = dateKey(now || new Date());
    Object.keys(routineData.dayPlans || {}).forEach((key) => {
      const plan = routineData.dayPlans[key];
      const date = dateFromKey(key);
      if (key >= today && date && plan.tzOffset !== date.getTimezoneOffset()) delete routineData.dayPlans[key];
    });
  }

  function completionFor(routineData, key, slotId) {
    const day = routineData && routineData.completions ? routineData.completions[key] : null;
    return (day && day[slotId]) || null;
  }

  function liveSessions(sessions, activeSession, now) {
    const list = Array.isArray(sessions) ? sessions.slice() : [];
    if (activeSession) {
      const entry = new Date(activeSession.entry).getTime();
      if (Number.isFinite(entry)) {
        list.push({
          id: activeSession.id || 'active',
          subjectId: activeSession.subjectId,
          subjectName: activeSession.subjectName,
          entry: activeSession.entry,
          exit: new Date(now || Date.now()).toISOString(),
          routineSlotId: activeSession.routineSlotId || null,
          routineDate: activeSession.routineDate || null
        });
      }
    }
    return list;
  }

  function slotActualMs(slot, sessions) {
    if (!slot) return 0;
    let total = 0;
    (sessions || []).forEach((session) => {
      if (session.routineSlotId && session.routineSlotId !== slot.id) return;
      total += overlapMs(session.entry, session.exit, slot.startAt, slot.endAt);
    });
    return total;
  }

  function slotCompleteThreshold(slot) {
    return Math.min(10 * 60000, Math.max(60000, (slot.durationMinutes || 0) * 60000 * 0.25));
  }

  function slotStatus(slot, context) {
    const ctx = context || {};
    if (ctx.completion) return ctx.completion.status === 'skipped' ? 'skipped' : 'completed';
    const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
    if (nowMs < slot.startAt) return 'upcoming';
    if (nowMs < slot.endAt) return 'current';
    if (!isStudyType(slot.type)) return 'completed';
    return (ctx.actualMs || 0) >= slotCompleteThreshold(slot) ? 'completed' : 'missed';
  }

  function routineDaySummary(routineData, dateLike, sessions, activeSession, now) {
    const date = asLocalDate(dateLike);
    if (!isValidDate(date)) return null;
    const nowDate = now || new Date();
    const nowMs = nowDate.getTime();
    const key = dateKey(date);
    const plan = planForDate(routineData, date) || buildDayPlan(routineData, date, nowDate);
    const dayStart = startOfDay(date).getTime();
    const dayEnd = startOfNextDay(date).getTime();
    const live = liveSessions(sessions, activeSession, nowDate);
    const actualStudyMs = live.reduce((sum, session) => sum + overlapMs(session.entry, session.exit, dayStart, dayEnd), 0);

    const priorPlan = routineData && routineData.dayPlans ? routineData.dayPlans[dateKey(addDays(date, -1))] : null;
    const carrySlots = priorPlan
      ? priorPlan.slots
        .filter((slot) => slot.startAt < dayStart && slot.endAt > dayStart)
        .map((slot) => Object.assign({}, slot, { carryOver: true, planDate: priorPlan.date }))
      : [];

    const decorate = (slot, planDate) => {
      const completion = completionFor(routineData, planDate, slot.id);
      const actual = slotActualMs(slot, live);
      const status = slotStatus(slot, { nowMs, completion, actualMs: actual });
      return Object.assign({}, slot, {
        planDate,
        completion,
        actualMs: actual,
        differenceMs: actual - slot.durationMinutes * 60000,
        status
      });
    };

    const presentSlots = carrySlots.concat(plan.slots.map((slot) => Object.assign({}, slot, { planDate: plan.date })));
    const slots = presentSlots
      .map((slot) => decorate(slot, slot.planDate))
      .sort((a, b) => a.startAt - b.startAt);
    const todaySlots = slots.filter((slot) => slot.planDate === key);
    const studySlots = todaySlots.filter((slot) => isStudyType(slot.type));
    const completed = studySlots.filter((slot) => slot.status === 'completed').length;
    const missed = studySlots.filter((slot) => slot.status === 'missed').length;
    const skipped = studySlots.filter((slot) => slot.status === 'skipped').length;
    const ended = studySlots.filter((slot) => slot.status !== 'upcoming' && slot.status !== 'current').length;
    const plannedStudyMs = studySlots.reduce((sum, slot) => sum + slot.durationMinutes * 60000, 0);
    const remainingStudyMs = studySlots.reduce((sum, slot) => {
      if (slot.status === 'skipped') return sum;
      return sum + Math.max(0, slot.endAt - Math.max(nowMs, slot.startAt));
    }, 0);
    const current = slots.find((slot) => slot.status === 'current') || null;
    const next = slots.find((slot) => slot.startAt > nowMs && slot.status !== 'skipped') || null;
    const nextStudy = slots.find((slot) => slot.startAt > nowMs && slot.status !== 'skipped' && isStudyType(slot.type)) || null;

    return {
      date: key,
      plan,
      label: plan.label,
      source: plan.source,
      holiday: plan.holiday,
      slots,
      current,
      next,
      nextStudy,
      plannedStudyMs,
      actualStudyMs,
      remainingStudyMs,
      differenceMs: actualStudyMs - plannedStudyMs,
      completedCount: completed,
      missedCount: missed,
      skippedCount: skipped,
      endedCount: ended,
      studySlotCount: studySlots.length,
      progressPct: ended ? completed / ended : 0
    };
  }

  function slotSubjectId(slot, subjects) {
    if (!slot) return null;
    const list = subjects || [];
    if (slot.subjectId && list.some((subject) => subject.id === slot.subjectId)) return slot.subjectId;
    if (list.some((subject) => subject.id === slot.type)) return slot.type;
    const title = String(slot.title || '').toLowerCase();
    const byTitle = list.find((subject) => subject.name.toLowerCase() === title);
    if (byTitle) return byTitle.id;
    const typeLabel = activityType(slot.type).label.toLowerCase();
    const byType = list.find((subject) => subject.name.toLowerCase() === typeLabel);
    return byType ? byType.id : null;
  }

  function suggestRoutineSlot(routineData, sessions, activeSession, now, subjects) {
    const summary = routineDaySummary(routineData, now || new Date(), sessions, activeSession, now);
    if (!summary) return null;
    const current = summary.slots.find((slot) => slot.status === 'current' && isStudyType(slot.type));
    if (current) {
      return { slot: current, kind: 'current', subjectId: slotSubjectId(current, subjects) };
    }
    if (summary.nextStudy) {
      return { slot: summary.nextStudy, kind: 'next', subjectId: slotSubjectId(summary.nextStudy, subjects) };
    }
    return null;
  }

  function sessionSlotOverlap(session, slot) {
    return overlapMs(session.entry, session.exit, slot.startAt, slot.endAt);
  }

  function linkSessionToRoutine(routineData, session, now) {
    if (!routineData || !session) return session;
    const entry = new Date(session.entry);
    if (!isValidDate(entry)) return session;
    const keys = [dateKey(entry)];
    const priorKey = dateKey(addDays(startOfDay(entry), -1));
    if (routineData.dayPlans && routineData.dayPlans[priorKey]) keys.push(priorKey);
    let best = null;
    keys.forEach((key) => {
      const plan = routineData.dayPlans[key] || (key === dateKey(entry) ? buildDayPlan(routineData, entry) : null);
      if (!plan || plan.holiday) return;
      plan.slots.forEach((slot) => {
        if (!isStudyType(slot.type)) return;
        const overlap = sessionSlotOverlap(session, slot);
        if (overlap <= 0) return;
        const entryInside = entry.getTime() >= slot.startAt && entry.getTime() < slot.endAt;
        const score = overlap + (entryInside ? 1 : 0);
        if (!best || score > best.score) best = { slot, plan, score };
      });
    });
    if (!best) return session;
    return Object.assign({}, session, {
      routineSlotId: best.slot.id,
      routineDate: best.plan.date,
      routineTitle: best.slot.title
    });
  }

  function routineAnalytics(routineData, sessions, startLike, endLike, now, subjects) {
    const start = startOfDay(asLocalDate(startLike));
    const end = startOfDay(asLocalDate(endLike));
    if (!isValidDate(start) || !isValidDate(end) || end < start) {
      return {
        plannedMs: 0, actualMs: 0, differenceMs: 0, completionPct: 0,
        averageDailyMs: 0, completedCount: 0, missedCount: 0, skippedCount: 0,
        endedCount: 0, bySubject: [], consistency: [], missedSessions: [], dayCount: 0
      };
    }
    const nowDate = now || new Date();
    const today = startOfDay(nowDate);
    const nowMs = nowDate.getTime();
    const sessionList = Array.isArray(sessions) ? sessions : [];
    const subjectList = Array.isArray(subjects) ? subjects : [];
    const bySubject = new Map();
    const consistency = new Map();
    const missedSessions = [];
    let plannedMs = 0;
    let actualMs = 0;
    let completedCount = 0;
    let missedCount = 0;
    let skippedCount = 0;
    let endedCount = 0;
    let dayCount = 0;
    let elapsedDays = 0;
    const guardEnd = end.getTime();

    const subjectBucket = (key, name, color) => {
      const bucket = bySubject.get(key) || { id: key, name, color, plannedMs: 0, actualMs: 0 };
      bySubject.set(key, bucket);
      return bucket;
    };

    let cursor = start;
    let guard = 0;
    while (cursor.getTime() <= guardEnd && guard < 400) {
      const key = dateKey(cursor);
      const dayStart = cursor.getTime();
      const dayEnd = startOfNextDay(cursor).getTime();
      dayCount += 1;
      if (cursor <= today) elapsedDays += 1;
      const plan = planForDate(routineData, cursor) || buildDayPlan(routineData, cursor, nowDate);
      const planSlots = plan && !plan.holiday ? plan.slots.filter((slot) => isStudyType(slot.type)) : [];

      planSlots.forEach((slot) => {
        plannedMs += slot.durationMinutes * 60000;
        const subjectId = slotSubjectId(slot, subjectList);
        const subject = subjectId ? subjectList.find((item) => item.id === subjectId) : null;
        const bucket = subjectBucket(
          subject ? subject.id : 'plan:' + slot.title.toLowerCase(),
          subject ? subject.name : slot.title,
          subject ? subject.color : colorForName(slot.title)
        );
        bucket.plannedMs += slot.durationMinutes * 60000;
      });

      sessionList.forEach((session) => {
        const ms = overlapMs(session.entry, session.exit, dayStart, dayEnd);
        if (ms <= 0) return;
        actualMs += ms;
        const subject = subjectList.find((item) => item.id === session.subjectId);
        const bucket = subjectBucket(
          session.subjectId || 'session:' + String(session.subjectName || 'Other').toLowerCase(),
          (subject && subject.name) || session.subjectName || 'Other',
          (subject && subject.color) || colorForName(session.subjectName || 'Other')
        );
        bucket.actualMs += ms;
      });

      if (cursor <= today) {
        const completionDay = routineData && routineData.completions ? routineData.completions[key] : null;
        planSlots.forEach((slot) => {
          const completion = completionDay ? completionDay[slot.id] : null;
          if (slot.endAt > nowMs && !completion) return;
          const actual = slotActualMs(slot, sessionList);
          const status = slotStatus(slot, { nowMs, completion, actualMs: actual });
          if (status === 'upcoming' || status === 'current') return;
          endedCount += 1;
          const slotKey = [weekdayId(cursor), slot.start, slot.end, slot.title, slot.type].join('|');
          const stat = consistency.get(slotKey) || {
            key: slotKey,
            weekday: weekdayId(cursor),
            title: slot.title,
            type: slot.type,
            start: slot.start,
            end: slot.end,
            ended: 0,
            completed: 0,
            missed: 0
          };
          stat.ended += 1;
          if (status === 'completed') {
            completedCount += 1;
            stat.completed += 1;
          } else if (status === 'skipped') {
            skippedCount += 1;
          } else {
            missedCount += 1;
            stat.missed += 1;
            const subjectId = slotSubjectId(slot, subjectList);
            const subject = subjectId ? subjectList.find((item) => item.id === subjectId) : null;
            missedSessions.push({
              date: key,
              slotId: slot.id,
              title: slot.title,
              type: slot.type,
              start: slot.start,
              end: slot.end,
              subjectId,
              subjectName: (subject && subject.name) || slot.title
            });
          }
          consistency.set(slotKey, stat);
        });
      }

      cursor = addDays(cursor, 1);
      guard += 1;
    }

    const bySubjectList = Array.from(bySubject.values())
      .map((item) => Object.assign(item, { differenceMs: item.actualMs - item.plannedMs }))
      .sort((a, b) => b.plannedMs - a.plannedMs || b.actualMs - a.actualMs);
    const consistencyList = Array.from(consistency.values())
      .map((item) => Object.assign(item, { completionPct: item.ended ? item.completed / item.ended : 0 }))
      .sort((a, b) => b.completionPct - a.completionPct || b.ended - a.ended);
    missedSessions.sort((a, b) => b.date.localeCompare(a.date) || a.start.localeCompare(b.start));

    return {
      plannedMs,
      actualMs,
      differenceMs: actualMs - plannedMs,
      completionPct: endedCount ? completedCount / endedCount : 0,
      averageDailyMs: elapsedDays ? Math.round(actualMs / elapsedDays) : 0,
      completedCount,
      missedCount,
      skippedCount,
      endedCount,
      dayCount,
      elapsedDays,
      bySubject: bySubjectList,
      consistency: consistencyList,
      missedSessions
    };
  }

  function notificationPrefsForSlot(routineData, slot) {
    const settings = routineData && routineData.notifications ? routineData.notifications : {};
    const subjectPref = slot && slot.subjectId && settings.subjects ? settings.subjects[slot.subjectId] : null;
    const activityPref = slot && settings.activities ? settings.activities[slot.id] : null;
    let enabled = settings.enabled !== false;
    if (subjectPref && subjectPref.enabled === false) enabled = false;
    if (activityPref && activityPref.enabled === false) enabled = false;
    let timings = normalizeTimingList(settings.timings, DEFAULT_NOTIFICATION_TIMINGS);
    if (subjectPref && Array.isArray(subjectPref.timings)) timings = subjectPref.timings;
    if (activityPref && Array.isArray(activityPref.timings)) timings = activityPref.timings;
    return {
      enabled,
      timings: timings.slice(),
      missedReminder: settings.missedReminder === true,
      completionReminder: settings.completionReminder !== false
    };
  }

  function routineNotification(plan, slot, offset, now) {
    const label = slot.title || activityType(slot.type).label;
    const study = isStudyType(slot.type);
    const timeText = formatClock(slot.start);
    let title;
    let body;
    if (offset > 0) {
      title = 'Up next – ' + label;
      body = label + ' starts in ' + offset + ' minutes at ' + timeText + '.';
    } else if (study) {
      title = 'Time to Study – ' + label;
      body = 'Your scheduled ' + label + ' session starts now. Open Study Register and mark your Entry.';
    } else {
      title = label + ' starts now';
      body = 'Your scheduled ' + label.toLowerCase() + ' starts now at ' + timeText + '.';
    }
    return {
      key: plan.date + ':' + slot.id + ':' + offset,
      kind: offset === 0 ? 'start' : 'upcoming',
      title,
      body,
      slotId: slot.id,
      date: plan.date,
      slotTitle: label,
      slotType: slot.type,
      study,
      subjectId: slot.subjectId || null,
      offsetMinutes: offset,
      fireAt: new Date(slot.startAt - offset * 60000).toISOString(),
      createdAt: (now || new Date()).toISOString()
    };
  }

  function dueNotifications(routineData, sessions, activeSession, now, options) {
    if (!routineData || !routineData.notifications || routineData.notifications.enabled === false) return [];
    const opts = options || {};
    const nowDate = now || new Date();
    const nowMs = nowDate.getTime();
    const graceMs = Number.isFinite(opts.graceMs) ? opts.graceMs : ROUTINE_REMINDER_GRACE_MS;
    const missedGraceMs = Number.isFinite(opts.missedGraceMs) ? opts.missedGraceMs : ROUTINE_MISSED_GRACE_MS;
    const live = liveSessions(sessions, activeSession, nowDate);
    const logged = new Set((routineData.notifyLog || []).map((item) => item.key));
    const out = [];
    const todayPlan = planForDate(routineData, nowDate);
    const planList = [];
    if (todayPlan) planList.push(todayPlan);
    const priorKey = dateKey(addDays(startOfDay(nowDate), -1));
    const priorPlan = routineData.dayPlans ? routineData.dayPlans[priorKey] : null;
    if (priorPlan) planList.push(priorPlan);

    planList.forEach((plan) => {
      if (!plan || plan.holiday) return;
      plan.slots.forEach((slot) => {
        const prefs = notificationPrefsForSlot(routineData, slot);
        if (!prefs.enabled) return;
        const completion = completionFor(routineData, plan.date, slot.id);
        if (completion && completion.status === 'skipped') return;
        const actual = slotActualMs(slot, live);

        prefs.timings.forEach((offset) => {
          const fireAt = slot.startAt - offset * 60000;
          const key = plan.date + ':' + slot.id + ':' + offset;
          const allowed = offset === 0 ? graceMs : Math.min(graceMs, 60000);
          if (nowMs < fireAt || nowMs - fireAt > allowed || logged.has(key)) return;
          if (actual > 0) return;
          if (activeSession) return;
          const notification = routineNotification(plan, slot, offset, nowDate);
          logged.add(notification.key);
          out.push(notification);
        });

        if (prefs.completionReminder && activeSession && activeSession.routineSlotId === slot.id) {
          const key = plan.date + ':' + slot.id + ':end';
          if (nowMs >= slot.endAt && nowMs - slot.endAt <= graceMs && !logged.has(key)) {
            const notification = {
              key,
              kind: 'end',
              title: 'Scheduled time complete – ' + slot.title,
              body: 'Your scheduled ' + slot.title + ' slot has ended. Open Study Register to mark your Exit when you finish.',
              slotId: slot.id,
              date: plan.date,
              slotTitle: slot.title,
              slotType: slot.type,
              study: isStudyType(slot.type),
              subjectId: slot.subjectId || null,
              offsetMinutes: 0,
              fireAt: new Date(slot.endAt).toISOString(),
              createdAt: nowDate.toISOString()
            };
            logged.add(key);
            out.push(notification);
          }
        }
      });
    });

    if (routineData.notifications.missedReminder && todayPlan && !todayPlan.holiday) {
      const candidates = todayPlan.slots
        .filter((slot) => isStudyType(slot.type))
        .filter((slot) => {
          if (slot.endAt > nowMs || nowMs - slot.endAt > missedGraceMs) return false;
          const completion = completionFor(routineData, todayPlan.date, slot.id);
          if (completion && completion.status === 'skipped') return false;
          if (slotActualMs(slot, live) > 0) return false;
          return !logged.has(todayPlan.date + ':' + slot.id + ':missed');
        })
        .sort((a, b) => b.endAt - a.endAt);
      if (candidates.length) {
        const slot = candidates[0];
        out.push({
          key: todayPlan.date + ':' + slot.id + ':missed',
          kind: 'missed',
          title: 'Routine slot missed – ' + slot.title,
          body: 'Your ' + formatClock(slot.start) + ' ' + slot.title + ' slot passed without a recorded session. You can still log what you actually studied.',
          slotId: slot.id,
          date: todayPlan.date,
          slotTitle: slot.title,
          slotType: slot.type,
          study: true,
          subjectId: slot.subjectId || null,
          offsetMinutes: 0,
          fireAt: new Date(slot.endAt).toISOString(),
          createdAt: nowDate.toISOString()
        });
      }
    }

    return out;
  }

  function nextNotificationAt(routineData, now) {
    if (!routineData || !routineData.notifications || routineData.notifications.enabled === false) return null;
    const nowDate = now || new Date();
    if (!isValidDate(nowDate)) return null;
    const nowMs = nowDate.getTime();
    const today = asLocalDate(nowDate);
    const plans = [];
    const todayPlan = planForDate(routineData, today);
    if (todayPlan) plans.push(todayPlan);
    const tomorrow = addDays(today, 1);
    const storedTomorrow = routineData.dayPlans ? routineData.dayPlans[dateKey(tomorrow)] : null;
    plans.push(storedTomorrow || buildDayPlan(routineData, tomorrow, nowDate));
    let next = null;
    plans.forEach((plan) => {
      if (!plan || plan.holiday) return;
      plan.slots.forEach((slot) => {
        const prefs = notificationPrefsForSlot(routineData, slot);
        if (!prefs.enabled) return;
        const completion = completionFor(routineData, plan.date, slot.id);
        if (completion && completion.status === 'skipped') return;
        prefs.timings.forEach((offset) => {
          const fireAt = slot.startAt - offset * 60000;
          if (fireAt > nowMs && (next == null || fireAt < next)) next = fireAt;
        });
        if (slot.endAt > nowMs && (next == null || slot.endAt < next)) next = slot.endAt;
      });
    });
    return next;
  }

  function findDayConflicts(slots) {
    const windows = (Array.isArray(slots) ? slots : [])
      .map((slot) => ({ slot, window: slotWindow(slot) }))
      .filter((item) => item.window)
      .map((item) => ({ id: item.slot.id, title: item.slot.title, start: item.window.start, end: item.window.end }));
    const conflicts = [];
    for (let i = 0; i < windows.length; i += 1) {
      for (let j = i + 1; j < windows.length; j += 1) {
        const a = windows[i];
        const b = windows[j];
        if (a.start < b.end && b.start < a.end) conflicts.push({ a, b });
      }
    }
    return conflicts;
  }

  function findRoutineConflicts(routine) {
    if (!routine) return [];
    const intervals = [];
    WEEKDAY_IDS.forEach((day, index) => {
      ((routine.days && routine.days[day]) || []).forEach((slot) => {
        const window = slotWindow(slot);
        if (!window) return;
        intervals.push({
          id: slot.id,
          title: slot.title,
          day,
          start: index * 1440 + window.start,
          end: index * 1440 + window.end,
          overnight: window.overnight
        });
      });
    });
    const conflicts = [];
    for (let i = 0; i < intervals.length; i += 1) {
      for (let j = i + 1; j < intervals.length; j += 1) {
        const a = intervals[i];
        const b = intervals[j];
        const overlaps = (x, y) => x.start < y.end && y.start < x.end;
        if (overlaps(a, b)) {
          conflicts.push({ a, b });
          continue;
        }
        if (a.end > WEEKDAY_IDS.length * 1440 || b.end > WEEKDAY_IDS.length * 1440) {
          const shifted = a.end > WEEKDAY_IDS.length * 1440
            ? { start: a.start - WEEKDAY_IDS.length * 1440, end: a.end - WEEKDAY_IDS.length * 1440 }
            : { start: b.start - WEEKDAY_IDS.length * 1440, end: b.end - WEEKDAY_IDS.length * 1440 };
          const other = a.end > WEEKDAY_IDS.length * 1440 ? b : a;
          if (overlaps(shifted, other)) conflicts.push({ a, b });
        }
      }
    }
    return conflicts;
  }

  function normalizeSettings(raw, subjects) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const target = Number(source.dailyTargetMinutes);
    const notifications = source.notifications && typeof source.notifications === 'object' ? source.notifications : {};
    const ids = new Set((subjects || []).map((s) => s.id));
    return {
      dailyTargetMinutes: Number.isFinite(target) ? clamp(Math.round(target), 15, 1440) : DEFAULT_TARGET_MINUTES,
      defaultSubjectId: ids.has(source.defaultSubjectId) ? source.defaultSubjectId : (subjects[0] ? subjects[0].id : 'physics'),
      appearance: ['dark', 'light', 'system'].includes(source.appearance) ? source.appearance : 'dark',
      notifications: {
        enabled: notifications.enabled !== false,
        onStart: notifications.onStart !== false,
        onEnd: notifications.onEnd !== false,
        onTarget: notifications.onTarget !== false
      }
    };
  }

  function normalizeSubjects(raw) {
    const list = [];
    const seenIds = new Set();
    const seenNames = new Set();
    (Array.isArray(raw) ? raw : []).forEach((item, index) => {
      if (!item) return;
      const name = sanitizeSubjectName(typeof item === 'string' ? item : item.name);
      if (!name) return;
      const nameKey = name.toLowerCase();
      if (seenNames.has(nameKey)) return;
      let id = typeof item === 'object' && item.id ? String(item.id).slice(0, 64) : 'subject-' + (index + 1) + '-' + Date.now().toString(36);
      if (seenIds.has(id)) id = id + '-' + (index + 1);
      const color = typeof item === 'object' && /^#[0-9a-f]{6}$/i.test(item.color || '')
        ? item.color
        : COLOR_PALETTE[index % COLOR_PALETTE.length];
      seenIds.add(id);
      seenNames.add(nameKey);
      list.push({ id, name, color });
    });
    return list;
  }

  function defaultSubjects() {
    return DEFAULT_SUBJECTS.map((s) => ({ ...s }));
  }

  function defaultData(now) {
    const stamp = (now || new Date()).toISOString();
    const subjects = defaultSubjects();
    return {
      version: 2,
      settings: normalizeSettings({}, subjects),
      subjects,
      sessions: [],
      activeSession: null,
      routine: defaultRoutineData(),
      meta: { createdAt: stamp, updatedAt: stamp }
    };
  }

  function slugId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Normalizes any data read from disk or a backup file. Invalid records are
   * dropped rather than corrupting the register.
   */
  function normalizeData(raw, now) {
    const stamp = (now || new Date()).toISOString();
    const source = raw && typeof raw === 'object' ? raw : {};
    let subjects = normalizeSubjects(source.subjects);
    if (!subjects.length) subjects = defaultSubjects();
    const byId = new Map(subjects.map((s) => [s.id, s]));
    const byName = new Map(subjects.map((s) => [s.name.toLowerCase(), s]));

    const sessions = [];
    const seen = new Set();
    (Array.isArray(source.sessions) ? source.sessions : []).forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const entryDate = new Date(item.entry);
      const exitDate = new Date(item.exit);
      if (!isValidDate(entryDate) || !isValidDate(exitDate) || exitDate.getTime() < entryDate.getTime()) return;
      const named = sanitizeSubjectName(item.subjectName);
      const subject = byId.get(item.subjectId) || (named ? byName.get(named.toLowerCase()) : null);
      const subjectName = subject ? subject.name : (named || 'Other');
      const subjectId = subject ? subject.id : (typeof item.subjectId === 'string' && item.subjectId ? item.subjectId.slice(0, 64) : 'legacy:' + subjectName);
      let id = typeof item.id === 'string' && item.id ? item.id.slice(0, 80) : slugId('session');
      if (seen.has(id)) id = slugId('session');
      seen.add(id);
      sessions.push({
        id,
        subjectId,
        subjectName,
        entry: entryDate.toISOString(),
        exit: exitDate.toISOString(),
        createdAt: isValidDate(new Date(item.createdAt)) ? new Date(item.createdAt).toISOString() : entryDate.toISOString(),
        routineSlotId: item.routineSlotId ? String(item.routineSlotId).slice(0, 80) : null,
        routineDate: dateFromKey(item.routineDate) ? item.routineDate : null,
        routineTitle: item.routineTitle ? sanitizeRoutineText(item.routineTitle, 64) : null
      });
    });
    sessions.sort((a, b) => new Date(a.entry) - new Date(b.entry));

    let activeSession = null;
    if (source.activeSession && typeof source.activeSession === 'object') {
      const entryDate = new Date(source.activeSession.entry);
      if (isValidDate(entryDate) && entryDate.getTime() <= Date.now() + 86400000) {
        const named = sanitizeSubjectName(source.activeSession.subjectName);
        const subject = byId.get(source.activeSession.subjectId) || (named ? byName.get(named.toLowerCase()) : null);
        activeSession = {
          id: typeof source.activeSession.id === 'string' && source.activeSession.id ? source.activeSession.id.slice(0, 80) : slugId('active'),
          subjectId: subject ? subject.id : (typeof source.activeSession.subjectId === 'string' ? source.activeSession.subjectId : subjects[0].id),
          subjectName: subject ? subject.name : (named || subjects[0].name),
          entry: entryDate.toISOString(),
          routineSlotId: source.activeSession.routineSlotId ? String(source.activeSession.routineSlotId).slice(0, 80) : null,
          routineDate: dateFromKey(source.activeSession.routineDate) ? source.activeSession.routineDate : null,
          routineTitle: source.activeSession.routineTitle ? sanitizeRoutineText(source.activeSession.routineTitle, 64) : null
        };
      }
    }

    const meta = source.meta && typeof source.meta === 'object' ? source.meta : {};
    return {
      version: 2,
      settings: normalizeSettings(source.settings, subjects),
      subjects,
      sessions,
      activeSession,
      routine: normalizeRoutineData(source.routine, subjects, now),
      meta: {
        createdAt: isValidDate(new Date(meta.createdAt)) ? new Date(meta.createdAt).toISOString() : stamp,
        updatedAt: isValidDate(new Date(meta.updatedAt)) ? new Date(meta.updatedAt).toISOString() : stamp
      }
    };
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function buildCsv(sessions) {
    const header = ['Date', 'Subject', 'Entry time', 'Exit time', 'Duration (minutes)', 'Duration (h:mm)', 'Entry ISO', 'Exit ISO'];
    const rows = (sessions || [])
      .slice()
      .sort((a, b) => new Date(a.entry) - new Date(b.entry))
      .map((session) => {
        const mins = Math.round(sessionDuration(session) / 60000);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return [
          dateKey(session.entry),
          session.subjectName,
          formatTime(session.entry),
          formatTime(session.exit),
          mins,
          h + ':' + pad2(m),
          session.entry,
          session.exit
        ].map(csvCell).join(',');
      });
    return '\uFEFF' + [header.join(','), ...rows].join('\r\n') + '\r\n';
  }

  return {
    DAY_MS,
    DEFAULT_TARGET_MINUTES,
    COLOR_PALETTE,
    DEFAULT_SUBJECTS,
    pad2,
    clamp,
    dateKey,
    dateFromKey,
    startOfDay,
    addDays,
    startOfWeek,
    startOfMonth,
    startOfNextMonth,
    startOfNextDay,
    sessionDuration,
    overlapMs,
    splitSessionByDay,
    dailyTotals,
    totalForDate,
    statsForDate,
    streakInfo,
    buildRange,
    sessionsInRange,
    rangeStats,
    countDays,
    subjectTotals,
    dailySeries,
    monthlySeries,
    hourlySeries,
    formatDuration,
    formatDurationLong,
    formatTimer,
    formatHoursValue,
    formatTime,
    formatTimeWithSeconds,
    formatDateFull,
    formatDateMedium,
    formatMonthYear,
    formatDayLabel,
    rangeLabel,
    toLocalInputValue,
    fromLocalInputValue,
    relativeTime,
    sanitizeSubjectName,
    normalizeSettings,
    normalizeSubjects,
    normalizeData,
    defaultSubjects,
    defaultData,
    slugId,
    buildCsv,
    colorForName,
    WEEKDAYS,
    WEEKDAY_IDS,
    ACTIVITY_TYPES,
    NOTIFICATION_OFFSETS,
    DEFAULT_NOTIFICATION_TIMINGS,
    sanitizeRoutineText,
    clockMinutes,
    minuteString,
    formatClock,
    formatClockRange,
    weekdayId,
    activityType,
    isStudyType,
    slotWindow,
    normalizeRoutineData,
    defaultRoutineData,
    normalizeRoutineSlot,
    cloneRoutineSlots,
    routineById,
    defaultRoutine,
    buildDayPlan,
    planForDate,
    ensureDayPlan,
    invalidateDayPlans,
    refreshDayPlans,
    routineDaySummary,
    slotSubjectId,
    suggestRoutineSlot,
    linkSessionToRoutine,
    routineAnalytics,
    notificationPrefsForSlot,
    dueNotifications,
    nextNotificationAt,
    findDayConflicts,
    findRoutineConflicts
  };
});
