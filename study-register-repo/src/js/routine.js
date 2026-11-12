/* My Routine window controller: today's schedule, timetable, weekly plan,
   analytics and reminder settings. */
(function () {
  'use strict';

  const core = window.SRCore;
  const ui = window.SRUI;
  const store = window.SRStore;

  const els = {
    headerSub: document.getElementById('routineHeaderSub'),
    permissionPill: document.getElementById('permissionPill'),
    permissionPillText: document.getElementById('permissionPillText'),
    nav: document.querySelector('.routine-nav'),
    todayBadge: document.getElementById('todayNavBadge'),
    notificationsBadge: document.getElementById('notificationsNavBadge'),
    main: document.getElementById('routineMain'),
    version: document.getElementById('routineVersion'),
    registerBtn: document.getElementById('registerBtn'),
    dashboardBtn: document.getElementById('dashboardBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    views: {
      today: document.getElementById('viewToday'),
      timetable: document.getElementById('viewTimetable'),
      weekly: document.getElementById('viewWeekly'),
      analytics: document.getElementById('viewAnalytics'),
      notifications: document.getElementById('viewNotifications')
    }
  };

  const TABS = ['today', 'timetable', 'weekly', 'analytics', 'notifications'];

  const TYPE_ICON = {
    physics: 'target',
    chemistry: 'spark',
    mathematics: 'trend',
    coding: 'grid',
    revision: 'refresh',
    coaching: 'book',
    homework: 'pencil',
    break: 'coffee',
    personal: 'clock',
    sleep: 'hourglass',
    other: 'list'
  };

  const STATUS_LABEL = {
    upcoming: 'Upcoming',
    current: 'Now',
    completed: 'Completed',
    missed: 'Missed',
    skipped: 'Skipped'
  };

  const UNKNOWN_PERMISSION = { supported: true, status: 'unknown', checkedAt: null };

  let activeTab = 'today';
  let editRoutineId = null;
  let editWeekday = core.weekdayId(new Date());
  let analyticsRange = 'week';
  let notifRoutineFilter = null;
  let permissionOverride = null;
  let currentDay = core.dateKey(new Date());

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function esc(value) {
    return ui.escapeHtml(value);
  }

  function state() {
    return store.state;
  }

  function permission() {
    const stored = store.notificationPermission;
    const override = permissionOverride;
    if (!stored) return override || UNKNOWN_PERMISSION;
    if (!override) return stored;
    const a = new Date(stored.checkedAt || 0).getTime();
    const b = new Date(override.checkedAt || 0).getTime();
    return b > a ? override : stored;
  }

  function percent(ratio) {
    if (!Number.isFinite(ratio)) return 0;
    return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  }

  function signedDuration(ms) {
    if (!ms) return '0m';
    return (ms > 0 ? '+' : '−') + core.formatDuration(Math.abs(ms));
  }

  function weekdayLabel(id) {
    const day = core.WEEKDAYS.find((item) => item.id === id);
    return day ? day.label : id;
  }

  function weekdayShort(id) {
    const day = core.WEEKDAYS.find((item) => item.id === id);
    return day ? day.short : id;
  }

  function shortDate(key) {
    const date = core.dateFromKey(key);
    if (!date) return key;
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
  }

  function typeIcon(type) {
    return TYPE_ICON[type] || 'list';
  }

  function typeLabel(type) {
    return core.activityType(type).label;
  }

  function subjectIdForSlot(slot) {
    const s = state();
    return core.slotSubjectId(slot, s ? s.subjects : []);
  }

  function subjectForSlot(slot) {
    const id = subjectIdForSlot(slot);
    const s = state();
    return id && s ? s.subjects.find((item) => item.id === id) || null : null;
  }

  function colorForSlot(slot) {
    const subject = subjectForSlot(slot);
    return subject ? subject.color : core.colorForName(slot.title || typeLabel(slot.type));
  }

  function planStatusTag(status) {
    return STATUS_LABEL[status] || 'Upcoming';
  }

  function describeTimings(list) {
    if (!Array.isArray(list)) return 'Default timings';
    if (!list.length) return 'No reminders';
    const before = list.filter((value) => value > 0).sort((a, b) => a - b);
    const parts = [];
    if (list.includes(0)) parts.push('At start');
    if (before.length) parts.push(before.join(' / ') + ' min before');
    return parts.join(' + ');
  }

  function routineStudyMs(routine, day) {
    if (!routine) return 0;
    return (routine.days[day] || []).reduce((sum, slot) => {
      if (!core.isStudyType(slot.type)) return sum;
      const window = core.slotWindow(slot);
      return sum + (window ? window.duration * 60000 : 0);
    }, 0);
  }

  function routineWeeklyMs(routine) {
    return core.WEEKDAY_IDS.reduce((sum, day) => sum + routineStudyMs(routine, day), 0);
  }

  function routineDaySlots(routine, day) {
    return (routine && routine.days[day]) || [];
  }

  function defaultRoutine() {
    const s = state();
    return s ? core.defaultRoutine(s.routine) : null;
  }

  function earliestStart(s, today) {
    const stamps = [];
    (s.sessions || []).forEach((session) => {
      const day = core.startOfDay(new Date(session.entry));
      if (Number.isFinite(day.getTime())) stamps.push(day.getTime());
    });
    Object.keys(s.routine.dayPlans || {}).forEach((key) => {
      const day = core.dateFromKey(key);
      if (day) stamps.push(day.getTime());
    });
    Object.keys(s.routine.completions || {}).forEach((key) => {
      const day = core.dateFromKey(key);
      if (day) stamps.push(day.getTime());
    });
    const min = stamps.length ? Math.min.apply(null, stamps) : core.addDays(today, -30).getTime();
    return new Date(Math.min(min, today.getTime()));
  }

  function signedClass(ms) {
    if (!ms) return '';
    return ms > 0 ? 'is-up' : 'is-down';
  }

  /* ------------------------------------------------------------------ */
  /* Chrome                                                              */
  /* ------------------------------------------------------------------ */

  function renderChrome(s) {
    const now = new Date();
    const summary = core.routineDaySummary(s.routine, now, s.sessions, s.activeSession, now);
    const perm = permission();
    const status = perm.status || 'unknown';

    els.headerSub.textContent = core.formatDateFull(now);
    els.permissionPill.classList.remove('is-granted', 'is-denied', 'is-unknown');
    els.permissionPill.classList.add('is-' + status);
    els.permissionPillText.textContent = status === 'granted'
      ? 'Notifications allowed'
      : status === 'denied'
        ? 'Notifications blocked'
        : 'Notifications';

    let badge = '';
    if (summary) {
      if (summary.current) badge = 'Now';
      else if (summary.missedCount) badge = String(summary.missedCount);
    }
    els.todayBadge.textContent = badge;
    els.todayBadge.classList.toggle('hidden', !badge);
    els.notificationsBadge.classList.toggle('hidden', status !== 'denied');
  }

  function render(s, meta) {
    if (!s) return;
    if (meta && meta.version) els.version.textContent = 'Study Register ' + meta.version;
    renderChrome(s);
    renderView(currentDay === core.dateKey(new Date()) ? s : s);
  }

  function updateTabButtons() {
    els.nav.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-tab') === activeTab);
    });
    TABS.forEach((tab) => {
      els.views[tab].classList.toggle('hidden', tab !== activeTab);
    });
  }

  function setTab(tab) {
    const next = TABS.includes(tab) ? tab : 'today';
    if (next === activeTab) {
      if (state()) render(state(), store.meta);
      return;
    }
    activeTab = next;
    updateTabButtons();
    els.main.scrollTop = 0;
    if (state()) render(state(), store.meta);
  }

  function renderView(s) {
    if (!s) return;
    const scroll = els.main.scrollTop;
    if (activeTab === 'today') renderToday(s);
    else if (activeTab === 'timetable') renderTimetable(s);
    else if (activeTab === 'weekly') renderWeekly(s);
    else if (activeTab === 'analytics') renderAnalytics(s);
    else renderNotifications(s);
    els.main.scrollTop = scroll;
  }

  /* ------------------------------------------------------------------ */
  /* Today                                                               */
  /* ------------------------------------------------------------------ */

  function renderToday(s) {
    const now = new Date();
    const summary = core.routineDaySummary(s.routine, now, s.sessions, s.activeSession, now);
    if (!summary) {
      els.views.today.innerHTML = '';
      return;
    }
    const plan = summary.plan || { slots: [], source: 'none', holiday: false, label: '', date: summary.date, weekday: summary.plan ? summary.plan.weekday : core.weekdayId(now) };
    const activeSession = s.activeSession;
    const current = summary.current;
    const next = summary.next;
    const exception = (s.routine.exceptions || []).find((item) => item.date === summary.date) || null;
    const isLive = Boolean(activeSession);

    let eyebrow = 'Today';
    let title = 'No activities scheduled';
    let meta = '<span>Your day is open.</span>';
    const actions = [];

    if (plan.holiday) {
      eyebrow = 'Holiday';
      title = plan.label || 'Holiday';
      meta = '<span>No routine activities are scheduled for this date.</span>';
      actions.push(
        '<button class="btn ghost hero-action" type="button" data-action="edit-exception" data-date="' + esc(summary.date) + '">' + ui.icon('pencil') + 'Edit change</button>'
      );
      if (exception) {
        actions.push(
          '<button class="btn ghost hero-action" type="button" data-action="delete-exception" data-date="' + esc(summary.date) + '" data-label="' + esc(plan.label) + '">' + ui.icon('refresh') + 'Restore routine</button>'
        );
      }
    } else if (activeSession) {
      eyebrow = 'In session';
      title = activeSession.routineTitle || activeSession.subjectName;
      const started = new Date(activeSession.entry);
      meta = '<span class="mono">' + esc(core.formatTime(started)) + '</span><span>·</span><span>' +
        esc(core.formatDuration(now.getTime() - started.getTime())) + ' elapsed</span>';
      if (current) {
        meta += '<span>·</span><span>scheduled until ' + esc(core.formatClock(current.end)) + '</span>';
      }
      actions.push(
        '<button class="btn danger hero-action" type="button" data-action="exit-session">' + ui.icon('stop') + 'Mark exit</button>'
      );
    } else if (current) {
      eyebrow = 'Now';
      title = current.title;
      meta = '<span class="mono">' + esc(core.formatClockRange(current.start, current.end)) + '</span>' +
        '<span>·</span><span class="today-countdown">' + esc(core.formatDuration(Math.max(0, current.endAt - now.getTime()))) + ' left</span>';
      if (core.isStudyType(current.type)) {
        actions.push(startButton(current, current.planDate || summary.date, 'Start session', 'primary'));
      }
      actions.push('<button class="btn ghost hero-action" type="button" data-action="add-exception" data-date="' + esc(summary.date) + '">' + ui.icon('calendar') + 'Temporary change</button>');
    } else if (next) {
      eyebrow = 'Up next';
      title = next.title;
      meta = '<span class="mono">' + esc(core.formatClockRange(next.start, next.end)) + '</span>' +
        '<span>·</span><span class="today-countdown">starts in ' + esc(core.formatDuration(Math.max(0, next.startAt - now.getTime()))) + '</span>';
      if (core.isStudyType(next.type)) {
        actions.push(startButton(next, next.planDate || summary.date, 'Start early'));
      }
      actions.push('<button class="btn ghost hero-action" type="button" data-action="add-exception" data-date="' + esc(summary.date) + '">' + ui.icon('calendar') + 'Temporary change</button>');
    } else if (plan.slots.length) {
      eyebrow = 'Day complete';
      title = 'All scheduled activities have ended';
      meta = '<span>' + summary.completedCount + ' completed · ' + summary.missedCount + ' missed · ' + summary.skippedCount + ' skipped</span>';
      actions.push('<button class="btn ghost hero-action" type="button" data-action="add-exception" data-date="' + esc(summary.date) + '">' + ui.icon('calendar') + 'Temporary change</button>');
    } else {
      eyebrow = plan.source === 'none' ? 'Unassigned' : 'Free day';
      title = plan.source === 'none' ? 'No routine for this day' : 'Your day is open';
      meta = '<span>Build the timetable to plan this day.</span>';
      actions.push('<button class="btn primary hero-action" type="button" data-action="build-timetable" data-weekday="' + esc(plan.weekday) + '">' + ui.icon('plus') + 'Build timetable</button>');
    }

    const upcomingStudyCount = summary.slots.filter((slot) => (
      core.isStudyType(slot.type) && slot.status !== 'skipped' && slot.endAt > now.getTime()
    )).length;

    const sourceBadge = plan.holiday
      ? '<span class="source-badge is-warning">' + ui.icon('calendar') + 'Holiday · ' + esc(plan.label) + '</span>'
      : plan.source === 'custom'
        ? '<span class="source-badge">' + ui.icon('calendar') + 'Custom day · ' + esc(plan.label) + '</span>'
        : plan.source === 'routine'
          ? '<span class="source-badge is-muted">' + ui.icon('repeat') + esc(plan.routineName || plan.label) + '</span>'
          : '<span class="source-badge is-muted">' + ui.icon('info') + 'No routine assigned</span>';

    const todayKey = core.dateKey(now);
    const upcomingExceptions = (s.routine.exceptions || [])
      .filter((item) => item.date >= todayKey)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);

    els.views.today.innerHTML =
      '<section class="today-hero routine-card' + (isLive ? ' is-live' : '') + '">' +
        '<div class="today-hero-top">' +
          '<div class="day-badge-row">' +
            sourceBadge +
            (isLive ? '<span class="source-badge is-live">' + ui.icon('play') + 'Session running</span>' : '') +
            (summary.holiday ? '' : '<span class="source-badge is-muted">' + ui.icon('clock') + summary.slots.length + ' activities</span>') +
          '</div>' +
        '</div>' +
        '<div class="today-hero-body">' +
          '<div class="today-now">' +
            '<span class="today-eyebrow">' + esc(eyebrow) + '</span>' +
            '<h2>' + esc(title) + '</h2>' +
            '<div class="today-now-meta">' + meta + '</div>' +
          '</div>' +
          '<div class="today-hero-actions">' + actions.join('') + '</div>' +
        '</div>' +
      '</section>' +

      '<div class="today-strip">' +
        '<article class="today-stat"><span class="label">' + ui.icon('clock') + 'Planned study</span>' +
          '<strong>' + esc(core.formatDuration(summary.plannedStudyMs)) + '</strong>' +
          '<span class="note">' + summary.studySlotCount + (summary.studySlotCount === 1 ? ' study slot' : ' study slots') + '</span></article>' +
        '<article class="today-stat"><span class="label">' + ui.icon('chart') + 'Actual study</span>' +
          '<strong>' + esc(core.formatDuration(summary.actualStudyMs)) + '</strong>' +
          '<span class="note ' + (summary.plannedStudyMs ? signedClass(summary.differenceMs) : '') + '">' +
            (summary.plannedStudyMs ? esc(signedDuration(summary.differenceMs)) + ' vs planned' : 'No study planned') + '</span></article>' +
        '<article class="today-stat"><span class="label">' + ui.icon('hourglass') + 'Remaining</span>' +
          '<strong>' + esc(core.formatDuration(summary.remainingStudyMs)) + '</strong>' +
          '<span class="note">' + upcomingStudyCount + ' upcoming study slot' + (upcomingStudyCount === 1 ? '' : 's') + '</span></article>' +
        '<article class="today-stat"><span class="label">' + ui.icon('check') + 'Completed</span>' +
          '<strong>' + summary.completedCount + '<small>/ ' + summary.endedCount + '</small></strong>' +
          '<span class="note">' + summary.missedCount + ' missed · ' + summary.skippedCount + ' skipped</span></article>' +
      '</div>' +

      '<div class="section-label"><h3>Today\u2019s timeline</h3>' +
        '<div class="side">' + esc(plan.label || '') + (summary.plannedStudyMs ? ' · ' + esc(core.formatDuration(summary.plannedStudyMs)) + ' planned' : '') + '</div></div>' +
      '<section class="timeline-panel routine-card">' +
        '<div class="timeline-panel-head">' +
          '<div><h3>' + esc(weekdayLabel(plan.weekday || core.weekdayId(now))) + '</h3>' +
          '<p>' + (summary.slots.length ? 'Planned and actual study time' : 'Nothing scheduled') + '</p></div>' +
          (plan.holiday ? '' : '<span class="source-badge is-muted">' + ui.icon('layers') + summary.slots.length + ' slots</span>') +
        '</div>' +
        (summary.slots.length
          ? '<div class="timeline">' + summary.slots.map((slot) => timelineRow(slot, s)).join('') + '</div>'
          : emptyToday(plan)) +
      '</section>' +

      '<div class="section-label"><h3>Temporary changes</h3>' +
        '<div class="side">' +
          '<span>Holidays and exam days never overwrite the routine</span>' +
          '<button class="btn small ghost" type="button" data-action="add-exception" data-date="' + esc(todayKey) + '">' + ui.icon('plus') + 'Add</button>' +
        '</div></div>' +
      '<section class="routine-card" style="padding:12px 14px">' +
        (upcomingExceptions.length
          ? '<div class="exception-list">' + upcomingExceptions.map(exceptionRow).join('') + '</div>'
          : '<div class="exception-empty">No temporary changes. Your permanent routine applies every week.</div>') +
      '</section>';
  }

  function emptyToday(plan) {
    if (plan.holiday) {
      return '<div class="empty-state">' +
        '<div class="empty-icon">' + ui.icon('calendar') + '</div>' +
        '<strong>' + esc(plan.label || 'Holiday') + '</strong>' +
        '<p>Today is marked as a holiday. Your permanent routine is untouched and returns tomorrow.</p>' +
        '</div>';
    }
    return '<div class="empty-state">' +
      '<div class="empty-icon">' + ui.icon('list') + '</div>' +
      '<strong>No activities for ' + esc(weekdayLabel(plan.weekday || core.weekdayId(new Date()))) + '</strong>' +
      '<p>Add activities to your routine once, and they repeat every week at the same times.</p>' +
      '<button class="btn small primary" type="button" data-action="build-timetable" data-weekday="' + esc(plan.weekday || core.weekdayId(new Date())) + '">' + ui.icon('plus') + 'Build timetable</button>' +
      '</div>';
  }

  function startButton(slot, date, label, className) {
    const s = state();
    const subjectId = subjectIdForSlot(slot) || (s ? s.settings.defaultSubjectId : '');
    return '<button class="btn ' + (className || '') + ' hero-action" type="button" data-action="start-slot" data-slot-id="' + esc(slot.id) + '" data-date="' + esc(date) + '" data-subject-id="' + esc(subjectId) + '">' +
      ui.icon('play') + esc(label) + '</button>';
  }

  function timelineRow(slot, s) {
    const status = slot.status;
    const subject = subjectForSlot(slot);
    const typeText = typeLabel(slot.type);
    const showType = !subject || subject.name.trim().toLowerCase() !== typeText.toLowerCase();
    const color = colorForSlot(slot);
    const activeSession = s.activeSession;
    const isActiveSlot = Boolean(activeSession && activeSession.routineSlotId === slot.id && activeSession.routineDate === slot.planDate);
    const completion = slot.completion;
    const planDate = slot.planDate || core.dateKey(new Date());
    const study = core.isStudyType(slot.type);

    const canStart = study && !completion && !isActiveSlot && !activeSession &&
      (status === 'current' || status === 'upcoming' || status === 'missed');
    const canFinish = !completion && !isActiveSlot && status !== 'upcoming' && status !== 'completed';
    const canSkip = !completion && !isActiveSlot && status !== 'completed' && status !== 'skipped';

    const actions = [];
    if (isActiveSlot) {
      actions.push('<button class="btn small danger" type="button" data-action="exit-session">' + ui.icon('stop') + 'Exit</button>');
    } else if (canStart) {
      const subjectId = subjectIdForSlot(slot) || s.settings.defaultSubjectId;
      actions.push('<button class="btn small' + (status === 'current' ? ' primary' : '') + '" type="button" data-action="start-slot" data-slot-id="' + esc(slot.id) + '" data-date="' + esc(planDate) + '" data-subject-id="' + esc(subjectId) + '">' + ui.icon('play') + 'Start</button>');
    }
    if (canFinish) {
      actions.push('<button class="mini-icon-btn" type="button" title="Mark completed" aria-label="Mark completed" data-action="complete-slot" data-date="' + esc(planDate) + '" data-slot-id="' + esc(slot.id) + '">' + ui.icon('check') + '</button>');
    }
    if (canSkip) {
      actions.push('<button class="mini-icon-btn" type="button" title="Skip this activity" aria-label="Skip this activity" data-action="skip-slot" data-date="' + esc(planDate) + '" data-slot-id="' + esc(slot.id) + '">' + ui.icon('skip') + '</button>');
    }
    if (completion) {
      actions.push('<button class="mini-icon-btn" type="button" title="Undo ' + (completion.status === 'skipped' ? 'skip' : 'completion') + '" aria-label="Undo status" data-action="clear-slot" data-date="' + esc(planDate) + '" data-slot-id="' + esc(slot.id) + '">' + ui.icon('refresh') + '</button>');
    }
    if (!slot.carryOver && status !== 'current') {
      actions.push('<button class="mini-icon-btn" type="button" title="Edit activity" aria-label="Edit activity" data-action="edit-slot" data-date="' + esc(planDate) + '" data-slot-id="' + esc(slot.id) + '">' + ui.icon('pencil') + '</button>');
    }

    const planned = 'Planned <strong>' + esc(core.formatDuration(slot.durationMinutes * 60000)) + '</strong>';
    const recorded = slot.actualMs > 0 && slot.actualMs < 60000 ? '&lt;1m' : core.formatDuration(slot.actualMs);
    let compare;
    if (status === 'upcoming') {
      compare = planned;
    } else if (status === 'skipped') {
      compare = planned + ' · Skipped';
    } else if (status === 'current') {
      compare = planned + (slot.actualMs
        ? ' · Recorded <strong>' + recorded + '</strong>'
        : ' · Not started yet');
    } else if (!slot.actualMs) {
      compare = planned + ' · Not recorded';
    } else {
      const diff = slot.differenceMs || 0;
      const diffMarkup = diff === 0
        ? ' · <span class="diff-flat">on plan</span>'
        : ' · <span class="' + (diff > 0 ? 'diff-up' : 'diff-down') + '">' + esc(signedDuration(diff)) + '</span>';
      compare = planned + ' · Actual <strong>' + recorded + '</strong>' + diffMarkup;
    }

    return '<div class="timeline-row is-' + esc(status) + '">' +
      '<div class="timeline-time">' + esc(core.formatClock(slot.start)) +
        '<span class="end">' + esc(core.formatClock(slot.end)) + '</span>' +
        (slot.overnight ? '<span class="overnight-tag">Overnight</span>' : '') + '</div>' +
      '<div class="timeline-rail"><span class="timeline-dot"></span></div>' +
      '<div class="slot-card" style="--slot:' + esc(color) + '">' +
        '<span class="slot-type">' + ui.icon(typeIcon(slot.type)) + '</span>' +
        '<div class="slot-body">' +
          '<div class="slot-head">' +
            '<span class="slot-title">' + esc(slot.title) + '</span>' +
            (slot.carryOver ? '<span class="slot-tag">From yesterday</span>' : '') +
          '</div>' +
          '<div class="slot-meta">' +
            (subject ? '<span class="dot"></span><span class="subject-name">' + esc(subject.name) + '</span>' : '') +
            (showType ? (subject ? '<span>·</span>' : '') + '<span>' + esc(typeText) + '</span>' : '') +
            (slot.notes ? '<span>·</span><span class="notes">' + esc(slot.notes) + '</span>' : '') +
          '</div>' +
          '<div class="slot-compare">' + compare + '</div>' +
        '</div>' +
        '<span class="slot-status is-' + esc(status) + '">' + esc(planStatusTag(status)) + '</span>' +
        '<div class="slot-actions">' + actions.join('') + '</div>' +
      '</div>' +
      '</div>';
  }

  function exceptionRow(exception) {
    const custom = exception.kind === 'custom';
    return '<div class="exception-row">' +
      '<span class="exception-icon' + (custom ? ' is-custom' : '') + '">' + ui.icon(custom ? 'list' : 'calendar') + '</span>' +
      '<div class="exception-body">' +
        '<strong>' + esc(exception.label) + '</strong>' +
        '<span>' + esc(core.formatDateMedium(exception.date)) + ' · ' +
          (custom ? (exception.slots || []).length + ' activities' : 'No activities') + '</span>' +
      '</div>' +
      '<div class="row-actions">' +
        '<button class="mini-icon-btn" type="button" title="Edit temporary change" aria-label="Edit temporary change" data-action="edit-exception" data-date="' + esc(exception.date) + '">' + ui.icon('pencil') + '</button>' +
        '<button class="mini-icon-btn danger" type="button" title="Remove temporary change" aria-label="Remove temporary change" data-action="delete-exception" data-date="' + esc(exception.date) + '" data-label="' + esc(exception.label) + '">' + ui.icon('trash') + '</button>' +
      '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Timetable                                                           */
  /* ------------------------------------------------------------------ */

  function renderTimetable(s) {
    const routines = s.routine.routines;
    let routine = core.routineById(s.routine, editRoutineId) || core.defaultRoutine(s.routine) || routines[0];
    if (!routine) {
      els.views.timetable.innerHTML = '';
      return;
    }
    editRoutineId = routine.id;
    const day = core.WEEKDAY_IDS.includes(editWeekday) ? editWeekday : core.weekdayId(new Date());
    const slots = routineDaySlots(routine, day);
    const conflicts = core.findRoutineConflicts(routine);
    const todayId = core.weekdayId(new Date());
    const planned = routineStudyMs(routine, day);

    const routineOptions = routines.map((item) => (
      '<option value="' + esc(item.id) + '"' + (item.id === routine.id ? ' selected' : '') + '>' + esc(item.name) + (item.isDefault ? ' · default' : '') + '</option>'
    )).join('');

    const tabs = core.WEEKDAYS.map((item) => (
      '<button class="day-tab' + (item.id === day ? ' is-active' : '') + '" type="button" data-action="day-tab" data-day="' + item.id + '">' +
        item.short + '<span class="tab-count">' + routineDaySlots(routine, item.id).length + '</span></button>'
    )).join('');

    const conflictBanner = conflicts.length
      ? '<div class="conflict-banner">' + ui.icon('alert') +
        '<div><strong>' + conflicts.length + (conflicts.length === 1 ? ' overlapping pair' : ' overlapping pairs') + ' in this routine</strong>' +
        '<ul>' + conflicts.slice(0, 3).map((pair) => (
          '<li>' + esc(pair.a.title) + ' (' + esc(weekdayShort(pair.a.day)) + ') and ' + esc(pair.b.title) +
          ' (' + esc(weekdayShort(pair.b.day)) + ') share time.</li>'
        )).join('') + '</ul></div></div>'
      : '';

    const rows = slots.length
      ? '<div class="slot-editor-list">' + slots.map((slot, index) => editorRow(slot, index, slots.length, day, todayId)).join('') + '</div>'
      : '<div class="empty-state">' +
          '<div class="empty-icon">' + ui.icon('list') + '</div>' +
          '<strong>No activities on ' + esc(weekdayLabel(day)) + '</strong>' +
          '<p>Add study blocks, breaks and sleep. Times repeat weekly until you change them.</p>' +
          '<button class="btn small primary" type="button" data-action="add-slot" data-day="' + day + '">' + ui.icon('plus') + 'Add activity</button>' +
        '</div>';

    els.views.timetable.innerHTML =
      '<div class="view-head"><div><h2>Timetable</h2><p>Each weekday has its own schedule. Changes never alter recorded sessions.</p></div>' +
        '<div class="view-actions">' +
          '<button class="btn small" type="button" data-action="new-routine">' + ui.icon('plus') + 'New routine</button>' +
          '<button class="btn small primary" type="button" data-action="add-slot" data-day="' + day + '">' + ui.icon('plus') + 'Add activity</button>' +
        '</div></div>' +
      '<div class="routine-card timetable-bar">' +
        '<select class="select routine-select" data-action="select-routine" aria-label="Routine to edit">' + routineOptions + '</select>' +
        (routine.isDefault ? '<span class="source-badge is-muted">' + ui.icon('check') + 'Default</span>' : '') +
        '<span class="bar-meta">' + esc(core.formatDuration(routineWeeklyMs(routine))) + ' study per week</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn small ghost" type="button" data-action="rename-routine">' + ui.icon('pencil') + 'Rename</button>' +
        (routine.isDefault ? '' : '<button class="btn small ghost" type="button" data-action="set-default-routine">' + ui.icon('check') + 'Make default</button>') +
        (routines.length > 1 ? '<button class="btn small danger" type="button" data-action="delete-routine">' + ui.icon('trash') + 'Delete</button>' : '') +
      '</div>' +
      conflictBanner +
      '<div class="day-tabs" role="tablist" aria-label="Weekday">' + tabs + '</div>' +
      '<div class="day-summary">' +
        '<div><h3>' + esc(weekdayLabel(day)) + '</h3><p>' + slots.length + (slots.length === 1 ? ' activity' : ' activities') + ' · ' + esc(core.formatDuration(planned)) + ' of study planned</p></div>' +
        '<div class="side">' +
          (slots.length ? '<button class="btn small ghost" type="button" data-action="clear-day" data-day="' + day + '">' + ui.icon('trash') + 'Clear</button>' : '') +
          (slots.length ? '<button class="btn small ghost" type="button" data-action="copy-day" data-day="' + day + '">' + ui.icon('copy') + 'Use as template</button>' : '') +
        '</div>' +
      '</div>' +
      rows;
  }

  function editorRow(slot, index, total, day, todayId) {
    const subject = subjectForSlot(slot);
    const color = colorForSlot(slot);
    const window = core.slotWindow(slot);
    const duration = window ? window.duration * 60000 : 0;
    const isToday = day === todayId;
    const typeText = typeLabel(slot.type);
    const showType = !subject || subject.name.trim().toLowerCase() !== typeText.toLowerCase();
    return '<div class="editor-row' + (isToday ? ' is-current' : '') + '">' +
      '<div class="editor-time">' + esc(core.formatClock(slot.start)) +
        '<div class="end">' + esc(core.formatClock(slot.end)) + (window && window.overnight ? ' · next day' : '') + '</div></div>' +
      '<span class="slot-type" style="--slot:' + esc(color) + '">' + ui.icon(typeIcon(slot.type)) + '</span>' +
      '<div class="editor-main"><strong>' + esc(slot.title) + '</strong>' +
        '<span>' + [showType ? esc(typeText) : '', subject ? esc(subject.name) : '', slot.notes ? esc(slot.notes) : ''].filter(Boolean).join(' · ') + '</span></div>' +
      '<span class="editor-duration-text">' + esc(core.formatDuration(duration)) + '</span>' +
      '<div class="editor-actions">' +
        '<button class="mini-icon-btn" type="button" title="Move earlier" aria-label="Move earlier" data-action="move-slot" data-dir="-1" data-index="' + index + '" data-day="' + day + '"' + (index === 0 ? ' disabled' : '') + '>' + ui.icon('chevronUp') + '</button>' +
        '<button class="mini-icon-btn" type="button" title="Move later" aria-label="Move later" data-action="move-slot" data-dir="1" data-index="' + index + '" data-day="' + day + '"' + (index === total - 1 ? ' disabled' : '') + '>' + ui.icon('chevronDown') + '</button>' +
        '<button class="mini-icon-btn" type="button" title="Edit activity" aria-label="Edit activity" data-action="edit-slot-row" data-slot-id="' + esc(slot.id) + '" data-day="' + day + '">' + ui.icon('pencil') + '</button>' +
        '<button class="mini-icon-btn danger" type="button" title="Delete activity" aria-label="Delete activity" data-action="delete-slot" data-slot-id="' + esc(slot.id) + '" data-day="' + day + '">' + ui.icon('trash') + '</button>' +
      '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Weekly                                                              */
  /* ------------------------------------------------------------------ */

  function renderWeekly(s) {
    const routineData = s.routine;
    const routines = routineData.routines;
    const fallback = core.defaultRoutine(routineData) || routines[0];
    const todayId = core.weekdayId(new Date());
    let totalMs = 0;
    const days = core.WEEKDAY_IDS.map((day) => {
      const assignedId = routineData.schedule[day];
      const routine = core.routineById(routineData, assignedId) || fallback;
      const slots = routineDaySlots(routine, day);
      const studySlots = slots.filter((slot) => core.isStudyType(slot.type));
      const studyMs = routineStudyMs(routine, day);
      totalMs += studyMs;
      return { day, routine, slots, studySlots, studyMs, assigned: Boolean(assignedId) };
    });
    const maxMs = Math.max(1, ...days.map((item) => item.studyMs));

    const bars = days.map((item) => {
      const height = item.studyMs ? Math.max(4, Math.round((item.studyMs / maxMs) * 100)) : 3;
      return '<div class="week-bar-col' + (item.studyMs ? '' : ' is-empty') + (item.day === todayId ? ' is-today' : '') + '">' +
        '<span class="bar-value">' + (item.studyMs ? esc(core.formatDuration(item.studyMs)) : '—') + '</span>' +
        '<div class="week-bar-track"><div class="week-bar-fill" style="height:' + height + '%"></div></div>' +
        '<span class="bar-day">' + esc(weekdayShort(item.day)) + '</span></div>';
    }).join('');

    const rows = days.map((item) => {
      const options = ['<option value="">Default · ' + esc(fallback ? fallback.name : 'My Routine') + '</option>']
        .concat(routines.map((routine) => (
          '<option value="' + esc(routine.id) + '"' + (routineData.schedule[item.day] === routine.id ? ' selected' : '') + '>' +
            esc(routine.name) + (routine.isDefault ? ' · default' : '') + '</option>'
        ))).join('');
      return '<div class="week-row' + (item.day === todayId ? ' is-today' : '') + '">' +
        '<div class="week-day"><strong>' + esc(weekdayLabel(item.day)) + '</strong>' +
          (item.assigned ? '<span>Custom assignment</span>' : '') + '</div>' +
        '<select class="select" data-action="assign-day" data-day="' + item.day + '" aria-label="Routine for ' + esc(weekdayLabel(item.day)) + '">' + options + '</select>' +
        '<div class="week-stat is-slots"><strong>' + item.studySlots.length + '</strong>study slots</div>' +
        '<div class="week-stat"><strong>' + esc(core.formatDuration(item.studyMs)) + '</strong>planned</div>' +
        '<div class="row-actions">' +
          (item.slots.length ? '<button class="mini-icon-btn" type="button" title="Use ' + esc(weekdayLabel(item.day)) + ' as a template" aria-label="Copy this day to other weekdays" data-action="copy-day" data-day="' + item.day + '" data-routine-id="' + esc(item.routine ? item.routine.id : '') + '">' + ui.icon('copy') + '</button>' : '') +
          '<button class="mini-icon-btn" type="button" title="Edit ' + esc(weekdayLabel(item.day)) + '" aria-label="Edit this day" data-action="edit-day" data-day="' + item.day + '" data-routine-id="' + esc(item.routine ? item.routine.id : '') + '">' + ui.icon('pencil') + '</button>' +
        '</div>' +
        '</div>';
    }).join('');

    const cards = routines.map((routine) => {
      const weekly = routineWeeklyMs(routine);
      const activeDays = core.WEEKDAY_IDS.filter((day) => (
        routineData.schedule[day] === routine.id || (!routineData.schedule[day] && routine.isDefault)
      )).length;
      return '<div class="routine-card-item' + (routine.isDefault ? ' is-default' : '') + '">' +
        '<div class="routine-card-top"><strong>' + esc(routine.name) + '</strong>' +
          (routine.isDefault ? '<span class="badge">Default</span>' : '') + '</div>' +
        '<div class="routine-card-stats">' +
          '<span><strong>' + esc(core.formatDuration(weekly)) + '</strong> per week</span>' +
          '<span><strong>' + activeDays + '</strong> day' + (activeDays === 1 ? '' : 's') + ' assigned</span>' +
        '</div>' +
        '<div class="routine-card-actions">' +
          '<button class="btn small" type="button" data-action="edit-routine" data-routine-id="' + esc(routine.id) + '">' + ui.icon('pencil') + 'Edit</button>' +
          (routine.isDefault ? '' : '<button class="btn small ghost" type="button" data-action="set-default-routine" data-routine-id="' + esc(routine.id) + '">' + ui.icon('check') + 'Make default</button>') +
          (routines.length > 1 ? '<button class="btn small ghost" type="button" data-action="delete-routine" data-routine-id="' + esc(routine.id) + '">' + ui.icon('trash') + 'Delete</button>' : '') +
        '</div>' +
        '</div>';
    }).join('');

    els.views.weekly.innerHTML =
      '<div class="view-head"><div><h2>Weekly Routine</h2><p>Assign routines to weekdays. Unassigned days follow the default.</p></div>' +
        '<div class="view-actions"><button class="btn small" type="button" data-action="new-routine">' + ui.icon('plus') + 'New routine</button></div></div>' +
      '<section class="week-overview routine-card">' +
        '<div class="week-overview-head">' +
          '<div><h3>Planned study by day</h3></div>' +
          '<div class="week-overview-total"><strong>' + esc(core.formatDuration(totalMs)) + '</strong><span>planned per week</span></div>' +
        '</div>' +
        '<div class="week-bars">' + bars + '</div>' +
      '</section>' +
      '<div class="week-list">' + rows + '</div>' +
      '<div class="section-label"><h3>Routines</h3><div class="side">' + routines.length + ' saved</div></div>' +
      '<div class="routine-cards">' + cards + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Analytics                                                           */
  /* ------------------------------------------------------------------ */

  function renderAnalytics(s) {
    const now = new Date();
    const today = core.startOfDay(now);
    let start;
    let end;
    let label;
    if (analyticsRange === 'month') {
      const range = core.buildRange('month', s.sessions, now);
      start = range.start;
      end = core.addDays(range.end, -1);
      label = core.rangeLabel('month', range, now);
    } else if (analyticsRange === 'all') {
      start = earliestStart(s, today);
      end = today;
      label = 'Everything recorded';
    } else {
      const range = core.buildRange('week', s.sessions, now);
      start = range.start;
      end = core.addDays(range.end, -1);
      label = core.rangeLabel('week', range, now);
    }
    const analytics = core.routineAnalytics(s.routine, s.sessions, start, end, now, s.subjects);
    const maxSubjectMs = Math.max(1, ...analytics.bySubject.map((item) => Math.max(item.plannedMs, item.actualMs)));
    const elapsed = analytics.elapsedDays || 1;

    const compare = analytics.bySubject.length
      ? analytics.bySubject.map((item) => (
          '<div class="compare-row" style="--subject:' + esc(item.color) + '">' +
            '<div class="compare-head">' +
              '<span class="name-row"><span class="dot"></span>' + esc(item.name) + '</span>' +
              '<span class="numbers">Planned <strong>' + esc(core.formatDuration(item.plannedMs)) + '</strong> · Actual <strong>' + esc(core.formatDuration(item.actualMs)) + '</strong></span>' +
            '</div>' +
            '<div class="compare-bars">' +
              '<div class="compare-bar planned"><i style="width:' + percent(item.plannedMs / maxSubjectMs) + '%"></i></div>' +
              '<div class="compare-bar actual"><i style="width:' + percent(item.actualMs / maxSubjectMs) + '%"></i></div>' +
            '</div>' +
          '</div>'
        )).join('')
      : '<div class="analytics-empty">No planned study in this range yet. Build your timetable to compare planned and actual time.</div>';

    const consistent = analytics.consistency.length
      ? analytics.consistency.slice(0, 8).map((item, index) => (
          '<div class="consistency-row">' +
            '<span class="consistency-rank">' + (index + 1) + '</span>' +
            '<div class="consistency-body"><strong>' + esc(item.title) + '</strong>' +
              '<span>' + esc(weekdayShort(item.weekday)) + ' · ' + esc(core.formatClockRange(item.start, item.end)) + ' · ' + item.completed + '/' + item.ended + ' done</span></div>' +
            '<span class="consistency-pct' + (item.completionPct < 0.6 ? ' is-low' : '') + '">' + percent(item.completionPct) + '%</span>' +
          '</div>'
        )).join('')
      : '<div class="analytics-empty">No completed or missed slots yet. Consistency appears once planned activities end.</div>';

    const missed = analytics.missedSessions.length
      ? '<div class="missed-list">' + analytics.missedSessions.slice(0, 10).map((item) => (
          '<div class="missed-row">' +
            '<span class="missed-date">' + esc(shortDate(item.date)) + '</span>' +
            '<div class="missed-body"><strong>' + esc(item.title) + '</strong><span>' + esc(item.subjectName) + ' · ' + esc(weekdayShort(core.weekdayId(item.date))) + '</span></div>' +
            '<span class="missed-time">' + esc(core.formatClock(item.start)) + '</span>' +
          '</div>'
        )).join('') + '</div>'
      : '<div class="analytics-empty">No missed study slots in this range.</div>';

    const ranges = [
      { id: 'week', label: 'This week' },
      { id: 'month', label: 'This month' },
      { id: 'all', label: 'All time' }
    ];

    els.views.analytics.innerHTML =
      '<div class="view-head"><div><h2>Routine Analytics</h2><p>Planned versus actual time · ' + esc(label) + '</p></div>' +
        '<div class="view-actions"><div class="segmented" role="tablist" aria-label="Analytics range">' +
          ranges.map((range) => '<button type="button" data-action="set-range" data-range="' + range.id + '" class="' + (analyticsRange === range.id ? 'is-active' : '') + '">' + range.label + '</button>').join('') +
        '</div></div></div>' +
      '<div class="analytics-kpis">' +
        '<article class="analytics-kpi routine-card"><span class="kpi-symbol">' + ui.icon('calendar') + '</span>' +
          '<div class="kpi-copy"><span class="kpi-label">Planned study</span><strong>' + esc(core.formatDuration(analytics.plannedMs)) + '</strong>' +
          '<span class="kpi-note">' + analytics.dayCount + ' day' + (analytics.dayCount === 1 ? '' : 's') + ' in range</span></div></article>' +
        '<article class="analytics-kpi routine-card"><span class="kpi-symbol is-mint">' + ui.icon('clock') + '</span>' +
          '<div class="kpi-copy"><span class="kpi-label">Actual study</span><strong>' + esc(core.formatDuration(analytics.actualMs)) + '</strong>' +
          '<span class="kpi-note">Recorded entry / exit sessions</span></div></article>' +
        '<article class="analytics-kpi routine-card"><span class="kpi-symbol is-' + (analytics.differenceMs >= 0 ? 'mint' : 'amber') + '">' + ui.icon('trend') + '</span>' +
          '<div class="kpi-copy"><span class="kpi-label">Difference</span><strong class="' + signedClass(analytics.differenceMs) + '">' + esc(signedDuration(analytics.differenceMs)) + '</strong>' +
          '<span class="kpi-note">' + (analytics.differenceMs >= 0 ? 'At or above plan' : 'Below plan') + '</span></div></article>' +
        '<article class="analytics-kpi routine-card"><span class="kpi-symbol is-lavender">' + ui.icon('target') + '</span>' +
          '<div class="kpi-copy"><span class="kpi-label">Completion</span><strong>' + percent(analytics.completionPct) + '%</strong>' +
          '<span class="kpi-note">' + analytics.completedCount + ' of ' + analytics.endedCount + ' ended slots</span></div></article>' +
        '<article class="analytics-kpi routine-card"><span class="kpi-symbol">' + ui.icon('chart') + '</span>' +
          '<div class="kpi-copy"><span class="kpi-label">Daily average</span><strong>' + esc(core.formatDuration(analytics.averageDailyMs)) + '</strong>' +
          '<span class="kpi-note">Across ' + elapsed + ' elapsed day' + (elapsed === 1 ? '' : 's') + '</span></div></article>' +
        '<article class="analytics-kpi routine-card"><span class="kpi-symbol is-danger">' + ui.icon('alert') + '</span>' +
          '<div class="kpi-copy"><span class="kpi-label">Missed slots</span><strong>' + analytics.missedCount + '</strong>' +
          '<span class="kpi-note">' + analytics.skippedCount + ' skipped intentionally</span></div></article>' +
      '</div>' +
      '<div class="analytics-grid">' +
        '<section class="analytics-panel routine-card">' +
          '<div class="analytics-panel-head"><div><h3>Planned vs actual by subject</h3>' +
            '<p>Subject time from your register compared with the timetable.</p></div>' +
            '<span class="side">' + esc(label) + '</span></div>' +
          '<div class="compare-list">' + compare + '</div>' +
          (analytics.bySubject.length
            ? '<div class="legend-line"><span><i class="planned"></i>Planned</span><span><i class="actual"></i>Actual</span></div>'
            : '') +
        '</section>' +
        '<div style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
          '<section class="analytics-panel routine-card">' +
            '<div class="analytics-panel-head"><div><h3>Most consistent slots</h3><p>Slots you complete most often.</p></div></div>' +
            '<div class="consistency-list">' + consistent + '</div>' +
          '</section>' +
          '<section class="analytics-panel routine-card">' +
            '<div class="analytics-panel-head"><div><h3>Missed study slots</h3><p>No matching recorded session.</p></div>' +
              '<span class="side">' + analytics.missedCount + ' total</span></div>' +
            missed +
          '</section>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Notifications                                                       */
  /* ------------------------------------------------------------------ */

  function allActivities(s) {
    const list = [];
    s.routine.routines.forEach((routine) => {
      core.WEEKDAY_IDS.forEach((day) => {
        (routine.days[day] || []).forEach((slot) => {
          const window = core.slotWindow(slot);
          list.push({
            slot,
            routine,
            meta: routine.name + ' · ' + weekdayShort(day) + ' · ' +
              (window ? core.formatClockRange(slot.start, slot.end) : '') +
              (window && window.overnight ? ' · overnight' : '')
          });
        });
      });
    });
    s.routine.exceptions.forEach((exception) => {
      (exception.slots || []).forEach((slot) => {
        list.push({
          slot,
          routine: null,
          meta: 'Temporary · ' + core.formatDateMedium(exception.date)
        });
      });
    });
    return list;
  }

  function renderNotifications(s) {
    const notifications = s.routine.notifications;
    const perm = permission();
    const status = perm.status || 'unknown';
    const supported = perm.supported !== false;
    const routines = s.routine.routines;
    const fallback = core.defaultRoutine(s.routine) || routines[0];
    if (notifRoutineFilter !== 'all' && !routines.some((routine) => routine.id === notifRoutineFilter)) {
      notifRoutineFilter = fallback ? fallback.id : null;
    }
    const activities = allActivities(s).filter((item) => (
      notifRoutineFilter === 'all' || (item.routine && item.routine.id === notifRoutineFilter)
    ));
    const visibleActivities = activities.slice(0, 80);
    const checkedText = perm.checkedAt ? 'Checked ' + core.relativeTime(perm.checkedAt) : '';

    const statusTitle = !supported
      ? 'Notifications are not supported'
      : status === 'granted'
        ? 'Notifications are allowed'
        : status === 'denied'
          ? 'Notifications are blocked by macOS'
          : 'Notifications not confirmed';

    const statusCopy = !supported
      ? 'This Mac cannot show routine reminders.'
      : status === 'granted'
        ? 'Reminders can appear even when this window is closed, as long as the app runs in the menu bar.'
        : status === 'denied'
          ? 'Allow notifications for Study Register in macOS. Your timetable and study records are unaffected.'
          : 'Send a test notification to confirm that reminders will appear.';

    const deniedHint = status === 'denied'
      ? '<div class="permission-hint">Open <code>System Settings → Notifications → Study Register</code> and enable <strong>Allow Notifications</strong>. Then send a test notification.</div>'
      : '';

    const exactDefault = notifications.timings.includes(0);
    const subjectRows = s.subjects.map((subject) => {
      const pref = notifications.subjects[subject.id] || {};
      const muted = pref.enabled === false;
      return overrideRow({
        kind: 'subjects',
        id: subject.id,
        label: subject.name,
        meta: Array.isArray(pref.timings) ? describeTimings(pref.timings) : '',
        muted,
        color: subject.color
      });
    }).join('');

    const activityRows = visibleActivities.length
      ? visibleActivities.map((item) => {
          const pref = notifications.activities[item.slot.id] || {};
          const muted = pref.enabled === false;
          return overrideRow({
            kind: 'activities',
            id: item.slot.id,
            label: item.slot.title,
            meta: item.meta + (Array.isArray(pref.timings) ? ' · ' + describeTimings(pref.timings) : ''),
            muted,
            color: colorForSlot(item.slot)
          });
        }).join('')
      : '<div class="override-empty">No activities in this routine yet. Build a timetable to add reminders.</div>';

    const routineOptions = routines.map((routine) => (
      '<option value="' + esc(routine.id) + '"' + (notifRoutineFilter === routine.id ? ' selected' : '') + '>' + esc(routine.name) + '</option>'
    )).join('') + '<option value="all"' + (notifRoutineFilter === 'all' ? ' selected' : '') + '>All routines</option>';

    els.views.notifications.innerHTML =
      '<div class="view-head"><div><h2>Notifications</h2><p>Exact-time reminders, handled locally by the menu bar app.</p></div>' +
        '<div class="view-actions"><button class="btn small" type="button" data-action="refresh-permission">' + ui.icon('refresh') + 'Check status</button></div></div>' +

      '<section class="permission-card routine-card is-' + status + '">' +
        '<div class="permission-icon">' + ui.icon(status === 'granted' ? 'bell' : status === 'denied' ? 'bellOff' : 'bell') + '</div>' +
        '<div class="permission-copy"><strong>' + esc(statusTitle) + '</strong>' +
          '<p>' + esc(statusCopy) + '</p>' +
          (checkedText ? '<p class="form-hint" style="margin-top:5px">' + esc(checkedText) + '</p>' : '') +
          deniedHint +
        '</div>' +
        '<div class="permission-actions">' +
          (supported ? '<button class="btn small primary" type="button" data-action="test-notification">' + ui.icon('bell') + 'Send test</button>' : '') +
          '<button class="btn small" type="button" data-action="open-notification-settings">' + ui.icon('gear') + 'System Settings</button>' +
        '</div>' +
      '</section>' +

      '<section class="notify-section routine-card">' +
        '<div class="notify-section-head">' +
          '<div><h3>Routine reminders</h3><p>On by default for every timetable activity.</p></div>' +
          '<button class="switch" type="button" role="switch" aria-label="Routine reminders" data-action="toggle-enabled" aria-checked="' + notifications.enabled + '"></button>' +
        '</div>' +
        '<div class="pref-row">' +
          '<div class="pref-copy"><strong>Completion reminder</strong><span>When a slot ends while its session is still running.</span></div>' +
          '<button class="switch" type="button" role="switch" aria-label="Completion reminder" data-action="toggle-completion" aria-checked="' + notifications.completionReminder + '"></button>' +
        '</div>' +
        '<div class="pref-row">' +
          '<div class="pref-copy"><strong>Missed slot reminder</strong><span>One reminder per missed study slot, after it ends.</span></div>' +
          '<button class="switch" type="button" role="switch" aria-label="Missed slot reminder" data-action="toggle-missed" aria-checked="' + notifications.missedReminder + '"></button>' +
        '</div>' +
      '</section>' +

      '<section class="notify-section routine-card">' +
        '<div class="notify-section-head">' +
          '<div><h3>Default timings</h3><p>Exact start time is on by default.</p></div>' +
        '</div>' +
        '<div class="timing-block"><div class="timing-chips">' +
          core.NOTIFICATION_OFFSETS.map((offset) => (
            '<button class="timing-chip' + (offset === 0 ? ' is-exact' : '') + '" type="button" data-action="toggle-timing" data-offset="' + offset + '" aria-pressed="' + notifications.timings.includes(offset) + '">' +
              (offset === 0 ? 'At scheduled time' : offset + ' min before') + '</button>'
          )).join('') +
        '</div>' +
        (notifications.timings.length
          ? ''
          : '<p class="timing-note is-warn">No timings selected. Reminders will not appear unless an override adds one.</p>') +
        '</div>' +
      '</section>' +

      '<section class="notify-section routine-card">' +
        '<div class="notify-section-head">' +
          '<div><h3>Subject preferences</h3><p>Mute a subject or give it custom timings.</p></div>' +
        '</div>' +
        '<div class="override-list">' + subjectRows + '</div>' +
      '</section>' +

      '<section class="notify-section routine-card">' +
        '<div class="notify-section-head">' +
          '<div><h3>Activity preferences</h3><p>Overrides win over subject and default timings.</p></div>' +
          '<div class="pref-control"><select class="select" style="width:180px" data-action="notification-filter" aria-label="Filter activities by routine">' + routineOptions + '</select></div>' +
        '</div>' +
        '<div class="override-list">' + activityRows + '</div>' +
        (activities.length > visibleActivities.length
          ? '<p class="timing-note">Showing the first ' + visibleActivities.length + ' of ' + activities.length + ' activities. Choose another routine to narrow the list.</p>'
          : '') +
      '</section>';
  }

  function overrideRow(item) {
    return '<div class="override-row' + (item.muted ? ' is-muted' : '') + '">' +
      '<span class="override-dot" style="--subject:' + esc(item.color) + '"></span>' +
      '<div class="override-body"><strong>' + esc(item.label) + '</strong><span>' + esc(item.meta) + '</span></div>' +
      '<div class="override-controls">' +
        '<button class="switch" type="button" role="switch" aria-checked="' + (!item.muted) + '" aria-label="' + esc(item.label) + ' reminders" data-action="mute-' + (item.kind === 'subjects' ? 'subject' : 'activity') + '" data-id="' + esc(item.id) + '"></button>' +
        '<button class="mini-icon-btn" type="button" title="Custom timings" aria-label="Custom timings for ' + esc(item.label) + '" data-action="customize-' + (item.kind === 'subjects' ? 'subject' : 'activity') + '" data-id="' + esc(item.id) + '">' + ui.icon('bell') + '</button>' +
      '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  async function startSlot(date, slotId, subjectId) {
    try {
      await store.call('startSession', subjectId || state().settings.defaultSubjectId, { routineSlotId: slotId, routineDate: date });
      ui.toast('Session started', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  async function exitSession() {
    try {
      const response = await store.call('endSession');
      const completed = response && response.completed;
      ui.toast(completed ? 'Session recorded · ' + core.formatDurationLong(core.sessionDuration(completed)) : 'Session recorded', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  async function setCompletion(date, slotId, status) {
    try {
      await store.call('setRoutineCompletion', date, slotId, status);
      ui.toast(status === 'skipped' ? 'Activity skipped' : status === 'done' ? 'Marked completed' : 'Status cleared', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  async function deleteException(date, label) {
    const confirmed = await ui.confirm({
      title: 'Remove temporary change?',
      message: 'The permanent routine will apply on ' + core.formatDateMedium(date) + ' again. Recorded sessions are not changed.',
      confirmLabel: 'Remove change',
      danger: true
    });
    if (!confirmed) return;
    try {
      await store.call('deleteRoutineException', date);
      ui.toast('Temporary change removed', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  async function assignDay(day, routineId) {
    try {
      await store.call('setDayRoutine', day, routineId || null);
      ui.toast(weekdayLabel(day) + ' updated', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
      if (state()) render(state(), store.meta);
    }
  }

  async function moveSlot(routineId, day, index, direction) {
    const s = state();
    if (!s) return;
    const routine = core.routineById(s.routine, routineId);
    if (!routine) return;
    const list = routine.days[day] || [];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    try {
      await store.call('saveRoutineSlot', routineId, day, Object.assign({}, a, { start: b.start, end: b.end }), { allowOverlap: true });
      await store.call('saveRoutineSlot', routineId, day, Object.assign({}, b, { start: a.start, end: a.end }), { allowOverlap: true });
      ui.toast('Activity reordered', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Modals                                                              */
  /* ------------------------------------------------------------------ */

  function openRoutineNameModal(routine) {
    const body = document.createElement('div');
    body.className = 'routine-name-form';
    body.innerHTML = '<div class="field"><label for="routineNameInput">Routine name</label>' +
      '<input class="input" id="routineNameInput" type="text" maxlength="48" autocomplete="off" spellcheck="false" placeholder="e.g. Regular week" value="' + esc(routine ? routine.name : '') + '"></div>' +
      '<div class="form-error" id="routineNameError" role="alert"></div>';
    const input = body.querySelector('#routineNameInput');
    const errorNode = body.querySelector('#routineNameError');
    const modal = ui.openModal({
      title: routine ? 'Rename routine' : 'New routine',
      subtitle: routine ? 'Assignments that use this routine update automatically.' : 'Days keep using the default routine until you assign this one.',
      body,
      footer: [
        { label: 'Cancel', className: 'ghost', onClick: () => modal.close() },
        {
          label: routine ? 'Save name' : 'Create routine',
          className: 'primary',
          onClick: async ({ button }) => {
            const name = input.value.trim();
            if (!name) {
              errorNode.textContent = 'Give the routine a name.';
              input.focus();
              return;
            }
            button.disabled = true;
            try {
              const response = await store.call('saveRoutine', routine ? { id: routine.id, name } : { name });
              if (response && response.routineId) editRoutineId = response.routineId;
              modal.close();
              ui.toast(routine ? 'Routine renamed' : 'Routine created', 'success');
            } catch (error) {
              errorNode.textContent = error.message;
              button.disabled = false;
            }
          }
        }
      ]
    });
    requestAnimationFrame(() => input.focus());
  }

  function openCopyDayModal(day) {
    const s = state();
    if (!s) return;
    const routine = core.routineById(s.routine, editRoutineId) || core.defaultRoutine(s.routine);
    if (!routine) return;
    const source = routineDaySlots(routine, day);
    if (!source.length) {
      ui.toast('Add an activity to ' + weekdayLabel(day) + ' first', 'error');
      return;
    }
    const targets = new Set(core.WEEKDAY_IDS.filter((id) => id !== day && !routineDaySlots(routine, id).length));
    let assign = true;

    const body = document.createElement('div');
    body.className = 'copy-day-form';
    body.innerHTML =
      '<div class="copy-day-source">' +
        '<div class="copy-day-source-head"><div><strong>' + esc(weekdayLabel(day)) + ' template</strong>' +
          '<span>' + source.length + (source.length === 1 ? ' activity' : ' activities') + ' · ' + esc(core.formatDuration(routineStudyMs(routine, day))) + ' of study</span></div>' +
          '<span class="badge">' + esc(routine.name) + '</span></div>' +
        '<div class="copy-day-preview">' + source.map((slot) => (
          '<div class="copy-day-line"><span>' + esc(core.formatClock(slot.start)) + '–' + esc(core.formatClock(slot.end)) + '</span>' +
          '<strong>' + esc(slot.title) + '</strong></div>'
        )).join('') + '</div>' +
      '</div>' +
      '<div>' +
        '<div class="copy-day-label"><span>Copy to</span><span id="copyDayCount"></span></div>' +
        '<div class="copy-day-chips">' + core.WEEKDAYS.map((item) => {
          const count = routineDaySlots(routine, item.id).length;
          return '<button class="copy-day-chip" type="button" data-day="' + item.id + '" aria-pressed="false"' + (item.id === day ? ' disabled' : '') + '>' +
            '<span>' + item.short + '</span><small>' + (item.id === day ? 'Source' : count ? count + ' act.' : 'Empty') + '</small></button>';
        }).join('') + '</div>' +
        '<div class="copy-day-presets">' +
          '<button class="btn small ghost" type="button" data-preset="weekdays">Weekdays</button>' +
          '<button class="btn small ghost" type="button" data-preset="weekend">Weekend</button>' +
          '<button class="btn small ghost" type="button" data-preset="all">All other days</button>' +
          '<button class="btn small ghost" type="button" data-preset="none">Clear</button>' +
        '</div>' +
        '<p class="copy-day-note" id="copyDayNote" aria-live="polite"></p>' +
      '</div>' +
      '<div class="copy-day-assign">' +
        '<div><strong>Use this routine on these days</strong><small>Uncheck to keep each day\'s current weekly assignment.</small></div>' +
        '<button class="switch" type="button" role="switch" aria-checked="true" aria-label="Use this routine on the selected days"></button>' +
      '</div>' +
      '<div class="form-error" role="alert"></div>';

    const cards = Array.from(body.querySelectorAll('[data-day]'));
    const note = body.querySelector('#copyDayNote');
    const countNode = body.querySelector('#copyDayCount');
    const assignSwitch = body.querySelector('.copy-day-assign .switch');
    const errorNode = body.querySelector('.form-error');
    let primary = null;

    function sync() {
      const list = Array.from(targets);
      const replacing = list.filter((id) => routineDaySlots(routine, id).length).length;
      cards.forEach((card) => card.setAttribute('aria-pressed', String(targets.has(card.getAttribute('data-day')))));
      countNode.textContent = list.length ? (list.length === 1 ? '1 day' : list.length + ' days') : 'No days selected';
      if (primary) {
        primary.disabled = !list.length;
        primary.textContent = !list.length ? 'Copy' : (replacing ? 'Replace ' : 'Copy to ') + list.length + (list.length === 1 ? ' day' : ' days');
      }
      note.textContent = !list.length
        ? 'Choose at least one day to copy this template to.'
        : replacing
          ? (replacing === 1 ? '1 selected day already has activities and will be replaced.' : replacing + ' selected days already have activities and will be replaced.') + ' Each copied day stays independent.'
          : 'Each copied day starts with these activities and can be edited separately. Recorded sessions never change.';
      note.classList.toggle('is-warn', replacing > 0);
    }

    cards.forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-day');
        if (id === day) return;
        if (targets.has(id)) targets.delete(id);
        else targets.add(id);
        sync();
      });
    });
    body.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = button.getAttribute('data-preset');
        targets.clear();
        if (preset === 'weekdays') core.WEEKDAY_IDS.slice(0, 5).forEach((id) => { if (id !== day) targets.add(id); });
        if (preset === 'weekend') core.WEEKDAY_IDS.slice(5).forEach((id) => { if (id !== day) targets.add(id); });
        if (preset === 'all') core.WEEKDAY_IDS.forEach((id) => { if (id !== day) targets.add(id); });
        sync();
      });
    });
    assignSwitch.addEventListener('click', () => {
      assign = !assign;
      assignSwitch.setAttribute('aria-checked', String(assign));
    });

    const modal = ui.openModal({
      title: 'Use ' + weekdayLabel(day) + ' as a template',
      subtitle: 'Copy these ' + source.length + (source.length === 1 ? ' activity' : ' activities') + ' to other weekdays in ' + routine.name + '.',
      body,
      wide: true,
      footer: [
        { label: 'Cancel', className: 'ghost', onClick: () => modal.close() },
        {
          label: 'Copy',
          className: 'primary',
          onClick: async ({ button }) => {
            const list = Array.from(targets);
            if (!list.length) return;
            errorNode.textContent = '';
            button.disabled = true;
            button.textContent = 'Copying…';
            try {
              await store.call('copyRoutineDay', routine.id, day, list, { assignDays: assign });
              modal.close();
              ui.toast('Copied to ' + list.length + (list.length === 1 ? ' day' : ' days') + ' · each day can be edited separately', 'success');
            } catch (error) {
              if (/^Overlap:/.test(error.message)) {
                const proceed = await ui.confirm({
                  title: 'Overlapping activities',
                  message: error.message.replace(/^Overlap:\s*/, '') + ' Overlaps are allowed if you copy anyway.',
                  confirmLabel: 'Copy anyway',
                  danger: false
                });
                if (proceed) {
                  try {
                    await store.call('copyRoutineDay', routine.id, day, list, { allowOverlap: true, assignDays: assign });
                    modal.close();
                    ui.toast('Copied with overlap · days stay independent', 'success');
                    return;
                  } catch (retryError) {
                    errorNode.textContent = retryError.message;
                  }
                }
              } else {
                errorNode.textContent = error.message;
              }
              sync();
            }
          }
        }
      ]
    });
    const layer = body.closest('.modal-root');
    primary = layer ? layer.querySelector('.modal-foot .btn.primary') : null;
    sync();
    requestAnimationFrame(() => {
      const first = cards.find((card) => !card.disabled && card.getAttribute('aria-pressed') === 'false');
      if (first) first.focus();
    });
  }

  async function deleteRoutine(routine) {
    if (!routine) return;
    const confirmed = await ui.confirm({
      title: 'Delete ' + routine.name + '?',
      message: 'Days assigned to this routine fall back to the default routine. Historical sessions and completed days are never changed.',
      confirmLabel: 'Delete routine'
    });
    if (!confirmed) return;
    try {
      await store.call('deleteRoutine', routine.id);
      if (editRoutineId === routine.id) editRoutineId = null;
      ui.toast('Routine deleted', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  async function makeDefault(routine) {
    if (!routine || routine.isDefault) return;
    try {
      await store.call('setDefaultRoutine', routine.id);
      ui.toast(routine.name + ' is now the default', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  function openSlotEditor(options) {
    const s = state();
    if (!s) return null;
    const mode = options.mode || 'routine';
    const slot = options.slot || null;
    const subjects = s.subjects;
    const body = document.createElement('div');
    body.className = 'slot-form';
    body.innerHTML =
      '<div class="field span-2"><label for="slotTitle">Activity name</label>' +
        '<input class="input" id="slotTitle" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="e.g. Physics practice" value="' + esc(slot ? slot.title : '') + '"></div>' +
      '<div class="field"><label for="slotType">Activity type</label><select class="select" id="slotType">' +
        core.ACTIVITY_TYPES.map((type) => '<option value="' + type.id + '"' + (slot && slot.type === type.id ? ' selected' : '') + '>' + esc(type.label) + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label for="slotSubject">Subject (optional)</label><select class="select" id="slotSubject">' +
        '<option value="">No subject</option>' +
        subjects.map((subject) => '<option value="' + esc(subject.id) + '"' + (slot && slot.subjectId === subject.id ? ' selected' : '') + '>' + esc(subject.name) + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label for="slotStart">Start</label><input class="input" id="slotStart" type="time" value="' + esc(slot ? slot.start : '09:00') + '"></div>' +
      '<div class="field"><label for="slotEnd">End</label><input class="input" id="slotEnd" type="time" value="' + esc(slot ? slot.end : '10:00') + '"></div>' +
      '<div class="span-2 duration-preview" id="slotDuration"><span>Duration</span><strong>—</strong></div>' +
      '<div class="field span-2"><label for="slotNotes">Notes (optional)</label>' +
        '<textarea class="input" id="slotNotes" maxlength="240" placeholder="Room, chapter, or what to focus on">' + esc(slot ? slot.notes : '') + '</textarea></div>' +
      '<p class="form-hint span-2">Overnight activities are supported: an end time earlier than the start time continues into the next day.</p>' +
      '<div class="form-error span-2" id="slotError" role="alert"></div>';

    const titleInput = body.querySelector('#slotTitle');
    const typeSelect = body.querySelector('#slotType');
    const subjectSelect = body.querySelector('#slotSubject');
    const startInput = body.querySelector('#slotStart');
    const endInput = body.querySelector('#slotEnd');
    const notesInput = body.querySelector('#slotNotes');
    const durationNode = body.querySelector('#slotDuration');
    const durationValue = durationNode.querySelector('strong');
    const errorNode = body.querySelector('#slotError');

    function preview() {
      const start = core.clockMinutes(startInput.value);
      const end = core.clockMinutes(endInput.value);
      if (start == null || end == null || start === end) {
        durationNode.classList.add('is-invalid');
        durationValue.textContent = start != null && end != null ? 'Start and end match' : '—';
        return;
      }
      durationNode.classList.remove('is-invalid');
      const overnight = end < start;
      const minutes = overnight ? end + 1440 - start : end - start;
      durationValue.textContent = core.formatDuration(minutes * 60000) + (overnight ? ' · overnight' : '');
    }
    startInput.addEventListener('input', preview);
    endInput.addEventListener('input', preview);
    typeSelect.addEventListener('change', () => {
      if (!titleInput.value.trim()) titleInput.placeholder = 'e.g. ' + typeLabel(typeSelect.value);
      if (!subjectSelect.value) {
        const label = typeLabel(typeSelect.value).toLowerCase();
        const match = subjects.find((subject) => subject.id === typeSelect.value || subject.name.toLowerCase() === label);
        if (match) subjectSelect.value = match.id;
      }
    });
    preview();

    const saveLabel = mode === 'local' ? (slot ? 'Save activity' : 'Add activity') : 'Save activity';
    const modal = ui.openModal({
      title: mode === 'local' ? (slot ? 'Edit activity' : 'Add activity') : (slot ? 'Edit activity' : 'Add to timetable'),
      subtitle: mode === 'local'
        ? 'This activity belongs only to the temporary day.'
        : 'This repeats every ' + weekdayLabel(options.weekday) + ' until you change it.',
      body,
      footer: [
        { label: 'Cancel', className: 'ghost', onClick: () => modal.close() },
        {
          label: saveLabel,
          className: 'primary',
          onClick: async ({ button }) => {
            const start = startInput.value;
            const end = endInput.value;
            errorNode.textContent = '';
            if (!start || !end) {
              errorNode.textContent = 'Enter both a start and end time.';
              return;
            }
            if (start === end) {
              errorNode.textContent = 'Start and end time must differ.';
              return;
            }
            const payload = {
              id: slot ? slot.id : undefined,
              title: titleInput.value.trim(),
              type: typeSelect.value,
              subjectId: subjectSelect.value || null,
              notes: notesInput.value.trim(),
              start,
              end,
              createdAt: slot ? slot.createdAt : undefined
            };
            if (mode === 'local') {
              options.onSave(payload);
              modal.close();
              return;
            }
            button.disabled = true;
            button.textContent = 'Saving…';
            try {
              await store.call('saveRoutineSlot', options.routineId, options.weekday, payload, { allowOverlap: false });
              modal.close();
              ui.toast(slot ? 'Activity updated' : 'Activity added', 'success');
            } catch (error) {
              if (/^Overlap:/.test(error.message)) {
                const proceed = await ui.confirm({
                  title: 'Overlapping activities',
                  message: error.message.replace(/^Overlap:\s*/, '') + ' Overlaps are allowed if you save again.',
                  confirmLabel: 'Save anyway',
                  danger: false
                });
                if (proceed) {
                  try {
                    await store.call('saveRoutineSlot', options.routineId, options.weekday, payload, { allowOverlap: true });
                    modal.close();
                    ui.toast('Activity saved with overlap', 'success');
                    return;
                  } catch (retryError) {
                    errorNode.textContent = retryError.message;
                  }
                }
              } else {
                errorNode.textContent = error.message;
              }
              button.disabled = false;
              button.textContent = saveLabel;
            }
          }
        }
      ]
    });
    requestAnimationFrame(() => titleInput.focus());
    return modal;
  }

  function openExceptionEditor(dateLike) {
    const s = state();
    if (!s) return;
    const date = dateLike || core.dateKey(new Date());
    const existing = s.routine.exceptions.find((item) => item.date === date) || null;
    let kind = existing ? existing.kind : 'holiday';
    let label = existing ? existing.label : 'Holiday';
    let slots = existing ? existing.slots.map((slot) => Object.assign({}, slot)) : [];
    let labelTouched = Boolean(existing);
    const locked = Boolean(existing);

    const body = document.createElement('div');
    body.className = 'slot-form';
    body.innerHTML =
      '<div class="field"><label for="exDate">Date</label><input class="input" id="exDate" type="date" value="' + esc(date) + '"' + (locked ? ' disabled' : '') + '></div>' +
      '<div class="field"><label for="exLabel">Label</label><input class="input" id="exLabel" type="text" maxlength="48" autocomplete="off" spellcheck="false" value="' + esc(label) + '"></div>' +
      '<div class="field span-2"><label>Temporary day type</label>' +
        '<div class="segmented" role="group" aria-label="Temporary day type">' +
          '<button type="button" data-kind="holiday" class="' + (kind === 'holiday' ? 'is-active' : '') + '">Holiday / rest day</button>' +
          '<button type="button" data-kind="custom" class="' + (kind === 'custom' ? 'is-active' : '') + '">Custom schedule</button>' +
        '</div></div>' +
      '<div class="span-2" id="exCustom" style="' + (kind === 'custom' ? '' : 'display:none') + '">' +
        '<div class="slot-editor-list" id="exSlots"></div>' +
        '<div class="day-summary" style="margin-top:10px">' +
          '<p class="form-hint">Replaces the permanent routine for this date only.</p>' +
          '<div class="side">' +
            '<button class="btn small ghost" type="button" data-ex="copy">' + ui.icon('copy') + 'Copy routine day</button>' +
            '<button class="btn small" type="button" data-ex="add">' + ui.icon('plus') + 'Add activity</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="form-hint span-2">The permanent routine, past plans and recorded sessions are never overwritten.</p>' +
      '<div class="form-error span-2" id="exError" role="alert"></div>';

    const dateInput = body.querySelector('#exDate');
    const labelInput = body.querySelector('#exLabel');
    const customWrap = body.querySelector('#exCustom');
    const listNode = body.querySelector('#exSlots');
    const errorNode = body.querySelector('#exError');
    const kindButtons = body.querySelectorAll('[data-kind]');
    labelInput.addEventListener('input', () => { labelTouched = true; });

    function renderList() {
      listNode.innerHTML = slots.length
        ? slots.map((slot, index) => {
            const subject = subjectForSlot(slot);
            const color = colorForSlot(slot);
            return '<div class="editor-row">' +
              '<div class="editor-time">' + esc(core.formatClock(slot.start)) + '<div class="end">' + esc(core.formatClock(slot.end)) + '</div></div>' +
              '<span class="slot-type" style="--slot:' + esc(color) + '">' + ui.icon(typeIcon(slot.type)) + '</span>' +
              '<div class="editor-main"><strong>' + esc(slot.title) + '</strong><span>' +
                [subject && subject.name.trim().toLowerCase() === typeLabel(slot.type).toLowerCase() ? '' : esc(typeLabel(slot.type)), subject ? esc(subject.name) : ''].filter(Boolean).join(' · ') +
                '</span></div>' +
              '<span class="editor-duration-text">' + esc(core.formatDuration(slot.durationMinutes ? slot.durationMinutes * 60000 : 60000)) + '</span>' +
              '<div class="editor-actions">' +
                '<button class="mini-icon-btn" type="button" title="Edit" aria-label="Edit activity" data-edit="' + index + '">' + ui.icon('pencil') + '</button>' +
                '<button class="mini-icon-btn danger" type="button" title="Remove" aria-label="Remove activity" data-remove="' + index + '">' + ui.icon('trash') + '</button>' +
              '</div></div>';
          }).join('')
        : '<div class="exception-empty">No activities yet. Add one or copy the permanent day.</div>';
    }

    function syncKind() {
      kindButtons.forEach((button) => button.classList.toggle('is-active', button.getAttribute('data-kind') === kind));
      customWrap.style.display = kind === 'custom' ? '' : 'none';
      if (!labelTouched) {
        label = kind === 'custom' ? 'Custom day' : 'Holiday';
        labelInput.value = label;
      }
    }

    kindButtons.forEach((button) => {
      button.addEventListener('click', () => {
        kind = button.getAttribute('data-kind');
        syncKind();
      });
    });
    body.querySelector('[data-ex="add"]').addEventListener('click', () => {
      openSlotEditor({
        mode: 'local',
        weekday: core.weekdayId(dateInput.value || date),
        onSave: (slot) => {
          if (!slot.id) slot.id = core.slugId('slot');
          slots.push(slot);
          slots.sort((a, b) => core.clockMinutes(a.start) - core.clockMinutes(b.start));
          renderList();
        }
      });
    });
    body.querySelector('[data-ex="copy"]').addEventListener('click', () => {
      const targetDate = dateInput.value || date;
      const plan = core.planForDate(s.routine, targetDate);
      if (!plan || plan.holiday || !plan.slots.length) {
        ui.toast('No routine activities to copy for that date', 'error');
        return;
      }
      slots = plan.slots.map((slot) => ({
        id: core.slugId('slot'),
        title: slot.title,
        type: slot.type,
        subjectId: slot.subjectId,
        notes: slot.notes,
        start: slot.start,
        end: slot.end,
        createdAt: new Date().toISOString()
      }));
      renderList();
      ui.toast('Routine day copied', 'success');
    });
    listNode.addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit]');
      if (editButton) {
        const index = Number(editButton.getAttribute('data-edit'));
        const slot = slots[index];
        if (!slot) return;
        openSlotEditor({
          mode: 'local',
          weekday: core.weekdayId(dateInput.value || date),
          slot,
          onSave: (next) => {
            slots[index] = Object.assign({}, slot, next);
            slots.sort((a, b) => core.clockMinutes(a.start) - core.clockMinutes(b.start));
            renderList();
          }
        });
        return;
      }
      const removeButton = event.target.closest('[data-remove]');
      if (removeButton) {
        const index = Number(removeButton.getAttribute('data-remove'));
        slots.splice(index, 1);
        renderList();
      }
    });

    function saveException(allowOverlap) {
      const targetDate = dateInput.value || date;
      if (!targetDate) {
        errorNode.textContent = 'Choose a date.';
        return Promise.reject(new Error('Choose a date.'));
      }
      if (kind === 'custom' && !slots.length) {
        errorNode.textContent = 'Add at least one activity for a custom day.';
        return Promise.reject(new Error('Add at least one activity.'));
      }
      return store.call('saveRoutineException', {
        date: targetDate,
        kind,
        label: labelInput.value.trim() || (kind === 'holiday' ? 'Holiday' : 'Custom day'),
        slots: kind === 'custom' ? slots : []
      }, { allowOverlap });
    }

    const footer = [
      { label: 'Cancel', className: 'ghost', onClick: () => modal.close() }
    ];
    if (existing) {
      footer.push({
        label: 'Remove',
        className: 'danger',
        onClick: async () => {
          modal.close();
          await deleteException(existing.date, existing.label);
        }
      });
    }
    footer.push({
      label: 'Save change',
      className: 'primary',
      onClick: async ({ button }) => {
        errorNode.textContent = '';
        button.disabled = true;
        try {
          await saveException(false);
          modal.close();
          ui.toast('Temporary change saved', 'success');
        } catch (error) {
          if (/^Overlap:/.test(error.message)) {
            const proceed = await ui.confirm({
              title: 'Overlapping activities',
              message: error.message.replace(/^Overlap:\s*/, '') + ' Overlaps are allowed if you save again.',
              confirmLabel: 'Save anyway',
              danger: false
            });
            if (proceed) {
              try {
                await saveException(true);
                modal.close();
                ui.toast('Temporary change saved with overlap', 'success');
                return;
              } catch (retryError) {
                errorNode.textContent = retryError.message;
              }
            }
          } else {
            errorNode.textContent = error.message;
          }
          button.disabled = false;
        }
      }
    });

    const modal = ui.openModal({
      title: 'Temporary change',
      subtitle: 'A holiday or custom schedule for one date. Your permanent routine stays intact.',
      body,
      footer
    });
    renderList();
    syncKind();
    requestAnimationFrame(() => labelInput.focus());
  }

  function openPrefEditor(kind, id) {
    const s = state();
    if (!s) return;
    const notifications = s.routine.notifications;
    const map = kind === 'subjects' ? notifications.subjects : notifications.activities;
    const pref = map[id] || {};
    const defaults = notifications.timings.slice();
    let muted = pref.enabled === false;
    let useDefault = !Array.isArray(pref.timings);
    let selected = new Set(useDefault ? defaults : pref.timings);
    const subject = kind === 'subjects' ? s.subjects.find((item) => item.id === id) : null;
    const activity = kind === 'activities'
      ? allActivities(s).find((item) => item.slot.id === id)
      : null;
    const label = subject ? subject.name : activity ? activity.slot.title : 'Activity';

    const body = document.createElement('div');
    body.className = 'pref-editor';
    body.innerHTML =
      '<div class="pref-field">' +
        '<div class="pref-field-label"><span>Mute notifications</span>' +
          '<button class="switch" type="button" role="switch" aria-checked="' + muted + '" aria-label="Mute notifications"></button></div>' +
        '<p class="form-hint">Muting stops every reminder for this ' + (kind === 'subjects' ? 'subject' : 'activity') + ' without changing the timetable.</p>' +
      '</div>' +
      '<div class="pref-field">' +
        '<div class="pref-field-label"><span>Timings</span>' +
          '<button class="switch" type="button" role="switch" aria-checked="' + useDefault + '" aria-label="Use routine default timings"></button></div>' +
        '<p class="form-hint">' + (useDefault ? 'Using the routine default timings.' : 'Using custom timings for this ' + (kind === 'subjects' ? 'subject' : 'activity') + '.') + '</p>' +
        '<div class="timing-chips">' +
          core.NOTIFICATION_OFFSETS.map((offset) => (
            '<button class="timing-chip' + (offset === 0 ? ' is-exact' : '') + '" type="button" data-offset="' + offset + '" aria-pressed="' + selected.has(offset) + '">' +
              (offset === 0 ? 'At scheduled time' : offset + ' min before') + '</button>'
          )).join('') +
        '</div>' +
      '</div>' +
      '<div class="form-error" role="alert"></div>';

    const muteSwitch = body.querySelectorAll('.switch')[0];
    const defaultSwitch = body.querySelectorAll('.switch')[1];
    const chips = body.querySelectorAll('[data-offset]');
    const hint = body.querySelector('.pref-field:nth-child(2) .form-hint');
    const errorNode = body.querySelector('.form-error');

    function syncChips() {
      chips.forEach((chip) => {
        const offset = Number(chip.getAttribute('data-offset'));
        chip.setAttribute('aria-pressed', String(selected.has(offset)));
        chip.disabled = useDefault;
        chip.style.opacity = useDefault ? '0.5' : '';
      });
      hint.textContent = useDefault
        ? 'Using the routine default timings.'
        : 'Using custom timings for this ' + (kind === 'subjects' ? 'subject' : 'activity') + '.';
    }

    muteSwitch.addEventListener('click', () => {
      muted = !muted;
      muteSwitch.setAttribute('aria-checked', String(muted));
    });
    defaultSwitch.addEventListener('click', () => {
      useDefault = !useDefault;
      if (!useDefault && !selected.size) selected = new Set(defaults);
      defaultSwitch.setAttribute('aria-checked', String(useDefault));
      syncChips();
    });
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        if (useDefault) return;
        const offset = Number(chip.getAttribute('data-offset'));
        if (selected.has(offset)) selected.delete(offset);
        else selected.add(offset);
        syncChips();
      });
    });
    syncChips();

    const footer = [
      { label: 'Cancel', className: 'ghost', onClick: () => modal.close() }
    ];
    if (map[id]) {
      footer.push({
        label: 'Reset',
        className: 'ghost',
        onClick: async () => {
          const nextMap = Object.assign({}, map);
          delete nextMap[id];
          try {
            await store.call('updateRoutineNotifications', { [kind]: nextMap });
            modal.close();
            ui.toast('Preference reset', 'success');
          } catch (error) {
            errorNode.textContent = error.message;
          }
        }
      });
    }
    footer.push({
      label: 'Save',
      className: 'primary',
      onClick: async ({ button }) => {
        const nextMap = Object.assign({}, map);
        if (muted) {
          nextMap[id] = { enabled: false, timings: useDefault ? null : Array.from(selected).sort((a, b) => a - b) };
        } else if (useDefault) {
          delete nextMap[id];
        } else {
          nextMap[id] = { enabled: null, timings: Array.from(selected).sort((a, b) => a - b) };
        }
        button.disabled = true;
        try {
          await store.call('updateRoutineNotifications', { [kind]: nextMap });
          modal.close();
          ui.toast('Notification preference saved', 'success');
        } catch (error) {
          errorNode.textContent = error.message;
          button.disabled = false;
        }
      }
    });

    const modal = ui.openModal({
      title: label,
      subtitle: 'Reminders for this ' + (kind === 'subjects' ? 'subject' : 'activity') + '.',
      body,
      footer
    });
  }

  async function toggleMute(kind, id) {
    const s = state();
    if (!s) return;
    const map = kind === 'subjects' ? s.routine.notifications.subjects : s.routine.notifications.activities;
    const pref = map[id] || {};
    const nextMap = Object.assign({}, map);
    if (pref.enabled === false) {
      if (Array.isArray(pref.timings)) nextMap[id] = { enabled: null, timings: pref.timings };
      else delete nextMap[id];
    } else {
      nextMap[id] = { enabled: false, timings: Array.isArray(pref.timings) ? pref.timings : null };
    }
    try {
      await store.call('updateRoutineNotifications', { [kind]: nextMap });
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  async function testNotification(button) {
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending…';
    }
    try {
      const response = await store.call('testRoutineNotification');
      if (response && response.permission) permissionOverride = response.permission;
      const denied = response && response.permission && response.permission.status === 'denied';
      ui.toast(denied ? 'macOS blocked the test notification' : 'Test notification sent', denied ? 'error' : 'success');
      if (state()) render(state(), store.meta);
    } catch (error) {
      ui.toast(error.message, 'error');
      if (button) {
        button.disabled = false;
        button.textContent = 'Send test';
      }
    }
  }

  async function refreshPermission() {
    if (typeof window.sr.notificationStatus !== 'function') {
      ui.toast('Send a test notification to confirm permission', 'info');
      return;
    }
    try {
      const response = await window.sr.notificationStatus();
      if (response && response.ok && response.permission) {
        permissionOverride = response.permission;
        if (state()) render(state(), store.meta);
        ui.toast(response.permission.status === 'unknown'
          ? 'Still unconfirmed — send a test notification'
          : 'Notification status refreshed', 'info');
      }
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Event wiring                                                        */
  /* ------------------------------------------------------------------ */

  function findPlanSlot(date, slotId) {
    const s = state();
    if (!s) return { plan: null, slot: null };
    const plan = core.planForDate(s.routine, date);
    if (!plan) return { plan: null, slot: null };
    const slot = plan.slots.find((item) => item.id === slotId) || null;
    return { plan, slot };
  }

  async function onViewClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    const s = state();
    if (!s) return;

    if (action === 'start-slot') {
      await startSlot(button.getAttribute('data-date'), button.getAttribute('data-slot-id'), button.getAttribute('data-subject-id'));
      return;
    }
    if (action === 'exit-session') {
      await exitSession();
      return;
    }
    if (action === 'complete-slot' || action === 'skip-slot' || action === 'clear-slot') {
      const status = action === 'complete-slot' ? 'done' : action === 'skip-slot' ? 'skipped' : null;
      await setCompletion(button.getAttribute('data-date'), button.getAttribute('data-slot-id'), status);
      return;
    }
    if (action === 'edit-slot' || action === 'edit-slot-row') {
      const date = button.getAttribute('data-date');
      const slotId = button.getAttribute('data-slot-id');
      if (action === 'edit-slot-row') {
        const day = button.getAttribute('data-day');
        const routine = core.routineById(s.routine, editRoutineId);
        const slot = routine ? (routine.days[day] || []).find((item) => item.id === slotId) : null;
        if (routine && slot) openSlotEditor({ routineId: routine.id, weekday: day, slot });
        return;
      }
      const found = findPlanSlot(date, slotId);
      if (!found.plan || !found.slot) return;
      if (found.plan.source === 'routine' && found.plan.routineId) {
        openSlotEditor({ routineId: found.plan.routineId, weekday: found.plan.weekday, slot: found.slot });
      } else if (found.plan.source === 'custom') {
        openExceptionEditor(found.plan.date);
      } else {
        editWeekday = found.plan.weekday || core.weekdayId(date);
        setTab('timetable');
      }
      return;
    }
    if (action === 'add-slot') {
      const day = button.getAttribute('data-day') || editWeekday;
      editWeekday = day;
      const routine = core.routineById(s.routine, editRoutineId) || core.defaultRoutine(s.routine);
      if (routine) openSlotEditor({ routineId: routine.id, weekday: day, slot: null });
      return;
    }
    if (action === 'clear-day') {
      const day = button.getAttribute('data-day');
      const routine = core.routineById(s.routine, editRoutineId);
      if (!routine) return;
      const list = routineDaySlots(routine, day);
      if (!list.length) return;
      const confirmed = await ui.confirm({
        title: 'Clear ' + weekdayLabel(day) + '?',
        message: 'Remove all ' + list.length + ' activities from ' + weekdayLabel(day) + ' in ' + routine.name + '. Other weekdays and recorded sessions are not changed.',
        confirmLabel: 'Clear ' + weekdayLabel(day)
      });
      if (!confirmed) return;
      try {
        await store.call('clearRoutineDay', routine.id, day);
        ui.toast(weekdayLabel(day) + ' cleared', 'success');
      } catch (error) {
        ui.toast(error.message, 'error');
      }
      return;
    }
    if (action === 'delete-slot') {
      const day = button.getAttribute('data-day');
      const slotId = button.getAttribute('data-slot-id');
      const routine = core.routineById(s.routine, editRoutineId);
      if (!routine) return;
      const slot = (routine.days[day] || []).find((item) => item.id === slotId);
      if (!slot) return;
      const confirmed = await ui.confirm({
        title: 'Delete ' + slot.title + '?',
        message: 'It is removed from ' + weekdayLabel(day) + ' in this routine. Past plans and recorded sessions are not changed.',
        confirmLabel: 'Delete activity'
      });
      if (!confirmed) return;
      try {
        await store.call('deleteRoutineSlot', routine.id, day, slotId);
        ui.toast('Activity deleted', 'success');
      } catch (error) {
        ui.toast(error.message, 'error');
      }
      return;
    }
    if (action === 'move-slot') {
      const routine = core.routineById(s.routine, editRoutineId);
      if (!routine) return;
      await moveSlot(routine.id, button.getAttribute('data-day'), Number(button.getAttribute('data-index')), Number(button.getAttribute('data-dir')));
      return;
    }
    if (action === 'day-tab') {
      editWeekday = button.getAttribute('data-day');
      renderTimetable(state());
      return;
    }
    if (action === 'select-routine') return;
    if (action === 'new-routine') {
      openRoutineNameModal(null);
      return;
    }
    if (action === 'rename-routine') {
      openRoutineNameModal(core.routineById(s.routine, editRoutineId) || core.defaultRoutine(s.routine));
      return;
    }
    if (action === 'delete-routine') {
      await deleteRoutine(core.routineById(s.routine, button.getAttribute('data-routine-id') || editRoutineId));
      return;
    }
    if (action === 'set-default-routine') {
      await makeDefault(core.routineById(s.routine, button.getAttribute('data-routine-id') || editRoutineId));
      return;
    }
    if (action === 'edit-routine' || action === 'edit-day') {
      editRoutineId = button.getAttribute('data-routine-id') || editRoutineId;
      if (action === 'edit-day') editWeekday = button.getAttribute('data-day');
      setTab('timetable');
      return;
    }
    if (action === 'copy-day') {
      if (button.getAttribute('data-routine-id')) editRoutineId = button.getAttribute('data-routine-id');
      openCopyDayModal(button.getAttribute('data-day'));
      return;
    }
    if (action === 'build-timetable') {
      editWeekday = button.getAttribute('data-weekday') || core.weekdayId(new Date());
      const routine = core.defaultRoutine(s.routine);
      if (routine) editRoutineId = routine.id;
      setTab('timetable');
      return;
    }
    if (action === 'add-exception') {
      openExceptionEditor(button.getAttribute('data-date') || core.dateKey(new Date()));
      return;
    }
    if (action === 'edit-exception') {
      openExceptionEditor(button.getAttribute('data-date'));
      return;
    }
    if (action === 'delete-exception') {
      await deleteException(button.getAttribute('data-date'), button.getAttribute('data-label'));
      return;
    }
    if (action === 'set-range') {
      analyticsRange = button.getAttribute('data-range');
      renderAnalytics(s);
      return;
    }
    if (action === 'test-notification') {
      await testNotification(button);
      return;
    }
    if (action === 'open-notification-settings') {
      try {
        await store.call('openNotificationSettings');
      } catch (error) {
        ui.toast(error.message, 'error');
      }
      return;
    }
    if (action === 'refresh-permission') {
      await refreshPermission();
      return;
    }
    if (action === 'toggle-enabled') {
      try {
        await store.call('updateRoutineNotifications', { enabled: !s.routine.notifications.enabled });
      } catch (error) {
        ui.toast(error.message, 'error');
      }
      return;
    }
    if (action === 'toggle-completion') {
      try {
        await store.call('updateRoutineNotifications', { completionReminder: !s.routine.notifications.completionReminder });
      } catch (error) {
        ui.toast(error.message, 'error');
      }
      return;
    }
    if (action === 'toggle-missed') {
      try {
        await store.call('updateRoutineNotifications', { missedReminder: !s.routine.notifications.missedReminder });
      } catch (error) {
        ui.toast(error.message, 'error');
      }
      return;
    }
    if (action === 'toggle-timing') {
      const offset = Number(button.getAttribute('data-offset'));
      const current = s.routine.notifications.timings.slice();
      const next = current.includes(offset) ? current.filter((value) => value !== offset) : current.concat(offset);
      next.sort((a, b) => a - b);
      try {
        await store.call('updateRoutineNotifications', { timings: next });
        if (!next.length) ui.toast('No default timings selected', 'info');
      } catch (error) {
        ui.toast(error.message, 'error');
      }
      return;
    }
    if (action === 'mute-subject') {
      await toggleMute('subjects', button.getAttribute('data-id'));
      return;
    }
    if (action === 'mute-activity') {
      await toggleMute('activities', button.getAttribute('data-id'));
      return;
    }
    if (action === 'customize-subject') {
      openPrefEditor('subjects', button.getAttribute('data-id'));
      return;
    }
    if (action === 'customize-activity') {
      openPrefEditor('activities', button.getAttribute('data-id'));
    }
  }

  function onViewChange(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'select-routine') {
      editRoutineId = target.value;
      if (state()) renderTimetable(state());
      return;
    }
    if (action === 'assign-day') {
      assignDay(target.getAttribute('data-day'), target.value);
      return;
    }
    if (action === 'notification-filter') {
      notifRoutineFilter = target.value;
      if (state()) renderNotifications(state());
    }
  }

  function bind() {
    ui.hydrateIcons();
    els.nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });
    els.permissionPill.addEventListener('click', () => setTab('notifications'));
    els.registerBtn.addEventListener('click', () => {
      window.sr.showPopover().catch(() => {});
    });
    els.dashboardBtn.addEventListener('click', () => {
      window.sr.openDashboard().catch(() => {});
    });
    els.settingsBtn.addEventListener('click', () => window.SRSettings.open());

    Object.values(els.views).forEach((view) => {
      view.addEventListener('click', (event) => { onViewClick(event).catch((error) => console.error(error)); });
      view.addEventListener('change', onViewChange);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (document.getElementById('modalRoot').childElementCount > 0) return;
      window.sr.showPopover().catch(() => {});
    });

    setInterval(() => {
      const day = core.dateKey(new Date());
      if (day !== currentDay) {
        currentDay = day;
        store.init().catch(() => {});
      }
      if (activeTab === 'today' || activeTab === 'weekly') {
        if (state()) render(state(), store.meta);
      }
    }, 20000);

    window.addEventListener('focus', () => {
      store.init().catch(() => {});
    });

    window.sr.onRoutineTab((payload) => {
      if (payload && payload.tab) setTab(payload.tab);
    });
  }

  async function boot() {
    bind();
    updateTabButtons();
    store.subscribe((s, meta) => render(s, meta));
    try {
      await store.init();
    } catch (error) {
      ui.toast(error.message || 'Could not load My Routine', 'error', 5000);
    }
  }

  boot();
})();
