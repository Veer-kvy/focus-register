/* Menu bar popover controller. */
(function () {
  'use strict';

  const core = window.SRCore;
  const ui = window.SRUI;
  const store = window.SRStore;
  const history = window.SRHistory;

  const els = {
    hero: document.getElementById('hero'),
    statusText: document.getElementById('statusText'),
    heroTimer: document.getElementById('heroTimer'),
    heroSub: document.getElementById('heroSub'),
    ring: document.getElementById('ringProgress'),
    goalText: document.getElementById('goalText'),
    goalPct: document.getElementById('goalPct'),
    goalFill: document.getElementById('goalFill'),
    subjectGrid: document.getElementById('subjectGrid'),
    subjectLockNote: document.getElementById('subjectLockNote'),
    entryBtn: document.getElementById('entryBtn'),
    exitBtn: document.getElementById('exitBtn'),
    entryHint: document.getElementById('entryHint'),
    exitHint: document.getElementById('exitHint'),
    discardBtn: document.getElementById('discardBtn'),
    statTotal: document.getElementById('statTotal'),
    statTotalNote: document.getElementById('statTotalNote'),
    statSessions: document.getElementById('statSessions'),
    statSessionsNote: document.getElementById('statSessionsNote'),
    statLongest: document.getElementById('statLongest'),
    statAverage: document.getElementById('statAverage'),
    streakBadge: document.getElementById('streakBadge'),
    streakText: document.getElementById('streakText'),
    recentList: document.getElementById('recentList'),
    headerDate: document.getElementById('headerDate'),
    headerTime: document.getElementById('headerTime'),
    headerSuffix: document.getElementById('headerSuffix'),
    scheduleHint: document.getElementById('scheduleHint'),
    scheduleTitle: document.getElementById('scheduleTitle'),
    scheduleMeta: document.getElementById('scheduleMeta'),
    scheduleStart: document.getElementById('scheduleStart')
  };

  const RING_LENGTH = 2 * Math.PI * 100;
  const headerDateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  let state = null;
  let selectedSubjectId = null;
  let todayStats = { total: 0, count: 0, longest: 0, average: 0 };
  let busy = false;
  let currentDayKey = core.dateKey(new Date());
  let lastSlowUpdate = 0;
  let timer = null;
  let scheduleSuggestion = null;
  let userChoseSubject = false;

  function selectedSubject() {
    if (!state) return null;
    return state.subjects.find((item) => item.id === selectedSubjectId) || state.subjects[0] || null;
  }

  function activeSubject() {
    if (!state || !state.activeSession) return null;
    return state.subjects.find((item) => item.id === state.activeSession.subjectId) || null;
  }

  function refreshSuggestion(now) {
    if (!state || state.activeSession) {
      scheduleSuggestion = null;
    } else {
      try {
        scheduleSuggestion = core.suggestRoutineSlot(state.routine, state.sessions, state.activeSession, now, state.subjects);
      } catch (error) {
        scheduleSuggestion = null;
      }
    }
    if (scheduleSuggestion && scheduleSuggestion.slot && !userChoseSubject) {
      const suggested = state.subjects.find((subject) => subject.id === scheduleSuggestion.subjectId);
      if (suggested) selectedSubjectId = suggested.id;
    }
    renderScheduleHint(now);
  }

  function renderScheduleHint(now) {
    if (!els.scheduleHint) return;
    const hint = scheduleSuggestion;
    if (!hint || !hint.slot || (state && state.activeSession)) {
      els.scheduleHint.classList.add('hidden');
      return;
    }
    const slot = hint.slot;
    const subject = state.subjects.find((item) => item.id === hint.subjectId);
    const label = subject ? subject.name : slot.title;
    els.scheduleTitle.textContent = hint.kind === 'current'
      ? 'Scheduled now · ' + label
      : 'Up next · ' + label;
    const timing = hint.kind === 'current'
      ? core.formatDuration(Math.max(0, slot.endAt - now.getTime())) + ' left'
      : 'in ' + core.formatDuration(Math.max(0, slot.startAt - now.getTime()));
    els.scheduleMeta.textContent = core.formatClockRange(slot.start, slot.end) + ' · ' + timing;
    els.scheduleStart.textContent = hint.kind === 'current' ? 'Start' : 'Start early';
    els.scheduleHint.classList.remove('hidden');
  }

  function suggestionRoutineMeta() {
    if (!scheduleSuggestion || !scheduleSuggestion.slot || scheduleSuggestion.kind !== 'current') return null;
    if (scheduleSuggestion.subjectId && selectedSubjectId !== scheduleSuggestion.subjectId) return null;
    return {
      routineSlotId: scheduleSuggestion.slot.id,
      routineDate: scheduleSuggestion.slot.planDate || currentDayKey
    };
  }

  function openRoutine() {
    window.sr.openRoutine('today').catch((error) => ui.toast(error.message, 'error'));
  }

  function startSuggestedSession() {
    if (!scheduleSuggestion || !scheduleSuggestion.slot) return;
    if (scheduleSuggestion.subjectId) selectedSubjectId = scheduleSuggestion.subjectId;
    userChoseSubject = false;
    renderSubjects();
    updateHeroCopy();
    startSession();
  }

  function onRoutineFocus(payload) {
    if (!payload || !state) return;
    if (payload.alreadyActive) {
      ui.toast('A session is already running', 'info');
    } else {
      ui.toast(payload.title ? 'Session started · ' + payload.title : 'Session started', 'success');
    }
    renderAll(state);
    if (timer) timer.refresh();
  }

  function updateClock(now) {
    const formatted = core.formatTime(now);
    const parts = formatted.split(' ');
    els.headerTime.textContent = parts[0].replace(/^0/, '');
    els.headerSuffix.textContent = parts[1] || '';
    els.headerDate.textContent = headerDateFormat.format(now);
  }

  function renderSubjects() {
    if (!state) return;
    const active = state.activeSession;
    const chosen = active ? active.subjectId : (selectedSubject() || {}).id;
    els.subjectGrid.innerHTML = state.subjects.map((subject) => (
      '<button type="button" class="subject-chip' + (subject.id === chosen ? ' is-selected' : '') + '" ' +
      'data-subject="' + ui.escapeHtml(subject.id) + '" ' +
      'style="--subject:' + ui.escapeHtml(subject.color) + '" ' +
      'title="' + ui.escapeHtml(subject.name) + '"' +
      (active ? ' disabled' : '') + '>' +
      '<span class="dot"></span><span class="name"></span></button>'
    )).join('');

    const names = els.subjectGrid.querySelectorAll('.subject-chip .name');
    state.subjects.forEach((subject, index) => {
      if (names[index]) names[index].textContent = subject.name;
    });
    els.subjectLockNote.classList.toggle('hidden', !active);
  }

  function updateHeroCopy() {
    if (!state) return;
    const active = state.activeSession;
    const subject = active ? activeSubject() : selectedSubject();
    const name = subject ? subject.name : (active ? active.subjectName : '');
    els.hero.classList.toggle('is-active', Boolean(active));
    if (active) {
      els.statusText.innerHTML = 'Studying · <strong></strong>';
      els.statusText.querySelector('strong').textContent = name;
      const entry = new Date(active.entry);
      const entryDay = core.dateKey(entry);
      const dayPrefix = entryDay === currentDayKey ? '' : core.formatDayLabel(entryDay, new Date()) + ', ';
      els.heroSub.textContent = (active.routineTitle ? 'Routine · ' + active.routineTitle + ' · ' : '') +
        'since ' + dayPrefix + core.formatTime(active.entry);
    } else {
      els.statusText.textContent = 'No active session';
      els.heroSub.textContent = name ? name + ' selected' : 'Select a subject to begin';
    }
  }

  function renderControls() {
    const active = Boolean(state && state.activeSession);
    els.entryBtn.disabled = active || busy;
    els.exitBtn.disabled = !active || busy;
    els.entryHint.textContent = active ? 'Session running' : 'Start session';
    els.exitHint.textContent = active ? 'Save session' : 'Nothing running';
    els.entryBtn.title = active ? 'A session is already running' : 'Record entry time and start the timer';
    els.exitBtn.title = active ? 'Record exit time and save this session' : 'No session is running';
  }

  function renderStaticStats() {
    if (!state) return;
    const now = new Date();
    todayStats = core.statsForDate(state.sessions, core.dateKey(now));
    const target = state.settings.dailyTargetMinutes * 60000;
    els.statTotal.textContent = core.formatDuration(todayStats.total);
    els.statTotalNote.textContent = 'of ' + core.formatDuration(target) + ' goal';
    els.statSessions.textContent = String(todayStats.count);
    els.statSessionsNote.textContent = todayStats.count
      ? core.formatDuration(todayStats.average) + ' average'
      : 'Nothing recorded yet';
    els.statLongest.textContent = core.formatDuration(todayStats.longest);
    els.statAverage.textContent = core.formatDuration(todayStats.average);

    const streak = core.streakInfo(state.sessions, now);
    els.streakBadge.classList.toggle('hidden', streak.count < 1);
    els.streakText.textContent = streak.count + '-day streak';
  }

  function renderGoalCopy() {
    if (!state) return;
    const target = state.settings.dailyTargetMinutes;
    els.goalText.textContent = 'Daily goal · ' + Math.floor(target / 60) + 'h ' + core.pad2(target % 60) + 'm';
    els.statTotalNote.textContent = 'of ' + core.formatDuration(target * 60000) + ' goal';
  }

  function renderAll(nextState) {
    if (!nextState) return;
    state = nextState;
    currentDayKey = core.dateKey(new Date());
    if (state.activeSession) {
      selectedSubjectId = state.activeSession.subjectId;
    } else if (!state.subjects.some((subject) => subject.id === selectedSubjectId)) {
      selectedSubjectId = state.settings.defaultSubjectId || (state.subjects[0] && state.subjects[0].id);
    }
    updateClock(new Date());
    refreshSuggestion(new Date());
    renderSubjects();
    updateHeroCopy();
    renderControls();
    renderGoalCopy();
    renderStaticStats();
    history.renderRecent(els.recentList, state, new Date());
    refreshTimer();
  }

  function refreshTimer() {
    if (!state || !timer) return;
    const now = new Date();
    timer.update({
      active: state.activeSession,
      todayBaseMs: core.totalForDate(state.sessions, core.dateKey(now)),
      targetMs: state.settings.dailyTargetMinutes * 60000
    });
  }

  function renderLiveStats(frame) {
    const active = Boolean(frame.active);
    const count = todayStats.count + (active ? 1 : 0);
    const total = frame.todayMs;
    const longest = Math.max(todayStats.longest, active ? frame.elapsed : 0);
    els.statTotal.textContent = core.formatDuration(total);
    els.statTotalNote.textContent = Math.round(frame.progress * 100) + '% of ' +
      core.formatDuration(frame.targetMs) + ' goal';
    els.statSessions.textContent = String(todayStats.count);
    els.statSessionsNote.textContent = active
      ? (todayStats.count ? '+1 in progress' : '1 in progress')
      : (todayStats.count ? core.formatDuration(todayStats.average) + ' average' : 'Nothing recorded yet');
    els.statLongest.textContent = core.formatDuration(longest);
    els.statAverage.textContent = core.formatDuration(count ? total / count : 0);
  }

  function onTick(frame) {
    if (!state) return;
    const now = new Date(frame.now);
    const isActive = Boolean(frame.active);
    const dayKey = core.dateKey(now);
    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey;
      renderAll(state);
      return;
    }

    els.heroTimer.textContent = core.formatTimer(frame.elapsed);
    const offset = RING_LENGTH * (1 - frame.progress);
    els.ring.style.strokeDashoffset = String(offset);
    els.ring.style.opacity = frame.progress > 0 ? '1' : '0';
    els.goalFill.style.width = (frame.progress * 100).toFixed(1) + '%';
    els.goalPct.textContent = Math.round(frame.progress * 100) + '%';
    els.hero.classList.toggle('is-complete', frame.progress >= 1);

    const slowDue = frame.now - lastSlowUpdate >= 950;
    if (slowDue) {
      lastSlowUpdate = frame.now;
      updateClock(now);
      renderLiveStats(frame);
      const previousSubject = selectedSubjectId;
      refreshSuggestion(now);
      if (selectedSubjectId !== previousSubject && !isActive) {
        renderSubjects();
        updateHeroCopy();
      }
    }
  }

  async function startSession() {
    if (busy || !state || state.activeSession) return;
    const subject = selectedSubject();
    if (!subject) {
      ui.toast('Add a subject before starting a session.', 'error');
      return;
    }
    busy = true;
    renderControls();
    try {
      await store.call('startSession', subject.id, suggestionRoutineMeta());
      ui.toast('Session started · ' + subject.name, 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    } finally {
      busy = false;
      renderControls();
    }
  }

  async function endSession() {
    if (busy || !state || !state.activeSession) return;
    busy = true;
    userChoseSubject = false;
    renderControls();
    try {
      const response = await store.call('endSession');
      const session = response.completed;
      if (session) {
        ui.toast('Saved · ' + history.nameFor(store.state, session) + ' · ' + core.formatDuration(core.sessionDuration(session)), 'success');
      } else {
        ui.toast('Session saved', 'success');
      }
    } catch (error) {
      ui.toast(error.message, 'error');
    } finally {
      busy = false;
      renderControls();
    }
  }

  async function discardSession() {
    if (busy || !state || !state.activeSession) return;
    const subject = activeSubject();
    const confirmed = await ui.confirm({
      title: 'Discard this session?',
      message: 'The running ' + (subject ? subject.name + ' ' : '') + 'session will be deleted. Nothing will be written to the register.',
      confirmLabel: 'Discard session'
    });
    if (!confirmed) return;
    busy = true;
    userChoseSubject = false;
    renderControls();
    try {
      await store.call('discardSession');
      ui.toast('Session discarded', 'success');
    } catch (error) {
      ui.toast(error.message, 'error');
    } finally {
      busy = false;
      renderControls();
    }
  }

  function openDashboard() {
    window.sr.openDashboard().catch((error) => ui.toast(error.message, 'error'));
  }

  function bind() {
    els.subjectGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-subject]');
      if (!button || button.disabled || (state && state.activeSession)) return;
      userChoseSubject = true;
      selectedSubjectId = button.getAttribute('data-subject');
      renderSubjects();
      updateHeroCopy();
      if (timer) timer.refresh();
    });

    els.entryBtn.addEventListener('click', startSession);
    els.exitBtn.addEventListener('click', endSession);
    els.discardBtn.addEventListener('click', discardSession);
    els.scheduleStart.addEventListener('click', startSuggestedSession);
    document.getElementById('routineBtn').addEventListener('click', openRoutine);
    document.getElementById('manageSubjectsBtn').addEventListener('click', () => window.SRSettings.open());
    document.getElementById('settingsBtn').addEventListener('click', () => window.SRSettings.open());
    document.getElementById('dashboardBtn').addEventListener('click', openDashboard);
    document.getElementById('openRegisterBtn').addEventListener('click', openDashboard);
    document.getElementById('quitBtn').addEventListener('click', () => window.sr.quit());

    window.sr.onRoutineFocus(onRoutineFocus);
    window.addEventListener('focus', () => {
      if (state) store.init().catch(() => {});
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (document.getElementById('modalRoot').childElementCount > 0) return;
      window.sr.closePopover();
    });

    document.addEventListener('visibilitychange', () => {
      if (!timer) return;
      if (document.hidden) {
        timer.stop();
      } else {
        timer.start();
        refreshTimer();
      }
    });
  }

  async function boot() {
    ui.hydrateIcons();
    bind();

    timer = window.SRTimer.create(onTick);
    store.subscribe((nextState) => renderAll(nextState));

    try {
      await store.init();
      timer.start();
      refreshTimer();
    } catch (error) {
      ui.toast(error.message || 'Could not load the register', 'error', 5000);
    }
  }

  boot();
})();
